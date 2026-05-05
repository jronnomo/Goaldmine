// Helpers to resolve "what's on this date" — combining plan rotation, overrides,
// completed workouts, baselines due, and goal markers.

import { prisma } from "@/lib/db";
import { getActiveProgram, type ActiveProgramSnapshot } from "@/lib/program";
import type { BaselineDay, BaselineTest, DayTemplate, ProgramTemplate } from "@/lib/program-template";

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
  hikeCount: number; // logged hikes on this date — these are out-of-gym training days
  hasOverride: boolean;
  baselinesDue: number; // count of due/overdue tests scheduled on this rotation day for this week
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
      where: { date: { gte: gridStart, lte: gridEnd }, status: "completed" },
      select: { id: true, date: true },
      orderBy: { date: "asc" },
    }),
    program?.id
      ? prisma.planDayOverride.findMany({
          where: { planId: program.id, date: { gte: gridStart, lte: gridEnd } },
        })
      : Promise.resolve([] as never[]),
    prisma.goal.findFirst({
      where: { active: true },
      orderBy: { targetDate: "asc" },
      select: { id: true, targetDate: true, objective: true },
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

  // Bucket hikes by date key — out-of-gym training days.
  const hikesByKey = new Map<string, typeof hikes>();
  for (const h of hikes) {
    const k = dateKey(h.date);
    const arr = hikesByKey.get(k) ?? [];
    arr.push(h);
    hikesByKey.set(k, arr);
  }

  const overridesByKey = new Map<string, (typeof overrides)[number]>();
  for (const o of overrides) overridesByKey.set(dateKey(o.date), o);

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
      overridesByKey,
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

function buildCell(args: {
  date: Date;
  todayKey: string;
  goalKey: string | null;
  program: ActiveProgramSnapshot | null;
  workoutsByKey: Map<string, { id: string; startedAt: Date; status: string; title: string | null }[]>;
  hikesByKey: Map<string, { id: string; date: Date }[]>;
  overridesByKey: Map<string, { workoutJson: unknown; nutritionText: string | null; mobilityText: string | null }>;
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
  const hasOverride = args.overridesByKey.has(k);
  const baselinesDue = isInPlan
    ? countBaselinesDueForCell(args.program!, weekIndex!, rotationDay!)
    : 0;

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
    hasOverride,
    baselinesDue,
  };
}

function countBaselinesDueForCell(program: ActiveProgramSnapshot, weekIndex: number, rotationDay: number): number {
  const tmpl = program.template;
  const day = tmpl.baselineWeek?.find((d) => d.dayOfWeek === rotationDay);
  if (!day) return 0;
  let count = 0;
  for (const t of day.tests) {
    // Initial test = week 1; retests at retestWeeks.
    if (weekIndex === 1) {
      count += 1;
      continue;
    }
    if (t.retestWeeks?.includes(weekIndex)) count += 1;
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
  nutritionText: string | null;
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
  override?: {
    id: string;
    workoutJson: unknown;
    nutritionText: string | null;
    mobilityText: string | null;
    notes: string | null;
  } | null;
};

export async function resolveDay(date: Date): Promise<ResolvedDay> {
  const program = await getActiveProgram();
  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);

  const [workouts, override, notesForDate, goal, nutrition] = await Promise.all([
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
      orderBy: { targetDate: "asc" },
      select: { targetDate: true, objective: true },
    }),
    prisma.nutritionLog.findMany({
      where: { date: { gte: dayStart, lte: dayEnd } },
      orderBy: { date: "asc" },
    }),
  ]);

  let isInPlan = false;
  let rotationDay: number | null = null;
  let weekIndex: number | null = null;
  let workoutTemplate: DayTemplate | null = null;
  let isOverride = false;
  let baselinesDue: ResolvedDay["baselinesDue"] = [];

  if (program) {
    const startMid = startOfDay(program.startedOn);
    const daysDelta = Math.floor((dayStart.getTime() - startMid.getTime()) / (24 * 3600 * 1000));
    if (daysDelta >= 0 && daysDelta < program.template.totalWeeks * 7) {
      isInPlan = true;
      rotationDay = (((daysDelta % 7) + 7) % 7) + 1;
      weekIndex = Math.floor(daysDelta / 7) + 1;

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
          // Rotation default: week 1 surfaces initials, retestWeeks trigger
          // retests, all else is silent. With an override, the user has
          // explicitly placed these tests on this date — bypass the week
          // filter entirely (a deferred "initial" can land outside week 1).
          const checkpoint: "initial" | "retest" =
            test.retestWeeks?.includes(weekIndex) ? "retest" : "initial";
          if (overrideNames !== null) {
            baselinesDue.push({ test, baselineDay, checkpoint, loggedOnDate });
          } else if (weekIndex === 1) {
            baselinesDue.push({ test, baselineDay, checkpoint: "initial", loggedOnDate });
          } else if (test.retestWeeks?.includes(weekIndex)) {
            baselinesDue.push({ test, baselineDay, checkpoint: "retest", loggedOnDate });
          }
        }
      }
    }
  }

  const isGoalDate = !!goal && dateKey(goal.targetDate) === dateKey(date);

  return {
    date: dayStart,
    dateKey: dateKey(date),
    isInPlan,
    isGoalDate,
    rotationDay,
    weekIndex,
    workoutTemplate,
    isOverride,
    nutritionText: override?.nutritionText ?? null,
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
    override: override
      ? {
          id: override.id,
          workoutJson: override.workoutJson,
          nutritionText: override.nutritionText,
          mobilityText: override.mobilityText,
          notes: override.notes,
        }
      : null,
  };
}

// --- Today helpers ---

export async function getBaselinesDueToday(now: Date = new Date()): Promise<ResolvedDay["baselinesDue"]> {
  const r = await resolveDay(now);
  return r.baselinesDue;
}

/** Pending notes since the last revision on the active goal's plan, plus a link target. */
export async function getPendingNotesCount(): Promise<{ count: number; goalId: string | null; planId: string | null; since: Date | null }> {
  const plan = await prisma.plan.findFirst({
    where: { active: true },
    orderBy: { updatedAt: "desc" },
    include: {
      goal: { select: { id: true } },
      revisions: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!plan) return { count: 0, goalId: null, planId: null, since: null };
  const since = plan.revisions[0]?.createdAt ?? plan.startedOn;
  const count = await prisma.note.count({ where: { date: { gt: since } } });
  return { count, goalId: plan.goal.id, planId: plan.id, since };
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
