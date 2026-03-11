import { db, ensureDatabaseInitialized } from "@/db";
import { royaltyRates, articles, monthlyBudgets, collaborators, users } from "@/db/schema";
import { getContextArticleOwnerCandidates, getCurrentUserContext } from "@/lib/auth";
import { publishRealtimeEvent } from "@/lib/realtime";
import {
    filterBudgetEligibleRoyaltyArticles,
    matchesRoyaltyMonthYear,
    parseRoyaltyDateParts,
    summarizeRoyaltyContentBalance,
    type RoyaltyContributorProfile,
} from "@/lib/royalty";
import { requiredInt, optionalString, ValidationError } from "@/lib/validation";
import { enforceTrustedOrigin } from "@/lib/request-security";
import { handleServerError } from "@/lib/server-error";
import { getContextTeamId, isLeader } from "@/lib/teams";
import { and, eq, inArray, type SQL } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

type RoyaltyBreakdown = Record<string, { count: number; unitPrice: number; total: number }>;

type RoyaltySourceArticle = {
    teamId: number | null;
    penName: string;
    articleType: string;
    contentType: string;
    date: string;
};

const ROYALTY_ELIGIBLE_STATUS_VALUES = ["Published", "Approved"] as const;

function buildArticleOwnerWhere(ownerCandidates: string[]): SQL | undefined {
    const normalizedCandidates = Array.from(new Set(ownerCandidates.map((value) => String(value || "").trim()).filter(Boolean)));
    if (normalizedCandidates.length === 0) return undefined;
    if (normalizedCandidates.length === 1) return eq(articles.penName, normalizedCandidates[0] as never);
    return inArray(articles.penName, normalizedCandidates as never[]);
}

async function selectRoyaltyArticles(options?: { ownerCandidates?: string[]; exactPenName?: string; teamId?: number | null }) {
    const conditions: SQL[] = [inArray(articles.status, [...ROYALTY_ELIGIBLE_STATUS_VALUES])];

    if (options?.exactPenName) {
        conditions.push(eq(articles.penName, options.exactPenName));
    } else if (options?.ownerCandidates?.length) {
        const ownerWhere = buildArticleOwnerWhere(options.ownerCandidates);
        if (ownerWhere) conditions.push(ownerWhere);
    }
    if (options?.teamId) {
        conditions.push(eq(articles.teamId, options.teamId));
    }

    return db.select({
        teamId: articles.teamId,
        penName: articles.penName,
        articleType: articles.articleType,
        contentType: articles.contentType,
        date: articles.date,
    })
        .from(articles)
        .where(and(...conditions))
        .all() as Promise<RoyaltySourceArticle[]>;
}

async function loadRoyaltyContributorProfiles(teamId?: number | null) {
    return db
        .select({
            teamId: collaborators.teamId,
            penName: collaborators.penName,
            name: collaborators.name,
            role: collaborators.role,
            linkedUserRole: users.role,
        })
        .from(collaborators)
        .leftJoin(users, eq(users.collaboratorId, collaborators.id))
        .where(teamId ? eq(collaborators.teamId, teamId) : undefined)
        .all() as Promise<RoyaltyContributorProfile[]>;
}

