// Client-safe barrel — types and the curated METRICS registry only.
// No Prisma, no Node.js built-ins; safe to import from "use client" components.
//
// goal-targets.ts re-exports everything here AND adds the async resolve
// helpers (which DO depend on Prisma). Server-only code imports from
// goal-targets.ts; client components import from this file.

import { z } from "zod";

export type Direction = "increase" | "decrease";

export type GoalTarget = {
  metric: string;
  label: string;
  units: string;
  direction: Direction;
  target: number;
  /** Optional starting value. Auto-captured at goal creation if absent. */
  start?: number;
  /** Importance weight (0-1). Goal-wide weights should sum to ~1. */
  weight: number;
  /** Optional rationale string for the user / Claude to read. */
  rationale?: string;
  /**
   * If true, while this target's progress < 1 (including untested),
   * the headline readiness score is capped at GATE_CEILING (80).
   * All gating targets cleared → ceiling lifts to 100.
   * Readiness-only concept; has no effect on rarity tier.
   */
  gating?: boolean;
  /**
   * When true, `log:*` entries are summed (increment-style) rather than
   * returning the latest value (snapshot). Use for metrics logged per-session
   * (e.g. practice_hours, books_read, miles_run). Default/absent = false =
   * snapshot. Only meaningful for `log:*` metrics; ignored for other families.
   */
  cumulative?: boolean;
};

export type MetricSpec = {
  id: string;
  label: string;
  units: string;
  direction: Direction;
  description: string;
};

/** Namespace prefix for metrics backed by LogEntry rows. */
export const LOG_METRIC_PREFIX = "log:" as const;

/**
 * Namespace prefix for metrics backed by workout history (getExerciseHistory).
 * Format: "exercise:<canonical exercise name>" — e.g. "exercise:Bench Press".
 * These are dynamic; individual exercise entries are NOT in METRICS (too numerous).
 * Resolution lives in goal-targets.ts (resolveMetricValue / resolveMetricStart)
 * and rarity.ts (observedSeriesFor). metricFamilyFor maps the prefix to "strength-like".
 */
export const EXERCISE_METRIC_PREFIX = "exercise:" as const;

/**
 * Zod schema for GoalTarget — mirrors the GoalTarget type exactly.
 * Client-safe (zod has no server-only deps). Do NOT import Prisma here.
 * REQ-63-3 adopts this in MCP tool input validation.
 */
export const GoalTargetSchema = z.object({
  metric: z.string().describe("Metric id (e.g. 'weightLb', 'baseline:Pull-Up Max Reps', 'exercise:Bench Press')"),
  label: z.string().describe("Human-readable label shown in the UI"),
  units: z.string().describe("Unit string (e.g. 'lb', 'reps', 'sec', 'ft')"),
  direction: z.enum(["increase", "decrease"]).describe("Whether a higher value is better (increase) or lower is better (decrease)"),
  target: z.number().describe("Numeric goal value"),
  start: z.number().optional().describe("Optional starting value auto-captured at goal creation"),
  weight: z.number().min(0).max(1).describe("Importance weight 0–1; all targets should sum to ~1"),
  rationale: z.string().optional().describe("Optional explanation for the user / coach"),
  gating: z.boolean().optional().describe(
    "Gate flag — while any gating target has progress < 1 (including untested), " +
    "the headline score is capped at 80. All gates cleared → ceiling 100. " +
    "Readiness-only concept; ignored by rarity tier.",
  ),
  cumulative: z.boolean().optional().describe(
    "When true, log: entries are summed (increment-style — expects one entry per " +
    "session/event, e.g. hours practiced, books read). The system sums all entries " +
    "up to the current date. Do NOT use for metrics logged as running totals " +
    "(e.g. MRR, body weight) — that overcounts. Default false = snapshot (latest entry).",
  ),
});

