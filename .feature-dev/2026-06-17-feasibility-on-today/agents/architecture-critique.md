# Architecture Critique — FeasibilityReadout on Today (Story #78)

**Author:** Devil's Advocate Agent · **Date:** 2026-06-17
**Target:** `.feature-dev/2026-06-17-feasibility-on-today/agents/architecture-blueprint.md`
**Method:** Full read of page.tsx, ProjectTodayView.tsx, rarity.ts, rarity-core.ts, FeasibilityReadout.tsx, goal-focus.ts, calendar.ts, quality-tools.md. Every claim below is cited to a specific file:line.

---

## Summary verdict

The blueprint is **substantially correct** — sequencing analysis, line numbers, type analysis, and serialization claims all check out against live code. One critical defect exists (D-4 throw-safety reasoning is factually wrong) and one secondary gap exists (Vitest missing from QA gates). Everything else is ready to implement.

---

## CRITICAL

### C-1 — D-4's "broader page would fail anyway" reasoning is factually wrong — `.catch(() => null)` is mandatory

**Blueprint claim (§1c, Decision D-4):** "A DB error would break the broader page anyway. Masking it with null degrades the signal without adding safety."

**What the code actually does:**

`page.tsx` runs three sequential async phases:
1. `await Promise.all([getActiveProgram(), getFocusGoal()])` — line 24
2. `await Promise.all([...8 items + goalForFeas])` — line 61, blueprint 9th item
3. `const feasibility = goalForFeas ? await computeGoalFeasibility(goalForFeas) : null` — proposed sequential call after line 93

By the time phase 3 executes, phases 1 and 2 have **already completed and returned data**. A failure in `computeGoalFeasibility`'s per-target Prisma queries — e.g., a timeout on `prisma.logEntry.findMany` inside `observedSeriesFor` (`rarity.ts:127`), or a sequential-loop query failure in the cumulative-metric path (`rarity.ts:115` — up to 7 `await resolveMetricValue(...)` calls per target in a `for` loop) — throws an uncaught exception that bubbles up through the server component tree. The 8 successfully-resolved queries from phase 2 are discarded. The user sees the Next.js error boundary, not Today.

The exact same fault topology applies to `ProjectTodayView.tsx`: phases 1 (the `Promise.all` at line 31, resolving `[items, mrrEntry, nextMilestone, goalRow]`) completes before `computeGoalFeasibility` runs. A failure in the feasibility sub-queries crashes the project Today view even though items/MRR/milestone data is intact.

**The "broader page would fail anyway" claim is only true for whole-pool DB outages** (e.g., Neon is unreachable). For query-specific failures — lock timeout, bad query plan on a specific table, `resolveMetricValue` returning an error for an unusual metric family — phases 1 and 2 succeed and only the feasibility sub-queries fail. This is not a hypothetical: the cumulative-metric path in `rarity.ts:113–122` fires up to `(lookbackWeeks + 1)` sequential DB queries in a for-loop, each independently capable of timing out.

**Fix required in BOTH files:**

```ts
// page.tsx — after the second Promise.all closes (proposed after line 93):
const feasibility = goalForFeas
  ? await computeGoalFeasibility(goalForFeas).catch(() => null)
  : null;

// ProjectTodayView.tsx — after the existing Promise.all closes (after line 67):
const feasibility = await computeGoalFeasibility({
  id: goal.id,
  targetDate: goal.targetDate,
  targets: goalRow?.targets,
  kind: goal.kind,
}).catch(() => null);
```

The JSX guards (`{feasibility && ...}` in page.tsx; the component renders nothing when `feasibility` is null) already handle the null case correctly. No other change is needed. The "degraded signal" concern in D-4 is real but irrelevant: a missing Reach card is infinitely better than a blank Today page on the app's highest-value surface.

---

## CONCERNS

### W-1 — QA gates omit `npm test` (Vitest) — PRD AC-6 requires it

**Blueprint §7 lists:** `npx tsc --noEmit`, `npm run lint`, `npm run build`.

**PRD AC-6 states:** "npx tsc --noEmit, lint, npm run build, **npx vitest run** pass."

**What exists in the repo:** `package.json:10` — `"test": "vitest run"`. Vitest was added in commit `f7a5c48` ("chore(nutrition): land food-units fix + Vitest test setup"). `quality-tools.md:9` says "No tests configured" but that is now stale.

The blueprint's QA gate section never mentions the test runner. If the Developer uses the blueprint as the authoritative checklist, Vitest is skipped. This story likely does not add new test files, but existing tests could detect regressions in metric or rarity logic if imports are accidentally disrupted.

**Fix:** Add `npm test` as a QA gate in §7.

---

