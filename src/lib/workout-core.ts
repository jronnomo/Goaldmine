// Plain async helpers for Workout mutations.
//
// IMPORTANT: this module intentionally has NO server-action directive at the
// top. It is a plain async helper so it can be imported from both server
// actions (src/lib/workout-actions.ts, src/lib/day-log-actions.ts, etc.) AND
// MCP route handlers / tool registrations (src/lib/mcp/tools.ts). Adding the
// directive would constrain it to server-action call sites only and break the
// MCP path.
//
// Dual-caller contract:
//   - Server actions call these cores and then add revalidatePath.
//   - MCP tools (tools.ts) call these cores directly — no revalidatePath needed
//     because pages are force-dynamic and MCP writes don't need Next.js cache
//     invalidation.

import { z } from "zod";
import { prisma, getDb } from "@/lib/db";
import { recordsSetInWorkout, type RecordSet } from "@/lib/records";
import { ACTIVITY_LINK_TYPE } from "@/lib/activity-links";
import { autoLinkWorkout, swallowAutoLinkError } from "@/lib/attribution-hooks";

// ---------------------------------------------------------------------------
// Input types (mirrors SetInputShape / ExerciseInputShape in tools.ts)
// ---------------------------------------------------------------------------

export type SetInput = {
  setIndex: number;
  reps?: number | null;
  weightLb?: number | null;
  durationSec?: number | null;
  distanceMi?: number | null;
  rpe?: number | null;
  notes?: string | null;
};

export type ExerciseInput = {
  name: string;
  equipment?: string | null;
  orderIndex: number;
  notes?: string | null;
  sets: SetInput[];
};

// ---------------------------------------------------------------------------
// WorkoutOpSchema — moved verbatim from tools.ts:168-215
// Referenced by both tools.ts (import) and workout-edit-actions.ts (REQ-65-3).
// ---------------------------------------------------------------------------

const OpSetInputShape = z.object({
  setIndex: z.number().int().min(1).optional().describe("1-based set number within the exercise. Defaults to max+1."),
  reps: z.number().int().min(0).optional(),
  weightLb: z.number().min(0).optional(),
  durationSec: z.number().min(0).optional(),
  distanceMi: z.number().min(0).optional(),
  rpe: z.number().min(0).max(10).optional(),
  notes: z.string().optional(),
});

const AddExerciseInputShape = z.object({
  name: z.string().min(1),
  equipment: z.string().optional(),
  notes: z.string().optional(),
  orderIndex: z.number().int().min(0).optional().describe("Position in the workout's exercise list. Defaults to max+1 (append)."),
  sets: z.array(OpSetInputShape).optional().describe("Optional initial sets to create alongside the exercise. setIndex auto-numbers 1..N when omitted."),
});

const AddExerciseOpShape = z.object({
  op: z.literal("addExercise"),
  workoutId: z.string(),
  exercise: AddExerciseInputShape,
});

const RemoveExerciseOpShape = z.object({
  op: z.literal("removeExercise"),
  exerciseId: z.string().describe("WorkoutExercise.id — cascade-deletes the exercise's sets."),
});

const AddSetOpShape = z.object({
  op: z.literal("addSet"),
  workoutExerciseId: z.string(),
  set: OpSetInputShape,
});

const RemoveSetOpShape = z.object({
  op: z.literal("removeSet"),
  setId: z.string(),
});

export const WorkoutOpSchema = z.discriminatedUnion("op", [
  AddExerciseOpShape,
  RemoveExerciseOpShape,
  AddSetOpShape,
  RemoveSetOpShape,
]);

export type WorkoutOp = z.infer<typeof WorkoutOpSchema>;

// ---------------------------------------------------------------------------
// createWorkoutCore
// ---------------------------------------------------------------------------

export interface CreateWorkoutCoreInput {
  title?: string | null;
  startedAt: Date;
  status?: string; // default "completed"
  source?: string | null;
  sourceUrl?: string | null;
  notes?: string | null;
  exercises: ExerciseInput[];
}

/**
 * Create a new Workout with nested exercises and sets.
 *
 * recordsSet is computed ONLY when status==="completed" && exercises.length>0.
 * For the MCP log_workout path (always completed, exercises required) this gate
 * is always open. New callers (skipDay, logManualWorkout with status="skipped")
 * receive an empty recordsSet without the extra DB round-trip.
 */
