import { db, ensureDatabaseInitialized } from "@/db";
import { articles, collaborators, kpiRecords, users } from "@/db/schema";
import { getContextIdentityCandidates, getCurrentUserContext, matchesIdentityCandidate } from "@/lib/auth";
import { publishRealtimeEvent } from "@/lib/realtime";
import { matchesRoyaltyMonthYear } from "@/lib/royalty";
import { enforceTrustedOrigin } from "@/lib/request-security";
import { handleServerError } from "@/lib/server-error";
import { getContextTeamId, normalizeTeamId, resolveScopedTeamId } from "@/lib/teams";
import { optionalString, requiredInt, ValidationError } from "@/lib/validation";
import { and, eq, or, type SQL } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

type KpiContributorRow = {
  collaboratorId: number;
  teamId: number | null;
  name: string;
  penName: string;
  role: "writer" | "reviewer";
  status: string;
  linkedUserRole: "admin" | "ctv" | null;
  targetKpi: number;
  actualKpi: number;
  totalKpi: number;
  remainingKpi: number;
  overKpi: number;
  completionPercentage: number;
  evaluation: string | null;
};

type KpiSummary = {
  totalMembers: number;
  totalAssignedKpi: number;
  totalActualKpi: number;
  totalRemainingKpi: number;
  totalOverKpi: number;
  completionPercentage: number;
};

type CollaboratorScopeRow = {
  collaboratorId: number;
  teamId: number | null;
  name: string;
  penName: string;
  role: "writer" | "reviewer";
  status: string;
  defaultKpiStandard: number;
  linkedUserRole: "admin" | "ctv" | null;
};

type ArticleScopeRow = {
  teamId: number | null;
  penName: string;
  reviewerName: string | null;
  date: string;
};

type KpiRecordScopeRow = {
  id: number;
  teamId: number | null;
  month: number;
  year: number;
  penName: string;
  kpiStandard: number;
  kpiActual: number;
  evaluation: string | null;
};

function getMonthYear(searchParams: URLSearchParams) {
  const now = new Date();
  const monthParam = searchParams.get("month");
  const yearParam = searchParams.get("year");
  const month = monthParam ? Number(monthParam) : now.getMonth() + 1;
  const year = yearParam ? Number(yearParam) : now.getFullYear();

  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new ValidationError("Tháng không hợp lệ");
  }
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new ValidationError("Năm không hợp lệ");
  }

  return { month, year };
}

function getCompletionPercentage(actualKpi: number, targetKpi: number) {
  if (targetKpi <= 0) {
    return actualKpi > 0 ? 100 : 0;
  }
  return Math.round((actualKpi / targetKpi) * 100);
}

function buildSummary(rows: KpiContributorRow[]): KpiSummary {
  const totalAssignedKpi = rows.reduce((sum, row) => sum + row.targetKpi, 0);
  const totalActualKpi = rows.reduce((sum, row) => sum + row.actualKpi, 0);
  const totalRemainingKpi = rows.reduce((sum, row) => sum + row.remainingKpi, 0);
  const totalOverKpi = rows.reduce((sum, row) => sum + row.overKpi, 0);
  const completionPercentage = totalAssignedKpi > 0
    ? Math.round((totalActualKpi / totalAssignedKpi) * 100)
    : (totalActualKpi > 0 ? 100 : 0);

  return {
    totalMembers: rows.length,
    totalAssignedKpi,
    totalActualKpi,
    totalRemainingKpi,
    totalOverKpi,
    completionPercentage,
  };
}

function buildEmptyResponse(month: number, year: number, teamId: number | null, canManage: boolean) {
  return {
    month,
    year,
    teamId,
    canManage,
    rows: [] as KpiContributorRow[],
    summary: buildSummary([]),
    viewerSummary: null,
  };
}

async function loadScopedCollaborators(context: Awaited<ReturnType<typeof getCurrentUserContext>>, scopedTeamId: number | null) {
  if (scopedTeamId) {
    return db
      .select({
        collaboratorId: collaborators.id,
        teamId: collaborators.teamId,
        name: collaborators.name,
        penName: collaborators.penName,
        role: collaborators.role,
        status: collaborators.status,
        defaultKpiStandard: collaborators.kpiStandard,
        linkedUserRole: users.role,
      })
      .from(collaborators)
      .leftJoin(users, eq(users.collaboratorId, collaborators.id))
      .where(eq(collaborators.teamId, scopedTeamId))
      .all() as Promise<CollaboratorScopeRow[]>;
  }

  if (context?.collaborator?.id) {
    return db
      .select({
        collaboratorId: collaborators.id,
        teamId: collaborators.teamId,
        name: collaborators.name,
        penName: collaborators.penName,
        role: collaborators.role,
        status: collaborators.status,
        defaultKpiStandard: collaborators.kpiStandard,
        linkedUserRole: users.role,
      })
      .from(collaborators)
      .leftJoin(users, eq(users.collaboratorId, collaborators.id))
      .where(eq(collaborators.id, context.collaborator.id))
      .all() as Promise<CollaboratorScopeRow[]>;
  }

  return [] as CollaboratorScopeRow[];
}

