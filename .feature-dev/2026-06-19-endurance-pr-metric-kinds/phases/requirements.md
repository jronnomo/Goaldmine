# Requirements — Endurance PR Metric Kinds

Source: docs/prds/PRD-endurance-pr-metric-kinds.md. Tightly coupled — `records.ts`, `engine.ts`, `baseline-workout.ts` share the metric-kind union/contract and must move together. Single developer stream.

## REQ-001 — Widen the metric-kind union + curated registry (records.ts)
**Description:** Add `"distance"` and `"time"` to the metric-kind type used by `bestSetSummary`, `metricValue`, `matchesBest`, `RecordSet.kind`, `ExerciseSummary.primary`. Add `METRIC_KIND_OVERRIDES` (canonical-name → `{ kind, direction: "higher"|"lower" }`) + `metricKindFor(name)` resolver (alias-aware via `canonicalExerciseName`). Seed with confirmed cases from PRD 4.2; the architect validates each against `program-template.ts` and drops ambiguous ones.
**Files:** `src/lib/records.ts`
**Acceptance:** Union widened everywhere; `metricKindFor("20 Min Bike Distance")` → `{kind:"distance",direction:"higher"}`, `metricKindFor("1.5 Mile Run")` → `{kind:"time",direction:"lower"}`; unmapped → `null`.
**Deps:** none. **Complexity:** M

## REQ-002 — Direction-aware best + comparison (records.ts)
**Description:** `bestSetSummary` accepts an optional canonical name; when mapped, derive best from `distanceMi` (distance) or `durationSec` (time) using direction (max for higher, min for lower) and return a `direction` on the summary. Unmapped path = today's exact weighted→reps→duration cascade. Introduce one `isBetter(direction, candidate, incumbent)` (strict) used by `recordsSetInWorkout`. Extend `metricValue`/`matchesBest` for the new kinds. Guard the cross-primary prior branch against incomparable kinds (skip, don't mis-compare).
**Files:** `src/lib/records.ts`
**Acceptance:** AC 7, 8, 10 in PRD. Existing rm/reps/duration output unchanged.
**Deps:** REQ-001. **Complexity:** M

## REQ-003 — Engine PR replay parity (engine.ts)
**Description:** Update `buildPrEvents` to use the same widened union + direction-aware comparison so endurance PRs emit `pr.set`. Keep the 3/day cap and `prAttributeForExercise` routing. Pass the canonical name into `bestSetSummary` (it already computes `canon`). Ensure the prior-snapshot map stores kind+direction.
**Files:** `src/lib/game/engine.ts`
**Acceptance:** AC 9. Faster run / bike-distance gain → `pr.set` (END); slower run → none; cap respected.
**Deps:** REQ-001, REQ-002. **Complexity:** M

## REQ-004 — Kill the phantom duration stamp (baseline-workout.ts)
**Description:** In `mapBaselineToSet`, when the test's canonical name maps to `distance` or `time` in the registry, suppress the name-regex back-fill of `durationSec`/`distanceMi` that injects a phantom metric. Keep the direct units→field mapping. Do NOT mutate existing rows (document inert stale durations per PRD 4.1).
**Files:** `src/lib/baseline-workout.ts`
**Acceptance:** AC 11. `mapBaselineToSet("20 Min Bike Distance",6.6,"mi")` → `{distanceMi:6.6}`, no `durationSec`.
**Deps:** REQ-001. **Complexity:** S

## REQ-005 — Read-surface correctness (records.ts)
**Description:** Ensure `getExerciseSummaries` + `getExerciseHistory` report correct `primary`/best for mapped endurance movements (history `best` selection respects direction — for `time`, "best" = lowest seconds).
**Files:** `src/lib/records.ts`
**Acceptance:** AC 5, plus `get_exercise_history` smoke shows distance primary for the bike.
**Deps:** REQ-001, REQ-002. **Complexity:** S

## REQ-006 — Tests
**Description:** Add/extend vitest: `bestSetSummary` mapped vs unmapped (regression), direction comparator, `recordsSetInWorkout` (bike 5.9→6.6 PR; run faster PR; run slower/tie no PR; unmapped strength unchanged), `buildPrEvents` retroactive END pr.set + 3/day cap, `mapBaselineToSet` no-phantom-duration.
**Files:** `src/lib/records.test.ts` (new), engine test (new or extend)
**Acceptance:** AC 4. `npx vitest run` green.
**Deps:** REQ-001..005. **Complexity:** M
