// src/lib/saved-meal.test.ts
// #275: pure scaling math for logging a NutritionLog from a SavedMeal —
// servings × macros, defaultServings denominator, qty annotation, defensive
// Json parsing. No DB, no mocks (saved-meal.ts is pure by convention).

import { describe, it, expect } from "vitest";
import {
  annotateItemsForFactor,
  deriveSavedMealLog,
  parseSavedMealItems,
  parseSavedMealMacros,
  savedMealScaleFactor,
  scaleSavedMealMacros,
} from "@/lib/saved-meal";

// The two meals the Phase 2A import seeds (see TOOL-DIFFS.md #275 entry).
const BROOKIE_MACROS = { calories: 310, fatG: 6.5, proteinG: 31, carbsG: 42.5 };
const CHIPOTLE_MACROS = { calories: 670, fatG: 20, proteinG: 71, carbsG: 60 };

describe("savedMealScaleFactor", () => {
  it("servings ÷ defaultServings", () => {
    expect(savedMealScaleFactor(1, 1)).toBe(1);
    expect(savedMealScaleFactor(2, 1)).toBe(2);
    expect(savedMealScaleFactor(1, 2)).toBe(0.5);
    expect(savedMealScaleFactor(3, 2)).toBe(1.5);
  });

  it("treats a non-positive defaultServings (bad data) as 1", () => {
    expect(savedMealScaleFactor(2, 0)).toBe(2);
    expect(savedMealScaleFactor(2, -3)).toBe(2);
  });
});

describe("scaleSavedMealMacros", () => {
  it("multiplies every present macro by the factor (2 brookies)", () => {
    expect(scaleSavedMealMacros(BROOKIE_MACROS, 2)).toEqual({
      calories: 620,
      fatG: 13,
      proteinG: 62,
      carbsG: 85,
    });
  });

  it("half a Chipotle bowl", () => {
    expect(scaleSavedMealMacros(CHIPOTLE_MACROS, 0.5)).toEqual({
      calories: 335,
      fatG: 10,
      proteinG: 35.5,
      carbsG: 30,
    });
  });

  it("rounds scaled values to one decimal", () => {
    // 310 × 1/3 = 103.333… → 103.3
    expect(scaleSavedMealMacros({ calories: 310 }, 1 / 3)).toEqual({ calories: 103.3 });
  });

  it("factor 1 returns the macros unchanged", () => {
    expect(scaleSavedMealMacros(BROOKIE_MACROS, 1)).toEqual(BROOKIE_MACROS);
  });

  it("returns undefined for missing/empty macros", () => {
    expect(scaleSavedMealMacros(undefined, 2)).toBeUndefined();
    expect(scaleSavedMealMacros({}, 2)).toBeUndefined();
  });

  it("skips absent fields instead of inventing zeros", () => {
    expect(scaleSavedMealMacros({ proteinG: 31 }, 2)).toEqual({ proteinG: 62 });
  });
});

describe("annotateItemsForFactor", () => {
  const items = [
    { name: "Protein Brookie", qty: "1 brookie" },
    { name: "Whipped cream", notes: "optional" },
  ];

  it("factor 1: items pass through untouched (fresh copies)", () => {
    const out = annotateItemsForFactor(items, 1);
    expect(out).toEqual(items);
    expect(out[0]).not.toBe(items[0]); // copy, not shared reference
  });

  it("factor ≠ 1: existing qty gets a ×factor suffix, missing qty gets a marker", () => {
    expect(annotateItemsForFactor(items, 2)).toEqual([
      { name: "Protein Brookie", qty: "1 brookie ×2" },
      { name: "Whipped cream", qty: "×2 of saved qty", notes: "optional" },
    ]);
  });

  it("fractional factors format trimmed (0.5, 1.33 — never 2.00)", () => {
    expect(annotateItemsForFactor(items, 0.5)[0]!.qty).toBe("1 brookie ×0.5");
    expect(annotateItemsForFactor(items, 4 / 3)[0]!.qty).toBe("1 brookie ×1.33");
  });
});

describe("parseSavedMealItems / parseSavedMealMacros (defensive Json parsing)", () => {
  it("keeps only well-formed item rows", () => {
    expect(
      parseSavedMealItems([
        { name: "Chicken", qty: "8 oz", notes: "double" },
        { name: "Rice", qty: 2 }, // non-string qty dropped, row kept
        { qty: "no name" }, // no name → dropped
        "garbage",
        null,
      ]),
    ).toEqual([{ name: "Chicken", qty: "8 oz", notes: "double" }, { name: "Rice" }]);
  });

  it("non-array items Json → []", () => {
    expect(parseSavedMealItems(null)).toEqual([]);
    expect(parseSavedMealItems({ name: "not an array" })).toEqual([]);
  });

  it("keeps only finite numeric macro keys", () => {
    expect(
      parseSavedMealMacros({ calories: 670, proteinG: "71", fatG: NaN, junk: 5 }),
    ).toEqual({ calories: 670 });
  });

  it("null / non-object / empty macros Json → undefined", () => {
    expect(parseSavedMealMacros(null)).toBeUndefined();
    expect(parseSavedMealMacros([1, 2])).toBeUndefined();
    expect(parseSavedMealMacros({ junk: 1 })).toBeUndefined();
  });
});

describe("deriveSavedMealLog (end-to-end derivation)", () => {
  const mealRow = {
    items: [{ name: "Chipotle Protein Bowl", qty: "1 bowl" }],
    macros: CHIPOTLE_MACROS,
    defaultServings: 1,
  };

  it("servings=1, defaultServings=1 → verbatim items + macros, factor 1", () => {
    expect(deriveSavedMealLog(mealRow, 1)).toEqual({
      items: [{ name: "Chipotle Protein Bowl", qty: "1 bowl" }],
      macros: CHIPOTLE_MACROS,
      factor: 1,
    });
  });

  it("servings=2 → doubled macros and annotated qty", () => {
    expect(deriveSavedMealLog(mealRow, 2)).toEqual({
      items: [{ name: "Chipotle Protein Bowl", qty: "1 bowl ×2" }],
      macros: { calories: 1340, fatG: 40, proteinG: 142, carbsG: 120 },
      factor: 2,
    });
  });

  it("batch meal (defaultServings=4), one serving eaten → quarter macros", () => {
    const batch = {
      items: [{ name: "Chili batch", qty: "1 pot" }],
      macros: { calories: 2000, proteinG: 160 },
      defaultServings: 4,
    };
    expect(deriveSavedMealLog(batch, 1)).toEqual({
      items: [{ name: "Chili batch", qty: "1 pot ×0.25" }],
      macros: { calories: 500, proteinG: 40 },
      factor: 0.25,
    });
  });

  it("meal without stored macros → macros undefined, items still derived", () => {
    const noMacros = { items: [{ name: "Salad" }], macros: null, defaultServings: 1 };
    expect(deriveSavedMealLog(noMacros, 3)).toEqual({
      items: [{ name: "Salad", qty: "×3 of saved qty" }],
      macros: undefined,
      factor: 3,
    });
  });
});
