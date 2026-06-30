// src/components/FeasibilityReadout.test.ts
// Fixture-based render proof for FeasibilityReadout (#77).
// Uses createElement (no JSX) + renderToStaticMarkup (no DOM needed) — node env.
// Vitest include: src/**/*.test.ts — this file is discovered correctly.
// No vi.mock needed: FeasibilityReadout imports only type-only + fmtComma (pure).

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FeasibilityReadout } from "@/components/FeasibilityReadout";
import type { GoalFeasibility, TargetFeasibility, CoachFeasibility } from "@/lib/rarity-core";

// ── Shared perTarget stubs ────────────────────────────────────────────────────

const UNKNOWN_TARGET: TargetFeasibility = {
  metric: "log:mrr",
  label: "MRR",
  weight: 0.6,
  requiredRate: null,
  observedRate: null,
  plausibleRate: null,
  rateBasis: "none",
  ratio: null,
  verdict: "unknown",
  countsTowardTier: false,
  gating: false,
  currentValue: null,
};

const MILESTONES_UNKNOWN: TargetFeasibility = {
  metric: "log:milestones_done",
  label: "Milestones",
  weight: 0.4,
  requiredRate: null,
  observedRate: null,
  plausibleRate: null,
  rateBasis: "none",
  ratio: null,
  verdict: "unknown",
  countsTowardTier: false,
  gating: false,
  currentValue: null,
};

// W-1 fix: non-met rated target with tier:"rare" — requiredRate + observedRate both non-null
const RARE_TARGET: TargetFeasibility = {
  metric: "log:mrr",
  label: "MRR",
  weight: 1,
  requiredRate: 66,
  observedRate: 20,
  plausibleRate: 30,
  rateBasis: "observed",
  ratio: 3.3,
  verdict: "rare",
  countsTowardTier: true,
  gating: false,
  currentValue: 350,
};

// ── Fixture A: Live Chewgether shape — 0 logs, no-data ───────────────────────
// requiredRate: null on all perTarget → sub-state 3a (0-log)
const FIXTURE_NO_DATA_0_LOG: GoalFeasibility = {
  goalId: "chewgether-goal-1",
  tier: null,
  unratedReason: "no-data",
  ratio: null,
  perTarget: [UNKNOWN_TARGET, MILESTONES_UNKNOWN],
  basis: null,
  weeksRemaining: 15,
  computedAt: "2026-06-17T00:00:00.000Z",
};

// ── Fixture B: ≥3-log tier "rare" ────────────────────────────────────────────
// W-1 fix: tier:"rare" with a non-met rated target (requiredRate + observedRate non-null)
const FIXTURE_RARE_TIER: GoalFeasibility = {
  goalId: "chewgether-goal-1",
  tier: "rare",
  unratedReason: null,
  ratio: 3.3,
  perTarget: [RARE_TARGET],
  basis: "observed",
  weeksRemaining: 12,
  computedAt: "2026-06-17T00:00:00.000Z",
};

// ─────────────────────────────────────────────────────────────────────────────

