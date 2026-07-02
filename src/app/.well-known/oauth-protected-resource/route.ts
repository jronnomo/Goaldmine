/**
 * GET /.well-known/oauth-protected-resource
 *
 * RFC 9728 (OAuth 2.0 Protected Resource Metadata) discovery document.
 * claude.ai fetches this first (after the 401 challenge from /api/mcp) to
 * discover which authorization server to use for the resource.
 *
 * S-1 spike-confirmed flow:
 *   POST /api/mcp (no token)
 *     → 401 WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource"
 *     → client GETs this document
 *     → follows authorization_servers[0] to /.well-known/oauth-authorization-server
 *     → DCR → authorize → token → authenticated MCP call
 *
 * NOTE: /oauth/authorize + /oauth/token return 404 until C-2 / C-3a are built.
 * This is expected on feature/phase1-auth; the connector cannot complete the
 * flow yet. These documents are the discovery foundation for those stories.
 *
 * runtime="nodejs" — no edge runtime restriction; uses Node.js crypto via
 * deriveOrigin → URL. No DB access needed for this route.
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
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    scopes_supported: ["mcp"],
    bearer_methods_supported: ["header"],
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
