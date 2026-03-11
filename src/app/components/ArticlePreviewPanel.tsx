"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { Article } from "./types";

type Props = {
  article: Article;
  onClose: () => void;
};

function getArticleUrl(article: Pick<Article, "reviewLink" | "link">) {
  return String(article.reviewLink || "").trim() || String(article.link || "").trim() || "";
}

function statusColor(status: string) {
  switch (status) {
    case "Published": return "#22c55e";
    case "Submitted": return "#3b82f6";
    case "Reviewing": return "#f59e0b";
    case "NeedsFix": return "#ef4444";
    case "Rejected": return "#6b7280";
    default: return "#94a3b8";
  }
}

function statusLabel(status: string) {
  switch (status) {
    case "Published": return "Đã duyệt";
    case "Submitted": return "Chờ duyệt";
    case "Reviewing": return "Đang duyệt";
    case "NeedsFix": return "Sửa lỗi";
    case "Rejected": return "Từ chối";
    case "Draft": return "Bản nháp";
    default: return status;
  }
}

const CMS_TAB_NAME = "cms_review";

declare global {
  interface Window {
    __cmsReviewTab?: Window | null;
  }
}

function getLiveCmsTab() {
  if (typeof window === "undefined") return null;
  const existing = window.__cmsReviewTab;
  if (existing && !existing.closed) {
    return existing;
  }
  window.__cmsReviewTab = null;
  return null;
}

