import { db, ensureDatabaseInitialized } from "@/db";
import { articles, payments, royaltyRates, users, collaborators } from "@/db/schema";
import { getContextIdentityCandidates, getCurrentUserContext, matchesIdentityCandidate } from "@/lib/auth";
import { publishRealtimeEvent } from "@/lib/realtime";
import { writeAuditLog } from "@/lib/audit";
import { createNotification } from "@/lib/notifications";
import { expandCollaboratorIdentityValues, resolvePreferredCollaboratorPenName } from "@/lib/collaborator-identity";
import { resolveAppArticleFields } from "@/lib/google-sheet-article-mapping";
import {
  isBudgetEligibleContributor,
  matchesRoyaltyMonthYear,
  resolveRoyaltyContributorPenName,
  resolveRoyaltyContributorProfile,
  type RoyaltyContributorProfile,
} from "@/lib/royalty";
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
  writerArticles: number;
  writerAmount: number;
  reviewerArticles: number;
  reviewerAmount: number;
  details: PaymentDetails;
};

type PaymentSourceArticle = {
  teamId: number | null;
  penName: string;
  reviewerName: string | null;
  category: string;
  articleType: string;
  contentType: string;
  wordCountRange: string | null;
  date: string;
};

const ROYALTY_ELIGIBLE_STATUS_VALUES = ["Published", "Approved"] as const;

