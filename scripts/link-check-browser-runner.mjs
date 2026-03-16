import { chromium } from "playwright";

const LINK_CHECK_URL = process.env.LINK_CHECK_URL;
const LINK_CHECK_AUTOMATION_TOKEN = process.env.LINK_CHECK_AUTOMATION_TOKEN;
const LINK_CHECK_SLOT_KEY = process.env.LINK_CHECK_SLOT_KEY;
const LINK_CHECK_LIMIT = Number(process.env.LINK_CHECK_LIMIT || 0);
const REQUEST_TIMEOUT_MS = 30_000;
const PAGE_TIMEOUT_MS = 15_000;
const FETCH_TIMEOUT_MS = 10_000;
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
const GENERIC_SOFT_404_PATTERNS = [
  ["page not found"],
  ["404 page"],
  ["404 not found"],
  ["trang khong ton tai"],
  ["khong tim thay trang"],
  ["trang nay khong ton tai"],
  ["duong dan khong ton tai"],
  ["not found", "go to homepage"],
];
const HOST_SOFT_404_PATTERNS = [
  {
    hostnamePattern: /(^|\.)fptshop\.com\.vn$/i,
    patterns: [
      ["duong dan da het han truy cap hoac khong ton tai"],
      ["trang het han truy cap hoac khong ton tai"],
    ],
    bodyFallbackTitles: BODY_FALLBACK_TITLES,
  },
];
const CANARY_OK_URL = "https://fptshop.com.vn/tin-tuc/for-gamers/di-bien-can-chuan-bi-gi-203076";
const CANARY_BROKEN_URL = "https://fptshop.com.vn/tin-tuc/for-gamers/di-bien-can-chuan-bi-gi-203074";

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

function isBotBlockedStatus(status) {
  return status === 403 || status === 429;
}

function extractTagText(html, tagName) {
  const match = html.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, "i"));
  return match?.[1] || "";
}

