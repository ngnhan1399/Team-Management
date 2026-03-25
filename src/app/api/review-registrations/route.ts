import { after, NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, ensureDatabaseInitialized, ensureReviewRegistrationSchemaInitialized } from "@/db";
import { articles, reviewRegistrations } from "@/db/schema";
import {
  getContextDisplayName,
  getContextIdentityCandidates,
  getCurrentUserContext,
  hasArticleManagerAccess,
  hasArticleReviewAccess,
  matchesIdentityCandidate,
} from "@/lib/auth";
import { isApprovedArticleStatus } from "@/lib/article-status";
import {
  hasReviewRegistrationAutomationConfig,
  processReviewRegistrationJob,
} from "@/lib/review-registration-automation";
import {
  getReviewRegistrationStatusLabel,
  resolveReviewRegistrationSheetProfile,
  type ReviewRegistrationStatus,
} from "@/lib/review-registration";
import { enforceTrustedOrigin } from "@/lib/request-security";
import { handleServerError } from "@/lib/server-error";
import { canAccessTeam } from "@/lib/teams";

type ReviewRegistrationListRow = {
  id: number;
  articleId: number;
  teamId: number | null;
  requestedByUserId: number;
  writerPenName: string;
  reviewerPenName: string;
  title: string;
  articleLink: string | null;
  articleDate: string;
  sheetName: string;
  sheetMonth: number | null;
  sheetYear: number | null;
  status: ReviewRegistrationStatus;
  attemptCount: number;
  externalSheetName: string | null;
  externalRowNumber: number | null;
  automationMessage: string | null;
  lastError: string | null;
  sheetWrittenAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  articleStatus: string;
};

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

async function loadRegistrationRow(registrationId: number) {
  return db
    .select({
      id: reviewRegistrations.id,
      articleId: reviewRegistrations.articleId,
      teamId: articles.teamId,
      requestedByUserId: reviewRegistrations.requestedByUserId,
      writerPenName: reviewRegistrations.writerPenName,
      reviewerPenName: reviewRegistrations.reviewerPenName,
      title: reviewRegistrations.title,
      articleLink: reviewRegistrations.articleLink,
      articleDate: reviewRegistrations.articleDate,
      sheetName: reviewRegistrations.sheetName,
      sheetMonth: reviewRegistrations.sheetMonth,
      sheetYear: reviewRegistrations.sheetYear,
      status: reviewRegistrations.status,
      attemptCount: reviewRegistrations.attemptCount,
      externalSheetName: reviewRegistrations.externalSheetName,
      externalRowNumber: reviewRegistrations.externalRowNumber,
      automationMessage: reviewRegistrations.automationMessage,
      lastError: reviewRegistrations.lastError,
      sheetWrittenAt: reviewRegistrations.sheetWrittenAt,
      completedAt: reviewRegistrations.completedAt,
      createdAt: reviewRegistrations.createdAt,
      updatedAt: reviewRegistrations.updatedAt,
      articleStatus: articles.status,
    })
    .from(reviewRegistrations)
    .innerJoin(articles, eq(reviewRegistrations.articleId, articles.id))
    .where(eq(reviewRegistrations.id, registrationId))
    .get() as Promise<ReviewRegistrationListRow | undefined>;
}

function mapRegistrationRow(row: ReviewRegistrationListRow) {
  const profile = resolveReviewRegistrationSheetProfile([row.reviewerPenName]);
  return {
    ...row,
    statusLabel: getReviewRegistrationStatusLabel(row.status),
    sheetUrl: profile?.spreadsheetUrl || null,
  };
}

