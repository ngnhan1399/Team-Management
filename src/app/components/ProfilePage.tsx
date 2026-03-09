"use client";

import React from "react";
import { useAuth } from "./auth-context";
export default function ProfilePage() {
  const { user } = useAuth();
  return (
    <>
      <header style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 32, fontWeight: 800, color: "var(--text-main)", letterSpacing: "-0.04em" }}>Hồ sơ cá nhân</h2>
      </header>
      <div className="glass-card" style={{ padding: 40, maxWidth: 600 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24, marginBottom: 32 }}>
          <div style={{ width: 80, height: 80, borderRadius: "50%", background: "rgba(255,255,255,0.05)", border: "1px solid var(--glass-border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 32, fontWeight: 700 }}>{user?.email[0].toUpperCase()}</span>
          </div>
          <div>
            <h3 style={{ fontSize: 24, fontWeight: 700, color: "var(--text-main)" }}>{user?.collaborator?.penName || "Cộng tác viên"}</h3>
            <p style={{ color: "var(--text-muted)" }}>{user?.email}</p>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="form-group">
            <label className="form-label">Vai trò</label>
            <input className="form-input" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)" }} value={user?.role || ""} readOnly />
          </div>
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Hệ thống sẽ cập nhật thêm các tính năng chỉnh sửa hồ sơ trong phiên bản tiếp theo.</p>
        </div>
      </div>
    </>
  );
}
