/**
 * usda.ts — Server-only USDA FoodData Central client.
 *
 * Fetches from the FDC /foods/search endpoint (Foundation + SR Legacy data types)
 * and normalises the result into our house FoodMacros shape (per 100 g).
 *
 * Design constraints:
 *   - Never throws to the caller — returns null on any miss or error.
 *   - Single HTTP request only (the search response) — no secondary detail fetch.
 *   - Nutrient values follow the same null discipline as openfoodfacts.ts:
 *       null  = value absent or non-finite in source data (not fabricated).
 *       0     = measured zero.
 *   - All per-100 g values; calories + sodiumMg are integers, macros 1-decimal g.
 */

import type { FoodMacros } from "@/lib/food-types";

// ---------------------------------------------------------------------------
// USDA FDC Nutrient IDs (standard)
// ---------------------------------------------------------------------------
const NID_ENERGY = 1008; // Energy, kcal per 100 g
const NID_PROTEIN = 1003; // Protein, g per 100 g
const NID_CARBS = 1005; // Carbohydrate, by difference, g per 100 g
const NID_FAT = 1004; // Total lipid (fat), g per 100 g
const NID_FIBER = 1079; // Fiber, total dietary, g per 100 g
const NID_SODIUM = 1093; // Sodium, mg per 100 g

// ---------------------------------------------------------------------------
// API response types (subset of what FDC /foods/search returns)
// ---------------------------------------------------------------------------
type UsdaFoodNutrient = {
  nutrientId: number;
  value?: number;
};

type UsdaFoodMeasure = {
  disseminationText: string;
  gramWeight: number;
};

type UsdaSearchFood = {
  fdcId: number;
  description: string;
  /** "Foundation" | "SR Legacy" | "Branded" | … */
  dataType: string;
  foodNutrients: UsdaFoodNutrient[];
  /** Optional — present for Foundation / SR Legacy foods */
  foodMeasures?: UsdaFoodMeasure[];
};

type UsdaSearchResponse = {
  foods?: UsdaSearchFood[];
};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------
export type NormalizedUsdaFood = {
  fdcId: number;
  /** FDC description string (e.g. "Bananas, raw"). */
  description: string;
  /** Macros expressed per 100 g. */
  per100g: FoodMacros;
  /** Portion measures from the search response (may be empty). */
  measures: UsdaFoodMeasure[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract a nutrient value from the foodNutrients array; returns null if absent/invalid. */
function getNutrientValue(
  nutrients: UsdaFoodNutrient[],
  id: number,
): number | null {
  const hit = nutrients.find((n) => n.nutrientId === id);
  const v = hit?.value;
  if (v == null || !Number.isFinite(v) || v < 0) return null;
  return v;
}

/** Round to 1 decimal place; preserve null. */
function gram1dp(v: number | null): number | null {
  if (v == null) return null;
  return Math.round(v * 10) / 10;
}

/**
 * Score a search result for relevance:
 *   +2  description starts with the search term (case-insensitive)
 *   +1  description contains "raw" (prefer raw / unprocessed reference values)
 *   +1  dataType is "Foundation" (over "SR Legacy")
 */
function scoreFood(food: UsdaSearchFood, termLower: string): number {
  let score = 0;
  const desc = food.description.toLowerCase();
  if (desc.startsWith(termLower)) score += 2;
  if (desc.includes("raw")) score += 1;
  if (food.dataType === "Foundation") score += 1;
  return score;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Search USDA FoodData Central for a food by name.
 *
 * Returns null on any miss, HTTP error, network failure, or timeout.
 * Never throws.
 *
 * API key: process.env.FDC_API_KEY, falls back to "DEMO_KEY" (rate-limited).
 */
export async function searchUsdaFood(
  term: string,
): Promise<NormalizedUsdaFood | null> {
  const apiKey = process.env.FDC_API_KEY ?? "DEMO_KEY";

  const url = new URL("https://api.nal.usda.gov/fdc/v1/foods/search");
  url.searchParams.set("query", term);
  // Multiple data types: Foundation = curated reference; SR Legacy = SR28 reference
  url.searchParams.append("dataType", "Foundation");
  url.searchParams.append("dataType", "SR Legacy");
  url.searchParams.set("pageSize", "6");
  url.searchParams.set("api_key", apiKey);

  try {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) return null;

    const json = (await res.json()) as UsdaSearchResponse;
    if (!json.foods?.length) return null;

    // Pick the best matching food
    const termLower = term.trim().toLowerCase();
    const best = json.foods.reduce((a, b) =>
      scoreFood(a, termLower) >= scoreFood(b, termLower) ? a : b,
    );

    // Map nutrient array → FoodMacros (per 100 g)
    const n = best.foodNutrients;

    const energyRaw = getNutrientValue(n, NID_ENERGY);
    const calories = energyRaw != null ? Math.round(energyRaw) : null;

    const proteinG = gram1dp(getNutrientValue(n, NID_PROTEIN));
    const carbsG = gram1dp(getNutrientValue(n, NID_CARBS));
    const fatG = gram1dp(getNutrientValue(n, NID_FAT));
    const fiberG = gram1dp(getNutrientValue(n, NID_FIBER));

    const sodiumRaw = getNutrientValue(n, NID_SODIUM);
    const sodiumMg = sodiumRaw != null ? Math.round(sodiumRaw) : null;

    const per100g: FoodMacros = {
      calories,
      proteinG,
      carbsG,
      fatG,
      fiberG,
      sodiumMg,
    };

    return {
      fdcId: best.fdcId,
      description: best.description,
      per100g,
      measures: best.foodMeasures ?? [],
    };
  } catch {
    // Network failure, timeout (AbortError), JSON parse error → null
    return null;
  }
}