function foldExtractedText(value) {
  return fold(
    String(value || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&#160;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function detectSoft404Reason(hostname, html) {
  const foldedHtml = fold(html);
  if (!foldedHtml) return null;

  const titleSignal = foldExtractedText(extractTagText(html, "title"));
  const headingSignal = foldExtractedText(extractTagText(html, "h1"));
  const strongSignals = [titleSignal, headingSignal].filter(Boolean).join("\n");

  const genericPattern = GENERIC_SOFT_404_PATTERNS.find((pattern) => pattern.every((token) => strongSignals.includes(token)));
  if (genericPattern) {
    return `soft404:generic:${genericPattern.join("+")}`;
  }

  const hostPatterns = HOST_SOFT_404_PATTERNS.find((entry) => entry.hostnamePattern.test(hostname));
  const hostPattern = hostPatterns?.patterns.find((pattern) => pattern.every((token) => strongSignals.includes(token)));
  if (hostPattern) {
    return `soft404:host:${hostPattern.join("+")}`;
  }

  const allowBodyFallback = !strongSignals || Boolean(
    hostPatterns
    && !headingSignal
    && hostPatterns.bodyFallbackTitles.some((title) => titleSignal === title),
  );

  if (!allowBodyFallback) {
    return null;
  }

  const bodyGenericPattern = GENERIC_SOFT_404_PATTERNS.find((pattern) => pattern.every((token) => foldedHtml.includes(token)));
  if (bodyGenericPattern) {
    return `soft404:generic-body:${bodyGenericPattern.join("+")}`;
  }

  const bodyHostPattern = hostPatterns?.patterns.find((pattern) => pattern.every((token) => foldedHtml.includes(token)));
  return bodyHostPattern ? `soft404:host-body:${bodyHostPattern.join("+")}` : null;
}

async function fetchWithTimeout(url, init) {
  return fetch(url, {
    ...init,
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
      "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
      ...(init?.headers || {}),
    },
  });
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

async function checkItemWithFetch(item) {
  try {
    const headResponse = await fetchWithTimeout(item.url, { method: "HEAD" }).catch(() => null);
    const headFinalUrl = headResponse?.url || item.url;
    const headLooksHealthy = Boolean(headResponse?.ok && !isRedirectedArticleIdMismatch(item.url, headFinalUrl));
    const headLooksBotBlocked = Boolean(headResponse && isBotBlockedStatus(headResponse.status));

    if (headResponse && headResponse.status >= 400 && headResponse.status !== 403 && headResponse.status !== 405) {
      return {
        articleId: item.articleId,
        url: item.url,
        finalUrl: headFinalUrl,
        status: "broken",
        reason: `head:${headResponse.status}`,
      };
    }

    if (isRedirectedArticleIdMismatch(item.url, headFinalUrl)) {
      return {
        articleId: item.articleId,
        url: item.url,
        finalUrl: headFinalUrl,
        status: "broken",
        reason: "redirect-id-mismatch:head",
      };
    }

    const headContentType = headResponse?.headers.get("content-type") || "";
    if (headResponse?.ok && headContentType && !/text\/html|application\/xhtml\+xml/i.test(headContentType)) {
      return {
        articleId: item.articleId,
        url: item.url,
        finalUrl: headFinalUrl,
        status: "ok",
        reason: "head:ok-non-html",
      };
    }

    const getResponse = await fetchWithTimeout(item.url, { method: "GET" });
    const finalUrl = getResponse.url || headFinalUrl || item.url;
    if (!getResponse.ok && isBotBlockedStatus(getResponse.status) && (headLooksHealthy || headLooksBotBlocked)) {
      return {
        articleId: item.articleId,
        url: item.url,
        finalUrl,
        status: "unknown",
        reason: `bot-blocked:head-${headResponse?.status ?? "none"}:get-${getResponse.status}`,
      };
    }

    if (!getResponse.ok || isRedirectedArticleIdMismatch(item.url, finalUrl)) {
      return {
        articleId: item.articleId,
        url: item.url,
        finalUrl,
        status: "broken",
        reason: !getResponse.ok ? `get:${getResponse.status}` : "redirect-id-mismatch:get",
      };
    }

    const contentType = getResponse.headers.get("content-type") || "";
    if (/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      const html = await getResponse.text();
      const hostname = (() => {
        try {
          return new URL(finalUrl).hostname;
        } catch {
          return "";
        }
      })();
      const soft404Reason = detectSoft404Reason(hostname, html);
      if (soft404Reason) {
        return {
          articleId: item.articleId,
          url: item.url,
          finalUrl,
          status: "broken",
          reason: soft404Reason,
        };
      }
    }

    return {
      articleId: item.articleId,
      url: item.url,
      finalUrl,
      status: "ok",
      reason: "ok",
    };
  } catch (error) {
    return {
      articleId: item.articleId,
      url: item.url,
      finalUrl: item.url,
      status: "unknown",
      reason: `fetch:error:${error instanceof Error ? error.name : "unknown"}`,
    };
  }
}

async function checkItemWithBrowser(context, item) {
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

async function checkItem(context, item) {
  const fetched = await checkItemWithFetch(item);
  if (fetched.status !== "unknown") {
    return fetched;
  }

  const browserChecked = await checkItemWithBrowser(context, item);
  if (browserChecked.status === "unknown") {
    return fetched;
  }

  return browserChecked;
}

async function verifyRunnerEnvironment(context) {
  const okCanary = await checkItem(context, { articleId: -1, url: CANARY_OK_URL });
  const brokenCanary = await checkItem(context, { articleId: -2, url: CANARY_BROKEN_URL });
  return {
    healthy: okCanary.status === "ok" && brokenCanary.status === "broken",
    okCanary,
    brokenCanary,
  };
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

    const canary = await verifyRunnerEnvironment(context);
    if (!canary.healthy) {
      console.log(JSON.stringify({
        skipped: true,
        reason: "runner-canary-failed",
        slotKey: prepare.slotKey,
        canary,
      }));
      return;
    }

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
