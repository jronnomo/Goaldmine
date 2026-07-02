// src/lib/auth/current-user.test.ts
// Regression guard for the Phase-1 current-user seam (A-2).
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

import { getCurrentUserId, resolveUserIdFromToken } from "@/lib/auth/current-user";
import { FOUNDER_USER_ID } from "@/lib/auth/founder";
import { auth } from "@/lib/auth/auth";
import { redirect } from "next/navigation";

const mockAuth = vi.mocked(auth);
const mockRedirect = vi.mocked(redirect);

// ---------------------------------------------------------------------------
// resolveUserIdFromToken — unchanged Phase-0 behaviour
// ---------------------------------------------------------------------------
describe("resolveUserIdFromToken — Phase-0 always-founder (unchanged)", () => {
  it('resolves "any-token" to the founder id', async () => {
    expect(await resolveUserIdFromToken("any-token")).toBe(FOUNDER_USER_ID);
  });

  it("resolves empty string to the founder id", async () => {
    expect(await resolveUserIdFromToken("")).toBe(FOUNDER_USER_ID);
  });

  it("resolves a random token to the founder id", async () => {
    expect(await resolveUserIdFromToken("tok_abc123_random")).toBe(FOUNDER_USER_ID);
  });

  it("matches FOUNDER_USER_ID constant", async () => {
    expect(await resolveUserIdFromToken("any")).toBe(FOUNDER_USER_ID);
  });
});

// ---------------------------------------------------------------------------
// getCurrentUserId — Phase-1: reads Auth.js session
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
