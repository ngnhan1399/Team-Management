import { db, ensureDatabaseInitialized } from "@/db";
import { editorialTasks, users, collaborators } from "@/db/schema";
import { getCurrentUserContext, matchesIdentityCandidate } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { createNotification } from "@/lib/notifications";
import { publishRealtimeEvent } from "@/lib/realtime";
import { enforceTrustedOrigin } from "@/lib/request-security";
import { handleServerError } from "@/lib/server-error";
import { getContextTeamId, isLeader } from "@/lib/teams";
import { and, eq, lte, ne } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

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
      return NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 });
    }

    const now = new Date().toISOString();
    const adminTeamId = !isLeader(context) ? getContextTeamId(context) : null;
    if (!isLeader(context) && !adminTeamId) {
      return NextResponse.json({ success: true, checked: 0, notified: 0 });
    }
    const dueTaskConditions = [
      lte(editorialTasks.remindAt, now),
      ne(editorialTasks.status, "done"),
      adminTeamId ? eq(editorialTasks.teamId, adminTeamId) : null,
    ].filter(Boolean);
    const dueTasks = await db
      .select()
      .from(editorialTasks)
      .where(and(...dueTaskConditions))
      .all();

    let notified = 0;
    const assigneeCandidates = await db
      .select({ id: users.id, penName: collaborators.penName, name: collaborators.name, teamId: users.teamId })
      .from(users)
      .innerJoin(collaborators, eq(users.collaboratorId, collaborators.id))
      .where(adminTeamId ? eq(users.teamId, adminTeamId) : undefined)
      .all();

    for (const task of dueTasks) {
      const assigneeUser = assigneeCandidates.find((item) =>
        matchesIdentityCandidate([item.penName, item.name], task.assigneePenName)
      );

      if (assigneeUser?.id) {
        await createNotification({
          fromUserId: context.user.id,
          toUserId: assigneeUser.id,
          toPenName: task.assigneePenName,
          type: "deadline",
          title: "⏰ Nhac viec bien tap",
          message: `Task "${task.title}" sap toi han (${task.dueDate})`,
        });

        notified += 1;
      }

      await db.update(editorialTasks)
        .set({ remindAt: null, updatedAt: new Date().toISOString() })
        .where(eq(editorialTasks.id, task.id))
        .run();
    }

    await writeAuditLog({
      userId: context.user.id,
      action: "editorial_task_reminders_sent",
      entity: "editorial_task",
      payload: { tasks: dueTasks.length, notified },
    });

    await publishRealtimeEvent(["tasks"]);

    return NextResponse.json({ success: true, checked: dueTasks.length, notified });
  } catch (error) {
    return handleServerError("editorial-tasks.reminders.post", error);
  }
}
