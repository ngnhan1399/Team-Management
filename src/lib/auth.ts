import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { db, ensureDatabaseInitialized } from "@/db";
import { users, collaborators, type User, type Collaborator } from "@/db/schema";
import { eq } from "drizzle-orm";

const jwtSecretValue = process.env.JWT_SECRET;
if (!jwtSecretValue || jwtSecretValue.length < 32) {
    throw new Error("JWT_SECRET must be set and at least 32 characters long");
}
const JWT_SECRET = new TextEncoder().encode(jwtSecretValue);
const COOKIE_NAME = "ctv_auth_token";
const TOKEN_EXPIRY = "7d";

type TokenPayload = {
    userId: number;
    email: string;
    role: "admin" | "ctv";
    penName: string;
    collaboratorId: number | null;
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

export async function createToken(payload: TokenPayload): Promise<string> {
    return new SignJWT(payload as Record<string, unknown>)
        .setProtectedHeader({ alg: "HS256" })
        .setExpirationTime(TOKEN_EXPIRY)
        .setIssuedAt()
        .sign(JWT_SECRET);
}

export async function verifyToken(token: string): Promise<TokenPayload | null> {
    try {
        const { payload } = await jwtVerify(token, JWT_SECRET);
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
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}

function buildIdentityVariants(value: unknown): string[] {
    const raw = String(value || "").trim();
    if (!raw) return [];

    const normalized = normalizeIdentityValue(raw);
    if (!normalized) return [];

    const variants = new Set<string>([normalized]);
    const tokens = normalized.split(" ").filter(Boolean);

    if (raw.includes("@")) {
        const [localPart] = raw.split("@");
        const normalizedLocalPart = normalizeIdentityValue(localPart.replace(/[._-]+/g, " "));
        if (normalizedLocalPart) {
            variants.add(normalizedLocalPart);
        }
    }

    if (tokens.length >= 2) {
        variants.add(tokens.slice(-2).join(" "));
        variants.add(`${tokens[0]} ${tokens[tokens.length - 1]}`);
    }

    return Array.from(variants);
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

    return { token, user, collaborator };
}

export function getContextPenName(context: CurrentUserContext): string | null {
    return context.collaborator?.penName ?? context.token.penName ?? null;
}

export function getContextIdentityCandidates(context: CurrentUserContext): string[] {
    const values = [
        context.collaborator?.name,
        context.collaborator?.penName,
        context.collaborator?.email,
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
        const trimmed = String(value || "").trim();
        if (!trimmed) continue;
        if (seen.has(trimmed)) continue;
        seen.add(trimmed);
        candidates.push(trimmed);
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

export async function setAuthCookie(token: string) {
    const cookieStore = await cookies();
    cookieStore.set(COOKIE_NAME, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
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
