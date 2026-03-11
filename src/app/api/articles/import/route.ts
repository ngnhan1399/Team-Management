import { db, ensureDatabaseInitialized } from "@/db";
import {
  articleComments,
  articleReviews,
  articles,
  collaborators,
  notifications,
  payments,
} from "@/db/schema";
import { getCurrentUserContext, hasArticleManagerAccess } from "@/lib/auth";
import {
  normalizeImportedArticleRow,
  prepareArticleImport,
  type ImportFieldId,
} from "@/lib/article-import";
import { writeAuditLog } from "@/lib/audit";
import { enforceTrustedOrigin } from "@/lib/request-security";
import { handleServerError } from "@/lib/server-error";
import { isNotNull } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

const REQUIRED_FIELDS: ImportFieldId[] = ["date", "title", "penName"];

function sanitizeMapping(value: unknown): Record<string, ImportFieldId> {
  if (!value || typeof value !== "object") return {};

  const allowedFields = new Set<ImportFieldId>([
    "articleId",
    "date",
    "title",
    "penName",
    "category",
    "articleType",
    "contentType",
    "wordCountRange",
    "status",
    "link",
    "reviewerName",
    "notes",
  ]);

  const mapping: Record<string, ImportFieldId> = {};

  for (const [columnKey, field] of Object.entries(value as Record<string, unknown>)) {
    if (typeof field !== "string") continue;
    if (!allowedFields.has(field as ImportFieldId)) continue;
    mapping[columnKey] = field as ImportFieldId;
  }

  return mapping;
}

function validateMapping(mapping: Record<string, ImportFieldId>) {
  const usedFields = new Map<ImportFieldId, string>();
  for (const [columnKey, field] of Object.entries(mapping)) {
    if (usedFields.has(field)) {
      return `Trường "${field}" đang được map bởi cả cột ${usedFields.get(field)} và ${columnKey}.`;
    }
    usedFields.set(field, columnKey);
  }

  const missingFields = REQUIRED_FIELDS.filter((field) => !usedFields.has(field));
  if (missingFields.length > 0) {
    return `Thiếu mapping cho các trường bắt buộc: ${missingFields.join(", ")}.`;
  }

  return null;
}

