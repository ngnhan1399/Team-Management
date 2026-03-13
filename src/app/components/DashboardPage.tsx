"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./auth-context";
import { useRealtimeRefresh } from "./realtime";
import { isApprovedArticleStatus } from "@/lib/article-status";
import type { DashboardStats, Page } from "./types";

const DASHBOARD_STATS_CACHE_TTL_MS = 30_000;

let dashboardStatsCache: DashboardStats | null = null;
let dashboardStatsCacheAt = 0;

function formatActivityTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Vừa cập nhật";
  return parsed.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getStatusPresentation(status: string) {
  switch (status) {
    case "Published":
    case "Approved":
      return { label: "Hoàn thành", background: "#dcfce7", color: "#15803d" };
    case "NeedsFix":
      return { label: "Cần sửa", background: "#fee2e2", color: "#b91c1c" };
    case "Reviewing":
      return { label: "Đang duyệt", background: "#fff7ed", color: "#c2410c" };
    case "Submitted":
      return { label: "Đã gửi duyệt", background: "#dbeafe", color: "#1d4ed8" };
    case "Rejected":
      return { label: "Từ chối", background: "#f3e8ff", color: "#7e22ce" };
    default:
      return { label: "Bản nháp", background: "#e2e8f0", color: "#475569" };
  }
}

