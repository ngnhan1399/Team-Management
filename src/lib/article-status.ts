const APPROVED_ARTICLE_STATUSES = new Set(["Published", "Approved"]);
const APPROVED_FILTER_VALUES = new Set(["Published", "Approved", "ApprovedLike", "approved", "approved_like"]);

export function isApprovedArticleStatus(status: unknown) {
  return APPROVED_ARTICLE_STATUSES.has(String(status || "").trim());
}

export function isApprovedArticleStatusFilterValue(value: unknown) {
  return APPROVED_FILTER_VALUES.has(String(value || "").trim());
}
