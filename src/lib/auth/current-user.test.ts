// src/lib/auth/current-user.test.ts
// Regression guard for the Phase-1 current-user seam (A-2) and the C-3a
// token-resolution swap (resolveUserIdFromToken → per-user OAuth + legacy fallback).
//
// React.cache behavior in vitest/Node.js:
//   React 19 development build (react.cjs/react.development.js line 917):
//     exports.cache = function (fn) { return function () { return fn.apply(null, arguments); }; }
//   It is a transparent pass-through outside an RSC render context. No memoization
//   occurs within or between test cases — each getCurrentUserId() call invokes auth() fresh.

import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock() calls are hoisted before imports by vitest — mocks are in place
// when @/lib/auth/current-user is first imported below.
vi.mock("@/lib/auth/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string): never => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

// Mock @/lib/db for resolveUserIdFromToken (it uses dynamic import internally,
// which vitest intercepts via vi.mock just like static imports).
vi.mock("@/lib/db", () => ({
  prisma: {
    oAuthAccessToken: {
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

import { getCurrentUserId, resolveUserIdFromToken } from "@/lib/auth/current-user";
import { FOUNDER_USER_ID } from "@/lib/auth/founder";
import { auth } from "@/lib/auth/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";

const mockAuth = vi.mocked(auth);
const mockRedirect = vi.mocked(redirect);
const mockFindUnique = vi.mocked(prisma.oAuthAccessToken.findUnique);
// update is fire-and-forget — we just need it to return a Promise (already set in factory)

// ---------------------------------------------------------------------------
// resolveUserIdFromToken — C-3a per-user OAuth + legacy fallback
// ---------------------------------------------------------------------------
describe("resolveUserIdFromToken — C-3a per-user + legacy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    // Default: update is always a no-op resolved Promise (fire-and-forget)
    vi.mocked(prisma.oAuthAccessToken.update).mockResolvedValue({} as never);
  });

  it("(a) valid token: returns userId for an active, non-expired, non-revoked access token", async () => {
    mockFindUnique.mockResolvedValueOnce({
      userId: "usr_alice",
      expiresAt: new Date(Date.now() + 3600 * 1000),
      revokedAt: null,
    } as never);

    const result = await resolveUserIdFromToken("mcpa_somevalidtoken");
    expect(result).toBe("usr_alice");
  });

  it("(b) expired token: returns null when expiresAt is in the past", async () => {
    mockFindUnique.mockResolvedValueOnce({
      userId: "usr_alice",
      expiresAt: new Date(Date.now() - 1), // expired by 1ms
      revokedAt: null,
    } as never);

    expect(await resolveUserIdFromToken("mcpa_expiredtoken")).toBeNull();
  });

  it("(c) revoked token: returns null when revokedAt is set", async () => {
    mockFindUnique.mockResolvedValueOnce({
      userId: "usr_alice",
      expiresAt: new Date(Date.now() + 3600 * 1000),
      revokedAt: new Date(), // revoked now
    } as never);

    expect(await resolveUserIdFromToken("mcpa_revokedtoken")).toBeNull();
  });

  it("(d) unknown token: returns null when no DB row found", async () => {
    mockFindUnique.mockResolvedValueOnce(null as never);

    expect(await resolveUserIdFromToken("unknown_token_xyz")).toBeNull();
  });

  it("(e) legacy ON + matching MCP_AUTH_TOKEN: returns FOUNDER_USER_ID", async () => {
    vi.stubEnv("ALLOW_LEGACY_MCP_TOKEN", "true");
    vi.stubEnv("MCP_AUTH_TOKEN", "legacy_secret_abc");
    mockFindUnique.mockResolvedValueOnce(null as never); // not a valid OAuth token

    expect(await resolveUserIdFromToken("legacy_secret_abc")).toBe(FOUNDER_USER_ID);
  });

  it("(f) legacy ON but token mismatch: returns null", async () => {
    vi.stubEnv("ALLOW_LEGACY_MCP_TOKEN", "true");
    vi.stubEnv("MCP_AUTH_TOKEN", "legacy_secret_abc");
    mockFindUnique.mockResolvedValueOnce(null as never);

    expect(await resolveUserIdFromToken("wrong_token")).toBeNull();
  });

  it("(g) legacy OFF (flag unset): returns null even if token matches MCP_AUTH_TOKEN", async () => {
    // ALLOW_LEGACY_MCP_TOKEN not set
    vi.stubEnv("MCP_AUTH_TOKEN", "legacy_secret_abc");
    mockFindUnique.mockResolvedValueOnce(null as never);

    expect(await resolveUserIdFromToken("legacy_secret_abc")).toBeNull();
  });

  it("(h) legacy flag=false: returns null", async () => {
    vi.stubEnv("ALLOW_LEGACY_MCP_TOKEN", "false");
    vi.stubEnv("MCP_AUTH_TOKEN", "legacy_secret_abc");
    mockFindUnique.mockResolvedValueOnce(null as never);

    expect(await resolveUserIdFromToken("legacy_secret_abc")).toBeNull();
  });

  it("(i) valid OAuth token takes precedence over legacy flag (does NOT fall through)", async () => {
    vi.stubEnv("ALLOW_LEGACY_MCP_TOKEN", "true");
    vi.stubEnv("MCP_AUTH_TOKEN", "some_other_token");
    mockFindUnique.mockResolvedValueOnce({
      userId: "usr_bob",
      expiresAt: new Date(Date.now() + 3600 * 1000),
      revokedAt: null,
    } as never);

    const result = await resolveUserIdFromToken("mcpa_validoauthtoken");
    expect(result).toBe("usr_bob");
    expect(result).not.toBe(FOUNDER_USER_ID);
  });
});

// ---------------------------------------------------------------------------
// getCurrentUserId — Phase-1: reads Auth.js session (UNCHANGED)
// ---------------------------------------------------------------------------
describe("getCurrentUserId — Phase-1 reads Auth.js session", () => {
  beforeEach(() => {
    // Clear call counts between tests; implementations are preserved
    // (vi.clearAllMocks does NOT reset mockImplementation/mockReturnValue).
    vi.clearAllMocks();
  });

  it("(a) returns session.user.id when a valid session is present", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce({ user: { id: "usr_x" } } as any);
    expect(await getCurrentUserId()).toBe("usr_x");
  });

  it("(b) calls redirect('/signin') and throws when session is null", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce(null as any);
    await expect(getCurrentUserId()).rejects.toThrow("NEXT_REDIRECT:/signin");
    expect(mockRedirect).toHaveBeenCalledWith("/signin");
  });

  it("(c) returns the session user id and NEVER the founder id for a different user", async () => {
    // Never-silent-founder assertion: the seam must not fall back to FOUNDER_USER_ID
    // when a real session exists for a different user.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockAuth.mockResolvedValueOnce({ user: { id: "usr_someone_else" } } as any);
    const result = await getCurrentUserId();
    expect(result).toBe("usr_someone_else");
    expect(result).not.toBe(FOUNDER_USER_ID);
  });
});
