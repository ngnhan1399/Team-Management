import { db, ensureDatabaseInitialized } from "@/db";
import { collaborators } from "@/db/schema";
import { getCurrentUserContext, hasArticleManagerAccess } from "@/lib/auth";
import { prepareArticleImport } from "@/lib/article-import";
import { enforceTrustedOrigin } from "@/lib/request-security";
import { handleServerError } from "@/lib/server-error";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    await ensureDatabaseInitialized();
    const originError = enforceTrustedOrigin(request);
    if (originError) return originError;

    const context = await getCurrentUserContext();
    if (!context) {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    }
    if (!hasArticleManagerAccess(context)) {
      return NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const sheetName = String(formData.get("sheetName") || "").trim() || undefined;
    const headerRowNumberRaw = String(formData.get("headerRowNumber") || "").trim();
    const headerRowNumber = headerRowNumberRaw ? Number(headerRowNumberRaw) : undefined;

    if (!file) {
      return NextResponse.json({ success: false, error: "Chua chon file" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const collaboratorPenNames = (await db
      .select({ penName: collaborators.penName })
      .from(collaborators)
      .all())
      .map((item) => item.penName);

    const prepared = prepareArticleImport(buffer, {
      sheetName,
      headerRowNumber,
      collaboratorPenNames,
    });

    return NextResponse.json({
      success: true,
      ...prepared.analysis,
    });
  } catch (error) {
    return handleServerError("articles.import.analyze", error);
  }
}
