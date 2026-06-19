# Architecture Blueprint — Endurance PR Metric Kinds

**Date:** 2026-06-19  
**Author:** Architect Agent  
**Feature branch:** feature/endurance-pr-metric-kinds  
**Single developer stream** — all files are tightly coupled; no parallelisation.

---

## 1. File Plan

| File | Change | REQ |
|------|--------|-----|
| `src/lib/records.ts` | Widen `MetricKind` union; widen `ExerciseSummary` + `RecordSet` types; add `METRIC_KIND_OVERRIDES` + `metricKindFor` + `isBetter` exports; redesign `bestSetSummary`; extend `metricValue` + `matchesBest`; fix `recordsSetInWorkout` (step 6 + step 7); fix `getExerciseHistory` best reducer; pass canonical name in `getExerciseSummaries` + `getExerciseHistory` | REQ-001, REQ-002, REQ-005 |
| `src/lib/game/engine.ts` | Add `distanceMi: number \| null` to `WorkoutWithSets.exercises.sets` type; widen map types in `buildPrEvents`; pass canonical name to `bestSetSummary`; use `isBetter` in comparisons; add `distanceMi: true` to Prisma select at line ~950 | REQ-003 |
| `src/lib/baseline-workout.ts` | Import `metricKindFor` + `canonicalExerciseName` from `records.ts`; guard all three name-regex back-fills in `mapBaselineToSet` | REQ-004 |
| `src/lib/recap.ts` | Add `distance: "mi"` and `time: "sec"` to `UNIT_FROM_PRIMARY` | compile blocker |
| `src/app/baselines/exercise/[name]/page.tsx` | Add `"distance"` and `"time"` cases to `chartTitleFor`, `unitsFor`, `tooltipFor`; fix `primary` ternary in summary header (distance must NOT call `formatDuration`) | display |
| `src/app/baselines/page.tsx` | Add `distance` + `time` branches to local `formatBest` | display |
| `src/components/RecordsSummary.tsx` | Add `distance` + `time` branches to local `formatBest` | display |
| `src/components/days/WorkoutLoggerForm.tsx` | Add `distance` + `time` branches to `RecordStrip` renderer | display |
| `src/lib/records.test.ts` _(new)_ | All unit tests per REQ-006 | REQ-006 |

**No Prisma migration.** `Set.distanceMi Float?` already exists (schema lines 53–54).

---

## 2. Type Definitions (copy-pasteable)

Place these at the top of `src/lib/records.ts`, replacing/extending the existing type literals:

```typescript
// ── Metric kind + direction ──────────────────────────────────────────────────
// Single source of truth for the PR engine and all read surfaces.
// "rm"       — Epley 1RM (lb); higher is better
// "reps"     — max reps; higher is better
// "duration" — max hold/work time (sec); higher is better
// "distance" — max covered distance (mi); higher is better
// "time"     — time-to-complete (sec); LOWER is better
export type MetricKind = "rm" | "reps" | "duration" | "distance" | "time";
export type MetricDirection = "higher" | "lower";

// Widen ExerciseSummary (line ~62):
export type ExerciseSummary = {
  name: string;
  equipment: string | null;
  sessionCount: number;
  totalSets: number;
  primary: MetricKind;
  bestValue: number;
  bestRaw: {
    weightLb: number | null;
    reps: number | null;
    durationSec: number | null;
    distanceMi: number | null;   // ADD
  };
  bestDate: Date;
};

// Widen RecordSet (line ~86):
export type RecordSet = {
  name: string;
  equipment: string | null;
  kind: MetricKind;             // WAS: "rm" | "reps" | "duration"
  value: number;
  prior: number;
  raw: {
    weightLb: number | null;
    reps: number | null;
    durationSec: number | null;
    distanceMi: number | null;   // ADD
  };
};
```

**Decision: `direction` field ON the summary return, not a standalone helper.** Rationale: both comparison sites (`recordsSetInWorkout` and `buildPrEvents`) need direction *alongside* the value to make correct comparisons. Carrying it on the summary object is cleaner than a separate `directionFor(kind)` call at every comparison site—it collapses two lookups into one and makes the data flow explicit. The `isBetter` helper consumes it directly.

---

## 3. Registry — `METRIC_KIND_OVERRIDES` + `metricKindFor`

Place immediately after `EXERCISE_ALIAS_INDEX` (after line ~139 in the current file):

