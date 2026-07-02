/**
 * POST /oauth/register
 *
 * Dynamic Client Registration (RFC 7591) endpoint.
 * claude.ai calls this once per connect-flow to register itself as a public
 * OAuth client. The server issues a fresh client_id each time (S-1 spike
 * confirmed: claude.ai re-registers on every new connection — no reuse).
 *
 * S-1 spike-confirmed registration body shape:
 *   { "redirect_uris": ["https://claude.ai/api/mcp/auth_callback"],
 *     "client_name": "Claude" }
 *
 * Public client contract:
 *   - No client_secret ever issued (token_endpoint_auth_method = "none").
 *   - PKCE S256 is the sole proof-of-possession mechanism (enforced at C-2).
 *
 * Abuse posture for C-1:
 *   - Strict body validation + 8 KB payload cap (this handler).
 *   - Row cap: MAX_OAUTH_CLIENTS env (default 500) → 503 on breach.
 *   - Per-IP rate-limiting arrives in E-2 (documented below).
 *   // TODO E-2: add per-IP rate-limiting (Upstash Redis) to this endpoint.
 *
 * runtime="nodejs" — uses Prisma (no edge). Raw `prisma` singleton (never
 * getDb) — this is pre-auth infrastructure; no user scope applies.
 */

import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { dcrValidate } from "@/lib/oauth/dcr-validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/** Maximum row count for OAuthClient before returning 503 (env-configurable). */
function getMaxClients(): number {
  const raw = process.env.MAX_OAUTH_CLIENTS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 500;
}

export async function POST(req: Request): Promise<Response> {
  // ── Payload size guard (8 KB) ─────────────────────────────────────────────
  const contentLength = req.headers.get("content-length");
  if (contentLength && Number(contentLength) > 8 * 1024) {
    return json(
      { error: "invalid_client_metadata", error_description: "Request body exceeds 8 KB limit" },
      413,
    );
  }

  // ── Parse JSON body ───────────────────────────────────────────────────────
  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > 8 * 1024) {
      return json(
        { error: "invalid_client_metadata", error_description: "Request body exceeds 8 KB limit" },
        413,
      );
    }
    body = JSON.parse(text);
  } catch {
    return json(
      { error: "invalid_client_metadata", error_description: "Request body must be valid JSON" },
      400,
    );
  }

  // ── Validate DCR fields ───────────────────────────────────────────────────
  const validation = dcrValidate(body);
  if (!validation.ok) {
    return json(validation.body, validation.status);
  }
  const { clientName, redirectUris } = validation;

  // ── Row cap (abuse posture — per-IP rate-limiting in E-2) ─────────────────
  const count = await prisma.oAuthClient.count();
  if (count >= getMaxClients()) {
    return json({ error: "temporarily_unavailable" }, 503);
  }

  // ── Create client ─────────────────────────────────────────────────────────
  // clientId: "mcp_" + 24 base64url chars (18 random bytes → 24 chars after encoding)
  const clientId = `mcp_${randomBytes(18).toString("base64url")}`;

  const client = await prisma.oAuthClient.create({
    data: {
      clientId,
      clientName: clientName ?? null,
      redirectUris,
      tokenEndpointAuthMethod: "none",
    },
  });

  // ── 201 Created ───────────────────────────────────────────────────────────
  const responseBody = {
    client_id: client.clientId,
    client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
    ...(client.clientName ? { client_name: client.clientName } : {}),
    redirect_uris: client.redirectUris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: "mcp",
  };

  return json(responseBody, 201);
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
}
