import { db, ensureDatabaseInitialized } from "@/db";
import { articleComments, articles, collaborators, editorialTasks, notifications, payments, users } from "@/db/schema";
import { getCurrentUserContext, hashPassword, generatePassword } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { publishRealtimeEvent } from "@/lib/realtime";
import { enforceTrustedOrigin } from "@/lib/request-security";
import { handleServerError } from "@/lib/server-error";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

type CollaboratorInsert = typeof collaborators.$inferInsert;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

import { normalizeString, normalizeOptionalString } from "@/lib/normalize";

function normalizeOptionalEmail(value: unknown): string | undefined {
    const normalized = normalizeString(value).toLowerCase();
    if (!normalized) return undefined;
    if (!EMAIL_REGEX.test(normalized)) {
        throw new Error("Email không hợp lệ");
    }
    return normalized;
}

function buildCollaboratorValues(body: Record<string, unknown>, email: string | undefined): Partial<CollaboratorInsert> {
    const values: Partial<CollaboratorInsert> = {};

    const name = normalizeOptionalString(body.name);
    const penName = normalizeOptionalString(body.penName);
    const role = normalizeOptionalString(body.role);
    const status = normalizeOptionalString(body.status);
    const kpiStandard = body.kpiStandard;

    if (name !== undefined) values.name = name;
    if (penName !== undefined) values.penName = penName;
    if (role !== undefined) values.role = role as never;
    if (status !== undefined) values.status = status as never;
    if (typeof kpiStandard === "number" && Number.isFinite(kpiStandard)) {
        values.kpiStandard = Math.max(0, Math.trunc(kpiStandard));
    }

    values.email = email ?? undefined;
    values.phone = normalizeOptionalString(body.phone);
    values.avatar = normalizeOptionalString(body.avatar);
    values.bio = normalizeOptionalString(body.bio);
    values.socialFacebook = normalizeOptionalString(body.socialFacebook);
    values.socialZalo = normalizeOptionalString(body.socialZalo);
    values.socialTiktok = normalizeOptionalString(body.socialTiktok);
    values.dateOfBirth = normalizeOptionalString(body.dateOfBirth);
    values.cccd = normalizeOptionalString(body.cccd);
    values.cccdDate = normalizeOptionalString(body.cccdDate);
    values.taxId = normalizeOptionalString(body.taxId);
    values.bankAccount = normalizeOptionalString(body.bankAccount);
    values.bankName = normalizeOptionalString(body.bankName);
    values.deadline = normalizeOptionalString(body.deadline);

    return values;
}

export async function GET() {
    try {
        await ensureDatabaseInitialized();
        const context = await getCurrentUserContext();
        if (!context) {
            return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
        }

        if (context.user.role === "admin") {
            const allCollaborators = await db.select().from(collaborators).all();
            const allUsers = await db
                .select({
                    id: users.id,
                    email: users.email,
                    role: users.role,
                    collaboratorId: users.collaboratorId,
                })
                .from(users)
                .all();

            const data = allCollaborators.map((collaborator) => {
                const linkedUser = allUsers.find((user) => user.collaboratorId === collaborator.id) || null;
                return {
                    ...collaborator,
                    linkedUserId: linkedUser?.id ?? null,
                    linkedUserEmail: linkedUser?.email ?? null,
                    linkedUserRole: linkedUser?.role ?? null,
                };
            });

            return NextResponse.json({ success: true, data, users: allUsers });
        }

        const collaboratorId = context.collaborator?.id ?? context.user.collaboratorId;
        if (!collaboratorId) {
            return NextResponse.json({ success: true, data: [] });
        }

        const own = await db.select().from(collaborators).where(eq(collaborators.id, collaboratorId)).all();
        return NextResponse.json({ success: true, data: own });
    } catch (error) {
        return handleServerError("collaborators.get", error);
    }
}

