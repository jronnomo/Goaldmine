# Architecture Critique — PRD-228 (compare dead counters + small UI gaps)

Reviewed against: `src/app/compare/page.tsx` (whole file, 327 lines), `src/components/compare/HeroSpan.tsx`, `src/components/StatTile.tsx`, `src/app/error.tsx`, `src/lib/compare-core.ts`, `src/app/layout.tsx`, `src/lib/compare.ts` (`buildCountersSection`, `:346-397`), `src/lib/program.ts` (`getActiveProgram`), `src/components/Card.tsx`, `CLAUDE.md`.

---

## Critical

None. The PRD's core mechanism (try/catch around data-fetch, standalone recovery Card) is sound and the premise-check in §1.2 is honest about the low real-world probability of the throw path. Nothing here blocks implementation — the items below are fixes to apply *while* writing the code, not reasons to send it back.

---

## Concerns

### C1 — `Promise.all` bundles three unrelated calls under one catch; error copy can lie about the cause
`page.tsx:157-167`:
```ts
const [result, focusGoal, activeProgram] = await Promise.all([
  computeComparison(rawA, rawB),
  db.goal.findFirst({ where: { active: true, isFocus: true }, ... }).then(...),
  getActiveProgram(),
]);
```
If `db.goal.findFirst` or `getActiveProgram()` throws (both hit Prisma independently — `getActiveProgram` does its own `db.plan.findFirst`, `src/lib/program.ts:31-34`) while `computeComparison` would have succeeded, `Promise.all` still rejects and the PRD's catch fires with "Couldn't build this comparison" — which is false; the comparison itself was fine. In practice this is low-severity (same Postgres, same outage usually takes all three down together — matches the PRD's WEAKENED verdict), but it's cheap to fix and removes a real inaccuracy.

**Fix**: narrow the try/catch to `computeComparison` alone, keep the other two outside it so they still resolve on success and don't get miscategorized on failure:
```ts
let comparisonError = false;
let result: ComparisonResult | null = null;
let focusGoal, activeProgram;
try {
  [result, focusGoal, activeProgram] = await Promise.all([
    computeComparison(rawA, rawB),
    db.goal.findFirst(...).then(...),
    getActiveProgram(),
  ]);
} catch {
  comparisonError = true;
}
```
This still runs all three in parallel (no waterfall regression) — it's a `try` placement change, not a parallelism change. If `focusGoal`/`activeProgram` throw, that rejection still propagates to the root `error.tsx` boundary (appropriate — it's a generic infra failure, not a "your date range didn't compute" story).

### C2 — Exact error-path `defaultValue`s: use `rawA`/`rawB`, not `result.dateA`/`result.dateB` (which don't exist)
`rawA`/`rawB` (`page.tsx:154-155`) are computed *before* the data-fetch block and are always well-formed `yyyy-mm-dd` strings — either the regex-validated `params.a`/`params.b` or the `last30Key`/`todayKey` fallback (the malformed-params rule at `:148-153` guarantees both-or-neither). They do not depend on `result`, so they're safe to read inside a `catch`. Prescribed fallback:
```tsx
<input type="date" name="a" defaultValue={rawA} max={todayKey} ... />
<input type="date" name="b" defaultValue={rawB} max={todayKey} ... />
```
One caveat worth documenting, not fixing: `rawA`/`rawB` are pre-normalization (no swap, no future clamp — that happens inside `normalizeDateRange`, called from `computeComparison`, `compare-core.ts:211-236`). If a user submitted `a > b` or a future date and `computeComparison` throws for an *unrelated* reason (infra), the recovery form will show the raw, unswapped/unclamped values, and a future `rawA`/`rawB` value would exceed `max={todayKey}` (browser shows it but flags invalid — no crash, no data loss, self-corrects on next real submit). Acceptable for an error fallback; call it out in the PR description so QA doesn't file it as a new bug.

