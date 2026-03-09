import { NextResponse } from "next/server";

function normalizeOrigin(value: string) {
  return value.trim().replace(/\/$/, "");
}

function getExpectedOrigin(request: Request) {
  const configuredOrigin = process.env.APP_ORIGIN?.trim();
  if (configuredOrigin) {
    return normalizeOrigin(configuredOrigin);
  }

  const forwardedProto = request.headers.get("x-forwarded-proto");
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost || request.headers.get("host");

  if (host) {
    return normalizeOrigin(`${forwardedProto || new URL(request.url).protocol.replace(":", "")}://${host}`);
  }

  return normalizeOrigin(new URL(request.url).origin);
}

export function enforceTrustedOrigin(request: Request) {
  const expectedOrigin = getExpectedOrigin(request);
  const origin = request.headers.get("origin");

  if (origin && normalizeOrigin(origin) === expectedOrigin) {
    return null;
  }

  const referer = request.headers.get("referer");
  if (!origin && referer) {
    try {
      if (normalizeOrigin(new URL(referer).origin) === expectedOrigin) {
        return null;
      }
    } catch {
      // Ignore malformed referer values and reject below.
    }
  }

  return NextResponse.json(
    { success: false, error: "Invalid request origin" },
    { status: 403 }
  );
}
