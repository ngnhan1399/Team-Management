import { db, ensureContentWorkSchemaInitialized, ensureDatabaseInitialized } from "@/db";
import { contentWorkRegistrations } from "@/db/schema";
import { writeAuditLog } from "@/lib/audit";
import {
  getContentWorkStatusLabel,
  resolveContentWorkCategoryLabel,
  type ContentWorkStatus,
} from "@/lib/content-work-registration";
import { createNotification } from "@/lib/notifications";
import { publishRealtimeEvent } from "@/lib/realtime";
import { eq } from "drizzle-orm";

const CONTENT_WORK_AUTOMATION_TIMEOUT_MS = 12000;

export type ContentWorkArticleSnapshot = {
  id: number;
  teamId: number | null;
  title: string;
  penName: string;
  articleType: string;
  contentType: string;
  category: string;
  link: string | null;
  date: string;
};

type ContentWorkScriptResponse = {
  success?: boolean;
  message?: string;
  error?: string;
  formSubmitted?: boolean;
  formSubmittedAt?: string;
  sheetUpdated?: boolean;
  sheetName?: string;
  rowNumber?: number;
  linkWrittenAt?: string;
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
    return value ? JSON.parse(value) as ContentWorkScriptResponse : null;
  } catch {
    return null;
  }
}

function normalizeContentWorkScriptMessage(message: string) {
  const normalized = normalizeText(message);
  if (!normalized) {
    return normalized;
  }

  const folded = normalized
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d");

  if (/no item with the given id could be found/i.test(normalized) || /khong the tim thay muc co ma da cung cap/i.test(folded)) {
    return "Apps Script Content Work đang thiếu quyền với file Google hoặc đang chạy bản cũ. Hãy cập nhật lại Apps Script bản mới nhất rồi thử lại.";
  }

  if (/urlfetchapp\.fetch/i.test(normalized) || /script\.external_request/i.test(normalized)) {
    return "Apps Script Content Work chưa được cấp quyền gọi dịch vụ ngoài. Hãy mở script và chạy authorizeContentWorkScopes một lần để cấp quyền.";
  }

  if (/gui form content work that bai \(http 400\)\.?/i.test(folded) || /http 400/.test(normalized)) {
    return "Apps Script Content Work đang gửi sai hoặc thiếu trường bắt buộc của Google Form. Hãy cập nhật lại cấu trúc form trong script rồi thử lại.";
  }

  return normalized;
}

async function updateRegistration(registrationId: number, values: Partial<typeof contentWorkRegistrations.$inferInsert>) {
  await db
    .update(contentWorkRegistrations)
    .set({
      ...values,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(contentWorkRegistrations.id, registrationId))
    .run();
}

function resolveStepStatus(result: ContentWorkScriptResponse): ContentWorkStatus {
  if (result.sheetUpdated) return "completed";
  if (result.formSubmitted) return "form_submitted";
  return "failed";
}

function buildToastPayload(status: ContentWorkStatus, title: string, message: string) {
  if (status === "completed") {
    return {
      toastTitle: "Đăng ký Content Work thành công",
      toastMessage: `"${title}" đã được gửi form và điền link vào sheet Content Work.`,
      toastVariant: "success" as const,
    };
  }

  if (status === "form_submitted") {
    return {
      toastTitle: "Đã gửi form Content Work",
      toastMessage: message || `"${title}" đã gửi form, nhưng hệ thống chưa điền được link vào sheet.`,
      toastVariant: "warning" as const,
    };
  }

  return {
    toastTitle: "Đăng ký Content Work thất bại",
    toastMessage: message || `Không thể xử lý "${title}" lúc này.`,
    toastVariant: "error" as const,
  };
}

async function callContentWorkScript(input: {
  article: ContentWorkArticleSnapshot;
  categoryLabel: string;
  requestedByUserId: number;
  requestedByDisplayName: string;
}) {
  const webAppUrl = normalizeText(process.env.CONTENT_WORK_SCRIPT_WEB_APP_URL);
  if (!webAppUrl) {
    return {
      skipped: true,
      message: "Chưa cấu hình CONTENT_WORK_SCRIPT_WEB_APP_URL.",
    } as const;
  }

  const secret = normalizeText(process.env.CONTENT_WORK_SCRIPT_SECRET);
  if (!secret) {
    return {
      skipped: true,
      message: "Chưa cấu hình CONTENT_WORK_SCRIPT_SECRET.",
    } as const;
  }

  const payload = {
    action: "registerContentWork",
    secret,
    article: {
      articleId: input.article.id,
      title: input.article.title,
      penName: input.article.penName,
      date: input.article.date,
      articleLink: normalizeText(input.article.link),
      contentWorkCategory: input.categoryLabel,
      source: normalizeText(input.article.link),
    },
    requestedBy: {
      userId: input.requestedByUserId,
      displayName: input.requestedByDisplayName,
    },
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONTENT_WORK_AUTOMATION_TIMEOUT_MS);
    const response = await fetch(webAppUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const rawText = await response.text();
    const parsed = parseJsonSafely(rawText);

    if (!response.ok || parsed?.success === false) {
      return {
        skipped: false,
        success: false,
        message: normalizeContentWorkScriptMessage(normalizeText(parsed?.error) || normalizeText(parsed?.message) || `Content Work script trả về lỗi ${response.status}.`),
        response: parsed,
      } as const;
    }

    return {
      skipped: false,
      success: true,
      message: normalizeText(parsed?.message) || "Đã xử lý Content Work.",
      response: parsed || {},
    } as const;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      skipped: false,
      success: false,
      message: /aborted|timeout/i.test(message)
        ? "Content Work script phản hồi quá chậm."
        : (normalizeContentWorkScriptMessage(message) || "Không gọi được Content Work Apps Script."),
      response: null,
    } as const;
  }
}

