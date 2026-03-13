import { db, ensureDatabaseInitialized } from "@/db";
import { articles, collaborators } from "@/db/schema";
import { resolveArticleCategory } from "@/lib/article-category";
import { getContextIdentityCandidates, getContextIdentityLabels, getCurrentUserContext, matchesIdentityCandidate } from "@/lib/auth";
import { handleServerError } from "@/lib/server-error";
import { getContextTeamId, isLeader } from "@/lib/teams";
import { desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { NextResponse } from "next/server";

type CollaboratorDirectoryItem = {
    id: number;
    teamId: number | null;
    name: string;
    penName: string;
    email: string | null;
};

type StatisticsArticleRow = {
  id: number;
  articleId: string | null;
  title: string;
  penName: string;
  articleType: string;
  contentType: string;
  status: string;
  category: string;
  date: string;
  createdAt: string | null;
  updatedAt: string | null;
};

type StatisticsCategoryRow = {
  category: string;
  articleType: string;
  count: number;
};

type StatisticsWriterCountRow = {
  penName: string;
  count: number;
};

const RECENT_ACTIVITY_WINDOW_DAYS = 21;
const RECENT_ACTIVITY_TAKE = 8;
const ACTIVE_DASHBOARD_STATUSES = new Set([
  "Submitted",
  "Reviewing",
  "Approved",
  "Published",
  "NeedsFix",
  "Rejected",
]);

function resolveCollaborator(articlePenName: string, directory: CollaboratorDirectoryItem[]) {
    const exact = directory.find((item) => item.penName === articlePenName);
    if (exact) return exact;

    return directory.find((item) =>
        matchesIdentityCandidate(
            [item.penName, item.name, item.email || ""],
            articlePenName
        )
    ) || null;
}

function getActivityTimestamp(article: { id: number; date: string; createdAt?: string | null; updatedAt?: string | null }) {
  const value = article.updatedAt || article.createdAt || article.date;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getArticleDateTimestamp(article: { date: string }) {
  const timestamp = new Date(`${article.date}T12:00:00`).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function groupCount<T extends string>(values: T[]) {
  return Object.entries(values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {})).map(([key, count]) => ({ key, count }));
}

function addScopeValue(target: Set<string>, value: string | null | undefined) {
  const normalized = String(value || "").trim();
  if (normalized) {
    target.add(normalized);
  }
}

function collectScopedCollaborators(
  allCollaborators: CollaboratorDirectoryItem[],
  identityCandidates: string[]
) {
  return allCollaborators.filter((item) => (
    matchesIdentityCandidate(identityCandidates, item.penName)
    || matchesIdentityCandidate(identityCandidates, item.name)
    || matchesIdentityCandidate(identityCandidates, item.email || "")
  ));
}

function buildArticleScopeValues(
  identityLabels: string[],
  scopedCollaborators: CollaboratorDirectoryItem[]
) {
  const values = new Set<string>();
  for (const label of identityLabels) {
    addScopeValue(values, label);
  }

  for (const collaborator of scopedCollaborators) {
    addScopeValue(values, collaborator.penName);
    addScopeValue(values, collaborator.name);
    addScopeValue(values, collaborator.email);
    if (collaborator.email) {
      addScopeValue(values, collaborator.email.split("@")[0]);
    }
  }

  return Array.from(values);
}

function buildArticleScopeWhere(scopeValues: string[]): SQL | undefined {
  if (scopeValues.length === 1) {
    return eq(articles.penName, scopeValues[0]);
  }

  if (scopeValues.length > 1) {
    return inArray(articles.penName, scopeValues);
  }

  return undefined;
}

async function loadStatisticsArticles(whereClause?: SQL) {
  const baseQuery = db
    .select({
      id: articles.id,
      articleId: articles.articleId,
      title: articles.title,
      penName: articles.penName,
      articleType: articles.articleType,
      contentType: articles.contentType,
      status: articles.status,
      category: articles.category,
      date: articles.date,
      createdAt: articles.createdAt,
      updatedAt: articles.updatedAt,
    })
    .from(articles);

  const query = whereClause ? baseQuery.where(whereClause) : baseQuery;
  return await query
    .orderBy(desc(articles.id))
    .all() as StatisticsArticleRow[];
}

function mapArticlesByCategory(rows: StatisticsCategoryRow[]) {
  const buckets = new Map<string, number>();
  for (const row of rows) {
    const category = resolveArticleCategory(row.category, row.articleType);
    buckets.set(category, (buckets.get(category) || 0) + Number(row.count || 0));
  }

  return Array.from(buckets.entries()).map(([category, count]) => ({ category, count }));
}

function mapArticlesByWriter(rows: StatisticsWriterCountRow[], collaboratorDirectory: CollaboratorDirectoryItem[]) {
  return rows
    .map((row) => {
      const resolvedCollaborator = resolveCollaborator(row.penName, collaboratorDirectory);
      return {
        penName: resolvedCollaborator?.penName || row.penName,
        displayName: resolvedCollaborator?.name || resolvedCollaborator?.penName || row.penName,
        count: Number(row.count || 0),
      };
    })
    .sort((left, right) => right.count - left.count || left.displayName.localeCompare(right.displayName, "vi"));
}

function selectRecentActivityArticles(rows: StatisticsArticleRow[]) {
  if (rows.length === 0) return [];

  const latestArticleDate = rows.reduce((latest, article) => Math.max(latest, getArticleDateTimestamp(article)), 0);
  const recentThreshold = latestArticleDate - (RECENT_ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const recentRows = rows.filter((article) => getArticleDateTimestamp(article) >= recentThreshold);
  const prioritizedRows = recentRows.filter((article) => (
    ACTIVE_DASHBOARD_STATUSES.has(article.status)
    || getActivityTimestamp(article) >= getArticleDateTimestamp(article)
  ));
  const feedRows = prioritizedRows.length > 0 ? prioritizedRows : recentRows;

  return feedRows
    .sort((left, right) => {
      const byDate = getArticleDateTimestamp(right) - getArticleDateTimestamp(left);
      if (byDate !== 0) return byDate;

      const byActivity = getActivityTimestamp(right) - getActivityTimestamp(left);
      if (byActivity !== 0) return byActivity;

      return right.id - left.id;
    })
    .slice(0, RECENT_ACTIVITY_TAKE);
}

function mapLatestArticles(rows: StatisticsArticleRow[], collaboratorDirectory: CollaboratorDirectoryItem[]) {
  return selectRecentActivityArticles(rows).map((article) => {
    const resolvedCollaborator = resolveCollaborator(article.penName, collaboratorDirectory);
    return {
      id: article.id,
      articleId: article.articleId,
      title: article.title,
      penName: resolvedCollaborator?.penName || article.penName,
      writerDisplayName: resolvedCollaborator?.name || article.penName,
      articleType: article.articleType,
      status: article.status,
      date: article.date,
      updatedAt: article.updatedAt || article.createdAt || article.date,
    };
  });
}

async function getScopedStatistics(
  whereClause: SQL,
  totalCTVCount: number,
  collaboratorDirectory: CollaboratorDirectoryItem[]
) {
  const [
    totalArticlesRow,
    statusRows,
    categoryRows,
    typeRows,
    monthRows,
    writerRows,
    latestArticlesRows,
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(articles).where(whereClause).get(),
    db.select({
      status: articles.status,
      count: sql<number>`count(*)`,
    }).from(articles).where(whereClause).groupBy(articles.status).all(),
    db.select({
      category: articles.category,
      articleType: articles.articleType,
      count: sql<number>`count(*)`,
    }).from(articles).where(whereClause).groupBy(articles.category, articles.articleType).all() as Promise<StatisticsCategoryRow[]>,
    db.select({
      articleType: articles.articleType,
      contentType: articles.contentType,
      count: sql<number>`count(*)`,
    }).from(articles).where(whereClause).groupBy(articles.articleType, articles.contentType).all(),
    db.select({
      date: articles.date,
      count: sql<number>`count(*)`,
    }).from(articles).where(whereClause).groupBy(articles.date).all(),
    db.select({
      penName: articles.penName,
      count: sql<number>`count(*)`,
    }).from(articles).where(whereClause).groupBy(articles.penName).all() as Promise<StatisticsWriterCountRow[]>,
    db.select({
      id: articles.id,
      articleId: articles.articleId,
      title: articles.title,
      penName: articles.penName,
      articleType: articles.articleType,
      contentType: articles.contentType,
      status: articles.status,
      category: articles.category,
      date: articles.date,
      createdAt: articles.createdAt,
      updatedAt: articles.updatedAt,
    }).from(articles).where(whereClause).orderBy(desc(articles.date), desc(articles.updatedAt), desc(articles.id)).limit(60).all() as Promise<StatisticsArticleRow[]>,
  ]);

  return {
    totalArticles: Number(totalArticlesRow?.count || 0),
    totalCTVs: totalCTVCount,
    articlesByStatus: statusRows.map((row) => ({ status: row.status, count: Number(row.count || 0) })),
    articlesByCategory: mapArticlesByCategory(categoryRows),
    articlesByWriter: mapArticlesByWriter(writerRows, collaboratorDirectory),
    articlesByType: typeRows.map((row) => ({
      articleType: row.articleType,
      contentType: row.contentType,
      count: Number(row.count || 0),
    })),
    articlesByMonth: monthRows.map((row) => ({ date: row.date, count: Number(row.count || 0) })),
    latestArticles: mapLatestArticles(latestArticlesRows, collaboratorDirectory),
  };
}

async function getAdminStatistics(allCollaborators: CollaboratorDirectoryItem[], articleWhere?: SQL, collaboratorWhere?: SQL) {
  const [
    totalArticlesRow,
    totalCTVRow,
    statusRows,
    categoryRows,
    typeRows,
    monthRows,
    writerRows,
    latestArticlesRows,
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(articles).where(articleWhere).get(),
    db.select({ count: sql<number>`count(*)` }).from(collaborators).where(collaboratorWhere).get(),
    db.select({
      status: articles.status,
      count: sql<number>`count(*)`,
    }).from(articles).where(articleWhere).groupBy(articles.status).all(),
    db.select({
      category: articles.category,
      articleType: articles.articleType,
      count: sql<number>`count(*)`,
    }).from(articles).where(articleWhere).groupBy(articles.category, articles.articleType).all() as Promise<StatisticsCategoryRow[]>,
    db.select({
      articleType: articles.articleType,
      contentType: articles.contentType,
      count: sql<number>`count(*)`,
    }).from(articles).where(articleWhere).groupBy(articles.articleType, articles.contentType).all(),
    db.select({
      date: articles.date,
      count: sql<number>`count(*)`,
    }).from(articles).where(articleWhere).groupBy(articles.date).all(),
    db.select({
      penName: articles.penName,
      count: sql<number>`count(*)`,
    }).from(articles).where(articleWhere).groupBy(articles.penName).all(),
    db.select({
      id: articles.id,
      articleId: articles.articleId,
      title: articles.title,
      penName: articles.penName,
      articleType: articles.articleType,
      status: articles.status,
      date: articles.date,
      createdAt: articles.createdAt,
      updatedAt: articles.updatedAt,
      contentType: articles.contentType,
      category: articles.category,
    }).from(articles).where(articleWhere).orderBy(desc(articles.date), desc(articles.updatedAt), desc(articles.id)).limit(60).all() as Promise<StatisticsArticleRow[]>,
  ]);

  return {
    totalArticles: Number(totalArticlesRow?.count || 0),
    totalCTVs: Number(totalCTVRow?.count || 0),
    articlesByStatus: statusRows.map((row) => ({ status: row.status, count: Number(row.count || 0) })),
    articlesByCategory: mapArticlesByCategory(categoryRows),
    articlesByWriter: mapArticlesByWriter(writerRows as StatisticsWriterCountRow[], allCollaborators),
    articlesByType: typeRows.map((row) => ({
      articleType: row.articleType,
      contentType: row.contentType,
      count: Number(row.count || 0),
    })),
    articlesByMonth: monthRows.map((row) => ({ date: row.date, count: Number(row.count || 0) })),
    latestArticles: mapLatestArticles(latestArticlesRows, allCollaborators),
  };
}

export async function GET() {
    try {
        await ensureDatabaseInitialized();
        const context = await getCurrentUserContext();
        if (!context) {
            return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
        }

        const identityCandidates = getContextIdentityCandidates(context);
        const identityLabels = getContextIdentityLabels(context);
        const adminTeamId = context.user.role === "admin" && !isLeader(context)
            ? getContextTeamId(context)
            : null;
        const allCollaborators = await db
            .select({
                id: collaborators.id,
                teamId: collaborators.teamId,
                name: collaborators.name,
                penName: collaborators.penName,
                email: collaborators.email,
            })
            .from(collaborators)
            .where(adminTeamId ? eq(collaborators.teamId, adminTeamId) : undefined)
            .all();
        if (context.user.role === "admin") {
            if (!isLeader(context) && !adminTeamId) {
                return NextResponse.json({
                    success: true,
                    data: {
                        totalArticles: 0,
                        totalCTVs: 0,
                        articlesByStatus: [],
                        articlesByCategory: [],
                        articlesByWriter: [],
                        articlesByType: [],
                        articlesByMonth: [],
                        latestArticles: [],
                    },
                });
            }

            return NextResponse.json({
                success: true,
                data: await getAdminStatistics(
                    allCollaborators,
                    adminTeamId ? eq(articles.teamId, adminTeamId) : undefined,
                    adminTeamId ? eq(collaborators.teamId, adminTeamId) : undefined
                ),
            });
        }

        if (identityCandidates.length === 0) {
            return NextResponse.json({
                success: true,
                data: {
                    totalArticles: 0,
                    totalCTVs: 0,
                    articlesByStatus: [],
                    articlesByCategory: [],
                    articlesByWriter: [],
                    articlesByType: [],
                    articlesByMonth: [],
                    latestArticles: [],
                },
            });
        }

        const scopedCollaborators = collectScopedCollaborators(allCollaborators, identityCandidates);
        const collaboratorDirectory = scopedCollaborators.length > 0 ? scopedCollaborators : allCollaborators;
        const articleScopeValues = buildArticleScopeValues(identityLabels, scopedCollaborators);
        const scopeWhere = buildArticleScopeWhere(articleScopeValues);
        const totalCTVCount = identityCandidates.length > 0 ? 1 : 0;

        if (scopeWhere) {
            const scopedStatistics = await getScopedStatistics(scopeWhere, totalCTVCount, collaboratorDirectory);
            if (scopedStatistics.totalArticles > 0) {
                return NextResponse.json({
                    success: true,
                    data: scopedStatistics,
                });
            }
        }

        const candidateWhere = identityCandidates.length === 1
            ? eq(articles.penName, identityCandidates[0])
            : identityCandidates.length > 1
                ? inArray(articles.penName, identityCandidates)
                : undefined;
        const allArticles = candidateWhere
            ? await loadStatisticsArticles(candidateWhere)
            : [];
        const scopedArticles = allArticles.filter((article) => matchesIdentityCandidate(identityCandidates, article.penName));
        const totalArticles = scopedArticles.length;

        const articlesByStatus = groupCount(scopedArticles.map((article) => article.status))
            .map(({ key, count }) => ({ status: key, count }));

        const articlesByCategory = groupCount(
            scopedArticles.map((article) => resolveArticleCategory(article.category, article.articleType))
        )
            .map(({ key, count }) => ({ category: key, count }));

        const writerBuckets = scopedArticles.reduce<Record<string, { penName: string; displayName: string; count: number }>>((acc, article) => {
            const resolvedCollaborator = resolveCollaborator(article.penName, collaboratorDirectory);
            const key = resolvedCollaborator ? `collab:${resolvedCollaborator.id}` : `pen:${article.penName}`;
            const displayName = resolvedCollaborator?.name || resolvedCollaborator?.penName || article.penName;
            const penName = resolvedCollaborator?.penName || article.penName;

            if (!acc[key]) {
                acc[key] = { penName, displayName, count: 0 };
            }

            acc[key].count += 1;
            return acc;
        }, {});

        const articlesByWriter = Object.values(writerBuckets)
            .sort((left, right) => right.count - left.count || left.displayName.localeCompare(right.displayName, "vi"));

        const articlesByType = groupCount(scopedArticles.map((article) => `${article.articleType}|||${article.contentType}`))
            .map(({ key, count }) => {
                const [articleType, contentType] = key.split("|||");
                return { articleType, contentType, count };
            });

        const articlesByMonth = groupCount(scopedArticles.map((article) => article.date))
            .map(({ key, count }) => ({ date: key, count }));

        const latestArticles = selectRecentActivityArticles(scopedArticles)
            .map((article) => ({
                id: article.id,
                articleId: article.articleId,
                title: article.title,
                penName: resolveCollaborator(article.penName, collaboratorDirectory)?.penName || article.penName,
                writerDisplayName: resolveCollaborator(article.penName, collaboratorDirectory)?.name || article.penName,
                articleType: article.articleType,
                status: article.status,
                date: article.date,
                updatedAt: article.updatedAt || article.createdAt || article.date,
            }));

        return NextResponse.json({
            success: true,
            data: {
                totalArticles,
                totalCTVs: totalCTVCount,
                articlesByStatus,
                articlesByCategory,
                articlesByWriter,
                articlesByType,
                articlesByMonth,
                latestArticles,
            },
        });
    } catch (error) {
        return handleServerError("statistics.get", error);
    }
}
