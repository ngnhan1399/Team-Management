import * as XLSX from "xlsx";
import { db, ensureDatabaseInitialized } from "@/db";
import { articles, collaborators } from "@/db/schema";
import { normalizeImportedArticleRow, prepareArticleImport, type ImportFieldId } from "./article-import";

export const DEFAULT_GOOGLE_SHEET_SOURCE_URL =
  "https://docs.google.com/spreadsheets/d/1Uj8iA0R5oWmONenkESHZ8i7Hc1D8UOk6ES6olZGTbH8/edit?gid=75835251#gid=75835251";

export interface GoogleSheetTabInfo {
  name: string;
  month: number;
  year: number;
  isCopy: boolean;
}

type ExistingArticleRow = {
  id: number;
  articleId: string | null;
  title: string;
  penName: string;
  date: string;
};

type NormalizedArticle = ReturnType<typeof normalizeImportedArticleRow>["normalized"];

export interface ExecuteGoogleSheetSyncOptions {
  sourceUrl?: string;
  month?: number | null;
  year?: number | null;
  sheetName?: string;
  createdByUserId?: number | null;
}

export interface GoogleSheetSyncExecutionResult {
  sourceUrl: string;
  sheetName: string;
  month: number;
  year: number;
  requestedMonth?: number | null;
  requestedYear?: number | null;
  requestedSheetName?: string;
  total: number;
  inserted: number;
  duplicates: number;
  skipped: number;
  errors: string[];
  warnings: string[];
}

const REQUIRED_FIELDS: ImportFieldId[] = ["date", "title", "penName"];

function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function parseSpreadsheetId(url: string): string | null {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match?.[1] || null;
}

