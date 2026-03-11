import { db, ensureDatabaseInitialized } from "@/db";
import { articleComments, articleReviews, articles, articleSyncLinks, collaborators, notifications, payments } from "@/db/schema";
import { getContextArticleOwnerCandidates, getContextDisplayName, getContextIdentityCandidates, getContextIdentityLabels, getContextPenName, getCurrentUserContext, hasArticleManagerAccess, hasArticleReviewAccess, matchesIdentityCandidate } from "@/lib/auth";
import {
  createArticleInGoogleSheet,
  mirrorArticleDeleteToGoogleSheet,
  mirrorArticleUpdateToGoogleSheet,
  type GoogleSheetArticleSnapshot,
  type GoogleSheetSyncLinkSnapshot,
} from "@/lib/google-sheet-mutation";
import { resolveArticleCategory } from "@/lib/article-category";
import { publishRealtimeEvent } from "@/lib/realtime";
import { isApprovedArticleStatusFilterValue } from "@/lib/article-status";
import { writeAuditLog } from "@/lib/audit";
import { enforceTrustedOrigin } from "@/lib/request-security";
import { handleServerError } from "@/lib/server-error";
import { and, desc, eq, ilike, inArray, like, or, sql, type SQL } from "drizzle-orm";
import { after, NextRequest, NextResponse } from "next/server";

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

type ArticleDeleteSyncTarget = {
  article: GoogleSheetArticleSnapshot & {
    createdByUserId: number | null;
  };
  syncLink: GoogleSheetSyncLinkSnapshot | null;
};

type ArticleResponseRow = {
  id: number;
  articleId: string | null;
  date: string;
  title: string;
  penName: string;
  createdByUserId: number | null;
  updatedAt: string;
  category: string;
  articleType: string;
  contentType: string;
  wordCountRange: string | null;
  status: string;
  link: string | null;
  reviewLink: string | null;
  reviewerName: string | null;
  notes: string | null;
  canDelete: boolean;
  commentCount: number;
  unreadCommentCount: number;
};

type NonBlockingStepOptions<T> = {
  scope: string;
  fallback: T;
};

import { foldSearchText, matchesLooseSearch, normalizeString } from "@/lib/normalize";

async function runNonBlockingStep<T>(task: () => Promise<T>, options: NonBlockingStepOptions<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    console.error(`[${options.scope}]`, error);
    return options.fallback;
  }
}

function scheduleBackgroundWork(task: () => Promise<void>) {
  after(async () => {
    try {
      await task();
    } catch (error) {
      console.error("[articles.background]", error);
    }
  });
}

async function loadArticleResponseRow(articleId: number, currentUserId: number, canManageArticles: boolean): Promise<ArticleResponseRow | null> {
  const row = await db
    .select({
      id: articles.id,
      articleId: articles.articleId,
      date: articles.date,
      title: articles.title,
      penName: articles.penName,
      createdByUserId: articles.createdByUserId,
      updatedAt: articles.updatedAt,
      category: articles.category,
      articleType: articles.articleType,
      contentType: articles.contentType,
      wordCountRange: articles.wordCountRange,
      status: articles.status,
      link: articles.link,
      reviewLink: articles.reviewLink,
      reviewerName: articles.reviewerName,
      notes: articles.notes,
    })
    .from(articles)
    .where(eq(articles.id, articleId))
    .get();

  if (!row) return null;

  const [article] = await attachArticleResponseMetadata([row], currentUserId, canManageArticles);
  return article ?? null;
}

