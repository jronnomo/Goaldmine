// src/lib/rolling-goal-targets.test.ts
//
// Resolver tests for the rolling:* family (goal-targets.ts) via the
// mocked-db convention (mirrors cumulative-goal-targets.test.ts /
// goal-targets.test.ts), plus gate interaction THROUGH the real
// computeReadiness with rolling fixtures (readiness.ts untouched by the
// feature — these tests prove rolling values flow through as plain numerics).
//
// The db mock deliberately splits `prisma` (raw singleton) from the object
// `getDb()` resolves so scoped-client usage is a hard assertion, not a
// convention: the rolling resolver must run Workout/Goal queries through the
// tenant-scoped client ONLY (Workout is a scoped model; WorkoutExercise/Set
// ride along as non-scoped children of the scoped parent query).

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GoalTarget } from "@/lib/metrics-registry";

// ── Mocks (hoisted by Vitest) ────────────────────────────────────────────────

const { scopedDb, rawPrisma } = vi.hoisted(() => {
  const scopedDb = {
    goal: { findUnique: vi.fn() },
    workout: { findMany: vi.fn(), count: vi.fn() },
    hike: { count: vi.fn(), findFirst: vi.fn() },
    measurement: { findFirst: vi.fn() },
    baseline: { findFirst: vi.fn() },
    logEntry: { aggregate: vi.fn(), findFirst: vi.fn() },
  };
  // The raw singleton — the rolling resolver must NEVER touch it.
  const rawPrisma = {
    goal: { findUnique: vi.fn() },
    workout: { findMany: vi.fn() },
    workoutExercise: { findMany: vi.fn() },
  };
  return { scopedDb, rawPrisma };
});

vi.mock("@/lib/db", () => ({
  prisma: rawPrisma,
  getDb: vi.fn().mockResolvedValue(scopedDb),
}));

