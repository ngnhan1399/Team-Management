import { db, ensureDatabaseInitialized } from "@/db";
import { auditLogs } from "@/db/schema";
import { getCurrentUserContext } from "@/lib/auth";
import { handleServerError } from "@/lib/server-error";
import { isLeader } from "@/lib/teams";
import { desc, eq, and, type SQL } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
    try {
        await ensureDatabaseInitialized();
        const context = await getCurrentUserContext();
        if (!context) {
            return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
        }
        if (!isLeader(context)) {
            return NextResponse.json({ success: false, error: "Leader access required" }, { status: 403 });
        }

        const { searchParams } = new URL(request.url);
        const limit = Math.min(parseInt(searchParams.get("limit") || "100"), 500);
        const action = searchParams.get("action") || "";
        const entity = searchParams.get("entity") || "";

        const whereConditions: SQL[] = [];
        if (action) whereConditions.push(eq(auditLogs.action, action));
        if (entity) whereConditions.push(eq(auditLogs.entity, entity));

        const rows = await db
            .select()
            .from(auditLogs)
            .where(whereConditions.length > 0 ? and(...whereConditions) : undefined)
            .orderBy(desc(auditLogs.id))
            .limit(limit)
            .all();

        const data = rows.map((row) => ({
            ...row,
            payload: row.payload ? safeParse(row.payload) : null,
        }));

        return NextResponse.json({ success: true, data });
    } catch (error) {
        return handleServerError("audit-logs.get", error);
    }
}

function safeParse(raw: string) {
    try {
        return JSON.parse(raw);
    } catch {
        return raw;
    }
}
