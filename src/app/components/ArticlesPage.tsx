"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "./auth-context";
import CustomSelect from "./CustomSelect";
import { useRealtimeRefresh } from "./realtime";
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

const IMPORT_FIELD_OPTIONS = [
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

const REQUIRED_IMPORT_FIELDS = ["date", "title", "penName"];
const IMPORTANT_IMPORT_FIELDS = ["articleId", "date", "title", "penName", "status", "link"];
const ARTICLE_TYPE_OPTIONS = ["Mô tả SP ngắn", "Mô tả SP dài", "Bài dịch Review SP", "Bài SEO ICT", "Bài SEO Gia dụng", "Bài SEO ICT 1K5", "Bài SEO Gia dụng 1K5", "Bài SEO ICT 2K", "Bài SEO Gia dụng 2K", "Thủ thuật"];
const CONTENT_TYPE_OPTIONS = ["Viết mới", "Viết lại"];
const ARTICLE_STATUS_OPTIONS = [
  { value: "", label: "Tất cả" },
  { value: "Draft", label: "📋 Nháp" },
  { value: "Submitted", label: "📤 Chờ duyệt" },
  { value: "Reviewing", label: "🔎 Đang duyệt" },
  { value: "Published", label: "✅ Đã duyệt" },
  { value: "NeedsFix", label: "⚠️ Sửa lỗi" },
  { value: "Rejected", label: "⛔ Từ chối" },
];
const MONTH_OPTIONS = [{ value: "", label: "Tháng" }, ...Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `Tháng ${i + 1}` }))];
const YEAR_OPTIONS = [{ value: "", label: "Năm" }, ...Array.from({ length: 6 }, (_, i) => {
  const year = new Date().getFullYear() - 2 + i;
  return { value: String(year), label: String(year) };
})];
const EMPTY_DELETE_CRITERIA: ArticleDeleteCriteria = {
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

export default function ArticlesPage() {
  const { user } = useAuth();
  const importInputRef = React.useRef<HTMLInputElement>(null);
  const importInputId = React.useId();
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [reviewArticle, setReviewArticle] = useState<Article | null>(null);
  const [errorNotes, setErrorNotes] = useState("");
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 0 });
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [formData, setFormData] = useState<Partial<Article>>({});
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
  const [deleteError, setDeleteError] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({ penName: "", status: "", category: "", articleType: "", contentType: "", month: "", year: "" });
  const [brokenLinks, setBrokenLinks] = useState<Record<string, boolean>>({});
  const [showCommentsModal, setShowCommentsModal] = useState(false);
  const [commentArticle, setCommentArticle] = useState<Article | null>(null);
  const [comments, setComments] = useState<ArticleComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentContent, setCommentContent] = useState("");
  const [commentAttachment, setCommentAttachment] = useState("");
  const [commentSaving, setCommentSaving] = useState(false);
  const isAdmin = user?.role === "admin";
  const collaboratorLabel = user?.collaborator?.penName || user?.collaborator?.name || "tài khoản của bạn";
  const mappedFields = Object.values(importMapping).filter(Boolean);
  const duplicateMappedFields = mappedFields.filter((field, index) => mappedFields.indexOf(field) !== index);
  const missingRequiredImportFields = REQUIRED_IMPORT_FIELDS.filter((field) => !mappedFields.includes(field));

  const fetchArticles = useCallback((p = 1, s = "", f = { penName: "", status: "", category: "", articleType: "", contentType: "", month: "", year: "" }) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), limit: "30" });
    if (s) params.set("search", s);
    if (!isAdmin && user?.collaborator?.penName) params.set("penName", user.collaborator.penName);
    else if (f.penName) params.set("penName", f.penName);
    if (f.status) params.set("status", f.status);
    if (f.category) params.set("category", f.category);
    if (f.articleType) params.set("articleType", f.articleType);
    if (f.contentType) params.set("contentType", f.contentType);
    if (f.month) params.set("month", f.month);
    if (f.year) params.set("year", f.year);
    fetch(`/api/articles?${params}`, { cache: "no-store" }).then(r => r.json()).then(d => { setArticles(d.data || []); setPagination(d.pagination || {}); setLoading(false); }).catch(() => setLoading(false));
  }, [isAdmin, user]);

  useEffect(() => {
    fetchArticles();
    fetch("/api/collaborators", { cache: "no-store" }).then(r => r.json()).then(d => setCollaborators(d.data || []));
  }, [fetchArticles]);

  useEffect(() => {
    const published = articles.filter(a => a.status === "Published" && a.link && a.link.startsWith("http"));
    if (published.length === 0) return;
    const urls = published.map(a => a.link).filter(Boolean);
    fetch("/api/check-links", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ urls }) })
      .then(r => r.json())
      .then(d => { if (d.success) setBrokenLinks(d.results); })
      .catch(() => { });
  }, [articles]);

  const handleSearch = (e?: React.FormEvent) => { e?.preventDefault(); fetchArticles(1, search, filters); };
  const applyFilter = (key: string, val: string) => { const f = { ...filters, [key]: val }; setFilters(f); fetchArticles(1, search, f); };
  const clearFilters = () => { const f = { penName: "", status: "", category: "", articleType: "", contentType: "", month: "", year: "" }; setFilters(f); fetchArticles(1, search, f); };
  const activeFilterCount = Object.values(filters).filter(v => v !== "").length;
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
        throw new Error(data.error || "Không thể xóa dữ liệu");
      }
      alert(`✅ Đã xóa ${data.deletedCount} bài viết. Nhuận bút đã được reset để tránh lệch dữ liệu.`);
      setShowDeleteModal(false);
      setDeletePreview(null);
      fetchArticles(1, search, filters);
    } catch (error) {
      setDeleteError(String(error));
    } finally {
      setDeleteExecuting(false);
    }
  };

  const deleteSingleArticle = async (article: Article) => {
    if (!article.canDelete && !isAdmin) {
      alert("❌ Bạn chỉ có thể xóa bài do chính mình tạo.");
      return;
    }

    const confirmed = window.confirm(`Xóa bài "${article.title}"?\n\nHệ thống cũng sẽ xóa comment/review liên quan và reset các dòng nhuận bút bị ảnh hưởng để tránh lệch dữ liệu.`);
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/articles?id=${article.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Không thể xóa bài viết");
      }
      fetchArticles(1, search, filters);
      alert(`✅ Đã xóa bài "${article.title}".`);
    } catch (error) {
      alert("❌ " + String(error));
    }
  };

  const fetchComments = useCallback(async (articleId: number) => {
    setCommentsLoading(true);
    try {
      const res = await fetch(`/api/articles/comments?articleId=${articleId}`, { cache: "no-store" });
      const data = await res.json();
      if (data.success) {
        setComments(data.data || []);
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
    if (!formData.title || !formData.penName || !formData.date) return;
    await fetch("/api/articles", { method: formData.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(formData) });
    setShowModal(false); setFormData({}); fetchArticles(pagination.page);
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
        fetchArticles();
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

      setGoogleSyncResult(data as GoogleSheetSyncResult);
      fetchArticles(pagination.page || 1, search, filters);
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

  const handleReview = async () => {
    if (!reviewArticle || !errorNotes) return;
    await fetch("/api/articles/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ articleId: reviewArticle.id, errorNotes }) });
    setShowReviewModal(false); setErrorNotes(""); setReviewArticle(null);
    alert("✅ Đã gửi lỗi cho CTV!"); fetchArticles(pagination.page);
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

    if (article.status === "Published" && brokenLinks[article.link] === false) {
      return (
        <span title="Link lỗi" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--danger)" }}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>link_off</span>
        </span>
      );
    }

    if (article.status === "Published" && brokenLinks[article.link] === true) {
      return (
        <span title="Link hoạt động" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--success)" }}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>link</span>
        </span>
      );
    }

    return (
      <span title="Có link" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--accent-blue)" }}>
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>link</span>
      </span>
    );
  };

  return (
    <>
      <header style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ fontSize: 32, fontWeight: 800, color: "var(--text-main)", letterSpacing: "-0.04em" }}>Quản lý bài viết</h2>
          <p style={{ color: "var(--text-muted)", marginTop: 4, fontSize: 14 }}>
            {isAdmin ? "Quản lý và theo dõi toàn bộ bài viết của đội ngũ." : `Theo dõi bài viết thuộc tài khoản ${collaboratorLabel}.`}
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {isAdmin && (
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
          {isAdmin && (
            <button
              className="btn-ios-pill btn-ios-primary"
              onClick={() => executeGoogleSheetSync({ month: "", year: "", closeModalOnSuccess: true })}
              disabled={googleSyncLoading}
              title="Đồng bộ tab tháng mới nhất ngay lập tức"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>bolt</span>
              {googleSyncLoading ? "Đang đồng bộ..." : "Đồng bộ ngay"}
            </button>
          )}
          {isAdmin && (
            <button className="btn-ios-pill btn-ios-secondary" onClick={openGoogleSyncModal} disabled={googleSyncLoading}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>sync</span>
              Chọn tháng để đồng bộ
            </button>
          )}
          {isAdmin && !googleSyncLoading && googleSyncResult && (
            <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600, padding: "0 6px" }}>
              Đã sync {googleSyncResult.sheetName}: thêm {googleSyncResult.inserted}, bỏ qua {googleSyncResult.duplicates}
            </div>
          )}
          {isAdmin && (
            <button data-testid="articles-open-delete-tool" className="btn-ios-pill" onClick={openDeleteTool} style={{ background: "rgba(239, 68, 68, 0.08)", color: "var(--danger)", border: "1px solid rgba(239, 68, 68, 0.16)" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>delete_sweep</span>
              Xóa dữ liệu
            </button>
          )}
          {isAdmin && (
            <a href="/api/export" className="btn-ios-pill btn-ios-secondary" style={{ textDecoration: "none" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>upload</span>
              Xuất
            </a>
          )}
          <button className="btn-ios-pill btn-ios-primary" onClick={() => { setFormData({ date: new Date().toISOString().split("T")[0], penName: isAdmin ? "" : user?.collaborator?.penName }); setShowModal(true); }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
            Thêm bài viết
          </button>
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
          <button className="btn-ios-pill btn-ios-secondary" onClick={() => setShowFilters(!showFilters)} style={{ height: 44 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>tune</span>
            Bộ lọc {activeFilterCount > 0 && <span style={{ marginLeft: 6, padding: "2px 6px", background: "var(--accent-blue)", color: "white", borderRadius: 6, fontSize: 10, fontWeight: 800 }}>{activeFilterCount}</span>}
          </button>
          {activeFilterCount > 0 && (
            <button className="btn-ios-pill" onClick={clearFilters} style={{ height: 44, background: "rgba(239, 68, 68, 0.1)", color: "#f87171", border: "1px solid rgba(239, 68, 68, 0.2)" }}>
              Xóa lọc
            </button>
          )}
        </div>

        {showFilters && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16, borderTop: "1px solid var(--glass-border)", paddingTop: 24, animation: "modalFadeIn 0.2s ease" }}>
            {isAdmin && (
              <div className="form-group">
                <label className="form-label" style={{ marginBottom: 6, textTransform: "uppercase", fontSize: 11, fontWeight: 700 }}>Cộng tác viên</label>
                <CustomSelect
                  value={filters.penName || ""}
                  onChange={(v) => applyFilter("penName", v)}
                  options={[{ value: "", label: "Tất cả CTV" }, ...collaborators.filter(c => c.role === "writer").map(c => ({ value: c.penName, label: c.penName }))]}
                  placeholder="Tất cả CTV"
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
              <label className="form-label" style={{ marginBottom: 6, textTransform: "uppercase", fontSize: 11, fontWeight: 700 }}>Loại bài</label>
              <CustomSelect
                value={filters.articleType || ""}
                onChange={(v) => applyFilter("articleType", v)}
                options={[{ value: "", label: "Tất cả" }, ...ARTICLE_TYPE_OPTIONS.map(t => ({ value: t, label: t }))]}
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

      <div className="glass-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto", maxHeight: "calc(100vh - 320px)", minHeight: 460 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", tableLayout: "fixed" }}>
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
            <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
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
              {loading ? (
                <tr><td colSpan={8} style={{ textAlign: "center", padding: 60, color: "var(--accent-blue)", fontWeight: 600 }}>⏳ Đang tải bài viết...</td></tr>
              ) : articles.length === 0 ? (
                <tr><td colSpan={8}><div style={{ padding: 80, textAlign: "center", color: "var(--text-muted)" }}><div style={{ fontSize: 40, marginBottom: 16 }}>📄</div><div style={{ fontWeight: 600 }}>Chưa có bài viết nào</div>{!isAdmin && <div style={{ marginTop: 8, fontSize: 13 }}>Tài khoản này đang hiển thị dữ liệu của {collaboratorLabel}. Nếu admin đã nhập bài dưới tên khác, hãy cập nhật liên kết hoặc chuẩn hóa bút danh.</div>}</div></td></tr>
              ) : (
                articles.map((a) => (
                  <tr key={a.id} data-testid={`article-row-${a.id}`} style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.02)", transition: "background 0.2s" }} className="hover:bg-white/[0.02]">
                    <td style={{ padding: "12px 14px", fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)" }}>{a.articleId || a.id}</td>
                    <td style={{ padding: "12px 14px", fontSize: 13, color: "var(--text-main)", whiteSpace: "nowrap" }}>{a.date}</td>
                    <td style={{ padding: "12px 14px" }}>
                      {a.link ? (
                        <a
                          href={a.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={a.title}
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
                          }}
                        >
                          {a.title}
                        </a>
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
                    <td style={{ padding: "12px 14px", fontSize: 13, color: "var(--text-main)", whiteSpace: "nowrap" }}>{a.penName}</td>
                    <td style={{ padding: "12px 14px", textAlign: "center" }}>
                      {articleTypeBadge(a.articleType)}
                    </td>
                    <td style={{ padding: "12px 14px", textAlign: "center" }}>{statusBadge(a.status)}</td>
                    <td style={{ padding: "12px 14px", textAlign: "center" }}>
                      {linkBadge(a)}
                    </td>
                    <td style={{ padding: "12px 14px", textAlign: "center" }}>
                      <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "nowrap", whiteSpace: "nowrap" }}>
                        <button data-testid={`article-comment-${a.id}`} onClick={() => openComments(a)} className="btn-ios-pill btn-ios-secondary" style={{ padding: "5px 9px", minWidth: 34, height: 34 }} title="Bình luận">
                          <span className="material-symbols-outlined" style={{ fontSize: 17 }}>forum</span>
                        </button>
                        <button onClick={() => { setFormData(a); setShowModal(true); }} className="btn-ios-pill btn-ios-secondary" style={{ padding: "5px 9px", minWidth: 34, height: 34 }} title="Sửa">
                          <span className="material-symbols-outlined" style={{ fontSize: 17 }}>edit</span>
                        </button>
                        {(isAdmin || a.canDelete) && (
                          <button data-testid={`article-delete-${a.id}`} onClick={() => deleteSingleArticle(a)} className="btn-ios-pill" style={{ padding: "5px 9px", minWidth: 34, height: 34, background: "rgba(239, 68, 68, 0.08)", color: "var(--danger)", border: "1px solid rgba(239, 68, 68, 0.16)" }} title="Xóa bài">
                            <span className="material-symbols-outlined" style={{ fontSize: 17 }}>delete</span>
                          </button>
                        )}
                        {isAdmin && a.status === "Submitted" && (
                          <button onClick={() => { setReviewArticle(a); setShowReviewModal(true); }} className="btn-ios-pill" style={{ padding: "5px 9px", minWidth: 34, height: 34, background: "rgba(168, 85, 247, 0.1)", color: "#a855f7", border: "1px solid rgba(168, 85, 247, 0.2)" }} title="Duyệt lỗi">
                            <span className="material-symbols-outlined" style={{ fontSize: 17 }}>rule</span>
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
      </div>
      {pagination.totalPages > 1 && (
        <div className="pagination">
          <button disabled={pagination.page <= 1} onClick={() => fetchArticles(pagination.page - 1)}>← Trước</button>
          <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Trang {pagination.page} / {pagination.totalPages} ({pagination.total} bài)</span>
          <button disabled={pagination.page >= pagination.totalPages} onClick={() => fetchArticles(pagination.page + 1)}>Sau →</button>
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
                  {isAdmin ? (
                    <CustomSelect
                      value={formData.penName || ""}
                      onChange={v => setFormData({ ...formData, penName: v })}
                      options={[{ value: "", label: "Chọn CTV" }, ...collaborators.map(c => ({ value: c.penName, label: c.penName }))]}
                    />
                  ) : (
                    <input className="form-input" value={formData.penName || ""} readOnly style={{ background: "rgba(255,255,255,0.01)", opacity: 0.6 }} />
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
                    options={ARTICLE_TYPE_OPTIONS.map(t => ({ value: t, label: t }))}
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
                  <label className="form-label">Trạng thái hiện tại</label>
                  <CustomSelect
                    value={formData.status || "Draft"}
                    onChange={v => setFormData({ ...formData, status: v })}
                    options={[
                      { value: "Draft", label: "Bản nháp" },
                      { value: "Submitted", label: "Chờ duyệt" },
                      ...(isAdmin ? [
                        { value: "Reviewing", label: "Đang duyệt" },
                        { value: "Published", label: "Đã duyệt" },
                        { value: "NeedsFix", label: "Sửa lỗi" },
                        { value: "Rejected", label: "Từ chối" }
                      ] : [])
                    ]}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Mã ID hệ thống</label>
                  <input className="form-input" value={formData.articleId || ""} onChange={e => setFormData({ ...formData, articleId: e.target.value })} placeholder="VD: post-123" />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Đường dẫn bài viết (URL)</label>
                <input className="form-input" value={formData.link || ""} onChange={e => setFormData({ ...formData, link: e.target.value })} placeholder="https://domain.com/bai-viet" />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-ios-pill btn-ios-secondary" onClick={() => setShowModal(false)}>Hủy bỏ</button>
              <button className="btn-ios-pill btn-ios-primary" onClick={handleSave}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>save</span>
                Lưu thông tin
              </button>
            </div>
          </div>
        </div>
      )}

      {showReviewModal && reviewArticle && (
        <div className="modal-overlay" onClick={() => setShowReviewModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Thông báo lỗi bài viết</h3>
              <button className="modal-close" onClick={() => setShowReviewModal(false)}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
              </button>
            </div>
            <div className="modal-body">
              <div style={{ padding: 16, background: "rgba(0,0,0,0.02)", borderRadius: 16, marginBottom: 24, border: "1px solid var(--glass-border)" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>Đang đánh giá bài viết</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-main)" }}>{reviewArticle.title}</div>
                <div style={{ fontSize: 13, color: "var(--accent-blue)", marginTop: 4, fontWeight: 600 }}>Tác giả: {reviewArticle.penName}</div>
              </div>
              <div className="form-group">
                <label className="form-label">Mô tả chi tiết lỗi cần sửa</label>
                <textarea
                  className="form-input"
                  value={errorNotes}
                  onChange={e => setErrorNotes(e.target.value)}
                  placeholder="CTV ơi, bài này cần chỉnh sửa lại các phần sau..."
                  rows={6}
                  style={{ resize: "none", background: "rgba(255,255,255,0.04)", padding: 16 }}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-ios-pill btn-ios-secondary" onClick={() => setShowReviewModal(false)}>Đóng</button>
              <button className="btn-ios-pill btn-ios-primary" style={{ background: "var(--accent-orange)" }} onClick={handleReview}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>send</span>
                Gửi yêu cầu chỉnh sửa
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
                <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>Tác giả: {commentArticle.penName}</div>
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
                        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--accent-blue)" }}>{c.penName}</span>
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

      {showGoogleSyncModal && isAdmin && (
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
                  Hệ thống sẽ đọc Google Sheet công việc, tự tìm tab <strong>tháng/năm mới nhất</strong> nếu bạn để trống,
                  hoặc khớp đúng tab theo tháng/năm bạn chọn rồi nhập vào danh sách bài viết. Những bài đã có sẵn sẽ
                  được bỏ qua để tránh trùng lặp dữ liệu khi đồng bộ nhiều lần.
                </div>
                <a
                  href="https://docs.google.com/spreadsheets/d/1Uj8iA0R5oWmONenkESHZ8i7Hc1D8UOk6ES6olZGTbH8/edit?gid=75835251#gid=75835251"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ marginTop: 10, display: "inline-flex", alignItems: "center", gap: 6, color: "var(--accent-blue)", textDecoration: "none", fontSize: 13, fontWeight: 700 }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>open_in_new</span>
                  Mở Google Sheet nguồn
                </a>
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
                      { label: "Đã có sẵn", value: googleSyncResult.duplicates, color: "var(--accent-blue)", icon: "content_copy" },
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
              <button className="btn-ios-pill btn-ios-primary" onClick={() => executeGoogleSheetSync()} disabled={googleSyncLoading}>
                {googleSyncLoading ? (
                  <><span className="material-symbols-outlined" style={{ fontSize: 18, animation: "spin 1s linear infinite" }}>sync</span> Đang đồng bộ...</>
                ) : (
                  <><span className="material-symbols-outlined" style={{ fontSize: 18 }}>sync</span> Đồng bộ ngay</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteModal && isAdmin && (
        <div className="modal-overlay" onClick={() => !deleteLoading && !deleteExecuting && setShowDeleteModal(false)}>
          <div data-testid="article-delete-modal" className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 1080, width: "94vw" }}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="material-symbols-outlined" style={{ color: "var(--danger)" }}>delete_sweep</span>
                Công cụ xóa bài viết thông minh
              </h3>
              <button className="modal-close" onClick={() => !deleteLoading && !deleteExecuting && setShowDeleteModal(false)}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
              </button>
            </div>

            <div className="modal-body" style={{ maxHeight: "70vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 20 }}>
              <div style={{ padding: 16, borderRadius: 16, background: "rgba(239, 68, 68, 0.06)", border: "1px solid rgba(239, 68, 68, 0.14)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <span className="material-symbols-outlined" style={{ color: "var(--danger)", fontSize: 20 }}>warning</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: "var(--danger)", textTransform: "uppercase" }}>Thao tác có tác động lớn</span>
                </div>
                <div style={{ fontSize: 13, color: "var(--text-main)", lineHeight: 1.6 }}>
                  Khi xóa bài viết, hệ thống cũng xóa comment, review, notification liên quan và reset toàn bộ dữ liệu nhuận bút để tránh lệch số liệu.
                </div>
              </div>

              {deleteError && (
                <div style={{ padding: 16, borderRadius: 16, background: "var(--danger-light)", border: "1px solid rgba(239, 68, 68, 0.18)", color: "var(--danger)", fontSize: 13, fontWeight: 700 }}>
                  {deleteError}
                </div>
              )}

              <div>
                <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 12 }}>Phạm vi xóa</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                  {[
                    {
                      mode: "all" as const,
                      icon: "database",
                      title: "Xóa toàn bộ",
                      description: "Xóa toàn bộ dữ liệu bài viết hiện có.",
                    },
                    {
                      mode: "current_filters" as const,
                      icon: "filter_alt",
                      title: "Theo bộ lọc hiện tại",
                      description: "Dùng chính bộ lọc và ô tìm kiếm đang mở ở trang danh sách.",
                    },
                    {
                      mode: "custom" as const,
                      icon: "psychology_alt",
                      title: "Xóa thông minh",
                      description: "Xóa theo tiêu chí chi tiết như tên bài, bút danh, tháng, năm.",
                    },
                  ].map((option) => {
                    const active = deleteMode === option.mode;
                    return (
                      <button
                        key={option.mode}
                        type="button"
                        data-testid={`article-delete-mode-${option.mode}`}
                        onClick={() => handleDeleteModeChange(option.mode)}
                        style={{
                          textAlign: "left",
                          padding: 16,
                          borderRadius: 16,
                          border: active ? "1px solid rgba(239, 68, 68, 0.28)" : "1px solid var(--glass-border)",
                          background: active ? "rgba(239, 68, 68, 0.06)" : "rgba(255,255,255,0.5)",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                          <span className="material-symbols-outlined" style={{ color: active ? "var(--danger)" : "var(--text-muted)", fontSize: 20 }}>{option.icon}</span>
                          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text-main)" }}>{option.title}</span>
                        </div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>{option.description}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {deleteMode === "all" && (
                <div style={{ padding: 18, borderRadius: 16, background: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.16)" }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "var(--danger)", marginBottom: 8 }}>Chế độ xóa toàn bộ đang bật</div>
                  <div style={{ fontSize: 13, color: "var(--text-main)", lineHeight: 1.6 }}>
                    Hệ thống sẽ bỏ qua toàn bộ bộ lọc và xóa tất cả bài viết trong cơ sở dữ liệu. Chỉ nên dùng khi bạn thực sự muốn làm sạch dữ liệu để import lại từ đầu.
                  </div>
                </div>
              )}

              {deleteMode === "current_filters" && (
                <div style={{ padding: 18, borderRadius: 16, background: "rgba(37, 99, 235, 0.05)", border: "1px solid rgba(37, 99, 235, 0.12)" }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "var(--accent-blue)", marginBottom: 10 }}>Bộ lọc đang áp dụng</div>
                  {deleteCriteriaSummary.length > 0 ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {deleteCriteriaSummary.map((item) => (
                        <span key={item} className="tag-pill">{item}</span>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                      Hiện chưa có bộ lọc hoặc từ khóa tìm kiếm nào trên danh sách bài viết.
                    </div>
                  )}
                </div>
              )}

              {deleteMode === "custom" && (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>Tiêu chí xóa thông minh</div>
                      <div style={{ fontSize: 13, color: "var(--text-main)" }}>Có thể kết hợp nhiều điều kiện như tên bài, bút danh, tháng/năm, trạng thái, loại bài.</div>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button type="button" className="btn-ios-pill btn-ios-secondary" onClick={() => applyDeletePreset("drafts_this_month")}>
                        Nháp tháng này
                      </button>
                      <button type="button" className="btn-ios-pill btn-ios-secondary" onClick={() => applyDeletePreset("needs_fix")}>
                        Bài cần sửa
                      </button>
                      <button type="button" className="btn-ios-pill btn-ios-secondary" onClick={() => applyDeletePreset("clear")}>
                        Xóa tiêu chí
                      </button>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Tên bài viết</label>
                      <input
                        data-testid="article-delete-title-query"
                        className="form-input"
                        value={deleteCriteria.titleQuery}
                        onChange={(e) => updateDeleteCriteria("titleQuery", e.target.value)}
                        placeholder="Nhập một phần tiêu đề"
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Tìm kiếm tổng quát</label>
                      <input
                        data-testid="article-delete-search"
                        className="form-input"
                        value={deleteCriteria.search}
                        onChange={(e) => updateDeleteCriteria("search", e.target.value)}
                        placeholder="Tiêu đề, mã bài, ghi chú..."
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Bút danh</label>
                      <CustomSelect
                        value={deleteCriteria.penName}
                        onChange={(value) => updateDeleteCriteria("penName", value)}
                        options={[{ value: "", label: "Tất cả bút danh" }, ...collaborators.map((c) => ({ value: c.penName, label: c.penName }))]}
                        placeholder="Tất cả bút danh"
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Người duyệt</label>
                      <input
                        data-testid="article-delete-reviewer"
                        className="form-input"
                        value={deleteCriteria.reviewerName}
                        onChange={(e) => updateDeleteCriteria("reviewerName", e.target.value)}
                        placeholder="Tên người duyệt"
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Trạng thái</label>
                      <CustomSelect
                        value={deleteCriteria.status}
                        onChange={(value) => updateDeleteCriteria("status", value)}
                        options={ARTICLE_STATUS_OPTIONS}
                        placeholder="Tất cả"
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Danh mục</label>
                      <input
                        className="form-input"
                        value={deleteCriteria.category}
                        onChange={(e) => updateDeleteCriteria("category", e.target.value)}
                        placeholder="Ví dụ: ICT, Gia dụng"
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Loại bài</label>
                      <CustomSelect
                        value={deleteCriteria.articleType}
                        onChange={(value) => updateDeleteCriteria("articleType", value)}
                        options={[{ value: "", label: "Tất cả loại bài" }, ...ARTICLE_TYPE_OPTIONS.map((value) => ({ value, label: value }))]}
                        placeholder="Tất cả loại bài"
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Loại nội dung</label>
                      <CustomSelect
                        value={deleteCriteria.contentType}
                        onChange={(value) => updateDeleteCriteria("contentType", value)}
                        options={[{ value: "", label: "Tất cả loại nội dung" }, ...CONTENT_TYPE_OPTIONS.map((value) => ({ value, label: value }))]}
                        placeholder="Tất cả loại nội dung"
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Tháng</label>
                      <CustomSelect
                        value={deleteCriteria.month}
                        onChange={(value) => updateDeleteCriteria("month", value)}
                        options={MONTH_OPTIONS}
                        placeholder="Tháng"
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Năm</label>
                      <CustomSelect
                        value={deleteCriteria.year}
                        onChange={(value) => updateDeleteCriteria("year", value)}
                        options={YEAR_OPTIONS}
                        placeholder="Năm"
                      />
                    </div>
                  </div>

                  <div style={{ padding: 14, borderRadius: 14, background: "rgba(0,0,0,0.02)", border: "1px solid var(--glass-border)", fontSize: 13, color: "var(--text-muted)" }}>
                    {customDeleteCriteriaCount > 0 ? `Đang có ${customDeleteCriteriaCount} tiêu chí tùy chỉnh.` : "Chưa có tiêu chí nào. Hãy nhập ít nhất một điều kiện hoặc chuyển sang chế độ xóa toàn bộ."}
                  </div>
                </>
              )}

              <div style={{ padding: 18, borderRadius: 18, background: "rgba(255,255,255,0.5)", border: "1px solid var(--glass-border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>Xem trước phạm vi xóa</div>
                    <div style={{ fontSize: 13, color: "var(--text-main)" }}>Xem trước số bài, dữ liệu liên đới và mẫu bản ghi sẽ bị xóa.</div>
                  </div>
                  {deletePreview && (
                    <span className="tag-pill" style={{ color: deletePreview.total > 0 ? "var(--danger)" : "var(--text-muted)" }}>
                      {deletePreview.total} bài khớp điều kiện
                    </span>
                  )}
                </div>

                {deletePreview ? (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 16 }}>
                      {[
                        { label: "Bài viết", value: deletePreview.total, color: "var(--danger)", icon: "article" },
                        { label: "Comment", value: deletePreview.related.comments, color: "var(--accent-blue)", icon: "forum" },
                        { label: "Review", value: deletePreview.related.reviews, color: "var(--accent-orange)", icon: "rate_review" },
                        { label: "Notification", value: deletePreview.related.notifications, color: "var(--accent-purple)", icon: "notifications" },
                        { label: "Payment reset", value: deletePreview.related.payments, color: "var(--text-main)", icon: "payments" },
                      ].map((item) => (
                        <div key={item.label} style={{ padding: 14, borderRadius: 14, background: "rgba(255,255,255,0.7)", border: "1px solid var(--glass-border)" }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 20, color: item.color }}>{item.icon}</span>
                          <div style={{ fontSize: 24, fontWeight: 800, color: item.color, marginTop: 6 }}>{item.value}</div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>{item.label}</div>
                        </div>
                      ))}
                    </div>

                    {deletePreview.sample.length > 0 ? (
                      <div style={{ overflowX: "auto", borderRadius: 14, border: "1px solid var(--glass-border)" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                          <thead>
                            <tr style={{ background: "rgba(0,0,0,0.02)" }}>
                              <th style={{ padding: "10px 12px", textAlign: "left", color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase" }}>Ngày</th>
                              <th style={{ padding: "10px 12px", textAlign: "left", color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase" }}>Tiêu đề</th>
                              <th style={{ padding: "10px 12px", textAlign: "left", color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase" }}>Bút danh</th>
                              <th style={{ padding: "10px 12px", textAlign: "left", color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase" }}>Trạng thái</th>
                            </tr>
                          </thead>
                          <tbody>
                            {deletePreview.sample.map((item) => (
                              <tr key={item.id} style={{ borderTop: "1px solid var(--glass-border)" }}>
                                <td style={{ padding: "10px 12px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>{item.date}</td>
                                <td style={{ padding: "10px 12px", color: "var(--text-main)", fontWeight: 600, minWidth: 320 }}>{item.title}</td>
                                <td style={{ padding: "10px 12px", color: "var(--accent-blue)", fontWeight: 700 }}>{item.penName}</td>
                                <td style={{ padding: "10px 12px" }}>{statusBadge(item.status)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div style={{ padding: 20, borderRadius: 14, border: "1px dashed var(--glass-border)", color: "var(--text-muted)" }}>
                        Không có bài viết nào khớp điều kiện hiện tại.
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ padding: 20, borderRadius: 14, border: "1px dashed var(--glass-border)", color: "var(--text-muted)" }}>
                    Chưa xem trước. Hãy bấm `Xem trước phạm vi xóa` trước khi thực thi.
                  </div>
                )}
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn-ios-pill btn-ios-secondary" onClick={() => setShowDeleteModal(false)} disabled={deleteExecuting}>
                Hủy
              </button>
              <button data-testid="article-delete-preview-trigger" className="btn-ios-pill btn-ios-secondary" onClick={() => requestDeletePreview()} disabled={deleteLoading || deleteExecuting}>
                {deleteLoading ? (
                  <><span className="material-symbols-outlined" style={{ fontSize: 18, animation: "spin 1s linear infinite" }}>sync</span> Đang phân tích...</>
                ) : (
                  <><span className="material-symbols-outlined" style={{ fontSize: 18 }}>preview</span> Xem trước phạm vi xóa</>
                )}
              </button>
              <button
                className="btn-ios-pill"
                data-testid="article-delete-confirm"
                onClick={executeDelete}
                disabled={deleteExecuting || deleteLoading || !deletePreview || deletePreview.total === 0}
                style={{ background: "rgba(239, 68, 68, 0.1)", color: "var(--danger)", border: "1px solid rgba(239, 68, 68, 0.18)" }}
              >
                {deleteExecuting ? (
                  <><span className="material-symbols-outlined" style={{ fontSize: 18, animation: "spin 1s linear infinite" }}>sync</span> Đang xóa...</>
                ) : (
                  <><span className="material-symbols-outlined" style={{ fontSize: 18 }}>delete_forever</span> Xóa dữ liệu đã xem trước</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ IMPORT WIZARD MODAL ═══ */}
      {showImportWizard && (
        <div className="modal-overlay" onClick={() => !importing && setShowImportWizard(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 1040, width: "92vw" }}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="material-symbols-outlined" style={{ color: "var(--accent-blue)" }}>upload_file</span>
                Import Excel nâng cao
              </h3>
              <button className="modal-close" onClick={() => !importing && setShowImportWizard(false)}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
              </button>
            </div>

            {/* Step Indicator */}
            <div style={{ display: "flex", gap: 12, padding: "16px 24px", borderBottom: "1px solid var(--glass-border)" }}>
              {[
                { n: 1, label: "Tải file", icon: "cloud_upload" },
                { n: 2, label: "Xem trước & Mapping", icon: "table_chart" },
                { n: 3, label: "Kết quả", icon: "check_circle" }
              ].map(s => (
                <div key={s.n} style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRadius: 14, background: importStep >= s.n ? "rgba(37, 99, 235, 0.08)" : "rgba(0,0,0,0.02)", border: `1px solid ${importStep === s.n ? "var(--accent-blue)" : "var(--glass-border)"}`, transition: "all 0.3s" }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18, color: importStep >= s.n ? "var(--accent-blue)" : "var(--text-muted)" }}>{importStep > s.n ? "check_circle" : s.icon}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: importStep >= s.n ? "var(--accent-blue)" : "var(--text-muted)" }}>{s.label}</span>
                </div>
              ))}
            </div>

            <div className="modal-body" style={{ maxHeight: "60vh", overflowY: "auto" }}>
              {importStep === 1 && (
                importFile ? (
                  <div style={{ textAlign: "center", padding: 60 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 48, color: "var(--accent-blue)", animation: "glowPulse 2s infinite" }}>analytics</span>
                    <p style={{ marginTop: 16, fontSize: 16, fontWeight: 700, color: "var(--text-main)" }}>Đang phân tích workbook...</p>
                    <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>Dò sheet, dòng header, kiểu dữ liệu và gợi ý mapping tự động</p>
                  </div>
                ) : (
                  <div style={{ textAlign: "center", padding: 48 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 48, color: "var(--accent-blue)" }}>upload_file</span>
                    <p style={{ marginTop: 14, fontSize: 16, fontWeight: 700, color: "var(--text-main)" }}>Chọn file để bắt đầu import</p>
                    <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>Hỗ trợ `.xlsx`, `.xls`, `.csv`</p>
                    <button className="btn-ios-pill btn-ios-primary" style={{ marginTop: 20 }} onClick={triggerImportPicker}>
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>folder_open</span>
                      Chọn file
                    </button>
                  </div>
                )
              )}

              {importStep === 2 && importAnalysis && (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 20 }}>
                    <div style={{ padding: 16, borderRadius: 16, background: "rgba(37, 99, 235, 0.06)", border: "1px solid rgba(37, 99, 235, 0.12)" }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 }}>File</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-main)" }}>{importFile?.name}</div>
                    </div>
                    <div style={{ padding: 16, borderRadius: 16, background: "rgba(16, 185, 129, 0.06)", border: "1px solid rgba(16, 185, 129, 0.12)" }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 }}>Dòng dữ liệu</div>
                      <div style={{ fontSize: 24, fontWeight: 800, color: "var(--text-main)" }}>{importAnalysis.dataRowCount}</div>
                    </div>
                    <div style={{ padding: 16, borderRadius: 16, background: "rgba(249, 115, 22, 0.06)", border: "1px solid rgba(249, 115, 22, 0.12)" }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 }}>Header hiện tại</div>
                      <div style={{ fontSize: 24, fontWeight: 800, color: "var(--text-main)" }}>Dòng {importAnalysis.headerRowNumber}</div>
                    </div>
                    <div style={{ padding: 16, borderRadius: 16, background: "rgba(168, 85, 247, 0.06)", border: "1px solid rgba(168, 85, 247, 0.12)" }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 }}>Ánh xạ</div>
                      <div style={{ fontSize: 24, fontWeight: 800, color: "var(--text-main)" }}>{mappedFields.length}/{importAnalysis.columns.length}</div>
                    </div>
                  </div>

                  <div style={{ marginBottom: 20, padding: 14, borderRadius: 14, background: "rgba(59, 130, 246, 0.06)", border: "1px solid rgba(59, 130, 246, 0.14)" }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "var(--accent-blue)", textTransform: "uppercase", marginBottom: 8 }}>Hướng dẫn nhanh</div>
                    <div style={{ fontSize: 13, color: "var(--text-main)", lineHeight: 1.6 }}>
                      1) Chọn đúng `Sheet` và `Dòng header`.
                      <br />
                      2) Kiểm tra các trường quan trọng bên dưới: `Mã bài viết`, `Ngày viết`, `Tiêu đề`, `Bút danh`, `Trạng thái`, `Link bài viết`.
                      <br />
                      3) Với file có cả `STT` và `ID bài viết`, hãy map `STT` thành `— Bỏ qua —`, và map cột `ID bài viết` vào `Mã bài viết`.
                    </div>
                  </div>

                  <div style={{ marginBottom: 24 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-main)" }}>Trường quan trọng cần kiểm tra</h4>
                      <span className="tag-pill" style={{ fontSize: 11 }}>
                        {importantFieldInsights.filter((item) => item.mapped).length}/{importantFieldInsights.length} đã map
                      </span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                      {importantFieldInsights.map((item) => (
                        <div key={item.field} style={{ padding: 12, borderRadius: 12, border: `1px solid ${item.mapped ? "rgba(16, 185, 129, 0.2)" : "rgba(239, 68, 68, 0.2)"}`, background: item.mapped ? "rgba(16, 185, 129, 0.06)" : "rgba(239, 68, 68, 0.05)" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 6 }}>
                            <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text-main)" }}>{item.label}</span>
                            <span style={{ fontSize: 10, fontWeight: 800, color: item.mapped ? "#10b981" : "var(--danger)", textTransform: "uppercase" }}>
                              {item.mapped ? "Đã map" : "Chưa map"}
                            </span>
                          </div>
                          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{item.columnLabel}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, marginBottom: 24 }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Sheet dữ liệu</label>
                      <CustomSelect
                        value={importSheetName}
                        onChange={async (value) => {
                          if (!importFile) return;
                          setImportSheetName(value);
                          await analyzeImportFile(importFile, value, undefined);
                        }}
                        options={importAnalysis.sheets.map(sheet => ({
                          value: sheet.name,
                          label: `${sheet.name} (${sheet.totalRows} dòng${sheet.isHidden ? ", ẩn" : ""})`,
                        }))}
                        placeholder="Chọn sheet"
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Dòng header</label>
                      <CustomSelect
                        value={String(importHeaderRowNumber)}
                        onChange={async (value) => {
                          if (!importFile) return;
                          const nextRow = Number(value);
                          setImportHeaderRowNumber(nextRow);
                          await analyzeImportFile(importFile, importSheetName, nextRow);
                        }}
                        options={importAnalysis.headerCandidates.map(candidate => ({
                          value: String(candidate.rowNumber),
                          label: `Dòng ${candidate.rowNumber} • score ${candidate.score}`,
                        }))}
                        placeholder="Chọn dòng header"
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0, display: "flex", alignItems: "flex-end" }}>
                      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: 14, borderRadius: 14, border: "1px solid rgba(239, 68, 68, 0.16)", background: "rgba(239, 68, 68, 0.04)", width: "100%", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={replaceExistingImport}
                          onChange={(e) => {
                            setReplaceExistingImport(e.target.checked);
                            setImportDryRun(null);
                          }}
                          style={{ marginTop: 2 }}
                        />
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-main)" }}>Thay thế toàn bộ dữ liệu bài viết cũ</div>
                          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>Khi bật, hệ thống sẽ xóa bài viết, comment/review bài viết, thanh toán sinh từ bài viết và notification gắn bài viết trước khi import.</div>
                        </div>
                      </label>
                    </div>
                  </div>

                  {importAnalysis.warnings.length > 0 && (
                    <div style={{ marginBottom: 24, padding: 16, borderRadius: 16, background: "rgba(249, 115, 22, 0.06)", border: "1px solid rgba(249, 115, 22, 0.14)" }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: "var(--accent-orange)", textTransform: "uppercase", marginBottom: 10 }}>Cảnh báo phân tích</div>
                      {importAnalysis.warnings.map((warning, index) => (
                        <div key={index} style={{ fontSize: 13, color: "var(--text-main)", marginBottom: index === importAnalysis.warnings.length - 1 ? 0 : 8 }}>
                          • {warning}
                        </div>
                      ))}
                    </div>
                  )}

                  {importError && (
                    <div style={{ marginBottom: 24, padding: 16, borderRadius: 16, background: "var(--danger-light)", border: "1px solid rgba(239, 68, 68, 0.18)", color: "var(--danger)", fontSize: 13, fontWeight: 700 }}>
                      {importError}
                    </div>
                  )}

                  {(missingRequiredImportFields.length > 0 || duplicateMappedFields.length > 0) && (
                    <div style={{ marginBottom: 24, padding: 16, borderRadius: 16, background: "rgba(239, 68, 68, 0.06)", border: "1px solid rgba(239, 68, 68, 0.14)" }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: "var(--danger)", textTransform: "uppercase", marginBottom: 10 }}>Cần xử lý trước khi import</div>
                      {missingRequiredImportFields.length > 0 && (
                        <div style={{ fontSize: 13, color: "var(--text-main)", marginBottom: duplicateMappedFields.length > 0 ? 8 : 0 }}>
                          • Thiếu trường bắt buộc: {missingRequiredImportFields.join(", ")}
                        </div>
                      )}
                      {duplicateMappedFields.length > 0 && (
                        <div style={{ fontSize: 13, color: "var(--text-main)" }}>
                          • Có trường đang bị map trùng: {Array.from(new Set(duplicateMappedFields)).join(", ")}
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ marginBottom: 24 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                      <div>
                        <h4 style={{ fontSize: 16, fontWeight: 700, color: "var(--text-main)" }}>Ánh xạ cột chi tiết</h4>
                        <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>Hệ thống đã phân tích sheet `{importAnalysis.sheetName}` với {importAnalysis.totalRows} dòng vật lý.</p>
                      </div>
                      <span className="tag-pill" style={{ fontSize: 11 }}>{mappedFields.length}/{importAnalysis.columns.length} cột đã ánh xạ</span>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      {importAnalysis.columns.map((column) => (
                        <div key={column.key} style={{ display: "grid", gridTemplateColumns: "minmax(280px, 1.2fr) minmax(220px, 0.9fr) minmax(280px, 1.1fr)", gap: 16, padding: 16, borderRadius: 16, border: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.5)" }}>
                          <div>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                              <span style={{ padding: "3px 8px", borderRadius: 999, background: "rgba(37, 99, 235, 0.08)", color: "var(--accent-blue)", fontSize: 11, fontWeight: 800 }}>{column.letter}</span>
                              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-main)" }}>{column.header}</span>
                              <span style={{ padding: "3px 8px", borderRadius: 999, background: "rgba(15, 23, 42, 0.05)", color: "var(--text-muted)", fontSize: 11, fontWeight: 700 }}>{column.inferredType}</span>
                            </div>
                            <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
                              {column.sampleValues.length > 0 ? column.sampleValues.join(" • ") : "Không có mẫu dữ liệu"}
                            </div>
                          </div>

                          <div>
                            <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8 }}>Gợi ý tốt nhất</div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                              {column.suggestions.slice(0, 3).map((suggestion) => (
                                <div key={`${column.key}-${suggestion.field}`} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12 }}>
                                  <span style={{ color: suggestion.field === column.suggestedField ? "var(--accent-blue)" : "var(--text-main)", fontWeight: suggestion.field === column.suggestedField ? 700 : 500 }}>
                                    {IMPORT_FIELD_OPTIONS.find((option) => option.value === suggestion.field)?.label || suggestion.field}
                                  </span>
                                  <span style={{ color: "var(--text-muted)", fontWeight: 700 }}>score {suggestion.score}</span>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div>
                            <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8 }}>Map vào trường hệ thống</div>
                            <CustomSelect
                              value={importMapping[column.key] || ""}
                              onChange={(value) => updateImportMapping(column.key, value)}
                              options={IMPORT_FIELD_OPTIONS}
                              placeholder="Chọn trường..."
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{ marginBottom: 24 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
                      <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-main)" }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: "middle", marginRight: 6 }}>rule</span>
                        Preview dữ liệu chuẩn hóa trước khi nhập
                      </h4>
                      <button
                        className="btn-ios-pill btn-ios-secondary"
                        style={{ padding: "8px 14px" }}
                        onClick={runImportDryRun}
                        disabled={importDryRunLoading || importing || missingRequiredImportFields.length > 0 || duplicateMappedFields.length > 0}
                      >
                        {importDryRunLoading ? (
                          <><span className="material-symbols-outlined" style={{ fontSize: 18, animation: "spin 1s linear infinite" }}>sync</span> Đang tạo preview...</>
                        ) : (
                          <><span className="material-symbols-outlined" style={{ fontSize: 18 }}>preview</span> Phân tích preview nhập</>
                        )}
                      </button>
                    </div>

                    {!importDryRun ? (
                      <div style={{ padding: 16, borderRadius: 14, border: "1px dashed var(--glass-border)", color: "var(--text-muted)", fontSize: 13 }}>
                        Bấm <strong>`Phân tích preview nhập`</strong> để xem chính xác dòng nào được nhập, dòng nào bị trùng/bị bỏ qua và giá trị chuẩn hóa của `ID`, `Trạng thái`, `Link`.
                      </div>
                    ) : (
                      <>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 12 }}>
                          <div style={{ padding: 10, borderRadius: 12, background: "rgba(15, 23, 42, 0.04)", border: "1px solid var(--glass-border)" }}>
                            <div style={{ fontSize: 10, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase" }}>Tổng dòng</div>
                            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text-main)" }}>{importDryRun.total}</div>
                          </div>
                          <div style={{ padding: 10, borderRadius: 12, background: "rgba(16, 185, 129, 0.08)", border: "1px solid rgba(16, 185, 129, 0.16)" }}>
                            <div style={{ fontSize: 10, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase" }}>Có thể nhập</div>
                            <div style={{ fontSize: 18, fontWeight: 800, color: "#10b981" }}>{importDryRun.importable}</div>
                          </div>
                          <div style={{ padding: 10, borderRadius: 12, background: "rgba(249, 115, 22, 0.08)", border: "1px solid rgba(249, 115, 22, 0.16)" }}>
                            <div style={{ fontSize: 10, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase" }}>Trùng lặp</div>
                            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--accent-orange)" }}>{importDryRun.duplicates}</div>
                          </div>
                          <div style={{ padding: 10, borderRadius: 12, background: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.16)" }}>
                            <div style={{ fontSize: 10, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase" }}>Bị bỏ qua</div>
                            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--danger)" }}>{importDryRun.skipped}</div>
                          </div>
                        </div>

                        <div style={{ overflowX: "auto", borderRadius: 14, border: "1px solid var(--glass-border)" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                            <thead>
                              <tr style={{ background: "rgba(0,0,0,0.02)" }}>
                                <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase", whiteSpace: "nowrap" }}>Dòng</th>
                                <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase", whiteSpace: "nowrap" }}>ID bài</th>
                                <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase", whiteSpace: "nowrap" }}>Ngày</th>
                                <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase", whiteSpace: "nowrap" }}>Tiêu đề</th>
                                <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase", whiteSpace: "nowrap" }}>Bút danh</th>
                                <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase", whiteSpace: "nowrap" }}>Trạng thái</th>
                                <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase", whiteSpace: "nowrap" }}>Kết quả</th>
                              </tr>
                            </thead>
                            <tbody>
                              {importDryRun.previewRows.map((row) => (
                                <tr key={`dryrun-${row.rowNumber}`} style={{ borderTop: "1px solid var(--glass-border)" }}>
                                  <td style={{ padding: "10px 12px", color: "var(--text-muted)", fontWeight: 700 }}>#{row.rowNumber}</td>
                                  <td style={{ padding: "10px 12px", color: "var(--text-main)" }}>{row.normalized.articleId || "—"}</td>
                                  <td style={{ padding: "10px 12px", color: "var(--text-main)" }}>{row.normalized.date || "—"}</td>
                                  <td style={{ padding: "10px 12px", color: "var(--text-main)", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.normalized.title || "—"}</td>
                                  <td style={{ padding: "10px 12px", color: "var(--text-main)" }}>{row.normalized.penName || "—"}</td>
                                  <td style={{ padding: "10px 12px", color: "var(--text-main)" }}>{row.normalized.status || "—"}</td>
                                  <td style={{ padding: "10px 12px", color: row.canImport ? "#10b981" : row.duplicate ? "var(--accent-orange)" : "var(--danger)", fontWeight: 700 }}>
                                    {row.canImport ? "Sẽ nhập" : row.duplicate ? "Trùng lặp" : "Bỏ qua"}
                                    {row.issues.length > 0 && (
                                      <div style={{ marginTop: 4, color: "var(--text-muted)", fontWeight: 500, maxWidth: 320 }}>
                                        {row.issues.join("; ")}
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </div>

                  <div style={{ marginTop: 24 }}>
                    <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-main)", marginBottom: 12 }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: "middle", marginRight: 6 }}>preview</span>
                      Preview sau khi mapping
                    </h4>
                    {mappedPreviewFields.length === 0 ? (
                      <div style={{ padding: 20, borderRadius: 14, border: "1px dashed var(--glass-border)", color: "var(--text-muted)" }}>
                        Chọn ít nhất một cột để xem preview.
                      </div>
                    ) : (
                      <div style={{ overflowX: "auto", borderRadius: 14, border: "1px solid var(--glass-border)" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                          <thead>
                            <tr style={{ background: "rgba(0,0,0,0.02)" }}>
                              <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase", whiteSpace: "nowrap" }}>Dòng</th>
                              {mappedPreviewFields.map((field) => (
                                <th key={field.value} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase", whiteSpace: "nowrap" }}>
                                  {field.label}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {importAnalysis.sampleRows.map((row) => (
                              <tr key={row.rowNumber} style={{ borderTop: "1px solid var(--glass-border)" }}>
                                <td style={{ padding: "10px 12px", color: "var(--text-muted)", fontWeight: 700 }}>#{row.rowNumber}</td>
                                {mappedPreviewFields.map((field) => (
                                  <td key={`${row.rowNumber}-${field.value}`} style={{ padding: "10px 12px", color: "var(--text-main)", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {resolveImportPreviewValue(row, field.value)}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div style={{ marginTop: 24 }}>
                    <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-main)", marginBottom: 12 }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: "middle", marginRight: 6 }}>table_chart</span>
                      Mẫu dữ liệu gốc theo cột đã phân tích
                    </h4>
                    <div style={{ overflowX: "auto", borderRadius: 14, border: "1px solid var(--glass-border)" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                        <thead>
                          <tr style={{ background: "rgba(0,0,0,0.02)" }}>
                            <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase", whiteSpace: "nowrap" }}>Dòng</th>
                            {importAnalysis.columns.map((column) => (
                              <th key={column.key} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 700, color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase", minWidth: 150 }}>
                                {column.letter} • {column.header}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {importAnalysis.sampleRows.map((row) => (
                            <tr key={`raw-${row.rowNumber}`} style={{ borderTop: "1px solid var(--glass-border)" }}>
                              <td style={{ padding: "10px 12px", color: "var(--text-muted)", fontWeight: 700 }}>#{row.rowNumber}</td>
                              {importAnalysis.columns.map((column) => (
                                <td key={`${row.rowNumber}-${column.key}`} style={{ padding: "10px 12px", color: "var(--text-main)", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {row.values[column.key] || "—"}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}

              {importStep === 3 && importResult && (
                <div style={{ textAlign: "center", padding: 32 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 56, color: "var(--accent-teal)" }}>task_alt</span>
                  <h3 style={{ fontSize: 22, fontWeight: 800, color: "var(--text-main)", marginTop: 16 }}>Import hoàn tất!</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginTop: 24 }}>
                    {[
                      { label: "Tổng dòng", value: importResult.total, color: "var(--text-main)", icon: "description" },
                      { label: "Đã nhập", value: importResult.imported, color: "var(--accent-teal)", icon: "check_circle" },
                      { label: "Trùng lặp", value: importResult.duplicates || 0, color: "var(--accent-orange)", icon: "content_copy" },
                      { label: "Bỏ qua", value: importResult.skipped, color: "var(--text-muted)", icon: "skip_next" },
                    ].map(s => (
                      <div key={s.label} style={{ padding: 16, borderRadius: 16, background: "rgba(0,0,0,0.02)", border: "1px solid var(--glass-border)" }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 24, color: s.color }}>{s.icon}</span>
                        <div style={{ fontSize: 24, fontWeight: 800, color: s.color, marginTop: 4 }}>{s.value}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase" }}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 24, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, textAlign: "left" }}>
                    <div style={{ padding: 14, borderRadius: 14, border: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.5)" }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 }}>Sheet</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-main)" }}>{importResult.sheetName || importSheetName}</div>
                    </div>
                    <div style={{ padding: 14, borderRadius: 14, border: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.5)" }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 }}>Header</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-main)" }}>Dòng {importResult.headerRowNumber || importHeaderRowNumber}</div>
                    </div>
                    <div style={{ padding: 14, borderRadius: 14, border: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.5)" }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 }}>Chế độ</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-main)" }}>{importResult.clearedExisting ? "Đã thay thế dữ liệu cũ" : "Chỉ thêm dữ liệu mới"}</div>
                    </div>
                  </div>
                  {importResult.warnings?.length ? (
                    <div style={{ marginTop: 24, textAlign: "left", padding: 16, borderRadius: 14, background: "rgba(249, 115, 22, 0.05)", border: "1px solid rgba(249, 115, 22, 0.15)" }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: "var(--accent-orange)", marginBottom: 8 }}>Cảnh báo còn lại</div>
                      {importResult.warnings.map((warning, index) => (
                        <div key={index} style={{ fontSize: 12, color: "var(--text-main)", marginBottom: index === importResult.warnings!.length - 1 ? 0 : 4 }}>• {warning}</div>
                      ))}
                    </div>
                  ) : null}
                  {importResult.errors?.length > 0 && (
                    <div style={{ marginTop: 24, textAlign: "left", padding: 16, borderRadius: 14, background: "rgba(239, 68, 68, 0.05)", border: "1px solid rgba(239, 68, 68, 0.15)" }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: "#ef4444", marginBottom: 8 }}>⚠️ Lỗi chi tiết:</div>
                      {importResult.errors.map((err: string, i: number) => (
                        <div key={i} style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>• {err}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="modal-footer">
              {importStep === 1 && !importFile && (
                <>
                  <button className="btn-ios-pill btn-ios-secondary" onClick={() => setShowImportWizard(false)}>Đóng</button>
                  <button className="btn-ios-pill btn-ios-primary" onClick={triggerImportPicker}>
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>folder_open</span> Chọn file
                  </button>
                </>
              )}
              {importStep === 2 && (
                <>
                  <button className="btn-ios-pill btn-ios-secondary" onClick={() => setShowImportWizard(false)}>Hủy bỏ</button>
                  <button className="btn-ios-pill btn-ios-primary" onClick={executeImport} disabled={importing || missingRequiredImportFields.length > 0 || duplicateMappedFields.length > 0}>
                    {importing ? (
                      <><span className="material-symbols-outlined" style={{ fontSize: 18, animation: "spin 1s linear infinite" }}>sync</span> Đang nhập...</>
                    ) : (
                      <><span className="material-symbols-outlined" style={{ fontSize: 18 }}>file_download</span> Xác nhận nhập {importAnalysis?.dataRowCount} dòng</>
                    )}
                  </button>
                </>
              )}
              {importStep === 3 && (
                <button className="btn-ios-pill btn-ios-primary" onClick={() => setShowImportWizard(false)}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>done</span> Hoàn tất
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ══════════════════════════ TEAM ══════════════════════════ */