export async function POST(request: NextRequest) {
    try {
        await ensureDatabaseInitialized();
        const originError = enforceTrustedOrigin(request);
        if (originError) return originError;

        const context = await getCurrentUserContext();
        if (!context) {
            return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
        }
        if (context.user.role !== "admin") {
            return NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 });
        }

        const body = (await request.json()) as Record<string, unknown>;
        const name = normalizeString(body.name);
        const penName = normalizeString(body.penName);
        const email = normalizeOptionalEmail(body.email);

        if (!name || !penName) {
            return NextResponse.json({ success: false, error: "Name and penName are required" }, { status: 400 });
        }

        const duplicatePenName = await db
            .select({ id: collaborators.id })
            .from(collaborators)
            .where(eq(collaborators.penName, penName))
            .get();
        if (duplicatePenName) {
            return NextResponse.json({ success: false, error: "Bút danh đã tồn tại" }, { status: 409 });
        }

        if (email) {
            const existingUser = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).get();
            if (existingUser) {
                return NextResponse.json({ success: false, error: "Email đã được dùng cho tài khoản khác" }, { status: 409 });
            }
        }

        const collaboratorValues = {
            ...buildCollaboratorValues(body, email),
            name,
            penName,
            role: (normalizeString(body.role) || "writer") as never,
            status: (normalizeString(body.status) || "active") as never,
            kpiStandard: typeof body.kpiStandard === "number" && Number.isFinite(body.kpiStandard)
                ? Math.max(0, Math.trunc(body.kpiStandard))
                : 25,
        } satisfies Partial<CollaboratorInsert>;

        const generatedPassword = email ? generatePassword() : null;
        const passwordHash = generatedPassword ? await hashPassword(generatedPassword) : null;

        const collaboratorId = await db.transaction(async (tx) => {
            const insertedCollaborator = await tx.insert(collaborators)
                .values(collaboratorValues)
                .returning({ id: collaborators.id })
                .get();
            const newCollaboratorId = Number(insertedCollaborator?.id);

            if (email && passwordHash) {
                await tx.insert(users)
                    .values({
                        email,
                        passwordHash,
                        role: "ctv",
                        collaboratorId: newCollaboratorId,
                        mustChangePassword: true,
                    })
                    .run();
            }

            return newCollaboratorId;
        });

        await writeAuditLog({
            userId: context.user.id,
            action: "collaborator_created",
            entity: "collaborator",
            entityId: collaboratorId,
            payload: { name, penName, email: email ?? null },
        });

        await publishRealtimeEvent({
            channels: ["team", "dashboard"],
            toastTitle: "Đội ngũ đã cập nhật",
            toastMessage: `Đã thêm cộng tác viên ${name}.`,
            toastVariant: "success",
        });

        return NextResponse.json({
            success: true,
            id: collaboratorId,
            generatedPassword,
            message: generatedPassword ? `CTV tạo thành công! Mật khẩu tạm: ${generatedPassword}` : undefined,
        });
    } catch (error) {
        if (error instanceof Error && error.message.includes("Email")) {
            return NextResponse.json({ success: false, error: error.message }, { status: 400 });
        }
        return handleServerError("collaborators.post", error);
    }
}

