import { db, ensureDatabaseInitialized } from "@/db";
import { articleReviews, articles, users, collaborators } from "@/db/schema";
import { getContextDisplayName, getContextIdentityCandidates, getCurrentUserContext, hasArticleManagerAccess, hasArticleReviewAccess, matchesIdentityCandidate, type CurrentUserContext } from "@/lib/auth";
import { mirrorArticleUpdateToGoogleSheet } from "@/lib/google-sheet-mutation";
import { createNotification } from "@/lib/notifications";
import { publishRealtimeEvent } from "@/lib/realtime";
import { writeAuditLog } from "@/lib/audit";
import { enforceTrustedOrigin } from "@/lib/request-security";
import { handleServerError } from "@/lib/server-error";
import { canAccessTeam } from "@/lib/teams";
import { eq, desc, and } from "drizzle-orm";
import { after, NextRequest, NextResponse } from "next/server";

function canAccessArticleReview(
    context: CurrentUserContext,
    article: { penName: string; reviewerName: string | null; status: string }
) {
    if (hasArticleManagerAccess(context)) {
        return true;
    }

    const identityCandidates = getContextIdentityCandidates(context);
    if (matchesIdentityCandidate(identityCandidates, article.penName)) {
        return true;
    }

    if (!hasArticleReviewAccess(context)) {
        return false;
    }

    return article.status === "Submitted" || matchesIdentityCandidate(identityCandidates, article.reviewerName);
}

function canCreateArticleReview(
    context: CurrentUserContext,
    article: { reviewerName: string | null; status: string }
) {
    if (hasArticleManagerAccess(context)) {
        return true;
    }

    if (!hasArticleReviewAccess(context)) {
        return false;
    }

    return article.status === "Submitted" || matchesIdentityCandidate(getContextIdentityCandidates(context), article.reviewerName);
}

function scheduleBackgroundWork(task: () => Promise<void>) {
    after(async () => {
        try {
            await task();
        } catch (error) {
            console.error("[articles.review.background]", error);
        }
    });
}

async function notifyGoogleSheetSyncIssue(userId: number, message: string) {
    await publishRealtimeEvent({
        channels: ["articles"],
        userIds: [userId],
        toastTitle: "Google Sheet chưa kịp đồng bộ",
        toastMessage: message,
        toastVariant: "warning",
    });
}