/** Curated registry — keeps the UI to known metrics and avoids typos. */
export const METRICS: MetricSpec[] = [
  {
    id: "weightLb",
    label: "Body weight",
    units: "lb",
    direction: "decrease",
    description: "Latest logged body weight from /measurements.",
  },
  {
    id: "baseline:1.5 Mile Run",
    label: "1.5-mile run time",
    units: "sec",
    direction: "decrease",
    description: "Latest baseline test result for the 1.5-mile run.",
  },
  {
    id: "baseline:20 Min Step-Up Reps",
    label: "20-min step-up reps",
    units: "reps",
    direction: "increase",
    description: "Top gym predictor for sustained climbing endurance.",
  },
  {
    id: "baseline:Deep Squat Hold",
    label: "Deep squat hold",
    units: "sec",
    direction: "increase",
    description: "Hip + ankle mobility benchmark — matters most on steep descents.",
  },
  {
    id: "baseline:Goblet Squat 10-rep Max",
    label: "Goblet squat 10-rep max",
    units: "lb",
    direction: "increase",
    description: "Leg strength under sustained load.",
  },
  {
    id: "baseline:Vertical Jump",
    label: "Vertical jump",
    units: "in",
    direction: "increase",
    description: "Lower-body power. Carries to snowboarding control.",
  },
  {
    id: "baseline:Pull-Up Max Reps",
    label: "Pull-up max reps",
    units: "reps",
    direction: "increase",
    description: "Relative upper-body strength.",
  },
  {
    id: "baseline:Plank Max Hold",
    label: "Plank max hold",
    units: "sec",
    direction: "increase",
    description: "Core endurance for pack stability.",
  },
  {
    id: "hike:prep_completion",
    label: "Prep hikes completed",
    units: "hikes",
    direction: "increase",
    description:
      "Number of completed Hike records since the goal start that approximate the goal's difficulty profile (distance ≥ 5 mi AND elevation ≥ 2000 ft).",
  },
  {
    id: "hike:max_elevation_single",
    label: "Max single-hike elevation gain",
    units: "ft",
    direction: "increase",
    description: "Largest elevation gain demonstrated in a single completed hike.",
  },
  {
    id: "hike:total_elevation_ft",
    label: "Cumulative hike elevation",
    units: "ft",
    direction: "increase",
    description: "Sum of elevation gain from all completed hikes since program start.",
  },
  {
    id: "hike:total_distance_mi",
    label: "Cumulative hike distance",
    units: "mi",
    direction: "increase",
    description: "Sum of distance from all completed hikes since program start.",
  },
  {
    id: "workout:count",
    label: "Workouts completed",
    units: "sessions",
    direction: "increase",
    description: "Total completed workouts since program start.",
  },
  {
    id: "log:mrr",
    label: "Monthly recurring revenue",
    units: "$",
    direction: "increase",
    description: "Latest MRR snapshot from a LogEntry.",
  },
  {
    id: "log:milestones_done",
    label: "Milestones completed",
    units: "milestones",
    direction: "increase",
    description: "Count of completed milestones, logged via log_metric.",
  },
];

export const METRIC_BY_ID = new Map(METRICS.map((m) => [m.id, m]));

// ─── Body-metric registry (REQ-002) ───────────────────────────────────────────
// Client-safe: no Prisma / Node imports. Imported by the log form, server
// actions, and MCP tools. Keep this block free of server-only deps.

export type BodyMetricSpec = {
  key: string;
  label: string;
  units: string;
  direction: Direction;
  description: string;
  normalRange?: { min?: number; max?: number };
};

/**
 * Hand-curated alias map: NORMALIZED loose key → canonical seed key.
 * Keys in this map are already run through the normalizer regex
 * (lowercase, [^a-z0-9]+ → _, trim leading/trailing _).
 * Canonical seed keys map to themselves so quick-picks always resolve correctly.
 * Mirrors EXERCISE_ALIAS_GROUPS: single source of truth, prevents series forks.
 *
 * Covers R-C1 aliases (blueprint):
 *   vo2max variants · spo2 / blood-oxygen variants · sleep_score / sleep · rhr variants
 */
