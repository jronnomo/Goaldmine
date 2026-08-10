// src/lib/mcp/today-shapers.test.ts
//
// Unit tests for the get_today_plan shapers — story #135 (the legacy project
// nuller, still byte-covered because zero-Program tenants keep receiving that
// exact shape) and #283 (shapeProgramTodayPayload, the merged program-shaped
// payload). Pure functions: no DB, no mocking required.
// Conventions mirror rarity-core.test.ts / food-units.test.ts.

import { describe, it, expect } from "vitest";
import {
  shapeLegacyProjectTodayPayload,
  shapeProgramTodayPayload,
} from "@/lib/mcp/today-shapers";
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
  resolvedPlan: { id: "plan-1", name: "Elbert Prep", source: "active" },
  // #282: program-shaped additions. This fixture models a ZERO-Program tenant
  // (the legacy shaper's only remaining audience), so all three are empty.
  program: null,
  scheduledItemsToday: [],
  goalMarks: [],
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

describe("shapeLegacyProjectTodayPayload — fitness fields suppressed", () => {
  const result = shapeLegacyProjectTodayPayload(
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

  it("resolvedPlan is null (REQ-003: Plan/program is a fitness-only concept)", () => {
    expect(result.resolvedPlan).toBeNull();
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

describe("shapeLegacyProjectTodayPayload — goalObjective", () => {
  it("goalObjective equals activeGoal.objective", () => {
    const result = shapeLegacyProjectTodayPayload(
      MOCK_DAY,
      PROJECT_GOAL,
      STANDING_RULES,
      TODAY_ITEMS,
      FEASIBILITY,
    );
    expect(result.goalObjective).toBe(PROJECT_GOAL.objective);
  });

  it("goalObjective is null when activeGoal is null", () => {
    const result = shapeLegacyProjectTodayPayload(
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

describe("shapeLegacyProjectTodayPayload — focusGoal and activeGoal", () => {
  const result = shapeLegacyProjectTodayPayload(
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

describe("shapeLegacyProjectTodayPayload — carry-through from ResolvedDay", () => {
  const result = shapeLegacyProjectTodayPayload(
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

describe("shapeLegacyProjectTodayPayload — notesAboutDate filtering", () => {
  const result = shapeLegacyProjectTodayPayload(
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

describe("shapeLegacyProjectTodayPayload — project fields", () => {
  const result = shapeLegacyProjectTodayPayload(
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
    const r2 = shapeLegacyProjectTodayPayload(MOCK_DAY, PROJECT_GOAL, STANDING_RULES, TODAY_ITEMS, null);
    expect(r2.feasibility).toBeNull();
  });
});

// ─── 7. Legacy shaper carries the #282 keys (zero-Program: null/[]/[]) ───────

describe("shapeLegacyProjectTodayPayload — #282 keys carried through", () => {
  const result = shapeLegacyProjectTodayPayload(
    MOCK_DAY,
    PROJECT_GOAL,
    STANDING_RULES,
    TODAY_ITEMS,
    FEASIBILITY,
  );

  it("program is null (zero-Program tenant by definition on this path)", () => {
    expect(result.program).toBeNull();
  });

  it("scheduledItemsToday is []", () => {
    expect(result.scheduledItemsToday).toEqual([]);
  });

  it("goalMarks is []", () => {
    expect(result.goalMarks).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// shapeProgramTodayPayload (#283) — the merged, program-shaped payload
// ═════════════════════════════════════════════════════════════════════════════

// Phase-2A-shaped ResolvedDay: handstand owns the rotation (fitness fields
// live), cut is a fitness member with a baseline claim, AWS is a project
// member with a scheduled item today.
const PHASE_2A_DAY: ResolvedDay = {
  ...MOCK_DAY,
  program: {
    id: "prog-1",
    name: "Phase 2A",
    status: "active",
    startedOn: new Date("2026-05-25T06:00:00.000Z"),
    endsOn: null,
    memberGoals: [
      { id: "g-handstand", objective: "Freestanding handstand", kind: "fitness", status: "active" },
      { id: "g-cut", objective: "10% body fat", kind: "fitness", status: "active" },
      { id: "g-aws", objective: "AWS SAA cert", kind: "project", status: "active" },
    ],
  },
  scheduledItemsToday: [
    {
      id: "si-aws-1",
      goalId: "g-aws",
      goalObjective: "AWS SAA cert",
      type: "task",
      title: "Practice exam #3",
      detail: "Domains 1-2 focus",
      status: "planned",
      completedAt: null,
    },
    {
      id: "si-aws-2",
      goalId: "g-aws",
      goalObjective: "AWS SAA cert",
      type: "review",
      title: "Flashcards",
      detail: null,
      status: "done",
      completedAt: new Date("2026-06-30T15:30:00.000Z"),
    },
  ],
  goalMarks: [
    { goalId: "g-handstand", objective: "Freestanding handstand", kind: "fitness", claims: ["rotation", "nutrition"] },
    { goalId: "g-cut", objective: "10% body fat", kind: "fitness", claims: ["nutrition"] },
    { goalId: "g-aws", objective: "AWS SAA cert", kind: "project", claims: ["scheduled_item"] },
  ],
};

const AWS_FEASIBILITY: GoalFeasibility = { ...FEASIBILITY, goalId: "g-aws" };
const FEAS_BY_GOAL = new Map<string, GoalFeasibility | null>([["g-aws", AWS_FEASIBILITY]]);

describe("shapeProgramTodayPayload — rotation fields pass through UNCHANGED (the fitness/project fork dissolves)", () => {
  const result = shapeProgramTodayPayload(PHASE_2A_DAY, PROJECT_GOAL, STANDING_RULES, FEAS_BY_GOAL);

  it("todayTask stays the resolved TodayTask (not nulled)", () => {
    expect(result.todayTask).toBe("workout");
  });

  it("activeWorkout passes through", () => {
    expect(result.activeWorkout).toBe(PHASE_2A_DAY.activeWorkout);
  });

  it("rotationDay/weekIndex pass through", () => {
    expect(result.rotationDay).toBe(2);
    expect(result.weekIndex).toBe(5);
  });

  it("isInPlan/confidence reflect the Program's plan (carried from r, never another plan's window)", () => {
    expect(result.isInPlan).toBe(true);
    expect(result.confidence).toBe("confirmed");
  });

  it("resolvedPlan passes through (still the rotation-plan pointer)", () => {
    expect(result.resolvedPlan).toEqual({ id: "plan-1", name: "Elbert Prep", source: "active" });
  });

  it("nutrition/mobility/workouts/loggedNutrition/notesAboutDate pass through unfiltered", () => {
    expect(result.nutritionText).toBe(MOCK_DAY.nutritionText);
    expect(result.mobilityText).toBe(MOCK_DAY.mobilityText);
    expect(result.workouts).toBe(MOCK_DAY.workouts);
    expect(result.loggedNutrition).toBe(MOCK_DAY.loggedNutrition);
    expect(result.notesAboutDate).toBe(MOCK_DAY.notesAboutDate);
  });

  it("program/scheduledItemsToday/goalMarks pass through", () => {
    expect(result.program).toBe(PHASE_2A_DAY.program);
    expect(result.scheduledItemsToday).toBe(PHASE_2A_DAY.scheduledItemsToday);
    expect(result.goalMarks).toBe(PHASE_2A_DAY.goalMarks);
  });
});

describe("shapeProgramTodayPayload — todayItems union + goalSections keyed by goalId", () => {
  const result = shapeProgramTodayPayload(PHASE_2A_DAY, PROJECT_GOAL, STANDING_RULES, FEAS_BY_GOAL);

  it("todayItems is the union across member goals, ISO-string completedAt, with goalId + goalObjective per row", () => {
    expect(result.todayItems).toEqual([
      {
        id: "si-aws-1",
        type: "task",
        title: "Practice exam #3",
        status: "planned",
        completedAt: null,
        goalId: "g-aws",
        goalObjective: "AWS SAA cert",
      },
      {
        id: "si-aws-2",
        type: "review",
        title: "Flashcards",
        status: "done",
        completedAt: "2026-06-30T15:30:00.000Z",
        goalId: "g-aws",
        goalObjective: "AWS SAA cert",
      },
    ]);
  });

  it("goalSections has one section per member goal, keyed by goalId", () => {
    expect(Object.keys(result.goalSections).sort()).toEqual(["g-aws", "g-cut", "g-handstand"]);
  });

  it("the project member's section carries its items + feasibility", () => {
    expect(result.goalSections["g-aws"]).toEqual({
      goalId: "g-aws",
      objective: "AWS SAA cert",
      kind: "project",
      status: "active",
      todayItems: [
        { id: "si-aws-1", type: "task", title: "Practice exam #3", status: "planned", completedAt: null },
        { id: "si-aws-2", type: "review", title: "Flashcards", status: "done", completedAt: "2026-06-30T15:30:00.000Z" },
      ],
      feasibility: AWS_FEASIBILITY,
    });
  });

  it("fitness members' sections have empty todayItems and null feasibility", () => {
    expect(result.goalSections["g-handstand"]?.todayItems).toEqual([]);
    expect(result.goalSections["g-handstand"]?.feasibility).toBeNull();
    expect(result.goalSections["g-cut"]?.feasibility).toBeNull();
  });

  it("standingRules / focusGoal / activeGoal ride on top like the legacy payloads", () => {
    expect(result.standingRules).toBe(STANDING_RULES);
    expect(result.focusGoal).toBe(PROJECT_GOAL);
    expect(result.activeGoal).toBe(PROJECT_GOAL);
  });
});

describe("shapeProgramTodayPayload — chewgether invariant (DA #10): active Program, zero active Plans", () => {
  // 'No rotation today': resolveDay gives out_of_plan with null/[] fitness
  // fields and NO resolvedPlan — never another goal's plan.
  const CHEWGETHER_DAY: ResolvedDay = {
    ...PHASE_2A_DAY,
    isInPlan: false,
    rotationDay: null,
    weekIndex: null,
    todayTask: "out_of_plan",
    activeWorkout: null,
    deferredWorkout: null,
    resolvedPlan: null,
    confidence: null,
    nutritionText: null,
    nutritionPlan: null,
    mobilityText: null,
    notes: null,
    workouts: [],
    loggedNutrition: [],
    baselinesDue: [],
    program: {
      id: "prog-chew",
      name: "chewgether $1k/mo",
      status: "active",
      startedOn: new Date("2026-07-01T06:00:00.000Z"),
      endsOn: null,
      memberGoals: [
        { id: "g-chewgether", objective: "Launch Chewgether to $1k MRR", kind: "project", status: "active" },
      ],
    },
    scheduledItemsToday: [
      {
        id: "si-chew-1",
        goalId: "g-chewgether",
        goalObjective: "Launch Chewgether to $1k MRR",
        type: "milestone",
        title: "Ship onboarding v2",
        detail: null,
        status: "planned",
        completedAt: null,
      },
    ],
    goalMarks: [
      { goalId: "g-chewgether", objective: "Launch Chewgether to $1k MRR", kind: "project", claims: ["scheduled_item"] },
    ],
  };

  const result = shapeProgramTodayPayload(
    CHEWGETHER_DAY,
    PROJECT_GOAL,
    STANDING_RULES,
    new Map([["g-chewgether", FEASIBILITY]]),
  );

  it("renders 'no rotation today': out_of_plan task, null workout, null rotationDay/weekIndex", () => {
    expect(result.todayTask).toBe("out_of_plan");
    expect(result.activeWorkout).toBeNull();
    expect(result.deferredWorkout).toBeNull();
    expect(result.rotationDay).toBeNull();
    expect(result.weekIndex).toBeNull();
  });

  it("never leaks an unrelated plan: isInPlan false, resolvedPlan null, confidence null", () => {
    expect(result.isInPlan).toBe(false);
    expect(result.resolvedPlan).toBeNull();
    expect(result.confidence).toBeNull();
  });

  it("program context + items still surface — the day is program-shaped, not empty", () => {
    expect(result.program?.name).toBe("chewgether $1k/mo");
    expect(result.todayItems).toHaveLength(1);
    expect(result.goalSections["g-chewgether"]?.feasibility).toBe(FEASIBILITY);
  });
});
