# Research Output — Endurance PR Metric Kinds

**Agent:** Research  
**Date:** 2026-06-19  
**Feature:** `docs/prds/PRD-endurance-pr-metric-kinds.md`  
**Requirements:** `.feature-dev/2026-06-19-endurance-pr-metric-kinds/phases/requirements.md`

---

## 1. Union Consumer Census

Every place that touches the metric-kind union (`"rm" | "reps" | "duration"`) or one of its string members. Ordered by risk.

---

### 1.1 `src/lib/records.ts` — primary owner, all changes required here

| Location | What it does | Edit needed? |
|---|---|---|
| Line 62 `ExerciseSummary.primary` | Type literal `"rm" \| "reps" \| "duration"` | **YES** — widen to include `"distance" \| "time"` |
| Line 86 `RecordSet.kind` | Type literal `"rm" \| "reps" \| "duration"` | **YES** — widen |
| Line 63 `ExerciseSummary.bestRaw` | `{ weightLb, reps, durationSec }` — no `distanceMi` | **YES** — add `distanceMi: number \| null` |
| Line 91 `RecordSet.raw` | `{ weightLb, reps, durationSec }` — no `distanceMi` | **YES** — add `distanceMi: number \| null` |
| Line 634–659 `bestSetSummary` | Return type hardcodes `"rm" \| "reps" \| "duration"`; parameter type is `{ weightLb, reps, durationSec }[]` — **`distanceMi` is not in the parameter type at all** | **YES** — widen return and parameter type; add optional canonical-name param; add distance/time dispatch |
| Lines 641–658 `bestSetSummary` body | Cascade: weighted→reps→duration; ignores `distanceMi`; all higher-better | **YES** — when mapped via registry, dispatch on `distanceMi` (distance) or `durationSec` (time) with correct direction (min for time) |
| Line 662–669 `metricValue` | `"rm" \| "reps" \| "duration"` parameter; no `distance`/`time` branch | **YES** — add `if (primary === "distance") return s.distanceMi ?? null` and `if (primary === "time") return s.durationSec` |
| Line 671–675 `matchesBest` | Uses `metricValue`; parameter typed `"rm" \| "reps" \| "duration"` | **YES** — will work automatically once `metricValue` is extended (value equality check is direction-agnostic) |
| Line 596–607 `recordsSetInWorkout` cross-primary branch | Line 607: `priorValue = Math.max(...recomputed)` — always takes max, wrong for `time` (lower-better) | **YES** — use `Math.min` when direction is lower; needs `isBetter` helper or direction lookup |
| Line 610 `recordsSetInWorkout` improvement check | `if (thisSummary.value <= priorValue) continue` — higher-only | **YES** — for `time` direction: `if (thisSummary.value >= priorValue) continue` |
| Line 510 `getExerciseHistory` history best reducer | `setsWithMetric.reduce((a, b) => (b.m > a.m ? b : a))` — always picks higher | **YES** — for `time`, use `(b.m < a.m ? b : a)` (best time = lowest seconds) |
| Lines 414–464 `getExerciseSummaries` | Calls `bestSetSummary(bucket.sets)` without canonical name — cannot dispatch registry | **YES** — must pass `bucket.name` as canonical-name argument once `bestSetSummary` is name-aware |
| Lines 467–523 `getExerciseHistory` | Calls `bestSetSummary(allSets)` without canonical name | **YES** — must pass `canonical` as argument |

**Critical hidden gap — `bestSetSummary` never receives `distanceMi`:**  
`bestSetSummary(sets: { weightLb, reps, durationSec }[])` parameter type does not include `distanceMi`. All callers that use `include: { sets: true }` (Prisma) have the data at runtime, but TypeScript won't let the function body access `s.distanceMi`. The signature must be widened to `{ weightLb, reps, durationSec, distanceMi?: number | null }[]`.

---

### 1.2 `src/lib/game/engine.ts` — PR replay consumer

