import { db, ensureDatabaseInitialized } from "@/db";
import { articles, auditLogs } from "@/db/schema";
import {
  getContextArticleOwnerCandidates,
  getContextIdentityCandidates,
  getCurrentUserContext,
  hasArticleManagerAccess,
  hasArticleReviewAccess,
  matchesIdentityCandidate,
} from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { extractArticleIdFromLink } from "@/lib/article-link-id";
import {
  LINK_CHECK_MANUAL_MAX_ITEMS,
  LINK_CHECK_SCHEDULED_LOOKBACK_DAYS,
  LINK_CHECK_SCHEDULED_MAX_ITEMS,
  type LinkHealthStatus,
  getLatestDueLinkCheckSlot,
} from "@/lib/link-health";
import { normalizeString } from "@/lib/normalize";
import { publishRealtimeEvent } from "@/lib/realtime";
import { canAccessTeam, getContextTeamId, isLeader } from "@/lib/teams";
import { and, asc, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

type LinkCheckRequestItem = {
  articleId: number;
  url: string;
};

type LinkCheckResultItem = {
  articleId: number;
  url: string;
  status: LinkHealthStatus;
  checkedAt: string;
  slotKey: string | null;
  reason?: string;
  finalUrl?: string;
};

type LinkCheckBody = {
  items?: unknown;
  urls?: unknown;
  trigger?: unknown;
  slotKey?: unknown;
  limit?: unknown;
};

type ArticleLinkRow = {
  id: number;
  teamId: number | null;
  penName: string;
  reviewerName: string | null;
  status: string;
  link: string | null;
  createdByUserId: number | null;
  date: string;
  updatedAt: string;
  linkHealthCheckedAt: string | null;
};

type CheckedLinkStatus = {
  url: string;
  finalUrl: string;
  status: LinkHealthStatus;
  reason?: string;
};

const HTML_SNIFF_LIMIT_BYTES = 32 * 1024;
const LINK_CHECK_CONCURRENCY = 8;
const LINK_CHECK_TIMEOUT_MS = 10_000;
const GENERIC_SOFT_404_PATTERNS = [
  ["page not found"],
  ["404 page"],
  ["404 not found"],
  ["trang khong ton tai"],
  ["khong tim thay trang"],
  ["trang nay khong ton tai"],
  ["duong dan khong ton tai"],
  ["not found", "go to homepage"],
] as const;
const HOST_SOFT_404_PATTERNS = [
  {
    hostnamePattern: /(^|\.)fptshop\.com\.vn$/i,
    patterns: [
      ["duong dan da het han truy cap hoac khong ton tai"],
      ["trang het han truy cap hoac khong ton tai"],
    ] as const,
  },
] as const;

function foldForPattern(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeLinkCandidate(value: unknown) {
  const normalized = normalizeString(value);
  if (!normalized || !/^https?:\/\//i.test(normalized)) {
    return "";
  }
  return normalized;
}

function parseRequestItems(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const articleId = Number((item as { articleId?: unknown }).articleId);
      const url = normalizeLinkCandidate((item as { url?: unknown }).url);
      if (!Number.isFinite(articleId) || articleId <= 0 || !url) return null;
      return { articleId, url };
    })
    .filter((item): item is LinkCheckRequestItem => Boolean(item));
}

function parseLegacyUrls(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((entry) => normalizeLinkCandidate(entry)).filter(Boolean)));
}

function detectSoft404Reason(hostname: string, html: string) {
  const foldedHtml = foldForPattern(html);
  if (!foldedHtml) return null;

  const genericPattern = GENERIC_SOFT_404_PATTERNS.find((pattern) => pattern.every((token) => foldedHtml.includes(token)));
  if (genericPattern) {
    return `soft404:generic:${genericPattern.join("+")}`;
  }

  const hostPatterns = HOST_SOFT_404_PATTERNS.find((entry) => entry.hostnamePattern.test(hostname));
  const hostPattern = hostPatterns?.patterns.find((pattern) => pattern.every((token) => foldedHtml.includes(token)));
  return hostPattern ? `soft404:host:${hostPattern.join("+")}` : null;
}

