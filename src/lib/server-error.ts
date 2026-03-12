import { NextResponse } from "next/server";

const GENERIC_ERROR_MESSAGE = "Hệ thống đang gặp lỗi. Vui lòng thử lại sau.";
const DATABASE_QUOTA_EXCEEDED_MESSAGE = "Cơ sở dữ liệu hiện đã vượt quota băng thông của chu kỳ hiện tại, nên tạm thời chưa thể đăng nhập hoặc tải dữ liệu. Bạn cần kiểm tra lại gói database hoặc chờ quota reset rồi thử lại.";

function isDatabaseQuotaExceededError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const payload = error as { code?: unknown; message?: unknown };
  const code = String(payload.code || "").trim().toUpperCase();
  const message = String(payload.message || "").toLowerCase();
  return code === "XX000" && message.includes("data transfer quota");
}

export function handleServerError(scope: string, error: unknown) {
  console.error(`[${scope}]`, error);

  if (isDatabaseQuotaExceededError(error)) {
    return NextResponse.json(
      { success: false, error: DATABASE_QUOTA_EXCEEDED_MESSAGE },
      { status: 503 }
    );
  }

  return NextResponse.json(
    { success: false, error: GENERIC_ERROR_MESSAGE },
    { status: 500 }
  );
}
