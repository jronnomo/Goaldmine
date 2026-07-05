// SPIKE (AS-0) — stores a PushSubscription for the Web Push viability spike.
// Public route, self-gated via requireSpikeKey (see src/lib/spike-push.ts).

import { requireSpikeKey, getSpikeRedis, SPIKE_SUBSCRIPTION_KEY } from "@/lib/spike-push";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const denied = requireSpikeKey(req);
  if (denied) return denied;

  // No Zod here — throwaway route, hand-rolled shape check is intentional
  // (deviates from the house "all tool inputs validated with Zod" rule;
  // this is non-MCP, deletable code, not a permanent tool surface).
  const body: unknown = await req.json().catch(() => null);
  const b = body as
    | { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }
    | null;
  if (
    !b ||
    typeof b.endpoint !== "string" ||
    typeof b.keys?.p256dh !== "string" ||
    typeof b.keys?.auth !== "string"
  ) {
    return Response.json({ error: "invalid_subscription" }, { status: 400 });
  }

  const redis = getSpikeRedis();
  if (!redis) {
    return Response.json(
      { error: "server_misconfigured", message: "UPSTASH_REDIS_REST_URL/TOKEN not set" },
      { status: 503 },
    );
  }

  // @upstash/redis auto-deserializes on .get() (automaticDeserialization
  // defaults to true) — store the object directly, do NOT JSON.stringify it
  // here (that would make .get() hand back a JSON string that itself needs
  // parsing, defeating the auto-deserialization and inviting a double-parse
  // bug on the read side).
  await redis.set(SPIKE_SUBSCRIPTION_KEY, body);
  return Response.json({ ok: true });
}
