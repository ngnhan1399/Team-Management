import { NextResponse } from "next/server";

const GENERIC_ERROR_MESSAGE = "Hệ thống đang gặp lỗi. Vui lòng thử lại sau.";

export function handleServerError(scope: string, error: unknown) {
  console.error(`[${scope}]`, error);
  return NextResponse.json(
    { success: false, error: GENERIC_ERROR_MESSAGE },
    { status: 500 }
  );
}
