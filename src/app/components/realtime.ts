"use client";

import { useEffect } from "react";
import type { RealtimeToastVariant } from "@/lib/realtime";

export const REALTIME_EVENT_NAME = "ctv-realtime";

export type RealtimePayload = {
  id?: number;
  channels: string[];
  at: string;
  replayed?: boolean;
  toastTitle?: string | null;
  toastMessage?: string | null;
  toastVariant?: RealtimeToastVariant | null;
};

export function emitRealtimePayload(payload: RealtimePayload) {
  window.dispatchEvent(new CustomEvent<RealtimePayload>(REALTIME_EVENT_NAME, { detail: payload }));
}

export function useRealtimeRefresh(channels: string[], onRefresh: () => void) {
  const signature = channels.slice().sort().join("|");

  useEffect(() => {
    const watchedChannels = signature ? signature.split("|") : [];
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<RealtimePayload>).detail;
      if (!detail?.channels?.some((channel) => watchedChannels.includes(channel))) return;
      onRefresh();
    };

    window.addEventListener(REALTIME_EVENT_NAME, listener as EventListener);
    return () => window.removeEventListener(REALTIME_EVENT_NAME, listener as EventListener);
  }, [signature, onRefresh]);
}
