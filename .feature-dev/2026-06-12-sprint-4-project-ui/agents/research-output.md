# Research Output — Sprint 4: Goal-Type-Aware Project UI

**Date**: 2026-06-12  
**Scope**: Pre-implementation findings for Dev A (REQ-001/002), Dev B (REQ-003/004), Dev C (REQ-005/006)

---

## 1. `src/app/page.tsx` — Full Anatomy & Branch Insertion Point

**File**: `/Users/ggronnii/Development/goaldmine/src/app/page.tsx` (335 lines)

### Current data-fetch block

The page performs two sequential fetch phases:

**Phase 1 — synchronous** (lines 18–19): `getActiveProgram()` is awaited alone, immediately followed by the `NoActiveProgram` early-return guard (lines 19–30). This is important: currently the guard fires before any parallel fetch happens.

```tsx
// line 18
const program = await getActiveProgram();
if (!program) {
  return (
    <div className="max-w-md mx-auto p-4">
      <Card title="No active program">
        <p className="text-sm text-[var(--muted)]">
          <strong className="font-semibold text-[var(--foreground)]">No active program yet.</strong>{" "}
          Run <code className="text-xs bg-[var(--card)] px-1 rounded">npx prisma db seed</code> to create the 90-day plan.
        </p>
      </Card>
    </div>
  );
}
```

**Phase 2 — parallel** (lines 32–59): `getTodayContext(program)` is called synchronously at line 32, then `now`, `todayStart`, `todayEnd`, `todayDateKey` are computed (lines 33–38), followed by the `Promise.all` of 6 items (lines 40–59):

```tsx
const ctx = getTodayContext(program);
const now = new Date();
const todayStart = startOfDay(now);
const todayEnd = endOfDay(now);
const todayDateKey = dateKey(now);

const [latestMeasurement, recentWorkouts, resolved, todayNutrition, gameState, weekGoalEvents] =
  await Promise.all([
    prisma.measurement.findFirst({ orderBy: { date: "desc" } }),
    prisma.workout.findMany({ where: { status: "completed" }, orderBy: { startedAt: "desc" }, take: 3, include: { exercises: { include: { sets: true } } } }),
    resolveDay(now),
    prisma.nutritionLog.findMany({ where: { date: { gte: todayStart, lte: todayEnd } }, orderBy: { date: "asc" } }),
    computeGameState(),
    getGoalEvents({ start: todayStart, end: endOfDay(addDays(now, 6)) }),
  ]);
```

**Phase 3 — derived locals** (lines 61–128): various consts derived from `resolved`, `program`, `ctx`.

**JSX** (lines 129–255):  
```tsx
return (
  <div className="max-w-md mx-auto p-4 space-y-4">
    {gameState.goalKind !== null && (<CharacterHeader state={gameState} />)}
    <OtherGoalsStrip ... />
    <section ... aria-label="Today's workout">  {/* hero card */}
      ...
    </section>
    {baselinesDue.length > 0 && <BaselineBlockCard ... />}
    {dayBlocks.map((block, i) => <BlockCard ... />)}
    ...
    <Card title="Nutrition">...</Card>
    ...
  </div>
);
```

### Conditional ordering that satisfies ALL three ACs with minimal diff

The ACs require:
- (A) project focus → ProjectTodayView
- (B) fitness/null → existing body byte-identical
- (C) null goal + null program → existing NoActiveProgram card

**Minimum-diff insertion**: Replace the single `await getActiveProgram()` (line 18) with a two-item `Promise.all` to fetch both in parallel, then thread the two early-returns before `getTodayContext`:

```tsx
// REPLACE line 18 (single await) with:
const [program, focusGoal] = await Promise.all([
  getActiveProgram(),
  getFocusGoal(),   // new import from "@/lib/goal-focus"
]);

// REPLACE lines 19-30 (original guard) with:
// AC-C: null goal + null program → NoActiveProgram (unchanged card)
if (!program && focusGoal?.kind !== 'project') {
  return (
    <div className="max-w-md mx-auto p-4">
      <Card title="No active program">
        ...  {/* byte-identical inner JSX */}
      </Card>
    </div>
  );
}

// AC-A: project focus wins over lingering fitness program.
// Precedence: project goal takes the screen regardless of program state.
if (focusGoal?.kind === 'project') {
  return <ProjectTodayView goal={focusGoal} />;
}

// AC-B: fitness/null — existing body byte-identical from here.
// program is guaranteed non-null at this point (null was caught by AC-C above).
const ctx = getTodayContext(program!);
// ... rest of existing code unchanged ...
```

