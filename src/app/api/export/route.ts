import { db } from "@/db";
import { articles } from "@/db/schema";
import { getCurrentUserContext, hasArticleManagerAccess } from "@/lib/auth";
import { normalizeArticleReviewLink } from "@/lib/review-link";
import { getContextTeamId, isLeader } from "@/lib/teams";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

function sanitizeSpreadsheetCell(value: unknown) {
    const text = String(value ?? "");
    if (!text) return text;

    return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

export async function GET() {
    try {
        const context = await getCurrentUserContext();
        if (!context) {
            return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
        }
        if (!hasArticleManagerAccess(context)) {
            return NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 });
        }

        const adminTeamId = !isLeader(context) ? getContextTeamId(context) : null;
        const data = await db
            .select()
            .from(articles)
            .where(adminTeamId ? eq(articles.teamId, adminTeamId) : undefined)
            .all();

        const exportData = data.map((a) => ({
            STT: a.id,
            "ID Bài viết": sanitizeSpreadsheetCell(a.articleId),
            "Ngày viết": sanitizeSpreadsheetCell(a.date),
            "Tên bài viết": sanitizeSpreadsheetCell(a.title),
            "Bút danh": sanitizeSpreadsheetCell(a.penName),
            "Danh mục": sanitizeSpreadsheetCell(a.category),
            "Loại bài": sanitizeSpreadsheetCell(a.articleType),
            "Viết mới/Viết lại": sanitizeSpreadsheetCell(a.contentType),
            "Số chữ": sanitizeSpreadsheetCell(a.wordCountRange),
            "Trạng thái": sanitizeSpreadsheetCell(a.status),
            Link: sanitizeSpreadsheetCell(a.link),
            "Link duyệt bài": sanitizeSpreadsheetCell(normalizeArticleReviewLink(a.reviewLink) || null),
            "Người duyệt": sanitizeSpreadsheetCell(a.reviewerName),
            "Ghi chú": sanitizeSpreadsheetCell(a.notes),
        }));

        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(exportData);

        const colWidths = [
            { wch: 5 },
            { wch: 12 },
            { wch: 12 },
            { wch: 60 },
            { wch: 15 },
            { wch: 12 },
            { wch: 20 },
            { wch: 12 },
            { wch: 15 },
            { wch: 12 },
            { wch: 50 },
            { wch: 50 },
            { wch: 15 },
            { wch: 30 },
        ];
        worksheet["!cols"] = colWidths;

        XLSX.utils.book_append_sheet(workbook, worksheet, "Danh sách bài viết");
        const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

        return new NextResponse(buffer, {
            headers: {
                "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "Content-Disposition": `attachment; filename="ctv-articles-${new Date().toISOString().split("T")[0]}.xlsx"`,
            },
        });
    } catch (error) {
        return NextResponse.json(
            { success: false, error: String(error) },
            { status: 500 }
        );
    }
}
