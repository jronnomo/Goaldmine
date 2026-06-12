# Issues — Iteration 1

**Converged in one iteration. No fix pass required.**

- QA agent verdict: SHIP IT (qa-report.md). All REQ-001..005 ACs PASS.
- Gates: `npx tsc --noEmit` 0 errors · `npm run lint` clean · `npm run build` success.
- Live smoke (qa-runbook.md executed by orchestrator, dev server :3199): 29/29 assertions pass.
  - Two initial script-side assertion bugs (not product bugs), corrected and re-verified:
    1. `create_goal` response carries `goalId`/`message` (no `kind` field — pre-existing shape, out of scope). Goal kind=project proven via list_goals (`kind: "project"` exposed) and the kind-gate on schedule_item.
    2. `list_goals` returns a raw array, not `{goals: []}` — assertion fixed; fitness focus intact, test goal gone.
- DB left as found: 0 orphan ScheduledItems/LogEntries for the test goal; fitness goal (cmopuj97x…) isFocus=true.

## Deferred (non-blocking, noted for future)
1. `schedule_item` / `log_metric` create calls fetch full row incl. payload Json (no `select`) — micro-optimization only.
2. tools.ts helper import sits mid-file at the old definition site — cosmetic.
3. Roadmap board item #47 ("E-7 set_active_goal") is marked Done but no such MCP tool exists — board hygiene; focus switching remains app-UI (`setFocusGoal`) + direct DB for ops.
