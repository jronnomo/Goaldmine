import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSignOut } = vi.hoisted(() => ({ mockSignOut: vi.fn() }));

vi.mock("@/lib/auth/auth", () => ({
  signIn: vi.fn(),
  signOut: mockSignOut,
}));

// Transitively required — signOutAction's module also imports previewInviteCodeQuery,
// which imports prisma from @/lib/db. Dual-export stub convention per
// access-request-actions.test.ts:4-6 / invite-gate.test.ts:9-21 so the stale
// import doesn't throw.
vi.mock("@/lib/db", () => ({
  prisma: {},
  getDb: vi.fn(),
}));

import { signOutAction } from "@/lib/auth/auth-actions";

describe("signOutAction", () => {
  beforeEach(() => {
    mockSignOut.mockReset();
  });

  it("FormData as first positional arg (bare `<form action={signOutAction}>`) → /signin", async () => {
    const fd = new FormData();
    // Simulating Next's bare-form call: FormData lands in the redirectTo slot.
    await signOutAction(fd);
    expect(mockSignOut).toHaveBeenCalledWith({ redirectTo: "/signin" });
  });

  it("no args → /signin", async () => {
    await signOutAction();
    expect(mockSignOut).toHaveBeenCalledWith({ redirectTo: "/signin" });
  });

  it("valid relative path → passed through safeNext unchanged", async () => {
    await signOutAction("/oauth/authorize?client_id=x&scope=mcp");
    expect(mockSignOut).toHaveBeenCalledWith({
      redirectTo: "/oauth/authorize?client_id=x&scope=mcp",
    });
  });

  it.each(["https://evil.example", "//evil.example"])(
    "malicious redirectTo %s → safeNext's own fallback (\"/\", NOT \"/signin\")",
    async (malicious) => {
      await signOutAction(malicious);
      expect(mockSignOut).toHaveBeenCalledWith({ redirectTo: "/" });
    },
  );
});
