/**
 * E-2: Edge-safe rate-limit module.
 *
 * Importable from BOTH edge middleware (src/middleware.ts) AND
 * nodejs route handlers (src/app/api/mcp/route.ts).
 *
 * Edge-safety contract:
 *   - Only @upstash/ratelimit + @upstash/redis + Web APIs.
 *   - NO Prisma, NO node:*, NO next/server.
 *   - All Redis/Ratelimit construction is lazy (never at import time).
 *
 * Fail-open invariants:
 *   - Env vars absent (local dev / preview) → isConfigured() false → no-op.
 *   - Redis/limit() throws at runtime → caught → allow request + console.warn.
 *   - The module NEVER causes a 500; it either rate-limits or allows.
 */

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Named limit constants shared by implementation + tests.
 * Call sites import these rather than hard-coding numbers.
 */
export const RATE_LIMITS = {
  mcp:          { requests: 60, window: "1 m" as const },  // per userId
  oauth:        { requests: 10, window: "1 m" as const },  // per IP, all /oauth/*
  registerHour: { requests: 5,  window: "1 h" as const },  // per IP, /oauth/register extra bucket
  signinHour:   { requests: 5,  window: "1 h" as const },  // per IP, /api/auth/signin*
  accessRequestHour: { requests: 5, window: "1 h" as const }, // per IP, /request-access form
  invitePreviewHour: { requests: 20, window: "1 h" as const }, // per IP, previewInviteCode advisory action
} as const;

export type Bucket =
  | "mcp"
  | "oauth"
  | "register-hour"
  | "signin-hour"
  | "access-request-hour"
  | "invite-preview-hour";

// ─── isConfigured ─────────────────────────────────────────────────────────────

/**
 * Returns true iff BOTH Upstash env vars are present (non-empty strings).
 * When false, checkRateLimit is a no-op that always allows.
 */
export function isConfigured(): boolean {
  return !!(
    process.env.UPSTASH_REDIS_REST_URL &&
    process.env.UPSTASH_REDIS_REST_TOKEN
  );
}

// ─── Lazy singleton instances ─────────────────────────────────────────────────
//
// `undefined` = not yet initialized. Construction happens on first
// checkRateLimit() call, never at module import time. This keeps the module
// safe to import when env vars are absent (local dev without Upstash).
//
// Key structure in Redis: "<prefix>:<key>"
//   Bucket      Prefix        Key          → Redis key
//   mcp         rl:mcp        <userId>     → rl:mcp:<userId>
//   oauth       rl:oauth      <ip>         → rl:oauth:<ip>
//   register-hr rl:rhr        <ip>         → rl:rhr:<ip>
//   signin-hr   rl:shr        <ip>         → rl:shr:<ip>
//   access-req-hr rl:arhr     <ip>         → rl:arhr:<ip>
//   invite-preview-hr rl:iph  <ip>         → rl:iph:<ip>
//
// ephemeralCache is omitted: serverless/edge workers start cold each request
// so an in-process LRU provides no benefit.

let _redis: Redis | undefined;

function getRedis(): Redis {
  if (!_redis) _redis = Redis.fromEnv();
  return _redis;
}

let _mcpLimiter:          Ratelimit | undefined;
let _oauthLimiter:        Ratelimit | undefined;
let _registerHourLimiter: Ratelimit | undefined;
let _signinLimiter:       Ratelimit | undefined;
let _accessRequestHourLimiter: Ratelimit | undefined;
let _invitePreviewHourLimiter: Ratelimit | undefined;

function getLimiter(bucket: Bucket): Ratelimit {
  switch (bucket) {
    case "mcp":
      if (!_mcpLimiter)
        _mcpLimiter = new Ratelimit({
          redis:   getRedis(),
          limiter: Ratelimit.slidingWindow(
            RATE_LIMITS.mcp.requests,
            RATE_LIMITS.mcp.window,
          ),
          prefix: "rl:mcp",
        });
      return _mcpLimiter;

    case "oauth":
      if (!_oauthLimiter)
        _oauthLimiter = new Ratelimit({
          redis:   getRedis(),
          limiter: Ratelimit.slidingWindow(
            RATE_LIMITS.oauth.requests,
            RATE_LIMITS.oauth.window,
          ),
          prefix: "rl:oauth",
        });
      return _oauthLimiter;

    case "register-hour":
      if (!_registerHourLimiter)
        _registerHourLimiter = new Ratelimit({
          redis:   getRedis(),
          limiter: Ratelimit.slidingWindow(
            RATE_LIMITS.registerHour.requests,
            RATE_LIMITS.registerHour.window,
          ),
          prefix: "rl:rhr",
        });
      return _registerHourLimiter;

    case "signin-hour":
      if (!_signinLimiter)
        _signinLimiter = new Ratelimit({
          redis:   getRedis(),
          limiter: Ratelimit.slidingWindow(
            RATE_LIMITS.signinHour.requests,
            RATE_LIMITS.signinHour.window,
          ),
          prefix: "rl:shr",
        });
      return _signinLimiter;

    case "access-request-hour":
      if (!_accessRequestHourLimiter)
        _accessRequestHourLimiter = new Ratelimit({
          redis:   getRedis(),
          limiter: Ratelimit.slidingWindow(
            RATE_LIMITS.accessRequestHour.requests,
            RATE_LIMITS.accessRequestHour.window,
          ),
          prefix: "rl:arhr",
        });
      return _accessRequestHourLimiter;

    case "invite-preview-hour":
      if (!_invitePreviewHourLimiter)
        _invitePreviewHourLimiter = new Ratelimit({
          redis:   getRedis(),
          limiter: Ratelimit.slidingWindow(
            RATE_LIMITS.invitePreviewHour.requests,
            RATE_LIMITS.invitePreviewHour.window,
          ),
          prefix: "rl:iph",
        });
      return _invitePreviewHourLimiter;
  }
}

