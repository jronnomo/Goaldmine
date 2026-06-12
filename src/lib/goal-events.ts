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
import { dateKey } from "@/lib/calendar";
import { resolveLegend, findLegendEntry } from "@/lib/legend";
import { baselineCheckpointDates } from "@/lib/records";
import { getActiveGoalsWithPlans } from "@/lib/goal-focus";
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
  dateKey: string; // "yyyy-mm-dd"
  type: GoalEventType;
  icon: string; // from goal's legend goal-date entry; fallback "🏔️"
  label: string; // from goal's legend goal-date entry; fallback "Goal date"
  detail?: string; // testName for baseline-retest; route for planned-hike; item detail for scheduled-item
};

export type OtherGoalMeta = {
  id: string;
  objective: string;
  goalDateIcon: string; // icon from goal-date legend entry; fallback "🏔️"
  goalDateLabel: string; // label from goal-date legend entry; fallback "Goal date"
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
    activeGoalIds.length > 0
      ? prisma.scheduledItem.findMany({
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
        })
      : Promise.resolve([] as {
          id: string;
          goalId: string;
          date: Date;
          type: string;
          title: string;
          detail: string | null;
        }[]),
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
      icon: "◆",
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
