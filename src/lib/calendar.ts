// Helpers to resolve "what's on this date" — combining plan rotation, overrides,
// completed workouts, baselines due, and goal markers.

import { prisma, getDb } from "@/lib/db";
import { matchingMirrorKind } from "@/lib/override-integrity";
import {
  getActiveProgram,
  getActiveProgramMembership,
  getProgramForDate,
  pickProgramForDate,
  getPlanWindowCandidates,
  type ActiveProgramSnapshot,
  type ActiveProgramMembership,
  type ProgramForDate,
  type PlanWindowCandidate,
} from "@/lib/program";
import { checkpointWindows } from "@/lib/records";
import type { BaselineDay, BaselineTest, DayTemplate } from "@/lib/program-template";
import { type NutritionPlan, parseStoredNutritionPlan } from "@/lib/nutrition-plan";
import {
  getGoalEventsResult,
  eventsByDateKey,
  otherGoalEvents as filterOtherGoalEvents,
  type GoalEvent,
} from "@/lib/goal-events";
import {
  crossGoalConflicts as computeCrossGoalConflicts,
  type CrossGoalConflict,
  CROSS_GOAL_RULES,
} from "@/lib/goal-conflicts";
// Pure USER_TZ date primitives live in calendar-core.ts (no prisma) so Client
// Components can import them without pulling the server bundle. Import the ones
// the server functions below use, and re-export the full surface so every
// existing `@/lib/calendar` importer keeps working unchanged.
import {
  dateKey,
  startOfDay,
  endOfDay,
  startOfWeekMonday,
  endOfWeekSunday,
  addDays,
} from "./calendar-core";
export {
  USER_TZ,
  userTzWallClockToUTC,
  userWeekdayMon1,
  dateKey,
  parseDateKey,
  dateKeyAtCurrentTime,
  startOfDay,
  endOfDay,
  startOfWeekMonday,
  endOfWeekSunday,
  addDays,
  shiftWallClock,
  toDatetimeLocalValue,
  parseDatetimeLocalValue,
  weekRangeLabel,
  bucketDatesToWeekOffsets,
} from "./calendar-core";
// B4/A3 consolidation: THE rotation math lives in rotation-core.ts — resolveDay,
// buildCell, weekConflicts, and every other site here consume it. The pure
// template lookups that used to be implemented in this file are re-exported so
// every existing `@/lib/calendar` importer keeps working unchanged.
import {
  daysDelta,
  isInPlan as isInPlanWindow,
  weekIndex as weekIndexOf,
  rotationPosition,
  rotationWeekWindow,
  dateForRotationSlot,
  lastPlanDayStart,
  isTestDueInWeek,
  mergeDayOverride,
} from "./rotation-core";
export {
  templateForRotationDay,
  isDateWithinActivePlanWindow,
  rotationBaselineNamesForDate,
} from "./rotation-core";

export type CalendarDayCell = {
  date: Date;
  dateKey: string; // yyyy-mm-dd
  isPast: boolean;
  isToday: boolean;
  isFuture: boolean;
  isInPlan: boolean; // false if before plan.startedOn or after plan.endsOn
  isGoalDate: boolean;
  rotationDay: number | null; // 1..7 if isInPlan
  weekIndex: number | null; // 1..plan.weeks if isInPlan
  dayTitle: string | null; // the workout label to show: completed workout title if one exists, else override/template (deriveDayDisplay)
  plannedWorkoutTitle: string | null; // the prescription, set only when a completed workout differs from it (for "planned X → did Y")
  workoutCount: number; // completed gym workouts on this date (excludes skipped/planned)
  skippedCount: number; // skipped (acknowledged) gym workouts on this date
  hikeCount: number; // completed hikes on this date — out-of-gym training days
  plannedHikeCount: number; // hikes scheduled but not yet completed (status: "planned")
  hasOverride: boolean;
  baselinesDue: number; // count of due/overdue tests scheduled on this rotation day for this week
  // Normalized conflict for the calendar cell — data only; visual treatment is
  // Track 2 (plan-confidence-calendar.md). null = no conflict or out-of-plan.
  // If a cell has both kinds (theoretically possible but rare), "retest-on-hike"
  // takes precedence as the more immediately actionable signal.
  // Cross-goal kinds ("event-on-hard-day", "key-events-same-week",
  // "event-near-long-effort") are filled in by REQ-104 (getCalendarMonth wiring)
  // and carry optional goalId + label for display. Existing consumers that only
  // switch on "long-effort" | "retest-on-hike" are unaffected.
  conflict: {
    kind:
      | "long-effort"
      | "retest-on-hike"
      | "event-on-hard-day"
      | "key-events-same-week"
      | "event-near-long-effort";
    withDates: string[];
    /** Non-focus goalId — present only for cross-goal conflict kinds. */
    goalId?: string;
    /** Human-readable label — present only for cross-goal conflict kinds. */
    label?: string;
  } | null;
  // Track 2: confidence state for the plan-confidence calendar visual.
  //   null        := !isInPlan (out-of-month padding, before startedOn, after endsOn)
  //   "past"      := isInPlan && isPast
  //   "confirmed" := isInPlan && !isPast && confirmedThroughDate >= cell date
  //   "provisional":= isInPlan && (isFuture || isToday) && (no mark OR date > mark)
  confidence: "past" | "confirmed" | "provisional" | null;
  /** Non-focus active goals' events for this date. Empty when none exist. */
  otherGoalEvents: GoalEvent[];
  /** Count of scheduled items on this date for the focus project goal.
   *  Always 0 for fitness / null focus goals — ScheduledItem query is gated. */
  scheduledItemCount: number;
  /** REQ-003: which plan governs this cell, when isInPlan is true — the live
   *  active plan, or an archived plan resurfaced because it covers this past
   *  date (S1-era completed goal). undefined when isInPlan is false (no plan
   *  covers this date at all). Drives the archived-day dimmed treatment
   *  (REQ-004) — cells never disagree with resolveDay's resolvedPlan.source
   *  for the same date since both go through pickProgramForDate. */
  planSource?: "active" | "archived";
};

// Single source of truth for per-week unresolved conflicts.
// Consumed by: weekConflicts() async fn, buildCell (sync subset),
// get_session_brief (current week), plan-lint retest-on-hike-day rule,
// and (Track 2) the confirm_week guard.
//
// REQ-103 type widening (backward-compatible):
// The kind union gains three cross-goal kinds. Existing consumers that narrow
// on "long-effort" | "retest-on-hike" continue to compile unchanged — the
// additional variants are additive. Optional goalId + label carry cross-goal
// metadata; they are absent (undefined) on same-goal weekConflicts() output.
export type WeekConflict = {
  dateKey: string; // "yyyy-mm-dd" of the conflicted day
  kind:
    | "long-effort"
    | "retest-on-hike"
    | "event-on-hard-day"
    | "key-events-same-week"
    | "event-near-long-effort";
  // For "long-effort": the dates of hikes elsewhere in the week displacing the long-endurance day.
  // For "retest-on-hike": withDates[0] === dateKey — the hike and retest co-occur
  // on the same day; consumers should display this as a same-day collision.
  // For cross-goal kinds: see CrossGoalConflict.withDates semantics in goal-conflicts.ts.
  withDates: string[]; // dateKey(s) of the hike(s) or other-goal event(s) driving the conflict
  /** Non-focus goalId — present only for cross-goal conflict kinds. */
  goalId?: string;
  /** Human-readable label — present only for cross-goal conflict kinds. */
  label?: string;
};

// REQ-003: loose (unclamped) overlap filter — a perf optimization so buildCell's
// per-cell picker doesn't have to scan every plan the user has ever had. Uses the
// RAW template window (no S4 completion clamp) so it's a superset of the true
// covered window — pickProgramForDate's internal coverage check (which DOES apply
// the completion clamp) remains the source of truth for whether a given cell is
// actually covered. This filter can only over-include a candidate, never wrongly
// exclude one.
function filterCandidatesToGridOverlap(
  candidates: PlanWindowCandidate[],
  gridStart: Date,
  gridEnd: Date,
): PlanWindowCandidate[] {
  return candidates.filter((c) => {
    const startMid = startOfDay(c.startedOn);
    const endMid = lastPlanDayStart(c.startedOn, c.template.totalWeeks);
    return startMid.getTime() <= gridEnd.getTime() && endMid.getTime() >= gridStart.getTime();
  });
}

