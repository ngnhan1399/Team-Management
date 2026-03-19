import { resolveArticleCategory } from "@/lib/article-category";
import type {
  TrendRadarCoverageSample,
  TrendRadarIntent,
  TrendRadarItem,
  TrendRadarRecommendation,
  TrendRadarResponse,
  TrendRadarSourceRef,
  TrendRadarSummary,
} from "@/app/components/types";

type CoverageArticle = {
  id: number;
  title: string;
  date: string;
  status: string;
  articleId: string | null;
  link: string | null;
  category: string | null;
  articleType: string | null;
};

type RawTrendSignal = {
  keyword: string;
  headline: string;
  sourceLabel: string;
  sourceType: TrendRadarSourceRef["type"];
  url: string;
  publishedAt: string | null;
  approxTraffic: number | null;
  searchDemandLabel: string | null;
};

type FeedConfig = {
  label: string;
  type: TrendRadarSourceRef["type"];
  url: string;
  relevance: "tech" | "social";
  maxItems?: number;
};

const TREND_RADAR_CACHE_TTL_MS = 20 * 60 * 1000;

const GOOGLE_TRENDS_FEED_URL = "https://trends.google.com/trending/rss?geo=VN";
const GOOGLE_NEWS_SOCIAL_BUZZ_FEED_URL = "https://news.google.com/rss/search?q=(viral%20OR%20trend%20OR%20%22m%E1%BA%A1ng%20x%C3%A3%20h%E1%BB%99i%22%20OR%20Threads%20OR%20Facebook%20OR%20%22g%C3%A2y%20s%E1%BB%91t%22)%20when:1d&hl=vi&gl=VN&ceid=VN:vi";
const FEED_SOURCES: FeedConfig[] = [
  { label: "Google News Social Buzz VN", type: "social_reference", url: GOOGLE_NEWS_SOCIAL_BUZZ_FEED_URL, relevance: "social", maxItems: 24 },
  { label: "Kenh14", type: "social_reference", url: "https://kenh14.vn/rss/home.rss", relevance: "social", maxItems: 18 },
  { label: "Thanh Niên Giới trẻ", type: "social_reference", url: "https://thanhnien.vn/rss/gioi-tre.rss", relevance: "social", maxItems: 18 },
  { label: "GenK", type: "tech_news", url: "https://genk.vn/rss/home.rss", relevance: "tech", maxItems: 18 },
  { label: "Thanh Niên Công nghệ", type: "tech_news", url: "https://thanhnien.vn/rss/cong-nghe.rss", relevance: "tech", maxItems: 18 },
  { label: "The Verge", type: "tech_news", url: "https://www.theverge.com/rss/index.xml", relevance: "tech", maxItems: 16 },
  { label: "TechCrunch Gadgets", type: "tech_news", url: "https://techcrunch.com/category/gadgets/feed/", relevance: "tech", maxItems: 16 },
  { label: "Android Authority", type: "tech_news", url: "https://www.androidauthority.com/feed/", relevance: "tech", maxItems: 16 },
  { label: "MacRumors", type: "tech_news", url: "https://www.macrumors.com/macrumors.xml", relevance: "tech", maxItems: 16 },
];

const TECHNOLOGY_TERMS = [
  "ai", "grok", "gemini", "chatgpt", "claude", "copilot",
  "iphone", "ipad", "macbook", "mac", "airpods", "apple watch", "ios", "macos",
  "samsung", "galaxy", "xiaomi", "redmi", "oppo", "vivo", "realme", "honor", "huawei", "oneplus", "pixel",
  "asus", "acer", "lenovo", "dell", "hp", "intel", "amd", "nvidia", "rtx", "geforce",
  "android", "windows", "wifi", "bluetooth", "usb", "type-c", "ssd", "ram", "chip", "cpu", "gpu",
  "smartphone", "dien thoai", "laptop", "tablet", "tai nghe", "loa", "camera", "may anh", "monitor",
  "router", "modem", "smart tv", "tivi", "google tv",
  "robot hut bui", "may loc khong khi", "may giat", "tu lanh", "bep tu", "noi com", "may lanh",
];