vi.mock("@/lib/records", () => ({
  getExerciseHistory: vi.fn().mockResolvedValue({ history: [] }),
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { resolveMetricValue, resolveMetricStart } from "@/lib/goal-targets";
import { computeReadiness, GATE_CEILING } from "@/lib/readiness";
import { endOfDay } from "@/lib/calendar-core";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const GOAL_ID = "goal-rolling-test";
const HS = "Freestanding Handstand Hold";

/** Mid-day instant (deliberately not midnight/end-of-day) — the resolver must
 *  cut off at endOfDay(asOf), mirroring the day-granularity invariant pinned
 *  in goal-targets.test.ts. */
const MID_DAY_ASOF = new Date("2026-07-09T14:30:00-06:00");

type FixtureWorkout = {
  id: string;
  startedAt: Date;
  status: string;
  exercises: { name: string; sets: { durationSec: number | null }[] }[];
};

const hsWorkout = (
  id: string,
  startedAt: string,
  durations: (number | null)[],
  status = "completed",
): FixtureWorkout => ({
  id,
  startedAt: new Date(startedAt),
  status,
  exercises: [{ name: HS, sets: durations.map((d) => ({ durationSec: d })) }],
});

/** Install a findMany mock that behaves like the real query: filters by the
 *  where clause's status + startedAt cutoff, orders startedAt DESC (id DESC
 *  tiebreak), and returns only the selected shape. This is what makes the
 *  three-asOf historisation test a REAL cutoff test rather than a stub echo. */
function installWorkoutFixtures(rows: FixtureWorkout[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scopedDb.workout.findMany.mockImplementation(async (args: any) => {
    const lte: Date = args.where.startedAt.lte;
    const status: string = args.where.status;
    return rows
      .filter((w) => w.status === status && w.startedAt.getTime() <= lte.getTime())
      .sort(
        (a, b) =>
          b.startedAt.getTime() - a.startedAt.getTime() || b.id.localeCompare(a.id),
      )
      .map((w) => ({ exercises: w.exercises }));
  });
}

/** A rolling target: ≥20s hold hit in the trailing 3 sessions (small window
 *  keeps the regression arithmetic readable). */
const HS_TARGET: GoalTarget = {
  metric: "rolling:hs_20s_of3",
  label: "≥20s hold — sessions hit, last 3",
  units: "of 3",
  direction: "increase",
  target: 2,
  weight: 1,
  rolling: { exercise: HS, minSeconds: 20, window: 3 },
};

function installGoalTargets(targets: GoalTarget[]) {
  scopedDb.goal.findUnique.mockResolvedValue({ targets });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── resolveMetricValue — rolling branch ──────────────────────────────────────

describe("resolveMetricValue — rolling:* resolver", () => {
  it("computes hit-sessions in the trailing window from completed-workout sets", async () => {
    installGoalTargets([HS_TARGET]);
    installWorkoutFixtures([
      hsWorkout("w1", "2026-07-01T16:00:00Z", [25]), // hit
      hsWorkout("w2", "2026-07-03T16:00:00Z", [5, 22]), // hit (2nd attempt)
      hsWorkout("w3", "2026-07-05T16:00:00Z", [10]), // miss
    ]);

    const result = await resolveMetricValue("rolling:hs_20s_of3", MID_DAY_ASOF, GOAL_ID, false);
    expect(result).toBe(2);
  });

  it("queries ONLY through the scoped client — raw prisma singleton untouched", async () => {
    installGoalTargets([HS_TARGET]);
    installWorkoutFixtures([hsWorkout("w1", "2026-07-01T16:00:00Z", [25])]);

    await resolveMetricValue("rolling:hs_20s_of3", MID_DAY_ASOF, GOAL_ID, false);

    expect(scopedDb.workout.findMany).toHaveBeenCalledTimes(1);
    expect(scopedDb.goal.findUnique).toHaveBeenCalledTimes(1);
    expect(rawPrisma.workout.findMany).not.toHaveBeenCalled();
    expect(rawPrisma.workoutExercise.findMany).not.toHaveBeenCalled();
    expect(rawPrisma.goal.findUnique).not.toHaveBeenCalled();
  });

  it("query shape: completed-only, endOfDay(asOf) cutoff, DESC ordering with id tiebreak, ordered children", async () => {
    installGoalTargets([HS_TARGET]);
    installWorkoutFixtures([]);

    await resolveMetricValue("rolling:hs_20s_of3", MID_DAY_ASOF, GOAL_ID, false);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call = scopedDb.workout.findMany.mock.calls[0]![0] as any;
    // Skipped/planned workouts are excluded by the WHERE itself.
    expect(call.where.status).toBe("completed");
    // Day-granularity invariant: cutoff is endOfDay(asOf), not the raw instant.
    expect((call.where.startedAt.lte as Date).getTime()).toBe(endOfDay(MID_DAY_ASOF).getTime());
    expect((call.where.startedAt.lte as Date).getTime()).not.toBe(MID_DAY_ASOF.getTime());
    // Deterministic trailing window: startedAt DESC with id DESC tiebreak.
    expect(call.orderBy).toEqual([{ startedAt: "desc" }, { id: "desc" }]);
    // Attempt order doctrine: exercises by orderIndex, sets by setIndex.
    expect(call.select.exercises.orderBy).toEqual({ orderIndex: "asc" });
    expect(call.select.exercises.select.sets.orderBy).toEqual({ setIndex: "asc" });

    // Params come from the goal's own stored targets.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const goalCall = scopedDb.goal.findUnique.mock.calls[0]![0] as any;
    expect(goalCall.where).toEqual({ id: GOAL_ID });
    expect(goalCall.select).toEqual({ targets: true });
  });

  it("planned/skipped workouts never enter the session universe (status filter honored)", async () => {
    installGoalTargets([HS_TARGET]);
    installWorkoutFixtures([
      hsWorkout("w1", "2026-07-01T16:00:00Z", [25]), // completed hit
      hsWorkout("w2", "2026-07-03T16:00:00Z", [30], "planned"), // would be a hit — excluded
      hsWorkout("w3", "2026-07-05T16:00:00Z", [40], "skipped"), // would be a hit — excluded
    ]);

    const result = await resolveMetricValue("rolling:hs_20s_of3", MID_DAY_ASOF, GOAL_ID, false);
    expect(result).toBe(1);
  });

  it("historisation: same data, three asOf cutoffs, three values INCLUDING a regression (1 → 2 → 0)", async () => {
    installGoalTargets([HS_TARGET]);
    installWorkoutFixtures([
      hsWorkout("w1", "2026-07-01T16:00:00Z", [25]), // hit
      hsWorkout("w2", "2026-07-03T16:00:00Z", [22]), // hit
      hsWorkout("w3", "2026-07-05T16:00:00Z", [10]), // miss
      hsWorkout("w4", "2026-07-07T16:00:00Z", [12]), // miss
      hsWorkout("w5", "2026-07-09T16:00:00Z", [8]), // miss
    ]);

    const atA = await resolveMetricValue(
      "rolling:hs_20s_of3",
      new Date("2026-07-01T14:30:00-06:00"),
      GOAL_ID,
      false,
    );
    const atB = await resolveMetricValue(
      "rolling:hs_20s_of3",
      new Date("2026-07-03T14:30:00-06:00"),
      GOAL_ID,
      false,
    );
    const atC = await resolveMetricValue(
      "rolling:hs_20s_of3",
      new Date("2026-07-09T14:30:00-06:00"),
      GOAL_ID,
      false,
    );

    expect(atA).toBe(1); // only w1 exists → 1 hit of 1 session
    expect(atB).toBe(2); // w1+w2 → 2 hits
    expect(atC).toBe(0); // window 3 = w5,w4,w3 — both hits rolled out
  });

  it("canonical alias matching, stored→logged: params 'Plank' counts sets logged as 'Plank Max Hold'", async () => {
    const plankTarget: GoalTarget = {
      ...HS_TARGET,
      metric: "rolling:plank_90s_of3",
      rolling: { exercise: "Plank", minSeconds: 90, window: 3 },
    };
    installGoalTargets([plankTarget]);
    installWorkoutFixtures([
      {
        id: "w1",
        startedAt: new Date("2026-07-01T16:00:00Z"),
        status: "completed",
        exercises: [{ name: "Plank Max Hold", sets: [{ durationSec: 120 }] }],
      },
    ]);

    const result = await resolveMetricValue("rolling:plank_90s_of3", MID_DAY_ASOF, GOAL_ID, false);
    expect(result).toBe(1);
  });

  it("canonical alias matching, logged→stored: UNCANONICALIZED stored params ('Plank Max Hold') still match 'Plank' sets", async () => {
    // Legacy/hand-written JSON that skipped write-canonicalization: read-side
    // canonicalizes BOTH sides, so it still resolves.
    const plankTarget: GoalTarget = {
      ...HS_TARGET,
      metric: "rolling:plank_90s_of3",
      rolling: { exercise: "Plank Max Hold", minSeconds: 90, window: 3 },
    };
    installGoalTargets([plankTarget]);
    installWorkoutFixtures([
      {
        id: "w1",
        startedAt: new Date("2026-07-01T16:00:00Z"),
        status: "completed",
        exercises: [{ name: "Plank", sets: [{ durationSec: 100 }] }],
      },
    ]);

    const result = await resolveMetricValue("rolling:plank_90s_of3", MID_DAY_ASOF, GOAL_ID, false);
    expect(result).toBe(1);
  });

  it("zero sessions ever → null (untested), even when unrelated workouts exist", async () => {
    installGoalTargets([HS_TARGET]);
    installWorkoutFixtures([
      {
        id: "w1",
        startedAt: new Date("2026-07-01T16:00:00Z"),
        status: "completed",
        exercises: [{ name: "Bench Press", sets: [{ durationSec: null }] }],
      },
    ]);

    const result = await resolveMetricValue("rolling:hs_20s_of3", MID_DAY_ASOF, GOAL_ID, false);
    expect(result).toBeNull();
  });

  it("goal has no rolling params for the metric (legacy JSON) → null, never a guess", async () => {
    installGoalTargets([{ ...HS_TARGET, rolling: undefined }]);
    installWorkoutFixtures([hsWorkout("w1", "2026-07-01T16:00:00Z", [25])]);

    const result = await resolveMetricValue("rolling:hs_20s_of3", MID_DAY_ASOF, GOAL_ID, false);
    expect(result).toBeNull();
  });

  it("goal row not found → null", async () => {
    scopedDb.goal.findUnique.mockResolvedValue(null);
    installWorkoutFixtures([hsWorkout("w1", "2026-07-01T16:00:00Z", [25])]);

    const result = await resolveMetricValue("rolling:hs_20s_of3", MID_DAY_ASOF, GOAL_ID, false);
    expect(result).toBeNull();
  });
});

// ── resolveMetricStart — rolling floor doctrine ──────────────────────────────

describe("resolveMetricStart — rolling:* auto-capture", () => {
  it("returns 0 — NEVER the current value, never an earliest-row lookup (no queries at all)", async () => {
    const result = await resolveMetricStart("rolling:hs_20s_of3", GOAL_ID, false);

    expect(result).toBe(0);
    expect(scopedDb.goal.findUnique).not.toHaveBeenCalled();
    expect(scopedDb.workout.findMany).not.toHaveBeenCalled();
  });
});

// ── computeReadiness — rolling gate interaction (readiness.ts untouched) ─────

describe("computeReadiness — rolling gating target through the real engine", () => {
  /** Gate: triple-style bar at 4-of-6 (partial in fixtures). */
  const GATE_TARGET: GoalTarget = {
    metric: "rolling:hs_20s_of6",
    label: "≥20s hold — sessions hit, last 6",
    units: "of 6",
    direction: "increase",
    target: 4,
    weight: 0.2,
    gating: true,
    rolling: { exercise: HS, minSeconds: 20 }, // defaults: hits 1, window 6
  };
  /** Non-gating companion resolved from the same workout fixtures via alias. */
  const PLANK_TARGET: GoalTarget = {
    metric: "rolling:plank_60s_of6",
    label: "60s plank — hit in last 6",
    units: "of 6",
    direction: "increase",
    target: 1,
    weight: 0.8,
    rolling: { exercise: "Plank", minSeconds: 60 },
  };

  const WORKOUTS: FixtureWorkout[] = [
    {
      id: "wa",
      startedAt: new Date("2026-07-05T16:00:00Z"),
      status: "completed",
      exercises: [
        { name: HS, sets: [{ durationSec: 25 }] }, // hs hit
        { name: "Plank Max Hold", sets: [{ durationSec: 90 }] }, // plank hit via alias
      ],
    },
    hsWorkout("wb", "2026-07-03T16:00:00Z", [22]), // hs hit
    hsWorkout("wc", "2026-07-01T16:00:00Z", [5]), // hs miss
  ];

  it("open rolling gate (progress < 1) caps the ceiling at 80 even when rawScore is higher", async () => {
    installGoalTargets([GATE_TARGET, PLANK_TARGET]);
    installWorkoutFixtures(WORKOUTS);

    const snap = await computeReadiness([GATE_TARGET, PLANK_TARGET], MID_DAY_ASOF, GOAL_ID);

    // Gate: 2 hit-sessions of target 4, auto-start 0 → progress 0.5 (plain
    // comparative numeric — no special-casing in readiness.ts).
    const gateRow = snap.breakdown.find((b) => b.target.metric === GATE_TARGET.metric)!;
    expect(gateRow.current).toBe(2);
    expect(gateRow.start).toBe(0);
    expect(gateRow.progress).toBeCloseTo(0.5);

    // Companion: plank hit in window → met.
    const plankRow = snap.breakdown.find((b) => b.target.metric === PLANK_TARGET.metric)!;
    expect(plankRow.current).toBe(1);
    expect(plankRow.progress).toBe(1);

    // rawScore 0.2*0.5 + 0.8*1 = 0.9 → 90; open gate → capped at 80.
    expect(snap.rawScore).toBe(90);
    expect(snap.ceiling).toBe(GATE_CEILING);
    expect(snap.openGateCount).toBe(1);
    expect(snap.gates.find((g) => g.label === GATE_TARGET.label)!.cleared).toBe(false);
    expect(snap.score).toBe(80);
  });

  it("rolling gate cleared (current ≥ target) lifts the ceiling to 100", async () => {
    const clearedGate: GoalTarget = { ...GATE_TARGET, target: 2 }; // 2 hits ≥ 2
    installGoalTargets([clearedGate, PLANK_TARGET]);
    installWorkoutFixtures(WORKOUTS);

    const snap = await computeReadiness([clearedGate, PLANK_TARGET], MID_DAY_ASOF, GOAL_ID);

    expect(snap.openGateCount).toBe(0);
    expect(snap.ceiling).toBe(100);
    expect(snap.rawScore).toBe(100);
    expect(snap.score).toBe(100);
  });

  it("untested rolling gate (zero sessions ever) → null progress, counted 0 in denominator, ceiling 80", async () => {
    installGoalTargets([GATE_TARGET]);
    installWorkoutFixtures([]); // no workouts at all

    const snap = await computeReadiness([GATE_TARGET], MID_DAY_ASOF, GOAL_ID);

    expect(snap.breakdown[0]!.current).toBeNull();
    expect(snap.breakdown[0]!.progress).toBeNull();
    expect(snap.missing).toHaveLength(1);
    expect(snap.coverage).toEqual({ tested: 0, total: 1 });
    expect(snap.gates[0]!.progress).toBeNull();
    expect(snap.gates[0]!.cleared).toBe(false);
    expect(snap.ceiling).toBe(GATE_CEILING);
    expect(snap.rawScore).toBe(0);
    expect(snap.score).toBe(0);
  });

  it("explicit target.start is respected over the auto-captured 0", async () => {
    // start 1, target 3, current 2 → comparative progress (2-1)/(3-1) = 0.5.
    const withStart: GoalTarget = { ...GATE_TARGET, gating: undefined, target: 3, start: 1, weight: 1 };
    installGoalTargets([withStart]);
    installWorkoutFixtures(WORKOUTS);

    const snap = await computeReadiness([withStart], MID_DAY_ASOF, GOAL_ID);

    expect(snap.breakdown[0]!.current).toBe(2);
    expect(snap.breakdown[0]!.start).toBe(1);
    expect(snap.breakdown[0]!.progress).toBeCloseTo(0.5);
    expect(snap.ceiling).toBe(100); // no gate
    expect(snap.score).toBe(50);
  });
});
