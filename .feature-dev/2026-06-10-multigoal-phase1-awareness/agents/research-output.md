# Research Output — Multi-goal Phase 1: Cross-goal Awareness

Agent: Research Agent
Date: 2026-06-10
Feature branch: main (direct)

---

## Existing Patterns

### Route / File Conventions

- **Server components by default.** All page files (`src/app/*/page.tsx`) are async server components. `"use client"` lives in interactive form components and stateful calendar components only.
- **Client components identified:** `CalendarMonth.tsx`, `GoalCreateForm.tsx`, `GoalEditForm.tsx`, `WeekRail.tsx`, `DayOverrideForm.tsx`, `DayNoteForm.tsx`, `TargetsBuilder.tsx`, `ConfirmButton.tsx`.
- **Page-level `export const dynamic = "force-dynamic"` is required** on every page that does DB reads (prevents Next stale caches). All current pages have this.
- **Route segments:** `src/app/page.tsx` (Today), `src/app/calendar/page.tsx`, `src/app/days/[dateKey]/page.tsx`, `src/app/goals/page.tsx`, `src/app/goals/[id]/page.tsx`.

### Server-Action Patterns

- All server actions live in `src/lib/goal-actions.ts` with `"use server"` at top of file.
- **`revalidatePath` pattern used in `setActiveGoal`:** revalidates `/`, `/calendar`, `/goals`, `/goals/${id}`, `/stats`. This is the exact pattern to follow for `setFocusGoal`.
- **`revalidatePath` pattern for `createGoal` / `updateGoal`:** `/goals`, `/stats` (and `/goals/${id}` for updateGoal). After REQ-101 both also need `/`.
- **Redirect after mutation:** `setActiveGoal` redirects to `/calendar`; `createGoal` redirects to `/goals/${goal.id}`; `deleteGoal` redirects to `/goals`.
- `updateGoal` and `createGoal` parse `FormData` with `form.get("fieldName")` + String coercions. `parseTargetsField` handles JSON-in-FormData.

### MCP Tool Registration Shape

```ts
// safe() — wraps every handler; catches throws, returns errorResult
async function safe<T>(fn: () => Promise<T>) {
  try {
    return jsonResult(await fn());
  } catch (e) {
    return errorResult(e instanceof Error ? e.message : String(e));
  }
}

// DateKeyShape — reused for every date input on MCP tools
const DateKeyShape = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "use yyyy-mm-dd")
  .describe("ISO date yyyy-mm-dd in the user's local time zone");

// parseDateInput — used for all date string→Date conversions in tools
function parseDateInput(s: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? parseDateKey(s) : new Date(s);
}
```

**Example registerTool shape (from `get_day`):**

```ts
server.registerTool(
  "get_day",
  {
    title: "Get any day's plan",
    description: "...",
    inputSchema: { date: DateKeyShape },
  },
  async ({ date }) =>
    safe(async () => {
      const r = await resolveDay(parseDateKey(date));
      return r;
    }),
);
```

Tools with no input use `async () => safe(async () => { ... })`. All tools are registered via `registerReadTools(server)` / `registerWriteTools(server)` called from the main `registerTools(server)` function.

### Tailwind Token Usage

Tokens used in goal and calendar components (from direct file inspection):

| Token | Used for |
|---|---|
| `var(--accent)` | Focus rings, active badges, link colors, goal glow, accent buttons |
| `var(--accent-soft)` | Today pill background |
| `var(--accent-fg)` | Text on accent buttons |
| `var(--warning)` | Warning text, conflict corner wedge, override notice |
| `var(--border)` | All card/row borders |
| `var(--muted)` | Secondary text, muted labels, inactive items |
| `var(--foreground)` | Primary text |
| `var(--card)` | Card backgrounds |
| `var(--background)` | Page/panel backgrounds |
| `var(--danger)` | Delete buttons, past-due pills |

No raw hex colors or `text-red-*` patterns — all via CSS variables. Both themes (light/dark) handled at the variable level only.

### Date / TZ Conventions

- `USER_TZ = process.env.USER_TZ ?? "America/Denver"` — all TZ-aware math goes through this.
- **Key exports from `src/lib/calendar.ts`:** `dateKey(d)`, `parseDateKey(k)`, `startOfDay(d)`, `endOfDay(d)`, `addDays(d, n)`, `startOfWeekMonday(d)`, `endOfWeekSunday(d)`.
- `parseDateKey(k)` handles bare `yyyy-mm-dd` input (HTML date input). `parseDateInput(s)` in tools.ts wraps this: bare dates go through `parseDateKey`; full ISO strings through `new Date(s)`.
- `new Date(w.startedAt).toLocaleDateString()` is used in Today page for display only (client TZ — acceptable for display). `new Date(g.targetDate).toLocaleDateString()` likewise. No date arithmetic uses these patterns.
- `date-fns` is NOT used in this codebase. All date arithmetic is through the `@/lib/calendar` helpers.

---

## Related Existing Code

### Files to Be Modified

