# QA Report — Endurance PR Metric Kinds

**Agent:** QA  
**Date:** 2026-06-19  
**Branch:** feature/endurance-pr-metric-kinds (merged to main)  
**Precondition:** orchestrator confirmed tsc 0 errors, vitest 180/180, lint clean, build success.

---

## 1. Requirements Status

| REQ | Title | Status | Evidence |
|-----|-------|--------|----------|
| REQ-001 | Widen union + curated registry | **PASS** | `MetricKind = "rm" \| "reps" \| "duration" \| "distance" \| "time"` at records.ts:62. `METRIC_KIND_OVERRIDES` at records.ts:190 with all 5 confirmed entries + maintenance covenant comment. `metricKindFor()` at records.ts:204 resolves through `canonicalExerciseName`. |
| REQ-002 | Direction-aware best + comparison | **PASS** | `bestSetSummary` accepts `canonicalName?` at records.ts:726. Registry dispatch before cascade at records.ts:736. `isBetter(direction, candidate, incumbent)` at records.ts:215. Cross-primary branch recomputes via `metricValue(priorSets, thisSummary.primary)` at records.ts:670–677 with direction-aware aggregate. Guard for empty recomputed at records.ts:673. |
| REQ-003 | Engine PR replay parity | **PASS** | `buildPrEvents` imports `MetricKind`, `MetricDirection`, `isBetter` from records.ts (engine.ts:21). `prBestByExercise` and `workoutBestByExercise` typed as `Map<string, { primary: MetricKind; direction: MetricDirection; value: number }>` at engine.ts:267,275. PR comparison at engine.ts:301 uses `isBetter(workoutBest.direction, ...)` — direction-aware. 3/day cap intact at engine.ts:312. `distanceMi` selected in Prisma query at engine.ts:955. |
| REQ-004 | Kill phantom duration stamp | **PASS** | `isMapped = metricKindFor(canonicalExerciseName(testName)) !== null` at baseline-workout.ts:62. `!isMapped` guard on `distMatch` at baseline-workout.ts:65, `minMatch` at baseline-workout.ts:69, `meterMatch` at baseline-workout.ts:73. Unit test at records.test.ts:752 confirms `mapBaselineToSet("20 Min Bike Distance", 6.6, "mi")` returns `{distanceMi: 6.6}` with no `durationSec`. |
| REQ-005 | Read-surface correctness | **PASS** | `getExerciseSummaries` passes `bucket.name` to `bestSetSummary` at records.ts:499. `getExerciseHistory` passes `canonical` at records.ts:539. History reducer at records.ts:572 is direction-aware: `summary.direction === "lower" ? (b.m < a.m ? b : a) : (b.m > a.m ? b : a)`. `rawDistance` field added to `ExerciseHistoryPoint` at records.ts:86; populated at records.ts:583. Live: `get_exercise_history("20 Min Bike Distance")` returned `primary: "distance"`, `bestValue: 6.6`. `get_exercise_history("1.5 Mile Run")` returned `primary: "time"`, `bestValue: 600` (correctly the lower/faster of 600s and 655s). |
| REQ-006 | Tests | **PASS** | 7 test groups in records.test.ts: `metricKindFor` (9 cases), `isBetter` (6 cases), `bestSetSummary` mapped (4 cases), `bestSetSummary` unmapped/regression (5 cases), `recordsSetInWorkout` via DB mock (6 cases), `buildPrEvents` via `computeGameStateFromData` (5 cases including 3/day cap and retroactive), `mapBaselineToSet` (8 cases). All cover PRD §10.2 scenarios. |

---

## 2. Acceptance Criteria (PRD §8) Status