async function loadArticleCommentMetadata(articleIds: number[], currentUserId: number) {
  if (articleIds.length === 0) {
    return {
      commentCounts: new Map<number, number>(),
      unreadCommentCounts: new Map<number, number>(),
    };
  }

  const [commentRows, unreadRows] = await Promise.all([
    db
      .select({
        articleId: articleComments.articleId,
        count: sql<number>`count(*)`,
      })
      .from(articleComments)
      .where(inArray(articleComments.articleId, articleIds))
      .groupBy(articleComments.articleId)
      .all(),
    db
      .select({
        articleId: notifications.relatedArticleId,
        count: sql<number>`count(*)`,
      })
      .from(notifications)
      .where(
        and(
          inArray(notifications.relatedArticleId, articleIds),
          eq(notifications.toUserId, currentUserId),
          eq(notifications.type, "comment"),
          eq(notifications.isRead, false)
        )
      )
      .groupBy(notifications.relatedArticleId)
      .all(),
  ]);

  return {
    commentCounts: new Map(commentRows.map((row) => [Number(row.articleId), Number(row.count || 0)])),
    unreadCommentCounts: new Map(unreadRows.map((row) => [Number(row.articleId || 0), Number(row.count || 0)])),
  };
}

async function attachArticleResponseMetadata<
  T extends {
    id: number;
    createdByUserId: number | null;
  },
>(
  rows: T[],
  currentUserId: number,
  canManageArticles: boolean
): Promise<Array<T & Pick<ArticleResponseRow, "canDelete" | "commentCount" | "unreadCommentCount">>> {
  const articleIds = rows.map((row) => row.id).filter((id) => Number.isInteger(id) && id > 0);
  const { commentCounts, unreadCommentCounts } = await loadArticleCommentMetadata(articleIds, currentUserId);

  return rows.map((row) => ({
    ...row,
    canDelete: canManageArticles || row.createdByUserId === currentUserId,
    commentCount: commentCounts.get(row.id) || 0,
    unreadCommentCount: unreadCommentCounts.get(row.id) || 0,
  }));
}

async function notifyGoogleSheetSyncIssue(userId: number, message: string) {
  await runNonBlockingStep(
    () =>
      publishRealtimeEvent({
        channels: ["articles"],
        userIds: [userId],
        toastTitle: "Google Sheet chưa kịp đồng bộ",
        toastMessage: message,
        toastVariant: "warning",
      }),
    { scope: "articles.background.sheetSyncToast", fallback: null }
  );
}

async function loadArticleDeleteSyncTargets(articleIds: number[]): Promise<ArticleDeleteSyncTarget[]> {
  if (articleIds.length === 0) {
    return [];
  }

  const targetArticles = await db
    .select({
      id: articles.id,
      articleId: articles.articleId,
      title: articles.title,
      penName: articles.penName,
      date: articles.date,
      status: articles.status,
      reviewerName: articles.reviewerName,
      notes: articles.notes,
      link: articles.link,
      reviewLink: articles.reviewLink,
      articleType: articles.articleType,
      contentType: articles.contentType,
      wordCountRange: articles.wordCountRange,
      createdByUserId: articles.createdByUserId,
    })
    .from(articles)
    .where(inArray(articles.id, articleIds))
    .all();

  const latestSyncLinks = await db
    .select({
      id: articleSyncLinks.id,
      articleIdRef: articleSyncLinks.articleIdRef,
      sourceUrl: articleSyncLinks.sourceUrl,
      sheetName: articleSyncLinks.sheetName,
      sheetMonth: articleSyncLinks.sheetMonth,
      sheetYear: articleSyncLinks.sheetYear,
      sourceRowKey: articleSyncLinks.sourceRowKey,
    })
    .from(articleSyncLinks)
    .where(inArray(articleSyncLinks.articleIdRef, articleIds))
    .orderBy(desc(articleSyncLinks.updatedAt), desc(articleSyncLinks.id))
    .all();

  const syncLinksByArticleId = new Map<number, GoogleSheetSyncLinkSnapshot>();
  for (const syncLink of latestSyncLinks) {
    const articleId = Number(syncLink.articleIdRef || 0);
    if (!Number.isInteger(articleId) || articleId <= 0 || syncLinksByArticleId.has(articleId)) {
      continue;
    }

    syncLinksByArticleId.set(articleId, {
      id: syncLink.id,
      sourceUrl: syncLink.sourceUrl,
      sheetName: syncLink.sheetName,
      sheetMonth: syncLink.sheetMonth,
      sheetYear: syncLink.sheetYear,
      sourceRowKey: syncLink.sourceRowKey,
    });
  }

  return targetArticles.map((article) => ({
    article,
    syncLink: syncLinksByArticleId.get(article.id) ?? null,
  }));
}

