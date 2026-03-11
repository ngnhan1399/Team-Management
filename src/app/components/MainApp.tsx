"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import ArticlesPage from "./ArticlesPage";
import AuditLogsPage from "./AuditLogsPage";
import DashboardPage from "./DashboardPage";
import EditorialTasksPage from "./EditorialTasksPage";
import FeedbackPage from "./FeedbackPage";
import NotificationsPage from "./NotificationsPage";
import ProfilePage from "./ProfilePage";
import RealtimeToastLayer from "./RealtimeToastLayer";
import RoyaltyPage from "./RoyaltyPage";
import TeamPage from "./TeamPage";
import BrandLogo from "./BrandLogo";
import { useAuth } from "./auth-context";
import { emitRealtimePayload } from "./realtime";
import type { Page } from "./types";

export default function MainApp() {
  const { user, logout, refreshUser } = useAuth();
  const [page, setPage] = useState<Page>("dashboard");
  const [unreadCount, setUnreadCount] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const seenRealtimeIdsRef = useRef<number[]>([]);
  const seenNotificationToastIdsRef = useRef<number[]>([]);
  const lastUnreadCountRef = useRef(0);
  const unreadBaselineReadyRef = useRef(false);
  const displayName = (typeof user?.collaborator?.name === "string" && user.collaborator.name.trim())
    || user?.collaborator?.penName
    || user?.email.split("@")[0]
    || "Người dùng";
  const collaboratorRole = typeof user?.collaborator?.role === "string" ? user.collaborator.role : "";
  const roleSubtitle = user?.role === "admin"
    ? "BIÊN TẬP VIÊN CHÍNH"
    : collaboratorRole === "reviewer"
      ? "CTV DUYỆT BÀI"
      : "CỘNG TÁC VIÊN";
  const mobileRoleLabel = user?.role === "admin"
    ? "Biên tập viên chính"
    : collaboratorRole === "reviewer"
      ? "CTV duyệt bài"
      : "Cộng tác viên";

  const refreshUnreadCount = useCallback((announceNew = false) => {
    fetch("/api/notifications?unread=true", { cache: "no-store" })
      .then(r => r.json())
      .then((d) => {
        const nextUnreadCount = Number(d.unreadCount || 0);
        const latestUnread = Array.isArray(d.data) ? d.data[0] : null;
        const previousUnreadCount = lastUnreadCountRef.current;

        setUnreadCount(nextUnreadCount);
        lastUnreadCountRef.current = nextUnreadCount;

        if (!unreadBaselineReadyRef.current) {
          unreadBaselineReadyRef.current = true;
          return;
        }

        if (!announceNew || nextUnreadCount <= previousUnreadCount || !latestUnread?.id) {
          return;
        }

        if (seenNotificationToastIdsRef.current.includes(latestUnread.id)) {
          return;
        }

        seenNotificationToastIdsRef.current = [...seenNotificationToastIdsRef.current.slice(-49), latestUnread.id];
        emitRealtimePayload({
          id: latestUnread.id,
          channels: ["notifications"],
          at: latestUnread.createdAt || new Date().toISOString(),
          toastTitle: latestUnread.title,
          toastMessage: latestUnread.message,
          toastVariant: latestUnread.type === "review" || latestUnread.type === "error_fix" || latestUnread.type === "comment" ? "warning" : "info",
        });
      })
      .catch(() => { });
  }, []);

  useEffect(() => {
    refreshUnreadCount(false);

    if (!user?.id) return;

    const eventSource = new EventSource("/api/realtime");
    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        const payloadId = Number(payload?.id || 0);
        if (payloadId > 0) {
          if (seenRealtimeIdsRef.current.includes(payloadId)) {
            return;
          }
          seenRealtimeIdsRef.current = [...seenRealtimeIdsRef.current.slice(-99), payloadId];
        }
        emitRealtimePayload(payload);
        if (Array.isArray(payload.channels) && payload.channels.includes("notifications")) {
          if (payloadId > 0 && payload.toastTitle) {
            seenNotificationToastIdsRef.current = [...seenNotificationToastIdsRef.current.slice(-49), payloadId];
          }
          refreshUnreadCount(false);
        }
        if (Array.isArray(payload.channels) && payload.channels.includes("team")) {
          refreshUser().catch(() => { });
        }
      } catch {
        // Ignore malformed realtime packets.
      }
    };

    return () => {
      eventSource.close();
    };
  }, [refreshUnreadCount, refreshUser, user?.id]);

  useEffect(() => {
    const interval = setInterval(() => {
      refreshUnreadCount(true);
    }, 30000);
    return () => clearInterval(interval);
  }, [refreshUnreadCount]);

  useEffect(() => {
    if (!user?.id) {
      seenRealtimeIdsRef.current = [];
      seenNotificationToastIdsRef.current = [];
      lastUnreadCountRef.current = 0;
      unreadBaselineReadyRef.current = false;
    }
  }, [user?.id]);

  const navigateToPage = useCallback((nextPage: Page) => {
    setPage(nextPage);
    setSidebarOpen(false);
  }, []);

  const isAdmin = user?.role === "admin";

  const navItems = [
    { id: "dashboard", label: "Tổng quan", icon: "dashboard", section: "Tổng quan" },
    { id: "notifications", label: "Thông báo", icon: "notifications", section: "Tổng quan", count: unreadCount },
    { id: "feedback", label: "Feedback", icon: "feedback", section: "Tổng quan" },
    { id: "articles", label: "Bài viết", icon: "description", section: "Quản lý" },
    { id: "tasks", label: "Lịch biên tập", icon: "task_alt", section: "Quản lý" },
    { id: "team", label: "Đội ngũ", icon: "group", section: "Quản lý", adminOnly: true },
    { id: "royalty", label: "Nhuận bút", icon: "payments", section: "Quản lý" },
    { id: "audit", label: "Audit Logs", icon: "history", section: "Quản lý", adminOnly: true },
  ];

  return (
    <div className="app-shell">
      <RealtimeToastLayer />
      {sidebarOpen && <button className="sidebar-backdrop lg:hidden" aria-label="Đóng menu điều hướng" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div style={{ padding: 24, display: "flex", alignItems: "flex-start", width: "100%" }}>
          <BrandLogo 
            markSize={42} 
            titleSize={18} 
            subtitle={roleSubtitle} 
          />
        </div>

        <nav className="flex-1 px-4 mt-4 space-y-1 overflow-y-auto custom-scrollbar">
          {["Tổng quan", "Quản lý"].map(section => {
            const items = navItems.filter(item => item.section === section && (!item.adminOnly || isAdmin));
            if (items.length === 0) return null;
            return (
              <React.Fragment key={section}>
                <div className="text-[11px] text-[var(--text-muted)] font-bold uppercase tracking-wider mb-2 mt-6 px-2">{section}</div>
                {items.map(item => (
                  <button key={item.id} data-testid={`nav-${item.id}`} onClick={() => navigateToPage(item.id as Page)} className={`sidebar-nav-item ${page === item.id ? "active" : ""}`}>
                    <span className="material-symbols-outlined">{item.icon}</span>
                    <span style={{ flex: 1 }}>{item.label}</span>
                    {item.count !== undefined && item.count > 0 && (
                      <span style={{ background: "var(--danger)", color: "white", fontSize: 10, padding: "2px 6px", borderRadius: 10, minWidth: 20 }}>{item.count}</span>
                    )}
                  </button>
                ))}
              </React.Fragment>
            );
          })}
        </nav>

        <div className="p-4 border-t border-white/5">
          <div className="sidebar-nav-item" style={{ marginTop: 8, padding: "8px 12px" }}>
            <div style={{ width: 34, height: 34, borderRadius: "50%", background: "rgba(255,255,255,0.05)", border: "1px solid var(--glass-border)", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {user?.collaborator?.avatar ? (
                <Image src={user.collaborator.avatar} alt="Avatar" width={34} height={34} unoptimized className="w-full h-full object-cover" />
              ) : (
                <span style={{ fontSize: 13, fontWeight: 700 }}>{user?.email[0].toUpperCase()}</span>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text-main)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayName}</p>
              <p style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.email}</p>
            </div>
            <button onClick={logout} className="material-symbols-outlined" style={{ fontSize: 20, color: "var(--text-muted)", cursor: "pointer" }}>logout</button>
          </div>
        </div>
      </aside>

      <main className="app-shell-main custom-scrollbar">
        <div className="app-shell-inner">
          <div className="mobile-topbar">
            <button className="mobile-nav-trigger" type="button" onClick={() => setSidebarOpen(true)} aria-label="Mở menu điều hướng">
              <span className="material-symbols-outlined" style={{ fontSize: 22 }}>menu</span>
            </button>
            <div style={{ minWidth: 0, flex: 1 }}>
              <p style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>
                {mobileRoleLabel}
              </p>
              <p style={{ fontSize: 15, fontWeight: 700, color: "var(--text-main)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {displayName}
              </p>
            </div>
            <button
              type="button"
              className="mobile-nav-trigger"
              onClick={() => navigateToPage("notifications")}
              aria-label="Mở thông báo"
              style={{ position: "relative" }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 22 }}>notifications</span>
              {unreadCount > 0 && (
                <span style={{ position: "absolute", top: 4, right: 4, minWidth: 16, height: 16, borderRadius: 999, background: "var(--danger)", color: "#fff", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px" }}>
                  {unreadCount}
                </span>
              )}
            </button>
          </div>
          {page === "dashboard" && <DashboardPage onNavigate={navigateToPage} />}
          {page === "feedback" && <FeedbackPage />}
          {page === "articles" && <ArticlesPage />}
          {page === "tasks" && <EditorialTasksPage />}
          {page === "team" && isAdmin && <TeamPage />}
          {page === "royalty" && <RoyaltyPage />}
          {page === "audit" && isAdmin && <AuditLogsPage />}
          {page === "notifications" && <NotificationsPage />}
          {page === "profile" && <ProfilePage />}
        </div>
      </main>
    </div>
  );
}
