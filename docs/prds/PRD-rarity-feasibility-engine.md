# PRD: Multi-goal Phase 2 — Rarity/Feasibility Engine + Coach Calibration

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-06-10
**Status**: Approved
**GitHub Issue**: https://github.com/jronnomo/workout-planner/issues/63 (Epic #61)
**Branch**: main
**UX-research**: invoked (background) — tier visual encoding, chip placement, banner treatment. REQ-63-4 waits for findings.

---

## 1. Overview

### 1.1 Problem
Goals enter the stack with no honesty check. Nothing answers "can I reach ALL current goals in their timelines?" — the user's own example: training for Elbert + a 5k, then adding "bench 315 lb" with a recorded 135 PR should scream *near-impossible*, at creation, before false hope calcifies. There is no trajectory math anywhere in the codebase today.

### 1.2 Solution
A deterministic feasibility engine: per dated active goal, **required weekly rate** toward each weighted target (from current value, target value, and weeks remaining) vs **plausible weekly rate** (observed recent trend when ≥3 points exist in a 6-week lookback; otherwise a tunable plausibility-norms table per metric family). Ratio → game tiers **Common / Uncommon / Rare / Epic / Legendary** (higher = harder; Legendary = "near-impossible in the time set"). Stack rating = worst effective goal tier + a bounded concurrent-load bump fed by goal count and Phase-1 cross-goal-conflict density. The claude.ai coach calibrates any goal's tier via a new MCP write tool with a mandatory rationale; the computed tier always displays alongside. Someday goals are unrated and excluded. Warnings fire non-blocking at goal creation in both the app form and MCP paths. Scope also includes the Phase-1 coach-parity tools (`set_goal_tracked`, `set_plan_active`) and `preview_goal_feasibility` (Phase-3 interview dependency, same code path as the creation warning).

### 1.3 Success criteria
- Deterministic: same data ⇒ same tiers; all thresholds/norms in one tunable module with per-value rationales.
- Bench 135→315 in 12 weeks ⇒ Legendary with zero history (norms basis); when history is present the `exercise:<canonical name>` metric reads from workout history via `getExerciseHistory`. Realistic targets ⇒ Common/Uncommon.
- `set_goal_feasibility` validates tier, stores rationale, surfaces in app + read tools; computed never hidden.
- Legendary/Epic stack ⇒ warning banner on /goals and at creation (app + MCP).
- Coach can manage the stack conversationally (track/untrack, pause/resume).

---

## 2. User stories

| ID | As... | I want... | So that... | Priority |
|----|-------|-----------|------------|----------|
| US-1 | Gabe | each dated goal to show a rarity tier and the stack to show one overall | I see at a glance how hard my ambitions are | Must |
| US-2 | Gabe | an explicit warning when a new goal makes the stack Epic/Legendary | expectations are set before the goal lands | Must |
| US-3 | coach | to calibrate a computed tier with a written rationale | the score reflects context the math can't see (injury, life load) | Must |
| US-4 | Gabe | the computed value to stay visible under a coach override | calibration is transparent, never silent | Must |
| US-5 | coach | get_rarity / get_goal / get_game_state to carry feasibility data | I can ground rarity conversations in the same numbers the app shows | Must |
| US-6 | coach | set_goal_tracked + set_plan_active tools | I can act on my own warnings without sending the user to the UI | Must |
| US-7 | coach (Phase 3) | preview_goal_feasibility without creating anything | the intake interview can show would-be rarity pre-commit | Should |

---

## 3. Functional requirements