| Location | What it does | Edit needed? |
|---|---|---|
| Line 266 `prBestByExercise` Map type | `{ primary: "rm" \| "reps" \| "duration"; value: number }` | **YES** — widen `primary`; add `direction: "higher" \| "lower"` |
| Line 274 `workoutBestByExercise` Map type | Same literal union | **YES** — same as above |
| Line 266–267 (`buildPrEvents` call to `bestSetSummary`) | `const summary = bestSetSummary(exercise.sets)` — does NOT pass canonical name | **YES** — pass `canonicalExerciseName(exercise.name)` as argument once the function is name-aware |
| Line 296 comparison | `workoutBest.value > prior.value` — always higher-better | **YES** — replace with `isBetter(direction, workoutBest.value, prior.value)` |
| **Line 950 Prisma select** | `select: { weightLb: true, reps: true, durationSec: true }` — **`distanceMi` is NOT selected** | **YES — CRITICAL.** Add `distanceMi: true` here; otherwise the engine has no distance data to work with |
| Lines 51–64 `WorkoutWithSets` type | `sets: Array<{ weightLb, reps, durationSec }>` — no `distanceMi` | **YES** — add `distanceMi: number \| null` to the inline type |
| Lines 276–281 within-workout best merge | `if (!existing \|\| summary.value > existing.value)` — takes higher always | **YES** — for `time` direction, take lower (or track direction alongside value) |

**Non-issue in engine.ts:** `prAttributeForExercise` (from `rules.ts`) already routes run/bike/row → `END`. No change needed there.

---

### 1.3 `src/lib/recap.ts` — **compile-time break**

| Location | What it does | Edit needed? |
|---|---|---|
| Line 133 `UNIT_FROM_PRIMARY` | `Record<ExerciseSummary["primary"], string>` with only `{ rm, reps, duration }` keys. **This is a `Record` over a literal union — TypeScript enforces exhaustiveness.** Adding `"distance"` and `"time"` to the union will cause a compile error (`Type … is not assignable to type … "distance" and "time" are missing`). | **YES — REQUIRED.** Add `distance: "mi"` and `time: "sec"` to `UNIT_FROM_PRIMARY` |
| Line 156–157 `prUnitTier` | `units === "lb" ? 0 : units === "reps" ? 1 : 2` — distance/time both fall to tier 2 | Safe as-is (fallthrough to 2 is fine for ordering) |
| Line 363–364 `UNIT_FROM_PRIMARY[s.primary]` | Derives display units from `ExerciseSummary.primary` | Fixed automatically once `UNIT_FROM_PRIMARY` has the new keys |

---

### 1.4 `src/app/baselines/exercise/[name]/page.tsx` — **exhaustive switch, silent fallthrough**

| Location | What it does | Edit needed? |
|---|---|---|
| Line 97–108 `chartTitleFor(p?: "rm" \| "reps" \| "duration")` | `switch(p)` with cases for rm/reps/duration; `default: return "History"` | **RECOMMENDED** — TypeScript won't error (union only in param type, caller passes `summary?.primary` whose type widens); "distance" and "time" silently display as "History". Add cases for human-readable titles. |
| Line 110–121 `unitsFor(p?: "rm" \| "reps" \| "duration")` | Same switch with `default: return ""` | **RECOMMENDED** — "distance" shows blank unit on Y axis; "time" shows blank. Add `case "distance": return "mi"` and `case "time": return "sec"` |
| Line 123–130 `tooltipFor(p: "rm" \| "reps" \| "duration" \| undefined, ...)` | if-else chain; falls to `String(h.best)` | **RECOMMENDED** — distance shows raw miles float; time shows raw seconds. Add branches for human formatting. |
| Line 32–35 `summary.primary === "rm" ? ... : summary.primary === "reps" ? ... : formatDuration(summary.bestValue)` | Falls to `formatDuration` for any non-rm/reps kind | **YES** — for `"distance"`, calling `formatDuration` on miles is semantically wrong (it would display e.g. "0:06" for 6.6 mi). Add an explicit `distance` branch. For `"time"`, `formatDuration` is actually correct (seconds to MM:SS). |

---

### 1.5 `src/app/baselines/page.tsx`

| Location | What it does | Edit needed? |
|---|---|---|
| Lines 216–220 `formatBest(e: { primary: string; bestValue: number; bestRaw: { weightLb, reps, durationSec } })` | if-chain: `rm` → 1RM label, `reps` → reps, `duration` → formatDuration, else → `String(e.bestValue)` | **LOW PRIORITY.** `primary` is typed as `string` (not the literal union), so TypeScript won't error. "distance" falls to `String(6.6)` (ugly). "time" falls to `String(480)` (raw seconds). Polish needed for UX but not a crash. |

