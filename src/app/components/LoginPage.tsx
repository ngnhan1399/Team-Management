"use client";

import React, { useState } from "react";
import { useAuth } from "./auth-context";

export default function LoginPage({ onLogin }: { onLogin: () => void }) {
  const { login } = useAuth();
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const result = await login(loginEmail, loginPassword);
    setLoading(false);

    if (result.success) {
      onLogin();
      return;
    }

    setError(result.error);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, rgba(59,130,246,0.08) 0%, rgba(15,23,42,0) 32%, rgba(16,185,129,0.08) 100%)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", top: "-12%", left: "-8%", width: "34%", height: "34%", background: "radial-gradient(circle, rgba(37,99,235,0.16) 0%, transparent 72%)", filter: "blur(70px)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: "-10%", right: "-8%", width: "34%", height: "34%", background: "radial-gradient(circle, rgba(20,184,166,0.14) 0%, transparent 72%)", filter: "blur(70px)", pointerEvents: "none" }} />

      <div className="glass-card" style={{ width: 480, padding: 40, borderRadius: "var(--radius-ios-lg)", position: "relative", zIndex: 1 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div className="sidebar-logo-icon" style={{ width: 64, height: 64, margin: "0 auto 18px", borderRadius: 18, boxShadow: "0 10px 30px rgba(37,99,235,0.28)", background: "var(--accent-blue)" }}>
            <span className="material-symbols-outlined" style={{ fontSize: 32, color: "white" }}>article</span>
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: "var(--text-main)", letterSpacing: "-0.02em", marginBottom: 8 }}>CTV Manager</h1>
          <p style={{ color: "var(--text-muted)", fontSize: 15, fontWeight: 500 }}>Quản lý đội ngũ cộng tác viên chuyên nghiệp</p>
        </div>

        <div style={{ padding: "14px 16px", borderRadius: 14, background: "rgba(15,23,42,0.04)", border: "1px solid var(--glass-border)", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 24 }}>
          Tài khoản mới sẽ do quản trị viên tạo và cấp quyền. Luồng tự đăng ký đã được tắt để tránh lộ dữ liệu và tạo tài khoản trái phép.
        </div>

        <form onSubmit={handleLoginSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="form-group">
            <label className="form-label" style={{ fontSize: 13, marginBottom: 8 }}>Địa chỉ Email</label>
            <input className="form-input" type="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} placeholder="admin@demo.local" required style={{ height: 48, borderRadius: 12 }} />
          </div>
          <div className="form-group">
            <label className="form-label" style={{ fontSize: 13, marginBottom: 8 }}>Mật khẩu</label>
            <input className="form-input" type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} placeholder="••••••••" required style={{ height: 48, borderRadius: 12 }} />
          </div>

          <div style={{ padding: "14px 16px", borderRadius: 14, background: "rgba(15,23,42,0.04)", border: "1px solid var(--glass-border)", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
            Dùng tài khoản đã được cấp và đổi mật khẩu ngay khi hệ thống yêu cầu.
          </div>

          {error && (
            <div style={{ padding: "12px 16px", background: "rgba(239, 68, 68, 0.08)", color: "#f87171", borderRadius: 12, fontSize: 13, border: "1px solid rgba(239, 68, 68, 0.2)", display: "flex", alignItems: "center", gap: 8 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>error</span>
              {error}
            </div>
          )}

          <button className="btn-ios-pill btn-ios-primary" type="submit" style={{ width: "100%", justifyContent: "center", height: 52, fontSize: 16 }} disabled={loading}>
            {loading ? "Đang xác thực..." : "Đăng nhập hệ thống"}
          </button>
        </form>

        <div style={{ textAlign: "center", marginTop: 28, borderTop: "1px solid var(--glass-border)", paddingTop: 20 }}>
          <p style={{ fontSize: 12, color: "var(--text-muted)", letterSpacing: "0.05em", fontWeight: 600, textTransform: "uppercase" }}>
            Apple-inspired workspace for editors and contributors
          </p>
        </div>
      </div>
    </div>
  );
}