**Why this satisfies all three**:
- `!program && focusGoal?.kind !== 'project'` → catches (C) (both null/non-project)
- `focusGoal?.kind === 'project'` → catches (A) (project goal, regardless of program)
- After both returns, `program` is non-null, rest of page unchanged → satisfies (B)

**Diff cost**: 3 lines changed (the `await getActiveProgram()` line + the guard open/close), plus the new 4-line early return. The fitness JSX (lines 129–255) is **not touched**.

**Note**: `getTodayContext(program!)` at line 32 needs `!` since TypeScript sees `program` as `ActiveProgramSnapshot | null` after the `Promise.all`. The non-null assertion is safe — the AC-C branch above would have returned if program were null.

---

## 2. `getFocusGoal` — Signature, Select, Blast Radius

**File**: `/Users/ggronnii/Development/goaldmine/src/lib/goal-focus.ts`

```ts
export type FocusGoalRow = {
  id: string;
  objective: string;
  targetDate: Date | null;
  kind: string;
  isFocus: boolean;
  legend: unknown;
};

export async function getFocusGoal(): Promise<FocusGoalRow | null> {
  return prisma.goal.findFirst({
    where: { isFocus: true },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      objective: true,
      targetDate: true,
      kind: true,
      isFocus: true,
      legend: true,
    },
  });
}
```

**Current select fields**: `id, objective, targetDate, kind, isFocus, legend`. **Does NOT select `targets`**.

**What ProjectTodayView needs**: `id, objective, targetDate, targets` (for MRR card). 

**Recommendation — do NOT extend `getFocusGoal`**. Blast radius: `getFocusGoal` is currently only imported by `page.tsx` (new, this sprint). `getActiveGoalsWithPlans` (different function in same file) is used by `goal-events.ts`. Extending `getFocusGoal` would be safe in isolation, BUT ProjectTodayView is a server component that already does its own DB reads (items today, log entries, next milestone). It should fetch `targets` itself:

```ts
// Inside ProjectTodayView, at the top of its own Promise.all:
const goalRow = await prisma.goal.findUnique({
  where: { id: props.goal.id },
  select: { targets: true },
});
const targets = (goalRow?.targets as GoalTarget[] | null) ?? [];
const mrrTarget = targets.find(t => t.metric === 'log:mrr') ?? null;
```

Alternatively, pass `targets` as a prop from `page.tsx` — but then page.tsx would need to extend the select (or do a second query), which adds complexity. **Preferred: ProjectTodayView is self-contained and fetches its own goal data including targets.**

Page.tsx props to ProjectTodayView can be minimal: `{ id, objective, targetDate }` only (all from `FocusGoalRow`).

---

## 3. CharacterHeader / gameState / goalKind for Project Goals

**File**: `/Users/ggronnii/Development/goaldmine/src/lib/game/engine.ts`

`computeGameState()` fetches `prisma.goal.findFirst({ where: { isFocus: true }, select: { id: true, kind: true } })` and returns:

```ts
return {
  goalKind: goal?.kind ?? "fitness",  // line 889
  ...
};
```

For a project goal with `isFocus: true`, `gameState.goalKind === "project"` (a non-null string). The Today page currently renders CharacterHeader when:

```tsx
{gameState.goalKind !== null && (
  <CharacterHeader state={gameState} />
)}
```

**Finding**: Because the project branch returns `<ProjectTodayView>` BEFORE the existing `Promise.all` (which contains `computeGameState()`), `gameState` is **never computed** on the project path. The CharacterHeader is therefore **not rendered** in the current early-return design — which is intentional (ProjectTodayView controls its own layout per §5.1 of PRD).

**Decision for Dev A**: If ProjectTodayView should include CharacterHeader, it must call `computeGameState()` internally. The PRD §5.1 describes "header (objective + days-to-target)" — not "CharacterHeader" — so the **default should be to omit CharacterHeader** from the project path. Confirm with user before adding it.