```typescript
// ── Endurance metric-kind registry ──────────────────────────────────────────
// Keyed by CANONICAL exercise name (post-canonicalExerciseName).
// Only entries whose kind and direction differ from the default cascade
// (weighted → reps → duration, all higher-better) appear here.
// Unmapped exercises use the default cascade; zero behavior change.
//
// Seed validation against program-template.ts (2026-06-19):
//   "20 Min Bike Distance"        units=mi  → distance/higher ✓ (phantom durationSec via minMatch: must suppress)
//   "1.5 Mile Run"                units=sec → time/lower      ✓ (phantom distanceMi=1.5 via distMatch: must suppress)
//   "60 Min Steady Effort Distance" units=mi → distance/higher ✓ (phantom durationSec=3600 via minMatch: must suppress)
//   "40-Yard Sprint"              units=sec → time/lower      ✓ (no phantom)
//   "5-10-5 Shuttle"              units=sec → time/lower      ✓ (no phantom)
// All five names pass through canonicalExerciseName unchanged (not in EXERCISE_ALIAS_GROUPS).
export const METRIC_KIND_OVERRIDES: Record<string, { kind: MetricKind; direction: MetricDirection }> = {
  "20 Min Bike Distance":        { kind: "distance", direction: "higher" },
  "1.5 Mile Run":                { kind: "time",     direction: "lower"  },
  "60 Min Steady Effort Distance": { kind: "distance", direction: "higher" },
  "40-Yard Sprint":              { kind: "time",     direction: "lower"  },
  "5-10-5 Shuttle":              { kind: "time",     direction: "lower"  },
};

/**
 * Look up the metric kind + direction for a canonical exercise name.
 * Resolves through canonicalExerciseName first so callers may pass either
 * a raw logged name or a pre-canonicalized name.
 * Returns null for unmapped exercises (use the default cascade).
 */
export function metricKindFor(name: string): { kind: MetricKind; direction: MetricDirection } | null {
  const canonical = canonicalExerciseName(name);
  return METRIC_KIND_OVERRIDES[canonical] ?? null;
}
```

---

## 4. `isBetter` Helper

Place immediately after `metricKindFor` and export it so `engine.ts` can import it:

```typescript
/**
 * Strict improvement check, direction-aware.
 * For "higher" kinds (rm, reps, duration, distance): candidate > incumbent.
 * For "lower" kinds (time): candidate < incumbent.
 * Ties are never PRs.
 */
export function isBetter(direction: MetricDirection, candidate: number, incumbent: number): boolean {
  return direction === "lower" ? candidate < incumbent : candidate > incumbent;
}
```

---

## 5. `bestSetSummary` Redesign

### 5.1 Widened parameter set type

The function must accept sets that may include `distanceMi`. Define a local input type:

```typescript
type BestSetInput = {
  weightLb: number | null;
  reps: number | null;
  durationSec: number | null;
  distanceMi?: number | null;   // optional — callers from engine use narrowed select
};
```

### 5.2 Return type

```typescript
type BestSetSummary = {
  primary: MetricKind;
  direction: MetricDirection;   // ADD — carried forward to all comparison sites
  value: number;
  raw: {
    weightLb: number | null;
    reps: number | null;
    durationSec: number | null;
    distanceMi: number | null;
  };
};
```

### 5.3 Function spec (pseudocode / intended TS shape)

```typescript
export function bestSetSummary(
  sets: BestSetInput[],
  canonicalName?: string,   // optional; when provided, checked against registry first
): BestSetSummary | null {
  if (sets.length === 0) return null;

  // ── Registry-mapped path ──────────────────────────────────────────────────
  if (canonicalName) {
    const override = metricKindFor(canonicalName);
    if (override) {
      if (override.kind === "distance") {
        // Field: distanceMi. Direction: higher. Pick max.
        const candidates = sets.filter(s => (s.distanceMi ?? null) !== null);
        if (candidates.length > 0) {
          const best = candidates.reduce((a, b) =>
            (b.distanceMi! > a.distanceMi! ? b : a));
          return {
            primary: "distance",
            direction: "higher",
            value: best.distanceMi!,
            raw: {
              weightLb: null,
              reps: null,
              durationSec: null,
              distanceMi: best.distanceMi!,
            },
          };
        }
        // distanceMi is null/absent on all sets — fall through to null return
        return null;
      }

      if (override.kind === "time") {
        // Field: durationSec. Direction: lower. Pick min.
        const candidates = sets.filter(s => (s.durationSec ?? null) !== null);
        if (candidates.length > 0) {
          const best = candidates.reduce((a, b) =>
            (b.durationSec! < a.durationSec! ? b : a));
          return {
            primary: "time",
            direction: "lower",
            value: best.durationSec!,
            raw: {
              weightLb: null,
              reps: null,
              durationSec: best.durationSec!,
              distanceMi: null,
            },
          };
        }
        return null;
      }
    }
  }

  // ── Default cascade (unchanged — all higher-better) ───────────────────────
  const weighted = sets.filter(s => s.weightLb !== null && s.reps !== null);
  if (weighted.length > 0) {
    const best = weighted.reduce((a, b) =>
      (epley1RM(b.weightLb!, b.reps!) > epley1RM(a.weightLb!, a.reps!) ? b : a));
    return {
      primary: "rm",
      direction: "higher",
      value: epley1RM(best.weightLb!, best.reps!),
      raw: { weightLb: best.weightLb, reps: best.reps, durationSec: null, distanceMi: null },
    };
  }
  const repsOnly = sets.filter(s => s.reps !== null);
  if (repsOnly.length > 0) {
    const best = repsOnly.reduce((a, b) => (b.reps! > a.reps! ? b : a));
    return {
      primary: "reps",
      direction: "higher",
      value: best.reps!,
      raw: { weightLb: null, reps: best.reps, durationSec: null, distanceMi: null },
    };
  }
  const duration = sets.filter(s => s.durationSec !== null);
  if (duration.length > 0) {
    const best = duration.reduce((a, b) => (b.durationSec! > a.durationSec! ? b : a));
    return {
      primary: "duration",
      direction: "higher",
      value: best.durationSec!,
      raw: { weightLb: null, reps: null, durationSec: best.durationSec, distanceMi: null },
    };
  }

  return null;
}
```

