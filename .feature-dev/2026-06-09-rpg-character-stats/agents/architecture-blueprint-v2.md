# Architecture Blueprint — RPG Character Stats (v2)

**Author**: Claude (Architect Agent — revision pass)
**Date**: 2026-06-09
**Feature**: RPG Character Stats (REQ-001..REQ-010)
**Version**: v2 — revised after Devil's Advocate critique; all CRIT and HIGH issues resolved; Tech Lead rulings incorporated.
**Status**: FINAL — Developer Agents build from this document

> Ground truth precedence: research-output.md > PRD > this blueprint. When this doc conflicts with research-output.md, treat the research as correct and flag the conflict.

> **What changed from v1**: See §12 "Critique Resolution Log" for the complete issue → resolution table. Summary of critical fixes below.

### Critical fixes incorporated
- **CRIT-1**: `getActiveProgram()` called standalone first; Promise.all holds only the remaining 9 queries.
- **CRIT-2**: Workout `findMany` uses pure nested `select` throughout — no `select`+`include` mixing at the same level.
- **CRIT-3** (Tech Lead ruling): ALL history queries (workouts+sets, hikes, baselines, nutrition, reviews, mobility, bonuses) are **UNBOUNDED** — all-time fetch. Only the day ledger, streak, and adherence remain bounded to `[startedOn, today]`. PR replay, badge predicates, volume/cardio/hike XP all run over full history. Expected row counts: workouts ~50–300, hikes ~10–50, baselines ~20–100, nutrition ~100–500, reviews ~10–50, mobility ~50–200. Single-user; revisit with take/bounds only if it ever becomes measurably slow.
- **HIGH-4**: PR replay rewritten — per-workout grouping by canonical name first, then compare against prior-workout snapshot; matches `recordsSetInWorkout` semantics exactly.
- **HIGH-3**: Streak milestone emission algorithm specified — chronological ledger replay, per-run re-earnable thresholds.
- **HIGH-2 + MR-1**: `EngineContext.baselineLogDates` replaced with `baselineLogged: { dateKey; testName; value }[]`; `requiredInitialTestNames` and `retestCheckpoints` pre-computed and added to context.
- **HIGH-5**: `LevelUpCelebration` renders inside a medallion-scoped `relative` wrapper (36×36 px) — exact JSX nesting specified in §6.1.
- **HIGH-1**: `grant_bonus_xp` checks for existing row with identical `(date, amount, reason)` before inserting; returns `alreadyGranted: true` on duplicate.
- Plus all MED and MR issues addressed or explicitly deferred (see §13).

---

## 1. File Plan

Creation order respects deps. Phase 0 first (schema + contracts); then streams A/B/C in parallel; then integration.

| # | Action | Path | Purpose | Key Exports | Depends On |
|---|--------|------|---------|-------------|------------|
| 0a | modify | `prisma/schema.prisma` | Add `GameBonusXp` model; add "baseline" to Workout.source comment | (Prisma generates `gameBonusXp` accessor) | — |
| 0b | create | `src/lib/game/types.ts` | Pure TypeScript contracts; NO Prisma imports | `XpEvent`, `AttributeState`, `GameState`, `BadgeDef`, `UnlockedBadge`, `DayLedgerEntry`, `QuestProjection`, `EngineContext`, `GameRulePack`, `AttributeDef`, `ComputeGameStateOpts`, `WorkoutRow`, `HikeRow`, `BonusRow` | — |
| 0c | create | `src/lib/game/rules.ts` | XP constants, `levelFromXp`, category→attribute map | `ATTR_LEVEL_BASE`, `OVERALL_LEVEL_BASE`, `FITNESS_XP`, `CATEGORY_ATTRIBUTE_MAP`, `PR_ATTRIBUTE_MAP`, `BASELINE_ATTRIBUTE_MAP`, `MILESTONE_XP`, `levelFromXp`, `xpForLevel`, `xpToNextLevel` | `types.ts` |
| 0d | create | `src/lib/game/attributes-registry.ts` | Attribute defs + rule pack registry | `FITNESS_RULE_PACK`, `RULE_PACKS`, `rulePackForGoal` | `types.ts`, `rules.ts` |
| A1 | create | `src/lib/game/quest.ts` | Quest XP projection (pure, no queries) | `projectQuestXp`, `earnedTodayXp` | `types.ts`, `rules.ts` |
| A2 | create | `src/lib/game/badges.ts` | 16 badge predicates | `BADGE_CATALOG`, `evaluateBadges` | `types.ts` |
| A3 | create | `src/lib/game/engine.ts` | Data fetch + pure computation | `computeGameState`, `computeGameStateFromData` | all `game/` files, `@/lib/calendar`, `@/lib/records`, `@/lib/db`, `@/lib/program` |
| B1 | modify | `src/lib/mcp/tools.ts` | Register `get_game_state` + `grant_bonus_xp` | (registered on McpServer) | `types.ts`, `attributes-registry.ts`, `engine.ts` |
| C1 | create | `src/components/game/XpBar.tsx` | Accessible XP progress bar (server) | `XpBar` | `types.ts` |
| C2 | create | `src/components/game/AttributeBar.tsx` | Attribute label+level+bar row (server) | `AttributeBar` | `types.ts` |
| C3 | create | `src/components/game/LevelMedallion.tsx` | Bullseye progress mode + level chip + relative wrapper slot for celebration | `LevelMedallion` | `Bullseye` |
| C4 | create | `src/components/game/StreakFlame.tsx` | Hand-rolled SVG flame + count (server) | `StreakFlame` | — |
| C5 | create | `src/components/game/QuestCard.tsx` | Quest ribbon inside hero (server) | `QuestCard` | `types.ts`, `TodayCelebration`, `Bullseye` |
| C6 | create | `src/components/game/CharacterHeader.tsx` | 2-row RPG header above hero (server) | `CharacterHeader` | `LevelMedallion`, `XpBar`, `AttributeBar`, `StreakFlame`, `LevelUpCelebration`, `types.ts` |
| C7 | create | `src/components/game/BadgeWall.tsx` | 16-badge typographic grid (server) | `BadgeWall` | `types.ts` |
| C8 | create | `src/components/game/XpEventList.tsx` | Last-30 XP log, coach bonuses ✦ (server) | `XpEventList` | `types.ts` |
| C9 | create | `src/components/game/LevelUpCelebration.tsx` | **Client island** — ring burst gate | `LevelUpCelebration` | — |
| D1 | create | `src/app/character/page.tsx` | /character server page | (default export) | `engine.ts`, all game components |
| D2 | modify | `src/components/MoreSheet.tsx` | Add "Character" nav row | (existing export) | — |
| D3 | modify | `src/app/globals.css` | Add `@keyframes level-up-burst` + `.level-up-ring` | (CSS) | — |
| I1 | modify | `src/app/page.tsx` | Wire `computeGameState` + render header/quest | (default export) | `engine.ts`, `CharacterHeader`, `QuestCard` |
| I2 | modify | `docs/project-gotchas.md` | New gotcha entries: derived/retroactive XP; baseline-mirror double-count; alias-map XP fragmentation; Workout.source="baseline" | (doc) | — |

---

## 2. Prisma Schema Changes

### Placement
Add `GameBonusXp` at the end of `prisma/schema.prisma`, after the `Program` model. Follow the same whitespace convention (blank line between models).

### Exact Model Text
```prisma
model GameBonusXp {
  id        String   @id @default(cuid())
  date      DateTime // USER_TZ midnight via parseDateInput
  amount    Int
  reason    String
  attribute String?  // attribute id valid for active goal kind; null = overall-only
  source    String   @default("coach")
  createdAt DateTime @default(now())

  @@index([date])
}
```

**Note on idempotency**: No `@@unique` constraint is added. Duplicate detection is done in-code in `grant_bonus_xp` by checking for an existing row with the same `(date, amount, reason)` before inserting (see §5). A formal DB constraint can be added in a future migration if needed; for now the in-code check is sufficient.

### Update to Workout.source schema comment
Add `"baseline"` to the existing comment on the `source` field in the `Workout` model:
```prisma
source    String?  // manual | strong.app | claude | imported | baseline
```
The `"baseline"` value is set by `appendBaselineToDayWorkout` when it creates mirror workouts. Engine guards rely on this value (see §4.5). Without this comment, developers reading the schema cannot know mirror workouts use this source string.

### Commands (run in this order)
```sh
npx prisma migrate dev --name add_game_bonus_xp
npx prisma generate
```

After `migrate dev`, inspect the generated SQL diff to confirm it is a pure `CREATE TABLE` with no `ALTER TABLE`. It is additive-only — safe on the shared Neon prod DB. No backfill needed.

---

## 3. Type Definitions (FULL, copy-paste ready)

### Decision: types.ts is pure TypeScript — no Prisma imports

`EngineData` (the fetched-rows bundle) is defined as an **internal type in `engine.ts`** (server-only). It intentionally uses Prisma's generated query shapes, which must not leak into client-reachable files. `types.ts` contains only output types (what engine produces, what UI consumes) — these are safe to import from server components, client components, and the MCP tool file alike.