**Grep confirmation**: `goalKind` is set at engine.ts line 889, consumed only by `page.tsx` (CharacterHeader + QuestCard). No other consumers.

---

## 4. `calendar.ts` — `getCalendarMonth` Deep Anatomy

**File**: `/Users/ggronnii/Development/goaldmine/src/lib/calendar.ts`

### Promise.all (lines 108–134)

```ts
const [workouts, hikes, overrides, goal, goalEventsResult] = await Promise.all([
  prisma.workout.findMany({
    where: { startedAt: { gte: gridStart, lte: gridEnd } },
    select: { id: true, startedAt: true, status: true, title: true },
    orderBy: { startedAt: "asc" },
  }),
  prisma.hike.findMany({
    where: { date: { gte: gridStart, lte: gridEnd }, status: { in: ["completed", "planned"] } },
    select: { id: true, date: true, status: true },
    orderBy: { date: "asc" },
  }),
  program?.id
    ? prisma.planDayOverride.findMany({
        where: { planId: program.id, date: { gte: gridStart, lte: gridEnd } },
      })
    : Promise.resolve([] as never[]),
  prisma.goal.findFirst({
    where: { isFocus: true },
    orderBy: { updatedAt: "desc" },
    select: { id: true, targetDate: true, objective: true, legend: true },
  //        ↑ ADD kind: true HERE for REQ-003
  }),
  getGoalEventsResult({ start: gridStart, end: gridEnd }),
]);
```

**REQ-003 change**: Add `kind: true` to the `goal` select (line 129). After this change, `goal?.kind` is available in the Promise.all result.

