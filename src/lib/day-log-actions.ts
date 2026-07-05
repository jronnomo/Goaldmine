"use server";

// Server actions for day-page logging (REQ-65-2).
//
// DA fixes encoded here:
//   H2  — skipDay title = "Skipped — {templateTitle ?? "day"}"
//   H3  — isRestDay guard + isInPlan guard on skipDay (UI hides; action also throws)
//   M1/M2 — logHikeForDay revalidates /history + /character
//   M3  — startedAt via userTzWallClockToUTC (DST-safe)
//   M4  — unskipDay uses deleteMany (backstop against orphaned skips)
//   M5  — setIndex assigned 1..N per exercise in server action

import { revalidatePath } from "next/cache";
import {
  parseDateKey,
  dateKey as toDateKey,
  startOfDay,
  endOfDay,
  userTzWallClockToUTC,
} from "@/lib/calendar";
import { createWorkoutCore, type ExerciseInput } from "@/lib/workout-core";
import { logHikeCore, type LogHikeCoreInput } from "@/lib/hike-core";
import { getDb } from "@/lib/db";
import type { RecordSet } from "@/lib/records";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse "HH:MM" into {hh, mm}. Returns {hh:0, mm:0} as safe default. */
function parseHHMM(hhmm: string): { hh: number; mm: number } {
  const [hStr, mStr] = (hhmm ?? "00:00").split(":");
  const hh = Math.min(23, Math.max(0, parseInt(hStr ?? "0", 10) || 0));
  const mm = Math.min(59, Math.max(0, parseInt(mStr ?? "0", 10) || 0));
  return { hh, mm };
}

/**
 * Build a DST-safe Date for a given dateKey + HH:MM in USER_TZ.
 * Used for logManualWorkout startedAt (UXR-65-29 / DA M3).
 */
function wallClockForDay(dateKeyStr: string, hh: number, mm: number): Date {
  const [yStr, mStr, dStr] = dateKeyStr.split("-");
  const y = parseInt(yStr!, 10);
  const mo = parseInt(mStr!, 10); // 1-based
  const d = parseInt(dStr!, 10);
  return userTzWallClockToUTC(y, mo, d, hh, mm);
}

// ---------------------------------------------------------------------------
// logManualWorkout
// ---------------------------------------------------------------------------

export interface ManualExerciseRow {
  name: string;
  equipment?: string | null;
  notes?: string | null;
  /** Sets for this exercise. Each set must have at least one measurement. */
  sets: Array<{
    reps?: number | null;
    weightLb?: number | null;
    durationSec?: number | null;
    distanceMi?: number | null;
    rpe?: number | null;
    notes?: string | null;
  }>;
}

export interface LogManualWorkoutInput {
  dateKey: string;
  title?: string | null;
  /** "HH:MM" in USER_TZ — used to set startedAt (default "12:00" for past days). */
  timeHHMM: string;
  notes?: string | null;
  exercises: ManualExerciseRow[];
}

/**
 * Log a manually-entered workout on a past or current day.
 * Returns {id, recordsSet} for the PR strip.
 * Throws if dateKey is in the future.
 */
export async function logManualWorkout(
  input: LogManualWorkoutInput,
): Promise<{ id: string; recordsSet: RecordSet[] }> {
  const today = toDateKey(new Date());
  if (input.dateKey > today) {
    throw new Error("Cannot log a workout on a future day.");
  }

  const { hh, mm } = parseHHMM(input.timeHHMM);
  const startedAt = wallClockForDay(input.dateKey, hh, mm);

  // DA M5: assign setIndex 1..N per exercise in the server action.
  const exercises: ExerciseInput[] = input.exercises.map((ex, orderIndex) => ({
    name: ex.name,
    equipment: ex.equipment ?? null,
    orderIndex,
    notes: ex.notes ?? null,
    sets: ex.sets.map((s, si) => ({
      setIndex: si + 1,
      reps: s.reps ?? null,
      weightLb: s.weightLb ?? null,
      durationSec: s.durationSec ?? null,
      distanceMi: s.distanceMi ?? null,
      rpe: s.rpe ?? null,
      notes: s.notes ?? null,
    })),
  }));

  const result = await createWorkoutCore({
    title: input.title ?? null,
    startedAt,
    status: "completed",
    source: "manual",
    notes: input.notes ?? null,
    exercises,
  });

  revalidatePath("/");
  revalidatePath("/history");
  revalidatePath("/calendar");
  revalidatePath(`/days/${input.dateKey}`);
  revalidatePath("/progress");
  revalidatePath("/character");

  return result;
}

// ---------------------------------------------------------------------------
// skipDay
// ---------------------------------------------------------------------------

export interface SkipDayInput {
  dateKey: string;
  reason?: string | null;
  templateTitle?: string | null;
  isRestDay: boolean;
  isInPlan: boolean;
}

