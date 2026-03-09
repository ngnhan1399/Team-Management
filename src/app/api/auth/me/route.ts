import { getCurrentUserContext, clearAuthCookie } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function GET() {
    try {
        const context = await getCurrentUserContext();
        if (!context) {
            return NextResponse.json({ success: false, error: "Not authenticated" });
        }

        return NextResponse.json({
            success: true,
            user: {
                id: context.user.id,
                email: context.user.email,
                role: context.user.role,
                mustChangePassword: context.user.mustChangePassword,
                collaboratorId: context.collaborator?.id ?? context.user.collaboratorId,
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

