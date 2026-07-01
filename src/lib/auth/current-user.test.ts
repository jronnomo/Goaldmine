// src/lib/auth/current-user.test.ts
// Regression guard for the Phase-0 current-user resolution seam (E3-1).
// Both functions must return the founder id in Phase 0 regardless of input.
// React.cache is a no-op outside a render context (returns the function
// result directly) — we assert the resolved value, not caching behaviour.

import { describe, it, expect } from "vitest";

import { getCurrentUserId, resolveUserIdFromToken } from "@/lib/auth/current-user";
import { FOUNDER_USER_ID } from "@/lib/auth/founder";

const EXPECTED = "usr_founder";

describe("resolveUserIdFromToken — Phase-0 always-founder", () => {
  it('resolves "any-token" to the founder id', async () => {
    expect(await resolveUserIdFromToken("any-token")).toBe(EXPECTED);
  });

  it("resolves empty string to the founder id", async () => {
    expect(await resolveUserIdFromToken("")).toBe(EXPECTED);
  });

  it("resolves a random token to the founder id", async () => {
    expect(await resolveUserIdFromToken("tok_abc123_random")).toBe(EXPECTED);
  });

  it("matches FOUNDER_USER_ID constant", async () => {
    expect(await resolveUserIdFromToken("any")).toBe(FOUNDER_USER_ID);
  });
});

describe("getCurrentUserId — Phase-0 always-founder", () => {
  it("resolves to the founder id", async () => {
    expect(await getCurrentUserId()).toBe(EXPECTED);
  });

  it("matches FOUNDER_USER_ID constant", async () => {
    expect(await getCurrentUserId()).toBe(FOUNDER_USER_ID);
  });
});
