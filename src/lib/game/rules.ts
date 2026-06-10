// src/lib/game/rules.ts
// XP constants, level curve math, category→attribute map, PR attribute map,
// baseline attribute map, and streak milestone table.
// All rule constants live here ONLY — no duplicates elsewhere.

import type { AttributeId } from "@/lib/game/types";

// ─────────────────────────────────────────────────────────
// Level curve constants
// ─────────────────────────────────────────────────────────

// Cost of level L → L+1 = ATTR_LEVEL_BASE * L
// Total XP to reach level N = ATTR_LEVEL_BASE * N*(N-1)/2
export const ATTR_LEVEL_BASE = 60;

// Same formula for overall level, larger base.
// Total XP to reach level N = OVERALL_LEVEL_BASE * N*(N-1)/2
export const OVERALL_LEVEL_BASE = 150;

// Sanity checks (for documentation only; these are NOT runtime assertions):
// ATTR (base=60):    L2=60 total; L5=600; L8=1680; L9=2160; L10=2700.
// OVERALL (base=150): L2=150; L5=1500; L8=4200; L9=5400.

// ─────────────────────────────────────────────────────────
// Level math functions
// ─────────────────────────────────────────────────────────

export function levelFromXp(
  xp: number,
  base: number,
): { level: number; xpIntoLevel: number; xpToNext: number } {
  let level = 1;
  let remaining = xp;
  while (true) {
    const costOfNextLevel = base * level; // cost to go from level → level+1
    if (remaining < costOfNextLevel) {
      return { level, xpIntoLevel: remaining, xpToNext: costOfNextLevel };
    }
    remaining -= costOfNextLevel;
    level++;
  }
}

/** Total XP required to reach a given level from zero. */
export function xpForLevel(level: number, base: number): number {
  // Σ (base * L) for L = 1 to level-1 = base * (level-1)*level/2
  return base * ((level - 1) * level) / 2;
}

/** XP needed to advance from the current level to the next. */
export function xpToNextLevel(level: number, base: number): number {
  return base * level;
}

// ─────────────────────────────────────────────────────────
// XP Constants Table
// ─────────────────────────────────────────────────────────

// Volume and cardio XP: per-workout, no daily cap (intentional for single user).
// A re-imported workout doubles these; coach should use delete_workout to fix.
export const FITNESS_XP = {
  // Workout completion (per category, 1/day cap)
  WORKOUT_COMPLETED: 25,

  // Volume XP (per-workout, no daily cap): floor(totalLb / 1000) capped at WORKOUT_VOLUME_CAP
  WORKOUT_VOLUME_PER_1000LB: 1,
  WORKOUT_VOLUME_CAP: 15,

  // Cardio XP (per-workout, no daily cap): floor(totalDurationSec / 600) capped at WORKOUT_CARDIO_CAP
  WORKOUT_CARDIO_PER_10MIN: 1,
  WORKOUT_CARDIO_CAP: 10,

  // PR XP (3/day cap)
  PR_SET: 40,

  // Baseline XP (per row, no cap)
  BASELINE_LOGGED: 20,
  BASELINE_ON_TIME: 10, // bonus: logged within ±7 days of scheduled checkpoint

  // Hike XP (per completed hike, no cap)
  HIKE_COMPLETED: 60,

  // Mobility (1/day via MobilityCheckin or zone2-mobility workout)
  MOBILITY_SESSION: 15,

  // Nutrition (1/day when ≥2 NutritionLog rows on that calendar day)
  NUTRITION_DAY: 5,

  // Weekly review (per review note)
  REVIEW_WEEKLY: 20,

  // Plan adherence (1/day; rest days = automatic success)
  ADHERENCE_DAY: 10,
} as const;

// ─────────────────────────────────────────────────────────
// Streak milestone table
// ─────────────────────────────────────────────────────────

// Milestones are per-run and re-earnable (reset on break).
// Each run earns its own milestone XP when it crosses each threshold.
export const MILESTONE_THRESHOLDS = [7, 14, 30, 60, 90] as const;

export const MILESTONE_XP: Record<number, number> = {
  7: 50,
  14: 75,
  30: 100,
  60: 150,
  90: 200,
};

// ─────────────────────────────────────────────────────────
// Category → Attribute map
// ─────────────────────────────────────────────────────────