function isSameHostname(originalUrl: string, finalUrl: string) {
  try {
    return new URL(originalUrl).hostname === new URL(finalUrl).hostname;
  } catch {
    return false;
  }
}

function isRedirectedArticleIdMismatch(originalUrl: string, finalUrl: string) {
  const originalId = extractArticleIdFromLink(originalUrl);
  if (!originalId || !isSameHostname(originalUrl, finalUrl)) {
    return false;
  }

  const finalId = extractArticleIdFromLink(finalUrl);
  return !finalId || finalId !== originalId;
}

async function readResponseSnippet(response: Response) {
  const text = await response.text();
  return text.slice(0, HTML_SNIFF_LIMIT_BYTES);
}

async function fetchWithTimeout(url: string, init: RequestInit) {
  return fetch(url, {
    ...init,
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(LINK_CHECK_TIMEOUT_MS),
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent": "Workdocker Link Health Bot/1.0",
      ...(init.headers || {}),
    },
  });
}

async function checkLinkStatus(url: string): Promise<CheckedLinkStatus> {
  try {
    const headResponse = await fetchWithTimeout(url, { method: "HEAD" }).catch(() => null);
    const headFinalUrl = headResponse?.url || url;
    const headLooksHealthy = Boolean(headResponse?.ok && !isRedirectedArticleIdMismatch(url, headFinalUrl));

    if (headResponse && headResponse.status >= 400 && headResponse.status !== 403 && headResponse.status !== 405) {
      return { url, finalUrl: headFinalUrl, status: "broken", reason: `head:${headResponse.status}` };
    }

    if (isRedirectedArticleIdMismatch(url, headFinalUrl)) {
      return { url, finalUrl: headFinalUrl, status: "broken", reason: "redirect-id-mismatch:head" };
    }

    const headContentType = headResponse?.headers.get("content-type") || "";
    if (headResponse?.ok && headContentType && !/text\/html|application\/xhtml\+xml/i.test(headContentType)) {
      return { url, finalUrl: headFinalUrl, status: "ok" };
    }

    const getResponse = await fetchWithTimeout(url, { method: "GET" });
    const finalUrl = getResponse.url || headFinalUrl || url;
    if (!getResponse.ok && headLooksHealthy && (getResponse.status === 403 || getResponse.status === 429)) {
      return {
        url,
        finalUrl,
        status: "ok",
        reason: `head-ok:get-blocked:${getResponse.status}`,
      };
    }

    if (!getResponse.ok || isRedirectedArticleIdMismatch(url, finalUrl)) {
      return {
        url,
        finalUrl,
        status: "broken",
        reason: !getResponse.ok ? `get:${getResponse.status}` : "redirect-id-mismatch:get",
      };
    }

    const contentType = getResponse.headers.get("content-type") || "";
    if (/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      const snippet = await readResponseSnippet(getResponse);
      const hostname = (() => {
        try {
          return new URL(finalUrl).hostname;
        } catch {
          return "";
        }
      })();
      const soft404Reason = detectSoft404Reason(hostname, snippet);
      if (soft404Reason) {
        return { url, finalUrl, status: "broken", reason: soft404Reason };
      }
    }

    return { url, finalUrl, status: "ok", reason: "ok" };
  } catch {
    return { url, finalUrl: url, status: "unknown", reason: "exception" };
  }
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  });

  await Promise.all(workers);
  return results;
}

function foldStatus(value: unknown) {
  return foldForPattern(value).replace(/đ/g, "d");
}

function canAccessArticleForManualCheck(
  row: ArticleLinkRow,
  context: Awaited<ReturnType<typeof getCurrentUserContext>>,
) {
  if (!context) return false;

  if (hasArticleManagerAccess(context)) {
    return isLeader(context) || canAccessTeam(context, row.teamId);
  }

  if (hasArticleReviewAccess(context)) {
    const identityCandidates = getContextIdentityCandidates(context);
    const reviewStatus = foldStatus(row.status);
    const canClaimByStatus = reviewStatus.includes("cho duyet")
      || reviewStatus.includes("dang duyet")
      || reviewStatus.includes("submitted");
    return canAccessTeam(context, row.teamId)
      && (matchesIdentityCandidate(identityCandidates, row.reviewerName) || canClaimByStatus);
  }

  const ownerCandidates = getContextArticleOwnerCandidates(context);
  return row.createdByUserId === context.user.id || matchesIdentityCandidate(ownerCandidates, row.penName);
}

