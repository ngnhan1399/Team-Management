import { db, ensureDatabaseInitialized } from "@/db";
import { editorialTasks, collaborators, users } from "@/db/schema";
import { getContextIdentityCandidates, getCurrentUserContext, matchesIdentityCandidate } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { createNotification } from "@/lib/notifications";
import { publishRealtimeEvent } from "@/lib/realtime";
import { enforceTrustedOrigin } from "@/lib/request-security";
import { handleServerError } from "@/lib/server-error";
import { canAccessTeam, getContextTeamId, isLeader, normalizeTeamId, resolveScopedTeamId } from "@/lib/teams";
import { eq, and, desc, type SQL } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { requiredString, requiredInt, optionalString, optionalEnum, ValidationError } from "@/lib/validation";

const TASK_STATUS = ["todo", "in_progress", "done", "overdue"] as const;
const TASK_PRIORITY = ["low", "medium", "high"] as const;

export async function GET(request: NextRequest) {
  try {
    await ensureDatabaseInitialized();
    const context = await getCurrentUserContext();
    if (!context) {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    }

    const searchParams = new URL(request.url).searchParams;
    const status = optionalEnum(searchParams.get("status"), TASK_STATUS);
    const assignee = optionalString(searchParams.get("assigneePenName"));
    const identityCandidates = getContextIdentityCandidates(context);
    const adminTeamId = context.user.role === "admin" && !isLeader(context) ? getContextTeamId(context) : null;

    const conditions: SQL[] = [];
    if (status) conditions.push(eq(editorialTasks.status, status));

    if (context.user.role === "admin") {
      if (!isLeader(context) && !adminTeamId) {
        return NextResponse.json({ success: true, data: [] });
      }
      if (adminTeamId) conditions.push(eq(editorialTasks.teamId, adminTeamId));
      if (assignee) conditions.push(eq(editorialTasks.assigneePenName, assignee));
    } else if (identityCandidates.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    let data = await db
      .select({
        id: editorialTasks.id,
        teamId: editorialTasks.teamId,
        title: editorialTasks.title,
        description: editorialTasks.description,
        assigneePenName: editorialTasks.assigneePenName,
        dueDate: editorialTasks.dueDate,
        remindAt: editorialTasks.remindAt,
        status: editorialTasks.status,
        priority: editorialTasks.priority,
        createdByUserId: editorialTasks.createdByUserId,
        createdAt: editorialTasks.createdAt,
        updatedAt: editorialTasks.updatedAt,
      })
      .from(editorialTasks)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(editorialTasks.id))
      .limit(100)
      .all();

    if (context.user.role !== "admin") {
      data = data.filter((task) => matchesIdentityCandidate(identityCandidates, task.assigneePenName));
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    return handleServerError("editorial-tasks.get", error);
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
      return NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const title = requiredString(body.title, "title", 2);
    const assigneePenName = requiredString(body.assigneePenName, "assigneePenName");
    const dueDate = requiredString(body.dueDate, "dueDate");
    const description = optionalString(body.description);
    const remindAt = optionalString(body.remindAt);
    const status = optionalEnum(body.status, TASK_STATUS) || "todo";
    const priority = optionalEnum(body.priority, TASK_PRIORITY) || "medium";
    const requestedTeamId = normalizeTeamId(body.teamId);
    const assigneeCollaborator = await db
      .select({ id: collaborators.id, teamId: collaborators.teamId })
      .from(collaborators)
      .where(eq(collaborators.penName, assigneePenName))
      .get();
    const teamId = isLeader(context)
      ? requestedTeamId ?? assigneeCollaborator?.teamId ?? getContextTeamId(context)
      : resolveScopedTeamId(context, body.teamId);

    if (!teamId) {
      return NextResponse.json({ success: false, error: "Không xác định được team của task" }, { status: 400 });
    }
    if (assigneeCollaborator?.teamId && assigneeCollaborator.teamId !== teamId) {
      return NextResponse.json({ success: false, error: "Người nhận không thuộc team đã chọn" }, { status: 400 });
    }

    const createdTask = await db
      .insert(editorialTasks)
      .values({
        teamId,
        title,
        assigneePenName,
        dueDate,
        description,
        remindAt,
        status,
        priority,
        createdByUserId: context.user.id,
      })
      .returning({ id: editorialTasks.id })
      .get();

    const assigneeCandidates = await db
      .select({ id: users.id, penName: collaborators.penName, name: collaborators.name, teamId: users.teamId })
      .from(users)
      .innerJoin(collaborators, eq(users.collaboratorId, collaborators.id))
      .where(eq(users.teamId, teamId))
      .all();

    const assigneeUser = assigneeCandidates.find((item) => matchesIdentityCandidate([item.penName, item.name], assigneePenName));

    if (assigneeUser?.id) {
      await createNotification({
        fromUserId: context.user.id,
        toUserId: assigneeUser.id,
        toPenName: assigneePenName,
        type: "deadline",
        title: "📅 Ban co task bien tap moi",
        message: `Task: ${title} (Deadline: ${dueDate})`,
      });
    }

    await writeAuditLog({
      userId: context.user.id,
      action: "editorial_task_created",
      entity: "editorial_task",
      entityId: String(createdTask?.id),
      payload: { assigneePenName, dueDate, priority },
    });

    await publishRealtimeEvent(["tasks"]);

    return NextResponse.json({ success: true, id: Number(createdTask?.id) });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    return handleServerError("editorial-tasks.post", error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    await ensureDatabaseInitialized();
    const originError = enforceTrustedOrigin(request);
    if (originError) return originError;

    const context = await getCurrentUserContext();
    if (!context) {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const id = requiredInt(body.id, "id");

    const existing = await db.select().from(editorialTasks).where(eq(editorialTasks.id, id)).get();
    if (!existing) {
      return NextResponse.json({ success: false, error: "Task not found" }, { status: 404 });
    }
    if (!canAccessTeam(context, existing.teamId)) {
      return NextResponse.json({ success: false, error: "Permission denied" }, { status: 403 });
    }

    const identityCandidates = getContextIdentityCandidates(context);
    if (context.user.role !== "admin" && !matchesIdentityCandidate(identityCandidates, existing.assigneePenName)) {
      return NextResponse.json({ success: false, error: "Permission denied" }, { status: 403 });
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };

    if (context.user.role === "admin") {
      const title = optionalString(body.title);
      const description = optionalString(body.description);
      const dueDate = optionalString(body.dueDate);
      const remindAt = optionalString(body.remindAt);
      const assigneePenName = optionalString(body.assigneePenName);
      const status = optionalEnum(body.status, TASK_STATUS);
      const priority = optionalEnum(body.priority, TASK_PRIORITY);

      if (title) updateData.title = title;
      if (description !== undefined) updateData.description = description;
      if (dueDate) updateData.dueDate = dueDate;
      if (remindAt !== undefined) updateData.remindAt = remindAt;
      if (assigneePenName) updateData.assigneePenName = assigneePenName;
      if (status) updateData.status = status;
      if (priority) updateData.priority = priority;
    } else {
      const status = optionalEnum(body.status, TASK_STATUS);
      if (!status) {
        return NextResponse.json({ success: false, error: "status is required" }, { status: 400 });
      }
      updateData.status = status;
    }

    await db.update(editorialTasks).set(updateData).where(eq(editorialTasks.id, id)).run();

    await writeAuditLog({
      userId: context.user.id,
      action: "editorial_task_updated",
      entity: "editorial_task",
      entityId: id,
      payload: updateData,
    });

    await publishRealtimeEvent(["tasks"]);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    return handleServerError("editorial-tasks.put", error);
  }
}

