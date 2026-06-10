# Research Output — RPG Character Stats

**Feature**: RPG Character Stats (REQ-001..REQ-010)
**PRD**: docs/prds/PRD-rpg-character-stats.md
**Date**: 2026-06-09
**Scope**: Pre-development investigation; no source files modified.

---

## 1. Existing Patterns

### 1.1 Import Aliases

All source imports use `@/` aliases (tsconfig paths). Examples in production code:
- `import { prisma } from "@/lib/db"`
- `import type { PrismaClient } from "@/generated/prisma/client"`
- `import { Prisma } from "@/generated/prisma/client"` (for `Prisma.InputJsonValue`, `Prisma.JsonNull`)
- `import { dateKey, startOfDay, endOfDay, addDays } from "@/lib/calendar"`

New files under `src/lib/game/` must use `@/lib/...` paths, never relative paths to sibling modules.

### 1.2 Prisma Client Import Convention

Generated client lives at `src/generated/prisma`. Two imports are in use:
- Type-only usage: `import type { PrismaClient } from "@/generated/prisma/client"` (e.g., goal-targets.ts)
- Runtime Prisma namespace: `import { Prisma } from "@/generated/prisma/client"` (for `Prisma.InputJsonValue`, `Prisma.JsonNull`)
- Singleton: `import { prisma } from "@/lib/db"` — always use this, never `new PrismaClient()`

### 1.3 Page Conventions

- All pages: `export const dynamic = "force-dynamic"` at the top
- All pages: async server components by default (no `"use client"`)
- Outermost `<div className="max-w-md mx-auto p-4 space-y-4">`
- `Card` component for content sections (`rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm`)

### 1.4 Color Tokens (NO hardcoded hex colors)

Available CSS custom properties (light/dark both defined):
- `var(--background)`, `var(--foreground)`, `var(--muted)`, `var(--card)`, `var(--border)`
- `var(--accent)`, `var(--accent-fg)`, `var(--accent-soft)`
- `var(--target)`, `var(--target-fg)` (red/bullseye)
- `var(--success)` (green), `var(--warning)` (orange), `var(--danger)` (red = same as target)

These cover all needs for attribute bars, streak flame, level badges. Never use hex or rgb literals.

### 1.5 "use client" Pattern

Multiple client islands exist. The `TodayCelebration` pattern (the one to copy for `LevelUpCelebration`):
- `"use client"` directive on line 1
- `useRef<HTMLSpanElement>` for imperative class mutations
- `useEffect` reads `localStorage`, sets a key, then `wrapRef.current?.classList.add("class-name")`
- NO `setState` — avoids React 19 hydration mismatches
- Silent catch for blocked localStorage (private browsing)
- Reduced-motion guard lives in CSS, not in JS

### 1.6 MCP `registerTool` Pattern

All tools follow exactly this shape:

```ts
server.registerTool(
  "tool_name",
  {
    title: "Human-readable title",
    description: "...",
    inputSchema: {
      field: z.string().describe("..."),
      optionalField: z.string().optional(),
    },
  },
  async (input) =>
    safe(async () => {
      // ... business logic ...
      return resultObject; // serialized as JSON text content
    }),
);
```

- `safe()` (line 235 of tools.ts): wraps in try/catch, returns `jsonResult` on success or `errorResult` on throw
- `jsonResult(value)`: `{ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] }` — NO `structuredContent`
- Error throws surface as `errorResult("Error: " + message)`
- `parseDateInput(s)`: date-only strings → USER_TZ midnight via `parseDateKey`; full ISO → `new Date(s)`
- `MCP_SERVER_VERSION` (line 510): auto-computed from `VERCEL_GIT_COMMIT_SHA` — no manual bump needed

### 1.7 Active Goal Fetch Pattern

Every tool that needs the active goal uses:
```ts
await prisma.goal.findFirst({ where: { active: true }, orderBy: { updatedAt: "desc" } })
```

This matches `getCalendarMonth` (calendar.ts line 77-84) and `resolveDay` (line 470-475).

### 1.8 React `cache()` — No Current Precedent

**Critical finding**: No file in `src/` imports `cache` from `"react"`. The PRD requires `computeGameState()` to be wrapped in React `cache()` for request-level deduplication. The developer must be the first to introduce this:

```ts
import { cache } from "react";
export const computeGameState = cache(async (opts?: ...) => { ... });
```

