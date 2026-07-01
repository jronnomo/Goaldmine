// src/lib/records.test.ts
// Unit tests for endurance PR metric kinds (REQ-001..006).
// Pure functions require no mocks. DB-touching functions use vi.mock("@/lib/db").

import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoist DB mock above imports to prevent "DATABASE_URL is not set" throws.
// Dual-export: @/lib/db exports both `prisma` and `getDb`; getDb is used by
// getBaselineSummaries/getBaselineHistory (not tested here) — wired for completeness.
vi.mock("@/lib/db", () => ({
  prisma: {
    workoutExercise: { findMany: vi.fn() },
  },
  getDb: vi.fn(),
}));

import {
  metricKindFor,
  isBetter,
  bestSetSummary,
  recordsSetInWorkout,
  canonicalExerciseName,
} from "@/lib/records";

import { mapBaselineToSet } from "@/lib/baseline-workout";
import { computeGameStateFromData } from "@/lib/game/engine";

import { prisma, getDb } from "@/lib/db";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal program snapshot — enough for computeGameStateFromData to not crash. */
function mkProgram(startedOn: Date) {
  return {
    id: "plan-test",
    name: "Test Plan",
    startedOn,
    confirmedThroughDate: null,
    template: {
      name: "Test",
      totalWeeks: 1,
      phases: [],
      weeklySplit: [],
      baselineWeek: [],
      hikingSuperset: { type: "superset" as const, exercises: [] },
      dailyMobility: { durationMin: 0, exercises: [] },
      goals: [],
    },
  };
}

/** Build a synthetic WorkoutWithSets for engine tests. */
function mkWorkout(opts: {
  id: string;
  startedAt: Date;
  exercises: Array<{
    name: string;
    sets: Array<{
      weightLb?: number | null;
      reps?: number | null;
      durationSec?: number | null;
      distanceMi?: number | null;
    }>;
  }>;
}) {
  return {
    id: opts.id,
    startedAt: opts.startedAt,
    status: "completed",
    source: null,
    exercises: opts.exercises.map((ex) => ({
      name: ex.name,
      sets: ex.sets.map((s) => ({
        weightLb: s.weightLb ?? null,
        reps: s.reps ?? null,
        durationSec: s.durationSec ?? null,
        distanceMi: s.distanceMi ?? null,
      })),
    })),
  };
}

const EMPTY_DATA_BASE = {
  goal: null as null,
  hikes: [] as never[],
  baselines: [] as never[],
  nutritionLogs: [] as never[],
  reviewNotes: [] as never[],
  mobilityCheckins: [] as never[],
  overridesByKey: new Map() as Map<string, { workoutJson: unknown; baselineTestNames: string[] | null }>,
  bonusRows: [] as never[],
};

// ── Group 1: metricKindFor ─────────────────────────────────────────────────────

describe("metricKindFor", () => {
  it("returns distance/higher for '20 Min Bike Distance'", () => {
    expect(metricKindFor("20 Min Bike Distance")).toEqual({ kind: "distance", direction: "higher" });
  });

  it("returns time/lower for '1.5 Mile Run'", () => {
    expect(metricKindFor("1.5 Mile Run")).toEqual({ kind: "time", direction: "lower" });
  });

  it("returns distance/higher for '60 Min Steady Effort Distance'", () => {
    expect(metricKindFor("60 Min Steady Effort Distance")).toEqual({ kind: "distance", direction: "higher" });
  });

  it("returns time/lower for '40-Yard Sprint'", () => {
    expect(metricKindFor("40-Yard Sprint")).toEqual({ kind: "time", direction: "lower" });
  });

  it("returns time/lower for '5-10-5 Shuttle'", () => {
    expect(metricKindFor("5-10-5 Shuttle")).toEqual({ kind: "time", direction: "lower" });
  });

  it("returns null for unmapped strength movement 'Pull-Up'", () => {
    expect(metricKindFor("Pull-Up")).toBeNull();
  });

  it("returns null for unmapped strength movement 'DB Shoulder Press'", () => {
    expect(metricKindFor("DB Shoulder Press")).toBeNull();
  });

  it("returns null for unmapped movement 'Deadlift'", () => {
    expect(metricKindFor("Deadlift")).toBeNull();
  });

  it("resolves correctly even when passed a pre-canonicalized name (belt-and-suspenders)", () => {
    // All registry entries are their own canonical form
    const name = "20 Min Bike Distance";
    expect(canonicalExerciseName(name)).toBe(name); // verifies it is its own canonical
    expect(metricKindFor(name)).toEqual({ kind: "distance", direction: "higher" });
  });
});

