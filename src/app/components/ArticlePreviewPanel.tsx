"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { Article } from "./types";
import { getPreferredArticleNavigationLink } from "@/lib/review-link";

type Props = {
  article: Article;
  onClose: () => void;
};

function statusBadge(status: string): { label: string; bg: string; fg: string } {
  const map: Record<string, { label: string; bg: string; fg: string }> = {
    Published: { label: "Đã duyệt", bg: "rgba(34,197,94,0.1)", fg: "#16a34a" },
    Submitted: { label: "Chờ duyệt", bg: "rgba(59,130,246,0.1)", fg: "#2563eb" },
    Reviewing: { label: "Đang duyệt", bg: "rgba(245,158,11,0.1)", fg: "#d97706" },
    NeedsFix:  { label: "Sửa lỗi",   bg: "rgba(239,68,68,0.1)",  fg: "#dc2626" },
    Rejected:  { label: "Từ chối",    bg: "rgba(107,114,128,0.1)", fg: "#6b7280" },
    Draft:     { label: "Bản nháp",   bg: "rgba(107,114,128,0.08)", fg: "#94a3b8" },
  };
  return map[status] || { label: status, bg: "rgba(107,114,128,0.08)", fg: "#94a3b8" };
}

/*
 * CMS Browser Panel
 * -----------------
 * Uses a REGULAR named browser tab (not popup with features) so the CMS
 * shares the same cookie/localStorage session as the user's normal browsing.
 * The named tab "cms_review" is reused across article switches — no duplicates.
 */
const CMS_TAB_NAME = "cms_review";