### CalendarDayCell type (lines 21–67)

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
  skippedCount: number;
  hikeCount: number;
  plannedHikeCount: number;
  hasOverride: boolean;
  baselinesDue: number;
  conflict: { kind: ...; withDates: string[]; goalId?: string; label?: string; } | null;
  confidence: "past" | "confirmed" | "provisional" | null;
  otherGoalEvents: GoalEvent[];
  // ADD: scheduledItemCount: number;  (0 default)
};
```

**REQ-003 change**: Add `scheduledItemCount: number` field (default 0 for all current cells).

### Cells assembly (lines 206–242)

The `cells` array is built in the `for` loop (lines 213–232) by calling `buildCell(...)`. Each `buildCell` call currently returns `{ date, dateKey, ..., otherGoalEvents }` — all 17 existing fields. The `scheduledItemCount` must be added as the 18th field:

```ts
// In buildCell return object (line 396–416), add:
scheduledItemCount: scheduledByKey.get(k)?.length ?? 0,
```

`scheduledByKey` is the new Map built from the ScheduledItem query result (see §item 4 below).

**`goal` field used downstream**: The returned `goal` object from `getCalendarMonth` is used in:
- `calendar/page.tsx` line 21: `const { cells, monthStart, goal, program, otherGoals } = await getCalendarMonth(...)` → passed to `resolveLegend(goal)`.
- The cell-building loop only uses `goal?.targetDate` and `goal?.id` (via `goalKey = goal?.targetDate ? dateKey(goal.targetDate) : null`).

After adding `kind: true` to the select, `goal?.kind` is also available in the page for the PROJECT_DEFAULT_LEGEND fallback.

---

## 5. `legend.ts` — Schemas, DEFAULT_LEGEND, resolveLegend

**File**: `/Users/ggronnii/Development/goaldmine/src/lib/legend.ts`

### LegendKindSchema (line 35–42)

```ts
export const LegendKindSchema = z.enum([
  "trained",
  "hike-completed",
  "hike-planned",
  "override",
  "goal-date",
  "baseline",
]);
```

**REQ-003 change**: Add `"scheduled-item"` to the enum (7th value). Also update the `kind: LegendKindSchema.describe(...)` call to mention `scheduled-item`.

### LegendEntrySchema describe (lines 47–59)

```ts
export const LegendEntrySchema = z.object({
  icon: z.string().min(1).max(8).describe("Emoji or short glyph rendered in calendar cells and the legend list"),
  label: z.string().min(1).max(40).describe("Short human-readable label for the legend list"),
  kind: LegendKindSchema.describe(
    "Which render condition this entry drives (closed enum — see src/lib/legend.ts)",
  ),
});
```

Update the `kind` describe string to mention the new `scheduled-item` value.

### DEFAULT_LEGEND (lines 69–76)

```ts
export const DEFAULT_LEGEND: readonly LegendEntry[] = [
  { icon: "●", label: "Trained", kind: "trained" },
  { icon: "🥾", label: "Outdoor day", kind: "hike-completed" },
  { icon: "🥾", label: "Hike planned", kind: "hike-planned" },
  { icon: "⛏️", label: "Custom day", kind: "override" },
  { icon: "🏔️", label: "Goal date", kind: "goal-date" },
  { icon: "◎", label: "Baseline due", kind: "baseline" },
];
```

**DEFAULT_LEGEND is unchanged** (fitness fallback, per §3.2.1). Add a NEW:

```ts
export const PROJECT_DEFAULT_LEGEND: readonly LegendEntry[] = [
  { icon: "📌", label: "Scheduled item", kind: "scheduled-item" },
  { icon: "🏁", label: "Goal date", kind: "goal-date" },
];
```

The icon for `scheduled-item` is a placeholder — UXR research in `docs/ux-research/sprint-4-project-ui.md` may specify the final glyph. "📌" is a reasonable default; use whatever UXR specifies.

### resolveLegend (lines 83–89)

```ts
export function resolveLegend(
  goal: { legend?: unknown } | null | undefined,
): readonly LegendEntry[] {
  if (!goal || goal.legend == null) return DEFAULT_LEGEND;
  const parsed = LegendSchema.safeParse(goal.legend);
  return parsed.success ? parsed.data : DEFAULT_LEGEND;
}
```

**REQ-003 mechanism**: Extend to accept optional `kind` and use it in the null-legend branch:

```ts
export function resolveLegend(
  goal: { legend?: unknown; kind?: unknown } | null | undefined,
): readonly LegendEntry[] {
  if (!goal || goal.legend == null) {
    // §3.2.1: project goals with null legend get PROJECT_DEFAULT_LEGEND
    if ((goal as { kind?: string } | null)?.kind === 'project') {
      return PROJECT_DEFAULT_LEGEND;
    }
    return DEFAULT_LEGEND;
  }
  const parsed = LegendSchema.safeParse(goal.legend);
  return parsed.success ? parsed.data : DEFAULT_LEGEND;
}
```

**Why this works**: `FocusGoalRow` already includes `kind`. `getCalendarMonth`'s goal select will gain `kind: true`. `getActiveGoalsWithPlans` (used by goal-events.ts) already selects `kind`. All three call sites will have `kind` available — no blast-radius issue.

### resolveLegend call sites

1. `src/app/calendar/page.tsx` line 21: `resolveLegend(goal)` — goal from `getCalendarMonth`. After adding `kind: true` to the select, this will auto-fall-through to PROJECT_DEFAULT_LEGEND for project goals.
2. `src/lib/goal-events.ts` lines 114, 168 (inside loops): `resolveLegend(goal)` — goal from `getActiveGoalsWithPlans`, which already has `kind`. Project goals that already called `update_goal_legend` will use their stored legend; those with null legend get PROJECT_DEFAULT_LEGEND automatically.

**No other call sites** (grep confirms these are the only two locations).

---

## 6. `CalendarMonth.tsx` — `markersFor` + `MarkerIcon`

**File**: `/Users/ggronnii/Development/goaldmine/src/components/CalendarMonth.tsx`

### `markersFor` (lines 44–65)

```ts
function markersFor(
  cell: CalendarDayCell,
  legend: readonly LegendEntry[],
): Marker[] {
  const out: Marker[] = [];
  const isOutdoor = cell.hikeCount > 0;
  const isPlannedOutdoor = !isOutdoor && cell.plannedHikeCount > 0 && !cell.isPast;
  const isCompleted = cell.workoutCount > 0 || cell.hikeCount > 0;

  const push = (kind: LegendKind, count: number) => {
    const entry = findLegendEntry(legend, kind);
    if (entry) out.push({ entry, count });
  };

  if (isCompleted) push("trained", 1);
  if (isOutdoor) push("hike-completed", cell.hikeCount);
  if (isPlannedOutdoor) push("hike-planned", cell.plannedHikeCount);
  if (cell.hasOverride) push("override", 1);
  if (cell.baselinesDue > 0) push("baseline", cell.baselinesDue);
  if (cell.isGoalDate) push("goal-date", 1);
  return out;
}
```

**REQ-003 change**: Add one line before the `return out`:
```ts
  if (cell.scheduledItemCount > 0) push("scheduled-item", cell.scheduledItemCount);
  return out;
