"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import CustomSelect from "./CustomSelect";
import { useAuth } from "./auth-context";
import { useRealtimeRefresh } from "./realtime";
import type { FeedbackItem } from "./types";

const CATEGORY_OPTIONS = [
  { value: "bug", label: "Lỗi hệ thống" },
  { value: "feature", label: "Đề xuất tính năng" },
  { value: "improvement", label: "Cải thiện trải nghiệm" },
  { value: "other", label: "Khác" },
];

const STATUS_OPTIONS = [
  { value: "", label: "Tất cả trạng thái" },
  { value: "new", label: "Mới gửi" },
  { value: "reviewing", label: "Đang xem xét" },
  { value: "planned", label: "Đã lên kế hoạch" },
  { value: "resolved", label: "Đã xử lý" },
];

const STATUS_EDITOR_OPTIONS = STATUS_OPTIONS.filter((option) => option.value);

const RATING_OPTIONS = [
  { value: "", label: "Chưa chấm điểm" },
  { value: "1", label: "1/5" },
  { value: "2", label: "2/5" },
  { value: "3", label: "3/5" },
  { value: "4", label: "4/5" },
  { value: "5", label: "5/5" },
];

const STATUS_LABELS: Record<string, string> = {
  new: "Mới gửi",
  reviewing: "Đang xem xét",
  planned: "Đã lên kế hoạch",
  resolved: "Đã xử lý",
};

const CATEGORY_LABELS: Record<string, string> = {
  bug: "Lỗi hệ thống",
  feature: "Đề xuất tính năng",
  improvement: "Cải thiện trải nghiệm",
  other: "Khác",
};

const STATUS_COLORS: Record<string, string> = {
  new: "#2563eb",
  reviewing: "#f59e0b",
  planned: "#8b5cf6",
  resolved: "#10b981",
};

