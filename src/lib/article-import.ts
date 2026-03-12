import * as XLSX from "xlsx";
import {
  mapGoogleSheetArticleToApp,
  normalizeAppContentType,
} from "@/lib/google-sheet-article-mapping";

export type ImportFieldId =
  | "articleId"
  | "date"
  | "title"
  | "penName"
  | "category"
  | "articleType"
  | "contentType"
  | "wordCountRange"
  | "status"
  | "link"
  | "reviewerName"
  | "notes";

export interface ArticleImportSheetInfo {
  name: string;
  totalRows: number;
  totalColumns: number;
  isHidden: boolean;
}

export interface ArticleImportHeaderCandidate {
  rowNumber: number;
  score: number;
  preview: string[];
}

export interface ArticleImportColumnSuggestion {
  field: ImportFieldId;
  score: number;
}

export interface ArticleImportColumnAnalysis {
  key: string;
  letter: string;
  header: string;
  inferredType: string;
  sampleValues: string[];
  suggestedField: ImportFieldId | null;
  suggestionScore: number;
  suggestions: ArticleImportColumnSuggestion[];
}

export interface ArticleImportSampleRow {
  rowNumber: number;
  values: Record<string, string>;
}

export interface ArticleImportAnalysis {
  sheetName: string;
  totalRows: number;
  dataRowCount: number;
  headerRowNumber: number;
  sheets: ArticleImportSheetInfo[];
  headerCandidates: ArticleImportHeaderCandidate[];
  columns: ArticleImportColumnAnalysis[];
  mapping: Record<string, ImportFieldId | null>;
  sampleRows: ArticleImportSampleRow[];
  warnings: string[];
  requiredFieldsMissing: ImportFieldId[];
}

export interface PreparedArticleImportRow {
  rowNumber: number;
  values: Record<string, unknown>;
}

export interface PreparedArticleImport {
  analysis: ArticleImportAnalysis;
  rawRows: PreparedArticleImportRow[];
}

interface PrepareArticleImportOptions {
  sheetName?: string;
  headerRowNumber?: number;
  collaboratorPenNames?: string[];
}

interface NormalizeImportedArticleRowOptions {
  fallbackDate?: string | null;
}

type FieldDefinition = {
  id: ImportFieldId;
  label: string;
  required?: boolean;
  aliases: string[];
};

const FIELD_DEFINITIONS: FieldDefinition[] = [
  { id: "articleId", label: "Mã bài viết", aliases: ["id bài viết", "id bai viet", "id bài", "ma bai viet", "mã bài", "ma bai", "article id", "article_id", "articleid", "post id", "post_id"] },
  { id: "date", label: "Ngày viết", required: true, aliases: ["ngày viết", "ngày đăng", "ngày", "ngay viet", "ngay dang", "ngay", "date"] },
  { id: "title", label: "Tiêu đề", required: true, aliases: ["tên bài viết", "tên bài", "tiêu đề", "bài viết", "title", "ten bai viet", "ten bai", "tieu de"] },
  { id: "penName", label: "Bút danh", required: true, aliases: ["bút danh", "but danh", "pen name", "pen_name", "penname", "tác giả", "người viết", "ctv", "tac gia", "nguoi viet"] },
  { id: "category", label: "Danh mục", aliases: ["danh mục", "danh muc", "category", "chuyên mục", "chuyen muc"] },
  { id: "articleType", label: "Loại bài", aliases: ["loại bài", "loai bai", "article type", "article_type", "articletype", "kiểu bài", "kieu bai"] },
  { id: "contentType", label: "Loại nội dung", aliases: ["loại nội dung", "loai noi dung", "content type", "content_type", "contenttype", "kiểu nội dung"] },
  { id: "wordCountRange", label: "Khoảng từ", aliases: ["word count", "số từ", "so tu", "độ dài", "do dai", "range từ", "khoảng từ"] },
  { id: "status", label: "Trạng thái", aliases: ["trạng thái", "trang thai", "tình trạng", "tinh trang", "tình trạng duyệt", "tinh trang duyet", "trạng thái duyệt", "trang thai duyet", "status", "duyệt", "phe duyet"] },
  { id: "link", label: "Link", aliases: ["link bài", "link bai", "link", "url", "đường dẫn", "duong dan"] },
  { id: "reviewerName", label: "Người duyệt", aliases: ["người duyệt", "nguoi duyet", "reviewer", "reviewer name", "reviewer_name", "editor", "biên tập", "bien tap"] },
  { id: "notes", label: "Ghi chú", aliases: ["ghi chú", "ghi chu", "note", "notes", "chú thích", "chu thich", "nội dung sửa", "noi dung sua"] },
];

