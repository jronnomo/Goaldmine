// src/lib/goal-story.test.ts
// Mocked-DB unit tests for getGoalStory (REQ-005/Stage B2). Mocks @/lib/db
// (dual-export prisma+getDb convention, mirrors goal-completion.test.ts),
// @/lib/readiness (computeReadiness/computeReadinessSeriesSampled),
// @/lib/records (getBaselineHistory), and @/lib/metric-series
// (getLogMetricSeries). @/lib/goal-story-core and @/lib/goal-completion-core
// are left real — both are pure and already covered by their own suites.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {},
  getDb: vi.fn(),
}));
vi.mock("@/lib/readiness", () => ({
  computeReadiness: vi.fn(),
  computeReadinessSeriesSampled: vi.fn(),
}));
vi.mock("@/lib/records", () => ({ getBaselineHistory: vi.fn() }));
vi.mock("@/lib/metric-series", () => ({ getLogMetricSeries: vi.fn() }));

import { getDb } from "@/lib/db";
import { computeReadiness, computeReadinessSeriesSampled } from "@/lib/readiness";
import { getBaselineHistory } from "@/lib/records";
import { getLogMetricSeries } from "@/lib/metric-series";
import { dateKey } from "@/lib/calendar";
import { getGoalStory } from "@/lib/goal-story";
import type { GoalCompletionSnapshot } from "@/lib/goal-completion-core";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetDb = getDb as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockComputeReadiness = computeReadiness as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockComputeReadinessSeriesSampled = computeReadinessSeriesSampled as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetBaselineHistory = getBaselineHistory as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetLogMetricSeries = getLogMetricSeries as any;

// Well-in-the-past fixed dates, mirroring goal-completion.test.ts's convention
// — never mistaken for "in the future" regardless of the real wall clock.
const CREATED_AT = new Date("2020-01-01T12:00:00Z");
const COMPLETED_AT = new Date("2020-02-15T12:00:00Z");
const REVISION_CREATED_AT = new Date("2020-01-10T12:00:00Z");

const FITNESS_TARGET = {
  metric: "baseline:pushups",
  label: "Push-ups",
  units: "reps",
  direction: "increase",
  target: 50,
  weight: 1,
};

const HIKE_TARGET = {
  metric: "hike:total_distance_mi",
  label: "Total hiking miles",
  units: "mi",
  direction: "increase",
  target: 20,
  weight: 1,
};

const LOG_TARGET = {
  metric: "log:mrr",
  label: "MRR",
  units: "$",
  direction: "increase",
  target: 1000,
  weight: 1,
  cumulative: false,
};

function baseGoalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "g1",
    objective: "Summit Mt. Elbert",
    kind: "fitness",
    status: "active",
    createdAt: CREATED_AT,
    completedAt: null,
    targets: [FITNESS_TARGET],
    completionSnapshot: null,
    ...overrides,
  };
}