export async function PUT(request: NextRequest) {
    try {
        await ensureDatabaseInitialized();
        const originError = enforceTrustedOrigin(request);
        if (originError) return originError;

        const context = await getCurrentUserContext();
        if (!context) {
            return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
        }
        if (context.user.role !== "admin") {
            return NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 });
        }

        const body = (await request.json()) as Record<string, unknown>;
        const id = Number(body.id);
        const normalizedLinkedUserId =
            body.linkedUserId === "" || body.linkedUserId === null || body.linkedUserId === undefined
                ? null
                : Number(body.linkedUserId);

        if (!Number.isInteger(id)) {
            return NextResponse.json({ success: false, error: "ID is required" }, { status: 400 });
        }
        if (normalizedLinkedUserId !== null && !Number.isInteger(normalizedLinkedUserId)) {
            return NextResponse.json({ success: false, error: "linkedUserId is invalid" }, { status: 400 });
        }

        const existingCollaborator = await db.select().from(collaborators).where(eq(collaborators.id, id)).get();
        if (!existingCollaborator) {
            return NextResponse.json({ success: false, error: "Collaborator not found" }, { status: 404 });
        }

        const penName = normalizeOptionalString(body.penName);
        if (penName) {
            const duplicatePenName = await db
                .select({ id: collaborators.id })
                .from(collaborators)
                .where(eq(collaborators.penName, penName))
                .get();
            if (duplicatePenName && duplicatePenName.id !== id) {
                return NextResponse.json({ success: false, error: "Bút danh đã tồn tại" }, { status: 409 });
            }
        }

        const email = normalizeOptionalEmail(body.email);
        if (email) {
            const emailOwner = await db
                .select({ id: users.id, collaboratorId: users.collaboratorId })
                .from(users)
                .where(eq(users.email, email))
                .get();
            if (emailOwner && emailOwner.id !== normalizedLinkedUserId && emailOwner.collaboratorId !== id) {
                return NextResponse.json({ success: false, error: "Email đã được dùng cho tài khoản khác" }, { status: 409 });
            }
        }

        const collaboratorUpdates = buildCollaboratorValues(body, email);
        let linkedUserEmailForAudit: string | null = null;
        const previousPenName = existingCollaborator.penName;
        const nextPenName = collaboratorUpdates.penName || existingCollaborator.penName;
        const previousName = existingCollaborator.name;
        const nextName = collaboratorUpdates.name || existingCollaborator.name;
        const nameChanged = previousName !== nextName;
        const penNameChanged = previousPenName !== nextPenName;

        await db.transaction(async (tx) => {
            await tx.update(collaborators).set(collaboratorUpdates).where(eq(collaborators.id, id)).run();

            if (penNameChanged) {
                const articleTimestamp = new Date().toISOString();

                await tx.update(articles)
                    .set({ penName: nextPenName, updatedAt: articleTimestamp })
                    .where(eq(articles.penName, previousPenName))
                    .run();

                await tx.update(articles)
                    .set({ reviewerName: nextPenName, updatedAt: articleTimestamp })
                    .where(eq(articles.reviewerName, previousPenName))
                    .run();

                await tx.update(articleComments)
                    .set({ penName: nextPenName })
                    .where(eq(articleComments.penName, previousPenName))
                    .run();

                await tx.update(editorialTasks)
                    .set({ assigneePenName: nextPenName, updatedAt: articleTimestamp })
                    .where(eq(editorialTasks.assigneePenName, previousPenName))
                    .run();

                await tx.update(payments)
                    .set({ penName: nextPenName, updatedAt: articleTimestamp })
                    .where(eq(payments.penName, previousPenName))
                    .run();

                await tx.update(notifications)
                    .set({ toPenName: nextPenName })
                    .where(eq(notifications.toPenName, previousPenName))
                    .run();
            }

            const currentlyLinkedUsers = await tx
                .select({
                    id: users.id,
                    email: users.email,
                    role: users.role,
                    collaboratorId: users.collaboratorId,
                })
                .from(users)
                .where(eq(users.collaboratorId, id))
                .all();

            for (const linkedUser of currentlyLinkedUsers) {
                if (linkedUser.id === normalizedLinkedUserId) continue;
                if (linkedUser.role === "admin") continue;

                await tx.update(users)
                    .set({ collaboratorId: null })
                    .where(eq(users.id, linkedUser.id))
                    .run();
            }

            if (normalizedLinkedUserId !== null) {
                const selectedUser = await tx
                    .select({
                        id: users.id,
                        email: users.email,
                        role: users.role,
                        collaboratorId: users.collaboratorId,
                    })
                    .from(users)
                    .where(eq(users.id, normalizedLinkedUserId))
                    .get();

                if (!selectedUser) {
                    throw new Error("Không tìm thấy tài khoản cần liên kết");
                }
                if (selectedUser.role !== "ctv") {
                    throw new Error("Chỉ có thể liên kết tài khoản CTV tại màn hình này");
                }
                if (selectedUser.collaboratorId && selectedUser.collaboratorId !== id) {
                    throw new Error("Tài khoản này đã được liên kết với cộng tác viên khác");
                }

                const nextUserEmail = email || selectedUser.email;
                await tx.update(users)
                    .set({ collaboratorId: id, email: nextUserEmail })
                    .where(eq(users.id, selectedUser.id))
                    .run();

                linkedUserEmailForAudit = nextUserEmail;
            }
        });

        await writeAuditLog({
            userId: context.user.id,
            action: "collaborator_updated",
            entity: "collaborator",
            entityId: id,
            payload: {
                ...collaboratorUpdates,
                linkedUserId: normalizedLinkedUserId,
                linkedUserEmail: linkedUserEmailForAudit ?? null,
                nameChanged,
                penNameChanged,
                previousName,
                previousPenName,
            },
        });

        await publishRealtimeEvent({
            channels: ["team", "dashboard", "articles", "tasks", "royalty", "notifications"],
            toastTitle: "Đội ngũ đã cập nhật",
            toastMessage: penNameChanged || nameChanged
                ? `Đã đồng bộ thay đổi cho ${nextName}.`
                : `Đã cập nhật thông tin ${nextName}.`,
            toastVariant: "success",
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        if (error instanceof Error && (
            error.message.includes("Email")
            || error.message.includes("liên kết")
            || error.message.includes("tài khoản")
        )) {
            return NextResponse.json({ success: false, error: error.message }, { status: 400 });
        }
        return handleServerError("collaborators.put", error);
    }
}

