import { clearAuthCookie, getCurrentUserContext } from "@/lib/auth";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const DAILY_KPI_POPUP_COOKIE = "ctv_daily_kpi_popup";

export async function GET() {
  try {
    const context = await getCurrentUserContext();
    if (!context) {
      return NextResponse.json({ success: false, error: "Bạn chưa đăng nhập." });
    }

    const cookieStore = await cookies();
    const showDailyKpiPopup = cookieStore.get(DAILY_KPI_POPUP_COOKIE)?.value === "1";
    if (showDailyKpiPopup) {
      cookieStore.delete(DAILY_KPI_POPUP_COOKIE);
    }

    const currentTeamId = context.team?.id ?? context.user.teamId ?? context.collaborator?.teamId ?? null;
    const currentTeam = context.team ?? null;
    const isAdmin = context.user.role === "admin";
    const needsEmployeeCode = isAdmin && !(context.user.employeeCode ?? "").trim();
    const needsTeamSetup = isAdmin && !context.user.isLeader && !currentTeamId;

    return NextResponse.json({
      success: true,
      user: {
        id: context.user.id,
        email: context.user.email,
        role: context.user.role,
        isLeader: Boolean(context.user.isLeader),
        employeeCode: context.user.employeeCode ?? null,
        mustChangePassword: context.user.mustChangePassword,
        showDailyKpiPopup,
        collaboratorId: context.collaborator?.id ?? context.user.collaboratorId,
        teamId: currentTeamId,
        team: currentTeam,
        collaborator: context.collaborator,
        adminSetup: isAdmin
          ? {
              required: needsEmployeeCode || needsTeamSetup,
              needsEmployeeCode,
              needsTeamSetup,
              currentTeamName: currentTeam?.name ?? null,
              currentTeamDescription: currentTeam?.description ?? null,
            }
          : undefined,
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await clearAuthCookie();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
