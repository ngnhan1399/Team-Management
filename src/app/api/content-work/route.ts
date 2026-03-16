import { db, ensureDatabaseInitialized } from "@/db";
import { articles, contentWorkRegistrations } from "@/db/schema";
import { getContextDisplayName, getContextIdentityCandidates, getCurrentUserContext, matchesIdentityCandidate } from "@/lib/auth";
import { processContentWorkRegistrationJob } from "@/lib/content-work-automation";
import {
  CONTENT_WORK_FORM_URL,
  CONTENT_WORK_SHEET_URL,
  getContentWorkStatusLabel,
  resolveContentWorkCategoryLabel,
  type ContentWorkStatus,
} from "@/lib/content-work-registration";
import { enforceTrustedOrigin } from "@/lib/request-security";
import { handleServerError } from "@/lib/server-error";
import { canAccessTeam } from "@/lib/teams";
import { desc, eq } from "drizzle-orm";
import { after, NextRequest, NextResponse } from "next/server";

type ContentWorkListRow = {
  id: number;
  articleId: number;
  requestedByUserId: number;
  penName: string;
  title: string;
  articleLink: string | null;
  contentWorkCategory: string | null;
  status: ContentWorkStatus;
  attemptCount: number;
  externalSheetName: string | null;
  externalRowNumber: number | null;
  automationMessage: string | null;
  lastError: string | null;
  formSubmittedAt: string | null;
  linkWrittenAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  articleDate: string;
  articleStatus: string;
};

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

async function loadRegistrationRow(registrationId: number) {
  return db
    .select({
      id: contentWorkRegistrations.id,
      articleId: contentWorkRegistrations.articleId,
      requestedByUserId: contentWorkRegistrations.requestedByUserId,
      penName: contentWorkRegistrations.penName,
      title: contentWorkRegistrations.title,
      articleLink: contentWorkRegistrations.articleLink,
      contentWorkCategory: contentWorkRegistrations.contentWorkCategory,
      status: contentWorkRegistrations.status,
      attemptCount: contentWorkRegistrations.attemptCount,
      externalSheetName: contentWorkRegistrations.externalSheetName,
      externalRowNumber: contentWorkRegistrations.externalRowNumber,
      automationMessage: contentWorkRegistrations.automationMessage,
      lastError: contentWorkRegistrations.lastError,
      formSubmittedAt: contentWorkRegistrations.formSubmittedAt,
      linkWrittenAt: contentWorkRegistrations.linkWrittenAt,
      completedAt: contentWorkRegistrations.completedAt,
      createdAt: contentWorkRegistrations.createdAt,
      updatedAt: contentWorkRegistrations.updatedAt,
      articleDate: articles.date,
      articleStatus: articles.status,
    })
    .from(contentWorkRegistrations)
    .innerJoin(articles, eq(contentWorkRegistrations.articleId, articles.id))
    .where(eq(contentWorkRegistrations.id, registrationId))
    .get() as Promise<ContentWorkListRow | undefined>;
}

function mapRegistrationRow(row: ContentWorkListRow) {
  return {
    ...row,
    statusLabel: getContentWorkStatusLabel(row.status),
    formUrl: CONTENT_WORK_FORM_URL,
    sheetUrl: CONTENT_WORK_SHEET_URL,
  };
}

