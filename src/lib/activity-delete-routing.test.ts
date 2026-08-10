// src/lib/activity-delete-routing.test.ts
//
// #272 — DASHBOARD call sites route through the shared delete cores (the MCP
// side is covered by src/lib/mcp/delete-tools-routing.test.ts). Each server
// action is invoked with the core module mocked; the assertion is that the
// action delegates to the core (one delete code path per activity type) and
// preserves its own envelope (redirect target, Undo snapshot, guard errors).
//
// House convention: vi.mock("@/lib/db") + next/cache + next/navigation mocks
// (mirrors day-log-actions.test.ts).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const mockRedirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

const { mockGetDb } = vi.hoisted(() => ({ mockGetDb: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mockGetDb, prisma: {} }));

// ── Core spies (the routing targets) ─────────────────────────────────────────
const {
  mockDeleteWorkoutCore,
  mockDeleteWorkoutsCore,
  mockDeleteBaselineCore,
  mockDeleteNutritionCore,
  mockDeleteLogEntryCore,
} = vi.hoisted(() => ({
  mockDeleteWorkoutCore: vi.fn(),
  mockDeleteWorkoutsCore: vi.fn(),
  mockDeleteBaselineCore: vi.fn(),
  mockDeleteNutritionCore: vi.fn(),
  mockDeleteLogEntryCore: vi.fn(),
}));

vi.mock("@/lib/workout-core", () => ({
  createWorkoutCore: vi.fn(),
  updateWorkoutCore: vi.fn(),
  updateWorkoutSetCore: vi.fn(),
  workoutOpsCore: vi.fn(),
  deleteWorkoutCore: mockDeleteWorkoutCore,
  deleteWorkoutsCore: mockDeleteWorkoutsCore,
  WorkoutOpSchema: { shape: {}, parse: vi.fn() },
}));
vi.mock("@/lib/baseline-core", () => ({ deleteBaselineCore: mockDeleteBaselineCore }));
vi.mock("@/lib/nutrition-core", () => ({ deleteNutritionCore: mockDeleteNutritionCore }));
vi.mock("@/lib/log-entry-core", () => ({ deleteLogEntryCore: mockDeleteLogEntryCore }));

// Module-graph stubs the actions files pull in but these tests never exercise.
vi.mock("@/lib/baseline-workout", () => ({
  appendBaselineToDayWorkout: vi.fn(),
  syncBaselineUpdateToWorkout: vi.fn(),
  removeBaselineFromDayWorkout: vi.fn(),
}));
vi.mock("@/lib/hike-core", () => ({ logHikeCore: vi.fn() }));
vi.mock("@/lib/program", () => ({ getActiveProgram: vi.fn() }));
vi.mock("@/lib/goal-core", () => ({
  createGoalCore: vi.fn(),
  ensurePlanForGoalCore: vi.fn(),
  setFocusGoalCore: vi.fn(),
  setGoalTrackedCore: vi.fn(),
  setPlanActiveCore: vi.fn(),
}));
vi.mock("@/lib/goal-completion", () => ({ completeGoalCore: vi.fn(), reopenGoalCore: vi.fn() }));
vi.mock("@/lib/goal-flavors", () => ({ isFlavorKey: vi.fn(), legendForFlavor: vi.fn() }));
vi.mock("@/lib/rarity", () => ({ computeStackRarity: vi.fn() }));

import { deleteBaselineRow, deleteNutrition } from "@/lib/workout-actions";
import { deleteMetricReading } from "@/lib/goal-actions";
import { deleteWorkoutAction } from "@/lib/workout-edit-actions";
import { unskipDay } from "@/lib/day-log-actions";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetDb.mockResolvedValue({});
});