const REQUIRED_FIELDS = FIELD_DEFINITIONS.filter((field) => field.required).map((field) => field.id);
const CATEGORY_VALUES = ["ict", "gia dung", "thu thuat", "giai tri", "danh gia", "khac"];
const STATUS_VALUES = ["draft", "submitted", "pending", "reviewing", "needsfix", "approved", "published", "rejected", "done", "completed", "đã duyệt", "cho duyet", "chờ duyệt", "sửa lỗi", "từ chối", "hoàn thành"];
const CONTENT_TYPE_VALUES = ["viết mới", "viet moi", "viết lại", "viet lai", "rewrite", "new"];
const ARTICLE_TYPE_HINTS = [
  "mô tả",
  "mo ta",
  "review",
  "dịch",
  "dich",
  "seo",
  "ict",
  "gia dụng",
  "gia dung",
  "1k5",
  "2k",
  "thủ thuật",
  "thu thuat",
];

function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return normalizeWhitespace(value) === "";
  return false;
}

function serializeCellValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDate(value);
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : String(value);
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  return normalizeWhitespace(String(value));
}

function formatDate(date: Date): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return formatter.format(date);
}

function parseDateValue(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDate(value);
  }

  if (typeof value === "number") {
    if (value > 0 && value < 60000) {
      const parsed = XLSX.SSF.parse_date_code(value);
      if (parsed?.y && parsed?.m && parsed?.d) {
        return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
      }
    }
    return null;
  }

  const text = normalizeWhitespace(String(value || ""));
  if (!text) return null;

  const ddmmyyyy = text.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
  if (ddmmyyyy) {
    return `${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, "0")}-${ddmmyyyy[1].padStart(2, "0")}`;
  }

  const yyyymmdd = text.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})$/);
  if (yyyymmdd) {
    return `${yyyymmdd[1]}-${yyyymmdd[2].padStart(2, "0")}-${yyyymmdd[3].padStart(2, "0")}`;
  }

  const maybeSerial = text.match(/^\d{4,5}$/);
  if (maybeSerial) {
    const numeric = Number(text);
    if (numeric > 0 && numeric < 60000) {
      return parseDateValue(numeric);
    }
  }

  const looksLikeVerboseDate =
    /\b(mon|tue|wed|thu|fri|sat|sun|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(text) ||
    /^\d{4}-\d{2}-\d{2}t/i.test(text);

  if (looksLikeVerboseDate) {
    const parsedDate = new Date(text);
    if (!Number.isNaN(parsedDate.getTime())) {
      return formatDate(parsedDate);
    }
  }

  return null;
}

function isLikelyUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isNumericLike(value: string): boolean {
  return /^[0-9]+([.,][0-9]+)?$/.test(value);
}

function countWords(value: string): number {
  return foldText(value).split(" ").filter(Boolean).length;
}

function getMergedCellValue(worksheet: XLSX.WorkSheet, rowIndex: number, columnIndex: number): unknown {
  const directCell = worksheet[XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })];
  if (directCell) {
    return directCell.v;
  }

  const merges = (worksheet["!merges"] || []) as XLSX.Range[];
  for (const merge of merges) {
    if (
      rowIndex >= merge.s.r &&
      rowIndex <= merge.e.r &&
      columnIndex >= merge.s.c &&
      columnIndex <= merge.e.c
    ) {
      const sourceCell = worksheet[XLSX.utils.encode_cell({ r: merge.s.r, c: merge.s.c })];
      return sourceCell?.v;
    }
  }

  return undefined;
}

