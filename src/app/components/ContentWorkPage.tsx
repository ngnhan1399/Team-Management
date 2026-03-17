"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "./auth-context";
import { emitRealtimePayload, useRealtimeRefresh } from "./realtime";
import type { ContentWorkRegistrationItem } from "./types";
import { foldSearchText, matchesLooseSearch } from "@/lib/normalize";

function formatTimestamp(value: string | null | undefined) {
  if (!value) return "Chưa có";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("vi-VN");
}

function getStatusTone(status: ContentWorkRegistrationItem["status"]) {
  switch (status) {
    case "completed":
      return { background: "rgba(16, 185, 129, 0.12)", color: "#047857", border: "rgba(16, 185, 129, 0.18)" };
    case "form_submitted":
    case "link_written":
      return { background: "rgba(245, 158, 11, 0.12)", color: "#b45309", border: "rgba(245, 158, 11, 0.18)" };
    case "failed":
      return { background: "rgba(239, 68, 68, 0.12)", color: "#b91c1c", border: "rgba(239, 68, 68, 0.18)" };
    default:
      return { background: "rgba(37, 99, 235, 0.1)", color: "#1d4ed8", border: "rgba(37, 99, 235, 0.18)" };
  }
}

export default function ContentWorkPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [items, setItems] = useState<ContentWorkRegistrationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [runningArticleId, setRunningArticleId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

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

  const fetchItems = useCallback(async (background = false) => {
    if (!background) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const res = await fetch("/api/content-work", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(data.error || "Không thể tải trạng thái Content Work");
      }
      setItems(Array.isArray(data.data) ? data.data : []);
    } catch (error) {
      showUiToast("Không thể tải Content Work", error instanceof Error ? error.message : String(error), "error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [showUiToast]);

  useEffect(() => {
    if (!user?.id) return;
    fetchItems(false);
  }, [fetchItems, user?.id]);

  useRealtimeRefresh(["content-work"], () => {
    void fetchItems(true);
  });

  const handleRetry = useCallback(async (item: ContentWorkRegistrationItem) => {
    if (runningArticleId === item.articleId) return;
    try {
      setRunningArticleId(item.articleId);
      const res = await fetch("/api/content-work", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articleId: item.articleId, force: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(data.error || "Không thể đăng ký lại Content Work");
      }
      showUiToast("Đã xếp hàng lại", `"${item.title}" đang được xử lý Content Work ở nền.`, "success");
      await fetchItems(true);
    } catch (error) {
      showUiToast("Đăng ký lại thất bại", error instanceof Error ? error.message : String(error), "error");
    } finally {
      setRunningArticleId(null);
    }
  }, [fetchItems, runningArticleId, showUiToast]);

  const summary = useMemo(() => ({
    total: items.length,
    completed: items.filter((item) => item.status === "completed").length,
    running: items.filter((item) => item.status === "queued" || item.status === "submitting_form").length,
    issues: items.filter((item) => item.status === "failed" || item.status === "form_submitted").length,
  }), [items]);
  const filteredItems = useMemo(() => {
    const query = foldSearchText(searchQuery);
    if (!query) {
      return items;
    }

    return items.filter((item) =>
      matchesLooseSearch(item.title, query)
      || matchesLooseSearch(item.penName, query)
      || matchesLooseSearch(item.articleLink, query)
      || matchesLooseSearch(item.contentWorkCategory, query)
      || matchesLooseSearch(item.statusLabel, query)
    );
  }, [items, searchQuery]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div className="card" style={{ padding: 24, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <div style={{ minWidth: 0, flex: "1 1 460px" }}>
          <h1 style={{ margin: 0, fontSize: 34, lineHeight: 1.1, letterSpacing: "-0.04em" }}>Content Work</h1>
          <p style={{ margin: "8px 0 0", color: "var(--text-muted)", fontSize: 14, lineHeight: 1.7 }}>
            {isAdmin
              ? "Theo dõi và xử lý trạng thái gửi form, điền link Content Work cho các bài CTV trong phạm vi bạn quản lý."
              : "Theo dõi trạng thái gửi form và điền link Content Work cho các bài viết của bạn."}
          </p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, width: "min(100%, 560px)", justifyContent: "flex-end" }}>
          <div style={{ position: "relative", flex: "1 1 280px", minWidth: 220 }}>
            <span className="material-symbols-outlined" style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", fontSize: 18 }}>
              search
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Tìm theo tiêu đề, bút danh, link..."
              style={{
                width: "100%",
                height: 46,
                borderRadius: 16,
                border: "1px solid rgba(148, 163, 184, 0.22)",
                background: "rgba(255,255,255,0.82)",
                padding: "0 16px 0 42px",
                fontSize: 14,
              }}
            />
          </div>
          <button type="button" className="btn-ios-pill btn-ios-secondary" onClick={() => fetchItems(true)} disabled={refreshing}>
            {refreshing ? "Đang làm mới..." : "Làm mới"}
          </button>
        </div>
      </div>

      <div className="stats-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        {[
          { label: "Tổng bài", value: summary.total, icon: "description" },
          { label: "Hoàn thành", value: summary.completed, icon: "check_circle" },
          { label: "Đang xử lý", value: summary.running, icon: "sync" },
          { label: "Cần kiểm tra", value: summary.issues, icon: "error" },
        ].map((card) => (
          <div key={card.label} className="stat-card">
            <div className="stat-card-icon"><span className="material-symbols-outlined">{card.icon}</span></div>
            <div className="stat-card-label">{card.label}</div>
            <div className="stat-card-value">{card.value}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ padding: 24 }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Đang tải danh sách Content Work...</div>
        ) : items.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
            {isAdmin
              ? "Chưa có bài CTV nào được đăng ký Content Work trong phạm vi hiện tại."
              : <>Chưa có bài nào được đăng ký Content Work. Sau khi thêm bài mới, bạn có thể bấm <strong>Đăng ký Content Work</strong>.</>}
          </div>
        ) : filteredItems.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
            Không tìm thấy bài nào khớp với từ khóa <strong>{searchQuery.trim()}</strong>.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {filteredItems.map((item) => {
              const tone = getStatusTone(item.status);
              return (
                <div key={item.id} style={{ border: "1px solid rgba(148, 163, 184, 0.16)", borderRadius: 24, padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text-main)", lineHeight: 1.4 }}>{item.title}</div>
                      <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-muted)" }}>
                        {item.penName} • {item.articleDate} • {item.contentWorkCategory || "Chưa ánh xạ danh mục"}
                      </div>
                    </div>
                    <div style={{ padding: "8px 12px", borderRadius: 999, background: tone.background, color: tone.color, border: `1px solid ${tone.border}`, fontSize: 12, fontWeight: 700 }}>
                      {item.statusLabel}
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                    <div><strong style={{ fontSize: 12 }}>Thông điệp</strong><div style={{ marginTop: 4, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>{item.automationMessage || item.lastError || "Đang chờ xử lý"}</div></div>
                    <div><strong style={{ fontSize: 12 }}>Số lần thử</strong><div style={{ marginTop: 4, fontSize: 13, color: "var(--text-main)" }}>{item.attemptCount}</div></div>
                    <div><strong style={{ fontSize: 12 }}>Gửi form lúc</strong><div style={{ marginTop: 4, fontSize: 13, color: "var(--text-main)" }}>{formatTimestamp(item.formSubmittedAt)}</div></div>
                    <div><strong style={{ fontSize: 12 }}>Điền link lúc</strong><div style={{ marginTop: 4, fontSize: 13, color: "var(--text-main)" }}>{formatTimestamp(item.linkWrittenAt || item.completedAt)}</div></div>
                  </div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                    <button type="button" className="btn-ios-pill btn-ios-secondary" onClick={() => window.open(item.formUrl, "_blank", "noopener,noreferrer")}>
                      Mở form
                    </button>
                    <button type="button" className="btn-ios-pill btn-ios-secondary" onClick={() => window.open(item.sheetUrl, "_blank", "noopener,noreferrer")}>
                      Mở sheet
                    </button>
                    <button type="button" className="btn-ios-pill btn-ios-secondary" onClick={() => item.articleLink && window.open(item.articleLink, "_blank", "noopener,noreferrer")} disabled={!item.articleLink}>
                      Mở bài viết
                    </button>
                    {(item.status === "failed" || item.status === "form_submitted") && (
                      <button type="button" className="btn-ios-pill btn-ios-primary" onClick={() => handleRetry(item)} disabled={runningArticleId === item.articleId}>
                        {runningArticleId === item.articleId ? "Đang xử lý..." : "Đăng ký lại"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