// Maps DayTemplate.category values (from program-template.ts) to XP attribute ids.
// IMPORTANT: "lower-power" is the exact string in program-template.ts (line 34).
// PRD table uses "power" as shorthand only — this map uses the real string.
export const CATEGORY_ATTRIBUTE_MAP: Record<string, AttributeId | null> = {
  upper: "STR",          // Day 1
  lower: "STR",          // Day 2
  "zone2-mobility": "MOB", // Day 3
  calisthenics: "STR",   // Day 4
  "lower-power": "STR",  // Day 5 — must be "lower-power", NOT "power"
  "long-endurance": "END", // Day 6
  rest: null,            // No workout.completed XP on rest days
};

// Fallback for unknown/null categories (off-plan or pre-plan workouts).
export const CATEGORY_ATTRIBUTE_FALLBACK: AttributeId = "STR";

/** Resolve the XP attribute for a given day category. */
export function categoryToAttribute(category: string | null): AttributeId | null {
  if (category === null) return CATEGORY_ATTRIBUTE_FALLBACK;
  const mapped = CATEGORY_ATTRIBUTE_MAP[category];
  // mapped is undefined for unknown categories; fall back to STR (same as null/off-plan)
  if (mapped === undefined) return CATEGORY_ATTRIBUTE_FALLBACK;
  return mapped;
}

// ─────────────────────────────────────────────────────────
// PR Attribute Map
// ─────────────────────────────────────────────────────────

// Keywords checked against canonical exercise name (lowercase) to bucket PRs.
// Uses Array.some — no regex. Order matters: first match wins.
const MOB_PR_KEYWORDS = [
  "squat hold",
  "toe touch",
  "shoulder",
  "hip",
  "ankle",
] as const;

const END_PR_KEYWORDS = [
  "run",
  "bike",
  "step-up",
  "stair",
  "row",
  "swim",
] as const;

/** Return the attribute that a PR on the given canonical exercise name should credit. */
export function prAttributeForExercise(canonicalName: string): AttributeId {
  const lower = canonicalName.toLowerCase();
  if (MOB_PR_KEYWORDS.some((kw) => lower.includes(kw))) return "MOB";
  if (END_PR_KEYWORDS.some((kw) => lower.includes(kw))) return "END";
  return "STR";
}

// ─────────────────────────────────────────────────────────
// Baseline → Attribute map
// ─────────────────────────────────────────────────────────

// Maps testName to the XP attribute for baseline.logged events.
// Unknown test names default to CON (general conditioning).
export const BASELINE_ATTRIBUTE_MAP: Record<string, AttributeId> = {
  // Upper Strength + Core (Day 1)
  "Pull-Up Max Reps": "STR",
  "Push-Up Max Reps": "STR",
  "DB Shoulder Press 8-rep Max": "STR",
  "Plank Max Hold": "CON",
  "Dead Hang": "STR",

  // Lower Strength (Day 2)
  "DB Bulgarian Split Squat 10-rep Max": "STR",
  "DB Romanian Deadlift 10-rep Max": "STR",
  "Walking Lunge Unbroken": "STR",
  "Farmer Carry Max Time": "STR",

  // Aerobic Engine (Day 3)
  "1.5 Mile Run": "END",
  "20 Min Bike Distance": "END",

  // Speed + Power (Day 4)
  "40-Yard Sprint": "END",
  "Vertical Jump": "STR",
  "Broad Jump": "STR",
  "5-10-5 Shuttle": "END",

  // Calisthenics Capacity + Endurance (Day 5)
  "Pull-Up Total Across 5 Sets": "STR",
  "Dip Max Reps": "STR",
  "2-Min Bodyweight Squat": "STR",
  "Wall Sit Max Hold": "STR",

  // Long Endurance Benchmark (Day 6)
  "60 Min Steady Effort Distance": "END",
  "20 Min Step-Up Reps": "END",

  // Mobility Assessment (Day 7)
  "Deep Squat Hold": "MOB",
  "Toe Touch Reach": "MOB",
  "Shoulder Flexion Overhead": "MOB",
} as const;

export const BASELINE_ATTRIBUTE_FALLBACK: AttributeId = "CON";

/** Return the attribute that a baseline log for the given testName should credit. */
export function baselineAttributeForTest(testName: string): AttributeId {
  return BASELINE_ATTRIBUTE_MAP[testName] ?? BASELINE_ATTRIBUTE_FALLBACK;
}