function getSheetRange(worksheet: XLSX.WorkSheet): XLSX.Range {
  return XLSX.utils.decode_range(worksheet["!ref"] || "A1:A1");
}

function getRowValues(worksheet: XLSX.WorkSheet, rowIndex: number): string[] {
  const range = getSheetRange(worksheet);
  const values: string[] = [];

  for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
    const value = serializeCellValue(getMergedCellValue(worksheet, rowIndex, columnIndex));
    if (value) values.push(value);
  }

  return values;
}

function isLikelyHeaderContextRow(worksheet: XLSX.WorkSheet, rowIndex: number): boolean {
  const values = getRowValues(worksheet, rowIndex);
  if (values.length < 2) return false;

  const uniqueValues = new Set(values.map(foldText));
  if (uniqueValues.size <= 1) return false;

  const stringLikeRatio =
    values.filter((value) => !isNumericLike(value) && parseDateValue(value) === null && !isLikelyUrl(value)).length /
    values.length;

  return stringLikeRatio >= 0.6;
}

function getHeaderLabel(worksheet: XLSX.WorkSheet, rowIndex: number, columnIndex: number): string {
  const parts: string[] = [];

  for (let currentRow = Math.max(0, rowIndex - 2); currentRow <= rowIndex; currentRow += 1) {
    if (currentRow !== rowIndex && !isLikelyHeaderContextRow(worksheet, currentRow)) {
      continue;
    }
    const value = serializeCellValue(getMergedCellValue(worksheet, currentRow, columnIndex));
    if (!value) continue;
    if (!parts.includes(value)) {
      parts.push(value);
    }
  }

  return parts.join(" / ");
}

function scoreAlias(header: string, aliases: string[]): number {
  const foldedHeader = foldText(header);
  if (!foldedHeader) return 0;

  let bestScore = 0;
  for (const alias of aliases) {
    const foldedAlias = foldText(alias);
    if (foldedHeader === foldedAlias) {
      bestScore = Math.max(bestScore, 90);
      continue;
    }
    if (foldedHeader.includes(foldedAlias) || foldedAlias.includes(foldedHeader)) {
      bestScore = Math.max(bestScore, 65);
      continue;
    }

    const aliasWords = foldedAlias.split(" ").filter(Boolean);
    const matches = aliasWords.filter((word) => foldedHeader.includes(word)).length;
    if (matches > 0) {
      bestScore = Math.max(bestScore, Math.round((matches / aliasWords.length) * 50));
    }
  }

  return bestScore;
}