export default function ArticlePreviewPanel({ article, onClose }: Props) {
  const url = getPreferredArticleNavigationLink(article);
  const tabRef = useRef<Window | null>(null);
  const [tabOpen, setTabOpen] = useState(false);
  const prevUrlRef = useRef("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const openCmsTab = useCallback(() => {
    if (!url) return;

    if (tabRef.current && !tabRef.current.closed) {
      try { tabRef.current.location.href = url; } catch {
        tabRef.current = window.open(url, CMS_TAB_NAME) || tabRef.current;
      }
      tabRef.current.focus();
      setTabOpen(true);
      return;
    }

    const win = window.open(url, CMS_TAB_NAME);
    if (win) { tabRef.current = win; setTabOpen(true); }
  }, [url]);

  useEffect(() => {
    if (!url || url === prevUrlRef.current) return;
    prevUrlRef.current = url;
    const t = setTimeout(openCmsTab, 150);
    return () => clearTimeout(t);
  }, [url, openCmsTab]);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      if (tabRef.current?.closed) { setTabOpen(false); tabRef.current = null; }
      else if (tabRef.current) setTabOpen(true);
    }, 1200);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  // Toggle class on <html> so global CSS can adjust the layout
  useEffect(() => {
    document.documentElement.classList.add("cms-panel-open");
    return () => { document.documentElement.classList.remove("cms-panel-open"); };
  }, []);

  const badge = statusBadge(article.status);

  return (
    <aside className="cms-preview-panel">
      {/* Header */}
      <header className="cms-preview-header">
        <div className="cms-preview-header-left">
          <span className="material-symbols-outlined" style={{ fontSize: 18, color: "var(--accent-blue)" }}>preview</span>
          <span className="cms-preview-header-title">Xem trước bài viết</span>
        </div>
        <button onClick={onClose} className="cms-preview-close" title="Đóng (Esc)">
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
        </button>
      </header>

      {/* Article title & status */}
      <div className="cms-preview-article-hero">
        <span className="cms-preview-badge" style={{ background: badge.bg, color: badge.fg }}>{badge.label}</span>
        <h3 className="cms-preview-article-title">{article.title}</h3>
      </div>

      {/* Quick open CMS */}
      {url && (
        <div className="cms-preview-cms-bar">
          <div className="cms-preview-tab-indicator">
            <span className="cms-preview-dot" data-active={tabOpen} />
            <span className="cms-preview-tab-label">
              {tabOpen ? "Tab CMS đang mở" : "CMS chưa mở"}
            </span>
          </div>
          <button onClick={openCmsTab} className="cms-preview-open-btn">
            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
              {tabOpen ? "arrow_forward" : "open_in_new"}
            </span>
            {tabOpen ? "Đến bài duyệt" : "Mở CMS"}
          </button>
        </div>
      )}

      {/* Meta grid */}
      <div className="cms-preview-content">
        <div className="cms-preview-meta-grid">
          <MetaItem icon="person" label="Bút danh" value={article.penName} />
          <MetaItem icon="calendar_today" label="Ngày viết" value={article.date} />
          <MetaItem icon="supervised_user_circle" label="Người duyệt" value={article.reviewerName || "—"} />
          <MetaItem icon="category" label="Loại bài" value={article.articleType || "—"} />
          <MetaItem icon="tag" label="ID" value={article.articleId || String(article.id)} mono />
          <MetaItem icon="format_list_numbered" label="Số từ" value={article.wordCountRange || "—"} />
        </div>

        {/* Notes */}
        {article.notes && (
          <div className="cms-preview-section">
            <div className="cms-preview-section-label">
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>sticky_note_2</span>
              Ghi chú
            </div>
            <div className="cms-preview-notes">{article.notes}</div>
          </div>
        )}

        {/* Links */}
        {(article.reviewLink || article.link) && (
          <div className="cms-preview-section">
            <div className="cms-preview-section-label">
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>link</span>
              Liên kết
            </div>
            <div className="cms-preview-links">
              {article.reviewLink && (
                <a href={article.reviewLink} target={CMS_TAB_NAME} className="cms-preview-link-item">
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>edit_document</span>
                  <span className="cms-preview-link-text">Link duyệt bài</span>
                  <span className="material-symbols-outlined" style={{ fontSize: 12, opacity: 0.4 }}>north_east</span>
                </a>
              )}
              {article.link && (
                <a href={article.link} target="_blank" rel="noopener noreferrer" className="cms-preview-link-item">
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>language</span>
                  <span className="cms-preview-link-text">Link bài viết</span>
                  <span className="material-symbols-outlined" style={{ fontSize: 12, opacity: 0.4 }}>north_east</span>
                </a>
              )}
            </div>
          </div>
        )}
      </div>

      <style>{`
        .cms-preview-panel {
          position: fixed;
          top: 0; right: 0; bottom: 0;
          width: min(380px, 50vw);
          z-index: 900;
          display: flex;
          flex-direction: column;
          background: var(--card-bg, #0f1117);
          border-left: 1px solid var(--glass-border);
          box-shadow: -6px 0 28px rgba(0,0,0,0.12);
          animation: cmsPanelSlide 0.22s var(--ease-apple, ease) both;
        }
        @keyframes cmsPanelSlide {
          from { transform: translateX(100%); opacity: 0.6; }
          to   { transform: translateX(0);    opacity: 1; }
        }

        /* Header */
        .cms-preview-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
          border-bottom: 1px solid var(--glass-border);
          flex-shrink: 0;
        }
        .cms-preview-header-left {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .cms-preview-header-title {
          font-size: 13px;
          font-weight: 700;
          color: var(--text-main);
          letter-spacing: -0.01em;
        }
        .cms-preview-close {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 28px; height: 28px;
          border-radius: 8px;
          border: 1px solid var(--glass-border);
          background: transparent;
          color: var(--text-muted);
          cursor: pointer;
          transition: all 0.15s;
        }
        .cms-preview-close:hover {
          background: rgba(239,68,68,0.08);
          color: var(--danger, #ef4444);
          border-color: rgba(239,68,68,0.2);
        }

        /* Article hero */
        .cms-preview-article-hero {
          padding: 16px 16px 12px;
          border-bottom: 1px solid var(--glass-border);
          flex-shrink: 0;
        }
        .cms-preview-badge {
          display: inline-flex;
          align-items: center;
          padding: 3px 10px;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.02em;
          margin-bottom: 8px;
        }
        .cms-preview-article-title {
          font-size: 15px;
          font-weight: 700;
          color: var(--text-main);
          line-height: 1.45;
          margin: 0;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        /* CMS bar */
        .cms-preview-cms-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 10px 16px;
          border-bottom: 1px solid var(--glass-border);
          flex-shrink: 0;
        }
        .cms-preview-tab-indicator {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .cms-preview-dot {
          width: 7px; height: 7px;
          border-radius: 999px;
          background: #6b7280;
          transition: all 0.3s;
        }
        .cms-preview-dot[data-active="true"] {
          background: #22c55e;
          box-shadow: 0 0 6px rgba(34,197,94,0.45);
        }
        .cms-preview-tab-label {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-muted);
        }
        .cms-preview-open-btn {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 6px 14px;
          border-radius: 8px;
          border: 1px solid rgba(37,99,235,0.2);
          background: rgba(37,99,235,0.06);
          color: var(--accent-blue);
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s;
          white-space: nowrap;
        }
        .cms-preview-open-btn:hover {
          background: rgba(37,99,235,0.12);
          border-color: rgba(37,99,235,0.35);
        }

        /* Content */
        .cms-preview-content {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        /* Meta grid */
        .cms-preview-meta-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }
        .cms-preview-meta-item {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 10px;
          border-radius: var(--radius-sm, 10px);
          background: var(--glass-bg-accent, rgba(255,255,255,0.03));
          border: 1px solid var(--glass-border);
          transition: background 0.15s;
        }
        .cms-preview-meta-item:hover {
          background: rgba(37,99,235,0.03);
        }
        .cms-preview-meta-icon {
          font-size: 14px;
          color: var(--text-muted);
          margin-top: 1px;
          flex-shrink: 0;
        }
        .cms-preview-meta-content { min-width: 0; }
        .cms-preview-meta-label {
          font-size: 10px;
          font-weight: 700;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 2px;
        }
        .cms-preview-meta-value {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-main);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        /* Section */
        .cms-preview-section { display: flex; flex-direction: column; gap: 8px; }
        .cms-preview-section-label {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          font-weight: 700;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        /* Notes */
        .cms-preview-notes {
          font-size: 13px;
          color: var(--text-main);
          line-height: 1.6;
          padding: 10px 12px;
          border-radius: var(--radius-sm, 10px);
          background: var(--glass-bg-accent, rgba(255,255,255,0.03));
          border: 1px solid var(--glass-border);
          white-space: pre-wrap;
          max-height: 160px;
          overflow-y: auto;
        }

        /* Links */
        .cms-preview-links {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .cms-preview-link-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          border-radius: 8px;
          background: rgba(37,99,235,0.04);
          border: 1px solid rgba(37,99,235,0.08);
          color: var(--accent-blue);
          text-decoration: none;
          font-size: 12px;
          font-weight: 600;
          transition: all 0.15s;
        }
        .cms-preview-link-item:hover {
          background: rgba(37,99,235,0.08);
          border-color: rgba(37,99,235,0.18);
        }
        .cms-preview-link-text {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        @media (max-width: 768px) {
          .cms-preview-panel { width: 100vw; }
        }
      `}</style>
    </aside>
  );
}

function MetaItem({ icon, label, value, mono }: { icon: string; label: string; value: string; mono?: boolean }) {
  return (
    <div className="cms-preview-meta-item">
      <span className="material-symbols-outlined cms-preview-meta-icon">{icon}</span>
      <div className="cms-preview-meta-content">
        <div className="cms-preview-meta-label">{label}</div>
        <div className="cms-preview-meta-value" style={mono ? { fontFamily: "monospace" } : undefined} title={value}>{value}</div>
      </div>
    </div>
  );
}
