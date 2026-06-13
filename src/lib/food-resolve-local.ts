// ── Imports ──────────────────────────────────────────────────────────────────
import type { FoodMacros, LibraryFood } from "@/lib/food-types";
import type { NutritionItem } from "@/lib/nutrition-log-ops";

// ── scaleMacros (extracted from food-actions.ts line 810) ────────────────────
/**
 * Scale a per-serving FoodMacros by a servings multiplier.
 * Extracted from food-actions.ts (was private) to allow client-side use.
 * food-actions.ts re-imports this function — behavior is IDENTICAL.
 *
 * Rounding rules (unchanged):
 *   calories, sodiumMg → Math.round (integer)
 *   proteinG, carbsG, fatG, fiberG → Math.round(v * s * 10) / 10 (1dp)
 */
export function scaleMacros(perServing: FoodMacros, servings: number): FoodMacros {
  function scaleInt(v: number | null): number | null {
    if (v == null) return null;
    return Math.round(v * servings);
  }
  function scale1dp(v: number | null): number | null {
    if (v == null) return null;
    return Math.round(v * servings * 10) / 10;
  }
  return {
    calories:  scaleInt(perServing.calories),
    proteinG:  scale1dp(perServing.proteinG),
    carbsG:    scale1dp(perServing.carbsG),
    fatG:      scale1dp(perServing.fatG),
    fiberG:    scale1dp(perServing.fiberG),
    sodiumMg:  scaleInt(perServing.sodiumMg),
  };
}

// ── classifyFood ─────────────────────────────────────────────────────────────
export type MacroGroup = "protein" | "carbs" | "fat" | "misc";

/**
 * Classify a library food by caloric-share dominance.
 *
 * Algorithm:
 *   pKcal = proteinG * 4
 *   cKcal = carbsG   * 4
 *   fKcal = fatG     * 9
 *   total = pKcal + cKcal + fKcal
 *
 * If total === 0 or all null → "misc"
 * Top macro wins if:
 *   (1) its share ≥ DOMINANCE_THRESHOLD (≥ 45% of total kcal)
 *   (2) its share exceeds the 2nd-place share by ≥ MARGIN_THRESHOLD (≥ 12pp)
 * Otherwise → "misc"
 *
 * ⚠ PLAYTEST THRESHOLDS against the real library. If too many foods land in
 * "misc" (e.g. Greek yogurt at ~45% protein, 35% carb) reduce DOMINANCE_THRESHOLD
 * to 0.40. If too many false positives (trail mix classified as carbs), raise to 0.50.
 * See UXR-lib-08.
 */
// ⚠ Tunable — see comment above before changing (UXR-lib-08).
const DOMINANCE_THRESHOLD = 0.45; // top macro must hold ≥45% of kcal
const MARGIN_THRESHOLD    = 0.12; // top macro must lead 2nd by ≥12pp

export function classifyFood(
  food: Pick<LibraryFood, "perServing">
): MacroGroup {
  const p = food.perServing.proteinG;
  const c = food.perServing.carbsG;
  const f = food.perServing.fatG;

  const pKcal = p != null ? p * 4 : 0;
  const cKcal = c != null ? c * 4 : 0;
  const fKcal = f != null ? f * 9 : 0;
  const total  = pKcal + cKcal + fKcal;

  if (total === 0) return "misc"; // all-null or zero-calorie

  const shares = [
    { macro: "protein" as MacroGroup, share: pKcal / total },
    { macro: "carbs"   as MacroGroup, share: cKcal / total },
    { macro: "fat"     as MacroGroup, share: fKcal / total },
  ].sort((a, b) => b.share - a.share);

  const top    = shares[0]!;
  const second = shares[1]!;

  if (
    top.share >= DOMINANCE_THRESHOLD &&
    (top.share - second.share) >= MARGIN_THRESHOLD
  ) {
    return top.macro;
  }
  return "misc";
}

// ── resolveItemMacrosPure ────────────────────────────────────────────────────
/**
 * Resolve draft macro totals from a list of NutritionItems against the local
 * food library (sync, zero server round-trip). Used for "estimated preview"
 * when items were typed manually rather than added via chip/picker (where
 * mergeFoodIntoForm already accumulates exact macros).
 *
 * Matching: case-insensitive exact name match against LibraryFood.name.
 * Servings: parses the leading number from item.qty (e.g. "2 servings" → 2,
 *   "300 g" → 3 if food.basis="100g"). Defaults to 1 when not parseable.
 * Items with no library match contribute nulls (skipped in sum).
 * Returns FoodMacros where null means no item contributed a value for that field.
 *
 * NOT called on the hot-path chip/picker/scan add (those use mergeFoodIntoForm).
 * Called when the user switches from raw-text mode to structured view (staleness
 * resolution) or as a sanity-check after text edits.
 */
export function resolveItemMacrosPure(
  items: NutritionItem[],
  libraryFoods: LibraryFood[]
): FoodMacros {
  // Build a name→food lookup (case-insensitive).
  const byName = new Map<string, LibraryFood>();
  for (const food of libraryFoods) {
    byName.set(food.name.toLowerCase(), food);
  }

  const acc = {
    calories: null as number | null,
    proteinG: null as number | null,
    carbsG:   null as number | null,
    fatG:     null as number | null,
    fiberG:   null as number | null,
    sodiumMg: null as number | null,
  };

  for (const item of items) {
    const food = byName.get(item.name.toLowerCase());
    if (!food) continue;

    const servings = parseServingsFromQty(item.qty, food.basis);
    const scaled   = scaleMacros(food.perServing, servings);

    for (const key of ["calories", "proteinG", "carbsG", "fatG", "fiberG", "sodiumMg"] as const) {
      const v = scaled[key];
      if (v == null) continue;
      acc[key] = (acc[key] ?? 0) + v;
    }
  }

  return acc;
}

/** Extract a leading number from a qty string as a servings count.
 *  "2 servings" → 2, "300 g" with basis "100g" → 3, "1.5" → 1.5.
 *  Falls back to 1 when not parseable. */
function parseServingsFromQty(qty: string | undefined, basis: "serving" | "100g"): number {
  if (!qty) return 1;
  const m = qty.match(/^(\d+(?:\.\d+)?)/);
  if (!m) return 1;
  const n = parseFloat(m[1]!);
  if (!isFinite(n) || n <= 0) return 1;
  // 100g basis: qty is in grams → servings = grams / 100
  return basis === "100g" ? n / 100 : n;
}