describe("FeasibilityReadout", () => {
  // Case 1: 0-log no-data — honest copy, no /wk promise, no dangling separator (C-1)
  it("0-log no-data: renders honest copy, no /wk promise, no dangling separator", () => {
    const html = renderToStaticMarkup(
      createElement(FeasibilityReadout, { feasibility: FIXTURE_NO_DATA_0_LOG }),
    );
    expect(html).toContain("Not enough logged data");
    expect(html).not.toContain("/wk");
    expect(html).not.toContain("— · —");
  });

  // Case 2: someday state
  it("someday: renders no-deadline copy", () => {
    const someday: GoalFeasibility = {
      ...FIXTURE_NO_DATA_0_LOG,
      unratedReason: "someday",
      perTarget: [],
      weeksRemaining: null,
    };
    const html = renderToStaticMarkup(
      createElement(FeasibilityReadout, { feasibility: someday }),
    );
    expect(html).toContain("No deadline set");
  });

  // Case 3: no-targets state
  it("no-targets: renders add-targets copy", () => {
    const noTargets: GoalFeasibility = {
      ...FIXTURE_NO_DATA_0_LOG,
      unratedReason: "no-targets",
      perTarget: [],
    };
    const html = renderToStaticMarkup(
      createElement(FeasibilityReadout, { feasibility: noTargets }),
    );
    expect(html).toContain("Add targets");
  });

  // Case 4: tier-set (≥3-log, real verdict) — W-1: tier:"rare" + non-met rated target
  it("tier-set: renders tier label and per-week rates, no 0-log copy", () => {
    const html = renderToStaticMarkup(
      createElement(FeasibilityReadout, { feasibility: FIXTURE_RARE_TIER }),
    );
    expect(html).toContain("Rare");
    expect(html).toContain("66"); // fmtComma(66) = "66"
    expect(html).not.toContain("Not enough logged data");
  });

  // Case 5: mixed perTarget (C-1 fix) — tier-set with one rated + one unknown target
  // The unknown target must NOT render "— · —" or a dangling separator
  it("mixed perTarget (C-1): no dangling separator for unknown-verdict target", () => {
    const mixed: GoalFeasibility = {
      ...FIXTURE_RARE_TIER,
      perTarget: [
        RARE_TARGET,
        { ...UNKNOWN_TARGET, metric: "log:milestones_done", label: "Milestones" },
      ],
    };
    const html = renderToStaticMarkup(
      createElement(FeasibilityReadout, { feasibility: mixed }),
    );
    expect(html).not.toContain("— · —");
  });

  // State 3b: 1–2 logs, anyRequired=true, observedRate null
  it("1-2 log: shows required rate, 'not yet estimable' for observed", () => {
    const oneTwoLog: GoalFeasibility = {
      ...FIXTURE_NO_DATA_0_LOG,
      perTarget: [
        {
          ...UNKNOWN_TARGET,
          requiredRate: 67,
          currentValue: 200,
          // observedRate stays null — slope needs ≥3 points
        },
      ],
    };
    const html = renderToStaticMarkup(
      createElement(FeasibilityReadout, { feasibility: oneTwoLog }),
    );
    expect(html).toContain("not yet estimable");
    expect(html).toContain("67");
    expect(html).not.toContain("Not enough logged data");
  });

  // targetDateLabel integration
  it("tier-set + targetDateLabel: 'by Sep 30, 2026' appears in rate copy", () => {
    const html = renderToStaticMarkup(
      createElement(FeasibilityReadout, {
        feasibility: FIXTURE_RARE_TIER,
        targetDateLabel: "Sep 30, 2026",
      }),
    );
    expect(html).toContain("by Sep 30, 2026");
  });

  // W-1 fix: met verdict uses tier:"common" (all-met targets aggregate to common, not rare)
  it("met verdict: shows 'Target met', skips rate copy", () => {
    const withMet: GoalFeasibility = {
      ...FIXTURE_RARE_TIER,
      tier: "common", // W-1 fix: all-met → engine produces "common", not "rare"
      perTarget: [
        {
          ...RARE_TARGET,
          requiredRate: 0,
          observedRate: 80,
          verdict: "met",
          countsTowardTier: true,
          currentValue: 1000,
        },
      ],
    };
    const html = renderToStaticMarkup(
      createElement(FeasibilityReadout, { feasibility: withMet }),
    );
    expect(html).toContain("Target met");
    expect(html).not.toContain("needs ~");
  });

  // Grep-clean guard: component renders no hardcoded vertical strings
  it("renders no hardcoded vertical strings (Elbert/Chewgether/fitness)", () => {
    const html1 = renderToStaticMarkup(
      createElement(FeasibilityReadout, { feasibility: FIXTURE_NO_DATA_0_LOG }),
    );
    const html2 = renderToStaticMarkup(
      createElement(FeasibilityReadout, { feasibility: FIXTURE_RARE_TIER }),
    );
    for (const html of [html1, html2]) {
      expect(html).not.toContain("Elbert");
      expect(html).not.toContain("Chewgether");
      expect(html).not.toContain("fitness");
    }
  });

  // ── effectiveTier / coach override cases (REQ-003) ───────────────────────────

  // Coach fixtures
  const COACH_EPIC: CoachFeasibility = {
    tier: "epic",
    rationale: "High-effort goal with strong execution track record.",
    assessedAt: "2026-06-29T00:00:00.000Z",
    assessedBy: "coach",
  };
  const COACH_RARE: CoachFeasibility = {
    tier: "rare",
    rationale: "Matches engine estimate.",
    assessedAt: "2026-06-29T00:00:00.000Z",
    assessedBy: "coach",
  };
  const COACH_UNCOMMON: CoachFeasibility = {
    tier: "uncommon",
    rationale: "Doable with consistent work.",
    assessedAt: "2026-06-29T00:00:00.000Z",
    assessedBy: "coach",
  };

  // B1-Case-1: computed=rare, coach=epic → headline "Epic" + affordance "engine: Rare"
  it("B1-Case-1: coach override (rare→epic) → headline Epic + engine affordance", () => {
    const html = renderToStaticMarkup(
      createElement(FeasibilityReadout, {
        feasibility: FIXTURE_RARE_TIER,
        coach: COACH_EPIC,
      }),
    );
    expect(html).toContain("Epic");
    expect(html).toContain("engine: Rare");
  });

  // B1-Case-2: computed=rare, no coach → "Rare", no "engine:" affordance
  it("B1-Case-2: no coach override → headline Rare, no engine affordance", () => {
    const html = renderToStaticMarkup(
      createElement(FeasibilityReadout, {
        feasibility: FIXTURE_RARE_TIER,
        coach: null,
      }),
    );
    expect(html).toContain("Rare");
    expect(html).not.toContain("engine:");
  });

  // B1-Case-3: computed=rare, coach=rare → "Rare", no affordance (no redundancy)
  it("B1-Case-3: coach.tier === computed tier → no engine affordance", () => {
    const html = renderToStaticMarkup(
      createElement(FeasibilityReadout, {
        feasibility: FIXTURE_RARE_TIER,
        coach: COACH_RARE,
      }),
    );
    expect(html).toContain("Rare");
    expect(html).not.toContain("engine:");
    expect(html).not.toContain("coach call");
  });

  // B1-Case-4: computed unrated (no-data, tier null), coach=uncommon → "Uncommon" + "coach call"
  it("B1-Case-4: unrated no-data + coach override → Uncommon + coach call affordance", () => {
    const html = renderToStaticMarkup(
      createElement(FeasibilityReadout, {
        feasibility: FIXTURE_NO_DATA_0_LOG,
        coach: COACH_UNCOMMON,
      }),
    );
    expect(html).toContain("Uncommon");
    expect(html).toContain("coach call");
    expect(html).not.toContain("Not enough logged data");
  });

  // B1-Case-5: computed unrated (no-data), no coach → unchanged no-data messaging
  it("B1-Case-5: unrated no-data, no coach → unchanged no-data copy, no tier headline", () => {
    const html = renderToStaticMarkup(
      createElement(FeasibilityReadout, {
        feasibility: FIXTURE_NO_DATA_0_LOG,
        coach: null,
      }),
    );
    expect(html).toContain("Not enough logged data");
    expect(html).not.toContain("Uncommon");
    expect(html).not.toContain("Rare");
    expect(html).not.toContain("engine:");
    expect(html).not.toContain("coach call");
  });
});
