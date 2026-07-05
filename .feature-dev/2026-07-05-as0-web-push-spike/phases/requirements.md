# Requirements — AS-0 Web Push Spike

## REQ-001 — Push-only service worker
- **Files**: `public/spike-sw.js` (new)
- **Description**: `push` event parses `event.data.json()` ({title, body}) with try/catch fallback to text; `showNotification(title, { body, icon: "/icon-192.png", badge: "/icon-192.png" })` wrapped in `event.waitUntil`. `notificationclick` closes the notification, focuses an existing window client or `clients.openWindow("/")`, in `event.waitUntil`. NO fetch handler, NO caching, NO install/activate logic beyond `self.skipWaiting()`/`clients.claim()`.
- **Acceptance**: file exists; `grep -c "addEventListener('fetch'\|addEventListener(\"fetch\"" public/spike-sw.js` → 0.
- **Deps**: none · **Complexity**: S

## REQ-002 — Spike page (server) + client component
- **Files**: `src/app/spike/push/page.tsx`, `src/app/spike/push/SpikePushClient.tsx` (new)
- **Description**: per PRD §3.1.2–3 and §5.1. Page: `dynamic="force-dynamic"`, `runtime="nodejs"`; key check → `notFound()` when `SPIKE_PUSH_KEY` unset OR mismatch; props: vapidPublicKey (from env; if missing render a config-error card instead of subscribe UI), spikeKey (for API headers). Client: diagnostics list, Enable/Send buttons (≥44px, existing Card/tokens), status `aria-live` line, urlBase64ToUint8Array helper for applicationServerKey, states per PRD §6.
- **Acceptance**: PRD criteria 2; renders at 390px; buttons disabled when unsupported.
- **Deps**: REQ-001 · **Complexity**: M

## REQ-003 — Subscribe + send API routes
- **Files**: `src/app/api/spike/push/subscribe/route.ts`, `src/app/api/spike/push/send/route.ts` (new); `package.json` (+`web-push`, `@types/web-push`)
- **Description**: per PRD §3.1.4–5, §6, §7. Shared key-check helper (timing-safe, header `x-spike-key`, 401 on mismatch, 503 if SPIKE_PUSH_KEY unset). Upstash via `Redis.fromEnv()` guarded — 503 JSON naming missing config. Send: load sub → 404 if none → note read via `runWithUser(FOUNDER_USER_ID)` + `(await getDb()).note.findFirst({ where: { type: "open_item", resolvedAt: null }, orderBy: { date: "desc" } })` with static fallback body → `webpush.setVapidDetails(subject, pub, priv)` → send → handle 410 (delete key, `{ok:false, gone:true}`) → `{ok:true, statusCode, ms}`.
- **Acceptance**: PRD criteria 3–4; curl behaviors per test plan.
- **Deps**: none · **Complexity**: M

## REQ-004 — Route access + tests + env placeholders
- **Files**: `src/lib/auth/route-access.ts`, `src/lib/auth/route-access.test.ts`, `.env.example`
- **Description**: `/spike/push` and `/api/spike/push` prefixes public (match existing public-route pattern exactly); test cases asserting both are public and that an unrelated `/spike-other` stays protected. `.env.example`: 4 vars with `# SPIKE (AS-0) — remove with spike/web-push` comment block.
- **Acceptance**: PRD criterion 7; auth suite green.
- **Deps**: none · **Complexity**: S

## REQ-005 — Assessment document
- **Files**: `docs/roadmap/as0-push-assessment.md` (new)
- **Description**: sections: (1) Why this gate exists (Track 2 cost, DA findings); (2) Nudge loop today (from research-output.md, condensed); (3) Issue statuses (#100–103 open/unbuilt, #187/#188 open); (4) Web Push viability — desktop evidence (filled by QA) + iPhone evidence (template slot for user); (5) Decision framework: what GO means (~19 issues, 3–6 wks, native push+HealthKit+discoverability) vs NO-GO (Web Push + AS-B3-style SW later, Track 1 continues regardless); (6) **VERDICT: OPEN — awaiting founder device test**; (7) Device-test runbook (VAPID keygen, Vercel env Preview scope, Deployment Protection note, Add to Home Screen steps, curl send recipe).
- **Acceptance**: PRD criterion 8.
- **Deps**: none · **Complexity**: S
