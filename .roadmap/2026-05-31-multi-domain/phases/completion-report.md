# Completion Report — Multi-Domain Goal Engine roadmap

**Date:** 2026-05-31 · **Board:** https://github.com/users/jronnomo/projects/8 · **Repo:** jronnomo/workout-planner

## Outcome
Planned the multi-domain initiative end-to-end and materialized a **39-story, 5-sprint backlog** onto board #8 (39 issues created, 0 failed), each with Status=Todo + Priority + Effort + Sprint set. Building is now `/feature-dev`, one story at a time.

## Deliverables
- `docs/roadmap/multi-domain-plan.md` — the approved architecture plan (+ §7 Architect/critique resolutions).
- `.roadmap/2026-05-31-multi-domain/` — scope brief, agent outputs (plan-blueprint, plan-critique, 5 story files, backlog-critique), `coordination/backlog.json`, `phases/materialize-log.md`.

## Process
Architect → Devil's Advocate hardened the plan (caught the `goalId` metric cascade, the Program-vs-Goal Today gap, the closed legend enum). 5 parallel Story Decomposers → 33 stories; Backlog Critic found 17 gaps (the `create_goal` deactivation landmine, field-enum mismatches, missing token/regression/docs/QA stories) → normalized to 39.

## Sprint plan
| Sprint | Epic | Stories | Leaves main deployable |
|---|---|---|---|
| 1 | Generic data spine | 5 | yes — additive migration, fitness untouched |
| 2 | Project MCP tool pack | 8 | yes — new typed tools, fitness pack unaffected |
| 3 | GitHub integration | 7 | yes — read/sync tools, token server-side |
| 4 | Goal-type-aware UI | 8 | yes — branches on kind, fitness byte-identical |
| 5 | Chewgether MVP + coaching | 7 | yes — seeds the real goal + prompt routing |
| Backlog | deferred non-goals | 4 | self-serve planner, fitness convergence, finance, multi-tenancy |

## Critical path
A1 (additive migration) → A2 (`goalId` cascade) → A3 (`log:*` metrics) → B-1 (project-pack scaffold) → C-1 (GitHub scaffold) + D1 (active-context resolution) → E (chewgether). A1 unblocks the entire initiative; `set_active_goal` (now Sprint 2) must land before the chewgether goal is seeded.

## Next step
Start Sprint 1: `/feature-dev "Add ScheduledItem, LogEntry, Goal.kind, and Goal GitHub-link fields via additive Prisma migration"`.
