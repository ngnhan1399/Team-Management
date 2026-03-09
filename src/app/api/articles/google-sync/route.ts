import { ensureDatabaseInitialized } from "@/db";
import { getCurrentUserContext } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { executeGoogleSheetSync } from "@/lib/google-sheet-sync";
import { publishRealtimeEvent } from "@/lib/realtime";
import { enforceTrustedOrigin } from "@/lib/request-security";
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

export async function POST(request: NextRequest) {
  try {
    await ensureDatabaseInitialized();
    const originError = enforceTrustedOrigin(request);
    if (originError) return originError;

    const context = await getCurrentUserContext();
    if (!context) {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    }
    if (context.user.role !== "admin") {
      return NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const month = parseOptionalNumber(body.month, "Tháng");
    const year = parseOptionalNumber(body.year, "Năm");
    const sourceUrl = normalizeText(body.sourceUrl);

    if ((month === null) !== (year === null)) {
      return NextResponse.json(
        { success: false, error: "Hãy nhập đủ cả tháng và năm, hoặc để trống để dùng tab mới nhất." },
        { status: 400 }
      );
    }

    if (month !== null && (month < 1 || month > 12)) {
      return NextResponse.json({ success: false, error: "Tháng phải nằm trong khoảng 1-12." }, { status: 400 });
    }

    if (year !== null && (year < 2000 || year > 2100)) {
      return NextResponse.json({ success: false, error: "Năm không hợp lệ." }, { status: 400 });
    }

    const result = await executeGoogleSheetSync({
      sourceUrl: sourceUrl || undefined,
      month,
      year,
      createdByUserId: context.user.id,
    });

    await writeAuditLog({
      userId: context.user.id,
      action: "articles_google_sheet_synced",
      entity: "article",
      payload: {
        ...result,
        triggeredBy: "manual",
      },
    });

    await publishRealtimeEvent({
      channels: ["articles", "dashboard", "royalty"],
      toastTitle: "Đồng bộ Google Sheet hoàn tất",
      toastMessage: `${result.sheetName}: thêm ${result.inserted}, bỏ qua ${result.duplicates} bài đã có.`,
      toastVariant: "success",
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    return handleServerError("articles.google-sync.post", error);
  }
}