// ── Group 2: isBetter ─────────────────────────────────────────────────────────

describe("isBetter", () => {
  it("higher: 6.6 > 5.9 → true (distance PR)", () => {
    expect(isBetter("higher", 6.6, 5.9)).toBe(true);
  });

  it("higher: 5.9 < 6.6 → false (regression)", () => {
    expect(isBetter("higher", 5.9, 6.6)).toBe(false);
  });

  it("higher: 6.6 == 6.6 → false (tie)", () => {
    expect(isBetter("higher", 6.6, 6.6)).toBe(false);
  });

  it("lower: 480 < 510 → true (faster run)", () => {
    expect(isBetter("lower", 480, 510)).toBe(true);
  });

  it("lower: 510 > 480 → false (slower run)", () => {
    expect(isBetter("lower", 510, 480)).toBe(false);
  });

  it("lower: 480 == 480 → false (tie)", () => {
    expect(isBetter("lower", 480, 480)).toBe(false);
  });
});

// ── Group 3: bestSetSummary (mapped path) ─────────────────────────────────────

describe("bestSetSummary — mapped path", () => {
  it("distance: picks max distanceMi for '20 Min Bike Distance'", () => {
    const result = bestSetSummary(
      [
        { weightLb: null, reps: null, durationSec: null, distanceMi: 5.9 },
        { weightLb: null, reps: null, durationSec: null, distanceMi: 6.6 },
      ],
      "20 Min Bike Distance",
    );
    expect(result).toMatchObject({
      primary: "distance",
      direction: "higher",
      value: 6.6,
    });
    expect(result?.raw.distanceMi).toBe(6.6);
    expect(result?.raw.durationSec).toBeNull();
  });

  it("time: picks min durationSec for '1.5 Mile Run'", () => {
    const result = bestSetSummary(
      [
        { weightLb: null, reps: null, durationSec: 510, distanceMi: null },
        { weightLb: null, reps: null, durationSec: 480, distanceMi: null },
      ],
      "1.5 Mile Run",
    );
    expect(result).toMatchObject({
      primary: "time",
      direction: "lower",
      value: 480,
    });
    expect(result?.raw.durationSec).toBe(480);
  });

  it("distance: returns null when distanceMi is null on all sets", () => {
    const result = bestSetSummary(
      [{ weightLb: null, reps: null, durationSec: null, distanceMi: null }],
      "20 Min Bike Distance",
    );
    expect(result).toBeNull();
  });

  it("distance set with phantom durationSec: returns distance, not duration", () => {
    const result = bestSetSummary(
      [{ weightLb: null, reps: null, durationSec: 1200, distanceMi: 6.6 }],
      "20 Min Bike Distance",
    );
    expect(result?.primary).toBe("distance");
    expect(result?.value).toBe(6.6);
  });
});

// ── Group 4: bestSetSummary (unmapped regression) ─────────────────────────────

