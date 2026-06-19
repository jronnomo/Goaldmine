# Completion Report — Endurance PR Metric Kinds

**Feature:** Add `distance` (higher-better) + `time` (lower-better) PR metric kinds so cardio/endurance baselines earn `pr.set` XP and flow through all read surfaces.
**Branch:** `feature/endurance-pr-metric-kinds` → PR against `main`.
**Date:** 2026-06-19. **Iterations:** 2 (initial build + QA fix + lint cleanup).

## What was built
A hand-curated `METRIC_KIND_OVERRIDES` registry (canonical name → `{kind, direction}`) widens the PR engine's metric union from `rm|reps|duration` to add `distance` and `time`. `bestSetSummary` consults the registry before the (unchanged) default cascade; a single `isBetter(direction, …)` helper makes both PR-comparison sites (`recordsSetInWorkout` and the engine's `buildPrEvents`) direction-aware. The engine query now selects `distanceMi`; the `mapBaselineToSet` phantom-duration stamp is suppressed for registry-mapped tests; five read/display surfaces format the new kinds correctly. XP is granted retroactively (no-cold-start invariant).

## Files changed
| File | Change |
|---|---|
| `src/lib/records.ts` | `MetricKind`/`MetricDirection` (single source of truth), `METRIC_KIND_OVERRIDES` + `metricKindFor`, `isBetter`; direction-aware `bestSetSummary` (registry path + unchanged cascade), `metricValue`/`matchesBest`, history reducer, cross-primary compare; `rawDistance` on `ExerciseHistoryPoint` |
| `src/lib/game/engine.ts` | `distanceMi` in PR-replay Prisma select + `WorkoutWithSets`; direction-aware `buildPrEvents` via `isBetter`; maps carry kind+direction; 3/day cap intact |
| `src/lib/baseline-workout.ts` | suppress all 3 name-regex back-fills for registry-mapped tests; covenant comment |
| `src/lib/recap.ts` | `distance`/`time` in `UNIT_FROM_PRIMARY`; `formatPrValue` for highlight-card label |
| `src/components/RecordsSummary.tsx`, `src/components/days/WorkoutLoggerForm.tsx`, `src/app/baselines/page.tsx`, `src/app/baselines/exercise/[name]/page.tsx` | kind-aware formatting (distance "X.XX mi", time "M:SS"); widened helper param types; kind-aware session-list `rawText` |
| `src/lib/records.test.ts` (new) | 43 tests: registry, isBetter, bestSetSummary mapped/unmapped, recordsSetInWorkout, buildPrEvents retroactive + cap, mapBaselineToSet no-phantom |

## Requirements status
REQ-001..006: **all DONE.** PRD §8 acceptance criteria 1–13: all PASS.

## Gates
- `npx tsc --noEmit`: 0 errors
- `npx vitest run`: 180 passed (43 new + 137 existing)
- `npm run lint`: 0 problems
- `npm run build`: ✓ compiled

## Headline verification (live MCP smoke, shared Neon DB)
`get_game_state` now returns `PR · 20 Min Bike Distance` (attribute END, +40 XP, dateKey 2026-06-19) — **the retroactive endurance PR is credited**. `get_exercise_history` reports `primary:"distance"` (best ≈ 6.6) for the bike and `primary:"time"` for the 1.5-mi run. 3/day cap intact, no duplicates.

## Agent utilization
Research (Sonnet) → Architect (Sonnet) → Devil's Advocate (Sonnet, NEEDS REVISION + 3 must-fixes) → Developer (Sonnet, worktree) → QA (Sonnet, SHIP IT + live smoke) → Fix (Sonnet, ISSUE-1/2) → Lint cleanup (Sonnet). Orchestrator reviewed every diff and ran all gates.

## UX research
Skipped — backend/engine + formatting only; no new route/component/visual design. Recorded in PRD header.

## Known limitations / follow-ups
- Stale phantom `durationSec` on pre-fix baseline-mirror rows is left in place (inert — registry forces `distance` primary; display is kind-guarded). A one-off cleanup is optional, not required.
- Registry covenant: any NEW time-to-complete test must be added to `METRIC_KIND_OVERRIDES` or it defaults to higher-better duration (documented in code + gotchas-worthy).
- After deploy, reload the claude.ai connector only if needed — no tool-surface change, so likely unnecessary; `MCP_SERVER_VERSION` bump handles it.
