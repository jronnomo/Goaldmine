# Architecture Critique — AS-0 Web Push Spike

Verified against: `src/middleware.ts`, `src/lib/auth/route-access.ts` (+test), `src/lib/auth/current-user.ts`, `src/lib/rate-limit.ts`, `src/lib/db.ts`, `src/lib/auth/founder.ts`, `prisma/schema.prisma` (Note model), `package.json`, `node_modules/@upstash/redis` (chunk-2X4SLXT7.mjs, nodejs.mjs), `node_modules/web-push` (npm registry), `docs/roadmap/app-store-publishing-backlog.md` (AS-B3).

---

## Critical

None. The blueprint's core claims hold up against the actual source. No finding here rises to "do not build."

---

## Concerns

**1. `redis.get<string>()` typing is wrong given the SDK's default behavior — will crash on double-parse if "fixed" the obvious way.**
Confirmed by reading `node_modules/@upstash/redis/chunk-2X4SLXT7.mjs:335-391` (`Command` class) and `parseResponse`/`parseRecursive` (lines 32-55): `automaticDeserialization` defaults to `true` (`opts?.automaticDeserialization === void 0 || opts.automaticDeserialization`), and `GetCommand` (line 1308) inherits it. So `redis.get(SPIKE_SUBSCRIPTION_KEY)` — storing `JSON.stringify(subscription)` via `.set()` — returns the **already-parsed object**, not the raw string, on a normal call. The blueprint's own pseudocode types this as `redis.get<string>(...)` and says "branch on `typeof raw === "string"` to avoid a crash" — the branch is right, but the `<string>` generic is a lie the type system will believe; a developer who trusts the type annotation and calls `JSON.parse(raw)` unconditionally will crash (`JSON.parse` called on a non-string coerces to `"[object Object]"` → `SyntaxError`) the first time send is exercised, which is precisely the failure mode REQ-003 exists to prevent.
**Fix**: type the read as `redis.get<{ endpoint: string; keys: { p256dh: string; auth: string } }>(...)` (or `unknown`), and keep the `typeof raw === "string"` branch as the defensive fallback for the rare case the stored value isn't valid JSON. Do not type it `<string>` — that's actively misleading given confirmed default `automaticDeserialization: true`.

**2. Spike SW / real SW (AS-B3) scope collision — no teardown step for the *installed* worker, only for the source files.**
`docs/roadmap/app-store-publishing-backlog.md:136-146` (AS-B3) plans a permanent `public/sw.js`, also registered at root scope, with a real fetch/precache handler. Registering a second, different-URL script at the same scope (`/`) supersedes the prior registration once it activates — so there's no *permanent* double-SW risk. But: (a) the founder's iPhone will have `spike-sw.js` installed and a live push subscription tied to that registration during the spike window; (b) `git rm public/spike-sw.js` removes the file from the repo but does **not** unregister the worker already on the phone — the browser only re-evaluates on its own update-check cadence, and 404-on-update-check unregistration behavior is not guaranteed to be immediate across browsers. The blueprint's "one commit removes it" framing (§8, build-order note) covers source code, not installed-device state.
**Fix**: add an explicit teardown step to the assessment doc runbook (§7) — after the verdict is recorded, have the founder either uninstall/reinstall the home-screen PWA, or run `navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()))` in Safari's remote inspector — *before* AS-B3 ships its real SW to the same device. One sentence in the assessment doc closes this; skip it and AS-B3 QA could be confused by a stale spike worker/subscription still answering pushes.

**3. Vercel Preview env-var scope is a real, unverified risk — the repo gives a mixed signal.**
`.env.example:96` instructs "Set both vars in Vercel: Settings → Environment Variables → **all environments**" for Upstash — a hint this project's convention is to set vars across all scopes, which would mitigate the risk. But nothing in the repo confirms `DATABASE_URL`, `VAPID_*`, or `SPIKE_PUSH_KEY` are (or will be) in **Preview** scope specifically — Vercel's Production/Preview/Development scoping is real and a var set only for Production is invisible to a `spike/web-push` preview deploy. The send route needs `DATABASE_URL` (via `getDb()`/`runWithUser`) at runtime on preview; if Preview scope lacks it, the note read throws inside `runWithUser`, and there's no visible fallback path in the blueprint's send-route sketch (§4.5) — only the "no unresolved open_item" case has a static-body fallback; a DB-connection failure is a different error and isn't shown wrapped in try/catch in the outline.
**Fix**: (a) explicitly wrap the `runWithUser(...)` note-read in its own try/catch that falls back to the static body on *any* failure (not just "no note found") — cheap and removes the DB-preview-env risk entirely for a spike whose whole point is testing push, not DB connectivity; (b) the runbook (§7) must include "confirm `DATABASE_URL`, `UPSTASH_REDIS_REST_URL/TOKEN`, `VAPID_*`, `SPIKE_PUSH_KEY` are present in Vercel's **Preview** environment scope (not just Production)" as an explicit checklist line, not just implied by "set env vars." Deployment Protection bypass is already called out in §10.4/Appendix of the PRD — good, don't drop it.

---

## Suggestions