export async function GET(request: NextRequest) {
    try {
        await ensureDatabaseInitialized();
        const context = await getCurrentUserContext();
        if (!context) {
            return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const action = searchParams.get("action");
        const adminTeamId = context.user.role === "admin" && !isLeader(context) ? getContextTeamId(context) : null;

        if (action === "rates") {
            const rates = await db.select().from(royaltyRates).where(eq(royaltyRates.isActive, true)).all();
            return NextResponse.json({ success: true, data: rates });
        }

        if (action === "budget-get") {
            if (!isLeader(context)) {
                return NextResponse.json({ success: true, data: null });
            }
            const month = searchParams.get("month")
                ? requiredInt(searchParams.get("month"), "month")
                : new Date().getMonth() + 1;
            const year = searchParams.get("year")
                ? requiredInt(searchParams.get("year"), "year")
                : new Date().getFullYear();

            const budget = await db
                .select()
                .from(monthlyBudgets)
                .where(and(eq(monthlyBudgets.month, month), eq(monthlyBudgets.year, year)))
                .get();
            return NextResponse.json({ success: true, data: budget || null });
        }

        if (action === "dashboard") {
            if (context.user.role === "admin" && !isLeader(context) && !adminTeamId) {
                return NextResponse.json({
                    success: true,
                    data: {
                        monthlyData: [],
                        currentMonth: { month: new Date().getMonth() + 1, year: new Date().getFullYear(), totalAmount: 0, totalArticles: 0 },
                        budget: { budgetAmount: 0, spent: 0, remaining: 0, percentage: 0, hasBudget: false },
                        topWriters: [],
                        contentBalance: summarizeRoyaltyContentBalance([]),
                    },
                });
            }
            const now = new Date();
            const currentMonth = searchParams.get("month")
                ? requiredInt(searchParams.get("month"), "month")
                : now.getMonth() + 1;
            const currentYear = searchParams.get("year")
                ? requiredInt(searchParams.get("year"), "year")
                : now.getFullYear();

            const rates = await db.select().from(royaltyRates).where(eq(royaltyRates.isActive, true)).all();
            const rateMap = new Map<string, number>();
            for (const rate of rates) {
                rateMap.set(`${rate.articleType}|${rate.contentType}`, rate.price);
            }

            const ownerCandidates = context.user.role === "admin" ? [] : getContextArticleOwnerCandidates(context);
            const profileScopeTeamId = context.user.role === "admin"
                ? adminTeamId
                : getContextTeamId(context);
            const [scopedArticles, contributorProfiles] = await Promise.all([
                selectRoyaltyArticles({
                    ownerCandidates: context.user.role === "admin" ? undefined : ownerCandidates,
                    teamId: adminTeamId,
                }),
                loadRoyaltyContributorProfiles(profileScopeTeamId),
            ]);
            const budgetEligibleArticles = filterBudgetEligibleRoyaltyArticles(scopedArticles, contributorProfiles);

            const monthlyMap: Record<string, { month: number; year: number; totalAmount: number; totalArticles: number }> = {};
            const writerAmounts: Record<string, number> = {};

            for (const article of budgetEligibleArticles) {
                const dateParts = parseRoyaltyDateParts(article.date);
                if (!dateParts) continue;
                const articleYear = dateParts.year;
                const articleMonth = dateParts.month;

                const key = `${articleYear}-${articleMonth}`;
                const price = rateMap.get(`${article.articleType}|${article.contentType}`) || 0;

                if (!monthlyMap[key]) {
                    monthlyMap[key] = { month: articleMonth, year: articleYear, totalAmount: 0, totalArticles: 0 };
                }
                monthlyMap[key].totalAmount += price;
                monthlyMap[key].totalArticles += 1;

                if (articleMonth === currentMonth && articleYear === currentYear) {
                    writerAmounts[article.penName] = (writerAmounts[article.penName] || 0) + price;
                }
            }

            const monthlyData: Array<{ month: number; year: number; totalAmount: number; totalArticles: number }> = [];
            for (let i = 5; i >= 0; i -= 1) {
                const d = new Date(currentYear, currentMonth - 1 - i, 1);
                const month = d.getMonth() + 1;
                const year = d.getFullYear();
                const key = `${year}-${month}`;
                monthlyData.push(monthlyMap[key] || { month, year, totalAmount: 0, totalArticles: 0 });
            }

            const budget = isLeader(context)
                ? await db
                    .select()
                    .from(monthlyBudgets)
                    .where(and(eq(monthlyBudgets.month, currentMonth), eq(monthlyBudgets.year, currentYear)))
                    .get()
                : null;

            const currentKey = `${currentYear}-${currentMonth}`;
            const currentSpent = monthlyMap[currentKey]?.totalAmount || 0;
            const currentArticles = monthlyMap[currentKey]?.totalArticles || 0;
            const budgetAmount = budget?.budgetAmount || 0;
            const budgetPercentage = budgetAmount > 0 ? Math.round((currentSpent / budgetAmount) * 100) : 0;
            const remainingBudget = Math.max(budgetAmount - currentSpent, 0);
            const currentPeriodArticles = budgetEligibleArticles.filter((article) =>
                matchesRoyaltyMonthYear(article.date, currentMonth, currentYear)
            );
            const contentBalance = summarizeRoyaltyContentBalance(currentPeriodArticles);

            const topWriters = Object.entries(writerAmounts)
                .map(([penName, amount]) => ({ penName, amount }))
                .sort((left, right) => right.amount - left.amount)
                .slice(0, 10);

            return NextResponse.json({
                success: true,
                data: {
                    monthlyData,
                    currentMonth: {
                        month: currentMonth,
                        year: currentYear,
                        totalAmount: currentSpent,
                        totalArticles: currentArticles,
                    },
                    budget: {
                        budgetAmount,
                        spent: currentSpent,
                        remaining: remainingBudget,
                        percentage: budgetPercentage,
                        hasBudget: budgetAmount > 0,
                    },
                    topWriters,
                    contentBalance,
                },
            });
        }

        if (action === "calculate") {
            if (context.user.role === "admin" && !isLeader(context) && !adminTeamId) {
                return NextResponse.json({ success: true, data: [], month: 0, year: 0 });
            }
            const month = searchParams.get("month") ? requiredInt(searchParams.get("month"), "month") : 0;
            const year = searchParams.get("year") ? requiredInt(searchParams.get("year"), "year") : 0;
            const requestPenName = optionalString(searchParams.get("penName")) || "";

            const rates = await db.select().from(royaltyRates).where(eq(royaltyRates.isActive, true)).all();
            const rateMap = new Map<string, number>();
            for (const rate of rates) {
                rateMap.set(`${rate.articleType}|${rate.contentType}`, rate.price);
            }

            const ownerCandidates = context.user.role === "admin" ? [] : getContextArticleOwnerCandidates(context);
            const profileScopeTeamId = context.user.role === "admin"
                ? adminTeamId
                : getContextTeamId(context);
            const [scopedArticles, contributorProfiles] = await Promise.all([
                selectRoyaltyArticles({
                    exactPenName: context.user.role === "admin" ? requestPenName || undefined : undefined,
                    ownerCandidates: context.user.role === "admin" ? undefined : ownerCandidates,
                    teamId: adminTeamId,
                }),
                loadRoyaltyContributorProfiles(profileScopeTeamId),
            ]);
            const budgetEligibleArticles = filterBudgetEligibleRoyaltyArticles(scopedArticles, contributorProfiles);

            const filtered = budgetEligibleArticles.filter((article) => {
                if (!month || !year) return true;
                return matchesRoyaltyMonthYear(article.date, month, year);
            });

            const paymentByWriter: Record<string, {
                penName: string;
                totalArticles: number;
                totalAmount: number;
                breakdown: RoyaltyBreakdown;
            }> = {};

            for (const article of filtered) {
                if (!paymentByWriter[article.penName]) {
                    paymentByWriter[article.penName] = {
                        penName: article.penName,
                        totalArticles: 0,
                        totalAmount: 0,
                        breakdown: {},
                    };
                }

                const writer = paymentByWriter[article.penName];
                const key = `${article.articleType}|${article.contentType}`;
                const price = rateMap.get(key) || 0;

                writer.totalArticles += 1;
                writer.totalAmount += price;

                const breakdownKey = `${article.articleType} (${article.contentType})`;
                if (!writer.breakdown[breakdownKey]) {
                    writer.breakdown[breakdownKey] = { count: 0, unitPrice: price, total: 0 };
                }
                writer.breakdown[breakdownKey].count += 1;
                writer.breakdown[breakdownKey].total += price;
            }

            return NextResponse.json({
                success: true,
                data: Object.values(paymentByWriter),
                month,
                year,
            });
        }

        const rates = await db.select().from(royaltyRates).all();
        return NextResponse.json({ success: true, data: rates });
    } catch (error) {
        if (error instanceof ValidationError) {
            return NextResponse.json({ success: false, error: error.message }, { status: error.status });
        }
        return handleServerError("royalty.get", error);
    }
}

export async function PUT(request: NextRequest) {
    try {
        await ensureDatabaseInitialized();
        const originError = enforceTrustedOrigin(request);
        if (originError) return originError;

        const context = await getCurrentUserContext();
        if (!context) {
            return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
        }
        if (!isLeader(context)) {
            return NextResponse.json({ success: false, error: "Leader access required" }, { status: 403 });
        }

        const body = (await request.json()) as Record<string, unknown>;
        const id = requiredInt(body.id, "id");
        const price = body.price;
        const isActive = body.isActive;

        const updateData: { updatedAt: string; price?: number; isActive?: boolean } = { updatedAt: new Date().toISOString() };
        if (typeof price === "number" && Number.isFinite(price)) updateData.price = price;
        if (typeof isActive === "boolean") updateData.isActive = isActive;

        await db.update(royaltyRates).set(updateData).where(eq(royaltyRates.id, id)).run();
        await publishRealtimeEvent(["royalty", "dashboard"]);
        return NextResponse.json({ success: true });
    } catch (error) {
        if (error instanceof ValidationError) {
            return NextResponse.json({ success: false, error: error.message }, { status: error.status });
        }
        return handleServerError("royalty.put", error);
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
        if (!isLeader(context)) {
            return NextResponse.json({ success: false, error: "Leader access required" }, { status: 403 });
        }

        const body = (await request.json()) as Record<string, unknown>;
        const action = String(body.action || "");

        if (action === "set-budget") {
            const month = requiredInt(body.month, "month");
            const year = requiredInt(body.year, "year");
            const budgetAmount = requiredInt(body.budgetAmount, "budgetAmount");
            const notes = optionalString(body.notes);

            const existing = await db
                .select()
                .from(monthlyBudgets)
                .where(and(eq(monthlyBudgets.month, month), eq(monthlyBudgets.year, year)))
                .get();

            if (existing) {
                await db.update(monthlyBudgets)
                    .set({
                        budgetAmount,
                        notes: notes ?? existing.notes,
                        updatedAt: new Date().toISOString(),
                    })
                    .where(eq(monthlyBudgets.id, existing.id))
                    .run();
            } else {
                await db.insert(monthlyBudgets).values({ month, year, budgetAmount, notes }).run();
            }

            await publishRealtimeEvent(["royalty", "dashboard"]);
            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
    } catch (error) {
        if (error instanceof ValidationError) {
            return NextResponse.json({ success: false, error: error.message }, { status: error.status });
        }
        return handleServerError("royalty.post", error);
    }
}
