// src/lib/reach-tier.test.ts
//
// getReachTier — the narrowed Reach read behind the Today chip (today-page-ia
// UXR-TIA-15, delegate-approved). Proves the three cost claims and, most
// importantly, that narrowing NEVER changes a tier value:
//   1. coach override → zero queries, coach tier (effectiveTier semantics);
//   2. someday / no-targets → zero queries, unrated;
//   3. engine path → rolling:* fallbacks batched into ONE workout scan, with
//      the tier byte-identical to a full computeGoalFeasibility run.
//
// Mock pattern mirrors cumulative-routing.test.ts (hoisted vi.mock, getDb →
// prisma spies).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    logEntry: { findMany: vi.fn(), aggregate: vi.fn() },
    measurement: { findMany: vi.fn() },
    baseline: { findMany: vi.fn() },
    workout: { count: vi.fn(), findMany: vi.fn() },
  },
  getDb: vi.fn(),
}));

vi.mock("@/lib/goal-targets", () => ({
  LOG_METRIC_PREFIX: "log:",
  resolveMetricValue: vi.fn(),
  resolveMetricStart: vi.fn(),
}));

vi.mock("@/lib/records", () => ({
  getExerciseHistory: vi.fn().mockResolvedValue({ history: [] }),
}));

vi.mock("@/lib/goal-events", () => ({ getGoalEventsResult: vi.fn() }));
vi.mock("@/lib/goal-conflicts", () => ({ crossGoalConflicts: vi.fn() }));
vi.mock("@/lib/program", () => ({ getActiveProgram: vi.fn() }));

import { getReachTier, computeGoalFeasibility } from "@/lib/rarity";
import { resolveMetricValue } from "@/lib/goal-targets";
import { prisma, getDb } from "@/lib/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetDb = getDb as any;

const NOW = new Date("2026-08-10T12:00:00.000Z");
const TARGET_DATE = new Date("2026-10-19T12:00:00.000Z"); // 10 weeks out

const ROLLING_TARGET = {
  metric: "rolling:hs_wall",
  label: "Wall hold ≥20s sessions",
  units: "sessions",
  direction: "increase",
  target: 5,
  weight: 1,
  rolling: { exercise: "Wall Handstand Hold", minSeconds: 20 },
};

const BASELINE_TARGET = {
  metric: "baseline:Plank",
  label: "Plank",
  units: "sec",
  direction: "increase",
  target: 180,
  start: 60,
  weight: 1,
};

// Two qualifying sessions, one hit (25s ≥ 20; 10s misses) → rolling value 1.
const WORKOUT_ROWS = [
  { exercises: [{ name: "Wall Handstand Hold", sets: [{ durationSec: 25 }] }] },
  { exercises: [{ name: "Wall Handstand Hold", sets: [{ durationSec: 10 }] }] },
];

const BASELINE_ROWS = [
  { date: new Date("2026-07-13T12:00:00.000Z"), value: 90 },
  { date: new Date("2026-07-27T12:00:00.000Z"), value: 100 },
  { date: new Date("2026-08-06T12:00:00.000Z"), value: 110 },
];

const coach = {
  tier: "epic",
  rationale: "coach call",
  assessedAt: "2026-08-01T00:00:00.000Z",
  assessedBy: "coach",
};

beforeEach(() => {
  vi.resetAllMocks();
  mockGetDb.mockResolvedValue(prisma);
  vi.mocked(prisma.baseline.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(BASELINE_ROWS);
  vi.mocked(prisma.workout.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(WORKOUT_ROWS);
});

describe("getReachTier — zero-query short-circuits", () => {
  it("coach override wins with ZERO queries (effectiveTier = coach ?? computed)", async () => {
    const result = await getReachTier(
      {
        id: "g1",
        targetDate: TARGET_DATE,
        targets: [BASELINE_TARGET, ROLLING_TARGET],
        kind: "fitness",
        coachFeasibility: coach,
      },
      { now: NOW },
    );
    expect(result.tier).toBe("epic");
    expect(result.weeksRemaining).toBeCloseTo(10, 5);
    expect(mockGetDb).not.toHaveBeenCalled();
    expect(vi.mocked(resolveMetricValue)).not.toHaveBeenCalled();
  });

  it("someday goal (no coach) → unrated, ZERO queries", async () => {
    const result = await getReachTier(
      { id: "g1", targetDate: null, targets: [BASELINE_TARGET], kind: "fitness", coachFeasibility: null },
      { now: NOW },
    );
    expect(result).toEqual({ tier: null, weeksRemaining: null });
    expect(mockGetDb).not.toHaveBeenCalled();
  });

  it("no parseable targets (no coach) → unrated, ZERO queries, weeks still derived", async () => {
    const result = await getReachTier(
      { id: "g1", targetDate: TARGET_DATE, targets: [], kind: "fitness", coachFeasibility: null },
      { now: NOW },
    );
    expect(result.tier).toBeNull();
    expect(result.weeksRemaining).toBeCloseTo(10, 5);
    expect(mockGetDb).not.toHaveBeenCalled();
  });

  it("coach tier survives on a someday goal (the documented someday-override caveat)", async () => {
    const result = await getReachTier(
      { id: "g1", targetDate: null, targets: [], kind: "fitness", coachFeasibility: coach },
      { now: NOW },
    );
    expect(result).toEqual({ tier: "epic", weeksRemaining: null });
  });
});

describe("getReachTier — engine path with batched rolling fallbacks", () => {
  const goal = {
    id: "g1",
    targetDate: TARGET_DATE,
    targets: [BASELINE_TARGET, ROLLING_TARGET],
    kind: "fitness",
    coachFeasibility: null,
  };

  it("runs ONE shared workout scan and never resolveMetricValue for rolling metrics", async () => {
    await getReachTier(goal, { now: NOW });

    expect(vi.mocked(prisma.workout.findMany)).toHaveBeenCalledTimes(1);
    const rollingCalls = vi
      .mocked(resolveMetricValue)
      .mock.calls.filter(([metric]) => String(metric).startsWith("rolling:"));
    expect(rollingCalls).toEqual([]);
  });

  it("tier is byte-identical to a full computeGoalFeasibility run (narrowing never changes the value)", async () => {
    const narrowed = await getReachTier(goal, { now: NOW });

    // Direct run: the rolling fallback goes through resolveMetricValue, which
    // (per goal-targets.ts' rolling branch) computes 1 for these workouts —
    // the exact value the shared scan computes.
    vi.mocked(resolveMetricValue).mockImplementation(async (metric: string) =>
      metric === "rolling:hs_wall" ? 1 : null,
    );
    const full = await computeGoalFeasibility(
      { id: goal.id, targetDate: goal.targetDate, targets: goal.targets, kind: goal.kind },
      { now: NOW },
    );

    expect(narrowed.tier).toBe(full.tier);
    expect(narrowed.weeksRemaining).toBe(full.weeksRemaining);
    // And the direct run really did take the resolveMetricValue rolling path
    // the narrowed run skipped.
    expect(
      vi.mocked(resolveMetricValue).mock.calls.some(([m]) => m === "rolling:hs_wall"),
    ).toBe(true);
  });
});
