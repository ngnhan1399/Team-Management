import { db, ensureDatabaseInitialized, ensureKpiSchemaInitialized } from "@/db";
import { articles, collaborators, kpiMonthlyTargets, kpiRecords, users } from "@/db/schema";
import { getContextIdentityCandidates, getCurrentUserContext, matchesIdentityCandidate } from "@/lib/auth";
import { createNotification } from "@/lib/notifications";
import { publishRealtimeEvent } from "@/lib/realtime";
import { matchesRoyaltyMonthYear } from "@/lib/royalty";
import { enforceTrustedOrigin } from "@/lib/request-security";
import { handleServerError } from "@/lib/server-error";
import { getContextTeamId, normalizeTeamId, resolveScopedTeamId } from "@/lib/teams";
import { optionalString, requiredInt, ValidationError } from "@/lib/validation";
import { and, eq, or, type SQL } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

type KpiRole = "writer" | "reviewer";

type KpiContributorRow = {
  collaboratorId: number;
  teamId: number | null;
  name: string;
  penName: string;
  role: KpiRole;
  status: string;
  linkedUserId: number | null;
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
  role: KpiRole | "all";
  totalMembers: number;
  totalMonthlyTarget: number;
  totalAssignedKpi: number;
  totalActualKpi: number;
  totalRemainingKpi: number;
  totalOverKpi: number;
  totalUnassignedKpi: number;
  totalOverAssignedKpi: number;
  completionPercentage: number;
};

type KpiMonthlyTargetsMap = {
  writer: number;
  reviewer: number;
};

type CollaboratorScopeRow = {
  collaboratorId: number;
  teamId: number | null;
  name: string;
  penName: string;
  role: KpiRole;
  status: string;
  defaultKpiStandard: number;
  linkedUserId: number | null;
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

type UserContext = NonNullable<Awaited<ReturnType<typeof getCurrentUserContext>>>;

type KpiMonthlyTargetScopeRow = {
  id: number;
  teamId: number | null;
  month: number;
  year: number;
  role: KpiRole;
  targetKpi: number;
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

function parseNonNegativeInt(value: unknown, fieldName: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ValidationError(`${fieldName} không hợp lệ`);
  }
  return parsed;
}

function getCompletionPercentage(actualKpi: number, targetKpi: number) {
  if (targetKpi <= 0) {
    return actualKpi > 0 ? 100 : 0;
  }
  return Math.round((actualKpi / targetKpi) * 100);
}

function buildSummary(rows: KpiContributorRow[], monthlyTarget: number, role: KpiRole | "all"): KpiSummary {
  const totalAssignedKpi = rows.reduce((sum, row) => sum + row.targetKpi, 0);
  const totalActualKpi = rows.reduce((sum, row) => sum + row.actualKpi, 0);
  const totalRemainingKpi = rows.reduce((sum, row) => sum + row.remainingKpi, 0);
  const totalOverKpi = rows.reduce((sum, row) => sum + row.overKpi, 0);
  const totalUnassignedKpi = Math.max(monthlyTarget - totalAssignedKpi, 0);
  const totalOverAssignedKpi = Math.max(totalAssignedKpi - monthlyTarget, 0);
  const comparisonBase = monthlyTarget > 0 ? monthlyTarget : totalAssignedKpi;

  return {
    role,
    totalMembers: rows.length,
    totalMonthlyTarget: monthlyTarget,
    totalAssignedKpi,
    totalActualKpi,
    totalRemainingKpi,
    totalOverKpi,
    totalUnassignedKpi,
    totalOverAssignedKpi,
    completionPercentage: comparisonBase > 0 ? Math.round((totalActualKpi / comparisonBase) * 100) : (totalActualKpi > 0 ? 100 : 0),
  };
}

function buildCombinedSummary(writerSummary: KpiSummary, reviewerSummary: KpiSummary): KpiSummary {
  const totalMonthlyTarget = writerSummary.totalMonthlyTarget + reviewerSummary.totalMonthlyTarget;
  const totalAssignedKpi = writerSummary.totalAssignedKpi + reviewerSummary.totalAssignedKpi;
  const totalActualKpi = writerSummary.totalActualKpi + reviewerSummary.totalActualKpi;
  const comparisonBase = totalMonthlyTarget > 0 ? totalMonthlyTarget : totalAssignedKpi;

  return {
    role: "all",
    totalMembers: writerSummary.totalMembers + reviewerSummary.totalMembers,
    totalMonthlyTarget,
    totalAssignedKpi,
    totalActualKpi,
    totalRemainingKpi: writerSummary.totalRemainingKpi + reviewerSummary.totalRemainingKpi,
    totalOverKpi: writerSummary.totalOverKpi + reviewerSummary.totalOverKpi,
    totalUnassignedKpi: writerSummary.totalUnassignedKpi + reviewerSummary.totalUnassignedKpi,
    totalOverAssignedKpi: writerSummary.totalOverAssignedKpi + reviewerSummary.totalOverAssignedKpi,
    completionPercentage: comparisonBase > 0 ? Math.round((totalActualKpi / comparisonBase) * 100) : (totalActualKpi > 0 ? 100 : 0),
  };
}

function buildEmptyResponse(month: number, year: number, teamId: number | null, canManage: boolean) {
  const monthlyTargets: KpiMonthlyTargetsMap = { writer: 0, reviewer: 0 };
  const writerSummary = buildSummary([], monthlyTargets.writer, "writer");
  const reviewerSummary = buildSummary([], monthlyTargets.reviewer, "reviewer");
  return {
    month,
    year,
    teamId,
    canManage,
    monthlyTargets,
    writerRows: [] as KpiContributorRow[],
    reviewerRows: [] as KpiContributorRow[],
    writerSummary,
    reviewerSummary,
    summary: buildCombinedSummary(writerSummary, reviewerSummary),
    viewerSummary: null,
  };
}

async function loadScopedCollaborators(context: UserContext, scopedTeamId: number | null) {
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
        linkedUserId: users.id,
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
        linkedUserId: users.id,
        linkedUserRole: users.role,
      })
      .from(collaborators)
      .leftJoin(users, eq(users.collaboratorId, collaborators.id))
      .where(eq(collaborators.id, context.collaborator.id))
      .all() as Promise<CollaboratorScopeRow[]>;
  }

  return [] as CollaboratorScopeRow[];
}