export async function getCalendarMonth(opts: { year: number; month: number /* 0-11 */ }) {
  const { year, month } = opts;
  const db = await getDb();

  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0); // last day
  // Pad to full weeks: start at Monday of first row, end at Sunday of last row.
  const gridStart = startOfWeekMonday(monthStart);
  const gridEnd = endOfWeekSunday(monthEnd);

  // Phase 1: fetch focus goal (gates the ScheduledItem query in Phase 2) alongside
  // the active program + the full plan-window candidate list (REQ-003) — neither
  // of the latter two depends on `goal`, so they run in the same round-trip instead
  // of forcing an extra sequential step.
  // [v2] MED-1: the goal fetch alone would be a single indexed query; folding program
  // + candidates in here keeps the "goal gates Phase 2" shape while avoiding a second
  // await before Phase 2 can start. Accepted trade-off — #38's AC text does not forbid
  // it; latency impact is sub-millisecond.
  const [goal, program, allCandidates] = await Promise.all([
    db.goal.findFirst({
      where: { isFocus: true },
      // Deterministically picks the most-recently-updated if multiple are
      // stuck isFocus=true (bad state).
      orderBy: { updatedAt: "desc" },
      // REQ-003: added kind for PROJECT_DEFAULT_LEGEND fallback + ScheduledItem gate.
      select: { id: true, targetDate: true, objective: true, legend: true, kind: true },
    }),
    getActiveProgram(),
    getPlanWindowCandidates(),
  ]);

  // REQ-003: candidates overlapping the visible grid, for buildCell's per-cell
  // pickProgramForDate call. The active plan's overrides must always be
  // fetchable even if it happens to fall outside the loose overlap filter
  // (shouldn't happen in practice, but keeps Today-page-adjacent behavior
  // byte-identical to the pre-REQ-003 override query).
  const candidates = filterCandidatesToGridOverlap(allCandidates, gridStart, gridEnd);
  const candidateIds = Array.from(
    new Set([...candidates.map((c) => c.id), ...(program?.id ? [program.id] : [])]),
  );

  // Phase 2: remaining queries in parallel; ScheduledItem query gated on project kind.
  const [workouts, hikes, overrides, goalEventsResult, scheduledItemsForCal, loggedBaselines] =
    await Promise.all([
    db.workout.findMany({
      where: { startedAt: { gte: gridStart, lte: gridEnd } },
      select: { id: true, startedAt: true, status: true, title: true },
      orderBy: { startedAt: "asc" },
    }),
    db.hike.findMany({
      where: { date: { gte: gridStart, lte: gridEnd }, status: { in: ["completed", "planned"] } },
      select: { id: true, date: true, status: true },
      orderBy: { date: "asc" },
    }),
    // REQ-003: keyed by planId|dateKey (below) instead of dateKey alone — both
    // the active plan's overrides AND any covering archived plan's overrides
    // (the core time-aware-history fix) are fetched in one round-trip.
    candidateIds.length > 0
      ? prisma.planDayOverride.findMany({
          where: { planId: { in: candidateIds }, date: { gte: gridStart, lte: gridEnd } },
        })
      : Promise.resolve([] as never[]),
    // REQ-104: cross-goal events for the full grid (3 queries — unchanged).
    getGoalEventsResult({ start: gridStart, end: gridEnd }),
    // REQ-004: ScheduledItem markers — project path only; zero queries for fitness/null.
    goal?.kind === "project"
      ? db.scheduledItem.findMany({
          where: {
            goalId: goal.id,
            date: { gte: gridStart, lte: gridEnd },
            status: { in: ["planned", "done"] },
          },
          select: { id: true, date: true },
          orderBy: { date: "asc" },
        })
      : Promise.resolve([] as { id: string; date: Date }[]),
    // Logged baseline results — used to count only UNLOGGED tests per cell so a
    // completed retest (e.g. logged early in its credit window) doesn't keep
    // showing a "N Baseline due" badge. Fetched whole (single-user, small table)
    // so a result outside the grid window still credits its checkpoint.
    db.baseline.findMany({ select: { testName: true, date: true }, orderBy: { date: "asc" } }),
  ]);

  // Bucket logged baselines by test name (date-asc) for the per-cell unlogged count.
  const loggedBaselinesByTest = new Map<string, { date: Date }[]>();
  for (const b of loggedBaselines) {
    const arr = loggedBaselinesByTest.get(b.testName) ?? [];
    arr.push({ date: b.date });
    loggedBaselinesByTest.set(b.testName, arr);
  }

  // Bucket workouts by date key.
  const workoutsByKey = new Map<string, typeof workouts>();
  for (const w of workouts) {
    const k = dateKey(w.startedAt);
    const arr = workoutsByKey.get(k) ?? [];
    arr.push(w);
    workoutsByKey.set(k, arr);
  }

  // Bucket hikes by date key, partitioned by status. Out-of-gym training days
  // surface as 🥾 in CalendarMonth — solid for completed, faded for planned.
  const hikesByKey = new Map<string, typeof hikes>();
  const plannedHikesByKey = new Map<string, typeof hikes>();
  for (const h of hikes) {
    const k = dateKey(h.date);
    const target = h.status === "planned" ? plannedHikesByKey : hikesByKey;
    const arr = target.get(k) ?? [];
    arr.push(h);
    target.set(k, arr);
  }

  // REQ-003: keyed `${planId}|${dateKey}` — an archived plan and the active
  // plan can each carry their own override row on the same calendar date
  // (distinct PlanDayOverride rows, one per plan), so dateKey alone is no
  // longer a unique key once overrides are fetched for multiple plans.
  // buildCell looks this up with its per-cell PICKED plan's id.
  const overridesByKey = new Map<string, (typeof overrides)[number]>();
  for (const o of overrides) overridesByKey.set(`${o.planId}|${dateKey(o.date)}`, o);

  // REQ-004: bucket ScheduledItem counts by dateKey for O(1) cell lookup.
  const scheduledsByKey = new Map<string, number>();
  for (const si of scheduledItemsForCal) {
    const k = dateKey(si.date);
    scheduledsByKey.set(k, (scheduledsByKey.get(k) ?? 0) + 1);
  }

  // Group planned hikes by rotation weekIndex for per-cell conflict computation.
  // Out-of-plan hikes (delta < 0 or >= totalWeeks*7) are excluded — they can't
  // conflict with rotation days.
  const plannedHikesByWeek = new Map<number, typeof hikes>();
  if (program) {
    for (const h of hikes) {
      if (h.status !== "planned") continue;
      const delta = daysDelta(program.startedOn, h.date);
      if (!isInPlanWindow(delta, program.template.totalWeeks)) continue;
      const wi = weekIndexOf(delta);
      const arr = plannedHikesByWeek.get(wi) ?? [];
      arr.push(h);
      plannedHikesByWeek.set(wi, arr);
    }
  }

  // REQ-104: cross-goal event + conflict data for cell building.
  const { events: allGoalEvents, focusGoalId, otherGoalsMeta } = goalEventsResult;
  const eventsByKey = eventsByDateKey(allGoalEvents);

  // Planned hike dateKeys for event-near-long-effort detection.
  const plannedHikeDateKeys = hikes
    .filter((h) => h.status === "planned")
    .map((h) => dateKey(h.date));

  // Override dateKeys (dates with workoutJson overrides) — suppresses event-on-hard-day.
  // REQ-003: scoped to the ACTIVE program's own overrides only (via the raw
  // `overrides` list, filtered by planId) — this suppression feeds
  // computeCrossGoalConflicts({ focusProgram: program }) below, which reasons
  // about the active program's rotation; an archived plan's override on the
  // same calendar date is a different plan's data and must not suppress it.
  const overrideDateKeys = overrides
    .filter((o) => o.planId === program?.id && o.workoutJson != null)
    .map((o) => dateKey(o.date));

  // Compute cross-goal conflicts once for the whole grid; deduplicated per dateKey.
  const crossGoalConflictList = computeCrossGoalConflicts({
    events: allGoalEvents,
    focusGoalId,
    focusProgram: program,
    plannedHikeDateKeys,
    overrideDateKeys,
    range: { start: gridStart, end: gridEnd },
  });
  const crossGoalConflictsByKey = new Map<string, CrossGoalConflict>();
  for (const c of crossGoalConflictList) {
    if (!crossGoalConflictsByKey.has(c.dateKey)) crossGoalConflictsByKey.set(c.dateKey, c);
  }

  const cells: CalendarDayCell[] = [];
  const now = new Date();
  const todayKey = dateKey(now);
  const goalKey = goal?.targetDate ? dateKey(goal.targetDate) : null;

  // Walk the grid by adding days in USER_TZ so DST transitions don't shear
  // the column alignment.
  for (let cursor = gridStart; cursor.getTime() <= gridEnd.getTime(); cursor = addDays(cursor, 1)) {
    const cursorKey = dateKey(cursor);
    const cell = buildCell({
      date: cursor,
      todayKey,
      goalKey,
      activeProgram: program,
      candidates, // REQ-003: per-cell pick via pickProgramForDate
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
      loggedBaselinesByTest,
    });
    cells.push(cell);
  }

  return {
    monthStart,
    monthEnd,
    cells,
    program,
    goal,
    /** Non-focus active goals — for the legend card (REQ-106). */
    otherGoals: otherGoalsMeta,
  };
}