export async function DELETE(request: NextRequest) {
    try {
        await ensureDatabaseInitialized();
        const originError = enforceTrustedOrigin(request);
        if (originError) return originError;

        const context = await getCurrentUserContext();
        if (!context) {
            return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
        }
        if (context.user.role !== "admin") {
            return NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 });
        }

        const body = (await request.json()) as Record<string, unknown>;
        const collaboratorId = Number(body.id);
        if (!Number.isInteger(collaboratorId) || collaboratorId <= 0) {
            return NextResponse.json({ success: false, error: "Invalid collaborator ID" }, { status: 400 });
        }

        const collaborator = await db.select().from(collaborators).where(eq(collaborators.id, collaboratorId)).get();
        if (!collaborator) {
            return NextResponse.json({ success: false, error: "Không tìm thấy thành viên" }, { status: 404 });
        }

        const linkedUser = await db
            .select({ id: users.id, role: users.role, email: users.email })
            .from(users)
            .where(eq(users.collaboratorId, collaboratorId))
            .get();

        if (linkedUser?.role === "admin") {
            return NextResponse.json({ success: false, error: "Không thể xóa tài khoản admin" }, { status: 403 });
        }

        if (linkedUser?.id === context.user.id) {
            return NextResponse.json({ success: false, error: "Không thể tự xóa chính mình" }, { status: 403 });
        }

        const deletedUserId = linkedUser?.id ?? null;
        const deletedUserEmail = linkedUser?.email ?? null;

        await db.transaction(async (tx) => {
            if (deletedUserId) {
                await tx.delete(notifications).where(eq(notifications.toUserId, deletedUserId)).run();
                await tx.delete(notifications).where(eq(notifications.fromUserId, deletedUserId)).run();
                await tx.delete(articleComments).where(eq(articleComments.userId, deletedUserId)).run();
                await tx.update(articles).set({ createdByUserId: null }).where(eq(articles.createdByUserId, deletedUserId)).run();
                await tx.delete(users).where(eq(users.id, deletedUserId)).run();
            }
            await tx.delete(collaborators).where(eq(collaborators.id, collaboratorId)).run();
        });

        await writeAuditLog({
            userId: context.user.id,
            action: "collaborator_deleted",
            entity: "collaborator",
            entityId: String(collaboratorId),
            payload: {
                deletedName: collaborator.name,
                deletedPenName: collaborator.penName,
                deletedUserId,
                deletedUserEmail,
            },
        });

        await publishRealtimeEvent({
            channels: ["team", "dashboard"],
            toastTitle: "Thành viên đã bị xóa",
            toastMessage: `${collaborator.name} (${collaborator.penName}) đã bị xóa khỏi hệ thống.`,
            toastVariant: "warning",
        });

        return NextResponse.json({
            success: true,
            deletedCollaborator: { id: collaboratorId, name: collaborator.name, penName: collaborator.penName },
            deletedUserAccount: deletedUserId ? { id: deletedUserId, email: deletedUserEmail } : null,
        });
    } catch (error) {
        return handleServerError("collaborators.delete", error);
    }
}