```

Because `push()` calls `findLegendEntry(legend, kind)` and only pushes if an entry exists, this is safe for fitness goals (DEFAULT_LEGEND has no `scheduled-item` entry → no push → zero markers rendered).

### `MarkerIcon` (from `/src/components/MarkerIcon.tsx`, lines 16–37)

```tsx
export function MarkerIcon({ entry, size = 14 }: { entry: LegendEntry; size?: number }) {
  if (entry.kind === "trained") {
    return <Bullseye filled size={Math.max(size, 14)} aria-hidden />;
  }
  return (
    <span
      aria-hidden
      title={entry.label}
      className={`leading-none ${entry.kind === "hike-planned" ? "opacity-40" : ""}`}
      style={{ fontSize: size }}
    >
      {entry.icon}
    </span>
  );
}
```

**REQ-003 change**: None needed. `scheduled-item` falls through to the `span` branch (icon-string render), which is correct. No crash. The icon from the legend entry (`"📌"` or UXR-specified) renders via `{entry.icon}`.

### MARKER_CAP and foreign-marker path

```ts
const MARKER_CAP = 3;  // line 29
```

Focus markers render first via `shownFocus = focusMarkers.slice(0, MARKER_CAP)`. Foreign markers take the remaining slots: `foreignSlots = Math.max(0, MARKER_CAP - shownFocus.length)`. The `scheduled-item` marker is a FOCUS marker (from `markersFor`, not `cell.otherGoalEvents`), so it occupies a focus slot and is subject to the MARKER_CAP with other focus markers.

### `otherGoalEvents` EXCLUDES the focus goal — no double markers

**File**: `/Users/ggronnii/Development/goaldmine/src/lib/goal-events.ts` (lines 243–249)

```ts
export function otherGoalEvents(
  events: GoalEvent[],
  focusGoalId: string | null,
): GoalEvent[] {
  if (!focusGoalId) return events;
  return events.filter((e) => e.goalId !== focusGoalId);  // ← excludes focus goal
}
```

**Event source 4** (lines 183–198) — scheduled items for ALL active goals including focus:
```ts
for (const item of scheduledItems) {
  const goal = goals.find((g) => g.id === item.goalId);
  if (!goal) continue;
  events.push({
    goalId: item.goalId,
    ...
    type: "scheduled-item",
    icon: "📅",
    label: item.title,
  });
}
```

The `scheduledItems` query at lines 84–109 uses `goalId: { in: activeGoalIds }` — covers ALL active goals. These events enter `allGoalEvents`. When `buildCell` calls `filterOtherGoalEvents(eventsByKey.get(cursorKey) ?? [], focusGoalId)`, the focus goal's scheduled-item events are **excluded** from `cell.otherGoalEvents`. They are thus NOT rendered as ForeignGoalMarkers. The new `scheduledItemCount`-based path is the exclusive render channel for focus-goal scheduled items. **No double-render**.

---

## 7. `goals/[id]/plan/page.tsx` — Branch Point

**File**: `/Users/ggronnii/Development/goaldmine/src/app/goals/[id]/plan/page.tsx` (396 lines)

### Goal fetch (lines 20–23)

```ts
const goal = await prisma.goal.findUnique({
  where: { id },
  include: { plans: { where: { active: true }, orderBy: { createdAt: "desc" }, take: 1 } },
});
```

`goal` is a full Prisma row (all Goal fields). `goal.kind` is available immediately at line 24 — no select change needed.

### Top-of-page structure (lines 24–50)

```ts
if (!goal) notFound();
const plan = goal.plans[0];
if (!plan) {
  return (
    <div className="max-w-md mx-auto p-4">
      <Card title="No active plan">
        <p className="text-sm text-[var(--muted)]">
          <Link href={`/goals/${goal.id}`} className="text-[var(--accent)]">
            Back to goal
          </Link>
        </p>
      </Card>
    </div>
  );
}
// ... fitness plan body starts at line 40 ...
```

### Minimal branch point

Insert the project branch **BEFORE** the `!plan` check, because project goals may have no fitness `Plan` row:

```ts
if (!goal) notFound();