function detectHeaderCandidates(worksheet: XLSX.WorkSheet, collaboratorPenNames: string[]): { rowIndex: number; score: number; preview: string[] }[] {
  const range = getSheetRange(worksheet);
  const maxRowToCheck = Math.min(range.e.r, 12);
  const candidates: { rowIndex: number; score: number; preview: string[] }[] = [];

  for (let rowIndex = range.s.r; rowIndex <= maxRowToCheck; rowIndex += 1) {
    const rowValues = getRowValues(worksheet, rowIndex);
    const uniqueRowValues = new Set(rowValues.map(foldText));
    const headerLikeCellCount = rowValues.filter(
      (value) => !isNumericLike(value) && parseDateValue(value) === null && !isLikelyUrl(value)
    ).length;
    const rowHeaderRatio = rowValues.length === 0 ? 0 : headerLikeCellCount / rowValues.length;

    const headers: string[] = [];
    let nonEmptyCells = 0;
    let aliasScoreTotal = 0;
    let averageHeaderLength = 0;

    for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
      const header = getHeaderLabel(worksheet, rowIndex, columnIndex);
      if (!header) continue;
      headers.push(header);
      nonEmptyCells += 1;
      averageHeaderLength += header.length;
      aliasScoreTotal += Math.max(...FIELD_DEFINITIONS.map((field) => scoreAlias(header, field.aliases)));
    }

    if (nonEmptyCells === 0) continue;

    averageHeaderLength = averageHeaderLength / nonEmptyCells;

    let sampleDataDensity = 0;
    for (let nextRow = rowIndex + 1; nextRow <= Math.min(range.e.r, rowIndex + 3); nextRow += 1) {
      let rowNonEmpty = 0;
      for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
        if (!isBlank(getMergedCellValue(worksheet, nextRow, columnIndex))) {
          rowNonEmpty += 1;
        }
      }
      sampleDataDensity += rowNonEmpty;
    }

    const foldedHeaders = headers.map(foldText);
    const duplicatePenalty = headers.length - new Set(foldedHeaders).size;
    const titleRowPenalty = nonEmptyCells <= 1 ? 60 : 0;
    const verbosePenalty = averageHeaderLength > 40 ? 25 : 0;
    const lowHeaderRatioPenalty = rowHeaderRatio < 0.6 ? 60 : 0;
    const repeatedValuePenalty = uniqueRowValues.size <= 1 ? 80 : 0;
    const collaboratorHint = headers.some((header) => collaboratorPenNames.some((name) => foldText(header).includes(foldText(name)))) ? 20 : 0;

    const score =
      aliasScoreTotal +
      nonEmptyCells * 6 +
      sampleDataDensity * 1.5 +
      collaboratorHint -
      duplicatePenalty * 4 -
      titleRowPenalty -
      verbosePenalty -
      lowHeaderRatioPenalty -
      repeatedValuePenalty;

    candidates.push({
      rowIndex,
      score,
      preview: headers.slice(0, 6),
    });
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, 6);
}

function detectActiveColumns(worksheet: XLSX.WorkSheet, headerRowIndex: number): number[] {
  const range = getSheetRange(worksheet);
  const activeColumns: number[] = [];

  for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
    const header = getHeaderLabel(worksheet, headerRowIndex, columnIndex);
    let hasDataBelow = false;

    for (let rowIndex = headerRowIndex + 1; rowIndex <= Math.min(range.e.r, headerRowIndex + 20); rowIndex += 1) {
      if (!isBlank(getMergedCellValue(worksheet, rowIndex, columnIndex))) {
        hasDataBelow = true;
        break;
      }
    }

    if (header || hasDataBelow) {
      activeColumns.push(columnIndex);
    }
  }

  return activeColumns;
}

function extractRawRows(worksheet: XLSX.WorkSheet, headerRowIndex: number, activeColumns: number[]): PreparedArticleImportRow[] {
  const range = getSheetRange(worksheet);
  const rows: PreparedArticleImportRow[] = [];

  for (let rowIndex = headerRowIndex + 1; rowIndex <= range.e.r; rowIndex += 1) {
    const values: Record<string, unknown> = {};
    let nonEmptyCells = 0;

    for (const columnIndex of activeColumns) {
      const value = getMergedCellValue(worksheet, rowIndex, columnIndex);
      const columnKey = XLSX.utils.encode_col(columnIndex);
      values[columnKey] = value;
      if (!isBlank(value)) {
        nonEmptyCells += 1;
      }
    }

    if (nonEmptyCells === 0) continue;
    rows.push({ rowNumber: rowIndex + 1, values });
  }

  return rows;
}

function inferColumnType(samples: string[]): string {
  if (samples.length === 0) return "empty";

  const urlRatio = samples.filter(isLikelyUrl).length / samples.length;
  const dateRatio = samples.filter((value) => parseDateValue(value) !== null).length / samples.length;
  const numberRatio = samples.filter(isNumericLike).length / samples.length;
  const longTextRatio = samples.filter((value) => value.length >= 25).length / samples.length;

  if (urlRatio >= 0.6) return "url";
  if (dateRatio >= 0.6) return "date";
  if (numberRatio >= 0.7) return "number";
  if (longTextRatio >= 0.6) return "long-text";
  return "text";
}

