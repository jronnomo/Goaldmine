# Architecture critique — Issue #253 BottomSheet two-phase mount fix

## Verdict: APPROVE-WITH-CONDITIONS

The `useSyncExternalStore(subscribeNever, () => true, () => false)` "mounted" gate is the
correct fix and is backed by a real React mechanism (not folklore) — verified against the
installed `react-dom@19.2.4` source. It resolves the actual defect (hydration-render portal
happens on the client's *first* commit, one commit before intended). Conditions below are
implementable deltas for the developer agent, not a redesign.

---

## Attack results

### 1. Subscribe identity

**Ruling: subscribe MUST be module-level (already specified — keep it a hard requirement).
getSnapshot/getServerSnapshot MAY stay inline; hoisting is a style nit only.**

Verified against the installed React source, `node_modules/react-dom/cjs/react-dom-client.development.js`:

- `mountSyncExternalStore` (`:8143-8146`) wires the effect as
  `mountEffect(subscribeToStore.bind(null, fiber, inst, subscribe), [subscribe])` — the
  effect's **dependency array is `[subscribe]`**. `updateSyncExternalStore` (`:8195`) does the
  same via `updateEffectImpl(2048, Passive, create, [subscribe])`. An inline arrow passed as
  `subscribe` is a new reference every render → cleanup+resubscribe every commit, forever. For
  a true no-op this is not visibly broken (no infinite loop, no console warning), but it's
  needless churn and is exactly the "recreated every render" anti-pattern the React docs warn
  about. ThemeToggle.tsx:25-28 already hoists `subscribe` to module scope — the proposed design
  says "module-level" for `subscribeNever` too. **Confirm this is non-negotiable, not optional.**

- The "should be cached" dev warnings (`:8118-8123` for the hydrating-mount path,
  `:8126-8132` for the non-hydrating path, `:8177-8184` for updates) only check that **repeated
  calls to the same function reference within one hook invocation** return an
  `Object.is`-equal value — they do NOT check identity of the function across renders. Since
  `() => true` / `() => false` always return the same primitive, calling them twice in a row
  (which is exactly what the warning check does) always passes. **Inline getSnapshot /
  getServerSnapshot will not trigger any React warning and will not loop.** Recommend hoisting
  anyway, purely to mirror ThemeToggle.tsx:16-23's three-named-function idiom and make the new
  docstring easier to write precisely — but this is cosmetic, not a correctness gate.

### 2. React 19 / StrictMode double-invoke

**Ruling: safe. Confirmed StrictMode is ON in dev (no opt-out in this repo) and confirmed the
exact mechanism that flips `mounted` false→true without the no-op subscribe ever firing.**

- `next.config.ts:3-9` sets no `reactStrictMode` key. Per
  `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/reactStrictMode.md:8`:
  "Since Next.js 13.5.1, Strict Mode is `true` by default with `app` router." This repo is on
  Next 16 App Router → StrictMode is active in dev. Double-invoked effects mean `subscribeNever`
  runs mount→cleanup→mount in dev; since it never calls its callback and its cleanup is a no-op,
  this is inert both times.

- The real question — how does `mounted` ever become `true` if `subscribeNever`'s callback is
  never invoked? Traced in the installed source:
  - `mountSyncExternalStore` (`:8109-8160`) unconditionally pushes a **passive effect**
    (`:8148-8159`, `updateStoreInstance.bind(...)`) on mount — not gated by `subscribe` firing.
  - That effect (`updateStoreInstance`, `:8238-8242`) calls `checkIfSnapshotChanged(inst)`
    (`:8250-8259`), which re-invokes the **client** `getSnapshot` (`() => true`) and compares
    it via `Object.is` to the value used at render time (`getServerSnapshot()` → `false`, during
    the hydration render). They differ → `forceStoreRerender(fiber)` (`:8260-8263`) is called.
  - This is React's built-in "did the store change since we rendered it" self-check, and it
    runs on every commit of a `useSyncExternalStore` hook, independent of the external
    `subscribe` mechanism. This is the documented, intended getServerSnapshot→getSnapshot
    reconciliation path (same mechanism that lets libraries like `usehooks-ts`'s client-only
    hooks work), not an accident of this particular no-op subscribe.
  - Net: `mounted` flips to `true` exactly one commit after the hydration-matching render,
    automatically, with zero risk of it "getting stuck" at `false` forever. **Confirmed.**

### 3. CSS / DOM dependence on the closed dialog

**Ruling: clear, no regression.**

- `globals.css:232-234`: `.bottom-sheet:not([open]) { display: none; }` — a closed dialog is
  invisible whether it has been sitting in the DOM since before hydration or was inserted one
  commit later. No visual difference between "absent" and "present-but-closed."
- `globals.css:245-249` and `:271-275` are the two `@starting-style` blocks (backdrop opacity,
  panel `translateY`). These only fire on the transition **into the `[open]` state** — i.e.,
  when a user later taps a nav button and `open` flips true, triggering `dialog.showModal()`
  in the `useEffect` at BottomSheet.tsx:55-66. By that point the dialog has already been
  sitting in the DOM (closed) for the entire time between mount and the user's tap — the
  one-commit mount delay from the fix is over long before any `@starting-style` transition is
  ever exercised.
- The only scenario where this could matter is a BottomSheet that mounts *already open*
  (`open=true` on its first render) — in that case `[open]` and the dialog's insertion would
  land in the same commit, which is exactly the case `@starting-style` is designed for and
  handles correctly regardless. But verified this never happens here: BottomNav.tsx:76-77
  (`logOpen`/`moreOpen` both `useState(false)`), BadgeWall.tsx:238 (`useState<...>(null)` →
  `open={selected !== null}` = false initially), MealEditButton.tsx:52 (`useState(false)`) all
  start closed. No edge case triggered.

### 4. Consumers relying on old timing

**Ruling: clear.** Grepped all 4 consumer files
(`MealEditButton.tsx`, `NutritionList.tsx`, `BottomNav.tsx`, `game/BadgeWall.tsx`) plus
`LogLauncher.tsx` for `dialogRef`, `document.querySelector`, `.focus(`, or any DOM read of the
dialog element — none found. `LogLauncher.tsx:185-188`'s self-fetch effect keys off the `open`
**prop** (a plain boolean passed down from `BottomNav`'s `logOpen` state), not off the DOM
dialog's existence, so it is unaffected by the one-commit portal delay. All 4 BottomSheet call
sites render the component unconditionally and gate only the `open` prop
(BottomNav.tsx:160-170,173-179; MealEditButton.tsx:83-112; BadgeWall.tsx:263-270; and
NutritionList.tsx:204-229) — none conditionally construct/destroy the `<BottomSheet>` instance
itself, so every consumer goes through the identical SSR→hydration→post-hydration-flip sequence
and none can observe a synchronous-vs-delayed-mount difference.

### 5. Redundant `typeof document` check

**Ruling: safe to drop entirely, confirmed via source.**

`mountSyncExternalStore` (`:8112-8123`) unconditionally uses `getServerSnapshot()` whenever
`isHydrating` is true, and Next.js's server render is always an `isHydrating`-class pass for a
component present in the initial tree — `document` is never touched by either snapshot function
in the proposed design (`() => true` / `() => false` are pure constants, unlike ThemeToggle's
`getSnapshot`, which does read `window.localStorage`). Since `createPortal(..., document.body)`
only executes after `if (!mounted) return null;`, and `mounted` can only become `true` via the
post-hydration client-side effect described in Attack 2 (which by definition runs in a browser),
there is no code path where `document` is dereferenced while undefined. Drop the `typeof
document === "undefined"` line at BottomSheet.tsx:81 — keeping it as a redundant defensive
check is not wrong, but the design's stated intent (single clean guard) is achievable and the
comment block above it (`:78-80`) needs the rewrite in either case.

### 6. suppressHydrationWarning

**Ruling: must NOT be added — confirmed via the codebase's own contrasting example.**

ThemeToggle.tsx:50,53 needs `suppressHydrationWarning` because its **rendered content**
(`glyph`, `aria` computed from `theme` at ThemeToggle.tsx:41-42) legitimately differs between
the server/hydration render (`getServerSnapshot() → "system"`, ThemeToggle.tsx:21-23) and the
post-mount render (`getSnapshot()` reads real `localStorage`, ThemeToggle.tsx:16-19) — this is
an intentional, accepted visual flash that would otherwise fire a false-positive hydration
warning on the `<button>`/`<span>` text content.

BottomSheet's `mounted` value is never rendered as content — it only gates whether a subtree
exists at all (`null` vs. the portaled `<dialog>`). Both the SSR pass and the client's hydration
pass render `null` identically (Attack 2's mechanism guarantees they agree), so there is no
content divergence for React's hydration reconciler to warn about in the first place. The
dialog's later appearance happens in a subsequent commit **after hydration has already
completed** — ordinary post-mount conditional rendering, structurally identical to a
`useEffect`-gated reveal, which React never flags as a hydration mismatch. Adding
`suppressHydrationWarning` here would do nothing useful and would mask a real regression if the
gate is ever broken again (e.g. a future edit that makes `mounted` diverge from the hydration
pass) by silently swallowing the exact warning class this fix is meant to eliminate.

### 7. Other

- **`[open]` effect (BottomSheet.tsx:55-66) vs. delayed `dialogRef`**: no hazard. `open` is
  `false` at the moment `mounted` flips (verified in Attack 3/4 — no consumer starts open), so
  when the dialog element first exists, this effect has nothing to reconcile (`dialog.open` is
  already `false`, `open` prop is already `false`).
- **Body-scroll-lock effect (BottomSheet.tsx:69-76)**: gated on `[open]`, same reasoning — inert
  at mount since `open` starts false everywhere.
- **`useId()` (BottomSheet.tsx:46)**: unaffected — same hook instance across the two-phase
  mount/re-render, no server/client divergence introduced by this fix.
- **Suspense/streaming ("`<script>` placeholder" from the #233 baseline)**: root layout
  (`src/app/layout.tsx`) has no `<Suspense>` boundary wrapping `BottomNav` — it's rendered
  directly inside the signed-in branch (`layout.tsx:108-114`). The `<html suppressHydrationWarning>`
  at `layout.tsx:55` only silences mismatches on the `<html>` element itself (React's
  `suppressHydrationWarning` is non-cascading — one level deep, text/attribute mismatches
  only), so it does not and cannot mask the structural `<dialog>`-vs-placeholder mismatch deep
  in `BottomNav`'s subtree; the exception documented in
  `.feature-dev/2026-07-10-233-layout-fetch-deferral/phases/hydration-baseline-before.md:6-7` is
  real and attributable to BottomSheet.tsx:81 exactly as the issue states. Whatever placeholder
  React/Next emits for a `null`-rendering client component during the SSR pass, the fix's core
  guarantee (server render and client hydration render return byte-identical `null` for this
  component) is sufficient to eliminate the mismatch class regardless of the exact node type
  React chooses to represent "rendered nothing here."

---

## Additional risks found

- **Docstring accuracy is now load-bearing.** Because the mechanism in Attack 2 is genuinely
  non-obvious (a subscribe function that is *never called* is still what makes the gate work,
  via React's internal consistency-recheck effect, not via the subscribe callback), a future
  maintainer who doesn't understand this could "clean up" the apparently-dead `subscribeNever`
  wiring, or reach for `useState` + `useEffect(() => setMounted(true), [])` instead — which
  would immediately reintroduce the `react-hooks/set-state-in-effect` lint conflict the whole
  design exists to avoid (see the existing disable at BottomNav.tsx:86, same rule,
  `eslint-plugin-react-hooks@7.1.1` confirmed installed via `package.json:44` /
  `node_modules/eslint-plugin-react-hooks/package.json`). The rewritten comment (design item 3)
  must explicitly state *why* the no-op subscribe is sufficient (cite the
  getServerSnapshot→getSnapshot auto-recheck), not just *that* it works.
- **No test file** is explicitly out of scope per the design. Given Attacks 3/4/7 all came back
  clear with concrete evidence, this is an acceptable risk — but flagging that this is a
  hydration-*crash* fix (an uncaught exception in dev per the #233 baseline doc), and the repo
  has zero regression coverage for it before or after. Not a blocking condition; a candidate for
  a follow-up story if the team wants a smoke assertion that no hydration exception fires for a
  page rendering `BottomNav`.

---

## Instructions for the developer agent

Implement the design as proposed with these confirmed deltas:

1. **Keep `subscribeNever` (or equivalent) as a module-level named function** — do not inline
   it at the `useSyncExternalStore` call site. This is required, not stylistic (react-dom
   effect dependency array is `[subscribe]`; an inline arrow resubscribes every render).
2. **`getSnapshot`/`getServerSnapshot` may be inline arrows (`() => true` / `() => false`)
   without correctness risk** — confirmed no React dev warning or loop risk for constant-
   returning snapshot functions. Prefer hoisting them to module level to mirror
   ThemeToggle.tsx:16-23's naming, purely for consistency with the sibling idiom — not required.
3. **Drop the `typeof document === "undefined"` check at BottomSheet.tsx:81 entirely**; replace
   with `if (!mounted) return null;`. Confirmed no live code path can reach the `createPortal`
   call with `document` undefined.
4. **Do not add `suppressHydrationWarning` anywhere in this file.**
5. **Rewrite the docstring (BottomSheet.tsx:35-42) and the guard comment (:78-80) to state:**
   (a) the SSR/hydration render and the immediate post-hydration render are guaranteed to agree
   (both render `null`) because `getServerSnapshot` is used for both, and (b) `mounted` flips to
   `true` one commit later via React's built-in store-consistency recheck — **not** because
   `subscribeNever`'s callback is ever invoked (it never is). Explicitly warn future editors not
   to replace this with `useState` + `useEffect(() => setMounted(true), [])`, which would violate
   the repo's active `react-hooks/set-state-in-effect` rule (see BottomNav.tsx:86 for the same
   rule surfacing elsewhere).
6. No consumer changes needed — verified all 4 call sites (BottomNav.tsx ×2, MealEditButton.tsx,
   BadgeWall.tsx, NutritionList.tsx) are timing-agnostic and start `open=false`.