**Key invariant:** the registry dispatch runs BEFORE the default cascade. A distance test that also has a phantom `durationSec` in old rows will hit the registry path and return `distance` — the stale `durationSec` is never visible to the comparator. The function never returns null when valid data for the mapped field exists, and returns null when it does not (same as today's behavior for a set with no metric).

### 5.4 `metricValue` extension

```typescript
function metricValue(
  s: { weightLb: number | null; reps: number | null; durationSec: number | null; distanceMi?: number | null },
  primary: MetricKind,
): number | null {
  if (primary === "rm") {
    if (s.weightLb !== null && s.reps !== null) return epley1RM(s.weightLb, s.reps);
    return null;
  }
  if (primary === "reps") return s.reps;
  if (primary === "duration") return s.durationSec;
  if (primary === "distance") return s.distanceMi ?? null;
  if (primary === "time") return s.durationSec;   // same field; direction handled by isBetter
  return null;
}
```

**Note on `time` vs `duration`:** both read `durationSec`. They are distinguished by direction only. `metricValue` returns the raw seconds value; callers use `isBetter(direction, candidate, incumbent)` to determine which is better.

### 5.5 `matchesBest` extension

```typescript
function matchesBest(
  s: { weightLb: number | null; reps: number | null; durationSec: number | null; distanceMi?: number | null },
  summary: BestSetSummary,
): boolean {
  const v = metricValue(s, summary.primary);
  if (v === null) return false;
  return Math.abs(v - summary.value) < 0.01;
}
```

No change to logic; widened parameter type and `MetricKind` primary arg suffice.

---

## 6. `recordsSetInWorkout` Changes

**Location:** lines ~596–631 in current `records.ts`.

### Step 4 (this session's best)
Pass canonical name:
```typescript
const thisSummary = bestSetSummary(bucket.sets, bucket.name);
```

### Step 5 (prior summary)
Pass canonical name for the prior sets too, so prior direction is consistent:
```typescript
const priorSummary = bestSetSummary(priorSets, key);
```

### Step 6 (cross-primary prior compare) — direction-aware + incompatible-kind guard

```typescript
let priorValue: number;
if (priorSummary.primary === thisSummary.primary) {
  priorValue = priorSummary.value;
} else {
  // Cross-kind: if they use different underlying fields and directions,
  // the values are incomparable (e.g. prior "duration" vs now "distance").
  // Safe pairs: "time" vs "duration" share durationSec but differ in direction —
  // still incomparable semantically. Rule: if direction differs, skip.
  // If direction is the same and field overlaps (e.g. both higher, one duration
  // one reps — still incomparable units). Policy: skip ALL cross-kind compares
  // unless the two kinds are the same. This is the safest reading of PRD §3.2 REQ-10.
  const recomputed = priorSets
    .map(s => metricValue(s, thisSummary.primary))
    .filter((v): v is number => v !== null);
  if (recomputed.length === 0) continue;
  // Direction-aware priorValue: for "lower" kinds, take the MIN of prior recomputed
  // (the best prior performance); for "higher" kinds, take MAX.
  priorValue = thisSummary.direction === "lower"
    ? Math.min(...recomputed)
    : Math.max(...recomputed);
}
```

### Step 7 (strict improvement check) — direction-aware

```typescript
// Replace: if (thisSummary.value <= priorValue) continue;
if (!isBetter(thisSummary.direction, thisSummary.value, priorValue)) continue;
```

### Result push — carry `distanceMi` in raw

```typescript
results.push({
  name: bucket.name,
  equipment,
  kind: thisSummary.primary,
  value: thisSummary.value,
  prior: priorValue,
  raw: thisSummary.raw,   // already carries distanceMi from widened raw shape
});
```

---

## 7. `getExerciseSummaries` + `getExerciseHistory` Changes

### `getExerciseSummaries` (line ~438)

```typescript
// BEFORE:
const summary = bestSetSummary(bucket.sets);
// AFTER:
const summary = bestSetSummary(bucket.sets, bucket.name);
```

### `getExerciseHistory` (line ~478)

```typescript
// BEFORE:
const summary = bestSetSummary(allSets);
// AFTER:
const summary = bestSetSummary(allSets, canonical);
```

### History best reducer (line ~510)

```typescript
// BEFORE:
const best = setsWithMetric.reduce((a, b) => (b.m > a.m ? b : a));
// AFTER — direction-aware:
const best = setsWithMetric.reduce((a, b) =>
  summary.direction === "lower" ? (b.m < a.m ? b : a) : (b.m > a.m ? b : a));
```

The `summary` variable is already in scope (the result of `bestSetSummary(allSets, canonical)`). Because `summary.direction` is now always present on the return type, no null-guard is needed here.

---

## 8. Engine Changes (`src/lib/game/engine.ts`)

### 8.1 Import `isBetter`

```typescript
// Current import line ~21:
import { canonicalExerciseName, bestSetSummary } from "@/lib/records";
// Add isBetter:
import { canonicalExerciseName, bestSetSummary, isBetter } from "@/lib/records";
```

### 8.2 Widen `WorkoutWithSets` type (lines ~57–64)

```typescript
sets: Array<{
  weightLb: number | null;
  reps: number | null;
  durationSec: number | null;
  distanceMi: number | null;   // ADD
}>;
```

### 8.3 Widen map types in `buildPrEvents` (lines ~266, ~274)

```typescript
// BEFORE:
const prBestByExercise = new Map<string, { primary: "rm" | "reps" | "duration"; value: number }>();
const workoutBestByExercise = new Map<string, { primary: "rm" | "reps" | "duration"; value: number }>();
// AFTER:
const prBestByExercise = new Map<string, { primary: MetricKind; direction: MetricDirection; value: number }>();
const workoutBestByExercise = new Map<string, { primary: MetricKind; direction: MetricDirection; value: number }>();
```

Import `MetricKind` and `MetricDirection` from `@/lib/records`.

### 8.4 Pass canonical name to `bestSetSummary` (line ~277)

```typescript
// BEFORE:
const summary = bestSetSummary(exercise.sets);
// AFTER (canon already computed at line ~276):
const summary = bestSetSummary(exercise.sets, canon);
```

### 8.5 Within-workout best merge (lines ~279–281) — direction-aware

```typescript
// BEFORE:
if (!existing || summary.value > existing.value) {
  workoutBestByExercise.set(canon, { primary: summary.primary, value: summary.value });
}
// AFTER:
const existingBest = workoutBestByExercise.get(canon);
if (!existingBest || isBetter(summary.direction, summary.value, existingBest.value)) {
  workoutBestByExercise.set(canon, {
    primary: summary.primary,
    direction: summary.direction,
    value: summary.value,
  });
}
```

### 8.6 PR comparison (line ~296) — direction-aware

```typescript
// BEFORE:
if (workoutBest.primary === prior.primary && workoutBest.value > prior.value) {
// AFTER:
if (workoutBest.primary === prior.primary && isBetter(workoutBest.direction, workoutBest.value, prior.value)) {
```

### 8.7 Prior map update (line ~314) — carry direction

```typescript
// BEFORE:
prBestByExercise.set(canon, workoutBest);
// workoutBest already has direction on it after 8.5 change — no change needed here.
```

### 8.8 Prisma select — add `distanceMi` (line ~950)

```typescript
sets: {
  select: { weightLb: true, reps: true, durationSec: true, distanceMi: true },
},
```

This is **RISK-2** from research — without this the entire feature silently no-ops at runtime.

---

## 9. `recap.ts` Change (Compile Blocker)

**File:** `src/lib/recap.ts`, line 133.

```typescript
// BEFORE:
const UNIT_FROM_PRIMARY: Record<ExerciseSummary["primary"], string> = {
  rm: "lb",
  reps: "reps",
  duration: "sec",
};
// AFTER:
const UNIT_FROM_PRIMARY: Record<ExerciseSummary["primary"], string> = {
  rm: "lb",
  reps: "reps",
  duration: "sec",
  distance: "mi",    // ADD
  time: "sec",       // ADD
};
```

This must be in the same commit as the union widening in `records.ts`. Without it TypeScript fails to compile the moment `ExerciseSummary["primary"]` gains two new members.

`prUnitTier` (line ~156) falls through to tier 2 for distance and time — this is acceptable (they sort after lb and reps, same as duration).

---

## 10. `mapBaselineToSet` Change (`src/lib/baseline-workout.ts`)

### 10.1 New import at top of file

```typescript
import { metricKindFor, canonicalExerciseName } from "@/lib/records";
```

No circular dependency risk: `baseline-workout.ts` imports from `db.ts` and `calendar.ts`; `records.ts` imports from `db.ts`, `calendar.ts`, and `program-template.ts`. Neither file imports from `baseline-workout.ts`.

### 10.2 Guard pattern in `mapBaselineToSet`

```typescript
export function mapBaselineToSet(testName: string, value: number, units: string): SetData {
  const set: SetData = {};
  const u = units.trim().toLowerCase();

  // ── Direct: value+units pair (unchanged) ─────────────────────────────────
  // [existing if/else chain unchanged]

  // ── Implicit: parse test name for the *other* dimension ──────────────────
  // Suppressed for registry-mapped tests: their primary metric is already
  // written by the direct path above; name-regex back-fills inject phantom
  // secondary metrics (e.g. durationSec=1200 on "20 Min Bike Distance").
  const isMapped = metricKindFor(canonicalExerciseName(testName)) !== null;

  const distMatch = testName.match(/(\d+(?:\.\d+)?)\s*(?:mi|mile|miles)\b/i);
  if (distMatch && set.distanceMi === undefined && !isMapped) {
    set.distanceMi = parseFloat(distMatch[1]!);
  }
  const minMatch = testName.match(/(\d+(?:\.\d+)?)\s*(?:min|minute|minutes)\b/i);
  if (minMatch && set.durationSec === undefined && !isMapped) {
    set.durationSec = Math.round(parseFloat(minMatch[1]!) * 60);
  }
  const meterMatch = testName.match(/(\d+(?:\.\d+)?)\s*m(?:eter|eters)?\b/i);
  if (meterMatch && set.distanceMi === undefined && !isMapped) {
    set.distanceMi = parseFloat(meterMatch[1]!) / METERS_PER_MILE;
  }

  return set;
}
```

**Stale rows note (PRD §4.1):** existing `source="baseline"` Sets for "20 Min Bike Distance" that already have a phantom `durationSec=1200` are left in place. The `distance` registry override makes `bestSetSummary` use `distanceMi` exclusively for this test; the stale `durationSec` is never read in the PR path. Document in a code comment on the `isMapped` guard.

---

## 11. UI Formatting Changes (Four Sites)

All changes are formatting-only. No new components, routes, or props.

### 11.1 `src/components/days/WorkoutLoggerForm.tsx` — `RecordStrip` renderer

**Current (lines ~174–178):**
```typescript
{r.kind === "rm"
  ? `${Math.round(r.value)} lb (1RM)`
  : r.kind === "reps"
    ? `${r.value} reps`
    : `${r.value}s`}
```

**After:**
```typescript
{r.kind === "rm"
  ? `${Math.round(r.value)} lb (1RM)`
  : r.kind === "reps"
    ? `${r.value} reps`
    : r.kind === "distance"
      ? `${r.value.toFixed(2)} mi`
      : r.kind === "time"
        ? formatDuration(r.value)
        : `${r.value}s`}
```

`formatDuration` already exists in the file (or in the same scope via import). The `time` case reuses it (converts raw seconds to M:SS) which is semantically correct. The `distance` case uses `.toFixed(2)` so "6.6 mi" renders cleanly.

### 11.2 `src/components/RecordsSummary.tsx` — `formatBest`

**Current `formatBest` (lines ~213–222):**
```typescript
function formatBest(e: {
  primary: string;
  bestValue: number;
  bestRaw: { weightLb: number | null; reps: number | null; durationSec: number | null };
}): string {
  if (e.primary === "rm") return `~${Math.round(e.bestValue)} lb 1RM (${e.bestRaw.weightLb} × ${e.bestRaw.reps})`;
  if (e.primary === "reps") return `${e.bestValue} reps`;
  if (e.primary === "duration") return formatDuration(e.bestValue);
  return String(e.bestValue);
}
```

**Add before the fallthrough `return String(e.bestValue)` line:**
```typescript
if (e.primary === "distance") return `${e.bestValue.toFixed(2)} mi`;
if (e.primary === "time") return formatDuration(e.bestValue);
```

Note: `bestRaw.distanceMi` is not used in `formatBest` (the value is already the metric value). No parameter type change needed — `primary: string` already accepts the new values.

### 11.3 `src/app/baselines/page.tsx` — `formatBest`

Identical to 11.2 — same function shape, same fix, same two lines before the fallthrough.

### 11.4 `src/app/baselines/exercise/[name]/page.tsx` — four locations

**a) Summary header ternary (lines ~32–36) — FIX REQUIRED (semantic bug, not just cosmetic):**

