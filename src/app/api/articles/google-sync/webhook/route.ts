import { createHash, timingSafeEqual } from "node:crypto";
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

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

function sha256Hex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function matchesSecret(secret: string | null, envSecret: string) {
  if (!secret) return false;

  const receivedHash = sha256Hex(secret);
  const expectedHash = sha256Hex(envSecret.trim());

  return timingSafeEqual(
    Buffer.from(receivedHash, "utf8"),
    Buffer.from(expectedHash, "utf8")
  );
}

function resolveProductionSourceUrlOverride(value: unknown) {
  const sourceUrl = normalizeText(value);
  if (!sourceUrl) {
    return undefined;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("Webhook không cho phép override sourceUrl trên production.");
  }

  return sourceUrl;
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
        { success: false, error: "Webhook secret chưa được cấu hình." },
        { status: 503 }
      );
    }

    if (!matchesSecret(secret || null, expectedSecret)) {
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
    const sourceUrl = resolveProductionSourceUrlOverride(body.sourceUrl);

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
    });

    return buildWebhookResponse(result);
  } catch (error) {
    return handleServerError("articles.google-sync.webhook.post", error);
  }
}