/**
 * Mark a day as skipped (acknowledged missed session).
 * Idempotent — if a skipped workout already exists this day, updates its notes.
 * Throws if: future day, rest day, or not in plan (DA H2/H3).
 */
export async function skipDay(input: SkipDayInput): Promise<{ id: string }> {
  const today = toDateKey(new Date());
  if (input.dateKey > today) {
    throw new Error("Cannot skip a future day.");
  }
  // DA H3: guard rest day + not-in-plan at action level (UI also hides the button).
  if (input.isRestDay) {
    throw new Error("Cannot skip a rest day — no workout is scheduled.");
  }
  if (!input.isInPlan) {
    throw new Error("Cannot skip a day with no planned workout.");
  }

  // DA H2: title includes the template name.
  const title = `Skipped — ${input.templateTitle ?? "day"}`;
  const notes = input.reason?.trim() || null;

  // startedAt = noon of the day (DST-safe via DA M3).
  const startedAt = wallClockForDay(input.dateKey, 12, 0);
  const dayStart = startOfDay(parseDateKey(input.dateKey));
  const dayEnd = endOfDay(parseDateKey(input.dateKey));

  // Idempotent: look for an existing skipped workout this day.
  const db = await getDb();
  const existing = await db.workout.findFirst({
    where: {
      status: "skipped",
      startedAt: { gte: dayStart, lte: dayEnd },
    },
    select: { id: true },
  });

  if (existing) {
    await db.workout.update({
      where: { id: existing.id },
      data: { notes, title },
    });
    revalidatePath("/");
    revalidatePath("/calendar");
    revalidatePath("/days");
    revalidatePath(`/days/${input.dateKey}`);
    revalidatePath("/history");
    revalidatePath("/progress");
    return { id: existing.id };
  }

  const result = await createWorkoutCore({
    title,
    startedAt,
    status: "skipped",
    source: "manual",
    notes,
    exercises: [],
  });

  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath("/days");
  revalidatePath(`/days/${input.dateKey}`);
  revalidatePath("/history");
  revalidatePath("/progress");

  return { id: result.id };
}

// ---------------------------------------------------------------------------
// unskipDay
// ---------------------------------------------------------------------------

/**
 * Remove all skipped-status workouts for the given day.
 * Uses deleteMany as a backstop (DA M4) — handles edge cases where multiple
 * skipped rows accumulated.
 */
export async function unskipDay(dateKey: string): Promise<{ deleted: number }> {
  const dayStart = startOfDay(parseDateKey(dateKey));
  const dayEnd = endOfDay(parseDateKey(dateKey));

  // DA M4: deleteMany backstop — removes all skipped rows for this day.
  // getDb() injects userId into deleteMany where → auto-scoped to current user's workouts.
  const db = await getDb();
  const result = await db.workout.deleteMany({
    where: {
      status: "skipped",
      startedAt: { gte: dayStart, lte: dayEnd },
    },
  });

  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath("/days");
  revalidatePath(`/days/${dateKey}`);
  revalidatePath("/history");
  revalidatePath("/progress");

  return { deleted: result.count };
}

// ---------------------------------------------------------------------------
// logHikeForDay
// ---------------------------------------------------------------------------

export interface LogHikeForDayInput {
  dateKey: string;
  route: string;
  distanceMi: number;
  elevationFt: number;
  durationMin: number;
  packWeightLb?: number | null;
  rpe?: number | null;
  notes?: string | null;
  goalId?: string | null;
  replacesPlannedHikeId?: string;
}

/**
 * Log a completed hike for a specific day.
 * DA M1/M2: revalidates /history and /character.
 */
export async function logHikeForDay(input: LogHikeForDayInput) {
  const today = toDateKey(new Date());
  if (input.dateKey > today) {
    throw new Error("Cannot log a hike on a future day.");
  }

  const date = parseDateKey(input.dateKey);

  const hikeInput: LogHikeCoreInput = {
    date,
    route: input.route,
    distanceMi: input.distanceMi,
    elevationFt: input.elevationFt,
    durationMin: input.durationMin,
    packWeightLb: input.packWeightLb ?? null,
    rpe: input.rpe ?? null,
    status: "completed",
    notes: input.notes ?? null,
    goalId: input.goalId ?? null,
    ...(input.replacesPlannedHikeId !== undefined && {
      replacesPlannedHikeId: input.replacesPlannedHikeId,
    }),
  };

  const result = await logHikeCore(hikeInput);

  // DA M1/M2: revalidate /history + /character in addition to the base set.
  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath("/days");
  revalidatePath(`/days/${input.dateKey}`);
  revalidatePath("/progress");
  revalidatePath("/history");
  revalidatePath("/character");

  return result;
}
