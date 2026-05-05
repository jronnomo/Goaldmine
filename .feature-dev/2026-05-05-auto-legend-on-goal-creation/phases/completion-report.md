# Auto-Legend on Goal Creation — Completion Report

**Date**: 2026-05-05
**Status**: PR opened
**Branch**: `feature/auto-legend-on-goal-creation`

## Summary

Closed the goal-creation gap left open by PR #2 (goal-driven legend). Two surfaces:

1. **In-repo**: new `create_goal` MCP tool (count 33→34) that creates Goal + Plan + PlanRevision in one nested write, with optional inline legend. `update_goal_legend` description rewritten with 4 preset legends (hike/strength/running/snowboard), kind glossary, closed-enum warning, and an auto-legend cue. `createGoalCore` helper extracted from the existing server action so both surfaces share one path. Bonus fix: form path now uses `parseDateKey` for USER_TZ-correct dates.

2. **Out-of-repo**: `docs/server-instructions/goaldmine-rules.md` becomes the canonical source for the connector's operating rules; rule 11 added there and to `COACH_INSTRUCTIONS` constant. Paste-ready block lands in the PR description.

## Files

8 files changed, ~370 lines net new code (excluding docs and `.feature-dev/`):

| Area | New | Modified |
|---|---|---|
| Backend | `src/lib/goal-core.ts` | `src/lib/goal-actions.ts`, `src/lib/legend.ts` |
| MCP surface | — | `src/lib/mcp/tools.ts` (added `create_goal`, rewrote `update_goal_legend` description) |
| Operating rules | `docs/server-instructions/goaldmine-rules.md` | `src/app/api/mcp/[token]/route.ts` (appended rule 11 to `COACH_INSTRUCTIONS`) |
| Planning artifacts | PRD, requirements, manifest, research, architecture v1+v2, critique | — |

## Requirements status

All 4 atomic REQs DONE:
- REQ-A1 — `createGoalCore` extracted; form action refactored; `parseDateKey` swap.
- REQ-B1 — `create_goal` MCP tool registered.
- REQ-B2 — `update_goal_legend` description rewritten (1841 chars; 4 presets + closed-enum + auto-legend cue).
- REQ-D1 + D2 — `goaldmine-rules.md` authored; `COACH_INSTRUCTIONS` constant updated.

## Iterations

- 1 architecture revision (Devil's Advocate found 2 blockers + 4 concerns; v2 addressed all).
- 0 development iterations — both dev agents shipped to spec on first pass.

## Agent utilization

| Agent | Role | Outcome |
|---|---|---|
| Research Agent | Codebase recon, 11 sections | Surfaced 4 PRD inaccuracies (tool count, in-repo rules text, rule numbering, stale import); critical for v2 |
| Architect (v1) | File-level blueprint, 309 lines | Stream timeout on first attempt; restarted lean and shipped on retry |
| Devil's Advocate | 11-category critique | 2 blockers, 4 top concerns, all documented with concrete fixes |
| Architect (v2) | 382 lines, all blockers resolved | Surfaced `parseDateKey` not actually validating format — kept NaN guard |
| Dev Agent 1 (Backend) | REQ-A1 + REQ-B1 | DONE; audited `scaffoldPlanFromTemplate(1)` (does not throw); guard left commented |
| Dev Agent 2 (Description + Docs) | REQ-B2 + REQ-D1 + REQ-D2 | DONE; dropped `hybrid-endurance` preset to land under char budget (1841 / 2000) |

## Known limitations / follow-ups

1. `update_goal_legend` description dropped `hybrid-endurance` preset for char-budget. Add later if/when description budget allows (e.g., a future PR compresses other presets).
2. No `delete_goal` MCP tool. Test-goal cleanup during QA went through Prisma directly. Add if it becomes a frequent need.
3. No idempotency on `create_goal` double-submit. Same risk on form. Single-user low-volume app — documented, not blocked.
4. The user must paste rule 11 into the claude.ai → Goaldmine connector → Instructions field. PR description includes the block.

## Next steps

PR open at https://github.com/jronnomo/workout-planner/pull/3. After review + merge:
- Vercel auto-deploys.
- User reloads the Goaldmine MCP connector in claude.ai (tool surface changed).
- User pastes rule 11 into the connector's Instructions field.
