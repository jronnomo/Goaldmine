// Cross-goal conflict detection.
//
// PURE — no DB, no await, no side effects, no mutation.
// All inputs pre-fetched by the caller (resolveDay / getCalendarMonth / get_week).
//
// TUNABLE: CROSS_GOAL_RULES is exported so product-level decisions
// (raceProximityDays, which categories count as "hard") don't require code
// changes.
//
// Three conflict kinds are detected:
//
//   event-on-hard-day
//     A non-focus goal's target-date or baseline-retest event lands on a day
//     whose focus rotation template falls into a "hard" category (upper, lower,
//     calisthenics, lower-power, or long-endurance). Override suppression
//     applies: when overrideDateKeys includes the event's dateKey, the conflict
//     is suppressed on the assumption a workout override has already resolved
//     the day. Requires a focusProgram; skipped when null.
//
//   key-events-same-week
//     ≥2 distinct goals each have at least one key event (target-date or
//     baseline-retest) in the same CALENDAR Mon–Sun week (dateKey of Monday).
//     CRIT-3 fix: ALL goals' key events (focus + non-focus) participate in the
//     week scan so that focus-retest-week vs non-focus-race-week collisions are
//     detected. Conflicts are emitted only for the non-focus events — the focus
//     goal's events are the "other side" of the collision, not the conflict
//     recipient.
//     NOTE: bucketing is always by calendar week (dateKey(startOfWeekMonday(eventDate))).
//     The prior rotation-N / calendar-key mixed namespace has been removed —
//     using a hybrid namespace caused plan-boundary collisions to be silently
//     missed when one event fell at the tail of a rotation week and another was
//     bucketed as a calendar-week key.
//
//   event-near-long-effort
//     A non-focus goal's target-date event falls within ±raceProximityDays of
//     (a) any long-endurance rotation slot in the focus plan, or (b) any
//     planned hike date. diff=0 (exactly on the day) is excluded because that
//     case is caught by event-on-hard-day when long-endurance is in
//     hardCategories (CRIT-1 fix — prevents double-reporting).
//
// Deduplication: at most one conflict per (dateKey, goalId) composite key so
// two distinct goals' same-day conflicts both surface; most severe kind wins
// within the same composite key.
// Severity: event-on-hard-day (3) > event-near-long-effort (2) >
//           key-events-same-week (1).
//
// Output order: sorted by dateKey, then by kind (deterministic / stable).
//
// Coach-facing note: these labels are surfaced verbatim in the UI and MCP;
// they are designed to be human-readable without additional context.

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
import type { DayTemplate } from "@/lib/program-template";

// ── Tunables ──────────────────────────────────────────────────────────────────

