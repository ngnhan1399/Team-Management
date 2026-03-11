/**
 * Shared string normalization utilities.
 *
 * Centralizes the `normalizeString` / `normalizeOptionalString` helpers that
 * were previously duplicated across multiple API route files.
 */

export function normalizeString(value: unknown): string {
    return String(value || "").trim();
}

export function normalizeOptionalString(value: unknown): string | undefined {
    const normalized = normalizeString(value);
    return normalized || undefined;
}

export function foldSearchText(value: unknown): string {
    return normalizeString(value)
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .replace(/đ/gi, "d")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

export function matchesLooseSearch(value: unknown, query: unknown): boolean {
    const foldedValue = foldSearchText(value);
    const foldedQuery = foldSearchText(query);
    if (!foldedValue || !foldedQuery) return false;

    const tokens = foldedQuery.split(" ").filter(Boolean);
    return tokens.every((token) => foldedValue.includes(token));
}