const SOCIAL_BUZZ_TERMS = [
  "threads", "facebook", "tiktok", "mang xa hoi", "mxh", "viral", "trend", "hot trend", "gay sot",
  "xon xao", "day song", "cau noi", "quoted", "meme", "drama", "top top", "reels", "story",
  "neu ca doi nay khong ruc ro thi sao", "hay khong", "thi sao", "co dang", "dang hot",
];

const SPORTS_TERMS = [
  "bong da", "dau voi", "vs", "truc tiep", "ty so", "tran dau", "thi dau", "vong loai",
  "doi tuyen", "champions league", "premier league", "europa league", "ucl", "cup quoc gia",
  "world cup", "tottenham", "liverpool", "bayern", "atalanta", "atletico", "southampton",
  "norwich", "galatasaray", "barca", "fermin lopez", "marc bernal", "uzbekistan", "nam dinh",
];

const LIFESTYLE_TERMS = [
  "van khan", "mung 1", "xo so", "mien nam", "gia bac", "gia vang", "phu quy", "doi song",
  "meo vat", "kinh nghiem", "cach nau", "mua gi", "di bien", "ngay tot", "gio dep",
];

const ENTERTAINMENT_TERMS = [
  "phim", "tap", "ca si", "nhac si", "dien vien", "gameshow", "showbiz", "giai tri",
  "shark", "idol", "concert", "mv", "rap viet", "anh trai", "anh dep", "nemoclaw",
];

const CATEGORY_HINTS: Array<{ category: TrendRadarItem["recommendedCategory"]; terms: string[] }> = [
  { category: "SEO AI", terms: ["ai", "grok", "gemini", "chatgpt", "claude", "copilot", "llm"] },
  { category: "Gia dụng", terms: ["may giat", "tu lanh", "may lanh", "noi com", "bep tu", "loc khong khi", "robot hut bui", "may loc nuoc", "dieu hoa", "quat"] },
  { category: "Đánh giá", terms: ["review", "danh gia", "co tot khong", "nen mua", "so sanh", "vs", "tren tay"] },
  { category: "Thủ thuật", terms: ["cach", "huong dan", "fix", "sua", "loi", "khac phuc", "meo", "how to"] },
  { category: "Thể thao", terms: SPORTS_TERMS },
  { category: "Đời sống", terms: LIFESTYLE_TERMS },
  { category: "Giải trí", terms: ENTERTAINMENT_TERMS },
  { category: "ICT", terms: ["iphone", "ipad", "macbook", "samsung", "galaxy", "xiaomi", "android", "windows", "laptop", "dien thoai", "tablet", "router", "wifi", "camera"] },
];

const INTENT_HINTS: Array<{ intent: TrendRadarIntent; terms: string[] }> = [
  { intent: "comparison", terms: ["so sanh", "vs", "versus"] },
  { intent: "commercial", terms: ["review", "danh gia", "nen mua", "gia", "top", "best"] },
  { intent: "problem_solving", terms: ["cach", "huong dan", "fix", "sua", "loi", "khac phuc", "meo", "how to"] },
  { intent: "product_lookup", terms: ["ra mat", "launch", "announces", "spec", "thong so", "tin don", "leak"] },
];

function foldText(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;/g, "/")
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, "-")
    .replace(/&#8220;|&#8221;/g, "\"")
    .replace(/&#(\d+);/g, (_, numeric) => {
      const codePoint = Number.parseInt(numeric, 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : "";
    });
}

