# Issues — iteration 1

## Gates (Tech Lead, on integrated main working tree)
- `npx tsc --noEmit` → **0 errors**
- `npm run lint` → **clean**
- `npm run build` → **success** (all routes incl. `/api/mcp`)
- `prisma generate` → client exports `LogEntry` + `ScheduledItem`

## QA Agent verdict: **SHIP IT**
All static requirements PASS (REQ-001..004). REQ-005 live gates handled by TL (below). No `any`/`@ts-ignore`; zero raw-date-method matches in changed app code.

## Live smoke (Tech Lead, dev server + MCP curl)
- `get_today_plan.activeGoal` → `{ kind: "fitness", objective: "Summit Mt. Elbert…", githubRepo: null }` ✓
- `list_goals` → `kind` present on every goal (both `fitness`) ✓
- **create_goal kind="project" smoke** → returned goalId; `get_goal` confirmed `kind="project"` ✓
- **Revert** (plain `prisma.$transaction` script, NOT setActiveGoal) → deleted smoke goal, reactivated Mt. Elbert goal + plan ✓
- Post-revert `get_today_plan.activeGoal` → Mt. Elbert active again ✓
- `Goal.kind` counts: `{ fitness: 2 }` (both existing rows backfilled) ✓
- `LogEntry` + `ScheduledItem` tables exist + queryable (0 rows) ✓
- `/stats`, `/progress`, `/goals/[id]` → HTTP 200, no runtime errors ✓

## Byte-identical fitness readiness
Established structurally: every fitness metric query (weightLb, baseline:*, hike:*, workout:count) is character-for-character unchanged; `goalId` is added-but-ignored on those branches (`void goalId`). No code path lets a fitness goal's score change. Pages render clean.

## Issues found: NONE — no iteration required.

## Follow-ups (logged, not blocking)
- Cleanup ticket candidate (A4): `get_today_plan` issues a dedicated `prisma.goal.findFirst` for `activeGoal` even though `resolveDay` already loads the active goal. Acceptable for Sprint 1 (one indexed single-row read). Could be folded into `resolveDay` later (would touch shared `calendar.ts`).
