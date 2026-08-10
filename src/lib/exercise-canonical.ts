// Canonical exercise naming — extracted verbatim from src/lib/records.ts
// (#307 auto-link engine) so PURE consumers (src/lib/attribution.ts) can use
// the canonicalization without transitively importing Prisma via records.ts.
// records.ts re-exports both functions, so every existing import path
// (`@/lib/records`) still works and there is exactly ONE alias map.
//
// This module is pure and client-safe — no Prisma, no Node built-ins.
//
// One movement gets logged under several names — Strong-export spelling drift
// ("Pull Up" vs "Pull-Up"), and baseline tests mirror into workouts under their
// descriptive testName ("Plank Max Hold") rather than the working name
// ("Plank"). Equipment strings are just as inconsistent for one movement
// (null / "Bodyweight" / "Dumbbell"). Left unmerged, PR detection and the
// records summary fragment: a 64s working plank "beats" the 60s working best
// while the real 252s max sits in a separate "Plank Max Hold" bucket.
//
// Fix: group by canonical name ONLY — equipment is descriptive metadata, never
// a bucket key. The alias map is curated, not pattern-stripped: some baseline
// tests are a DIFFERENT metric ("Pull-Up Total Across 5 Sets" is a 5-set sum,
// "2-Min Bodyweight Squat" is a timed AMRAP) and must NOT fold into the
// movement, or they'd suppress real single-set PRs.
//
// canonical → every variant spelling that folds into it.
const EXERCISE_ALIAS_GROUPS: Record<string, string[]> = {
  "Pull-Up": ["Pull Up", "Pull-Up Max Reps"],
  "Push-Up": ["Push Up", "Push-Up Max Reps"],
  Dip: ["Chest Dip", "Dip (strict, unassisted)", "Dip Max Reps"],
  Plank: ["Plank Max Hold"],
  "Hollow Body Hold": ["Hollow Hold"],
  "DB Shoulder Press": ["Shoulder Press"],
  "Bent-Over One-Arm DB Row": ["Bent Over One Arm Row"],
  "Step-Up": ["Step-Ups"],
  "Stair Climber": ["CLMBR", "Climbr (Stair Climber)"],
};

// Normalized variant key → canonical. Each canonical also maps to itself so
// "Pull-Up" and "pull-up" both resolve.
const EXERCISE_ALIAS_INDEX = new Map<string, string>();
for (const [canonical, variants] of Object.entries(EXERCISE_ALIAS_GROUPS)) {
  EXERCISE_ALIAS_INDEX.set(canonical.trim().toLowerCase(), canonical);
  for (const v of variants) EXERCISE_ALIAS_INDEX.set(v.trim().toLowerCase(), canonical);
}

/**
 * Resolve a logged exercise name to its canonical movement name. Unmapped names
 * pass through trimmed (so they stay their own bucket). Case-insensitive.
 */
export function canonicalExerciseName(name: string): string {
  return EXERCISE_ALIAS_INDEX.get(name.trim().toLowerCase()) ?? name.trim();
}

/**
 * Return all known spelling variants for a canonical exercise name, including
 * the canonical name itself.  Used by goal-attribution.ts to build an IN-list
 * for the workoutExercise query.
 */
export function aliasVariantsFor(canonical: string): string[] {
  return [canonical, ...(EXERCISE_ALIAS_GROUPS[canonical] ?? [])];
}