async function loadScopedArticles(context: UserContext, scopedTeamId: number | null) {
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

async function loadScopedKpiRecords(month: number, year: number, scopedTeamId: number | null, context: UserContext) {
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

async function loadScopedMonthlyTargets(month: number, year: number, scopedTeamId: number | null) {
  if (!scopedTeamId) {
    return [] as KpiMonthlyTargetScopeRow[];
  }

  return db
    .select({
      id: kpiMonthlyTargets.id,
      teamId: kpiMonthlyTargets.teamId,
      month: kpiMonthlyTargets.month,
      year: kpiMonthlyTargets.year,
      role: kpiMonthlyTargets.role,
      targetKpi: kpiMonthlyTargets.targetKpi,
    })
    .from(kpiMonthlyTargets)
    .where(and(eq(kpiMonthlyTargets.teamId, scopedTeamId), eq(kpiMonthlyTargets.month, month), eq(kpiMonthlyTargets.year, year)))
    .all() as Promise<KpiMonthlyTargetScopeRow[]>;
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
        linkedUserId: collaborator.linkedUserId ?? null,
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

function buildMonthlyTargetMap(rows: KpiContributorRow[], targetRows: KpiMonthlyTargetScopeRow[]): KpiMonthlyTargetsMap {
  const assignedByRole: KpiMonthlyTargetsMap = { writer: 0, reviewer: 0 };
  for (const row of rows) {
    assignedByRole[row.role] += row.targetKpi;
  }

  return {
    writer: targetRows.find((row) => row.role === "writer")?.targetKpi ?? assignedByRole.writer,
    reviewer: targetRows.find((row) => row.role === "reviewer")?.targetKpi ?? assignedByRole.reviewer,
  };
}

function splitRowsByRole(rows: KpiContributorRow[]) {
  return {
    writerRows: rows.filter((row) => row.role === "writer"),
    reviewerRows: rows.filter((row) => row.role === "reviewer"),
  };
}

function buildViewerSummary(viewerRow: KpiContributorRow | null) {
  if (!viewerRow) return null;
  return {
    penName: viewerRow.penName,
    name: viewerRow.name,
    role: viewerRow.role,
    targetKpi: viewerRow.targetKpi,
    actualKpi: viewerRow.actualKpi,
    remainingKpi: viewerRow.remainingKpi,
    overKpi: viewerRow.overKpi,
    completionPercentage: viewerRow.completionPercentage,
  };
}

function buildResponseData(options: {
  month: number;
  year: number;
  teamId: number | null;
  canManage: boolean;
  rows: KpiContributorRow[];
  monthlyTargets: KpiMonthlyTargetsMap;
  context: UserContext;
}) {
  const { writerRows, reviewerRows } = splitRowsByRole(options.rows);
  const identityCandidates = getContextIdentityCandidates(options.context);
  const viewerRow = options.rows.find((row) =>
    options.context.collaborator?.id
      ? row.collaboratorId === options.context.collaborator.id
      : matchesIdentityCandidate(identityCandidates, row.penName)
  ) || null;

  const visibleWriterRows = options.context.user.role === "admin"
    ? writerRows
    : (viewerRow?.role === "writer" ? [viewerRow] : []);
  const visibleReviewerRows = options.context.user.role === "admin"
    ? reviewerRows
    : (viewerRow?.role === "reviewer" ? [viewerRow] : []);
  const visibleTargets: KpiMonthlyTargetsMap = options.context.user.role === "admin"
    ? options.monthlyTargets
    : {
        writer: viewerRow?.role === "writer" ? options.monthlyTargets.writer : 0,
        reviewer: viewerRow?.role === "reviewer" ? options.monthlyTargets.reviewer : 0,
      };

  const writerSummary = buildSummary(visibleWriterRows, visibleTargets.writer, "writer");
  const reviewerSummary = buildSummary(visibleReviewerRows, visibleTargets.reviewer, "reviewer");

  return {
    month: options.month,
    year: options.year,
    teamId: options.teamId,
    canManage: options.canManage,
    monthlyTargets: visibleTargets,
    writerRows: visibleWriterRows,
    reviewerRows: visibleReviewerRows,
    writerSummary,
    reviewerSummary,
    summary: buildCombinedSummary(writerSummary, reviewerSummary),
    viewerSummary: buildViewerSummary(viewerRow),
  };
}

function getRoleLabel(role: KpiRole) {
  return role === "reviewer" ? "duyệt bài" : "viết bài";
}

export async function GET(request: NextRequest) {
  try {
    await ensureDatabaseInitialized();
    await ensureKpiSchemaInitialized();
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

    const [collaboratorRows, scopedArticles, scopedRecords, monthlyTargetRows] = await Promise.all([
      loadScopedCollaborators(context, scopedTeamId),
      loadScopedArticles(context, scopedTeamId),
      loadScopedKpiRecords(month, year, scopedTeamId, context),
      loadScopedMonthlyTargets(month, year, scopedTeamId),
    ]);

    const monthArticles = scopedArticles.filter((article) => matchesRoyaltyMonthYear(article.date, month, year));
    const rows = buildKpiRows({ collaborators: collaboratorRows, monthArticles, records: scopedRecords });
    const monthlyTargets = buildMonthlyTargetMap(rows, monthlyTargetRows);

    return NextResponse.json({
      success: true,
      data: buildResponseData({
        month,
        year,
        teamId: scopedTeamId,
        canManage,
        rows,
        monthlyTargets,
        context,
      }),
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
    await ensureKpiSchemaInitialized();
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
    const action = optionalString(body.action);
    const month = requiredInt(body.month, "month");
    const year = requiredInt(body.year, "year");
    const scopedTeamId = resolveScopedTeamId(context, body.teamId);

    if (!scopedTeamId && !context.user.isLeader) {
      return NextResponse.json({ success: false, error: "Không xác định được team để lưu KPI" }, { status: 400 });
    }

    const [scopedCollaborators, existingRecords, existingMonthlyTargets, scopedArticles] = await Promise.all([
      loadScopedCollaborators(context, scopedTeamId),
      loadScopedKpiRecords(month, year, scopedTeamId, context),
      loadScopedMonthlyTargets(month, year, scopedTeamId),
      loadScopedArticles(context, scopedTeamId),
    ]);

    const allowedCollaborators = scopedCollaborators.filter((collaborator) => collaborator.linkedUserRole !== "admin");
    const collaboratorByPenName = new Map(allowedCollaborators.map((collaborator) => [collaborator.penName, collaborator]));
    const existingRecordByPenName = new Map(existingRecords.map((record) => [record.penName, record]));
    const currentRows = buildKpiRows({
      collaborators: scopedCollaborators,
      monthArticles: scopedArticles.filter((article) => matchesRoyaltyMonthYear(article.date, month, year)),
      records: existingRecords,
    });
    const currentMonthlyTargets = buildMonthlyTargetMap(currentRows, existingMonthlyTargets);

    if (action === "warn") {
      const penName = String(body.penName || "").trim();
      const row = currentRows.find((item) => item.penName === penName);
      if (!row) {
        return NextResponse.json({ success: false, error: "Không tìm thấy cộng tác viên cần cảnh báo" }, { status: 404 });
      }
      if (row.remainingKpi <= 0) {
        return NextResponse.json({ success: false, error: "CTV này đã hoàn thành KPI tháng hiện tại" }, { status: 400 });
      }
      if (!row.linkedUserId) {
        return NextResponse.json({ success: false, error: "CTV này chưa liên kết tài khoản để nhận cảnh báo" }, { status: 400 });
      }

      await createNotification({
        fromUserId: context.user.id,
        toUserId: row.linkedUserId,
        toPenName: row.penName,
        type: "system",
        title: `Cảnh báo KPI tháng ${month}/${year}`,
        message: `Bạn đã hoàn thành ${row.actualKpi}/${row.targetKpi} KPI ${getRoleLabel(row.role)} trong tháng ${month}/${year}. Bạn còn ${row.remainingKpi} ${row.role === "reviewer" ? "bài duyệt" : "bài viết"} để hoàn thành KPI. Cố lên nhé!`,
      });

      await publishRealtimeEvent({
        channels: ["kpi"],
        toastTitle: "Đã gửi cảnh báo KPI",
        toastMessage: `Đã nhắc ${row.name} hoàn thành KPI tháng ${month}/${year}.`,
        toastVariant: "success",
      });

      return NextResponse.json({ success: true, message: `Đã gửi cảnh báo KPI cho ${row.name}.` });
    }

    const recordsInput = Array.isArray(body.records) ? body.records : [body];
    const monthlyTargetsInput = (body.monthlyTargets && typeof body.monthlyTargets === "object")
      ? body.monthlyTargets as Record<string, unknown>
      : {};
    const nextMonthlyTargets: KpiMonthlyTargetsMap = {
      writer: parseNonNegativeInt(monthlyTargetsInput.writer ?? currentMonthlyTargets.writer ?? 0, "KPI tổng CTV viết"),
      reviewer: parseNonNegativeInt(monthlyTargetsInput.reviewer ?? currentMonthlyTargets.reviewer ?? 0, "KPI tổng CTV duyệt"),
    };

    const nextTargetByPenName = new Map<string, number>();
    for (const row of currentRows) {
      nextTargetByPenName.set(row.penName, row.targetKpi);
    }

    for (const rawRecord of recordsInput) {
      const record = rawRecord as Record<string, unknown>;
      const penName = String(record.penName || "").trim();
      const collaborator = collaboratorByPenName.get(penName);
      if (!collaborator) {
        throw new ValidationError(`Không tìm thấy cộng tác viên hợp lệ cho bút danh ${penName}`);
      }
      nextTargetByPenName.set(penName, parseNonNegativeInt(record.kpiStandard, `KPI của ${penName}`));
    }

    const assignedByRole: KpiMonthlyTargetsMap = { writer: 0, reviewer: 0 };
    for (const collaborator of allowedCollaborators) {
      assignedByRole[collaborator.role] += nextTargetByPenName.get(collaborator.penName) ?? Math.max(0, collaborator.defaultKpiStandard || 0);
    }

    if (assignedByRole.writer > nextMonthlyTargets.writer) {
      return NextResponse.json({
        success: false,
        error: `Tổng KPI phân cho CTV viết (${assignedByRole.writer}) đang vượt KPI tháng đã đặt (${nextMonthlyTargets.writer}).`,
      }, { status: 400 });
    }
    if (assignedByRole.reviewer > nextMonthlyTargets.reviewer) {
      return NextResponse.json({
        success: false,
        error: `Tổng KPI phân cho CTV duyệt (${assignedByRole.reviewer}) đang vượt KPI tháng đã đặt (${nextMonthlyTargets.reviewer}).`,
      }, { status: 400 });
    }

    const existingMonthlyTargetByRole = new Map(existingMonthlyTargets.map((row) => [row.role, row]));

    await db.transaction(async (tx) => {
      for (const rawRecord of recordsInput) {
        const record = rawRecord as Record<string, unknown>;
        const penName = String(record.penName || "").trim();
        const collaborator = collaboratorByPenName.get(penName);
        if (!collaborator) {
          throw new ValidationError(`Không tìm thấy cộng tác viên hợp lệ cho bút danh ${penName}`);
        }

        const kpiStandard = parseNonNegativeInt(record.kpiStandard, `KPI của ${penName}`);
        const evaluation = optionalString(record.evaluation) ?? null;
        const existingRecord = existingRecordByPenName.get(penName);

        if (existingRecord) {
          await tx.update(kpiRecords)
            .set({ kpiStandard, evaluation })
            .where(eq(kpiRecords.id, existingRecord.id))
            .run();
        } else {
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
      }

      for (const role of ["writer", "reviewer"] as const) {
        const existingTarget = existingMonthlyTargetByRole.get(role);
        if (existingTarget) {
          await tx.update(kpiMonthlyTargets)
            .set({ targetKpi: nextMonthlyTargets[role], updatedAt: new Date().toISOString() })
            .where(eq(kpiMonthlyTargets.id, existingTarget.id))
            .run();
        } else {
          await tx.insert(kpiMonthlyTargets)
            .values({
              teamId: scopedTeamId,
              month,
              year,
              role,
              targetKpi: nextMonthlyTargets[role],
              updatedAt: new Date().toISOString(),
            })
            .run();
        }
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