// REQ-005: project goals → ProjectPlanView (fetches its own ScheduledItems)
if (goal.kind === 'project') {
  return <ProjectPlanView goal={goal} />;
}

// Fitness path continues unchanged:
const plan = goal.plans[0];
if (!plan) {
  return (/* existing NoActivePlan card — byte-identical */)
}
// ... existing fitness body ...
```

**Current behavior for project goals (pre-sprint)**: The `!plan` check fires (no fitness plan), returning the "No active plan" card. This is the existing behavior the PRD wants to replace.

**404/redirect**: No `notFound()` redirect for project goals with no plan — `ProjectPlanView` shows the ScheduledItem timeline (or its empty state).

---

## 8. `progress/page.tsx` — Goals Query & Burn-Down Insertion

**File**: `/Users/ggronnii/Development/goaldmine/src/app/progress/page.tsx` (180 lines)

### Goals query (lines 14–19)

```ts
const [measurements, activeGoals] = await Promise.all([
  prisma.measurement.findMany({ orderBy: { date: "asc" }, take: 180 }),
  prisma.goal.findMany({
    where: { active: true },
    orderBy: [{ isFocus: "desc" }, { targetDate: { sort: "asc", nulls: "last" } }],
  }),
]);
```

`activeGoals` returns all Goal fields (full row — no select, just findMany). `goal.kind`, `goal.targets`, `goal.isFocus` are all available. The focus goal (isFocus=true) is first due to `isFocus: "desc"` ordering.

### How the focus goal is identified

`readinessByGoal` (lines 30–44) is built from `activeGoals.map(...)`, preserving order. After the `await Promise.all` at line 30, `readinessByGoal[0]` corresponds to the focus goal (first in `activeGoals` due to ordering). To avoid order-dependence bugs: `const focusEntry = readinessByGoal.find(r => r.goal.isFocus)`.

### Burn-down card insertion point

Insert AFTER the `readinessByGoal.map(...)` card loop (after line 137), before the Weight card:

```tsx
{/* REQ-006: milestone burn-down — only for project focus goal with milestones */}
{/* focusGoal.kind === 'project' gate prevents extra queries on fitness path */}
<MilestoneBurnDown goalId={focusProjectGoal?.id} />

{/* ── Weight card (existing, unchanged) ── */}
<Card title="Weight">
```

`MilestoneBurnDown` is a server component that fetches its own data (ScheduledItems where type=milestone), gated on receiving a non-null `goalId`. The inline option: inline the query in progress/page.tsx itself, gated on `focusProjectGoal?.kind === 'project'`.

**Zero extra queries for fitness**: The gate is `const focusProjectGoal = activeGoals.find(g => g.isFocus && g.kind === 'project')` — if null, no ScheduledItem query runs.

---

## 9. `goal.targets` Parsing Idiom

**Source**: `src/app/progress/page.tsx` line 32, `src/lib/metrics-registry.ts` (GoalTarget type)

The canonical idiom:
```ts
import type { GoalTarget } from "@/lib/goal-targets";
// goal.targets is Json? in Prisma — cast to GoalTarget[] | null:
const targets = (goal.targets as unknown as GoalTarget[] | null) ?? [];
```

**Finding MRR target** (`log:mrr`):
```ts
const mrrTarget = targets.find(t => t.metric === 'log:mrr') ?? null;
// mrrTarget?.target  → numeric goal value (e.g. 1000)
// mrrTarget?.units   → "$"
```

**LogEntry metric key**: The `LogEntry.metric` column stores the **bare key WITHOUT the `log:` prefix** (schema.prisma line 234: "bare metric key WITHOUT the 'log:' registry prefix — e.g. 'mrr', not 'log:mrr'"). So to fetch the latest MRR log entry:
```ts
prisma.logEntry.findFirst({
  where: { goalId, metric: 'mrr', value: { not: null } },
  orderBy: { date: 'desc' },
  select: { value: true },
});
```

The MRR card: when `mrrTarget === null` → hide card entirely. When `entry === null` → show "— / $Y MRR". Otherwise "$X / $Y MRR".

---

## 10. Badge/Chip Idioms + Status Glyphs

### Existing chip patterns (reuse these for type badges)

**PlanChangelog.tsx** — trigger-source badge (most reusable):
```tsx
<span className={`shrink-0 text-xs rounded-full px-2 py-0.5 border ${badgeClass(source)}`}>
  {source}
