"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { normalizeOffProduct } from "@/lib/openfoodfacts";
import { parseFoodQuery } from "@/lib/food-parse";
import {
  BUILTINS,
  findBuiltin,
  resolveBuiltinGrams,
} from "@/lib/food-builtins";
import { searchUsdaFood, searchUsdaByBarcode } from "@/lib/usda";
import type { NormalizedUsdaBrandedFood } from "@/lib/usda";
import type { BarcodeLookupResult, LibraryFood, FoodMacros } from "@/lib/food-types";
import type { NutritionItem } from "@/lib/nutrition-log-ops";
import type { OffProduct } from "@/lib/openfoodfacts";
import { scaleMacros } from "@/lib/food-resolve-local";

// ── lookupBarcode ─────────────────────────────────────────────────────────────

/**
 * Look up a barcode in the personal food library, or fetch it from
 * OpenFoodFacts (and optionally USDA FDC Branded) and upsert it.
 *
 * Multi-form barcode match rules (EAN-8 / UPC-A / EAN-13 interop):
 *   • EAN-8  (8 digits):                 looked up as-is — do NOT zero-pad to 13
 *   • UPC-A  (12 digits):                padded form = "0" + barcode (EAN-13 equivalent)
 *   • EAN-13 starting with 0 (13 digits):stripped form = barcode.slice(1) (UPC-A equivalent)
 *   • Any other length:                  raw form only
 *
 * Canonical storage key for upserts = padded EAN-13 for UPC-A input; raw otherwise.
 *
 * Cache-quality guard (F3 self-heal):
 *   Library hits with <3 non-null macros are treated as cache-misses and
 *   re-fetched through the full OFF → FDC chain.  The row is refreshed only
 *   when the re-fetch produces strictly more non-null macros than the stored row.
 *
 * FDC Branded fallback (F2):
 *   If OFF returns not_found OR fewer than 3 non-null macros, searchUsdaByBarcode
 *   is called.  If FDC yields more non-null macros than OFF, FDC data is used
 *   (source: "usda-branded").
 *
 * Never throws to the caller — errors surface as { status: "error" }.
 */
