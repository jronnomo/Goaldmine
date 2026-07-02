// MCP endpoint with the auth token embedded in the URL path.
// Used because claude.ai's custom-connector dialog only supports OAuth, not
// static bearer tokens. The whole URL becomes the secret — treat it accordingly.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { registerAll, MCP_SERVER_VERSION } from "@/lib/mcp/tools";
import { COACH_INSTRUCTIONS } from "@/lib/mcp/instructions";
import { runWithUser } from "@/lib/db";
import { FOUNDER_USER_ID } from "@/lib/auth/founder";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handler(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  const expected = process.env.MCP_AUTH_TOKEN;
  if (!expected) {
    return new Response("Server misconfigured: MCP_AUTH_TOKEN not set", { status: 500 });
  }

  const { token } = await ctx.params;
  if (!token || !timingSafeEqual(token, expected)) {
    return new Response("Not Found", { status: 404 });
  }

  const server = new McpServer(
    { name: "goaldmine", version: MCP_SERVER_VERSION },
    {
      capabilities: { tools: {} },
      instructions: COACH_INSTRUCTIONS,
    },
  );
  registerAll(server);

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);
  try {
    // This route's shared token maps to the founder identity — mirrors
    // resolveUserIdFromToken's legacy branch — so getDb() inside the tool
    // call tree resolves via the ALS scope instead of falling through to
    // getCurrentUserId()'s session redirect.
    return await runWithUser(FOUNDER_USER_ID, () => transport.handleRequest(req));
  } catch (e) {
    // Any throw that escapes the MCP transport/tool layer lands here.
    // Without this catch, Next.js returns a generic 500 with no body, which
    // surfaces in claude.ai as "Error occurred during tool execution" + a
    // request id — unactionable. Return a JSON-RPC-shaped error so the
    // caller can read what went wrong.
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

// Constant-time string compare so 404 timing doesn't leak token prefix info.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
