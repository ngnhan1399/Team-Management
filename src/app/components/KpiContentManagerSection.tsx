"use client";

import React, { useMemo } from "react";
import type { KpiContentRegistrationBatchItem } from "./types";

const compactNumber = new Intl.NumberFormat("vi-VN");

function padMonth(value: number) {
  return String(value).padStart(2, "0");
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Chua co";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function getStatusTone(status: KpiContentRegistrationBatchItem["status"]) {
  switch (status) {
    case "completed":
      return {
        background: "rgba(16, 185, 129, 0.12)",
        color: "#047857",
        border: "1px solid rgba(16, 185, 129, 0.18)",
      };
    case "failed":
      return {
        background: "rgba(239, 68, 68, 0.08)",
        color: "#b91c1c",
        border: "1px solid rgba(239, 68, 68, 0.18)",
      };
    case "form_submitted":
      return {
        background: "rgba(59, 130, 246, 0.1)",
        color: "#1d4ed8",
        border: "1px solid rgba(59, 130, 246, 0.18)",
      };
    default:
      return {
        background: "rgba(245, 158, 11, 0.1)",
        color: "#b45309",
        border: "1px solid rgba(245, 158, 11, 0.18)",
      };
  }
}

function batchMatchesPeriod(batch: KpiContentRegistrationBatchItem, month: number, year: number) {
  const prefix = `${year}-${padMonth(month)}-`;
  return batch.registrations.some((registration) => String(registration.articleDate || "").startsWith(prefix))
    || String(batch.createdAt || "").startsWith(prefix);
}

type KpiContentManagerSectionProps = {
  batches: KpiContentRegistrationBatchItem[];
  loading: boolean;
  error: string;
  month: number;
  year: number;
  isMobile: boolean;
};

