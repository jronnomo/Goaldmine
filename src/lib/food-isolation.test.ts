// src/lib/food-isolation.test.ts
// Tests per-user FoodUsage isolation WITHOUT a live DB.
// Uses vi.mock to intercept getDb() and prisma, verifying that:
//   1. Write functions (bumpFoodUsage via recordFoodUse, setFoodFavorite, deleteLibraryFood)
//      call getDb() (not raw prisma) for FoodUsage writes.
//   2. deleteLibraryFood calls foodUsage.deleteMany (not foodLibrary.deleteMany).
//   3. setFoodFavorite creates a FoodUsage row when user has never logged the food.
//   4. setFoodFavorite updates existing FoodUsage when the row already exists.
//   5. P2002 race in bumpFoodUsage (concurrent double-tap) retries with update.
// The actual userId injection is tested in db.scoped.test.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── hoisted mocks ────────────────────────────────────────────────────────────
// vi.mock factories are hoisted before variable declarations, so mocks must be
// defined via vi.hoisted() to avoid "Cannot access before initialization" errors.

const { mockFoodUsage, mockFoodLibrary, mockDb, mockPrisma } = vi.hoisted(() => {
  const mockFoodUsage = {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  };
  const mockFoodLibrary = {
    deleteMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  };
  const mockDb = { foodUsage: mockFoodUsage };
  const mockPrisma = { foodLibrary: mockFoodLibrary };
  return { mockFoodUsage, mockFoodLibrary, mockDb, mockPrisma };
});

vi.mock("@/lib/db", () => ({
  prisma: mockPrisma,
  getDb: vi.fn().mockResolvedValue(mockDb),
}));

import { deleteLibraryFood, setFoodFavorite, recordFoodUse } from "@/lib/food-actions";

// ── tests ────────────────────────────────────────────────────────────────────

describe("deleteLibraryFood — semantic change (E-1)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes FoodUsage (not FoodLibrary) — shared catalog row preserved", async () => {
    mockFoodUsage.deleteMany.mockResolvedValue({ count: 1 });
    await deleteLibraryFood("fl_1");
    expect(mockFoodUsage.deleteMany).toHaveBeenCalledWith({ where: { foodId: "fl_1" } });
    expect(mockFoodLibrary.deleteMany).not.toHaveBeenCalled();
  });

  it("is idempotent when no FoodUsage row exists (deleteMany returns count 0)", async () => {
    mockFoodUsage.deleteMany.mockResolvedValue({ count: 0 });
    // Should not throw
    await deleteLibraryFood("fl_missing");
    expect(mockFoodUsage.deleteMany).toHaveBeenCalledWith({ where: { foodId: "fl_missing" } });
  });
});

describe("setFoodFavorite — creates FoodUsage if absent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a FoodUsage row when user has never used the food", async () => {
    mockFoodUsage.findFirst.mockResolvedValue(null);
    mockFoodUsage.create.mockResolvedValue({ id: "fu_1", foodId: "fl_1", isFavorite: true });
    const result = await setFoodFavorite("fl_1", true);
    expect(result).toEqual({ ok: true });
    expect(mockFoodUsage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ foodId: "fl_1", isFavorite: true, usageCount: 0 }),
      }),
    );
    expect(mockFoodUsage.update).not.toHaveBeenCalled();
  });

  it("updates existing FoodUsage when row exists", async () => {
    mockFoodUsage.findFirst.mockResolvedValue({ id: "fu_1", foodId: "fl_1" });
    mockFoodUsage.update.mockResolvedValue({ id: "fu_1", isFavorite: false });
    const result = await setFoodFavorite("fl_1", false);
    expect(result).toEqual({ ok: true });
    expect(mockFoodUsage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "fu_1" },
        data: { isFavorite: false },
      }),
    );
    expect(mockFoodUsage.create).not.toHaveBeenCalled();
  });

  it("returns ok:false on error (never throws)", async () => {
    mockFoodUsage.findFirst.mockRejectedValue(new Error("DB error"));
    const result = await setFoodFavorite("fl_1", true);
    expect(result).toEqual({ ok: false });
  });
});

describe("recordFoodUse (bumpFoodUsage) — P2002 race retry", () => {
  beforeEach(() => vi.clearAllMocks());

  it("increments FoodUsage when row exists", async () => {
    mockFoodUsage.findFirst.mockResolvedValue({ id: "fu_1", foodId: "fl_1" });
    mockFoodUsage.update.mockResolvedValue({ id: "fu_1", usageCount: 2 });
    await recordFoodUse("fl_1");
    expect(mockFoodUsage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "fu_1" },
        data: expect.objectContaining({ usageCount: { increment: 1 } }),
      }),
    );
    expect(mockFoodUsage.create).not.toHaveBeenCalled();
  });

  it("creates FoodUsage row on first use", async () => {
    mockFoodUsage.findFirst.mockResolvedValue(null);
    mockFoodUsage.create.mockResolvedValue({ id: "fu_new", foodId: "fl_1", usageCount: 1 });
    await recordFoodUse("fl_1");
    expect(mockFoodUsage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ foodId: "fl_1", usageCount: 1 }),
      }),
    );
  });

  it("retries with update when create throws P2002 (concurrent double-tap)", async () => {
    const p2002 = Object.assign(new Error("Unique constraint failed on the fields: (userId,foodId)"), {
      code: "P2002",
    });
    // First findFirst: no row (race window)
    // Second findFirst (in retry): row now exists
    mockFoodUsage.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "fu_raced", foodId: "fl_1" });
    mockFoodUsage.create.mockRejectedValueOnce(p2002);
    mockFoodUsage.update.mockResolvedValue({ id: "fu_raced", usageCount: 2 });

    await recordFoodUse("fl_1");

    expect(mockFoodUsage.create).toHaveBeenCalledTimes(1);
    expect(mockFoodUsage.update).toHaveBeenCalledTimes(1);
    expect(mockFoodUsage.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "fu_raced" } }),
    );
  });

  it("re-throws non-P2002 errors from create", async () => {
    mockFoodUsage.findFirst.mockResolvedValue(null);
    const unexpected = Object.assign(new Error("Foreign key violation"), { code: "P2003" });
    mockFoodUsage.create.mockRejectedValueOnce(unexpected);
    await expect(recordFoodUse("fl_bad")).rejects.toThrow("Foreign key violation");
  });
});