| AC | Description | Status | Notes |
|----|-------------|--------|-------|
| 1 | tsc 0 errors | **PASS** | Confirmed by orchestrator |
| 2 | lint no new errors | **PASS** | Confirmed by orchestrator |
| 3 | build success | **PASS** | Confirmed by orchestrator |
| 4 | vitest green (new + existing) | **PASS** | 180/180 confirmed by orchestrator |
| 5 | `MetricKind` includes distance/time; `RecordSet.kind` + `ExerciseSummary.primary` use it | **PASS** | records.ts:62,71,97 |
| 6 | `METRIC_KIND_OVERRIDES` exists; `metricKindFor()` resolves | **PASS** | records.ts:190,204 |
| 7 | `bestSetSummary` returns distance/higher for bike, time/lower for run | **PASS** | Unit tests Group 3; live smoke confirms |
| 8 | `recordsSetInWorkout` returns `kind:"distance"` for 5.9→6.6; `kind:"time"` only for faster run | **PASS** | Unit tests Group 5 |
| 9 | `buildPrEvents` emits pr.set END for bike/run PRs; none for slower run; cap respected | **PASS** | Unit tests Group 6; live smoke confirms |
| 10 | Unmapped strength movements identical before/after | **PASS** | Unit tests Group 4+5 regression cases |
| 11 | `mapBaselineToSet("20 Min Bike Distance", 6.6, "mi")` → `{distanceMi:6.6}` no `durationSec` | **PASS** | records.test.ts:752 |
| 12 | Date math unchanged | **PASS** | No date function calls modified |
| 13 | Live: `get_game_state` shows retroactive `pr.set · 20 Min Bike Distance` | **PASS** | Live smoke — see Section 4 |

---

## 3. Must-Fix Verification

### Must-Fix 1 (CRIT-1): UI helper param types widened to MetricKind
**Status: FIXED**

At `src/app/baselines/exercise/[name]/page.tsx`:
- `chartTitleFor(p?: MetricKind)` — line 100: correct type, handles all 5 cases
- `unitsFor(p?: MetricKind)` — line 117: correct type, handles all 5 cases
- `tooltipFor(p: MetricKind | undefined, h: {...})` — line 134: correct type, handles all 5 cases; `h` param now includes `rawDistance: number | null`

All three parameter types are `MetricKind`, not the old 3-member union. tsc passes.

### Must-Fix 2 (CRIT-2): Recap highlight card label no longer uses `Math.round` for distance/time
**Status: FIXED**

`formatPrValue(value, units)` helper added at recap.ts:167:
- `"mi"` → `value.toFixed(2)` (e.g., "6.60")
- `"sec"` → M:SS format (e.g., "8:00")
- other → `String(Math.round(value))` (unchanged for weights)

Used at recap.ts:545: `label: \`${pr.name} — ${formatPrValue(pr.bestValue, pr.units)} ${pr.units}\``  
No more `Math.round(6.6) = 7` mangling.

### Must-Fix 3 (HIGH-1): `rawDistance` added to ExerciseHistoryPoint, populated, branched in rawText
**Status: FIXED — with a residual display issue (see §5)**

- `ExerciseHistoryPoint.rawDistance: number | null` added at records.ts:86 ✓
- Populated in `getExerciseHistory` at records.ts:583: `rawDistance: best.s.distanceMi ?? null` ✓
- `rawText` in baselines/exercise/[name]/page.tsx now includes `rawDistance` in its signature (line 92) and checks it before rawDuration (line 95): `if (h.rawDistance !== null) return \`${h.rawDistance.toFixed(2)} mi\`` ✓

**Residual display issue** (below, §5 item 1): For time exercises with stale phantom distanceMi in the DB (e.g., "1.5 Mile Run" rows have `distanceMi=1.5` from old mapBaselineToSet), rawText now shows "1.50 mi" instead of "10:00". rawText has no `primary` context to distinguish. Live data confirms both run session rows have `rawDistance: 1.5` and `rawDuration: 600/655`.

---

## 4. Live Smoke Results

**Server:** `npm run dev` started; polling confirmed `HTTP 406` (up) in under 2s.

### Test 1: get_exercise_history — "20 Min Bike Distance"

```json
{
  "summary": {
    "primary": "distance",
    "bestValue": 6.6,
    "bestRaw": { "distanceMi": 6.6, "durationSec": null, ... },
    "sessionCount": 2
  },
  "history": [
    { "date": "2026-06-09", "best": 5.9, "rawDistance": 5.9, "rawDuration": 1200 },
    { "date": "2026-06-19", "best": 6.6, "rawDistance": 6.6, "rawDuration": 1200 }
  ]
}
```

- `primary === "distance"` ✓
- `bestValue === 6.6` ✓
- `rawDistance` populated correctly for both sessions ✓
- Stale `rawDuration: 1200` present in both (expected — old rows unmodified, inert per PRD 4.1)
- `rawText` will display "5.90 mi" / "6.60 mi" (correct — rawDistance checked before rawDuration)

### Test 2: get_game_state — retroactive bike PR

