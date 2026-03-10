import { db, ensureDatabaseInitialized } from "@/db";
import { articleComments, articleReviews, articles, articleSyncLinks, notifications, payments } from "@/db/schema";
import { getContextDisplayName, getContextIdentityCandidates, getContextPenName, getCurrentUserContext, matchesIdentityCandidate } from "@/lib/auth";
import { createArticleInGoogleSheet, mirrorArticleUpdateToGoogleSheet } from "@/lib/google-sheet-mutation";
import { publishRealtimeEvent } from "@/lib/realtime";
import { parseRoyaltyDateParts } from "@/lib/royalty";
import { isApprovedArticleStatusFilterValue } from "@/lib/article-status";
import { writeAuditLog } from "@/lib/audit";
import { enforceTrustedOrigin } from "@/lib/request-security";
import { handleServerError } from "@/lib/server-error";
import { and, desc, eq, inArray, like, or, sql, type SQL } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

type ArticleInsert = typeof articles.$inferInsert;
type ArticleUpdateInput = Partial<ArticleInsert> & { id?: number };

type ArticleCriteria = {
  search: string;
  titleQuery: string;
  penName: string;
  status: string;
  category: string;
  month: string;
  year: string;
  articleType: string;
  contentType: string;
  reviewerName: string;
};

type DeleteScope = "all" | "current_filters" | "custom";
type ArticleDeleteRow = {
  id: number;
  articleId: string | null;
  title: string;
  penName: string;
  date: string;
  status: string;
};

type DeleteResult = {
  deletedArticles: number;
  deletedComments: number;
  deletedReviews: number;
  deletedNotifications: number;
  clearedPayments: number;
};

type NonBlockingStepOptions<T> = {
  scope: string;
  fallback: T;
};

function normalizeString(value: unknown): string {
  return String(value || "").trim();
}

async function runNonBlockingStep<T>(task: () => Promise<T>, options: NonBlockingStepOptions<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    console.error(`[${options.scope}]`, error);
    return options.fallback;
  }
}

function readCriteriaFromSearchParams(searchParams: URLSearchParams): ArticleCriteria {
  return {
    search: normalizeString(searchParams.get("search")),
    titleQuery: normalizeString(searchParams.get("titleQuery")),
    penName: normalizeString(searchParams.get("penName")),
    status: normalizeString(searchParams.get("status")),
    category: normalizeString(searchParams.get("category")),
    month: normalizeString(searchParams.get("month")),
    year: normalizeString(searchParams.get("year")),
    articleType: normalizeString(searchParams.get("articleType")),
    contentType: normalizeString(searchParams.get("contentType")),
    reviewerName: normalizeString(searchParams.get("reviewerName")),
  };
}

function readCriteriaFromBody(body: Record<string, unknown>): ArticleCriteria {
  return {
    search: normalizeString(body.search),
    titleQuery: normalizeString(body.titleQuery),
    penName: normalizeString(body.penName),
    status: normalizeString(body.status),
    category: normalizeString(body.category),
    month: normalizeString(body.month),
    year: normalizeString(body.year),
    articleType: normalizeString(body.articleType),
    contentType: normalizeString(body.contentType),
    reviewerName: normalizeString(body.reviewerName),
  };
}

function hasCriteria(criteria: ArticleCriteria): boolean {
  return Object.values(criteria).some((value) => value !== "");
}

