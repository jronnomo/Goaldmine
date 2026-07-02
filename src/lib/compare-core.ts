// src/lib/compare-core.ts
//
// Pure, client-safe core for the "Glance back, forge ahead" two-date snapshot
// comparison. ZERO imports from @/generated/prisma, @/lib/db, next/*, or any
// server-only module. Date helpers ONLY from @/lib/calendar-core (never
// @/lib/calendar — that pulls in Prisma via calendar.ts's server-only additions).
// This file is the frozen contract between Stream A (compare.ts) and Stream B
// (the /compare page + DeltaRow) — do not change these shapes without updating
// both consumers.

import { formatDuration } from "@/lib/formatters/types";
import { parseDateKey } from "@/lib/calendar-core";

// ─────────────────────────────────────────────────────────────────────────
// Direction
// ─────────────────────────────────────────────────────────────────────────

/**
 * Which direction counts as "better" for a compared metric.
 * Mirrors GoalTarget.direction ("increase"/"decrease") from
 * @/lib/metrics-registry, plus "neutral" for metrics with no goal-backed
 * judgment (e.g. body weight with no active weightLb target, or calories/
 * carbs/fat which are diet-phase-dependent and can't be judged "better").
 */
export type CompareDirection = "increase" | "decrease" | "neutral";

/**
 * Convert records.ts's MetricDirection ("higher"/"lower" — the PR-engine's
 * own vocabulary) to CompareDirection ("increase"/"decrease"). No existing
 * helper in the codebase performs this conversion (research-output.md,
 * Risks §2) — compare.ts must route every records.ts direction through this
 * before constructing a CompareEntry.
 */
export function directionForMetricKind(direction: "higher" | "lower"): CompareDirection {
  return direction === "higher" ? "increase" : "decrease";
}

// ─────────────────────────────────────────────────────────────────────────
// CompareEntry — one row: a single metric compared across two dates
// ─────────────────────────────────────────────────────────────────────────

export type CompareEntry = {
  /** Stable identity, e.g. "weightLb", "baseline:1.5 Mile Run",
   *  "exercise:Goblet Squat", "counter:workouts", "nutrition:protein",
   *  "target:hike:prep_completion", "readiness". Never displayed. */
  key: string;
  /** Human label, e.g. "Body weight", "1.5-Mile Run". */
  label: string;
  /** Unit string, e.g. "lb", "sec", "%", "reps", "kcal", "". Drives
   *  formatValue's $ / % special-casing (see formatValue below) and is
   *  available to callers that want to render a unit suffix themselves. */
  units: string;
  /** Raw value as of date A (latest-known ≤ end of day A). Null = no data
   *  yet at or before A. */
  valueA: number | null;
  /** Raw value as of date B (latest-known ≤ end of day B). */
  valueB: number | null;
  /** valueB - valueA. Null when either side is null. */
  delta: number | null;
  /** (delta / valueA) * 100. Null when valueA is null or exactly 0
   *  (avoids Infinity/NaN). */
  deltaPct: number | null;
  /** Which direction counts as "better" for this row. */
  direction: CompareDirection;
  /**
   * Whether B is an improvement over A, direction-aware.
   * DECISION TABLE:
   *   delta === null                       → null (nothing to judge)
   *   delta === 0                          → null (no change ≠ improved/regressed)
   *   direction === "neutral"              → null (no judgment asserted)
   *   direction === "increase" && delta > 0 → true
   *   direction === "increase" && delta < 0 → false
   *   direction === "decrease" && delta < 0 → true
   *   direction === "decrease" && delta > 0 → false
   */
  improved: boolean | null;
  /** Pre-formatted valueA via formatValue (never build your own string). */
  formattedA: string;
  /** Pre-formatted valueB via formatValue. */
  formattedB: string;
  /** Pre-formatted signed delta via formatDelta (never carries a unit
   *  symbol — see formatDelta doc). */
  formattedDelta: string;
  /** True when valueA is null AND valueB is not null — "new since then".
   *  Render as an accent pill with formattedA suppressed, per PRD §4.4d. */
  newSinceA: boolean;
};

/**
 * Build a fully-derived CompareEntry from two raw values. This is the ONLY
 * place delta/deltaPct/improved/formatted-fields/newSinceA logic may live —
 * compare.ts must never hand-roll these fields.
 */
