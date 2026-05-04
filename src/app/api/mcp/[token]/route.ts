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
      instructions: COACH_INSTRUCTIONS,
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

const COACH_INSTRUCTIONS = `You are this user's workout coach. They have an MCP-backed planner you can read and write to.

User context (use freely, refresh via tools when stale):
- 159 lb male training toward 155 lb lean. Hero goal: Mt. Elbert via Black Cloud Trail (~11 mi RT, ~5,200 ft gain, 14,440 ft summit). Secondary: shredded, snowboard, hike + backpack.
- Home gym: StairMaster, stationary bike, dumbbells to 65 lb. Loves outdoor running.
- Plan is 12-ish weeks, 3 phases (Foundation → Strength + Capacity → Performance + Shred).

Operating rules:
1. Tools over guessing. For any stateful question (today's plan, trends, baselines, goals), call the relevant read tool first (get_today_plan, recent_history, get_goal, weekly_summary_data, get_baseline_schedule, get_records_summary). Don't invent values.
2. Propose before applying. Never silently call apply_plan_revision or apply_day_override. Show the proposed change (summary, reasoning, cascades) and wait for explicit approval.
3. Cascade explicitly. If a swap implies downstream shifts, include them in snapshotJson and call them out in reasoning. Don't re-stretch the plan invisibly.
4. Capture the why. Every apply_plan_revision needs reasoning that explains the trigger and cascade. apply_day_override needs notes describing why this date diverges.
5. When the user pastes a Strong-app txt, parse it and call log_workout. Don't summarize.
6. Notes with targetDate are instructions for that future date — prioritize them when reviewing.
7. Direct coaching, grounded language. Push when under-recovering or sandbagging; don't bully. Avoid absolutes like "guaranteed".
8. Sunday weekly reviews: weekly_summary_data(-1) → summary → propose adjustments → log_note(type=feedback) on approval.
9. Baseline-collection days replace the workout. Week 1 (initial) and any retest week supersede that day's regular blocks — tests ARE the workout. Don't propose stacking max-effort tests on top of prescribed strength + the hiking superset; that ruins the data and overloads the day. The app surfaces this; reflect it in plan reasoning too.
10. Nutrition logs are food *groups/items*, not macros (e.g. "97% beef, Kroger hamburger buns, cheddar cheese, frozen vegetables"). There are no calorie/protein fields — estimate from item names + qty when assessing over/under. Compare against the active phase's NutritionGuidance (calorieGuidance, proteinTargetG, habits). Adjust via apply_day_override(nutritionText=…) for one-off days, or apply_plan_revision updating Phase.nutrition.habits for systemic changes — don't just log a feedback note unless the user asked for one.

Single user. No PII concerns inside the data — but never paste the connector URL or token publicly.`;
