import { eq } from "drizzle-orm";
import { db, ensureDatabaseInitialized, ensureReviewRegistrationSchemaInitialized } from "@/db";
import { reviewRegistrations } from "@/db/schema";
import { writeAuditLog } from "@/lib/audit";
import { createNotification } from "@/lib/notifications";
import { publishRealtimeEvent } from "@/lib/realtime";
import {
  getReviewRegistrationStatusLabel,
  resolveReviewRegistrationSheetProfile,
  type ReviewRegistrationStatus,
} from "@/lib/review-registration";

const REVIEW_REGISTRATION_AUTOMATION_TIMEOUT_MS = 30000;

export type ReviewRegistrationArticleSnapshot = {
  id: number;
  teamId: number | null;
  title: string;
  penName: string;
  link: string | null;
  date: string;
  status: string;
  reviewerName: string | null;
};

type ReviewRegistrationScriptResponse = {
  success?: boolean;
  message?: string;
  error?: string;
  sheetUpdated?: boolean;
  sheetName?: string;
  rowNumber?: number;
  sheetMonth?: number;
  sheetYear?: number;
  sheetWrittenAt?: string;
  completedAt?: string;
};

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function parseInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function parseJsonSafely(value: string) {
  try {
    return value ? JSON.parse(value) as ReviewRegistrationScriptResponse : null;
  } catch {
    return null;
  }
}

