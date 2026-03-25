import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { db, ensureDatabaseInitialized } from "@/db";
import { users, collaborators, teams, type User, type Collaborator, type Team } from "@/db/schema";
import { buildCollaboratorIdentityVariants, expandCollaboratorIdentityValues, foldCollaboratorIdentity } from "@/lib/collaborator-identity";
import { eq } from "drizzle-orm";

const COOKIE_NAME = "ctv_auth_token";
const TOKEN_EXPIRY = "7d";

type TokenPayload = {
    userId: number;
    email: string;
    role: "admin" | "ctv";
    isLeader: boolean;
    penName: string;
    employeeCode?: string | null;
    collaboratorId: number | null;
    teamId: number | null;
};

export function generatePassword(length = 8): string {
    const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let password = "";
    for (let i = 0; i < length; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}

export async function hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
}

function isTruthyEnvFlag(value: string | undefined): boolean | null {
    if (!value) return null;

    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on", "enabled"].includes(normalized)) {
        return true;
    }

    if (["0", "false", "no", "off", "disabled"].includes(normalized)) {
        return false;
    }

    return null;
}

export function shouldUseSecureCookies(request?: Request): boolean {
    const envOverride = isTruthyEnvFlag(process.env.AUTH_COOKIE_SECURE);
    if (envOverride !== null) {
        return envOverride;
    }

    if (request) {
        const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
        if (forwardedProto) {
            return forwardedProto === "https";
        }

        const origin = request.headers.get("origin");
        if (origin) {
            try {
                return new URL(origin).protocol === "https:";
            } catch {
                // Ignore malformed origin values and continue with URL fallback.
            }
        }

        try {
            return new URL(request.url).protocol === "https:";
        } catch {
            // Fall back to environment-based default below.
        }
    }

    return process.env.NODE_ENV === "production";
}

function getJwtSecret() {
    const jwtSecretValue = process.env.JWT_SECRET?.trim();
    if (!jwtSecretValue || jwtSecretValue.length < 32) {
        throw new Error("JWT_SECRET must be set and at least 32 characters long");
    }

    return new TextEncoder().encode(jwtSecretValue);
}

export async function createToken(payload: TokenPayload): Promise<string> {
    return new SignJWT(payload as Record<string, unknown>)
        .setProtectedHeader({ alg: "HS256" })
        .setExpirationTime(TOKEN_EXPIRY)
        .setIssuedAt()
        .sign(getJwtSecret());
}

export async function verifyToken(token: string): Promise<TokenPayload | null> {
    try {
        const { payload } = await jwtVerify(token, getJwtSecret());
        return payload as unknown as TokenPayload;
    } catch {
        return null;
    }
}

export async function getCurrentUser() {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (!token) return null;
    return verifyToken(token);
}

export interface CurrentUserContext {
    token: TokenPayload;
    user: User;
    collaborator: Collaborator | null;
    team: Team | null;
}

export function hasArticleManagerAccess(context: CurrentUserContext | null | undefined): boolean {
    if (!context) return false;
    return context.user.role === "admin";
}

export function hasArticleReviewAccess(context: CurrentUserContext | null | undefined): boolean {
    if (!context) return false;
    return context.user.role === "admin" || context.collaborator?.role === "reviewer";
}

function normalizeIdentityValue(value: unknown): string {
    return foldCollaboratorIdentity(value);
}

function buildIdentityVariants(value: unknown): string[] {
    return buildCollaboratorIdentityVariants(value);
}

export async function getCurrentUserContext(): Promise<CurrentUserContext | null> {
    await ensureDatabaseInitialized();
    const token = await getCurrentUser();
    if (!token) return null;

    const user = await db.select().from(users).where(eq(users.id, token.userId)).get();
    if (!user) return null;

    let collaborator: Collaborator | null = null;
    if (user.collaboratorId) {
        collaborator =
            await db.select().from(collaborators).where(eq(collaborators.id, user.collaboratorId)).get() ?? null;
    }

    if (!collaborator && user.role === "ctv") {
        collaborator =
            await db.select().from(collaborators).where(eq(collaborators.email, user.email)).get() ?? null;
    }

    const teamId = user.teamId ?? collaborator?.teamId ?? token.teamId ?? null;
    const team = teamId
        ? await db.select().from(teams).where(eq(teams.id, teamId)).get() ?? null
        : null;

    return { token, user, collaborator, team };
}