describe("bestSetSummary — unmapped path (regression)", () => {
  it("weighted: returns rm with direction higher", () => {
    const result = bestSetSummary([
      { weightLb: 65, reps: 8, durationSec: null, distanceMi: null },
    ]);
    expect(result?.primary).toBe("rm");
    expect(result?.direction).toBe("higher");
    expect(result?.value).toBeGreaterThan(65);
  });

  it("reps-only: returns reps with direction higher", () => {
    const result = bestSetSummary([
      { weightLb: null, reps: 15, durationSec: null, distanceMi: null },
    ]);
    expect(result?.primary).toBe("reps");
    expect(result?.direction).toBe("higher");
    expect(result?.value).toBe(15);
  });

  it("duration-only: returns duration with direction higher (plank hold)", () => {
    const result = bestSetSummary([
      { weightLb: null, reps: null, durationSec: 252, distanceMi: null },
    ]);
    expect(result?.primary).toBe("duration");
    expect(result?.direction).toBe("higher");
    expect(result?.value).toBe(252);
  });

  it("empty array: returns null", () => {
    expect(bestSetSummary([])).toBeNull();
  });

  it("no canonicalName: uses default cascade (no registry dispatch)", () => {
    // Even if a set has distanceMi, without a name to dispatch on it uses the cascade
    const result = bestSetSummary([
      { weightLb: null, reps: null, durationSec: 1200, distanceMi: 6.6 },
    ]);
    // Default cascade: no weight, no reps, has durationSec → duration/higher
    expect(result?.primary).toBe("duration");
    expect(result?.direction).toBe("higher");
    expect(result?.value).toBe(1200);
  });
});

// ── Group 5: recordsSetInWorkout (DB mock) ────────────────────────────────────

const findManyMock = vi.mocked(prisma.workoutExercise.findMany);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetDb = getDb as any;