---

### 1.6 `src/components/RecordsSummary.tsx`

| Location | What it does | Edit needed? |
|---|---|---|
| Lines 213–222 `formatBest` | Same `primary: string` parameter; same if-chain; same fallthrough | **LOW PRIORITY.** Same as baselines/page.tsx above. |

---

### 1.7 `src/components/days/WorkoutLoggerForm.tsx`

| Location | What it does | Edit needed? |
|---|---|---|
| Lines 170–178 `RecordStrip` | `r.kind === "rm" ? ... : r.kind === "reps" ? ... : \`${r.value}s\`` | **RECOMMENDED.** For `"distance"` PRs, shows e.g. "6.6s" (miles rendered as seconds). For `"time"`, shows e.g. "480s" (actually fine, but confusing label). Add `r.kind === "distance" ? \`${r.value.toFixed(2)} mi\`` and `r.kind === "time" ? formatDuration(r.value)` branches. |

---

### 1.8 Summary of "will cause TypeScript compile error if missed"

Only one hard compile-time break: **`src/lib/recap.ts` line 133 `UNIT_FROM_PRIMARY`**. It is typed as `Record<ExerciseSummary["primary"], string>` — exhaustively keyed on the union. All other consumers use `if/else` chains or `string`-typed parameters that don't fail at compile time; they just produce wrong output silently.

---

## 2. Registry Seed Validation

All baseline tests from `src/lib/program-template.ts` and their classification against the PRD's proposed `METRIC_KIND_OVERRIDES` seed.

### 2.1 PRD-proposed entries (confirmed or corrected)

| Canonical name | Template `units` | Proposed kind | Proposed direction | Verdict | Notes |
|---|---|---|---|---|---|
| `20 Min Bike Distance` | `mi` | `distance` | `higher` | **CONFIRMED** | `mapBaselineToSet` writes `distanceMi`; also triggers the phantom-duration bug via `minMatch` regex (sees "20 Min" → `durationSec=1200`). Registry suppresses this. |
| `1.5 Mile Run` | `sec` | `time` | `lower` | **CONFIRMED** | Logged in seconds to complete; faster = better; `mapBaselineToSet` writes `durationSec` via `u === "sec"` branch. No phantom regression here. |
| `60 Min Steady Effort Distance` | `mi` | `distance` | `higher` | **CONFIRMED** | `mapBaselineToSet` writes `distanceMi`; also triggers `minMatch` via "60 Min" fragment → phantom `durationSec=3600`. Registry suppresses. |
| `40-Yard Sprint` | `sec` | `time` | `lower` | **CONFIRMED** | Logged in seconds; faster = better. `mapBaselineToSet` writes `durationSec`. No phantom. Check: does `meterMatch` hit "40"? No — `meterMatch` regex is `(\d+)m(?:eter|eters)?\b` — "40-Yard" has no "m" match. Safe. |
| `5-10-5 Shuttle` | `sec` | `time` | `lower` | **CONFIRMED** | Logged in seconds; faster = better. No phantom from name. |

### 2.2 All other baseline tests — classification decision