export async function lookupBarcode(raw: string): Promise<BarcodeLookupResult> {
  const barcode = raw.trim();

  // Validate: digits only, 8–14 characters
  if (!/^\d{8,14}$/.test(barcode)) {
    return { status: "not_found" };
  }

  // ── Multi-form match set ────────────────────────────────────────────────
  const padded13 = barcode.length === 12 ? "0" + barcode : null;
  const stripped =
    barcode.length === 13 && barcode.startsWith("0") ? barcode.slice(1) : null;
  const forms = [barcode, padded13, stripped].filter((f): f is string => f !== null);

  // Canonical upsert key: EAN-13 for UPC-A input; raw otherwise
  const canonicalKey = padded13 ?? barcode;

  // ── Library lookup ───────────────────────────────────────────────────────
  const existing = await prisma.foodLibrary.findFirst({
    where: { barcode: { in: forms } },
  });

  const existingFood = existing ? toLibraryFood(existing) : null;
  const existingNonNull = existingFood ? countNonNullMacros(existingFood.perServing) : 0;

  // Manual rows have been user-corrected — never refresh from OFF/FDC regardless of
  // macro completeness.  Self-heal must not clobber intentional edits.
  if (existing && existing.source === "manual") {
    await prisma.foodLibrary.update({
      where: { id: existing.id },
      data: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
    });
    return { status: "found", food: existingFood!, fromLibrary: true };
  }

  // Good cache hit: ≥3 non-null macros → no network call needed
  if (existing && existingNonNull >= 3) {
    await prisma.foodLibrary.update({
      where: { id: existing.id },
      data: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
    });
    return { status: "found", food: existingFood!, fromLibrary: true };
  }

  // ── OFF fetch (only on cache miss or sparse cache) ────────────────────────
  // For 12-digit UPC-A: first try the raw 12-digit form, then retry with "0" + barcode.
  let offResult = await fetchOffNormalized(barcode);
  if (offResult.status === "not_found" && barcode.length === 12) {
    offResult = await fetchOffNormalized("0" + barcode);
  }

  const offNonNull =
    offResult.status === "found" ? countNonNullMacros(offResult.normalized.macros) : 0;

  // OFF transient error with no existing row → propagate error
  if (offResult.status === "error" && !existing) {
    return { status: "error", message: offResult.message };
  }

  // ── FDC Branded fallback (when OFF absent or sparse) ─────────────────────
  let fdcResult: NormalizedUsdaBrandedFood | null = null;
  let fdcNonNull = 0;
  if (offResult.status === "not_found" || offNonNull < 3) {
    fdcResult = await searchUsdaByBarcode(barcode);
    if (fdcResult) fdcNonNull = countNonNullMacros(fdcResult.macros);
  }

  // ── Pick winner ───────────────────────────────────────────────────────────
  const hasOffWinner = offResult.status === "found" && offNonNull > 0;
  const hasFdcWinner = fdcResult != null && fdcNonNull > 0;
  const useFdc = hasFdcWinner && fdcNonNull > offNonNull;
  const winnerNonNull = useFdc ? fdcNonNull : offNonNull;

  // No useful data from any source
  if (!hasOffWinner && !hasFdcWinner) {
    if (existing) {
      // Keep sparse existing row — just bump count
      await prisma.foodLibrary.update({
        where: { id: existing.id },
        data: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
      });
      return { status: "found", food: existingFood!, fromLibrary: true };
    }
    if (offResult.status === "error") {
      return { status: "error", message: offResult.message };
    }
    return { status: "not_found" };
  }

  // Winner isn't strictly better than existing row → bump count only
  if (existing && winnerNonNull <= existingNonNull) {
    await prisma.foodLibrary.update({
      where: { id: existing.id },
      data: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
    });
    return { status: "found", food: existingFood!, fromLibrary: true };
  }

  // ── Commit winner to DB ───────────────────────────────────────────────────
  // Use update-by-id when refreshing an existing (sparse) row; upsert for new rows.
  type FLRow = Parameters<typeof toLibraryFood>[0];
  let row: FLRow;

  if (useFdc && fdcResult) {
    const base = {
      name: fdcResult.description.replace(/\|/g, "-"),
      brand: fdcResult.brand,
      servingSize: fdcResult.servingSize,
      basis: fdcResult.basis as string,
      ...fdcResult.macros,
      source: "usda-branded",
      lastUsedAt: new Date(),
    };
    if (existing) {
      row = await prisma.foodLibrary.update({
        where: { id: existing.id },
        data: { ...base, usageCount: { increment: 1 } },
      });
    } else {
      row = await prisma.foodLibrary.upsert({
        where: { barcode: canonicalKey },
        create: { barcode: canonicalKey, ...base, usageCount: 1 },
        update: { ...base, usageCount: { increment: 1 } },
      });
    }
  } else {
    // OFF is winner
    const norm = (
      offResult as Extract<typeof offResult, { status: "found" }>
    ).normalized;
    const base = {
      name: norm.name,
      brand: norm.brand,
      servingSize: norm.servingSize,
      basis: norm.basis as string,
      ...norm.macros,
      source: "openfoodfacts",
      lastUsedAt: new Date(),
    };
    if (existing) {
      row = await prisma.foodLibrary.update({
        where: { id: existing.id },
        data: { ...base, usageCount: { increment: 1 } },
      });
    } else {
      row = await prisma.foodLibrary.upsert({
        where: { barcode: canonicalKey },
        create: { barcode: canonicalKey, ...base, usageCount: 1 },
        update: { ...base, usageCount: { increment: 1 } },
      });
    }
  }

  return { status: "found", food: toLibraryFood(row), fromLibrary: false };
}

// ── OFF HTTP layer ────────────────────────────────────────────────────────────

const OFF_UA = "Goaldmine/1.0 (github.com/jronnomo/goaldmine)";

