"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { normalizeOffProduct } from "@/lib/openfoodfacts";
import type { BarcodeLookupResult, LibraryFood } from "@/lib/food-types";
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