export function getContextPenName(context: CurrentUserContext): string | null {
    return context.collaborator?.penName ?? context.token.penName ?? null;
}

export function getContextIdentityCandidates(context: CurrentUserContext): string[] {
    const values = [
        context.collaborator?.name,
        context.collaborator?.penName,
        context.collaborator?.email,
        context.user.employeeCode,
        context.token.penName,
        context.user.email.split("@")[0],
        context.user.email,
    ];

    const seen = new Set<string>();
    const candidates: string[] = [];

    for (const value of values) {
        for (const variant of buildIdentityVariants(value)) {
            if (seen.has(variant)) continue;
            seen.add(variant);
            candidates.push(variant);
        }
    }

    return candidates;
}

export function getContextIdentityLabels(context: CurrentUserContext): string[] {
    const values = [
        context.collaborator?.name,
        context.collaborator?.penName,
        context.collaborator?.email,
        context.user.employeeCode,
        context.token.penName,
        context.user.email.split("@")[0],
        context.user.email,
    ];

    const seen = new Set<string>();
    const labels: string[] = [];

    for (const value of values) {
        const raw = String(value || "").trim();
        if (!raw) continue;

        const normalized = normalizeIdentityValue(raw);
        if (!normalized || seen.has(normalized)) continue;

        seen.add(normalized);
        labels.push(raw);
    }

    return labels;
}

export function getContextArticleOwnerCandidates(context: CurrentUserContext): string[] {
    const values = [
        context.collaborator?.name,
        context.collaborator?.penName,
        context.token.penName,
        context.user.email.split("@")[0],
    ];

    const seen = new Set<string>();
    const candidates: string[] = [];

    for (const value of values) {
        for (const expandedValue of expandCollaboratorIdentityValues([value])) {
            const trimmed = String(expandedValue || "").trim();
            if (!trimmed) continue;
            if (seen.has(trimmed)) continue;
            seen.add(trimmed);
            candidates.push(trimmed);
        }
    }

    return candidates;
}

export function matchesIdentityCandidate(candidates: string[], value: unknown): boolean {
    const valueVariants = buildIdentityVariants(value);
    if (valueVariants.length === 0) return false;

    const candidateVariants = new Set<string>();
    for (const candidate of candidates) {
        for (const variant of buildIdentityVariants(candidate)) {
            candidateVariants.add(variant);
        }
    }

    return valueVariants.some((variant) => candidateVariants.has(variant));
}

export function getContextDisplayName(context: CurrentUserContext): string {
    return context.collaborator?.name
        || context.collaborator?.penName
        || context.user.email.split("@")[0]
        || "bạn";
}

export async function setAuthCookie(token: string, options?: { secure?: boolean }) {
    const cookieStore = await cookies();
    cookieStore.set(COOKIE_NAME, token, {
        httpOnly: true,
        secure: options?.secure ?? shouldUseSecureCookies(),
        sameSite: "strict",
        maxAge: 60 * 60 * 24 * 7,
        path: "/",
    });
}

export async function clearAuthCookie() {
    const cookieStore = await cookies();
    cookieStore.delete(COOKIE_NAME);
}

export function requireAuth(user: unknown) {
    if (!user) {
        return { authorized: false, error: "Authentication required", status: 401 };
    }
    return { authorized: true, error: null, status: 200 };
}

export function requireAdmin(user: { role?: string } | null | undefined) {
    if (!user) {
        return { authorized: false, error: "Authentication required", status: 401 };
    }
    if (user.role !== "admin") {
        return { authorized: false, error: "Admin access required", status: 403 };
    }
    return { authorized: true, error: null, status: 200 };
}