async function ensureGoogleSheetDeleteConsistency(
  targets: ArticleDeleteSyncTarget[],
  actorUserId: number,
  actorDisplayName: string,
  reason: string
) {
  const warnings: string[] = [];

  for (const target of targets) {
    try {
      const result = await mirrorArticleDeleteToGoogleSheet({
        articleId: target.article.id,
        actorUserId,
        actorDisplayName,
        reason,
        snapshot: target.article,
        syncLink: target.syncLink,
      });

      if (!result.success && !result.skipped) {
        warnings.push(`${target.article.title}: ${result.message}`);
      }
    } catch {
      warnings.push(`${target.article.title}: Lỗi kết nối Google Sheet`);
    }
  }

  return warnings;
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

async function findMatchingCollaboratorPenNames(search: string) {
  const foldedSearch = foldSearchText(search);
  if (!foldedSearch) {
    return [] as string[];
  }

  const rawSearch = normalizeString(search);
  const searchTerms = Array.from(
    new Set(
      [rawSearch, ...rawSearch.split(/\s+/)]
        .map((term) => normalizeString(term))
        .filter((term) => term.length >= 2)
    )
  );

  const collaboratorSearchClauses = searchTerms.flatMap((term) => ([
    ilike(collaborators.name, `%${term}%`),
    ilike(collaborators.penName, `%${term}%`),
    ilike(collaborators.email, `%${term}%`),
  ]));

  const narrowedRows = collaboratorSearchClauses.length > 0
    ? await db
      .select({
        name: collaborators.name,
        penName: collaborators.penName,
        email: collaborators.email,
      })
      .from(collaborators)
      .where(or(...collaboratorSearchClauses))
      .limit(80)
      .all()
    : [];

  const rows = narrowedRows.length > 0 ? narrowedRows : await db
    .select({
      name: collaborators.name,
      penName: collaborators.penName,
      email: collaborators.email,
    })
    .from(collaborators)
    .all();

  return Array.from(
    new Set(
      rows
        .filter((row) => (
          matchesLooseSearch(row.name, foldedSearch)
          || matchesLooseSearch(row.penName, foldedSearch)
          || matchesLooseSearch(row.email, foldedSearch)
        ))
        .map((row) => normalizeString(row.penName))
        .filter(Boolean)
    )
  );
}

function hasCriteria(criteria: ArticleCriteria): boolean {
  return Object.values(criteria).some((value) => value !== "");
}

function buildArticleWhere(criteria: ArticleCriteria, isAdmin: boolean, matchedSearchPenNames: string[] = []): SQL | undefined {
  const conditions: SQL[] = [];

  if (isAdmin && criteria.penName) {
    conditions.push(eq(articles.penName, criteria.penName));
  }

  if (criteria.search) {
    const searchClauses: SQL[] = [
      ilike(articles.title, `%${criteria.search}%`),
      ilike(articles.articleId, `%${criteria.search}%`),
      ilike(articles.penName, `%${criteria.search}%`),
      ilike(articles.notes, `%${criteria.search}%`),
      ilike(articles.reviewerName, `%${criteria.search}%`),
    ];

    if (matchedSearchPenNames.length === 1) {
      searchClauses.push(eq(articles.penName, matchedSearchPenNames[0] as never));
    } else if (matchedSearchPenNames.length > 1) {
      searchClauses.push(inArray(articles.penName, matchedSearchPenNames as never[]));
    }

    const searchCondition = or(...searchClauses);

    if (searchCondition) {
      conditions.push(searchCondition);
    }
  }

  if (criteria.titleQuery) {
    conditions.push(ilike(articles.title, `%${criteria.titleQuery}%`));
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

function combineWhereClauses(...clauses: Array<SQL | undefined>) {
  const filteredClauses = clauses.filter(Boolean) as SQL[];
  return filteredClauses.length > 0 ? and(...filteredClauses) : undefined;
}

function buildArticleOwnershipWhere(ownerCandidates: string[]): SQL | undefined {
  const normalizedCandidates = Array.from(new Set(ownerCandidates.map((value) => normalizeString(value)).filter(Boolean)));
  if (normalizedCandidates.length === 0) {
    return undefined;
  }

  if (normalizedCandidates.length === 1) {
    return eq(articles.penName, normalizedCandidates[0] as never);
  }

  return inArray(articles.penName, normalizedCandidates as never[]);
}

function buildArticleReviewerWhere(identityLabels: string[]): SQL | undefined {
  const normalizedLabels = Array.from(new Set(identityLabels.map((value) => normalizeString(value)).filter(Boolean)));
  if (normalizedLabels.length === 0) {
    return undefined;
  }

  const reviewerConditions = normalizedLabels.map((value) => sql`lower(${articles.reviewerName}) = lower(${value})`);
  if (reviewerConditions.length === 1) {
    return reviewerConditions[0];
  }

  return or(...reviewerConditions);
}

function buildArticleReviewScopeWhere(identityLabels: string[]): SQL {
  const reviewerWhere = buildArticleReviewerWhere(identityLabels);
  const submittedWhere = eq(articles.status, "Submitted");
  return reviewerWhere ? or(submittedWhere, reviewerWhere)! : submittedWhere;
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

  const affectedPaymentWhere = buildAffectedPaymentWhere(targetRows);
  const [commentsRow, reviewsRow, notificationsRow, paymentsRow] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(articleComments)
      .where(inArray(articleComments.articleId, targetIds))
      .get(),
    db
      .select({ count: sql<number>`count(*)` })
      .from(articleReviews)
      .where(inArray(articleReviews.articleId, targetIds))
      .get(),
    db
      .select({ count: sql<number>`count(*)` })
      .from(notifications)
      .where(inArray(notifications.relatedArticleId, targetIds))
      .get(),
    affectedPaymentWhere
      ? db
        .select({ count: sql<number>`count(*)` })
        .from(payments)
        .where(affectedPaymentWhere)
        .get()
      : Promise.resolve(undefined),
  ]);

  const commentsCount = Number(commentsRow?.count || 0);
  const reviewsCount = Number(reviewsRow?.count || 0);
  const notificationsCount = Number(notificationsRow?.count || 0);
  const paymentsCount = Number(paymentsRow?.count || 0);

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
    const canManageArticles = hasArticleManagerAccess(context);
    const canReviewArticles = hasArticleReviewAccess(context);
    const matchedSearchPenNames = await findMatchingCollaboratorPenNames(criteria.search);
    const whereClause = buildArticleWhere(criteria, canManageArticles, matchedSearchPenNames);

    if (mode === "delete-preview") {
      if (!canManageArticles) {
        return NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 });
      }

      const preview = await getDeletePreview(whereClause);
      return NextResponse.json({ success: true, ...preview });
    }

    const page = Math.max(parseInt(searchParams.get("page") || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "50", 10), 1), 200);
    const ownerCandidates = getContextArticleOwnerCandidates(context);
    const reviewerLabels = getContextIdentityLabels(context);

    if (!canManageArticles && !canReviewArticles && ownerCandidates.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
        pagination: { page, limit, total: 0, totalPages: 0 },
      });
    }

    const scopedWhereClause = canManageArticles
      ? whereClause
      : canReviewArticles
        ? combineWhereClauses(whereClause, buildArticleReviewScopeWhere(reviewerLabels))
        : combineWhereClauses(whereClause, buildArticleOwnershipWhere(ownerCandidates));

    const [{ count: totalCount }, pagedRows] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)` })
        .from(articles)
        .where(scopedWhereClause)
        .get()
        .then((row) => ({ count: Number(row?.count || 0) })),
      db
        .select()
        .from(articles)
        .where(scopedWhereClause)
        .orderBy(desc(articles.date), desc(articles.updatedAt), desc(articles.id))
        .limit(limit)
        .offset((page - 1) * limit)
        .all(),
    ]);

    const data = await attachArticleResponseMetadata(pagedRows, context.user.id, canManageArticles);

    return NextResponse.json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limit),
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
    const canManageArticles = hasArticleManagerAccess(context);
    const finalPenName = canManageArticles ? normalizeString(body.penName) : ownPenName || "";
    const title = normalizeString(body.title);
    const date = normalizeString(body.date);
    const normalizedArticleType = normalizeString(body.articleType) || "Bài SEO ICT";
    const normalizedCategory = resolveArticleCategory(normalizeString(body.category), normalizedArticleType);

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
        category: normalizedCategory as never,
        articleType: normalizedArticleType as never,
        contentType: (normalizeString(body.contentType) || "Viết mới") as never,
        wordCountRange: (normalizeString(body.wordCountRange) || undefined) as never,
        status: (normalizeString(body.status) || "Submitted") as never,
        link: normalizeString(body.link) || undefined,
        reviewLink: normalizeString(body.reviewLink) || undefined,
        reviewerName: normalizeString(body.reviewerName) || undefined,
        notes: normalizeString(body.notes) || undefined,
      })
      .returning({ id: articles.id })
      .get();

    const createdArticleId = Number(insertedArticle?.id);
    if (createdArticleId > 0) {
      scheduleBackgroundWork(async () => {
        await runNonBlockingStep(
          () => writeAuditLog({
            userId: context.user.id,
            action: "article_created",
            entity: "article",
            entityId: String(createdArticleId),
            payload: { title, penName: finalPenName },
          }),
          { scope: "articles.post.audit", fallback: undefined }
        );

        const sheetSyncResult = await runNonBlockingStep(
          () => createArticleInGoogleSheet({
            articleId: createdArticleId,
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
        );

        if (sheetSyncResult && (sheetSyncResult.skipped || !sheetSyncResult.success)) {
          await notifyGoogleSheetSyncIssue(context.user.id, sheetSyncResult.message);
        }

        await runNonBlockingStep(
          () => publishRealtimeEvent(["articles", "dashboard", "royalty"]),
          { scope: "articles.post.realtime", fallback: null }
        );
      });
    }

    const article = createdArticleId > 0
      ? await loadArticleResponseRow(createdArticleId, context.user.id, canManageArticles)
      : null;

    return NextResponse.json({
      success: true,
      id: createdArticleId,
      backgroundSyncQueued: createdArticleId > 0,
      article,
    });
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

    const canManageArticles = hasArticleManagerAccess(context);
    if (!canManageArticles) {
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

    if (!canManageArticles) {
      delete updateData.penName;
      delete updateData.reviewerName;
      delete updateData.createdByUserId;
    }

    if (typeof updateData.title === "string") updateData.title = updateData.title.trim();
    if (typeof updateData.articleId === "string") updateData.articleId = updateData.articleId.trim() || undefined;
    if (typeof updateData.link === "string") updateData.link = updateData.link.trim() || undefined;
    if (typeof updateData.reviewLink === "string") updateData.reviewLink = updateData.reviewLink.trim() || undefined;
    if (typeof updateData.notes === "string") updateData.notes = updateData.notes.trim() || undefined;
    if (typeof updateData.reviewerName === "string") updateData.reviewerName = updateData.reviewerName.trim() || undefined;
    if (typeof updateData.penName === "string") updateData.penName = updateData.penName.trim();
    if (typeof updateData.date === "string") updateData.date = updateData.date.trim();
    if (Object.prototype.hasOwnProperty.call(body, "category") || Object.prototype.hasOwnProperty.call(body, "articleType")) {
      updateData.category = resolveArticleCategory(updateData.category, updateData.articleType ?? existing.articleType) as never;
    }
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

    scheduleBackgroundWork(async () => {
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

      if (shouldMirrorToGoogleSheet) {
        const sheetSyncResult = await runNonBlockingStep(
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
        );

        if (sheetSyncResult && (sheetSyncResult.skipped || !sheetSyncResult.success)) {
          await notifyGoogleSheetSyncIssue(context.user.id, sheetSyncResult.message);
        }
      }

      await runNonBlockingStep(
        () => publishRealtimeEvent(["articles", "dashboard", "royalty"]),
        { scope: "articles.put.realtime", fallback: null }
      );
    });

    const article = await loadArticleResponseRow(id, context.user.id, canManageArticles);

    return NextResponse.json({ success: true, backgroundSyncQueued: true, article });
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
    const canManageArticles = hasArticleManagerAccess(context);
    const actorDisplayName = getContextDisplayName(context) || context.user.email;

    if (id) {
      const articleId = parseInt(id, 10);
      const [deleteTarget] = await loadArticleDeleteSyncTargets([articleId]);

      if (!deleteTarget) {
        return NextResponse.json({ success: false, error: "Article not found" }, { status: 404 });
      }

      const existing = deleteTarget.article;

      if (!canManageArticles) {
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

      const sheetSyncWarnings = await ensureGoogleSheetDeleteConsistency(
        [deleteTarget],
        context.user.id,
        actorDisplayName,
        "article_delete"
      );

      const deleted = await deleteArticlesByIds([articleId]);
      scheduleBackgroundWork(async () => {
        await runNonBlockingStep(
          () =>
            writeAuditLog({
              userId: context.user.id,
              action: "article_deleted",
              entity: "article",
              entityId: articleId,
              payload: {
                title: existing.title,
                penName: existing.penName,
                date: existing.date,
                sheetSyncWarnings,
                ...deleted,
              },
            }),
          { scope: "articles.delete.audit.single", fallback: null }
        );

        await runNonBlockingStep(
          () => publishRealtimeEvent(["articles", "dashboard", "royalty", "notifications"]),
          { scope: "articles.delete.realtime.single", fallback: null }
        );
      });

      return NextResponse.json({ success: true, deletedCount: deleted.deletedArticles, sheetSyncWarnings, ...deleted });
    }

    if (!canManageArticles) {
      return NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = normalizeString(body.action) || "preview";
    const scope = (normalizeString(body.scope) || "custom") as DeleteScope;
    const criteria = readCriteriaFromBody(body);
    const matchedSearchPenNames = await findMatchingCollaboratorPenNames(criteria.search);

    if (scope !== "all" && !hasCriteria(criteria)) {
      return NextResponse.json(
        { success: false, error: "Chưa chọn tiêu chí xóa. Hãy dùng bộ lọc hoặc chọn chế độ xóa toàn bộ." },
        { status: 400 }
      );
    }

    const whereClause = scope === "all" ? undefined : buildArticleWhere(criteria, true, matchedSearchPenNames);
    const preview = await getDeletePreview(whereClause);

    if (action === "preview") {
      return NextResponse.json({ success: true, scope, criteria, ...preview });
    }

    const deleteTargets = await loadArticleDeleteSyncTargets(preview.articleIds);
    if (deleteTargets.length !== preview.articleIds.length) {
      return NextResponse.json(
        {
          success: false,
          error: "Một số bài viết đã thay đổi trong lúc xử lý. Hãy tải lại danh sách và thử xóa lại.",
        },
        { status: 409 }
      );
    }

    const sheetSyncWarnings = await ensureGoogleSheetDeleteConsistency(
      deleteTargets,
      context.user.id,
      actorDisplayName,
      "articles_bulk_delete"
    );

    const deleted = await deleteArticlesByIds(deleteTargets.map((target) => target.article.id));
    scheduleBackgroundWork(async () => {
      await runNonBlockingStep(
        () =>
          writeAuditLog({
            userId: context.user.id,
            action: "articles_bulk_deleted",
            entity: "article",
            payload: {
              scope,
              criteria,
              deletedCount: deleted.deletedArticles,
              sheetSyncWarnings,
              ...deleted,
            },
          }),
        { scope: "articles.delete.audit.bulk", fallback: null }
      );

      await runNonBlockingStep(
        () => publishRealtimeEvent(["articles", "dashboard", "royalty", "notifications"]),
        { scope: "articles.delete.realtime.bulk", fallback: null }
      );
    });

    return NextResponse.json({
      success: true,
      scope,
      criteria,
      deletedCount: deleted.deletedArticles,
      sheetSyncWarnings,
      ...deleted,
    });
  } catch (error) {
    return handleServerError("articles.delete", error);
  }
}