</span>
```

**WorkoutEditor.tsx** — muted pill (for neutral/inactive states):
```tsx
<span className="inline-flex items-center rounded-full bg-[var(--muted)]/15 px-2.5 py-0.5 text-xs font-medium text-[var(--muted)]">
  ...
</span>
```

**CalendarMonth DayDetail** — icon+label chip:
```tsx
<li className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-xs">
  <MarkerIcon entry={m.entry} size={14} />
  <span>...</span>
</li>
```

**Type badge idiom for ProjectPlanView/ProjectTodayView**: Use the PlanChangelog pattern with type-specific color. E.g.:
```tsx
// Neutral pill for any type (milestone/task/review):
<span className="inline-flex items-center rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)]">
  {item.type}
</span>
```

### Status glyphs

- **Planned**: `○` text-[var(--muted)]
- **Done**: `●` text-[var(--success)]  
- **Skipped**: apply `line-through` class to the row title

**No existing `line-through` in components/** — this will be net-new Tailwind usage. Use `className="line-through text-[var(--muted)]"` on the title `<span>`.

### Today page `isFocus` chip idiom

Current usage in `today.tsx` header: `bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]` (rounded-full chip for "Today" badge in CalendarMonth DayDetail). Reuse for the "Today" tag in ProjectTodayView.

---

## 11. Days-Remaining Idiom

**Source**: `src/lib/mcp/tools.ts` lines 1231, 1311–1316 (get_session_brief / get_today_plan)

```ts
const MS_PER_DAY = 1000 * 60 * 60 * 24;
const now = new Date();

const daysToGo = activeGoal.targetDate
  ? Math.round(
      (startOfDay(activeGoal.targetDate).getTime() - startOfDay(now).getTime()) /
        MS_PER_DAY,
    )
  : null;
```

**Pattern for ProjectTodayView / ProjectPlanView**:
```ts
import { startOfDay } from "@/lib/calendar";
const MS_PER_DAY = 1_000 * 60 * 60 * 24;
const now = new Date();
const daysRemaining = goal.targetDate
  ? Math.round(
      (startOfDay(goal.targetDate).getTime() - startOfDay(now).getTime()) / MS_PER_DAY
    )
  : null;
