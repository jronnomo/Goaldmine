# PRD: Endurance PR Metric Kinds (distance + time-to-complete)

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-06-19
**Status**: Approved
**GitHub Issue**: N/A — feature branch + PR
**Branch**: feature/endurance-pr-metric-kinds
**UX-research**: skipped — pure engine/lib + data-logic change; no new route, component, or visual surface (read tools relay existing shapes).

---

## 1. Overview

### 1.1 Problem Statement
The PR engine only recognizes three "best" metric kinds in `bestSetSummary` (`src/lib/records.ts`): `rm` (Epley 1RM), `reps` (max), and `duration` (max `durationSec`). All three assume **higher = better**. Two real PR shapes are therefore invisible and earn no `pr.set` (+40) XP, no `recordsSet[]` on `log_workout`, and no appearance in exercise history/summaries:

1. **DISTANCE (higher-is-better).** "20 Min Bike Distance" improved 5.9 mi (6/9) → 6.6 mi (6/19, +12%) — a genuine PR. The baseline mirror (`src/lib/baseline-workout.ts`) writes `distanceMi`, but `bestSetSummary` never inspects `distanceMi`, so the set returns `null` (no metric) and is skipped. **Worse:** the testName "20 Min Bike Distance" trips the `minMatch` regex in `mapBaselineToSet` and also stamps a fixed `durationSec = 1200` (20 min). That constant is identical every retest, so the only PR-eligible field can never beat itself.
2. **TIME-TO-COMPLETE (lower-is-better).** "1.5 Mile Run" is logged in seconds (time to finish). The engine treats `durationSec` as higher-is-better, so a **faster** run looks like a regression and never registers as a PR.

Discovered 2026-06-19 while explaining why a real bike PR didn't complete the daily quest / award PR XP.

### 1.2 Proposed Solution
Introduce two new metric kinds — `distance` (higher-better) and `time` (lower-better) — alongside the existing `rm`/`reps`/`duration`, and make the "best" derivation **direction-aware**.

Because a bare set can't self-identify (a `durationSec` value backs both a higher-better plank hold and a lower-better run), disambiguation comes from a **hand-curated name → metric-kind registry** (`METRIC_KIND_OVERRIDES`), mirroring the existing `EXERCISE_ALIAS_GROUPS` philosophy: explicit, curated, unmapped names keep today's exact behavior. The registry keys on **canonical exercise name** and returns `{ kind, direction }`. `bestSetSummary` consults it (when a name is available) to pick the metric field and direction; the two comparison sites — `recordsSetInWorkout` (in `records.ts`) and `buildPrEvents` (in `engine.ts`) — honor the direction so "lower beats" works for `time`.

The same registry fixes the bike's false-duration stamp: a name mapped to `distance` (or `time`) tells `mapBaselineToSet` not to back-fill `durationSec` from the "N min" name fragment.

Since the game engine recomputes XP fully retroactively (gotcha E.1), this **retroactively** credits past endurance PRs — consistent with the "no cold start" invariant.

### 1.3 Success Criteria
- A distance improvement on a registry-mapped distance test (e.g. "20 Min Bike Distance" 5.9 → 6.6 mi) produces a `RecordSet` with `kind: "distance"` and a `pr.set` XP event (attribute END).
- A faster time on a registry-mapped time test (e.g. "1.5 Mile Run", lower seconds) produces a `RecordSet` with `kind: "time"` and a `pr.set` XP event — a slower time does **not**.
- Existing `rm`/`reps`/`duration` PRs are byte-for-byte unchanged (regression-locked by new + existing unit tests).
- The bike test no longer carries a phantom `durationSec` that masks the distance metric.
- `get_exercise_history` / `getExerciseSummaries` report the correct `primary` kind + best for endurance movements.

---

## 2. User Stories

