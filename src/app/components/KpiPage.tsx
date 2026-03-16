"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CustomSelect from "./CustomSelect";
import { useAuth } from "./auth-context";
import { useRealtimeRefresh } from "./realtime";
import { useIsMobile } from "./useMediaQuery";
import type { KpiResponseData } from "./types";

const monthNames = ["Tháng 1", "Tháng 2", "Tháng 3", "Tháng 4", "Tháng 5", "Tháng 6", "Tháng 7", "Tháng 8", "Tháng 9", "Tháng 10", "Tháng 11", "Tháng 12"];
const compactNumber = new Intl.NumberFormat("vi-VN");

type KpiDraftRecord = { penName: string; kpiStandard: number; evaluation: string | null };

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

export default function KpiPage() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState<KpiResponseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [draftTargets, setDraftTargets] = useState<Record<string, number>>({});
  const [draftEvaluations, setDraftEvaluations] = useState<Record<string, string>>({});
  const refreshTimeoutRef = useRef<number | null>(null);
  const yearOptions = Array.from({ length: 5 }, (_, index) => new Date().getFullYear() - 2 + index).map((item) => ({ value: String(item), label: String(item) }));
  const monthOptions = monthNames.map((item, index) => ({ value: String(index + 1), label: item }));

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
        setDraftTargets(Object.fromEntries((nextData?.rows || []).map((row: KpiResponseData["rows"][number]) => [row.penName, row.targetKpi])));
        setDraftEvaluations(Object.fromEntries((nextData?.rows || []).map((row: KpiResponseData["rows"][number]) => [row.penName, row.evaluation || ""])));
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

  useRealtimeRefresh(["kpi", "team", "articles"], () => {
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
    return (data.rows || []).reduce<KpiDraftRecord[]>((records, row) => {
      const nextTarget = Math.max(0, Number(draftTargets[row.penName] ?? row.targetKpi));
      const nextEvaluation = String(draftEvaluations[row.penName] ?? row.evaluation ?? "").trim();
      if (nextTarget === row.targetKpi && nextEvaluation === String(row.evaluation || "").trim()) return records;
      records.push({ penName: row.penName, kpiStandard: nextTarget, evaluation: nextEvaluation || null });
      return records;
    }, []);
  }, [data?.canManage, data?.rows, draftEvaluations, draftTargets]);

  const handleSave = async () => {
    if (!data?.canManage || changedRecords.length === 0) return;
    try {
      setSaving(true);
      const response = await fetch("/api/kpi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, year, teamId: data.teamId, records: changedRecords }),
      });
      const payload = await response.json().catch(() => ({ success: false, error: "Không thể đọc phản hồi từ máy chủ" }));
      if (!response.ok || payload.success === false) {
        window.alert(`❌ ${payload.error || "Không thể lưu KPI"}`);
        return;
      }
      window.alert(`✅ Đã cập nhật KPI cho ${changedRecords.length} thành viên.`);
      await fetchKpi(false);
    } catch {
      window.alert("❌ Không thể kết nối tới máy chủ.");
    } finally {
      setSaving(false);
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
  const progressWidth = Math.max(8, Math.min(data.summary.completionPercentage, 100));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <section className="card" style={{ padding: isMobile ? 22 : 28, borderRadius: 30 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: isMobile ? 30 : 38, fontWeight: 950, letterSpacing: "-0.04em", color: "var(--text-main)" }}>KPI tháng</h1>
            <p style={{ margin: "10px 0 0", color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6 }}>KPI thực tế được tính tự động theo toàn bộ bài trong tháng đang chọn.</p>
            {user?.team?.name ? <p style={{ margin: "10px 0 0", color: "var(--accent-blue)", fontSize: 13, fontWeight: 700 }}>Team hiện tại: {user.team.name}</p> : null}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
            <div style={{ minWidth: 150 }}><CustomSelect value={String(month)} onChange={(value) => setMonth(Number(value))} options={monthOptions} /></div>
            <div style={{ minWidth: 120 }}><CustomSelect value={String(year)} onChange={(value) => setYear(Number(value))} options={yearOptions} /></div>
            {data.canManage ? <button className="btn-ios-pill btn-ios-primary" onClick={handleSave} disabled={saving || changedRecords.length === 0}>{saving ? "Đang lưu..." : changedRecords.length > 0 ? `Lưu ${changedRecords.length} thay đổi` : "Đã đồng bộ"}</button> : null}
          </div>
        </div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(4, minmax(0, 1fr))", gap: 16 }}>
        <StatCard label="Tổng KPI tháng" value={compactNumber.format(data.summary.totalAssignedKpi)} tone="blue" helper="Tổng KPI đã phân cho team." />
        <StatCard label="Đã hoàn thành" value={compactNumber.format(data.summary.totalActualKpi)} tone="green" helper="Số bài thực tế hiện có trong tháng." />
        <StatCard label="Còn thiếu" value={compactNumber.format(data.summary.totalRemainingKpi)} tone="orange" helper="Phần KPI còn thiếu để đạt mục tiêu." />
        <StatCard label="Tiến độ" value={`${data.summary.completionPercentage}%`} tone="purple" helper={`${compactNumber.format(data.summary.totalMembers)} thành viên đang được theo dõi.`} />
      </section>

      {viewer ? (
        <section className="card" style={{ padding: isMobile ? 20 : 24, borderRadius: 28, background: "linear-gradient(135deg, rgba(37,99,235,0.11), rgba(16,185,129,0.08), rgba(255,255,255,0.95))" }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: "var(--accent-blue)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Tiến độ của bạn</p>
          <h3 style={{ margin: "10px 0 0", fontSize: 28, fontWeight: 900, color: "var(--text-main)" }}>{viewer.name}</h3>
          <p style={{ margin: "8px 0 0", fontSize: 14, color: "var(--text-muted)", lineHeight: 1.6 }}>Bạn đã có <strong>{compactNumber.format(viewer.actualKpi)}</strong> bài trong tháng này và còn <strong>{compactNumber.format(viewer.remainingKpi)}</strong> bài để chạm KPI.</p>
          <div style={{ marginTop: 16, height: 12, borderRadius: 999, background: "rgba(148, 163, 184, 0.16)", overflow: "hidden" }}><div style={{ width: `${Math.max(8, Math.min(viewer.completionPercentage, 100))}%`, height: "100%", borderRadius: 999, background: "linear-gradient(90deg, #2563eb, #10b981)" }} /></div>
        </section>
      ) : null}

      <section className="card" style={{ padding: isMobile ? 18 : 24, borderRadius: 28 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 28, fontWeight: 900, color: "var(--text-main)" }}>Danh sách KPI thành viên</h2>
            <p style={{ margin: "8px 0 0", fontSize: 14, color: "var(--text-muted)" }}>{data.canManage ? "Bạn có thể chỉnh KPI mục tiêu và đánh giá theo từng thành viên." : "Đây là tiến độ KPI của bạn trong tháng đang xem."}</p>
          </div>
          <div style={{ minWidth: isMobile ? "100%" : 240, padding: "14px 16px", borderRadius: 18, background: "rgba(15, 23, 42, 0.03)", border: "1px solid rgba(148, 163, 184, 0.14)" }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>Mức hoàn thành chung</p>
            <div style={{ marginTop: 10, height: 10, borderRadius: 999, background: "rgba(148, 163, 184, 0.16)", overflow: "hidden" }}><div style={{ width: `${progressWidth}%`, height: "100%", borderRadius: 999, background: "linear-gradient(90deg, #2563eb, #8b5cf6)" }} /></div>
            <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--text-muted)" }}>{data.summary.completionPercentage}% KPI đã được lấp đầy trong tháng này.</p>
          </div>
        </div>

        {isMobile ? (
          <div style={{ display: "grid", gap: 14 }}>
            {data.rows.map((row) => (
              <div key={row.penName} style={{ border: "1px solid rgba(148, 163, 184, 0.18)", borderRadius: 22, padding: 16, background: "rgba(255,255,255,0.7)" }}>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "var(--text-main)" }}>{row.name}</h3>
                <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--text-muted)" }}>{row.penName} • {row.role === "reviewer" ? "CTV duyệt" : "CTV viết"}</p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, marginTop: 14 }}>
                  <div><strong>Tổng KPI:</strong> {compactNumber.format(row.targetKpi)}</div>
                  <div><strong>Đã làm:</strong> {compactNumber.format(row.actualKpi)}</div>
                  <div><strong>Còn lại:</strong> {compactNumber.format(row.remainingKpi)}</div>
                  <div><strong>Tiến độ:</strong> {row.completionPercentage}%</div>
                </div>
                {data.canManage ? (
                  <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
                    <input type="number" min={0} value={String(draftTargets[row.penName] ?? row.targetKpi)} onChange={(event) => setDraftTargets((current) => ({ ...current, [row.penName]: Number(event.target.value || 0) }))} className="input" placeholder="KPI tháng" />
                    <input value={draftEvaluations[row.penName] ?? row.evaluation ?? ""} onChange={(event) => setDraftEvaluations((current) => ({ ...current, [row.penName]: event.target.value }))} className="input" placeholder="Đánh giá / ghi chú" />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }} className="custom-scrollbar">
            <table className="w-full" style={{ minWidth: 920, borderCollapse: "separate", borderSpacing: 0 }}>
              <thead><tr style={{ textAlign: "left" }}>{["CTV", "Vai trò", "Tổng KPI", "Đã làm", "Còn lại", "Vượt", "Tiến độ", "Đánh giá"].map((column) => <th key={column} style={{ padding: "14px 12px", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", borderBottom: "1px solid rgba(148, 163, 184, 0.18)" }}>{column}</th>)}</tr></thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.penName}>
                    <td style={{ padding: "16px 12px", borderBottom: "1px solid rgba(148, 163, 184, 0.12)" }}><div style={{ fontWeight: 800, color: "var(--text-main)" }}>{row.name}</div><div style={{ marginTop: 4, fontSize: 12, color: "var(--text-muted)" }}>{row.penName}</div></td>
                    <td style={{ padding: "16px 12px", borderBottom: "1px solid rgba(148, 163, 184, 0.12)", color: "var(--text-muted)", fontWeight: 600 }}>{row.role === "reviewer" ? "CTV duyệt" : "CTV viết"}</td>
                    <td style={{ padding: "16px 12px", borderBottom: "1px solid rgba(148, 163, 184, 0.12)" }}>{data.canManage ? <input type="number" min={0} value={String(draftTargets[row.penName] ?? row.targetKpi)} onChange={(event) => setDraftTargets((current) => ({ ...current, [row.penName]: Number(event.target.value || 0) }))} className="input" style={{ minWidth: 120 }} /> : <strong>{compactNumber.format(row.targetKpi)}</strong>}</td>
                    <td style={{ padding: "16px 12px", borderBottom: "1px solid rgba(148, 163, 184, 0.12)", fontWeight: 800, color: "#059669" }}>{compactNumber.format(row.actualKpi)}</td>
                    <td style={{ padding: "16px 12px", borderBottom: "1px solid rgba(148, 163, 184, 0.12)", fontWeight: 700, color: "var(--text-main)" }}>{compactNumber.format(row.remainingKpi)}</td>
                    <td style={{ padding: "16px 12px", borderBottom: "1px solid rgba(148, 163, 184, 0.12)", fontWeight: 700, color: row.overKpi > 0 ? "#7c3aed" : "var(--text-muted)" }}>{compactNumber.format(row.overKpi)}</td>
                    <td style={{ padding: "16px 12px", borderBottom: "1px solid rgba(148, 163, 184, 0.12)" }}><div style={{ display: "flex", alignItems: "center", gap: 10 }}><div style={{ flex: 1, minWidth: 120, height: 10, borderRadius: 999, background: "rgba(148, 163, 184, 0.16)", overflow: "hidden" }}><div style={{ width: `${Math.max(6, Math.min(row.completionPercentage, 100))}%`, height: "100%", borderRadius: 999, background: row.completionPercentage >= 100 ? "linear-gradient(90deg, #10b981, #22c55e)" : "linear-gradient(90deg, #2563eb, #8b5cf6)" }} /></div><span style={{ minWidth: 48, fontSize: 13, fontWeight: 800, color: "var(--text-main)" }}>{row.completionPercentage}%</span></div></td>
                    <td style={{ padding: "16px 12px", borderBottom: "1px solid rgba(148, 163, 184, 0.12)" }}>{data.canManage ? <input value={draftEvaluations[row.penName] ?? row.evaluation ?? ""} onChange={(event) => setDraftEvaluations((current) => ({ ...current, [row.penName]: event.target.value }))} className="input" placeholder="Đánh giá / ghi chú" /> : <span style={{ color: "var(--text-muted)" }}>{row.evaluation || "—"}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}