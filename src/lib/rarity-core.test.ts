// src/lib/rarity-core.test.ts
//
// Unit tests for computeTargetFeasibility — story #83.
// Pure function: no DB, no mocking required.
// Conventions mirror food-units.test.ts / legend.test.ts.

import { describe, it, expect } from "vitest";
import {
  computeTargetFeasibility,
  FITNESS_NORM_PACK,
  RARITY_RULES,
} from "@/lib/rarity-core";
import type { GoalTarget } from "@/lib/metrics-registry";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** log: metric — normForFamily returns null (observed-only by design). */
const LOG_TARGET: GoalTarget = {
  metric: "log:mrr",
  label: "MRR",
  units: "$",
  direction: "increase",
  target: 1000,
  weight: 0.5,
};

/** weightLb — has a real norm (weightLossLbPerWeek). Direction: decrease. */
const WEIGHT_TARGET: GoalTarget = {
  metric: "weightLb",
  label: "Body weight",
  units: "lb",
  direction: "decrease",
  target: 155,
  weight: 0.8,
};

/** exercise: — strength-like family, has a real norm. Direction: increase. */
const EXERCISE_TARGET: GoalTarget = {
  metric: "exercise:Bench Press",
  label: "Bench Press est. 1RM",
  units: "lb",
  direction: "increase",
  target: 200,
  weight: 0.5,
};

// ─── 1. Observed path (log: metric, ≥3 points, positive rate, null norm) ──────
// Verifies: rateBasis 'observed', plausibleRate===observedWeeklyRate, real ratio,
// non-unknown verdict, countsTowardTier true.

describe("observed path — log: metric with observedPoints >= 3 and positive rate", () => {
  it("rateBasis is 'observed', plausibleRate equals observedWeeklyRate, ratio is numeric, verdict is not 'unknown', countsTowardTier true", () => {
    // gap = 1000 - 500 = 500; requiredRate = 500/10 = 50; plausibleRate = 50 (no norm floor); ratio = 1.0
    const r = computeTargetFeasibility({
      target: LOG_TARGET,
      current: 500,
      weeksRemaining: 10,
      observedWeeklyRate: 50,
      observedPoints: 3,
      normPack: FITNESS_NORM_PACK,
    });

    expect(r.rateBasis).toBe("observed");
    expect(r.plausibleRate).toBe(50); // === observedWeeklyRate; no norm to floor against
    expect(r.ratio).not.toBeNull();
    expect(typeof r.ratio).toBe("number");
    expect(r.verdict).not.toBe("unknown");
    expect(r.countsTowardTier).toBe(true);
  });

  it("ratio matches requiredRate / observedWeeklyRate (gap=500, weeks=10, rate=50 → 1.0)", () => {
    const r = computeTargetFeasibility({
      target: LOG_TARGET,
      current: 500,
      weeksRemaining: 10,
      observedWeeklyRate: 50,
      observedPoints: 3,
      normPack: FITNESS_NORM_PACK,
    });

    expect(r.ratio).toBe(1.0);
    expect(r.verdict).toBe("uncommon"); // 1.0 <= uncommon threshold (1.0)
  });

  it("also fires for observedPoints > 3", () => {
    const r = computeTargetFeasibility({
      target: LOG_TARGET,
      current: 200,
      weeksRemaining: 8,
      observedWeeklyRate: 10,
      observedPoints: 6,
      normPack: FITNESS_NORM_PACK,
    });

    expect(r.rateBasis).toBe("observed");
    expect(r.countsTowardTier).toBe(true);
  });
});

// ─── 2. Honest <3-points path ─────────────────────────────────────────────────
// Verifies: observedPoints 0/1/2 with null-norm family →
//   verdict 'unknown', countsTowardTier false, ratio null, rateBasis 'none'.
// Guards minObservedPoints=3 — no false confidence from a 2-point slope.

describe("honest <3-points — null-norm family never claims a verdict", () => {
  const CASES: Array<[number, number | null]> = [
    [0, null],
    [1, 20],  // non-null rate to show the point count is what gates it, not rate nullness
    [2, 50],
  ];

  for (const [pts, rate] of CASES) {
    it(`observedPoints=${pts} → unknown / no ratio / rateBasis none`, () => {
      const r = computeTargetFeasibility({
        target: LOG_TARGET,
        current: 500,
        weeksRemaining: 10,
        observedWeeklyRate: rate,
        observedPoints: pts,
        normPack: FITNESS_NORM_PACK,
      });

      expect(r.verdict).toBe("unknown");
      expect(r.countsTowardTier).toBe(false);
      expect(r.ratio).toBeNull();
      expect(r.rateBasis).toBe("none");
    });
  }
});

