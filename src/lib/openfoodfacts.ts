/**
 * openfoodfacts.ts — Pure OFF v2 product normalizer.
 * No I/O, no "use server". Safe to import in server modules and test scripts.
 *
 * Pipe sanitization is applied at this level (normalizer) so that
 * LibraryFood.name/brand carry a DB-wide pipe-free guarantee — all consumers
 * (chip render, onAdd line builder, MCP response) are unconditionally safe.
 *
 * Energy-field request discipline:
 *   The OFF v2 ?fields= selector silently drops the nutriments object when any
 *   of the top-level energy shortcut fields (energy-kcal_serving etc.) appear
 *   in the same request.  To avoid this, food-actions.ts requests only
 *   `nutriments` (plus serving_size and serving_quantity); this normalizer then
 *   reads all energy values from nutriments, with a fallback to top-level
 *   shortcuts for legacy / manually-constructed OffProduct objects.
 *
 * Serving gap-fill rule:
 *   When basis="serving" AND serving_quantity is a finite positive number
 *   (grams), each macro that is null from the serving fields is derived from
 *   its per-100g counterpart via  value_100g × serving_quantity / 100  (same
 *   rounding + null discipline).  Only fills keys that are null in serving AND
 *   non-null in 100g.  Never fabricates 100g values from serving data.
 */

import type { FoodMacros } from "@/lib/food-types";

/** Subset of OFF v2 product response — fields requested via ?fields=... */
export type OffProduct = {
  product_name?: string;
  brands?: string;
  serving_size?: string;
  /** Numeric serving size in grams (top-level OFF field, separate from nutriments). */
  serving_quantity?: number;
  /**
   * Top-level energy shortcuts — present only in legacy / manually-built objects.
   * These fields are NOT included in the live ?fields= request (doing so suppresses
   * the nutriments object); read energy from nutriments["energy-kcal_serving"] etc.
   */
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

  // ── Nutriments (needed for hasServingData below) ─────────────────────────
  const n = raw.nutriments ?? {};

  // ── Basis selection ──────────────────────────────────────────────────────
  // Use serving basis when: serving_size is non-empty AND at least one of the
  // per-serving energy or macro fields is present (nutriments-based first,
  // top-level shortcuts as fallback for legacy objects).
  const hasServingData =
    !!raw.serving_size?.trim() &&
    (raw["energy-kcal_serving"] != null ||
      raw["energy_serving"] != null ||
      (n["energy-kcal_serving"] as number | undefined) != null ||
      (n["energy_serving"] as number | undefined) != null ||
      n.proteins_serving != null ||
      n.carbohydrates_serving != null ||
      n.fat_serving != null);

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
  // Priority 1: energy-kcal_{suffix} from nutriments (present when ?fields=
  //             does not include energy shortcut fields), or top-level fallback.
  // Priority 2: energy_{suffix} in kJ ÷ 4.184 (same nutriments-first approach).
  // NEVER derive calories from macros × Atwater.
  // NEVER use bare "energy" as kcal (bare energy keys are always kJ on OFF).
  let calories: number | null = null;
  const kcalKey = basis === "serving" ? "energy-kcal_serving" : "energy-kcal_100g";
  const kjKey = basis === "serving" ? "energy_serving" : "energy_100g";

  const kcalDirect = safeNum(
    (n[kcalKey] as number | undefined) ??
    (basis === "serving" ? raw["energy-kcal_serving"] : raw["energy-kcal_100g"]),
  );
  if (kcalDirect != null) {
    calories = Math.round(kcalDirect);
  } else {
    const kjVal = safeNum(
      (n[kjKey] as number | undefined) ??
      (basis === "serving" ? raw["energy_serving"] : raw["energy_100g"]),
    );
    if (kjVal != null) {
      calories = Math.round(kjVal / 4.184);
    }
  }

  // ── Protein, Carbs, Fat, Fiber ────────────────────────────────────────────
  // let (not const) so the serving gap-fill below can mutate them.
  let proteinG = gram1dp(n[`proteins${suffix}`]);
  let carbsG = gram1dp(n[`carbohydrates${suffix}`]);
  let fatG = gram1dp(n[`fat${suffix}`]);
  let fiberG = gram1dp(n[`fiber${suffix}`]);

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

  // ── Serving gap-fill ──────────────────────────────────────────────────────
  // When basis="serving" AND serving_quantity is a finite positive number
  // (grams), derive each macro that is still null from its per-100g counterpart
  // via  value_100g × serving_quantity / 100.  This handles OFF products where
  // only energy-kcal_serving is recorded at the serving level but all other
  // nutrient values exist per-100g.  Never the reverse.
  if (basis === "serving") {
    const sq = safeNum(raw.serving_quantity);
    if (sq != null) {
      // Calories gap-fill: energy-kcal_100g first (nutriments, then top-level), then kJ÷4.184
      if (calories == null) {
        const k100 = safeNum(
          (n["energy-kcal_100g"] as number | undefined) ?? raw["energy-kcal_100g"],
        );
        if (k100 != null) {
          calories = Math.round(k100 * sq / 100);
        } else {
          const kj100 = safeNum(
            (n["energy_100g"] as number | undefined) ?? raw["energy_100g"],
          );
          if (kj100 != null) calories = Math.round((kj100 / 4.184) * sq / 100);
        }
      }
      // Macro gap-fills
      if (proteinG == null) {
        const v = safeNum(n.proteins_100g);
        if (v != null) proteinG = gram1dp(v * sq / 100);
      }
      if (carbsG == null) {
        const v = safeNum(n.carbohydrates_100g);
        if (v != null) carbsG = gram1dp(v * sq / 100);
      }
      if (fatG == null) {
        const v = safeNum(n.fat_100g);
        if (v != null) fatG = gram1dp(v * sq / 100);
      }
      if (fiberG == null) {
        const v = safeNum(n.fiber_100g);
        if (v != null) fiberG = gram1dp(v * sq / 100);
      }
      // Sodium gap-fill: sodium_100g (g/100g) → mg; salt_100g fallback.
      if (sodiumMg == null) {
        const sodiumRaw100 = safeNum(n.sodium_100g);
        if (sodiumRaw100 != null) {
          sodiumMg = Math.round(sodiumRaw100 * 1000 * sq / 100);
        } else {
          const saltRaw100 = safeNum(n.salt_100g);
          if (saltRaw100 != null) sodiumMg = Math.round(saltRaw100 * 400 * sq / 100);
        }
      }
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
