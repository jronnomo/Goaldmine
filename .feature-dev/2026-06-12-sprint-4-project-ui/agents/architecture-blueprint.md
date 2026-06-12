# Architecture Blueprint — Sprint 4: Goal-Type-Aware Project UI

**Date**: 2026-06-12  
**Architect**: Sonnet (Claude Code)  
**Status**: FINAL — Devs start from this document  
**Inputs verified**: PRD §5, requirements.md, research-output.md, UXR §3/7/8/9, 12 source files spot-checked

---

## 1. File Plan

| Action | Path | Dev | Purpose |
|--------|------|-----|---------|
| MODIFY | `src/app/page.tsx` | A | Parallel focus-goal fetch + project early-return; fitness JSX byte-identical |
| NEW | `src/components/ProjectTodayView.tsx` | A | Server component — QuestCard Hero layout, own Promise.all, 4 queries |
| MODIFY | `src/components/TodayCelebration.tsx` | A | Add optional `storageKey?: string` prop for project-scoped localStorage key |
| MODIFY | `src/lib/legend.ts` | B | +`scheduled-item` enum + PROJECT_DEFAULT_LEGEND + resolveLegend kind check |
| MODIFY | `src/components/MarkerIcon.tsx` | B | +`scheduled-item` branch → ◆ in `var(--accent)` |
| MODIFY | `src/components/CalendarMonth.tsx` | B | `markersFor` gains one push call for `scheduled-item` |
| MODIFY | `src/lib/calendar.ts` | B | `CalendarDayCell` +`scheduledItemCount`; `getCalendarMonth` restructured to prefetch goal then run 5-item Promise.all; `buildCell` args/return updated |
| MODIFY | `src/lib/goal-events.ts` | B | Line 195: icon `"📅"` → `"◆"` (UXR-s4-05) |
| MODIFY | `src/app/goals/[id]/plan/page.tsx` | C | Insert project branch BEFORE `!plan` check |
| NEW | `src/components/ProjectPlanView.tsx` | C | Server component — month-grouped CollapsibleCard timeline |
| MODIFY | `src/app/progress/page.tsx` | C | Derive `focusProjectGoal`; insert `<MilestoneBurnDown>` card slot |
| NEW | `src/components/MilestoneBurnDown.tsx` | C | Server component — milestone burn-down card |

**Read-only (consumed, not modified):** `CollapsibleCard.tsx`, `Bullseye.tsx`, `goal-focus.ts`, `Card.tsx`, `QuestCard.tsx`, `calendar/page.tsx`

---

## 2. Exact Insertion Points (quoted code)

### 2.1 `src/app/page.tsx` — fetch block + guard + early return (Dev A)

**REPLACE** lines 18–30 (the single `await getActiveProgram()` + entire `if (!program)` guard):

```tsx
// BEFORE (lines 18–30):
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

// AFTER (replace the 13 lines above with):
// REQ-001: fetch program and focus goal in parallel — no waterfall.
const [program, focusGoal] = await Promise.all([
  getActiveProgram(),
  getFocusGoal(),
]);

// AC-C: null goal + null program (or fitness focus + no program) → existing NoActiveProgram card.
if (!program && focusGoal?.kind !== "project") {
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

// AC-A: project focus goal wins over any lingering fitness Program rows.
// CharacterHeader/gameState are skipped on this path (no computeGameState call below).
if (focusGoal?.kind === "project") {
  return <ProjectTodayView goal={focusGoal} />;
}
```

**REPLACE** line 32 only (the `getTodayContext` call):

```tsx
// BEFORE:
const ctx = getTodayContext(program);

// AFTER (add ! — program is guaranteed non-null: the AC-C guard above
// would have returned if program were null and no project goal exists):
const ctx = getTodayContext(program!);
```

**ADD** imports at the top of the file (alongside existing imports):
```tsx
import { getFocusGoal } from "@/lib/goal-focus";
import { ProjectTodayView } from "@/components/ProjectTodayView";
```

**Lines 32–255 (the fitness body) MUST NOT be touched by Dev A.**

---

### 2.2 `src/lib/calendar.ts` — Promise.all restructure + CalendarDayCell + buildCell (Dev B)

**REPLACE** the single Promise.all block at lines 108–134 with a two-phase fetch:

```ts
// BEFORE (lines 108–134):
const [workouts, hikes, overrides, goal, goalEventsResult] = await Promise.all([
  prisma.workout.findMany({
    where: { startedAt: { gte: gridStart, lte: gridEnd } },
    select: { id: true, startedAt: true, status: true, title: true },
    orderBy: { startedAt: "asc" },
  }),
  prisma.hike.findMany({ ... }),
  program?.id ? prisma.planDayOverride.findMany({ ... }) : Promise.resolve([]),
  prisma.goal.findFirst({
    where: { isFocus: true },
    orderBy: { updatedAt: "desc" },
    select: { id: true, targetDate: true, objective: true, legend: true },
  }),
  getGoalEventsResult({ start: gridStart, end: gridEnd }),
]);

// AFTER (two-phase: goal first, then 5-item parallel including gated ScheduledItem):
// Phase 1: fetch focus goal so we can gate the ScheduledItem query in Phase 2.
const goal = await prisma.goal.findFirst({
  where: { isFocus: true },
  orderBy: { updatedAt: "desc" },
  // REQ-003: added kind for PROJECT_DEFAULT_LEGEND fallback + ScheduledItem gate.
  select: { id: true, targetDate: true, objective: true, legend: true, kind: true },
});

// Phase 2: remaining queries in parallel; ScheduledItem query gated on project kind.
const [workouts, hikes, overrides, goalEventsResult, scheduledItemsForCal] = await Promise.all([
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
  // REQ-104: cross-goal events for the full grid (3 queries — unchanged).
  getGoalEventsResult({ start: gridStart, end: gridEnd }),
  // REQ-004: ScheduledItem markers — project path only; zero queries for fitness/null.
  goal?.kind === "project"
    ? prisma.scheduledItem.findMany({
        where: {
          goalId: goal.id,
          date: { gte: gridStart, lte: gridEnd },
          status: { in: ["planned", "done"] },
        },
        select: { id: true, date: true },
        orderBy: { date: "asc" },
      })
    : Promise.resolve([] as { id: string; date: Date }[]),
]);
```

**BUILD the scheduledsByKey map** (insert after the `overridesByKey` map, before the `plannedHikesByWeek` block):

```ts
// REQ-004: bucket ScheduledItem counts by dateKey for O(1) cell lookup.
const scheduledsByKey = new Map<string, number>();
for (const si of scheduledItemsForCal) {
  const k = dateKey(si.date);
  scheduledsByKey.set(k, (scheduledsByKey.get(k) ?? 0) + 1);
}
```

**ADD to `CalendarDayCell` type** (after `otherGoalEvents` field, line ~66):

```ts
/** Count of scheduled items on this date for the focus project goal.
 *  Always 0 for fitness / null focus goals — ScheduledItem query is gated. */
scheduledItemCount: number;
```

**UPDATE `buildCell` args type** (line 270 — add one field after `crossGoalConflictForDate`):

```ts
/** REQ-004: pre-bucketed ScheduledItem count map (dateKey → count). */
scheduledsByKey: Map<string, number>;
```

**UPDATE `buildCell` call site** (inside the `for` loop at line ~215, add `scheduledsByKey` to the args object):

