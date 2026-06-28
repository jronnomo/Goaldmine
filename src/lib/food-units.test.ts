import { describe, it, expect } from "vitest";
import type { ItemFoodSnapshot, NutritionItem } from "@/lib/nutrition-log-ops";
import type { MacroKey, LibraryFood } from "@/lib/food-types";
import {
  recalcItemMacros,
  sumStructuredMacros,
  recomposeMacros,
  recomposeWithResidual,
  deriveAmountFromServings,
  servingsFromLastPortion,
} from "@/lib/food-units";

type MacroValues = Partial<Record<MacroKey, number | null>>;

// ── Fixtures ────────────────────────────────────────────────────────────────

// Mirrors the real builtin:potato FoodLibrary row (basis 100g, USDA reference).
const POTATO: ItemFoodSnapshot = {
  basis: "100g",
  perBasis: { calories: 77, proteinG: 2, carbsG: 17.5, fatG: 0.1, fiberG: 2.2, sodiumMg: 6 },
  portions: [
    { key: "small", label: "small (170 g)", grams: 170 },
    { key: "medium", label: "medium (213 g)", grams: 213 },
    { key: "large", label: "large (299 g)", grams: 299 },
  ],
};

// A serving-basis food (e.g. a whey scoop) — perBasis is per 1 serving.
const WHEY: ItemFoodSnapshot = {
  basis: "serving",
  perBasis: { calories: 120, proteinG: 24, carbsG: 3, fatG: 1.5, fiberG: 0, sodiumMg: 130 },
  portions: [],
};

/** Build a chip/scan-added item exactly as handleAdd now does for a 100g food. */
function potatoGramsItem(servings: number): NutritionItem {
  const amount = deriveAmountFromServings(servings, "g", POTATO); // Math.round(servings*100)
  return { name: "Potato (raw)", amount, unit: "g", source: POTATO, qty: `${amount} g` };
}

function servingItem(snapshot: ItemFoodSnapshot, servings: number): NutritionItem {
  return { name: "Whey", amount: servings, unit: "serving", source: snapshot, qty: `${servings} serving` };
}

/**
 * Fold items one-at-a-time through the ADD path's macro authority
 * (recomposeWithResidual), exactly as MealComposer.addItemToComposer does.
 */
function foldAdd(items: NutritionItem[]): MacroValues {
  let macros: MacroValues = {};
  let prev: NutritionItem[] = [];
  for (const item of items) {
    const next = [...prev, item];
    macros = recomposeWithResidual(macros, prev, next);
    prev = next;
  }
  return macros;
}

// ── 1. Core invariant ─────────────────────────────────────────────────────────
// For a fully-structured meal, the incrementally-added total must equal the
// pure item-derived total — i.e. NO phantom residual ever accrues.

describe("add path keeps total === item-derived sum (no phantom residual)", () => {
  const cases: Record<string, NutritionItem[]> = {
    "100g-with-portions": [potatoGramsItem(1), potatoGramsItem(1.7)],
    "serving-basis": [servingItem(WHEY, 1), servingItem(WHEY, 2)],
    mixed: [potatoGramsItem(1.5), servingItem(WHEY, 1), potatoGramsItem(0.5)],
  };

  for (const [name, items] of Object.entries(cases)) {
    it(name, () => {
      const incremental = foldAdd(items);
      const pure = recomposeMacros(sumStructuredMacros(items), {});
      expect(incremental).toEqual(pure);
    });
  }
});

// ── 2. Potato regression (the reported bug) ─────────────────────────────────────

