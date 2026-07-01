"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import {
  updateWorkoutCore,
  updateWorkoutSetCore,
  workoutOpsCore,
  deleteWorkoutCore,
} from "@/lib/workout-core";
import type {
  UpdateWorkoutCoreInput,
  UpdateWorkoutSetCoreInput,
  WorkoutOp,
} from "@/lib/workout-core";
import { dateKey } from "@/lib/calendar";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SetPatch = { id: string } & UpdateWorkoutSetCoreInput;

export interface SaveWorkoutEditsInput {
  /** PATCH-style header fields (title, notes). Only provided keys are updated. */
  header?: UpdateWorkoutCoreInput;
  /** Per-set patches keyed by set id. Only changed fields need to be present. */
  setPatches?: SetPatch[];
  /** Structural ops: addExercise / removeExercise / addSet / removeSet. */
  ops?: WorkoutOp[];
}

// ─── saveWorkoutEdits ─────────────────────────────────────────────────────────

/**
 * Apply edits to an existing workout in three sequential phases:
 *   1. Header patch (updateWorkoutCore)              — if header fields changed
 *   2. Per-set patches (updateWorkoutSetCore per id) — if any set was modified
 *   3. Structural ops (workoutOpsCore, transactional) — if any add/remove ops
 *
 * IMPORTANT: The three phases are sequential but NOT cross-phase atomic. A
 * failure in phase 2 leaves phase 1 already committed; a failure in phase 3
 * leaves phases 1 and 2 already committed. This is a deliberate tradeoff
 * matching the sequential MCP call pattern (DA sign-off M6) — the UI sends a
 * single diffed payload so in practice only one phase runs per typical edit,
 * and the ops phase (phase 3) is internally wrapped in a single DB transaction.
 */
export async function saveWorkoutEdits(
  workoutId: string,
  { header, setPatches, ops }: SaveWorkoutEditsInput,
): Promise<void> {
  // Fetch startedAt upfront so we can target the day route in revalidation.
  const db = await getDb();
  const workout = await db.workout.findUniqueOrThrow({
    where: { id: workoutId },
    select: { startedAt: true },
  });
  const dk = dateKey(workout.startedAt);

  // Phase 1 — header
  if (header && Object.keys(header).length > 0) {
    await updateWorkoutCore(workoutId, header);
  }

  // Phase 2 — per-set patches
  if (setPatches && setPatches.length > 0) {
    for (const { id, ...patch } of setPatches) {
      await updateWorkoutSetCore(id, patch);
    }
  }

  // Phase 3 — structural ops (internally transactional)
  if (ops && ops.length > 0) {
    await workoutOpsCore(ops);
  }

  revalidatePath(`/workouts/${workoutId}`);
  revalidatePath("/");
  revalidatePath("/history");
  revalidatePath(`/days/${dk}`);
  revalidatePath("/calendar");
  revalidatePath("/progress");
  revalidatePath("/stats");
}

// ─── deleteWorkoutAction ──────────────────────────────────────────────────────

export async function deleteWorkoutAction(workoutId: string): Promise<never> {
  const db = await getDb();
  const workout = await db.workout.findUniqueOrThrow({
    where: { id: workoutId },
    select: { startedAt: true },
  });
  const dk = dateKey(workout.startedAt);

  await deleteWorkoutCore(workoutId);

  revalidatePath(`/workouts/${workoutId}`);
  revalidatePath("/");
  revalidatePath("/history");
  revalidatePath(`/days/${dk}`);
  revalidatePath("/calendar");
  revalidatePath("/progress");
  revalidatePath("/stats");

  redirect("/history");
}