async function persistLinkHealth(rows: ArticleLinkRow[], statusMap: Map<number, CheckedLinkStatus>, slotKey: string | null) {
  const checkedAt = new Date().toISOString();
  const results: LinkCheckResultItem[] = [];

  for (const row of rows) {
    const checkedStatus = statusMap.get(row.id);
    if (!checkedStatus) continue;

    await db
      .update(articles)
      .set({
        linkHealthStatus: checkedStatus.status,
        linkHealthCheckedAt: checkedAt,
        linkHealthCheckSlot: slotKey,
      })
      .where(eq(articles.id, row.id))
      .run();

    results.push({
      articleId: row.id,
      url: row.link || checkedStatus.url,
      status: checkedStatus.status,
      checkedAt,
      slotKey,
      reason: checkedStatus.reason,
      finalUrl: checkedStatus.finalUrl,
    });
  }

  return results;
}

async function runPersistedChecks(rows: ArticleLinkRow[], slotKey: string | null) {
  const checkedStatuses = await mapWithConcurrency(rows, LINK_CHECK_CONCURRENCY, async (row) => ({
    articleId: row.id,
    checked: await checkLinkStatus(row.link || ""),
  }));

  const statusMap = new Map<number, CheckedLinkStatus>();
  for (const entry of checkedStatuses) {
    statusMap.set(entry.articleId, entry.checked);
  }

  const items = await persistLinkHealth(rows, statusMap, slotKey);
  const results = Object.fromEntries(items.map((item) => [item.url, item.status]));
  return { items, results };
}

async function selectArticleRowsByIds(articleIds: number[]) {
  if (articleIds.length === 0) return [];

  return db
    .select({
      id: articles.id,
      teamId: articles.teamId,
      penName: articles.penName,
      reviewerName: articles.reviewerName,
      status: articles.status,
      link: articles.link,
      createdByUserId: articles.createdByUserId,
      date: articles.date,
      updatedAt: articles.updatedAt,
      linkHealthCheckedAt: articles.linkHealthCheckedAt,
    })
    .from(articles)
    .where(inArray(articles.id, articleIds))
    .all();
}

async function loadManualScopeRows(requestItems: LinkCheckRequestItem[], context: NonNullable<Awaited<ReturnType<typeof getCurrentUserContext>>>) {
  const articleIds = Array.from(new Set(requestItems.map((item) => item.articleId)));
  const rows = await selectArticleRowsByIds(articleIds);
  return rows
    .filter((row) => normalizeLinkCandidate(row.link))
    .filter((row) => canAccessArticleForManualCheck(row, context));
}

async function loadScheduledRows(limit: number) {
  const lookbackDate = new Date();
  lookbackDate.setDate(lookbackDate.getDate() - LINK_CHECK_SCHEDULED_LOOKBACK_DAYS);
  const lookbackDateKey = lookbackDate.toISOString().slice(0, 10);
  const lookbackIso = lookbackDate.toISOString();

  return db
    .select({
      id: articles.id,
      teamId: articles.teamId,
      penName: articles.penName,
      reviewerName: articles.reviewerName,
      status: articles.status,
      link: articles.link,
      createdByUserId: articles.createdByUserId,
      date: articles.date,
      updatedAt: articles.updatedAt,
      linkHealthCheckedAt: articles.linkHealthCheckedAt,
    })
    .from(articles)
    .where(and(
      or(like(articles.link, "http://%"), like(articles.link, "https://%")),
      sql`(${articles.date} >= ${lookbackDateKey} OR ${articles.updatedAt} >= ${lookbackIso})`,
    ))
    .orderBy(
      sql`CASE WHEN ${articles.linkHealthCheckedAt} IS NULL THEN 0 ELSE 1 END`,
      asc(articles.linkHealthCheckedAt),
      desc(articles.date),
      desc(articles.updatedAt),
      desc(articles.id),
    )
    .limit(limit)
    .all();
}