| File | Current purpose | Key exports | Approximate line count |
|---|---|---|---|
| `prisma/schema.prisma` | DB schema | Goal, Hike, Plan models | 365 lines |
| `src/lib/goal-focus.ts` | **NEW** | `getFocusGoal`, `getActiveGoalsWithPlans` | — |
| `src/lib/goal-events.ts` | **NEW** | `getGoalEvents`, `eventsByDateKey`, `otherGoalEvents`, types | — |
| `src/lib/goal-conflicts.ts` | **NEW** | `CROSS_GOAL_RULES`, `crossGoalConflicts`, types | — |
| `src/lib/calendar.ts` | ResolvedDay, resolveDay, getCalendarMonth, weekConflicts, date utils | All | 1056 lines |
| `src/lib/goal-actions.ts` | Server actions for goal CRUD + focus | `createGoal`, `updateGoal`, `setActiveGoal`, `deleteGoal` | 201 lines |
| `src/lib/goal-core.ts` | Core create logic (shared action+MCP) | `createGoalCore` | 115 lines |
| `src/lib/program.ts` | Active program resolution | `getActiveProgram`, `getTodayContext` | 95 lines |
| `src/lib/records.ts` | Baselines + PRs | `getBaselineSchedule`, `recordsSetInWorkout`, types | 592 lines |
| `src/lib/plan-lint.ts` | Plan linting | `lintActivePlan`, `lintTemplate` | ~260 lines |
| `src/lib/game/engine.ts` | XP engine | `computeGameState` | ~1000 lines |
| `src/lib/mcp/tools.ts` | All MCP tools | `registerTools` | ~4250 lines |
| `src/app/api/mcp/route.ts` | MCP HTTP endpoint + server instructions | server instructions constant | ~50 lines |
| `src/app/goals/page.tsx` | Goals list + create form | GoalsPage | 139 lines |
| `src/app/goals/[id]/page.tsx` | Goal detail + edit | GoalDetail | 195 lines |
| `src/app/page.tsx` | Today page | HomePage | 319 lines |
| `src/app/calendar/page.tsx` | Calendar page | CalendarPage | 134 lines |
| `src/app/days/[dateKey]/page.tsx` | Day detail | DayDetail | 282 lines |
| `src/components/CalendarMonth.tsx` | Client calendar grid | CalendarMonth | 341 lines |
| `src/components/OtherGoalsStrip.tsx` | **NEW** server component | OtherGoalsStrip | — |
| `src/app/baselines/new/page.tsx` | Baseline logging form | LogBaselinePage | 69 lines |
| `src/app/progress/page.tsx` | Progress charts | ProgressPage | ~130 lines |
| `src/app/stats/page.tsx` | Stats page | StatsPage | ~110 lines |

### Full Type Definitions

#### `ResolvedDay` (calendar.ts:347–421)

```ts
export type ResolvedDay = {
  date: Date;
  dateKey: string;
  isInPlan: boolean;
  isGoalDate: boolean;
  rotationDay: number | null;
  weekIndex: number | null;
  workoutTemplate: DayTemplate | null;
  isOverride: boolean;
  workoutDeferredForBaseline: boolean;
  plannedHikeToday: {
    id: string; route: string; distanceMi: number; elevationFt: number;
    packWeightLb: number | null; durationMin: number; date: Date;
  } | null;
  workoutDeferredForHike: boolean;
  longEffortConflict: {
    rotationLongEffortDate: string;
    plannedHikeDates: string[];
  } | null;
  nutritionText: string | null;
  nutritionPlan: NutritionPlan | null;
  mobilityText: string | null;
  notes: string | null;
  workouts: { id: string; startedAt: Date; title: string | null; exerciseCount: number; status: string }[];
  loggedNutrition: { id: string; date: Date; mealType: string; items: unknown; notes: string | null; }[];
  baselinesDue: {
    test: BaselineTest;
    baselineDay: BaselineDay;
    checkpoint: "initial" | "retest";
    loggedOnDate: { id: string; value: number; units: string; date: Date } | null;
  }[];
  notesAboutDate: { id: string; body: string; type: string; date: Date; targetDate: Date | null }[];
  goalObjective: string | null;
  confidence: "past" | "confirmed" | "provisional" | null;
  override?: { id: string; workoutJson?: unknown; baselineTestNames?: unknown; nutritionText?: string; nutritionPlan?: NutritionPlan; mobilityText?: string; notes?: string; } | null;
};
```

**Extension for REQ-104:** Add `otherGoalEvents: GoalEvent[]` and `crossGoalConflicts: CrossGoalConflict[]` — additive only (no existing field renamed).

#### `CalendarDayCell` (calendar.ts:9–36)

```ts
export type CalendarDayCell = {
  date: Date;
  dateKey: string;
  isPast: boolean;
  isToday: boolean;
  isFuture: boolean;
  isInPlan: boolean;
  isGoalDate: boolean;
  rotationDay: number | null;
  weekIndex: number | null;
  dayTitle: string | null;
  workoutCount: number;
  hikeCount: number;
  plannedHikeCount: number;
  hasOverride: boolean;
  baselinesDue: number;
  conflict: { kind: "long-effort" | "retest-on-hike"; withDates: string[] } | null;
  confidence: "past" | "confirmed" | "provisional" | null;
};
```

**Extension for REQ-103/104:** `conflict` type widens to include cross-goal kinds: `"long-effort" | "retest-on-hike" | "event-on-hard-day" | "key-events-same-week" | "event-near-long-effort"`. Optional `goalId?: string` and `label?: string` fields are additive. `CalendarDayCell` also gains `otherGoalEvents?: GoalEvent[]`.

#### `WeekConflict` (calendar.ts:42–49)

```ts
export type WeekConflict = {
  dateKey: string;
  kind: "long-effort" | "retest-on-hike";
  withDates: string[];
};
```

**Extension for REQ-103:** `kind` union adds `"event-on-hard-day" | "key-events-same-week" | "event-near-long-effort"`. Add optional `goalId?: string` and `label?: string` backward-compatibly.

#### `DayTemplate` (program-template.ts:22–37)

```ts
export type DayTemplate = {
  dayOfWeek: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  title: string;
  category: "upper" | "lower" | "zone2-mobility" | "calisthenics" | "lower-power" | "long-endurance" | "rest";
  summary: string;
  blocks: Block[];
};
```

#### `BaselineDay` (program-template.ts:79–83)

```ts
export type BaselineDay = {
  dayOfWeek: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  title: string;
  tests: BaselineTest[];
};
```

#### `BaselineTest` (program-template.ts:63–77)

```ts
export type BaselineTest = {
  testName: string;
  units: string;
  protocol: string;
  initialWeek?: number;
  retestWeeks: number[];
  signed?: boolean;
};
```