/**
 * OFF fields to request.
 *
 * IMPORTANT: Do NOT include the top-level energy shortcut fields
 * (energy-kcal_serving, energy_serving, energy-kcal_100g, energy_100g) here.
 * When those fields appear alongside "nutriments" in a ?fields= request, the
 * OFF v2 API silently drops the nutriments object — causing all protein/carbs/
 * fat/fiber macros to come back null.  The normalizer reads energy values from
 * within nutriments (with top-level fallback for legacy objects).
 */
const OFF_FIELDS = [
  "product_name",
  "brands",
  "serving_size",
  "serving_quantity",
  "nutriments",
].join(",");

/**
 * Fetch a single product from OFF and normalize it; no DB writes.
 *
 * OFF HTTP response discipline:
 *   HTTP 200 + json.status === 1 + json.product present → found
 *   HTTP 200 + json.status === 0                         → not_found (incomplete OFF record)
 *   HTTP 404                                             → not_found (product absent from OFF)
 *   Any other non-2xx (429, 500, etc.)                  → error (retryable — OFF may be down)
 *   Network failure / timeout (AbortError)              → error (retryable)
 */
type OffNormalizedResult =
  | { status: "not_found" }
  | { status: "error"; message: string }
  | {
      status: "found";
      normalized: ReturnType<typeof normalizeOffProduct>;
    };

