import * as XLSX from "xlsx";
import { db, ensureDatabaseInitialized } from "@/db";
import { articleComments, articleReviews, articles, articleSyncLinks, collaborators, notifications, payments } from "@/db/schema";
import { normalizeImportedArticleRow, prepareArticleImportFromWorkbook, type ImportFieldId } from "./article-import";
import { matchesIdentityCandidate } from "./auth";
import { buildCollaboratorIdentityVariants, expandCollaboratorIdentityValues } from "./collaborator-identity";
import { and, eq, inArray, or, type SQL } from "drizzle-orm";

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
  teamId: number | null;
  articleId: string | null;
  title: string;
  penName: string;
  date: string;
  link: string | null;
  category?: string | null;
  articleType?: string | null;
  contentType?: string | null;
  wordCountRange?: string | null;
  status?: string | null;
  reviewerName?: string | null;
  notes?: string | null;
};

type SyncLinkRow = {
  id: number;
  sourceRowKey: string;
  articleIdRef: number | null;
  sourceUrl?: string;
  sheetName?: string;
  sheetMonth?: number;
  sheetYear?: number;
};

type NormalizedArticle = ReturnType<typeof normalizeImportedArticleRow>["normalized"];

type PreparedRowLookupEntry = {
  rowNumber: number;
  sourceRowKey: string;
  normalized: NormalizedArticle;
  payload: Partial<typeof articles.$inferInsert>;
};

type PreparedRowLookup = {
  bySourceRowKey: Map<string, PreparedRowLookupEntry>;
  byArticleId: Map<string, PreparedRowLookupEntry>;
  byComposite: Map<string, PreparedRowLookupEntry>;
  byTitlePenName: Map<string, PreparedRowLookupEntry>;
  byLink: Map<string, PreparedRowLookupEntry>;
  skipped: number;
  errors: string[];
  warnings: string[];
};

export interface ExecuteGoogleSheetSyncOptions {
  sourceUrl?: string;
  month?: number | null;
  year?: number | null;
  sheetName?: string;
  teamId?: number | null;
  allowedPenNames?: string[];
  createdByUserId?: number | null;
  identityCandidates?: string[];
  _workbook?: XLSX.WorkBook;
  _collaboratorPenNames?: string[];
  _collaboratorDirectory?: CollaboratorDirectoryEntry[];
  _skipEnsureInitialized?: boolean;
  _sharedState?: GoogleSheetSyncSharedState;
}

export interface RefreshScopedGoogleSheetSyncOptions extends ExecuteGoogleSheetSyncOptions {
  articleIds: number[];
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
  updated: number;
  duplicates: number;
  deleted: number;
  skipped: number;
  errors: string[];
  warnings: string[];
  scope?: "sheet" | "workbook";
  processedSheets?: string[];
}

type GoogleSheetSyncSharedState = {
  sourceUrl: string;
  existingArticleIds: Set<number>;
  articleRowsById: Map<number, ExistingArticleRow>;
  articleIdMap: Map<string, ExistingArticleRow>;
  ambiguousArticleIds: Set<string>;
  compositeMap: Map<string, ExistingArticleRow>;
  titlePenNameMap: Map<string, ExistingArticleRow>;
  linkMap: Map<string, ExistingArticleRow>;
  syncLinksBySheet: Map<string, Map<string, SyncLinkRow>>;
};

type CollaboratorDirectoryEntry = {
  name: string | null;
  penName: string;
  teamId: number | null;
};

type SyncDeletionGuardDecision = {
  allowed: boolean;
  warning?: string;
};

const REQUIRED_FIELDS: ImportFieldId[] = ["date", "title", "penName"];
const DEFAULT_GOOGLE_SHEETS_SYNC_MAX_DELETE_COUNT = 20;
const DEFAULT_GOOGLE_SHEETS_SYNC_MAX_DELETE_RATIO = 0.35;

type GoogleSheetSyncCollaboratorContext = {
  collaboratorPenNames: string[];
  collaboratorDirectory: CollaboratorDirectoryEntry[];
};

function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/Ä‘/gi, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveRatio(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : fallback;
}

function getGoogleSheetDeleteGuardConfig() {
  return {
    maxDeleteCount: parsePositiveInteger(
      process.env.GOOGLE_SHEETS_SYNC_MAX_DELETE_COUNT,
      DEFAULT_GOOGLE_SHEETS_SYNC_MAX_DELETE_COUNT
    ),
    maxDeleteRatio: parsePositiveRatio(
      process.env.GOOGLE_SHEETS_SYNC_MAX_DELETE_RATIO,
      DEFAULT_GOOGLE_SHEETS_SYNC_MAX_DELETE_RATIO
    ),
  };
}

function assessGoogleSheetDeleteSafety(options: {
  candidateDeleteCount: number;
  referenceRowCount: number;
  rowsUsingFallbackDate?: number;
  scopeLabel: string;
}): SyncDeletionGuardDecision {
  const { candidateDeleteCount, referenceRowCount, rowsUsingFallbackDate = 0, scopeLabel } = options;
  if (candidateDeleteCount <= 0) {
    return { allowed: true };
  }

  if (rowsUsingFallbackDate > 0) {
    return {
      allowed: false,
      warning: `ÄÃ£ cháº·n xÃ³a ${candidateDeleteCount} bÃ i trong ${scopeLabel} vÃ¬ sheet Ä‘ang cÃ³ ${rowsUsingFallbackDate} dÃ²ng pháº£i gÃ¡n ngÃ y táº¡m. HÃ£y kiá»ƒm tra láº¡i cá»™t "NgÃ y viáº¿t" rá»“i Ä‘á»“ng bá»™ láº¡i.`,
    };
  }

  const { maxDeleteCount, maxDeleteRatio } = getGoogleSheetDeleteGuardConfig();
  if (candidateDeleteCount > maxDeleteCount) {
    return {
      allowed: false,
      warning: `ÄÃ£ cháº·n xÃ³a ${candidateDeleteCount} bÃ i trong ${scopeLabel} vÃ¬ vÆ°á»£t ngÆ°á»¡ng an toÃ n ${maxDeleteCount} bÃ i má»—i láº§n sync. CÃ³ thá»ƒ tÄƒng ngÆ°á»¡ng báº±ng GOOGLE_SHEETS_SYNC_MAX_DELETE_COUNT náº¿u Ä‘Ã¢y lÃ  thay Ä‘á»•i chá»§ Ä‘Ã­ch.`,
    };
  }

  if (referenceRowCount > 0 && (candidateDeleteCount / referenceRowCount) > maxDeleteRatio) {
    return {
      allowed: false,
      warning: `ÄÃ£ cháº·n xÃ³a ${candidateDeleteCount} bÃ i trong ${scopeLabel} vÃ¬ vÆ°á»£t ${Math.round(maxDeleteRatio * 100)}% sá»‘ dÃ²ng Ä‘ang Ä‘á»c tá»« sheet. HÃ£y rÃ  láº¡i dá»¯ liá»‡u nguá»“n trÆ°á»›c khi sync tiáº¿p.`,
    };
  }

  return { allowed: true };
}

export function parseSpreadsheetId(url: string): string | null {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match?.[1] || null;
}

export function buildSpreadsheetExportUrl(url: string): string {
  const spreadsheetId = parseSpreadsheetId(url);
  if (!spreadsheetId) {
    throw new Error("KhÃ´ng Ä‘á»c Ä‘Æ°á»£c spreadsheet ID tá»« Google Sheets URL.");
  }

  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`;
}

export function parseSheetTabInfo(name: string): GoogleSheetTabInfo | null {
  const folded = foldText(name);
  const isCopy = folded.startsWith("ban sao cua ");
  const simplified = folded.replace(/^ban sao cua\s+/, "").trim();
  const match =
    simplified.match(/^thang\s*(\d{1,2})(\d{4})$/)
    || simplified.match(/^thang\s*(\d{1,2})[\s/.\-_]+(\d{4})$/)
    || simplified.match(/^thang[\s/.\-_]+(\d{1,2})[\s/.\-_]+(\d{4})$/);

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

function sortGoogleSheetTabs(tabs: GoogleSheetTabInfo[]) {
  return [...tabs].sort((left, right) => {
    const leftValue = left.year * 100 + left.month;
    const rightValue = right.year * 100 + right.month;
    if (leftValue !== rightValue) return rightValue - leftValue;
    if (left.isCopy !== right.isCopy) return Number(left.isCopy) - Number(right.isCopy);
    return right.name.localeCompare(left.name);
  });
}

function isFutureSheetPeriod(month: number, year: number, referenceDate = new Date()) {
  const referenceMonth = referenceDate.getMonth() + 1;
  const referenceYear = referenceDate.getFullYear();
  return (year * 100 + month) > (referenceYear * 100 + referenceMonth);
}

function filterFutureSheetTabs(tabs: GoogleSheetTabInfo[]) {
  return tabs.filter((tab) => !isFutureSheetPeriod(tab.month, tab.year));
}

export function listPreferredSheetTabs(sheetNames: string[]) {
  const parsed = sortGoogleSheetTabs(filterFutureSheetTabs(
    sheetNames
      .map(parseSheetTabInfo)
      .filter((item): item is GoogleSheetTabInfo => Boolean(item))
  ));
  const seen = new Set<string>();
  const preferred: GoogleSheetTabInfo[] = [];

  for (const tab of parsed) {
    const key = `${tab.year}-${String(tab.month).padStart(2, "0")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    preferred.push(tab);
  }

  return preferred;
}