| Test name | Template `units` | Proposed kind | Notes |
|---|---|---|---|
| `Pull-Up Max Reps` | `reps` | **LEAVE UNMAPPED** (reps, higher-better) | Standard reps; current behavior correct |
| `Push-Up Max Reps` | `reps` | **LEAVE UNMAPPED** | Same |
| `DB Shoulder Press 8-rep Max` | `lb` | **LEAVE UNMAPPED** | Weighted; resolved as `rm` by `bestSetSummary` |
| `Plank Max Hold` | `sec` | **LEAVE UNMAPPED** | Duration, higher-better (longer = better); canonical resolves to `Plank` via `EXERCISE_ALIAS_GROUPS`. Current `duration` kind is correct. |
| `Dead Hang` | `sec` | **LEAVE UNMAPPED** | Duration, higher-better; current `duration` kind correct |
| `DB Bulgarian Split Squat 10-rep Max` | `lb` | **LEAVE UNMAPPED** | Weighted |
| `DB Romanian Deadlift 10-rep Max` | `lb` | **LEAVE UNMAPPED** | Weighted |
| `Walking Lunge Unbroken` | `steps` | **LEAVE UNMAPPED** | `steps` not handled by `mapBaselineToSet`; set remains empty; no PR eligible anyway |
| `Farmer Carry Max Time` | `sec` | **LEAVE UNMAPPED** | Duration, higher-better (longer = better); current `duration` kind correct |
| `Vertical Jump` | `in` | **LEAVE UNMAPPED** | Distance-ish but logged as `in`; `mapBaselineToSet` doesn't handle `in`; no Set field for it; baseline row stores value only. No PR via Set path anyway. |
| `Broad Jump` | `in` | **LEAVE UNMAPPED** | Same as Vertical Jump |
| `Pull-Up Total Across 5 Sets` | `reps` | **LEAVE UNMAPPED** | Sum of 5 sets; intentionally NOT aliased to `Pull-Up` (see alias-map comment in records.ts). Higher-better. |
| `Dip Max Reps` | `reps` | **LEAVE UNMAPPED** | canonical → `Dip` via EXERCISE_ALIAS_GROUPS. Higher-better |
| `2-Min Bodyweight Squat` | `reps` | **LEAVE UNMAPPED** | Timed AMRAP, logged as reps; higher-better |
| `Wall Sit Max Hold` | `sec` | **LEAVE UNMAPPED** | Duration, higher-better |
| `20 Min Step-Up Reps` | `reps` | **LEAVE UNMAPPED** | Reps in 20 min; higher-better. Note: `minMatch` in `mapBaselineToSet` fires on "20 Min" name fragment → phantom `durationSec=1200`. **However**, the `units="reps"` branch writes `set.reps` first, so `set.durationSec` starts undefined; then `minMatch` fires and sets `durationSec=1200` anyway. So this set has BOTH `reps` AND `durationSec`. `bestSetSummary` cascade picks `reps` (weighted sets checked first, then reps-only, then duration) — but `reps` path requires `weightLb==null && reps!=null`, so `reps=N, weightLb=null, durationSec=1200` → correctly picked as `reps`. **The phantom duration does not corrupt the PR kind here.** Leave unmapped. |
| `Deep Squat Hold` | `sec` | **LEAVE UNMAPPED** | Duration, higher-better |
| `Toe Touch Reach` | `in` | **LEAVE UNMAPPED** | `in` units; `mapBaselineToSet` doesn't handle `in`; `signed=true` |
| `Shoulder Flexion Overhead` | `deg` | **LEAVE UNMAPPED** | `deg` not handled; no Set field |

### 2.3 Canonical-name resolution via `canonicalExerciseName`

The PRD seeds are keyed by **canonical name** (post `canonicalExerciseName`). For the five proposed entries:

- `"20 Min Bike Distance"` → not in `EXERCISE_ALIAS_GROUPS` → passes through as-is: **`"20 Min Bike Distance"`**
- `"1.5 Mile Run"` → not in alias map → passes through: **`"1.5 Mile Run"`**
- `"60 Min Steady Effort Distance"` → not in alias map → passes through: **`"60 Min Steady Effort Distance"`**
- `"40-Yard Sprint"` → not in alias map → passes through: **`"40-Yard Sprint"`**
- `"5-10-5 Shuttle"` → not in alias map → passes through: **`"5-10-5 Shuttle"`**

All five test names are their own canonical form; they are not aliased to shorter names. The registry keys match exactly what `appendBaselineToDayWorkout` uses as the `exercise.name` in the mirrored workout. The `metricKindFor(canonicalName)` resolver just calls `canonicalExerciseName` first, then looks up the result.

### 2.4 Phantom-duration recap: which tests produce phantom `durationSec` from `mapBaselineToSet`

The `minMatch` regex at line 53–55 of `baseline-workout.ts`:
```
const minMatch = testName.match(/(\d+(?:\.\d+)?)\s*(?:min|minute|minutes)\b/i);
if (minMatch && set.durationSec === undefined) {
  set.durationSec = Math.round(parseFloat(minMatch[1]!) * 60);
}
```

Tests whose **name** contains "N Min" and whose direct units do NOT already set `durationSec`:

