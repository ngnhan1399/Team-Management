import { ensureDatabaseInitialized } from "@/db";
import { writeAuditLog } from "@/lib/audit";
import {
  executeGoogleSheetSync,
  parseSheetTabInfo,
  type GoogleSheetSyncExecutionResult,
} from "@/lib/google-sheet-sync";
import { publishRealtimeEvent } from "@/lib/realtime";
import { handleServerError } from "@/lib/server-error";
import { NextRequest, NextResponse } from "next/server";

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function parseOptionalNumber(value: unknown, label: string) {
  const raw = normalizeText(value);
  if (!raw) return null;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${label} không hợp lệ.`);
  }

  return parsed;
}

function readSecretFromRequest(request: NextRequest, body: Record<string, unknown>) {
  const authorization = request.headers.get("authorization") || "";
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);

  return (
    request.headers.get("x-google-sheets-secret")
    || request.headers.get("x-webhook-secret")
    || bearerMatch?.[1]
    || normalizeText(body.secret)
  );
}

function buildWebhookResponse(result: GoogleSheetSyncExecutionResult, ignored = false, message?: string) {
  return NextResponse.json({
    success: true,
    ignored,
    message,
    ...result,
  });
}

export async function GET() {
  return NextResponse.json({
    success: true,
    message: "Google Sheets webhook is ready.",
  });
}

export async function POST(request: NextRequest) {
  try {
    await ensureDatabaseInitialized();

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const secret = readSecretFromRequest(request, body);
    const expectedSecret = process.env.GOOGLE_SHEETS_WEBHOOK_SECRET?.trim();

    if (!expectedSecret) {
      return NextResponse.json(
        { success: false, error: "Webhook chưa được cấu hình secret." },
        { status: 503 }
      );
    }

    if (!secret || secret !== expectedSecret) {
      return NextResponse.json(
        { success: false, error: "Webhook secret không hợp lệ." },
        { status: 401 }
      );
    }

    const sheetName = normalizeText(body.sheetName);
    if (sheetName && !parseSheetTabInfo(sheetName)) {
      return NextResponse.json({
        success: true,
        ignored: true,
        message: `Bỏ qua tab "${sheetName}" vì không phải tab tháng/năm.`,
      });
    }

    const month = parseOptionalNumber(body.month, "Tháng");
    const year = parseOptionalNumber(body.year, "Năm");
    const sourceUrl = normalizeText(body.sourceUrl);

    if ((month === null) !== (year === null)) {
      return NextResponse.json(
        { success: false, error: "Webhook cần truyền đủ cả tháng và năm, hoặc bỏ trống cả hai." },
        { status: 400 }
      );
    }

    const result = await executeGoogleSheetSync({
      sourceUrl: sourceUrl || undefined,
      sheetName: sheetName || undefined,
      month,
      year,
      createdByUserId: null,
    });

    await writeAuditLog({
      userId: null,
      action: "articles_google_sheet_webhook_synced",
      entity: "article",
      payload: {
        ...result,
        triggeredBy: "google_apps_script",
      },
    });

    await publishRealtimeEvent({
      channels: ["articles", "dashboard", "royalty"],
      toastTitle: "Google Sheet vừa được đồng bộ",
      toastMessage: `${result.sheetName}: thêm ${result.inserted}, bỏ qua ${result.duplicates} bài đã có.`,
      toastVariant: "success",
    });

    return buildWebhookResponse(result);
  } catch (error) {
    return handleServerError("articles.google-sync.webhook.post", error);
  }
}