### C3 — Form markup duplication risk (DRY)
The date-form JSX (`page.tsx:220-245`, ~25 lines with exact Tailwind class strings) will be needed verbatim in both the happy path and the new error-path Card. Copy-pasting it is exactly the kind of thing that drifts (someone tweaks `min-h-11` or the button classes later and only touches one copy). Extract a small local, non-exported, server-safe component in `page.tsx`:
```tsx
function DateRangeForm({ dateA, dateB, todayKey }: { dateA: string; dateB: string; todayKey: string }) {
  return (
    <form method="get" className="flex items-end gap-2">
      {/* existing From/To/Go markup, parameterized */}
    </form>
  );
}
```
Use it for both `defaultValue={result.dateA}` (happy path) and `defaultValue={rawA}` (error path). Low cost, removes a real maintenance hazard, keeps the diff small since it's a pure extraction.

### C4 — sameDay + clampedToToday ordering reads slightly backwards
Prescribed final `HeroSpan.tsx` JSX (subtitle replaces the `spanDays`-line + drops the separate `sameDay && "Same day selected."` line, per PRD §4.4c):
```tsx
{sameDay ? (
  <p className="mt-2 text-[15px] text-[var(--muted)]">
    Same day on both sides — pick an earlier start date to see progress.
  </p>
) : (
  <p className="mt-2 text-[15px] text-[var(--muted)]">{spanDays} days of showing up.</p>
)}
{swapped && <p className="mt-1 text-xs text-[var(--muted)]">Dates reordered.</p>}
{clampedToToday && (
  <p className="mt-1 text-xs text-[var(--muted)]">Future date clamped to today.</p>
)}
```
`swapped` and `sameDay` are mutually exclusive by construction (`normalizeDateRange`: `swapped = cb < ca` is false when `ca === cb`), so no ordering conflict there. But `sameDay && clampedToToday` **can** co-occur (user picks two different future dates that both clamp to `todayKey`, producing an artificial same-day collision the user didn't ask for). Rendered order is nudge-then-clamp: "Same day on both sides — pick an earlier start date to see progress." / "Future date clamped to today." That reads slightly backwards — the clamp is the *cause*, the nudge is the *consequence*, but the clamp explanation appears second. Not contradictory, just suboptimal sequencing. Recommend swapping the two lines when both are true, or leave as-is (PRD's edge-case table only requires "both render," doesn't mandate an order) — flagging as a Suggestion-tier nit, not a blocker, since the two lines are still independently true and non-contradictory either order.

### C5 — Streaming/flush risk: verified non-issue, but for a specific reason worth recording
`src/app/loading.tsx` exists at the root, so Next.js wraps `/compare` in an implicit Suspense boundary at the layout level. That *could* be a hazard if `ComparePage` itself opened a nested Suspense boundary and streamed partial JSX before an inner throw — but it doesn't: the entire component is a single top-level `await` block followed by one `return`. Nothing is emitted until the whole function either returns or throws, so moving the throw into a local `catch` and returning fallback JSX instead is safe — no partial-flush corruption, the outer `loading.tsx` fallback is simply swapped for whichever JSX the function returns. Confirmed by reading the full file; no other `await` boundaries exist between the top and the return. This is a "checked, not a real risk" item — recording it so the dev doesn't need to re-derive it.

---

## Suggestions

### S1 — Page chrome (BottomNav/AppHeader) needs no special handling
`BottomNav` and `AppHeader` live in `src/app/layout.tsx:4,196` (root layout), not in `compare/page.tsx`. `page.tsx`'s own return is only the `<div className="mx-auto max-w-md space-y-4 p-4">...</div>` content — there is no page-level chrome inside the component that the error branch needs to replicate. The root layout wraps whatever `page.tsx` returns (happy path or the new catch branch) automatically. Nothing to prescribe here beyond confirming it — worth a one-line comment in the PR so a reviewer doesn't ask "did you remember the bottom nav?"

### S2 — 7-vs-8 tile grid wrap is cosmetic, not a bug
`grid-cols-3 gap-2` with 8 tiles (Level shown) wraps 3/3/2 — last row has one empty cell, tiles left-aligned, no stretching artifact (StatTile has no `flex-1`/`w-full` forcing a fill). With 7 tiles (Level hidden — `between.levelA`/`levelB` both null when `GameState.goalKind === null`, `compare.ts:373-379`) it wraps 3/3/1 — same shape, one visually lonelier last cell. Neither is broken, just asymmetric; matches the existing 6-tile (3/3) pattern's aesthetic already accepted in prod. Not worth restructuring the grid for; flagging only so 390px screenshot review (AC6) doesn't second-guess it as a regression.

### S3 — `formatValue(0, "")` renders `"0"`, not `"—"` — confirmed safe
`compare-core.ts:157-164`: `value === null` is the only `"—"` path; `0` is not `null`, is an integer, so `Number.isInteger(0) → true → (0).toLocaleString("en-US") → "0"`. Zero-row users get `"0"` tiles as the PRD's edge-case table expects (`§6` "Zero-row user → tiles render 0s; no crash"). No fix needed, just verified against the actual function rather than assumed.

### S4 — aria-label must gate the Level clause the same way the tile does
Current aria-label (`page.tsx:285`) is already stale (omits mi hiked + Level per research-output.md). New enumeration must mirror the JSX's own conditional exactly — if it unconditionally appends "Level A to B" text while the Level tile is hidden (both null), the label describes content that isn't rendered, which is worse than the current staleness (a *wrong* assertion vs. an *incomplete* one). Prescribed pattern:
```tsx
aria-label={`The work between ${formatHeroDate(result.dateA)} and ${formatHeroDate(result.dateB)}: ` +
  `${between.workoutsCompleted} workouts, ${between.hikesCompleted} hikes, ` +
  `${between.hikeElevationFt} feet climbed, ${between.hikeDistanceMi} miles hiked, ` +
  `${between.xpEarned} XP earned, ${between.baselineTestsLogged} baseline tests logged, ` +
  `${between.notesLogged} notes logged` +
  (between.levelA !== null && between.levelB !== null
    ? `, level ${between.levelA} to ${between.levelB}`
    : "")}
```
Build this as a small local string (`const workLabel = ...`) rather than one giant inline template — the current inline style is already at the edge of readability at 4 stats; 8 pushes it over.

### S5 — no existing try/catch-in-server-component precedent in this codebase
Grepped `src/app/**/page.tsx` for `try {` — zero hits. This will be the first server component in the app that catches its own data-fetch failure instead of relying on `error.tsx`. Not a reason to avoid it (the PRD's reasoning — recoverable, scoped UX beats the generic boundary — is sound and consistent with the rest of the app's error-page copy tone), just noting there's no established idiom to copy from; keep the pattern minimal (data-fetch try/catch, not a wrapping error-boundary component) so it doesn't become a one-off style fork.

### S6 — consider logging the caught error server-side
No `console.error`/Sentry convention found in `src/app/` or `src/lib/`. Not blocking, but swallowing the exception entirely means an infra blip on `/compare` leaves zero trace. A bare `console.error("compare: computeComparison failed", err)` in the catch costs nothing and matches Vercel's function-log visibility that the team already relies on elsewhere (implicit — no dedicated logger exists to route through).

### S7 — iOS Safari `max` on `type="date"`: no known blocking quirk, verify on-device anyway
Modern iOS Safari (≥14.5, well within this app's support window) respects `min`/`max` on `<input type="date">` and grays out out-of-range wheel values; Android Chrome does the same with its picker. No known iOS-specific bug that breaks `max={todayKey}` specifically. Since AC6 already calls for 390px screenshots, no extra QA step needed beyond what's planned — just don't assume desktop Chrome behavior transfers 1:1 to the picker UI on-device.

---

## Verdict: APPROVE-WITH-FIXES

Top 3 to apply before/while coding:
1. **Narrow the catch to `computeComparison` alone** (C1) — keep `focusGoal`/`activeProgram` outside it so the error copy stays accurate and parallelism is preserved.
2. **Use `rawA`/`rawB` (not `result.dateA/dateB`) as the error-path `defaultValue`s**, both already guaranteed well-formed by the malformed-params rule at `page.tsx:150-155` (C2).
3. **Extract the date-form JSX into a shared local component** used by both the happy path and the error Card (C3) — avoids a copy-paste drift bug on day one.

No architectural blockers; BottomNav/AppHeader need no special handling (S1, they live in root `layout.tsx`); the streaming/flush concern is a non-issue given no nested Suspense inside the page (C5).
