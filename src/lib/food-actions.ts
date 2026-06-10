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
import { searchUsdaFood } from "@/lib/usda";
import type { BarcodeLookupResult, LibraryFood, FoodMacros } from "@/lib/food-types";
import type { OffProduct } from "@/lib/openfoodfacts";

// ── lookupBarcode ─────────────────────────────────────────────────────────────

/**
 * Look up a barcode in the personal food library, or fetch it from
 * OpenFoodFacts and upsert it into the library.
 *
 * Multi-form barcode match rules (EAN-8 / UPC-A / EAN-13 interop):
 *   • EAN-8  (8 digits):                 looked up as-is — do NOT zero-pad to 13
 *   • UPC-A  (12 digits):                padded form = "0" + barcode (EAN-13 equivalent)
 *   • EAN-13 starting with 0 (13 digits):stripped form = barcode.slice(1) (UPC-A equivalent)
 *   • Any other length:                  raw form only
 *
 * Canonical storage key for upserts = padded EAN-13 for UPC-A input; raw otherwise.
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

  if (existing) {
    await prisma.foodLibrary.update({
      where: { id: existing.id },
      data: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
    });
    return { status: "found", food: toLibraryFood(existing), fromLibrary: true };
  }

  // ── OFF fetch (only on library miss) ─────────────────────────────────────
  // For 12-digit UPC-A: first try the raw 12-digit form, then retry with "0" + barcode.
  let result = await fetchOff(barcode, canonicalKey);
  if (result.status === "not_found" && barcode.length === 12) {
    result = await fetchOff("0" + barcode, "0" + barcode);
  }
  return result;
}

// ── OFF HTTP layer ────────────────────────────────────────────────────────────

const OFF_UA = "Goaldmine/1.0 (github.com/jronnomo/goaldmine)";
const OFF_FIELDS = [
  "product_name",
  "brands",
  "serving_size",
  "energy-kcal_serving",
  "energy_serving",
  "energy-kcal_100g",
  "energy_100g",
  "nutriments",
].join(",");

/**
 * OFF HTTP response discipline:
 *   HTTP 200 + json.status === 1 + json.product present → found
 *   HTTP 200 + json.status === 0                         → not_found (incomplete OFF record)
 *   HTTP 404                                             → not_found (product absent from OFF)
 *   Any other non-2xx (429, 500, etc.)                  → error (retryable — OFF may be down)
 *   Network failure / timeout (AbortError)              → error (retryable)
 *
 * Only "not_found" writes nothing to the DB.
 * "error" returns a Retry affordance; never silently swallowed as not_found.
 */
async function fetchOff(
  code: string,
  canonicalKey: string,
): Promise<BarcodeLookupResult> {
  const url = `https://world.openfoodfacts.org/api/v2/product/${code}?fields=${OFF_FIELDS}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": OFF_UA },
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) {
      // 404 = product not in OFF. Any other non-2xx = transient failure.
      return res.status === 404
        ? { status: "not_found" }
        : { status: "error", message: "OpenFoodFacts unavailable — try again" };
    }

    const json = (await res.json()) as { status: number; product?: unknown };
    // 200 + status:1 = found. 200 + status:0 = not_found (incomplete record).
    if (json.status !== 1 || !json.product) return { status: "not_found" };

    const normalized = normalizeOffProduct(json.product as OffProduct, code);

    const upserted = await prisma.foodLibrary.upsert({
      where: { barcode: canonicalKey },
      create: {
        barcode: canonicalKey,
        name: normalized.name,
        brand: normalized.brand,
        servingSize: normalized.servingSize,
        basis: normalized.basis,
        ...normalized.macros,
        usageCount: 1,
        lastUsedAt: new Date(),
      },
      update: {
        // Re-normalize on re-encounter: OFF data can improve over time
        name: normalized.name,
        brand: normalized.brand,
        servingSize: normalized.servingSize,
        basis: normalized.basis,
        ...normalized.macros,
        usageCount: { increment: 1 },
        lastUsedAt: new Date(),
      },
    });

    // Invalidate the RSC router cache so NutritionPage re-renders with fresh
    // quickPickFoods. Client component state (itemsText, macros, etc.) survives
    // intact — React preserves client instances across RSC payload refreshes.
    revalidatePath("/nutrition");

    return { status: "found", food: toLibraryFood(upserted), fromLibrary: false };
  } catch {
    return { status: "error", message: "Network error — try again" };
  }
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
  revalidatePath("/nutrition");
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

      const { food, isNew } = await upsertEstimateRow({
        barcode,
        name: displayName,
        servingSize: servingSizeLabel,
        macros: builtin.per100g,
        source: "builtin",
      });

      if (isNew) safeRevalidate("/nutrition");

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

      const { food, isNew } = await upsertEstimateRow({
        barcode,
        name: displayName,
        servingSize: servingSizeLabel,
        macros: usda.per100g,
        source: "usda",
      });

      if (isNew) safeRevalidate("/nutrition");

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

/**
 * Scale a per-100 g FoodMacros by a servings multiplier.
 * House rounding rules: calories/sodiumMg → integer; protein/carbs/fat/fiber → 1 dp.
 */
function scaleMacros(per100g: FoodMacros, servings: number): FoodMacros {
  function scaleInt(v: number | null): number | null {
    if (v == null) return null;
    return Math.round(v * servings);
  }
  function scale1dp(v: number | null): number | null {
    if (v == null) return null;
    return Math.round(v * servings * 10) / 10;
  }
  return {
    calories: scaleInt(per100g.calories),
    proteinG: scale1dp(per100g.proteinG),
    carbsG: scale1dp(per100g.carbsG),
    fatG: scale1dp(per100g.fatG),
    fiberG: scale1dp(per100g.fiberG),
    sodiumMg: scaleInt(per100g.sodiumMg),
  };
}

/**
 * Build the items-textarea line.
 * Name is guaranteed pipe-free (normalizer contract); strips any stray pipes defensively.
 * Format:
 *   count=1: "Banana | medium (118 g)"
 *   count>1: "Banana | 2 × medium (118 g)"
 */
function buildLine(name: string, portionLabel: string, count: number): string {
  const safeName = name.replace(/\|/g, "-");
  const portion = count > 1 ? `${count} × ${portionLabel}` : portionLabel;
  return `${safeName} | ${portion}`;
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
