export type LinkHealthStatus = "ok" | "broken" | "unknown";

export const LINK_CHECK_SCHEDULE_HOURS = [9, 14, 22] as const;
export const LINK_CHECK_TIMEZONE_OFFSET_MINUTES = 7 * 60;
export const LINK_CHECK_MANUAL_MAX_ITEMS = 50;
export const LINK_CHECK_SCHEDULED_MAX_ITEMS = 180;
export const LINK_CHECK_SCHEDULED_LOOKBACK_DAYS = 90;

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function toTimezoneDate(date: Date, offsetMinutes = LINK_CHECK_TIMEZONE_OFFSET_MINUTES) {
  return new Date(date.getTime() + offsetMinutes * 60_000);
}

export function formatLinkCheckDateKey(date: Date, offsetMinutes = LINK_CHECK_TIMEZONE_OFFSET_MINUTES) {
  const zonedDate = toTimezoneDate(date, offsetMinutes);
  return `${zonedDate.getUTCFullYear()}-${pad2(zonedDate.getUTCMonth() + 1)}-${pad2(zonedDate.getUTCDate())}`;
}

export function getLatestDueLinkCheckSlot(date: Date, offsetMinutes = LINK_CHECK_TIMEZONE_OFFSET_MINUTES) {
  const zonedDate = toTimezoneDate(date, offsetMinutes);
  const minutesOfDay = zonedDate.getUTCHours() * 60 + zonedDate.getUTCMinutes();
  const dueHour = [...LINK_CHECK_SCHEDULE_HOURS].reverse().find((hour) => minutesOfDay >= hour * 60);

  if (dueHour === undefined) {
    return null;
  }

  return {
    hour: dueHour,
    key: `${formatLinkCheckDateKey(date, offsetMinutes)}@${pad2(dueHour)}`,
  };
}

export function parseLinkHealthCheckedAt(value: string | number | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string" || !value.trim()) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