function normalizeCompositeKey(title: string, penName: string, date: string): string {
  return `${title.toLowerCase().trim()}|||${penName.toLowerCase().trim()}|||${date}`;
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
    if (!hasArticleManagerAccess(context)) {
      return NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const mappingStr = String(formData.get("mapping") || "");
    const sheetName = String(formData.get("sheetName") || "").trim() || undefined;
    const headerRowNumberRaw = String(formData.get("headerRowNumber") || "").trim();
    const replaceExisting = String(formData.get("replaceExisting") || "false") === "true";
    const dryRun = String(formData.get("dryRun") || "false") === "true";
    const headerRowNumber = headerRowNumberRaw ? Number(headerRowNumberRaw) : undefined;

    if (!file) {
      return NextResponse.json({ success: false, error: "Chưa chọn file" }, { status: 400 });
    }

    let mappingPayload: unknown = {};
    try {
      mappingPayload = mappingStr ? JSON.parse(mappingStr) : {};
    } catch {
      return NextResponse.json({ success: false, error: "Mapping không hợp lệ" }, { status: 400 });
    }

    const mapping = sanitizeMapping(mappingPayload);
    const mappingError = validateMapping(mapping);
    if (mappingError) {
      return NextResponse.json({ success: false, error: mappingError }, { status: 400 });
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

    if (prepared.rawRows.length === 0) {
      return NextResponse.json({ success: false, error: "Không tìm thấy dòng dữ liệu hợp lệ để nhập." }, { status: 400 });
    }

    if (replaceExisting) {
      await db.delete(articleComments).run();
      await db.delete(articleReviews).run();
      await db.delete(notifications).where(isNotNull(notifications.relatedArticleId)).run();
      await db.delete(payments).run();
      await db.delete(articles).run();
    }

    const existingArticles = replaceExisting
      ? []
      : await db
          .select({
            articleId: articles.articleId,
            title: articles.title,
            penName: articles.penName,
            date: articles.date,
          })
          .from(articles)
          .all();

    const existingCompositeKeys = new Set(
      existingArticles.map((item) => normalizeCompositeKey(item.title, item.penName, item.date))
    );
    const existingArticleIds = new Set(
      existingArticles
        .map((item) => item.articleId?.trim())
        .filter((value): value is string => Boolean(value))
    );

    let imported = 0;
    let skipped = 0;
    let duplicates = 0;
    const errors: string[] = [];
    const previewRows: Array<{
      rowNumber: number;
      canImport: boolean;
      duplicate: boolean;
      duplicateReason?: string;
      issues: string[];
      normalized: {
        articleId?: string;
        date?: string | null;
        title: string;
        penName: string;
        status: "Draft" | "Submitted" | "Reviewing" | "NeedsFix" | "Approved" | "Published" | "Rejected";
        link?: string;
        reviewerName?: string;
        notes?: string;
      };
    }> = [];

    for (const row of prepared.rawRows) {
      try {
        const { normalized, issues } = normalizeImportedArticleRow(row, mapping, collaboratorPenNames);
        const rowIssues = [...issues];
        const hasRequired = Boolean(normalized.date && normalized.title && normalized.penName);
        const compositeKey = normalized.date
          ? normalizeCompositeKey(normalized.title, normalized.penName, normalized.date)
          : "";
        const articleId = normalized.articleId?.trim();
        let duplicateReason = "";
        let isDuplicate = false;

        if (hasRequired && articleId && existingArticleIds.has(articleId)) {
          isDuplicate = true;
          duplicateReason = "Mã bài viết đã tồn tại";
        } else if (hasRequired && existingCompositeKeys.has(compositeKey)) {
          isDuplicate = true;
          duplicateReason = "Trùng tiêu đề + bút danh + ngày viết";
        }

        if (!hasRequired && rowIssues.length === 0) {
          rowIssues.push("Thiếu dữ liệu bắt buộc");
        }
        if (isDuplicate) {
          rowIssues.push(duplicateReason);
          duplicates += 1;
        }

        const canImport = hasRequired && rowIssues.length === 0 && !isDuplicate;
        if (!canImport && !isDuplicate) {
          skipped += 1;
          errors.push(`Dòng ${row.rowNumber}: ${rowIssues.join("; ") || "Thiếu dữ liệu bắt buộc"}`);
        }

        if (canImport) {
          const normalizedDate = normalized.date as string;
          if (!dryRun) {
            await db.insert(articles)
              .values({
                articleId: articleId || undefined,
                date: normalizedDate,
                title: normalized.title,
                penName: normalized.penName,
                category: normalized.category as never,
                articleType: normalized.articleType as never,
                contentType: normalized.contentType as never,
                wordCountRange: normalized.wordCountRange as never,
                status: normalized.status as never,
                link: normalized.link,
                reviewerName: normalized.reviewerName,
                notes: normalized.notes,
              })
              .run();
          }

          existingCompositeKeys.add(compositeKey);
          if (articleId) existingArticleIds.add(articleId);
          imported += 1;
        }

        if (previewRows.length < 30) {
          previewRows.push({
            rowNumber: row.rowNumber,
            canImport,
            duplicate: isDuplicate,
            duplicateReason: isDuplicate ? duplicateReason : undefined,
            issues: rowIssues,
            normalized: {
              articleId: normalized.articleId,
              date: normalized.date,
              title: normalized.title,
              penName: normalized.penName,
              status: normalized.status,
              link: normalized.link,
              reviewerName: normalized.reviewerName,
              notes: normalized.notes,
            },
          });
        }
      } catch (rowError) {
        skipped += 1;
        errors.push(`Dòng ${row.rowNumber}: ${String(rowError)}`);
        if (previewRows.length < 30) {
          previewRows.push({
            rowNumber: row.rowNumber,
            canImport: false,
            duplicate: false,
            issues: [String(rowError)],
            normalized: {
              title: "",
              penName: "",
              status: "Draft",
            },
          });
        }
      }
    }

    if (dryRun) {
      return NextResponse.json({
        success: true,
        dryRun: true,
        total: prepared.rawRows.length,
        importable: imported,
        skipped,
        duplicates,
        previewRows,
        sheetName: prepared.analysis.sheetName,
        headerRowNumber: prepared.analysis.headerRowNumber,
        warnings: prepared.analysis.warnings,
      });
    }

    await writeAuditLog({
      userId: context.user.id,
      action: "articles_imported",
      entity: "article",
      payload: {
        sheetName: prepared.analysis.sheetName,
        headerRowNumber: prepared.analysis.headerRowNumber,
        replaceExisting,
        imported,
        skipped,
        duplicates,
        total: prepared.rawRows.length,
      },
    });

    return NextResponse.json({
      success: true,
      total: prepared.rawRows.length,
      imported,
      skipped,
      duplicates,
      errors: errors.slice(0, 20),
      clearedExisting: replaceExisting,
      sheetName: prepared.analysis.sheetName,
      headerRowNumber: prepared.analysis.headerRowNumber,
      warnings: prepared.analysis.warnings,
    });
  } catch (error) {
    return handleServerError("articles.import.post", error);
  }
}
