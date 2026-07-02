/**
 * B-1 — Route-protection middleware (optimistic cookie-presence gate)
 * E-2 — Per-IP rate limiting for sensitive public endpoints (Upstash Redis)
 *
 * Next.js 16 note: `middleware.ts` is deprecated in favour of `proxy.ts`
 * (Node.js runtime). We intentionally keep the `middleware.ts` convention
 * because: (a) edge runtime is required for this to run before every request
 * with minimal latency, (b) edge runtime is NOT available in `proxy.ts`
 * per the Next.js 16 upgrade guide, and (c) `middleware.ts` is still fully
 * supported — only the name is deprecated.
 *
 * Design (from PRD B-1):
 *   - OPTIMISTIC gate: we can't call auth() / Prisma in the edge runtime.
 *     We check for the Auth.js session cookie; if present we pass through
 *     (an expired/forged cookie is caught later by the real seam in RSC).
 *   - Session cookie names (per @auth/core):
 *       HTTP  → `authjs.session-token`
 *       HTTPS → `__Secure-authjs.session-token`
 *   - Public paths bypass the cookie check entirely (see route-access.ts).
 *   - Redirect carries ?next= so /signin can restore the original destination.
 *
 * E-2 design:
 *   - Per-IP rate limiting via Upstash Redis (sliding window).
 *   - The rate-limit block MUST come before isPublicPath() because /oauth/*
 *     and /api/auth/* are public paths that would short-circuit before the
 *     rate-limit check could run.
 *   - Fail-open: limiter is a no-op when UPSTASH_REDIS_REST_URL/TOKEN are
 *     unset (local dev / preview). Redis errors also fail open — the limiter
 *     is never an availability single-point-of-failure.
 *   - /api/mcp is NOT rate-limited here — that limit is per-userId and lives
 *     in the route handler after resolveUserIdFromToken resolves.
 *
 * NO next-auth import — this file must stay edge-safe (no Prisma, no DB).
 */

import { NextRequest, NextResponse } from "next/server";
import { isPublicPath } from "@/lib/auth/route-access";
import {
  getClientIp,
  checkRateLimit,
  oauthRateLimitResponse,
  plainRateLimitResponse,
} from "@/lib/rate-limit";

export async function middleware(req: NextRequest): Promise<NextResponse | Response> {
  const { pathname, search } = req.nextUrl;

  // ── E-2: Per-IP rate limiting ─────────────────────────────────────────────
  //
  // This block MUST come before isPublicPath() because /oauth/* and
  // /api/auth/* are public paths that would otherwise short-circuit at
  // NextResponse.next() before the rate-limit check could run.
  //
  // Skip OPTIONS (CORS preflight): rate-limiting a preflight breaks the
  // browser's CORS handshake for the subsequent real request. The /oauth/*
  // routes each export a separate OPTIONS handler; let them through.
  //
  // Path-guard ensures Upstash is only called for the ~3 sensitive path
  // families — no latency tax on normal page navigations.
  //
  // /api/mcp is intentionally excluded here: per-userId limiting is handled
  // in the route handler after resolveUserIdFromToken resolves (nodejs only).
  if (req.method !== "OPTIONS") {
    const ip = getClientIp(req.headers);

    if (pathname.startsWith("/oauth/register")) {
      // /oauth/register gets TWO independent sliding-window buckets:
      //   1. oauth: 10 req/min  (shared with all /oauth/* paths)
      //   2. register-hour: 5 req/hr (extra DoS-via-cap guard — E-3 gap)
      //
      // Run both in parallel to avoid a double round-trip. Per DA FIX-REQUIRED-1:
      // when EITHER bucket is exhausted, return the MAX Retry-After so the
      // client is told the correct time to wait before BOTH limits clear.
      const [minResult, hrResult] = await Promise.all([
        checkRateLimit("oauth", ip),
        checkRateLimit("register-hour", ip),
      ]);
      if (!minResult.ok || !hrResult.ok) {
        return oauthRateLimitResponse(
          Math.max(minResult.retryAfterSeconds, hrResult.retryAfterSeconds),
        );
      }
    } else if (pathname.startsWith("/oauth/")) {
      // /oauth/token, /oauth/authorize, /oauth/revoke, and any future /oauth/*
      // paths share the 10 req/min per-IP bucket.
      const result = await checkRateLimit("oauth", ip);
      if (!result.ok) return oauthRateLimitResponse(result.retryAfterSeconds);
    } else if (pathname.startsWith("/api/auth/signin")) {
      // ONLY /api/auth/signin* is throttled (5 req/hr per IP).
      // /api/auth/callback, /session, /csrf, /providers, /signout are
      // intentionally excluded — throttling those would break the OAuth
      // callback flow and Auth.js session polling.
      //
      // Note: the real Google sign-in flow (server action → signInWithGoogle)
      // posts to /signin (the page) and never hits /api/auth/signin*. This
      // throttle is defense-in-depth against direct scripted probing only.
      const result = await checkRateLimit("signin-hour", ip);
      if (!result.ok) return plainRateLimitResponse(result.retryAfterSeconds);
    }
  }

  // ── Public paths always allowed ───────────────────────────────────────────
  if (isPublicPath(pathname)) {
    const res = NextResponse.next();
    // C-2: Frame-busting headers for the OAuth consent screen.
    // Prevents clickjacking on the Allow/Deny buttons.
    // Set here (in middleware) because Next.js 16 RSC pages cannot set
    // arbitrary response headers directly.
    if (pathname === "/oauth/authorize") {
      res.headers.set("X-Frame-Options", "DENY");
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
    }
    return res;
  }

  // ── Optimistic session-cookie gate (HTTP or HTTPS variant) ───────────────
  const hasSession =
    req.cookies.has("authjs.session-token") ||
    req.cookies.has("__Secure-authjs.session-token");

  if (hasSession) {
    return NextResponse.next();
  }

  // No session cookie → redirect to /signin with original path preserved.
  const next = encodeURIComponent(pathname + search);
  const signinUrl = new URL(`/signin?next=${next}`, req.url);
  return NextResponse.redirect(signinUrl, 307);
}

export const config = {
  /*
   * Run middleware on ALL paths EXCEPT:
   *   - _next/       Next.js internals (static files, image optimisation, RSC data)
   *   - favicon      browser favicon (favicon.ico, favicon.png, …)
   *   - icon         PWA / browser icon (icon.png, icon-192.png, …)
   *   - apple-       Apple touch icons (apple-touch-icon.png, …)
   *   - manifest.webmanifest  PWA manifest
   *   - zxing/       barcode-scanner WASM assets
   *   - Any path whose last segment ends with a file extension
   *     (catches .css, .js, .png, .woff2, .map, etc.)
   *
   * Correctness is enforced by isPublicPath; this matcher is purely a
   * performance guard so middleware never even runs on static assets.
   */
  matcher: [
    "/((?!_next/|favicon|icon|apple-|manifest\\.webmanifest$|zxing/)(?!.*\\.[a-zA-Z0-9]{1,10}(?:\\?.*)?$).*)",
  ],
};