describe("recordsSetInWorkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDb.mockResolvedValue(prisma); // wire getDb to the fake client (completeness)
  });

  it("bike 5.9→6.6 mi: returns RecordSet with kind=distance", async () => {
    // This workout's sets
    findManyMock
      .mockResolvedValueOnce([
        {
          id: "ex1",
          workoutId: "w2",
          name: "20 Min Bike Distance",
          equipment: null,
          orderIndex: 0,
          notes: null,
          sets: [
            {
              id: "s1",
              workoutExerciseId: "ex1",
              setIndex: 1,
              weightLb: null,
              reps: null,
              durationSec: 1200,
              distanceMi: 6.6,
            },
          ],
        } as never,
      ])
      // Prior workouts' exercises
      .mockResolvedValueOnce([
        {
          id: "ex-prior",
          workoutId: "w1",
          name: "20 Min Bike Distance",
          equipment: null,
          orderIndex: 0,
          notes: null,
          sets: [
            {
              id: "s-prior",
              workoutExerciseId: "ex-prior",
              setIndex: 1,
              weightLb: null,
              reps: null,
              durationSec: 1200,
              distanceMi: 5.9,
            },
          ],
        } as never,
      ]);

    const results = await recordsSetInWorkout("w2");
    expect(results).toHaveLength(1);
    expect(results[0]!.kind).toBe("distance");
    expect(results[0]!.value).toBe(6.6);
    expect(results[0]!.prior).toBe(5.9);
  });

  it("run faster (510→480 sec): returns RecordSet with kind=time", async () => {
    findManyMock
      .mockResolvedValueOnce([
        {
          id: "ex1",
          workoutId: "w2",
          name: "1.5 Mile Run",
          equipment: null,
          orderIndex: 0,
          notes: null,
          sets: [
            {
              id: "s1",
              workoutExerciseId: "ex1",
              setIndex: 1,
              weightLb: null,
              reps: null,
              durationSec: 480,
              distanceMi: null,
            },
          ],
        } as never,
      ])
      .mockResolvedValueOnce([
        {
          id: "ex-prior",
          workoutId: "w1",
          name: "1.5 Mile Run",
          equipment: null,
          orderIndex: 0,
          notes: null,
          sets: [
            {
              id: "s-prior",
              workoutExerciseId: "ex-prior",
              setIndex: 1,
              weightLb: null,
              reps: null,
              durationSec: 510,
              distanceMi: null,
            },
          ],
        } as never,
      ]);

    const results = await recordsSetInWorkout("w2");
    expect(results).toHaveLength(1);
    expect(results[0]!.kind).toBe("time");
    expect(results[0]!.value).toBe(480);
    expect(results[0]!.prior).toBe(510);
  });

  it("run slower (480→510 sec): no PR", async () => {
    findManyMock
      .mockResolvedValueOnce([
        {
          id: "ex1",
          workoutId: "w2",
          name: "1.5 Mile Run",
          equipment: null,
          orderIndex: 0,
          notes: null,
          sets: [
            {
              id: "s1",
              workoutExerciseId: "ex1",
              setIndex: 1,
              weightLb: null,
              reps: null,
              durationSec: 510,
              distanceMi: null,
            },
          ],
        } as never,
      ])
      .mockResolvedValueOnce([
        {
          id: "ex-prior",
          workoutId: "w1",
          name: "1.5 Mile Run",
          equipment: null,
          orderIndex: 0,
          notes: null,
          sets: [
            {
              id: "s-prior",
              workoutExerciseId: "ex-prior",
              setIndex: 1,
              weightLb: null,
              reps: null,
              durationSec: 480,
              distanceMi: null,
            },
          ],
        } as never,
      ]);

    const results = await recordsSetInWorkout("w2");
    expect(results).toHaveLength(0);
  });

  it("run tie (480→480 sec): no PR", async () => {
    findManyMock
      .mockResolvedValueOnce([
        {
          id: "ex1",
          workoutId: "w2",
          name: "1.5 Mile Run",
          equipment: null,
          orderIndex: 0,
          notes: null,
          sets: [
            {
              id: "s1",
              workoutExerciseId: "ex1",
              setIndex: 1,
              weightLb: null,
              reps: null,
              durationSec: 480,
              distanceMi: null,
            },
          ],
        } as never,
      ])
      .mockResolvedValueOnce([
        {
          id: "ex-prior",
          workoutId: "w1",
          name: "1.5 Mile Run",
          equipment: null,
          orderIndex: 0,
          notes: null,
          sets: [
            {
              id: "s-prior",
              workoutExerciseId: "ex-prior",
              setIndex: 1,
              weightLb: null,
              reps: null,
              durationSec: 480,
              distanceMi: null,
            },
          ],
        } as never,
      ]);

    const results = await recordsSetInWorkout("w2");
    expect(results).toHaveLength(0);
  });

  it("unmapped strength movement (new 1RM): returns RecordSet with kind=rm", async () => {
    findManyMock
      .mockResolvedValueOnce([
        {
          id: "ex1",
          workoutId: "w2",
          name: "Deadlift",
          equipment: "Barbell",
          orderIndex: 0,
          notes: null,
          sets: [
            {
              id: "s1",
              workoutExerciseId: "ex1",
              setIndex: 1,
              weightLb: 225,
              reps: 5,
              durationSec: null,
              distanceMi: null,
            },
          ],
        } as never,
      ])
      .mockResolvedValueOnce([
        {
          id: "ex-prior",
          workoutId: "w1",
          name: "Deadlift",
          equipment: "Barbell",
          orderIndex: 0,
          notes: null,
          sets: [
            {
              id: "s-prior",
              workoutExerciseId: "ex-prior",
              setIndex: 1,
              weightLb: 185,
              reps: 5,
              durationSec: null,
              distanceMi: null,
            },
          ],
        } as never,
      ]);

    const results = await recordsSetInWorkout("w2");
    expect(results).toHaveLength(1);
    expect(results[0]!.kind).toBe("rm");
  });

  it("brand-new movement (no prior): no PR", async () => {
    findManyMock
      .mockResolvedValueOnce([
        {
          id: "ex1",
          workoutId: "w2",
          name: "20 Min Bike Distance",
          equipment: null,
          orderIndex: 0,
          notes: null,
          sets: [
            {
              id: "s1",
              workoutExerciseId: "ex1",
              setIndex: 1,
              weightLb: null,
              reps: null,
              durationSec: null,
              distanceMi: 6.6,
            },
          ],
        } as never,
      ])
      // No prior exercises
      .mockResolvedValueOnce([] as never[]);

    const results = await recordsSetInWorkout("w2");
    expect(results).toHaveLength(0);
  });
});

// ── Group 6: buildPrEvents via computeGameStateFromData ───────────────────────

