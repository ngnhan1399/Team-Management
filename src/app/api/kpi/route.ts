import { db, ensureDatabaseInitialized } from "@/db";
import { kpiRecords } from "@/db/schema";
import { getContextIdentityCandidates, getCurrentUserContext, matchesIdentityCandidate } from "@/lib/auth";
import { enforceTrustedOrigin } from "@/lib/request-security";
import { handleServerError } from "@/lib/server-error";
import { eq, and, type SQL } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
    try {
        await ensureDatabaseInitialized();
        const context = await getCurrentUserContext();
        if (!context) {
            return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const month = parseInt(searchParams.get("month") || String(new Date().getMonth() + 1));
        const year = parseInt(searchParams.get("year") || String(new Date().getFullYear()));
        const identityCandidates = getContextIdentityCandidates(context);

        const whereConditions: SQL[] = [eq(kpiRecords.month, month), eq(kpiRecords.year, year)];

        if (context.user.role !== "admin" && identityCandidates.length === 0) {
            return NextResponse.json({ success: true, data: [], month, year });
        }

        let records = await db
            .select()
            .from(kpiRecords)
            .where(and(...whereConditions))
            .all();

        if (context.user.role !== "admin") {
            records = records.filter((record) => matchesIdentityCandidate(identityCandidates, record.penName));
        }

        return NextResponse.json({ success: true, data: records, month, year });
    } catch (error) {
        return handleServerError("kpi.get", error);
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
        if (context.user.role !== "admin") {
            return NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 });
        }

        const body = await request.json();
        const { month, year, penName, kpiStandard, kpiActual, evaluation } = body;

        if (!month || !year || !penName) {
            return NextResponse.json(
                { success: false, error: "Month, year, and penName are required" },
                { status: 400 }
            );
        }

        const existing = await db
            .select()
            .from(kpiRecords)
            .where(and(eq(kpiRecords.month, month), eq(kpiRecords.year, year), eq(kpiRecords.penName, penName)))
            .get();

        if (existing) {
            await db.update(kpiRecords)
                .set({
                    kpiStandard: kpiStandard ?? existing.kpiStandard,
                    kpiActual: kpiActual ?? existing.kpiActual,
                    evaluation: evaluation ?? existing.evaluation,
                })
                .where(eq(kpiRecords.id, existing.id))
                .run();
        } else {
            await db.insert(kpiRecords)
                .values({
                    month,
                    year,
                    penName,
                    kpiStandard: kpiStandard || 25,
                    kpiActual: kpiActual || 0,
                    evaluation,
                })
                .run();
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        return handleServerError("kpi.post", error);
    }
}
