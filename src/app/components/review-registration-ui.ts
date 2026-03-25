import { isApprovedArticleStatus } from "@/lib/article-status";
import type { Article } from "./types";

export function isReviewRegistrationPending(status: string | null | undefined) {
  return status === "queued" || status === "writing_sheet";
}

export function getReviewRegistrationActionState(
  article: Pick<Article, "reviewRegistrationStatus" | "reviewRegistrationStatusLabel">,
  isProcessing: boolean,
) {
  const status = article.reviewRegistrationStatus || null;

  if (isProcessing) {
    return {
      disabled: true,
      icon: "progress_activity",
      title: "Đang đăng ký bài duyệt",
      label: "Đang xử lý",
      background: "rgba(14, 165, 233, 0.08)",
      color: "#0369a1",
      border: "1px solid rgba(14, 165, 233, 0.16)",
      animation: "spin 1s linear infinite" as string | undefined,
    };
  }

  if (status === "completed") {
    return {
      disabled: true,
      icon: "check_circle",
      title: "Đã đăng ký bài duyệt",
      label: article.reviewRegistrationStatusLabel || "Đã đăng ký",
      background: "rgba(16, 185, 129, 0.12)",
      color: "#047857",
      border: "1px solid rgba(16, 185, 129, 0.18)",
      animation: undefined,
    };
  }

  if (isReviewRegistrationPending(status)) {
    return {
      disabled: true,
      icon: "pending_actions",
      title: article.reviewRegistrationStatusLabel || "Đang ghi sheet bài duyệt",
      label: article.reviewRegistrationStatusLabel || "Đang xử lý",
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
      title: "Đăng ký lại bài duyệt",
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
    title: "Đăng ký bài duyệt",
    label: "Đăng ký duyệt",
    background: "rgba(14, 165, 233, 0.08)",
    color: "#0369a1",
    border: "1px solid rgba(14, 165, 233, 0.16)",
    animation: undefined,
  };
}

export function getMarkReviewedActionState(
  article: Pick<Article, "status">,
  isProcessing: boolean,
) {
  if (isProcessing) {
    return {
      disabled: true,
      icon: "progress_activity",
      title: "Đang cập nhật trạng thái duyệt",
      label: "Đang duyệt",
      background: "rgba(168, 85, 247, 0.08)",
      color: "#7c3aed",
      border: "1px solid rgba(168, 85, 247, 0.16)",
      animation: "spin 1s linear infinite" as string | undefined,
    };
  }

  if (isApprovedArticleStatus(article.status)) {
    return {
      disabled: true,
      icon: "fact_check",
      title: "Bài viết đã được duyệt",
      label: "Đã duyệt",
      background: "rgba(16, 185, 129, 0.12)",
      color: "#047857",
      border: "1px solid rgba(16, 185, 129, 0.18)",
      animation: undefined,
    };
  }

  return {
    disabled: false,
    icon: "task_alt",
    title: "Đánh dấu đã duyệt",
    label: "Đã duyệt",
    background: "rgba(168, 85, 247, 0.08)",
    color: "#7c3aed",
    border: "1px solid rgba(168, 85, 247, 0.16)",
    animation: undefined,
  };
}
