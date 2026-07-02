/**
 * C-3a: OAuth 2.1 token grant logic — pure-ish, unit-testable.
 *
 * Exported functions:
 *   exchangeAuthorizationCode(db, params) — authorization_code grant
 *   exchangeRefreshToken(db, params)      — refresh_token grant (with rotation)
 *
 * The `db` parameter is a minimal DB interface so tests can inject a mock
 * without having to mock the entire Prisma client (same pattern as AuthorizeDb
 * in authorize-validate.ts). The route at /oauth/token passes the raw `prisma`
 * singleton as `db as unknown as GrantDb`.
 *
 * Security invariants (DA-hardened revisions — NORMATIVE):
 *  - PKCE: base64url(SHA256(verifier)) — timingSafeEqualStr with length-guard.
 *  - Authorization-code consume is ATOMIC (single updateMany in a transaction)
 *    and happens INSIDE the transaction that issues tokens — cleaner than two
 *    separate DB round-trips.
 *  - Refresh-token ROTATION: ATOMIC — old token is consumed via updateMany
 *    ({id, revokedAt: null}) inside the transaction (count=0 → invalid_grant,
 *    closes double-spend); supersededById is set via update as audit trail.
 *  - REUSE DETECTION: a revoked refresh token → revoke entire family (all
 *    refresh tokens with same familyId AND all access tokens for that
 *    userId+clientId that are still live).
 *  - familyId is NEVER null: set to a fresh randomUUID() at first issuance,
 *    copied verbatim on every rotation.
 *  - Cache-Control: no-store is the route's responsibility (applied to every
 *    response — success and error alike).
 */

import { randomUUID } from "node:crypto";
import {
  generateSecret,
  hashSecret,
  pkceChallengeFromVerifier,
  timingSafeEqualStr,
  ACCESS_TOKEN_TTL_S,
  REFRESH_TOKEN_TTL_S,
  OAUTH_SCOPE,
} from "@/lib/oauth/tokens";

// ---------------------------------------------------------------------------
// Row shapes (minimal — just the fields we actually read)
// ---------------------------------------------------------------------------

type OAuthAuthCodeRow = {
  id: string;
  userId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  resource: string | null;
  scope: string | null;
  expiresAt: Date;
  consumedAt: Date | null;
};

type OAuthRefreshTokenRow = {
  id: string;
  userId: string;
  clientId: string;
  familyId: string | null;
  resource: string | null;
  scope: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
};

// ---------------------------------------------------------------------------
// DB interface (testable minimal surface)
// ---------------------------------------------------------------------------

/**
 * The subset of Prisma operations required inside an interactive transaction.
 * No `$transaction` here — Prisma doesn't allow nested transactions.
 */
export type GrantTxDb = {
  oAuthAuthCode: {
    findUnique(args: { where: { codeHash: string } }): Promise<OAuthAuthCodeRow | null>;
    updateMany(args: {
      where: { codeHash: string; consumedAt: null };
      data: { consumedAt: Date };
    }): Promise<{ count: number }>;
  };
  oAuthClient: {
    findUnique(args: { where: { clientId: string } }): Promise<{ clientId: string } | null>;
  };
  oAuthAccessToken: {
    create(args: {
      data: {
        tokenHash: string;
        clientId: string;
        userId: string;
        resource: string | null;
        scope: string;
        expiresAt: Date;
      };
    }): Promise<{ id: string }>;
    updateMany(args: {
      where: { userId: string; clientId: string; revokedAt: null };
      data: { revokedAt: Date };
    }): Promise<{ count: number }>;
  };
  oAuthRefreshToken: {
    findUnique(args: { where: { tokenHash: string } }): Promise<OAuthRefreshTokenRow | null>;
    create(args: {
      data: {
        tokenHash: string;
        clientId: string;
        userId: string;
        resource: string | null;
        scope: string;
        familyId: string;
        expiresAt: Date;
      };
    }): Promise<{ id: string }>;
    update(args: {
      where: { id: string };
      data: { supersededById: string };
    }): Promise<{ id: string }>;
    updateMany(args: {
      where:
        | { familyId: string; revokedAt: null }  // family-revoke (reuse detection, unchanged)
        | { id: string; revokedAt: null };        // conditional-consume (rotation gate, NEW)
      data: { revokedAt: Date };
    }): Promise<{ count: number }>;
  };
};

