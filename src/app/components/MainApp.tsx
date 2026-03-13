"use client";

import React, { useCallback, useEffect, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import DashboardPage from "./DashboardPage";
import RealtimeToastLayer from "./RealtimeToastLayer";
import BrandLogo from "./BrandLogo";
import { APP_NAVIGATION_START_EVENT } from "./navigation-events";
import { useAuth } from "./auth-context";
import { emitRealtimePayload } from "./realtime";
import type { NotifItem, Page } from "./types";
import { useIsMobile } from "./useMediaQuery";
import BottomTabBar from "./BottomTabBar";
import { CONTENT_WORK_REGISTRATION_TITLE, CONTENT_WORK_REGISTRATION_URL, isContentWorkRegistrationReminderTitle } from "@/lib/content-work-registration";

const loadArticlesPage = () => import("./ArticlesPage");
const loadAuditLogsPage = () => import("./AuditLogsPage");
const loadEditorialTasksPage = () => import("./EditorialTasksPage");
const loadFeedbackPage = () => import("./FeedbackPage");
const loadNotificationsPage = () => import("./NotificationsPage");
const loadProfilePage = () => import("./ProfilePage");
const loadRoyaltyPage = () => import("./RoyaltyPage");
const loadTeamPage = () => import("./TeamPage");

function PageLoadingState({ label }: { label: string }) {
  return (
    <div
      className="card"
      style={{
        minHeight: 240,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        textAlign: "center",
      }}
    >
      <p style={{ color: "var(--text-muted)", fontSize: 14, fontWeight: 600 }}>{label}</p>
    </div>
  );
}

const ArticlesPage = dynamic(loadArticlesPage, { loading: () => <PageLoadingState label="Đang tải nội dung..." /> });
const AuditLogsPage = dynamic(loadAuditLogsPage, { loading: () => <PageLoadingState label="Đang tải nội dung..." /> });
const EditorialTasksPage = dynamic(loadEditorialTasksPage, { loading: () => <PageLoadingState label="Đang tải nội dung..." /> });
const FeedbackPage = dynamic(loadFeedbackPage, { loading: () => <PageLoadingState label="Đang tải nội dung..." /> });
const NotificationsPage = dynamic(loadNotificationsPage, { loading: () => <PageLoadingState label="Đang tải nội dung..." /> });
const ProfilePage = dynamic(loadProfilePage, { loading: () => <PageLoadingState label="Đang tải nội dung..." /> });
const RoyaltyPage = dynamic(loadRoyaltyPage, { loading: () => <PageLoadingState label="Đang tải nội dung..." /> });
const TeamPage = dynamic(loadTeamPage, { loading: () => <PageLoadingState label="Đang tải nội dung..." /> });

const pageLoaders: Partial<Record<Page, () => Promise<unknown>>> = {
  articles: loadArticlesPage,
  audit: loadAuditLogsPage,
  feedback: loadFeedbackPage,
  notifications: loadNotificationsPage,
  profile: loadProfilePage,
  royalty: loadRoyaltyPage,
  tasks: loadEditorialTasksPage,
  team: loadTeamPage,
};

const pageLabels: Record<Page, string> = {
  dashboard: "Tổng quan",
  articles: "Bài viết",
  tasks: "Lịch biên tập",
  team: "Đội ngũ",
  royalty: "Nhuận bút",
  notifications: "Thông báo",
  feedback: "Feedback",
  audit: "Audit Logs",
  profile: "Hồ sơ",
};

export default function MainApp() {
  const { user, logout, refreshUser } = useAuth();
  const [page, setPage] = useState<Page>("dashboard");
  const [pendingPage, setPendingPage] = useState<Page | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingRegistrationReminder, setPendingRegistrationReminder] = useState<NotifItem | null>(null);
  const [markingRegistrationReminderRead, setMarkingRegistrationReminderRead] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isPageTransitionPending, startPageTransition] = useTransition();
  const seenRealtimeIdsRef = useRef<number[]>([]);
  const seenNotificationToastIdsRef = useRef<number[]>([]);
  const pointerDrivenNavRef = useRef<Page | null>(null);
  const lastUnreadCountRef = useRef(0);
  const unreadBaselineReadyRef = useRef(false);
  const navigationRequestIdRef = useRef(0);
  const realtimeSourceRef = useRef<EventSource | null>(null);
  const displayName = (typeof user?.collaborator?.name === "string" && user.collaborator.name.trim())
    || user?.collaborator?.penName
    || user?.email.split("@")[0]
    || "Người dùng";
  const isAdmin = user?.role === "admin";
  const isLeader = Boolean(isAdmin && user?.isLeader);
  const collaboratorRole = typeof user?.collaborator?.role === "string" ? user.collaborator.role : "";
  const roleSubtitle = isLeader
    ? "LEADER HỆ THỐNG"
    : isAdmin
      ? "ADMIN TEAM"
      : collaboratorRole === "reviewer"
        ? "CTV DUYỆT BÀI"
        : "CỘNG TÁC VIÊN";
  const teamName = user?.team?.name?.trim() || "";
  const roleSubtitleWithTeam = teamName && isAdmin ? `${roleSubtitle} • ${teamName}` : roleSubtitle;

  const refreshUnreadCount = useCallback((announceNew = false) => {
    fetch("/api/notifications?unread=true", { cache: "no-store" })
      .then(r => r.json())
      .then((d) => {
        const nextUnreadCount = Number(d.unreadCount || 0);
        const unreadItems = Array.isArray(d.data) ? d.data as NotifItem[] : [];
        const latestUnread = unreadItems[0] ?? null;
        const previousUnreadCount = lastUnreadCountRef.current;
        const nextPendingRegistrationReminder = user?.role === "ctv"
          ? unreadItems.find((item) =>
              Number(item.id) > 0
              && !item.isRead
              && isContentWorkRegistrationReminderTitle(item.title)
            ) || null
          : null;

        setUnreadCount(nextUnreadCount);
        setPendingRegistrationReminder(nextPendingRegistrationReminder);
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
  }, [user?.role]);

  useEffect(() => {
    refreshUnreadCount(false);

    if (!user?.id) return;

    if (typeof window === "undefined") return;

    const closeRealtimeSource = () => {
      realtimeSourceRef.current?.close();
      realtimeSourceRef.current = null;
    };

    const openRealtimeSource = () => {
      if (document.visibilityState !== "visible" || realtimeSourceRef.current) {
        return;
      }

      const eventSource = new EventSource("/api/realtime");
      realtimeSourceRef.current = eventSource;

      eventSource.onopen = () => {
        refreshUnreadCount(false);
      };

      eventSource.onerror = () => {
        if (realtimeSourceRef.current === eventSource && eventSource.readyState === EventSource.CLOSED) {
          realtimeSourceRef.current = null;
        }
      };

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
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshUnreadCount(false);
        openRealtimeSource();
        return;
      }

      closeRealtimeSource();
    };

    handleVisibilityChange();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleVisibilityChange);
      closeRealtimeSource();
    };
  }, [refreshUnreadCount, refreshUser, user?.id]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!user?.id || typeof document === "undefined" || document.visibilityState !== "visible") {
        return;
      }

      const realtimeReadyState = realtimeSourceRef.current?.readyState;
      if (realtimeReadyState === EventSource.OPEN || realtimeReadyState === EventSource.CONNECTING) {
        return;
      }

      refreshUnreadCount(true);
    }, 180000);
    return () => clearInterval(interval);
  }, [refreshUnreadCount, user?.id]);

  useEffect(() => {
    if (!user?.id) {
      seenRealtimeIdsRef.current = [];
      seenNotificationToastIdsRef.current = [];
      lastUnreadCountRef.current = 0;
      unreadBaselineReadyRef.current = false;
      setPendingRegistrationReminder(null);
      setMarkingRegistrationReminderRead(false);
    }
  }, [user?.id]);

  const handleOpenContentWorkRegistration = useCallback(() => {
    if (typeof window !== "undefined") {
      window.open(CONTENT_WORK_REGISTRATION_URL, "_blank", "noopener,noreferrer");
    }
  }, []);

  const handleConfirmContentWorkRegistration = useCallback(async () => {
    if (!pendingRegistrationReminder?.id || markingRegistrationReminderRead) {
      return;
    }

    try {
      setMarkingRegistrationReminderRead(true);
      const res = await fetch("/api/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: pendingRegistrationReminder.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(data.error || "Không thể cập nhật trạng thái thông báo");
      }

      setPendingRegistrationReminder(null);
      refreshUnreadCount(false);
    } catch (error) {
      window.alert(`❌ ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setMarkingRegistrationReminderRead(false);
    }
  }, [markingRegistrationReminderRead, pendingRegistrationReminder, refreshUnreadCount]);

  const preloadPage = useCallback((nextPage: Page) => {
    const loader = pageLoaders[nextPage];
    if (!loader || typeof window === "undefined") {
      return;
    }
    void loader().catch(() => { });
  }, []);

  const navigateToPage = useCallback((nextPage: Page) => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(APP_NAVIGATION_START_EVENT));
    }

    setSidebarOpen(false);
    if (nextPage === page) {
      setPendingPage(null);
      return;
    }

    setPendingPage(nextPage);
    const requestId = navigationRequestIdRef.current + 1;
    navigationRequestIdRef.current = requestId;
    const loader = pageLoaders[nextPage];
    const commitNavigation = () => {
      if (navigationRequestIdRef.current !== requestId) {
        return;
      }
      startPageTransition(() => {
        setPage(nextPage);
        setPendingPage(null);
      });
    };

    if (!loader || typeof window === "undefined") {
      commitNavigation();
      return;
    }

    void loader().catch(() => { }).finally(commitNavigation);
  }, [page]);

  const handleSidebarPointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>, nextPage: Page) => {
    pointerDrivenNavRef.current = nextPage;
    event.preventDefault();
    event.stopPropagation();
    navigateToPage(nextPage);
  }, [navigateToPage]);

  const handleSidebarClick = useCallback((nextPage: Page) => {
    if (pointerDrivenNavRef.current === nextPage) {
      pointerDrivenNavRef.current = null;
      return;
    }

    navigateToPage(nextPage);
  }, [navigateToPage]);

  const navItems = [
    { id: "dashboard", label: "Tổng quan", icon: "dashboard", section: "Tổng quan" },
    { id: "notifications", label: "Thông báo", icon: "notifications", section: "Tổng quan", count: unreadCount },
    { id: "feedback", label: "Feedback", icon: "feedback", section: "Tổng quan" },
    { id: "articles", label: "Bài viết", icon: "description", section: "Quản lý" },
    { id: "tasks", label: "Lịch biên tập", icon: "calendar_month", section: "Quản lý" },
    { id: "team", label: "Đội ngũ", icon: "group", section: "Quản lý", adminOnly: true },
    { id: "royalty", label: "Nhuận bút", icon: "payments", section: "Quản lý" },
    { id: "audit", label: "Audit Logs", icon: "history", section: "Quản lý", adminOnly: true, leaderOnly: true },
  ];

  const isMobile = useIsMobile();

  return (
    <div className="app-shell">
      <RealtimeToastLayer />
      {sidebarOpen && <button className="sidebar-backdrop lg:hidden" aria-label="Đóng menu điều hướng" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div style={{ padding: "20px 24px", display: "flex", alignItems: "flex-start", width: "100%", minWidth: 0, overflow: "hidden" }}>
          <BrandLogo
            markSize={38}
            titleSize={18}
            subtitle={roleSubtitleWithTeam}
          />
        </div>

        <nav className="flex-1 px-4 mt-4 space-y-1 overflow-y-auto custom-scrollbar">
          {["Tổng quan", "Quản lý"].map(section => {
            const items = navItems.filter((item) =>
              item.section === section
              && (!item.adminOnly || isAdmin)
              && (!item.leaderOnly || isLeader)
            );
            if (items.length === 0) return null;
            return (
              <React.Fragment key={section}>
                <div className="text-[11px] text-[var(--text-muted)] font-bold uppercase tracking-wider mb-2 mt-6 px-2">{section}</div>
                {items.map(item => (
                  <button
                    type="button"
                    key={item.id}
                    data-testid={`nav-${item.id}`}
                    onMouseEnter={() => preloadPage(item.id as Page)}
                    onFocus={() => preloadPage(item.id as Page)}
                    onTouchStart={() => preloadPage(item.id as Page)}
                    onPointerDown={(event) => handleSidebarPointerDown(event, item.id as Page)}
                    onClick={() => handleSidebarClick(item.id as Page)}
                    className={`sidebar-nav-item ${page === item.id ? "active" : ""}`}
                  >
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
          <div className="sidebar-user-card" style={{ marginTop: 8, padding: "8px 12px" }}>
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
            <button type="button" onClick={logout} className="material-symbols-outlined" style={{ fontSize: 20, color: "var(--text-muted)", cursor: "pointer", border: "none", background: "transparent", padding: 0 }}>logout</button>
          </div>
        </div>
      </aside>

      <main className="app-shell-main custom-scrollbar">
        <div className="app-shell-inner">
          <div className="mobile-topbar">
            <button className="mobile-nav-trigger" type="button" onClick={() => setSidebarOpen(true)} aria-label="Mở menu điều hướng">
              <span className="material-symbols-outlined" style={{ fontSize: 22 }}>menu</span>
            </button>
            <div style={{ minWidth: 0, flex: 1, paddingLeft: 8 }}>
              <p style={{ fontSize: 15, fontWeight: 800, color: "var(--text-main)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", letterSpacing: "-0.01em" }}>
                {pageLabels[page]}
              </p>
            </div>
            {(pendingPage || isPageTransitionPending) && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 32,
                  height: 32,
                  color: "var(--accent-blue)",
                  animation: "spin 2s linear infinite"
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>progress_activity</span>
              </div>
            )}
            <button
              type="button"
              className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-100/50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400 relative active:scale-90 transition-transform"
              onMouseEnter={() => preloadPage("notifications")}
              onFocus={() => preloadPage("notifications")}
              onTouchStart={() => preloadPage("notifications")}
              onClick={() => navigateToPage("notifications")}
              aria-label="Mở thông báo"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>notifications</span>
              {unreadCount > 0 && (
                <span style={{ position: "absolute", top: 8, right: 8, width: 8, height: 8, borderRadius: 999, background: "var(--danger)", border: "2px solid #fff" }} />
              )}
            </button>
          </div>
          {page === "dashboard" && <DashboardPage onNavigate={navigateToPage} />}
          {page === "feedback" && <FeedbackPage />}
          {page === "articles" && <ArticlesPage />}
          {page === "tasks" && <EditorialTasksPage />}
          {page === "team" && isAdmin && <TeamPage />}
          {page === "royalty" && <RoyaltyPage />}
          {page === "audit" && isLeader && <AuditLogsPage />}
          {page === "notifications" && <NotificationsPage />}
          {page === "profile" && <ProfilePage />}
        </div>
      </main>

      {isMobile && (
        <BottomTabBar 
          currentPage={page} 
          onNavigate={(p) => {
            navigateToPage(p);
            setSidebarOpen(false);
          }} 
          unreadCount={unreadCount}
        />
      )}
      {user?.role === "ctv" && pendingRegistrationReminder && (
        <div className="modal-overlay" style={{ zIndex: 1200 }}>
          <div className="modal" style={{ width: "min(92vw, 520px)", maxWidth: 520 }}>
            <div className="modal-header">
              <h3 className="modal-title">{CONTENT_WORK_REGISTRATION_TITLE}</h3>
            </div>
            <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ padding: 16, borderRadius: 18, background: "rgba(37, 99, 235, 0.08)", border: "1px solid rgba(37, 99, 235, 0.16)" }}>
                <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, color: "var(--text-main)" }}>
                  {pendingRegistrationReminder.message || "Bài viết của bạn đã được chuyển sang tháng sau. Vui lòng đăng ký lại bài trong Content Work."}
                </p>
              </div>
              <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: "var(--text-muted)" }}>
                Mở form đăng ký trước, sau đó quay lại bấm <strong>Đã đăng ký</strong> để hoàn tất nhắc việc này.
              </p>
            </div>
            <div className="modal-footer" style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "flex-end" }}>
              <button className="btn-ios-pill btn-ios-secondary" onClick={handleOpenContentWorkRegistration} disabled={markingRegistrationReminderRead}>
                Đến trang đăng ký
              </button>
              <button className="btn-ios-pill btn-ios-primary" onClick={handleConfirmContentWorkRegistration} disabled={markingRegistrationReminderRead}>
                {markingRegistrationReminderRead ? "Đang cập nhật..." : "Đã đăng ký"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