function scoreFieldBySamples(fieldId: ImportFieldId, samples: string[], collaboratorPenNames: string[]): number {
  if (samples.length === 0) return 0;

  const longTextRatio = samples.filter((value) => value.length >= 25).length / samples.length;
  const shortPhraseRatio = samples.filter((value) => value.length > 0 && value.length <= 28 && countWords(value) <= 5).length / samples.length;
  const dateRatio = samples.filter((value) => parseDateValue(value) !== null).length / samples.length;
  const urlRatio = samples.filter(isLikelyUrl).length / samples.length;
  const numericRatio = samples.filter(isNumericLike).length / samples.length;
  const collaboratorRatio = samples.filter((value) =>
    collaboratorPenNames.some((penName) => foldText(penName) === foldText(value))
  ).length / samples.length;
  const statusRatio = samples.filter((value) => STATUS_VALUES.some((status) => foldText(value).includes(foldText(status)))).length / samples.length;
  const categoryRatio = samples.filter((value) => CATEGORY_VALUES.some((category) => foldText(value).includes(category))).length / samples.length;
  const articleTypeRatio = samples.filter((value) => ARTICLE_TYPE_HINTS.some((hint) => foldText(value).includes(hint))).length / samples.length;
  const contentTypeRatio = samples.filter((value) => CONTENT_TYPE_VALUES.some((hint) => foldText(value).includes(foldText(hint)))).length / samples.length;
  const wordRangeRatio = samples.filter((value) => /(\d{3,4}\s*[-–]\s*\d{3,4})|1k5|2k|2000/i.test(value)).length / samples.length;
  const idLikeRatio = samples.filter((value) => /^\d{5,}$/.test(value.replace(/\D/g, ""))).length / samples.length;

  switch (fieldId) {
    case "articleId":
      return numericRatio * 18 + shortPhraseRatio * 8 + idLikeRatio * 30;
    case "date":
      return dateRatio * 42 - longTextRatio * 14 - urlRatio * 20;
    case "title":
      return longTextRatio * 36 + shortPhraseRatio * 8 - dateRatio * 20 - collaboratorRatio * 18 - urlRatio * 18;
    case "penName":
      return collaboratorRatio * 42 + shortPhraseRatio * 16 - longTextRatio * 20 - dateRatio * 10;
    case "category":
      return categoryRatio * 36;
    case "articleType":
      return articleTypeRatio * 36;
    case "contentType":
      return contentTypeRatio * 38;
    case "wordCountRange":
      return wordRangeRatio * 38 + numericRatio * 4;
    case "status":
      return statusRatio * 38;
    case "link":
      return urlRatio * 45;
    case "reviewerName":
      return collaboratorRatio * 36 + shortPhraseRatio * 8 - longTextRatio * 14;
    case "notes":
      return longTextRatio * 28;
    default:
      return 0;
  }
}

function buildColumnAnalysis(
  worksheet: XLSX.WorkSheet,
  headerRowIndex: number,
  columnIndex: number,
  rows: PreparedArticleImportRow[],
  collaboratorPenNames: string[]
): ArticleImportColumnAnalysis {
  const key = XLSX.utils.encode_col(columnIndex);
  const header = getHeaderLabel(worksheet, headerRowIndex, columnIndex) || key;
  const sampleValues = rows
    .map((row) => serializeCellValue(row.values[key]))
    .filter(Boolean)
    .slice(0, 5);

  const suggestions = FIELD_DEFINITIONS.map((field) => {
    const headerScore = scoreAlias(header, field.aliases);
    const sampleScore = scoreFieldBySamples(field.id, sampleValues, collaboratorPenNames);
    return {
      field: field.id,
      score: Math.round(headerScore + sampleScore),
    };
  })
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  const bestSuggestion = suggestions[0];

  return {
    key,
    letter: key,
    header,
    inferredType: inferColumnType(sampleValues),
    sampleValues,
    suggestedField: bestSuggestion && bestSuggestion.score >= 38 ? bestSuggestion.field : null,
    suggestionScore: bestSuggestion?.score || 0,
    suggestions,
  };
}

