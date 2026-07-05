// SPIKE (AS-0) — sends a test Web Push notification to the stored
// subscription. Public route, self-gated via requireSpikeKey.

import webpush, { type PushSubscription } from "web-push";
import { requireSpikeKey, getSpikeRedis, SPIKE_SUBSCRIPTION_KEY } from "@/lib/spike-push";
import { runWithUser, getDb } from "@/lib/db";
import { FOUNDER_USER_ID } from "@/lib/auth/founder";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FALLBACK_BODY = "Test nudge from the Web Push spike \u{1F3AF}";

export async function POST(req: Request): Promise<Response> {
  const denied = requireSpikeKey(req);
  if (denied) return denied;

  const redis = getSpikeRedis();
  if (!redis) {
    return Response.json(
      { error: "server_misconfigured", message: "UPSTASH_REDIS_REST_URL/TOKEN not set" },
      { status: 503 },
    );
  }

  // @upstash/redis defaults automaticDeserialization to true, so a value
  // stored via redis.set(key, subscriptionObject) already comes back parsed
  // — do NOT unconditionally JSON.parse it (that would crash on a real
  // object). Type the read as the expected shape (not <string>), and keep a
  // typeof-string branch as a defensive fallback for the rare case the
  // stored value isn't valid JSON / wasn't auto-parsed.
  const raw = await redis.get<PushSubscription | string>(SPIKE_SUBSCRIPTION_KEY);
  if (!raw) {
    return Response.json({ error: "no subscription stored" }, { status: 404 });
  }
  const subscription: PushSubscription = typeof raw === "string" ? JSON.parse(raw) : raw;

  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT;
  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    return Response.json(
      { error: "server_misconfigured", message: "VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT not set" },
      { status: 503 },
    );
  }
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  // Note read mirrors the legacy MCP token route's founder-scoped pattern
  // (src/app/api/mcp/[token]/route.ts): runWithUser opens the ALS scope so
  // getDb() resolves to the founder-scoped client instead of falling through
  // to getCurrentUserId()'s session redirect (invalid outside an RSC render).
  //
  // Wrapped in its own try/catch with a static fallback on ANY failure — not
  // just "no note found" — because this route can run on a Vercel preview
  // deployment where DATABASE_URL may not be set in Preview scope. A spike
  // whose whole point is testing push must not fail because of DB
  // connectivity; the fallback body removes that risk entirely.
  let body: string = FALLBACK_BODY;
  try {
    const openItem = await runWithUser(FOUNDER_USER_ID, async () => {
      const db = await getDb();
      return db.note.findFirst({
        where: { type: "open_item", resolvedAt: null },
        orderBy: { date: "desc" },
      });
    });
    if (openItem?.body) body = openItem.body;
  } catch (err) {
    console.warn("[spike-push] note read failed, using fallback body:", err);
  }

  const payload = JSON.stringify({ title: "Goaldmine coach", body });

  const start = Date.now();
  try {
    const result = await webpush.sendNotification(subscription, payload);
    return Response.json({ ok: true, statusCode: result.statusCode, ms: Date.now() - start });
  } catch (err: unknown) {
    if ((err as { statusCode?: number }).statusCode === 410) {
      await redis.del(SPIKE_SUBSCRIPTION_KEY);
      return Response.json({ ok: false, gone: true, ms: Date.now() - start });
    }
    return Response.json(
      { ok: false, error: (err as Error).message, ms: Date.now() - start },
      { status: 502 },
    );
  }
}
