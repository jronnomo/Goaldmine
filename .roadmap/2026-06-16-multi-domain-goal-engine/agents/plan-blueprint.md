# Hardened Blueprint — Finish the Multi-Domain Goal Engine

**Role:** Plan Architect (read-only investigation; no production code written)
**Date:** 2026-06-16
**Hardens:** `docs/roadmap/multi-domain-goal-engine-plan.md` (Draft)
**Scope (locked):** decompose 3.1 (kind-aware surfaces), 3.2 (feasibility surfacing), 3.6 (tests). 3.3/3.4/3.5 = Backlog.
**Model:** goal-driven config registry (per-kind presentation + content derived from each goal's own `targets[]`), NOT per-kind hardcoded branches.

---

## 0. The load-bearing finding (read this first — it rewrites Sprint 3 and de-risks Sprint 1)

I queried the **live Chewgether goal** (`cmqbfseel0000cgdn3oz1uz2u`) directly against the prod Neon DB. Ground truth as of 2026-06-16:

```
objective : "Ship Chewgether to the App Store + reach $1,000/mo MRR"
kind      : "project"   targetDate: 2026-09-30  (weeksRemaining 15.14)
targets   : [ log:mrr  → $1000, weight 0.6, gating, increase ]
            [ log:milestones_done → 7, weight 0.4, gating, increase ]
legend    : null  (→ PROJECT_DEFAULT_LEGEND)
LogEntry  : []   ← ZERO log rows. No mrr, no milestones_done.
ScheduledItem : 7 × {type:milestone, status:planned} + 1 × {type:review, planned}.  0 done.
computeReadiness : score 0, coverage 0/2, openGateCount 2, both breakdown.progress = null
computeGoalFeasibility : tier null, unratedReason "no-data", both perTarget verdict "unknown",
                         countsTowardTier false, weeksRemaining 15.14
```

Three consequences that the draft plan gets **wrong or under-specifies**, and that every sprint must honor:

1. **The draft's feasibility root-cause is incorrect.** The draft (§1, §4.4) says `log:*` returns `no-data` "because `FITNESS_NORM_PACK` has no norm for `log:*` and there's no observed-only fallback (`rarity-core.ts:332`)." **That is false.** `computeTargetFeasibility` (`rarity-core.ts:458–487`) **already implements an observed-only path** for any family whose norm is null: with `observedPoints ≥ minObservedPoints (3)` and a positive slope, it sets `plausibleRate = observedWeeklyRate`, `rateBasis:"observed"`, and produces a real `ratio`/`verdict`. Chewgether reads `no-data` for the honest reason that it has **zero logged points** — you cannot slope a line through nothing. → **Sprint 3 is mostly a UI surface, not an engine rewrite.** See §3.

2. **`log:milestones_done` is desynced from the 7 ScheduledItem milestones.** Readiness reads the `log:milestones_done` LogEntry (currently null) — NOT `ScheduledItem.status`. The coaching doc (`docs/coaching/project-goal-prompts.md` §Milestone-Completion Rhythm step 3) confirms this is by-design: the coach must manually `log_metric('milestones_done', <cumulative>)`. So "milestones done" has **two truths**: the readiness metric (null) and the live ScheduledItem aggregate (0/7). The recap "Milestones" stat must source from **ScheduledItem aggregation** (real, live, 0/7) — matching `MilestoneBurnDown` — while the readiness *score* keeps reading the log metric. Conflating them re-introduces a silent desync. (Flagged in §1.4 and §2.)

3. **The aspirational project grid `MRR / Milestones / Paying Subs / Conversion` cannot be honestly filled today.** Only **Milestones (0/7)** has real data; **MRR is `—`** (no logs); **Subs and Conversion have no backing target, LogEntry metric, or query whatsoever.** Declaring a fixed 4-cell business grid is the *exact same sin* as the fitness `WORKOUTS/VOLUME/PRs/ELEVATION` grid — just a different vertical. The registry MUST derive project slots from the goal's own `targets[]` + actually-available sources, rendering `—` or dropping cells with no data. **This is the anti-vertical guardrail made concrete** (§1, §2).

---

## 1. The presentation registry (3.1 core)

### 1.1 Decision — module + purity

- **New module:** `src/lib/goal-presentation.ts`.
- **Purity contract:** pure / client-safe — **no Prisma, no `@/lib/calendar`, no Node built-ins** (same constraint class as `rarity-core.ts` and `metrics-registry.ts`). It must be importable by Satori JSX (`recap-card.tsx`), server components (`recap.ts`, `page.tsx`, `progress/page.tsx`), and the legend module. All DB access stays in the callers.
- **Rejected:** putting the config in `recap-templates.ts` (that file is Satori palette/type tokens only — coupling presentation semantics to visual tokens conflates two axes) or in `recap.ts` (would force every consumer to import the heavy aggregator). **Why:** a standalone pure module is the one seam all five consumers can share without cycles or server-only deps.

### 1.2 Decision — the data/declaration split (the key architectural call)

The registry **declares** slots (key, label, formatter, and *where* the value comes from). It does **not** fetch. `recap.ts` owns a single `resolveStatSlot(slot, ctx)` that switches on `slot.source.from` and reads from already-fetched data. This:
- avoids a `goal-presentation.ts ↔ recap.ts` import cycle (registry has zero runtime dep on the aggregator),
- keeps all DB/Prisma access in the server-only aggregator,
- lets fitness stay **byte-identical** (its slots resolve from the same `recapField`s the card reads today).

**Rejected alternative:** giving `StatSlot.source` a `(ctx) => value` closure that reads the DB. **Why rejected:** it would drag Prisma into the pure registry and make the fitness path non-identical (re-deriving values through a new code path risks pixel drift — the draft's "coexistence tax" risk).

### 1.3 The TypeScript shapes (real field names/types)

```ts
// src/lib/goal-presentation.ts  — pure, client-safe

export type StatFormat =
  | "int"          // String(n)
  | "volumeLb"     // fmtVolume — "2,370 lb" | "—"
  | "elevationFt"  // fmtElevation — "5,200 ft" | "—"
  | "currency"     // "$1,000" | "—"
  | "ratioOfTotal" // "0/7"  (value = done, of.total = denom)
  | "percent";     // "18%" | "—"

// Declarative source — WHERE the resolved value comes from. No closures, no DB.
export type StatSource =
  // a precomputed top-level WeeklyRecap numeric field (fitness path = byte-identical)
  | { from: "recapField"; field: "workoutsCompleted" | "volumeLb" | "prCount" | "hikeElevationFt" }
  // latest LogEntry numeric value for a bare metric key (e.g. "mrr")
  | { from: "logLatest"; metricKey: string }
  // ScheduledItem aggregate for a project goal (e.g. milestones done / total)
  | { from: "scheduledItem"; itemType: string; agg: "doneOverTotal" | "doneCount" | "openCount" }
  // a target's current value rendered against its target (reads computeReadiness breakdown)
  | { from: "targetCurrent"; metric: string };

export type StatSlot = {
  key: string;          // stable id, e.g. "workouts" | "mrr" | "milestones"
  label: string;        // uppercase grid label, e.g. "WORKOUTS" | "MRR" | "MILESTONES"
  source: StatSource;
  format: StatFormat;
};

export type HeaderStyle = "program-week" | "weeks-to-target" | "none";

export type GoalPresentation = {
  kind: string;             // "fitness" | "project" | "__default__"
  ringLabel: string;        // replaces hardcoded "READINESS" — "READINESS" | "PROGRESS"
  headerStyle: HeaderStyle; // drives the card header + Today eyebrow
  statSlots: StatSlot[];    // 2 or 4 slots (card renders 1 row of 2, or a 2×2)
  restCopy: string | null;  // generic recovery/cadence copy; null → omit the block
  legendDefault: "fitness" | "project"; // which legend.ts default this kind maps to
};
```

### 1.4 The two entries, side by side (interface proven against BOTH verticals)

```ts
const FITNESS_PRESENTATION: GoalPresentation = {
  kind: "fitness",
  ringLabel: "READINESS",
  headerStyle: "program-week",          // "WEEK 7 · DAY 49 OF 84"
  statSlots: [
    { key: "workouts",  label: "WORKOUTS",  source: { from: "recapField", field: "workoutsCompleted" }, format: "int" },
    { key: "volume",    label: "VOLUME",    source: { from: "recapField", field: "volumeLb" },          format: "volumeLb" },
    { key: "prs",       label: "NEW PRs",   source: { from: "recapField", field: "prCount" },           format: "int" },
    { key: "elevation", label: "ELEVATION", source: { from: "recapField", field: "hikeElevationFt" },   format: "elevationFt" },
  ],
  restCopy:
    "A short walk or light stretch today builds the aerobic base and joint resilience your goal needs — treat recovery as training, not a day off.",
  legendDefault: "fitness",
};

const PROJECT_PRESENTATION: GoalPresentation = {
  kind: "project",
  ringLabel: "PROGRESS",                 // brief floated "TRACTION"; see decision below
  headerStyle: "weeks-to-target",        // "15 WEEKS TO 9/30" (no Day-of-90 framing)
  statSlots: [
    // ORDER + COUNT proven against live data: only these two have real backing today.
    { key: "mrr",        label: "MRR",        source: { from: "logLatest", metricKey: "mrr" },                          format: "currency" },
    { key: "milestones", label: "MILESTONES", source: { from: "scheduledItem", itemType: "milestone", agg: "doneOverTotal" }, format: "ratioOfTotal" },
  ],
  restCopy: null,                        // project goals have no "rest day" concept
  legendDefault: "project",
};
```

**What a Chewgether stat slot resolves to TODAY (verified against live data):**
- `MRR` → `logLatest("mrr")` → **`—`** (LogEntry is empty; honest dash, not `$0`).
- `MILESTONES` → `scheduledItem(milestone, doneOverTotal)` → **`0/7`** (live ScheduledItem counts).
- The card renders a **single row of 2 cells**, not a fake 2×2 of `Subs`/`Conversion` with no data.

**Decision — `ringLabel: "PROGRESS"` not `"TRACTION"`.** The brief floats both. `PROGRESS` is goal-generic (works for any non-fitness kind the registry later adds); `TRACTION` is itself a vertical-specific (startup) word — choosing it would re-narrow the engine to "business goals." **Rejected `TRACTION`** for the same anti-vertical reason we reject the fitness grid.

**Decision — Subs/Conversion are NOT slots in v1.** They have no target, no LogEntry metric, and no query. **Rejected** adding them as aspirational `—`-only cells. **Why:** four dashes is worse than two real numbers, and it bakes a business-vertical assumption into code with nothing behind it. When the user adds `log:subscribers` / `log:conversion` targets and starts logging, the project entry gains two `logLatest`/`targetCurrent` slots and they light up automatically — the registry is the seam that makes that a one-line config add, not a card rewrite.

### 1.5 Resolution + fallback

```ts
const REGISTRY: Record<string, GoalPresentation> = {
  fitness: FITNESS_PRESENTATION,
  project: PROJECT_PRESENTATION,
};
const DEFAULT_PRESENTATION: GoalPresentation = { ...FITNESS_PRESENTATION, kind: "__default__" };

export function presentationForGoal(goal: { kind?: string | null } | null | undefined): GoalPresentation {
  const k = goal?.kind ?? null;
  return (k && REGISTRY[k]) ? REGISTRY[k] : DEFAULT_PRESENTATION;
}
```

**Decision — unknown/missing kind falls back to a `__default__` clone of fitness** (matches the existing `goal.kind ?? "fitness"` defaulting in `recap.ts:259,283` and `legend.ts`). **Rejected** a neutral empty default. **Why:** the live system already treats null-kind as fitness everywhere; a neutral default would change current behavior for the one real fitness goal. The default is *labeled* `__default__` so it is never mistaken for "fitness is the universal default" — it is an explicit safety net, satisfying the "neither vertical is default-by-omission" guardrail.

### 1.6 Exact consumers (file:line)

| Consumer | Today | After |
|---|---|---|
| `recap.ts` `computeWeeklyRecap` | computes `volumeLb/prCount/workoutsCompleted/hikeElevationFt` (lines 213–241) | also resolves `presentation.statSlots` → `recap.statSlots: ResolvedStatSlot[]` via `resolveStatSlot` (§2) |
| `recap-card.tsx` ring label | hardcoded `"READINESS"` (line **426**, and SlideOne line **855**) | `presentation.ringLabel` |
| `recap-card.tsx` header | `WEEK n · DAY m OF d` (lines **304–307**, SlideOne **793–795**) | switch on `presentation.headerStyle` |
| `recap-card.tsx` stat grid | fixed 4 `StatCell`s (lines **607–649**, SlideTwo **951–960**) | map `recap.statSlots` generically (1×2 or 2×2) |
| `page.tsx` rest copy | hardcoded Mt. Elbert tip (lines **247–254**) | `presentation.restCopy ?? null` |
| `progress/page.tsx` weight chart | always renders (lines **177–202**) | gate on `presentation` having a weight-backed slot / `kind==="fitness"` (§5) |
| `legend.ts` `resolveLegend` | `kind==="project"` branch (line **98**) | driven by `presentation.legendDefault` (§5) |
| `ProjectTodayView.tsx` | thin, MRR-only | add `FeasibilityReadout` + uses `presentation.ringLabel`/header (§5) |

---

## 2. Recap aggregator (`recap.ts`)

### 2.1 Decision — resolver lives in `recap.ts`, fitness path untouched

Add one function:

```ts
type ResolvedStatSlot = { key: string; label: string; value: string; isNull: boolean };

function resolveStatSlot(slot: StatSlot, ctx: {
  recap: { workoutsCompleted: number; volumeLb: number | null; prCount: number; hikeElevationFt: number | null };
  logLatest: Map<string, number | null>;        // bare metricKey → latest value
  scheduledAgg: Map<string, { done: number; total: number }>; // itemType → counts
  breakdown: TargetProgress[];                   // from computeReadiness, for targetCurrent
  targets: GoalTarget[];
}): ResolvedStatSlot
```

`WeeklyRecap` gains `statSlots: ResolvedStatSlot[]`. The four legacy fields (`workoutsCompleted`, `volumeLb`, `prCount`, `hikeElevationFt`) **stay** on the bundle (the MCP `generate_recap_card` stats JSON and the highlight logic at lines 327–424 read them). The card stops reading them directly and reads `statSlots` instead.

**Why the fitness path is byte-identical:** the fitness slots are all `recapField` sources whose `format` maps 1:1 to the existing `fmtVolume`/`fmtElevation`/`String()` calls. `resolveStatSlot` for fitness produces exactly `{ "2", "2,370 lb", "1", "5,200 ft" }` — same strings, same `isNull` flags (`volumeLb===null`, `hikeElevationFt===null`) the card uses today. **Acceptance test:** snapshot the current fitness card render, assert identical after refactor.

### 2.2 Decision — project sources reuse existing query patterns

Inside `computeWeeklyRecap`, when `presentation.statSlots` reference project sources, fetch (in the existing `Promise.all` at lines 180–211, gated on the resolved presentation needing them):
- `logLatest`: `prisma.logEntry.findFirst({ where:{ goalId, metric:<key>, value:{not:null} }, orderBy:{date:"desc"} })` — same shape as `ProjectTodayView.tsx:43` and `resolveMetricValue`'s `log:` branch.
- `scheduledAgg`: `prisma.scheduledItem.groupBy({ by:["status"], where:{ goalId, type:<itemType> }, _count:true })` → `{done, total}` — same data `MilestoneBurnDown.tsx:15` reads.

**Chewgether result (verified):** `logLatest("mrr") → null → "—" isNull:true`; `scheduledAgg("milestone") → {done:0,total:7} → "0/7" isNull:false`.

**Decision — "Milestones" sources from ScheduledItem, NOT `log:milestones_done`.** This is the §0.2 desync. The ScheduledItem aggregate is live and matches the burn-down card; `log:milestones_done` is a manually-maintained readiness input that is currently null and would render a misleading `—` while 7 real milestones exist. **Rejected** sourcing the stat from the readiness metric. **Why:** the recap is a *factual week summary*; it must show what's actually scheduled/done, not a coach-maintained score input. (The readiness *ring* still reads the log metric — that's the honest "you haven't logged it so it doesn't count toward readiness" behavior, which is correct and stays.)

### 2.3 Decision — variable slot count

`WeeklyRecap.statSlots` has length 2 or 4. The card renders a 2×2 when length 4, a single centered row when length 2. **Rejected** forcing 4 with dash padding (see §1.4). Keep `StatCell` unchanged; only the grid wrapper (`recap-card.tsx:588–651`, `951–961`) becomes a `.map`.

---

## 3. Feasibility `log:` observed path (3.2)

### 3.1 Decision — the engine already works; the rarity-core change is minimal (one tunable) or none

Verified by reading `rarity-core.ts:385–526` and confirming against live data:
- `log:` family → `normForFamily` returns `null` (line 331) **by design** ("observed-only").
- `computeTargetFeasibility` with `observedPoints ≥ 3` and `observedWeeklyRate > 0` → `plausibleRate = observedWeeklyRate`, `rateBasis:"observed"`, real `ratio`/`verdict` (lines 458–465, 488). **The observed-only path exists.**
- `observedPoints ≥ 3` and slope `≤ 0` with null norm → `ratio = ratioCap (99)`, `verdict = legendary`, `countsTowardTier:true` (lines 466–485) → honest "stalled = fantasy."
- `observedPoints < 3` (0,1,2) and null norm → `verdict:"unknown"`, `countsTowardTier:false` (lines 491–505) → honest "not enough data to rate."

So Chewgether's `no-data` today is **correct** (0 points), not a bug. `observedSeriesFor` already has the `log:` branch (`rarity.ts:125–137`) pulling raw LogEntry points.

**The only genuine engine question: the min-points threshold for `log:`.** `RARITY_RULES.minObservedPoints = 3` (`rarity-core.ts:62`), enforced both in `weeklySlope` (needs ≥3) and the gate at line 458.

- **Decision: keep the global floor at 3; do NOT special-case `log:` to 2.** A 2-point slope is an exact line with zero noise tolerance — for a business metric that's a dishonest confidence signal, violating the honesty-first invariant. **Rejected** a `minObservedPointsByFamily = { log: 2 }` tunable. **Why:** honesty-first beats earlier gratification; "2 of 3 points logged — rate not yet estimable" is the honest readout, and it's a one-line copy state, not an engine compromise.
- **Therefore `rarity-core.ts` needs NO change for 3.2.** (If a future decision wants 2-point coarse rates, it's an additive `minObservedPointsByFamily` tunable + a `confidence:"low"` flag on `TargetFeasibility` — explicitly deferred.)

This **shrinks Sprint 3 to a UI sprint**: the `FeasibilityReadout` component + wiring. Flag to the roadmap: the draft's Sprint-3 effort estimate (engine path + surface) should drop to "surface only."

### 3.2 Decision — no new read tool; `get_goal.feasibility` already carries everything

Verified `get_goal` handler (`tools.ts:896–910`) returns `feasibility: { computed, coach }` where `computed` is the full `GoalFeasibility`:
`{ tier, unratedReason, ratio, basis, weeksRemaining, perTarget: [{ metric, label, weight, requiredRate, observedRate, plausibleRate, rateBasis, ratio, verdict, countsTowardTier, currentValue }] }`.
`preview_goal_feasibility` (`tools.ts:4727–4754`) returns the same `GoalFeasibility` as `hypotheticalGoalFeasibility`.

**This answers the draft's one Open Question (§6): YES — per-target `required/observed/plausible/ratio/verdict/weeksRemaining` is already returned. No read tool needs extending.**

**Critical seam:** the UI surfaces are **server components and call `computeGoalFeasibility(goal)` directly** (the same function `get_goal` calls), NOT the MCP tool — there is no MCP round-trip from the app. `FeasibilityReadout` receives a `GoalFeasibility` resolved server-side in `page.tsx`/`ProjectTodayView`/`progress`. The MCP `get_goal.feasibility` is the *coach's* view of the identical data; keep them reading the same `computeGoalFeasibility` so they can never diverge.

### 3.3 Honest below-threshold behavior (the primary Chewgether state today)

`FeasibilityReadout` must render four states, derived purely from `GoalFeasibility`:
1. `unratedReason:"someday"` → "No deadline set — feasibility unrated."
2. `unratedReason:"no-targets"` → "Add targets to rate feasibility."
3. `unratedReason:"no-data"` (Chewgether today) → **"Not enough logged data to rate yet — log MRR a few times to see your pace."** Per-target rows still show `requiredRate` ("needs $66/wk to hit $1,000 by 9/30" — derived from `gap/weeksRemaining`, computable even with 0 observed) where available; `observedRate` shows "—".
4. `tier` set → the full honest readout: per-target `requiredRate` vs `observedRate`, `weeksRemaining`, verdict tier, `basis`.

This makes the honest "your data is too thin to rate" the **first-class** state, not an afterthought — which is exactly what Chewgether shows right now.

---

## 4. Prisma

**Decision — NO schema change in any of the three threads.** Confirmed `Goal` model already has `kind` (`@default("fitness")`, `@@index([kind])`), `targets Json?`, `legend Json?`, `coachFeasibility Json?` (`schema.prisma:169–208`). The presentation config is **code**, not data. ScheduledItem/LogEntry already back the project stats. No `Goal.presentation` column.

**Migration posture:** none. The deferred `Goal.presentation Json?` (nullable, additive, Neon-safe) is only warranted if a **per-goal** label override is ever needed (e.g. one goal wants a custom ring word). That is out of scope for 3.1/3.2/3.6 and stays an explicitly-deferred future migration. Keep migrations additive & Neon-shared-with-prod per `.claude/quality-tools.md` if it ever lands.

---

## 5. UI seams (precise edits)

**`recap-card.tsx`** (Satori — flex-only, inline styles, SVG `stroke-dasharray` ring already correct per memory `satori-no-conic-use-svg-arc`; no conic-gradient, no CSS vars):
- Line **300**: `const presentation = presentationForGoal(recap.goal)`.
- Lines **426 / 855**: `READINESS` → `presentation.ringLabel`.
- Lines **304–307 / 793–795**: `programLine` → switch on `presentation.headerStyle` (`program-week` keeps current string from `recap.header`; `weeks-to-target` renders e.g. `15 WEEKS TO SEP 30` from `recap.header` weeks-to-target fields — add `weeksToTarget`/`targetDateLabel` to `RecapProgramHeader`, computed in `recap.ts:290–311` via `@/lib/calendar`, never raw Date math; `none` omits).
- Lines **588–651 / 950–961**: replace the two fixed rows with `recap.statSlots.map(...)` into `StatCell` (`StatCell` unchanged). Handle 2-slot (1 row) vs 4-slot (2×2).
- `SlideThree` "On to Week N." (lines **1029–1042**) already guards on `programWeek !== null` → safely hidden for project. Keep; optionally generalize copy later (not in scope).

**`page.tsx` / `ProjectTodayView`:**
- `page.tsx` fitness path: rest copy (lines **247–254**) → `presentation.restCopy` (resolve `presentation = presentationForGoal(focusGoal)` near line 23). Drops the literal "Mt. Elbert" string (memory `goal-progress-bars-are-goal-generic`).
- `ProjectTodayView.tsx` (server component, no `"use client"`; keep that): add the `FeasibilityReadout` between the MRR card and Next-milestone card. Resolve feasibility server-side: `computeGoalFeasibility({ id, targetDate, targets, kind })` — `ProjectTodayView` already fetches `targets` (line 63) and has `goal.targetDate`; pass them. All date labels via `@/lib/calendar` `USER_TZ` (already imported, line 11). It already correctly shows MRR `—` and milestone urgency.

**`FeasibilityReadout` (new component, `src/components/FeasibilityReadout.tsx`):**
- **Server component** (no client interactivity; pure render of a `GoalFeasibility`). **Rejected client component** — no state, and keeping it server-side avoids passing Date objects to the client (the `CRIT-2` server-only-Date hazard noted in `recap.ts`). Input is the already-serialized `GoalFeasibility` (`computedAt` is a string; `weeksRemaining` a number; no Date crosses a boundary).
- Goal-generic: renders the four §3.3 states from any `GoalFeasibility`; zero references to fitness or project specifics. Used on Today (both `page.tsx` fitness hero and `ProjectTodayView`), the goal page, and (compact variant) optionally the recap later.
- Not Satori (it's a normal Tailwind DOM component for the dashboard, not the OG card) — Satori constraints do NOT apply here.

**`progress/page.tsx`:**
- Weight card (lines **177–202**): gate on the focus/each goal's presentation having a weight-backed slot. Concretely: render the weight chart only when the goal `kind==="fitness"` (or, more precisely, when its `targets[]` contains a `weightLb` metric). For a project focus goal, render an MRR-over-time trend instead (reuse `MilestoneBurnDown`, already gated at line 173, plus an MRR sparkline from `list`-style `logEntry` query). **Decision:** key the chart choice off `presentationForGoal(goal)` / target presence, not a bare `kind` check, so a fitness goal without a weight target doesn't show an empty weight chart. **Rejected** leaving the weight chart unconditional (it's the §1 "always renders the weight chart" mislabel for projects).

**`legend.ts`:**
- `resolveLegend` (lines **93–105**) currently branches on `kind==="project"` → `PROJECT_DEFAULT_LEGEND`. Re-express via `presentation.legendDefault` so the legend default and the rest of the surfaces share one source of kind→config truth. Keep `PROJECT_DEFAULT_LEGEND`/`DEFAULT_LEGEND` constants; just route the selection through the registry. The `LegendKind` enum (closed, render-coupled to `CalendarMonth.tsx`) is unchanged — out of scope.

---

## 6. Coaching-prompt change (`docs/coaching/`)

- **`project-goal-prompts.md`:** add a short "Surfaces the coach can rely on" section documenting that (a) the Today page now renders project-shaped (checklist + MRR + next milestone + **feasibility readout**), (b) the recap card shows `MRR / MILESTONES` + `PROGRESS` ring for project goals, (c) `get_goal.feasibility.computed` carries `perTarget required/observed/plausible/ratio/verdict` + `weeksRemaining` and reads `no-data` honestly until ≥3 MRR logs exist — so the coach should encourage logging MRR to unlock the rate estimate. Update Prompt 2's expected response to mention the feasibility readout state.
- **Add a fitness counterpart** `docs/coaching/fitness-goal-prompts.md` (currently only the project doc exists) noting the same surfaces in fitness framing (ring=`READINESS`, stats=`WORKOUTS/VOLUME/PRs/ELEVATION`, feasibility on Today/goal). Keeps the coach's mental model symmetric across verticals. — small doc, Sprint 2 or 3.
- **No new tool kinds** for 3.1/3.2. `preview_goal_feasibility` description is already keyword-rich; no change required (confirm only).

---

## 7. Phasing (confirmed, with one correction)

The 4-sprint ordering holds, **except Sprint 3 shrinks from "engine + surface" to "surface only"** (per §3.1). Each sprint leaves `main` deployable with fitness un-regressed.

- **Sprint 1 — Registry + recap card/aggregator (3.1 core).** Build `goal-presentation.ts`; add `resolveStatSlot` + `statSlots` to `recap.ts`; drive ring label / header / stat grid from presentation in `recap-card.tsx`. **Deployable gate:** fitness card byte-identical (snapshot test); Chewgether card shows `PROGRESS` + `MRR —` + `MILESTONES 0/7`. Satori re-render verified.
- **Sprint 2 — Today + progress + legend kind-awareness (3.1 rest).** `presentation.restCopy` in `page.tsx`; weight-chart gating + project trend in `progress/page.tsx`; `legend.ts` via `presentation.legendDefault`; fitness counterpart coaching doc. **Gate:** fitness Today/progress unchanged; project surfaces no longer mislabel.
- **Sprint 3 — Feasibility surface (3.2).** `FeasibilityReadout` server component (4 honest states) on Today (both paths) + goal page; wire `computeGoalFeasibility` server-side; coaching-doc update. **No `rarity-core.ts` change** (confirm the observed path with a test fixture of ≥3 synthetic MRR logs). **Gate:** Chewgether shows "not enough data to rate" honestly today; a 3-log fixture shows a real verdict.
- **Sprint 4 — Tests (3.6).** Vitest on `progressFor`/`computeReadiness` (gating cap → ceiling 80, untested=0, decrease metrics, coverage `{tested,total}`, already-met, build-from-zero), `computeTargetFeasibility` (the `log:` observed path at ≥3 pts, the `<3 pts → unknown` honesty, met-check, `ratioCap` stall path, decrease-sign normalization), and `resolveStatSlot` per kind (fitness byte-identical strings; project `—`/`0/7`). Can run alongside 1–3; sequenced last to test final shapes.

**Sprint dependency note:** Sprint 1 must land `presentationForGoal` + `statSlots` before 2/3 can consume them. 4 depends on the shapes from 1 and 3.

---

## 8. Flags — "secretly two projects" / re-hardcoding fitness

1. **`MRR/Milestones/Subs/Conversion` is a trap.** Subs/Conversion have zero backing data; shipping them = re-hardcoding a *business* vertical exactly as fitness was hardcoded. Held to 2 data-derived slots (§1.4). **This is the #1 anti-vertical risk.**
2. **`log:milestones_done` vs ScheduledItem desync** (§0.2, §2.2) — two truths for "milestones done"; recap sources the live ScheduledItem aggregate, readiness keeps the log metric. Don't merge them.
3. **The draft's feasibility "engine gap" is misdiagnosed** (§3.1) — the observed path already exists; Chewgether's `no-data` is honest (0 logs). Building an "engine fix" that isn't needed would be wasted scope and risks destabilizing a correct honesty path. Sprint 3 is surface-only.
4. **`ringLabel:"TRACTION"` re-narrows the engine** to startups — use `PROGRESS` (§1.4).
5. **Progress weight chart** must gate on *weight-target presence*, not bare `kind`, or a fitness goal without a weight target shows an empty chart (a different re-hardcode) (§5).
6. **Fitness byte-identical or it's a regression** — the registry must produce the exact current strings for fitness; enforce with a snapshot (§2.1) per the draft's "coexistence tax" risk.
7. **Server/Date boundary** — `FeasibilityReadout` and recap stay server-side; never pass `weekStart/weekEnd`/Date instances to client (existing `recap.ts` CRIT-2 hazard). `GoalFeasibility.computedAt` is already a string.

---

## 9. Open items for the roadmap (not blockers)

- Effort re-grade: Sprint 3 down-graded (no engine work). Sprint 1 carries the `WeeklyRecap.statSlots` contract change — slightly larger.
- Future additive seam (deferred, not now): `minObservedPointsByFamily` + `TargetFeasibility.confidence` if 2-point coarse rates are ever wanted; `Goal.presentation Json?` for per-goal label overrides; non-fitness `NormPack`s in `RARITY_NORM_PACKS` (the registry at `rarity-core.ts:127` is already a seam).
