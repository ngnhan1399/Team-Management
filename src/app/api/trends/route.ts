import { db, ensureDatabaseInitialized } from "@/db";
import { articles } from "@/db/schema";
import { getContextArticleOwnerCandidates, getCurrentUserContext } from "@/lib/auth";
import { buildTrendRadarResponse } from "@/lib/trend-radar";
import { handleServerError } from "@/lib/server-error";
import { getContextTeamId, isLeader } from "@/lib/teams";
import { desc, eq, inArray, type SQL } from "drizzle-orm";
import { NextResponse } from "next/server";

const TREND_RESPONSE_CACHE_TTL_MS = 20 * 60 * 1000;
const trendResponseCache = new Map<string, { expiresAt: number; data: unknown }>();

function buildArticleOwnershipWhere(ownerCandidates: string[]): SQL | undefined {
  const normalizedCandidates = Array.from(new Set(ownerCandidates.map((value) => String(value || "").trim()).filter(Boolean)));
  if (normalizedCandidates.length === 0) {
    return undefined;
  }

  if (normalizedCandidates.length === 1) {
    return eq(articles.penName, normalizedCandidates[0] as never);
  }

  return inArray(articles.penName, normalizedCandidates as never[]);
}

function getCachedTrendResponse(cacheKey: string) {
  const cached = trendResponseCache.get(cacheKey);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt <= Date.now()) {
    trendResponseCache.delete(cacheKey);
    return null;
  }
  return cached.data;
}

export async function GET() {
  try {
    await ensureDatabaseInitialized();
    const context = await getCurrentUserContext();
    if (!context) {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    }

    const isAdmin = context.user.role === "admin";
    const ownerCandidates = getContextArticleOwnerCandidates(context);
    const adminTeamId = isAdmin && !isLeader(context) ? getContextTeamId(context) : null;
    const cacheKey = isAdmin
      ? `admin:${adminTeamId || "leader"}`
      : `ctv:${context.user.id}:${context.collaborator?.id || 0}:${ownerCandidates.join("|")}`;

    const cached = getCachedTrendResponse(cacheKey);
    if (cached) {
      return NextResponse.json({ success: true, data: cached });
    }

    if (!isAdmin && ownerCandidates.length === 0) {
      const empty = await buildTrendRadarResponse([]);
      trendResponseCache.set(cacheKey, {
        expiresAt: Date.now() + TREND_RESPONSE_CACHE_TTL_MS,
        data: empty,
      });
      return NextResponse.json({ success: true, data: empty });
    }

    const whereClause = isAdmin
      ? adminTeamId ? eq(articles.teamId, adminTeamId) : undefined
      : buildArticleOwnershipWhere(ownerCandidates);

    const baseQuery = db
      .select({
        id: articles.id,
        title: articles.title,
        date: articles.date,
        status: articles.status,
        articleId: articles.articleId,
        link: articles.link,
        category: articles.category,
        articleType: articles.articleType,
      })
      .from(articles)
      .orderBy(desc(articles.id))
      .limit(1500);

    const accessibleArticles = await (whereClause ? baseQuery.where(whereClause) : baseQuery).all();

    const data = await buildTrendRadarResponse(accessibleArticles);
    trendResponseCache.set(cacheKey, {
      expiresAt: Date.now() + TREND_RESPONSE_CACHE_TTL_MS,
      data,
    });

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return handleServerError("trends.get", error);
  }
}
