import { getCurrentUserContext } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

type LinkCheckStatus = "ok" | "broken" | "unknown";

const HTML_SNIFF_LIMIT_BYTES = 32 * 1024;
const GENERIC_SOFT_404_PATTERNS = [
    ["page not found"],
    ["trang khong ton tai"],
    ["khong tim thay trang"],
    ["404", "ve trang chu"],
    ["404", "go to homepage"],
] as const;
const HOST_SOFT_404_PATTERNS = [
    {
        hostnamePattern: /(^|\.)fptshop\.com\.vn$/i,
        patterns: [
            ["duong dan da het han truy cap hoac khong ton tai"],
            ["trang het han truy cap hoac khong ton tai"],
        ] as const,
    },
] as const;

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

function isConfirmedBrokenStatus(status: number) {
    return [404, 410, 451].includes(status);
}

function classifyResponseStatus(status: number): LinkCheckStatus {
    if (isLikelyReachableStatus(status)) return "ok";
    if (isConfirmedBrokenStatus(status)) return "broken";
    return "unknown";
}

function normalizeText(value: string) {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}

function isHtmlResponse(response: Response) {
    const contentType = response.headers.get("content-type")?.toLowerCase() || "";
    return contentType.includes("text/html") || contentType.includes("application/xhtml+xml");
}

async function readResponseSample(response: Response, maxBytes = HTML_SNIFF_LIMIT_BYTES) {
    if (!response.body) {
        return "";
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let receivedBytes = 0;
    let sample = "";

    try {
        while (receivedBytes < maxBytes) {
            const { done, value } = await reader.read();
            if (done || !value) break;

            receivedBytes += value.byteLength;
            sample += decoder.decode(value, { stream: true });
        }

        sample += decoder.decode();
        return sample;
    } catch {
        return sample;
    } finally {
        await reader.cancel().catch(() => undefined);
    }
}

function matchesSoft404Pattern(text: string, patterns: readonly (readonly string[])[]) {
    return patterns.some((parts) => parts.every((part) => text.includes(part)));
}

function isSoft404Response(url: URL, bodySample: string) {
    const normalizedBody = normalizeText(bodySample);
    if (!normalizedBody) return false;

    if (matchesSoft404Pattern(normalizedBody, GENERIC_SOFT_404_PATTERNS)) {
        return true;
    }

    return HOST_SOFT_404_PATTERNS.some((entry) => (
        entry.hostnamePattern.test(url.hostname) && matchesSoft404Pattern(normalizedBody, entry.patterns)
    ));
}

async function classifyGetResponse(url: URL, response: Response): Promise<LinkCheckStatus> {
    const responseStatus = classifyResponseStatus(response.status);
    if (responseStatus !== "ok") {
        return responseStatus;
    }

    if (!isHtmlResponse(response)) {
        return "ok";
    }

    const sample = await readResponseSample(response);
    if (isSoft404Response(url, sample)) {
        return "broken";
    }

    return "ok";
}

async function requestUrl(url: URL, method: "HEAD" | "GET", signal: AbortSignal) {
    return fetch(url, {
        method,
        signal,
        redirect: "follow",
        headers: {
            "User-Agent": "Mozilla/5.0 (compatible; Workdocker-LinkChecker/1.0; +https://www.workdocker.com)",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "vi,en;q=0.8",
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
        const results: Record<string, LinkCheckStatus> = {};

        await Promise.allSettled(
            urls.slice(0, maxCheck).map(async (url: string) => {
                try {
                    if (!url) {
                        results[url] = "broken";
                        return;
                    }

                    const parsedUrl = new URL(url);
                    if (!["http:", "https:"].includes(parsedUrl.protocol) || isPrivateHostname(parsedUrl.hostname)) {
                        results[url] = "broken";
                        return;
                    }

                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 10000);

                    let status: LinkCheckStatus = "unknown";
                    try {
                        const headResponse = await requestUrl(parsedUrl, "HEAD", controller.signal);
                        const headStatus = classifyResponseStatus(headResponse.status);
                        const getResponse = await requestUrl(parsedUrl, "GET", controller.signal);
                        const getStatus = await classifyGetResponse(parsedUrl, getResponse);

                        status = getStatus === "unknown" ? headStatus : getStatus;
                    } finally {
                        clearTimeout(timeout);
                    }

                    results[url] = status;
                } catch {
                    results[url] = "unknown";
                }
            })
        );

        return NextResponse.json({ success: true, results });
    } catch (error) {
        return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
    }
}
