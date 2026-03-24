import { ensureDatabaseInitialized, getDatabaseBootstrapMode, pingDatabase } from "@/db";
import { diagnoseRuntimeError, validateDatabaseUrl, validateJwtSecret } from "@/lib/runtime-diagnostics";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const jwtIssue = validateJwtSecret();
    if (jwtIssue) {
      return NextResponse.json(
        {
          ok: false,
          service: "ctv-management",
          checkedAt: new Date().toISOString(),
        },
        { status: 503 }
      );
    }

    const databaseIssue = validateDatabaseUrl();
    if (databaseIssue) {
      return NextResponse.json(
        {
          ok: false,
          service: "ctv-management",
          checkedAt: new Date().toISOString(),
        },
        { status: 503 }
      );
    }

    const databaseBootstrapMode = getDatabaseBootstrapMode();
    if (databaseBootstrapMode === "skip") {
      await pingDatabase();
    } else {
      await ensureDatabaseInitialized();
    }

    return NextResponse.json({
      ok: true,
      service: "ctv-management",
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    diagnoseRuntimeError(error);
    return NextResponse.json(
      {
        ok: false,
        service: "ctv-management",
        checkedAt: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
