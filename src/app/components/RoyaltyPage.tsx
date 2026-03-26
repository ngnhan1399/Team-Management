"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import CustomSelect from "./CustomSelect";
import { useAuth } from "./auth-context";
import { useRealtimeRefresh } from "./realtime";
import { useIsMobile } from "./useMediaQuery";
import type {
  Collaborator,
  PaymentItem,
  RoyaltyBreakdownItem,
  RoyaltyCalculationRow,
  RoyaltyDashboardData,
  RoyaltyRateItem,
} from "./types";

const ROYALTY_RATES_CACHE_TTL_MS = 10 * 60 * 1000;
const REVIEWER_ROYALTY_PRICE = 15000;
const ROYALTY_COLLABORATORS_CACHE_TTL_MS = 10 * 60 * 1000;
const ROYALTY_DASHBOARD_CACHE_TTL_MS = 30 * 1000;

let royaltyRatesCache: RoyaltyRateItem[] | null = null;
let royaltyRatesCacheAt = 0;
let royaltyCollaboratorsCache: Collaborator[] | null = null;
let royaltyCollaboratorsCacheAt = 0;
let royaltyCollaboratorsCacheKey = "";
let royaltyDashboardCache: RoyaltyDashboardData | null = null;
let royaltyDashboardCacheAt = 0;
let royaltyDashboardCacheKey = "";