### 3.1 Core
1. **Engine** (`src/lib/rarity-core.ts` pure + `src/lib/rarity.ts` async) per the approved plan: `RARITY_RULES` tunables (thresholds 0.5/1.0/1.5/2.5; weightFloor 0.1; minWeeksRemaining 1; lookback 6w; minObservedPoints 3; regressionFloorFactor 0.25; ratioCap 99; stack: goalCountBumpAt 3, conflictWindowDays 28, conflictBumpAt 4, maxBump 1) + `FITNESS_NORM_PACK` (strength 1.5%/wk + abs floors {reps .5, lb 2, sec 10, in .25}; endurance-time 1%/wk; weight-loss 1.5 lb/wk; lean-gain 0.5 lb/wk; hikes 1.25/wk; elevation 5000 ft/wk; distance 20 mi/wk; workouts 6/wk; log:* null = observed-only) in `RARITY_NORM_PACKS` with `normPackForGoal` fitness fallback (kind seam, packs not built). Every default documented with a one-line rationale.
2. **Per-goal**: `computeGoalFeasibility(goal)` → `GoalFeasibility { tier|null, unratedReason, ratio, perTarget[], basis, weeksRemaining, computedAt }`. Worst-target-dominates over weight ≥ 0.1 (all-below-floor → highest-weight target); met targets ratio 0; unknown (no norm + no data) excluded; all-unknown ⇒ unrated. Someday ⇒ unrated, zero queries. `weeklySlope` least-squares over per-metric series (units/week); plateau/regression: plausible = 25% of norm; observed ≤ 0 with no norm ⇒ ratioCap.
3. **Stack**: `computeStackRarity({ extraGoal? })` → `StackRarity { tier, baseTier, loadBump 0|1, loadBumpReasons, datedActiveGoalCount, conflictCount28d, perGoal[{computed, coach, effectiveTier}] }`. Effective tier = coach ?? computed (one function). Conflict count via getGoalEventsResult + crossGoalConflicts over the next 28 days. `extraGoal` rates a hypothetical goal into the stack (preview + creation warning share this path).
4. **Storage**: `Goal.coachFeasibility Json?` `{ tier, rationale, assessedAt, assessedBy: "coach" }`; migration `rarity_phase2` (single additive ALTER).
5. **Shared cores**: `setGoalTrackedCore` / `setPlanActiveCore` extracted into `src/lib/goal-core.ts` (guards in core); actions become thin wrappers keeping their revalidatePath sets.
6. **MCP new tools**: `get_rarity` (full StackRarity); `set_goal_feasibility(goalId, tier?, rationale?)` — tier requires rationale, omit tier clears (Prisma.JsonNull), returns coach+computed; `set_goal_tracked(goalId, tracked)`; `set_plan_active(goalId, active)`; `preview_goal_feasibility(targets, targetDate?, kind?)` (creates nothing; reuse update_goal_targets' targets zod shape).
7. **MCP edits**: `list_goals` +`coachFeasibilityTier` (row field only — no computed rarity, stays cheap; description points at get_rarity); `get_goal` +`feasibility { computed, coach }`; `get_game_state` +slim `stackRarity`; `create_goal` +non-blocking `stackWarning` when post-create stack ⇒ epic/legendary.
8. **UI** (structure fixed; visuals per ux-research): `RarityChip` (client-safe, rarity-core import only), `StackRarityCard` (stack chip + load reasons + Epic/Legendary warning banner, Legendary copy: "near-impossible in the time set — talk to your coach or adjust timelines"); /goals stack card + per-row effective-tier chips from ONE computeStackRarity + glossary entry; /goals/[id] feasibility section (computed + coach side-by-side with rationale + per-target table) + `?stackWarning` banner; /character portrait-card stack chip; `createGoal` redirects `/goals/{id}?stackWarning=epic|legendary` when triggered.

### 3.2 Out of scope
Auto-adjusting plans/timelines (coach's job); non-fitness norm packs (seam only); blocking creation; caching/memoization of rarity; rarity history/series; Phase-3 interview UX.

---

## 4. Technical design

Authoritative file-level design: `.feature-dev/2026-06-10-rarity-feasibility-engine/agents/architecture-blueprint.md` (D1–D8). Constraints recap: all date math via `@/lib/calendar` (weeksRemaining from USER_TZ midnights); MCP dates via `parseDateInput`; `safe()` wrappers; zod `.describe()` on new inputs; TS strict; tokens-only styling; server components except where the existing pages already use clients; query budget ~20 per stack computation, computed per request (no cache), /goals + /character one stack computation each.

### Edge cases
| Scenario | Behavior |
|---|---|
| Someday goal | unrated "—", excluded from stack/base/count/bump; zero engine queries |
| No targets / all weights < floor | no-targets ⇒ unrated; below-floor ⇒ fall back to highest-weight target |
| Target already met | verdict "met", ratio 0 |
| log:* target with no data | verdict "unknown", excluded; all-unknown ⇒ unrated |
| Past-due targetDate | weeksRemaining floors at 1 (rates against a 1-week runway) |
| Observed regression | plausible floored at 25% of norm; no norm ⇒ ratioCap |
| Multiple isFocus / no focus | engine independent of focus; stack reads active+status active |
| Coach override on unrated/someday goal | allowed; effectiveTier = coach tier; computed stays null/visible |
| extraGoal preview | same computeStackRarity path as creation warning — no drift |

---

## 5. Acceptance criteria

1. [ ] tsc / lint / build clean
2. [ ] `npx tsx scripts/test-rarity.ts` passes: bench-315⇒legendary; bench-160⇒≤uncommon; weightLb 159→155/10wk⇒common; weight-floor non-domination; below-floor fallback; regression floor; met⇒0; bump + Legendary cap; threshold boundaries (0.5/1.0/1.5/2.5 inclusive)
3. [ ] Migration = one additive ALTER; client regenerated
4. [ ] get_rarity returns full breakdown; per-goal computed+coach+effective
5. [ ] set_goal_feasibility: stores; tier-sans-rationale rejects; omit-tier clears; bad tier fails zod
6. [ ] set_goal_tracked/set_plan_active enforce focus guards via shared cores (error text identical to app actions)
7. [ ] create_goal returns stackWarning for an absurd stack; app form redirects with ?stackWarning and the detail page banners it
8. [ ] preview_goal_feasibility computes without persisting (goal count unchanged)
9. [ ] list_goals: coachFeasibilityTier present, no computed-rarity queries added
10. [ ] /goals: per-row chips + stack card + someday "—" + glossary entry; /character: stack chip; /goals/[id]: computed+coach side-by-side — 390px, both themes, tokens only
11. [ ] All new date math via @/lib/calendar (grep clean)
12. [ ] Ship report reminds: reload MCP connector

---

## 6. Test plan
Gates + self-check script (§5.2) + MCP curl battery (plan §Verification 4) + browser smoke @390px both themes (plan §Verification 5). Live-data sanity: current stack (Elbert dated + 2 someday) ⇒ Elbert rated, stack = Elbert's tier, no bump; temporarily date a skill goal ⇒ stack reflects it.

---

## Revision log (post-DA)

Applied after the Devil's Advocate review of REQ-63-1/2. All changes are surgical and additive.

| Item | File(s) | Resolution |
|------|---------|------------|
| H1 — direction sign normalization | `rarity.ts` `computeGoalFeasibility`, `rarity-core.ts` JSDoc | Normalize slope before passing to `computeTargetFeasibility`: `observedRate = direction==="decrease" ? -rawSlope : rawSlope`; JSDoc asserts the positive-toward-goal convention; test added. |
| H2 — `exercise:*` metric family | `metrics-registry.ts`, `goal-targets.ts`, `rarity.ts`, `rarity-core.ts`, `test-rarity.ts` | Dynamic `exercise:<canonical>` family added; resolves via `getExerciseHistory`; bench test cases migrated to `exercise:Bench Press` (math unchanged). |
| H3 — per-family lookback | `rarity-core.ts` (`RARITY_RULES`, `lookbackWeeksFor`), `rarity.ts` | `observedLookbackWeeks` restructured to `{default:6, baseline:16, exercise:16}`; `lookbackWeeksFor(metric)` exported; `computeGoalFeasibility` uses per-target lookback; test added. |
| M4 — `hike:max_elevation_single` family | `rarity-core.ts` | Separate "hike-max-elevation" family with norm `maxElevationGainFtPerWeek: 500`; "hike-elevation" remains for cumulative total. |
| M5 — `GoalTargetSchema` | `metrics-registry.ts` | Zod schema exported; client-safe; REQ-63-3 adopts for MCP input validation. |
| M7 — `setPlanActiveCore` transaction | `goal-core.ts` | Resume branch `findFirst + updateMany + update` wrapped in `prisma.$transaction`. |
| M8 — extraGoal dedup | `rarity.ts` `computeStackRarity` | `ExtraGoal.id` made optional; when id matches a fetched goal, the fetched copy is removed before injection (enables preview of updated existing goal). |
| M9 — datedActiveGoalCount filter | `rarity.ts` | Explicit comment added confirming `targetDate !== null` filter; code was already correct. |
| L11 — someday-override TODO | `rarity.ts` | TODO comment added near `parseCoachFeasibility` noting MCP description should explain the someday-override caveat; deferred to REQ-63-3. |
| L12 — query-budget comment | `rarity.ts` `observedSeriesFor` | Fixed to "up to 2 per target when the series window is empty". |

## 7. Appendix
Discovery: 2026-06-10 session — decisions: norms table for cold start; coach-parity tools in scope; ux-research opted in; someday unrated; non-blocking creation warning; preview tool now. References: Epic #61, #63; plan file ~/.claude/plans/mighty-hopping-raven.md; Phase-1 PRD + run artifacts; memories: plan-is-conversational, exercise-alias-map (canonicalization caveat for matching goal metrics to history).
