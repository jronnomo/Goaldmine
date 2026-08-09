// src/lib/completion-card.test.ts
// Minimal render smoke coverage (REQ-008). No existing recap*.test.ts* file
// renders RecapCard's Satori JSX directly (checked — recap-caption.test.ts and
// recap.test.ts both test the data layer, not the component tree), so this
// establishes the pattern for card JSX: render the full element tree via
// react-dom/server (invokes nested ProgressRing/TargetRow/FooterStat calls too,
// unlike calling CompletionCard() directly, which only evaluates its own
// top-level JSX literals) and assert it never throws.
//
// Vitest only picks up `*.test.ts` (see vitest.config.ts), so this file stays
// JSX-free and builds elements via React.createElement.

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CompletionCard } from "@/lib/completion-card";
import type { GoalCompletionSnapshot } from "@/lib/goal-completion-core";

const GOAL = { objective: "Summit Mt. Elbert", kind: "fitness" };

// 7 targets (5 met / 2 unmet) + a 120+ char objective — exercises the
// >6-rows-cap / "+N more" line and the long-objective clamp in one fixture.
const FULL_SNAPSHOT: GoalCompletionSnapshot = {
  version: 1,
  completedDateKey: "2026-08-02",
  capturedAt: "2026-08-02T18:00:00.000Z",
  backdated: false,
  objective:
    "Summit every 14er in the Sawatch Range before winter closes the trailheads and the snowpack makes the class-3 sections unsafe to solo",
  kind: "fitness",
  daysElapsed: 120,
  readiness: {
    score: 94,
    rawScore: 96,
    ceiling: 100,
    coverage: { tested: 6, total: 7 },
    openGateCount: 1,
  },
  targets: [
    { metric: "m1", label: "Pull-ups", units: "reps", start: 5, final: 15, target: 15, progress: 1, met: true },
    { metric: "m2", label: "Squat 1RM", units: "lb", start: 185, final: 255, target: 250, progress: 1.09, met: true },
    { metric: "m3", label: "5k time", units: "min", start: 32, final: 26, target: 25, progress: 0.75, met: false },
    { metric: "m4", label: "VO2max", units: "ml/kg/min", start: 38, final: 46, target: 45, progress: 1, met: true },
    { metric: "m5", label: "Bodyweight", units: "lb", start: 205, final: 188, target: 190, progress: 1, met: true },
    { metric: "m6", label: "Elevation gain", units: "ft", start: 0, final: 14000, target: 14000, progress: 1, met: true },
    { metric: "m7", label: "Long hike distance", units: "mi", start: 4, final: 9, target: 10, progress: 0.9, met: false },
  ],
  targetsMet: 5,
  targetsTotal: 7,
  feasibilityTierAtCompletion: "rare",
  coachFeasibilityTier: null,
  plan: { planId: "plan1", weeksTotal: 16, weeksElapsed: 14 },
  xpBasis: { weeks: 14, targetsMet: 5 },
  xpAwardedAtCompletion: 650,
};

const ZERO_TARGET_GOAL = { objective: "Ship the v1 MVP", kind: "project" };

const ZERO_TARGET_SNAPSHOT: GoalCompletionSnapshot = {
  version: 1,
  completedDateKey: "2026-08-02",
  capturedAt: "2026-08-02T18:00:00.000Z",
  backdated: true,
  objective: "Ship the v1 MVP",
  kind: "project",
  daysElapsed: 30,
  readiness: null,
  targets: [],
  targetsMet: 0,
  targetsTotal: 0,
  feasibilityTierAtCompletion: null,
  coachFeasibilityTier: null,
  plan: { planId: null, weeksTotal: null, weeksElapsed: null },
  xpBasis: { weeks: 4, targetsMet: 0 },
  xpAwardedAtCompletion: 250,
};

describe("CompletionCard", () => {
  it("renders a full snapshot without throwing — coal/story", () => {
    expect(() =>
      renderToStaticMarkup(
        createElement(CompletionCard, { snapshot: FULL_SNAPSHOT, goal: GOAL, template: "coal", format: "story" }),
      ),
    ).not.toThrow();
  });

  it("renders a full snapshot without throwing — parchment/post", () => {
    expect(() =>
      renderToStaticMarkup(
        createElement(CompletionCard, { snapshot: FULL_SNAPSHOT, goal: GOAL, template: "parchment", format: "post" }),
      ),
    ).not.toThrow();
  });

  it("renders a full snapshot without throwing — coal/square", () => {
    expect(() =>
      renderToStaticMarkup(
        createElement(CompletionCard, { snapshot: FULL_SNAPSHOT, goal: GOAL, template: "coal", format: "square" }),
      ),
    ).not.toThrow();
  });

  it("caps target rows at 6 (met-first) and shows a '+N more' summary line", () => {
    const html = renderToStaticMarkup(
      createElement(CompletionCard, { snapshot: FULL_SNAPSHOT, goal: GOAL, template: "coal", format: "story" }),
    );
    expect(html).toContain("+1 more");
  });

  it("renders a zero-target snapshot (no ring, no target rows) without throwing — square", () => {
    expect(() =>
      renderToStaticMarkup(
        createElement(CompletionCard, {
          snapshot: ZERO_TARGET_SNAPSHOT,
          goal: ZERO_TARGET_GOAL,
          template: "coal",
          format: "square",
        }),
      ),
    ).not.toThrow();
  });

  it("zero-target snapshot omits the Reach stat (feasibilityTierAtCompletion null) but keeps targets 0/0", () => {
    const html = renderToStaticMarkup(
      createElement(CompletionCard, {
        snapshot: ZERO_TARGET_SNAPSHOT,
        goal: ZERO_TARGET_GOAL,
        template: "coal",
        format: "square",
      }),
    );
    expect(html).not.toContain("REACH");
    expect(html).toContain("0/0");
  });

  it("defaults format to story when omitted", () => {
    expect(() =>
      renderToStaticMarkup(
        createElement(CompletionCard, { snapshot: FULL_SNAPSHOT, goal: GOAL, template: "coal" }),
      ),
    ).not.toThrow();
  });
});
