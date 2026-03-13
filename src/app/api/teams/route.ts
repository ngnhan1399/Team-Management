import { db, ensureDatabaseInitialized } from "@/db";
import { collaborators, teams, users } from "@/db/schema";
import { writeAuditLog } from "@/lib/audit";
import { generatePassword, getCurrentUserContext, hashPassword } from "@/lib/auth";
import { normalizeOptionalString, normalizeString } from "@/lib/normalize";
import { publishRealtimeEvent } from "@/lib/realtime";
import { enforceTrustedOrigin } from "@/lib/request-security";
import { handleServerError } from "@/lib/server-error";
import { isLeader } from "@/lib/teams";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

type TeamInsert = typeof teams.$inferInsert;

export async function GET() {
  try {
    await ensureDatabaseInitialized();
    const context = await getCurrentUserContext();
    if (!context) {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    }
    if (context.user.role !== "admin") {
      return NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 });
    }

    const scopedTeams = isLeader(context)
      ? await db.select().from(teams).all()
      : context.user.teamId
        ? await db.select().from(teams).where(eq(teams.id, context.user.teamId)).all()
        : [];

    const teamIds = scopedTeams.map((team) => team.id);
    const memberRows = teamIds.length > 0
      ? await db
        .select({
          teamId: collaborators.teamId,
          role: collaborators.role,
          linkedUserRole: users.role,
          linkedUserIsLeader: users.isLeader,
        })
        .from(collaborators)
        .leftJoin(users, eq(users.collaboratorId, collaborators.id))
        .where(and(eq(collaborators.status, "active")))
        .all()
      : [];

    const ownerUserIds = scopedTeams.map((team) => team.ownerUserId).filter((value): value is number => Number.isInteger(value));
    const ownerRows = ownerUserIds.length > 0
      ? await db
        .select({
          id: users.id,
          email: users.email,
          collaboratorId: users.collaboratorId,
          collaboratorName: collaborators.name,
          collaboratorPenName: collaborators.penName,
        })
        .from(users)
        .leftJoin(collaborators, eq(users.collaboratorId, collaborators.id))
        .where(and(eq(users.role, "admin")))
        .all()
      : [];

    const ownerById = new Map(ownerRows.map((row) => [row.id, row]));
    const teamSummaries = scopedTeams.map((team) => {
      const teamMembers = memberRows.filter((row) => row.teamId === team.id);
      const owner = team.ownerUserId ? ownerById.get(team.ownerUserId) : null;
      return {
        id: team.id,
        name: team.name,
        description: team.description,
        status: team.status,
        ownerUserId: team.ownerUserId,
        ownerEmail: owner?.email ?? null,
        ownerName: owner?.collaboratorName ?? null,
        ownerPenName: owner?.collaboratorPenName ?? null,
        memberCount: teamMembers.length,
        writerCount: teamMembers.filter((member) => member.role === "writer").length,
        reviewerCount: teamMembers.filter((member) => member.role === "reviewer").length,
        adminCount: teamMembers.filter((member) => member.linkedUserRole === "admin").length,
      };
    }).sort((left, right) => left.name.localeCompare(right.name, "vi"));

    return NextResponse.json({ success: true, data: teamSummaries });
  } catch (error) {
    return handleServerError("teams.get", error);
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
    if (!isLeader(context)) {
      return NextResponse.json({ success: false, error: "Leader access required" }, { status: 403 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const name = normalizeString(body.name);
    const description = normalizeOptionalString(body.description);
    const ownerName = normalizeOptionalString(body.ownerName);
    const ownerPenName = normalizeOptionalString(body.ownerPenName);
    const ownerEmail = normalizeOptionalString(body.ownerEmail)?.toLowerCase();

    if (!name) {
      return NextResponse.json({ success: false, error: "Tên team là bắt buộc" }, { status: 400 });
    }

    const duplicateTeam = await db
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.name, name))
      .get();
    if (duplicateTeam) {
      return NextResponse.json({ success: false, error: "Tên team đã tồn tại" }, { status: 409 });
    }

    if (ownerEmail) {
      const existingOwnerUser = await db.select({ id: users.id }).from(users).where(eq(users.email, ownerEmail)).get();
      if (existingOwnerUser) {
        return NextResponse.json({ success: false, error: "Email admin đã tồn tại trong hệ thống" }, { status: 409 });
      }
    }

    const generatedPassword = ownerEmail ? generatePassword() : null;
    const ownerPasswordHash = generatedPassword ? await hashPassword(generatedPassword) : null;
    const createdAt = new Date().toISOString();

    const created = await db.transaction(async (tx) => {
      const insertedTeam = await tx
        .insert(teams)
        .values({
          name,
          description,
          status: "active",
          createdAt,
          updatedAt: createdAt,
        } satisfies TeamInsert)
        .returning({ id: teams.id })
        .get();

      const teamId = Number(insertedTeam?.id);
      let ownerUserId: number | null = null;

      if (ownerEmail && ownerPasswordHash) {
        const insertedCollaborator = await tx
          .insert(collaborators)
          .values({
            teamId,
            name: ownerName || "Team Admin",
            penName: ownerPenName || ownerEmail.split("@")[0],
            role: "reviewer",
            status: "active",
            kpiStandard: 0,
            email: ownerEmail,
          })
          .returning({ id: collaborators.id })
          .get();

        const collaboratorId = Number(insertedCollaborator?.id);
        const insertedUser = await tx
          .insert(users)
          .values({
            email: ownerEmail,
            passwordHash: ownerPasswordHash,
            role: "admin",
            isLeader: false,
            collaboratorId,
            teamId,
            mustChangePassword: true,
          })
          .returning({ id: users.id })
          .get();

        ownerUserId = Number(insertedUser?.id);

        await tx
          .update(teams)
          .set({ ownerUserId, updatedAt: new Date().toISOString() })
          .where(eq(teams.id, teamId))
          .run();
      }

      return { teamId, ownerUserId };
    });

    await writeAuditLog({
      userId: context.user.id,
      action: "team_created",
      entity: "team",
      entityId: created.teamId,
      payload: {
        name,
        ownerUserId: created.ownerUserId,
        ownerEmail: ownerEmail ?? null,
      },
    });

    await publishRealtimeEvent({
      channels: ["team", "dashboard"],
      toastTitle: "Team mới đã được tạo",
      toastMessage: `Đã tạo team ${name}.`,
      toastVariant: "success",
    });

    return NextResponse.json({
      success: true,
      id: created.teamId,
      generatedPassword,
    });
  } catch (error) {
    return handleServerError("teams.post", error);
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
    if (!isLeader(context)) {
      return NextResponse.json({ success: false, error: "Leader access required" }, { status: 403 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const action = normalizeString(body.action) || "update";
    const teamId = Number(body.teamId);
    if (!Number.isInteger(teamId) || teamId <= 0) {
      return NextResponse.json({ success: false, error: "teamId không hợp lệ" }, { status: 400 });
    }

    const existingTeam = await db.select().from(teams).where(eq(teams.id, teamId)).get();
    if (!existingTeam) {
      return NextResponse.json({ success: false, error: "Không tìm thấy team" }, { status: 404 });
    }

    if (action === "transfer-owner") {
      const targetUserId = Number(body.targetUserId);
      if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
        return NextResponse.json({ success: false, error: "targetUserId không hợp lệ" }, { status: 400 });
      }

      const targetUser = await db.select().from(users).where(eq(users.id, targetUserId)).get();
      if (!targetUser) {
        return NextResponse.json({ success: false, error: "Không tìm thấy tài khoản được chọn" }, { status: 404 });
      }
      if (targetUser.isLeader) {
        return NextResponse.json({ success: false, error: "Không thể chuyển owner cho tài khoản leader" }, { status: 400 });
      }
      if (targetUser.teamId !== teamId) {
        return NextResponse.json({ success: false, error: "Tài khoản được chọn không thuộc team này" }, { status: 400 });
      }

      await db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({ role: "admin", isLeader: false, teamId })
          .where(eq(users.id, targetUserId))
          .run();

        if (existingTeam.ownerUserId && existingTeam.ownerUserId !== targetUserId) {
          const previousOwner = await tx.select().from(users).where(eq(users.id, existingTeam.ownerUserId)).get();
          if (previousOwner && !previousOwner.isLeader) {
            await tx
              .update(users)
              .set({ role: "ctv" })
              .where(eq(users.id, previousOwner.id))
              .run();
          }
        }

        await tx
          .update(teams)
          .set({
            ownerUserId: targetUserId,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(teams.id, teamId))
          .run();
      });

      await writeAuditLog({
        userId: context.user.id,
        action: "team_owner_transferred",
        entity: "team",
        entityId: teamId,
        payload: {
          previousOwnerUserId: existingTeam.ownerUserId ?? null,
          nextOwnerUserId: targetUserId,
        },
      });

      await publishRealtimeEvent({
        channels: ["team", "dashboard"],
        toastTitle: "Team đã được bàn giao",
        toastMessage: `Đã chuyển quyền quản lý team ${existingTeam.name}.`,
        toastVariant: "success",
      });

      return NextResponse.json({ success: true });
    }

    const nextName = normalizeOptionalString(body.name);
    const nextDescription = normalizeOptionalString(body.description);
    const nextStatus = normalizeString(body.status);
    const updates: Partial<typeof teams.$inferInsert> = {
      updatedAt: new Date().toISOString(),
    };

    if (nextName) updates.name = nextName;
    if (nextDescription !== undefined) updates.description = nextDescription;
    if (nextStatus === "active" || nextStatus === "archived") updates.status = nextStatus as "active" | "archived";

    await db.update(teams).set(updates).where(eq(teams.id, teamId)).run();

    await writeAuditLog({
      userId: context.user.id,
      action: "team_updated",
      entity: "team",
      entityId: teamId,
      payload: updates,
    });

    await publishRealtimeEvent({
      channels: ["team", "dashboard"],
      toastTitle: "Team đã được cập nhật",
      toastMessage: `Đã cập nhật team ${existingTeam.name}.`,
      toastVariant: "success",
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleServerError("teams.put", error);
  }
}
