"use client";

import React, { useEffect, useRef, useState } from "react";
import { REALTIME_EVENT_NAME, type RealtimePayload } from "./realtime";

type ToastItem = {
  id: number;
  title: string;
  message: string;
  variant: "info" | "success" | "warning" | "error";
};

const VARIANT_STYLES: Record<ToastItem["variant"], { color: string; background: string; icon: string }> = {
  info: { color: "#2563eb", background: "rgba(37,99,235,0.12)", icon: "info" },
  success: { color: "#059669", background: "rgba(5,150,105,0.12)", icon: "check_circle" },
  warning: { color: "#d97706", background: "rgba(217,119,6,0.14)", icon: "warning" },
  error: { color: "#dc2626", background: "rgba(220,38,38,0.12)", icon: "error" },
};

export default function RealtimeToastLayer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timeoutMap = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const timeoutStore = timeoutMap.current;

    const dismissToast = (id: number) => {
      const timeoutId = timeoutStore.get(id);
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutStore.delete(id);
      }
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    };

    const listener = (event: Event) => {
      const detail = (event as CustomEvent<RealtimePayload>).detail;
      if (detail?.replayed) return;
      if (!detail?.toastTitle || !detail?.toastMessage) return;

      const toastId = detail.id || Date.now();
      const title = detail.toastTitle;
      const message = detail.toastMessage;
      const variant = (detail.toastVariant || "info") as ToastItem["variant"];

      setToasts((prev) => {
        if (prev.some((toast) => toast.id === toastId)) {
          return prev;
        }

        return [
          ...prev,
          {
            id: toastId,
            title,
            message,
            variant,
          },
        ].slice(-4);
      });

      const timeoutId = setTimeout(() => dismissToast(toastId), 5000);
      timeoutStore.set(toastId, timeoutId);
    };

    window.addEventListener(REALTIME_EVENT_NAME, listener as EventListener);
    return () => {
      window.removeEventListener(REALTIME_EVENT_NAME, listener as EventListener);
      for (const timeoutId of timeoutStore.values()) {
        clearTimeout(timeoutId);
      }
      timeoutStore.clear();
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div style={{ position: "fixed", top: 24, right: 24, zIndex: 1200, display: "flex", flexDirection: "column", gap: 12, width: "min(360px, calc(100vw - 32px))", pointerEvents: "none" }}>
      {toasts.map((toast) => {
        const style = VARIANT_STYLES[toast.variant];
        return (
          <div key={toast.id} style={{ pointerEvents: "auto", borderRadius: 20, background: "rgba(255,255,255,0.92)", border: "1px solid rgba(148,163,184,0.18)", boxShadow: "0 18px 40px rgba(15,23,42,0.18)", backdropFilter: "blur(18px)", padding: "14px 16px", display: "flex", gap: 12, alignItems: "flex-start" }}>
            <div style={{ width: 38, height: 38, borderRadius: 12, background: style.background, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 20, color: style.color }}>{style.icon}</span>
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text-main)", marginBottom: 4 }}>{toast.title}</div>
              <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--text-muted)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{toast.message}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