```typescript
// BEFORE (calls formatDuration on miles for non-rm/reps kinds):
{summary.primary === "rm"
  ? `~${Math.round(summary.bestValue)} lb 1RM (${summary.bestRaw.weightLb} × ${summary.bestRaw.reps})`
  : summary.primary === "reps"
    ? `${summary.bestValue} reps`
    : formatDuration(summary.bestValue)}

// AFTER:
{summary.primary === "rm"
  ? `~${Math.round(summary.bestValue)} lb 1RM (${summary.bestRaw.weightLb} × ${summary.bestRaw.reps})`
  : summary.primary === "reps"
    ? `${summary.bestValue} reps`
    : summary.primary === "distance"
      ? `${summary.bestValue.toFixed(2)} mi`
      : formatDuration(summary.bestValue)}
```

`time` and `duration` both use `formatDuration` (correct: both are seconds). `distance` gets the `mi` formatter. The previous code called `formatDuration(6.6)` for a distance result, rendering "0:06" — wrong.

**b) `chartTitleFor` (lines ~97–108):**
```typescript
case "distance": return "Distance over time";
case "time":     return "Best time over time";
```
Add before `default`.

**c) `unitsFor` (lines ~110–121):**
```typescript
case "distance": return "mi";
case "time":     return "sec";
```
Add before `default`. The Y-axis label will show "mi" or "sec" instead of blank.

