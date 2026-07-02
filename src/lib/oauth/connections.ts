/**
 * C-3b: Connected-apps data layer.
 *
 * OWNERSHIP CRITICAL — OAuthAccessToken/OAuthRefreshToken/OAuthClient are NOT
 * in SCOPED_MODELS; getDb() does NOT auto-scope them. Every query here MUST
 * filter by userId explicitly. A missing userId filter = cross-user data leak.
 *
 * Always use the raw `prisma` singleton (not getDb) for these models.
 */

import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Connection = {
  clientId: string;
  /** clientName from OAuthClient, or null when the client record is missing. */
  clientName: string | null;
  /** Earliest createdAt across all tokens for this (userId, clientId) pair. */
  connectedAt: Date;
  /** Max lastUsedAt across this user's access tokens for this client; null = never used. */
  lastUsedAt: Date | null;
  /** True: ≥1 token (access or refresh) with revokedAt null exists for this pair. */
  active: boolean;
};

// ---------------------------------------------------------------------------
// listConnections — read; raw prisma; WHERE userId in every query
// ---------------------------------------------------------------------------

/**
 * List connections for a specific user.
 *
 * A "connection" = a (userId, clientId) pair that has at least one token with
 * revokedAt null (still live). Returns only active connections.
 *
 * Ownership guard: all queries filter WHERE userId = the supplied userId.
 * Never pass anything other than the current session user's id here.
 */
export async function listConnections(userId: string): Promise<Connection[]> {
  // Fetch all access tokens for this user (any revocation status — needed for
  // connectedAt computation and lastUsedAt max).
  const accessTokens = await prisma.oAuthAccessToken.findMany({
    where: { userId }, // OWNERSHIP GUARD — must include userId
    select: {
      clientId: true,
      createdAt: true,
      lastUsedAt: true,
      revokedAt: true,
    },
  });

  // Fetch all refresh tokens for this user.
  const refreshTokens = await prisma.oAuthRefreshToken.findMany({
    where: { userId }, // OWNERSHIP GUARD — must include userId
    select: {
      clientId: true,
      createdAt: true,
      revokedAt: true,
    },
  });

  // Collect all unique clientIds across both token types.
  const clientIds = new Set<string>([
    ...accessTokens.map((t) => t.clientId),
    ...refreshTokens.map((t) => t.clientId),
  ]);

  if (clientIds.size === 0) return [];

  // Fetch OAuthClient records for names (one round-trip for all clients).
  const clients = await prisma.oAuthClient.findMany({
    where: { clientId: { in: [...clientIds] } },
    select: { clientId: true, clientName: true },
  });
  const clientNameMap = new Map<string, string | null>(
    clients.map((c) => [c.clientId, c.clientName]),
  );

  const connections: Connection[] = [];

  for (const clientId of clientIds) {
    const ats = accessTokens.filter((t) => t.clientId === clientId);
    const rts = refreshTokens.filter((t) => t.clientId === clientId);

    // A connection is active if ≥1 token (access or refresh) has revokedAt null.
    const active = [...ats, ...rts].some((t) => t.revokedAt === null);
    if (!active) continue; // skip fully-revoked connections

    // connectedAt = earliest createdAt across all tokens for this pair.
    const allDates = [...ats, ...rts].map((t) => t.createdAt.getTime());
    const connectedAt = new Date(Math.min(...allDates));

    // lastUsedAt = max lastUsedAt among access tokens (refresh tokens don't
    // expose usage timestamps).
    const usedAts = ats
      .map((t) => t.lastUsedAt)
      .filter((d): d is Date => d !== null)
      .map((d) => d.getTime());
    const lastUsedAt = usedAts.length > 0 ? new Date(Math.max(...usedAts)) : null;

    connections.push({
      clientId,
      clientName: clientNameMap.get(clientId) ?? null,
      connectedAt,
      lastUsedAt,
      active,
    });
  }

  // Most-recently-connected first.
  connections.sort((a, b) => b.connectedAt.getTime() - a.connectedAt.getTime());

  return connections;
}

// ---------------------------------------------------------------------------
// revokeConnection — write; raw prisma; WHERE userId AND clientId
// ---------------------------------------------------------------------------

/**
 * Revoke all live tokens (access + refresh) for this user's connection to a
 * specific client.
 *
 * Ownership guard: WHERE clause includes BOTH userId AND clientId — never
 * revokes another user's tokens for the same client.
 *
 * Idempotent: already-revoked tokens are not double-counted.
 *
 * @returns { revoked } — total rows updated (access + refresh combined).
 */
export async function revokeConnection(
  userId: string,
  clientId: string,
): Promise<{ revoked: number }> {
  const now = new Date();

  // Revoke access tokens for THIS user + THIS client only.
  const [atResult, rtResult] = await Promise.all([
    prisma.oAuthAccessToken.updateMany({
      where: { userId, clientId, revokedAt: null }, // OWNERSHIP GUARD
      data: { revokedAt: now },
    }),
    // Revoke refresh tokens for THIS user + THIS client only.
    prisma.oAuthRefreshToken.updateMany({
      where: { userId, clientId, revokedAt: null }, // OWNERSHIP GUARD
      data: { revokedAt: now },
    }),
  ]);

  return { revoked: atResult.count + rtResult.count };
}
