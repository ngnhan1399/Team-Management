"use client";

import React, { useCallback, useDeferredValue, useEffect, useState } from "react";
import { useAuth } from "./auth-context";
import dynamic from "next/dynamic";
import CustomSelect from "./CustomSelect";
import { useIsMobile } from "./useMediaQuery";
import MobileArticleCard from "./MobileArticleCard";
import BottomSheet from "./BottomSheet";
import {
  ARTICLE_PAGE_SIZE,
  ARTICLE_STATUS_OPTIONS,
  ARTICLE_TYPE_OPTIONS,
  IMPORTANT_IMPORT_FIELDS,
  CATEGORY_OPTIONS,
  CONTENT_TYPE_OPTIONS,
  DEFAULT_ARTICLE_STATUS,
  EDITORIAL_ONLY_ARTICLE_TYPE_OPTIONS,
  EDITORIAL_ONLY_CATEGORY_OPTIONS,
  EMPTY_DELETE_CRITERIA,
  IMPORT_FIELD_OPTIONS,
  MANAGER_DEFAULT_PEN_NAME,
  MONTH_OPTIONS,
  REQUIRED_IMPORT_FIELDS,
  SPLIT_ARTICLE_PERIOD_FETCH_LIMIT,
  WORD_COUNT_RANGE_OPTIONS,
  YEAR_OPTIONS,
  buildApiErrorMessage,
  createCurrentMonthFilters,
  getDisplayedPenName,
  normalizeIdentityValue,
  normalizeWordCountRangeValue,
  type ArticleFilters,
} from "./articles-page-config";

const ArticlePreviewPanel = dynamic(() => import("./ArticlePreviewPanel"), { ssr: false });
const ArticleDeleteModal = dynamic(() => import("./ArticleDeleteModal"), { ssr: false });
const ArticleImportWizard = dynamic(() => import("./ArticleImportWizard"), { ssr: false });
import { emitRealtimePayload, useRealtimeRefresh } from "./realtime";
import { isApprovedArticleStatus, isApprovedArticleStatusFilterValue } from "@/lib/article-status";
import { extractArticleIdFromLink, isLinkIdRequiredForArticleType } from "@/lib/article-link-id";
import { resolvePreferredCollaboratorPenName } from "@/lib/collaborator-identity";
import { LINK_CHECK_MANUAL_MAX_ITEMS, parseLinkHealthCheckedAt, type LinkHealthStatus } from "@/lib/link-health";
import { foldSearchText, matchesLooseSearch } from "@/lib/normalize";
import { getPreferredArticleNavigationLink } from "@/lib/review-link";
import { consumeTrendRadarArticleDraft, type TrendRadarArticleDraft } from "@/lib/trend-radar-client";
import type {
  Article,
  ArticleComment,
  Collaborator,
  ArticleDeleteCriteria,
  ArticleDeletePreview,
  GoogleSheetSyncResult,
  ImportAnalyzeResult,
  ImportColumnAnalysis,
  ImportExecuteResult,
  ImportDryRunResult,
} from "./types";

const EMPTY_ARTICLE_FILTERS: ArticleFilters = {
  penName: "",
  status: "",
  category: "",
  articleType: "",
  contentType: "",
  month: "",
  year: "",
};

function normalizeTrendRadarArticleCategory(category: TrendRadarArticleDraft["recommendedCategory"]) {
  switch (category) {
    case "Đời sống":
      return "Khác";
    case "Thể thao":
      return "Giải trí";
    default:
      return category;
  }
}
function getTrendRadarSuggestedArticleType(category: TrendRadarArticleDraft["recommendedCategory"]) {
  switch (normalizeTrendRadarArticleCategory(category)) {
    case "Gia dụng":
      return "Bài SEO Gia dụng";
    case "Thủ thuật":
      return "Thủ thuật";
    case "SEO AI":
      return "SEO AI";
    default:
      return "Bài SEO ICT";
  }
}

function buildTrendRadarPrefillNotes(draft: TrendRadarArticleDraft) {
  const lines = [
    "Nguồn đề xuất: Trend Radar",
    `Keyword: ${draft.keyword}`,
    draft.headline ? `Tiêu đề nguồn: ${draft.headline}` : null,
    draft.recommendedCategory ? `Nhóm trend gợi ý: ${draft.recommendedCategory}` : null,
    draft.suggestedFormatLabel ? `Dạng bài gợi ý: ${draft.suggestedFormatLabel}` : null,
    draft.suggestedWorkflowLabel ? `Luồng xử lý gợi ý: ${draft.suggestedWorkflowLabel}` : null,
    draft.sourceLabel ? `Nguồn tín hiệu chính: ${draft.sourceLabel}` : null,
    draft.sourceUrl ? `Link tham khảo: ${draft.sourceUrl}` : null,
    draft.searchDemandLabel ? `Mức quan tâm: ${draft.searchDemandLabel}` : null,
    draft.existingCoverageTitle ? `Bài đang có nên xem lại: ${draft.existingCoverageTitle}` : null,
    draft.supportSignals.length > 0 ? `Tín hiệu hỗ trợ: ${draft.supportSignals.slice(0, 3).join(", ")}` : null,
    draft.whyNow ? `Vì sao nên làm: ${draft.whyNow}` : null,
  ];

  return lines.filter(Boolean).join("\n");
}

function mergeTrendRadarIntoExistingNotes(existingNotes: string | null | undefined, draft: TrendRadarArticleDraft) {
  const currentNotes = String(existingNotes || "").trim();
  if (currentNotes.includes("Nguồn đề xuất: Trend Radar") && currentNotes.includes(draft.keyword)) {
    return currentNotes;
  }

  const nextBlock = [
    "",
    "-----",
    buildTrendRadarPrefillNotes(draft),
  ].join("\n");

  return currentNotes ? `${currentNotes}${nextBlock}` : buildTrendRadarPrefillNotes(draft);
}

function buildTrendRadarRefreshArticle(existingArticle: Article, draft: TrendRadarArticleDraft) {
  return {
    ...existingArticle,
    status: existingArticle.status === "Approved" ? "Published" : existingArticle.status,
    wordCountRange: normalizeWordCountRangeValue(existingArticle.wordCountRange),
    notes: mergeTrendRadarIntoExistingNotes(existingArticle.notes, draft),
  } satisfies Partial<Article>;
}


