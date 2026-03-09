const ROYALTY_ELIGIBLE_STATUSES = new Set(["Published", "Approved"]);

export function isRoyaltyEligibleArticleStatus(status: unknown) {
  return ROYALTY_ELIGIBLE_STATUSES.has(String(status || "").trim());
}

export type RoyaltyDateParts = {
  year: number;
  month: number;
  day: number;
  normalized: string;
};

export function parseRoyaltyDateParts(value: unknown): RoyaltyDateParts | null {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const isoTimestamp = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[tT ].*)?$/);
  if (isoTimestamp) {
    const year = Number(isoTimestamp[1]);
    const month = Number(isoTimestamp[2]);
    const day = Number(isoTimestamp[3]);
    if (Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day)) {
      return {
        year,
        month,
        day,
        normalized: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      };
    }
  }

  const dmy = raw.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = Number(dmy[3]);
    if (Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day)) {
      return {
        year,
        month,
        day,
        normalized: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      };
    }
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;

  const year = parsed.getFullYear();
  const month = parsed.getMonth() + 1;
  const day = parsed.getDate();
  return {
    year,
    month,
    day,
    normalized: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

export function matchesRoyaltyMonthYear(value: unknown, month: number, year: number) {
  const parts = parseRoyaltyDateParts(value);
  return Boolean(parts && parts.year === year && parts.month === month);
}