#### `ScheduledBaseline` and `ScheduledCheckpoint` (records.ts:8–43)

```ts
export type CheckpointStatus = "upcoming" | "due" | "overdue" | "done";

export type ScheduledCheckpoint = {
  week: number;
  targetDate: Date;
  label: "initial" | "retest";
  status: CheckpointStatus;
  completedOn?: Date;
  completedValue?: number;
  unanchored?: boolean;
};

export type ScheduledBaseline = {
  testName: string;
  units: string;
  protocol: string;
  dayOfWeek: number;
  retestWeeks: number[];
  checkpoints: ScheduledCheckpoint[];
  latestResult: { date: Date; value: number; units: string } | null;
  resultCount: number;
};
```

#### Legend Types (legend.ts)

```ts
export type LegendKind = "trained" | "hike-completed" | "hike-planned" | "override" | "goal-date" | "baseline";

export type LegendEntry = {
  icon: string;   // 1-8 chars, emoji or glyph
  label: string;  // 1-40 chars
  kind: LegendKind;
};

export type Legend = LegendEntry[];

export const DEFAULT_LEGEND: readonly LegendEntry[] = [
  { icon: "●", label: "Trained", kind: "trained" },
  { icon: "🥾", label: "Outdoor day", kind: "hike-completed" },
  { icon: "🥾", label: "Hike planned", kind: "hike-planned" },
  { icon: "⛏️", label: "Custom day", kind: "override" },
  { icon: "🏔️", label: "Goal date", kind: "goal-date" },
  { icon: "◎", label: "Baseline due", kind: "baseline" },
];
```

---

## Deep-Dive Answers

### 1. DayTemplate.category — ALL values

All seven values in `weeklySplit` of `PROGRAM_TEMPLATE`:

| dayOfWeek | category | title |
|---|---|---|
| 1 | `"upper"` | Upper Body + Core |
| 2 | `"lower"` | Lower Body + Cardio |
| 3 | `"zone2-mobility"` | Zone 2 + Mobility |
| 4 | `"calisthenics"` | Full Body Calisthenics |
| 5 | `"lower-power"` | Lower + Explosive + Core |
| 6 | `"long-endurance"` | Long Endurance |
| 7 | `"rest"` | Rest / Active Recovery |

**Long-endurance day = category `"long-endurance"` (dayOfWeek: 6).**

`weekConflicts` finds it at calendar.ts:870 via:
```ts
const longTmpl = program.template.weeklySplit.find((d) => d.category === "long-endurance");
if (longTmpl !== undefined) {
  const longDate = addDays(startOfDay(program.startedOn), (weekIndex - 1) * 7 + (longTmpl.dayOfWeek - 1));
  const longKey = dateKey(longDate);
  // checks if hikeOnLongDay === undefined && hikesElsewhere.length > 0
}
```

This is correct behavior — it is rotation-relative, not calendar-weekday-hardcoded.

### 2. ResolvedDay Full Type

Quoted above in the Types section. Complete field list for additive extension:
`date, dateKey, isInPlan, isGoalDate, rotationDay, weekIndex, workoutTemplate, isOverride, workoutDeferredForBaseline, plannedHikeToday, workoutDeferredForHike, longEffortConflict, nutritionText, nutritionPlan, mobilityText, notes, workouts[], loggedNutrition[], baselinesDue[], notesAboutDate[], goalObjective, confidence, override?`

New fields to add: **`otherGoalEvents: GoalEvent[]`** (default `[]`) and **`crossGoalConflicts: CrossGoalConflict[]`** (default `[]`).

### 3. resolveDay Internals — Promise.all Structure

**Location: calendar.ts:449–502**

```ts
const [workouts, override, notesForDate, goal, nutrition, plannedHikesThisWeek] = await Promise.all([
  // 1. prisma.workout.findMany — all workouts for this date
  // 2. planDayOverride.findUnique — the plan day override (if any)
  // 3. prisma.note.findMany — notes about this date
  // 4. prisma.goal.findFirst({ where: { active: true }, orderBy: { updatedAt: "desc" },
  //       select: { targetDate: true, objective: true } }) ← MISSING id field!
  // 5. prisma.nutritionLog.findMany — logged nutrition
  // 6. hike.findMany for the week (gated on weekWindow !== null)
]);
```

**Critical finding:** The `goal` query at calendar.ts:470–474 selects only `{ targetDate: true, objective: true }` — it does **NOT** select `id`. REQ-104 requires goal `id` for focus goal attribution in `resolveDay`. This select must be extended to include `id`.

**Where a goalEvents fetch slots in:** As a 7th item in the Promise.all:
```ts
// 7. getGoalEvents or read from ctx if pre-assembled
weekWindow ? getGoalEvents({ start: weekWindow.start, end: weekWindow.end }) : Promise.resolve([])
```

Or, if caller provides `ctx?: { goalEvents: GoalEvent[]; focusGoalId: string | null }`, skip the fetch entirely. The `resolveDay(date, ctx?)` signature accommodates this cleanly.

### 4. getCalendarMonth Internals

**Location: calendar.ts:51–158**

**Promise.all at lines 61–85:**
```ts
const [workouts, hikes, overrides, goal] = await Promise.all([
  prisma.workout.findMany({ where: { startedAt: { gte: gridStart, lte: gridEnd } }, select: {...} }),
  prisma.hike.findMany({ where: { date: ..., status: { in: ["completed", "planned"] } }, select: {...} }),
  program?.id ? prisma.planDayOverride.findMany({ where: { planId: program.id, date: ... } }) : [],
  prisma.goal.findFirst({
    where: { active: true },
    orderBy: { updatedAt: "desc" },
    select: { id: true, targetDate: true, objective: true, legend: true }
  }),
]);
```

