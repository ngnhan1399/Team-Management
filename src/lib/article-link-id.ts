function normalizeLinkValue(value: unknown) {
  return String(value || "").trim();
}

export function extractArticleIdFromLink(value: unknown) {
  const normalized = normalizeLinkValue(value);
  if (!normalized) {
    return "";
  }

  const match = normalized.match(/(?:^|[^\d])(\d{6})(?:\/)?(?:[?#].*)?$/);
  return match?.[1] || "";
}

export function hasExtractableArticleIdLink(value: unknown) {
  return extractArticleIdFromLink(value).length === 6;
}
