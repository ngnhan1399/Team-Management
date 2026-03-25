import { db, ensureDatabaseInitialized } from "@/db";
import {
  articleComments,
  articles,
  collaborators,
  contentWorkRegistrations,
  editorialTasks,
  kpiContentRegistrations,
  notifications,
  payments,
  users,
} from "@/db/schema";
import { writeAuditLog } from "@/lib/audit";
import { createToken, getCurrentUserContext, setAuthCookie, shouldUseSecureCookies } from "@/lib/auth";
import { normalizeString } from "@/lib/normalize";
import { publishRealtimeEvent } from "@/lib/realtime";
import { enforceTrustedOrigin } from "@/lib/request-security";
import { handleServerError } from "@/lib/server-error";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(request: NextRequest) {
  try {
    await ensureDatabaseInitialized();
    const originError = enforceTrustedOrigin(request);
    if (originError) return originError;

    const context = await getCurrentUserContext();
    if (!context) {
      return NextResponse.json({ success: false, error: "Bạn cần đăng nhập để tiếp tục." }, { status: 401 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const name = normalizeString(body.name);
    const penName = normalizeString(body.penName);

    if (!name || !penName) {
      return NextResponse.json({ success: false, error: "Vui lòng nhập đầy đủ họ tên và bút danh." }, { status: 400 });
    }

    const duplicatePenName = await db
      .select({ id: collaborators.id })
      .from(collaborators)
      .where(eq(collaborators.penName, penName))
      .get();

    if (duplicatePenName && duplicatePenName.id !== context.collaborator?.id) {
      return NextResponse.json({ success: false, error: "Bút danh này đã tồn tại trong hệ thống." }, { status: 409 });
    }

    const previousCollaboratorId = context.collaborator?.id ?? context.user.collaboratorId ?? null;
    const previousName = context.collaborator?.name ?? context.user.email.split("@")[0];
    const previousPenName = context.collaborator?.penName ?? context.token.penName ?? context.user.email.split("@")[0];
    const teamId = context.user.teamId ?? context.team?.id ?? context.collaborator?.teamId ?? null;
    const now = new Date().toISOString();
    let nextCollaboratorId = previousCollaboratorId;

    await db.transaction(async (tx) => {
      if (previousCollaboratorId) {
        await tx
          .update(collaborators)
          .set({
            name,
            penName,
            email: context.collaborator?.email ?? context.user.email,
          })
          .where(eq(collaborators.id, previousCollaboratorId))
          .run();
      } else {
        const inserted = await tx
          .insert(collaborators)
          .values({
            teamId,
            name,
            penName,
            email: context.user.email,
            role: context.user.role === "admin" ? "reviewer" : "writer",
            kpiStandard: context.user.role === "admin" ? 0 : 25,
            status: "active",
          })
          .returning({ id: collaborators.id })
          .get();

        nextCollaboratorId = Number(inserted?.id);

        await tx
          .update(users)
          .set({ collaboratorId: nextCollaboratorId })
          .where(eq(users.id, context.user.id))
          .run();
      }

      if (previousPenName && previousPenName !== penName) {
        await tx
          .update(articles)
          .set({ penName, updatedAt: now })
          .where(eq(articles.penName, previousPenName))
          .run();

        await tx
          .update(articles)
          .set({ reviewerName: penName, updatedAt: now })
          .where(eq(articles.reviewerName, previousPenName))
          .run();

        await tx
          .update(articleComments)
          .set({ penName })
          .where(eq(articleComments.penName, previousPenName))
          .run();

        await tx
          .update(editorialTasks)
          .set({ assigneePenName: penName, updatedAt: now })
          .where(eq(editorialTasks.assigneePenName, previousPenName))
          .run();

        await tx
          .update(payments)
          .set({ penName, updatedAt: now })
          .where(eq(payments.penName, previousPenName))
          .run();

        await tx
          .update(notifications)
          .set({ toPenName: penName })
          .where(eq(notifications.toPenName, previousPenName))
          .run();

        await tx
          .update(contentWorkRegistrations)
          .set({ penName, updatedAt: now })
          .where(eq(contentWorkRegistrations.penName, previousPenName))
          .run();

        await tx
          .update(kpiContentRegistrations)
          .set({ penName, updatedAt: now })
          .where(eq(kpiContentRegistrations.penName, previousPenName))
          .run();
      }
    });

    const token = await createToken({
      userId: context.user.id,
      email: context.user.email,
      role: context.user.role,
      isLeader: Boolean(context.user.isLeader),
      employeeCode: context.user.employeeCode,
      penName,
      collaboratorId: nextCollaboratorId,
      teamId,
    });
    await setAuthCookie(token, { secure: shouldUseSecureCookies(request) });

    await writeAuditLog({
      userId: context.user.id,
      action: "profile_updated",
      entity: "user",
      entityId: context.user.id,
      payload: {
        previousName,
        previousPenName,
        name,
        penName,
        collaboratorId: nextCollaboratorId,
      },
    });

    await publishRealtimeEvent({
      channels: ["team", "dashboard"],
      toastTitle: "Hồ sơ đã cập nhật",
      toastMessage: `Đã cập nhật bút danh cho ${context.user.email}.`,
      toastVariant: "success",
    });

    return NextResponse.json({
      success: true,
      collaboratorId: nextCollaboratorId,
      message: "Hồ sơ của bạn đã được cập nhật thành công.",
    });
  } catch (error) {
    return handleServerError("profile.put", error);
  }
}