function buildSuggestedMapping(columns: ArticleImportColumnAnalysis[]): Record<string, ImportFieldId | null> {
  const mapping: Record<string, ImportFieldId | null> = {};
  const takenFields = new Set<ImportFieldId>();

  for (const column of columns) {
    mapping[column.key] = null;
  }

  const candidates = columns.flatMap((column) =>
    column.suggestions.map((suggestion) => ({
      key: column.key,
      field: suggestion.field,
      score: suggestion.score,
    }))
  );

  candidates.sort((a, b) => b.score - a.score);

  for (const candidate of candidates) {
    if (candidate.score < 38) continue;
    if (mapping[candidate.key]) continue;
    if (takenFields.has(candidate.field)) continue;

    mapping[candidate.key] = candidate.field;
    takenFields.add(candidate.field);
  }

  return mapping;
}

function buildWarnings(
  columns: ArticleImportColumnAnalysis[],
  mapping: Record<string, ImportFieldId | null>,
  rawRows: PreparedArticleImportRow[],
  headerCandidates: { rowIndex: number; score: number }[],
  selectedHeaderRowIndex: number
): string[] {
  const warnings: string[] = [];
  const requiredFieldsMissing = REQUIRED_FIELDS.filter(
    (requiredField) => !Object.values(mapping).includes(requiredField)
  );

  if (rawRows.length === 0) {
    warnings.push("Không tìm thấy dòng dữ liệu bên dưới header đã chọn.");
  }

  if (requiredFieldsMissing.length > 0) {
    warnings.push(`Thiếu cột bắt buộc: ${requiredFieldsMissing.join(", ")}.`);
  }

  const selectedCandidate = headerCandidates.find((candidate) => candidate.rowIndex === selectedHeaderRowIndex);
  if (selectedCandidate && selectedCandidate.score < 90) {
    warnings.push("Dòng header được nhận diện chưa thật sự chắc chắn. Hãy kiểm tra lại sheet và dòng header trước khi nhập.");
  }

  const titleColumnKey = Object.entries(mapping).find(([, field]) => field === "title")?.[0];
  if (titleColumnKey) {
    const titleColumn = columns.find((column) => column.key === titleColumnKey);
    const dateLikeTitles = (titleColumn?.sampleValues || []).filter((value) => parseDateValue(value) !== null).length;
    if (titleColumn && titleColumn.sampleValues.length > 0 && dateLikeTitles / titleColumn.sampleValues.length >= 0.5) {
      warnings.push("Cột đang map vào Tiêu đề có nhiều giá trị giống ngày tháng. Mapping này có thể sai.");
    }
  }

  const penNameColumnKey = Object.entries(mapping).find(([, field]) => field === "penName")?.[0];
  if (penNameColumnKey) {
    const penNameColumn = columns.find((column) => column.key === penNameColumnKey);
    const longSamples = (penNameColumn?.sampleValues || []).filter((value) => value.length >= 40).length;
    if (penNameColumn && penNameColumn.sampleValues.length > 0 && longSamples / penNameColumn.sampleValues.length >= 0.5) {
      warnings.push("Cột đang map vào Bút danh có nhiều chuỗi rất dài, giống tiêu đề bài viết hơn là tên cộng tác viên.");
    }
  }

  return warnings;
}

