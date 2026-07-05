# Architecture Blueprint — AS-0 Web Push Spike

Order of truth: PRD-as0-web-push-spike.md → requirements.md (REQ-001..005) → this file. Follow signatures exactly.

---

## 1. Shared spike helper — `src/lib/spike-push.ts` (new)

One throwaway file, two exports, no import from `oauth/` or `rate-limit.ts` (keeps `git rm` clean when the spike is deleted).

```ts
import { createHash, timingSafeEqual } from "node:crypto";
import { Redis } from "@upstash/redis";

// Fail-closed: unset SPIKE_PUSH_KEY → 503; header mismatch → 401; ok → null.
// Both sides SHA-256 hashed first so timingSafeEqual gets fixed-length (32B)
// buffers unconditionally — no length-guard branch needed (contrast
// oauth/tokens.ts's timingSafeEqualStr, which guards raw-length buffers;
// PRD explicitly asks for the hash-first variant here).
export function requireSpikeKey(req: Request): Response | null {
  const expected = process.env.SPIKE_PUSH_KEY;
  if (!expected) return Response.json({ error: "server_misconfigured", message: "SPIKE_PUSH_KEY not set" }, { status: 503 });
  const provided = req.headers.get("x-spike-key") ?? "";
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  if (!timingSafeEqual(a, b)) return Response.json({ error: "unauthorized" }, { status: 401 });
  return null;
}

// Lazy Upstash client, guarded like rate-limit.ts's getRedis(): construct
// only on first call, return null (not throw) when either env var absent.
let _redis: Redis | undefined;
export function getSpikeRedis(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
  if (!_redis) _redis = Redis.fromEnv();
  return _redis;
}

export const SPIKE_SUBSCRIPTION_KEY = "spike:webpush:subscription"; // single fixed key, no per-user subs (PRD §3.3)
```

Do not add these to `rate-limit.ts` / `current-user.ts` — those are permanent, unit-tested modules; one disposable file keeps the spike's removal a single `rm`.

---

## 2. Next.js 16 `searchParams` — confirmed convention

Cited: `calendar/page.tsx:11-15`, `goals/page.tsx:28-33`, `signin/page.tsx:10-15`, `oauth/authorize/page.tsx:37-46` — all identical. Use:

```ts
type PageProps = { searchParams: Promise<{ key?: string }> };
export default async function SpikePushPage({ searchParams }: PageProps) {
  const { key } = await searchParams;
```

No `params` (not a dynamic segment). Never destructure synchronously.

---

## 3. `web-push` + runtime

Not installed (confirmed via package.json grep). Add: `npm install web-push` + `npm install -D @types/web-push`. Import: `import webpush from "web-push";` (default-export CJS interop).

Both new routes and the page declare:
```ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
```
Required — `web-push` uses `node:crypto`/`node:https`, unavailable on edge. Page also uses nodejs, matching `settings/page.tsx`'s identical `dynamic`+`runtime` pair.

---

## 4. File contents outline

### 4.1 `public/spike-sw.js` (new, static asset, no build step)

`install` → `self.skipWaiting()`. `activate` → `event.waitUntil(self.clients.claim())`. `push` → parse `event.data.json()` with try/catch fallback to `.text()`; `event.waitUntil(self.registration.showNotification(title, { body, icon: "/icon-192.png", badge: "/icon-192.png" }))`. `notificationclick` → `notification.close()`; `event.waitUntil(...)` matchAll windows, `focus()` existing or `clients.openWindow("/")`. **No `fetch` listener, no caching, no precache.**

Acceptance grep (REQ-001): `grep -c "addEventListener('fetch'\|addEventListener(\"fetch\"" public/spike-sw.js` → `0`.

### 4.2 `src/app/spike/push/page.tsx` (server component)

```ts
import { notFound } from "next/navigation";
import { SpikePushClient } from "./SpikePushClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PageProps = { searchParams: Promise<{ key?: string }> };

export default async function SpikePushPage({ searchParams }: PageProps) {
  const { key } = await searchParams;
  const expectedKey = process.env.SPIKE_PUSH_KEY;
  if (!expectedKey || key !== expectedKey) notFound();
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY ?? null;
  return <SpikePushClient spikeKey={key} vapidPublicKey={vapidPublicKey} />;
}
```
Plain `===` here is intentional (not timing-safe) — PRD §7 accepts the query-string key as low-value; timing-safety is reserved for the header-gated API routes. `vapidPublicKey` may be `null` — client renders a config-error card instead of crashing. No Card/layout wrapper here — `SpikePushClient` owns all markup (one file to delete).

### 4.3 `src/app/spike/push/SpikePushClient.tsx` (`"use client"`)

