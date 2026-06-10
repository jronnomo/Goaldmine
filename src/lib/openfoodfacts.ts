/**
 * openfoodfacts.ts — Pure OFF v2 product normalizer.
 * No I/O, no "use server". Safe to import in server modules and test scripts.
 *
 * Pipe sanitization is applied at this level (normalizer) so that
 * LibraryFood.name/brand carry a DB-wide pipe-free guarantee — all consumers
 * (chip render, onAdd line builder, MCP response) are unconditionally safe.
 */

import type { FoodMacros } from "@/lib/food-types";

/** Subset of OFF v2 product response — fields requested via ?fields=... */
export type OffProduct = {
  product_name?: string;
  brands?: string;
  serving_size?: string;
  "energy-kcal_serving"?: number;
  "energy_serving"?: number;
  "energy-kcal_100g"?: number;
  "energy_100g"?: number;
  nutriments?: {
    proteins_serving?: number;
    carbohydrates_serving?: number;
    fat_serving?: number;
    fiber_serving?: number;
    sodium_serving?: number;
    salt_serving?: number;
    proteins_100g?: number;
    carbohydrates_100g?: number;
    fat_100g?: number;
    fiber_100g?: number;
    sodium_100g?: number;
    salt_100g?: number;
    [key: string]: number | undefined;
  };
};

export function normalizeOffProduct(
  raw: OffProduct,
  barcode: string,
): {
  name: string;
  brand: string | null;
  servingSize: string | null;
  basis: "serving" | "100g";
  macros: FoodMacros;
} {
  // ── Name ────────────────────────────────────────────────────────────────
  const name = raw.product_name?.trim().replace(/\|/g, "-") || barcode;

  // ── Brand ────────────────────────────────────────────────────────────────
  const brandRaw = raw.brands?.split(",")[0]?.trim() ?? null;
  const brand = brandRaw ? brandRaw.replace(/\|/g, "-") : null;

  // ── Basis selection ──────────────────────────────────────────────────────
  // Use serving basis when: serving_size is non-empty AND at least one of the
  // per-serving energy or macro fields is present.
  const hasServingData =
    !!raw.serving_size?.trim() &&
    (raw["energy-kcal_serving"] != null ||
      raw["energy_serving"] != null ||
      raw.nutriments?.proteins_serving != null ||
      raw.nutriments?.carbohydrates_serving != null ||
      raw.nutriments?.fat_serving != null);

  const basis: "serving" | "100g" = hasServingData ? "serving" : "100g";
  const servingSize = hasServingData ? (raw.serving_size?.trim() ?? null) : "100 g";

  // ── Helpers ──────────────────────────────────────────────────────────────
  const suffix = basis === "serving" ? "_serving" : "_100g";

  function safeNum(v: number | undefined | null): number | null {
    if (v == null || !Number.isFinite(v) || v < 0) return null;
    return v;
  }

  function gram1dp(v: number | undefined | null): number | null {
    const n = safeNum(v);
    if (n == null) return null;
    return Math.round(n * 10) / 10;
  }

  // ── Calories ─────────────────────────────────────────────────────────────
  // Priority 1: energy-kcal_{suffix} (direct kcal field)
  // Priority 2: energy_{suffix} in kJ ÷ 4.184
  // NEVER derive calories from macros × Atwater.
  // NEVER use bare "energy" as kcal (bare energy keys are always kJ on OFF).
  let calories: number | null = null;
  const kcalDirect = safeNum(
    basis === "serving" ? raw["energy-kcal_serving"] : raw["energy-kcal_100g"],
  );
  if (kcalDirect != null) {
    calories = Math.round(kcalDirect);
  } else {
    const kjVal = safeNum(
      basis === "serving" ? raw["energy_serving"] : raw["energy_100g"],
    );
    if (kjVal != null) {
      calories = Math.round(kjVal / 4.184);
    }
  }

  // ── Protein, Carbs, Fat, Fiber ────────────────────────────────────────────
  const n = raw.nutriments ?? {};
  const proteinG = gram1dp(n[`proteins${suffix}`]);
  const carbsG = gram1dp(n[`carbohydrates${suffix}`]);
  const fatG = gram1dp(n[`fat${suffix}`]);
  const fiberG = gram1dp(n[`fiber${suffix}`]);

  // ── Sodium ───────────────────────────────────────────────────────────────
  // OFF stores sodium in grams → ×1000 for mg.
  // If sodium missing but salt present: salt_g × 400 (NaCl ≈ 39.3% sodium → 400 mg/g).
  let sodiumMg: number | null = null;
  const sodiumRaw = safeNum(n[`sodium${suffix}`]);
  if (sodiumRaw != null) {
    sodiumMg = Math.round(sodiumRaw * 1000);
  } else {
    const saltRaw = safeNum(n[`salt${suffix}`]);
    if (saltRaw != null) {
      sodiumMg = Math.round(saltRaw * 400);
    }
  }

  return {
    name,
    brand,
    servingSize,
    basis,
    macros: { calories, proteinG, carbsG, fatG, fiberG, sodiumMg },
  };
}
