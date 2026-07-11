# Devil's Advocate critique — PRD-245 delete-account (issue #245)

**Verdict: APPROVE-WITH-CONDITIONS**

The mechanics (cascade FK graph, session-derived uid, sign-out-after-delete safety) are
sound and independently verified against installed `@auth/core`/`next-auth` source and
`prisma/schema.prisma`. The PRD's action *signature* and the harness's cleanup/seed logic
both need concrete changes before implementation — listed as blocking conditions below.
None of these are architecture-level rejections; all are "build it this way, not that way."

---

## Attack 1 — NEXT_REDIRECT swallowing

**Confirmed dangerous pattern exists in the ecosystem.** Read
`node_modules/next-auth/lib/actions.js:56-72` — `signOut()` (the wrapper re-exported from
`@/lib/auth/auth.ts`) ends with `return redirect(res.redirect)` when `options.redirect` is
not explicitly `false` (the codebase's only call site, `auth-actions.ts:101`, never passes
`redirect: false`). `next/navigation`'s `redirect()` throws a special error
(`digest` starting `NEXT_REDIRECT`) that the Next.js framework boundary catches — but only if
nothing between the throw and the framework swallows it first.

`@auth/core/lib/actions/signout.js:9-30` (the layer `next-auth`'s `signOut` calls into) has
its OWN try/catch around `adapter.deleteSession(sessionToken)` (line 14-27) — that catch is
scoped tightly to the DB delete and does not touch the later `redirect()` call in
`next-auth/lib/actions.js`. So `signOut()` itself is redirect-safe by construction. The risk
is entirely in `deleteAccountAction`'s own code: if the developer wraps the whole function
body (e.g. "just in case something throws") in a try/catch to return a friendly error, the
`signOut()` call's `NEXT_REDIRECT` throw gets caught by that outer catch and treated as a
generic failure — the redirect dies, `startTransition`/`useActionState` resolves with
whatever the catch block returns, and the user is left staring at a page whose account no
longer exists.

Session strategy is `"database"` (`src/lib/auth/auth.ts:39`), so `deleteSession` really is
invoked on every `signOut()` call, not skipped — this path is live, not theoretical.

**Prescribed action structure** (see also Attack 2, 4, 8 — same skeleton):

```ts
// src/lib/auth/auth-actions.ts
export type DeleteAccountState = { error: string | null };

export async function deleteAccountAction(
  _prevState: DeleteAccountState,
  formData: FormData,
): Promise<DeleteAccountState> {
  // Session-derived uid ONLY — see Attack 4. Never a form field.
  const uid = await getCurrentUserId(); // throws NEXT_REDIRECT("/signin") on no session — let it propagate

  const raw = formData.get("confirmation");
  const phrase = typeof raw === "string" ? raw.trim() : "";
  if (phrase !== "delete my account") {
    return { error: "Type the phrase exactly as shown to confirm." };
  }

  // ONLY the delete call is try/caught — never signOut(), never the whole function.
  try {
    await prisma.user.delete({ where: { id: uid } });
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025")) {
      throw err; // anything other than "already gone" is a real failure — surface it
    }
    // P2025 = row already deleted by a concurrent submit — fall through to signOut anyway.
  }

  // MUST be outside any try/catch. Its NEXT_REDIRECT throw is the intended exit.
  await signOut({ redirectTo: "/signin?deleted=1" });
}
```

**Blocking condition:** the function body must not have a try/catch whose scope includes the
`signOut()` call. `getCurrentUserId()`'s own `redirect("/signin")` throw (no-session case)
must also be left unwrapped for the same reason.

---

## Attack 2 — Double-submit / replay

Two rapid submits (same tab, network double-fire, or two tabs) race two invocations of
`deleteAccountAction`. Trace what actually happens:

- **Sequential** (tab A finishes, then tab B submits): tab B's `getCurrentUserId()` call
  finds no session (the `Session` row cascade-deleted along with `User` — schema.prisma:597-606,
  `onDelete: Cascade`), so it redirects to `/signin` before ever reaching `prisma.user.delete`.
  No P2025 possible here — it's a clean auth bounce.
- **Concurrent** (both requests pass the session check before either delete commits): the
  second `prisma.user.delete({ where: { id: uid } })` throws
  `PrismaClientKnownRequestError` code `P2025` ("An operation failed because it depends on
  one or more records that were required but not found"). This is Postgres-standard "delete
  where id matches zero rows" behavior via Prisma's `delete` (as opposed to `deleteMany`,
  which would just return `count: 0` silently — `delete` is a "find-then-delete" that throws
  on miss). This is a genuine race window, not a theoretical one, since `prisma.user.delete`
  isn't wrapped in a transaction with the session check.

**Prescribed handling:** catch P2025 specifically and proceed to `signOut()` anyway (shown in
the Attack 1 skeleton) — the end state the user wants (signed out, data gone) is achieved
either way, and returning a scary error for "your account was deleted by your other tab" is
wrong UX for a state that isn't actually an error.

**Multi-tab note:** pending-state disabling in the client island only guards the single
`<form>` instance that rendered it — it does nothing for a second browser tab with its own
mounted copy of `DeleteAccountSection`. That's fine given the P2025-tolerant handling above;
call this out in code comments so a future refactor doesn't "fix" the P2025 catch away
thinking it's dead code.

---

## Attack 3 — Phrase semantics

**Prescribed rule:** trim leading/trailing whitespace, then exact case-sensitive match
against the literal string `"delete my account"`. Do not case-fold — a case-insensitive
compare weakens the "you had to deliberately type this" signal the phrase exists to provide,
and the codebase has no existing case-fold precedent for confirmation phrases to be
consistent with.

**iOS input attributes — CRITICAL, verified no existing precedent covers all four:**
grep across `src/components/*.tsx` found `autoComplete="off"` (InviteCodeField.tsx:62,
AccessRequestForm.tsx:78) and `spellCheck={false}` (DayWorkoutEditor.tsx:272,
TargetsBuilder.tsx:209) used separately elsewhere, but **no existing input sets
`autoCapitalize`**, and nothing combines all four. On iOS Safari/PWA, the default virtual
keyboard auto-capitalizes the first letter of each sentence/field and offers autocorrect
suggestions — either behavior would silently mutate `"delete my account"` into
`"Delete my account"` or a spell-corrected variant, at which point the exact-match check
above fails and the user cannot ever satisfy it without noticing the capital D (easy to miss
on a small screen). Since this is explicitly a phone-first PWA (CLAUDE.md), this is not an
edge case — it is the primary input surface.

**Prescribed input attributes:**

```tsx
<input
  type="text"
  name="confirmation"
  autoComplete="off"
  autoCapitalize="off"
  autoCorrect="off"
  spellCheck={false}
  placeholder="delete my account"
  ...
/>
```

---

## Attack 4 — Session-derived uid

House pattern is unambiguous and has a load-bearing comment enforcing it:
`src/lib/oauth/connection-actions.ts:5-9` — *"OWNERSHIP CRITICAL — userId is ALWAYS sourced
from the session (via `getCurrentUserId`). It is NEVER taken from a client-supplied
parameter."* `revokeConnectionAction` (same file, line 21) calls `await getCurrentUserId()`,
not raw `auth()`.

**Deviation from the PRD text:** the PRD says `auth()` → session uid (reject if none)"; I
recommend `getCurrentUserId()` instead of raw `auth()` for two reasons: (1) it's the
established house call for exactly this "get the acting user's id, bounce to /signin if
none" need — using raw `auth()` here would be the only server action in the auth-actions
family that doesn't; (2) `getCurrentUserId()` already implements "reject if none" via its own
`redirect("/signin")`, so using it removes a manual null-check + redirect the developer would
otherwise have to hand-roll (and get subtly wrong re: Attack 1's NEXT_REDIRECT rule).

**Verified:** the form (`DeleteAccountSection.tsx`) must render no hidden `id`/`userId`
field — the only form field is `name="confirmation"`. `formData.get("id")` etc. must never
be read by the action. This mirrors `RevokeConnectionButton.tsx`, whose only param over the
wire is `clientId` (an app identifier, not a user identifier).

---

## Attack 5 — Mid-delete MCP

Traced the full path: `src/app/api/mcp/route.ts:13-32`. `resolveUserIdFromToken` (in
`current-user.ts:47-79`) does `prisma.oAuthAccessToken.findUnique({ where: { tokenHash } })`
— once the user row cascades away (`OAuthAccessToken.user` is `onDelete: Cascade`,
schema.prisma:697-702), that row is gone, `findUnique` returns `null`, `at` is falsy, and the
function falls through to the legacy-token check (which won't match a per-user OAuth bearer
token) and returns `null`. `route.ts:21-32` null-guards `userId` and returns a clean
**401** with the correct `WWW-Authenticate: Bearer resource_metadata="..."` header — the same
header shape used for "never authenticated" — no 500, no crash, no partial-auth state.
claude.ai's next call re-triggers its normal OAuth discovery flow, which will fail at
authorization (client has no valid grant/consent for a deleted user) rather than hanging.
This matches the PRD's stated "acceptable" outcome and is verified, not assumed.

---

## Attack 6 — Harness founder-safety

Read `scripts/verify-tenant-isolation-full.ts` in full (820 lines).

- **DB_ENV guard** (lines 27-33): runs before any DB import, refuses non-`development`. Stays
  as-is — no change needed, but note it protects the *whole script*, including the new
  `user.delete(B)` cleanup, so this alone is why switching cleanup is safe to do at all.
- **B_USER_ID scoping**: `prisma.user.upsert({ where: { id: B_USER_ID }, ... })` (line
  210-214) and every subsequent delete in the current manual cleanup (lines 680-775) filters
  `where: { userId: B_USER_ID }` or, for the final step, `where: { id: B_USER_ID }` — there is
  no code path by which switching the cleanup to a single `prisma.user.delete({ where: { id:
  B_USER_ID } })` could touch `FOUNDER_USER_ID` rows; the where-clause is an exact id match,
  not a range or pattern.
- **Founder re-check must survive the refactor.** The harness already re-snapshots and
  compares founder counts twice: once mid-run after B's writes (Step 6, line 660-665) and
  once after cleanup (Step 7, lines 785-788, inside the `finally` block). **Both must be kept**
  when cleanup is rewritten — the post-cleanup one (Step 7) is the one that actually proves the
  cascade didn't touch the founder, since it runs *after* the new `user.delete(B)` call. Do
  not collapse these into one check; the mid-run one catches founder-bleed from B's writes
  (a different bug class) and the post-cleanup one catches founder-bleed from B's deletion.
- **FoodUsage omission — confirmed on all three counts the PRD flags:**
  1. `SCOPED_MODELS` in `src/lib/db.ts:38-56` already lists `FoodUsage` (added in E-1) — the
     tenant-scoping enforcement itself is not gapped.
  2. `ModelCounts` type (lines 101-118), `founderSnapshot()` (120-149), and `MODEL_MAP`
     (422-439) in the harness are missing `foodUsage` — the harness's read-sweep and
     regression-count proof (Steps 3 and 6) are vacuous for this model today. Add it to all
     three, plus the `all X models` label at line 168 (currently hardcoded "16").
  3. **Seeding gap — the PRD's own harness upgrade will be a no-op unless this is added.**
     `FoodUsage` needs a `FoodLibrary` row to point `foodId` at (schema.prisma:513,
     `foodId String` is a required, non-nullable FK — `dbB.foodUsage.create` will fail
     without one). Seed it like this, and **positively assert the FoodLibrary row survives
     the cascade** — that's the one place in the whole 17-model sweep where the shared-vs-owned
     boundary actually gets exercised end to end:

     ```ts
     // Step 2 seeding — before other FoodUsage-dependent code
     const sharedFood = await prisma.foodLibrary.create({
       data: { name: "e9b-shared-food-catalog-item", source: "manual" },
     });
     const bFoodUsage = await dbB.foodUsage.create({
       data: { foodId: sharedFood.id, usageCount: 3, isFavorite: true },
     });
     console.log(`  FoodUsage:           ${bFoodUsage.id} (food=${sharedFood.id})`);

     // ... after the user.delete(B) cascade in cleanup:
     const survivingFood = await prisma.foodLibrary.findUnique({ where: { id: sharedFood.id } });
     assert(
       survivingFood !== null,
       "[7b] Shared FoodLibrary row SURVIVED user cascade (correct — shared catalog)",
       "[7b] Shared FoodLibrary row was DELETED by user cascade — FK direction regression!",
     );
     await prisma.foodLibrary.delete({ where: { id: sharedFood.id } }); // test-owned cleanup, not part of the cascade proof
     ```

     FK direction is `FoodUsage.food → FoodLibrary` (schema.prisma:516,
     `onDelete: Cascade` — this cascade fires when a *FoodLibrary* row is deleted, deleting
     its `FoodUsage` children; it says nothing about the reverse). The reverse relation that
     actually matters for this feature — `FoodUsage.user → User` (line 515, also `onDelete:
     Cascade`) — is what fires when the *User* is deleted, and it only ever reaches
     `FoodUsage`, never climbing back up to `FoodLibrary`. Confirmed by reading both relation
     lines; there is no path from a `User` delete to a `FoodLibrary` delete in the schema.

- **Cleanup rewrite must not silently swallow a real cascade failure.** The current
  `finally` block already wraps cleanup in its own try/catch (lines 673-793) that increments
  `failures` on error rather than crashing the process — keep that shape, but make sure a
  thrown FK-constraint error from `prisma.user.delete(B)` (which would mean some 18th model
  exists with a `Restrict`/no-action FK that the PRD's premise-check missed) surfaces as a
  **FAIL**, not a caught-and-ignored no-op. The existing `catch (cleanupErr) { ...
  failures++ }` shape already does this correctly — just don't add a broader catch around it
  that treats "delete threw" as expected.
- **Post-delete assertion set:** after `user.delete(B)`, assert (a) `User` row gone (existing
  check, line 778-783, keep), (b) all 17 `SCOPED_MODELS` accessors return zero rows for
  `userId: B_USER_ID` (new — this is the actual point of the upgrade, replacing the per-model
  `deleteMany` counts which only proved "deleteMany found N rows," not "cascade found them
  all"), (c) founder counts unchanged (existing Step 7 check, keep), (d) the FoodLibrary
  survival check above.

---

## Attack 7 — signin `?deleted` rendering

`src/app/signin/page.tsx:28-31` reads `searchParams` (`next, callbackUrl, invite, error`) —
`deleted` is not currently destructured or reflected anywhere; the PRD adds a *fixed* string
keyed off `deleted`'s mere presence (`?deleted=1` → boolean-ish check), not an interpolation
of its value. No reflection means no injection/XSS surface regardless of what value is
supplied (`?deleted=<script>` would still just show the fixed confirmation line). Follow the
existing `errorMessage` banner pattern (lines 70-77) — same `role="alert"` treatment, separate
copy, non-interactive with the Google sign-in error banner (mutually exclusive states in
practice, but don't couple them — a user could theoretically hit `/signin?deleted=1&error=...`
by hand-editing the URL; render both, they don't conflict visually).

**`/signin` survives the signed-out state — confirmed.** `route-access.ts:22`:
`if (pathname === "/signin") return true;` — unconditionally public, independent of cookie
state. `signOut()`'s `redirectTo: "/signin?deleted=1"` lands cleanly; middleware never
intercepts it.

---

## Attack 8 — `$transaction`

**Rule: no `$transaction` wrapper.** `prisma.user.delete({ where: { id: uid } })` is already
a single SQL statement (`DELETE FROM "User" WHERE id = $1`, with Postgres executing all
`ON DELETE CASCADE` FKs server-side as part of that one statement's execution) — Prisma's
`$transaction` exists to make *multiple* statements atomic; wrapping a single statement in one
adds a round-trip and zero correctness benefit. `signOut()` is not a database operation (it's
an HTTP-shaped call into the Auth.js action handler that itself may do its own DB write via
the adapter) — it must never be inside a `$transaction` block wrapping the delete, both
because that's semantically wrong (mixing a Prisma transaction with a non-Prisma async call
gains nothing and risks holding a DB transaction open across an unrelated network hop) and
because of Attack 1 (the NEXT_REDIRECT throw must propagate, and `$transaction`'s callback
signature would be exactly the kind of wrapper that swallows it).

---

## Attack 9 — Client island pattern

Read `RevokeConnectionButton.tsx` in full. Its pattern: plain `useTransition` + `window.confirm`
pre-check (client-side, bypassable, but backed by nothing since revoke has no server-side
rejection path worth surfacing — revoke either works or is a no-op) + no error state at all
(the action returns `void`). This does **not** transfer cleanly to delete-account, because
delete-account has a real server-rejectable case (wrong phrase — the PRD explicitly requires
*server-side* validation, not just disabling the submit button client-side) whose failure the
UI must surface with `role="alert"`, per the PRD's own UI requirement.

**Prescribed: `useActionState` (React 19), not `useTransition`.** This is a new pattern for
the codebase (grep confirmed zero existing `useActionState` usages) but it is the correct
primitive here — it's the only hook that gives the client component the action's *return
value* to render, which `useTransition` (used for fire-and-forget calls like revoke) does not
provide without extra `useState` plumbing.

```tsx
"use client";
import { useActionState } from "react";
import { deleteAccountAction, type DeleteAccountState } from "@/lib/auth/auth-actions";

const CONFIRM_PHRASE = "delete my account";
const initialState: DeleteAccountState = { error: null };

export function DeleteAccountSection() {
  const [state, formAction, isPending] = useActionState(deleteAccountAction, initialState);
  const [value, setValue] = useState("");
  const matches = value.trim() === CONFIRM_PHRASE;

  return (
    <div className="rounded-2xl border border-red-500/40 ...">
      {/* danger copy */}
      <form action={formAction}>
        <input
          name="confirmation"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={CONFIRM_PHRASE}
        />
        {state.error && <p role="alert">{state.error}</p>}
        <button type="submit" disabled={!matches || isPending}>
          {isPending ? "Deleting…" : "Delete my account"}
        </button>
      </form>
    </div>
  );
}
```

Client-side `matches` gating is UX-only defense-in-depth (per PRD 3.1/security §7) — the
server re-checks the exact same phrase independently in `deleteAccountAction`, so a bypassed
client check (devtools, disabled JS) still hits the real gate.

---

## Attack 10 — Misc

- **`revalidatePath`**: none needed — the user is signed out and redirected away; there is no
  page left in this session that should show fresher data. (Contrast with
  `revokeConnectionAction`, which does `revalidatePath("/settings")` because the user stays on
  that page.)
- **Settings page mid-flight render**: not reachable — `signOut`'s redirect fires
  synchronously as part of the same server action invocation that already ran the delete;
  there is no intermediate render of `/settings` with a half-deleted user. Non-issue.
- **Vercel function timeout**: founder has "thousands of rows" (CLAUDE.md context) — a single
  cascading `DELETE` is one query plan executed server-side in Postgres; even at that row
  count this is milliseconds to low-seconds, nowhere near a serverless function's timeout
  budget. Worth a comment in the code, not a design change.
- **`deleted` param in browser history**: fine — it's a boolean marker with no PII, and the
  page it decorates is `/signin`, which is meaningless without an active session anyway.

---

## Blocking conditions (must be true before merge)

1. `deleteAccountAction` signature is `(prevState: DeleteAccountState, formData: FormData)`
   for `useActionState` compatibility — not the PRD's bare `(formData)`.
2. Uses `getCurrentUserId()`, not raw `auth()` — matches the `connection-actions.ts`
   "OWNERSHIP CRITICAL" house rule.
3. Only the `prisma.user.delete(...)` call is try/caught (P2025 → fall through to `signOut`);
   `signOut()` and `getCurrentUserId()`'s redirect are never inside a try/catch.
4. Confirmation input carries all four iOS-safety attributes:
   `autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}`.
5. Client island uses `useActionState`, surfaces `state.error` with `role="alert"`.
6. Harness: `foodUsage` added to `ModelCounts`/`founderSnapshot()`/`MODEL_MAP` (currently
   missing from all three despite already being in `SCOPED_MODELS`); a `FoodLibrary` +
   `FoodUsage` pair is seeded for B; cleanup asserts the `FoodLibrary` row survives the
   cascade; cleanup switches to `prisma.user.delete(B)` while **keeping both** existing
   founder-regression checks (Step 6 mid-run, Step 7 post-cleanup) plus new per-model
   zero-row assertions across all 17 `SCOPED_MODELS`.
7. No `$transaction` wrapper anywhere in this flow.

None of these require new architecture — all are implementable within the PRD's stated file
list (`auth-actions.ts`, `DeleteAccountSection.tsx`, `signin/page.tsx`,
`verify-tenant-isolation-full.ts`, `delete-account.test.ts`).
