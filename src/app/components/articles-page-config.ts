import { foldSearchText } from "@/lib/normalize";
import type { ArticleDeleteCriteria } from "./types";

export const IMPORT_FIELD_OPTIONS = [
  { value: "", label: "— Bỏ qua —" },
  { value: "articleId", label: "Mã bài viết" },
  { value: "date", label: "Ngày viết" },
  { value: "title", label: "Tiêu đề" },
  { value: "penName", label: "Bút danh" },
  { value: "category", label: "Danh mục" },
  { value: "articleType", label: "Loại bài" },
  { value: "contentType", label: "Loại nội dung" },
  { value: "wordCountRange", label: "Khoảng từ" },
  { value: "status", label: "Trạng thái" },
  { value: "link", label: "Link bài viết" },
  { value: "reviewerName", label: "Người duyệt" },
  { value: "notes", label: "Ghi chú" },
];

export const REQUIRED_IMPORT_FIELDS = ["date", "title", "penName"];
export const IMPORTANT_IMPORT_FIELDS = ["articleId", "date", "title", "penName", "status", "link"];
export const CATEGORY_OPTIONS = ["ICT", "Gia dụng", "Thủ thuật", "Giải trí", "Đánh giá", "Khác"];
export const EDITORIAL_ONLY_CATEGORY_OPTIONS = ["SEO AI"];
export const ARTICLE_TYPE_OPTIONS = [
  "Mô tả SP ngắn",
  "Mô tả SP dài",
  "Bài dịch Review SP",
  "Bài SEO ICT",
  "Bài SEO Gia dụng",
  "Bài SEO ICT 1K5",
  "Bài SEO Gia dụng 1K5",
  "Bài SEO ICT 2K",
  "Bài SEO Gia dụng 2K",
  "Thủ thuật",
];
export const EDITORIAL_ONLY_ARTICLE_TYPE_OPTIONS = ["SEO AI"];
export const CONTENT_TYPE_OPTIONS = ["Viết mới", "Viết lại"];
export const WORD_COUNT_RANGE_OPTIONS = [
  { value: "800-1000", label: "800-1000 chữ" },
  { value: "1000-1500", label: "1000-1500 chữ" },
  { value: "1500-2000", label: "1500-2000 chữ" },
  { value: "Từ 2000 trở lên", label: "Từ 2000 chữ trở lên" },
];
export const DEFAULT_ARTICLE_STATUS = "Submitted";
export const LINK_RECHECK_INTERVAL_MS = 5 * 60 * 1000;
export const ARTICLE_PAGE_SIZE = 30;
export const SPLIT_ARTICLE_PERIOD_FETCH_LIMIT = 2000;
export const ARTICLE_STATUS_OPTIONS = [
  { value: "", label: "Tất cả" },
  { value: "Draft", label: "📋 Nháp" },
  { value: "Submitted", label: "📤 Chờ duyệt" },
  { value: "Reviewing", label: "🔎 Đang duyệt" },
  { value: "ApprovedLike", label: "✅ Đã duyệt" },
  { value: "NeedsFix", label: "⚠️ Sửa lỗi" },
  { value: "Rejected", label: "⛔ Từ chối" },
];
export const MONTH_OPTIONS = [{ value: "", label: "Tháng" }, ...Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `Tháng ${i + 1}` }))];
export const YEAR_OPTIONS = [{ value: "", label: "Năm" }, ...Array.from({ length: 6 }, (_, i) => {
  const year = new Date().getFullYear() - 2 + i;
  return { value: String(year), label: String(year) };
})];
export const EMPTY_DELETE_CRITERIA: ArticleDeleteCriteria = {
  search: "",
  titleQuery: "",
  penName: "",
  status: "",
  category: "",
  articleType: "",
  contentType: "",
  month: "",
  year: "",
  reviewerName: "",
};

export type ArticleFilters = Pick<ArticleDeleteCriteria, "penName" | "status" | "category" | "articleType" | "contentType" | "month" | "year">;

const PEN_NAME_DISPLAY_ALIASES: Record<string, string> = {
  "Nhân BTV": "Đình Nhân",
};

export const MANAGER_DEFAULT_PEN_NAME = "Nhân BTV";

export function createCurrentMonthFilters(): ArticleFilters {
  const now = new Date();
  return {
    penName: "",
    status: "",
    category: "",
    articleType: "",
    contentType: "",
    month: String(now.getMonth() + 1),
    year: String(now.getFullYear()),
  };
}

export function getDisplayedPenName(value: string | null | undefined) {
  const normalizedValue = String(value || "").trim();
  if (!normalizedValue) {
    return "";
  }

  return PEN_NAME_DISPLAY_ALIASES[normalizedValue] || normalizedValue;
}

export function normalizeWordCountRangeValue(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  switch (normalized) {
    case "800-1000":
    case "800 - 1000 chữ":
      return "800-1000";
    case "1000-1500":
    case "1000 - 1500 chữ":
      return "1000-1500";
    case "1500-2000":
    case "1500 - 2000 chữ":
      return "1500-2000";
    case "Từ 2000 trở lên":
    case "Từ 2000 chữ trở lên":
      return "Từ 2000 trở lên";
    default:
      return "";
  }
}

export function normalizeIdentityValue(value: unknown) {
  return foldSearchText(value);
}

export function buildApiErrorMessage(data: unknown, fallback: string) {
  const payload = (data && typeof data === "object") ? data as Record<string, unknown> : {};
  const baseMessage = String(payload.error || payload.message || fallback);
  const normalizedDetails = Array.isArray(payload.details)
    ? payload.details.map((item) => String(item || "").trim()).filter(Boolean)
    : [];

  if (normalizedDetails.length === 0) {
    return baseMessage;
  }

  return `${baseMessage}\n\nChi tiết:\n- ${normalizedDetails.slice(0, 5).join("\n- ")}`;
}
