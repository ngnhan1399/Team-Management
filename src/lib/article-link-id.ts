function normalizeLinkValue(value: unknown) {
  return String(value || "").trim();
}

function normalizeArticleType(value: unknown) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
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

export function isDescriptionArticleType(value: unknown) {
  const normalized = normalizeArticleType(value);
  return normalized === "mo ta sp ngan" || normalized === "mo ta sp dai";
}

export function isLinkIdRequiredForArticleType(value: unknown) {
  return !isDescriptionArticleType(value);
}
