import { db } from "@/db";
import { articleSyncLinks, articles } from "@/db/schema";
import { writeAuditLog } from "@/lib/audit";
import { isApprovedArticleStatus } from "@/lib/article-status";
import { DEFAULT_GOOGLE_SHEET_SOURCE_URL } from "@/lib/google-sheet-sync";
import { desc, eq } from "drizzle-orm";

type GoogleSheetMirrorOverrides = {
  status?: string | null;
  reviewerName?: string | null;
  notes?: string | null;
  link?: string | null;
};

type ArticleSnapshot = {
  id: number;
  articleId: string | null;
  title: string;
  penName: string;
  date: string;
  status: string;
  reviewerName: string | null;
  notes: string | null;
  link: string | null;
  articleType: string;
  contentType: string;
  wordCountRange: string | null;
};

type SyncLinkSnapshot = {
  id: number;
  sourceUrl: string;
  sheetName: string;
  sheetMonth: number;
  sheetYear: number;
  sourceRowKey: string;
};

type GoogleSheetMutationMode = "mirrorArticleUpdate" | "upsertArticle";

type GoogleSheetMutationResponse = {
  success?: boolean;
  message?: string;
  error?: string;
  updatedFields?: unknown;
  rowNumber?: unknown;
  sourceRowKey?: unknown;
  sheetName?: unknown;
  month?: unknown;
  year?: unknown;
  sourceUrl?: unknown;
};

export type GoogleSheetMirrorResult = {
  attempted: boolean;
  success: boolean;
  skipped: boolean;
  message: string;
  response?: Record<string, unknown> | null;
};

type MirrorOptions = {
  articleId: number;
  actorUserId?: number | null;
  actorDisplayName?: string | null;
  reason?: string;
  overrides?: GoogleSheetMirrorOverrides;
};

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

const GOOGLE_SHEET_WEB_APP_TIMEOUT_MS = 8000;

function parseInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function parseJsonSafely(value: string) {
  try {
    return value ? JSON.parse(value) as GoogleSheetMutationResponse : null;
  } catch {
    return null;
  }
}

function mapArticleStatusToGoogleSheetStatus(status: unknown) {
  const normalized = normalizeText(status);

  if (isApprovedArticleStatus(normalized)) return "Done";

  switch (normalized) {
    case "Submitted":
    case "Reviewing":
    case "NeedsFix":
      return "Pending";
    case "Rejected":
      return "Rejected";
    default:
      return "";
  }
}

function mapArticleTypeToGoogleSheetValue(articleType: string, contentType: string) {
  const normalizedArticleType = normalizeText(articleType);
  const isRewrite = normalizeText(contentType) === "Viết lại";

  if (normalizedArticleType === "Thủ thuật") return "Thủ thuật";
  if (normalizedArticleType === "Mô tả SP dài" || normalizedArticleType === "Mô tả SP ngắn") return "Mô tả dài";
  if (normalizedArticleType.includes("Gia dụng")) return isRewrite ? "Gia dụng Viết lại" : "Gia dụng Viết mới";
  if (normalizedArticleType.includes("SEO") || normalizedArticleType.includes("ICT") || !normalizedArticleType) {
    return isRewrite ? "ICT Viết lại" : "ICT Viết mới";
  }

  return normalizedArticleType;
}

function mapWordCountRangeToGoogleSheetValue(wordCountRange: unknown) {
  switch (normalizeText(wordCountRange)) {
    case "800-1000":
      return "800 - 1000 chữ";
    case "1000-1500":
      return "1000 - 1500 chữ";
    case "1500-2000":
      return "1500 - 2000 chữ";
    case "Từ 2000 trở lên":
      return "Từ 2000 chữ trở lên";
    default:
      return "";
  }
}

function normalizeLinkKey(link: string) {
  return link.toLowerCase().trim();
}

function normalizeCompositeKey(title: string, penName: string, date: string) {
  return `${title.toLowerCase().trim()}|||${penName.toLowerCase().trim()}|||${date}`;
}

function buildSourceRowKey(article: Pick<ArticleSnapshot, "articleId" | "link" | "title" | "penName" | "date">) {
  const articleId = normalizeText(article.articleId);
  if (articleId) return `articleId:${articleId}`;

  const link = normalizeText(article.link);
  if (link) return `link:${normalizeLinkKey(link)}`;

  return `composite:${normalizeCompositeKey(article.title, article.penName, article.date)}`;
}

function parseArticleMonthYear(dateValue: string) {
  const match = normalizeText(dateValue).match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!match) return null;

  return {
    year: Number(match[1]),
    month: Number(match[2]),
  };
}

function shouldUseActorAsReviewer(status: string) {
  return isApprovedArticleStatus(status) || status === "NeedsFix" || status === "Reviewing";
}

