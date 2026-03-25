import type { Article } from "./types";

export const KPI_CONTENT_FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLScS-CMH8FwKAQQ_dcAGRzF__2l7G_dYo2Z4UxR5h--3XOF1_w/viewform";
export const KPI_CONTENT_BATCH_SIZE = 5;

export type KpiContentStatus =
  | "queued"
  | "submitting_form"
  | "form_submitted"
  | "completed"
  | "failed";

export function isKpiContentPending(status: string | null | undefined) {
  return status === "queued"
    || status === "submitting_form"
    || status === "form_submitted";
}

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

export function resolveKpiContentClientTaskKey(article: Pick<Article, "articleType" | "contentType" | "category">) {
  const articleType = foldText(normalizeText(article.articleType));
  const contentType = foldText(normalizeText(article.contentType));
  const category = foldText(normalizeText(article.category));

  if (!articleType && !category) {
    return null;
  }

  if (articleType.includes("mo ta sp") || category.includes("mo ta")) {
    return articleType.includes("ngan")
      ? "Mô tả sản phẩm::Viết mô tả ngắn"
      : "Mô tả sản phẩm::Viết mô tả dài";
  }

  if (articleType.includes("seo ai") || category.includes("seo ai")) {
    return "Viết bài tin tức::SEO AI";
  }

  if (articleType.includes("2k") || contentType.includes("viet lai")) {
    return "Viết bài tin tức::Bài dài - khó";
  }

  return "Viết bài tin tức::SEO AI";
}

export function getKpiContentStatusLabel(status: string | null | undefined) {
  switch (status) {
    case "queued":
      return "Đang xếp hàng KPI";
    case "submitting_form":
      return "Đang gửi form KPI";
    case "form_submitted":
      return "Đã gửi form KPI";
    case "completed":
      return "Đã đăng ký KPI";
    case "failed":
      return "Đăng ký lại KPI";
    default:
      return String(status || "Chưa đăng ký KPI");
  }
}

export function getKpiContentActionState(
  article: Pick<Article, "kpiContentStatus" | "kpiContentStatusLabel">,
  isProcessing: boolean,
) {
  const status = article.kpiContentStatus || null;
  if (isProcessing) {
    return {
      disabled: true,
      icon: "progress_activity",
      title: "Đang đăng ký KPI Content",
      label: "Đang xử lý",
      background: "rgba(168, 85, 247, 0.08)",
      color: "#7c3aed",
      border: "1px solid rgba(168, 85, 247, 0.16)",
      animation: "spin 1s linear infinite" as string | undefined,
    };
  }

  if (status === "completed") {
    return {
      disabled: true,
      icon: "check_circle",
      title: "Đã đăng ký KPI Content",
      label: article.kpiContentStatusLabel || "Đã đăng ký",
      background: "rgba(16, 185, 129, 0.12)",
      color: "#047857",
      border: "1px solid rgba(16, 185, 129, 0.18)",
      animation: undefined,
    };
  }

  if (isKpiContentPending(status)) {
    return {
      disabled: true,
      icon: "pending_actions",
      title: article.kpiContentStatusLabel || "Đang xử lý KPI Content",
      label: article.kpiContentStatusLabel || "Đang xử lý",
      background: "rgba(245, 158, 11, 0.1)",
      color: "#b45309",
      border: "1px solid rgba(245, 158, 11, 0.18)",
      animation: undefined,
    };
  }

  if (status === "failed") {
    return {
      disabled: false,
      icon: "error",
      title: "Đăng ký lại KPI Content",
      label: "Đăng ký lại",
      background: "rgba(239, 68, 68, 0.08)",
      color: "var(--danger)",
      border: "1px solid rgba(239, 68, 68, 0.16)",
      animation: undefined,
    };
  }

  return {
    disabled: false,
    icon: "assignment_add",
    title: "Đăng ký KPI Content",
    label: "Đăng ký KPI",
    background: "rgba(168, 85, 247, 0.08)",
    color: "#7c3aed",
    border: "1px solid rgba(168, 85, 247, 0.16)",
    animation: undefined,
  };
}