| Test | Name fragment | Phantom `durationSec` written | Problem? |
|---|---|---|---|
| `20 Min Bike Distance` | "20 Min" | 1200 sec | **YES** — overwrites the `distanceMi` the primary metric. REQ-004 must suppress for registry-mapped tests |
| `60 Min Steady Effort Distance` | "60 Min" | 3600 sec | **YES** — same issue |
| `20 Min Step-Up Reps` | "20 Min" | 1200 sec | No problem (reps wins in cascade; see above) |

---

## 3. `mapBaselineToSet` Trace — Phantom Source

Full function body (`src/lib/baseline-workout.ts` lines 23–63):

```typescript
export function mapBaselineToSet(testName: string, value: number, units: string): SetData {
  const set: SetData = {};
  const u = units.trim().toLowerCase();

  // Direct: the value+units pair.
  if (u === "sec" || u === "s" || u === "second" || u === "seconds") {
    set.durationSec = Math.round(value);
  } else if (u === "min" || u === "minute" || u === "minutes") {
    set.durationSec = Math.round(value * 60);
  } else if (u === "m" || u === "meter" || u === "meters") {
    set.distanceMi = value / METERS_PER_MILE;
  } else if (u === "km" || u === "kilometer" || u === "kilometers") {
    set.distanceMi = (value * 1000) / METERS_PER_MILE;
  } else if (u === "mi" || u === "mile" || u === "miles") {
    set.distanceMi = value;                        // ← for "20 Min Bike Distance", this runs first
  } else if (u === "rep" || u === "reps") {
    set.reps = Math.round(value);
  } else if (u === "lb" || u === "lbs" || u === "pound" || u === "pounds") {
    set.weightLb = value;
  } else if (u === "kg") {
    set.weightLb = value * KG_TO_LB;
  }
  // Unknown units fall through silently.

  // Implicit: parse the test name for the *other* dimension.
  const distMatch = testName.match(/(\d+(?:\.\d+)?)\s*(?:mi|mile|miles)\b/i);
  if (distMatch && set.distanceMi === undefined) {           // ← for "1.5 Mile Run", this would fire
    set.distanceMi = parseFloat(distMatch[1]!);
  }
  const minMatch = testName.match(/(\d+(?:\.\d+)?)\s*(?:min|minute|minutes)\b/i);
  if (minMatch && set.durationSec === undefined) {           // ← PHANTOM SOURCE: "20 Min" fires here
    set.durationSec = Math.round(parseFloat(minMatch[1]!) * 60);
  }
  const meterMatch = testName.match(/(\d+(?:\.\d+)?)\s*m(?:eter|eters)?\b/i);
  if (meterMatch && set.distanceMi === undefined) {
    set.distanceMi = parseFloat(meterMatch[1]!) / METERS_PER_MILE;
  }

  return set;
}
```

**Lines that REQ-004 must suppress when the canonical name is registry-mapped:**

- **Line 49–51 (`distMatch` block):** fires for "1.5 Mile Run" when `units=sec` — would write `distanceMi=1.5`. For a `time`-mapped test, this phantom distance is wrong. **Must guard:** `if (distMatch && set.distanceMi === undefined && !isDistanceOrTimeMapped) { ... }`
- **Lines 53–55 (`minMatch` block):** fires for "20 Min Bike Distance" and "60 Min Steady Effort Distance" when `units=mi`. Writes phantom `durationSec`. **Must guard:** `if (minMatch && set.durationSec === undefined && !isDistanceOrTimeMapped) { ... }`
- **Lines 57–59 (`meterMatch` block):** fires for test names with "Nm" (e.g., hypothetical "400m Sprint"). Unlikely to affect current tests but guard for future safety.

The fix pattern:
```typescript
const mapped = metricKindFor(canonicalExerciseName(testName));
const isMapped = mapped !== null;

// suppress all name-regex back-fills for mapped tests
const distMatch = testName.match(/(\d+(?:\.\d+)?)\s*(?:mi|mile|miles)\b/i);
if (distMatch && set.distanceMi === undefined && !isMapped) { ... }
const minMatch = testName.match(/(\d+(?:\.\d+)?)\s*(?:min|minute|minutes)\b/i);
if (minMatch && set.durationSec === undefined && !isMapped) { ... }
const meterMatch = testName.match(/(\d+(?:\.\d+)?)\s*m(?:eter|eters)?\b/i);
if (meterMatch && set.distanceMi === undefined && !isMapped) { ... }
```