export const BODY_METRIC_ALIASES: Record<string, string> = {
  // vo2max — canonical + loose forms (subscript ₂ normalizes to nothing → "vo_max")
  vo2max:   "vo2max",
  vo2_max:  "vo2max",
  vo_max:   "vo2max", // covers "VO₂ max" (Unicode subscript 2 is stripped)
  vo2:      "vo2max",
  // spo2 — canonical + common phrasings
  spo2:          "spo2",
  blood_oxygen:  "spo2",
  blood_o2:      "spo2",
  o2:            "spo2",
  oxygen:        "spo2",
  sp_o2:         "spo2",
  o2_sat:        "spo2",  // covers "o2 sat"
  sp02:          "spo2",  // common typo (zero not letter O)
  // sleep_score — canonical + bare "sleep"
  sleep_score:   "sleep_score",
  sleep:         "sleep_score",
  // rhr — canonical + full phrasings
  rhr:                  "rhr",
  resting_hr:           "rhr",
  resting_heart_rate:   "rhr",
  resting_heart:        "rhr",
  // hrv — canonical + full phrasings
  hrv:                      "hrv",
  heart_rate_variability:   "hrv",
  heart_variability:        "hrv",
};

/**
 * Normalize a raw metric key to a canonical snake_case form, resolving known
 * aliases to their seed key. Used at every write path (MCP tool, server action,
 * and any form's custom-key input) so all entries land on the same series.
 *
 * Step 1: lowercase → replace any run of non-[a-z0-9] chars with "_" → strip
 *         leading/trailing underscores  (handles Unicode subscripts, spaces,
 *         punctuation, mixed case, etc.).
 * Step 2: look up the loose key in BODY_METRIC_ALIASES; if found, return the
 *         canonical seed key; otherwise return the loose normalized key (ad-hoc).
 */
export function normalizeMetricKey(raw: string): string {
  const loose = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return BODY_METRIC_ALIASES[loose] ?? loose;
}

/** Curated body-metric seeds (NOT folded into METRICS — body metrics are not goal targets in v1). */
export const BODY_METRICS: BodyMetricSpec[] = [
  {
    key:         "rhr",
    label:       "Resting heart rate",
    units:       "bpm",
    direction:   "decrease",
    description: "Resting HR from a wearable.",
  },
  {
    key:         "sleep_score",
    label:       "Sleep score",
    units:       "pts",
    direction:   "increase",
    description: "Nightly sleep score.",
  },
  {
    key:         "spo2",
    label:       "Blood oxygen (SpO₂)",
    units:       "%",
    direction:   "increase",
    description: "Blood oxygen saturation.",
    normalRange: { min: 95, max: 100 },
  },
  {
    key:         "vo2max",
    label:       "VO₂ max",
    units:       "ml/kg/min",
    direction:   "increase",
    description: "Cardiorespiratory fitness estimate.",
  },
  {
    key:         "hrv",
    label:       "HRV",
    units:       "ms",
    direction:   "increase",
    description: "Heart-rate variability — recovery indicator from a wearable.",
  },
];

/** O(1) lookup map from canonical key → BodyMetricSpec. */
export const BODY_METRIC_BY_KEY = new Map(BODY_METRICS.map((m) => [m.key, m]));

/**
 * Convert a bare snake_case key to a human-readable label.
 * "grip_strength" → "Grip strength"
 */
