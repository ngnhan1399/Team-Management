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
const KPI_CONTENT_FORM_PUBLIC_ID = "1FAIpQLScS-CMH8FwKAQQ_dcAGRzF__2l7G_dYo2Z4UxR5h--3XOF1_w";
const KPI_CONTENT_FORM_VIEW_URL = `https://docs.google.com/forms/d/e/${KPI_CONTENT_FORM_PUBLIC_ID}/viewform`;
const KPI_CONTENT_FORM_RESPONSE_URL = `https://docs.google.com/forms/d/e/${KPI_CONTENT_FORM_PUBLIC_ID}/formResponse`;

const KPI_CONTENT_FORM_ENTRY_IDS = {
  employeeCode: "entry.2063490353",
  task: "entry.1997176339",
  newsDetail: "entry.1511448067",
  descriptionDetail: "entry.1417839557",
  link1: "entry.1708619375",
  link2: "entry.115890814",
  link3: "entry.1057708020",
  link4: "entry.779972713",
  link5: "entry.1418536144",
} as const;

const KPI_CONTENT_TASK_OPTIONS = {
  news: "Vi\u1ebft b\u00e0i tin t\u1ee9c",
  description: "M\u00f4 t\u1ea3 s\u1ea3n ph\u1ea9m",
} as const;

const KPI_CONTENT_NEWS_DETAILS = {
  seoAi: "SEO AI",
  hardLong: "B\u00e0i d\u00e0i - kh\u00f3",
} as const;

const KPI_CONTENT_DESCRIPTION_DETAILS = {
  long: "Vi\u1ebft m\u00f4 t\u1ea3 d\u00e0i",
  short: "Vi\u1ebft m\u00f4 t\u1ea3 ng\u1eafn",
} as const;

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

type KpiContentAutomationResponse = {
  success?: boolean;
  message?: string;
  error?: string;
  formSubmitted?: boolean;
  completed?: boolean;
  submittedAt?: string;
  completedAt?: string;
  via?: "apps-script" | "direct-form";
};

type LoadedKpiContentBatch = NonNullable<Awaited<ReturnType<typeof loadBatch>>>;

type DirectFormState = {
  fbzx: string;
  partialResponse: string;
  sentinelNames: string[];
};

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function foldText(value: string) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/gi, "d")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function parseJsonSafely(value: string) {
  try {
    return value ? JSON.parse(value) as KpiContentAutomationResponse : null;
  } catch {
    return null;
  }
}

function decodeHtmlEntities(value: string) {
  return normalizeText(value)
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizeKpiContentAutomationMessage(message: string) {
  const normalized = normalizeText(message);
  if (!normalized) {
    return normalized;
  }

  const folded = foldText(normalized);

  if (/urlfetchapp\.fetch/i.test(normalized) || /script\.external_request/i.test(normalized)) {
    return "KPI Content Apps Script chua duoc cap quyen goi dich vu ngoai. Hay mo script va authorize mot lan.";
  }

  if (/data-validation-failed/i.test(normalized) || (/form/i.test(folded) && /400/.test(normalized))) {
    return "KPI Content dang gui sai hoac thieu truong bat buoc cua Google Form. Hay kiem tra lai entry id va option label.";
  }

  if (/login|sign in|dang nhap/i.test(folded)) {
    return "Google Form KPI Content dang yeu cau dang nhap hoac da doi quyen truy cap.";
  }

  return normalized;
}

function resolveTaskOption(taskLabel: string) {
  const folded = foldText(taskLabel);
  if (folded.includes("mo ta")) {
    return KPI_CONTENT_TASK_OPTIONS.description;
  }
  return KPI_CONTENT_TASK_OPTIONS.news;
}

function resolveDetailOption(taskLabel: string, detailLabel: string) {
  const foldedDetail = foldText(detailLabel);

  if (resolveTaskOption(taskLabel) === KPI_CONTENT_TASK_OPTIONS.description) {
    if (foldedDetail.includes("ngan")) {
      return KPI_CONTENT_DESCRIPTION_DETAILS.short;
    }
    return KPI_CONTENT_DESCRIPTION_DETAILS.long;
  }

  if (foldedDetail.includes("bai dai") || foldedDetail.includes("kho")) {
    return KPI_CONTENT_NEWS_DETAILS.hardLong;
  }

  return KPI_CONTENT_NEWS_DETAILS.seoAi;
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

function normalizeKpiContentStatus(result: KpiContentAutomationResponse): KpiContentStatus {
  if (result.completed) return "completed";
  if (result.formSubmitted) return "form_submitted";
  return "failed";
}

async function fetchKpiContentFormState(signal: AbortSignal): Promise<DirectFormState> {
  const response = await fetch(KPI_CONTENT_FORM_VIEW_URL, {
    method: "GET",
    cache: "no-store",
    signal,
  });
  const html = await response.text();

  if (!response.ok || !html) {
    throw new Error(`Khong tai duoc Google Form KPI Content (HTTP ${response.status}).`);
  }

  const fbzxMatch = html.match(/name="fbzx"\s+value="([^"]+)"/i);
  const partialResponseMatch = html.match(/name="partialResponse"\s+value="([^"]*)"/i);
  const sentinelMatches = html.match(/name="entry\.\d+_sentinel"/g) || [];

  if (!fbzxMatch?.[1]) {
    throw new Error("Khong lay duoc token fbzx cua Google Form KPI Content.");
  }

  return {
    fbzx: fbzxMatch[1],
    partialResponse: partialResponseMatch?.[1] ? decodeHtmlEntities(partialResponseMatch[1]) : "",
    sentinelNames: sentinelMatches.map((value) => value.replace(/^name="|"$|\s+/g, "")),
  };
}

