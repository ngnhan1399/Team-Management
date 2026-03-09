"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "./auth-context";
import { useRealtimeRefresh } from "./realtime";
import type {
  Collaborator,
  PaymentItem,
  RoyaltyBreakdownItem,
  RoyaltyCalculationRow,
  RoyaltyDashboardData,
  RoyaltyRateItem,
} from "./types";
export default function RoyaltyPage() {
  const { user } = useAuth();
  const [rates, setRates] = useState<RoyaltyRateItem[]>([]);
  const [calculation, setCalculation] = useState<RoyaltyCalculationRow[]>([]);
  const [dashboard, setDashboard] = useState<RoyaltyDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"overview" | "rates" | "calculate" | "workflow">("overview");
  const [calcMonth, setCalcMonth] = useState(new Date().getMonth() + 1);
  const [calcYear, setCalcYear] = useState(new Date().getFullYear());
  const [budgetInput, setBudgetInput] = useState("");
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [expandedWriter, setExpandedWriter] = useState<string | null>(null);
  const [calcPenName, setCalcPenName] = useState("");
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [payments, setPayments] = useState<PaymentItem[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [paymentMonth, setPaymentMonth] = useState(new Date().getMonth() + 1);
  const [paymentYear, setPaymentYear] = useState(new Date().getFullYear());
  const [paymentPenName, setPaymentPenName] = useState("");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState("");
  const [paymentGenerating, setPaymentGenerating] = useState(false);
  const [paymentActionId, setPaymentActionId] = useState<number | null>(null);
  const [forceGenerate, setForceGenerate] = useState(false);
  const [expandedPaymentId, setExpandedPaymentId] = useState<number | null>(null);
  const isAdmin = user?.role === "admin";
  const collaboratorLabel = user?.collaborator?.penName || user?.collaborator?.name || "tài khoản của bạn";

  const PIE_COLORS = ["var(--neon-cyan)", "var(--neon-violet)", "var(--accent)", "var(--success)", "var(--danger)", "#3b82f6", "#10b981", "#f59e0b", "#f97316", "#6366f1"];
  const royaltyTabs: Array<{ id: "overview" | "rates" | "calculate" | "workflow"; label: string; icon: string }> = [
    { id: "overview", label: "Tổng quan", icon: "analytics" },
    { id: "rates", label: "Bảng giá", icon: "payments" },
    { id: "calculate", label: "Tính nhuận bút", icon: "calculate" },
    { id: "workflow", label: "Thanh toán", icon: "receipt_long" },
  ];

  const fmt = (n: number) => n.toLocaleString("vi-VN") + "đ";
  const monthNames = ["Tháng 1", "Tháng 2", "Tháng 3", "Tháng 4", "Tháng 5", "Tháng 6", "Tháng 7", "Tháng 8", "Tháng 9", "Tháng 10", "Tháng 11", "Tháng 12"];
  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 5 }, (_, index) => currentYear - 2 + index);

  const fetchDashboard = useCallback(() => {
    setLoading(true);
    fetch("/api/royalty?action=dashboard", { cache: "no-store" })
      .then(r => r.json())
      .then(d => {
        setDashboard(d.data);
        if (d.data?.budget?.budgetAmount) setBudgetInput(String(d.data.budget.budgetAmount));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const fetchRates = useCallback(() => {
    fetch("/api/royalty?action=rates", { cache: "no-store" })
      .then(r => r.json())
      .then(d => setRates(d.data || []))
      .catch(() => { });
  }, []);

  const fetchCalculation = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ action: "calculate", month: String(calcMonth), year: String(calcYear) });
    if (!isAdmin && user?.collaborator?.penName) params.set("penName", user.collaborator.penName);
    else if (calcPenName) params.set("penName", calcPenName);
    fetch(`/api/royalty?${params}`, { cache: "no-store" })
      .then(r => r.json())
      .then(d => { setCalculation(d.data || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [calcMonth, calcYear, calcPenName, isAdmin, user]);

  const fetchPayments = useCallback(() => {
    setPaymentsLoading(true);
    const params = new URLSearchParams({ month: String(paymentMonth), year: String(paymentYear) });
    if (paymentStatusFilter) params.set("status", paymentStatusFilter);
    if (!isAdmin && user?.collaborator?.penName) params.set("penName", user.collaborator.penName);
    else if (paymentPenName) params.set("penName", paymentPenName);
    fetch(`/api/payments?${params}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setPayments(d.data || []);
        setPaymentsLoading(false);
      })
      .catch(() => setPaymentsLoading(false));
  }, [isAdmin, paymentMonth, paymentPenName, paymentStatusFilter, paymentYear, user]);

  useEffect(() => {
    fetchDashboard();
    fetchRates();
    if (isAdmin) {
      fetch("/api/collaborators", { cache: "no-store" }).then(r => r.json()).then(d => setCollaborators(d.data || [])).catch(() => { });
    }
  }, [fetchDashboard, fetchRates, isAdmin]);

  const refreshRoyaltyView = useCallback(() => {
    fetchDashboard();
    if (tab === "calculate") fetchCalculation();
    if (tab === "workflow") fetchPayments();
  }, [fetchCalculation, fetchDashboard, fetchPayments, tab]);

  useRealtimeRefresh(["royalty", "dashboard", "articles"], refreshRoyaltyView);

  const handleSetBudget = async () => {
    const amount = parseInt(budgetInput);
    if (isNaN(amount) || amount < 0) return;
    setBudgetSaving(true);
    const now = new Date();
    await fetch("/api/royalty", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set-budget", month: now.getMonth() + 1, year: now.getFullYear(), budgetAmount: amount }),
    });
    setBudgetSaving(false);
    fetchDashboard();
  };

  const generatePayments = async () => {
    setPaymentGenerating(true);
    try {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate",
          month: paymentMonth,
          year: paymentYear,
          penName: paymentPenName || null,
          force: forceGenerate,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        alert("❌ " + (data.error || "Không tạo được bảng thanh toán"));
        return;
      }
      alert(`✅ Đã tạo/cập nhật ${data.generated || 0} dòng, bỏ qua ${data.skipped || 0} dòng.`);
      fetchPayments();
    } catch (error) {
      alert("❌ " + String(error));
    } finally {
      setPaymentGenerating(false);
    }
  };

  const paymentAction = async (id: number, action: "approve" | "mark-paid") => {
    setPaymentActionId(id);
    try {
      const res = await fetch("/api/payments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const data = await res.json();
      if (!data.success) {
        alert("❌ " + (data.error || "Không thực hiện được thao tác"));
        return;
      }
      fetchPayments();
    } catch (error) {
      alert("❌ " + String(error));
    } finally {
      setPaymentActionId(null);
    }
  };

  // Group rates by articleType for cards
  const rateGroups: Record<string, { new?: number; rewrite?: number }> = {};
  for (const r of rates) {
    if (!rateGroups[r.articleType]) rateGroups[r.articleType] = {};
    if (r.contentType === "Viết mới") rateGroups[r.articleType].new = r.price;
    else rateGroups[r.articleType].rewrite = r.price;
  }

  // Chart data
  const maxAmount = dashboard?.monthlyData ? Math.max(...dashboard.monthlyData.map((m) => m.totalAmount), 1) : 1;

  // Budget status
  const budgetPct = dashboard?.budget?.percentage || 0;
  const hasBudget = dashboard?.budget?.hasBudget || false;
  const gaugeColor = budgetPct >= 100 ? "var(--danger)" : budgetPct >= 80 ? "var(--warning)" : "var(--success)";
  const gaugeAngle = Math.min(budgetPct, 100) * 3.6;

  return (
    <>
      <header className="page-shell-header">
        <div>
          <h2 style={{ fontSize: 32, fontWeight: 800, color: "var(--text-main)", letterSpacing: "-0.04em" }}>Nhuận bút</h2>
          <p style={{ color: "var(--text-muted)", marginTop: 4, fontSize: 14 }}>
            {isAdmin ? "Quản lý ngân sách, cơ cấu thanh toán và hiệu suất tài chính." : `Theo dõi nhuận bút của ${collaboratorLabel}.`}
          </p>
        </div>
      </header>

      <div style={{ display: "flex", gap: 8, padding: 6, background: "rgba(255,255,255,0.03)", borderRadius: 16, width: "100%", maxWidth: "100%", marginBottom: 32, border: "1px solid var(--glass-border)", overflowX: "auto" }}>
        {royaltyTabs.map(t => (
          <button
            key={t.id}
            data-testid={`royalty-tab-${t.id}`}
            onClick={() => {
              if (t.id === "overview") fetchDashboard();
              if (t.id === "calculate") fetchCalculation();
              if (t.id === "workflow") fetchPayments();
              setTab(t.id);
            }}
            style={{
              padding: "10px 20px",
              borderRadius: 12,
              border: "none",
              background: tab === t.id ? "var(--glass-bg-accent)" : "transparent",
              color: tab === t.id ? "var(--accent-blue)" : "var(--text-muted)",
              fontSize: 14,
              fontWeight: 700,
              display: "flex",
              flex: "0 0 auto",
              alignItems: "center",
              gap: 8,
              cursor: "pointer",
              transition: "all 0.2s var(--ease-apple)"
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <>
          {loading ? (
            <div className="loading" style={{ padding: 60, fontSize: 18, color: "var(--neon-cyan)" }}>⏳ Đang tải dữ liệu...</div>
          ) : dashboard ? (
            <>
              {/* Budget Alert Card */}
              {hasBudget && budgetPct >= 80 && (
                <div className="glass-card" style={{ padding: "24px 32px", marginBottom: 32, display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap", borderLeft: `6px solid ${gaugeColor}`, background: `${gaugeColor}05` }}>
                  <div style={{ width: 56, height: 56, borderRadius: 16, background: `${gaugeColor}15`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 32, color: gaugeColor }}>{budgetPct >= 100 ? "priority_high" : "warning"}</span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <h4 style={{ fontSize: 18, fontWeight: 800, color: "var(--text-main)" }}>{budgetPct >= 100 ? "Vượt ngân sách" : "Sắp đạt giới hạn"}</h4>
                    <p style={{ fontSize: 14, color: "var(--text-muted)", marginTop: 4 }}>
                      {budgetPct >= 100
                        ? `Chi tiêu (${fmt(dashboard.budget.spent)}) đã vượt giới hạn ${fmt(dashboard.budget.budgetAmount)}.`
                        : `Đã sử dụng ${budgetPct}% ngân sách tháng (${fmt(dashboard.budget.spent)} / ${fmt(dashboard.budget.budgetAmount)}).`}
                    </p>
                  </div>
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 24, marginBottom: 32 }}>
                {[
                  { label: "Nhuận bút phát sinh", value: fmt(dashboard.currentMonth?.totalAmount || 0), icon: "account_balance_wallet", color: "var(--accent-blue)" },
                  { label: "Bài đã duyệt", value: dashboard.currentMonth?.totalArticles || 0, icon: "history_edu", color: "var(--accent-teal)" },
                  { label: "Ngân sách tháng", value: hasBudget ? fmt(dashboard.budget.budgetAmount) : "CHƯA ĐẶT", icon: "track_changes", color: "var(--accent-purple)" },
                  { label: "Còn lại", value: hasBudget ? fmt(Math.max(dashboard.budget.budgetAmount - dashboard.budget.spent, 0)) : "—", icon: "troubleshoot", color: "var(--accent-orange)" }
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

              {isAdmin && (
                <div className="glass-card" style={{ padding: 24, marginBottom: 32, display: "flex", gap: 20, alignItems: "flex-end", background: "rgba(0,0,0,0.01)" }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8, letterSpacing: "0.05em" }}>🎯 Mục tiêu ngân sách tháng ({new Date().getMonth() + 1}/{new Date().getFullYear()})</label>
                    <input className="form-input" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)" }} type="number" value={budgetInput} onChange={e => setBudgetInput(e.target.value)} placeholder="Nhập số tiền (VD: 10.000.000)" />
                  </div>
                  <button className="btn-ios-pill btn-ios-primary" onClick={handleSetBudget} disabled={budgetSaving}>
                    <span className="material-symbols-outlined" style={{ fontSize: 20 }}>save</span>
                    Lưu ngân sách
                  </button>
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: 32, marginBottom: 32 }}>
                <div className="card">
                  <h3 className="text-xl font-bold mb-8">Biểu đồ theo quý</h3>
                  <div className="royalty-chart">
                    {dashboard.monthlyData?.map((m, i: number) => {
                      const heightPct = maxAmount > 0 ? Math.max((m.totalAmount / maxAmount) * 100, 2) : 2;
                      return (
                        <div key={i} className="royalty-chart-bar">
                          <div className="royalty-chart-bar-fill" style={{ height: `${heightPct}%`, background: i === new Date().getMonth() ? "var(--accent-blue)" : "rgba(59, 130, 246, 0.15)" }}>
                            <div className="chart-tooltip">{fmt(m.totalAmount)}</div>
                          </div>
                          <span className="royalty-chart-bar-label">{monthNames[m.month - 1]}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="card text-center flex flex-col items-center justify-center">
                  <h3 className="text-xl font-bold mb-8">Mức sử dụng ngân sách</h3>
                  {hasBudget ? (
                    <>
                      <div className="budget-gauge" style={{ background: `conic-gradient(${gaugeColor} ${gaugeAngle}deg, rgba(0,0,0,0.02) ${gaugeAngle}deg)` }}>
                        <div className="budget-gauge-inner">
                          <div className="budget-gauge-percent" style={{ fontWeight: 800, color: "var(--text-main)" }}>{budgetPct}%</div>
                          <div className="budget-gauge-label">DUNG LƯỢNG</div>
                        </div>
                      </div>
                      <div className="mt-8 font-bold text-sm text-muted">
                        {fmt(dashboard.budget.spent)} / {fmt(dashboard.budget.budgetAmount)}
                      </div>
                    </>
                  ) : <div className="text-muted">Chưa đặt mục tiêu ngân sách.</div>}
                </div>
              </div>

              {dashboard.topWriters?.length > 0 && (
                <div className="card">
                  <h3 className="text-xl font-bold mb-8">Bảng xếp hạng</h3>
                  {dashboard.topWriters.map((w, i: number) => {
                    const maxW = dashboard.topWriters[0]?.amount || 1;
                    return (
                      <div key={i} className="obsidian-glass" style={{ display: "flex", alignItems: "center", gap: 20, padding: "16px 24px", borderRadius: 16, marginBottom: 12, border: "1px solid rgba(255,255,255,0.02)" }}>
                        <div className="text-xl font-black text-gradient-metallic" style={{ width: 40 }}>0{i + 1}</div>
                        <span style={{ flex: 1, fontWeight: 700 }}>{w.penName}</span>
                        <div className="inline-progress" style={{ width: 120 }}>
                          <div className="inline-progress-fill" style={{ width: `${(w.amount / maxW) * 100}%`, background: "var(--neon-cyan)" }} />
                        </div>
                        <span className="text-gradient-metallic font-black" style={{ width: 120, textAlign: "right" }}>{fmt(w.amount)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : null}
        </>
      )}

      {/* ═══ TAB: RATES ═══ */}
      {tab === "rates" && (
        <div className="price-grid">
          {Object.entries(rateGroups).map(([articleType, prices]) => (
            <div key={articleType} className="price-card obsidian-glass">
              <div className="price-card-header">
                <span className="material-symbols-outlined" style={{ fontSize: 20, color: "var(--accent-blue)" }}>article</span>
                <span>{articleType}</span>
              </div>
              <div className="price-card-body">
                <div className="price-card-col">
                  <span className="price-card-type new">VIẾT MỚI</span>
                  <span className="price-card-amount new">{prices.new !== undefined ? fmt(prices.new) : "—"}</span>
                </div>
                <div className="price-card-col">
                  <span className="price-card-type rewrite">VIẾT LẠI</span>
                  <span className="price-card-amount rewrite">{prices.rewrite !== undefined ? fmt(prices.rewrite) : "—"}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ═══ TAB: CALCULATE ═══ */}
      {tab === "calculate" && (() => {
        // Aggregate all breakdowns for pie chart
        const allBreakdowns: Record<string, { count: number; unitPrice: number; total: number }> = {};
        for (const c of calculation) {
          for (const [k, v] of Object.entries(c.breakdown || {}) as [string, RoyaltyBreakdownItem][]) {
            if (!allBreakdowns[k]) allBreakdowns[k] = { count: 0, unitPrice: v.unitPrice, total: 0 };
            allBreakdowns[k].count += v.count;
            allBreakdowns[k].total += v.total;
          }
        }
        const breakdownEntries = Object.entries(allBreakdowns).sort((a, b) => b[1].total - a[1].total);
        const totalCalcAmount = calculation.reduce((s: number, c) => s + c.totalAmount, 0);
        const totalCalcArticles = calculation.reduce((s: number, c) => s + c.totalArticles, 0);
        const maxBreakdownTotal = breakdownEntries.length > 0 ? breakdownEntries[0][1].total : 1;

        return (
          <>
            <div className="obsidian-glass" style={{ padding: 24, borderRadius: 24, marginBottom: 32, display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div className="form-group" style={{ marginBottom: 0, width: 140 }}><label className="form-label">Tháng</label><select className="form-select" value={calcMonth} onChange={e => setCalcMonth(parseInt(e.target.value))}>
                {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{monthNames[i]}</option>)}</select></div>
              <div className="form-group" style={{ marginBottom: 0, width: 120 }}><label className="form-label">Năm</label><select className="form-select" value={calcYear} onChange={e => setCalcYear(parseInt(e.target.value))}>
                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}</select></div>
              {isAdmin && (
                <div className="form-group" style={{ marginBottom: 0, minWidth: 200 }}><label className="form-label">Cộng tác viên</label><select className="form-select" value={calcPenName} onChange={e => setCalcPenName(e.target.value)}>
                  <option value="">Tất cả</option>{collaborators.filter((c) => c.role === "writer").map((c) => <option key={c.id} value={c.penName}>{c.penName}</option>)}</select></div>
              )}
              <button className="btn-ios-pill btn-ios-primary" onClick={fetchCalculation} style={{ height: 44 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>refresh</span>
                Tạo báo cáo
              </button>
            </div>

            {loading ? <div className="loading" style={{ padding: 60, fontSize: 18, color: "var(--accent-blue)" }}>⏳ Đang tính toán...</div> : calculation.length === 0 ? (
              <div className="empty-state"><div className="empty-state-icon">assessment</div><div className="empty-state-text">Không có dữ liệu cho kỳ đã chọn.</div></div>
            ) : (
              <>
                <div className="stats-grid mb-8">
                  <div className="stat-card blue"><div className="stat-label">Tổng chi trả</div><div className="stat-value">{fmt(totalCalcAmount)}</div><div className="stat-icon"><span className="material-symbols-outlined">account_balance</span></div></div>
                  <div className="stat-card green"><div className="stat-label">Bài đã duyệt</div><div className="stat-value">{totalCalcArticles}</div><div className="stat-icon"><span className="material-symbols-outlined">library_books</span></div></div>
                  <div className="stat-card orange"><div className="stat-label">CTV hoạt động</div><div className="stat-value">{calculation.length}</div><div className="stat-icon"><span className="material-symbols-outlined">badge</span></div></div>
                </div>

                <div className="card mb-8">
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 24 }}>
                    {breakdownEntries.map(([k, v], i) => (
                      <div key={k} className="glass-card" style={{ padding: 24, background: "rgba(255,255,255,0.01)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-main)" }}>{k}</div>
                            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{v.count} bài × {fmt(v.unitPrice)}</div>
                          </div>
                          <div style={{ fontSize: 16, fontWeight: 800, color: "var(--accent-blue)" }}>{fmt(v.total)}</div>
                        </div>
                        <div style={{ height: 6, background: "rgba(255,255,255,0.03)", borderRadius: 3, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${(v.total / maxBreakdownTotal) * 100}%`, background: PIE_COLORS[i % PIE_COLORS.length], boxShadow: `0 0 10px ${PIE_COLORS[i % PIE_COLORS.length]}50` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="glass-card" style={{ padding: 0, overflow: "hidden", marginTop: 32 }}>
                  <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.02)" }}>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text-main)" }}>Chi tiết theo CTV</h3>
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead style={{ background: "rgba(255,255,255,0.01)", borderBottom: "1px solid var(--glass-border)" }}>
                        <tr>
                          <th style={{ padding: "12px 24px", textAlign: "left", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>CTV</th>
                          <th style={{ padding: "12px 24px", textAlign: "center", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Số bài</th>
                          <th style={{ padding: "12px 24px", textAlign: "right", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Tổng nhuận bút</th>
                          <th style={{ padding: "12px 24px", textAlign: "right", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Chi tiết</th>
                        </tr>
                      </thead>
                      <tbody>
                        {calculation.map((c) => (
                          <React.Fragment key={c.penName}>
                            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.02)" }}>
                              <td style={{ padding: "16px 24px", fontWeight: 700, color: "var(--text-main)" }}>{c.penName}</td>
                              <td style={{ padding: "16px 24px", textAlign: "center", color: "var(--accent-teal)", fontWeight: 800 }}>{c.totalArticles}</td>
                              <td style={{ padding: "16px 24px", textAlign: "right", color: "var(--accent-blue)", fontWeight: 800 }}>{fmt(c.totalAmount)}</td>
                              <td style={{ padding: "16px 24px", textAlign: "right" }}>
                                <button
                                  className="btn-ios-pill btn-ios-secondary"
                                  style={{ padding: "6px 12px" }}
                                  onClick={() => setExpandedWriter(expandedWriter === c.penName ? null : c.penName)}
                                >
                                  {expandedWriter === c.penName ? "Thu gọn" : "Xem thêm"}
                                </button>
                              </td>
                            </tr>
                            {expandedWriter === c.penName && (
                              <tr>
                                <td colSpan={4} style={{ padding: "16px 24px", background: "rgba(255,255,255,0.01)" }}>
                                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
                                    {Object.entries(c.breakdown || {}).map(([k, v]: [string, RoyaltyBreakdownItem]) => (
                                      <div key={k} style={{ padding: 12, borderRadius: 12, background: "rgba(255,255,255,0.02)", border: "1px solid var(--glass-border)" }}>
                                        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginBottom: 4 }}>{k}</div>
                                        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-main)" }}>{v.count} bài × {fmt(v.unitPrice)}</div>
                                        <div style={{ fontSize: 15, fontWeight: 800, color: "var(--accent-blue)", marginTop: 4 }}>{fmt(v.total)}</div>
                                      </div>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </>
        );
      })()}

      {tab === "workflow" && (
        <>
          <div className="obsidian-glass" style={{ padding: 24, borderRadius: 24, marginBottom: 24, display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div className="form-group" style={{ marginBottom: 0, width: 140 }}>
              <label className="form-label">Tháng</label>
              <select data-testid="payment-month-select" className="form-select" value={paymentMonth} onChange={(e) => setPaymentMonth(parseInt(e.target.value))}>
                {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{monthNames[i]}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0, width: 120 }}>
              <label className="form-label">Năm</label>
              <select data-testid="payment-year-select" className="form-select" value={paymentYear} onChange={(e) => setPaymentYear(parseInt(e.target.value))}>
                {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            <div className="form-group" style={{ marginBottom: 0, width: 180 }}>
              <label className="form-label">Trạng thái</label>
              <select data-testid="payment-status-select" className="form-select" value={paymentStatusFilter} onChange={(e) => setPaymentStatusFilter(e.target.value)}>
                <option value="">Tất cả</option>
                <option value="pending">Chờ duyệt</option>
                <option value="approved">Đã duyệt</option>
                <option value="paid">Đã thanh toán</option>
              </select>
            </div>
            {isAdmin && (
              <div className="form-group" style={{ marginBottom: 0, minWidth: 220 }}>
                <label className="form-label">Cộng tác viên</label>
                <select data-testid="payment-penname-select" className="form-select" value={paymentPenName} onChange={(e) => setPaymentPenName(e.target.value)}>
                  <option value="">Tất cả</option>
                  {collaborators.filter((c) => c.role === "writer").map((c) => (
                    <option key={c.id} value={c.penName}>{c.penName}</option>
                  ))}
                </select>
              </div>
            )}
            <button data-testid="payment-refresh-button" className="btn-ios-pill btn-ios-primary" onClick={fetchPayments} style={{ height: 44 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>refresh</span>
              Tải danh sách
            </button>
            {isAdmin && (
              <>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-muted)", marginBottom: 10 }}>
                  <input type="checkbox" checked={forceGenerate} onChange={(e) => setForceGenerate(e.target.checked)} />
                  Ghi đè kỳ đã duyệt/đã trả
                </label>
                <button data-testid="payment-generate-button" className="btn-ios-pill btn-ios-secondary" onClick={generatePayments} disabled={paymentGenerating} style={{ height: 44 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>calculate</span>
                  {paymentGenerating ? "Đang tạo..." : "Tạo bảng thanh toán"}
                </button>
              </>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 24 }}>
            <div className="glass-card" style={{ padding: 20 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>Tổng dòng thanh toán</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: "var(--text-main)" }}>{payments.length}</div>
            </div>
            <div className="glass-card" style={{ padding: 20 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>Tổng tiền</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: "var(--accent-blue)" }}>{fmt(payments.reduce((sum, p) => sum + p.totalAmount, 0))}</div>
            </div>
            <div className="glass-card" style={{ padding: 20 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>Đã thanh toán</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: "var(--accent-teal)" }}>{payments.filter((p) => p.status === "paid").length}</div>
            </div>
          </div>

          {!isAdmin && payments.some((payment) => payment.isEstimated) && (
            <div style={{ marginBottom: 16, padding: "14px 16px", borderRadius: 14, background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.14)", color: "var(--text-main)", fontSize: 13 }}>
              Dữ liệu dưới đây đang hiển thị ở chế độ tạm tính theo các bài đã duyệt của bạn trong kỳ đã chọn. Bài nháp, chờ duyệt hoặc chưa có trạng thái hợp lệ sẽ không được cộng nhuận.
            </div>
          )}

          <div className="glass-card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead style={{ background: "rgba(255,255,255,0.02)", borderBottom: "1px solid var(--glass-border)" }}>
                  <tr>
                    <th style={{ padding: "12px 20px", textAlign: "left", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>CTV</th>
                    <th style={{ padding: "12px 20px", textAlign: "center", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Kỳ</th>
                    <th style={{ padding: "12px 20px", textAlign: "center", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Số bài</th>
                    <th style={{ padding: "12px 20px", textAlign: "right", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Tổng tiền</th>
                    <th style={{ padding: "12px 20px", textAlign: "center", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Trạng thái</th>
                    <th style={{ padding: "12px 20px", textAlign: "right", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentsLoading ? (
                    <tr>
                      <td colSpan={6} style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>⏳ Đang tải thanh toán...</td>
                    </tr>
                  ) : payments.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
                        Chưa có dữ liệu thanh toán.
                        {!isAdmin ? <div style={{ marginTop: 8, fontSize: 13 }}>Hệ thống chỉ hiển thị nhuận bút thuộc {collaboratorLabel}.</div> : null}
                      </td>
                    </tr>
                  ) : (
                    payments.map((p) => (
                      <React.Fragment key={p.id}>
                        <tr data-testid={`payment-row-${p.id}`} style={{ borderBottom: "1px solid var(--glass-border)" }}>
                          <td style={{ padding: "14px 20px", fontSize: 13, color: "var(--text-main)", fontWeight: 700 }}>{p.penName}</td>
                          <td style={{ padding: "14px 20px", textAlign: "center", fontSize: 13, color: "var(--text-main)" }}>{p.month}/{p.year}</td>
                          <td style={{ padding: "14px 20px", textAlign: "center", fontSize: 13, color: "var(--text-main)" }}>{p.totalArticles}</td>
                          <td style={{ padding: "14px 20px", textAlign: "right", fontSize: 14, color: "var(--accent-blue)", fontWeight: 800 }}>{fmt(p.totalAmount)}</td>
                          <td style={{ padding: "14px 20px", textAlign: "center" }}>
                            <span data-testid={`payment-status-badge-${p.id}`} style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "4px 10px",
                              borderRadius: 8,
                              fontSize: 12,
                              fontWeight: 700,
                              color: p.isEstimated ? "#7c3aed" : p.status === "pending" ? "#f97316" : p.status === "approved" ? "#3b82f6" : "#10b981",
                              background: p.isEstimated ? "rgba(124,58,237,0.12)" : p.status === "pending" ? "rgba(249,115,22,0.12)" : p.status === "approved" ? "rgba(59,130,246,0.12)" : "rgba(16,185,129,0.12)",
                            }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                                {p.isEstimated ? "auto_awesome" : p.status === "pending" ? "schedule" : p.status === "approved" ? "fact_check" : "paid"}
                              </span>
                              {p.isEstimated ? "Tạm tính" : p.status === "pending" ? "Chờ duyệt" : p.status === "approved" ? "Đã duyệt" : "Đã thanh toán"}
                            </span>
                          </td>
                          <td style={{ padding: "14px 20px", textAlign: "right" }}>
                            <div style={{ display: "inline-flex", gap: 8 }}>
                              <button data-testid={`payment-toggle-${p.id}`} className="btn-ios-pill btn-ios-secondary" style={{ padding: "6px 10px" }} onClick={() => setExpandedPaymentId(expandedPaymentId === p.id ? null : p.id)}>
                                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{expandedPaymentId === p.id ? "expand_less" : "expand_more"}</span>
                              </button>
                              {isAdmin && p.status === "pending" && (
                                <button data-testid={`payment-approve-${p.id}`} className="btn-ios-pill btn-ios-primary" style={{ padding: "6px 12px" }} disabled={paymentActionId === p.id} onClick={() => paymentAction(p.id, "approve")}>
                                  {paymentActionId === p.id ? "..." : "Duyệt"}
                                </button>
                              )}
                              {isAdmin && p.status === "approved" && (
                                <button data-testid={`payment-mark-paid-${p.id}`} className="btn-ios-pill btn-ios-secondary" style={{ padding: "6px 12px", borderColor: "rgba(16,185,129,0.3)", color: "#10b981" }} disabled={paymentActionId === p.id} onClick={() => paymentAction(p.id, "mark-paid")}>
                                  {paymentActionId === p.id ? "..." : "Đánh dấu đã trả"}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {expandedPaymentId === p.id && (
                          <tr>
                            <td colSpan={6} style={{ padding: "14px 20px", background: "rgba(255,255,255,0.02)" }}>
                              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
                                {Object.entries(p.details || {}).length === 0 ? (
                                  <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Không có breakdown chi tiết.</div>
                                ) : (
                                  Object.entries(p.details || {}).map(([k, v]) => (
                                    <div key={k} style={{ padding: 12, borderRadius: 10, border: "1px solid var(--glass-border)", background: "rgba(0,0,0,0.02)" }}>
                                      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>{k}</div>
                                      <div style={{ fontSize: 13, color: "var(--text-main)" }}>{v.count} bài × {fmt(v.unitPrice)}</div>
                                      <div style={{ fontSize: 14, color: "var(--accent-blue)", fontWeight: 700, marginTop: 3 }}>{fmt(v.total)}</div>
                                    </div>
                                  ))
                                )}
                              </div>
                              <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-muted)" }}>
                                {p.isEstimated ? "Dòng tạm tính được dựng từ các bài viết đã duyệt hiện tại." : `Tạo: ${new Date(p.createdAt).toLocaleString("vi-VN")}`}
                                {!p.isEstimated && (
                                  <>
                                    {p.approvedAt ? ` • Duyệt: ${new Date(p.approvedAt).toLocaleString("vi-VN")}` : ""}
                                    {p.paidAt ? ` • Thanh toán: ${new Date(p.paidAt).toLocaleString("vi-VN")}` : ""}
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}

/* ══════════════════════════ END OF ROYALTY PAGE ══════════════════════════ */

