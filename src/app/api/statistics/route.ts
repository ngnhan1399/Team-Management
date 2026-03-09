import { db, ensureDatabaseInitialized } from "@/db";
import { articles, collaborators } from "@/db/schema";
import { getContextIdentityCandidates, getCurrentUserContext, matchesIdentityCandidate } from "@/lib/auth";
import { handleServerError } from "@/lib/server-error";
import { desc, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

type CollaboratorDirectoryItem = {
    id: number;
    name: string;
    penName: string;
    email: string | null;
};

function resolveCollaborator(articlePenName: string, directory: CollaboratorDirectoryItem[]) {
    const exact = directory.find((item) => item.penName === articlePenName);
    if (exact) return exact;

    return directory.find((item) =>
        matchesIdentityCandidate(
            [item.penName, item.name, item.email || ""],
            articlePenName
        )
    ) || null;
}

function getActivityTimestamp(article: { id: number; date: string; createdAt?: string | null; updatedAt?: string | null }) {
    const value = article.updatedAt || article.createdAt || article.date;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
}

export async function GET() {
    try {
        await ensureDatabaseInitialized();
        const context = await getCurrentUserContext();
        if (!context) {
            return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
        }

        const identityCandidates = getContextIdentityCandidates(context);
        const allCollaborators = await db
            .select({
                id: collaborators.id,
                name: collaborators.name,
                penName: collaborators.penName,
                email: collaborators.email,
            })
            .from(collaborators)
            .all();
        const allArticles = await db.select().from(articles).orderBy(desc(articles.id)).all();
        const scopedArticles = context.user.role === "admin"
            ? allArticles
            : allArticles.filter((article) => matchesIdentityCandidate(identityCandidates, article.penName));

        const totalArticles = scopedArticles.length;
        const totalCTVCount = context.user.role === "admin"
            ? (await db.select({ count: sql<number>`count(*)` }).from(collaborators).get())?.count || 0
            : identityCandidates.length > 0 ? 1 : 0;

        const groupCount = <T extends string>(values: T[]) =>
            Object.entries(values.reduce<Record<string, number>>((acc, value) => {
                acc[value] = (acc[value] || 0) + 1;
                return acc;
            }, {})).map(([key, count]) => ({ key, count }));

        const articlesByStatus = groupCount(scopedArticles.map((article) => article.status))
            .map(({ key, count }) => ({ status: key, count }));

        const articlesByCategory = groupCount(scopedArticles.map((article) => article.category))
            .map(({ key, count }) => ({ category: key, count }));

        const writerBuckets = scopedArticles.reduce<Record<string, { penName: string; displayName: string; count: number }>>((acc, article) => {
            const resolvedCollaborator = resolveCollaborator(article.penName, allCollaborators);
            const key = resolvedCollaborator ? `collab:${resolvedCollaborator.id}` : `pen:${article.penName}`;
            const displayName = resolvedCollaborator?.name || resolvedCollaborator?.penName || article.penName;
            const penName = resolvedCollaborator?.penName || article.penName;

            if (!acc[key]) {
                acc[key] = { penName, displayName, count: 0 };
            }

            acc[key].count += 1;
            return acc;
        }, {});

        const articlesByWriter = Object.values(writerBuckets)
            .sort((left, right) => right.count - left.count || left.displayName.localeCompare(right.displayName, "vi"));

        const articlesByType = groupCount(scopedArticles.map((article) => `${article.articleType}|||${article.contentType}`))
            .map(({ key, count }) => {
                const [articleType, contentType] = key.split("|||");
                return { articleType, contentType, count };
            });

        const articlesByMonth = groupCount(scopedArticles.map((article) => article.date))
            .map(({ key, count }) => ({ date: key, count }));

        const latestArticles = [...scopedArticles]
            .sort((left, right) => getActivityTimestamp(right) - getActivityTimestamp(left) || right.id - left.id)
            .slice(0, 8)
            .map((article) => ({
                id: article.id,
                articleId: article.articleId,
                title: article.title,
                penName: resolveCollaborator(article.penName, allCollaborators)?.penName || article.penName,
                writerDisplayName: resolveCollaborator(article.penName, allCollaborators)?.name || article.penName,
                articleType: article.articleType,
                status: article.status,
                date: article.date,
                updatedAt: article.updatedAt || article.createdAt || article.date,
            }));

        return NextResponse.json({
            success: true,
            data: {
                totalArticles,
                totalCTVs: totalCTVCount,
                articlesByStatus,
                articlesByCategory,
                articlesByWriter,
                articlesByType,
                articlesByMonth,
                latestArticles,
            },
        });
    } catch (error) {
        return handleServerError("statistics.get", error);
    }
}
