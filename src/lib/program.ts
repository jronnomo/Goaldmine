import type { ProgramTemplate, DayTemplate, Phase } from "@/lib/program-template";
import { startOfDay } from "@/lib/calendar";
import { getDb } from "@/lib/db";

export type ActiveProgramSnapshot = {
  id: string;
  name: string;
  startedOn: Date;
  template: ProgramTemplate;
  // Track 2: high-water mark from Plan.confirmedThroughDate. null when no
  // weeks have been confirmed, or when falling back to the Program table.
  confirmedThroughDate: Date | null;
};

export type TodayContext = {
  program: ActiveProgramSnapshot;
  daysSinceStart: number;
  weekIndex: number; // 1-based, capped at totalWeeks
  dayOfWeek: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  phase: Phase | null;
  day: DayTemplate | null;
};

export async function getActiveProgram(): Promise<ActiveProgramSnapshot | null> {
  // Prefer the focus goal's active Plan first (isFocus desc), then fall back
  // to any active plan (transition-safe). This ensures the focus goal's plan
  // drives the daily prescription while remaining resilient during the transition
  // period when some goals may not yet have isFocus set.
  // Falls back further to the global seeded Program for new users.
  const db = await getDb();
  const plan = await db.plan.findFirst({
    where: { active: true },
    orderBy: [{ goal: { isFocus: "desc" } }, { updatedAt: "desc" }],
  });
  if (plan) {
    return {
      id: plan.id,
      name: plan.name,
      startedOn: plan.startedOn,
      template: plan.planJson as unknown as ProgramTemplate,
      confirmedThroughDate: plan.confirmedThroughDate ?? null,
    };
  }
  const program = await db.program.findFirst({
    where: { active: true },
    orderBy: { createdAt: "desc" },
  });
  if (!program) return null;
  return {
    id: program.id,
    name: program.name,
    startedOn: program.startedOn,
    template: program.planJson as unknown as ProgramTemplate,
    // Program table has no confirmedThroughDate column — always null.
    confirmedThroughDate: null,
  };
}

export function getTodayContext(
  program: ActiveProgramSnapshot,
  now: Date = new Date(),
): TodayContext {
  // Day boundaries in USER_TZ — the user's phone clock owns "today", not the
  // server's UTC. dayMs uses 86400 because daysSinceStart is the wall-clock
  // day count; DST transitions are absorbed by startOfDay's TZ correction.
  const startMidnight = startOfDay(program.startedOn);
  const today = startOfDay(now);

  const dayMs = 1000 * 60 * 60 * 24;
  const daysSinceStart = Math.max(
    0,
    Math.round((today.getTime() - startMidnight.getTime()) / dayMs),
  );
  const weekIndex = Math.min(program.template.totalWeeks, Math.floor(daysSinceStart / 7) + 1);

  // Plan-relative rotation. Day 1 of the program lands on plan.startedOn,
  // regardless of which calendar weekday that is. After 7 days the rotation
  // cycles. The template's `weeklySplit[].dayOfWeek` is the rotation index
  // (1..7), NOT a calendar weekday.
  const dayOfWeek = ((daysSinceStart % 7) + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7;

  // Defensive: a malformed snapshot (e.g., a stringified template that
  // accidentally got persisted as a character-indexed object) shouldn't take
  // the page down. Treat phases / weeklySplit as optional.
  const phasesArr = Array.isArray(program.template?.phases) ? program.template.phases : [];
  const weeklySplitArr = Array.isArray(program.template?.weeklySplit)
    ? program.template.weeklySplit
    : [];

  const phase =
    phasesArr.find((p) => Array.isArray(p?.weeks) && p.weeks.includes(weekIndex)) ??
    phasesArr[0] ??
    null;

  const day = weeklySplitArr.find((d) => d?.dayOfWeek === dayOfWeek) ?? weeklySplitArr[0] ?? null;

  return { program, daysSinceStart, weekIndex, dayOfWeek, phase, day };
}
