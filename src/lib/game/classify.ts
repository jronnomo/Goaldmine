// src/lib/game/classify.ts
// Content-based workout classifier.
//
// The XP engine historically credited every completed workout to the *day's
// scheduled template category* (buildDayLedger). That conflates "what was
// scheduled" with "what was done": an off-plan session (e.g. mobility logged on
// an upper day, or anything logged on a rest day) was mis-credited or dropped.
//
// This module classifies a workout by its actual exercise content so the engine
// can award the matching trait for work that goes beyond the daily plan. On
// on-plan days the content class agrees with the template category, so this is
// corrective for off-plan effort and (close to) a no-op on-plan.

import type { AttributeId } from "@/lib/game/types";

export type WorkoutContentClass = "mobility" | "endurance" | "strength";

// Lightweight shape — matches the engine's WorkoutWithSets exercises and the
// parseStrongWorkout output. Only the fields we actually read are required.
export type ClassifiableExercise = {
  name: string;
  sets: Array<{
    weightLb?: number | null;
    reps?: number | null;
    durationSec?: number | null;
    distanceMi?: number | null;
  }>;
};

// Mobility / flexibility movements. Keyword match against the lowercased name.
// "squat hold" is listed explicitly (it has no "stretch"/"mobility" token but is
// the program's signature mobility move). Holds like "plank"/"wall sit" are NOT
// here — they read as strength/core, not mobility.
export const MOBILITY_KEYWORDS = [
  "stretch", "mobility", "foam roll", "foot roll", "squat hold",
  "hip flexor", "hip switch", "90/90", "thoracic", "dislocate", "dislocates",
  "pigeon", "couch", "dorsiflexion", "cat-cow", "cat cow", "thread the needle",
  "spinal twist", "forward fold", "toe touch", "figure-4", "figure 4",
  "pvc", "warm-up", "warmup", "cool-down", "cooldown", "opener", "pose",
] as const;

// Cardio / endurance modalities. Deliberately specific — bare "row" and
// "step-up" are excluded because they collide with strength moves
// ("Bent Over Row", "Box Step-Up"). Distance-based sets are an extra signal.
export const ENDURANCE_KEYWORDS = [
  "run", "jog", "sprint", "bike", "biking", "cycle", "cycling", "spin",
  "stairmaster", "stair climb", "stairs", "elliptical", "treadmill",
  "rower", "rowing machine", "swim", "ruck", "incline walk", "cardio",
  "zone 2", "zone2", "conditioning", "steady state",
] as const;

function matches(name: string, keywords: readonly string[]): boolean {
  const n = name.toLowerCase();
  return keywords.some((k) => n.includes(k));
}

/** Classify a single exercise by its name + set shape. */
export function classifyExercise(ex: ClassifiableExercise): WorkoutContentClass {
  if (matches(ex.name, MOBILITY_KEYWORDS)) return "mobility";
  if (matches(ex.name, ENDURANCE_KEYWORDS)) return "endurance";
  // Distance logged with no load ⇒ cardio (covers machines/efforts named oddly).
  const hasDistance = ex.sets.some(
    (s) => s.distanceMi != null && s.distanceMi > 0 && (s.weightLb == null || s.weightLb === 0),
  );
  if (hasDistance) return "endurance";
  return "strength";
}

/**
 * Classify a whole workout by the dominant modality of its exercises.
 * Returns null only when there is nothing to classify (no exercises).
 * Tie-break order: mobility > endurance > strength — a session that is half
 * mobility is treated as a mobility session (it's the under-credited modality
 * this classifier exists to rescue).
 */
export function classifyWorkoutContent(
  exercises: ClassifiableExercise[],
): WorkoutContentClass | null {
  if (!exercises || exercises.length === 0) return null;
  const counts: Record<WorkoutContentClass, number> = {
    mobility: 0,
    endurance: 0,
    strength: 0,
  };
  for (const ex of exercises) counts[classifyExercise(ex)]++;

  if (counts.mobility >= counts.endurance && counts.mobility >= counts.strength) {
    return "mobility";
  }
  if (counts.endurance >= counts.strength) return "endurance";
  return "strength";
}

const CONTENT_ATTRIBUTE: Record<WorkoutContentClass, AttributeId> = {
  mobility: "MOB",
  endurance: "END",
  strength: "STR",
};

/** Trait an attribute that a content-classified workout should credit. */
export function contentClassToAttribute(cls: WorkoutContentClass): AttributeId {
  return CONTENT_ATTRIBUTE[cls];
}

const CONTENT_LABEL: Record<WorkoutContentClass, string> = {
  mobility: "Mobility session",
  endurance: "Endurance workout",
  strength: "Strength workout",
};

export function contentClassLabel(cls: WorkoutContentClass): string {
  return CONTENT_LABEL[cls];
}