This imports `metricKindFor` + `canonicalExerciseName` from `records.ts` into `baseline-workout.ts` (no circular dependency — `baseline-workout.ts` already imports `prisma` from `db.ts`; `records.ts` only imports `prisma` and `calendar`).

---

## 4. Existing Tests

**No existing test file covers `records.ts`, `engine.ts` PR replay, or `baseline-workout.ts`.** Confirmed via file scan and `quality-tools.md`:

> "Tests do **not** exist. If you add Vitest/Playwright later, add a `Test` row above and update the QA-Agent prompt."

The **vitest config** (`vitest.config.ts`) is already present and configured:
- Environment: `node`
- Include: `src/**/*.test.ts`
- Path alias: `@/` → `src/`

**Existing test files (for the mock pattern):**

| File | What it tests | Mock pattern |
|---|---|---|
| `src/lib/recap.test.ts` | `computeWeeklyRecap`, `resolveStatSlot` | `vi.mock("@/lib/records", () => ({ getExerciseSummaries: vi.fn(), getExerciseHistory: vi.fn() }))` + `vi.mock("@/lib/db", () => ({ prisma: { ... } }))` |
| `src/lib/goal-core.test.ts` | `createGoalCore`, `updateGoalCore` | `vi.mock("@/lib/records", () => ({ canonicalExerciseName: (s: string) => s }))` |
| `src/lib/footage-core.test.ts` | footage CRUD | Same stub pattern for `@/lib/records` |
| `src/lib/rarity-core.test.ts` | rarity computation | Mocks DB |
| `src/lib/readiness.test.ts` | readiness computation | Mocks DB + records |
| `src/components/FeasibilityReadout.test.ts` | React component | — |

**Mocking pattern for new tests (`src/lib/records.test.ts`):**
```typescript
import { describe, it, expect } from "vitest";
import { bestSetSummary, recordsSetInWorkout, metricKindFor, ... } from "@/lib/records";
// bestSetSummary and metricKindFor are pure functions — no DB mock needed.
// recordsSetInWorkout requires vi.mock("@/lib/db", () => ({ prisma: { workoutExercise: { findMany: vi.fn() } } }))
```

Pure functions (`bestSetSummary`, `metricValue`, `matchesBest`, `canonicalExerciseName`, `isBetter`, `metricKindFor`) can be tested without any mocking — just call them directly with synthetic data. The DB-touching functions (`recordsSetInWorkout`, `getExerciseSummaries`, `getExerciseHistory`) follow the existing `vi.mock("@/lib/db", ...)` pattern.

---

## 5. Risks

### RISK-1: `UNIT_FROM_PRIMARY` compile error will block build immediately
**`src/lib/recap.ts` line 133.** `Record<ExerciseSummary["primary"], string>` is exhaustively typed. As soon as `ExerciseSummary.primary` gains `"distance"` and `"time"`, TypeScript enforces all five keys must be present. This is the **only hard compile-time break** — the build fails unless the dev adds `distance: "mi"` and `time: "sec"` in the same commit.

### RISK-2: Engine query doesn't fetch `distanceMi` — feature silently no-ops
`src/lib/game/engine.ts` line 950: `select: { weightLb: true, reps: true, durationSec: true }`. The `distanceMi` field is never fetched for the PR replay's workout sets. Even after extending `bestSetSummary`, `buildPrEvents` will always get `distanceMi: undefined` at runtime, and the distance kind will never fire. The dev must add `distanceMi: true` to the Prisma select AND add `distanceMi: number | null` to the `WorkoutWithSets.exercises.sets` type at lines 60–63.

### RISK-3: Cross-kind prior comparison always uses `Math.max` — false behavior for `time`
`recordsSetInWorkout` line 607: `priorValue = Math.max(...recomputed)`. If the prior bucket had `duration` sets and we're now comparing against `time` (lower-better), using `Math.max` picks the *worst* prior time, then line 610 (`value <= priorValue`) lets every improvement through because the threshold is too low. For pure same-kind paths this is fine, but for the mixed-kinds cross-compare the PRD says: "if kinds are incompatible, skip rather than compare across units." The edge-case guard (PRD §3.2 REQ-10) must be implemented: check if `priorSummary.primary` and `thisSummary.primary` are in the same "direction group" — if they can't be meaningfully compared (e.g., prior `duration` vs now `distance`), `continue` rather than compute a cross-unit value.

