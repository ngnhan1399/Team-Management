import { ensureDatabaseInitialized } from "@/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureDatabaseInitialized();
    return NextResponse.json({
      ok: true,
      service: "ctv-management",
      checkedAt: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        service: "ctv-management",
      },
      { status: 503 }
    );
  }
}