describe("buildPrEvents via computeGameStateFromData", () => {
  const today = new Date("2026-06-19T12:00:00Z");
  const day1 = new Date("2026-06-09T10:00:00Z"); // prior
  const day2 = new Date("2026-06-19T10:00:00Z"); // today

  it("bike distance improvement (5.9→6.6 mi): emits pr.set with attribute END", () => {
    const workouts = [
      mkWorkout({
        id: "w1",
        startedAt: day1,
        exercises: [
          {
            name: "20 Min Bike Distance",
            sets: [{ distanceMi: 5.9 }],
          },
        ],
      }),
      mkWorkout({
        id: "w2",
        startedAt: day2,
        exercises: [
          {
            name: "20 Min Bike Distance",
            sets: [{ distanceMi: 6.6 }],
          },
        ],
      }),
    ];

    const state = computeGameStateFromData(
      { ...EMPTY_DATA_BASE, program: mkProgram(today), workouts },
      today,
    );

    const prEvents = state.recentEvents.filter(
      (e) => e.ruleId === "pr.set" && e.label.includes("20 Min Bike Distance"),
    );
    expect(prEvents.length).toBeGreaterThanOrEqual(1);
    expect(prEvents[0]!.attribute).toBe("END");
  });

  it("run faster (510→480 sec): emits pr.set with attribute END", () => {
    const workouts = [
      mkWorkout({
        id: "w1",
        startedAt: day1,
        exercises: [
          {
            name: "1.5 Mile Run",
            sets: [{ durationSec: 510 }],
          },
        ],
      }),
      mkWorkout({
        id: "w2",
        startedAt: day2,
        exercises: [
          {
            name: "1.5 Mile Run",
            sets: [{ durationSec: 480 }],
          },
        ],
      }),
    ];

    const state = computeGameStateFromData(
      { ...EMPTY_DATA_BASE, program: mkProgram(today), workouts },
      today,
    );

    const prEvents = state.recentEvents.filter(
      (e) => e.ruleId === "pr.set" && e.label.includes("1.5 Mile Run"),
    );
    expect(prEvents.length).toBeGreaterThanOrEqual(1);
    expect(prEvents[0]!.attribute).toBe("END");
  });

  it("run slower (480→510 sec): NO pr.set event for '1.5 Mile Run'", () => {
    const workouts = [
      mkWorkout({
        id: "w1",
        startedAt: day1,
        exercises: [
          {
            name: "1.5 Mile Run",
            sets: [{ durationSec: 480 }],
          },
        ],
      }),
      mkWorkout({
        id: "w2",
        startedAt: day2,
        exercises: [
          {
            name: "1.5 Mile Run",
            sets: [{ durationSec: 510 }],
          },
        ],
      }),
    ];

    const state = computeGameStateFromData(
      { ...EMPTY_DATA_BASE, program: mkProgram(today), workouts },
      today,
    );

    const prEvents = state.recentEvents.filter(
      (e) => e.ruleId === "pr.set" && e.label.includes("1.5 Mile Run"),
    );
    expect(prEvents).toHaveLength(0);
  });

  it("3/day cap: at most 3 pr.set events per day even with 4 PRs", () => {
    // Four exercises, all with prior and improvement on the same day
    const priorDate = new Date("2026-06-18T10:00:00Z");
    const sameDayPrDate = new Date("2026-06-19T11:00:00Z");

    const workouts = [
      // Prior workout (establishes baseline for all 4)
      mkWorkout({
        id: "w-prior",
        startedAt: priorDate,
        exercises: [
          { name: "20 Min Bike Distance", sets: [{ distanceMi: 5.0 }] },
          { name: "1.5 Mile Run", sets: [{ durationSec: 600 }] },
          { name: "40-Yard Sprint", sets: [{ durationSec: 7.0 }] },
          { name: "5-10-5 Shuttle", sets: [{ durationSec: 6.0 }] },
        ],
      }),
      // Today's workout with all 4 exercises improved
      mkWorkout({
        id: "w-today",
        startedAt: sameDayPrDate,
        exercises: [
          { name: "20 Min Bike Distance", sets: [{ distanceMi: 6.0 }] },
          { name: "1.5 Mile Run", sets: [{ durationSec: 480 }] },
          { name: "40-Yard Sprint", sets: [{ durationSec: 6.5 }] },
          { name: "5-10-5 Shuttle", sets: [{ durationSec: 5.5 }] },
        ],
      }),
    ];

    const state = computeGameStateFromData(
      { ...EMPTY_DATA_BASE, program: mkProgram(today), workouts },
      today,
    );

    const dk = "2026-06-19";
    const dayPrs = state.recentEvents.filter(
      (e) => e.ruleId === "pr.set" && e.dateKey === dk,
    );
    expect(dayPrs.length).toBeLessThanOrEqual(3);
  });

  it("retroactive: prior workout from 10 days ago, PR fires for today's dateKey", () => {
    const workouts = [
      mkWorkout({
        id: "w1",
        startedAt: day1,
        exercises: [
          {
            name: "20 Min Bike Distance",
            sets: [{ distanceMi: 5.9 }],
          },
        ],
      }),
      mkWorkout({
        id: "w2",
        startedAt: day2,
        exercises: [
          {
            name: "20 Min Bike Distance",
            sets: [{ distanceMi: 6.6 }],
          },
        ],
      }),
    ];

    const state = computeGameStateFromData(
      { ...EMPTY_DATA_BASE, program: mkProgram(today), workouts },
      today,
    );

    const prEvent = state.recentEvents.find(
      (e) => e.ruleId === "pr.set" && e.label.includes("20 Min Bike Distance"),
    );
    expect(prEvent).toBeDefined();
    expect(prEvent?.dateKey).toBe("2026-06-19");
  });
});

