import { chromium } from "playwright";

const LINK_CHECK_URL = process.env.LINK_CHECK_URL;
const LINK_CHECK_AUTOMATION_TOKEN = process.env.LINK_CHECK_AUTOMATION_TOKEN;
const LINK_CHECK_SLOT_KEY = process.env.LINK_CHECK_SLOT_KEY;
const LINK_CHECK_LIMIT = Number(process.env.LINK_CHECK_LIMIT || 0);
const REQUEST_TIMEOUT_MS = 30_000;
const PAGE_TIMEOUT_MS = 15_000;
const CHALLENGE_PATTERNS = [
  "just a moment",
  "performing security verification",
  "checking your browser before accessing",
  "captcha",
];
const BODY_FALLBACK_TITLES = [
  "tin tuc cong nghe cap nhat 24/7 - fptshop.com.vn",
  "fptshop.com.vn",
];
const BROKEN_PATTERNS = [
  "404 - trang het han truy cap hoac khong ton tai",
  "duong dan da het han truy cap hoac khong ton tai",
  "trang het han truy cap hoac khong ton tai",
  "khong tim thay trang",
  "page not found",
  "404 page",
  "404 not found",
];

function assertEnv(name, value) {
  if (!value) {
    throw new Error(`${name} is required.`);
  }
}

function fold(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .toLowerCase();
}

function extractArticleIdFromLink(value) {
  const normalized = String(value || "").trim();
  const match = normalized.match(/-(\d{6})(?:[/?#]|$)/);
  return match ? match[1] : null;
}

function isRedirectedArticleIdMismatch(originalUrl, finalUrl) {
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

async function callLinkCheck(body) {
  const response = await fetch(LINK_CHECK_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LINK_CHECK_AUTOMATION_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.error || `Link check API failed with ${response.status}`);
  }

  return payload;
}

async function readSignals(page) {
  const [title, heading, bodyText] = await Promise.all([
    page.title().catch(() => ""),
    page.locator("main h1, article h1, h1").first().textContent().catch(() => ""),
    page.locator("body").innerText().catch(() => ""),
  ]);

  return {
    title: fold(title),
    heading: fold(heading),
    body: fold(bodyText),
  };
}

async function checkItem(context, item) {
  const page = await context.newPage();
  try {
    const response = await page.goto(item.url, {
      waitUntil: "domcontentloaded",
      timeout: PAGE_TIMEOUT_MS,
    });
    await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);

    const finalUrl = page.url() || response?.url() || item.url;
    if (isRedirectedArticleIdMismatch(item.url, finalUrl)) {
      return {
        articleId: item.articleId,
        url: item.url,
        finalUrl,
        status: "broken",
        reason: "browser:redirect-id-mismatch",
      };
    }

    const statusCode = response?.status() ?? 0;
    const signals = await readSignals(page);
    if (CHALLENGE_PATTERNS.some((pattern) => signals.body.includes(pattern))) {
      return {
        articleId: item.articleId,
        url: item.url,
        finalUrl,
        status: "unknown",
        reason: `browser:challenge:${statusCode || "no-response"}`,
      };
    }

    if (statusCode >= 400) {
      return {
        articleId: item.articleId,
        url: item.url,
        finalUrl,
        status: "broken",
        reason: `browser:${statusCode}`,
      };
    }

    const strongSignals = [signals.title, signals.heading].filter(Boolean).join("\n");
    const allowBodyBrokenFallback = !strongSignals
      || (!signals.heading && BODY_FALLBACK_TITLES.some((title) => signals.title === title));
    const brokenText = allowBodyBrokenFallback ? `${strongSignals}\n${signals.body}` : strongSignals;

    if (BROKEN_PATTERNS.some((pattern) => brokenText.includes(pattern))) {
      return {
        articleId: item.articleId,
        url: item.url,
        finalUrl,
        status: "broken",
        reason: "browser:soft404",
      };
    }

    return {
      articleId: item.articleId,
      url: item.url,
      finalUrl,
      status: "ok",
      reason: `browser:${statusCode || 200}`,
    };
  } catch (error) {
    return {
      articleId: item.articleId,
      url: item.url,
      finalUrl: item.url,
      status: "unknown",
      reason: `browser:error:${error instanceof Error ? error.name : "unknown"}`,
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function main() {
  assertEnv("LINK_CHECK_URL", LINK_CHECK_URL);
  assertEnv("LINK_CHECK_AUTOMATION_TOKEN", LINK_CHECK_AUTOMATION_TOKEN);

  const prepare = await callLinkCheck({
    trigger: "scheduled",
    phase: "prepare",
    slotKey: LINK_CHECK_SLOT_KEY || undefined,
    limit: Number.isFinite(LINK_CHECK_LIMIT) && LINK_CHECK_LIMIT > 0 ? LINK_CHECK_LIMIT : undefined,
  });

  if (prepare.skipped) {
    console.log(JSON.stringify({ skipped: true, reason: prepare.reason, slotKey: prepare.slotKey }));
    return;
  }

  const items = Array.isArray(prepare.items) ? prepare.items : [];
  if (items.length === 0) {
    console.log(JSON.stringify({ skipped: true, reason: "No due items.", slotKey: prepare.slotKey }));
    return;
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      locale: "vi-VN",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
      extraHTTPHeaders: {
        "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
      },
    });

    const checkedItems = [];
    for (const item of items) {
      checkedItems.push(await checkItem(context, item));
    }

    const persisted = await callLinkCheck({
      trigger: "scheduled",
      phase: "persist",
      slotKey: prepare.slotKey,
      checkedItems,
    });

    console.log(JSON.stringify({
      slotKey: prepare.slotKey,
      prepared: items.length,
      counts: persisted.counts,
    }));
  } finally {
    await browser.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