// ─── 3. Met-check ─────────────────────────────────────────────────────────────
// Verifies: gap<=0 (current at/past target, both directions) →
//   verdict 'met', ratio 0, requiredRate 0, countsTowardTier true.

describe("met-check — gap <= 0 in both directions", () => {
  it("increase: current exactly at target → met", () => {
    const r = computeTargetFeasibility({
      target: { ...EXERCISE_TARGET, target: 180 },
      current: 180,
      weeksRemaining: 4,
      observedWeeklyRate: null,
      observedPoints: 0,
      normPack: FITNESS_NORM_PACK,
    });

    expect(r.verdict).toBe("met");
    expect(r.ratio).toBe(0);
    expect(r.requiredRate).toBe(0);
    expect(r.countsTowardTier).toBe(true);
  });

  it("increase: current past target → met", () => {
    const r = computeTargetFeasibility({
      target: { ...EXERCISE_TARGET, target: 180 },
      current: 195, // 15 lb above — already exceeded
      weeksRemaining: 4,
      observedWeeklyRate: null,
      observedPoints: 0,
      normPack: FITNESS_NORM_PACK,
    });

    expect(r.verdict).toBe("met");
    expect(r.ratio).toBe(0);
    expect(r.requiredRate).toBe(0);
    expect(r.countsTowardTier).toBe(true);
  });

  it("decrease: current exactly at target → met", () => {
    // WEIGHT_TARGET: direction=decrease, target=155
    const r = computeTargetFeasibility({
      target: WEIGHT_TARGET,
      current: 155,
      weeksRemaining: 8,
      observedWeeklyRate: null,
      observedPoints: 0,
      normPack: FITNESS_NORM_PACK,
    });

    expect(r.verdict).toBe("met");
    expect(r.ratio).toBe(0);
    expect(r.requiredRate).toBe(0);
    expect(r.countsTowardTier).toBe(true);
  });

  it("decrease: current past target (below) → met", () => {
    // gap = current - target = 150 - 155 = -5 → met
    const r = computeTargetFeasibility({
      target: WEIGHT_TARGET,
      current: 150,
      weeksRemaining: 8,
      observedWeeklyRate: null,
      observedPoints: 0,
      normPack: FITNESS_NORM_PACK,
    });

    expect(r.verdict).toBe("met");
    expect(r.ratio).toBe(0);
    expect(r.requiredRate).toBe(0);
    expect(r.countsTowardTier).toBe(true);
  });
});

// ─── 4. ratioCap stall ────────────────────────────────────────────────────────
// Verifies: observedPoints>=3 with observedWeeklyRate<=0 and null norm →
//   ratio===ratioCap (99), verdict 'legendary', countsTowardTier true.
// Stalled null-norm metric = effectively impossible → hard cap.

describe("ratioCap stall — log: metric, ≥3 points, rate ≤ 0", () => {
  for (const rate of [0, -5] as const) {
    it(`observedWeeklyRate=${rate} → ratio capped at ${RARITY_RULES.ratioCap}, verdict 'legendary', countsTowardTier true`, () => {
      const r = computeTargetFeasibility({
        target: LOG_TARGET,
        current: 500,
        weeksRemaining: 10,
        observedWeeklyRate: rate,
        observedPoints: 3,
        normPack: FITNESS_NORM_PACK,
      });

      expect(r.ratio).toBe(RARITY_RULES.ratioCap);   // 99
      expect(r.verdict).toBe("legendary");
      expect(r.countsTowardTier).toBe(true);
    });
  }
});

// ─── 5. Decrease-sign normalization ──────────────────────────────────────────
// Verifies: pre-normalized positive observedWeeklyRate for a decrease metric is
// treated as improving (real ratio, not regression).
// Documents the caller's negate convention: rarity.ts negates the raw slope
// before calling this function so that positive always means "toward the goal."