export function listMonthlySheetTabs(sheetNames: string[]) {
  return sortGoogleSheetTabs(filterFutureSheetTabs(
    sheetNames
      .map(parseSheetTabInfo)
      .filter((item): item is GoogleSheetTabInfo => Boolean(item))
  ));
}

function resolveCanonicalSheetRequest(
  requestedSheetName?: string | null,
  requestedMonth?: number | null,
  requestedYear?: number | null
) {
  const requestedTab = requestedSheetName ? parseSheetTabInfo(requestedSheetName) : null;

  if (!requestedTab?.isCopy) {
    return {
      sheetName: requestedSheetName,
      month: requestedMonth,
      year: requestedYear,
    };
  }

  return {
    sheetName: undefined,
    month: requestedMonth ?? requestedTab.month,
    year: requestedYear ?? requestedTab.year,
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
  const nonFutureTabs = filterFutureSheetTabs(parsed);

  if (nonFutureTabs.length === 0) {
    return null;
  }

  if (requestedSheetName) {
    const exactMatch = nonFutureTabs.find((item) => item.name === requestedSheetName);
    if (exactMatch) {
      return exactMatch;
    }
  }

  if (requestedMonth && requestedYear) {
    return sortGoogleSheetTabs(
      nonFutureTabs.filter((item) => item.month === requestedMonth && item.year === requestedYear)
    )[0] ?? null;
  }

  return sortGoogleSheetTabs(nonFutureTabs)[0] ?? null;
}

async function downloadGoogleSheetWorkbook(sourceUrlInput?: string) {
  const sourceUrl = resolveGoogleSheetSourceUrl(sourceUrlInput);
  const exportUrl = buildSpreadsheetExportUrl(sourceUrl);
  const response = await fetch(exportUrl, { cache: "no-store" });

  if (!response.ok) {
    throw new Error("KhÃ´ng táº£i Ä‘Æ°á»£c dá»¯ liá»‡u tá»« Google Sheets.");
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, raw: true });

  return { sourceUrl, workbook };
}

function loadGoogleSheetImportFromWorkbook(options: {
  sourceUrl: string;
  workbook: XLSX.WorkBook;
  sheetName?: string;
  month?: number | null;
  year?: number | null;
  collaboratorPenNames?: string[];
}) {
  const canonicalRequest = resolveCanonicalSheetRequest(options.sheetName, options.month, options.year);
  const selectedSheet = pickSheetTab(
    options.workbook.SheetNames,
    canonicalRequest.sheetName,
    canonicalRequest.month,
    canonicalRequest.year
  );

  if (!selectedSheet) {
    throw new Error("KhÃ´ng tÃ¬m tháº¥y tab thÃ¡ng/nÄƒm phÃ¹ há»£p trong Google Sheets.");
  }

  const prepared = prepareArticleImportFromWorkbook(options.workbook, {
    sheetName: selectedSheet.name,
    collaboratorPenNames: options.collaboratorPenNames || [],
  });

  return {
    sourceUrl: options.sourceUrl,
    selectedSheet,
    prepared,
  };
}

export async function loadGoogleSheetImport(options: {
  sourceUrl?: string;
  sheetName?: string;
  month?: number | null;
  year?: number | null;
  collaboratorPenNames?: string[];
  workbook?: XLSX.WorkBook;
}) {
  if (options.workbook) {
    const sourceUrl = resolveGoogleSheetSourceUrl(options.sourceUrl);
    return loadGoogleSheetImportFromWorkbook({
      sourceUrl,
      workbook: options.workbook,
      sheetName: options.sheetName,
      month: options.month,
      year: options.year,
      collaboratorPenNames: options.collaboratorPenNames,
    });
  }

  const { sourceUrl, workbook } = await downloadGoogleSheetWorkbook(options.sourceUrl);
  return loadGoogleSheetImportFromWorkbook({
    sourceUrl,
    workbook,
    sheetName: options.sheetName,
    month: options.month,
    year: options.year,
    collaboratorPenNames: options.collaboratorPenNames,
  });
}

function resolveGoogleSheetSourceUrl(sourceUrlInput?: string) {
  const sourceUrl = sourceUrlInput?.trim() || process.env.GOOGLE_SHEETS_ARTICLE_SOURCE_URL?.trim();
  if (sourceUrl) {
    return sourceUrl;
  }

  if (process.env.NODE_ENV !== "production") {
    return DEFAULT_GOOGLE_SHEET_SOURCE_URL;
  }

  throw new Error("ChÆ°a cáº¥u hÃ¬nh GOOGLE_SHEETS_ARTICLE_SOURCE_URL cho production.");
}

function normalizeGoogleSheetSyncIdentityCandidates(values?: string[]) {
  return Array.from(
    new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))
  );
}

function normalizeCompositeKey(title: string, penName: string, date: string) {
  return `${title.toLowerCase().trim()}|||${penName.toLowerCase().trim()}|||${date}`;
}

function normalizeTitlePenNameKey(title: string, penName: string) {
  return `${title.toLowerCase().trim()}|||${penName.toLowerCase().trim()}`;
}

function normalizeLinkKey(link: string) {
  return link.toLowerCase().trim();
}

type ArticleIdentityLike = {
  title: string;
  penName: string;
  date: string;
  link?: string | null;
};

function hasSameCompositeIdentity(existing: ArticleIdentityLike, next: ArticleIdentityLike) {
  return normalizeCompositeKey(existing.title, existing.penName, existing.date)
    === normalizeCompositeKey(next.title, next.penName, next.date);
}

function hasSameLinkIdentity(existing: ArticleIdentityLike, next: ArticleIdentityLike) {
  const existingLink = existing.link?.trim();
  const nextLink = next.link?.trim();
  if (!existingLink || !nextLink) return false;

  return normalizeLinkKey(existingLink) === normalizeLinkKey(nextLink);
}

function isConsistentArticleIdIdentity(existing: ArticleIdentityLike, next: ArticleIdentityLike) {
  return hasSameCompositeIdentity(existing, next) || hasSameLinkIdentity(existing, next);
}

function buildSheetFallbackDate(month: number, year: number) {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function repairFutureImportedDateForSheet(
  dateValue: string | null | undefined,
  sheetMonth: number,
  sheetYear: number,
  referenceDate = new Date()
) {
  if (!dateValue) {
    return {
      date: null,
      corrected: false,
    };
  }

  const match = dateValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return {
      date: dateValue,
      corrected: false,
    };
  }

  const parsedYear = Number(match[1]);
  const parsedMonth = Number(match[2]);
  const parsedDay = Number(match[3]);
  if (
    !Number.isInteger(parsedYear)
    || !Number.isInteger(parsedMonth)
    || !Number.isInteger(parsedDay)
    || parsedMonth < 1
    || parsedMonth > 12
    || parsedDay < 1
  ) {
    return {
      date: dateValue,
      corrected: false,
    };
  }

  const selectedSheetIsFuture = isFutureSheetPeriod(sheetMonth, sheetYear, referenceDate);
  const parsedDateIsFuture = isFutureSheetPeriod(parsedMonth, parsedYear, referenceDate);
  if (!parsedDateIsFuture || selectedSheetIsFuture || parsedYear <= sheetYear) {
    return {
      date: dateValue,
      corrected: false,
    };
  }

  const safeDay = Math.min(parsedDay, getDaysInMonth(sheetYear, parsedMonth));
  return {
    date: `${sheetYear}-${String(parsedMonth).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`,
    corrected: true,
  };
}

function buildSourceRowKey(normalized: NormalizedArticle) {
  const articleId = normalized.articleId?.trim();
  if (articleId) return `articleId:${articleId}`;

  const link = normalized.link?.trim();
  if (link) return `link:${normalizeLinkKey(link)}`;

  return `composite:${normalizeCompositeKey(normalized.title, normalized.penName, normalized.date as string)}`;
}

function getYearMonthFromDate(dateValue: string) {
  const match = dateValue.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!match) return null;

  return {
    year: Number(match[1]),
    month: Number(match[2]),
  };
}

