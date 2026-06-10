# Architecture Blueprint — Multi-goal Phase 1: Cross-goal Awareness (REQ-101..107)

**Author**: Architect Agent  
**Date**: 2026-06-10  
**PRD**: docs/prds/PRD-multigoal-phase1-awareness.md  
**GitHub Issue**: #62 / Epic #61  

---

## Table of Contents

1. [File Structure](#1-file-structure)
2. [Prisma Schema + Migration](#2-prisma-schema--migration)
3. [New Modules — Full TypeScript Signatures](#3-new-modules--full-typescript-signatures)
4. [calendar.ts Surgery Plan](#4-calendarsts-surgery-plan)
5. [Focus-Split Refactor Table](#5-focus-split-refactor-table)
6. [MCP Tool Surface](#6-mcp-tool-surface)
7. [Component Hierarchy for UI REQs (105, 106)](#7-component-hierarchy-for-ui-reqs-105-106)
8. [Data Flow Diagrams](#8-data-flow-diagrams)
9. [Work Streams](#9-work-streams)
10. [Critical Decisions](#10-critical-decisions)

---

## 1. File Structure

### 1.1 New Files

| Path | Purpose | Key Exports |
|------|---------|-------------|
| `prisma/migrations/<ts>_multigoal_phase1/migration.sql` | DB migration (schema delta + backfill SQL) | — |
| `src/lib/goal-focus.ts` | Focus-goal and active-goal resolution; imported by calendar.ts, program.ts, tools.ts, goal-events.ts | `getFocusGoal`, `getActiveGoalsWithPlans` |
| `src/lib/goal-events.ts` | Cross-goal event library; 3-query budget | `GoalEvent`, `GoalEventType`, `GoalEventsResult`, `OtherGoalMeta`, `getGoalEvents`, `getGoalEventsResult`, `eventsByDateKey`, `otherGoalEvents` |
| `src/lib/goal-conflicts.ts` | Pure cross-goal conflict detection; no DB imports | `CROSS_GOAL_RULES`, `CrossGoalConflictKind`, `CrossGoalConflict`, `crossGoalConflicts` |
| `src/components/OtherGoalsStrip.tsx` | Today-page other-goal events strip (server component; renders nothing when empty) | `OtherGoalsStrip` |

### 1.2 Modified Files by REQ

Files are listed in the order they must be modified (REQ dependency order governs). Files touched by multiple REQs are annotated.

| File | Touched by | Change summary |
|------|-----------|----------------|
| `prisma/schema.prisma` | REQ-101 | Add `Goal.isFocus`, optional `Goal.targetDate`, `Hike.goalId` FK + relations + indexes |
| `src/lib/goal-focus.ts` | REQ-101 (create) | New module |
| `src/lib/program.ts` | REQ-101 | `getActiveProgram` focus-scoped query |
| `src/lib/goal-core.ts` | REQ-101 | Drop global updateMany; focus-only-when-none; null targetDate → 12w plan |
| `src/lib/goal-actions.ts` | REQ-101 | Rename `setActiveGoal` → `setFocusGoal`; new `setGoalTracked`; null targetDate in create/update |
| `src/lib/calendar.ts` | REQ-101, REQ-103, REQ-104 | Three sequential passes (see §4) |
| `src/lib/plan-lint.ts` | REQ-101 | Focus-scoped plan query |
| `src/lib/game/engine.ts` | REQ-101 | `isFocus: true` in goal query |
| `src/lib/mcp/tools.ts` | REQ-101, REQ-107 | Focus fallbacks (101); full MCP parity (107) |
| `src/app/goals/page.tsx` | REQ-101, REQ-105 | Query ordering + null guards (101); Focus badge/Track/Untrack/Someday UI (105) |
| `src/app/goals/[id]/page.tsx` | REQ-101, REQ-105 | Null guards (101); optional date edit form (105) |
| `src/app/progress/page.tsx` | REQ-101 | Null guards on targetDate |
| `src/app/stats/page.tsx` | REQ-101 | Null guards on targetDate |
| `src/app/calendar/page.tsx` | REQ-101, REQ-106 | Null guard on goal.targetDate (101); legend/otherGoals props (106) |
| `src/app/baselines/new/page.tsx` | REQ-101 | Focus-scoped plan query |
| `src/lib/records.ts` | REQ-102 | Factor `baselineCheckpointDates`; refactor `getBaselineSchedule` |
| `src/lib/goal-events.ts` | REQ-102 (create) | New module |
| `src/lib/goal-conflicts.ts` | REQ-103 (create) | New module |
| `src/app/api/mcp/route.ts` | REQ-107 | Server instructions reword |
| `src/components/OtherGoalsStrip.tsx` | REQ-106 (create) | New component |
| `src/components/CalendarMonth.tsx` | REQ-106 | Foreign-goal markers, legend section, DayDetail rows, aria-labels |
| `src/app/page.tsx` | REQ-106 | Fetch 7-day goal events; render `OtherGoalsStrip` |
| `src/app/days/[dateKey]/page.tsx` | REQ-106 | Target-date banner; other-event rows; conflict banner |

### 1.3 Creation/Modification Order

```
[1] prisma/schema.prisma           ← write, then: npx prisma migrate dev --name multigoal_phase1 --create-only
[2] migration.sql                  ← hand-append backfill, then: npx prisma migrate dev && npx prisma generate
[3] src/lib/goal-focus.ts          ← new
[4] src/lib/program.ts             ← modify (focus-scoped)
[5] src/lib/goal-core.ts           ← modify (no-steal, null targetDate)
[6] src/lib/goal-actions.ts        ← modify (rename + setGoalTracked + null)
[7] src/lib/calendar.ts (Pass 1)   ← REQ-101: focus flips + null guards only
[8] src/lib/plan-lint.ts           ← modify (focus plan)
[9] src/lib/game/engine.ts         ← modify (focus goal)
[10] src/lib/mcp/tools.ts (Pass 1) ← REQ-101: focus fallbacks only
[11] src/app/goals/page.tsx        ← modify (query + null + Focus UI)
[12] src/app/goals/[id]/page.tsx   ← modify (null guards + optional date)
[13] src/app/progress/page.tsx     ← modify (null guards)
[14] src/app/stats/page.tsx        ← modify (null guards)
[15] src/app/calendar/page.tsx     ← modify (null guard on goalKey)
[16] src/app/baselines/new/page.tsx ← modify (focus plan)
── Gate: npx tsc --noEmit must pass clean here before continuing ──
[17] src/lib/records.ts            ← REQ-102: baselineCheckpointDates + getBaselineScheduleForPlan
[18] src/lib/goal-events.ts        ← REQ-102: new module
── Gate: npx tsc --noEmit ──
[19] src/lib/goal-conflicts.ts     ← REQ-103: new module
[20] src/lib/calendar.ts (Pass 2)  ← REQ-103: type widening only (WeekConflict + CalendarDayCell)
── Gate: existing weekConflicts consumers compile unchanged ──
[21] src/lib/calendar.ts (Pass 3)  ← REQ-104: resolveDay + getCalendarMonth surgery
[22] src/app/api/mcp/route.ts      ← REQ-107: server instructions
[23] src/lib/mcp/tools.ts (Pass 2) ← REQ-107: full MCP parity
[24] src/components/OtherGoalsStrip.tsx ← REQ-106: new
[25] src/components/CalendarMonth.tsx   ← REQ-106: foreign markers + legend
[26] src/app/page.tsx              ← REQ-106: OtherGoalsStrip
[27] src/app/calendar/page.tsx     ← REQ-106: pass otherGoals prop
[28] src/app/days/[dateKey]/page.tsx ← REQ-106: banners
── Final gate: npx tsc --noEmit && npm run lint && npm run build ──
```

---

## 2. Prisma Schema + Migration

### 2.1 Schema Diff (exact additions to schema.prisma)

```prisma
model Goal {
  // ...existing fields...
  targetDate          DateTime?              // CHANGED: was DateTime (required)
  isFocus             Boolean  @default(false)  // NEW: exactly one true; drives daily prescription
  // ...existing plans/scheduledItems/logEntries relations...
  hikes               Hike[]                 // NEW: inverse relation

  // ...existing indexes...
  @@index([isFocus])                         // NEW
}

model Hike {
  // ...existing fields...
  goalId String?                             // NEW: nullable FK
  goal   Goal?   @relation(fields: [goalId], references: [id], onDelete: SetNull)  // NEW

  // ...existing indexes...
  @@index([goalId])                          // NEW
}
```

Full-text diff on Goal model:
- Line ~169: `targetDate DateTime` → `targetDate DateTime?`
- After `active Boolean @default(true)`: insert `isFocus Boolean @default(false)`
- After `@@index([targetDate])`: insert `@@index([isFocus])`
- After `scheduledItems ScheduledItem[]`: insert `hikes Hike[]`

Full-text diff on Hike model:
- After `notes String?`: insert `goalId String?` and `goal Goal? @relation(fields: [goalId], references: [id], onDelete: SetNull)`
- After `@@index([status])`: insert `@@index([goalId])`

### 2.2 Migration SQL (hand-append after --create-only)

The Prisma CLI will generate the three ALTER statements. Verify the generated SQL contains:

```sql
-- AddColumn Goal.isFocus (constant default, no table rewrite in PG)
ALTER TABLE "Goal" ADD COLUMN "isFocus" BOOLEAN NOT NULL DEFAULT false;

-- DropNotNull Goal.targetDate (metadata-only)
ALTER TABLE "Goal" ALTER COLUMN "targetDate" DROP NOT NULL;

-- AddColumn Hike.goalId (nullable FK, additive)
ALTER TABLE "Hike" ADD COLUMN "goalId" TEXT;
ALTER TABLE "Hike" ADD CONSTRAINT "Hike_goalId_fkey"
  FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes
CREATE INDEX "Goal_isFocus_idx" ON "Goal"("isFocus");
CREATE INDEX "Hike_goalId_idx" ON "Hike"("goalId");
```

**Append this backfill at the END of the generated SQL, inside the same file:**

```sql
-- Backfill: set isFocus=true on the most-recently-updated active goal.
-- Runs as a single targeted row update — safe under concurrent reads (Neon/PG).
UPDATE "Goal" SET "isFocus" = true
WHERE "id" = (
  SELECT "id" FROM "Goal"
  WHERE "active" = true
  ORDER BY "updatedAt" DESC
  LIMIT 1
);
```

### 2.3 Migration Commands

```sh
# Step 1: generate migration SQL file WITHOUT applying
npx prisma migrate dev --name multigoal_phase1 --create-only

# Step 2: review generated SQL, then hand-append backfill above

# Step 3: apply migration to Neon (semi-prod — verify SQL first)
npx prisma migrate dev

# Step 4: regenerate Prisma client (REQUIRED before any code change that uses new fields)
npx prisma generate
```

### 2.4 Safety Confirmation

All three column changes are **metadata-only / additive** in PostgreSQL:
- `ADD COLUMN ... DEFAULT false` — constant default, no table rewrite
- `ALTER COLUMN targetDate DROP NOT NULL` — catalog-only change
- `ADD COLUMN goalId TEXT` (nullable FK) — additive

The `onDelete: SetNull` (NOT Cascade) preserves `delete_goal`'s contract that hikes survive a goal deletion (tools.ts existing behavior at ~line 4120). The FK replaces hike rows' `goalId` with NULL on goal delete, which is correct read-time fallback behavior (null = attribute to focus goal at read time).

---

## 3. New Modules — Full TypeScript Signatures

### 3.1 `src/lib/goal-focus.ts`

```typescript
// Focus-goal and active-goal resolution.
//
// "Focus" (isFocus=true): the one goal whose plan drives the daily prescription.
// "Active" (active=true): tracked; contributes events; exactly one can also be focus.
//
// When multiple goals are stuck with isFocus=true (bad state), readers use
// findFirst(orderBy: { updatedAt: "desc" }) — deterministic winner, mirrors the
// existing active-goal convention in calendar.ts and program.ts.

import { prisma } from "@/lib/db";

export type FocusGoalRow = {
  id: string;
  objective: string;
  targetDate: Date | null;
  kind: string;
  isFocus: boolean;
  legend: unknown;
};

export type ActiveGoalWithPlan = {
  id: string;
  objective: string;
  targetDate: Date | null;
  kind: string;
  isFocus: boolean;
  legend: unknown;
  plans: Array<{
    id: string;
    startedOn: Date;
    endsOn: Date;
    weeks: number;
    planJson: unknown;
  }>;
};

/**
 * Returns the focus goal (isFocus=true), or null when no goal is focused.
 * Deterministically picks the most-recently-updated if multiple are stuck isFocus=true.
 */
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

/**
 * Returns all active (tracked) goals, each with their single most-recently-updated
 * active plan. Focus goal appears first (isFocus desc), then by updatedAt.
 * Used by getGoalEvents for the 3-query event fetch.
 */
export async function getActiveGoalsWithPlans(): Promise<ActiveGoalWithPlan[]> {
  return prisma.goal.findMany({
    where: { active: true },
    orderBy: [{ isFocus: "desc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      objective: true,
      targetDate: true,
      kind: true,
      isFocus: true,
      legend: true,
      plans: {
        where: { active: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: {
          id: true,
          startedOn: true,
          endsOn: true,
          weeks: true,
          planJson: true,
        },
      },
    },
  });
}
```

### 3.2 `src/lib/goal-events.ts`

```typescript
// Cross-goal event library.
//
// PHASE 1 LIMITATION: non-focus goal retest events are rotation-derived math only.
// PlanDayOverride.baselineTestNames on non-focus plans is NOT consulted — checkpoint
// dates follow the template's retestWeeks only. This means a manually-deferred
// baseline on a non-focus plan does not affect the event date surfaced here.
// Documented limitation; Phase 2+ can extend baselineCheckpointDates to accept an
// overrides map if needed.
//
// Attribution comment (required per conventions):
// "hike.goalId ?? focusGoalId — null at log time means 'the focus goal at time of
// hike', resolved at read time." This is a deliberate read-time semantic.

import { prisma } from "@/lib/db";
import { addDays, dateKey, startOfDay, endOfDay } from "@/lib/calendar";
import { resolveLegend, findLegendEntry, type LegendEntry } from "@/lib/legend";
import { baselineCheckpointDates } from "@/lib/records";
import { getActiveGoalsWithPlans, type ActiveGoalWithPlan } from "@/lib/goal-focus";
import type { ProgramTemplate } from "@/lib/program-template";

export type GoalEventType =
  | "target-date"
  | "baseline-retest"
  | "planned-hike"
  | "scheduled-item";

export type GoalEvent = {
  goalId: string;
  goalObjective: string;
  goalKind: string;
  isFocusGoal: boolean;
  dateKey: string;       // "yyyy-mm-dd"
  type: GoalEventType;
  icon: string;          // from goal's legend goal-date entry; fallback "🏔️"
  label: string;         // from goal's legend goal-date entry; fallback "Goal date"
  detail?: string;       // testName for baseline-retest; route for planned-hike; item detail for scheduled-item
};

export type OtherGoalMeta = {
  id: string;
  objective: string;
  goalDateIcon: string;   // icon from goal-date legend entry; fallback "🏔️"
  goalDateLabel: string;  // label from goal-date legend entry; fallback "Goal date"
  kind: string;
  targetDate: Date | null;
};

export type GoalEventsResult = {
  events: GoalEvent[];
  focusGoalId: string | null;
  /** All active non-focus goals — used by getCalendarMonth for the legend card. */
  otherGoalsMeta: OtherGoalMeta[];
};

/**
 * Fetch all cross-goal events for a date range.
 * Exactly 3 DB queries:
 *   1. getActiveGoalsWithPlans() — goals + their single active plan
 *   2. prisma.hike.findMany — planned hikes in range with goalId
 *   3. prisma.scheduledItem.findMany — planned items in range
 *
 * All date math via @/lib/calendar.
 */
export async function getGoalEventsResult(
  range: { start: Date; end: Date },
): Promise<GoalEventsResult> {
  // Query 1: active goals with their active plans
  const goals = await getActiveGoalsWithPlans();
  const activeGoalIds = goals.map((g) => g.id);
  const focusGoalId = goals.find((g) => g.isFocus)?.id ?? null;
  const startDk = dateKey(range.start);
  const endDk = dateKey(range.end);

  // Queries 2 + 3 in parallel
  const [hikes, scheduledItems] = await Promise.all([
    prisma.hike.findMany({
      where: {
        status: "planned",
        date: { gte: range.start, lte: range.end },
      },
      select: { id: true, date: true, route: true, goalId: true },
      orderBy: { date: "asc" },
    }),
    prisma.scheduledItem.findMany({
      where: {
        goalId: { in: activeGoalIds },
        date: { gte: range.start, lte: range.end },
        status: "planned",
      },
      select: {
        id: true,
        goalId: true,
        date: true,
        type: true,
        title: true,
        detail: true,
      },
      orderBy: { date: "asc" },
    }),
  ]);

  const events: GoalEvent[] = [];

  for (const goal of goals) {
    const legend = resolveLegend(goal);
    const goalDateEntry = findLegendEntry(legend, "goal-date");
    const icon = goalDateEntry?.icon ?? "🏔️";
    const label = goalDateEntry?.label ?? "Goal date";

    // Event source 1: target-date event
    if (goal.targetDate) {
      const dk = dateKey(goal.targetDate);
      if (dk >= startDk && dk <= endDk) {
        events.push({
          goalId: goal.id,
          goalObjective: goal.objective,
          goalKind: goal.kind,
          isFocusGoal: goal.isFocus,
          dateKey: dk,
          type: "target-date",
          icon,
          label,
        });
      }
    }

    // Event source 2: baseline retest checkpoints (rotation-derived, ignores non-focus overrides)
    const plan = goal.plans[0];
    if (plan) {
      const template = plan.planJson as unknown as ProgramTemplate;
      const checkpoints = baselineCheckpointDates(template, plan.startedOn);
      for (const cp of checkpoints) {
        const dk = dateKey(cp.targetDate);
        if (dk >= startDk && dk <= endDk) {
          events.push({
            goalId: goal.id,
            goalObjective: goal.objective,
            goalKind: goal.kind,
            isFocusGoal: goal.isFocus,
            dateKey: dk,
            type: "baseline-retest",
            icon: "◎",
            label: `${cp.label === "initial" ? "Initial" : "Retest"}: ${cp.testName}`,
            detail: cp.testName,
          });
        }
      }
    }
  }

  // Event source 3: planned hikes
  // Attribution: hike.goalId ?? focusGoalId — null at log time means
  // "the focus goal at time of hike", resolved at read time.
  for (const hike of hikes) {
    const attributedGoalId = hike.goalId ?? focusGoalId;
    if (!attributedGoalId) continue;
    const goal = goals.find((g) => g.id === attributedGoalId);
    if (!goal) continue;
    const legend = resolveLegend(goal);
    const hikeEntry = findLegendEntry(legend, "hike-planned");
    events.push({
      goalId: attributedGoalId,
      goalObjective: goal.objective,
      goalKind: goal.kind,
      isFocusGoal: goal.isFocus,
      dateKey: dateKey(hike.date),
      type: "planned-hike",
      icon: hikeEntry?.icon ?? "🥾",
      label: hikeEntry?.label ?? "Hike planned",
      detail: hike.route,
    });
  }

  // Event source 4: planned ScheduledItems
  for (const item of scheduledItems) {
    const goal = goals.find((g) => g.id === item.goalId);
    if (!goal) continue;
    events.push({
      goalId: item.goalId,
      goalObjective: goal.objective,
      goalKind: goal.kind,
      isFocusGoal: goal.isFocus,
      dateKey: dateKey(item.date),
      type: "scheduled-item",
      icon: "📅",
      label: item.title,
      detail: item.detail ?? undefined,
    });
  }

  // Build otherGoalsMeta for legend card (derived from goals, no extra query)
  const otherGoalsMeta: OtherGoalMeta[] = goals
    .filter((g) => !g.isFocus)
    .map((g) => {
      const legend = resolveLegend(g);
      const entry = findLegendEntry(legend, "goal-date");
      return {
        id: g.id,
        objective: g.objective,
        goalDateIcon: entry?.icon ?? "🏔️",
        goalDateLabel: entry?.label ?? "Goal date",
        kind: g.kind,
        targetDate: g.targetDate,
      };
    });

  return { events, focusGoalId, otherGoalsMeta };
}

/** Convenience: returns just the events array. */
export async function getGoalEvents(
  range: { start: Date; end: Date },
): Promise<GoalEvent[]> {
  return (await getGoalEventsResult(range)).events;
}

/**
 * Group events by dateKey for O(1) lookup in cell building.
 */
export function eventsByDateKey(events: GoalEvent[]): Map<string, GoalEvent[]> {
  const map = new Map<string, GoalEvent[]>();
  for (const e of events) {
    const arr = map.get(e.dateKey) ?? [];
    arr.push(e);
    map.set(e.dateKey, arr);
  }
  return map;
}

/**
 * Filter to events NOT belonging to the focus goal.
 * When focusGoalId is null, returns all events (none can be "other" if no focus exists).
 */
export function otherGoalEvents(
  events: GoalEvent[],
  focusGoalId: string | null,
): GoalEvent[] {
  if (!focusGoalId) return events;
  return events.filter((e) => e.goalId !== focusGoalId);
}
```

### 3.3 `src/lib/records.ts` — New Exports (factored from `getBaselineSchedule`)

Add **before** `getBaselineSchedule` in records.ts:

```typescript
/**
 * Pure: derive all baseline checkpoint dates from a plan template + startedOn.
 * Returns { testName, targetDate, label } for every initial/retest checkpoint.
 *
 * Uses the module-local `addDays` (end-of-day bounds) for consistency with
 * getBaselineSchedule's window semantics. This intentionally differs from
 * the calendar.ts export which returns midnight.
 *
 * Called by getGoalEvents to surface baseline-retest events on the calendar.
 * No DB — pure function safe to call without await.
 */
export function baselineCheckpointDates(
  template: ProgramTemplate,
  startedOn: Date,
): Array<{ testName: string; targetDate: Date; label: "initial" | "retest" }> {
  const result: Array<{ testName: string; targetDate: Date; label: "initial" | "retest" }> = [];
  for (const day of template.baselineWeek ?? []) {
    for (const test of day.tests) {
      const initialWeek = test.initialWeek ?? 1;
      result.push({
        testName: test.testName,
        targetDate: addDays(startedOn, initialWeek * 7),
        label: "initial",
      });
      for (const w of (test.retestWeeks ?? []).filter((w) => w > initialWeek)) {
        result.push({
          testName: test.testName,
          targetDate: addDays(startedOn, w * 7),
          label: "retest",
        });
      }
    }
  }
  return result;
}

/**
 * Compute the baseline schedule for a given plan (plan object already fetched).
 * Extracted from getBaselineSchedule so callers can pass a specific plan without
 * a global active-plan lookup.
 */
export async function getBaselineScheduleForPlan(
  plan: { planJson: unknown; startedOn: Date },
  opts?: { now?: Date },
): Promise<{
  startedOn: Date | null;
  totalWeeks: number | null;
  scheduled: ScheduledBaseline[];
  unscheduledExtras: { testName: string; units: string; resultCount: number; latest: { date: Date; value: number } }[];
}> {
  // ... same logic as existing getBaselineSchedule starting at lines 204+
  // plan is pre-provided; the function body is identical except there is no
  // Prisma plan fetch at the top.
}
```

Modify `getBaselineSchedule` (public API) to delegate:

```typescript
export async function getBaselineSchedule(opts?: { now?: Date }): Promise<{...}> {
  // Focus-strict: only return the focus goal's active plan (DC-6 + CRIT-2 fix).
  // When the focus goal has no active plan, return the empty shape rather than
  // silently showing another goal's baseline schedule on baselines/new.
  const plan = await prisma.plan.findFirst({
    where: { active: true, goal: { isFocus: true } },
    orderBy: { updatedAt: "desc" },
  });
  if (!plan) {
    return { startedOn: null, totalWeeks: null, scheduled: [], unscheduledExtras: [] };
  }
  return getBaselineScheduleForPlan(plan, opts);
}
```

### 3.4 `src/lib/goal-conflicts.ts`

```typescript
// Cross-goal conflict detection.
//
// PURE — no DB, no await, no side effects, no mutation.
// All inputs pre-fetched by the caller (resolveDay / getCalendarMonth / get_week).
//
// TUNABLE: CROSS_GOAL_RULES is exported so product-level decisions (raceProximityDays,
// which categories count as "hard") don't require code changes.

import {
  addDays,
  dateKey,
  parseDateKey,
  startOfDay,
  startOfWeekMonday,
  templateForRotationDay,
} from "@/lib/calendar";
import type { GoalEvent } from "@/lib/goal-events";
import type { ActiveProgramSnapshot } from "@/lib/program";

export const CROSS_GOAL_RULES = {
  /** Race/target-date event within this many days of a long-effort slot or planned hike triggers event-near-long-effort. */
  raceProximityDays: 2,
  /**
   * Focus rotation categories that trigger event-on-hard-day when a non-focus goal's
   * key event lands on that day.
   * Excluded: "zone2-mobility" (soft), "rest" (soft).
   * NOTE: "long-endurance" IS included (CRIT-1 fix) so that a non-focus goal's
   * baseline-retest event landing directly ON (diff=0) the long-effort day fires
   * event-on-hard-day. The event-near-long-effort kind still catches diff>0
   * target-date proximity separately. Override suppression still applies.
   */
  hardCategories: ["upper", "lower", "calisthenics", "lower-power", "long-endurance"] as const,
} as const;

export type CrossGoalConflictKind =
  | "event-on-hard-day"
  | "key-events-same-week"
  | "event-near-long-effort";

export type CrossGoalConflict = {
  dateKey: string;                // "yyyy-mm-dd" of the conflicted day
  kind: CrossGoalConflictKind;
  withDates: string[];            // dateKey(s) of the colliding slot(s)
  goalId: string;                 // the non-focus goal whose event is in conflict
  goalObjective: string;
  /** Human-readable label surfaced verbatim in UI and MCP. */
  label: string;
};

/**
 * Compute cross-goal conflicts for a date range.
 *
 * PURE — no DB calls. All arguments must be pre-fetched by the caller.
 *
 * Deduplication rule: at most one conflict per dateKey. When multiple kinds
 * fire on the same day, most severe wins (event-on-hard-day > event-near-long-effort
 * > key-events-same-week).
 *
 * Override suppression: event-on-hard-day is suppressed when the date has
 * a workoutJson override (caller passes it in overrideDateKeys).
 */
export function crossGoalConflicts(args: {
  events: GoalEvent[];
  focusGoalId: string | null;
  focusProgram: ActiveProgramSnapshot | null;
  plannedHikeDateKeys: string[];   // dateKeys of planned hikes in or near the range
  overrideDateKeys?: string[];     // dates with workoutJson overrides (suppress event-on-hard-day)
  range: { start: Date; end: Date };
}): CrossGoalConflict[] {
  const {
    events,
    focusGoalId,
    focusProgram,
    plannedHikeDateKeys,
    overrideDateKeys = [],
    range,
  } = args;

  // Only non-focus goal events generate cross-goal conflicts
  const nonFocusEvents = events.filter((e) => e.goalId !== focusGoalId);
  if (nonFocusEvents.length === 0) return [];

  const overrideSet = new Set(overrideDateKeys);
  const conflicts: CrossGoalConflict[] = [];

  // ── Kind 1: event-on-hard-day ──────────────────────────────────────────────
  // A non-focus goal's target-date or baseline-retest event lands on a day
  // whose focus rotation template is a hard category.
  // Label template: "{GoalObjective}'s {eventLabel} lands on a {tmpl.title} day (focus Day {rotDay})"
  if (focusProgram) {
    for (const event of nonFocusEvents) {
      if (event.type !== "target-date" && event.type !== "baseline-retest") continue;
      if (overrideSet.has(event.dateKey)) continue; // override resolves the day

      const date = parseDateKey(event.dateKey);
      const tmpl = templateForRotationDay(focusProgram, date);
      if (!tmpl) continue; // outside focus plan window

      const isHard = (CROSS_GOAL_RULES.hardCategories as readonly string[]).includes(tmpl.category);
      if (isHard) {
        conflicts.push({
          dateKey: event.dateKey,
          kind: "event-on-hard-day",
          withDates: [event.dateKey],
          goalId: event.goalId,
          goalObjective: event.goalObjective,
          label: `${event.goalObjective}'s ${event.label} lands on a ${tmpl.title} day`,
        });
      }
    }
  }

  // ── Kind 2: key-events-same-week ──────────────────────────────────────────
  // ≥2 different goals each have a target-date or baseline-retest event in
  // the same rotation week (calendar-Mon week as fallback when no focus program).
  // Label template: "{GoalObjective}'s {eventLabel} shares week {wi} with another goal's key event"
  // CRIT-3 fix: include ALL goals' key events (focus + non-focus) in the week scan.
  // This catches focus-retest-week vs non-focus-race-week collisions — the primary
  // scenario this kind was designed for. Conflicts are only emitted for non-focus
  // events (the focus goal's events are the "other side" — see emit loop below).
  const keyEvents = events.filter(
    (e) => e.type === "target-date" || e.type === "baseline-retest",
  );

  const byWeek = new Map<string, GoalEvent[]>();
  for (const event of keyEvents) {
    const eventDate = parseDateKey(event.dateKey);
    let weekKey: string;
    if (focusProgram) {
      const startMid = startOfDay(focusProgram.startedOn);
      const daysDelta = Math.floor(
        (startOfDay(eventDate).getTime() - startMid.getTime()) / (24 * 3600 * 1000),
      );
      if (daysDelta >= 0 && daysDelta < focusProgram.template.totalWeeks * 7) {
        const wi = Math.floor(daysDelta / 7) + 1;
        weekKey = `rotation-${wi}`;
      } else {
        weekKey = dateKey(startOfWeekMonday(eventDate));
      }
    } else {
      weekKey = dateKey(startOfWeekMonday(eventDate));
    }
    const arr = byWeek.get(weekKey) ?? [];
    arr.push(event);
    byWeek.set(weekKey, arr);
  }

  for (const [weekKey, weekEvents] of byWeek) {
    const uniqueGoals = new Set(weekEvents.map((e) => e.goalId));
    if (uniqueGoals.size < 2) continue;
    const weekLabel = weekKey.startsWith("rotation-") ? `rotation week ${weekKey.slice(9)}` : `week of ${weekKey}`;
    // Only emit for non-focus events — the focus goal's events are the "other side"
    // of the collision, not the conflict recipient. (CRIT-3 fix)
    for (const event of weekEvents.filter((e) => e.goalId !== focusGoalId)) {
      const others = weekEvents.filter((e) => e.goalId !== event.goalId);
      const withDates = [...new Set(others.map((e) => e.dateKey))];
      conflicts.push({
        dateKey: event.dateKey,
        kind: "key-events-same-week",
        withDates,
        goalId: event.goalId,
        goalObjective: event.goalObjective,
        label: `${event.goalObjective}'s ${event.label} shares ${weekLabel} with another goal's key event`,
      });
    }
  }

  // ── Kind 3: event-near-long-effort ────────────────────────────────────────
  // A non-focus goal's target-date event falls within ±N days of:
  //   (a) the focus plan's long-endurance rotation slot in any week, OR
  //   (b) a planned hike date.
  // Label template (a): "{GoalObjective}'s {eventLabel} is {N}d from long-endurance slot on {longKey}"
  // Label template (b): "{GoalObjective}'s {eventLabel} is {N}d from planned hike on {hikeDk}"
  const N = CROSS_GOAL_RULES.raceProximityDays;
  const targetDateEvents = nonFocusEvents.filter((e) => e.type === "target-date");

  for (const event of targetDateEvents) {
    const eventDate = parseDateKey(event.dateKey);
    let matched = false;

    // (a) focus plan long-endurance slots
    if (focusProgram && !matched) {
      const longTmpl = focusProgram.template.weeklySplit.find(
        (d) => d.category === "long-endurance",
      );
      if (longTmpl) {
        const totalDays = focusProgram.template.totalWeeks * 7;
        for (let relDay = longTmpl.dayOfWeek - 1; relDay < totalDays; relDay += 7) {
          const longDate = addDays(focusProgram.startedOn, relDay);
          const longKey = dateKey(longDate);
          const diff = Math.abs(
            Math.floor(
              (startOfDay(eventDate).getTime() - startOfDay(longDate).getTime()) /
                (24 * 3600 * 1000),
            ),
          );
          if (diff > 0 && diff <= N) {
            conflicts.push({
              dateKey: event.dateKey,
              kind: "event-near-long-effort",
              withDates: [longKey],
              goalId: event.goalId,
              goalObjective: event.goalObjective,
              label: `${event.goalObjective}'s ${event.label} is ${diff} day${diff > 1 ? "s" : ""} from a long-endurance slot (${longKey})`,
            });
            matched = true;
            break;
          }
        }
      }
    }

    // (b) planned hikes
    if (!matched) {
      for (const hikeDk of plannedHikeDateKeys) {
        const hikeDate = parseDateKey(hikeDk);
        const diff = Math.abs(
          Math.floor(
            (startOfDay(eventDate).getTime() - startOfDay(hikeDate).getTime()) /
              (24 * 3600 * 1000),
          ),
        );
        if (diff > 0 && diff <= N) {
          conflicts.push({
            dateKey: event.dateKey,
            kind: "event-near-long-effort",
            withDates: [hikeDk],
            goalId: event.goalId,
            goalObjective: event.goalObjective,
            label: `${event.goalObjective}'s ${event.label} is ${diff} day${diff > 1 ? "s" : ""} from a planned hike (${hikeDk})`,
          });
          matched = true;
          break;
        }
      }
    }
  }

  // Deduplicate: one conflict per dateKey, most severe wins.
  const SEVERITY: Record<CrossGoalConflictKind, number> = {
    "event-on-hard-day": 3,
    "event-near-long-effort": 2,
    "key-events-same-week": 1,
  };
  const deduped = new Map<string, CrossGoalConflict>();
  for (const c of conflicts) {
    const existing = deduped.get(c.dateKey);
    if (!existing || SEVERITY[c.kind] > SEVERITY[existing.kind]) {
      deduped.set(c.dateKey, c);
    }
  }

  return [...deduped.values()];
}
```

---

## 4. calendar.ts Surgery Plan

Calendar.ts is modified in **three separate passes**, each gated by `npx tsc --noEmit`:

### Pass 1 (REQ-101): Focus Flips + Null Guards

**Change 1: getCalendarMonth goal query (line 77)**
```typescript
// BEFORE:
prisma.goal.findFirst({
  where: { active: true },
  orderBy: { updatedAt: "desc" },
  select: { id: true, targetDate: true, objective: true, legend: true },
})

// AFTER (focus-scoped):
prisma.goal.findFirst({
  where: { isFocus: true },
  orderBy: { updatedAt: "desc" },
  select: { id: true, targetDate: true, objective: true, legend: true },
})
```

**Change 2: null-targetDate fix at line 132**
```typescript
// BEFORE (crashes when targetDate is null):
const goalKey = goal ? dateKey(goal.targetDate) : null;

// AFTER (null-safe):
const goalKey = goal?.targetDate ? dateKey(goal.targetDate) : null;
```

**Change 3: resolveDay goal query (line 470–474)**
```typescript
// BEFORE:
prisma.goal.findFirst({
  where: { active: true },
  orderBy: { updatedAt: "desc" },
  select: { targetDate: true, objective: true },   // ← missing id!
})

// AFTER (focus-scoped + id added):
prisma.goal.findFirst({
  where: { isFocus: true },
  orderBy: { updatedAt: "desc" },
  select: { id: true, targetDate: true, objective: true },  // ← id added for focusGoalId
})
```

**Change 4: null-targetDate fix in resolveDay (line 602)**
```typescript
// BEFORE (crashes when targetDate is null):
const isGoalDate = !!goal && dateKey(goal.targetDate) === dateKey(date);

// AFTER (null-safe):
const isGoalDate = !!goal && !!goal.targetDate && dateKey(goal.targetDate) === dateKey(date);
```

**Change 5: getPendingNotesCount plan query (line 737)**
```typescript
// BEFORE:
prisma.plan.findFirst({ where: { active: true }, ... })

// AFTER (focus-strict — return 0 when no focus plan exists; CRIT-2 fix):
prisma.plan.findFirst({
  where: { active: true, goal: { isFocus: true } },
  orderBy: { updatedAt: "desc" },
  include: { goal: { select: { id: true } } },
})
// If plan is null → return 0 (no focus plan; silently returning wrong goal's count is worse)
```

### Pass 2 (REQ-103): Type Widening Only

**Change 6: WeekConflict type widening (lines 42–49)**
```typescript
// BEFORE:
export type WeekConflict = {
  dateKey: string;
  kind: "long-effort" | "retest-on-hike";
  withDates: string[];
};

// AFTER (backward-compatible: existing consumers compile unchanged):
export type WeekConflict = {
  dateKey: string;
  kind: "long-effort" | "retest-on-hike" | "event-on-hard-day" | "key-events-same-week" | "event-near-long-effort";
  withDates: string[];
  goalId?: string;    // optional: non-focus goalId when kind is a cross-goal kind
  label?: string;     // optional: human-readable label for cross-goal kinds
};
```

**Change 7: CalendarDayCell.conflict type widening (line 29)**
```typescript
// BEFORE:
conflict: { kind: "long-effort" | "retest-on-hike"; withDates: string[] } | null;

// AFTER (backward-compatible):
conflict: {
  kind: "long-effort" | "retest-on-hike" | "event-on-hard-day" | "key-events-same-week" | "event-near-long-effort";
  withDates: string[];
  goalId?: string;
  label?: string;
} | null;
```

**Change 8: Add otherGoalEvents to CalendarDayCell (after the conflict field)**
```typescript
// ADD after the conflict field:
/** Non-focus active goals' events for this date. Empty when no non-focus events exist. */
otherGoalEvents: GoalEvent[];
```

Add import at top of calendar.ts:
```typescript
import type { GoalEvent } from "@/lib/goal-events";
import type { CrossGoalConflict } from "@/lib/goal-conflicts";
```

### Pass 3 (REQ-104): resolveDay + getCalendarMonth Surgery

**Change 9: ResolvedDay type extension (after the `override?` field)**
```typescript
// ADD to ResolvedDay:
/** Non-focus active goals' events for this date. Default []. */
otherGoalEvents: GoalEvent[];
/** Cross-goal conflicts touching this date. Default []. */
crossGoalConflicts: CrossGoalConflict[];
```

**Change 10: resolveDay signature (line 423)**
```typescript
// BEFORE:
export async function resolveDay(date: Date): Promise<ResolvedDay>

// AFTER (optional ctx eliminates goal-event queries when called from get_week/getCalendarMonth):
export type ResolveDayCtx = {
  /** Pre-fetched events for the range. resolveDay filters to this date's events. */
  goalEvents: GoalEvent[];
  /**
   * Pre-computed cross-goal conflicts for the range. Optional (SUG-3) — when absent,
   * resolveDay computes them inline (pure, no DB). Pass [] to skip computation
   * when you know the range has no conflicts.
   */
  crossGoalConflicts?: CrossGoalConflict[];
  focusGoalId: string | null;
};

export async function resolveDay(date: Date, ctx?: ResolveDayCtx): Promise<ResolvedDay>
```

**Change 11: resolveDay Promise.all (add 7th item, after line 501)**

Add imports at top of resolveDay body:
```typescript
import { getGoalEvents, otherGoalEvents as filterOtherGoalEvents, eventsByDateKey } from "@/lib/goal-events";
import { crossGoalConflicts as computeCrossGoalConflicts } from "@/lib/goal-conflicts";
```

Modify the Promise.all destructuring:
```typescript
const [workouts, override, notesForDate, goal, nutrition, plannedHikesThisWeek, preloadedGoalEvents] =
  await Promise.all([
    // ...existing 6 items unchanged...
    // Item 7: goal events (from ctx if pre-assembled, else fetch for the week window)
    ctx
      ? Promise.resolve(ctx.goalEvents)
      : weekWindow
        ? getGoalEvents({ start: weekWindow.start, end: weekWindow.end })
        : getGoalEvents({
            // DC-2 fix: out-of-plan date (weekWindow===null) — widen to the calendar
            // week ±2 days (raceProximityDays=2) so event-near-long-effort and
            // key-events-same-week fire for get_day calls on dates outside the focus
            // plan window (e.g. a race date set beyond plan.totalWeeks*7).
            // crossGoalConflicts output is filtered to dateKey(date) in the step below.
            // startOfWeekMonday is already exported from this file; no circular dep.
            start: addDays(startOfWeekMonday(date), -2),
            end: addDays(addDays(startOfWeekMonday(date), 6), 2),
          }),
  ]);
```

After the Promise.all, compute the cross-goal fields:
```typescript
const focusGoalId = ctx?.focusGoalId ?? goal?.id ?? null;
const goalEventsForRange = preloadedGoalEvents; // either from ctx or freshly fetched

const otherEventsForDate = filterOtherGoalEvents(
  eventsByDateKey(goalEventsForRange).get(dateKey(date)) ?? [],
  focusGoalId,
);

const cgConflicts: CrossGoalConflict[] = ctx?.crossGoalConflicts !== undefined
  ? ctx.crossGoalConflicts.filter((c) => c.dateKey === dateKey(date))
  : computeCrossGoalConflicts({
      events: goalEventsForRange,
      focusGoalId,
      focusProgram: program,
      plannedHikeDateKeys: plannedHikesThisWeek.map((h) => dateKey(h.date)),
      overrideDateKeys: override?.workoutJson ? [dateKey(date)] : [],
      range: weekWindow ?? { start: dayStart, end: dayEnd },
    }).filter((c) => c.dateKey === dateKey(date));
```

Add to the `return { ... }` object:
```typescript
otherGoalEvents: otherEventsForDate,
crossGoalConflicts: cgConflicts,
```

**Change 12: getCalendarMonth — events + otherGoals + cross-goal conflicts**

Add to the Promise.all (after the `goal` query, as 5th item):
```typescript
getGoalEventsResult({ start: gridStart, end: gridEnd }),
```

Import at top:
```typescript
import { getGoalEventsResult, eventsByDateKey, otherGoalEvents as filterOtherGoalEvents, type GoalEventsResult } from "@/lib/goal-events";
import { crossGoalConflicts as computeCrossGoalConflicts } from "@/lib/goal-conflicts";
```

Destructure:
```typescript
const [workouts, hikes, overrides, goal, goalEventsResult] = await Promise.all([...]);
```

After bucketing, compute cross-goal conflicts for the whole grid:
```typescript
const { events: allGoalEvents, focusGoalId, otherGoalsMeta } = goalEventsResult;
const eventsByKey = eventsByDateKey(allGoalEvents);

// Planned hike dateKeys for event-near-long-effort detection
const plannedHikeDateKeys = hikes
  .filter((h) => h.status === "planned")
  .map((h) => dateKey(h.date));

// Override dateKeys (dates with workoutJson overrides) for suppression
const overrideDateKeys = [...overridesByKey.entries()]
  .filter(([, o]) => o.workoutJson != null)
  .map(([k]) => k);

const crossGoalConflictList = computeCrossGoalConflicts({
  events: allGoalEvents,
  focusGoalId,
  focusProgram: program,
  plannedHikeDateKeys,
  overrideDateKeys,
  range: { start: gridStart, end: gridEnd },
});
const crossGoalConflictsByKey = new Map<string, typeof crossGoalConflictList[number]>();
for (const c of crossGoalConflictList) {
  if (!crossGoalConflictsByKey.has(c.dateKey)) crossGoalConflictsByKey.set(c.dateKey, c);
}
```

Pass to buildCell:
```typescript
const cell = buildCell({
  ...existingArgs,
  otherGoalEventsForDate: filterOtherGoalEvents(
    eventsByKey.get(dateKey(cursor)) ?? [],
    focusGoalId,
  ),
  crossGoalConflictForDate: crossGoalConflictsByKey.get(dateKey(cursor)) ?? null,
});
```

Update buildCell signature:
```typescript
function buildCell(args: {
  // ...existing args...
  otherGoalEventsForDate: GoalEvent[];
  crossGoalConflictForDate: CrossGoalConflict | null;
}): CalendarDayCell
```

In buildCell return, update the `conflict` field:
```typescript
// Same-goal conflicts take precedence (legacy rule).
// Cross-goal conflict fills cell.conflict only when no same-goal conflict exists.
conflict: conflict ?? (args.crossGoalConflictForDate
  ? {
      kind: args.crossGoalConflictForDate.kind,
      withDates: args.crossGoalConflictForDate.withDates,
      goalId: args.crossGoalConflictForDate.goalId,
      label: args.crossGoalConflictForDate.label,
    }
  : null),
otherGoalEvents: args.otherGoalEventsForDate,
```

Update getCalendarMonth return type (additive — existing callers are unaffected):
```typescript
return {
  monthStart,
  monthEnd,
  cells,
  program,
  goal,
  otherGoals: otherGoalsMeta,  // NEW: for CalendarMonth legend card
};
```

---

## 5. Focus-Split Refactor Table

### 5.1 All active:true Call Sites

| File:Line | Current | After REQ-101 |
|-----------|---------|---------------|
| `calendar.ts:78` (getCalendarMonth goal) | `{ active: true }` | `{ isFocus: true }` |
| `calendar.ts:471` (resolveDay goal) | `{ active: true }` | `{ isFocus: true }` |
| `calendar.ts:737` (getPendingNotesCount plan) | `{ active: true }` | **focus-strict**: `where: { active: true, goal: { isFocus: true } }`; return 0 when absent |
| `plan-lint.ts:221` (lintActivePlan) | `{ active: true }` | **focus-strict**: `where: { active: true, goal: { isFocus: true } }`; return null/empty when absent |
| `records.ts:197` (getBaselineSchedule) | `{ active: true }` | **focus-strict** via REQ-102 seam → `getBaselineScheduleForPlan`; return empty schedule when absent |
| `game/engine.ts:932` (computeGameState) | `{ active: true }` | `{ isFocus: true }` |
| `program.ts:28` (getActiveProgram) | `{ active: true }` | **fallback-desired** (only site): `orderBy: [{ goal: { isFocus: "desc" } }, { updatedAt: "desc" }]` |
| `program.ts:41` (Program fallback) | `{ active: true }` | **stays global** (legacy Program table fallback) |
| `goal-core.ts:80,81` (global deactivation) | `updateMany({ data: { active: false } })` | **REMOVE BOTH** |
| `goal-core.ts:96` (new plan active) | `active: true` | **stays** (new plan is always active) |
| `goal-actions.ts:127-133` (setActiveGoal deactivation) | global updateMany | **REFACTOR** → isFocus flip (see §5.2) |
| `app/baselines/new/page.tsx:18` | `{ active: true }` | **focus-strict**: `where: { active: true, goal: { isFocus: true } }`; return empty page state when absent |
| `app/progress/page.tsx:17` | `findMany({ where: { active: true } })` | **stays multi-goal** (all active goals shown) |
| `app/stats/page.tsx:19` | same | **stays multi-goal** |
| `mcp/tools.ts:602` | `{ active: true }` (get_today_plan) | `{ isFocus: true }` |
| `mcp/tools.ts:881` | `{ active: true }` (compute_readiness) | `{ isFocus: true }` |
| `mcp/tools.ts:913` | `{ active: true }` (get_pending_notes plan) | **focus-strict**: `where: { active: true, goal: { isFocus: true } }`; return empty list when absent |
| `mcp/tools.ts:1186` | `{ active: true }` (get_session_brief) | `{ isFocus: true }` |
| `mcp/tools.ts:3826` | `{ active: true }` (acknowledge_lint plan) | **focus-strict**: `where: { active: true, goal: { isFocus: true } }`; return error when absent |
| `mcp/tools.ts:3880` | `{ active: true }` (clear_lint plan) | **focus-strict**: `where: { active: true, goal: { isFocus: true } }`; return error when absent |
| `mcp/tools.ts:3948` | `{ active: true }` (grant_bonus_xp goal) | `{ isFocus: true }` |

**Query patterns — two categories (CRIT-2 + DC-6 fix):**

**Focus-strict** — all lint/ack/baseline/pending-notes sites. Returns null/empty when the focus goal has no active plan (NOT a fallback to another goal's plan):
```typescript
const plan = await prisma.plan.findFirst({
  where: { active: true, goal: { isFocus: true } },
  orderBy: { updatedAt: "desc" },
});
if (!plan) return /* null / 0 / empty / error appropriate for each caller */;
```

**Fallback-desired** — `getActiveProgram` ONLY. Picks focus plan first, falls back to any active plan in one query (transition-safe):
```typescript
orderBy: [{ goal: { isFocus: "desc" } }, { updatedAt: "desc" }]
```

### 5.2 `setFocusGoal` Transaction Body (replaces setActiveGoal)

```typescript
export async function setFocusGoal(id: string) {
  // DC-8: fetch old focus id before transaction so we can revalidate its detail page
  const oldFocus = await prisma.goal.findFirst({ where: { isFocus: true }, select: { id: true } });
  const oldFocusId = oldFocus?.id ?? null;

  await prisma.$transaction(async (tx) => {
    const target = await tx.goal.findUnique({ where: { id }, select: { id: true } });
    if (!target) throw new Error("Goal not found");

    // 1. Clear isFocus on all goals
    await tx.goal.updateMany({ data: { isFocus: false } });

    // 2. Set isFocus + ensure active on the target goal
    //    (a previously untracked goal that receives focus becomes tracked again)
    await tx.goal.update({ where: { id }, data: { isFocus: true, active: true } });

    // 3. Ensure target goal has exactly one active plan (the latest).
    //    OTHER goals' plans are NOT touched — they stay active.
    const latest = await tx.plan.findFirst({
      where: { goalId: id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (latest) {
      await tx.plan.updateMany({
        where: { goalId: id, id: { not: latest.id } },
        data: { active: false },
      });
      await tx.plan.update({ where: { id: latest.id }, data: { active: true } });
    }
    // NOTE: NO global goal/plan deactivation — this is the core invariant change.
  });

  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath("/goals");
  revalidatePath(`/goals/${id}`);
  if (oldFocusId && oldFocusId !== id) revalidatePath(`/goals/${oldFocusId}`);  // DC-8
  revalidatePath("/stats");
  redirect("/calendar");
}
```

### 5.3 `setGoalTracked` Transaction Body (new action)

```typescript
export async function setGoalTracked(id: string, tracked: boolean) {
  await prisma.$transaction(async (tx) => {
    const goal = await tx.goal.findUnique({
      where: { id },
      select: { id: true, isFocus: true },
    });
    if (!goal) throw new Error("Goal not found");
    if (!tracked && goal.isFocus) {
      throw new Error(
        "Cannot untrack the focus goal — switch focus to another goal first.",
      );
    }
    await tx.goal.update({ where: { id }, data: { active: tracked } });
  });

  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath("/goals");
  revalidatePath("/stats");
  // No redirect — stays on /goals (pill action)
}
```

### 5.4 `createGoalCore` Changes

Modify `CreateGoalCoreInput`:
```typescript
export interface CreateGoalCoreInput {
  objective: string;
  targetDate: Date | null;  // null = someday goal (no calendar pin)
  // ...rest unchanged...
}
```

In function body:
1. Change guard: `if (targetDate !== null && Number.isNaN(targetDate.getTime())) throw new Error("invalid targetDate")`
2. Change weeks/endsOn calculation:
   ```typescript
   const now = new Date();
   const weeks = targetDate ? weeksBetween(now, targetDate) : 12;
   const endsOn = targetDate ?? addDays(now, 84);  // addDays from @/lib/calendar
   ```
   Add import: `import { addDays } from "@/lib/calendar";`
3. Remove BOTH `updateMany` lines (lines 80–81)
4. Inside the transaction, before `tx.goal.create`, add focus check:
   ```typescript
   const existingFocusCount = await tx.goal.count({ where: { isFocus: true } });
   const shouldBecomeFocus = existingFocusCount === 0;
   ```
5. In `tx.goal.create.data`, add: `isFocus: shouldBecomeFocus`
6. Plan name: `${objective} — ${weeks}-week plan`
7. Plan create uses `endsOn` (already computed)

### 5.5 `createGoal` and `updateGoal` Action Changes

Both actions in `goal-actions.ts`:

**createGoal:**
- Remove: `if (!targetDateStr) throw new Error("Target date is required")`
- Change: `const targetDate = targetDateStr ? parseDateKey(targetDateStr) : null;`
- Remove NaN guard when targetDate is null: `if (targetDate !== null && Number.isNaN(targetDate.getTime())) throw new Error("Invalid target date")`
- Pass `targetDate` (possibly null) to `createGoalCore`
- Add `/` to revalidatePath calls (Today page needs to know about new goals)

**updateGoal:**
- Same removal of required guard and null-safe parsing
- `prisma.goal.update` data: `targetDate: targetDate` (null clears it)

---

## 6. MCP Tool Surface

### 6.1 Exact Modified Tool List with New Strings

**`list_goals`**

New description:
```
"Show every training goal — active and inactive — with focus flag, tracking status, target date, status, and target count. active=true means the goal is tracked and contributes events to the calendar and Today strip; isFocus=true means this goal's plan drives the daily prescription (exactly one should be true at a time). targetDate=null indicates a someday goal (no calendar pin, no countdown). Use to discover which goal is in focus, list all tracked goals with their target dates, or find someday goals. Pair with get_goal for full detail."
```

New query (orderBy):
```typescript
orderBy: [
  { isFocus: "desc" },
  { active: "desc" },
  { targetDate: { sort: "asc", nulls: "last" } },
]
```

New output shape additions (per row): `isFocus: g.isFocus`

**`get_today_plan`** (tools.ts ~line 570)

Goal query: change `where: { active: true }` to `where: { isFocus: true }`.

In the return shape, rename `activeGoal` to `focusGoal` AND keep `activeGoal` as a duplicate:
```typescript
return {
  ...r,
  standingRules,
  focusGoal: activeGoal,         // NEW name
  activeGoal: activeGoal,        // KEPT for one release (saved-prompt compatibility)
  // r already contains otherGoalEvents and crossGoalConflicts after REQ-104
};
```

Description addition: "focusGoal is the goal whose plan drives today's prescription; other active goals' events appear in r.otherGoalEvents."

**`get_day`**

After REQ-104, `resolveDay` returns `otherGoalEvents` and `crossGoalConflicts` — no extra work needed. Description addition: "otherGoalEvents contains target dates, retest checkpoints, and planned hikes for non-focus active goals. crossGoalConflicts surfaces collision kinds."

**`get_week`**

Pre-assemble ctx for the week, then pass to each resolveDay:

```typescript
// After computing weekStart and the 7 dates:
const weekEnd = addDays(weekStart, 6);
const eventsResult = await getGoalEventsResult({ start: weekStart, end: endOfDay(weekEnd) });
const plannedHikeDks = eventsResult.events
  .filter((e) => e.type === "planned-hike")
  .map((e) => e.dateKey);
// MR-3 ACCEPTED: override suppression skipped in get_week for performance.
// PRD §4.6 says overrides suppress event-on-hard-day; adding the override query
// here would add a 4th DB round-trip per get_week call. Accepted PRD deviation:
// conflicts near overridden days may still appear in get_week MCP responses.
const overrideDks: string[] = [];
const conflicts = crossGoalConflicts({
  events: eventsResult.events,
  focusGoalId: eventsResult.focusGoalId,
  focusProgram: program,
  plannedHikeDateKeys: plannedHikeDks,
  overrideDateKeys: overrideDks,
  range: { start: weekStart, end: weekEnd },
});
const ctx: ResolveDayCtx = {
  goalEvents: eventsResult.events,
  crossGoalConflicts: conflicts,
  focusGoalId: eventsResult.focusGoalId,
};

const days = await Promise.all(
  [0, 1, 2, 3, 4, 5, 6].map((i) => resolveDay(addDays(weekStart, i), ctx)),
);

return {
  weekIndex: wi,
  startDate: toDateKey(weekStart),
  endDate: toDateKey(addDays(weekStart, 6)),
  totalWeeks: program.template.totalWeeks,
  days,
  // NEW top-level arrays:
  otherGoalEvents: eventsResult.events.filter((e) => !e.isFocusGoal),
  crossGoalConflicts: conflicts,
};
```

Import additions for tools.ts: `getGoalEventsResult` from `@/lib/goal-events`; `crossGoalConflicts` from `@/lib/goal-conflicts`; `ResolveDayCtx` from `@/lib/calendar`; `endOfDay` already imported.

**`get_session_brief`** (tools.ts ~line 1185)

Goal query: `where: { isFocus: true }`.

New section after the existing `goal` block:
```typescript
// Other active goals (30-day next-event window)
const thirtyDayEnd = addDays(startOfDay(now), 30);
const otherGoalsResult = await getGoalEventsResult({ start: now, end: thirtyDayEnd });
const otherActiveGoals = otherGoalsResult.otherGoalsMeta.map((meta) => {
  const nextEvent = otherGoalsResult.events
    .filter((e) => e.goalId === meta.id)
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey))[0] ?? null;
  const daysToGo = meta.targetDate
    ? Math.round(
        (startOfDay(meta.targetDate).getTime() - startOfDay(now).getTime()) / MS_PER_DAY,
      )
    : null;
  return {
    id: meta.id,
    objective: meta.objective,
    targetDate: meta.targetDate ? toDateKey(meta.targetDate) : null,
    daysToGo,
    nextEvent: nextEvent
      ? { dateKey: nextEvent.dateKey, type: nextEvent.type, label: nextEvent.label }
      : null,
  };
});
```

`currentWeekConflicts`: merge same-goal weekConflicts + cross-goal conflicts for the current rotation week:
```typescript
// CRIT-4 fix: filter to current week's dateKeys before calling crossGoalConflicts.
// The 30-day otherGoalsResult is still used above for otherActiveGoals.nextEvent.
const weekStartDk = toDateKey(weekStart);
const weekEndDk = toDateKey(addDays(weekStart, 6));
const weekEvents = otherGoalsResult.events.filter(
  (e) => e.dateKey >= weekStartDk && e.dateKey <= weekEndDk,
);
const weekCgConflicts = weekEvents.length > 0
  ? crossGoalConflicts({
      events: weekEvents,
      focusGoalId: otherGoalsResult.focusGoalId,
      focusProgram: program ?? null,
      plannedHikeDateKeys: [],
      range: weekWindow,
    })
  : [];
const mergedWeekConflicts = [...(sameGoalWeekConflicts), ...weekCgConflicts];
```

Return additions: `otherActiveGoals`, `currentWeekConflicts: mergedWeekConflicts`.

**`compute_readiness`**

Fallback query: `{ isFocus: true }` instead of `{ active: true }`. Error message: "No focused goal found — pass goalId, or set a goal to focus first."

**`create_goal`**

New description:
```
"Create a new Goal and scaffold its Plan + initial PlanRevision in one nested write. The new goal does NOT automatically become the focus goal unless no other focused goal currently exists — use set_focus_goal to explicitly switch focus. Pass `legend` inline to set goal-flavor iconography in the same call. `targetDate` is optional — omit for a someday goal (no calendar pin, no plan end date; defaults to a 12-week plan). `copyFromGoalId` copies the targets array from any existing goal. If you receive an unclear response, call list_goals BEFORE retrying — duplicates are not auto-prevented."
```

New inputSchema change:
```typescript
targetDate: DateKeyShape.optional().describe(
  "Goal target date (yyyy-mm-dd, USER_TZ midnight). Omit to create a someday goal with no calendar pin.",
),
```

Handler: pass `targetDate: parsedDate ?? null` to `createGoalCore`.

**`update_goal`**

New inputSchema for targetDate:
```typescript
targetDate: DateKeyShape.optional().describe(
  "New target date (yyyy-mm-dd) or omit to leave unchanged. To clear a target date (make someday), pass targetDate: null — wait, Zod optional doesn't express null directly; use a separate `clearTargetDate: true` flag OR check PRD for the clearing mechanism."
),
```

NOTE: Zod optional() means "omit = no change". To clear targetDate, we need explicit null support. Use `.nullable()`:
```typescript
targetDate: DateKeyShape.nullable().optional().describe(
  "New target date yyyy-mm-dd, null to clear (make this a someday goal), or omit to leave unchanged.",
),
```

In handler: `if (input.targetDate !== undefined) { data.targetDate = input.targetDate ? parseDateInput(input.targetDate) : null; }`

**`log_hike`**

New inputSchema field:
```typescript
goalId: z
  .string()
  .optional()
  .describe(
    "Which goal this hike trains (use list_goals to find goal ids). Omit to attribute to the current focus goal. Stored permanently on the hike row — affects calendar markers and goal-level readiness.",
  ),
```

Idempotency check change — scope to goalId:
```typescript
// BEFORE (global per-day):
prisma.hike.findFirst({ where: { status: "planned", date: { gte: ..., lte: ... } } })

// AFTER (scoped to resolved goalId):
const resolvedGoalId = input.goalId ?? focusGoalId; // focusGoalId fetched before if goalId omitted
prisma.hike.findFirst({
  where: {
    status: "planned",
    date: { gte: startOfDay(hikeDate), lte: endOfDay(hikeDate) },
    goalId: resolvedGoalId, // null = focus; match on null explicitly
  },
})
```

Validation before use:
```typescript
let resolvedGoalId: string | null = null;
if (input.goalId) {
  const targetGoal = await prisma.goal.findUnique({
    where: { id: input.goalId },
    select: { id: true, active: true },
  });
  if (!targetGoal) throw new Error(`Goal "${input.goalId}" not found.`);
  if (!targetGoal.active) throw new Error(`Goal "${input.goalId}" is not tracked (active=false). Activate it before logging hikes against it.`);
  resolvedGoalId = input.goalId;
} else {
  const focusGoal = await prisma.goal.findFirst({ where: { isFocus: true }, select: { id: true } });
  resolvedGoalId = focusGoal?.id ?? null;
}
```

Create new hike row: `data: { ..., goalId: resolvedGoalId ?? undefined }`

**`list_planned_hikes`**

Query: add `goalId: true` to select. For each goal attribution:
```typescript
// After rows query, batch-fetch goal objectives for non-null goalIds
const goalIds = [...new Set(rows.map((h) => h.goalId).filter(Boolean) as string[])];
const goalsById = goalIds.length > 0
  ? Object.fromEntries(
      (await prisma.goal.findMany({ where: { id: { in: goalIds } }, select: { id: true, objective: true } }))
        .map((g) => [g.id, g.objective]),
    )
  : {};
```

Output addition per hike:
```typescript
goalId: h.goalId ?? null,
goalObjective: h.goalId ? (goalsById[h.goalId] ?? null) : "focus goal (attribution at read time)",
```

**`delete_goal`**

Description addition: "Hikes logged against this goal (goalId = this goal's id) survive the delete — their goalId is nulled out by the database (onDelete: SetNull). They are re-attributed to the focus goal at read time."

**`grant_bonus_xp`**, **`acknowledge_lint_finding`**, **`clear_lint_acknowledgement`**, **`get_pending_notes`**

Goal queries: `{ active: true }` → `{ isFocus: true }`.
Plan queries: add `orderBy: [{ goal: { isFocus: "desc" } }, { updatedAt: "desc" }]`.

### 6.2 Server Instructions (src/app/api/mcp/route.ts:27-29)

Replace the `instructions` string:
```typescript
instructions:
  "Workout coaching MCP for one user. Exactly one goal has isFocus=true (drives the daily prescription); other active goals stay visible — their events (target dates, retest checkpoints, planned hikes, scheduled items) and cross-goal conflicts surface in get_today_plan/get_day/get_week/get_session_brief. " +
  "Use read tools to gather context (get_today_plan/recent_history/get_goal) before proposing plan changes. " +
  "apply_plan_revision writes a full snapshot — include cascading edits in the snapshot, capture reasoning. " +
  "apply_day_override is for single-day swaps without revising the full plan.",
```

---

## 7. Component Hierarchy for UI REQs (105, 106)

### 7.1 REQ-105: Goals Page

**`src/app/goals/page.tsx`** — server component (no `"use client"`)

Data changes:
- Import `setFocusGoal`, `setGoalTracked` from `@/lib/goal-actions`
- Query: `prisma.goal.findMany({ orderBy: [{ isFocus: "desc" }, { active: "desc" }, { targetDate: { sort: "asc", nulls: "last" } }] })`
- `focusedId`: `goals.find((g) => g.isFocus)?.id ?? null`
- `goalProgress` function: add early return `if (!g.targetDate) return g.status === "achieved" ? 1 : 0;`
- `copySources`: `g.targetDate?.toISOString() ?? ""`

Per-row structural changes:
```tsx
// Focus badge: "Focus" replaces "Active"
{isFocused && (
  <span className="ml-2 text-[10px] uppercase tracking-wide rounded-full border border-[var(--accent)] text-[var(--accent)] px-1.5 py-0.5 align-middle">
    Focus  {/* WAS: "Active" */}
  </span>
)}

// Days pill / Someday chip
{g.targetDate ? (
  <span className={`text-xs rounded-full px-2 py-0.5 border ${...colorLogic...}`}>
    {days < 0 ? `${-days}d ago` : `${days}d`}
  </span>
) : (
  <span className="text-xs rounded-full px-2 py-0.5 border border-[var(--muted)]/40 text-[var(--muted)]">
    Someday
  </span>
)}

// Track/Untrack pill (hidden on the focus row; shown on all other rows)
{!isFocused && (
  <form action={g.active ? untrack : track}>  {/* setGoalTracked.bind(null, g.id, !g.active) */}
    <button
      type="submit"
      className="text-xs rounded-full border border-[var(--border)] px-2 py-0.5 min-h-[44px] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent)]"
    >
      {g.active ? "Untrack" : "Track"}
    </button>
  </form>
)}

// Untracked rows: dimmed styling [UXR — exact opacity/treatment from research report]
<li key={g.id} className={`flex items-start gap-3 py-3 ${!g.active && !isFocused ? "opacity-50" : ""}`}>
```

**`src/app/goals/[id]/page.tsx`** — null guards + optional date field

- Line ~91 (CopySource): `g.targetDate?.toISOString() ?? ""`
- Line ~98: `const daysOut = goal.targetDate ? Math.ceil((new Date(goal.targetDate).getTime() - nowMs) / MS_PER_DAY) : null;`
- Line ~109: `{goal.targetDate ? new Date(goal.targetDate).toLocaleDateString() : "Someday"}`
- Line ~120 (GoalEditForm defaultValue): `goal.targetDate ? new Date(goal.targetDate).toISOString().slice(0, 10) : ""`
- GoalEditForm: `<input type="date" name="targetDate" defaultValue={...} />` — remove `required` attribute

**`src/components/GoalCreateForm.tsx`** (client component):
- `<input type="date" name="targetDate" />` — remove `required` attribute
- Label: "Target date (optional — leave blank for a someday goal)"

**`src/components/GoalEditForm.tsx`** (client component):
- Same: remove `required` from date input
- Label update

### 7.2 REQ-106: Calendar / Today / Day-page UI

**`src/components/OtherGoalsStrip.tsx`** — NEW server component

```typescript
// Server component. Renders nothing (not even a wrapper div) when empty.
// Placed between CharacterHeader and the hero card on Today.

import { getGoalEventsResult } from "@/lib/goal-events";
import { crossGoalConflicts } from "@/lib/goal-conflicts";
import { startOfDay, addDays } from "@/lib/calendar";

type Props = {
  events: GoalEvent[];   // pre-fetched by Today page, filtered to non-focus + 7d window
  conflicts: CrossGoalConflict[];
};

export function OtherGoalsStrip({ events, conflicts }: Props) {
  const nonFocusEvents = events.filter((e) => !e.isFocusGoal);
  if (nonFocusEvents.length === 0) return null;

  // Group: today's events + this-week (days 1–6)
  const [today, thisWeek] = partition(nonFocusEvents, (e) => /* dateKey === today */);
  const conflictsToday = conflicts; // already scoped to 7-day range

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 space-y-1 text-sm">
      {today.map((e) => (
        <p key={`${e.goalId}-${e.dateKey}`} className="font-medium">
          <span className="mr-1">{e.icon}</span>
          <strong>Also today:</strong> {e.label} — {e.goalObjective}
        </p>
      ))}
      {thisWeek.map((e) => (
        <p key={`${e.goalId}-${e.dateKey}`} className="text-[var(--muted)]">
          <span className="mr-1">{e.icon}</span>
          This week ({e.dateKey}): {e.label} — {e.goalObjective}
        </p>
      ))}
      {conflictsToday.length > 0 && (
        <p className="text-[var(--warning)] text-xs">
          Conflict: {conflictsToday[0]!.label}
        </p>
      )}
    </div>
  );
}
```

Props: `{ events: GoalEvent[], conflicts: CrossGoalConflict[] }` — data fetched by the Today page (server parent).

**`src/app/page.tsx`** — Today page changes

DC-3 fix: pre-fetch `getGoalEventsResult` BEFORE `resolveDay`, then pass ctx to avoid a duplicate 3-query event fetch (saves 3 queries per Today page load):

```typescript
// Step 1: first parallel batch — does NOT include resolveDay (which would dup-fetch events)
const [sevenDayGoalEventsResult, program, ...otherPageData] = await Promise.all([
  getGoalEventsResult({ start: startOfDay(now), end: addDays(startOfDay(now), 6) }),
  getActiveProgram(),
  // ...other queries that don't depend on resolveDay...
]);

// Step 2: compute cross-goal conflicts (pure, no DB)
const sevenDayConflicts = crossGoalConflicts({
  events: sevenDayGoalEventsResult.events,
  focusGoalId: sevenDayGoalEventsResult.focusGoalId,
  focusProgram: program,
  plannedHikeDateKeys: sevenDayGoalEventsResult.events
    .filter((e) => e.type === "planned-hike")
    .map((e) => e.dateKey),
  range: { start: startOfDay(now), end: addDays(startOfDay(now), 6) },
});

// Step 3: call resolveDay with ctx — zero extra goal-event queries (DC-3 fix)
const ctx: ResolveDayCtx = {
  goalEvents: sevenDayGoalEventsResult.events,
  crossGoalConflicts: sevenDayConflicts,
  focusGoalId: sevenDayGoalEventsResult.focusGoalId,
};
const r = await resolveDay(now, ctx);
```

Import `ResolveDayCtx` from `@/lib/calendar`. Total goal-event queries on Today load: **3** (was 6 without ctx).

Insert `OtherGoalsStrip` between CharacterHeader and hero card:
```tsx
<CharacterHeader ... />
<OtherGoalsStrip
  events={sevenDayGoalEventsResult.events}
  conflicts={sevenDayConflicts}
/>
{/* existing hero card */}
```

**`src/app/days/[dateKey]/page.tsx`** — Day-page banners

After `const r = await resolveDay(date)`:

Target-date banner (ABOVE the `<header>` section):
```tsx
{r.otherGoalEvents.some((e) => e.type === "target-date") && (
  // [UXR] — visual treatment (border color, icon size, font weight) from docs/ux-research/multigoal-phase1-awareness.md
  <div className="rounded-lg border-2 border-[var(--target,var(--accent))] bg-[var(--card)] p-3 space-y-0.5">
    {r.otherGoalEvents
      .filter((e) => e.type === "target-date")
      .map((e) => (
        <p key={e.goalId} className="font-semibold">
          <span className="mr-1">{e.icon}</span>
          {e.label} — {e.goalObjective}
        </p>
      ))}
  </div>
)}
```

Other event types (in header `<p>` below the plan line):
```tsx
{r.otherGoalEvents
  .filter((e) => e.type !== "target-date")
  .map((e) => (
    <span key={`${e.goalId}-${e.type}`} className="text-[var(--muted)]">
      {/* [UXR] — exact styling from research report */}
      {e.icon} {e.label} — {e.goalObjective} ·{" "}
    </span>
  ))}
```

Cross-goal conflict banner (after header, before prescription):
```tsx
{r.crossGoalConflicts.length > 0 && (
  // [UXR] — visual treatment from research report
  <div className="rounded-lg border border-[var(--warning)]/40 bg-[var(--card)] p-3">
    {r.crossGoalConflicts.map((c) => (
      <p key={c.dateKey} className="text-sm text-[var(--warning)]">
        ⚠ {c.label}
      </p>
    ))}
  </div>
)}
```

**`src/components/CalendarMonth.tsx`** — Foreign-goal markers + legend + DayDetail rows

Component signature additions:
```typescript
export function CalendarMonth({
  cells,
  monthKey,
  legend,
  confirmedThroughDate,
  otherGoals,    // NEW: for legend card
}: {
  cells: CalendarDayCell[];
  monthKey: string;
  legend: readonly LegendEntry[];
  confirmedThroughDate?: Date | null;
  otherGoals?: OtherGoalMeta[];  // NEW; import type from @/lib/goal-events
})
```

DayCell — foreign-goal markers in the marker row:
```tsx
{/* Focus-goal markers (existing) */}
{markers.map((m) => <MarkerIcon key={m.entry.kind} entry={m.entry} size={13} />)}

{/* Foreign-goal markers — [UXR] visual distinction from focus markers */}
{(cell.otherGoalEvents ?? []).slice(0, 2).map((e) => (
  // [UXR] — ring/chip/opacity treatment from docs/ux-research/multigoal-phase1-awareness.md
  <span
    key={`${e.goalId}-${e.type}`}
    title={`${e.label} — ${e.goalObjective}`}
    className="text-[11px] opacity-70 ring-1 ring-[var(--muted)] rounded-sm px-0.5"
    // [UXR] exact styling decision point
  >
    {e.icon}
  </span>
))}
{/* Overflow indicator when > 2 non-focus events */}
{(cell.otherGoalEvents ?? []).length > 2 && (
  <span className="text-[9px] text-[var(--muted)]">+{(cell.otherGoalEvents ?? []).length - 2}</span>
)}
```

DayDetail panel — other-goal event rows + conflict label:
```tsx
{/* Other goals events */}
{(cell.otherGoalEvents ?? []).length > 0 && (
  <ul className="space-y-0.5">
    {(cell.otherGoalEvents ?? []).map((e) => (
      <li key={`${e.goalId}-${e.type}`} className="text-xs text-[var(--muted)]">
        {e.icon} {e.label} — {e.goalObjective}
      </li>
    ))}
  </ul>
)}

{/* Cross-goal conflict — sourced from cell.conflict when kind is a cross-goal kind */}
{cell.conflict && ["event-on-hard-day", "key-events-same-week", "event-near-long-effort"].includes(cell.conflict.kind) && (
  <p className="text-xs text-[var(--warning)]">
    ⚠ {cell.conflict.label ?? cell.conflict.kind}
  </p>
)}
```

aria-label extension in DayCell:
```typescript
const ariaLabel = [
  cell.dateKey,
  cell.dayTitle ? `— ${cell.dayTitle}` : "",
  cell.confidence && cell.confidence !== "past" ? `· ${cell.confidence}` : "",
  cell.conflict ? `· conflict: ${cell.conflict.label ?? cell.conflict.kind}` : "",
  // Append non-focus event labels for screen reader context
  ...(cell.otherGoalEvents ?? []).map((e) => `· ${e.label}: ${e.goalObjective}`),
]
  .filter(Boolean)
  .join(" ");
```

Legend card — "Other goals" section (below existing legend items):
```tsx
{otherGoals && otherGoals.length > 0 && (
  <div className="mt-3 pt-3 border-t border-[var(--border)]">
    <p className="text-xs font-medium text-[var(--muted)] mb-1">Other goals</p>
    {otherGoals.map((g) => (
      <div key={g.id} className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
        <span>{g.goalDateIcon}</span>
        <span>{g.goalDateLabel} — {g.objective}</span>
        {g.targetDate && (
          <span className="ml-auto text-[10px]">
            {new Date(g.targetDate).toLocaleDateString()}
          </span>
        )}
        {!g.targetDate && (
          <span className="ml-auto text-[10px]">Someday</span>
        )}
      </div>
    ))}
  </div>
)}
```

**`src/app/calendar/page.tsx`** — Pass otherGoals + null guard

Destructure from getCalendarMonth:
```typescript
const { monthStart, monthEnd, cells, program, goal, otherGoals } = await getCalendarMonth({ year, month });
```

Null guard (REQ-101):
```typescript
// BEFORE (line ~103):
new Date(goal.targetDate).toLocaleDateString()
// AFTER:
goal?.targetDate ? new Date(goal.targetDate).toLocaleDateString() : null
```

Pass `otherGoals` to CalendarMonth:
```tsx
<CalendarMonth
  cells={cells}
  monthKey={...}
  legend={legend}
  confirmedThroughDate={program?.confirmedThroughDate}
  otherGoals={otherGoals}
/>
```

**[UXR] Decision Points in Calendar/Day Components**

The following visual treatments are marked `[UXR]` and MUST be resolved from `docs/ux-research/multigoal-phase1-awareness.md` before the developer finalizes the component:

1. Foreign-goal marker distinction in DayCell (ring style vs chip vs opacity)
2. Marker cap/overflow behavior (N=2 max + "+N" vs different cap)
3. Target-date banner card on day page (border-color token, icon prominence)
4. OtherGoalsStrip typography/spacing on Today page
5. Conflict banner styling (border vs background, warning token shade)
6. Untracked-goal row dimming on /goals (exact opacity value)

---

## 8. Data Flow Diagrams

### 8.1 Today Page Render

```
HomePage (server component)
  │
  ├─ Promise.all batch 1 (parallel):
  │    ├─ getGoalEventsResult({now..+6d})   ← 3 queries (goals+plans, hikes, scheduledItems)
  │    ├─ getActiveProgram()                ← focus-scoped (Tier 1: isFocus plan)
  │    └─ ...other page queries (NOT resolveDay)...
  │
  ├─ crossGoalConflicts(...)                ← pure, no DB (uses batch-1 results)
  │
  ├─ resolveDay(now, ctx)                   ← ctx pre-assembled; ZERO extra goal-event queries (DC-3)
  │    └─ ctx.crossGoalConflicts already computed above; filters to dateKey(now)
  │
  ├─ <CharacterHeader> (existing)
  ├─ <OtherGoalsStrip events={sevenDayGoalEventsResult.events} conflicts={sevenDayConflicts} />
  │    → renders null when no non-focus events in 7 days
  └─ hero card / QuestCard (existing)
```
Total goal-event queries on Today page load: **3** (was 6 before DC-3 fix).

### 8.2 Calendar Month Render

```
CalendarPage (server component)
  │
  └─ getCalendarMonth({ year, month })
       ├─ getActiveProgram()
       └─ Promise.all([
            prisma.workout.findMany(...),            ← existing
            prisma.hike.findMany(...),               ← existing
            prisma.planDayOverride.findMany(...),    ← existing
            prisma.goal.findFirst({ isFocus:true }), ← existing (focus-scoped)
            getGoalEventsResult({ gridStart, gridEnd }) ← NEW: 3 queries
          ])
       │
       ├─ crossGoalConflicts(...) ← pure, no DB
       └─ buildCell(×42) ← each receives otherGoalEventsForDate + crossGoalConflictForDate
       └─ returns { cells, program, goal, otherGoals }

CalendarMonth (client component)
  Props: { cells, monthKey, legend, confirmedThroughDate, otherGoals }
  ├─ DayCell (×42): renders focus markers + [UXR] foreign-goal markers + conflict wedge
  ├─ DayDetail panel: renders other-goal event rows + cross-goal conflict label
  └─ Legend card: focus-goal legend + "Other goals" section
```

### 8.3 get_week MCP Call

```
get_week(startDate?)
  │
  ├─ getActiveProgram()              ← focus-scoped
  ├─ compute weekIndex + weekStart
  ├─ getGoalEventsResult(weekRange)  ← 3 queries (goals+plans, hikes, items)
  ├─ crossGoalConflicts(...)         ← pure
  └─ Promise.all × 7: resolveDay(day, ctx)  ← ctx: {goalEvents, crossGoalConflicts, focusGoalId}
       └─ each resolveDay: ZERO extra goal-event queries (ctx pre-assembled)
  │
  return {
    weekIndex, startDate, endDate, totalWeeks,
    days: ResolvedDay[7],            ← each with otherGoalEvents + crossGoalConflicts
    otherGoalEvents: GoalEvent[],   ← top-level for coach convenience
    crossGoalConflicts: CrossGoalConflict[],
  }
```

### 8.4 setFocusGoal Server Action

```
setFocusGoal(id)
  │
  └─ prisma.$transaction:
       1. findUnique(id) — guard: goal exists
       2. goal.updateMany({ data: { isFocus: false } }) — clear all
       3. goal.update(id, { isFocus: true, active: true }) — set target
       4. plan.findFirst(goalId=id, latest) — find latest plan
       5. plan.updateMany(goalId=id, not latest, { active: false }) — deactivate older plans
       6. plan.update(latest, { active: true }) — activate latest
       (NO other goals' plans are touched)
  │
  ├─ revalidatePath("/")
  ├─ revalidatePath("/calendar")
  ├─ revalidatePath("/goals")
  ├─ revalidatePath("/goals/${id}")
  ├─ revalidatePath("/stats")
  └─ redirect("/calendar")
```

---

## 9. Work Streams

### 9.1 File Conflict Analysis

| File | Touched by REQs | Serialization required? |
|------|----------------|------------------------|
| `calendar.ts` | 101, 103, 104 | YES — 3 sequential passes (cannot parallelize) |
| `mcp/tools.ts` | 101, 107 | YES — 101 focus fallbacks, then 107 full parity |
| `goals/page.tsx` | 101, 105 | YES — 101 query/null, then 105 UI (or combined in 105 agent) |
| `records.ts` | 102 only | No conflict |
| `goal-actions.ts` | 101 only | No conflict |
| `goal-core.ts` | 101 only | No conflict |
| `CalendarMonth.tsx` | 106 only | No conflict |

### 9.2 Wave Assignment

**Wave 1 — Gate (sequential, single agent, must complete first)**

Agent: **Alpha**  
REQ: **101** (all call-site flips, schema, migration, goal-focus.ts)

Files: prisma/schema.prisma, migration.sql, src/lib/goal-focus.ts, src/lib/program.ts, src/lib/goal-core.ts, src/lib/goal-actions.ts, src/lib/calendar.ts (Pass 1 only), src/lib/plan-lint.ts, src/lib/game/engine.ts, src/lib/mcp/tools.ts (Pass 1: focus fallbacks only, ~9 sites), src/app/goals/page.tsx (query + null guards only), src/app/goals/[id]/page.tsx (null guards only), src/app/progress/page.tsx, src/app/stats/page.tsx, src/app/calendar/page.tsx (null guard only), src/app/baselines/new/page.tsx

Gate: `npx tsc --noEmit` must be clean before Wave 2 starts.

**Wave 2 — Parallel (after Wave 1 passes tsc)**

Agent: **Beta** (REQ-102)  
Files: src/lib/records.ts (baselineCheckpointDates + getBaselineScheduleForPlan), src/lib/goal-events.ts (new)

Agent: **Gamma** (REQ-105)  
Files: src/app/goals/page.tsx (Focus badge, Track/Untrack, Someday chip — UI additions on top of 101's query changes), src/app/goals/[id]/page.tsx (optional date input), src/components/GoalCreateForm.tsx (remove required), src/components/GoalEditForm.tsx (remove required)

Both agents work independently — no file conflicts.

**Wave 3 — Sequential (after Beta completes)**

Agent: **Delta** (REQ-103)  
Files: src/lib/goal-conflicts.ts (new), src/lib/calendar.ts (Pass 2: type widening only)

Gate: `npx tsc --noEmit`. Confirm existing `weekConflicts` consumers compile unchanged.

**Wave 4 — Sequential (after Delta)**

Agent: **Epsilon** (REQ-104)  
Files: src/lib/calendar.ts (Pass 3: resolveDay + getCalendarMonth surgery)

Gate: `npx tsc --noEmit`. Confirm resolveDay with no ctx returns same shape as before for existing tests.

**Wave 5 — Parallel (after Epsilon)**

Agent: **Zeta** (REQ-106)  
Files: src/components/CalendarMonth.tsx, src/components/OtherGoalsStrip.tsx (new), src/app/page.tsx, src/app/calendar/page.tsx (pass otherGoals prop), src/app/days/[dateKey]/page.tsx

**Must read docs/ux-research/multigoal-phase1-awareness.md before implementing [UXR] decision points.**

Agent: **Eta** (REQ-107)  
Files: src/lib/mcp/tools.ts (Pass 2: full MCP parity), src/app/api/mcp/route.ts (server instructions)

Both agents work independently — no file conflicts.

**Final Gate**: `npx tsc --noEmit && npm run lint && npm run build` + MCP curl smoke per PRD §10.2 + browser smoke per PRD §10.3.

### 9.3 Work Stream Summary

```
Wave 1:  [Alpha: REQ-101 — schema + all call-site flips]
           ↓
Wave 2:  [Beta: REQ-102] || [Gamma: REQ-105]
           ↓ (Beta complete)
Wave 3:  [Delta: REQ-103]
           ↓
Wave 4:  [Epsilon: REQ-104]
           ↓
Wave 5:  [Zeta: REQ-106] || [Eta: REQ-107]
           ↓
        FINAL GATE
```

Estimated waves: 5. Calendar.ts is the critical path serialization bottleneck (3 of the 4 sequential barriers involve it). Agent assignments avoid simultaneous file edits on all serialized files.

---

## 10. Critical Decisions

### 10.1 `isFocus` as a Boolean Column vs. a Singleton Settings Row

**Decision**: Boolean column on Goal (`Goal.isFocus`) with `@@index([isFocus])`.

**Reasoning**: 
- The existing `Goal.active` is a boolean column — using the same pattern is consistent and self-documenting.
- A settings singleton adds a join on every plan resolution; the boolean column is a direct filter.
- The "deterministic winner on multiple `isFocus=true`" edge case is handled identically to how `active=true` was handled before this PR — `findFirst(orderBy: updatedAt: desc)`.
- Rejected: settings table, JSON-encoded singleton in Program table.

### 10.2 `Hike.goalId` Nullable FK with `onDelete: SetNull` (Not Cascade)

**Decision**: Nullable FK with `onDelete: SetNull`. A hike with `goalId = null` means "focus goal at read time."

**Reasoning**:
- The existing `delete_goal` description says hikes survive goal deletion. `SetNull` preserves this contract without any application code change.
- `Cascade` would silently delete user training data, which is unacceptable.
- The null-meaning-focus interpretation is explicit (comment required in `getGoalEvents`).
- This is a **read-time attribution** semantic, not write-time. No backfill needed on existing hikes.

### 10.3 `crossGoalConflicts` is Pure (No DB)

**Decision**: `goal-conflicts.ts` has no DB import and no async. All data is pre-fetched by callers.

**Reasoning**:
- Separation of concerns: DB logic in `getGoalEvents`; pure conflict detection in `goal-conflicts.ts`.
- Enables `resolveDay` to compute conflicts inline (using already-fetched planned hikes + program snapshot).
- Enables callers like `get_week` to compute conflicts once for the whole range and pass via ctx.
- Enables unit-testing the conflict logic without a DB fixture.

### 10.4 `calisthenics` is a Hard Category

**Decision**: `CROSS_GOAL_RULES.hardCategories = ["upper", "lower", "calisthenics", "lower-power"]`.

**Reasoning**:
- PRD note says `[/* non-rest, non-zone2 */]` — all categories except `"rest"` (recovery), `"zone2-mobility"` (aerobic/soft), and `"long-endurance"` (handled separately by `event-near-long-effort`).
- Full-body calisthenics is a meaningful training day. A race the same day is a real conflict.
- The tunable `CROSS_GOAL_RULES` constant means this can be adjusted without a code deployment if future goals use the category differently.

### 10.5 Focus-Strict vs. Fallback-Desired Query Pattern (revised per CRIT-2 + DC-6)

**Decision**: Sites are classified into two categories. The orderBy fallback is **only** at `getActiveProgram`.

**Fallback-desired** (`getActiveProgram` only): `orderBy: [{ goal: { isFocus: "desc" } }, { updatedAt: "desc" }]` picks the focus plan first, falls back to any active plan — correct during a brief transition where the focus goal's plan is being replaced.

**Focus-strict** (all other sites: lint, ack, baseline, pending-notes): `where: { active: true, goal: { isFocus: true } }` returns null/empty when no focus plan exists — never falls back to another goal's plan.

**Reasoning for focus-strict at lint/ack/baseline/pending-notes sites**:
- `lintActivePlan` linting the wrong goal's template emits irrelevant errors
- `acknowledge_lint_finding` / `clear_lint_acknowledgement` with fallback creates phantom acknowledgements that survive focus-switch — a data integrity issue
- `getBaselineSchedule` silently showing another goal's schedule on baselines/new is confusing UX
- These sites see real use precisely when a focus-switch just occurred, which is exactly when the fallback would pick the wrong plan

**Previous decision** (orderBy at all sites) was incorrect for lint/ack/baseline sites. `resolveDay` goal query and `computeGameState` remain `where: { isFocus: true }` direct queries. See §5.1 for the full per-site mapping.

### 10.6 `getGoalEventsResult` Returns `otherGoalsMeta` (No Extra DB Query)

**Decision**: `getGoalEventsResult` derives `otherGoalsMeta` from the `getActiveGoalsWithPlans()` result (which is already Query 1 of the 3-query budget). No additional DB query needed for the "Other goals" legend card.

**Reasoning**:
- All goal legend data (`legend: Json?`) is already in the `getActiveGoalsWithPlans` select.
- The icon/label derivation is purely in-memory (`resolveLegend` + `findLegendEntry`).
- Net: `getCalendarMonth` stays at +3 queries (not +4) for the events + legend data.

### 10.7 `resolveDay` ctx Is Optional (Not Required)

**Decision**: The `ctx` argument is optional. Without it, resolveDay fetches events internally (+3 queries). With it (e.g. from `get_week` or `getCalendarMonth`), it uses the pre-assembled data (zero extra queries).

**Reasoning**:
- Standalone `get_day` calls from the coach or day-page loads are the most common single-day use cases. They should work without the caller needing to pre-assemble ctx.
- `get_week` and `getCalendarMonth` always pre-assemble to avoid N×3 query overhead.
- PRD acceptance criterion 8: "with ctx provided performs no event queries."

### 10.8 REQ-101 Must Compile Atomically

**Decision**: REQ-101 is one Wave-1 agent that handles schema + generate + ALL call-site flips together.

**Reasoning**:
- The schema adds `Goal.isFocus Boolean @default(false)`. Every site that previously read `Goal.active` to mean "focus" now reads `Goal.isFocus`. Until ALL those sites are flipped, `npx tsc --noEmit` will have type errors (the `isFocus` field doesn't exist on the old Prisma client until `prisma generate` runs).
- Running `prisma generate` immediately (step [2]) makes the new field available to TypeScript.
- All call-site flips in a single agent pass prevents a split-brain state where some code uses `active` and some uses `isFocus`.

### 10.9 `Goal.active` Is NOT Removed

**Decision**: `Goal.active` remains as the "tracked" flag. `Goal.isFocus` is a new column. Both coexist.

**Reasoning**:
- `active` is still meaningful: an active goal contributes events, shows in the Today strip, is shown on /goals. An inactive (untracked) goal is hidden from the active surface.
- `isFocus` is the NEW "drives the daily prescription" flag (exactly one true).
- Removing `active` would be a breaking migration (NOT NULL column drop) and semantically incorrect — tracking and focus are orthogonal concepts going forward.

### 10.10 Duplicate `activeGoal` Key in `get_today_plan` for One Release

**Decision**: `get_today_plan` returns BOTH `focusGoal` (new name) AND `activeGoal` (old name, pointing to the same object) until the next release.

**Reasoning**:
- claude.ai connector prompts that reference `activeGoal` will continue working without a re-prompt.
- The duplication is explicit and documented with a `// KEPT for one release (saved-prompt compatibility)` comment.
- The agent/Gabe can drop `activeGoal` in the next minor feature.

---

---

## 11. Corrections & Addenda (Architect Pass 2 — 2026-06-10)

The following corrections apply to the blueprint above. Developer agents must apply these **over** the corresponding sections.

### 11.1 `templateForRotationDay` Already Exists — DO NOT Create a Duplicate (DC-1 Correction)

`templateForRotationDay` already exists at **calendar.ts:701** with an implementation identical to what was originally proposed in this section. Verified during the v2 revision pass (Read calendar.ts:695-711 confirmed the exact function signature and algorithm).

**Wave 1 (Alpha agent, REQ-101) must NOT add this function.** Creating it would cause a TypeScript `Duplicate identifier` compile error at the Wave 1 gate and confuse future readers about which definition applies.

The import in `goal-conflicts.ts` (§3.4) is correct as-is:
```typescript
import { ..., templateForRotationDay } from "@/lib/calendar";
```

No calendar.ts action required for this item beyond confirming the existing export is already available.

### 11.2 UXR Dimming — Recolor, Not Row Opacity (Corrects §7.1)

Section 7.1 shows:
```tsx
<li key={g.id} className={`flex items-start gap-3 py-3 ${!g.active && !isFocused ? "opacity-50" : ""}`}>
```

**This violates UXR-62-12.** Row-level `opacity-50` pushes `var(--muted)` text on the cream light theme below AA 4.5:1 contrast. 

**Correct approach (dim-by-recolor, per research):**

```tsx
<li key={g.id} className="flex items-start gap-3 py-3">
  {/* Change text colour on the objective+date lines, NOT row opacity: */}
  <Bullseye
    size={20}
    progress={pct}
    aria-label={`${g.objective}: ${Math.round(pct * 100)}% progress`}
    className={`shrink-0 mt-0.5 ${!g.active && !isFocused ? "opacity-55" : ""}`}
    // ^ Bullseye *glyph* may use opacity (non-text; UXR-62-12 AA-safe at 0.5–0.6)
  />
  <div className="min-w-0">
    <p className={`font-medium truncate ${!g.active && !isFocused ? "text-[var(--muted)]" : ""}`}>
      {g.objective}
      {/* badge etc */}
    </p>
    <p className="text-xs text-[var(--muted)]">
      {/* date / status — already muted, no extra dimming needed */}
    </p>
  </div>
```

Rule: Bullseye SVG glyph can use `opacity-55`; all text uses var(--muted) color class; no row-level opacity.

### 11.3 `OtherGoalsStrip` — Remove `partition` (Not Imported) + Add `todayDateKey` Prop

Section 7.2's `OtherGoalsStrip` uses a `partition` helper that is not a built-in and not imported. Replace with an inline filter:

```typescript
// Props — add todayDateKey to avoid the server component re-computing dateKey(new Date())
type Props = {
  events: GoalEvent[];
  conflicts: CrossGoalConflict[];
  todayDateKey: string;   // passed from page.tsx which already has `const todayDateKey = dateKey(now)`
};

export function OtherGoalsStrip({ events, conflicts, todayDateKey }: Props) {
  const nonFocusEvents = events.filter((e) => !e.isFocusGoal);
  if (nonFocusEvents.length === 0) return null;

  const todayEvents = nonFocusEvents.filter((e) => e.dateKey === todayDateKey);
  const thisWeekEvents = nonFocusEvents.filter((e) => e.dateKey > todayDateKey);
  const conflictsToday = conflicts.filter(
    (c) => c.dateKey >= todayDateKey,
  );
  // ... rest of render unchanged
}
```

And in `page.tsx`, pass `todayDateKey`:
```tsx
<OtherGoalsStrip
  events={sevenDayGoalEventsResult.events}
  conflicts={sevenDayConflicts}
  todayDateKey={todayDateKey}  // already declared in page.tsx
/>
```

### 11.4 Missing Imports in `CalendarMonth.tsx` and `OtherGoalsStrip.tsx` (DC-4 fix)

Section 7.2 shows `OtherGoalMeta` and `CrossGoalConflict` in props but omits the import statements.

Add to **CalendarMonth.tsx**:
```typescript
import type { GoalEvent, OtherGoalMeta } from "@/lib/goal-events";
import type { CrossGoalConflict } from "@/lib/goal-conflicts";
```

Add to **OtherGoalsStrip.tsx** (DC-4 — previously missing entirely):
```typescript
import type { GoalEvent } from "@/lib/goal-events";
import type { CrossGoalConflict } from "@/lib/goal-conflicts";
```

### 11.5 `GoalCreateForm` / `GoalEditForm` — Import Clarification

Both form components need only the `required` attribute removed from the date `<input>`. The label change is:

- GoalCreateForm: `<label htmlFor="targetDate">Target date <span className="text-[var(--muted)] font-normal">(optional)</span></label>`
- GoalEditForm: same optional note

No other changes to these client components.

### 11.6 Hike Idempotency — `goalId: null` Match Semantics

In log_hike's scoped idempotency check (§6.1), when `resolvedGoalId` is null (hike attributed to focus at read time), the Prisma `where.goalId` filter should be:

```typescript
// When resolvedGoalId is null, match hikes that also have goalId=null
// (i.e. focus-attributed hikes). Two goals can each plan a hike on the same day.
where: {
  status: "planned",
  date: { gte: startOfDay(hikeDate), lte: endOfDay(hikeDate) },
  goalId: resolvedGoalId,  // null = focus hikes only; string = goal-specific hikes only
}
```

Prisma `where: { goalId: null }` matches `IS NULL` in SQL — correct behavior. PRD §3.2.1 says "two goals may each plan a hike on the same day" — this scoped check allows it.

### 11.7 `templateForRotationDay` Import in `goal-conflicts.ts`

The import in goal-conflicts.ts must be adjusted:

```typescript
// ✅ CORRECT — templateForRotationDay is now a calendar.ts export (added in REQ-101 Pass 1)
import {
  addDays,
  dateKey,
  parseDateKey,
  startOfDay,
  startOfWeekMonday,
  templateForRotationDay,   // added per §11.1
} from "@/lib/calendar";
```

### 11.8 QA Verify-Visually Checklist (from UXR §9)

The following items from the UX research report must be manually verified on a real 390px device in **both** themes before shipping. Dev agents should leave `// [UXR-62-NN] verify visually` comments at each decision point:

| UXR ID | Decision point | File:component | Comment tag |
|--------|----------------|----------------|-------------|
| UXR-62-01 | Claim-ring: `outline 1–1.5px solid var(--muted)`, fallback = tag-dot | CalendarMonth.tsx foreign marker span | `// [UXR-62-01]` |
| UXR-62-02 | Foreign-marker `opacity: 0.55–0.70` | Same | `// [UXR-62-02]` |
| UXR-62-03 | Marker cap: 2 vs 3 before `+N` | CalendarMonth.tsx DayCell | `// [UXR-62-03]` |
| UXR-62-04 | `+N` chip: `9–10px` on `accent-soft` | CalendarMonth.tsx DayCell | `// [UXR-62-04]` |
| UXR-62-06 | Today strip loud: `border-left 2px var(--target)` + `accent-soft` bg | OtherGoalsStrip.tsx | `// [UXR-62-06]` |
| UXR-62-08 | Race-day banner: border `1–1.5px var(--target)`, wash alpha `8–16%` | days/[dateKey]/page.tsx | `// [UXR-62-08]` |
| UXR-62-09 | Conflict banner: `border-left 3px var(--warning)` + ◣ glyph | days/[dateKey]/page.tsx | `// [UXR-62-09]` |
| UXR-62-11 | Focus badge: filled Bullseye `size=14` | goals/page.tsx | `// [UXR-62-11]` |
| UXR-62-12 | Untracked row: recolor (not opacity); Bullseye glyph `opacity-55` | goals/page.tsx | `// [UXR-62-12]` |

Dev agents **must add these comment tags** at the corresponding JSX lines. The QA agent verifies all of them on device.

### 11.9 Focus Badge — Filled Bullseye (UXR-62-11 Correction)

Section 7.1 shows a plain text "Focus" pill. The UXR research (§2 Q4) specifies a **filled Bullseye `size=14`** PLUS the "Focus" label. The research says `size=14` is the component minimum for the red center ring to be visible.

Corrected badge:
```tsx
{isFocused && (
  <span className="ml-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-wide rounded-full border border-[var(--accent)] text-[var(--accent)] px-1.5 py-0.5 align-middle">
    <Bullseye size={14} progress={1} aria-hidden="true" />  {/* [UXR-62-11] filled = 100% progress */}
    Focus
  </span>
)}
```

Pass `progress={1}` to get the filled state (all rings filled). `aria-hidden="true"` because the "Focus" label provides the accessible text.

### 11.10 createGoal Action — Missing `revalidatePath("/")` 

Section 5.5 mentions "Add `/` to revalidatePath calls". Be specific: in `goal-actions.ts` `createGoal`, add:

```typescript
revalidatePath("/");          // NEW — Today page needs to know about new active goals
revalidatePath("/calendar");  // NEW (DC-5) — new goal's targetDate pin appears immediately
revalidatePath("/goals");
revalidatePath("/stats");
redirect(`/goals/${goal.id}`);
```

Similarly, `updateGoal` needs to add `revalidatePath("/")` and `revalidatePath("/calendar")` since targetDate changes affect the calendar pin.

---

*Blueprint complete (Pass 1 + Pass 2 corrections). Proceed with Wave 1 (Alpha agent: REQ-101).*

---

## Revision log (v2) — 2026-06-10

| Item | Resolution |
|------|-----------|
| **CRIT-1** | Fixed: added `"long-endurance"` to `CROSS_GOAL_RULES.hardCategories` in §3.4 so baseline-retest events landing on a long-endurance day (diff=0) fire `event-on-hard-day`; `event-near-long-effort` unchanged for diff>0 target-date proximity. |
| **CRIT-2** | Fixed: reclassified `lintActivePlan`, `getPendingNotesCount`, `get_pending_notes`, `acknowledge_lint_finding`, `clear_lint_acknowledgement`, `baselines/new/page.tsx` as **focus-strict** (`where: { active: true, goal: { isFocus: true } }`, null/empty when absent). Updated §5.1 table, §4 Pass 1 Change 5, and §10.5 decision. `getActiveProgram` remains the single fallback-desired site. |
| **CRIT-3** | Fixed: `key-events-same-week` now includes ALL goals' key events (focus + non-focus) in the week scan; conflicts are emitted only for non-focus events. Updated keyEvents filter and emit loop in §3.4. |
| **CRIT-4** | Fixed: `get_session_brief` now filters `otherGoalsResult.events` to the current week's dateKeys before calling `crossGoalConflicts`. The 30-day result is still used for `otherActiveGoals.nextEvent`. Updated §6.1. |
| **DC-1** | Fixed: §11.1 rewritten to document that `templateForRotationDay` already exists at calendar.ts:701 (verified). Wave 1 Alpha agent instructed NOT to create a duplicate. |
| **DC-2** | Fixed: `resolveDay` no-ctx out-of-plan fallback now fetches `addDays(startOfWeekMonday(date), -2) .. addDays(startOfWeekMonday(date)+6, 2)` so proximity conflicts fire for race dates beyond the plan window. Output still filtered to `dateKey(date)`. Updated §4 Pass 3 Change 11. |
| **DC-3** | Applied (medium): Today page restructured to pre-fetch `getGoalEventsResult` first, then pass ctx to `resolveDay`; eliminates 3 duplicate goal-event queries per Today load. Updated §7.2 and §8.1 data flow. |
| **DC-4** | Applied (medium): Added missing `GoalEvent` + `CrossGoalConflict` imports to `OtherGoalsStrip.tsx` in §11.4. |
| **DC-5** | Applied (medium): Added `revalidatePath("/calendar")` to `createGoal` in §11.10 so new goal target-date pins appear on the calendar immediately. |
| **DC-6** | Fixed (rolled into CRIT-2): `getBaselineSchedule` wrapper in §3.3 now uses focus-strict query. |
| **DC-7** | Accepted as-is (low): `key-events-same-week` emits one conflict per event day in a colliding week pair — both days show a wedge. Deliberate behavior; each event day IS in conflict. |
| **DC-8** | Applied (low): `setFocusGoal` now fetches `oldFocusId` before the transaction and calls `revalidatePath(\`/goals/${oldFocusId}\`)` post-transaction so the de-focused goal's detail page is immediately stale. |
| **SUG-1** | Rejected: exposing multi-kind conflicts per dateKey as an array is a Phase 2+ API change; Phase 1 keeps one-per-dateKey most-severe-wins dedup. |
| **SUG-2** | Rejected: widening `plannedHikeDateKeys` range by ±N at grid boundary is a Phase 2 optimization; Phase 1 grid-boundary edge is rare and the miss is silent (not wrong). |
| **SUG-3** | Applied: `ResolveDayCtx.crossGoalConflicts` is now `CrossGoalConflict[]?` (optional); usage updated to `ctx?.crossGoalConflicts !== undefined`. Updated §4 Pass 3 Change 10 and the inline compute expression. |
| **SUG-4** | Applied: added comment to `GoalEventsResult.events` type doc noting it contains all active-goal events and `otherGoalEvents()` is the filter helper. |
| **MR-1** | Documented: diff=0 for target-date events on long-endurance day is now caught by `event-on-hard-day` via the CRIT-1 fix (long-endurance in hardCategories). Interaction noted in §3.4 comment. |
| **MR-2** | Accepted documented limitation: old hikes logged with explicit `goalId` won't match null-scoped idempotency check; §11.6 already covers this. |
| **MR-3** | Explicitly accepted: `get_week` override suppression remains empty array for performance; note added inline in §6.1 get_week code. |
