// src/lib/readiness.test.ts
// Unit tests for progressFor and computeReadiness — story #82.
// All cases are deterministic: progressFor is pure; computeReadiness cases
// mock resolveMetricValue / resolveMetricStart so no DB is touched.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GoalTarget } from "@/lib/metrics-registry";

// vi.mock is hoisted above imports by Vitest — the DB stub prevents the
// "DATABASE_URL is not set" throw that readiness.ts would trigger via
// its `import { prisma } from "@/lib/db"`.
// prisma.hike is stubbed so the compound prep-gate path (resolveHikePrepGateExtras)
// can be driven per-test; generic gating tests use non-prep metrics and never hit it.
vi.mock("@/lib/db", () => ({
  prisma: { hike: { count: vi.fn(), findFirst: vi.fn() } },
}));

// Replace the Prisma-backed async helpers with controllable vi.fn stubs.
// LOG_METRIC_PREFIX is kept at its real value ("log:") so the routing logic
// inside progressFor (which imports it from this same module) still works.
vi.mock("@/lib/goal-targets", () => ({
  LOG_METRIC_PREFIX: "log:",
  resolveMetricValue: vi.fn(),
  resolveMetricStart: vi.fn(),
}));

import { progressFor, computeReadiness, GATE_CEILING } from "@/lib/readiness";
import { resolveMetricValue, resolveMetricStart } from "@/lib/goal-targets";
import { prisma } from "@/lib/db";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal GoalTarget factory — fills in required non-test-relevant fields. */
function mkTarget(
  overrides: Partial<GoalTarget> & Pick<GoalTarget, "metric" | "direction" | "target">,
): GoalTarget {
  return {
    label: "Test target",
    units: "u",
    weight: 0.5,
    ...overrides,
  };
}

const FIXED_DATE = new Date("2026-06-17T12:00:00Z");
const GOAL_ID = "goal-test-1";

// ── progressFor — build-from-zero (log:*, hike:*, workout:count) ──────────────

describe("progressFor — build-from-zero increase (log:*, hike:*, workout:count)", () => {
  it("log:mrr increase: returns current / target fraction", () => {
    const t = mkTarget({ metric: "log:mrr", direction: "increase", target: 1000 });
    expect(progressFor(t, 500, null)).toBeCloseTo(0.5);
  });

  it("hike:prep_completion increase: returns current / target fraction", () => {
    const t = mkTarget({ metric: "hike:prep_completion", direction: "increase", target: 6 });
    expect(progressFor(t, 3, null)).toBeCloseTo(0.5);
  });

  it("hike:total_elevation_ft increase: returns current / target fraction", () => {
    const t = mkTarget({ metric: "hike:total_elevation_ft", direction: "increase", target: 25000 });
    expect(progressFor(t, 12500, null)).toBeCloseTo(0.5);
  });

  it("workout:count increase: returns current / target fraction", () => {
    const t = mkTarget({ metric: "workout:count", direction: "increase", target: 40 });
    expect(progressFor(t, 20, null)).toBeCloseTo(0.5);
  });

  it("target===0 returns null (avoids divide-by-zero)", () => {
    const t = mkTarget({ metric: "log:mrr", direction: "increase", target: 0 });
    expect(progressFor(t, 5, null)).toBeNull();
  });

  it("current > target clamps to 1 (overcap)", () => {
    const t = mkTarget({ metric: "workout:count", direction: "increase", target: 10 });
    expect(progressFor(t, 15, null)).toBe(1);
  });
});

// ── progressFor — already-met shortcuts ──────────────────────────────────────

describe("progressFor — already-met shortcuts", () => {
  it("increase non-build-from-zero: current >= target → 1 regardless of start", () => {
    const t = mkTarget({ metric: "baseline:Pull-Up Max Reps", direction: "increase", target: 10 });
    expect(progressFor(t, 12, 5)).toBe(1); // past target
    expect(progressFor(t, 10, 5)).toBe(1); // exact match
  });

  it("decrease: current <= target → 1", () => {
    const t = mkTarget({ metric: "weightLb", direction: "decrease", target: 155 });
    expect(progressFor(t, 154, 159)).toBe(1); // under target
    expect(progressFor(t, 155, 159)).toBe(1); // exact match
  });

  it("decrease: current <= target → 1 even when start is below target (degenerate baseline)", () => {
    // start=153 < target=155: user was already at goal weight at baseline.
    // current=152 also below target. Must still return 1 per AC.
    const t = mkTarget({ metric: "weightLb", direction: "decrease", target: 155 });
    expect(progressFor(t, 152, 153)).toBe(1);
  });
});

// ── progressFor — decrease comparative ───────────────────────────────────────