async function fetchOffNormalized(code: string): Promise<OffNormalizedResult> {
  const url = `https://world.openfoodfacts.org/api/v2/product/${code}?fields=${OFF_FIELDS}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": OFF_UA },
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) {
      return res.status === 404
        ? { status: "not_found" }
        : { status: "error", message: "OpenFoodFacts unavailable — try again" };
    }

    const json = (await res.json()) as { status: number; product?: unknown };
    if (json.status !== 1 || !json.product) return { status: "not_found" };

    const normalized = normalizeOffProduct(json.product as OffProduct, code);
    return { status: "found", normalized };
  } catch {
    return { status: "error", message: "Network error — try again" };
  }
}

// ── countNonNullMacros (module-private) ───────────────────────────────────────

/** Count how many of the six macro fields are non-null in a FoodMacros snapshot. */
function countNonNullMacros(macros: FoodMacros): number {
  return [
    macros.calories,
    macros.proteinG,
    macros.carbsG,
    macros.fatG,
    macros.fiberG,
    macros.sodiumMg,
  ].filter((v) => v != null).length;
}

// ── deleteLibraryFood ─────────────────────────────────────────────────────────

/**
 * Delete a FoodLibrary row by id.
 * Uses deleteMany so a missing id is a no-op, not a throw.
 */
export async function deleteLibraryFood(id: string): Promise<void> {
  await prisma.foodLibrary.deleteMany({ where: { id } });
  safeRevalidate("/nutrition");
  safeRevalidate("/");
}

// ── updateLibraryFood ─────────────────────────────────────────────────────────

/**
 * Patch a FoodLibrary row in place.
 *
 * patch fields (all optional):
 *   name        — trimmed; ignored when empty after trim.
 *   brand       — null clears; string sets; absent = no change.
 *   servingSize — null clears; string sets; absent = no change.
 *   macros      — null clears; finite ≥0 number sets; negative/NaN coerced to null.
 *
 * When any macro field is present in the patch, source is set to "manual" so that
 * subsequent barcode rescans skip the self-heal refresh (manual rows are never
 * overwritten by OFF / FDC data — see lookupBarcode's source==="manual" guard).
 *
 * Never throws — errors surface as { ok: false, message }.
 */
export type UpdateLibraryFoodResult =
  | { ok: true; food: LibraryFood }
  | { ok: false; message: string };

const MACRO_PATCH_KEYS = [
  "calories",
  "proteinG",
  "carbsG",
  "fatG",
  "fiberG",
  "sodiumMg",
] as const;

type MacroPatchKey = (typeof MACRO_PATCH_KEYS)[number];

export type UpdateLibraryFoodPatch = {
  name?: string;
  brand?: string | null;
  servingSize?: string | null;
  calories?: number | null;
  proteinG?: number | null;
  carbsG?: number | null;
  fatG?: number | null;
  fiberG?: number | null;
  sodiumMg?: number | null;
};

export async function updateLibraryFood(
  id: string,
  patch: UpdateLibraryFoodPatch,
): Promise<UpdateLibraryFoodResult> {
  try {
    const data: Record<string, unknown> = {};

    // Text fields
    if (patch.name !== undefined) {
      const trimmed = patch.name.trim();
      if (trimmed.length > 0) data.name = trimmed;
    }
    if (patch.brand !== undefined) {
      data.brand = patch.brand != null ? patch.brand.trim() || null : null;
    }
    if (patch.servingSize !== undefined) {
      data.servingSize =
        patch.servingSize != null ? patch.servingSize.trim() || null : null;
    }

    // Macro fields: null clears; finite ≥0 number sets; negative/NaN → null
    let hasMacroPatch = false;
    for (const key of MACRO_PATCH_KEYS) {
      const raw = patch[key as MacroPatchKey];
      if (raw !== undefined) {
        if (raw === null) {
          data[key] = null;
        } else if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
          data[key] = raw;
        } else {
          data[key] = null; // reject negative / NaN → treat as "unknown"
        }
        hasMacroPatch = true;
      }
    }

    // Mark as user-corrected so self-heal never overwrites it
    if (hasMacroPatch) {
      data.source = "manual";
    }

    if (Object.keys(data).length === 0) {
      // Nothing to change — return current row as-is
      const existing = await prisma.foodLibrary.findUnique({ where: { id } });
      if (!existing) return { ok: false, message: "Food not found" };
      return { ok: true, food: toLibraryFood(existing) };
    }

    const row = await prisma.foodLibrary.update({ where: { id }, data });
    safeRevalidate("/nutrition");
    safeRevalidate("/");
    return { ok: true, food: toLibraryFood(row) };
  } catch (err: unknown) {
    // P2025: record required but not found (update on missing id)
    if (
      err != null &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2025"
    ) {
      return { ok: false, message: "Food not found" };
    }
    return { ok: false, message: "Failed to update food" };
  }
}

// ── listLibraryFoods ──────────────────────────────────────────────────────────

/**
 * A FoodLibrary row enriched with usage stats.
 * lastUsedAt is a preformatted display label (server-rendered, no client Date math).
 */
export type LibraryFoodRow = LibraryFood & {
  usageCount: number;
  /** Short date label, e.g. "Jun 9" — null when the food has never been used. */
  lastUsedAt: string | null;
};

/**
 * Top 50 FoodLibrary rows ordered by usage desc, then recency desc.
 * Intended for the Food Library Manager UI; richer than getQuickPickFoods.
 */
export async function listLibraryFoods(): Promise<LibraryFoodRow[]> {
  const rows = await prisma.foodLibrary.findMany({
    orderBy: [{ usageCount: "desc" }, { lastUsedAt: "desc" }],
    take: 200,
  });
  const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
  return rows.map((row) => ({
    ...toLibraryFood(row),
    usageCount: row.usageCount,
    lastUsedAt: row.lastUsedAt ? fmt.format(row.lastUsedAt) : null,
  }));
}

// ── getQuickPickFoods ─────────────────────────────────────────────────────────

/**
 * Top N foods by usage count (then recency) for the quick-pick chip row.
 * Default limit 8 (UI shows up to 8 chips).
 */
export async function getQuickPickFoods(limit = 8): Promise<LibraryFood[]> {
  const rows = await prisma.foodLibrary.findMany({
    orderBy: [{ usageCount: "desc" }, { lastUsedAt: "desc" }],
    take: limit,
  });
  return rows.map(toLibraryFood);
}

// ── recordFoodUse ─────────────────────────────────────────────────────────────

/**
 * Bump usageCount + lastUsedAt for a chip-tap add.
 * Called fire-and-forget from LogNutritionForm.handleAdd ONLY when chipSource === true.
 * The scan path (chipSource === false) bumps count inside lookupBarcode — do not call here.
 */
export async function recordFoodUse(id: string): Promise<void> {
  await prisma.foodLibrary.update({
    where: { id },
    data: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
  });
}

// ── toLibraryFood (module-private) ───────────────────────────────────────────

function toLibraryFood(row: {
  id: string;
  barcode: string | null;
  name: string;
  brand: string | null;
  servingSize: string | null;
  basis: string;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  sodiumMg: number | null;
}): LibraryFood {
  return {
    id: row.id,
    barcode: row.barcode,
    name: row.name,
    brand: row.brand,
    servingSize: row.servingSize,
    basis: row.basis as "serving" | "100g",
    perServing: {
      calories: row.calories,
      proteinG: row.proteinG,
      carbsG: row.carbsG,
      fatG: row.fatG,
      fiberG: row.fiberG,
      sodiumMg: row.sodiumMg,
    },
  };
}

// ── estimateFood ──────────────────────────────────────────────────────────────

/**
 * Result type for estimateFood.
 *
 * On "ok": `macros` are the TOTAL macros for the full query (count × portion).
 *          `servings` is the scaling multiplier relative to the LibraryFood's
 *          perServing (which is per-100 g for builtin/usda rows).
 *          `line` is a nutrition-items-textarea-ready string: "Name | portion".
 */
export type FoodEstimate =
  | {
      status: "ok";
      /** Nutrition items textarea entry, e.g. "Banana | medium (118 g)". */
      line: string;
      /** Resolved per-item grams (null when basis="serving" and no gram override). */
      grams: number | null;
      /** Total macros for the entire query (count × portion × per100g). */
      macros: FoodMacros;
      /** Data source used. */
      source: "library" | "builtin" | "usda";
      /** The library row (existing or newly cached). */
      food: LibraryFood;
      /**
       * Scaling factor: total macros = food.perServing × servings.
       * For basis="100g" rows: servings = count × grams / 100.
       * For basis="serving" rows: servings = count.
       */
      servings: number;
    }
  | { status: "not_found"; query: string }
  | { status: "error"; message: string };

/**
 * Estimate the macros for a natural-language food query.
 *
 * Resolution order:
 *   1. Personal library (exact case-insensitive name match)
 *   2. Builtin reference table (slug / alias match)
 *   3. USDA FoodData Central API
 *
 * Builtin and USDA results are cached into FoodLibrary with a namespaced barcode
 * key ("builtin:<slug>" or "usda:<fdcId>").  The digit-only barcode check in
 * lookupBarcode is unaffected — non-digit keys are never matched there.
 *
 * Never throws — errors surface as { status: "error" }.
 */
export async function estimateFood(query: string): Promise<FoodEstimate> {
  try {
    const parsed = parseFoodQuery(query.trim());
    const { count, sizeWord, grams: explicitGrams, rest } = parsed;

    // ── A. Personal library ───────────────────────────────────────────────
    const libRow = await prisma.foodLibrary.findFirst({
      where: { name: { equals: rest, mode: "insensitive" } },
    });

    if (libRow) {
      await prisma.foodLibrary.update({
        where: { id: libRow.id },
        data: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
      });

      const food = toLibraryFood(libRow);

      if (food.basis === "100g") {
        // Resolve grams: explicit override → builtin portions → servingSize parse → 100g
        let resolvedGrams: number;
        let portionLabel: string;

        if (libRow.barcode?.startsWith("builtin:")) {
          const slug = libRow.barcode.slice(8);
          const builtin = BUILTINS.find((b) => b.slug === slug);
          if (builtin) {
            const r = resolveBuiltinGrams(builtin, sizeWord, explicitGrams);
            resolvedGrams = r.grams;
            portionLabel = r.label;
          } else {
            resolvedGrams = explicitGrams ?? extractGramsFromLabel(food.servingSize) ?? 100;
            portionLabel = formatPortionLabel(resolvedGrams, food.servingSize, explicitGrams != null);
          }
        } else {
          resolvedGrams = explicitGrams ?? extractGramsFromLabel(food.servingSize) ?? 100;
          portionLabel = formatPortionLabel(resolvedGrams, food.servingSize, explicitGrams != null);
        }

        const servings = (count * resolvedGrams) / 100;
        const macros = scaleMacros(food.perServing, servings);
        const line = buildLine(food.name, portionLabel, count);
        return { status: "ok", line, grams: resolvedGrams, macros, source: "library", food, servings };
      } else {
        // basis="serving" — use labelled serving × count
        const servings = count;
        const macros = scaleMacros(food.perServing, servings);
        const portionLabel = food.servingSize ?? "1 serving";
        const line = buildLine(food.name, portionLabel, count);
        return { status: "ok", line, grams: null, macros, source: "library", food, servings };
      }
    }

    // ── B. Builtin reference table ────────────────────────────────────────
    const builtin = findBuiltin(rest);
    if (builtin) {
      const { grams: resolvedGrams, label: portionLabel } = resolveBuiltinGrams(
        builtin,
        sizeWord,
        explicitGrams,
      );
      const servings = (count * resolvedGrams) / 100;
      const macros = scaleMacros(builtin.per100g, servings);

      const displayName = slugToDisplayName(builtin.slug);
      const barcode = `builtin:${builtin.slug}`;
      const defaultPortion = builtin.portions.find((p) => p.key === builtin.defaultPortionKey);
      const servingSizeLabel = defaultPortion?.label ?? "100 g";

      const { food } = await upsertEstimateRow({
        barcode,
        name: displayName,
        servingSize: servingSizeLabel,
        macros: builtin.per100g,
        source: "builtin",
      });

      const line = buildLine(displayName, portionLabel, count);
      return { status: "ok", line, grams: resolvedGrams, macros, source: "builtin", food, servings };
    }

    // ── C. USDA FoodData Central ──────────────────────────────────────────
    const usda = await searchUsdaFood(rest);
    if (usda) {
      const { grams: resolvedGrams, label: portionLabel } = resolveUsdaGrams(
        usda.measures,
        sizeWord,
        explicitGrams,
      );
      const servings = (count * resolvedGrams) / 100;
      const macros = scaleMacros(usda.per100g, servings);

      // Strip pipes from description (pipe-safe guarantee)
      const displayName = usda.description.replace(/\|/g, "-");
      const barcode = `usda:${usda.fdcId}`;

      // Store the first measure's text as servingSize for future display
      const firstMeasure = usda.measures[0];
      const servingSizeLabel = firstMeasure
        ? `${firstMeasure.disseminationText} (${firstMeasure.gramWeight} g)`
        : "100 g";

      const { food } = await upsertEstimateRow({
        barcode,
        name: displayName,
        servingSize: servingSizeLabel,
        macros: usda.per100g,
        source: "usda",
      });

      const line = buildLine(displayName, portionLabel, count);
      return { status: "ok", line, grams: resolvedGrams, macros, source: "usda", food, servings };
    }

    return { status: "not_found", query };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Unknown error in estimateFood",
    };
  }
}

// ── estimateMealMacros ─────────────────────────────────────────────────────────

/** Per-item resolution result for the meal-macro preview. */
export type MealItemMacroResult = {
  name: string;
  matched: boolean;
  macros: FoodMacros | null;
};

/** Aggregate result of estimateMealMacros. */
export type MealMacroEstimate = {
  perItem: MealItemMacroResult[];
  totals: FoodMacros;
  unmatchedCount: number;
};

/**
 * Estimate total macros for a meal's items, READ-ONLY (no DB writes, no
 * revalidate, no redirect). Feeds the meal edit UI's "Recompute from items"
 * preview; persistence happens later via updateNutrition on Save.
 *
 * Each item's query is built from "qty + name" (e.g. "8 oz 97% beef") and
 * resolved against the personal FoodLibrary (name match) and the builtin
 * reference table ONLY — deliberately NO USDA network call, for speed and so the
 * preview is honest about what it can resolve locally. Unmatched items
 * contribute nothing and are flagged matched:false (never zeroed or invented).
 *
 * Totals are null per-macro when no matched item contributed that field;
 * otherwise the house-rounded sum (cal/sodium → int, protein/carbs/fat/fiber →
 * 1 dp), applied via scaleMacros(sum, 1).
 *
 * TODO: this shares estimateFood's library/builtin resolution logic (sans the
 * USDA branch and writes) inline below. A future refactor could extract a single
 * library-only resolver shared by both.
 */
export async function estimateMealMacros(
  items: NutritionItem[],
): Promise<MealMacroEstimate> {
  const perItem: MealItemMacroResult[] = [];

  for (const item of items) {
    const query = [item.qty, item.name].filter(Boolean).join(" ").trim();
    const macros = query ? await resolveItemMacrosLocal(query) : null;
    perItem.push({ name: item.name, matched: macros != null, macros });
  }

  // Sum matched macros; track which fields any item contributed.
  const sum: FoodMacros = {
    calories: null,
    proteinG: null,
    carbsG: null,
    fatG: null,
    fiberG: null,
    sodiumMg: null,
  };
  for (const key of MACRO_KEYS_LOCAL) {
    let any = false;
    let acc = 0;
    for (const r of perItem) {
      const v = r.macros?.[key];
      if (v != null) {
        any = true;
        acc += v;
      }
    }
    sum[key] = any ? acc : null;
  }

  // Apply house rounding to the summed totals (servings = 1).
  const totals = scaleMacros(sum, 1);
  const unmatchedCount = perItem.filter((r) => !r.matched).length;
  return { perItem, totals, unmatchedCount };
}

const MACRO_KEYS_LOCAL = [
  "calories",
  "proteinG",
  "carbsG",
  "fatG",
  "fiberG",
  "sodiumMg",
] as const;

/**
 * Resolve total macros for a single natural-language food query using the
 * personal library (name match) then the builtin table — NO USDA, NO writes.
 * Returns null when neither source matches. Mirrors estimateFood's A/B branches
 * but is purely read-only.
 */
async function resolveItemMacrosLocal(query: string): Promise<FoodMacros | null> {
  const parsed = parseFoodQuery(query.trim());
  const { count, sizeWord, grams: explicitGrams, rest } = parsed;

  // A. Personal library (exact case-insensitive name match) — read only.
  const libRow = await prisma.foodLibrary.findFirst({
    where: { name: { equals: rest, mode: "insensitive" } },
  });

  if (libRow) {
    const food = toLibraryFood(libRow);
    if (food.basis === "100g") {
      let resolvedGrams: number;
      if (libRow.barcode?.startsWith("builtin:")) {
        const slug = libRow.barcode.slice(8);
        const builtin = BUILTINS.find((b) => b.slug === slug);
        resolvedGrams = builtin
          ? resolveBuiltinGrams(builtin, sizeWord, explicitGrams).grams
          : explicitGrams ?? extractGramsFromLabel(food.servingSize) ?? 100;
      } else {
        resolvedGrams = explicitGrams ?? extractGramsFromLabel(food.servingSize) ?? 100;
      }
      const servings = (count * resolvedGrams) / 100;
      return scaleMacros(food.perServing, servings);
    }
    // basis="serving" — labelled serving × count.
    return scaleMacros(food.perServing, count);
  }

  // B. Builtin reference table.
  const builtin = findBuiltin(rest);
  if (builtin) {
    const { grams: resolvedGrams } = resolveBuiltinGrams(builtin, sizeWord, explicitGrams);
    const servings = (count * resolvedGrams) / 100;
    return scaleMacros(builtin.per100g, servings);
  }

  // No local match — caller flags matched:false (never zero/invent).
  return null;
}

// ── estimateFood helpers (module-private) ─────────────────────────────────────

/**
 * Wraps revalidatePath so it silently no-ops when called outside the Next.js
 * App Router request context (e.g. tsx fixture scripts, unit tests).
 * In production the router cache is always present — this guard never fires.
 */
function safeRevalidate(path: string): void {
  try {
    revalidatePath(path);
  } catch {
    // Outside Next.js context (tsx scripts, test runners) — safe to ignore.
  }
}

// scaleMacros extracted to src/lib/food-resolve-local.ts (client-safe) and re-imported above.

/**
 * Build the items-textarea line.
 * Name is guaranteed pipe-free (normalizer contract); strips any stray pipes defensively.
 * Format:
 *   count=1:   "Banana | medium (118 g)"
 *   count≠1:   "Banana | 2 × medium (118 g)"  (integers)
 *              "Banana | 0.5 × medium (62 g)"  (fractions — 4 sig-fig decimal)
 */
function buildLine(name: string, portionLabel: string, count: number): string {
  const safeName = name.replace(/\|/g, "-");
  if (count === 1) {
    return `${safeName} | ${portionLabel}`;
  }
  // Round to 4 decimal places to avoid ugly repeating decimals (e.g. 0.3333333…)
  const displayCount = parseFloat(count.toFixed(4));
  return `${safeName} | ${displayCount} × ${portionLabel}`;
}

/**
 * Try to extract a gram value from a serving-size label string
 * (e.g. "medium (118 g)" → 118, "100 g" → 100).
 * Returns null if no gram value found.
 */
function extractGramsFromLabel(label: string | null): number | null {
  if (!label) return null;
  const m = label.match(/(\d+(?:\.\d+)?)\s*g\b/i);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Build a portion label string given resolved grams and an optional existing label.
 * When the grams came from an explicit user override we just show "Ng".
 */
function formatPortionLabel(
  grams: number,
  existingLabel: string | null,
  wasExplicit: boolean,
): string {
  if (wasExplicit) return `${grams} g`;
  return existingLabel ?? `${grams} g`;
}

/**
 * Convert a slug like "chicken-breast" → "Chicken Breast",
 * "white-rice-cooked" → "White Rice Cooked".
 */
function slugToDisplayName(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Resolve grams from USDA foodMeasures for a size word or explicit grams.
 * Falls back to the first measure's gramWeight, then 100 g.
 */
function resolveUsdaGrams(
  measures: { disseminationText: string; gramWeight: number }[],
  sizeWord: "small" | "medium" | "large" | null,
  explicitGrams: number | null,
): { grams: number; label: string } {
  if (explicitGrams != null) {
    return { grams: explicitGrams, label: `${explicitGrams} g` };
  }
  if (sizeWord && measures.length > 0) {
    const match = measures.find((m) =>
      m.disseminationText.toLowerCase().includes(sizeWord),
    );
    if (match) {
      return {
        grams: match.gramWeight,
        label: `${match.disseminationText} (${match.gramWeight} g)`,
      };
    }
  }
  if (measures.length > 0) {
    const first = measures[0];
    return {
      grams: first.gramWeight,
      label: `${first.disseminationText} (${first.gramWeight} g)`,
    };
  }
  return { grams: 100, label: "100 g" };
}

/**
 * Upsert a FoodLibrary row for a builtin or USDA estimate.
 * Returns the library row and whether this was a brand-new row (isNew=true).
 *
 * Barcode column stores the namespaced key ("builtin:<slug>" or "usda:<fdcId>").
 * These keys are never matched by lookupBarcode's digit-only filter, so real
 * barcode lookups are unaffected.
 */
async function upsertEstimateRow(opts: {
  barcode: string;
  name: string;
  servingSize: string;
  macros: FoodMacros;
  source: string;
}): Promise<{ food: LibraryFood; isNew: boolean }> {
  const existing = await prisma.foodLibrary.findFirst({
    where: { barcode: opts.barcode },
  });

  const row = await prisma.foodLibrary.upsert({
    where: { barcode: opts.barcode },
    create: {
      barcode: opts.barcode,
      name: opts.name,
      brand: null,
      servingSize: opts.servingSize,
      basis: "100g",
      calories: opts.macros.calories,
      proteinG: opts.macros.proteinG,
      carbsG: opts.macros.carbsG,
      fatG: opts.macros.fatG,
      fiberG: opts.macros.fiberG,
      sodiumMg: opts.macros.sodiumMg,
      source: opts.source,
      usageCount: 1,
      lastUsedAt: new Date(),
    },
    update: {
      usageCount: { increment: 1 },
      lastUsedAt: new Date(),
    },
  });

  return { food: toLibraryFood(row), isNew: existing == null };
}