export async function GET() {
  try {
    await ensureDatabaseInitialized();
    const context = await getCurrentUserContext();
    if (!context) {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    }
    if (context.user.role !== "ctv") {
      return NextResponse.json({ success: false, error: "CTV access required" }, { status: 403 });
    }

    const rows = await db
      .select({
        id: contentWorkRegistrations.id,
        articleId: contentWorkRegistrations.articleId,
        requestedByUserId: contentWorkRegistrations.requestedByUserId,
        penName: contentWorkRegistrations.penName,
        title: contentWorkRegistrations.title,
        articleLink: contentWorkRegistrations.articleLink,
        contentWorkCategory: contentWorkRegistrations.contentWorkCategory,
        status: contentWorkRegistrations.status,
        attemptCount: contentWorkRegistrations.attemptCount,
        externalSheetName: contentWorkRegistrations.externalSheetName,
        externalRowNumber: contentWorkRegistrations.externalRowNumber,
        automationMessage: contentWorkRegistrations.automationMessage,
        lastError: contentWorkRegistrations.lastError,
        formSubmittedAt: contentWorkRegistrations.formSubmittedAt,
        linkWrittenAt: contentWorkRegistrations.linkWrittenAt,
        completedAt: contentWorkRegistrations.completedAt,
        createdAt: contentWorkRegistrations.createdAt,
        updatedAt: contentWorkRegistrations.updatedAt,
        articleDate: articles.date,
        articleStatus: articles.status,
      })
      .from(contentWorkRegistrations)
      .innerJoin(articles, eq(contentWorkRegistrations.articleId, articles.id))
      .where(eq(contentWorkRegistrations.requestedByUserId, context.user.id))
      .orderBy(desc(contentWorkRegistrations.updatedAt), desc(contentWorkRegistrations.id))
      .all() as ContentWorkListRow[];

    return NextResponse.json({
      success: true,
      data: rows.map(mapRegistrationRow),
    });
  } catch (error) {
    return handleServerError("content-work.get", error);
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
    if (context.user.role !== "ctv") {
      return NextResponse.json({ success: false, error: "CTV access required" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const articleId = Number(body?.articleId);
    const force = body?.force === true;
    if (!Number.isInteger(articleId) || articleId <= 0) {
      return NextResponse.json({ success: false, error: "ID bài viết không hợp lệ" }, { status: 400 });
    }

    const article = await db
      .select({
        id: articles.id,
        teamId: articles.teamId,
        title: articles.title,
        penName: articles.penName,
        articleType: articles.articleType,
        contentType: articles.contentType,
        category: articles.category,
        link: articles.link,
        date: articles.date,
      })
      .from(articles)
      .where(eq(articles.id, articleId))
      .get();

    if (!article) {
      return NextResponse.json({ success: false, error: "Không tìm thấy bài viết" }, { status: 404 });
    }
    if (!canAccessTeam(context, article.teamId)) {
      return NextResponse.json({ success: false, error: "Bài viết nằm ngoài phạm vi team của bạn" }, { status: 403 });
    }

    const identityCandidates = getContextIdentityCandidates(context);
    if (!matchesIdentityCandidate(identityCandidates, article.penName)) {
      return NextResponse.json({ success: false, error: "Bạn chỉ có thể đăng ký Content Work cho bài của chính mình" }, { status: 403 });
    }

    const contentWorkCategory = resolveContentWorkCategoryLabel({
      articleType: article.articleType,
      contentType: article.contentType,
      category: article.category,
    });
    if (!normalizeText(article.link)) {
      return NextResponse.json({ success: false, error: "Bài viết chưa có link nên chưa thể đăng ký Content Work" }, { status: 400 });
    }
    if (!contentWorkCategory) {
      return NextResponse.json({ success: false, error: "Loại bài này chưa được ánh xạ sang danh mục Content Work" }, { status: 400 });
    }

    const existing = await db
      .select({ id: contentWorkRegistrations.id, status: contentWorkRegistrations.status, attemptCount: contentWorkRegistrations.attemptCount })
      .from(contentWorkRegistrations)
      .where(eq(contentWorkRegistrations.articleId, articleId))
      .get();

    if (existing && !force && (existing.status === "queued" || existing.status === "submitting_form")) {
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
        .update(contentWorkRegistrations)
        .set({
          teamId: article.teamId,
          requestedByUserId: context.user.id,
          penName: article.penName,
          title: article.title,
          articleLink: article.link,
          contentWorkCategory,
          status: "queued",
          attemptCount: Number(existing.attemptCount || 0) + 1,
          automationMessage: "Đang xếp hàng đăng ký Content Work...",
          lastError: null,
          externalSheetName: null,
          externalRowNumber: null,
          formSubmittedAt: null,
          linkWrittenAt: null,
          completedAt: null,
          updatedAt,
        })
        .where(eq(contentWorkRegistrations.id, existing.id))
        .run();
      registrationId = existing.id;
    } else {
      const inserted = await db
        .insert(contentWorkRegistrations)
        .values({
          articleId: article.id,
          teamId: article.teamId,
          requestedByUserId: context.user.id,
          penName: article.penName,
          title: article.title,
          articleLink: article.link,
          contentWorkCategory,
          status: "queued",
          attemptCount: 1,
          automationMessage: "Đang xếp hàng đăng ký Content Work...",
          updatedAt,
        })
        .returning({ id: contentWorkRegistrations.id })
        .get();
      registrationId = Number(inserted?.id || 0);
    }

    const articleSnapshot = {
      id: article.id,
      teamId: article.teamId,
      title: article.title,
      penName: article.penName,
      articleType: article.articleType,
      contentType: article.contentType,
      category: article.category,
      link: article.link,
      date: article.date,
    };

    after(async () => {
      await processContentWorkRegistrationJob({
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
    return handleServerError("content-work.post", error);
  }
}
