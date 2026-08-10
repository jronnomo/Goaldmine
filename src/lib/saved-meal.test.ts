// src/lib/saved-meal.test.ts
// #275: pure scaling math for logging a NutritionLog from a SavedMeal —
// servings × macros, defaultServings denominator, qty annotation, defensive
// Json parsing. No DB, no mocks (saved-meal.ts is pure by convention).
// 2026-08: food-linked bundle expansion — per-item scaling from the save-time
// source snapshot, bundle-log ⇄ hand-log row equality (the owner's core
// requirement), residual credit math, composition capture.

import { describe, it, expect } from "vitest";
import {
  annotateItemsForFactor,
  buildSavedMealItemsFromComposition,
  deriveSavedMealLog,
  linkedFoodPortions,
  parseSavedMealItems,
  parseSavedMealMacros,
  savedMealScaleFactor,
  scaleSavedMealMacros,
} from "@/lib/saved-meal";
import {
  buildItemSnapshot,
  buildQtyDisplay,
  defaultUnitForQuery,
  deriveAmountFromServings,
  recomposeWithResidual,
  withItemMacros,
} from "@/lib/food-units";
import type { LibraryFood } from "@/lib/food-types";
import type { NutritionItem } from "@/lib/nutrition-log-ops";

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
      // Text-only meal → the composer credit is the whole lump (unchanged
      // pre-bundle behavior).
      residualMacros: CHIPOTLE_MACROS,
      factor: 1,
    });
  });

  it("servings=2 → doubled macros and annotated qty", () => {
    expect(deriveSavedMealLog(mealRow, 2)).toEqual({
      items: [{ name: "Chipotle Protein Bowl", qty: "1 bowl ×2" }],
      macros: { calories: 1340, fatG: 40, proteinG: 142, carbsG: 120 },
      residualMacros: { calories: 1340, fatG: 40, proteinG: 142, carbsG: 120 },
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
      residualMacros: { calories: 500, proteinG: 40 },
      factor: 0.25,
    });
  });

  it("meal without stored macros → macros undefined, items still derived", () => {
    const noMacros = { items: [{ name: "Salad" }], macros: null, defaultServings: 1 };
    expect(deriveSavedMealLog(noMacros, 3)).toEqual({
      items: [{ name: "Salad", qty: "×3 of saved qty" }],
      macros: undefined,
      residualMacros: undefined,
      factor: 3,
    });
  });
});

// ── Food-linked bundles (2026-08) ─────────────────────────────────────────────

// Two library foods, one per basis kind.
const BEEF: LibraryFood = {
  id: "food-beef",
  barcode: null,
  name: "97% Lean Beef",
  brand: null,
  servingSize: null,
  basis: "100g",
  perServing: { calories: 130, proteinG: 21, carbsG: 0, fatG: 4.5, fiberG: 0, sodiumMg: 65 },
};
const BUN: LibraryFood = {
  id: "food-bun",
  barcode: null,
  name: "Kroger Hamburger Buns",
  brand: "Kroger",
  servingSize: "1 bun",
  basis: "serving",
  perServing: { calories: 140, proteinG: 5, carbsG: 26, fatG: 2, fiberG: 1, sodiumMg: 230 },
};

/**
 * Replicates useFoodComposer.handleAdd byte-for-byte: the EXACT structured
 * item the composer stores when the user picks this food by hand at
 * `servings` × basis. If handleAdd's construction ever changes, this helper
 * and the equality suite below must move with it.
 */
function handAdd(food: LibraryFood, servings: number): NutritionItem {
  const snapshot = buildItemSnapshot(food);
  const unit = snapshot.basis === "100g" ? "g" : defaultUnitForQuery(null, snapshot);
  const amount = deriveAmountFromServings(servings, unit, snapshot);
  const qty = buildQtyDisplay(amount, unit, snapshot);
  return withItemMacros({ name: food.name, qty, amount, unit, source: snapshot });
}

