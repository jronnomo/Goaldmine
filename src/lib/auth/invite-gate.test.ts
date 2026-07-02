// src/lib/auth/invite-gate.test.ts
//
// Unit tests for the A-3 invite gate (checkInviteGate).
// Mocks @/lib/db using the dual-export convention (prisma + getDb) so no real
// database is needed. Each test controls process.env vars via vi.stubEnv.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock @/lib/db — prisma is a fake with invite + user accessors; getDb is kept as
// an empty stub so any stale import doesn't error.
vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findFirst: vi.fn(),
    },
    invite: {
      findFirst: vi.fn(),
    },
  },
  getDb: vi.fn(),
}));

import { checkInviteGate } from "@/lib/auth/invite-gate";
import { prisma } from "@/lib/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockUser = prisma.user as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockInvite = prisma.invite as any;

// Helper to build an invite-shaped object
function fakeInvite(overrides: Partial<{
  id: string;
  code: string;
  email: string | null;
  maxUses: number;
  useCount: number;
  expiresAt: Date | null;
}> = {}) {
  return {
    id: "inv_1",
    code: "abc123",
    email: null,
    maxUses: 1,
    useCount: 0,
    expiresAt: null,
    ...overrides,
  };
}

describe("checkInviteGate", () => {
  beforeEach(() => {
    // vi.resetAllMocks() clears both usage data AND the implementation queue
    // (including any unconsumed mockResolvedValueOnce values). This prevents
    // contamination between tests. vi.clearAllMocks() only clears usage data
    // and would leave leftover once-queue entries.
    vi.resetAllMocks();
    // Default: no user, no invite found
    mockUser.findFirst.mockResolvedValue(null);
    mockInvite.findFirst.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ── Check 1: OPEN_SIGNUP ──────────────────────────────────────────────────

  it("allows any email when OPEN_SIGNUP=true", async () => {
    vi.stubEnv("OPEN_SIGNUP", "true");
    vi.stubEnv("FOUNDER_GOOGLE_EMAIL", "");
    const result = await checkInviteGate("stranger@example.com");
    expect(result).toEqual({ allowed: true });
    // Should short-circuit before any DB calls
    expect(mockUser.findFirst).not.toHaveBeenCalled();
    expect(mockInvite.findFirst).not.toHaveBeenCalled();
  });

  it("gates when OPEN_SIGNUP is unset", async () => {
    vi.stubEnv("OPEN_SIGNUP", "");
    vi.stubEnv("FOUNDER_GOOGLE_EMAIL", "");
    const result = await checkInviteGate("stranger@example.com");
    expect(result).toEqual({ allowed: false, redirect: "/request-access" });
  });

  it("gates when OPEN_SIGNUP=false", async () => {
    vi.stubEnv("OPEN_SIGNUP", "false");
    vi.stubEnv("FOUNDER_GOOGLE_EMAIL", "");
    const result = await checkInviteGate("stranger@example.com");
    expect(result).toEqual({ allowed: false, redirect: "/request-access" });
  });

  // ── Check 2: Founder email (case-insensitive) ─────────────────────────────

  it("allows founder email (exact match)", async () => {
    vi.stubEnv("OPEN_SIGNUP", "false");
    vi.stubEnv("FOUNDER_GOOGLE_EMAIL", "founder@example.com");
    const result = await checkInviteGate("founder@example.com");
    expect(result).toEqual({ allowed: true });
    expect(mockUser.findFirst).not.toHaveBeenCalled();
  });

  it("allows founder email (case-insensitive — uppercase input)", async () => {
    vi.stubEnv("OPEN_SIGNUP", "false");
    vi.stubEnv("FOUNDER_GOOGLE_EMAIL", "Founder@Example.COM");
    const result = await checkInviteGate("founder@example.com");
    expect(result).toEqual({ allowed: true });
  });

  it("does not allow non-founder when FOUNDER_GOOGLE_EMAIL is set", async () => {
    vi.stubEnv("OPEN_SIGNUP", "false");
    vi.stubEnv("FOUNDER_GOOGLE_EMAIL", "founder@example.com");
    const result = await checkInviteGate("other@example.com");
    expect(result).toEqual({ allowed: false, redirect: "/request-access" });
  });

  // ── Check 3: Existing user with Account (returning user) ──────────────────

  it("allows returning user who already has an Account", async () => {
    vi.stubEnv("OPEN_SIGNUP", "false");
    vi.stubEnv("FOUNDER_GOOGLE_EMAIL", "");
    mockUser.findFirst.mockResolvedValue({
      id: "usr_1",
      accounts: [{ id: "acc_1" }],
    });
    const result = await checkInviteGate("returning@example.com");
    expect(result).toEqual({ allowed: true });
    expect(mockInvite.findFirst).not.toHaveBeenCalled();
  });

  it("does not allow user with no Accounts (new user who had a User row but never linked)", async () => {
    vi.stubEnv("OPEN_SIGNUP", "false");
    vi.stubEnv("FOUNDER_GOOGLE_EMAIL", "");
    mockUser.findFirst.mockResolvedValue({
      id: "usr_1",
      accounts: [],
    });
    const result = await checkInviteGate("new@example.com");
    expect(result).toEqual({ allowed: false, redirect: "/request-access" });
  });

  // ── Check 4: Email-bound invite ───────────────────────────────────────────

  it("allows email-bound invite (valid, not expired, useCount < maxUses)", async () => {
    vi.stubEnv("OPEN_SIGNUP", "false");
    vi.stubEnv("FOUNDER_GOOGLE_EMAIL", "");
    // Return the email-bound invite on the first findFirst call
    mockInvite.findFirst.mockResolvedValue(
      fakeInvite({ id: "inv_email", email: "vip@example.com", useCount: 0, maxUses: 1 }),
    );
    const result = await checkInviteGate("vip@example.com");
    expect(result).toEqual({ allowed: true, redeemInviteId: "inv_email" });
  });

  it("rejects email-bound invite when useCount >= maxUses (maxed out)", async () => {
    vi.stubEnv("OPEN_SIGNUP", "false");
    vi.stubEnv("FOUNDER_GOOGLE_EMAIL", "");
    mockInvite.findFirst.mockResolvedValue(
      fakeInvite({ id: "inv_maxed", email: "vip@example.com", useCount: 1, maxUses: 1 }),
    );
    const result = await checkInviteGate("vip@example.com");
    expect(result).toEqual({ allowed: false, redirect: "/request-access" });
  });

  it("rejects email-bound invite when expired (expiresAt in the past)", async () => {
    vi.stubEnv("OPEN_SIGNUP", "false");
    vi.stubEnv("FOUNDER_GOOGLE_EMAIL", "");
    // The WHERE clause filters out expired invites (expiresAt > now), so
    // an expired invite will simply return null from findFirst.
    mockInvite.findFirst.mockResolvedValue(null);
    const result = await checkInviteGate("vip@example.com");
    expect(result).toEqual({ allowed: false, redirect: "/request-access" });
  });

  // ── Check 5: Code invite (from cookie) ────────────────────────────────────

  it("allows code invite (valid, unbound)", async () => {
    vi.stubEnv("OPEN_SIGNUP", "false");
    vi.stubEnv("FOUNDER_GOOGLE_EMAIL", "");
    // First call (email-bound check): no email-bound invite
    // Second call (code check): return the code invite
    mockInvite.findFirst
      .mockResolvedValueOnce(null) // check 4: no email-bound invite
      .mockResolvedValueOnce(fakeInvite({ id: "inv_code", code: "abc123", email: null, useCount: 0, maxUses: 3 })); // check 5
    const result = await checkInviteGate("new@example.com", "abc123");
    expect(result).toEqual({ allowed: true, redeemInviteId: "inv_code" });
  });

  it("allows code invite bound to matching email", async () => {
    vi.stubEnv("OPEN_SIGNUP", "false");
    vi.stubEnv("FOUNDER_GOOGLE_EMAIL", "");
    mockInvite.findFirst
      .mockResolvedValueOnce(null) // check 4: no email-bound invite
      .mockResolvedValueOnce(fakeInvite({ id: "inv_code_email", code: "xyz789", email: "specific@example.com", useCount: 0, maxUses: 1 })); // check 5
    const result = await checkInviteGate("specific@example.com", "xyz789");
    expect(result).toEqual({ allowed: true, redeemInviteId: "inv_code_email" });
  });

  it("rejects code invite bound to a DIFFERENT email (wrong email)", async () => {
    vi.stubEnv("OPEN_SIGNUP", "false");
    vi.stubEnv("FOUNDER_GOOGLE_EMAIL", "");
    mockInvite.findFirst
      .mockResolvedValueOnce(null) // check 4: no email-bound
      .mockResolvedValueOnce(fakeInvite({ id: "inv_wrong", code: "xyz789", email: "someone-else@example.com", useCount: 0, maxUses: 1 }));
    const result = await checkInviteGate("intruder@example.com", "xyz789");
    expect(result).toEqual({ allowed: false, redirect: "/request-access" });
  });

  it("rejects code invite when maxed out", async () => {
    vi.stubEnv("OPEN_SIGNUP", "false");
    vi.stubEnv("FOUNDER_GOOGLE_EMAIL", "");
    mockInvite.findFirst
      .mockResolvedValueOnce(null) // check 4
      .mockResolvedValueOnce(fakeInvite({ id: "inv_maxed_code", code: "maxed", useCount: 5, maxUses: 5 }));
    const result = await checkInviteGate("new@example.com", "maxed");
    expect(result).toEqual({ allowed: false, redirect: "/request-access" });
  });

  it("rejects when code invite not found (bad or expired code)", async () => {
    vi.stubEnv("OPEN_SIGNUP", "false");
    vi.stubEnv("FOUNDER_GOOGLE_EMAIL", "");
    // Both calls return null (default)
    const result = await checkInviteGate("new@example.com", "badcode");
    expect(result).toEqual({ allowed: false, redirect: "/request-access" });
  });

  it("falls through to rejection when no code provided and no invite", async () => {
    vi.stubEnv("OPEN_SIGNUP", "false");
    vi.stubEnv("FOUNDER_GOOGLE_EMAIL", "");
    const result = await checkInviteGate("new@example.com");
    expect(result).toEqual({ allowed: false, redirect: "/request-access" });
    // Only one findFirst call (email-bound check only — no code provided so check 5 skips)
    expect(mockInvite.findFirst).toHaveBeenCalledTimes(1);
  });

  // ── Check 6: Rejection returns /request-access ────────────────────────────

  it("returns /request-access as the redirect path on rejection", async () => {
    vi.stubEnv("OPEN_SIGNUP", "false");
    vi.stubEnv("FOUNDER_GOOGLE_EMAIL", "");
    const result = await checkInviteGate("anyone@example.com");
    expect(result.allowed).toBe(false);
    expect(result.redirect).toBe("/request-access");
  });

  it("does not include redeemInviteId on rejection", async () => {
    vi.stubEnv("OPEN_SIGNUP", "false");
    vi.stubEnv("FOUNDER_GOOGLE_EMAIL", "");
    const result = await checkInviteGate("anyone@example.com");
    expect(result.redeemInviteId).toBeUndefined();
  });
});
