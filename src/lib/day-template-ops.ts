// Surgical ops for editing a DayTemplate without rewriting the whole blob.
// Used by apply_day_override's workoutJsonOps path so the coach can say "add
// a calf stretch to the mobility flow" or "bump Hollow Body Hold to 60s"
// without re-emitting a 20-exercise block and risking a typo.
//
// Pure transforms — accept a base DayTemplate + an ops array, return a new
// DayTemplate. The caller (apply_day_override) handles the persistence and
// the surrounding PATCH semantics.

import { z } from "zod";

import type { Block, DayTemplate, ExercisePrescription } from "@/lib/program-template";

// Block match: by index (number) or by case-insensitive substring against
// label OR type. Both are common in practice — "Mobility" might be the type
// of a block with no label, "Core" might be a label.
const BlockMatchShape = z.union([z.string().min(1), z.number().int().min(0)]);

// ExercisePrescription input shape. Kept permissive — the surrounding
// DayTemplate validator will catch missing/invalid fields after ops apply.
const ExercisePrescriptionShape = z.object({
  name: z.string().min(1),
  equipment: z.string().optional(),
  sets: z.number().optional(),
  reps: z.union([z.string(), z.number()]).optional(),
  durationSec: z.number().optional(),
  weightHint: z.string().optional(),
  notes: z.string().optional(),
});

const AddExerciseOp = z.object({
  op: z.literal("addExercise"),
  block: BlockMatchShape.describe(
    "Which block to add to — block index (number) or case-insensitive substring matching label OR type.",
  ),
  exercise: ExercisePrescriptionShape,
  at: z
    .union([z.enum(["end", "start"]), z.number().int().min(0)])
    .optional()
    .describe("Position within the block: 'end' (default), 'start', or a 0-based index."),
});

const UpdateExerciseOp = z.object({
  op: z.literal("updateExercise"),
  exerciseName: z
    .string()
    .min(1)
    .describe("Case-insensitive substring against exercise name. Must match exactly one exercise (use `block` to disambiguate)."),
  block: BlockMatchShape.optional().describe("Optional disambiguator when the exercise name appears in multiple blocks."),
  patch: ExercisePrescriptionShape.partial().describe(
    "Fields to update on the matched exercise. Pass only the fields to change; others are preserved.",
  ),
});

const RemoveExerciseOp = z.object({
  op: z.literal("removeExercise"),
  exerciseName: z
    .string()
    .min(1)
    .describe("Case-insensitive substring against exercise name. Must match exactly one exercise (use `block` to disambiguate)."),
  block: BlockMatchShape.optional(),
});

export const WorkoutJsonOpSchema = z.discriminatedUnion("op", [
  AddExerciseOp,
  UpdateExerciseOp,
  RemoveExerciseOp,
]);

export type WorkoutJsonOp = z.infer<typeof WorkoutJsonOpSchema>;

// Find a block by index or by case-insensitive substring against label/type.
// Returns the index (so callers can mutate in place) or throws with a clear
// error naming what was attempted.
function findBlockIndex(blocks: Block[], match: string | number, opIndex: number): number {
  if (typeof match === "number") {
    if (match < 0 || match >= blocks.length) {
      throw new Error(
        `ops[${opIndex}]: block index ${match} is out of range (workout has ${blocks.length} block${blocks.length === 1 ? "" : "s"}).`,
      );
    }
    return match;
  }
  const needle = match.toLowerCase();
  const hits = blocks
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => {
      const label = (b.label ?? "").toLowerCase();
      const type = (b.type ?? "").toLowerCase();
      return label.includes(needle) || type.includes(needle);
    });
  if (hits.length === 0) {
    const avail = blocks
      .map((b, i) => `${i}: ${b.label ?? b.type ?? "(unnamed)"}`)
      .join(", ");
    throw new Error(
      `ops[${opIndex}]: no block matching "${match}". Available blocks: [${avail}].`,
    );
  }
  if (hits.length > 1) {
    const labels = hits.map(({ b, i }) => `${i}: ${b.label ?? b.type}`).join(", ");
    throw new Error(
      `ops[${opIndex}]: "${match}" matched ${hits.length} blocks (${labels}). Use a more specific substring or a block index.`,
    );
  }
  return hits[0]!.i;
}