async function loadScopedArticles(context: Awaited<ReturnType<typeof getCurrentUserContext>>, scopedTeamId: number | null) {
  if (scopedTeamId) {
    return db
      .select({
        teamId: articles.teamId,
        penName: articles.penName,
        reviewerName: articles.reviewerName,
        date: articles.date,
      })
      .from(articles)
      .where(eq(articles.teamId, scopedTeamId))
      .all() as Promise<ArticleScopeRow[]>;
  }

  const ownPenName = String(context?.collaborator?.penName || "").trim();
  if (ownPenName) {
    return db
      .select({
        teamId: articles.teamId,
        penName: articles.penName,
        reviewerName: articles.reviewerName,
        date: articles.date,
      })
      .from(articles)
      .where(or(eq(articles.penName, ownPenName), eq(articles.reviewerName, ownPenName)))
      .all() as Promise<ArticleScopeRow[]>;
  }

  return [] as ArticleScopeRow[];
}

async function loadScopedKpiRecords(month: number, year: number, scopedTeamId: number | null, context: Awaited<ReturnType<typeof getCurrentUserContext>>) {
  const whereConditions: SQL[] = [eq(kpiRecords.month, month), eq(kpiRecords.year, year)];

  if (scopedTeamId) {
    whereConditions.push(eq(kpiRecords.teamId, scopedTeamId));
  } else if (context?.collaborator?.penName) {
    whereConditions.push(eq(kpiRecords.penName, context.collaborator.penName));
  }

  return db
    .select({
      id: kpiRecords.id,
      teamId: kpiRecords.teamId,
      month: kpiRecords.month,
      year: kpiRecords.year,
      penName: kpiRecords.penName,
      kpiStandard: kpiRecords.kpiStandard,
      kpiActual: kpiRecords.kpiActual,
      evaluation: kpiRecords.evaluation,
    })
    .from(kpiRecords)
    .where(and(...whereConditions))
    .all() as Promise<KpiRecordScopeRow[]>;
}

function buildKpiRows(options: {
  collaborators: CollaboratorScopeRow[];
  monthArticles: ArticleScopeRow[];
  records: KpiRecordScopeRow[];
}) {
  const recordsByPenName = new Map<string, KpiRecordScopeRow>();
  for (const record of options.records) {
    recordsByPenName.set(record.penName, record);
  }

  return options.collaborators
    .filter((collaborator) => collaborator.linkedUserRole !== "admin")
    .map((collaborator) => {
      const record = recordsByPenName.get(collaborator.penName);
      const actualKpi = options.monthArticles.reduce((sum, article) => {
        const matches = collaborator.role === "reviewer"
          ? matchesIdentityCandidate([collaborator.penName, collaborator.name], article.reviewerName)
          : matchesIdentityCandidate([collaborator.penName, collaborator.name], article.penName);
        return matches ? sum + 1 : sum;
      }, 0);
      const targetKpi = Math.max(0, Number(record?.kpiStandard ?? collaborator.defaultKpiStandard ?? 0));
      const remainingKpi = Math.max(targetKpi - actualKpi, 0);
      const overKpi = Math.max(actualKpi - targetKpi, 0);

      return {
        collaboratorId: collaborator.collaboratorId,
        teamId: collaborator.teamId,
        name: collaborator.name,
        penName: collaborator.penName,
        role: collaborator.role,
        status: collaborator.status,
        linkedUserRole: collaborator.linkedUserRole,
        targetKpi,
        actualKpi,
        totalKpi: targetKpi,
        remainingKpi,
        overKpi,
        completionPercentage: getCompletionPercentage(actualKpi, targetKpi),
        evaluation: record?.evaluation || null,
      } satisfies KpiContributorRow;
    })
    .sort((left, right) => {
      if (left.status !== right.status) {
        return left.status === "active" ? -1 : 1;
      }
      return left.name.localeCompare(right.name, "vi");
    });
}