function expandPenNameCandidates(values: string[]) {
  return Array.from(
    new Set(
      values
        .flatMap((value) => expandCollaboratorIdentityValues([value]))
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
}

function buildPaymentPenNameWhere(penNames: string[]): SQL | undefined {
  const normalizedCandidates = expandPenNameCandidates(penNames);
  if (normalizedCandidates.length === 0) return undefined;
  if (normalizedCandidates.length === 1) return eq(payments.penName, normalizedCandidates[0] as never);
  return inArray(payments.penName, normalizedCandidates as never[]);
}

async function selectPaymentSourceArticles(options?: { teamId?: number | null }) {
  const conditions: SQL[] = [inArray(articles.status, [...ROYALTY_ELIGIBLE_STATUS_VALUES])];
  if (options?.teamId) {
    conditions.push(eq(articles.teamId, options.teamId));
  }

  return db.select({
    teamId: articles.teamId,
    penName: articles.penName,
    reviewerName: articles.reviewerName,
    category: articles.category,
    articleType: articles.articleType,
    contentType: articles.contentType,
    wordCountRange: articles.wordCountRange,
    date: articles.date,
  })
    .from(articles)
    .where(and(...conditions))
    .all() as Promise<PaymentSourceArticle[]>;
}

async function loadRoyaltyContributorProfiles(teamId?: number | null) {
  return db
    .select({
      teamId: collaborators.teamId,
      penName: collaborators.penName,
      name: collaborators.name,
      role: collaborators.role,
      linkedUserRole: users.role,
    })
    .from(collaborators)
    .leftJoin(users, eq(users.collaboratorId, collaborators.id))
    .where(teamId ? eq(collaborators.teamId, teamId) : undefined)
    .all() as Promise<RoyaltyContributorProfile[]>;
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

function summarizePaymentDetails(details: PaymentDetails | null, totalArticles: number, totalAmount: number) {
  if (!details) {
    return {
      writerArticles: totalArticles,
      writerAmount: totalAmount,
      reviewerArticles: 0,
      reviewerAmount: 0,
    };
  }

  let writerArticles = 0;
  let writerAmount = 0;
  let reviewerArticles = 0;
  let reviewerAmount = 0;

  for (const [detailKey, value] of Object.entries(details)) {
    if (detailKey.startsWith("Duyệt bài • ")) {
      reviewerArticles += Number(value.count || 0);
      reviewerAmount += Number(value.total || 0);
      continue;
    }

    writerArticles += Number(value.count || 0);
    writerAmount += Number(value.total || 0);
  }

  return {
    writerArticles,
    writerAmount,
    reviewerArticles,
    reviewerAmount,
  };
}

function appendContribution(
  rowsByContributor: Record<string, CalcRow>,
  options: {
    contributorPenName: string;
    contributorTeamId: number | null;
    role: "writer" | "reviewer";
    articleType: string;
    contentType: string;
    price: number;
  }
) {
  const canonicalPenName = options.contributorPenName.trim();
  if (!canonicalPenName) {
    return;
  }

  if (!rowsByContributor[canonicalPenName]) {
    rowsByContributor[canonicalPenName] = {
      teamId: options.contributorTeamId,
      penName: canonicalPenName,
      totalArticles: 0,
      totalAmount: 0,
      writerArticles: 0,
      writerAmount: 0,
      reviewerArticles: 0,
      reviewerAmount: 0,
      details: {},
    };
  }

  const row = rowsByContributor[canonicalPenName];
  row.totalArticles += 1;
  row.totalAmount += options.price;

  if (options.role === "writer") {
    row.writerArticles += 1;
    row.writerAmount += options.price;
  } else {
    row.reviewerArticles += 1;
    row.reviewerAmount += options.price;
  }

  const detailPrefix = options.role === "writer" ? "Viết bài" : "Duyệt bài";
  const detailKey = `${detailPrefix} • ${options.articleType} (${options.contentType})`;
  if (!row.details[detailKey]) {
    row.details[detailKey] = { count: 0, unitPrice: options.price, total: 0 };
  }
  row.details[detailKey].count += 1;
  row.details[detailKey].total += options.price;
}

async function buildCalculation(month: number, year: number, options?: { exactPenName?: string; identityCandidates?: string[]; teamId?: number | null }): Promise<CalcRow[]> {
  const rates = await db.select().from(royaltyRates).where(eq(royaltyRates.isActive, true)).all();
  const rateMap = new Map<string, number>();
  for (const rate of rates) {
    rateMap.set(`${rate.articleType}|${rate.contentType}`, rate.price);
  }

  const [sourceArticles, contributorProfiles] = await Promise.all([
    selectPaymentSourceArticles(options),
    loadRoyaltyContributorProfiles(options?.teamId),
  ]);

  const byContributor: Record<string, CalcRow> = {};

  for (const article of sourceArticles) {
    if (!matchesRoyaltyMonthYear(article.date, month, year)) {
      continue;
    }

    const normalizedArticleFields = resolveAppArticleFields({
      category: article.category,
      articleType: article.articleType,
      contentType: article.contentType,
      wordCountRange: article.wordCountRange,
    });
    const key = `${normalizedArticleFields.articleType}|${normalizedArticleFields.contentType}`;
    const price = rateMap.get(key) || 0;

    const writerProfile = resolveRoyaltyContributorProfile(article.penName, contributorProfiles);
    if (isBudgetEligibleContributor(writerProfile, ["writer"])) {
      appendContribution(byContributor, {
        contributorPenName: resolveRoyaltyContributorPenName(article.penName, contributorProfiles) || article.penName,
        contributorTeamId: writerProfile?.teamId ?? article.teamId ?? options?.teamId ?? null,
        role: "writer",
        articleType: normalizedArticleFields.articleType,
        contentType: normalizedArticleFields.contentType,
        price,
      });
    }

    const reviewerName = String(article.reviewerName || "").trim();
    if (!reviewerName) {
      continue;
    }

    const reviewerProfile = resolveRoyaltyContributorProfile(reviewerName, contributorProfiles);
    if (!isBudgetEligibleContributor(reviewerProfile, ["reviewer"])) {
      continue;
    }

    appendContribution(byContributor, {
      contributorPenName: resolveRoyaltyContributorPenName(reviewerName, contributorProfiles) || reviewerName,
      contributorTeamId: reviewerProfile?.teamId ?? article.teamId ?? options?.teamId ?? null,
      role: "reviewer",
      articleType: normalizedArticleFields.articleType,
      contentType: normalizedArticleFields.contentType,
      price,
    });
  }

  let rows = Object.values(byContributor);

  if (options?.exactPenName) {
    rows = rows.filter((row) => matchesIdentityCandidate([row.penName], options.exactPenName || ""));
  }

  if (options?.identityCandidates?.length) {
    rows = rows.filter((row) => matchesIdentityCandidate(options.identityCandidates || [], row.penName));
  }

  return rows;
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
    const adminTeamId = context.user.role === "admin" && !isLeader(context) ? getContextTeamId(context) : null;
    const profileScopeTeamId = context.user.role === "admin"
      ? adminTeamId
      : getContextTeamId(context);

    const conditions: SQL[] = [];
    if (month) conditions.push(eq(payments.month, month));
    if (year) conditions.push(eq(payments.year, year));
    if (status) conditions.push(eq(payments.status, status as never));

    if (context.user.role === "admin") {
      if (!isLeader(context) && !adminTeamId) {
        return NextResponse.json({ success: true, data: [] });
      }
      if (adminTeamId) conditions.push(eq(payments.teamId, adminTeamId));
      if (penNameFilter) {
        const penNameWhere = buildPaymentPenNameWhere([penNameFilter]);
        if (penNameWhere) conditions.push(penNameWhere);
      }
    } else if (identityCandidates.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    const [rawPayments, contributorProfiles] = await Promise.all([
      db
        .select({
          id: payments.id,
          teamId: payments.teamId,
          month: payments.month,
          year: payments.year,
          penName: payments.penName,
          totalArticles: payments.totalArticles,
          totalAmount: payments.totalAmount,
          details: payments.details,
          status: payments.status,
          approvedByUserId: payments.approvedByUserId,
          approvedAt: payments.approvedAt,
          paidAt: payments.paidAt,
          createdAt: payments.createdAt,
          updatedAt: payments.updatedAt,
        })
        .from(payments)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(payments.id))
        .limit(200)
        .all(),
      loadRoyaltyContributorProfiles(profileScopeTeamId),
    ]);

    let data = rawPayments
      .filter((payment) => isBudgetEligibleContributor(resolveRoyaltyContributorProfile(payment.penName, contributorProfiles), ["writer", "reviewer"]))
      .map((payment) => {
        const contributorProfile = resolveRoyaltyContributorProfile(payment.penName, contributorProfiles);
        const canonicalPenName = resolvePreferredCollaboratorPenName(
          [contributorProfile?.penName, contributorProfile?.name, payment.penName],
          contributorProfile?.penName ?? payment.penName
        ) || payment.penName;
        const details = parsePaymentDetails(payment.details);
        const summary = summarizePaymentDetails(details, payment.totalArticles, payment.totalAmount);

        return {
          ...payment,
          penName: canonicalPenName,
          details,
          ...summary,
          isEstimated: false,
        };
      });

    if (context.user.role !== "admin") {
      data = data.filter((payment) => matchesIdentityCandidate(identityCandidates, payment.penName));

      if (data.length === 0 && month && year) {
        const [estimated] = await buildCalculation(month, year, {
          identityCandidates,
          teamId: getContextTeamId(context),
        });

        if (estimated) {
          const now = new Date().toISOString();
          data = [{
            id: -(year * 100 + month),
            teamId: estimated.teamId ?? null,
            month,
            year,
            penName: estimated.penName,
            totalArticles: estimated.totalArticles,
            totalAmount: estimated.totalAmount,
            writerArticles: estimated.writerArticles,
            writerAmount: estimated.writerAmount,
            reviewerArticles: estimated.reviewerArticles,
            reviewerAmount: estimated.reviewerAmount,
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
          .select({ id: payments.id, status: payments.status })
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
        penName ? buildPaymentPenNameWhere([penName]) : undefined,
        adminTeamId ? eq(payments.teamId, adminTeamId) : undefined,
      ].filter((c): c is NonNullable<typeof c> => c != null);
      const stalePaymentWhere = and(...stalePaymentConditions);

      const stalePayments = await db
        .select({ id: payments.id, penName: payments.penName, status: payments.status })
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

    const payment = await db.select({ id: payments.id, teamId: payments.teamId, month: payments.month, year: payments.year, penName: payments.penName, status: payments.status }).from(payments).where(eq(payments.id, id)).get();
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
