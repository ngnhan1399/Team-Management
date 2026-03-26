import fs from "node:fs/promises";
import { read, utils } from "xlsx";
import type { Browser, BrowserContext, Page } from "playwright-core";
import type { ReviewRegistrationProfile } from "@/lib/review-registration";

type ServerlessChromium = {
  args: string[];
  executablePath(input?: string): Promise<string>;
  setGraphicsMode: boolean;
};

type ReviewRegistrationBrowserInput = {
  articleDate: string;
  articleLink: string;
  writerPenName: string;
  reviewerPenName: string;
  managerLabel: string;
  profile: ReviewRegistrationProfile;
};

type ReviewRegistrationBrowserResult = {
  success: boolean;
  message: string;
  sheetName?: string;
  rowNumber?: number;
  sheetMonth?: number;
  sheetYear?: number;
  sheetWrittenAt?: string;
  completedAt?: string;
};

type PlaywrightStorageState = {
  cookies?: unknown[];
  origins?: unknown[];
};

type BrowserContextStorageState = Parameters<Browser["newContext"]>[0] extends infer T
  ? T extends { storageState?: infer U }
    ? U
    : never
  : never;

type SheetSnapshotRow = string[];

type MonthSection = {
  month: number;
  year: number;
  startRow: number;
  endRow: number;
};

const REVIEW_REGISTRATION_BROWSER_TIMEOUT_MS = 45_000;
const REVIEW_REGISTRATION_BROWSER_VIEWPORT = { width: 1440, height: 960 };

let browserPromise: Promise<Browser | null> | null = null;

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function foldText(value: unknown) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/gi, "d")
    .toLowerCase();
}

function parseYearMonthFromArticleDate(value: string) {
  const match = normalizeText(value).match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
  };
}

function extractSpreadsheetId(spreadsheetUrl: string) {
  const match = normalizeText(spreadsheetUrl).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match?.[1] || "";
}

function buildCsvExportUrl(profile: ReviewRegistrationProfile) {
  const spreadsheetId = extractSpreadsheetId(profile.spreadsheetUrl);
  if (!spreadsheetId) {
    throw new Error("Không đọc được spreadsheet ID từ URL sheet bài duyệt.");
  }
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${profile.sheetGid}`;
}

function buildSheetEditUrl(profile: ReviewRegistrationProfile, rowNumber: number) {
  const spreadsheetId = extractSpreadsheetId(profile.spreadsheetUrl);
  if (!spreadsheetId) {
    throw new Error("Không đọc được spreadsheet ID từ URL sheet bài duyệt.");
  }
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?gid=${profile.sheetGid}#gid=${profile.sheetGid}&range=A${rowNumber}:M${rowNumber}`;
}

async function readStorageStateFromConfig(): Promise<PlaywrightStorageState | null> {
  const jsonValue = normalizeText(process.env.REVIEW_REGISTRATION_GOOGLE_STORAGE_STATE_JSON);
  if (jsonValue) {
    return JSON.parse(jsonValue) as PlaywrightStorageState;
  }

  const base64Value = normalizeText(process.env.REVIEW_REGISTRATION_GOOGLE_STORAGE_STATE_BASE64);
  if (base64Value) {
    const decoded = Buffer.from(base64Value, "base64").toString("utf8");
    return JSON.parse(decoded) as PlaywrightStorageState;
  }

  const statePath = normalizeText(process.env.REVIEW_REGISTRATION_GOOGLE_STORAGE_STATE_PATH);
  if (statePath) {
    const fileContent = await fs.readFile(statePath, "utf8");
    return JSON.parse(fileContent) as PlaywrightStorageState;
  }

  return null;
}

export function hasReviewRegistrationBrowserSessionConfig() {
  return Boolean(
    normalizeText(process.env.REVIEW_REGISTRATION_GOOGLE_STORAGE_STATE_JSON)
    || normalizeText(process.env.REVIEW_REGISTRATION_GOOGLE_STORAGE_STATE_BASE64)
    || normalizeText(process.env.REVIEW_REGISTRATION_GOOGLE_STORAGE_STATE_PATH),
  );
}

