// src/lib/log-sheet-data.test.ts
// Unit tests for getLogSheetData() — mocks @/lib/db (repo dual-export
// prisma+getDb convention, see compare.test.ts), @/lib/calendar, and
// @/lib/food-actions. No live DB required.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockNutritionLog, mockDb } = vi.hoisted(() => {
  const mockNutritionLog = { findMany: vi.fn() };
  const mockDb = { nutritionLog: mockNutritionLog };
  return { mockNutritionLog, mockDb };
});

vi.mock("@/lib/db", () => ({
  prisma: {},
  getDb: vi.fn().mockResolvedValue(mockDb),
}));

vi.mock("@/lib/calendar", () => ({
  // Identity mocks — makes the findMany where.date.gte/lte assertion exact.
  startOfDay: (d: Date) => d,
  endOfDay: (d: Date) => d,
  resolveDay: vi.fn().mockResolvedValue({ nutritionPlan: null }),
}));

vi.mock("@/lib/food-actions", () => ({
  getQuickPickFoods: vi.fn().mockResolvedValue([]),
  listLibraryFoods: vi.fn().mockResolvedValue([]),
}));

import { getLogSheetData } from "@/lib/log-sheet-data";
import { resolveDay } from "@/lib/calendar";
import { getQuickPickFoods, listLibraryFoods } from "@/lib/food-actions";

const NOW = new Date("2026-07-10T18:00:00.000Z");

function rawRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "meal-1",
    date: NOW,
    mealType: "lunch",
    items: [],
    notes: null,
    calories: 500,
    proteinG: 40,
    carbsG: 50,
    fatG: 15,
    fiberG: 5,
    sodiumMg: 600,
    ...overrides,
  };
}

describe("getLogSheetData", () => {
  beforeEach(() => {
    mockNutritionLog.findMany.mockReset().mockResolvedValue([]);
    vi.mocked(resolveDay).mockResolvedValue({ nutritionPlan: null } as never);
    vi.mocked(getQuickPickFoods).mockResolvedValue([]);
    vi.mocked(listLibraryFoods).mockResolvedValue([]);
  });

  it("queries nutritionLog with the exact startOfDay/endOfDay window bounds", async () => {
    await getLogSheetData(NOW);
    expect(mockNutritionLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { date: { gte: NOW, lte: NOW } },
        orderBy: { date: "asc" },
      }),
    );
  });

  it("maps date to dateISO via date.toISOString()", async () => {
    mockNutritionLog.findMany.mockResolvedValue([rawRow()]);
    const data = await getLogSheetData(NOW);
    expect(data.todaysMeals).toHaveLength(1);
    expect(data.todaysMeals[0].dateISO).toBe(NOW.toISOString());
  });

  it("passes null macro fields through unchanged (no zero-collapse at row level)", async () => {
    mockNutritionLog.findMany.mockResolvedValue([
      rawRow({ calories: null, proteinG: null, carbsG: null, fatG: null, fiberG: null, sodiumMg: null }),
    ]);
    const data = await getLogSheetData(NOW);
    expect(data.todaysMeals[0].macros).toEqual({
      calories: null,
      proteinG: null,
      carbsG: null,
      fatG: null,
      fiberG: null,
      sodiumMg: null,
    });
    // Sum-level collapse still happens: null rows contribute 0 to trackedSoFar.
    expect(data.trackedSoFar).toEqual({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0 });
  });

  it("sums plan macros into dayTarget when the resolved day has a nutrition plan with any macro > 0", async () => {
    vi.mocked(resolveDay).mockResolvedValue({
      nutritionPlan: {
        breakfast: { macros: { calories: 300, proteinG: 20, carbsG: 30, fatG: 10 } },
      },
    } as never);
    const data = await getLogSheetData(NOW);
    expect(data.dayTarget).toEqual({ calories: 300, proteinG: 20, carbsG: 30, fatG: 10 });
  });

  it("returns dayTarget null when nutritionPlan is null", async () => {
    vi.mocked(resolveDay).mockResolvedValue({ nutritionPlan: null } as never);
    const data = await getLogSheetData(NOW);
    expect(data.dayTarget).toBeNull();
  });

  it("passes getQuickPickFoods / listLibraryFoods results through unchanged", async () => {
    const quickPicks = [{ id: "q1" }];
    const library = [{ id: "l1" }, { id: "l2" }];
    vi.mocked(getQuickPickFoods).mockResolvedValue(quickPicks as never);
    vi.mocked(listLibraryFoods).mockResolvedValue(library as never);
    const data = await getLogSheetData(NOW);
    expect(data.quickPickFoods).toBe(quickPicks);
    expect(data.libraryFoods).toBe(library);
  });

  it("defaults now to new Date() when no argument is passed", async () => {
    await getLogSheetData();
    expect(mockNutritionLog.findMany).toHaveBeenCalled();
  });
});
