import { db } from "@/db";
import { articleSyncLinks, articles } from "@/db/schema";
import { writeAuditLog } from "@/lib/audit";
import { isApprovedArticleStatus } from "@/lib/article-status";
import { desc, eq } from "drizzle-orm";

type GoogleSheetMirrorOverrides = {
  status?: string | null;
  reviewerName?: string | null;
  notes?: string | null;
  link?: string | null;
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

function shouldUseActorAsReviewer(status: string) {
  return isApprovedArticleStatus(status) || status === "NeedsFix" || status === "Reviewing";
}

function parseJsonSafely(value: string) {
  try {
    return value ? JSON.parse(value) as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export async function mirrorArticleUpdateToGoogleSheet(options: MirrorOptions): Promise<GoogleSheetMirrorResult> {
  const webAppUrl = normalizeText(process.env.GOOGLE_SHEETS_SCRIPT_WEB_APP_URL);
  if (!webAppUrl) {
    return {
      attempted: false,
      success: false,
      skipped: true,
      message: "Chưa cấu hình GOOGLE_SHEETS_SCRIPT_WEB_APP_URL.",
    };
  }

  const sharedSecret =
    normalizeText(process.env.GOOGLE_SHEETS_SCRIPT_SECRET)
    || normalizeText(process.env.GOOGLE_SHEETS_WEBHOOK_SECRET);
  if (!sharedSecret) {
    return {
      attempted: false,
      success: false,
      skipped: true,
      message: "Chưa cấu hình GOOGLE_SHEETS_SCRIPT_SECRET hoặc GOOGLE_SHEETS_WEBHOOK_SECRET.",
    };
  }

  const article = await db
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
    })
    .from(articles)
    .where(eq(articles.id, options.articleId))
    .get();

  if (!article) {
    return {
      attempted: false,
      success: false,
      skipped: true,
      message: "Không tìm thấy bài viết để đẩy ngược sang Google Sheet.",
    };
  }

  const syncLink = await db
    .select({
      sourceUrl: articleSyncLinks.sourceUrl,
      sheetName: articleSyncLinks.sheetName,
      sheetMonth: articleSyncLinks.sheetMonth,
      sheetYear: articleSyncLinks.sheetYear,
      sourceRowKey: articleSyncLinks.sourceRowKey,
    })
    .from(articleSyncLinks)
    .where(eq(articleSyncLinks.articleIdRef, options.articleId))
    .orderBy(desc(articleSyncLinks.updatedAt), desc(articleSyncLinks.id))
    .get();

  if (!syncLink) {
    return {
      attempted: false,
      success: false,
      skipped: true,
      message: "Bài viết này chưa được liên kết với dòng nào trong Google Sheet.",
    };
  }

  const resolvedStatus = normalizeText(options.overrides?.status ?? article.status);
  const resolvedReviewerName = normalizeText(
    options.overrides?.reviewerName
    ?? article.reviewerName
    ?? (shouldUseActorAsReviewer(resolvedStatus) ? options.actorDisplayName : "")
  );
  const resolvedNotes = normalizeText(options.overrides?.notes ?? article.notes);
  const resolvedLink = normalizeText(options.overrides?.link ?? article.link);

  const payload = {
    action: "mirrorArticleUpdate",
    secret: sharedSecret,
    sourceUrl: syncLink.sourceUrl,
    sheetName: syncLink.sheetName,
    month: syncLink.sheetMonth,
    year: syncLink.sheetYear,
    sourceRowKey: syncLink.sourceRowKey,
    article: {
      id: article.id,
      articleId: normalizeText(article.articleId) || "",
      title: article.title,
      penName: article.penName,
      date: article.date,
      status: resolvedStatus,
      sheetStatus: mapArticleStatusToGoogleSheetStatus(resolvedStatus),
      reviewerName: resolvedReviewerName,
      notes: resolvedNotes,
      link: resolvedLink,
    },
  };

  try {
    const response = await fetch(webAppUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    const rawText = await response.text();
    const parsed = parseJsonSafely(rawText);

    if (!response.ok || parsed?.success === false) {
      const errorMessage =
        normalizeText(parsed?.error)
        || normalizeText(parsed?.message)
        || `Google Sheet trả về lỗi ${response.status}.`;

      await writeAuditLog({
        userId: options.actorUserId ?? null,
        action: "article_google_sheet_push_failed",
        entity: "article",
        entityId: String(options.articleId),
        payload: {
          reason: options.reason || "article_update",
          errorMessage,
          responseStatus: response.status,
          syncLink,
        },
      });

      return {
        attempted: true,
        success: false,
        skipped: false,
        message: errorMessage,
        response: parsed,
      };
    }

    await writeAuditLog({
      userId: options.actorUserId ?? null,
      action: "article_google_sheet_pushed",
      entity: "article",
      entityId: String(options.articleId),
      payload: {
        reason: options.reason || "article_update",
        syncLink,
        updatedFields: parsed?.updatedFields || ["status", "reviewerName", "notes", "link"],
      },
    });

    return {
      attempted: true,
      success: true,
      skipped: false,
      message: normalizeText(parsed?.message) || "Đã cập nhật Google Sheet gốc.",
      response: parsed,
    };
  } catch (error) {
    const errorMessage = normalizeText(error) || "Không gọi được Apps Script web app.";

    await writeAuditLog({
      userId: options.actorUserId ?? null,
      action: "article_google_sheet_push_failed",
      entity: "article",
      entityId: String(options.articleId),
      payload: {
        reason: options.reason || "article_update",
        errorMessage,
        syncLink,
      },
    });

    return {
      attempted: true,
      success: false,
      skipped: false,
      message: errorMessage,
      response: null,
    };
  }
}
