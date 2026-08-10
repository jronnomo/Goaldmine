// src/lib/compare.test.ts
// Unit tests for computeComparison — mocks @/lib/db, @/lib/readiness,
// @/lib/game/engine (repo dual-export prisma+getDb convention, per
// research-output.md §Conventions #9 and readiness.test.ts). @/lib/records is
// NOT mocked — canonicalExerciseName/bestSetSummary/metricKindFor/epley1RM
// are pure and exercised for real against raw workoutExercise rows.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: { workoutExercise: { findMany: vi.fn() } },
  getDb: vi.fn(),
}));
vi.mock("@/lib/readiness", () => ({ computeReadiness: vi.fn() }));
vi.mock("@/lib/game/engine", () => ({ computeGameState: vi.fn() }));
// #298: the goal-list ordering goes through the rotation-owner seam. Partial
// mock — orderMembersFirst stays REAL (it's the subject composing the final
// order); factory defaults model a zero-Program tenant with no focus goal,
// which reproduces the pre-#298 order for every earlier test in this file
// (no lift, DB order preserved). The #298 describe at the bottom overrides
// per-test.
vi.mock("@/lib/program", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/program")>();
  return {
    ...actual,
    getRotationOwnerGoal: vi.fn().mockResolvedValue({
      mode: "legacy",
      goalId: null,
      goalKind: null,
      planId: null,
    }),
    getActiveProgramMembership: vi.fn().mockResolvedValue(null),
  };
});

import { prisma, getDb } from "@/lib/db";
import { computeReadiness } from "@/lib/readiness";
import { computeGameState } from "@/lib/game/engine";
import { getRotationOwnerGoal, getActiveProgramMembership } from "@/lib/program";
import { computeComparison } from "@/lib/compare";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetDb = getDb as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockComputeReadiness = computeReadiness as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockComputeGameState = computeGameState as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockFindManyWorkoutExercise = (prisma as any).workoutExercise.findMany;

// ─────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mkScopedDb(overrides: Record<string, any> = {}) {
  return {
    goal: { findMany: vi.fn().mockResolvedValue([]) },
    baseline: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    measurement: { findMany: vi.fn().mockResolvedValue([]) },
    bodyMetric: { findMany: vi.fn().mockResolvedValue([]) },
    workout: { count: vi.fn().mockResolvedValue(0) },
    hike: { count: vi.fn().mockResolvedValue(0), aggregate: vi.fn().mockResolvedValue({ _sum: { elevationFt: 0, distanceMi: 0 } }) },
    note: { count: vi.fn().mockResolvedValue(0) },
    nutritionLog: { findMany: vi.fn().mockResolvedValue([]) },
    ...overrides,
  };
}

const READINESS_FIXTURE = {
  score: 74, rawScore: 74, ceiling: 100, coverage: { tested: 1, total: 1 },
  gates: [], openGateCount: 0,
  breakdown: [{ target: { metric: "weightLb", label: "Body weight", units: "lb", direction: "decrease", target: 155, weight: 0.05 }, current: 159, start: 168, progress: 0.8 }],
  missing: [],
};

const GAME_STATE_FIXTURE = {
  goalKind: "fitness", level: 7, xp: 3200, xpIntoLevel: 100, xpToNext: 1050, progress: 0.1,
  attributes: [], streak: { current: 3, longest: 10, todayCounted: true }, badges: [], recentEvents: [],
  questToday: null,
  events: [
    { dateKey: "2026-03-05", ruleId: "workout", label: "Upper workout", xp: 100, attribute: "STR" },
    { dateKey: "2026-06-01", ruleId: "pr", label: "PR · Goblet Squat", xp: 250, attribute: "STR" },
  ],
};

const EMPTY_GAME_STATE_FIXTURE = {
  goalKind: null, level: 1, xp: 0, xpIntoLevel: 0, xpToNext: 150, progress: 0,
  attributes: [], streak: { current: 0, longest: 0, todayCounted: false }, badges: [], recentEvents: [],
  questToday: null,
  events: [],
};