```typescript
// src/lib/game/types.ts
// ZERO imports from @/generated/prisma, @/lib/db, "react", or Next.js internals.
// This file is client-component-safe.

export type RuleId = string;
export type AttributeId = string; // "STR" | "END" | "MOB" | "CON" for fitness pack

export type XpEvent = {
  dateKey: string;        // "yyyy-mm-dd"
  ruleId: RuleId;
  label: string;          // "PR · Bench Press" | "Upper workout" | "Coach: …"
  xp: number;
  attribute: AttributeId | null; // null = unattributed (overall-only)
};

export type AttributeState = {
  id: AttributeId;
  label: string;          // "Strength" | "Endurance" | "Mobility" | "Constitution"
  level: number;
  xp: number;             // cumulative XP for this attribute
  xpIntoLevel: number;    // progress within current level
  xpToNext: number;       // cost to reach next level
  progress: number;       // 0..1 fraction (xpIntoLevel / xpToNext)
};

export type GameState = {
  goalKind: string | null; // null when no active program; UI hides header
  level: number;           // overall level
  xp: number;              // overall total (Σ all attr + unattributed)
  xpIntoLevel: number;
  xpToNext: number;
  progress: number;        // 0..1 (xpIntoLevel / xpToNext)
  attributes: AttributeState[];
  streak: {
    current: number;
    longest: number;
    todayCounted: boolean; // true if today has already been scored as a success
  };
  badges: UnlockedBadge[];   // all 16 sorted: unlocked first (by dateKey asc), then locked
  recentEvents: XpEvent[];   // last 30 across all attributes + unattributed, sorted desc
  questToday: QuestProjection | null; // null when no program or off-plan day
};

export type BadgeDef = {
  id: string;
  name: string;
  hint: string;           // shown when locked; describes unlock condition
  monogram: string;       // 1–2 chars rendered in the medal face (DM Serif)
  glyphFamily?: "mountain" | "flame"; // optional hand-rolled geometric glyph
};

export type UnlockedBadge = {
  def: BadgeDef;
  dateKey: string | null; // null = locked; string = date first unlocked
};

// Lightweight, Prisma-free workout row for ledger and badge context
export type WorkoutRow = {
  id: string;
  startedAt: Date;
  status: string;         // "completed" | "planned" | "skipped"
  source: string | null;  // "baseline" identifies mirror workouts
  category: string | null; // resolved from DayTemplate for this day; null = off-plan or no template
};

// Lightweight hike row
export type HikeRow = {
  id: string;
  date: Date;
  status: string;
  elevationFt: number;
  packWeightLb: number | null;
};

// Bonus XP row (from GameBonusXp table)
export type BonusRow = {
  id: string;
  date: Date;
  amount: number;
  reason: string;
  attribute: string | null;
  source: string;
};

// One day's ledger entry (built in memory, never queried per-day)
// Ledger covers [program.startedOn, today] only — not future plan days.
export type DayLedgerEntry = {
  dateKey: string;
  isInPlan: boolean;
  isRestDay: boolean;
  completedWorkouts: WorkoutRow[];     // status === "completed", with category assigned
  completedHikes: HikeRow[];
  loggedBaselineNames: string[];       // testName strings of Baseline rows on this day
  dueBaselineNames: string[];          // from rotation/override resolution
  hasPlannedHike: boolean;             // a Hike row with status "planned" exists today
  streakSuccess: boolean;              // per PRD §3.1.5 rules
  workoutDeferredForBaseline: boolean; // advisory — non-rest in-plan day with baselines due
};

// Quest XP projection for today
export type QuestProjection = {
  projectedXp: number;
  earnedXp: number;
  earnedEvents: XpEvent[]; // events with today's dateKey
  complete: boolean;
  bonusHints: string[];     // e.g. ["PR chance +40 STR"] shown pre-training
};

// Passed into every badge predicate and rule-pack dispatch
export type EngineContext = {
  ledger: DayLedgerEntry[];
  events: XpEvent[];
  attributeXp: Map<AttributeId, number>;
  unattributedXp: number;
  // Pre-computed aggregates to avoid O(n²) in badge predicates
  totalPRCount: number;
  totalSetCount: number;
  totalTonnageLb: number;    // Σ weightLb × reps across all completed workout sets
  totalElevationFt: number;  // Σ elevationFt of completed hikes
  // Raw slices (Prisma-free shapes)
  workoutsAll: WorkoutRow[];
  hikesAll: HikeRow[];
  // v2: carries testName+dateKey+value, not bare dates; required for badge predicates
  baselineLogged: { dateKey: string; testName: string; value: number }[];
  reviewNoteDateKeys: string[];
  bonusRows: BonusRow[];
  // Pre-computed from program template for badge evaluation:
  // Tests that must all be logged for Baseline Scholar. Tests added via baseline_ops
  // (which modifies planJson) automatically join this set.
  requiredInitialTestNames: string[];
  // Retest checkpoint weeks: each entry is one checkpoint with all tests due that week.
  // Retest Ritualist unlocks when any one checkpoint has all its tests logged.
  retestCheckpoints: { weekIndex: number; testNames: string[] }[];
  // Sorted dateKeys where ≥2 NutritionLog rows exist (for Clean Week badge).
  nutritionQualDays: string[];
};

// Attribute definition inside a rule pack
export type AttributeDef = {
  id: AttributeId;
  label: string;       // "Strength"
  feedsText: string;   // "Completed lifts, volume, PRs" — displayed on /character
};

// Rule pack — per goal kind
export type GameRulePack = {
  goalKind: string;
  attributes: AttributeDef[];
};

// Entry point options — only used for computeGameStateFromData (the pure core, for testing).
// The exported computeGameState() takes no arguments; see §4.13.
export type ComputeGameStateOpts = {
  now?: Date; // defaults to new Date(); injectable for isolation/testing of pure core only
};
```

---

## 4. Engine Design

### 4.1 EngineData (internal to engine.ts — NOT exported to types.ts)

```typescript
// engine.ts — internal, server-only
type EngineData = {
  program: ActiveProgramSnapshot; // guaranteed non-null (early return if null before fetch)
  goal: { id: string; kind: string } | null;
  // Workouts with full exercise+set tree for PR replay + volume.
  // Fetched ALL TIME (unbounded). Expected ~50–300 rows. Ordered by (startedAt ASC, id ASC).
  workouts: Array<{
    id: string;
    startedAt: Date;
    status: string;
    source: string | null;
    exercises: Array<{
      name: string;
      sets: Array<{
        weightLb: number | null;
        reps: number | null;
        durationSec: number | null;
      }>;
    }>;
  }>;
  // Hikes fetched ALL TIME. Expected ~10–50 rows.
  hikes: Array<{
    id: string;
    date: Date;
    status: string;
    elevationFt: number;
    packWeightLb: number | null;
    durationMin: number;
  }>;
  // Baselines fetched ALL TIME. Expected ~20–100 rows.
  // value included for EngineContext.baselineLogged.
  baselines: Array<{
    id: string;
    date: Date;
    testName: string;
    value: number;
  }>;
  // NutritionLog fetched ALL TIME. Expected ~100–500 rows.
  nutritionLogs: Array<{ date: Date }>;
  // Review notes fetched ALL TIME. Expected ~10–50 rows.
  reviewNotes: Array<{ date: Date }>;
  // Mobility checkins fetched ALL TIME. Expected ~50–200 rows.
  mobilityCheckins: Array<{ date: Date }>;
  // Overrides bounded to plan window (only relevant for day ledger resolution)
  overridesByKey: Map<string, {
    workoutJson: unknown;             // null = explicit clear → fall to rotation
    baselineTestNames: string[] | null; // null = use rotation; [] = explicitly none
  }>;
  // Bonus XP — all time (small; coach-granted only)
  bonusRows: Array<{
    id: string;
    date: Date;
    amount: number;
    reason: string;
    attribute: string | null;
    source: string;
  }>;
};
```

### 4.2 Two-Step Fetch: Program First, Then 9-Query Promise.all

**CRIT-1 fix**: `getActiveProgram()` is a standalone await. `planStart`/`planEnd` are computed from it before the fan-out. The Promise.all holds only the remaining 9 queries.

**CRIT-2 fix**: Workout query uses pure nested `select` throughout — no `select`+`include` at the same level.

**CRIT-3 fix (Tech Lead ruling)**: All queries except overrides are unbounded. Expected row counts documented inline.

```typescript
// engine.ts — inside _computeGameState()

// ── Step 1: program first (planStart/planEnd depend on it) ──
const program = await getActiveProgram();
if (!program) {
  return {
    goalKind: null,
    level: 1,
    xp: 0,
    xpIntoLevel: 0,
    xpToNext: OVERALL_LEVEL_BASE,
    progress: 0,
    attributes: [],
    streak: { current: 0, longest: 0, todayCounted: false },
    badges: BADGE_CATALOG.map(def => ({ def, dateKey: null })),
    recentEvents: [],
    questToday: null,
  };
}

const planStart = startOfDay(program.startedOn);
const planEnd   = endOfDay(addDays(program.startedOn, program.template.totalWeeks * 7 - 1));

// ── Step 2: fan out the remaining 9 queries ──
const [
  goal,
  workoutsRaw,
  hikesRaw,
  baselinesRaw,
  nutritionRaw,
  reviewsRaw,
  mobilityRaw,
  overridesRaw,
  bonusRaw,
] = await Promise.all([
  // 1. Active goal (for attribute validation in bonus tools)
  prisma.goal.findFirst({
    where: { active: true },
    orderBy: { updatedAt: "desc" },
    select: { id: true, kind: true },
  }),

  // 2. Workouts: ALL TIME — full tree for PR replay + volume.
  //    Ordered (startedAt ASC, id ASC) for deterministic PR replay.
  //    Expected: ~50–300 rows; fine for single user.
  prisma.workout.findMany({
    orderBy: [{ startedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      startedAt: true,
      status: true,
      source: true,
      exercises: {
        select: {
          name: true,
          sets: {
            select: { weightLb: true, reps: true, durationSec: true },
          },
        },
      },
    },
  }),

  // 3. Hikes: ALL TIME. Expected: ~10–50 rows.
  prisma.hike.findMany({
    orderBy: { date: "asc" },
    select: { id: true, date: true, status: true, elevationFt: true, packWeightLb: true, durationMin: true },
  }),

  // 4. Baselines: ALL TIME — testName + value for badge predicates.
  //    Expected: ~20–100 rows.
  prisma.baseline.findMany({
    orderBy: { date: "asc" },
    select: { id: true, date: true, testName: true, value: true },
  }),

  // 5. NutritionLog: ALL TIME — date only (count rows per day).
  //    Expected: ~100–500 rows.
  prisma.nutritionLog.findMany({
    orderBy: { date: "asc" },
    select: { date: true },
  }),

  // 6. Review notes: ALL TIME. Expected: ~10–50 rows.
  prisma.note.findMany({
    where: { type: "review" },
    orderBy: { date: "asc" },
    select: { date: true },
  }),

  // 7. Mobility checkins: ALL TIME. Expected: ~50–200 rows.
  prisma.mobilityCheckin.findMany({
    orderBy: { date: "asc" },
    select: { date: true },
  }),

  // 8. PlanDayOverrides: BOUNDED to plan window (only needed for day ledger resolution).
  prisma.planDayOverride.findMany({
    where: { planId: program.id, date: { gte: planStart, lte: planEnd } },
    select: { date: true, workoutJson: true, baselineTestNames: true },
  }),

  // 9. GameBonusXp: all time (small; coach-granted only).
  prisma.gameBonusXp.findMany({
    orderBy: { date: "asc" },
    select: { id: true, date: true, amount: true, reason: true, attribute: true, source: true },
  }),
]);

// Pre-bucket overrides by dateKey for O(1) lookup during ledger build
const overridesByKey = new Map(
  overridesRaw.map(o => [
    dateKey(o.date),
    {
      workoutJson: o.workoutJson,
      baselineTestNames: Array.isArray(o.baselineTestNames) ? o.baselineTestNames : null,
    },
  ])
);

const data: EngineData = {
  program,
  goal,
  workouts: workoutsRaw,
  hikes: hikesRaw,
  baselines: baselinesRaw,
  nutritionLogs: nutritionRaw,
  reviewNotes: reviewsRaw,
  mobilityCheckins: mobilityRaw,
  overridesByKey,
  bonusRows: bonusRaw,
};
```

### 4.3 buildDayLedger Algorithm

Produces `DayLedgerEntry[]` for every in-plan calendar day **up to and including today** (not future plan days — future days have no data and would falsely break streaks).

