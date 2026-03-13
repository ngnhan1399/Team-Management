"use client";

import React, { useCallback, useDeferredValue, useEffect, useState } from "react";
import { useAuth } from "./auth-context";
import dynamic from "next/dynamic";
import CustomSelect from "./CustomSelect";
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
  LINK_RECHECK_INTERVAL_MS,
  MANAGER_DEFAULT_PEN_NAME,
  MONTH_OPTIONS,
  REQUIRED_IMPORT_FIELDS,
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
import { foldSearchText, matchesLooseSearch } from "@/lib/normalize";
import { getPreferredArticleNavigationLink } from "@/lib/review-link";
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

export default function ArticlesPage() {
  type LinkHealthStatus = "ok" | "broken" | "unknown";
  type LinkHealthEntry = { status: LinkHealthStatus; checkedAt: number };
  const { user } = useAuth();
  const importInputRef = React.useRef<HTMLInputElement>(null);
  const articlesRequestAbortRef = React.useRef<AbortController | null>(null);
  const collaboratorsRequestRef = React.useRef<Promise<void> | null>(null);
  const linkHealthRef = React.useRef<Record<string, LinkHealthEntry>>({});
  const importInputId = React.useId();
  const [articles, setArticles] = useState<Article[]>([]);
  const deferredArticles = useDeferredValue(articles);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 0 });
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [collaboratorsLoading, setCollaboratorsLoading] = useState(false);
  const [collaboratorsLoaded, setCollaboratorsLoaded] = useState(false);
  const [formData, setFormData] = useState<Partial<Article>>({});
  const [savingArticle, setSavingArticle] = useState(false);
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
  const [filters, setFilters] = useState<ArticleFilters>(createCurrentMonthFilters);
  const [linkHealth, setLinkHealth] = useState<Record<string, LinkHealthEntry>>({});
  const [linkCheckLoading, setLinkCheckLoading] = useState(false);
  const [showCommentsModal, setShowCommentsModal] = useState(false);
  const [commentArticle, setCommentArticle] = useState<Article | null>(null);
  const [comments, setComments] = useState<ArticleComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentContent, setCommentContent] = useState("");
  const [commentAttachment, setCommentAttachment] = useState("");
  const [commentSaving, setCommentSaving] = useState(false);
  const isAdmin = user?.role === "admin";
  const collaboratorRole = typeof user?.collaborator?.role === "string" ? user.collaborator.role : "";
  const isReviewer = user?.role === "ctv" && collaboratorRole === "reviewer";
  const isWriter = user?.role === "ctv" && collaboratorRole === "writer";
  const canManageArticles = isAdmin;
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
  const reviewerIdentityValues = Array.from(new Set([
    user?.collaborator?.name,
    user?.collaborator?.penName,
    user?.email?.split("@")[0],
    user?.email,
  ].map((value) => normalizeIdentityValue(value)).filter(Boolean)));
  const mappedFields = Object.values(importMapping).filter(Boolean);
  const duplicateMappedFields = mappedFields.filter((field, index) => mappedFields.indexOf(field) !== index);
  const missingRequiredImportFields = REQUIRED_IMPORT_FIELDS.filter((field) => !mappedFields.includes(field));

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

  const articleMatchesReviewerScope = useCallback((article: Article) => {
    const normalizedReviewerName = normalizeIdentityValue(article.reviewerName);
    return article.status === "Submitted" || (!!normalizedReviewerName && reviewerIdentityValues.includes(normalizedReviewerName));
  }, [reviewerIdentityValues]);

  const canEditArticle = useCallback((article: Article) => {
    if (canManageArticles) return true;
    if (!isWriter) return false;
    return article.penName === user?.collaborator?.penName || article.createdByUserId === user?.id;
  }, [canManageArticles, isWriter, user]);

  const fetchArticles = useCallback((p = 1, s = "", f: ArticleFilters = createCurrentMonthFilters()) => {
    articlesRequestAbortRef.current?.abort();
    const controller = new AbortController();
    articlesRequestAbortRef.current = controller;
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), limit: String(ARTICLE_PAGE_SIZE) });
    if (s) params.set("search", s);
    if (isWriter && user?.collaborator?.penName) params.set("penName", user.collaborator.penName);
    else if (f.penName) params.set("penName", f.penName);
    if (f.status) params.set("status", f.status);
    if (f.category) params.set("category", f.category);
    if (f.articleType) params.set("articleType", f.articleType);
    if (f.contentType) params.set("contentType", f.contentType);
    if (f.month) params.set("month", f.month);
    if (f.year) params.set("year", f.year);
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
          setLoading(false);
        }
      });
  }, [isWriter, user]);

  useEffect(() => {
    fetchArticles(1, "", createCurrentMonthFilters());
  }, [fetchArticles]);

  useEffect(() => () => {
    articlesRequestAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    linkHealthRef.current = linkHealth;
  }, [linkHealth]);

  useEffect(() => {
    const published = deferredArticles.filter(a => isApprovedArticleStatus(a.status) && a.link && a.link.startsWith("http"));
    if (published.length === 0) {
      setLinkHealth((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }
    const urls = Array.from(new Set(published.map(a => a.link).filter(Boolean)));
    setLinkHealth((prev) => {
      const next = Object.fromEntries(
        Object.entries(prev).filter(([url]) => urls.includes(url))
      );
      const prevEntries = Object.entries(prev);
      const nextEntries = Object.entries(next);
      const hasSameEntries = prevEntries.length === nextEntries.length
        && prevEntries.every(([url, entry]) => {
          const nextEntry = next[url];
          return nextEntry?.status === entry.status && nextEntry?.checkedAt === entry.checkedAt;
        });
      return hasSameEntries ? prev : next;
    });
  }, [deferredArticles]);

  const checkVisibleLinks = useCallback(async () => {
    const published = deferredArticles.filter((article) => (
      isApprovedArticleStatus(article.status) && article.link && article.link.startsWith("http")
    ));
    const urls = Array.from(new Set(published.map((article) => article.link).filter(Boolean)));
    const now = Date.now();
    const pendingUrls = urls.filter((url) => {
      const existingEntry = linkHealthRef.current[url];
      if (!existingEntry) return true;
      if (existingEntry.status === "ok") return false;
      return now - existingEntry.checkedAt >= LINK_RECHECK_INTERVAL_MS;
    }).slice(0, 10);

    if (pendingUrls.length === 0) {
      return;
    }

    setLinkCheckLoading(true);
    try {
      const response = await fetch("/api/check-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: pendingUrls }),
      });
      const data = await response.json();
      if (data.success && data.results) {
        const checkedAt = Date.now();
        const nextEntries = Object.fromEntries(
          Object.entries(data.results as Record<string, LinkHealthStatus>).map(([url, status]) => [
            url,
            { status, checkedAt },
          ])
        );
        setLinkHealth((prev) => ({ ...prev, ...nextEntries }));
      }
    } catch {
      // Ignore transient link check failures and keep manual retry available.
    } finally {
      setLinkCheckLoading(false);
    }
  }, [deferredArticles]);

  const handleSearch = (e?: React.FormEvent) => { e?.preventDefault(); fetchArticles(1, search, filters); };
  const applyFilter = (key: string, val: string) => { const f = { ...filters, [key]: val }; setFilters(f); fetchArticles(1, search, f); };
  const clearFilters = () => { const f = createCurrentMonthFilters(); setFilters(f); fetchArticles(1, search, f); };
  const activeFilterCount = Object.entries(filters).filter(([k, v]) => v !== "" && k !== "month" && k !== "year").length;
  const currentFilterDeleteCriteria: ArticleDeleteCriteria = {
    search,
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
    const hasCurrentFilters = search.trim() !== "" || activeFilterCount > 0;
    setDeleteMode(hasCurrentFilters ? "current_filters" : "custom");
    setDeleteCriteria({
      ...EMPTY_DELETE_CRITERIA,
      search,
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
    setFormData(nextFormData);
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
    showUiToast("Dang xoa du lieu", `He thong dang xu ly ${deletePreview.total} bai viet.`, "info");
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
        "Da xoa bai viet",
        data.sheetSyncWarnings?.length
          ? `Da xoa ${data.deletedCount} bai viet. Co ${data.sheetSyncWarnings.length} canh bao dong bo Google Sheet.`
          : data.backgroundSyncQueued
            ? `Da xoa ${data.deletedCount} bai viet. Google Sheet dang dong bo nen.`
          : `Da xoa ${data.deletedCount} bai viet va reset du lieu nhuận but lien quan.`,
        data.sheetSyncWarnings?.length ? "warning" : data.backgroundSyncQueued ? "info" : "success"
      );
      fetchArticles(1, search, filters);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDeleteError(message);
      showUiToast("Xoa that bai", message, "error");
    } finally {
      setDeleteExecuting(false);
    }
  };

  const deleteSingleArticle = async (article: Article) => {
    if (deletingArticleIds.includes(article.id)) return;

    if (!article.canDelete && !canManageArticles) {
      showUiToast("Khong the xoa bai", "Ban chi co the xoa bai do chinh minh tao.", "error");
      return;
    }

    const confirmed = window.confirm(`Xóa bài "${article.title}"?\n\nHệ thống cũng sẽ xóa comment/review liên quan và reset các dòng nhuận bút bị ảnh hưởng để tránh lệch dữ liệu.`);
    if (!confirmed) return;

    setDeletingArticleIds((prev) => (prev.includes(article.id) ? prev : [...prev, article.id]));
    showUiToast("Dang xoa bai viet", `Dang xu ly "${article.title}".`, "info");
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
        "Da xoa bai viet",
        data.sheetSyncWarnings?.length
          ? `Da xoa "${article.title}". Google Sheet con ${data.sheetSyncWarnings.length} canh bao can kiem tra.`
          : data.backgroundSyncQueued
            ? `Da xoa "${article.title}". Google Sheet dang dong bo nen.`
          : `Da xoa "${article.title}".`,
        data.sheetSyncWarnings?.length ? "warning" : data.backgroundSyncQueued ? "info" : "success"
      );
      fetchArticles(pagination.page, search, filters);
    } catch (error) {
      showUiToast("Xoa bai that bai", error instanceof Error ? error.message : String(error), "error");
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
    fetchArticles(pagination.page || 1, search, filters);
    if (commentArticle) {
      fetchComments(commentArticle.id);
    }
  }, [commentArticle, fetchArticles, fetchComments, filters, pagination.page, search]);

  useRealtimeRefresh(["articles", "dashboard"], refreshArticlesView);

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

    try {
      setSavingArticle(true);
      const isEditing = Boolean(formData.id);
      const res = await fetch("/api/articles", {
        method: formData.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
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
        mergeSavedArticleIntoList(data.article as Article, isEditing);
      } else {
        fetchArticles(pagination.page || 1, search, filters);
      }
      if (data.backgroundSyncQueued) {
        const savedTitle = String(data.article?.title || formData.title || "bài viết");
        showUiToast(
          isEditing ? "Da cap nhat bai viet" : "Da luu bai viet",
          `"${savedTitle}" da luu. Google Sheet dang dong bo nen.`,
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
        fetchArticles(1, search, filters);
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
    const normalizedSearch = foldSearchText(search);
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
  }, [articleMatchesReviewerScope, canManageArticles, collaborators, filters, isReviewer, isWriter, search, user]);

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

    setSearch("");
    setFilters(nextFilters);
    setPagination((prev) => ({ ...prev, page: 1 }));
    fetchArticles(1, "", nextFilters);
  };

  const executeGoogleSheetSync = async (options?: { month?: string; year?: string; closeModalOnSuccess?: boolean }) => {
    const selectedMonth = options?.month ?? googleSyncMonth;
    const selectedYear = options?.year ?? googleSyncYear;

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
      if (options?.closeModalOnSuccess) {
        setShowGoogleSyncModal(false);
      }
    } catch (error) {
      setGoogleSyncError(String(error));
      setGoogleSyncResult(null);
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
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 8, background: style.bg, color: style.text, fontSize: 12, fontWeight: 700 }}>
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
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 10,
          fontWeight: 800,
          color: style.color,
          background: style.background,
          border: style.border,
          padding: "5px 9px",
          borderRadius: 999,
          textTransform: "uppercase",
          whiteSpace: "nowrap",
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

    const health = article.link ? linkHealth[article.link] : undefined;

    if (isApprovedArticleStatus(article.status) && health?.status === "broken") {
      return (
        <span title="Link lỗi" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--danger)" }}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>link_off</span>
        </span>
      );
    }

    if (isApprovedArticleStatus(article.status) && health?.status === "ok") {
      return (
        <span title="Link hoạt động" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--success)" }}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>link</span>
        </span>
      );
    }

    if (isApprovedArticleStatus(article.status) && health?.status === "unknown") {
      return (
        <span title="Chưa xác minh được link. Bạn có thể bấm 'Kiểm tra link' khi cần." style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--accent-orange)" }}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>help_center</span>
        </span>
      );
    }

    return (
      <span title={isApprovedArticleStatus(article.status) ? "Tự động kiểm tra link đang tắt để tiết kiệm usage" : "Có link"} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--accent-blue)" }}>
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>link</span>
      </span>
    );
  };

  const authorBucketBadge = (article: Article) => {
    const isEditorialArticle = article.authorBucket === "editorial";
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
        {article.authorBucketLabel || (isEditorialArticle ? "Biên tập/Admin" : "CTV")}
      </span>
    );
  };

  const showSplitArticleSections = shouldShowSplitArticleSections;
  const ctvArticles = articles.filter((article) => article.authorBucket !== "editorial");
  const editorialArticles = articles.filter((article) => article.authorBucket === "editorial");
  const articleTableMinWidth = showSplitArticleSections ? 980 : 1040;
  const articleSections = [
    {
      key: "ctv",
      title: "Bài của CTV",
      icon: "groups",
      accent: "#2563eb",
      background: "linear-gradient(135deg, rgba(59, 130, 246, 0.12), rgba(37, 99, 235, 0.04))",
      rows: ctvArticles,
      emptyMessage: "Chưa có bài nào ở nhóm CTV.",
    },
    {
      key: "editorial",
      title: "Bài của Biên tập/Admin",
      icon: "shield_person",
      accent: "#f97316",
      background: "linear-gradient(135deg, rgba(249, 115, 22, 0.12), rgba(234, 88, 12, 0.04))",
      rows: editorialArticles,
      emptyMessage: "Chưa có bài nào ở nhóm Biên tập/Admin.",
    },
  ] as const;

  const renderArticleTable = (rows: Article[], emptyMessage: string) => (
    <div style={{ overflowX: "auto", position: "relative", zIndex: 0 }}>
      <table style={{ width: "100%", minWidth: articleTableMinWidth, borderCollapse: "collapse", textAlign: "left", tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: "6%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "30%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "13%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "5%" }} />
          <col style={{ width: "12%" }} />
        </colgroup>
        <thead style={{ pointerEvents: "none" }}>
          <tr style={{ background: "rgba(248, 250, 252, 0.95)", backdropFilter: "blur(12px)", borderBottom: "1px solid var(--glass-border)" }}>
            <th style={{ padding: "14px 14px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>ID</th>
            <th style={{ padding: "14px 14px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Ngày</th>
            <th style={{ padding: "14px 14px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Tiêu đề</th>
            <th style={{ padding: "14px 14px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Bút danh</th>
            <th style={{ padding: "14px 14px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "center" }}>Loại bài</th>
            <th style={{ padding: "14px 14px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "center" }}>Trạng thái</th>
            <th style={{ padding: "14px 14px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "center" }}>Link</th>
            <th style={{ padding: "14px 14px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "center" }}>Thao tác</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={8}>
                <div style={{ padding: showSplitArticleSections ? 44 : 72, textAlign: "center", color: "var(--text-muted)" }}>
                  <div style={{ fontSize: showSplitArticleSections ? 28 : 36, marginBottom: 12 }}>📄</div>
                  <div style={{ fontWeight: 700 }}>{emptyMessage}</div>
                </div>
              </td>
            </tr>
          ) : (
            rows.map((a) => (
              <tr key={a.id} data-testid={`article-row-${a.id}`} style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.02)", transition: "background 0.2s" }} className="hover:bg-white/[0.02]">
                <td style={{ padding: "12px 14px", fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)" }}>{a.articleId || a.id}</td>
                <td style={{ padding: "12px 14px", fontSize: 13, color: "var(--text-main)", whiteSpace: "nowrap" }}>{a.date}</td>
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
                      }}
                    >
                      {a.title}
                    </span>
                  )}
                </td>
                <td style={{ padding: "12px 14px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
                    <span style={{ fontSize: 13, color: "var(--text-main)", whiteSpace: "nowrap", fontWeight: 600 }}>{getDisplayedPenName(a.penName)}</span>
                    {authorBucketBadge(a)}
                  </div>
                </td>
                <td style={{ padding: "12px 14px", textAlign: "center" }}>
                  {articleTypeBadge(a.articleType)}
                </td>
                <td style={{ padding: "12px 14px", textAlign: "center" }}>{statusBadge(a.status)}</td>
                <td style={{ padding: "12px 14px", textAlign: "center" }}>
                  {linkBadge(a)}
                </td>
                <td style={{ padding: "12px 14px", textAlign: "center" }}>
                  <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "nowrap", whiteSpace: "nowrap" }}>
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

  return (
    <>
      <div>
      <header style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ fontSize: 32, fontWeight: 800, color: "var(--text-main)", letterSpacing: "-0.04em" }}>Quản lý bài viết</h2>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {canManageArticles && (
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
          {canSyncArticles && (
            <>
              <button
                className="btn-ios-pill btn-ios-primary"
                onClick={() => executeGoogleSheetSync({ closeModalOnSuccess: true })}
                disabled={googleSyncLoading}
                title={canManageArticles
                  ? "Đồng bộ tab tháng mới nhất trên Google Sheet"
                  : `Đồng bộ tab tháng mới nhất trên Google Sheet trong phạm vi dữ liệu của ${collaboratorLabel}`}
                style={{ minWidth: 170, justifyContent: "center" }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>bolt</span>
                {googleSyncLoading ? "Đang đồng bộ..." : "Đồng bộ ngay"}
              </button>
              <button
                className="btn-ios-pill btn-ios-secondary"
                onClick={openGoogleSyncModal}
                disabled={googleSyncLoading}
                style={{ minWidth: 210, justifyContent: "center" }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>sync</span>
                Chọn tháng để đồng bộ
              </button>
            </>
          )}
          {canManageArticles && (
            <button data-testid="articles-open-delete-tool" className="btn-ios-pill" onClick={openDeleteTool} style={{ background: "rgba(239, 68, 68, 0.08)", color: "var(--danger)", border: "1px solid rgba(239, 68, 68, 0.16)" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>delete_sweep</span>
              Xóa dữ liệu
            </button>
          )}
          {canManageArticles && (
            <a href="/api/export" className="btn-ios-pill btn-ios-secondary" style={{ textDecoration: "none" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>upload</span>
              Xuất
            </a>
          )}
          {canCreateArticles && (
            <button className="btn-ios-pill btn-ios-primary" onClick={() => openArticleModal({ date: new Date().toISOString().split("T")[0], penName: canManageArticles ? MANAGER_DEFAULT_PEN_NAME : user?.collaborator?.penName, status: DEFAULT_ARTICLE_STATUS, wordCountRange: "" })}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
              Thêm bài viết
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

      <div className="glass-card" style={{ padding: 20, marginBottom: 32 }}>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <div style={{ flex: 1, position: "relative" }}>
            <span className="material-symbols-outlined" style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", fontSize: 20 }}>search</span>
            <input
              data-testid="articles-search"
              type="text"
              placeholder="Tìm theo tiêu đề, tác giả, nội dung..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              style={{ width: "100%", height: 44, padding: "0 16px 0 48px", background: "rgba(0,0,0,0.03)", border: "1px solid var(--glass-border)", borderRadius: 12, color: "var(--text-main)", fontSize: 14 }}
            />
          </div>
          <button className="btn-ios-pill btn-ios-secondary" onClick={toggleFilters} style={{ height: 44 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>tune</span>
            Bộ lọc {activeFilterCount > 0 && <span style={{ marginLeft: 6, padding: "2px 6px", background: "var(--accent-blue)", color: "white", borderRadius: 6, fontSize: 10, fontWeight: 800 }}>{activeFilterCount}</span>}
          </button>
          {activeFilterCount > 0 && (
            <button className="btn-ios-pill" onClick={clearFilters} style={{ height: 44, background: "rgba(239, 68, 68, 0.1)", color: "#f87171", border: "1px solid rgba(239, 68, 68, 0.2)" }}>
              Xóa lọc
            </button>
          )}
          <button className="btn-ios-pill btn-ios-secondary" onClick={() => { void checkVisibleLinks(); }} disabled={linkCheckLoading} style={{ height: 44 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>link_scan</span>
            {linkCheckLoading ? "Đang kiểm tra link..." : "Kiểm tra link"}
          </button>
        </div>

        {showFilters && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16, borderTop: "1px solid var(--glass-border)", paddingTop: 24, animation: "modalFadeIn 0.2s ease" }}>
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
          {!canManageArticles && <div style={{ marginTop: 8, fontSize: 13 }}>{isReviewer ? "Tài khoản duyệt bài chỉ hiển thị bài chờ duyệt hoặc bài đã được giao cho bạn." : `Tài khoản này đang hiển thị dữ liệu của ${collaboratorLabel}. Nếu admin đã nhập bài dưới tên khác, hãy cập nhật liên kết hoặc chuẩn hóa bút danh.`}</div>}
        </div>
      ) : showSplitArticleSections ? (
        <div style={{ display: "grid", gap: 24 }}>
          {articleSections.map((section) => (
            <section key={section.key} className="glass-card" style={{ padding: 0, overflow: "hidden" }}>
              <div
                data-testid={`article-section-${section.key}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "18px 20px",
                  borderBottom: "1px solid var(--glass-border)",
                  background: section.background,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 20, color: section.accent }}>{section.icon}</span>
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "var(--text-main)" }}>{section.title}</h3>
                </div>
                <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 38, height: 38, padding: "0 12px", borderRadius: 999, background: "rgba(255, 255, 255, 0.7)", color: section.accent, fontSize: 16, fontWeight: 800 }}>
                  {section.rows.length}
                </span>
              </div>
              {renderArticleTable(section.rows, section.emptyMessage)}
            </section>
          ))}
        </div>
      ) : (
        <div className="glass-card" style={{ padding: 0, overflow: "hidden" }}>
          {renderArticleTable(articles, "Chưa có bài viết nào")}
        </div>
      )}
      {pagination.totalPages > 1 && (
        <div className="pagination">
          <button disabled={pagination.page <= 1} onClick={() => fetchArticles(pagination.page - 1, search, filters)}>← Trước</button>
          <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Trang {pagination.page} / {pagination.totalPages} ({pagination.total} bài)</span>
          <button disabled={pagination.page >= pagination.totalPages} onClick={() => fetchArticles(pagination.page + 1, search, filters)}>Sau →</button>
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
                <input className="form-input" value={formData.articleId || ""} onChange={e => setFormData({ ...formData, articleId: e.target.value })} placeholder="VD: post-123" />
              </div>
                      <div className="form-group">
                <label className="form-label">Đường dẫn bài viết (URL)</label>
                <input className="form-input" value={formData.link || ""} onChange={e => setFormData({ ...formData, link: e.target.value })} placeholder="https://domain.com/bai-viet" />
              </div>
              <div className="form-group">
                <label className="form-label">Đường dẫn duyệt bài</label>
                <input className="form-input" value={formData.reviewLink || ""} onChange={e => setFormData({ ...formData, reviewLink: e.target.value })} placeholder="https://docs.google.com/... hoặc link CMS duyệt bài" />
                <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
                  Khi bấm vào tiêu đề bài trong danh sách, hệ thống sẽ ưu tiên mở link duyệt bài này trước.
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-ios-pill btn-ios-secondary" onClick={() => setShowModal(false)} disabled={savingArticle}>Hủy bỏ</button>
              <button className="btn-ios-pill btn-ios-primary" onClick={handleSave} disabled={savingArticle}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>save</span>
                {savingArticle ? "Đang lưu..." : "Lưu thông tin"}
              </button>
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
    </>
  );
}

/* ══════════════════════════ TEAM ══════════════════════════ */
