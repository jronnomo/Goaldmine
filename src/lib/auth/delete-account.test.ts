// src/lib/auth/delete-account.test.ts
//
// Unit tests for deleteAccountAction (#245).
//
// Mocks @/lib/auth/current-user (getCurrentUserId), @/lib/auth/auth (signOut),
// and @/lib/db (prisma.user.delete) — the exact dual-export + vi.hoisted
// conventions from auth-actions.test.ts / access-request-actions.test.ts. The
// real Prisma error class is imported (not mocked) to construct a genuine
// P2025 PrismaClientKnownRequestError, matching the day-actions.test.ts
// precedent of importing { Prisma } from "@/generated/prisma/client" directly
// (no DB connection required for the error class).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@/generated/prisma/client";

const { mockSignOut, mockGetCurrentUserId, mockUserDelete } = vi.hoisted(() => ({
  mockSignOut: vi.fn(),
  mockGetCurrentUserId: vi.fn(),
  mockUserDelete: vi.fn(),
}));

vi.mock("@/lib/auth/auth", () => ({
  signIn: vi.fn(),
  signOut: mockSignOut,
}));

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUserId: mockGetCurrentUserId,
}));

// Dual-export stub convention (invite-gate.test.ts / access-request-actions.test.ts) —
// auth-actions.ts transitively imports previewInviteCodeQuery, which imports prisma
// from @/lib/db, so getDb must be present even though this suite never calls it.
vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      delete: mockUserDelete,
    },
  },
  getDb: vi.fn(),
}));

import { deleteAccountAction, type DeleteAccountState } from "@/lib/auth/auth-actions";

const SESSION_UID = "usr_session_owner";
const initialState: DeleteAccountState = { error: null };

function formDataWith(confirmation: string): FormData {
  const fd = new FormData();
  fd.set("confirmation", confirmation);
  return fd;
}

describe("deleteAccountAction", () => {
  beforeEach(() => {
    mockSignOut.mockReset();
    mockGetCurrentUserId.mockReset();
    mockUserDelete.mockReset();
    mockGetCurrentUserId.mockResolvedValue(SESSION_UID);
  });

  it("wrong phrase → error state, user.delete NOT called", async () => {
    const result = await deleteAccountAction(initialState, formDataWith("delete my accountz"));
    expect(result).toEqual({ error: "Type the phrase exactly as shown to confirm." });
    expect(mockUserDelete).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it("missing phrase (empty confirmation field) → error state, user.delete NOT called", async () => {
    const result = await deleteAccountAction(initialState, formDataWith(""));
    expect(result).toEqual({ error: "Type the phrase exactly as shown to confirm." });
    expect(mockUserDelete).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it("no confirmation field at all → error state, user.delete NOT called", async () => {
    const result = await deleteAccountAction(initialState, new FormData());
    expect(result).toEqual({ error: "Type the phrase exactly as shown to confirm." });
    expect(mockUserDelete).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it("case-mismatched phrase (\"Delete my account\") → error state (no case-folding)", async () => {
    const result = await deleteAccountAction(initialState, formDataWith("Delete my account"));
    expect(result).toEqual({ error: "Type the phrase exactly as shown to confirm." });
    expect(mockUserDelete).not.toHaveBeenCalled();
  });

  it("untrimmed but correct phrase (\" delete my account \") → succeeds", async () => {
    mockUserDelete.mockResolvedValue({ id: SESSION_UID });
    mockSignOut.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(
      deleteAccountAction(initialState, formDataWith("  delete my account  ")),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mockUserDelete).toHaveBeenCalledWith({ where: { id: SESSION_UID } });
    expect(mockSignOut).toHaveBeenCalledWith({ redirectTo: "/signin?deleted=1" });
  });

  it("correct phrase → user.delete called with the SESSION uid; signOut called with /signin?deleted=1; delete happens before signOut", async () => {
    const callOrder: string[] = [];
    mockUserDelete.mockImplementation(async () => {
      callOrder.push("delete");
      return { id: SESSION_UID };
    });
    mockSignOut.mockImplementation(async () => {
      callOrder.push("signOut");
      throw new Error("NEXT_REDIRECT");
    });

    await expect(
      deleteAccountAction(initialState, formDataWith("delete my account")),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mockUserDelete).toHaveBeenCalledTimes(1);
    expect(mockUserDelete).toHaveBeenCalledWith({ where: { id: SESSION_UID } });
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(mockSignOut).toHaveBeenCalledWith({ redirectTo: "/signin?deleted=1" });
    expect(callOrder).toEqual(["delete", "signOut"]);
  });

  it("no session (getCurrentUserId redirects) → error state, no delete, no signOut", async () => {
    mockGetCurrentUserId.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(
      deleteAccountAction(initialState, formDataWith("delete my account")),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mockUserDelete).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it("P2025 on delete (concurrent double-submit) → signOut still called, error NOT rethrown", async () => {
    const p2025 = new Prisma.PrismaClientKnownRequestError("Record to delete does not exist.", {
      code: "P2025",
      clientVersion: "test",
    });
    mockUserDelete.mockRejectedValue(p2025);
    mockSignOut.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(
      deleteAccountAction(initialState, formDataWith("delete my account")),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mockUserDelete).toHaveBeenCalledWith({ where: { id: SESSION_UID } });
    expect(mockSignOut).toHaveBeenCalledWith({ redirectTo: "/signin?deleted=1" });
  });

  it("non-P2025 Prisma error on delete → rethrown, signOut NOT called", async () => {
    const p2003 = new Prisma.PrismaClientKnownRequestError("Foreign key constraint failed.", {
      code: "P2003",
      clientVersion: "test",
    });
    mockUserDelete.mockRejectedValue(p2003);

    await expect(
      deleteAccountAction(initialState, formDataWith("delete my account")),
    ).rejects.toThrow(p2003);

    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it("unrelated error on delete → rethrown, signOut NOT called", async () => {
    mockUserDelete.mockRejectedValue(new Error("connection reset"));

    await expect(
      deleteAccountAction(initialState, formDataWith("delete my account")),
    ).rejects.toThrow("connection reset");

    expect(mockSignOut).not.toHaveBeenCalled();
  });
});
