/**
 * C-2 authorize request validator — pure, unit-testable.
 *
 * Used by:
 *  - src/app/oauth/authorize/page.tsx   (validate before rendering consent)
 *  - src/lib/oauth/authorize-actions.ts (re-validate inside Allow / Deny actions)
 *
 * Design notes:
 *  - Takes a minimal Prisma-like interface (`AuthorizeDb`) so tests can inject
 *    simple mock objects without mocking the entire Prisma client.
 *  - `origin` is the canonical server origin (e.g. "http://localhost:3000" in dev,
 *    "https://goaldmine.com" in prod). Used for RFC 8707 resource validation.
 *
 * C-3a implementation notes (preserved here):
 *  - C-3a MUST read `codeChallengeMethod` from the stored OAuthAuthCode row —
 *    never hardcode "S256" at the token exchange step.
 *  - `userId` is NEVER read from formData; only from auth() session.
 *
 * Security invariants (DA FIX-REQUIRED #1 + #6 + #9a):
 *  1. Unknown client_id OR unregistered redirect_uri OR fragment in redirect_uri
 *     → mode "render" (NEVER redirect to an untrusted URI).
 *  6. Phishing-resistant: redirect_uri HOST is the trust anchor, not clientName.
 *  9a. RFC 8707 resource: if present and !== `${origin}/api/mcp` → redirect
 *     error=invalid_target.
 */

// Minimal DB interface — easy to satisfy with a test double.
export type AuthorizeDb = {
  oAuthClient: {
    findFirst(args: {
      where: { clientId: string };
    }): Promise<{
      clientId: string;
      clientName: string | null;
      redirectUris: string[];
    } | null>;
  };
};

// ---------------------------------------------------------------------------
// Return types
// ---------------------------------------------------------------------------

export type ValidateOk = {
  ok: true;
  client: { clientId: string; clientName: string | null; redirectUris: string[] };
  redirectUri: string;
  clientId: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  resource: string | undefined;
  scope: string | undefined;
  state: string | undefined;
};

export type ValidateError = {
  ok: false;
  /** "render" = cannot trust redirectUri (MUST render inline error, NEVER redirect)
   *  "redirect" = redirectUri is validated, may redirect with error params */
  mode: "render" | "redirect";
  error: string;
  errorDescription: string;
  /** Present only when mode === "redirect" */
  redirectUri?: string;
  state?: string;
};

export type ValidateResult = ValidateOk | ValidateError;

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * Validate an OAuth 2.1 / MCP authorize request.
 *
 * @param params  The awaited searchParams (page.tsx) or formData converted to
 *                a plain Record (authorize-actions.ts).
 * @param db      AuthorizeDb — raw prisma or a test double.
 * @param origin  Canonical server origin without trailing slash, e.g.
 *                "http://localhost:3000" or "https://goaldmine.com".
 */
export async function validateAuthorizeParams(
  params: Record<string, string | undefined>,
  db: AuthorizeDb,
  origin: string,
): Promise<ValidateResult> {
  const clientId = params["client_id"] || undefined;
  const redirectUri = params["redirect_uri"] || undefined;
  const responseType = params["response_type"] || undefined;
  const codeChallenge = params["code_challenge"] || undefined;
  const codeChallengeMethod = params["code_challenge_method"] || undefined;
  const state = params["state"] || undefined;
  const scope = params["scope"] || undefined;
  const resource = params["resource"] || undefined;

  // ── Step 1: validate client_id + redirect_uri ───────────────────────────────
  // Per OAuth 2.1 §4.1.2.1: ONLY redirect errors when redirect_uri is validated.
  // Any failure before redirect_uri is confirmed must render an inline error.

  if (!clientId) {
    return {
      ok: false,
      mode: "render",
      error: "invalid_request",
      errorDescription: "Missing client_id parameter",
    };
  }

  // DA FIX-REQUIRED #1: reject any redirect_uri containing a fragment (#).
  // A fragment would allow code leakage via Referer headers (RFC 6749 §3.1.2).
  if (redirectUri && redirectUri.includes("#")) {
    return {
      ok: false,
      mode: "render",
      error: "invalid_request",
      errorDescription: "redirect_uri must not contain a fragment (#)",
    };
  }

  const client = await db.oAuthClient.findFirst({ where: { clientId } });

  if (!client) {
    return {
      ok: false,
      mode: "render",
      error: "invalid_client",
      errorDescription: `Unknown client_id "${clientId}"`,
    };
  }

  if (!redirectUri) {
    return {
      ok: false,
      mode: "render",
      error: "invalid_request",
      errorDescription: "Missing redirect_uri parameter",
    };
  }

  // Exact-match check against the registered set.
  if (!client.redirectUris.includes(redirectUri)) {
    return {
      ok: false,
      mode: "render",
      error: "invalid_request",
      errorDescription: "redirect_uri is not registered for this client",
    };
  }

  // ── redirect_uri is now validated ── errors below MAY redirect ────────────

  if (responseType !== "code") {
    return {
      ok: false,
      mode: "redirect",
      error: "unsupported_response_type",
      errorDescription: `response_type "${responseType ?? ""}" is not supported; use "code"`,
      redirectUri,
      state,
    };
  }

  // PKCE is required (OAuth 2.1 mandate, spike-confirmed for MCP).
  if (!codeChallenge) {
    return {
      ok: false,
      mode: "redirect",
      error: "invalid_request",
      errorDescription: "code_challenge is required (PKCE S256 mandatory)",
      redirectUri,
      state,
    };
  }

  if (codeChallengeMethod !== "S256") {
    return {
      ok: false,
      mode: "redirect",
      error: "invalid_request",
      errorDescription: `code_challenge_method "${codeChallengeMethod ?? "plain"}" is not supported; use S256`,
      redirectUri,
      state,
    };
  }

  // scope: absent or exactly "mcp".
  if (scope !== undefined && scope !== "mcp") {
    return {
      ok: false,
      mode: "redirect",
      error: "invalid_scope",
      errorDescription: `scope "${scope}" is not supported on this server; use "mcp"`,
      redirectUri,
      state,
    };
  }

  // DA #9a — RFC 8707 resource indicator: if present, must be our MCP endpoint.
  // Absent resource is allowed (C-3a treats null as the mcp audience).
  if (resource !== undefined && resource !== `${origin}/api/mcp`) {
    return {
      ok: false,
      mode: "redirect",
      error: "invalid_target",
      errorDescription: `resource "${resource}" does not match this server's MCP endpoint`,
      redirectUri,
      state,
    };
  }

  return {
    ok: true,
    client,
    redirectUri,
    clientId,
    codeChallenge,
    codeChallengeMethod,
    resource,
    scope,
    state,
  };
}
