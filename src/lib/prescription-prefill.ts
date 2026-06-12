// Pure module — no "use server" directive.
// Converts program template Block[] into prefill data for WorkoutLoggerForm.
//
// Rules:
//   reps — plain number → concrete value (submitted); string ("8-12", "max",
//          range, etc.) → placeholder (muted-italic, never persisted on submit).
//   weightHint → always a placeholder (muted-italic).
//   durationSec → concrete value (number).
//   sets: block.exercises[n].sets ?? block.rounds ?? 1.
//   Block label / type → section header in the form.

import type { Block } from "@/lib/program-template";

export type PrefilledExercise = {
  /** Display name of the exercise. */
  name: string;
  equipment?: string | null;
  /** Rendered as a section header above the first exercise in this block. */
  blockLabel: string;
  blockType: Block["type"];
  /** Number of sets to pre-render for this exercise row. */
  sets: number;
  /**
   * Concrete value: submitted as-is when the user doesn't override it.
   * Only present when the template reps field is a plain number.
   */
  repsValue?: number;
  /**
   * Concrete value: submitted as-is when the user doesn't override it.
   * Only present when the template durationSec field is set.
   */
  durationSec?: number;
  /**
   * Placeholder string shown in muted-italic style.
   * Set when reps is a string prescription ("8-12", "max", a range, etc.).
   * NEVER submitted; the form sends the user-entered value instead.
   */
  repsPlaceholder?: string;
  /**
   * Placeholder string shown in muted-italic style.
   * Always set when the template has a weightHint.
   * NEVER submitted; the form sends the user-entered value instead.
   */
  weightHintPlaceholder?: string;
  /** Exercise-level notes from the template (rendered below the row). */
  notes?: string | null;
  /** 0-based order index used when submitting exercises to the action. */
  orderIndex: number;
};

/** Returns true when the reps prescription is a "fuzzy" string (placeholder). */
function isFuzzyReps(reps: string | number | undefined): boolean {
  if (reps === undefined || reps === null) return false;
  if (typeof reps === "number") return false;
  // Any non-empty string (e.g. "8-12", "max", "AMRAP", "failure") is fuzzy.
  return typeof reps === "string" && reps.trim().length > 0;
}

function blockTypeLabel(type: Block["type"]): string {
  switch (type) {
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

/**
 * Convert template Block[] into the flat PrefilledExercise[] array used by
 * WorkoutLoggerForm. The first exercise of each block carries the section
 * header (blockLabel) for rendering; subsequent exercises in the same block
 * repeat the same blockLabel so the form can group them visually.
 */
export function prefillFromTemplate(blocks: Block[]): PrefilledExercise[] {
  const result: PrefilledExercise[] = [];
  let globalOrder = 0;

  for (const block of blocks) {
    const sectionLabel = block.label ?? blockTypeLabel(block.type);
    const blockSets = block.rounds ?? 1;

    for (const ex of block.exercises) {
      const sets = ex.sets ?? blockSets;

      const entry: PrefilledExercise = {
        name: ex.name,
        equipment: ex.equipment ?? null,
        blockLabel: sectionLabel,
        blockType: block.type,
        sets,
        notes: ex.notes ?? null,
        orderIndex: globalOrder++,
      };

      // Reps: plain number → value; string → placeholder.
      if (typeof ex.reps === "number") {
        entry.repsValue = ex.reps;
      } else if (isFuzzyReps(ex.reps)) {
        entry.repsPlaceholder = String(ex.reps);
      }

      // Duration: always a concrete value when present.
      if (typeof ex.durationSec === "number") {
        entry.durationSec = ex.durationSec;
      }

      // Weight hint: always a placeholder (never a concrete submit value).
      if (ex.weightHint) {
        entry.weightHintPlaceholder = ex.weightHint;
      }

      result.push(entry);
    }
  }

  return result;
}
