# Devil's Advocate critique — #247 invite-race atomic claim

**Verdict: APPROVE-WITH-CONDITIONS**

The atomic-claim core (`$executeRaw` conditional UPDATE, claim-at-the-gate, loser → `/request-access`) is sound and every load-bearing assumption in the PRD checks out against installed source. The one piece of the design that is **wrong as specified** is the stale-cookie backfill guard ("mirror the gate's resolution order" in `events.createUser`) — it re-introduces exactly the audit-corruption bug it's meant to prevent, plus a *second*, worse bug (the winner's own backfill breaks). §3 below prescribes the fix: pass the claimed invite ID through a dedicated cookie instead of re-deriving it. This is now empirically confirmed viable (not just plausible) against Next 16's route-handler cookie-mutation pipeline.

---

## Attack 1 — `$executeRaw` semantics in Prisma 7

**CONFIRMED safe, as designed.**

- Return type: `src/generated/prisma/internal/class.ts:132` — `$executeRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Prisma.PrismaPromise<number>`. Plain `number`, not `bigint`. `affected === 1` is a correct, non-lossy check. No BigInt surprise.
- Parameterization: tagged-template form is the safe path (vs. `$executeRawUnsafe`, `class.ts:144`, string-based). `${inviteId}` becomes a bound parameter through the driver adapter — injection-safe as claimed.
- Table name: `prisma/schema.prisma:623-636` — `model Invite` has **no `@@map`**, and no field in it has `@map` either. Table is literally `"Invite"`, columns are literally `"useCount"`, `"maxUses"`, `"expiresAt"`, `"redeemedAt"`, `"id"` (camelCase, must stay double-quoted in raw SQL, which the design does). Confirmed exact match to the PRD's SQL.
- Driver: `src/lib/db.ts:14-24` — `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })`. This is `@prisma/adapter-pg` (node-postgres `pg.Pool`), **not** Neon's serverless HTTP driver. `invite-gate.ts` already imports the raw `prisma` singleton (`invite-gate.ts:11`) — `claimInvite` should use that same import, no new wiring needed.

## Attack 2 — signIn callback return semantics

**CONFIRMED — string-return path matches existing UX exactly; two landmines to document, not fix.**

- `node_modules/@auth/core/lib/actions/callback/index.js:393-409` (`handleAuthorized`):
  - `authorized` falsy (not string, not true) → `throw new AccessDenied("AccessDenied")` — generic error page, **not** `/request-access`.
  - `authorized` is a string → `return await redirect({ url: authorized, baseUrl })` → becomes `{ redirect, cookies }` at `index.js:68-69`, returned immediately, **`handleLoginOrRegister` (and therefore `createUser`/`events.createUser`) is never invoked.** This is load-bearing for the whole design (no orphaned User row on the loser path) — confirmed.
  - Non-`AuthError` throw inside the callback → wrapped as `AccessDenied(e)` (`index.js:400-402`) → also the generic error page, not `/request-access`.