describe("computeComparison", () => {
  it("full assembly: all 6 sections populated, dateA <= dateB", async () => {
    mockGetDb.mockResolvedValue(mkScopedDb({
      goal: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "goal-1",
            objective: "Summit Mt. Elbert",
            kind: "fitness",
            createdAt: new Date("2026-01-01"),
            targets: [{ metric: "weightLb", label: "Body weight", units: "lb", direction: "decrease", target: 155, weight: 1 }],
          },
        ]),
      },
      baseline: {
        findMany: vi.fn().mockResolvedValue([
          { testName: "1.5 Mile Run", units: "sec", value: 778, date: new Date("2026-06-15") },
        ]),
        count: vi.fn().mockResolvedValue(0),
      },
      measurement: {
        findMany: vi.fn().mockResolvedValue([
          { date: new Date("2026-06-20"), weightLb: 159, bodyFatPct: 14 },
        ]),
      },
      bodyMetric: { findMany: vi.fn().mockResolvedValue([]) },
      workout: { count: vi.fn().mockResolvedValue(5) },
      hike: { count: vi.fn().mockResolvedValue(2), aggregate: vi.fn().mockResolvedValue({ _sum: { elevationFt: 4000, distanceMi: 10 } }) },
      note: { count: vi.fn().mockResolvedValue(1) },
      nutritionLog: {
        findMany: vi.fn().mockResolvedValue([
          { date: new Date("2026-06-15T18:00:00.000Z"), calories: 2200, proteinG: 168, carbsG: 200, fatG: 70 },
        ]),
      },
    }));
    mockComputeReadiness.mockResolvedValue(READINESS_FIXTURE);
    mockComputeGameState.mockResolvedValue(GAME_STATE_FIXTURE);
    mockFindManyWorkoutExercise.mockResolvedValue([
      {
        name: "Goblet Squat",
        sets: [{ weightLb: 65, reps: 10, durationSec: null, distanceMi: null }],
        workout: { startedAt: new Date("2026-06-10") },
      },
    ]);

    const result = await computeComparison("2026-03-01", "2026-06-20");

    expect(result.dateA <= result.dateB).toBe(true);
    expect(result.goals).toHaveLength(1);
    expect(result.strength.length).toBeGreaterThan(0);
    expect(result.baselines.length).toBeGreaterThan(0);
    expect(result.body.length).toBeGreaterThan(0);
    expect(result.counters).toBeDefined();
    expect(result.nutrition).toBeDefined();
  });

  it("createdAfterA: computeReadiness called exactly once, readiness.valueA null", async () => {
    mockGetDb.mockResolvedValue(mkScopedDb({
      goal: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "goal-new",
            objective: "New goal",
            kind: "project",
            createdAt: new Date("2026-05-01"), // after cutA (2026-03-01)
            targets: [{ metric: "log:mrr", label: "MRR", units: "$", direction: "increase", target: 1000, weight: 1 }],
          },
        ]),
      },
    }));
    mockComputeReadiness.mockReset();
    mockComputeReadiness.mockResolvedValue({ ...READINESS_FIXTURE, score: 50 });
    mockComputeGameState.mockResolvedValue(EMPTY_GAME_STATE_FIXTURE);
    mockFindManyWorkoutExercise.mockResolvedValue([]);

    const result = await computeComparison("2026-03-01", "2026-06-20");

    expect(mockComputeReadiness).toHaveBeenCalledTimes(1);
    expect(result.goals[0]!.createdAfterA).toBe(true);
    expect(result.goals[0]!.readiness!.valueA).toBeNull();
    expect(result.goals[0]!.readiness!.valueB).toBe(50);
  });

  it("achieved goal whose life overlaps [A,B]: included with status/completedDateKey + readiness", async () => {
    mockGetDb.mockResolvedValue(mkScopedDb({
      goal: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "goal-achieved",
            objective: "Summit Mt. Elbert",
            kind: "fitness",
            createdAt: new Date("2026-01-01"), // <= cutB
            status: "achieved",
            // Noon UTC avoids the midnight-UTC → prior-Denver-day rollover
            // (see the nutrition TZ test below) — dateKey lands on 2026-05-01.
            completedAt: new Date("2026-05-01T12:00:00.000Z"), // >= dateA (2026-03-01), <= dateB (2026-06-20)
            targets: [{ metric: "weightLb", label: "Body weight", units: "lb", direction: "decrease", target: 155, weight: 1 }],
          },
        ]),
      },
    }));
    mockComputeReadiness.mockReset();
    mockComputeReadiness.mockResolvedValue(READINESS_FIXTURE);
    mockComputeGameState.mockResolvedValue(EMPTY_GAME_STATE_FIXTURE);
    mockFindManyWorkoutExercise.mockResolvedValue([]);

    const result = await computeComparison("2026-03-01", "2026-06-20");

    expect(result.goals).toHaveLength(1);
    expect(result.goals[0]!.status).toBe("achieved");
    expect(result.goals[0]!.completedDateKey).toBe("2026-05-01");
    expect(result.goals[0]!.readiness).not.toBeNull();
    expect(result.goals[0]!.readiness!.valueB).toBe(74);
  });

  it("achieved goal completed BEFORE dateA: excluded (noise outside its life)", async () => {
    mockGetDb.mockResolvedValue(mkScopedDb({
      goal: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "goal-old",
            objective: "Old finished goal",
            kind: "fitness",
            createdAt: new Date("2025-01-01"),
            status: "achieved",
            completedAt: new Date("2026-02-01"), // before dateA (2026-03-01)
            targets: [{ metric: "weightLb", label: "Body weight", units: "lb", direction: "decrease", target: 155, weight: 1 }],
          },
        ]),
      },
    }));
    mockComputeReadiness.mockReset();
    mockComputeReadiness.mockResolvedValue(READINESS_FIXTURE);
    mockComputeGameState.mockResolvedValue(EMPTY_GAME_STATE_FIXTURE);
    mockFindManyWorkoutExercise.mockResolvedValue([]);

    const result = await computeComparison("2026-03-01", "2026-06-20");

    expect(result.goals).toHaveLength(0);
    expect(mockComputeReadiness).not.toHaveBeenCalled();
  });

  it("achieved goal created AFTER dateB: excluded (noise outside its life)", async () => {
    mockGetDb.mockResolvedValue(mkScopedDb({
      goal: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "goal-future",
            objective: "Future-window goal",
            kind: "fitness",
            createdAt: new Date("2026-07-01"), // after dateB (2026-06-20)
            status: "achieved",
            completedAt: new Date("2026-07-15"),
            targets: [{ metric: "weightLb", label: "Body weight", units: "lb", direction: "decrease", target: 155, weight: 1 }],
          },
        ]),
      },
    }));
    mockComputeReadiness.mockReset();
    mockComputeReadiness.mockResolvedValue(READINESS_FIXTURE);
    mockComputeGameState.mockResolvedValue(EMPTY_GAME_STATE_FIXTURE);
    mockFindManyWorkoutExercise.mockResolvedValue([]);

    const result = await computeComparison("2026-03-01", "2026-06-20");

    expect(result.goals).toHaveLength(0);
    expect(mockComputeReadiness).not.toHaveBeenCalled();
  });

  it("active goals unchanged: no status field needed, always included regardless of window", async () => {
    mockGetDb.mockResolvedValue(mkScopedDb({
      goal: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "goal-active",
            objective: "Still going",
            kind: "fitness",
            createdAt: new Date("2026-07-01"), // after dateB — would be excluded if this were "achieved"
            targets: [{ metric: "weightLb", label: "Body weight", units: "lb", direction: "decrease", target: 155, weight: 1 }],
          },
        ]),
      },
    }));
    mockComputeReadiness.mockReset();
    mockComputeReadiness.mockResolvedValue(READINESS_FIXTURE);
    mockComputeGameState.mockResolvedValue(EMPTY_GAME_STATE_FIXTURE);
    mockFindManyWorkoutExercise.mockResolvedValue([]);

    const result = await computeComparison("2026-03-01", "2026-06-20");

    expect(result.goals).toHaveLength(1);
    expect(result.goals[0]!.status).toBeUndefined();
    expect(result.goals[0]!.completedDateKey).toBeNull();
  });

  it("time-kind exercise: best-as-of is the MINIMUM duration <= cutoff", async () => {
    mockGetDb.mockResolvedValue(mkScopedDb());
    mockComputeReadiness.mockReset();
    mockComputeGameState.mockResolvedValue(EMPTY_GAME_STATE_FIXTURE);
    mockFindManyWorkoutExercise.mockResolvedValue([
      {
        name: "1.5 Mile Run",
        sets: [{ weightLb: null, reps: null, durationSec: 890, distanceMi: null }],
        workout: { startedAt: new Date("2026-03-01") }, // <= cutA
      },
      {
        name: "1.5 Mile Run",
        sets: [{ weightLb: null, reps: null, durationSec: 778, distanceMi: null }],
        workout: { startedAt: new Date("2026-06-01") }, // <= cutB, > cutA
      },
    ]);

    const result = await computeComparison("2026-03-01", "2026-06-20");
    const entry = result.strength.find((e) => e.key === "exercise:1.5 Mile Run");
    expect(entry).toBeDefined();
    // best-as-of-A = min(890) = 890 (only set at/under cutA)
    expect(entry!.valueA).toBe(890);
    // best-as-of-B = min(890, 778) = 778 (lower is better for time-kind)
    expect(entry!.valueB).toBe(778);
    expect(entry!.direction).toBe("decrease");
  });

  it("baseline direction fallback: 3-try chain resolves correctly", async () => {
    mockComputeReadiness.mockReset();
    mockComputeGameState.mockResolvedValue(EMPTY_GAME_STATE_FIXTURE);
    mockFindManyWorkoutExercise.mockResolvedValue([]);

    // (a) metricKindFor hit — "1.5 Mile Run" is a registered time/lower override.
    mockGetDb.mockResolvedValue(mkScopedDb({
      goal: { findMany: vi.fn().mockResolvedValue([]) },
      baseline: {
        findMany: vi.fn().mockResolvedValue([
          { testName: "1.5 Mile Run", units: "sec", value: 778, date: new Date("2026-06-15") },
        ]),
        count: vi.fn().mockResolvedValue(0),
      },
    }));
    let result = await computeComparison("2026-03-01", "2026-06-20");
    expect(result.baselines.find((e) => e.key === "baseline:1.5 Mile Run")!.direction).toBe("decrease");

    // (b) no registered kind, but an active goal target `baseline:<name>` supplies direction.
    mockComputeReadiness.mockResolvedValue(READINESS_FIXTURE);
    mockGetDb.mockResolvedValue(mkScopedDb({
      goal: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "goal-1", objective: "O", kind: "fitness", createdAt: new Date("2020-01-01"),
            targets: [{ metric: "baseline:Custom Test", label: "Custom Test", units: "reps", direction: "decrease", target: 5, weight: 1 }],
          },
        ]),
      },
      baseline: {
        findMany: vi.fn().mockResolvedValue([
          { testName: "Custom Test", units: "reps", value: 12, date: new Date("2026-06-15") },
        ]),
        count: vi.fn().mockResolvedValue(0),
      },
    }));
    result = await computeComparison("2026-03-01", "2026-06-20");
    expect(result.baselines.find((e) => e.key === "baseline:Custom Test")!.direction).toBe("decrease");

    // (c) neither — defaults to "increase".
    mockGetDb.mockResolvedValue(mkScopedDb({
      goal: { findMany: vi.fn().mockResolvedValue([]) },
      baseline: {
        findMany: vi.fn().mockResolvedValue([
          { testName: "Totally Novel Test", units: "reps", value: 12, date: new Date("2026-06-15") },
        ]),
        count: vi.fn().mockResolvedValue(0),
      },
    }));
    result = await computeComparison("2026-03-01", "2026-06-20");
    expect(result.baselines.find((e) => e.key === "baseline:Totally Novel Test")!.direction).toBe("increase");
  });

  it("empty DB: no throw, hasAnyDataA false, levelA/levelB null, xpEarned 0", async () => {
    mockGetDb.mockResolvedValue(mkScopedDb());
    mockComputeReadiness.mockReset();
    mockComputeGameState.mockResolvedValue(EMPTY_GAME_STATE_FIXTURE);
    mockFindManyWorkoutExercise.mockResolvedValue([]);

    const result = await computeComparison("2026-03-01", "2026-06-20");

    expect(result.hasAnyDataA).toBe(false);
    expect(result.counters.between.levelA).toBeNull();
    expect(result.counters.between.levelB).toBeNull();
    expect(result.counters.between.xpEarned).toBe(0);
  });

  it("nutrition TZ bucketing: 00:30 UTC row lands on the prior Denver day", async () => {
    // 2026-06-15T00:30:00.000Z is 2026-06-14 18:30 America/Denver (MDT, UTC-6).
    mockGetDb.mockResolvedValue(mkScopedDb({
      nutritionLog: {
        findMany: vi.fn().mockResolvedValue([
          { date: new Date("2026-06-15T00:30:00.000Z"), calories: 2000, proteinG: 150, carbsG: 180, fatG: 60 },
        ]),
      },
    }));
    mockComputeReadiness.mockReset();
    mockComputeGameState.mockResolvedValue(EMPTY_GAME_STATE_FIXTURE);
    mockFindManyWorkoutExercise.mockResolvedValue([]);

    // dateB = 2026-06-14 → trailing 7-day window [06-08 .. 06-14] should
    // capture the 00:30Z row (bucketed to 06-14, the prior Denver day).
    const result = await computeComparison("2026-01-01", "2026-06-14");
    expect(result.nutrition.daysLoggedB).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// #298: goal-list ordering — Program-membership-first (multi-goal LIST
// context), legacy focus-lift for zero-Program tenants. The R9 exemption and
// achieved-after-active tiebreak are untouched: status desc still orders
// within tiers (it now comes purely from the DB orderBy + stable sort).
// ─────────────────────────────────────────────────────────────────────────

describe("computeComparison — #298 membership-first goal ordering", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockGetRotationOwnerGoal = getRotationOwnerGoal as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockGetMembership = getActiveProgramMembership as any;

  // No targets → every goal renders the simple readiness:null section, so
  // computeReadiness is never called and section order IS input goal order.
  const goalRow = (id: string, status = "active", completedAt: Date | null = null) => ({
    id,
    objective: id,
    kind: "fitness",
    createdAt: new Date("2026-01-01"),
    targets: [],
    status,
    completedAt,
  });

  const membershipFixture = (ids: string[]) => ({
    id: "prog-1",
    name: "Phase 2A",
    status: "active",
    startedOn: new Date("2026-05-01"),
    endsOn: null,
    notes: null,
    attributionRules: null,
    memberGoals: ids.map((id) => ({ id, objective: id, kind: "fitness", status: "active" })),
  });

  function wire(goals: ReturnType<typeof goalRow>[]) {
    const goalFindMany = vi.fn().mockResolvedValue(goals);
    mockGetDb.mockResolvedValue(mkScopedDb({ goal: { findMany: goalFindMany } }));
    mockComputeGameState.mockResolvedValue(EMPTY_GAME_STATE_FIXTURE);
    mockFindManyWorkoutExercise.mockResolvedValue([]);
    return goalFindMany;
  }

  it("Program tenant: rotation owner first, members next (achieved-after-active preserved within the tier), non-members last — and the DB query carries no focus orderBy", async () => {
    // DB returns [status desc, targetDate] order: actives before achieved.
    const goalFindMany = wire([
      goalRow("g-nonmember"),
      goalRow("g-member-active"),
      goalRow("g-owner"),
      goalRow("g-member-achieved", "achieved", new Date("2026-07-01")),
    ]);
    mockGetRotationOwnerGoal.mockResolvedValue({
      mode: "program",
      goalId: "g-owner",
      goalKind: "fitness",
      planId: "plan-rot",
    });
    mockGetMembership.mockResolvedValue(
      membershipFixture(["g-member-active", "g-owner", "g-member-achieved"]),
    );

    const result = await computeComparison("2026-06-01", "2026-08-01");

    expect(result.goals.map((g) => g.goalId)).toEqual([
      "g-owner",
      "g-member-active", // members keep incoming (status desc) order
      "g-member-achieved",
      "g-nonmember",
    ]);
    expect(goalFindMany).toHaveBeenCalledWith({
      where: { OR: [{ active: true }, { status: "achieved" }] },
      orderBy: [{ status: "desc" }, { targetDate: { sort: "asc", nulls: "last" } }],
    });
  });

  it("zero-Program tenant: the legacy focus winner is lifted to the front — same order the old focus-desc orderBy produced", async () => {
    wire([goalRow("g-a"), goalRow("g-focus"), goalRow("g-b")]);
    mockGetMembership.mockClear(); // this file has no global clear hook
    mockGetRotationOwnerGoal.mockResolvedValue({
      mode: "legacy",
      goalId: "g-focus",
      goalKind: "fitness",
      planId: null,
    });
    mockGetMembership.mockResolvedValue(null);

    const result = await computeComparison("2026-06-01", "2026-08-01");

    expect(result.goals.map((g) => g.goalId)).toEqual(["g-focus", "g-a", "g-b"]);
    // Legacy mode never probes membership.
    expect(mockGetMembership).not.toHaveBeenCalled();
  });

  it("zero-Program tenant with no focus goal: DB order passes through untouched (byte-identical no-focus shape)", async () => {
    wire([goalRow("g-a"), goalRow("g-b")]);
    mockGetRotationOwnerGoal.mockResolvedValue({
      mode: "legacy",
      goalId: null,
      goalKind: null,
      planId: null,
    });

    const result = await computeComparison("2026-06-01", "2026-08-01");

    expect(result.goals.map((g) => g.goalId)).toEqual(["g-a", "g-b"]);
  });
});
