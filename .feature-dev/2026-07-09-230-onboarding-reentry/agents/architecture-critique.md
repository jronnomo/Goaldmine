# Devil's Advocate — #230 (+#248 bundled) onboarding re-entry + calendar first-run

PRD: `docs/prds/PRD-230-onboarding-reentry.md` §3.1/§4/§6. Verified against HEAD `275acd7` on `feature/phase1-auth`.

---

## Critical

### C1. Calendar gate uses the wrong first-run signal — `!goal` ≠ "0 goals" (§3.1.6, §6)

`getCalendarMonth()`'s `goal` is the **focus goal only**:

```ts
// src/lib/calendar.ts:146
const goal = await db.goal.findFirst({
  where: { isFocus: true },
  orderBy: { updatedAt: "desc" },
  ...
});
```

`isFocus` is not guaranteed non-null whenever `goalCount > 0`. Concretely:

- `deleteGoal` (`src/lib/goal-actions.ts:190-198`) is `db.goal.delete({ where: { id } })` — **no focus reassignment**. The MCP `delete_goal` tool (`src/lib/mcp/tools.ts:5128+`) has the same gap.
- `createGoalCore` only sets `isFocus: shouldBecomeFocus` where `shouldBecomeFocus = existingFocusCount === 0` (`src/lib/goal-core.ts:170-185`) — a second/third goal created while a focus goal already exists stays `isFocus: false` forever unless someone explicitly calls `setFocusGoal`.
- `setGoalTrackedCore` and `setPlanActiveCore` both *block* untracking/pausing the focus goal (`goal-core.ts:320-324`, `:366-370`) — so those two paths are actually safe — but deletion has no equivalent guard.

Net: **an established user with an active, tracked project goal (e.g. Chewgether) whose focus goal was deleted** ends up with `goalCount > 0` but `goal === null`. Under the PRD's literal `!goal` gate, the calendar shows the brand-new "Get started" card to a user who is not remotely first-run — a false first-run signal, exactly the risk flagged in the task brief.

**Fix**: gate the new card on the same signal Today already uses — `goalCount === 0` (via the new `getGoalCount()` helper), not `!goal`. Concretely in `calendar/page.tsx`:

```ts
const goalCount = await getGoalCount();
...
{goalCount === 0 && (
  <Card title="Get started">…</Card>
)}
{!program && goalCount > 0 && (
  <p>…No active plan…</p>
)}
```

This also cleanly satisfies the PRD's own edge-case table row "goal present, program null → Old line preserved" (a *someday* goal — has a focus goal, no plan yet — still shows the old "No active plan" line, since `goalCount > 0`), while fixing the deleted-focus-goal false positive. Note `otherGoalsMeta` (`src/lib/goal-events.ts:52`, "All active non-focus goals") is a *usable but weaker* proxy (`!goal && otherGoals.length === 0`) — it doesn't cover a user whose only goal is `active:false`/abandoned — `getGoalCount()` is the precise, PRD-consistent signal and is already being built for #248. Use it here too.

This is an AC-level bug, not a nice-to-have: PRD's own Success Criteria (§1.3) says "goal-having users see neither [card]" — the literal `!goal` spec violates that criterion in a real, reachable state.

---

## Concerns

### G1. React.cache + ALS interaction — verified safe, but worth stating explicitly for the record

- Precedent already exists in this exact pattern: `getCurrentUserId` (`src/lib/auth/current-user.ts:25`, `cache(async () => …)`) is explicitly documented (lines 14-16) as "memoized per React request render… NO module-global (that would leak one user's id across requests)". `getGoalCount` is the same shape (`cache(async () => (await getDb()).goal.count())`), so it inherits the same safety argument — no new risk class introduced.
- Next's own docs (`node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md`, "Deduplicating requests" section) confirm `React.cache` "deduplicate[s] requests within a single render pass" for non-`fetch` data access (ORM/DB) — exactly this use case.
- `dynamic = "force-dynamic"` is present on `page.tsx:26` and `calendar/page.tsx:8`, **not** on `layout.tsx`. This does not create a second render pass — a dynamic child segment forces the whole route (including its parent layout) to render dynamically per-request, but layout and page still render within the same request/RSC tree. No noStore/dynamic interplay quirk found.
- ALS interaction: on the RSC path, `_userScope.getStore()` is always empty (ALS is only populated by `runWithUser` in the MCP route handler), so `getDb()` always falls through to `forUser(await getCurrentUserId())`. Since `getCurrentUserId` is itself `cache()`-wrapped, the *first* `getDb()` call in the render pass (layout's, since layout renders before its child page) resolves the user once; `getGoalCount()`'s own `cache()` wrapper then dedupes on top of that. Two independent per-request memoization layers, not a module-global — no cross-tenant leak path found.

**Verdict on G1: not a blocker, PRD's cache() approach is sound** — flagging here only because the PRD (§4) explicitly asked the DA to verify it, and the answer should be on record with citations, not just asserted.

### G2. `#233` rebase surface — array/prop insertion point risks needless conflict (§3.1.2, §3.1.4)

`layout.tsx:141-164`'s signed-in Promise.all is the exact block #233 (N2 layout-fetch-deferral) is slated to gut (remove the 4 meal fetches). If `getGoalCount()` is added as a 5th destructured slot in the *same* array —

```ts
const [rawMeals, quickPickFoods, libraryFoods, today, goalCount] = await Promise.all([...]);
```

— then #233's diff has to surgically extract `goalCount` out of a block it's otherwise deleting wholesale, guaranteeing a merge/rebase touch-point on the same lines. Same issue for the `<BottomNav todaysMeals=… goalCount=…/>` prop list at `layout.tsx:196-202`.

**Fix**: keep `getGoalCount()` as a **separate, standalone statement**, not folded into the existing 4-item array:

```ts
const [rawMeals, quickPickFoods, libraryFoods, today] = await Promise.all([...]); // unchanged block
const goalCount = await getGoalCount(); // new — parallel-fetchable but kept isolated for #233's sake
```

and add `goalCount={goalCount}` as its own JSX line on `<BottomNav>` rather than interleaving it among the meal props. This turns #230's layout.tsx diff into a pure addition (new lines only) that #233 can delete around without conflict, instead of a modification to lines #233 is about to delete.

---

## Suggestions

### S1. MoreSheet row — exact markup to clone + icon choice

`navRows` (`MoreSheet.tsx:97-146`) is a module-level array rendered via `.map` (`:151-167`); the conditional row can't join that array (it's conditional on `goalCount` and targets `/onboarding`, not one of the fixed routes) — must be hand-authored JSX before the `.map`, matching research's finding. Exact anatomy to clone (from the `.map` body, `:152-166`):