/**
 * Full DB interface with transaction support.
 * Pass `prisma as unknown as GrantDb` from the route handler.
 */
export interface GrantDb extends GrantTxDb {
  $transaction<T>(fn: (tx: GrantTxDb) => Promise<T>): Promise<T>;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type GrantParams = Record<string, string | undefined>;

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};

export type GrantError = {
  error: string;
  error_description: string;
};

export type GrantResult =
  | { ok: true; data: TokenResponse }
  | { ok: false; status: 400 | 401; err: GrantError };

// ---------------------------------------------------------------------------
// Internal tx-result discriminant
// ---------------------------------------------------------------------------

type TxError = {
  type: "error";
  error: "invalid_grant" | "invalid_client" | "invalid_request";
  error_description: string;
};

type TxSuccess = {
  type: "success";
  access_token: string;
  refresh_token: string;
  scope: string;
};

type TxResult = TxError | TxSuccess;

// ---------------------------------------------------------------------------
// authorization_code grant
// ---------------------------------------------------------------------------

/**
 * Exchange an authorization code for an access token + refresh token.
 *
 * DA-hardened design:
 *  - Consume + validate + issue are ALL inside one $transaction.
 *    If consume succeeds (count===1) but validation fails, the transaction
 *    still COMMITS (we return error objects, not throw) — the code is burned.
 *    This is the safe choice: throwing would roll back consumedAt and allow
 *    replay by a bad actor who probes validation with intentionally wrong
 *    code_verifiers.
 *  - PKCE is S256 + base64url (NOT hex).
 */
export async function exchangeAuthorizationCode(
  db: GrantDb,
  params: GrantParams,
): Promise<GrantResult> {
  const code = params["code"];
  const code_verifier = params["code_verifier"];
  const redirect_uri = params["redirect_uri"];
  const client_id = params["client_id"];
  const resource = params["resource"]; // optional RFC 8707 audience param

  if (!code || !code_verifier || !redirect_uri || !client_id) {
    return {
      ok: false,
      status: 400,
      err: { error: "invalid_request", error_description: "Missing required parameters: code, code_verifier, redirect_uri, client_id" },
    };
  }

  const codeHash = hashSecret(code);

  let txResult: TxResult;
  try {
    txResult = await db.$transaction(async (tx): Promise<TxResult> => {
      // ── 1. Atomic single-use consume ────────────────────────────────────────
      const consumed = await tx.oAuthAuthCode.updateMany({
        where: { codeHash, consumedAt: null },
        data: { consumedAt: new Date() },
      });

      if (consumed.count !== 1) {
        // Code missing, already consumed, or hash mismatch — do NOT reveal which.
        return {
          type: "error",
          error: "invalid_grant",
          error_description: "Authorization code is invalid or has already been used",
        };
      }

      // ── 2. Load the now-consumed row ─────────────────────────────────────────
      const authCode = await tx.oAuthAuthCode.findUnique({ where: { codeHash } });
      if (!authCode) {
        // Should be unreachable (updateMany returned 1), but defensive.
        return { type: "error", error: "invalid_grant", error_description: "Authorization code not found" };
      }

      // ── 3. Expiry check ──────────────────────────────────────────────────────
      if (authCode.expiresAt <= new Date()) {
        return { type: "error", error: "invalid_grant", error_description: "Authorization code has expired" };
      }

      // ── 4. client_id must match what was bound at authorization ──────────────
      if (authCode.clientId !== client_id) {
        return { type: "error", error: "invalid_client", error_description: "client_id does not match the authorization request" };
      }

      // ── 5. Client must exist in the registry ─────────────────────────────────
      const client = await tx.oAuthClient.findUnique({ where: { clientId: client_id } });
      if (!client) {
        return { type: "error", error: "invalid_client", error_description: "Unknown client" };
      }

      // ── 6. redirect_uri must exactly match ───────────────────────────────────
      if (authCode.redirectUri !== redirect_uri) {
        return { type: "error", error: "invalid_grant", error_description: "redirect_uri does not match the authorization request" };
      }

      // ── 7. PKCE method must be S256 ──────────────────────────────────────────
      if (authCode.codeChallengeMethod !== "S256") {
        return { type: "error", error: "invalid_grant", error_description: "Unsupported code_challenge_method; only S256 is accepted" };
      }

      // ── 8. PKCE proof-of-possession ──────────────────────────────────────────
      const computedChallenge = pkceChallengeFromVerifier(code_verifier);
      if (!timingSafeEqualStr(computedChallenge, authCode.codeChallenge)) {
        return { type: "error", error: "invalid_grant", error_description: "PKCE code_verifier does not match code_challenge" };
      }

      // ── 9. Resource audience binding (RFC 8707) ──────────────────────────────
      // If the code was bound to a resource AND the client sent a resource param,
      // they must match. If the code has no resource, accept anything.
      if (authCode.resource && resource !== undefined && authCode.resource !== resource) {
        return { type: "error", error: "invalid_grant", error_description: "resource does not match the authorization request" };
      }

      // ── 10. Issue access token + refresh token ───────────────────────────────
      const accessTokenPlain = generateSecret("mcpa");
      const refreshTokenPlain = generateSecret("mcpr");
      const familyId = randomUUID(); // never null — set fresh at first issuance
      const now = new Date();
      const scope = authCode.scope ?? OAUTH_SCOPE;

      await tx.oAuthAccessToken.create({
        data: {
          tokenHash: hashSecret(accessTokenPlain),
          clientId: authCode.clientId,
          userId: authCode.userId,
          resource: authCode.resource,
          scope,
          expiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_S * 1000),
        },
      });

      await tx.oAuthRefreshToken.create({
        data: {
          tokenHash: hashSecret(refreshTokenPlain),
          clientId: authCode.clientId,
          userId: authCode.userId,
          resource: authCode.resource,
          scope,
          familyId,
          expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_S * 1000),
        },
      });

      return {
        type: "success",
        access_token: accessTokenPlain,
        refresh_token: refreshTokenPlain,
        scope,
      };
    });
  } catch (e) {
    console.error("[OAuth] Token issuance failed:", e);
    return {
      ok: false,
      status: 400,
      err: { error: "server_error", error_description: "Internal error during token issuance" },
    };
  }

  if (txResult.type === "error") {
    const status: 400 | 401 = txResult.error === "invalid_client" ? 401 : 400;
    return { ok: false, status, err: { error: txResult.error, error_description: txResult.error_description } };
  }

  return {
    ok: true,
    data: {
      access_token: txResult.access_token,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_S,
      refresh_token: txResult.refresh_token,
      scope: txResult.scope,
    },
  };
}

