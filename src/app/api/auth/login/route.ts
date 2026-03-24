import { db, ensureDatabaseInitialized } from "@/db";
import { users, collaborators } from "@/db/schema";
import { verifyPassword, createToken, setAuthCookie, shouldUseSecureCookies } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { checkRateLimit, clearRateLimit, recordFailedAttempt } from "@/lib/rate-limit";
import { enforceTrustedOrigin } from "@/lib/request-security";
import { handleServerError } from "@/lib/server-error";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const DAILY_KPI_POPUP_COOKIE = "ctv_daily_kpi_popup";

function getLocalDateKey(value: Date | string) {
    const date = value instanceof Date ? value : new Date(value);
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Ho_Chi_Minh",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date);

    const year = parts.find((part) => part.type === "year")?.value || "0000";
    const month = parts.find((part) => part.type === "month")?.value || "00";
    const day = parts.find((part) => part.type === "day")?.value || "00";
    return `${year}-${month}-${day}`;
}

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
        const useSecureCookies = shouldUseSecureCookies(request);

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

        const currentLoginAt = new Date();
        const previousLastLogin = user.lastLogin;
        const isFirstLoginToday = user.role === "ctv"
            && (!previousLastLogin || getLocalDateKey(previousLastLogin) !== getLocalDateKey(currentLoginAt));

        await db.update(users)
            .set({ lastLogin: currentLoginAt.toISOString() })
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
            isLeader: Boolean(user.isLeader),
            penName,
            collaboratorId: user.collaboratorId,
            teamId: user.teamId,
        });

        await setAuthCookie(token, { secure: useSecureCookies });
        if (isFirstLoginToday) {
            const cookieStore = await cookies();
            cookieStore.set(DAILY_KPI_POPUP_COOKIE, "1", {
                httpOnly: true,
                secure: useSecureCookies,
                sameSite: "strict",
                maxAge: 60 * 15,
                path: "/",
            });
        }
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
                isLeader: Boolean(user.isLeader),
                mustChangePassword: user.mustChangePassword,
                collaboratorId: user.collaboratorId,
                teamId: user.teamId,
            },
        });
    } catch (error) {
        return handleServerError("auth.login", error);
    }
}