export default function FeedbackPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [category, setCategory] = useState("improvement");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [pageContext, setPageContext] = useState("");
  const [rating, setRating] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [drafts, setDrafts] = useState<Record<number, { status: string; adminNotes: string; saving: boolean }>>({});

  const fetchFeedback = useCallback(() => {
    setLoading(true);
    setError("");

    const params = new URLSearchParams();
    if (isAdmin && statusFilter) params.set("status", statusFilter);
    if (isAdmin && categoryFilter) params.set("category", categoryFilter);
    params.set("limit", isAdmin ? "100" : "20");

    fetch(`/api/feedback?${params.toString()}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (!data.success) {
          setItems([]);
          setError(data.error || "Không tải được feedback.");
          return;
        }

        const nextItems = Array.isArray(data.data) ? data.data as FeedbackItem[] : [];
        setItems(nextItems);
        setDrafts((current) => {
          const nextDrafts: Record<number, { status: string; adminNotes: string; saving: boolean }> = {};
          for (const item of nextItems) {
            nextDrafts[item.id] = current[item.id]
              ? { ...current[item.id], status: current[item.id].status || item.status, adminNotes: current[item.id].adminNotes ?? (item.adminNotes || "") }
              : { status: item.status, adminNotes: item.adminNotes || "", saving: false };
          }
          return nextDrafts;
        });
      })
      .catch((fetchError) => {
        setItems([]);
        setError(String(fetchError));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [categoryFilter, isAdmin, statusFilter]);

  useEffect(() => {
    fetchFeedback();
  }, [fetchFeedback]);

  useRealtimeRefresh(["feedback"], fetchFeedback);

  const summary = useMemo(() => ({
    total: items.length,
    newCount: items.filter((item) => item.status === "new").length,
    reviewingCount: items.filter((item) => item.status === "reviewing").length,
    resolvedCount: items.filter((item) => item.status === "resolved").length,
  }), [items]);

  const resetForm = () => {
    setCategory("improvement");
    setTitle("");
    setMessage("");
    setPageContext("");
    setRating("");
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          title,
          message,
          pageContext,
          rating: rating ? Number(rating) : undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setError(data.error || "Không gửi được feedback.");
        return;
      }

      resetForm();
      fetchFeedback();
    } catch (submitError) {
      setError(String(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  const updateDraft = (id: number, patch: Partial<{ status: string; adminNotes: string; saving: boolean }>) => {
    setDrafts((current) => ({
      ...current,
      [id]: {
        status: current[id]?.status || "new",
        adminNotes: current[id]?.adminNotes || "",
        saving: current[id]?.saving || false,
        ...patch,
      },
    }));
  };

  const saveAdminUpdate = async (item: FeedbackItem) => {
    const draft = drafts[item.id];
    if (!draft) return;

    updateDraft(item.id, { saving: true });
    try {
      const response = await fetch("/api/feedback", {
        method: "PUT",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          status: draft.status,
          adminNotes: draft.adminNotes,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setError(data.error || "Không cập nhật được feedback.");
        updateDraft(item.id, { saving: false });
        return;
      }

      fetchFeedback();
    } catch (updateError) {
      setError(String(updateError));
      updateDraft(item.id, { saving: false });
    }
  };

  return (
    <>
      <header className="page-shell-header" style={{ marginBottom: 28 }}>
        <div>
          <h2 style={{ fontSize: 32, fontWeight: 800, color: "var(--text-main)", letterSpacing: "-0.04em" }}>Feedback</h2>
        </div>
      </header>

      <div style={{ display: "grid", gap: 24, gridTemplateColumns: isAdmin ? "minmax(340px, 420px) minmax(0, 1fr)" : "minmax(0, 760px)" }}>
        <div className="glass-card" style={{ padding: 24, alignSelf: "start" }}>
          <div style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 20, fontWeight: 800, color: "var(--text-main)", marginBottom: 6 }}>Gửi feedback mới</h3>
          </div>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Loại feedback</label>
              <CustomSelect value={category} onChange={setCategory} options={CATEGORY_OPTIONS} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Tiêu đề</label>
              <input className="form-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ví dụ: Bộ lọc bài viết bị chậm khi đổi tháng" />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Màn hình / ngữ cảnh</label>
              <input className="form-input" value={pageContext} onChange={(e) => setPageContext(e.target.value)} placeholder="Ví dụ: Trang Bài viết > popup nhập file Excel" />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Đánh giá trải nghiệm</label>
              <CustomSelect value={rating} onChange={setRating} options={RATING_OPTIONS} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Nội dung chi tiết</label>
              <textarea
                className="form-input"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={6}
                placeholder="Mô tả bước thực hiện, kết quả đang gặp và mong muốn của bạn..."
                style={{ resize: "vertical", minHeight: 160, padding: 16 }}
              />
            </div>

            {error && (
              <div style={{ padding: "12px 14px", borderRadius: 12, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.18)", color: "#ef4444", fontSize: 13 }}>
                {error}
              </div>
            )}

            <button className="btn-ios-pill btn-ios-primary" type="submit" style={{ justifyContent: "center", width: "100%", height: 48 }} disabled={submitting}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>send</span>
              {submitting ? "Đang gửi..." : "Gửi feedback"}
            </button>
          </form>
        </div>

        <div style={{ display: "grid", gap: 20 }}>
          {isAdmin && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 16 }}>
                <div className="glass-card" style={{ padding: 18 }}>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.06em" }}>Tổng feedback</div>
                  <div style={{ fontSize: 30, fontWeight: 800, color: "var(--text-main)", marginTop: 8 }}>{summary.total}</div>
                </div>
                <div className="glass-card" style={{ padding: 18 }}>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.06em" }}>Mới gửi</div>
                  <div style={{ fontSize: 30, fontWeight: 800, color: STATUS_COLORS.new, marginTop: 8 }}>{summary.newCount}</div>
                </div>
                <div className="glass-card" style={{ padding: 18 }}>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.06em" }}>Đang xem xét</div>
                  <div style={{ fontSize: 30, fontWeight: 800, color: STATUS_COLORS.reviewing, marginTop: 8 }}>{summary.reviewingCount}</div>
                </div>
                <div className="glass-card" style={{ padding: 18 }}>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.06em" }}>Đã xử lý</div>
                  <div style={{ fontSize: 30, fontWeight: 800, color: STATUS_COLORS.resolved, marginTop: 8 }}>{summary.resolvedCount}</div>
                </div>
              </div>

              <div className="glass-card" style={{ padding: 20 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Lọc theo trạng thái</label>
                    <CustomSelect value={statusFilter} onChange={setStatusFilter} options={STATUS_OPTIONS} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Lọc theo loại feedback</label>
                    <CustomSelect value={categoryFilter} onChange={setCategoryFilter} options={[{ value: "", label: "Tất cả loại feedback" }, ...CATEGORY_OPTIONS]} />
                  </div>
                  <button className="btn-ios-pill btn-ios-secondary" style={{ height: 44, alignSelf: "end" }} onClick={() => { setStatusFilter(""); setCategoryFilter(""); }}>
                    Xóa lọc
                  </button>
                </div>
              </div>
            </>
          )}

          <div className="glass-card" style={{ padding: 22 }}>
            <div style={{ marginBottom: 18 }}>
              <h3 style={{ fontSize: 20, fontWeight: 800, color: "var(--text-main)", marginBottom: 6 }}>
                {isAdmin ? "Hộp thư feedback" : "Feedback của bạn"}
              </h3>
            </div>

            {loading ? (
              <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Đang tải feedback...</div>
            ) : items.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Chưa có feedback nào.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {items.map((item) => {
                  const draft = drafts[item.id] || { status: item.status, adminNotes: item.adminNotes || "", saving: false };
                  return (
                    <div key={item.id} style={{ border: "1px solid var(--glass-border)", borderRadius: 20, padding: 18, background: "rgba(255,255,255,0.5)" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 10 }}>
                        <span style={{ padding: "6px 10px", borderRadius: 999, background: `${STATUS_COLORS[item.status] || "#64748b"}18`, color: STATUS_COLORS[item.status] || "#64748b", fontSize: 12, fontWeight: 700 }}>
                          {STATUS_LABELS[item.status] || item.status}
                        </span>
                        <span style={{ padding: "6px 10px", borderRadius: 999, background: "rgba(15,23,42,0.05)", color: "var(--text-muted)", fontSize: 12, fontWeight: 700 }}>
                          {CATEGORY_LABELS[item.category] || item.category}
                        </span>
                        {item.rating ? (
                          <span style={{ padding: "6px 10px", borderRadius: 999, background: "rgba(245,158,11,0.12)", color: "#d97706", fontSize: 12, fontWeight: 700 }}>
                            Đánh giá {item.rating}/5
                          </span>
                        ) : null}
                      </div>

                      <h4 style={{ fontSize: 18, fontWeight: 800, color: "var(--text-main)", marginBottom: 8 }}>{item.title}</h4>
                      <p style={{ fontSize: 14, color: "var(--text-main)", lineHeight: 1.6, marginBottom: 12, whiteSpace: "pre-wrap" }}>{item.message}</p>

                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginBottom: 14 }}>
                        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                          <strong style={{ color: "var(--text-main)" }}>Người gửi:</strong> {item.submitterName} ({item.submitterEmail})
                        </div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                          <strong style={{ color: "var(--text-main)" }}>Thời gian:</strong> {new Date(item.createdAt).toLocaleString("vi-VN")}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                          <strong style={{ color: "var(--text-main)" }}>Ngữ cảnh:</strong> {item.pageContext || "Chưa ghi rõ"}
                        </div>
                      </div>

                      {isAdmin ? (
                        <div style={{ borderTop: "1px solid var(--glass-border)", paddingTop: 14, display: "grid", gap: 12 }}>
                          <div className="form-group" style={{ marginBottom: 0 }}>
                            <label className="form-label">Trạng thái xử lý</label>
                            <CustomSelect
                              value={draft.status}
                              onChange={(value) => updateDraft(item.id, { status: value })}
                              options={STATUS_EDITOR_OPTIONS}
                            />
                          </div>
                          <div className="form-group" style={{ marginBottom: 0 }}>
                            <label className="form-label">Ghi chú của admin</label>
                            <textarea
                              className="form-input"
                              rows={4}
                              value={draft.adminNotes}
                              onChange={(event) => updateDraft(item.id, { adminNotes: event.target.value })}
                              placeholder="Ví dụ: đã xác nhận lỗi, đang lên kế hoạch sửa ở bản cập nhật tới..."
                              style={{ padding: 14, resize: "vertical" }}
                            />
                          </div>
                          <div style={{ display: "flex", justifyContent: "flex-end" }}>
                            <button className="btn-ios-pill btn-ios-primary" onClick={() => saveAdminUpdate(item)} disabled={draft.saving}>
                              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>save</span>
                              {draft.saving ? "Đang lưu..." : "Lưu cập nhật"}
                            </button>
                          </div>
                        </div>
                      ) : item.adminNotes ? (
                        <div style={{ borderTop: "1px solid var(--glass-border)", paddingTop: 14 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Phản hồi từ admin</div>
                          <p style={{ fontSize: 14, color: "var(--text-main)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{item.adminNotes}</p>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
