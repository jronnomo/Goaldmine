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
    create: vi.fn(),
  };
  const mockDb = { foodUsage: mockFoodUsage };
  const mockPrisma = { foodLibrary: mockFoodLibrary };
  return { mockFoodUsage, mockFoodLibrary, mockDb, mockPrisma };
});

vi.mock("@/lib/db", () => ({
  prisma: mockPrisma,
  getDb: vi.fn().mockResolvedValue(mockDb),
}));

import {
  createLibraryFood,
  deleteLibraryFood,
  setFoodFavorite,
  recordFoodUse,
} from "@/lib/food-actions";

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

describe("createLibraryFood — custom (no-barcode) foods", () => {
  beforeEach(() => vi.clearAllMocks());

  const createdRow = {
    id: "fl_new",
    barcode: null,
    name: "Brookie (protein)",
    brand: null,
    servingSize: "1 brookie (½ batch)",
    basis: "serving",
    calories: 310,
    proteinG: 31,
    carbsG: 42.5,
    fatG: 6.5,
    fiberG: null,
    sodiumMg: null,
    source: "manual",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("creates the shared FoodLibrary row via raw prisma and seeds FoodUsage via getDb", async () => {
    mockFoodLibrary.create.mockResolvedValue(createdRow);
    mockFoodUsage.create.mockResolvedValue({ id: "fu_new" });

    const result = await createLibraryFood({
      name: "Brookie (protein)",
      servingSize: "1 brookie (½ batch)",
      calories: 310,
      proteinG: 31,
      carbsG: 42.5,
      fatG: 6.5,
      favorite: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.food.isFavorite).toBe(true);
    // Shared catalog row: raw prisma, source "manual" (self-heal never overwrites),
    // basis "serving" (hand-entered macros describe the typed portion).
    expect(mockFoodLibrary.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Brookie (protein)",
          basis: "serving",
          source: "manual",
          calories: 310,
          proteinG: 31,
        }),
      }),
    );
    // Per-user pin: goes through the scoped client (getDb), never raw prisma.
    expect(mockFoodUsage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ foodId: "fl_new", isFavorite: true, usageCount: 0 }),
      }),
    );
  });

  it("rejects an empty name without touching the DB", async () => {
    const result = await createLibraryFood({ name: "   ", calories: 100 });
    expect(result).toEqual({ ok: false, message: "Name is required" });
    expect(mockFoodLibrary.create).not.toHaveBeenCalled();
  });

  it("rejects when every macro is absent/invalid", async () => {
    const result = await createLibraryFood({ name: "Mystery", calories: -5, proteinG: NaN });
    expect(result.ok).toBe(false);
    expect(mockFoodLibrary.create).not.toHaveBeenCalled();
  });

  it("coerces negative/NaN macros to null while keeping valid ones", async () => {
    mockFoodLibrary.create.mockResolvedValue({ ...createdRow, carbsG: null, fatG: null });
    mockFoodUsage.create.mockResolvedValue({ id: "fu_new" });

    await createLibraryFood({ name: "Brookie (protein)", calories: 310, carbsG: -1, fatG: NaN });

    expect(mockFoodLibrary.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ calories: 310, carbsG: null, fatG: null }),
      }),
    );
  });

  it("strips pipes from name (LibraryFood contract) and defaults favorite to false", async () => {
    mockFoodLibrary.create.mockResolvedValue({ ...createdRow, name: "AB" });
    mockFoodUsage.create.mockResolvedValue({ id: "fu_new" });

    const result = await createLibraryFood({ name: "A|B", calories: 1 });

    expect(mockFoodLibrary.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: "AB" }) }),
    );
    expect(mockFoodUsage.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isFavorite: false }) }),
    );
    if (result.ok) expect(result.food.isFavorite).toBe(false);
  });
});
