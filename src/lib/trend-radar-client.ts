export interface TrendRadarArticleDraft {
  keyword: string;
  headline: string;
  recommendedCategory: "ICT" | "Gia dụng" | "Thủ thuật" | "Giải trí" | "Đánh giá" | "SEO AI" | "Khác";
  recommendation: "write_new" | "refresh_existing" | "watch";
  whyNow: string;
  searchDemandLabel?: string | null;
  suggestedFormatLabel?: string | null;
  suggestedWorkflowLabel?: string | null;
  supportSignals: string[];
  sourceLabel?: string | null;
  sourceUrl?: string | null;
  existingCoverageArticleId?: number | null;
  existingCoverageTitle?: string | null;
  createdAt: string;
}

const ARTICLE_DRAFT_STORAGE_KEY = "workdocker.trendRadar.articleDraft";

export function normalizeTrendRadarWatchTerm(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function buildTrendRadarWatchlistStorageKey(viewerKey: string) {
  return `workdocker.trendRadar.watchlist:${viewerKey || "guest"}`;
}

export function saveTrendRadarArticleDraft(draft: TrendRadarArticleDraft) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(ARTICLE_DRAFT_STORAGE_KEY, JSON.stringify(draft));
}

export function consumeTrendRadarArticleDraft() {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(ARTICLE_DRAFT_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  window.localStorage.removeItem(ARTICLE_DRAFT_STORAGE_KEY);

  try {
    const parsed = JSON.parse(raw) as TrendRadarArticleDraft | null;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
