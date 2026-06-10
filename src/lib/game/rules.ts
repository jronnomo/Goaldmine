// src/lib/game/rules.ts
// XP constants, level curve, and attribute/category maps.
// ALL game constants live here — never hardcode in engine, badges, quest, or components.

import type { AttributeId } from "@/lib/game/types";

// ── Level curve ──────────────────────────────────────────────────────────────
// Cost of level L → L+1 = base * L. Total XP to reach level N = base * N*(N-1)/2.
// ATTR (base=60): L2=60; L5=600; L8=1680; L9=2160; L10=2700
// OVERALL (base=150): L2=150; L5=1500; L8=4200; L9=5400

export const ATTR_LEVEL_BASE = 60;
export const OVERALL_LEVEL_BASE = 150;

export function levelFromXp(
  xp: number,
  base: number,
): { level: number; xpIntoLevel: number; xpToNext: number } {
  let remaining = xp;
  let level = 1;
  while (true) {
    const costOfNextLevel = base * level; // cost to go from level → level+1
    if (remaining < costOfNextLevel) {
      return { level, xpIntoLevel: remaining, xpToNext: costOfNextLevel };
    }
    remaining -= costOfNextLevel;
    level++;
  }
}

export function xpForLevel(level: number, base: number): number {
  // Total XP needed to reach this level (sum of costs 1..level-1)
  return (base * (level - 1) * level) / 2;
}

export function xpToNextLevel(level: number, base: number): number {
  return base * level;
}

// ── XP economy ───────────────────────────────────────────────────────────────
// Volume and cardio XP: per-workout, no daily cap (intentional for single user).
// A re-imported workout doubles these; coach should use delete_workout to fix.

export const FITNESS_XP = {
  // Per-workout (1/day cap applied by engine for workout.completed)
  WORKOUT_COMPLETED: 25,

  // Volume: per 1000 lb lifted (weightLb * reps sum), capped per workout
  WORKOUT_VOLUME_PER_1000LB: 1,
  WORKOUT_VOLUME_CAP: 15,

  // Cardio: duration-only sets, per 10 min, capped per workout
  WORKOUT_CARDIO_PER_10MIN: 1,
  WORKOUT_CARDIO_CAP: 10,

  // PRs: per new personal record (3/day cap)
  PR_SET: 40,

  // Baselines
  BASELINE_LOGGED: 20,
  BASELINE_ON_TIME: 10,

  // Hike: elevation-scaled (see hikeXp() helper)
  HIKE_BASE: 30,
  HIKE_PER_1000FT: 10,
  HIKE_ELEVATION_BONUS_CAP: 60,
  HIKE_PACK_BONUS: 10,

  // Mobility: per session (1/day cap)
  MOBILITY_SESSION: 15,

  // Nutrition: per qualifying day (≥2 logs)
  NUTRITION_DAY: 5,

  // Review: per weekly review note
  REVIEW_WEEKLY: 25,

  // Plan adherence: per in-plan day success
  ADHERENCE_DAY: 10,
} as const;

// Pack weight threshold for hike bonus (lb)
export const HIKE_PACK_THRESHOLD_LB = 20;

/**
 * Compute XP for a completed hike.
 * Formula: base(30) + min(floor(elevationFt/1000)×10, 60) + (packWeightLb ≥ 20 ? 10 : 0)
 * MUST be called from rules.ts — never inline the formula in engine or quest.
 */
export function hikeXp(elevationFt: number, packWeightLb: number | null): number {
  const elevationBonus = Math.min(
    Math.floor(elevationFt / 1000) * FITNESS_XP.HIKE_PER_1000FT,
    FITNESS_XP.HIKE_ELEVATION_BONUS_CAP,
  );
  const packBonus = (packWeightLb ?? 0) >= HIKE_PACK_THRESHOLD_LB ? FITNESS_XP.HIKE_PACK_BONUS : 0;
  return FITNESS_XP.HIKE_BASE + elevationBonus + packBonus;
}

// ── Streak milestones ─────────────────────────────────────────────────────────
// Per-run re-earnable: each run independently earns when it crosses a threshold.
export const MILESTONE_THRESHOLDS = [7, 14, 30, 60, 90] as const;
export const MILESTONE_XP: Record<number, number> = {
  7: 50,
  14: 75,
  30: 100,
  60: 150,
  90: 200,
};

// ── Category → Attribute map ──────────────────────────────────────────────────
// DayTemplate.category → AttributeId that earns workout.completed XP
// CRITICAL: "lower-power" (not "power") per program-template.ts line 29.
export const CATEGORY_ATTRIBUTE_MAP: Record<string, AttributeId> = {
  upper: "STR",
  lower: "STR",
  "zone2-mobility": "MOB",
  calisthenics: "STR",
  "lower-power": "STR", // PRD says "power→STR"; actual category string is "lower-power"
  "long-endurance": "END",
  rest: "CON", // rest days earn adherence.day → CON (not workout.completed)
};

// Fallback for off-plan days or unknown categories
export const DEFAULT_WORKOUT_ATTRIBUTE: AttributeId = "STR";

// ── PR → Attribute map ────────────────────────────────────────────────────────
// Maps canonical exercise name → attribute for pr.set XP.
// Uses keyword inclusion — no regex.
const MOB_KEYWORDS = ["squat hold", "toe touch", "shoulder", "hip", "ankle"];
const END_KEYWORDS = ["run", "bike", "step-up", "stair", "row", "swim"];

export function prAttributeForExercise(canonicalName: string): AttributeId {
  const lower = canonicalName.toLowerCase();
  if (MOB_KEYWORDS.some((kw) => lower.includes(kw))) return "MOB";
  if (END_KEYWORDS.some((kw) => lower.includes(kw))) return "END";
  return "STR";
}

// ── Baseline → Attribute map ──────────────────────────────────────────────────
// Maps testName → AttributeId for baseline.logged XP.
// "Plank Max Hold" → "STR" per Post-v2 amendment #4.
// Add new entries as tests are added to the plan.
export const BASELINE_ATTRIBUTE_MAP: Record<string, AttributeId> = {
  "Plank Max Hold": "STR",
  "Pull-Up Max Reps": "STR",
  "Push-Up Max Reps": "STR",
  "Dip Max Reps": "STR",
  "Hollow Hold": "STR",
  "1.5 Mile Run": "END",
  "20 Min Row": "END",
  "2-Min Bodyweight Squat": "END",
  "Toe Touch": "MOB",
  "Shoulder Mobility": "MOB",
  "Hip Flexor Stretch": "MOB",
  "Ankle Dorsiflexion": "MOB",
  "Pull-Up Total Across 5 Sets": "STR",
};

/** Fallback attribute for unmapped baseline test names. */
export function baselineAttributeForTest(testName: string): AttributeId {
  return BASELINE_ATTRIBUTE_MAP[testName] ?? "STR";
}