function buildAffectedPaymentMatchers(rows: Array<Pick<ExistingArticleRow, "penName" | "date">>) {
  const clauses = rows
    .map((row) => {
      const yearMonth = getYearMonthFromDate(row.date);
      if (!yearMonth) return null;

      return and(
        eq(payments.penName, row.penName),
        eq(payments.year, yearMonth.year),
        eq(payments.month, yearMonth.month)
      );
    })
    .filter((clause): clause is SQL => Boolean(clause));

  return clauses.length > 0 ? or(...clauses) : null;
}

async function deleteArticlesForSync(articleIds: number[]) {
  if (articleIds.length === 0) {
    return { deletedArticles: 0 };
  }

  const targetRows = await db
    .select({
      id: articles.id,
      penName: articles.penName,
      date: articles.date,
    })
    .from(articles)
    .where(inArray(articles.id, articleIds))
    .all();

  const affectedPaymentWhere = buildAffectedPaymentMatchers(targetRows);

  return db.transaction(async (tx) => {
    await tx
      .delete(articleComments)
      .where(inArray(articleComments.articleId, articleIds))
      .run();

    await tx
      .delete(articleReviews)
      .where(inArray(articleReviews.articleId, articleIds))
      .run();

    await tx
      .delete(notifications)
      .where(inArray(notifications.relatedArticleId, articleIds))
      .run();

    await tx
      .delete(articleSyncLinks)
      .where(inArray(articleSyncLinks.articleIdRef, articleIds))
      .run();

    const deletedArticles = Number((await tx
      .delete(articles)
      .where(inArray(articles.id, articleIds))
      .run()).rowsAffected || 0);

    if (affectedPaymentWhere) {
      await tx.delete(payments).where(affectedPaymentWhere).run();
    }

    return { deletedArticles };
  }) as Promise<{ deletedArticles: number }>;
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

function resolveGoogleSheetMapping(
  columns: Array<{ key: string; header: string; suggestedField: ImportFieldId | null; suggestionScore: number }>
) {
  const nextMapping: Record<string, ImportFieldId | null> = {};
  const assignedFields = new Set<ImportFieldId>();

  for (const column of columns) {
    const forcedField = resolveGoogleSheetFieldFromHeader(column.header);
    if (!forcedField) continue;
    if (assignedFields.has(forcedField)) {
      nextMapping[column.key] = null;
      continue;
    }

    nextMapping[column.key] = forcedField;
    assignedFields.add(forcedField);
  }

  for (const column of columns) {
    if (nextMapping[column.key] !== undefined) continue;
    if (!column.suggestedField) {
      nextMapping[column.key] = null;
      continue;
    }

    const header = foldText(column.header);
    const headerLooksUnnamed = !header || /^[a-z]{1,2}$/.test(header);
    const belongsToSecondaryBlock =
      header.includes("kpi thang") ||
      header.startsWith("duyet bai") ||
      header.startsWith("nhuan");

    if (headerLooksUnnamed || belongsToSecondaryBlock || assignedFields.has(column.suggestedField) || column.suggestionScore < 70) {
      nextMapping[column.key] = null;
      continue;
    }

    nextMapping[column.key] = column.suggestedField;
    assignedFields.add(column.suggestedField);
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
    category: normalized.category as never,
    articleType: normalized.articleType as never,
    contentType: normalized.contentType as never,
    wordCountRange: normalized.wordCountRange as never,
    status: normalized.status as never,
  };

  if (mappedFields.has("articleId")) values.articleId = normalized.articleId ?? null;
  if (mappedFields.has("link")) values.link = normalized.link ?? null;
  if (mappedFields.has("reviewerName")) values.reviewerName = normalized.reviewerName ?? null;
  if (mappedFields.has("notes")) values.notes = normalized.notes ?? null;

  return values;
}

async function getCollaboratorPenNames(teamId?: number | null) {
  return (await db
    .select({ penName: collaborators.penName })
    .from(collaborators)
    .where(teamId ? eq(collaborators.teamId, teamId) : undefined)
    .all())
    .map((item) => item.penName);
}

async function getCollaboratorDirectory(teamId?: number | null) {
  return db
    .select({
      name: collaborators.name,
      penName: collaborators.penName,
      teamId: collaborators.teamId,
    })
    .from(collaborators)
    .where(teamId ? eq(collaborators.teamId, teamId) : undefined)
    .all() as Promise<CollaboratorDirectoryEntry[]>;
}

async function getGoogleSheetSyncCollaboratorContext(
  options: Pick<ExecuteGoogleSheetSyncOptions, "teamId" | "_collaboratorPenNames" | "_collaboratorDirectory">
): Promise<GoogleSheetSyncCollaboratorContext> {
  const [collaboratorPenNames, collaboratorDirectory] = await Promise.all([
    options._collaboratorPenNames
      ? Promise.resolve(options._collaboratorPenNames)
      : getCollaboratorPenNames(options.teamId),
    options._collaboratorDirectory
      ? Promise.resolve(options._collaboratorDirectory)
      : getCollaboratorDirectory(options.teamId),
  ]);

  return {
    collaboratorPenNames,
    collaboratorDirectory,
  };
}

function buildAllowedPenNameSet(values: string[]) {
  const expandedValues = values.flatMap((value) => expandCollaboratorIdentityValues([value]));
  return new Set([
    ...expandedValues.map((value) => foldText(value)).filter(Boolean),
    ...expandedValues.flatMap((value) => buildCollaboratorIdentityVariants(value)).filter(Boolean),
  ]);
}

async function getAllExistingArticles(teamId?: number | null) {
  return db
    .select({
      id: articles.id,
      teamId: articles.teamId,
      articleId: articles.articleId,
      title: articles.title,
      penName: articles.penName,
      date: articles.date,
      link: articles.link,
      category: articles.category,
      articleType: articles.articleType,
      contentType: articles.contentType,
      wordCountRange: articles.wordCountRange,
      status: articles.status,
      reviewerName: articles.reviewerName,
      notes: articles.notes,
    })
    .from(articles)
    .where(teamId ? eq(articles.teamId, teamId) : undefined)
    .all();
}

function resolveImportedArticleTeamId(
  penName: string,
  collaboratorDirectory: CollaboratorDirectoryEntry[],
  fallbackTeamId?: number | null
) {
  const normalizedPenName = foldText(penName);
  if (!normalizedPenName) return fallbackTeamId ?? null;

  const exactMatches = collaboratorDirectory.filter((entry) =>
    matchesIdentityCandidate([entry.penName, entry.name || ""], penName)
  );
  if (fallbackTeamId && exactMatches.some((entry) => Number(entry.teamId || 0) === Number(fallbackTeamId))) {
    return fallbackTeamId;
  }

  const uniqueTeamIds = Array.from(
    new Set(
      exactMatches
        .map((entry) => Number(entry.teamId || 0))
        .filter((teamId) => Number.isInteger(teamId) && teamId > 0)
    )
  );

  if (uniqueTeamIds.length === 1) {
    return uniqueTeamIds[0];
  }

  return fallbackTeamId ?? null;
}

function getSharedSheetSyncLinkMap(sharedState: GoogleSheetSyncSharedState, sheetName: string) {
  const existingMap = sharedState.syncLinksBySheet.get(sheetName);
  if (existingMap) {
    return existingMap;
  }

  const nextMap = new Map<string, SyncLinkRow>();
  sharedState.syncLinksBySheet.set(sheetName, nextMap);
  return nextMap;
}

function upsertSharedArticleRow(sharedState: GoogleSheetSyncSharedState, row: ExistingArticleRow) {
  const previousRow = sharedState.articleRowsById.get(row.id);
  if (previousRow) {
    removeLookupMaps(
      sharedState.articleIdMap,
      sharedState.compositeMap,
      sharedState.titlePenNameMap,
      sharedState.linkMap,
      previousRow
    );
  }

  sharedState.articleRowsById.set(row.id, row);
  sharedState.existingArticleIds.add(row.id);
  setLookupMaps(
    sharedState.articleIdMap,
    sharedState.ambiguousArticleIds,
    sharedState.compositeMap,
    sharedState.titlePenNameMap,
    sharedState.linkMap,
    row
  );
}

function upsertSharedSyncLink(sharedState: GoogleSheetSyncSharedState, syncLink: SyncLinkRow) {
  for (const sheetMap of sharedState.syncLinksBySheet.values()) {
    for (const [sourceRowKey, existingLink] of sheetMap.entries()) {
      if (existingLink.id === syncLink.id && sourceRowKey !== syncLink.sourceRowKey) {
        sheetMap.delete(sourceRowKey);
      }
    }
  }

  const sheetMap = getSharedSheetSyncLinkMap(sharedState, syncLink.sheetName || '');
  sheetMap.set(syncLink.sourceRowKey, syncLink);
}

function removeSharedSyncLinksByIds(sharedState: GoogleSheetSyncSharedState, linkIds: number[]) {
  if (linkIds.length === 0) return;
  const idSet = new Set(linkIds);

  for (const sheetMap of sharedState.syncLinksBySheet.values()) {
    for (const [sourceRowKey, existingLink] of sheetMap.entries()) {
      if (idSet.has(existingLink.id)) {
        sheetMap.delete(sourceRowKey);
      }
    }
  }
}

function removeSharedSyncLinksByArticleIds(sharedState: GoogleSheetSyncSharedState, articleIds: number[]) {
  if (articleIds.length === 0) return;
  const articleIdSet = new Set(articleIds);

  for (const sheetMap of sharedState.syncLinksBySheet.values()) {
    for (const [sourceRowKey, existingLink] of sheetMap.entries()) {
      if (articleIdSet.has(Number(existingLink.articleIdRef || 0))) {
        sheetMap.delete(sourceRowKey);
      }
    }
  }
}

function hasSyncLinkOnDifferentSheet(sharedState: GoogleSheetSyncSharedState, articleId: number, sheetName: string) {
  for (const [existingSheetName, sheetMap] of sharedState.syncLinksBySheet.entries()) {
    if (existingSheetName === sheetName) continue;

    for (const syncLink of sheetMap.values()) {
      if (Number(syncLink.articleIdRef || 0) === articleId) {
        return true;
      }
    }
  }

  return false;
}

function removeSharedArticles(sharedState: GoogleSheetSyncSharedState, articleIds: number[]) {
  if (articleIds.length === 0) return;

  removeSharedSyncLinksByArticleIds(sharedState, articleIds);
  for (const articleId of articleIds) {
    const existingRow = sharedState.articleRowsById.get(articleId);
    if (!existingRow) continue;

    removeLookupMaps(
      sharedState.articleIdMap,
      sharedState.compositeMap,
      sharedState.titlePenNameMap,
      sharedState.linkMap,
      existingRow
    );
    sharedState.articleRowsById.delete(articleId);
    sharedState.existingArticleIds.delete(articleId);
  }
}

async function createGoogleSheetSyncSharedState(
  sourceUrl: string,
  identityCandidates: string[],
  teamId?: number | null,
  allowedPenNames: string[] = []
) {
  const restrictToIdentityScope = identityCandidates.length > 0;
  const allowedPenNameSet = buildAllowedPenNameSet(allowedPenNames);
  const restrictToAllowedPenNames = allowedPenNameSet.size > 0;
  const allExistingArticles = await getAllExistingArticles(teamId);
  const existingArticles = allExistingArticles.filter((row) => {
    if (restrictToAllowedPenNames && !allowedPenNameSet.has(foldText(row.penName))) {
      return false;
    }
    if (restrictToIdentityScope && !matchesIdentityCandidate(identityCandidates, row.penName)) {
      return false;
    }
    return true;
  });

  const articleRowsById = new Map<number, ExistingArticleRow>();
  const articleIdMap = new Map<string, ExistingArticleRow>();
  const ambiguousArticleIds = new Set<string>();
  const compositeMap = new Map<string, ExistingArticleRow>();
  const titlePenNameMap = new Map<string, ExistingArticleRow>();
  const linkMap = new Map<string, ExistingArticleRow>();

  for (const row of existingArticles) {
    articleRowsById.set(row.id, row);
    setLookupMaps(articleIdMap, ambiguousArticleIds, compositeMap, titlePenNameMap, linkMap, row);
  }

  const existingArticleIds = new Set(articleRowsById.keys());
  const allSyncLinks = await db
    .select({
      id: articleSyncLinks.id,
      sourceRowKey: articleSyncLinks.sourceRowKey,
      articleIdRef: articleSyncLinks.articleIdRef,
      sourceUrl: articleSyncLinks.sourceUrl,
      sheetName: articleSyncLinks.sheetName,
      sheetMonth: articleSyncLinks.sheetMonth,
      sheetYear: articleSyncLinks.sheetYear,
    })
    .from(articleSyncLinks)
    .where(eq(articleSyncLinks.sourceUrl, sourceUrl))
    .all() as SyncLinkRow[];

  const nonFutureSyncLinks = allSyncLinks.filter((link) => {
    if (!link.sheetMonth || !link.sheetYear) {
      return true;
    }
    return !isFutureSheetPeriod(link.sheetMonth, link.sheetYear);
  });
  const filteredSyncLinks = (restrictToIdentityScope || restrictToAllowedPenNames || Boolean(teamId))
    ? nonFutureSyncLinks.filter((link) => Number.isInteger(Number(link.articleIdRef || 0)) && existingArticleIds.has(Number(link.articleIdRef)))
    : nonFutureSyncLinks;

  const syncLinksBySheet = new Map<string, Map<string, SyncLinkRow>>();
  for (const syncLink of filteredSyncLinks) {
    const sheetMap = getSharedSheetSyncLinkMap({
      sourceUrl,
      existingArticleIds,
      articleRowsById,
      articleIdMap,
      ambiguousArticleIds,
      compositeMap,
      titlePenNameMap,
      linkMap,
      syncLinksBySheet,
    }, syncLink.sheetName || '');
    sheetMap.set(syncLink.sourceRowKey, syncLink);
  }

  return {
    sourceUrl,
    existingArticleIds,
    articleRowsById,
    articleIdMap,
    ambiguousArticleIds,
    compositeMap,
    titlePenNameMap,
    linkMap,
    syncLinksBySheet,
  } satisfies GoogleSheetSyncSharedState;
}

async function getGoogleSheetSyncSharedState(
  options: Pick<ExecuteGoogleSheetSyncOptions, "_sharedState" | "allowedPenNames" | "identityCandidates" | "sourceUrl" | "teamId">
) {
  if (options._sharedState) {
    return options._sharedState;
  }

  return createGoogleSheetSyncSharedState(
    resolveGoogleSheetSourceUrl(options.sourceUrl),
    normalizeGoogleSheetSyncIdentityCandidates(options.identityCandidates),
    options.teamId,
    options.allowedPenNames || []
  );
}

function resolvePreparedGoogleSheetMapping(
  prepared: Awaited<ReturnType<typeof loadGoogleSheetImport>>["prepared"],
  sheetName: string
) {
  const mapping = resolveMapping(
    resolveGoogleSheetMapping(
      prepared.analysis.columns.map((column) => ({
        key: column.key,
        header: column.header,
        suggestedField: column.suggestedField,
        suggestionScore: column.suggestionScore,
      }))
    )
  );
  const missingRequiredFields = REQUIRED_FIELDS.filter((field) => !Object.values(mapping).includes(field));
  if (missingRequiredFields.length > 0) {
    throw new Error(`KhÃ´ng thá»ƒ Ä‘á»“ng bá»™ vÃ¬ sheet "${sheetName}" thiáº¿u mapping cho: ${missingRequiredFields.join(", ")}.`);
  }

  return {
    mapping,
    mappedFields: new Set(Object.values(mapping)),
  };
}

function buildPreparedRowLookup(
  prepared: Awaited<ReturnType<typeof loadGoogleSheetImport>>["prepared"],
  collaboratorPenNames: string[],
  fallbackDate: string,
  mapping: Record<string, ImportFieldId>,
  mappedFields: Set<ImportFieldId>,
  selectedSheet: Pick<GoogleSheetTabInfo, "month" | "year">
): PreparedRowLookup {
  const bySourceRowKey = new Map<string, PreparedRowLookupEntry>();
  const byArticleId = new Map<string, PreparedRowLookupEntry>();
  const ambiguousArticleIds = new Set<string>();
  const byComposite = new Map<string, PreparedRowLookupEntry>();
  const byTitlePenName = new Map<string, PreparedRowLookupEntry>();
  const byLink = new Map<string, PreparedRowLookupEntry>();
  const errors: string[] = [];
  const warnings: string[] = [];
  let skipped = 0;
  let rowsUsingFallbackDate = 0;
  let correctedFutureDates = 0;

  for (const row of prepared.rawRows) {
    const { normalized: baseNormalized, issues, shouldSkip, usedFallbackDate } = normalizeImportedArticleRow(
      row,
      mapping,
      collaboratorPenNames,
      { fallbackDate }
    );
    const repairedDate = repairFutureImportedDateForSheet(
      baseNormalized.date,
      selectedSheet.month,
      selectedSheet.year
    );
    const normalized = repairedDate.corrected
      ? {
        ...baseNormalized,
        date: repairedDate.date,
      }
      : baseNormalized;
    const rowIssues = [...issues];

    if (shouldSkip) {
      continue;
    }

    if (usedFallbackDate) {
      rowsUsingFallbackDate += 1;
    }
    if (repairedDate.corrected) {
      correctedFutureDates += 1;
    }

    if (!normalized.date || !normalized.title || !normalized.penName) {
      rowIssues.push("Thiáº¿u dá»¯ liá»‡u báº¯t buá»™c");
    }

    if (rowIssues.length > 0) {
      skipped += 1;
      if (errors.length < 20) {
        errors.push(`DÃ²ng ${row.rowNumber}: ${rowIssues.join("; ")}`);
      }
      continue;
    }

    const articleId = normalized.articleId?.trim() || "";
    const link = normalized.link?.trim() || "";
    const entry: PreparedRowLookupEntry = {
      rowNumber: row.rowNumber,
      sourceRowKey: buildSourceRowKey({
        ...normalized,
        articleId: articleId || undefined,
        link: link || undefined,
      }),
      normalized,
      payload: buildArticlePayload(
        {
          ...normalized,
          articleId: articleId || undefined,
          link: link || undefined,
        },
        mappedFields
      ),
    };

    bySourceRowKey.set(entry.sourceRowKey, entry);
    if (articleId && !ambiguousArticleIds.has(articleId)) {
      const existingEntry = byArticleId.get(articleId);
      if (!existingEntry) {
        byArticleId.set(articleId, entry);
      } else if (!isConsistentArticleIdIdentity(existingEntry.normalized as ArticleIdentityLike, normalized as ArticleIdentityLike)) {
        byArticleId.delete(articleId);
        ambiguousArticleIds.add(articleId);
      }
    }
    if (link) {
      const linkKey = normalizeLinkKey(link);
      if (!byLink.has(linkKey)) {
        byLink.set(linkKey, entry);
      }
    }

    const compositeKey = normalizeCompositeKey(normalized.title, normalized.penName, normalized.date as string);
    if (!byComposite.has(compositeKey)) {
      byComposite.set(compositeKey, entry);
    }

    const titlePenNameKey = normalizeTitlePenNameKey(normalized.title, normalized.penName);
    if (!byTitlePenName.has(titlePenNameKey)) {
      byTitlePenName.set(titlePenNameKey, entry);
    }
  }

  if (rowsUsingFallbackDate > 0) {
    warnings.push(
      `${rowsUsingFallbackDate} dÃ²ng khÃ´ng cÃ³ "NgÃ y viáº¿t" trong sheet gá»‘c Ä‘Ã£ Ä‘Æ°á»£c gÃ¡n táº¡m ngÃ y ${fallbackDate} theo tab hiá»‡n táº¡i.`
    );
  }

  if (correctedFutureDates > 0) {
    warnings.push(
      `${correctedFutureDates} dòng có ngày tương lai đã được điều chỉnh lại theo năm của tab sheet đang đồng bộ.`
    );
  }

  return {
    bySourceRowKey,
    byArticleId,
    byComposite,
    byTitlePenName,
    byLink,
    skipped,
    errors,
    warnings,
  };
}

function findPreparedRowForArticle(
  article: ExistingArticleRow,
  lookup: PreparedRowLookup,
  syncLink?: SyncLinkRow | null
) {
  if (syncLink?.sourceRowKey) {
    const matchedBySourceRowKey = lookup.bySourceRowKey.get(syncLink.sourceRowKey);
    if (matchedBySourceRowKey) {
      return matchedBySourceRowKey;
    }
  }

  const articleId = article.articleId?.trim();
  if (articleId) {
    const matchedByArticleId = lookup.byArticleId.get(articleId);
    if (matchedByArticleId) {
      return matchedByArticleId;
    }
  }

  const link = article.link?.trim();
  if (link) {
    const matchedByLink = lookup.byLink.get(normalizeLinkKey(link));
    if (matchedByLink) {
      return matchedByLink;
    }
  }

  const compositeKey = normalizeCompositeKey(article.title, article.penName, article.date);
  const matchedByComposite = lookup.byComposite.get(compositeKey);
  if (matchedByComposite) {
    return matchedByComposite;
  }

  const articleYearMonth = getYearMonthFromDate(article.date);
  const articleDateLooksFuture = Boolean(
    articleYearMonth && isFutureSheetPeriod(articleYearMonth.month, articleYearMonth.year)
  );
  if (articleDateLooksFuture || syncLink) {
    const matchedByTitlePenName = lookup.byTitlePenName.get(
      normalizeTitlePenNameKey(article.title, article.penName)
    );
    if (matchedByTitlePenName) {
      return matchedByTitlePenName;
    }
  }

  return undefined;
}

function setLookupMaps(
  articleIdMap: Map<string, ExistingArticleRow>,
  ambiguousArticleIds: Set<string>,
  compositeMap: Map<string, ExistingArticleRow>,
  titlePenNameMap: Map<string, ExistingArticleRow>,
  linkMap: Map<string, ExistingArticleRow>,
  row: ExistingArticleRow
) {
  const articleId = row.articleId?.trim();
  if (articleId && !ambiguousArticleIds.has(articleId)) {
    const existingRow = articleIdMap.get(articleId);
    if (!existingRow) {
      articleIdMap.set(articleId, row);
    } else if (!isConsistentArticleIdIdentity(existingRow, row)) {
      articleIdMap.delete(articleId);
      ambiguousArticleIds.add(articleId);
    }
  }
  compositeMap.set(normalizeCompositeKey(row.title, row.penName, row.date), row);
  titlePenNameMap.set(normalizeTitlePenNameKey(row.title, row.penName), row);
  const link = row.link?.trim();
  if (link) {
    linkMap.set(normalizeLinkKey(link), row);
  }
}

function removeLookupMaps(
  articleIdMap: Map<string, ExistingArticleRow>,
  compositeMap: Map<string, ExistingArticleRow>,
  titlePenNameMap: Map<string, ExistingArticleRow>,
  linkMap: Map<string, ExistingArticleRow>,
  row: ExistingArticleRow
) {
  const articleId = row.articleId?.trim();
  if (articleId) {
    articleIdMap.delete(articleId);
  }
  compositeMap.delete(normalizeCompositeKey(row.title, row.penName, row.date));
  titlePenNameMap.delete(normalizeTitlePenNameKey(row.title, row.penName));
  const link = row.link?.trim();
  if (link) {
    linkMap.delete(normalizeLinkKey(link));
  }
}

function doesArticlePayloadDiffer(
  existing: ExistingArticleRow,
  next: Partial<typeof articles.$inferInsert>
) {
  const hasField = (field: keyof typeof next) => Object.prototype.hasOwnProperty.call(next, field);

  return (
    (next.date ?? null) !== (existing.date ?? null)
    || (next.title ?? null) !== (existing.title ?? null)
    || (next.penName ?? null) !== (existing.penName ?? null)
    || (next.category ?? null) !== (existing.category ?? null)
    || (next.articleType ?? null) !== (existing.articleType ?? null)
    || (next.contentType ?? null) !== (existing.contentType ?? null)
    || (next.wordCountRange ?? null) !== (existing.wordCountRange ?? null)
    || (next.status ?? null) !== (existing.status ?? null)
    || (hasField("articleId") && (next.articleId ?? null) !== (existing.articleId ?? null))
    || (hasField("link") && (next.link ?? null) !== (existing.link ?? null))
    || (hasField("reviewerName") && (next.reviewerName ?? null) !== (existing.reviewerName ?? null))
    || (hasField("notes") && (next.notes ?? null) !== (existing.notes ?? null))
  );
}

export async function refreshScopedArticlesFromGoogleSheet(
  options: RefreshScopedGoogleSheetSyncOptions
): Promise<GoogleSheetSyncExecutionResult> {
  await ensureDatabaseInitialized();

  const targetArticleIds = Array.from(
    new Set(
      options.articleIds
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
    )
  );

  if (targetArticleIds.length === 0) {
    throw new Error("ChÆ°a cÃ³ bÃ i viáº¿t nÃ o trong danh sÃ¡ch Ä‘ang lá»c Ä‘á»ƒ Ä‘á»“ng bá»™ nhanh.");
  }

  const sourceUrl = resolveGoogleSheetSourceUrl(options.sourceUrl);
  const [collaboratorPenNames, workbookPayload, targetArticles, syncLinks] = await Promise.all([
    getCollaboratorPenNames(options.teamId),
    downloadGoogleSheetWorkbook(sourceUrl),
    db
      .select({
        id: articles.id,
        teamId: articles.teamId,
        articleId: articles.articleId,
        title: articles.title,
        penName: articles.penName,
        date: articles.date,
        link: articles.link,
        category: articles.category,
        articleType: articles.articleType,
        contentType: articles.contentType,
        wordCountRange: articles.wordCountRange,
        status: articles.status,
        reviewerName: articles.reviewerName,
        notes: articles.notes,
      })
      .from(articles)
      .where(inArray(articles.id, targetArticleIds))
      .all(),
    db
      .select({
        id: articleSyncLinks.id,
        sourceRowKey: articleSyncLinks.sourceRowKey,
        articleIdRef: articleSyncLinks.articleIdRef,
        sourceUrl: articleSyncLinks.sourceUrl,
        sheetName: articleSyncLinks.sheetName,
        sheetMonth: articleSyncLinks.sheetMonth,
        sheetYear: articleSyncLinks.sheetYear,
      })
      .from(articleSyncLinks)
      .where(inArray(articleSyncLinks.articleIdRef, targetArticleIds))
      .all() as Promise<SyncLinkRow[]>,
  ]);
  const { workbook } = workbookPayload;

  if (targetArticles.length === 0) {
    throw new Error("KhÃ´ng tÃ¬m tháº¥y bÃ i viáº¿t nÃ o trong há»‡ thá»‘ng Ä‘á»ƒ Ä‘á»“ng bá»™ nhanh.");
  }
  const targetArticleById = new Map(targetArticles.map((article) => [article.id, article]));

  const syncLinkByArticleId = new Map<number, SyncLinkRow>();
  for (const syncLink of syncLinks) {
    const articleIdRef = Number(syncLink.articleIdRef || 0);
    if (articleIdRef > 0 && syncLink.sourceUrl === sourceUrl && !syncLinkByArticleId.has(articleIdRef)) {
      syncLinkByArticleId.set(articleIdRef, syncLink);
    }
  }

  const groups = new Map<string, { sheetName?: string; month: number; year: number; articleIds: number[] }>();
  const warnings: string[] = [];
  let skipped = 0;

  for (const article of targetArticles) {
    const syncLink = syncLinkByArticleId.get(article.id);
    const syncLinkTab = syncLink?.sheetName ? parseSheetTabInfo(syncLink.sheetName) : null;
    const syncLinkPeriodIsFuture = Boolean(
      (syncLink?.sheetMonth && syncLink?.sheetYear && isFutureSheetPeriod(syncLink.sheetMonth, syncLink.sheetYear))
      || (syncLinkTab && isFutureSheetPeriod(syncLinkTab.month, syncLinkTab.year))
    );
    const articleDatePeriod = getYearMonthFromDate(article.date);
    const articleDatePeriodIsFuture = Boolean(
      articleDatePeriod && isFutureSheetPeriod(articleDatePeriod.month, articleDatePeriod.year)
    );
    const resolvedMonth = syncLinkPeriodIsFuture
      ? (options.month ?? (articleDatePeriodIsFuture ? null : articleDatePeriod?.month) ?? null)
      : (syncLink?.sheetMonth ?? options.month ?? syncLinkTab?.month ?? (articleDatePeriodIsFuture ? null : articleDatePeriod?.month) ?? null);
    const resolvedYear = syncLinkPeriodIsFuture
      ? (options.year ?? (articleDatePeriodIsFuture ? null : articleDatePeriod?.year) ?? null)
      : (syncLink?.sheetYear ?? options.year ?? syncLinkTab?.year ?? (articleDatePeriodIsFuture ? null : articleDatePeriod?.year) ?? null);
    const resolvedSheetName = (syncLinkTab?.isCopy || syncLinkPeriodIsFuture) ? undefined : (syncLink?.sheetName || undefined);

    if (!resolvedMonth || !resolvedYear) {
      skipped += 1;
      if (warnings.length < 20) {
        warnings.push(`KhÃ´ng xÃ¡c Ä‘á»‹nh Ä‘Æ°á»£c tab thÃ¡ng cho bÃ i "${article.title}".`);
      }
      continue;
    }

    const key = resolvedSheetName
      ? `sheet:${resolvedSheetName}`
      : `month:${resolvedMonth}:${resolvedYear}`;
    const existingGroup = groups.get(key);
    if (existingGroup) {
      existingGroup.articleIds.push(article.id);
      continue;
    }

    groups.set(key, {
      sheetName: resolvedSheetName,
      month: resolvedMonth,
      year: resolvedYear,
      articleIds: [article.id],
    });
  }

  if (groups.size === 0) {
    throw new Error("KhÃ´ng tÃ¬m tháº¥y tab Google Sheet phÃ¹ há»£p cho danh sÃ¡ch Ä‘ang lá»c.");
  }

  let updated = 0;
  let duplicates = 0;
  let deleted = 0;
  const errors: string[] = [];
  const articleIdsToDelete = new Set<number>();
  let resultSheetName = "";
  let resultMonth = options.month ?? null;
  let resultYear = options.year ?? null;

  for (const group of groups.values()) {
    const { prepared, selectedSheet } = await loadGoogleSheetImport({
      sourceUrl,
      sheetName: group.sheetName,
      month: group.month,
      year: group.year,
      collaboratorPenNames,
      workbook,
    });
    const { mapping, mappedFields } = resolvePreparedGoogleSheetMapping(prepared, selectedSheet.name);
    const lookup = buildPreparedRowLookup(
      prepared,
      collaboratorPenNames,
      buildSheetFallbackDate(selectedSheet.month, selectedSheet.year),
      mapping,
      mappedFields,
      selectedSheet
    );

    warnings.push(...lookup.warnings.filter((warning) => !warnings.includes(warning)).slice(0, Math.max(0, 20 - warnings.length)));
    errors.push(...lookup.errors.slice(0, Math.max(0, 20 - errors.length)));
    skipped += lookup.skipped;

    resultSheetName = resultSheetName || selectedSheet.name;
    resultMonth = resultMonth ?? selectedSheet.month;
    resultYear = resultYear ?? selectedSheet.year;

    const groupArticles = group.articleIds.reduce<typeof targetArticles>((accumulator, articleId) => {
      const article = targetArticleById.get(articleId);
      if (article) {
        accumulator.push(article);
      }
      return accumulator;
    }, []);
    for (const article of groupArticles) {
      const syncLink = syncLinkByArticleId.get(article.id) ?? null;
      const matchedRow = findPreparedRowForArticle(article, lookup, syncLink);
      const articleYearMonth = getYearMonthFromDate(article.date);
      const matchesSelectedSheetByDate =
        articleYearMonth?.month === selectedSheet.month
        && articleYearMonth?.year === selectedSheet.year;
      const matchesRequestedPeriod =
        options.month === selectedSheet.month
        && options.year === selectedSheet.year;

      if (!matchedRow) {
        const shouldMirrorDelete = (
          syncLink != null
          && syncLink.sheetMonth === selectedSheet.month
          && syncLink.sheetYear === selectedSheet.year
          && (!syncLink.sheetName || syncLink.sheetName === selectedSheet.name)
        ) || (
          syncLink == null
          && (matchesSelectedSheetByDate || matchesRequestedPeriod)
        );

        if (shouldMirrorDelete) {
          articleIdsToDelete.add(article.id);
          continue;
        }

        skipped += 1;
        if (warnings.length < 20) {
          warnings.push(`KhÃ´ng tÃ¬m tháº¥y bÃ i "${article.title}" trong sheet ${selectedSheet.name}.`);
        }
        continue;
      }

      duplicates += 1;
      if (!doesArticlePayloadDiffer(article, matchedRow.payload)) {
        if (syncLink && (
          syncLink.sourceRowKey !== matchedRow.sourceRowKey
          || syncLink.sheetName !== selectedSheet.name
          || syncLink.sheetMonth !== selectedSheet.month
          || syncLink.sheetYear !== selectedSheet.year
        )) {
          await db
            .update(articleSyncLinks)
            .set({
              sourceRowKey: matchedRow.sourceRowKey,
              sheetName: selectedSheet.name,
              sheetMonth: selectedSheet.month,
              sheetYear: selectedSheet.year,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(articleSyncLinks.id, syncLink.id))
            .run();
        } else if (!syncLink) {
          await db
            .insert(articleSyncLinks)
            .values({
              sourceUrl,
              sheetName: selectedSheet.name,
              sheetMonth: selectedSheet.month,
              sheetYear: selectedSheet.year,
              sourceRowKey: matchedRow.sourceRowKey,
              articleIdRef: article.id,
            })
            .run();
        }
        continue;
      }

      await db
        .update(articles)
        .set({
          ...matchedRow.payload,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(articles.id, article.id))
        .run();

      if (syncLink) {
        await db
          .update(articleSyncLinks)
          .set({
            sourceRowKey: matchedRow.sourceRowKey,
            sheetName: selectedSheet.name,
            sheetMonth: selectedSheet.month,
            sheetYear: selectedSheet.year,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(articleSyncLinks.id, syncLink.id))
          .run();
      } else {
        await db
          .insert(articleSyncLinks)
          .values({
            sourceUrl,
            sheetName: selectedSheet.name,
            sheetMonth: selectedSheet.month,
            sheetYear: selectedSheet.year,
            sourceRowKey: matchedRow.sourceRowKey,
            articleIdRef: article.id,
          })
          .run();
      }

      updated += 1;
    }
  }

  if (articleIdsToDelete.size > 0) {
    const deletedResult = await deleteArticlesForSync([...articleIdsToDelete]);
    deleted = deletedResult.deletedArticles;

    if (warnings.length < 20) {
      warnings.push(
        `${deleted} bÃ i Ä‘Ã£ bá»‹ xÃ³a khá»i há»‡ thá»‘ng vÃ¬ khÃ´ng cÃ²n tá»“n táº¡i trong Google Sheet gá»‘c cá»§a tab Ä‘ang Ä‘á»“ng bá»™.`
      );
    }
  }

  return {
    sourceUrl,
    sheetName: resultSheetName || "Scoped sync",
    month: resultMonth ?? options.month ?? 0,
    year: resultYear ?? options.year ?? 0,
    requestedMonth: options.month ?? null,
    requestedYear: options.year ?? null,
    requestedSheetName: options.sheetName,
    total: targetArticles.length,
    inserted: 0,
    updated,
    duplicates,
    deleted,
    skipped,
    errors: errors.slice(0, 20),
    warnings: warnings.slice(0, 20),
  };
}

export async function executeGoogleSheetSync(
  options: ExecuteGoogleSheetSyncOptions = {}
): Promise<GoogleSheetSyncExecutionResult> {
  if (!options._skipEnsureInitialized) {
    await ensureDatabaseInitialized();
  }

  const { collaboratorPenNames, collaboratorDirectory } = await getGoogleSheetSyncCollaboratorContext(options);
  const allowedPenNameSet = buildAllowedPenNameSet(options.allowedPenNames || []);
  const restrictToAllowedPenNames = allowedPenNameSet.size > 0;
  const identityCandidates = normalizeGoogleSheetSyncIdentityCandidates(options.identityCandidates);
  const restrictToIdentityScope = identityCandidates.length > 0;

  const [importPayload, sharedState] = await Promise.all([
    loadGoogleSheetImport({
      sourceUrl: options.sourceUrl,
      sheetName: options.sheetName,
      month: options.month,
      year: options.year,
      collaboratorPenNames,
      workbook: options._workbook,
    }),
    getGoogleSheetSyncSharedState(options),
  ]);
  const { prepared, selectedSheet, sourceUrl } = importPayload;

  if (prepared.rawRows.length === 0) {
    throw new Error("Tab Google Sheets Ä‘ang chá»n chÆ°a cÃ³ dÃ²ng dá»¯ liá»‡u há»£p lá»‡ Ä‘á»ƒ Ä‘á»“ng bá»™.");
  }

  const { mapping, mappedFields } = resolvePreparedGoogleSheetMapping(prepared, selectedSheet.name);
  const articleIdMap = sharedState.articleIdMap;
  const ambiguousArticleIds = sharedState.ambiguousArticleIds;
  const compositeMap = sharedState.compositeMap;
  const linkMap = sharedState.linkMap;
  const existingSyncLinkMap = getSharedSheetSyncLinkMap(sharedState, selectedSheet.name);
  const existingSyncLinks = [...existingSyncLinkMap.values()];
  const seenSourceRowKeys = new Set<string>();
  const seenArticleIds = new Set<number>();

  let inserted = 0;
  let updated = 0;
  let duplicates = 0;
  let deleted = 0;
  let skipped = 0;
  const errors: string[] = [];
  const runtimeWarnings: string[] = [];
  let rowsUsingFallbackDate = 0;
  let ignoredOutsideScope = 0;
  let correctedFutureDates = 0;
  const fallbackDate = buildSheetFallbackDate(selectedSheet.month, selectedSheet.year);

  for (const row of prepared.rawRows) {
    try {
      const { normalized: baseNormalized, issues, shouldSkip, usedFallbackDate } = normalizeImportedArticleRow(
        row,
        mapping,
        collaboratorPenNames,
        { fallbackDate }
      );
      const repairedDate = repairFutureImportedDateForSheet(
        baseNormalized.date,
        selectedSheet.month,
        selectedSheet.year
      );
      const normalized = repairedDate.corrected
        ? {
          ...baseNormalized,
          date: repairedDate.date,
        }
        : baseNormalized;
      const rowIssues = [...issues];

      if (shouldSkip) {
        continue;
      }

      if (usedFallbackDate) {
        rowsUsingFallbackDate += 1;
      }
      if (repairedDate.corrected) {
        correctedFutureDates += 1;
      }

      if (!normalized.date || !normalized.title || !normalized.penName) {
        rowIssues.push("Thiáº¿u dá»¯ liá»‡u báº¯t buá»™c");
      }

      if (rowIssues.length > 0) {
        skipped += 1;
        if (errors.length < 20) {
          errors.push(`DÃ²ng ${row.rowNumber}: ${rowIssues.join("; ")}`);
        }
        continue;
      }

      if (restrictToAllowedPenNames && !allowedPenNameSet.has(foldText(normalized.penName))) {
        ignoredOutsideScope += 1;
        continue;
      }

      if (restrictToIdentityScope && !matchesIdentityCandidate(identityCandidates, normalized.penName)) {
        ignoredOutsideScope += 1;
        continue;
      }

      const articleId = normalized.articleId?.trim() || null;
      const link = normalized.link?.trim() || null;
      const sourceRowKey = buildSourceRowKey({ ...normalized, articleId: articleId ?? undefined, link: link ?? undefined });
      const existingLink = existingSyncLinkMap.get(sourceRowKey);
      seenSourceRowKeys.add(sourceRowKey);
      const compositeKey = normalizeCompositeKey(normalized.title, normalized.penName, normalized.date as string);
      const resolvedTeamId = resolveImportedArticleTeamId(normalized.penName, collaboratorDirectory, options.teamId);
      const matchedByCurrentSheet = existingLink?.articleIdRef ? sharedState.articleRowsById.get(Number(existingLink.articleIdRef)) : undefined;
      const matchedByArticleId = articleId && !ambiguousArticleIds.has(articleId) ? articleIdMap.get(articleId) : undefined;
      const matchedByComposite = compositeMap.get(compositeKey);
      const matchedByLink = link ? linkMap.get(normalizeLinkKey(link)) : undefined;
      const initialTarget = matchedByCurrentSheet ?? matchedByArticleId ?? matchedByComposite ?? matchedByLink;
      const shouldSplitSharedTarget = Boolean(
        initialTarget
        && hasSyncLinkOnDifferentSheet(sharedState, initialTarget.id, selectedSheet.name)
        && (!existingLink || Number(existingLink.articleIdRef || 0) === initialTarget.id)
      );
      const target = shouldSplitSharedTarget ? undefined : initialTarget;

      let resolvedArticleId = target?.id ?? null;
      const nextPayload = buildArticlePayload({ ...normalized, articleId: articleId ?? undefined }, mappedFields);

      if (target) {
        duplicates += 1;
        const nextTeamId = target.teamId ?? resolvedTeamId ?? null;
        const shouldRepairTeamId = nextTeamId !== (target.teamId ?? null);
        if (shouldRepairTeamId || doesArticlePayloadDiffer(target, nextPayload)) {
          await db
            .update(articles)
            .set({
              ...nextPayload,
              teamId: nextTeamId,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(articles.id, target.id))
            .run();

          const finalArticleRow: ExistingArticleRow = {
            id: target.id,
            teamId: nextTeamId,
            articleId: Object.prototype.hasOwnProperty.call(nextPayload, "articleId") ? (nextPayload.articleId ?? null) : (target.articleId ?? null),
            title: nextPayload.title as string,
            penName: nextPayload.penName as string,
            date: nextPayload.date as string,
            link: Object.prototype.hasOwnProperty.call(nextPayload, "link") ? (nextPayload.link ?? null) : (target.link ?? null),
            category: nextPayload.category ?? target.category ?? null,
            articleType: nextPayload.articleType ?? target.articleType ?? null,
            contentType: nextPayload.contentType ?? target.contentType ?? null,
            wordCountRange: nextPayload.wordCountRange ?? target.wordCountRange ?? null,
            status: nextPayload.status ?? target.status ?? null,
            reviewerName: Object.prototype.hasOwnProperty.call(nextPayload, "reviewerName") ? (nextPayload.reviewerName ?? null) : (target.reviewerName ?? null),
            notes: Object.prototype.hasOwnProperty.call(nextPayload, "notes") ? (nextPayload.notes ?? null) : (target.notes ?? null),
          };

          upsertSharedArticleRow(sharedState, finalArticleRow);
          updated += 1;
        }
      } else {
        const insertValues = {
          ...nextPayload,
          teamId: resolvedTeamId ?? null,
          createdByUserId: options.createdByUserId ?? null,
        } as typeof articles.$inferInsert;

        const insertedRow = await db.insert(articles)
          .values(insertValues)
          .returning({ id: articles.id })
          .get();

        resolvedArticleId = Number(insertedRow?.id);
        upsertSharedArticleRow(sharedState, {
          id: resolvedArticleId,
          teamId: resolvedTeamId ?? null,
          articleId,
          title: normalized.title,
          penName: normalized.penName,
          date: normalized.date as string,
          link,
          category: nextPayload.category ?? null,
          articleType: nextPayload.articleType ?? null,
          contentType: nextPayload.contentType ?? null,
          wordCountRange: nextPayload.wordCountRange ?? null,
          status: nextPayload.status ?? null,
          reviewerName: Object.prototype.hasOwnProperty.call(nextPayload, "reviewerName") ? (nextPayload.reviewerName ?? null) : null,
          notes: Object.prototype.hasOwnProperty.call(nextPayload, "notes") ? (nextPayload.notes ?? null) : null,
        });
        inserted += 1;
      }

      if (Number.isInteger(resolvedArticleId) && Number(resolvedArticleId) > 0) {
        seenArticleIds.add(Number(resolvedArticleId));
      }
      if (existingLink) {
        const nextSyncLink: SyncLinkRow = {
          ...existingLink,
          articleIdRef: resolvedArticleId,
          sheetMonth: selectedSheet.month,
          sheetYear: selectedSheet.year,
          sheetName: selectedSheet.name,
        };

        await db
          .update(articleSyncLinks)
          .set({
            articleIdRef: resolvedArticleId,
            sheetMonth: selectedSheet.month,
            sheetYear: selectedSheet.year,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(articleSyncLinks.id, existingLink.id))
          .run();

        upsertSharedSyncLink(sharedState, nextSyncLink);
      } else {
        const insertedSyncLink = await db
          .insert(articleSyncLinks)
          .values({
            sourceUrl,
            sheetName: selectedSheet.name,
            sheetMonth: selectedSheet.month,
            sheetYear: selectedSheet.year,
            sourceRowKey,
            articleIdRef: resolvedArticleId,
          })
          .returning({ id: articleSyncLinks.id })
          .get();

        upsertSharedSyncLink(sharedState, {
          id: Number(insertedSyncLink?.id),
          sourceRowKey,
          articleIdRef: resolvedArticleId,
          sourceUrl,
          sheetName: selectedSheet.name,
          sheetMonth: selectedSheet.month,
          sheetYear: selectedSheet.year,
        });
      }
    } catch (rowError) {
      skipped += 1;
      if (errors.length < 20) {
        errors.push(`DÃ²ng ${row.rowNumber}: ${String(rowError)}`);
      }
    }
  }

  if (rowsUsingFallbackDate > 0) {
    runtimeWarnings.push(
      `${rowsUsingFallbackDate} dÃ²ng khÃ´ng cÃ³ "NgÃ y viáº¿t" trong sheet gá»‘c Ä‘Ã£ Ä‘Æ°á»£c gÃ¡n táº¡m ngÃ y ${fallbackDate} theo tab ${selectedSheet.name}.`
    );
  }
  if (correctedFutureDates > 0) {
    runtimeWarnings.push(
      `${correctedFutureDates} dÃ²ng cÃ³ ngÃ y tÆ°Æ¡ng lai Ä‘Ã£ Ä‘Æ°á»£c Ä‘iá»u chá»‰nh láº¡i theo nÄƒm cá»§a tab ${selectedSheet.name}.`
    );
  }
  if (ignoredOutsideScope > 0) {
    runtimeWarnings.push(
      `ÄÃ£ bá» qua ${ignoredOutsideScope} dÃ²ng ngoÃ i pháº¡m vi tÃ i khoáº£n hiá»‡n táº¡i Ä‘á»ƒ Ä‘áº£m báº£o chá»‰ Ä‘á»“ng bá»™ dá»¯ liá»‡u cá»§a chÃ­nh ngÆ°á»i dÃ¹ng.`
    );
  }

  const staleLinks = existingSyncLinks.filter((link) => !seenSourceRowKeys.has(link.sourceRowKey));
  const staleArticleIds = Array.from(
    new Set(
      staleLinks
        .map((link) => Number(link.articleIdRef || 0))
        .filter((id) => Number.isInteger(id) && id > 0 && !seenArticleIds.has(id))
    )
  );

  if (staleLinks.length > 0) {
    await db
      .delete(articleSyncLinks)
      .where(inArray(articleSyncLinks.id, staleLinks.map((link) => link.id)))
      .run();
    removeSharedSyncLinksByIds(sharedState, staleLinks.map((link) => link.id));
  }

  if (staleArticleIds.length > 0) {
    const deleteSafety = assessGoogleSheetDeleteSafety({
      candidateDeleteCount: staleArticleIds.length,
      referenceRowCount: Math.max(prepared.rawRows.length - ignoredOutsideScope, 0),
      rowsUsingFallbackDate,
      scopeLabel: `tab ${selectedSheet.name}`,
    });

    if (!deleteSafety.allowed) {
      runtimeWarnings.push(deleteSafety.warning || "ÄÃ£ cháº·n xÃ³a bÃ i do sync phÃ¡t hiá»‡n báº¥t thÆ°á»ng.");
    } else {
      const deletedResult = await deleteArticlesForSync(staleArticleIds);
      deleted = deletedResult.deletedArticles;
      removeSharedArticles(sharedState, staleArticleIds);
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
    total: Math.max(prepared.rawRows.length - ignoredOutsideScope, 0),
    inserted,
    updated,
    duplicates,
    deleted,
    skipped,
    errors,
    warnings: [...prepared.analysis.warnings, ...runtimeWarnings],
    scope: "sheet",
    processedSheets: [selectedSheet.name],
  };
}

export async function executeGoogleSheetWorkbookSync(
  options: ExecuteGoogleSheetSyncOptions = {}
): Promise<GoogleSheetSyncExecutionResult> {
  await ensureDatabaseInitialized();

  const { collaboratorPenNames, collaboratorDirectory } = await getGoogleSheetSyncCollaboratorContext(options);
  const [workbookPayload, sharedState] = await Promise.all([
    downloadGoogleSheetWorkbook(options.sourceUrl),
    getGoogleSheetSyncSharedState(options),
  ]);
  const { sourceUrl, workbook } = workbookPayload;
  const allMonthlyTabs = listMonthlySheetTabs(workbook.SheetNames);
  const tabs = listPreferredSheetTabs(workbook.SheetNames);
  const skippedDuplicateTabs = Math.max(0, allMonthlyTabs.length - tabs.length);

  if (tabs.length === 0) {
    throw new Error("KhÃ´ng tÃ¬m tháº¥y tab thÃ¡ng/nÄƒm há»£p lá»‡ trong Google Sheets.");
  }

  const aggregate: GoogleSheetSyncExecutionResult = {
    sourceUrl,
    sheetName: "ToÃ n workbook",
    month: tabs[0]?.month || 0,
    year: tabs[0]?.year || 0,
    requestedMonth: null,
    requestedYear: null,
    total: 0,
    inserted: 0,
    updated: 0,
    duplicates: 0,
    deleted: 0,
    skipped: 0,
    errors: [],
    warnings: [],
    scope: "workbook",
    processedSheets: [],
  };

  for (const tab of tabs) {
    const result = await executeGoogleSheetSync({
      ...options,
      sourceUrl,
      sheetName: tab.name,
      month: tab.month,
      year: tab.year,
      _workbook: workbook,
      _collaboratorPenNames: collaboratorPenNames,
      _collaboratorDirectory: collaboratorDirectory,
      _skipEnsureInitialized: true,
      _sharedState: sharedState,
    });

    aggregate.total += result.total;
    aggregate.inserted += result.inserted;
    aggregate.updated += result.updated;
    aggregate.duplicates += result.duplicates;
    aggregate.deleted += result.deleted;
    aggregate.skipped += result.skipped;
    aggregate.processedSheets?.push(tab.name);

    for (const warning of result.warnings) {
      if (aggregate.warnings.length >= 20 || aggregate.warnings.includes(warning)) continue;
      aggregate.warnings.push(warning);
    }

    for (const error of result.errors) {
      if (aggregate.errors.length >= 20 || aggregate.errors.includes(error)) continue;
      aggregate.errors.push(error);
    }
  }

  if ((aggregate.processedSheets?.length || 0) > 0 && aggregate.warnings.length < 20) {
    aggregate.warnings.unshift(`ÄÃ£ reconcile toÃ n workbook qua ${aggregate.processedSheets?.length} tab thÃ¡ng há»£p lá»‡.`);
  }

  if (skippedDuplicateTabs > 0 && aggregate.warnings.length < 20) {
    aggregate.warnings.unshift(`ÄÃ£ bá» qua ${skippedDuplicateTabs} tab báº£n sao Ä‘á»ƒ trÃ¡nh ghi Ä‘Ã¨ dá»¯ liá»‡u tá»« Google Sheet copy.`);
  }

  return aggregate;
}