### W-2 — `observedSeriesFor` cumulative path has a sequential inner loop; latency deserves an explicit call-out

**Blueprint §3 (Caching / Cost):** "Dated goal with N targets: up to 2 queries per target."

**Actual behavior (`rarity.ts:113–122`):**

```ts
for (let w = 0; w <= weeks; w++) {
  const snapDate = w === weeks ? now : addDays(since, w * 7);
  const val = await resolveMetricValue(prisma, metric, snapDate, goalId);
```

For a cumulative metric (`hike:*`, `workout:count`) with a 6-week lookback window, this loop fires **7 sequential `resolveMetricValue` awaits**, each a separate Prisma query. Each target with one of these metric families contributes 7 sequential DB queries, NOT 2. For an Elbert fitness goal with `hike:total_elevation_ft` and `workout:count` as targets, the budget is more like `2 × 7 = 14` sequential queries in the cumulative path alone, plus the per-target `resolveMetricValue` fallback queries.

This is **not a blueprint bug** — it is a pre-existing characteristic of `computeGoalFeasibility`. But the blueprint's query budget estimate is misleadingly low. The Developer and QA agent should be aware that if fitness Today becomes noticeably slower after this story lands, the culprit is the sequential cumulative loop inside `observedSeriesFor`, not the blueprint's structure. Instrumenting with `console.time` around the `computeGoalFeasibility` call during smoke testing is advisable.

---

## VERIFIED (no action needed)

### V-1 — Two-Promise.all blocks in page.tsx: confirmed; focusGoal precedes the second

`page.tsx:24` — First `await Promise.all([getActiveProgram(), getFocusGoal()])` resolves `focusGoal`.
`page.tsx:46` — `if (focusGoal?.kind === "project")` early-return fires → project path exits.
`page.tsx:61` — Second `await Promise.all([...8 items])` — `focusGoal` is fully known here and used as `focusGoal.id` in the guarded 9th item. No circular dependency.

The blueprint's D-1 and D-2 decisions are correct. Adding `goalForFeas` as the 9th item using `focusGoal ?` is valid TypeScript and safe at runtime.

### V-2 — Sequential-after-Promise.all requirement: confirmed in BOTH files

**page.tsx:** `goalForFeas` is the 9th output of the second Promise.all (line 61 block). `computeGoalFeasibility(goalForFeas)` runs sequentially after the block closes. Correct — no sibling-dependency violation.

**ProjectTodayView.tsx:** `goalRow` (4th output of `Promise.all` at line 31) carries `{ targets: true }`. `computeGoalFeasibility` uses `goalRow?.targets` and runs AFTER the block closes (after line 67). Correct. Blueprint D-3 is right that the research-output suggestion to "add it to the Promise.all as a 5th member" would have been wrong.

### V-3 — parseTargets: no JSON.parse, no throw risk on malformed targets

`rarity.ts:157–170` — `parseTargets(raw: unknown)` takes an already-parsed `Prisma.JsonValue` (not a JSON string). It calls `Array.isArray(raw)` then validates object shape. No `JSON.parse`, no `throw`. Malformed or null input returns `[]` → "no-targets" fast path (0 DB queries). Throw risk on this path: **none**.

### V-4 — Pick change valid; FocusGoalRow.kind confirmed

`goal-focus.ts:15` — `FocusGoalRow` has `kind: string`. `page.tsx:47` passes `focusGoal` (a full `FocusGoalRow`) to `<ProjectTodayView goal={focusGoal} />`. Expanding the Pick to include `"kind"` is purely additive — the call site already satisfies the stricter type.

### V-5 — Hero markup is byte-identical; insertion is a sibling element

`page.tsx:209–255` — The `<section aria-label="Today's workout">` fitness hero block. Line 255 is `</section>` — the hero's closing tag. The blueprint inserts the Reach card AFTER line 255 as a sibling `div`-level element inside the `space-y-4` column. Lines 208–255 are untouched. Confirmed.

### V-6 — No Date instance crosses the RSC→client boundary

`rarity.ts:195` — `computedAt = now.toISOString()` — string at construction, not a `Date`.
`GoalFeasibility` type (`rarity-core.ts:209–218`) — all fields are `string | number | boolean | null | RarityTier | TargetFeasibility[]`. `TargetFeasibility` (`rarity-core.ts:191–207`) — same, no `Date`.
`FeasibilityReadout.tsx` — no `"use client"`, renders to HTML server-side. Never passed into `TodayCelebration` (client component in both files).
`targetDateLabel` — computed via `Intl.DateTimeFormat.format(Prisma Date)` → string. Fine.

### V-7 — computeGoalFeasibility never returns null; unconditional render in ProjectTodayView is safe

