"use client";

import React from "react";
import type { Article } from "./types";
import { getDisplayedPenName } from "./articles-page-config";

interface MobileArticleCardProps {
  article: Article;
  onEdit?: () => void;
  onDelete?: () => void;
  onComments?: () => void;
  onRegisterContentWork?: () => void;
  canEdit?: boolean;
  canRegisterContentWork?: boolean;
  showContentWorkAction?: boolean;
  canDelete?: boolean;
  showAuthor?: boolean;
  isDeleting?: boolean;
  isRegisteringContentWork?: boolean;
  unreadComments?: number;
}

export default function MobileArticleCard({
  article,
  onEdit,
  onDelete,
  onComments,
  onRegisterContentWork,
  canEdit = true,
  canRegisterContentWork = false,
  showContentWorkAction = false,
  canDelete = true,
  showAuthor = true,
  isDeleting = false,
  isRegisteringContentWork = false,
  unreadComments = 0,
}: MobileArticleCardProps) {
  const penName = getDisplayedPenName(article.penName) || "N/A";
  const contentWorkStatus = article.contentWorkStatus || null;
  const contentWorkPending = contentWorkStatus === "queued"
    || contentWorkStatus === "submitting_form"
    || contentWorkStatus === "form_submitted"
    || contentWorkStatus === "link_written";
  const contentWorkCompleted = contentWorkStatus === "completed";
  const contentWorkDisabled = isRegisteringContentWork || contentWorkPending || contentWorkCompleted;
  const contentWorkLabel = isRegisteringContentWork
    ? "Đang gửi..."
    : contentWorkCompleted
      ? "Đã đăng ký"
      : contentWorkPending
        ? (article.contentWorkStatusLabel || "Đang xử lý")
        : "Content Work";
  const contentWorkTone = contentWorkCompleted
    ? { background: "rgba(16, 185, 129, 0.12)", color: "#047857" }
    : contentWorkPending
      ? { background: "rgba(245, 158, 11, 0.12)", color: "#b45309" }
      : { background: "rgba(37, 99, 235, 0.08)", color: "#2563eb" };

  const getStatusStyle = (s: string) => {
    const map: Record<string, { bg: string; text: string; icon: string; label: string }> = {
      Published: { bg: "rgba(16, 185, 129, 0.1)", text: "#10b981", icon: "check_circle", label: "Đã duyệt" },
      Approved: { bg: "rgba(16, 185, 129, 0.1)", text: "#10b981", icon: "check_circle", label: "Đã duyệt" },
      Draft: { bg: "rgba(255, 255, 255, 0.05)", text: "#94a3b8", icon: "edit_note", label: "Bản nháp" },
      Submitted: { bg: "rgba(59, 130, 246, 0.1)", text: "#3b82f6", icon: "outbox", label: "Chờ duyệt" },
      Reviewing: { bg: "rgba(168, 85, 247, 0.1)", text: "#a855f7", icon: "find_in_page", label: "Đang duyệt" },
      Rejected: { bg: "rgba(239, 68, 68, 0.1)", text: "#f87171", icon: "cancel", label: "Từ chối" },
      NeedsFix: { bg: "rgba(249, 115, 22, 0.1)", text: "#f97316", icon: "warning", label: "Sửa lỗi" }
    };
    return map[s] || map.Draft;
  };

  const status = getStatusStyle(article.status);
  
  return (
    <div 
      className={`bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-4 mb-1 transition-all ${isDeleting ? "opacity-50 scale-95" : "active:scale-[0.98]"}`}
    >
      <div className="flex justify-between items-start mb-2 gap-3">
        <h4 className="text-sm font-bold text-slate-800 dark:text-white line-clamp-2 leading-tight flex-1">
          {article.title || "Chưa có tiêu đề"}
        </h4>
        <div 
          className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider"
          style={{ background: status.bg, color: status.text }}
        >
          <span className="material-symbols-outlined text-[14px]">{status.icon}</span>
          {status.label}
        </div>
      </div>
      
      <div className="flex items-center text-[11px] text-slate-400 dark:text-slate-500 font-medium mb-4 gap-2">
        {showAuthor && (
          <>
            <span className="flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">person</span>
              {penName}
            </span>
            <span className="w-1 h-1 bg-slate-200 dark:bg-slate-700 rounded-full" />
          </>
        )}
        <span className="flex items-center gap-1">
          <span className="material-symbols-outlined text-[14px]">calendar_today</span>
          {article.date || "N/A"}
        </span>
        {article.articleId && (
          <>
            <span className="w-1 h-1 bg-slate-200 dark:bg-slate-700 rounded-full" />
            <span className="font-mono text-[10px] opacity-70">#{article.articleId}</span>
          </>
        )}
      </div>
      
      <div className="flex items-center justify-between pt-3 border-t border-slate-50 dark:border-slate-800/50">
        <div className="flex gap-2">
          {onComments && (
            <button 
              onClick={(e) => { e.stopPropagation(); onComments(); }}
              className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 relative active:scale-90 transition-transform"
            >
              <span className="material-symbols-outlined text-[20px]">forum</span>
              {unreadComments > 0 && (
                <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border border-white" />
              )}
            </button>
          )}
          {article.link && (
            <a 
              href={article.link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-50 dark:bg-slate-800 text-blue-500 active:scale-90 transition-transform"
            >
              <span className="material-symbols-outlined text-[20px]">link</span>
            </a>
          )}
        </div>
        
        <div className="flex gap-2">
          {showContentWorkAction && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (!contentWorkDisabled && onRegisterContentWork && canRegisterContentWork) {
                  onRegisterContentWork();
                }
              }}
              disabled={contentWorkDisabled}
              title={contentWorkCompleted ? "Đã đăng ký Content Work" : article.contentWorkStatusLabel || "Đăng ký Content Work"}
              className="px-3 h-10 flex items-center justify-center rounded-xl text-[11px] font-bold uppercase tracking-wider active:scale-95 transition-transform disabled:opacity-80"
              style={contentWorkTone}
            >
              {contentWorkLabel}
            </button>
          )}
          {canDelete && onDelete && (
            <button 
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              disabled={isDeleting}
              className="px-3 h-10 flex items-center justify-center rounded-xl bg-red-50 dark:bg-red-900/10 text-red-500 text-[11px] font-bold uppercase tracking-wider active:scale-95 transition-transform"
            >
              {isDeleting ? "Đang xóa..." : "Xóa"}
            </button>
          )}
          {canEdit && onEdit && (
            <button 
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              className="px-5 h-10 flex items-center justify-center rounded-xl bg-blue-600 text-white text-[11px] font-bold uppercase tracking-wider shadow-sm shadow-blue-200 active:scale-95 transition-transform"
            >
              Sửa
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