describe("progressFor — decrease comparative", () => {
  it("returns clamped (start - current) / (start - target)", () => {
    const t = mkTarget({ metric: "weightLb", direction: "decrease", target: 155 });
    // start=170, current=165 → (170-165)/(170-155) = 5/15 ≈ 0.333
    expect(progressFor(t, 165, 170)).toBeCloseTo(1 / 3);
  });

  it("start===target → 0 (no range to measure)", () => {
    const t = mkTarget({ metric: "weightLb", direction: "decrease", target: 155 });
    // start=155===target=155 → early-return 0 before division
    expect(progressFor(t, 160, 155)).toBe(0);
  });

  it("current===null → null (no data recorded)", () => {
    const t = mkTarget({ metric: "weightLb", direction: "decrease", target: 155 });
    expect(progressFor(t, null, 170)).toBeNull();
  });
});

// ── progressFor — increase comparative (baseline metrics) ───────────────────

describe("progressFor — increase comparative (baseline metrics)", () => {
  it("returns clamped (current - start) / (target - start)", () => {
    const t = mkTarget({ metric: "baseline:Pull-Up Max Reps", direction: "increase", target: 10 });
    // start=5, current=7 → (7-5)/(10-5) = 2/5 = 0.4
    expect(progressFor(t, 7, 5)).toBeCloseTo(0.4);
  });

  it("start===target → 0 for increase too (degenerate config)", () => {
    const t = mkTarget({ metric: "baseline:Pull-Up Max Reps", direction: "increase", target: 10 });
    // start=10===target=10 → can never make progress
    expect(progressFor(t, 5, 10)).toBe(0);
  });
});

// ── computeReadiness — gating behavior ───────────────────────────────────────

describe("computeReadiness — gating behavior", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("open gating target (progress < 1): ceiling=80, score=Math.min(rawScore,80)", async () => {
    const targets: GoalTarget[] = [
      mkTarget({ metric: "hike:max_elevation_single", direction: "increase", target: 6, weight: 1, gating: true }),
    ];
    // current=3 → build-from-zero progress = 3/6 = 0.5 → rawScore=50 → score=min(50,80)=50
    vi.mocked(resolveMetricValue).mockResolvedValue(3);
    vi.mocked(resolveMetricStart).mockResolvedValue(0);

    const snap = await computeReadiness(targets, FIXED_DATE, GOAL_ID);

    expect(snap.ceiling).toBe(GATE_CEILING); // 80
    expect(snap.openGateCount).toBe(1);
    expect(snap.gates[0]!.cleared).toBe(false);
    expect(snap.rawScore).toBe(50);
    expect(snap.score).toBe(50); // min(50, 80) = 50
    expect(snap.score).toBe(Math.min(snap.rawScore, GATE_CEILING));
  });

  it("rawScore above ceiling is capped at 80 while gate is open", async () => {
    const targets: GoalTarget[] = [
      mkTarget({ metric: "hike:max_elevation_single", direction: "increase", target: 10, weight: 1, gating: true }),
    ];
    // current=9 → progress=0.9 → rawScore=90; gate not cleared (0.9<1) → cap at 80
    vi.mocked(resolveMetricValue).mockResolvedValue(9);
    vi.mocked(resolveMetricStart).mockResolvedValue(0);

    const snap = await computeReadiness(targets, FIXED_DATE, GOAL_ID);

    expect(snap.rawScore).toBe(90);
    expect(snap.score).toBe(80);
    expect(snap.ceiling).toBe(GATE_CEILING);
  });

  it("all gating targets cleared: ceiling=100, score===rawScore", async () => {
    const targets: GoalTarget[] = [
      mkTarget({ metric: "hike:max_elevation_single", direction: "increase", target: 6, weight: 1, gating: true }),
    ];
    // current=6 → progress = 6/6 = 1.0 → cleared
    vi.mocked(resolveMetricValue).mockResolvedValue(6);
    vi.mocked(resolveMetricStart).mockResolvedValue(0);

    const snap = await computeReadiness(targets, FIXED_DATE, GOAL_ID);

    expect(snap.ceiling).toBe(100);
    expect(snap.openGateCount).toBe(0);
    expect(snap.gates[0]!.cleared).toBe(true);
    expect(snap.score).toBe(snap.rawScore);
    expect(snap.score).toBe(100);
  });

  it("untested gating target (null current) is not cleared — still forces ceiling=80", async () => {
    const targets: GoalTarget[] = [
      mkTarget({ metric: "hike:max_elevation_single", direction: "increase", target: 6, weight: 1, gating: true }),
    ];
    vi.mocked(resolveMetricValue).mockResolvedValue(null); // no data yet
    vi.mocked(resolveMetricStart).mockResolvedValue(0);

    const snap = await computeReadiness(targets, FIXED_DATE, GOAL_ID);

    expect(snap.ceiling).toBe(GATE_CEILING);
    expect(snap.openGateCount).toBe(1);
    expect(snap.gates[0]!.cleared).toBe(false);
    expect(snap.gates[0]!.progress).toBeNull();
  });
});

