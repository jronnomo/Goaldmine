/**
 * C-1 OAuth shared helpers — pure, no DB, unit-tested.
 *
 * Used by C-2 (authorize consent), C-3a (token endpoint), and the
 * /oauth/register DCR handler. Keep this file free of DB imports so
 * tests can import it without mocking Prisma.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// Token generation
// ---------------------------------------------------------------------------

/**
 * Generate a URL-safe secret string.
 *
 * The result is the **plaintext** secret — always hash it with `hashSecret`
 * before storing in the database. Never log or return the plaintext in a
 * response (except the one-time issuance to the client).
 *
 * @param prefix  Short human-readable label (e.g. "at" for access tokens,
 *                "rt" for refresh tokens, "mcp" for public client IDs).
 * @returns       `<prefix>_<43 base64url chars>`  (prefix + "_" + 32 random bytes)
 */
export function generateSecret(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

/**
 * SHA-256 hex digest of a secret string.
 *
 * This is what gets stored in the database for access tokens, refresh tokens,
 * and auth codes — the plaintext is never persisted after issuance.
 *
 * Hash stability: deterministic for the same input string (same algorithm,
 * no salt). Tests can verify that `hashSecret(hashSecret(x)) !== hashSecret(x)`.
 */
export function hashSecret(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

// ---------------------------------------------------------------------------
// TTL constants (seconds)
// ---------------------------------------------------------------------------

/** Access token lifetime: 1 hour (spike-confirmed as typical MCP connector cadence). */
export const ACCESS_TOKEN_TTL_S = 3600;

/** Refresh token lifetime: 30 days. Rotation resets the clock (C-3a). */
export const REFRESH_TOKEN_TTL_S = 30 * 24 * 3600;

/** Auth code lifetime: 5 minutes. Single-use; consumed immediately on token exchange. */
export const AUTH_CODE_TTL_S = 300;

/**
 * Canonical OAuth scope string.
 * Spike-confirmed: claude.ai sends `scope=mcp` on every authorize request.
 * `token_endpoint_auth_methods_supported: ["none"]` + this scope are the two
 * client-facing invariants of this server.
 */
export const OAUTH_SCOPE = "mcp";

// ---------------------------------------------------------------------------
// PKCE helpers (RFC 7636)
// ---------------------------------------------------------------------------

/**
 * Compute the S256 PKCE code challenge from a verifier.
 *
 * Per RFC 7636 §4.2:
 *   code_challenge = BASE64URL(SHA256(ASCII(code_verifier)))
 *
 * This is base64url WITHOUT padding — the `"base64url"` digest encoding in
 * Node.js produces unpadded output by default (confirmed: same as the RFC).
 *
 * DA revision (C-3a): MUST use base64url encoding here — NOT hex. The
 * authorize endpoint stores `codeChallenge` as base64url (from the
 * claude.ai request); the token endpoint must produce the same encoding to
 * compare with timingSafeEqualStr.
 */
export function pkceChallengeFromVerifier(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

/**
 * Constant-time string comparison.
 *
 * DA revision (C-3a): LENGTH-GUARD is MANDATORY — `timingSafeEqual` throws
 * a `RangeError` when the two Buffers have different lengths. The short-
 * circuit `ab.length === bb.length &&` prevents that throw.
 *
 * Encodes both strings as UTF-8 Buffers. For ASCII tokens (all tokens in
 * this codebase), byte-length equals character-length.
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// ---------------------------------------------------------------------------
// Origin derivation
// ---------------------------------------------------------------------------

/**
 * Returns true if the given Host header value is a host we trust when
 * CANONICAL_ORIGIN is unset (dev / Vercel preview).
 *
 * Normalizes to lowercase and strips a trailing FQDN dot + port suffix before
 * matching, so "localhost:3000", "LOCALHOST", and "foo.vercel.app." all work.
 * Trusts localhost, 127.0.0.1, [::1] (loopback), *.vercel.app (preview deploys),
 * and any host listed in the ALLOWED_ORIGIN_HOSTS env var (comma-separated).
 */
function isTrustedHost(host: string): boolean {
  const lower = host.toLowerCase().replace(/\.$/, "").replace(/:\d+$/, "");
  if (lower === "localhost" || lower === "127.0.0.1" || lower === "[::1]") return true;
  if (lower.endsWith(".vercel.app")) return true;
  const allowList = (process.env.ALLOWED_ORIGIN_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase().replace(/\.$/, ""))
    .filter(Boolean);
  return allowList.includes(lower);
}

/**
 * Derive the canonical OAuth issuer origin for this request.
 *
 * Priority order:
 *  1. `process.env.CANONICAL_ORIGIN` — hard-coded on production deploys where
 *     the issuer must be stable across Vercel preview URLs and custom domains.
 *     Set this in Vercel's environment variables for prod (e.g. "https://goaldmine.com").
 *  2. The origin of the incoming request URL — validated against isTrustedHost
 *     before use. Throws for untrusted hosts (fail-closed; never mints a token
 *     bound to an attacker-controlled origin).
 *
 * Multi-domain note: if your deployment answers on multiple hostnames (e.g.
 * `goaldmine.com` and `www.goaldmine.com`), set CANONICAL_ORIGIN to the primary
 * and add a DNS-level redirect for the alias — the OAuth `issuer` value must be
 * constant across all requests or clients will cache-miss on discovery.
 */
export function deriveOrigin(req: Request): string {
  const canonical = process.env.CANONICAL_ORIGIN;
  if (canonical) return canonical.replace(/\/+$/, ""); // strip trailing slash(es)

  // CANONICAL_ORIGIN not set — validate the request host before trusting it.
  // new URL() normalizes ASCII hostnames to lowercase, so url.host is already lower.
  const url = new URL(req.url);
  if (!isTrustedHost(url.host)) {
    throw new Error(`Untrusted origin host: ${url.host}`);
  }
  return `${url.protocol}//${url.host}`;
}

// ---------------------------------------------------------------------------
// RSC-safe origin derivation (no Request object available in server components)
// ---------------------------------------------------------------------------

/**
 * Derive the canonical OAuth issuer origin from Next.js `headers()`.
 *
 * Mirrors the precedence of `deriveOrigin` exactly:
 *  1. `CANONICAL_ORIGIN` env var (production hard-lock, trailing slash stripped)
 *  2. `x-forwarded-proto` + `host` headers — validated against isTrustedHost
 *     (fail-closed; throws for untrusted hosts). Uses the normalized (lowercase,
 *     trailing-dot-stripped) host in the returned URL so the issuer string is
 *     canonical regardless of raw header casing.
 *
 * Use this from RSC pages/layouts where no `Request` object is available.
 * Use `deriveOrigin(req)` from API route handlers.
 *
 * Both paths produce the same value when CANONICAL_ORIGIN is set — which is
 * the only case that matters for production correctness.  The displayed
 * connector URL `${originFromHeaders(h)}/api/mcp` will match the `resource`
 * value advertised by the discovery route (which calls `deriveOrigin`).
 */
export function originFromHeaders(h: Headers): string {
  const canonical = process.env.CANONICAL_ORIGIN;
  // Mirror deriveOrigin: falsy check (not nullish) so empty string falls through
  if (canonical) return canonical.replace(/\/+$/, "");

  // CANONICAL_ORIGIN not set — validate the Host header before trusting it.
  const rawHost = h.get("host") ?? "localhost:3000";
  if (!isTrustedHost(rawHost)) {
    throw new Error(`Untrusted origin host: ${rawHost}`);
  }
  // Normalize to lowercase + strip trailing FQDN dot so the issuer string is canonical.
  const normalizedHost = rawHost.toLowerCase().replace(/\.$/, "");
  return `${h.get("x-forwarded-proto") ?? "http"}://${normalizedHost}`;
}
