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

const CMS_POPUP_NAME = "cms_preview_persistent";

export default function ArticlePreviewPanel({ article, onClose }: Props) {
  const url = getArticleUrl(article);
  const popupRef = useRef<Window | null>(null);
  const [popupOpen, setPopupOpen] = useState(false);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevUrlRef = useRef("");

  const openOrNavigatePopup = useCallback(() => {
    if (!url) return;

    if (popupRef.current && !popupRef.current.closed) {
      try {
        popupRef.current.location.href = url;
      } catch {
        // cross-origin - reopen via window.open which will reuse the named window
        popupRef.current = window.open(url, CMS_POPUP_NAME) || popupRef.current;
      }
      popupRef.current.focus();
      setPopupOpen(true);
      setPopupBlocked(false);
      return;
    }

    const screenW = window.screen.availWidth;
    const screenH = window.screen.availHeight;
    const popupW = Math.min(Math.floor(screenW * 0.55), 1200);
    const popupH = screenH;
    const popupLeft = screenW - popupW;

    const win = window.open(
      url,
      CMS_POPUP_NAME,
      `width=${popupW},height=${popupH},left=${popupLeft},top=0,menubar=no,toolbar=no,location=yes,status=no,resizable=yes,scrollbars=yes`
    );

    if (!win) {
      setPopupBlocked(true);
      setPopupOpen(false);
      return;
    }

    popupRef.current = win;
    setPopupOpen(true);
    setPopupBlocked(false);
  }, [url]);

  // Auto-open or navigate on mount / article change
  useEffect(() => {
    if (!url) return;
    if (url === prevUrlRef.current) return;
    prevUrlRef.current = url;
    const timer = setTimeout(openOrNavigatePopup, 200);
    return () => clearTimeout(timer);
  }, [url, openOrNavigatePopup]);

  // Poll popup status
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      if (popupRef.current && popupRef.current.closed) {
        setPopupOpen(false);
        popupRef.current = null;
      } else if (popupRef.current && !popupRef.current.closed) {
        setPopupOpen(true);
      }
    }, 800);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // DO NOT close popup on unmount — keep CMS session alive
  // The named window persists and will be reused next time

  const handleClose = () => {
    // Only close the panel, NOT the popup
    onClose();
  };

  const handleClosePopup = () => {
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.close();
    }
    popupRef.current = null;
    setPopupOpen(false);
  };

  const handleOpenNewTab = () => {
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <>
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.3)",
          backdropFilter: "blur(2px)",
          zIndex: 9998,
          animation: "fadeIn 0.2s ease",
        }}
        onClick={handleClose}
      />

      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(460px, 100vw)",
          background: "var(--bg-main, #0f1117)",
          borderLeft: "1px solid var(--glass-border, rgba(255,255,255,0.06))",
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          animation: "slideInRight 0.25s ease",
          boxShadow: "-8px 0 32px rgba(0,0,0,0.4)",
        }}
      >
        {/* Toolbar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "10px 16px",
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
              gap: 8,
              padding: "6px 12px",
              borderRadius: 8,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid var(--glass-border, rgba(255,255,255,0.06))",
              minWidth: 0,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 14, color: "var(--text-muted)", flexShrink: 0 }}>
              {popupOpen ? "language" : "link_off"}
            </span>
            <span
              style={{
                fontSize: 12,
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
            <>
              <button
                onClick={openOrNavigatePopup}
                title={popupOpen ? "Chuyển đến bài duyệt" : "Mở CMS"}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  border: "1px solid var(--glass-border, rgba(255,255,255,0.06))",
                  background: "rgba(255,255,255,0.04)",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                  {popupOpen ? "arrow_forward" : "open_in_new"}
                </span>
              </button>
              <button
                onClick={handleOpenNewTab}
                title="Mở trong tab mới"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  border: "1px solid var(--glass-border, rgba(255,255,255,0.06))",
                  background: "rgba(255,255,255,0.04)",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>tab</span>
              </button>
            </>
          )}

          <button
            onClick={handleClose}
            title="Đóng panel"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              borderRadius: 8,
              border: "1px solid var(--glass-border, rgba(255,255,255,0.06))",
              background: "rgba(255,255,255,0.04)",
              color: "var(--text-muted)",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Navigate button */}
          {url && popupOpen && (
            <button
              onClick={openOrNavigatePopup}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                padding: "12px 16px",
                borderRadius: 12,
                border: "1px solid rgba(59,130,246,0.3)",
                background: "linear-gradient(135deg, rgba(59,130,246,0.12), rgba(59,130,246,0.06))",
                color: "#3b82f6",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>arrow_forward</span>
              Chuyển đến bài duyệt
            </button>
          )}

          {/* Status indicator */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 14px",
              borderRadius: 12,
              background: popupOpen
                ? "rgba(34,197,94,0.06)"
                : "rgba(239,68,68,0.06)",
              border: `1px solid ${popupOpen ? "rgba(34,197,94,0.16)" : "rgba(239,68,68,0.16)"}`,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: popupOpen ? "#22c55e" : "#ef4444",
                boxShadow: popupOpen ? "0 0 8px rgba(34,197,94,0.5)" : "none",
                animation: popupOpen ? "pulse 2s infinite" : "none",
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 12, fontWeight: 700, color: popupOpen ? "#22c55e" : "var(--danger, #ef4444)" }}>
              {popupOpen ? "CMS đang mở — phiên đăng nhập được giữ" : "CMS chưa mở"}
            </span>
            {!popupOpen && url && (
              <button
                onClick={openOrNavigatePopup}
                style={{
                  marginLeft: "auto",
                  padding: "4px 12px",
                  borderRadius: 6,
                  border: "1px solid rgba(59,130,246,0.3)",
                  background: "rgba(59,130,246,0.1)",
                  color: "#3b82f6",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Mở CMS
              </button>
            )}
            {popupOpen && (
              <button
                onClick={handleClosePopup}
                title="Đóng cửa sổ CMS"
                style={{
                  marginLeft: "auto",
                  padding: "4px 8px",
                  borderRadius: 6,
                  border: "1px solid rgba(239,68,68,0.2)",
                  background: "rgba(239,68,68,0.06)",
                  color: "var(--danger, #ef4444)",
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Đóng CMS
              </button>
            )}
          </div>

          {popupBlocked && (
            <div
              style={{
                padding: "10px 14px",
                borderRadius: 12,
                background: "rgba(245,158,11,0.06)",
                border: "1px solid rgba(245,158,11,0.16)",
                fontSize: 12,
                color: "#f59e0b",
                lineHeight: 1.6,
              }}
            >
              ⚠️ Trình duyệt đã chặn popup. Vui lòng <strong>cho phép popup</strong> cho trang này rồi bấm <strong>Mở CMS</strong> lại.
            </div>
          )}

          {/* Article info */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                Bài viết
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-main, #fff)", lineHeight: 1.5 }}>
                {article.title}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <InfoCard label="Bút danh" value={article.penName} />
              <InfoCard label="Ngày viết" value={article.date} />
              <InfoCard
                label="Trạng thái"
                value={statusLabel(article.status)}
                valueColor={statusColor(article.status)}
              />
              <InfoCard label="Người duyệt" value={article.reviewerName || "—"} />
              <InfoCard label="Loại bài" value={article.articleType || "—"} />
              <InfoCard label="ID" value={article.articleId || String(article.id)} mono />
            </div>

            {article.notes && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                  Ghi chú
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--text-main, #fff)",
                    lineHeight: 1.6,
                    padding: 12,
                    borderRadius: 10,
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid var(--glass-border, rgba(255,255,255,0.06))",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {article.notes}
                </div>
              </div>
            )}

            {article.link && article.reviewLink && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                  Liên kết
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <LinkRow icon="edit_document" label="Link duyệt bài" url={article.reviewLink} />
                  <LinkRow icon="language" label="Link bài viết" url={article.link} />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </>
  );
}

function InfoCard({ label, value, valueColor, mono }: { label: string; value: string; valueColor?: string; mono?: boolean }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 10,
        background: "rgba(255,255,255,0.03)",
        border: "1px solid var(--glass-border, rgba(255,255,255,0.06))",
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: valueColor || "var(--text-main, #fff)",
          fontFamily: mono ? "monospace" : "inherit",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

function LinkRow({ icon, label, url }: { icon: string; label: string; url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        borderRadius: 8,
        background: "rgba(59,130,246,0.04)",
        border: "1px solid rgba(59,130,246,0.1)",
        color: "#3b82f6",
        textDecoration: "none",
        fontSize: 12,
        fontWeight: 600,
        transition: "background 0.15s",
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{icon}</span>
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      <span className="material-symbols-outlined" style={{ fontSize: 14, opacity: 0.5 }}>open_in_new</span>
    </a>
  );
}
