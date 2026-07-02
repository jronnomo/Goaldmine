import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { registerAll, MCP_SERVER_VERSION } from "@/lib/mcp/tools";
import { COACH_INSTRUCTIONS } from "@/lib/mcp/instructions";
import { resolveUserIdFromToken } from "@/lib/auth/current-user";
import { runWithUser } from "@/lib/db";
import { deriveOrigin } from "@/lib/oauth/tokens";
import { checkRateLimit, plainRateLimitResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handler(req: Request): Promise<Response> {
  // ── Auth: per-user OAuth token (C-3a) with legacy-token fallback ──────────
  // resolveUserIdFromToken returns null when no valid identity is established.
  // The caller MUST null-guard before runWithUser (which accepts string only).
  const authz = req.headers.get("authorization") ?? "";
  const token = authz.startsWith("Bearer ") ? authz.slice(7).trim() : null;
  const userId = token ? await resolveUserIdFromToken(token) : null;

  if (!userId) {
    // C-1 (REQ-005 + DA fix #1): exact spike-proven format — NO realm.
    // claude.ai reads this header to discover the protected-resource metadata URL,
    // then fetches /.well-known/oauth-protected-resource to begin the OAuth flow.
    const origin = deriveOrigin(req);
    return new Response("Unauthorized", {
      status: 401,
      headers: {
        "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
      },
    });
  }

  // ── E-2: Per-userId rate limit (60 req/min) ─────────────────────────────
  //
  // Transport-level reject: occurs before MCP server construction + JSON-RPC
  // dispatch. Return a plain HTTP 429, NOT a JSON-RPC error envelope (the
  // limiter sits before transport.handleRequest, so there is no JSON-RPC
  // context to wrap). claude.ai backs off on 429 + Retry-After.
  //
  // CORS headers are required: claude.ai calls /api/mcp cross-origin. A 429
  // without Access-Control-Allow-Origin is blocked by the browser before
  // claude.ai can read the Retry-After header. Headers match the OPTIONS
  // export exactly.
  const { ok: rateLimitOk, retryAfterSeconds } = await checkRateLimit(
    "mcp",
    userId,
  );
  if (!rateLimitOk) {
    return plainRateLimitResponse(retryAfterSeconds, {
      "Access-Control-Allow-Origin":  "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Session-Id",
    });
  }

  // E4a: open the AsyncLocalStorage scope so getDb() resolves to this user
  // inside the tool-call chain. Tools still use raw `prisma` until E4b
  // migrates them — this wiring is forward-setup only; no behavior change.

  const server = new McpServer(
    { name: "goaldmine", version: MCP_SERVER_VERSION },
    {
      capabilities: { tools: {} },
      instructions: COACH_INSTRUCTIONS,
    },
  );
  registerAll(server);

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless: each request stands alone
    enableJsonResponse: true,
  });

  await server.connect(transport);
  try {
    return await runWithUser(userId, () => transport.handleRequest(req));
  } catch (e) {
    // Any throw that escapes the MCP transport/tool layer lands here. Without
    // this catch, Next.js returns a generic 500 with no body, which surfaces
    // in claude.ai as "Error occurred during tool execution" + a request id —
    // unactionable. Return a JSON-RPC-shaped error so the caller can read
    // what went wrong.
    const message = e instanceof Error ? e.message : String(e);
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32603, message: `MCP transport error: ${message}` },
        id: null,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

export const GET = handler;
export const POST = handler;
export const DELETE = handler;

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Session-Id",
    },
  });
}
