# Sprint 6 QA Gate (#71) — Presentation registry + recap card

**Date:** 2026-06-17 · **HEAD:** `846592c` · **Verdict: PASS — Sprint 6 deployable, fitness un-regressed.**

Sprint 6 = goal-kind-aware recap card driven by one presentation registry. Stories #67 (registry), #68 (aggregator), #69 (card), #70 (tests) all shipped; this gate validates the integrated result.

## AC results
| AC | Result |
|---|---|
| `tsc --noEmit` | ✅ 0 errors |
| `npm run build` | ✅ green (Turbopack; all routes incl. `/recap/card`, `/recap/story/[slide]`) |
| eslint (4 Sprint-6 files) | ✅ clean (repo-wide 12k baseline is pre-existing, none in scope) |
| `vitest run` | ✅ 20/20 (10 food-units + 10 goal-presentation) |
| MCP `tools/list` | ✅ 89 tools |
| MCP `weekly_summary_data` (fitness) | ✅ returns its normal shape (unaffected) |
| MCP `generate_recap_card` (fitness) | ✅ payload has the 4 legacy fields intact: `workoutsCompleted:4, volumeLb:5370, prCount:7, hikeElevationFt:null`; `statSlots:4`; header `programWeek:7, weeksToTarget:null` |
| Fitness OG render | ✅ 200 image/png — `READINESS` ring, `WEEK 7 · DAY 46 OF 105`, 2×2 `WORKOUTS 4 / VOLUME 5,370 lb / NEW PRs 7 / ELEVATION —` (byte-identical) |
| Chewgether OG render | ✅ 200 image/png — `PROGRESS` ring, `15 WEEKS TO SEP 30`, 2-cell `MRR —` / `MILESTONES 0/7` |
| Satori no-error (both goals) | ✅ all 4 renders (2 cards + 2 story slides) 200 image/png; flex-only, SVG stroke-dasharray ring intact |
| Scope = only Sprint-6 files | ✅ `git diff ff425cf..HEAD -- src/` = exactly `goal-presentation.ts`, `goal-presentation.test.ts`, `recap.ts`, `recap-card.tsx` |

## Notes
- `weekly_summary_data` is a distinct older tool (raw weekly summary), not the recap bundle; the "4 legacy fields" AC is satisfied by `generate_recap_card`'s WeeklyRecap payload, verified intact.
- No production code changed for this gate (verification-only).
- No MCP tool surface change across Sprint 6 → no claude.ai connector reload required.

## Sprint 6 — COMPLETE
#67 ✅ · #68 ✅ · #69 ✅ · #70 ✅ · #71 ✅. A project goal now renders a genuinely project-shaped recap card from the same engine; fitness is byte-identical and test-pinned. Next: Sprint 7 (Today + progress + legend kind-awareness).
