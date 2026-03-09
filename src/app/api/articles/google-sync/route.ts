import { db, ensureDatabaseInitialized } from "@/db";
import { articles, collaborators } from "@/db/schema";
import { getCurrentUserContext } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { loadGoogleSheetImport } from "@/lib/google-sheet-sync";
import { normalizeImportedArticleRow, type ImportFieldId } from "@/lib/article-import";
import { publishRealtimeEvent } from "@/lib/realtime";
import { enforceTrustedOrigin } from "@/lib/request-security";
import { handleServerError } from "@/lib/server-error";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

type ExistingArticleRow = {
  id: number;
  articleId: string | null;
  title: string;
  penName: string;
  date: string;
};

type NormalizedArticle = ReturnType<typeof normalizeImportedArticleRow>["normalized"];

const REQUIRED_FIELDS: ImportFieldId[] = ["date", "title", "penName"];

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function normalizeCompositeKey(title: string, penName: string, date: string) {
  return `${title.toLowerCase().trim()}|||${penName.toLowerCase().trim()}|||${date}`;
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

function resolveMapping(mapping: Record<string, ImportFieldId | null>) {
  const resolved: Record<string, ImportFieldId> = {};

  for (const [columnKey, field] of Object.entries(mapping)) {
    if (!field) continue;
    resolved[columnKey] = field;
  }

  return resolved;
}

function buildArticlePayload(
  normalized: NormalizedArticle,
  mappedFields: Set<ImportFieldId>
): Partial<typeof articles.$inferInsert> {
  const values: Partial<typeof articles.$inferInsert> = {
    date: normalized.date as string,
    title: normalized.title,
    penName: normalized.penName,
  };

  if (mappedFields.has("articleId")) values.articleId = normalized.articleId ?? null;
  if (mappedFields.has("category")) values.category = normalized.category as never;
  if (mappedFields.has("articleType") || mappedFields.has("category") || mappedFields.has("wordCountRange")) {
    values.articleType = normalized.articleType as never;
  }
  if (mappedFields.has("contentType")) values.contentType = normalized.contentType as never;
  if (mappedFields.has("wordCountRange")) values.wordCountRange = normalized.wordCountRange as never;
  if (mappedFields.has("status")) values.status = normalized.status as never;
  if (mappedFields.has("link")) values.link = normalized.link ?? null;
  if (mappedFields.has("reviewerName")) values.reviewerName = normalized.reviewerName ?? null;
  if (mappedFields.has("notes")) values.notes = normalized.notes ?? null;

  return values;
}

function setLookupMaps(
  articleIdMap: Map<string, ExistingArticleRow>,
  compositeMap: Map<string, ExistingArticleRow>,
  row: ExistingArticleRow
) {
  const articleId = row.articleId?.trim();
  if (articleId) {
    articleIdMap.set(articleId, row);
  }
  compositeMap.set(normalizeCompositeKey(row.title, row.penName, row.date), row);
}

function removeLookupMaps(
  articleIdMap: Map<string, ExistingArticleRow>,
  compositeMap: Map<string, ExistingArticleRow>,
  row: ExistingArticleRow
) {
  const articleId = row.articleId?.trim();
  if (articleId) {
    articleIdMap.delete(articleId);
  }
  compositeMap.delete(normalizeCompositeKey(row.title, row.penName, row.date));
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

    const collaboratorPenNames = (await db
      .select({ penName: collaborators.penName })
      .from(collaborators)
      .all())
      .map((item) => item.penName);

    const { prepared, selectedSheet, sourceUrl: resolvedSourceUrl } = await loadGoogleSheetImport({
      sourceUrl: sourceUrl || undefined,
      month,
      year,
      collaboratorPenNames,
    });

    if (prepared.rawRows.length === 0) {
      return NextResponse.json(
        { success: false, error: "Tab Google Sheets đang chọn chưa có dòng dữ liệu hợp lệ để đồng bộ." },
        { status: 400 }
      );
    }

    const mapping = resolveMapping(prepared.analysis.mapping);
    const missingRequiredFields = REQUIRED_FIELDS.filter((field) => !Object.values(mapping).includes(field));
    if (missingRequiredFields.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `Không thể đồng bộ vì sheet "${selectedSheet.name}" thiếu mapping cho: ${missingRequiredFields.join(", ")}.`,
        },
        { status: 400 }
      );
    }

    const mappedFields = new Set(Object.values(mapping));
    const existingArticles = await db
      .select({
        id: articles.id,
        articleId: articles.articleId,
        title: articles.title,
        penName: articles.penName,
        date: articles.date,
      })
      .from(articles)
      .all();

    const articleIdMap = new Map<string, ExistingArticleRow>();
    const compositeMap = new Map<string, ExistingArticleRow>();
    for (const row of existingArticles) {
      setLookupMaps(articleIdMap, compositeMap, row);
    }

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const row of prepared.rawRows) {
      try {
        const { normalized, issues } = normalizeImportedArticleRow(row, mapping, collaboratorPenNames);
        const rowIssues = [...issues];

        if (!normalized.date || !normalized.title || !normalized.penName) {
          rowIssues.push("Thiếu dữ liệu bắt buộc");
        }

        if (rowIssues.length > 0) {
          skipped += 1;
          if (errors.length < 20) {
            errors.push(`Dòng ${row.rowNumber}: ${rowIssues.join("; ")}`);
          }
          continue;
        }

        const articleId = normalized.articleId?.trim() || null;
        const compositeKey = normalizeCompositeKey(normalized.title, normalized.penName, normalized.date as string);
        const matchedByArticleId = articleId ? articleIdMap.get(articleId) : undefined;
        const matchedByComposite = compositeMap.get(compositeKey);
        const target = matchedByArticleId ?? matchedByComposite;

        if (target) {
          const updateValues = {
            ...buildArticlePayload({ ...normalized, articleId: articleId ?? undefined }, mappedFields),
            updatedAt: new Date().toISOString(),
          };

          await db.update(articles)
            .set(updateValues)
            .where(eq(articles.id, target.id))
            .run();

          removeLookupMaps(articleIdMap, compositeMap, target);
          const nextRow: ExistingArticleRow = {
            id: target.id,
            articleId: Object.prototype.hasOwnProperty.call(updateValues, "articleId")
              ? (updateValues.articleId as string | null)
              : target.articleId,
            title: String(updateValues.title ?? target.title),
            penName: String(updateValues.penName ?? target.penName),
            date: String(updateValues.date ?? target.date),
          };
          setLookupMaps(articleIdMap, compositeMap, nextRow);
          updated += 1;
          continue;
        }

        const insertValues = {
          ...buildArticlePayload({ ...normalized, articleId: articleId ?? undefined }, mappedFields),
          createdByUserId: context.user.id,
        } as typeof articles.$inferInsert;

        const insertedRow = await db.insert(articles)
          .values(insertValues)
          .returning({ id: articles.id })
          .get();

        setLookupMaps(articleIdMap, compositeMap, {
          id: Number(insertedRow?.id),
          articleId: articleId,
          title: normalized.title,
          penName: normalized.penName,
          date: normalized.date as string,
        });
        inserted += 1;
      } catch (rowError) {
        skipped += 1;
        if (errors.length < 20) {
          errors.push(`Dòng ${row.rowNumber}: ${String(rowError)}`);
        }
      }
    }

    await writeAuditLog({
      userId: context.user.id,
      action: "articles_google_sheet_synced",
      entity: "article",
      payload: {
        sheetName: selectedSheet.name,
        selectedMonth: selectedSheet.month,
        selectedYear: selectedSheet.year,
        requestedMonth: month,
        requestedYear: year,
        total: prepared.rawRows.length,
        inserted,
        updated,
        skipped,
      },
    });

    await publishRealtimeEvent({
      channels: ["articles", "dashboard", "royalty"],
      toastTitle: "Đồng bộ Google Sheet hoàn tất",
      toastMessage: `${selectedSheet.name}: thêm ${inserted}, cập nhật ${updated}.`,
      toastVariant: "success",
    });

    return NextResponse.json({
      success: true,
      sheetName: selectedSheet.name,
      month: selectedSheet.month,
      year: selectedSheet.year,
      requestedMonth: month,
      requestedYear: year,
      sourceUrl: resolvedSourceUrl,
      total: prepared.rawRows.length,
      inserted,
      updated,
      skipped,
      errors,
      warnings: prepared.analysis.warnings,
    });
  } catch (error) {
    return handleServerError("articles.google-sync.post", error);
  }
}