function buildArticleWhere(criteria: ArticleCriteria, isAdmin: boolean): SQL | undefined {
  const conditions: SQL[] = [];

  if (isAdmin && criteria.penName) {
    conditions.push(eq(articles.penName, criteria.penName));
  }

  if (criteria.search) {
    const searchCondition = or(
      like(articles.title, `%${criteria.search}%`),
      like(articles.articleId, `%${criteria.search}%`),
      like(articles.penName, `%${criteria.search}%`),
      like(articles.notes, `%${criteria.search}%`)
    );

    if (searchCondition) {
      conditions.push(searchCondition);
    }
  }

  if (criteria.titleQuery) {
    conditions.push(like(articles.title, `%${criteria.titleQuery}%`));
  }
  if (criteria.status) {
    if (isApprovedArticleStatusFilterValue(criteria.status)) {
      const approvedCondition = or(
        eq(articles.status, "Published"),
        eq(articles.status, "Approved")
      );
      if (approvedCondition) {
        conditions.push(approvedCondition);
      }
    } else {
      conditions.push(eq(articles.status, criteria.status as never));
    }
  }
  if (criteria.category) {
    conditions.push(eq(articles.category, criteria.category as never));
  }
  if (criteria.articleType) {
    conditions.push(eq(articles.articleType, criteria.articleType as never));
  }
  if (criteria.contentType) {
    conditions.push(eq(articles.contentType, criteria.contentType as never));
  }
  if (criteria.reviewerName) {
    conditions.push(eq(articles.reviewerName, criteria.reviewerName));
  }

  if (criteria.year && criteria.month) {
    conditions.push(like(articles.date, `${criteria.year}-${criteria.month.padStart(2, "0")}%`));
  } else if (criteria.year) {
    conditions.push(like(articles.date, `${criteria.year}-%`));
  } else if (criteria.month) {
    conditions.push(like(articles.date, `%-${criteria.month.padStart(2, "0")}-%`));
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

function buildAffectedPaymentWhere(rows: Array<Pick<ArticleDeleteRow, "penName" | "date">>) {
  const conditions: SQL[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const [yearText, monthText] = String(row.date || "").split("-");
    const year = parseInt(yearText || "", 10);
    const month = parseInt(monthText || "", 10);
    if (!row.penName || !Number.isInteger(year) || !Number.isInteger(month)) continue;

    const key = `${row.penName}|${year}|${month}`;
    if (seen.has(key)) continue;
    seen.add(key);

    conditions.push(and(
      eq(payments.penName, row.penName),
      eq(payments.year, year),
      eq(payments.month, month)
    )!);
  }

  return conditions.length > 0 ? or(...conditions) : undefined;
}

function getArticleDateSortValue(value: string) {
  const parsed = parseRoyaltyDateParts(value);
  if (parsed) {
    return Number(`${parsed.year}${String(parsed.month).padStart(2, "0")}${String(parsed.day).padStart(2, "0")}`);
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sortArticlesByLatestDate<T extends { id: number; date: string; updatedAt?: string | null; createdAt?: string | null }>(rows: T[]) {
  return [...rows].sort((left, right) => {
    const dateDiff = getArticleDateSortValue(right.date) - getArticleDateSortValue(left.date);
    if (dateDiff !== 0) return dateDiff;

    const updatedDiff = new Date(right.updatedAt || right.createdAt || 0).getTime() - new Date(left.updatedAt || left.createdAt || 0).getTime();
    if (Number.isFinite(updatedDiff) && updatedDiff !== 0) return updatedDiff;

    return right.id - left.id;
  });
}

async function getDeletePreview(whereClause?: SQL) {
  const targetRows = await db
    .select({
      id: articles.id,
      articleId: articles.articleId,
      title: articles.title,
      penName: articles.penName,
      date: articles.date,
      status: articles.status,
    })
    .from(articles)
    .where(whereClause)
    .orderBy(desc(articles.id))
    .all();

  const targetIds = targetRows.map((row) => row.id);

  if (targetIds.length === 0) {
    return {
      total: 0,
      sample: [] as ArticleDeleteRow[],
      related: { comments: 0, reviews: 0, notifications: 0, payments: 0 },
      articleIds: [] as number[],
    };
  }

  const commentsCount = Number((await db
    .select({ count: sql<number>`count(*)` })
    .from(articleComments)
    .where(inArray(articleComments.articleId, targetIds))
    .get())?.count || 0);

  const reviewsCount = Number((await db
    .select({ count: sql<number>`count(*)` })
    .from(articleReviews)
    .where(inArray(articleReviews.articleId, targetIds))
    .get())?.count || 0);

  const notificationsCount = Number((await db
    .select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(inArray(notifications.relatedArticleId, targetIds))
    .get())?.count || 0);

  const affectedPaymentWhere = buildAffectedPaymentWhere(targetRows);
  const paymentsCount = affectedPaymentWhere
    ? Number((await db
        .select({ count: sql<number>`count(*)` })
        .from(payments)
        .where(affectedPaymentWhere)
        .get())?.count || 0)
    : 0;

  return {
    total: targetRows.length,
    sample: targetRows.slice(0, 6),
    related: {
      comments: commentsCount,
      reviews: reviewsCount,
      notifications: notificationsCount,
      payments: paymentsCount,
    },
    articleIds: targetIds,
  };
}

async function deleteArticlesByIds(articleIds: number[]): Promise<DeleteResult> {
  if (articleIds.length === 0) {
    return {
      deletedArticles: 0,
      deletedComments: 0,
      deletedReviews: 0,
      deletedNotifications: 0,
      clearedPayments: 0,
    };
  }

  const targetRows = await db
    .select({
      id: articles.id,
      penName: articles.penName,
      date: articles.date,
    })
    .from(articles)
    .where(inArray(articles.id, articleIds))
    .all();

  const affectedPaymentWhere = buildAffectedPaymentWhere(targetRows);

  return db.transaction(async (tx) => {
    const deletedComments = Number((await tx
      .delete(articleComments)
      .where(inArray(articleComments.articleId, articleIds))
      .run()).rowsAffected || 0);

    const deletedReviews = Number((await tx
      .delete(articleReviews)
      .where(inArray(articleReviews.articleId, articleIds))
      .run()).rowsAffected || 0);

    const deletedNotifications = Number((await tx
      .delete(notifications)
      .where(inArray(notifications.relatedArticleId, articleIds))
      .run()).rowsAffected || 0);

    await tx
      .delete(articleSyncLinks)
      .where(inArray(articleSyncLinks.articleIdRef, articleIds))
      .run();

    const deletedArticles = Number((await tx
      .delete(articles)
      .where(inArray(articles.id, articleIds))
      .run()).rowsAffected || 0);

    const clearedPayments = affectedPaymentWhere
      ? Number((await tx.delete(payments).where(affectedPaymentWhere).run()).rowsAffected || 0)
      : 0;

    return {
      deletedArticles,
      deletedComments,
      deletedReviews,
      deletedNotifications,
      clearedPayments,
    };
  }) as Promise<DeleteResult>;
}

export async function GET(request: NextRequest) {
  try {
    await ensureDatabaseInitialized();
    const context = await getCurrentUserContext();
    if (!context) {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const mode = normalizeString(searchParams.get("mode"));
    const criteria = readCriteriaFromSearchParams(searchParams);
    const whereClause = buildArticleWhere(criteria, context.user.role === "admin");

    if (mode === "delete-preview") {
      if (context.user.role !== "admin") {
        return NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 });
      }

      const preview = await getDeletePreview(whereClause);
      return NextResponse.json({ success: true, ...preview });
    }

    const page = Math.max(parseInt(searchParams.get("page") || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "50", 10), 1), 200);
    const identityCandidates = getContextIdentityCandidates(context);

    if (context.user.role !== "admin" && identityCandidates.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
        pagination: { page, limit, total: 0, totalPages: 0 },
      });
    }

    const filteredRows = await db
      .select()
      .from(articles)
      .where(whereClause)
      .orderBy(desc(articles.id))
      .all();

    const scopedRows = context.user.role === "admin"
      ? filteredRows
      : filteredRows.filter((article) => matchesIdentityCandidate(identityCandidates, article.penName));

    const sortedRows = sortArticlesByLatestDate(scopedRows);

    const data = sortedRows
      .slice((page - 1) * limit, page * limit)
      .map((article) => ({
        ...article,
        canDelete: context.user.role === "admin" || article.createdByUserId === context.user.id,
      }));

    return NextResponse.json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        total: sortedRows.length,
        totalPages: Math.ceil(sortedRows.length / limit),
      },
    });
  } catch (error) {
    return handleServerError("articles.get", error);
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

    const body = (await request.json()) as Partial<ArticleInsert>;
    const ownPenName = getContextPenName(context);
    const finalPenName = context.user.role === "admin" ? normalizeString(body.penName) : ownPenName || "";
    const title = normalizeString(body.title);
    const date = normalizeString(body.date);

    if (!title || !finalPenName || !date) {
      return NextResponse.json(
        { success: false, error: "Title, penName, and date are required" },
        { status: 400 }
      );
    }

    const insertedArticle = await db
      .insert(articles)
      .values({
        articleId: normalizeString(body.articleId) || undefined,
        date,
        title,
        penName: finalPenName,
        createdByUserId: context.user.id,
        category: (normalizeString(body.category) || "ICT") as never,
        articleType: (normalizeString(body.articleType) || "Bài SEO ICT") as never,
        contentType: (normalizeString(body.contentType) || "Viết mới") as never,
        wordCountRange: (normalizeString(body.wordCountRange) || undefined) as never,
        status: (normalizeString(body.status) || "Submitted") as never,
        link: normalizeString(body.link) || undefined,
        reviewerName: normalizeString(body.reviewerName) || undefined,
        notes: normalizeString(body.notes) || undefined,
      })
      .returning({ id: articles.id })
      .get();

    await runNonBlockingStep(
      () => writeAuditLog({
        userId: context.user.id,
        action: "article_created",
        entity: "article",
        entityId: String(insertedArticle?.id),
        payload: { title, penName: finalPenName },
      }),
      { scope: "articles.post.audit", fallback: undefined }
    );

    const sheetSync = insertedArticle?.id
      ? await runNonBlockingStep(
          () => createArticleInGoogleSheet({
            articleId: Number(insertedArticle.id),
            actorUserId: context.user.id,
            actorDisplayName: getContextDisplayName(context),
            reason: "article_post",
          }),
          {
            scope: "articles.post.sheetSync",
            fallback: {
              attempted: true,
              success: false,
              skipped: false,
              message: "Không thể kết nối tới Google Sheet lúc này. Bài viết vẫn đã lưu trong hệ thống.",
            },
          }
        )
      : null;

    await runNonBlockingStep(
      () => publishRealtimeEvent(["articles", "dashboard", "royalty"]),
      { scope: "articles.post.realtime", fallback: null }
    );

    return NextResponse.json({ success: true, id: Number(insertedArticle?.id), sheetSync });
  } catch (error) {
    return handleServerError("articles.post", error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    await ensureDatabaseInitialized();
    const originError = enforceTrustedOrigin(request);
    if (originError) return originError;

    const context = await getCurrentUserContext();
    if (!context) {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    }

    const body = (await request.json()) as ArticleUpdateInput;
    const id = Number(body.id);

    if (!Number.isInteger(id)) {
      return NextResponse.json(
        { success: false, error: "ID is required" },
        { status: 400 }
      );
    }

    const existing = await db.select().from(articles).where(eq(articles.id, id)).get();
    if (!existing) {
      return NextResponse.json({ success: false, error: "Article not found" }, { status: 404 });
    }

    if (context.user.role !== "admin") {
      const identityCandidates = getContextIdentityCandidates(context);
      if (!matchesIdentityCandidate(identityCandidates, existing.penName)) {
        return NextResponse.json(
          { success: false, error: "Permission denied" },
          { status: 403 }
        );
      }
    }

    const updateData: Partial<ArticleInsert> = { ...body };
    delete (updateData as ArticleUpdateInput).id;

    if (context.user.role !== "admin") {
      delete updateData.penName;
      delete updateData.reviewerName;
      delete updateData.createdByUserId;
    }

    if (typeof updateData.title === "string") updateData.title = updateData.title.trim();
    if (typeof updateData.articleId === "string") updateData.articleId = updateData.articleId.trim() || undefined;
    if (typeof updateData.link === "string") updateData.link = updateData.link.trim() || undefined;
    if (typeof updateData.notes === "string") updateData.notes = updateData.notes.trim() || undefined;
    if (typeof updateData.reviewerName === "string") updateData.reviewerName = updateData.reviewerName.trim() || undefined;
    if (typeof updateData.penName === "string") updateData.penName = updateData.penName.trim();
    if (typeof updateData.date === "string") updateData.date = updateData.date.trim();
    updateData.updatedAt = new Date().toISOString();
    const shouldMirrorToGoogleSheet = [
      "status",
      "reviewerName",
      "notes",
      "link",
      "articleId",
      "title",
      "penName",
      "date",
    ].some((field) => Object.prototype.hasOwnProperty.call(body, field));

    await db.update(articles)
      .set(updateData)
      .where(eq(articles.id, id))
      .run();

    await runNonBlockingStep(
      () => writeAuditLog({
        userId: context.user.id,
        action: "article_updated",
        entity: "article",
        entityId: id,
        payload: updateData,
      }),
      { scope: "articles.put.audit", fallback: undefined }
    );

    const sheetSync = shouldMirrorToGoogleSheet
      ? await runNonBlockingStep(
          () => mirrorArticleUpdateToGoogleSheet({
            articleId: id,
            actorUserId: context.user.id,
            actorDisplayName: getContextDisplayName(context),
            reason: "article_put",
          }),
          {
            scope: "articles.put.sheetSync",
            fallback: {
              attempted: true,
              success: false,
              skipped: false,
              message: "Không thể kết nối tới Google Sheet lúc này. Bài viết vẫn đã được cập nhật trong hệ thống.",
            },
          }
        )
      : null;

    await runNonBlockingStep(
      () => publishRealtimeEvent(["articles", "dashboard", "royalty"]),
      { scope: "articles.put.realtime", fallback: null }
    );

    return NextResponse.json({ success: true, sheetSync });
  } catch (error) {
    return handleServerError("articles.put", error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await ensureDatabaseInitialized();
    const originError = enforceTrustedOrigin(request);
    if (originError) return originError;

    const context = await getCurrentUserContext();
    if (!context) {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = normalizeString(searchParams.get("id"));

    if (id) {
      const articleId = parseInt(id, 10);
      const existing = await db
        .select({
          id: articles.id,
          title: articles.title,
          penName: articles.penName,
          date: articles.date,
          createdByUserId: articles.createdByUserId,
        })
        .from(articles)
        .where(eq(articles.id, articleId))
        .get();

      if (!existing) {
        return NextResponse.json({ success: false, error: "Article not found" }, { status: 404 });
      }

      if (context.user.role !== "admin") {
        const identityCandidates = getContextIdentityCandidates(context);
        const canDeleteOwnArticle =
          matchesIdentityCandidate(identityCandidates, existing.penName)
          && existing.createdByUserId === context.user.id;

        if (!canDeleteOwnArticle) {
          return NextResponse.json(
            { success: false, error: "Bạn chỉ có thể xóa bài do chính mình tạo" },
            { status: 403 }
          );
        }
      }

      const deleted = await deleteArticlesByIds([articleId]);

      await writeAuditLog({
        userId: context.user.id,
        action: "article_deleted",
        entity: "article",
        entityId: articleId,
        payload: {
          title: existing.title,
          penName: existing.penName,
          date: existing.date,
          ...deleted,
        },
      });

      await publishRealtimeEvent(["articles", "dashboard", "royalty", "notifications"]);

      return NextResponse.json({ success: true, deletedCount: deleted.deletedArticles, ...deleted });
    }

    if (context.user.role !== "admin") {
      return NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = normalizeString(body.action) || "preview";
    const scope = (normalizeString(body.scope) || "custom") as DeleteScope;
    const criteria = readCriteriaFromBody(body);

    if (scope !== "all" && !hasCriteria(criteria)) {
      return NextResponse.json(
        { success: false, error: "Chưa chọn tiêu chí xóa. Hãy dùng bộ lọc hoặc chọn chế độ xóa toàn bộ." },
        { status: 400 }
      );
    }

    const whereClause = scope === "all" ? undefined : buildArticleWhere(criteria, true);
    const preview = await getDeletePreview(whereClause);

    if (action === "preview") {
      return NextResponse.json({ success: true, scope, criteria, ...preview });
    }

    const deleted = await deleteArticlesByIds(preview.articleIds);

    await writeAuditLog({
      userId: context.user.id,
      action: "articles_bulk_deleted",
      entity: "article",
      payload: {
        scope,
        criteria,
        deletedCount: deleted.deletedArticles,
        ...deleted,
      },
    });

    await publishRealtimeEvent(["articles", "dashboard", "royalty", "notifications"]);

    return NextResponse.json({
      success: true,
      scope,
      criteria,
      deletedCount: deleted.deletedArticles,
      ...deleted,
    });
  } catch (error) {
    return handleServerError("articles.delete", error);
  }
}