```
INPUTS:
  program: ActiveProgramSnapshot
  workoutsByDay: Map<dateKey, WorkoutRow[]>  // pre-bucketed from EngineData (ALL TIME)
  hikesByDay: Map<dateKey, HikeRow[]>        // pre-bucketed (ALL TIME)
  baselinesByDay: Map<dateKey, { testName: string; value: number }[]>  // pre-bucketed (ALL TIME)
  nutritionCountByDay: Map<dateKey, number>  // pre-bucketed from EngineData (ALL TIME)
  overridesByKey: Map<dateKey, OverrideRow>  // plan window only (already bounded)
  now: Date

ALGORITHM (for d = 0 to min(totalWeeks*7 - 1, daysSince(program.startedOn, now))):
  date = addDays(program.startedOn, d)  // @/lib/calendar addDays (start-of-day, DST-safe)
  dk = dateKey(date)

  // Step 1 — in-plan check (all d in this range are in-plan by construction)
  isInPlan = true

  // Step 2 — rotation math
  rotationDay = ((d % 7) + 7) % 7 + 1     // 1..7
  weekIndex   = floor(d / 7) + 1           // 1..totalWeeks

  // Step 3 — override lookup
  override = overridesByKey.get(dk) ?? null

  // Step 4 — workout template resolution
  if override?.workoutJson != null:         // strict null check; null = explicit clear
    workoutTemplate = override.workoutJson as DayTemplate
    isOverride = true
  else:
    workoutTemplate = program.template.weeklySplit.find(t => t.dayOfWeek === rotationDay) ?? null
    isOverride = false

  // Step 5 — baseline names resolution
  overrideNames = Array.isArray(override?.baselineTestNames) ? override.baselineTestNames : null
  // Note: undefined and null both fall through to rotation default; [] = "explicitly none"
  if overrideNames !== null:
    dueBaselineNames = overrideNames  // weekIndex filter bypassed for override-listed tests
  else:
    baselineDay = program.template.baselineWeek.find(bd => bd.dayOfWeek === rotationDay)
    dueBaselineNames = []
    if baselineDay:
      for test in baselineDay.tests:
        initialWeek = test.initialWeek ?? 1
        if weekIndex === initialWeek OR (weekIndex > initialWeek AND test.retestWeeks.includes(weekIndex)):
          dueBaselineNames.push(test.testName)

  // Step 6 — workoutDeferredForBaseline (advisory)
  workoutDeferredForBaseline = (
    dueBaselineNames.length > 0
    AND !isOverride
    AND workoutTemplate !== null
    AND workoutTemplate.category !== "rest"
  )

  // Step 7 — collect day's data
  loggedBaselineNames = (baselinesByDay.get(dk) ?? []).map(b => b.testName)
  allWorkoutsOnDay = workoutsByDay.get(dk) ?? []
  isRestDay = workoutTemplate?.category === "rest"
  hasPlannedHike = (hikesByDay.get(dk) ?? []).some(h => h.status === "planned")

  // Step 8 — assign category to completed WorkoutRows (MED-1 fix)
  // WorkoutRow.category is NOT a Prisma field; it is resolved from the day template.
  // This assignment is what makes category-based XP bucketing work for MOB/END days.
  completedWorkouts = allWorkoutsOnDay
    .filter(w => w.status === "completed")
    .map(w => ({ ...w, category: workoutTemplate?.category ?? null }))

  completedHikes = (hikesByDay.get(dk) ?? []).filter(h => h.status === "completed")

  allDueBaselinesLogged = dueBaselineNames.length > 0
    && dueBaselineNames.every(name => loggedBaselineNames.includes(name))

  // Step 9 — streak/adherence success
  isToday = dk === dateKey(now)
  if isRestDay:
    streakSuccess = true
  else if completedWorkouts.length > 0 OR completedHikes.length > 0 OR allDueBaselinesLogged:
    streakSuccess = true
  else if hasPlannedHike AND completedHikes.length === 0 AND completedWorkouts.length === 0:
    streakSuccess = false   // planned-hike skipped with no workout = break
  else if isToday:
    streakSuccess = false   // today not yet succeeded; excluded from break scan
  else:
    streakSuccess = false   // missed workout

  emit DayLedgerEntry { dateKey: dk, isInPlan, isRestDay, completedWorkouts,
                        completedHikes, loggedBaselineNames, dueBaselineNames,
                        hasPlannedHike, streakSuccess, workoutDeferredForBaseline }

TODAY GRACE RULE: The streak break scan iterates ledger entries up to (not including) today
when today's streakSuccess is false. Today is included in current streak only if streakSuccess
is true on today's entry.
```

#### 4.3.A Nutrition Event Generation (post-ledger, MR-2 fix)

Run after the ledger is complete, over ALL nutritionLogs (ALL TIME, not just plan window):

```
nutritionCountByDay: Map<dateKey, number>
for each log in nutritionLogs:
  dk = dateKey(log.date)
  nutritionCountByDay.set(dk, (nutritionCountByDay.get(dk) ?? 0) + 1)

for each [dk, count] of nutritionCountByDay:
  if count >= 2:
    emit { dateKey: dk, ruleId: "nutrition.day", label: "Nutrition logged",
           xp: FITNESS_XP.NUTRITION_DAY, attribute: "CON" }
```

`nutritionQualDays` (for EngineContext, Clean Week badge) = sorted dateKeys where count ≥ 2.

#### 4.3.B Mobility Event Generation (post-ledger, MR-3 fix — moved from D-11)

Run after the ledger is complete. Award at most one `mobility.session` per calendar day.
MobilityCheckin rows take priority; if already marked, skip the workout-based check:

```
mobilityByDay: Set<dateKey> = new Set(mobilityCheckins.map(m => dateKey(m.date)))

// Award for all MobilityCheckin days first
mobilityEvents: XpEvent[] = []
for dk in mobilityByDay:
  mobilityEvents.push({ dateKey: dk, ruleId: "mobility.session",
                        label: "Mobility session", xp: FITNESS_XP.MOBILITY_SESSION, attribute: "MOB" })

// Then check completed zone2-mobility workout days (skip if already covered by checkin)
for each ledger entry e where isInPlan:
  if mobilityByDay.has(e.dateKey): continue  // already awarded from checkin
  if e.completedWorkouts.some(w => w.category === "zone2-mobility"):
    mobilityByDay.add(e.dateKey)  // mark so subsequent loop iterations don't double-emit
    mobilityEvents.push({ dateKey: e.dateKey, ruleId: "mobility.session",
                          label: "Zone-2 / Mobility workout", xp: FITNESS_XP.MOBILITY_SESSION, attribute: "MOB" })
```

#### 4.3.C Volume and Cardio XP (documentation — MED-2 acknowledged)

Volume (`workout.volume`) and cardio (`workout.cardio`) XP are awarded **per-workout** with no per-day cap. For a single user this is the intended behavior. A mistake re-import would double-count volume silently. Document this in `rules.ts`:

```typescript
// Volume and cardio XP: per-workout, no daily cap (intentional for single user).
// A re-imported workout doubles these; coach should use delete_workout to fix.
export const FITNESS_XP = {
  ...
  WORKOUT_VOLUME_PER_1000LB: 1,
  WORKOUT_VOLUME_CAP: 15,
  WORKOUT_CARDIO_PER_10MIN: 1,
  WORKOUT_CARDIO_CAP: 10,
  ...
} as const;
```

### 4.4 Day Category → Attribute Mapping

Define in `rules.ts` as `CATEGORY_ATTRIBUTE_MAP`:

| `DayTemplate.category` | XP Attribute | Note |
|------------------------|-------------|------|
| `"upper"` | `"STR"` | Day 1 |
| `"lower"` | `"STR"` | Day 2 |
| `"zone2-mobility"` | `"MOB"` | Day 3 |
| `"calisthenics"` | `"STR"` | Day 4 |
| `"lower-power"` | `"STR"` | Day 5 — **must be `"lower-power"`, NOT `"power"`** (PRD table uses "power" as shorthand) |
| `"long-endurance"` | `"END"` | Day 6 |
| `"rest"` | `null` | No `workout.completed` XP on rest days |
| `null` (off-plan or unknown) | `"STR"` | Fallback — pre-plan workouts land here |

### 4.5 PR Replay Algorithm (HIGH-4 fix — matches `recordsSetInWorkout` exactly)

**Confirmed behavior from `records.ts` lines 459–545**: prior sets come from OTHER workouts only (strictly `id: { not: workoutId }`). The engine must replicate this: priors are from all workouts processed BEFORE the current one in chronological sort order. Exercises within the current workout are grouped by canonical name first; only the workout's best-per-canonical compares against the prior map.

Uses `canonicalExerciseName`, `bestSetSummary`, `epley1RM` imported from `@/lib/records` — never reimplemented.

```
INPUTS:
  workoutsRaw already sorted by (startedAt ASC, id ASC) from §4.2 query

STATE:
  prBestByExercise: Map<canonicalName, { primary: "rm"|"reps"|"duration", value: number }>
  prEventsByDay: Map<dateKey, XpEvent[]>  // for 3/day cap
  allPrEvents: XpEvent[]

ALGORITHM:
For each workout W in workoutsRaw (in sort order — strictly earlier startedAt comes first;
  equal startedAt tie-broken by id ASC, matching the query's orderBy):

  if W.status !== "completed": continue  // skip non-completed workouts entirely

  // Step 1: Build this workout's per-canonical best (merge all exercises by canonical name)
  workoutBestByExercise: Map<canonicalName, { primary, value }>
  for each exercise in W.exercises:
    canon = canonicalExerciseName(exercise.name)
    summary = bestSetSummary(exercise.sets)
    if summary === null: continue
    existing = workoutBestByExercise.get(canon)
    if !existing OR summary.value > existing.value:
      workoutBestByExercise.set(canon, { primary: summary.primary, value: summary.value })

  // Step 2: Compare this workout's bests against the PRIOR snapshot
  //   (prBestByExercise holds only bests from workouts processed BEFORE this one)
  dk = dateKey(W.startedAt)
  for each [canon, workoutBest] of workoutBestByExercise:
    prior = prBestByExercise.get(canon)

    if !prior:
      // First-ever record for this movement — NOT a PR (nothing to beat)
      prBestByExercise.set(canon, workoutBest)
      continue

    if workoutBest.primary === prior.primary AND workoutBest.value > prior.value:
      // Strict same-primary improvement — PR!
      attr = PR_ATTRIBUTE_MAP(canon)
      event = { dateKey: dk, ruleId: "pr.set", label: `PR · ${canon}`,
                xp: FITNESS_XP.PR_SET, attribute: attr }
      dayPrs = prEventsByDay.get(dk) ?? []
      if dayPrs.length < 3:  // 3/day cap
        allPrEvents.push(event)
        prEventsByDay.set(dk, [...dayPrs, event])

    // If primaries differ: update map (new metric type becomes new baseline), no PR event.
    // Step 3: Update prior map with this workout's best regardless of PR outcome
    prBestByExercise.set(canon, workoutBest)
```

**PR Attribute Map** (`PR_ATTRIBUTE_MAP` in `rules.ts`):
- Canonical name includes "squat hold", "toe touch", "shoulder", "hip", "ankle" → `"MOB"`
- Canonical name includes "run", "bike", "step-up", "stair", "row", "swim" → `"END"`
- All others → `"STR"`
- Implementation: `Array.some(keyword => canon.toLowerCase().includes(keyword))` — no regex

**Baseline mirror workouts** (`source === "baseline"`): included in PR replay. A baseline test that beats a prior best WILL generate a `pr.set` event in addition to `baseline.logged` XP. This is intentional (research S-3): `canonicalExerciseName` maps e.g. "Plank Max Hold" → "Plank" so a new baseline PR beats the working-movement prior. Both XP types coexist; the 1/day `workout.completed` cap is the only deduplication guard.

### 4.6 Streak Algorithm + Milestone Emission (HIGH-3 fix)

Run in two passes after the ledger is built. **Milestone events are emitted during the "longest" chronological pass** — when an adherence run's length crosses a threshold, one event fires on the crossing day. Milestones are per-run and re-earnable (reset on break). Multiple runs can each independently cross 7 (each earns `streak.milestone` 7).

```
MILESTONE_THRESHOLDS = [7, 14, 30, 60, 90]
MILESTONE_XP = { 7: 50, 14: 75, 30: 100, 60: 150, 90: 200 }
milestoneEvents: XpEvent[] = []

// ── Pass 1: chronological (longest + milestone emission) ──
streak.longest = 0
runLength = 0
for each entry in ledger (sorted by date asc):
  if !entry.isInPlan: continue
  if entry.streakSuccess:
    runLength++
    streak.longest = max(streak.longest, runLength)
    for threshold in MILESTONE_THRESHOLDS:
      if runLength === threshold:   // exact crossing, not >=; emits exactly once per crossing
        milestoneEvents.push({
          dateKey: entry.dateKey,
          ruleId: "streak.milestone",
          label: `${threshold}-day streak!`,
          xp: MILESTONE_XP[threshold],
          attribute: "CON",
        })
  else:
    runLength = 0  // run resets; milestones re-earnable on the next run

// ── Pass 2: find current (walk backward from today) ──
todayDk = dateKey(now)
todayEntry = ledger.find(e => e.dateKey === todayDk)

streak.todayCounted = todayEntry?.streakSuccess ?? false

// Walk backward from today (or yesterday if today hasn't succeeded yet)
runLength = 0
if streak.todayCounted: runLength = 1  // count today first, then walk back
// Walk backward from yesterday
yesterdayOrLastPlan = ledger entries in reverse order, starting before today:
for each entry in ledger reversed:
  if entry.dateKey >= todayDk: continue
  if !entry.isInPlan: break  // stop at plan boundary
  if entry.streakSuccess: runLength++
  else: break

streak.current = runLength
```