**Cell building:** `buildCell(args)` is called for each day in the grid. It takes pre-fetched Maps and derives all cell fields without IO. `const goalKey = goal ? dateKey(goal.targetDate) : null;` (line 132) — **this crashes if `targetDate` is null** after REQ-101.

**Return type:**
```ts
return { monthStart, monthEnd, cells, program, goal };
```

For REQ-104, `getCalendarMonth` needs to:
1. Add goal events query to Promise.all (for the grid range)
2. Compute crossGoalConflicts once for the grid
3. Extend each cell with `otherGoalEvents`
4. Return `otherGoals: { id, objective, legend }[]` in addition to the existing fields

### 5. Goals Page — Full JSX Structure

**File: src/app/goals/page.tsx (lines 22–138)**

Current structure:
1. **Query:** `prisma.goal.findMany({ orderBy: [{ active: "desc" }, { updatedAt: "desc" }] })` — no `isFocus` field yet
2. **`focusedId`:** `goals[0]?.active ? goals[0].id : null` — infers focus from ordering (first active = focus). After REQ-101, replace with `goals.find(g => g.isFocus)?.id ?? null`
3. **`copySources`:** maps `g.targetDate.toISOString()` — will crash when null
4. **`goalProgress` function:** `g.targetDate.getTime()` direct — will crash when null; needs `if (!g.targetDate) return g.status === "achieved" ? 1 : 0`
5. **`days` calculation:** `(new Date(g.targetDate).getTime() - now)` — same crash
6. **Per-row layout:** Bullseye + objective + isFocused "Active" badge + targetDate + status pill + days pill + Manage link
7. **Action wiring:** `setActiveGoal.bind(null, g.id)` as form action on non-focused rows (rename to `setFocusGoal`)
8. **No Track/Untrack control exists yet** — needs per-row pill for `setGoalTracked`
9. **"Active" badge** becomes **"Focus" badge** (REQ-105)
10. **Days pill** needs to render "Someday" chip when `targetDate === null`

### 6. goal-actions.ts — Every Export

**Exports:**
- `GoalReference` (type)
- `createGoal(form: FormData)` — "Target date is required" guard at line 43; parseDateKey at line 50; NaN guard at line 51
- `copyTargetsFromGoal(toId, fromId)`
- `updateGoal(id, form: FormData)` — "Target date is required" guard at line 94; parseDateKey at line 100; NaN guard at line 101
- `setActiveGoal(id: string)` — **rename to `setFocusGoal`**; currently deactivates all other goals+plans globally
- `deleteGoal(id: string)`
- `addGoalReference(id, form)` / `removeGoalReference(id, refId)`

**`setActiveGoal` internals (to be converted to `setFocusGoal`):**
```ts
// Current:
await tx.goal.updateMany({ where: { id: { not: id } }, data: { active: false } }); // REMOVE
await tx.goal.update({ where: { id }, data: { active: true } }); // KEEP (but for isFocus)
await tx.plan.updateMany({ where: { goalId: { not: id } }, data: { active: false } }); // REMOVE
// latest plan activation: keep but scope to target goal only
```

**"Target date is required" validation** lives at:
- `createGoal`: line 43 `if (!targetDateStr) throw new Error("Target date is required")`
- `updateGoal`: line 94 `if (!targetDateStr) throw new Error("Target date is required")`

These guards must be **removed** (REQ-101 allows null targetDate). The `<input type="date" required>` attributes in both form components must also be changed to optional.

**`revalidatePath` sets:**
- `setActiveGoal`: `/`, `/calendar`, `/goals`, `/goals/${id}`, `/stats`
- `createGoal`: `/goals`, `/stats`
- `updateGoal`: `/goals`, `/goals/${id}`, `/stats`
- `deleteGoal`: `/goals`, `/stats`
- `copyTargetsFromGoal`: `/goals/${toId}`, `/stats`

### 7. Goal Create/Edit Forms

**GoalCreateForm.tsx:**
- `"use client"` — manages flavor state
- `<input type="date" name="targetDate" required>` — must become optional for someday goals (REQ-101)
- `<select name="flavor">` — uses FLAVOR_GROUPS/FLAVOR_PRESETS for optgroup picker
- Flavor state wires a legend preview below the select
- Submits via `createGoal` server action
- No `isFocus` or `tracked` inputs (not needed on create)

**GoalEditForm.tsx:**
- `"use client"` — manages transition + error state
- `<input type="date" name="targetDate" required defaultValue={defaultValues.targetDate}>` — must become optional (REQ-101)
- `defaultValues.targetDate` is `new Date(goal.targetDate).toISOString().slice(0, 10)` at goals/[id]/page.tsx:120 — crashes when null → needs `goal.targetDate ? new Date(goal.targetDate).toISOString().slice(0, 10) : ""`
- No flavor picker (editing flavor is via MCP `update_goal_legend`)

### 8. MCP safe() + DateKeyShape + parseDateInput

Exact definitions quoted above in the Existing Patterns section. Repeating for clarity:

```ts
// tools.ts:70-73
const DateKeyShape = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "use yyyy-mm-dd")
  .describe("ISO date yyyy-mm-dd in the user's local time zone");

// tools.ts:237-243
async function safe<T>(fn: () => Promise<T>) {
  try {
    return jsonResult(await fn());
  } catch (e) {
    return errorResult(e instanceof Error ? e.message : String(e));
  }
}

// tools.ts:248-250
function parseDateInput(s: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? parseDateKey(s) : new Date(s);
}
```

### 9. records.ts getBaselineSchedule Internals

**Location: records.ts:189–304**

**Key: global active-plan lookup at lines 196–199:**
```ts
const plan = await prisma.plan.findFirst({
  where: { active: true },
  orderBy: { updatedAt: "desc" },
});
if (!plan) return { startedOn: null, totalWeeks: null, scheduled: [], unscheduledExtras: [] };
```

