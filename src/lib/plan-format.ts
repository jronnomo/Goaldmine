import type { Block, ExercisePrescription } from "@/lib/program-template";

/**
 * Shared pure display formatters for plan/prescription rendering.
 *
 * Consolidated from 4 identical `blockTypeLabel` copies, 5 identical
 * `formatSecs` copies, and 3 identical `compactPrescription` copies (plus
 * `prescriptionRight`, which is `compactPrescription` minus the em-dash
 * fallback) that had accreted across the plan-rendering surfaces
 * (Today, /days/[dateKey], /goals/[id]/plan, SnapshotView, PlanOverview,
 * prescription-prefill).
 *
 * NOTE: `src/components/days/CompletedWorkoutCard.tsx` keeps its own LOCAL
 * `formatSecs` by design — it formats *logged* set durations (stopwatch
 * semantics: always `m:ss`, e.g. 120s -> "2:00") rather than *prescribed*
 * durations (brevity semantics: 120s -> "2 min"). Do not consolidate it.
 */

export function blockTypeLabel(t: Block["type"]): string {
  switch (t) {
    case "straight":
      return "Straight sets";
    case "superset":
      return "Superset";
    case "finisher":
      return "Finisher";
    case "mobility":
      return "Mobility";
    case "cardio":
      return "Cardio";
  }
}

export function formatSecs(s: number): string {
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r === 0 ? `${m} min` : `${m}:${String(r).padStart(2, "0")}`;
  }
  return `${s}s`;
}

function prescriptionParts(ex: ExercisePrescription): string[] {
  const parts: string[] = [];
  if (ex.sets) parts.push(`${ex.sets}×`);
  if (ex.reps !== undefined) parts.push(String(ex.reps));
  if (ex.durationSec !== undefined) parts.push(formatSecs(ex.durationSec));
  return parts;
}

export function compactPrescription(ex: ExercisePrescription): string {
  return prescriptionParts(ex).join(" ") || "—";
}

export function prescriptionRight(ex: ExercisePrescription): string {
  return prescriptionParts(ex).join(" ");
}