async function updateRegistration(registrationId: number, values: Partial<typeof reviewRegistrations.$inferInsert>) {
  await db
    .update(reviewRegistrations)
    .set({
      ...values,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(reviewRegistrations.id, registrationId))
    .run();
}

function buildToastPayload(status: ReviewRegistrationStatus, title: string, message: string) {
  if (status === "completed") {
    return {
      toastTitle: "Đăng ký bài duyệt thành công",
      toastMessage: `"${title}" đã được ghi vào sheet bài duyệt.`,
      toastVariant: "success" as const,
    };
  }

  if (status === "writing_sheet" || status === "queued") {
    return {
      toastTitle: "Đang xử lý bài duyệt",
      toastMessage: message || `"${title}" đang được ghi vào sheet bài duyệt.`,
      toastVariant: "warning" as const,
    };
  }

  return {
    toastTitle: "Đăng ký bài duyệt thất bại",
    toastMessage: message || `Không thể xử lý “${title}” lúc này.`,
    toastVariant: "error" as const,
  };
}

async function callReviewRegistrationScript(input: {
  article: ReviewRegistrationArticleSnapshot;
  reviewerLabel: string;
  requestedByUserId: number;
  requestedByDisplayName: string;
}) {
  const webAppUrl = normalizeText(process.env.REVIEW_REGISTRATION_SCRIPT_WEB_APP_URL);
  if (!webAppUrl) {
    return {
      skipped: true,
      message: "Chưa cấu hình REVIEW_REGISTRATION_SCRIPT_WEB_APP_URL.",
    } as const;
  }

  const secret = normalizeText(process.env.REVIEW_REGISTRATION_SCRIPT_SECRET);
  if (!secret) {
    return {
      skipped: true,
      message: "Chưa cấu hình REVIEW_REGISTRATION_SCRIPT_SECRET.",
    } as const;
  }

  const profile = resolveReviewRegistrationSheetProfile([input.reviewerLabel]);
  if (!profile) {
    return {
      skipped: true,
      message: `Chưa có cấu hình sheet bài duyệt cho reviewer “${input.reviewerLabel}”.`,
    } as const;
  }

  const payload = {
    action: "registerReviewArticle",
    secret,
    article: {
      articleId: input.article.id,
      title: input.article.title,
      articleLink: normalizeText(input.article.link),
      articleDate: input.article.date,
      writerPenName: input.article.penName,
      reviewerPenName: input.reviewerLabel,
    },
    target: {
      spreadsheetUrl: profile.spreadsheetUrl,
      sheetName: profile.sheetName,
      reviewerLabel: profile.reviewerLabel,
      managerLabel: profile.managerLabel || "",
    },
    requestedBy: {
      userId: input.requestedByUserId,
      displayName: input.requestedByDisplayName,
    },
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REVIEW_REGISTRATION_AUTOMATION_TIMEOUT_MS);

    try {
      const response = await fetch(webAppUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const rawText = await response.text();
      const parsed = parseJsonSafely(rawText);

      if (!response.ok || parsed?.success === false) {
        return {
          skipped: false,
          success: false,
          message: normalizeText(parsed?.error) || normalizeText(parsed?.message) || `Apps Script trả về lỗi ${response.status}.`,
          response: parsed,
        } as const;
      }

      return {
        skipped: false,
        success: true,
        message: normalizeText(parsed?.message) || "Đã ghi bài duyệt vào sheet.",
        response: parsed || {},
      } as const;
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      skipped: false,
      success: false,
      message: /aborted|timeout/i.test(message)
        ? "Đăng ký bài duyệt phản hồi quá chậm."
        : (normalizeText(message) || "Không gọi được Apps Script đăng ký bài duyệt."),
      response: null,
    } as const;
  }
}

export async function processReviewRegistrationJob(input: {
  registrationId: number;
  article: ReviewRegistrationArticleSnapshot;
  requestedByUserId: number;
  requestedByDisplayName: string;
}) {
  await ensureDatabaseInitialized();
  await ensureReviewRegistrationSchemaInitialized();

  const reviewerLabel = normalizeText(input.article.reviewerName);
  const profile = resolveReviewRegistrationSheetProfile([reviewerLabel]);

  if (!normalizeText(input.article.link)) {
    const errorMessage = "Bài viết chưa có link nên chưa thể đăng ký bài duyệt.";
    await updateRegistration(input.registrationId, {
      status: "failed",
      lastError: errorMessage,
      automationMessage: errorMessage,
      articleLink: null,
    });

    await writeAuditLog({
      userId: input.requestedByUserId,
      action: "review_registration_failed",
      entity: "review_registration",
      entityId: String(input.registrationId),
      payload: {
        articleId: input.article.id,
        reason: "missing_link",
        errorMessage,
      },
    });

    await publishRealtimeEvent({
      channels: ["articles"],
      userIds: [input.requestedByUserId],
      toastTitle: "Thiếu link bài viết",
      toastMessage: errorMessage,
      toastVariant: "error",
    });
    return;
  }

  if (!reviewerLabel || !profile) {
    const errorMessage = reviewerLabel
      ? `Chưa có cấu hình sheet bài duyệt cho reviewer “${reviewerLabel}”.`
      : "Bài viết chưa có reviewer hợp lệ để đăng ký bài duyệt.";
    await updateRegistration(input.registrationId, {
      status: "failed",
      lastError: errorMessage,
      automationMessage: errorMessage,
      articleLink: input.article.link,
    });

    await writeAuditLog({
      userId: input.requestedByUserId,
      action: "review_registration_failed",
      entity: "review_registration",
      entityId: String(input.registrationId),
      payload: {
        articleId: input.article.id,
        reason: "missing_sheet_profile",
        reviewerLabel,
        errorMessage,
      },
    });

    await publishRealtimeEvent({
      channels: ["articles"],
      userIds: [input.requestedByUserId],
      toastTitle: "Thiếu cấu hình sheet bài duyệt",
      toastMessage: errorMessage,
      toastVariant: "error",
    });
    return;
  }

  await updateRegistration(input.registrationId, {
    status: "writing_sheet",
    lastError: null,
    automationMessage: "Đang ghi bài duyệt vào sheet...",
    articleLink: input.article.link,
    reviewerPenName: reviewerLabel,
    writerPenName: input.article.penName,
    title: input.article.title,
    articleDate: input.article.date,
    sheetName: profile.sheetName,
    sheetMonth: null,
    sheetYear: null,
    externalSheetName: null,
    externalRowNumber: null,
    sheetWrittenAt: null,
    completedAt: null,
  });

  const result = await callReviewRegistrationScript({
    article: input.article,
    reviewerLabel,
    requestedByUserId: input.requestedByUserId,
    requestedByDisplayName: input.requestedByDisplayName,
  });

  if (result.skipped || !result.success) {
    const errorMessage = result.message;
    await updateRegistration(input.registrationId, {
      status: "failed",
      lastError: errorMessage,
      automationMessage: errorMessage,
      articleLink: input.article.link,
      reviewerPenName: reviewerLabel,
      writerPenName: input.article.penName,
      title: input.article.title,
      articleDate: input.article.date,
      sheetName: profile.sheetName,
    });

    await writeAuditLog({
      userId: input.requestedByUserId,
      action: "review_registration_failed",
      entity: "review_registration",
      entityId: String(input.registrationId),
      payload: {
        articleId: input.article.id,
        reason: result.skipped ? "script_not_configured" : "script_failed",
        reviewerLabel,
        errorMessage,
        response: result.response,
      },
    });

    await publishRealtimeEvent({
      channels: ["articles"],
      userIds: [input.requestedByUserId],
      toastTitle: "Đăng ký bài duyệt thất bại",
      toastMessage: errorMessage,
      toastVariant: "error",
    });

    await createNotification({
      toUserId: input.requestedByUserId,
      toPenName: reviewerLabel,
      type: "system",
      title: "Đăng ký bài duyệt thất bại",
      message: `${input.article.title}: ${errorMessage}`,
      relatedArticleId: input.article.id,
    });
    return;
  }

  const response = result.response || {};
  const status = response.sheetUpdated ? "completed" : "failed";
  const message = normalizeText(response.message) || result.message || getReviewRegistrationStatusLabel(status);

  await updateRegistration(input.registrationId, {
    status,
    automationMessage: message,
    lastError: status === "completed" ? null : message,
    articleLink: input.article.link,
    reviewerPenName: reviewerLabel,
    writerPenName: input.article.penName,
    title: input.article.title,
    articleDate: input.article.date,
    sheetName: profile.sheetName,
    sheetMonth: parseInteger(response.sheetMonth),
    sheetYear: parseInteger(response.sheetYear),
    externalSheetName: normalizeText(response.sheetName) || profile.sheetName,
    externalRowNumber: parseInteger(response.rowNumber),
    sheetWrittenAt: normalizeText(response.sheetWrittenAt) || null,
    completedAt: normalizeText(response.completedAt) || (status === "completed" ? new Date().toISOString() : null),
  });

  await writeAuditLog({
    userId: input.requestedByUserId,
    action: status === "completed" ? "review_registration_completed" : "review_registration_partial",
    entity: "review_registration",
    entityId: String(input.registrationId),
    payload: {
      articleId: input.article.id,
      reviewerLabel,
      status,
      response,
    },
  });

  const toast = buildToastPayload(status, input.article.title, message);
  await publishRealtimeEvent({
    channels: ["articles"],
    userIds: [input.requestedByUserId],
    toastTitle: toast.toastTitle,
    toastMessage: toast.toastMessage,
    toastVariant: toast.toastVariant,
  });
}
