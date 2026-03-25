export const KPI_CONTENT_FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLScS-CMH8FwKAQQ_dcAGRzF__2l7G_dYo2Z4UxR5h--3XOF1_w/viewform";

export type KpiContentStatus = "queued" | "submitting_form" | "form_submitted" | "completed" | "failed";

export type KpiContentTaskSelection = {
  taskLabel: string;
  detailLabel: string;
};

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function foldText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function getKpiContentStatusLabel(status: KpiContentStatus) {
  switch (status) {
    case "queued":
      return "Đang chờ";
    case "submitting_form":
      return "Đang gửi form";
    case "form_submitted":
      return "Đã gửi form";
    case "completed":
      return "Hoàn thành";
    case "failed":
      return "Lỗi";
    default:
      return status;
  }
}

export function normalizeEmployeeCode(value: unknown) {
  const normalized = normalizeText(value);
  return normalized || null;
}

export function resolveKpiContentTaskSelection(input: {
  articleType?: unknown;
  contentType?: unknown;
  category?: unknown;
}): KpiContentTaskSelection | null {
  const articleType = normalizeText(input.articleType);
  const contentType = normalizeText(input.contentType);
  const category = normalizeText(input.category);
  const foldedArticleType = foldText(articleType);
  const foldedContentType = foldText(contentType);
  const foldedCategory = foldText(category);

  if (!foldedArticleType && !foldedCategory) {
    return null;
  }

  if (foldedArticleType.includes("mo ta sp") || foldedCategory.includes("mo ta")) {
    return {
      taskLabel: "Mô tả sản phẩm",
      detailLabel: foldedArticleType.includes("ngan") ? "Viết mô tả ngắn" : "Viết mô tả dài",
    };
  }

  if (foldedArticleType.includes("seo ai") || foldedCategory.includes("seo ai")) {
    return {
      taskLabel: "Viết bài tin tức",
      detailLabel: "SEO AI",
    };
  }

  if (foldedArticleType.includes("2k") || foldedContentType.includes("viet lai")) {
    return {
      taskLabel: "Viết bài tin tức",
      detailLabel: "Bài dài - khó",
    };
  }

  return {
    taskLabel: "Viết bài tin tức",
    detailLabel: "SEO AI",
  };
}