describe("deriveSavedMealLog — food-linked bundle expansion", () => {
  // The bundle: exactly what "Save as meal" captures from a composer where
  // the user hand-added 2 servings of beef (200 g) and 1 bun.
  const handItems = [handAdd(BEEF, 2), handAdd(BUN, 1)];
  const composerTotals = recomposeWithResidual({}, [], handItems);
  const bundle = {
    items: buildSavedMealItemsFromComposition(handItems),
    macros: composerTotals,
    defaultServings: 1,
  };

  it("OWNER'S CORE REQUIREMENT — servings=1: bundle rows are deep-equal to the hand-added rows", () => {
    const derived = deriveSavedMealLog(bundle, 1);
    // Items: identical shape, values, source snapshots, per-item macros.
    expect(derived.items).toEqual(handItems);
    // Macros: identical to what the composer derives for the same items.
    expect(derived.macros).toEqual(composerTotals);
    // Fully-linked bundle → NO lump credit; the composer self-computes from
    // the items, exactly like a hand-built meal.
    expect(derived.residualMacros).toBeUndefined();
  });

  it("servings=2: every linked item scales its amount — equal to hand-adding double", () => {
    const doubled = [handAdd(BEEF, 4), handAdd(BUN, 2)]; // 400 g + 2 servings
    const derived = deriveSavedMealLog(bundle, 2);
    expect(derived.items).toEqual(doubled);
    expect(derived.macros).toEqual(recomposeWithResidual({}, [], doubled));
    expect(derived.residualMacros).toBeUndefined();
  });

  it("servings=0.5 (fractions are the point): half amounts, per-item macros recomputed at the scaled portion", () => {
    const halved = [handAdd(BEEF, 1), handAdd(BUN, 0.5)]; // 100 g + 0.5 servings
    const derived = deriveSavedMealLog(bundle, 0.5);
    expect(derived.items).toEqual(halved);
    // Per-item macros at 100 g of beef: exact per-100g values.
    expect(derived.items[0]!.itemMacros).toEqual({
      calories: 130, proteinG: 21, carbsG: 0, fatG: 4.5, fiberG: 0, sodiumMg: 65,
    });
    // Bun at half a serving: house 1dp/int rounding via the shared scaler.
    expect(derived.items[1]!.itemMacros).toEqual({
      calories: 70, proteinG: 2.5, carbsG: 13, fatG: 1, fiberG: 0.5, sodiumMg: 115,
    });
    expect(derived.macros).toEqual(recomposeWithResidual({}, [], halved));
  });

  it("linked rows never leak the top-level foodId into the logged item (parity with the web round-trip)", () => {
    const derived = deriveSavedMealLog(bundle, 2);
    for (const it of derived.items) {
      expect("foodId" in it).toBe(false);
      expect(it.source?.foodId).toBeTruthy(); // linkage lives in the snapshot
    }
  });

  it("mixed bundle: linked items self-compute; the stored-macro surplus rides as a scaled residual", () => {
    // Beef (200 g → 260 cal / 42 P / 9 F / 130 Na) + a text-only sauce whose
    // 50 cal / 5 F were captured in the stored totals only.
    const mixed = {
      items: [
        ...buildSavedMealItemsFromComposition([handAdd(BEEF, 2)]),
        { name: "Secret sauce" },
      ],
      macros: { calories: 310, proteinG: 42, fatG: 14 },
      defaultServings: 1,
    };

    const at1 = deriveSavedMealLog(mixed, 1);
    expect(at1.residualMacros).toEqual({ calories: 50, fatG: 5 });
    expect(at1.macros).toEqual({
      calories: 310, proteinG: 42, carbsG: 0, fatG: 14, fiberG: 0, sodiumMg: 130,
    });
    expect(at1.items[1]).toEqual({ name: "Secret sauce" });

    const at2 = deriveSavedMealLog(mixed, 2);
    expect(at2.residualMacros).toEqual({ calories: 100, fatG: 10 });
    expect(at2.macros).toEqual({
      calories: 620, proteinG: 84, carbsG: 0, fatG: 28, fiberG: 0, sodiumMg: 260,
    });
    expect(at2.items[0]!.amount).toBe(400);
    expect(at2.items[1]).toEqual({ name: "Secret sauce", qty: "×2 of saved qty" });
  });

  it("a stored-macro key ABSENT means 'not estimated', never zero — item-derived keys still flow", () => {
    // Stored macros only carry calories; protein/fat/sodium must come from the
    // linked item, NOT get zeroed by a phantom negative residual.
    const meal = {
      items: buildSavedMealItemsFromComposition([handAdd(BEEF, 2)]),
      macros: { calories: 260 },
      defaultServings: 1,
    };
    const derived = deriveSavedMealLog(meal, 1);
    expect(derived.residualMacros).toBeUndefined(); // 260 − 260 = 0 → dropped
    expect(derived.macros).toEqual({
      calories: 260, proteinG: 42, carbsG: 0, fatG: 9, fiberG: 0, sodiumMg: 130,
    });
  });

  it("text-only item WITH itemMacros (no source): qty annotates, snapshot scales by the factor", () => {
    const meal = {
      items: [{ name: "Chipotle bowl", qty: "1 bowl", itemMacros: { calories: 670, proteinG: 71 } }],
      macros: { calories: 670, proteinG: 71 },
      defaultServings: 1,
    };
    const derived = deriveSavedMealLog(meal, 0.5);
    expect(derived.items).toEqual([
      { name: "Chipotle bowl", qty: "1 bowl ×0.5", itemMacros: { calories: 335, proteinG: 35.5 } },
    ]);
    // No linked (source-carrying) item → legacy lump path.
    expect(derived.macros).toEqual({ calories: 335, proteinG: 35.5 });
    expect(derived.residualMacros).toEqual({ calories: 335, proteinG: 35.5 });
  });
});

