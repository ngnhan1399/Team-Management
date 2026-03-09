import { getCurrentUserContext } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

function isPrivateHostname(hostname: string) {
    const normalized = hostname.trim().toLowerCase();
    if (!normalized) return true;

    return (
        normalized === "localhost" ||
        normalized.endsWith(".localhost") ||
        normalized === "127.0.0.1" ||
        normalized === "::1" ||
        normalized.startsWith("10.") ||
        normalized.startsWith("127.") ||
        normalized.startsWith("192.168.") ||
        normalized.startsWith("169.254.") ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)
    );
}

export async function POST(request: NextRequest) {
    try {
        const context = await getCurrentUserContext();
        if (!context) {
            return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
        }

        const { urls } = await request.json();

        if (!urls || !Array.isArray(urls) || urls.length === 0) {
            return NextResponse.json({ success: false, error: "urls array required" }, { status: 400 });
        }

        const maxCheck = Math.min(urls.length, 50);
        const results: Record<string, boolean> = {};

        await Promise.allSettled(
            urls.slice(0, maxCheck).map(async (url: string) => {
                try {
                    if (!url) {
                        results[url] = false;
                        return;
                    }

                    const parsedUrl = new URL(url);
                    if (!["http:", "https:"].includes(parsedUrl.protocol) || isPrivateHostname(parsedUrl.hostname)) {
                        results[url] = false;
                        return;
                    }

                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 8000);
                    const res = await fetch(parsedUrl, {
                        method: "HEAD",
                        signal: controller.signal,
                        redirect: "follow",
                        headers: { "User-Agent": "CTV-Manager-LinkChecker/1.0" },
                    });
                    clearTimeout(timeout);
                    results[url] = res.ok;
                } catch {
                    results[url] = false;
                }
            })
        );

        return NextResponse.json({ success: true, results });
    } catch (error) {
        return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
    }
}

