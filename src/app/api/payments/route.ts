import { db, ensureDatabaseInitialized } from "@/db";
import { articles, payments, royaltyRates, users, collaborators } from "@/db/schema";
import { getContextArticleOwnerCandidates, getContextIdentityCandidates, getCurrentUserContext, matchesIdentityCandidate } from "@/lib/auth";
import { publishRealtimeEvent } from "@/lib/realtime";
import { writeAuditLog } from "@/lib/audit";
import { createNotification } from "@/lib/notifications";
import { matchesRoyaltyMonthYear } from "@/lib/royalty";
import { requiredInt, optionalString, ValidationError, enumValue } from "@/lib/validation";
import { enforceTrustedOrigin } from "@/lib/request-security";
import { handleServerError } from "@/lib/server-error";
import { canAccessTeam, getContextTeamId, isLeader } from "@/lib/teams";
import { and, desc, eq, inArray, type SQL } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

type PaymentDetails = Record<string, { count: number; unitPrice: number; total: number }>;
type CalcRow = {
  teamId: number | null;
  penName: string;
  totalArticles: number;
  totalAmount: number;
  details: PaymentDetails;
};

type PaymentSourceArticle = {
  teamId: number | null;
  penName: string;
  articleType: string;
  contentType: string;
  date: string;
};

const ROYALTY_ELIGIBLE_STATUS_VALUES = ["Published", "Approved"] as const;

function buildArticleOwnerWhere(ownerCandidates: string[]): SQL | undefined {
  const normalizedCandidates = Array.from(new Set(ownerCandidates.map((value) => String(value || "").trim()).filter(Boolean)));
  if (normalizedCandidates.length === 0) return undefined;
  if (normalizedCandidates.length === 1) return eq(articles.penName, normalizedCandidates[0] as never);
  return inArray(articles.penName, normalizedCandidates as never[]);
}

async function selectPaymentSourceArticles(options?: { exactPenName?: string; ownerCandidates?: string[]; teamId?: number | null }) {
  const conditions: SQL[] = [inArray(articles.status, [...ROYALTY_ELIGIBLE_STATUS_VALUES])];

  if (options?.exactPenName) {
    conditions.push(eq(articles.penName, options.exactPenName));
  } else if (options?.ownerCandidates?.length) {
    const ownerWhere = buildArticleOwnerWhere(options.ownerCandidates);
    if (ownerWhere) conditions.push(ownerWhere);
  }
  if (options?.teamId) {
    conditions.push(eq(articles.teamId, options.teamId));
  }

  return db.select({
    teamId: articles.teamId,
    penName: articles.penName,
    articleType: articles.articleType,
    contentType: articles.contentType,
    date: articles.date,
  })
    .from(articles)
    .where(and(...conditions))
    .all() as Promise<PaymentSourceArticle[]>;
}

function parsePaymentDetails(raw: string | null): PaymentDetails | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as PaymentDetails : null;
  } catch {
    return null;
  }
}

async function buildCalculation(month: number, year: number, options?: { exactPenName?: string; ownerCandidates?: string[]; teamId?: number | null }): Promise<CalcRow[]> {
  const rates = await db.select().from(royaltyRates).where(eq(royaltyRates.isActive, true)).all();
  const rateMap = new Map<string, number>();
  for (const rate of rates) {
    rateMap.set(`${rate.articleType}|${rate.contentType}`, rate.price);
  }

  const sourceArticles = (await selectPaymentSourceArticles(options))
    .filter((article) => matchesRoyaltyMonthYear(article.date, month, year));

  const byWriter: Record<string, CalcRow> = {};

  for (const article of sourceArticles) {
    if (!byWriter[article.penName]) {
      byWriter[article.penName] = {
        teamId: article.teamId ?? options?.teamId ?? null,
        penName: article.penName,
        totalArticles: 0,
        totalAmount: 0,
        details: {},
      };
    }

    const row = byWriter[article.penName];
    const key = `${article.articleType}|${article.contentType}`;
    const price = rateMap.get(key) || 0;

    row.totalArticles += 1;
    row.totalAmount += price;

    const detailKey = `${article.articleType} (${article.contentType})`;
    if (!row.details[detailKey]) {
      row.details[detailKey] = { count: 0, unitPrice: price, total: 0 };
    }
    row.details[detailKey].count += 1;
    row.details[detailKey].total += price;
  }

  return Object.values(byWriter);
}

