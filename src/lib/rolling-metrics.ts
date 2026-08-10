// src/lib/rolling-metrics.ts
//
// Pure window math for the `rolling:*` metric family — engine-computed
// session-consistency trackers ("≥20s hold hit in 4 of the last 6 sessions",
// "3× ≥20s within ≤5 attempts in one session, in ≥1 of the last 6").
//
// PURE + CLIENT-SAFE: no Prisma, no Node built-ins. goal-targets.ts (server)
// fetches the workout rows and calls into here; readiness.ts is untouched —
// rolling values flow through computeReadiness as plain numerics. Keeping the
// math here (not in goal-targets.ts) makes every doctrine decision unit-
// testable without a DB, and keeps historisation trivially correct: the value
// at any asOf is a pure function of the workouts at or before that cutoff.
//
// ── Qualifying-session doctrine (docs/project-gotchas.md §F.8) ──────────────
// A SESSION is a completed workout containing ≥1 set of the tracker's
// exercise (canonicalExerciseName both sides — the same hand-curated alias
// map as PRs/records) with a non-null durationSec. One workout = one session.
// The coach controls the denominator by what gets logged under that canonical
// name in a completed workout; incidental holds (warmups, a wall hold between
// sets of something else) must NOT be logged as that exercise. The engine
// does pure arithmetic — it cannot tell a dedicated skill block from noise.
//
// An ATTEMPT is a set of the matching exercise WITH a non-null durationSec,
// in (exercise orderIndex, setIndex) order. Duration-less sets under the same
// name (rep-typed rows, structural artifacts) are not hold attempts: they
// neither qualify nor occupy a slot in the attemptCap span. A workout whose
// matching sets are ALL duration-less is not a session at all.

import {
  ROLLING_DEFAULT_HITS_PER_SESSION,
  ROLLING_DEFAULT_WINDOW,
  ROLLING_METRIC_PREFIX,
  type GoalTarget,
  type RollingParams,
} from "@/lib/metrics-registry";
import { canonicalExerciseName } from "@/lib/exercise-canonical";

/** Minimal exercise shape the session extractor needs — matches the
 *  select shape goal-targets.ts fetches (name + sets ordered by setIndex). */
export type RollingWorkoutExerciseLike = {
  name: string;
  sets: ReadonlyArray<{ durationSec: number | null }>;
};

/** Minimal workout shape for the end-to-end helper (exercises ordered by orderIndex). */
export type RollingWorkoutLike = {
  exercises: ReadonlyArray<RollingWorkoutExerciseLike>;
};

/**
 * Extract one workout's attempt sequence for `exercise`, or null when the
 * workout is NOT a qualifying session (no matching-exercise set with a
 * non-null durationSec).
 *
 * - Matching is canonicalExerciseName on BOTH sides — alias variants
 *   ("Plank Max Hold" → "Plank") fold together exactly as records/PRs do.
 *   Unmapped spellings only match exactly (trimmed) until curated into
 *   EXERCISE_ALIAS_GROUPS — same fragmentation rule as everywhere else.
 * - Multiple matching exercises in one workout merge into ONE attempt
 *   sequence in the given array order. Callers must pass exercises ordered
 *   by orderIndex with sets ordered by setIndex (the resolver's query does),
 *   so the merged order is (exercise orderIndex, setIndex).
 * - Duration-less sets are dropped: not attempts, no attemptCap slot.
 */
export function rollingSessionAttempts(
  exercises: ReadonlyArray<RollingWorkoutExerciseLike>,
  exercise: string,
): number[] | null {
  const canonical = canonicalExerciseName(exercise);
  const attempts: number[] = [];
  let matchedAnyExercise = false;
  for (const ex of exercises) {
    if (canonicalExerciseName(ex.name) !== canonical) continue;
    matchedAnyExercise = true;
    for (const s of ex.sets) {
      if (s.durationSec !== null) attempts.push(s.durationSec);
    }
  }
  if (!matchedAnyExercise || attempts.length === 0) return null;
  return attempts;
}

/**
 * Hit test for a single session's attempt sequence (non-null durations, in
 * (exercise orderIndex, setIndex) order — see rollingSessionAttempts).
 *
 * - qualifying hold: durationSec ≥ minSeconds (inclusive — exactly-threshold counts).
 * - no attemptCap → hit iff count(qualifying) ≥ hitsPerSession (default 1).
 * - with attemptCap → hit iff SOME consecutive span of ≤ attemptCap attempts
 *   contains ≥ hitsPerSession qualifying holds. Non-qualifying attempts DO
 *   occupy span slots — that is the cap's whole point. A span of exactly
 *   attemptCap attempts passes (≤ is inclusive).
 *
 * An attemptCap smaller than hitsPerSession can never pass — the schema
 * refinement rejects that config at write time; the arithmetic here simply
 * returns false for defensively-read legacy JSON.
 */