export default function ArticlesPage() {
  type ArticleListQuery = { page: number; search: string; filters: ArticleFilters };
  const { user, loading: authLoading } = useAuth();
  const isMobile = useIsMobile();
  const importInputRef = React.useRef<HTMLInputElement>(null);
  const articlesRequestAbortRef = React.useRef<AbortController | null>(null);
  const collaboratorsRequestRef = React.useRef<Promise<void> | null>(null);
  const hasFetchedInitialArticlesRef = React.useRef(false);
  const articlesRealtimeRefreshTimerRef = React.useRef<number | null>(null);
  const articleListQueryRef = React.useRef<ArticleListQuery>({
    page: 1,
    search: "",
    filters: { ...EMPTY_ARTICLE_FILTERS },
  });
  const trendRadarDraftHandledRef = React.useRef(false);
  const importInputId = React.useId();
  const [articles, setArticles] = useState<Article[]>([]);
  const deferredArticles = useDeferredValue(articles);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 0 });
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [collaboratorsLoading, setCollaboratorsLoading] = useState(false);
  const [collaboratorsLoaded, setCollaboratorsLoaded] = useState(false);
  const [formData, setFormData] = useState<Partial<Article>>({});
  const [savingArticle, setSavingArticle] = useState(false);
  const [movingArticleToNextMonth, setMovingArticleToNextMonth] = useState(false);
  const [contentWorkPromptArticle, setContentWorkPromptArticle] = useState<Article | null>(null);
  const [contentWorkBannerArticle, setContentWorkBannerArticle] = useState<Article | null>(null);
  const [registeringContentWork, setRegisteringContentWork] = useState(false);
  const [registeringContentWorkArticleId, setRegisteringContentWorkArticleId] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [showImportWizard, setShowImportWizard] = useState(false);
  const [importStep, setImportStep] = useState(1);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importAnalysis, setImportAnalysis] = useState<ImportAnalyzeResult | null>(null);
  const [importMapping, setImportMapping] = useState<Record<string, string>>({});
  const [importResult, setImportResult] = useState<ImportExecuteResult | null>(null);
  const [importSheetName, setImportSheetName] = useState("");
  const [importHeaderRowNumber, setImportHeaderRowNumber] = useState(1);
  const [replaceExistingImport, setReplaceExistingImport] = useState(false);
  const [importError, setImportError] = useState("");
  const [importDryRun, setImportDryRun] = useState<ImportDryRunResult | null>(null);
  const [importDryRunLoading, setImportDryRunLoading] = useState(false);
  const [showGoogleSyncModal, setShowGoogleSyncModal] = useState(false);
  const [googleSyncMonth, setGoogleSyncMonth] = useState("");
  const [googleSyncYear, setGoogleSyncYear] = useState("");
  const [googleSyncLoading, setGoogleSyncLoading] = useState(false);
  const [googleSyncResult, setGoogleSyncResult] = useState<GoogleSheetSyncResult | null>(null);
  const [googleSyncError, setGoogleSyncError] = useState("");
  const [deleteMode, setDeleteMode] = useState<"all" | "current_filters" | "custom">("custom");
  const [deleteCriteria, setDeleteCriteria] = useState<ArticleDeleteCriteria>(EMPTY_DELETE_CRITERIA);
  const [deletePreview, setDeletePreview] = useState<ArticleDeletePreview | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteExecuting, setDeleteExecuting] = useState(false);
  const [deletingArticleIds, setDeletingArticleIds] = useState<number[]>([]);
  const [previewArticle, setPreviewArticle] = useState<Article | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<ArticleFilters>({ ...EMPTY_ARTICLE_FILTERS });
  const [linkCheckLoading, setLinkCheckLoading] = useState(false);
  const [showCommentsModal, setShowCommentsModal] = useState(false);
  const [commentArticle, setCommentArticle] = useState<Article | null>(null);
  const [comments, setComments] = useState<ArticleComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentContent, setCommentContent] = useState("");
  const [commentAttachment, setCommentAttachment] = useState("");
  const [commentSaving, setCommentSaving] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedArticleIds, setSelectedArticleIds] = useState<number[]>([]);
  const [bulkReviewerName, setBulkReviewerName] = useState("");
  const [bulkAssigningReviewer, setBulkAssigningReviewer] = useState(false);
  const isAdmin = user?.role === "admin";
  const collaboratorRole = typeof user?.collaborator?.role === "string" ? user.collaborator.role : "";
  const isReviewer = user?.role === "ctv" && collaboratorRole === "reviewer";
  const isWriter = user?.role === "ctv" && collaboratorRole === "writer";
  const canManageArticles = isAdmin;
  const canBulkAssignReviewer = canManageArticles || isReviewer;
  const canCreateArticles = isAdmin || isWriter;
  const canSyncArticles = isAdmin || isWriter;
  const shouldShowSplitArticleSections = canManageArticles || isReviewer;
  const canSeeEditorialOnlyArticleOptions = canManageArticles || isReviewer;
  const visibleCategoryOptions = canSeeEditorialOnlyArticleOptions
    ? [...CATEGORY_OPTIONS, ...EDITORIAL_ONLY_CATEGORY_OPTIONS]
    : CATEGORY_OPTIONS;
  const visibleArticleTypeOptions = canSeeEditorialOnlyArticleOptions
    ? [...ARTICLE_TYPE_OPTIONS, ...EDITORIAL_ONLY_ARTICLE_TYPE_OPTIONS]
    : ARTICLE_TYPE_OPTIONS;
  const collaboratorLabel = getDisplayedPenName(user?.collaborator?.penName) || user?.collaborator?.name || "tài khoản của bạn";
  const reviewerSelfAssignmentName = user?.collaborator?.name || user?.collaborator?.penName || "";
  const reviewerIdentityValues = Array.from(new Set([
    user?.collaborator?.name,
    user?.collaborator?.penName,
    user?.email?.split("@")[0],
    user?.email,
  ].map((value) => normalizeIdentityValue(value)).filter(Boolean)));
  const mappedFields = Object.values(importMapping).filter(Boolean);
  const duplicateMappedFields = mappedFields.filter((field, index) => mappedFields.indexOf(field) !== index);
  const missingRequiredImportFields = REQUIRED_IMPORT_FIELDS.filter((field) => !mappedFields.includes(field));
  const reviewerSelectOptions = [
    { value: "", label: collaboratorsLoading && collaborators.length === 0 ? "Đang tải reviewer..." : "Chưa phân công" },
    ...collaborators
      .filter((collaborator) => collaborator.role === "reviewer" || collaborator.linkedUserRole === "admin")
      .map((collaborator) => ({
        value: collaborator.penName,
        label: collaborator.name && collaborator.name !== collaborator.penName
          ? `${collaborator.penName} (${collaborator.name})`
          : collaborator.penName,
      })),
  ];
  const normalizedFilterPenName = resolvePreferredCollaboratorPenName([filters.penName], filters.penName || "") || "";
  const createDefaultFilters = useCallback(
    (): ArticleFilters => (canManageArticles ? createCurrentMonthFilters() : { ...EMPTY_ARTICLE_FILTERS }),
    [canManageArticles]
  );
  const resolveAuthorBucket = useCallback((article: Article): "ctv" | "editorial" => {
    if (article.authorUserRole === "admin") {
      return "editorial";
    }
    if (article.authorUserRole === "ctv") {
      return "ctv";
    }
    if (article.authorRole === "writer" || article.authorRole === "reviewer") {
      return "ctv";
    }

    const preferredPenName = resolvePreferredCollaboratorPenName([article.penName], article.penName || "") || article.penName || "";
    if (normalizeIdentityValue(preferredPenName) === normalizeIdentityValue(MANAGER_DEFAULT_PEN_NAME)) {
      return "editorial";
    }

    return article.authorBucket === "editorial" ? "editorial" : "ctv";
  }, []);

  const ensureCollaboratorsLoaded = useCallback(async () => {
    if (!canManageArticles || collaboratorsLoaded) {
      return;
    }

    if (collaboratorsRequestRef.current) {
      await collaboratorsRequestRef.current;
      return;
    }

    setCollaboratorsLoading(true);
    const request = fetch("/api/collaborators?view=directory", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setCollaborators(d.data || []);
        setCollaboratorsLoaded(true);
      })
      .catch(() => { })
      .finally(() => {
        collaboratorsRequestRef.current = null;
        setCollaboratorsLoading(false);
      });

    collaboratorsRequestRef.current = request;
    await request;
  }, [canManageArticles, collaboratorsLoaded]);

  const articleAssignedToReviewer = useCallback((article: Article) => {
    const normalizedReviewerName = normalizeIdentityValue(article.reviewerName);
    return !!normalizedReviewerName && reviewerIdentityValues.includes(normalizedReviewerName);
  }, [reviewerIdentityValues]);
  const articleAvailableForReviewerPickup = useCallback((article: Article) => {
    return article.status === "Submitted" && !normalizeIdentityValue(article.reviewerName);
  }, []);
  const articleMatchesReviewerScope = useCallback((article: Article) => {
    return articleAssignedToReviewer(article) || articleAvailableForReviewerPickup(article);
  }, [articleAssignedToReviewer, articleAvailableForReviewerPickup]);

  const canEditArticle = useCallback((article: Article) => {
    if (canManageArticles) return true;
    if (!isWriter) return false;
    return article.penName === user?.collaborator?.penName || article.createdByUserId === user?.id;
  }, [canManageArticles, isWriter, user]);

  const showContentWorkAction = useCallback((article: Article) => {
    if (!canManageArticles && !isWriter) return false;
    if (!canManageArticles && !canEditArticle(article)) return false;
    if (resolveAuthorBucket(article) === "editorial") return false;
    return Boolean(String(article.link || "").trim());
  }, [canEditArticle, canManageArticles, isWriter, resolveAuthorBucket]);
  const canRegisterContentWork = useCallback((article: Article) => {
    const status = article.contentWorkStatus || null;
    const isPending = status === "queued"
      || status === "submitting_form"
      || status === "form_submitted"
      || status === "link_written";
    return showContentWorkAction(article) && status !== "completed" && !isPending;
  }, [showContentWorkAction]);
  const getContentWorkActionState = useCallback((article: Article) => {
    const status = article.contentWorkStatus || null;
    const isCurrentRegistration = registeringContentWork && registeringContentWorkArticleId === article.id;
    if (isCurrentRegistration) {
      return {
        disabled: true,
        icon: "progress_activity",
        title: "Đang đăng ký Content Work",
        label: "Đang xử lý",
        background: "rgba(37, 99, 235, 0.08)",
        color: "var(--accent-blue)",
        border: "1px solid rgba(37, 99, 235, 0.16)",
        animation: "spin 1s linear infinite" as string | undefined,
      };
    }
    if (status === "completed") {
      return {
        disabled: true,
        icon: "check_circle",
        title: "Đã đăng ký Content Work",
        label: article.contentWorkStatusLabel || "Đã đăng ký",
        background: "rgba(16, 185, 129, 0.12)",
        color: "#047857",
        border: "1px solid rgba(16, 185, 129, 0.18)",
        animation: undefined,
      };
    }
    if (status === "queued" || status === "submitting_form" || status === "form_submitted" || status === "link_written") {
      return {
        disabled: true,
        icon: "pending_actions",
        title: article.contentWorkStatusLabel || "Đang xử lý Content Work",
        label: article.contentWorkStatusLabel || "Đang xử lý",
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
        title: "Đăng ký lại Content Work",
        label: "Đăng ký lại",
        background: "rgba(239, 68, 68, 0.08)",
        color: "var(--danger)",
        border: "1px solid rgba(239, 68, 68, 0.16)",
        animation: undefined,
      };
    }
    return {
      disabled: false,
      icon: "task_alt",
      title: "Đăng ký Content Work",
      label: "Đăng ký Content Work",
      background: "rgba(37, 99, 235, 0.08)",
      color: "var(--accent-blue)",
      border: "1px solid rgba(37, 99, 235, 0.16)",
      animation: undefined,
    };
  }, [registeringContentWork, registeringContentWorkArticleId]);

  const fetchArticles = useCallback((
    p = 1,
    s = "",
    f: ArticleFilters = articleListQueryRef.current.filters,
    options?: { background?: boolean }
  ) => {
    const nextFilters = { ...f };
    const background = options?.background === true;
    const shouldLoadFullSplitPeriod = shouldShowSplitArticleSections && Boolean(nextFilters.month && nextFilters.year);
    const requestPage = shouldLoadFullSplitPeriod ? 1 : p;
    const requestLimit = shouldLoadFullSplitPeriod ? SPLIT_ARTICLE_PERIOD_FETCH_LIMIT : ARTICLE_PAGE_SIZE;
    articleListQueryRef.current = {
      page: requestPage,
      search: s,
      filters: nextFilters,
    };
    articlesRequestAbortRef.current?.abort();
    const controller = new AbortController();
    articlesRequestAbortRef.current = controller;
    if (!background) {
      setLoading(true);
    }
    setPagination((prev) => (prev.page === requestPage ? prev : { ...prev, page: requestPage }));
    const params = new URLSearchParams({ page: String(requestPage), limit: String(requestLimit) });
    if (s) params.set("search", s);
    if (isWriter && user?.collaborator?.penName) params.set("penName", user.collaborator.penName);
    else if (nextFilters.penName) params.set("penName", nextFilters.penName);
    if (nextFilters.status) params.set("status", nextFilters.status);
    if (nextFilters.category) params.set("category", nextFilters.category);
    if (nextFilters.articleType) params.set("articleType", nextFilters.articleType);
    if (nextFilters.contentType) params.set("contentType", nextFilters.contentType);
    if (nextFilters.month) params.set("month", nextFilters.month);
    if (nextFilters.year) params.set("year", nextFilters.year);
    fetch(`/api/articles?${params}`, { cache: "no-store", signal: controller.signal })
      .then(r => r.json())
      .then(d => {
        if (controller.signal.aborted) return;
        setArticles(d.data || []);
        setPagination(d.pagination || {});
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
      })
      .finally(() => {
        if (articlesRequestAbortRef.current === controller) {
          articlesRequestAbortRef.current = null;
          if (!background) {
            setLoading(false);
          }
        }
      });
  }, [isWriter, shouldShowSplitArticleSections, user]);

  useEffect(() => {
    if (authLoading || hasFetchedInitialArticlesRef.current) {
      return;
    }

    const defaultFilters = createDefaultFilters();
    articleListQueryRef.current = {
      page: 1,
      search: "",
      filters: defaultFilters,
    };
    setFilters(defaultFilters);
    hasFetchedInitialArticlesRef.current = true;
    fetchArticles(1, "", defaultFilters);
  }, [authLoading, createDefaultFilters, fetchArticles]);

  useEffect(() => () => {
    articlesRequestAbortRef.current?.abort();
    if (articlesRealtimeRefreshTimerRef.current) {
      window.clearTimeout(articlesRealtimeRefreshTimerRef.current);
    }
  }, []);

  useEffect(() => {
    setSelectedArticleIds((prev) => prev.filter((id) => articles.some((article) => article.id === id)));
  }, [articles]);

  const showUiToast = useCallback((title: string, message: string, variant: "info" | "success" | "warning" | "error" = "info") => {
    emitRealtimePayload({
      id: Date.now() + Math.floor(Math.random() * 1000),
      channels: ["ui-feedback"],
      at: new Date().toISOString(),
      toastTitle: title,
      toastMessage: message,
      toastVariant: variant,
    });
  }, []);

  useEffect(() => {
    if (trendRadarDraftHandledRef.current || authLoading || !canCreateArticles) {
      return;
    }

    trendRadarDraftHandledRef.current = true;
    const draft = consumeTrendRadarArticleDraft();
    if (!draft) {
      return;
    }
    let cancelled = false;

    const openNewDraftFromTrend = () => {
      const normalizedCategory = normalizeTrendRadarArticleCategory(draft.recommendedCategory);
      const articleType = getTrendRadarSuggestedArticleType(draft.recommendedCategory);
      const contentType = draft.recommendation === "refresh_existing" ? "Viết lại" : "Viết mới";
      const nextFormData: Partial<Article> = {
        date: new Date().toISOString().split("T")[0],
        penName: canManageArticles ? MANAGER_DEFAULT_PEN_NAME : user?.collaborator?.penName,
        reviewerName: "",
        status: DEFAULT_ARTICLE_STATUS,
        wordCountRange: "",
        title: draft.keyword,
        category: normalizedCategory,
        articleType,
        contentType,
        link: "",
        articleId: "",
        notes: buildTrendRadarPrefillNotes(draft),
      };

      const nextLink = String(nextFormData.link || "").trim();
      const requiresLinkId = isLinkIdRequiredForArticleType(nextFormData.articleType);
      const nextArticleId = requiresLinkId
        ? (extractArticleIdFromLink(nextLink) || String(nextFormData.articleId || "").trim())
        : String(nextFormData.articleId || "").trim();

      setFormData({
        ...nextFormData,
        link: nextLink,
        articleId: nextArticleId,
      });
      setShowModal(true);
      showUiToast(
        "Đã đổ sẵn dữ liệu từ Trend Radar",
        draft.recommendation === "refresh_existing"
          ? "Mình chưa lấy được bài cũ phù hợp, nên đã mở sẵn nháp để bạn cập nhật nhanh."
          : "Mình đã chuẩn bị sẵn form thêm bài với dữ liệu trend để bạn chỉnh nhanh rồi lưu.",
        "success"
      );
    };

    void (async () => {
      if (canManageArticles) {
        await ensureCollaboratorsLoaded();
      }

      if (draft.recommendation === "refresh_existing" && draft.existingCoverageArticleId) {
        try {
          const response = await fetch(`/api/articles?mode=detail&articleId=${draft.existingCoverageArticleId}`, { cache: "no-store" });
          const payload = await response.json().catch(() => ({}));
          if (!cancelled && response.ok && payload.success && payload.article) {
            const existingArticle = buildTrendRadarRefreshArticle(payload.article as Article, draft);
            const nextLink = String(existingArticle.link || "").trim();
            const requiresLinkId = isLinkIdRequiredForArticleType(existingArticle.articleType);
            const nextArticleId = requiresLinkId
              ? (extractArticleIdFromLink(nextLink) || String(existingArticle.articleId || "").trim())
              : String(existingArticle.articleId || "").trim();
            setFormData({
              ...existingArticle,
              link: nextLink,
              articleId: nextArticleId,
            });
            setShowModal(true);
            showUiToast(
              "Đã mở bài cũ nên cập nhật",
              `Mình đã mở "${payload.article.title}" để bạn cập nhật theo tín hiệu trend mới.`,
              "success"
            );
            return;
          }
        } catch {
        }
      }

      if (!cancelled) {
        openNewDraftFromTrend();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, canCreateArticles, canManageArticles, ensureCollaboratorsLoaded, showUiToast, user?.collaborator?.penName]);

  const applyLinkHealthUpdates = useCallback((items: Array<{
    articleId: number;
    status: LinkHealthStatus;
    checkedAt: string;
    slotKey: string | null;
  }>) => {
    if (items.length === 0) {
      return;
    }

    const updates = new Map(items.map((item) => [item.articleId, item]));
    setArticles((prev) => prev.map((article) => {
      const update = updates.get(article.id);
      if (!update) {
        return article;
      }

      return {
        ...article,
        linkHealthStatus: update.status,
        linkHealthCheckedAt: update.checkedAt,
        linkHealthCheckSlot: update.slotKey,
      };
    }));
  }, []);

  const checkVisibleLinks = useCallback(async (force = false) => {
    const visibleItems = [...deferredArticles]
      .filter((article) => article.link && article.link.startsWith("http"))
      .filter((article) => force || !article.linkHealthCheckedAt)
      .sort((left, right) => {
        const priority = (article: Article) => {
          if (!article.linkHealthCheckedAt) return 0;
          if (article.linkHealthStatus === "unknown") return 1;
          return 2;
        };

        const priorityDiff = priority(left) - priority(right);
        if (priorityDiff !== 0) {
          return priorityDiff;
        }

        return parseLinkHealthCheckedAt(left.linkHealthCheckedAt) - parseLinkHealthCheckedAt(right.linkHealthCheckedAt);
      })
      .slice(0, LINK_CHECK_MANUAL_MAX_ITEMS)
      .map((article) => ({
        articleId: article.id,
        url: article.link as string,
      }));

    if (visibleItems.length === 0) {
      showUiToast(
        "Không có link cần kiểm tra",
        deferredArticles.some((article) => article.link && article.link.startsWith("http"))
          ? "Các link đang hiển thị đã có trạng thái kiểm tra. Bạn có thể bấm lại để recheck."
          : "Không có bài nào trong danh sách hiện tại có link hợp lệ để kiểm tra.",
        "info",
      );
      return;
    }

    setLinkCheckLoading(true);
    try {
      const response = await fetch("/api/check-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger: "manual", items: visibleItems }),
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok || !data.success || !Array.isArray(data.items)) {
        throw new Error(data.error || "Không thể kiểm tra trạng thái link.");
      }

      const checkedItems = data.items as Array<{
        articleId: number;
        status: LinkHealthStatus;
        checkedAt: string;
        slotKey: string | null;
      }>;
      applyLinkHealthUpdates(checkedItems);

      const brokenCount = checkedItems.filter((item) => item.status === "broken").length;
      const unknownCount = checkedItems.filter((item) => item.status === "unknown").length;
      const okCount = checkedItems.filter((item) => item.status === "ok").length;
      const pendingVerificationCount = Math.max(0, visibleItems.length - checkedItems.length);

      const toastDetails = [
        brokenCount > 0 ? `${brokenCount} lỗi` : "",
        okCount > 0 ? `${okCount} hoạt động` : "",
        unknownCount > 0 ? `${unknownCount} chưa xác minh` : "",
        pendingVerificationCount > 0 ? `${pendingVerificationCount} đang chờ xác minh nền` : "",
      ].filter(Boolean).join(", ");

      showUiToast(
        "Đã kiểm tra link",
        toastDetails ? `Đã xử lý ${visibleItems.length} link: ${toastDetails}.` : "Không có thay đổi mới về trạng thái link.",
        brokenCount > 0 ? "warning" : "success"
      );
    } catch (error) {
      showUiToast(
        "Kiểm tra link thất bại",
        error instanceof Error ? error.message : "Không thể kiểm tra link lúc này.",
        "error"
      );
    } finally {
      setLinkCheckLoading(false);
    }
  }, [applyLinkHealthUpdates, deferredArticles, showUiToast]);

  const handleSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    const nextSearch = searchInput.trim();
    setSearchInput(nextSearch);
    setAppliedSearch(nextSearch);
    fetchArticles(1, nextSearch, filters);
  };
  const applyFilter = (key: string, val: string) => {
    const f = { ...filters, [key]: val };
    setFilters(f);
    fetchArticles(1, appliedSearch, f);
  };
  const clearFilters = () => {
    const f = createDefaultFilters();
    setFilters(f);
    fetchArticles(1, appliedSearch, f);
  };
  const toggleSelectionMode = () => {
    if (!selectionMode && canManageArticles) {
      void ensureCollaboratorsLoaded();
    }

    setSelectionMode((prev) => {
      const next = !prev;
      if (!next) {
        setSelectedArticleIds([]);
        setBulkReviewerName("");
      }
      return next;
    });
  };
  const toggleArticleSelection = (articleId: number) => {
    setSelectedArticleIds((prev) => (
      prev.includes(articleId)
        ? prev.filter((id) => id !== articleId)
        : [...prev, articleId]
    ));
  };
  const toggleArticleSelectionGroup = (articleIds: number[]) => {
    if (articleIds.length === 0) {
      return;
    }

    const allSelected = articleIds.every((id) => selectedArticleIds.includes(id));
    if (allSelected) {
      setSelectedArticleIds((prev) => prev.filter((id) => !articleIds.includes(id)));
      return;
    }

    setSelectedArticleIds((prev) => Array.from(new Set([...prev, ...articleIds])));
  };
  const toggleSelectVisibleArticles = () => {
    if (selectedVisibleCount === visibleArticleIds.length && visibleArticleIds.length > 0) {
      setSelectedArticleIds((prev) => prev.filter((id) => !visibleArticleIds.includes(id)));
      return;
    }

    setSelectedArticleIds((prev) => Array.from(new Set([...prev, ...visibleArticleIds])));
  };
  const assignReviewerToSelection = async () => {
    const targetReviewerName = canManageArticles ? (bulkReviewerName || null) : (reviewerSelfAssignmentName || null);
    if (!canBulkAssignReviewer || selectedArticleIds.length === 0 || bulkAssigningReviewer) {
      return;
    }
    if (!canManageArticles && !targetReviewerName) {
      showUiToast("Không thể nhận bài", "Tài khoản reviewer hiện chưa có tên hiển thị hợp lệ để nhận bài.", "error");
      return;
    }

    setBulkAssigningReviewer(true);
    try {
      const res = await fetch("/api/articles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "bulk-assign-reviewer",
          ids: selectedArticleIds,
          reviewerName: targetReviewerName,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Không thể phân công người duyệt hàng loạt");
      }

      showUiToast(
        "Đã cập nhật người duyệt",
        targetReviewerName
          ? `Đã gán ${getDisplayedPenName(targetReviewerName)} cho ${data.updatedCount || selectedArticleIds.length} bài.`
          : `Đã bỏ phân công reviewer cho ${data.updatedCount || selectedArticleIds.length} bài.`,
        "success"
      );
      setSelectedArticleIds([]);
      setBulkReviewerName("");
      const currentQuery = articleListQueryRef.current;
      fetchArticles(currentQuery.page || 1, currentQuery.search, currentQuery.filters);
    } catch (error) {
      showUiToast("Cập nhật reviewer thất bại", error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBulkAssigningReviewer(false);
    }
  };
  const activeFilterCount = Object.entries(filters).filter(([k, v]) => v !== "" && k !== "month" && k !== "year").length;
  const currentFilterDeleteCriteria: ArticleDeleteCriteria = {
    search: appliedSearch,
    titleQuery: "",
    penName: filters.penName,
    status: filters.status,
    category: filters.category,
    articleType: filters.articleType,
    contentType: filters.contentType,
    month: filters.month,
    year: filters.year,
    reviewerName: "",
  };
  const effectiveDeleteCriteria = deleteMode === "current_filters" ? currentFilterDeleteCriteria : deleteCriteria;
  const customDeleteCriteriaCount = Object.values(deleteCriteria).filter((value) => value !== "").length;
  const deleteCriteriaSummary = [
    effectiveDeleteCriteria.search ? `Tìm kiếm: ${effectiveDeleteCriteria.search}` : null,
    effectiveDeleteCriteria.titleQuery ? `Tên bài: ${effectiveDeleteCriteria.titleQuery}` : null,
    effectiveDeleteCriteria.penName ? `Bút danh: ${effectiveDeleteCriteria.penName}` : null,
    effectiveDeleteCriteria.status ? `Trạng thái: ${effectiveDeleteCriteria.status}` : null,
    effectiveDeleteCriteria.category ? `Danh mục: ${effectiveDeleteCriteria.category}` : null,
    effectiveDeleteCriteria.articleType ? `Loại bài: ${effectiveDeleteCriteria.articleType}` : null,
    effectiveDeleteCriteria.contentType ? `Nội dung: ${effectiveDeleteCriteria.contentType}` : null,
    effectiveDeleteCriteria.month ? `Tháng: ${effectiveDeleteCriteria.month}` : null,
    effectiveDeleteCriteria.year ? `Năm: ${effectiveDeleteCriteria.year}` : null,
    effectiveDeleteCriteria.reviewerName ? `Người duyệt: ${effectiveDeleteCriteria.reviewerName}` : null,
  ].filter(Boolean) as string[];

  const analyzeImportFile = useCallback(async (file: File, sheetName?: string, headerRowNumber?: number) => {
    setImporting(true);
    setImportError("");
    setImportDryRun(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (sheetName) fd.append("sheetName", sheetName);
      if (headerRowNumber) fd.append("headerRowNumber", String(headerRowNumber));

      const res = await fetch("/api/articles/import/analyze", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Không thể phân tích file Excel");
      }

      setImportAnalysis(data);
      setImportSheetName(data.sheetName);
      setImportHeaderRowNumber(data.headerRowNumber);
      const initialMapping: Record<string, string> = {};
      for (const [columnKey, field] of Object.entries(data.mapping || {})) {
        if (field) initialMapping[columnKey] = field as string;
      }
      setImportMapping(initialMapping);
      setImportStep(2);
    } catch (error) {
      const message = String(error);
      setImportError(message);
      setShowImportWizard(false);
      alert("❌ " + message);
    } finally {
      setImporting(false);
    }
  }, []);

  const updateImportMapping = (columnKey: string, field: string) => {
    setImportDryRun(null);
    setImportMapping(prev => {
      const next = { ...prev };
      for (const [key, currentField] of Object.entries(next)) {
        if (key !== columnKey && currentField === field && field) {
          delete next[key];
        }
      }
      if (field) next[columnKey] = field;
      else delete next[columnKey];
      return next;
    });
  };

  const resolveImportPreviewValue = (row: ImportAnalyzeResult["sampleRows"][number], field: string) => {
    const column = importAnalysis?.columns.find((item: ImportColumnAnalysis) => importMapping[item.key] === field);
    if (!column) return "—";
    return row.values[column.key] || "—";
  };

  const getImportFieldLabel = (fieldValue: string) =>
    IMPORT_FIELD_OPTIONS.find((option) => option.value === fieldValue)?.label || fieldValue;

  const importantFieldInsights = IMPORTANT_IMPORT_FIELDS.map((field) => {
    const mappedColumnKey = Object.entries(importMapping).find(([, mappedField]) => mappedField === field)?.[0];
    const mappedColumn = importAnalysis?.columns.find((column) => column.key === mappedColumnKey);
    return {
      field,
      label: getImportFieldLabel(field),
      mapped: Boolean(mappedColumnKey),
      columnLabel: mappedColumn ? `${mappedColumn.letter} • ${mappedColumn.header}` : "Chưa map",
    };
  });

  const mappedPreviewFields = IMPORT_FIELD_OPTIONS
    .filter(option => option.value && mappedFields.includes(option.value))
    .sort((a, b) => {
      const priority = ["articleId", "date", "title", "penName", "status", "link", "reviewerName", "category", "articleType", "contentType", "notes"];
      const left = priority.indexOf(a.value);
      const right = priority.indexOf(b.value);
      return (left === -1 ? 999 : left) - (right === -1 ? 999 : right);
    });

  const openDeleteTool = () => {
    void ensureCollaboratorsLoaded();
    const hasCurrentFilters = appliedSearch.trim() !== "" || activeFilterCount > 0;
    setDeleteMode(hasCurrentFilters ? "current_filters" : "custom");
    setDeleteCriteria({
      ...EMPTY_DELETE_CRITERIA,
      search: appliedSearch,
      penName: filters.penName,
      status: filters.status,
      category: filters.category,
      articleType: filters.articleType,
      contentType: filters.contentType,
      month: filters.month,
      year: filters.year,
    });
    setDeletePreview(null);
    setDeleteError("");
    setShowDeleteModal(true);
  };

  const openArticleModal = (nextFormData: Partial<Article>) => {
    if (canManageArticles) {
      void ensureCollaboratorsLoaded();
    }
    const nextLink = String(nextFormData.link || "").trim();
    const requiresLinkId = isLinkIdRequiredForArticleType(nextFormData.articleType);
    const nextArticleId = requiresLinkId
      ? (extractArticleIdFromLink(nextLink) || String(nextFormData.articleId || "").trim())
      : String(nextFormData.articleId || "").trim();
    setFormData({
      ...nextFormData,
      link: nextLink,
      articleId: nextArticleId,
    });
    setShowModal(true);
  };

  const toggleFilters = () => {
    if (!showFilters && canManageArticles) {
      void ensureCollaboratorsLoaded();
    }
    setShowFilters((prev) => !prev);
  };

  const handleDeleteModeChange = (mode: "all" | "current_filters" | "custom") => {
    setDeleteMode(mode);
    setDeletePreview(null);
    setDeleteError("");
  };

  const updateDeleteCriteria = (key: keyof ArticleDeleteCriteria, value: string) => {
    setDeleteCriteria((prev) => ({
      ...prev,
      [key]: value,
    }));
    setDeletePreview(null);
    setDeleteError("");
  };

  const applyDeletePreset = (preset: "drafts_this_month" | "needs_fix" | "clear") => {
    const now = new Date();
    if (preset === "clear") {
      setDeleteCriteria(EMPTY_DELETE_CRITERIA);
      setDeletePreview(null);
      setDeleteError("");
      return;
    }

    if (preset === "drafts_this_month") {
      setDeleteMode("custom");
      setDeleteCriteria({
        ...EMPTY_DELETE_CRITERIA,
        status: "Draft",
        month: String(now.getMonth() + 1),
        year: String(now.getFullYear()),
      });
    }

    if (preset === "needs_fix") {
      setDeleteMode("custom");
      setDeleteCriteria({
        ...EMPTY_DELETE_CRITERIA,
        status: "NeedsFix",
      });
    }

    setDeletePreview(null);
    setDeleteError("");
  };

  const requestDeletePreview = async (mode = deleteMode) => {
    setDeleteLoading(true);
    setDeleteError("");
    try {
      const criteria = mode === "current_filters" ? currentFilterDeleteCriteria : deleteCriteria;
      if (mode !== "all" && Object.values(criteria).every((value) => value === "")) {
        throw new Error("Chưa có tiêu chí nào để xem trước. Hãy chọn xóa toàn bộ hoặc nhập điều kiện lọc.");
      }
      const res = await fetch("/api/articles", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "preview",
          scope: mode,
          ...criteria,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Không thể xem trước dữ liệu xóa");
      }
      setDeletePreview(data);
    } catch (error) {
      const message = String(error);
      setDeleteError(message);
      setDeletePreview(null);
    } finally {
      setDeleteLoading(false);
    }
  };

  const executeDelete = async () => {
    if (!deletePreview) {
      setDeleteError("Hãy xem trước dữ liệu trước khi xóa.");
      return;
    }
    if (deletePreview.total === 0) {
      setDeleteError("Không có bài viết nào khớp để xóa.");
      return;
    }
    const confirmed = window.confirm(
      `Xác nhận xóa ${deletePreview.total} bài viết?\n\n` +
      `Comment: ${deletePreview.related.comments}\n` +
      `Review: ${deletePreview.related.reviews}\n` +
      `Notification: ${deletePreview.related.notifications}\n` +
      `Nhuận bút sẽ được reset: ${deletePreview.related.payments > 0 ? "Có" : "Không"}`
    );
    if (!confirmed) return;

    setDeleteExecuting(true);
    setDeleteError("");
    showUiToast("Đang xóa dữ liệu", `Hệ thống đang xử lý ${deletePreview.total} bài viết.`, "info");
    try {
      const criteria = deleteMode === "current_filters" ? currentFilterDeleteCriteria : deleteCriteria;
      const res = await fetch("/api/articles", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          scope: deleteMode,
          ...criteria,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(buildApiErrorMessage(data, "Không thể xóa dữ liệu"));
      }
      setShowDeleteModal(false);
      setDeletePreview(null);
      showUiToast(
        "Đã xóa bài viết",
        data.sheetSyncWarnings?.length
          ? `Đã xóa ${data.deletedCount} bài viết. Có ${data.sheetSyncWarnings.length} cảnh báo đồng bộ Google Sheet.`
          : data.backgroundSyncQueued
            ? `Đã xóa ${data.deletedCount} bài viết. Google Sheet đang đồng bộ nền.`
          : `Đã xóa ${data.deletedCount} bài viết và reset dữ liệu nhuận bút liên quan.`,
        data.sheetSyncWarnings?.length ? "warning" : data.backgroundSyncQueued ? "info" : "success"
      );
      fetchArticles(1, appliedSearch, filters);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDeleteError(message);
      showUiToast("Xóa thất bại", message, "error");
    } finally {
      setDeleteExecuting(false);
    }
  };

  const deleteSingleArticle = async (article: Article) => {
    if (deletingArticleIds.includes(article.id)) return;

    if (!article.canDelete && !canManageArticles) {
      showUiToast("Không thể xóa bài", "Bạn chỉ có thể xóa bài do chính mình tạo.", "error");
      return;
    }

    const confirmed = window.confirm(`Xóa bài "${article.title}"?\n\nHệ thống cũng sẽ xóa comment/review liên quan và reset các dòng nhuận bút bị ảnh hưởng để tránh lệch dữ liệu.`);
    if (!confirmed) return;

    setDeletingArticleIds((prev) => (prev.includes(article.id) ? prev : [...prev, article.id]));
    showUiToast("Đang xóa bài viết", `Đang xử lý "${article.title}".`, "info");
    try {
      const res = await fetch(`/api/articles?id=${article.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(buildApiErrorMessage(data, "Không thể xóa bài viết"));
      }
      setArticles((prev) => prev.filter((item) => item.id !== article.id));
      setPagination((prev) => {
        const nextTotal = Math.max(0, Number(prev.total || 0) - 1);
        return {
          ...prev,
          total: nextTotal,
          totalPages: Math.max(1, Math.ceil(nextTotal / ARTICLE_PAGE_SIZE)),
        };
      });
      showUiToast(
        "Đã xóa bài viết",
        data.sheetSyncWarnings?.length
          ? `Đã xóa "${article.title}". Google Sheet còn ${data.sheetSyncWarnings.length} cảnh báo cần kiểm tra.`
          : data.backgroundSyncQueued
            ? `Đã xóa "${article.title}". Google Sheet đang đồng bộ nền.`
          : `Đã xóa "${article.title}".`,
        data.sheetSyncWarnings?.length ? "warning" : data.backgroundSyncQueued ? "info" : "success"
      );
      const currentQuery = articleListQueryRef.current;
      fetchArticles(currentQuery.page || 1, currentQuery.search, currentQuery.filters);
    } catch (error) {
      showUiToast("Xóa bài thất bại", error instanceof Error ? error.message : String(error), "error");
    } finally {
      setDeletingArticleIds((prev) => prev.filter((id) => id !== article.id));
    }
  };

  const fetchComments = useCallback(async (articleId: number) => {
    setCommentsLoading(true);
    try {
      const res = await fetch(`/api/articles/comments?articleId=${articleId}`, { cache: "no-store" });
      const data = await res.json();
      if (data.success) {
        const nextComments = Array.isArray(data.data) ? data.data : [];
        setComments(nextComments);
        setArticles((prev) =>
          prev.map((article) =>
            article.id === articleId
              ? { ...article, commentCount: nextComments.length, unreadCommentCount: 0 }
              : article
          )
        );
      } else {
        alert("❌ " + (data.error || "Không tải được bình luận"));
      }
    } catch (error) {
      alert("❌ " + String(error));
    } finally {
      setCommentsLoading(false);
    }
  }, []);

  const refreshArticlesView = useCallback(() => {
    if (loading) {
      return;
    }

    if (typeof window === "undefined") {
      const currentQuery = articleListQueryRef.current;
      fetchArticles(currentQuery.page || 1, currentQuery.search, currentQuery.filters, { background: true });
      if (commentArticle) {
        fetchComments(commentArticle.id);
      }
      return;
    }

    if (articlesRealtimeRefreshTimerRef.current) {
      window.clearTimeout(articlesRealtimeRefreshTimerRef.current);
    }

    articlesRealtimeRefreshTimerRef.current = window.setTimeout(() => {
      articlesRealtimeRefreshTimerRef.current = null;
      const currentQuery = articleListQueryRef.current;
      fetchArticles(currentQuery.page || 1, currentQuery.search, currentQuery.filters, { background: true });
      if (commentArticle) {
        fetchComments(commentArticle.id);
      }
    }, 600);
  }, [commentArticle, fetchArticles, fetchComments, loading]);

  useRealtimeRefresh(["articles"], refreshArticlesView);

  const openComments = (article: Article) => {
    setCommentArticle(article);
    setCommentContent("");
    setCommentAttachment("");
    setShowCommentsModal(true);
    fetchComments(article.id);
  };

  const submitComment = async () => {
    if (!commentArticle || !commentContent.trim()) return;
    setCommentSaving(true);
    try {
      const res = await fetch("/api/articles/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          articleId: commentArticle.id,
          content: commentContent.trim(),
          attachmentUrl: commentAttachment.trim() || null,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        alert("❌ " + (data.error || "Không gửi được bình luận"));
        return;
      }
      setCommentContent("");
      setCommentAttachment("");
      await fetchComments(commentArticle.id);
    } catch (error) {
      alert("❌ " + String(error));
    } finally {
      setCommentSaving(false);
    }
  };

  const handleSave = async () => {
    if (savingArticle) return;
    if (!formData.title || !formData.penName || !formData.date) {
      alert("❌ Vui lòng nhập đủ tiêu đề, bút danh và ngày thực hiện.");
      return;
    }
    if (!normalizeWordCountRangeValue(formData.wordCountRange)) {
      alert("❌ Vui lòng chọn độ dài bài viết để đồng bộ đúng với file Excel gốc.");
      return;
    }

    const normalizedLink = String(formData.link || "").trim();
    const derivedArticleId = extractArticleIdFromLink(normalizedLink);
    const currentArticleId = String(formData.articleId || "").trim();
    const requiresLinkId = isLinkIdRequiredForArticleType(formData.articleType);
    const isEditing = Boolean(formData.id);
    if (!canManageArticles && !isEditing && !normalizedLink) {
      alert("❌ CTV phải dán link bài viết trước khi lưu bài mới.");
      return;
    }
    if (requiresLinkId && (((!canManageArticles && !isEditing) || (normalizedLink && !currentArticleId)))) {
      if (!derivedArticleId) {
        alert("❌ Link bài viết phải có đúng 6 chữ số ID ở cuối đường dẫn để hệ thống nhận diện.");
        return;
      }
    }

    try {
      setSavingArticle(true);
      const res = await fetch("/api/articles", {
        method: formData.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          articleId: requiresLinkId ? (derivedArticleId || currentArticleId) : (derivedArticleId || currentArticleId || undefined),
          link: normalizedLink,
          wordCountRange: normalizeWordCountRangeValue(formData.wordCountRange),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Không thể lưu bài viết");
      }

      setShowModal(false);
        setFormData({});
        if (data.article) {
          const savedArticle = data.article as Article;
          mergeSavedArticleIntoList(savedArticle, isEditing);
          if (!isEditing && canRegisterContentWork(savedArticle)) {
            setContentWorkPromptArticle(savedArticle);
            setContentWorkBannerArticle(savedArticle);
          }
        } else {
        const currentQuery = articleListQueryRef.current;
        fetchArticles(currentQuery.page || 1, currentQuery.search, currentQuery.filters);
      }
      if (data.backgroundSyncQueued) {
        const savedTitle = String(data.article?.title || formData.title || "bài viết");
        showUiToast(
          isEditing ? "Đã cập nhật bài viết" : "Đã lưu bài viết",
          `"${savedTitle}" đã lưu. Google Sheet đang đồng bộ nền.`,
          "info"
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/Failed to fetch/i.test(message)) {
        alert("❌ Không kết nối được tới máy chủ trong lúc lưu bài viết.\n\nKhả năng cao bài chưa kịp phản hồi hoặc Google Sheet đang chậm. Hãy tải lại trang để kiểm tra bài đã được lưu chưa, rồi thử lại nếu cần.");
      } else {
        alert("❌ " + message);
      }
    } finally {
      setSavingArticle(false);
    }
  };

  const handleMoveToNextMonth = async () => {
    if (!formData.id || movingArticleToNextMonth || savingArticle) return;
    if (formData.authorBucket === "editorial") {
      showUiToast("Không thể chuyển tháng", "Bài của Biên tập/Admin không dùng tính năng chuyển sang tháng sau.", "warning");
      return;
    }

    const articleTitle = String(formData.title || "bài viết");
    const confirmed = window.confirm(`Chuyển "${articleTitle}" sang tháng sau và nhắc CTV đăng ký lại trong Content Work?`);
    if (!confirmed) return;

    try {
      setMovingArticleToNextMonth(true);
      const res = await fetch("/api/articles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: formData.id,
          action: "move-to-next-month",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Không thể chuyển bài viết sang tháng sau");
      }

      setShowModal(false);
      setFormData({});
      if (data.article) {
        mergeSavedArticleIntoList(data.article as Article, true);
      } else {
        const currentQuery = articleListQueryRef.current;
        fetchArticles(currentQuery.page || 1, currentQuery.search, currentQuery.filters);
      }

      const movedToMonthLabel = String(data.movedToMonthLabel || "tháng sau");
      if (data.registrationReminderQueued) {
        showUiToast(
          "Đã chuyển bài sang tháng sau",
          `"${articleTitle}" đã chuyển sang ${movedToMonthLabel}. CTV sẽ nhận popup "Đăng ký lại bài trong Content Work".`,
          "success"
        );
      } else {
        showUiToast(
          "Đã chuyển bài sang tháng sau",
          `"${articleTitle}" đã chuyển sang ${movedToMonthLabel}, nhưng hệ thống chưa tìm thấy tài khoản CTV để gửi popup nhắc việc.`,
          "warning"
        );
      }
    } catch (error) {
      showUiToast("Chuyển bài thất bại", error instanceof Error ? error.message : String(error), "error");
    } finally {
      setMovingArticleToNextMonth(false);
    }
  };

  const handleRegisterContentWork = async (article: Article, force = false) => {
    if (registeringContentWork) return;

    try {
      setRegisteringContentWork(true);
      setRegisteringContentWorkArticleId(article.id);
      const res = await fetch("/api/content-work", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articleId: article.id, force }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(data.error || "Không thể đăng ký Content Work");
      }

      const nextStatus = String(data.registration?.status || (data.alreadyCompleted ? "completed" : "queued")) as Article["contentWorkStatus"];
      const nextStatusLabel = String(
        data.registration?.statusLabel
        || (data.alreadyCompleted ? "Hoàn thành" : "Đang chờ")
      );
      setArticles((prev) => prev.map((item) => (
        item.id === article.id
          ? { ...item, contentWorkStatus: nextStatus, contentWorkStatusLabel: nextStatusLabel }
          : item
      )));
      setFormData((prev) => Number(prev.id) === article.id
        ? { ...prev, contentWorkStatus: nextStatus, contentWorkStatusLabel: nextStatusLabel }
        : prev);

      if (data.alreadyCompleted) {
        showUiToast("Content Work đã hoàn thành", `"${article.title}" đã được đăng ký Content Work trước đó.`, "info");
      } else if (data.alreadyRunning) {
        showUiToast("Đang xử lý Content Work", `"${article.title}" đang được hệ thống xử lý ở nền.`, "info");
      } else {
        showUiToast("Đã xếp hàng Content Work", `"${article.title}" đang được gửi form và điền link ở nền.`, "success");
      }

      setContentWorkPromptArticle(null);
      setContentWorkBannerArticle(null);
    } catch (error) {
      showUiToast("Đăng ký Content Work thất bại", error instanceof Error ? error.message : String(error), "error");
    } finally {
      setRegisteringContentWork(false);
      setRegisteringContentWorkArticleId(null);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setImportFile(file);
    setImportStep(1);
    setImportAnalysis(null);
    setImportMapping({});
    setImportResult(null);
    setImportSheetName("");
    setImportHeaderRowNumber(1);
    setImportError("");
    setImportDryRun(null);
    setShowImportWizard(true);
    await analyzeImportFile(file);
    e.target.value = "";
  };

  const triggerImportPicker = () => {
    if (importing) return;
    const input = importInputRef.current;
    if (!input) return;
    input.value = "";
    input.click();
  };

  const runImportDryRun = async () => {
    if (!importFile) return;
    if (missingRequiredImportFields.length > 0 || duplicateMappedFields.length > 0) return;

    setImportDryRunLoading(true);
    setImportError("");
    try {
      const fd = new FormData();
      fd.append("file", importFile);
      fd.append("mapping", JSON.stringify(importMapping));
      fd.append("sheetName", importSheetName);
      fd.append("headerRowNumber", String(importHeaderRowNumber));
      fd.append("replaceExisting", String(replaceExistingImport));
      fd.append("dryRun", "true");
      const res = await fetch("/api/articles/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data.success || !data.dryRun) {
        throw new Error(data.error || "Không thể tạo preview import");
      }
      setImportDryRun(data as ImportDryRunResult);
    } catch (err) {
      const message = String(err);
      setImportError(message);
      alert("❌ Lỗi preview import: " + message);
    } finally {
      setImportDryRunLoading(false);
    }
  };

  const executeImport = async () => {
    if (!importFile) return;
    if (missingRequiredImportFields.length > 0) {
      alert(`❌ Thiếu mapping cho các trường bắt buộc: ${missingRequiredImportFields.join(", ")}`);
      return;
    }
    if (duplicateMappedFields.length > 0) {
      alert(`❌ Có trường đang bị map trùng: ${Array.from(new Set(duplicateMappedFields)).join(", ")}`);
      return;
    }
    setImporting(true);
    setImportError("");
    try {
      const fd = new FormData();
      fd.append("file", importFile);
      fd.append("mapping", JSON.stringify(importMapping));
      fd.append("sheetName", importSheetName);
      fd.append("headerRowNumber", String(importHeaderRowNumber));
      fd.append("replaceExisting", String(replaceExistingImport));
      const res = await fetch("/api/articles/import", { method: "POST", body: fd });
      const data = await res.json();
      if (res.ok && data.success) {
        setImportResult(data);
        setImportStep(3);
        fetchArticles(1, appliedSearch, filters);
      } else {
        throw new Error(data.error || "Import thất bại");
      }
    } catch (err) {
      const message = String(err);
      setImportError(message);
      alert("❌ Lỗi: " + message);
    }
    setImporting(false);
  };

  const openGoogleSyncModal = () => {
    setGoogleSyncMonth(filters.month || "");
    setGoogleSyncYear(filters.year || "");
    setGoogleSyncResult(null);
    setGoogleSyncError("");
    setShowGoogleSyncModal(true);
  };

  const closeGoogleSyncModal = () => {
    if (googleSyncLoading) return;
    setShowGoogleSyncModal(false);
  };


  const compareArticleRows = useCallback((left: Article, right: Article) => {
    const updatedCompare = String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
    if (updatedCompare !== 0) return updatedCompare;

    const dateCompare = String(right.date || "").localeCompare(String(left.date || ""));
    if (dateCompare !== 0) return dateCompare;

    return Number(right.id || 0) - Number(left.id || 0);
  }, []);

  const doesArticleMatchCurrentView = useCallback((article: Article) => {
    const normalizedSearch = foldSearchText(appliedSearch);
    if (normalizedSearch) {
      const collaborator = collaborators.find((item) => item.penName === article.penName);
      const haystack = [
        article.title,
        article.articleId,
        article.penName,
        article.notes,
        collaborator?.name,
        collaborator?.email,
      ]
        .filter((value) => value != null);

      if (!haystack.some((value) => matchesLooseSearch(value, normalizedSearch))) {
        return false;
      }
    }

    if (isWriter && user?.collaborator?.penName && article.penName !== user.collaborator.penName) {
      return false;
    }
    if (isReviewer && !articleMatchesReviewerScope(article)) {
      return false;
    }
    if (canManageArticles && filters.penName && article.penName !== filters.penName) {
      return false;
    }
    if (filters.status) {
      const matchesStatus = isApprovedArticleStatusFilterValue(filters.status)
        ? isApprovedArticleStatus(article.status)
        : article.status === filters.status;
      if (!matchesStatus) {
        return false;
      }
    }
    if (filters.category && article.category !== filters.category) {
      return false;
    }
    if (filters.articleType && article.articleType !== filters.articleType) {
      return false;
    }
    if (filters.contentType && article.contentType !== filters.contentType) {
      return false;
    }
    if (filters.year && !String(article.date || "").startsWith(`${filters.year}-`)) {
      return false;
    }
    if (filters.month) {
      const expectedMonth = `-${filters.month.padStart(2, "0")}-`;
      if (!String(article.date || "").includes(expectedMonth)) {
        return false;
      }
    }

    return true;
  }, [appliedSearch, articleMatchesReviewerScope, canManageArticles, collaborators, filters, isReviewer, isWriter, user]);

  const mergeSavedArticleIntoList = useCallback((savedArticle: Article, isEditing: boolean) => {
    const shouldBeVisible = doesArticleMatchCurrentView(savedArticle);
    const wasVisible = articles.some((article) => article.id === savedArticle.id);

    if ((pagination.page || 1) === 1 || wasVisible) {
      setArticles((prev) => {
        const withoutCurrent = prev.filter((article) => article.id !== savedArticle.id);
        if (!shouldBeVisible) {
          return withoutCurrent;
        }

        return [savedArticle, ...withoutCurrent]
          .sort(compareArticleRows)
          .slice(0, ARTICLE_PAGE_SIZE);
      });
    }

    setPagination((prev) => {
      const total = Number(prev.total || 0);
      let nextTotal = total;

      if (!isEditing && shouldBeVisible) {
        nextTotal += 1;
      } else if (isEditing && wasVisible && !shouldBeVisible) {
        nextTotal = Math.max(0, nextTotal - 1);
      }

      return {
        ...prev,
        total: nextTotal,
        totalPages: Math.ceil(nextTotal / ARTICLE_PAGE_SIZE),
      };
    });
  }, [articles, compareArticleRows, doesArticleMatchCurrentView, pagination.page]);

  const focusSyncedArticles = (month: number, year: number) => {
    const nextFilters: ArticleFilters = {
      ...createCurrentMonthFilters(),
      month: String(month),
      year: String(year),
    };

    setSearchInput("");
    setAppliedSearch("");
    setFilters(nextFilters);
    setPagination((prev) => ({ ...prev, page: 1 }));
    fetchArticles(1, "", nextFilters);
  };

  const executeGoogleSheetSync = async (options?: { month?: string; year?: string; closeModalOnSuccess?: boolean }) => {
    const selectedMonth = options?.month ?? googleSyncMonth;
    const selectedYear = options?.year ?? googleSyncYear;
    const shouldShowToast = Boolean(options?.closeModalOnSuccess) || !showGoogleSyncModal;

    if ((selectedMonth && !selectedYear) || (!selectedMonth && selectedYear)) {
      setGoogleSyncError("Hãy chọn đủ cả tháng và năm, hoặc để trống để dùng tab mới nhất.");
      return;
    }

    setGoogleSyncLoading(true);
    setGoogleSyncError("");
    try {
      const res = await fetch("/api/articles/google-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month: selectedMonth ? Number(selectedMonth) : undefined,
          year: selectedYear ? Number(selectedYear) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Không thể đồng bộ Google Sheet");
      }

      const syncResult = data as GoogleSheetSyncResult;
      setGoogleSyncResult(syncResult);
      setGoogleSyncMonth(String(syncResult.month));
      setGoogleSyncYear(String(syncResult.year));
      focusSyncedArticles(syncResult.month, syncResult.year);
      if (shouldShowToast) {
        showUiToast(
          "Đã đồng bộ Google Sheet",
          `Đã đồng bộ dữ liệu tháng ${syncResult.month}/${syncResult.year}.`,
          "success"
        );
      }
      if (options?.closeModalOnSuccess) {
        setShowGoogleSyncModal(false);
      }
    } catch (error) {
      setGoogleSyncError(String(error));
      setGoogleSyncResult(null);
      if (shouldShowToast) {
        showUiToast(
          "Đồng bộ thất bại",
          error instanceof Error ? error.message : String(error),
          "error"
        );
      }
    } finally {
      setGoogleSyncLoading(false);
    }
  };



  const getCommentBadgeLabel = (article: Article) => {
    const unreadCount = Number(article.unreadCommentCount || 0);
    const totalCount = Number(article.commentCount || 0);
    const count = unreadCount > 0 ? unreadCount : totalCount;
    if (count <= 0) return "";
    return count > 9 ? "9+" : String(count);
  };

  const getCommentButtonTitle = (article: Article) => {
    const unreadCount = Number(article.unreadCommentCount || 0);
    const totalCount = Number(article.commentCount || 0);

    if (unreadCount > 0) {
      return `Bình luận (${unreadCount} chưa đọc, ${totalCount} tổng cộng)`;
    }

    if (totalCount > 0) {
      return `Bình luận (${totalCount} bình luận)`;
    }

    return "Bình luận";
  };

  const statusBadge = (s: string) => {
    const map: Record<string, { bg: string; text: string; icon: string }> = {
      Published: { bg: "rgba(16, 185, 129, 0.1)", text: "#10b981", icon: "check_circle" },
      Approved: { bg: "rgba(16, 185, 129, 0.1)", text: "#10b981", icon: "check_circle" },
      Draft: { bg: "rgba(255, 255, 255, 0.05)", text: "var(--text-muted)", icon: "edit_note" },
      Submitted: { bg: "rgba(59, 130, 246, 0.1)", text: "#3b82f6", icon: "outbox" },
      Reviewing: { bg: "rgba(168, 85, 247, 0.1)", text: "#a855f7", icon: "find_in_page" },
      Rejected: { bg: "rgba(239, 68, 68, 0.1)", text: "#f87171", icon: "cancel" },
      NeedsFix: { bg: "rgba(249, 115, 22, 0.1)", text: "#f97316", icon: "warning" }
    };
    const labels: Record<string, string> = { NeedsFix: "Sửa lỗi", Published: "Đã duyệt", Draft: "Bản nháp", Submitted: "Chờ duyệt", Reviewing: "Đang duyệt", Rejected: "Từ chối", Approved: "Đã duyệt" };
    const style = map[s] || map.Draft;
    return (
      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, maxWidth: "100%", padding: "4px 10px", borderRadius: 8, background: style.bg, color: style.text, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{style.icon}</span>
        {labels[s] || s}
      </span>
    );
  };

  const articleTypeBadge = (articleType: string) => {
    const normalized = articleType.toLowerCase();
    let style = {
      color: "var(--accent-blue)",
      background: "rgba(59, 130, 246, 0.12)",
      border: "1px solid rgba(59, 130, 246, 0.14)",
    };

    if (normalized.includes("gia dụng") || normalized.includes("gia dung")) {
      style = {
        color: "#2563eb",
        background: "rgba(59, 130, 246, 0.1)",
        border: "1px solid rgba(59, 130, 246, 0.14)",
      };
    } else if (normalized.includes("ict")) {
      style = {
        color: "#0f766e",
        background: "rgba(20, 184, 166, 0.12)",
        border: "1px solid rgba(20, 184, 166, 0.16)",
      };
    } else if (normalized.includes("mô tả") || normalized.includes("mo ta")) {
      style = {
        color: "#c2410c",
        background: "rgba(249, 115, 22, 0.12)",
        border: "1px solid rgba(249, 115, 22, 0.16)",
      };
    } else if (normalized.includes("review") || normalized.includes("dịch") || normalized.includes("dich")) {
      style = {
        color: "#7c3aed",
        background: "rgba(168, 85, 247, 0.12)",
        border: "1px solid rgba(168, 85, 247, 0.16)",
      };
    } else if (normalized.includes("thủ thuật") || normalized.includes("thu thuat")) {
      style = {
        color: "#b45309",
        background: "rgba(245, 158, 11, 0.14)",
        border: "1px solid rgba(245, 158, 11, 0.18)",
      };
    }

    return (
      <span
        title={articleType}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          maxWidth: "100%",
          fontSize: 9,
          fontWeight: 800,
          color: style.color,
          background: style.background,
          border: style.border,
          padding: "5px 8px",
          borderRadius: 999,
          textTransform: "uppercase",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          lineHeight: 1.2,
        }}
      >
        {articleType}
      </span>
    );
  };

  const linkBadge = (article: Article) => {
    if (!article.link) {
      return <span style={{ color: "rgba(0,0,0,0.2)" }}>—</span>;
    }

    if (article.linkHealthStatus === "broken") {
      return (
        <span title="Link lỗi" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--danger)" }}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>link_off</span>
        </span>
      );
    }

    if (article.linkHealthStatus === "ok") {
      return (
        <span title="Link hoạt động" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--success)" }}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>link</span>
        </span>
      );
    }

    if (article.linkHealthStatus === "unknown") {
      return (
        <span title="Chưa xác minh được link. Bạn có thể bấm 'Kiểm tra link' khi cần." style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--accent-orange)" }}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>help_center</span>
        </span>
      );
    }

    return (
      <span title="Đang chờ kiểm tra trạng thái link" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--accent-orange)" }}>
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>pending</span>
      </span>
    );
  };

  const authorBucketBadge = (article: Article) => {
    const isEditorialArticle = resolveAuthorBucket(article) === "editorial";
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          width: "fit-content",
          padding: "4px 8px",
          borderRadius: 999,
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: isEditorialArticle ? "#c2410c" : "#1d4ed8",
          background: isEditorialArticle ? "rgba(249, 115, 22, 0.12)" : "rgba(59, 130, 246, 0.12)",
          border: isEditorialArticle ? "1px solid rgba(249, 115, 22, 0.18)" : "1px solid rgba(59, 130, 246, 0.18)",
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 12 }}>
          {isEditorialArticle ? "shield_person" : "groups"}
        </span>
        {isEditorialArticle ? "Biên tập/Admin" : "CTV"}
      </span>
    );
  };

  const showSplitArticleSections = shouldShowSplitArticleSections;
  const ctvArticles = articles.filter((article) => resolveAuthorBucket(article) !== "editorial");
  const editorialArticles = articles.filter((article) => resolveAuthorBucket(article) === "editorial");
  const assignedReviewArticles = isReviewer
    ? articles.filter((article) => articleAssignedToReviewer(article))
    : [];
  const availableReviewArticles = isReviewer
    ? articles.filter((article) => articleAvailableForReviewerPickup(article))
    : [];
  const articleTableMinWidth = showSplitArticleSections ? 1020 : 1080;
  const articleSections = isReviewer
    ? [
      {
        key: "assigned",
        title: "Bài đã giao cho bạn",
        icon: "assignment_ind",
        accent: "#2563eb",
        background: "linear-gradient(135deg, rgba(59, 130, 246, 0.12), rgba(37, 99, 235, 0.04))",
        rows: assignedReviewArticles,
        emptyMessage: "Chưa có bài nào đã giao cho bạn.",
        allowBulkAssign: false,
      },
      {
        key: "available",
        title: "Bài chờ nhận duyệt",
        icon: "playlist_add_check_circle",
        accent: "#0f766e",
        background: "linear-gradient(135deg, rgba(20, 184, 166, 0.12), rgba(15, 118, 110, 0.04))",
        rows: availableReviewArticles,
        emptyMessage: "Chưa có bài nào đang chờ nhận duyệt.",
        allowBulkAssign: canBulkAssignReviewer,
      },
    ] as const
    : [
      {
        key: "ctv",
        title: "Bài của CTV",
        icon: "groups",
        accent: "#2563eb",
        background: "linear-gradient(135deg, rgba(59, 130, 246, 0.12), rgba(37, 99, 235, 0.04))",
        rows: ctvArticles,
        emptyMessage: "Chưa có bài nào ở nhóm CTV.",
        allowBulkAssign: canBulkAssignReviewer,
      },
      {
        key: "editorial",
        title: "Bài của Biên tập/Admin",
        icon: "shield_person",
        accent: "#f97316",
        background: "linear-gradient(135deg, rgba(249, 115, 22, 0.12), rgba(234, 88, 12, 0.04))",
        rows: editorialArticles,
        emptyMessage: "Chưa có bài nào ở nhóm Biên tập/Admin.",
        allowBulkAssign: false,
      },
    ] as const;
  const visibleArticleIds = (isReviewer ? availableReviewArticles : ctvArticles).map((article) => article.id);
  const selectedVisibleCount = visibleArticleIds.filter((id) => selectedArticleIds.includes(id)).length;

  const renderArticleTable = (rows: Article[], emptyMessage: string, allowBulkAssign = false) => {
    const rowIds = rows.map((article) => article.id);
    const areAllRowsSelected = rowIds.length > 0 && rowIds.every((id) => selectedArticleIds.includes(id));

    return (
    <div style={{ overflowX: "auto", position: "relative", zIndex: 0 }}>
      <table style={{ width: "100%", minWidth: articleTableMinWidth, borderCollapse: "collapse", textAlign: "left", tableLayout: "fixed" }}>
        <colgroup>
          {allowBulkAssign && selectionMode && <col style={{ width: 44 }} />}
          <col style={{ width: 72 }} />
          <col style={{ width: 92 }} />
          <col />
          <col style={{ width: 132 }} />
          <col style={{ width: 92 }} />
          <col style={{ width: 118 }} />
          <col style={{ width: 132 }} />
          <col style={{ width: 58 }} />
          <col style={{ width: 142 }} />
        </colgroup>
        <thead style={{ pointerEvents: "none" }}>
          <tr style={{ background: "rgba(248, 250, 252, 0.95)", backdropFilter: "blur(12px)", borderBottom: "1px solid var(--glass-border)" }}>
            {allowBulkAssign && selectionMode && (
              <th style={{ padding: "14px 10px", textAlign: "center", pointerEvents: "auto" }}>
                <input
                  type="checkbox"
                  checked={areAllRowsSelected}
                  onChange={() => toggleArticleSelectionGroup(rowIds)}
                  aria-label="Chọn tất cả bài đang hiển thị"
                />
              </th>
            )}
            <th style={{ padding: "14px 14px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>ID</th>
            <th style={{ padding: "14px 14px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Ngày</th>
            <th style={{ padding: "14px 14px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Tiêu đề</th>
            <th style={{ padding: "14px 14px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Bút danh</th>
            <th style={{ padding: "14px 14px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Người duyệt</th>
            <th style={{ padding: "14px 14px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "center" }}>Loại bài</th>
            <th style={{ padding: "14px 14px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "center" }}>Trạng thái</th>
            <th style={{ padding: "14px 14px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "center" }}>Link</th>
            <th style={{ padding: "14px 14px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "center" }}>Thao tác</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={allowBulkAssign && selectionMode ? 10 : 9}>
                <div style={{ padding: showSplitArticleSections ? 44 : 72, textAlign: "center", color: "var(--text-muted)" }}>
                  <div style={{ fontSize: showSplitArticleSections ? 28 : 36, marginBottom: 12 }}>📄</div>
                  <div style={{ fontWeight: 700 }}>{emptyMessage}</div>
                </div>
              </td>
            </tr>
          ) : (
            rows.map((a) => (
              <tr key={a.id} data-testid={`article-row-${a.id}`} style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.02)", transition: "background 0.2s" }} className="hover:bg-white/[0.02]">
                {allowBulkAssign && selectionMode && (
                  <td style={{ padding: "12px 10px", textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={selectedArticleIds.includes(a.id)}
                      onChange={() => toggleArticleSelection(a.id)}
                      aria-label={`Chọn bài ${a.title}`}
                    />
                  </td>
                )}
                <td style={{ padding: "12px 12px", fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)" }}>{a.articleId || a.id}</td>
                <td style={{ padding: "12px 10px", fontSize: 13, color: "var(--text-main)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{a.date}</td>
                <td style={{ padding: "12px 14px" }}>
                  {getPreferredArticleNavigationLink(a) ? (
                    <button
                      type="button"
                      onClick={() => setPreviewArticle(a)}
                      title={a.reviewLink ? `${a.title} (xem trước & mở CMS)` : a.title}
                      style={{
                        color: "var(--accent-blue)",
                        textDecoration: "none",
                        fontWeight: 600,
                        fontSize: 14,
                        lineHeight: 1.35,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                        width: "100%",
                        padding: 0,
                        cursor: "pointer",
                        textAlign: "left",
                        background: "none",
                        border: "none",
                      }}
                    >
                      {a.title}
                    </button>
                  ) : (
                    <span
                      title={a.title}
                      style={{
                        color: "var(--text-main)",
                        fontWeight: 500,
                        fontSize: 14,
                        lineHeight: 1.35,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                        width: "100%",
                      }}
                    >
                      {a.title}
                    </span>
                  )}
                </td>
                <td style={{ padding: "12px 14px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
                    <span
                      title={getDisplayedPenName(a.penName)}
                      style={{
                        display: "block",
                        maxWidth: "100%",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        fontSize: 13,
                        color: "var(--text-main)",
                        whiteSpace: "nowrap",
                        fontWeight: 600,
                      }}
                    >
                      {getDisplayedPenName(a.penName)}
                    </span>
                    {authorBucketBadge(a)}
                  </div>
                </td>
                <td style={{ padding: "12px 8px", fontSize: 13, color: "var(--text-main)" }}>
                  <span
                    title={a.reviewerName ? getDisplayedPenName(a.reviewerName) : "Chưa phân công"}
                    style={{
                      display: "block",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {a.reviewerName ? getDisplayedPenName(a.reviewerName) : "—"}
                  </span>
                </td>
                <td style={{ padding: "12px 14px", textAlign: "center" }}>
                  {articleTypeBadge(a.articleType)}
                </td>
                <td style={{ padding: "12px 14px", textAlign: "center" }}>{statusBadge(a.status)}</td>
                <td style={{ padding: "12px 8px", textAlign: "center" }}>
                  {linkBadge(a)}
                </td>
                <td style={{ padding: "12px 10px", textAlign: "center" }}>
                  <div style={{ display: "flex", gap: 6, justifyContent: "center", alignItems: "center", flexWrap: "nowrap", whiteSpace: "nowrap", width: "100%" }}>
                    <div style={{ position: "relative", display: "inline-flex" }}>
                      <button
                        data-testid={`article-comment-${a.id}`}
                        onClick={() => openComments(a)}
                        className="btn-ios-pill btn-ios-secondary"
                        style={{ padding: "5px 9px", minWidth: 34, height: 34 }}
                        title={getCommentButtonTitle(a)}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 17 }}>forum</span>
                      </button>
                      {Number(a.commentCount || 0) > 0 && (
                        <span
                          className={Number(a.unreadCommentCount || 0) > 0 ? "comment-badge-pulse" : ""}
                          style={{
                            position: "absolute",
                            top: -5,
                            right: -5,
                            minWidth: 17,
                            height: 17,
                            padding: "0 4px",
                            borderRadius: 999,
                            background: Number(a.unreadCommentCount || 0) > 0 ? "var(--danger)" : "var(--accent-blue)",
                            color: "#fff",
                            fontSize: 10,
                            fontWeight: 700,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            boxShadow: Number(a.unreadCommentCount || 0) > 0 ? "0 0 0 2px rgba(239, 68, 68, 0.12)" : "0 0 0 2px rgba(59, 130, 246, 0.12)",
                          }}
                        >
                          {getCommentBadgeLabel(a)}
                        </span>
                      )}
                      {Number(a.unreadCommentCount || 0) > 0 && Number(a.commentCount || 0) === 0 && (
                        <span
                          className="comment-badge-pulse"
                          style={{
                            position: "absolute",
                            top: -3,
                            right: -3,
                            width: 10,
                            height: 10,
                            borderRadius: 999,
                            background: "var(--danger)",
                            boxShadow: "0 0 0 2px white",
                          }}
                        />
                      )}
                    </div>
                      {canEditArticle(a) && (
                        <button onClick={() => openArticleModal({ ...a, status: a.status === "Approved" ? "Published" : a.status, wordCountRange: normalizeWordCountRangeValue(a.wordCountRange) })} className="btn-ios-pill btn-ios-secondary" style={{ padding: "5px 9px", minWidth: 34, height: 34 }} title="Sửa">
                          <span className="material-symbols-outlined" style={{ fontSize: 17 }}>edit</span>
                        </button>
                      )}
                      {showContentWorkAction(a) && (() => {
                        const contentWorkAction = getContentWorkActionState(a);
                        return (
                          <button
                            onClick={() => {
                              if (!contentWorkAction.disabled) {
                                void handleRegisterContentWork(a);
                              }
                            }}
                            disabled={contentWorkAction.disabled}
                            className="btn-ios-pill"
                            style={{
                              padding: "5px 9px",
                              minWidth: 34,
                              height: 34,
                              background: contentWorkAction.background,
                              color: contentWorkAction.color,
                              border: contentWorkAction.border,
                              opacity: contentWorkAction.disabled ? 0.88 : 1,
                            }}
                            title={contentWorkAction.title}
                          >
                            <span
                              className="material-symbols-outlined"
                              style={{
                                fontSize: 17,
                                animation: contentWorkAction.animation,
                              }}
                            >
                              {contentWorkAction.icon}
                            </span>
                          </button>
                        );
                      })()}
                      {(canManageArticles || a.canDelete) && (
                        <button
                          data-testid={`article-delete-${a.id}`}
                        onClick={() => deleteSingleArticle(a)}
                        disabled={deletingArticleIds.includes(a.id)}
                        className="btn-ios-pill"
                        style={{ padding: "5px 9px", minWidth: 34, height: 34, background: "rgba(239, 68, 68, 0.08)", color: "var(--danger)", border: "1px solid rgba(239, 68, 68, 0.16)", opacity: deletingArticleIds.includes(a.id) ? 0.7 : 1 }}
                        title={deletingArticleIds.includes(a.id) ? "Đang xóa bài" : "Xóa bài"}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 17, animation: deletingArticleIds.includes(a.id) ? "spin 1s linear infinite" : undefined }}>
                          {deletingArticleIds.includes(a.id) ? "sync" : "delete"}
                        </span>
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
    );
  };

  const renderArticleCards = (rows: Article[], emptyMessage: string) => {
    if (rows.length === 0) {
      return (
        <div style={{ padding: 48, textAlign: "center", color: "var(--text-muted)" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📄</div>
          <div style={{ fontWeight: 700 }}>{emptyMessage}</div>
        </div>
      );
    }

    return (
      <div className="mobile-only" style={{ display: "flex", flexDirection: "column", gap: 12, padding: "0 1px" }}>
        {rows.map((a) => (
            <MobileArticleCard
              key={a.id}
              article={a}
              onEdit={() => openArticleModal({ ...a, status: a.status === "Approved" ? "Published" : a.status, wordCountRange: normalizeWordCountRangeValue(a.wordCountRange) })}
              onComments={() => openComments(a)}
              onRegisterContentWork={() => { void handleRegisterContentWork(a); }}
              onDelete={() => deleteSingleArticle(a)}
              canEdit={canEditArticle(a)}
              canRegisterContentWork={canRegisterContentWork(a)}
              showContentWorkAction={showContentWorkAction(a)}
              canDelete={canManageArticles || a.canDelete}
              showAuthor={canManageArticles}
              isDeleting={deletingArticleIds.includes(a.id)}
              isRegisteringContentWork={registeringContentWork && registeringContentWorkArticleId === a.id}
              unreadComments={Number(a.unreadCommentCount || 0)}
            />
        ))}
      </div>
    );
  };

  return (
    <>
      <div className="articles-page-container">
        <header style={{ marginBottom: isMobile ? 12 : 32, display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
          {!isMobile && (
            <div>
              <h2 style={{ fontSize: 32, fontWeight: 800, color: "var(--text-main)", letterSpacing: "-0.04em" }}>Quản lý bài viết</h2>
            </div>
          )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", width: isMobile ? "100%" : "auto" }}>
          {canCreateArticles && (
            <button 
              className="btn-ios-pill btn-ios-primary" 
              onClick={() => openArticleModal({ date: new Date().toISOString().split("T")[0], penName: canManageArticles ? MANAGER_DEFAULT_PEN_NAME : user?.collaborator?.penName, reviewerName: "", status: DEFAULT_ARTICLE_STATUS, wordCountRange: "" })}
              style={{ flex: isMobile ? 1 : "initial", justifyContent: "center", order: isMobile ? -1 : 0 }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
              Thêm bài mới
            </button>
          )}
          {canSyncArticles && (
            <button
              className="btn-ios-pill btn-ios-secondary"
              onClick={() => executeGoogleSheetSync({ closeModalOnSuccess: true })}
              disabled={googleSyncLoading}
              title={canManageArticles
                ? "Đồng bộ tab tháng mới nhất trên Google Sheet"
                : `Đồng bộ tab tháng mới nhất trên Google Sheet trong phạm vi dữ liệu của ${collaboratorLabel}`}
              style={{ flex: isMobile ? 1 : "initial", justifyContent: "center" }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>bolt</span>
              {isMobile ? "Đồng bộ" : "Đồng bộ ngay"}
            </button>
          )}
          {canSyncArticles && (
            <button
              className="btn-ios-pill btn-ios-secondary"
              onClick={openGoogleSyncModal}
              disabled={googleSyncLoading}
              title="Chọn tháng và năm để đồng bộ từ Google Sheet"
              style={{ flex: isMobile ? 1 : "initial", justifyContent: "center" }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>sync</span>
              {isMobile ? "Chọn tháng" : "Chọn tháng để đồng bộ"}
            </button>
          )}
          {canManageArticles && (
            <button
              data-testid="articles-open-delete-tool"
              className="btn-ios-pill"
              onClick={openDeleteTool}
              style={{
                flex: isMobile ? 1 : "initial",
                justifyContent: "center",
                background: "rgba(239, 68, 68, 0.08)",
                color: "var(--danger)",
                border: "1px solid rgba(239, 68, 68, 0.16)",
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>delete_sweep</span>
              {isMobile ? "Xóa dữ liệu" : "Xóa dữ liệu"}
            </button>
          )}
          {canManageArticles && !isMobile && (
            <>
              <input
                ref={importInputRef}
                id={importInputId}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleImport}
                disabled={importing}
                tabIndex={-1}
                aria-hidden="true"
                style={{
                  position: "fixed",
                  width: 1,
                  height: 1,
                  opacity: 0,
                  left: -10000,
                  top: -10000,
                }}
              />
              <label
                htmlFor={importInputId}
                className="btn-ios-pill btn-ios-secondary"
                style={{ cursor: importing ? "not-allowed" : "pointer", opacity: importing ? 0.7 : 1 }}
                onClick={(e) => {
                  if (importing) e.preventDefault();
                }}
                tabIndex={importing ? -1 : 0}
                aria-disabled={importing}
              >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>download</span>
              {importing ? "Đang nhập..." : "Nhập"}
              </label>
            </>
          )}
          {canBulkAssignReviewer && !isMobile && (
            <button
              className="btn-ios-pill btn-ios-secondary"
              onClick={toggleSelectionMode}
              style={{
                borderColor: selectionMode ? "rgba(37, 99, 235, 0.28)" : undefined,
                background: selectionMode ? "rgba(37, 99, 235, 0.1)" : undefined,
                color: selectionMode ? "var(--accent-blue)" : undefined,
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{selectionMode ? "close" : "checklist"}</span>
              {selectionMode ? "Thoát chọn" : "Chọn hàng loạt"}
            </button>
          )}
        </div>
      </header>

        <div style={{ marginBottom: 18, padding: "12px 16px", borderRadius: 16, background: "rgba(13,148,136,0.06)", border: "1px solid rgba(13,148,136,0.14)", display: "flex", alignItems: "center", gap: 10 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 18, color: "#0d9488" }}>payments</span>
          <span style={{ fontSize: 13, color: "var(--text-main)", fontWeight: 600 }}>
            Chỉ bài có trạng thái đã duyệt mới được cộng vào nhuận bút cá nhân.
          </span>
        </div>

        {contentWorkBannerArticle && canRegisterContentWork(contentWorkBannerArticle) && (
          <div
            className="glass-card"
            style={{
              marginBottom: 18,
              padding: isMobile ? 16 : 18,
              display: "flex",
              flexDirection: "column",
              gap: 14,
              border: "1px solid rgba(37, 99, 235, 0.16)",
              background: "linear-gradient(135deg, rgba(37, 99, 235, 0.09), rgba(59, 130, 246, 0.04))",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 14,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(37, 99, 235, 0.14)",
                  color: "var(--accent-blue)",
                  flexShrink: 0,
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>task_alt</span>
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text-main)", marginBottom: 4 }}>
                  Bài vừa lưu sẵn sàng đăng ký Content Work
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.7, color: "var(--text-muted)" }}>
                  <strong style={{ color: "var(--text-main)" }}>{contentWorkBannerArticle.title}</strong> đã lưu thành công.
                  Bạn có thể bấm ngay để hệ thống tự gửi form và điền link vào sheet Content Work ở nền.
                </div>
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "flex-end" }}>
              <button
                className="btn-ios-pill btn-ios-secondary"
                onClick={() => setContentWorkBannerArticle(null)}
                disabled={registeringContentWork}
              >
                Để sau
              </button>
              <button
                className="btn-ios-pill btn-ios-primary"
                onClick={() => { void handleRegisterContentWork(contentWorkBannerArticle); }}
                disabled={registeringContentWork}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                  {registeringContentWork && registeringContentWorkArticleId === contentWorkBannerArticle.id ? "progress_activity" : "task_alt"}
                </span>
                {registeringContentWork && registeringContentWorkArticleId === contentWorkBannerArticle.id ? "Đang xử lý..." : "Đăng ký Content Work"}
              </button>
            </div>
          </div>
        )}

        <div className="glass-card" style={{ padding: 20, marginBottom: 32, overflow: "hidden" }}>
        <div style={{ display: "flex", gap: 12, rowGap: 10, alignItems: "center", flexWrap: "wrap", width: "100%", minWidth: 0 }}>
          <div style={{ flex: "1 1 420px", minWidth: 0, position: "relative" }}>
            <span className="material-symbols-outlined" style={{ position: "absolute", left: isMobile ? 12 : 16, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", fontSize: 18 }}>search</span>
            <input
              data-testid="articles-search"
              type="text"
              placeholder={isMobile ? "Tìm bài viết..." : "Tìm theo tiêu đề, tác giả, nội dung..."}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              style={{ width: "100%", height: isMobile ? 40 : 44, padding: isMobile ? "0 12px 0 38px" : "0 16px 0 48px", background: "rgba(0,0,0,0.03)", border: "1px solid var(--glass-border)", borderRadius: 12, color: "var(--text-main)", fontSize: 14 }}
            />
          </div>
          <button className="btn-ios-pill btn-ios-secondary" onClick={toggleFilters} style={{ height: isMobile ? 40 : 44, padding: isMobile ? "0 10px" : "0 16px" }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>tune</span>
            {!isMobile && "Bộ lọc"} {activeFilterCount > 0 && <span style={{ marginLeft: 6, padding: "2px 6px", background: "var(--accent-blue)", color: "white", borderRadius: 6, fontSize: 10, fontWeight: 800 }}>{activeFilterCount}</span>}
          </button>
          {!isMobile && activeFilterCount > 0 && (
            <button className="btn-ios-pill" onClick={clearFilters} style={{ height: 44, background: "rgba(239, 68, 68, 0.1)", color: "#f87171", border: "1px solid rgba(239, 68, 68, 0.2)" }}>
              Xóa lọc
            </button>
          )}          <button
            className="btn-ios-pill"
            data-testid="articles-check-links"
            onClick={() => { void checkVisibleLinks(true); }}
            disabled={linkCheckLoading}
            title="Kiểm tra lại trạng thái các link bài viết đang hiển thị"
            style={{
              height: isMobile ? 40 : 44,
              padding: isMobile ? "0 12px" : "0 16px 0 12px",
              gap: 10,
              whiteSpace: "nowrap",
              flexShrink: 0,
              background: linkCheckLoading ? "rgba(14, 165, 233, 0.10)" : "rgba(37, 99, 235, 0.08)",
              color: linkCheckLoading ? "#0369a1" : "var(--accent-blue)",
              border: linkCheckLoading
                ? "1px solid rgba(14, 165, 233, 0.20)"
                : "1px solid rgba(37, 99, 235, 0.18)",
              boxShadow: "0 10px 24px rgba(37, 99, 235, 0.08)",
            }}
          >
            <span
              style={{
                width: 26,
                height: 26,
                borderRadius: 999,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: linkCheckLoading ? "rgba(14, 165, 233, 0.16)" : "rgba(37, 99, 235, 0.14)",
                color: "inherit",
                flexShrink: 0,
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{
                  fontSize: 16,
                  animation: linkCheckLoading ? "spin 1s linear infinite" : undefined,
                }}
              >
                verified
              </span>
            </span>
            <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.1 }}>
              <span style={{ fontSize: 13, fontWeight: 800 }}>{linkCheckLoading ? "Đang kiểm tra..." : "Kiểm tra link"}</span>
              {!isMobile && !linkCheckLoading && (
                <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>
                  Recheck các bài đang hiển thị
                </span>
              )}
            </span>
          </button>
        </div>

        {canBulkAssignReviewer && selectionMode && (
          <div style={{ marginTop: 18, paddingTop: 18, borderTop: "1px solid var(--glass-border)", display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ minWidth: 180 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8 }}>
                Đang chọn
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-main)" }}>
                {selectedArticleIds.length} bài
              </div>
            </div>
            {canManageArticles ? (
              <div style={{ minWidth: 260, flex: "1 1 260px" }}>
                <label className="form-label" style={{ marginBottom: 8, textTransform: "uppercase", fontSize: 11, fontWeight: 700 }}>Gán người duyệt</label>
                <CustomSelect
                  value={bulkReviewerName}
                  onChange={setBulkReviewerName}
                  options={reviewerSelectOptions}
                  placeholder="Chọn người duyệt"
                  menuMode="portal-bottom"
                />
              </div>
            ) : (
              <div style={{ minWidth: 240, flex: "1 1 240px" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8 }}>
                  Reviewer nhận bài
                </div>
                <div style={{ height: 44, display: "flex", alignItems: "center", padding: "0 14px", borderRadius: 12, background: "rgba(0,0,0,0.03)", border: "1px solid var(--glass-border)", color: "var(--text-main)", fontWeight: 700 }}>
                  {getDisplayedPenName(reviewerSelfAssignmentName) || "Reviewer hiện tại"}
                </div>
              </div>
            )}
            <button className="btn-ios-pill btn-ios-secondary" onClick={toggleSelectVisibleArticles} style={{ height: 44 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                {selectedVisibleCount === visibleArticleIds.length && visibleArticleIds.length > 0 ? "deselect" : "select_all"}
              </span>
              {selectedVisibleCount === visibleArticleIds.length && visibleArticleIds.length > 0 ? "Bỏ chọn trang" : "Chọn trang"}
            </button>
            <button className="btn-ios-pill" onClick={() => setSelectedArticleIds([])} disabled={selectedArticleIds.length === 0} style={{ height: 44 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>clear_all</span>
              Xóa chọn
            </button>
            <button className="btn-ios-pill btn-ios-primary" onClick={assignReviewerToSelection} disabled={selectedArticleIds.length === 0 || bulkAssigningReviewer} style={{ height: 44 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>assignment_ind</span>
              {bulkAssigningReviewer ? "Đang cập nhật..." : canManageArticles ? "Phân công reviewer" : "Nhận bài đã chọn"}
            </button>
          </div>
        )}

        {showFilters && !isMobile && (
          <div
            style={{
              marginTop: 18,
              padding: 18,
              borderRadius: 18,
              border: "1px solid rgba(148, 163, 184, 0.16)",
              background: "linear-gradient(180deg, rgba(255,255,255,0.78) 0%, rgba(248,250,252,0.56) 100%)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.55), 0 12px 30px rgba(15, 23, 42, 0.05)",
              animation: "modalFadeIn 0.2s ease",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: "var(--accent-blue)" }}>tune</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text-main)" }}>Bộ lọc bài viết</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>
                  Thu hẹp danh sách theo bút danh, trạng thái và loại bài
                </div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
            {canManageArticles && (
              <div className="form-group">
                <label className="form-label" style={{ marginBottom: 6, textTransform: "uppercase", fontSize: 11, fontWeight: 700 }}>Bút danh</label>
                <CustomSelect
                  value={filters.penName || ""}
                  onChange={(v) => applyFilter("penName", v)}
                  options={[{ value: "", label: collaboratorsLoading && collaborators.length === 0 ? "Đang tải bút danh..." : "Tất cả bút danh" }, ...collaborators.map(c => ({ value: c.penName, label: getDisplayedPenName(c.penName) }))]}
                  placeholder={collaboratorsLoading && collaborators.length === 0 ? "Đang tải bút danh..." : "Tất cả bút danh"}
                  menuMode="portal-bottom"
                />
              </div>
            )}
            <div className="form-group">
              <label className="form-label" style={{ marginBottom: 6, textTransform: "uppercase", fontSize: 11, fontWeight: 700 }}>Trạng thái</label>
              <CustomSelect
                value={filters.status || ""}
                onChange={(v) => applyFilter("status", v)}
                options={ARTICLE_STATUS_OPTIONS}
                placeholder="Tất cả"
                menuMode="portal-bottom"
              />
            </div>
            <div className="form-group">
              <label className="form-label" style={{ marginBottom: 6, textTransform: "uppercase", fontSize: 11, fontWeight: 700 }}>Danh mục</label>
              <CustomSelect
                value={filters.category || ""}
                onChange={(v) => applyFilter("category", v)}
                options={[{ value: "", label: "Tất cả" }, ...visibleCategoryOptions.map((category) => ({ value: category, label: category }))]}
                placeholder="Tất cả"
                menuMode="portal-bottom"
              />
            </div>
            <div className="form-group">
              <label className="form-label" style={{ marginBottom: 6, textTransform: "uppercase", fontSize: 11, fontWeight: 700 }}>Loại bài</label>
              <CustomSelect
                value={filters.articleType || ""}
                onChange={(v) => applyFilter("articleType", v)}
                options={[{ value: "", label: "Tất cả" }, ...visibleArticleTypeOptions.map(t => ({ value: t, label: t }))]}
                placeholder="Tất cả"
                menuMode="portal-bottom"
              />
            </div>
            <div className="form-group">
              <label className="form-label" style={{ marginBottom: 6, textTransform: "uppercase", fontSize: 11, fontWeight: 700 }}>Loại nội dung</label>
              <CustomSelect
                value={filters.contentType || ""}
                onChange={(v) => applyFilter("contentType", v)}
                options={[{ value: "", label: "Tất cả" }, ...CONTENT_TYPE_OPTIONS.map((contentType) => ({ value: contentType, label: contentType }))]}
                placeholder="Tất cả"
                menuMode="portal-bottom"
              />
            </div>
            <div className="form-group">
              <label className="form-label" style={{ marginBottom: 6, textTransform: "uppercase", fontSize: 11, fontWeight: 700 }}>Tháng/Năm</label>
              <div className="flex gap-2">
                <div style={{ flex: 1 }}>
                  <CustomSelect
                    value={filters.month || ""}
                    onChange={(v) => applyFilter("month", v)}
                    options={MONTH_OPTIONS}
                    placeholder="Tháng"
                    menuMode="portal-bottom"
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <CustomSelect
                    value={filters.year || ""}
                    onChange={(v) => applyFilter("year", v)}
                    options={YEAR_OPTIONS}
                    placeholder="Năm"
                    menuMode="portal-bottom"
                  />
                </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {showSplitArticleSections && !loading && articles.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 24 }}>
          <div className="glass-card" style={{ padding: 18, background: "linear-gradient(135deg, rgba(15, 23, 42, 0.03), rgba(148, 163, 184, 0.04))" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: "var(--accent-blue)" }}>dashboard</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Tổng đang hiển thị</span>
            </div>
            <div style={{ fontSize: 30, fontWeight: 800, color: "var(--text-main)", lineHeight: 1 }}>{articles.length}</div>
          </div>
          {articleSections.map((section) => (
            <div key={section.key} className="glass-card" style={{ padding: 18, background: section.background }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18, color: section.accent }}>{section.icon}</span>
                <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{section.title}</span>
              </div>
              <div style={{ fontSize: 30, fontWeight: 800, color: "var(--text-main)", lineHeight: 1 }}>{section.rows.length}</div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="glass-card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ textAlign: "center", padding: 60, color: "var(--accent-blue)", fontWeight: 600 }}>⏳ Đang tải bài viết...</div>
        </div>
      ) : articles.length === 0 ? (
        <div className="glass-card" style={{ padding: 80, textAlign: "center", color: "var(--text-muted)" }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>📄</div>
          <div style={{ fontWeight: 600 }}>Chưa có bài viết nào</div>
          {!canManageArticles && <div style={{ marginTop: 8, fontSize: 13 }}>{isReviewer ? "Tài khoản duyệt bài chỉ hiển thị 2 nhóm rõ ràng: bài đã giao cho bạn và bài chưa phân công đang chờ nhận duyệt." : `Tài khoản này đang hiển thị dữ liệu của ${collaboratorLabel}. Nếu admin đã nhập bài dưới tên khác, hãy cập nhật liên kết hoặc chuẩn hóa bút danh.`}</div>}
        </div>
      ) : showSplitArticleSections ? (
        <div style={{ display: "grid", gap: 24 }}>
          {articleSections.map((section) => (
            <section key={section.key} className="glass-card" style={{ padding: 0, overflow: "hidden", background: isMobile ? "transparent" : undefined, boxShadow: isMobile ? "none" : undefined, border: isMobile ? "none" : undefined }}>
              <div
                data-testid={`article-section-${section.key}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: isMobile ? "12px 0" : "18px 20px",
                  borderBottom: isMobile ? "none" : "1px solid var(--glass-border)",
                  background: isMobile ? "transparent" : section.background,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 20, color: section.accent }}>{section.icon}</span>
                  <h3 style={{ margin: 0, fontSize: isMobile ? 16 : 18, fontWeight: 800, color: "var(--text-main)" }}>{section.title}</h3>
                </div>
                <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: isMobile ? 32 : 38, height: isMobile ? 32 : 38, padding: isMobile ? "0 8px" : "0 12px", borderRadius: 999, background: isMobile ? "rgba(0,0,0,0.05)" : "rgba(255, 255, 255, 0.7)", color: section.accent, fontSize: isMobile ? 14 : 16, fontWeight: 800 }}>
                  {section.rows.length}
                </span>
              </div>
              {isMobile ? renderArticleCards(section.rows, section.emptyMessage) : renderArticleTable(section.rows, section.emptyMessage, section.allowBulkAssign)}
            </section>
          ))}
        </div>
      ) : (
        <div className="glass-card" style={{ padding: 0, overflow: "hidden", background: isMobile ? "transparent" : undefined, boxShadow: isMobile ? "none" : undefined, border: isMobile ? "none" : undefined }}>
          {isMobile ? renderArticleCards(articles, "Chưa có bài viết nào") : renderArticleTable(articles, "Chưa có bài viết nào", canBulkAssignReviewer)}
        </div>
      )}
      {pagination.totalPages > 1 && (
        <div className={isMobile ? "flex items-center justify-between gap-4 mt-8 pb-10" : "pagination"}>
          <button 
            disabled={pagination.page <= 1} 
            onClick={() => fetchArticles(pagination.page - 1, appliedSearch, filters)}
            className={isMobile ? "flex-1 h-12 flex items-center justify-center rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm font-bold active:scale-95 transition-all disabled:opacity-30" : ""}
          >
            {isMobile ? "Trang trước" : "← Trước"}
          </button>
          {!isMobile && (
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Trang {pagination.page} / {pagination.totalPages} ({pagination.total} bài)</span>
          )}
          {isMobile && (
            <div className="flex flex-col items-center">
              <span className="text-[10px] uppercase tracking-widest font-bold text-slate-400 mb-1">Trang</span>
              <span className="text-sm font-black text-slate-800 dark:text-white">{pagination.page} / {pagination.totalPages}</span>
            </div>
          )}
          <button 
            disabled={pagination.page >= pagination.totalPages} 
            onClick={() => fetchArticles(pagination.page + 1, appliedSearch, filters)}
            className={isMobile ? "flex-1 h-12 flex items-center justify-center rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm font-bold active:scale-95 transition-all disabled:opacity-30" : ""}
          >
            {isMobile ? "Trang sau" : "Sau →"}
          </button>
        </div>
      )}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">{formData.id ? "Chỉnh sửa bài viết" : "Thêm bài mới"}</h3>
              <button className="modal-close" onClick={() => setShowModal(false)}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Tiêu đề bài viết</label>
                <input className="form-input" value={formData.title || ""} onChange={e => setFormData({ ...formData, title: e.target.value })} placeholder="VD: 10 Cách phối đồ đẹp cho mùa hè..." />
              </div>
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Bút danh tác giả</label>
                  {canManageArticles ? (
                    <CustomSelect
                      value={formData.penName || ""}
                      onChange={v => setFormData({ ...formData, penName: v })}
                      options={[{ value: "", label: collaboratorsLoading && collaborators.length === 0 ? "Đang tải CTV..." : "Chọn CTV" }, ...collaborators.map(c => ({ value: c.penName, label: getDisplayedPenName(c.penName) }))]}
                      placeholder={collaboratorsLoading && collaborators.length === 0 ? "Đang tải CTV..." : "Chọn CTV"}
                    />
                  ) : (
                    <input className="form-input" value={getDisplayedPenName(formData.penName)} readOnly style={{ background: "rgba(255,255,255,0.01)", opacity: 0.6 }} />
                  )}
                </div>
                <div className="form-group">
                  <label className="form-label">Ngày thực hiện</label>
                  <input className="form-input" type="date" value={formData.date || ""} onChange={e => setFormData({ ...formData, date: e.target.value })} />
                </div>
              </div>
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Loại chuyên mục</label>
                  <CustomSelect
                    value={formData.articleType || "Bài SEO ICT"}
                    onChange={v => setFormData({ ...formData, articleType: v })}
                    options={visibleArticleTypeOptions.map(t => ({ value: t, label: t }))}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Hình thức nội dung</label>
                  <CustomSelect
                    value={formData.contentType || "Viết mới"}
                    onChange={v => setFormData({ ...formData, contentType: v })}
                    options={CONTENT_TYPE_OPTIONS.map(t => ({ value: t, label: t }))}
                  />
                </div>
              </div>
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Độ dài</label>
                  <CustomSelect
                    value={normalizeWordCountRangeValue(formData.wordCountRange)}
                    onChange={v => setFormData({ ...formData, wordCountRange: v })}
                    options={WORD_COUNT_RANGE_OPTIONS}
                    placeholder="Chọn độ dài"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Trạng thái hiện tại</label>
                  <CustomSelect
                    value={formData.status === "Approved" ? "Published" : formData.status || DEFAULT_ARTICLE_STATUS}
                    onChange={v => setFormData({ ...formData, status: v })}
                    options={[
                      { value: "Submitted", label: "Chờ duyệt" },
                      { value: "Draft", label: "Bản nháp" },
                      ...(canManageArticles ? [
                        { value: "Reviewing", label: "Đang duyệt" },
                        { value: "Published", label: "Đã duyệt" },
                        { value: "NeedsFix", label: "Sửa lỗi" },
                        { value: "Rejected", label: "Từ chối" }
                      ] : [])
                    ]}
                  />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Mã ID hệ thống</label>
                <input
                  className="form-input"
                  value={formData.articleId || ""}
                  readOnly={!canManageArticles}
                  onChange={e => setFormData({ ...formData, articleId: e.target.value })}
                  placeholder="Tự động nhận từ link bài viết (trừ bài mô tả)"
                  style={{
                    opacity: !canManageArticles ? 0.7 : 1,
                    background: !canManageArticles ? "rgba(148, 163, 184, 0.08)" : undefined,
                    cursor: !canManageArticles ? "not-allowed" : undefined,
                  }}
                />
                <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
                  Mã ID tự tạo khi có link bài viết. Không áp dụng cho bài mô tả.
                </div>
              </div>
              {canManageArticles && (
                <div className="form-group">
                  <label className="form-label">Người duyệt</label>
                  <CustomSelect
                    value={formData.reviewerName || ""}
                    onChange={v => setFormData({ ...formData, reviewerName: v })}
                    options={reviewerSelectOptions}
                    placeholder={collaboratorsLoading && collaborators.length === 0 ? "Đang tải reviewer..." : "Chọn người duyệt"}
                    menuMode="portal-bottom"
                  />
                </div>
              )}
                      <div className="form-group">
                <label className="form-label">Đường dẫn bài viết (URL)</label>
                <input
                  className="form-input"
                  value={formData.link || ""}
                  onChange={e => {
                    const nextLink = e.target.value;
                    const derivedArticleId = extractArticleIdFromLink(nextLink);
                    const requiresLinkId = isLinkIdRequiredForArticleType(formData.articleType);
                    setFormData({
                      ...formData,
                      link: nextLink,
                      articleId: requiresLinkId
                        ? (derivedArticleId || (canManageArticles ? formData.articleId || "" : ""))
                        : (derivedArticleId || (canManageArticles ? formData.articleId || "" : "")),
                    });
                  }}
                  placeholder="https://domain.com/bai-viet-203046"
                />
                <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
                  Link bài viết phải có đủ 6 chữ số ID ở cuối đường dẫn để tự điền Mã ID. Riêng bài mô tả không bắt buộc quy tắc này.
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Đường dẫn duyệt bài</label>
                <input className="form-input" value={formData.reviewLink || ""} onChange={e => setFormData({ ...formData, reviewLink: e.target.value })} placeholder="https://docs.google.com/... hoặc link CMS duyệt bài" />
                <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
                  Khi bấm vào tiêu đề bài trong danh sách, hệ thống sẽ ưu tiên mở link duyệt bài này trước.
                </div>
              </div>
            </div>
            <div className="modal-footer" style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "space-between" }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                  {canManageArticles && Boolean(formData.id) && formData.authorBucket !== "editorial" && (
                    <button
                      className="btn-ios-pill btn-ios-secondary"
                      onClick={handleMoveToNextMonth}
                    disabled={savingArticle || movingArticleToNextMonth}
                    style={{ borderColor: "rgba(245, 158, 11, 0.28)", color: "#b45309", background: "rgba(245, 158, 11, 0.1)" }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>event_upcoming</span>
                      {movingArticleToNextMonth ? "Đang chuyển..." : "Chuyển sang tháng sau"}
                    </button>
                  )}
                  {Boolean(formData.id) && showContentWorkAction(formData as Article) && (() => {
                    const contentWorkAction = getContentWorkActionState(formData as Article);
                    return (
                      <button
                        className="btn-ios-pill btn-ios-secondary"
                        onClick={() => {
                          if (!contentWorkAction.disabled) {
                            void handleRegisterContentWork(formData as Article);
                          }
                        }}
                        disabled={contentWorkAction.disabled || savingArticle || movingArticleToNextMonth}
                        style={{
                          borderColor: contentWorkAction.border.replace("1px solid ", ""),
                          color: contentWorkAction.color,
                          background: contentWorkAction.background,
                        }}
                        title={contentWorkAction.title}
                      >
                        <span
                          className="material-symbols-outlined"
                          style={{
                            fontSize: 18,
                            animation: contentWorkAction.animation,
                          }}
                        >
                          {contentWorkAction.icon}
                        </span>
                        {contentWorkAction.disabled || (formData as Article).contentWorkStatus === "failed" ? contentWorkAction.label : "Đăng ký Content Work"}
                      </button>
                    );
                  })()}
                </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginLeft: "auto" }}>
                <button className="btn-ios-pill btn-ios-secondary" onClick={() => setShowModal(false)} disabled={savingArticle || movingArticleToNextMonth}>Hủy bỏ</button>
                <button className="btn-ios-pill btn-ios-primary" onClick={handleSave} disabled={savingArticle || movingArticleToNextMonth}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>save</span>
                  {savingArticle ? "Đang lưu..." : "Lưu thông tin"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}



      {showCommentsModal && commentArticle && (
        <div className="modal-overlay" onClick={() => setShowCommentsModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 820, width: "90vw" }}>
            <div className="modal-header">
              <h3 className="modal-title">Trao đổi bài viết</h3>
              <button className="modal-close" onClick={() => setShowCommentsModal(false)}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
              </button>
            </div>
            <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ padding: 16, borderRadius: 12, background: "rgba(0,0,0,0.02)", border: "1px solid var(--glass-border)" }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>Bài viết</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-main)" }}>{commentArticle.title}</div>
                <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>Tác giả: {getDisplayedPenName(commentArticle.penName)}</div>
              </div>

              <div style={{ maxHeight: 280, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, paddingRight: 4 }}>
                {commentsLoading ? (
                  <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>⏳ Đang tải bình luận...</div>
                ) : comments.length === 0 ? (
                  <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>Chưa có bình luận nào.</div>
                ) : (
                  comments.map((c) => (
                    <div key={c.id} style={{ padding: 12, borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--accent-blue)" }}>{getDisplayedPenName(c.penName)}</span>
                        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{new Date(c.createdAt).toLocaleString("vi-VN")}</span>
                      </div>
                      <div style={{ whiteSpace: "pre-wrap", fontSize: 13, color: "var(--text-main)", lineHeight: 1.5 }}>{c.content}</div>
                      {c.mentions?.length > 0 && (
                        <div style={{ marginTop: 8, fontSize: 11, color: "var(--accent-purple)" }}>
                          Mention: {c.mentions.map((m) => `@${m}`).join(", ")}
                        </div>
                      )}
                      {c.attachmentUrl && (
                        <a href={c.attachmentUrl} target="_blank" rel="noopener noreferrer" style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--accent-blue)", textDecoration: "none" }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>attach_file</span>
                          Tệp đính kèm
                        </a>
                      )}
                    </div>
                  ))
                )}
              </div>

              <div style={{ borderTop: "1px solid var(--glass-border)", paddingTop: 16 }}>
                <div className="form-group">
                  <label className="form-label">Bình luận mới (hỗ trợ mention: `@penName`)</label>
                  <textarea
                    data-testid="comment-content-input"
                    className="form-input"
                    rows={4}
                    value={commentContent}
                    onChange={(e) => setCommentContent(e.target.value)}
                    placeholder="Nhập nội dung trao đổi..."
                    style={{ resize: "none", padding: 12 }}
                  />
                </div>
                <div className="form-group" style={{ marginTop: 12 }}>
                  <label className="form-label">URL tệp đính kèm (tuỳ chọn)</label>
                  <input
                    data-testid="comment-attachment-input"
                    className="form-input"
                    value={commentAttachment}
                    onChange={(e) => setCommentAttachment(e.target.value)}
                    placeholder="https://..."
                  />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-ios-pill btn-ios-secondary" onClick={() => setShowCommentsModal(false)}>Đóng</button>
              <button data-testid="comment-submit-button" className="btn-ios-pill btn-ios-primary" onClick={submitComment} disabled={commentSaving || !commentContent.trim()}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>send</span>
                {commentSaving ? "Đang gửi..." : "Gửi bình luận"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showGoogleSyncModal && (
        <div className="modal-overlay" onClick={closeGoogleSyncModal}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 760, width: "92vw" }}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="material-symbols-outlined" style={{ color: "var(--accent-blue)" }}>sync</span>
                Đồng bộ Google Sheet
              </h3>
              <button className="modal-close" onClick={closeGoogleSyncModal} disabled={googleSyncLoading}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
              </button>
            </div>

            <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <div style={{ padding: 16, borderRadius: 16, background: "rgba(37, 99, 235, 0.06)", border: "1px solid rgba(37, 99, 235, 0.14)" }}>
                <div style={{ fontSize: 13, color: "var(--text-main)", lineHeight: 1.7 }}>
                  Chọn <strong>tháng</strong> và <strong>năm</strong> để đồng bộ dữ liệu từ Google Sheet. Nếu để trống, hệ thống sẽ tự lấy tab mới nhất.
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Tháng cần đồng bộ</label>
                  <CustomSelect
                    value={googleSyncMonth}
                    onChange={(value) => {
                      setGoogleSyncMonth(value);
                      setGoogleSyncResult(null);
                      setGoogleSyncError("");
                    }}
                    options={MONTH_OPTIONS}
                    placeholder="Để trống = tab mới nhất"
                    menuMode="portal-bottom"
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Năm cần đồng bộ</label>
                  <CustomSelect
                    value={googleSyncYear}
                    onChange={(value) => {
                      setGoogleSyncYear(value);
                      setGoogleSyncResult(null);
                      setGoogleSyncError("");
                    }}
                    options={YEAR_OPTIONS}
                    placeholder="Để trống = tab mới nhất"
                    menuMode="portal-bottom"
                  />
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn-ios-pill btn-ios-secondary"
                  onClick={() => {
                    setGoogleSyncMonth("");
                    setGoogleSyncYear("");
                    setGoogleSyncResult(null);
                    setGoogleSyncError("");
                  }}
                  disabled={googleSyncLoading}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>history</span>
                  Dùng tab mới nhất
                </button>
                <span style={{ display: "inline-flex", alignItems: "center", color: "var(--text-muted)", fontSize: 13 }}>
                  Chọn đủ tháng và năm nếu bạn muốn nhập một kỳ cụ thể.
                </span>
              </div>

              {googleSyncError && (
                <div style={{ padding: 14, borderRadius: 14, background: "var(--danger-light)", border: "1px solid rgba(239, 68, 68, 0.18)", color: "var(--danger)", fontSize: 13, fontWeight: 700 }}>
                  {googleSyncError}
                </div>
              )}

              {googleSyncResult && (
                <div style={{ padding: 18, borderRadius: 18, background: "rgba(255,255,255,0.6)", border: "1px solid var(--glass-border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>Tab đã đồng bộ</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text-main)" }}>{googleSyncResult.sheetName}</div>
                    </div>
                    <span className="tag-pill" style={{ color: "var(--accent-blue)" }}>
                      {String(googleSyncResult.month).padStart(2, "0")}/{googleSyncResult.year}
                    </span>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12 }}>
                    {[
                      { label: "Tổng dòng", value: googleSyncResult.total, color: "var(--text-main)", icon: "description" },
                      { label: "Thêm mới", value: googleSyncResult.inserted, color: "var(--accent-teal)", icon: "add_task" },
                      { label: "Đã cập nhật", value: googleSyncResult.updated, color: "var(--accent-blue)", icon: "sync" },
                      { label: "Giữ nguyên", value: Math.max(googleSyncResult.duplicates - googleSyncResult.updated, 0), color: "var(--text-muted)", icon: "content_copy" },
                      { label: "Đã xóa", value: googleSyncResult.deleted, color: "var(--danger)", icon: "delete" },
                      { label: "Lỗi dữ liệu", value: googleSyncResult.skipped, color: "var(--accent-orange)", icon: "warning" },
                    ].map((item) => (
                      <div key={item.label} style={{ padding: 14, borderRadius: 14, background: "rgba(255,255,255,0.75)", border: "1px solid var(--glass-border)" }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 20, color: item.color }}>{item.icon}</span>
                        <div style={{ fontSize: 22, fontWeight: 800, color: item.color, marginTop: 6 }}>{item.value}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase" }}>{item.label}</div>
                      </div>
                    ))}
                  </div>

                  {googleSyncResult.warnings.length > 0 && (
                    <div style={{ marginTop: 16, padding: 14, borderRadius: 14, background: "rgba(249, 115, 22, 0.06)", border: "1px solid rgba(249, 115, 22, 0.15)" }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: "var(--accent-orange)", marginBottom: 8 }}>Cảnh báo phân tích sheet</div>
                      {googleSyncResult.warnings.map((warning, index) => (
                        <div key={`google-sync-warning-${index}`} style={{ fontSize: 12, color: "var(--text-main)", marginBottom: index === googleSyncResult.warnings.length - 1 ? 0 : 4 }}>
                          • {warning}
                        </div>
                      ))}
                    </div>
                  )}

                  {googleSyncResult.errors.length > 0 && (
                    <div style={{ marginTop: 16, padding: 14, borderRadius: 14, background: "rgba(239, 68, 68, 0.05)", border: "1px solid rgba(239, 68, 68, 0.15)" }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: "var(--danger)", marginBottom: 8 }}>Các dòng bị bỏ qua do lỗi dữ liệu</div>
                      {googleSyncResult.errors.map((error, index) => (
                        <div key={`google-sync-error-${index}`} style={{ fontSize: 12, color: "var(--text-main)", marginBottom: index === googleSyncResult.errors.length - 1 ? 0 : 4 }}>
                          • {error}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn-ios-pill btn-ios-secondary" onClick={closeGoogleSyncModal} disabled={googleSyncLoading}>
                Đóng
              </button>
              <button className="btn-ios-pill btn-ios-primary" onClick={() => executeGoogleSheetSync()} disabled={googleSyncLoading} style={{ minWidth: 190, justifyContent: "center" }}>
                {googleSyncLoading ? (
                  <><span className="material-symbols-outlined" style={{ fontSize: 18, animation: "spin 1s linear infinite" }}>sync</span> Đang đồng bộ...</>
                ) : (
                  <><span className="material-symbols-outlined" style={{ fontSize: 18 }}>sync</span> Đồng bộ tháng đã chọn</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteModal && canManageArticles && (
        <ArticleDeleteModal
          deleteLoading={deleteLoading}
          deleteExecuting={deleteExecuting}
          deleteError={deleteError}
          deleteMode={deleteMode}
          deleteCriteriaSummary={deleteCriteriaSummary}
          deleteCriteria={deleteCriteria}
          customDeleteCriteriaCount={customDeleteCriteriaCount}
          collaboratorsLoading={collaboratorsLoading}
          collaborators={collaborators}
          articleStatusOptions={ARTICLE_STATUS_OPTIONS}
          articleTypeOptions={visibleArticleTypeOptions}
          contentTypeOptions={CONTENT_TYPE_OPTIONS}
          monthOptions={MONTH_OPTIONS}
          yearOptions={YEAR_OPTIONS}
          deletePreview={deletePreview}
          onClose={() => setShowDeleteModal(false)}
          onDeleteModeChange={handleDeleteModeChange}
          updateDeleteCriteria={updateDeleteCriteria}
          applyDeletePreset={applyDeletePreset}
          requestDeletePreview={() => requestDeletePreview(deleteMode)}
          executeDelete={executeDelete}
          statusBadge={statusBadge}
        />
      )}

      {showImportWizard && (
        <ArticleImportWizard
          importing={importing}
          importStep={importStep}
          importFile={importFile}
          importAnalysis={importAnalysis}
          importMapping={importMapping}
          importSheetName={importSheetName}
          importHeaderRowNumber={importHeaderRowNumber}
          replaceExistingImport={replaceExistingImport}
          importError={importError}
          importDryRun={importDryRun}
          importDryRunLoading={importDryRunLoading}
          importResult={importResult}
          missingRequiredImportFields={missingRequiredImportFields}
          duplicateMappedFields={duplicateMappedFields}
          mappedFields={mappedFields}
          importantFieldInsights={importantFieldInsights}
          mappedPreviewFields={mappedPreviewFields}
          importFieldOptions={IMPORT_FIELD_OPTIONS}
          onClose={() => setShowImportWizard(false)}
          onTriggerImportPicker={triggerImportPicker}
          onSheetChange={async (value) => {
            if (!importFile) return;
            setImportSheetName(value);
            await analyzeImportFile(importFile, value, undefined);
          }}
          onHeaderRowChange={async (value) => {
            if (!importFile) return;
            const nextRow = Number(value);
            setImportHeaderRowNumber(nextRow);
            await analyzeImportFile(importFile, importSheetName, nextRow);
          }}
          onReplaceExistingChange={(checked) => {
            setReplaceExistingImport(checked);
            setImportDryRun(null);
          }}
          onUpdateImportMapping={updateImportMapping}
          onRunImportDryRun={runImportDryRun}
          onExecuteImport={executeImport}
          resolveImportPreviewValue={resolveImportPreviewValue}
        />
      )}
      </div>

      {previewArticle && (
        <ArticlePreviewPanel
          article={previewArticle}
          onClose={() => setPreviewArticle(null)}
        />
      )}

      {isMobile && (
        <BottomSheet
          isOpen={showFilters}
          onClose={() => setShowFilters(false)}
          title="Bộ lọc bài viết"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 18, paddingBottom: 20 }}>
            {canManageArticles && (
              <div className="form-group">
                <label className="form-label" style={{ marginBottom: 6, textTransform: "uppercase", fontSize: 11, fontWeight: 700 }}>Bút danh</label>
                <CustomSelect
                  value={normalizedFilterPenName}
                  onChange={(v) => applyFilter("penName", v)}
                  options={[{ value: "", label: "Tất cả bút danh" }, ...collaborators.map(c => ({ value: c.penName, label: getDisplayedPenName(c.penName) }))]}
                  placeholder="Tất cả bút danh"
                  menuMode="portal-bottom"
                />
              </div>
            )}
            <div className="form-group">
              <label className="form-label" style={{ marginBottom: 6, textTransform: "uppercase", fontSize: 11, fontWeight: 700 }}>Trạng thái</label>
              <CustomSelect
                value={filters.status || ""}
                onChange={(v) => applyFilter("status", v)}
                options={ARTICLE_STATUS_OPTIONS}
                placeholder="Tất cả"
                menuMode="portal-bottom"
              />
            </div>
            <div className="form-group">
              <label className="form-label" style={{ marginBottom: 6, textTransform: "uppercase", fontSize: 11, fontWeight: 700 }}>Danh mục</label>
              <CustomSelect
                value={filters.category || ""}
                onChange={(v) => applyFilter("category", v)}
                options={[{ value: "", label: "Tất cả" }, ...visibleCategoryOptions.map((category) => ({ value: category, label: category }))]}
                placeholder="Tất cả"
                menuMode="portal-bottom"
              />
            </div>
            <div className="form-group">
              <label className="form-label" style={{ marginBottom: 6, textTransform: "uppercase", fontSize: 11, fontWeight: 700 }}>Loại bài</label>
              <CustomSelect
                value={filters.articleType || ""}
                onChange={(v) => applyFilter("articleType", v)}
                options={[{ value: "", label: "Tất cả" }, ...visibleArticleTypeOptions.map(t => ({ value: t, label: t }))]}
                placeholder="Tất cả"
                menuMode="portal-bottom"
              />
            </div>
            <div className="form-group">
              <label className="form-label" style={{ marginBottom: 6, textTransform: "uppercase", fontSize: 11, fontWeight: 700 }}>Tháng/Năm</label>
              <div className="flex gap-2">
                <div style={{ flex: 1 }}>
                  <CustomSelect
                    value={filters.month || ""}
                    onChange={(v) => applyFilter("month", v)}
                    options={MONTH_OPTIONS}
                    placeholder="Tháng"
                    menuMode="portal-bottom"
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <CustomSelect
                    value={filters.year || ""}
                    onChange={(v) => applyFilter("year", v)}
                    options={YEAR_OPTIONS}
                    placeholder="Năm"
                    menuMode="portal-bottom"
                  />
                </div>
              </div>
            </div>
            
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
              <button 
                className="btn-ios-pill" 
                onClick={clearFilters}
                style={{ background: "rgba(239, 68, 68, 0.08)", color: "var(--danger)", border: "1px solid rgba(239, 68, 68, 0.16)", justifyContent: "center" }}
              >
                Xóa tất cả
              </button>
              <button 
                className="btn-ios-pill btn-ios-primary" 
                onClick={() => setShowFilters(false)}
                style={{ justifyContent: "center" }}
              >
                Áp dụng
              </button>
            </div>
          </div>
        </BottomSheet>
      )}

      {contentWorkPromptArticle && (
        <div className="modal-overlay" style={{ zIndex: 1200 }}>
          <div className="modal" style={{ width: "min(92vw, 520px)", maxWidth: 520 }}>
            <div className="modal-header">
              <h3 className="modal-title">Đăng ký Content Work</h3>
            </div>
            <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ padding: 16, borderRadius: 18, background: "rgba(37, 99, 235, 0.08)", border: "1px solid rgba(37, 99, 235, 0.16)" }}>
                <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, color: "var(--text-main)" }}>
                  Bài <strong>{contentWorkPromptArticle.title}</strong> đã lưu thành công. Bạn có muốn hệ thống tự đăng ký Content Work ngay bây giờ không?
                </p>
              </div>
              <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: "var(--text-muted)" }}>
                Hệ thống sẽ gửi form và điền link vào sheet Content Work ở nền. Bạn có thể theo dõi tiến độ ở tab <strong>Content Work</strong>.
              </p>
            </div>
            <div className="modal-footer" style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "flex-end" }}>
              <button className="btn-ios-pill btn-ios-secondary" onClick={() => setContentWorkPromptArticle(null)} disabled={registeringContentWork}>
                Để sau
              </button>
              <button className="btn-ios-pill btn-ios-primary" onClick={() => handleRegisterContentWork(contentWorkPromptArticle)} disabled={registeringContentWork}>
                {registeringContentWork ? "Đang xử lý..." : "Đăng ký Content Work"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ══════════════════════════ TEAM ══════════════════════════ */






