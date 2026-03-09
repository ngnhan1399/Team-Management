"use client";

import React, { useCallback, useEffect, useState } from "react";
import CustomSelect from "./CustomSelect";
import { useAuth } from "./auth-context";
import { useRealtimeRefresh } from "./realtime";
import type { Collaborator, EditorialTask } from "./types";
export default function EditorialTasksPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [tasks, setTasks] = useState<EditorialTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [taskSaving, setTaskSaving] = useState(false);
  const [sendingReminders, setSendingReminders] = useState(false);
  const [taskForm, setTaskForm] = useState<{
    id?: number;
    title: string;
    description: string;
    assigneePenName: string;
    dueDate: string;
    remindAt: string;
    status: EditorialTask["status"];
    priority: EditorialTask["priority"];
  }>({
    title: "",
    description: "",
    assigneePenName: "",
    dueDate: new Date().toISOString().split("T")[0],
    remindAt: "",
    status: "todo",
    priority: "medium",
  });

  const statusLabel: Record<EditorialTask["status"], string> = {
    todo: "Cần làm",
    in_progress: "Đang làm",
    done: "Hoàn thành",
    overdue: "Quá hạn",
  };
  const priorityLabel: Record<EditorialTask["priority"], string> = {
    low: "Thấp",
    medium: "Trung bình",
    high: "Cao",
  };
  const statusColor: Record<EditorialTask["status"], string> = {
    todo: "#3b82f6",
    in_progress: "#a855f7",
    done: "#10b981",
    overdue: "#ef4444",
  };
  const priorityColor: Record<EditorialTask["priority"], string> = {
    low: "#64748b",
    medium: "#f59e0b",
    high: "#ef4444",
  };

  const toLocalDateTimeInput = (iso: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const tzOffsetMs = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tzOffsetMs).toISOString().slice(0, 16);
  };

  const fetchTasks = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    fetch(`/api/editorial-tasks${params.toString() ? `?${params}` : ""}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setTasks(d.data || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [statusFilter]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    if (!isAdmin) return;
    fetch("/api/collaborators", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setCollaborators(d.data || []))
      .catch(() => { });
  }, [isAdmin]);

  useRealtimeRefresh(["tasks", "notifications"], fetchTasks);

  const openCreateModal = () => {
    setTaskForm({
      title: "",
      description: "",
      assigneePenName: "",
      dueDate: new Date().toISOString().split("T")[0],
      remindAt: "",
      status: "todo",
      priority: "medium",
    });
    setShowTaskModal(true);
  };

  const openEditModal = (task: EditorialTask) => {
    setTaskForm({
      id: task.id,
      title: task.title,
      description: task.description || "",
      assigneePenName: task.assigneePenName,
      dueDate: task.dueDate,
      remindAt: toLocalDateTimeInput(task.remindAt),
      status: task.status,
      priority: task.priority,
    });
    setShowTaskModal(true);
  };

  const saveTask = async () => {
    if (!taskForm.title || !taskForm.assigneePenName || !taskForm.dueDate) return;
    setTaskSaving(true);
    try {
      const payload = {
        id: taskForm.id,
        title: taskForm.title,
        description: taskForm.description || null,
        assigneePenName: taskForm.assigneePenName,
        dueDate: taskForm.dueDate,
        remindAt: taskForm.remindAt ? new Date(taskForm.remindAt).toISOString() : null,
        status: taskForm.status,
        priority: taskForm.priority,
      };
      const res = await fetch("/api/editorial-tasks", {
        method: taskForm.id ? "PUT" : "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.success) {
        alert("❌ " + (data.error || "Không lưu được task"));
        return;
      }
      setShowTaskModal(false);
      fetchTasks();
    } catch (error) {
      alert("❌ " + String(error));
    } finally {
      setTaskSaving(false);
    }
  };

  const updateTaskStatus = async (id: number, status: EditorialTask["status"]) => {
    try {
      const res = await fetch("/api/editorial-tasks", {
        method: "PUT",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      const data = await res.json();
      if (!data.success) {
        alert("❌ " + (data.error || "Không cập nhật được trạng thái"));
        return;
      }
      fetchTasks();
    } catch (error) {
      alert("❌ " + String(error));
    }
  };

  const triggerReminders = async () => {
    setSendingReminders(true);
    try {
      const res = await fetch("/api/editorial-tasks/reminders", { method: "POST", cache: "no-store" });
      const data = await res.json();
      if (!data.success) {
        alert("❌ " + (data.error || "Gửi nhắc việc thất bại"));
        return;
      }
      alert(`✅ Đã quét ${data.checked || 0} task, gửi ${data.notified || 0} thông báo.`);
      fetchTasks();
    } catch (error) {
      alert("❌ " + String(error));
    } finally {
      setSendingReminders(false);
    }
  };

  const pendingCount = tasks.filter((t) => t.status !== "done").length;

  return (
    <>
      <header style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h2 style={{ fontSize: 32, fontWeight: 800, color: "var(--text-main)", letterSpacing: "-0.04em" }}>Lịch biên tập</h2>
          <p style={{ color: "var(--text-muted)", marginTop: 4, fontSize: 14 }}>Theo dõi deadline, phân công và SLA theo cộng tác viên.</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {isAdmin && (
            <>
              <button className="btn-ios-pill btn-ios-secondary" onClick={triggerReminders} disabled={sendingReminders}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>alarm</span>
                {sendingReminders ? "Đang gửi..." : "Gửi nhắc việc"}
              </button>
              <button data-testid="tasks-create-button" className="btn-ios-pill btn-ios-primary" onClick={openCreateModal}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add_task</span>
                Tạo task
              </button>
            </>
          )}
        </div>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 24 }}>
        <div className="glass-card" style={{ padding: 20 }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>Tổng task</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "var(--text-main)" }}>{tasks.length}</div>
        </div>
        <div className="glass-card" style={{ padding: 20 }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>Đang mở</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "#3b82f6" }}>{pendingCount}</div>
        </div>
        <div className="glass-card" style={{ padding: 20 }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>Hoàn thành</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "#10b981" }}>{tasks.filter((t) => t.status === "done").length}</div>
        </div>
      </div>

      <div className="glass-card" style={{ padding: 20, marginBottom: 24 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ width: 220 }}>
            <label className="form-label">Lọc trạng thái</label>
            <CustomSelect
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "", label: "Tất cả" },
                { value: "todo", label: "Cần làm" },
                { value: "in_progress", label: "Đang làm" },
                { value: "done", label: "Hoàn thành" },
                { value: "overdue", label: "Quá hạn" },
              ]}
            />
          </div>
          <button className="btn-ios-pill btn-ios-primary" onClick={fetchTasks} style={{ height: 44, marginTop: 18 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>refresh</span>
            Tải lại
          </button>
        </div>
      </div>

      <div className="glass-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead style={{ background: "rgba(255,255,255,0.02)", borderBottom: "1px solid var(--glass-border)" }}>
              <tr>
                <th style={{ padding: "12px 20px", textAlign: "left", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Task</th>
                <th style={{ padding: "12px 20px", textAlign: "left", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Người nhận</th>
                <th style={{ padding: "12px 20px", textAlign: "center", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Deadline</th>
                <th style={{ padding: "12px 20px", textAlign: "center", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Ưu tiên</th>
                <th style={{ padding: "12px 20px", textAlign: "center", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Trạng thái</th>
                <th style={{ padding: "12px 20px", textAlign: "right", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>⏳ Đang tải task...</td>
                </tr>
              ) : tasks.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Không có task phù hợp.</td>
                </tr>
              ) : (
                tasks.map((t) => (
                  <tr key={t.id} data-testid={`task-row-${t.id}`} style={{ borderBottom: "1px solid var(--glass-border)" }}>
                    <td style={{ padding: "14px 20px" }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-main)" }}>{t.title}</div>
                      {t.description && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{t.description}</div>}
                      {t.remindAt && <div style={{ fontSize: 11, color: "var(--accent-orange)", marginTop: 6 }}>Nhắc lúc: {new Date(t.remindAt).toLocaleString("vi-VN")}</div>}
                    </td>
                    <td style={{ padding: "14px 20px", fontSize: 13, color: "var(--text-main)", fontWeight: 600 }}>{t.assigneePenName}</td>
                    <td style={{ padding: "14px 20px", textAlign: "center", fontSize: 13, color: "var(--text-main)" }}>{t.dueDate}</td>
                    <td style={{ padding: "14px 20px", textAlign: "center" }}>
                      <span style={{ display: "inline-block", padding: "4px 10px", borderRadius: 8, background: `${priorityColor[t.priority]}20`, color: priorityColor[t.priority], fontSize: 12, fontWeight: 700 }}>
                        {priorityLabel[t.priority]}
                      </span>
                    </td>
                    <td style={{ padding: "14px 20px", textAlign: "center" }}>
                      <span data-testid={`task-status-badge-${t.id}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 8, background: `${statusColor[t.status]}20`, color: statusColor[t.status], fontSize: 12, fontWeight: 700 }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>flag</span>
                        {statusLabel[t.status]}
                      </span>
                    </td>
                    <td style={{ padding: "14px 20px", textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                        <select data-testid={`task-status-${t.id}`} className="form-select" value={t.status} onChange={(e) => updateTaskStatus(t.id, e.target.value as EditorialTask["status"])} style={{ height: 34, fontSize: 12, minWidth: 140 }}>
                          <option value="todo">Cần làm</option>
                          <option value="in_progress">Đang làm</option>
                          <option value="done">Hoàn thành</option>
                          <option value="overdue">Quá hạn</option>
                        </select>
                        {isAdmin && (
                          <button className="btn-ios-pill btn-ios-secondary" style={{ padding: "6px 10px" }} onClick={() => openEditModal(t)}>
                            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>edit</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showTaskModal && isAdmin && (
        <div className="modal-overlay" onClick={() => setShowTaskModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">{taskForm.id ? "Cập nhật task biên tập" : "Tạo task biên tập"}</h3>
              <button className="modal-close" onClick={() => setShowTaskModal(false)}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Tiêu đề</label>
                <input className="form-input" value={taskForm.title} onChange={(e) => setTaskForm((prev) => ({ ...prev, title: e.target.value }))} placeholder="VD: Hoàn thiện loạt SEO tháng này" />
              </div>
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Người nhận</label>
                  <CustomSelect
                    value={taskForm.assigneePenName}
                    onChange={(v) => setTaskForm((prev) => ({ ...prev, assigneePenName: v }))}
                    options={[
                      { value: "", label: "Chọn CTV" },
                      ...collaborators.filter((c) => c.role === "writer").map((c) => ({ value: c.penName, label: c.penName })),
                    ]}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Deadline</label>
                  <input className="form-input" type="date" value={taskForm.dueDate} onChange={(e) => setTaskForm((prev) => ({ ...prev, dueDate: e.target.value }))} />
                </div>
              </div>
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Mức ưu tiên</label>
                  <CustomSelect
                    value={taskForm.priority}
                    onChange={(v) => setTaskForm((prev) => ({ ...prev, priority: v as EditorialTask["priority"] }))}
                    options={[
                      { value: "low", label: "Thấp" },
                      { value: "medium", label: "Trung bình" },
                      { value: "high", label: "Cao" },
                    ]}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Trạng thái</label>
                  <CustomSelect
                    value={taskForm.status}
                    onChange={(v) => setTaskForm((prev) => ({ ...prev, status: v as EditorialTask["status"] }))}
                    options={[
                      { value: "todo", label: "Cần làm" },
                      { value: "in_progress", label: "Đang làm" },
                      { value: "done", label: "Hoàn thành" },
                      { value: "overdue", label: "Quá hạn" },
                    ]}
                  />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Thời điểm nhắc việc (tuỳ chọn)</label>
                <input className="form-input" type="datetime-local" value={taskForm.remindAt} onChange={(e) => setTaskForm((prev) => ({ ...prev, remindAt: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Mô tả</label>
                <textarea className="form-input" rows={4} style={{ resize: "none", padding: 12 }} value={taskForm.description} onChange={(e) => setTaskForm((prev) => ({ ...prev, description: e.target.value }))} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-ios-pill btn-ios-secondary" onClick={() => setShowTaskModal(false)}>Đóng</button>
              <button className="btn-ios-pill btn-ios-primary" onClick={saveTask} disabled={taskSaving || !taskForm.title || !taskForm.assigneePenName}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>save</span>
                {taskSaving ? "Đang lưu..." : "Lưu task"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ══════════════════════════ ROYALTY ══════════════════════════ */