This is valid in Next.js 16 App Router server-component context only. Since all pages are `force-dynamic` server components, this works correctly — `cache()` scopes to the current request.

---

## 2. Related Existing Code (Exact Signatures + Line References)

### 2.1 `templateForRotationDay` (calendar.ts line 701)

```ts
export function templateForRotationDay(
  program: ActiveProgramSnapshot,
  date: Date,
): DayTemplate | null
```

- **Pure, synchronous, no DB**
- Computes `daysDelta = floor((startOfDay(date) - startOfDay(program.startedOn)) / 86400000)`
- Returns `null` when `daysDelta < 0 || daysDelta >= program.template.totalWeeks * 7`
- `rotationDay = ((daysDelta % 7) + 7) % 7 + 1` (1-based, 1..7)
- Returns `program.template.weeklySplit.find(d => d.dayOfWeek === rotationDay) ?? null`
- **Override-UNAWARE by design** — gives the template base before overrides layer on top

### 2.2 `rotationBaselineNamesForDate` (calendar.ts line 713)

```ts
export function rotationBaselineNamesForDate(
  program: ActiveProgramSnapshot,
  date: Date,
): string[]
```

- **Pure, synchronous, no DB**
- Computes `daysDelta`, `rotationDay`, `weekIndex = floor(daysDelta / 7) + 1`
- Returns `[]` when outside plan window
- Finds `baselineDay` from `program.template.baselineWeek` where `d.dayOfWeek === rotationDay`
- Filters tests: `weekIndex === (t.initialWeek ?? 1) || (weekIndex > initialWeek && t.retestWeeks.includes(weekIndex))`
- Returns `testName` strings only
- **Override-UNAWARE** — returns rotation default regardless of `PlanDayOverride.baselineTestNames`

### 2.3 `resolveDay` (calendar.ts line 423)

```ts
export async function resolveDay(date: Date): Promise<ResolvedDay>
```

- Async, queries DB, called per-day (expensive in a loop)
- Pre-computes `rotationDay`, `weekIndex`, `weekWindow` BEFORE `Promise.all`
- `Promise.all`: workouts (today range), override (planId+date unique), notesForDate, goal, nutrition, plannedHikesThisWeek
- Returns full `ResolvedDay` object (see type at line 347)
- **The engine must NOT call this in a loop** — replicate the logic in-memory

### 2.4 Date/Time Utilities (calendar.ts lines 1000-1055)

```ts
export const USER_TZ = process.env.USER_TZ ?? "America/Denver";
export function dateKey(d: Date): string          // yyyy-mm-dd in USER_TZ
export function parseDateKey(k: string): Date     // yyyy-mm-dd → USER_TZ midnight
export function startOfDay(d: Date): Date         // USER_TZ midnight
export function endOfDay(d: Date): Date           // USER_TZ 23:59:59.999
export function addDays(d: Date, days: number): Date  // DST-safe addDays in USER_TZ
```

All internal; never use raw `setHours`, `getDate()`, `getMonth()`, `getFullYear()` outside these functions.

### 2.5 `canonicalExerciseName` (records.ts line 145)

```ts
export function canonicalExerciseName(name: string): string
```

- Case-insensitive lookup in `EXERCISE_ALIAS_INDEX` (pre-built at module load)
- Unmapped names return `name.trim()` (own bucket)
- Key alias mappings relevant to the engine:
  - `"Plank Max Hold"` → `"Plank"`
  - `"Pull-Up Max Reps"` → `"Pull-Up"`
  - `"Hollow Hold"` → `"Hollow Body Hold"`
  - `"Push-Up Max Reps"` → `"Push-Up"`
  - `"Dip Max Reps"` → `"Dip"`
- NOT aliased (intentionally separate metrics): `"Pull-Up Total Across 5 Sets"`, `"2-Min Bodyweight Squat"`

### 2.6 `epley1RM` (records.ts line 99)

```ts
export function epley1RM(weightLb: number, reps: number): number
// Returns: weightLb * (1 + reps / 30)
```

No rounding. Used for rm primary in `bestSetSummary`.

### 2.7 `bestSetSummary` (records.ts line 549)

```ts
export function bestSetSummary(
  sets: { weightLb: number | null; reps: number | null; durationSec: number | null }[]
): {
  primary: "rm" | "reps" | "duration";
  value: number;
  raw: { weightLb: number | null; reps: number | null; durationSec: number | null };
} | null
```

