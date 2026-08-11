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
  return rollingSessionMatch(exercises, exercise).attempts;
}

/**
 * Like rollingSessionAttempts, but distinguishes the two null cases:
 *  - `matched: false` — the workout contains no set of this exercise at all.
 *  - `matched: true, attempts: null` — the exercise WAS trained but every
 *    matching set is duration-less: NOT a session (rolling doctrine above),
 *    but exactly the row the untimed-session footnote counts (UXR-PROG-11/12
 *    — without it the user trained on Tuesday and Tuesday is invisible).
 * rollingSessionAttempts delegates here; its behavior is byte-identical.
 */
export function rollingSessionMatch(
  exercises: ReadonlyArray<RollingWorkoutExerciseLike>,
  exercise: string,
): { matched: boolean; attempts: number[] | null } {
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
  if (!matchedAnyExercise || attempts.length === 0) {
    return { matched: matchedAnyExercise, attempts: null };
  }
  return { matched: true, attempts };
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

// ── Seam Strip assembler exports (UXR-PROG-14, report §7 Stage 3) ───────────
// Pure + client-safe, like everything above. The strip is a RECORD GLYPH —
// ReachMeter's discrete-segment idiom rotated vertical (UXR-PROG-70) — and
// these two functions are its entire data source.

/** Workout row shape the slot assembler needs — the resolver's select plus
 *  id + startedAt (UXR-PROG-15). */
export type RollingWorkoutSlotSource = RollingWorkoutLike & { id: string; startedAt: Date };

export type RollingSlot = {
  /** Workout.id — React key + optional /workouts/[id] href (UXR-PV-14: if a
   *  slot must ever be tappable, the whole <li> becomes the Link). */
  id: string;
  startedAt: Date;
  /** Non-null durationSec attempts in (exercise.orderIndex, set.setIndex) order. */
  attempts: number[];
  /** Attempts ≥ params.minSeconds (the params passed to the assembler). */
  qualifyingCount: number;
  /** isRollingHitSession(attempts, params). */
  hit: boolean;
};

/**
 * The trailing window as SLOTS (newest-first, length ≤ window).
 * `slots.length < window` is the UXR-TIA-49 partial-window signal — copy must
 * read "N of {slots.length} so far", never "N of {window}".
 * `value` is byte-identical to computeRollingValueFromWorkouts(workouts,
 * params) — that equivalence is the whole safety argument (UXR-PROG-14) and
 * is pinned by a regression test.
 */
export function rollingWindowSlots(
  workoutsNewestFirst: ReadonlyArray<RollingWorkoutSlotSource>,
  params: RollingParams,
): { slots: RollingSlot[]; value: number | null; window: number } {
  const window = params.window ?? ROLLING_DEFAULT_WINDOW;
  const slots: RollingSlot[] = [];
  for (const w of workoutsNewestFirst) {
    const attempts = rollingSessionAttempts(w.exercises, params.exercise);
    if (attempts === null) continue;
    slots.push({
      id: w.id,
      startedAt: w.startedAt,
      attempts,
      qualifyingCount: attempts.filter((d) => d >= params.minSeconds).length,
      hit: isRollingHitSession(attempts, params),
    });
    if (slots.length >= window) break;
  }
  const value = slots.length === 0 ? null : slots.filter((s) => s.hit).length;
  return { slots, value, window };
}

/**
 * The nested-tier skyline: ONE session universe read against N thresholds
 * (report F-B — session membership is threshold-independent, so all tracks
 * over the same canonical exercise + window share byte-identical slots).
 *
 * GUARD: tracks are merged ONLY when their canonicalized `exercise` AND
 * effective `window` match the strip's — mismatched tracks are dropped here
 * (defensive; the caller should group them into separate strips instead).
 *
 * `sessions` slot fields (qualifyingCount / hit) are evaluated against
 * `tracks[0]`; renderers derive per-track column rungs from `attempts` via
 * isRollingHitSession — pure, no re-query.
 *
 * `untimedSessionCount` (UXR-PROG-11, ⚑ resolved: assembler-specced): count
 * of workouts that MATCHED the exercise but logged no timed set, ranged from
 * the OLDEST slot's startedAt through asOf inclusive (the scan's own upper
 * edge). With zero slots the range is the whole scan — an untimed-only
 * logger's Tuesday must not stay invisible on day 1.
 */
export function rollingMatrix(
  workouts: ReadonlyArray<RollingWorkoutSlotSource>,
  exercise: string,
  window: number,
  tracks: RollingParams[],
): {
  sessions: RollingSlot[];
  rows: { params: RollingParams; hits: number | null }[];
  untimedSessionCount: number;
} {
  const canonical = canonicalExerciseName(exercise);
  const merged = tracks.filter(
    (t) =>
      canonicalExerciseName(t.exercise) === canonical &&
      (t.window ?? ROLLING_DEFAULT_WINDOW) === window,
  );

  // One pass: collect the trailing-window session slots (threshold-independent
  // universe) and, in the same order, the matched-but-untimed workouts.
  const sessions: RollingSlot[] = [];
  const untimed: Date[] = [];
  const anchor = merged[0];
  for (const w of workouts) {
    const m = rollingSessionMatch(w.exercises, exercise);
    if (m.attempts !== null) {
      if (sessions.length < window) {
        sessions.push({
          id: w.id,
          startedAt: w.startedAt,
          attempts: m.attempts,
          qualifyingCount: anchor
            ? m.attempts.filter((d) => d >= anchor.minSeconds).length
            : m.attempts.length,
          hit: anchor ? isRollingHitSession(m.attempts, anchor) : false,
        });
      }
      // Past the window we only keep scanning for nothing — the untimed range
      // never reaches older than the oldest slot, and slots are full.
      if (sessions.length >= window) {
        // Range floor is known; anything older cannot affect the footnote.
        // (Untimed rows already collected may still be older — filtered below.)
        break;
      }
      continue;
    }
    if (m.matched) untimed.push(w.startedAt);
  }

  const oldestSlotAt = sessions.at(-1)?.startedAt ?? null;
  const untimedSessionCount =
    oldestSlotAt === null
      ? untimed.length
      : untimed.filter((d) => d.getTime() >= oldestSlotAt.getTime()).length;

  const attemptSeqs = sessions.map((s) => s.attempts);
  const rows = merged.map((params) => ({
    params,
    hits: sessions.length === 0 ? null : computeRollingHits(attemptSeqs, params),
  }));

  return { sessions, rows, untimedSessionCount };
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
