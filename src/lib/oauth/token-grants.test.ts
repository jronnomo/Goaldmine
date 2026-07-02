// src/lib/oauth/token-grants.test.ts
//
// Unit tests for C-3a token grant functions (token-grants.ts).
// Uses injected GrantDb mocks — no real Prisma or DB required.
//
// Coverage:
//   exchangeAuthorizationCode:
//     - PKCE challenge match → success
//     - PKCE challenge mismatch → invalid_grant
//     - wrong redirect_uri → invalid_grant
//     - expired code → invalid_grant
//     - consumed code (count!==1) → invalid_grant
//     - unknown client → invalid_client
//   exchangeRefreshToken:
//     - valid refresh → rotation (old revoked + supersededById + new same familyId)
//     - expired refresh → invalid_grant
//     - revoked refresh (reuse) → revokes entire family → invalid_grant
//     - client_id mismatch → invalid_client

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  type GrantDb,
  type GrantTxDb,
} from "@/lib/oauth/token-grants";
import { pkceChallengeFromVerifier, hashSecret } from "@/lib/oauth/tokens";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CLIENT_ID = "mcp_testclient123456789";
const USER_ID = "usr_founder";
const REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";
const RESOURCE = "http://localhost:3000/api/mcp";
const FAMILY_ID = "family-uuid-123";

// A random verifier + matching challenge
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = pkceChallengeFromVerifier(VERIFIER); // base64url S256

const PLAIN_CODE = "mcpc_testcode1234";
const CODE_HASH = hashSecret(PLAIN_CODE);

function futureDate(seconds = 300): Date {
  return new Date(Date.now() + seconds * 1000);
}

function pastDate(seconds = 1): Date {
  return new Date(Date.now() - seconds * 1000);
}

// ---------------------------------------------------------------------------
// Mock GrantDb builder helpers
// ---------------------------------------------------------------------------

