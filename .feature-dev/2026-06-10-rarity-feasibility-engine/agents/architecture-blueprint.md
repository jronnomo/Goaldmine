# Architecture Blueprint — Rarity/Feasibility Engine (#63)

Produced by the planning-phase design agent (exploration-verified); adopted as the run blueprint. PRD is requirements authority; this file is design authority.

## Decisions

**D1 — Module placement**: `src/lib/rarity-core.ts` (pure, client-safe — no Prisma, no calendar imports) + `src/lib/rarity.ts` (async, Prisma). Mirrors metrics-registry.ts / goal-targets.ts split: UI chips import core types client-side; pure core is tsx-self-checkable. Tunables-as-const mirrors game/rules.ts and goal-conflicts.ts CROSS_GOAL_RULES.

**D2 — Storage**: `Goal.coachFeasibility Json?` = `{ tier, rationale, assessedAt, assessedBy: "coach" }`. Single user, never filtered by tier, matches targets/references/legend Json precedent; additive migration `rarity_phase2`; atomic bundle beats column-per-field.

**D3 — Shared cores**: MCP tools never call revalidatePath and /goals,/character,/ are force-dynamic ⇒ MCP writes need no revalidation. Extract `setGoalTrackedCore` / `setPlanActiveCore` into `src/lib/goal-core.ts` (its header documents exactly this dual server-action/MCP contract). Actions keep `"use server"` wrappers + revalidatePath; guards (throws) live in core so MCP gets identical semantics.

**D4 — Per-goal tier**: worst-target-dominates over targets with `weight ≥ weightFloor (0.1)` and computable ratio. All-below-floor ⇒ fall back to single highest-weight target. No-norm+no-data targets = verdict "unknown", excluded; all-unknown ⇒ tier null ("unrated").

**D5 — Stack**: `stackTierIndex = max(perGoal effectiveTier index) + loadBump`, bump ∈ {0,1} capped at Legendary. Bump when datedActiveGoals ≥ 3 OR cross-goal conflicts next 28d ≥ 4 (getGoalEventsResult + crossGoalConflicts, same assembly as get_week tools.ts:691-702). `concurrentLoadBump` isolated pure fn = future graded-multiplier seam.

**D6 — Creation warning (app)**: TargetsBuilder is client-side and createGoal redirects ⇒ pre-submit preview is Phase 3. v1: createGoal computes stack rarity AFTER createGoalCore, redirects `/goals/{id}?stackWarning=epic|legendary`; detail page reads searchParams ⇒ banner. MCP create_goal returns non-blocking `stackWarning` field.

**D7 — preview_goal_feasibility ships now**: ~30 lines; `computeStackRarity({extraGoal})` is the same internal the creation warning uses.

**D8 — Kind seam**: `RARITY_NORM_PACKS: Record<string, NormPack>` + `normPackForGoal(kind)` fitness fallback, mirroring RULE_PACKS/rulePackForGoal. Only fitness pack built; project-kind log:* targets are observed-only by design (log family norm = null in every pack).

## rarity-core.ts signatures

```ts
export const RARITY_TIERS = ["common","uncommon","rare","epic","legendary"] as const;
export type RarityTier = (typeof RARITY_TIERS)[number];
export function tierIndex(t: RarityTier): number;
export function tierFromRatio(ratio: number, rules?: typeof RARITY_RULES): RarityTier;
export type TargetVerdict = "met" | RarityTier | "unknown";
export type TargetFeasibility = { metric; label; weight; requiredRate: number|null; observedRate: number|null;
  plausibleRate: number|null; rateBasis: "observed"|"norm"|"none"; ratio: number|null; verdict: TargetVerdict;
  countsTowardTier: boolean };
export type GoalFeasibility = { goalId; tier: RarityTier|null; unratedReason: "someday"|"no-targets"|"no-data"|null;
  ratio: number|null; perTarget: TargetFeasibility[]; basis: "observed"|"norms"|"mixed"|null;
  weeksRemaining: number|null; computedAt: string };
export type StackRarity = { tier: RarityTier|null; baseTier: RarityTier|null; loadBump: 0|1; loadBumpReasons: string[];
  datedActiveGoalCount: number; conflictCount28d: number;
  perGoal: Array<{ goalId; objective; computed: GoalFeasibility; coach: CoachFeasibility|null; effectiveTier: RarityTier|null }>;
  computedAt: string };
export type CoachFeasibility = { tier: RarityTier; rationale: string; assessedAt: string; assessedBy: "coach" };
export function weeklySlope(points: {date: Date; value: number}[], minPoints: number): number | null; // least-squares, units/WEEK
export function computeTargetFeasibility(input: { target: GoalTarget; current: number|null; weeksRemaining: number;
  observedWeeklyRate: number|null; observedPoints: number; normPack: NormPack; rules? }): TargetFeasibility;
export function aggregateGoalTier(perTarget, rules?): { tier; ratio; basis };
export function concurrentLoadBump(input: { datedActiveGoalCount; conflictCount28d; rules? }): { bump: 0|1; reasons: string[] };
export function aggregateStackTier(perGoalEffectiveTiers: (RarityTier|null)[], bump: 0|1): { tier; baseTier };
export function effectiveTier(computed: RarityTier|null, coach: CoachFeasibility|null): RarityTier|null; // coach ?? computed
export function metricFamilyFor(metric, units, direction): "weight"|"endurance-time"|"strength-like"|"hike-count"|"hike-elevation"|"hike-distance"|"workout-count"|"log"|"unknown";
```

