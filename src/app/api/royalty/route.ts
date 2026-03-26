import { db, ensureDatabaseInitialized } from "@/db";
import { royaltyRates, articles, monthlyBudgets, collaborators, users } from "@/db/schema";
import { getContextArticleOwnerCandidates, getContextIdentityCandidates, getCurrentUserContext, matchesIdentityCandidate } from "@/lib/auth";
import { resolveAppArticleFields } from "@/lib/google-sheet-article-mapping";
import { publishRealtimeEvent } from "@/lib/realtime";
import {
    isBudgetEligibleContributor,
    matchesRoyaltyMonthYear,
    parseRoyaltyDateParts,
    resolveRoyaltyContributionPrice,
    resolveRoyaltyContributorPenName,
    resolveRoyaltyContributorProfile,
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
    id: number;
    teamId: number | null;
    penName: string;
    reviewerName: string | null;
    category: string;
    articleType: string;
    contentType: string;
    wordCountRange: string | null;
    date: string;
};

const ROYALTY_ELIGIBLE_STATUS_VALUES = ["Published", "Approved"] as const;

function buildArticleOwnerWhere(ownerCandidates: string[]): SQL | undefined {
    const normalizedCandidates = Array.from(new Set(ownerCandidates.map((value) => String(value || "").trim()).filter(Boolean)));
    if (normalizedCandidates.length === 0) return undefined;
    if (normalizedCandidates.length === 1) return eq(articles.penName, normalizedCandidates[0] as never);
    return inArray(articles.penName, normalizedCandidates as never[]);
}