function fixtureSnapshot(overrides: Partial<GoalCompletionSnapshot> = {}): GoalCompletionSnapshot {
  return {
    version: 1,
    completedDateKey: "2020-02-15",
    capturedAt: COMPLETED_AT.toISOString(),
    backdated: false,
    objective: "Summit Mt. Elbert",
    kind: "fitness",
    daysElapsed: 45,
    readiness: { score: 80, rawScore: 80, ceiling: 80, coverage: { tested: 1, total: 1 }, openGateCount: 0 },
    readinessSeries: [{ dateKey: "2020-01-05", score: 20 }, { dateKey: "2020-02-15", score: 80 }],
    targets: [
      { metric: "baseline:pushups", label: "Push-ups", units: "reps", start: 10, final: 50, target: 50, progress: 1, met: true },
    ],
    targetsMet: 1,
    targetsTotal: 1,
    feasibilityTierAtCompletion: "rare",
    coachFeasibilityTier: null,
    plan: { planId: "p1", weeksTotal: 12, weeksElapsed: 6 },
    xpBasis: { weeks: 6, targetsMet: 1 },
    xpAwardedAtCompletion: 500,
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeFakeDb(overrides: Record<string, any> = {}) {
  return {
    goal: {
      findUnique: vi.fn().mockResolvedValue(baseGoalRow()),
    },
    plan: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    hike: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetBaselineHistory.mockResolvedValue([]);
  mockGetLogMetricSeries.mockResolvedValue({ points: [], label: "", units: "", domain: [0, 1] });
});

// ─────────────────────────────────────────────────────────────────────────
// Achieved goal
// ─────────────────────────────────────────────────────────────────────────

describe("getGoalStory — achieved goal", () => {
  it("frozen series/targets from snapshot; NEVER calls computeReadiness/computeReadinessSeriesSampled (R9)", async () => {
    const fakeDb = makeFakeDb({
      goal: {
        findUnique: vi.fn().mockResolvedValue(
          baseGoalRow({
            status: "achieved",
            completedAt: COMPLETED_AT,
            completionSnapshot: fixtureSnapshot(),
          }),
        ),
      },
    });
    mockGetDb.mockResolvedValue(fakeDb);

    const story = await getGoalStory("g1");

    expect(story).not.toBeNull();
    expect(story!.readinessSeries).toEqual([
      { dateKey: "2020-01-05", score: 20 },
      { dateKey: "2020-02-15", score: 80 },
    ]);
    expect(story!.targets).toEqual(fixtureSnapshot().targets);
    expect(story!.snapshot).toEqual(fixtureSnapshot());
    expect(story!.goal.completedDateKey).toBe("2020-02-15");
    expect(mockComputeReadiness).not.toHaveBeenCalled();
    expect(mockComputeReadinessSeriesSampled).not.toHaveBeenCalled();
  });

  it("snapshot missing readinessSeries (legacy pre-freeze completion) → readinessSeries null", async () => {
    const snapshotWithoutSeries = fixtureSnapshot();
    delete snapshotWithoutSeries.readinessSeries;
    const fakeDb = makeFakeDb({
      goal: {
        findUnique: vi.fn().mockResolvedValue(
          baseGoalRow({ status: "achieved", completedAt: COMPLETED_AT, completionSnapshot: snapshotWithoutSeries }),
        ),
      },
    });
    mockGetDb.mockResolvedValue(fakeDb);

    const story = await getGoalStory("g1");

    expect(story!.readinessSeries).toBeNull();
    expect(story!.targets).toEqual(snapshotWithoutSeries.targets);
    expect(mockComputeReadiness).not.toHaveBeenCalled();
    expect(mockComputeReadinessSeriesSampled).not.toHaveBeenCalled();
  });

  it("degraded (unparseable) snapshot → snapshot null, targets [], series null, but timeline still assembles", async () => {
    const fakeDb = makeFakeDb({
      goal: {
        findUnique: vi.fn().mockResolvedValue(
          baseGoalRow({
            status: "achieved",
            completedAt: COMPLETED_AT,
            completionSnapshot: { version: 1 /* missing every other required field */ },
          }),
        ),
      },
      plan: {
        findFirst: vi.fn().mockResolvedValue({
          name: "Elbert Program",
          startedOn: CREATED_AT,
          weeks: 12,
          planJson: {
            name: "Elbert Program",
            totalWeeks: 12,
            phases: [{ index: 1, name: "Base", weeks: [1, 2, 3], goal: "g", emphasis: "e", nutrition: { calorieGuidance: "x", proteinTargetG: { low: 1, high: 2 }, hydration: "x", habits: [] }, mobility: { emphasis: [], dailyMin: 10 } }],
            weeklySplit: [],
            baselineWeek: [],
            hikingSuperset: { type: "superset", exercises: [] },
            dailyMobility: { durationMin: 10, exercises: [] },
            goals: [],
          },
          revisions: [],
        }),
      },
    });
    mockGetDb.mockResolvedValue(fakeDb);

    const story = await getGoalStory("g1");

    expect(story!.snapshot).toBeNull();
    expect(story!.targets).toEqual([]);
    expect(story!.readinessSeries).toBeNull();
    expect(story!.timeline).not.toBeNull();
    expect(story!.timeline!.phases).toHaveLength(1);
    expect(mockComputeReadiness).not.toHaveBeenCalled();
    expect(mockComputeReadinessSeriesSampled).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Active goal
// ─────────────────────────────────────────────────────────────────────────

describe("getGoalStory — active goal", () => {
  it("calls computeReadinessSeriesSampled with (createdAt, targets, now-ish, goalId); targets shaped like snapshot rows", async () => {
    const fakeDb = makeFakeDb();
    mockGetDb.mockResolvedValue(fakeDb);
    mockComputeReadiness.mockResolvedValue({
      score: 40,
      rawScore: 40,
      ceiling: 100,
      coverage: { tested: 1, total: 1 },
      openGateCount: 0,
      breakdown: [{ target: FITNESS_TARGET, current: 30, start: 10, progress: 0.5 }],
      missing: [],
    });
    const weekEnd = new Date("2020-01-05T00:00:00Z");
    mockComputeReadinessSeriesSampled.mockResolvedValue([{ weekEnd, score: 10 }]);

    const before = Date.now();
    const story = await getGoalStory("g1");
    const after = Date.now();

    expect(mockComputeReadinessSeriesSampled).toHaveBeenCalledTimes(1);
    const [createdAtArg, targetsArg, untilArg, goalIdArg] =
      mockComputeReadinessSeriesSampled.mock.calls[0];
    expect(createdAtArg).toEqual(CREATED_AT);
    expect(targetsArg).toEqual([FITNESS_TARGET]);
    expect(untilArg.getTime()).toBeGreaterThanOrEqual(before);
    expect(untilArg.getTime()).toBeLessThanOrEqual(after);
    expect(goalIdArg).toBe("g1");

    // Same shape as snapshot.targets rows (metric/label/units/start/final/target/progress/met).
    expect(story!.targets).toEqual([
      { metric: "baseline:pushups", label: "Push-ups", units: "reps", start: 10, final: 30, target: 50, progress: 0.5, met: false },
    ]);
    expect(story!.readinessSeries).toEqual([{ dateKey: dateKey(weekEnd), score: 10 }]);
    expect(story!.snapshot).toBeNull();
    expect(story!.goal.completedDateKey).toBeNull();
  });

  it("zero-target active goal → targets [], readinessSeries null, no live calls", async () => {
    const fakeDb = makeFakeDb({
      goal: { findUnique: vi.fn().mockResolvedValue(baseGoalRow({ targets: [] })) },
    });
    mockGetDb.mockResolvedValue(fakeDb);

    const story = await getGoalStory("g1");

    expect(story!.targets).toEqual([]);
    expect(story!.readinessSeries).toBeNull();
    expect(mockComputeReadiness).not.toHaveBeenCalled();
    expect(mockComputeReadinessSeriesSampled).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Kind selection + arc clipping + timeline fidelity
// ─────────────────────────────────────────────────────────────────────────

describe("getGoalStory — kind-specific arcs", () => {
  it("fitness goal: baselineArcs clipped to window, hikeArc select excludes userId, metricArcs stays []", async () => {
    const fakeDb = makeFakeDb({
      goal: {
        findUnique: vi.fn().mockResolvedValue(
          baseGoalRow({
            status: "achieved",
            completedAt: COMPLETED_AT,
            completionSnapshot: fixtureSnapshot(),
            targets: [FITNESS_TARGET, HIKE_TARGET],
          }),
        ),
      },
    });
    mockGetDb.mockResolvedValue(fakeDb);
    mockGetBaselineHistory.mockResolvedValue([
      { id: "b0", date: new Date("2019-12-01T00:00:00Z"), testName: "pushups", value: 5, units: "reps" }, // before window
      { id: "b1", date: CREATED_AT, testName: "pushups", value: 10, units: "reps" },
      { id: "b2", date: COMPLETED_AT, testName: "pushups", value: 50, units: "reps" },
      { id: "b3", date: new Date("2020-03-01T00:00:00Z"), testName: "pushups", value: 60, units: "reps" }, // after window
    ]);

    const story = await getGoalStory("g1");

    expect(story!.baselineArcs).toEqual([
      {
        testName: "pushups",
        units: "reps",
        points: [
          { dateKey: dateKey(CREATED_AT), value: 10 },
          { dateKey: dateKey(COMPLETED_AT), value: 50 },
        ],
      },
    ]);
    expect(story!.metricArcs).toEqual([]);

    const hikeFindManyCall = fakeDb.hike.findMany.mock.calls[0][0];
    expect(hikeFindManyCall.where).toEqual({ goalId: "g1" });
    expect(hikeFindManyCall.select).not.toHaveProperty("userId");
    expect(hikeFindManyCall.select).toEqual({
      date: true,
      route: true,
      distanceMi: true,
      elevationFt: true,
      summitFt: true,
      packWeightLb: true,
      durationMin: true,
      status: true,
    });
  });

  it("empty baseline arcs (no history at all) are skipped, not included as an empty-points entry", async () => {
    const fakeDb = makeFakeDb();
    mockGetDb.mockResolvedValue(fakeDb);
    mockGetBaselineHistory.mockResolvedValue([]);

    const story = await getGoalStory("g1");

    expect(story!.baselineArcs).toEqual([]);
  });

  it("project goal: metricArcs via getLogMetricSeries per log:* target, clipped by point date; baselineArcs/hikeArc stay []", async () => {
    const fakeDb = makeFakeDb({
      goal: {
        findUnique: vi.fn().mockResolvedValue(
          baseGoalRow({ kind: "project", status: "active", targets: [LOG_TARGET] }),
        ),
      },
    });
    mockGetDb.mockResolvedValue(fakeDb);
    mockComputeReadiness.mockResolvedValue({
      score: 0,
      rawScore: 0,
      ceiling: 100,
      coverage: { tested: 0, total: 1 },
      openGateCount: 0,
      breakdown: [{ target: LOG_TARGET, current: null, start: null, progress: null }],
      missing: [LOG_TARGET],
    });
    mockComputeReadinessSeriesSampled.mockResolvedValue([]);
    mockGetLogMetricSeries.mockResolvedValue({
      points: [
        { date: new Date("2019-06-01T00:00:00Z").toISOString(), value: 1, label: "before" }, // before window
        { date: CREATED_AT.toISOString(), value: 2, label: "in" },
        { date: new Date("2030-01-01T00:00:00Z").toISOString(), value: 3, label: "after" }, // after window (active → endKey=today)
      ],
      label: "MRR",
      units: "$",
      domain: [0, 1000],
    });

    const story = await getGoalStory("g1");

    expect(mockGetLogMetricSeries).toHaveBeenCalledWith(LOG_TARGET, "g1");
    expect(story!.metricArcs).toEqual([
      {
        metric: "log:mrr",
        label: "MRR",
        units: "$",
        domain: [0, 1000],
        points: [{ date: CREATED_AT.toISOString(), value: 2, label: "in" }],
      },
    ]);
    expect(story!.baselineArcs).toEqual([]);
    expect(story!.hikeArc).toEqual([]);
    expect(mockGetBaselineHistory).not.toHaveBeenCalled();
  });

  it("timeline revisions carry no triggerNote key; plan-less goal → timeline null", async () => {
    const fakeDb = makeFakeDb({
      plan: {
        findFirst: vi.fn().mockResolvedValue({
          name: "Elbert Program",
          startedOn: CREATED_AT,
          weeks: 12,
          planJson: {
            name: "Elbert Program",
            totalWeeks: 12,
            phases: [],
            weeklySplit: [],
            baselineWeek: [],
            hikingSuperset: { type: "superset", exercises: [] },
            dailyMobility: { durationMin: 10, exercises: [] },
            goals: [],
          },
          revisions: [
            {
              id: "r1",
              createdAt: REVISION_CREATED_AT,
              triggerSource: "note",
              summary: "Adjusted volume",
              reasoning: "Knee soreness",
            },
          ],
        }),
      },
    });
    mockGetDb.mockResolvedValue(fakeDb);

    const story = await getGoalStory("g1");

    expect(story!.timeline).not.toBeNull();
    expect(story!.timeline!.revisions).toEqual([
      {
        id: "r1",
        createdAtKey: dateKey(REVISION_CREATED_AT),
        triggerSource: "note",
        summary: "Adjusted volume",
        reasoning: "Knee soreness",
      },
    ]);
    for (const r of story!.timeline!.revisions) {
      expect(r).not.toHaveProperty("triggerNote");
      expect(r).not.toHaveProperty("triggerNoteId");
    }

    // Second call: no plan at all → timeline null.
    const fakeDbNoPlan = makeFakeDb();
    mockGetDb.mockResolvedValue(fakeDbNoPlan);
    const storyNoPlan = await getGoalStory("g1");
    expect(storyNoPlan!.timeline).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Not found
// ─────────────────────────────────────────────────────────────────────────

describe("getGoalStory — not found", () => {
  it("returns null when the goal doesn't exist", async () => {
    const fakeDb = makeFakeDb({
      goal: { findUnique: vi.fn().mockResolvedValue(null) },
    });
    mockGetDb.mockResolvedValue(fakeDb);

    const story = await getGoalStory("missing");

    expect(story).toBeNull();
  });
});
