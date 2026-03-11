import { db, ensureDatabaseInitialized } from "@/db";
import { articleComments, articles, collaborators, notifications, users } from "@/db/schema";
import { getContextIdentityCandidates, getContextPenName, getCurrentUserContext, hasArticleManagerAccess, hasArticleReviewAccess, matchesIdentityCandidate, type CurrentUserContext } from "@/lib/auth";
import { createNotifications } from "@/lib/notifications";
import { publishRealtimeEvent } from "@/lib/realtime";
import { writeAuditLog } from "@/lib/audit";
import { enforceTrustedOrigin } from "@/lib/request-security";
import { handleServerError } from "@/lib/server-error";
import { canAccessTeam } from "@/lib/teams";
import { requiredInt, requiredString, optionalString, ValidationError } from "@/lib/validation";
import { and, desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

type UserDirectoryEntry = {
  id: number;
  email: string;
  userRole: "admin" | "ctv";
  teamId: number | null;
  collaboratorRole: "writer" | "reviewer" | null;
  penName: string | null;
  name: string | null;
  collaboratorEmail: string | null;
};

type NotificationRecipient = {
  toUserId: number;
  toPenName: string | null;
};

function extractMentions(content: string): string[] {
  const matches = content.match(/@([^\s@]+)/g) || [];
  return Array.from(new Set(matches.map((m) => m.slice(1).trim()).filter(Boolean)));
}

function parseMentions(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function loadUserDirectory(teamId?: number | null): Promise<UserDirectoryEntry[]> {
  return db
    .select({
      id: users.id,
      email: users.email,
      userRole: users.role,
      teamId: users.teamId,
      collaboratorRole: collaborators.role,
      penName: collaborators.penName,
      name: collaborators.name,
      collaboratorEmail: collaborators.email,
    })
    .from(users)
    .leftJoin(collaborators, eq(users.collaboratorId, collaborators.id))
    .where(teamId ? eq(users.teamId, teamId) : undefined)
    .all();
}

function getIdentityCandidates(entry: UserDirectoryEntry): string[] {
  const emailLocalPart = entry.email.split("@")[0] || "";
  return [
    entry.penName,
    entry.name,
    entry.collaboratorEmail,
    entry.email,
    emailLocalPart,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function dedupeRecipients(items: NotificationRecipient[]): NotificationRecipient[] {
  const seen = new Map<number, NotificationRecipient>();
  for (const item of items) {
    if (!item.toUserId) continue;
    if (!seen.has(item.toUserId)) {
      seen.set(item.toUserId, item);
    }
  }
  return Array.from(seen.values());
}

function resolveRecipientsByIdentity(directory: UserDirectoryEntry[], identity: string): NotificationRecipient[] {
  const normalizedIdentity = String(identity || "").trim();
  if (!normalizedIdentity) return [];

  return dedupeRecipients(
    directory
      .filter((entry) => matchesIdentityCandidate(getIdentityCandidates(entry), normalizedIdentity))
      .map((entry) => ({
        toUserId: entry.id,
        toPenName: entry.penName,
      }))
  );
}

function resolveArticleOwnerRecipients(
  article: { penName: string; createdByUserId: number | null },
  directory: UserDirectoryEntry[]
): NotificationRecipient[] {
  const recipients: NotificationRecipient[] = [];

  if (article.createdByUserId) {
    const createdByUser = directory.find((entry) => entry.id === article.createdByUserId);
    if (createdByUser) {
      recipients.push({
        toUserId: createdByUser.id,
        toPenName: createdByUser.penName || article.penName,
      });
    }
  }

  recipients.push(...resolveRecipientsByIdentity(directory, article.penName));
  return dedupeRecipients(recipients);
}

function resolveManagerRecipients(
  article: { reviewerName: string | null },
  directory: UserDirectoryEntry[]
): NotificationRecipient[] {
  const managerDirectory = directory.filter(
    (entry) => entry.userRole === "admin" || entry.collaboratorRole === "reviewer"
  );

  const assignedManagers = article.reviewerName
    ? managerDirectory.filter((entry) => matchesIdentityCandidate(getIdentityCandidates(entry), article.reviewerName))
    : [];

  const targets = assignedManagers.length > 0 ? assignedManagers : managerDirectory;

  return dedupeRecipients(
    targets.map((entry) => ({
      toUserId: entry.id,
      toPenName: entry.penName,
    }))
  );
}

function buildCommentPreview(content: string, maxLength = 120) {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function canAccessArticleComments(
  context: CurrentUserContext,
  article: { penName: string; reviewerName: string | null; status: string }
) {
  if (hasArticleManagerAccess(context)) {
    return true;
  }

  const identityCandidates = getContextIdentityCandidates(context);
  if (matchesIdentityCandidate(identityCandidates, article.penName)) {
    return true;
  }

  if (!hasArticleReviewAccess(context)) {
    return false;
  }

  return article.status === "Submitted" || matchesIdentityCandidate(identityCandidates, article.reviewerName);
}

export async function GET(request: NextRequest) {
  try {
    await ensureDatabaseInitialized();
    const context = await getCurrentUserContext();
    if (!context) {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    }

    const articleId = requiredInt(new URL(request.url).searchParams.get("articleId"), "articleId");
    const article = await db.select().from(articles).where(eq(articles.id, articleId)).get();

    if (!article) {
      return NextResponse.json({ success: false, error: "Article not found" }, { status: 404 });
    }
    if (!canAccessTeam(context, article.teamId)) {
      return NextResponse.json({ success: false, error: "Permission denied" }, { status: 403 });
    }

    if (!canAccessArticleComments(context, article)) {
      return NextResponse.json({ success: false, error: "Permission denied" }, { status: 403 });
    }

    const unreadCommentNotifications = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.toUserId, context.user.id),
          eq(notifications.relatedArticleId, articleId),
          eq(notifications.type, "comment"),
          eq(notifications.isRead, false)
        )
      )
      .all();

    if (unreadCommentNotifications.length > 0) {
      await db
        .update(notifications)
        .set({ isRead: true })
        .where(
          and(
            eq(notifications.toUserId, context.user.id),
            eq(notifications.relatedArticleId, articleId),
            eq(notifications.type, "comment"),
            eq(notifications.isRead, false)
          )
        )
        .run();

      await publishRealtimeEvent({
        channels: ["notifications", "articles"],
        userIds: [context.user.id],
      });
    }

    const rows = await db
      .select()
      .from(articleComments)
      .where(eq(articleComments.articleId, articleId))
      .orderBy(desc(articleComments.id))
      .all();

    const data = rows.map((item) => ({ ...item, mentions: parseMentions(item.mentions) }));

    return NextResponse.json({ success: true, data, markedReadCount: unreadCommentNotifications.length });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    return handleServerError("articles.comments.get", error);
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
    const articleId = requiredInt(body.articleId, "articleId");
    const content = requiredString(body.content, "content", 2);
    const attachmentUrl = optionalString(body.attachmentUrl);

    const article = await db.select().from(articles).where(eq(articles.id, articleId)).get();
    if (!article) {
      return NextResponse.json({ success: false, error: "Article not found" }, { status: 404 });
    }
    if (!canAccessTeam(context, article.teamId)) {
      return NextResponse.json({ success: false, error: "Permission denied" }, { status: 403 });
    }

    const ownPenName = getContextPenName(context);
    if (!canAccessArticleComments(context, article)) {
      return NextResponse.json({ success: false, error: "Permission denied" }, { status: 403 });
    }

    const actorPenName = ownPenName || context.user.email.split("@")[0];
    const mentions = extractMentions(content);
    const activityTimestamp = new Date().toISOString();
    const actorCanReviewArticles = hasArticleReviewAccess(context);
    const actorIsAdmin = hasArticleManagerAccess(context);

    const insertedComment = await db
      .insert(articleComments)
      .values({
        articleId,
        userId: context.user.id,
        penName: actorPenName,
        content,
        mentions: mentions.length > 0 ? JSON.stringify(mentions) : null,
        attachmentUrl,
      })
      .returning({ id: articleComments.id })
      .get();

    await db.update(articles)
      .set({ updatedAt: activityTimestamp })
      .where(eq(articles.id, articleId))
      .run();

    const userDirectory = await loadUserDirectory(article.teamId);
    const defaultRecipients = actorCanReviewArticles
      ? resolveArticleOwnerRecipients(article, userDirectory)
      : resolveManagerRecipients(article, userDirectory);
    const recipients = new Map<number, { toUserId: number; toPenName: string | null; mentioned: boolean }>();

    for (const recipient of defaultRecipients) {
      if (recipient.toUserId === context.user.id) continue;
      recipients.set(recipient.toUserId, { ...recipient, mentioned: false });
    }

    for (const mention of mentions) {
      for (const recipient of resolveRecipientsByIdentity(userDirectory, mention)) {
        if (recipient.toUserId === context.user.id) continue;
        const existingRecipient = recipients.get(recipient.toUserId);
        if (existingRecipient) {
          existingRecipient.mentioned = true;
          if (!existingRecipient.toPenName && recipient.toPenName) {
            existingRecipient.toPenName = recipient.toPenName;
          }
          continue;
        }

        recipients.set(recipient.toUserId, {
          ...recipient,
          mentioned: true,
        });
      }
    }

    const commentPreview = buildCommentPreview(content);
    const notificationItems = Array.from(recipients.values()).map((recipient) => ({
      fromUserId: context.user.id,
      toUserId: recipient.toUserId,
      toPenName: recipient.toPenName,
      type: "comment" as const,
      title: recipient.mentioned
        ? "💬 Bạn được nhắc trong bình luận"
        : actorCanReviewArticles
          ? actorIsAdmin
            ? "💬 BTV vừa gửi bình luận"
            : "💬 Người duyệt vừa gửi bình luận"
          : "💬 CTV vừa phản hồi bình luận",
      message: recipient.mentioned
        ? `${actorPenName} đã nhắc bạn trong bài "${article.title}"${commentPreview ? `: ${commentPreview}` : ""}`
        : `${actorPenName} đã bình luận về bài "${article.title}"${commentPreview ? `: ${commentPreview}` : ""}`,
      relatedArticleId: articleId,
    }));

    if (notificationItems.length > 0) {
      await createNotifications(notificationItems);
    }

    await writeAuditLog({
      userId: context.user.id,
      action: "article_comment_created",
      entity: "article_comment",
      entityId: String(insertedComment?.id),
      payload: { articleId, mentionsCount: mentions.length, notificationCount: notificationItems.length },
    });

    await publishRealtimeEvent(["articles", "dashboard"]);

    return NextResponse.json({ success: true, id: Number(insertedComment?.id) });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    return handleServerError("articles.comments.post", error);
  }
}

