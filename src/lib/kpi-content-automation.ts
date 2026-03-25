import { db, ensureDatabaseInitialized, ensureKpiContentSchemaInitialized } from "@/db";
import { kpiContentRegistrationBatches, kpiContentRegistrations } from "@/db/schema";
import { writeAuditLog } from "@/lib/audit";
import {
  getKpiContentStatusLabel,
  type KpiContentStatus,
} from "@/lib/kpi-content-registration";
import { createNotification } from "@/lib/notifications";
import { publishRealtimeEvent } from "@/lib/realtime";
import { eq } from "drizzle-orm";

const KPI_CONTENT_AUTOMATION_TIMEOUT_MS = 30000;

export type KpiContentArticleSnapshot = {
  id: number;
  teamId: number | null;
  title: string;
  penName: string;
  articleType: string;
  contentType: string;
  category: string;
  link: string | null;
  date: string;
  status: string;
};

type KpiContentScriptResponse = {
  success?: boolean;
  message?: string;
  error?: string;
  formSubmitted?: boolean;
  completed?: boolean;
  submittedAt?: string;
  completedAt?: string;
};

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function parseJsonSafely(value: string) {
  try {
    return value ? JSON.parse(value) as KpiContentScriptResponse : null;
  } catch {
    return null;
  }
}

function normalizeKpiContentScriptMessage(message: string) {
  const normalized = normalizeText(message);
  if (!normalized) {
    return normalized;
  }

  const folded = normalized
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d");

  if (/urlfetchapp\.fetch/i.test(normalized) || /script\.external_request/i.test(normalized)) {
    return "KPI Content Apps Script chua duoc cap quyen goi dich vu ngoai. Hay mo script va authorize mot lan.";
  }

  if (/form/i.test(folded) && /400/.test(normalized)) {
    return "KPI Content script dang gui sai hoac thieu truong bat buoc cua Google Form. Hay cap nhat lai cau truc form roi thu lai.";
  }

  return normalized;
}