/**
 * Derive confidence for a single date given the program snapshot.
 * Pure — no IO. Returns null when date is not in-plan.
 *
 * Rules (from REQ-002):
 *   null        := !isInPlan
 *   "past"      := isInPlan && isPast
 *   "confirmed" := isInPlan && !isPast && mark != null && startOfDay(date) <= startOfDay(mark)
 *   "provisional":= everything else (future/today with no mark, or date > mark)
 */
function deriveConfidence(
  date: Date,
  isInPlan: boolean,
  isPast: boolean,
  program: ActiveProgramSnapshot | null,
): CalendarDayCell["confidence"] {
  if (!isInPlan) return null;
  if (isPast) return "past";
  const mark = program?.confirmedThroughDate ?? null;
  if (mark != null && startOfDay(date).getTime() <= startOfDay(mark).getTime()) {
    return "confirmed";
  }
  return "provisional";
}

function buildCell(args: {
  date: Date;
  todayKey: string;
  goalKey: string | null;
  /** The live active plan (unchanged meaning). */
  activeProgram: ActiveProgramSnapshot | null;
  /** REQ-003: plan-window candidates overlapping the grid, for the per-cell
   *  pickProgramForDate call (shared, pure — cannot disagree with resolveDay). */
  candidates: PlanWindowCandidate[];
  workoutsByKey: Map<string, { id: string; startedAt: Date; status: string; title: string | null }[]>;
  hikesByKey: Map<string, { id: string; date: Date; status: string }[]>;
  plannedHikesByKey: Map<string, { id: string; date: Date; status: string }[]>;
  /** REQ-003: keyed `${planId}|${dateKey}` — see the override query comment above. */
  overridesByKey: Map<string, { planId: string; workoutJson: unknown; nutritionText: string | null; mobilityText: string | null; baselineTestNames: unknown }>;
  plannedHikesByWeek: Map<number, { id: string; date: Date; status: string }[]>;
  /** REQ-104: non-focus events for this specific date (pre-filtered by caller). */
  otherGoalEventsForDate: GoalEvent[];
  /** REQ-104: cross-goal conflict for this date, if any (pre-computed by caller). */
  crossGoalConflictForDate: CrossGoalConflict | null;
  /** REQ-004: pre-bucketed ScheduledItem count map (dateKey → count). */
  scheduledsByKey: Map<string, number>;
  /** Logged baseline results bucketed by test name — for the unlogged-only count. */
  loggedBaselinesByTest: Map<string, { date: Date }[]>;
}): CalendarDayCell {
  const k = dateKey(args.date);
  const isToday = k === args.todayKey;
  const isPast = !isToday && args.date < startOfDay(new Date());
  const isFuture = !isToday && !isPast;
  const isGoalDate = !!args.goalKey && k === args.goalKey;

  // REQ-003: per-cell pick — the SAME pure helper resolveDay uses, so the
  // month view and a `get_day`/day-page call for the same date can never
  // disagree about which plan governs it.
  const picked: ProgramForDate | null = pickProgramForDate(
    args.candidates,
    k,
    args.todayKey,
    args.activeProgram,
  );

  let isInPlan = false;
  let rotationDay: number | null = null;
  let weekIndex: number | null = null;
  let dayTitle: string | null = null;
  // B4/G6: the day's override→template decision, from the SAME shared code
  // resolveDay and the XP ledger use (mergeDayOverride). Non-null iff isInPlan.
  let cellCore: ReturnType<typeof mergeDayOverride> | null = null;

  if (picked) {
    const pos = rotationPosition(picked.startedOn, picked.template.totalWeeks, args.date);
    if (pos.isInPlan) {
      isInPlan = true;
      rotationDay = pos.rotationDay;
      weekIndex = pos.weekIndex;
      cellCore = mergeDayOverride(
        picked.template,
        rotationDay!,
        weekIndex!,
        args.overridesByKey.get(`${picked.id}|${k}`),
      );
      dayTitle = cellCore.isOverride
        ? (cellCore.workoutTemplate as { title?: string } | null)?.title ?? "Custom day"
        : cellCore.workoutTemplate?.title ?? null;
    }
  }

  // REQ-003: which plan governs this cell (only meaningful when isInPlan).
  const planSource: CalendarDayCell["planSource"] = isInPlan ? picked?.source : undefined;

  const dayWorkouts = args.workoutsByKey.get(k) ?? [];
  const workoutCount = dayWorkouts.filter((w) => w.status === "completed").length;
  const skippedCount = dayWorkouts.filter((w) => w.status === "skipped").length;
  const hikeCount = args.hikesByKey.get(k)?.length ?? 0;
  const plannedHikeCount = args.plannedHikesByKey.get(k)?.length ?? 0;
  const cellOverride = picked ? args.overridesByKey.get(`${picked.id}|${k}`) : undefined;
  const hasOverride = cellOverride !== undefined;
  // Override-aware, UNLOGGED-only baseline count. The scheduled set (override
  // list vs rotation default, unknown names dropped, empty array = explicitly
  // none) comes from the SAME mergeDayOverride call as the cell's template
  // decision — it cannot disagree with resolveDay's baselinesDue for the same
  // date. A test whose result is already logged within its credit window is
  // NOT counted: a completed retest shouldn't keep showing a "due" badge
  // (same loggedOnDate semantics as the workout-deferral guard).
  const baselinesDue = !isInPlan
    ? 0
    : cellCore!.baselineTests.filter(
        ({ test }) =>
          !baselineSatisfied(
            test,
            weekIndex!,
            args.date,
            picked!.startedOn,
            args.loggedBaselinesByTest.get(test.testName),
          ),
      ).length;

  // Conflict computation (C-2: only when workoutJson-based override is absent).
  // Override-aware: a day is only "resolved" if workoutJson is set — consistent
  // with resolveDay's isOverride definition and weekConflicts.
  //
  // REQ-003: both same-goal (retest-on-hike / long-effort) AND cross-goal
  // conflicts are forward-looking advisories — they exist to help the coach
  // sequence UPCOMING training against upcoming hikes/events. They are
  // meaningless on frozen history, and the same-goal inputs here
  // (plannedHikesByWeek) are keyed to the ACTIVE program's rotation-week
  // numbering — reusing them against an archived cell's own weekIndex would
  // silently compare two different plans' week numbers. Skip both entirely
  // once the picked plan is archived (S-revision rationale, architecture
  // critique D5/suggestion #3).
  let conflict: CalendarDayCell["conflict"] = null;
  const skipConflicts = picked?.source === "archived";

  if (!skipConflicts && isInPlan && rotationDay !== null && weekIndex !== null && picked) {
    // C-2 consolidation: "resolved by an override" is cellCore.isOverride —
    // the SAME workoutJson-based definition resolveDay's isOverride carries
    // (both now come from mergeDayOverride).
    if (!cellCore!.isOverride) {
      const weekHikes = args.plannedHikesByWeek.get(weekIndex) ?? [];

      // Priority 1: retest-on-hike (more immediately actionable)
      const baselineDay = picked.template.baselineWeek?.find(
        (d) => d.dayOfWeek === rotationDay,
      );
      if (baselineDay) {
        const hasDueTests = baselineDay.tests.some((t) => isTestDueInWeek(t, weekIndex!));
        if (hasDueTests) {
          const hikeOnThisDay = weekHikes.find((h) => dateKey(h.date) === k);
          if (hikeOnThisDay) {
            conflict = {
              kind: "retest-on-hike",
              withDates: [dateKey(hikeOnThisDay.date)],
            };
          }
        }
      }

      // Priority 2: long-effort conflict (only on the long-endurance rotation
      // day). No override on this branch, so cellCore.workoutTemplate IS the
      // rotation-day weeklySplit entry.
      const tmpl = cellCore!.workoutTemplate;
      if (!conflict && tmpl?.category === "long-endurance") {
        const hikeOnThisDay = weekHikes.find((h) => dateKey(h.date) === k);
        const hikesElsewhere = weekHikes.filter((h) => dateKey(h.date) !== k);
        if (!hikeOnThisDay && hikesElsewhere.length > 0) {
          conflict = {
            kind: "long-effort",
            withDates: hikesElsewhere.map((h) => dateKey(h.date)),
          };
        }
      }
    }
  }

  const confidence = deriveConfidence(args.date, isInPlan, isPast, args.activeProgram);

  // Single source of truth for the cell's workout label: a completed workout
  // wins over the prescription (deriveDayDisplay), so a swap/audible day shows
  // the SAME name here as the Today tab and day detail. plannedWorkoutTitle keeps
  // the prescription for a "planned X → did Y" subtitle when they differ.
  const display = deriveDayDisplay({
    completedWorkouts: dayWorkouts
      .filter((w) => w.status === "completed")
      .map((w) => ({ id: w.id, title: w.title, startedAt: w.startedAt })),
    todayTask: "workout", // calendar surfaces baseline/deferral via its badge+markers; label only needs the workout name
    activeWorkout: dayTitle ? { title: dayTitle } : null,
    deferredWorkout: null,
  });
  const cellTitle = display.primaryTitle ?? dayTitle;
  const plannedWorkoutTitle =
    display.state === "completed" && display.plannedTitle && display.plannedTitle !== cellTitle
      ? display.plannedTitle
      : null;

  // Same-goal conflicts take precedence (legacy rule).
  // Cross-goal conflict fills cell.conflict ONLY when no same-goal conflict exists.
  // REQ-003: cross-goal conflicts are also skipped on archived cells (see the
  // skipConflicts comment above) — forward-looking advisories don't apply to
  // frozen history.
  const resolvedConflict: CalendarDayCell["conflict"] =
    conflict ??
    (!skipConflicts && args.crossGoalConflictForDate
      ? {
          kind: args.crossGoalConflictForDate.kind,
          withDates: args.crossGoalConflictForDate.withDates,
          goalId: args.crossGoalConflictForDate.goalId,
          label: args.crossGoalConflictForDate.label,
        }
      : null);

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
    dayTitle: cellTitle,
    plannedWorkoutTitle,
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
    planSource, // REQ-003: new
  };
}