// ── computeReadiness — compound hike prep gate (summitFt / pack sub-conditions) ─

describe("computeReadiness — compound hike prep gate", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const prepTarget = (): GoalTarget[] => [
    mkTarget({ metric: "hike:prep_completion", direction: "increase", target: 6, weight: 1, gating: true }),
  ];

  it("attaches subConditions { qualifyingCount, packHikes, above12k } to the prep gate", async () => {
    vi.mocked(resolveMetricValue).mockResolvedValue(3); // 3/6 qualifying
    vi.mocked(resolveMetricStart).mockResolvedValue(0);
    vi.mocked(prisma.hike.count).mockResolvedValue(1);        // 1 pack hike
    vi.mocked(prisma.hike.findFirst).mockResolvedValue({ id: "h1" } as never); // a 12k+ hike exists

    const snap = await computeReadiness(prepTarget(), FIXED_DATE, GOAL_ID);

    expect(snap.gates[0]!.subConditions).toEqual({
      qualifyingCount: { have: 3, need: 6 },
      packHikes: { have: 1, need: 2 },
      above12k: { have: true },
    });
  });

  it("does NOT clear while pack/12k unmet even when qualifyingCount ≥ need (full progress bar)", async () => {
    vi.mocked(resolveMetricValue).mockResolvedValue(6); // 6/6 → progress 1.0
    vi.mocked(resolveMetricStart).mockResolvedValue(0);
    vi.mocked(prisma.hike.count).mockResolvedValue(0);        // 0 pack hikes
    vi.mocked(prisma.hike.findFirst).mockResolvedValue(null); // no 12k hike

    const snap = await computeReadiness(prepTarget(), FIXED_DATE, GOAL_ID);

    expect(snap.gates[0]!.progress).toBe(1);      // bar is full…
    expect(snap.gates[0]!.cleared).toBe(false);   // …but gate stays closed
    expect(snap.ceiling).toBe(GATE_CEILING);      // ceiling still capped
  });

  it("clears only when all three sub-conditions hold", async () => {
    vi.mocked(resolveMetricValue).mockResolvedValue(6); // 6/6 qualifying
    vi.mocked(resolveMetricStart).mockResolvedValue(0);
    vi.mocked(prisma.hike.count).mockResolvedValue(2);        // 2 pack hikes
    vi.mocked(prisma.hike.findFirst).mockResolvedValue({ id: "h1" } as never); // 12k hike exists

    const snap = await computeReadiness(prepTarget(), FIXED_DATE, GOAL_ID);

    expect(snap.gates[0]!.cleared).toBe(true);
    expect(snap.ceiling).toBe(100);
    expect(snap.openGateCount).toBe(0);
  });

  it("above12k reads summitFt via findFirst — false when no qualifying summit", async () => {
    vi.mocked(resolveMetricValue).mockResolvedValue(6);
    vi.mocked(resolveMetricStart).mockResolvedValue(0);
    vi.mocked(prisma.hike.count).mockResolvedValue(5);        // pack OK
    vi.mocked(prisma.hike.findFirst).mockResolvedValue(null); // no summit ≥ 12k

    const snap = await computeReadiness(prepTarget(), FIXED_DATE, GOAL_ID);

    expect(snap.gates[0]!.subConditions!.above12k).toEqual({ have: false });
    expect(snap.gates[0]!.cleared).toBe(false); // blocked solely by above12k
  });
});

// ── computeReadiness — untested targets count as 0, not excluded ─────────────

describe("computeReadiness — untested target counts as 0 in denominator", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("two equal-weight targets, one untested → rawScore=50, not false-100", async () => {
    const targets: GoalTarget[] = [
      mkTarget({ metric: "workout:count", direction: "increase", target: 10, weight: 0.5 }),
      mkTarget({ metric: "baseline:Pull-Up Max Reps", direction: "increase", target: 10, weight: 0.5 }),
    ];
    // workout:count current=10 → build-from-zero progress=1 (100%)
    // Pull-Up Max Reps current=null → progress=null → treated as 0 in scoring
    vi.mocked(resolveMetricValue)
      .mockResolvedValueOnce(10)   // workout:count
      .mockResolvedValueOnce(null); // baseline (untested)
    vi.mocked(resolveMetricStart).mockResolvedValue(null);

    const snap = await computeReadiness(targets, FIXED_DATE, GOAL_ID);

    // rawScore = Math.round((0.5*1 + 0.5*0) / 1.0 * 100) = 50
    expect(snap.rawScore).toBe(50);
    expect(snap.score).toBe(50);
    expect(snap.score).not.toBe(100); // honesty: untested pulls score down
  });
});

