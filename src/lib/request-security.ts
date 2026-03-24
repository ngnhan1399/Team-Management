import { NextResponse } from "next/server";

function normalizeOrigin(value: string) {
  return value.trim().replace(/\/$/, "");
}

function getConfiguredOrigins() {
  const configuredOrigins = [
    ...(process.env.APP_ORIGINS || "")
      .split(/[\n,]/)
      .map((value) => normalizeOrigin(value))
      .filter(Boolean),
  ];

  const legacyOrigin = process.env.APP_ORIGIN?.trim();
  if (legacyOrigin) {
    configuredOrigins.push(normalizeOrigin(legacyOrigin));
  }

  return Array.from(new Set(configuredOrigins));
}

function getAllowedOrigins(request: Request) {
  const configuredOrigins = getConfiguredOrigins();
  if (configuredOrigins.length > 0) {
    return configuredOrigins;
  }

  const forwardedProto = request.headers.get("x-forwarded-proto");
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost || request.headers.get("host");

  if (host) {
    configuredOrigins.push(
      normalizeOrigin(`${forwardedProto || new URL(request.url).protocol.replace(":", "")}://${host}`)
    );
    return Array.from(new Set(configuredOrigins));
  }

  configuredOrigins.push(normalizeOrigin(new URL(request.url).origin));
  return Array.from(new Set(configuredOrigins));
}

export function enforceTrustedOrigin(request: Request) {
  const allowedOrigins = getAllowedOrigins(request);
  const origin = request.headers.get("origin");

  if (origin && allowedOrigins.includes(normalizeOrigin(origin))) {
    return null;
  }

  const referer = request.headers.get("referer");
  if (!origin && referer) {
    try {
      if (allowedOrigins.includes(normalizeOrigin(new URL(referer).origin))) {
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