**d) `tooltipFor` (lines ~123–130):**
```typescript
if (p === "distance") return `${h.best.toFixed(2)} mi`;
if (p === "time") return formatDuration(h.best);
```
Add before the `return String(h.best)` fallthrough.

`rawText` (line ~90–95) already falls through to `formatDuration` when `rawDuration !== null` and `rawWeight/rawReps` are null — this is correct for both `duration` and `time`. No change needed.

---

## 12. Test Plan (`src/lib/records.test.ts` — new file)

### 12.1 File location and mock pattern

```typescript
// src/lib/records.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  bestSetSummary,
  metricKindFor,
  isBetter,
  recordsSetInWorkout,
  getExerciseHistory,
  canonicalExerciseName,
} from "@/lib/records";

// Pure functions (metricKindFor, bestSetSummary, isBetter, canonicalExerciseName)
// require NO mocks — call directly with synthetic data.

// DB-touching functions use the existing mock pattern:
vi.mock("@/lib/db", () => ({
  prisma: {
    workoutExercise: { findMany: vi.fn() },
  },
}));
```

### 12.2 Test suite structure

**Group 1 — `metricKindFor`**
- Returns `{ kind: "distance", direction: "higher" }` for `"20 Min Bike Distance"`
- Returns `{ kind: "time", direction: "lower" }` for `"1.5 Mile Run"`
- Returns null for unmapped strength movements (e.g. `"Pull-Up"`, `"DB Shoulder Press"`)
- Returns correct value when passed a pre-canonicalized name (same as raw name for all registry entries — belt-and-suspenders check)

