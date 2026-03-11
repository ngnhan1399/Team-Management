import { db, ensureDatabaseInitialized } from "@/db";
import { feedbackEntries, users } from "@/db/schema";
import { getContextDisplayName, getCurrentUserContext } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { createNotifications } from "@/lib/notifications";
import { publishRealtimeEvent } from "@/lib/realtime";
import { enforceTrustedOrigin } from "@/lib/request-security";
import { handleServerError } from "@/lib/server-error";
import { ValidationError, optionalInt, optionalString, requiredInt, requiredString, optionalEnum } from "@/lib/validation";
import { and, desc, eq, type SQL } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

const FEEDBACK_CATEGORY = ["bug", "feature", "improvement", "other"] as const;
const FEEDBACK_STATUS = ["new", "reviewing", "planned", "resolved"] as const;
const FEEDBACK_STATUS_LABELS: Record<(typeof FEEDBACK_STATUS)[number], string> = {
  new: "Mới gửi",
  reviewing: "Đang xem xét",
  planned: "Đã lên kế hoạch",
  resolved: "Đã xử lý",
};

export async function GET(request: NextRequest) {
  try {
    await ensureDatabaseInitialized();
    const context = await getCurrentUserContext();
    if (!context) {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    }

    const searchParams = new URL(request.url).searchParams;
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10) || 50, 200);
    const status = optionalEnum(searchParams.get("status"), FEEDBACK_STATUS);
    const category = optionalEnum(searchParams.get("category"), FEEDBACK_CATEGORY);

    const conditions: SQL[] = [];
    if (status) conditions.push(eq(feedbackEntries.status, status));
    if (category) conditions.push(eq(feedbackEntries.category, category));
    if (context.user.role !== "admin") {
      conditions.push(eq(feedbackEntries.userId, context.user.id));
    }

    const rows = await db
      .select()
      .from(feedbackEntries)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(feedbackEntries.id))
      .limit(limit)
      .all();

    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    return handleServerError("feedback.get", error);
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

    const body = (await request.json()) as Record<string, unknown>;
    const category = optionalEnum(body.category, FEEDBACK_CATEGORY) || "improvement";
    const title = requiredString(body.title, "title", 4);
    const message = requiredString(body.message, "message", 10);
    const pageContext = optionalString(body.pageContext);
    const rating = optionalInt(body.rating);

    if (rating !== undefined && (rating < 1 || rating > 5)) {
      return NextResponse.json({ success: false, error: "Đánh giá phải nằm trong khoảng 1 đến 5." }, { status: 400 });
    }

    const createdAt = new Date().toISOString();
    const inserted = await db
      .insert(feedbackEntries)
      .values({
        userId: context.user.id,
        collaboratorId: context.collaborator?.id ?? context.user.collaboratorId,
        submitterName: getContextDisplayName(context),
        submitterEmail: context.user.email,
        category,
        title,
        message,
        pageContext,
        rating,
        status: "new",
        createdAt,
        updatedAt: createdAt,
      })
      .returning({ id: feedbackEntries.id })
      .get();

    const adminRecipients = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, "admin"))
      .all();

    const recipientIds = adminRecipients
      .map((item) => Number(item.id))
      .filter((id) => Number.isInteger(id) && id > 0 && id !== context.user.id);

    if (recipientIds.length > 0) {
      await createNotifications(
        recipientIds.map((adminId) => ({
          fromUserId: context.user.id,
          toUserId: adminId,
          type: "info" as const,
          title: "Feedback moi tu nguoi dung",
          message: `${getContextDisplayName(context)} da gui feedback: ${title}`,
        }))
      );
    }

    await writeAuditLog({
      userId: context.user.id,
      action: "feedback_created",
      entity: "feedback",
      entityId: inserted?.id,
      payload: {
        category,
        title,
        pageContext: pageContext ?? null,
        rating: rating ?? null,
      },
    });

    await publishRealtimeEvent({
      channels: ["feedback"],
      userIds: adminRecipients.map((item) => Number(item.id)).filter((id) => Number.isInteger(id) && id > 0),
    });

    return NextResponse.json({ success: true, id: Number(inserted?.id) });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    return handleServerError("feedback.post", error);
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
    const id = requiredInt(body.id, "id");
    const status = optionalEnum(body.status, FEEDBACK_STATUS);
    const adminNotes = body.adminNotes === undefined || body.adminNotes === null
      ? undefined
      : String(body.adminNotes).trim();

    if (!status && adminNotes === undefined) {
      return NextResponse.json({ success: false, error: "Không có thay đổi nào để lưu." }, { status: 400 });
    }

    const existing = await db.select().from(feedbackEntries).where(eq(feedbackEntries.id, id)).get();
    if (!existing) {
      return NextResponse.json({ success: false, error: "Không tìm thấy feedback." }, { status: 404 });
    }

    const updateData: Partial<typeof feedbackEntries.$inferInsert> = {
      updatedAt: new Date().toISOString(),
    };
    if (status) updateData.status = status;
    if (adminNotes !== undefined) updateData.adminNotes = adminNotes;

    await db.update(feedbackEntries).set(updateData).where(eq(feedbackEntries.id, id)).run();

    if (status && status !== existing.status && existing.userId !== context.user.id) {
      await createNotifications([{
        fromUserId: context.user.id,
        toUserId: existing.userId,
        type: "system",
        title: "Feedback cua ban da duoc cap nhat",
        message: `Trang thai feedback "${existing.title}" da chuyen sang: ${FEEDBACK_STATUS_LABELS[status]}.`,
      }]);
    }

    await writeAuditLog({
      userId: context.user.id,
      action: "feedback_updated",
      entity: "feedback",
      entityId: id,
      payload: {
        status: status ?? existing.status,
        adminNotes: adminNotes ?? existing.adminNotes ?? null,
      },
    });

    await publishRealtimeEvent({
      channels: ["feedback"],
      userIds: Array.from(new Set([existing.userId, context.user.id].filter((value) => Number.isInteger(value) && Number(value) > 0) as number[])),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    return handleServerError("feedback.put", error);
  }
}