async function updateBatch(batchId: number, values: Partial<typeof kpiContentRegistrationBatches.$inferInsert>) {
  await db
    .update(kpiContentRegistrationBatches)
    .set({
      ...values,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(kpiContentRegistrationBatches.id, batchId))
    .run();
}

async function updateBatchItems(batchKey: string, values: Partial<typeof kpiContentRegistrations.$inferInsert>) {
  await db
    .update(kpiContentRegistrations)
    .set({
      ...values,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(kpiContentRegistrations.batchId, batchKey))
    .run();
}

async function loadBatch(batchId: number) {
  const batch = await db
    .select({
      id: kpiContentRegistrationBatches.id,
      teamId: kpiContentRegistrationBatches.teamId,
      requestedByUserId: kpiContentRegistrationBatches.requestedByUserId,
      employeeCode: kpiContentRegistrationBatches.employeeCode,
      batchKey: kpiContentRegistrationBatches.batchKey,
      batchSize: kpiContentRegistrationBatches.batchSize,
      taskLabel: kpiContentRegistrationBatches.taskLabel,
      detailLabel: kpiContentRegistrationBatches.detailLabel,
      status: kpiContentRegistrationBatches.status,
      attemptCount: kpiContentRegistrationBatches.attemptCount,
      automationMessage: kpiContentRegistrationBatches.automationMessage,
      lastError: kpiContentRegistrationBatches.lastError,
      submittedAt: kpiContentRegistrationBatches.submittedAt,
      completedAt: kpiContentRegistrationBatches.completedAt,
      createdAt: kpiContentRegistrationBatches.createdAt,
      updatedAt: kpiContentRegistrationBatches.updatedAt,
    })
    .from(kpiContentRegistrationBatches)
    .where(eq(kpiContentRegistrationBatches.id, batchId))
    .get();

  if (!batch) return null;

  const items = await db
    .select({
      id: kpiContentRegistrations.id,
      articleId: kpiContentRegistrations.articleId,
      teamId: kpiContentRegistrations.teamId,
      requestedByUserId: kpiContentRegistrations.requestedByUserId,
      employeeCode: kpiContentRegistrations.employeeCode,
      batchId: kpiContentRegistrations.batchId,
      batchPosition: kpiContentRegistrations.batchPosition,
      batchSize: kpiContentRegistrations.batchSize,
      groupedArticleIds: kpiContentRegistrations.groupedArticleIds,
      penName: kpiContentRegistrations.penName,
      title: kpiContentRegistrations.title,
      articleLink: kpiContentRegistrations.articleLink,
      articleDate: kpiContentRegistrations.articleDate,
      articleStatus: kpiContentRegistrations.articleStatus,
      taskLabel: kpiContentRegistrations.taskLabel,
      detailLabel: kpiContentRegistrations.detailLabel,
      status: kpiContentRegistrations.status,
      attemptCount: kpiContentRegistrations.attemptCount,
      automationMessage: kpiContentRegistrations.automationMessage,
      lastError: kpiContentRegistrations.lastError,
      submittedAt: kpiContentRegistrations.submittedAt,
      completedAt: kpiContentRegistrations.completedAt,
      createdAt: kpiContentRegistrations.createdAt,
      updatedAt: kpiContentRegistrations.updatedAt,
    })
    .from(kpiContentRegistrations)
    .where(eq(kpiContentRegistrations.batchId, batch.batchKey))
    .orderBy(kpiContentRegistrations.batchPosition, kpiContentRegistrations.id)
    .all();

  return { batch, items };
}

type LoadedKpiContentBatch = NonNullable<Awaited<ReturnType<typeof loadBatch>>>;

function normalizeKpiContentStatus(result: KpiContentScriptResponse): KpiContentStatus {
  if (result.completed) return "completed";
  if (result.formSubmitted) return "form_submitted";
  return "failed";
}

async function callKpiContentScript(input: {
  batch: LoadedKpiContentBatch["batch"];
  items: LoadedKpiContentBatch["items"];
  requestedByUserId: number;
  requestedByDisplayName: string;
}) {
  const webAppUrl = normalizeText(process.env.KPI_CONTENT_SCRIPT_WEB_APP_URL);
  if (!webAppUrl) {
    return {
      skipped: true,
      message: "Chua cau hinh KPI_CONTENT_SCRIPT_WEB_APP_URL.",
    } as const;
  }

  const secret = normalizeText(process.env.KPI_CONTENT_SCRIPT_SECRET);
  if (!secret) {
    return {
      skipped: true,
      message: "Chua cau hinh KPI_CONTENT_SCRIPT_SECRET.",
    } as const;
  }

  const payload = {
    action: "registerKpiContent",
    secret,
    batch: {
      batchId: input.batch.batchKey,
      batchSize: input.batch.batchSize,
      employeeCode: input.batch.employeeCode,
      taskLabel: input.batch.taskLabel,
      detailLabel: input.batch.detailLabel,
    },
    requestedBy: {
      userId: input.requestedByUserId,
      displayName: input.requestedByDisplayName,
    },
    articles: input.items.map((item) => ({
      articleId: item.articleId,
      title: item.title,
      articleLink: normalizeText(item.articleLink),
      articleDate: item.articleDate,
      penName: item.penName,
      position: item.batchPosition,
    })),
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), KPI_CONTENT_AUTOMATION_TIMEOUT_MS);

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
          message: normalizeKpiContentScriptMessage(normalizeText(parsed?.error) || normalizeText(parsed?.message) || `KPI Content script tra ve loi ${response.status}.`),
          response: parsed,
        } as const;
      }

      return {
        skipped: false,
        success: true,
        message: normalizeText(parsed?.message) || "Da xu ly KPI Content.",
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
        ? "KPI Content script phan hoi qua cham."
        : (normalizeKpiContentScriptMessage(message) || "Khong goi duoc KPI Content Apps Script."),
      response: null,
    } as const;
  }
}

async function syncBatchState(
  batchId: number,
  batchKey: string,
  status: KpiContentStatus,
  message: string,
  extra?: { submittedAt?: string; completedAt?: string },
) {
  await updateBatch(batchId, {
    status,
    automationMessage: message,
    lastError: status === "failed" ? message : null,
    submittedAt: extra?.submittedAt,
    completedAt: extra?.completedAt,
  });

  await updateBatchItems(batchKey, {
    status,
    automationMessage: message,
    lastError: status === "failed" ? message : null,
    submittedAt: extra?.submittedAt,
    completedAt: extra?.completedAt,
  });
}

