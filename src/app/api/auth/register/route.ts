import { NextResponse } from "next/server";

export async function POST() {
    return NextResponse.json(
        {
            success: false,
            error: "Tinh nang tu dang ky da bi vo hieu hoa. Vui long lien he quan tri vien de duoc cap tai khoan.",
        },
        { status: 410 }
    );
}