export default function KpiContentManagerSection({
  batches,
  loading,
  error,
  month,
  year,
  isMobile,
}: KpiContentManagerSectionProps) {
  const filteredBatches = useMemo(
    () => batches.filter((batch) => batchMatchesPeriod(batch, month, year)),
    [batches, month, year],
  );

  const summary = useMemo(() => ({
    total: filteredBatches.length,
    queued: filteredBatches.filter((batch) => batch.status === "queued" || batch.status === "submitting_form").length,
    completed: filteredBatches.filter((batch) => batch.status === "completed").length,
    articles: filteredBatches.reduce((sum, batch) => sum + batch.registrations.length, 0),
  }), [filteredBatches]);

  return (
    <section className="card" style={{ padding: isMobile ? 18 : 24, borderRadius: 28 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 28, fontWeight: 900, color: "var(--text-main)" }}>KPI Content noi bo</h2>
          <p style={{ margin: "8px 0 0", fontSize: 14, color: "var(--text-muted)", lineHeight: 1.6 }}>
            Leader/admin dang ky KPI Content ngay tren bai viet. He thong se tu gom toi da 5 bai bien tap cung nhom de gui vao mot form.
          </p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))", gap: 10, minWidth: isMobile ? "100%" : 420 }}>
          <div style={{ padding: "12px 14px", borderRadius: 16, background: "rgba(168, 85, 247, 0.08)", border: "1px solid rgba(168, 85, 247, 0.12)" }}>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>Batch ky nay</p>
            <p style={{ margin: "8px 0 0", fontSize: 22, fontWeight: 900 }}>{compactNumber.format(summary.total)}</p>
          </div>
          <div style={{ padding: "12px 14px", borderRadius: 16, background: "rgba(245, 158, 11, 0.08)", border: "1px solid rgba(245, 158, 11, 0.12)" }}>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>Dang xu ly</p>
            <p style={{ margin: "8px 0 0", fontSize: 22, fontWeight: 900 }}>{compactNumber.format(summary.queued)}</p>
          </div>
          <div style={{ padding: "12px 14px", borderRadius: 16, background: "rgba(16, 185, 129, 0.08)", border: "1px solid rgba(16, 185, 129, 0.12)" }}>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>Hoan thanh</p>
            <p style={{ margin: "8px 0 0", fontSize: 22, fontWeight: 900 }}>{compactNumber.format(summary.completed)}</p>
          </div>
          <div style={{ padding: "12px 14px", borderRadius: 16, background: "rgba(37, 99, 235, 0.08)", border: "1px solid rgba(37, 99, 235, 0.12)" }}>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>Tong bai</p>
            <p style={{ margin: "8px 0 0", fontSize: 22, fontWeight: 900 }}>{compactNumber.format(summary.articles)}</p>
          </div>
        </div>
      </div>

      {error ? (
        <div style={{ marginBottom: 16, padding: "12px 14px", borderRadius: 16, border: "1px solid rgba(245, 158, 11, 0.18)", background: "rgba(255, 247, 237, 0.9)", color: "#9a3412" }}>
          {error}
        </div>
      ) : null}

      {loading && filteredBatches.length === 0 ? (
        <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>Dang tai danh sach KPI Content...</div>
      ) : filteredBatches.length === 0 ? (
        <div style={{ padding: 24, borderRadius: 22, border: "1px dashed rgba(148, 163, 184, 0.28)", color: "var(--text-muted)", textAlign: "center" }}>
          Chua co batch KPI Content nao cho ky {month}/{year}.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          {filteredBatches.map((batch) => {
            const tone = getStatusTone(batch.status);
            return (
              <article key={batch.batchKey} style={{ border: "1px solid rgba(148, 163, 184, 0.16)", borderRadius: 24, padding: isMobile ? 16 : 18, background: "rgba(255,255,255,0.72)" }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                      <h3 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: "var(--text-main)" }}>{batch.taskLabel}</h3>
                      <span style={{ padding: "6px 10px", borderRadius: 999, fontSize: 11, fontWeight: 800, ...tone }}>{batch.statusLabel}</span>
                    </div>
                    <p style={{ margin: "8px 0 0", fontSize: 14, color: "var(--text-muted)" }}>
                      {batch.detailLabel} • {batch.employeeCode}
                      {batch.requestedByDisplayName ? ` • ${batch.requestedByDisplayName}` : ""}
                    </p>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: isMobile ? "flex-start" : "flex-end" }}>
                    <span style={{ padding: "8px 10px", borderRadius: 999, background: "rgba(15, 23, 42, 0.04)", fontSize: 12, fontWeight: 700, color: "var(--text-main)" }}>
                      {batch.registrations.length}/{batch.batchSize} bai
                    </span>
                    {batch.formUrl ? (
                      <a
                        href={batch.formUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-ios-pill btn-ios-secondary"
                        style={{ padding: "8px 12px", textDecoration: "none" }}
                      >
                        Mo form
                      </a>
                    ) : null}
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(0, 1fr))", gap: 10, marginTop: 14 }}>
                  <div style={{ padding: "12px 14px", borderRadius: 16, background: "rgba(15, 23, 42, 0.03)" }}>
                    <p style={{ margin: 0, fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: "var(--text-muted)" }}>Tao luc</p>
                    <p style={{ margin: "8px 0 0", fontSize: 14, fontWeight: 700, color: "var(--text-main)" }}>{formatDateTime(batch.createdAt)}</p>
                  </div>
                  <div style={{ padding: "12px 14px", borderRadius: 16, background: "rgba(15, 23, 42, 0.03)" }}>
                    <p style={{ margin: 0, fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: "var(--text-muted)" }}>Da gui form</p>
                    <p style={{ margin: "8px 0 0", fontSize: 14, fontWeight: 700, color: "var(--text-main)" }}>{formatDateTime(batch.submittedAt)}</p>
                  </div>
                  <div style={{ padding: "12px 14px", borderRadius: 16, background: "rgba(15, 23, 42, 0.03)" }}>
                    <p style={{ margin: 0, fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: "var(--text-muted)" }}>Hoan tat</p>
                    <p style={{ margin: "8px 0 0", fontSize: 14, fontWeight: 700, color: "var(--text-main)" }}>{formatDateTime(batch.completedAt)}</p>
                  </div>
                </div>

                {(batch.automationMessage || batch.lastError) ? (
                  <div style={{
                    marginTop: 14,
                    padding: "12px 14px",
                    borderRadius: 16,
                    background: batch.status === "failed" ? "rgba(254, 242, 242, 0.95)" : "rgba(245, 158, 11, 0.08)",
                    border: batch.status === "failed"
                      ? "1px solid rgba(239, 68, 68, 0.18)"
                      : "1px solid rgba(245, 158, 11, 0.14)",
                    color: batch.status === "failed" ? "#991b1b" : "#92400e",
                    fontSize: 13,
                    lineHeight: 1.6,
                  }}>
                    {batch.lastError || batch.automationMessage}
                  </div>
                ) : null}

                <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
                  {batch.registrations.map((registration) => (
                    <div key={registration.id} style={{ display: "flex", gap: 12, alignItems: "flex-start", justifyContent: "space-between", padding: "12px 14px", borderRadius: 18, background: "rgba(248, 250, 252, 0.9)" }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <span style={{ padding: "4px 8px", borderRadius: 999, background: "rgba(168, 85, 247, 0.08)", color: "#7c3aed", fontSize: 11, fontWeight: 800 }}>
                            Link {registration.batchPosition}
                          </span>
                          <strong style={{ fontSize: 14, color: "var(--text-main)" }}>{registration.title}</strong>
                        </div>
                        <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
                          {registration.articleDate} • {registration.statusLabel}
                        </p>
                      </div>
                      {registration.articleLink ? (
                        <a
                          href={registration.articleLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-ios-pill btn-ios-secondary"
                          style={{ padding: "8px 12px", textDecoration: "none", whiteSpace: "nowrap" }}
                        >
                          Mo bai
                        </a>
                      ) : null}
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
