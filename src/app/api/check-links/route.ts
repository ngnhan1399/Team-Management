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

function isLikelyReachableStatus(status: number) {
    return (status >= 200 && status < 400) || [401, 403, 405, 416, 429].includes(status);
}

async function requestUrl(url: URL, method: "HEAD" | "GET", signal: AbortSignal) {
    return fetch(url, {
        method,
        signal,
        redirect: "follow",
        headers: {
            "User-Agent": "Mozilla/5.0 (compatible; CTV-Manager-LinkChecker/1.0; +https://www.workdocker.com)",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "vi,en;q=0.8",
            ...(method === "GET" ? { Range: "bytes=0-0" } : {}),
        },
        cache: "no-store",
    });
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
                    const timeout = setTimeout(() => controller.abort(), 10000);

                    let reachable = false;
                    try {
                        const headResponse = await requestUrl(parsedUrl, "HEAD", controller.signal);
                        reachable = isLikelyReachableStatus(headResponse.status);

                        if (!reachable) {
                            const getResponse = await requestUrl(parsedUrl, "GET", controller.signal);
                            reachable = isLikelyReachableStatus(getResponse.status);
                        }
                    } finally {
                        clearTimeout(timeout);
                    }

                    results[url] = reachable;
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

