import { db, ensureDatabaseInitialized } from "@/db";
import { collaborators, teams, users } from "@/db/schema";
import { writeAuditLog } from "@/lib/audit";
import { getCurrentUserContext } from "@/lib/auth";
import { normalizeOptionalString, normalizeString } from "@/lib/normalize";
import { enforceTrustedOrigin } from "@/lib/request-security";
import { handleServerError } from "@/lib/server-error";
import { isLeader } from "@/lib/teams";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

type SetupBody = {
  employeeCode?: unknown;
  teamName?: unknown;
  teamDescription?: unknown;
};

export async function POST(request: NextRequest) {
  try {
    await ensureDatabaseInitialized();
    const originError = enforceTrustedOrigin(request);
    if (originError) return originError;

    const context = await getCurrentUserContext();
    if (!context) {
      return NextResponse.json({ success: false, error: "Bạn cần đăng nhập để tiếp tục." }, { status: 401 });
    }

    if (context.user.role !== "admin") {
      return NextResponse.json({ success: false, error: "Chỉ tài khoản quản trị mới được phép thực hiện thao tác này." }, { status: 403 });
    }

    const body = (await request.json()) as SetupBody;
    const employeeCode = normalizeString(body.employeeCode);
    const hasTeamName = Object.prototype.hasOwnProperty.call(body, "teamName");
    const hasTeamDescription = Object.prototype.hasOwnProperty.call(body, "teamDescription");
    const teamName = normalizeString(body.teamName);
    const teamDescription = normalizeOptionalString(body.teamDescription);

    if (!employeeCode) {
      return NextResponse.json({ success: false, error: "Vui lòng nhập mã nhân viên." }, { status: 400 });
    }

    const existingEmployeeCode = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(and(eq(users.role, "admin"), eq(users.employeeCode, employeeCode)))
      .all();

    const duplicateEmployeeCode = existingEmployeeCode.find((row) => row.id !== context.user.id);
    if (duplicateEmployeeCode) {
      return NextResponse.json(
        { success: false, error: `Mã nhân viên ${employeeCode} đang được dùng bởi tài khoản quản trị khác.` },
        { status: 409 }
      );
    }

    const currentTeamId = context.team?.id ?? context.user.teamId ?? context.collaborator?.teamId ?? null;
    const leaderAccess = isLeader(context);

    if (!leaderAccess && !currentTeamId && !teamName) {
      return NextResponse.json({ success: false, error: "Vui lòng đặt tên nhóm CTV để bắt đầu quản trị team." }, { status: 400 });
    }

    if (teamName) {
      const duplicateTeam = await db.select({ id: teams.id }).from(teams).where(eq(teams.name, teamName)).get();
      if (duplicateTeam && duplicateTeam.id !== currentTeamId) {
        return NextResponse.json({ success: false, error: "Tên nhóm này đã tồn tại. Vui lòng chọn tên khác." }, { status: 409 });
      }
    }

    const now = new Date().toISOString();
    let nextTeamId = currentTeamId;
    let createdTeamId: number | null = null;
    let updatedTeamId: number | null = null;

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ employeeCode })
        .where(eq(users.id, context.user.id))
        .run();

      if (!leaderAccess) {
        if (!nextTeamId) {
          const insertedTeam = await tx
            .insert(teams)
            .values({
              name: teamName,
              description: teamDescription,
              ownerUserId: context.user.id,
              status: "active",
              createdAt: now,
              updatedAt: now,
            })
            .returning({ id: teams.id })
            .get();

          nextTeamId = Number(insertedTeam?.id);
          createdTeamId = nextTeamId;

          await tx
            .update(users)
            .set({ teamId: nextTeamId })
            .where(eq(users.id, context.user.id))
            .run();
        } else if (hasTeamName || hasTeamDescription) {
          const nextTeamUpdates: Partial<typeof teams.$inferInsert> = {
            updatedAt: now,
          };

          if (teamName) nextTeamUpdates.name = teamName;
          if (hasTeamDescription) nextTeamUpdates.description = teamDescription;

          const existingTeam = await tx.select().from(teams).where(eq(teams.id, nextTeamId)).get();
          if (existingTeam && !existingTeam.ownerUserId) {
            nextTeamUpdates.ownerUserId = context.user.id;
          }

          await tx.update(teams).set(nextTeamUpdates).where(eq(teams.id, nextTeamId)).run();
          updatedTeamId = nextTeamId;
        }

        if (nextTeamId && context.user.collaboratorId) {
          await tx
            .update(collaborators)
            .set({ teamId: nextTeamId })
            .where(eq(collaborators.id, context.user.collaboratorId))
            .run();
        }

        if (nextTeamId) {
          const existingTeam = await tx.select().from(teams).where(eq(teams.id, nextTeamId)).get();
          if (existingTeam && !existingTeam.ownerUserId) {
            await tx
              .update(teams)
              .set({
                ownerUserId: context.user.id,
                updatedAt: now,
              })
              .where(eq(teams.id, nextTeamId))
              .run();
          }
        }
      }
    });

    await writeAuditLog({
      userId: context.user.id,
      action: "admin_setup_completed",
      entity: "user",
      entityId: context.user.id,
      payload: {
        employeeCode,
        createdTeamId,
        updatedTeamId,
        teamId: nextTeamId,
      },
    });

    return NextResponse.json({
      success: true,
      employeeCode,
      teamId: nextTeamId,
      createdTeamId,
      updatedTeamId,
    });
  } catch (error) {
    return handleServerError("admin.setup.post", error);
  }
}