// Find the position of an exercise within a (possibly disambiguated) block.
// Returns { blockIdx, exerciseIdx } so the caller can mutate. Same uniqueness
// rule as findBlockIndex: zero matches → error, multiple matches → error
// with a hint to use the `block` disambiguator.
function findExercisePosition(
  blocks: Block[],
  exerciseName: string,
  blockMatch: string | number | undefined,
  opIndex: number,
): { blockIdx: number; exerciseIdx: number } {
  const needle = exerciseName.toLowerCase();
  const candidates: { blockIdx: number; exerciseIdx: number }[] = [];
  const blockIdxFilter = blockMatch !== undefined ? findBlockIndex(blocks, blockMatch, opIndex) : null;

  blocks.forEach((b, bi) => {
    if (blockIdxFilter !== null && bi !== blockIdxFilter) return;
    (b.exercises ?? []).forEach((ex, ei) => {
      if (typeof ex.name === "string" && ex.name.toLowerCase().includes(needle)) {
        candidates.push({ blockIdx: bi, exerciseIdx: ei });
      }
    });
  });

  if (candidates.length === 0) {
    const scope = blockIdxFilter !== null ? ` in block ${blockIdxFilter}` : "";
    throw new Error(
      `ops[${opIndex}]: no exercise matching "${exerciseName}"${scope}.`,
    );
  }
  if (candidates.length > 1) {
    const where = candidates
      .map((c) => {
        const b = blocks[c.blockIdx]!;
        const ex = (b.exercises ?? [])[c.exerciseIdx]!;
        return `[block ${c.blockIdx} (${b.label ?? b.type}) → "${ex.name}"]`;
      })
      .join(", ");
    throw new Error(
      `ops[${opIndex}]: "${exerciseName}" matched ${candidates.length} exercises: ${where}. ` +
        `Pass \`block\` to disambiguate (block index or label/type substring).`,
    );
  }
  return candidates[0]!;
}

// Apply ops sequentially to a deep clone of base. Each op sees the result
// of prior ops in the same array, so chains like
// [removeExercise X, addExercise X', updateExercise X' new values] all work
// against an evolving working copy. Throws on the first op that can't be
// applied; the caller never sees a half-applied template.
export function applyWorkoutJsonOps(base: DayTemplate, ops: WorkoutJsonOp[]): DayTemplate {
  if (ops.length === 0) {
    throw new Error("workoutJsonOps was empty — pass at least one operation.");
  }

  // Deep clone via JSON round-trip; DayTemplates are pure JSON-serializable
  // and this avoids accidental mutation of the caller's object.
  const working = JSON.parse(JSON.stringify(base)) as DayTemplate;
  if (!Array.isArray(working.blocks)) {
    working.blocks = [];
  }

  ops.forEach((op, i) => {
    switch (op.op) {
      case "addExercise": {
        const blockIdx = findBlockIndex(working.blocks, op.block, i);
        const block = working.blocks[blockIdx]!;
        if (!Array.isArray(block.exercises)) block.exercises = [];
        const ex = op.exercise as ExercisePrescription;
        if (op.at === "start") {
          block.exercises.unshift(ex);
        } else if (typeof op.at === "number") {
          if (op.at < 0 || op.at > block.exercises.length) {
            throw new Error(
              `ops[${i}]: position ${op.at} is out of range (block has ${block.exercises.length} exercise${block.exercises.length === 1 ? "" : "s"}; valid 0..${block.exercises.length}).`,
            );
          }
          block.exercises.splice(op.at, 0, ex);
        } else {
          // default "end"
          block.exercises.push(ex);
        }
        break;
      }
      case "updateExercise": {
        const { blockIdx, exerciseIdx } = findExercisePosition(
          working.blocks,
          op.exerciseName,
          op.block,
          i,
        );
        const block = working.blocks[blockIdx]!;
        const existing = block.exercises[exerciseIdx]!;
        // Merge: only fields present in patch overwrite; rest preserved.
        block.exercises[exerciseIdx] = { ...existing, ...op.patch };
        break;
      }
      case "removeExercise": {
        const { blockIdx, exerciseIdx } = findExercisePosition(
          working.blocks,
          op.exerciseName,
          op.block,
          i,
        );
        const block = working.blocks[blockIdx]!;
        block.exercises.splice(exerciseIdx, 1);
        break;
      }
    }
  });

  return working;
}
