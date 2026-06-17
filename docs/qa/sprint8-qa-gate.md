# Sprint 8 QA Gate (#81) — Feasibility surface

**Date:** 2026-06-17 · **HEAD:** `c63473b` · **Verdict: PASS — Sprint 8 deployable, honest, no engine change.**

Sprint 8 = surface the already-computed feasibility honestly (no `rarity-core.ts` change). #77 (component), #78 (Today), #79 (goal page), #80 (get_goal description + coaching doc) shipped; this gate proves the end-to-end honesty behavior.

## AC results
| AC | Result |
|---|---|
| `tsc --noEmit` / `lint` / `build` (integrated) | ✅ 0 errors · clean · green |
| `vitest run` | ✅ 39/39 (incl. 9 FeasibilityReadout fixture tests) |
| MCP `get_goal(Chewgether).feasibility.computed` | ✅ `unratedReason: "no-data"` (honest, unchanged); tier null; 2 perTargets; coach field present |
| MCP `get_goal` description advertises feasibility | ✅ tool count **89 (unchanged)**; description mentions feasibility.computed / unratedReason / requiredRate / observedRate (#80) |
| Browser ≤390px — Chewgether Today + goal page | ✅ honest "Not enough logged data to rate" (live #78/#79) |
| Browser ≤390px — fitness Today + goal page | ✅ feasibility readout shown; fitness Today visually unchanged (live #78) |
| **≥3-MRR-log fixture → real verdict** | ✅ 4 synthetic rising MRR rows → `tier: common`, `basis: observed`, mrr `observedRate: 150`, `rateBasis: "observed"`; **fixture removed → back to `no-data`, 0 rows remaining** |
| **Both no-data sub-states** | ✅ 0-log → `requiredRate: null` (3a); 2-log → `requiredRate: 46.67`, `observedRate: null` (3b) |
| **Guardrail: rarity-core.ts untouched in Sprint 8** | ✅ `git diff 3732f1d..HEAD -- src/lib/rarity-core.ts` = **0 lines** |
| Connector note | ✅ only the get_goal *description* changed (count/names unchanged) → **no claude.ai connector reconnect**; live after the Vercel redeploy |

## Fixture proof (reverted)
A guaranteed-cleanup script inserted synthetic `metric:"mrr"` LogEntry rows (`source:"qa81-fixture"`) into the live Chewgether goal, computed `computeGoalFeasibility`, asserted the transitions, then deleted them and confirmed `unratedReason: no-data` + 0 leftover rows. The real goal is unchanged (0 MRR logs).

## Sprint 8 production scope (since 3732f1d)
`FeasibilityReadout.tsx` (+test), `page.tsx`, `ProjectTodayView.tsx`, `goals/[id]/page.tsx`, `tools.ts` (description only). **No `rarity-core.ts` change** — the honesty engine was surfaced, not modified.

## Note for follow-up
The fact-check DA on #80 was misled by a **stale wrong comment at `rarity-core.ts:405-411`** (claims `log:*` returns 0 at 0 logs; actually `resolveMetricValue` returns `entry?.value ?? null` → null). Disproven by live `computeGoalFeasibility`. Comment cleanup tracked as a separate post-Sprint-8 fix (keeps this guardrail honest).

## Sprint 8 — COMPLETE
#77 ✅ · #78 ✅ · #79 ✅ · #80 ✅ · #81 ✅. Honest feasibility ("is this date a fantasy?") is now surfaced on Today + the goal page for any goal, the coach's `get_goal` advertises it, and the no-data→real-verdict transition is proven — all with zero engine change.