describe("decrease-sign normalization — caller must negate raw slope before passing", () => {
  it("pre-normalized positive rate for weightLb (decrease) → observed path, real ratio, not unknown", () => {
    // Scenario: user is losing 0.5 lb/wk. Raw least-squares slope = -0.5.
    // Caller negates → observedWeeklyRate = +0.5 passed here.
    // gap = 159 - 155 = 4; requiredRate = 4/8 = 0.5
    // plausibleRate = max(0.5, 0.25 * 1.5) = max(0.5, 0.375) = 0.5
    // ratio = 0.5/0.5 = 1.0 → uncommon
    const r = computeTargetFeasibility({
      target: WEIGHT_TARGET,
      current: 159,
      weeksRemaining: 8,
      observedWeeklyRate: 0.5,   // pre-normalized: caller negated the raw -0.5 slope
      observedPoints: 3,
      normPack: FITNESS_NORM_PACK,
    });

    expect(r.rateBasis).toBe("observed");
    expect(r.plausibleRate).toBe(0.5);
    expect(r.ratio).not.toBeNull();
    expect(r.verdict).not.toBe("unknown");
    expect(r.countsTowardTier).toBe(true);
  });

  it("un-normalized negative rate (caller forgot to negate) → regression floor, higher ratio — documents the penalty", () => {
    // If caller passes raw -0.5 without negating, the function sees plateau/regression.
    // norm = 1.5 (weightLossLbPerWeek); plausibleRate = 0.25 * 1.5 = 0.375
    // ratio = 0.5/0.375 ≈ 1.33 → higher than the normalized case (1.0)
    const r = computeTargetFeasibility({
      target: WEIGHT_TARGET,
      current: 159,
      weeksRemaining: 8,
      observedWeeklyRate: -0.5,  // NOT pre-normalized — demonstrates why caller must negate
      observedPoints: 3,
      normPack: FITNESS_NORM_PACK,
    });

    expect(r.rateBasis).toBe("observed");
    expect(r.plausibleRate).toBeCloseTo(0.375); // regressionFloorFactor * norm
    expect(r.ratio).toBeGreaterThan(1.0);       // penalty vs normalized path
    expect(r.countsTowardTier).toBe(true);
  });
});

// ─── 6. Never-measured guard ──────────────────────────────────────────────────
// Verifies: current===null with no explicit target.start →
//   verdict 'unknown', countsTowardTier false, requiredRate null.
// Mirrors readiness 'missing' semantics — no per-week pace promised until
// at least one value is logged.

describe("never-measured guard — current null, no target.start", () => {
  it("verdict 'unknown', countsTowardTier false, requiredRate null, ratio null, rateBasis none", () => {
    const r = computeTargetFeasibility({
      target: LOG_TARGET,  // no .start field
      current: null,
      weeksRemaining: 10,
      observedWeeklyRate: null,
      observedPoints: 0,
      normPack: FITNESS_NORM_PACK,
    });

    expect(r.verdict).toBe("unknown");
    expect(r.countsTowardTier).toBe(false);
    expect(r.requiredRate).toBeNull();
    expect(r.ratio).toBeNull();
    expect(r.rateBasis).toBe("none");
  });

  it("target.start=null also fires the guard (explicit null, not just undefined)", () => {
    const targetWithNullStart: GoalTarget = { ...LOG_TARGET, start: undefined };
    const r = computeTargetFeasibility({
      target: targetWithNullStart,
      current: null,
      weeksRemaining: 10,
      observedWeeklyRate: null,
      observedPoints: 0,
      normPack: FITNESS_NORM_PACK,
    });

    expect(r.verdict).toBe("unknown");
    expect(r.countsTowardTier).toBe(false);
    expect(r.requiredRate).toBeNull();
  });

  it("target.start set → guard skips, function proceeds to compute from start value", () => {
    // With target.start=500, effectiveCurrent=500; gap=500; function does NOT return unknown early.
    // observedPoints<3, norm=null (log:) → falls through to final unknown path (not the guard).
    const r = computeTargetFeasibility({
      target: { ...LOG_TARGET, start: 500 },
      current: null,
      weeksRemaining: 10,
      observedWeeklyRate: null,
      observedPoints: 0,
      normPack: FITNESS_NORM_PACK,
    });

    // Still unknown (no norm, not enough points), BUT requiredRate IS computed
    // from the start fallback — documents that start acts as the current anchor.
    expect(r.verdict).toBe("unknown");
    expect(r.requiredRate).not.toBeNull(); // gap/weeksRemaining is defined
    expect(r.requiredRate).toBeCloseTo(50); // (1000-500)/10
  });
});