describe("potato chip add yields correct, residual-free macros", () => {
  it("servings 1 → 100 g ≈ 77 cal", () => {
    const item = potatoGramsItem(1);
    expect(item.unit).toBe("g");
    expect(item.amount).toBe(100);
    expect(recalcItemMacros(item)).toEqual({
      calories: 77, proteinG: 2, carbsG: 17.5, fatG: 0.1, fiberG: 2.2, sodiumMg: 6,
    });
    // Composing onto an empty meal must equal the item itself — no drift to 465.
    expect(foldAdd([item])).toEqual(
      recomposeMacros(sumStructuredMacros([item]), {}),
    );
  });

  it("servings 1.7 → 170 g ≈ 131 cal (the '1 small (170 g)' case)", () => {
    const item = potatoGramsItem(1.7);
    expect(item.amount).toBe(170);
    expect(recalcItemMacros(item)).toEqual({
      calories: 131, proteinG: 3.4, carbsG: 29.8, fatG: 0.2, fiberG: 3.7, sodiumMg: 10,
    });
    const total = foldAdd([item]);
    expect(total.calories).toBe(131);
    expect(total.proteinG).toBe(3.4);
    // Definitively NOT the buggy 465 / 30.8 / 84.3 / 3.1.
    expect(total.calories).not.toBe(465);
  });
});

// ── 3. Grams rounding ───────────────────────────────────────────────────────────

describe("deriveAmountFromServings('g') returns integer grams", () => {
  it.each([
    [0.5, 50],
    [1, 100],
    [1.5, 150],
    [2, 200],
  ])("servings %s → %s g", (servings, grams) => {
    expect(deriveAmountFromServings(servings, "g", POTATO)).toBe(grams);
  });
});

// ── 4. Heal-on-seed ─────────────────────────────────────────────────────────────
// Edit-mode seed for a fully-structured meal discards stored (possibly corrupt)
// macros and derives the total from the items.

describe("heal-on-seed discards stored macros for fully-structured meals", () => {
  it("recomposeWithResidual({}, [], items) === item-derived total", () => {
    const items = [potatoGramsItem(1.7), servingItem(WHEY, 1)];
    const seeded = recomposeWithResidual({}, [], items);
    expect(seeded).toEqual(recomposeMacros(sumStructuredMacros(items), {}));
    // The 465-cal corruption never survives the heal.
    expect(seeded.calories).toBe(131 + 120);
  });
});

// ── 5. servingsFromLastPortion (stepper seed) ───────────────────────────────────
// Converts a stored last-logged (amount, unit) back into the ScanFoodSheet
// servings multiplier; inverse of deriveAmountFromServings.

const POTATO_FOOD: LibraryFood = {
  id: "f1", barcode: null, name: "Potato", brand: null, servingSize: null,
  basis: "100g", perServing: POTATO.perBasis,
};
const WHEY_FOOD: LibraryFood = {
  id: "f2", barcode: null, name: "Whey", brand: null, servingSize: "1 scoop",
  basis: "serving", perServing: WHEY.perBasis,
};

describe("servingsFromLastPortion seeds the stepper from the last log", () => {
  it("100g basis, grams → grams/100", () => {
    expect(servingsFromLastPortion(POTATO_FOOD, 150, "g")).toBe(1.5);
    expect(servingsFromLastPortion(POTATO_FOOD, 100, "g")).toBe(1);
  });

  it("100g basis, oz → grams via OZ_TO_G then /100", () => {
    expect(servingsFromLastPortion(POTATO_FOOD, 1, "oz")).toBeCloseTo(0.283495, 5);
  });

  it("serving basis, serving → amount verbatim", () => {
    expect(servingsFromLastPortion(WHEY_FOOD, 2, "serving")).toBe(2);
  });

  it("returns null for unusable portions (seed falls back to 1)", () => {
    expect(servingsFromLastPortion(POTATO_FOOD, null, "g")).toBeNull();
    expect(servingsFromLastPortion(POTATO_FOOD, 0, "g")).toBeNull();
    expect(servingsFromLastPortion(WHEY_FOOD, 2, "g")).toBeNull(); // wrong unit for basis
    expect(servingsFromLastPortion(POTATO_FOOD, 1, "small")).toBeNull(); // no portions on plain row
  });

  it("round-trips with deriveAmountFromServings for grams", () => {
    for (const s of [0.5, 1, 1.5, 2]) {
      const amount = deriveAmountFromServings(s, "g", POTATO);
      expect(servingsFromLastPortion(POTATO_FOOD, amount, "g")).toBe(s);
    }
  });
});
