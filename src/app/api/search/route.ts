import { db, ensureDatabaseInitialized } from "@/db";
import { articles } from "@/db/schema";
import { getContextArticleOwnerCandidates, getCurrentUserContext } from "@/lib/auth";
import { handleServerError } from "@/lib/server-error";
import { getContextTeamId, isLeader } from "@/lib/teams";
import { and, desc, eq, inArray, like, or, type SQL } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

function buildArticleOwnershipWhere(ownerCandidates: string[]): SQL | undefined {
    const normalizedCandidates = Array.from(new Set(ownerCandidates.map((value) => String(value || "").trim()).filter(Boolean)));
    if (normalizedCandidates.length === 0) {
        return undefined;
    }

    if (normalizedCandidates.length === 1) {
        return eq(articles.penName, normalizedCandidates[0] as never);
    }

    return inArray(articles.penName, normalizedCandidates as never[]);
}

export async function GET(request: NextRequest) {
    try {
        await ensureDatabaseInitialized();
        const context = await getCurrentUserContext();
        if (!context) {
            return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const query = searchParams.get("q") || "";
        const limit = parseInt(searchParams.get("limit") || "20");
        const ownerCandidates = getContextArticleOwnerCandidates(context);
        const adminTeamId = context.user.role === "admin" && !isLeader(context) ? getContextTeamId(context) : null;

        if (context.user.role !== "admin" && ownerCandidates.length === 0) {
            return NextResponse.json({
                success: true,
                data: [],
                query,
                count: 0,
            });
        }

        if (!query || query.length < 2) {
            return NextResponse.json(
                { success: false, error: "Query must be at least 2 characters" },
                { status: 400 }
            );
        }

        const searchCondition = or(
            like(articles.title, `%${query}%`),
            like(articles.penName, `%${query}%`),
            like(articles.articleId, `%${query}%`),
            like(articles.category, `%${query}%`),
            like(articles.notes, `%${query}%`)
        );

        const scopedWhere = context.user.role === "admin"
            ? adminTeamId
                ? and(searchCondition, eq(articles.teamId, adminTeamId))
                : searchCondition
            : and(searchCondition, buildArticleOwnershipWhere(ownerCandidates));

        const results = await db
            .select({
                id: articles.id,
                articleId: articles.articleId,
                teamId: articles.teamId,
                title: articles.title,
                penName: articles.penName,
                date: articles.date,
                status: articles.status,
                category: articles.category,
                articleType: articles.articleType,
            })
            .from(articles)
            .where(scopedWhere)
            .orderBy(desc(articles.id))
            .limit(limit)
            .all();

        return NextResponse.json({
            success: true,
            data: results,
            query,
            count: results.length,
        });
    } catch (error) {
        return handleServerError("search.get", error);
    }
}