function stripTags(value: string) {
  return decodeHtmlEntities(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTag(block: string, tag: string) {
  const pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  return stripTags((block.match(pattern)?.[1] || "").trim());
}

function extractAllTags(block: string, tag: string) {
  const matches = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi")) || [];
  return matches
    .map((entry) => stripTags(entry.replace(new RegExp(`^<${tag}[^>]*>|</${tag}>$`, "gi"), "")))
    .filter(Boolean);
}

function extractAtomLink(block: string) {
  const hrefMatch = block.match(/<link[^>]+href="([^"]+)"[^>]*\/?>/i);
  return decodeHtmlEntities(hrefMatch?.[1] || "");
}

function parseApproxTraffic(label: string | null) {
  if (!label) return null;
  const numeric = Number.parseInt(label.replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(numeric)) return null;
  if (label.includes("M")) return numeric * 1_000_000;
  if (label.includes("K")) return numeric * 1_000;
  return numeric;
}

function extractQuotedKeyword(title: string) {
  const matches = Array.from(title.matchAll(/[“"'‘’]([^“"'‘’]{12,120})[”"'‘’]/g));
  for (const match of matches) {
    const candidate = decodeHtmlEntities(String(match[1] || "")).replace(/\s+/g, " ").trim();
    const tokenCount = tokenize(candidate).length;
    if (tokenCount >= 4 && tokenCount <= 18) {
      return candidate;
    }
  }
  return "";
}

function extractKeywordFromHeadline(title: string, relevance: FeedConfig["relevance"] = "tech") {
  const quoted = extractQuotedKeyword(title);
  if (quoted) {
    return quoted;
  }

  if (relevance === "social") {
    const colonParts = title.split(/\s*:\s*/).map((part) => part.trim()).filter(Boolean);
    const tailCandidate = colonParts.length > 1 ? colonParts[colonParts.length - 1] : "";
    const tailTokenCount = tokenize(tailCandidate).length;
    if (tailCandidate && tailTokenCount >= 4 && tailTokenCount <= 18) {
      return tailCandidate;
    }
  }

  const cleaned = title
    .replace(/\s*[-|:]\s*.*$/, "")
    .replace(/\b(Review|Hands-on|Opinion|How to|Explained)\b.*$/i, "")
    .trim();
  return cleaned || title;
}

function isTechnologyRelevant(text: string) {
  const folded = foldText(text);
  return TECHNOLOGY_TERMS.some((term) => folded.includes(foldText(term)));
}

function isSocialBuzzRelevant(text: string) {
  const folded = foldText(text);
  if (SOCIAL_BUZZ_TERMS.some((term) => folded.includes(foldText(term)))) {
    return true;
  }

  const quoted = extractQuotedKeyword(text);
  if (quoted) {
    return true;
  }

  const normalizedText = String(text || "").trim();
  if (/[?？]/.test(normalizedText)) {
    const tokenCount = tokenize(normalizedText).length;
    if (tokenCount >= 5 && tokenCount <= 18) {
      return true;
    }
  }

  return false;
}

function isSportsRelevant(text: string) {
  const folded = foldText(text);
  return SPORTS_TERMS.some((term) => folded.includes(foldText(term)));
}

function isLifestyleRelevant(text: string) {
  const folded = foldText(text);
  return LIFESTYLE_TERMS.some((term) => folded.includes(foldText(term)));
}

function isEntertainmentRelevant(text: string) {
  const folded = foldText(text);
  return ENTERTAINMENT_TERMS.some((term) => folded.includes(foldText(term)));
}

function isBroadTrendRelevant(text: string) {
  return [
    isTechnologyRelevant(text),
    isSocialBuzzRelevant(text),
    isSportsRelevant(text),
    isLifestyleRelevant(text),
    isEntertainmentRelevant(text),
  ].some(Boolean);
}

function isTrendRelevant(text: string, relevance: FeedConfig["relevance"]) {
  if (relevance === "tech") {
    return isTechnologyRelevant(text);
  }
  return isBroadTrendRelevant(text);
}

function detectCategory(text: string): TrendRadarItem["recommendedCategory"] {
  const folded = foldText(text);
  for (const entry of CATEGORY_HINTS) {
    if (entry.terms.some((term) => folded.includes(foldText(term)))) {
      return entry.category;
    }
  }
  if (isSportsRelevant(text)) {
    return "Thể thao";
  }
  if (isLifestyleRelevant(text)) {
    return "Đời sống";
  }
  if (isEntertainmentRelevant(text) || (isSocialBuzzRelevant(text) && !isTechnologyRelevant(text))) {
    return "Giải trí";
  }
  return resolveArticleCategory("", text);
}

function detectIntent(text: string): TrendRadarIntent {
  const folded = foldText(text);
  for (const entry of INTENT_HINTS) {
    if (entry.terms.some((term) => folded.includes(foldText(term)))) {
      return entry.intent;
    }
  }
  if (folded.includes("gi") || folded.includes("la")) {
    return "awareness";
  }
  return "news";
}

function computeFreshnessHours(publishedAt: string | null) {
  if (!publishedAt) return 72;
  const publishedTime = new Date(publishedAt).getTime();
  if (!Number.isFinite(publishedTime)) return 72;
  return Math.max(0, (Date.now() - publishedTime) / (1000 * 60 * 60));
}

function describeFreshness(hours: number) {
  if (hours <= 6) return "Vừa nổi trong 6 giờ gần đây";
  if (hours <= 24) return "Nổi trong 24 giờ qua";
  if (hours <= 72) return "Đang nóng trong 3 ngày gần đây";
  return "Đang được nhắc tới trong tuần này";
}

function getTrafficScore(approxTraffic: number | null) {
  if (!approxTraffic) return 0;
  if (approxTraffic >= 1_000_000) return 28;
  if (approxTraffic >= 100_000) return 22;
  if (approxTraffic >= 10_000) return 16;
  if (approxTraffic >= 1_000) return 10;
  return 4;
}

function getFreshnessScore(hours: number) {
  if (hours <= 6) return 18;
  if (hours <= 24) return 12;
  if (hours <= 72) return 7;
  return 3;
}

function tokenize(value: string) {
  return Array.from(new Set(
    foldText(value)
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 2)
  ));
}

