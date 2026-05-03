// Structured diff between two ProgramTemplate snapshots. Used to highlight
// what changed between plan revisions so the user doesn't have to read raw
// JSON to spot the swap.

import type { DayTemplate, Phase, ProgramTemplate } from "@/lib/program-template";

export type SectionDiff = "same" | "changed";

export type SnapshotDiff = {
  meta: SectionDiff; // name, totalWeeks, goals
  phases: SectionDiff;
  weeklySplit: SectionDiff;
  dailyMobility: SectionDiff;
  baselineWeek: SectionDiff;
  hikingSuperset: SectionDiff;
  // Per-rotation-day diffs for the weekly split.
  dayDiffs: { dayOfWeek: number; before: DayTemplate | null; after: DayTemplate | null; changed: boolean }[];
  phaseDiffs: { index: number; before: Phase | null; after: Phase | null; changed: boolean }[];
};

export function diffSnapshots(
  before: ProgramTemplate | null,
  after: ProgramTemplate,
): SnapshotDiff {
  const b = before ?? null;

  const meta: SectionDiff =
    b &&
    b.name === after.name &&
    b.totalWeeks === after.totalWeeks &&
    deepEq(b.goals ?? [], after.goals ?? [])
      ? "same"
      : "changed";

  const phases = b && deepEq(b.phases, after.phases) ? "same" : "changed";
  const weeklySplit = b && deepEq(b.weeklySplit, after.weeklySplit) ? "same" : "changed";
  const dailyMobility = b && deepEq(b.dailyMobility, after.dailyMobility) ? "same" : "changed";
  const baselineWeek = b && deepEq(b.baselineWeek, after.baselineWeek) ? "same" : "changed";
  const hikingSuperset = b && deepEq(b.hikingSuperset, after.hikingSuperset) ? "same" : "changed";

  const allDays = new Set<number>();
  for (const d of after.weeklySplit) allDays.add(d.dayOfWeek);
  if (b) for (const d of b.weeklySplit) allDays.add(d.dayOfWeek);
  const dayDiffs = [...allDays]
    .sort((a, b) => a - b)
    .map((dayOfWeek) => {
      const aft = after.weeklySplit.find((d) => d.dayOfWeek === dayOfWeek) ?? null;
      const bef = b?.weeklySplit.find((d) => d.dayOfWeek === dayOfWeek) ?? null;
      return { dayOfWeek, before: bef, after: aft, changed: !deepEq(bef, aft) };
    });

  const allPhaseIndices = new Set<number>();
  for (const p of after.phases) allPhaseIndices.add(p.index);
  if (b) for (const p of b.phases) allPhaseIndices.add(p.index);
  const phaseDiffs = [...allPhaseIndices]
    .sort((a, b) => a - b)
    .map((index) => {
      const aft = after.phases.find((p) => p.index === index) ?? null;
      const bef = b?.phases.find((p) => p.index === index) ?? null;
      return { index, before: bef, after: aft, changed: !deepEq(bef, aft) };
    });

  return {
    meta,
    phases,
    weeklySplit,
    dailyMobility,
    baselineWeek,
    hikingSuperset,
    dayDiffs,
    phaseDiffs,
  };
}

export function deepEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== (b as unknown[]).length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEq(a[i], (b as unknown[])[i])) return false;
    return true;
  }
  const ak = Object.keys(a as object).sort();
  const bk = Object.keys(b as object).sort();
  if (ak.length !== bk.length) return false;
  for (let i = 0; i < ak.length; i++) {
    if (ak[i] !== bk[i]) return false;
    if (!deepEq((a as Record<string, unknown>)[ak[i]!], (b as Record<string, unknown>)[bk[i]!])) return false;
  }
  return true;
}