export async function GET() {
  try {
    await ensureDatabaseInitialized();
    await ensureReviewRegistrationSchemaInitialized();

    const context = await getCurrentUserContext();
    if (!context) {
      return NextResponse.json({ success: false, error: "Bạn cần đăng nhập để tiếp tục." }, { status: 401 });
    }
    if (!hasArticleReviewAccess(context)) {
      return NextResponse.json({ success: false, error: "Quyền truy cập không hợp lệ." }, { status: 403 });
    }

    const identityCandidates = getContextIdentityCandidates(context);
    const canManageArticles = hasArticleManagerAccess(context);

    const rows = await db
      .select({
        id: reviewRegistrations.id,
        articleId: reviewRegistrations.articleId,
        teamId: articles.teamId,
        requestedByUserId: reviewRegistrations.requestedByUserId,
        writerPenName: reviewRegistrations.writerPenName,
        reviewerPenName: reviewRegistrations.reviewerPenName,
        title: reviewRegistrations.title,
        articleLink: reviewRegistrations.articleLink,
        articleDate: reviewRegistrations.articleDate,
        sheetName: reviewRegistrations.sheetName,
        sheetMonth: reviewRegistrations.sheetMonth,
        sheetYear: reviewRegistrations.sheetYear,
        status: reviewRegistrations.status,
        attemptCount: reviewRegistrations.attemptCount,
        externalSheetName: reviewRegistrations.externalSheetName,
        externalRowNumber: reviewRegistrations.externalRowNumber,
        automationMessage: reviewRegistrations.automationMessage,
        lastError: reviewRegistrations.lastError,
        sheetWrittenAt: reviewRegistrations.sheetWrittenAt,
        completedAt: reviewRegistrations.completedAt,
        createdAt: reviewRegistrations.createdAt,
        updatedAt: reviewRegistrations.updatedAt,
        articleStatus: articles.status,
      })
      .from(reviewRegistrations)
      .innerJoin(articles, eq(reviewRegistrations.articleId, articles.id))
      .orderBy(desc(reviewRegistrations.updatedAt), desc(reviewRegistrations.id))
      .all() as ReviewRegistrationListRow[];

    const visibleRows = rows.filter((row) => {
      if (!canAccessTeam(context, row.teamId)) {
        return false;
      }
      if (canManageArticles) {
        return true;
      }
      return matchesIdentityCandidate(identityCandidates, row.reviewerPenName);
    });

    return NextResponse.json({
      success: true,
      data: visibleRows.map(mapRegistrationRow),
    });
  } catch (error) {
    return handleServerError("review-registrations.get", error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureDatabaseInitialized();
    await ensureReviewRegistrationSchemaInitialized();
    const originError = enforceTrustedOrigin(request);
    if (originError) return originError;

    const context = await getCurrentUserContext();
    if (!context) {
      return NextResponse.json({ success: false, error: "Bạn cần đăng nhập để tiếp tục." }, { status: 401 });
    }
    if (!hasArticleReviewAccess(context)) {
      return NextResponse.json({ success: false, error: "Chỉ reviewer hoặc admin mới được đăng ký bài duyệt." }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const articleId = Number(body?.articleId);
    const force = body?.force === true;
    if (!Number.isInteger(articleId) || articleId <= 0) {
      return NextResponse.json({ success: false, error: "ID bài viết không hợp lệ." }, { status: 400 });
    }

    if (!hasReviewRegistrationAutomationConfig()) {
      return NextResponse.json(
        {
          success: false,
          error: "Hệ thống chưa cấu hình kênh tự động cho đăng ký bài duyệt. Hãy cấu hình Apps Script hoặc phiên đăng nhập Google đã lưu trước khi sử dụng.",
        },
        { status: 400 }
      );
    }

    const article = await db
      .select({
        id: articles.id,
        teamId: articles.teamId,
        title: articles.title,
        penName: articles.penName,
        link: articles.link,
        date: articles.date,
        status: articles.status,
        reviewerName: articles.reviewerName,
      })
      .from(articles)
      .where(eq(articles.id, articleId))
      .get();

    if (!article) {
      return NextResponse.json({ success: false, error: "Không tìm thấy bài viết." }, { status: 404 });
    }
    if (!canAccessTeam(context, article.teamId)) {
      return NextResponse.json({ success: false, error: "Bài viết nằm ngoài phạm vi team của bạn." }, { status: 403 });
    }

    const reviewerLabel = normalizeText(article.reviewerName) || getContextDisplayName(context);
    if (!normalizeText(article.link)) {
      return NextResponse.json({ success: false, error: "Bài viết chưa có link nên chưa thể đăng ký bài duyệt." }, { status: 400 });
    }
    if (!isApprovedArticleStatus(article.status)) {
      return NextResponse.json({ success: false, error: "Hãy đánh dấu “Đã duyệt” cho bài viết trước khi đăng ký bài duyệt." }, { status: 400 });
    }

    const canManageArticles = hasArticleManagerAccess(context);
    const identityCandidates = getContextIdentityCandidates(context);
    if (!canManageArticles && !matchesIdentityCandidate(identityCandidates, reviewerLabel)) {
      return NextResponse.json({ success: false, error: "Bạn chỉ có thể đăng ký bài duyệt cho bài đang giao cho mình." }, { status: 403 });
    }

    const profile = resolveReviewRegistrationSheetProfile([reviewerLabel]);
    if (!profile) {
      return NextResponse.json({ success: false, error: `Chưa có cấu hình sheet bài duyệt cho reviewer “${reviewerLabel}”.` }, { status: 400 });
    }

    const existing = await db
      .select({
        id: reviewRegistrations.id,
        status: reviewRegistrations.status,
        attemptCount: reviewRegistrations.attemptCount,
      })
      .from(reviewRegistrations)
      .where(eq(reviewRegistrations.articleId, articleId))
      .get();

    if (existing && !force && (existing.status === "queued" || existing.status === "writing_sheet")) {
      const queuedRegistration = await loadRegistrationRow(existing.id);
      return NextResponse.json({
        success: true,
        queued: true,
        alreadyRunning: true,
        registration: queuedRegistration ? mapRegistrationRow(queuedRegistration) : null,
      });
    }

    if (existing && !force && existing.status === "completed") {
      const completedRegistration = await loadRegistrationRow(existing.id);
      return NextResponse.json({
        success: true,
        queued: false,
        alreadyCompleted: true,
        registration: completedRegistration ? mapRegistrationRow(completedRegistration) : null,
      });
    }

    const updatedAt = new Date().toISOString();
    let registrationId = existing?.id ?? 0;
    if (existing?.id) {
      await db
        .update(reviewRegistrations)
        .set({
          teamId: article.teamId,
          requestedByUserId: context.user.id,
          writerPenName: article.penName,
          reviewerPenName: reviewerLabel,
          title: article.title,
          articleLink: article.link,
          articleDate: article.date,
          sheetName: profile.sheetName,
          sheetMonth: null,
          sheetYear: null,
          status: "queued",
          attemptCount: Number(existing.attemptCount || 0) + 1,
          automationMessage: "Đang xếp hàng đăng ký bài duyệt...",
          lastError: null,
          externalSheetName: null,
          externalRowNumber: null,
          sheetWrittenAt: null,
          completedAt: null,
          updatedAt,
        })
        .where(eq(reviewRegistrations.id, existing.id))
        .run();
      registrationId = existing.id;
    } else {
      const inserted = await db
        .insert(reviewRegistrations)
        .values({
          articleId: article.id,
          teamId: article.teamId,
          requestedByUserId: context.user.id,
          writerPenName: article.penName,
          reviewerPenName: reviewerLabel,
          title: article.title,
          articleLink: article.link,
          articleDate: article.date,
          sheetName: profile.sheetName,
          status: "queued",
          attemptCount: 1,
          automationMessage: "Đang xếp hàng đăng ký bài duyệt...",
          updatedAt,
        })
        .returning({ id: reviewRegistrations.id })
        .get();
      registrationId = Number(inserted?.id || 0);
    }

    const articleSnapshot = {
      id: article.id,
      teamId: article.teamId,
      title: article.title,
      penName: article.penName,
      link: article.link,
      date: article.date,
      status: article.status,
      reviewerName: reviewerLabel,
    };

    after(async () => {
      await processReviewRegistrationJob({
        registrationId,
        article: articleSnapshot,
        requestedByUserId: context.user.id,
        requestedByDisplayName: getContextDisplayName(context),
      });
    });

    const registration = registrationId > 0 ? await loadRegistrationRow(registrationId) : null;
    return NextResponse.json({
      success: true,
      queued: true,
      registration: registration ? mapRegistrationRow(registration) : null,
    });
  } catch (error) {
    return handleServerError("review-registrations.post", error);
  }
}
