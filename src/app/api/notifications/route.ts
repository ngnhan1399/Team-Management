import { db, ensureDatabaseInitialized } from "@/db";
import { notifications, users, collaborators } from "@/db/schema";
import { getCurrentUserContext, matchesIdentityCandidate } from "@/lib/auth";
import { createNotifications } from "@/lib/notifications";
import { publishRealtimeEvent } from "@/lib/realtime";
import { writeAuditLog } from "@/lib/audit";
import { enforceTrustedOrigin } from "@/lib/request-security";
import { handleServerError } from "@/lib/server-error";
import { eq, and, desc, sql, type SQL } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
    try {
        await ensureDatabaseInitialized();
        const context = await getCurrentUserContext();
        if (!context) {
            return NextResponse.json({ success: false, error: "Auth required" }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const unreadOnly = searchParams.get("unread") === "true";

        const conditions: SQL[] = [eq(notifications.toUserId, context.user.id)];
        if (unreadOnly) {
            conditions.push(eq(notifications.isRead, false));
        }

        const data = await db
            .select()
            .from(notifications)
            .where(and(...conditions))
            .orderBy(desc(notifications.id))
            .limit(50)
            .all();

        const unreadCount = await db
            .select({ count: sql<number>`count(*)` })
            .from(notifications)
            .where(and(eq(notifications.toUserId, context.user.id), eq(notifications.isRead, false)))
            .get();

        return NextResponse.json({
            success: true,
            data,
            unreadCount: unreadCount?.count || 0,
        });
    } catch (error) {
        return handleServerError("notifications.get", error);
    }
}

export async function POST(request: NextRequest) {
    try {
        await ensureDatabaseInitialized();
        const originError = enforceTrustedOrigin(request);
        if (originError) return originError;

        const context = await getCurrentUserContext();
        if (!context) {
            return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
        }
        if (context.user.role !== "admin") {
            return NextResponse.json({ success: false, error: "Admin required" }, { status: 403 });
        }

        const { toUserId, toPenName, type, title, message, relatedArticleId } = await request.json();

        if (!title || !message) {
            return NextResponse.json({ success: false, error: "Title and message required" }, { status: 400 });
        }

        const recipients: Array<{ userId: number; penName: string | null }> = [];

        if (toUserId) {
            const target = await db.select({ id: users.id }).from(users).where(eq(users.id, Number(toUserId))).get();
            if (target?.id) {
                recipients.push({ userId: target.id, penName: toPenName || null });
            }
        } else if (toPenName) {
            const targets = await db
                .select({ id: users.id, penName: collaborators.penName, name: collaborators.name })
                .from(users)
                .innerJoin(collaborators, eq(users.collaboratorId, collaborators.id))
                .all();

            const target = targets.find((item) => matchesIdentityCandidate([item.penName, item.name], toPenName));
            if (target?.id) {
                recipients.push({ userId: target.id, penName: target.penName ?? null });
            }
        } else {
            const broadcastTargets = await db
                .select({ id: users.id, penName: collaborators.penName })
                .from(users)
                .leftJoin(collaborators, eq(users.collaboratorId, collaborators.id))
                .where(sql`${users.id} != ${context.user.id}`)
                .all();

            for (const target of broadcastTargets) {
                recipients.push({ userId: target.id, penName: target.penName ?? null });
            }
        }

        if (recipients.length === 0) {
            return NextResponse.json({ success: false, error: "Không tìm thấy người nhận thông báo" }, { status: 404 });
        }

        await createNotifications(
            recipients.map((recipient) => ({
                fromUserId: context.user.id,
                toUserId: recipient.userId,
                toPenName: recipient.penName,
                type: type || "info",
                title,
                message,
                relatedArticleId,
            }))
        );

        await writeAuditLog({
            userId: context.user.id,
            action: "notification_sent",
            entity: "notification",
            payload: {
                toPenName,
                title,
                type: type || "info",
                recipientCount: recipients.length,
                broadcast: !toUserId && !toPenName,
            },
        });

        return NextResponse.json({ success: true, recipientCount: recipients.length });
    } catch (error) {
        return handleServerError("notifications.post", error);
    }
}

export async function PUT(request: NextRequest) {
    try {
        await ensureDatabaseInitialized();
        const originError = enforceTrustedOrigin(request);
        if (originError) return originError;

        const context = await getCurrentUserContext();
        if (!context) {
            return NextResponse.json({ success: false, error: "Auth required" }, { status: 401 });
        }

        const { id, markAllRead } = await request.json();

        if (markAllRead) {
            await db.update(notifications)
                .set({ isRead: true })
                .where(eq(notifications.toUserId, context.user.id))
                .run();
        } else if (id) {
            await db.update(notifications)
                .set({ isRead: true })
                .where(and(eq(notifications.id, id), eq(notifications.toUserId, context.user.id)))
                .run();
        }

        await publishRealtimeEvent({ channels: ["notifications"], userIds: [context.user.id] });

        return NextResponse.json({ success: true });
    } catch (error) {
        return handleServerError("notifications.put", error);
    }
}