// ─── Warn-once flag ───────────────────────────────────────────────────────────
// Module-level; avoids log spam on every request in dev/preview.
// In edge: persists across warm-reuse requests within one worker.
// In nodejs: persists for process lifetime. Both behaviors are correct.
let _warnedUnconfigured = false;

// ─── getClientIp ──────────────────────────────────────────────────────────────
//
// Accepts a plain Headers object or any request-like object with a .headers
// property (covers both NextRequest and plain Request).
//
// Vercel edge: the real client IP is prepended at position 0 in
// x-forwarded-for — Vercel's proxy is authoritative; position 0 is
// trustworthy and consistent with the XFF trust in src/lib/oauth/tokens.ts.
// (Note: outside Vercel, x-forwarded-for[0] is client-controlled. Since the
// limiter is a no-op without env vars, this only matters in production where
// Vercel's trusted proxy is always present.)
//
// "unknown" fallback: all such requests share one bucket — acceptable (rare
// on Vercel; better than skipping the check or crashing).

export function getClientIp(headersOrReq: Headers | { headers: Headers }): string {
  const headers =
    headersOrReq instanceof Headers ? headersOrReq : headersOrReq.headers;

  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0].trim();
    if (first) return first;
  }

  const xri = headers.get("x-real-ip");
  if (xri?.trim()) return xri.trim();

  return "unknown";
}

// ─── checkRateLimit ───────────────────────────────────────────────────────────
//
// `nowMs` is injectable for deterministic testing (pass a fixed timestamp;
// defaults to Date.now()). Avoids vi.setSystemTime patching in tests.
//
// limiter.limit(key) return shape (per @upstash/ratelimit v2.x):
//   { success: boolean, limit: number, remaining: number,
//     reset: number, pending: Promise<unknown> }
//   where reset = Unix timestamp in MILLISECONDS when the sliding window resets.
//
// Retry-After = ceil((reset - nowMs) / 1000), min 1 second.
// Math.max(1, ...) clamps for clock-skew / window-boundary edge cases.

export async function checkRateLimit(
  bucket: Bucket,
  key: string,
  nowMs: number = Date.now(),
): Promise<{ ok: boolean; retryAfterSeconds: number }> {
  if (!isConfigured()) {
    if (!_warnedUnconfigured) {
      console.warn(
        "[ratelimit] UPSTASH_REDIS_REST_URL/TOKEN not set — limiter is a no-op. All requests allowed.",
      );
      _warnedUnconfigured = true;
    }
    return { ok: true, retryAfterSeconds: 0 };
  }

  try {
    const limiter = getLimiter(bucket);
    const result = await limiter.limit(key);

    if (result.success) return { ok: true, retryAfterSeconds: 0 };

    // result.reset is epoch MILLISECONDS per @upstash/ratelimit v2.x.
    // Verify this comment on upgrade: the type declaration confirms
    // "Unix timestamp in milliseconds when the limits are reset."
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((result.reset - nowMs) / 1000),
    );
    return { ok: false, retryAfterSeconds };
  } catch (e) {
    console.warn("[ratelimit] store error, failing open:", e);
    return { ok: true, retryAfterSeconds: 0 };
  }
}

// ─── 429 response builders ────────────────────────────────────────────────────
//
// Both return plain `Response` (Web API) — importable from edge and nodejs.
// NOT NextResponse (avoids next/server dependency, keeps the module edge-safe
// AND usable in nodejs route handlers without a framework coupling).
//
// oauthRateLimitResponse:
//   Used by middleware for /oauth/* paths. JSON body per OAuth error spec.
//   Includes Cache-Control: no-store and Access-Control-Allow-Origin: *
//   to match the pattern in src/app/oauth/{register,token,revoke}/route.ts.
//
// plainRateLimitResponse:
//   Used by /api/mcp (with explicit CORS headers from the call site via
//   extraHeaders) and middleware for /api/auth/signin* (no CORS needed;
//   signin is a same-origin browser form action).

export function oauthRateLimitResponse(retryAfterSeconds: number): Response {
  return new Response(
    JSON.stringify({
      error: "temporarily_unavailable",
      error_description: "rate limit exceeded",
    }),
    {
      status: 429,
      headers: {
        "Content-Type":                "application/json",
        "Retry-After":                 String(retryAfterSeconds),
        "Cache-Control":               "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}

export function plainRateLimitResponse(
  retryAfterSeconds: number,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify({ error: "rate_limit_exceeded", retryAfter: retryAfterSeconds }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After":  String(retryAfterSeconds),
        ...(extraHeaders ?? {}),
      },
    },
  );
}