// (scheduledBaselineTests was deleted here — buildCell now takes the scheduled
// set from rotation-core's mergeDayOverride, the same code resolveDay and the
// XP ledger consume.)

// True if a scheduled baseline test for this rotation week already has a logged
// result crediting it — within its checkpoint window for that week (reusing
// checkpointWindows, the same matcher resolveDay/getBaselineSchedule use, so the
// calendar agrees with the day view's ✓), or on the cell date itself (covers an
// override that parks a test outside any window).
function baselineSatisfied(
  test: BaselineTest,
  weekIndex: number,
  cellDate: Date,
  startedOn: Date,
  logged: { date: Date }[] | undefined,
): boolean {
  if (!logged || logged.length === 0) return false;
  const windows = checkpointWindows(test, startedOn);
  const win = windows.find((w) => w.week === weekIndex) ?? windows[0];
  const cellDay = startOfDay(cellDate).getTime();
  return logged.some((r) => {
    if (win && r.date >= startOfDay(win.windowStart) && r.date < win.windowEnd) return true;
    return startOfDay(r.date).getTime() === cellDay;
  });
}

/**
 * The single authoritative answer to "what is today's training task", AFTER all
 * overrides, baseline, and hike deferrals are applied. Consumers should switch on
 * `todayTask` and read `activeWorkout` / `deferredWorkout` — they must NOT re-derive
 * the day's task from `workoutTemplate` + the `*DeferredFor*` flags (doing so
 * inconsistently is what caused the deferred rotation workout to still render
 * alongside baseline tests). See `deriveTodayTask`.
 *
 *  - "workout"     — train the prescribed rotation session (it's in `activeWorkout`).
 *  - "rest"        — rest / active-recovery day (`activeWorkout` is the rest template).
 *  - "baseline"    — baseline tests ARE the session (see `baselinesDue`); the rotation
 *                    workout stepped aside and is in `deferredWorkout`.
 *  - "hike"        — a planned hike IS the session (see `plannedHikeToday`); the rotation
 *                    workout stepped aside and is in `deferredWorkout`.
 *  - "out_of_plan" — no plan covers today (`activeWorkout` and `deferredWorkout` null).
 */
export type TodayTask = "workout" | "rest" | "baseline" | "hike" | "out_of_plan";

export type ResolvedDay = {
  date: Date;
  dateKey: string;
  isInPlan: boolean;
  isGoalDate: boolean;
  rotationDay: number | null;
  weekIndex: number | null;
  // ── Authoritative, deferral-aware resolution (single source of truth) ──
  // Switch on todayTask; render activeWorkout as the day's task and deferredWorkout
  // (when non-null) as a clearly-labelled "stepped aside" secondary. The old raw
  // `workoutTemplate` field was removed — it always equalled `activeWorkout ?? deferredWorkout`
  // but, being deferral-unaware, shadowed/contradicted the resolved view. For "the full
  // prescription regardless of deferral" use `activeWorkout ?? deferredWorkout`.
  todayTask: TodayTask;
  activeWorkout: DayTemplate | null; // the workout to PRESENT as today's task; null on baseline/hike/out_of_plan
  deferredWorkout: DayTemplate | null; // the rotation workout set aside by a deferral; non-null only on baseline/hike
  isOverride: boolean;
  // @deprecated Prefer todayTask === "baseline" + deferredWorkout. Retained for one
  // release for saved-prompt / MCP-consumer compatibility; equals todayTask === "baseline".
  // True when baseline tests are due on this rotation day and the prescribed
  // (non-rest) session steps aside — the test IS the day's work. A max-effort
  // benchmark is itself a hard session; you don't test AND train heavy the same day.
  workoutDeferredForBaseline: boolean;
  // Flag A — populated on any date that has a planned hike. The hike's detail
  // is surfaced so the coach can display route/pack weight without a second call.
  plannedHikeToday: {
    id: string;
    route: string;
    distanceMi: number;
    elevationFt: number;
    packWeightLb: number | null;
    durationMin: number;
    date: Date;
  } | null;
  // @deprecated Prefer todayTask === "hike" + deferredWorkout. Retained for one release
  // for saved-prompt / MCP-consumer compatibility; equals todayTask === "hike".
  // True when a planned hike sits on this date AND the rotation template prescribes a
  // non-rest session AND no explicit override is present.
  workoutDeferredForHike: boolean;
  // Flag B — the loud conflict signal for the long-endurance rotation day. Set on the
  // long-endurance slot when a planned hike exists elsewhere in the same rotation week AND no
  // override has already resolved the day. workoutTemplate is left fully populated —
  // nothing is silently rewritten.
  longEffortConflict: {
    rotationLongEffortDate: string; // dateKey ("yyyy-mm-dd") of the long-endurance slot
    plannedHikeDates: string[]; // dateKey(s) of hike(s) planned elsewhere this week
  } | null;
  // Flag C — orphaned mirror-override guard (general; see src/lib/override-integrity.ts).
  // True when this date's session comes from an override whose workoutJson MIRRORS a
  // first-class scheduled object (today only a hike: category "long-endurance") but no
  // backing object (ANY status — not just "planned") is present for the date — a phantom
  // session left behind when the object was removed/rescheduled (only its own row is
  // cleaned up, not the mirror override). Surfaces the get_day vs object-tool disagreement
  // instead of hiding it. Both the classifier (matchingMirrorKind) AND the backing-presence
  // check (kind.backingDateKeys()) are registry-driven and kind-agnostic — this is the same
  // any-status "does a real Hike row exist on this date" definition the lint_plan path uses,
  // not plannedHikeToday (which reconcileLongEffort unconditionally nulls on override days,
  // and which only ever considered status:"planned" hikes within the rotation week — both
  // wrong signals for this check). A new mirror kind only needs its registry entry; nothing
  // here is hike-specific anymore.
  orphanedOverride: boolean;
  nutritionText: string | null;
  nutritionPlan: NutritionPlan | null;
  mobilityText: string | null;
  notes: string | null;
  workouts: { id: string; startedAt: Date; title: string | null; exerciseCount: number; status: string; notes: string | null }[];
  loggedNutrition: {
    id: string;
    date: Date;
    mealType: string;
    items: unknown;
    notes: string | null;
    calories: number | null;
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
    fiberG: number | null;
    sodiumMg: number | null;
  }[];
  baselinesDue: {
    test: BaselineTest;
    baselineDay: BaselineDay;
    checkpoint: "initial" | "retest";
    loggedOnDate: { id: string; value: number; units: string; date: Date } | null;
  }[];
  notesAboutDate: { id: string; body: string; type: string; date: Date; targetDate: Date | null }[];
  goalObjective: string | null;
  // Track 2: confidence state — same derivation as CalendarDayCell.confidence.
  // Allows get_day / get_today_plan to surface confidence to the coach without
  // a second query (program snapshot already carries confirmedThroughDate).
  confidence: "past" | "confirmed" | "provisional" | null;
  // Only fields actively set on the row are included. Absence of a key means
  // "not overriding this field" (rotation default applies). Presence of a
  // non-null value means the override is driving that field.
  override?: {
    id: string;
    workoutJson?: unknown;
    baselineTestNames?: unknown;
    nutritionText?: string;
    nutritionPlan?: NutritionPlan;
    mobilityText?: string;
    notes?: string;
  } | null;
  /** REQ-104: Non-focus active goals' events for this date. Default []. */
  otherGoalEvents: GoalEvent[];
  /** REQ-104: Cross-goal conflicts touching this date. Default []. */
  crossGoalConflicts: CrossGoalConflict[];
  /** REQ-003: which plan this date resolved against, if any — the live active
   *  plan ("active"), or an archived plan resurfaced because it covers this
   *  past date ("archived"). null when no plan covers this date at all
   *  (out_of_plan). Drives the "Archived plan · {name}" badge + write-form
   *  suppression on /days/[dateKey] (REQ-004). */
  resolvedPlan: { id: string; name: string; source: "active" | "archived" } | null;
  /** #282 (plan §4.2): the active multi-domain Program's membership context,
   *  from getActiveProgramMembership(). DISTINCT from `resolvedPlan` (which
   *  stays the rotation-plan pointer, untouched): this is the Program row's
   *  OWN id + member goals. null when the user has no ACTIVE Program row —
   *  resolveDay never synthesizes one from the legacy isFocus path, so
   *  zero-Program tenants see null here and identical values everywhere else. */
  program: {
    id: string;
    name: string;
    status: string;
    startedOn: Date;
    endsOn: Date | null;
    memberGoals: { id: string; objective: string; kind: string; status: string }[];
  } | null;
  /** #282: today's ScheduledItem rows unioned across EVERY member goal of the
   *  active Program (not just the rotation-owning goal) — single findMany,
   *  goalId IN memberIds, this date's USER_TZ window, scoped db. Each row
   *  carries its owning goalId + objective so a per-item goal badge renders
   *  without a second lookup (RFC D5 point 2). Always present; [] when there
   *  is no active Program or no member goal has items today. */
  scheduledItemsToday: {
    id: string;
    goalId: string;
    goalObjective: string | null;
    type: string;
    title: string;
    detail: string | null;
    status: string;
    completedAt: Date | null;
  }[];
  /** #282: per-member-goal day-service claims for badging — the PLAN side of
   *  "which goals does today serve", derived cheaply from data resolveDay
   *  already has (no ActivityGoalLink reads). Claim vocabulary:
   *    - "rotation"            — this goal owns the plan the day resolved
   *                              against and the date is in that plan's window
   *    - "scheduled_item"      — ≥1 ScheduledItem for this goal today
   *    - "baseline:<testName>" — a baseline due today matches one of this
   *                              goal's `baseline:<testName>` target metrics
   *    - "nutrition"           — fitness-kind goal (a meal logged today would
   *                              auto-link to it — mirrors evaluateNutritionLinks)
   *  Claims are computed for status==="active" member goals only (defensive
   *  filter mirroring attribution.ts's activeMembers); non-active members
   *  appear with claims: []. The LOGGED-side fill state (which claims were
   *  actually satisfied, via ActivityGoalLink rows) is deliberately NOT here —
   *  it lands with the unified-Today UI story, which reads links. Always
   *  present; [] when there is no active Program. */
  goalMarks: {
    goalId: string;
    objective: string;
    kind: string;
    claims: string[];
  }[];
};

