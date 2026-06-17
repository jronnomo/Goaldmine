# Sprint 7 QA Gate (#76) — Today + progress + legend kind-awareness

**Date:** 2026-06-17 · **HEAD:** `dc5f5b7` · **Verdict: PASS — Sprint 7 deployable, fitness un-regressed, project surfaces correct.**

Sprint 7 = the registry-driven kind-awareness sweep across Today, progress, and the legend, plus the coaching docs. Stories #72/#73/#74/#75/#89 shipped; this gate validates the integrated result for BOTH the fitness focus goal (Elbert) and a project goal (Chewgether — verified live via a temporary, reverted focus flip).

## AC results
| AC | Result |
|---|---|
| `tsc --noEmit` | ✅ 0 errors |
| `npm run lint` (Sprint 7 files) | ✅ clean (page.tsx, progress/page.tsx, legend.ts + tests) |
| `npm run build` | ✅ green (SSR for `/` and `/progress`) |
| `vitest run` | ✅ 30/30 (food-units + goal-presentation + legend) |
| Scope = Sprint 7 files only | ✅ `git diff 846592c..HEAD -- src/` = page.tsx, progress/page.tsx, goal-presentation.ts(+test), legend.ts(+test), layout.tsx (meta de-hardcode) |
| **Fitness Today** (focus=Elbert) | ✅ 200; rest-tip correctly gated (not a rest day today); no "Elbert" in rest context |
| **Fitness /progress** | ✅ 200; Weight card + WeightChart + Current/Start/Δ stats present (un-regressed); no MRR trend |
| **Fitness legend** | ✅ resolveLegend(fitness)→DEFAULT_LEGEND byte-identical (legend.test.ts, #73); no change to the fitness legend path |
| MCP `get_today_plan` cross-check | ✅ activeGoal.kind=fitness — UI and MCP agree |
| **Project Today** (focus=Chewgether, live) | ✅ 200; **no Mt. Elbert rest-day tip**; project-shaped (ProjectTodayView: MRR + milestone + scheduled items) |
| **Project /progress** (live) | ✅ 200; **no Weight card**; **MRR Trend card** + "No MRR logged yet" honest placeholder; **MilestoneBurnDown** present |
| **Project legend** | ✅ resolveLegend(project)→PROJECT_DEFAULT_LEGEND (legend.test.ts, #73, deterministic) |
| Weight chart gates on weight-target, not kind | ✅ Elbert (weightLb target)→card renders; Chewgether (no weightLb)→no card |
| No production code modified by QA | ✅ verification only — a DB focus flip was made and **reverted** (focus confirmed back on Elbert via MCP); no code change |

## Focus-flip safety note
The project Today/progress pages read the focus goal (no `goalId` param), so the live walk required Chewgether briefly in focus. Done in a single script with a guaranteed revert (`trap` on EXIT + explicit revert); post-flip MCP `get_today_plan` confirmed `activeGoal.kind=fitness`. The fitness daily prescription was suspended only for the ~30s render window.

## Sprint 7 — COMPLETE
#72 ✅ · #73 ✅ · #74 ✅ · #75 ✅ · #89 ✅ · #76 ✅. Every user-facing surface (recap card [Sprint 6], Today, progress, legend) is now goal-kind-aware from one registry; fitness is byte-identical and test-pinned; project goals render correctly. Next: Sprint 8 (Feasibility surface).