export const CROSS_GOAL_RULES = {
  /**
   * A non-focus goal's target-date event within this many calendar days of a
   * focus long-endurance slot or planned hike triggers event-near-long-effort.
   * diff=0 (same day) is excluded — that is caught by event-on-hard-day.
   */
  raceProximityDays: 2,
  /**
   * Focus rotation categories that trigger event-on-hard-day when a non-focus
   * goal's key event lands on that day.
   *
   * "zone2-mobility" and "rest" are intentionally excluded (soft days that
   * do not meaningfully conflict with a non-focus event).
   *
   * "long-endurance" IS included (CRIT-1 fix): a non-focus baseline-retest
   * event landing DIRECTLY ON (diff=0) a long-endurance day is caught here
   * rather than being silently missed. event-near-long-effort still catches
   * diff>0 target-date proximity separately, so there is no double-reporting.
   */
  hardCategories: [
    "upper",
    "lower",
    "calisthenics",
    "lower-power",
    "long-endurance",
  ] as const satisfies ReadonlyArray<DayTemplate["category"]>,
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export type CrossGoalConflictKind =
  | "event-on-hard-day"
  | "key-events-same-week"
  | "event-near-long-effort";

export type CrossGoalConflict = {
  /** "yyyy-mm-dd" of the day carrying the conflicted non-focus event. */
  dateKey: string;
  kind: CrossGoalConflictKind;
  /**
   * dateKey(s) of the focus-plan slot(s) or other goal event(s) that create
   * the collision.
   *
   * event-on-hard-day:       [dateKey] — same day as the event.
   * key-events-same-week:    dateKeys of the other goals' key events in the week.
   * event-near-long-effort:  [longSlotDateKey] or [hikeDateKey].
   */
  withDates: string[];
  /** The non-focus goalId whose event is flagged. */
  goalId: string;
  /** Objective text of the non-focus goal (for display without an extra lookup). */
  goalObjective: string;
  /**
   * Human-readable label surfaced verbatim in UI and MCP.
   *
   * Patterns:
   *   event-on-hard-day:
   *     "{objective}'s {eventLabel} lands on a {focusDayTitle} day"
   *   key-events-same-week:
   *     "{objective}'s {eventLabel} shares {weekLabel} with another goal's key event"
   *   event-near-long-effort (focus plan slot):
   *     "{objective}'s {eventLabel} is {N} day(s) from a long-endurance slot ({slotDateKey})"
   *   event-near-long-effort (planned hike):
   *     "{objective}'s {eventLabel} is {N} day(s) from a planned hike ({hikeDateKey})"
   */
  label: string;
};

// ── Internal ──────────────────────────────────────────────────────────────────

const SEVERITY: Record<CrossGoalConflictKind, number> = {
  "event-on-hard-day": 3,
  "event-near-long-effort": 2,
  "key-events-same-week": 1,
};

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Compute cross-goal conflicts for a date range.
 *
 * PURE — no DB calls. All arguments must be pre-fetched by the caller.
 *
 * @param args.events             Full set of GoalEvent[] from getGoalEvents/getGoalEventsResult.
 * @param args.focusGoalId        The id of the current focus goal, or null.
 * @param args.focusProgram       The focus goal's active plan snapshot, or null.
 * @param args.plannedHikeDateKeys dateKeys of planned hikes in or near the range.
 * @param args.overrideDateKeys   dateKeys with a workoutJson override; suppresses
 *                                event-on-hard-day on those dates.
 * @param args.range              Date window; used only for key-events-same-week
 *                                rotation-week vs calendar-week decision.
 *
 * @returns Deduplicated, sorted CrossGoalConflict[]. One entry per dateKey,
 *          most-severe kind wins when multiple kinds fire on the same date.
 *          Sorted ascending by dateKey, then by kind (tiebreaker for stability).
 */
export function crossGoalConflicts(args: {
  events: GoalEvent[];
  focusGoalId: string | null;
  focusProgram: ActiveProgramSnapshot | null;
  plannedHikeDateKeys: string[];
  overrideDateKeys?: string[];
  range: { start: Date; end: Date };
}): CrossGoalConflict[] {
  const {
    events,
    focusGoalId,
    focusProgram,
    plannedHikeDateKeys,
    overrideDateKeys = [],
    // range is part of the API contract — callers use it to scope the events
    // they pass in, and for future use (e.g. out-of-plan proximity widening).
    // The detection logic itself works from the event dates already filtered
    // by the caller, so range is not read inside this function.
  } = args;

  // Only non-focus goal events can generate cross-goal conflicts.
  const nonFocusEvents = events.filter((e) => e.goalId !== focusGoalId);
  if (nonFocusEvents.length === 0) return [];

  const overrideSet = new Set(overrideDateKeys);
  const conflicts: CrossGoalConflict[] = [];

  // ── Kind 1: event-on-hard-day ──────────────────────────────────────────────
  //
  // A non-focus goal's target-date or baseline-retest event lands on a day
  // whose focus rotation template category is in CROSS_GOAL_RULES.hardCategories.
  // Suppressed when overrideDateKeys includes the event's dateKey (the coach
  // has already resolved the day via an override).
  // Skipped entirely when focusProgram is null (no rotation to compare against).
  if (focusProgram) {
    for (const event of nonFocusEvents) {
      if (event.type !== "target-date" && event.type !== "baseline-retest") continue;
      if (overrideSet.has(event.dateKey)) continue;

      const date = parseDateKey(event.dateKey);
      const tmpl = templateForRotationDay(focusProgram, date);
      if (!tmpl) continue; // date is outside the focus plan window

      const isHard = (
        CROSS_GOAL_RULES.hardCategories as ReadonlyArray<string>
      ).includes(tmpl.category);
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
  //
  // ≥2 distinct goals each have a key event (target-date or baseline-retest)
  // in the same calendar Mon–Sun week.
  //
  // CRIT-3 fix: Include ALL goals' key events (focus + non-focus) in the week
  // scan. This catches the primary real-world scenario: focus goal has a retest
  // week AND the non-focus goal has its race in that same week. Without the focus
  // goal's events in the scan, only non-focus vs non-focus collisions fire.
  //
  // Bucketing is ALWAYS by calendar week (dateKey(startOfWeekMonday(eventDate))).
  // The prior rotation-N / calendar-key mixed namespace has been removed —
  // it caused plan-boundary collisions to be missed when events near the plan
  // boundary were bucketed under different key formats.
  //
  // Conflicts are emitted only for non-focus events — the focus goal's events
  // are the "other side" of the collision, never the conflict recipient.
  const keyEvents = events.filter(
    (e) => e.type === "target-date" || e.type === "baseline-retest",
  );

  // Bucket key events by calendar Mon–Sun week.
  const byWeek = new Map<string, GoalEvent[]>();
  for (const event of keyEvents) {
    const eventDate = parseDateKey(event.dateKey);
    const weekKey = dateKey(startOfWeekMonday(eventDate));
    const arr = byWeek.get(weekKey) ?? [];
    arr.push(event);
    byWeek.set(weekKey, arr);
  }

  for (const [weekKey, weekEvents] of byWeek) {
    const uniqueGoals = new Set(weekEvents.map((e) => e.goalId));
    if (uniqueGoals.size < 2) continue; // only one goal in this week — no collision

    const weekLabel = `week of ${weekKey}`;

    // Emit only for non-focus events (focus events are the "other side")
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
  //
  // A non-focus goal's target-date event falls within ±raceProximityDays of:
  //   (a) any long-endurance rotation slot in the focus plan, OR
  //   (b) any planned hike date.
  //
  // diff=0 (same day as a long-endurance slot) is intentionally excluded here
  // because that case is already caught by event-on-hard-day when focusProgram
  // is present (long-endurance is in hardCategories per CRIT-1 fix).
  // This prevents double-reporting the same physical conflict under two kinds.
  //
  // Only target-date events trigger this kind (not baseline-retest); proximity
  // to a hard training day is meaningful for race scheduling, not for retest
  // checkpoints that are set by rotation math.
  const N = CROSS_GOAL_RULES.raceProximityDays;
  const targetDateEvents = nonFocusEvents.filter((e) => e.type === "target-date");

  for (const event of targetDateEvents) {
    const eventDate = parseDateKey(event.dateKey);
    let matched = false;

    // (a) focus plan long-endurance rotation slots
    if (focusProgram && !matched) {
      const longTmpl = focusProgram.template.weeklySplit.find(
        (d) => d.category === "long-endurance",
      );
      if (longTmpl) {
        const totalDays = focusProgram.template.totalWeeks * 7;
        for (
          let relDay = longTmpl.dayOfWeek - 1;
          relDay < totalDays;
          relDay += 7
        ) {
          const longDate = addDays(focusProgram.startedOn, relDay);
          const longKey = dateKey(longDate);
          const diff = Math.abs(
            Math.floor(
              (startOfDay(eventDate).getTime() - startOfDay(longDate).getTime()) /
                (24 * 3600 * 1000),
            ),
          );
          // diff > 0 excludes same-day (already handled by event-on-hard-day)
          if (diff > 0 && diff <= N) {
            conflicts.push({
              dateKey: event.dateKey,
              kind: "event-near-long-effort",
              withDates: [longKey],
              goalId: event.goalId,
              goalObjective: event.goalObjective,
              label:
                `${event.goalObjective}'s ${event.label} is ${diff} day${diff > 1 ? "s" : ""} from a long-endurance slot (${longKey})`,
            });
            matched = true;
            break;
          }
        }
      }
    }

    // (b) planned hike dates
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
            label:
              `${event.goalObjective}'s ${event.label} is ${diff} day${diff > 1 ? "s" : ""} from a planned hike (${hikeDk})`,
          });
          matched = true;
          break;
        }
      }
    }
  }

  // ── Deduplication + sort ───────────────────────────────────────────────────
  //
  // At most one conflict per (dateKey, goalId) composite key — two distinct
  // goals' same-day conflicts both surface (a goal-A race and a goal-B race on
  // the same date are independent events, not duplicates). Most-severe kind wins
  // within the same composite key.
  const deduped = new Map<string, CrossGoalConflict>();
  for (const c of conflicts) {
    const dedupeKey = `${c.dateKey}|${c.goalId}`;
    const existing = deduped.get(dedupeKey);
    if (!existing || SEVERITY[c.kind] > SEVERITY[existing.kind]) {
      deduped.set(dedupeKey, c);
    }
  }

  // Deterministic output: sort by dateKey ascending, then kind as tiebreaker.
  return [...deduped.values()].sort((a, b) => {
    const dk = a.dateKey.localeCompare(b.dateKey);
    if (dk !== 0) return dk;
    return a.kind.localeCompare(b.kind);
  });
}
