"use client";

import React, { useState } from "react";
import { useAuth } from "./auth-context";

export default function ChangePasswordPage() {
  const { refreshUser } = useAuth();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) { setError("Mật khẩu xác nhận không khớp"); return; }
    if (newPassword.length < 6) { setError("Mật khẩu phải có ít nhất 6 ký tự"); return; }
    setLoading(true);
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword }),
    });
    const data = await res.json();
    if (data.success) {
      await refreshUser();
    } else {
      setError(data.error);
    }
    setLoading(false);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <div style={{ width: 420, padding: 40, background: "var(--glass-bg)", backdropFilter: "blur(var(--glass-blur))", border: "1px solid var(--glass-border)", borderRadius: "var(--radius-ios-lg)", boxShadow: "var(--shadow-premium), var(--specular-top)" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔑</div>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: "var(--text-main)", letterSpacing: "-0.02em" }}>Đổi mật khẩu</h2>
          <p style={{ color: "var(--text-muted)", fontSize: 14 }}>Đây là lần đăng nhập đầu tiên. Vui lòng đổi mật khẩu mới.</p>
        </div>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="form-group">
            <label className="form-label">Mật khẩu mới</label>
            <input className="form-input" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Tối thiểu 6 ký tự" required />
          </div>
          <div className="form-group">
            <label className="form-label">Xác nhận mật khẩu</label>
            <input className="form-input" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Nhập lại mật khẩu" required />
          </div>
          {error && <div style={{ padding: "12px 16px", background: "rgba(239, 68, 68, 0.1)", color: "var(--danger)", borderRadius: 12, fontSize: 13, border: "1px solid rgba(239, 68, 68, 0.2)" }}>❌ {error}</div>}
          <button className="btn-ios-pill btn-ios-primary" type="submit" style={{ width: "100%", justifyContent: "center", height: 50 }} disabled={loading}>
            {loading ? "⏳..." : "✅ Đổi mật khẩu"}
          </button>
        </form>
      </div>
    </div>
  );
}