async function notifyPaymentStatus(fromUserId: number, penName: string, title: string, message: string, teamId?: number | null) {
  const targets = await db
    .select({ id: users.id, penName: collaborators.penName, name: collaborators.name, teamId: users.teamId })
    .from(users)
    .innerJoin(collaborators, eq(users.collaboratorId, collaborators.id))
    .where(teamId ? eq(users.teamId, teamId) : undefined)
    .all();

  const target = targets.find((item) =>
    matchesIdentityCandidate([item.penName, item.name].filter(Boolean) as string[], penName)
  );

  if (target?.id) {
    await createNotification({
      fromUserId,
      toUserId: target.id,
      toPenName: penName,
      type: "system",
      title,
      message,
    });
  }
}

export async function GET(request: NextRequest) {
  try {
    await ensureDatabaseInitialized();
    const context = await getCurrentUserContext();
    if (!context) {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    }

    const searchParams = new URL(request.url).searchParams;
    const month = searchParams.get("month") ? requiredInt(searchParams.get("month"), "month") : undefined;
    const year = searchParams.get("year") ? requiredInt(searchParams.get("year"), "year") : undefined;
    const status = optionalString(searchParams.get("status"));
    const penNameFilter = optionalString(searchParams.get("penName"));
    const identityCandidates = getContextIdentityCandidates(context);
    const ownerCandidates = context.user.role === "admin" ? [] : getContextArticleOwnerCandidates(context);
    const adminTeamId = context.user.role === "admin" && !isLeader(context) ? getContextTeamId(context) : null;

    const conditions: SQL[] = [];
    if (month) conditions.push(eq(payments.month, month));
    if (year) conditions.push(eq(payments.year, year));
    if (status) conditions.push(eq(payments.status, status as never));

    if (context.user.role === "admin") {
      if (!isLeader(context) && !adminTeamId) {
        return NextResponse.json({ success: true, data: [] });
      }
      if (adminTeamId) conditions.push(eq(payments.teamId, adminTeamId));
      if (penNameFilter) conditions.push(eq(payments.penName, penNameFilter));
    } else if (identityCandidates.length === 0 && ownerCandidates.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    let data = (await db
      .select()
      .from(payments)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(payments.id))
      .all())
      .map((payment) => ({
        ...payment,
        details: parsePaymentDetails(payment.details),
        isEstimated: false,
      }));

    if (context.user.role !== "admin") {
      data = data.filter((payment) => matchesIdentityCandidate(identityCandidates, payment.penName));

      if (data.length === 0 && month && year) {
        const [estimated] = (await buildCalculation(month, year, { ownerCandidates })).filter((row) =>
          matchesIdentityCandidate(identityCandidates, row.penName)
        );

        if (estimated) {
          const now = new Date().toISOString();
          data = [{
            id: -(year * 100 + month),
            month,
            year,
            penName: estimated.penName,
            totalArticles: estimated.totalArticles,
            totalAmount: estimated.totalAmount,
            details: estimated.details,
            status: "pending",
            approvedByUserId: null,
            approvedAt: null,
            paidAt: null,
            createdAt: now,
            updatedAt: now,
            isEstimated: true,
          }];
        }
      }
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    return handleServerError("payments.get", error);
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
    const action = enumValue(body.action, "action", ["generate"] as const);
    const adminTeamId = !isLeader(context) ? getContextTeamId(context) : null;

    if (!isLeader(context) && !adminTeamId) {
      return NextResponse.json({ success: false, error: "Không xác định được team của admin hiện tại" }, { status: 400 });
    }

    if (action === "generate") {
      const month = requiredInt(body.month, "month");
      const year = requiredInt(body.year, "year");
      const penName = optionalString(body.penName);
      const force = Boolean(body.force);

      const calculation = await buildCalculation(month, year, {
        exactPenName: penName || undefined,
        teamId: adminTeamId,
      });
      let generated = 0;
      let skipped = 0;
      const targetPenNames = new Set(calculation.map((row) => row.penName));

      for (const row of calculation) {
        const existingPaymentConditions = [
          eq(payments.month, month),
          eq(payments.year, year),
          eq(payments.penName, row.penName),
          row.teamId ? eq(payments.teamId, row.teamId) : adminTeamId ? eq(payments.teamId, adminTeamId) : undefined,
        ].filter((c): c is NonNullable<typeof c> => c != null);
        const existing = await db
          .select()
          .from(payments)
          .where(and(...existingPaymentConditions))
          .get();

        if (existing && existing.status !== "pending" && !force) {
          skipped += 1;
          continue;
        }

        const details = JSON.stringify(row.details);

        if (existing) {
          await db.update(payments)
            .set({
              totalArticles: row.totalArticles,
              totalAmount: row.totalAmount,
              details,
              status: "pending",
              approvedByUserId: null,
              approvedAt: null,
              paidAt: null,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(payments.id, existing.id))
            .run();
        } else {
          await db.insert(payments)
            .values({
              teamId: row.teamId ?? adminTeamId,
              month,
              year,
              penName: row.penName,
              totalArticles: row.totalArticles,
              totalAmount: row.totalAmount,
              details,
              status: "pending",
            })
            .run();
        }

        generated += 1;
      }

      const stalePaymentConditions = [
        eq(payments.month, month),
        eq(payments.year, year),
        penName ? eq(payments.penName, penName) : undefined,
        adminTeamId ? eq(payments.teamId, adminTeamId) : undefined,
      ].filter((c): c is NonNullable<typeof c> => c != null);
      const stalePaymentWhere = and(...stalePaymentConditions);

      const stalePayments = await db
        .select()
        .from(payments)
        .where(stalePaymentWhere)
        .all();

      for (const stalePayment of stalePayments) {
        if (targetPenNames.has(stalePayment.penName)) continue;
        if (stalePayment.status !== "pending" && !force) {
          skipped += 1;
          continue;
        }

        await db.delete(payments).where(eq(payments.id, stalePayment.id)).run();
      }

      await writeAuditLog({
        userId: context.user.id,
        action: "payments_generated",
        entity: "payment",
        payload: { month, year, penName, generated, skipped, force },
      });

      await publishRealtimeEvent(["royalty", "dashboard"]);

      return NextResponse.json({ success: true, generated, skipped, total: calculation.length });
    }

    return NextResponse.json({ success: false, error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    return handleServerError("payments.post", error);
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
    const action = enumValue(body.action, "action", ["approve", "mark-paid"] as const);
    const id = requiredInt(body.id, "id");

    const payment = await db.select().from(payments).where(eq(payments.id, id)).get();
    if (!payment) {
      return NextResponse.json({ success: false, error: "Payment not found" }, { status: 404 });
    }
    if (!canAccessTeam(context, payment.teamId)) {
      return NextResponse.json({ success: false, error: "Bạn không có quyền xử lý thanh toán của team này" }, { status: 403 });
    }

    if (action === "approve") {
      if (payment.status !== "pending") {
        return NextResponse.json({ success: false, error: "Only pending payments can be approved" }, { status: 400 });
      }

      await db.update(payments)
        .set({
          status: "approved",
          approvedByUserId: context.user.id,
          approvedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(payments.id, id))
        .run();

      await notifyPaymentStatus(
        context.user.id,
        payment.penName,
        "Nhuan but da duoc duyet",
        `Nhuan but ky ${payment.month}/${payment.year} cua ban da duoc duyet.`,
        payment.teamId
      );

      await writeAuditLog({
        userId: context.user.id,
        action: "payment_approved",
        entity: "payment",
        entityId: id,
        payload: { penName: payment.penName, month: payment.month, year: payment.year },
      });

      await publishRealtimeEvent(["royalty", "dashboard"]);

      return NextResponse.json({ success: true });
    }

    if (payment.status !== "approved") {
      return NextResponse.json({ success: false, error: "Only approved payments can be marked as paid" }, { status: 400 });
    }

    await db.update(payments)
      .set({
        status: "paid",
        paidAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(payments.id, id))
      .run();

    await notifyPaymentStatus(
      context.user.id,
      payment.penName,
      "Nhuan but da thanh toan",
      `Nhuan but ky ${payment.month}/${payment.year} cua ban da duoc thanh toan.`,
      payment.teamId
    );

    await writeAuditLog({
      userId: context.user.id,
      action: "payment_paid",
      entity: "payment",
      entityId: id,
      payload: { penName: payment.penName, month: payment.month, year: payment.year },
    });

    await publishRealtimeEvent(["royalty", "dashboard"]);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    return handleServerError("payments.put", error);
  }
}