| ID     | As a... | I want to... | So that... | Priority |
|--------|---------|--------------|------------|----------|
| US-001 | user logging via Claude | my bike-distance and run-time retest improvements to register as PRs | I earn the +40 `pr.set` XP and see them in `recordsSet[]` | Must Have |
| US-002 | user viewing my character/records | endurance PRs to appear in exercise history with the right metric + direction | the read surfaces match the game engine | Must Have |
| US-003 | user (data hygiene) | a "N-minute" distance test to stop stamping a fake duration | the distance signal isn't masked and history is clean | Must Have |
| US-004 | developer | unmapped exercises to behave exactly as before | adding endurance kinds is zero-risk for strength movements | Must Have |

---

## 3. Functional Requirements

### 3.1 Core Requirements
1. Extend the metric-kind union from `"rm" | "reps" | "duration"` to add `"distance"` and `"time"` everywhere it appears (`records.ts` types `ExerciseSummary.primary`, `RecordSet.kind`, internal helpers; `engine.ts` `buildPrEvents` maps).
2. Add a curated `METRIC_KIND_OVERRIDES: Record<string, { kind: MetricKind; direction: "higher" | "lower" }>` in `records.ts`, keyed by **canonical** exercise name. Seed it with the known endurance tests (see 4.2). Export a resolver `metricKindFor(canonicalName): { kind, direction } | null`.
3. `bestSetSummary` becomes **name-aware**: accept an optional canonical name; when the registry maps it, derive the best from the mapped field (`distanceMi` for `distance`, `durationSec` for `time`) using the mapped direction (max for higher, min for lower). When unmapped, fall back to **exactly today's** weighted→reps→duration cascade (higher-better).
4. Direction-aware comparison: a single source-of-truth helper `isBetter(kind, direction, candidate, incumbent)` (or a `direction` field on the summary) used by both `recordsSetInWorkout` and `buildPrEvents`, so `time` PRs fire on a strictly **lower** value and all others on strictly **higher**.
5. `metricValue` / `matchesBest` extended to resolve `distance` → `distanceMi` and `time` → `durationSec` (raw seconds; direction handled by the comparator, not the value).
6. `mapBaselineToSet` in `baseline-workout.ts`: when the test's canonical name maps to `distance` or `time` in the registry, **suppress** the `durationSec`/`distanceMi` name-regex back-fill that would otherwise inject a phantom metric. The direct units→field mapping still applies (mi → `distanceMi`, sec → `durationSec`).
7. `recordsSetInWorkout` returns endurance `RecordSet`s with the correct `kind`, `value`, and `prior`, so `log_workout`'s `recordsSet[]` surfaces them.
8. `buildPrEvents` (engine) awards `pr.set` for endurance PRs, retroactively, respecting the existing 3/day cap and `prAttributeForExercise` routing (run/bike/row already → END).
9. `getExerciseSummaries` and `getExerciseHistory` report the correct `primary` and best for mapped endurance movements (history `best` selection respects direction).