export async function GET(request: NextRequest) {
  try {
    await ensureDatabaseInitialized();
    const context = await getCurrentUserContext();
    if (!context) {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const { month, year } = getMonthYear(searchParams);
    const requestedTeamId = normalizeTeamId(searchParams.get("teamId"));
    const scopedTeamId = context.user.role === "admin"
      ? resolveScopedTeamId(context, requestedTeamId)
      : getContextTeamId(context);
    const canManage = context.user.role === "admin";

    if (context.user.role === "admin" && !scopedTeamId && !context.user.isLeader) {
      return NextResponse.json({ success: true, data: buildEmptyResponse(month, year, null, canManage) });
    }

    const [collaboratorRows, scopedArticles, scopedRecords] = await Promise.all([
      loadScopedCollaborators(context, scopedTeamId),
      loadScopedArticles(context, scopedTeamId),
      loadScopedKpiRecords(month, year, scopedTeamId, context),
    ]);

    const monthArticles = scopedArticles.filter((article) => matchesRoyaltyMonthYear(article.date, month, year));
    const rows = buildKpiRows({
      collaborators: collaboratorRows,
      monthArticles,
      records: scopedRecords,
    });

    const identityCandidates = getContextIdentityCandidates(context);
    const viewerSummary = rows.find((row) =>
      context.collaborator?.id
        ? row.collaboratorId === context.collaborator.id
        : matchesIdentityCandidate(identityCandidates, row.penName)
    ) || null;

    return NextResponse.json({
      success: true,
      data: {
        month,
        year,
        teamId: scopedTeamId,
        canManage,
        rows: context.user.role === "admin" ? rows : (viewerSummary ? [viewerSummary] : []),
        summary: buildSummary(context.user.role === "admin" ? rows : (viewerSummary ? [viewerSummary] : [])),
        viewerSummary: viewerSummary
          ? {
              penName: viewerSummary.penName,
              name: viewerSummary.name,
              role: viewerSummary.role,
              targetKpi: viewerSummary.targetKpi,
              actualKpi: viewerSummary.actualKpi,
              remainingKpi: viewerSummary.remainingKpi,
              overKpi: viewerSummary.overKpi,
              completionPercentage: viewerSummary.completionPercentage,
            }
          : null,
      },
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    return handleServerError("kpi.get", error);
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

    const body = await request.json() as Record<string, unknown>;
    const month = requiredInt(body.month, "month");
    const year = requiredInt(body.year, "year");
    const scopedTeamId = resolveScopedTeamId(context, body.teamId);
    const recordsInput = Array.isArray(body.records) ? body.records : [body];

    if (!scopedTeamId && !context.user.isLeader) {
      return NextResponse.json({ success: false, error: "Không xác định được team để lưu KPI" }, { status: 400 });
    }

    const scopedCollaborators = await loadScopedCollaborators(context, scopedTeamId);
    const allowedCollaborators = scopedCollaborators.filter((collaborator) => collaborator.linkedUserRole !== "admin");
    const collaboratorByPenName = new Map(allowedCollaborators.map((collaborator) => [collaborator.penName, collaborator]));
    const existingRecords = await loadScopedKpiRecords(month, year, scopedTeamId, context);
    const existingRecordByPenName = new Map(existingRecords.map((record) => [record.penName, record]));

    await db.transaction(async (tx) => {
      for (const rawRecord of recordsInput) {
        const record = rawRecord as Record<string, unknown>;
        const penName = String(record.penName || "").trim();
        const collaborator = collaboratorByPenName.get(penName);
        if (!collaborator) {
          throw new ValidationError(`Không tìm thấy cộng tác viên hợp lệ cho bút danh ${penName}`);
        }

        const kpiStandard = Math.max(0, requiredInt(record.kpiStandard, "kpiStandard"));
        const evaluation = optionalString(record.evaluation) ?? null;
        const existingRecord = existingRecordByPenName.get(penName);

        if (existingRecord) {
          await tx.update(kpiRecords)
            .set({
              kpiStandard,
              evaluation,
            })
            .where(eq(kpiRecords.id, existingRecord.id))
            .run();
          continue;
        }

        await tx.insert(kpiRecords)
          .values({
            teamId: collaborator.teamId ?? scopedTeamId,
            month,
            year,
            penName,
            kpiStandard,
            kpiActual: 0,
            evaluation,
          })
          .run();
      }
    });

    await publishRealtimeEvent({
      channels: ["kpi", "team", "dashboard"],
      toastTitle: "KPI đã cập nhật",
      toastMessage: `Đã cập nhật KPI tháng ${month}/${year}.`,
      toastVariant: "success",
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    return handleServerError("kpi.post", error);
  }
}
