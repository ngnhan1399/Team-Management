import { db, ensureDatabaseInitialized } from "@/db";
import { auditLogs } from "@/db/schema";
import { publishRealtimeEvent } from "@/lib/realtime";

export async function writeAuditLog(input: {
    userId?: number | null;
    action: string;
    entity: string;
    entityId?: string | number | null;
    payload?: unknown;
}) {
    try {
        await ensureDatabaseInitialized();
        await db.insert(auditLogs)
            .values({
                userId: input.userId ?? null,
                action: input.action,
                entity: input.entity,
                entityId: input.entityId !== undefined && input.entityId !== null ? String(input.entityId) : null,
                payload: input.payload !== undefined ? JSON.stringify(input.payload) : null,
            })
            .run();

        await publishRealtimeEvent(["audit"]);
    } catch (error) {
        console.error("Failed to write audit log", error);
    }
}