```

`startOfDay` from `@/lib/calendar` is USER_TZ-aware (handles `America/Denver`; Vercel runs UTC). Raw `new Date(goal.targetDate).getTime() - new Date().getTime()` is WRONG — the "today" boundary would roll at UTC midnight (wrong for MT). Always use `startOfDay()` on both sides.

For display: `daysRemaining !== null ? `${daysRemaining} days` : null`. Negative values → goal date passed.

For next milestone days-remaining in ProjectTodayView: same idiom, substituting `item.date` for `goal.targetDate`:
```ts
const itemDaysRemaining = Math.round(
  (startOfDay(item.date).getTime() - startOfDay(now).getTime()) / MS_PER_DAY
);
```

---

## Conventions Checklist for Dev A, Dev B, Dev C

### Byte-identical fitness diff discipline
- Dev A: The fitness JSX (lines 129–255 of `page.tsx`) must not be touched — no reformatting, no variable renames, no comment changes. The only mutations above line 129 are: (1) the `getActiveProgram()` → dual `Promise.all`, (2) the NoActiveProgram guard condition tweak, (3) the new project early-return block. Everything from `const ctx = getTodayContext(program!)` downward is unchanged.
- Dev B: `CalendarDayCell` gains one field (`scheduledItemCount: number`). Existing `buildCell` return object (lines 396–416) gets one new entry; the existing 17 fields stay in the same order, same names, same types.
- Dev C: Plan page's fitness body (lines 40–172) is unchanged. Progress page's readiness loop, weight card, records summary are unchanged.

### Server component default
- `ProjectTodayView.tsx`, `ProjectPlanView.tsx`, optional `MilestoneBurnDown.tsx` — all server components. No `"use client"` unless a controlled input is needed (there are none in this sprint — mutations are out of scope).

### Token usage
- All CSS uses `var(--token)` names only: `--accent`, `--border`, `--card`, `--muted`, `--success`, `--warning`, `--foreground`, `--background`, `--accent-soft`, `--target`. No hardcoded hex or rgb values.
- Tap targets: `min-h-[2.75rem]` or `min-h-[44px]` on all tappable rows (ScheduledItem list rows). The day-page link in ProjectTodayView uses `Link` component with block display.

### 390px primary
- `max-w-md mx-auto` on root div (matches existing pages). Long titles: add `truncate` or `break-words` per PRD §6.

### Calendar helpers only
- All date math in new components: use `startOfDay`, `endOfDay`, `dateKey`, `addDays`, `parseDateKey` from `@/lib/calendar`. Never `new Date().setHours(0,0,0,0)`, never `getDate()`, never `getMonth()`. The USER_TZ constant is `process.env.USER_TZ ?? "America/Denver"` (defined in calendar.ts:1150) — do not re-define it.

### ScheduledItem query in getCalendarMonth
- Slot into the existing `Promise.all` as a 6th item (after `goalEventsResult`). Gate it:
  ```ts
  goal?.kind === 'project'
    ? prisma.scheduledItem.findMany({
        where: {
          goalId: goal.id,
          date: { gte: gridStart, lte: gridEnd },
          status: { in: ['planned', 'done'] },
        },
        select: { id: true, goalId: true, date: true },
        orderBy: { date: 'asc' },
      })
    : Promise.resolve([] as { id: string; goalId: string; date: Date }[]),
  ```
  This uses `Promise.resolve([])` for fitness/null — zero queries, consistent with PRD §3.1.4.

---

## Summary (10 lines)

Sprint 4 has five distinct touch-points. page.tsx needs the `getActiveProgram()` line replaced with a two-item parallel fetch; the project branch inserts before `getTodayContext` with program guaranteed non-null afterward. `getFocusGoal` already selects `kind` — no extension needed; ProjectTodayView fetches `targets` itself. `gameState.goalKind` returns `"project"` for project focus, but the CharacterHeader is skipped on the project path (early return before the Promise.all). `getCalendarMonth` needs `kind: true` added to the goal select plus a new 6th Promise.all slot for ScheduledItems gated on `goal?.kind === 'project'`. `CalendarDayCell` gains `scheduledItemCount: number`; `markersFor` gains one push call; `LegendKindSchema` gains `"scheduled-item"`; `resolveLegend` gains a kind check for `PROJECT_DEFAULT_LEGEND`. The plan page branches BEFORE the `!plan` check (project goals have no fitness plan). The progress page identifies the focus project goal by `isFocus && kind === 'project'` from the existing `activeGoals` query result. The days-remaining idiom is `Math.round((startOfDay(target).getTime() - startOfDay(now).getTime()) / MS_PER_DAY)`.

## ACs That Need Architect Attention

**AC potentially under-specified**: REQ-003 / §3.2.1 says "architect finalizes mechanism" for PROJECT_DEFAULT_LEGEND. The research confirms the `resolveLegend(goal: { legend?, kind? })` extension is the cleanest path — no call-site changes beyond adding `kind: true` to the calendar's goal select. This is ready to implement as designed.

**`buildCell` signature update**: `buildCell` (line 270) takes an `args` object. Adding `scheduledsByKey: Map<string, number>` to the args and `scheduledItemCount: scheduledsByKey.get(k) ?? 0` to the return is straightforward but the dev must also update the `buildCell` call site (line 215–231) to pass the new map. This is a 4-line change total.

**CharacterHeader on project path**: The PRD is silent on whether ProjectTodayView should include CharacterHeader. Since it requires `computeGameState()` (a 9-query Promise.all), omitting it from the initial ProjectTodayView is strongly recommended to keep the project page fast. Include it only if the user explicitly requests it.
