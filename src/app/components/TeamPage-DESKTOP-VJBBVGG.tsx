"use client";

import React, { useEffect, useState } from "react";
import CustomSelect from "./CustomSelect";
import { useRealtimeRefresh } from "./realtime";
import { useAuth } from "./auth-context";
import type { Collaborator, TeamSummary, UserAccount } from "./types";
export default function TeamPage() {
  const { user } = useAuth();
  const isLeader = Boolean(user?.role === "admin" && user?.isLeader);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [userAccounts, setUserAccounts] = useState<UserAccount[]>([]);
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState<Partial<Collaborator>>({});
  const [formError, setFormError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [teamForm, setTeamForm] = useState({ name: "", description: "", ownerName: "", ownerPenName: "", ownerEmail: "" });
  const [teamError, setTeamError] = useState("");
  const [teamSaving, setTeamSaving] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferTargetUserId, setTransferTargetUserId] = useState("");
  const [transferring, setTransferring] = useState(false);

  const fetchTeams = () => {
    if (user?.role !== "admin") return;
    fetch("/api/teams", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const nextTeams = d.data || [];
        setTeams(nextTeams);
        setSelectedTeamId((current) => {
          if (current && nextTeams.some((team: TeamSummary) => String(team.id) === current)) {
            return current;
          }
          if (user?.teamId && nextTeams.some((team: TeamSummary) => team.id === user.teamId)) {
            return String(user.teamId);
          }
          return nextTeams[0]?.id ? String(nextTeams[0].id) : "";
        });
        if (isLeader && nextTeams.length === 0) {
          setLoading(false);
        }
      })
      .catch(() => {
        setTeams([]);
        setSelectedTeamId("");
        setLoading(false);
      });
  };

  const fetchCTVs = () => {
    if (isLeader && !selectedTeamId) {
      setCollaborators([]);
      setUserAccounts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const params = new URLSearchParams();
    if (isLeader && selectedTeamId) {
      params.set("teamId", selectedTeamId);
    }
    const query = params.toString();
    fetch(`/api/collaborators${query ? `?${query}` : ""}`, { cache: "no-store" })
      .then(r => r.json())
      .then(d => {
        setCollaborators(d.data || []);
        setUserAccounts(d.users || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchTeams();
  }, [user?.role]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isLeader && !selectedTeamId) {
      if (teams.length === 0) {
        setLoading(false);
      }
      return;
    }
    fetchCTVs();
  }, [isLeader, selectedTeamId, teams.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useRealtimeRefresh(["team"], () => {
    fetchTeams();
    fetchCTVs();
  });

  const closeModal = () => {
    setShowModal(false);
    setFormData({});
    setFormError("");
    setIsSaving(false);
  };

  const closeTeamModal = () => {
    setShowTeamModal(false);
    setTeamForm({ name: "", description: "", ownerName: "", ownerPenName: "", ownerEmail: "" });
    setTeamError("");
    setTeamSaving(false);
  };

  const closeTransferModal = () => {
    setShowTransferModal(false);
    setTransferTargetUserId("");
    setTransferring(false);
  };

  const openCreateModal = () => {
    const nextTeamId = isLeader ? Number(selectedTeamId || 0) || null : user?.teamId ?? null;
    if (isLeader && !nextTeamId) {
      alert("Vui lòng chọn team trước khi thêm thành viên.");
      return;
    }

    setFormData({ role: "writer", kpiStandard: 25, status: "active", teamId: nextTeamId });
    setFormError("");
    setShowModal(true);
  };

  const openEditModal = (collaborator: Collaborator) => {
    setFormData(collaborator);
    setFormError("");
    setShowModal(true);
  };

  const createTeam = async () => {
    if (!teamForm.name.trim()) {
      setTeamError("Vui lòng nhập tên team.");
      return;
    }

    try {
      setTeamSaving(true);
      setTeamError("");
      const res = await fetch("/api/teams", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(teamForm),
      });
      const data = await res.json().catch(() => ({ success: false, error: "Không thể đọc phản hồi từ máy chủ" }));
      if (!res.ok || !data.success) {
        setTeamError(data.error || "Không thể tạo team.");
        return;
      }

      closeTeamModal();
      fetchTeams();
      if (data.id) {
        setSelectedTeamId(String(data.id));
      }
      alert(data.generatedPassword
        ? `✅ Đã tạo team mới.\n\n🔑 Mật khẩu tạm của admin team: ${data.generatedPassword}`
        : "✅ Đã tạo team mới.");
    } catch {
      setTeamError("Không thể kết nối tới máy chủ.");
    } finally {
      setTeamSaving(false);
    }
  };

  const transferTeamOwner = async () => {
    if (!selectedTeamId || !transferTargetUserId) return;

    try {
      setTransferring(true);
      const res = await fetch("/api/teams", {
        method: "PUT",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "transfer-owner",
          teamId: Number(selectedTeamId),
          targetUserId: Number(transferTargetUserId),
        }),
      });
      const data = await res.json().catch(() => ({ success: false, error: "Không thể đọc phản hồi từ máy chủ" }));
      if (!res.ok || !data.success) {
        alert("❌ " + (data.error || "Không thể bàn giao team"));
        return;
      }

      setShowTransferModal(false);
      setTransferTargetUserId("");
      fetchTeams();
      fetchCTVs();
      alert("✅ Đã chuyển quyền quản lý team thành công.");
    } catch {
      alert("❌ Không thể kết nối tới máy chủ.");
    } finally {
      setTransferring(false);
    }
  };

  const deletableMembers = collaborators.filter((c) => {
    const linkedUser = userAccounts.find((u) => u.collaboratorId === c.id);
    return !linkedUser || linkedUser.role !== "admin";
  });

  const executeDelete = async () => {
    const collaboratorId = Number(deleteTarget);
    const collaborator = collaborators.find((c) => c.id === collaboratorId);
    if (!collaborator) return;

    const confirmed = window.confirm(
      `⚠️ Xác nhận xóa "${collaborator.name}" (${collaborator.penName})?\n\n` +
      `• Xóa tài khoản đăng nhập (nếu có)\n` +
      `• Xóa thông báo và bình luận liên quan\n` +
      `• Bài viết sẽ được giữ lại\n\n` +
      `Thao tác KHÔNG THỂ HOÀN TÁC!`
    );
    if (!confirmed) return;

    try {
      setIsDeleting(true);
      const res = await fetch("/api/collaborators", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: collaboratorId }),
      });
      const data = await res.json().catch(() => ({ success: false, error: "Không thể đọc phản hồi" }));
      if (!res.ok || !data.success) {
        alert("❌ " + (data.error || "Không thể xóa thành viên"));
        return;
      }

      let message = `✅ Đã xóa ${collaborator.name} (${collaborator.penName}) khỏi hệ thống.`;
      if (data.deletedUserAccount) {
        message += `\n\n🔒 Tài khoản ${data.deletedUserAccount.email} đã bị vô hiệu hóa.`;
      }
      alert(message);
      setShowDeleteModal(false);
      setDeleteTarget("");
      fetchCTVs();
    } catch {
      alert("❌ Không thể kết nối tới máy chủ.");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSave = async () => {
    const name = formData.name?.trim() || "";
    const penName = formData.penName?.trim() || "";
    const email = formData.email?.trim() || "";
    const kpiStandard = Number.isFinite(formData.kpiStandard) ? formData.kpiStandard : 25;
    const scopedTeamId = formData.id
      ? formData.teamId ?? null
      : isLeader
        ? Number(selectedTeamId || 0) || null
        : user?.teamId ?? null;

    if (!name || !penName) {
      setFormError("Vui lòng nhập đầy đủ Họ và tên và Bút danh trước khi lưu.");
      return;
    }
    if (!scopedTeamId) {
      setFormError("Không xác định được team của thành viên.");
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
        teamId: scopedTeamId,
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

      alert(data.generatedPassword
        ? `✅ Đã tạo thành viên mới.\n\n📧 Email: ${email}\n🔑 Mật khẩu tạm: ${data.generatedPassword}`
        : "✅ Cập nhật thay đổi thành công!");
    } catch {
      setFormError("Không thể kết nối tới máy chủ. Vui lòng thử lại.");
    } finally {
      setIsSaving(false);
    }
  };

  const currentTeam =
    teams.find((team) => String(team.id) === selectedTeamId)
    || (user?.teamId ? teams.find((team) => team.id === user.teamId) : null)
    || teams[0]
    || null;
  const teamSelectOptions = teams.map((team) => ({
    value: String(team.id),
    label: `${team.name}${team.status === "archived" ? " • Lưu trữ" : ""}`,
  }));
  const transferCandidateOptions = userAccounts
    .filter((account) => !account.isLeader && account.teamId === currentTeam?.id && account.id !== currentTeam?.ownerUserId)
    .map((account) => {
      const linkedCollaborator = collaborators.find((collaborator) => collaborator.id === account.collaboratorId)
        || collaborators.find((collaborator) => collaborator.linkedUserId === account.id)
        || null;
      const displayName = linkedCollaborator?.name || linkedCollaborator?.penName || account.email;
      const roleLabel = account.role === "admin" ? "Admin team" : linkedCollaborator?.role === "reviewer" ? "Reviewer" : "Writer";
      return {
        value: String(account.id),
        label: `${displayName} • ${roleLabel} • ${account.email}`,
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label, "vi"));
  const adminProfiles = userAccounts
    .filter((user) => user.role === "admin" && !user.isLeader)
    .map((user) => {
      const linkedCollaborator = collaborators.find((collaborator) => collaborator.linkedUserId === user.id || collaborator.linkedUserRole === "admin" && collaborator.linkedUserEmail === user.email) || null;
      return {
        id: linkedCollaborator ? `collaborator-${linkedCollaborator.id}` : `user-${user.id}`,
        collaboratorId: linkedCollaborator?.id ?? null,
        name: linkedCollaborator?.name || "Biên tập viên chính",
        penName: linkedCollaborator?.penName || "Admin",
        email: linkedCollaborator?.email || user.email,
        status: linkedCollaborator?.status || "active",
        kpiStandard: linkedCollaborator?.kpiStandard ?? null,
        isOwner: currentTeam?.ownerUserId === user.id,
      };
    });
  const writers = collaborators.filter(c => c.linkedUserRole !== "admin" && c.role === "writer");
  const reviewers = collaborators.filter(c => c.linkedUserRole !== "admin" && c.role === "reviewer");
  const currentLinkedUser = formData.linkedUserId ? userAccounts.find((user) => user.id === formData.linkedUserId) : null;
  const currentLinkedUserIsAdmin = currentLinkedUser?.role === "admin" || formData.linkedUserRole === "admin";
  const assignableUsers = userAccounts.filter((user) =>
    user.role === "ctv" && (!user.collaboratorId || user.collaboratorId === formData.id)
  );
  const roleOptions = [
    { value: "writer", label: "Người viết bài" },
    { value: "reviewer", label: "Người duyệt bài" },
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
          <p style={{ color: "var(--text-muted)", marginTop: 4, fontSize: 14 }}>
            {isLeader
              ? "Leader theo dõi từng team, bàn giao admin và quản lý nhân sự theo phạm vi team."
              : "Quản lý thông tin và hiệu suất cộng tác viên trong team của bạn."}
          </p>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <button className="btn-ios-pill btn-ios-primary" onClick={openCreateModal} disabled={isLeader && !currentTeam}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>person_add</span>
            Thêm thành viên
          </button>
          <button className="btn-ios-pill" onClick={() => { setDeleteTarget(""); setShowDeleteModal(true); }} disabled={isLeader && !currentTeam} style={{ background: "rgba(239, 68, 68, 0.08)", color: "var(--danger)", border: "1px solid rgba(239, 68, 68, 0.16)" }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>person_remove</span>
            Xóa thành viên
          </button>
        </div>
      </header>

      <div className="glass-card" style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 800, color: "var(--text-main)", marginBottom: 6 }}>
              {isLeader ? "Điều phối team" : "Thông tin team"}
            </h3>
            <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, maxWidth: 720 }}>
              {isLeader
                ? "Chọn team để xem roster, tạo team mới hoặc bàn giao owner cho admin khác trong chính team đó."
                : "Bạn chỉ nhìn thấy và quản lý thành viên, bài viết, task và thanh toán thuộc team hiện tại."}
            </p>
          </div>
          {isLeader && (
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button className="btn-ios-pill btn-ios-secondary" onClick={() => setShowTeamModal(true)}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>group_add</span>
                Tạo team
              </button>
              <button
                className="btn-ios-pill"
                onClick={() => {
                  setTransferTargetUserId(transferCandidateOptions[0]?.value || "");
                  setShowTransferModal(true);
                }}
                disabled={!currentTeam || transferCandidateOptions.length === 0}
                style={{ background: "rgba(37, 99, 235, 0.08)", color: "var(--accent-blue)", border: "1px solid rgba(37, 99, 235, 0.16)" }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>swap_horiz</span>
                Bàn giao owner
              </button>
            </div>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 18 }}>
          <div style={{ padding: 18, borderRadius: 18, border: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.03)" }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 10 }}>
              {isLeader ? "Team đang xem" : "Team của bạn"}
            </div>
            {isLeader ? (
              <CustomSelect
                value={selectedTeamId}
                onChange={setSelectedTeamId}
                options={teamSelectOptions.length > 0 ? teamSelectOptions : [{ value: "", label: "Chưa có team nào" }]}
                placeholder="Chọn team"
              />
            ) : (
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-main)" }}>
                {currentTeam?.name || user?.team?.name || "Chưa gán team"}
              </div>
            )}
            {currentTeam?.description && (
              <div style={{ marginTop: 10, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
                {currentTeam.description}
              </div>
            )}
          </div>

          <div style={{ padding: 18, borderRadius: 18, border: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.03)" }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 10 }}>Owner hiện tại</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-main)" }}>
              {currentTeam?.ownerName || currentTeam?.ownerPenName || "Chưa có owner"}
            </div>
            <div style={{ marginTop: 6, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
              {currentTeam?.ownerEmail || "Leader chưa gán tài khoản owner cho team này."}
            </div>
          </div>

          <div style={{ padding: 18, borderRadius: 18, border: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.03)" }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 10 }}>Trạng thái team</div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 999, background: !currentTeam ? "rgba(148, 163, 184, 0.12)" : currentTeam.status === "archived" ? "rgba(239, 68, 68, 0.08)" : "rgba(16, 185, 129, 0.08)", color: !currentTeam ? "var(--text-muted)" : currentTeam.status === "archived" ? "var(--danger)" : "#10b981", fontSize: 13, fontWeight: 700 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                {!currentTeam ? "hourglass_top" : currentTeam.status === "archived" ? "inventory_2" : "verified"}
              </span>
              {!currentTeam ? "Chưa có team" : currentTeam.status === "archived" ? "Đã lưu trữ" : "Đang hoạt động"}
            </div>
          </div>

          <div style={{ padding: 18, borderRadius: 18, border: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.03)" }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 10 }}>Snapshot nhân sự</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
              {[
                { label: "Thành viên", value: currentTeam?.memberCount ?? collaborators.length },
                { label: "Writer", value: currentTeam?.writerCount ?? writers.length },
                { label: "Reviewer", value: currentTeam?.reviewerCount ?? reviewers.length },
                { label: "Admin team", value: currentTeam?.adminCount ?? adminProfiles.length },
              ].map((item) => (
                <div key={item.label} style={{ padding: 12, borderRadius: 14, background: "rgba(255,255,255,0.02)" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>{item.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text-main)" }}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {isLeader && !currentTeam && (
          <div style={{ marginTop: 18, fontSize: 13, color: "var(--text-muted)" }}>
            Chưa có team nào để quản lý. Hãy tạo team đầu tiên để bắt đầu phân quyền.
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 24, marginBottom: 40 }}>
        {[
          { label: "Tổng thành viên", value: collaborators.length, icon: "groups", color: "var(--accent-blue)" },
          { label: "Cộng tác viên", value: writers.length, icon: "edit_note", color: "var(--accent-teal)" },
          { label: "Người duyệt", value: reviewers.length, icon: "verified", color: "var(--accent-purple)" },
          { label: "Admin team", value: adminProfiles.length, icon: "shield_person", color: "var(--accent-orange)" }
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
          <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text-main)" }}>📋 Admin team ({adminProfiles.length})</h3>
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
              {adminProfiles.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: "center", padding: 60, color: "var(--text-muted)" }}>Chưa có tài khoản admin team trong phạm vi hiện tại.</td></tr>
              ) : adminProfiles.map((admin, i) => (
                <tr key={admin.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.02)" }}>
                  <td style={{ padding: "16px 24px", fontSize: 13, color: "var(--text-muted)" }}>{i + 1}</td>
                  <td style={{ padding: "16px 24px", fontSize: 14, fontWeight: 600, color: "var(--text-main)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span>{admin.name}</span>
                      {admin.isOwner && (
                        <span style={{ padding: "4px 8px", borderRadius: 999, background: "rgba(37, 99, 235, 0.1)", color: "var(--accent-blue)", fontSize: 11, fontWeight: 800 }}>
                          OWNER
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: "16px 24px", fontSize: 14, color: "var(--accent-orange)", fontWeight: 600 }}>{admin.penName}</td>
                  <td style={{ padding: "16px 24px", fontSize: 13, color: "var(--text-muted)", overflowWrap: "anywhere" }}>{admin.email || "—"}</td>
                  <td style={{ padding: "16px 24px", textAlign: "center" }}>
                    <span style={{ padding: "2px 8px", borderRadius: 6, background: "rgba(249, 115, 22, 0.1)", color: "var(--accent-orange)", fontSize: 11, fontWeight: 800 }}>{admin.kpiStandard ?? "ADMIN"}</span>
                  </td>
                  <td style={{ padding: "16px 24px", textAlign: "center" }}>
                    <span style={statusBadgeStyle(admin.status)}>
                      {admin.status === "active" ? "Hoạt động" : "Tạm nghỉ"}
                    </span>
                  </td>
                  <td style={{ padding: "16px 24px", textAlign: "center" }}>
                    {admin.collaboratorId ? (
                      <button className="btn-ios-pill btn-ios-secondary" style={{ padding: "6px 12px" }} onClick={() => {
                        const collaborator = collaborators.find((item) => item.id === admin.collaboratorId);
                        if (collaborator) openEditModal(collaborator);
                      }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>edit</span>
                      </button>
                    ) : (
                      <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>Quản lý ở tài khoản hệ thống</span>
                    )}
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
                  {currentLinkedUserIsAdmin ? (
                    <>
                      <input className="form-input" value={currentLinkedUser?.isLeader ? "Leader hệ thống" : "Admin team"} readOnly style={{ background: "rgba(255,255,255,0.01)", opacity: 0.75 }} />
                      <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
                        Quyền admin được quản lý ở bảng tài khoản đăng nhập, không chỉnh tại trường vai trò cộng tác viên.
                      </div>
                    </>
                  ) : (
                    <CustomSelect
                      value={(formData.role || "writer") as Collaborator["role"]}
                      onChange={(value) => setFormData({ ...formData, role: value as Collaborator["role"] })}
                      options={roleOptions}
                    />
                  )}
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

      {showDeleteModal && (
        <div className="modal-overlay" onClick={() => !isDeleting && setShowDeleteModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="modal-header">
              <h3 className="modal-title">Xóa thành viên</h3>
              <button className="modal-close" onClick={() => !isDeleting && setShowDeleteModal(false)}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
              </button>
            </div>
            <div className="modal-body">
              <div style={{ marginBottom: 20, padding: "12px 16px", borderRadius: 12, border: "1px solid rgba(239, 68, 68, 0.18)", background: "rgba(239, 68, 68, 0.04)", fontSize: 13, color: "var(--danger)", fontWeight: 600, lineHeight: 1.5 }}>
                ⚠️ Thao tác này sẽ xóa vĩnh viễn thành viên, tài khoản đăng nhập, thông báo và bình luận liên quan. Bài viết sẽ được giữ lại.
              </div>
              <div className="form-group">
                <label className="form-label">Chọn thành viên cần xóa</label>
                <CustomSelect
                  value={deleteTarget}
                  onChange={setDeleteTarget}
                  options={[
                    { value: "", label: "— Chọn thành viên —" },
                    ...deletableMembers.map((c) => ({
                      value: String(c.id),
                      label: `${c.name} (${c.penName}) — ${c.linkedUserRole === "admin" ? "Admin team" : c.role === "reviewer" ? "Reviewer" : "Writer"}`,
                    })),
                  ]}
                  placeholder="Chọn thành viên"
                />
              </div>
              {deleteTarget && (() => {
                const target = collaborators.find((c) => c.id === Number(deleteTarget));
                if (!target) return null;
                const linkedUser = userAccounts.find((u) => u.collaboratorId === target.id);
                return (
                  <div style={{ padding: 16, borderRadius: 12, background: "rgba(0,0,0,0.02)", border: "1px solid var(--glass-border)" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-main)", marginBottom: 8 }}>Thông tin sẽ bị xóa:</div>
                    <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.8 }}>
                      <div>👤 <strong>{target.name}</strong> ({target.penName})</div>
                      <div>📧 {target.email || "Không có email"}</div>
                      <div>🔑 Tài khoản: {linkedUser ? linkedUser.email : "Không có tài khoản"}</div>
                    </div>
                  </div>
                );
              })()}
            </div>
            <div className="modal-footer">
              <button className="btn-ios-pill btn-ios-secondary" onClick={() => setShowDeleteModal(false)} disabled={isDeleting}>Hủy bỏ</button>
              <button
                className="btn-ios-pill"
                onClick={executeDelete}
                disabled={!deleteTarget || isDeleting}
                style={{
                  background: deleteTarget ? "var(--danger)" : "rgba(239, 68, 68, 0.3)",
                  color: "#fff",
                  border: "none",
                  opacity: isDeleting ? 0.75 : 1,
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>delete_forever</span>
                {isDeleting ? "Đang xóa..." : "Xóa vĩnh viễn"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showTeamModal && (
        <div className="modal-overlay" onClick={() => !teamSaving && closeTeamModal()}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Tạo team mới</h3>
              <button className="modal-close" onClick={() => !teamSaving && closeTeamModal()}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
              </button>
            </div>
            <div className="modal-body">
              {teamError && (
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
                  {teamError}
                </div>
              )}
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Tên team *</label>
                  <input className="form-input" value={teamForm.name} onChange={(e) => { setTeamForm({ ...teamForm, name: e.target.value }); if (teamError) setTeamError(""); }} placeholder="Team Nội dung công nghệ" />
                </div>
                <div className="form-group">
                  <label className="form-label">Mô tả ngắn</label>
                  <input className="form-input" value={teamForm.description} onChange={(e) => setTeamForm({ ...teamForm, description: e.target.value })} placeholder="Phụ trách chuyên mục hoặc line nội dung" />
                </div>
              </div>
              <div style={{ marginBottom: 18, padding: 16, borderRadius: 16, border: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.03)", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.7 }}>
                Điền email nếu muốn tạo luôn tài khoản owner cho team. Nếu để trống, leader có thể tạo member trước rồi bàn giao owner sau.
              </div>
              <div className="grid-3">
                <div className="form-group">
                  <label className="form-label">Tên owner</label>
                  <input className="form-input" value={teamForm.ownerName} onChange={(e) => setTeamForm({ ...teamForm, ownerName: e.target.value })} placeholder="Nguyễn Văn B" />
                </div>
                <div className="form-group">
                  <label className="form-label">Bút danh owner</label>
                  <input className="form-input" value={teamForm.ownerPenName} onChange={(e) => setTeamForm({ ...teamForm, ownerPenName: e.target.value })} placeholder="Editor B" />
                </div>
                <div className="form-group">
                  <label className="form-label">Email owner</label>
                  <input className="form-input" type="email" value={teamForm.ownerEmail} onChange={(e) => setTeamForm({ ...teamForm, ownerEmail: e.target.value })} placeholder="admin-team@email.com" />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-ios-pill btn-ios-secondary" onClick={closeTeamModal} disabled={teamSaving}>Hủy bỏ</button>
              <button className="btn-ios-pill btn-ios-primary" onClick={createTeam} disabled={teamSaving} style={{ opacity: teamSaving ? 0.75 : 1 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>group_add</span>
                {teamSaving ? "Đang tạo..." : "Tạo team"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showTransferModal && (
        <div className="modal-overlay" onClick={() => !transferring && closeTransferModal()}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div className="modal-header">
              <h3 className="modal-title">Bàn giao owner team</h3>
              <button className="modal-close" onClick={() => !transferring && closeTransferModal()}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
              </button>
            </div>
            <div className="modal-body">
              <div style={{ marginBottom: 18, padding: 16, borderRadius: 16, border: "1px solid rgba(37, 99, 235, 0.16)", background: "rgba(37, 99, 235, 0.05)", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.7 }}>
                {currentTeam
                  ? `Bạn đang bàn giao team ${currentTeam.name}. Tài khoản được chọn sẽ trở thành admin team mới và owner hiện tại sẽ bị hạ về tài khoản CTV nếu không phải leader.`
                  : "Chọn team trước khi bàn giao owner."}
              </div>
              <div className="form-group">
                <label className="form-label">Chọn tài khoản nhận bàn giao</label>
                <CustomSelect
                  value={transferTargetUserId}
                  onChange={setTransferTargetUserId}
                  options={[
                    { value: "", label: "— Chọn tài khoản —" },
                    ...transferCandidateOptions,
                  ]}
                  placeholder="Chọn tài khoản trong team"
                />
              </div>
              {transferCandidateOptions.length === 0 && (
                <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
                  Team này chưa có tài khoản phù hợp để nhận bàn giao. Hãy tạo thành viên có email đăng nhập trước.
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn-ios-pill btn-ios-secondary" onClick={closeTransferModal} disabled={transferring}>Hủy bỏ</button>
              <button className="btn-ios-pill btn-ios-primary" onClick={transferTeamOwner} disabled={!transferTargetUserId || transferring} style={{ opacity: transferring ? 0.75 : 1 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>swap_horiz</span>
                {transferring ? "Đang bàn giao..." : "Xác nhận bàn giao"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ══════════════════════════ EDITORIAL TASKS ══════════════════════════ */