State union (switch on this, not booleans):
```ts
type SpikeState =
  | "unsupported" | "needs-install" | "permission-denied"
  | "permission-default" | "subscribing" | "subscribed" | "sending" | "sent";
```
- `unsupported`: `!("serviceWorker" in navigator) || !("PushManager" in window)`.
- `needs-install`: iOS (`/iP(hone|ad|od)/.test(navigator.userAgent)`) and not standalone (`matchMedia("(display-mode: standalone)").matches` OR legacy `navigator.standalone === true`).
- `permission-denied`: `Notification.permission === "denied"`.
- Else check `registration.pushManager.getSubscription()` → `subscribed` or `permission-default`.
- All diagnostics read in `useEffect` only (client-only globals; SSR has no `window`/`navigator`).

`urlBase64ToUint8Array(base64: string): Uint8Array` — standard VAPID conversion (pad to 4, `-`/`_` → `+`/`/`, `atob`, map charCodes). Required because `applicationServerKey` must be `Uint8Array`.

`handleEnable()`: call `Notification.requestPermission()` **first**, synchronously at the top of the click-handler's async chain (iOS user-activation gotcha, §9) → if not granted, `permission-denied` → else `navigator.serviceWorker.register("/spike-sw.js")` (root scope) → `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) })` → `POST /api/spike/push/subscribe` with `x-spike-key` header + `sub.toJSON()` body → update state/status.

`handleSend()`: `POST /api/spike/push/send` with `x-spike-key` header, no body → pretty-print JSON response (incl. `ms`) into the `aria-live="polite"` status line.

Render: one `<Card title="SPIKE — Web Push viability">` with diagnostics (`label: yes/no` each), truncated subscription-endpoint hostname (from local state, never re-fetched), two `<button>`s (`min-h-11`, disabled per state), status `<p aria-live="polite">`. If `vapidPublicKey` prop is `null`, render a config-error card instead of diagnostics/buttons.

### 4.4 `src/app/api/spike/push/subscribe/route.ts`

```ts
import { requireSpikeKey, getSpikeRedis, SPIKE_SUBSCRIPTION_KEY } from "@/lib/spike-push";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const denied = requireSpikeKey(req);
  if (denied) return denied;

  const body: unknown = await req.json().catch(() => null);
  const b = body as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  if (!b || typeof b.endpoint !== "string" || typeof b.keys?.p256dh !== "string" || typeof b.keys?.auth !== "string") {
    return Response.json({ error: "invalid_subscription" }, { status: 400 });
  }

  const redis = getSpikeRedis();
  if (!redis) return Response.json({ error: "server_misconfigured", message: "UPSTASH_REDIS_REST_URL/TOKEN not set" }, { status: 503 });
  await redis.set(SPIKE_SUBSCRIPTION_KEY, JSON.stringify(body));
  return Response.json({ ok: true });
}
```
No Zod — throwaway route; hand-rolled shape check matches REQ-003. This deviates from the house "all tool inputs validated with Zod" rule intentionally (non-MCP, deletable code) — flag to Developer so it isn't "fixed" mid-build.

### 4.5 `src/app/api/spike/push/send/route.ts`

Key check → `getSpikeRedis()` (503 if null) → `redis.get<string>(SPIKE_SUBSCRIPTION_KEY)` (404 `{ error: "no subscription stored" }` if absent) → **verify** whether `@upstash/redis`'s `.get()` returns the raw string or an already-parsed object for this pinned SDK version (check `package.json`) before unconditionally `JSON.parse`-ing — branch on `typeof raw === "string"` to avoid a crash. → VAPID env check (`VAPID_PUBLIC_KEY`/`_PRIVATE_KEY`/`_SUBJECT`, 503 if any missing) → `webpush.setVapidDetails(subject, pub, priv)`.

Note read — mirrors the legacy MCP token route's founder-scoped pattern (`src/app/api/mcp/[token]/route.ts`); `runWithUser`/`getDb` signatures per `src/lib/db.ts:327-329` and `:380-382`:
```ts
const openItem = await runWithUser(FOUNDER_USER_ID, async () => {
  const db = await getDb();
  return db.note.findFirst({ where: { type: "open_item", resolvedAt: null }, orderBy: { date: "desc" } });
});
```
Confirm `Note.body` is the right field against `prisma/schema.prisma` before writing the mapping line — don't guess.

Payload: `{ title: "Goaldmine coach", body: openItem?.body ?? "Test nudge from the Web Push spike 🎯" }`. Send:
```ts
const start = Date.now();
try {
  const result = await webpush.sendNotification(subscription, JSON.stringify(payload));
  return Response.json({ ok: true, statusCode: result.statusCode, ms: Date.now() - start });
} catch (err: unknown) {
  if ((err as { statusCode?: number }).statusCode === 410) {
    await redis.del(SPIKE_SUBSCRIPTION_KEY);
    return Response.json({ ok: false, gone: true, ms: Date.now() - start });
  }
  return Response.json({ ok: false, error: (err as Error).message, ms: Date.now() - start }, { status: 502 });
}
```

