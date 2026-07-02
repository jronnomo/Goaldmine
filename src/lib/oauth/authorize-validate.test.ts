// src/lib/oauth/authorize-validate.test.ts
//
// Unit tests for the C-2 authorize request validator (authorize-validate.ts).
// No DB involved — uses in-memory mock doubles.

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  validateAuthorizeParams,
  type AuthorizeDb,
} from "@/lib/oauth/authorize-validate";

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORIGIN = "http://localhost:3000";
const VALID_REDIRECT = "https://claude.ai/api/mcp/auth_callback";

const BASE_CLIENT = {
  clientId: "mcp_testclient123456789",
  clientName: "Claude",
  redirectUris: [VALID_REDIRECT],
};

/** A DB double that resolves findFirst with the given client (or null). */
function makeDb(client: typeof BASE_CLIENT | null): AuthorizeDb {
  return {
    oAuthClient: {
      findFirst: vi.fn().mockResolvedValue(client),
    },
  } as unknown as AuthorizeDb;
}

/** Baseline valid params — all required fields present and correct. */
function validParams(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    client_id: BASE_CLIENT.clientId,
    redirect_uri: VALID_REDIRECT,
    response_type: "code",
    code_challenge: "abc123def456abc123def456abc123def456abc123de",
    code_challenge_method: "S256",
    state: "xyz_state_token",
    scope: "mcp",
    resource: `${ORIGIN}/api/mcp`,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Valid request
// ---------------------------------------------------------------------------

describe("validateAuthorizeParams — valid request", () => {
  it("returns ok:true with all fields populated", async () => {
    const result = await validateAuthorizeParams(
      validParams(),
      makeDb(BASE_CLIENT),
      ORIGIN,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.clientId).toBe(BASE_CLIENT.clientId);
    expect(result.redirectUri).toBe(VALID_REDIRECT);
    expect(result.codeChallenge).toBe(
      "abc123def456abc123def456abc123def456abc123de",
    );
    expect(result.codeChallengeMethod).toBe("S256");
    expect(result.state).toBe("xyz_state_token");
    expect(result.scope).toBe("mcp");
    expect(result.resource).toBe(`${ORIGIN}/api/mcp`);
    expect(result.client.clientName).toBe("Claude");
  });

  it("returns ok:true when resource is absent (allowed — C-3a treats null as mcp audience)", async () => {
    const result = await validateAuthorizeParams(
      validParams({ resource: undefined }),
      makeDb(BASE_CLIENT),
      ORIGIN,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resource).toBeUndefined();
  });

  it("returns ok:true when scope is absent", async () => {
    const result = await validateAuthorizeParams(
      validParams({ scope: undefined }),
      makeDb(BASE_CLIENT),
      ORIGIN,
    );
    expect(result.ok).toBe(true);
  });

  it("returns ok:true when state is absent (optional per spec)", async () => {
    const result = await validateAuthorizeParams(
      validParams({ state: undefined }),
      makeDb(BASE_CLIENT),
      ORIGIN,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state).toBeUndefined();
  });

  it("returns ok:true when resource exactly matches origin/api/mcp", async () => {
    const result = await validateAuthorizeParams(
      validParams({ resource: "http://localhost:3000/api/mcp" }),
      makeDb(BASE_CLIENT),
      ORIGIN,
    );
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Render errors (NEVER redirect — redirect_uri not yet validated)
// ---------------------------------------------------------------------------

describe("validateAuthorizeParams — render errors (cannot redirect)", () => {
  it("returns render-error when client_id is absent", async () => {
    const result = await validateAuthorizeParams(
      validParams({ client_id: undefined }),
      makeDb(BASE_CLIENT),
      ORIGIN,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.mode).toBe("render");
    expect(result.error).toBe("invalid_request");
  });

  it("returns render-error when client_id is unknown (not in DB)", async () => {
    const result = await validateAuthorizeParams(
      validParams({ client_id: "mcp_unknown_xxxxxxxxxxxx" }),
      makeDb(null), // findFirst returns null
      ORIGIN,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.mode).toBe("render");
    expect(result.error).toBe("invalid_client");
  });

  it("returns render-error when redirect_uri is not registered for the client", async () => {
    const result = await validateAuthorizeParams(
      validParams({ redirect_uri: "https://evil.com/callback" }),
      makeDb(BASE_CLIENT),
      ORIGIN,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.mode).toBe("render");
    expect(result.error).toBe("invalid_request");
  });

  it("returns render-error when redirect_uri contains a fragment # (DA FIX-REQUIRED #1)", async () => {
    const result = await validateAuthorizeParams(
      validParams({
        redirect_uri: "https://claude.ai/api/mcp/auth_callback#leaked_code",
      }),
      makeDb(BASE_CLIENT),
      ORIGIN,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.mode).toBe("render");
    expect(result.error).toBe("invalid_request");
    expect(result.errorDescription).toContain("fragment");
  });

  it("returns render-error when redirect_uri is absent", async () => {
    const result = await validateAuthorizeParams(
      validParams({ redirect_uri: undefined }),
      makeDb(BASE_CLIENT),
      ORIGIN,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.mode).toBe("render");
  });
});

// ---------------------------------------------------------------------------
// Redirect errors (redirect_uri is validated; subsequent checks redirect)
// ---------------------------------------------------------------------------

describe("validateAuthorizeParams — redirect errors (redirect_uri validated)", () => {
  it("returns redirect-error when response_type !== 'code'", async () => {
    const result = await validateAuthorizeParams(
      validParams({ response_type: "token" }),
      makeDb(BASE_CLIENT),
      ORIGIN,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.mode).toBe("redirect");
    expect(result.error).toBe("unsupported_response_type");
    expect(result.redirectUri).toBe(VALID_REDIRECT);
    expect(result.state).toBe("xyz_state_token");
  });

  it("returns redirect-error when code_challenge is absent", async () => {
    const result = await validateAuthorizeParams(
      validParams({ code_challenge: undefined }),
      makeDb(BASE_CLIENT),
      ORIGIN,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.mode).toBe("redirect");
    expect(result.error).toBe("invalid_request");
    expect(result.errorDescription).toContain("code_challenge");
  });

  it("returns redirect-error when code_challenge_method is 'plain' (not S256)", async () => {
    const result = await validateAuthorizeParams(
      validParams({ code_challenge_method: "plain" }),
      makeDb(BASE_CLIENT),
      ORIGIN,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.mode).toBe("redirect");
    expect(result.error).toBe("invalid_request");
    expect(result.errorDescription).toContain("S256");
  });

  it("returns redirect-error when code_challenge_method is absent", async () => {
    const result = await validateAuthorizeParams(
      validParams({ code_challenge_method: undefined }),
      makeDb(BASE_CLIENT),
      ORIGIN,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.mode).toBe("redirect");
    expect(result.error).toBe("invalid_request");
  });

  it("returns redirect-error (invalid_scope) when scope is an unknown value", async () => {
    const result = await validateAuthorizeParams(
      validParams({ scope: "openid profile email" }),
      makeDb(BASE_CLIENT),
      ORIGIN,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.mode).toBe("redirect");
    expect(result.error).toBe("invalid_scope");
  });

  it("returns redirect-error (invalid_target) when resource points to an external server", async () => {
    const result = await validateAuthorizeParams(
      validParams({ resource: "https://evil.com/api/mcp" }),
      makeDb(BASE_CLIENT),
      ORIGIN,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.mode).toBe("redirect");
    expect(result.error).toBe("invalid_target");
    expect(result.redirectUri).toBe(VALID_REDIRECT);
  });

  it("returns redirect-error (invalid_target) when resource path differs from /api/mcp", async () => {
    const result = await validateAuthorizeParams(
      validParams({ resource: `${ORIGIN}/api/other` }),
      makeDb(BASE_CLIENT),
      ORIGIN,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.mode).toBe("redirect");
    expect(result.error).toBe("invalid_target");
  });

  it("preserves state in every redirect error", async () => {
    const result = await validateAuthorizeParams(
      validParams({ response_type: "token", state: "my_state_value" }),
      makeDb(BASE_CLIENT),
      ORIGIN,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.state).toBe("my_state_value");
  });
});
