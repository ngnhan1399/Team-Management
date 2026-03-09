import { db, ensureDatabaseInitialized } from "@/db";
import { articleComments, articles, collaborators, users } from "@/db/schema";
import { getContextIdentityCandidates, getContextPenName, getCurrentUserContext, matchesIdentityCandidate } from "@/lib/auth";
import { createNotification } from "@/lib/notifications";
import { publishRealtimeEvent } from "@/lib/realtime";
import { writeAuditLog } from "@/lib/audit";
import { enforceTrustedOrigin } from "@/lib/request-security";
import { handleServerError } from "@/lib/server-error";
import { requiredInt, requiredString, optionalString, ValidationError } from "@/lib/validation";
import { eq, desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

function extractMentions(content: string): string[] {
  const matches = content.match(/@([^\s@]+)/g) || [];
  return Array.from(new Set(matches.map((m) => m.slice(1).trim()).filter(Boolean)));
}

function parseMentions(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  try {
    await ensureDatabaseInitialized();
    const context = await getCurrentUserContext();
    if (!context) {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    }

    const articleId = requiredInt(new URL(request.url).searchParams.get("articleId"), "articleId");
    const article = await db.select().from(articles).where(eq(articles.id, articleId)).get();

    if (!article) {
      return NextResponse.json({ success: false, error: "Article not found" }, { status: 404 });
    }

    if (context.user.role !== "admin") {
      const identityCandidates = getContextIdentityCandidates(context);
      if (!matchesIdentityCandidate(identityCandidates, article.penName)) {
        return NextResponse.json({ success: false, error: "Permission denied" }, { status: 403 });
      }
    }

    const rows = await db
      .select()
      .from(articleComments)
      .where(eq(articleComments.articleId, articleId))
      .orderBy(desc(articleComments.id))
      .all();

    const data = rows.map((item) => ({ ...item, mentions: parseMentions(item.mentions) }));

    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    return handleServerError("articles.comments.get", error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureDatabaseInitialized();
    const originError = enforceTrustedOrigin(request);
    if (originError) return originError;

    const context = await getCurrentUserContext();
    if (!context) {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const articleId = requiredInt(body.articleId, "articleId");
    const content = requiredString(body.content, "content", 2);
    const attachmentUrl = optionalString(body.attachmentUrl);

    const article = await db.select().from(articles).where(eq(articles.id, articleId)).get();
    if (!article) {
      return NextResponse.json({ success: false, error: "Article not found" }, { status: 404 });
    }

    const ownPenName = getContextPenName(context);
    if (context.user.role !== "admin" && !matchesIdentityCandidate(getContextIdentityCandidates(context), article.penName)) {
      return NextResponse.json({ success: false, error: "Permission denied" }, { status: 403 });
    }

    const actorPenName = ownPenName || context.user.email.split("@")[0];
    const mentions = extractMentions(content);

    const insertedComment = await db
      .insert(articleComments)
      .values({
        articleId,
        userId: context.user.id,
        penName: actorPenName,
        content,
        mentions: mentions.length > 0 ? JSON.stringify(mentions) : null,
        attachmentUrl,
      })
      .returning({ id: articleComments.id })
      .get();

    for (const mention of mentions) {
      const mentionedUser = await db
        .select({ id: users.id })
        .from(users)
        .innerJoin(collaborators, eq(users.collaboratorId, collaborators.id))
        .where(eq(collaborators.penName, mention))
        .get();

      if (mentionedUser?.id && mentionedUser.id !== context.user.id) {
        await createNotification({
          fromUserId: context.user.id,
          toUserId: mentionedUser.id,
          toPenName: mention,
          type: "info",
          title: "💬 Bạn được nhắc trong bình luận",
          message: `${actorPenName} đã nhắc bạn trong bình luận của bài "${article.title}"`,
          relatedArticleId: articleId,
        });
      }
    }

    await writeAuditLog({
      userId: context.user.id,
      action: "article_comment_created",
      entity: "article_comment",
      entityId: String(insertedComment?.id),
      payload: { articleId, mentionsCount: mentions.length },
    });

    await publishRealtimeEvent(["articles"]);

    return NextResponse.json({ success: true, id: Number(insertedComment?.id) });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    return handleServerError("articles.comments.post", error);
  }
}

