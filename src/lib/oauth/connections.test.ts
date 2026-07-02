// src/lib/oauth/connections.test.ts
//
// Unit tests for C-3b connections.ts (listConnections + revokeConnection).
// Mocks @/lib/db using the dual-export convention (prisma + getDb).
//
// THE KEY OWNERSHIP TEST: revokeConnection for userA MUST NOT revoke userB's
// tokens for the same clientId. This is asserted explicitly.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock @/lib/db — vi.fn() inside factory (hoisting-safe, per invite-gate pattern).
// ---------------------------------------------------------------------------

vi.mock("@/lib/db", () => ({
  prisma: {
    oAuthAccessToken: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    oAuthRefreshToken: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    oAuthClient: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
  getDb: vi.fn(),
}));

import { listConnections, revokeConnection } from "@/lib/oauth/connections";
import { prisma } from "@/lib/db";

// Typed aliases for the mock functions — same pattern as invite-gate.test.ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockAt = prisma.oAuthAccessToken as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockRt = prisma.oAuthRefreshToken as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockClient = prisma.oAuthClient as any;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_A = "usr_a";
const USER_B = "usr_b";
const CLIENT_X = "mcp_clientX";
const CLIENT_Y = "mcp_clientY";

function makeAt(overrides: {
  clientId?: string;
  userId?: string;
  createdAt?: Date;
  lastUsedAt?: Date | null;
  revokedAt?: Date | null;
}) {
  return {
    clientId: overrides.clientId ?? CLIENT_X,
    userId: overrides.userId ?? USER_A,
    createdAt: overrides.createdAt ?? new Date("2026-01-01T00:00:00Z"),
    lastUsedAt: overrides.lastUsedAt !== undefined ? overrides.lastUsedAt : null,
    revokedAt: overrides.revokedAt !== undefined ? overrides.revokedAt : null,
  };
}

function makeRt(overrides: {
  clientId?: string;
  userId?: string;
  createdAt?: Date;
  revokedAt?: Date | null;
}) {
  return {
    clientId: overrides.clientId ?? CLIENT_X,
    userId: overrides.userId ?? USER_A,
    createdAt: overrides.createdAt ?? new Date("2026-01-01T00:00:00Z"),
    revokedAt: overrides.revokedAt !== undefined ? overrides.revokedAt : null,
  };
}

// ---------------------------------------------------------------------------
// listConnections
// ---------------------------------------------------------------------------

describe("listConnections", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Safe defaults
    mockAt.findMany.mockResolvedValue([]);
    mockRt.findMany.mockResolvedValue([]);
    mockClient.findMany.mockResolvedValue([]);
  });

  it("returns an empty array when the user has no tokens", async () => {
    const result = await listConnections(USER_A);

    expect(result).toEqual([]);
    // Verify userId was in the query — ownership guard check.
    expect(mockAt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: USER_A }) }),
    );
    expect(mockRt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: USER_A }) }),
    );
  });

  it("groups tokens by clientId into a single connection", async () => {
    const connected = new Date("2026-01-10T12:00:00Z");
    const lastUsed = new Date("2026-01-20T08:00:00Z");

    mockAt.findMany.mockResolvedValue([
      makeAt({ clientId: CLIENT_X, createdAt: connected, lastUsedAt: lastUsed }),
    ]);
    mockRt.findMany.mockResolvedValue([
      makeRt({ clientId: CLIENT_X, createdAt: connected }),
    ]);
    mockClient.findMany.mockResolvedValue([
      { clientId: CLIENT_X, clientName: "claude.ai" },
    ]);

    const result = await listConnections(USER_A);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      clientId: CLIENT_X,
      clientName: "claude.ai",
      connectedAt: connected,
      lastUsedAt: lastUsed,
      active: true,
    });
  });

  it("only returns active connections (filters out fully-revoked ones)", async () => {
    const revokedAt = new Date("2026-01-15T00:00:00Z");

    mockAt.findMany.mockResolvedValue([
      makeAt({ clientId: CLIENT_X, revokedAt }),
    ]);
    mockRt.findMany.mockResolvedValue([
      makeRt({ clientId: CLIENT_X, revokedAt }),
    ]);
    mockClient.findMany.mockResolvedValue([
      { clientId: CLIENT_X, clientName: "claude.ai" },
    ]);

    const result = await listConnections(USER_A);
    expect(result).toHaveLength(0);
  });

  it("keeps a connection active when its access token is revoked but refresh token is live", async () => {
    const revokedAt = new Date("2026-01-15T00:00:00Z");

    mockAt.findMany.mockResolvedValue([
      makeAt({ clientId: CLIENT_X, revokedAt }), // rotated-away AT
    ]);
    mockRt.findMany.mockResolvedValue([
      makeRt({ clientId: CLIENT_X, revokedAt: null }), // live RT
    ]);
    mockClient.findMany.mockResolvedValue([
      { clientId: CLIENT_X, clientName: "claude.ai" },
    ]);

    const result = await listConnections(USER_A);
    expect(result).toHaveLength(1);
    expect(result[0]!.active).toBe(true);
  });

  it("groups multiple connections (different clientIds) independently", async () => {
    const dateX = new Date("2026-01-10T00:00:00Z");
    const dateY = new Date("2026-02-01T00:00:00Z");

    mockAt.findMany.mockResolvedValue([
      makeAt({ clientId: CLIENT_X, createdAt: dateX }),
      makeAt({ clientId: CLIENT_Y, createdAt: dateY }),
    ]);
    mockRt.findMany.mockResolvedValue([]);
    mockClient.findMany.mockResolvedValue([
      { clientId: CLIENT_X, clientName: "App X" },
      { clientId: CLIENT_Y, clientName: "App Y" },
    ]);

    const result = await listConnections(USER_A);
    expect(result).toHaveLength(2);

    const x = result.find((c) => c.clientId === CLIENT_X);
    const y = result.find((c) => c.clientId === CLIENT_Y);
    expect(x?.clientName).toBe("App X");
    expect(y?.clientName).toBe("App Y");
  });

  it("falls back to null clientName when OAuthClient record is missing", async () => {
    mockAt.findMany.mockResolvedValue([
      makeAt({ clientId: CLIENT_X }),
    ]);
    mockRt.findMany.mockResolvedValue([]);
    // No matching client record
    mockClient.findMany.mockResolvedValue([]);

    const result = await listConnections(USER_A);
    expect(result[0]!.clientName).toBeNull();
  });

  it("computes connectedAt as the earliest createdAt across access + refresh tokens", async () => {
    const early = new Date("2026-01-01T00:00:00Z");
    const later = new Date("2026-01-10T00:00:00Z");

    mockAt.findMany.mockResolvedValue([
      makeAt({ clientId: CLIENT_X, createdAt: later }),
    ]);
    mockRt.findMany.mockResolvedValue([
      makeRt({ clientId: CLIENT_X, createdAt: early }),
    ]);
    mockClient.findMany.mockResolvedValue([
      { clientId: CLIENT_X, clientName: "App" },
    ]);

    const result = await listConnections(USER_A);
    expect(result[0]!.connectedAt).toEqual(early);
  });

  it("computes lastUsedAt as the max lastUsedAt among access tokens", async () => {
    const used1 = new Date("2026-01-15T00:00:00Z");
    const used2 = new Date("2026-01-20T00:00:00Z");

    mockAt.findMany.mockResolvedValue([
      makeAt({ clientId: CLIENT_X, lastUsedAt: used1 }),
      makeAt({ clientId: CLIENT_X, lastUsedAt: used2 }),
    ]);
    mockRt.findMany.mockResolvedValue([]);
    mockClient.findMany.mockResolvedValue([
      { clientId: CLIENT_X, clientName: "App" },
    ]);

    const result = await listConnections(USER_A);
    expect(result[0]!.lastUsedAt).toEqual(used2);
  });

  it("returns lastUsedAt = null when all access tokens have null lastUsedAt", async () => {
    mockAt.findMany.mockResolvedValue([
      makeAt({ clientId: CLIENT_X, lastUsedAt: null }),
    ]);
    mockRt.findMany.mockResolvedValue([]);
    mockClient.findMany.mockResolvedValue([
      { clientId: CLIENT_X, clientName: "App" },
    ]);

    const result = await listConnections(USER_A);
    expect(result[0]!.lastUsedAt).toBeNull();
  });

  it("filters by userId — does not include another user's tokens in the result", async () => {
    // This test verifies the WHERE userId filter is applied. The mock only
    // returns rows that match the where clause we pass (it's a mock, so we
    // configure it to return only userA's rows — as a real DB would).
    mockAt.findMany.mockImplementation(
      (args: { where?: { userId?: string } }) => {
        const uid = args?.where?.userId;
        // Simulate DB: only return rows for the requested userId.
        if (uid === USER_A) return Promise.resolve([makeAt({ userId: USER_A })]);
        return Promise.resolve([]);
      },
    );
    mockRt.findMany.mockResolvedValue([]);
    mockClient.findMany.mockResolvedValue([
      { clientId: CLIENT_X, clientName: "App" },
    ]);

    const resultA = await listConnections(USER_A);
    const resultB = await listConnections(USER_B);

    expect(resultA).toHaveLength(1);
    expect(resultB).toHaveLength(0); // userB has no tokens
  });
});

