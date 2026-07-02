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
 * Derive the canonical OAuth issuer origin for this request.
 *
 * Priority order:
 *  1. `process.env.CANONICAL_ORIGIN` — hard-coded on production deploys where
 *     the issuer must be stable across Vercel preview URLs and custom domains.
 *     Set this in Vercel's environment variables for prod (e.g. "https://goaldmine.com").
 *  2. The origin of the incoming request URL — works for localhost dev and
 *     Vercel preview deployments without any extra configuration.
 *
 * Multi-domain note: if your deployment answers on multiple hostnames (e.g.
 * `goaldmine.com` and `www.goaldmine.com`), set CANONICAL_ORIGIN to the primary
 * and add a DNS-level redirect for the alias — the OAuth `issuer` value must be
 * constant across all requests or clients will cache-miss on discovery.
 */
export function deriveOrigin(req: Request): string {
  const canonical = process.env.CANONICAL_ORIGIN;
  if (canonical) return canonical.replace(/\/+$/, ""); // strip trailing slash(es)

  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}