async function selectRoyaltyArticles(options?: {
    ownerCandidates?: string[];
    exactPenName?: string;
    teamId?: number | null;
    includeAllStatuses?: boolean;
}) {
    const conditions: SQL[] = [];

    if (!options?.includeAllStatuses) {
        conditions.push(inArray(articles.status, [...ROYALTY_ELIGIBLE_STATUS_VALUES]));
    }

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
        id: articles.id,
        teamId: articles.teamId,
        penName: articles.penName,
        reviewerName: articles.reviewerName,
        category: articles.category,
        articleType: articles.articleType,
        contentType: articles.contentType,
        wordCountRange: articles.wordCountRange,
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

function appendRoyaltyContribution(
    rowsByContributor: Record<string, {
        penName: string;
        totalArticles: number;
        totalAmount: number;
        writerArticles: number;
        writerAmount: number;
        reviewerArticles: number;
        reviewerAmount: number;
        breakdown: RoyaltyBreakdown;
    }>,
    options: {
        contributorPenName: string;
        role: "writer" | "reviewer";
        articleType: string;
        contentType: string;
        price: number;
    }
) {
    const contributorPenName = String(options.contributorPenName || "").trim();
    if (!contributorPenName) {
        return;
    }

    if (!rowsByContributor[contributorPenName]) {
        rowsByContributor[contributorPenName] = {
            penName: contributorPenName,
            totalArticles: 0,
            totalAmount: 0,
            writerArticles: 0,
            writerAmount: 0,
            reviewerArticles: 0,
            reviewerAmount: 0,
            breakdown: {},
        };
    }

    const row = rowsByContributor[contributorPenName];
    row.totalArticles += 1;
    row.totalAmount += options.price;

    if (options.role === "writer") {
        row.writerArticles += 1;
        row.writerAmount += options.price;
    } else {
        row.reviewerArticles += 1;
        row.reviewerAmount += options.price;
    }

    const detailPrefix = options.role === "writer" ? "Viết bài" : "Duyệt bài";
    const breakdownKey = `${detailPrefix} • ${options.articleType} (${options.contentType})`;
    if (!row.breakdown[breakdownKey]) {
        row.breakdown[breakdownKey] = { count: 0, unitPrice: options.price, total: 0 };
    }
    row.breakdown[breakdownKey].count += 1;
    row.breakdown[breakdownKey].total += options.price;
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
                        currentMonth: {
                            month: new Date().getMonth() + 1,
                            year: new Date().getFullYear(),
                            totalAmount: 0,
                            totalArticles: 0,
                            writerAmount: 0,
                            reviewerAmount: 0,
                            writerArticles: 0,
                            reviewerArticles: 0,
                        },
                        budget: { budgetAmount: 0, spent: 0, remaining: 0, percentage: 0, hasBudget: false, viewerContribution: null },
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

            const identityCandidates = getContextIdentityCandidates(context);
            const ownerCandidates = context.user.role === "admin" ? [] : getContextArticleOwnerCandidates(context);
            const scopedTeamId = context.user.role === "admin"
                ? adminTeamId
                : getContextTeamId(context);
            const profileScopeTeamId = context.user.role === "admin"
                ? adminTeamId
                : getContextTeamId(context);
            const [scopedArticles, contributorProfiles] = await Promise.all([
                selectRoyaltyArticles({
                    ownerCandidates: scopedTeamId ? undefined : (context.user.role === "admin" ? undefined : ownerCandidates),
                    teamId: scopedTeamId,
                    includeAllStatuses: true,
                }),
                loadRoyaltyContributorProfiles(profileScopeTeamId),
            ]);
            const canSeeContributor = (penName: string) => context.user.role === "admin" || matchesIdentityCandidate(identityCandidates, penName);
            const monthlyMap: Record<string, {
                month: number;
                year: number;
                totalAmount: number;
                totalArticles: number;
                writerAmount: number;
                reviewerAmount: number;
                writerArticles: number;
                reviewerArticles: number;
            }> = {};
            const visibleCurrentPeriodArticles = new Map<string, RoyaltySourceArticle>();

            const appendVisibleContribution = (
                contributorPenName: string,
                role: "writer" | "reviewer",
                amount: number,
                articleYear: number,
                articleMonth: number,
                article: RoyaltySourceArticle
            ) => {
                if (!canSeeContributor(contributorPenName)) {
                    return;
                }

                const key = `${articleYear}-${articleMonth}`;
                if (!monthlyMap[key]) {
                    monthlyMap[key] = {
                        month: articleMonth,
                        year: articleYear,
                        totalAmount: 0,
                        totalArticles: 0,
                        writerAmount: 0,
                        reviewerAmount: 0,
                        writerArticles: 0,
                        reviewerArticles: 0,
                    };
                }

                monthlyMap[key].totalAmount += amount;
                monthlyMap[key].totalArticles += 1;
                if (role === "writer") {
                    monthlyMap[key].writerAmount += amount;
                    monthlyMap[key].writerArticles += 1;
                } else {
                    monthlyMap[key].reviewerAmount += amount;
                    monthlyMap[key].reviewerArticles += 1;
                }

                if (articleMonth === currentMonth && articleYear === currentYear) {
                    visibleCurrentPeriodArticles.set(
                        String(article.id),
                        article
                    );
                }
            };
            const currentPeriodContributorAmounts: Record<string, {
                penName: string;
                amount: number;
                writerAmount: number;
                reviewerAmount: number;
                writerArticles: number;
                reviewerArticles: number;
            }> = {};

            const appendCurrentPeriodContributorAmount = (
                contributorPenName: string,
                role: "writer" | "reviewer",
                amount: number
            ) => {
                if (!currentPeriodContributorAmounts[contributorPenName]) {
                    currentPeriodContributorAmounts[contributorPenName] = {
                        penName: contributorPenName,
                        amount: 0,
                        writerAmount: 0,
                        reviewerAmount: 0,
                        writerArticles: 0,
                        reviewerArticles: 0,
                    };
                }

                currentPeriodContributorAmounts[contributorPenName].amount += amount;
                if (role === "writer") {
                    currentPeriodContributorAmounts[contributorPenName].writerAmount += amount;
                    currentPeriodContributorAmounts[contributorPenName].writerArticles += 1;
                } else {
                    currentPeriodContributorAmounts[contributorPenName].reviewerAmount += amount;
                    currentPeriodContributorAmounts[contributorPenName].reviewerArticles += 1;
                }
            };

            for (const article of scopedArticles) {
                const normalizedArticleFields = resolveAppArticleFields({
                    category: article.category,
                    articleType: article.articleType,
                    contentType: article.contentType,
                    wordCountRange: article.wordCountRange,
                });
                const dateParts = parseRoyaltyDateParts(article.date);
                if (!dateParts) continue;
                const articleYear = dateParts.year;
                const articleMonth = dateParts.month;

                const writerPrice = rateMap.get(`${normalizedArticleFields.articleType}|${normalizedArticleFields.contentType}`) || 0;

                const writerProfile = resolveRoyaltyContributorProfile(article.penName, contributorProfiles);
                if (isBudgetEligibleContributor(writerProfile, ["writer"])) {
                    const contributorPenName = resolveRoyaltyContributorPenName(article.penName, contributorProfiles) || article.penName;
                    const contributionPrice = resolveRoyaltyContributionPrice("writer", writerPrice);
                    appendVisibleContribution(
                        contributorPenName,
                        "writer",
                        contributionPrice,
                        articleYear,
                        articleMonth,
                        article
                    );
                    if (articleMonth === currentMonth && articleYear === currentYear) {
                        appendCurrentPeriodContributorAmount(contributorPenName, "writer", contributionPrice);
                    }
                }

                const reviewerName = String(article.reviewerName || "").trim();
                const reviewerProfile = resolveRoyaltyContributorProfile(reviewerName, contributorProfiles);
                if (reviewerName && isBudgetEligibleContributor(reviewerProfile, ["reviewer"])) {
                    const contributorPenName = resolveRoyaltyContributorPenName(reviewerName, contributorProfiles) || reviewerName;
                    const contributionPrice = resolveRoyaltyContributionPrice("reviewer", writerPrice);
                    appendVisibleContribution(
                        contributorPenName,
                        "reviewer",
                        contributionPrice,
                        articleYear,
                        articleMonth,
                        article
                    );
                    if (articleMonth === currentMonth && articleYear === currentYear) {
                        appendCurrentPeriodContributorAmount(contributorPenName, "reviewer", contributionPrice);
                    }
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
            const toSharePercentage = (amount: number, total: number) => total > 0 ? Math.round((amount / total) * 1000) / 10 : 0;
            const currentPeriodArticles = Array.from(visibleCurrentPeriodArticles.values());
            const contentBalance = summarizeRoyaltyContentBalance(
                currentPeriodArticles.map((article) => resolveAppArticleFields({
                    category: article.category,
                    articleType: article.articleType,
                    contentType: article.contentType,
                    wordCountRange: article.wordCountRange,
                }))
            );

            const topWriters = Object.values(currentPeriodContributorAmounts)
                .sort((left, right) => right.amount - left.amount)
                .slice(0, 10);

            let viewerContribution: {
                penName: string;
                amount: number;
                writerAmount: number;
                reviewerAmount: number;
                writerArticles: number;
                reviewerArticles: number;
                budgetPercentage: number;
                spentSharePercentage: number;
            } | null = null;

            if (context.user.role !== "admin") {
                for (const contributor of Object.values(currentPeriodContributorAmounts)) {
                    if (!matchesIdentityCandidate(identityCandidates, contributor.penName)) {
                        continue;
                    }

                    if (!viewerContribution) {
                        viewerContribution = {
                            penName: contributor.penName,
                            amount: 0,
                            writerAmount: 0,
                            reviewerAmount: 0,
                            writerArticles: 0,
                            reviewerArticles: 0,
                            budgetPercentage: 0,
                            spentSharePercentage: 0,
                        };
                    }

                    viewerContribution.amount += contributor.amount;
                    viewerContribution.writerAmount += contributor.writerAmount;
                    viewerContribution.reviewerAmount += contributor.reviewerAmount;
                    viewerContribution.writerArticles += contributor.writerArticles;
                    viewerContribution.reviewerArticles += contributor.reviewerArticles;
                }

                if (viewerContribution) {
                    viewerContribution.budgetPercentage = toSharePercentage(viewerContribution.amount, budgetAmount);
                    viewerContribution.spentSharePercentage = toSharePercentage(viewerContribution.amount, currentSpent);
                }
            }

            return NextResponse.json({
                success: true,
                data: {
                    monthlyData,
                    currentMonth: {
                        month: currentMonth,
                        year: currentYear,
                        totalAmount: currentSpent,
                        totalArticles: currentArticles,
                        writerAmount: monthlyMap[currentKey]?.writerAmount || 0,
                        reviewerAmount: monthlyMap[currentKey]?.reviewerAmount || 0,
                        writerArticles: monthlyMap[currentKey]?.writerArticles || 0,
                        reviewerArticles: monthlyMap[currentKey]?.reviewerArticles || 0,
                    },
                    budget: {
                        budgetAmount,
                        spent: currentSpent,
                        remaining: remainingBudget,
                        percentage: budgetPercentage,
                        hasBudget: budgetAmount > 0,
                        viewerContribution,
                    },
                    topWriters: topWriters.map((contributor) => ({
                        ...contributor,
                        budgetPercentage: toSharePercentage(contributor.amount, budgetAmount),
                        spentSharePercentage: toSharePercentage(contributor.amount, currentSpent),
                    })),
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
            const identityCandidates = getContextIdentityCandidates(context);
            const scopedTeamId = context.user.role === "admin" ? adminTeamId : getContextTeamId(context);

            const rates = await db.select().from(royaltyRates).where(eq(royaltyRates.isActive, true)).all();
            const rateMap = new Map<string, number>();
            for (const rate of rates) {
                rateMap.set(`${rate.articleType}|${rate.contentType}`, rate.price);
            }

            const profileScopeTeamId = context.user.role === "admin"
                ? adminTeamId
                : getContextTeamId(context);
            const [scopedArticles, contributorProfiles] = await Promise.all([
                selectRoyaltyArticles({
                    ownerCandidates: scopedTeamId ? undefined : (context.user.role === "admin" ? undefined : identityCandidates),
                    teamId: scopedTeamId,
                }),
                loadRoyaltyContributorProfiles(profileScopeTeamId),
            ]);

            const paymentByWriter: Record<string, {
                penName: string;
                totalArticles: number;
                totalAmount: number;
                writerArticles: number;
                writerAmount: number;
                reviewerArticles: number;
                reviewerAmount: number;
                breakdown: RoyaltyBreakdown;
            }> = {};

            for (const article of scopedArticles) {
                if ((month && year) && !matchesRoyaltyMonthYear(article.date, month, year)) {
                    continue;
                }

                const normalizedArticleFields = resolveAppArticleFields({
                    category: article.category,
                    articleType: article.articleType,
                    contentType: article.contentType,
                    wordCountRange: article.wordCountRange,
                });
                const key = `${normalizedArticleFields.articleType}|${normalizedArticleFields.contentType}`;
                const writerPrice = rateMap.get(key) || 0;

                const writerProfile = resolveRoyaltyContributorProfile(article.penName, contributorProfiles);
                if (isBudgetEligibleContributor(writerProfile, ["writer"])) {
                    appendRoyaltyContribution(paymentByWriter, {
                        contributorPenName: resolveRoyaltyContributorPenName(article.penName, contributorProfiles) || article.penName,
                        role: "writer",
                        articleType: normalizedArticleFields.articleType,
                        contentType: normalizedArticleFields.contentType,
                        price: resolveRoyaltyContributionPrice("writer", writerPrice),
                    });
                }

                const reviewerName = String(article.reviewerName || "").trim();
                const reviewerProfile = resolveRoyaltyContributorProfile(reviewerName, contributorProfiles);
                if (reviewerName && isBudgetEligibleContributor(reviewerProfile, ["reviewer"])) {
                    appendRoyaltyContribution(paymentByWriter, {
                        contributorPenName: resolveRoyaltyContributorPenName(reviewerName, contributorProfiles) || reviewerName,
                        role: "reviewer",
                        articleType: normalizedArticleFields.articleType,
                        contentType: normalizedArticleFields.contentType,
                        price: resolveRoyaltyContributionPrice("reviewer", writerPrice),
                    });
                }
            }

            let result = Object.values(paymentByWriter);
            if (context.user.role === "admin" && requestPenName) {
                result = result.filter((row) => matchesIdentityCandidate([row.penName], requestPenName));
            }
            if (context.user.role !== "admin") {
                result = result.filter((row) => matchesIdentityCandidate(identityCandidates, row.penName));
            }

            return NextResponse.json({
                success: true,
                data: result,
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
