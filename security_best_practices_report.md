# Security Best Practices Report

## Executive Summary

The application has a reasonable baseline for authentication cookies and several state-changing routes do enforce a same-origin check, but there are still a few high-impact gaps. The most serious issue is that the public registration endpoint can activate or claim any collaborator account using only a known email address, which conflicts with the documented "self-registration disabled" posture. There are also defense-in-depth weaknesses around origin validation, webhook secret handling, spreadsheet export sanitization, and the absence of a Content Security Policy.

## Critical / High

### SEC-001: Public collaborator account activation is still enabled

- Severity: High
- Location: `src/app/api/auth/register/route.ts:20-120`, `README.md:139-145`
- Evidence:
  - `src/app/api/auth/register/route.ts` accepts unauthenticated `POST` requests and creates or activates a `ctv` user whenever the submitted email matches an active collaborator.
  - `README.md` explicitly states `Tự đăng ký tài khoản đã bị vô hiệu hóa`.
- Impact:
  - Anyone who knows or guesses an active collaborator email can set the password for that collaborator account and immediately obtain access.
- Fix:
  - Disable the route entirely for public callers, or require an invitation token / one-time activation code tied to a specific collaborator and expiry.
- Mitigation:
  - Until fixed, restrict the route at the edge and audit collaborator/user records for suspicious account activations.

## Medium

### SEC-002: Same-origin enforcement trusts spoofable forwarded headers

- Severity: Medium
- Location: `src/lib/request-security.ts:23-38`, `src/lib/request-security.ts:41-63`
- Evidence:
  - Allowed origins are built using `x-forwarded-host` and `x-forwarded-proto` from the request itself, then compared directly to `Origin` / `Referer`.
- Impact:
  - If the deployment path forwards these headers without sanitizing them, an attacker can forge matching forwarded headers and bypass the route-level origin check.
- Fix:
  - Only trust an explicit allowlist from `APP_ORIGINS` / `APP_ORIGIN`, or derive origin strictly from `request.url` plus known deployment config instead of client-provided forwarded headers.
- Mitigation:
  - Keep `SameSite=Strict` cookies in place and verify whether the hosting platform strips user-supplied forwarded headers.

### SEC-003: XLSX export writes attacker-controlled cells without formula neutralization

- Severity: Medium
- Location: `src/app/api/export/route.ts:27-46`
- Evidence:
  - Article fields such as title, pen name, link, reviewer name, and notes are copied into `exportData`, then written straight into `XLSX.utils.json_to_sheet(exportData)`.
- Impact:
  - A collaborator can store spreadsheet formulas beginning with `=`, `+`, `-`, or `@`; when an admin opens the exported file in Excel-compatible software, formula injection can execute and exfiltrate data.
- Fix:
  - Escape leading spreadsheet formula characters for all text fields before generating the worksheet.
- Mitigation:
  - Warn operators not to open exported files from untrusted content until sanitization is added.

### SEC-004: Google Sheets webhook falls back to a built-in secret hash

- Severity: Medium
- Location: `src/app/api/articles/google-sync/webhook/route.ts:13-14`, `src/app/api/articles/google-sync/webhook/route.ts:51-57`
- Evidence:
  - When `GOOGLE_SHEETS_WEBHOOK_SECRET` is missing, the route still accepts requests against a hard-coded fallback SHA-256 hash.
- Impact:
  - The webhook can stay reachable even when production secret configuration is incomplete, weakening the "fail closed" expectation for a sync endpoint that mutates article data.
- Fix:
  - Refuse to start or return `503` until `GOOGLE_SHEETS_WEBHOOK_SECRET` is configured; remove the hard-coded fallback.
- Mitigation:
  - Verify production has a unique secret set and rotate it after removing the fallback path.

### SEC-005: Security headers baseline is missing a Content Security Policy

- Severity: Medium
- Location: `next.config.ts:3-21`
- Evidence:
  - The global security headers include `Referrer-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, and `Permissions-Policy`, but no `Content-Security-Policy`.
- Impact:
  - If any XSS bug appears in the app or a dependency, there is no browser-enforced CSP layer to reduce blast radius.
- Fix:
  - Add a production CSP suited to the app's asset/runtime model, then tune exceptions deliberately.
- Mitigation:
  - Confirm whether CSP is injected at the CDN / reverse proxy; it is not visible in app code.

## Low / Operational Security

### SEC-006: Login rate limiting is process-local only

- Severity: Low
- Location: `src/lib/rate-limit.ts:7-75`
- Evidence:
  - Failed login state is stored in a local `Map`, with no shared backing store.
- Impact:
  - On serverless or multi-instance deployments, attackers can rotate across instances and largely bypass the intended brute-force protection.
- Fix:
  - Move rate limiting to a shared store such as Redis, Upstash, or a database-backed throttle.
- Mitigation:
  - Add edge/network rate limiting in front of `/api/auth/login`.

## Verification Notes

- `npm run typecheck` passed.
- `npm run verify:safe` currently fails because ESLint reports hook issues in `src/app/components/BottomSheet.tsx` and `src/app/components/useMediaQuery.ts`.
- `npm run build` fails locally on Windows/Turbopack with an `xlsx` junction error.
- `npm run build:compat` also fails locally with a webpack `readlink` error on `src/app/api/articles/comments/route.ts`.
- `npm run test:smoke` could not complete because PostgreSQL at `127.0.0.1:5432` was not reachable in this environment.