export async function processContentWorkRegistrationJob(input: {
  registrationId: number;
  article: ContentWorkArticleSnapshot;
  requestedByUserId: number;
  requestedByDisplayName: string;
}) {
  await ensureDatabaseInitialized();
  await ensureContentWorkSchemaInitialized();

  const categoryLabel = resolveContentWorkCategoryLabel({
    articleType: input.article.articleType,
    contentType: input.article.contentType,
    category: input.article.category,
  });

  if (!normalizeText(input.article.link)) {
    const errorMessage = "Bài viết chưa có link nên chưa thể đăng ký Content Work.";
    await updateRegistration(input.registrationId, {
      status: "failed",
      lastError: errorMessage,
      automationMessage: errorMessage,
      articleLink: null,
      contentWorkCategory: categoryLabel || null,
    });

    await writeAuditLog({
      userId: input.requestedByUserId,
      action: "content_work_registration_failed",
      entity: "content_work_registration",
      entityId: String(input.registrationId),
      payload: {
        articleId: input.article.id,
        reason: "missing_link",
        errorMessage,
      },
    });

    await publishRealtimeEvent({
      channels: ["content-work"],
      userIds: [input.requestedByUserId],
      toastTitle: "Thiếu link bài viết",
      toastMessage: errorMessage,
      toastVariant: "error",
    });
    return;
  }

  if (!categoryLabel) {
    const errorMessage = "Loại bài này chưa được ánh xạ sang danh mục Content Work.";
    await updateRegistration(input.registrationId, {
      status: "failed",
      lastError: errorMessage,
      automationMessage: errorMessage,
      articleLink: input.article.link,
      contentWorkCategory: null,
    });

    await writeAuditLog({
      userId: input.requestedByUserId,
      action: "content_work_registration_failed",
      entity: "content_work_registration",
      entityId: String(input.registrationId),
      payload: {
        articleId: input.article.id,
        reason: "unsupported_category",
        articleType: input.article.articleType,
        contentType: input.article.contentType,
        category: input.article.category,
      },
    });

    await publishRealtimeEvent({
      channels: ["content-work"],
      userIds: [input.requestedByUserId],
      toastTitle: "Chưa ánh xạ được danh mục",
      toastMessage: errorMessage,
      toastVariant: "error",
    });
    return;
  }

  await updateRegistration(input.registrationId, {
    status: "submitting_form",
    lastError: null,
    automationMessage: "Đang gửi form Content Work...",
    articleLink: input.article.link,
    contentWorkCategory: categoryLabel,
    externalSheetName: null,
    externalRowNumber: null,
    formSubmittedAt: null,
    linkWrittenAt: null,
    completedAt: null,
  });

  const result = await callContentWorkScript({
    article: input.article,
    categoryLabel,
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
      contentWorkCategory: categoryLabel,
    });

    await writeAuditLog({
      userId: input.requestedByUserId,
      action: "content_work_registration_failed",
      entity: "content_work_registration",
      entityId: String(input.registrationId),
      payload: {
        articleId: input.article.id,
        reason: result.skipped ? "script_not_configured" : "script_failed",
        errorMessage,
        response: result.response,
      },
    });

    await publishRealtimeEvent({
      channels: ["content-work"],
      userIds: [input.requestedByUserId],
      toastTitle: "Đăng ký Content Work thất bại",
      toastMessage: errorMessage,
      toastVariant: "error",
    });

    await createNotification({
      toUserId: input.requestedByUserId,
      toPenName: input.article.penName,
      type: "system",
      title: "Đăng ký Content Work thất bại",
      message: `${input.article.title}: ${errorMessage}`,
      relatedArticleId: input.article.id,
    });
    return;
  }

  const response = result.response || {};
  const status = resolveStepStatus(response);
  const message = normalizeText(response.message) || result.message || getContentWorkStatusLabel(status);

  await updateRegistration(input.registrationId, {
    status,
    automationMessage: message,
    lastError: status === "completed" ? null : message,
    articleLink: input.article.link,
    contentWorkCategory: categoryLabel,
    externalSheetName: normalizeText(response.sheetName) || null,
    externalRowNumber: parseInteger(response.rowNumber),
    formSubmittedAt: normalizeText(response.formSubmittedAt) || null,
    linkWrittenAt: normalizeText(response.linkWrittenAt) || null,
    completedAt: normalizeText(response.completedAt) || (status === "completed" ? new Date().toISOString() : null),
  });

  await writeAuditLog({
    userId: input.requestedByUserId,
    action: status === "completed" ? "content_work_registration_completed" : "content_work_registration_partial",
    entity: "content_work_registration",
    entityId: String(input.registrationId),
    payload: {
      articleId: input.article.id,
      status,
      response,
      categoryLabel,
    },
  });

  const toast = buildToastPayload(status, input.article.title, message);
  await publishRealtimeEvent({
    channels: ["content-work"],
    userIds: [input.requestedByUserId],
    toastTitle: toast.toastTitle,
    toastMessage: toast.toastMessage,
    toastVariant: toast.toastVariant,
  });

  if (status !== "completed") {
    await createNotification({
      toUserId: input.requestedByUserId,
      toPenName: input.article.penName,
      type: "system",
      title: "Content Work cần kiểm tra lại",
      message: `${input.article.title}: ${message}`,
      relatedArticleId: input.article.id,
    });
  }
}