This is **the seam for REQ-102**: factor out to `getBaselineScheduleForPlan(plan, opts?)` and wrap with a focus-plan fetcher.

**Internal structure:**
1. Gets `plan.planJson` as `ProgramTemplate` and `plan.startedOn`
2. Flattens `template.baselineWeek` into `flat: { day, test }[]`
3. Queries ALL baselines once: `prisma.baseline.findMany({ orderBy: { date: "asc" } })`
4. Builds checkpoint windows: `initialWeek * 7` offset from startedOn; retestWeeks similarly
5. `statusFor()` helper: window-based match (result in window = done)
6. Unanchored retest detection: chain walk
7. Returns `{ startedOn, totalWeeks, scheduled, unscheduledExtras }`

**Module-local `addDays` (records.ts:307–309):**
```ts
function addDays(d: Date, n: number): Date {
  return endOfDay(addDaysCal(d, n));
}
```
This is **different** from the calendar.ts `addDays` (which gives midnight, not end-of-day). This is intentional — checkpoint windows use end-of-day bounds. The pure `baselineCheckpointDates()` function to extract for REQ-102 should replicate this semantics.

**ScheduledBaseline and ScheduledCheckpoint types** are quoted above.

### 10. game/engine.ts:932 — Active Goal Context

**Location: engine.ts:931–935 (within `_computeGameState` Promise.all)**

```ts
prisma.goal.findFirst({
  where: { active: true },
  orderBy: { updatedAt: "desc" },
  select: { id: true, kind: true },
}),
```

This resolves to the `goal` variable. It is used for:
1. `if (!program) return emptyState()` — guard (not goal-related)
2. `goal?.kind ?? "fitness"` — determines which rule pack (attributes) to use for XP
3. The `goalKind` field in `GameState.goalKind: string | null`

**Scope for `isFocus` flip:** Change the query to `where: { isFocus: true }` (after REQ-101 migration). The returned `kind` field doesn't change meaning — the focus goal's kind determines the attribute pack. The `id` field is used in `rulePackForGoal` and `attributes-registry.ts` but only for kind-lookup. No structural change needed beyond the `where` clause.

### 11. All `active:true` Goal/Plan Query Sites

**Full inventory (excluding generated/prisma):**

| File:Line | Current semantics | Disposition after REQ-101 |
|---|---|---|
| `calendar.ts:78` | getCalendarMonth goal query | → focus-scoped: `{ isFocus: true }` |
| `calendar.ts:471` | resolveDay goal query | → focus-scoped: `{ isFocus: true }` |
| `calendar.ts:737` | getPendingNotesCount plan query | → focus-scoped: `{ active:true, goal:{isFocus:true} }` |
| `plan-lint.ts:221` | lintActivePlan plan query | → focus-scoped plan |
| `records.ts:197` | getBaselineSchedule plan query | → via REQ-102 seam (`getBaselineScheduleForPlan`) |
| `game/engine.ts:932` | computeGameState goal query | → `{ isFocus: true }` |
| `program.ts:28` | getActiveProgram Plan lookup | → `{ active:true, goal:{isFocus:true} }` with fallbacks |
| `program.ts:41` | getActiveProgram Program fallback | stays global (legacy fallback) |
| `goal-core.ts:96` | new plan is `active:true` | stays (correct — new plan is active) |
| `goal-actions.ts:128` | setActiveGoal sets goal active | removed — `setFocusGoal` sets `isFocus:true` only |
| `goal-actions.ts:144` | setActiveGoal activates plan | kept — `setFocusGoal` still activates target plan |
| `app/goals/[id]/page.tsx:28` | `plans: { where: { active:true } }` | stays — goal-scoped, fine |
| `app/progress/page.tsx:17` | `goal.findMany({ where:{active:true} })` | → multi-goal: `findMany` all active goals (no change needed if query stays as multi) |
| `app/goals/[id]/plan/page.tsx:22` | `plans: { where: { active:true } }` | stays — goal-scoped |
| `app/goals/[id]/revise/page.tsx:20` | `plans: { where: { active:true } }` | stays — goal-scoped |
| `app/baselines/new/page.tsx:18` | `plan.findFirst({ where:{active:true} })` | → focus-scoped |
| `app/stats/page.tsx:19` | `goal.findMany({ where:{active:true} })` | → multi-goal: all active goals |
| `mcp/tools.ts:602` | get_today_plan goal query | → `{ isFocus: true }` |
| `mcp/tools.ts:764` | list_goals includes active plans | stays (per-goal) |
| `mcp/tools.ts:797` | get_goal includes active plans | stays (per-goal) |
| `mcp/tools.ts:881` | compute_readiness fallback | → `{ isFocus: true }` |
| `mcp/tools.ts:913` | get_pending_notes plan query | → focus-scoped |
| `mcp/tools.ts:1186` | get_session_brief goal query | → `{ isFocus: true }` |
| `mcp/tools.ts:3826` | acknowledge_lint plan query | → focus-scoped |
| `mcp/tools.ts:3880` | clear_lint plan query | → focus-scoped |
| `mcp/tools.ts:3948` | grant_bonus_xp goal query | → `{ isFocus: true }` |

### 12. targetDate Null-Handling

Sites that read `targetDate` directly in non-null contexts (will crash when null):