**4. `route-access.test.ts` additions should include a no-trailing-slash negative case, matching the file's own idiom.**
The existing suite tests `/api/render-jobs` (no `/peek` suffix) as protected, and `/api/auth` (no trailing slash) as protected — i.e. it already exercises the "prefix requires the slash" edge for every other `startsWith` check in the file. The blueprint's proposed additions (`/spike/pushX`, `/spike-other`) cover exact-match prefix-safety for `/spike/push` but omit the equivalent case for the `/api/spike/push/` prefix: `["/api/spike/push", "does NOT match /api/spike/push/ without trailing slash"]`. Cheap, and keeps the new cases as thorough as the ones they sit next to.

**5. Minor: doc-comment drift, not a spike bug.** `route-access.ts`'s top-of-file comment still calls `/oauth/*` and `/.well-known/*` "future C-1" even though C-1 has shipped (oauth PRDs are already built per repo state). Not introduced by this spike and not worth fixing here, but don't let the spike's new comment line ("AS-0 spike, self-gated...") read as if it's joining still-pending work — it's joining shipped infra.

**6. No rate limiting on `/api/spike/push/send` is consistent with the confirmed middleware behavior, not a gap.** Traced `src/middleware.ts:63-100`: the only path-guarded buckets are `/oauth/register`, `/oauth/`, `/api/auth/signin`. Nothing matches `/api/spike/push/*`, so an unthrottled send route is exactly what the code will do, matching PRD §7's explicit "not added" call. Fine for a single-key, single-user, throwaway route — flagging only so the Developer doesn't second-guess and add it, which actual scope docs forbid.

---

## Verified-correct (blueprint claims that held up, worth recording so they aren't re-litigated)

- **Middleware reality (axis 1)**: `isPublicPath()` is checked in `src/middleware.ts:103` *before* the session-cookie gate, and the matcher (`config.matcher`, lines 146-148) excludes only `_next/`, favicon/icon/apple-touch assets, `manifest.webmanifest`, `zxing/`, and any dotted-extension path — `/spike/push` and `/api/spike/push/*` are neither excluded by the matcher nor caught by any rate-limit path-guard. Adding the two `isPublicPath` branches genuinely makes both reachable unauthenticated, exactly as claimed.
- **`runWithUser`/`getDb` shape (axis 4)**: `runWithUser<T>(userId, fn: () => T): T` (`src/lib/db.ts:327-329`) opens an `AsyncLocalStorage.run` scope around `fn`; calling it with an async callback from a plain route handler (not the MCP transport) works identically — ALS propagates through the async continuation regardless of caller. Because the note read happens *inside* the `runWithUser` callback, `getDb()` (`db.ts:380-382`) finds the ALS store already set and never falls through to `getCurrentUserId()` (which would `redirect()` — invalid outside an RSC render). The blueprint's call shape is correct and deliberately avoids that trap.
- **`Redis.fromEnv()` behavior (axis 5)**: confirmed via `node_modules/@upstash/redis/nodejs.mjs:266-283` — it does **not** throw when env vars are absent; it `console.warn`s and constructs a client with `url`/`token` undefined. The blueprint's pre-check (return `null` before calling `fromEnv()`) is therefore necessary (an unguarded client would fail at the first `.get()`/`.set()` call, not at construction) and correctly mirrors `rate-limit.ts`'s `isConfigured()`-before-`getRedis()` pattern.
- **Fail-closed empty-string guard (axis 7)**: already present, not missing. Page (`§4.2`): `if (!expectedKey || key !== expectedKey) notFound();` — the `!expectedKey` short-circuit means an unset/empty env var 404s before the comparison runs, so unset-env + missing-query-param can never accidentally match. `requireSpikeKey` (`§1`) has the same early `if (!expected) return 503` guard before hashing. No fix needed here.
- **`web-push` import (axis 3 partial)**: confirmed via npm registry metadata — `web-push@3.6.7` has no `"type"` field (CJS, `main: src/index.js`), and `tsconfig.json:9` has `esModuleInterop: true`, so `import webpush from "web-push"` is valid interop, not a guess.
- **Scope creep (axis 8)**: no PushToken/Prisma changes, no `rate-limit.ts`/`current-user.ts` edits — the blueprint's explicit choice to keep `spike-push.ts` disposable and separate from permanent modules is the right call and matches PRD §3.3's out-of-scope list.
- **Test-suite blast radius (axis 9)**: grepped the whole repo for `route-access`/`isPublicPath` usage — only `middleware.ts`, `route-access.ts`, `route-access.test.ts`, and one doc-comment reference in `onboarding/connect/page.tsx` (not a test). No other test asserts the public-route list exhaustively; appending cases is safe.

---

## Verdict: APPROVE-WITH-FIXES

Top 3 issues:
1. **Fix the `.get<string>()` typing** in the send route — default `automaticDeserialization: true` (confirmed in SDK source) means Upstash already returns a parsed object; typing it `<string>` invites an unconditional `JSON.parse` crash on first real use.
2. **Add a device-teardown step** to the assessment-doc runbook (unregister `spike-sw.js` / remove the home-screen app) before AS-B3 ships its real `public/sw.js` to the same scope on the same phone — the code auto-supersedes but the founder's already-installed worker/subscription doesn't clean itself up.
3. **Wrap the note read in try/catch with the static fallback** and add an explicit Preview-scope env-var checklist line to the runbook — `.env.example` hints at "all environments" for Upstash but nothing confirms `DATABASE_URL`/`VAPID_*` are set for Preview specifically, and a DB-connection failure isn't currently caught by the "no note" fallback path.
