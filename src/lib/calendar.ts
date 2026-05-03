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
  workoutCount: number; // logged workouts on this date
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

  const [workouts, overrides, goal] = await Promise.all([
    prisma.workout.findMany({
      where: { startedAt: { gte: gridStart, lte: gridEnd } },
      select: { id: true, startedAt: true, status: true, title: true },
      orderBy: { startedAt: "asc" },
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

  const overridesByKey = new Map<string, (typeof overrides)[number]>();
  for (const o of overrides) overridesByKey.set(dateKey(o.date), o);

  const cells: CalendarDayCell[] = [];
  const now = new Date();
  const todayKey = dateKey(now);
  const goalKey = goal ? dateKey(goal.targetDate) : null;

  for (let d = new Date(gridStart); d <= gridEnd; d.setDate(d.getDate() + 1)) {
    const cell = buildCell({
      date: new Date(d),
      todayKey,
      goalKey,
      program,
      workoutsByKey,
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

  const [workouts, override, notesForDate, goal] = await Promise.all([
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

      // Baselines due: any tests on this rotation day whose checkpoint week matches.
      const baselineDay = program.template.baselineWeek?.find((d) => d.dayOfWeek === rotationDay);
      if (baselineDay) {
        // Pre-load any baselines logged on this date (single query) so each
        // due-test row can show its checkmark + recorded value.
        const testNames = baselineDay.tests.map((t) => t.testName);
        const logged = testNames.length
          ? await prisma.baseline.findMany({
              where: {
                testName: { in: testNames },
                date: { gte: dayStart, lte: dayEnd },
              },
              orderBy: { date: "desc" },
            })
          : [];
        const loggedByName = new Map<string, (typeof logged)[number]>();
        for (const b of logged) {
          if (!loggedByName.has(b.testName)) loggedByName.set(b.testName, b);
        }

        for (const t of baselineDay.tests) {
          const result = loggedByName.get(t.testName);
          const loggedOnDate = result
            ? { id: result.id, value: result.value, units: result.units, date: result.date }
            : null;
          if (weekIndex === 1) {
            baselinesDue.push({ test: t, baselineDay, checkpoint: "initial", loggedOnDate });
          } else if (t.retestWeeks?.includes(weekIndex)) {
            baselinesDue.push({ test: t, baselineDay, checkpoint: "retest", loggedOnDate });
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

// --- Date utilities ---

export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseDateKey(k: string): Date {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

export function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

export function endOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(23, 59, 59, 999);
  return out;
}

export function startOfWeekMonday(d: Date): Date {
  const out = startOfDay(d);
  const js = out.getDay();
  const diff = js === 0 ? -6 : 1 - js; // shift to Monday
  out.setDate(out.getDate() + diff);
  return out;
}

export function endOfWeekSunday(d: Date): Date {
  const start = startOfWeekMonday(d);
  const out = new Date(start);
  out.setDate(out.getDate() + 6);
  out.setHours(23, 59, 59, 999);
  return out;
}
