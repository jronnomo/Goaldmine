// Helpers to resolve "what's on this date" — combining plan rotation, overrides,
// completed workouts, baselines due, and goal markers.

import { prisma } from "@/lib/db";
import { getActiveProgram, type ActiveProgramSnapshot } from "@/lib/program";
import type { BaselineDay, BaselineTest, DayTemplate } from "@/lib/program-template";
import { type NutritionPlan, parseStoredNutritionPlan } from "@/lib/nutrition-plan";

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
  dayTitle: string | null; // from override or template
  workoutCount: number; // logged gym workouts on this date
  hikeCount: number; // completed hikes on this date — out-of-gym training days
  plannedHikeCount: number; // hikes scheduled but not yet completed (status: "planned")
  hasOverride: boolean;
  baselinesDue: number; // count of due/overdue tests scheduled on this rotation day for this week
  // Normalized conflict for the calendar cell — data only; visual treatment is
  // Track 2 (plan-confidence-calendar.md). null = no conflict or out-of-plan.
  // If a cell has both kinds (theoretically possible but rare), "retest-on-hike"
  // takes precedence as the more immediately actionable signal.
  conflict: { kind: "long-effort" | "retest-on-hike"; withDates: string[] } | null;
  // Track 2: confidence state for the plan-confidence calendar visual.
  //   null        := !isInPlan (out-of-month padding, before startedOn, after endsOn)
  //   "past"      := isInPlan && isPast
  //   "confirmed" := isInPlan && !isPast && confirmedThroughDate >= cell date
  //   "provisional":= isInPlan && (isFuture || isToday) && (no mark OR date > mark)
  confidence: "past" | "confirmed" | "provisional" | null;
};

// Single source of truth for per-week unresolved conflicts.
// Consumed by: weekConflicts() async fn, buildCell (sync subset),
// get_session_brief (current week), plan-lint retest-on-hike-day rule,
// and (Track 2) the confirm_week guard.
export type WeekConflict = {
  dateKey: string; // "yyyy-mm-dd" of the conflicted day
  kind: "long-effort" | "retest-on-hike";
  // For "long-effort": the dates of hikes elsewhere in the week displacing the long-endurance day.
  // For "retest-on-hike": withDates[0] === dateKey — the hike and retest co-occur
  // on the same day; consumers should display this as a same-day collision.
  withDates: string[]; // dateKey(s) of the hike(s) driving the conflict
};