/**
 * Optional pre-assembled context for resolveDay.
 *
 * When provided, resolveDay performs zero extra goal-event DB queries (useful
 * when the caller (get_week, Today page) has already fetched events for the
 * whole week and wants to avoid redundant round-trips).
 *
 * When absent, resolveDay fetches events internally:
 *   - in-plan dates: rotation week window (same window as plannedHikesThisWeek)
 *   - out-of-plan dates: calendar-week ± raceProximityDays days so
 *     same-week and proximity conflict kinds can still fire (DC-2 fix).
 * Query budget delta when ctx absent: +5 (getGoalEventsResult internals) per call.
 */
export type ResolveDayCtx = {
  /** Pre-fetched events for the range. resolveDay filters to this date's events. */
  goalEvents: GoalEvent[];
  /**
   * Pre-computed cross-goal conflicts for the range.
   * When present, resolveDay filters to this date's conflicts (zero extra computation).
   * When absent, resolveDay computes them inline (pure, no DB).
   */
  crossGoalConflicts?: CrossGoalConflict[];
  /** The focus goal's id (from GoalEventsResult.focusGoalId). */
  focusGoalId: string | null;
  /**
   * REQ-003: the already-resolved program for this date (S1's per-day pick —
   * e.g. get_week fetches the candidate list once and hands resolveDay each
   * day's own pickProgramForDate result). Semantics are keyed on whether the
   * KEY is present with a defined value, not on truthiness:
   *   - `program` key absent, or present as `undefined` → resolveDay looks up
   *     getProgramForDate(date) itself (existing behavior, zero change for
   *     every caller that doesn't know about this field yet).
   *   - `program` explicitly provided (including `null`) → used as-is, no
   *     lookup. `null` means "caller already determined no plan covers this
   *     date" — resolveDay must not override that with its own guess.
   */
  program?: ProgramForDate | null;
  /**
   * #282: the active Program's membership context, pre-fetched by callers
   * that resolve a RANGE of days (get_week) so 7 resolveDay calls don't issue
   * 7 redundant getActiveProgramMembership() queries. Same key-presence
   * semantics as `program` above:
   *   - key absent / `undefined` → resolveDay looks up
   *     getActiveProgramMembership() itself (joined to the internal
   *     Promise.all — one extra parallel query).
   *   - explicitly provided (including `null`) → used as-is, no lookup.
   *     `null` means "caller already determined there is no active Program".
   */
  membership?: ActiveProgramMembership | null;
};

/**
 * The single place deferral intent becomes a concrete task. Given the raw
 * (override-aware) rotation template and the already-computed deferral flags,
 * return the authoritative task kind plus the active/deferred split.
 *
 * Pure — no I/O — so the contract is testable and every consumer inherits the
 * exact same resolution instead of re-deriving it from the flags.
 */
export function deriveTodayTask(
  workoutTemplate: DayTemplate | null,
  flags: { deferredForBaseline: boolean; deferredForHike: boolean },
): { todayTask: TodayTask; activeWorkout: DayTemplate | null; deferredWorkout: DayTemplate | null } {
  if (workoutTemplate === null) {
    return { todayTask: "out_of_plan", activeWorkout: null, deferredWorkout: null };
  }
  // Baseline outranks hike (a max-effort benchmark is the hardest thing on the day).
  if (flags.deferredForBaseline) {
    return { todayTask: "baseline", activeWorkout: null, deferredWorkout: workoutTemplate };
  }
  if (flags.deferredForHike) {
    return { todayTask: "hike", activeWorkout: null, deferredWorkout: workoutTemplate };
  }
  if (workoutTemplate.category === "rest") {
    return { todayTask: "rest", activeWorkout: workoutTemplate, deferredWorkout: null };
  }
  return { todayTask: "workout", activeWorkout: workoutTemplate, deferredWorkout: null };
}

export type DayDisplayState =
  | "completed"
  | "planned"
  | "deferred"
  | "baseline"
  | "rest"
  | "out_of_plan";

/**
 * The single source of truth for "what workout does this date show". Every
 * surface (Today tab, calendar label, day detail) feeds in its already-fetched
 * data and renders from the result — none reads `workouts[]` or the rotation
 * template directly, so they can't disagree on a swap/audible day.
 *
 * Precedence: a COMPLETED workout wins — if one exists, it is the primary and
 * the prescription becomes `plannedTitle` (for "planned X → did Y"). Among
 * multiple completed workouts the latest-started one is primary. Otherwise fall
 * through to the prescribed / deferred / baseline / rest resolution (`todayTask`).
 *
 * Pure — no IO. `completedWorkouts` must already be filtered to status==="completed".
 */
export function deriveDayDisplay(input: {
  completedWorkouts: { id: string; title: string | null; startedAt: Date }[];
  todayTask: TodayTask;
  activeWorkout: { title: string } | null;
  deferredWorkout: { title: string } | null;
}): {
  state: DayDisplayState;
  primaryTitle: string | null;
  plannedTitle: string | null;
  primaryWorkoutId: string | null;
} {
  const plannedTitle = input.activeWorkout?.title ?? input.deferredWorkout?.title ?? null;

  if (input.completedWorkouts.length > 0) {
    const primary = input.completedWorkouts.reduce((a, b) =>
      b.startedAt.getTime() > a.startedAt.getTime() ? b : a,
    );
    return {
      state: "completed",
      primaryTitle: primary.title ?? "Workout",
      plannedTitle,
      primaryWorkoutId: primary.id,
    };
  }

  const state: DayDisplayState =
    input.todayTask === "baseline"
      ? "baseline"
      : input.todayTask === "hike"
        ? "deferred"
        : input.todayTask === "rest"
          ? "rest"
          : input.todayTask === "out_of_plan"
            ? "out_of_plan"
            : "planned";
  return { state, primaryTitle: plannedTitle, plannedTitle, primaryWorkoutId: null };
}

/**
 * #282: extract the test names from a goal's `baseline:<testName>` target
 * metrics. Pure + defensive — targets is untrusted Json (same trust boundary
 * as planJson), so anything non-array / non-{metric:string} is skipped rather
 * than thrown. Deliberately a minimal inline parse instead of importing
 * goal-targets.ts (server-only readiness plumbing stays out of calendar.ts —
 * CLAUDE.md: no readiness imports here).
 */