| File:Line | What it does | Null-handling needed |
|---|---|---|
| `calendar.ts:132` | `const goalKey = goal ? dateKey(goal.targetDate) : null` | → `goal?.targetDate ? dateKey(goal.targetDate) : null` |
| `calendar.ts:602` | `isGoalDate = !!goal && dateKey(goal.targetDate) === dateKey(date)` | → `!!goal && !!goal.targetDate && dateKey(goal.targetDate) === dateKey(date)` |
| `app/calendar/page.tsx:103` | `new Date(goal.targetDate).toLocaleDateString()` | → `goal.targetDate && new Date(goal.targetDate).toLocaleDateString()` |
| `app/goals/page.tsx:11-16` | `goalProgress` function: `g.targetDate.getTime()` | → guard `if (!g.targetDate) return g.status === "achieved" ? 1 : 0` |
| `app/goals/page.tsx:37` | `g.targetDate.toISOString()` (CopySource) | → `g.targetDate?.toISOString() ?? ""` |
| `app/goals/page.tsx:68` | `new Date(g.targetDate).getTime() - now` (days pill) | → render "Someday" chip when null |
| `app/goals/page.tsx:91` | `new Date(g.targetDate).toLocaleDateString()` | → guard or "Someday" |
| `app/goals/[id]/page.tsx:91` | CopySource `g.targetDate.toISOString()` | → `?.toISOString() ?? ""` |
| `app/goals/[id]/page.tsx:98` | `new Date(goal.targetDate).getTime() - nowMs` | → guard |
| `app/goals/[id]/page.tsx:109` | `new Date(goal.targetDate).toLocaleDateString()` | → guard |
| `app/goals/[id]/page.tsx:120` | `new Date(goal.targetDate).toISOString().slice(0, 10)` | → `goal.targetDate ? new Date(...).toISOString().slice(0,10) : ""` |
| `app/progress/page.tsx:111` | `new Date(goal.targetDate).toLocaleDateString()` | → guard |
| `app/progress/page.tsx:118` | `targetDate={goal.targetDate.toISOString()}` (ReadinessChart) | → `targetDate={goal.targetDate?.toISOString() ?? null}` |
| `app/stats/page.tsx:94` | `new Date(goal.targetDate).toLocaleDateString()` | → guard |
| `app/stats/page.tsx:100` | `targetDate={goal.targetDate.toISOString()}` | → `?.toISOString() ?? null` |
| `plan-lint.ts:237` | `goalTargetDate: goal?.targetDate ?? plan.endsOn` | → already null-safe (falls back to plan.endsOn) |
| `plan-lint.ts:242` | `startOfDay(goal.targetDate)` | → already guarded by `if (goal && ...)` |
| `mcp/tools.ts:4089` | `toDateKey(goal.targetDate)` in update_goal response | → `goal.targetDate ? toDateKey(goal.targetDate) : null` |
| `mcp/tools.ts:769` | `targetDate: g.targetDate` in list_goals | → stays as-is (Prisma returns Date|null, JSON serializes to null) |
| `mcp/tools.ts:1248` | `daysToGo = activeGoal.targetDate ? ... : null` | already null-safe |

### 13. ScheduledItem Usage

`ScheduledItem` appears only in:
- `prisma/schema.prisma` — model definition (goalId FK, goalId+externalRef unique, date/type/title/status/completedAt fields)
- `src/lib/mcp/tools.ts:4119` — `delete_goal` cascade description: "ScheduledItems...linked to this goal"
- `src/lib/mcp/tools.ts:4158` — `prisma.scheduledItem.count({ where: { goalId } })` in delete_goal cascade count

**No write tools exist yet** for ScheduledItem (no `schedule_item` or `create_scheduled_item` tool). The `getGoalEvents` function in REQ-102 should query `prisma.scheduledItem.findMany({ where: { goalId: { in: activeGoalIds }, date: { gte: start, lte: end }, status: "planned" } })` for the event range. This will NOT double-display anything since ScheduledItems are never shown on Today, Calendar, or Day pages currently.

---

## targetDate Read-Site Inventory

| File:Line | What it does | Null-handling needed |
|---|---|---|
| `calendar.ts:132` | Compute goalKey for CalendarMonth | Yes — `goal.targetDate ? dateKey(goal.targetDate) : null` |
| `calendar.ts:602` | isGoalDate check in resolveDay | Yes — add `&& !!goal.targetDate` guard |
| `app/calendar/page.tsx:103` | Display goal date in footer | Yes — conditional render |
| `app/goals/page.tsx:11` | goalProgress function param type | Yes — make targetDate optional |
| `app/goals/page.tsx:16` | `g.targetDate.getTime()` in total calc | Yes — early return when null |
| `app/goals/page.tsx:37` | CopySource targetDate field | Yes — `?.toISOString() ?? ""` |
| `app/goals/page.tsx:68` | Days pill calc | Yes — "Someday" chip |
| `app/goals/page.tsx:91` | Date display next to objective | Yes — "Someday" |
| `app/goals/[id]/page.tsx:91` | CopySource targetDate | Yes — `?.toISOString() ?? ""` |
| `app/goals/[id]/page.tsx:98` | days-out calculation | Yes — guard |
| `app/goals/[id]/page.tsx:109` | Date in header | Yes — "Someday" |
| `app/goals/[id]/page.tsx:120` | defaultValue for edit form | Yes — `goal.targetDate ? ... : ""` |
| `app/progress/page.tsx:111` | Date in progress card | Yes — conditional |
| `app/progress/page.tsx:118` | ReadinessChart targetDate prop | Yes — `?.toISOString() ?? null` |
| `app/stats/page.tsx:94` | Date display | Yes — guard |
| `app/stats/page.tsx:100` | ReadinessChart targetDate prop | Yes — `?.toISOString() ?? null` |
| `mcp/tools.ts:4089` | toDateKey(goal.targetDate) in response | Yes — `goal.targetDate ? toDateKey(...) : null` |
| `plan-lint.ts:237` | goalTargetDate fallback | Already null-safe (`?? plan.endsOn`) |
| `plan-lint.ts:242` | lint rule check | Already null-safe (`if (goal && ...)`) |

---

## active:true Call-Site Inventory