function buildArticlePayload(article: ArticleSnapshot, options: MirrorOptions) {
  const resolvedStatus = normalizeText(options.overrides?.status ?? article.status);
  const resolvedReviewerName = normalizeText(
    options.overrides?.reviewerName
    ?? article.reviewerName
    ?? (shouldUseActorAsReviewer(resolvedStatus) ? options.actorDisplayName : "")
  );
  const resolvedNotes = normalizeText(options.overrides?.notes ?? article.notes);
  const resolvedLink = normalizeText(options.overrides?.link ?? article.link);

  return {
    id: article.id,
    articleId: normalizeText(article.articleId),
    title: article.title,
    penName: article.penName,
    date: article.date,
    status: resolvedStatus,
    sheetStatus: mapArticleStatusToGoogleSheetStatus(resolvedStatus),
    reviewerName: resolvedReviewerName,
    notes: resolvedNotes,
    link: resolvedLink,
    articleType: mapArticleTypeToGoogleSheetValue(article.articleType, article.contentType),
    wordCountRange: mapWordCountRangeToGoogleSheetValue(article.wordCountRange),
  };
}

async function loadArticleSnapshot(articleId: number) {
  return db
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
      articleType: articles.articleType,
      contentType: articles.contentType,
      wordCountRange: articles.wordCountRange,
    })
    .from(articles)
    .where(eq(articles.id, articleId))
    .get() as Promise<ArticleSnapshot | undefined>;
}

async function loadLatestSyncLink(articleId: number) {
  return db
    .select({
      id: articleSyncLinks.id,
      sourceUrl: articleSyncLinks.sourceUrl,
      sheetName: articleSyncLinks.sheetName,
      sheetMonth: articleSyncLinks.sheetMonth,
      sheetYear: articleSyncLinks.sheetYear,
      sourceRowKey: articleSyncLinks.sourceRowKey,
    })
    .from(articleSyncLinks)
    .where(eq(articleSyncLinks.articleIdRef, articleId))
    .orderBy(desc(articleSyncLinks.updatedAt), desc(articleSyncLinks.id))
    .get() as Promise<SyncLinkSnapshot | undefined>;
}