---

## 5. `route-access.ts` change

After the render-jobs-peek check, same style:
```ts
// SPIKE (AS-0) — self-gated behind SPIKE_PUSH_KEY; removed with spike/web-push.
if (pathname === "/spike/push") return true;
if (pathname.startsWith("/api/spike/push/")) return true;
```
Also append to the top-of-file "Public surfaces" doc comment: `- /spike/push, /api/spike/push/* – AS-0 spike, self-gated by SPIKE_PUSH_KEY`.

`route-access.test.ts` — append to `PUBLIC_CASES`:
```ts
["/spike/push", "spike push page"],
["/api/spike/push/subscribe", "spike push subscribe route"],
["/api/spike/push/send", "spike push send route"],
```
Append to `PROTECTED_CASES` (negative/prefix-safety, matching existing idiom):
```ts
["/spike/pushX", "does NOT match /spike/push (prefix safety)"],
["/spike-other", "does NOT match /spike/push (different path)"],
```

---

## 6. `.env.example` block (append verbatim)

```env
# ── AS-0: Web Push spike (spike/web-push branch — remove with the spike) ────
# Self-gated throwaway spike testing iOS 16.4+ Web Push viability for coach
# nudges. Delete this block + the spike/ code paths once the GO/NO-GO verdict
# lands in docs/roadmap/as0-push-assessment.md.

# Shared secret gating /spike/push (query string) and /api/spike/push/*
# (x-spike-key header). Generate with: openssl rand -hex 32
SPIKE_PUSH_KEY=

# VAPID keypair. Generate with: npx web-push generate-vapid-keys
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=

# Contact URI push services may use if your server misbehaves.
VAPID_SUBJECT="mailto:ggronnii@gmail.com"
```

---

## 7. Assessment doc skeleton — `docs/roadmap/as0-push-assessment.md`

Sections, in order: **(1) Why this gate exists** — Track 2 cost (~19 issues, 3–6 wks) + DA findings 2 & 7 from `.roadmap/2026-07-03-app-store-publishing/agents/plan-critique.md`. **(2) Nudge loop today** — condense research-output.md §1–2 (Note model, pull-only `/coach`, `open_item`+`[week:]` convention, no push/email/cron infra). **(3) Issue statuses** — #100–102 open/unbuilt, #187/#188 open regardless. **(4) Web Push viability evidence** — 4.1 desktop (QA fills: enable/subscribe result, send/notification result); 4.2 iPhone (founder fills: device/iOS version, standalone install y/n, enable result, lock-screen delivery y/n, notes). **(5) Decision framework** — GO = build native shell (~19 issues/3–6 wks, native push+HealthKit+discoverability, Web Push proved insufficient/fragile); NO-GO = Web Push + AS-B3-style SW covers it, Track 1 continues regardless. **(6) VERDICT: OPEN — awaiting founder device test.** **(7) Device-test runbook** — generate VAPID keys, set `SPIKE_PUSH_KEY`+`VAPID_*` in Vercel Preview scope, disable/bypass Deployment Protection, Add to Home Screen on iPhone, open `/spike/push?key=...`, Enable, close app, `curl -X POST .../api/spike/push/send -H "x-spike-key: $SPIKE_PUSH_KEY"`, confirm lock-screen delivery, record in §4.2.

---

## 8. What must NOT change — verification grep list

```sh
git diff main --stat -- src/app/layout.tsx           # empty
git diff main --stat -- public/manifest.webmanifest  # empty
git diff main --stat -- prisma/schema.prisma          # empty
git diff main --stat -- src/lib/mcp/                  # empty
```
Any output = scope leak; revert and isolate (PRD §1.3, AC 6).

---

## 9. iOS gotchas the client component must handle

1. `pushManager.subscribe()` throws on iOS Safari when not installed standalone — gate the Enable button on the `needs-install` state up front; don't rely on the catch block alone.
2. `Notification.requestPermission()` must be the **first** async call in the click handler's chain (no prior `await`) — iOS Safari can drop the user-activation flag across an `await` boundary.
3. Permission-denied has no re-prompt path (silently resolves `"denied"` again) — the `permission-denied` state must show the "Settings → Notifications → Goaldmine → Allow" instruction, not a dead button.
4. SW registration `navigator.serviceWorker.register("/spike-sw.js")` at root path yields root scope (`/`) by default — correct for push (no fetch interception needed); don't pass a narrower `{ scope }`.

---

## Developer build order

1. REQ-001 `spike-sw.js` (zero deps; verify fetch-grep immediately).
2. REQ-004 `route-access.ts` + tests + `.env.example` (unblocks manual testing without signin-redirect interference).
3. REQ-003 `spike-push.ts` + subscribe/send routes + `web-push` install (curl-testable standalone).
4. REQ-002 page + client component (depends on 1 + 3).
5. REQ-005 assessment doc (independent, parallelizable).
