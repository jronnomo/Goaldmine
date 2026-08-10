// src/lib/nutrition-merge.test.ts
// Exhaustive coverage of the #295 append merge rules. These are the rules that
// keep items and macro columns in sync when a composed draft is folded into an
// existing NutritionLog row — the "two edit paths" gotcha made these load-bearing.

import { describe, it, expect } from "vitest";
import {
  mergeMacroField,
  mergeMealMacros,
  mergeMealItems,
  mergeMealNotes,
  mergeMealDraft,
  findAppendTarget,
  type MealMacros,
  type ExistingMealStub,
} from "@/lib/nutrition-merge";
import type { NutritionItem } from "@/lib/nutrition-log-ops";

const macros = (over: Partial<MealMacros> = {}): MealMacros => ({
  calories: null,
  proteinG: null,
  carbsG: null,
  fatG: null,
  fiberG: null,
  sodiumMg: null,
  ...over,
});

describe("mergeMacroField", () => {
  it("sums when both sides recorded a value", () => {
    expect(mergeMacroField(650, 200)).toBe(850);
    expect(mergeMacroField(0.5, 0.25)).toBe(0.75);
  });

  it("treats 0 as a recorded value, not an absence", () => {
    expect(mergeMacroField(0, 5)).toBe(5);
    expect(mergeMacroField(5, 0)).toBe(5);
    expect(mergeMacroField(0, 0)).toBe(0); // NOT null
  });

  it("nulls out when the existing side lacks the field", () => {
    expect(mergeMacroField(null, 200)).toBeNull();
  });

  it("nulls out when the appended side lacks the field", () => {
    expect(mergeMacroField(650, null)).toBeNull();
  });

  it("stays null when neither side recorded it", () => {
    expect(mergeMacroField(null, null)).toBeNull();
  });
});

describe("mergeMealMacros", () => {
  it("merges each of the six fields independently in one call", () => {
    const existing = macros({ calories: 650, proteinG: 40, fiberG: 5 });
    const appended = macros({ calories: 200, carbsG: 30, fiberG: 2 });
    expect(mergeMealMacros(existing, appended)).toEqual({
      calories: 850, // both → sum
      proteinG: null, // appended side missing → null-out
      carbsG: null, // existing side missing → null-out
      fatG: null, // both missing → null
      fiberG: 7, // both → sum
      sodiumMg: null, // both missing → null
    });
  });

  it("sums all six when fully recorded on both sides", () => {
    const a = macros({ calories: 500, proteinG: 30, carbsG: 40, fatG: 20, fiberG: 6, sodiumMg: 800 });
    const b = macros({ calories: 250, proteinG: 10, carbsG: 25, fatG: 5, fiberG: 3, sodiumMg: 300 });
    expect(mergeMealMacros(a, b)).toEqual({
      calories: 750,
      proteinG: 40,
      carbsG: 65,
      fatG: 25,
      fiberG: 9,
      sodiumMg: 1100,
    });
  });

  it("all-null both sides stays all-null", () => {
    expect(mergeMealMacros(macros(), macros())).toEqual(macros());
  });
});

describe("mergeMealItems", () => {
  const eggs: NutritionItem = { name: "eggs", qty: "3" };
  const toast: NutritionItem = { name: "toast", qty: "2 slices" };
  const shake: NutritionItem = { name: "protein shake" };

  it("concatenates with the existing row's items first", () => {
    expect(mergeMealItems([eggs, toast], [shake])).toEqual([eggs, toast, shake]);
  });

  it("empty existing → just the appended items", () => {
    expect(mergeMealItems([], [shake])).toEqual([shake]);
  });

  it("empty appended (macros-only append) → existing items unchanged", () => {
    expect(mergeMealItems([eggs], [])).toEqual([eggs]);
  });

  it("both empty → empty", () => {
    expect(mergeMealItems([], [])).toEqual([]);
  });

  it("preserves structured fields (amount/unit/source) untouched", () => {
    const structured: NutritionItem = {
      name: "97% beef",
      qty: "8 oz",
      amount: 8,
      unit: "oz",
      source: {
        basis: "100g",
        perBasis: {
          calories: 130,
          proteinG: 26,
          carbsG: 0,
          fatG: 3,
          fiberG: null,
          sodiumMg: 70,
        },
        portions: [{ key: "patty", label: "patty", grams: 113 }],
        foodId: "food-1",
      },
    };
    const merged = mergeMealItems([structured], [eggs]);
    expect(merged[0]).toEqual(structured);
    expect(merged[0]!.source).toBe(structured.source); // pass-through, not rebuilt
  });

  it("does not mutate its inputs", () => {
    const existing = [eggs];
    const appended = [shake];
    mergeMealItems(existing, appended);
    expect(existing).toEqual([eggs]);
    expect(appended).toEqual([shake]);
  });
});

