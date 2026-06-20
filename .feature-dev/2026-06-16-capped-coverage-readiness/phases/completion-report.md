# Completion Report — Capped, Coverage-Aware Readiness

**Date:** 2026-06-16 · **Status:** COMPLETE · **Branch:** main · **Iterations:** 1 (build) + 1 QA-fix pass

## What was built
`computeReadiness` is now an honest indicator: untested targets count as **0** (full weight in the denominator) instead of being dropped → no more false-100%. Added **coverage** (`tested/total`) and **gating**: an optional `gating?: boolean` on `GoalTarget`; while any gate is unproven (`progress < 1`, incl. untested) the headline is capped at **GATE_CEILING (80)**; all gates cleared → 100; `score = min(rawScore, ceiling)`. The 80-ceiling is a **safety net** for under-weighted gates — with heavy gates, untested-as-0 already pulls the honest average below 80. `ReadinessSnapshot` extended additively (`.score/.breakdown/.missing` unchanged). Generalizes to every goal.

## Files
| File | Change |
|------|--------|
| `src/lib/metrics-registry.ts` | `gating?: boolean` on `GoalTarget` type + `GoalTargetSchema` zod; `gating:true` on `hike:prep_completion` + `hike:max_elevation_single` in `MT_ELBERT_DEFAULT_TARGETS` |
| `src/lib/readiness.ts` | new scoring (untested=0, coverage, gating cap), `GATE_CEILING=80`, `ReadinessGate` type, additive snapshot, `missing` JSDoc fixed |
| `src/lib/rarity-core.ts` | comment only (no logic change — gating is readiness-only; `current===null` guard stays correct) |
| `src/lib/mcp/tools.ts` | `compute_readiness` description + auto-flowed fields; no-targets branch now spreads an empty snapshot (all fields present); `gating?` noted on update_goal_targets/create_goal |
| `src/lib/recap.ts` | `RecapGoalBlock` gains `coverage` + `openGateCount` |
| `src/lib/recap-card.tsx` | `fmtCoverageLine` + "N/M verified · K gates left" under READINESS (card + SlideOne), fixed-width column (CRIT-1), single-compute (CRIT-2) |
| `src/app/progress/page.tsx` | coverage/gate hint per goal (hidden when total===0) |
| `docs/prds/PRD-capped-coverage-readiness.md` | PRD (AC#12 weight-corrected) |

## Requirements: all 6 DONE. QA verdict MINOR FIXES → 3 fixed (no-targets MCP shape, "uncleared" typo, dead branch).

## Verification
- Engine math read + confirmed: `score = min(rawScore, ceiling)`, untested=0, full denominator, `totalWeight===0` guard returns new fields.
- MCP curl on live focus goal: returns `score/rawScore/ceiling/coverage/gates/openGateCount`; `score === min(rawScore,ceiling)` ✓ (66 = min(66,100)); live goal is 8/8 tested, 0 gates flagged → unchanged.
- Card render: "8/8 verified" line renders cleanly under READINESS, no column widening, ring at 66%, layout balanced, no satori errors.
- tsc 0, lint 0. (Build's static-prerender needs Neon — environmental; routes are force-dynamic.)
- AC#12 (weight-aware): light gate (~0.1) untested + rest 100% → rawScore 90 → score 80 (cap bites); heavy gate (~0.3) → rawScore 70 → score 70 (cap moot). All 8 back-compat consumers clean.

## Post-deploy / coach data steps (NOT code)
1. **Reconnect the goaldmine connector in claude.ai** — `compute_readiness` gained fields + description; `GoalTargetSchema` gained `gating`.
2. **Live Elbert gates:** the score drop from untested-as-0 bites immediately, but the **80-ceiling won't fire on the live goal until the coach sets `gating:true`** on `hike:prep_completion` + `hike:max_elevation_single` via `update_goal_targets` (template flags only affect new goals). Currently the live goal is 8/8 tested with no untested targets, so the number is ~unchanged until gates are flagged or new untested targets are added.
3. **Layer 1 (coach):** re-baseline today's fresh step-down 150 under the new strict-tempo/pre-fatigued protocol.

## UX-research: skipped (recorded in PRD) — additive text line on existing surfaces, no new visual/interactive component.