| File:Line | Current semantics | Disposition |
|---|---|---|
| `calendar.ts:78` | getCalendarMonth: focus goal for goalKey + legend | → `{ isFocus: true }` |
| `calendar.ts:471` | resolveDay: goal for isGoalDate | → `{ isFocus: true }` |
| `calendar.ts:737` | getPendingNotesCount: active plan | → `{ active:true, goal:{isFocus:true} }` |
| `plan-lint.ts:221` | lintActivePlan: focus plan | → focus-scoped plan |
| `records.ts:197` | getBaselineSchedule: focus plan | → via REQ-102 `getBaselineScheduleForPlan` seam |
| `game/engine.ts:932` | computeGameState: active goal kind | → `{ isFocus: true }` |
| `program.ts:28` | getActiveProgram: active plan | → `{ active:true, goal:{isFocus:true} }` |
| `program.ts:41` | getActiveProgram: Program fallback | stays global (legacy) |
| `goal-core.ts:80,81` | new goal/plan deactivation | REMOVE both updateMany calls |
| `goal-core.ts:96` | new plan `active:true` | stays (new plan always active) |
| `goal-actions.ts:127-128` | setActiveGoal: deactivate others + activate target | REFACTOR to isFocus flip |
| `goal-actions.ts:133,144` | setActiveGoal: plan deactivation/activation | refactor plan part to per-goal |
| `app/goals/[id]/page.tsx:28` | goal's plans where active | stays (goal-scoped, fine) |
| `app/goals/[id]/plan/page.tsx:22` | same | stays |
| `app/goals/[id]/revise/page.tsx:20` | same | stays |
| `app/baselines/new/page.tsx:18` | plan for baseline form | → focus-scoped |
| `app/progress/page.tsx:17` | all active goals | stays (multi-goal, all active goals contribute) |
| `app/stats/page.tsx:19` | all active goals | stays (multi-goal) |
| `mcp/tools.ts:602` | get_today_plan goal | → `{ isFocus: true }` |
| `mcp/tools.ts:764` | list_goals plans include | stays (per-goal) |
| `mcp/tools.ts:797` | get_goal plans include | stays (per-goal) |
| `mcp/tools.ts:881` | compute_readiness fallback | → `{ isFocus: true }` |
| `mcp/tools.ts:913` | get_pending_notes plan | → focus-scoped |
| `mcp/tools.ts:1186` | get_session_brief goal | → `{ isFocus: true }` |
| `mcp/tools.ts:3826` | acknowledge_lint plan | → focus-scoped |
| `mcp/tools.ts:3880` | clear_lint plan | → focus-scoped |
| `mcp/tools.ts:3948` | grant_bonus_xp goal | → `{ isFocus: true }` |

---

## Risks & Considerations

### Conflicts Between Goals on Same Day

The "event-on-hard-day" conflict kind fires when any non-focus active goal has a target-date event or retest event landing on a day whose focus rotation template is a hard category. Hard categories to include in `CROSS_GOAL_RULES.hardCategories`: `["upper", "lower", "lower-power"]`. `"calisthenics"` is moderate — PRD leaves this to implementers. `"zone2-mobility"` and `"rest"` are soft — should not trigger. `"long-endurance"` should be handled via the `event-near-long-effort` kind instead. Events on the same absolute calendar day (e.g. race-day marker + long-effort slot) should coexist in the `otherGoalEvents` array but only one `crossGoalConflict` per dateKey (most severe wins).

### Edge Cases

- **No focused goal (all untracked):** `getActiveProgram` already has fallback chain (global active Plan → Program table). `getGoalEvents` should return empty `[]` gracefully. `getFocusGoal` returns null. All UI renders as if no events exist.
- **Null targetDate (someday goal):** No target-date event emitted. "Someday" chip in UI. Progress = 0. Sorting: `orderBy: [{ isFocus: "desc" }, { active: "desc" }, { targetDate: { sort: "asc", nulls: "last" } }]`. Lint `goal-date` rule is skipped. MCP outputs `targetDate: null`.
- **Multiple goals stuck `isFocus: true`:** All readers use `findFirst(orderBy: { updatedAt: "desc" })` — deterministic winner, same as current active-goal convention.
- **Hike with goalId of deleted goal:** FK `onDelete: SetNull` — reverts to focus attribution at read-time.
- **Event on a day with a workoutJson override:** `event-on-hard-day` suppressed when `overrideDateKeys` includes the date.
- **DST week spans:** All math via `@/lib/calendar` helpers — already handled.
- **Override planJson from program-template.ts:** Live behavior reads `plan.planJson`. If a goal's planJson was scaffolded from PROGRAM_TEMPLATE and the template changes, live behavior is unaffected (gotcha: planJson is snapshot, not template reference).

### Migration Safety (Neon = Prod)

All three schema changes are metadata-only / additive:
- `ADD COLUMN "isFocus" BOOLEAN NOT NULL DEFAULT false` — constant default, no table rewrite in PG
- `ALTER COLUMN "targetDate" DROP NOT NULL` — metadata-only
- `ADD COLUMN "goalId" VARCHAR FK NULLABLE` on Hike — additive

The backfill SQL (`UPDATE "Goal" SET "isFocus" = true WHERE id = (SELECT id ... ORDER BY updatedAt DESC LIMIT 1)`) is a single targeted row update — safe under concurrent reads.

After applying: `npx prisma generate` must run before deploying (new Prisma client with isFocus/hikes fields).

### Performance (get_week Query Budget)

`get_week` currently loops `resolveDay × 7` (~42–49 DB queries). With REQ-104's ctx argument, `getGoalEvents` runs once for the week and is passed into each `resolveDay` call via ctx — net +3 queries max per get_week call (getActiveGoalsWithPlans + hikes in range + ScheduledItems in range). Acceptable per PRD §3.1.7.

For `getCalendarMonth`, a single `getGoalEvents` call for the grid range (gridStart → gridEnd) covers all 42 cells, then `eventsByDateKey()` maps them. Net +3 queries added to the existing 4-query month fetch.

### Mobile-Width Gotchas

