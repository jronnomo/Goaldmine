# Architecture Blueprint — RPG Character Stats

**Author**: Claude (Architect Agent)
**Date**: 2026-06-09
**Feature**: RPG Character Stats (REQ-001..REQ-010)
**Status**: FINAL — Developer Agents build from this document

> Ground truth precedence: research-output.md > PRD > this blueprint. When this doc conflicts with research-output.md, treat the research as correct and flag the conflict.

---

## 1. File Plan

Creation order respects deps. Phase 0 first (schema + contracts); then streams A/B/C in parallel; then integration.

| # | Action | Path | Purpose | Key Exports | Depends On |
|---|--------|------|---------|-------------|------------|
| 0a | modify | `prisma/schema.prisma` | Add `GameBonusXp` model | (Prisma generates `gameBonusXp` accessor) | — |
| 0b | create | `src/lib/game/types.ts` | Pure TypeScript contracts; NO Prisma imports | `XpEvent`, `AttributeState`, `GameState`, `BadgeDef`, `UnlockedBadge`, `DayLedgerEntry`, `QuestProjection`, `EngineContext`, `GameRulePack`, `AttributeDef`, `ComputeGameStateOpts`, `WorkoutRow`, `HikeRow`, `BonusRow` | — |
| 0c | create | `src/lib/game/rules.ts` | XP constants, `levelFromXp`, category→attribute map | `ATTR_LEVEL_BASE`, `OVERALL_LEVEL_BASE`, `FITNESS_XP`, `CATEGORY_ATTRIBUTE_MAP`, `PR_ATTRIBUTE_MAP`, `BASELINE_ATTRIBUTE_MAP`, `levelFromXp`, `xpForLevel`, `xpToNextLevel` | `types.ts` |
| 0d | create | `src/lib/game/attributes-registry.ts` | Attribute defs + rule pack registry | `FITNESS_RULE_PACK`, `RULE_PACKS`, `rulePackForGoal` | `types.ts`, `rules.ts` |
| A1 | create | `src/lib/game/quest.ts` | Quest XP projection (pure, no queries) | `projectQuestXp`, `earnedTodayXp` | `types.ts`, `rules.ts` |
| A2 | create | `src/lib/game/badges.ts` | 16 badge predicates | `BADGE_CATALOG`, `evaluateBadges` | `types.ts` |
| A3 | create | `src/lib/game/engine.ts` | Data fetch + pure computation | `computeGameState`, `computeGameStateFromData` | all `game/` files, `@/lib/calendar`, `@/lib/records`, `@/lib/db`, `@/lib/program` |
| B1 | modify | `src/lib/mcp/tools.ts` | Register `get_game_state` + `grant_bonus_xp` | (registered on McpServer) | `types.ts`, `attributes-registry.ts`, `engine.ts` |
| C1 | create | `src/components/game/XpBar.tsx` | Accessible XP progress bar (server) | `XpBar` | `types.ts` |
| C2 | create | `src/components/game/AttributeBar.tsx` | Attribute label+level+bar row (server) | `AttributeBar` | `types.ts` |
| C3 | create | `src/components/game/LevelMedallion.tsx` | Bullseye progress mode + level chip (server) | `LevelMedallion` | `Bullseye` |
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
| I2 | modify | `docs/project-gotchas.md` | Three new gotcha entries | (doc) | — |

---

## 2. Prisma Schema Changes

### Placement
Add `GameBonusXp` at the end of `prisma/schema.prisma`, after the `Program` model (line 330). Follow the same whitespace convention (blank line between models).

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
  xp: number;             // overall total (Σ all attr + unattributed)
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
  recentEvents: XpEvent[];   // last 30 across all attributes + unattributed
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
  category: string | null; // resolved from DayTemplate on that date
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
export type DayLedgerEntry = {
  dateKey: string;
  isInPlan: boolean;
  isRestDay: boolean;
  completedWorkouts: WorkoutRow[];     // status === "completed"
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
  baselineLogDates: string[];    // dateKey of every Baseline row (for Baseline Scholar check)
  reviewNoteDateKeys: string[];  // dateKey of every review Note
  bonusRows: BonusRow[];
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
  // categoryToAttribute: key is DayTemplate.category string, value is AttributeId
  // Not a field here — lives in rules.ts as CATEGORY_ATTRIBUTE_MAP (fitness-specific)
  // Future non-fitness packs will add their own maps alongside their pack def.
};