export function isRollingHitSession(
  attempts: ReadonlyArray<number>,
  params: RollingParams,
): boolean {
  const hitsNeeded = params.hitsPerSession ?? ROLLING_DEFAULT_HITS_PER_SESSION;
  const qualifies = (d: number) => d >= params.minSeconds;

  if (params.attemptCap === undefined) {
    let count = 0;
    for (const d of attempts) {
      if (qualifies(d)) count++;
      if (count >= hitsNeeded) return true;
    }
    return false;
  }

  // Sliding window of size attemptCap over the attempt sequence. Qualifying
  // counts are monotone in span length, so checking spans of exactly
  // min(attemptCap, attempts.length) covers every span of ≤ attemptCap.
  const cap = params.attemptCap;
  const windowSize = Math.min(cap, attempts.length);
  let inWindow = 0;
  for (let i = 0; i < attempts.length; i++) {
    if (qualifies(attempts[i]!)) inWindow++;
    if (i >= windowSize && qualifies(attempts[i - windowSize]!)) inWindow--;
    if (inWindow >= hitsNeeded) return true;
  }
  return false;
}

/**
 * The rolling tracker's VALUE: number of hit-sessions within the trailing
 * `window` (default 6) qualifying sessions.
 *
 * - `sessionsNewestFirst` = attempt sequences of qualifying sessions, ordered
 *   newest-first as of the cutoff (the resolver orders workouts by
 *   startedAt DESC). The first `window` entries ARE the trailing window.
 * - ZERO sessions ever → null (untested — coverage shows the gap honestly;
 *   a numeric 0 would claim "tested and failing" before the skill was ever
 *   attempted). ≥1 session → numeric 0..window.
 * - Regression is inherent: as new sessions enter the window, old
 *   hit-sessions roll out and the value can DROP. That is the point — this
 *   is a consistency measure, not a trophy case.
 */
export function computeRollingHits(
  sessionsNewestFirst: ReadonlyArray<ReadonlyArray<number>>,
  params: RollingParams,
): number | null {
  if (sessionsNewestFirst.length === 0) return null;
  const window = params.window ?? ROLLING_DEFAULT_WINDOW;
  let hits = 0;
  for (const attempts of sessionsNewestFirst.slice(0, window)) {
    if (isRollingHitSession(attempts, params)) hits++;
  }
  return hits;
}

/**
 * End-to-end pure computation from workout rows (newest-first, exercises
 * ordered by orderIndex, sets by setIndex): extract qualifying sessions,
 * then count hit-sessions in the trailing window. This is the exact function
 * the resolver calls — historisation at any asOf is this applied to the
 * workouts at or before that cutoff.
 */
export function computeRollingValueFromWorkouts(
  workoutsNewestFirst: ReadonlyArray<RollingWorkoutLike>,
  params: RollingParams,
): number | null {
  const sessions: number[][] = [];
  const window = params.window ?? ROLLING_DEFAULT_WINDOW;
  for (const w of workoutsNewestFirst) {
    const attempts = rollingSessionAttempts(w.exercises, params.exercise);
    if (attempts !== null) {
      sessions.push(attempts);
      // The value only depends on the trailing `window` sessions — stop
      // extracting once we have them (workouts arrive newest-first).
      if (sessions.length >= window) break;
    }
  }
  return computeRollingHits(sessions, params);
}

/**
 * Tolerant reader: pull the RollingParams for `metric` out of a goal's stored
 * targets JSON (shape-guarded, never throws — mirrors rarity.ts parseTargets'
 * tolerance). Returns null when the target or its params are absent/malformed
 * — the resolver then reports null (untested) rather than guessing.
 * Validated writes make params-less rolling targets unrepresentable
 * (GoalTargetSchema refinement); this guard covers legacy/hand-written JSON.
 * Duplicate metric keys: first valid entry wins.
 */
export function rollingParamsFromTargets(
  targetsJson: unknown,
  metric: string,
): RollingParams | null {
  if (!Array.isArray(targetsJson)) return null;
  for (const t of targetsJson) {
    if (t === null || typeof t !== "object") continue;
    const candidate = t as { metric?: unknown; rolling?: unknown };
    if (candidate.metric !== metric) continue;
    const r = candidate.rolling;
    if (r === null || typeof r !== "object") continue;
    const p = r as Record<string, unknown>;
    if (typeof p.exercise !== "string" || p.exercise.length === 0) continue;
    if (typeof p.minSeconds !== "number" || !(p.minSeconds > 0)) continue;
    if (p.hitsPerSession !== undefined && typeof p.hitsPerSession !== "number") continue;
    if (p.attemptCap !== undefined && typeof p.attemptCap !== "number") continue;
    if (p.window !== undefined && typeof p.window !== "number") continue;
    return {
      exercise: p.exercise,
      minSeconds: p.minSeconds,
      hitsPerSession: p.hitsPerSession as number | undefined,
      attemptCap: p.attemptCap as number | undefined,
      window: p.window as number | undefined,
    };
  }
  return null;
}

/**
 * Write-path normalization: canonicalize each rolling target's
 * params.exercise (canonicalExerciseName — the attributionHints precedent in
 * goal-core.ts). Non-rolling targets pass through untouched; returns fresh
 * objects, never mutates input. The resolver canonicalizes both sides at
 * read time too, so this is storage hygiene, not a correctness dependency.
 */
export function canonicalizeRollingTargets(targets: GoalTarget[]): GoalTarget[] {
  return targets.map((t) => {
    if (!t.metric.startsWith(ROLLING_METRIC_PREFIX) || t.rolling === undefined) return t;
    return { ...t, rolling: { ...t.rolling, exercise: canonicalExerciseName(t.rolling.exercise) } };
  });
}