function baselineTestNamesFromTargets(targets: unknown): string[] {
  if (!Array.isArray(targets)) return [];
  const out: string[] = [];
  for (const t of targets) {
    const metric = (t as { metric?: unknown } | null)?.metric;
    if (typeof metric === "string" && metric.startsWith("baseline:")) {
      out.push(metric.slice("baseline:".length));
    }
  }
  return out;
}

export async function resolveDay(date: Date, ctx?: ResolveDayCtx): Promise<ResolvedDay> {
  // REQ-003: `ctx.program` explicitly provided (including `null`) short-circuits
  // the lookup — the caller (get_week's per-day pick, the month view) already
  // resolved it via the shared pure pickProgramForDate. Otherwise, fall back to
  // the time-aware lookup (Today-page-identical when the active program covers
  // `date`; resurfaces the covering archived plan for a strictly-past date;
  // getActiveProgram()-identical fallback otherwise) — see program.ts's
  // getProgramForDate for the full contract.
  const program: ProgramForDate | null =
    ctx?.program !== undefined ? ctx.program : await getProgramForDate(date);
  const db = await getDb();
  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);

  // --- hoist: pure rotation math (no DB) ---
  // Moved above Promise.all so weekWindow is known in time to join the parallel fetch.
  // C-1: these declarations replace the post-Promise.all let declarations (now removed).
  // B4/A3: the math itself is rotation-core's — the same primitives buildCell
  // and the XP ledger consume.
  let isInPlan = false;
  let rotationDay: number | null = null;
  let weekIndex: number | null = null;
  let weekWindow: { start: Date; end: Date } | null = null;

  if (program) {
    const pos = rotationPosition(program.startedOn, program.template.totalWeeks, dayStart);
    if (pos.isInPlan) {
      isInPlan = true;
      rotationDay = pos.rotationDay;
      weekIndex = pos.weekIndex;
      weekWindow = rotationWeekWindow(program.startedOn, weekIndex!);
    }
  }

  const [workouts, override, notesForDate, goal, nutrition, plannedHikesThisWeek, preloadedGoalEvents, membership] = await Promise.all([
    db.workout.findMany({
      where: { startedAt: { gte: dayStart, lte: dayEnd } },
      include: { exercises: { select: { id: true } } },
      orderBy: { startedAt: "asc" },
    }),
    program?.id
      ? prisma.planDayOverride.findUnique({
          where: { planId_date: { planId: program.id, date: dayStart } },
        })
      : Promise.resolve(null),
    db.note.findMany({
      where: {
        OR: [
          { targetDate: { gte: dayStart, lte: dayEnd } },
          // Also include notes written on this same date (no target).
          { date: { gte: dayStart, lte: dayEnd }, targetDate: null },
        ],
      },
      orderBy: { date: "desc" },
    }),
    db.goal.findFirst({
      where: { isFocus: true },
      orderBy: { updatedAt: "desc" },
      select: { id: true, targetDate: true, objective: true },
    }),
    db.nutritionLog.findMany({
      where: { date: { gte: dayStart, lte: dayEnd } },
      orderBy: { date: "asc" },
    }),
    // Planned hikes this rotation week — gated on being in-plan so the query
    // only runs when weekWindow is known. Resolves [] for out-of-plan dates.
    weekWindow
      ? db.hike.findMany({
          where: {
            status: "planned",
            date: { gte: weekWindow.start, lte: weekWindow.end },
          },
          select: {
            id: true,
            route: true,
            distanceMi: true,
            elevationFt: true,
            packWeightLb: true,
            durationMin: true,
            date: true,
          },
          orderBy: { date: "asc" },
        })
      : Promise.resolve([] as {
          id: string; route: string; distanceMi: number; elevationFt: number;
          packWeightLb: number | null; durationMin: number; date: Date;
        }[]),
    // REQ-104 (7th item): goal events for cross-goal conflict detection.
    // Query budget delta when ctx absent: +5 (getGoalEventsResult internals).
    //   ctx present          → 0 extra queries (use pre-assembled events)
    //   in-plan (weekWindow) → getGoalEventsResult for the rotation week
    //   out-of-plan          → getGoalEventsResult for calendar-week ±raceProximityDays days (DC-2 fix)
    //     so same-week and proximity conflict kinds fire for get_day calls outside
    //     the focus plan window (e.g. a race date beyond plan.totalWeeks*7).
    // Always resolves to GoalEventsResult for uniform downstream handling.
    ctx
      ? Promise.resolve<import("@/lib/goal-events").GoalEventsResult>({
          events: ctx.goalEvents,
          focusGoalId: ctx.focusGoalId,
          otherGoalsMeta: [],
        })
      : weekWindow
        ? getGoalEventsResult({ start: weekWindow.start, end: weekWindow.end })
        : getGoalEventsResult({
            start: addDays(startOfWeekMonday(date), -CROSS_GOAL_RULES.raceProximityDays),
            end: addDays(endOfWeekSunday(date), CROSS_GOAL_RULES.raceProximityDays),
          }),
    // #282 (8th item): the active Program's membership — one extra parallel
    // query, or zero when the caller pre-fetched it (get_week's per-week ctx).
    // Key-presence semantics match ctx.program: explicitly-provided null means
    // "caller already determined there is no active Program".
    ctx?.membership !== undefined
      ? Promise.resolve(ctx.membership)
      : getActiveProgramMembership(),
  ]);

  // REQ-104: cross-goal event + conflict computation.
  // preloadedGoalEvents is always a GoalEventsResult (ctx branch wraps into one).
  const { events: goalEventsForRange, focusGoalId } = preloadedGoalEvents;
  const thisDk = dateKey(date);

  const otherEventsForDate = filterOtherGoalEvents(
    eventsByDateKey(goalEventsForRange).get(thisDk) ?? [],
    focusGoalId,
  );

  // Use pre-computed conflicts from ctx when available; otherwise compute inline (pure, no DB).
  const cgConflicts: CrossGoalConflict[] =
    ctx?.crossGoalConflicts !== undefined
      ? ctx.crossGoalConflicts.filter((c) => c.dateKey === thisDk)
      : computeCrossGoalConflicts({
          events: goalEventsForRange,
          focusGoalId,
          focusProgram: program,
          plannedHikeDateKeys: plannedHikesThisWeek.map((h) => dateKey(h.date)),
          overrideDateKeys: override?.workoutJson ? [thisDk] : [],
          range: weekWindow ?? { start: dayStart, end: dayEnd },
        }).filter((c) => c.dateKey === thisDk);

  // workoutTemplate and isOverride depend on the post-Promise.all `override` value.
  // D-1: declare alongside workoutTemplate/isOverride so the single return always sees them.
  let workoutTemplate: DayTemplate | null = null;
  let isOverride = false;
  const baselinesDue: ResolvedDay["baselinesDue"] = [];
  let plannedHikeToday: ResolvedDay["plannedHikeToday"] = null;
  let workoutDeferredForHike = false;
  let longEffortConflict: ResolvedDay["longEffortConflict"] = null;

  if (isInPlan && program && rotationDay !== null && weekIndex !== null) {
    // B4/A3: override→template precedence + the scheduled-baseline set come
    // from rotation-core's mergeDayOverride — the SAME decision code buildCell
    // and the XP ledger consume. Override list path: exact names, unknown
    // names dropped, empty array = explicitly none, week filter bypassed (a
    // deferred "initial" can land outside its scheduled week). Native path:
    // the rotation day's tests due this week. Only the DB work (matching
    // logged results) remains here.
    const core = mergeDayOverride(program.template, rotationDay, weekIndex, override);
    workoutTemplate = core.workoutTemplate;
    isOverride = core.isOverride;

    if (core.baselineTests.length > 0) {
      // Match logged results within each test's checkpoint credit window
      // (shared with get_baseline_schedule via checkpointWindows), not just on
      // this exact date — an early, off-schedule retest still counts (the Wk-7
      // lower battery logged three days ahead read as undone on its scheduled
      // day). The day itself is always included too, so an override that
      // parks a test outside any window still sees a same-day log.
      const dayEndExcl = new Date(dayEnd.getTime() + 1);
      const matchTargets = core.baselineTests.map(({ test, baselineDay, checkpoint }) => {
        const windows = checkpointWindows(test, program.startedOn);
        const cp =
          checkpoint === "retest"
            ? windows.find((w) => w.label === "retest" && w.week === weekIndex)
            : windows[0];
        const from =
          cp && startOfDay(cp.windowStart) < dayStart ? startOfDay(cp.windowStart) : dayStart;
        const to = cp && cp.windowEnd > dayEndExcl ? cp.windowEnd : dayEndExcl;
        return { test, baselineDay, checkpoint, from, to };
      });

      const logged = await db.baseline.findMany({
        where: {
          OR: matchTargets.map((m) => ({
            testName: m.test.testName,
            date: { gte: m.from, lt: m.to },
          })),
        },
        orderBy: { date: "asc" },
      });

      for (const { test, baselineDay, checkpoint, from, to } of matchTargets) {
        // Earliest result within this test's window (rows are date-asc) — same
        // pick as the schedule view's statusFor, so a past initial day keeps
        // showing its own week-1 result rather than a later retest that also
        // lands in the overlapping window.
        const result = logged.find(
          (b) => b.testName === test.testName && b.date >= from && b.date < to,
        );
        const loggedOnDate = result
          ? { id: result.id, value: result.value, units: result.units, date: result.date }
          : null;
        baselinesDue.push({ test, baselineDay, checkpoint, loggedOnDate });
      }
    }

    // D-1: assign via destructuring assignment (not const), inside the if block.
    // reconcileLongEffort uses the already-resolved isOverride (workoutJson-based,
    // consistent with C-2) so flags are suppressed when the coach has overridden.
    ({ plannedHikeToday, workoutDeferredForHike, longEffortConflict } = reconcileLongEffort({
      rotationDay,
      weekIndex,
      thisDateKey: dateKey(date),
      plannedHikesThisWeek,
      isOverride,
      workoutTemplate,
    }));
  }

  // ── #282: program-shaped context (scheduledItemsToday union + goalMarks) ──
  // Runs ONLY for users with an active Program (membership non-null with
  // members) — zero-Program tenants pay nothing beyond the membership lookup
  // already in the Promise.all above. Sits after the in-plan block because
  // goalMarks' baseline claims read the finished baselinesDue list; the two
  // queries here are one serial round-trip for Program users only (same
  // pattern as the serial baseline.findMany above).
  let scheduledItemsToday: ResolvedDay["scheduledItemsToday"] = [];
  let goalMarks: ResolvedDay["goalMarks"] = [];
  if (membership && membership.memberGoals.length > 0) {
    const memberIds = membership.memberGoals.map((g) => g.id);
    const [itemRows, memberGoalDetails] = await Promise.all([
      db.scheduledItem.findMany({
        where: { goalId: { in: memberIds }, date: { gte: dayStart, lte: dayEnd } },
        orderBy: { date: "asc" },
        select: {
          id: true,
          goalId: true,
          type: true,
          title: true,
          detail: true,
          status: true,
          completedAt: true,
        },
      }),
      // Per-goal detail the claims need: baseline target metrics + which plans
      // each member goal owns (identifies the rotation-owning goal without a
      // separate Plan lookup; includes non-active plans so a past date resolved
      // against an archived member plan still gets its rotation claim).
      db.goal.findMany({
        where: { id: { in: memberIds } },
        select: { id: true, targets: true, plans: { select: { id: true } } },
      }),
    ]);

    const objectiveById = new Map(membership.memberGoals.map((g) => [g.id, g.objective]));
    scheduledItemsToday = itemRows.map((row) => ({
      id: row.id,
      goalId: row.goalId,
      goalObjective: objectiveById.get(row.goalId) ?? null,
      type: row.type,
      title: row.title,
      detail: row.detail,
      status: row.status,
      completedAt: row.completedAt ?? null,
    }));

    const rotationOwnerGoalId =
      program !== null
        ? memberGoalDetails.find((g) => g.plans.some((p) => p.id === program.id))?.id ?? null
        : null;
    const baselineTargetsByGoal = new Map(
      memberGoalDetails.map((g) => [g.id, baselineTestNamesFromTargets(g.targets)]),
    );
    const goalsWithItemsToday = new Set(itemRows.map((r) => r.goalId));

    goalMarks = membership.memberGoals.map((g) => {
      const claims: string[] = [];
      if (g.status === "active") {
        if (isInPlan && rotationOwnerGoalId === g.id) claims.push("rotation");
        if (goalsWithItemsToday.has(g.id)) claims.push("scheduled_item");
        const baselineTargets = baselineTargetsByGoal.get(g.id) ?? [];
        for (const due of baselinesDue) {
          if (baselineTargets.includes(due.test.testName)) {
            claims.push(`baseline:${due.test.testName}`);
          }
        }
        if (g.kind === "fitness") claims.push("nutrition");
      }
      return { goalId: g.id, objective: g.objective, kind: g.kind, claims };
    });
  }

  const isGoalDate = !!goal && !!goal.targetDate && dateKey(goal.targetDate) === dateKey(date);

  // On a test day the benchmark replaces the prescribed session. Only defer a
  // real session (not rest, not a user's explicit workout override) — and only
  // when there is still an UNLOGGED test to do. If every baseline due today is
  // already logged (e.g. a retest done early, within its credit window), there's
  // nothing to step aside for, so the workout stays active.
  const hasUnloggedBaseline = baselinesDue.some((b) => b.loggedOnDate === null);
  const workoutDeferredForBaseline =
    hasUnloggedBaseline &&
    !isOverride &&
    !!workoutTemplate &&
    workoutTemplate.category !== "rest";

  // Track 2: confidence state for MCP parity (get_day / get_today_plan).
  const isPastForConfidence = dayStart.getTime() < startOfDay(new Date()).getTime();
  const confidence = deriveConfidence(dayStart, isInPlan, isPastForConfidence, program);

  // Collapse the rotation template + deferral flags into the single authoritative
  // task. Done once here so no consumer has to remember to honor the flags.
  const { todayTask, activeWorkout, deferredWorkout } = deriveTodayTask(workoutTemplate, {
    deferredForBaseline: workoutDeferredForBaseline,
    deferredForHike: workoutDeferredForHike,
  });

  // Flag C: a mirror-override (today: hike-flavored) with no backing object on the date is
  // a phantom session (see ResolvedDay.orphanedOverride). Bug fix (#266): this USED to gate
  // on `plannedHikeToday === null`, but reconcileLongEffort (above) unconditionally nulls
  // plannedHikeToday whenever isOverride is true, and even when it wasn't null it only ever
  // reflected status:"planned" hikes in the rotation week — so the old expression algebraically
  // reduced to `isOverride && isMirrorOverride(workoutTemplate)` and flagged every summit-day
  // override as orphaned regardless of whether a real Hike row backed it. Fixed by reusing the
  // registry's own any-status backing check (src/lib/override-integrity.ts), the same
  // definition the lint_plan path uses — gated on isOverride+mirror-match first so the DB
  // lookup only runs on the rare mirror-override day, not every resolveDay call.
  const overrideMirrorKind = isOverride ? matchingMirrorKind(workoutTemplate) : null;
  const orphanedOverride = overrideMirrorKind
    ? !(await overrideMirrorKind.backingDateKeys()).has(dateKey(date))
    : false;

  // REQ-003: additive — which plan this date resolved against, if any.
  const resolvedPlan: ResolvedDay["resolvedPlan"] = program
    ? { id: program.id, name: program.name, source: program.source }
    : null;

  // #282: additive — the active Program's own context (id here is the PROGRAM
  // row id, never a Plan id; the rotation-plan pointer stays `resolvedPlan`).
  const programMembership: ResolvedDay["program"] = membership
    ? {
        id: membership.id,
        name: membership.name,
        status: membership.status,
        startedOn: membership.startedOn,
        endsOn: membership.endsOn,
        memberGoals: membership.memberGoals.map((g) => ({
          id: g.id,
          objective: g.objective,
          kind: g.kind,
          status: g.status,
        })),
      }
    : null;

  return {
    date: dayStart,
    dateKey: dateKey(date),
    isInPlan,
    isGoalDate,
    rotationDay,
    weekIndex,
    todayTask,
    activeWorkout,
    deferredWorkout,
    isOverride,
    workoutDeferredForBaseline,
    plannedHikeToday,
    workoutDeferredForHike,
    longEffortConflict,
    orphanedOverride,
    nutritionText: override?.nutritionText ?? null,
    nutritionPlan: parseStoredNutritionPlan(override?.nutritionPlan),
    mobilityText: override?.mobilityText ?? null,
    notes: override?.notes ?? null,
    workouts: workouts.map((w) => ({
      id: w.id,
      startedAt: w.startedAt,
      title: w.title,
      exerciseCount: w.exercises.length,
      status: w.status,
      notes: w.notes,
    })),
    loggedNutrition: nutrition.map((n) => ({
      id: n.id,
      date: n.date,
      mealType: n.mealType,
      items: n.items,
      notes: n.notes,
      calories: n.calories,
      proteinG: n.proteinG,
      carbsG: n.carbsG,
      fatG: n.fatG,
      fiberG: n.fiberG,
      sodiumMg: n.sodiumMg,
    })),
    baselinesDue,
    notesAboutDate: notesForDate.map((n) => ({
      id: n.id,
      body: n.body,
      type: n.type,
      date: n.date,
      targetDate: n.targetDate,
    })),
    goalObjective: isGoalDate ? goal?.objective ?? null : null,
    confidence,
    override: override
      ? {
          id: override.id,
          // Omit fields that are null in the DB so the absence of a key is a
          // clear signal that the override isn't driving that field. Callers
          // that need the resolved value (with rotation defaults applied)
          // should read the top-level resolved fields (workoutTemplate,
          // nutritionText, mobilityText, notes) instead.
          ...(override.workoutJson != null && { workoutJson: override.workoutJson }),
          ...(override.baselineTestNames != null && {
            baselineTestNames: override.baselineTestNames,
          }),
          ...(override.nutritionText != null && { nutritionText: override.nutritionText }),
          ...(parseStoredNutritionPlan(override.nutritionPlan) && {
            nutritionPlan: parseStoredNutritionPlan(override.nutritionPlan)!,
          }),
          ...(override.mobilityText != null && { mobilityText: override.mobilityText }),
          ...(override.notes != null && { notes: override.notes }),
        }
      : null,
    // REQ-104: cross-goal fields.
    otherGoalEvents: otherEventsForDate,
    crossGoalConflicts: cgConflicts,
    resolvedPlan, // REQ-003: new
    // #282: program-shaped additions (additive; null/[]/[] for zero-Program tenants).
    program: programMembership,
    scheduledItemsToday,
    goalMarks,
  };
}

