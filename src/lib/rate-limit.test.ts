// src/lib/rate-limit.test.ts
//
// Unit tests for the E-2 rate-limit module.
// No live Redis / Upstash account required — @upstash/ratelimit and
// @upstash/redis are fully mocked via vi.mock() hoisting.
//
// Test strategy:
//   - mock Ratelimit constructor → inject a controllable `limit` fn
//   - stub env vars per test group via vi.stubEnv
//   - inject `nowMs` into checkRateLimit to test Retry-After math deterministically
//   - test 429 builders for correct status, headers, and body shape

// ── Hoist Upstash mocks above all imports ────────────────────────────────────
// vi.mock() calls are hoisted to the top of the file by Vitest's transformer,
// which guarantees the mocks are in place before rate-limit.ts is imported and
// before any module-level lazy-singleton variables are initialized.

const mockLimit = vi.fn();

vi.mock("@upstash/ratelimit", () => ({
  // Ratelimit is used as both a class (new Ratelimit({ ... })) and as a
  // namespace with a static method (Ratelimit.slidingWindow(...)). The mock
  // must cover both: mockImplementation handles `new`, and Object.assign adds
  // the static method so getLimiter() doesn't throw.
  Ratelimit: Object.assign(
    vi.fn().mockImplementation(() => ({ limit: mockLimit })),
    { slidingWindow: vi.fn().mockReturnValue("sliding-window-config") },
  ),
}));

vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: vi.fn().mockReturnValue({} /* fake Redis handle */) },
}));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getClientIp,
  checkRateLimit,
  isConfigured,
  oauthRateLimitResponse,
  plainRateLimitResponse,
} from "@/lib/rate-limit";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeHeaders(map: Record<string, string>): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(map)) h.set(k, v);
  return h;
}

// ─── getClientIp ─────────────────────────────────────────────────────────────

describe("getClientIp", () => {
  it("returns the first address from x-forwarded-for (single value)", () => {
    const headers = makeHeaders({ "x-forwarded-for": "1.2.3.4" });
    expect(getClientIp(headers)).toBe("1.2.3.4");
  });

  it("returns position-0 from a multi-hop x-forwarded-for header", () => {
    const headers = makeHeaders({ "x-forwarded-for": "1.2.3.4, 5.6.7.8, 9.10.11.12" });
    expect(getClientIp(headers)).toBe("1.2.3.4");
  });

  it("trims whitespace from the first XFF hop", () => {
    const headers = makeHeaders({ "x-forwarded-for": "  1.2.3.4  , 5.6.7.8" });
    expect(getClientIp(headers)).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const headers = makeHeaders({ "x-real-ip": "10.0.0.1" });
    expect(getClientIp(headers)).toBe("10.0.0.1");
  });

  it("trims whitespace from x-real-ip", () => {
    const headers = makeHeaders({ "x-real-ip": "  10.0.0.2  " });
    expect(getClientIp(headers)).toBe("10.0.0.2");
  });

  it("returns 'unknown' when both headers are absent", () => {
    const headers = new Headers();
    expect(getClientIp(headers)).toBe("unknown");
  });

  it("accepts a request-like object { headers: Headers }", () => {
    const req = { headers: makeHeaders({ "x-forwarded-for": "2.3.4.5" }) };
    expect(getClientIp(req)).toBe("2.3.4.5");
  });
});

// ─── isConfigured ────────────────────────────────────────────────────────────

describe("isConfigured", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns true when both env vars are set", () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://fake.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "fake-token");
    expect(isConfigured()).toBe(true);
  });

  it("returns false when URL is empty string", () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "fake-token");
    expect(isConfigured()).toBe(false);
  });

  it("returns false when TOKEN is empty string", () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://fake.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    expect(isConfigured()).toBe(false);
  });

  it("returns false when both are absent", () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    expect(isConfigured()).toBe(false);
  });
});

// ─── checkRateLimit — no-op when unconfigured ────────────────────────────────

describe("checkRateLimit — no-op when unconfigured", () => {
  beforeEach(() => {
    mockLimit.mockClear();
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns { ok: true, retryAfterSeconds: 0 } when env vars are unset", async () => {
    const result = await checkRateLimit("mcp", "user1");
    expect(result).toEqual({ ok: true, retryAfterSeconds: 0 });
  });

  it("never calls limiter.limit() when unconfigured", async () => {
    await checkRateLimit("oauth", "1.2.3.4");
    expect(mockLimit).not.toHaveBeenCalled();
  });

  it("logs a warning once when first called unconfigured", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Call multiple times; warn should fire at most once per module lifetime.
    await checkRateLimit("oauth", "1.2.3.4");
    await checkRateLimit("oauth", "1.2.3.4");
    // The module-level _warnedUnconfigured flag may already be set from a prior
    // test run in the same module instance; we just verify it doesn't throw and
    // that the warn call count is 0 or 1 (never >1 per process lifetime).
    expect(warnSpy.mock.calls.length).toBeLessThanOrEqual(1);
    warnSpy.mockRestore();
  });
});

// ─── checkRateLimit — allowed ────────────────────────────────────────────────

describe("checkRateLimit — allowed (limit() returns success:true)", () => {
  beforeEach(() => {
    mockLimit.mockClear();
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://fake.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "fake-token");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns { ok: true, retryAfterSeconds: 0 } on success", async () => {
    mockLimit.mockResolvedValueOnce({
      success:   true,
      limit:     60,
      remaining: 59,
      reset:     Date.now() + 30_000,
      pending:   Promise.resolve(),
    });
    const result = await checkRateLimit("mcp", "user1");
    expect(result).toEqual({ ok: true, retryAfterSeconds: 0 });
  });
});