### 4.7 Baseline On-Time Window Math

Mirrors `getBaselineSchedule` semantics (records.ts lines 189–303). Awards `baseline.onTime` (+10 CON) when a `Baseline` row's date falls within the "due" window of a checkpoint.

```
For each baseline row B in baselinesRaw:
  Find the test definition in program.template.baselineWeek (match by testName)
  if not found: skip (unknown test — still earns baseline.logged XP, not onTime)

  Compute checkpoints:
    initial target T0 = endOfDay(addDays(program.startedOn, initialWeek * 7))
    retest targets Tn = endOfDay(addDays(program.startedOn, retestWeek * 7)) for each retestWeek

  For each checkpoint target T:
    windowStart = addDays(T, -7)   // calendar addDays (start-of-day)
    windowEnd   = endOfDay(addDays(T, 7))  // end of day 7 after target

    Note: the engine uses calendar.ts addDays (start-of-day) for windowStart/windowEnd.
    This produces a window that opens slightly earlier (~23:59:59) than records.ts's
    end-of-day shifted window. Impact: +10 CON may fire if baseline is logged in the
    first ~24h of the window's opening day that records.ts wouldn't classify as "due" yet.
    Magnitude: ±10 CON per checkpoint; acceptable for single user. (See §13 Deferred.)

    if B.date >= windowStart AND B.date <= windowEnd:
      emit { dateKey: dateKey(B.date), ruleId: "baseline.onTime",
             label: `Baseline on time · ${B.testName}`, xp: 10, attribute: "CON" }
      break  // only award onTime once per baseline row (first matching checkpoint wins)
```

**CRITICAL**: Use `addDays` from `@/lib/calendar` (returns start-of-day), NOT the local `addDays` in `records.ts` (unexported; returns end-of-day). Engine import:
```typescript
import { addDays, dateKey, startOfDay, endOfDay } from "@/lib/calendar";
```

### 4.8 Event Fold → Attributes → Levels

After generating all XpEvent[]:

```
attributeXp: Map<AttributeId, number> = new Map(pack.attributes.map(a => [a.id, 0]))
unattributedXp = 0

for event in allEvents:
  if event.attribute !== null AND attributeXp.has(event.attribute):
    attributeXp.set(event.attribute, attributeXp.get(event.attribute)! + event.xp)
  else:
    unattributedXp += event.xp

overallXp = Σ attributeXp values + unattributedXp
{ level: overallLevel, xpIntoLevel: overallInto, xpToNext: overallNext } =
  levelFromXp(overallXp, OVERALL_LEVEL_BASE)

attributeStates: AttributeState[] = pack.attributes.map(def => {
  attrXp = attributeXp.get(def.id) ?? 0
  { level, xpIntoLevel, xpToNext } = levelFromXp(attrXp, ATTR_LEVEL_BASE)
  return { id: def.id, label: def.label, level, xp: attrXp, xpIntoLevel, xpToNext,
           progress: xpIntoLevel / xpToNext }
})
```

### 4.9 levelFromXp Function

Cost of level L → L+1 = `base * L`. Total XP to reach level N = `base * N*(N-1)/2`.

```typescript
// rules.ts
export const ATTR_LEVEL_BASE = 60;
export const OVERALL_LEVEL_BASE = 150;

export function levelFromXp(xp: number, base: number): {
  level: number;
  xpIntoLevel: number;
  xpToNext: number;
} {
  let level = 1;
  while (true) {
    const costOfNextLevel = base * level; // cost to go from level → level+1
    if (xp < costOfNextLevel) {
      return { level, xpIntoLevel: xp, xpToNext: costOfNextLevel };
    }
    xp -= costOfNextLevel;
    level++;
  }
}

// Sanity checks (document in blueprint, not shipped):
// ATTR (base=60): L2=60 total; L5=600; L8=1680; L9=2160; L10=2700.
// OVERALL (base=150): L2=150; L5=1500; L8=4200; L9=5400.
```

### 4.10 Badge Evaluation Pass

**Context pre-computation** (run in engine before badge pass):

```typescript
// Pre-compute requiredInitialTestNames from live planJson
const requiredInitialTestNames = program.template.baselineWeek
  .flatMap(d => d.tests)
  .filter(t => (t.initialWeek ?? 1) === 1)
  .map(t => t.testName);

// Pre-compute retestCheckpoints: one entry per distinct retest weekIndex
const retestCheckpointMap = new Map<number, Set<string>>();
for (const baselineDay of program.template.baselineWeek) {
  for (const test of baselineDay.tests) {
    for (const retestWeek of (test.retestWeeks ?? [])) {
      const set = retestCheckpointMap.get(retestWeek) ?? new Set<string>();
      set.add(test.testName);
      retestCheckpointMap.set(retestWeek, set);
    }
  }
}
const retestCheckpoints = Array.from(retestCheckpointMap.entries())
  .map(([weekIndex, names]) => ({ weekIndex, testNames: Array.from(names) }));

// nutritionQualDays: sorted dateKeys with ≥2 nutrition entries
const nutritionQualDays = Array.from(nutritionCountByDay.entries())
  .filter(([, count]) => count >= 2)
  .map(([dk]) => dk)
  .sort();
```

Then build `EngineContext` with these fields and run badge evaluation:

```
for each badgeDef in BADGE_CATALOG:
  dateKey = badgeDef.unlock(ctx)   // pure predicate over EngineContext
  results.push({ def: badgeDef, dateKey })

// Sort: unlocked (dateKey non-null) sorted by dateKey asc; locked last
```

#### 4.10.A Badge Predicate Pseudocode (MED-5 fix — all 16 badges)

The `unlock(ctx: EngineContext): string | null` function returns the dateKey the badge was first earned, or `null` if not yet unlocked.

**Simple predicates** (one-liner):

| Badge | Predicate |
|-------|----------|
| 1 First Blood | `ctx.workoutsAll.find(w => w.status === "completed")?.startedAt` → dateKey |
| 2 On Record | `ctx.events.find(e => e.ruleId === "pr.set")?.dateKey` |
| 6 Trail Rat | `ctx.hikesAll.find(h => h.status === "completed")?.date` → dateKey |
| 16 Self-Examined | `ctx.reviewNoteDateKeys[0] ?? null` (earliest review) |

**Complex predicates with pseudocode:**

**Badge #3 — PR Machine (10 PRs):**
```
prEvents = ctx.events.filter(e => e.ruleId === "pr.set").sort by dateKey asc
if prEvents.length < 10: return null
return prEvents[9].dateKey  // dateKey of the 10th PR event
```

**Badge #4 — Baseline Scholar (HIGH-2 + MR-1 fix):**
```
// "Every test scheduled for initial week has ≥1 logged result on any date."
// Tests added later via baseline_ops join the set automatically (planJson is live).
if ctx.requiredInitialTestNames.length === 0: return null  // no initial tests defined

loggedNames = new Set(ctx.baselineLogged.map(b => b.testName))

// Walk baselineLogged chronologically; find the earliest date by which all
// required tests have been seen.
seenNames = new Set<string>()
sortedBaselines = ctx.baselineLogged.sorted by dateKey asc
for baseline in sortedBaselines:
  if ctx.requiredInitialTestNames.includes(baseline.testName):
    seenNames.add(baseline.testName)
    if ctx.requiredInitialTestNames.every(n => seenNames.has(n)):
      return baseline.dateKey  // first date all initial tests were complete

return null
```

**Badge #5 — Retest Ritualist:**
```
// "At least one retest checkpoint has all its scheduled tests logged."
if ctx.retestCheckpoints.length === 0: return null

loggedByName = new Map<string, string>()  // testName → earliest dateKey
for baseline in ctx.baselineLogged.sorted by dateKey asc:
  if !loggedByName.has(baseline.testName):
    loggedByName.set(baseline.testName, baseline.dateKey)

// Find the earliest checkpoint completion date
unlockDateKey: string | null = null
for checkpoint in ctx.retestCheckpoints:
  if checkpoint.testNames.every(n => loggedByName.has(n)):
    // This checkpoint is complete; find when its last test was logged
    latestForCp = max(checkpoint.testNames.map(n => loggedByName.get(n)!))
    if unlockDateKey === null OR latestForCp < unlockDateKey:
      unlockDateKey = latestForCp  // earliest complete checkpoint

return unlockDateKey
```

**Badge #7 — Vert Collector (≥10,000 ft cumulative):**
```
runningTotal = 0
for hike in ctx.hikesAll.filter(h => h.status === "completed").sorted by date asc:
  runningTotal += hike.elevationFt
  if runningTotal >= 10000: return dateKey(hike.date)
return null
```

**Badge #8 — High Pointer (single hike ≥3,000 ft):**
```
hike = ctx.hikesAll.filter(h => h.status === "completed" && h.elevationFt >= 3000)
         .sort by date asc [0]
return hike ? dateKey(hike.date) : null
```

**Badge #9 — Elbert Ready (single hike ≥4,000 ft):** Same as High Pointer with threshold 4000.

**Badge #10 — One Week Strong (7-day streak):**
```
// Unlock dateKey = first time any run crossed 7 days.
// Scan ctx.events for "streak.milestone" events with xp = MILESTONE_XP[7].
event = ctx.events.filter(e => e.ruleId === "streak.milestone" && e.xp === MILESTONE_XP[7])
         .sort by dateKey asc [0]
return event?.dateKey ?? null
```

**Badge #11 — Fortnight Forge (14-day):** Same pattern, MILESTONE_XP[14].
**Badge #12 — Iron Month (30-day):** Same, MILESTONE_XP[30].

**Badge #13 — Set Centurion (500 total sets):**
```
// Walk all completed workout sets chronologically; find when count hits 500.
count = 0
for workout in ctx.workoutsAll.filter(w => w.status === "completed").sort by startedAt asc:
  // Note: WorkoutRow in EngineContext doesn't carry sets; pre-compute totalSetsByWorkout
  // in engine before EngineContext construction.
  setsInWorkout = preComputedSetCountByWorkoutId.get(workout.id) ?? 0
  count += setsInWorkout
  if count >= 500: return dateKey(workout.startedAt)
return null
```

> Engine must pre-compute `setCountByWorkoutId: Map<workoutId, number>` from EngineData.workouts before building EngineContext. Add `totalSetCount` (total across all completed workouts) as the quick check.

**Badge #14 — Hundred-Ton Hauler (200,000 lb total volume):**
```
// Similar to Set Centurion; pre-compute tonnage by workout.
runningTonnage = 0
for workout in ctx.workoutsAll.filter(w => w.status === "completed").sort by startedAt asc:
  tonnageForWorkout = preComputedTonnageByWorkoutId.get(workout.id) ?? 0
  runningTonnage += tonnageForWorkout
  if runningTonnage >= 200000: return dateKey(workout.startedAt)
return null
```

**Badge #15 — Clean Week (7 consecutive calendar days with ≥2 nutrition entries):**
```
// ctx.nutritionQualDays is sorted dateKeys with ≥2 entries.
// Scan for 7 consecutive calendar days in that list.
runLength = 0
prevDk: string | null = null
runStart: string | null = null
for dk in ctx.nutritionQualDays:
  if prevDk !== null AND daysBetween(prevDk, dk) === 1:
    runLength++
    if runLength >= 7: return dk  // dateKey of the 7th consecutive day
  else:
    runLength = 1
    runStart = dk
  prevDk = dk
return null

// daysBetween(a, b): number of calendar days between two dateKeys.
// Use: (parseDateKey(b) - parseDateKey(a)) / 86400000
```