// --- Today helpers ---

export async function getBaselinesDueToday(now: Date = new Date()): Promise<ResolvedDay["baselinesDue"]> {
  const r = await resolveDay(now);
  return r.baselinesDue;
}

// templateForRotationDay / isDateWithinActivePlanWindow /
// rotationBaselineNamesForDate moved to rotation-core.ts (B4/A3) and are
// re-exported at the top of this file — every `@/lib/calendar` importer keeps
// working unchanged.

/** Unresolved notes + a link target into the active plan's goal. */
export async function getPendingNotesCount(): Promise<{ count: number; goalId: string | null; planId: string | null }> {
  const db = await getDb();
  const [plan, count] = await Promise.all([
    db.plan.findFirst({
      where: { active: true, goal: { isFocus: true } },
      orderBy: { updatedAt: "desc" },
      include: { goal: { select: { id: true } } },
    }),
    // Only count notes that actually call for a coaching decision: audibles
    // (plan changes) and feedback. Journals are diary entries you rarely
    // "resolve", and standing_rules are never resolved by design — counting
    // them inflated this number into a permanent, misleading to-do badge.
    db.note.count({ where: { resolvedAt: null, type: { in: ["audible", "feedback"] } } }),
  ]);
  if (!plan) return { count, goalId: null, planId: null };
  return { count, goalId: plan.goal.id, planId: plan.id };
}

