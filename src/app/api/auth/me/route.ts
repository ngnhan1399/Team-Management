import { getCurrentUserContext, clearAuthCookie } from "@/lib/auth";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const DAILY_KPI_POPUP_COOKIE = "ctv_daily_kpi_popup";

export async function GET() {
    try {
        const context = await getCurrentUserContext();
        if (!context) {
            return NextResponse.json({ success: false, error: "Not authenticated" });
        }

        const cookieStore = await cookies();
        const showDailyKpiPopup = cookieStore.get(DAILY_KPI_POPUP_COOKIE)?.value === "1";
        if (showDailyKpiPopup) {
            cookieStore.delete(DAILY_KPI_POPUP_COOKIE);
        }

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
                teamId: context.team?.id ?? context.user.teamId ?? context.collaborator?.teamId ?? null,
                team: context.team,
                collaborator: context.collaborator,
            },
        });
    } catch (error) {
        return NextResponse.json(
            { success: false, error: String(error) },
            { status: 500 }
        );
    }
}

export async function DELETE() {
    try {
        await clearAuthCookie();
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json(
            { success: false, error: String(error) },
            { status: 500 }
        );
    }
}