### 3.2 Secondary Requirements
10. The cross-primary prior-comparison branch in `recordsSetInWorkout` (step 6, where prior primary differs from this session's) must not crash or mis-fire when one side is an endurance kind — guard: if the kinds are incompatible (e.g. prior `duration` vs now `distance`), treat as no comparable prior and skip rather than compare across units.
11. The registry should carry the two confirmed cases plus the obvious siblings already named in `BASELINE_ATTRIBUTE_MAP` / `program-template` that are clearly distance or time (see 4.2 candidate list) — but only ones that are unambiguous; leave anything uncertain unmapped (it keeps current behavior, no regression).

### 3.3 Out of Scope
- New Prisma migration (Set.`distanceMi` already exists).
- New MCP tools or changes to any tool's input schema.
- UI/route/component changes (read tools relay the new `kind` value as-is; no new view).
- Pace-based metrics (min/mi), splits, or composite scoring.
- Changing `readiness.ts` hike/endurance metric handling (separate system; untouched).
- Per-test direction stored in the DB or program template (registry-only this pass).

---

## 4. Technical Design

### 4.1 Data Model (Prisma)
No schema change. `Set.distanceMi Float?` and `Set.durationSec Int?` already exist (schema lines 53–54). No migration, no backfill.

> ⚠ One **data-hygiene** consideration: existing baseline-mirrored bike sets may already hold a phantom `durationSec = 1200` from the current `mapBaselineToSet`. After the fix, *new* mirrors won't, but old rows persist. The engine's higher-better `duration` PR can't fire on a constant, so this is inert today — but the architect must decide whether to (a) leave old rows (inert), or (b) include a tiny idempotent cleanup. **Default: leave them; document it.** Distance now wins as the primary for that movement via the registry, so the stale duration is ignored regardless.

### 4.2 Curated registry seed (`METRIC_KIND_OVERRIDES`)
Keyed by **canonical** name (post-`canonicalExerciseName`). Confirmed:

| Canonical name | kind | direction | Notes |
|---|---|---|---|
| `20 Min Bike Distance` | `distance` | `higher` | the discovery case; suppress phantom duration |
| `1.5 Mile Run` | `time` | `lower` | seconds-to-complete; faster = PR |
| `60 Min Steady Effort Distance` | `distance` | `higher` | END benchmark (program-template) |
| `40-Yard Sprint` | `time` | `lower` | seconds; faster = PR |
| `5-10-5 Shuttle` | `time` | `lower` | seconds; faster = PR |

Architect to confirm each against `program-template.ts` units and `BASELINE_ATTRIBUTE_MAP`; **drop any whose units/semantics are ambiguous** (unmapped = safe no-op). `20 Min Step-Up Reps` stays `reps` (unmapped). Vertical/Broad Jump are distance-ish but higher-better in inches and currently log as… architect verifies; if they don't flow through sets, leave unmapped.

### 4.3 MCP Tool Surface
None changed. `log_workout` already returns `recordsSet[]`; the only difference is endurance entries now appear with `kind: "distance" | "time"`. Document in the tool's description? Optional, low priority — the shape is additive.

### 4.4 Server Actions
None.

### 4.5 Pages / Components
None. (If `recordsSet[]` is rendered anywhere client-side, verify the new `kind` values don't break a `switch` that assumes three cases — QA grep for `kind === "rm"` / exhaustive switches over the union.)

### 4.6 Date / Time Semantics
No new date math. Existing `startedAt` ordering in PR replay unchanged.

### 4.7 Override-Awareness
N/A — PR replay reads `Workout`/`Set` rows, not day overrides.

### 4.8 Third-Party Dependencies
None.

---

## 5. UI/UX Specifications
N/A — no UI surface. The game-state `recentEvents` / `recordsSet[]` simply gains endurance `pr.set` rows, rendered by existing code paths.

---

## 6. Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|------------------|
| Unmapped exercise (all strength movements) | Identical to today: weighted→reps→duration, higher-better. Zero behavior change. |
| First-ever endurance result (no prior) | NOT a PR (nothing to beat) — same first-occurrence rule as existing kinds. |
| Slower run time on retest | NOT a PR (`time` is lower-better; strict improvement required). |
| Equal value (tie) on retest | NOT a PR (strict `<` for time, strict `>` for others). |
| Prior is `duration` (phantom), now resolves `distance` via registry | Cross-kind incomparable → skip cross-compare; the registry kind wins as primary going forward. No false PR. |
| Distance test with phantom `durationSec` from old rows | Registry forces `distance` primary; stale duration ignored. |
| Mapped test logged with missing target field (e.g. `time` test but `durationSec` null) | No metric → skipped (same as today's null path). |
| 3 endurance PRs same day | 3/day `pr.set` cap still applies (existing engine behavior). |

---

## 7. Security Considerations
- No new routes, no auth surface change.
- Pure in-process computation over existing rows; no new input parsing.
- No raw SQL, no `dangerouslySetInnerHTML`.

---

## 8. Acceptance Criteria

1. [ ] `npx tsc --noEmit` passes with 0 errors (the union widening compiles across `records.ts`, `engine.ts`, any consumer `switch`).
2. [ ] `npm run lint` introduces no new errors.
3. [ ] `npm run build` succeeds.
4. [ ] `npx vitest run` passes; new unit tests added (see 10) and all existing `records`/engine tests still green.
5. [ ] `MetricKind` union includes `"distance"` and `"time"`; `RecordSet.kind` and `ExerciseSummary.primary` use it.
6. [ ] `METRIC_KIND_OVERRIDES` exists, keyed by canonical name, with the confirmed seed; `metricKindFor()` resolves canonical + alias spellings.
7. [ ] `bestSetSummary` returns `{ primary: "distance", value: <mi>, direction: "higher" }` for a bike-distance set bucket, and `{ primary: "time", value: <sec>, direction: "lower" }` for a run set bucket.
8. [ ] `recordsSetInWorkout` returns a `kind: "distance"` RecordSet for 5.9→6.6 mi, and a `kind: "time"` RecordSet only when the new time is strictly lower.
9. [ ] `buildPrEvents` emits a `pr.set` event (attribute END) for the bike distance PR and for a faster run; emits none for a slower run. Verified by a unit test over synthetic workouts.
10. [ ] Unmapped strength movements produce identical `bestSetSummary`/PR output before vs after (regression test).
11. [ ] `mapBaselineToSet("20 Min Bike Distance", 6.6, "mi")` returns `{ distanceMi: 6.6 }` with **no** `durationSec`.
12. [ ] All Date math unchanged / still via `@/lib/calendar`.
13. [ ] Live MCP smoke: `get_game_state` after re-deploy shows a retroactive `pr.set · 20 Min Bike Distance` (or via `get_exercise_history`), confirming the retroactive grant.

---

## 9. Open Questions
_None — resolved in Phase 1:_
- Disambiguation → curated name→metric registry.
- Retroactivity → retroactive grant (no cold start).
- Surface scope → XP + all read surfaces.
- Delivery → feature branch + PR.

---

## 10. Test Plan

### 10.1 Typecheck / Lint / Build
`npx tsc --noEmit`, `npm run lint`, `npm run build` — all clean.

### 10.2 Unit tests (vitest) — primary verification (no UI)
Add `src/lib/records.test.ts` (or extend existing) + engine PR tests covering:
- `bestSetSummary` for distance/time buckets (mapped) and unmapped fallback (regression).
- direction comparator: time lower-beats, others higher-beat; ties not PRs.
- `recordsSetInWorkout` over synthetic workouts: bike 5.9→6.6 = PR; run slower = no PR; run faster = PR.
- `buildPrEvents` retroactive: produces END `pr.set` for endurance improvements, respects 3/day cap.
- `mapBaselineToSet` no-phantom-duration for mapped distance/time tests; unchanged for others.

### 10.3 MCP curl smoke
With dev server up: `get_exercise_history {testName:"20 Min Bike Distance"}` → `primary: "distance"`, best 6.6. `get_game_state` → a `pr.set · 20 Min Bike Distance` event exists in history (retroactive).

### 10.4 Migration verification
N/A (no migration).

---

## 11. Appendix

### 11.1 Discovery Notes
Found while debugging why the 6/19 daily quest sat at 87/95 and the bike retest earned no PR XP. Root cause traced through `records.ts` (`bestSetSummary` ignores `distanceMi`; union is higher-better only), `engine.ts` (`buildPrEvents` copies the same contract), and `baseline-workout.ts` (`mapBaselineToSet` stamps phantom `durationSec=1200` from the "20 Min" name). Bike history confirmed a true PR: 5.9 mi (6/9) → 6.6 mi (6/19). `prAttributeForExercise` already routes run/bike/row → END, so attribute mapping needs no change.

### 11.2 References
- `src/lib/records.ts` — `bestSetSummary`, `metricValue`, `matchesBest`, `recordsSetInWorkout`, `EXERCISE_ALIAS_GROUPS`, `canonicalExerciseName`.
- `src/lib/game/engine.ts` — `buildPrEvents` (lines ~265–315), its own `bestSetSummary` consumer.
- `src/lib/game/rules.ts` — `PR_SET=40`, `prAttributeForExercise`, `BASELINE_ATTRIBUTE_MAP`.
- `src/lib/baseline-workout.ts` — `mapBaselineToSet`.
- `docs/project-gotchas.md` E.1 (retroactive XP), E.2 (baseline mirror + PR replay), §B.2 (alias map curation).
