// src/lib/oauth/tokens.test.ts
//
// Unit tests for C-1 OAuth token helpers (tokens.ts).
// Pure module — no DB, no imports to mock.

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  generateSecret,
  hashSecret,
  pkceChallengeFromVerifier,
  timingSafeEqualStr,
  ACCESS_TOKEN_TTL_S,
  REFRESH_TOKEN_TTL_S,
  AUTH_CODE_TTL_S,
  OAUTH_SCOPE,
  deriveOrigin,
  originFromHeaders,
} from "@/lib/oauth/tokens";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("generateSecret", () => {
  it("returns a string starting with the given prefix followed by underscore", () => {
    const s = generateSecret("mcp");
    expect(s.startsWith("mcp_")).toBe(true);
  });

  it("includes 43 base64url chars after the prefix (32 random bytes)", () => {
    // 32 bytes → 43 base64url chars (no padding)
    const s = generateSecret("mcp");
    const payload = s.slice("mcp_".length);
    expect(payload).toHaveLength(43);
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("returns different values on each call (random)", () => {
    const a = generateSecret("at");
    const b = generateSecret("at");
    expect(a).not.toBe(b);
  });

  it("honours an arbitrary prefix", () => {
    const s = generateSecret("rt");
    expect(s.startsWith("rt_")).toBe(true);
  });
});

describe("hashSecret", () => {
  it("returns a 64-char lowercase hex string (SHA-256)", () => {
    const h = hashSecret("hello");
    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same input → same output", () => {
    const s = "some-secret-value";
    expect(hashSecret(s)).toBe(hashSecret(s));
  });

  it("is stable (known vector: SHA-256 of 'hello')", () => {
    // SHA-256("hello") = 2cf24dba…
    expect(hashSecret("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("round-trip: hashSecret(plaintext) !== hashSecret(hashSecret(plaintext))", () => {
    // i.e. it is NOT idempotent — hashing the hash gives a different value
    const plain = "test-secret";
    const once = hashSecret(plain);
    const twice = hashSecret(once);
    expect(once).not.toBe(twice);
  });

  it("two different secrets produce different hashes", () => {
    const a = generateSecret("mcp");
    const b = generateSecret("mcp");
    expect(hashSecret(a)).not.toBe(hashSecret(b));
  });
});

describe("TTL constants", () => {
  it("ACCESS_TOKEN_TTL_S = 3600 (1 hour)", () => {
    expect(ACCESS_TOKEN_TTL_S).toBe(3600);
  });

  it("REFRESH_TOKEN_TTL_S = 2592000 (30 days)", () => {
    expect(REFRESH_TOKEN_TTL_S).toBe(30 * 24 * 3600);
  });

  it("AUTH_CODE_TTL_S = 300 (5 minutes)", () => {
    expect(AUTH_CODE_TTL_S).toBe(300);
  });

  it("OAUTH_SCOPE = 'mcp'", () => {
    expect(OAUTH_SCOPE).toBe("mcp");
  });
});

describe("pkceChallengeFromVerifier", () => {
  it("produces base64url output with no padding characters", () => {
    const challenge = pkceChallengeFromVerifier("some-verifier-string");
    expect(challenge).not.toContain("=");
    expect(challenge).not.toContain("+");
    expect(challenge).not.toContain("/");
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("RFC 7636 Appendix B known-answer test vector", () => {
    // Normative test vector from RFC 7636 Appendix B:
    //   code_verifier  = dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
    //   code_challenge = E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const expectedChallenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
    expect(pkceChallengeFromVerifier(verifier)).toBe(expectedChallenge);
  });

  it("is deterministic — same verifier → same challenge", () => {
    const v = "my-secret-verifier-value";
    expect(pkceChallengeFromVerifier(v)).toBe(pkceChallengeFromVerifier(v));
  });

  it("different verifiers produce different challenges", () => {
    expect(pkceChallengeFromVerifier("verifier-a")).not.toBe(
      pkceChallengeFromVerifier("verifier-b"),
    );
  });
});

describe("timingSafeEqualStr", () => {
  it("returns true for identical strings", () => {
    expect(timingSafeEqualStr("hello", "hello")).toBe(true);
  });

  it("returns false for different strings of same length", () => {
    expect(timingSafeEqualStr("hello", "world")).toBe(false);
  });

  it("returns false for strings of different lengths — no throw (length-guard)", () => {
    // timingSafeEqual would throw RangeError without the length guard.
    // DA revision: length-guard is MANDATORY.
    expect(() => timingSafeEqualStr("short", "much-longer-string-here")).not.toThrow();
    expect(timingSafeEqualStr("short", "much-longer-string-here")).toBe(false);
  });

  it("returns false for empty vs non-empty string", () => {
    expect(timingSafeEqualStr("", "nonempty")).toBe(false);
  });

  it("returns true for two empty strings", () => {
    expect(timingSafeEqualStr("", "")).toBe(true);
  });

  it("works correctly for typical token values (base64url length 43)", () => {
    const token = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(timingSafeEqualStr(token, token)).toBe(true);
    expect(timingSafeEqualStr(token, token.slice(0, -1) + "X")).toBe(false);
  });
});

describe("deriveOrigin", () => {
  function makeReq(url: string): Request {
    return new Request(url);
  }

  it("returns the request origin when CANONICAL_ORIGIN is unset", () => {
    vi.stubEnv("CANONICAL_ORIGIN", "");
    const origin = deriveOrigin(makeReq("http://localhost:3000/api/mcp"));
    expect(origin).toBe("http://localhost:3000");
  });

  it("returns the request origin including port", () => {
    vi.stubEnv("CANONICAL_ORIGIN", "");
    const origin = deriveOrigin(makeReq("https://preview-123.vercel.app/api/mcp"));
    expect(origin).toBe("https://preview-123.vercel.app");
  });

  it("uses CANONICAL_ORIGIN when set, ignoring the request URL", () => {
    vi.stubEnv("CANONICAL_ORIGIN", "https://goaldmine.com");
    const origin = deriveOrigin(makeReq("https://preview-abc.vercel.app/api/mcp"));
    expect(origin).toBe("https://goaldmine.com");
  });

  it("strips trailing slash from CANONICAL_ORIGIN", () => {
    vi.stubEnv("CANONICAL_ORIGIN", "https://goaldmine.com/");
    const origin = deriveOrigin(makeReq("https://goaldmine.com/api/mcp"));
    expect(origin).toBe("https://goaldmine.com");
  });

  it("strips multiple trailing slashes from CANONICAL_ORIGIN", () => {
    vi.stubEnv("CANONICAL_ORIGIN", "https://goaldmine.com///");
    const origin = deriveOrigin(makeReq("https://goaldmine.com/api/mcp"));
    expect(origin).toBe("https://goaldmine.com");
  });
});

describe("originFromHeaders", () => {
  function makeHeaders(entries: Record<string, string>): Headers {
    const h = new Headers();
    for (const [k, v] of Object.entries(entries)) h.set(k, v);
    return h;
  }

  it("CANONICAL_ORIGIN wins — trailing slash stripped", () => {
    vi.stubEnv("CANONICAL_ORIGIN", "https://goaldmine.com/");
    const h = makeHeaders({
      "x-forwarded-proto": "https",
      host: "preview-abc.vercel.app",
    });
    expect(originFromHeaders(h)).toBe("https://goaldmine.com");
  });

  it("CANONICAL_ORIGIN wins over header values (env precedence)", () => {
    vi.stubEnv("CANONICAL_ORIGIN", "https://goaldmine.com");
    const h = makeHeaders({ "x-forwarded-proto": "http", host: "localhost:3000" });
    expect(originFromHeaders(h)).toBe("https://goaldmine.com");
  });

  it("header fallback when CANONICAL_ORIGIN unset — https preview", () => {
    vi.stubEnv("CANONICAL_ORIGIN", "");
    const h = makeHeaders({
      "x-forwarded-proto": "https",
      host: "abc.vercel.app",
    });
    expect(originFromHeaders(h)).toBe("https://abc.vercel.app");
  });

  it("header fallback when CANONICAL_ORIGIN unset — no headers (localhost default)", () => {
    vi.stubEnv("CANONICAL_ORIGIN", "");
    expect(originFromHeaders(new Headers())).toBe("http://localhost:3000");
  });
});
