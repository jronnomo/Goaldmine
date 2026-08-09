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

import { getDb } from "@/lib/db";
import { dateKey } from "@/lib/calendar";
import { resolveLegend, findLegendEntry } from "@/lib/legend";
import { baselineCheckpointDates } from "@/lib/records";
import { getActiveGoalsWithPlans } from "@/lib/goal-focus";
import type { ProgramTemplate } from "@/lib/program-template";

export type GoalEventType =
  | "target-date"
  | "baseline-retest"
  | "planned-hike"
  | "scheduled-item"
  | "goal-completed";

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
  /**
   * True only for decorative events sourced from the ACHIEVED-goal pass below
   * (an archived goal's historical retest/hike/scheduled-item pins). Absent
   * (undefined) on every event from the active-goal pipeline — never set to
   * `false` there, so active-goal event objects are byte-identical to before
   * this field existed.
   *
   * goal-conflicts.ts's crossGoalConflicts() filters these out up front: an
   * archived goal can no longer collide with the focus program (it's history,
   * not a live scheduling decision), so letting archived events feed
   * event-on-hard-day / key-events-same-week / event-near-long-effort would
   * manufacture phantom conflicts against dead plans.
   */
  archived?: boolean;
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
 *
 * Two goal populations feed events:
 *   1. Active goals (status:"active", active:true) via getActiveGoalsWithPlans()
 *      — the full event set (target-date, baseline-retest, planned-hike,
 *      scheduled-item), keyed against each goal's live active plan.
 *   2. Achieved (archived) goals whose life [createdAt, completedAt] overlaps
 *      `range` — a decorative-only pass so an achieved goal's calendar
 *      history (baseline-retest ◎ pins, planned hikes, scheduled items) keeps
 *      rendering on the dates they actually happened, instead of vanishing
 *      the moment getActiveGoalsWithPlans() stops returning the goal
 *      (architecture-blueprint-v2.md R8 already carved out the single 🏆
 *      goal-completed event for this reason; this extends the same idea to
 *      the rest of the event types).
 *
 * Rules for the achieved-goal pass (goal-story PRD, archived-decorations fix):
 *   - Every event is clamped to dateKey ∈ [dateKey(createdAt), dateKey(completedAt)]
 *     AND the requested range — nothing decorates after completion (no
 *     phantom "next retest" that never ran), nothing decorates before the
 *     goal existed.
 *   - NO target-date pin — the 🏆 goal-completed event is the terminal
 *     marker; a stale (possibly past-due-styled) target-date pin alongside
 *     it would be redundant and confusing.
 *   - baseline-retest uses the SAME rotation math (baselineCheckpointDates)
 *     against the goal's most-recently-created plan (regardless of
 *     active/inactive — completion deactivates plans, so "active" plans
 *     don't exist for an achieved goal; this mirrors the latest-plan idiom
 *     in goal-completion.ts / goal-core.ts).
 *   - planned-hike / scheduled-item are DB rows already scoped by date+status;
 *     they're just re-attributed to the achieved goal and life-clamped.
 *   - isFocusGoal is always false (completeGoalCore unconditionally clears
 *     isFocus) and every event carries `archived: true` (see GoalEvent).
 *
 * DB queries (5, all read-only):
 *   1. getActiveGoalsWithPlans() — active goals + their active plan
 *   2. db.goal.findMany — achieved goals whose life overlaps `range`; the
 *      SINGLE fetch feeding both the 🏆 goal-completed event AND the
 *      archived-decorations pass (no duplicate achieved-goal query).
 *   3. db.hike.findMany — planned hikes in range (any goalId)
 *   4. db.scheduledItem.findMany — planned items in range, scoped to
 *      active-OR-achieved goal ids (so an achieved goal's scheduled items are
 *      actually fetched — previously scoped to active ids only)
 *   5. db.plan.findMany — latest plan per achieved goal (for baseline-retest
 *      math); skipped (no query) when there are no achieved goals in range.
 *
 * Cheap early-out (rule 5 of the fix spec): query 2's WHERE already excludes
 * every achieved goal whose life can't possibly overlap `range`
 * (`completedAt < range.start` or `createdAt > range.end`), so when nothing
 * matches, `achievedGoals` is `[]` and every archived-pass loop below is a
 * no-op — no extra JS filtering needed.
 *
 * All date math via @/lib/calendar.
 */