// Entry point options
export type ComputeGameStateOpts = {
  now?: Date; // defaults to new Date(); injectable for isolation/testing
};
```

---

## 4. Engine Design

### 4.1 EngineData (internal to engine.ts — NOT exported to types.ts)

```typescript
// engine.ts — internal, server-only
type EngineData = {
  program: ActiveProgramSnapshot | null;
  goal: { id: string; kind: string } | null;
  // Workouts with full exercise+set tree for PR replay + volume
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
  hikes: Array<{
    id: string;
    date: Date;
    status: string;
    elevationFt: number;
    packWeightLb: number | null;
    durationMin: number;
  }>;
  baselines: Array<{
    id: string;
    date: Date;
    testName: string;
  }>;
  // NutritionLog — only date needed; count rows per day
  nutritionLogs: Array<{ date: Date }>;
  reviewNotes: Array<{ date: Date }>;
  mobilityCheckins: Array<{ date: Date }>;
  // Keyed by dateKey for O(1) lookup in buildDayLedger
  overridesByKey: Map<string, {
    workoutJson: unknown;      // null = explicit clear → falls to rotation
    baselineTestNames: string[] | null; // null = use rotation; [] = none
  }>;
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

### 4.2 The ~10-Query Promise.all

All queries bounded to `[planStart, planEnd]` where:
```
planStart = startOfDay(program.startedOn)
planEnd   = endOfDay(addDays(program.startedOn, program.template.totalWeeks * 7 - 1))
```

```typescript
// engine.ts — inside computeGameState (before React cache wrapping)
const [
  program,
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
  getActiveProgram(),   // 1-2 internal queries; returns ActiveProgramSnapshot | null
  prisma.goal.findFirst({
    where: { active: true },
    orderBy: { updatedAt: "desc" },
    select: { id: true, kind: true },
  }),
  // Workouts: full tree (exercises + sets) for PR replay + volume
  program ? prisma.workout.findMany({
    where: { startedAt: { gte: planStart, lte: planEnd } },
    include: {
      exercises: {
        include: { sets: { select: { weightLb: true, reps: true, durationSec: true } } },
        select: { name: true },
      },
    },
    select: { id: true, startedAt: true, status: true, source: true },
  }) : Promise.resolve([]),
  // Hikes
  program ? prisma.hike.findMany({
    where: { date: { gte: planStart, lte: planEnd } },
    select: { id: true, date: true, status: true, elevationFt: true, packWeightLb: true, durationMin: true },
  }) : Promise.resolve([]),
  // Baselines — date + testName only
  program ? prisma.baseline.findMany({
    where: { date: { gte: planStart, lte: planEnd } },
    select: { id: true, date: true, testName: true },
  }) : Promise.resolve([]),
  // NutritionLog — date only (count rows per day)
  program ? prisma.nutritionLog.findMany({
    where: { date: { gte: planStart, lte: planEnd } },
    select: { date: true },
  }) : Promise.resolve([]),
  // Review notes
  program ? prisma.note.findMany({
    where: { type: "review", date: { gte: planStart, lte: planEnd } },
    select: { date: true },
  }) : Promise.resolve([]),
  // Mobility checkins
  program ? prisma.mobilityCheckin.findMany({
    where: { date: { gte: planStart, lte: planEnd } },
    select: { date: true },
  }) : Promise.resolve([]),
  // PlanDayOverrides — all in plan window, keyed by planId
  program ? prisma.planDayOverride.findMany({
    where: { planId: program.id, date: { gte: planStart, lte: planEnd } },
    select: { date: true, workoutJson: true, baselineTestNames: true },
  }) : Promise.resolve([]),
  // GameBonusXp — unbounded (typically small; no date filter needed)
  prisma.gameBonusXp.findMany({
    select: { id: true, date: true, amount: true, reason: true, attribute: true, source: true },
  }),
]);
```

**Note on `getActiveProgram()`**: must be called FIRST (not inside the Promise.all) because `planStart`/`planEnd` depend on it. Alternatively, call it first, then fan out the remaining 9 queries via a single `Promise.all`.

### 4.3 buildDayLedger Algorithm

Produces `DayLedgerEntry[]` for every in-plan calendar day without calling `resolveDay`.

```
INPUTS:
  program: ActiveProgramSnapshot
  workoutsByDay: Map<dateKey, WorkoutRow[]>  // pre-bucketed from EngineData
  hikesByDay: Map<dateKey, HikeRow[]>
  baselinesByDay: Map<dateKey, string[]>     // dateKey → testName[]
  nutritionCountByDay: Map<dateKey, number>  // dateKey → row count
  overridesByKey: Map<dateKey, OverrideRow>
  now: Date

ALGORITHM (for each day d in 0..totalWeeks*7-1):
  date = addDays(program.startedOn, d)        // @/lib/calendar addDays (start-of-day)
  dk = dateKey(date)

  // Step 1 — in-plan check
  daysDelta = d
  isInPlan = true (d is 0..totalWeeks*7-1 by construction)

  // Step 2 — rotation math
  rotationDay = ((daysDelta % 7) + 7) % 7 + 1   // 1..7
  weekIndex = floor(daysDelta / 7) + 1

  // Step 3 — override lookup
  override = overridesByKey.get(dk) ?? null

  // Step 4 — workout template resolution
  if override?.workoutJson != null:          // strict null check
    workoutTemplate = override.workoutJson as DayTemplate
    isOverride = true
  else:
    workoutTemplate = program.template.weeklySplit.find(d => d.dayOfWeek === rotationDay) ?? null
    isOverride = false

  // Step 5 — baseline names resolution
  overrideNames = Array.isArray(override?.baselineTestNames) ? override.baselineTestNames : null
  if overrideNames !== null:
    dueBaselineNames = overrideNames  // exact list; [] = none; weekIndex filter bypassed
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

  // Collect day's data
  completedWorkouts = workoutsByDay.get(dk)?.filter(w => w.status === "completed") ?? []
  completedHikes = hikesByDay.get(dk)?.filter(h => h.status === "completed") ?? []
  loggedBaselineNames = baselinesByDay.get(dk) ?? []
  allDueBaselinesLogged = dueBaselineNames.length > 0 &&
    dueBaselineNames.every(name => loggedBaselineNames.includes(name))
  isRestDay = workoutTemplate?.category === "rest"
  hasPlannedHike = (hikesByDay.get(dk) ?? []).some(h => h.status === "planned")

  // Step 7 — streak / adherence success
  isToday = dk === dateKey(now)
  if isRestDay:
    streakSuccess = true
  else if completedWorkouts.length > 0 OR completedHikes.length > 0 OR allDueBaselinesLogged:
    streakSuccess = true
  else if hasPlannedHike AND completedHikes.length === 0 AND completedWorkouts.length === 0:
    streakSuccess = false  // planned-hike skip with no workout = break
  else if isToday:
    streakSuccess = false  // excluded from break scan but marks as not yet succeeded
  else:
    streakSuccess = false  // missed workout

  // emit DayLedgerEntry
```

**Today grace rule**: The streak break scan iterates ledger entries up to (not including) today. "Longest" and "Current" are computed after the ledger is complete. Today is included in `current` only if `streakSuccess = true` on today's entry.

### 4.4 Day Category → Attribute Mapping

Define in `rules.ts` as `CATEGORY_ATTRIBUTE_MAP`:

| `DayTemplate.category` | XP Attribute | Note |
|------------------------|-------------|------|
| `"upper"` | `"STR"` | Day 1 |
| `"lower"` | `"STR"` | Day 2 |
| `"zone2-mobility"` | `"MOB"` | Day 3 |
| `"calisthenics"` | `"STR"` | Day 4 |
| `"lower-power"` | `"STR"` | Day 5 — **must be `"lower-power"`, NOT `"power"`** |
| `"long-endurance"` | `"END"` | Day 6 |
| `"rest"` | `null` | No `workout.completed` XP on rest days |
| (off-plan or unknown) | `"STR"` | Fallback |

### 4.5 PR Replay Algorithm

Uses `canonicalExerciseName`, `bestSetSummary`, `epley1RM` imported from `@/lib/records` — never reimplemented.

```
INPUTS:
  All WorkoutExercise rows + sets (from EngineData.workouts), sorted chronologically by workout.startedAt

STATE:
  prBestByExercise: Map<canonicalName, { primary: "rm"|"reps"|"duration", value: number }>
  prEventsByDay: Map<dateKey, XpEvent[]>  // for 3/day cap
  allPrEvents: XpEvent[]

ALGORITHM:
  Sort workouts by startedAt ascending.
  For each workout (including source="baseline" mirrors):
    For each exercise:
      canon = canonicalExerciseName(exercise.name)
      summary = bestSetSummary(exercise.sets)
      if summary === null: continue

      prior = prBestByExercise.get(canon)
      if prior === null OR prior === undefined:
        // First ever record for this movement — NOT a PR (nothing to beat)
        prBestByExercise.set(canon, { primary: summary.primary, value: summary.value })
        continue

      if summary.primary === prior.primary AND summary.value > prior.value:
        // Strict improvement — PR!
        prBestByExercise.set(canon, { primary: summary.primary, value: summary.value })
        dk = dateKey(workout.startedAt)
        dayPrs = prEventsByDay.get(dk) ?? []
        if dayPrs.length < 3:  // 3/day cap
          attr = PR_ATTRIBUTE_MAP(canon)  // exercise-name-based attribute dispatch
          event = { dateKey: dk, ruleId: "pr.set", label: `PR · ${canon}`, xp: FITNESS_XP.PR_SET, attribute: attr }
          allPrEvents.push(event)
          prEventsByDay.set(dk, [...dayPrs, event])
      else:
        // Not a PR — still update if metrics incompatible? No: only count strict same-primary improvement.
        // If primary differs (e.g., prior was reps-only, now weighted), treat the new best as the new baseline.
        if summary.primary !== prior.primary:
          prBestByExercise.set(canon, { primary: summary.primary, value: summary.value })
```

**PR Attribute Map** (`PR_ATTRIBUTE_MAP` in `rules.ts`):
- If canonical name includes "squat hold", "toe touch", "shoulder", "hip", "ankle" → `"MOB"`
- If canonical name includes "run", "bike", "step-up", "stair", "row", "swim" → `"END"`
- All others → `"STR"`
- Implementation: simple `Array.some(keyword => canon.toLowerCase().includes(keyword))` — no regex

### 4.6 Streak Algorithm

After building the full ledger:

```
streak = { current: 0, longest: 0, todayCounted: false }

// Find longest: walk entire ledger
runLength = 0
for entry in ledger (sorted by date asc):
  if !entry.isInPlan: continue
  if entry.streakSuccess:
    runLength++
    streak.longest = max(streak.longest, runLength)
  else:
    runLength = 0

// Find current: walk from today backward
todayDk = dateKey(now)
runLength = 0
todayEntry = ledger.find(e => e.dateKey === todayDk)
if todayEntry?.streakSuccess:
  streak.todayCounted = true

// Walk backward from yesterday (or today if today succeeded)
startFrom = todayEntry?.streakSuccess ? todayDk : dateKey(addDays(now, -1))
for entry in ledger reversed from startFrom:
  if !entry.isInPlan: break  // stop at plan boundary
  if entry.streakSuccess: runLength++
  else: break
streak.current = runLength
```

### 4.7 Baseline On-Time Window Math

Mirrors `getBaselineSchedule` (records.ts line ~189). The engine awards `baseline.onTime` (+10 CON) when a `Baseline` row's date falls within the "due" window of a checkpoint.

```
For each testName in EngineData.baselines:
  Find the test definition in program.template.baselineWeek
  Compute initial target: endOfDay(addDays(program.startedOn, initialWeek * 7))
  Compute each retest target: endOfDay(addDays(program.startedOn, retestWeek * 7))
  
  For each checkpoint target T:
    windowStart = addDays(T, -7)  // @/lib/calendar addDays (start-of-day)
    windowEnd = addDays(T, 7)     // start-of-day of the day 7 after target
    // Baseline rows on exactly T±7 calendar days count as on-time
    if baseline.date >= windowStart AND baseline.date <= endOfDay(addDays(T, 7)):
      award baseline.onTime XP
```

**CRITICAL**: Use `addDays` from `@/lib/calendar` (returns start-of-day), NOT the local `addDays` in `records.ts` (returns end-of-day). The engine file must import calendar's `addDays` directly.

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
{ level: overallLevel, xpIntoLevel: overallInto, xpToNext: overallNext } = levelFromXp(overallXp, OVERALL_LEVEL_BASE)

attributeStates: AttributeState[] = pack.attributes.map(def => {
  attrXp = attributeXp.get(def.id) ?? 0
  { level, xpIntoLevel, xpToNext } = levelFromXp(attrXp, ATTR_LEVEL_BASE)
  return { id: def.id, label: def.label, level, xp: attrXp, xpIntoLevel, xpToNext, progress: xpIntoLevel / xpToNext }
})
```

### 4.9 levelFromXp Function

Cost of level L → L+1 = `base * L`. So total XP for level N = `base * Σ(1..N-1)` = `base * N*(N-1)/2`.

```typescript
// rules.ts
export const ATTR_LEVEL_BASE = 60;
export const OVERALL_LEVEL_BASE = 150;

export function levelFromXp(xp: number, base: number): {
  level: number;
  xpIntoLevel: number;
  xpToNext: number;
} {
  // Find level L such that totalCostUpToL <= xp < totalCostUpToL+1
  // Total XP to reach level L: base * L*(L-1)/2
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

// Sanity check (not shipped, document in blueprint):
// ATTR: L2 costs 60*1=60 total. L3 costs 60+120=180 total. L10 costs Σ60*[1..9]=2700 total. ✓
// OVERALL: L2 costs 150*1=150. L10 costs Σ150*[1..9]=6750 total. ✓
```

### 4.10 Badge Evaluation Pass

Run AFTER events, ledger, and EngineContext are computed:

```
for each badgeDef in BADGE_CATALOG:
  dateKey = badgeDef.unlock(ctx)   // pure predicate over EngineContext
  results.push({ def: badgeDef, dateKey })

// Sort: unlocked (dateKey non-null) sorted by dateKey asc; locked last
```

### 4.11 Empty States

| Condition | Engine returns |
|-----------|---------------|
| `getActiveProgram()` returns null | `{ goalKind: null, level: 1, xp: 0, xpIntoLevel: 0, xpToNext: OVERALL_LEVEL_BASE, progress: 0, attributes: [], streak: { current: 0, longest: 0, todayCounted: false }, badges: BADGE_CATALOG.map(def => ({ def, dateKey: null })), recentEvents: [], questToday: null }` |
| Program exists, no history | Level 1, 0 XP, streak 0, all badges locked — clean state |
| Goal kind without rule pack | Fall back to fitness pack; expose `goalKind` for UI hiding |

### 4.12 React cache() Wrapping Pattern

**First usage of React `cache()` in this codebase.** Import from `"react"`, not `"next/cache"`. Scopes deduplication to one HTTP request (works because all pages are `force-dynamic` server components).

```typescript
// engine.ts
import { cache } from "react";

// The inner async function does the actual fetch + compute.
// cache() memoizes per-request based on call arguments.
// Since we have no arguments (v1), all consumers in the same request share one result.
async function _computeGameState(opts: ComputeGameStateOpts = {}): Promise<GameState> {
  const now = opts.now ?? new Date();
  // ... fetch EngineData, call computeGameStateFromData(data, now) ...
}

export const computeGameState = cache(_computeGameState);

// The pure core is exported separately for testing (no cache, no DB):
export function computeGameStateFromData(data: EngineData, now: Date): GameState { ... }
```

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
    // No inputSchema — always computes for the active goal
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

### grant_bonus_xp — exact code shape

```typescript
server.registerTool(
  "grant_bonus_xp",
  {
    title: "Grant coach bonus XP",
    description:
      "Award XP for effort the plan doesn't automatically capture — e.g. 'Pushed through on 4h sleep'. " +
      "Appears in the app's XP log (✦ marked). reason is shown verbatim in the app. " +
      "Attribute must be a valid id for the active goal kind (STR|END|MOB|CON for fitness); " +
      "omit for overall-only XP. Amount capped 1–500.",
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

      // 2. Parse date — parseDateInput handles yyyy-mm-dd → USER_TZ midnight
      const date = input.date ? parseDateInput(input.date) : startOfDay(new Date());

      // 3. Persist
      const row = await prisma.gameBonusXp.create({
        data: {
          date,
          amount: input.amount,
          reason: input.reason,
          attribute: input.attribute ?? null,
          source: "coach",
        },
      });

      // 4. Return condensed new state (cache() is per-request, so this is a fresh call)
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
      };
    }),
);
```

---

## 6. Component Hierarchy

### 6.1 Today Page Component Tree (with fold)

```
src/app/page.tsx  (server, force-dynamic)
│
├─ <CharacterHeader>        NEW — first child of .max-w-md wrapper, ABOVE hero section
│   ├─ <Link href="/character"> (entire header is one tap target ≥44px — it's ~72px)
│   │   ├─ [Row 1]
│   │   │   ├─ <LevelMedallion level={state.level} progress={state.progress} size={36} />
│   │   │   │   ├─ <Bullseye progress={...} size={36} aria-hidden />
│   │   │   │   └─ <span> (gold level chip, absolute -bottom-1 -right-1)
│   │   │   ├─ <XpBar value={state.xpIntoLevel} max={state.xpToNext}
│   │   │   │         label={`${state.xpIntoLevel} / ${state.xpToNext}`} />
│   │   │   └─ <StreakFlame count={state.streak.current} active={state.streak.current > 0} />
│   │   └─ [Row 2]
│   │       └─ {state.attributes.map(a => <AttributeBar key={a.id} attr={a} />)}
│   └─ <LevelUpCelebration level={state.level} />  ← CLIENT ISLAND, inside relative wrapper
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
    │   ├─ <LevelMedallion level={state.level} progress={state.progress} size={64} />
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
    │         <LevelMedallion level={a.level} progress={a.progress} size={28} />
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

### 6.3 Component Props (typed)

```typescript
// XpBar.tsx
type XpBarProps = {
  value: number;
  max: number;
  label?: string;           // e.g. "320 / 450" — rendered as tabular-nums text
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
  active: boolean;   // true = filled --warning; false = stroked --muted
};

// QuestCard.tsx
type QuestCardProps = {
  // Quest data
  questToday: QuestProjection | null;
  // Completion data (for TodayCelebration fold)
  completed: boolean;
  todayDateKey: string;
  stateLabel: string;  // "Completed" | "Rest day" | "Today's plan" etc.
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
  events: XpEvent[];         // last 30, includes coach bonuses
  "data-testid"?: string;
};

// LevelUpCelebration.tsx  (CLIENT ISLAND)
type LevelUpCelebrationProps = {
  level: number;  // precomputed server-side; only number crosses the boundary
};
```

### 6.4 globals.css Additions

Add after the existing `@media (prefers-reduced-motion: reduce)` block for `.week-confirm-pop`:

```css
/* Level-up ring burst — CSS-only, tokens only, reduced-motion safe.
   Applied imperatively via LevelUpCelebration's refs (classList.add).
   Rings are positioned absolutely inside the medallion's relative wrapper. */
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
1. page.tsx: const program = await getActiveProgram()         ← existing, unchanged
2. page.tsx: getTodayContext(program)                          ← existing, unchanged
3. page.tsx: Promise.all([
     ...(existing 4 queries: latestMeasurement, recentWorkouts, resolveDay(now), todayNutrition),
     computeGameState({ now })                                 ← NEW, 5th parallel arm
   ])
4. computeGameState: React cache() check (same-request: dedup; first call: run ~10-query batch)
5. computeGameState: buildDayLedger(program, bucketed data, now)
6. computeGameState: PR replay across all workouts chronologically
7. computeGameState: fold events → attributes → levels → overall
8. computeGameState: evaluateBadges(ctx)
9. computeGameState: questToday = earnedTodayXp(events, todayDateKey) + project if !complete
10. page.tsx: render CharacterHeader(state) + QuestCard({questToday, completed, todayDateKey})
    → CharacterHeader renders LevelMedallion, XpBar, AttributeBar×4, StreakFlame,
      LevelUpCelebration (client island with level:number prop)
    → QuestCard renders TodayCelebration (client island reused), quest text
```

### 7.2 /character Render

```
1. character/page.tsx: const state = await computeGameState()
   → React cache() deduplicates if both / and /character are rendered in the same request.
   → Since they're different requests (different page navigations), each computes independently.
2. Render 6 card sections (portrait, streak, 4 attr, badges, XP log, footnote)
```

### 7.3 MCP get_game_state

```
1. POST /api/mcp {"method":"tools/call","params":{"name":"get_game_state"}}
2. Fresh McpServer per request; safe() → computeGameState()
3. No React cache() benefit here (no shared request with pages)
4. ~10-query batch → computeGameStateFromData → return condensed shape
```

### 7.4 MCP grant_bonus_xp

```
1. POST /api/mcp → validate input → goal.findFirst → rulePackForGoal(kind)
2. Attribute validation → prisma.gameBonusXp.create
3. computeGameState() → return {granted, newState}
4. App re-renders on next page load (force-dynamic, no cache invalidation needed)
```

### 7.5 Level-Up Celebration Sequence

```
Page loads → CharacterHeader renders with level=N
→ LevelUpCelebration (client) mounts
→ useEffect reads localStorage["goaldmine.lastSeenLevel"]
→ if lastSeen is null (first install): store N, do NOT fire rings (silent install)
→ if lastSeen < N: fire classList.add("level-up-ring") on ring1 and ring2 refs
  → ring2 gets "delayed" class too (120ms delay)
  → Both refs are divs positioned absolute inside the medallion's relative wrapper
→ localStorage.setItem("goaldmine.lastSeenLevel", String(N))
→ Rings animate scale(0.8→2.2) + opacity(.65→0) in 560ms, then disappear
→ reduced-motion: .level-up-ring { display: none } → rings never appear
```

---

## 8. Work Streams

| Stream | Covers REQs | Key Files | Depends On | Can Parallelize With |
|--------|------------|-----------|------------|---------------------|
| **Phase 0 (Contract)** | REQ-001, REQ-002 | `schema.prisma`, `types.ts`, `rules.ts`, `attributes-registry.ts` | Nothing | Nothing — must complete first |
| **Stream A (Engine)** | REQ-003, REQ-004, REQ-005, REQ-010 | `engine.ts`, `badges.ts`, `quest.ts`, `docs/project-gotchas.md` | Phase 0 complete | B, C after Phase 0 |
| **Stream B (MCP)** | REQ-006 | `tools.ts` | Phase 0 types + `attributes-registry.ts`; **stubs engine call** until A lands | A and C after Phase 0 |
| **Stream C (UI)** | REQ-007, REQ-008 | all `game/` components, `character/page.tsx`, `MoreSheet.tsx`, `globals.css` | Phase 0 types only; **codes against fixture** | A and B after Phase 0 |
| **Integration** | REQ-009 | `src/app/page.tsx` | A complete (real engine), C complete (real components) | Nothing |

### Stream B stub while A is in flight

Stream B must be able to register and smoke-test `get_game_state` before `engine.ts` exists. Use this stub:

```typescript
// In tools.ts, TEMPORARILY import the fixture instead of engine:
import { FIXTURE_GAME_STATE } from "@/lib/game/engine-stub";
// engine-stub.ts exports: export async function computeGameState() { return FIXTURE_GAME_STATE; }
// Delete engine-stub.ts and replace import with real engine.ts when A lands.
```

### Stream C fixture (codes against this literal)

Stream C builds all components against the following `FIXTURE_GAME_STATE`. Store in `src/lib/game/fixture.ts` (delete or tree-shake after integration):

```typescript
// src/lib/game/fixture.ts
import type { GameState } from "@/lib/game/types";

export const FIXTURE_GAME_STATE: GameState = {
  goalKind: "fitness",
  level: 7,
  xp: 4320,
  xpIntoLevel: 320,
  xpToNext: 1050,
  progress: 0.305,
  attributes: [
    { id: "STR", label: "Strength",      level: 9,  xp: 1800, xpIntoLevel: 120, xpToNext: 540,  progress: 0.222 },
    { id: "END", label: "Endurance",     level: 7,  xp: 1260, xpIntoLevel: 60,  xpToNext: 420,  progress: 0.143 },
    { id: "MOB", label: "Mobility",      level: 5,  xp:  780, xpIntoLevel: 30,  xpToNext: 300,  progress: 0.100 },
    { id: "CON", label: "Constitution",  level: 11, xp: 2940, xpIntoLevel: 200, xpToNext: 660,  progress: 0.303 },
  ],
  streak: { current: 12, longest: 18, todayCounted: true },
  badges: [
    { def: { id: "first-blood",      name: "First Blood",        hint: "Complete your first workout",                      monogram: "1st" },          dateKey: "2026-03-01" },
    { def: { id: "on-record",        name: "On Record",          hint: "Set your first PR",                                monogram: "PR" },           dateKey: "2026-03-05" },
    { def: { id: "pr-machine",       name: "PR Machine",         hint: "Set 10 PRs",                                       monogram: "×10" },          dateKey: "2026-04-02" },
    { def: { id: "baseline-scholar", name: "Baseline Scholar",   hint: "Log all initial baseline tests",                   monogram: "BS" },           dateKey: "2026-03-08" },
    { def: { id: "trail-rat",        name: "Trail Rat",          hint: "Complete your first hike",                         monogram: "△", glyphFamily: "mountain" }, dateKey: "2026-04-15" },
    { def: { id: "one-week-strong",  name: "One Week Strong",    hint: "Reach a 7-day streak",                             monogram: "7d", glyphFamily: "flame" },  dateKey: "2026-03-14" },
    { def: { id: "self-examined",    name: "Self-Examined",      hint: "Write your first weekly review",                   monogram: "✓" },            dateKey: "2026-03-22" },
    { def: { id: "retest-ritualist", name: "Retest Ritualist",   hint: "Complete a full baseline retest checkpoint week",  monogram: "RT" },           dateKey: null },
    { def: { id: "vert-collector",   name: "Vert Collector",     hint: "Accumulate 10,000 ft elevation across all hikes",  monogram: "10k", glyphFamily: "mountain" }, dateKey: null },
    { def: { id: "high-pointer",     name: "High Pointer",       hint: "Complete a single hike with ≥3,000 ft elevation", monogram: "3k", glyphFamily: "mountain" }, dateKey: null },
    { def: { id: "elbert-ready",     name: "Elbert Ready",       hint: "Complete a single hike with ≥4,000 ft elevation", monogram: "El", glyphFamily: "mountain" }, dateKey: null },
    { def: { id: "fortnight-forge",  name: "Fortnight Forge",    hint: "Reach a 14-day streak",                           monogram: "14d", glyphFamily: "flame" }, dateKey: null },
    { def: { id: "iron-month",       name: "Iron Month",         hint: "Reach a 30-day streak",                           monogram: "30d", glyphFamily: "flame" }, dateKey: null },
    { def: { id: "set-centurion",    name: "Set Centurion",      hint: "Log 500 total sets",                              monogram: "5c" },           dateKey: null },
    { def: { id: "hundred-ton",      name: "Hundred-Ton Hauler", hint: "Lift 200,000 lb total volume",                    monogram: "HT" },           dateKey: null },
    { def: { id: "clean-week",       name: "Clean Week",         hint: "Log 7 consecutive days of 2+ nutrition entries",  monogram: "7N" },           dateKey: null },
  ],
  recentEvents: [
    { dateKey: "2026-06-09", ruleId: "pr.set",           label: "PR · Bench Press",                       xp: 40, attribute: "STR" },
    { dateKey: "2026-06-09", ruleId: "workout.completed", label: "Upper workout",                          xp: 25, attribute: "STR" },
    { dateKey: "2026-06-09", ruleId: "adherence.day",    label: "Plan adherence",                         xp: 10, attribute: "CON" },
    { dateKey: "2026-06-08", ruleId: "bonus.coach",      label: "Coach: Pushed through on 4h sleep",      xp: 25, attribute: "END" },
    { dateKey: "2026-06-08", ruleId: "workout.completed", label: "Zone 2 / Mobility",                     xp: 25, attribute: "MOB" },
    { dateKey: "2026-06-07", ruleId: "hike.completed",   label: "Hike completed",                         xp: 60, attribute: "END" },
    { dateKey: "2026-06-06", ruleId: "workout.completed", label: "Calisthenics",                          xp: 25, attribute: "STR" },
    { dateKey: "2026-06-05", ruleId: "nutrition.day",    label: "Nutrition logged",                       xp:  5, attribute: "CON" },
    { dateKey: "2026-06-04", ruleId: "baseline.logged",  label: "Baseline · Plank",                      xp: 20, attribute: "CON" },
    { dateKey: "2026-06-04", ruleId: "baseline.onTime",  label: "Baseline on time · Plank",               xp: 10, attribute: "CON" },
  ],
  questToday: {
    projectedXp: 70,
    earnedXp: 75,
    earnedEvents: [
      { dateKey: "2026-06-09", ruleId: "workout.completed", label: "Upper workout",   xp: 25, attribute: "STR" },
      { dateKey: "2026-06-09", ruleId: "pr.set",           label: "PR · Bench Press", xp: 40, attribute: "STR" },
      { dateKey: "2026-06-09", ruleId: "adherence.day",    label: "Plan adherence",   xp: 10, attribute: "CON" },
    ],
    complete: true,
    bonusHints: ["PR chance +40 STR"],
  },
};
```

Note: ATTR_LEVEL_BASE=60; Level N costs 60*(N-1) to reach. Level 9 STR costs 60*(1+2+...+8)=2160 total. Level 10 costs 2160+540=2700. The fixture's 1800 XP means level = 9 (since 2160 > 1800 > 1560). The fixture values are illustrative — exact correctness verified by the engine at runtime.

---

## 9. Implementation Order

1. **Phase 0a** — Migrate schema (`schema.prisma`). Run `prisma migrate dev` + `generate`. Verify `GameBonusXp` in client.
2. **Phase 0b** — Write `src/lib/game/types.ts` (pure contracts). `npx tsc --noEmit` must pass.
3. **Phase 0c** — Write `src/lib/game/rules.ts` (`levelFromXp`, XP constants, category map). Sanity-check level curve manually.
4. **Phase 0d** — Write `src/lib/game/attributes-registry.ts` (`FITNESS_RULE_PACK`, `rulePackForGoal`).
5. **Parallel: Stream A begins** — `engine.ts`, `badges.ts`, `quest.ts`, `project-gotchas.md` additions. Engine dev may use `fixture.ts` for early structural testing but must wire real queries before completion.
6. **Parallel: Stream B begins** — Add `get_game_state` + `grant_bonus_xp` to `tools.ts` using `engine-stub.ts` initially. Smoke: `tools/list` shows both; `get_game_state` returns fixture; `grant_bonus_xp` validates and writes a row.
7. **Parallel: Stream C begins** — All game components + `/character` page + `MoreSheet` + `globals.css` against `fixture.ts`. Verify 390 px, both themes.
8. **Stream B switch** — Once A's `engine.ts` is complete, replace engine-stub import in tools.ts. Smoke: `get_game_state` returns real data; `grant_bonus_xp` +50 END lands in `get_game_state` END XP.
9. **Integration (REQ-009)** — Wire `computeGameState` into `page.tsx`. `CharacterHeader` above hero. `QuestCard` replaces `TodayCelebration` block in hero. Verify all existing content intact.
10. **Final QA** — `npx tsc --noEmit`, `npm run lint`, `npm run build`, browser smoke 390 px both themes, MCP curl smoke.
11. **Cleanup** — Delete `src/lib/game/fixture.ts` and `engine-stub.ts` (if it was committed).

---

## 10. Critical Decisions

### D-1: types.ts is pure TypeScript — Prisma-free
**Decision**: `types.ts` imports nothing from `@/generated/prisma`, `@/lib/db`, `react`, or Next.js. `EngineData` (the fetched-rows bundle with Prisma return types) lives in `engine.ts` as an internal type.
**Rationale**: Game UI components (`CharacterHeader`, `QuestCard`, etc.) import from `types.ts`. If `types.ts` imported Prisma types, they'd become server-only (Prisma client is not browser-safe), breaking the component bundle or forcing them to become client components. Keeping `types.ts` pure lets server components import it without concern.

### D-2: React cache() adoption (first usage)
**Decision**: `computeGameState` is the first function in this codebase to use React's `cache()`. Import from `"react"`, NOT `"next/cache"` (which is `unstable_cache` for cross-request caching). React's `cache()` is per-request only.
**Rationale**: PRD §4.10 requires deduplication so `/`, nested components, and same-request consumers share one computation. React `cache()` is the correct mechanism for App Router server components. Document the import path explicitly because training data may confuse it with `unstable_cache`.

### D-3: TodayCelebration fold mechanics
**Decision**: `QuestCard` (server component) renders the existing `TodayCelebration` component internally, replacing the standalone `TodayCelebration` block that was in the hero. The `stateLabel` span adjacent to `TodayCelebration` is also removed; `QuestCard` provides the equivalent state label.
**Rationale**: Signed off in PRD §9 resolution 2. Two completion Bullseyes ~120px apart would be visually confusing. `TodayCelebration` is a client component and CAN be rendered inside a server component — no "use client" cascade needed on `QuestCard`.

### D-4: Fixture strategy for Stream C
**Decision**: `src/lib/game/fixture.ts` exports `FIXTURE_GAME_STATE` as a typed literal. Stream C builds all UI components against this. `Stream B` uses a companion `engine-stub.ts`. Both files are deleted after integration.
**Rationale**: UI stream must not block on engine development (different complexity, different dev). The fixture is a plain `.ts` file (not a test file) so no testing infrastructure is needed. Deletion is a deliberate step in the integration phase.

### D-5: "lower-power" vs "power" in CATEGORY_ATTRIBUTE_MAP
**Decision**: The map explicitly includes `"lower-power": "STR"`. There is no `"power"` key.
**Rationale**: `program-template.ts` line 27-34 defines the DayTemplate.category discriminated union. The string is `"lower-power"` (Day 5, lower-power day). The PRD XP table writes "power→STR" as shorthand. A missing key would silently fall through to the `"STR"` fallback, but explicit is better. The research output flags this as S-1.

### D-6: PR XP from baseline mirror workouts (intentional)
**Decision**: The PR replay iterates ALL WorkoutExercise rows including those from `source="baseline"` mirror workouts. Baseline sets CAN generate `pr.set` XP events (in addition to `baseline.logged` XP). Both fire independently.
**Rationale**: Research S-3 confirms this is intentional. `recordsSetInWorkout` (the existing PR system) processes all exercises including mirror sets — canonical naming (e.g. "Plank Max Hold" → "Plank") means a baseline PR beats working-movement priors. The 1/day cap on `workout.completed` (not on PRs) is the only guard.

### D-7: addDays — always from @/lib/calendar
**Decision**: Engine exclusively uses `addDays` from `@/lib/calendar`. The local `addDays` in `records.ts` (line ~307) is unexported, private, and returns `endOfDay(...)` — semantically different (end vs start of day). Engine must import: `import { addDays, dateKey, startOfDay, endOfDay } from "@/lib/calendar"`.
**Rationale**: Research S-4 explicitly flags this divergence. Getting the wrong `addDays` would corrupt checkpoint window comparisons (off by 23:59:59 each side).

### D-8: Attribute IDs are plain strings, not TypeScript enum
**Decision**: `AttributeId = string`. The fitness pack uses `"STR"`, `"END"`, `"MOB"`, `"CON"`. The engine never does `attr === AttributeId.STR`.
**Rationale**: PRD §3.1.2 says "engine never hardcodes attribute ids." An enum would force the engine to know the fitness pack's attribute names. Plain strings preserve the registry pattern for future non-fitness packs.

### D-9: QuestCard receives resolved day data from page.tsx (no extra query)
**Decision**: `projectQuestXp` in `quest.ts` accepts a `ResolvedDay`-compatible shape. `QuestCard` receives pre-computed `questToday` prop (a `QuestProjection`). The projection is computed in `computeGameState` using the ledger's today entry.
**Rationale**: Research S-5 confirms `resolveDay(now)` is already called in `page.tsx`'s Promise.all. `QuestCard` should not trigger a second call. The engine's `computeGameState` builds the today ledger entry without calling `resolveDay` (it uses the same in-memory ledger). The `questToday` field on `GameState` is populated there.

### D-10: LevelUpCelebration positioning
**Decision**: `LevelUpCelebration` renders two bare `<div>` elements with `ref`. These divs MUST be positioned `absolute` inside a `relative` wrapper that wraps the `LevelMedallion`. The `CharacterHeader` is responsible for providing `<div className="relative">` around the medallion + `<LevelUpCelebration>`.
**Rationale**: The CSS `.level-up-ring { position: absolute; inset: 0 }` requires a positioned ancestor. The medallion's size (36px in header) is that ancestor. The rings then scale to 2.2× from that reference point, expanding outward behind the medallion.

### D-11: No mobility.session double-count guard
**Decision**: `mobility.session` XP is awarded for (a) any `MobilityCheckin` row OR (b) a completed `zone2-mobility` day — but only once per calendar day total.
**Rationale**: PRD §4.8 says "1/day". The engine must deduplicate: bucket both by dateKey and award at most one `mobility.session` event per day. Check MobilityCheckin rows first; if present, skip the workout-based check for that day.

### D-12: getActiveProgram must run before the main Promise.all
**Decision**: Call `getActiveProgram()` as a standalone await before the ~10-query Promise.all, since `planStart`/`planEnd` depend on its result.
**Rationale**: Can't compute bounds without the program. The first query is cheap (1-2 DB hits). Early return on null avoids the remaining 9 queries entirely.

---

## 11. Conflicts Found and Resolved

| Source | Conflict | Resolution |
|--------|----------|------------|
| PRD §4.8 "power→STR" vs template `"lower-power"` | PRD table shorthand; template string is the ground truth | Use `"lower-power"` in CATEGORY_ATTRIBUTE_MAP (research S-1) |
| PRD §3.1.7 "content below hero unchanged" vs TodayCelebration fold | TodayCelebration IS in the hero (not below it); fold modifies the hero completion indicator only | Fold is in scope and signed off per PRD §9 resolution 2 |
| PRD §4.8 "PRs sourced only from workout sets (baseline mirror rows pay baseline.logged, not PRs)" vs research S-3 | PRD phrasing ambiguous; research confirms both XP types can fire from mirror exercise sets | Both `baseline.logged` and `pr.set` can fire from baseline-day exercises (research is ground truth) |
| UX report §12 lists `LevelMedallion` as a new component; PRD §4.4 lists only components without it | UX report §12 is more specific | Include `LevelMedallion` as a standalone component (adds to file plan) |
| PRD §9 Q2 uses "⚔" emoji; PRD §5.1 sketch uses "⚔/✓" emoji | UX research explicitly replaces these with Bullseye (hollow/filled) per no-icon-lib constraint | Use Bullseye; UX report is the visual ground truth (ledger row tagged copy⚠) |
| PRD §4.10 "Quest consumes resolveDay(now) from page" vs engine building its own ledger | Engine has its own in-memory ledger for all days; today's QuestCard data comes from that ledger's today entry | `questToday` is a field on `GameState`, populated by the engine; page.tsx passes it to QuestCard as a prop |