describe("mergeMealNotes", () => {
  it("joins with a newline when both present, existing first", () => {
    expect(mergeMealNotes("pre-hike meal", "added a side")).toBe(
      "pre-hike meal\nadded a side",
    );
  });

  it("keeps the only present side", () => {
    expect(mergeMealNotes("pre-hike meal", null)).toBe("pre-hike meal");
    expect(mergeMealNotes(null, "added a side")).toBe("added a side");
  });

  it("null when neither present", () => {
    expect(mergeMealNotes(null, null)).toBeNull();
  });

  it("treats whitespace-only as absent", () => {
    expect(mergeMealNotes("   ", "added a side")).toBe("added a side");
    expect(mergeMealNotes("pre-hike meal", "  ")).toBe("pre-hike meal");
    expect(mergeMealNotes("  ", "")).toBeNull();
  });
});

describe("mergeMealDraft", () => {
  const eggs: NutritionItem = { name: "eggs", qty: "3" };
  const shake: NutritionItem = { name: "protein shake" };

  it("both sides fully recorded: items concat + macros summed + notes joined", () => {
    const merged = mergeMealDraft(
      {
        items: [eggs],
        macros: macros({ calories: 400, proteinG: 25, carbsG: 10, fatG: 22 }),
        notes: "breakfast",
      },
      {
        items: [shake],
        macros: macros({ calories: 180, proteinG: 30, carbsG: 8, fatG: 3 }),
        notes: "post-workout add",
      },
    );
    expect(merged).toEqual({
      items: [eggs, shake],
      macros: macros({ calories: 580, proteinG: 55, carbsG: 18, fatG: 25 }),
      notes: "breakfast\npost-workout add",
    });
  });

  it("one-side-null macros: recorded fields on the other side null out; shared fields sum", () => {
    const merged = mergeMealDraft(
      { items: [eggs], macros: macros({ calories: 400, proteinG: 25 }), notes: null },
      { items: [shake], macros: macros({ calories: 180 }), notes: null },
    );
    // calories: both → 580. proteinG: appended lacks it → null (the combined
    // row's protein is no longer known — never persist a partial sum).
    expect(merged.macros).toEqual(macros({ calories: 580 }));
    expect(merged.items).toEqual([eggs, shake]);
  });

  it("macros-only append (empty appended items) sums into the existing row", () => {
    const merged = mergeMealDraft(
      { items: [eggs], macros: macros({ calories: 400 }), notes: null },
      { items: [], macros: macros({ calories: 200 }), notes: null },
    );
    expect(merged.items).toEqual([eggs]);
    expect(merged.macros.calories).toBe(600);
  });

  it("appending items into a macros-only (itemless) existing row", () => {
    const merged = mergeMealDraft(
      { items: [], macros: macros({ calories: 300 }), notes: null },
      { items: [shake], macros: macros({ calories: 180 }), notes: null },
    );
    expect(merged.items).toEqual([shake]);
    expect(merged.macros.calories).toBe(480);
  });
});

describe("findAppendTarget", () => {
  const stub = (over: Partial<ExistingMealStub>): ExistingMealStub => ({
    id: "row-1",
    dateKey: "2026-08-05",
    mealType: "lunch",
    itemCount: 2,
    dateISO: "2026-08-05T18:10:00.000Z",
    ...over,
  });

  it("null for undefined / empty stubs", () => {
    expect(findAppendTarget(undefined, "2026-08-05", "lunch")).toBeNull();
    expect(findAppendTarget([], "2026-08-05", "lunch")).toBeNull();
  });

  it("null when nothing matches the composed day", () => {
    expect(
      findAppendTarget([stub({ dateKey: "2026-08-04" })], "2026-08-05", "lunch"),
    ).toBeNull();
  });

  it("null when nothing matches the composed slot", () => {
    expect(
      findAppendTarget([stub({ mealType: "dinner" })], "2026-08-05", "lunch"),
    ).toBeNull();
  });

  it("returns the single same-day same-slot match", () => {
    const s = stub({});
    expect(findAppendTarget([s], "2026-08-05", "lunch")).toBe(s);
  });

  it("ignores same-slot rows on other days and other-slot rows on the same day", () => {
    const match = stub({ id: "match" });
    const stubs = [
      stub({ id: "other-day", dateKey: "2026-08-04" }),
      stub({ id: "other-slot", mealType: "snack" }),
      match,
    ];
    expect(findAppendTarget(stubs, "2026-08-05", "lunch")?.id).toBe("match");
  });

  it("multiple same-slot rows: the most recent wins, regardless of input order", () => {
    const early = stub({ id: "early", dateISO: "2026-08-05T17:00:00.000Z" });
    const late = stub({ id: "late", dateISO: "2026-08-05T19:30:00.000Z" });
    expect(findAppendTarget([early, late], "2026-08-05", "lunch")?.id).toBe("late");
    expect(findAppendTarget([late, early], "2026-08-05", "lunch")?.id).toBe("late");
  });
});