describe("parseSavedMealItems — food-linked fields round-trip", () => {
  it("keeps foodId, amount, unit, itemMacros, and a valid source snapshot", () => {
    const source = buildItemSnapshot(BEEF);
    const rows = parseSavedMealItems([
      {
        name: "97% Lean Beef",
        qty: "200 g",
        foodId: "food-beef",
        amount: 200,
        unit: "g",
        itemMacros: { calories: 260, proteinG: 42 },
        source,
      },
    ]);
    expect(rows).toEqual([
      {
        name: "97% Lean Beef",
        qty: "200 g",
        foodId: "food-beef",
        amount: 200,
        unit: "g",
        itemMacros: { calories: 260, proteinG: 42 },
        source,
      },
    ]);
  });

  it("drops malformed source / non-finite itemMacros values, keeps the row", () => {
    const rows = parseSavedMealItems([
      {
        name: "Beef",
        foodId: "food-beef",
        source: { basis: "nonsense" }, // invalid snapshot
        itemMacros: { calories: NaN, proteinG: 42, junk: 9 },
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.source).toBeUndefined();
    expect(rows[0]!.itemMacros).toEqual({ proteinG: 42 });
    expect(rows[0]!.foodId).toBe("food-beef");
  });
});

describe("buildSavedMealItemsFromComposition — the 'Save as meal' capture", () => {
  it("lifts foodId from the source snapshot and keeps the full per-item state", () => {
    const captured = buildSavedMealItemsFromComposition([handAdd(BEEF, 2), handAdd(BUN, 1)]);
    expect(captured[0]).toMatchObject({
      name: "97% Lean Beef",
      foodId: "food-beef",
      amount: 200,
      unit: "g",
      itemMacros: { calories: 260, proteinG: 42, carbsG: 0, fatG: 9, fiberG: 0, sodiumMg: 130 },
    });
    expect(captured[0]!.source).toEqual(buildItemSnapshot(BEEF));
    expect(captured[1]).toMatchObject({ foodId: "food-bun", amount: 1, unit: "serving" });
  });

  it("computes itemMacros when the composed item lacks them; freehand items stay text rows", () => {
    const noIM: NutritionItem = { ...handAdd(BEEF, 1) };
    delete noIM.itemMacros;
    const captured = buildSavedMealItemsFromComposition([noIM, { name: "splash of milk" }]);
    expect(captured[0]!.itemMacros).toEqual({
      calories: 130, proteinG: 21, carbsG: 0, fatG: 4.5, fiberG: 0, sodiumMg: 65,
    });
    expect(captured[1]).toEqual({ name: "splash of milk" });
  });
});

describe("linkedFoodPortions — the FoodUsage bump feed", () => {
  it("reads source.foodId on expanded rows and top-level foodId on stored rows; skips unlinked", () => {
    expect(
      linkedFoodPortions([
        handAdd(BEEF, 2), // expanded/hand row: link inside source
        { name: "Bun", foodId: "food-bun", amount: 1, unit: "serving" }, // stored row (no source)
        { name: "Secret sauce" }, // unlinked
      ]),
    ).toEqual([
      { foodId: "food-beef", amount: 200, unit: "g" },
      { foodId: "food-bun", amount: 1, unit: "serving" },
    ]);
  });

  it("a link without a resolvable portion still counts (bump without portion memory)", () => {
    expect(linkedFoodPortions([{ name: "Beef", foodId: "food-beef" }])).toEqual([
      { foodId: "food-beef" },
    ]);
  });
});
