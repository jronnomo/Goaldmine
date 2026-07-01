import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { registerAll, MCP_SERVER_VERSION } from "@/lib/mcp/tools";
import { COACH_INSTRUCTIONS } from "@/lib/mcp/instructions";
import { resolveUserIdFromToken } from "@/lib/auth/current-user";
import { runWithUser } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handler(req: Request): Promise<Response> {
  const expected = process.env.MCP_AUTH_TOKEN;
  if (!expected) {
    return new Response("Server misconfigured: MCP_AUTH_TOKEN not set", { status: 500 });
  }

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  if (!token || token !== expected) {
    return new Response("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": 'Bearer realm="workout-planner-mcp"' },
    });
  }

  const userId = await resolveUserIdFromToken(token);
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
