/**
 * GET /.well-known/oauth-authorization-server
 *
 * RFC 8414 (OAuth 2.0 Authorization Server Metadata) discovery document.
 * Returned after the client follows authorization_servers[0] from the
 * protected-resource document. Advertises the full OAuth server surface.
 *
 * S-1 spike-confirmed field values:
 *   - token_endpoint_auth_methods_supported: ["none"]  (public client — no secret)
 *   - code_challenge_methods_supported: ["S256"]        (PKCE S256 only)
 *   - grant_types_supported: ["authorization_code", "refresh_token"]
 *   - scopes_supported: ["mcp"]
 *
 * NOTE: authorization_endpoint (/oauth/authorize) returns 404 until C-2.
 *       token_endpoint (/oauth/token) returns 404 until C-3a.
 *       revocation_endpoint will be added to this document in C-3b when the
 *       endpoint itself is built. Do not add it here speculatively.
 *       registration_endpoint (/oauth/register) is live as of C-1.
 *
 * runtime="nodejs" — no DB access; pure JSON response.
 */

import { deriveOrigin } from "@/lib/oauth/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function GET(req: Request): Promise<Response> {
  const origin = deriveOrigin(req);

  const doc = {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["mcp"],
  };

  return new Response(JSON.stringify(doc), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
      ...CORS_HEADERS,
    },
  });
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