async function upsertArticleSyncLink(articleId: number, response: GoogleSheetMutationResponse, fallback: {
  sourceUrl: string;
  sheetName: string;
  sheetMonth: number;
  sheetYear: number;
  sourceRowKey: string;
}) {
  const sourceUrl = normalizeText(response.sourceUrl) || fallback.sourceUrl;
  const sheetName = normalizeText(response.sheetName) || fallback.sheetName;
  const sheetMonth = parseInteger(response.month) ?? fallback.sheetMonth;
  const sheetYear = parseInteger(response.year) ?? fallback.sheetYear;
  const sourceRowKey = normalizeText(response.sourceRowKey) || fallback.sourceRowKey;

  const existing = await loadLatestSyncLink(articleId);
  if (existing) {
    await db
      .update(articleSyncLinks)
      .set({
        sourceUrl,
        sheetName,
        sheetMonth,
        sheetYear,
        sourceRowKey,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(articleSyncLinks.id, existing.id))
      .run();
    return;
  }

  await db
    .insert(articleSyncLinks)
    .values({
      sourceUrl,
      sheetName,
      sheetMonth,
      sheetYear,
      sourceRowKey,
      articleIdRef: articleId,
    })
    .run();
}

async function postMutationToAppsScript(
  mode: GoogleSheetMutationMode,
  article: ArticleSnapshot,
  options: MirrorOptions,
  syncLink?: SyncLinkSnapshot
) {
  const webAppUrl = normalizeText(process.env.GOOGLE_SHEETS_SCRIPT_WEB_APP_URL);
  if (!webAppUrl) {
    return {
      skipped: true,
      message: "Chưa cấu hình GOOGLE_SHEETS_SCRIPT_WEB_APP_URL.",
    } as const;
  }

  const sharedSecret =
    normalizeText(process.env.GOOGLE_SHEETS_SCRIPT_SECRET)
    || normalizeText(process.env.GOOGLE_SHEETS_WEBHOOK_SECRET);
  if (!sharedSecret) {
    return {
      skipped: true,
      message: "Chưa cấu hình GOOGLE_SHEETS_SCRIPT_SECRET hoặc GOOGLE_SHEETS_WEBHOOK_SECRET.",
    } as const;
  }

  const articleDateParts = parseArticleMonthYear(article.date);
  const articlePayload = buildArticlePayload(article, options);
  const fallbackSourceUrl = syncLink?.sourceUrl || normalizeText(process.env.GOOGLE_SHEETS_ARTICLE_SOURCE_URL) || DEFAULT_GOOGLE_SHEET_SOURCE_URL;
  const fallbackRowKey = buildSourceRowKey({
    articleId: article.articleId,
    link: articlePayload.link || null,
    title: articlePayload.title,
    penName: articlePayload.penName,
    date: articlePayload.date,
  });

  const payload = {
    action: mode,
    secret: sharedSecret,
    sourceUrl: syncLink?.sourceUrl || fallbackSourceUrl,
    sheetName: syncLink?.sheetName || "",
    month: syncLink?.sheetMonth || articleDateParts?.month || null,
    year: syncLink?.sheetYear || articleDateParts?.year || null,
    sourceRowKey: syncLink?.sourceRowKey || fallbackRowKey,
    article: articlePayload,
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GOOGLE_SHEET_WEB_APP_TIMEOUT_MS);
    const response = await fetch(webAppUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const rawText = await response.text();
    const parsed = parseJsonSafely(rawText);

    if (!response.ok || parsed?.success === false) {
      const errorMessage =
        normalizeText(parsed?.error)
        || normalizeText(parsed?.message)
        || `Google Sheet trả về lỗi ${response.status}.`;

      return {
        skipped: false,
        success: false,
        message: errorMessage,
        response: parsed,
        payload,
      } as const;
    }

    if (articleDateParts) {
      await upsertArticleSyncLink(article.id, parsed || {}, {
        sourceUrl: payload.sourceUrl,
        sheetName: normalizeText(parsed?.sheetName) || syncLink?.sheetName || `Tháng ${String(articleDateParts.month).padStart(2, "0")}${articleDateParts.year}`,
        sheetMonth: articleDateParts.month,
        sheetYear: articleDateParts.year,
        sourceRowKey: normalizeText(parsed?.sourceRowKey) || fallbackRowKey,
      });
    }

    return {
      skipped: false,
      success: true,
      message: normalizeText(parsed?.message) || "Đã cập nhật Google Sheet gốc.",
      response: parsed,
      payload,
    } as const;
  } catch (error) {
    const isTimeoutError =
      error instanceof Error
      && (error.name === "AbortError" || /aborted|timeout/i.test(error.message));

    return {
      skipped: false,
      success: false,
      message: isTimeoutError
        ? "Google Sheet phản hồi quá chậm. Bài viết vẫn đã lưu trong hệ thống, bạn có thể thử đồng bộ lại sau."
        : normalizeText(error) || "Không gọi được Apps Script web app.",
      response: null,
      payload,
    } as const;
  }
}

async function finalizeMutationResult(
  articleId: number,
  options: MirrorOptions,
  mode: GoogleSheetMutationMode,
  result: Awaited<ReturnType<typeof postMutationToAppsScript>>,
  syncLink?: SyncLinkSnapshot
): Promise<GoogleSheetMirrorResult> {
  if (result.skipped) {
    return {
      attempted: false,
      success: false,
      skipped: true,
      message: result.message,
    };
  }

  if (!result.success) {
    await writeAuditLog({
      userId: options.actorUserId ?? null,
      action: "article_google_sheet_push_failed",
      entity: "article",
      entityId: String(articleId),
      payload: {
        reason: options.reason || mode,
        errorMessage: result.message,
        syncLink: syncLink ?? null,
        request: result.payload,
      },
    });

    return {
      attempted: true,
      success: false,
      skipped: false,
      message: result.message,
      response: result.response,
    };
  }

  await writeAuditLog({
    userId: options.actorUserId ?? null,
    action: mode === "upsertArticle" ? "article_google_sheet_created" : "article_google_sheet_pushed",
    entity: "article",
    entityId: String(articleId),
    payload: {
      reason: options.reason || mode,
      syncLink: syncLink ?? null,
      request: result.payload,
      response: result.response,
    },
  });

  return {
    attempted: true,
    success: true,
    skipped: false,
    message: result.message,
    response: result.response,
  };
}

export async function createArticleInGoogleSheet(options: MirrorOptions): Promise<GoogleSheetMirrorResult> {
  const article = await loadArticleSnapshot(options.articleId);
  if (!article) {
    return {
      attempted: false,
      success: false,
      skipped: true,
      message: "Không tìm thấy bài viết để ghi sang Google Sheet.",
    };
  }

  const syncLink = await loadLatestSyncLink(options.articleId);
  const result = await postMutationToAppsScript("upsertArticle", article, options, syncLink);
  return finalizeMutationResult(article.id, options, "upsertArticle", result, syncLink);
}

export async function mirrorArticleUpdateToGoogleSheet(options: MirrorOptions): Promise<GoogleSheetMirrorResult> {
  const article = await loadArticleSnapshot(options.articleId);
  if (!article) {
    return {
      attempted: false,
      success: false,
      skipped: true,
      message: "Không tìm thấy bài viết để đẩy ngược sang Google Sheet.",
    };
  }

  const syncLink = await loadLatestSyncLink(options.articleId);
  const mode: GoogleSheetMutationMode = syncLink ? "mirrorArticleUpdate" : "upsertArticle";
  const result = await postMutationToAppsScript(mode, article, options, syncLink);
  return finalizeMutationResult(article.id, options, mode, result, syncLink);
}
