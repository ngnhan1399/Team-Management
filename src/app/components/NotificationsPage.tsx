"use client";

import React, { useCallback, useEffect, useState } from "react";
import CustomSelect from "./CustomSelect";
import { useAuth } from "./auth-context";
import { useRealtimeRefresh } from "./realtime";
import type { Collaborator, NotifItem } from "./types";
export default function NotificationsPage() {
  const { user } = useAuth();
  const [notifs, setNotifs] = useState<NotifItem[]>([]);
  const [recipients, setRecipients] = useState<Collaborator[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSendModal, setShowSendModal] = useState(false);
  const [sendToUserId, setSendToUserId] = useState("");
  const [sendTitle, setSendTitle] = useState("");
  const [sendMsg, setSendMsg] = useState("");
  const recipientOptions = [
    { value: "", label: "Toàn bộ đội ngũ" },
    ...recipients
      .filter((collaborator) => collaborator.role === "writer" && collaborator.linkedUserId)
      .map((collaborator) => ({
        value: String(collaborator.linkedUserId),
        label: `${collaborator.name} (${collaborator.penName})`,
      })),
  ];

  const refreshNotifications = useCallback(() => {
    fetch("/api/notifications", { cache: "no-store" }).then(r => r.json()).then(d => { setNotifs(d.data || []); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    refreshNotifications();
  }, [refreshNotifications]);

  useRealtimeRefresh(["notifications"], refreshNotifications);

  useEffect(() => {
    if (user?.role !== "admin") return;
    fetch("/api/collaborators", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setRecipients((d.data || []).filter((collaborator: Collaborator) => collaborator.status === "active")))
      .catch(() => setRecipients([]));
  }, [user]);

  const markRead = async (id: number) => {
    await fetch("/api/notifications", { method: "PUT", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
  };

  const markAllRead = async () => {
    await fetch("/api/notifications", { method: "PUT", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ markAllRead: true }) });
    setNotifs(prev => prev.map(n => ({ ...n, isRead: true })));
  };

  const sendNotification = async () => {
    if (!sendTitle || !sendMsg) return;
    const recipient = recipients.find((item) => String(item.linkedUserId || "") === sendToUserId);
    const response = await fetch("/api/notifications", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toUserId: recipient?.linkedUserId || undefined,
        toPenName: recipient?.penName || undefined,
        title: sendTitle,
        message: sendMsg,
        type: "info",
      })
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      alert("❌ " + (result.error || "Không gửi được thông báo"));
      return;
    }
    setShowSendModal(false);
    setSendToUserId(""); setSendTitle(""); setSendMsg("");
    refreshNotifications();
  };

  const typeIcon: Record<string, string> = { review: "rate_review", error_fix: "build", deadline: "schedule", info: "info", system: "settings" };
  const typeColor: Record<string, string> = { review: "var(--accent-blue)", error_fix: "var(--accent-teal)", deadline: "var(--danger)", info: "var(--accent-purple)", system: "var(--text-muted)" };

  return (
    <>
      <header style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h2 style={{ fontSize: 32, fontWeight: 800, color: "var(--text-main)", letterSpacing: "-0.04em" }}>Thông báo</h2>
          <p style={{ color: "var(--text-muted)", marginTop: 4, fontSize: 14 }}>Luôn cập nhật thông tin mới nhất từ đội ngũ.</p>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <button className="btn-ios-pill btn-ios-secondary" onClick={markAllRead}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>done_all</span>
            Đọc tất cả
          </button>
          {user?.role === "admin" && (
            <button className="btn-ios-pill btn-ios-primary" onClick={() => setShowSendModal(true)}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>forward_to_inbox</span>
              Gửi thông báo
            </button>
          )}
        </div>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {loading ? (
          <div style={{ padding: 60, textAlign: "center", color: "var(--accent-blue)", fontWeight: 600 }}>⏳ Đang tải thông báo...</div>
        ) : notifs.length === 0 ? (
          <div className="glass-card" style={{ padding: 80, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ width: 80, height: 80, borderRadius: 24, background: "rgba(255,255,255,0.02)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 24 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 40, color: "var(--text-muted)" }}>notifications_off</span>
            </div>
            <p style={{ fontSize: 16, fontWeight: 600, color: "var(--text-muted)" }}>Chưa có thông báo nào</p>
          </div>
        ) : (
          notifs.map(n => (
            <div
              key={n.id}
              onClick={() => !n.isRead && markRead(n.id)}
              className="glass-card"
              style={{
                padding: "20px 24px",
                cursor: n.isRead ? "default" : "pointer",
                display: "flex",
                gap: 20,
                alignItems: "center",
                opacity: n.isRead ? 0.6 : 1,
                borderLeft: !n.isRead ? `4px solid ${typeColor[n.type] || "var(--accent-blue)"}` : "1px solid var(--glass-border)",
                transition: "transform 0.2s var(--ease-apple), opacity 0.3s"
              }}
            >
              <div style={{ width: 48, height: 48, borderRadius: 12, background: `${typeColor[n.type] || "#3b82f6"}15`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 24, color: typeColor[n.type] || "var(--accent-blue)" }}>{typeIcon[n.type] || "notifications"}</span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
                  <h4 style={{ fontSize: 16, fontWeight: 700, color: "var(--text-main)", margin: 0 }}>{n.title}</h4>
                  {!n.isRead && <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent-blue)", boxShadow: "0 0 10px var(--accent-blue)" }} />}
                </div>
                <p style={{ fontSize: 14, color: "var(--text-main)", lineHeight: 1.5, margin: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{n.message}</p>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 12, display: "flex", alignItems: "center", gap: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>schedule</span>
                  {new Date(n.createdAt).toLocaleString("vi-VN")}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {showSendModal && (
        <div className="modal-overlay" onClick={() => setShowSendModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Gửi thông báo mới</h3>
              <button className="modal-close" onClick={() => setShowSendModal(false)}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Người nhận</label>
                <CustomSelect value={sendToUserId} onChange={setSendToUserId} options={recipientOptions} />
              </div>
              <div className="form-group">
                <label className="form-label">Tiêu đề thông báo</label>
                <input className="form-input" value={sendTitle} onChange={e => setSendTitle(e.target.value)} placeholder="VD: Bảo trì hệ thống định kỳ..." />
              </div>
              <div className="form-group">
                <label className="form-label">Nội dung chi tiết</label>
                <textarea
                  className="form-input"
                  value={sendMsg}
                  onChange={e => setSendMsg(e.target.value)}
                  placeholder="Nhập nội dung thông điệp tại đây..."
                  rows={5}
                  style={{ resize: "none", background: "rgba(255,255,255,0.04)", padding: 16 }}
                />
              </div>
              <div style={{ padding: "12px 16px", background: "rgba(59, 130, 246, 0.05)", borderRadius: 12, border: "1px solid rgba(59, 130, 246, 0.1)", display: "flex", gap: 12, alignItems: "flex-start", marginTop: 8 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18, color: "var(--accent-blue)" }}>info</span>
                <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>Chọn đúng CTV trong danh sách để hệ thống map theo tài khoản thật. Nếu để trống, thông báo sẽ gửi broadcast đến toàn bộ đội ngũ.</p>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-ios-pill btn-ios-secondary" onClick={() => setShowSendModal(false)}>Hủy bỏ</button>
              <button className="btn-ios-pill btn-ios-primary" onClick={sendNotification}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>send</span>
                Gửi thông báo
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ══════════════════════════ DASHBOARD ══════════════════════════ */