```
PR events:
  dateKey=2026-06-19  label="PR · 20 Min Bike Distance"  attr=END  xp=40
  dateKey=2026-06-18  label="PR · Deadlift"               attr=STR  xp=40
  dateKey=2026-06-18  label="PR · Side Plank"             attr=STR  xp=40
  dateKey=2026-06-17  label="PR · Pull-Up"                attr=STR  xp=40
  dateKey=2026-06-17  label="PR · Hollow Body Hold"       attr=STR  xp=40

PRs per day: {'2026-06-19': 1, '2026-06-18': 2, '2026-06-17': 2}
Days over 3-cap: {} (none)
```

- Retroactive `PR · 20 Min Bike Distance` exists with `attribute="END"` ✓
- Correctly dated 2026-06-19 (today's session) ✓
- No duplicate/insane PR counts ✓
- 3/day cap intact (max 2 PRs any day, well under 3) ✓

### Test 3: get_exercise_history — "1.5 Mile Run"

```json
{
  "summary": {
    "primary": "time",
    "bestValue": 600,
    "sessionCount": 2
  },
  "history": [
    { "date": "2026-05-04", "best": 600, "rawDuration": 600, "rawDistance": 1.5 },
    { "date": "2026-06-09", "best": 655, "rawDuration": 655, "rawDistance": 1.5 }
  ]
}
```

- `primary === "time"` ✓
- `bestValue === 600` (correctly the LOWER/faster time, 10:00 vs 10:55) ✓ — direction-aware min
- `rawDistance: 1.5` in both entries = stale phantom from old mapBaselineToSet (expected, inert for PR logic)
- **Display issue:** rawText will show "1.50 mi" for both sessions on the exercise detail page instead of "10:00" / "10:55" (see §5 item 1)

### Headline Result

**CONFIRMED: The retroactive bike distance PR is now credited.** `get_game_state` shows `PR · 20 Min Bike Distance` at `dateKey=2026-06-19` with `attribute=END`, `xp=40`. The bug is fixed.

---

## 5. Regression + Type Audit

### Regression: Unmapped strength exercises

Verified via unit tests (Group 4+5) and grep:

- No 3-member inline union `"rm" | "reps" | "duration"` remains in engine.ts (grep confirms zero hits)
- No `Math.max` or `.value >` bare comparison in engine.ts or records.ts PR paths (grep confirms)
- `buildPrEvents` unchanged for strength PRs: Deadlift, Side Plank, Pull-Up, Hollow Body Hold all appear correctly in live game state
- `bestSetSummary` with no `canonicalName` falls through unchanged to weighted→reps→duration cascade (unit test Group 4 "no canonicalName" case)

### Type Safety

**`MetricKind` is a single source of truth:**
- Defined at records.ts:62, exported
- Imported by engine.ts:21, recap.ts:32, baselines/exercise/[name]/page.tsx:4
- No duplicate definitions found (`grep -rn "MetricKind\s*=" src` returns only `records.ts`)

**`as MetricKind` cast in recap.ts:382:** `UNIT_FROM_PRIMARY[s.primary as MetricKind]` — `s` is `ExerciseSummary` whose `.primary` is already typed `MetricKind`, so this cast is redundant but harmless. Documented in critique §Type Single-Source-of-Truth.

**No `any`, `@ts-ignore`, or `@ts-expect-error`** in the 8 files under review (grep confirms zero hits).

**No unsafe `as` beyond the documented `s.primary as MetricKind` in recap.ts.**

### UI Display Site Scan

All 5 display sites that render `.primary`/`.kind`/`bestValue` verified:

| Site | Fix status | Evidence |
|------|-----------|---------|
| WorkoutLoggerForm.tsx RecordStrip (line 184) | FIXED | handles rm/reps/distance/time/duration(fallback) |
| RecordsSummary.tsx formatBest (line 218) | FIXED | handles rm/reps/duration/distance/time |
| baselines/page.tsx formatBest (line 217) | FIXED | handles rm/reps/duration/distance/time |
| baselines/exercise/[name]/page.tsx summary header (line 32) | FIXED | distance branch → `.toFixed(2) mi` before `formatDuration` fallback |
| recap.ts highlight label (line 545) | FIXED | `formatPrValue` with mi/sec branches |

No 6th display site found.

---

## 6. Code Quality Issues

### ISSUE-1 (Medium — Display Bug)
**rawText in baselines/exercise/[name]/page.tsx shows "1.50 mi" for time exercises with stale phantom distanceMi**

**Where:** `src/app/baselines/exercise/[name]/page.tsx` line 95  
**What:** `rawText` checks `rawDistance !== null` before `rawDuration`. For "1.5 Mile Run" (and potentially other time exercises), stale DB rows have phantom `distanceMi=1.5` from the old `mapBaselineToSet`. These rows are correctly handled for PR logic (registry forces "time"/durationSec), but the Sessions list on the exercise detail page will display "1.50 mi" instead of "10:00" / "10:55" for all pre-fix run entries.

**Scope:** Display-only, existing rows only. Core PR logic, game state, XP, history chart Y-axis are all correct. New run logs (post-fix) will have `distanceMi=null` and display correctly.

**Fix:** Pass `summary?.primary` as a parameter to `rawText`, and conditionally prefer rawDuration for `primary === "time"`:
```typescript
function rawText(
  h: { rawWeight: number | null; rawReps: number | null; rawDuration: number | null; rawDistance: number | null },
  primary?: MetricKind,
): string {
  if (h.rawWeight !== null && h.rawReps !== null) return `${h.rawWeight} lb × ${h.rawReps}`;
  if (h.rawReps !== null) return `${h.rawReps} reps`;
  if (primary === "time" && h.rawDuration !== null) return formatDuration(h.rawDuration);
  if (h.rawDistance !== null) return `${h.rawDistance.toFixed(2)} mi`;
  if (h.rawDuration !== null) return formatDuration(h.rawDuration);
  return "—";
}
// call site:
rawText(h, summary?.primary)
```

### ISSUE-2 (Low — Redundant cast)
**`s.primary as MetricKind` cast in recap.ts:382 is redundant**

`ExerciseSummary.primary` is already typed `MetricKind`; the cast adds noise. Not harmful — just could be removed.

**Fix:** `UNIT_FROM_PRIMARY[s.primary]` — no cast needed (TypeScript will infer correctly).

### ISSUE-3 (Low — Comment consistency)
**`bestRaw.durationSec: null` in the distance path comment vs actual**

In `bestSetSummary` at records.ts:752, the distance path returns `raw.durationSec: null` even for old rows that have phantom `durationSec: 1200`. This is correct behavior (the raw is scoped to the "best" field for the primary kind), and the comment at line 754 is clear. But callers might expect `raw` to reflect all fields of the set. Documented in PRD §4.1 — no action required.

---

## 7. Verdict and Fix List

### Verdict: **MINOR FIXES**

The feature is functionally correct and complete:
- All 5 PRD acceptance criteria that are observable at runtime PASS
- All 3 architecture must-fixes are implemented and confirmed
- The retroactive bike distance PR is credited correctly (the headline bug is fixed)
- 180/180 tests pass; tsc clean; lint clean; build success
- No data corruption risk; no type safety holes; no regressions to existing PRs

One medium display bug (ISSUE-1) affects the Sessions list on the exercise detail page for time exercises (e.g., "1.5 Mile Run") that have stale phantom `distanceMi` from old rows. It is display-only, does not affect PRs, XP, or game state, and is confined to historical rows logged before this fix. It is shippable as-is; the fix is low-risk and a 4-line change.

### Ordered Fix List

1. **[Medium, 4 lines] ISSUE-1** — Pass `summary?.primary` to `rawText` in `src/app/baselines/exercise/[name]/page.tsx` and add a `primary === "time"` guard so run Sessions list shows "10:00" not "1.50 mi" for old stale-phantom rows.

2. **[Low, 1 char] ISSUE-2** — Remove the redundant `as MetricKind` cast on `s.primary` in `src/lib/recap.ts:382`.

---

## Summary for Orchestrator

**SHIP IT** (with ISSUE-1 fix recommended before tagging):

- **Live smoke CONFIRMS the bug is fixed:** `get_game_state` shows `PR · 20 Min Bike Distance` at `2026-06-19`, `attribute=END`, `xp=40`. The retroactive grant is live.
- All 3 must-fixes from the architecture critique are present and verified.
- One medium display bug remains (ISSUE-1): the Sessions list on `/baselines/exercise/1.5%20Mile%20Run` shows "1.50 mi" for historical entries instead of the run time ("10:00"). Fix is a 4-line change to `rawText`.
- No blockers to shipping. Fix ISSUE-1 in a follow-up commit or bundle with the next baseline-page touch.
