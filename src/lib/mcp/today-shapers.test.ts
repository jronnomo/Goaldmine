// src/lib/mcp/today-shapers.test.ts
//
// Unit tests for shapeProjectTodayPayload — story #135.
// Pure function: no DB, no mocking required.
// Conventions mirror rarity-core.test.ts / food-units.test.ts.

import { describe, it, expect } from "vitest";
import { shapeProjectTodayPayload } from "@/lib/mcp/today-shapers";
import type { ResolvedDay } from "@/lib/calendar";
import type { GoalFeasibility } from "@/lib/rarity-core";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** A fitness-filled ResolvedDay (simulates what resolveDay returns today). */
const MOCK_DAY: ResolvedDay = {
  date: new Date("2026-06-30T07:00:00.000Z"),
  dateKey: "2026-06-30",
  isInPlan: true,
  isGoalDate: false,
  rotationDay: 2,
  weekIndex: 5,
  todayTask: "workout",
  activeWorkout: {
    dayOfWeek: 2,
    title: "Lower A",
    category: "lower",
    summary: "Lower body strength",
    blocks: [],
  },
  deferredWorkout: null,
  isOverride: false,
  workoutDeferredForBaseline: false,
  workoutDeferredForHike: false,
  plannedHikeToday: null,
  longEffortConflict: null,
  orphanedOverride: false,
  nutritionText: "High protein day",
  nutritionPlan: null,
  mobilityText: "Hip flexors 2x60s",
  notes: "Leg day notes",
  workouts: [
    {
      id: "w1",
      startedAt: new Date("2026-06-30T08:00:00.000Z"),
      title: "Lower A",
      exerciseCount: 5,
      status: "completed",
      notes: null,
    },
  ],
  loggedNutrition: [
    {
      id: "n1",
      date: new Date("2026-06-30"),
      mealType: "lunch",
      items: ["chicken breast", "rice"],
      notes: null,
      calories: 600,
      proteinG: 50,
      carbsG: 60,
      fatG: 10,
      fiberG: 3,
      sodiumMg: 800,
    },
  ],
  baselinesDue: [],
  notesAboutDate: [
    { id: "note-review", body: "Weekly review note", type: "review", date: new Date("2026-06-30"), targetDate: null },
    { id: "note-open", body: "Open item note", type: "open_item", date: new Date("2026-06-30"), targetDate: null },
    { id: "note-plain", body: "Plain note", type: "note", date: new Date("2026-06-30"), targetDate: null },
  ],
  goalObjective: null,
  confidence: "confirmed",
  override: null,
  otherGoalEvents: [
    {
      goalId: "g-elbert",
      goalObjective: "Summit Mt. Elbert",
      goalKind: "fitness",
      isFocusGoal: false,
      dateKey: "2026-07-04",
      type: "target-date",
      icon: "🏔️",
      label: "Goal date",
    },
  ],
  crossGoalConflicts: [],
};

/** A project-kind active goal. */
const PROJECT_GOAL = {
  id: "g-chewgether",
  kind: "project",
  objective: "Launch Chewgether to $1k MRR",
  githubRepo: "jronnomo/chewgether",
};

/** A minimal feasibility result (null tier = unrated). */
const FEASIBILITY: GoalFeasibility = {
  goalId: "g-chewgether",
  tier: null,
  unratedReason: "no-targets",
  ratio: null,
  perTarget: [],
  basis: null,
  weeksRemaining: null,
  computedAt: "2026-06-30T07:00:00.000Z",
};

const STANDING_RULES = [
  { id: "sr1", body: "RULE: Always log mobility sessions", date: new Date("2026-06-01"), lastAcknowledgedAt: null },
];

const TODAY_ITEMS = [
  { id: "si1", type: "milestone", title: "Ship onboarding v2", status: "planned", completedAt: null },
];

// ─── 1. Fitness fields are null / false / [] ──────────────────────────────────

describe("shapeProjectTodayPayload — fitness fields suppressed", () => {
  const result = shapeProjectTodayPayload(
    MOCK_DAY,
    PROJECT_GOAL,
    STANDING_RULES,
    TODAY_ITEMS,
    FEASIBILITY,
  );

  it("todayTask is null", () => {
    expect(result.todayTask).toBeNull();
  });

  it("activeWorkout is null", () => {
    expect(result.activeWorkout).toBeNull();
  });

  it("deferredWorkout is null", () => {
    expect(result.deferredWorkout).toBeNull();
  });

  it("plannedHikeToday is null", () => {
    expect(result.plannedHikeToday).toBeNull();
  });

  it("longEffortConflict is null", () => {
    expect(result.longEffortConflict).toBeNull();
  });

  it("nutritionText is null", () => {
    expect(result.nutritionText).toBeNull();
  });

  it("nutritionPlan is null", () => {
    expect(result.nutritionPlan).toBeNull();
  });

  it("mobilityText is null", () => {
    expect(result.mobilityText).toBeNull();
  });

  it("notes is null", () => {
    expect(result.notes).toBeNull();
  });

  it("override is null", () => {
    expect(result.override).toBeNull();
  });

  it("rotationDay is null", () => {
    expect(result.rotationDay).toBeNull();
  });

  it("weekIndex is null", () => {
    expect(result.weekIndex).toBeNull();
  });

  it("isOverride is false", () => {
    expect(result.isOverride).toBe(false);
  });

  it("workoutDeferredForBaseline is false", () => {
    expect(result.workoutDeferredForBaseline).toBe(false);
  });

  it("workoutDeferredForHike is false", () => {
    expect(result.workoutDeferredForHike).toBe(false);
  });

  it("orphanedOverride is false", () => {
    expect(result.orphanedOverride).toBe(false);
  });

  it("workouts is []", () => {
    expect(result.workouts).toEqual([]);
  });

  it("loggedNutrition is []", () => {
    expect(result.loggedNutrition).toEqual([]);
  });

  it("baselinesDue is []", () => {
    expect(result.baselinesDue).toEqual([]);
  });
});