- Calendar cells are `min-h-[3.75rem]` (~60px) at 390px. Each cell has a `flex flex-wrap` marker row. Foreign-goal markers compete for the ~5-7 icon budget per cell. UX-research results must guide: ring/chip distinction, cap at N icons per cell with overflow indicator.
- Today strip (`OtherGoalsStrip`) is a new server component between `CharacterHeader` and the hero card. Must render nothing (not even a `<div>`) when empty to avoid dead whitespace.
- The day-page banner for target-date events goes ABOVE the header section (before the `<header>`). The current day page layout starts with a Link back to /calendar then an `<h1>`. The banner card needs to be inserted between them.
- Tap targets ≥44px required. Track/Untrack pills need at least `py-2` with `min-h-[44px]` on mobile.

---

## Conventions Checklist

From CLAUDE.md, quality-tools.md, and project-gotchas.md — applicable to this feature:

1. **Mobile-first, 390px primary.** All new UI: start narrow, scale up. No fixed widths that break at 390px.
2. **Server components by default.** `OtherGoalsStrip` must be server. `"use client"` only where state/effects needed.
3. **All DB access via `prisma` singleton from `src/lib/db.ts`.** No direct Prisma Client instantiation.
4. **Tailwind tokens only.** `var(--accent)`, `var(--warning)`, `var(--target)`, `var(--card)`, `var(--border)`, `var(--muted)`. No raw hex. Both themes.
5. **No LLM calls in the app.** No `anthropic`/`openai` imports in new modules.
6. **`revalidatePath` after every server-action mutation.** Paths: `/`, `/calendar`, `/goals`, `/goals/${id}`, `/stats`. Missing a path leaves Today stale.
7. **`export const dynamic = "force-dynamic"` on every page that reads DB.** Required for new pages (OtherGoalsStrip is a component, not a page — no directive needed).
8. **All date arithmetic through `@/lib/calendar` helpers.** No `setHours(0,0,0,0)`, `getDate()`, `getMonth()`, `getFullYear()`, `new Date("yyyy-mm-dd")` (UTC midnight hazard). Grep AC-14 verifies this.
9. **Migrations on Neon are shared with prod.** Validate SQL diff before running. All three column changes are metadata-only — safe.
10. **`npx prisma generate` after schema edit.** Generated client at `src/generated/prisma`. Import Prisma types as `import { Prisma } from "@/generated/prisma/client"`.
11. **MCP tool inputs via Zod + `safe()` wrapper.** Every handler wrapped in `safe()`. Date strings via `parseDateInput`. New goalId inputs need existence + active-goal validation.
12. **Override-aware reads.** Today's prescription = `resolveDay(now).workoutTemplate`, never `getTodayContext().day`. `event-on-hard-day` uses `templateForRotationDay()` (not `resolveDay`), and suppresses when `overrideDateKeys` includes the date.
13. **Plan edits are lint-gated.** `lintTemplate()` runs before any template write. New modules that write plan data must run the lint tail.
14. **`planJson` is a snapshot, not the source template.** `src/lib/program-template.ts` changes don't affect live behavior. Live behavior reads `plan.planJson`. Retest event dates come from `addDays(plan.startedOn, week * 7)` per plan.
15. **Baseline goal events ignore plan overrides (Phase 1 limitation).** Non-focus goal retests are rotation-derived math — `PlanDayOverride.baselineTestNames` on a non-focus plan is ignored. Document in module header.
16. **Exercise alias map is hand-curated.** New baseline tests or Strong spelling variants won't auto-fold into records until added to `EXERCISE_ALIAS_GROUPS` in records.ts.
17. **`operatingRules live in THREE places** — `docs/server-instructions/goaldmine-rules.md`, `COACH_INSTRUCTIONS` in `src/app/api/mcp/[token]/route.ts`, and the deployed connector text. Change all three together.
18. **No PRs by default.** Push directly to `main` with conventional commits (`feat:`, `fix:`). Ask if a branch is desired.
19. **TypeScript strict mode.** `npx tsc --noEmit` must be 0 errors. `npm run lint` (ESLint v9 + next/core-web-vitals + next/typescript) must have no new errors. `npm run build` must succeed.
20. **No tests configured.** Manual smoke + typecheck + lint are the gates. MCP curl smoke after any tools.ts change (per quality-tools.md).
21. **`baseline` LegendKind is closed.** New foreign-goal rendering conditions need a new `LegendKind` value AND a render branch in `CalendarMonth.tsx`. For this feature, a new kind is NOT needed — foreign-goal markers render via the goal's existing `goal-date` legend entry.
22. **`cross-goal conflict kind` is purely advisory.** Never auto-resolved. Surfaced as `cell.conflict.kind` and in MCP conflict arrays. The conflict fills `cell.conflict` only when no same-goal conflict exists (legacy precedence).
23. **Single-user app.** No auth beyond the MCP bearer token. No per-user data isolation needed.
24. **Worktree agents must sync to main HEAD** and symlink node_modules/.env before working (from memory CLAUDE.md).
25. **Prisma 7 config split.** Datasource URL in `prisma.config.ts`. Generator path `src/generated/prisma`. Import types: `import { Prisma } from "@/generated/prisma/client"`.
26. **Patch-style MCP tools follow ops pattern.** New tools follow `nutrition_log_ops` / `workout_ops` shape: pure transform, sequential ops, abort-on-first-bad-op, lint-gated for plan writes.
27. **`hike.goalId` is read-time attribution, null = focus.** Comment must appear in `getGoalEvents`: "Attribution: hike.goalId ?? focusGoalId — null at log time means 'the focus goal at time of hike', resolved at read time."
28. **`getCalendarMonth` returns `{ monthStart, monthEnd, cells, program, goal }`** — after REQ-104 it gains `otherGoals`. Callers in `calendar/page.tsx` destructure this; the new field is additive.
