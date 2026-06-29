# Multi-domain goal-path hardening — plan

**Date:** 2026-06-28 · **Board:** #8 (jronnomo/workout-planner) · **Status:** plan for approval

## Context / scope lock

The multi-domain goal path already shipped — board #8 Sprints 1–5 are all Done (ScheduledItem/LogEntry models, project tool pack, GitHub tools, ProjectTodayView, Chewgether MVP). This plan is a **post-launch hardening pass**: six findings from the 2026-06-28 live multi-goal stress test, where three non-fitness goals (guitar = cumulative, senior-role = multi-target + gate, side-income = pure MRR) were created, focused, and viewed end-to-end. The data model and readiness **engine** are generic and correct; the seams are in **metric semantics**, the **feasibility-tier display**, and the **kind-awareness of the daily read tool**.

### Non-goals
- No new Prisma models or migrations (the spine exists).
- Do **not** rebuild what works: ProjectTodayView layout, readiness SCORE + hard-gate math, cross-goal awareness (otherGoalEvents/crossGoalConflicts), rarity stack overload.
- No new Sprint option on board #8 — reuse empty Sprints 7/8/9 (creating an option regenerates all single-select option IDs and wipes the 29 existing item assignments; known gotcha).

## The four seams → epics

| Epic | Seam | Findings | Core files |
|---|---|---|---|
| Generic metric semantics | `log:` resolution is snapshot-only; no LogEntry delete | 1 | goal-targets.ts, metrics-registry.ts, rarity.ts |
| Coherent feasibility / Reach | tier ignores coach override + gates | 2, 3 | FeasibilityReadout.tsx, readiness.ts, rarity-core.ts |
| Kind-aware daily read | get_today_plan not kind-aware | 4 | mcp/tools.ts, calendar.ts |
| Project UX polish | someday mislabel; MRR-specific hero bar | 5, 6 | mcp/tools.ts, ProjectTodayView.tsx |

## Key design decisions (to harden in critique)

1. **Cumulative flag — two bugs, not one (A1 is a Large).** The guitar-Epic mistier has two independent causes: `resolveMetricValue` returns the *latest* entry (wrong current value) **and** the rarity rate path builds a per-entry slope of roughly-flat session values ≈ 0 → no norm for `log:` → ratio-capped to epic/legendary. Summing fixes only the first. Fix the rate by **routing cumulative `log:` into the existing weekly-cumulative-snapshot branch** (the one `hike:`/`workout:count` already use — it samples `resolveMetricValue` at week boundaries, so once that SUMs, the slope is the weekly accumulation rate for free). The flag goes on `GoalTarget` **and must be added to `GoalTargetSchema` (zod)** — that schema gates five write tools, so without it the coach can't set the flag. `targets` is a JSON column → no Prisma migration, but the **existing guitar row needs a `cumulative:true` backfill** via `update_goal_targets` (a type edit alone doesn't touch stored JSON).

2. **Tier floor on an *unrated* decisive gate (not "open").** Scoped rule: a target with `gating===true && verdict==='unknown'` (no data) floors the goal tier no easier than `rare`. This is derivable purely from `perTarget` + the `gating` flag (currently dropped before `aggregateGoalTier` sees it) — **no Prisma, no readiness.ts coupling**, keeping B2 a clean Medium. A *rated* gate (even progress<1) does **not** cap — that "open gate" variant is a separate decision, deliberately excluded. Provably safe for Elbert: its `hike:prep_completion` gate always returns a count + norm, so it's never unrated and never triggers the floor. The floor fires only on zero-data project gates like offers-in-hand — exactly the target.

3. **effectiveTier on display.** Reuse the existing `effectiveTier = coach?.tier ?? computed` from rarity-core. `FeasibilityReadout` gains an optional coach-override prop; Today + goal pages pass it through. No engine change — purely surfacing what `get_rarity` already computes.

4. **Kind-aware payload, backward-compatible.** `get_today_plan` adopts the same guard as `page.tsx:46`. Project focus → project-shaped payload, fitness firehose omitted/nulled. Keep the deprecated `activeGoal` duplicate + saved-prompt fields for one release. Fitness payload must be byte-for-byte unchanged.

## Sprint placement

All eight stories go into **one** reused bucket — **Sprint 9 – Honesty-math tests** (option id `1e5fcc34`) — priority-ordered. Rationale: a single coherent hardening pass reads better than scattering P1 work into "Sprint 8" while P2/P3 sit in the lower-numbered "Sprint 7"; and it avoids creating a new Sprint option (the API edit regenerates all single-select option IDs and would wipe the 29 existing item assignments — known gotcha). The legacy bucket name is imperfect for C1/D2 but is reusable safely; rename it in the GitHub **web UI** later if desired (UI rename preserves the option id; the API mutation does not).

**Execution order (by Priority, not sprint):** A1 → B1 → B2 → C1 → A2 → V1 → D2 → D1.
**Critical path:** A1 (cumulative current value + rate) → B2 (shares rarity files; serialized) → V1 (verifies guitar tier + senior-role gate). B1 is display-only and parallel-safe.

See `coordination/backlog.json` for the eight stories with acceptance criteria, effort, deps, and field IDs.