### Math (exact)
- gap = direction==="increase" ? target-current : current-target; gap ≤ 0 ⇒ "met", ratio 0.
- requiredRate = gap / weeksRemaining (units/week).
- plausible: observedPoints ≥ minObservedPoints ⇒ observed > 0 ? max(observed, regressionFloorFactor×norm) : regressionFloorFactor×norm (norm null ⇒ use observed; observed ≤ 0 ⇒ ratio = ratioCap). Else norm (basis "norm"); norm null + no data ⇒ "unknown".
- ratio = min(requiredRate/plausible, ratioCap). tierFromRatio: ≤0.5 common · ≤1.0 uncommon · ≤1.5 rare · ≤2.5 epic · >2.5 legendary (inclusive upper bounds).

### Tunables (each default needs its one-line rationale in code)
```ts
export const RARITY_RULES = {
  tierThresholds: { common: 0.5, uncommon: 1.0, rare: 1.5, epic: 2.5 },
  ratioCap: 99, weightFloor: 0.1, minWeeksRemaining: 1,
  observedLookbackWeeks: 6, minObservedPoints: 3, regressionFloorFactor: 0.25,
  stack: { goalCountBumpAt: 3, conflictWindowDays: 28, conflictBumpAt: 4, maxBump: 1 },
} as const;
export const FITNESS_NORM_PACK: NormPack = { goalKind: "fitness", norms: {
  strengthPctPerWeek: 0.015, strengthAbsFloorPerWeek: { reps: .5, lb: 2, sec: 10, in: .25, default: .5 },
  enduranceTimePctPerWeek: 0.01, weightLossLbPerWeek: 1.5, weightGainLbPerWeek: 0.5,
  hikesPerWeek: 1.25, elevationFtPerWeek: 5000, distanceMiPerWeek: 20, workoutsPerWeek: 6,
  /* log:* intentionally NO norm — observed-only */ } };
```
Bench check: baseline 135→315, 12wk ⇒ required 15 lb/wk; plausible max(0.015×135, 2)≈2.03 ⇒ ratio≈7.4 ⇒ legendary.

## rarity.ts
`weeksRemainingFrac(targetDate, now)` from @/lib/calendar startOfDay midnights, max(minWeeksRemaining, days/7).
`observedSeriesFor(metric, goalId, since)` — one query per target: weightLb→Measurement; baseline:X→Baseline by exact testName; hike:*/workout:count→weekly cumulative buckets from one findMany in window; log:X→LogEntry. Series last point doubles as current; else resolveMetricValue; else target.start.
`computeGoalFeasibility(goal, opts?)` — someday ⇒ unrated, zero queries.
`computeStackRarity(opts?: { now?, extraGoal? })` — goals findMany(active, status active) w/ coachFeasibility on row; per-dated-goal feasibility via Promise.all; conflicts next 28d; pure aggregation. extraGoal injects a hypothetical (preview + creation warning).

## Migration
schema.prisma Goal after `legend`: `coachFeasibility Json?` with the two-line comment (computed always derived live; this is the override). One ALTER. Generate after.

## MCP table
(see PRD §3.1.6-7) — get_rarity / set_goal_feasibility (tier⇒rationale required; omit tier clears via Prisma.JsonNull; returns {coach, computed}) / set_goal_tracked / set_plan_active (cores) / preview_goal_feasibility (targets zod reused from update_goal_targets ~tools.ts:3175) / list_goals +coachFeasibilityTier row-only / get_goal +feasibility / get_game_state +slim stackRarity / create_goal +stackWarning. Coach-facing descriptions explain tiers, higher=harder, Legendary phrase, override semantics.

## UI
RarityChip ({tier, unrated?, title?, size?}; base `text-xs rounded-full px-2 py-0.5 border`; per-tier tokens [UXR] — placeholder common=--border/--muted, uncommon=--success, rare=--accent, epic=--target, legendary=--danger). StackRarityCard ({stack}) chip+reasons+Epic/Legendary banner [UXR]. /goals: page-level computeStackRarity once; chips read stack.perGoal; stack card above list [UXR]; coach-override marker [UXR]; glossary row. /goals/[id]: feasibility section (ReadinessBreakdown-style per-target table; coach + computed side-by-side); searchParams.stackWarning banner. /character: Promise.all with computeGameState; chip in portrait card [UXR].

## Query budget
Per-goal ≤2/target (typically 1). Stack ≈ 1 + Σ + 3 + 1 ≈ 20 for realistic stack. Per request, no cache (readiness precedent; /stats is far heavier today). React cache() = explicit non-goal.

## Risks
USER_TZ; norms opinionatedness (rationales + calibration); regression blowups (floor+cap); list_goals N+1 avoided; someday short-circuit; sparse history ⇒ norms = correct cold start; kind fallback; goal-actions.ts waved (REQ-2 wave 1, REQ-4 createGoal wave 2); tools.ts single owner.
