import { db } from "@/db";
import { articles } from "@/db/schema";
import { getCurrentUserContext, hasArticleManagerAccess } from "@/lib/auth";
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

export async function GET() {
    try {
        const context = await getCurrentUserContext();
        if (!context) {
            return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
        }
        if (!hasArticleManagerAccess(context)) {
            return NextResponse.json({ success: false, error: "Admin access required" }, { status: 403 });
        }

        const data = await db.select().from(articles).all();

        const exportData = data.map((a) => ({
            STT: a.id,
            "ID Bài viết": a.articleId,
            "Ngày viết": a.date,
            "Tên bài viết": a.title,
            "Bút danh": a.penName,
            "Danh mục": a.category,
            "Loại bài": a.articleType,
            "Viết mới/Viết lại": a.contentType,
            "Số chữ": a.wordCountRange,
            "Trạng thái": a.status,
            Link: a.link,
            "Người duyệt": a.reviewerName,
            "Ghi chú": a.notes,
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

