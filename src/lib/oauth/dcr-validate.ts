/**
 * C-1 DCR body validator — pure, testable, no DB.
 *
 * Validates a Dynamic Client Registration (RFC 7591) request body
 * against the constraints enforced by this server. Returns a typed
 * discriminated union so callers don't parse error shapes.
 *
 * Redirect-URI host policy (DA hardened):
 *   Default allowed: claude.ai, claude.com (https, incl. subdomains)
 *                    localhost, 127.0.0.1 (http or https, any port)
 *   Extended by:     env ALLOWED_REDIRECT_HOSTS (comma-separated hostnames)
 *   Rejected:        everything else → 400 invalid_redirect_uri
 */

/** Default set of allowed redirect_uri hosts (https required for non-local). */
const DEFAULT_ALLOWED_HOSTS = ["claude.ai", "claude.com"];

/**
 * Returns true if `uri` is an allowed redirect_uri per server policy.
 *
 * Rules:
 *  - Must be a valid absolute URL (scheme + host required).
 *  - localhost / 127.0.0.1: http or https allowed, any port.
 *  - claude.ai, claude.com + their subdomains: https only.
 *  - Additional hosts from env ALLOWED_REDIRECT_HOSTS: https only.
 *  - All others: rejected.
 */
function isAllowedRedirectUri(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false; // malformed or non-absolute URL
  }

  const { protocol, hostname } = url;

  // Loopback: allow http or https on any port (native clients like Claude Code)
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return protocol === "https:" || protocol === "http:";
  }

  // Non-local: must be HTTPS
  if (protocol !== "https:") return false;

  // Build the full allowed-host set: defaults + env extension
  const envExtra = (process.env.ALLOWED_REDIRECT_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);

  const allowedHosts = [...DEFAULT_ALLOWED_HOSTS, ...envExtra];

  // Exact match OR any subdomain of an allowed host
  for (const allowed of allowedHosts) {
    if (hostname === allowed || hostname.endsWith("." + allowed)) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Return types
// ---------------------------------------------------------------------------

export type DcrValidateOk = {
  ok: true;
  clientName: string | undefined;
  redirectUris: string[];
  tokenEndpointAuthMethod: "none";
};

export type DcrValidateError = {
  ok: false;
  status: 400 | 413;
  body: { error: string; error_description?: string };
};

export type DcrValidateResult = DcrValidateOk | DcrValidateError;

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * Validate a parsed DCR request body.
 *
 * @param body  The JSON-parsed request body (unknown — may be anything).
 * @returns     `{ ok: true, ... }` on success or `{ ok: false, status, body }` on error.
 */
export function dcrValidate(body: unknown): DcrValidateResult {
  // Must be a plain JSON object
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "invalid_client_metadata",
        error_description: "Request body must be a JSON object",
      },
    };
  }

  const obj = body as Record<string, unknown>;

  // ── redirect_uris: required, non-empty, ≤10 entries, each valid + allowed ──

  const rawUris = obj["redirect_uris"];
  if (!Array.isArray(rawUris) || rawUris.length === 0) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "invalid_redirect_uri",
        error_description:
          "redirect_uris is required and must be a non-empty array",
      },
    };
  }
  if (rawUris.length > 10) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "invalid_redirect_uri",
        error_description: "redirect_uris must not exceed 10 entries",
      },
    };
  }
  for (const uri of rawUris) {
    if (typeof uri !== "string" || !isAllowedRedirectUri(uri)) {
      return {
        ok: false,
        status: 400,
        body: {
          error: "invalid_redirect_uri",
          error_description: `Redirect URI not permitted: ${
            typeof uri === "string" ? uri : "(non-string entry)"
          }`,
        },
      };
    }
  }
  const redirectUris = rawUris as string[];

  // ── client_name: optional, trim, ≤120 chars ──────────────────────────────

  let clientName: string | undefined;
  if (obj["client_name"] !== undefined) {
    if (typeof obj["client_name"] !== "string") {
      return {
        ok: false,
        status: 400,
        body: {
          error: "invalid_client_metadata",
          error_description: "client_name must be a string",
        },
      };
    }
    const trimmed = obj["client_name"].trim();
    if (trimmed.length > 120) {
      return {
        ok: false,
        status: 400,
        body: {
          error: "invalid_client_metadata",
          error_description: "client_name must not exceed 120 characters after trimming",
        },
      };
    }
    clientName = trimmed || undefined; // treat empty-after-trim as absent
  }

  // ── token_endpoint_auth_method: absent or "none" ──────────────────────────

  const authMethod = obj["token_endpoint_auth_method"];
  if (authMethod !== undefined && authMethod !== "none") {
    return {
      ok: false,
      status: 400,
      body: {
        error: "invalid_client_metadata",
        error_description: `token_endpoint_auth_method must be "none" (public client only); received: "${authMethod}"`,
      },
    };
  }

  // ── Unknown fields are silently ignored (RFC 7591 §2) ────────────────────

  return {
    ok: true,
    clientName,
    redirectUris,
    tokenEndpointAuthMethod: "none",
  };
}