async function getAutomationBrowser() {
  if (process.platform !== "linux") {
    return null;
  }

  if (!browserPromise) {
    browserPromise = (async () => {
      try {
        const [{ chromium }, chromiumModule] = await Promise.all([
          import("playwright-core"),
          import("@sparticuz/chromium"),
        ]);
        const chromiumBinary = (chromiumModule.default ?? chromiumModule) as unknown as ServerlessChromium;
        chromiumBinary.setGraphicsMode = false;
        return chromium.launch({
          args: chromiumBinary.args,
          executablePath: await chromiumBinary.executablePath(),
          headless: true,
        });
      } catch {
        browserPromise = null;
        return null;
      }
    })();
  }

  return browserPromise;
}

async function fetchSheetSnapshot(profile: ReviewRegistrationProfile) {
  const response = await fetch(buildCsvExportUrl(profile), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Không tải được CSV sheet bài duyệt (${response.status}).`);
  }

  const csvText = await response.text();
  const workbook = read(csvText, { type: "string" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) {
    throw new Error("Không đọc được dữ liệu sheet bài duyệt.");
  }

  return utils.sheet_to_json<SheetSnapshotRow>(sheet, {
    header: 1,
    raw: false,
    defval: "",
  }).map((row) => row.map((value) => normalizeText(value)));
}

function findLatestMonthSection(rows: SheetSnapshotRow[], referenceArticleDate?: string) {
  const markers = rows
    .map((row, index) => {
      const match = normalizeText(row[0]).match(/^Tháng\s+(\d{1,2})$/i);
      if (!match) {
        return null;
      }
      return {
        rowNumber: index + 1,
        month: Number(match[1]),
      };
    })
    .filter((value): value is { rowNumber: number; month: number } => Boolean(value));

  if (!markers.length) {
    return null;
  }

  const latest = markers[markers.length - 1];
  const nextMarker = markers[markers.length] || null;
  const articlePeriod = parseYearMonthFromArticleDate(referenceArticleDate || "");
  const now = new Date();
  const currentMonth = articlePeriod?.month ?? (now.getMonth() + 1);
  const currentYear = articlePeriod?.year ?? now.getFullYear();
  const year = latest.month > currentMonth + 1 ? currentYear - 1 : currentYear;

  return {
    month: latest.month,
    year,
    startRow: latest.rowNumber + 1,
    endRow: nextMarker ? nextMarker.rowNumber - 1 : rows.length,
  } satisfies MonthSection;
}

function resolveWritableRow(rows: SheetSnapshotRow[], monthSection: MonthSection, articleLink: string) {
  for (let rowNumber = monthSection.startRow; rowNumber <= monthSection.endRow; rowNumber += 1) {
    const row = rows[rowNumber - 1] || [];
    const linkValue = normalizeText(row[1]);
    const writerValue = normalizeText(row[2]);
    if (linkValue && linkValue === articleLink) {
      return { rowNumber, alreadyExists: true };
    }
    if (!linkValue && !writerValue) {
      return { rowNumber, alreadyExists: false };
    }
  }

  return {
    rowNumber: monthSection.endRow + 1,
    alreadyExists: false,
  };
}

async function waitForSheetReady(page: Page) {
  await page.waitForLoadState("domcontentloaded", { timeout: REVIEW_REGISTRATION_BROWSER_TIMEOUT_MS });
  await page.waitForTimeout(2_000);
  await page.locator("#waffle-grid-container").waitFor({ state: "visible", timeout: REVIEW_REGISTRATION_BROWSER_TIMEOUT_MS });
  await page.locator(".waffle-spinner-active").waitFor({ state: "hidden", timeout: 15_000 }).catch(() => undefined);
}

async function assertGoogleEditorSession(page: Page) {
  const bodyText = foldText(await page.locator("body").innerText().catch(() => ""));
  if (bodyText.includes("dang nhap")) {
    throw new Error("Phiên Google đã lưu không còn hợp lệ. Hãy đăng nhập lại và lưu session mới.");
  }
  if (bodyText.includes("chi xem")) {
    throw new Error("Tài khoản Google hiện tại chỉ có quyền xem sheet bài duyệt, chưa có quyền chỉnh sửa.");
  }
}

async function fillRowValues(page: Page, values: Array<string | null>) {
  const grid = page.locator("#waffle-grid-container");
  await grid.click({ position: { x: 92, y: 38 } });
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.waitForTimeout(150);

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value) {
      await page.keyboard.type(value, { delay: 25 });
    }

    if (index < values.length - 1) {
      await page.keyboard.press("Tab");
      await page.waitForTimeout(120);
    }
  }

  await page.keyboard.press("Enter");
  await page.waitForTimeout(2_000);
}

function formatDateForSheet(value: string) {
  const normalized = normalizeText(value);
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return normalized;
  }
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function rowMatchesExpectation(row: SheetSnapshotRow, input: ReviewRegistrationBrowserInput) {
  return (
    normalizeText(row[1]) === normalizeText(input.articleLink)
    && normalizeText(row[2]) === normalizeText(input.writerPenName)
    && normalizeText(row[3]) === normalizeText(input.reviewerPenName)
    && [5, 6, 7, 8, 9, 10, 11].every((index) => foldText(row[index]) === "true")
  );
}

async function verifyWrittenRow(input: ReviewRegistrationBrowserInput, rowNumber: number) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const snapshot = await fetchSheetSnapshot(input.profile);
    const row = snapshot[rowNumber - 1] || [];
    if (rowMatchesExpectation(row, input)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  return false;
}

export async function submitReviewRegistrationThroughBrowser(input: ReviewRegistrationBrowserInput): Promise<ReviewRegistrationBrowserResult> {
  const storageState = await readStorageStateFromConfig();
  if (!storageState) {
    return {
      success: false,
      message: "Chưa cấu hình phiên đăng nhập Google cho đăng ký bài duyệt.",
    };
  }

  const browser = await getAutomationBrowser();
  if (!browser) {
    return {
      success: false,
      message: "Runtime hiện tại chưa khởi tạo được browser automation cho đăng ký bài duyệt.",
    };
  }

  const initialSnapshot = await fetchSheetSnapshot(input.profile);
  const monthSection = findLatestMonthSection(initialSnapshot, input.articleDate);
  if (!monthSection) {
    return {
      success: false,
      message: `Không tìm thấy block tháng trong tab “${input.profile.sheetName}”.`,
    };
  }

  const targetRow = resolveWritableRow(initialSnapshot, monthSection, input.articleLink);
  if (targetRow.alreadyExists) {
    return {
      success: true,
      message: "Bài viết đã tồn tại trong sheet bài duyệt.",
      sheetName: input.profile.sheetName,
      rowNumber: targetRow.rowNumber,
      sheetMonth: monthSection.month,
      sheetYear: monthSection.year,
      sheetWrittenAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
  }

  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    context = await browser.newContext({
      locale: "vi-VN",
      storageState: storageState as BrowserContextStorageState,
      viewport: REVIEW_REGISTRATION_BROWSER_VIEWPORT,
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
      extraHTTPHeaders: {
        "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
      },
    });
    page = await context.newPage();
    await page.goto(buildSheetEditUrl(input.profile, targetRow.rowNumber), {
      waitUntil: "domcontentloaded",
      timeout: REVIEW_REGISTRATION_BROWSER_TIMEOUT_MS,
    });
    await waitForSheetReady(page);
    await assertGoogleEditorSession(page);

    await fillRowValues(page, [
      formatDateForSheet(input.articleDate),
      input.articleLink,
      input.writerPenName,
      input.reviewerPenName,
      input.managerLabel || null,
      "TRUE",
      "TRUE",
      "TRUE",
      "TRUE",
      "TRUE",
      "TRUE",
      "TRUE",
    ]);

    const verified = await verifyWrittenRow(input, targetRow.rowNumber);
    if (!verified) {
      throw new Error("Không xác minh được dữ liệu vừa ghi vào sheet bài duyệt.");
    }

    return {
      success: true,
      message: "Đã ghi bài duyệt vào sheet bằng phiên Google đã lưu.",
      sheetName: input.profile.sheetName,
      rowNumber: targetRow.rowNumber,
      sheetMonth: monthSection.month,
      sheetYear: monthSection.year,
      sheetWrittenAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? normalizeText(error.message) : "Không thao tác được Google Sheet bằng phiên đăng nhập đã lưu.",
    };
  } finally {
    await page?.close().catch(() => undefined);
    await context?.close().catch(() => undefined);
  }
}