export async function processKpiContentRegistrationJob(input: {
  batchId: number;
  requestedByUserId: number;
  requestedByDisplayName: string;
}) {
  await ensureDatabaseInitialized();
  await ensureKpiContentSchemaInitialized();

  const loaded = await loadBatch(input.batchId);
  if (!loaded) {
    return;
  }

  const { batch, items } = loaded;

  if (!batch.employeeCode) {
    const errorMessage = "Chua co ma nhan vien KPI Content.";
    await syncBatchState(batch.id, batch.batchKey, "failed", errorMessage);
    await writeAuditLog({
      userId: input.requestedByUserId,
      action: "kpi_content_registration_failed",
      entity: "kpi_content_registration",
      entityId: String(batch.id),
      payload: { batchKey: batch.batchKey, reason: "missing_employee_code", errorMessage },
    });
    await publishRealtimeEvent({
      channels: ["kpi-content"],
      userIds: [input.requestedByUserId],
      toastTitle: "Dang ky KPI Content that bai",
      toastMessage: errorMessage,
      toastVariant: "error",
    });
    return;
  }

  if (!batch.taskLabel || !batch.detailLabel) {
    const errorMessage = "Khong xac dinh duoc loai KPI Content cho loi dang ky nay.";
    await syncBatchState(batch.id, batch.batchKey, "failed", errorMessage);
    await writeAuditLog({
      userId: input.requestedByUserId,
      action: "kpi_content_registration_failed",
      entity: "kpi_content_registration",
      entityId: String(batch.id),
      payload: { batchKey: batch.batchKey, reason: "unsupported_task", articles: items.map((item) => item.articleId) },
    });
    await publishRealtimeEvent({
      channels: ["kpi-content"],
      userIds: [input.requestedByUserId],
      toastTitle: "Chua xac dinh duoc KPI Content",
      toastMessage: errorMessage,
      toastVariant: "error",
    });
    return;
  }

  await updateBatch(batch.id, {
    status: "submitting_form",
    automationMessage: "Dang gui form KPI Content...",
    lastError: null,
    taskLabel: batch.taskLabel,
    detailLabel: batch.detailLabel,
  });
  await updateBatchItems(batch.batchKey, {
    status: "submitting_form",
    automationMessage: "Dang gui form KPI Content...",
    lastError: null,
    taskLabel: batch.taskLabel,
    detailLabel: batch.detailLabel,
  });

  const result = await callKpiContentScript({
    batch,
    items,
    requestedByUserId: input.requestedByUserId,
    requestedByDisplayName: input.requestedByDisplayName,
  });

  if (result.skipped || !result.success) {
    const errorMessage = result.message;
    await syncBatchState(batch.id, batch.batchKey, "failed", errorMessage);
    await writeAuditLog({
      userId: input.requestedByUserId,
      action: "kpi_content_registration_failed",
      entity: "kpi_content_registration",
      entityId: String(batch.id),
      payload: {
        batchKey: batch.batchKey,
        articles: items.map((item) => item.articleId),
        errorMessage,
        response: result.response,
      },
    });
    await publishRealtimeEvent({
      channels: ["kpi-content"],
      userIds: [input.requestedByUserId],
      toastTitle: "Dang ky KPI Content that bai",
      toastMessage: errorMessage,
      toastVariant: "error",
    });
    await createNotification({
      toUserId: input.requestedByUserId,
      toPenName: items[0]?.penName || input.requestedByDisplayName,
      type: "system",
      title: "Dang ky KPI Content that bai",
      message: `${items[0]?.title || "KPI Content"}: ${errorMessage}`,
      relatedArticleId: items[0]?.articleId || null,
    });
    return;
  }

  const response = result.response || {};
  const status = normalizeKpiContentStatus(response);
  const message = normalizeText(response.message) || result.message || getKpiContentStatusLabel(status);

  await syncBatchState(batch.id, batch.batchKey, status, message, {
    submittedAt: response.submittedAt || new Date().toISOString(),
    completedAt: response.completedAt || (status === "completed" ? new Date().toISOString() : undefined),
  });

  await writeAuditLog({
    userId: input.requestedByUserId,
    action: "kpi_content_registration_completed",
    entity: "kpi_content_registration",
    entityId: String(batch.id),
    payload: {
      batchKey: batch.batchKey,
      articles: items.map((item) => item.articleId),
      status,
      response,
    },
  });

  await publishRealtimeEvent({
    channels: ["kpi-content", "team"],
    userIds: [input.requestedByUserId],
    toastTitle: status === "completed" ? "Dang ky KPI Content thanh cong" : "Da gui form KPI Content",
    toastMessage: message,
    toastVariant: status === "completed" ? "success" : "warning",
  });

  await createNotification({
    toUserId: input.requestedByUserId,
    toPenName: items[0]?.penName || input.requestedByDisplayName,
    type: "system",
    title: status === "completed" ? "Dang ky KPI Content thanh cong" : "Da gui form KPI Content",
    message: `${items[0]?.title || "KPI Content"}: ${message}`,
    relatedArticleId: items[0]?.articleId || null,
  });
}