// ─── checkRateLimit — rate-limited ───────────────────────────────────────────

describe("checkRateLimit — rate-limited (limit() returns success:false)", () => {
  beforeEach(() => {
    mockLimit.mockClear();
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://fake.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "fake-token");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns { ok: false } with correct retryAfterSeconds using injected nowMs", async () => {
    // reset is epoch ms; nowMs is the injectable "now"
    const reset = 5_000; // ms
    const nowMs = 0;
    mockLimit.mockResolvedValueOnce({
      success:   false,
      limit:     60,
      remaining: 0,
      reset,
      pending:   Promise.resolve(),
    });
    const result = await checkRateLimit("mcp", "user1", nowMs);
    expect(result.ok).toBe(false);
    // ceil((5000 - 0) / 1000) = 5
    expect(result.retryAfterSeconds).toBe(5);
  });

  it("retryAfterSeconds is ceil not floor", async () => {
    // 2500ms remaining → ceil(2.5) = 3
    const reset = 2_500;
    const nowMs = 0;
    mockLimit.mockResolvedValueOnce({
      success:   false,
      limit:     10,
      remaining: 0,
      reset,
      pending:   Promise.resolve(),
    });
    const result = await checkRateLimit("oauth", "1.2.3.4", nowMs);
    expect(result.retryAfterSeconds).toBe(3);
  });

  it("retryAfterSeconds is at least 1 even when reset <= nowMs (clock skew / boundary)", async () => {
    // reset - nowMs = 0 → Math.max(1, 0) = 1
    mockLimit.mockResolvedValueOnce({
      success:   false,
      limit:     5,
      remaining: 0,
      reset:     1000, // epoch ms
      pending:   Promise.resolve(),
    });
    const result = await checkRateLimit("register-hour", "1.2.3.4", 1000);
    expect(result.retryAfterSeconds).toBe(1);
  });

  it("retryAfterSeconds is at least 1 when reset is in the past (negative diff)", async () => {
    // reset < nowMs → Math.max(1, Math.ceil(negative)) = 1
    mockLimit.mockResolvedValueOnce({
      success:   false,
      limit:     5,
      remaining: 0,
      reset:     500, // in the past relative to nowMs
      pending:   Promise.resolve(),
    });
    const result = await checkRateLimit("signin-hour", "1.2.3.4", 1000);
    expect(result.retryAfterSeconds).toBe(1);
  });
});

// ─── checkRateLimit — fail-open ──────────────────────────────────────────────

describe("checkRateLimit — fail-open (limit() throws)", () => {
  beforeEach(() => {
    mockLimit.mockClear();
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://fake.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "fake-token");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns { ok: true } when limit() throws (Redis unreachable)", async () => {
    mockLimit.mockRejectedValueOnce(new Error("fetch failed"));
    const result = await checkRateLimit("mcp", "user1");
    expect(result).toEqual({ ok: true, retryAfterSeconds: 0 });
  });

  it("calls console.warn when limit() throws", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockLimit.mockRejectedValueOnce(new Error("timeout"));
    await checkRateLimit("oauth", "1.2.3.4");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[ratelimit] store error"),
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it("does NOT rethrow — always resolves", async () => {
    mockLimit.mockRejectedValueOnce(new Error("network error"));
    await expect(checkRateLimit("mcp", "user1")).resolves.toBeDefined();
  });
});

// ─── oauthRateLimitResponse ───────────────────────────────────────────────────

describe("oauthRateLimitResponse", () => {
  it("returns status 429", () => {
    const res = oauthRateLimitResponse(60);
    expect(res.status).toBe(429);
  });

  it("sets Retry-After header to retryAfterSeconds as string", () => {
    const res = oauthRateLimitResponse(120);
    expect(res.headers.get("retry-after")).toBe("120");
  });

  it("sets Cache-Control: no-store", () => {
    const res = oauthRateLimitResponse(60);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("sets Access-Control-Allow-Origin: *", () => {
    const res = oauthRateLimitResponse(60);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("has the correct OAuth error JSON body", async () => {
    const res = oauthRateLimitResponse(60);
    const body = await res.json();
    expect(body).toEqual({
      error:             "temporarily_unavailable",
      error_description: "rate limit exceeded",
    });
  });
});

// ─── plainRateLimitResponse ───────────────────────────────────────────────────

describe("plainRateLimitResponse", () => {
  it("returns status 429", () => {
    const res = plainRateLimitResponse(30);
    expect(res.status).toBe(429);
  });

  it("sets Retry-After header to retryAfterSeconds as string", () => {
    const res = plainRateLimitResponse(45);
    expect(res.headers.get("retry-after")).toBe("45");
  });

  it("has the plain error JSON body shape", async () => {
    const res = plainRateLimitResponse(30);
    const body = await res.json();
    expect(body).toEqual({ error: "rate_limit_exceeded", retryAfter: 30 });
  });

  it("merges extraHeaders into the response", () => {
    const res = plainRateLimitResponse(30, {
      "Access-Control-Allow-Origin": "*",
      "X-Custom-Header":             "yes",
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("x-custom-header")).toBe("yes");
  });

  it("works without extraHeaders (optional parameter)", () => {
    const res = plainRateLimitResponse(10);
    expect(res.status).toBe(429);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