### 4.11 Empty States

| Condition | Engine returns |
|-----------|---------------|
| `getActiveProgram()` returns null | `{ goalKind: null, level: 1, xp: 0, xpIntoLevel: 0, xpToNext: OVERALL_LEVEL_BASE, progress: 0, attributes: [], streak: { current: 0, longest: 0, todayCounted: false }, badges: BADGE_CATALOG.map(def => ({ def, dateKey: null })), recentEvents: [], questToday: null }` |
| Program exists, no history | Level 1, 0 XP, streak 0, all badges locked — clean state |
| Goal kind without rule pack | Fall back to fitness pack; expose `goalKind` for UI hiding |

### 4.12 Complete Event Dispatch Summary

All event types, their sources, and attributes in one place:

| Rule id | Source data | Per-day cap | Attribute |
|---------|------------|-------------|-----------|
| `workout.completed` | Ledger completedWorkouts | 1/day | By day category (§4.4) |
| `workout.volume` | EngineData.workouts sets | None (per-workout) | STR |
| `workout.cardio` | EngineData.workouts duration-only sets | None (per-workout) | END |
| `pr.set` | PR replay (§4.5) | 3/day | PR_ATTRIBUTE_MAP |
| `baseline.logged` | baselinesRaw (ALL TIME) | None (per Baseline row) | BASELINE_ATTRIBUTE_MAP |
| `baseline.onTime` | baselinesRaw + template (§4.7) | Once per checkpoint per test | CON |
| `hike.completed` | hikesRaw (ALL TIME), status=completed | None | END |
| `mobility.session` | mobilityCheckins + zone2-mobility days (§4.3.B) | 1/day | MOB |
| `nutrition.day` | nutritionLogs bucketed (§4.3.A) | 1/day (≥2 rows) | CON |
| `review.weekly` | reviewNotes (ALL TIME) | 1 per note | CON |
| `adherence.day` | Ledger streakSuccess | 1/day | CON |
| `streak.milestone` | Ledger chronological replay (§4.6) | 1 per threshold-crossing per run | CON |
| `bonus.coach` | bonusRows (ALL TIME) | None | Row attribute or null |

### 4.13 React cache() Wrapping Pattern (MED-6 fix)

**First usage of React `cache()` in this codebase.** Import from `"react"`, not `"next/cache"`.

**Invariant (MED-6 fix)**: The exported `computeGameState` takes **zero arguments**. All consumers call `computeGameState()` — no args. React's `cache()` keys on the function + argument identity; callers that pass different argument objects get separate cache buckets and defeat deduplication. The `now` date is computed internally.

```typescript
// engine.ts
import { cache } from "react";

// Inner function: does the actual fetch + compute. Not exported.
async function _computeGameState(): Promise<GameState> {
  const now = new Date(); // computed internally so cache() can deduplicate no-args calls
  // ... fetch EngineData (§4.2), call computeGameStateFromData(data, now) ...
}

// Cached wrapper: request-level dedup. All page and component consumers call this.
export const computeGameState = cache(_computeGameState);

// Pure core: exported separately for testing (no cache, no DB, injectable now).
export function computeGameStateFromData(data: EngineData, now: Date): GameState { ... }
```

`opts.now` and `ComputeGameStateOpts` exist only for `computeGameStateFromData` (the pure core used in unit tests). The cached wrapper has no `opts` parameter.

---

## 5. MCP Tool Surface

### Placement
- `get_game_state` → appended at end of `registerReadTools()` (currently ends at line 1827)
- `grant_bonus_xp` → appended at end of `registerWriteTools()` (currently ends at line 3791)

### Required imports to add at top of tools.ts
```typescript
import { computeGameState } from "@/lib/game/engine";
import { rulePackForGoal } from "@/lib/game/attributes-registry";
```

### get_game_state — exact code shape

```typescript
server.registerTool(
  "get_game_state",
  {
    title: "Get RPG character state",
    description:
      "Returns the derived game state: overall level + XP, per-attribute levels and progress, " +
      "plan-adherence streak, last 10 unlocked badges, 20 recent XP events, and today's quest " +
      "projection (projected vs earned XP). Recomputed from full history on every call — " +
      "fully retroactive. Use to give progress feedback, identify which stat to target, frame " +
      "today's quest, or check whether a bonus landed.",
  },
  async () =>
    safe(async () => {
      const state = await computeGameState();
      if (!state.goalKind) {
        return { goalKind: null, message: "No active program" };
      }
      const unlockedBadges = state.badges.filter(b => b.dateKey !== null);
      return {
        goalKind: state.goalKind,
        level: state.level,
        xp: state.xp,
        xpIntoLevel: state.xpIntoLevel,
        xpToNext: state.xpToNext,
        attributes: state.attributes.map(a => ({
          id: a.id,
          label: a.label,
          level: a.level,
          xp: a.xp,
          intoLevel: a.xpIntoLevel,
          toNext: a.xpToNext,
        })),
        streak: state.streak,
        badges: unlockedBadges.slice(-10).map(b => ({
          id: b.def.id,
          name: b.def.name,
          dateKey: b.dateKey,
        })),
        lockedBadgeCount: state.badges.filter(b => b.dateKey === null).length,
        recentEvents: state.recentEvents.slice(0, 20),
        questToday: state.questToday
          ? {
              projectedXp: state.questToday.projectedXp,
              earnedXp: state.questToday.earnedXp,
              complete: state.questToday.complete,
              bonusHints: state.questToday.bonusHints,
            }
          : null,
      };
    }),
);
```

### grant_bonus_xp — exact code shape (HIGH-1 idempotency fix)

```typescript
server.registerTool(
  "grant_bonus_xp",
  {
    title: "Grant coach bonus XP",
    description:
      "Award XP for effort the plan doesn't automatically capture — e.g. 'Pushed through on 4h sleep'. " +
      "Appears in the app's XP log (✦ marked). reason is shown verbatim in the app. " +
      "Attribute must be a valid id for the active goal kind (STR|END|MOB|CON for fitness); " +
      "omit for overall-only XP. Amount capped 1–500. " +
      "Idempotent on (date, amount, reason): retrying a failed call returns alreadyGranted:true " +
      "with the existing row instead of inserting a duplicate.",
    inputSchema: {
      amount: z.number().int().min(1).max(500).describe("XP to grant (1–500)"),
      reason: z
        .string()
        .min(3)
        .max(300)
        .describe("Why — shown verbatim in the app's XP log"),
      attribute: z
        .string()
        .optional()
        .describe(
          "Attribute id for the active goal kind (e.g. STR|END|MOB|CON for fitness). " +
          "Omit for overall-only XP.",
        ),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("Defaults to today (user TZ). Format: yyyy-mm-dd"),
    },
  },
  async (input) =>
    safe(async () => {
      // 1. Resolve active goal for attribute validation
      const goal = await prisma.goal.findFirst({
        where: { active: true },
        orderBy: { updatedAt: "desc" },
        select: { id: true, kind: true },
      });
      const pack = rulePackForGoal(goal?.kind ?? "fitness");
      const validIds = pack.attributes.map(a => a.id);

      if (input.attribute !== undefined) {
        if (!validIds.includes(input.attribute)) {
          throw new Error(
            `Invalid attribute "${input.attribute}" for goal kind "${pack.goalKind}". ` +
            `Valid ids: ${validIds.join(", ")}`,
          );
        }
        if (!goal) {
          throw new Error(
            "No active goal — omit the attribute field to grant overall-only XP.",
          );
        }
      }

      // 2. Parse date
      const date = input.date ? parseDateInput(input.date) : startOfDay(new Date());

      // 3. Idempotency check (HIGH-1 fix): return existing row rather than inserting duplicate.
      //    Keyed on (date, amount, reason) — this covers the retry case where the coach
      //    re-sends the same bonus on the same day for the same reason.
      //    Return shape includes alreadyGranted:true so the coach knows it was a no-op.
      const existing = await prisma.gameBonusXp.findFirst({
        where: { date, amount: input.amount, reason: input.reason },
        select: { id: true, amount: true, reason: true, attribute: true, date: true },
      });
      if (existing) {
        const existingState = await computeGameState();
        return {
          granted: {
            id: existing.id,
            amount: existing.amount,
            reason: existing.reason,
            attribute: existing.attribute,
            dateKey: toDateKey(existing.date),
          },
          newState: {
            level: existingState.level,
            xp: existingState.xp,
            attributes: existingState.attributes.map(a => ({ id: a.id, level: a.level })),
          },
          alreadyGranted: true,
        };
      }

      // 4. Persist
      const row = await prisma.gameBonusXp.create({
        data: {
          date,
          amount: input.amount,
          reason: input.reason,
          attribute: input.attribute ?? null,
          source: "coach",
        },
      });

      // 5. Return condensed new state (cache() is per-request; this is a fresh call)
      const newState = await computeGameState();

      return {
        granted: {
          id: row.id,
          amount: row.amount,
          reason: row.reason,
          attribute: row.attribute,
          dateKey: toDateKey(row.date),
        },
        newState: {
          level: newState.level,
          xp: newState.xp,
          attributes: newState.attributes.map(a => ({ id: a.id, level: a.level })),
        },
        alreadyGranted: false,
      };
    }),
);
```

**`grant_bonus_xp` return shape:**

```typescript
{
  granted: {
    id: string;
    amount: number;
    reason: string;
    attribute: string | null;
    dateKey: string;
  };
  newState: {
    level: number;
    xp: number;
    attributes: { id: string; level: number }[];
  };
  alreadyGranted: boolean; // true = duplicate detected; row was not re-inserted
}
```

---

## 6. Component Hierarchy

### 6.1 Today Page Component Tree (with fold + LevelUpCelebration positioning fix)

**HIGH-5 fix**: `LevelUpCelebration` renders inside a medallion-scoped `<div className="relative">` that is exactly the size of the medallion (36×36 px). The `inset: 0` ring divs expand from the medallion center outward. This wrapper is provided by `CharacterHeader` around the `LevelMedallion` component.

**Exact JSX nesting for the medallion + celebration:**

```tsx
// CharacterHeader.tsx (relevant excerpt)
// The relative wrapper is 36×36 (same as medallion) so rings hug the medallion.
<div className="relative" style={{ width: 36, height: 36 }}>
  {/* Server component: renders the Bullseye + gold level chip */}
  <LevelMedallion level={state.level} progress={state.progress} size={36} />
  {/* Client island: reads localStorage, imperatively adds .level-up-ring class to ring divs */}
  {/* Ring divs are position:absolute; inset:0 — they fill this 36×36 wrapper */}
  <LevelUpCelebration level={state.level} />
</div>
```

**Full component tree:**

