// MCP endpoint with the auth token embedded in the URL path.
// Used because claude.ai's custom-connector dialog only supports OAuth, not
// static bearer tokens. The whole URL becomes the secret — treat it accordingly.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { registerAll } from "@/lib/mcp/tools";

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
    { name: "workout-planner", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Workout coaching MCP for one user. Use read tools to gather context (today/recent_history/get_goal) before proposing plan changes. apply_plan_revision writes a full snapshot — include cascading edits in the snapshot, capture reasoning. apply_day_override is for single-day swaps without revising the full plan.",
    },
  );
  registerAll(server);

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);
  return transport.handleRequest(req);
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
