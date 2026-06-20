# Scope Brief — Finish the Multi-Domain Goal Engine

**Stamped:** 2026-06-16 · Planning Lead (Opus) · Source: `docs/roadmap/multi-domain-transformation-brief.md` §3–§5

## The problem
The *engine* is a generic, honest goal platform (`computeReadiness`, feasibility, `log:` metric path all goal-generic). The *app* still looks like a fitness app: recap card stats are `WORKOUTS/VOLUME/PRs/ELEVATION`, the ring says `READINESS`, the header is `Day M of 90`, Today is workout-shaped, the weight chart always renders. A live **project** goal (Chewgether, `kind:"project"`) runs through the same engine but every surface mislabels it. Closing that surface gap = the platform identity.

## Target end-state
Open Chewgether → recap card shows `MRR / Milestones / Paying Subs / Conversion`, ring says `TRACTION`/`PROGRESS`, header reflects the project timeline; Today is project-shaped. Open Elbert → the fitness version. **Same components, content derived from each goal's own targets + a per-kind presentation config.** Feasibility ("is this date a fantasy?") is surfaced honestly on Today/goal/recap. The honesty math is unit-tested.

## In scope (decomposed into sprinted stories)
- **3.1 Goal-kind-aware surfaces** (highest leverage) — recap card, Today, progress, legend, units; driven by a **goal-driven config registry** (per-kind presentation config + content derived from the goal's own targets, NOT hardcoded per vertical).
- **3.2 Feasibility surfacing** — surface the already-computed `get_goal.feasibility` (requiredRate/observedRate/plausibleRate/ratio/verdict/weeksRemaining) honestly. Fix the `tier:null, no-data` path for `log:` metrics (no norm pack) so project goals get a real readout.
- **3.6 Tests on load-bearing math** — Vitest on `computeReadiness`/`progressFor` (gating cap, untested=0, decrease metrics, coverage, edge cases), feasibility, and the recap aggregator.

## In scope (stubbed as Backlog epics, not decomposed now)
- **3.3 Proactive coach** — plan as a **research spike first** (Claude Code scheduled cloud routine vs. cron→MCP read tools→nudge surface). One spike story; decompose later.
- **3.4 Content flywheel** — auto Sunday recap → Instagram. Backlog epic.
- **3.5 Goal onboarding / "goal interview"** — guided first-run that turns a fuzzy goal into gated, weighted, feasibility-rated targets. Backlog epic.

## Non-goals / invariants (§4)
- **Goal-generic always** — no surface hardcodes the focus goal or "Elbert" (memory `goal-progress-bars-are-goal-generic`).
- **Honesty-first** — never reintroduce a path that reads falsely "ready" (no dropping untested, no un-capped gates).
- **No LLM calls in the app** — all reasoning in claude.ai via MCP.
- **MCP is the coach's surface** — new capabilities usually need a read/write tool, not just UI.
- **Satori constraints** for card work (memory `satori-no-conic-use-svg-arc`): inline SVG stroke-dasharray, no conic-gradient, flex-only.
- **USER_TZ via `@/lib/calendar`; Prisma 7 split-config; migrations additive & Neon-safe (shared with prod); Next 16 + Turbopack.**
- Single user today, but design for multi-domain/multi-user.

## Key architectural seams
1. **Presentation config registry** — a per-`goal.kind` config (stat slots, ring label, header style, unit formatters, legend, copy) consumed by recap-card / Today / progress. The seam that turns "fitness app + bolted-on business goal" into "the goal engine."
2. **Stat derivation from targets** — recap stats should derive from the goal's own `targets[]`/metrics + `computeReadiness` breakdown, not a fixed fitness grid.
3. **Feasibility norm/observed path** — `rarity.ts`/`rarity-core.ts`: give `log:` metrics an observed-only feasibility path so project goals stop returning `no-data`.
4. **Today routing** — `page.tsx` already forks to `ProjectTodayView` for `kind:"project"`; flesh that view + generalize the rest-day/recovery copy.

## Driving verticals
- **Vertical #1:** Mt. Elbert (fitness) — must not regress.
- **Vertical #2:** Chewgether (project, `cmqbfseel0000cgdn3oz1uz2u`) — every generic story validated against THIS, not abstracted from fitness alone.

## Materialization
GitHub issues on **Goaldmine Roadmap** project **#8** (`jronnomo/workout-planner`), Status/Priority/Effort/Sprint set. Each story → a `/feature-dev` build.