/** Build a mock GrantTxDb where all methods are vi.fn() overridable. */
function makeTxDb(overrides: Partial<{
  authCodeCount: number;
  authCodeRow: object | null;
  clientRow: object | null;
  accessTokenCreateResult: object;
  refreshTokenCreateResult: object;
}>): GrantTxDb {
  const {
    authCodeCount = 1,
    authCodeRow = {
      id: "code-row-id",
      userId: USER_ID,
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      codeChallenge: CHALLENGE,
      codeChallengeMethod: "S256",
      resource: RESOURCE,
      scope: "mcp",
      expiresAt: futureDate(300),
      consumedAt: null,
    },
    clientRow = { clientId: CLIENT_ID },
    accessTokenCreateResult = { id: "at-id" },
    refreshTokenCreateResult = { id: "rt-id" },
  } = overrides;

  return {
    oAuthAuthCode: {
      findUnique: vi.fn().mockResolvedValue(authCodeRow),
      updateMany: vi.fn().mockResolvedValue({ count: authCodeCount }),
    },
    oAuthClient: {
      findUnique: vi.fn().mockResolvedValue(clientRow),
    },
    oAuthAccessToken: {
      create: vi.fn().mockResolvedValue(accessTokenCreateResult),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    oAuthRefreshToken: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(refreshTokenCreateResult),
      update: vi.fn().mockResolvedValue({ id: "old-rt-id" }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

/**
 * Wrap a GrantTxDb in a GrantDb by adding a $transaction that runs the
 * callback synchronously (returns whatever the callback returns).
 */
function wrapDb(txDb: GrantTxDb): GrantDb {
  return {
    ...txDb,
    $transaction: vi.fn().mockImplementation(async (fn: (tx: GrantTxDb) => Promise<unknown>) => {
      return fn(txDb);
    }),
  } as GrantDb;
}

// ---------------------------------------------------------------------------
// exchangeAuthorizationCode
// ---------------------------------------------------------------------------

describe("exchangeAuthorizationCode", () => {
  const baseParams = {
    code: PLAIN_CODE,
    code_verifier: VERIFIER,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    resource: RESOURCE,
  };

  it("success: valid code + PKCE → issues access + refresh tokens", async () => {
    const txDb = makeTxDb({});
    const db = wrapDb(txDb);

    const result = await exchangeAuthorizationCode(db, baseParams);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.token_type).toBe("Bearer");
    expect(result.data.expires_in).toBe(3600);
    expect(result.data.scope).toBe("mcp");
    expect(result.data.access_token).toMatch(/^mcpa_/);
    expect(result.data.refresh_token).toMatch(/^mcpr_/);

    // Tokens must be different
    expect(result.data.access_token).not.toBe(result.data.refresh_token);

    // The tx was called
    expect(db.$transaction).toHaveBeenCalledOnce();
  });

  it("PKCE mismatch: invalid_grant", async () => {
    const txDb = makeTxDb({});
    const db = wrapDb(txDb);

    const result = await exchangeAuthorizationCode(db, {
      ...baseParams,
      code_verifier: "wrong-verifier-that-does-not-match-challenge",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.err.error).toBe("invalid_grant");
    expect(result.status).toBe(400);
  });

  it("wrong redirect_uri: invalid_grant", async () => {
    const txDb = makeTxDb({});
    const db = wrapDb(txDb);

    const result = await exchangeAuthorizationCode(db, {
      ...baseParams,
      redirect_uri: "https://evil.example.com/callback",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.err.error).toBe("invalid_grant");
  });

  it("expired code: invalid_grant", async () => {
    const txDb = makeTxDb({
      authCodeRow: {
        id: "code-row-id",
        userId: USER_ID,
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
        codeChallenge: CHALLENGE,
        codeChallengeMethod: "S256",
        resource: RESOURCE,
        scope: "mcp",
        expiresAt: pastDate(1), // expired
        consumedAt: null,
      },
    });
    const db = wrapDb(txDb);

    const result = await exchangeAuthorizationCode(db, baseParams);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.err.error).toBe("invalid_grant");
  });

  it("consumed code (updateMany count=0): invalid_grant", async () => {
    const txDb = makeTxDb({ authCodeCount: 0 });
    const db = wrapDb(txDb);

    const result = await exchangeAuthorizationCode(db, baseParams);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.err.error).toBe("invalid_grant");

    // Tokens must NOT have been issued
    expect(txDb.oAuthAccessToken.create).not.toHaveBeenCalled();
    expect(txDb.oAuthRefreshToken.create).not.toHaveBeenCalled();
  });

  it("unknown client_id (client not in DB): invalid_client → 401", async () => {
    const txDb = makeTxDb({ clientRow: null });
    const db = wrapDb(txDb);

    const result = await exchangeAuthorizationCode(db, baseParams);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.err.error).toBe("invalid_client");
    expect(result.status).toBe(401);
  });

  it("missing required param (no code): invalid_request → 400", async () => {
    const txDb = makeTxDb({});
    const db = wrapDb(txDb);

    const result = await exchangeAuthorizationCode(db, {
      ...baseParams,
      code: undefined,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.err.error).toBe("invalid_request");
    expect(result.status).toBe(400);
    // $transaction must NOT have been called
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("atomicity: updateMany is called with codeHash=hashSecret(code) and consumedAt=null", async () => {
    const txDb = makeTxDb({});
    const db = wrapDb(txDb);

    await exchangeAuthorizationCode(db, baseParams);

    expect(txDb.oAuthAuthCode.updateMany).toHaveBeenCalledWith({
      where: { codeHash: CODE_HASH, consumedAt: null },
      data: { consumedAt: expect.any(Date) },
    });
  });

  it("access token and refresh token are stored with different hashes", async () => {
    const txDb = makeTxDb({});
    const db = wrapDb(txDb);

    await exchangeAuthorizationCode(db, baseParams);

    const atCall = vi.mocked(txDb.oAuthAccessToken.create).mock.calls[0][0];
    const rtCall = vi.mocked(txDb.oAuthRefreshToken.create).mock.calls[0][0];
    expect(atCall.data.tokenHash).not.toBe(rtCall.data.tokenHash);
    expect(atCall.data.tokenHash).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
    expect(rtCall.data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refresh token is created with a non-null familyId", async () => {
    const txDb = makeTxDb({});
    const db = wrapDb(txDb);

    await exchangeAuthorizationCode(db, baseParams);

    const rtCall = vi.mocked(txDb.oAuthRefreshToken.create).mock.calls[0][0];
    expect(rtCall.data.familyId).toBeTruthy();
    expect(typeof rtCall.data.familyId).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// exchangeRefreshToken
// ---------------------------------------------------------------------------

describe("exchangeRefreshToken", () => {
  const PLAIN_RT = "mcpr_testrefreshtoken123";
  const RT_HASH = hashSecret(PLAIN_RT);

  const validOldToken = {
    id: "old-rt-id",
    userId: USER_ID,
    clientId: CLIENT_ID,
    familyId: FAMILY_ID,
    resource: RESOURCE,
    scope: "mcp",
    expiresAt: futureDate(30 * 24 * 3600),
    revokedAt: null,
  };

  function makeRefreshDb(oldToken: object | null): GrantDb {
    const txDb: GrantTxDb = {
      oAuthAuthCode: {
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
      oAuthClient: {
        findUnique: vi.fn(),
      },
      oAuthAccessToken: {
        create: vi.fn().mockResolvedValue({ id: "new-at-id" }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      oAuthRefreshToken: {
        findUnique: vi.fn().mockResolvedValue(oldToken),
        create: vi.fn().mockResolvedValue({ id: "new-rt-id" }),
        update: vi.fn().mockResolvedValue({ id: "old-rt-id" }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    return {
      ...txDb,
      $transaction: vi.fn().mockImplementation(async (fn: (tx: GrantTxDb) => Promise<unknown>) => {
        return fn(txDb);
      }),
    } as GrantDb;
  }

  const baseParams = {
    refresh_token: PLAIN_RT,
    client_id: CLIENT_ID,
    resource: RESOURCE,
  };

  it("success: valid refresh → new access + rotated refresh token", async () => {
    const db = makeRefreshDb(validOldToken);

    const result = await exchangeRefreshToken(db, baseParams);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.token_type).toBe("Bearer");
    expect(result.data.expires_in).toBe(3600);
    expect(result.data.access_token).toMatch(/^mcpa_/);
    expect(result.data.refresh_token).toMatch(/^mcpr_/);
  });

  it("rotation: new refresh token has same familyId as old", async () => {
    const db = makeRefreshDb(validOldToken);
    const txDb = (db as GrantDb & { oAuthRefreshToken: { create: ReturnType<typeof vi.fn> } });

    await exchangeRefreshToken(db, baseParams);

    const createCall = vi.mocked(txDb.oAuthRefreshToken.create).mock.calls[0][0];
    expect(createCall.data.familyId).toBe(FAMILY_ID);
  });

  it("rotation: old refresh token gets revokedAt set + supersededById = new.id", async () => {
    const db = makeRefreshDb(validOldToken);
    const txDb = (db as GrantDb & { oAuthRefreshToken: { update: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> } });

    await exchangeRefreshToken(db, baseParams);

    const updateCall = vi.mocked(txDb.oAuthRefreshToken.update).mock.calls[0][0];
    expect(updateCall.where.id).toBe("old-rt-id");
    expect(updateCall.data.revokedAt).toBeInstanceOf(Date);
    expect(updateCall.data.supersededById).toBe("new-rt-id");
  });

  it("reuse detection: revoked refresh token → revokes whole family + all access tokens → invalid_grant", async () => {
    const revokedToken = {
      ...validOldToken,
      revokedAt: new Date(Date.now() - 1000), // already revoked
    };
    const db = makeRefreshDb(revokedToken);
    const txDb = (db as GrantDb & {
      oAuthRefreshToken: { updateMany: ReturnType<typeof vi.fn> };
      oAuthAccessToken: { updateMany: ReturnType<typeof vi.fn> };
    });

    const result = await exchangeRefreshToken(db, baseParams);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.err.error).toBe("invalid_grant");

    // Entire refresh family must be revoked
    expect(vi.mocked(txDb.oAuthRefreshToken.updateMany)).toHaveBeenCalledWith({
      where: { familyId: FAMILY_ID, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });

    // All live access tokens for this userId+clientId must be revoked
    expect(vi.mocked(txDb.oAuthAccessToken.updateMany)).toHaveBeenCalledWith({
      where: { userId: USER_ID, clientId: CLIENT_ID, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });

    // New tokens must NOT be issued
    expect(vi.mocked(txDb.oAuthRefreshToken.create)).not.toHaveBeenCalled();
    expect(vi.mocked(txDb.oAuthAccessToken.create)).not.toHaveBeenCalled();
  });

  it("expired refresh token: invalid_grant", async () => {
    const expiredToken = { ...validOldToken, expiresAt: pastDate(1) };
    const db = makeRefreshDb(expiredToken);

    const result = await exchangeRefreshToken(db, baseParams);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.err.error).toBe("invalid_grant");
  });

  it("unknown refresh token (not in DB): invalid_grant", async () => {
    const db = makeRefreshDb(null);

    const result = await exchangeRefreshToken(db, baseParams);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.err.error).toBe("invalid_grant");
  });

  it("client_id mismatch: invalid_client → 401", async () => {
    const db = makeRefreshDb(validOldToken);

    const result = await exchangeRefreshToken(db, {
      ...baseParams,
      client_id: "mcp_wrongclient999999",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.err.error).toBe("invalid_client");
    expect(result.status).toBe(401);
  });

  it("missing refresh_token param: invalid_request → 400", async () => {
    const db = makeRefreshDb(validOldToken);

    const result = await exchangeRefreshToken(db, {
      client_id: CLIENT_ID,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.err.error).toBe("invalid_request");
    expect(result.status).toBe(400);
    // findUnique must NOT have been called
    expect(vi.mocked(db.oAuthRefreshToken.findUnique)).not.toHaveBeenCalled();
  });
});