**Group 2 — `isBetter`**
- `isBetter("higher", 6.6, 5.9)` → true (distance PR)
- `isBetter("higher", 5.9, 6.6)` → false (regression)
- `isBetter("higher", 6.6, 6.6)` → false (tie)
- `isBetter("lower", 480, 510)` → true (faster run)
- `isBetter("lower", 510, 480)` → false (slower run)
- `isBetter("lower", 480, 480)` → false (tie)

**Group 3 — `bestSetSummary` (mapped path)**
- Distance: `bestSetSummary([{distanceMi:5.9,...}, {distanceMi:6.6,...}], "20 Min Bike Distance")` → `{ primary:"distance", direction:"higher", value:6.6 }`
- Time: `bestSetSummary([{durationSec:510,...}, {durationSec:480,...}], "1.5 Mile Run")` → `{ primary:"time", direction:"lower", value:480 }` (picks min)
- Returns null when mapped field is null on all sets: `bestSetSummary([{distanceMi:null,...}], "20 Min Bike Distance")` → null
- Distance set with phantom durationSec: `bestSetSummary([{distanceMi:6.6, durationSec:1200,...}], "20 Min Bike Distance")` → `{ primary:"distance", value:6.6 }` (not duration)

**Group 4 — `bestSetSummary` (unmapped regression)**
- Weighted: `bestSetSummary([{weightLb:65, reps:8,...}])` → `{ primary:"rm", direction:"higher" }` (unchanged)
- Reps-only: `bestSetSummary([{reps:15,...}])` → `{ primary:"reps", direction:"higher" }` (unchanged)
- Duration-only: `bestSetSummary([{durationSec:252,...}])` → `{ primary:"duration", direction:"higher" }` (unchanged)
- Empty → null (unchanged)

**Group 5 — `recordsSetInWorkout` (requires DB mock)**
- Bike 5.9→6.6 mi: returns `RecordSet` with `kind:"distance"`, `value:6.6`, `prior:5.9`
- Run faster (510→480 sec): returns `RecordSet` with `kind:"time"`, `value:480`, `prior:510`
- Run slower (480→510 sec): returns empty array (no PR)
- Run tie (480→480 sec): returns empty array (no PR)
- Unmapped strength movement (new 1RM): returns `RecordSet` with `kind:"rm"` (regression test)
- Brand-new movement (no prior): returns empty array