```
src/app/page.tsx  (server, force-dynamic)
│
├─ <CharacterHeader>        NEW — first child of .max-w-md wrapper, ABOVE hero section
│   ├─ <Link href="/character"> (entire header is one tap target ≥44px — it's ~72px)
│   │   ├─ [Row 1]
│   │   │   ├─ <div className="relative" style={{ width:36, height:36 }}>
│   │   │   │   ├─ <LevelMedallion level={state.level} progress={state.progress} size={36} />
│   │   │   │   │   ├─ <Bullseye progress={...} size={36} aria-hidden />
│   │   │   │   │   └─ <span> (gold level chip, absolute -bottom-1 -right-1)
│   │   │   │   └─ <LevelUpCelebration level={state.level} />  ← CLIENT ISLAND
│   │   │   │       └─ (renders two .level-up-ring divs: position:absolute; inset:0)
│   │   │   ├─ <XpBar value={state.xpIntoLevel} max={state.xpToNext}
│   │   │   │         label={`${state.xpIntoLevel} / ${state.xpToNext}`} />
│   │   │   └─ <StreakFlame count={state.streak.current} active={state.streak.current > 0} />
│   │   └─ [Row 2]
│   │       └─ {state.attributes.map(a => <AttributeBar key={a.id} attr={a} />)}
│   └─ (LevelUpCelebration is inside the relative wrapper above, NOT here)
│
├─ <section> hero  (existing; MODIFIED: TodayCelebration block removed, QuestCard added)
│   ├─ <div> eyeline (week/phase)          UNCHANGED
│   ├─ <h1> workoutTitle                   UNCHANGED
│   ├─ <p> date + summary                  UNCHANGED
│   │
│   ├─ [REMOVED] <TodayCelebration> + stateLabel span  ← FOLDED INTO QuestCard
│   │
│   ├─ <QuestCard>                         NEW — replaces TodayCelebration block
│   │   ├─ <TodayCelebration completed={completed} dateKey={todayDateKey} />  ← reused as-is
│   │   ├─ <span> quest label / XP numbers
│   │   └─ {completed && earnedEvents.map(...)}  ← per-event breakdown lines
│   │
│   └─ <p> rest-day tip (if isRestDay)     UNCHANGED
│
├─ <BaselineBlockCard>   UNCHANGED
├─ <BlockCard>×N         UNCHANGED
├─ <Card> nutrition      UNCHANGED
└─ <Card> recent workouts UNCHANGED
```

### 6.2 /character Page Component Tree

```
src/app/character/page.tsx  (server, force-dynamic)
│
└─ <div className="max-w-md mx-auto p-4 space-y-4">
    ├─ 1. Portrait card  (Card, no title)
    │   ├─ <div className="relative" style={{ width:64, height:64 }}>
    │   │   ├─ <LevelMedallion level={state.level} progress={state.progress} size={64} />
    │   │   └─ <LevelUpCelebration level={state.level} />  ← also present on /character
    │   ├─ <p> "Lv {level}" + label
    │   └─ <XpBar value={state.xpIntoLevel} max={state.xpToNext}
    │              label={`${state.xpIntoLevel} / ${state.xpToNext} XP`}
    │              data-testid="xp-bar-overall" />
    │
    ├─ 2. Streak card  (Card title="Streak")
    │   ├─ <StreakFlame count={state.streak.current} active={state.streak.current > 0} />
    │   ├─ <p> "N day streak · longest M · today ✓/–"
    │   └─ <p> "Next: Iron Month in K days" (next streak milestone hint)
    │
    ├─ 3. Attribute cards  (4 × Card, or 2×2 grid)
    │   └─ {state.attributes.map(a =>
    │       <Card key={a.id} title={a.label}>
    │         <div className="relative" style={{ width:28, height:28 }}>
    │           <LevelMedallion level={a.level} progress={a.progress} size={28} />
    │         </div>
    │         <XpBar value={a.xpIntoLevel} max={a.xpToNext}
    │                label={`${a.xpIntoLevel} / ${a.xpToNext} XP`}
    │                data-testid={`xp-bar-${a.id.toLowerCase()}`} />
    │         <p className="text-xs text-[var(--muted)]">Feeds: {feedsText(a.id)}</p>
    │       </Card>
    │     )}
    │
    ├─ 4. Badge wall  (Card title="Badges" action="N / 16")
    │   └─ <BadgeWall badges={state.badges} data-testid="badge-wall" />
    │
    ├─ 5. XP log  (Card title="XP Log")
    │   └─ <XpEventList events={state.recentEvents} data-testid="xp-event-list" />
    │
    └─ 6. Retroactivity footnote
        └─ <p className="text-xs text-[var(--muted)]">
             XP is derived from your full history and may shift when the plan or rules change.
           </p>
```

Note: on /character, attribute medallions (size=28) do NOT receive a `LevelUpCelebration` island — the celebration only fires on the OVERALL medallion. Only the portrait card's medallion wraps a `LevelUpCelebration`.

### 6.3 Component Props (typed)

```typescript
// XpBar.tsx
type XpBarProps = {
  value: number;
  max: number;
  label?: string;
  "data-testid"?: string;
};

// AttributeBar.tsx (header variant — no XP numbers)
type AttributeBarProps = {
  attr: Pick<AttributeState, "id" | "label" | "level" | "progress">;
  "data-testid"?: string;
};

// LevelMedallion.tsx
type LevelMedallionProps = {
  level: number;
  progress: number;  // 0..1
  size?: number;     // default 36 (header), 64 (portrait), 28 (attr cards)
};

// StreakFlame.tsx
type StreakFlameProps = {
  count: number;
  active: boolean;
};

// QuestCard.tsx
type QuestCardProps = {
  questToday: QuestProjection | null;
  completed: boolean;
  todayDateKey: string;
  stateLabel: string;
};

// CharacterHeader.tsx
type CharacterHeaderProps = {
  state: GameState;
};

// BadgeWall.tsx
type BadgeWallProps = {
  badges: UnlockedBadge[];
  "data-testid"?: string;
};

// XpEventList.tsx
type XpEventListProps = {
  events: XpEvent[];
  "data-testid"?: string;
};

// LevelUpCelebration.tsx  (CLIENT ISLAND — "use client" on line 1)
type LevelUpCelebrationProps = {
  level: number;  // precomputed server-side; only number crosses the boundary
};
```

### 6.4 globals.css Additions

```css
/* Level-up ring burst — CSS-only, tokens only, reduced-motion safe.
   Applied imperatively via LevelUpCelebration's refs (classList.add).
   Rings are positioned absolutely inside the medallion's relative wrapper (36×36). */
@keyframes level-up-burst {
  0%   { transform: scale(0.8); opacity: 0.65; }
  100% { transform: scale(2.2); opacity: 0; }
}

.level-up-ring {
  position: absolute;
  inset: 0;
  border-radius: 9999px;
  border: 2px solid var(--accent);
  animation: level-up-burst 560ms cubic-bezier(0.16, 1, 0.3, 1) both;
  pointer-events: none;
}

.level-up-ring.delayed {
  animation-delay: 120ms;
}

@media (prefers-reduced-motion: reduce) {
  .level-up-ring {
    display: none;
  }
}
```

---

## 7. Data Flow

### 7.1 Today Page Render

```
1. page.tsx: const program = await getActiveProgram()       ← existing, unchanged
2. page.tsx: getTodayContext(program)                        ← existing, unchanged
3. page.tsx: Promise.all([
     ...(existing 4: latestMeasurement, recentWorkouts, resolveDay(now), todayNutrition),
     computeGameState()                                      ← NEW 5th arm (no args)
   ])
4. computeGameState: React cache() check (same-request dedup; first call: run 2-step fetch)
5. engine: getActiveProgram() standalone → planStart/planEnd → Promise.all 9 queries
6. engine: buildDayLedger([startedOn, today], overrides)
7. engine: PR replay (all-time workouts, chronological)
8. engine: supplemental event loops (nutrition, mobility, baseline onTime, streak milestones)
9. engine: fold events → attributes → levels → overall
10. engine: pre-compute EngineContext fields (requiredInitialTestNames, retestCheckpoints, etc.)
11. engine: evaluateBadges(ctx)
12. engine: questToday = filter events for todayDateKey + project if !complete
13. page.tsx: render CharacterHeader(state) + QuestCard({questToday, completed, todayDateKey})
```

### 7.2 /character Render

```
1. character/page.tsx: const state = await computeGameState()  ← no args
   → React cache() dedup applies if same request; distinct requests each compute independently.
2. Render 6 card sections.
```

### 7.3 MCP get_game_state

```
1. POST /api/mcp → safe() → computeGameState()  (no React cache benefit in MCP context)
2. 2-step fetch → computeGameStateFromData → return condensed shape
```

### 7.4 MCP grant_bonus_xp

```
1. POST /api/mcp → validate input → goal.findFirst → rulePackForGoal(kind)
2. Attribute validation
3. Idempotency check: findFirst(date, amount, reason)
   → if found: return {granted, newState, alreadyGranted:true} (no insert)
4. prisma.gameBonusXp.create
5. computeGameState() → return {granted, newState, alreadyGranted:false}
```

### 7.5 Level-Up Celebration Sequence

```
Page loads → CharacterHeader renders with level=N (server-computed integer)
→ LevelUpCelebration (client) mounts
→ useEffect reads localStorage["goaldmine.lastSeenLevel"]

CASE 1 — First install (key absent or unparseable):
  → store N silently; do NOT fire rings (no false celebration on first visit)

CASE 2 — Level increased (lastSeen < N):
  → classList.add("level-up-ring") on ring1 ref
  → classList.add("level-up-ring", "delayed") on ring2 ref
  → Both divs are absolute inside the 36×36 relative wrapper; rings expand outward
  → localStorage.setItem("goaldmine.lastSeenLevel", String(N))
  → Rings animate 560ms then disappear (CSS handles cleanup via animation:both fill-mode)

CASE 3 — Level unchanged (lastSeen === N):
  → no-op

CASE 4 — Level decreased (lastSeen > N) — retroactive rule change:
  → store N silently (localStorage.setItem); do NOT fire rings, do not celebrate
  → Level drop is silent; no UI feedback needed (XP retroactivity is disclosed on /character)

Reduced-motion: .level-up-ring { display: none } → rings never appear; level chip updates silently
```

---

## 8. Work Streams

| Stream | Covers REQs | Key Files | Depends On | Can Parallelize With |
|--------|------------|-----------|------------|---------------------|
| **Phase 0 (Contract)** | REQ-001, REQ-002 | `schema.prisma`, `types.ts`, `rules.ts`, `attributes-registry.ts` | Nothing | Nothing — must complete first |
| **Stream A (Engine)** | REQ-003, REQ-004, REQ-005, REQ-010 | `engine.ts`, `badges.ts`, `quest.ts`, `docs/project-gotchas.md` | Phase 0 complete | B, C after Phase 0 |
| **Stream B (MCP)** | REQ-006 | `tools.ts` | Phase 0 types + `attributes-registry.ts`; stubs engine call until A lands | A and C after Phase 0 |
| **Stream C (UI)** | REQ-007, REQ-008 | all `game/` components, `character/page.tsx`, `MoreSheet.tsx`, `globals.css` | Phase 0 types only; codes against fixture | A and B after Phase 0 |
| **Integration** | REQ-009 | `src/app/page.tsx` | A complete (real engine), C complete (real components) | Nothing |

### Stream B stub while A is in flight

```typescript
// In tools.ts, TEMPORARILY:
import { FIXTURE_GAME_STATE } from "@/lib/game/engine-stub";
// engine-stub.ts: export async function computeGameState() { return FIXTURE_GAME_STATE; }
// Delete and replace with real engine.ts import when A lands.
```

### Stream C fixture (codes against this corrected literal)

**MED-4 fix**: Fixture XP/level values are now correct per the level curve (ATTR_LEVEL_BASE=60, OVERALL_LEVEL_BASE=150). Previously the fixture had wrong level values. Every xp/level/xpIntoLevel/xpToNext triple below is verified against `levelFromXp`.

