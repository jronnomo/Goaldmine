# Roadmap: Finish the Multi-Domain Goal Engine

**Author**: Claude (Planning Lead) + Gabe
**Date**: 2026-06-16
**Status**: Approved (hardened by Plan Architect + Devil's Advocate, 2026-06-16)
**Board**: Goaldmine Roadmap (#8)
**Source brief**: `docs/roadmap/multi-domain-transformation-brief.md` §3–§5

## 1. Problem & End-State
The engine is goal-generic; the surfaces are fitness-shaped. `computeReadiness` (`src/lib/readiness.ts`), feasibility (`src/lib/rarity.ts` / `rarity-core.ts`), and the `log:` metric path (`src/lib/goal-targets.ts`) already score any numeric goal. But:
- `src/lib/recap-card.tsx:609–649` hardcodes a `WORKOUTS / VOLUME / PRs / ELEVATION` stat grid; the ring says `READINESS` (line 426); the header is `WEEK n · DAY m OF 90` (line 306).
- `src/app/page.tsx:252–253` hardcodes a Mt. Elbert rest-day tip; `ProjectTodayView` exists (line 44–46) but is thin.
- `src/app/progress/page.tsx:177–202` always renders the weight chart regardless of `goal.kind`.
- Feasibility returns `tier:null, unratedReason:"no-data"` for `log:` metrics because `FITNESS_NORM_PACK` has no norm for `log:*` and there's no observed-only fallback (`rarity-core.ts:332`).

**End-state:** open Chewgether (`kind:"project"`) → recap card shows `MRR / Milestones / Paying Subs / Conversion`, ring says `TRACTION`, header reflects the project timeline; Today is project-shaped; feasibility reads honestly ("at your pace you hit ~62% by Sept 30 — stretch"). Open Elbert → the fitness version. **Same components, content derived from each goal's own `targets[]` + a per-kind presentation config.** The honesty math is unit-tested.

## 2. Driving Vertical(s)
1. **Mt. Elbert** (fitness) — must not regress; the fitness surfaces stay pixel-identical.
2. **Chewgether** (`kind:"project"`, id `cmqbfseel0000cgdn3oz1uz2u`, gated MRR + 7 GitHub milestones) — every generic decision validated against THIS, not abstracted from fitness alone.

## 3. Non-Goals
- No new goal *kinds* beyond `fitness`/`project` this initiative (creative/etc. later — but the registry must not preclude them).
- No goal onboarding/interview build (3.5 stays a Backlog epic).
- No proactive-coach build (3.3 is a research spike only).
- No content-flywheel automation (3.4 Backlog epic).
- No multi-user auth work; design generalizes but single-user stays.
- No LLM calls added to the app.

## 4. Target Architecture

### 4.1 Data model (Prisma)
**Default: no schema change.** The presentation config is **code**, not data — a per-kind registry module. Goal content derives from existing fields (`Goal.targets`, `Goal.kind`, `Goal.legend`, `LogEntry`, `ScheduledItem`). If any per-goal label override proves necessary (e.g. a custom ring label), add a **nullable** `Goal.presentation Json?` later as an additive migration — explicitly deferred, not in the first sprints. Migrations stay additive & Neon-safe per `.claude/quality-tools.md`.

### 4.2 Presentation config registry (the core seam)
New **pure, client-safe** module `src/lib/goal-presentation.ts` (no Prisma / no `@/lib/calendar` / no Node built-ins — same purity class as `rarity-core.ts`, so Satori JSX and server components can both import it):
- `presentationForGoal(goal): GoalPresentation` — resolves a config from `goal.kind`. Unknown/null kind falls back to a `__default__` clone of fitness (matches existing `goal.kind ?? "fitness"` defaulting in `recap.ts`/`legend.ts`), *labeled* `__default__` so it is never mistaken for "fitness is the universal default."
- `GoalPresentation` = `{ kind, ringLabel, headerStyle, statSlots: StatSlot[], restCopy: string|null, legendDefault }`.
- `StatSlot` = `{ key, label, source: StatSource, format }`. The registry **declares** slots (where the value comes from); it does **not** fetch. `source` is a declarative union — `recapField` (fitness, byte-identical), `logLatest` (LogEntry latest by metric key), `scheduledItem` (ScheduledItem aggregate), `targetCurrent` (computeReadiness breakdown). **No closures, no DB in the registry.**
- **Slots are data-backed only — NOT a fixed grid.** Fitness = WORKOUTS/VOLUME/PRs/ELEVATION (4 `recapField` slots). Project = **MRR + MILESTONES only** (2 slots) — verified the only two with live backing on Chewgether (Subs/Conversion have no target, no LogEntry metric, no query; adding them = re-hardcoding a *business* vertical exactly as fitness was hardcoded). The card renders a 2-slot row or a 2×2 by length. Extra project slots light up automatically when the user adds `log:` targets — a one-line config add.
- `ringLabel`: fitness `READINESS`, project **`PROGRESS`** (not `TRACTION` — that re-narrows the engine to startups, the same anti-vertical sin).
- **Formatters** (`fmtVolume`/`fmtElevation`) hoist out of `recap-card.tsx:17–23` into the pure module so the card and `resolveStatSlot` share one formatter (byte-identical fitness).
- Consumed by `recap-card.tsx`, `recap.ts` aggregator, `page.tsx` (Today), `progress/page.tsx`, `legend.ts`.

### 4.3 Recap aggregator generalization (`src/lib/recap.ts`)
`computeWeeklyRecap` keeps its four legacy fields (`workoutsCompleted/volumeLb/prCount/hikeElevationFt` — MCP `generate_recap_card` + highlight logic still read them) and **gains** `statSlots: ResolvedStatSlot[]` via a new `resolveStatSlot(slot, ctx)` that switches on `slot.source.from` over already-fetched data.
- **Fetch order fix (DA):** the focus goal is fetched *inside* the current `Promise.all`, so `goal.kind` is unknown until it resolves. Restructure to **goal-first fetch → resolve presentation → single gated `Promise.all`** that only runs project queries (`logEntry.findFirst` for MRR, `scheduledItem.groupBy` for milestone done/total) when the presentation declares them.
- **Milestones source from ScheduledItem aggregate, NOT `log:milestones_done`.** The recap is a factual week summary — it shows live scheduled/done (0/7), matching `MilestoneBurnDown`. The readiness *ring* still reads `log:milestones_done` (the honest "you haven't logged it, so it doesn't count toward score") — do not merge the two truths.
- **Fitness path byte-identical:** fitness slots resolve from the same `recapField`s the card reads today → identical strings + `isNull` flags. Enforce with a snapshot test.

### 4.4 Feasibility surfacing (3.2 — surface-only, no engine change)
- **The engine already works.** `computeTargetFeasibility` (`rarity-core.ts:458–487`) already has an observed-only path for null-norm families: ≥3 logged points + positive slope → real `ratio`/`verdict` (`basis:"observed"`); ≤0 slope → honest "stalled = fantasy"; <3 points → honest "unknown / not enough data." Chewgether's `no-data` today is **correct** (0 LogEntry rows — you can't slope nothing), not a bug. **Decision: keep `minObservedPoints=3` globally — do NOT special-case `log:` to 2** (a 2-point slope is a dishonest confidence signal). **No `rarity-core.ts` change.**
- **No new read tool.** `get_goal.feasibility.computed` already returns the full per-target `{requiredRate, observedRate, plausibleRate, rateBasis, ratio, verdict, countsTowardTier, currentValue}` + `weeksRemaining` (`tools.ts:896–910`). Near-free win: `get_goal`'s tool *description* never advertises feasibility — add one sentence (coach discoverability).
- **Surface it:** a goal-generic **`FeasibilityReadout` server component** (`src/components/`) that calls `computeGoalFeasibility(goal)` directly server-side (same fn `get_goal` calls — never an MCP round-trip from the app; the two can't diverge). Renders honest states from any `GoalFeasibility`:
  1. `someday` → "No deadline set — feasibility unrated."
  2. `no-targets` → "Add targets to rate feasibility."
  3. `no-data` — **two sub-states (DA fix):** *0 logs* → "Not enough logged data to rate — log MRR a few times." (`requiredRate` is also `null` here because `log:` is not build-from-zero — `currentValue` is null at 0 logs); *1–2 logs* → `requiredRate` shows ("needs $66/wk to hit $1,000 by 9/30") but `observedRate` = "—, not yet estimable."
  4. `tier` set → full honest readout: per-target requiredRate vs observedRate, weeksRemaining, verdict tier, basis.
- Placed on Today (both fitness hero + `ProjectTodayView`) and the goal page. Not Satori — a normal Tailwind DOM component.

### 4.5 UI seams
- **Today (`page.tsx`)**: flesh `ProjectTodayView` (milestone burn, next scheduled items, MRR trend, feasibility readout) and replace the hardcoded rest-day copy (line 252–253) with `presentation.restCopy ?? genericRestCopy`. Server-component-first; USER_TZ via `@/lib/calendar`.
- **Progress (`progress/page.tsx`)**: gate the weight chart on `kind:"fitness"` (or "has weightLb target"); render a project-appropriate trend (MRR over time) for project goals.
- **Recap card (`recap-card.tsx`)**: drive stat grid + ring label + header from `presentation`. Honor Satori constraints (memory `satori-no-conic-use-svg-arc`): SVG stroke-dasharray ring, flex-only, no CSS vars.
- **Legend (`legend.ts`)**: `DEFAULT_LEGEND` becomes per-kind via the registry.

### 4.6 Coaching / prompt
- Update `docs/coaching/project-goal-prompts.md` (and add a fitness counterpart if missing) so the coach knows which surfaces/feasibility readouts exist.
- No new tool *kinds* required for 3.1/3.2; confirm `preview_goal_feasibility` description is keyword-rich/discoverable.

### 4.7 Tests (3.6)
- Vitest (already landed: `food-units.test.ts`) on: `computeReadiness`/`progressFor` (gating cap → ceiling 80, untested=0, decrease metrics, coverage {tested,total}, already-met, build-from-zero), feasibility (`computeTargetFeasibility` required/observed/plausible/ratio/verdict, the new `log:` observed path, met-check, weeksRemaining), and the recap aggregator stat derivation per kind.

## 5. Phasing (→ epics → sprints)
- **Sprint 1 — Presentation registry + recap card (3.1 core).** Build `goal-presentation.ts` (pure, hoisted formatters); add `resolveStatSlot` + `statSlots` to `recap.ts` (goal-first fetch → gated `Promise.all`); drive ring label / header / **all 5 render sites** (2 stat grids, 2 ring labels, 2 program lines) from presentation in `recap-card.tsx`. **Gate:** fitness card byte-identical (snapshot); Chewgether shows `PROGRESS` + `MRR —` + `MILESTONES 0/7`; Satori re-render verified.
- **Sprint 2 — Today + progress + legend kind-awareness (3.1 rest).** `presentation.restCopy` in `page.tsx`; weight-chart gating on weight-target presence (not bare `kind`) + project trend in `progress/page.tsx`; `legend.ts` via `presentation.legendDefault`; fitness-counterpart coaching doc. **Gate:** fitness Today/progress unchanged; project surfaces no longer mislabel.
- **Sprint 3 — Feasibility surface (3.2, surface-only).** `FeasibilityReadout` server component (4 honest states incl. two no-data sub-states) on Today (both paths) + goal page; wire `computeGoalFeasibility` server-side; advertise feasibility in `get_goal` description; coaching-doc update. **No `rarity-core.ts` change.** **Gate:** Chewgether shows "not enough data to rate" honestly today; a ≥3-MRR-log fixture shows a real verdict.
- **Sprint 4 — Tests (3.6).** Vitest on `progressFor`/`computeReadiness` (gating ceiling 80, untested=0, decrease, coverage, already-met, build-from-zero), `computeTargetFeasibility` (log: observed ≥3pts, <3pts unknown, met-check, ratioCap stall, decrease-sign), `resolveStatSlot` per kind (fitness byte-identical, project —/0/7). Runs alongside 1–3; sequenced last to test final shapes.
- **Backlog — 3.3 spike, 3.4 flywheel, 3.5 onboarding.** Epics, not decomposed now.

## 6. Risks & Resolutions (post-hardening)
- **Abstraction-from-one-example** (top risk): the registry could ossify around a vertical. Resolved by holding project slots to the **2 data-backed** (MRR/Milestones), `ringLabel:"PROGRESS"` not `TRACTION`, and a `__default__` clone so neither vertical is default-by-omission. Every generic story carries a Chewgether acceptance criterion.
- **`log:milestones_done` vs ScheduledItem desync** — recap "Milestones" sources the live ScheduledItem aggregate (0/7); readiness ring keeps reading the log metric. Two truths, not merged.
- **Feasibility no-data is honest, not a bug** — the observed path already exists; Chewgether reads `no-data` because it has 0 logs. **No engine change.** `FeasibilityReadout` renders two honest no-data sub-states (0-log vs 1–2-log). `minObservedPoints` stays 3.
- **Fitness byte-identical or it's a regression** — hoist formatters into the pure module; resolve fitness slots from the same `recapField`s; enforce with a snapshot test across all 5 card render sites.
- **`recap.ts` fetch ordering** — goal-first fetch → resolve presentation → single gated `Promise.all` (can't gate inside the current block that fetches the goal itself).
- **Server/Date boundary** — `FeasibilityReadout` + recap stay server-side; never pass Date instances to client (`GoalFeasibility.computedAt` is already a string).
- **Satori** — recap-card change re-verifies render (no conic-gradient, flex-only, inline styles) per memory `satori-no-conic-use-svg-arc`.
- **USER_TZ** — new date math (weeks-to-target header, MRR-over-time) goes through `@/lib/calendar`.
- **Resolved open question:** `get_goal.feasibility.computed` already returns full per-target required/observed/plausible/ratio/verdict + weeksRemaining — no read-tool extension needed.

## 7. Deferred additive seams (not now)
`Goal.presentation Json?` (per-goal label overrides); `minObservedPointsByFamily` + `TargetFeasibility.confidence` (2-point coarse rates); non-fitness `NormPack`s in `RARITY_NORM_PACKS` (seam already at `rarity-core.ts:127`). All additive/Neon-safe if ever needed.