### RISK-4: History `best` reducer always picks highest — time PRs display wrong "best" in history
`getExerciseHistory` line 510: `setsWithMetric.reduce((a, b) => (b.m > a.m ? b : a))`. For `time` kind, `metricValue` returns raw `durationSec`. The reducer picks the **highest** seconds — the slowest run — as the session's "best", inverting the semantics. The exercise-history chart for a run would show the worst performance of each session, not the fastest. Must use `(b.m < a.m ? b : a)` when `direction === "lower"`.

### RISK-5: Stale phantom-`durationSec` rows already in DB
Existing `source="baseline"` workout Sets for "20 Min Bike Distance" may already have `durationSec=1200` and `distanceMi=5.9` (or similar). The PRD decision is to **leave old rows unchanged** (PRD 4.1). The registry forces `distance` primary, so `bestSetSummary` for this exercise will use `distanceMi` and ignore `durationSec` — the phantom value is inert from the engine's perspective. This is safe, but the developer should explicitly document it and confirm the `bestSetSummary` dispatch does NOT fall through to the `duration` cascade if `distanceMi` is present.

### RISK-6: `bestSetSummary` receives sets from pre-selected narrow query in engine
Because `engine.ts` uses `select: { weightLb: true, reps: true, durationSec: true }` (and must add `distanceMi: true`), the `WorkoutWithSets` type and the sets passed to `bestSetSummary` in `buildPrEvents` will ONLY have those four fields — never the full Prisma `Set` model. The widened `bestSetSummary` signature `{ weightLb, reps, durationSec, distanceMi?: number | null }[]` must work for both the engine's narrow shape (after adding `distanceMi`) and the `include: { sets: true }` full-model shape from `recordsSetInWorkout` / `getExerciseSummaries`. Using `distanceMi?: number | null` (optional) satisfies both.

### RISK-7: UI display issues (non-blocking, UX only)
Three rendering locations fall through to raw number display for "distance" and "time":
- `RecordsSummary.tsx:220` — shows `"6.6"` for 6.6 mi distance PR
- `baselines/page.tsx:220` — same
- `WorkoutLoggerForm.tsx:178` — shows `"6.6s"` (miles with "s" suffix) for a distance PR

These are cosmetic bugs, not correctness bugs. The feature works (XP awarded, PR recorded) but looks wrong in the UI. The dev should add branches while building (not post-hoc).

### RISK-8: `mapBaselineToSet` back-fills `distanceMi=1.5` on "1.5 Mile Run" when `units=sec`
The `distMatch` regex (line 49: `(\d+(?:\.\d+)?)\s*(?:mi|mile|miles)\b`) fires on "1.5 Mile Run" when `units=sec` (the primary units write `durationSec`, leaving `distanceMi` undefined). So an existing "1.5 Mile Run" set has both `durationSec` (the run time) AND `distanceMi=1.5` (phantom distance from the name regex). With the registry mapping "1.5 Mile Run" → `time/lower`, `bestSetSummary` will read `durationSec` for this test. The phantom `distanceMi=1.5` is constant across all retests, so it can't produce a false `distance` PR, and since the registry maps it to `time`, `distanceMi` is ignored. REQ-004 should suppress the `distMatch` backfill for all mapped tests regardless, to keep Sets clean going forward.

---

## 6. Summary Table: Files That Need Edits