```ts
const cell = buildCell({
  date: cursor,
  todayKey,
  goalKey,
  program,
  workoutsByKey,
  hikesByKey,
  plannedHikesByKey,
  overridesByKey,
  plannedHikesByWeek,
  otherGoalEventsForDate: filterOtherGoalEvents(
    eventsByKey.get(cursorKey) ?? [],
    focusGoalId,
  ),
  crossGoalConflictForDate: crossGoalConflictsByKey.get(cursorKey) ?? null,
  scheduledsByKey, // REQ-004: new
});
```

**UPDATE `buildCell` return object** (lines 396–416, add one field after `otherGoalEvents`):

```ts
return {
  date: new Date(args.date),
  dateKey: k,
  isPast,
  isToday,
  isFuture,
  isInPlan,
  isGoalDate,
  rotationDay,
  weekIndex,
  dayTitle,
  workoutCount,
  skippedCount,
  hikeCount,
  plannedHikeCount,
  hasOverride,
  baselinesDue,
  conflict: resolvedConflict,
  confidence,
  otherGoalEvents: args.otherGoalEventsForDate,
  scheduledItemCount: args.scheduledsByKey.get(k) ?? 0, // REQ-004: new — always 0 for fitness
};
```

---

### 2.3 `src/lib/legend.ts` — schema + constants + resolveLegend (Dev B)

**REPLACE** the `LegendKindSchema` (lines 35–42):

```ts
// BEFORE:
export const LegendKindSchema = z.enum([
  "trained",
  "hike-completed",
  "hike-planned",
  "override",
  "goal-date",
  "baseline",
]);

// AFTER (add "scheduled-item" as 7th value):
export const LegendKindSchema = z.enum([
  "trained",
  "hike-completed",
  "hike-planned",
  "override",
  "goal-date",
  "baseline",
  "scheduled-item", // REQ-003: project goal scheduled items on the calendar
]);
```

**UPDATE** the `kind` `.describe()` string inside `LegendEntrySchema` (line ~57):

```ts
kind: LegendKindSchema.describe(
  "Which render condition this entry drives (closed enum — see src/lib/legend.ts). " +
  "Values: trained, hike-completed, hike-planned, override, goal-date, baseline, scheduled-item.",
),
```

**ADD** `PROJECT_DEFAULT_LEGEND` after `DEFAULT_LEGEND` (after line 76):

```ts
// REQ-003 / PRD §3.2.1: fallback legend for project goals with null legend column.
// Avoids requiring a manual update_goal_legend call before calendar markers appear.
// Uses ◆ (U+25C6) per UXR-s4-04; goal-date icon 🎯 per UXR-s4-06.
export const PROJECT_DEFAULT_LEGEND: readonly LegendEntry[] = [
  { icon: "◆", label: "Scheduled item", kind: "scheduled-item" },
  { icon: "🎯", label: "Goal date", kind: "goal-date" },
];
```

**REPLACE** `resolveLegend` (lines 83–89):

```ts
// BEFORE:
export function resolveLegend(
  goal: { legend?: unknown } | null | undefined,
): readonly LegendEntry[] {
  if (!goal || goal.legend == null) return DEFAULT_LEGEND;
  const parsed = LegendSchema.safeParse(goal.legend);
  return parsed.success ? parsed.data : DEFAULT_LEGEND;
}

// AFTER (extend signature to accept optional kind):
export function resolveLegend(
  goal: { legend?: unknown; kind?: unknown } | null | undefined,
): readonly LegendEntry[] {
  if (!goal || goal.legend == null) {
    // PRD §3.2.1: project goals with null legend fall back to PROJECT_DEFAULT_LEGEND.
    if ((goal as { kind?: string } | null | undefined)?.kind === "project") {
      return PROJECT_DEFAULT_LEGEND;
    }
    return DEFAULT_LEGEND;
  }
  const parsed = LegendSchema.safeParse(goal.legend);
  return parsed.success ? parsed.data : DEFAULT_LEGEND;
}
```

---

### 2.4 `src/components/CalendarMonth.tsx` — `markersFor` (Dev B)

**REPLACE** lines 63–64 inside `markersFor` (currently the last two lines before `return out`):

```ts
// BEFORE (lines 63–64):
  if (cell.baselinesDue > 0) push("baseline", cell.baselinesDue);
  if (cell.isGoalDate) push("goal-date", 1);
  return out;

// AFTER (insert scheduled-item push between baseline and goal-date — UXR-s4-07):
  if (cell.baselinesDue > 0) push("baseline", cell.baselinesDue);
  // REQ-003: push scheduled-item AFTER baseline, BEFORE goal-date. Safe for fitness
  // goals: DEFAULT_LEGEND has no scheduled-item entry, so push() finds nothing and
  // returns without adding a marker.
  if (cell.scheduledItemCount > 0) push("scheduled-item", cell.scheduledItemCount);
  if (cell.isGoalDate) push("goal-date", 1);
  return out;
```

---

### 2.5 `src/components/MarkerIcon.tsx` — `scheduled-item` branch (Dev B)

**INSERT** a new branch in `MarkerIcon` (before the final `return <span ...>` catch-all):

```tsx
// BEFORE (lines 23–36, abbreviated):
export function MarkerIcon({ entry, size = 14 }) {
  if (entry.kind === "trained") {
    return <Bullseye filled size={Math.max(size, 14)} aria-hidden />;
  }
  return (
    <span aria-hidden title={entry.label} className={`leading-none ${...}`} style={{ fontSize: size }}>
      {entry.icon}
    </span>
  );
}

// AFTER (insert between the trained branch and the catch-all span):
  if (entry.kind === "trained") {
    return <Bullseye filled size={Math.max(size, 14)} aria-hidden />;
  }
  // REQ-003 / UXR-s4-04: ScheduledItem marker = ◆ in var(--accent) gold.
  // Icon is hardcoded here (not from entry.icon) so it renders in accent color
  // even if a stored legend uses a different icon string.
  if (entry.kind === "scheduled-item") {
    return (
      <span
        aria-hidden
        title={entry.label}
        data-testid="cal-marker-scheduled-item"
        className="leading-none"
        style={{ fontSize: size, color: "var(--accent)" }}
      >
        ◆
      </span>
    );
  }
  return (
    <span aria-hidden title={entry.label} className={`leading-none ${entry.kind === "hike-planned" ? "opacity-40" : ""}`} style={{ fontSize: size }}>
      {entry.icon}
    </span>
  );
```

---

### 2.6 `src/lib/goal-events.ts` — foreign icon change (Dev B)

**REPLACE** line 195 only:

```ts
// BEFORE:
      icon: "📅",

// AFTER (UXR-s4-05: glyph consistency — matches focus-goal ◆ marker):
      icon: "◆",
```

---

### 2.7 `src/app/goals/[id]/plan/page.tsx` — project branch (Dev C)

**INSERT** after `if (!goal) notFound();` at line 24, BEFORE `const plan = goal.plans[0];`:

```ts
// REQ-005: project goals → ProjectPlanView (no fitness Plan needed).
// This branch must come BEFORE the !plan check because project goals have
// no fitness Plan row; the !plan early-return would otherwise fire.
if (goal.kind === "project") {
  return <ProjectPlanView goal={goal} />;
}
```

**ADD** import at the top of the file:
```tsx
import { ProjectPlanView } from "@/components/ProjectPlanView";
```

**Lines 25–396 (the fitness plan body) MUST NOT be touched by Dev C.**

