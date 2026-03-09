import * as XLSX from "xlsx";
import { prepareArticleImport } from "./article-import";

export const DEFAULT_GOOGLE_SHEET_SOURCE_URL =
  "https://docs.google.com/spreadsheets/d/1Uj8iA0R5oWmONenkESHZ8i7Hc1D8UOk6ES6olZGTbH8/edit?gid=75835251#gid=75835251";

export interface GoogleSheetTabInfo {
  name: string;
  month: number;
  year: number;
  isCopy: boolean;
}

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
  requestedMonth?: number | null,
  requestedYear?: number | null
): GoogleSheetTabInfo | null {
  const parsed = sheetNames
    .map(parseSheetTabInfo)
    .filter((item): item is GoogleSheetTabInfo => Boolean(item));

  if (parsed.length === 0) {
    return null;
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
  const selectedSheet = pickSheetTab(workbook.SheetNames, options.month, options.year);

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