function buildKpiContentFormPayload(input: {
  formState: DirectFormState;
  batch: LoadedKpiContentBatch["batch"];
  items: LoadedKpiContentBatch["items"];
}) {
  const taskOption = resolveTaskOption(input.batch.taskLabel);
  const detailOption = resolveDetailOption(input.batch.taskLabel, input.batch.detailLabel);
  const payload = new URLSearchParams();

  payload.set("fvv", "1");
  payload.set("pageHistory", "0,1,2");
  payload.set("fbzx", input.formState.fbzx);
  if (input.formState.partialResponse) {
    payload.set("partialResponse", input.formState.partialResponse);
  }

  payload.set(KPI_CONTENT_FORM_ENTRY_IDS.employeeCode, normalizeText(input.batch.employeeCode));
  payload.set(KPI_CONTENT_FORM_ENTRY_IDS.task, taskOption);

  if (taskOption === KPI_CONTENT_TASK_OPTIONS.description) {
    payload.set(KPI_CONTENT_FORM_ENTRY_IDS.descriptionDetail, detailOption);
    payload.set(KPI_CONTENT_FORM_ENTRY_IDS.newsDetail, "");
  } else {
    payload.set(KPI_CONTENT_FORM_ENTRY_IDS.newsDetail, detailOption);
    payload.set(KPI_CONTENT_FORM_ENTRY_IDS.descriptionDetail, "");
  }

  const linkKeys = [
    KPI_CONTENT_FORM_ENTRY_IDS.link1,
    KPI_CONTENT_FORM_ENTRY_IDS.link2,
    KPI_CONTENT_FORM_ENTRY_IDS.link3,
    KPI_CONTENT_FORM_ENTRY_IDS.link4,
    KPI_CONTENT_FORM_ENTRY_IDS.link5,
  ] as const;

  linkKeys.forEach((key, index) => {
    payload.set(key, normalizeText(input.items[index]?.articleLink));
  });

  input.formState.sentinelNames.forEach((name) => {
    payload.set(name, "");
  });

  return payload;
}

async function submitKpiContentDirectly(input: {
  batch: LoadedKpiContentBatch["batch"];
  items: LoadedKpiContentBatch["items"];
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), KPI_CONTENT_AUTOMATION_TIMEOUT_MS);

  try {
    const formState = await fetchKpiContentFormState(controller.signal);
    const payload = buildKpiContentFormPayload({
      formState,
      batch: input.batch,
      items: input.items,
    });

    const response = await fetch(KPI_CONTENT_FORM_RESPONSE_URL, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: payload.toString(),
      redirect: "follow",
      signal: controller.signal,
    });
    const body = await response.text();

    if (
      !response.ok ||
      /data-validation-failed="true"/i.test(body) ||
      /da xay ra loi/i.test(body) ||
      /vui long thu lai/i.test(body)
    ) {
      throw new Error(`Gui KPI Content form that bai (HTTP ${response.status}).`);
    }

    const now = new Date().toISOString();
    return {
      skipped: false,
      success: true,
      message: "Da gui KPI Content form truc tiep.",
      response: {
        success: true,
        message: "Da gui KPI Content form truc tiep.",
        formSubmitted: true,
        completed: true,
        submittedAt: now,
        completedAt: now,
        via: "direct-form",
      } satisfies KpiContentAutomationResponse,
    } as const;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      skipped: false,
      success: false,
      message: /aborted|timeout/i.test(message)
        ? "Gui KPI Content truc tiep toi Google Form bi timeout."
        : (normalizeKpiContentAutomationMessage(message) || "Khong gui duoc KPI Content toi Google Form."),
      response: null,
    } as const;
  } finally {
    clearTimeout(timeout);
  }
}

async function callKpiContentScript(input: {
  batch: LoadedKpiContentBatch["batch"];
  items: LoadedKpiContentBatch["items"];
  requestedByUserId: number;
  requestedByDisplayName: string;
}) {
  const webAppUrl = normalizeText(process.env.KPI_CONTENT_SCRIPT_WEB_APP_URL);
  const secret = normalizeText(process.env.KPI_CONTENT_SCRIPT_SECRET);

  if (!webAppUrl || !secret) {
    return submitKpiContentDirectly({
      batch: input.batch,
      items: input.items,
    });
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
          message: normalizeKpiContentAutomationMessage(
            normalizeText(parsed?.error) || normalizeText(parsed?.message) || `KPI Content script tra ve loi ${response.status}.`,
          ),
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
        : (normalizeKpiContentAutomationMessage(message) || "Khong goi duoc KPI Content Apps Script."),
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