// ── computeReadiness — coverage and missing ───────────────────────────────────

describe("computeReadiness — coverage and missing", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("coverage.tested counts rows with progress!==null; missing[] lists untested targets", async () => {
    const targets: GoalTarget[] = [
      mkTarget({ metric: "workout:count", direction: "increase", target: 10, weight: 0.5 }),
      mkTarget({ metric: "baseline:Pull-Up Max Reps", direction: "increase", target: 10, weight: 0.5 }),
    ];
    vi.mocked(resolveMetricValue)
      .mockResolvedValueOnce(5)    // workout:count → progress=0.5 (tested)
      .mockResolvedValueOnce(null); // baseline → progress=null (untested)
    vi.mocked(resolveMetricStart).mockResolvedValue(null);

    const snap = await computeReadiness(targets, FIXED_DATE, GOAL_ID);

    expect(snap.coverage).toEqual({ tested: 1, total: 2 });
    expect(snap.missing).toHaveLength(1);
    expect(snap.missing[0]!.metric).toBe("baseline:Pull-Up Max Reps");
  });

  it("all targets tested → coverage.tested===total, missing is empty", async () => {
    const targets: GoalTarget[] = [
      mkTarget({ metric: "workout:count", direction: "increase", target: 10, weight: 0.5 }),
      mkTarget({ metric: "hike:prep_completion", direction: "increase", target: 6, weight: 0.5 }),
    ];
    vi.mocked(resolveMetricValue).mockResolvedValue(5); // both get 5
    vi.mocked(resolveMetricStart).mockResolvedValue(0);

    const snap = await computeReadiness(targets, FIXED_DATE, GOAL_ID);

    expect(snap.coverage.tested).toBe(2);
    expect(snap.coverage.total).toBe(2);
    expect(snap.missing).toHaveLength(0);
  });

  it("openGateCount: two gating targets, one cleared → openGateCount=1", async () => {
    const targets: GoalTarget[] = [
      mkTarget({ metric: "hike:total_elevation_ft", direction: "increase", target: 6, weight: 0.5, gating: true }),
      mkTarget({ metric: "hike:max_elevation_single", direction: "increase", target: 4000, weight: 0.5, gating: true }),
    ];
    vi.mocked(resolveMetricValue)
      .mockResolvedValueOnce(6)    // total_elevation=6/6=1 → cleared
      .mockResolvedValueOnce(2000); // max_elevation=2000/4000=0.5 → not cleared
    vi.mocked(resolveMetricStart).mockResolvedValue(0);

    const snap = await computeReadiness(targets, FIXED_DATE, GOAL_ID);

    expect(snap.openGateCount).toBe(1);
    expect(snap.gates).toHaveLength(2);
    expect(snap.gates[0]!.cleared).toBe(true);
    expect(snap.gates[1]!.cleared).toBe(false);
  });
});

// ── computeReadiness — edge cases ────────────────────────────────────────────

describe("computeReadiness — edge cases", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("totalWeight===0 returns score:0 rawScore:0 without NaN", async () => {
    const targets: GoalTarget[] = [
      mkTarget({ metric: "workout:count", direction: "increase", target: 10, weight: 0 }),
    ];
    vi.mocked(resolveMetricValue).mockResolvedValue(5);
    vi.mocked(resolveMetricStart).mockResolvedValue(0);

    const snap = await computeReadiness(targets, FIXED_DATE, GOAL_ID);

    expect(snap.score).toBe(0);
    expect(snap.rawScore).toBe(0);
    expect(Number.isNaN(snap.score)).toBe(false);
    expect(Number.isNaN(snap.rawScore)).toBe(false);
  });

  it("empty targets array → score:0 rawScore:0 coverage:{0,0} no gates", async () => {
    const snap = await computeReadiness([], FIXED_DATE, GOAL_ID);

    expect(snap.score).toBe(0);
    expect(snap.rawScore).toBe(0);
    expect(snap.coverage).toEqual({ tested: 0, total: 0 });
    expect(snap.gates).toHaveLength(0);
    expect(snap.openGateCount).toBe(0);
    expect(snap.missing).toHaveLength(0);
    expect(snap.ceiling).toBe(100); // no gating targets → ceiling never capped
  });

  it("non-gating fully-met target: ceiling stays 100", async () => {
    const targets: GoalTarget[] = [
      mkTarget({ metric: "workout:count", direction: "increase", target: 10, weight: 1 }),
    ];
    vi.mocked(resolveMetricValue).mockResolvedValue(10);
    vi.mocked(resolveMetricStart).mockResolvedValue(0);

    const snap = await computeReadiness(targets, FIXED_DATE, GOAL_ID);

    expect(snap.ceiling).toBe(100);
    expect(snap.score).toBe(100);
    expect(snap.rawScore).toBe(100);
  });
});