export function prepareArticleImportFromWorkbook(workbook: XLSX.WorkBook, options: PrepareArticleImportOptions = {}): PreparedArticleImport {
  const workbookSheets = workbook.Workbook?.Sheets || [];
  const sheetName = options.sheetName && workbook.SheetNames.includes(options.sheetName)
    ? options.sheetName
    : workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const collaboratorPenNames = options.collaboratorPenNames || [];
  const range = getSheetRange(worksheet);

  const sheets: ArticleImportSheetInfo[] = workbook.SheetNames.map((name, index) => {
    const sheet = workbook.Sheets[name];
    const sheetRange = getSheetRange(sheet);
    return {
      name,
      totalRows: sheetRange.e.r + 1,
      totalColumns: sheetRange.e.c + 1,
      isHidden: Boolean(workbookSheets[index]?.Hidden),
    };
  });

  const headerCandidates = detectHeaderCandidates(worksheet, collaboratorPenNames);
  const selectedHeaderRowIndex =
    typeof options.headerRowNumber === "number" && options.headerRowNumber >= 1
      ? options.headerRowNumber - 1
      : headerCandidates[0]?.rowIndex ?? range.s.r;

  const activeColumns = detectActiveColumns(worksheet, selectedHeaderRowIndex);
  const rawRows = extractRawRows(worksheet, selectedHeaderRowIndex, activeColumns);
  const columns = activeColumns.map((columnIndex) =>
    buildColumnAnalysis(worksheet, selectedHeaderRowIndex, columnIndex, rawRows, collaboratorPenNames)
  );
  const mapping = buildSuggestedMapping(columns);
  const warnings = buildWarnings(columns, mapping, rawRows, headerCandidates, selectedHeaderRowIndex);

  const analysis: ArticleImportAnalysis = {
    sheetName,
    totalRows: range.e.r + 1,
    dataRowCount: rawRows.length,
    headerRowNumber: selectedHeaderRowIndex + 1,
    sheets,
    headerCandidates: headerCandidates.map((candidate) => ({
      rowNumber: candidate.rowIndex + 1,
      score: Math.round(candidate.score),
      preview: candidate.preview,
    })),
    columns,
    mapping,
    sampleRows: rawRows.slice(0, 5).map((row) => {
      const values: Record<string, string> = {};
      for (const column of columns) {
        values[column.key] = serializeCellValue(row.values[column.key]);
      }
      return { rowNumber: row.rowNumber, values };
    }),
    warnings,
    requiredFieldsMissing: REQUIRED_FIELDS.filter((requiredField) => !Object.values(mapping).includes(requiredField)),
  };

  return {
    analysis,
    rawRows,
  };
}

export function prepareArticleImport(buffer: Buffer, options: PrepareArticleImportOptions = {}): PreparedArticleImport {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, raw: true });
  return prepareArticleImportFromWorkbook(workbook, options);
}

function normalizeArticleText(value: unknown): string {
  return normalizeWhitespace(String(value || ""));
}

function mapStatus(
  value: string
): "Draft" | "Submitted" | "Reviewing" | "NeedsFix" | "Approved" | "Published" | "Rejected" {
  const folded = foldText(value);
  if (["published", "approved", "da duyet", "hoan thanh", "xong", "done", "completed", "complete"].some((keyword) => folded.includes(keyword))) return "Published";
  if (["reviewing", "dang duyet"].some((keyword) => folded.includes(keyword))) return "Reviewing";
  if (["submitted", "pending", "cho duyet", "gui duyet"].some((keyword) => folded.includes(keyword))) return "Submitted";
  if (["needsfix", "sua loi", "can sua", "fix"].some((keyword) => folded.includes(keyword))) return "NeedsFix";
  if (["rejected", "tu choi"].some((keyword) => folded.includes(keyword))) return "Rejected";
  return "Draft";
}

export function fuzzyMatchPenName(rawName: string, collaboratorPenNames: string[]): string {
  const foldedName = foldText(rawName);
  if (!foldedName) return rawName;

  const exact = collaboratorPenNames.find((penName) => foldText(penName) === foldedName);
  if (exact) return exact;

  const partial = collaboratorPenNames.find((penName) =>
    foldText(penName).includes(foldedName) || foldedName.includes(foldText(penName))
  );
  if (partial) return partial;

  return rawName;
}