function similarityScore(left: string, right: string) {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;
  const rightSet = new Set(rightTokens);
  const overlap = leftTokens.filter((token) => rightSet.has(token)).length;
  return overlap / Math.max(leftTokens.length, rightTokens.length);
}

async function fetchText(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 Workdocker Trend Radar" },
      signal: controller.signal,
      next: { revalidate: TREND_RADAR_CACHE_TTL_MS / 1000 },
    });
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchGoogleTrendSignals() {
  const xml = await fetchText(GOOGLE_TRENDS_FEED_URL);
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
  const signals: RawTrendSignal[] = [];

  for (const block of items) {
    const keyword = extractTag(block, "title");
    const approxTrafficLabel = extractTag(block, "ht:approx_traffic");
    const newsTitles = extractAllTags(block, "ht:news_item_title");
    const newsUrls = extractAllTags(block, "ht:news_item_url");
    const headline = newsTitles[0] || keyword;
    const combinedSignal = [keyword, ...newsTitles].join(" ");
    if (!isBroadTrendRelevant(combinedSignal)) {
      continue;
    }

    signals.push({
      keyword,
      headline,
      sourceLabel: "Google Trends VN",
      sourceType: "google_trends",
      url: newsUrls[0] || `https://trends.google.com/trends/explore?q=${encodeURIComponent(keyword)}&geo=VN`,
      publishedAt: extractTag(block, "pubDate") || null,
      approxTraffic: parseApproxTraffic(approxTrafficLabel),
      searchDemandLabel: approxTrafficLabel || null,
    });
  }

  return signals;
}

async function fetchFeedSignals(config: FeedConfig) {
  const xml = await fetchText(config.url);
  const rssItems = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
  const atomItems = rssItems.length > 0 ? [] : (xml.match(/<entry>[\s\S]*?<\/entry>/gi) || []);
  const blocks = rssItems.length > 0 ? rssItems : atomItems;
  const signals: RawTrendSignal[] = [];

  for (const block of blocks) {
    const title = extractTag(block, "title");
    const headline = title;
    if (!title || !isTrendRelevant(title, config.relevance)) {
      continue;
    }

    const link = rssItems.length > 0 ? extractTag(block, "link") : extractAtomLink(block);
    signals.push({
      keyword: extractKeywordFromHeadline(title, config.relevance),
      headline,
      sourceLabel: config.label,
      sourceType: config.type,
      url: link || config.url,
      publishedAt: extractTag(block, rssItems.length > 0 ? "pubDate" : "published") || extractTag(block, "updated") || null,
      approxTraffic: null,
      searchDemandLabel: null,
    });
  }

  return signals.slice(0, config.maxItems || 18);
}

function buildCoverage(keyword: string, headline: string, articles: CoverageArticle[]) {
  const sorted = articles
    .map((article) => ({
      ...article,
      similarity: Math.max(similarityScore(keyword, article.title), similarityScore(headline, article.title)),
    }))
    .filter((article) => article.similarity >= 0.3)
    .sort((left, right) => right.similarity - left.similarity || String(right.date).localeCompare(String(left.date)));

  const samples: TrendRadarCoverageSample[] = sorted.slice(0, 3).map((article) => ({
    articleId: article.id,
    title: article.title,
    date: article.date,
    status: article.status,
    link: article.link,
  }));

  return {
    count: sorted.length,
    topSimilarity: sorted[0]?.similarity || 0,
    samples,
  };
}

