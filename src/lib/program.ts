import type { ProgramTemplate, DayTemplate, Phase } from "@/lib/program-template";
import { prisma } from "@/lib/db";

export type ActiveProgramSnapshot = {
  id: string;
  name: string;
  startedOn: Date;
  template: ProgramTemplate;
};

export type TodayContext = {
  program: ActiveProgramSnapshot;
  daysSinceStart: number;
  weekIndex: number; // 1-based, capped at totalWeeks
  dayOfWeek: 1 | 2 | 3 | 4 | 5 | 6 | 7; // 1 = Monday
  phase: Phase;
  day: DayTemplate;
};

export async function getActiveProgram(): Promise<ActiveProgramSnapshot | null> {
  // Prefer the most recently updated active Plan (goal-scoped, includes
  // any revisions). Fall back to the global seeded Program for new users.
  const plan = await prisma.plan.findFirst({
    where: { active: true },
    orderBy: { updatedAt: "desc" },
  });
  if (plan) {
    return {
      id: plan.id,
      name: plan.name,
      startedOn: plan.startedOn,
      template: plan.planJson as unknown as ProgramTemplate,
    };
  }
  const program = await prisma.program.findFirst({
    where: { active: true },
    orderBy: { createdAt: "desc" },
  });
  if (!program) return null;
  return {
    id: program.id,
    name: program.name,
    startedOn: program.startedOn,
    template: program.planJson as unknown as ProgramTemplate,
  };
}

export function getTodayContext(
  program: ActiveProgramSnapshot,
  now: Date = new Date(),
): TodayContext {
  const startMidnight = new Date(program.startedOn);
  startMidnight.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const daysSinceStart = Math.max(
    0,
    Math.floor((today.getTime() - startMidnight.getTime()) / (1000 * 60 * 60 * 24)),
  );
  const weekIndex = Math.min(program.template.totalWeeks, Math.floor(daysSinceStart / 7) + 1);

  // JS getDay(): Sunday=0..Saturday=6. Convert to Monday=1..Sunday=7.
  const jsDay = today.getDay();
  const dayOfWeek = (jsDay === 0 ? 7 : jsDay) as 1 | 2 | 3 | 4 | 5 | 6 | 7;

  const phase =
    program.template.phases.find((p) => p.weeks.includes(weekIndex)) ??
    program.template.phases[0]!;

  const day =
    program.template.weeklySplit.find((d) => d.dayOfWeek === dayOfWeek) ??
    program.template.weeklySplit[0]!;

  return { program, daysSinceStart, weekIndex, dayOfWeek, phase, day };
}
