"use client";

import React, { useEffect, useState } from "react";
import CustomSelect from "./CustomSelect";
import { useRealtimeRefresh } from "./realtime";
import { useAuth } from "./auth-context";
import type { Collaborator, TeamSummary, UserAccount } from "./types";
import { useIsMobile } from "./useMediaQuery";
import BottomSheet from "./BottomSheet";

type AdminProfile = {
  id: string;
  userId: number;
  collaboratorId: number | null;
  name: string;
  penName: string;
  email: string;
  status: string;
  kpiStandard: number | null;
  employeeCode: string | null;
  isOwner: boolean;
  isLeader: boolean;
};

export default function TeamPage() {
  const { user, refreshUser } = useAuth();
  const isMobile = useIsMobile();
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
  const [showEmployeeCodeModal, setShowEmployeeCodeModal] = useState(false);
  const [employeeCodeForm, setEmployeeCodeForm] = useState({ userId: "", employeeCode: "", displayName: "", email: "" });
  const [employeeCodeError, setEmployeeCodeError] = useState("");
  const [employeeCodeSaving, setEmployeeCodeSaving] = useState(false);

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

  const closeEmployeeCodeModal = () => {
    setShowEmployeeCodeModal(false);
    setEmployeeCodeForm({ userId: "", employeeCode: "", displayName: "", email: "" });
    setEmployeeCodeError("");
    setEmployeeCodeSaving(false);
  };

  const openEmployeeCodeModal = (admin: AdminProfile) => {
    setEmployeeCodeForm({
      userId: String(admin.userId),
      employeeCode: admin.employeeCode || "",
      displayName: admin.name,
      email: admin.email,
    });
    setEmployeeCodeError("");
    setShowEmployeeCodeModal(true);
  };

  const saveEmployeeCode = async () => {
    const userId = Number(employeeCodeForm.userId);
    const employeeCode = employeeCodeForm.employeeCode.trim();

    if (!Number.isInteger(userId) || userId <= 0) {
      setEmployeeCodeError("Không xác định được tài khoản cần cập nhật.");
      return;
    }
    if (!employeeCode) {
      setEmployeeCodeError("Vui lòng nhập mã nhân viên.");
      return;
    }

    try {
      setEmployeeCodeSaving(true);
      setEmployeeCodeError("");
      const res = await fetch("/api/collaborators", {
        method: "PUT",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          employeeCode,
        }),
      });
      const data = await res.json().catch(() => ({ success: false, error: "Không thể đọc phản hồi từ máy chủ" }));
      if (!res.ok || !data.success) {
        setEmployeeCodeError(data.error || "Không thể lưu mã nhân viên.");
        return;
      }

      closeEmployeeCodeModal();
      fetchCTVs();
      if (user?.id === userId && typeof refreshUser === "function") {
        await refreshUser();
      }
      alert("✅ Đã cập nhật mã nhân viên thành công.");
    } catch {
      setEmployeeCodeError("Không thể kết nối tới máy chủ. Vui lòng thử lại.");
    } finally {
      setEmployeeCodeSaving(false);
    }
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
  const adminProfiles: AdminProfile[] = userAccounts
    .filter((account) => account.role === "admin")
    .map((account) => {
      const linkedCollaborator = collaborators.find((collaborator) => collaborator.linkedUserId === account.id || (collaborator.linkedUserRole === "admin" && collaborator.linkedUserEmail === account.email)) || null;
      return {
        id: linkedCollaborator ? `collaborator-${linkedCollaborator.id}` : `user-${account.id}`,
        userId: account.id,
        collaboratorId: linkedCollaborator?.id ?? null,
        name: linkedCollaborator?.name || (account.isLeader ? "Leader hệ thống" : "Biên tập viên chính"),
        penName: linkedCollaborator?.penName || (account.isLeader ? "Leader" : "Admin"),
        email: linkedCollaborator?.email || account.email,
        status: linkedCollaborator?.status || "active",
        kpiStandard: linkedCollaborator?.kpiStandard ?? null,
        employeeCode: account.employeeCode ?? linkedCollaborator?.employeeCode ?? null,
        isOwner: currentTeam?.ownerUserId === account.id,
        isLeader: Boolean(account.isLeader),
      };
    });
  const currentAdminProfile = adminProfiles.find((admin) => admin.userId === user?.id) || null;
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
      <header className="page-shell-header" style={{ flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "flex-start" : "center", gap: isMobile ? 12 : 16 }}>
        <div>
          <h2 style={{ fontSize: isMobile ? 26 : 32, fontWeight: 800, color: "var(--text-main)", letterSpacing: "-0.04em" }}>Đội ngũ</h2>
        </div>
        <div style={{ display: "flex", gap: 10, width: isMobile ? "100%" : "auto" }}>
          <button className="btn-ios-pill btn-ios-primary" style={{ flex: isMobile ? 1 : "initial", justifyContent: "center" }} onClick={openCreateModal} disabled={isLeader && !currentTeam}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>person_add</span>
            Thành viên
          </button>
          <button className="btn-ios-pill" onClick={() => { setDeleteTarget(""); setShowDeleteModal(true); }} disabled={isLeader && !currentTeam} style={{ 
            flex: isMobile ? 1 : "initial",
            justifyContent: "center",
            background: "rgba(239, 68, 68, 0.08)", 
            color: "var(--danger)", 
            border: "1px solid rgba(239, 68, 68, 0.16)" 
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>person_remove</span>
            Xóa
          </button>
        </div>
      </header>

      <div className="glass-card" style={{ marginBottom: 32, padding: isMobile ? 16 : 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
          <div>
            <h3 style={{ fontSize: isMobile ? 16 : 18, fontWeight: 800, color: "var(--text-main)", marginBottom: 4 }}>
              {isLeader ? "Điều phối team" : "Thông tin team"}
            </h3>
          </div>
          {isLeader && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", width: isMobile ? "100%" : "auto" }}>
              <button className="btn-ios-pill btn-ios-secondary" style={{ flex: isMobile ? 1 : "initial", justifyContent: "center" }} onClick={() => setShowTeamModal(true)}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>group_add</span>
                Tạo team
              </button>
              <button
                className="btn-ios-pill"
                style={{ 
                  flex: isMobile ? 1 : "initial",
                  justifyContent: "center",
                  background: "rgba(37, 99, 235, 0.08)", 
                  color: "var(--accent-blue)", 
                  border: "1px solid rgba(37, 99, 235, 0.16)" 
                }}
                onClick={() => {
                  setTransferTargetUserId(transferCandidateOptions[0]?.value || "");
                  setShowTransferModal(true);
                }}
                disabled={!currentTeam || transferCandidateOptions.length === 0}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>swap_horiz</span>
                Bàn giao
              </button>
            </div>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
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

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(auto-fit, minmax(200px, 1fr))", gap: isMobile ? 12 : 24, marginBottom: 40 }}>
        {[
          { label: "Tổng", value: collaborators.length, icon: "groups", color: "var(--accent-blue)" },
          { label: "Writer", value: writers.length, icon: "edit_note", color: "var(--accent-teal)" },
          { label: "Reviewer", value: reviewers.length, icon: "verified", color: "var(--accent-purple)" },
          { label: "Admin", value: adminProfiles.length, icon: "shield_person", color: "var(--accent-orange)" }
        ].map((s, i) => (
          <div key={i} className="glass-card" style={{ display: "flex", alignItems: "center", gap: isMobile ? 12 : 20, padding: isMobile ? 16 : 24 }}>
            <div style={{ width: isMobile ? 40 : 48, height: isMobile ? 40 : 48, borderRadius: isMobile ? 10 : 14, background: `${s.color}15`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span className="material-symbols-outlined" style={{ fontSize: isMobile ? 20 : 24, color: s.color }}>{s.icon}</span>
            </div>
            <div>
              <p style={{ fontSize: isMobile ? 10 : 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>{s.label}</p>
              <p style={{ fontSize: isMobile ? 20 : 24, fontWeight: 800, color: "var(--text-main)" }}>{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="glass-card" style={{ padding: 0, overflow: "hidden", marginBottom: 32 }}>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.02)" }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text-main)" }}>✍️ Cộng tác viên viết bài ({writers.length})</h3>
        </div>
        {!isMobile ? (
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
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {writers.map((c) => (
              <div key={c.id} style={{ padding: 16, borderBottom: "1px solid var(--glass-border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-main)" }}>{c.name}</div>
                    <div style={{ fontSize: 13, color: "var(--accent-blue)", fontWeight: 600, marginTop: 2 }}>{c.penName}</div>
                  </div>
                  <button className="btn-ios-pill btn-ios-secondary" style={{ padding: "6px 12px" }} onClick={() => openEditModal(c)}>
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>edit</span>
                  </button>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 14, color: "var(--text-muted)" }}>mail</span>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{c.email || "Chưa có email"}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", justifyContent: "space-between", marginTop: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>KPI:</span>
                      <span style={{ fontSize: 12, fontWeight: 800, color: "var(--accent-blue)" }}>{c.kpiStandard}</span>
                    </div>
                    <span style={statusBadgeStyle(c.status)}>{c.status === "active" ? "Hoạt động" : "Tạm nghỉ"}</span>
                  </div>
                </div>
              </div>
            ))}
            {writers.length === 0 && (
              <div style={{ padding: 32, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>Chưa có cộng tác viên viết bài</div>
            )}
          </div>
        )}
      </div>

      <div className="glass-card" style={{ padding: 0, overflow: "hidden", marginBottom: 32 }}>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.02)" }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text-main)" }}>✅ Cộng tác viên duyệt ({reviewers.length})</h3>
        </div>
        {!isMobile ? (
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
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {reviewers.map((c) => (
              <div key={c.id} style={{ padding: 16, borderBottom: "1px solid var(--glass-border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-main)" }}>{c.name}</div>
                    <div style={{ fontSize: 13, color: "var(--accent-purple)", fontWeight: 600, marginTop: 2 }}>{c.penName}</div>
                  </div>
                  <button className="btn-ios-pill btn-ios-secondary" style={{ padding: "6px 12px" }} onClick={() => openEditModal(c)}>
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>edit</span>
                  </button>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 14, color: "var(--text-muted)" }}>mail</span>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{c.email || "Chưa có email"}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", justifyContent: "space-between", marginTop: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>KPI:</span>
                      <span style={{ fontSize: 12, fontWeight: 800, color: "var(--accent-purple)" }}>{c.kpiStandard}</span>
                    </div>
                    <span style={statusBadgeStyle(c.status)}>{c.status === "active" ? "Hoạt động" : "Tạm nghỉ"}</span>
                  </div>
                </div>
              </div>
            ))}
            {reviewers.length === 0 && (
              <div style={{ padding: 32, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>Chưa có cộng tác viên duyệt bài</div>
            )}
          </div>
        )}
      </div>

      <div className="glass-card" style={{ padding: 0, overflow: "hidden", marginBottom: isMobile ? 80 : 0 }}>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.02)", display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text-main)" }}>📋 Admin team ({adminProfiles.length})</h3>
            <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
              Mã nhân viên này sẽ được dùng cho KPI Content và form đăng ký nội bộ của admin/leader.
            </div>
          </div>
          {currentAdminProfile ? (
            <button className="btn-ios-pill btn-ios-secondary" style={{ padding: "6px 12px" }} onClick={() => openEmployeeCodeModal(currentAdminProfile)}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>badge</span>
              {currentAdminProfile.employeeCode ? "Sửa mã NV" : "Thêm mã NV"}
            </button>
          ) : null}
        </div>
        {!isMobile ? (
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
                        {admin.isLeader && (
                          <span style={{ padding: "4px 8px", borderRadius: 999, background: "rgba(249, 115, 22, 0.12)", color: "var(--accent-orange)", fontSize: 11, fontWeight: 800 }}>
                            LEADER
                          </span>
                        )}
                        {admin.isOwner && (
                          <span style={{ padding: "4px 8px", borderRadius: 999, background: "rgba(37, 99, 235, 0.1)", color: "var(--accent-blue)", fontSize: 11, fontWeight: 800 }}>
                            OWNER
                          </span>
                        )}
                      </div>
                      <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 8px", borderRadius: 999, background: "rgba(37, 99, 235, 0.08)", color: "var(--accent-blue)", fontSize: 11, fontWeight: 800 }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>badge</span>
                          {admin.employeeCode || "Chưa có mã"}
                        </span>
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
                        <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>Quản trị hệ thống</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {adminProfiles.map((admin) => (
              <div key={admin.id} style={{ padding: 16, borderBottom: "1px solid var(--glass-border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text-main)" }}>{admin.name}</span>
                      {admin.isLeader && (
                        <span style={{ padding: "2px 6px", borderRadius: 6, background: "rgba(249, 115, 22, 0.12)", color: "var(--accent-orange)", fontSize: 9, fontWeight: 800 }}>LEADER</span>
                      )}
                      {admin.isOwner && (
                        <span style={{ padding: "2px 6px", borderRadius: 6, background: "rgba(37, 99, 235, 0.1)", color: "var(--accent-blue)", fontSize: 9, fontWeight: 800 }}>OWNER</span>
                      )}
                    </div>
                    <div style={{ fontSize: 13, color: "var(--accent-orange)", fontWeight: 600, marginTop: 2 }}>{admin.penName}</div>
                  </div>
                  {admin.collaboratorId ? (
                    <button className="btn-ios-pill btn-ios-secondary" style={{ padding: "6px 12px" }} onClick={() => {
                      const collaborator = collaborators.find((item) => item.id === admin.collaboratorId);
                      if (collaborator) openEditModal(collaborator);
                    }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>edit</span>
                    </button>
                  ) : (
                    <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600, padding: "4px 8px", background: "#f1f5f9", borderRadius: 8 }}>Hệ thống</span>
                  )}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 14, color: "var(--text-muted)" }}>mail</span>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{admin.email || "—"}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", justifyContent: "space-between", marginTop: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>KPI:</span>
                      <span style={{ fontSize: 12, fontWeight: 800, color: "var(--accent-orange)" }}>{admin.kpiStandard ?? "ADMIN"}</span>
                    </div>
                    <span style={statusBadgeStyle(admin.status)}>{admin.status === "active" ? "Hoạt động" : "Tạm nghỉ"}</span>
                  </div>
                </div>
              </div>
            ))}
            {adminProfiles.length === 0 && (
              <div style={{ padding: 32, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>Chưa có tài khoản admin team</div>
            )}
          </div>
        )}
      </div>

      {!isMobile ? (
        showModal && (
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
                <div className="grid-3" style={{ marginBottom: 0 }}>
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
        )
      ) : (
        <BottomSheet isOpen={showModal} onClose={closeModal} title={formData.id ? "Thông tin thành viên" : "Thêm cộng tác viên"}>
          <div style={{ padding: "0 4px 40px 4px" }}>
            {formError && (
              <div style={{ marginBottom: 20, padding: 12, borderRadius: 12, background: "var(--danger-light)", color: "var(--danger)", fontSize: 13, fontWeight: 600 }}>
                {formError}
              </div>
            )}
            <div className="form-group">
              <label className="form-label">Họ và tên *</label>
              <input className="form-input" value={formData.name || ""} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="Nguyễn Văn A" />
            </div>
            <div className="form-group">
              <label className="form-label">Bút danh *</label>
              <input className="form-input" value={formData.penName || ""} onChange={e => setFormData({ ...formData, penName: e.target.value })} placeholder="Bút danh" />
            </div>
            <div className="form-group">
              <label className="form-label">Email tài khoản</label>
              <input className="form-input" type="email" value={formData.email || ""} onChange={e => setFormData({ ...formData, email: e.target.value })} placeholder="ctv@email.com" />
            </div>
            <div className="form-group">
              <label className="form-label">Vai trò hệ thống</label>
              {currentLinkedUserIsAdmin ? (
                <input className="form-input" value={currentLinkedUser?.isLeader ? "Leader hệ thống" : "Admin team"} readOnly style={{ background: "rgba(255,255,255,0.01)", opacity: 0.75 }} />
              ) : (
                <CustomSelect
                  value={(formData.role || "writer") as Collaborator["role"]}
                  onChange={(value) => setFormData({ ...formData, role: value as Collaborator["role"] })}
                  options={roleOptions}
                />
              )}
            </div>

            {formData.id && (
              <div style={{ marginBottom: 20, padding: 16, borderRadius: 16, border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.02)" }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8 }}>Liên kết tài khoản</div>
                <div style={{ fontSize: 13, color: "var(--text-main)", marginBottom: 12 }}>
                  {formData.linkedUserEmail || "Chưa liên kết tài khoản nào."}
                </div>
                {!currentLinkedUserIsAdmin && (
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Gán tài khản CTV</label>
                    <CustomSelect
                      value={String(formData.linkedUserId ?? "")}
                      onChange={(value) => setFormData({ ...formData, linkedUserId: value ? Number(value) : null })}
                      options={assignableUserOptions}
                    />
                  </div>
                )}
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="form-group">
                <label className="form-label">KPI (Tháng)</label>
                <input className="form-input" type="number" value={formData.kpiStandard || 25} onChange={e => setFormData({ ...formData, kpiStandard: Number(e.target.value) })} />
              </div>
              <div className="form-group">
                <label className="form-label">SĐT</label>
                <input className="form-input" value={formData.phone || ""} onChange={e => setFormData({ ...formData, phone: e.target.value })} placeholder="090..." />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Vị trí / Tiểu sử</label>
              <input className="form-input" value={formData.bio || ""} onChange={e => setFormData({ ...formData, bio: e.target.value })} placeholder="VD: Senior Writer" />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 16 }}>
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

            <div style={{ marginTop: 32, display: "flex", gap: 12 }}>
              <button className="btn-ios-pill btn-ios-secondary" style={{ flex: 1, justifyContent: "center" }} onClick={closeModal} disabled={isSaving}>Hủy</button>
              <button className="btn-ios-pill btn-ios-primary" style={{ flex: 2, justifyContent: "center" }} onClick={handleSave} disabled={isSaving}>
                {isSaving ? "Đang lưu..." : "Lưu thành viên"}
              </button>
            </div>
          </div>
        </BottomSheet>
      )}

      {!isMobile ? (
        showDeleteModal && (
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
        )
      ) : (
        <BottomSheet isOpen={showDeleteModal} onClose={() => setShowDeleteModal(false)} title="Xóa thành viên">
          <div style={{ padding: "0 4px 40px 4px" }}>
            <div style={{ marginBottom: 20, padding: 12, borderRadius: 12, border: "1px solid rgba(239, 68, 68, 0.18)", background: "rgba(239, 68, 68, 0.04)", fontSize: 13, color: "var(--danger)", fontWeight: 600 }}>
              ⚠️ Thao tác này sẽ xóa vĩnh viễn thành viên và các dữ liệu liên quan.
            </div>
            <div className="form-group">
              <label className="form-label">Thành viên cần xóa</label>
              <CustomSelect
                value={deleteTarget}
                onChange={setDeleteTarget}
                options={[
                  { value: "", label: "— Chọn thành viên —" },
                  ...deletableMembers.map((c) => ({
                    value: String(c.id),
                    label: `${c.penName} (${c.name})`,
                  })),
                ]}
                placeholder="Chọn thành viên"
              />
            </div>
            {deleteTarget && (() => {
              const target = collaborators.find((c) => c.id === Number(deleteTarget));
              if (!target) return null;
              return (
                <div style={{ padding: 16, borderRadius: 12, background: "rgba(0,0,0,0.02)", border: "1px solid var(--glass-border)", marginBottom: 24 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-main)", marginBottom: 8 }}>Thông tin xóa:</div>
                  <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
                    <div>👤 {target.name} ({target.penName})</div>
                    <div style={{ fontSize: 12, marginTop: 4 }}>Dữ liệu tài khoản, thông báo & bình luận sẽ mất sạch.</div>
                  </div>
                </div>
              );
            })()}
            <div style={{ display: "flex", gap: 12 }}>
              <button className="btn-ios-pill btn-ios-secondary" style={{ flex: 1, justifyContent: "center" }} onClick={() => setShowDeleteModal(false)} disabled={isDeleting}>Hủy</button>
              <button
                className="btn-ios-pill"
                onClick={executeDelete}
                disabled={!deleteTarget || isDeleting}
                style={{
                  flex: 2,
                  justifyContent: "center",
                  background: deleteTarget ? "var(--danger)" : "rgba(239, 68, 68, 0.3)",
                  color: "#fff", border: "none"
                }}
              >
                {isDeleting ? "Đang xóa..." : "Xác nhận xóa"}
              </button>
            </div>
          </div>
        </BottomSheet>
      )}

      {!isMobile ? (
        showTeamModal && (
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
        )
      ) : (
        <BottomSheet isOpen={showTeamModal} onClose={() => !teamSaving && closeTeamModal()} title="Tạo team mới">
          <div style={{ padding: "0 4px 40px 4px" }}>
            {teamError && (
              <div style={{ marginBottom: 20, padding: 12, borderRadius: 12, background: "var(--danger-light)", color: "var(--danger)", fontSize: 13, fontWeight: 600 }}>
                {teamError}
              </div>
            )}
            <div className="form-group">
              <label className="form-label">Tên team *</label>
              <input className="form-input" value={teamForm.name} onChange={(e) => setTeamForm({ ...teamForm, name: e.target.value })} placeholder="Tên team" />
            </div>
            <div className="form-group">
              <label className="form-label">Mô tả ngắn</label>
              <input className="form-input" value={teamForm.description} onChange={(e) => setTeamForm({ ...teamForm, description: e.target.value })} placeholder="Phụ trách team" />
            </div>

            <div style={{ margin: "24px 0 16px 0", padding: 16, borderRadius: 16, border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.02)", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
              💡 Tùy chọn: Nhập thông tin owner để tự động tạo tài khoản leader cho team mới.
            </div>

            <div className="form-group">
              <label className="form-label">Tên owner</label>
              <input className="form-input" value={teamForm.ownerName} onChange={(e) => setTeamForm({ ...teamForm, ownerName: e.target.value })} placeholder="Họ tên" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="form-group">
                <label className="form-label">Bút danh</label>
                <input className="form-input" value={teamForm.ownerPenName} onChange={(e) => setTeamForm({ ...teamForm, ownerPenName: e.target.value })} placeholder="Bút danh" />
              </div>
              <div className="form-group">
                <label className="form-label">Email owner</label>
                <input className="form-input" type="email" value={teamForm.ownerEmail} onChange={(e) => setTeamForm({ ...teamForm, ownerEmail: e.target.value })} placeholder="Email" />
              </div>
            </div>

            <div style={{ marginTop: 32, display: "flex", gap: 12 }}>
              <button className="btn-ios-pill btn-ios-secondary" style={{ flex: 1, justifyContent: "center" }} onClick={closeTeamModal} disabled={teamSaving}>Hủy</button>
              <button className="btn-ios-pill btn-ios-primary" style={{ flex: 2, justifyContent: "center" }} onClick={createTeam} disabled={teamSaving}>
                {teamSaving ? "Đang tạo..." : "Tạo team"}
              </button>
            </div>
          </div>
        </BottomSheet>
      )}

      {!isMobile ? (
        showTransferModal && (
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
        )
      ) : (
        <BottomSheet isOpen={showTransferModal} onClose={() => !transferring && closeTransferModal()} title="Bàn giao owner team">
          <div style={{ padding: "0 4px 40px 4px" }}>
            <div style={{ marginBottom: 20, padding: 16, borderRadius: 16, border: "1px solid rgba(37, 99, 235, 0.16)", background: "rgba(37, 99, 235, 0.05)", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
              {currentTeam ? `Bàn giao team ${currentTeam.name}.` : "Chọn team."} Tài khoản nhận sẽ là admin team mới.
            </div>
            <div className="form-group">
              <label className="form-label">Tài khoản nhận bàn giao</label>
              <CustomSelect
                value={transferTargetUserId}
                onChange={setTransferTargetUserId}
                options={[
                  { value: "", label: "— Chọn tài khoản —" },
                  ...transferCandidateOptions,
                ]}
                placeholder="Chọn người nhận"
              />
            </div>
            {transferCandidateOptions.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--danger)", padding: "8px 0" }}>
                Team chưa có tài khoản đủ điều kiện nhận bàn giao.
              </div>
            )}
            <div style={{ marginTop: 32, display: "flex", gap: 12 }}>
              <button className="btn-ios-pill btn-ios-secondary" style={{ flex: 1, justifyContent: "center" }} onClick={closeTransferModal} disabled={transferring}>Hủy</button>
              <button className="btn-ios-pill btn-ios-primary" style={{ flex: 2, justifyContent: "center" }} onClick={transferTeamOwner} disabled={!transferTargetUserId || transferring}>
                {transferring ? "Đang xử lý..." : "Xác nhận"}
              </button>
            </div>
          </div>
        </BottomSheet>
      )}

      {!isMobile ? (
        showEmployeeCodeModal && (
          <div className="modal-overlay" onClick={() => !employeeCodeSaving && closeEmployeeCodeModal()}>
            <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
              <div className="modal-header">
                <h3 className="modal-title">Mã nhân viên KPI Content</h3>
                <button className="modal-close" onClick={() => !employeeCodeSaving && closeEmployeeCodeModal()}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
                </button>
              </div>
              <div className="modal-body">
                {employeeCodeError && (
                  <div style={{ marginBottom: 20, padding: "12px 16px", borderRadius: 12, border: "1px solid rgba(239, 68, 68, 0.18)", background: "var(--danger-light)", color: "var(--danger)", fontSize: 13, fontWeight: 600, lineHeight: 1.5 }}>
                    {employeeCodeError}
                  </div>
                )}
                <div style={{ marginBottom: 16, padding: 16, borderRadius: 16, border: "1px solid rgba(37, 99, 235, 0.16)", background: "rgba(37, 99, 235, 0.05)", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.7 }}>
                  Mã nhân viên này sẽ được dùng để tự điền vào form KPI Content và đồng bộ với workflow Google Form.
                </div>
                <div className="form-group">
                  <label className="form-label">Tài khoản</label>
                  <input className="form-input" value={employeeCodeForm.displayName || employeeCodeForm.email} readOnly />
                </div>
                <div className="form-group">
                  <label className="form-label">Mã nhân viên *</label>
                  <input
                    className="form-input"
                    value={employeeCodeForm.employeeCode}
                    onChange={(event) => {
                      setEmployeeCodeForm((current) => ({ ...current, employeeCode: event.target.value }));
                      if (employeeCodeError) setEmployeeCodeError("");
                    }}
                    placeholder="NhanND18"
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn-ios-pill btn-ios-secondary" onClick={closeEmployeeCodeModal} disabled={employeeCodeSaving}>Hủy bỏ</button>
                <button className="btn-ios-pill btn-ios-primary" onClick={saveEmployeeCode} disabled={employeeCodeSaving}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>save</span>
                  {employeeCodeSaving ? "Đang lưu..." : "Lưu mã nhân viên"}
                </button>
              </div>
            </div>
          </div>
        )
      ) : (
        <BottomSheet isOpen={showEmployeeCodeModal} onClose={() => !employeeCodeSaving && closeEmployeeCodeModal()} title="Mã nhân viên KPI Content">
          <div style={{ padding: "0 4px 40px 4px" }}>
            {employeeCodeError && (
              <div style={{ marginBottom: 20, padding: 12, borderRadius: 12, background: "var(--danger-light)", color: "var(--danger)", fontSize: 13, fontWeight: 600 }}>
                {employeeCodeError}
              </div>
            )}
            <div style={{ marginBottom: 16, padding: 16, borderRadius: 16, border: "1px solid rgba(37, 99, 235, 0.16)", background: "rgba(37, 99, 235, 0.05)", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
              Mã nhân viên này sẽ được dùng để tự điền vào form KPI Content.
            </div>
            <div className="form-group">
              <label className="form-label">Tài khoản</label>
              <input className="form-input" value={employeeCodeForm.displayName || employeeCodeForm.email} readOnly />
            </div>
            <div className="form-group">
              <label className="form-label">Mã nhân viên *</label>
              <input
                className="form-input"
                value={employeeCodeForm.employeeCode}
                onChange={(event) => {
                  setEmployeeCodeForm((current) => ({ ...current, employeeCode: event.target.value }));
                  if (employeeCodeError) setEmployeeCodeError("");
                }}
                placeholder="NhanND18"
              />
            </div>
            <div style={{ marginTop: 32, display: "flex", gap: 12 }}>
              <button className="btn-ios-pill btn-ios-secondary" style={{ flex: 1, justifyContent: "center" }} onClick={closeEmployeeCodeModal} disabled={employeeCodeSaving}>Hủy</button>
              <button className="btn-ios-pill btn-ios-primary" style={{ flex: 2, justifyContent: "center" }} onClick={saveEmployeeCode} disabled={employeeCodeSaving}>
                {employeeCodeSaving ? "Đang lưu..." : "Lưu mã nhân viên"}
              </button>
            </div>
          </div>
        </BottomSheet>
      )}
    </>
  );
}

/* ══════════════════════════ EDITORIAL TASKS ══════════════════════════ */
