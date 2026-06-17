# Backlog — Finish the Multi-Domain Goal Engine

Materialized on **Goaldmine Roadmap board #8** (`jronnomo/workout-planner`), issues **#67–#91**. Source design: `docs/roadmap/multi-domain-goal-engine-plan.md`. Each story = one `/feature-dev` run.

## Sprint 6 — Presentation registry + recap card

| # | Story | Effort | Priority | Depends on |
|---|---|---|---|---|
| #67 | Create the pure goal-presentation registry module with fitness and project entries and hoisted formatters | Small | P0 - Critical | — |
| #68 | Add statSlots, resolveStatSlot, gated project fetch, and weeks-to-target header fields to computeWeeklyRecap | Medium | P0 - Critical | Create the pure goal-presentat… |
| #69 | Drive recap-card ring labels, headers, and stat grids from the presentation registry | Medium | P0 - Critical | Create the pure goal-presentat…, Add statSlots, resolveStatSlot… |
| #70 | Add Vitest coverage pinning fitness statSlots byte-identical and project MRR/milestones slots | Small | P1 - High | Add statSlots, resolveStatSlot…, Drive recap-card ring labels, … |
| #71 | Sprint 6 QA: typecheck, build, MCP recap shape, and 390px render for fitness and Chewgether | Small | P1 - High | Drive recap-card ring labels, …, Add Vitest coverage pinning fi… |

## Sprint 7 — Today + progress + legend kind-awareness

| # | Story | Effort | Priority | Depends on |
|---|---|---|---|---|
| #72 | Drive Today rest-day copy from presentation.restCopy instead of hardcoded Mt. Elbert text | Small | P1 - High | Create the pure goal-presentat… |
| #73 | Route legend.ts resolveLegend kind selection through presentation.legendDefault | Small | P1 - High | Create the pure goal-presentat… |
| #74 | Gate the progress-page weight chart on weight-target presence and render an MRR trend for project goals | Medium | P1 - High | Create the pure goal-presentat… |
| #75 | Add a fitness counterpart coaching doc (docs/coaching/fitness-goal-prompts.md) | Small | P2 - Medium | — |
| #76 | Sprint 7 QA — fitness un-regressed + project surfaces correct at 390px (Today, progress, legend) | Small | P1 - High | Drive Today rest-day copy from…, Route legend.ts resolveLegend …, Gate the progress-page weight …, Add a fitness counterpart coac…, Update project-goal-prompts.md… |
| #89 | Update project-goal-prompts.md for the kind-aware recap card and Today/progress project surfaces | Small | P2 - Medium | — |

## Sprint 8 — Feasibility surface

| # | Story | Effort | Priority | Depends on |
|---|---|---|---|---|
| #77 | Build the goal-generic FeasibilityReadout server component | Medium | P0 - Critical | — |
| #78 | Surface FeasibilityReadout on Today (fitness hero + ProjectTodayView) | Medium | P1 - High | Build the goal-generic Feasibi… |
| #79 | Surface FeasibilityReadout on the goal detail page | Small | P1 - High | Build the goal-generic Feasibi… |
| #80 | Advertise feasibility in get_goal's description and update the coaching doc | Small | P2 - Medium | — |
| #81 | Verify the feasibility surface end-to-end across both verticals with no engine change | Small | P1 - High | Build the goal-generic Feasibi…, Surface FeasibilityReadout on …, Surface FeasibilityReadout on …, Advertise feasibility in get_g… |

## Sprint 9 — Honesty-math tests

| # | Story | Effort | Priority | Depends on |
|---|---|---|---|---|
| #82 | Unit-test progressFor + computeReadiness: gating ceiling 80, untested=0, coverage, decrease, already-met, build-from-zero | Medium | P1 - High | — |
| #83 | Unit-test computeTargetFeasibility: log: observed path (>=3pts), <3pts unknown, met-check, ratioCap stall, decrease-sign | Medium | P2 - Medium | — |
| #84 | Unit-test the goal-presentation registry: per-kind config + __default__ fallback | Small | P2 - Medium | Create the pure goal-presentat… |
| #85 | Unit-test resolveStatSlot + recap statSlots derivation per kind (fitness byte-identical, project —/0/7) | Medium | P2 - Medium | Create the pure goal-presentat…, Add statSlots, resolveStatSlot… |
| #91 | Sprint 9 QA — full Vitest suite green + build, no production code modified by the test sprint | Small | P2 - Medium | Unit-test progressFor + comput…, Unit-test computeTargetFeasibi…, Unit-test the goal-presentatio…, Unit-test resolveStatSlot + re… |

## Backlog

| # | Story | Effort | Priority | Depends on |
|---|---|---|---|---|
| #86 | SPIKE: Proactive coach mechanism (scheduled routine vs. cron→MCP→nudge) | Medium | P2 - Medium | — |
| #87 | EPIC: Close the content flywheel — auto Sunday recap → Instagram | Large | P3 - Low | — |
| #88 | EPIC: Goal onboarding / the 'goal interview' for any domain | Large | P3 - Low | — |
| #90 | DEFERRED: Goal.presentation Json? per-goal label-override seam (no schema change in Sprints 6-9) | Small | P3 - Low | — |