---

### 2.8 `src/app/progress/page.tsx` — burn-down insertion (Dev C)

**ADD** at the top of the component (after the `readinessByGoal` `await Promise.all`, before the `weightAriaLabel` computation):

```ts
// REQ-006: identify the focus project goal for burn-down gating.
// Derived from activeGoals (no extra query); null when fitness is focus.
const focusProjectGoal = activeGoals.find((g) => g.isFocus && g.kind === "project") ?? null;
```

**INSERT** burn-down card between the readinessByGoal map and the Weight card (after the `})}` closing the map loop, before `{/* Weight card */}`):

```tsx
{/* REQ-006: milestone burn-down — only when a project goal is in focus.
    MilestoneBurnDown fetches its own data and self-gates when milestoneCount=0. */}
{focusProjectGoal && (
  <MilestoneBurnDown goalId={focusProjectGoal.id} />
)}
```

**ADD** import:
```tsx
import { MilestoneBurnDown } from "@/components/MilestoneBurnDown";
```

**All lines below the burn-down insertion (Weight card through RecordsSummary) MUST NOT be touched.**

---

## 3. Component Specifications

### 3.1 `TodayCelebration.tsx` — `storageKey` prop (Dev A)

Minor modification to enable project-scoped localStorage key. Change is backward-compatible (fitness path does not pass `storageKey`).

```tsx
export function TodayCelebration({
  completed,
  dateKey,
  storageKey,  // NEW: if provided, overrides the default "goaldmine.celebrated.<dateKey>" key
}: {
  completed: boolean;
  dateKey: string;
  storageKey?: string;  // NEW optional prop
}) {
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!completed) return;
    // REQ-002: project path passes a goal-scoped key; fitness path uses the default.
    const key = storageKey ?? "goaldmine.celebrated." + dateKey;
    try {
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, "1");
        wrapRef.current?.classList.add("bullseye-pop");
      }
    } catch {
      // localStorage blocked — degrade silently.
    }
  }, [completed, dateKey, storageKey]);

  // JSX unchanged
  return (
    <span ref={wrapRef} style={{ display: "inline-block" }}>
      <Bullseye
        filled={completed}
        size={28}
        aria-label={completed ? "Completed" : "In progress"}
      />
    </span>
  );
}
```

---

### 3.2 `ProjectTodayView.tsx` — Full Spec (Dev A)

