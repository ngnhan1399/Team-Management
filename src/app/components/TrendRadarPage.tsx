"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { Page, TrendRadarItem, TrendRadarResponse } from "./types";
import { useAuth } from "./auth-context";
import { useIsMobile } from "./useMediaQuery";
import { foldSearchText } from "@/lib/normalize";
import {
  buildTrendRadarWatchlistStorageKey,
  normalizeTrendRadarWatchTerm,
  saveTrendRadarArticleDraft,
} from "@/lib/trend-radar-client";

function formatUpdatedAt(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Vừa cập nhật";
  return parsed.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getPriorityPresentation(priority: TrendRadarItem["priority"]) {
  switch (priority) {
    case "urgent":
      return { label: "Ưu tiên cao", color: "#b91c1c", background: "rgba(239,68,68,0.12)" };
    case "high":
      return { label: "Nên làm sớm", color: "#c2410c", background: "rgba(249,115,22,0.12)" };
    default:
      return { label: "Theo dõi", color: "#475569", background: "rgba(148,163,184,0.12)" };
  }
}

function getRecommendationPresentation(recommendation: TrendRadarItem["recommendation"]) {
  switch (recommendation) {
    case "refresh_existing":
      return { label: "Cập nhật bài cũ", color: "#7c3aed", background: "rgba(124,58,237,0.12)", icon: "refresh" };
    case "watch":
      return { label: "Theo dõi thêm", color: "#475569", background: "rgba(148,163,184,0.12)", icon: "visibility" };
    default:
      return { label: "Viết bài mới", color: "#2563eb", background: "rgba(37,99,235,0.12)", icon: "edit_square" };
  }
}

function getIntentLabel(intent: TrendRadarItem["intent"]) {
  switch (intent) {
    case "commercial":
      return "Ý định thương mại";
    case "comparison":
      return "Nhu cầu so sánh";
    case "problem_solving":
      return "Nhu cầu xử lý lỗi";
    case "product_lookup":
      return "Quan tâm sản phẩm";
    case "awareness":
      return "Nhận biết chủ đề";
    default:
      return "Tin tức / xu hướng";
  }
}

function mergeWatchTerms(existing: string[], additions: string[]) {
  const next = [...existing];
  const seen = new Set(existing.map((term) => foldSearchText(term)));
  for (const item of additions) {
    const normalized = normalizeTrendRadarWatchTerm(item);
    const folded = foldSearchText(normalized);
    if (!normalized || !folded || seen.has(folded)) {
      continue;
    }
    seen.add(folded);
    next.push(normalized);
  }
  return next;
}

export default function TrendRadarPage({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [data, setData] = useState<TrendRadarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [recommendationFilter, setRecommendationFilter] = useState("all");
  const [copiedKeyword, setCopiedKeyword] = useState("");
  const [watchlistInput, setWatchlistInput] = useState("");
  const [watchTerms, setWatchTerms] = useState<string[]>([]);
  const [watchOnly, setWatchOnly] = useState(false);
  const [watchlistReady, setWatchlistReady] = useState(false);

  const canCreateArticles = user?.role === "admin" || (user?.role === "ctv" && user?.collaborator?.role === "writer");
  const viewerWatchlistKey = useMemo(() => {
    const viewerKey = user?.id ? `user:${user.id}` : user?.email || user?.collaborator?.penName || "guest";
    return buildTrendRadarWatchlistStorageKey(viewerKey);
  }, [user?.collaborator?.penName, user?.email, user?.id]);

  const fetchRadar = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/trends", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Không thể tải Trend Radar lúc này.");
      }
      setData(payload.data || null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Không thể tải Trend Radar lúc này.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchRadar(true);
  }, [fetchRadar]);

  useEffect(() => {
    if (!copiedKeyword) return;
    const handle = window.setTimeout(() => setCopiedKeyword(""), 1600);
    return () => window.clearTimeout(handle);
  }, [copiedKeyword]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    setWatchlistReady(false);
    try {
      const raw = window.localStorage.getItem(viewerWatchlistKey);
      const parsed = raw ? JSON.parse(raw) : [];
      const nextTerms = Array.isArray(parsed)
        ? Array.from(new Set(parsed.map((item) => normalizeTrendRadarWatchTerm(String(item || ""))).filter(Boolean)))
        : [];
      setWatchTerms(nextTerms);
    } catch {
      setWatchTerms([]);
    } finally {
      setWatchlistReady(true);
    }
  }, [viewerWatchlistKey]);

  useEffect(() => {
    if (typeof window === "undefined" || !watchlistReady) {
      return;
    }
    window.localStorage.setItem(viewerWatchlistKey, JSON.stringify(watchTerms));
  }, [viewerWatchlistKey, watchTerms, watchlistReady]);

  useEffect(() => {
    if (watchTerms.length === 0 && watchOnly) {
      setWatchOnly(false);
    }
  }, [watchOnly, watchTerms.length]);

  const normalizedWatchTerms = useMemo(() => watchTerms.map((term) => foldSearchText(term)).filter(Boolean), [watchTerms]);

  const itemMatchesWatchlist = useCallback((item: TrendRadarItem) => {
    if (normalizedWatchTerms.length === 0) {
      return false;
    }

    const haystack = foldSearchText([
      item.keyword,
      item.headline,
      item.whyNow,
      item.recommendedCategory,
      ...item.supportSignals,
      ...item.sourceMix,
    ].join(" "));

    return normalizedWatchTerms.some((term) => haystack.includes(term));
  }, [normalizedWatchTerms]);

  const filteredItems = useMemo(() => {
    const normalizedSearch = foldSearchText(search);
    return (data?.items || []).filter((item) => {
      if (categoryFilter !== "all" && item.recommendedCategory !== categoryFilter) {
        return false;
      }
      if (recommendationFilter !== "all" && item.recommendation !== recommendationFilter) {
        return false;
      }
      if (watchOnly && normalizedWatchTerms.length > 0 && !itemMatchesWatchlist(item)) {
        return false;
      }
      if (!normalizedSearch) {
        return true;
      }
      const haystack = foldSearchText([
        item.keyword,
        item.headline,
        item.whyNow,
        item.recommendedCategory,
        ...item.supportSignals,
        ...item.sourceMix,
      ].join(" "));
      return haystack.includes(normalizedSearch);
    });
  }, [categoryFilter, data?.items, itemMatchesWatchlist, normalizedWatchTerms.length, recommendationFilter, search, watchOnly]);

  const categoryOptions = useMemo(() => ["all", ...Array.from(new Set((data?.items || []).map((item) => item.recommendedCategory)))], [data?.items]);
  const matchedWatchCount = useMemo(() => (data?.items || []).filter((item) => itemMatchesWatchlist(item)).length, [data?.items, itemMatchesWatchlist]);
  const quickStats = [
    { label: "Tổng cơ hội", value: data?.summary.total || 0, color: "#2563eb", icon: "travel_explore" },
    { label: "Ưu tiên cao", value: data?.summary.urgent || 0, color: "#dc2626", icon: "local_fire_department" },
    { label: "Nên viết mới", value: data?.summary.writeNew || 0, color: "#0f766e", icon: "add_circle" },
    { label: watchTerms.length > 0 ? "Khớp watchlist" : "Nên cập nhật", value: watchTerms.length > 0 ? matchedWatchCount : (data?.summary.refreshExisting || 0), color: watchTerms.length > 0 ? "#f59e0b" : "#7c3aed", icon: watchTerms.length > 0 ? "bookmark_manager" : "refresh" },
  ];

  const handleCopyKeyword = useCallback(async (keyword: string) => {
    try {
      await navigator.clipboard.writeText(keyword);
      setCopiedKeyword(keyword);
    } catch {
      setCopiedKeyword(keyword);
    }
  }, []);

  const handleAddWatchTerms = useCallback((rawValue: string) => {
    const additions = rawValue
      .split(/[\n,]+/)
      .map((item) => normalizeTrendRadarWatchTerm(item))
      .filter(Boolean);
    if (additions.length === 0) {
      return;
    }
    setWatchTerms((prev) => mergeWatchTerms(prev, additions));
    setWatchlistInput("");
  }, []);

  const handleRemoveWatchTerm = useCallback((termToRemove: string) => {
    const foldedTarget = foldSearchText(termToRemove);
    setWatchTerms((prev) => prev.filter((term) => foldSearchText(term) !== foldedTarget));
  }, []);

  const handleSendToArticles = useCallback((item: TrendRadarItem) => {
    if (canCreateArticles) {
      saveTrendRadarArticleDraft({
        keyword: item.keyword,
        headline: item.headline,
        recommendedCategory: item.recommendedCategory,
        recommendation: item.recommendation,
        whyNow: item.whyNow,
        searchDemandLabel: item.searchDemandLabel,
        supportSignals: item.supportSignals,
        sourceLabel: item.sources[0]?.label || null,
        sourceUrl: item.sources[0]?.url || null,
        existingCoverageTitle: item.existingCoverageSamples[0]?.title || null,
        createdAt: new Date().toISOString(),
      });
    }
    onNavigate("articles");
  }, [canCreateArticles, onNavigate]);

  return (
    <div>
      <header className="page-shell-header" style={{ marginBottom: isMobile ? 20 : 28, alignItems: "flex-start", flexDirection: isMobile ? "column" : "row" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
            <h2 style={{ margin: 0, fontSize: isMobile ? 26 : 32, fontWeight: 800, color: "var(--text-main)", letterSpacing: "-0.04em" }}>Trend Radar</h2>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 999, background: "rgba(37,99,235,0.12)", color: "#2563eb", fontSize: 12, fontWeight: 800 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>bolt</span>
              Gợi ý đề tài hành động được
            </span>
          </div>
          <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, maxWidth: 920 }}>
            Tổng hợp xu hướng từ Google Trends và các nguồn tin công nghệ lớn, rồi chấm điểm theo góc nhìn SEO để biết nên viết mới, cập nhật bài cũ hay chỉ nên theo dõi thêm.
          </p>
          <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>
            Phạm vi gợi ý nội dung hiện tại: {user?.role === "admin" ? "team của bạn" : "dữ liệu bạn đang được phép xem"}. Cập nhật lúc {data?.updatedAt ? formatUpdatedAt(data.updatedAt) : "--"}.
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, width: isMobile ? "100%" : "auto" }}>
          <button className="btn-ios-pill btn-ios-secondary" onClick={() => window.open("https://trends.google.com/trending?geo=VN", "_blank", "noopener,noreferrer")} style={{ flex: isMobile ? 1 : "initial", justifyContent: "center" }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>open_in_new</span>
            Google Trends
          </button>
          <button className="btn-ios-pill btn-ios-primary" onClick={() => { setRefreshing(true); void fetchRadar(false); }} style={{ flex: isMobile ? 1 : "initial", justifyContent: "center" }} disabled={refreshing}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{refreshing ? "progress_activity" : "refresh"}</span>
            {refreshing ? "Đang làm mới" : "Làm mới"}
          </button>
        </div>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, minmax(0, 1fr))", gap: 16, marginBottom: 24 }}>
        {quickStats.map((stat) => (
          <div key={stat.label} className="glass-card" style={{ padding: isMobile ? 16 : 20, background: "white", height: "100%" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ width: 40, height: 40, borderRadius: 14, background: `${stat.color}12`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span className="material-symbols-outlined" style={{ fontSize: 20, color: stat.color }}>{stat.icon}</span>
              </div>
              <span style={{ fontSize: 28, fontWeight: 900, color: "var(--text-main)", letterSpacing: "-0.03em" }}>{stat.value}</span>
            </div>
            <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)" }}>{stat.label}</div>
          </div>
        ))}
      </div>

      <div className="glass-card" style={{ padding: isMobile ? 16 : 20, marginBottom: 16, background: "white" }}>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(260px, 1.6fr) repeat(2, minmax(180px, 0.7fr)) auto", gap: 12, alignItems: "end" }}>
          <div>
            <label className="form-label" style={{ marginBottom: 8 }}>Tìm nhanh</label>
            <input className="form-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ví dụ: iPhone 17, Grok, lỗi WiFi, Galaxy A series..." />
          </div>
          <div>
            <label className="form-label" style={{ marginBottom: 8 }}>Danh mục</label>
            <select className="form-input" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              {categoryOptions.map((option) => <option key={option} value={option}>{option === "all" ? "Tất cả" : option}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label" style={{ marginBottom: 8 }}>Khuyến nghị</label>
            <select className="form-input" value={recommendationFilter} onChange={(event) => setRecommendationFilter(event.target.value)}>
              <option value="all">Tất cả</option>
              <option value="write_new">Nên viết mới</option>
              <option value="refresh_existing">Nên cập nhật bài cũ</option>
              <option value="watch">Nên theo dõi</option>
            </select>
          </div>
          <button className="btn-ios-pill btn-ios-secondary" onClick={() => { setSearch(""); setCategoryFilter("all"); setRecommendationFilter("all"); setWatchOnly(false); }} style={{ height: 46, justifyContent: "center" }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>filter_alt_off</span>
            Xóa lọc
          </button>
        </div>
      </div>

      <div className="glass-card" style={{ padding: isMobile ? 16 : 20, marginBottom: 24, background: "rgba(255,255,255,0.94)" }}>
        <div style={{ display: "flex", alignItems: isMobile ? "flex-start" : "center", justifyContent: "space-between", gap: 12, flexDirection: isMobile ? "column" : "row", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text-main)", marginBottom: 4 }}>Watchlist brand / model</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.55 }}>
              Thêm các cụm như iPhone, Galaxy, RTX, Xiaomi, Copilot, Gemini để ưu tiên nhìn thấy những trend sát mảng bạn đang theo dõi.
            </div>
          </div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 999, background: "rgba(245,158,11,0.12)", color: "#b45309", fontSize: 12, fontWeight: 800 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>bookmark_manager</span>
            Khớp {matchedWatchCount} cơ hội
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(260px, 1.3fr) auto auto", gap: 12, alignItems: "center" }}>
          <input
            className="form-input"
            value={watchlistInput}
            onChange={(event) => setWatchlistInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleAddWatchTerms(watchlistInput);
              }
            }}
            placeholder="Ví dụ: iPhone, Galaxy S, RTX 5090, Xiaomi 16..."
          />
          <button className="btn-ios-pill btn-ios-primary" onClick={() => handleAddWatchTerms(watchlistInput)} style={{ justifyContent: "center" }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>bookmark_add</span>
            Thêm watchlist
          </button>
          <button className={`btn-ios-pill ${watchOnly ? "btn-ios-primary" : "btn-ios-secondary"}`} onClick={() => setWatchOnly((prev) => !prev)} disabled={watchTerms.length === 0} style={{ justifyContent: "center", opacity: watchTerms.length === 0 ? 0.65 : 1 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{watchOnly ? "visibility" : "filter_list"}</span>
            {watchOnly ? "Đang lọc watchlist" : "Chỉ hiện khớp watchlist"}
          </button>
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {watchTerms.length === 0 ? (
            <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Chưa có watchlist nào. Thêm 2-5 brand/model chính để bảng này sắc nét hơn.</span>
          ) : watchTerms.map((term) => (
            <button
              key={term}
              type="button"
              onClick={() => handleRemoveWatchTerm(term)}
              className="btn-ios-pill btn-ios-secondary"
              style={{ height: 34, padding: "0 12px", fontSize: 13, borderColor: "rgba(245,158,11,0.22)", color: "#b45309", background: "rgba(245,158,11,0.08)" }}
              title={`Bỏ ${term} khỏi watchlist`}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
              {term}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(0, 1fr))", gap: 12, marginBottom: 24 }}>
        {(data?.referenceLinks || []).map((link) => (
          <a key={link.label} href={link.url} target="_blank" rel="noreferrer" className="glass-card" style={{ padding: 16, background: "rgba(255,255,255,0.92)", textDecoration: "none", color: "inherit" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
              <strong style={{ fontSize: 15, color: "var(--text-main)" }}>{link.label}</strong>
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: "var(--accent-blue)" }}>open_in_new</span>
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>{link.note}</div>
          </a>
        ))}
      </div>

      {loading ? (
        <div className="glass-card" style={{ padding: 64, textAlign: "center" }}>
          <div className="loading-spinner" style={{ width: 40, height: 40, margin: "0 auto 16px", border: "3px solid rgba(37,99,235,0.1)", borderTopColor: "var(--accent-blue)", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
          <div style={{ fontWeight: 700, color: "var(--text-main)" }}>Đang tải Trend Radar...</div>
        </div>
      ) : error ? (
        <div className="glass-card" style={{ padding: 40, textAlign: "center", background: "rgba(255,255,255,0.94)" }}>
          <div style={{ fontWeight: 800, color: "var(--danger)", marginBottom: 8 }}>Không thể tải dữ liệu trend</div>
          <div style={{ color: "var(--text-muted)", marginBottom: 18 }}>{error}</div>
          <button className="btn-ios-pill btn-ios-primary" onClick={() => void fetchRadar(true)}>Thử lại</button>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 18 }}>
          {filteredItems.length === 0 ? (
            <div className="glass-card" style={{ padding: 50, textAlign: "center", background: "white" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📡</div>
              <div style={{ fontWeight: 800, color: "var(--text-main)", marginBottom: 8 }}>Chưa có trend khớp bộ lọc</div>
              <div style={{ color: "var(--text-muted)" }}>Hãy nới bộ lọc hoặc làm mới dữ liệu để xem thêm cơ hội mới.</div>
            </div>
          ) : filteredItems.map((item) => {
            const priority = getPriorityPresentation(item.priority);
            const recommendation = getRecommendationPresentation(item.recommendation);
            const matchesWatchlist = itemMatchesWatchlist(item);
            const keywordWatched = normalizedWatchTerms.includes(foldSearchText(item.keyword));
            return (
              <article key={item.id} className="glass-card" style={{ padding: isMobile ? 18 : 22, background: "white" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexDirection: isMobile ? "column" : "row" }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                      <span style={{ display: "inline-flex", alignItems: "center", padding: "6px 10px", borderRadius: 999, background: priority.background, color: priority.color, fontSize: 12, fontWeight: 800 }}>{priority.label}</span>
                      <span style={{ display: "inline-flex", alignItems: "center", padding: "6px 10px", borderRadius: 999, background: recommendation.background, color: recommendation.color, fontSize: 12, fontWeight: 800, gap: 6 }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{recommendation.icon}</span>
                        {recommendation.label}
                      </span>
                      <span style={{ display: "inline-flex", alignItems: "center", padding: "6px 10px", borderRadius: 999, background: "rgba(15,23,42,0.06)", color: "var(--text-muted)", fontSize: 12, fontWeight: 700 }}>Score {item.score}</span>
                      {matchesWatchlist && <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 999, background: "rgba(245,158,11,0.12)", color: "#b45309", fontSize: 12, fontWeight: 800 }}><span className="material-symbols-outlined" style={{ fontSize: 14 }}>bookmark</span>Khớp watchlist</span>}
                    </div>
                    <h3 style={{ margin: 0, fontSize: isMobile ? 18 : 22, fontWeight: 800, color: "var(--text-main)", lineHeight: 1.3 }}>{item.keyword}</h3>
                    <div style={{ marginTop: 6, color: "var(--text-muted)", fontSize: 14, lineHeight: 1.55 }}>{item.headline}</div>
                    <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ display: "inline-flex", padding: "6px 10px", borderRadius: 999, background: "rgba(37,99,235,0.08)", color: "#2563eb", fontSize: 12, fontWeight: 800 }}>{item.recommendedCategory}</span>
                      <span style={{ display: "inline-flex", padding: "6px 10px", borderRadius: 999, background: "rgba(15,23,42,0.06)", color: "var(--text-main)", fontSize: 12, fontWeight: 700 }}>{getIntentLabel(item.intent)}</span>
                      <span style={{ display: "inline-flex", padding: "6px 10px", borderRadius: 999, background: "rgba(16,185,129,0.08)", color: "#047857", fontSize: 12, fontWeight: 700 }}>{item.freshnessLabel}</span>
                      {item.searchDemandLabel && <span style={{ display: "inline-flex", padding: "6px 10px", borderRadius: 999, background: "rgba(249,115,22,0.08)", color: "#c2410c", fontSize: 12, fontWeight: 700 }}>{item.searchDemandLabel}</span>}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: isMobile ? "flex-start" : "flex-end" }}>
                    <button className="btn-ios-pill btn-ios-secondary" onClick={() => void handleCopyKeyword(item.keyword)}>
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{copiedKeyword === item.keyword ? "check" : "content_copy"}</span>
                      {copiedKeyword === item.keyword ? "Đã copy" : "Copy keyword"}
                    </button>
                    <button className="btn-ios-pill btn-ios-secondary" onClick={() => handleAddWatchTerms(item.keyword)} disabled={keywordWatched} style={{ opacity: keywordWatched ? 0.7 : 1 }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{keywordWatched ? "bookmark_added" : "bookmark_add"}</span>
                      {keywordWatched ? "Đang theo dõi" : "Theo dõi keyword"}
                    </button>
                    <button className="btn-ios-pill btn-ios-secondary" onClick={() => window.open(`https://trends.google.com/trends/explore?q=${encodeURIComponent(item.keyword)}&geo=VN`, "_blank", "noopener,noreferrer")}>
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>trending_up</span>
                      Xem trend
                    </button>
                    <button className="btn-ios-pill btn-ios-primary" onClick={() => handleSendToArticles(item)}>
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{canCreateArticles ? "edit_square" : "description"}</span>
                      {canCreateArticles ? (item.recommendation === "refresh_existing" ? "Tạo nháp cập nhật" : "Tạo bài từ trend") : "Sang Bài viết"}
                    </button>
                  </div>
                </div>

                <div style={{ marginTop: 16, padding: 14, borderRadius: 18, background: "rgba(248,250,252,0.8)", border: "1px solid rgba(148,163,184,0.12)" }}>
                  <div style={{ fontSize: 13, color: "var(--text-main)", fontWeight: 700, marginBottom: 8 }}>Vì sao nên chú ý</div>
                  <div style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.6 }}>{item.whyNow}</div>
                  <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {item.supportSignals.map((signal) => (
                      <span key={signal} style={{ display: "inline-flex", alignItems: "center", padding: "5px 9px", borderRadius: 999, background: "white", color: "var(--text-muted)", fontSize: 12, fontWeight: 700, border: "1px solid rgba(148,163,184,0.14)" }}>{signal}</span>
                    ))}
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1.3fr) minmax(0, 0.9fr)", gap: 16, marginTop: 16 }}>
                  <div className="glass-card" style={{ padding: 16, background: "rgba(255,255,255,0.86)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <strong style={{ color: "var(--text-main)" }}>Phủ nội dung trong hệ thống</strong>
                      <span style={{ color: item.existingCoverageCount > 0 ? "#7c3aed" : "#2563eb", fontWeight: 800, fontSize: 13 }}>{item.existingCoverageCount} bài</span>
                    </div>
                    {item.existingCoverageSamples.length === 0 ? (
                      <div style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6 }}>Chưa thấy bài nào phủ rõ keyword/topic này trong phạm vi hiện tại.</div>
                    ) : (
                      <div style={{ display: "grid", gap: 10 }}>
                        {item.existingCoverageSamples.map((sample) => (
                          <div key={`${sample.articleId}-${sample.title}`} style={{ padding: 12, borderRadius: 14, background: "rgba(248,250,252,0.8)", border: "1px solid rgba(148,163,184,0.12)" }}>
                            <div style={{ fontWeight: 700, color: "var(--text-main)", fontSize: 14, lineHeight: 1.45 }}>{sample.title}</div>
                            <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-muted)" }}>{sample.date} • {sample.status}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="glass-card" style={{ padding: 16, background: "rgba(255,255,255,0.86)" }}>
                    <strong style={{ display: "block", color: "var(--text-main)", marginBottom: 10 }}>Nguồn tín hiệu</strong>
                    <div style={{ display: "grid", gap: 10 }}>
                      {item.sources.map((source) => (
                        <a key={`${item.id}-${source.label}-${source.url}`} href={source.url} target="_blank" rel="noreferrer" style={{ textDecoration: "none", color: "inherit", padding: 12, borderRadius: 14, background: "rgba(248,250,252,0.8)", border: "1px solid rgba(148,163,184,0.12)", display: "block" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                            <div>
                              <div style={{ fontWeight: 700, color: "var(--text-main)", fontSize: 14 }}>{source.label}</div>
                              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{source.publishedAt ? formatUpdatedAt(source.publishedAt) : item.trendWindowLabel}</div>
                            </div>
                            <span className="material-symbols-outlined" style={{ fontSize: 18, color: "var(--accent-blue)" }}>open_in_new</span>
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

