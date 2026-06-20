# Completion Report — Recap Card kind-aware (#69)

**Shipped:** main `1e63c0b` (recap-card.tsx) + `d54c2fd` (PRD), pushed. Issue #69 closed, board #8 Status=Done. 1 iteration, 0 rework. **Completes Sprint 6.**

## What was built
The Satori recap card now reads everything kind-aware from one source: `presentationForGoal(recap.goal)` (ring label, header style) + `recap.statSlots` (the stat grid). Added a `StatGrid` helper (chunks slots into rows of 2; `StatCell`/ProgressRing untouched). Removed the now-unused `fmtVolume`/`fmtElevation` imports (the grid uses pre-formatted `slot.value`).

## Files
| File | Change |
|---|---|
| `src/lib/recap-card.tsx` | +79/−85 — 2 ring labels, 2 program-lines, 2 stat grids → registry; new StatGrid |
| `docs/prds/PRD-recap-card-kind-aware.md` | NEW |

## Requirements — all DONE (verified via LIVE Satori render)
Curled `/recap/card?goalId=…` for both goals → 200 `image/png`, 1080×1920, visually inspected:
- **Fitness (Elbert) byte-identical:** READINESS ring 61%, `WEEK 7 · DAY 46 OF 105`, 2×2 `WORKOUTS 4 / VOLUME 5,370 lb / NEW PRs 7 / ELEVATION —` (muted dash), dividers intact.
- **Chewgether project-shaped:** `PROGRESS` ring (empty, `—`), `15 WEEKS TO SEP 30` header, single 2-cell row `MRR —` / `MILESTONES 0/7`.
- Satori renders with no error; flat-array children (no Fragment); inline styles; SVG ring intact.

## Devil's Advocate fix folded in
CRITICAL-1: feed grid replacement started at line **578** (the outer `<div>` opening, multi-line tag), not 584 — avoided orphaned JSX.

## Pipeline
PRD → blueprint → Devil's Advocate (APPROVE-WITH-FIXES) → 1 Sonnet Developer (worktree) → Tech Lead diff review + gates + **live Satori render + visual PNG inspection** → merge → push.

## Sprint 6 status
#67 (registry) + #68 (aggregator) + #69 (card) all shipped. Remaining Sprint 6: #70 (Vitest pin), #71 (QA gate). Then Sprint 7 (Today/progress/legend).

## Follow-up
No MCP surface change → no connector reload. The deployed card updates on the next Vercel deploy.
