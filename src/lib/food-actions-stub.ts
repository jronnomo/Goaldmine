/**
 * food-actions-stub.ts — development stub for lookupBarcode.
 *
 * INTEGRATION: swap import in ScanFoodSheet.tsx to "@/lib/food-actions" and delete this file.
 *
 * Canned responses:
 *   - Any barcode starting with "0" AND length 13: not_found
 *   - "00000000000002": error
 *   - Everything else: found (fixture LibraryFood)
 */
import type { BarcodeLookupResult, LibraryFood } from "@/lib/food-types";

const FIXTURE_FOOD: LibraryFood = {
  id: "stub-id-001",
  barcode: "012345678901",
  name: "Stub Product",
  brand: "Stub Brand",
  servingSize: "100 g",
  basis: "serving",
  perServing: {
    calories: 120,
    proteinG: 5.5,
    carbsG: 18.0,
    fatG: 3.2,
    fiberG: 1.0,
    sodiumMg: 85,
  },
};

export async function lookupBarcode(barcode: string): Promise<BarcodeLookupResult> {
  // Simulate network latency
  await new Promise<void>((r) => setTimeout(r, 800));

  // "0"-prefixed 13-digit codes → not_found (garbage / unknown product)
  if (barcode.length === 13 && barcode.startsWith("0")) {
    return { status: "not_found" };
  }

  // Explicit error trigger for testing
  if (barcode === "00000000000002") {
    return { status: "error", message: "Network error (stub)" };
  }

  return {
    status: "found",
    fromLibrary: false,
    food: { ...FIXTURE_FOOD, barcode },
  };
}
