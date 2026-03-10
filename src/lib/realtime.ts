import { db, ensureDatabaseInitialized } from "@/db";
import { realtimeEvents, type RealtimeEventRow } from "@/db/schema";
import { and, asc, eq, gt, like, or } from "drizzle-orm";

export type RealtimeToastVariant = "info" | "success" | "warning" | "error";

export type RealtimeEvent = {
  id: number;
  channels: string[];
  at: string;
  replayed?: boolean;
  toastTitle?: string | null;
  toastMessage?: string | null;
  toastVariant?: RealtimeToastVariant | null;
};

type RealtimeListener = (event: RealtimeEvent) => void;

type PublishRealtimeInput = {
  channels: string[];
  userIds?: number[];
  toastTitle?: string;
  toastMessage?: string;
  toastVariant?: RealtimeToastVariant;
};

const subscribers = new Map<string, { userId: number; listener: RealtimeListener }>();

function serializeChannels(channels: string[]) {
  return JSON.stringify(Array.from(new Set(channels.filter(Boolean))));
}

function deserializeChannels(raw: string) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function buildUserScope(userIds?: number[]) {
  if (!userIds || userIds.length === 0) return "*";
  const normalized = Array.from(new Set(userIds.filter((id) => Number.isInteger(id) && id > 0))).sort((a, b) => a - b);
  return normalized.length > 0 ? `|${normalized.join("|")}|` : "*";
}

function mapRowToEvent(row: RealtimeEventRow): RealtimeEvent {
  return {
    id: row.id,
    channels: deserializeChannels(row.channels),
    at: row.createdAt,
    toastTitle: row.toastTitle,
    toastMessage: row.toastMessage,
    toastVariant: row.toastVariant,
  };
}

function matchesUserScope(userScope: string, userId: number) {
  return userScope === "*" || userScope.includes(`|${userId}|`);
}

export function subscribeRealtime(userId: number, listener: RealtimeListener) {
  const subscriberId = crypto.randomUUID();
  subscribers.set(subscriberId, { userId, listener });

  return () => {
    subscribers.delete(subscriberId);
  };
}

export async function getRealtimeEventsSince(userId: number, lastEventId: number, limit = 100): Promise<RealtimeEvent[]> {
  await ensureDatabaseInitialized();
  const rows = await db
    .select()
    .from(realtimeEvents)
    .where(
      and(
        gt(realtimeEvents.id, lastEventId),
        or(
          eq(realtimeEvents.userScope, "*"),
          like(realtimeEvents.userScope, `%|${userId}|%`)
        )
      )
    )
    .orderBy(asc(realtimeEvents.id))
    .limit(limit)
    .all();

  return rows.map(mapRowToEvent);
}

export async function publishRealtimeEvent(
  input: PublishRealtimeInput | string[],
  maybeUserIds?: number[]
) {
  const normalized: PublishRealtimeInput = Array.isArray(input)
    ? { channels: input, userIds: maybeUserIds }
    : input;

  const channels = Array.from(new Set((normalized.channels || []).filter(Boolean)));
  if (channels.length === 0) return null;

  await ensureDatabaseInitialized();

  const createdAt = new Date().toISOString();
  const userScope = buildUserScope(normalized.userIds);
  const insertedEvent = await db
    .insert(realtimeEvents)
    .values({
      channels: serializeChannels(channels),
      userScope,
      toastTitle: normalized.toastTitle || null,
      toastMessage: normalized.toastMessage || null,
      toastVariant: normalized.toastVariant || "info",
      createdAt,
    })
    .returning({ id: realtimeEvents.id })
    .get();

  const event: RealtimeEvent = {
    id: Number(insertedEvent?.id || 0),
    channels,
    at: createdAt,
    toastTitle: normalized.toastTitle || null,
    toastMessage: normalized.toastMessage || null,
    toastVariant: normalized.toastVariant || "info",
  };

  for (const [subscriberId, subscriber] of subscribers.entries()) {
    if (!matchesUserScope(userScope, subscriber.userId)) {
      continue;
    }

    try {
      subscriber.listener(event);
    } catch {
      subscribers.delete(subscriberId);
    }
  }

  return event;
}