export function buildEntry(input: {
  key: string;
  label: string;
  units: string;
  valueA: number | null;
  valueB: number | null;
  direction: CompareDirection;
}): CompareEntry {
  const { key, label, units, valueA, valueB, direction } = input;

  const delta = valueA !== null && valueB !== null ? valueB - valueA : null;
  // v3 Fix 3: use Math.abs(valueA) in the denominator so a negative valueA
  // does not invert the sign of deltaPct (e.g. valueA -50, valueB -25 →
  // delta +25, deltaPct +50 — an improvement, not "-50%").
  const deltaPct =
    delta !== null && valueA !== null && valueA !== 0 ? (delta / Math.abs(valueA)) * 100 : null;
  const newSinceA = valueA === null && valueB !== null;

  let improved: boolean | null = null;
  if (delta !== null && delta !== 0 && direction !== "neutral") {
    improved = direction === "increase" ? delta > 0 : delta < 0;
  }

  return {
    key,
    label,
    units,
    valueA,
    valueB,
    delta,
    deltaPct,
    direction,
    improved,
    formattedA: formatValue(valueA, units),
    formattedB: formatValue(valueB, units),
    formattedDelta: formatDelta(delta, units),
    newSinceA,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Formatting
// ─────────────────────────────────────────────────────────────────────────

/**
 * Format a single raw value for display.
 * DECISION TABLE:
 *   value === null       → "—"
 *   units === "sec"       → formatDuration(round(value))  (e.g. 778 → "12:58")
 *   Number.isInteger(v)   → v.toLocaleString("en-US")      (e.g. 1000 → "1,000")
 *   otherwise (has a fractional part) → v.toFixed(1)        (e.g. 168.2 → "168.2")
 *   units === "%"  → append "%" to the body above           (e.g. "74%")
 *   units === "$"  → prepend "$" to the body above           (e.g. "$180")
 * NOTE: only "%" and "$" get a symbol; "lb"/"reps"/"ft"/"mi"/"kcal"/"g" etc.
 * render as bare numbers — callers show units via the row label/context
 * (DeltaRow does not append them). This matches the PRD's ASCII mockup
 * exactly for readiness ("74%") and MRR ("$180") while keeping the sec/int/
 * float rule from PRD §4.4a literal. A value that happens to be a whole
 * number (e.g. weight logged as exactly 159) renders "159", not "159.0" —
 * the PRD's ASCII table showing "159.0" is illustrative, not a literal spec;
 * Number.isInteger is the actual, testable rule (see acceptance #10 + test
 * plan wording "formatValue (sec/lb/pct/null)").
 */
export function formatValue(value: number | null, units: string): string {
  if (value === null) return "—";
  if (units === "sec") return formatDuration(Math.round(value));
  const body = Number.isInteger(value) ? value.toLocaleString("en-US") : value.toFixed(1);
  if (units === "%") return `${body}%`;
  if (units === "$") return `$${body}`;
  return body;
}

/**
 * Format a signed delta for display. Never appends a unit symbol (matches
 * the PRD's ASCII mockup where every delta chip is a bare signed number,
 * e.g. "+52", "-9.2", "-1:52", "+180") — units are implied by the row label.
 *   delta === null → "—"
 *   delta === 0    → "0" (no sign)
 *   otherwise      → sign ("+"/"-") + formatValue(abs(delta), units) body
 *                    (sec still goes through formatDuration on the ABS value,
 *                    so a -112s delta renders "-1:52", not a negative duration
 *                    string, which formatDuration cannot produce).
 */
export function formatDelta(delta: number | null, units: string): string {
  if (delta === null) return "—";
  if (delta === 0) return "0";
  const sign = delta > 0 ? "+" : "-";
  const abs = Math.abs(delta);
  if (units === "sec") return `${sign}${formatDuration(Math.round(abs))}`;
  const body = Number.isInteger(abs) ? abs.toLocaleString("en-US") : abs.toFixed(1);
  return `${sign}${body}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Date normalization
// ─────────────────────────────────────────────────────────────────────────

export type NormalizedDateRange = {
  dateA: string; // yyyy-mm-dd, always <= dateB after normalization
  dateB: string;
  swapped: boolean; // true if the (post-clamp) inputs needed swapping
  sameDay: boolean; // dateA === dateB
  clampedToToday: boolean; // true if either input was > todayKey
  spanDays: number; // whole days between dateA and dateB (>= 0)
};

/**
 * Normalize two dateKeys (yyyy-mm-dd) into a canonical, ordered range.
 * Order of operations (both matter for correctness):
 *   1. Clamp each input down to todayKey if it's in the future
 *      (`clampedToToday` set if either was clamped).
 *   2. Swap so dateA <= dateB lexicographically (`swapped` set if a swap
 *      was needed AFTER clamping — clamping alone never counts as a swap).
 * dateKey strings compare correctly with plain `<`/`>` because they are
 * fixed-width yyyy-mm-dd (verified in research-output.md — safe without
 * parsing to Date).
 */
export function normalizeDateRange(a: string, b: string, todayKey: string): NormalizedDateRange {
  let clampedToToday = false;
  let ca = a;
  let cb = b;
  if (ca > todayKey) {
    ca = todayKey;
    clampedToToday = true;
  }
  if (cb > todayKey) {
    cb = todayKey;
    clampedToToday = true;
  }

  const swapped = cb < ca;
  const dateA = swapped ? cb : ca;
  const dateB = swapped ? ca : cb;

  return {
    dateA,
    dateB,
    swapped,
    sameDay: dateA === dateB,
    clampedToToday,
    spanDays: daysBetweenKeys(dateA, dateB),
  };
}

function daysBetweenKeys(aKey: string, bKey: string): number {
  const ms = parseDateKey(bKey).getTime() - parseDateKey(aKey).getTime();
  return Math.round(ms / 86_400_000);
}

// ─────────────────────────────────────────────────────────────────────────
// Section types (per PRD §4.4a)
// ─────────────────────────────────────────────────────────────────────────

export type GoalCompareSection = {
  goalId: string;
  objective: string;
  /** "fitness" | "project" — Goal.kind, verbatim, goal-generic (never
   *  hardcode Elbert; see memory "goal-progress-bars-are-goal-generic"). */
  kind: string;
  /** True when Goal.createdAt is after end-of-day A — the goal didn't exist
   *  yet on date A. A-side readiness is skipped entirely when true (perf +
   *  honesty; computeReadiness is called exactly once for this goal). */
  createdAfterA: boolean;
  /** Null when the goal has zero targets. Otherwise a CompareEntry with
   *  units "%": valueA is null when createdAfterA (never computed),
   *  valueB is always computed when targets.length > 0. */
  readiness: CompareEntry | null;
  /** One entry per GoalTarget, in Goal.targets order. Empty when the goal
   *  has no targets (readiness is also null in that case). */
  targets: CompareEntry[];
};

export type CountersSection = {
  /** Between-window (cutA, cutB] — strictly after A, up to and including B. */
  between: {
    workoutsCompleted: number;
    hikesCompleted: number;
    hikeElevationFt: number;
    hikeDistanceMi: number;
    baselineTestsLogged: number;
    notesLogged: number;
    xpEarned: number;
    /** Null when there is no active program (GameState.goalKind === null) —
     *  matches PRD §6 "No active program → levelChange: null". */
    levelA: number | null;
    levelB: number | null;
  };
  /** As-of cumulative pairs (workout count, total elevation, total distance),
   *  rendered as ordinary DeltaRow-style entries. */
  cumulative: CompareEntry[];
};

export type NutritionCompareSection = {
  windowDays: number; // 7
  daysLoggedA: number; // 0..7, logged days within the trailing window ending at A
  daysLoggedB: number; // 0..7
  /** calories, protein, carbs, fat — trailing-window daily average over
   *  logged days only (never divided by 7). Null side when daysLogged*** is 0. */
  entries: CompareEntry[];
};

export type ComparisonResult = {
  dateA: string;
  dateB: string;
  swapped: boolean;
  sameDay: boolean;
  clampedToToday: boolean;
  spanDays: number;
  /** ISO instant computeComparison ran — informational, not used for cache
   *  invalidation (the page is force-dynamic; MCP calls are always fresh). */
  generatedAt: string;
  /** False when NOTHING in the entire result has a non-null valueA (every
   *  family empty at A) — drives the hero "everything below is new since
   *  then" banner. See compare.ts's computeHasAnyDataA for the exact rule. */
  hasAnyDataA: boolean;
  goals: GoalCompareSection[];
  strength: CompareEntry[];
  baselines: CompareEntry[];
  body: CompareEntry[];
  counters: CountersSection;
  nutrition: NutritionCompareSection;
};
