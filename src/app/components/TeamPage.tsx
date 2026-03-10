"use client";

import React, { useEffect, useState } from "react";
import CustomSelect from "./CustomSelect";
import { useRealtimeRefresh } from "./realtime";
import type { Collaborator, UserAccount } from "./types";
export default function TeamPage() {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [userAccounts, setUserAccounts] = useState<UserAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState<Partial<Collaborator>>({});
  const [formError, setFormError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const fetchCTVs = () => {
    fetch("/api/collaborators", { cache: "no-store" })
      .then(r => r.json())
      .then(d => {
        setCollaborators(d.data || []);
        setUserAccounts(d.users || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => { fetchCTVs(); }, []);
  useRealtimeRefresh(["team"], fetchCTVs);

  const closeModal = () => {
    setShowModal(false);
    setFormData({});
    setFormError("");
    setIsSaving(false);
  };

  const openCreateModal = () => {
    setFormData({ role: "writer", kpiStandard: 25, status: "active" });
    setFormError("");
    setShowModal(true);
  };

  const openEditModal = (collaborator: Collaborator) => {
    setFormData(collaborator);
    setFormError("");
    setShowModal(true);
  };

  const handleSave = async () => {
    const name = formData.name?.trim() || "";
    const penName = formData.penName?.trim() || "";
    const email = formData.email?.trim() || "";
    const kpiStandard = Number.isFinite(formData.kpiStandard) ? formData.kpiStandard : 25;

    if (!name || !penName) {
      setFormError("Vui lòng nhập đầy đủ Họ và tên và Bút danh trước khi lưu.");
      return;
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFormError("Email tài khoản không hợp lệ.");
      return;
    }

    try {
      setIsSaving(true);
      setFormError("");

      const payload = {
        ...formData,
        name,
        penName,
        email: email || undefined,
        kpiStandard,
        linkedUserId: formData.linkedUserId ?? null,
      };

      const res = await fetch("/api/collaborators", {
        method: formData.id ? "PUT" : "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({ success: false, error: "Không thể đọc phản hồi từ máy chủ" }));
      if (!res.ok || !data.success) {
        setFormError(data.error || "Không thể lưu thành viên lúc này.");
        return;
      }

      closeModal();
      fetchCTVs();

      if (data.generatedPassword) {
        alert(`✅ CTV tạo thành công!\n\n📧 Email: ${email}\n🔑 Mật khẩu tạm: ${data.generatedPassword}\n\n⚠️ Gửi thông tin này cho CTV để đăng nhập!`);
      } else {
        alert("✅ Cập nhật thay đổi thành công!");
      }
    } catch {
      setFormError("Không thể kết nối tới máy chủ. Vui lòng thử lại.");
    } finally {
      setIsSaving(false);
    }
  };

  const writers = collaborators.filter(c => c.role === "writer");
  const reviewers = collaborators.filter(c => c.role === "reviewer");
  const editors = collaborators.filter(c => c.role === "editor");
  const currentLinkedUser = formData.linkedUserId ? userAccounts.find((user) => user.id === formData.linkedUserId) : null;
  const currentLinkedUserIsAdmin = currentLinkedUser?.role === "admin" || formData.linkedUserRole === "admin";
  const assignableUsers = userAccounts.filter((user) =>
    user.role === "ctv" && (!user.collaboratorId || user.collaboratorId === formData.id)
  );
  const roleOptions = [
    { value: "writer", label: "Người viết bài" },
    { value: "reviewer", label: "Người duyệt bài" },
    { value: "editor", label: "Biên tập viên" },
  ];
  const assignableUserOptions = [
    { value: "", label: "Không gán tài khoản" },
    ...assignableUsers.map((user) => ({ value: String(user.id), label: user.email })),
  ];
  const tableColumnWidths = ["8%", "23%", "16%", "25%", "8%", "12%", "8%"];
  const statusBadgeStyle = (status: string) => ({
    padding: "4px 10px",
    borderRadius: 8,
    background: status === "active" ? "rgba(16, 185, 129, 0.1)" : "rgba(239, 68, 68, 0.1)",
    color: status === "active" ? "#10b981" : "#f87171",
    fontSize: 12,
    fontWeight: 700,
  } as const);

  if (loading) {
    return <div className="loading" style={{ padding: 60, fontSize: 18, color: "var(--accent-blue)" }}>⏳ Đang tải đội ngũ...</div>;
  }

  return (
    <>
      <header className="page-shell-header">
        <div>
          <h2 style={{ fontSize: 32, fontWeight: 800, color: "var(--text-main)", letterSpacing: "-0.04em" }}>Đội ngũ</h2>
          <p style={{ color: "var(--text-muted)", marginTop: 4, fontSize: 14 }}>Quản lý thông tin và hiệu suất cộng tác viên chuyên nghiệp.</p>
        </div>
        <button className="btn-ios-pill btn-ios-primary" onClick={openCreateModal}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>person_add</span>
          Thêm thành viên
        </button>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 24, marginBottom: 40 }}>
        {[
          { label: "Tổng thành viên", value: collaborators.length, icon: "groups", color: "var(--accent-blue)" },
          { label: "Cộng tác viên", value: writers.length, icon: "edit_note", color: "var(--accent-teal)" },
          { label: "Người duyệt", value: reviewers.length, icon: "verified", color: "var(--accent-purple)" },
          { label: "Biên tập viên", value: editors.length, icon: "shield_person", color: "var(--accent-orange)" }
        ].map((s, i) => (
          <div key={i} className="glass-card" style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: `${s.color}15`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 24, color: s.color }}>{s.icon}</span>
            </div>
            <div>
              <p style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>{s.label}</p>
              <p style={{ fontSize: 24, fontWeight: 800, color: "var(--text-main)" }}>{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="glass-card" style={{ padding: 0, overflow: "hidden", marginBottom: 32 }}>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.02)" }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text-main)" }}>✍️ Cộng tác viên viết bài ({writers.length})</h3>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 820, borderCollapse: "collapse", textAlign: "left", tableLayout: "fixed" }}>
            <colgroup>
              {tableColumnWidths.map((width, idx) => <col key={idx} style={{ width }} />)}
            </colgroup>
            <thead style={{ background: "rgba(255,255,255,0.01)", borderBottom: "1px solid var(--glass-border)" }}>
              <tr>
                <th style={{ padding: "12px 24px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>STT</th>
                <th style={{ padding: "12px 24px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>Họ tên</th>
                <th style={{ padding: "12px 24px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>Bút danh</th>
                <th style={{ padding: "12px 24px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>Email</th>
                <th style={{ padding: "12px 24px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", textAlign: "center" }}>KPI</th>
                <th style={{ padding: "12px 24px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", textAlign: "center" }}>Trạng thái</th>
                <th style={{ padding: "12px 24px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", textAlign: "center" }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {writers.map((c, i) => (
                <tr key={c.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.02)" }}>
                  <td style={{ padding: "16px 24px", fontSize: 13, color: "var(--text-muted)" }}>{i + 1}</td>
                  <td style={{ padding: "16px 24px", fontSize: 14, fontWeight: 600, color: "var(--text-main)" }}>{c.name}</td>
                  <td style={{ padding: "16px 24px", fontSize: 14, color: "var(--accent-blue)", fontWeight: 600 }}>{c.penName}</td>
                  <td style={{ padding: "16px 24px", fontSize: 13, color: "var(--text-muted)", overflowWrap: "anywhere" }}>{c.email || "—"}</td>
                  <td style={{ padding: "16px 24px", textAlign: "center" }}>
                    <span style={{ padding: "2px 8px", borderRadius: 6, background: "rgba(59, 130, 246, 0.1)", color: "var(--accent-blue)", fontSize: 11, fontWeight: 800 }}>{c.kpiStandard}</span>
                  </td>
                  <td style={{ padding: "16px 24px", textAlign: "center" }}>
                    <span style={statusBadgeStyle(c.status)}>
                      {c.status === "active" ? "Hoạt động" : "Tạm nghỉ"}
                    </span>
                  </td>
                  <td style={{ padding: "16px 24px", textAlign: "center" }}>
                    <button className="btn-ios-pill btn-ios-secondary" style={{ padding: "6px 12px" }} onClick={() => openEditModal(c)}>
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>edit</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="glass-card" style={{ padding: 0, overflow: "hidden", marginBottom: 32 }}>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.02)" }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text-main)" }}>✅ Cộng tác viên duyệt ({reviewers.length})</h3>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 820, borderCollapse: "collapse", textAlign: "left", tableLayout: "fixed" }}>
            <colgroup>
              {tableColumnWidths.map((width, idx) => <col key={idx} style={{ width }} />)}
            </colgroup>
            <thead style={{ background: "rgba(255,255,255,0.01)", borderBottom: "1px solid var(--glass-border)" }}>
              <tr>
                <th style={{ padding: "12px 24px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>STT</th>
                <th style={{ padding: "12px 24px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>Họ tên</th>
                <th style={{ padding: "12px 24px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>Bút danh</th>
                <th style={{ padding: "12px 24px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>Email</th>
                <th style={{ padding: "12px 24px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", textAlign: "center" }}>KPI</th>
                <th style={{ padding: "12px 24px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", textAlign: "center" }}>Trạng thái</th>
                <th style={{ padding: "12px 24px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", textAlign: "center" }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {reviewers.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: "center", padding: 60, color: "var(--text-muted)" }}>Chưa có cộng tác viên duyệt</td></tr>
              ) : reviewers.map((c, i) => (
                <tr key={c.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.02)" }}>
                  <td style={{ padding: "16px 24px", fontSize: 13, color: "var(--text-muted)" }}>{i + 1}</td>
                  <td style={{ padding: "16px 24px", fontSize: 14, fontWeight: 600, color: "var(--text-main)" }}>{c.name}</td>
                  <td style={{ padding: "16px 24px", fontSize: 14, color: "var(--accent-purple)", fontWeight: 600 }}>{c.penName}</td>
                  <td style={{ padding: "16px 24px", fontSize: 13, color: "var(--text-muted)", overflowWrap: "anywhere" }}>{c.email || "—"}</td>
                  <td style={{ padding: "16px 24px", textAlign: "center" }}>
                    <span style={{ padding: "2px 8px", borderRadius: 6, background: "rgba(168, 85, 247, 0.1)", color: "var(--accent-purple)", fontSize: 11, fontWeight: 800 }}>{c.kpiStandard}</span>
                  </td>
                  <td style={{ padding: "16px 24px", textAlign: "center" }}>
                    <span style={statusBadgeStyle(c.status)}>
                      {c.status === "active" ? "Hoạt động" : "Tạm nghỉ"}
                    </span>
                  </td>
                  <td style={{ padding: "16px 24px", textAlign: "center" }}>
                    <button className="btn-ios-pill btn-ios-secondary" style={{ padding: "6px 12px" }} onClick={() => openEditModal(c)}>
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>edit</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="glass-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.02)" }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text-main)" }}>📋 Biên tập viên ({editors.length})</h3>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 820, borderCollapse: "collapse", textAlign: "left", tableLayout: "fixed" }}>
            <colgroup>
              {tableColumnWidths.map((width, idx) => <col key={idx} style={{ width }} />)}
            </colgroup>
            <thead style={{ background: "rgba(255,255,255,0.01)", borderBottom: "1px solid var(--glass-border)" }}>
              <tr>
                <th style={{ padding: "12px 24px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>STT</th>
                <th style={{ padding: "12px 24px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>Họ tên</th>
                <th style={{ padding: "12px 24px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>Bút danh</th>
                <th style={{ padding: "12px 24px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>Email</th>
                <th style={{ padding: "12px 24px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", textAlign: "center" }}>KPI</th>
                <th style={{ padding: "12px 24px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", textAlign: "center" }}>Trạng thái</th>
                <th style={{ padding: "12px 24px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", textAlign: "center" }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {editors.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: "center", padding: 60, color: "var(--text-muted)" }}>Chưa có biên tập viên</td></tr>
              ) : editors.map((c, i) => (
                <tr key={c.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.02)" }}>
                  <td style={{ padding: "16px 24px", fontSize: 13, color: "var(--text-muted)" }}>{i + 1}</td>
                  <td style={{ padding: "16px 24px", fontSize: 14, fontWeight: 600, color: "var(--text-main)" }}>{c.name}</td>
                  <td style={{ padding: "16px 24px", fontSize: 14, color: "var(--accent-orange)", fontWeight: 600 }}>{c.penName}</td>
                  <td style={{ padding: "16px 24px", fontSize: 13, color: "var(--text-muted)", overflowWrap: "anywhere" }}>{c.email || "—"}</td>
                  <td style={{ padding: "16px 24px", textAlign: "center" }}>
                    <span style={{ padding: "2px 8px", borderRadius: 6, background: "rgba(249, 115, 22, 0.1)", color: "var(--accent-orange)", fontSize: 11, fontWeight: 800 }}>{c.kpiStandard}</span>
                  </td>
                  <td style={{ padding: "16px 24px", textAlign: "center" }}>
                    <span style={statusBadgeStyle(c.status)}>
                      {c.status === "active" ? "Hoạt động" : "Tạm nghỉ"}
                    </span>
                  </td>
                  <td style={{ padding: "16px 24px", textAlign: "center" }}>
                    <button className="btn-ios-pill btn-ios-secondary" style={{ padding: "6px 12px" }} onClick={() => openEditModal(c)}>
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>edit</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">{formData.id ? "Thông tin thành viên" : "Thêm cộng tác viên"}</h3>
              <button className="modal-close" onClick={closeModal}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
              </button>
            </div>
            <div className="modal-body">
              {formError && (
                <div
                  role="alert"
                  style={{
                    marginBottom: 20,
                    padding: "12px 16px",
                    borderRadius: 12,
                    border: "1px solid rgba(239, 68, 68, 0.18)",
                    background: "var(--danger-light)",
                    color: "var(--danger)",
                    fontSize: 13,
                    fontWeight: 600,
                    lineHeight: 1.5,
                  }}
                >
                  {formError}
                </div>
              )}
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Họ và tên *</label>
                  <input className="form-input" value={formData.name || ""} onChange={e => { setFormData({ ...formData, name: e.target.value }); if (formError) setFormError(""); }} placeholder="Nguyễn Văn A" />
                </div>
                <div className="form-group">
                  <label className="form-label">Bút danh *</label>
                  <input className="form-input" value={formData.penName || ""} onChange={e => { setFormData({ ...formData, penName: e.target.value }); if (formError) setFormError(""); }} placeholder="Bút danh" />
                </div>
              </div>
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Email tài khoản</label>
                  <input className="form-input" type="email" value={formData.email || ""} onChange={e => { setFormData({ ...formData, email: e.target.value }); if (formError) setFormError(""); }} placeholder="ctv@email.com" />
                </div>
                <div className="form-group">
                  <label className="form-label">Vai trò hệ thống</label>
                  <CustomSelect value={formData.role || "writer"} onChange={(value) => setFormData({ ...formData, role: value })} options={roleOptions} />
                </div>
              </div>
              {formData.id && (
                <div style={{ marginBottom: 18, padding: 16, borderRadius: 16, border: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.03)" }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 10 }}>Liên kết tài khoản đăng nhập</div>
                  <div style={{ fontSize: 13, color: "var(--text-main)", marginBottom: 12 }}>
                    {formData.linkedUserEmail
                      ? `Đang liên kết: ${formData.linkedUserEmail}${formData.linkedUserRole ? ` • ${formData.linkedUserRole.toUpperCase()}` : ""}`
                      : "Chưa liên kết tài khoản nào."}
                  </div>
                  {currentLinkedUserIsAdmin ? (
                    <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
                      Tài khoản admin đang được giữ nguyên. Màn hình này chỉ cho phép gán lại các tài khoản CTV.
                    </div>
                  ) : (
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Gán tài khoản CTV</label>
                      <CustomSelect
                        value={String(formData.linkedUserId ?? "")}
                        onChange={(value) => setFormData({ ...formData, linkedUserId: value ? Number(value) : null })}
                        options={assignableUserOptions}
                      />
                    </div>
                  )}
                </div>
              )}
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Chỉ tiêu KPI (Tháng)</label>
                  <input className="form-input" type="number" value={formData.kpiStandard || 25} onChange={e => setFormData({ ...formData, kpiStandard: Number(e.target.value) })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Số điện thoại</label>
                  <input className="form-input" value={formData.phone || ""} onChange={e => setFormData({ ...formData, phone: e.target.value })} placeholder="090..." />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Vị trí / Tiểu sử ngắn</label>
                <input className="form-input" value={formData.bio || ""} onChange={e => setFormData({ ...formData, bio: e.target.value })} placeholder="VD: Senior Writer | Tech Expert" />
              </div>
              <div className="grid-3">
                <div className="form-group">
                  <label className="form-label">Facebook</label>
                  <input className="form-input" value={formData.socialFacebook || ""} onChange={e => setFormData({ ...formData, socialFacebook: e.target.value })} placeholder="Link" />
                </div>
                <div className="form-group">
                  <label className="form-label">Zalo</label>
                  <input className="form-input" value={formData.socialZalo || ""} onChange={e => setFormData({ ...formData, socialZalo: e.target.value })} placeholder="SĐT" />
                </div>
                <div className="form-group">
                  <label className="form-label">TikTok</label>
                  <input className="form-input" value={formData.socialTiktok || ""} onChange={e => setFormData({ ...formData, socialTiktok: e.target.value })} placeholder="@user" />
                </div>
              </div>
              {!formData.id && formData.email && (
                <div style={{ padding: "12px 16px", background: "rgba(59, 130, 246, 0.05)", borderRadius: 12, border: "1px solid rgba(59, 130, 246, 0.1)", display: "flex", gap: 12, alignItems: "flex-start", marginTop: 8 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18, color: "var(--accent-blue)" }}>info</span>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>Hệ thống sẽ tự động tạo tài khoản với mật khẩu ngẫu nhiên. Vui lòng gửi thông tin đăng nhập cho CTV sau khi lưu.</p>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn-ios-pill btn-ios-secondary" onClick={closeModal} disabled={isSaving}>Hủy bỏ</button>
              <button className="btn-ios-pill btn-ios-primary" onClick={handleSave} disabled={isSaving} style={{ opacity: isSaving ? 0.75 : 1 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>save</span>
                {isSaving ? "Đang lưu..." : "Lưu thành viên"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ══════════════════════════ EDITORIAL TASKS ══════════════════════════ */