describe("deleteBaselineRow (dashboard) → deleteBaselineCore", () => {
  it("delegates to the core and redirects using the core's returned testName", async () => {
    mockDeleteBaselineCore.mockResolvedValue({
      id: "b1",
      testName: "Max Pull-ups",
      date: new Date("2026-06-01T12:00:00Z"),
    });

    await deleteBaselineRow("b1");

    expect(mockDeleteBaselineCore).toHaveBeenCalledExactlyOnceWith("b1");
    expect(mockRedirect).toHaveBeenCalledWith("/baselines/test/Max%20Pull-ups");
  });
});

describe("deleteNutrition (dashboard) → deleteNutritionCore", () => {
  it("delegates to the core and builds the Undo snapshot from the returned row", async () => {
    const date = new Date("2026-08-01T18:30:00Z");
    mockDeleteNutritionCore.mockResolvedValue({
      id: "n1",
      mealType: "dinner",
      items: [],
      notes: "post-hike",
      date,
      calories: 640,
      proteinG: 42,
      carbsG: 55,
      fatG: 18,
      fiberG: 7,
      sodiumMg: 900,
    });

    const snapshot = await deleteNutrition("n1");

    expect(mockDeleteNutritionCore).toHaveBeenCalledExactlyOnceWith("n1");
    expect(snapshot).toEqual({
      mealType: "dinner",
      items: [],
      notes: "post-hike",
      dateISO: date.toISOString(),
      macros: {
        calories: 640,
        proteinG: 42,
        carbsG: 55,
        fatG: 18,
        fiberG: 7,
        sodiumMg: 900,
      },
    });
  });
});

describe("deleteMetricReading (dashboard) → deleteLogEntryCore", () => {
  const findUnique = vi.fn();

  beforeEach(() => {
    mockGetDb.mockResolvedValue({ logEntry: { findUnique } });
  });

  it("passes the ownership guard then delegates to the core", async () => {
    findUnique.mockResolvedValue({ goalId: "g1", metric: "mrr" });
    mockDeleteLogEntryCore.mockResolvedValue({ id: "e1", metric: "mrr", value: 10 });

    await deleteMetricReading("g1", "mrr", "e1");

    expect(mockDeleteLogEntryCore).toHaveBeenCalledExactlyOnceWith("e1");
  });

  it("guard mismatch (different goal) throws and never reaches the core", async () => {
    findUnique.mockResolvedValue({ goalId: "OTHER", metric: "mrr" });

    await expect(deleteMetricReading("g1", "mrr", "e1")).rejects.toThrow("Reading not found");
    expect(mockDeleteLogEntryCore).not.toHaveBeenCalled();
  });

  it("core reporting the row already gone maps to the same friendly error", async () => {
    findUnique.mockResolvedValue({ goalId: "g1", metric: "mrr" });
    mockDeleteLogEntryCore.mockResolvedValue(null);

    await expect(deleteMetricReading("g1", "mrr", "e1")).rejects.toThrow("Reading not found");
  });
});

describe("deleteWorkoutAction (dashboard) → deleteWorkoutCore", () => {
  it("delegates to the core and redirects to /history", async () => {
    mockGetDb.mockResolvedValue({
      workout: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          startedAt: new Date("2026-08-01T14:00:00Z"),
        }),
      },
    });
    mockDeleteWorkoutCore.mockResolvedValue({ id: "w9" });

    await deleteWorkoutAction("w9");

    expect(mockDeleteWorkoutCore).toHaveBeenCalledExactlyOnceWith("w9");
    expect(mockRedirect).toHaveBeenCalledWith("/history");
  });
});

describe("unskipDay (dashboard) → deleteWorkoutsCore", () => {
  it("resolves the day's skipped ids then delegates the batch to the core", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "w1" }, { id: "w2" }]);
    mockGetDb.mockResolvedValue({ workout: { findMany } });
    mockDeleteWorkoutsCore.mockResolvedValue({ deleted: 2 });

    await expect(unskipDay("2026-01-06")).resolves.toEqual({ deleted: 2 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "skipped" }),
        select: { id: true },
      }),
    );
    expect(mockDeleteWorkoutsCore).toHaveBeenCalledExactlyOnceWith(["w1", "w2"]);
  });
});