**Group 6 — `buildPrEvents` (via engine, or tested inline if exported)**
The engine's `buildPrEvents` is not currently exported. Two options:
1. Test it indirectly through `computeGameStateFromData` (exported from engine.ts) — build synthetic `WorkoutWithSets[]` with two workouts: prior bike (5.9 mi) and new bike (6.6 mi), verify `gameState.recentEvents` includes a `pr.set · 20 Min Bike Distance` event.
2. Export `buildPrEvents` as a named export for testability.

**Decision: Option 1 (indirect via `computeGameStateFromData`).** The function is already exported for testing (line ~387 in engine.ts). Keep `buildPrEvents` private. The test injects synthetic data without DB access. Required: ensure `computeGameStateFromData` is importable with a mocked `ActiveProgramSnapshot` (pass a minimal `EngineData` stub).

Test cases:
- Two workouts (bike, prior 5.9 then new 6.6): `pr.set` event with attribute `END` is present in output
- Two workouts (run, prior 510 then new 480 sec): `pr.set` event with attribute `END` is present
- Two workouts (run, prior 480 then new 510 sec — slower): NO `pr.set` for this exercise
- 3/day cap: inject 4 same-day distance/time PRs, verify only 3 `pr.set` events for that day
- Retroactive: prior workout from 10 days ago, new from today — PR fires for today's dateKey

**Group 7 — `mapBaselineToSet` (pure, no mock)**
- `mapBaselineToSet("20 Min Bike Distance", 6.6, "mi")` → `{ distanceMi: 6.6 }` with no `durationSec` key
- `mapBaselineToSet("60 Min Steady Effort Distance", 4.2, "mi")` → `{ distanceMi: 4.2 }` with no `durationSec`
- `mapBaselineToSet("1.5 Mile Run", 480, "sec")` → `{ durationSec: 480 }` with no `distanceMi`
- `mapBaselineToSet("20 Min Step-Up Reps", 95, "reps")` → includes `reps: 95` (unmapped, phantom OK per research §2.2 — leave unmapped)
- `mapBaselineToSet("Plank Max Hold", 252, "sec")` → `{ durationSec: 252 }` (unchanged)
- `mapBaselineToSet("Dead Hang", 45, "sec")` → `{ durationSec: 45 }` (unchanged)

---

## 13. Work Streams

**This is ONE coupled stream.** The `MetricKind` union widening, `bestSetSummary` redesign, `isBetter` helper, engine changes, `recap.ts` compile fix, `mapBaselineToSet` guard, and `RecordSet`/`ExerciseSummary` type widening are all interdependent — any one change in isolation leaves the build broken or the feature non-functional. A single developer implements all changes in one commit or a series of commits on the feature branch, always keeping the build green.

---

## 14. Implementation Order

The following order keeps the build green at each save:

1. **`src/lib/records.ts` — types + registry + helpers**
   - Add `MetricKind` and `MetricDirection` type exports
   - Widen `ExerciseSummary.bestRaw` and `RecordSet.raw` to include `distanceMi`
   - Widen `ExerciseSummary.primary` and `RecordSet.kind` to `MetricKind`
   - Add `METRIC_KIND_OVERRIDES`, `metricKindFor`, `isBetter` exports
   - Redesign `bestSetSummary` signature + body (registry dispatch + widened `BestSetInput`)
   - Extend `metricValue` and `matchesBest`
   - Fix `getExerciseSummaries` and `getExerciseHistory` callers (pass canonical name)
   - Fix `getExerciseHistory` best reducer (direction-aware)
   - Fix `recordsSetInWorkout` step 6 + step 7 (direction-aware cross-primary + improvement check)

2. **`src/lib/recap.ts` — compile blocker fix** (immediately after step 1, or the build breaks)
   - Add `distance: "mi"` and `time: "sec"` to `UNIT_FROM_PRIMARY`

3. **`src/lib/game/engine.ts` — engine PR replay**
   - Import `isBetter`, `MetricKind`, `MetricDirection` from `@/lib/records`
   - Widen `WorkoutWithSets.exercises.sets` type to add `distanceMi`
   - Widen `prBestByExercise` and `workoutBestByExercise` map value types
   - Update `buildPrEvents`: pass canonical name, direction-aware within-workout merge, `isBetter` comparison
   - Add `distanceMi: true` to Prisma select (~line 950)

4. **`src/lib/baseline-workout.ts` — phantom duration suppression**
   - Add import for `metricKindFor` + `canonicalExerciseName`
   - Guard all three name-regex back-fills with `!isMapped`