```typescript
// src/lib/game/fixture.ts
import type { GameState } from "@/lib/game/types";

// Level curve verification (ATTR_LEVEL_BASE=60):
//   Total XP to reach level L: 60 * L*(L-1)/2
//   L5=600, L6=900, L7=1260, L8=1680, L9=2160
// Overall curve (OVERALL_LEVEL_BASE=150):
//   L5=1500, L6=2250, L7=3150, L8=4200, L9=5400

export const FIXTURE_GAME_STATE: GameState = {
  goalKind: "fitness",
  level: 8,          // 4200 <= 4500 < 5400 → level 8 ✓
  xp: 4500,
  xpIntoLevel: 300,  // 4500 - 4200 = 300 ✓
  xpToNext: 1200,    // 150 * 8 = 1200 ✓
  progress: 0.25,    // 300/1200 ✓
  attributes: [
    { id: "STR", label: "Strength",     level: 8, xp: 1800, xpIntoLevel: 120, xpToNext: 480, progress: 0.25 },
    //   1680 <= 1800 < 2160 → L8 ✓; 1800-1680=120 ✓; 60*8=480 ✓
    { id: "END", label: "Endurance",    level: 5, xp:  720, xpIntoLevel: 120, xpToNext: 300, progress: 0.40 },
    //   600 <= 720 < 900 → L5 ✓; 720-600=120 ✓; 60*5=300 ✓
    { id: "MOB", label: "Mobility",     level: 5, xp:  630, xpIntoLevel:  30, xpToNext: 300, progress: 0.10 },
    //   600 <= 630 < 900 → L5 ✓; 630-600=30 ✓; 60*5=300 ✓
    { id: "CON", label: "Constitution", level: 7, xp: 1350, xpIntoLevel:  90, xpToNext: 420, progress: 0.214 },
    //   1260 <= 1350 < 1680 → L7 ✓; 1350-1260=90 ✓; 60*7=420 ✓
  ],
  // Sum of attr xp: 1800+720+630+1350=4500 = overall xp (no unattributed in fixture) ✓
  streak: { current: 12, longest: 18, todayCounted: true },
  badges: [
    { def: { id: "first-blood",      name: "First Blood",        hint: "Complete your first workout",                      monogram: "1st" },           dateKey: "2026-03-01" },
    { def: { id: "on-record",        name: "On Record",          hint: "Set your first PR",                                monogram: "PR" },            dateKey: "2026-03-05" },
    { def: { id: "pr-machine",       name: "PR Machine",         hint: "Set 10 PRs",                                       monogram: "×10" },           dateKey: "2026-04-02" },
    { def: { id: "baseline-scholar", name: "Baseline Scholar",   hint: "Log all initial baseline tests",                   monogram: "BS" },            dateKey: "2026-03-08" },
    { def: { id: "trail-rat",        name: "Trail Rat",          hint: "Complete your first hike",                         monogram: "△", glyphFamily: "mountain" }, dateKey: "2026-04-15" },
    { def: { id: "one-week-strong",  name: "One Week Strong",    hint: "Reach a 7-day streak",                             monogram: "7d", glyphFamily: "flame" },  dateKey: "2026-03-14" },
    { def: { id: "self-examined",    name: "Self-Examined",      hint: "Write your first weekly review",                   monogram: "✓" },             dateKey: "2026-03-22" },
    { def: { id: "retest-ritualist", name: "Retest Ritualist",   hint: "Complete a full baseline retest checkpoint",       monogram: "RT" },            dateKey: null },
    { def: { id: "vert-collector",   name: "Vert Collector",     hint: "Accumulate 10,000 ft elevation across all hikes",  monogram: "10k", glyphFamily: "mountain" }, dateKey: null },
    { def: { id: "high-pointer",     name: "High Pointer",       hint: "Complete a single hike with ≥3,000 ft elevation", monogram: "3k", glyphFamily: "mountain" }, dateKey: null },
    { def: { id: "elbert-ready",     name: "Elbert Ready",       hint: "Complete a single hike with ≥4,000 ft elevation", monogram: "El", glyphFamily: "mountain" }, dateKey: null },
    { def: { id: "fortnight-forge",  name: "Fortnight Forge",    hint: "Reach a 14-day streak",                           monogram: "14d", glyphFamily: "flame" },  dateKey: null },
    { def: { id: "iron-month",       name: "Iron Month",         hint: "Reach a 30-day streak",                           monogram: "30d", glyphFamily: "flame" },  dateKey: null },
    { def: { id: "set-centurion",    name: "Set Centurion",      hint: "Log 500 total sets",                              monogram: "5c" },            dateKey: null },
    { def: { id: "hundred-ton",      name: "Hundred-Ton Hauler", hint: "Lift 200,000 lb total volume",                    monogram: "HT" },            dateKey: null },
    { def: { id: "clean-week",       name: "Clean Week",         hint: "Log 7 consecutive days of 2+ nutrition entries",  monogram: "7N" },            dateKey: null },
  ],
  recentEvents: [
    { dateKey: "2026-06-09", ruleId: "pr.set",            label: "PR · Bench Press",                   xp: 40, attribute: "STR" },
    { dateKey: "2026-06-09", ruleId: "workout.completed",  label: "Upper workout",                      xp: 25, attribute: "STR" },
    { dateKey: "2026-06-09", ruleId: "adherence.day",      label: "Plan adherence",                     xp: 10, attribute: "CON" },
    { dateKey: "2026-06-08", ruleId: "bonus.coach",        label: "Coach: Pushed through on 4h sleep",  xp: 25, attribute: "END" },
    { dateKey: "2026-06-08", ruleId: "workout.completed",  label: "Zone 2 / Mobility",                  xp: 25, attribute: "MOB" },
    { dateKey: "2026-06-07", ruleId: "hike.completed",     label: "Hike completed",                     xp: 60, attribute: "END" },
    { dateKey: "2026-06-06", ruleId: "workout.completed",  label: "Calisthenics",                       xp: 25, attribute: "STR" },
    { dateKey: "2026-06-05", ruleId: "nutrition.day",      label: "Nutrition logged",                   xp:  5, attribute: "CON" },
    { dateKey: "2026-06-04", ruleId: "baseline.logged",    label: "Baseline · Plank",                   xp: 20, attribute: "CON" },
    { dateKey: "2026-06-04", ruleId: "baseline.onTime",    label: "Baseline on time · Plank",           xp: 10, attribute: "CON" },
  ],
  questToday: {
    projectedXp: 70,
    earnedXp: 75,
    earnedEvents: [
      { dateKey: "2026-06-09", ruleId: "workout.completed", label: "Upper workout",    xp: 25, attribute: "STR" },
      { dateKey: "2026-06-09", ruleId: "pr.set",            label: "PR · Bench Press", xp: 40, attribute: "STR" },
      { dateKey: "2026-06-09", ruleId: "adherence.day",     label: "Plan adherence",   xp: 10, attribute: "CON" },
    ],
    complete: true,
    bonusHints: ["PR chance +40 STR"],
  },
};
```

---

## 9. Implementation Order

1. **Phase 0a** — Migrate schema. Add "baseline" to Workout.source comment. Run `prisma migrate dev` + `generate`. Verify `GameBonusXp` in client.
2. **Phase 0b** — Write `src/lib/game/types.ts` (pure contracts, updated EngineContext). `npx tsc --noEmit` must pass.
3. **Phase 0c** — Write `src/lib/game/rules.ts` (`levelFromXp`, XP constants, category map, MILESTONE_XP). Sanity-check level curve manually using the table in §4.9.
4. **Phase 0d** — Write `src/lib/game/attributes-registry.ts` (`FITNESS_RULE_PACK`, `rulePackForGoal`).
5. **Parallel: Stream A begins** — `engine.ts` (2-step fetch, unbounded queries, pure-select workout query), `badges.ts` (all 16 predicates with pseudocode from §4.10.A), `quest.ts`, `project-gotchas.md` additions.
6. **Parallel: Stream B begins** — Add both tools to `tools.ts` using `engine-stub.ts`. Smoke: `tools/list` shows both; `get_game_state` returns fixture; `grant_bonus_xp` writes row; retry returns `alreadyGranted:true`.
7. **Parallel: Stream C begins** — All game components + `/character` page + `MoreSheet` + `globals.css` against `fixture.ts`. Verify LevelUpCelebration ring positioning at 36×36 scope. Verify 390 px both themes.
8. **Stream B switch** — Once A's `engine.ts` is complete, replace engine-stub import. Smoke: `get_game_state` returns real data; `grant_bonus_xp` +50 END lands in END XP.
9. **Integration (REQ-009)** — Wire `computeGameState()` (no args) into `page.tsx`. Verify no `opts.now` passed at call site. `CharacterHeader` above hero. `QuestCard` replaces `TodayCelebration` block.
10. **Final QA** — `npx tsc --noEmit`, `npm run lint`, `npm run build`, browser smoke 390 px both themes, MCP curl smoke.
11. **Cleanup** — Delete `src/lib/game/fixture.ts` and `engine-stub.ts` (if committed).

---

## 10. Critical Decisions

### D-1: types.ts is pure TypeScript — Prisma-free
**Decision**: `types.ts` imports nothing from `@/generated/prisma`, `@/lib/db`, `react`, or Next.js. `EngineData` lives in `engine.ts`.
**Rationale**: Game UI components import from `types.ts`. Prisma imports would make `types.ts` server-only, forcing components to be server-only or requiring duplication.

### D-2: React cache() — no-args pattern (MED-6 fix)
**Decision**: `computeGameState` takes zero arguments. `now` is computed internally (`new Date()`). `ComputeGameStateOpts`/`opts.now` exist only for the pure `computeGameStateFromData` (unit test injection). All page and MCP consumers call `computeGameState()` with no args.
**Rationale**: React `cache()` keys on function + argument identity. Callers passing different `{ now }` objects create separate cache buckets and defeat per-request deduplication. No-args guarantees all same-request callers share one result.

### D-3: TodayCelebration fold mechanics
**Decision**: `QuestCard` (server component) renders the existing `TodayCelebration` internally, replacing the standalone block in the hero. The `stateLabel` span is also absorbed.
**Rationale**: PRD §9 resolution 2 signed off. Two completion Bullseyes ~120px apart would be confusing. `TodayCelebration` is a client component that CAN be rendered inside a server parent.

### D-4: Fixture strategy for Stream C
**Decision**: `src/lib/game/fixture.ts` exports `FIXTURE_GAME_STATE` with level-curve-correct values. Stream B uses companion `engine-stub.ts`. Both files are deleted after integration.
**Rationale**: UI stream must not block on engine development. Fixture values verified against `levelFromXp` in §4.9 (MED-4 fix).

### D-5: "lower-power" vs "power" in CATEGORY_ATTRIBUTE_MAP
**Decision**: The map explicitly includes `"lower-power": "STR"`. There is no `"power"` key.
**Rationale**: `program-template.ts` line 29 defines the actual string as `"lower-power"`. PRD table's "power→STR" is shorthand only (research S-1).

### D-6: PR XP from baseline mirror workouts (intentional)
**Decision**: PR replay iterates ALL completed `WorkoutExercise` rows including `source="baseline"` mirror workouts. Both `baseline.logged` and `pr.set` XP can fire from baseline exercises.
**Rationale**: Research S-3 confirms this is intentional. `recordsSetInWorkout` processes all exercises via canonicalization. The 1/day `workout.completed` cap is the only guard needed.

### D-7: addDays — always from @/lib/calendar
**Decision**: Engine exclusively uses `addDays` from `@/lib/calendar`. The local `addDays` in `records.ts` is unexported, private, and returns `endOfDay(...)`.
**Rationale**: Research S-4 flags this divergence. Wrong `addDays` corrupts checkpoint window comparisons.

### D-8: Attribute IDs are plain strings
**Decision**: `AttributeId = string`. No TypeScript enum.
**Rationale**: PRD §3.1.2 — engine must never hardcode attribute ids. Plain strings preserve the registry pattern for future packs.

### D-9: QuestCard receives GameState.questToday — no extra query
**Decision**: `questToday` is a field on `GameState`, populated by the engine from its own in-memory ledger. `QuestCard` receives it as a prop.
**Rationale**: Research S-5 — `resolveDay(now)` is already called in `page.tsx`. The engine builds its own today entry without calling `resolveDay`. No extra queries.

