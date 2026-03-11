"use client";

import React, { useState } from "react";
import { useAuth } from "./auth-context";

export default function LoginPage({ onLogin }: { onLogin: () => void }) {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerPasswordConfirm, setRegisterPasswordConfirm] = useState("");
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

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (registerPassword !== registerPasswordConfirm) {
      setError("Mật khẩu xác nhận không khớp.");
      return;
    }
    if (registerPassword.length < 6) {
      setError("Mật khẩu phải có ít nhất 6 ký tự.");
      return;
    }

    setLoading(true);
    setError("");
    const result = await register(registerEmail, registerPassword);
    setLoading(false);

    if (result.success) {
      onLogin();
      return;
    }

    setError(result.error);
  };

  return (
    <div className="auth-shell">
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, rgba(59,130,246,0.08) 0%, rgba(15,23,42,0) 32%, rgba(16,185,129,0.08) 100%)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", top: "-12%", left: "-8%", width: "34%", height: "34%", background: "radial-gradient(circle, rgba(37,99,235,0.16) 0%, transparent 72%)", filter: "blur(70px)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: "-10%", right: "-8%", width: "34%", height: "34%", background: "radial-gradient(circle, rgba(20,184,166,0.14) 0%, transparent 72%)", filter: "blur(70px)", pointerEvents: "none" }} />

      <div className="glass-card auth-card">
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div className="sidebar-logo-icon" style={{ width: 64, height: 64, margin: "0 auto 18px", borderRadius: 18, boxShadow: "0 10px 30px rgba(37,99,235,0.28)", background: "var(--accent-blue)" }}>
            <span className="material-symbols-outlined" style={{ fontSize: 32, color: "white" }}>article</span>
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: "var(--text-main)", letterSpacing: "-0.02em", marginBottom: 8 }}>CTV Manager</h1>
          <p style={{ color: "var(--text-muted)", fontSize: 15, fontWeight: 500 }}>Đăng nhập hoặc kích hoạt tài khoản cộng tác viên</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20, padding: 6, borderRadius: 16, background: "rgba(15,23,42,0.04)", border: "1px solid var(--glass-border)" }}>
          <button
            type="button"
            onClick={() => {
              setMode("login");
              setError("");
            }}
            className="btn-ios-pill"
            style={{
              justifyContent: "center",
              height: 44,
              background: mode === "login" ? "var(--accent-blue)" : "transparent",
              color: mode === "login" ? "#fff" : "var(--text-main)",
              border: "none",
              boxShadow: mode === "login" ? "0 10px 24px rgba(37,99,235,0.22)" : "none",
            }}
          >
            Đăng nhập
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("register");
              setError("");
            }}
            className="btn-ios-pill"
            style={{
              justifyContent: "center",
              height: 44,
              background: mode === "register" ? "var(--accent-blue)" : "transparent",
              color: mode === "register" ? "#fff" : "var(--text-main)",
              border: "none",
              boxShadow: mode === "register" ? "0 10px 24px rgba(37,99,235,0.22)" : "none",
            }}
          >
            Tạo mật khẩu lần đầu
          </button>
        </div>

        <div style={{ padding: "14px 16px", borderRadius: 14, background: "rgba(15,23,42,0.04)", border: "1px solid var(--glass-border)", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 24 }}>
          {mode === "login"
            ? "CTV đã kích hoạt tài khoản chỉ cần nhập email và mật khẩu để vào hệ thống."
            : "CTV mới chỉ cần dùng đúng email đã có sẵn trong danh sách đội ngũ để tự tạo mật khẩu lần đầu."}
        </div>

        <form onSubmit={mode === "login" ? handleLoginSubmit : handleRegisterSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="form-group">
            <label className="form-label" style={{ fontSize: 13, marginBottom: 8 }}>Địa chỉ Email</label>
            <input
              className="form-input"
              type="email"
              value={mode === "login" ? loginEmail : registerEmail}
              onChange={(e) => mode === "login" ? setLoginEmail(e.target.value) : setRegisterEmail(e.target.value)}
              placeholder="ctv@email.com"
              required
              style={{ height: 48, borderRadius: 12 }}
            />
          </div>
          <div className="form-group">
            <label className="form-label" style={{ fontSize: 13, marginBottom: 8 }}>Mật khẩu</label>
            <input
              className="form-input"
              type="password"
              value={mode === "login" ? loginPassword : registerPassword}
              onChange={(e) => mode === "login" ? setLoginPassword(e.target.value) : setRegisterPassword(e.target.value)}
              placeholder="••••••••"
              required
              style={{ height: 48, borderRadius: 12 }}
            />
          </div>

          {mode === "register" && (
            <div className="form-group">
              <label className="form-label" style={{ fontSize: 13, marginBottom: 8 }}>Xác nhận mật khẩu</label>
              <input
                className="form-input"
                type="password"
                value={registerPasswordConfirm}
                onChange={(e) => setRegisterPasswordConfirm(e.target.value)}
                placeholder="Nhập lại mật khẩu"
                required
                style={{ height: 48, borderRadius: 12 }}
              />
            </div>
          )}

          {error && (
            <div style={{ padding: "12px 16px", background: "rgba(239, 68, 68, 0.08)", color: "#f87171", borderRadius: 12, fontSize: 13, border: "1px solid rgba(239, 68, 68, 0.2)", display: "flex", alignItems: "center", gap: 8 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>error</span>
              {error}
            </div>
          )}

          <button className="btn-ios-pill btn-ios-primary" type="submit" style={{ width: "100%", justifyContent: "center", height: 52, fontSize: 16 }} disabled={loading}>
            {loading
              ? (mode === "login" ? "Đang xác thực..." : "Đang tạo tài khoản...")
              : (mode === "login" ? "Đăng nhập hệ thống" : "Tạo mật khẩu và vào hệ thống")}
          </button>
        </form>
      </div>
    </div>
  );
}
