import { db, ensureDatabaseInitialized } from "@/db";
import { collaborators, users } from "@/db/schema";
import { createToken, hashPassword, setAuthCookie } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { enforceTrustedOrigin } from "@/lib/request-security";
import { handleServerError } from "@/lib/server-error";
import { eq, or } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value: unknown) {
    return String(value || "").trim().toLowerCase();
}

function normalizePassword(value: unknown) {
    return String(value || "");
}

function isRegistrationEnabled() {
    const rawValue = process.env.AUTH_REGISTER_ENABLED?.trim().toLowerCase();
    return ["1", "true", "yes", "on", "enabled"].includes(rawValue || "");
}

export async function POST(request: NextRequest) {
    try {
        if (!isRegistrationEnabled()) {
            return NextResponse.json(
                { success: false, error: "Tự đăng ký hiện đang bị tắt. Vui lòng liên hệ quản trị viên." },
                { status: 403 }
            );
        }

        await ensureDatabaseInitialized();
        const originError = enforceTrustedOrigin(request);
        if (originError) return originError;

        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const email = normalizeEmail(body.email);
        const password = normalizePassword(body.password);

        if (!email || !password) {
            return NextResponse.json(
                { success: false, error: "Email và mật khẩu là bắt buộc." },
                { status: 400 }
            );
        }

        if (!EMAIL_REGEX.test(email)) {
            return NextResponse.json(
                { success: false, error: "Email không hợp lệ." },
                { status: 400 }
            );
        }

        if (password.length < 6) {
            return NextResponse.json(
                { success: false, error: "Mật khẩu phải có ít nhất 6 ký tự." },
                { status: 400 }
            );
        }

        const collaborator = await db
            .select()
            .from(collaborators)
            .where(eq(collaborators.email, email))
            .get();

        if (!collaborator) {
            return NextResponse.json(
                { success: false, error: "Email này chưa có trong danh sách CTV. Vui lòng liên hệ quản trị viên." },
                { status: 404 }
            );
        }

        if (collaborator.status !== "active") {
            return NextResponse.json(
                { success: false, error: "Tài khoản CTV này đang tạm ngưng. Vui lòng liên hệ quản trị viên." },
                { status: 403 }
            );
        }

        const existingUser = await db
            .select()
            .from(users)
            .where(or(eq(users.email, email), eq(users.collaboratorId, collaborator.id)))
            .get();

        const passwordHash = await hashPassword(password);
        const now = new Date().toISOString();
        let userId: number;

        if (existingUser) {
            if (existingUser.role !== "ctv") {
                return NextResponse.json(
                    { success: false, error: "Email này đã được dùng cho tài khoản quản trị. Vui lòng đăng nhập bằng tài khoản hiện có." },
                    { status: 409 }
                );
            }

            if (existingUser.lastLogin && !existingUser.mustChangePassword) {
                return NextResponse.json(
                    { success: false, error: "Tài khoản này đã được kích hoạt. Bạn chỉ cần đăng nhập." },
                    { status: 409 }
                );
            }

            await db.update(users)
                .set({
                    email,
                    passwordHash,
                    collaboratorId: collaborator.id,
                    teamId: collaborator.teamId,
                    mustChangePassword: false,
                    lastLogin: now,
                })
                .where(eq(users.id, existingUser.id))
                .run();

            userId = existingUser.id;
        } else {
            const insertedUser = await db.insert(users)
                .values({
                    email,
                    passwordHash,
                    role: "ctv",
                    collaboratorId: collaborator.id,
                    teamId: collaborator.teamId,
                    mustChangePassword: false,
                    lastLogin: now,
                })
                .returning({
                    id: users.id,
                })
                .get();

            userId = Number(insertedUser?.id);
        }

        const token = await createToken({
            userId,
            email,
            role: "ctv",
            isLeader: false,
            penName: collaborator.penName,
            collaboratorId: collaborator.id,
            teamId: collaborator.teamId,
        });

        await setAuthCookie(token);

        await writeAuditLog({
            userId,
            action: existingUser ? "account_activated" : "account_registered",
            entity: "auth",
            entityId: userId,
            payload: {
                email,
                collaboratorId: collaborator.id,
                collaboratorPenName: collaborator.penName,
            },
        });

        return NextResponse.json({
            success: true,
            user: {
                id: userId,
                email,
                role: "ctv",
                isLeader: false,
                mustChangePassword: false,
                collaboratorId: collaborator.id,
                teamId: collaborator.teamId,
            },
        });
    } catch (error) {
        return handleServerError("auth.register", error);
    }
}