function countStatuses(items: LinkCheckResultItem[]) {
  return {
    ok: items.filter((item) => item.status === "ok").length,
    broken: items.filter((item) => item.status === "broken").length,
    unknown: items.filter((item) => item.status === "unknown").length,
  };
}

function getAutomationToken(request: NextRequest) {
  const authHeader = request.headers.get("authorization") || "";
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }
  return normalizeString(request.headers.get("x-link-check-token"));
}

export async function POST(request: NextRequest) {
  await ensureDatabaseInitialized();

  const body = await request.json().catch(() => ({} as LinkCheckBody));
  const trigger = normalizeString(body.trigger) === "scheduled" ? "scheduled" : "manual";
  const requestItems = parseRequestItems(body.items);
  const legacyUrls = parseLegacyUrls(body.urls);
  const requestedLimit = Number(body.limit);

  if (trigger === "scheduled") {
    const expectedToken = normalizeString(process.env.LINK_CHECK_AUTOMATION_TOKEN);
    const providedToken = getAutomationToken(request);
    if (!expectedToken || providedToken !== expectedToken) {
      return NextResponse.json({ success: false, error: "Unauthorized scheduled link check." }, { status: 401 });
    }

    const dueSlot = getLatestDueLinkCheckSlot(new Date());
    const slotKey = normalizeString(body.slotKey) || dueSlot?.key || null;
    if (!slotKey) {
      return NextResponse.json({ success: true, skipped: true, reason: "No due slot yet." });
    }

    const existingRun = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(and(
        eq(auditLogs.action, "article_link_check_scheduled"),
        eq(auditLogs.entity, "system"),
        eq(auditLogs.entityId, slotKey),
      ))
      .get();

    if (existingRun) {
      return NextResponse.json({ success: true, skipped: true, slotKey, reason: "Slot already processed." });
    }

    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(Math.floor(requestedLimit), LINK_CHECK_SCHEDULED_MAX_ITEMS)
      : LINK_CHECK_SCHEDULED_MAX_ITEMS;
    const rows = requestItems.length > 0
      ? await selectArticleRowsByIds(Array.from(new Set(requestItems.map((item) => item.articleId))))
      : await loadScheduledRows(limit);
    const scopedRows = rows.filter((row) => normalizeLinkCandidate(row.link)).slice(0, limit);

    const { items, results } = await runPersistedChecks(scopedRows, slotKey);
    const counts = countStatuses(items);

    await writeAuditLog({
      action: "article_link_check_scheduled",
      entity: "system",
      entityId: slotKey,
      payload: {
        slotKey,
        limit,
        processed: items.length,
        ...counts,
      },
    });

    if (items.length > 0) {
      await publishRealtimeEvent(["articles"]);
    }

    return NextResponse.json({ success: true, trigger, slotKey, items, results, counts });
  }

  const context = await getCurrentUserContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  if (requestItems.length > 0) {
    const rows = await loadManualScopeRows(requestItems, context);
    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: "Không có link hợp lệ trong phạm vi được phép kiểm tra." }, { status: 400 });
    }

    const limitedRows = rows.slice(0, LINK_CHECK_MANUAL_MAX_ITEMS);
    const { items, results } = await runPersistedChecks(limitedRows, null);
    const counts = countStatuses(items);

    await writeAuditLog({
      userId: context.user.id,
      action: "article_link_check_manual",
      entity: "articles",
      entityId: limitedRows.length === 1 ? limitedRows[0].id : `${limitedRows.length}-items`,
      payload: {
        processed: items.length,
        teamId: getContextTeamId(context),
        ...counts,
      },
    });

    if (items.length > 0) {
      await publishRealtimeEvent(["articles"]);
    }

    return NextResponse.json({ success: true, trigger, items, results, counts });
  }

  if (legacyUrls.length === 0) {
    return NextResponse.json({ success: false, error: "Thiếu link để kiểm tra." }, { status: 400 });
  }

  const limitedUrls = legacyUrls.slice(0, LINK_CHECK_MANUAL_MAX_ITEMS);
  const checked = await mapWithConcurrency(limitedUrls, LINK_CHECK_CONCURRENCY, checkLinkStatus);
  const results = Object.fromEntries(checked.map((item) => [item.url, item.status]));

  return NextResponse.json({ success: true, trigger: "manual", results });
}
