/**
 * POST /oauth/token
 *
 * OAuth 2.1 token endpoint — thin route wrapper over the testable grant
 * logic in src/lib/oauth/token-grants.ts.
 *
 * S-1 spike-confirmed grant types:
 *   authorization_code — code exchange (PKCE S256; no client_secret)
 *   refresh_token      — rotation-based refresh (server-to-server, python-httpx)
 *
 * Security invariants (DA-hardened revisions — NORMATIVE):
 *  - Cache-Control: no-store on EVERY response (success AND error).
 *  - No client_secret — public client; PKCE S256 is the sole proof.
 *  - Content-Type: application/x-www-form-urlencoded (per OAuth 2.1 spec).
 *  - runtime = "nodejs" — uses raw `prisma` (Prisma requires Node.js runtime).
 *  - CORS headers on every response so browser-facing flows work.
 *
 * The route does NOT call getDb() — OAuth infra is pre-auth and uses raw
 * `prisma` directly (see CLAUDE.md "C-1 OAuth server models" note).
 */

import { prisma } from "@/lib/db";
import {
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  type GrantDb,
  type GrantParams,
} from "@/lib/oauth/token-grants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Shared response headers
// ---------------------------------------------------------------------------

const NO_STORE = "no-store";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function makeHeaders(extra?: Record<string, string>): Headers {
  const h = new Headers({ ...CORS_HEADERS, ...extra });
  h.set("Cache-Control", NO_STORE);
  return h;
}

function errorResponse(status: number, error: string, errorDescription: string): Response {
  return Response.json(
    { error, error_description: errorDescription },
    { status, headers: makeHeaders() },
  );
}

// ---------------------------------------------------------------------------
// POST /oauth/token
// ---------------------------------------------------------------------------

export async function POST(req: Request): Promise<Response> {
  // ── Parse application/x-www-form-urlencoded body ────────────────────────
  let body: URLSearchParams;
  try {
    const text = await req.text();
    body = new URLSearchParams(text);
  } catch {
    return errorResponse(400, "invalid_request", "Could not parse request body");
  }

  // Flatten to a simple params map (GrantParams = Record<string, string | undefined>)
  const params: GrantParams = {};
  for (const [k, v] of body.entries()) {
    params[k] = v;
  }

  const grant_type = params["grant_type"];

  if (!grant_type) {
    return errorResponse(400, "invalid_request", "grant_type is required");
  }

  // Cast: PrismaClient is a structural superset of GrantDb — all required
  // methods exist with compatible signatures. `as unknown` avoids the
  // $transaction callback-type mismatch between Prisma's generic form and
  // our minimal interface.
  const db = prisma as unknown as GrantDb;

  // ── Dispatch on grant_type ──────────────────────────────────────────────
  if (grant_type === "authorization_code") {
    const result = await exchangeAuthorizationCode(db, params);
    if (!result.ok) {
      return errorResponse(result.status, result.err.error, result.err.error_description);
    }
    return Response.json(result.data, { status: 200, headers: makeHeaders({ "Content-Type": "application/json" }) });
  }

  if (grant_type === "refresh_token") {
    const result = await exchangeRefreshToken(db, params);
    if (!result.ok) {
      return errorResponse(result.status, result.err.error, result.err.error_description);
    }
    return Response.json(result.data, { status: 200, headers: makeHeaders({ "Content-Type": "application/json" }) });
  }

  return errorResponse(400, "unsupported_grant_type", `Unsupported grant_type: ${grant_type}`);
}

// ---------------------------------------------------------------------------
// OPTIONS (CORS preflight)
// ---------------------------------------------------------------------------

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS_HEADERS,
      "Cache-Control": NO_STORE,
      "Access-Control-Max-Age": "86400",
    },
  });
}
