import { getCurrentUserContext } from "@/lib/auth";
import { getRealtimeEventsSince, subscribeRealtime, type RealtimeEvent } from "@/lib/realtime";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();
const REALTIME_KEEP_ALIVE_INTERVAL_MS = 25000;
const REALTIME_BACKFILL_POLL_INTERVAL_MS = 5000;

export async function GET(request: Request) {
  const context = await getCurrentUserContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  const initialLastEventIdHeader = request.headers.get("last-event-id");
  let lastEventId = Number(initialLastEventIdHeader || "0");
  let unsubscribe = () => { };
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  let poller: ReturnType<typeof setInterval> | null = null;

  const cleanup = () => {
    if (keepAlive) clearInterval(keepAlive);
    if (poller) clearInterval(poller);
    unsubscribe();
  };

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: RealtimeEvent | { channels: string[]; at: string; replayed?: boolean }) => {
        const eventId = "id" in payload ? payload.id : 0;
        if (eventId > 0) {
          lastEventId = Math.max(lastEventId, eventId);
        }

        const eventPrefix = eventId > 0 ? `id: ${eventId}\n` : "";
        controller.enqueue(encoder.encode(`${eventPrefix}data: ${JSON.stringify(payload)}\n\n`));
      };

      const flushPendingEvents = async () => {
        const pendingEvents = await getRealtimeEventsSince(context.user.id, lastEventId);
        for (const event of pendingEvents) {
          if (event.id <= lastEventId) {
            continue;
          }
          send({ ...event, replayed: true });
        }
      };

      unsubscribe = subscribeRealtime(context.user.id, send);
      send({ channels: ["connected"], at: new Date().toISOString() });

      // On a brand new page load we only want future realtime events.
      // Backlog replay is reserved for the browser's own SSE reconnects,
      // which provide Last-Event-ID automatically.
      if (initialLastEventIdHeader) {
        await flushPendingEvents();
      }

      keepAlive = setInterval(() => {
        controller.enqueue(encoder.encode(": keep-alive\n\n"));
      }, REALTIME_KEEP_ALIVE_INTERVAL_MS);

      poller = setInterval(() => {
        void flushPendingEvents();
      }, REALTIME_BACKFILL_POLL_INTERVAL_MS);
    },
    cancel() {
      cleanup();
    },
  });

  request.signal.addEventListener("abort", cleanup);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
