import { PROGRAM_TEMPLATE, type Phase, type ProgramTemplate } from "@/lib/program-template";

/**
 * Scaffold a plan from PROGRAM_TEMPLATE, scaled to fit `weeks` total weeks.
 * Distributes weeks across the template's 3 phases as evenly as possible.
 *
 * If a goal is shorter than 3 weeks the lowest-numbered phases stay (Foundation
 * comes first; we don't skip to peak conditioning for a 1-week build).
 */
export function scaffoldPlanFromTemplate(weeks: number): ProgramTemplate {
  if (weeks <= 0) throw new Error("weeks must be positive");
  const sourcePhases = PROGRAM_TEMPLATE.phases;
  const phasesUsed = Math.min(sourcePhases.length, Math.max(1, Math.ceil(weeks / 2)));

  // Even split across the phases we use, then round-robin the remainder.
  const base = Math.floor(weeks / phasesUsed);
  let remainder = weeks - base * phasesUsed;
  const sizes: number[] = [];
  for (let i = 0; i < phasesUsed; i++) {
    let size = base;
    if (remainder > 0) {
      size += 1;
      remainder -= 1;
    }
    sizes.push(size);
  }

  const phases: Phase[] = [];
  let cursor = 1;
  for (let i = 0; i < phasesUsed; i++) {
    const src = sourcePhases[i]!;
    const range: number[] = [];
    for (let w = 0; w < sizes[i]!; w++) range.push(cursor + w);
    cursor += sizes[i]!;
    phases.push({ ...src, weeks: range });
  }

  return {
    ...PROGRAM_TEMPLATE,
    totalWeeks: weeks,
    phases,
  };
}

export function weeksBetween(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return Math.max(1, Math.ceil(ms / (7 * 24 * 60 * 60 * 1000)));
}

export function currentPhase(template: ProgramTemplate, weekIndex: number): Phase {
  return template.phases.find((p) => p.weeks.includes(weekIndex)) ?? template.phases[0]!;
}