export default function RoyaltyPage() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [rates, setRates] = useState<RoyaltyRateItem[]>([]);
  const [calculation, setCalculation] = useState<RoyaltyCalculationRow[]>([]);
  const [dashboard, setDashboard] = useState<RoyaltyDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"overview" | "rates" | "calculate" | "workflow">("overview");
  const [overviewMonth, setOverviewMonth] = useState(new Date().getMonth() + 1);
  const [overviewYear, setOverviewYear] = useState(new Date().getFullYear());
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
  const refreshTimeoutRef = useRef<number | null>(null);
  const isAdmin = user?.role === "admin";
  const isLeader = Boolean(isAdmin && user?.isLeader);
  const collaboratorLabel = user?.collaborator?.penName || user?.collaborator?.name || "tài khoản của bạn";

  const PIE_COLORS = ["var(--neon-cyan)", "var(--neon-violet)", "var(--accent)", "var(--success)", "var(--danger)", "#3b82f6", "#10b981", "#f59e0b", "#f97316", "#6366f1"];
  const royaltyTabs: Array<{ id: "overview" | "rates" | "calculate"; label: string; icon: string }> = [
    { id: "overview", label: "Tổng quan", icon: "analytics" },
    { id: "rates", label: "Bảng giá", icon: "payments" },
    { id: "calculate", label: "Tính nhuận bút", icon: "calculate" },
  ];

  const fmt = (n: number) => n.toLocaleString("vi-VN") + "đ";
  const fmtPct = (n: number) => `${n.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`;
  const monthNames = ["Tháng 1", "Tháng 2", "Tháng 3", "Tháng 4", "Tháng 5", "Tháng 6", "Tháng 7", "Tháng 8", "Tháng 9", "Tháng 10", "Tháng 11", "Tháng 12"];
  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 5 }, (_, index) => currentYear - 2 + index);
  const monthSelectOptions = monthNames.map((label, index) => ({ value: String(index + 1), label }));
  const yearSelectOptions = yearOptions.map((year) => ({ value: String(year), label: String(year) }));
  const collaboratorSelectOptions = [
    { value: "", label: "Tất cả" },
    ...collaborators.map((c) => ({
      value: c.penName,
      label: `${c.name && c.name !== c.penName ? `${c.penName} (${c.name})` : c.penName} • ${c.role === "reviewer" ? "Reviewer" : "Writer"}`,
    })),
  ];
  const paymentStatusOptions = [
    { value: "", label: "Tất cả" },
    { value: "pending", label: "Chờ duyệt" },
    { value: "approved", label: "Đã duyệt" },
    { value: "paid", label: "Đã thanh toán" },
  ];

  const fetchDashboard = useCallback((showLoading = true, preferCache = true) => {
    const cacheKey = `${user?.id || 0}:${user?.teamId || 0}:${user?.role || "guest"}:${overviewYear}-${overviewMonth}`;
    if (
      preferCache
      && royaltyDashboardCache
      && royaltyDashboardCacheKey === cacheKey
      && Date.now() - royaltyDashboardCacheAt < ROYALTY_DASHBOARD_CACHE_TTL_MS
    ) {
      setDashboard(royaltyDashboardCache);
      setBudgetInput(royaltyDashboardCache?.budget?.hasBudget ? String(royaltyDashboardCache.budget.budgetAmount) : "");
      if (showLoading) {
        setLoading(false);
      }
      return Promise.resolve();
    }

    if (showLoading) {
      setLoading(true);
    }
    const params = new URLSearchParams({
      action: "dashboard",
      month: String(overviewMonth),
      year: String(overviewYear),
    });
    return fetch(`/api/royalty?${params}`, { cache: "no-store" })
      .then(r => r.json())
      .then(d => {
        const nextDashboard = d.data || null;
        royaltyDashboardCache = nextDashboard;
        royaltyDashboardCacheAt = Date.now();
        royaltyDashboardCacheKey = cacheKey;
        setDashboard(nextDashboard);
        setBudgetInput(nextDashboard?.budget?.hasBudget ? String(nextDashboard.budget.budgetAmount) : "");
        if (showLoading) {
          setLoading(false);
        }
      })
      .catch(() => {
        if (showLoading) {
          setLoading(false);
        }
      });
  }, [overviewMonth, overviewYear, user?.id, user?.role, user?.teamId]);

  const fetchRates = useCallback((preferCache = true) => {
    if (preferCache && royaltyRatesCache && Date.now() - royaltyRatesCacheAt < ROYALTY_RATES_CACHE_TTL_MS) {
      setRates(royaltyRatesCache);
      return Promise.resolve();
    }

    return fetch("/api/royalty?action=rates", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const nextRates = d.data || [];
        royaltyRatesCache = nextRates;
        royaltyRatesCacheAt = Date.now();
        setRates(nextRates);
      })
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

  const fetchCollaborators = useCallback((preferCache = true) => {
    if (!isAdmin) {
      setCollaborators([]);
      return Promise.resolve();
    }

    const cacheKey = `${user?.id || 0}:${user?.teamId || 0}:${isLeader ? "leader" : "team"}`;
    if (
      preferCache
      && royaltyCollaboratorsCache
      && royaltyCollaboratorsCacheKey === cacheKey
      && Date.now() - royaltyCollaboratorsCacheAt < ROYALTY_COLLABORATORS_CACHE_TTL_MS
    ) {
      setCollaborators(royaltyCollaboratorsCache);
      return Promise.resolve();
    }

    return fetch("/api/collaborators?view=directory", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const nextCollaborators = d.data || [];
        royaltyCollaboratorsCache = nextCollaborators;
        royaltyCollaboratorsCacheAt = Date.now();
        royaltyCollaboratorsCacheKey = cacheKey;
        setCollaborators(nextCollaborators);
      })
      .catch(() => { });
  }, [isAdmin, isLeader, user?.id, user?.teamId]);

  useEffect(() => {
    void fetchDashboard(true, true);
  }, [fetchDashboard]);

  useEffect(() => {
    void fetchRates(true);
    void fetchCollaborators(true);
  }, [fetchCollaborators, fetchRates]);

  useEffect(() => {
    if (tab === "calculate") {
      fetchCalculation();
    }
  }, [fetchCalculation, tab]);

  useEffect(() => {
    if (tab === "workflow") {
      fetchPayments();
    }
  }, [fetchPayments, tab]);

  const refreshRoyaltyView = useCallback(() => {
    if (tab === "overview") {
      void fetchDashboard(false, false);
    }
    if (tab === "rates") void fetchRates(false);
    if (tab === "calculate") fetchCalculation();
    if (tab === "workflow") fetchPayments();
  }, [fetchCalculation, fetchDashboard, fetchPayments, fetchRates, tab]);

  const scheduleRoyaltyRefresh = useCallback(() => {
    if (typeof window === "undefined") {
      refreshRoyaltyView();
      return;
    }

    if (refreshTimeoutRef.current) {
      return;
    }

    refreshTimeoutRef.current = window.setTimeout(() => {
      refreshTimeoutRef.current = null;
      refreshRoyaltyView();
    }, 1500);
  }, [refreshRoyaltyView]);

  useEffect(() => () => {
    if (refreshTimeoutRef.current) {
      window.clearTimeout(refreshTimeoutRef.current);
    }
  }, []);

  useRealtimeRefresh(["royalty"], scheduleRoyaltyRefresh);

  const handleSetBudget = async () => {
    const amount = parseInt(budgetInput);
    if (isNaN(amount) || amount < 0) return;
    setBudgetSaving(true);
    await fetch("/api/royalty", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set-budget", month: overviewMonth, year: overviewYear, budgetAmount: amount }),
    });
    setBudgetSaving(false);
    void fetchDashboard(true, false);
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
  const contentBalance = dashboard?.contentBalance || {
    newArticles: 0,
    rewriteArticles: 0,
    totalArticles: 0,
    newPercentage: 0,
    rewritePercentage: 0,
    differencePercentage: 0,
    thresholdPercentage: 10,
    dominantType: null,
    isImbalanced: false,
    warningMessage: null,
  };
  const newAngle = Math.round((contentBalance.newPercentage / 100) * 360);
  const contentBalancePie = contentBalance.totalArticles > 0
    ? `conic-gradient(var(--accent-blue) 0deg ${newAngle}deg, var(--accent-orange) ${newAngle}deg 360deg)`
    : "conic-gradient(rgba(148, 163, 184, 0.16) 0deg 360deg)";
  const budgetFocusContributor = !isAdmin
    ? dashboard?.budget?.viewerContribution || null
    : dashboard?.topWriters?.[0] || null;
  const budgetFocusLabel = !isAdmin ? "CTV của bạn trong ngân sách tháng" : "CTV đang chiếm nhiều nhất tháng";

  return (
    <>
      <header className="page-shell-header">
        {!isMobile && (
          <div>
            <h2 style={{ fontSize: 32, fontWeight: 800, color: "var(--text-main)", letterSpacing: "-0.04em" }}>Nhuận bút</h2>
          </div>
        )}
      </header>

      <div style={{ 
        display: "flex", 
        gap: 8, 
        padding: isMobile ? 4 : 6, 
        background: "rgba(255,255,255,0.03)", 
        borderRadius: 16, 
        width: "100%", 
        maxWidth: "100%", 
        marginBottom: isMobile ? 18 : 32, 
        border: "1px solid var(--glass-border)", 
        overflowX: "auto",
        scrollbarWidth: "none"
      }}>
        {royaltyTabs.map(t => (
          <button
            key={t.id}
            data-testid={`royalty-tab-${t.id}`}
            onClick={() => setTab(t.id)}
            style={{
              padding: isMobile ? "8px 14px" : "10px 20px",
              borderRadius: 12,
              border: "none",
              background: tab === t.id ? "var(--accent-blue)" : "transparent",
              color: tab === t.id ? "#fff" : "var(--text-muted)",
              fontSize: isMobile ? 13 : 14,
              fontWeight: 700,
              display: "flex",
              flex: isMobile ? "1 0 auto" : "0 0 auto",
              justifyContent: "center",
              alignItems: "center",
              gap: 8,
              cursor: "pointer",
              transition: "all 0.2s var(--ease-apple)",
              whiteSpace: "nowrap"
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: isMobile ? 16 : 18 }}>{t.icon}</span>
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
              <div className="obsidian-glass" style={{ padding: 24, borderRadius: 24, marginBottom: 24, display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
                <div className="form-group" style={{ marginBottom: 0, width: 160 }}>
                  <label className="form-label">Kỳ đang xem</label>
                  <CustomSelect value={String(overviewMonth)} onChange={(value) => setOverviewMonth(parseInt(value, 10))} options={monthSelectOptions} />
                </div>
                <div className="form-group" style={{ marginBottom: 0, width: 120 }}>
                  <label className="form-label">Năm</label>
                  <CustomSelect value={String(overviewYear)} onChange={(value) => setOverviewYear(parseInt(value, 10))} options={yearSelectOptions} />
                </div>
              </div>

              {/* Budget Alert Card */}
              {hasBudget && budgetPct >= 80 && (
                <div className="glass-card" style={{ padding: "24px 32px", marginBottom: 32, display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap", borderLeft: `6px solid ${gaugeColor}`, background: `${gaugeColor}05` }}>
                  <div style={{ width: 56, height: 56, borderRadius: 16, background: `${gaugeColor}15`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 22, color: gaugeColor }}>{budgetPct >= 100 ? "priority_high" : "warning"}</span>
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

              {contentBalance.isImbalanced && (
                <div className="glass-card" style={{ padding: "20px 24px", marginBottom: 32, display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap", borderLeft: "6px solid var(--warning)", background: "rgba(245, 158, 11, 0.07)" }}>
                  <div style={{ width: 48, height: 48, borderRadius: 14, background: "rgba(245, 158, 11, 0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 28, color: "var(--warning)" }}>pie_chart</span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <h4 style={{ fontSize: 17, fontWeight: 800, color: "var(--text-main)" }}>Cảnh báo tỉ lệ bài viết</h4>
                    <p style={{ fontSize: 14, color: "var(--text-muted)", marginTop: 4 }}>
                      {contentBalance.warningMessage} Mức lệch hiện tại là {contentBalance.differencePercentage}% và đang vượt ngưỡng {contentBalance.thresholdPercentage}%.
                    </p>
                  </div>
                </div>
              )}

              <div className="royalty-overview-grid" style={{ marginBottom: 32, gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(auto-fit, minmax(220px, 1fr))", gap: isMobile ? 10 : 20 }}>
                {[
                  { label: "Tổng nhuận bút", value: fmt(dashboard.currentMonth?.totalAmount || 0), icon: "account_balance_wallet", color: "var(--accent-blue)" },
                  { label: "Nhuận viết", value: fmt(dashboard.currentMonth?.writerAmount || 0), icon: "edit_note", color: "var(--accent-teal)" },
                  { label: "Nhuận duyệt", value: fmt(dashboard.currentMonth?.reviewerAmount || 0), icon: "fact_check", color: "var(--accent-orange)" },
                  { label: "Bài viết", value: dashboard.currentMonth?.writerArticles || 0, icon: "article", color: "var(--accent-blue)" },
                  { label: "Bài duyệt", value: dashboard.currentMonth?.reviewerArticles || 0, icon: "task", color: "var(--accent-purple)" },
                  { label: "Cấp độ", value: "Silver", icon: "stars", color: "var(--accent-orange)" }
                ].map((s, i) => (
                  <div key={i} className="glass-card" style={{ display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "flex-start" : "center", gap: isMobile ? 8 : 20, padding: isMobile ? 12 : 20 }}>
                    <div style={{ width: isMobile ? 32 : 48, height: isMobile ? 32 : 48, borderRadius: isMobile ? 10 : 14, background: `${s.color}15`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <span className="material-symbols-outlined" style={{ fontSize: isMobile ? 18 : 24, color: s.color }}>{s.icon}</span>
                    </div>
                    <div>
                      <p style={{ fontSize: isMobile ? 10 : 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: isMobile ? 2 : 4 }}>{s.label}</p>
                      <p style={{ fontSize: isMobile ? 18 : 24, fontWeight: 800, color: "var(--text-main)" }}>{s.value}</p>
                    </div>
                  </div>
                ))}
              </div>

              {isLeader && (
                <div className="glass-card" style={{ padding: isMobile ? 16 : 24, marginBottom: 32, display: "flex", flexDirection: isMobile ? "column" : "row", gap: 16, alignItems: isMobile ? "stretch" : "flex-end", background: "rgba(0,0,0,0.01)" }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8, letterSpacing: "0.05em" }}>🎯 Ngân sách cho {monthNames[overviewMonth - 1]}/{overviewYear}</label>
                    <input className="form-input" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", height: 44 }} type="number" value={budgetInput} onChange={e => setBudgetInput(e.target.value)} placeholder="Nhập số tiền..." />
                  </div>
                  <button className="btn-ios-pill btn-ios-primary" onClick={handleSetBudget} disabled={budgetSaving} style={{ height: 44, justifyContent: "center" }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 20 }}>save</span>
                    Lưu
                  </button>
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(400px, 1fr))", gap: isMobile ? 16 : 32, marginBottom: 32 }}>
                <div className="card">
                  <h3 className="text-xl font-bold mb-8">Biểu đồ theo quý</h3>
                  <div className={isMobile ? "royalty-chart-horizontal" : "royalty-chart"}>
                    {dashboard.monthlyData?.map((m, i: number) => {
                      const heightPct = maxAmount > 0 ? Math.max((m.totalAmount / maxAmount) * 100, 2) : 2;
                      const isActivePeriod = m.month === overviewMonth && m.year === overviewYear;
                      if (!isMobile) {
                        return (
                          <div key={i} className="royalty-chart-bar">
                            <div className="royalty-chart-bar-fill" style={{ height: `${heightPct}%`, background: isActivePeriod ? "var(--accent-blue)" : "rgba(59, 130, 246, 0.15)" }}>
                              <div className="chart-tooltip">{fmt(m.totalAmount)}</div>
                            </div>
                            <span className="royalty-chart-bar-label">{monthNames[m.month - 1]}</span>
                          </div>
                        );
                      } else {
                        return (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                            <span style={{ width: 60, fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>{monthNames[m.month - 1]}</span>
                            <div style={{ flex: 1, height: 28, background: "rgba(255,255,255,0.03)", borderRadius: 8, overflow: "hidden", position: "relative" }}>
                              <div style={{ width: `${heightPct}%`, height: "100%", background: isActivePeriod ? "var(--accent-blue)" : "rgba(59, 130, 246, 0.15)", borderRadius: 8, transition: "width 0.8s ease" }} />
                              <span style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", fontSize: 10, fontWeight: 800, color: isActivePeriod ? "#fff" : "var(--text-main)" }}>{fmt(m.totalAmount)}</span>
                            </div>
                          </div>
                        );
                      }
                    })}
                  </div>
                </div>

                <div className="card text-center flex flex-col items-center justify-center">
                  <h3 className="text-xl font-bold mb-8">Mức sử dụng ngân sách</h3>
                  {hasBudget ? (
                    <>
                      <div className="budget-gauge" style={{ background: `conic-gradient(${gaugeColor} ${gaugeAngle}deg, rgba(0,0,0,0.02) ${gaugeAngle}deg)`, width: isMobile ? 180 : 220, height: isMobile ? 180 : 220 }}>
                        <div className="budget-gauge-inner" style={{ inset: isMobile ? 24 : 28 }}>
                          <div className="budget-gauge-percent" style={{ fontWeight: 800, color: "var(--text-main)", fontSize: isMobile ? 32 : 40 }}>{budgetPct}%</div>
                          <div className="budget-gauge-label" style={{ fontSize: isMobile ? 10 : 12 }}>DUNG LƯỢNG</div>
                        </div>
                      </div>
                      <div className="mt-8 font-bold text-sm text-muted">
                        {fmt(dashboard.budget.spent)} / {fmt(dashboard.budget.budgetAmount)}
                      </div>
                      {budgetFocusContributor && (
                        <div style={{ width: "100%", maxWidth: 360, marginTop: 20, padding: isMobile ? "14px 16px" : "16px 18px", borderRadius: 18, border: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.03)", textAlign: "left" }}>
                          <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                            {budgetFocusLabel}
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                            <div>
                              <div style={{ fontSize: 17, fontWeight: 800, color: "var(--text-main)" }}>{budgetFocusContributor.penName}</div>
                              <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
                                {fmt(budgetFocusContributor.amount)} • {budgetFocusContributor.writerArticles + budgetFocusContributor.reviewerArticles} lượt tính
                              </div>
                            </div>
                            <div style={{ textAlign: "right" }}>
                              <div style={{ fontSize: 22, fontWeight: 900, color: "var(--accent-blue)", lineHeight: 1 }}>
                                {fmtPct(budgetFocusContributor.budgetPercentage)}
                              </div>
                              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
                                ngân sách tháng
                              </div>
                            </div>
                          </div>
                          <div style={{ marginTop: 12, height: 8, borderRadius: 999, background: "rgba(148,163,184,0.14)", overflow: "hidden" }}>
                            <div style={{ width: `${Math.min(100, budgetFocusContributor.budgetPercentage)}%`, height: "100%", borderRadius: 999, background: "linear-gradient(90deg, var(--accent-blue), var(--accent-teal))" }} />
                          </div>
                          <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
                            Chiếm {fmtPct(budgetFocusContributor.spentSharePercentage)} phần chi đã dùng trong tháng.
                          </div>
                        </div>
                      )}
                    </>
                  ) : <div className="text-muted">Chưa đặt mục tiêu ngân sách.</div>}
                </div>

                <div className="card" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
                  <div style={{ width: "100%", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
                    <div style={{ textAlign: "left" }}>
                      <h3 className="text-xl font-bold">Tỉ lệ Viết mới / Viết lại</h3>
                    </div>
                    {contentBalance.isImbalanced && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 999, background: "rgba(245, 158, 11, 0.14)", color: "var(--warning)", fontSize: 12, fontWeight: 800 }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>warning</span>
                        Lệch {contentBalance.differencePercentage}%
                      </span>
                    )}
                  </div>

                  {contentBalance.totalArticles > 0 ? (
                    <>
                      <div style={{ position: "relative", width: isMobile ? 180 : 220, height: isMobile ? 180 : 220, borderRadius: "50%", background: contentBalancePie, boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.05)" }}>
                        <div style={{ position: "absolute", inset: isMobile ? 24 : 28, borderRadius: "50%", background: "var(--bg-card)", border: "1px solid var(--glass-border)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                          <div style={{ fontSize: isMobile ? 32 : 36, fontWeight: 900, color: "var(--text-main)", lineHeight: 1 }}>{contentBalance.totalArticles}</div>
                          <div style={{ marginTop: 6, fontSize: isMobile ? 10 : 12, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", maxWidth: isMobile ? 100 : "none" }}>Bài trong tháng</div>
                        </div>
                      </div>

                      <div style={{ width: "100%", display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginTop: 24 }}>
                        {[
                          { label: "Viết mới", count: contentBalance.newArticles, percentage: contentBalance.newPercentage, color: "var(--accent-blue)" },
                          { label: "Viết lại", count: contentBalance.rewriteArticles, percentage: contentBalance.rewritePercentage, color: "var(--accent-orange)" },
                        ].map((item) => (
                          <div key={item.label} style={{ padding: isMobile ? 14 : 16, borderRadius: 16, border: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.02)", textAlign: "left" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                              <span style={{ width: 12, height: 12, borderRadius: "50%", background: item.color, boxShadow: `0 0 0 4px ${item.color}20` }} />
                              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-main)" }}>{item.label}</span>
                            </div>
                            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                              <div style={{ fontSize: 28, fontWeight: 900, color: "var(--text-main)", lineHeight: 1 }}>{item.count}</div>
                              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{item.percentage}% tổng bài</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div style={{ width: "100%", minHeight: 220, borderRadius: 20, border: "1px dashed var(--glass-border)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 14 }}>
                      Chưa có bài CTV nào trong kỳ này để tính tỉ lệ nội dung.
                    </div>
                  )}
                </div>
              </div>

              {dashboard.topWriters?.length > 0 && (
                <div className="card">
                  <h3 className="text-xl font-bold mb-8">Bảng xếp hạng cộng tác viên</h3>
                  {dashboard.topWriters.map((w, i: number) => {
                    const maxW = dashboard.topWriters[0]?.amount || 1;
                    return (
                      <div key={i} className="obsidian-glass" style={{ display: "flex", alignItems: "center", gap: 20, padding: "16px 24px", borderRadius: 16, marginBottom: 12, border: "1px solid rgba(255,255,255,0.02)" }}>
                        <div className="text-xl font-black text-gradient-metallic" style={{ width: 40 }}>0{i + 1}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, color: "var(--text-main)" }}>{w.penName}</div>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                            {w.writerArticles > 0 && (
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 8px", borderRadius: 999, background: "rgba(13, 148, 136, 0.12)", color: "var(--accent-teal)", fontSize: 11, fontWeight: 800 }}>
                                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>edit_note</span>
                                Viết: {w.writerArticles} bài • {fmt(w.writerAmount)}
                              </span>
                            )}
                            {w.reviewerArticles > 0 && (
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 8px", borderRadius: 999, background: "rgba(249, 115, 22, 0.12)", color: "var(--accent-orange)", fontSize: 11, fontWeight: 800 }}>
                                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>fact_check</span>
                                Duyệt: {w.reviewerArticles} bài • {fmt(w.reviewerAmount)}
                              </span>
                            )}
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 8px", borderRadius: 999, background: "rgba(59, 130, 246, 0.12)", color: "var(--accent-blue)", fontSize: 11, fontWeight: 800 }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>pie_chart</span>
                              {hasBudget ? `${fmtPct(w.budgetPercentage)} ngân sách` : `${fmtPct(w.spentSharePercentage)} phần đã dùng`}
                            </span>
                          </div>
                        </div>
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
          <div className="price-card obsidian-glass" style={{ border: "1px solid rgba(249, 115, 22, 0.18)", background: "linear-gradient(135deg, rgba(249, 115, 22, 0.16), rgba(234, 88, 12, 0.06))" }}>
            <div className="price-card-header">
              <span className="material-symbols-outlined" style={{ fontSize: 20, color: "#f97316" }}>fact_check</span>
              <span>Duyệt bài</span>
            </div>
            <div className="price-card-body">
              <div className="price-card-col" style={{ width: "100%" }}>
                <span className="price-card-type rewrite">MỨC CỐ ĐỊNH</span>
                <span className="price-card-amount rewrite">{fmt(REVIEWER_ROYALTY_PRICE)}</span>
              </div>
            </div>
          </div>
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
        const totalWriterAmount = calculation.reduce((s: number, c) => s + c.writerAmount, 0);
        const totalReviewerAmount = calculation.reduce((s: number, c) => s + c.reviewerAmount, 0);
        const totalCalcArticles = calculation.reduce((s: number, c) => s + c.totalArticles, 0);
        const maxBreakdownTotal = breakdownEntries.length > 0 ? breakdownEntries[0][1].total : 1;

        return (
          <>
            <div className="obsidian-glass" style={{ 
              padding: isMobile ? 16 : 24, 
              borderRadius: 24, 
              marginBottom: isMobile ? 24 : 32, 
              display: "flex", 
              flexDirection: isMobile ? "column" : "row", 
              gap: 16, 
              alignItems: isMobile ? "stretch" : "flex-end" 
            }}>
              <div style={{ display: "flex", gap: 12 }}>
                <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
                  <label className="form-label">Tháng</label>
                  <CustomSelect value={String(calcMonth)} onChange={(value) => setCalcMonth(parseInt(value, 10))} options={monthSelectOptions} />
                </div>
                <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
                  <label className="form-label">Năm</label>
                  <CustomSelect value={String(calcYear)} onChange={(value) => setCalcYear(parseInt(value, 10))} options={yearSelectOptions} />
                </div>
              </div>
              {isAdmin && (
                <div className="form-group" style={{ marginBottom: 0, minWidth: isMobile ? "auto" : 200 }}>
                  <label className="form-label">Cộng tác viên</label>
                  <CustomSelect value={calcPenName} onChange={setCalcPenName} options={collaboratorSelectOptions} />
                </div>
              )}
              <button className="btn-ios-pill btn-ios-primary" onClick={fetchCalculation} style={{ height: 44, justifyContent: "center" }}>
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>refresh</span>
                {isMobile ? "Cập nhật" : "Cập nhật báo cáo"}
              </button>
            </div>

            {loading ? <div className="loading" style={{ padding: 60, fontSize: 18, color: "var(--accent-blue)" }}>⏳ Đang tính toán...</div> : calculation.length === 0 ? (
              <div className="empty-state"><div className="empty-state-icon">assessment</div><div className="empty-state-text">Không có dữ liệu cho kỳ đã chọn.</div></div>
            ) : (
              <>
                <div className="stats-grid mb-8">
                  <div className="stat-card blue"><div className="stat-label">Tổng chi trả</div><div className="stat-value">{fmt(totalCalcAmount)}</div><div className="stat-icon"><span className="material-symbols-outlined">account_balance</span></div></div>
                  <div className="stat-card green"><div className="stat-label">Nhuận viết</div><div className="stat-value">{fmt(totalWriterAmount)}</div><div className="stat-icon"><span className="material-symbols-outlined">edit_note</span></div></div>
                  <div className="stat-card orange"><div className="stat-label">Nhuận duyệt</div><div className="stat-value">{fmt(totalReviewerAmount)}</div><div className="stat-icon"><span className="material-symbols-outlined">fact_check</span></div></div>
                  <div className="stat-card blue"><div className="stat-label">Lượt tính nhuận</div><div className="stat-value">{totalCalcArticles}</div><div className="stat-icon"><span className="material-symbols-outlined">badge</span></div></div>
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

                {!isMobile ? (
                  <div className="glass-card" style={{ padding: 0, overflow: "hidden", marginTop: 32 }}>
                    <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.02)" }}>
                      <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text-main)" }}>Chi tiết theo CTV</h3>
                    </div>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead style={{ background: "rgba(255,255,255,0.01)", borderBottom: "1px solid var(--glass-border)" }}>
                          <tr>
                            <th style={{ padding: "12px 24px", textAlign: "left", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Cộng tác viên</th>
                            <th style={{ padding: "12px 24px", textAlign: "center", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Bài viết</th>
                            <th style={{ padding: "12px 24px", textAlign: "center", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Bài duyệt</th>
                            <th style={{ padding: "12px 24px", textAlign: "right", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Nhuận viết</th>
                            <th style={{ padding: "12px 24px", textAlign: "right", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Nhuận duyệt</th>
                            <th style={{ padding: "12px 24px", textAlign: "right", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Tổng nhuận bút</th>
                            <th style={{ padding: "12px 24px", textAlign: "right", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Chi tiết</th>
                          </tr>
                        </thead>
                        <tbody>
                          {calculation.map((c) => (
                            <React.Fragment key={c.penName}>
                              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.02)" }}>
                                <td style={{ padding: "16px 24px", fontWeight: 700, color: "var(--text-main)" }}>{c.penName}</td>
                                <td style={{ padding: "16px 24px", textAlign: "center", color: "var(--accent-teal)", fontWeight: 800 }}>{c.writerArticles}</td>
                                <td style={{ padding: "16px 24px", textAlign: "center", color: "var(--accent-purple)", fontWeight: 800 }}>{c.reviewerArticles}</td>
                                <td style={{ padding: "16px 24px", textAlign: "right", color: "var(--accent-teal)", fontWeight: 800 }}>{fmt(c.writerAmount)}</td>
                                <td style={{ padding: "16px 24px", textAlign: "right", color: "var(--accent-purple)", fontWeight: 800 }}>{fmt(c.reviewerAmount)}</td>
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
                                  <td colSpan={7} style={{ padding: "16px 24px", background: "rgba(255,255,255,0.01)" }}>
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
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 24 }}>
                    {calculation.map((c) => (
                      <div key={c.penName} className="glass-card" style={{ padding: 16 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                          <div>
                            <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text-main)" }}>{c.penName}</div>
                            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                              {c.writerArticles} bài viết • {c.reviewerArticles} bài duyệt
                            </div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontSize: 18, fontWeight: 900, color: "var(--accent-blue)" }}>{fmt(c.totalAmount)}</div>
                            <button 
                              onClick={() => setExpandedWriter(expandedWriter === c.penName ? null : c.penName)}
                              style={{ border: "none", background: "none", color: "var(--accent-blue)", fontSize: 12, fontWeight: 700, marginTop: 4, padding: 0 }}
                            >
                              {expandedWriter === c.penName ? "Ẩn chi tiết" : "Xem chi tiết"}
                            </button>
                          </div>
                        </div>
                        {expandedWriter === c.penName && (
                          <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--glass-border)", display: "flex", flexDirection: "column", gap: 10 }}>
                            {Object.entries(c.breakdown || {}).map(([k, v]: [string, RoyaltyBreakdownItem]) => (
                              <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <div>
                                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-main)" }}>{k}</div>
                                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{v.count} × {fmt(v.unitPrice)}</div>
                                </div>
                                <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text-main)" }}>{fmt(v.total)}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        );
      })()}

      {tab === "workflow" && (
        <>
          <div className="obsidian-glass" style={{ 
            padding: isMobile ? 16 : 24, 
            borderRadius: 24, 
            marginBottom: 24, 
            display: "flex", 
            flexDirection: isMobile ? "column" : "row", 
            gap: 16, 
            alignItems: isMobile ? "stretch" : "flex-end" 
          }}>
            <div style={{ display: "flex", gap: 12 }}>
              <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
                <label className="form-label">Tháng</label>
                <CustomSelect dataTestId="payment-month-select" value={String(paymentMonth)} onChange={(value) => setPaymentMonth(parseInt(value, 10))} options={monthSelectOptions} />
              </div>
              <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
                <label className="form-label">Năm</label>
                <CustomSelect dataTestId="payment-year-select" value={String(paymentYear)} onChange={(value) => setPaymentYear(parseInt(value, 10))} options={yearSelectOptions} />
              </div>
            </div>
            <div className="form-group" style={{ marginBottom: 0, width: isMobile ? "100%" : 180 }}>
              <label className="form-label">Trạng thái</label>
              <CustomSelect dataTestId="payment-status-select" value={paymentStatusFilter} onChange={setPaymentStatusFilter} options={paymentStatusOptions} />
            </div>
            {isAdmin && (
              <div className="form-group" style={{ marginBottom: 0, minWidth: isMobile ? "auto" : 220 }}>
                <label className="form-label">Cộng tác viên</label>
                <CustomSelect dataTestId="payment-penname-select" value={paymentPenName} onChange={setPaymentPenName} options={collaboratorSelectOptions} />
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: isMobile ? 8 : 0 }}>
              <button data-testid="payment-refresh-button" className="btn-ios-pill btn-ios-primary" onClick={fetchPayments} style={{ height: 44, flex: 1, justifyContent: "center" }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>refresh</span>
                {isMobile ? "Cập nhật" : "Cập nhật danh sách"}
              </button>
              {isAdmin && isMobile && (
                <button 
                  className="btn-ios-pill btn-ios-secondary" 
                  onClick={generatePayments} 
                  disabled={paymentGenerating} 
                  style={{ height: 44, flex: 1, justifyContent: "center" }}
                >
                   <span className="material-symbols-outlined" style={{ fontSize: 18 }}>calculate</span>
                </button>
              )}
            </div>
            {isAdmin && !isMobile && (
              <>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-muted)", marginBottom: 10 }}>
                  <input type="checkbox" checked={forceGenerate} onChange={(e) => setForceGenerate(e.target.checked)} />
                  Ghi đè
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
              Dữ liệu dưới đây đang hiển thị ở chế độ tạm tính theo các bài đã duyệt mới nhất của bạn. Khi admin tạo hoặc cập nhật bảng thanh toán, danh sách này sẽ tự đồng bộ sang dữ liệu chính thức.
            </div>
          )}

          {!isMobile ? (
            <div className="glass-card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead style={{ background: "rgba(255,255,255,0.02)", borderBottom: "1px solid var(--glass-border)" }}>
                    <tr>
                      <th style={{ padding: "12px 20px", textAlign: "left", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Cộng tác viên</th>
                      <th style={{ padding: "12px 20px", textAlign: "center", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Kỳ</th>
                      <th style={{ padding: "12px 20px", textAlign: "center", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Bài viết</th>
                      <th style={{ padding: "12px 20px", textAlign: "center", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Bài duyệt</th>
                      <th style={{ padding: "12px 20px", textAlign: "right", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Nhuận viết</th>
                      <th style={{ padding: "12px 20px", textAlign: "right", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Nhuận duyệt</th>
                      <th style={{ padding: "12px 20px", textAlign: "right", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Tổng tiền</th>
                      <th style={{ padding: "12px 20px", textAlign: "center", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Trạng thái</th>
                      <th style={{ padding: "12px 20px", textAlign: "right", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paymentsLoading ? (
                      <tr>
                        <td colSpan={9} style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>⏳ Đang tải thanh toán...</td>
                      </tr>
                    ) : payments.length === 0 ? (
                      <tr>
                        <td colSpan={9} style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
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
                            <td style={{ padding: "14px 20px", textAlign: "center", fontSize: 13, color: "var(--text-main)" }}>{p.writerArticles}</td>
                            <td style={{ padding: "14px 20px", textAlign: "center", fontSize: 13, color: "var(--text-main)" }}>{p.reviewerArticles}</td>
                            <td style={{ padding: "14px 20px", textAlign: "right", fontSize: 14, color: "var(--accent-teal)", fontWeight: 800 }}>{fmt(p.writerAmount)}</td>
                            <td style={{ padding: "14px 20px", textAlign: "right", fontSize: 14, color: "var(--accent-purple)", fontWeight: 800 }}>{fmt(p.reviewerAmount)}</td>
                            <td style={{ padding: "14px 20px", textAlign: "right", fontSize: 14, color: "var(--accent-blue)", fontWeight: 800 }}>{fmt(p.totalAmount)}</td>
                            <td style={{ padding: "14px 20px", textAlign: "center" }}>
                              <span style={{
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
                                <button className="btn-ios-pill btn-ios-secondary" style={{ padding: "6px 10px" }} onClick={() => setExpandedPaymentId(expandedPaymentId === p.id ? null : p.id)}>
                                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{expandedPaymentId === p.id ? "expand_less" : "expand_more"}</span>
                                </button>
                                {isAdmin && p.status === "pending" && (
                                  <button className="btn-ios-pill btn-ios-primary" style={{ padding: "6px 12px" }} disabled={paymentActionId === p.id} onClick={() => paymentAction(p.id, "approve")}>
                                    {paymentActionId === p.id ? "..." : "Duyệt"}
                                  </button>
                                )}
                                {isAdmin && p.status === "approved" && (
                                  <button className="btn-ios-pill btn-ios-secondary" style={{ padding: "6px 12px", borderColor: "rgba(16,185,129,0.3)", color: "#10b981" }} disabled={paymentActionId === p.id} onClick={() => paymentAction(p.id, "mark-paid")}>
                                    {paymentActionId === p.id ? "..." : "Đã trả"}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                          {expandedPaymentId === p.id && (
                            <tr>
                              <td colSpan={9} style={{ padding: "14px 20px", background: "rgba(255,255,255,0.02)" }}>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
                                  {Object.entries(p.details || {}).length === 0 ? (
                                    <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Không có chi tiết.</div>
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
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {paymentsLoading ? (
                <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>⏳ Đang tải...</div>
              ) : payments.length === 0 ? (
                <div className="empty-state">Chưa có dữ liệu thanh toán.</div>
              ) : (
                payments.map((p) => (
                  <div key={p.id} className="glass-card" style={{ padding: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                      <div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text-main)" }}>{p.penName}</div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>Kỳ {p.month}/{p.year}</div>
                      </div>
                      <span style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "3px 8px",
                        borderRadius: 6,
                        fontSize: 10,
                        fontWeight: 700,
                        color: p.isEstimated ? "#7c3aed" : p.status === "pending" ? "#f97316" : p.status === "approved" ? "#3b82f6" : "#10b981",
                        background: p.isEstimated ? "rgba(124,58,237,0.12)" : p.status === "pending" ? "rgba(249,115,22,0.12)" : p.status === "approved" ? "rgba(59,130,246,0.12)" : "rgba(16,185,129,0.12)",
                      }}>
                        {p.isEstimated ? "Tạm tính" : p.status === "pending" ? "Chờ" : p.status === "approved" ? "Duyệt" : "Đã trả"}
                      </span>
                    </div>
                    
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                      <div>
                        <p style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>Viết: {p.writerArticles}</p>
                        <p style={{ fontSize: 14, fontWeight: 700, color: "var(--accent-teal)" }}>{fmt(p.writerAmount)}</p>
                      </div>
                      <div>
                        <p style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>Duyệt: {p.reviewerArticles}</p>
                        <p style={{ fontSize: 14, fontWeight: 700, color: "var(--accent-purple)" }}>{fmt(p.reviewerAmount)}</p>
                      </div>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", paddingTop: 12, borderTop: "1px solid var(--glass-border)" }}>
                      <div>
                        <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase" }}>Tổng cộng</div>
                        <div style={{ fontSize: 18, fontWeight: 900, color: "var(--accent-blue)" }}>{fmt(p.totalAmount)}</div>
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button className="btn-ios-pill btn-ios-secondary" style={{ padding: "6px 10px", height: 36 }} onClick={() => setExpandedPaymentId(expandedPaymentId === p.id ? null : p.id)}>
                          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{expandedPaymentId === p.id ? "expand_less" : "expand_more"}</span>
                        </button>
                        {isAdmin && p.status === "pending" && (
                          <button className="btn-ios-pill btn-ios-primary" style={{ padding: "0 12px", fontSize: 12, height: 36 }} disabled={paymentActionId === p.id} onClick={() => paymentAction(p.id, "approve")}>Duyệt</button>
                        )}
                        {isAdmin && p.status === "approved" && (
                          <button className="btn-ios-pill btn-ios-success" style={{ padding: "0 12px", fontSize: 12, height: 36 }} disabled={paymentActionId === p.id} onClick={() => paymentAction(p.id, "mark-paid")}>Đã trả</button>
                        )}
                      </div>
                    </div>

                    {expandedPaymentId === p.id && (
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px dashed var(--glass-border)", display: "flex", flexDirection: "column", gap: 8 }}>
                        {Object.entries(p.details || {}).map(([k, v]) => (
                          <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                            <span style={{ color: "var(--text-muted)" }}>{k} ({v.count})</span>
                            <span style={{ fontWeight: 700 }}>{fmt(v.total)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}

/* ══════════════════════════ END OF ROYALTY PAGE ══════════════════════════ */

