import { db, ensureDatabaseInitialized } from "@/db";
import { notifications } from "@/db/schema";
import { publishRealtimeEvent, type RealtimeToastVariant } from "@/lib/realtime";

type NotificationInput = {
  fromUserId?: number | null;
  toUserId: number;
  toPenName?: string | null;
  type?: "deadline" | "review" | "error_fix" | "comment" | "info" | "system";
  title: string;
  message: string;
  relatedArticleId?: number | null;
};

function getToastVariant(type: NotificationInput["type"]): RealtimeToastVariant {
  if (type === "deadline" || type === "review" || type === "error_fix" || type === "comment") return "warning";
  if (type === "system") return "success";
  return "info";
}

export async function createNotifications(items: NotificationInput[]) {
  const normalizedItems = items.filter((item) => item.toUserId);
  if (normalizedItems.length === 0) return;

  await ensureDatabaseInitialized();

  await db.transaction(async (tx) => {
    for (const item of normalizedItems) {
      await tx.insert(notifications)
        .values({
          fromUserId: item.fromUserId ?? null,
          toUserId: item.toUserId,
          toPenName: item.toPenName ?? null,
          type: item.type || "info",
          title: item.title,
          message: item.message,
          relatedArticleId: item.relatedArticleId ?? null,
        })
        .run();
    }
  });

  const sample = normalizedItems[0];
  await publishRealtimeEvent({
    channels: ["notifications"],
    userIds: Array.from(new Set(normalizedItems.map((item) => item.toUserId))),
    toastTitle: sample.title,
    toastMessage: sample.message,
    toastVariant: getToastVariant(sample.type || "info"),
  });
}

export async function createNotification(item: NotificationInput) {
  await createNotifications([item]);
}