// ---------------------------------------------------------------------------
// revokeConnection — THE OWNERSHIP TEST
// ---------------------------------------------------------------------------

describe("revokeConnection", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAt.updateMany.mockResolvedValue({ count: 0 });
    mockRt.updateMany.mockResolvedValue({ count: 0 });
  });

  it("revokes only the caller's tokens — userId is ALWAYS in the WHERE clause", async () => {
    mockAt.updateMany.mockResolvedValue({ count: 1 });
    mockRt.updateMany.mockResolvedValue({ count: 1 });

    await revokeConnection(USER_A, CLIENT_X);

    // Access token revoke — must include BOTH userId and clientId in WHERE
    expect(mockAt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: USER_A, // OWNERSHIP GUARD
          clientId: CLIENT_X,
          revokedAt: null,
        }),
      }),
    );

    // Refresh token revoke — same ownership guard
    expect(mockRt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: USER_A, // OWNERSHIP GUARD
          clientId: CLIENT_X,
          revokedAt: null,
        }),
      }),
    );
  });

  it("leaves userB's tokens untouched when userA revokes (ownership assertion)", async () => {
    // Simulate both userA and userB have tokens for CLIENT_X.
    // We revoke for userA only. The WHERE clause must never reference USER_B.
    mockAt.updateMany.mockResolvedValue({ count: 1 });
    mockRt.updateMany.mockResolvedValue({ count: 1 });

    await revokeConnection(USER_A, CLIENT_X);

    // Confirm userB is NEVER referenced in any updateMany call
    for (const [arg] of mockAt.updateMany.mock.calls) {
      expect(arg.where.userId).toBe(USER_A);
      expect(arg.where.userId).not.toBe(USER_B);
    }
    for (const [arg] of mockRt.updateMany.mock.calls) {
      expect(arg.where.userId).toBe(USER_A);
      expect(arg.where.userId).not.toBe(USER_B);
    }
  });

  it("returns { revoked: N } equal to total count from both updateMany calls", async () => {
    mockAt.updateMany.mockResolvedValue({ count: 2 });
    mockRt.updateMany.mockResolvedValue({ count: 3 });

    const result = await revokeConnection(USER_A, CLIENT_X);
    expect(result).toEqual({ revoked: 5 });
  });

  it("is idempotent — revoking with no live tokens returns { revoked: 0 }", async () => {
    mockAt.updateMany.mockResolvedValue({ count: 0 });
    mockRt.updateMany.mockResolvedValue({ count: 0 });

    const result = await revokeConnection(USER_A, CLIENT_X);
    expect(result).toEqual({ revoked: 0 });
  });

  it("only revokes tokens for the specified clientId — not other clients of the same user", async () => {
    await revokeConnection(USER_A, CLIENT_X);

    // WHERE must include clientId=CLIENT_X — not CLIENT_Y
    expect(mockAt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ clientId: CLIENT_X }),
      }),
    );
    // Confirm CLIENT_Y never appears in any updateMany call
    for (const [arg] of mockAt.updateMany.mock.calls) {
      expect(arg.where.clientId).not.toBe(CLIENT_Y);
    }
  });
});