// ─── 2. goalObjective is populated from activeGoal ────────────────────────────

describe("shapeProjectTodayPayload — goalObjective", () => {
  it("goalObjective equals activeGoal.objective", () => {
    const result = shapeProjectTodayPayload(
      MOCK_DAY,
      PROJECT_GOAL,
      STANDING_RULES,
      TODAY_ITEMS,
      FEASIBILITY,
    );
    expect(result.goalObjective).toBe(PROJECT_GOAL.objective);
  });

  it("goalObjective is null when activeGoal is null", () => {
    const result = shapeProjectTodayPayload(
      MOCK_DAY,
      null,
      STANDING_RULES,
      TODAY_ITEMS,
      FEASIBILITY,
    );
    expect(result.goalObjective).toBeNull();
  });
});

// ─── 3. focusGoal and activeGoal ─────────────────────────────────────────────

describe("shapeProjectTodayPayload — focusGoal and activeGoal", () => {
  const result = shapeProjectTodayPayload(
    MOCK_DAY,
    PROJECT_GOAL,
    STANDING_RULES,
    TODAY_ITEMS,
    FEASIBILITY,
  );

  it("focusGoal is the activeGoal object", () => {
    expect(result.focusGoal).toBe(PROJECT_GOAL);
  });

  it("activeGoal is the activeGoal object (saved-prompt compat duplicate)", () => {
    expect(result.activeGoal).toBe(PROJECT_GOAL);
  });

  it("focusGoal and activeGoal are the same reference", () => {
    expect(result.focusGoal).toBe(result.activeGoal);
  });
});

// ─── 4. Carry-through fields ─────────────────────────────────────────────────

describe("shapeProjectTodayPayload — carry-through from ResolvedDay", () => {
  const result = shapeProjectTodayPayload(
    MOCK_DAY,
    PROJECT_GOAL,
    STANDING_RULES,
    TODAY_ITEMS,
    FEASIBILITY,
  );

  it("date is carried from r", () => {
    expect(result.date).toBe(MOCK_DAY.date);
  });

  it("dateKey is carried from r", () => {
    expect(result.dateKey).toBe("2026-06-30");
  });

  it("isInPlan is carried from r", () => {
    expect(result.isInPlan).toBe(true);
  });

  it("isGoalDate is carried from r", () => {
    expect(result.isGoalDate).toBe(false);
  });

  it("confidence is carried from r", () => {
    expect(result.confidence).toBe("confirmed");
  });

  it("otherGoalEvents is carried from r", () => {
    expect(result.otherGoalEvents).toBe(MOCK_DAY.otherGoalEvents);
  });

  it("crossGoalConflicts is carried from r", () => {
    expect(result.crossGoalConflicts).toBe(MOCK_DAY.crossGoalConflicts);
  });
});

// ─── 5. notesAboutDate filtering ─────────────────────────────────────────────

describe("shapeProjectTodayPayload — notesAboutDate filtering", () => {
  const result = shapeProjectTodayPayload(
    MOCK_DAY,
    PROJECT_GOAL,
    STANDING_RULES,
    TODAY_ITEMS,
    FEASIBILITY,
  );

  it("excludes notes with type:'review'", () => {
    const hasReview = result.notesAboutDate.some((n) => n.type === "review");
    expect(hasReview).toBe(false);
  });

  it("keeps notes with type:'open_item'", () => {
    const hasOpenItem = result.notesAboutDate.some((n) => n.type === "open_item");
    expect(hasOpenItem).toBe(true);
  });

  it("keeps notes with type:'note'", () => {
    const hasNote = result.notesAboutDate.some((n) => n.type === "note");
    expect(hasNote).toBe(true);
  });

  it("result has 2 notes (open_item + note), not 3", () => {
    expect(result.notesAboutDate).toHaveLength(2);
  });
});

// ─── 6. Project fields passed through ────────────────────────────────────────

describe("shapeProjectTodayPayload — project fields", () => {
  const result = shapeProjectTodayPayload(
    MOCK_DAY,
    PROJECT_GOAL,
    STANDING_RULES,
    TODAY_ITEMS,
    FEASIBILITY,
  );

  it("todayItems is passed through", () => {
    expect(result.todayItems).toBe(TODAY_ITEMS);
  });

  it("feasibility is passed through", () => {
    expect(result.feasibility).toBe(FEASIBILITY);
  });

  it("standingRules is passed through", () => {
    expect(result.standingRules).toBe(STANDING_RULES);
  });

  it("feasibility is null when null is passed", () => {
    const r2 = shapeProjectTodayPayload(MOCK_DAY, PROJECT_GOAL, STANDING_RULES, TODAY_ITEMS, null);
    expect(r2.feasibility).toBeNull();
  });
});
