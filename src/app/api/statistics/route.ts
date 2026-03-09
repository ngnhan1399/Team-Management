import { db, ensureDatabaseInitialized } from "@/db";
import { articles, collaborators } from "@/db/schema";
import { getContextIdentityCandidates, getCurrentUserContext, matchesIdentityCandidate } from "@/lib/auth";
import { handleServerError } from "@/lib/server-error";
import { desc, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET() {
    try {
        await ensureDatabaseInitialized();
        const context = await getCurrentUserContext();
        if (!context) {
            return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
        }

        const identityCandidates = getContextIdentityCandidates(context);
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

        const articlesByWriter = groupCount(scopedArticles.map((article) => article.penName))
            .map(({ key, count }) => ({ penName: key, count }))
            .sort((left, right) => right.count - left.count);

        const articlesByType = groupCount(scopedArticles.map((article) => `${article.articleType}|||${article.contentType}`))
            .map(({ key, count }) => {
                const [articleType, contentType] = key.split("|||");
                return { articleType, contentType, count };
            });

        const articlesByMonth = groupCount(scopedArticles.map((article) => article.date))
            .map(({ key, count }) => ({ date: key, count }));

        const latestArticles = scopedArticles
            .slice(0, 8)
            .map((article) => ({
                articleId: article.articleId,
                title: article.title,
                penName: article.penName,
                articleType: article.articleType,
                status: article.status,
                date: article.date,
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
