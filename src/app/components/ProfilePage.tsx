"use client";

import React, { useEffect, useState } from "react";
import { useAuth } from "./auth-context";

export default function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const [form, setForm] = useState({ name: "", penName: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setForm({
      name: user?.collaborator?.name || user?.email.split("@")[0] || "",
      penName: user?.collaborator?.penName || user?.email.split("@")[0] || "",
    });
  }, [user?.collaborator?.name, user?.collaborator?.penName, user?.email]);

  const handleSave = async () => {
    const name = form.name.trim();
    const penName = form.penName.trim();

    if (!name || !penName) {
      setError("Vui lòng nhập đầy đủ họ tên và bút danh.");
      return;
    }

    try {
      setSaving(true);
      setError("");
      setMessage("");

      const res = await fetch("/api/profile", {
        method: "PUT",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, penName }),
      });

      const data = await res.json().catch(() => ({ success: false, error: "Không thể đọc phản hồi từ máy chủ." }));
      if (!res.ok || !data.success) {
        setError(data.error || "Không thể lưu hồ sơ lúc này.");
        return;
      }

      await refreshUser();
      setMessage(data.message || "Hồ sơ của bạn đã được cập nhật.");
    } catch {
      setError("Không thể kết nối tới máy chủ. Vui lòng thử lại.");
    } finally {
      setSaving(false);
    }
  };

  const displayInitial = (user?.collaborator?.penName || user?.email || "U").trim().charAt(0).toUpperCase();

  return (
    <>
      <header style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 32, fontWeight: 800, color: "var(--text-main)", letterSpacing: "-0.04em" }}>
          Hồ sơ cá nhân
        </h2>
      </header>

      <div className="glass-card" style={{ padding: 40, maxWidth: 720 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24, marginBottom: 32, flexWrap: "wrap" }}>
          <div
            style={{
              width: 80,
              height: 80,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid var(--glass-border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span style={{ fontSize: 32, fontWeight: 700 }}>{displayInitial}</span>
          </div>
          <div>
            <h3 style={{ fontSize: 24, fontWeight: 700, color: "var(--text-main)" }}>
              {user?.collaborator?.penName || user?.email.split("@")[0] || "Tài khoản của bạn"}
            </h3>
            <p style={{ color: "var(--text-muted)" }}>{user?.email}</p>
          </div>
        </div>

        {error ? (
          <div
            role="alert"
            style={{
              marginBottom: 20,
              padding: "12px 16px",
              borderRadius: 12,
              border: "1px solid rgba(239, 68, 68, 0.18)",
              background: "rgba(239, 68, 68, 0.08)",
              color: "var(--danger)",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {error}
          </div>
        ) : null}

        {message ? (
          <div
            style={{
              marginBottom: 20,
              padding: "12px 16px",
              borderRadius: 12,
              border: "1px solid rgba(16, 185, 129, 0.18)",
              background: "rgba(16, 185, 129, 0.08)",
              color: "#047857",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {message}
          </div>
        ) : null}

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="form-group">
            <label className="form-label">Email đăng nhập</label>
            <input
              className="form-input"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)" }}
              value={user?.email || ""}
              readOnly
            />
          </div>

          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Họ và tên</label>
              <input
                className="form-input"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Nhập họ và tên hiển thị"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Bút danh</label>
              <input
                className="form-input"
                value={form.penName}
                onChange={(event) => setForm((current) => ({ ...current, penName: event.target.value }))}
                placeholder="Nhập bút danh"
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Vai trò hệ thống</label>
            <input
              className="form-input"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)" }}
              value={user?.isLeader ? "Leader hệ thống" : user?.role === "admin" ? "Admin team" : "CTV"}
              readOnly
            />
          </div>

          <div
            style={{
              padding: 16,
              borderRadius: 16,
              border: "1px solid var(--glass-border)",
              background: "rgba(255,255,255,0.03)",
              color: "var(--text-muted)",
              fontSize: 13,
              lineHeight: 1.7,
            }}
          >
            Nếu tài khoản của bạn chưa có hồ sơ cộng tác viên nội bộ, hệ thống sẽ tự tạo hồ sơ cơ bản ngay khi bạn lưu lần đầu.
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="btn-ios-pill btn-ios-primary" onClick={handleSave} disabled={saving}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>save</span>
              {saving ? "Đang lưu..." : "Lưu hồ sơ"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