export default function DashboardPage({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const { user } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshTimeoutRef = useRef<number | null>(null);

  const refreshStats = useCallback((showLoading = false) => {
    if (showLoading) {
      setLoading(true);
    }
    fetch("/api/statistics", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const nextStats = d.data || null;
        dashboardStatsCache = nextStats;
        dashboardStatsCacheAt = Date.now();
        setStats(nextStats);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    const hasFreshCache = dashboardStatsCache && Date.now() - dashboardStatsCacheAt < DASHBOARD_STATS_CACHE_TTL_MS;
    if (hasFreshCache) {
      const handle = window.setTimeout(() => {
        setStats(dashboardStatsCache);
        setLoading(false);
      }, 0);

      return () => window.clearTimeout(handle);
    }

    const handle = window.setTimeout(() => {
      refreshStats(true);
    }, 0);

    return () => window.clearTimeout(handle);
  }, [refreshStats]);

  const scheduleStatsRefresh = useCallback(() => {
    if (typeof window === "undefined") {
      refreshStats(false);
      return;
    }

    if (refreshTimeoutRef.current) {
      return;
    }

    refreshTimeoutRef.current = window.setTimeout(() => {
      refreshTimeoutRef.current = null;
      refreshStats(false);
    }, 1500);
  }, [refreshStats]);

  useEffect(() => () => {
    if (refreshTimeoutRef.current) {
      window.clearTimeout(refreshTimeoutRef.current);
    }
  }, []);

  useRealtimeRefresh(["dashboard", "articles", "team"], scheduleStatsRefresh);

  if (loading) return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "60vh", gap: 16 }}>
      <div className="loading-spinner" style={{ width: 40, height: 40, border: "3px solid rgba(37, 99, 235, 0.1)", borderTopColor: "var(--accent-blue)", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
      <p style={{ color: "var(--text-muted)", fontSize: 14, fontWeight: 500 }}>Đang tải dữ liệu hệ thống...</p>
    </div>
  );

  const published = stats?.articlesByStatus?.reduce((total, item) => (
    total + (isApprovedArticleStatus(item.status) ? item.count : 0)
  ), 0) || 0;
  const pending = stats?.articlesByStatus?.find((s) => s.status === "Submitted")?.count || 0;
  const currentHour = new Date().getHours();
  const greeting = currentHour < 12 ? "buổi sáng" : currentHour < 18 ? "buổi chiều" : "buổi tối";
  const displayName = (typeof user?.collaborator?.name === "string" && user.collaborator.name.trim())
    || user?.collaborator?.penName
    || user?.email.split("@")[0]
    || "bạn";

  return (
    <>
      <header className="page-shell-header" style={{ marginBottom: 40, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4, flexWrap: "wrap" }}>
            <h2 style={{ fontSize: 32, fontWeight: 800, color: "var(--text-main)", letterSpacing: "-0.04em", lineHeight: 1.1 }}>{`Chào ${greeting}, ${displayName}`}</h2>
            <div style={{ padding: "4px 10px", background: "rgba(16, 185, 129, 0.1)", borderRadius: 20, display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981", boxShadow: "0 0 8px #10b981" }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: "#059669", textTransform: "uppercase" }}>Hệ thống ổn định</span>
            </div>
          </div>
        </div>
        <div className="page-shell-actions">
          <button className="btn-ios-pill btn-ios-secondary" style={{ background: "white", boxShadow: "var(--specular-top)" }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>file_download</span>
            Báo cáo
          </button>
          <button className="btn-ios-pill btn-ios-primary" onClick={() => onNavigate("articles")}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>article</span>
            Quản lý bài viết
          </button>
        </div>
      </header>

      {/* Tier 1: Main KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 24, marginBottom: 32 }}>
        {[
          { label: "Tổng bài viết", value: stats?.totalArticles || 0, sub: "+12.5%", icon: "article", color: "#2563eb", trend: "up" },
          { label: "Bài đã duyệt", value: published, sub: "Đã xuất bản", icon: "payments", color: "#0d9488", trend: "neutral" },
          { label: "Đang chờ duyệt", value: pending, sub: "Yêu cầu ưu tiên", icon: "hourglass_empty", color: "#ea580c", trend: "warning" },
          { label: "Cộng tác viên", value: stats?.totalCTVs || 0, sub: "Quy mô hiện tại", icon: "group", color: "#9333ea", trend: "up" }
        ].map((s, i) => (
          <div key={i} className="glass-card" style={{ padding: 24, borderRadius: 24, background: "white", boxShadow: "var(--shadow-premium), var(--specular-top)", display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ width: 44, height: 44, borderRadius: 14, background: `${s.color}15`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span className="material-symbols-outlined" style={{ fontSize: 22, color: s.color, fontVariationSettings: "'FILL' 1" }}>{s.icon}</span>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: s.trend === 'up' ? "#10b981" : s.trend === 'warning' ? "#f59e0b" : "var(--text-muted)", background: s.trend === 'up' ? "#10b98110" : s.trend === 'warning' ? "#f59e0b10" : "transparent", padding: "4px 8px", borderRadius: 8 }}>{s.sub}</span>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: "var(--text-main)", letterSpacing: "-0.02em" }}>{s.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Tier 2: Distribution & Insights */}
      <div className="dashboard-insight-grid">
        <div style={{ background: "white", borderRadius: 32, padding: 32, boxShadow: "var(--shadow-premium)", border: "1px solid var(--border-muted)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: "var(--text-main)", display: "flex", alignItems: "center", gap: 10 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 22, color: "var(--accent-blue)" }}>analytics</span>
              Hiệu suất Cộng tác viên bài viết
            </h3>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent-blue)" }} />
              <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>Tháng này</span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            {stats?.articlesByWriter?.slice(0, 5).map((w, i: number) => {
              const colors = ["#2563eb", "#0d9488", "#9333ea", "#ea580c", "#64748b"];
              const percentage = stats.totalArticles ? Math.min((w.count / stats.totalArticles) * 100 * 2.5, 100) : 0;
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{ width: 140, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-main)", lineHeight: 1.3 }}>{w.displayName}</div>
                    {w.penName && w.penName !== w.displayName && (
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{w.penName}</div>
                    )}
                  </div>
                  <div style={{ flex: 1, height: 10, background: "#f1f5f9", borderRadius: 5, overflow: "hidden", position: "relative" }}>
                    <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${percentage}%`, background: `linear-gradient(90deg, ${colors[i % colors.length]}, ${colors[i % colors.length]}dd)`, borderRadius: 5, transition: "width 1.2s cubic-bezier(0.34, 1.56, 0.64, 1)" }} />
                  </div>
                  <div style={{ width: 60, textAlign: "right", fontSize: 13, fontWeight: 700, color: "var(--text-main)" }}>{w.count} bài</div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ background: "white", borderRadius: 32, padding: 32, boxShadow: "var(--shadow-premium)", border: "1px solid var(--border-muted)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: "var(--text-main)" }}>Danh mục</h3>
            <span className="material-symbols-outlined" style={{ color: "var(--text-muted)", cursor: "pointer" }}>more_horiz</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {stats?.articlesByCategory?.slice(0, 4).map((c, i: number) => {
              const colors = ["#2563eb", "#0d9488", "#9333ea", "#ea580c"];
              const percentage = stats.totalArticles ? Math.round((c.count / stats.totalArticles) * 100) : 0;
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 18px", background: "#f8fafc", borderRadius: 20, transition: "transform 0.2s" }} className="hover:scale-[1.02]">
                  <div style={{ width: 40, height: 40, borderRadius: 12, background: "white", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(0,0,0,0.05)" }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: colors[i % colors.length] }}>{percentage}%</span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text-main)" }}>{c.category}</p>
                    <p style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>{c.count} bài viết hiện có</p>
                  </div>
                  <div style={{ width: 32, height: 4, background: colors[i % colors.length], borderRadius: 2 }} />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Tier 3: Recent Activity Table */}
      <div style={{ background: "white", borderRadius: 32, padding: 0, overflow: "hidden", boxShadow: "var(--shadow-premium)", border: "1px solid var(--border-muted)" }}>
        <div style={{ padding: "24px 32px", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: "var(--text-main)" }}>Hoạt động mới nhất</h3>
          <button onClick={() => onNavigate("articles")} style={{ fontSize: 13, fontWeight: 700, color: "var(--accent-blue)", background: "transparent", border: "none", cursor: "pointer" }}>Xem tất cả</button>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                <th style={{ padding: "16px 32px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em" }}>Bài viết</th>
                <th style={{ padding: "16px 32px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em" }}>Người viết</th>
                <th style={{ padding: "16px 32px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em", textAlign: "center" }}>Loại bài</th>
                <th style={{ padding: "16px 32px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em", textAlign: "center" }}>Trạng thái</th>
                <th style={{ padding: "16px 32px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em", textAlign: "right" }}>Ngày cập nhật</th>
              </tr>
            </thead>
            <tbody>
              {(stats?.latestArticles || []).map((a, i: number) => (
                <tr key={a.id || i} style={{ borderBottom: "1px solid #f1f5f9", transition: "background 0.2s" }} className="hover:bg-slate-50">
                  <td style={{ padding: "20px 32px", maxWidth: 350 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-main)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{a.articleId || "No ID"}</div>
                  </td>
                  <td style={{ padding: "20px 32px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--accent-blue)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800 }}>{(a.writerDisplayName || a.penName || "?")[0]}</div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-main)" }}>{a.writerDisplayName || a.penName}</div>
                        {a.penName && a.writerDisplayName && a.penName !== a.writerDisplayName && (
                          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{a.penName}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: "20px 32px", textAlign: "center" }}>
                    <span style={{ fontSize: 10, fontWeight: 800, color: "var(--accent-blue)", background: "rgba(59, 130, 246, 0.1)", padding: "4px 10px", borderRadius: 8, textTransform: "uppercase", whiteSpace: "nowrap" }}>{a.articleType || "SEO"}</span>
                  </td>
                  <td style={{ padding: "20px 32px", textAlign: "center" }}>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 12, background: getStatusPresentation(a.status).background, color: getStatusPresentation(a.status).color, fontSize: 12, fontWeight: 700 }}>
                      <div style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor" }} />
                      {getStatusPresentation(a.status).label}
                    </div>
                  </td>
                  <td style={{ padding: "20px 32px", textAlign: "right", fontSize: 13, color: "var(--text-muted)", fontWeight: 500 }}>
                    {formatActivityTime(a.updatedAt)}
                  </td>
                </tr>
              ))}
              {(stats?.latestArticles || []).length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: "32px", textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>
                    Chưa có dữ liệu hoạt động gần đây.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ══════════════════════════ ARTICLES ══════════════════════════ */