export function humanizeMetricKey(key: string): string {
  return key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Resolve display metadata for a body-metric key.
 *
 * - Known keys: registry wins (label, units, direction, normalRange).
 * - Ad-hoc keys: humanized label, row unit (or ""), direction "increase" default.
 */
export function resolveBodyMetric(
  key: string,
  rowUnit?: string | null,
): { label: string; units: string; direction: Direction; normalRange?: { min?: number; max?: number } } {
  const spec = BODY_METRIC_BY_KEY.get(key);
  if (spec) {
    return {
      label:       spec.label,
      units:       spec.units,
      direction:   spec.direction,
      normalRange: spec.normalRange,
    };
  }
  return {
    label:     humanizeMetricKey(key),
    units:     rowUnit ?? "",
    direction: "increase",
  };
}

/**
 * Mt. Elbert via Black Cloud Trail — research-grounded default targets.
 *
 * Route stats: ~11 mi RT, ~5,200 ft gain, 14,440 ft summit, sustained Class 1+
 * climbing. Standard prep advice for similar 14ers (CMC, 14ers.com community,
 * AMC trail-running endurance research) emphasizes:
 *   1. Repeated exposure to long mountain efforts (most direct predictor)
 *   2. A confirmed single-day big-elevation effort before the attempt
 *   3. Cumulative weekly volume of climbing
 *
 * Gym tests are secondary signals — useful, but no number of step-ups
 * substitutes for actually climbing 4000+ ft on a Saturday.
 *
 * Total weight = 1.00.
 */
export const MT_ELBERT_DEFAULT_TARGETS: GoalTarget[] = [
  {
    metric: "hike:prep_completion",
    label: "Prep hikes completed (≥5 mi & ≥2000 ft)",
    units: "hikes",
    direction: "increase",
    target: 6,
    weight: 0.3,
    gating: true,
    rationale:
      "Most direct predictor. Six substantial Colorado hikes during a 12-week build (roughly one every other weekend) gives the body repeat exposure to sustained climbing, altitude, pacing, and terrain — none of which transfer perfectly from gym work.",
  },
  {
    metric: "hike:max_elevation_single",
    label: "Largest single hike (ft gained)",
    units: "ft",
    direction: "increase",
    target: 4000,
    weight: 0.2,
    gating: true,
    rationale:
      "Black Cloud Trail's 5,200 ft gain is unforgiving. Successfully completing a 4,000+ ft single-day effort first (e.g. Bierstadt + extension, Quandary, Massive) is the proof that the cardio-vascular and quad-eccentric demands are within reach.",
  },
  {
    metric: "hike:total_elevation_ft",
    label: "Cumulative hike elevation",
    units: "ft",
    direction: "increase",
    target: 25000,
    weight: 0.15,
    rationale:
      "~5× Elbert's elevation gain across the build. Ensures sufficient repeat exposure rather than a single hero hike.",
  },
  {
    metric: "baseline:20 Min Step-Up Reps",
    label: "20-min step-up reps",
    units: "reps",
    direction: "increase",
    target: 1000,
    weight: 0.1,
    rationale:
      "Best gym proxy for sustained climbing under fatigue. ~50 reps/min for 20 min is a strong indicator the legs can keep cadence on a 4-6 hour ascent.",
  },
  {
    metric: "baseline:1.5 Mile Run",
    label: "1.5-mile run",
    units: "sec",
    direction: "decrease",
    target: 660,
    weight: 0.1,
    rationale:
      "Sub-11:00 indicates VO2max headroom for the thin air at 12-14k ft. Not the bottleneck for trained hikers, but a useful aerobic-base sanity check.",
  },
  {
    metric: "baseline:Deep Squat Hold",
    label: "Deep squat hold",
    units: "sec",
    direction: "increase",
    target: 180,
    weight: 0.05,
    rationale:
      "Hip + ankle mobility — pays dividends on the 5,200 ft of *descent* (where most knee-pain stories begin). 3 minutes is comfortable; under 60 seconds suggests work to do.",
  },
  {
    metric: "baseline:Goblet Squat 10-rep Max",
    label: "Goblet squat 10-rep max",
    units: "lb",
    direction: "increase",
    target: 50,
    weight: 0.05,
    rationale:
      "Strength insurance against terrain that demands big steps + pack weight. Less critical than endurance metrics — capped at 5%.",
  },
  {
    metric: "weightLb",
    label: "Body weight",
    units: "lb",
    direction: "decrease",
    target: 155,
    weight: 0.05,
    rationale:
      "User's stated lean target. Marginal effect on uphill efficiency (every 5 lb saved ≈ 1-2 min/hour), but capped low because user already trains near goal weight.",
  },
];