```tsx
{goalCount === 0 && (
  <Link
    href="/onboarding"
    onClick={onClose}
    className="flex items-center gap-3 px-4 py-3 min-h-[48px] hover:bg-[var(--border)]/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-inset"
  >
    <span className="text-[var(--accent)] shrink-0"><GoalsIcon /></span>
    <span className="flex-1 min-w-0">
      <span className="block text-sm font-medium text-[var(--foreground)]">Set up your first goal</span>
      <span className="block text-xs text-[var(--muted)]">Guided setup — goal, targets, and your Claude coach</span>
    </span>
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden className="text-[var(--muted)] shrink-0">
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </Link>
)}
{navRows.map(...)}
```

a11y: existing rows already carry `min-h-[48px]` (exceeds the 44px/`min-h-11` touch target minimum) and `focus-visible:ring-2 … ring-inset` — both present in siblings, both must be preserved verbatim (not `min-h-11`; the house convention here is the arbitrary `[48px]`, so match that literally rather than substituting Tailwind's `min-h-11`/44px scale).

Icon: no existing icon is purpose-built for "create/onboard a goal." Reusing `GoalsIcon` (bullseye, already used for the `/goals` row directly below) is the pragmatic no-new-asset choice, but note it means two adjacent rows share one icon — acceptable since their `label`/`sub` text disambiguates purpose (guided setup vs. manage-existing), but call it out explicitly in the PR description so it isn't mistaken for a copy/paste bug in review.

### S2. Today gate — awaiting-order confirmed unaffected, cite the specific mechanism

Swapping `page.tsx:38`'s `gateDb.goal.count()` for `getGoalCount()` is behavior-preserving: `page.tsx:34` already calls `getCurrentUserId()` explicitly, and `layout.tsx`'s own `getDb()` call (which internally resolves `getCurrentUserId()`) has already run by the time page.tsx's body executes (layout is the parent, page is the child in the same render tree) — so `getCurrentUserId()` is already warm before page.tsx's gate even starts, same as today. `getGoalCount()`'s own memoization then guarantees page.tsx's call either populates or reuses the exact same cached count `layout.tsx` populates in its Promise.all — one query total, same value, same redirect condition (`gateGoalCount === 0 && !cookie`). No ordering hazard found.

### S3. Where-clause parity — trivially exact, worth stating precisely

`page.tsx:38` is `gateDb.goal.count()` with **no explicit `where` at all** — scoping comes entirely from `getDb()`'s Prisma extension injecting `userId` into `count`'s `args.where` (`src/lib/db.ts` `WHERE_OPS` includes `"count"`, `:121-135`). So the helper's exact required shape is:

```ts
export const getGoalCount = cache(async () => (await getDb()).goal.count());
```

No filter to replicate beyond what `getDb()` already does — parity is by construction, not by copying a where-clause.

---

## Scope check (§7 / axis 7)

Confirmed no creep in the PRD text: no BottomNav badge/dot on the More tab, no cookie logic changes (the MoreSheet row is explicitly cookie-independent, correctly distinct from the Today gate's cookie-gated redirect), no new routes, no server actions. Matches PRD §3.2 Out of Scope.

---

## Verdict: **APPROVE-WITH-FIXES**

Required before build: (1) fix the calendar gate to `goalCount === 0` instead of `!goal` (C1 — this is a real, reachable false-first-run bug, not speculative); (2) keep `getGoalCount()` as a standalone statement in `layout.tsx`, not folded into the existing meal-fetch Promise.all array, to minimize #233 collision (G2). React.cache safety (G1) is verified sound with precedent and should ship as designed — call it out in the PR description with the citations above so reviewers don't re-litigate it.
