# Completion Report — Epic B: Project MCP Tool Pack (chewabl Sprint 2)

**Status**: Complete · 1 iteration · direct-to-main
**Roadmap issues**: #24 #25 #26 #27 #28 #29 (closed on ship)

## What was built
The 7-tool project pack making non-fitness goals plannable/trackable via MCP:
`schedule_item`, `delete_scheduled_item`, `complete_item`, `update_scheduled_item`, `list_scheduled_items`, `log_metric`, `list_log_entries` — in a new module `src/lib/mcp/tools/project-tools.ts` registered from `registerAll()`. Shared helpers (`safe`, `jsonResult`, `errorResult`, `parseDateInput`) extracted to `src/lib/mcp/tool-helpers.ts` for this and future packs (Epic C GitHub pack). `get_today_plan` gains an additive `todayItems` field (today's ScheduledItems when the focus goal is `kind='project'`; always `[]` for fitness — zero regression, zero extra query on the fitness path). Tool surface: 75 → 82.

## Files
| File | Change |
|------|--------|
| `src/lib/mcp/tool-helpers.ts` | NEW — extracted shared helpers |
| `src/lib/mcp/tools/project-tools.ts` | NEW — 7 project tools (627 lines) |
| `src/lib/mcp/tools.ts` | helper import swap · registerProjectTools wiring · get_today_plan todayItems |
| `docs/prds/PRD-epic-b-project-tools.md` | NEW — PRD (UX-research: skipped — backend-only) |
| `.feature-dev/2026-06-12-epic-b-project-tools/**` | run artifacts (requirements, blueprints v1/v2, critique, research, QA report+runbook, merge log) |

## Requirements
REQ-001..005: DONE (QA verdict SHIP IT). REQ-006 (B-6 QA gate): executed live — 29/29 assertions; test project goal created → smoked → deleted (cascade verified, 0 orphans); fitness focus restored.

## Agent utilization
Research (Sonnet) → Architect (Sonnet) → Devil's Advocate (Sonnet, NEEDS REVISION: 2 critical + 2 high) → Architect v2 (all critique items resolved; 12 adopted, 1 rejected with reason) → Dev A + Dev B (Sonnet, parallel worktrees, clean merges) → QA (Sonnet, SHIP IT). Devil's Advocate catch of note: C-1 — a tool description that would have routed claude.ai to `delete_workout` when a user completed a fitness item via the wrong tool.

## UX-research ledger
N/A — skipped (pure MCP/backend), recorded in PRD header per invocation contract.

## Known limitations / follow-ups
1. No MCP focus-switching tool (board #47 mislabeled Done) — flip focus via app UI; ops via direct DB. Consider a real `set_active_goal` tool in Epic E.
2. `schedule_item`/`log_metric` creates lack `select` (fetch payload Json unnecessarily) — micro-opt.
3. claude.ai connector reload required: tool surface changed (75 → 82).
