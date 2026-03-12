import { ensureDatabaseInitialized } from "@/db";
import { articles, collaborators } from "@/db/schema";
import { db } from "@/db";
import { getCurrentUserContext, getContextIdentityCandidates, hasArticleManagerAccess, matchesIdentityCandidate } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { executeGoogleSheetSync, executeGoogleSheetWorkbookSync, refreshScopedArticlesFromGoogleSheet } from "@/lib/google-sheet-sync";
import { publishRealtimeEvent } from "@/lib/realtime";
import { enforceTrustedOrigin } from "@/lib/request-security";
import { handleServerError } from "@/lib/server-error";
import { getContextTeamId, isLeader } from "@/lib/teams";
import { eq, inArray } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function parseOptionalNumber(value: unknown, label: string) {
  const raw = normalizeText(value);
  if (!raw) return null;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${label} không hợp lệ.`);
  }

  return parsed;
}

function parseArticleIds(value: unknown) {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0)
    )
  );
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

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const month = parseOptionalNumber(body.month, "Tháng");
    const year = parseOptionalNumber(body.year, "Năm");
    const sourceUrl = normalizeText(body.sourceUrl);
    const articleIds = parseArticleIds(body.articleIds);
    const reconcileAllSheets = body.reconcileAllSheets === true || normalizeText(body.reconcileAllSheets) === "true";

    if ((month === null) !== (year === null)) {
      return NextResponse.json(
        { success: false, error: "Hãy nhập đủ cả tháng và năm, hoặc để trống để dùng tab mới nhất." },
        { status: 400 }
      );
    }

    if (month !== null && (month < 1 || month > 12)) {
      return NextResponse.json({ success: false, error: "Tháng phải nằm trong khoảng 1-12." }, { status: 400 });
    }

    if (year !== null && (year < 2000 || year > 2100)) {
      return NextResponse.json({ success: false, error: "Năm không hợp lệ." }, { status: 400 });
    }

    const canManageArticles = hasArticleManagerAccess(context);
    const contextTeamId = getContextTeamId(context);
    const scopedSyncTeamId = canManageArticles
      ? (isLeader(context) ? undefined : contextTeamId)
      : contextTeamId;
    const scopedTeamPenNames = canManageArticles && scopedSyncTeamId
      ? (await db
          .select({ penName: collaborators.penName })
          .from(collaborators)
          .where(eq(collaborators.teamId, scopedSyncTeamId))
          .all()).map((item) => item.penName)
      : [];
    const identityCandidates = canManageArticles ? [] : getContextIdentityCandidates(context);

    let authorizedArticleIds = articleIds;
    if (!canManageArticles && articleIds.length > 0) {
      const targetArticles = await db
        .select({
          id: articles.id,
          penName: articles.penName,
        })
        .from(articles)
        .where(inArray(articles.id, articleIds))
        .all();

      if (targetArticles.length !== articleIds.length) {
        return NextResponse.json(
          { success: false, error: "Có bài viết trong danh sách đồng bộ không tồn tại hoặc không còn khả dụng." },
          { status: 404 }
        );
      }

      const unauthorizedArticle = targetArticles.find(
        (article) => !matchesIdentityCandidate(identityCandidates, article.penName)
      );
      if (unauthorizedArticle) {
        return NextResponse.json(
          { success: false, error: "Bạn chỉ có thể đồng bộ các bài viết thuộc về tài khoản của mình." },
          { status: 403 }
        );
      }

      authorizedArticleIds = targetArticles.map((article) => article.id);
    }

    const result = authorizedArticleIds.length > 0
      ? await refreshScopedArticlesFromGoogleSheet({
        sourceUrl: sourceUrl || undefined,
        month,
        year,
        teamId: scopedSyncTeamId,
        allowedPenNames: scopedTeamPenNames,
        createdByUserId: context.user.id,
        articleIds: authorizedArticleIds,
      })
      : reconcileAllSheets && month === null && year === null
        ? await executeGoogleSheetWorkbookSync({
          sourceUrl: sourceUrl || undefined,
          teamId: scopedSyncTeamId,
          allowedPenNames: scopedTeamPenNames,
          createdByUserId: context.user.id,
          identityCandidates: canManageArticles ? undefined : identityCandidates,
        })
        : await executeGoogleSheetSync({
          sourceUrl: sourceUrl || undefined,
          month,
          year,
          teamId: scopedSyncTeamId,
          allowedPenNames: scopedTeamPenNames,
          createdByUserId: context.user.id,
          identityCandidates: canManageArticles ? undefined : identityCandidates,
        });

    await writeAuditLog({
      userId: context.user.id,
      action: "articles_google_sheet_synced",
      entity: "article",
      payload: {
        ...result,
        scope: authorizedArticleIds.length > 0 ? "filtered" : (result.scope === "workbook" ? "workbook" : "full"),
        articleIds: authorizedArticleIds,
        triggeredBy: "manual",
        actorRole: context.user.role,
        actorCollaboratorRole: context.collaborator?.role ?? null,
      },
    });

    await publishRealtimeEvent({
      channels: ["articles", "dashboard", "royalty"],
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    return handleServerError("articles.google-sync.post", error);
  }
}

