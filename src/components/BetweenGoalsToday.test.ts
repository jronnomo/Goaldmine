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
import type { GameState } from "@/lib/game/types";
import type { NutritionTodayLog } from "@/components/NutritionToday";
import type { LibraryFood } from "@/lib/food-types";
import type { CompletedWorkoutDetail } from "@/components/days/CompletedWorkoutCard";

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

// Daily-utility fixtures — the plan/goal-independent surfaces the between-goals
// view must keep showing (see page.tsx's between-goals branch fetches).

// goalKind !== null (via computeGameState's getMostRecentProgram fallback) —
// a veteran between goals still has an XP/level history to show continuity.
const GAME_STATE: GameState = {
  goalKind: "fitness",
  level: 7,
  xp: 4200,
  xpIntoLevel: 150,
  xpToNext: 500,
  progress: 0.3,
  attributes: [],
  streak: { current: 3, longest: 12, todayCounted: false },
  badges: [],
  recentEvents: [],
  events: [],
  questToday: null,
};

// A genuinely new/never-had-a-plan user — computeGameState's emptyState().
const EMPTY_GAME_STATE: GameState = {
  goalKind: null,
  level: 1,
  xp: 0,
  xpIntoLevel: 0,
  xpToNext: 100,
  progress: 0,
  attributes: [],
  streak: { current: 0, longest: 0, todayCounted: false },
  badges: [],
  recentEvents: [],
  events: [],
  questToday: null,
};

const NUTRITION_LOG: NutritionTodayLog = {
  id: "log-1",
  date: new Date("2026-08-09T13:00:00.000Z"),
  mealType: "lunch",
  items: [{ name: "Chicken bowl" }],
  notes: null,
  calories: 620,
  proteinG: 45,
  carbsG: 50,
  fatG: 20,
  fiberG: null,
  sodiumMg: null,
};

const QUICK_PICK_FOOD: LibraryFood = {
  id: "food-1",
  barcode: null,
  name: "Greek Yogurt",
  brand: "Fage",
  servingSize: "170g",
  basis: "serving",
  perServing: { calories: 130, proteinG: 18, carbsG: 6, fatG: 4, fiberG: null, sodiumMg: null },
  isFavorite: true,
};

const COMPLETED_WORKOUT: CompletedWorkoutDetail = {
  id: "workout-1",
  title: "Morning lift",
  startedAt: new Date("2026-08-09T14:00:00.000Z"),
  source: "manual",
  notes: null,
  exercises: [
    {
      id: "ex-1",
      name: "Back Squat",
      equipment: "Barbell",
      notes: null,
      sets: [
        { id: "set-1", setIndex: 1, reps: 5, weightLb: 185, durationSec: null, distanceMi: null, rpe: 8 },
      ],
    },
  ],
};

// Baseline "nothing logged today yet" props — required for every fixture
// below via a spread, so the component must render cleanly with all-empty
// daily data (a between-goals morning with nothing logged yet).
const EMPTY_DAILY_PROPS = {
  gameState: EMPTY_GAME_STATE,
  todayNutrition: [] as NutritionTodayLog[],
  quickPickFoods: [] as LibraryFood[],
  todayCompletedWorkouts: [] as CompletedWorkoutDetail[],
};

describe("BetweenGoalsToday", () => {
  it("completion + active goals: renders the ack card and the focus-picker list", () => {
    const html = renderToStaticMarkup(
      createElement(BetweenGoalsToday, {
        activeGoals: [ACTIVE_GOAL],
        latestAchieved: ACHIEVED,
        ...EMPTY_DAILY_PROPS,
      }),
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

    // Daily-utility surfaces stay present — completing a goal doesn't gut Today.
    expect(html).toContain("Nutrition");
    expect(html).toContain("Nothing planned or logged yet.");
  });

  it("no active goals, only a completion: ack card + single start-next-goal CTA", () => {
    const html = renderToStaticMarkup(
      createElement(BetweenGoalsToday, {
        activeGoals: [],
        latestAchieved: ACHIEVED,
        ...EMPTY_DAILY_PROPS,
      }),
    );

    expect(html).toContain("Goal completed");
    expect(html).toContain("Start your next goal");
    expect(html).not.toContain("Choose your next focus");
  });

  it("active goals but no completion snapshot yet: no ack card, focus list only", () => {
    const html = renderToStaticMarkup(
      createElement(BetweenGoalsToday, {
        activeGoals: [ACTIVE_GOAL],
        latestAchieved: null,
        ...EMPTY_DAILY_PROPS,
      }),
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
      createElement(BetweenGoalsToday, {
        activeGoals: [],
        latestAchieved: degraded,
        ...EMPTY_DAILY_PROPS,
      }),
    );

    expect(html).toContain("Legacy goal");
    expect(html).toContain("Jan 1, 2026");
  });

  it("all-empty daily data (fresh between-goals morning): renders with no crash, no CharacterHeader, empty nutrition note, no activity cards", () => {
    const html = renderToStaticMarkup(
      createElement(BetweenGoalsToday, {
        activeGoals: [ACTIVE_GOAL],
        latestAchieved: null,
        ...EMPTY_DAILY_PROPS,
      }),
    );

    // goalKind === null (genuinely new user) → header hidden, same gate as main Today.
    expect(html).not.toContain('data-testid="character-header"');
    expect(html).toContain("Nothing planned or logged yet.");
    expect(html).not.toContain("✓ Completed:");
  });

  it("populated daily data: renders CharacterHeader, logged nutrition, and today's completed workout", () => {
    const html = renderToStaticMarkup(
      createElement(BetweenGoalsToday, {
        activeGoals: [ACTIVE_GOAL],
        latestAchieved: ACHIEVED,
        gameState: GAME_STATE,
        todayNutrition: [NUTRITION_LOG],
        quickPickFoods: [QUICK_PICK_FOOD],
        todayCompletedWorkouts: [COMPLETED_WORKOUT],
      }),
    );

    // Identity/XP continuity — populated gameState (goalKind !== null) renders the header.
    expect(html).toContain('data-testid="character-header"');

    // Logged nutrition renders instead of the empty-state note.
    expect(html).not.toContain("Nothing planned or logged yet.");
    expect(html).toContain("Chicken bowl");

    // Today's completed workout renders via the same CompletedWorkoutCard as main Today.
    expect(html).toContain("✓ Completed: Morning lift");
    expect(html).toContain("Back Squat");

    // Order sanity: character header precedes the completion-ack card, which
    // precedes the choose-next-focus card, which precedes Nutrition.
    const headerIdx = html.indexOf('data-testid="character-header"');
    const ackIdx = html.indexOf("Goal completed");
    const focusIdx = html.indexOf("Choose your next focus");
    const nutritionIdx = html.indexOf(">Nutrition<");
    expect(headerIdx).toBeGreaterThan(-1);
    expect(headerIdx).toBeLessThan(ackIdx);
    expect(ackIdx).toBeLessThan(focusIdx);
    expect(focusIdx).toBeLessThan(nutritionIdx);
  });
});