Priority: weighted sets (rm via Epley) > reps-only > durationSec. Returns `null` for empty sets.

### 2.8 `recordsSetInWorkout` (records.ts line 459)

```ts
export async function recordsSetInWorkout(workoutId: string): Promise<RecordSet[]>
```

- Groups this workout's exercises by `canonicalExerciseName`
- Loads ALL prior exercises from OTHER workouts (id != workoutId)
- **Strict improvement only**: `thisSummary.value > priorValue` (no tie breaks)
- **Brand-new movement (no prior history) → NOT a PR** — requires something to beat
- Returns `RecordSet[]` with `{ name, equipment, kind, value, prior, raw }`

### 2.9 Checkpoint Window Math in `getBaselineSchedule` (records.ts line 189)

The local `addDays` in records.ts (line 307) wraps `endOfDay`: `endOfDay(addDaysCal(d, n))`. Checkpoint targets are:
- Initial: `endOfDay(addDaysCal(startedOn, initialWeek * 7))`
- Retest N: `endOfDay(addDaysCal(startedOn, retestWeek * 7))`
- Window start: `startedOn` (for initial) or previous target
- Window end: next target or `endOfDay(addDaysCal(lastTarget, 28))`
- Status "due": `now >= addDays(target, -7) && now <= addDays(target, 7)` (±7 days)
- Status "overdue": `now > addDays(target, 7)`

The engine's `baseline.onTime` rule checks: does the Baseline row date fall within a "due" or earlier window? Use the same ±7-day logic.

### 2.10 `appendBaselineToDayWorkout` (baseline-workout.ts line 65)