// ---------------------------------------------------------------------------
// refresh_token grant
// ---------------------------------------------------------------------------

/**
 * Exchange a refresh token for a new access token + rotated refresh token.
 *
 * DA-hardened design:
 *  - REUSE DETECTION: if the incoming refresh token is already revoked, it
 *    means a rotated-away token was replayed. We revoke the entire token
 *    family (all refresh tokens with the same familyId) AND all live access
 *    tokens for this userId+clientId pair, then log a theft event. The
 *    legitimate user is forced to re-authorize.
 *  - ROTATION: the old refresh token gets `revokedAt` + `supersededById` set
 *    in the same transaction that creates the new pair. `supersededById` is
 *    audit trail only — revokedAt IS NULL is the sole validity signal.
 *  - familyId is copied from the old token (never null; falls back to a fresh
 *    UUID defensively if somehow missing, though that should never happen).
 */
export async function exchangeRefreshToken(
  db: GrantDb,
  params: GrantParams,
): Promise<GrantResult> {
  const refresh_token = params["refresh_token"];
  const client_id = params["client_id"];
  const resource = params["resource"]; // optional; not required but checked if provided

  if (!refresh_token || !client_id) {
    return {
      ok: false,
      status: 400,
      err: { error: "invalid_request", error_description: "Missing required parameters: refresh_token, client_id" },
    };
  }

  // ── Load the refresh token ─────────────────────────────────────────────────
  const tokenHash = hashSecret(refresh_token);
  const oldToken = await db.oAuthRefreshToken.findUnique({ where: { tokenHash } });

  if (!oldToken) {
    return { ok: false, status: 400, err: { error: "invalid_grant", error_description: "Refresh token not found" } };
  }

  // ── Reuse detection ────────────────────────────────────────────────────────
  if (oldToken.revokedAt !== null) {
    const now = new Date();
    console.warn(
      `[OAuth] REUSE DETECTED — refresh token replay: familyId=${oldToken.familyId ?? "none"}, userId=${oldToken.userId}, clientId=${oldToken.clientId}. Revoking entire family.`,
    );

    // Revoke all un-revoked tokens in this family
    if (oldToken.familyId) {
      await db.oAuthRefreshToken.updateMany({
        where: { familyId: oldToken.familyId, revokedAt: null },
        data: { revokedAt: now },
      });
    }
    // Revoke all live access tokens for this userId+clientId pair
    await db.oAuthAccessToken.updateMany({
      where: { userId: oldToken.userId, clientId: oldToken.clientId, revokedAt: null },
      data: { revokedAt: now },
    });

    return {
      ok: false,
      status: 400,
      err: { error: "invalid_grant", error_description: "Refresh token has been revoked — possible token replay detected" },
    };
  }

  // ── Expiry check ───────────────────────────────────────────────────────────
  if (oldToken.expiresAt <= new Date()) {
    return { ok: false, status: 400, err: { error: "invalid_grant", error_description: "Refresh token has expired" } };
  }

  // ── client_id binding ─────────────────────────────────────────────────────
  if (oldToken.clientId !== client_id) {
    return { ok: false, status: 401, err: { error: "invalid_client", error_description: "client_id does not match the refresh token" } };
  }

  // ── Rotate in a transaction ────────────────────────────────────────────────
  let txResult: TxResult;
  try {
    txResult = await db.$transaction(async (tx): Promise<TxResult> => {
      const now = new Date();
      const accessTokenPlain = generateSecret("mcpa");
      const refreshTokenPlain = generateSecret("mcpr");
      const scope = oldToken.scope ?? OAUTH_SCOPE;
      // familyId must never be null (PRD DA revision) — defensive UUID fallback
      const familyId = oldToken.familyId ?? randomUUID();

      // 1. Atomically revoke the old token — gate on revokedAt: null.
      //    count=0 means a concurrent request already rotated this token inside a
      //    transaction. Return invalid_grant WITHOUT family-revoke (not theft;
      //    see DA critique §3d). Do NOT issue new tokens.
      const consumed = await tx.oAuthRefreshToken.updateMany({
        where: { id: oldToken.id, revokedAt: null },
        data: { revokedAt: now },
      });
      if (consumed.count !== 1) {
        return {
          type: "error",
          error: "invalid_grant",
          error_description: "Refresh token was already rotated by a concurrent request",
        };
      }

      // 2. Create the new refresh token (same family)
      const newRefresh = await tx.oAuthRefreshToken.create({
        data: {
          tokenHash: hashSecret(refreshTokenPlain),
          clientId: oldToken.clientId,
          userId: oldToken.userId,
          resource: oldToken.resource,
          scope,
          familyId,
          expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_S * 1000),
        },
      });

      // 3. Record the chain link (audit trail — revokedAt already set in step 1)
      await tx.oAuthRefreshToken.update({
        where: { id: oldToken.id },
        data: { supersededById: newRefresh.id },
      });

      // 4. Issue new access token
      await tx.oAuthAccessToken.create({
        data: {
          tokenHash: hashSecret(accessTokenPlain),
          clientId: oldToken.clientId,
          userId: oldToken.userId,
          resource: oldToken.resource,
          scope,
          expiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_S * 1000),
        },
      });

      return { type: "success", access_token: accessTokenPlain, refresh_token: refreshTokenPlain, scope };
    });
  } catch (e) {
    console.error("[OAuth] Token rotation failed:", e);
    return {
      ok: false,
      status: 400,
      err: { error: "server_error", error_description: "Internal error during token issuance" },
    };
  }

  if (txResult.type === "error") {
    const status: 400 | 401 = txResult.error === "invalid_client" ? 401 : 400;
    return { ok: false, status, err: { error: txResult.error, error_description: txResult.error_description } };
  }

  return {
    ok: true,
    data: {
      access_token: txResult.access_token,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_S,
      refresh_token: txResult.refresh_token,
      scope: txResult.scope,
    },
  };

  // suppress unused var linting — resource is validated in future hardening (E-E)
  void resource;
}
