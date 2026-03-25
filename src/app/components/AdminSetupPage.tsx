"use client";

import React, { useMemo, useState } from "react";
import BrandLogo from "./BrandLogo";
import { useAuth } from "./auth-context";

export default function AdminSetupPage() {
  const { user, logout, refreshUser } = useAuth();
  const [employeeCode, setEmployeeCode] = useState(user?.employeeCode ?? "");
  const [teamName, setTeamName] = useState(user?.adminSetup?.currentTeamName ?? user?.team?.name ?? "");
  const [teamDescription, setTeamDescription] = useState(
    user?.adminSetup?.currentTeamDescription ?? user?.team?.description ?? ""
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const needsTeamSetup = useMemo(() => {
    if (!user || user.role !== "admin") return false;
    return Boolean(user.adminSetup?.needsTeamSetup);
  }, [user]);

  if (!user || user.role !== "admin") {
    return null;
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextEmployeeCode = employeeCode.trim();
    const nextTeamName = teamName.trim();
    const nextTeamDescription = teamDescription.trim();

    if (!nextEmployeeCode) {
      setError("Vui lòng nhập mã nhân viên trước khi tiếp tục.");
      return;
    }

    if (needsTeamSetup && !nextTeamName) {
      setError("Vui lòng đặt tên nhóm CTV để bắt đầu quản trị team.");
      return;
    }

    try {
      setLoading(true);
      setError("");

      const payload: Record<string, unknown> = {
        employeeCode: nextEmployeeCode,
      };

      if (needsTeamSetup) {
        payload.teamName = nextTeamName;
        payload.teamDescription = nextTeamDescription;
      }

      const res = await fetch("/api/admin/setup", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({
        success: false,
        error: "Không thể đọc phản hồi từ máy chủ.",
      }));

      if (!res.ok || !data.success) {
        setError(data.error || "Không thể hoàn tất bước khởi tạo quản trị.");
        return;
      }

      await refreshUser();
    } catch {
      setError("Không thể kết nối tới máy chủ. Vui lòng thử lại.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-shell">
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(135deg, rgba(37,99,235,0.08) 0%, rgba(15,23,42,0.02) 36%, rgba(16,185,129,0.08) 100%)",
          pointerEvents: "none",
        }}
      />

      <div className="glass-card auth-card" style={{ maxWidth: 720 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <BrandLogo align="center" gap={16} markSize={68} titleSize={28} />
          <h2 style={{ fontSize: 28, fontWeight: 800, color: "var(--text-main)", marginTop: 20, marginBottom: 10 }}>
            Hoàn tất khởi tạo quản trị
          </h2>
          <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.7 }}>
            Trước khi vào khu quản trị, bạn cần hoàn tất thông tin nền để hệ thống phân quyền đúng theo team và
            hỗ trợ các luồng KPI, Google Sheet, cộng tác viên về sau.
          </p>
        </div>

        <div
          style={{
            marginBottom: 24,
            padding: 18,
            borderRadius: 18,
            border: "1px solid var(--glass-border)",
            background: "rgba(255,255,255,0.03)",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 10 }}>
            Tài khoản hiện tại
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Email đăng nhập</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-main)" }}>{user.email}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Vai trò</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-main)" }}>
                {user.isLeader ? "Leader hệ thống" : "Admin team"}
              </div>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="form-group">
            <label className="form-label">Mã nhân viên *</label>
            <input
              className="form-input"
              value={employeeCode}
              onChange={(event) => {
                setEmployeeCode(event.target.value);
                if (error) setError("");
              }}
              placeholder="Ví dụ: NhanND18"
              autoFocus
              required
            />
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
              Mã nhân viên sẽ được dùng cho các luồng KPI nội bộ và để định danh đúng tài khoản quản trị của bạn.
            </div>
          </div>

          {needsTeamSetup ? (
            <>
              <div className="form-group">
                <label className="form-label">Tên nhóm CTV *</label>
                <input
                  className="form-input"
                  value={teamName}
                  onChange={(event) => {
                    setTeamName(event.target.value);
                    if (error) setError("");
                  }}
                  placeholder="Ví dụ: Team Nội dung Công nghệ"
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Mô tả nhóm</label>
                <textarea
                  className="form-input"
                  value={teamDescription}
                  onChange={(event) => setTeamDescription(event.target.value)}
                  placeholder="Mô tả ngắn về chuyên mục, line nội dung hoặc phạm vi quản lý của team"
                  rows={4}
                  style={{ minHeight: 120, resize: "vertical" }}
                />
              </div>
            </>
          ) : user.team ? (
            <div
              style={{
                padding: 18,
                borderRadius: 18,
                border: "1px solid rgba(37, 99, 235, 0.18)",
                background: "rgba(37, 99, 235, 0.06)",
                color: "var(--text-muted)",
                fontSize: 13,
                lineHeight: 1.7,
              }}
            >
              Team hiện tại của bạn là <strong style={{ color: "var(--text-main)" }}>{user.team.name}</strong>. Sau khi vào hệ
              thống, bạn có thể cập nhật lại tên nhóm, mô tả và thêm cộng tác viên trong mục <strong>Đội ngũ</strong>.
            </div>
          ) : null}

          {error && (
            <div
              style={{
                padding: "12px 16px",
                background: "rgba(239, 68, 68, 0.08)",
                color: "var(--danger)",
                borderRadius: 12,
                fontSize: 13,
                border: "1px solid rgba(239, 68, 68, 0.18)",
              }}
            >
              {error}
            </div>
          )}

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button
              className="btn-ios-pill btn-ios-secondary"
              type="button"
              onClick={() => void logout()}
              disabled={loading}
              style={{ justifyContent: "center", minWidth: 150 }}
            >
              Đăng xuất
            </button>
            <button
              className="btn-ios-pill btn-ios-primary"
              type="submit"
              disabled={loading}
              style={{ flex: 1, justifyContent: "center", minHeight: 50 }}
            >
              {loading ? "Đang hoàn tất..." : "Hoàn tất khởi tạo"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
