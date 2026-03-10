"use client";

import React, { useCallback, useEffect, useState } from "react";
import CustomSelect from "./CustomSelect";
import { useRealtimeRefresh } from "./realtime";

interface AuditLogItem {
  id: number;
  userId: number | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  payload: unknown;
  createdAt: string;
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState("");
  const [entityFilter, setEntityFilter] = useState("");
  const [limit, setLimit] = useState(100);
  const limitOptions = [50, 100, 200, 500].map((value) => ({ value: String(value), label: String(value) }));
  const [error, setError] = useState("");

  const formatPayload = (payload: unknown) => {
    if (payload === null || payload === undefined) return "—";
    if (typeof payload === "string") return payload;
    try {
      return JSON.stringify(payload, null, 2);
    } catch {
      return String(payload);
    }
  };

  const fetchLogs = useCallback(() => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ limit: String(limit) });
    if (actionFilter.trim()) params.set("action", actionFilter.trim());
    if (entityFilter.trim()) params.set("entity", entityFilter.trim());

    fetch(`/api/audit-logs?${params}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!d.success) {
          setError(d.error || "Không tải được audit logs");
          setLogs([]);
        } else {
          setLogs(d.data || []);
        }
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, [actionFilter, entityFilter, limit]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchLogs();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchLogs]);

  useRealtimeRefresh(["audit"], fetchLogs);

  const uniqueActions = Array.from(new Set(logs.map((l) => l.action))).sort();
  const uniqueEntities = Array.from(new Set(logs.map((l) => l.entity).filter(Boolean) as string[])).sort();

  return (
    <>
      <header className="page-shell-header" style={{ marginBottom: 28 }}>
        <div>
          <h2 style={{ fontSize: 32, fontWeight: 800, color: "var(--text-main)", letterSpacing: "-0.04em" }}>Audit Logs</h2>
          <p style={{ color: "var(--text-muted)", marginTop: 4, fontSize: 14 }}>Theo dõi ai đã thao tác gì, trên thực thể nào và thời điểm nào.</p>
        </div>
        <button className="btn-ios-pill btn-ios-primary" onClick={fetchLogs}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>refresh</span>
          Tải lại
        </button>
      </header>

      <div className="glass-card" style={{ padding: 20, marginBottom: 24 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, alignItems: "end" }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Lọc theo action</label>
            <input className="form-input" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} placeholder="VD: payment_approved" list="audit-actions" />
            <datalist id="audit-actions">
              {uniqueActions.map((a) => <option key={a} value={a} />)}
            </datalist>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Lọc theo entity</label>
            <input className="form-input" value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)} placeholder="VD: payment" list="audit-entities" />
            <datalist id="audit-entities">
              {uniqueEntities.map((e) => <option key={e} value={e} />)}
            </datalist>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Số dòng</label>
            <CustomSelect value={String(limit)} onChange={(value) => setLimit(parseInt(value, 10))} options={limitOptions} />
          </div>
          <button className="btn-ios-pill btn-ios-secondary" style={{ height: 44 }} onClick={() => { setActionFilter(""); setEntityFilter(""); setLimit(100); }}>
            Xóa lọc
          </button>
        </div>
        {error && <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 10, background: "rgba(239,68,68,0.08)", color: "#ef4444", fontSize: 13 }}>{error}</div>}
      </div>

      <div className="glass-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto", maxHeight: "calc(100vh - 340px)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 10, background: "rgba(248, 250, 252, 0.95)", borderBottom: "1px solid var(--glass-border)" }}>
              <tr>
                <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Thời gian</th>
                <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>User ID</th>
                <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Action</th>
                <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Entity</th>
                <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Payload</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} style={{ padding: 32, textAlign: "center", color: "var(--text-muted)" }}>⏳ Đang tải logs...</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: 32, textAlign: "center", color: "var(--text-muted)" }}>Không có dữ liệu.</td></tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} style={{ borderBottom: "1px solid var(--glass-border)", verticalAlign: "top" }}>
                    <td style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-main)", whiteSpace: "nowrap" }}>{new Date(log.createdAt).toLocaleString("vi-VN")}</td>
                    <td style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-main)" }}>{log.userId ?? "—"}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <code style={{ fontSize: 12, color: "#2563eb", background: "rgba(37,99,235,0.08)", padding: "3px 7px", borderRadius: 7 }}>{log.action}</code>
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-main)" }}>
                      {log.entity || "—"}{log.entityId ? ` #${log.entityId}` : ""}
                    </td>
                    <td style={{ padding: "12px 16px", minWidth: 320 }}>
                      <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>{formatPayload(log.payload)}</pre>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