export function normalizeImportedArticleRow(
  row: PreparedArticleImportRow,
  mapping: Record<string, ImportFieldId>,
  collaboratorPenNames: string[],
  options: NormalizeImportedArticleRowOptions = {}
) {
  const fieldToColumn = new Map<ImportFieldId, string>();
  for (const [columnKey, field] of Object.entries(mapping)) {
    fieldToColumn.set(field, columnKey);
  }

  const getValue = (field: ImportFieldId) => {
    const columnKey = fieldToColumn.get(field);
    return columnKey ? row.values[columnKey] : undefined;
  };

  const rawTitle = normalizeArticleText(getValue("title"));
  const rawPenName = normalizeArticleText(getValue("penName"));
  const rawDate = getValue("date");
  const rawCategory = normalizeArticleText(getValue("category"));
  const rawArticleType = normalizeArticleText(getValue("articleType"));
  const rawContentType = normalizeArticleText(getValue("contentType"));
  const rawWordCountRange = normalizeArticleText(getValue("wordCountRange"));
  const rawStatus = normalizeArticleText(getValue("status"));
  const rawLink = normalizeArticleText(getValue("link"));
  const rawReviewerName = normalizeArticleText(getValue("reviewerName"));
  const rawNotes = normalizeArticleText(getValue("notes"));
  const rawArticleId = normalizeArticleText(getValue("articleId"));
  const rawDateText = normalizeArticleText(rawDate);
  const validLink = isLikelyUrl(rawLink);

  const issues: string[] = [];
  const parsedDate = parseDateValue(rawDate);
  const usedFallbackDate = Boolean(!parsedDate && !rawDateText && options.fallbackDate && rawTitle && rawPenName);
  const date = parsedDate || (usedFallbackDate ? options.fallbackDate! : null);
  const titleLooksLikeDate = parseDateValue(rawTitle) !== null;
  const articleId = rawArticleId || undefined;
  const shouldSkip =
    (!rawTitle && !rawPenName && !rawDateText && !articleId && !validLink) ||
    (!rawTitle && (articleId || validLink || rawReviewerName || rawNotes)) ||
    (rawTitle && !rawPenName && !parsedDate && !usedFallbackDate && !articleId && !validLink);

  if (!shouldSkip) {
    if (!rawTitle) issues.push("Thiếu tiêu đề");
    if (!rawPenName) issues.push("Thiếu bút danh");
    if (!date) issues.push("Ngày viết không hợp lệ");
    if (titleLooksLikeDate) issues.push("Tiêu đề đang có dạng ngày tháng, khả năng mapping sai");
    if (rawPenName.length > 80) issues.push("Bút danh quá dài, khả năng mapping sai");
  }

  const penName = fuzzyMatchPenName(rawPenName, collaboratorPenNames);
  const mappedArticleFields = mapGoogleSheetArticleToApp({
    articleType: rawArticleType,
    category: rawCategory,
    wordCountRange: rawWordCountRange,
    contentType: rawContentType,
  });
  const category = mappedArticleFields.category;
  const wordCountRange = mappedArticleFields.wordCountRange;
  const contentType = rawContentType ? normalizeAppContentType(rawContentType) : mappedArticleFields.contentType;
  const articleType = mappedArticleFields.articleType;
  const status = mapStatus(rawStatus);
  const reviewerName = rawReviewerName ? fuzzyMatchPenName(rawReviewerName, collaboratorPenNames) : "";

  return {
    normalized: {
      articleId,
      date,
      title: rawTitle,
      penName,
      category,
      articleType,
      contentType,
      wordCountRange,
      status,
      link: validLink ? rawLink : undefined,
      reviewerName: reviewerName || undefined,
      notes: rawNotes || undefined,
    },
    issues,
    shouldSkip,
    usedFallbackDate,
  };
}
