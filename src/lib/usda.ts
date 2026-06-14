/**
 * usda.ts — Server-only USDA FoodData Central client.
 *
 * Fetches from the FDC /foods/search endpoint (Foundation + SR Legacy data types)
 * and normalises the result into our house FoodMacros shape (per 100 g).
 *
 * Design constraints:
 *   - Never throws to the caller — returns null on any miss or error.
 *   - Two HTTP requests at most: first with requireAllWords=true, then a retry
 *     without if no results. Each request has its own 6 s timeout.
 *   - Nutrient values follow the same null discipline as openfoodfacts.ts:
 *       null  = value absent or non-finite in source data (not fabricated).
 *       0     = measured zero.
 *   - All per-100 g values; calories + sodiumMg are integers, macros 1-decimal g.
 */

import type { FoodMacros } from "@/lib/food-types";

// ---------------------------------------------------------------------------
// USDA FDC Nutrient IDs (standard)
// ---------------------------------------------------------------------------
const NID_ENERGY_KCAL = 1008; // Energy, kcal per 100 g
const NID_ENERGY_ATWATER_G = 2047; // Energy, Atwater General Factors, kcal (Foundation)
const NID_ENERGY_ATWATER_S = 2048; // Energy, Atwater Specific Factors, kcal (Foundation)
const NID_ENERGY_KJ = 1062; // Energy, kJ per 100 g
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
  /** "KCAL", "kJ", "G", "MG", etc. */
  unitName?: string;
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
  /** GS1 barcode (GTIN/UPC) — present for Branded foods, often 13-digit zero-padded. */
  gtinUpc?: string;
  /** Brand owner string — present for Branded foods. */
  brandOwner?: string;
  /** Brand name string — fallback when brandOwner is absent. */
  brandName?: string;
  /** Numeric serving size (e.g. 31.0 for "31 g"). */
  servingSize?: number;
  /** Unit for servingSize: "g" | "ml" | etc. */
  servingSizeUnit?: string;
  /** Human-readable serving label, e.g. "1 Scoop". */
  householdServingFullText?: string;
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

/**
 * Normalized result from a FDC Branded barcode lookup.
 * Unlike NormalizedUsdaFood (per-100g), macros here are per-serving
 * (derived from per-100g × servingSize/100 when unit is "g" or "ml").
 */
