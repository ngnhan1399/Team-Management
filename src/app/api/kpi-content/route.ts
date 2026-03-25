import { after, NextRequest, NextResponse } from "next/server";
import { desc, eq, inArray } from "drizzle-orm";
import { db, ensureDatabaseInitialized, ensureKpiContentSchemaInitialized } from "@/db";
import { articles, collaborators, kpiContentRegistrationBatches, kpiContentRegistrations, users } from "@/db/schema";
import { getContextDisplayName, getCurrentUserContext, matchesIdentityCandidate } from "@/lib/auth";
import { enforceTrustedOrigin } from "@/lib/request-security";
import { handleServerError } from "@/lib/server-error";
import { canAccessTeam, resolveScopedTeamId } from "@/lib/teams";
import { writeAuditLog } from "@/lib/audit";
import { processKpiContentRegistrationJob } from "@/lib/kpi-content-automation";
import { KPI_CONTENT_FORM_URL, getKpiContentStatusLabel, normalizeEmployeeCode, resolveKpiContentTaskSelection, type KpiContentStatus } from "@/lib/kpi-content-registration";
import { expandCollaboratorIdentityValues, resolvePreferredCollaboratorPenName } from "@/lib/collaborator-identity";
import { normalizeString } from "@/lib/normalize";

type KpiContentBatchRow = {
  id: number;
  teamId: number | null;
  requestedByUserId: number;
  employeeCode: string;
  batchKey: string;
  batchSize: number;
  taskLabel: string;
  detailLabel: string;
  status: KpiContentStatus;
  attemptCount: number;
  automationMessage: string | null;
  lastError: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type KpiContentItemRow = {
  id: number;
  articleId: number;
  teamId: number | null;
  requestedByUserId: number;
  employeeCode: string;
  batchId: string;
  batchPosition: number;
  batchSize: number;
  groupedArticleIds: string | null;
  penName: string;
  title: string;
  articleLink: string | null;
  articleDate: string;
  articleStatus: string;
  taskLabel: string;
  detailLabel: string;
  status: KpiContentStatus;
  attemptCount: number;
  automationMessage: string | null;
  lastError: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type KpiContentInsertStatus = "queued" | "submitting_form" | "form_submitted" | "completed" | "failed";

const EDITORIAL_PEN_NAMES = new Set(["nhan btv", "nhân btv"]);

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function isEditorialPenName(value: string | null | undefined) {
  return EDITORIAL_PEN_NAMES.has(normalizeString(value).toLowerCase());
}

function buildBatchKey() {
  return `kpi-content-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeArticleIds(value: unknown): number[] {
  const rawValues = Array.isArray(value) ? value : [value];
  const ids = rawValues
    .flatMap((item) => {
      if (typeof item === "string" && item.includes(",")) {
        return item.split(",");
      }
      return [item];
    })
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0);

  return Array.from(new Set(ids)).slice(0, 5);
}

async function loadBatches(scopedTeamId: number | null) {
  const rows = await db
    .select({
      id: kpiContentRegistrationBatches.id,
      teamId: kpiContentRegistrationBatches.teamId,
      requestedByUserId: kpiContentRegistrationBatches.requestedByUserId,
      employeeCode: kpiContentRegistrationBatches.employeeCode,
      batchKey: kpiContentRegistrationBatches.batchKey,
      batchSize: kpiContentRegistrationBatches.batchSize,
      taskLabel: kpiContentRegistrationBatches.taskLabel,
      detailLabel: kpiContentRegistrationBatches.detailLabel,
      status: kpiContentRegistrationBatches.status,
      attemptCount: kpiContentRegistrationBatches.attemptCount,
      automationMessage: kpiContentRegistrationBatches.automationMessage,
      lastError: kpiContentRegistrationBatches.lastError,
      submittedAt: kpiContentRegistrationBatches.submittedAt,
      completedAt: kpiContentRegistrationBatches.completedAt,
      createdAt: kpiContentRegistrationBatches.createdAt,
      updatedAt: kpiContentRegistrationBatches.updatedAt,
    })
    .from(kpiContentRegistrationBatches)
    .where(scopedTeamId ? eq(kpiContentRegistrationBatches.teamId, scopedTeamId) : undefined)
    .orderBy(desc(kpiContentRegistrationBatches.createdAt), desc(kpiContentRegistrationBatches.id))
    .all() as KpiContentBatchRow[];

  if (rows.length === 0) {
    return { batches: rows, itemsByBatch: new Map<string, KpiContentItemRow[]>() };
  }

  const batchKeys = rows.map((row) => row.batchKey);
  const itemRows = await db
    .select({
      id: kpiContentRegistrations.id,
      articleId: kpiContentRegistrations.articleId,
      teamId: kpiContentRegistrations.teamId,
      requestedByUserId: kpiContentRegistrations.requestedByUserId,
      employeeCode: kpiContentRegistrations.employeeCode,
      batchId: kpiContentRegistrations.batchId,
      batchPosition: kpiContentRegistrations.batchPosition,
      batchSize: kpiContentRegistrations.batchSize,
      groupedArticleIds: kpiContentRegistrations.groupedArticleIds,
      penName: kpiContentRegistrations.penName,
      title: kpiContentRegistrations.title,
      articleLink: kpiContentRegistrations.articleLink,
      articleDate: kpiContentRegistrations.articleDate,
      articleStatus: kpiContentRegistrations.articleStatus,
      taskLabel: kpiContentRegistrations.taskLabel,
      detailLabel: kpiContentRegistrations.detailLabel,
      status: kpiContentRegistrations.status,
      attemptCount: kpiContentRegistrations.attemptCount,
      automationMessage: kpiContentRegistrations.automationMessage,
      lastError: kpiContentRegistrations.lastError,
      submittedAt: kpiContentRegistrations.submittedAt,
      completedAt: kpiContentRegistrations.completedAt,
      createdAt: kpiContentRegistrations.createdAt,
      updatedAt: kpiContentRegistrations.updatedAt,
    })
    .from(kpiContentRegistrations)
    .where(inArray(kpiContentRegistrations.batchId, batchKeys))
    .orderBy(kpiContentRegistrations.batchPosition, kpiContentRegistrations.id)
    .all() as KpiContentItemRow[];

  const itemsByBatch = new Map<string, KpiContentItemRow[]>();
  for (const item of itemRows) {
    const batchItems = itemsByBatch.get(item.batchId) || [];
    batchItems.push(item);
    itemsByBatch.set(item.batchId, batchItems);
  }

  return { batches: rows, itemsByBatch };
}

async function resolveEditorialArticleIds(
  rows: Array<{
    id: number;
    teamId: number | null;
    penName: string;
    createdByUserId: number | null;
  }>,
) {
  const penNames = Array.from(new Set(rows.map((row) => normalizeString(row.penName)).filter(Boolean)));
  const teamIds = Array.from(new Set(rows.map((row) => Number(row.teamId)).filter((teamId) => Number.isInteger(teamId) && teamId > 0)));
  const creatorIds = Array.from(new Set(rows.map((row) => Number(row.createdByUserId)).filter((userId) => Number.isInteger(userId) && userId > 0)));
  const collaboratorLookupValues = Array.from(
    new Set(
      penNames
        .flatMap((value) => expandCollaboratorIdentityValues([value]))
        .map((value) => normalizeString(value))
        .filter(Boolean),
    ),
  );

  const [collaboratorProfiles, creatorProfiles] = await Promise.all([
    penNames.length > 0
      ? db
        .select({
          teamId: collaborators.teamId,
          name: collaborators.name,
          penName: collaborators.penName,
          linkedUserRole: users.role,
        })
        .from(collaborators)
        .leftJoin(users, eq(users.collaboratorId, collaborators.id))
        .where(
          teamIds.length > 0
            ? inArray(collaborators.teamId, teamIds as never[])
            : collaboratorLookupValues.length > 0
              ? inArray(collaborators.penName, collaboratorLookupValues as never[])
              : undefined,
        )
        .all()
      : Promise.resolve([]),
    creatorIds.length > 0
      ? db
        .select({
          id: users.id,
          role: users.role,
        })
        .from(users)
        .where(inArray(users.id, creatorIds))
        .all()
      : Promise.resolve([]),
  ]);

  const collaboratorProfileByKey = new Map(
    collaboratorProfiles.map((profile) => [
      `${Number(profile.teamId || 0)}::${normalizeString(profile.penName).toLowerCase()}`,
      profile,
    ]),
  );
  const collaboratorProfilesByTeam = new Map<number, typeof collaboratorProfiles>();
  for (const profile of collaboratorProfiles) {
    const teamKey = Number(profile.teamId || 0);
    const existingProfiles = collaboratorProfilesByTeam.get(teamKey) || [];
    existingProfiles.push(profile);
    collaboratorProfilesByTeam.set(teamKey, existingProfiles);
  }
  const creatorRoleById = new Map(creatorProfiles.map((profile) => [Number(profile.id), profile.role]));

  return new Set(
    rows
      .filter((row) => {
        const normalizedPenName = normalizeString(row.penName).toLowerCase();
        const collaboratorProfile = collaboratorProfileByKey.get(
          `${Number(row.teamId || 0)}::${normalizedPenName}`,
        ) || (collaboratorProfilesByTeam.get(Number(row.teamId || 0)) || []).find((profile) =>
          matchesIdentityCandidate(
            [profile.penName, profile.name || ""].filter(Boolean) as string[],
            row.penName,
          ),
        );

        if (collaboratorProfile?.linkedUserRole === "admin") {
          return true;
        }

        const creatorRole = creatorRoleById.get(Number(row.createdByUserId || 0)) || null;
        const preferredPenName = resolvePreferredCollaboratorPenName([row.penName], row.penName || "") || row.penName || "";
        return creatorRole === "admin" && isEditorialPenName(preferredPenName);
      })
      .map((row) => row.id),
  );
}

export async function GET(request: NextRequest) {
  try {
    await ensureDatabaseInitialized();
    await ensureKpiContentSchemaInitialized();

    const context = await getCurrentUserContext();
    if (!context) {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    }
    if (context.user.role !== "admin") {
      return NextResponse.json({ success: false, error: "Quyen truy cap khong hop le" }, { status: 403 });
    }

    const requestedTeamId = normalizeText(request.nextUrl.searchParams.get("teamId"));
    const scopedTeamId = resolveScopedTeamId(context, requestedTeamId);
    const { batches, itemsByBatch } = await loadBatches(scopedTeamId);
    const requesterIds = Array.from(new Set(batches.map((batch) => batch.requestedByUserId)));
    const requesterRows = requesterIds.length > 0
      ? await db
        .select({
          id: users.id,
          email: users.email,
          employeeCode: users.employeeCode,
          role: users.role,
          isLeader: users.isLeader,
        })
        .from(users)
        .where(inArray(users.id, requesterIds))
        .all()
      : [];

    const requesterById = new Map(requesterRows.map((row) => [Number(row.id), row]));

    return NextResponse.json({
      success: true,
      data: {
        batches: batches.map((batch) => {
        const items = itemsByBatch.get(batch.batchKey) || [];
        const requester = requesterById.get(batch.requestedByUserId) || null;
        return {
          ...batch,
          statusLabel: getKpiContentStatusLabel(batch.status),
          requestedByEmail: requester?.email ?? null,
          requestedByEmployeeCode: requester?.employeeCode ?? null,
          requestedByDisplayName: requester?.employeeCode || requester?.email || `user-${batch.requestedByUserId}`,
          registrations: items.map((item) => ({
            ...item,
            statusLabel: getKpiContentStatusLabel(item.status),
          })),
          formUrl: KPI_CONTENT_FORM_URL,
        };
        }),
        total: batches.length,
      },
    });
  } catch (error) {
    return handleServerError("kpi-content.get", error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureDatabaseInitialized();
    await ensureKpiContentSchemaInitialized();

    const originError = enforceTrustedOrigin(request);
    if (originError) return originError;

    const context = await getCurrentUserContext();
    if (!context) {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    }
    if (context.user.role !== "admin") {
      return NextResponse.json({ success: false, error: "Chi admin/leader moi co quyen dang ky KPI Content" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const force = body?.force === true;
    const articleIds = normalizeArticleIds(body?.articleIds ?? body?.articleId);

    if (articleIds.length === 0) {
      return NextResponse.json({ success: false, error: "Can chon toi thieu 1 bai viet" }, { status: 400 });
    }

    const employeeCode = normalizeEmployeeCode(context.user.employeeCode ?? context.token.employeeCode ?? null);
    if (!employeeCode) {
      return NextResponse.json({ success: false, error: "Vui long khai bao ma nhan vien cho admin/leader truoc khi dang ky KPI Content" }, { status: 400 });
    }

    const articleRows = await db
      .select({
        id: articles.id,
        teamId: articles.teamId,
        createdByUserId: articles.createdByUserId,
        title: articles.title,
        penName: articles.penName,
        articleType: articles.articleType,
        contentType: articles.contentType,
        category: articles.category,
        link: articles.link,
        date: articles.date,
        status: articles.status,
      })
      .from(articles)
      .where(inArray(articles.id, articleIds))
      .all();

    if (articleRows.length !== articleIds.length) {
      return NextResponse.json({ success: false, error: "Khong tim thay du bai viet de tao batch KPI Content" }, { status: 404 });
    }

    const firstTeamId = articleRows[0]?.teamId ?? null;
    if (!canAccessTeam(context, firstTeamId)) {
      return NextResponse.json({ success: false, error: "Bai viet nam ngoai pham vi team cua ban" }, { status: 403 });
    }

    if (articleRows.some((row) => !canAccessTeam(context, row.teamId))) {
      return NextResponse.json({ success: false, error: "Tat ca bai viet trong batch phai thuoc pham vi team cua ban" }, { status: 403 });
    }

    if (articleRows.some((row) => !normalizeText(row.link))) {
      return NextResponse.json({ success: false, error: "Chi dang ky KPI Content cho cac bai da co link" }, { status: 400 });
    }

    const editorialArticleIds = await resolveEditorialArticleIds(articleRows);
    if (editorialArticleIds.size !== articleRows.length) {
      return NextResponse.json({ success: false, error: "KPI Content chi danh cho bai bien tap/admin trong pham vi ban quan ly" }, { status: 403 });
    }

    const taskSelections = articleRows.map((row) => resolveKpiContentTaskSelection(row));
    if (taskSelections.some((selection) => !selection)) {
      return NextResponse.json({ success: false, error: "Co bai chua duoc anh xa sang KPI Content" }, { status: 400 });
    }

    const firstSelection = taskSelections[0]!;
    if (taskSelections.some((selection) => selection!.taskLabel !== firstSelection.taskLabel || selection!.detailLabel !== firstSelection.detailLabel)) {
      return NextResponse.json({ success: false, error: "Chi co the gom cac bai cung loai KPI Content vao chung mot batch" }, { status: 400 });
    }

    const activeStatuses: KpiContentStatus[] = ["queued", "submitting_form", "form_submitted"];
    const existingItems = await db
      .select({
        articleId: kpiContentRegistrations.articleId,
        batchId: kpiContentRegistrations.batchId,
        status: kpiContentRegistrations.status,
      })
      .from(kpiContentRegistrations)
      .where(inArray(kpiContentRegistrations.articleId, articleIds))
      .all();

    const existingBatchIds = Array.from(new Set(existingItems.map((item) => normalizeText(item.batchId)).filter(Boolean)));

    if (!force && existingItems.some((item) => activeStatuses.includes(item.status as KpiContentStatus))) {
      return NextResponse.json({
        success: false,
        error: "Co it nhat mot bai dang KPI Content duoc xu ly. Hay doi hoan thanh hoac dung force de ghi de.",
      }, { status: 409 });
    }

    if (
      !force
      && existingItems.length === articleIds.length
      && existingBatchIds.length === 1
      && existingItems.every((item) => item.status === "completed")
    ) {
      const existingBatch = await db
        .select({
          id: kpiContentRegistrationBatches.id,
          batchKey: kpiContentRegistrationBatches.batchKey,
          batchSize: kpiContentRegistrationBatches.batchSize,
          taskLabel: kpiContentRegistrationBatches.taskLabel,
          detailLabel: kpiContentRegistrationBatches.detailLabel,
          status: kpiContentRegistrationBatches.status,
        })
        .from(kpiContentRegistrationBatches)
        .where(eq(kpiContentRegistrationBatches.batchKey, existingBatchIds[0]))
        .get();

      if (existingBatch) {
        return NextResponse.json({
          success: true,
          queued: false,
          alreadyCompleted: true,
          batch: {
            ...existingBatch,
            statusLabel: getKpiContentStatusLabel(existingBatch.status),
            articleIds,
          },
        });
      }
    }

    if (existingItems.length > 0) {
      await db
        .delete(kpiContentRegistrations)
        .where(inArray(kpiContentRegistrations.articleId, articleIds))
        .run();
    }

    const batchKey = buildBatchKey();
    const requestedByDisplayName = getContextDisplayName(context);
    const batchSize = articleRows.length;
    const createdAt = new Date().toISOString();

    const insertedBatch = await db
      .insert(kpiContentRegistrationBatches)
      .values({
        teamId: firstTeamId,
        requestedByUserId: context.user.id,
        employeeCode,
        batchKey,
        batchSize,
        taskLabel: firstSelection.taskLabel,
        detailLabel: firstSelection.detailLabel,
        status: "queued",
        attemptCount: 1,
        automationMessage: "Dang xep hang dang ky KPI Content...",
        createdAt,
        updatedAt: createdAt,
      })
      .returning({ id: kpiContentRegistrationBatches.id, batchKey: kpiContentRegistrationBatches.batchKey })
      .get();

    const groupedArticleIds = JSON.stringify(articleIds);
    await db
      .insert(kpiContentRegistrations)
      .values(articleRows.map((article, index) => ({
        articleId: article.id,
        teamId: article.teamId,
        requestedByUserId: context.user.id,
        employeeCode,
        batchId: batchKey,
        batchPosition: index + 1,
        batchSize,
        groupedArticleIds,
        penName: article.penName,
        title: article.title,
        articleLink: normalizeText(article.link),
        articleDate: article.date,
        articleStatus: article.status,
        taskLabel: firstSelection.taskLabel,
        detailLabel: firstSelection.detailLabel,
        status: "queued" as KpiContentInsertStatus,
        attemptCount: 1,
        automationMessage: "Dang xep hang dang ky KPI Content...",
        createdAt,
        updatedAt: createdAt,
      })))
      .run();

    await writeAuditLog({
      userId: context.user.id,
      action: "kpi_content_registration_created",
      entity: "kpi_content_registration",
      entityId: String(insertedBatch?.id || batchKey),
      payload: {
        batchKey,
        batchSize,
        employeeCode,
        articleIds,
        taskLabel: firstSelection.taskLabel,
        detailLabel: firstSelection.detailLabel,
      },
    });

    after(async () => {
      try {
        await processKpiContentRegistrationJob({
          batchId: Number(insertedBatch?.id || 0),
          requestedByUserId: context.user.id,
          requestedByDisplayName,
        });
      } catch (error) {
        console.error("[kpi-content.background]", error);
      }
    });

    return NextResponse.json({
      success: true,
      queued: true,
      batch: {
        id: insertedBatch?.id ?? null,
        batchKey,
        batchSize,
        taskLabel: firstSelection.taskLabel,
        detailLabel: firstSelection.detailLabel,
        status: "queued",
        statusLabel: getKpiContentStatusLabel("queued"),
        articleIds,
      },
    });
  } catch (error) {
    return handleServerError("kpi-content.post", error);
  }
}