export default function ArticlePreviewPanel({ article, onClose }: Props) {
  const url = getArticleUrl(article);
  const tabRef = useRef<Window | null>(null);
  const [tabOpen, setTabOpen] = useState(false);
  const [tabBlocked, setTabBlocked] = useState(false);
  const [needsNavigateHint, setNeedsNavigateHint] = useState(false);
  const prevUrlRef = useRef("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const openCmsTab = useCallback(() => {
    if (!url) return;

    const activeTab = tabRef.current && !tabRef.current.closed ? tabRef.current : getLiveCmsTab();
    if (activeTab) {
      tabRef.current = activeTab;
      window.__cmsReviewTab = activeTab;
      activeTab.focus();
      setTabOpen(true);
      setTabBlocked(false);
      setNeedsNavigateHint(true);
      return;
    }

    const win = window.open(url, CMS_TAB_NAME);
    if (!win) {
      setTabOpen(false);
      setTabBlocked(true);
      return;
    }

    tabRef.current = win;
    window.__cmsReviewTab = win;
    setTabOpen(true);
    setTabBlocked(false);
    setNeedsNavigateHint(true);
  }, [url]);

  const navigateTabToArticle = useCallback(() => {
    if (!url) return;

    const activeTab = tabRef.current && !tabRef.current.closed ? tabRef.current : getLiveCmsTab();
    if (activeTab) {
      tabRef.current = window.open(url, CMS_TAB_NAME) || activeTab;
    } else {
      tabRef.current = window.open(url, CMS_TAB_NAME) || null;
    }

    if (!tabRef.current) {
      setTabOpen(false);
      setTabBlocked(true);
      return;
    }

    window.__cmsReviewTab = tabRef.current;
    tabRef.current.focus();
    setTabOpen(true);
    setTabBlocked(false);
    setNeedsNavigateHint(false);
  }, [url]);

  useEffect(() => {
    if (!url || url === prevUrlRef.current) return;
    prevUrlRef.current = url;
    const timer = setTimeout(() => {
      const activeTab = getLiveCmsTab();
      if (activeTab) {
        tabRef.current = activeTab;
        activeTab.focus();
        setTabOpen(true);
        setTabBlocked(false);
        setNeedsNavigateHint(true);
        return;
      }
      openCmsTab();
    }, 200);
    return () => clearTimeout(timer);
  }, [url, openCmsTab]);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      const activeTab = tabRef.current && !tabRef.current.closed ? tabRef.current : getLiveCmsTab();
      if (activeTab) {
        tabRef.current = activeTab;
        window.__cmsReviewTab = activeTab;
        setTabOpen(true);
      } else {
        tabRef.current = null;
        window.__cmsReviewTab = null;
        setTabOpen(false);
      }
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: "min(400px, 45vw)",
        background: "var(--bg-main, #0f1117)",
        borderLeft: "1px solid var(--glass-border, rgba(255,255,255,0.06))",
        zIndex: 900,
        display: "flex",
        flexDirection: "column",
        animation: "slideInRight 0.2s ease",
        boxShadow: "-4px 0 24px rgba(0,0,0,0.3)",
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 12px",
          borderBottom: "1px solid var(--glass-border, rgba(255,255,255,0.06))",
          background: "rgba(255,255,255,0.02)",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 10px",
            borderRadius: 8,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid var(--glass-border, rgba(255,255,255,0.06))",
            minWidth: 0,
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: 999,
              background: tabOpen ? "#22c55e" : "#6b7280",
              boxShadow: tabOpen ? "0 0 6px rgba(34,197,94,0.4)" : "none",
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              fontFamily: "monospace",
            }}
            title={url}
          >
            {url || "Không có link"}
          </span>
        </div>

        {url && (
          <button
            onClick={tabOpen ? navigateTabToArticle : openCmsTab}
            title={tabOpen ? "Chuyển đến bài duyệt" : "Mở CMS"}
            style={toolbarBtnStyle}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
              {tabOpen ? "arrow_forward" : "open_in_new"}
            </span>
          </button>
        )}

        <button
          onClick={onClose}
          title="Đóng panel"
          style={{ ...toolbarBtnStyle, border: "1px solid rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.06)", color: "var(--danger, #ef4444)" }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 15 }}>close</span>
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>

        {/* Action button */}
        <button
          onClick={tabOpen ? navigateTabToArticle : openCmsTab}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "10px 14px",
            borderRadius: 10,
            border: `1px solid ${tabOpen ? "rgba(59,130,246,0.3)" : "rgba(34,197,94,0.3)"}`,
            background: tabOpen
              ? "linear-gradient(135deg, rgba(59,130,246,0.12), rgba(59,130,246,0.06))"
              : "linear-gradient(135deg, rgba(34,197,94,0.12), rgba(34,197,94,0.06))",
            color: tabOpen ? "#3b82f6" : "#22c55e",
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            {tabOpen ? "arrow_forward" : "open_in_new"}
          </span>
          {tabOpen ? "Chuyển đến bài duyệt" : "Mở CMS"}
        </button>

        {tabOpen && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, color: "#22c55e", fontWeight: 700 }}>● Tab CMS đang mở</span>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>— giữ nguyên tab này để giữ phiên đăng nhập</span>
          </div>
        )}

        {tabOpen && needsNavigateHint && (
          <div style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(59,130,246,0.14)", background: "rgba(59,130,246,0.06)", color: "var(--text-main, #fff)", fontSize: 12, lineHeight: 1.6 }}>
            Nếu tab CMS đang ở màn đăng nhập hoặc dashboard, hãy đăng nhập xong rồi bấm <strong>`Chuyển đến bài duyệt`</strong> để đi tới bài hiện tại mà không làm reset tab CMS giữa chừng.
          </div>
        )}

        {tabBlocked && (
          <div style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(239,68,68,0.18)", background: "rgba(239,68,68,0.08)", color: "var(--text-main, #fff)", fontSize: 12, lineHeight: 1.6 }}>
            Trình duyệt đang chặn việc mở tab CMS. Hãy cho phép popup/tab mới cho domain này rồi thử lại.
          </div>
        )}

        {/* Article info */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-main, #fff)", lineHeight: 1.4 }}>
            {article.title}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <InfoCard label="Bút danh" value={article.penName} />
            <InfoCard label="Ngày viết" value={article.date} />
            <InfoCard label="Trạng thái" value={statusLabel(article.status)} valueColor={statusColor(article.status)} />
            <InfoCard label="Người duyệt" value={article.reviewerName || "—"} />
            <InfoCard label="Loại bài" value={article.articleType || "—"} />
            <InfoCard label="ID" value={article.articleId || String(article.id)} mono />
          </div>

          {article.notes && (
            <div style={{ fontSize: 12, color: "var(--text-main, #fff)", lineHeight: 1.6, padding: 10, borderRadius: 8, background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border, rgba(255,255,255,0.06))", whiteSpace: "pre-wrap" }}>
              {article.notes}
            </div>
          )}

          {article.link && article.reviewLink && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <LinkRow icon="edit_document" label="Link duyệt bài" url={article.reviewLink} />
              <LinkRow icon="language" label="Link bài viết" url={article.link} />
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

const toolbarBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 30,
  height: 30,
  borderRadius: 7,
  border: "1px solid var(--glass-border, rgba(255,255,255,0.06))",
  background: "rgba(255,255,255,0.04)",
  color: "var(--text-muted)",
  cursor: "pointer",
  flexShrink: 0,
};

function InfoCard({ label, value, valueColor, mono }: { label: string; value: string; valueColor?: string; mono?: boolean }) {
  return (
    <div style={{ padding: "8px 10px", borderRadius: 8, background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border, rgba(255,255,255,0.06))" }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: valueColor || "var(--text-main, #fff)", fontFamily: mono ? "monospace" : "inherit", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={value}>{value}</div>
    </div>
  );
}

function LinkRow({ icon, label, url }: { icon: string; label: string; url: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 7, background: "rgba(59,130,246,0.04)", border: "1px solid rgba(59,130,246,0.1)", color: "#3b82f6", textDecoration: "none", fontSize: 11, fontWeight: 600 }}>
      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{icon}</span>
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      <span className="material-symbols-outlined" style={{ fontSize: 13, opacity: 0.5 }}>open_in_new</span>
    </a>
  );
}
