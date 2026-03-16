"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CustomSelect from "./CustomSelect";
import { useRealtimeRefresh } from "./realtime";
import { useIsMobile } from "./useMediaQuery";
import type { KpiMemberRow, KpiResponseData } from "./types";

const monthNames = ["Tháng 1", "Tháng 2", "Tháng 3", "Tháng 4", "Tháng 5", "Tháng 6", "Tháng 7", "Tháng 8", "Tháng 9", "Tháng 10", "Tháng 11", "Tháng 12"];
const compactNumber = new Intl.NumberFormat("vi-VN");

type KpiDraftRecord = { penName: string; kpiStandard: number; evaluation: string | null };
type KpiRoleKey = "writer" | "reviewer";

type RoleDraftOverview = {
  monthlyTarget: number;
  assigned: number;
  actual: number;
  remaining: number;
  over: number;
  unassigned: number;
  overAssigned: number;
  completionPercentage: number;
};

function getRoleLabel(role: KpiRoleKey) {
  return role === "reviewer" ? "CTV duyệt bài" : "CTV viết bài";
}

function getRoleShortLabel(role: KpiRoleKey) {
  return role === "reviewer" ? "duyệt" : "viết";
}

function StatCard({ label, value, helper, tone }: { label: string; value: string; helper?: string; tone: "blue" | "green" | "orange" | "purple" }) {
  const backgroundMap = {
    blue: "linear-gradient(135deg, rgba(59,130,246,0.14), rgba(59,130,246,0.06))",
    green: "linear-gradient(135deg, rgba(16,185,129,0.14), rgba(16,185,129,0.06))",
    orange: "linear-gradient(135deg, rgba(249,115,22,0.14), rgba(249,115,22,0.06))",
    purple: "linear-gradient(135deg, rgba(168,85,247,0.14), rgba(168,85,247,0.06))",
  } as const;

  return (
    <div className="card" style={{ padding: 20, borderRadius: 24, border: "1px solid rgba(255,255,255,0.65)", background: backgroundMap[tone], boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)" }}>
      <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</p>
      <p style={{ margin: "10px 0 0", fontSize: 34, fontWeight: 900, letterSpacing: "-0.03em", color: "var(--text-main)" }}>{value}</p>
      {helper ? <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>{helper}</p> : null}
    </div>
  );
}

function RoleConfigCard({
  role,
  value,
  onChange,
  overview,
}: {
  role: KpiRoleKey;
  value: number;
  onChange: (nextValue: number) => void;
  overview: RoleDraftOverview;
}) {
  const tone = role === "reviewer" ? "rgba(249,115,22,0.1)" : "rgba(37,99,235,0.1)";
  return (
    <div className="card" style={{ padding: 20, borderRadius: 24, background: tone, border: "1px solid rgba(148, 163, 184, 0.16)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, marginBottom: 16 }}>
        <div>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>{getRoleLabel(role)}</p>
          <h3 style={{ margin: "10px 0 0", fontSize: 24, fontWeight: 900, color: "var(--text-main)" }}>KPI tổng tháng</h3>
        </div>
        <div style={{ minWidth: 130 }}>
          <input
            className="input"
            type="number"
            min={0}
            value={String(value)}
            onChange={(event) => onChange(Number(event.target.value || 0))}
            style={{ minWidth: 0, fontWeight: 800 }}
          />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
        <div style={{ padding: 14, borderRadius: 18, background: "rgba(255,255,255,0.72)" }}><p style={{ margin: 0, fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 800 }}>Đã phân</p><p style={{ margin: "8px 0 0", fontSize: 24, fontWeight: 900 }}>{compactNumber.format(overview.assigned)}</p></div>
        <div style={{ padding: 14, borderRadius: 18, background: "rgba(255,255,255,0.72)" }}><p style={{ margin: 0, fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 800 }}>Đã làm</p><p style={{ margin: "8px 0 0", fontSize: 24, fontWeight: 900 }}>{compactNumber.format(overview.actual)}</p></div>
        <div style={{ padding: 14, borderRadius: 18, background: "rgba(255,255,255,0.72)" }}><p style={{ margin: 0, fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 800 }}>Chưa phân bổ</p><p style={{ margin: "8px 0 0", fontSize: 24, fontWeight: 900, color: overview.unassigned > 0 ? "#2563eb" : "var(--text-main)" }}>{compactNumber.format(overview.unassigned)}</p></div>
        <div style={{ padding: 14, borderRadius: 18, background: "rgba(255,255,255,0.72)" }}><p style={{ margin: 0, fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 800 }}>Vượt phân bổ</p><p style={{ margin: "8px 0 0", fontSize: 24, fontWeight: 900, color: overview.overAssigned > 0 ? "#dc2626" : "var(--text-main)" }}>{compactNumber.format(overview.overAssigned)}</p></div>
      </div>
      <p style={{ margin: "14px 0 0", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
        Bạn có thể đặt về <strong>0</strong> nếu tháng này nhóm {getRoleShortLabel(role)} không cần chạy KPI. Hệ thống sẽ không cho tổng KPI phân cho từng người vượt quá KPI tháng đã đặt.
      </p>
    </div>
  );
}

function KpiRoleSection({
  title,
  role,
  rows,
  canManage,
  isMobile,
  draftTargets,
  draftEvaluations,
  onTargetChange,
  onEvaluationChange,
  onWarn,
  pendingWarnings,
  summary,
}: {
  title: string;
  role: KpiRoleKey;
  rows: KpiMemberRow[];
  canManage: boolean;
  isMobile: boolean;
  draftTargets: Record<string, number>;
  draftEvaluations: Record<string, string>;
  onTargetChange: (penName: string, nextValue: number) => void;
  onEvaluationChange: (penName: string, nextValue: string) => void;
  onWarn: (row: KpiMemberRow) => void;
  pendingWarnings: Record<string, boolean>;
  summary: KpiResponseData["writerSummary"];
}) {
  const emptyLabel = role === "reviewer" ? "Chưa có CTV duyệt nào trong kỳ này." : "Chưa có CTV viết nào trong kỳ này.";

  return (
    <section className="card" style={{ padding: isMobile ? 18 : 24, borderRadius: 28 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 28, fontWeight: 900, color: "var(--text-main)" }}>{title}</h2>
          <p style={{ margin: "8px 0 0", fontSize: 14, color: "var(--text-muted)" }}>{canManage ? `Bạn có thể chỉnh KPI và gửi cảnh báo cho nhóm ${getRoleShortLabel(role)}.` : `Đây là tiến độ KPI của nhóm ${getRoleShortLabel(role)} trong tháng đang xem.`}</p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, minWidth: isMobile ? "100%" : 320 }}>
          <div style={{ padding: "12px 14px", borderRadius: 16, background: "rgba(15, 23, 42, 0.03)", border: "1px solid rgba(148, 163, 184, 0.14)" }}><p style={{ margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>KPI tháng</p><p style={{ margin: "8px 0 0", fontSize: 22, fontWeight: 900 }}>{compactNumber.format(summary.totalMonthlyTarget)}</p></div>
          <div style={{ padding: "12px 14px", borderRadius: 16, background: "rgba(15, 23, 42, 0.03)", border: "1px solid rgba(148, 163, 184, 0.14)" }}><p style={{ margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>Hoàn thành</p><p style={{ margin: "8px 0 0", fontSize: 22, fontWeight: 900 }}>{summary.completionPercentage}%</p></div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div style={{ padding: 20, borderRadius: 22, border: "1px dashed rgba(148, 163, 184, 0.28)", color: "var(--text-muted)", textAlign: "center" }}>{emptyLabel}</div>
      ) : isMobile ? (
        <div style={{ display: "grid", gap: 14 }}>
          {rows.map((row) => {
            const canWarn = canManage && row.status === "active" && row.remainingKpi > 0;
            const warningDisabled = !row.linkedUserId;
            return (
              <div key={row.penName} style={{ border: "1px solid rgba(148, 163, 184, 0.18)", borderRadius: 22, padding: 16, background: "rgba(255,255,255,0.7)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "var(--text-main)" }}>{row.name}</h3>
                    <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--text-muted)" }}>{row.penName} • {row.status === "active" ? "Đang hoạt động" : "Đang tạm nghỉ"}</p>
                  </div>
                  <span style={{ padding: "8px 10px", borderRadius: 999, background: row.completionPercentage >= 100 ? "rgba(16,185,129,0.12)" : "rgba(59,130,246,0.12)", color: row.completionPercentage >= 100 ? "#059669" : "#2563eb", fontSize: 12, fontWeight: 800 }}>{row.completionPercentage}%</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, marginTop: 14 }}>
                  <div><strong>KPI:</strong> {compactNumber.format(row.targetKpi)}</div>
                  <div><strong>Đã làm:</strong> {compactNumber.format(row.actualKpi)}</div>
                  <div><strong>Còn lại:</strong> {compactNumber.format(row.remainingKpi)}</div>
                  <div><strong>Vượt:</strong> {compactNumber.format(row.overKpi)}</div>
                </div>
                {canManage ? (
                  <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
                    <input type="number" min={0} value={String(draftTargets[row.penName] ?? row.targetKpi)} onChange={(event) => onTargetChange(row.penName, Number(event.target.value || 0))} className="input" placeholder="KPI tháng" />
                    <input value={draftEvaluations[row.penName] ?? row.evaluation ?? ""} onChange={(event) => onEvaluationChange(row.penName, event.target.value)} className="input" placeholder="Đánh giá / ghi chú" />
                    {canWarn ? <button className="btn-ios-pill" style={{ background: warningDisabled ? "rgba(148,163,184,0.12)" : "rgba(249,115,22,0.12)", color: warningDisabled ? "var(--text-muted)" : "#c2410c", border: "1px solid rgba(249,115,22,0.18)" }} disabled={warningDisabled || pendingWarnings[row.penName]} onClick={() => onWarn(row)}>{warningDisabled ? "Chưa liên kết tài khoản" : pendingWarnings[row.penName] ? "Đang gửi cảnh báo..." : "Cảnh báo"}</button> : null}
                  </div>
                ) : (
                  <p style={{ margin: "14px 0 0", fontSize: 13, color: "var(--text-muted)" }}>{row.evaluation || "Chưa có đánh giá từ leader/admin."}</p>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ overflowX: "auto" }} className="custom-scrollbar">
          <table className="w-full" style={{ minWidth: 1100, borderCollapse: "separate", borderSpacing: 0 }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                {["CTV", "Tổng KPI", "Đã làm", "Còn lại", "Vượt", "Tiến độ", "Đánh giá", "Cảnh báo"].map((column) => (
                  <th key={column} style={{ padding: "14px 12px", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", borderBottom: "1px solid rgba(148, 163, 184, 0.18)" }}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const canWarn = canManage && row.status === "active" && row.remainingKpi > 0;
                const warningDisabled = !row.linkedUserId;
                return (
                  <tr key={row.penName} style={{ background: row.remainingKpi > 0 ? "rgba(255,255,255,0.72)" : "transparent" }}>
                    <td style={{ padding: "16px 12px", borderBottom: "1px solid rgba(148, 163, 184, 0.12)" }}>
                      <div style={{ fontWeight: 800, color: "var(--text-main)" }}>{row.name}</div>
                      <div style={{ marginTop: 4, fontSize: 12, color: "var(--text-muted)" }}>{row.penName} • {row.status === "active" ? "Đang hoạt động" : "Tạm nghỉ"}</div>
                    </td>
                    <td style={{ padding: "16px 12px", borderBottom: "1px solid rgba(148, 163, 184, 0.12)" }}>{canManage ? <input type="number" min={0} value={String(draftTargets[row.penName] ?? row.targetKpi)} onChange={(event) => onTargetChange(row.penName, Number(event.target.value || 0))} className="input" style={{ minWidth: 120 }} /> : <strong>{compactNumber.format(row.targetKpi)}</strong>}</td>
                    <td style={{ padding: "16px 12px", borderBottom: "1px solid rgba(148, 163, 184, 0.12)", fontWeight: 800, color: "#059669" }}>{compactNumber.format(row.actualKpi)}</td>
                    <td style={{ padding: "16px 12px", borderBottom: "1px solid rgba(148, 163, 184, 0.12)", fontWeight: 700, color: row.remainingKpi > 0 ? "#c2410c" : "var(--text-main)" }}>{compactNumber.format(row.remainingKpi)}</td>
                    <td style={{ padding: "16px 12px", borderBottom: "1px solid rgba(148, 163, 184, 0.12)", fontWeight: 700, color: row.overKpi > 0 ? "#7c3aed" : "var(--text-muted)" }}>{compactNumber.format(row.overKpi)}</td>
                    <td style={{ padding: "16px 12px", borderBottom: "1px solid rgba(148, 163, 184, 0.12)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ flex: 1, minWidth: 120, height: 10, borderRadius: 999, background: "rgba(148, 163, 184, 0.16)", overflow: "hidden" }}>
                          <div style={{ width: `${Math.max(6, Math.min(row.completionPercentage, 100))}%`, height: "100%", borderRadius: 999, background: row.completionPercentage >= 100 ? "linear-gradient(90deg, #10b981, #22c55e)" : "linear-gradient(90deg, #2563eb, #8b5cf6)" }} />
                        </div>
                        <span style={{ minWidth: 48, fontSize: 13, fontWeight: 800, color: "var(--text-main)" }}>{row.completionPercentage}%</span>
                      </div>
                    </td>
                    <td style={{ padding: "16px 12px", borderBottom: "1px solid rgba(148, 163, 184, 0.12)" }}>{canManage ? <input value={draftEvaluations[row.penName] ?? row.evaluation ?? ""} onChange={(event) => onEvaluationChange(row.penName, event.target.value)} className="input" placeholder="Đánh giá / ghi chú" /> : <span style={{ color: "var(--text-muted)" }}>{row.evaluation || "—"}</span>}</td>
                    <td style={{ padding: "16px 12px", borderBottom: "1px solid rgba(148, 163, 184, 0.12)", minWidth: 180 }}>
                      {canWarn ? (
                        <button className="btn-ios-pill" style={{ background: warningDisabled ? "rgba(148,163,184,0.12)" : "rgba(249,115,22,0.12)", color: warningDisabled ? "var(--text-muted)" : "#c2410c", border: "1px solid rgba(249,115,22,0.18)" }} disabled={warningDisabled || pendingWarnings[row.penName]} onClick={() => onWarn(row)}>
                          {warningDisabled ? "Chưa liên kết" : pendingWarnings[row.penName] ? "Đang gửi..." : "Cảnh báo"}
                        </button>
                      ) : (
                        <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 700 }}>{row.remainingKpi > 0 ? "Đang tạm nghỉ" : "Đã hoàn thành"}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function KpiPage() {
  const isMobile = useIsMobile();
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState<KpiResponseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [draftTargets, setDraftTargets] = useState<Record<string, number>>({});
  const [draftEvaluations, setDraftEvaluations] = useState<Record<string, string>>({});
  const [draftMonthlyTargets, setDraftMonthlyTargets] = useState<{ writer: number; reviewer: number }>({ writer: 0, reviewer: 0 });
  const [pendingWarnings, setPendingWarnings] = useState<Record<string, boolean>>({});
  const refreshTimeoutRef = useRef<number | null>(null);
  const yearOptions = Array.from({ length: 5 }, (_, index) => new Date().getFullYear() - 2 + index).map((item) => ({ value: String(item), label: String(item) }));
  const monthOptions = monthNames.map((item, index) => ({ value: String(index + 1), label: item }));

  const allRows = useMemo(() => data ? [...data.writerRows, ...data.reviewerRows] : [], [data]);

  const fetchKpi = useCallback((showLoading = true) => {
    if (showLoading) setLoading(true);
    setError("");
    return fetch(`/api/kpi?month=${month}&year=${year}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.success === false) throw new Error(payload?.error || "Không thể tải dữ liệu KPI");
        return payload;
      })
      .then((payload) => {
        const nextData = payload?.data || null;
        setData(nextData);
        const rows = [...(nextData?.writerRows || []), ...(nextData?.reviewerRows || [])] as KpiMemberRow[];
        setDraftTargets(Object.fromEntries(rows.map((row) => [row.penName, row.targetKpi])));
        setDraftEvaluations(Object.fromEntries(rows.map((row) => [row.penName, row.evaluation || ""])));
        setDraftMonthlyTargets({ writer: Number(nextData?.monthlyTargets?.writer || 0), reviewer: Number(nextData?.monthlyTargets?.reviewer || 0) });
        setPendingWarnings({});
        setLoading(false);
      })
      .catch((fetchError: unknown) => {
        setData(null);
        setError(fetchError instanceof Error ? fetchError.message : "Không thể tải dữ liệu KPI");
        setLoading(false);
      });
  }, [month, year]);

  useEffect(() => {
    void fetchKpi(true);
  }, [fetchKpi]);

  useRealtimeRefresh(["kpi", "team", "articles", "notifications"], () => {
    if (refreshTimeoutRef.current) return;
    refreshTimeoutRef.current = window.setTimeout(() => {
      refreshTimeoutRef.current = null;
      void fetchKpi(false);
    }, 1200);
  });

  useEffect(() => () => {
    if (refreshTimeoutRef.current) window.clearTimeout(refreshTimeoutRef.current);
  }, []);

  const changedRecords = useMemo<KpiDraftRecord[]>(() => {
    if (!data?.canManage) return [];
    return allRows.reduce<KpiDraftRecord[]>((records, row) => {
      const nextTarget = Math.max(0, Number(draftTargets[row.penName] ?? row.targetKpi));
      const nextEvaluation = String(draftEvaluations[row.penName] ?? row.evaluation ?? "").trim();
      if (nextTarget === row.targetKpi && nextEvaluation === String(row.evaluation || "").trim()) return records;
      records.push({ penName: row.penName, kpiStandard: nextTarget, evaluation: nextEvaluation || null });
      return records;
    }, []);
  }, [allRows, data?.canManage, draftEvaluations, draftTargets]);

  const monthlyTargetsChanged = useMemo(() => {
    if (!data?.canManage) return false;
    return Number(draftMonthlyTargets.writer) !== Number(data.monthlyTargets.writer)
      || Number(draftMonthlyTargets.reviewer) !== Number(data.monthlyTargets.reviewer);
  }, [data?.canManage, data?.monthlyTargets.reviewer, data?.monthlyTargets.writer, draftMonthlyTargets.reviewer, draftMonthlyTargets.writer]);

  const draftRoleOverview = useMemo(() => {
    const buildOverview = (role: KpiRoleKey): RoleDraftOverview => {
      const rows = allRows.filter((row) => row.role === role);
      const assigned = rows.reduce((sum, row) => sum + Math.max(0, Number(draftTargets[row.penName] ?? row.targetKpi)), 0);
      const actual = rows.reduce((sum, row) => sum + row.actualKpi, 0);
      const remaining = rows.reduce((sum, row) => sum + Math.max(Math.max(0, Number(draftTargets[row.penName] ?? row.targetKpi)) - row.actualKpi, 0), 0);
      const over = rows.reduce((sum, row) => sum + Math.max(row.actualKpi - Math.max(0, Number(draftTargets[row.penName] ?? row.targetKpi)), 0), 0);
      const monthlyTarget = Math.max(0, Number(draftMonthlyTargets[role] || 0));
      const comparisonBase = monthlyTarget > 0 ? monthlyTarget : assigned;
      return {
        monthlyTarget,
        assigned,
        actual,
        remaining,
        over,
        unassigned: Math.max(monthlyTarget - assigned, 0),
        overAssigned: Math.max(assigned - monthlyTarget, 0),
        completionPercentage: comparisonBase > 0 ? Math.round((actual / comparisonBase) * 100) : (actual > 0 ? 100 : 0),
      };
    };

    return {
      writer: buildOverview("writer"),
      reviewer: buildOverview("reviewer"),
    } as const;
  }, [allRows, draftMonthlyTargets, draftTargets]);

  const hasUnsavedChanges = changedRecords.length > 0 || monthlyTargetsChanged;

  const handleSave = async () => {
    if (!data?.canManage || !hasUnsavedChanges) return;
    if (draftRoleOverview.writer.overAssigned > 0 || draftRoleOverview.reviewer.overAssigned > 0) {
      window.alert("❌ Tổng KPI phân cho từng thành viên đang vượt KPI tháng đã đặt. Vui lòng kiểm tra lại.");
      return;
    }

    try {
      setSaving(true);
      const response = await fetch("/api/kpi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month,
          year,
          teamId: data.teamId,
          records: changedRecords,
          monthlyTargets: draftMonthlyTargets,
        }),
      });
      const payload = await response.json().catch(() => ({ success: false, error: "Không thể đọc phản hồi từ máy chủ" }));
      if (!response.ok || payload.success === false) {
        window.alert(`❌ ${payload.error || "Không thể lưu KPI"}`);
        return;
      }
      window.alert("✅ Đã cập nhật KPI tháng thành công.");
      await fetchKpi(false);
    } catch {
      window.alert("❌ Không thể kết nối tới máy chủ.");
    } finally {
      setSaving(false);
    }
  };

  const handleWarn = async (row: KpiMemberRow) => {
    if (!data?.canManage || row.remainingKpi <= 0) return;
    const confirmed = window.confirm(`Gửi cảnh báo KPI cho ${row.name}?\nCTV này còn ${row.remainingKpi} ${row.role === "reviewer" ? "bài duyệt" : "bài viết"} để hoàn thành KPI.`);
    if (!confirmed) return;

    try {
      setPendingWarnings((current) => ({ ...current, [row.penName]: true }));
      const response = await fetch("/api/kpi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "warn", month, year, teamId: data.teamId, penName: row.penName }),
      });
      const payload = await response.json().catch(() => ({ success: false, error: "Không thể đọc phản hồi từ máy chủ" }));
      if (!response.ok || payload.success === false) {
        window.alert(`❌ ${payload.error || "Không thể gửi cảnh báo KPI"}`);
        return;
      }
      window.alert(`✅ ${payload.message || `Đã gửi cảnh báo KPI cho ${row.name}.`}`);
    } catch {
      window.alert("❌ Không thể kết nối tới máy chủ.");
    } finally {
      setPendingWarnings((current) => {
        const next = { ...current };
        delete next[row.penName];
        return next;
      });
    }
  };

  if (loading) return <div className="loading" style={{ padding: 60, fontSize: 18, color: "var(--accent-blue)" }}>⏳ Đang tải KPI tháng...</div>;

  if (!data) {
    return (
      <div className="card" style={{ padding: 28, borderRadius: 28 }}>
        <h2 style={{ margin: 0, fontSize: 28, fontWeight: 900, color: "var(--text-main)" }}>KPI</h2>
        <p style={{ margin: "10px 0 0", color: "var(--text-muted)", fontSize: 14 }}>{error || "Không thể tải dữ liệu KPI."}</p>
        <div style={{ marginTop: 18 }}><button className="btn-ios-pill btn-ios-primary" onClick={() => void fetchKpi(true)}>Tải lại</button></div>
      </div>
    );
  }

  const viewer = data.viewerSummary;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <section className="card" style={{ padding: isMobile ? 22 : 28, borderRadius: 30 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: isMobile ? 30 : 38, fontWeight: 950, letterSpacing: "-0.04em", color: "var(--text-main)" }}>KPI tháng</h1>
            <p style={{ margin: "10px 0 0", color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6 }}>{data.canManage ? "KPI thực tế được tính tự động theo toàn bộ bài của CTV trong tháng đang chọn. Bảng KPI đã được tách riêng cho nhóm viết và nhóm duyệt." : "Theo dõi KPI cá nhân trong tháng đang chọn."}</p>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
            <div style={{ minWidth: 150 }}><CustomSelect value={String(month)} onChange={(value) => setMonth(Number(value))} options={monthOptions} /></div>
            <div style={{ minWidth: 120 }}><CustomSelect value={String(year)} onChange={(value) => setYear(Number(value))} options={yearOptions} /></div>
            {data.canManage ? <button className="btn-ios-pill btn-ios-primary" onClick={handleSave} disabled={saving || !hasUnsavedChanges}>{saving ? "Đang lưu..." : hasUnsavedChanges ? "Lưu KPI tháng" : "Đã đồng bộ"}</button> : null}
          </div>
        </div>
      </section>

      {data.canManage ? (
        <section style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(4, minmax(0, 1fr))", gap: 16 }}>
          <StatCard label="Tổng KPI tháng" value={compactNumber.format(data.summary.totalMonthlyTarget)} tone="blue" helper="Tổng KPI đã đặt cho cả nhóm viết và duyệt." />
          <StatCard label="Đã phân cho thành viên" value={compactNumber.format(data.summary.totalAssignedKpi)} tone="purple" helper="Tổng KPI đang phân xuống từng CTV trong tháng." />
          <StatCard label="Đã hoàn thành" value={compactNumber.format(data.summary.totalActualKpi)} tone="green" helper="Số bài thực tế hiện có trong tháng." />
          <StatCard label="Còn thiếu" value={compactNumber.format(data.summary.totalRemainingKpi)} tone="orange" helper="Phần KPI còn thiếu để đạt chỉ tiêu cá nhân đã giao." />
        </section>
      ) : null}

      {viewer ? (
        <section className="card" style={{ padding: isMobile ? 20 : 24, borderRadius: 28, background: "linear-gradient(135deg, rgba(37,99,235,0.11), rgba(16,185,129,0.08), rgba(255,255,255,0.95))" }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: "var(--accent-blue)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Tiến độ của bạn</p>
          <h3 style={{ margin: "10px 0 0", fontSize: 28, fontWeight: 900, color: "var(--text-main)" }}>{viewer.name}</h3>
          <div style={{ marginTop: 16, height: 12, borderRadius: 999, background: "rgba(148, 163, 184, 0.16)", overflow: "hidden" }}><div style={{ width: `${Math.max(8, Math.min(viewer.completionPercentage, 100))}%`, height: "100%", borderRadius: 999, background: "linear-gradient(90deg, #2563eb, #10b981)" }} /></div>
          {!data.canManage ? (
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(0, 1fr))", gap: 14, marginTop: 18 }}>
              <div style={{ padding: 14, borderRadius: 18, background: "rgba(37,99,235,0.08)" }}><p style={{ margin: 0, fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: "var(--text-muted)" }}>KPI tháng</p><p style={{ margin: "8px 0 0", fontSize: 24, fontWeight: 900, color: "var(--text-main)" }}>{compactNumber.format(viewer.targetKpi)}</p></div>
              <div style={{ padding: 14, borderRadius: 18, background: "rgba(16,185,129,0.08)" }}><p style={{ margin: 0, fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: "var(--text-muted)" }}>Đã hoàn thành</p><p style={{ margin: "8px 0 0", fontSize: 24, fontWeight: 900, color: "var(--text-main)" }}>{compactNumber.format(viewer.actualKpi)}</p></div>
              <div style={{ padding: 14, borderRadius: 18, background: "rgba(249,115,22,0.08)" }}><p style={{ margin: 0, fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: "var(--text-muted)" }}>Còn lại</p><p style={{ margin: "8px 0 0", fontSize: 24, fontWeight: 900, color: "var(--text-main)" }}>{compactNumber.format(viewer.remainingKpi)}</p></div>
            </div>
          ) : null}
        </section>
      ) : null}

      {data.canManage ? (
        <section style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 16 }}>
          <RoleConfigCard role="writer" value={draftMonthlyTargets.writer} onChange={(nextValue) => setDraftMonthlyTargets((current) => ({ ...current, writer: Math.max(0, nextValue) }))} overview={draftRoleOverview.writer} />
          <RoleConfigCard role="reviewer" value={draftMonthlyTargets.reviewer} onChange={(nextValue) => setDraftMonthlyTargets((current) => ({ ...current, reviewer: Math.max(0, nextValue) }))} overview={draftRoleOverview.reviewer} />
        </section>
      ) : null}

      {(draftRoleOverview.writer.overAssigned > 0 || draftRoleOverview.reviewer.overAssigned > 0) && data.canManage ? (
        <div className="card" style={{ padding: 18, borderRadius: 22, border: "1px solid rgba(220, 38, 38, 0.16)", background: "rgba(254, 242, 242, 0.9)" }}>
          <p style={{ margin: 0, color: "#b91c1c", fontWeight: 800 }}>Tổng KPI đã phân đang vượt KPI tháng đã đặt.</p>
          <p style={{ margin: "8px 0 0", color: "#7f1d1d", fontSize: 14, lineHeight: 1.6 }}>Vui lòng giảm KPI từng thành viên hoặc tăng KPI tổng tháng trước khi lưu. Hệ thống sẽ chặn lưu để tránh lệch chỉ tiêu.</p>
        </div>
      ) : null}

      {data.canManage ? (
        <>
          <KpiRoleSection
            title="CTV viết bài"
            role="writer"
            rows={data.writerRows}
            canManage={data.canManage}
            isMobile={isMobile}
            draftTargets={draftTargets}
            draftEvaluations={draftEvaluations}
            onTargetChange={(penName, nextValue) => setDraftTargets((current) => ({ ...current, [penName]: Math.max(0, nextValue) }))}
            onEvaluationChange={(penName, nextValue) => setDraftEvaluations((current) => ({ ...current, [penName]: nextValue }))}
            onWarn={handleWarn}
            pendingWarnings={pendingWarnings}
            summary={data.writerSummary}
          />

          <KpiRoleSection
            title="CTV duyệt bài"
            role="reviewer"
            rows={data.reviewerRows}
            canManage={data.canManage}
            isMobile={isMobile}
            draftTargets={draftTargets}
            draftEvaluations={draftEvaluations}
            onTargetChange={(penName, nextValue) => setDraftTargets((current) => ({ ...current, [penName]: Math.max(0, nextValue) }))}
            onEvaluationChange={(penName, nextValue) => setDraftEvaluations((current) => ({ ...current, [penName]: nextValue }))}
            onWarn={handleWarn}
            pendingWarnings={pendingWarnings}
            summary={data.reviewerSummary}
          />
        </>
      ) : null}
    </div>
  );
}