- Default `redirect` callback: `node_modules/@auth/core/lib/init.js:13-19` — `if (url.startsWith("/")) return baseUrl + url`. `auth.ts` doesn't override `callbacks.redirect`, so the existing `return "/request-access?email=..."` string (and the new one on `claimInvite` returning 0) resolves correctly. This is unchanged from current behavior — no new risk.
- **Landmine (documented, not a blocker):** current code already returns bare `"/request-access"` when `email` is falsy (`auth.ts:55`) and only the invite-check path appends `?email=`. If `claimInvite` (or its DB call) ever **throws** (e.g. transient Postgres error) instead of resolving to `false`, the user lands on the generic `/signin?error=...` page, not `/request-access`. This is a pre-existing asymmetry (checkInviteGate's own DB calls already have the same property) — not introduced by this design, don't scope-creep a try/catch here unless the team wants uniform failure UX.
- **Timing:** no concern — `claimInvite` is just one more `await` in a callback that already does 1-2 DB round trips (`checkInviteGate`'s `findFirst` calls). No different in kind.

## Attack 3 — the stale-cookie backfill guard (THE finding)

**The PRD's own prescription ("resolve invite via cookie, email-bound first then code, mirroring the gate") is wrong. Prescribing the fix below.**

First, the enumeration requested:

- **(a) OPEN_SIGNUP=true + stale `invite_code` cookie:** `checkInviteGate` (`invite-gate.ts:44-46`) hits check 1 and returns `{allowed:true}` **before ever reading `inviteCode`**. `redeemInviteId` is `undefined`.
- **(b) Founder-allowlist signup:** same — check 2 (`invite-gate.ts:49-52`) short-circuits before checks 4/5. `redeemInviteId` undefined.
- **(c) Returning user:** `node_modules/@auth/core/lib/actions/callback/handle-login.js:179-183` and `:199` — when `getUserByAccount` finds an existing linked account, the function returns immediately (`isNewUser` stays `false`); `events.createUser` is only ever invoked from the two `else` branches that call the adapter's `createUser` (`handle-login.js:260-263` for OAuth, `:76-77`/`:158-160` for email/webauthn). **Confirmed: `createUser` genuinely does not fire for returning users.**

Now the actual bug in the PRD's prescription: it says the backfill should "resolve invite via cookie (email-bound first then code), mirroring the gate." If that resolution is implemented as a fresh lookup (re-running something like checks 4/5 of `checkInviteGate`), **two things go wrong**:

1. **The winner's own backfill breaks.** After `claimInvite` increments `useCount` at signIn time, `checkInviteGate`'s own gating logic (`invite-gate.ts:74`, `:87`: `useCount < maxUses`) will now evaluate `false` for that same invite on re-run inside `createUser` — because the winner's own claim consumed the slot. A resolution helper that reuses `checkInviteGate`'s useCount-gating (the natural, obvious implementation) will fail to find the invite for the very user who just legitimately claimed it. This is exactly what PRD §1.2 calls "naive-fix follow-on bug" — but the *given* prescription ("mirror the gate's resolution order") doesn't actually avoid it; it just says "don't call `checkInviteGate` directly," without specifying a resolution that ignores `useCount`.
2. **If instead a *new* resolution helper is written that ignores `useCount`** (matches only on code/email, no gating) — this reintroduces the (a)/(b) corruption: an OPEN_SIGNUP or founder signup with a leftover `invite_code` cookie (real scenario — a user tried a code, got OPEN_SIGNUP-admitted anyway, or a founder tester reused a browser profile that still carries an old invite cookie from testing) would have that invite's `redeemedByUserId` stamped even though `useCount` was never incremented for them. Audit says "this invite was redeemed by user X" when X never consumed a slot. This is the corruption the PRD is worried about, and the "mirror resolution order" framing doesn't prevent it — it just changes which function does the unguarded lookup.

**Prescribed fix: don't re-resolve anything in `createUser`. Pass the claimed invite ID forward via a dedicated request-scoped cookie set in `signIn`, only on the success path.**

This is verified viable, not just proposed:

- `src/app/api/auth/[...nextauth]/route.ts:1-3` — `export const { GET, POST } = handlers` is a bare re-export.
- `node_modules/next-auth/index.js:130-132` — `handlers.GET`/`POST` = `(req) => Auth(reqWithEnvURL(req), config)`. So the entire `Auth()` execution — including the `signIn` callback and, later in the same call, `events.createUser` — runs as the literal body of the Next.js Route Handler function.
- `node_modules/next/dist/server/async-storage/request-store.js:66-68` — `createRequestStoreForAPI` comment: *"API routes start in action phase by default"* → `'action'` phase for the whole Route Handler invocation.
- `node_modules/next/dist/server/web/spec-extension/adapters/request-cookies.js:189` — `areCookiesMutableInCurrentPhase()` returns `requestStore.phase === 'action'`. Since the phase is `'action'` for the entire route handler execution (not just the top frame), `cookies().set()` is legal anywhere in the call tree — including inside the `signIn` callback, which is exactly the same propagation guarantee `auth.ts:21-34`'s existing comment block already relies on for **reading** `cookies()`.
- `node_modules/next/dist/server/route-modules/app-route/module.js:502-510` — after the handler resolves, Next explicitly merges any `cookies().set()` mutations into the final Response: *"It's possible cookies were set in the handler, so we need to merge the modified cookies and the returned response here"* → `appendMutableCookies(headers, requestStore.mutableCookies)`. This is what actually flushes a `Set-Cookie` header for a mutation made deep inside `Auth()`'s callback chain into the redirect response the browser receives.

So: **yes, callbacks can set cookies in Auth.js v5**, verified via the underlying Next.js route-handler cookie pipeline, not an Auth.js-specific API.

**Exact implementation:**

```ts
// signIn callback, after result.allowed && result.redeemInviteId:
const claimed = await claimInvite(result.redeemInviteId)
if (!claimed) {
  return `/request-access?email=${encodeURIComponent(email)}`
}
const cookieStore = await cookies()
cookieStore.set("invite_claim_id", result.redeemInviteId, {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  maxAge: 60,       // only needs to survive this single request; short window limits any lingering artifact
  path: "/",
})
return true
```

```ts
// events.createUser — backfill-only, no resolution, no re-gating:
async createUser({ user }) {
  if (!user.id) return
  const cookieStore = await cookies()
  const claimedInviteId = cookieStore.get("invite_claim_id")?.value
  if (!claimedInviteId) return   // bypass path (OPEN_SIGNUP/founder) or no invite — nothing to backfill, no lookup performed
  await prisma.invite.updateMany({
    where: { id: claimedInviteId, redeemedByUserId: null },
    data: { redeemedByUserId: user.id },
  })
}
```

Why this resolves the whole class of bugs at once:
- The cookie is **only ever set on the branch that just successfully called `claimInvite`** — never on OPEN_SIGNUP, founder, returning-user, or reject paths. (a)/(b) are structurally impossible: those paths `return true`/`redirect` before the `cookies().set()` line even exists.
- No re-derivation, so **attack #7's mirroring concern evaporates** — there is nothing to keep in sync between the gate's resolution order and the backfill; the backfill is handed the exact ID the gate already resolved and claimed.
- No `useCount` re-check in the backfill, so the winner's own backfill can't fail the way `checkInviteGate`-reuse would.
- `redeemedByUserId: null` in the `updateMany` `where` keeps it idempotent/safe if `createUser` somehow fires twice (defense in depth; shouldn't happen per the adapter, but free to keep).

This also sidesteps a subtler alternative I considered and rejected: routing the claimed ID through an `AsyncLocalStorage` set up by wrapping `GET`/`POST` in `route.ts`. That's mechanically sound too (ALS propagates through the whole async tree rooted at the wrapped call, same guarantee `src/lib/db.ts:243-247`'s `runWithUser` already leans on) but requires touching the route file to establish the `.run()` scope *before* `signIn` fires, and a plain `signIn`-internal `als.run()` would NOT work (its scope ends when the callback returns, before `createUser` is invoked later in the same `Auth()` call). The cookie approach needs zero new wiring and is fully verified against this Next version — prefer it.

## Attack 4 — same-user retry after burned slot

**Rule: accept as documented risk (matches PRD's own framing). No transactional mitigation is available or advisable.**

`claimInvite` and the adapter's `createUser` happen in the same `Auth()` invocation but are separate Prisma calls with no shared transaction (the adapter's DB calls are internal to `@auth/prisma-adapter`, out of app control; wrapping the whole callback+adapter lifecycle in one long-lived transaction across an HTTP request would hold a pooled connection for the duration of an OAuth-adjacent flow — bad practice, don't do it). If `createUser` throws after a successful claim, the slot is burned with no user created. Document this explicitly; it's rare (transient DB errors) and founder-scale-acceptable per the PRD.

**Free diagnostic worth adding to the same-page documentation** (not code, just an operational note): an invite with `useCount > 0 AND redeemedByUserId IS NULL` is exactly the signature of a burned slot — worth a one-line comment near `claimInvite` so a future admin script/query can identify these for manual re-mint decisions.

## Attack 5 — race script concurrency

**CONFIRMED — atomicity holds regardless of true concurrency; true concurrency is very likely anyway.**

- `src/lib/db.ts:19-22` — `new PrismaPg({ connectionString })`, no explicit `max` passed → `node_modules/@prisma/adapter-pg/dist/index.js:788` — `new pg.Pool(this.config)` falls back to `pg`'s own default pool size (10). `Promise.all([claimInvite(id), claimInvite(id)])` against the same `PrismaClient` will pull two distinct pooled connections and can genuinely execute the two `UPDATE`s concurrently at the network/Postgres level — well within the pool's headroom for 2 concurrent calls.
- Even if the script's two calls happened to serialize (e.g. under load, or if Prisma's internal query queue orders them), the `WHERE "useCount" < "maxUses"` guard is what actually proves correctness, not wall-clock overlap: whichever `UPDATE` reaches Postgres second will read the already-incremented `useCount` and its `WHERE` clause will no-match → `0` affected rows. The script's assertion ("exactly one winner, `useCount === 1`") is valid either way. Confirm the script keeps the assertion framed as "exactly one success, final `useCount === 1`" rather than asserting anything about timing/overlap — that's the only thing genuinely guaranteed.

## Attack 6 — mock compatibility

**CONFIRMED safe, trivial addition.**

`invite-gate.test.ts:11-21` mocks `@/lib/db` with `prisma: { user: { findFirst }, invite: { findFirst } }`. None of the 26 existing tests call `claimInvite` (they only exercise `checkInviteGate`/`previewInviteCodeQuery`, neither of which touches `$executeRaw`), so they're unaffected by any change to the mock shape. New `claimInvite` tests need `prisma.$executeRaw: vi.fn()` added at the **top level** of the mock object (sibling to `user`/`invite`, not nested under `invite` — `$executeRaw` is a client-level method, `invite-gate.ts` would call it as `prisma.$executeRaw\`...\`` directly, not `prisma.invite.$executeRaw`). The `vi.mock` factory (`invite-gate.test.ts:11-21`) references no outer-scope variables — it's a plain object literal of `vi.fn()`s — so there's no hoisting/TDZ landmine in adding a key. `$executeRaw` as a tagged-template call is just `fn(strings, ...values)` under the hood; `vi.fn().mockResolvedValue(1)` / `.mockResolvedValueOnce(0)` mocks it exactly like any other async fn.

## Attack 7 — the email-bound resolution mirror

**Resolved by attack #3's prescription — no mirroring needed.** `checkInviteGate`'s resolution order is Check 4 (email-bound) then Check 5 (code) — `invite-gate.ts:71-90`. Since the backfill in the fix above receives the already-resolved `redeemInviteId` directly via cookie (set at the moment the gate resolved it), there is no second resolution to keep in sync, and no risk of a user with both an email-bound invite and a typed code backfilling the wrong row.

## Attack 8 — other

- **NOW() vs app-time:** `checkInviteGate` uses `new Date()` (`invite-gate.ts:38`, app-server clock) for its `expiresAt` comparison; `claimInvite`'s raw SQL uses Postgres `NOW()` (DB-server clock) for its re-guard. Two different clocks, but both instant-based (not USER_TZ-relative — confirmed consistent with the rest of the codebase: `src/lib/oauth/token-grants.ts:242,414` also compares `expiresAt <= new Date()` for OAuth codes/tokens, same pattern). Any skew between app-server and Neon-server clocks is sub-second in practice and only matters if `expiresAt` lands in that exact window — not exploitable, not worth engineering around.
- **Neon driver quirks:** none apply — confirmed via `src/lib/db.ts:14` this app uses `@prisma/adapter-pg` (node-postgres/pg.Pool over a real TCP connection), not `@prisma/adapter-neon`/the HTTP-fetch serverless driver. Raw `$executeRaw` behaves like a normal parameterized query over a pooled connection, no special-casing needed.
- **`invite-gate.ts` importing `prisma`:** confirmed already imported (`invite-gate.ts:11`, raw singleton, explicitly documented as intentional since `Invite` is admin data, not in `SCOPED_MODELS` — `src/lib/db.ts:38-56` doesn't list `Invite`). `claimInvite` should live in the same file and reuse this import — no new dependency.

---

## Exact developer instructions (summary)

1. **`claimInvite`** in `invite-gate.ts`, using the existing `prisma` import, exactly as PRD'd (tagged template, `affected === 1`).
2. **`auth.ts` signIn callback**: after `checkInviteGate` returns `{allowed:true, redeemInviteId}`, call `claimInvite`. `0`/`false` → same `/request-access?email=...` string as the existing reject path. On success, set an httpOnly `invite_claim_id` cookie (mirror `auth-actions.ts:39-45`'s `invite_code` cookie options: `httpOnly`, `secure` in prod, `sameSite: "lax"`, `path: "/"`; `maxAge: 60` is plenty — same-request use only) carrying `result.redeemInviteId`. Then `return true`.
3. **`auth.ts` events.createUser**: delete the re-check-and-increment entirely. Read `invite_claim_id` from cookies; if absent, return (covers OPEN_SIGNUP/founder/returning-user — those paths never set the cookie, so this is a correct no-op, not a guess). If present, `prisma.invite.updateMany({ where: { id, redeemedByUserId: null }, data: { redeemedByUserId: user.id } })`. Do **not** re-run `checkInviteGate` or any useCount-gated lookup here.
4. **Tests**: add `$executeRaw: vi.fn()` at the top level of the `@/lib/db` mock in `invite-gate.test.ts`; new `describe("claimInvite", ...)` block with claimed (`mockResolvedValue(1)` → `true`) and lost (`mockResolvedValue(0)` → `false`) cases. The 26 existing tests need no changes.
5. **`scripts/verify-invite-race.ts`**: follow the `scripts/mint-invite.ts` / `scripts/db-guard.ts` pattern — `assertDevDb()` guard, mint a temp `maxUses:1` invite, `Promise.all([claimInvite(id), claimInvite(id)])`, assert exactly one `true`/one `false` and post-fetch `useCount === 1`, delete the temp invite in a `finally`. Frame the assertion around final state (one winner, `useCount===1`), not around actual wall-clock overlap of the two calls.