export async function getGoalEventsResult(
  range: { start: Date; end: Date },
): Promise<GoalEventsResult> {
  const startDk = dateKey(range.start);
  const endDk = dateKey(range.end);
  const db = await getDb();

  // Query 1 + Query 2 in parallel — independent of each other.
  const [goals, achievedGoalsRaw] = await Promise.all([
    getActiveGoalsWithPlans(),
    // Life-window overlap filter (mirrors compare.ts's window-relevance
    // filter): completedAt >= range.start AND createdAt <= range.end. A goal
    // completed entirely before the range, or created entirely after it,
    // cannot contribute any event (including 🏆) to this range.
    db.goal.findMany({
      where: {
        status: "achieved",
        completedAt: { gte: range.start },
        createdAt: { lte: range.end },
      },
      select: {
        id: true,
        objective: true,
        kind: true,
        legend: true,
        createdAt: true,
        completedAt: true,
      },
      orderBy: { completedAt: "asc" },
    }),
  ]);

  const activeGoalIds = goals.map((g) => g.id);
  const focusGoalId = goals.find((g) => g.isFocus)?.id ?? null;
  // Defensive: status:"achieved" rows always carry completedAt; narrow the
  // type so downstream code doesn't need repeated null-checks.
  const achievedGoals = achievedGoalsRaw.filter(
    (g): g is typeof g & { completedAt: Date } => g.completedAt !== null,
  );
  const achievedGoalIds = achievedGoals.map((g) => g.id);
  const combinedGoalIds = [...activeGoalIds, ...achievedGoalIds];

  // dateKey-string life window per achieved goal, for the clamp checks below.
  const achievedLifeByGoalId = new Map(
    achievedGoals.map((g) => [
      g.id,
      { lifeStartDk: dateKey(g.createdAt), lifeEndDk: dateKey(g.completedAt) },
    ]),
  );
  function withinArchivedLife(goalId: string, dk: string): boolean {
    const life = achievedLifeByGoalId.get(goalId);
    if (!life) return false;
    return dk >= life.lifeStartDk && dk <= life.lifeEndDk;
  }

  // Queries 3 + 4 + 5 in parallel
  const [hikes, scheduledItems, achievedPlans] = await Promise.all([
    db.hike.findMany({
      where: {
        status: "planned",
        date: { gte: range.start, lte: range.end },
      },
      select: { id: true, date: true, route: true, goalId: true },
      orderBy: { date: "asc" },
    }),
    combinedGoalIds.length > 0
      ? db.scheduledItem.findMany({
          where: {
            goalId: { in: combinedGoalIds },
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
    // Latest plan per achieved goal (for baseline-retest math). Fetched flat
    // and reduced to "first per goalId" in JS below — ordered goalId asc,
    // createdAt desc, so the first row seen per goalId is the latest plan.
    achievedGoalIds.length > 0
      ? db.plan.findMany({
          where: { goalId: { in: achievedGoalIds } },
          orderBy: [{ goalId: "asc" }, { createdAt: "desc" }],
          select: { goalId: true, planJson: true, startedOn: true },
        })
      : Promise.resolve([] as { goalId: string; planJson: unknown; startedOn: Date }[]),
  ]);

  const latestPlanByAchievedGoalId = new Map<
    string,
    { planJson: unknown; startedOn: Date }
  >();
  for (const p of achievedPlans) {
    if (!latestPlanByAchievedGoalId.has(p.goalId)) {
      latestPlanByAchievedGoalId.set(p.goalId, { planJson: p.planJson, startedOn: p.startedOn });
    }
  }

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
  // Active goals are checked first (unchanged behavior/output); a hike
  // attributed to a goal NOT in the active set falls through to the
  // achieved-goal lookup so an archived goal's planned hikes still render,
  // life-clamped.
  for (const hike of hikes) {
    const attributedGoalId = hike.goalId ?? focusGoalId;
    if (!attributedGoalId) continue;
    const goal = goals.find((g) => g.id === attributedGoalId);
    if (goal) {
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
      continue;
    }
    const archivedGoal = achievedGoals.find((g) => g.id === attributedGoalId);
    if (!archivedGoal) continue;
    const dk = dateKey(hike.date);
    if (!withinArchivedLife(archivedGoal.id, dk)) continue;
    const legend = resolveLegend(archivedGoal);
    const hikeEntry = findLegendEntry(legend, "hike-planned");
    events.push({
      goalId: attributedGoalId,
      goalObjective: archivedGoal.objective,
      goalKind: archivedGoal.kind,
      isFocusGoal: false,
      dateKey: dk,
      type: "planned-hike",
      icon: hikeEntry?.icon ?? "🥾",
      label: hikeEntry?.label ?? "Hike planned",
      detail: hike.route,
      archived: true,
    });
  }

  // Event source 4: planned ScheduledItems
  // Same active-first, achieved-fallback shape as hikes above (the DB query
  // now includes achieved goal ids in its `goalId: { in: ... }` filter, so
  // an archived goal's scheduled items are actually fetched in the first
  // place — see query 4's comment above).
  for (const item of scheduledItems) {
    const goal = goals.find((g) => g.id === item.goalId);
    if (goal) {
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
      continue;
    }
    const archivedGoal = achievedGoals.find((g) => g.id === item.goalId);
    if (!archivedGoal) continue;
    const dk = dateKey(item.date);
    if (!withinArchivedLife(archivedGoal.id, dk)) continue;
    events.push({
      goalId: item.goalId,
      goalObjective: archivedGoal.objective,
      goalKind: archivedGoal.kind,
      isFocusGoal: false,
      dateKey: dk,
      type: "scheduled-item",
      icon: "◆",
      label: item.title,
      detail: item.detail ?? undefined,
      archived: true,
    });
  }

  // Event source 5: baseline-retest checkpoints for ACHIEVED goals (this
  // fix). Same rotation math as the active pipeline (source 2 above), keyed
  // against the goal's most-recently-created plan (there is no "active"
  // plan once a goal is achieved — completion deactivates it). Clamped to
  // the goal's life window AND the requested range. NO target-date pin for
  // achieved goals (rule 2 of the fix spec) — intentionally no counterpart
  // to event source 1 here.
  for (const goal of achievedGoals) {
    const plan = latestPlanByAchievedGoalId.get(goal.id);
    if (!plan) continue;
    const template = plan.planJson as unknown as ProgramTemplate;
    const checkpoints = baselineCheckpointDates(template, plan.startedOn);
    for (const cp of checkpoints) {
      const dk = dateKey(cp.targetDate);
      if (dk < startDk || dk > endDk) continue;
      if (!withinArchivedLife(goal.id, dk)) continue;
      events.push({
        goalId: goal.id,
        goalObjective: goal.objective,
        goalKind: goal.kind,
        isFocusGoal: false,
        dateKey: dk,
        type: "baseline-retest",
        icon: "◎",
        label: `${cp.label === "initial" ? "Initial" : "Retest"}: ${cp.testName}`,
        detail: cp.testName,
        archived: true,
      });
    }
  }

  // Event source 6: goal-completed (achieved goals, query 2 above).
  // Hardcoded 🏆 icon — NO legend-kind enum change (R8). An achieved goal is
  // never the focus goal by the time this fires (completeGoalCore clears
  // isFocus unconditionally), so isFocusGoal is always false here. Query 2's
  // WHERE is now a life-window overlap (broadened from the old "completedAt
  // in range" filter, to let the archived-decorations pass above see goals
  // completed after the range too) — so this loop needs its own explicit
  // in-range check for the 🏆 marker itself.
  for (const goal of achievedGoals) {
    const dk = dateKey(goal.completedAt);
    if (dk < startDk || dk > endDk) continue;
    events.push({
      goalId: goal.id,
      goalObjective: goal.objective,
      goalKind: goal.kind,
      isFocusGoal: false,
      dateKey: dk,
      type: "goal-completed",
      icon: "🏆",
      label: "Goal completed",
      detail: goal.objective,
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