export async function getCalendarMonth(opts: { year: number; month: number /* 0-11 */ }) {
  const { year, month } = opts;
  const program = await getActiveProgram();

  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0); // last day
  // Pad to full weeks: start at Monday of first row, end at Sunday of last row.
  const gridStart = startOfWeekMonday(monthStart);
  const gridEnd = endOfWeekSunday(monthEnd);

  const [workouts, hikes, overrides, goal] = await Promise.all([
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
      where: { active: true },
      // Matches Plan resolution in src/lib/program.ts — most-recently-updated
      // active goal wins. If multiple goals are stuck at active=true (legacy
      // state pre-setActiveGoal), this picks one deterministically.
      orderBy: { updatedAt: "desc" },
      select: { id: true, targetDate: true, objective: true, legend: true },
    }),
  ]);

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

  const overridesByKey = new Map<string, (typeof overrides)[number]>();
  for (const o of overrides) overridesByKey.set(dateKey(o.date), o);

  // Group planned hikes by rotation weekIndex for per-cell conflict computation.
  // Out-of-plan hikes (delta < 0 or >= totalWeeks*7) are excluded — they can't
  // conflict with rotation days.
  const plannedHikesByWeek = new Map<number, typeof hikes>();
  if (program) {
    const pStartMid = startOfDay(program.startedOn);
    for (const h of hikes) {
      if (h.status !== "planned") continue;
      const hStart = startOfDay(h.date);
      const delta = Math.floor((hStart.getTime() - pStartMid.getTime()) / (24 * 3600 * 1000));
      if (delta < 0 || delta >= program.template.totalWeeks * 7) continue;
      const wi = Math.floor(delta / 7) + 1;
      const arr = plannedHikesByWeek.get(wi) ?? [];
      arr.push(h);
      plannedHikesByWeek.set(wi, arr);
    }
  }

  const cells: CalendarDayCell[] = [];
  const now = new Date();
  const todayKey = dateKey(now);
  const goalKey = goal ? dateKey(goal.targetDate) : null;

  // Walk the grid by adding days in USER_TZ so DST transitions don't shear
  // the column alignment.
  for (let cursor = gridStart; cursor.getTime() <= gridEnd.getTime(); cursor = addDays(cursor, 1)) {
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
    });
    cells.push(cell);
  }

  return {
    monthStart,
    monthEnd,
    cells,
    program,
    goal,
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
  program: ActiveProgramSnapshot | null;
  workoutsByKey: Map<string, { id: string; startedAt: Date; status: string; title: string | null }[]>;
  hikesByKey: Map<string, { id: string; date: Date; status: string }[]>;
  plannedHikesByKey: Map<string, { id: string; date: Date; status: string }[]>;
  overridesByKey: Map<string, { workoutJson: unknown; nutritionText: string | null; mobilityText: string | null; baselineTestNames: unknown }>;
  plannedHikesByWeek: Map<number, { id: string; date: Date; status: string }[]>;
}): CalendarDayCell {
  const k = dateKey(args.date);
  const isToday = k === args.todayKey;
  const isPast = !isToday && args.date < startOfDay(new Date());
  const isFuture = !isToday && !isPast;
  const isGoalDate = !!args.goalKey && k === args.goalKey;

  let isInPlan = false;
  let rotationDay: number | null = null;
  let weekIndex: number | null = null;
  let dayTitle: string | null = null;

  if (args.program) {
    const startKey = dateKey(args.program.startedOn);
    const startMid = startOfDay(args.program.startedOn);
    const dMid = startOfDay(args.date);
    const daysDelta = Math.floor((dMid.getTime() - startMid.getTime()) / (24 * 3600 * 1000));
    if (k >= startKey && daysDelta < args.program.template.totalWeeks * 7) {
      isInPlan = true;
      rotationDay = (((daysDelta % 7) + 7) % 7) + 1;
      weekIndex = Math.floor(daysDelta / 7) + 1;
      const override = args.overridesByKey.get(k);
      if (override?.workoutJson) {
        dayTitle = (override.workoutJson as { title?: string }).title ?? "Custom day";
      } else {
        const tmpl = args.program.template.weeklySplit.find((d) => d.dayOfWeek === rotationDay);
        dayTitle = tmpl?.title ?? null;
      }
    }
  }

  const workoutCount = args.workoutsByKey.get(k)?.length ?? 0;
  const hikeCount = args.hikesByKey.get(k)?.length ?? 0;
  const plannedHikeCount = args.plannedHikesByKey.get(k)?.length ?? 0;
  const cellOverride = args.overridesByKey.get(k);
  const hasOverride = cellOverride !== undefined;
  // Override-aware baseline count. An override's baselineTestNames replaces the
  // rotation default for that day — an empty array means "explicitly none"
  // (mirrors resolveDay). Without this, a day that suppressed baselines via an
  // override still showed the week's rotation count on the calendar badge.
  const baselinesDue = !isInPlan
    ? 0
    : Array.isArray(cellOverride?.baselineTestNames)
      ? countBaselinesFromOverride(args.program!, cellOverride.baselineTestNames as string[])
      : countBaselinesDueForCell(args.program!, weekIndex!, rotationDay!);

  // Conflict computation (C-2: only when workoutJson-based override is absent).
  // Override-aware: a day is only "resolved" if workoutJson is set — consistent
  // with resolveDay's isOverride definition and weekConflicts.
  let conflict: CalendarDayCell["conflict"] = null;

  if (isInPlan && rotationDay !== null && weekIndex !== null && args.program) {
    const hasWorkoutOverride = args.overridesByKey.get(k)?.workoutJson != null;

    if (!hasWorkoutOverride) {
      const weekHikes = args.plannedHikesByWeek.get(weekIndex) ?? [];

      // Priority 1: retest-on-hike (more immediately actionable)
      const baselineDay = args.program.template.baselineWeek?.find(
        (d) => d.dayOfWeek === rotationDay,
      );
      if (baselineDay) {
        const hasDueTests = baselineDay.tests.some((t) => {
          const initialWeek = t.initialWeek ?? 1;
          return (
            weekIndex === initialWeek ||
            (weekIndex > initialWeek && (t.retestWeeks?.includes(weekIndex) ?? false))
          );
        });
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

      // Priority 2: long-effort conflict (only on the long-endurance rotation day)
      const tmpl = args.program.template.weeklySplit.find((d) => d.dayOfWeek === rotationDay);
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

  const confidence = deriveConfidence(args.date, isInPlan, isPast, args.program);

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
    hikeCount,
    plannedHikeCount,
    hasOverride,
    baselinesDue,
    conflict,
    confidence,
  };
}

function countBaselinesDueForCell(program: ActiveProgramSnapshot, weekIndex: number, rotationDay: number): number {
  const tmpl = program.template;
  const day = tmpl.baselineWeek?.find((d) => d.dayOfWeek === rotationDay);
  if (!day) return 0;
  let count = 0;
  for (const t of day.tests) {
    // Initial test = the test's first-collection week (default 1); retests at
    // retestWeeks beyond it.
    const initialWeek = t.initialWeek ?? 1;
    if (weekIndex === initialWeek) {
      count += 1;
      continue;
    }
    if (weekIndex > initialWeek && t.retestWeeks?.includes(weekIndex)) count += 1;
  }
  return count;
}

// Count baselines for a day whose override explicitly lists baselineTestNames.
// Mirrors resolveDay's override path: each name is matched against a real test
// in the baselineWeek (unknown names are ignored); an empty list yields 0.
function countBaselinesFromOverride(program: ActiveProgramSnapshot, names: string[]): number {
  let count = 0;
  for (const name of names) {
    for (const day of program.template.baselineWeek ?? []) {
      if (day.tests.some((t) => t.testName === name)) {
        count += 1;
        break;
      }
    }
  }
  return count;
}

export type ResolvedDay = {
  date: Date;
  dateKey: string;
  isInPlan: boolean;
  isGoalDate: boolean;
  rotationDay: number | null;
  weekIndex: number | null;
  workoutTemplate: DayTemplate | null; // resolved (override-aware)
  isOverride: boolean;
  // True when baseline tests are due on this rotation day and the prescribed
  // (non-rest) session steps aside — the test IS the day's work. A max-effort
  // benchmark is itself a hard session; you don't test AND train heavy the same
  // day. workoutTemplate is still populated (so the UI can name what's deferred).
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
  // Flag A — advisory, mirrors workoutDeferredForBaseline. True when a planned hike
  // sits on this date AND the rotation template prescribes a non-rest session AND
  // no explicit override is present. The gym session is NOT removed; this is a hint
  // that the hike is likely the day's work.
  workoutDeferredForHike: boolean;
  // Flag B — the loud conflict signal for the long-endurance rotation day. Set on the
  // long-endurance slot when a planned hike exists elsewhere in the same rotation week AND no
  // override has already resolved the day. workoutTemplate is left fully populated —
  // nothing is silently rewritten.
  longEffortConflict: {
    rotationLongEffortDate: string; // dateKey ("yyyy-mm-dd") of the long-endurance slot
    plannedHikeDates: string[]; // dateKey(s) of hike(s) planned elsewhere this week
  } | null;
  nutritionText: string | null;
  nutritionPlan: NutritionPlan | null;
  mobilityText: string | null;
  notes: string | null;
  workouts: { id: string; startedAt: Date; title: string | null; exerciseCount: number; status: string }[];
  loggedNutrition: {
    id: string;
    date: Date;
    mealType: string;
    items: unknown;
    notes: string | null;
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
};

export async function resolveDay(date: Date): Promise<ResolvedDay> {
  const program = await getActiveProgram();
  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);

  // --- hoist: pure rotation math (no DB) ---
  // Moved above Promise.all so weekWindow is known in time to join the parallel fetch.
  // C-1: these declarations replace the post-Promise.all let declarations (now removed).
  let isInPlan = false;
  let rotationDay: number | null = null;
  let weekIndex: number | null = null;
  let weekWindow: { start: Date; end: Date } | null = null;

  if (program) {
    const startMid = startOfDay(program.startedOn);
    const daysDelta = Math.floor(
      (dayStart.getTime() - startMid.getTime()) / (24 * 3600 * 1000),
    );
    if (daysDelta >= 0 && daysDelta < program.template.totalWeeks * 7) {
      isInPlan = true;
      rotationDay = (((daysDelta % 7) + 7) % 7) + 1;
      weekIndex = Math.floor(daysDelta / 7) + 1;
      weekWindow = rotationWeekWindow(program, weekIndex);
    }
  }

  const [workouts, override, notesForDate, goal, nutrition, plannedHikesThisWeek] = await Promise.all([
    prisma.workout.findMany({
      where: { startedAt: { gte: dayStart, lte: dayEnd } },
      include: { exercises: { select: { id: true } } },
      orderBy: { startedAt: "asc" },
    }),
    program?.id
      ? prisma.planDayOverride.findUnique({
          where: { planId_date: { planId: program.id, date: dayStart } },
        })
      : Promise.resolve(null),
    prisma.note.findMany({
      where: {
        OR: [
          { targetDate: { gte: dayStart, lte: dayEnd } },
          // Also include notes written on this same date (no target).
          { date: { gte: dayStart, lte: dayEnd }, targetDate: null },
        ],
      },
      orderBy: { date: "desc" },
    }),
    prisma.goal.findFirst({
      where: { active: true },
      orderBy: { updatedAt: "desc" },
      select: { targetDate: true, objective: true },
    }),
    prisma.nutritionLog.findMany({
      where: { date: { gte: dayStart, lte: dayEnd } },
      orderBy: { date: "asc" },
    }),
    // Planned hikes this rotation week — gated on being in-plan so the query
    // only runs when weekWindow is known. Resolves [] for out-of-plan dates.
    weekWindow
      ? prisma.hike.findMany({
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
  ]);

  // workoutTemplate and isOverride depend on the post-Promise.all `override` value.
  // D-1: declare alongside workoutTemplate/isOverride so the single return always sees them.
  let workoutTemplate: DayTemplate | null = null;
  let isOverride = false;
  const baselinesDue: ResolvedDay["baselinesDue"] = [];
  let plannedHikeToday: ResolvedDay["plannedHikeToday"] = null;
  let workoutDeferredForHike = false;
  let longEffortConflict: ResolvedDay["longEffortConflict"] = null;

  if (isInPlan && program && rotationDay !== null && weekIndex !== null) {
    // rotationDay and weekIndex are already computed above (hoisted).
    // No daysDelta recomputation needed here.

    if (override?.workoutJson) {
      workoutTemplate = override.workoutJson as unknown as DayTemplate;
      isOverride = true;
    } else {
      workoutTemplate =
        program.template.weeklySplit.find((d) => d.dayOfWeek === rotationDay) ?? null;
    }

    // Baselines due. Two paths:
    // 1. The override has a baselineTestNames array → use that exact list,
    //    looking up each test by name across the entire baselineWeek.
    //    Empty array = explicitly no tests today (override "skip").
    // 2. Otherwise → derive from the rotation day, same as before.
    const overrideNames = Array.isArray(override?.baselineTestNames)
      ? (override!.baselineTestNames as unknown as string[])
      : null;

    let testsForDay: { test: BaselineTest; baselineDay: BaselineDay }[] = [];
    if (overrideNames !== null) {
      for (const name of overrideNames) {
        for (const day of program.template.baselineWeek ?? []) {
          const test = day.tests.find((t) => t.testName === name);
          if (test) {
            testsForDay.push({ test, baselineDay: day });
            break;
          }
        }
      }
    } else {
      const baselineDay = program.template.baselineWeek?.find((d) => d.dayOfWeek === rotationDay);
      if (baselineDay) {
        testsForDay = baselineDay.tests.map((test) => ({ test, baselineDay }));
      }
    }

    if (testsForDay.length > 0) {
      const testNames = testsForDay.map((x) => x.test.testName);
      const logged = await prisma.baseline.findMany({
        where: {
          testName: { in: testNames },
          date: { gte: dayStart, lte: dayEnd },
        },
        orderBy: { date: "desc" },
      });
      const loggedByName = new Map<string, (typeof logged)[number]>();
      for (const b of logged) {
        if (!loggedByName.has(b.testName)) loggedByName.set(b.testName, b);
      }

      for (const { test, baselineDay } of testsForDay) {
        const result = loggedByName.get(test.testName);
        const loggedOnDate = result
          ? { id: result.id, value: result.value, units: result.units, date: result.date }
          : null;
        // Rotation default: the test's initialWeek (default 1) surfaces the
        // initial, retestWeeks beyond it trigger retests, all else is silent.
        // With an override, the user has explicitly placed these tests on this
        // date — bypass the week filter entirely (a deferred "initial" can
        // land outside its scheduled week).
        const initialWeek = test.initialWeek ?? 1;
        const checkpoint: "initial" | "retest" =
          weekIndex > initialWeek && test.retestWeeks?.includes(weekIndex) ? "retest" : "initial";
        if (overrideNames !== null) {
          baselinesDue.push({ test, baselineDay, checkpoint, loggedOnDate });
        } else if (weekIndex === initialWeek) {
          baselinesDue.push({ test, baselineDay, checkpoint: "initial", loggedOnDate });
        } else if (weekIndex > initialWeek && test.retestWeeks?.includes(weekIndex)) {
          baselinesDue.push({ test, baselineDay, checkpoint: "retest", loggedOnDate });
        }
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

  const isGoalDate = !!goal && dateKey(goal.targetDate) === dateKey(date);

  // On a test day the benchmark replaces the prescribed session. Only defer a
  // real session (not rest, not a user's explicit workout override).
  const workoutDeferredForBaseline =
    baselinesDue.length > 0 &&
    !isOverride &&
    !!workoutTemplate &&
    workoutTemplate.category !== "rest";

  // Track 2: confidence state for MCP parity (get_day / get_today_plan).
  const isPastForConfidence = dayStart.getTime() < startOfDay(new Date()).getTime();
  const confidence = deriveConfidence(dayStart, isInPlan, isPastForConfidence, program);

  return {
    date: dayStart,
    dateKey: dateKey(date),
    isInPlan,
    isGoalDate,
    rotationDay,
    weekIndex,
    workoutTemplate,
    isOverride,
    workoutDeferredForBaseline,
    plannedHikeToday,
    workoutDeferredForHike,
    longEffortConflict,
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
    })),
    loggedNutrition: nutrition.map((n) => ({
      id: n.id,
      date: n.date,
      mealType: n.mealType,
      items: n.items,
      notes: n.notes,
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
  };
}

// --- Today helpers ---

export async function getBaselinesDueToday(now: Date = new Date()): Promise<ResolvedDay["baselinesDue"]> {
  const r = await resolveDay(now);
  return r.baselinesDue;
}

/**
 * Baseline test names that would normally appear on `date` by rotation default
 * (week 1 initials + retest weeks). Ignores any per-day override — answers the
 * question "what would a fresh day with no override show?".
 */
/**
 * Resolve the rotation-day template that would render on `date` if no override
 * existed. Returns null when `date` is outside the plan's calendar window
 * (before startedOn or past totalWeeks*7). Override-unaware by design — this
 * is the "base" view that PlanDayOverride.workoutJson layers on top of.
 *
 * Use case: workoutJsonOps in apply_day_override needs a base DayTemplate to
 * apply edits against when no override exists yet for the date.
 */
export function templateForRotationDay(
  program: ActiveProgramSnapshot,
  date: Date,
): DayTemplate | null {
  const startMid = startOfDay(program.startedOn);
  const dayStart = startOfDay(date);
  const daysDelta = Math.floor((dayStart.getTime() - startMid.getTime()) / (24 * 3600 * 1000));
  if (daysDelta < 0 || daysDelta >= program.template.totalWeeks * 7) return null;
  const rotationDay = (((daysDelta % 7) + 7) % 7) + 1;
  return program.template.weeklySplit.find((d) => d.dayOfWeek === rotationDay) ?? null;
}

export function rotationBaselineNamesForDate(
  program: ActiveProgramSnapshot,
  date: Date,
): string[] {
  const startMid = startOfDay(program.startedOn);
  const dayStart = startOfDay(date);
  const daysDelta = Math.floor((dayStart.getTime() - startMid.getTime()) / (24 * 3600 * 1000));
  if (daysDelta < 0 || daysDelta >= program.template.totalWeeks * 7) return [];
  const rotationDay = (((daysDelta % 7) + 7) % 7) + 1;
  const weekIndex = Math.floor(daysDelta / 7) + 1;
  const baselineDay = program.template.baselineWeek?.find((d) => d.dayOfWeek === rotationDay);
  if (!baselineDay) return [];
  return baselineDay.tests
    .filter((t) => {
      const initialWeek = t.initialWeek ?? 1;
      return weekIndex === initialWeek || (weekIndex > initialWeek && t.retestWeeks?.includes(weekIndex));
    })
    .map((t) => t.testName);
}

/** Unresolved notes + a link target into the active plan's goal. */
export async function getPendingNotesCount(): Promise<{ count: number; goalId: string | null; planId: string | null }> {
  const [plan, count] = await Promise.all([
    prisma.plan.findFirst({
      where: { active: true },
      orderBy: { updatedAt: "desc" },
      include: { goal: { select: { id: true } } },
    }),
    // Only count notes that actually call for a coaching decision: audibles
    // (plan changes) and feedback. Journals are diary entries you rarely
    // "resolve", and standing_rules are never resolved by design — counting
    // them inflated this number into a permanent, misleading to-do badge.
    prisma.note.count({ where: { resolvedAt: null, type: { in: ["audible", "feedback"] } } }),
  ]);
  if (!plan) return { count, goalId: null, planId: null };
  return { count, goalId: plan.goal.id, planId: plan.id };
}

// --- Long-effort reconciliation helpers ---

// Returns the UTC instants for the first and last millisecond of a rotation week.
// Day 1 of weekIndex lands at startOfDay(program.startedOn + (weekIndex-1)*7 days).
// Uses addDays/startOfDay/endOfDay — no raw Date arithmetic.
// Not exported — only resolveDay and weekConflicts (both in calendar.ts) call it.
function rotationWeekWindow(
  program: ActiveProgramSnapshot,
  weekIndex: number,
): { start: Date; end: Date } {
  const weekStart = addDays(startOfDay(program.startedOn), (weekIndex - 1) * 7);
  return { start: weekStart, end: endOfDay(addDays(weekStart, 6)) };
}

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
  const window = rotationWeekWindow(program, weekIndex);

  const [plannedHikes, overrideRows] = await Promise.all([
    prisma.hike.findMany({
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
    const longDate = addDays(startOfDay(program.startedOn), (weekIndex - 1) * 7 + (longTmpl.dayOfWeek - 1));
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
    const calDate = addDays(startOfDay(program.startedOn), (weekIndex - 1) * 7 + relDay);
    const calKey  = dateKey(calDate);

    if (overrideKeys.has(calKey)) continue;

    const baselineDay = program.template.baselineWeek?.find((d) => d.dayOfWeek === rotDay);
    if (!baselineDay) continue;

    const hasDueTests = baselineDay.tests.some((t) => {
      const initialWeek = t.initialWeek ?? 1;
      return (
        weekIndex === initialWeek ||
        (weekIndex > initialWeek && (t.retestWeeks?.includes(weekIndex) ?? false))
      );
    });
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

// --- Date utilities (USER_TZ-aware) ---
//
// The Vercel runtime is UTC, but the user's day rolls over at their local
// midnight. All date-bucketing logic — "today", week ranges, dateKey strings,
// the strict-equality lookup for PlanDayOverride.date — must be computed in
// the user's TZ, not the server's. Override via USER_TZ env (defaults to
// America/Denver for this single-user app).

export const USER_TZ = process.env.USER_TZ ?? "America/Denver";

const userPartsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: USER_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const userWeekdayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: USER_TZ,
  weekday: "short",
});

function userParts(d: Date) {
  const map: Record<string, string> = {};
  for (const p of userPartsFmt.formatToParts(d)) map[p.type] = p.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    // Some runtimes return "24" for midnight; fold to 0.
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

// Convert a user-TZ wall-clock (year, month1=1..12, day, hms) to the UTC
// instant that represents that wall clock. Handles DST by computing the
// effective offset for our naive UTC guess, then correcting once.
function userTzWallClockToUTC(
  year: number,
  month1: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0,
): Date {
  const naive = new Date(Date.UTC(year, month1 - 1, day, hour, minute, second, ms));
  const np = userParts(naive);
  const naiveAsWall = Date.UTC(
    np.year,
    np.month - 1,
    np.day,
    np.hour,
    np.minute,
    np.second,
  );
  const desiredAsWall = Date.UTC(year, month1 - 1, day, hour, minute, second);
  return new Date(naive.getTime() + (desiredAsWall - naiveAsWall));
}

// Calendar weekday in USER_TZ. 1=Monday … 7=Sunday.
export function userWeekdayMon1(d: Date): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  const wd = userWeekdayFmt.format(d);
  const map: Record<string, 1 | 2 | 3 | 4 | 5 | 6 | 7> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
  };
  return map[wd] ?? 1;
}

export function dateKey(d: Date): string {
  const { year, month, day } = userParts(d);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseDateKey(k: string): Date {
  const [y, m, d] = k.split("-").map(Number);
  return userTzWallClockToUTC(y!, m!, d!);
}

export function startOfDay(d: Date): Date {
  const { year, month, day } = userParts(d);
  return userTzWallClockToUTC(year, month, day);
}

export function endOfDay(d: Date): Date {
  const { year, month, day } = userParts(d);
  return userTzWallClockToUTC(year, month, day, 23, 59, 59, 999);
}

export function startOfWeekMonday(d: Date): Date {
  const { year, month, day } = userParts(d);
  const wd = userWeekdayMon1(d);
  // Date.UTC normalizes negative days into the previous month.
  const monday = new Date(Date.UTC(year, month - 1, day - (wd - 1)));
  return userTzWallClockToUTC(
    monday.getUTCFullYear(),
    monday.getUTCMonth() + 1,
    monday.getUTCDate(),
  );
}

export function endOfWeekSunday(d: Date): Date {
  const { year, month, day } = userParts(d);
  const wd = userWeekdayMon1(d);
  const sunday = new Date(Date.UTC(year, month - 1, day - (wd - 1) + 6));
  return userTzWallClockToUTC(
    sunday.getUTCFullYear(),
    sunday.getUTCMonth() + 1,
    sunday.getUTCDate(),
    23,
    59,
    59,
    999,
  );
}

export function addDays(d: Date, days: number): Date {
  const { year, month, day } = userParts(d);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return userTzWallClockToUTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}