export function buildSpreadsheetExportUrl(url: string): string {
  const spreadsheetId = parseSpreadsheetId(url);
  if (!spreadsheetId) {
    throw new Error("Không đọc được spreadsheet ID từ Google Sheets URL.");
  }

  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`;
}

export function parseSheetTabInfo(name: string): GoogleSheetTabInfo | null {
  const folded = foldText(name);
  const isCopy = folded.startsWith("ban sao cua ");
  const simplified = folded.replace(/^ban sao cua\s+/, "").replace(/\s+/g, "");
  const match = simplified.match(/^thang(\d{1,2})(\d{4})$/);

  if (!match) return null;

  const month = Number(match[1]);
  const year = Number(match[2]);

  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year)) {
    return null;
  }

  return {
    name,
    month,
    year,
    isCopy,
  };
}

export function pickSheetTab(
  sheetNames: string[],
  requestedSheetName?: string | null,
  requestedMonth?: number | null,
  requestedYear?: number | null
): GoogleSheetTabInfo | null {
  const parsed = sheetNames
    .map(parseSheetTabInfo)
    .filter((item): item is GoogleSheetTabInfo => Boolean(item));

  if (parsed.length === 0) {
    return null;
  }

  if (requestedSheetName) {
    const exactMatch = parsed.find((item) => item.name === requestedSheetName);
    if (exactMatch) {
      return exactMatch;
    }
  }

  const sortTabs = (tabs: GoogleSheetTabInfo[]) =>
    [...tabs].sort((left, right) => {
      const leftValue = left.year * 100 + left.month;
      const rightValue = right.year * 100 + right.month;
      if (leftValue !== rightValue) return rightValue - leftValue;
      if (left.isCopy !== right.isCopy) return Number(left.isCopy) - Number(right.isCopy);
      return right.name.localeCompare(left.name);
    });

  if (requestedMonth && requestedYear) {
    return sortTabs(
      parsed.filter((item) => item.month === requestedMonth && item.year === requestedYear)
    )[0] ?? null;
  }

  return sortTabs(parsed)[0] ?? null;
}

export async function loadGoogleSheetImport(options: {
  sourceUrl?: string;
  sheetName?: string;
  month?: number | null;
  year?: number | null;
  collaboratorPenNames?: string[];
}) {
  const sourceUrl = options.sourceUrl?.trim() || process.env.GOOGLE_SHEETS_ARTICLE_SOURCE_URL || DEFAULT_GOOGLE_SHEET_SOURCE_URL;
  const exportUrl = buildSpreadsheetExportUrl(sourceUrl);
  const response = await fetch(exportUrl, { cache: "no-store" });

  if (!response.ok) {
    throw new Error("Không tải được dữ liệu từ Google Sheets.");
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, raw: true });
  const selectedSheet = pickSheetTab(workbook.SheetNames, options.sheetName, options.month, options.year);

  if (!selectedSheet) {
    throw new Error("Không tìm thấy tab tháng/năm phù hợp trong Google Sheets.");
  }

  const prepared = prepareArticleImport(buffer, {
    sheetName: selectedSheet.name,
    collaboratorPenNames: options.collaboratorPenNames || [],
  });

  return {
    sourceUrl,
    selectedSheet,
    prepared,
  };
}

function normalizeCompositeKey(title: string, penName: string, date: string) {
  return `${title.toLowerCase().trim()}|||${penName.toLowerCase().trim()}|||${date}`;
}

function resolveMapping(mapping: Record<string, ImportFieldId | null>) {
  const resolved: Record<string, ImportFieldId> = {};

  for (const [columnKey, field] of Object.entries(mapping)) {
    if (!field) continue;
    resolved[columnKey] = field;
  }

  return resolved;
}

function resolveGoogleSheetFieldFromHeader(header: string): ImportFieldId | null {
  const folded = foldText(header);

  if (folded.includes("id bai viet") || folded === "id bai") return "articleId";
  if (folded.includes("ngay viet")) return "date";
  if (folded.includes("ten bai viet") || folded === "ten bai") return "title";
  if (folded.includes("loai bai viet")) return "articleType";
  if (folded.includes("do dai") || folded.includes("so tu") || folded.includes("khoang tu")) return "wordCountRange";
  if (folded.includes("but danh")) return "penName";
  if (folded.includes("tinh trang duyet") || folded.includes("trang thai duyet")) return "status";
  if (folded.includes("nguoi duyet")) return "reviewerName";
  if (folded.includes("link bai viet") || folded === "link") return "link";
  if (folded.includes("noi dung sua") || folded === "note" || folded === "notes") return "notes";

  return null;
}

function applyGoogleSheetHeaderOverrides(
  mapping: Record<string, ImportFieldId | null>,
  headers: Array<{ key: string; header: string }>
) {
  const nextMapping = { ...mapping };

  for (const column of headers) {
    const forcedField = resolveGoogleSheetFieldFromHeader(column.header);
    if (!forcedField) continue;

    for (const [key, currentField] of Object.entries(nextMapping)) {
      if (key !== column.key && currentField === forcedField) {
        nextMapping[key] = null;
      }
    }

    nextMapping[column.key] = forcedField;
  }

  return nextMapping;
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

export async function executeGoogleSheetSync(
  options: ExecuteGoogleSheetSyncOptions = {}
): Promise<GoogleSheetSyncExecutionResult> {
  await ensureDatabaseInitialized();

  const collaboratorPenNames = (await db
    .select({ penName: collaborators.penName })
    .from(collaborators)
    .all())
    .map((item) => item.penName);

  const { prepared, selectedSheet, sourceUrl } = await loadGoogleSheetImport({
    sourceUrl: options.sourceUrl,
    sheetName: options.sheetName,
    month: options.month,
    year: options.year,
    collaboratorPenNames,
  });

  if (prepared.rawRows.length === 0) {
    throw new Error("Tab Google Sheets đang chọn chưa có dòng dữ liệu hợp lệ để đồng bộ.");
  }

  const mapping = resolveMapping(
    applyGoogleSheetHeaderOverrides(
      prepared.analysis.mapping,
      prepared.analysis.columns.map((column) => ({ key: column.key, header: column.header }))
    )
  );
  const missingRequiredFields = REQUIRED_FIELDS.filter((field) => !Object.values(mapping).includes(field));
  if (missingRequiredFields.length > 0) {
    throw new Error(`Không thể đồng bộ vì sheet "${selectedSheet.name}" thiếu mapping cho: ${missingRequiredFields.join(", ")}.`);
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
  let duplicates = 0;
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
        duplicates += 1;
        continue;
      }

      const insertValues = {
        ...buildArticlePayload({ ...normalized, articleId: articleId ?? undefined }, mappedFields),
        createdByUserId: options.createdByUserId ?? null,
      } as typeof articles.$inferInsert;

      const insertedRow = await db.insert(articles)
        .values(insertValues)
        .returning({ id: articles.id })
        .get();

      setLookupMaps(articleIdMap, compositeMap, {
        id: Number(insertedRow?.id),
        articleId,
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

  return {
    sourceUrl,
    sheetName: selectedSheet.name,
    month: selectedSheet.month,
    year: selectedSheet.year,
    requestedMonth: options.month ?? null,
    requestedYear: options.year ?? null,
    requestedSheetName: options.sheetName,
    total: prepared.rawRows.length,
    inserted,
    duplicates,
    skipped,
    errors,
    warnings: prepared.analysis.warnings,
  };
}