### D-10: LevelUpCelebration positioning — medallion-scoped relative wrapper (HIGH-5 fix)
**Decision**: `CharacterHeader` provides `<div className="relative" style={{ width: size, height: size }}>` wrapping both `<LevelMedallion>` and `<LevelUpCelebration>`. The celebration's two ring divs are `position: absolute; inset: 0` inside this medallion-sized wrapper.
**Rationale**: CSS `.level-up-ring { position: absolute; inset: 0 }` requires a positioned ancestor sized to the medallion. Rings at header level would cover the entire ~390×72px header strip, not the 36px medallion.

### D-11: No mobility.session double-count guard (moved to §4.3.B)
**Decision**: Engine awards at most one `mobility.session` per calendar day. MobilityCheckin rows checked first; if found, the zone2-mobility workout check is skipped for that day.
**Rationale**: PRD §4.8 "1/day". The dedup uses a Set of already-emitted dateKeys.

### D-12: getActiveProgram must run before the main Promise.all (CRIT-1 fix)
**Decision**: `getActiveProgram()` is called as a standalone `await` before the 9-query `Promise.all`. `planStart`/`planEnd` are computed from its result. Early return on null skips all remaining queries.
**Rationale**: `planStart`/`planEnd` are needed to bound the overrides query and build the ledger. Cannot be computed inside the parallel fan-out.

### D-13: ALL history queries are unbounded (CRIT-3 + Tech Lead ruling)
**Decision**: Workouts+sets, hikes, baselines, nutrition, reviews, mobility, and bonuses are fetched all-time with no date bounds. Only the day ledger (and therefore streak/adherence XP) is bounded to `[startedOn, today]`. The overrides query remains bounded to the plan window (only relevant for ledger resolution).
**Rationale**: Single user; tiny data volume (~100s rows across all tables). Unbounded queries fulfill the "no cold start" PRD §1.3 promise. Revisit with take/bounds only if it ever becomes measurably slow.

### D-14: Idempotency in-code, not via DB constraint (HIGH-1 fix)
**Decision**: `grant_bonus_xp` checks for an existing row with `(date, amount, reason)` before inserting. Returns `alreadyGranted: true` with the existing row if found. No `@@unique` constraint added to the Prisma schema.
**Rationale**: In-code check is sufficient for single-user, coach-driven workflow. Avoids a migration that modifies the table. Schema constraint can be added in a future migration if the codebase scales.

### D-15: Streak milestones are per-run and re-earnable
**Decision**: Each adherence run independently re-earns milestone XP when it crosses 7/14/30/60/90 days. A run that resets (streakSuccess=false) clears the earned-threshold memory; the next run starts fresh.
**Rationale**: Tech Lead ruling — "Multiple runs can each cross 7 (that's fine — each earns it). Deterministic on recompute." This encourages rebuilding streaks after breaks rather than permanently locking milestones.

---

## 11. Conflicts Found and Resolved

| Source | Conflict | Resolution |
|--------|----------|------------|
| PRD §4.8 "power→STR" vs template `"lower-power"` | PRD table shorthand; template string is ground truth | Use `"lower-power"` in CATEGORY_ATTRIBUTE_MAP (D-5) |
| PRD §3.1.7 "content below hero unchanged" vs TodayCelebration fold | TodayCelebration IS in the hero; fold modifies the hero completion indicator only | Fold in scope, signed off PRD §9 resolution 2 |
| PRD §4.8 "PRs sourced only from workout sets" vs research S-3 | PRD ambiguous; research confirms both XP types can fire from mirror exercise sets | Both `baseline.logged` and `pr.set` can fire from baseline exercises (D-6) |
| UX report §12 lists `LevelMedallion` as new component; PRD §4.4 omits it | UX report more specific | Include `LevelMedallion` as standalone component |
| PRD §9 Q2 uses "⚔" emoji; PRD §5.1 uses "⚔/✓" emoji | UX research replaces with Bullseye per no-icon-lib constraint | Use Bullseye |
| PRD §4.10 "Quest consumes resolveDay(now) from page" vs engine's own ledger | Engine has in-memory today entry; resolveDay used separately by page | `questToday` on `GameState` from engine; page does not re-pass resolveDay data (D-9) |
| PRD §1.3 "no cold start" vs plan-window-bounded queries in v1 blueprint | v1 CRIT-3 violation | Tech Lead ruling: unbound all history queries (D-13) |

---

## 12. Critique Resolution Log

| Issue | Resolution | Section |
|-------|-----------|---------|
| **CRIT-1**: `program` used before resolved in Promise.all | `getActiveProgram()` called as standalone `await` first; Promise.all holds 9 remaining queries | §4.2, D-12 |
| **CRIT-2**: Prisma `select`+`include` at same level | Workout `findMany` rewritten with pure nested `select` throughout | §4.2 |
| **CRIT-3**: Pre-plan PR history excluded; "no cold start" broken | All history queries unbound (all-time); only day ledger + streak bounded to plan window | §4.2, §4.5, D-13 |
| **HIGH-1**: `grant_bonus_xp` no idempotency guard | Checks `findFirst(date, amount, reason)` before insert; returns `alreadyGranted:true` | §5, D-14 |
| **HIGH-2**: `EngineContext.baselineLogDates` insufficient for Baseline Scholar | Changed to `baselineLogged: { dateKey; testName; value }[]`; added `requiredInitialTestNames` and `retestCheckpoints` | §3, §4.10 |
| **HIGH-3**: Streak milestone algorithm unspecified | Full pseudocode added to §4.6; per-run re-earnable thresholds; emitted on crossing day | §4.6, D-15 |
| **HIGH-4**: PR replay generates spurious within-workout PRs | Rewritten: per-workout grouping by canonical name first, then compare against prior-workout map | §4.5 |
| **HIGH-5**: `LevelUpCelebration` ring positioning wrong | Rings render inside medallion-scoped 36×36 relative wrapper; exact JSX nesting shown | §6.1, D-10 |
| **MED-1**: `WorkoutRow.category` implicit, no algorithm step | Explicit assignment step added to §4.3: `category: workoutTemplate?.category ?? null` | §4.3 |
| **MED-2**: Volume/cardio farm undocumented | Documented per-workout semantics in §4.3.C with rules.ts comment guidance | §4.3.C |
| **MED-3**: `baseline.onTime` window 24h drift | Deferred (§13) — acknowledged, impact is ±10 CON per checkpoint | §4.7, §13 |
| **MED-4**: Fixture wrong level values | Fixture corrected; all xp/level/xpIntoLevel/xpToNext verified against §4.9 levelFromXp | §8 |
| **MED-5**: Badge predicates unspecified for 5 complex badges | Pseudocode added for all 16; detailed for Baseline Scholar, Retest Ritualist, Vert Collector, High Pointer, Set Centurion, Hundred-Ton Hauler, Clean Week | §4.10.A |
| **MED-6**: `cache()` opts coupling; dedup won't fire | No-args pattern documented and enforced; `opts.now` restricted to `computeGameStateFromData` only | §4.13, D-2 |
| **MR-1**: Baseline Scholar needs program template context not in EngineContext | Pre-compute `requiredInitialTestNames` + `retestCheckpoints` in engine; add to EngineContext | §3, §4.10 |
| **MR-2**: `nutrition.day` per-day cap not in algorithm | Added explicit nutrition bucketing pseudocode to §4.3.A | §4.3.A |
| **MR-3**: `mobility.session` dedup in decisions only | Moved to §4.3.B algorithm pseudocode with Set-based dedup | §4.3.B |
| **MR-4**: `Workout.source = "baseline"` undocumented in schema | Added "baseline" to Workout.source comment in §2; gotchas entry planned | §2 |
| **Level decrease edge** | §7.5 specifies: stored > current → store lower silently, never celebrate | §7.5 |

---

## 13. Deferred Items

Items deliberately deferred with rationale. Revisit when triggered.

| Item | Rationale for Deferral |
|------|----------------------|
| **MED-3: baseline.onTime window 24h drift** — engine window opens ~24h earlier than records.ts's `endOfDay` shifted window | Impact: ±10 CON per checkpoint. Cosmetic inconsistency. Matching records.ts semantics exactly requires importing or duplicating the `endOfDay(addDaysCal(...))` pattern, adding complexity for minimal benefit. Revisit if the coach/user notices the discrepancy. |
| **MED-2: Volume/cardio per-day cap** | Intentional per-workout XP for single user. Add a cap only if the user reports gaming or accidentally double-imports workouts repeatedly. |
| **Schema `@@unique([date, reason, amount, source])`** | In-code idempotency check (D-14) is sufficient. Formal DB constraint adds a migration with no behavioral gain today. Add in a future migration if the tool surface is shared across multiple callers. |
| **`Goal.attributeConfig Json` column** | Out of scope (PRD §3.3). Future non-fitness packs define their own rule packs in code first; per-goal attribute config is a later extension. |
| **Cache-tag revalidation (`unstable_cache`)** | Out of scope (PRD §3.3). All pages are `force-dynamic`; per-request recompute is fine at current scale. |
| **Optional mountain/flame glyphs in BadgeWall** | Visual polish, marked ⚠ in PRD §9. Implement in visual-QA pass after core feature ships. |
| **MoreSheet shield/bust icon** | Aesthetic decision (⚠ in PRD §9). Use simplest inline SVG that reads as "person/character" on first pass; refine in visual-QA. |
| **Set Centurion / Hundred-Ton Hauler per-workout lookup optimization** | Requires `setCountByWorkoutId` and `tonnageByWorkoutId` Maps pre-computed from `EngineData.workouts`. Currently noted in §4.10.A as a required pre-computation. With ~50–300 workouts the nested scan is O(n) and perfectly acceptable; no optimization needed. |

## Post-v2 amendments (Tech Lead)

These four rulings were applied after v2 was finalized (2026-06-09). All downstream agents MUST use the corrected values from `src/lib/game/rules.ts`; do NOT invent inline constants.

| # | Ruling | File(s) | Detail |
|---|--------|---------|--------|
| 1 | **Hike XP is elevation-scaled, not flat** | `src/lib/game/rules.ts` | Replaced flat `HIKE_COMPLETED: 60` with `HIKE_BASE: 30`, `HIKE_PER_1000FT: 10`, `HIKE_ELEVATION_BONUS_CAP: 60`, `HIKE_PACK_BONUS: 10`, and top-level `HIKE_PACK_THRESHOLD_LB = 20`. A pure helper `hikeXp(elevationFt, packWeightLb)` was added. **Stream A and any quest-projection code MUST call `hikeXp()` from `rules.ts`** — never inline the formula. Formula: `base(30) + min(floor(elevationFt/1000)×10, 60) + (packWeightLb ≥ 20 ? 10 : 0)`. |
| 2 | **CON label is "Consistency", not "Constitution"** | `src/lib/game/types.ts`, `src/lib/game/attributes-registry.ts`, `src/lib/game/fixture.ts` | The `AttributeState.label` comment, the FITNESS_ATTRIBUTES entry (label + feedsText), and the fixture all now read "Consistency". The correct feedsText is: `"Streaks, plan adherence, logging habits, weekly reviews"`. Any new UI copy or test fixture for CON must use "Consistency". |
| 3 | **`REVIEW_WEEKLY` is 25, not 20** | `src/lib/game/rules.ts` | Corrected to match PRD §4.8. All XP ledger calculations and quest projections use `FITNESS_XP.REVIEW_WEEKLY` (now 25). |
| 4 | **"Plank Max Hold" maps to STR, not CON** | `src/lib/game/rules.ts` | `BASELINE_ATTRIBUTE_MAP["Plank Max Hold"]` changed from `"CON"` to `"STR"`. PRD groups plank with the strength baselines (upper-body holds are strength, not conditioning). |
