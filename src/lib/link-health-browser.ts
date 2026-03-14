import { extractArticleIdFromLink } from "@/lib/article-link-id";
import type { Browser, Page } from "playwright-core";

type BrowserLinkCheckResult = {
  finalUrl: string;
  reason: string;
  status: "ok" | "broken" | "unknown";
};

type ServerlessChromium = {
  args: string[];
  executablePath(input?: string): Promise<string>;
  setGraphicsMode: boolean;
};

const BROWSER_FALLBACK_HOST_PATTERNS = [
  /(^|\.)fptshop\.com\.vn$/i,
] as const;
const BROWSER_TIMEOUT_MS = 15_000;
const BROWSER_BROKEN_PATTERNS = [
  "404 - trang het han truy cap hoac khong ton tai",
  "duong dan da het han truy cap hoac khong ton tai",
  "trang het han truy cap hoac khong ton tai",
  "khong tim thay trang",
  "page not found",
  "404 page",
  "404 not found",
] as const;
const BROWSER_CHALLENGE_PATTERNS = [
  "just a moment",
  "performing security verification",
  "checking your browser before accessing",
  "captcha",
] as const;

let browserPromise: Promise<Browser | null> | null = null;

function foldForPattern(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isRedirectedArticleIdMismatch(originalUrl: string, finalUrl: string) {
  try {
    const originalHost = new URL(originalUrl).hostname;
    const finalHost = new URL(finalUrl).hostname;
    const originalId = extractArticleIdFromLink(originalUrl);
    if (!originalId || originalHost !== finalHost) {
      return false;
    }

    const finalId = extractArticleIdFromLink(finalUrl);
    return !finalId || finalId !== originalId;
  } catch {
    return false;
  }
}

function shouldUseBrowserFallback(url: string) {
  try {
    const { hostname } = new URL(url);
    return BROWSER_FALLBACK_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
  } catch {
    return false;
  }
}

async function getFallbackBrowser() {
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

async function readPageSignals(page: Page) {
  const [title, heading, bodyText] = await Promise.all([
    page.title().catch(() => ""),
    page.locator("main h1, article h1, h1").first().textContent().catch(() => ""),
    page.locator("body").innerText().catch(() => ""),
  ]);

  return foldForPattern([title, heading, bodyText].filter(Boolean).join("\n"));
}

export async function checkLinkStatusWithBrowser(url: string): Promise<BrowserLinkCheckResult | null> {
  if (!shouldUseBrowserFallback(url)) {
    return null;
  }

  const browser = await getFallbackBrowser();
  if (!browser) {
    return { finalUrl: url, status: "unknown", reason: "browser:unavailable" };
  }

  let page: Page | null = null;
  try {
    page = await browser.newPage({
      locale: "vi-VN",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
      extraHTTPHeaders: {
        "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
      },
    });
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: BROWSER_TIMEOUT_MS,
    });
    await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);

    const finalUrl = page.url() || response?.url() || url;
    if (isRedirectedArticleIdMismatch(url, finalUrl)) {
      return { finalUrl, status: "broken", reason: "browser:redirect-id-mismatch" };
    }

    const responseStatus = response?.status() ?? 0;
    const foldedSignals = await readPageSignals(page);
    if (BROWSER_CHALLENGE_PATTERNS.some((pattern) => foldedSignals.includes(pattern))) {
      return {
        finalUrl,
        status: "unknown",
        reason: `browser:challenge:${responseStatus || "no-response"}`,
      };
    }

    if (responseStatus >= 400) {
      return { finalUrl, status: "broken", reason: `browser:${responseStatus}` };
    }

    if (BROWSER_BROKEN_PATTERNS.some((pattern) => foldedSignals.includes(pattern))) {
      return { finalUrl, status: "broken", reason: "browser:soft404" };
    }

    return { finalUrl, status: "ok", reason: `browser:${responseStatus || 200}` };
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "unknown";
    return { finalUrl: url, status: "unknown", reason: `browser:error:${errorName}` };
  } finally {
    await page?.close().catch(() => undefined);
  }
}