5. **UI fixes (four files, independent of each other)**
   - `WorkoutLoggerForm.tsx` — `RecordStrip` distance/time branches
   - `RecordsSummary.tsx` — `formatBest` distance/time branches
   - `baselines/page.tsx` — `formatBest` distance/time branches
   - `baselines/exercise/[name]/page.tsx` — `chartTitleFor`, `unitsFor`, `tooltipFor`, summary header ternary

6. **`src/lib/records.test.ts` — new test file** (all groups in §12)

7. **QA gates:** `npx tsc --noEmit` → `npm run lint` → `npm run build` → `npx vitest run`

---

## 15. Critical Decisions

### D-1: `direction` on the summary return, not a `directionFor(kind)` helper
**Decision:** carry `direction: MetricDirection` directly on `BestSetSummary`.  
**Rationale:** both `recordsSetInWorkout` and `buildPrEvents` need direction at the point of comparison, not just the kind. A summary object already travels to both sites; adding `direction` to it avoids a second lookup at every comparison point. A `directionFor(kind)` helper would work but forces every comparison site to call it separately and opens the door to a site forgetting to call it. The summary-carry pattern is explicit and hard to misuse.

### D-2: `isBetter` is exported from `records.ts`, not duplicated in `engine.ts`
**Decision:** single export from `records.ts`; `engine.ts` imports it.  
**Rationale:** one source of truth for comparison semantics. The research identified this as a shared concern across both comparison sites. Any future change to comparison semantics (e.g. adding a tolerance) applies in one place.

### D-3: Registry keys are canonical names (post-`canonicalExerciseName`)
**Decision:** `METRIC_KIND_OVERRIDES` keys are canonical; `metricKindFor` applies `canonicalExerciseName` before lookup.  
**Rationale:** mirrors `EXERCISE_ALIAS_GROUPS` philosophy. All five confirmed entries are their own canonical form (verified in research §2.3), so the resolver adds robustness without cost.

### D-4: Stale phantom `durationSec` rows are left untouched
**Decision:** no data-hygiene migration for existing `source="baseline"` Sets that have phantom `durationSec`.  
**Rationale:** PRD §4.1 explicitly decides to leave them. The registry forces `distance` as primary for those exercises; `bestSetSummary` dispatches on the registry path and uses `distanceMi` exclusively. The phantom `durationSec` is never read in the PR path. A cleanup migration would require a schema change (none wanted here) or a raw SQL update with risk on the prod-shared Neon DB.

### D-5: `time` and `duration` share `durationSec`; distinguished by direction only
**Decision:** `metricValue("time", s)` returns `s.durationSec` — same as `"duration"`. Direction (lower vs higher) is what distinguishes them.  
**Rationale:** there is only one seconds field in the DB (`durationSec`). A lower-better timed effort and a higher-better hold both store seconds. The registry provides the direction; the comparison helper (`isBetter`) does the right thing. No new DB field is needed.

### D-6: Cross-kind prior comparison skips ALL mismatched kinds
**Decision:** when `priorSummary.primary !== thisSummary.primary`, recompute prior using `thisSummary.primary`'s metric function AND use direction-aware min/max. If the recomputed set is empty, skip (no comparable prior).  
**Rationale:** PRD §3.2 REQ-10 says "incomparable kinds → skip rather than mis-compare." The safest interpretation: always recompute using the current session's kind to stay on consistent units, then use `direction` to pick the right aggregate. This handles the case where prior data has a phantom `durationSec` alongside the real `distanceMi` without producing a false PR.

### D-7: No new vitest mock pattern needed for `mapBaselineToSet`
**Decision:** test `mapBaselineToSet` directly as a pure function with no mock.  
**Rationale:** the function has no DB calls and returns a simple object. The existing test files show the `vi.mock("@/lib/db")` pattern is only needed for functions that touch `prisma`. This group of tests is the cleanest in the file.

### D-8: `buildPrEvents` tested indirectly via `computeGameStateFromData`
**Decision:** do not export `buildPrEvents`; test PR replay through the exported `computeGameStateFromData`.  
**Rationale:** keeps the engine's internal replay logic private. `computeGameStateFromData` takes `EngineData` which is injected; a synthetic `WorkoutWithSets[]` with two workouts is sufficient to validate the PR path. This matches the design intent documented at line ~384 of engine.ts.

---

## Summary

Nine files touched. One coupled stream. No migration. The compile blocker (`recap.ts`) must land in the same pass as the union widening. The engine's missing `distanceMi: true` select (RISK-2) is the single runtime blocker that would otherwise cause the feature to silently no-op after all other changes are correct.

**Critical path:** `records.ts` types + helpers → `recap.ts` compile fix → `engine.ts` Prisma select + comparisons → `baseline-workout.ts` phantom guard → UI formatters → tests → QA gates.
