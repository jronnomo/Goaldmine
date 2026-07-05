/**
 * SPIKE (AS-0) — Web Push viability spike helpers.
 *
 * Throwaway file, disposable by design: no import from `oauth/` or
 * `rate-limit.ts`. Removing the spike is a single `git rm` of this file
 * plus the routes/page that import it — do not fold this into permanent
 * infra (rate-limit.ts / current-user.ts) even though the shapes rhyme.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { Redis } from "@upstash/redis";

/**
 * Fail-closed key check for the two spike API routes.
 *
 * - `SPIKE_PUSH_KEY` unset       → 503 (server misconfigured)
 * - `x-spike-key` header mismatch → 401
 * - match                        → null (caller proceeds)
 *
 * Both sides are SHA-256 hashed first so `timingSafeEqual` always receives
 * fixed-length (32-byte) buffers — no length-guard branch needed (contrast
 * `oauth/tokens.ts`'s `timingSafeEqualStr`, which guards raw-length buffers;
 * the hash-first variant is intentional here per the architecture blueprint).
 */
export function requireSpikeKey(req: Request): Response | null {
  const expected = process.env.SPIKE_PUSH_KEY;
  if (!expected) {
    return Response.json(
      { error: "server_misconfigured", message: "SPIKE_PUSH_KEY not set" },
      { status: 503 },
    );
  }

  const provided = req.headers.get("x-spike-key") ?? "";
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  if (!timingSafeEqual(a, b)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  return null;
}

/**
 * Lazy Upstash client, guarded like `rate-limit.ts`'s `getRedis()`: construct
 * only on first call, return null (not throw) when either env var is absent.
 * `Redis.fromEnv()` does not throw on missing env vars — it `console.warn`s
 * and constructs a client with undefined url/token, which would fail at the
 * first `.get()`/`.set()` call instead of at construction — so the guard
 * must happen here, before `fromEnv()` is ever called.
 */
let _redis: Redis | undefined;
export function getSpikeRedis(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  if (!_redis) _redis = Redis.fromEnv();
  return _redis;
}

// Single fixed Upstash key — no per-user subscriptions (PRD §3.3, out of scope).
export const SPIKE_SUBSCRIPTION_KEY = "spike:webpush:subscription";