export type NormalizedUsdaBrandedFood = {
  fdcId: number;
  /** FDC description string. */
  description: string;
  /** Brand string (pipe-sanitized), or null if absent. */
  brand: string | null;
  /** Display label for the serving, e.g. "1 Scoop (31g)" or "31 g". Null when no gram-based serving. */
  servingSize: string | null;
  basis: "serving";
  /** Per-serving macros (null = absent/non-finite in source). */
  macros: FoodMacros;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract calorie (kcal) value from the foodNutrients array using a three-tier
 * fallback chain, because Foundation-type foods often lack nutrient 1008 and
 * instead carry Atwater energies.
 *
 * Precedence:
 *   1. nutrientId 1008, unitName "KCAL"  → use directly
 *   2. nutrientId 2047 (Atwater General) or 2048 (Atwater Specific), "KCAL" → use
 *   3. nutrientId 1062 (kJ) → divide by 4.184, round to nearest int
 *
 * Returns null if none present or value is non-finite / negative.
 */
function getEnergyKcal(nutrients: UsdaFoodNutrient[]): number | null {
  // Helper: validate a raw value
  function valid(v: number | undefined): v is number {
    return v != null && Number.isFinite(v) && v >= 0;
  }

  // 1. Standard kcal (NID 1008, unit KCAL)
  const kcal1008 = nutrients.find(
    (n) =>
      n.nutrientId === NID_ENERGY_KCAL &&
      n.unitName?.toUpperCase() === "KCAL",
  );
  if (kcal1008 && valid(kcal1008.value)) return Math.round(kcal1008.value!);

  // 2. Atwater General (2047) then Specific (2048), unit KCAL
  const atwater = nutrients.find(
    (n) =>
      (n.nutrientId === NID_ENERGY_ATWATER_G ||
        n.nutrientId === NID_ENERGY_ATWATER_S) &&
      n.unitName?.toUpperCase() === "KCAL",
  );
  if (atwater && valid(atwater.value)) return Math.round(atwater.value!);

  // 3. kJ → ÷ 4.184
  const kj = nutrients.find(
    (n) =>
      n.nutrientId === NID_ENERGY_KJ && n.unitName?.toUpperCase() === "KJ",
  );
  if (kj && valid(kj.value)) return Math.round(kj.value! / 4.184);

  return null;
}

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
 * Token-score a search result for relevance to the query.
 *
 * Algorithm:
 *   base  = fraction of query tokens present in description (word-start match)
 *   bonus = +0.15 if description contains "raw"
 *         + +0.10 if dataType is "Foundation"
 *         + -desc.length/10000 for tie-breaking (prefer shorter descriptions)
 *
 * Token matching uses a word-start boundary regex (/\btoken/i) so that, e.g.,
 * the query token "banana" matches "Bananas" (plural) but "oil" must appear as
 * a word start in the description.
 *
 * The description-length penalty ensures a result with exactly fraction=0.5
 * and no bonuses always scores strictly below 0.5, which our reject threshold
 * catches (see searchUsdaFood).
 */
/**
 * Off-target descriptor words: when a result's description contains one of these
 * AND the user did not type it, the result is almost always the wrong food
 * (e.g. query "sweet potato" → "Sweet potato LEAVES" / "Sweet potato CHIPS").
 * Each unrequested off-target word applies a strong penalty so plain/raw/cooked
 * variants rank above byproducts and processed forms. The word is only penalized
 * when it is NOT in the query, so "sweet potato chips" still finds chips.
 */
const OFF_TARGET_WORDS = [
  "leaves", "leaf", "chips", "crisps", "fries", "fried", "candied",
  "canned", "dehydrated", "dried", "powder", "powdered", "flour",
  "juice", "puree", "sauce", "soup", "baby", "infant", "snacks",
  "battered", "breaded", "pickled", "puffs", "tots", "patties",
  "waffles", "tater", "casserole",
];

function tokenScoreFood(food: UsdaSearchFood, tokens: string[]): number {
  if (tokens.length === 0) return 0;

  const desc = food.description.toLowerCase();

  let matchedCount = 0;
  for (const token of tokens) {
    // Escape regex special chars in the token before building the pattern
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp("\\b" + escaped, "i");
    if (re.test(desc)) matchedCount++;
  }

  const fraction = matchedCount / tokens.length;

  let score = fraction;
  if (desc.includes("raw")) score += 0.15;
  if (food.dataType === "Foundation") score += 0.1;

  // Conciseness boost: prefer descriptions whose own words are mostly covered by
  // the query (a tight match like "Sweet potato, raw" over "Sweet potato leaves,
  // raw"). descWords counts alphabetic words in the description.
  const descWords = desc.split(/[^a-z]+/i).filter((w) => w.length > 1);
  if (descWords.length > 0) {
    score += (matchedCount / descWords.length) * 0.3;
  }

  // Off-target penalty: each unrequested byproduct/processed-form word docks the
  // score hard, pushing those variants below the plain food (UXR meal-edit).
  for (const w of OFF_TARGET_WORDS) {
    if (desc.includes(w) && !tokens.includes(w)) score -= 0.6;
  }

  // Tie-break: slightly prefer shorter descriptions
  score -= food.description.length / 10000;

  return score;
}

/** Map a raw FDC search food → NormalizedUsdaFood (per-100g macros + measures). */
function normalizeSearchFood(food: UsdaSearchFood): NormalizedUsdaFood {
  const n = food.foodNutrients;
  const per100g: FoodMacros = {
    calories: getEnergyKcal(n),
    proteinG: gram1dp(getNutrientValue(n, NID_PROTEIN)),
    carbsG: gram1dp(getNutrientValue(n, NID_CARBS)),
    fatG: gram1dp(getNutrientValue(n, NID_FAT)),
    fiberG: gram1dp(getNutrientValue(n, NID_FIBER)),
    sodiumMg: (() => {
      const s = getNutrientValue(n, NID_SODIUM);
      return s != null ? Math.round(s) : null;
    })(),
  };
  return {
    fdcId: food.fdcId,
    description: food.description,
    per100g,
    measures: food.foodMeasures ?? [],
  };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Search USDA FoodData Central for a food by name.
 *
 * Returns null on any miss, HTTP error, network failure, timeout, or when
 * token-scoring determines the best result is too loosely matched (score ≤ 0.5).
 * Never throws.
 *
 * Search strategy:
 *   1. Try with requireAllWords=true (tighter recall, avoids "banana plain" → croutons).
 *   2. If that returns zero results, retry without requireAllWords.
 *   3. Apply token-scored selection; reject (return null) if best score ≤ 0.5.
 *
 * API key: process.env.FDC_API_KEY, falls back to "DEMO_KEY" (rate-limited).
 */
export async function searchUsdaFood(
  term: string,
): Promise<NormalizedUsdaFood | null> {
  const apiKey = process.env.FDC_API_KEY ?? "DEMO_KEY";

  const termLower = term.trim().toLowerCase();
  const tokens = termLower.split(/\s+/).filter((t) => t.length > 0);

  try {
    const foods = await fetchUsdaCandidates(term, apiKey);
    if (foods.length === 0) return null;

    // Pick the best-scoring food
    const scored = foods.map((f) => ({ food: f, score: tokenScoreFood(f, tokens) }));
    const best = scored.reduce((a, b) => (a.score >= b.score ? a : b));

    // Reject results that are too loosely matched — a null estimate is better
    // than a completely irrelevant food (e.g. "banana plain" → croutons).
    // The ≤0.5 threshold catches any result where fewer than half the query
    // tokens matched (the description-length penalty ensures exact-0.5 fraction
    // results also fall below the threshold).
    if (best.score <= 0.5) return null;

    return normalizeSearchFood(best.food);
  } catch {
    // Network failure, timeout (AbortError), JSON parse error → null
    return null;
  }
}

/**
 * Shared FDC search fetch: requireAllWords=true first (tight recall), retry
 * without the restriction if zero results. pageSize 25 widens the candidate
 * pool so disambiguation (searchUsdaFoods) and single-pick (searchUsdaFood) see
 * the plain/raw/cooked variants, not just the API's top few. Throws on HTTP
 * error / timeout (callers catch → null / []).
 */
async function fetchUsdaCandidates(
  term: string,
  apiKey: string,
): Promise<UsdaSearchFood[]> {
  function buildUrl(requireAllWords: boolean): string {
    const url = new URL("https://api.nal.usda.gov/fdc/v1/foods/search");
    url.searchParams.set("query", term);
    url.searchParams.append("dataType", "Foundation");
    url.searchParams.append("dataType", "SR Legacy");
    url.searchParams.set("pageSize", "25");
    url.searchParams.set("api_key", apiKey);
    if (requireAllWords) url.searchParams.set("requireAllWords", "true");
    return url.toString();
  }
  async function run(requireAllWords: boolean): Promise<UsdaSearchFood[]> {
    const res = await fetch(buildUrl(requireAllWords), {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`FDC HTTP ${res.status}`);
    const json = (await res.json()) as UsdaSearchResponse;
    return json.foods ?? [];
  }
  const foods = await run(true);
  return foods.length === 0 ? run(false) : foods;
}

/**
 * Search FDC and return up to `limit` RANKED candidates (best first) for a
 * disambiguation picker — unlike searchUsdaFood, which returns only the single
 * best. Candidates are token-scored (off-target byproducts ranked lower but NOT
 * dropped, so the user can still pick "leaves"/"chips" deliberately). Includes
 * only results where at least half the query tokens matched. Never throws.
 */
export async function searchUsdaFoods(
  term: string,
  limit = 8,
): Promise<NormalizedUsdaFood[]> {
  const apiKey = process.env.FDC_API_KEY ?? "DEMO_KEY";
  const termLower = term.trim().toLowerCase();
  const tokens = termLower.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return [];

  try {
    const foods = await fetchUsdaCandidates(term, apiKey);
    if (foods.length === 0) return [];

    const scored = foods
      .map((f) => {
        // Inclusion floor: at least half the query tokens present as word-starts.
        let matched = 0;
        for (const t of tokens) {
          const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          if (new RegExp("\\b" + escaped, "i").test(f.description.toLowerCase())) {
            matched++;
          }
        }
        return { food: f, score: tokenScoreFood(f, tokens), matched };
      })
      .filter((s) => s.matched / tokens.length >= 0.5)
      .sort((a, b) => b.score - a.score);

    // Dedupe by fdcId (defensive — FDC can repeat across dataTypes).
    const seen = new Set<number>();
    const out: NormalizedUsdaFood[] = [];
    for (const s of scored) {
      if (seen.has(s.food.fdcId)) continue;
      seen.add(s.food.fdcId);
      out.push(normalizeSearchFood(s.food));
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Look up a barcode in USDA FoodData Central's Branded food database.
 *
 * Uses the FDC /foods/search endpoint with dataType=Branded.  Matches the
 * returned gtinUpc against the barcode under three normalized forms:
 *   - raw (as supplied)
 *   - 12-digit UPC-A → "0"-padded EAN-13
 *   - 13-digit EAN-13 starting with "0" → stripped 12-digit UPC-A
 *
 * Nutrients in Branded results are per 100 g.  Per-serving macros are derived
 * as  value_100g × servingSize / 100  when servingSizeUnit is "g" or "ml".
 *
 * Returns null on no match, HTTP error, network failure, timeout, or when the
 * serving unit is not gram/ml (making per-serving derivation unreliable).
 * Never throws.
 *
 * API key: process.env.FDC_API_KEY, falls back to "DEMO_KEY" (rate-limited).
 */
export async function searchUsdaByBarcode(
  barcode: string,
): Promise<NormalizedUsdaBrandedFood | null> {
  const apiKey = process.env.FDC_API_KEY ?? "DEMO_KEY";

  // Build the set of normalized barcode forms to match against gtinUpc
  const padded = barcode.length === 12 ? "0" + barcode : null;
  const stripped =
    barcode.length === 13 && barcode.startsWith("0") ? barcode.slice(1) : null;
  const barcodeSet = new Set(
    [barcode, padded, stripped].filter((f): f is string => f !== null),
  );

  try {
    const url = new URL("https://api.nal.usda.gov/fdc/v1/foods/search");
    url.searchParams.set("query", barcode);
    url.searchParams.append("dataType", "Branded");
    url.searchParams.set("pageSize", "5");
    url.searchParams.set("api_key", apiKey);

    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;

    const json = (await res.json()) as UsdaSearchResponse;
    const foods = json.foods ?? [];

    // Find the food whose gtinUpc matches any of our barcode forms
    const match = foods.find(
      (f) => f.gtinUpc != null && barcodeSet.has(f.gtinUpc),
    );
    if (!match) return null;

    // Only derive per-serving macros when servingSize is in grams or ml
    const servingSizeNum = match.servingSize;
    const unit = (match.servingSizeUnit ?? "").toLowerCase();
    const hasGrams =
      (unit === "g" || unit === "ml") &&
      servingSizeNum != null &&
      Number.isFinite(servingSizeNum) &&
      servingSizeNum > 0;

    if (!hasGrams || servingSizeNum == null) return null;

    const scale = servingSizeNum / 100;
    const n = match.foodNutrients;

    // Per-100g values via shared helpers
    const cal100g = getEnergyKcal(n);
    const prot100g = getNutrientValue(n, NID_PROTEIN);
    const carb100g = getNutrientValue(n, NID_CARBS);
    const fat100g = getNutrientValue(n, NID_FAT);
    const fib100g = getNutrientValue(n, NID_FIBER);
    const sod100g = getNutrientValue(n, NID_SODIUM); // mg per 100 g in FDC

    // Scale to per-serving; apply same rounding discipline as searchUsdaFood
    function scaledInt(v: number | null): number | null {
      if (v == null) return null;
      return Math.round(v * scale);
    }
    function scaled1dp(v: number | null): number | null {
      if (v == null) return null;
      return Math.round(v * scale * 10) / 10;
    }

    const macros: FoodMacros = {
      calories: scaledInt(cal100g),
      proteinG: scaled1dp(prot100g != null ? gram1dp(prot100g) : null),
      carbsG: scaled1dp(carb100g != null ? gram1dp(carb100g) : null),
      fatG: scaled1dp(fat100g != null ? gram1dp(fat100g) : null),
      fiberG: scaled1dp(fib100g != null ? gram1dp(fib100g) : null),
      sodiumMg: scaledInt(sod100g),
    };

    // Serving size display label: "1 Scoop (31g)" or "31 g"
    const household = match.householdServingFullText?.trim();
    const servingSize = household
      ? `${household} (${servingSizeNum}g)`
      : `${servingSizeNum} g`;

    // Brand: prefer brandOwner, fall back to brandName; sanitize pipes
    const brandRaw = (match.brandOwner || match.brandName)?.trim() ?? null;
    const brand = brandRaw ? brandRaw.replace(/\|/g, "-") : null;

    return {
      fdcId: match.fdcId,
      description: match.description,
      brand,
      servingSize,
      basis: "serving",
      macros,
    };
  } catch {
    return null;
  }
}