export async function createWorkoutCore(
  input: CreateWorkoutCoreInput,
): Promise<{ id: string; recordsSet: RecordSet[] }> {
  const db = await getDb();
  const status = input.status ?? "completed";
  const created = await db.workout.create({
    data: {
      title: input.title,
      startedAt: input.startedAt,
      status,
      source: input.source ?? null,
      sourceUrl: input.sourceUrl ?? null,
      notes: input.notes ?? null,
      exercises: {
        create: input.exercises.map((ex) => ({
          name: ex.name,
          equipment: ex.equipment ?? null,
          orderIndex: ex.orderIndex,
          notes: ex.notes ?? null,
          sets: {
            create: ex.sets.map((s) => ({
              setIndex: s.setIndex,
              reps: s.reps ?? null,
              weightLb: s.weightLb ?? null,
              durationSec: s.durationSec ?? null,
              distanceMi: s.distanceMi ?? null,
              rpe: s.rpe ?? null,
              notes: s.notes ?? null,
            })),
          },
        })),
      },
    },
  });

  const recordsSet =
    status === "completed" && input.exercises.length > 0
      ? await recordsSetInWorkout(created.id)
      : [];

  // #307 auto-link engine v1a: hint/rule-matched ActivityGoalLink rows for the
  // new workout. No-op without an active Program; skipped for non-completed
  // rows (skipDay placeholders); idempotent; writes are top-level scoped calls
  // through the same client that created the workout. Best-effort — the
  // workout is committed, so a link failure must not fail (and retry-dupe)
  // the log call; backfill-attribution.ts repairs gaps.
  await autoLinkWorkout(db, {
    workoutId: created.id,
    title: input.title ?? null,
    source: input.source ?? null,
    status,
    startedAt: input.startedAt,
    exerciseNames: input.exercises.map((ex) => ex.name),
  }).catch(swallowAutoLinkError("createWorkoutCore"));

  return { id: created.id, recordsSet };
}

// ---------------------------------------------------------------------------
// updateWorkoutCore
// ---------------------------------------------------------------------------

export interface UpdateWorkoutCoreInput {
  title?: string | null;
  notes?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  startedAt?: Date;
  status?: string;
}

/**
 * PATCH-style header update. Undefined fields are left unchanged; null clears
 * nullable fields. ISO validity guard (startedAt) must happen in the MCP
 * handler before calling this core — the core receives a Date.
 */
export async function updateWorkoutCore(
  id: string,
  input: UpdateWorkoutCoreInput,
): Promise<{ id: string; updatedFields: string[]; message: string }> {
  const db = await getDb();
  const data: Record<string, unknown> = {};
  const updatedFields: string[] = [];
  if (input.title !== undefined) { data.title = input.title; updatedFields.push("title"); }
  if (input.notes !== undefined) { data.notes = input.notes; updatedFields.push("notes"); }
  if (input.source !== undefined) { data.source = input.source; updatedFields.push("source"); }
  if (input.sourceUrl !== undefined) { data.sourceUrl = input.sourceUrl; updatedFields.push("sourceUrl"); }
  if (input.startedAt !== undefined) { data.startedAt = input.startedAt; updatedFields.push("startedAt"); }
  if (input.status !== undefined) { data.status = input.status; updatedFields.push("status"); }
  if (updatedFields.length === 0) {
    return { id, updatedFields, message: "No fields provided — nothing changed." };
  }
  await db.workout.update({ where: { id }, data });
  return {
    id,
    updatedFields,
    message: `Workout updated (changed: ${updatedFields.join(", ")}). Other fields preserved.`,
  };
}

// ---------------------------------------------------------------------------
// updateWorkoutSetCore (lift from tools.ts:3804-3824)
// ---------------------------------------------------------------------------

export interface UpdateWorkoutSetCoreInput {
  setIndex?: number;
  reps?: number | null;
  weightLb?: number | null;
  durationSec?: number | null;
  distanceMi?: number | null;
  rpe?: number | null;
  notes?: string | null;
}

export async function updateWorkoutSetCore(
  id: string,
  patch: UpdateWorkoutSetCoreInput,
): Promise<{ id: string; updatedFields: string[]; message: string }> {
  const data: Record<string, unknown> = {};
  const updatedFields: string[] = [];
  if (patch.setIndex !== undefined) { data.setIndex = patch.setIndex; updatedFields.push("setIndex"); }
  if (patch.reps !== undefined) { data.reps = patch.reps; updatedFields.push("reps"); }
  if (patch.weightLb !== undefined) { data.weightLb = patch.weightLb; updatedFields.push("weightLb"); }
  if (patch.durationSec !== undefined) { data.durationSec = patch.durationSec; updatedFields.push("durationSec"); }
  if (patch.distanceMi !== undefined) { data.distanceMi = patch.distanceMi; updatedFields.push("distanceMi"); }
  if (patch.rpe !== undefined) { data.rpe = patch.rpe; updatedFields.push("rpe"); }
  if (patch.notes !== undefined) { data.notes = patch.notes; updatedFields.push("notes"); }
  if (updatedFields.length === 0) {
    return { id, updatedFields, message: "No fields provided — nothing changed." };
  }
  await prisma.set.update({ where: { id }, data });
  return {
    id,
    updatedFields,
    message: `Set updated (changed: ${updatedFields.join(", ")}). Other fields preserved.`,
  };
}

// ---------------------------------------------------------------------------
// workoutOpsCore (lift from tools.ts:3845-3919)
// ---------------------------------------------------------------------------