```tsx
// src/components/ProjectTodayView.tsx
// Server component — no "use client".
// REQ-002: QuestCard Hero layout for project focus goals.
// One Promise.all: today's items, latest MRR entry, next milestone, goal targets.
// Does NOT call computeGameState() — CharacterHeader is omitted on the project path.

import Link from "next/link";
import { Card } from "@/components/Card";
import { Bullseye } from "@/components/Bullseye";
import { TodayCelebration } from "@/components/TodayCelebration";
import { prisma } from "@/lib/db";
import { startOfDay, endOfDay, dateKey, addDays } from "@/lib/calendar";
import type { GoalTarget } from "@/lib/metrics-registry";
import type { FocusGoalRow } from "@/lib/goal-focus";

// UXR-s4-13: urgency threshold constant (≤14d → warning, <0 → danger).
const MILESTONE_WARNING_DAYS = 14;
const MS_PER_DAY = 1_000 * 60 * 60 * 24;

type ProjectTodayViewProps = {
  goal: Pick<FocusGoalRow, "id" | "objective" | "targetDate">;
};

export async function ProjectTodayView({ goal }: ProjectTodayViewProps) {
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const todayDateKey = dateKey(now);

  // All data in a single round-trip. UXR-s4-20: "upcoming-7d items" query DROPPED
  // (Decision CD-1: nothing in the chosen direction renders a 7-day list).
  const [items, mrrEntry, nextMilestone, goalRow] = await Promise.all([
    // Today's scheduled items (planned + done) — sorted by date then title for stable order.
    prisma.scheduledItem.findMany({
      where: {
        goalId: goal.id,
        date: { gte: todayStart, lte: todayEnd },
        status: { in: ["planned", "done"] },
      },
      orderBy: [{ date: "asc" }, { title: "asc" }],
      select: { id: true, type: true, title: true, status: true },
    }),
    // Latest MRR log entry. Metric key in DB is "mrr" (bare, without "log:" prefix).
    prisma.logEntry.findFirst({
      where: { goalId: goal.id, metric: "mrr", value: { not: null } },
      orderBy: { date: "desc" },
      select: { value: true },
    }),
    // Next planned milestone strictly after today.
    prisma.scheduledItem.findFirst({
      where: {
        goalId: goal.id,
        type: "milestone",
        status: "planned",
        date: { gte: addDays(todayStart, 1) }, // strictly tomorrow and beyond
      },
      orderBy: { date: "asc" },
      select: { id: true, title: true, date: true },
    }),
    // Goal targets — needed for MRR target. ProjectTodayView fetches this itself
    // (getFocusGoal select was NOT extended; Decision CD-5).
    prisma.goal.findUnique({
      where: { id: goal.id },
      select: { targets: true },
    }),
  ]);

  // --- Derived values ---

  // MRR card
  const targets = (goalRow?.targets as unknown as GoalTarget[] | null) ?? [];
  const mrrTarget = targets.find((t) => t.metric === "log:mrr") ?? null;
  const mrrValue = mrrEntry?.value ?? null;

  // Bullseye progress
  const total = items.length;
  const doneToday = items.filter((i) => i.status === "done").length;
  const allDone = total > 0 && doneToday === total;
  const progress = total === 0 ? 0 : doneToday / total;

  // Days remaining to goal target
  const daysToGoal =
    goal.targetDate != null
      ? Math.round(
          (startOfDay(goal.targetDate).getTime() - startOfDay(now).getTime()) / MS_PER_DAY,
        )
      : null;

  // Days remaining to next milestone
  const milestoneRemainingDays =
    nextMilestone != null
      ? Math.round(
          (startOfDay(nextMilestone.date).getTime() - startOfDay(now).getTime()) / MS_PER_DAY,
        )
      : null;

  const milestoneDueLabel = nextMilestone?.date
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(
        new Date(nextMilestone.date),
      )
    : null;

  // Once-per-day pop: project-scoped localStorage key (Decision CD-6).
  const celebStorageKey = `goaldmine.project-celebrated.${goal.id}.${todayDateKey}`;

  const isEmpty = total === 0;

  return (
    <div
      className="max-w-md mx-auto p-4 space-y-4"
      data-testid="project-today-view"
    >
      {/* ── Hero: QuestCard ribbon (UXR-s4-01) ── */}
      <section
        className="rounded-2xl border border-[var(--border)] bg-[var(--accent-soft)] p-4 space-y-3 border-l-2"
        style={{ borderLeftColor: "var(--accent)" }}
        aria-label={`Today's work — ${goal.objective}`}
      >
        {/* Eyeline */}
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-[var(--foreground)] truncate">{goal.objective}</p>
          {daysToGoal !== null && (
            <span className="shrink-0 text-xs rounded-full bg-[var(--accent-soft)] border border-[var(--accent)]/30 px-2 py-0.5 text-[var(--accent)] font-medium">
              {daysToGoal > 0 ? `${daysToGoal}d to launch` : daysToGoal === 0 ? "Launch day!" : "Overdue"}
            </span>
          )}
        </div>

        {/* Bullseye + tally */}
        <div className="flex items-center gap-3">
          {/* TodayCelebration hosts the bullseye-pop (UXR-s4-14; project-scoped key). */}
          <TodayCelebration
            completed={allDone}
            dateKey={todayDateKey}
            storageKey={celebStorageKey}
          />
          <div>
            <p className="text-sm font-semibold">
              {isEmpty
                ? "Today's work"
                : `${doneToday} of ${total} done today`}
            </p>
            {!isEmpty && (
              <p className="text-xs text-[var(--muted)]">
                {doneToday} done · {total - doneToday} remaining
              </p>
            )}
          </div>
        </div>

        {/* Checklist or empty state (UXR-s4-02) */}
        {isEmpty ? (
          <p
            className="text-sm text-[var(--muted)]"
            data-testid="project-today-empty"
          >
            Nothing scheduled today — open Claude to plan tomorrow or log MRR.
          </p>
        ) : (
          <ul
            className="space-y-1"
            data-testid="project-today-checklist"
          >
            {items.map((item) => {
              const isDone = item.status === "done";
              return (
                <li key={item.id} data-testid={`project-today-item-${item.id}`}>
                  <Link
                    href={`/days/${todayDateKey}`}
                    className="flex items-center gap-2 min-h-[44px] rounded-lg px-2 hover:bg-[var(--card)]/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  >
                    <span
                      aria-label={isDone ? "Done" : "Planned"}
                      title={isDone ? "Done" : "Planned"}
                      className={`shrink-0 text-sm ${isDone ? "text-[var(--success)]" : "text-[var(--muted)]"}`}
                    >
                      {isDone ? "●" : "○"}
                    </span>
                    <span
                      className={`flex-1 text-sm ${isDone ? "text-[var(--muted)]" : ""}`}
                    >
                      {item.title}
                    </span>
                    <TypeBadge type={item.type} />
                    <span className="text-xs text-[var(--accent)] shrink-0" aria-hidden>
                      →
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── MRR Progress card (UXR-s4-03; hidden when no log:mrr target) ── */}
      {mrrTarget != null && (
        <Card data-testid="mrr-progress-card">
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-4xl font-semibold tracking-tight">
              {mrrValue != null ? formatCurrency(mrrValue) : "—"}
              <span className="text-base font-normal text-[var(--muted)]">
                {" "}/ {formatCurrency(mrrTarget.target)} MRR
              </span>
            </p>
          </div>
          {/* Thin accent scope bar — no animation per UXR-s4-17 */}
          <div
            className="h-1.5 rounded-full overflow-hidden"
            style={{ background: "var(--border)" }}
            role="progressbar"
            aria-valuenow={mrrValue ?? 0}
            aria-valuemax={mrrTarget.target}
            aria-label={`MRR ${mrrValue != null ? formatCurrency(mrrValue) : "—"} of ${formatCurrency(mrrTarget.target)}`}
          >
            <div
              className="h-full rounded-full"
              style={{
                background: "var(--accent)",
                width: `${Math.min(100, mrrValue != null ? (mrrValue / mrrTarget.target) * 100 : 0).toFixed(1)}%`,
                // No CSS transition — static bar per UXR-s4-17.
              }}
            />
          </div>
          <p className="mt-1 text-xs text-[var(--muted)]">Monthly recurring revenue</p>
        </Card>
      )}

      {/* ── Next milestone card (UXR-s4-13; hidden when none) ── */}
      {nextMilestone != null && (
        <Card data-testid="next-milestone-card">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide mb-1">
                Next milestone
              </p>
              <p className="text-sm font-medium truncate">{nextMilestone.title}</p>
              {milestoneDueLabel && (
                <p className="text-xs text-[var(--muted)] mt-0.5">{milestoneDueLabel}</p>
              )}
            </div>
            {milestoneRemainingDays !== null && (
              <UrgencyChip days={milestoneRemainingDays} />
            )}
          </div>
        </Card>
      )}

      {/* ── If empty, promote MRR card has already appeared above as slot 2 (UXR-s4-02). ── */}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: string }) {
  const cls = typeBadgeClass(type);
  return (
    <span className={`shrink-0 text-xs rounded-full px-2 py-0.5 border ${cls}`}>
      {type}
    </span>
  );
}

function typeBadgeClass(type: string): string {
  // UXR-s4-10: task/review neutral; milestone accent; launch-step warning.
  switch (type) {
    case "milestone":
      return "border-[var(--accent)]/40 bg-[var(--accent-soft)] text-[var(--accent)]";
    case "launch-step":
      return "border-[var(--warning)]/40 bg-[var(--warning)]/10 text-[var(--warning)]";
    default: // task, review, and unknown types
      return "border-[var(--border)] text-[var(--muted)]";
  }
}

function UrgencyChip({ days }: { days: number }) {
  // UXR-s4-13: ≤14d → warning; overdue (< 0) → danger; >14d → no chip.
  if (days > MILESTONE_WARNING_DAYS) return null;
  const isDanger = days < 0;
  const color = isDanger ? "var(--danger)" : "var(--warning)";
  const label = isDanger
    ? `Overdue ${Math.abs(days)}d`
    : `${days}d`;
  return (
    <span
      className="shrink-0 text-xs rounded-full px-2 py-0.5 border font-medium"
      style={{
        borderColor: `${color}/40`,
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
        color,
      }}
    >
      {isDanger ? "!" : "!"} {label}
    </span>
  );
}

function formatCurrency(value: number): string {
  return `$${value.toLocaleString("en-US")}`;
}
```

**Note on UrgencyChip CSS**: The `color-mix()` + inline style with CSS variable strings won't work as CSS variable expressions inside `style={}`. Use Tailwind `bg-[var(--warning)]/10` via className instead:

```tsx
function UrgencyChip({ days }: { days: number }) {
  if (days > MILESTONE_WARNING_DAYS) return null;
  const isDanger = days < 0;
  const label = isDanger ? `! Overdue ${Math.abs(days)}d` : `! ${days}d`;
  if (isDanger) {
    return (
      <span className="shrink-0 text-xs rounded-full px-2 py-0.5 border border-[var(--danger)]/40 bg-[var(--danger)]/10 text-[var(--danger)] font-medium">
        {label}
      </span>
    );
  }
  return (
    <span className="shrink-0 text-xs rounded-full px-2 py-0.5 border border-[var(--warning)]/40 bg-[var(--warning)]/10 text-[var(--warning)] font-medium">
      {label}
    </span>
  );
}
```

---

### 3.3 `ProjectPlanView.tsx` — Full Spec (Dev C)

```tsx
// src/components/ProjectPlanView.tsx
// Server component — no "use client".
// REQ-005: month-grouped CollapsibleCard timeline for project goals.

import Link from "next/link";
import { Card } from "@/components/Card";
import { CollapsibleCard } from "@/components/CollapsibleCard";
import { prisma } from "@/lib/db";
import { dateKey, startOfDay } from "@/lib/calendar";

const MS_PER_DAY = 1_000 * 60 * 60 * 24;
const USER_TZ = process.env.USER_TZ ?? "America/Denver";

type GoalArg = {
  id: string;
  objective: string;
  targetDate: Date | null;
  kind: string;
};

export async function ProjectPlanView({ goal }: { goal: GoalArg }) {
  const items = await prisma.scheduledItem.findMany({
    where: { goalId: goal.id },
    orderBy: [{ date: "asc" }, { title: "asc" }],
    select: { id: true, type: true, title: true, status: true, date: true },
  });

  // Top-level milestone summary
  const allMilestones = items.filter((i) => i.type === "milestone");
  const doneMilestones = allMilestones.filter((i) => i.status === "done").length;
  const totalMilestones = allMilestones.length;

  // Group items by yyyy-mm using USER_TZ-aware dateKey
  const todayMonth = dateKey(new Date()).slice(0, 7);
  const groups = new Map<string, typeof items>();
  for (const item of items) {
    const k = dateKey(item.date).slice(0, 7); // "yyyy-mm"
    const arr = groups.get(k) ?? [];
    arr.push(item);
    groups.set(k, arr);
  }

  const monthLabel = (groupKey: string): string => {
    const [y, m] = groupKey.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: USER_TZ,
    });
  };

  const isEmpty = items.length === 0;

  return (
    <div className="max-w-md mx-auto p-4 space-y-4" data-testid="project-plan-view">
      <header className="pt-2">
        <Link href={`/goals/${goal.id}`} className="text-sm text-[var(--accent)]">
          ← {goal.objective}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">Plan</h1>

        {/* Top-level milestone completion (UXR-s4-08) */}
        {totalMilestones > 0 && (
          <p className="text-sm text-[var(--muted)] mt-1">
            <span className="font-semibold text-[var(--foreground)]">
              {doneMilestones} / {totalMilestones}
            </span>{" "}
            milestones complete
          </p>
        )}
      </header>

      {isEmpty ? (
        <Card>
          <p className="text-sm text-[var(--muted)]">
            No scheduled items yet — ask Claude to build out the schedule for this goal.
          </p>
        </Card>
      ) : (
        [...groups.entries()].map(([groupKey, groupItems]) => {
          const doneInGroup = groupItems.filter((i) => i.status === "done").length;
          const isCurrentMonth = groupKey === todayMonth;

          return (
            <CollapsibleCard
              key={groupKey}
              title={`${monthLabel(groupKey)} · ${doneInGroup}/${groupItems.length} done`}
              defaultOpen={isCurrentMonth}
              data-testid={`plan-month-${groupKey}`}
            >
              <ul className="space-y-1 pt-1">
                {groupItems.map((item) => {
                  const isDone = item.status === "done";
                  const isSkipped = item.status === "skipped";
                  const dueLabel = new Intl.DateTimeFormat("en-US", {
                    month: "short",
                    day: "numeric",
                  }).format(new Date(item.date));

                  return (
                    <li
                      key={item.id}
                      className="flex items-center gap-2 min-h-[44px] text-sm"
                    >
                      {/* Status glyph (UXR-s4-09) */}
                      <span
                        aria-label={isDone ? "Done" : isSkipped ? "Skipped" : "Planned"}
                        title={isDone ? "Done" : isSkipped ? "Skipped" : "Planned"}
                        className={`shrink-0 text-base ${
                          isDone
                            ? "text-[var(--success)]"
                            : "text-[var(--muted)]"
                        }`}
                      >
                        {isDone ? "●" : "○"}
                      </span>

                      {/* Type badge */}
                      <TypeBadgePlan type={item.type} />

                      {/* Title — strikethrough for skipped */}
                      <span
                        className={`flex-1 min-w-0 truncate ${
                          isSkipped
                            ? "line-through text-[var(--muted)]"
                            : isDone
                              ? "text-[var(--muted)]"
                              : ""
                        }`}
                      >
                        {item.title}
                      </span>

                      {/* Due date */}
                      <span className="shrink-0 text-xs text-[var(--muted)]">
                        {dueLabel}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </CollapsibleCard>
          );
        })
      )}
    </div>
  );
}

function TypeBadgePlan({ type }: { type: string }) {
  const cls =
    type === "milestone"
      ? "border-[var(--accent)]/40 bg-[var(--accent-soft)] text-[var(--accent)]"
      : type === "launch-step"
        ? "border-[var(--warning)]/40 bg-[var(--warning)]/10 text-[var(--warning)]"
        : "border-[var(--border)] text-[var(--muted)]";
  return (
    <span className={`shrink-0 text-xs rounded-full px-2 py-0.5 border ${cls}`}>
      {type}
    </span>
  );
}
```

**Note on `CollapsibleCard` title prop**: `CollapsibleCard.title` is typed as `string` and renders inside `<h2>`. The per-month "X/Y done" count is embedded in the title string. This works for the current design. If richer title formatting is needed later, extend `CollapsibleCard` to accept `ReactNode` (out of scope for this sprint).

**Note on `data-testid` on CollapsibleCard**: The existing `CollapsibleCard` component doesn't accept `data-testid` as a prop. Pass it via the `className` workaround or extend CollapsibleCard. **Simplest fix**: Do NOT pass `data-testid` to `CollapsibleCard` directly — wrap the `CollapsibleCard` in a `<div data-testid={...}>` instead:

```tsx
<div key={groupKey} data-testid={`plan-month-${groupKey}`}>
  <CollapsibleCard title={...} defaultOpen={isCurrentMonth}>
    ...
  </CollapsibleCard>
</div>
```

---

### 3.4 `MilestoneBurnDown.tsx` — Full Spec (Dev C)

```tsx
// src/components/MilestoneBurnDown.tsx
// Server component — no "use client".
// REQ-006: burn-down card for progress page. Returns null when no milestones.

import { Card } from "@/components/Card";
import { prisma } from "@/lib/db";
import { startOfDay } from "@/lib/calendar";

const MILESTONE_WARNING_DAYS = 14;
const MS_PER_DAY = 1_000 * 60 * 60 * 24;

export async function MilestoneBurnDown({ goalId }: { goalId: string }) {
  // Single query — milestones only, all statuses, ordered by date.
  // Few milestones per goal (typically < 20); no pagination needed.
  const milestones = await prisma.scheduledItem.findMany({
    where: { goalId, type: "milestone" },
    orderBy: { date: "asc" },
    select: { id: true, title: true, status: true, date: true },
  });

  if (milestones.length === 0) return null; // PRD §3.1.6 gate

  const total = milestones.length;
  const done = milestones.filter((m) => m.status === "done").length;
  const remaining = milestones.filter((m) => m.status === "planned").length;

  const now = new Date();
  const nextMilestone = milestones.find(
    (m) => m.status === "planned" && startOfDay(m.date).getTime() >= startOfDay(now).getTime(),
  ) ?? null;

  const nextDaysRemaining =
    nextMilestone != null
      ? Math.round(
          (startOfDay(nextMilestone.date).getTime() - startOfDay(now).getTime()) / MS_PER_DAY,
        )
      : null;

  const nextDueLabel =
    nextMilestone?.date != null
      ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(
          new Date(nextMilestone.date),
        )
      : null;

  const pct = total > 0 ? (done / total) * 100 : 0;

  return (
    <Card data-testid="milestone-burndown-card">
      {/* Header (UXR-s4-12: "X of Y milestones complete" framing) */}
      <p className="text-base font-semibold mb-3">
        <span className="text-2xl">{done}</span>
        <span className="text-[var(--muted)] font-normal"> / {total} milestones complete</span>
      </p>

      {/* 3-stat grid (UXR-s4-12) */}
      <div className="grid grid-cols-3 gap-2 mb-3 text-center">
        <BurndownStat label="Total" value={total} testId="burndown-stat-total" />
        <BurndownStat label="Done" value={done} testId="burndown-stat-done" />
        <BurndownStat label="Remaining" value={remaining} testId="burndown-stat-remaining" />
      </div>

      {/* Thin accent scope bar — NO Bullseye per UXR-s4-12; NO animation per UXR-s4-17 */}
      <div
        className="h-1.5 rounded-full overflow-hidden mb-3"
        style={{ background: "var(--border)" }}
        role="progressbar"
        aria-valuenow={done}
        aria-valuemax={total}
        aria-label={`${done} of ${total} milestones complete`}
      >
        <div
          className="h-full rounded-full"
          style={{ background: "var(--accent)", width: `${pct.toFixed(1)}%` }}
        />
      </div>

      {/* Next milestone line */}
      {nextMilestone != null && (
        <div className="flex items-center justify-between gap-2 text-sm">
          <p className="truncate text-[var(--muted)]">
            <span className="font-medium text-[var(--foreground)]">Next:</span>{" "}
            {nextMilestone.title}
            {nextDueLabel ? ` · ${nextDueLabel}` : ""}
          </p>
          {nextDaysRemaining !== null && nextDaysRemaining <= MILESTONE_WARNING_DAYS && (
            <span
              className={`shrink-0 text-xs rounded-full px-2 py-0.5 border font-medium ${
                nextDaysRemaining < 0
                  ? "border-[var(--danger)]/40 bg-[var(--danger)]/10 text-[var(--danger)]"
                  : "border-[var(--warning)]/40 bg-[var(--warning)]/10 text-[var(--warning)]"
              }`}
            >
              {nextDaysRemaining < 0 ? `Overdue ${Math.abs(nextDaysRemaining)}d` : `${nextDaysRemaining}d`}
            </span>
          )}
        </div>
      )}
    </Card>
  );
}

function BurndownStat({
  label,
  value,
  testId,
}: {
  label: string;
  value: number;
  testId: string;
}) {
  return (
    <div
      className="rounded-lg border border-[var(--border)] py-2 text-center"
      data-testid={testId}
    >
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-xs text-[var(--muted)]">{label}</p>
    </div>
  );
}
```

---

## 4. Legend Mechanism — Complete Analysis

### 4.1 resolveLegend Call Sites

**Call site 1** — `src/app/calendar/page.tsx` line 21:
```ts
const legend = resolveLegend(goal);
```
`goal` comes from `getCalendarMonth()` which now selects `{ id, targetDate, objective, legend, kind }`. After this sprint's change to `getCalendarMonth`, `goal.kind` will be present. The extended `resolveLegend(goal: { legend?, kind? })` signature accepts this without a call-site change. When `goal.kind === "project"` and `goal.legend == null`, returns `PROJECT_DEFAULT_LEGEND`. ✓

**Call site 2** — `src/lib/goal-events.ts` line 114 (inside the goals loop):
```ts
const legend = resolveLegend(goal);
```
`goal` comes from `getActiveGoalsWithPlans()` in `goal-focus.ts`, which selects `{ kind, ... }`. No call-site change needed. For project goals with null legend, returns `PROJECT_DEFAULT_LEGEND`. ✓

**Call site 2b** — `src/lib/goal-events.ts` line 168 (inside the hikes loop):
```ts
const legend = resolveLegend(goal);
```
Same `goal` from the same `getActiveGoalsWithPlans()` result. Same behavior. ✓

No other `resolveLegend` call sites exist (grep-confirmed in research).

### 4.2 Double-Marker Dedup Proof

Focus goal's ScheduledItems enter two code paths:
1. **New calendar.ts path** (Dev B): `scheduledItemsForCal` query → `scheduledsByKey` map → `cell.scheduledItemCount` → `markersFor` → `push("scheduled-item", ...)` → focus marker slot.
2. **goal-events.ts path** (existing): `getGoalEventsResult` fetches scheduledItems for all active goals. These become `GoalEvent` entries with `type: "scheduled-item"`.

The dedup: `filterOtherGoalEvents(eventsByKey.get(cursorKey) ?? [], focusGoalId)` at line 225 of calendar.ts excludes the focus goal's events. So the focus goal's scheduled-item events never reach `cell.otherGoalEvents`, never render as `ForeignGoalMarker`. The new `scheduledItemCount` path is the exclusive render channel for focus-goal items. No double-render. ✓

### 4.3 PROJECT_DEFAULT_LEGEND icon choices

Both icons verified against UXR spec:
- `◆` (U+25C6, FILLED DIAMOND) — marker for `scheduled-item`. This is also used in `goal-events.ts` for foreign scheduled-item events (UXR-s4-05). Consistent.
- `🎯` — marker for `goal-date`. UXR §4.2 legend resolution diagram specifies this icon.

**`MarkerIcon` special handling for `scheduled-item`**: The icon is rendered from code (`"◆"` hardcoded in the branch) rather than from `entry.icon`. This ensures the `var(--accent)` color styling is always applied, regardless of what is stored in the legend entry's icon field. If a user sets a custom legend with `kind: "scheduled-item"` and a different icon string, the ◆ still renders in accent color. This is the correct behavior (UXR-s4-04 is normative; stored icon is advisory).

---

## 5. Fitness Byte-Identity Strategy

### Dev A — page.tsx

| Region | Rule |
|--------|------|
| Line 18 (single `await getActiveProgram()`) | REPLACE with two-item `Promise.all` |
| Lines 19–30 (original `if (!program)` guard) | REPLACE with adjusted guard + new project early return |
| Line 32 (`getTodayContext(program)`) | Add `!` non-null assertion: `getTodayContext(program!)` |
| Lines 33–128 (derived locals, Promise.all, all derived consts) | MUST NOT TOUCH |
| Lines 129–254 (entire JSX return) | MUST NOT TOUCH — including whitespace, comments, attribute order |
| Lines 258–334 (BlockCard, ExerciseRow, helper fns) | MUST NOT TOUCH |
| New imports at file top | ADD `getFocusGoal` and `ProjectTodayView` only |

**Verification gate**: After Dev A's commit, `git diff HEAD -- src/app/page.tsx | grep '^[+-]' | grep -v '^[+-][+-][+-]'` must show changes on lines 18–31 only (plus 2 import lines added). Any change outside these lines fails QA.

### Dev B — calendar.ts, CalendarMonth.tsx, legend.ts, MarkerIcon.tsx, goal-events.ts

| File | MUST CHANGE | MUST NOT CHANGE |
|------|-------------|-----------------|
| `calendar.ts` | Lines 108–134 (Promise.all restructure); `CalendarDayCell` type (add 1 field); `buildCell` args type (add 1 field); `buildCell` call site (add 1 arg); `buildCell` return (add 1 field) | All 17 existing fields in `CalendarDayCell`; all 17 existing fields in `buildCell` return; all helper functions (`countBaselinesDueForCell`, `countBaselinesFromOverride`, `deriveConfidence`); the `resolveDay` export and everything after it |
| `CalendarMonth.tsx` | `markersFor`: insert 1 line between `push("baseline", ...)` and `push("goal-date", 1)` | Everything outside `markersFor`; `DayCell`, `DayDetail`, `CalendarMonth`, `MARKER_CAP` — byte-identical |
| `legend.ts` | `LegendKindSchema` enum (add 1 value); `LegendEntrySchema.kind.describe()` (update string); add `PROJECT_DEFAULT_LEGEND`; `resolveLegend` function body | `DEFAULT_LEGEND` (6 entries, byte-identical); `LegendEntry` type; `LegendSchema`; `findLegendEntry` |
| `MarkerIcon.tsx` | Add `scheduled-item` branch in `MarkerIcon` (between `trained` branch and catch-all) | `ForeignGoalMarker`; the catch-all `span` branch; `trained` branch |
| `goal-events.ts` | Line 195 icon string `"📅"` → `"◆"` | Everything else — single-character diff |

### Dev C — plan page, progress page

| File | MUST CHANGE | MUST NOT CHANGE |
|------|-------------|-----------------|
| `goals/[id]/plan/page.tsx` | Lines 24–25: insert project branch after `notFound()` | Lines 26–396 (entire fitness plan body) |
| `progress/page.tsx` | Add `focusProjectGoal` const after `readinessByGoal`; add burn-down JSX slot; add `MilestoneBurnDown` import | Readiness loop; Weight card; `RecordsSummary`; `WeightStat` helper |

---

## 6. Data Flow + Query Count Table

### 6.1 Today page

| Path | Queries | Sequential steps | Notes |
|------|---------|-----------------|-------|
| **Fitness (old)** | 1 (getActiveProgram) + 6-item Promise.all inner | 2 | Baseline |
| **Fitness (new)** | 2 (getActiveProgram + getFocusGoal parallel) + 6-item Promise.all inner | 2 | +1 getFocusGoal (parallel, no extra step) |
| **Project (new)** | 2 (getActiveProgram + getFocusGoal parallel) + 4 (ProjectTodayView Promise.all) | 2 | Skips entire 6-item fitness block |

The `getFocusGoal()` add on the fitness path is a single parallel query (no sequential step added). No waterfall. PRD no-waterfall AC satisfied. ✓

### 6.2 Calendar page

| Path | Queries | Sequential steps | Notes |
|------|---------|-----------------|-------|
| **Fitness (old)** | 1 (getActiveProgram) + 5-item Promise.all [incl. getGoalEventsResult=3 inner] | 2 | Baseline |
| **Fitness (new)** | 1 (getActiveProgram) + 1 (goal prefetch) + 5-item Promise.all [ScheduledItem = Promise.resolve([])] | 3 | +1 sequential step (goal prefetch); 0 extra DB queries for fitness |
| **Project (new)** | 1 (getActiveProgram) + 1 (goal prefetch) + 5-item Promise.all [ScheduledItem = real query] | 3 | +1 sequential step + 1 extra DB query (ScheduledItem) vs old fitness |

The fitness calendar path gains one sequential step (goal prefetch) but 0 extra DB queries (goal was already in the old Promise.all — it's now just fetched earlier). This is an acceptable trade-off to enable the ScheduledItem query to run in parallel with workouts/hikes/overrides/goalEvents on the project path.

### 6.3 Plan page

| Path | Queries | Notes |
|------|---------|-------|
| **Fitness (old)** | 1 (goal findUnique) + 1 (getBaselineSchedule) | Baseline |
| **Fitness (new)** | 1 (goal findUnique) + 1 (getBaselineSchedule) | Unchanged — project branch before !plan check doesn't execute for fitness |
| **Project (new)** | 1 (goal findUnique) + 1 (ProjectPlanView ScheduledItem findMany) | Same count as fitness |

### 6.4 Progress page

| Path | Queries | Notes |
|------|---------|-------|
| **Fitness (old/new)** | 2 (measurements + activeGoals) + N readiness queries | Unchanged |
| **Project (new)** | 2 (measurements + activeGoals) + N readiness queries + 1 (MilestoneBurnDown milestones) | +1 query only when project is in focus |

Zero extra queries for fitness goals on all four surfaces. ✓

---

## 7. Work Streams + Implementation Order

### Dev A — page.tsx + ProjectTodayView + TodayCelebration

1. Modify `TodayCelebration.tsx` first (add `storageKey?: string` prop — backward compatible, no other consumers change).
2. Modify `src/app/page.tsx`: add imports, replace lines 18–30, add `!` at line 32.
3. Create `src/components/ProjectTodayView.tsx` from the spec in §3.2.
4. Run `tsc --noEmit` — resolve any type errors before pushing.
5. Smoke test: switch focus to a project goal, verify ProjectTodayView renders. Switch back, verify fitness path unchanged.

**Blocked until**: nothing (Dev A can start immediately on a branch from main).

### Dev B — legend + calendar + CalendarMonth + MarkerIcon + goal-events

1. Modify `src/lib/legend.ts` (add enum value, PROJECT_DEFAULT_LEGEND, update resolveLegend).
2. Modify `src/lib/goal-events.ts` (icon change — 1 line).
3. Modify `src/lib/calendar.ts` (restructure Promise.all, CalendarDayCell type, buildCell).
4. Modify `src/components/CalendarMonth.tsx` (markersFor push).
5. Modify `src/components/MarkerIcon.tsx` (scheduled-item branch).
6. Run `tsc --noEmit` — all five files must pass.
7. Smoke test: calendar page with project goal focus → confirm ◆ markers appear; switch to fitness → confirm no ◆ markers.

**Blocked until**: nothing (independent of Dev A and C).

### Dev C — plan page + ProjectPlanView + progress + MilestoneBurnDown

1. Create `src/components/MilestoneBurnDown.tsx` from spec §3.4.
2. Modify `src/app/progress/page.tsx` (add `focusProjectGoal` derive + burn-down JSX slot + import).
3. Create `src/components/ProjectPlanView.tsx` from spec §3.3.
4. Modify `src/app/goals/[id]/plan/page.tsx` (add project branch + import).
5. Run `tsc --noEmit`.
6. Smoke test: project goal plan page → CollapsibleCard timeline; progress page → burn-down card.

**Blocked until**: nothing (independent of Dev A and B).

### Integration + QA

After all three branches are merged (rebase order: B first, then A, then C to minimize conflicts — B modifies the most shared files):
1. `npm run build` — must be clean.
2. `tsc --noEmit` — 0 errors.
3. `npm run lint` — 0 errors (delete any `.next` artifacts from worktrees first per MEMORY note).
4. Browser smoke at 390px per PRD §10.3: both verticals, empty states, `set_active_goal` flips.
5. Tick UXR ledger rows UXR-s4-01 through UXR-s4-21 per §9 verify list.

---

## 8. Critical Decisions (numbered)

**CD-1. upcoming-7d items query — DROPPED.**  
UXR-s4-20 mentions "upcoming-7d items" as a 4th ProjectTodayView query. The chosen direction (Direction A ASCII art, §3) renders only today's checklist, MRR card, and next-milestone card — no "upcoming 7 days" section exists anywhere in the UI. The UXR ledger note says "include ONLY if something in the chosen design renders it." Nothing does. The query is dropped. The ProjectTodayView Promise.all has 4 items (today's items, mrrEntry, nextMilestone, goalRow for targets). Status: **DROPPED** — UXR-s4-20 ledger entry will be ticked as "dropped (nothing renders it)".

**CD-2. MilestoneBurnDown — separate component.**  
Chosen over inlining in `progress/page.tsx`. Rationale: the burn-down requires its own `prisma.scheduledItem.findMany` call. A server component encapsulation keeps `progress/page.tsx` from needing milestone query logic. The component self-gates by returning `null` when `milestones.length === 0` — the `!milestoneCount > 0` AC gate from the PRD is satisfied internally. Progress page only gates on `focusProjectGoal` being non-null (preventing the render entirely for fitness focus, avoiding the query).

**CD-3. Milestone count query shape — single findMany, JS counts.**  
`groupBy status` (one round-trip) was considered. Chosen instead: `findMany({ type: "milestone" })` + JS `.filter()` for counts. Rationale: milestones per goal are few (< 20 typical); the full row data is needed anyway (for `nextMilestone.title`, `nextMilestone.date`, next-upcoming iteration). A `groupBy` would require a second `findFirst` for the next-milestone details. Net result: `groupBy` = 2 queries; `findMany` = 1 query with all data. `findMany` wins.

**CD-4. urgency thresholds as named constants.**  
`MILESTONE_WARNING_DAYS = 14` is defined as a named constant in both `ProjectTodayView.tsx` and `MilestoneBurnDown.tsx`. It is NOT extracted to a shared file (overkill for two consumers; keep each file self-contained). QA will verify the 14-day threshold visually per UXR-s4-13 ⚠.

**CD-5. getFocusGoal NOT extended; ProjectTodayView fetches targets itself.**  
`getFocusGoal` in `goal-focus.ts` does not select `targets`. ProjectTodayView does its own `prisma.goal.findUnique({ select: { targets: true } })` as the 4th item in its Promise.all. This keeps `getFocusGoal`'s blast radius minimal and makes ProjectTodayView self-contained. The page.tsx props to ProjectTodayView are `{ id, objective, targetDate }` (all from `FocusGoalRow`).

**CD-6. TodayCelebration storageKey — optional prop, backward-compatible.**  
Rather than creating a project-specific variant of `TodayCelebration`, an optional `storageKey?: string` prop is added. Fitness path does not pass it (uses default `"goaldmine.celebrated." + dateKey`). Project path passes `"goaldmine.project-celebrated." + goalId + "." + dateKey`. This scoping prevents the fitness and project celebrations from sharing state if the user switches focus mid-day.

**CD-7. Calendar goal prefetch — sequential before main Promise.all.**  
To enable the gated ScheduledItem query to run in parallel with workouts/hikes/overrides/goalEvents, the `goal` fetch is separated from the main Promise.all. This adds 1 sequential step to `getCalendarMonth` for all paths (fitness + project). The fitness path still runs 0 ScheduledItem queries (`Promise.resolve([])`). The project path gets the ScheduledItem query running in parallel with everything else. Accepted trade-off.

**CD-8. OtherGoalsStrip on project Today path — omitted.**  
The project early-return in `page.tsx` exits before `OtherGoalsStrip` renders. This means non-focus goal events are not shown on the project Today view. This is a known gap, accepted for this sprint per PRD §3.3 ("no fitness convergence"). Future sprint can add an `OtherGoalsStrip` call inside `ProjectTodayView` if needed.

**CD-9. CollapsibleCard data-testid workaround.**  
`CollapsibleCard` does not accept `data-testid`. Wrap each `CollapsibleCard` in a `<div data-testid="plan-month-{yyyy-mm}">`. Do NOT modify `CollapsibleCard.tsx` (read-only this sprint). The `data-testid` is on the wrapper div, not the `<details>` element — Maestro/E2E selectors should target the wrapper.

**CD-10. CharacterHeader omitted on project Today path.**  
Confirmed: the project early-return fires before `computeGameState()` (which is in the 6-item fitness Promise.all). CharacterHeader requires `gameState`, which is never computed on the project path. The PRD §9 "resolved" note explicitly omits CharacterHeader from the project path for this sprint. If future sprints add game rules for project goals, `ProjectTodayView` can call `computeGameState()` internally.

---

## 9. Accessibility Checklist (UXR §8)

All new components must satisfy before ship:

- [ ] Status icons (`○`/`●`, ◆) have `aria-label` or `title` on the containing span.
- [ ] Type badges are text chips (word + border color), never color-only.
- [ ] All clickable rows in `ProjectTodayView` checklist: `min-h-[44px]`.
- [ ] All `CollapsibleCard` summaries already have `min-h-[44px]` (verified in source).
- [ ] `Bullseye` in `TodayCelebration` uses `aria-label` (already wired in existing component).
- [ ] MRR bar and milestone bar: `role="progressbar"` + `aria-valuenow` + `aria-valuemax` + `aria-label`.
- [ ] Bullseye center fill uses `var(--target-fg)` NOT `#fff` (UXR-s4-21; verified in `Bullseye.tsx` source — implementation inherits this automatically).
- [ ] No hardcoded hex colors in any new component.

---

## 10. Summary + Open Concerns

**10-line summary:**
Sprint 4 branches four surfaces on `focusGoal.kind`. Dev A modifies 3 lines in `page.tsx` (parallel fetch + adjusted guard + project early-return) and builds `ProjectTodayView` as a self-contained server component with 4 parallel queries. Dev B touches 5 files: `legend.ts` gains `scheduled-item` enum + `PROJECT_DEFAULT_LEGEND` + kind-aware `resolveLegend`; `calendar.ts` restructures the goal fetch to enable a gated parallel ScheduledItem query; `CalendarMonth.markersFor` gains one push call; `MarkerIcon` gains one branch; `goal-events.ts` gets a 1-char icon fix. Dev C inserts a 3-line project branch in the plan page before the `!plan` check and builds `ProjectPlanView` (month-grouped CollapsibleCards from a single `findMany`) and `MilestoneBurnDown` (single milestone `findMany`, JS counts). Fitness paths are byte-identical on all four surfaces except the +1 parallel `getFocusGoal` query on the Today page. `TodayCelebration` gets an optional `storageKey` prop for project-scoped pop gating. upcoming-7d query dropped; MilestoneBurnDown is a separate component; thresholds are named constants.

**Open concerns:**

1. **`--danger` token verified** in `globals.css` (lines 17, 48, 69, 86). Both `UrgencyChip` and `MilestoneBurnDown` use `var(--danger)` safely. No concern.

2. **CollapsibleCard title overflow**: The per-month title includes "June 2026 · 3/7 done" — at 390px this is ~30 chars and fits comfortably. Very long month names (non-English locales) could overflow but the single user is `en-US`. Low risk.

3. **`ScheduledItem.date` USER_TZ**: The schema comment says "USER_TZ midnight; written via parseDateInput by future tools." All reads use `dateKey(item.date)` which applies USER_TZ. `startOfDay(item.date)` used in `nextMilestone` query comparison is also USER_TZ-aware via `@/lib/calendar`. No TZ risk if conventions are followed.

4. **Bullseye ring coarseness at low item counts** (UXR-s4-16 ⚠): `progress = doneCount / totalCount` at 28px (14-size band, 3 rings). At 1 item today: progress jumps from 0 to 1.0 (hollow → fully filled). This is binary and may feel abrupt. QA must verify during browser smoke; if it misleads, add a minimum of 1 ring for any progress > 0 (this is already the behavior: `progressToRings` returns `Math.max(1, Math.ceil(p * 3))` for size 14..20 at 28px). The concern is more about visual coarseness than correctness — note for QA.

5. **`ProjectTodayView` card prop `data-testid`**: `Card` component does not accept `data-testid`. Same workaround as `CollapsibleCard`: wrap in a `<div data-testid="mrr-progress-card">` rather than passing to `Card` directly. Dev A must implement this pattern consistently.