Mirror workout characteristics for engine identification:
- `source: "baseline"` (Workout.source field)
- `title: "Baseline tests"` (exact string)
- `status: "completed"` (always)
- Exercise names = `testName` (exact, not canonicalized at creation time)
- Skips `value === 0` placeholders — no mirror for those
- One mirror workout per day (found by `source: "baseline"` within day's startOfDay..endOfDay)

### 2.11 `getActiveProgram` (program.ts line 24)

```ts
export async function getActiveProgram(): Promise<ActiveProgramSnapshot | null>
```

- Prefers `Plan` (active=true, orderBy updatedAt desc) over `Program`
- Returns `{ id, name, startedOn, template: ProgramTemplate, confirmedThroughDate }`
- `template` is `plan.planJson as unknown as ProgramTemplate` (JSON field cast)

### 2.12 `DayTemplate.category` Values (program-template.ts lines 23-36)

```ts
category:
  | "upper"          // dayOfWeek 1 → STR
  | "lower"          // dayOfWeek 2 → STR
  | "zone2-mobility" // dayOfWeek 3 → MOB
  | "calisthenics"   // dayOfWeek 4 → STR
  | "lower-power"    // dayOfWeek 5 → STR (PRD says "power→STR")
  | "long-endurance" // dayOfWeek 6 → END
  | "rest"           // dayOfWeek 7 → no workout.completed XP
```

### 2.13 `METRICS` / `resolveMetricValue` Pattern (goal-targets.ts lines 40-334)

Registry = `MetricSpec[]` array + `Map` for O(1) lookup. Each metric resolved via big if/else dispatch on metric string prefix (`"baseline:"`, `"hike:"`, `"workout:count"`, `"log:"`). Engine's rule-pack registry should mirror this: array of `RuleSpec` per attribute, dispatched in `computeGameStateFromData`.

### 2.14 `MoreSheet.tsx` NavRow Pattern (line 62-93)

```ts
const navRows: NavRow[] = [
  { href: "/goals", label: "Goals", sub: "...", icon: <GoalsIcon /> },
  // ...
];
// NavRow = { href, label, sub, icon: React.ReactNode }
```

Row rendered as `<Link>` with `min-h-[48px]` (44px target), `px-4 py-3`, `gap-3`. Icon wrapped in `<span className="text-[var(--accent)] shrink-0">`. Character row should follow the same shape with a custom inline SVG icon.

### 2.15 `Card.tsx` Component (full file)

```ts
export function Card({
  title?: string,
  action?: ReactNode,
  children: ReactNode,
  className?: string,
})
```

Renders as `<section>`. Uses `rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm`. Optional header with `h2` title and action slot.

---

## 3. Override Precedence Spec (buildDayLedger must replicate exactly)

The engine's `buildDayLedger` processes all plan-window days in memory. This is the precise rule sequence, derived from `resolveDay` (calendar.ts lines 423-678):

### Step 1 — In-Plan Check

```
daysDelta = floor((startOfDay(date) - startOfDay(program.startedOn)) / 86400000)
isInPlan = (daysDelta >= 0 && daysDelta < program.template.totalWeeks * 7)
```

- Days where `isInPlan = false` → no streak/adherence entry; still may have logged workouts/hikes

### Step 2 — Rotation Math (when isInPlan)

```
rotationDay = ((daysDelta % 7) + 7) % 7 + 1   // 1..7
weekIndex = floor(daysDelta / 7) + 1            // 1..totalWeeks
```

### Step 3 — Override Lookup

Pre-fetch ALL `PlanDayOverride` rows for the plan window in one query, bucket by `dateKey`. For each date, lookup `override = overridesByKey.get(dateKey(date)) ?? null`.

### Step 4 — Workout Template Resolution

```
if (override?.workoutJson != null):
  workoutTemplate = override.workoutJson   // isOverride = true
else:
  workoutTemplate = program.template.weeklySplit.find(d => d.dayOfWeek === rotationDay) ?? null
  // isOverride = false
```

**`workoutJson: null` in the override (explicit clear)**: falls through to rotation template. This is `override?.workoutJson != null` — the null check is strict.

### Step 5 — Baseline Names Resolution

```
overrideNames = Array.isArray(override?.baselineTestNames) ? override.baselineTestNames : null
// Note: null and undefined both fall to rotation default
// Empty array [] = "explicitly no tests today" (override wins with zero)

if (overrideNames !== null):
  // Use override list exactly — look up each name in template.baselineWeek
  for each name in overrideNames:
    find test across ALL baselineWeek days by testName match
  // weekIndex filter is BYPASSED for override-listed tests
else:
  // Rotation default (same as rotationBaselineNamesForDate):
  baselineDay = program.template.baselineWeek.find(d => d.dayOfWeek === rotationDay)
  if baselineDay:
    for each test in baselineDay.tests:
      initialWeek = test.initialWeek ?? 1
      include if: weekIndex === initialWeek
               OR (weekIndex > initialWeek && test.retestWeeks.includes(weekIndex))
```

### Step 6 — workoutDeferredForBaseline (advisory)

```
workoutDeferredForBaseline = (
  baselinesDue.length > 0
  && !isOverride
  && workoutTemplate !== null
  && workoutTemplate.category !== "rest"
)
```

### Step 7 — Streak/Adherence Logic (per PRD §3.1.5)

For each in-plan day:
- **Rest day** (`workoutTemplate?.category === "rest"`): count as adherence success
- **Workout day**: success if `completedWorkoutsOnDay.length > 0` OR (`completedHikesOnDay.length > 0`) OR (`allDueBaselinesLogged`)
- **Planned hike day** (resolved.plannedHikeToday != null + no workout): if hike completed → success; if skipped with no workout → break
- **Today**: excluded from break-scanning but counts if already succeeded

---

## 4. Day Category → Attribute Mapping

From `DayTemplate.category` in program-template.ts + PRD §4.8 XP economy table:

| category | dayOfWeek | XP attribute |
|---|---|---|
| `"upper"` | 1 | STR |
| `"lower"` | 2 | STR |
| `"zone2-mobility"` | 3 | MOB |
| `"calisthenics"` | 4 | STR |
| `"lower-power"` | 5 | STR |
| `"long-endurance"` | 6 | END |
| `"rest"` | 7 | (no workout.completed XP — rest days earn adherence.day only) |
| off-plan (isInPlan=false) | n/a | STR (fallback) |

**CRITICAL**: The PRD table says "power→STR" but the actual template category is `"lower-power"`. The `rules.ts` category map must explicitly include `"lower-power": "STR"`.

**PR override map** (exercise-name based, per PRD §4.8):
- Exercises named with squat-hold/toe-touch/shoulder in canonical name → MOB
- Exercises named with run/step-up/bike in canonical name → END
- Everything else → STR

---

## 5. Baseline Mirror Workout Identification

The engine needs to identify mirror workouts to avoid double-counting.

**Definitive identification**: `workout.source === "baseline"` on the Workout row.

- Schema: `source String?` (Workout model, schema line 21)
- Values set by code: `"manual"` | `"strong.app"` | `"claude"` | `"imported"` | `"baseline"`
- `appendBaselineToDayWorkout` always creates with `source: "baseline"`, `title: "Baseline tests"`, `status: "completed"`
- One mirror workout per day (upserted by date window + source)

**Engine guard strategy (per PRD §4.8)**:
- `baseline.logged` XP: awarded per `Baseline` DB row (not per WorkoutExercise)
- `workout.completed` XP: 1/day cap naturally handles the mirror — if a baseline day also has a regular workout logged, the cap limits to one `workout.completed` event
- PR replay: uses all `WorkoutExercise` sets including those in mirror workouts. A baseline result that beats a prior best WILL generate a `pr.set` event (this is intentional — the canonicalization maps e.g. "Plank Max Hold" → "Plank" so a new baseline PR beats the working movement's prior). The guard is: don't award BOTH `baseline.logged` and a PR event from the same set? Actually no — the PRD seems to intend both can fire. The "PRs sourced only from workout sets" note means PRs come from WorkoutExercise/Set rows (not from Baseline rows directly), which is what the existing `recordsSetInWorkout` does.

**Practical engine rule**: When building the engine's chronological PR walk, iterate over all WorkoutExercise rows from all workouts (including source="baseline" ones). The `canonicalExerciseName` maps test names to canonical movements. Use `bestSetSummary` + strict comparison same as `recordsSetInWorkout`.

---

## 6. Dependencies

### 6.1 New Prisma Model — `GameBonusXp`

Exactly as in PRD §4.1:
```prisma
model GameBonusXp {
  id        String   @id @default(cuid())
  date      DateTime
  amount    Int
  reason    String
  attribute String?
  source    String   @default("coach")
  createdAt DateTime @default(now())
  @@index([date])
}
```

**Migration command**: `npx prisma migrate dev --name add_game_bonus_xp` then `npx prisma generate`.

**Neon prod risk**: migrations run directly against shared prod DB. Verify the SQL diff (additive-only: `CREATE TABLE`) before running. No backfill needed.

### 6.2 New Files

| File | Purpose |
|---|---|
| `src/lib/game/types.ts` | Type contracts (no Prisma imports) |
| `src/lib/game/rules.ts` | XP constants, `levelFromXp`, attribute registry |
| `src/lib/game/attributes-registry.ts` | `GameRulePack` type, `RULE_PACKS`, `rulePackForGoal` |
| `src/lib/game/engine.ts` | `computeGameState` (cache-wrapped) + `computeGameStateFromData` |
| `src/lib/game/badges.ts` | 16 `BadgeDef` predicates |
| `src/lib/game/quest.ts` | `projectQuestXp` + `earnedTodayXp` |
| `src/components/game/CharacterHeader.tsx` | Server component |
| `src/components/game/AttributeBar.tsx` | Server component |
| `src/components/game/XpBar.tsx` | Server component |
| `src/components/game/StreakFlame.tsx` | Server component |
| `src/components/game/QuestCard.tsx` | Server component |
| `src/components/game/BadgeWall.tsx` | Server component |
| `src/components/game/XpEventList.tsx` | Server component |
| `src/components/game/LevelUpCelebration.tsx` | **Client island** (only "use client" addition) |
| `src/app/character/page.tsx` | Server page, force-dynamic |

### 6.3 Modified Files

| File | Change |
|---|---|
| `prisma/schema.prisma` | Add `GameBonusXp` model |
| `src/lib/mcp/tools.ts` | Add `get_game_state` to `registerReadTools`, `grant_bonus_xp` to `registerWriteTools` |
| `src/app/page.tsx` | Add `computeGameState()` to Promise.all batch; render CharacterHeader + QuestCard |
| `src/components/MoreSheet.tsx` | Add Character row to `navRows` array |
| `src/app/globals.css` | Add `@keyframes level-up-burst` + `.level-up-burst` class + reduced-motion guard |
| `docs/project-gotchas.md` | Three new entries (XP derived; baseline mirror; alias map XP fragmentation) |

---

## 7. Risks & Considerations

### 7.1 Migration Risk (Low)

`add_game_bonus_xp` is purely additive (`CREATE TABLE`, no `ALTER TABLE`). No data migration. Existing pages are unaffected. The Prisma client regenerates on `npx prisma generate`. After deploy, existing tools/list response is cached by claude.ai keyed on `MCP_SERVER_VERSION` (auto-bumped via `VERCEL_GIT_COMMIT_SHA`) — the new tools will appear on next request after deploy without manual connector toggle.

### 7.2 Engine Performance (Medium concern)

The PRD specifies one `Promise.all` with ~10 queries bounded to `program.template.totalWeeks * 7` days (~84 days). The query plan:

1. `getActiveProgram()` — 1-2 queries (Plan + maybe Program)
2. Active goal — 1 query
3. `Workout.findMany(where: { startedAt: { gte: planStart, lte: planEnd } }, include: { exercises: { include: { sets: true } } })` — 1 query (heavy, includes all sets)
4. `Hike.findMany(where: { date: { gte: planStart, lte: planEnd } })` — 1 query
5. `Baseline.findMany(where: { date: { gte: planStart, lte: planEnd } })` — 1 query
6. `NutritionLog.findMany(select: { date, mealType }, where: { date: { gte: planStart, lte: planEnd } })` — 1 query (select only date/mealType)
7. `Note.findMany(where: { type: "review", date: { gte: planStart, lte: planEnd } })` — 1 query
8. `MobilityCheckin.findMany(where: { date: { gte: planStart, lte: planEnd } })` — 1 query
9. `PlanDayOverride.findMany(where: { planId: program.id, date: { gte: planStart, lte: planEnd } })` — 1 query
10. `GameBonusXp.findMany()` — 1 query (unbounded, but typically small)

React `cache()` deduplicates per request. The `/` and `/character` pages will share one computation if both invoke `computeGameState()` in the same request cycle.

### 7.3 PR Replay Complexity (Medium)

The chronological PR replay must process ALL workout exercise sets across the plan window, grouped by `canonicalExerciseName`, walking forward in time and tracking best-per-movement. This replicates `recordsSetInWorkout` logic but across all workouts chronologically. Cap: 3 `pr.set` events per day.

### 7.4 MCP Connector Cache (Low, well-understood)

Adding `get_game_state` and `grant_bonus_xp` changes the tool surface. `MCP_SERVER_VERSION` auto-bumps on deploy via `VERCEL_GIT_COMMIT_SHA`. If tools don't appear in claude.ai after deploy, toggle connector off/on (see docs/project-gotchas.md §C).

### 7.5 `lower-power` Category Not in PRD Table

The PRD XP economy table lists "upper/lower/power/calisthenics→STR" but the actual template has `"lower-power"` as a category string. The `rules.ts` constant map must include:
```ts
"lower-power": "STR"
```

### 7.6 Streak Edge Cases

- **Today**: must be excluded from break detection (don't mark today a fail just because the workout isn't logged yet by the time the page loads)
- **Out-of-plan days**: ignored by streak logic (they're before startedOn or after plan end)
- **Baseline-only days**: a day where `workoutDeferredForBaseline=true` — success if all due baselines are logged (a completed Baseline row exists for each)
- **Hike-deferred days**: if `workoutDeferredForHike=true` and the hike status is "completed" → success; if hike "planned" or "skipped" and no workout → break

---

## 8. Conventions Checklist

1. All date operations via `@/lib/calendar` only. No `setHours`, `getDate()`, `getMonth()`, `getFullYear()` outside that module.
2. `parseDateInput` (from tools.ts) for all `date: string` MCP inputs — bare `yyyy-mm-dd` needs TZ correction.
3. All DB access via `prisma` singleton from `@/lib/db`. Never `new PrismaClient()`.
4. Prisma types from `@/generated/prisma/client` (run `npx prisma generate` after schema edit).
5. Server components by default; `"use client"` only for `LevelUpCelebration`.
6. CSS tokens only — never hardcode hex or rgb values in components.
7. `min-h-[48px]` on all tap targets (44px rule for mobile).
8. `role="progressbar"` + `aria-valuenow/min/max` on all XP/attribute bars.
9. No `resolveDay()` calls inside loops in the engine — fetch overrides in bulk then process in-memory.
10. Workout status filter: only `status === "completed"` earns XP (`"planned"` and `"skipped"` earn nothing).
11. Hike status filter: only `status === "completed"` earns XP.
12. Baseline mirror guard: use `workout.source === "baseline"` to identify mirrors. Completion cap (1/day) handles double-count.
13. `canonicalExerciseName` imported from `@/lib/records` — never reimplemented in the engine.
14. `bestSetSummary` and `epley1RM` imported from `@/lib/records` — never reimplemented.
15. All game constants (XP values, level bases, badge thresholds) in `rules.ts` only — never hardcoded in engine or components.
16. `getActiveProgram()` returns `ActiveProgramSnapshot` whose `id` is the Plan.id (not Goal.id); use `goal.id` for GameBonusXp attribute validation.
17. New MCP tools: read tools go inside `registerReadTools` (line 571), write tools inside `registerWriteTools` (line 1829), appended at the end of each function.
18. `safe()` wrapper on every MCP tool handler — never add try/catch inside the handler directly.
19. `"use client"` must appear as the first line in client component files.
20. MoreSheet icon: inline SVG, 20×20 viewBox, no external icon library, `aria-hidden`.
21. Force-dynamic export on `/character/page.tsx` (same as all other data pages).
22. `GameBonusXp` rows: validate `attribute` against `rulePackForGoal(activeGoal.kind).attributes.map(a => a.id)` server-side in `grant_bonus_xp` handler before writing.
23. `goalKind: null` when no active program — CharacterHeader must render nothing (not a crash).
24. React `cache()` from `"react"` (not `"next/cache"`) wraps `computeGameState` for request-level dedup — first usage of this pattern in the codebase.
25. `level-up-burst` keyframe + `.level-up-burst` class in `globals.css` with `@media (prefers-reduced-motion: reduce) { animation: none; }` guard.

---

## 9. Surprises That Contradict PRD Assumptions

### S-1: `lower-power` is the actual category string (Day 5)

The PRD's XP table references "power→STR" generically. The `DayTemplate.category` enum in `program-template.ts` line 29 is `"lower-power"` (not `"power"`). The `rules.ts` category-to-attribute map must explicitly handle this value.

### S-2: No React `cache()` precedent exists

The PRD assumes `computeGameState()` can be wrapped in React `cache()`. This pattern has zero prior usage in the codebase — the developer will be introducing it for the first time. It's a valid React 19 / Next.js 16 pattern but must be documented as a new pattern introduction.

### S-3: Baseline test PRs DO participate in PR XP (via canonicalization)

The PRD §4.8 says "PRs sourced only from workout sets (baseline mirror rows pay baseline.logged, not PRs)". This might be read as "baseline mirrors never generate PR events". But the actual `recordsSetInWorkout` logic groups by `canonicalExerciseName` and compares against all prior sets — including those from baseline mirror workouts. Example: logging "Plank Max Hold" baseline creates a mirror with exercise "Plank Max Hold" → canonical "Plank". If this beats prior Plank bests, it IS a PR. Both `baseline.logged` XP and `pr.set` XP fire. The "only from workout sets" phrasing means PRs are computed from `WorkoutExercise/Set` rows (not from `Baseline` rows directly), which is what the engine does. Both XP types can coexist.

### S-4: `addDays` in `records.ts` returns end-of-day, not start-of-day

`records.ts` has a LOCAL `addDays` wrapper (line 307): `endOfDay(addDaysCal(d, n))`. This is different from `calendar.ts`'s `addDays` (start-of-day). The engine must import `addDays` from `@/lib/calendar` for date bucketing, NOT from records.ts (which is unexported from that file anyway, but worth knowing the semantics differ).

### S-5: `resolveDay` is already called on the Today page for `now`

The Today page (page.tsx line 46) calls `resolveDay(now)` in its existing Promise.all. The PRD says "QuestCard consumes the `resolveDay(now)` result already fetched by the Today page." This means: in `src/app/page.tsx`, the QuestCard can receive the existing `resolved` variable (already a `ResolvedDay`) rather than requiring the engine to re-query it. The `projectQuestXp` function should accept a `ResolvedDay`-compatible shape, not call resolveDay itself.

### S-6: MCP tools use text content only, not structuredContent

The PRD §4.2 documents return shapes for `get_game_state` as if they are structured objects. But all existing MCP tools return `jsonResult(value)` which serializes to `content: [{ type: "text", text: "..." }]`. No tool uses `structuredContent`. The new tools must follow the `jsonResult` pattern.

### S-7: `MobilityCheckin` model exists and should count toward `mobility.session` XP

The schema has a `MobilityCheckin` model (schema lines 156-164) with `date DateTime` and `areasWorked String`. The PRD says `mobility.session` XP fires on "MobilityCheckin OR completed zone2-mobility day (1/day)". The engine query must include `MobilityCheckin.findMany` in its Promise.all batch.