// ── Group 7: mapBaselineToSet ─────────────────────────────────────────────────

describe("mapBaselineToSet", () => {
  it("'20 Min Bike Distance' with mi units: returns {distanceMi} with NO durationSec", () => {
    const result = mapBaselineToSet("20 Min Bike Distance", 6.6, "mi");
    expect(result.distanceMi).toBe(6.6);
    // Must NOT write phantom durationSec from "20 Min" name fragment
    expect(result.durationSec).toBeUndefined();
  });

  it("'60 Min Steady Effort Distance' with mi units: returns {distanceMi} with NO durationSec", () => {
    const result = mapBaselineToSet("60 Min Steady Effort Distance", 4.2, "mi");
    expect(result.distanceMi).toBe(4.2);
    expect(result.durationSec).toBeUndefined();
  });

  it("'1.5 Mile Run' with sec units: returns {durationSec} with NO distanceMi", () => {
    const result = mapBaselineToSet("1.5 Mile Run", 480, "sec");
    expect(result.durationSec).toBe(480);
    // Must NOT write phantom distanceMi=1.5 from "1.5 Mile" name fragment
    expect(result.distanceMi).toBeUndefined();
  });

  it("'40-Yard Sprint' with sec units: returns {durationSec} with no phantom", () => {
    const result = mapBaselineToSet("40-Yard Sprint", 6.5, "sec");
    expect(result.durationSec).toBe(7);  // Math.round(6.5) = 7
    expect(result.distanceMi).toBeUndefined();
  });

  it("'5-10-5 Shuttle' with sec units: returns {durationSec}", () => {
    const result = mapBaselineToSet("5-10-5 Shuttle", 5.8, "sec");
    expect(result.durationSec).toBe(6); // Math.round(5.8) = 6
    expect(result.distanceMi).toBeUndefined();
  });

  it("'Plank Max Hold' with sec units: unchanged behavior (unmapped)", () => {
    const result = mapBaselineToSet("Plank Max Hold", 252, "sec");
    expect(result.durationSec).toBe(252);
  });

  it("'Dead Hang' with sec units: unchanged behavior (unmapped)", () => {
    const result = mapBaselineToSet("Dead Hang", 45, "sec");
    expect(result.durationSec).toBe(45);
  });

  it("'20 Min Step-Up Reps' with reps units: unmapped — phantom durationSec is OK (reps wins cascade)", () => {
    // Not in registry, so the minMatch phantom still fires (unchanged behavior).
    const result = mapBaselineToSet("20 Min Step-Up Reps", 95, "reps");
    expect(result.reps).toBe(95);
    // durationSec may be set (phantom) — that's the pre-existing behavior for unmapped tests
    // The reps cascade wins in bestSetSummary, so this is safe.
  });
});
