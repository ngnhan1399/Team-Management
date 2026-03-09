import { db, ensureDatabaseInitialized } from "@/db";
import { users } from "@/db/schema";
import { getCurrentUser, verifyPassword, hashPassword } from "@/lib/auth";
import { enforceTrustedOrigin } from "@/lib/request-security";
import { handleServerError } from "@/lib/server-error";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
    try {
        await ensureDatabaseInitialized();
        const originError = enforceTrustedOrigin(request);
        if (originError) return originError;

        const currentUser = await getCurrentUser();
        if (!currentUser) {
            return NextResponse.json(
                { success: false, error: "Authentication required" },
                { status: 401 }
            );
        }

        const { oldPassword, newPassword } = await request.json();

        if (!newPassword || newPassword.length < 6) {
            return NextResponse.json(
                { success: false, error: "Mật khẩu mới phải có ít nhất 6 ký tự" },
                { status: 400 }
            );
        }

        const user = await db.select().from(users).where(eq(users.id, currentUser.userId)).get();
        if (!user) {
            return NextResponse.json(
                { success: false, error: "User not found" },
                { status: 404 }
            );
        }

        if (!user.mustChangePassword) {
            if (!oldPassword) {
                return NextResponse.json(
                    { success: false, error: "Vui lòng nhập mật khẩu cũ" },
                    { status: 400 }
                );
            }

            const isValid = await verifyPassword(oldPassword, user.passwordHash);
            if (!isValid) {
                return NextResponse.json(
                    { success: false, error: "Mật khẩu cũ không đúng" },
                    { status: 400 }
                );
            }
        }

        const newHash = await hashPassword(newPassword);
        await db.update(users)
            .set({ passwordHash: newHash, mustChangePassword: false })
            .where(eq(users.id, user.id))
            .run();

        return NextResponse.json({ success: true, message: "Đổi mật khẩu thành công!" });
    } catch (error) {
        return handleServerError("auth.change-password", error);
    }
}