/**
 * Apply a sequence of add/remove operations on a Workout in one all-or-nothing
 * transaction. Identical defaults + rollback message to the original handler.
 */
export async function workoutOpsCore(
  ops: WorkoutOp[],
): Promise<{ count: number; applied: string[]; message: string }> {
  const db = await getDb();
  const applied: string[] = [];
  await db.$transaction(async (tx) => {
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i]!;
      try {
        if (op.op === "addExercise") {
          const orderIndex =
            op.exercise.orderIndex ??
            ((await tx.workoutExercise.aggregate({
              where: { workoutId: op.workoutId },
              _max: { orderIndex: true },
            }))._max.orderIndex ?? -1) + 1;
          const created = await tx.workoutExercise.create({
            data: {
              workoutId: op.workoutId,
              name: op.exercise.name,
              equipment: op.exercise.equipment ?? null,
              notes: op.exercise.notes ?? null,
              orderIndex,
              sets: op.exercise.sets
                ? {
                    create: op.exercise.sets.map((s, idx) => ({
                      setIndex: s.setIndex ?? idx + 1,
                      reps: s.reps ?? null,
                      weightLb: s.weightLb ?? null,
                      durationSec: s.durationSec ?? null,
                      distanceMi: s.distanceMi ?? null,
                      rpe: s.rpe ?? null,
                      notes: s.notes ?? null,
                    })),
                  }
                : undefined,
            },
          });
          applied.push(
            `addExercise → ${created.id} (${op.exercise.sets?.length ?? 0} set${op.exercise.sets?.length === 1 ? "" : "s"})`,
          );
        } else if (op.op === "removeExercise") {
          await tx.workoutExercise.delete({ where: { id: op.exerciseId } });
          applied.push(`removeExercise → ${op.exerciseId}`);
        } else if (op.op === "addSet") {
          const setIndex =
            op.set.setIndex ??
            ((await tx.set.aggregate({
              where: { workoutExerciseId: op.workoutExerciseId },
              _max: { setIndex: true },
            }))._max.setIndex ?? 0) + 1;
          const created = await tx.set.create({
            data: {
              workoutExerciseId: op.workoutExerciseId,
              setIndex,
              reps: op.set.reps ?? null,
              weightLb: op.set.weightLb ?? null,
              durationSec: op.set.durationSec ?? null,
              distanceMi: op.set.distanceMi ?? null,
              rpe: op.set.rpe ?? null,
              notes: op.set.notes ?? null,
            },
          });
          applied.push(`addSet → ${created.id} (setIndex=${setIndex})`);
        } else if (op.op === "removeSet") {
          await tx.set.delete({ where: { id: op.setId } });
          applied.push(`removeSet → ${op.setId}`);
        }
      } catch (e) {
        throw new Error(
          `workout_ops failed at ops[${i}] (op=${op.op}): ${e instanceof Error ? e.message : String(e)}. Whole batch rolled back; nothing was written.`,
        );
      }
    }
  });
  return { count: applied.length, applied, message: `Applied ${applied.length} op${applied.length === 1 ? "" : "s"} atomically.` };
}

// ---------------------------------------------------------------------------
// deleteWorkoutCore
// ---------------------------------------------------------------------------

/**
 * Delete one Workout row AND its ActivityGoalLink rows in the same
 * transaction (#272 delete-hook consolidation).
 *
 * - WorkoutExercise/Set rows go via FK cascade on the workout delete; links
 *   attach to the workout id only, so one deleteMany covers them.
 * - Sequential top-level calls on the tx client (never nested writes) so the
 *   getDb() tenant-scoping extension fires for BOTH deletes.
 * - A missing id throws P2025 from workout.delete exactly as the bare delete
 *   did — the link cleanup runs after it and cannot mask that error.
 */
export async function deleteWorkoutCore(id: string): Promise<{ id: string }> {
  const db = await getDb();
  await db.$transaction(async (tx) => {
    await tx.workout.delete({ where: { id } });
    await tx.activityGoalLink.deleteMany({
      where: { activityType: ACTIVITY_LINK_TYPE.workout, activityId: id },
    });
  });
  return { id };
}

/**
 * Batch variant for filter-driven deletes (unskipDay's deleteMany backstop).
 * Unlike deleteWorkoutCore, missing ids do NOT throw — deleteMany semantics
 * (the caller resolved ids from a filter, so "already gone" is not an error).
 * Link cleanup rides the same transaction, matching deleteWorkoutCore.
 */
export async function deleteWorkoutsCore(
  ids: string[],
): Promise<{ deleted: number }> {
  if (ids.length === 0) return { deleted: 0 };
  const db = await getDb();
  const deleted = await db.$transaction(async (tx) => {
    const res = await tx.workout.deleteMany({ where: { id: { in: ids } } });
    await tx.activityGoalLink.deleteMany({
      where: { activityType: ACTIVITY_LINK_TYPE.workout, activityId: { in: ids } },
    });
    return res.count;
  });
  return { deleted };
}
