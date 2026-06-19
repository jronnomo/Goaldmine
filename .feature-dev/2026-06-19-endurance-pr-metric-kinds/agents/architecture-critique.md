# Architecture Critique — Endurance PR Metric Kinds

**Agent:** Devil's Advocate  
**Date:** 2026-06-19  
**Blueprint reviewed:** `.feature-dev/2026-06-19-endurance-pr-metric-kinds/agents/architecture-blueprint.md`  
**Verdict:** NEEDS REVISION (3 concrete fixes before implementation)

---

## Methodology

Walked every changed function mentally, compared existing source at commit HEAD (records.ts:634-675, engine.ts:265-319, baseline-workout.ts:23-63, recap.ts:133-137, baselines/exercise/[name]/page.tsx:97-137, RecordsSummary.tsx:213-221, baselines/page.tsx:216-220), and diffed against the blueprint. All line numbers refer to the current source.

---

## Critical Issues

### CRIT-1 — UI helper parameter types never widened (compile error at `baselines/exercise/[name]/page.tsx`)

**What:** Three functions in `src/app/baselines/exercise/[name]/page.tsx` have hardcoded narrow parameter types:

```typescript
function chartTitleFor(p?: "rm" | "reps" | "duration"): string   // line 97
function unitsFor(p?: "rm" | "reps" | "duration"): string        // line 110
function tooltipFor(                                               // line 123
  p: "rm" | "reps" | "duration" | undefined,
  h: { ... },
): string
```

After `ExerciseSummary.primary` widens to `MetricKind`, the call sites at lines 45, 57, and 59 become TypeScript errors:

```typescript
chartTitleFor(summary?.primary)   // MetricKind not assignable to "rm"|"reps"|"duration"|undefined
unitsFor(summary?.primary)        // same error
tooltipFor(summary?.primary, h)   // same error
```

**Why it matters:** `npx tsc --noEmit` fails. The blueprint's §11.4 adds new `case` statements to all three functions but never updates the parameter types. The dev follows the instructions, writes the cases, then hits a red-herring type error that isn't at all obvious from the blueprint's instructions.

**How to fix:** Widen all three parameter types to `MetricKind | undefined` (import `MetricKind` at the top of the page file). This is a one-line change per function but is entirely absent from blueprint §11.4b, c, d.

**Severity: Critical** — guaranteed compile error; blocks the QA gate.

---

### CRIT-2 — Recap highlight card label mangles distance and time values

**What:** `src/lib/recap.ts` line 527 inside `computeWeeklyRecap`:

```typescript
label: `${pr.name} — ${Math.round(pr.bestValue)} ${pr.units}`,
```

After `UNIT_FROM_PRIMARY` gains `distance: "mi"` and `time: "sec"`:

- Distance PR: `bestValue=6.6`, `units="mi"` → `Math.round(6.6)=7` → **"20 Min Bike Distance — 7 mi"** (wrong precision; the real improvement was 5.9→6.6 mi, which rounds to 7, erasing the signal entirely)
- Time PR: `bestValue=480`, `units="sec"` → **"1.5 Mile Run — 480 sec"** (raw seconds; should be "8:00" to be readable)

For weights: `Math.round(225.3)=225 lb` is intentional (nearest lb). For distance and time, `Math.round` is the wrong formatter.

**Why it matters:** This is the recap highlight card — the shareable surface, the one that gets posted to Instagram. It will show the wrong value for the PR that motivated the entire feature ("Hey I biked 7 mi today" when the distance was 6.6).

**How to fix:** Add a `formatPrValue(value: number, units: string): string` helper in `recap.ts` that branches on units:

```typescript
function formatPrValue(value: number, units: string): string {
  if (units === "mi") return value.toFixed(2);
  if (units === "sec") {
    const m = Math.floor(value / 60);
    const s = value % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  return String(Math.round(value));
}
// Then use: label: `${pr.name} — ${formatPrValue(pr.bestValue, pr.units)} ${pr.units}`
```

