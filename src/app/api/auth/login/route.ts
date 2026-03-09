import { db, ensureDatabaseInitialized } from "@/db";
import { users, collaborators } from "@/db/schema";
import { verifyPassword, createToken, setAuthCookie } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { checkRateLimit, clearRateLimit, recordFailedAttempt } from "@/lib/rate-limit";
import { enforceTrustedOrigin } from "@/lib/request-security";
import { handleServerError } from "@/lib/server-error";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

function getClientIp(request: NextRequest): string {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
        return forwarded.split(",")[0]?.trim() || "unknown";
    }
    return request.headers.get("x-real-ip") || "unknown";
}

export async function POST(request: NextRequest) {
    try {
        await ensureDatabaseInitialized();
        const originError = enforceTrustedOrigin(request);
        if (originError) return originError;

        const { email, password } = await request.json();
        const normalizedEmail = String(email || "").toLowerCase().trim();
        const rateKey = `${getClientIp(request)}|${normalizedEmail || "unknown"}`;

        const rateState = checkRateLimit(rateKey);
        if (!rateState.allowed) {
            return NextResponse.json(
                {
                    success: false,
                    error: `Bạn thử sai quá nhiều lần. Vui lòng thử lại sau ${rateState.retryAfterSeconds} giây.`,
                },
                { status: 429 }
            );
        }

        if (!normalizedEmail || !password) {
            return NextResponse.json(
                { success: false, error: "Email và mật khẩu là bắt buộc" },
                { status: 400 }
            );
        }

        const user = await db.select().from(users).where(eq(users.email, normalizedEmail)).get();

        if (!user) {
            recordFailedAttempt(rateKey);
            await writeAuditLog({
                action: "login_failed",
                entity: "auth",
                payload: { email: normalizedEmail, reason: "user_not_found" },
            });
            return NextResponse.json(
                { success: false, error: "Email hoặc mật khẩu không đúng" },
                { status: 401 }
            );
        }

        const isValidPassword = await verifyPassword(password, user.passwordHash);
        if (!isValidPassword) {
            recordFailedAttempt(rateKey);
            await writeAuditLog({
                userId: user.id,
                action: "login_failed",
                entity: "auth",
                entityId: user.id,
                payload: { email: normalizedEmail, reason: "invalid_password" },
            });
            return NextResponse.json(
                { success: false, error: "Email hoặc mật khẩu không đúng" },
                { status: 401 }
            );
        }

        await db.update(users)
            .set({ lastLogin: new Date().toISOString() })
            .where(eq(users.id, user.id))
            .run();

        let penName = "";
        if (user.collaboratorId) {
            const collaborator = await db
                .select({ penName: collaborators.penName })
                .from(collaborators)
                .where(eq(collaborators.id, user.collaboratorId))
                .get();
            penName = collaborator?.penName || "";
        }

        const token = await createToken({
            userId: user.id,
            email: user.email,
            role: user.role as "admin" | "ctv",
            penName,
            collaboratorId: user.collaboratorId,
        });

        await setAuthCookie(token);
        clearRateLimit(rateKey);

        await writeAuditLog({
            userId: user.id,
            action: "login_success",
            entity: "auth",
            entityId: user.id,
            payload: { email: user.email, role: user.role },
        });

        return NextResponse.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                role: user.role,
                mustChangePassword: user.mustChangePassword,
                collaboratorId: user.collaboratorId,
            },
        });
    } catch (error) {
        return handleServerError("auth.login", error);
    }
}
