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
