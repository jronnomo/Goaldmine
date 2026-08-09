// src/components/BetweenGoalsToday.test.ts
// Fixture-based render proof for BetweenGoalsToday (Today "between goals"
// state), mirroring the established pattern for props-only server-component
// JSX (GoalStorySection.test.ts): render via react-dom/server and assert on
// the resulting markup. No vi.mock needed — the component takes plain data
// props; the one "use server" import it pulls in (setFocusGoal, reused
// verbatim from goal-actions.ts) is only ever bound and passed as a form
// `action`, never invoked, so no DB call happens during render.

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BetweenGoalsToday,
  type BetweenGoalsActiveGoal,
  type BetweenGoalsAchieved,
} from "@/components/BetweenGoalsToday";
import type { GoalCompletionSnapshot } from "@/lib/goal-completion-core";

const SNAPSHOT: GoalCompletionSnapshot = {
  version: 1,
  completedDateKey: "2026-08-05",
  capturedAt: "2026-08-05T18:00:00.000Z",
  backdated: false,
  objective: "Summit Mt. Elbert",
  kind: "fitness",
  daysElapsed: 112,
  readiness: { score: 94, rawScore: 94, ceiling: 100, coverage: { tested: 4, total: 4 }, openGateCount: 0 },
  targets: [
    { metric: "baseline:pullups", label: "Pull-ups", units: "reps", start: 5, final: 15, target: 15, progress: 1, met: true },
  ],
  targetsMet: 1,
  targetsTotal: 1,
  feasibilityTierAtCompletion: "rare",
  coachFeasibilityTier: null,
  plan: { planId: "plan-1", weeksTotal: 16, weeksElapsed: 16 },
  xpBasis: { weeks: 16, targetsMet: 1 },
  xpAwardedAtCompletion: 480,
};

const ACHIEVED: BetweenGoalsAchieved = {
  id: "goal-elbert",
  objective: "Summit Mt. Elbert",
  completedAt: new Date("2026-08-05T18:00:00.000Z"),
  completionSnapshot: SNAPSHOT,
};

const ACTIVE_GOAL: BetweenGoalsActiveGoal = {
  id: "goal-project",
  objective: "Ship Chewgether v1",
  kind: "project",
  targetDate: new Date("2026-12-01T00:00:00.000Z"),
  isFocus: false,
  active: true,
};

describe("BetweenGoalsToday", () => {
  it("completion + active goals: renders the ack card and the focus-picker list", () => {
    const html = renderToStaticMarkup(
      createElement(BetweenGoalsToday, { activeGoals: [ACTIVE_GOAL], latestAchieved: ACHIEVED }),
    );

    // Completion ack card — frozen objective, stats, link to the trophy page.
    expect(html).toContain("Goal completed");
    expect(html).toContain("Summit Mt. Elbert");
    expect(html).toContain("readiness 94/100");
    expect(html).toContain("targets 1/1");
    expect(html).toContain("+480 XP");
    expect(html).toContain('href="/goals/goal-elbert"');
    expect(html).toContain("View the story");

    // Never the newbie "Get started" copy.
    expect(html).not.toContain("Get started");
    expect(html).not.toContain("Welcome to Goaldmine");

    // Choose-next-focus card — active goal row + management links.
    expect(html).toContain("Choose your next focus");
    expect(html).toContain("Ship Chewgether v1");
    expect(html).toContain("Focus");
    expect(html).toContain('href="/goals"');
    expect(html).toContain('href="/goals#new-goal"');
  });

  it("no active goals, only a completion: ack card + single start-next-goal CTA", () => {
    const html = renderToStaticMarkup(
      createElement(BetweenGoalsToday, { activeGoals: [], latestAchieved: ACHIEVED }),
    );

    expect(html).toContain("Goal completed");
    expect(html).toContain("Start your next goal");
    expect(html).not.toContain("Choose your next focus");
  });

  it("active goals but no completion snapshot yet: no ack card, focus list only", () => {
    const html = renderToStaticMarkup(
      createElement(BetweenGoalsToday, { activeGoals: [ACTIVE_GOAL], latestAchieved: null }),
    );

    expect(html).not.toContain("Goal completed");
    expect(html).toContain("Choose your next focus");
    expect(html).toContain("Ship Chewgether v1");
  });

  it("achieved goal with an unparseable snapshot degrades to the raw objective/date, no crash", () => {
    const degraded: BetweenGoalsAchieved = {
      id: "goal-legacy",
      objective: "Legacy goal",
      completedAt: new Date("2026-01-01T18:00:00.000Z"),
      completionSnapshot: { garbage: true },
    };
    const html = renderToStaticMarkup(
      createElement(BetweenGoalsToday, { activeGoals: [], latestAchieved: degraded }),
    );

    expect(html).toContain("Legacy goal");
    expect(html).toContain("Jan 1, 2026");
  });
});
