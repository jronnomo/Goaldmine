// src/lib/cumulative-routing.test.ts
//
// REQ-004 (blueprint v2 D3) — Tests for observedSeriesFor cumulative routing.
//
// PRIMARY TEST: "cumulative=true routes to weekly-snapshot loop" FAILS on the
// unmodified code (per-entry branch yields slope ≈ 0) and PASSES after the fix
// (weekly-snapshot branch yields slope ≈ 10).
//
// Pattern mirrors readiness.test.ts / rarity-core.test.ts:
// vi.mock is hoisted; only mock what observedSeriesFor actually needs.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (hoisted by Vitest) ────────────────────────────────────────────────

// Prevent any real DB connection — prisma is used by the snapshot log: branch
// (findMany) and any other path we might accidentally hit.
vi.mock("@/lib/db", () => ({
  prisma: {
    logEntry: { findMany: vi.fn(), aggregate: vi.fn() },
    measurement: { findMany: vi.fn() },
    baseline: { findMany: vi.fn() },
    hike: { count: vi.fn(), aggregate: vi.fn() },
    workout: { count: vi.fn() },
  },
}));

// Replace resolveMetricValue with a controllable stub so we can feed
// deterministic cumulative totals to the weekly-snapshot loop.
vi.mock("@/lib/goal-targets", () => ({
  LOG_METRIC_PREFIX: "log:",
  resolveMetricValue: vi.fn(),
  resolveMetricStart: vi.fn(),
}));

// Silence the exercise: branch (unused in these tests)
vi.mock("@/lib/records", () => ({
  getExerciseHistory: vi.fn().mockResolvedValue({ history: [] }),
}));

// rarity.ts also imports these for computeGoalFeasibility / computeStackRarity
// — not exercised here, but must not throw at import time.
vi.mock("@/lib/goal-events", () => ({ getGoalEventsResult: vi.fn() }));
vi.mock("@/lib/goal-conflicts", () => ({ crossGoalConflicts: vi.fn() }));
vi.mock("@/lib/program", () => ({ getActiveProgram: vi.fn() }));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { observedSeriesFor } from "@/lib/rarity";
import { weeklySlope, RARITY_RULES } from "@/lib/rarity-core";
import { resolveMetricValue } from "@/lib/goal-targets";
import { prisma } from "@/lib/db";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const GOAL_ID = "goal-test-a1";
// Use a fixed 5-week window so the weekly-snapshot loop produces exactly 6
// snapshots (w=0 .. w=5), giving ≥ 3 points. With perfectly linear values
// [10,20,30,40,50,60] at integer week offsets, OLS weeklySlope = exactly 10.
const NOW = new Date("2026-06-29T12:00:00.000Z");
const FIVE_WEEKS_AGO = new Date(NOW.getTime() - 5 * 7 * 24 * 60 * 60 * 1000);

// ── PRIMARY TEST (fails before routing fix, passes after) ─────────────────────

describe("observedSeriesFor — cumulative log: routing (PRIMARY — fails before fix)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("cumulative=true: weekly-snapshot loop yields slope ≈ 10, NOT ≈ 0", async () => {
    // 5-week window → loop runs w=0..5 (6 snapshots).
    // Perfectly linear cumulative totals: 10,20,30,40,50,60.
    // OLS over x=[0,1,2,3,4,5], y=[10,20,30,40,50,60] gives slope = exactly 10.
    vi.mocked(resolveMetricValue)
      .mockResolvedValueOnce(10)  // w=0 (since)
      .mockResolvedValueOnce(20)  // w=1
      .mockResolvedValueOnce(30)  // w=2
      .mockResolvedValueOnce(40)  // w=3
      .mockResolvedValueOnce(50)  // w=4
      .mockResolvedValueOnce(60); // w=5 (NOW)

    const { points } = await observedSeriesFor(
      "log:practice_hours",
      GOAL_ID,
      FIVE_WEEKS_AGO,
      NOW,
      true, // cumulative=true → weekly-snapshot branch
    );

    // Must produce enough points for weeklySlope to return non-null
    expect(points.length).toBeGreaterThanOrEqual(RARITY_RULES.minObservedPoints);

    const slope = weeklySlope(points, RARITY_RULES.minObservedPoints);
    expect(slope).not.toBeNull();
    // Slope = 10 hr/week (steady accumulation). Before the fix, the per-entry
    // findMany branch runs instead → 0 rows returned → slope null or 0.
    expect(slope!).toBeGreaterThan(5); // definitively non-zero
    expect(slope!).toBeCloseTo(10, 0); // within 0.5 of 10 — slope ≈ 10 hr/week

    // prisma.logEntry.findMany must NOT have been called (snapshot branch
    // is bypassed when cumulative=true).
    expect(vi.mocked(prisma.logEntry.findMany)).not.toHaveBeenCalled();
  });

  it("cumulative=true: resolveMetricValue is called with cumulative=true (5th arg)", async () => {
    vi.mocked(resolveMetricValue).mockResolvedValue(25);

    await observedSeriesFor("log:practice_hours", GOAL_ID, FIVE_WEEKS_AGO, NOW, true);

    const calls = vi.mocked(resolveMetricValue).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      // 5th argument (index 4) must be true
      expect(call[4]).toBe(true);
    }
  });
});

// ── REGRESSION TEST — snapshot log: path unchanged ────────────────────────────

describe("observedSeriesFor — snapshot log: regression (cumulative=false)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("cumulative=false: uses per-entry findMany; resolveMetricValue NOT called", async () => {
    vi.mocked(prisma.logEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { date: new Date("2026-06-01T00:00:00Z"), value: 1000 },
      { date: new Date("2026-06-15T00:00:00Z"), value: 1050 },
      { date: new Date("2026-06-22T00:00:00Z"), value: 1100 },
    ]);

    const { points, current } = await observedSeriesFor(
      "log:mrr",
      GOAL_ID,
      FIVE_WEEKS_AGO,
      NOW,
      false, // cumulative=false (snapshot — default)
    );

    // Per-entry branch: findMany was called, resolveMetricValue was NOT called
    expect(vi.mocked(prisma.logEntry.findMany)).toHaveBeenCalled();
    expect(vi.mocked(resolveMetricValue)).not.toHaveBeenCalled();
    // Points are raw per-entry rows (snapshot values, not accumulation)
    expect(points).toHaveLength(3);
    expect(current).toBe(1100);
  });

  it("cumulative=false (default omitted): also routes to findMany branch", async () => {
    vi.mocked(prisma.logEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { date: new Date("2026-06-22T00:00:00Z"), value: 500 },
    ]);

    const { points } = await observedSeriesFor(
      "log:milestones_done",
      GOAL_ID,
      FIVE_WEEKS_AGO,
      NOW,
      // cumulative omitted → defaults to false
    );

    expect(vi.mocked(prisma.logEntry.findMany)).toHaveBeenCalled();
    expect(vi.mocked(resolveMetricValue)).not.toHaveBeenCalled();
    expect(points).toHaveLength(1);
  });
});