function buildRecommendation(coverageCount: number, topSimilarity: number, score: number): TrendRadarRecommendation {
  if (coverageCount > 0 && topSimilarity >= 0.58) {
    return "refresh_existing";
  }
  if (score < 46) {
    return "watch";
  }
  return "write_new";
}

function getRecommendationLabel(value: TrendRadarRecommendation) {
  switch (value) {
    case "refresh_existing":
      return "Nên cập nhật bài cũ";
    case "watch":
      return "Nên theo dõi thêm";
    default:
      return "Nên viết mới";
  }
}

function getSuggestedFormatLabel(intent: TrendRadarIntent, category: TrendRadarItem["recommendedCategory"]) {
  if (category === "Thể thao") {
    return intent === "comparison" ? "Nhận định / đối đầu / lịch thi đấu" : "Tin nhanh / diễn biến thể thao";
  }
  if (category === "Đời sống") {
    return intent === "problem_solving" ? "How-to / mẹo đời sống" : "Explainer / tổng hợp nhanh";
  }
  if (category === "Giải trí" && intent === "news") {
    return "Tin nhanh / giải thích trend";
  }
  if (intent === "comparison") {
    return "Bài so sánh / chọn mua";
  }
  if (intent === "commercial") {
    return category === "Đánh giá" ? "Review / đánh giá chi tiết" : "Top list / review thương mại";
  }
  if (intent === "problem_solving") {
    return "How-to / xử lý lỗi / thủ thuật";
  }
  if (intent === "product_lookup") {
    return "Tin ra mắt / thông số / giải thích sản phẩm";
  }
  if (intent === "awareness") {
    return "Giải thích khái niệm / evergreen";
  }
  return "Tin nhanh / topical explainer";
}

function getSuggestedWorkflowLabel(recommendation: TrendRadarRecommendation, coverageCount: number) {
  if (recommendation === "refresh_existing") {
    return coverageCount > 1 ? "Ưu tiên cập nhật bài gần nhất rồi gom cannibalization" : "Mở bài cũ gần nhất để cập nhật";
  }
  if (recommendation === "watch") {
    return "Cho vào watchlist, theo dõi thêm 6-24 giờ";
  }
  return "Tạo bài mới và giao writer phù hợp ngay";
}

function buildPriority(score: number): TrendRadarItem["priority"] {
  if (score >= 72) return "urgent";
  if (score >= 50) return "high";
  return "watch";
}

function getFitLevel(category: TrendRadarItem["recommendedCategory"]): TrendRadarItem["fitLevel"] {
  switch (category) {
    case "ICT":
    case "Gia dụng":
    case "Thủ thuật":
    case "Đánh giá":
    case "SEO AI":
      return "core";
    case "Giải trí":
      return "adjacent";
    default:
      return "broad";
  }
}

function getFitLabel(fitLevel: TrendRadarItem["fitLevel"]) {
  switch (fitLevel) {
    case "core":
      return "Fit cao với Workdocker";
    case "adjacent":
      return "Fit mở rộng";
    default:
      return "Trend rộng, cần chọn góc";
  }
}

function getFitReason(category: TrendRadarItem["recommendedCategory"], fitLevel: TrendRadarItem["fitLevel"]) {
  if (fitLevel === "core") {
    return `Nằm sát trục nội dung chính của team ở nhóm ${category}, phù hợp để ra bài và giao việc ngay.`;
  }
  if (fitLevel === "adjacent") {
    return `Thuộc lớp ${category} đang nóng trên social; nên ưu tiên khi có góc bám sản phẩm, công nghệ hoặc nhu cầu tìm hiểu rõ ràng.`;
  }
  if (category === "Đời sống") {
    return "Trend đời sống hút tìm kiếm nhanh, nhưng nên chọn góc how-to, giải thích hoặc ngách gần sản phẩm trước khi giao bài.";
  }
  if (category === "Thể thao") {
    return "Trend thể thao tạo spike tốt, nhưng không phải trục lõi của hệ thống; chỉ nên làm khi bạn muốn mở rộng traffic theo thời điểm.";
  }
  return `Keyword đang nóng ở nhóm ${category}, nhưng cần cân nhắc thêm độ hợp với chiến lược nội dung hiện tại.`;
}

