import { resolveArticleCategory } from "@/lib/article-category";

const CONTENT_WORK_REGISTRATION_TITLE = "Đăng ký lại bài trong Content Work";
const CONTENT_WORK_FORM_URL = "https://docs.google.com/forms/d/1CRpmylyRwSo1tpc5Xa_ryVy2m_c2xTjXb9t_ESihGdY/viewform?edit_requested=true";
const CONTENT_WORK_REGISTRATION_URL = CONTENT_WORK_FORM_URL;
const CONTENT_WORK_SHEET_URL = "https://docs.google.com/spreadsheets/d/10xgj6260aKTU5tn4WONRF5AccUPRhnoMcWJXyNn023I/edit?gid=1639483225#gid=1639483225";
const CONTENT_WORK_FORM_ID = "1CRpmylyRwSo1tpc5Xa_ryVy2m_c2xTjXb9t_ESihGdY";
const CONTENT_WORK_SHEET_ID = "10xgj6260aKTU5tn4WONRF5AccUPRhnoMcWJXyNn023I";
const CONTENT_WORK_TARGET_SHEET_GID = 1639483225;

export type ContentWorkStatus =
  | "queued"
  | "submitting_form"
  | "form_submitted"
  | "link_written"
  | "completed"
  | "failed";

export function normalizeRegistrationReminderText(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export function isContentWorkRegistrationReminderTitle(value: unknown) {
  return normalizeRegistrationReminderText(value) === normalizeRegistrationReminderText(CONTENT_WORK_REGISTRATION_TITLE);
}

function normalizeContentTypeLabel(contentType: unknown) {
  return String(contentType || "").trim() === "Viết lại" ? "viết lại" : "viết mới";
}

export function resolveContentWorkCategoryLabel(input: {
  articleType?: unknown;
  contentType?: unknown;
  category?: unknown;
}) {
  const articleType = String(input.articleType || "").trim();
  const contentTypeLabel = normalizeContentTypeLabel(input.contentType);
  const resolvedCategory = resolveArticleCategory(input.category, input.articleType);

  switch (articleType) {
    case "Mô tả SP ngắn":
      return `Mô tả sản phẩm ngắn (${contentTypeLabel})`;
    case "Mô tả SP dài":
      return `Mô tả sản phẩm dài (${contentTypeLabel})`;
    case "Bài SEO ICT":
      return `Bài SEO ICT (${contentTypeLabel})`;
    case "Bài SEO ICT 1K5":
      return `Bài SEO ICT 1K5 (${contentTypeLabel})`;
    case "Bài SEO ICT 2K":
      return `Bài SEO ICT 2K (${contentTypeLabel})`;
    case "Bài SEO Gia dụng":
      return `Bài SEO Gia dụng (${contentTypeLabel})`;
    case "Bài SEO Gia dụng 1K5":
      return `Bài SEO Gia dụng 1K5 (${contentTypeLabel})`;
    case "Bài SEO Gia dụng 2K":
      return `Bài SEO Gia dụng 2K (${contentTypeLabel})`;
    case "Thủ thuật":
      return "Thủ Thuật";
    case "SEO AI":
      return "Bài SEO AI";
    case "Bài dịch Review SP":
      return "Đánh giá";
    default:
      if (resolvedCategory === "Thủ thuật") return "Thủ Thuật";
      if (resolvedCategory === "Đánh giá") return "Đánh giá";
      if (resolvedCategory === "SEO AI") return "Bài SEO AI";
      if (resolvedCategory === "Giải trí") return "Trending";
      return null;
  }
}

export function getContentWorkStatusLabel(status: ContentWorkStatus) {
  switch (status) {
    case "queued":
      return "Đang chờ";
    case "submitting_form":
      return "Đang gửi form";
    case "form_submitted":
      return "Đã gửi form";
    case "link_written":
      return "Đã điền link";
    case "completed":
      return "Hoàn thành";
    case "failed":
      return "Lỗi";
    default:
      return status;
  }
}

export {
  CONTENT_WORK_FORM_ID,
  CONTENT_WORK_FORM_URL,
  CONTENT_WORK_REGISTRATION_URL,
  CONTENT_WORK_REGISTRATION_TITLE,
  CONTENT_WORK_SHEET_ID,
  CONTENT_WORK_SHEET_URL,
  CONTENT_WORK_TARGET_SHEET_GID,
};