All return paths in `computeGoalFeasibility` (`rarity.ts:190–293`) return a `GoalFeasibility` object:
- `targetDate === null` → `{ unratedReason: "someday", ... }` (line 199)
- `targets.length === 0` → `{ unratedReason: "no-targets", ... }` (line 213)
- All targets `countsTowardTier: false` → `{ unratedReason: "no-data", ... }` (line 279–286)
- Rated path → `{ tier, unratedReason: null, ... }` (line 283–293)

None return `null` or `undefined`. The blueprint's D-7 decision (unconditional `<FeasibilityReadout>` in ProjectTodayView) is valid.

`FeasibilityReadout.tsx:95–190` covers all 4 states internally (`someday`, `no-targets`, `no-data`, `TIER_SET`). The `{tier:null, unratedReason:null}` impossible case has a `"—"` fallback at line 171.

### V-8 — normPackForGoal("project") falls back to FITNESS_NORM_PACK; harmless for log:mrr

`rarity-core.ts:131–133` — `normPackForGoal` returns `RARITY_NORM_PACKS[goalKind] ?? FITNESS_NORM_PACK`. Only `"fitness"` is registered. For `goalKind="project"`, it falls back to `FITNESS_NORM_PACK`.

However, `log:*` metrics (including `log:mrr`) explicitly have no norm in `FITNESS_NORM_PACK` — the comment at `rarity-core.ts:104` says "log:* metrics have no population norm — observed-only by design." `computeTargetFeasibility` for a `log:mrr` target with no norm and insufficient data (`observedPoints < minObservedPoints`, `norm === null`) returns `{verdict:"unknown", countsTowardTier:false}` (rarity-core.ts:491–504). All perTargets `countsTowardTier: false` → `unratedReason: "no-data"` → FeasibilityReadout shows "Not enough logged data to rate yet…" — exactly AC-4's expected Chewgether state. The FITNESS_NORM_PACK fallback is benign for this story.

### V-9 — USER_TZ is exported from @/lib/calendar; import extension is valid

`calendar.ts:33` — `export { USER_TZ, ... }` re-exports from `calendar-core.ts`. The blueprint's proposed addition of `USER_TZ` to the existing destructure at `page.tsx:8` is valid.

`ProjectTodayView.tsx:11` — `USER_TZ` is already imported. No change needed there.

### V-10 — goalForFeas targets don't double-fetch in ProjectTodayView

The existing 4th Promise.all slot (`ProjectTodayView.tsx:63–66`) fetches `{ targets: true }` from the goal and produces `goalRow`. The blueprint passes `goalRow?.targets` as the `targets` argument to `computeGoalFeasibility`. `computeGoalFeasibility` calls `parseTargets(goal.targets)` internally — it does NOT re-query targets. No double fetch.

### V-11 — No double feasibility compute across the two code paths

`page.tsx:46–48` — when `focusGoal?.kind === "project"`, the function returns `<ProjectTodayView goal={focusGoal} />` and exits. The fitness path (lines 50–349) including the proposed `computeGoalFeasibility` call never executes on the project path. These are mutually exclusive branches.

---

## SUGGESTIONS

### S-1 — Smoke test: log timing around computeGoalFeasibility during dev

Given W-2's latency note, add a temporary `console.time("feasibility")` / `console.timeEnd("feasibility")` bracket around the `await computeGoalFeasibility(...)` call during first smoke run. Remove before commit. This costs nothing and immediately surfaces if Elbert's targets include cumulative metrics that trigger the sequential loop.

### S-2 — QA grep: confirm no accidental `new Date()` inside FeasibilityReadout

The PRD's verification grep is:
```sh
grep -nE "setHours|getDate\(|getMonth\(|getFullYear" \
  src/app/page.tsx src/components/ProjectTodayView.tsx
```
The Intl.DateTimeFormat call for `targetDateLabel` in both files uses `USER_TZ` — correct. The `new Date()` at `page.tsx:163` is for the `dayLabel` variable (existing, unrelated to this story). No issue.

---

## The one thing the Developer must get right

**Wrap both `await computeGoalFeasibility(...)` calls in `.catch(() => null)`.**

The sequential position of these calls — after the main Promise.all in each file — means they run after all other page data is already resolved. An unhandled exception here (transient query failure in any of the per-target Prisma queries inside `observedSeriesFor`) blanks the entire Today page for the user, discarding 8–12 successfully-completed DB queries. The `{feasibility && ...}` guard in page.tsx and FeasibilityReadout's four internal states already handle `null` correctly. The `.catch(() => null)` costs one character per site and prevents a Reach card edge case from nuking the most important page in the app.
