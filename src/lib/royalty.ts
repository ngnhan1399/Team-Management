const ROYALTY_ELIGIBLE_STATUSES = new Set(["Published", "Approved"]);

export function isRoyaltyEligibleArticleStatus(status: unknown) {
  return ROYALTY_ELIGIBLE_STATUSES.has(String(status || "").trim());
}