// --- Long-effort reconciliation helpers ---

// (The private rotationWeekWindow helper moved to rotation-core.ts — same
// formula, takes startedOn instead of the full snapshot.)

// Pure — no DB, no await, no side effects, no mutation.
// Takes the already-fetched week hikes and the already-resolved template/flags.
// Returns only the three advisory flags; workoutTemplate is never touched.
export function reconcileLongEffort(args: {
  rotationDay: number;
  weekIndex: number;
  thisDateKey: string;
  plannedHikesThisWeek: {
    id: string;
    route: string;
    distanceMi: number;
    elevationFt: number;
    packWeightLb: number | null;
    durationMin: number;
    date: Date;
  }[];
  isOverride: boolean;
  workoutTemplate: DayTemplate | null;
}): {
  plannedHikeToday: ResolvedDay["plannedHikeToday"];
  workoutDeferredForHike: boolean;
  longEffortConflict: ResolvedDay["longEffortConflict"];
} {
  const {
    thisDateKey, plannedHikesThisWeek,
    isOverride, workoutTemplate,
  } = args;

  // Suppress all flags if an explicit override already drives the day.
  // C-2: isOverride is workoutJson-based — consistent with resolveDay and weekConflicts.
  if (isOverride) {
    return { plannedHikeToday: null, workoutDeferredForHike: false, longEffortConflict: null };
  }

  // Flag A: hike on THIS date.
  const hikeOnThisDay =
    plannedHikesThisWeek.find((h) => dateKey(h.date) === thisDateKey) ?? null;

  const plannedHikeToday: ResolvedDay["plannedHikeToday"] = hikeOnThisDay
    ? {
        id:           hikeOnThisDay.id,
        route:        hikeOnThisDay.route,
        distanceMi:   hikeOnThisDay.distanceMi,
        elevationFt:  hikeOnThisDay.elevationFt,
        packWeightLb: hikeOnThisDay.packWeightLb,
        durationMin:  hikeOnThisDay.durationMin,
        date:         hikeOnThisDay.date,
      }
    : null;

  // workoutDeferredForHike: advisory — a real (non-rest) session steps aside for the
  // hike, mirroring workoutDeferredForBaseline. Does NOT remove the gym session.
  const workoutDeferredForHike =
    hikeOnThisDay !== null &&
    workoutTemplate !== null &&
    workoutTemplate.category !== "rest";

  // Flag B: long-effort conflict — only on the long-endurance rotation slot.
  const hikesElsewhere = plannedHikesThisWeek.filter((h) => dateKey(h.date) !== thisDateKey);
  const longEffortConflict: ResolvedDay["longEffortConflict"] =
    workoutTemplate?.category === "long-endurance" &&
    hikeOnThisDay === null &&
    hikesElsewhere.length > 0
      ? {
          rotationLongEffortDate: thisDateKey,
          plannedHikeDates: hikesElsewhere.map((h) => dateKey(h.date)),
        }
      : null;

  return { plannedHikeToday, workoutDeferredForHike, longEffortConflict };
}

// Async — queries its own data (planned hikes + overrides for the week).
// Override-aware: a day with a workoutJson override contributes no conflicts
// (the coach has already resolved it). C-2: workoutJson-based override definition
// is consistent with resolveDay's isOverride and reconcileLongEffort.
export async function weekConflicts(
  program: ActiveProgramSnapshot,
  weekIndex: number,
): Promise<WeekConflict[]> {
  const db = await getDb();
  const window = rotationWeekWindow(program.startedOn, weekIndex);

  const [plannedHikes, overrideRows] = await Promise.all([
    db.hike.findMany({
      where: { status: "planned", date: { gte: window.start, lte: window.end } },
      select: { id: true, date: true, route: true },
      orderBy: { date: "asc" },
    }),
    prisma.planDayOverride.findMany({
      where: { planId: program.id, date: { gte: window.start, lte: window.end } },
      // C-2: select workoutJson so we can apply the same override definition as
      // resolveDay — only a workoutJson-bearing row counts as "resolved".
      select: { date: true, workoutJson: true },
    }),
  ]);

  // C-2: overrideKeys only includes rows where workoutJson is set (matches isOverride).
  const overrideKeys = new Set(
    overrideRows.filter((o) => o.workoutJson != null).map((o) => dateKey(o.date)),
  );
  const conflicts: WeekConflict[] = [];

  // --- long-effort conflict ---
  // Derive the long-endurance day from the rotation template rather than
  // hardcoding Day 6, so a re-anchored rotation stays correct.
  const longTmpl = program.template.weeklySplit.find((d) => d.category === "long-endurance");
  if (longTmpl !== undefined) {
    const longDate = dateForRotationSlot(program.startedOn, weekIndex, longTmpl.dayOfWeek);
    const longKey  = dateKey(longDate);

    if (!overrideKeys.has(longKey)) {
      const hikeOnLongDay  = plannedHikes.find((h) => dateKey(h.date) === longKey);
      const hikesElsewhere = plannedHikes.filter((h) => dateKey(h.date) !== longKey);
      if (!hikeOnLongDay && hikesElsewhere.length > 0) {
        conflicts.push({
          dateKey: longKey,
          kind: "long-effort",
          withDates: hikesElsewhere.map((h) => dateKey(h.date)),
        });
      }
    }
  }

  // --- retest-on-hike conflicts ---
  // Pure template math — no getBaselineSchedule import needed. Mirrors
  // countBaselinesDueForCell which uses the same week-gate logic.
  for (let relDay = 0; relDay < 7; relDay++) {
    const rotDay  = (relDay + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
    const calDate = dateForRotationSlot(program.startedOn, weekIndex, rotDay);
    const calKey  = dateKey(calDate);

    if (overrideKeys.has(calKey)) continue;

    const baselineDay = program.template.baselineWeek?.find((d) => d.dayOfWeek === rotDay);
    if (!baselineDay) continue;

    const hasDueTests = baselineDay.tests.some((t) => isTestDueInWeek(t, weekIndex));
    if (!hasDueTests) continue;

    const hikeOnThisDay = plannedHikes.find((h) => dateKey(h.date) === calKey);
    if (hikeOnThisDay) {
      conflicts.push({
        dateKey: calKey,
        kind: "retest-on-hike",
        // withDates[0] === calKey here — the hike and retest are on the same day.
        // Track-2 consumers: display as a same-day collision, not a separate date.
        withDates: [dateKey(hikeOnThisDay.date)],
      });
    }
  }

  return conflicts;
}