function describeTrendWindow(hasGoogleTrendsSignal: boolean, hasSocialSignal: boolean) {
  if (hasGoogleTrendsSignal && hasSocialSignal) {
    return "Google Trends + social buzz 24 giờ";
  }
  if (hasGoogleTrendsSignal) {
    return "Google Trends 24 giờ";
  }
  if (hasSocialSignal) {
    return "Social buzz 24 giờ";
  }
  return "Tech/news pulse";
}

function buildWhyNow(signal: RawTrendSignal, category: TrendRadarItem["recommendedCategory"], recommendationLabel: string, coverageCount: number) {
  const fragments = [
    signal.sourceType === "google_trends"
      ? `đang tăng trên Google Trends VN${signal.searchDemandLabel ? ` (${signal.searchDemandLabel})` : ""}`
      : signal.sourceType === "tech_news"
        ? "đang được các nguồn công nghệ lớn nhắc tới"
        : "đang được các nguồn social / đời sống nhắc tới",
    `phù hợp nhóm ${category}`,
    coverageCount > 0 ? "đã có tín hiệu nội dung liên quan trong hệ thống" : "chưa có bài phủ rõ trong hệ thống",
  ];
  return `${signal.keyword} ${fragments.join(", ")}. ${recommendationLabel}.`;
}

