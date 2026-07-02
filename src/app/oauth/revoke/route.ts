/**
 * POST /oauth/revoke — RFC 7009 Token Revocation Endpoint (C-3b).
 *
 * Public endpoint — no auth required (client presents its own token).
 * /oauth/* is already in the public allowlist in middleware (B-1).
 *
 * RFC 7009 §2.2 invariant: ALWAYS return 200, even for unknown/invalid tokens.
 * Leaking token validity via error codes is a security vulnerability.
 *
 * If a refresh token is revoked, we also revoke its entire familyId family and
 * all associated access tokens for the same (userId, clientId) pair — same
 * reuse-detection logic as C-3a's exchangeRefreshToken.
 *
 * runtime="nodejs" — Prisma requires Node.js runtime.
 */

import { prisma } from "@/lib/db";
import { hashSecret } from "@/lib/oauth/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/** RFC 7009 §2.2: always 200 with no-store, even on error/unknown token. */
function ok200(): Response {
  return new Response(null, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      ...CORS_HEADERS,
    },
  });
}

export async function POST(req: Request): Promise<Response> {
  // Parse form-urlencoded body (RFC 7009 §2.1 specifies this content type).
  let token: string | null = null;
  let token_type_hint: string | null = null;

  try {
    const text = await req.text();
    const params = new URLSearchParams(text);
    token = params.get("token");
    token_type_hint = params.get("token_type_hint");
    // client_id is accepted but not used for ownership — we revoke what we find.
  } catch {
    // Malformed body → still 200 (RFC 7009 §2.2)
    return ok200();
  }

  // Missing token → still 200 (RFC 7009 §2.2 — don't leak)
  if (!token || token.trim() === "") {
    return ok200();
  }

  const tokenHash = hashSecret(token.trim());
  const now = new Date();

  // ── Lookup strategy ────────────────────────────────────────────────────────
  // If token_type_hint=refresh_token, try refresh first; otherwise access first.
  // Fall back to the other type if not found. RFC 7009 §2.1 allows this order.

  if (token_type_hint === "refresh_token") {
    // Try refresh token first
    const rt = await prisma.oAuthRefreshToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, clientId: true, familyId: true, revokedAt: true },
    });

    if (rt) {
      await revokeRefreshTokenAndFamily(rt, now);
      return ok200();
    }

    // Fall back to access token
    await revokeAccessTokenIfFound(tokenHash, now);
    return ok200();
  }

  // Default: try access token first (most common path)
  const at = await prisma.oAuthAccessToken.findUnique({
    where: { tokenHash },
    select: { id: true, revokedAt: true },
  });

  if (at) {
    if (!at.revokedAt) {
      await prisma.oAuthAccessToken.update({
        where: { tokenHash },
        data: { revokedAt: now },
      });
    }
    // Already revoked → no-op; still 200
    return ok200();
  }

  // Not an access token — try refresh token
  const rt = await prisma.oAuthRefreshToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, clientId: true, familyId: true, revokedAt: true },
  });

  if (rt) {
    await revokeRefreshTokenAndFamily(rt, now);
    return ok200();
  }

  // Unknown token → still 200 (RFC 7009 §2.2)
  return ok200();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Revoke the refresh token + its entire familyId family + live access tokens
 *  for the same (userId, clientId). Mirrors C-3a reuse-detection logic. */
async function revokeRefreshTokenAndFamily(
  rt: {
    id: string;
    userId: string;
    clientId: string;
    familyId: string | null;
    revokedAt: Date | null;
  },
  now: Date,
): Promise<void> {
  if (rt.revokedAt) {
    // Token already revoked — still revoke family (safety: if this token was
    // being replayed and family wasn't cleaned up, do it now).
  }

  // Revoke the whole refresh-token family (if familyId is set)
  if (rt.familyId) {
    await prisma.oAuthRefreshToken.updateMany({
      where: { familyId: rt.familyId, revokedAt: null },
      data: { revokedAt: now },
    });
  } else {
    // No familyId — revoke this token individually
    if (!rt.revokedAt) {
      await prisma.oAuthRefreshToken.update({
        where: { id: rt.id },
        data: { revokedAt: now },
      });
    }
  }

  // Revoke all live access tokens for this (userId, clientId) pair.
  // This ensures the user is forced to re-authorize — no live access tokens
  // remain after a refresh-token revocation.
  await prisma.oAuthAccessToken.updateMany({
    where: { userId: rt.userId, clientId: rt.clientId, revokedAt: null },
    data: { revokedAt: now },
  });
}

async function revokeAccessTokenIfFound(tokenHash: string, now: Date): Promise<void> {
  const at = await prisma.oAuthAccessToken.findUnique({
    where: { tokenHash },
    select: { revokedAt: true },
  });
  if (at && !at.revokedAt) {
    await prisma.oAuthAccessToken.update({
      where: { tokenHash },
      data: { revokedAt: now },
    });
  }
}

// ---------------------------------------------------------------------------
// CORS preflight
// ---------------------------------------------------------------------------

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
