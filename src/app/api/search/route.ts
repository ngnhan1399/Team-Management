import { db, ensureDatabaseInitialized } from "@/db";
import { articles } from "@/db/schema";
import { getContextIdentityCandidates, getCurrentUserContext, matchesIdentityCandidate } from "@/lib/auth";
import { handleServerError } from "@/lib/server-error";
import { like, or, desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

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
        const identityCandidates = getContextIdentityCandidates(context);

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

        const dbLimit = context.user.role === "admin" ? limit : Math.max(limit * 5, 100);

        let results = await db
            .select()
            .from(articles)
            .where(searchCondition)
            .orderBy(desc(articles.id))
            .limit(dbLimit)
            .all();

        if (context.user.role !== "admin") {
            results = results.filter((article) => matchesIdentityCandidate(identityCandidates, article.penName)).slice(0, limit);
        }

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