export async function GET(request: NextRequest) {
    try {
        await ensureDatabaseInitialized();
        const context = await getCurrentUserContext();
        if (!context) {
            return NextResponse.json({ success: false, error: "Auth required" }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const articleId = searchParams.get("articleId");

        if (!articleId) {
            return NextResponse.json({ success: false, error: "articleId required" }, { status: 400 });
        }

        const articleNumericId = parseInt(articleId, 10);
        const article = await db.select().from(articles).where(eq(articles.id, articleNumericId)).get();
        if (!article) {
            return NextResponse.json({ success: false, error: "Article not found" }, { status: 404 });
        }
        if (!canAccessTeam(context, article.teamId)) {
            return NextResponse.json({ success: false, error: "Permission denied" }, { status: 403 });
        }

        if (!canAccessArticleReview(context, article)) {
            return NextResponse.json({ success: false, error: "Permission denied" }, { status: 403 });
        }

        const reviews = await db
            .select()
            .from(articleReviews)
            .where(eq(articleReviews.articleId, articleNumericId))
            .orderBy(desc(articleReviews.id))
            .all();

        return NextResponse.json({ success: true, data: reviews });
    } catch (error) {
        return handleServerError("articles.review.get", error);
    }
}

export async function POST(request: NextRequest) {
    try {
        await ensureDatabaseInitialized();
        const originError = enforceTrustedOrigin(request);
        if (originError) return originError;

        const context = await getCurrentUserContext();
        if (!context) {
            return NextResponse.json({ success: false, error: "Auth required" }, { status: 401 });
        }

        const { articleId, errorNotes } = await request.json();

        if (!articleId || !errorNotes) {
            return NextResponse.json({ success: false, error: "articleId and errorNotes required" }, { status: 400 });
        }

        const article = await db.select().from(articles).where(eq(articles.id, articleId)).get();
        if (!article) {
            return NextResponse.json({ success: false, error: "Article not found" }, { status: 404 });
        }
        if (!canAccessTeam(context, article.teamId)) {
            return NextResponse.json({ success: false, error: "Reviewer access required" }, { status: 403 });
        }

        if (!canCreateArticleReview(context, article)) {
            return NextResponse.json({ success: false, error: "Reviewer access required" }, { status: 403 });
        }

        await db.insert(articleReviews)
            .values({
                articleId,
                reviewerUserId: context.user.id,
                errorNotes,
                status: "pending",
            })
            .run();

        const reviewerDisplayName = getContextDisplayName(context);
        await db.update(articles)
            .set({
                status: "NeedsFix",
                reviewerName: reviewerDisplayName,
                notes: String(errorNotes || "").trim(),
                updatedAt: new Date().toISOString(),
            })
            .where(eq(articles.id, articleId))
            .run();

        if (article) {
            let targetUserId = article.createdByUserId ?? null;

            if (!targetUserId) {
                const targets = await db
                    .select({ id: users.id, penName: collaborators.penName, name: collaborators.name })
                    .from(users)
                    .innerJoin(collaborators, eq(users.collaboratorId, collaborators.id))
                    .all();

                const targetUser = targets.find((item) => matchesIdentityCandidate([item.penName, item.name], article.penName));
                targetUserId = targetUser?.id ?? null;
            }

            if (targetUserId) {
                await createNotification({
                    fromUserId: context.user.id,
                    toUserId: targetUserId,
                    toPenName: article.penName,
                    type: "review",
                    title: "📝 Bai viet can sua loi",
                    message: `Bai "${article.title}" co loi can sua:\n${errorNotes}`,
                    relatedArticleId: articleId,
                });
            }
        }

        await writeAuditLog({
            userId: context.user.id,
            action: "article_review_created",
            entity: "article_review",
            entityId: articleId,
            payload: { errorNotes },
        });

        await publishRealtimeEvent(["articles", "dashboard"]);
        scheduleBackgroundWork(async () => {
            const sheetSync = await mirrorArticleUpdateToGoogleSheet({
                articleId,
                actorUserId: context.user.id,
                actorDisplayName: reviewerDisplayName,
                reason: "article_review_created",
                overrides: {
                    status: "NeedsFix",
                    reviewerName: reviewerDisplayName,
                    notes: String(errorNotes || "").trim(),
                },
            });

            if (sheetSync.skipped || !sheetSync.success) {
                await notifyGoogleSheetSyncIssue(context.user.id, sheetSync.message);
            }
        });

        return NextResponse.json({ success: true, backgroundSyncQueued: true });
    } catch (error) {
        return handleServerError("articles.review.post", error);
    }
}

export async function PUT(request: NextRequest) {
    try {
        await ensureDatabaseInitialized();
        const originError = enforceTrustedOrigin(request);
        if (originError) return originError;

        const context = await getCurrentUserContext();
        if (!context) {
            return NextResponse.json({ success: false, error: "Auth required" }, { status: 401 });
        }

        const { reviewId, ctvResponse } = await request.json();

        if (!reviewId || !ctvResponse) {
            return NextResponse.json({ success: false, error: "reviewId and ctvResponse required" }, { status: 400 });
        }

        const review = await db.select().from(articleReviews).where(eq(articleReviews.id, reviewId)).get();
        if (!review) {
            return NextResponse.json({ success: false, error: "Review not found" }, { status: 404 });
        }

        const article = await db.select().from(articles).where(eq(articles.id, review.articleId)).get();
        if (!article) {
            return NextResponse.json({ success: false, error: "Article not found" }, { status: 404 });
        }
        if (!canAccessTeam(context, article.teamId)) {
            return NextResponse.json({ success: false, error: "Permission denied" }, { status: 403 });
        }

        if (hasArticleReviewAccess(context) && !hasArticleManagerAccess(context)) {
            return NextResponse.json({ success: false, error: "Permission denied" }, { status: 403 });
        }

        if (!hasArticleManagerAccess(context)) {
            const identityCandidates = getContextIdentityCandidates(context);
            if (!matchesIdentityCandidate(identityCandidates, article.penName)) {
                return NextResponse.json({ success: false, error: "Permission denied" }, { status: 403 });
            }
        }

        await db.update(articleReviews)
            .set({
                ctvResponse,
                status: "fixed",
                updatedAt: new Date().toISOString(),
            })
            .where(eq(articleReviews.id, reviewId))
            .run();

        await db.update(articles)
            .set({ status: "Submitted", updatedAt: new Date().toISOString() })
            .where(eq(articles.id, review.articleId))
            .run();

        const adminUser = await db
            .select()
            .from(users)
            .where(and(eq(users.role, "admin"), ...(article.teamId != null ? [eq(users.teamId, article.teamId)] : [])))
            .get();

        if (adminUser) {
            await createNotification({
                fromUserId: context.user.id,
                toUserId: adminUser.id,
                type: "error_fix",
                title: "✅ CTV đã sửa lỗi bài viết",
                message: `CTV đã sửa lỗi bài "${article.title}":\n${ctvResponse}`,
                relatedArticleId: review.articleId,
            });
        }

        await writeAuditLog({
            userId: context.user.id,
            action: "article_review_fixed",
            entity: "article_review",
            entityId: reviewId,
            payload: { articleId: review.articleId },
        });

        await publishRealtimeEvent(["articles", "dashboard"]);
        scheduleBackgroundWork(async () => {
            const sheetSync = await mirrorArticleUpdateToGoogleSheet({
                articleId: review.articleId,
                actorUserId: context.user.id,
                actorDisplayName: getContextDisplayName(context),
                reason: "article_review_fixed",
                overrides: {
                    status: "Submitted",
                    notes: String(ctvResponse || "").trim(),
                },
            });

            if (sheetSync.skipped || !sheetSync.success) {
                await notifyGoogleSheetSyncIssue(context.user.id, sheetSync.message);
            }
        });

        return NextResponse.json({ success: true, backgroundSyncQueued: true });
    } catch (error) {
        return handleServerError("articles.review.put", error);
    }
}

