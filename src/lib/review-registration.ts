export const REVIEW_REGISTRATION_TITLE = "Đăng ký bài duyệt";
export const REVIEW_REGISTRATION_SHEET_URL = "https://docs.google.com/spreadsheets/d/157reP9SMWXgV47XHPcUJNqo1RicwS6vsqQvOlEW5F8Q/edit?gid=184624696#gid=184624696";

export type ReviewRegistrationStatus = "queued" | "writing_sheet" | "completed" | "failed";

export type ReviewRegistrationProfile = {
  key: string;
  reviewerLabel: string;
  aliases: string[];
  spreadsheetUrl: string;
  sheetName: string;
  managerLabel?: string | null;
};

const REVIEW_REGISTRATION_PROFILES: ReviewRegistrationProfile[] = [
  {
    key: "viet-nguyen",
    reviewerLabel: "Việt Nguyễn",
    aliases: ["Việt Nguyễn", "Viet Nguyen", "Vi?t Nguy?n"],
    spreadsheetUrl: REVIEW_REGISTRATION_SHEET_URL,
    sheetName: "Việt Nguyễn",
    managerLabel: "",
  },
];

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function foldText(value: string) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/gi, "d")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function getReviewRegistrationStatusLabel(status: ReviewRegistrationStatus | string | null | undefined) {
  switch (status) {
    case "queued":
      return "Đang chờ";
    case "writing_sheet":
      return "Đang ghi sheet";
    case "completed":
      return "Đã đăng ký bài duyệt";
    case "failed":
      return "Đăng ký lại bài duyệt";
    default:
      return String(status || "Chưa đăng ký bài duyệt");
  }
}

export function resolveReviewRegistrationSheetProfile(values: Array<unknown>) {
  const foldedValues = new Set(
    values
      .map((value) => foldText(String(value || "")))
      .filter(Boolean),
  );

  return REVIEW_REGISTRATION_PROFILES.find((profile) =>
    profile.aliases.some((alias) => foldedValues.has(foldText(alias))),
  ) || null;
}

export function resolveReviewRegistrationProfile(values: Array<unknown>) {
  return resolveReviewRegistrationSheetProfile(values);
}

export function getReviewRegistrationProfiles() {
  return REVIEW_REGISTRATION_PROFILES.slice();
}