The blueprint adds `distance: "mi"` and `time: "sec"` to `UNIT_FROM_PRIMARY` (correctly — needed for compile) but never touches line 527. This is a **fifth display site the blueprint missed entirely**.

The research output §1.8 lists four hard-compile-break sites; this is not one of them (it won't compile-fail, it just silently produces wrong output). That explains why it slipped through the research pass.

**Severity: Critical** — shareable card content is wrong; directly undermines the feature's reason for existing.

---

## Design Concerns

### HIGH-1 — `rawText` Sessions-list site for distance exercises: blueprint incorrectly says "no change needed"

**What:** `src/app/baselines/exercise/[name]/page.tsx` lines 90-95:

```typescript
function rawText(h: { rawWeight: number | null; rawReps: number | null; rawDuration: number | null }): string {
  if (h.rawWeight !== null && h.rawReps !== null) return `${h.rawWeight} lb × ${h.rawReps}`;
  if (h.rawReps !== null) return `${h.rawReps} reps`;
  if (h.rawDuration !== null) return formatDuration(h.rawDuration);
  return "—";
}
```

The blueprint §11.4d states: "rawText (line ~90–95) already falls through to `formatDuration` when `rawDuration !== null` and `rawWeight/rawReps` are null — this is correct for both `duration` and `time`. No change needed."

This claim is **partially correct for `time` and wrong for `distance`**:

- **Time exercises (e.g. "1.5 Mile Run"):** After the fix, the best set has `durationSec=480` (real run time). `rawDuration=480` → `rawText` returns "8:00". Correct.
- **Distance exercises (e.g. "20 Min Bike Distance"):**
  - Existing rows (phantom `durationSec=1200`, real `distanceMi=6.6`): `getExerciseHistory` selects the best set by `metricValue(s, "distance")` = `s.distanceMi`. So `best.s.durationSec=1200` (phantom). `rawDuration=1200` → `rawText` returns "20:00". **Wrong** — displays the fixed phantom workout duration, not the covered distance.
  - New rows after phantom suppression (no `durationSec`, `distanceMi=6.6`): `rawDuration=null` → `rawText` returns "—". **Wrong** — blank instead of "6.60 mi".

**Why it matters:** The Sessions list below the exercise history chart shows "20:00" for every historical bike entry (a constant, meaningless value from the phantom) and "—" for new entries. The chart itself will be correct (distance on Y-axis), but the drill-down list is broken.

**Root cause:** `ExerciseHistoryPoint` (records.ts:67-77) has `rawDuration: number | null` but no `rawDistance: number | null`. The blueprint widens `bestRaw` on `ExerciseSummary` but doesn't extend `ExerciseHistoryPoint`.

**How to fix:**

1. Add `rawDistance: number | null` to `ExerciseHistoryPoint` type in `records.ts`.
2. In `getExerciseHistory` (line ~513): populate `rawDistance: best.s.distanceMi ?? null`.
3. In `rawText` at `baselines/exercise/[name]/page.tsx`: add `if (h.rawDistance !== null) return \`${h.rawDistance.toFixed(2)} mi\`;` before the duration branch.

**Severity: High** — active misinformation in the Sessions list (phantom "20:00") for all existing bike distance rows; silently missed by both research and blueprint.

---

### MED-1 — Blueprint Step 6 comment says "skip ALL" but the code RECOMPUTES — developer confusion

**What:** Blueprint §6, the cross-kind branch comment says:

> "Policy: skip ALL cross-kind compares unless the two kinds are the same."

But the code immediately below it does NOT skip — it calls `metricValue(priorSets, thisSummary.primary)` to recompute a prior value using the current session's metric kind, and only skips if the recomputed set is empty. The existing source code at line 606 (`priorValue = Math.max(...recomputed)`) already does the same recompute; the blueprint preserves this logic but makes it direction-aware.

**Why it matters:** A developer reading "skip ALL cross-kind" then seeing recompute code will second-guess themselves and potentially change the logic. The comment is authoritative-sounding and wrong.

**Correct description:** "When kinds differ, recompute the prior value using this session's primary field. If the prior sets have no data for that field (e.g., prior is purely duration and there's no distanceMi), skip. Otherwise, compare direction-aware against recomputed prior."

**How to fix:** Rewrite the comment in the implementation to accurately describe the recompute-or-skip semantics. Two lines in the code comment, zero algorithm changes.

**Severity: Medium** — confusion risk during implementation; no code impact.

---

### MED-2 — Unmapped time-to-complete exercises silently produce wrong PRs (undocumented footgun)

**What:** The curated-registry decision is correct and the blueprint defends it well. The gap is that there is NO code comment in `METRIC_KIND_OVERRIDES` warning that any durationSec-bearing exercise that should be lower-better **must** be registered, or it silently defaults to higher-better duration behavior (harder hold = better).

Concrete future scenario: someone adds "800m Time Trial" to `program-template.ts` but forgets the registry. The exercise gets logged with `durationSec`. `bestSetSummary` falls through to the default `duration` cascade, returns `{primary:"duration", direction:"higher"}`. A slower 800m time fires as a PR; a faster one never will. No error, no warning.

**Why it matters:** The gotcha is not hypothetical — the entire feature exists because "20 Min Bike Distance" was unmapped and produced phantom PR signals. The registry fixes that. But without a warning comment, the same scenario repeats for the next timed endurance test added to the program.

**Is a heuristic guardrail worth it?** The question asks this. Answer: no cheap heuristic works reliably. Name-based ("run", "sprint", "shuttle") would duplicate the `prAttributeForExercise` END keyword set and still miss novel tests. It violates the curated-registry philosophy. The right fix is a comment, not a heuristic.

**How to fix:** Add a mandatory maintenance comment at the top of `METRIC_KIND_OVERRIDES`:

```typescript
// !! MAINTENANCE COVENANT !!
// Any exercise that measures time-to-complete (lower seconds = better) MUST be registered here.
// Unmapped durationSec exercises default to duration/higher-better (longer hold = better).
// Forgetting this registry entry means a faster sprint looks like a regression and never earns a PR.
// Check this list whenever a new timed endurance test is added to program-template.ts.
```

**Severity: Medium** — zero code impact today; real maintenance risk as the program evolves.

---

## Regression Safety Walkthrough

**Deadlift (rm) through the new `bestSetSummary`:**
Call: `bestSetSummary([{weightLb:225, reps:5, durationSec:null, distanceMi:null}], "Deadlift")`
1. `metricKindFor("Deadlift")` → null (not in registry)
2. Falls to default cascade: `weighted` passes, picks best by Epley, returns `{primary:"rm", direction:"higher", value:1RM}`
3. `recordsSetInWorkout` step 7: `isBetter("higher", new1RM, prior1RM)` = `new > prior` — identical semantics to old `value <= priorValue` guard
4. `buildPrEvents`: `isBetter("higher", ...)` — same

**Result: byte-identical for all unmapped rm/reps/duration exercises.** The only observable change is the addition of `direction:"higher"` on the return object, which is consumed correctly everywhere.

**Plank hold (duration, higher-better):**
`bestSetSummary` with no name falls to default cascade → `{primary:"duration", direction:"higher"}`. All comparisons use `isBetter("higher", ...)` = `>`. Identical to today.

**3/day PR cap interaction with retroactive endurance PRs:**
On baseline-collection days, the program replaces regular workouts. The risk of an endurance PR competing with 3 strength PRs for the same dateKey is minimal by program structure. Pre-change, "20 Min Bike Distance" produced zero PRs (constant phantom `durationSec=1200` never beats itself). Post-change it produces at most one PR per session. The net change in cap pressure is +1 on baseline days, not a regression.

---

## Retroactive Correctness Walkthrough

**Two bike results (5.9 mi on 6/9, 6.6 mi on 6/19) through `buildPrEvents`:**
1. Existing rows: both have `distanceMi={5.9,6.6}` AND `durationSec=1200` (phantom from old `mapBaselineToSet`). Confirmed via source: the `mi` branch runs first, then `minMatch` fires on "20 Min" since `set.durationSec` was undefined.
2. `buildPrEvents` processes 6/9 workout first: `metricKindFor("20 Min Bike Distance")` → `distance`. `bestSetSummary` returns `{primary:"distance", value:5.9}`. Prior = undefined → "first-ever, not a PR." `prBestByExercise` set to 5.9 mi.
3. 6/19 workout: `bestSetSummary` returns `{primary:"distance", value:6.6}`. Prior = `{primary:"distance", value:5.9}`. Same primary + `isBetter("higher", 6.6, 5.9)` → PR fires. **Correct.**

**Cross-kind prior scenario:** Because `bestSetSummary` is now registry-aware, BOTH historical and current evaluations resolve to `distance` for "20 Min Bike Distance". The cross-kind branch in step 6 is never triggered for this exercise in practice — `priorSummary.primary === thisSummary.primary === "distance"`. The concern is theoretical, not live-data.

**First-ever endurance result (no prior):** `prior = prBestByExercise.get(canon) = undefined` → "first-ever, not a PR." Same as all existing kinds. Correct.

**First distance log when all priors are phantom-only (no distanceMi in DB — hypothetical):**
If somehow a prior row had ONLY `durationSec=1200` with `distanceMi=null`, then `priorSummary` would be `{primary:"distance", value:null}` → actually `bestSetSummary` returns null (no distanceMi data). So `priorSummary = null` → "brand-new movement" → skip (no PR). The user gets no PR for the first real distance log. This is the "lost PR" scenario. In practice it doesn't apply because existing rows already have `distanceMi` written, but should be noted: the first time a distance exercise logs a real distance against phantom-only prior rows, no PR is awarded. This is the same as "first-ever" behavior and is **acceptable** — not a bug.

---

## Time/Duration Collision Assessment

**Is "unmapped = higher-better duration" acceptable as default?**

Yes, as long as the registry covenant is documented (see MED-2). The default cascade behavior:
- No `weightLb`/`reps` → not weighted
- No `reps` → not reps-only  
- `durationSec` present → `{primary:"duration", direction:"higher"}`

This is correct for holds (planks, dead hangs, wall sits) which are the natural unmapped `durationSec` candidates. Time-to-complete tests are always explicitly logged with a context ("Run", "Sprint", "Shuttle") that makes them easy to registry-identify.

A name-heuristic guardrail is **not recommended** — it would partially duplicate `prAttributeForExercise`'s keyword logic and create two places to maintain the same classification. The registry IS the guardrail; a comment IS sufficient documentation.

---

## Cross-Kind Prior Comparison — Blueprint Step 6 Correctness

The blueprint's recompute approach in step 6 is **correct in behavior**, just described incorrectly in the comment (see MED-1). The actual algorithm:

1. If `priorSummary.primary === thisSummary.primary`: use prior value directly.
2. Else: call `metricValue(priorSets, thisSummary.primary)` on each prior set and collect non-null results. If empty: `continue` (no comparable prior → skip). Else: take direction-aware aggregate (min for "lower", max for "higher").

Case: prior = `{primary:"duration", value:1200}`, now = `{primary:"distance"}`.
- `metricValue(priorSet, "distance")` = `priorSet.distanceMi ?? null`
- For old bike rows with `distanceMi=5.9`: returns [5.9] → `priorValue = max([5.9]) = 5.9`
- `isBetter("higher", 6.6, 5.9)` → true → PR fires. **Correct.**

The skip only fires if prior sets have no `distanceMi` at all (returns `[]`). In that scenario the user gets no PR for the first real distance measurement against phantom-only prior rows, which is correct behavior (same as first-ever).

---

## History Reducer and `getExerciseSummaries` Consistency Check

**All read paths surveyed:**

| Function | Current | Blueprint fix | Correct after fix? |
|---|---|---|---|
| `bestSetSummary` (cascade) | always higher | registry dispatch before cascade; direction on return | Yes |
| `recordsSetInWorkout` step 7 | `value <= priorValue` | `isBetter(direction, ...)` | Yes |
| `buildPrEvents` step 2 comparison | `workoutBest.value > prior.value` | `isBetter(workoutBest.direction, ...)` | Yes |
| `buildPrEvents` within-workout merge | `!existing \|\| summary.value > existing.value` | `isBetter(summary.direction, ...)` | Yes |
| `getExerciseHistory` best reducer (line 510) | `b.m > a.m` (always max) | direction-aware min/max | Yes |
| `getExerciseSummaries` caller | `bestSetSummary(bucket.sets)` | `bestSetSummary(bucket.sets, bucket.name)` | Yes |
| `getExerciseHistory` caller | `bestSetSummary(allSets)` | `bestSetSummary(allSets, canonical)` | Yes |
| `matchesBest` | equality check | unchanged (equality is direction-agnostic) | Yes |
| `rawText` in page | `rawDuration` only | NO CHANGE (blueprint says "no change needed") | **No — see HIGH-1** |

No site uses a hardcoded `> 0` or `max` that survives undetected after the type widening — TypeScript forces the map-value widenings in `engine.ts` as compile errors, which is the right fail-safe.

---

## Type Single-Source-of-Truth Assessment

**Inline union copies in `engine.ts`:**
Lines 266 and 274:
```typescript
const prBestByExercise = new Map<string, { primary: "rm" | "reps" | "duration"; value: number }>();
const workoutBestByExercise = new Map<string, { primary: "rm" | "reps" | "duration"; value: number }>();
```
After `bestSetSummary` returns `MetricKind` primary, setting these maps with `summary.primary` produces a TypeScript error. This is a **positive fail-safe** — the compiler forces the fix. Blueprint §8.3 correctly addresses this.

**Blueprint misses: parameter types of UI functions** (see CRIT-1 — these are compile errors too, but at the call site, not the definition site).

**No silent narrowing found:** every type that previously held `"rm" | "reps" | "duration"` either gets widened (triggering a compile error if missed) or uses `string` (baselines/page.tsx line 216, RecordsSummary.tsx line 214 — safe, no compile error, just fallthrough to `String(e.bestValue)` which shows a raw number for new kinds). The fallthrough cases are **correctly flagged as display-only in the blueprint**.

---

## UI Formatting Completeness

**Four blueprint sites — verified safe:**

1. `WorkoutLoggerForm.tsx` `RecordStrip` — blueprint §11.1: `r.kind === "distance" ? \`${r.value.toFixed(2)} mi\`` — correct.
2. `RecordsSummary.tsx` `formatBest` (primary: string, no compile gate) — blueprint §11.2: adds distance/time branches before fallthrough — correct.
3. `baselines/page.tsx` `formatBest` (same shape) — blueprint §11.3: same fix — correct.
4. `baselines/exercise/[name]/page.tsx` summary header — blueprint §11.4a: explicit distance branch prevents `formatDuration(6.6)` = "0:06" bug — correct.

**Fifth site missed (CRIT-2):** `recap.ts` line 527 highlight label.

**Sixth site missed (HIGH-1):** `rawText` in `baselines/exercise/[name]/page.tsx` sessions list.

**Grep cross-check on `.primary` / `.kind` / `bestValue`:**
- `baselines/page.tsx:112`: `formatBest(e)` — blueprint fixes.
- `RecordsSummary.tsx:131`: `formatBest(e)` — blueprint fixes.
- `WorkoutLoggerForm.tsx:170-178`: `r.kind` branches — blueprint fixes.
- `recap.ts:364`: `UNIT_FROM_PRIMARY[s.primary]` — blueprint fixes (compile blocker).
- `recap.ts:527`: `Math.round(pr.bestValue) ${pr.units}` — **blueprint misses** (CRIT-2).
- `page.tsx:33-36`: summary header ternary — blueprint fixes.
- `page.tsx:45,57,59`: function call sites — blueprint adds cases but misses type widening (CRIT-1).
- `page.tsx:73`: `rawText(h)` — blueprint incorrectly says "no change needed" (HIGH-1).

---

## Scope/Ceremony Assessment

**Is the feature branch + PR approach over-engineered?** No. The changes touch 8-9 files in a coupled way. A feature branch protects main from a partial-state compile breakage.

**PRD requirements silently dropped?** One partial drop: PRD §3.2 REQ-11 says "obvious siblings already named in BASELINE_ATTRIBUTE_MAP / program-template that are clearly distance or time." All 5 confirmed entries are in the registry. "20 Min Step-Up Reps" is correctly excluded (reps, higher-better). No requirement is dropped.

**PRD §3.1 item 4 signature drift:** PRD says `isBetter(kind, direction, candidate, incumbent)` (four params). Blueprint implements `isBetter(direction, candidate, incumbent)` (three params, drops redundant `kind`). The implementation is strictly better — `kind` is redundant when `direction` is available. Not a dropped requirement; an improvement.

**Over-engineering concern — `direction` on every return path:** Carrying `direction:"higher"` on the unmapped cascade return objects is slightly redundant (could derive from `kind` via a `directionFor(kind)` helper). But the blueprint's D-1 rationale is sound: having direction on the summary object prevents every comparison site from needing a separate lookup. The minor redundancy buys safety.

---

## Risk Table

| Risk | Severity | Likelihood of hitting | Blueprint addresses? | Fix cost |
|---|---|---|---|---|
| CRIT-1: UI param types, compile error | Critical | Certain (tsc gate) | No — blueprint §11.4 adds cases, drops type widening | Low (3 one-liners) |
| CRIT-2: Recap highlight label mangles distance/time | Critical | Certain (any bike PR week) | No — fifth missed site | Low (format helper) |
| HIGH-1: rawText missing rawDistance field | High | Certain (all existing bike history) | No — blueprint incorrectly says no change needed | Medium (ExerciseHistoryPoint + 2 callees) |
| MED-1: Step 6 comment misleads about "skip ALL" | Medium | Possible (dev confusion during impl) | No | Low (comment only) |
| MED-2: Unmapped time footgun undocumented | Medium | Future maintenance risk | No | Low (comment only) |
| Engine `distanceMi: true` Prisma select missing | Critical (was RISK-2) | Certain | Yes — blueprint §8.8 | Already addressed |
| UNIT_FROM_PRIMARY compile blocker | Critical (was RISK-1) | Certain | Yes — blueprint §9 | Already addressed |
| Retroactive false distance PR from single-result test | — | Impossible (first-ever = no PR by design) | Correctly handled | N/A |
| 3/day cap interference from new endurance PRs | Low | Unlikely (baseline days replace workouts) | Correctly handled | N/A |
| Phantom durationSec in old bike rows corrupting PR | — | Impossible (registry forces distanceMi path) | Correctly handled | N/A |

---

## Suggestions

**S-1 — Hoist `isMapped` to top of `mapBaselineToSet`**
The blueprint's guard pattern computes `metricKindFor(canonicalExerciseName(testName))` inline in the middle of the function, after direct field assignments. Cleaner to compute it once at the function top:
```typescript
const isMapped = metricKindFor(canonicalExerciseName(testName)) !== null;
```
Note: `metricKindFor` internally calls `canonicalExerciseName` again — the current blueprint triggers a second canonicalization at lookup time. Not a performance concern for a single-user app but slightly wasteful. Alternatively, pass `canonicalExerciseName(testName)` directly to `metricKindFor` to skip the double call.

**S-2 — Add `direction` to `ExerciseSummary` public type**
`ExerciseSummary.primary` is public (consumed by recap.ts, RecordsSummary.tsx, baselines pages). `BestSetSummary.direction` is not propagated to `ExerciseSummary`. If a future UI surface needs to know "lower is better" (e.g. adding a "↓" indicator on time PRs), the consumer must call `metricKindFor(name)` separately. Adding `direction: MetricDirection` to `ExerciseSummary` closes this gap proactively.

**S-3 — `prUnitTier` in `recap.ts` sorts "mi" and "sec" to tier 2 (same as duration)**
`prUnitTier(units: string): number` returns 2 for anything not "lb" or "reps". Distance and time PRs will sort AFTER strength PRs in the highlight card, same as duration PRs. This is intentional per the tier logic but worth a comment confirming endurance kinds intentionally land at tier 2, not as a silent fallthrough.

**S-4 — Add a test explicitly covering exact-3-strength-PRs-then-endurance-PR-on-same-dateKey**
Blueprint Group 6 tests the 3/day cap generally. The specific retroactive scenario — where 3 strength PRs were already at the cap on a day that also contained an endurance baseline test (now newly PR-eligible) — should have an explicit test case documenting the expected drop behavior.

---

## Missing Requirements

**MR-1 — MCP tool schema for `log_workout` does not enumerate `recordsSet.kind`**
`log_workout` in `src/lib/mcp/tools.ts` (line 2200) returns `{ id, message, recordsSet }` as a raw passthrough — no Zod output schema validates the `kind` field. This means new `"distance"` and `"time"` values will serialize correctly without code changes. **No action required for correctness.** However, the tool description string (line 2177) does not document the `recordsSet` shape at all. PRD §4.3 says this is "optional, low priority" — confirmed: no code action needed, documentation-only decision deferred.

**MR-2 — No `get_exercise_history` smoke test in the implementation order**
Blueprint §14 step 7 lists QA gates: `tsc`, `lint`, `build`, `vitest`. PRD §10.3 requires a live MCP curl smoke: `get_exercise_history {testName:"20 Min Bike Distance"}` to confirm `primary: "distance"` and `best: 6.6`. This smoke is mentioned in the PRD acceptance criteria (AC-13) but absent from the blueprint's implementation order. It belongs after the build gate.

---

## Verdict

**NEEDS REVISION** — not MAJOR REWORK. The algorithm design is correct. The registry/direction approach is the right architecture. Regression safety for existing exercises is solid. The retroactive XP behavior is correct per gotcha E.1. The engine's missing `distanceMi: true` select (RISK-2 from research) is correctly identified and fixed.

Three concrete fixes must land before implementation begins:

**Must-Fix 1 (CRIT-1):** Widen `chartTitleFor`, `unitsFor`, `tooltipFor` parameter types in `src/app/baselines/exercise/[name]/page.tsx` from `"rm" | "reps" | "duration"` to `MetricKind`. Blueprint §11.4 adds cases but omits this — guaranteed compile error.

**Must-Fix 2 (CRIT-2):** Fix the highlight card label at `src/lib/recap.ts` line 527. Replace `Math.round(pr.bestValue) ${pr.units}` with a format helper that branches on `"mi"` (`.toFixed(2)`) and `"sec"` (`formatDuration`). This is a missed sixth display site; `Math.round(6.6)=7` renders the bike PR incorrectly on the shareable card.

**Must-Fix 3 (HIGH-1):** Add `rawDistance: number | null` to `ExerciseHistoryPoint`, populate it in `getExerciseHistory`, and add a `rawDistance` branch to `rawText` in `baselines/exercise/[name]/page.tsx`. Blueprint incorrectly says "no change needed" for `rawText` — existing bike rows display phantom "20:00" in the Sessions list, new rows display "—".

With these three fixes incorporated, the blueprint proceeds to implementation.