function buildSummary(items: TrendRadarItem[]): TrendRadarSummary {
  const categories = new Map<TrendRadarItem["recommendedCategory"], number>();
  for (const item of items) {
    categories.set(item.recommendedCategory, (categories.get(item.recommendedCategory) || 0) + 1);
  }

  return {
    total: items.length,
    urgent: items.filter((item) => item.priority === "urgent").length,
    writeNew: items.filter((item) => item.recommendation === "write_new").length,
    refreshExisting: items.filter((item) => item.recommendation === "refresh_existing").length,
    watch: items.filter((item) => item.recommendation === "watch").length,
    averageScore: items.length > 0 ? Math.round(items.reduce((sum, item) => sum + item.score, 0) / items.length) : 0,
    categories: Array.from(categories.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((left, right) => right.count - left.count),
  };
}

export async function buildTrendRadarResponse(accessibleArticles: CoverageArticle[]): Promise<TrendRadarResponse> {
  const signalJobs: Array<Promise<RawTrendSignal[]>> = [
    fetchGoogleTrendSignals(),
    ...FEED_SOURCES.map((source) => fetchFeedSignals(source)),
  ];
  const settled = await Promise.allSettled(signalJobs);

  const rawSignals = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const grouped = new Map<string, RawTrendSignal[]>();

  for (const signal of rawSignals) {
    const key = foldText(signal.keyword);
    if (!key) continue;
    const bucket = grouped.get(key) || [];
    bucket.push(signal);
    grouped.set(key, bucket);
  }

  const items: TrendRadarItem[] = Array.from(grouped.entries()).map(([key, groupedSignals]) => {
    const signals = [...groupedSignals].sort((left, right) => {
      const byTraffic = (right.approxTraffic || 0) - (left.approxTraffic || 0);
      if (byTraffic !== 0) return byTraffic;
      return computeFreshnessHours(left.publishedAt) - computeFreshnessHours(right.publishedAt);
    });
    const leadSignal = signals[0];
    const freshestHours = Math.min(...signals.map((signal) => computeFreshnessHours(signal.publishedAt)));
    const category = detectCategory(`${leadSignal.keyword} ${leadSignal.headline}`);
    const intent = detectIntent(`${leadSignal.keyword} ${leadSignal.headline}`);
    const coverage = buildCoverage(leadSignal.keyword, leadSignal.headline, accessibleArticles);
    const distinctSourceCount = new Set(signals.map((signal) => signal.sourceLabel)).size;
    const multiSourceBoost = Math.max(0, distinctSourceCount - 1) * 8;
    const hasGoogleTrendsSignal = signals.some((signal) => signal.sourceType === "google_trends");
    const hasSocialSignal = signals.some((signal) => signal.sourceType === "social_reference");
    const sourceBaseScore = hasGoogleTrendsSignal ? 42 : hasSocialSignal ? 34 : 28;
    const intentBoost = intent === "commercial" || intent === "comparison" || intent === "product_lookup" ? 8 : 4;
    const coverageBoost = coverage.count === 0 ? 8 : coverage.topSimilarity >= 0.58 ? 6 : 3;
    const socialBuzzBoost = hasSocialSignal ? 8 : 0;
    const score = Math.min(
      100,
      Math.round(
        sourceBaseScore
        + getTrafficScore(leadSignal.approxTraffic)
        + getFreshnessScore(freshestHours)
        + multiSourceBoost
        + intentBoost
        + coverageBoost
        + socialBuzzBoost
      )
    );
    const recommendation = buildRecommendation(coverage.count, coverage.topSimilarity, score);
    const recommendationLabel = getRecommendationLabel(recommendation);
    const suggestedFormatLabel = getSuggestedFormatLabel(intent, category);
    const suggestedWorkflowLabel = getSuggestedWorkflowLabel(recommendation, coverage.count);
    const fitLevel = getFitLevel(category);
    const fitLabel = getFitLabel(fitLevel);
    const fitReason = getFitReason(category, fitLevel);
    const supportSignals = [
      ...new Set([
        leadSignal.searchDemandLabel ? `Search demand ${leadSignal.searchDemandLabel}` : "",
        `${distinctSourceCount} nguồn tín hiệu`,
        `Intent ${intent.replace(/_/g, " ")}`,
        hasSocialSignal ? "Có tín hiệu social buzz" : "",
        coverage.count > 0 ? `${coverage.count} bài liên quan trong hệ thống` : "Chưa có bài tương tự rõ ràng",
      ].filter(Boolean)),
    ];

    return {
      id: key,
      keyword: leadSignal.keyword,
      headline: leadSignal.headline,
      score,
      priority: buildPriority(score),
      recommendedCategory: category,
      intent,
      recommendation,
      recommendationLabel,
      freshnessHours: Math.round(freshestHours * 10) / 10,
      freshnessLabel: describeFreshness(freshestHours),
      trendWindowLabel: describeTrendWindow(hasGoogleTrendsSignal, hasSocialSignal),
      searchDemandLabel: leadSignal.searchDemandLabel,
      suggestedFormatLabel,
      suggestedWorkflowLabel,
      fitLevel,
      fitLabel,
      fitReason,
      whyNow: buildWhyNow(leadSignal, category, recommendationLabel, coverage.count),
      supportSignals,
      sourceMix: Array.from(new Set(signals.map((signal) => signal.sourceLabel))),
      sourceCount: distinctSourceCount,
      sources: signals.map((signal) => ({
        label: signal.sourceLabel,
        type: signal.sourceType,
        url: signal.url,
        publishedAt: signal.publishedAt,
      })),
      existingCoverageCount: coverage.count,
      existingCoverageSamples: coverage.samples,
    };
  })
    .sort((left, right) => right.score - left.score || right.sourceCount - left.sourceCount || left.keyword.localeCompare(right.keyword, "vi"))
    .slice(0, 40);

  return {
    items,
    summary: buildSummary(items),
    referenceLinks: [
      { label: "Google Trends VN", url: "https://trends.google.com/trending?geo=VN", note: "Nguồn spike tìm kiếm công khai, cập nhật nhanh." },
      { label: "Google Trends Explore", url: "https://trends.google.com/trends/", note: "Phân tích sâu cho từng keyword hoặc cluster." },
      { label: "Google News Social Buzz VN", url: "https://news.google.com/search?q=(viral+OR+trend+OR+%22m%E1%BA%A1ng+x%C3%A3+h%E1%BB%99i%22+OR+Threads+OR+Facebook+OR+%22g%C3%A2y+s%E1%BB%91t%22)+when:1d&hl=vi&gl=VN&ceid=VN:vi", note: "Lớp tín hiệu gần Facebook, Threads và các phrase đang nổi nhanh ở Việt Nam." },
      { label: "TikTok Creative Center", url: "https://ads.tiktok.com/business/creativecenter/keyword-insights/pc/en", note: "Tham khảo hook social và cách diễn đạt keyword." },
    ],
    updatedAt: new Date().toISOString(),
    cacheTtlMs: TREND_RADAR_CACHE_TTL_MS,
  };
}