| File | Edits | Risk if missed |
|---|---|---|
| `src/lib/records.ts` | Widen `MetricKind` union; widen `ExerciseSummary.primary`, `RecordSet.kind`; add `distanceMi` to `bestRaw`/`raw`; add `METRIC_KIND_OVERRIDES`, `metricKindFor`; extend `bestSetSummary` signature + body; fix `metricValue`, `matchesBest`; fix `recordsSetInWorkout` step 6 (Math.max + comparison direction); fix `getExerciseHistory` best reducer; pass canonical name in `getExerciseSummaries`/`getExerciseHistory` | Feature doesn't work; stale `duration` wins; cross-kind compare wrong |
| `src/lib/game/engine.ts` | Add `distanceMi: true` to Prisma select (line 950); add `distanceMi` to `WorkoutWithSets` type; widen map types; pass canonical name to `bestSetSummary`; replace `> prior.value` with `isBetter(direction, ...)`; fix within-workout best merge | **Entire PR replay produces no distance/time PRs regardless of other fixes** |
| `src/lib/baseline-workout.ts` | Import `metricKindFor`/`canonicalExerciseName` from `records.ts`; guard all three name-regex back-fills for mapped tests | Phantom `durationSec` persists for new bike-distance logs; distance metric stays masked |
| `src/lib/recap.ts` | Add `distance: "mi"` and `time: "sec"` to `UNIT_FROM_PRIMARY` | **TypeScript compile error — build fails** |
| `src/app/baselines/exercise/[name]/page.tsx` | Add `"distance"` and `"time"` cases to `chartTitleFor`, `unitsFor`, `tooltipFor`; fix fallthrough in summary `primary` ternary (don't call `formatDuration` on miles) | Distance exercise history shows "History" title, blank Y-axis units, raw float; semantically wrong formatDuration call for distance |
| `src/app/baselines/page.tsx` | Add `distance`/`time` branches to `formatBest` | Shows raw number instead of formatted value |
| `src/components/RecordsSummary.tsx` | Same formatBest branch additions | Same |
| `src/components/days/WorkoutLoggerForm.tsx` | Add `distance`/`time` branches to `RecordStrip` renderer | Shows "6.6s" for a distance PR |
| `src/lib/records.test.ts` (new) | Unit tests per REQ-006 | No regression gate |

---

## 7. Quick-Reference: Exact Lines Modified in Core Files

### `src/lib/records.ts`
- **L62**: `primary: "rm" | "reps" | "duration"` → add `| "distance" | "time"`
- **L63**: `bestRaw: { weightLb, reps, durationSec }` → add `; distanceMi: number | null`
- **L86**: `RecordSet.kind: "rm" | "reps" | "duration"` → widen
- **L91**: `RecordSet.raw: { weightLb, reps, durationSec }` → add `distanceMi: number | null`
- After L147 (alias map): add `METRIC_KIND_OVERRIDES` + `metricKindFor` export
- **L438**: `bestSetSummary(bucket.sets)` → `bestSetSummary(bucket.sets, bucket.name)`
- **L479**: `bestSetSummary(allSets)` → `bestSetSummary(allSets, canonical)`
- **L507-510**: history best reducer: use `direction`-aware compare
- **L600-610**: cross-primary prior compare + improvement check: direction-aware
- **L634**: `bestSetSummary` signature: add `distanceMi?` to sets param; add optional `canonicalName` param; widen return type
- **L639-659**: `bestSetSummary` body: add registry dispatch before the existing cascade
- **L662**: `metricValue` signature: widen `primary` param; add `distanceMi?` to set param
- **L664-669**: `metricValue` body: add `"distance"` → `s.distanceMi ?? null`

### `src/lib/game/engine.ts`
- **L60-63**: `WorkoutWithSets.exercises.sets` type: add `distanceMi: number | null`
- **L266, L274**: Map types: add `direction: "higher" | "lower"` alongside `primary`
- **L279**: `bestSetSummary(exercise.sets)` → `bestSetSummary(exercise.sets, canon)` (canon is computed two lines up at L277 which already calls `canonicalExerciseName`)
- **L280**: Store `direction` in `workoutBestByExercise` map
- **L281**: Within-workout merge: use direction-aware compare
- **L296**: `workoutBest.value > prior.value` → `isBetter(workoutBest.direction, workoutBest.value, prior.value)`
- **L950**: `select: { weightLb: true, reps: true, durationSec: true }` → add `distanceMi: true`

### `src/lib/baseline-workout.ts`
- Top: add import `import { metricKindFor, canonicalExerciseName } from "@/lib/records"`
- **L49**: guard `distMatch` back-fill: `if (distMatch && set.distanceMi === undefined && !metricKindFor(canonicalExerciseName(testName))) { ... }`
- **L53**: guard `minMatch` back-fill: same guard
- **L57**: guard `meterMatch` back-fill: same guard

### `src/lib/recap.ts`
- **L133-137**: add `distance: "mi"` and `time: "sec"` entries to `UNIT_FROM_PRIMARY`
