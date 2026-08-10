// src/lib/saved-meal.ts
// Pure helpers for logging a NutritionLog from a SavedMeal reference (#275)
// and for true food-linked bundles (2026-08).
//
// A SavedMeal stores items + (optional) macros describing `defaultServings`
// worth of the meal. When log_nutrition is called with savedMealId, the logged
// meal is derived by scaling the stored data by `servings ÷ defaultServings`.
//
// TWO ITEM KINDS coexist in one bundle (all fields additive on the Json
// column — legacy text-only meals stay valid forever):
//
//   TEXT item   — { name, qty?, notes? } (+ optional itemMacros). Scaling
//                 annotates qty ("1 bowl ×0.5") and multiplies itemMacros.
//                 The pre-bundle behavior, byte-preserved.
//
//   LINKED item — additionally carries foodId + amount + unit + itemMacros +
//                 source (the full ItemFoodSnapshot captured AT SAVE TIME —
//                 the same §B.5 snapshot-off-at-save doctrine FoodLibrary
//                 follows: a later FoodLibrary edit does NOT silently rewrite
//                 the bundle; re-save the meal to refresh it). Scaling
//                 multiplies `amount` and recomputes qty/itemMacros from the
//                 saved source, producing a row INDISTINGUISHABLE from
//                 hand-picking the same food at that amount in the composer.
//
// Totals for a bundle with linked items use the composer's own math
// (sumStructuredMacros + recomposeMacros over the scaled items, plus the
// scaled save-time residual), so a bundle log and a hand-built log of the
// same foods carry identical items AND identical macro columns — the owner's
// core requirement. Meals with no linked items keep the legacy lump-sum
// scaling (scaleSavedMealMacros) unchanged.
//
// No Prisma imports — keep this file pure and unit-testable (convention:
// mirrors readiness.ts / rarity-core.ts purity).

import { MACRO_KEYS, type NutritionMacros } from "@/lib/nutrition-plan";
import {
  parseStoredItems,
  type ItemMacros,
  type NutritionItem,
} from "@/lib/nutrition-log-ops";
import {
  buildQtyDisplay,
  computeItemMacros,
  recomposeMacros,
  sumStructuredMacros,
} from "@/lib/food-units";

/**
 * A stored SavedMeal item row: everything a NutritionLog item can carry, plus
 * a top-level `foodId` FoodLibrary link (durable provenance even if `source`
 * is ever absent). Legacy rows are the plain { name, qty?, notes? } subset.
 */
export type SavedMealItem = NutritionItem & { foodId?: string };

/**
 * Defensive parse of SavedMeal.items (Json column). Row validation delegates
 * to nutrition-log-ops' parseStoredItems (same posture: skip malformed rows
 * rather than throw, never trust stored Json blindly), then lifts the
 * SavedMeal-only top-level foodId. Parsed per-row so a dropped malformed row
 * can't misalign the foodId pairing.
 */
export function parseSavedMealItems(raw: unknown): SavedMealItem[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedMealItem[] = [];
  for (const v of raw) {
    const [item] = parseStoredItems([v]);
    if (!item) continue;
    const foodId =
      v != null && typeof v === "object" && typeof (v as Record<string, unknown>).foodId === "string"
        ? ((v as Record<string, unknown>).foodId as string)
        : undefined;
    out.push(foodId ? { ...item, foodId } : item);
  }
  return out;
}

/** Defensive parse of SavedMeal.macros (Json? column) into NutritionMacros. */
export function parseSavedMealMacros(raw: unknown): NutritionMacros | undefined {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const k of MACRO_KEYS) {
    const v = r[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return Object.keys(out).length > 0 ? (out as NutritionMacros) : undefined;
}

/**
 * Scale factor for a saved-meal log: servings ÷ defaultServings.
 * The stored items/macros describe `defaultServings` worth of the meal, so
 * eating `servings` servings multiplies the stored macros by this factor.
 * A non-positive defaultServings (bad data) is treated as 1.
 */
export function savedMealScaleFactor(servings: number, defaultServings: number): number {
  const denom = defaultServings > 0 ? defaultServings : 1;
  return servings / denom;
}

/** Trim a factor for display: "2", "0.5", "1.33" (never "2.00"). */
function formatFactor(f: number): string {
  return Number.isInteger(f) ? String(f) : String(Number(f.toFixed(2)));
}

/** Round a scaled macro to one decimal (keeps 6.5 F × 2 = 13, not 13.000001). */
function round1(n: number): number {
  return Number(n.toFixed(1));
}

/** Round a scaled structured amount to two decimals (8 × 0.75 = 6, 118 × 0.25 = 29.5). */
function round2(n: number): number {
  return Number(n.toFixed(2));
}

/** Multiply every present macro field by `factor`, rounded to 1 decimal. */
export function scaleSavedMealMacros(
  macros: NutritionMacros | undefined,
  factor: number,
): NutritionMacros | undefined {
  if (!macros) return undefined;
  const out: Record<string, number> = {};
  for (const k of MACRO_KEYS) {
    const v = macros[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = round1(v * factor);
  }
  return Object.keys(out).length > 0 ? (out as NutritionMacros) : undefined;
}

/**
 * Annotate item qty strings when the scale factor ≠ 1 so the logged item list
 * stays human-readable while making the scaling visible:
 *   { qty: "1 brookie" }, factor 2   → { qty: "1 brookie ×2" }
 *   { (no qty) },        factor 0.5 → { qty: "×0.5 of saved qty" }
 * Factor 1 returns copies untouched (the stored items already describe
 * exactly what was eaten).
 */
export function annotateItemsForFactor(items: SavedMealItem[], factor: number): SavedMealItem[] {
  if (factor === 1) return items.map((i) => ({ ...i }));
  const marker = `×${formatFactor(factor)}`;
  return items.map((i) => ({
    ...i,
    qty: i.qty ? `${i.qty} ${marker}` : `${marker} of saved qty`,
  }));
}

/** True when the item can expand structurally: save-time snapshot + a scalable portion. */
function isExpandableLinked(i: SavedMealItem): boolean {
  return (
    i.source != null &&
    typeof i.amount === "number" &&
    Number.isFinite(i.amount) &&
    i.amount > 0 &&
    typeof i.unit === "string" &&
    i.unit.length > 0
  );
}

/**
 * Expand a LINKED item at `factor`: amount scales, qty re-renders from the
 * save-time source snapshot, itemMacros recompute at the scaled amount — the
 * exact object the composer's hand-add path builds for this food at this
 * amount. Top-level foodId is intentionally dropped: hand-added rows don't
 * carry one (linkage lives in source.foodId), and web logs round-trip through
 * parseStoredItems which wouldn't keep it — so both channels stay identical.
 */
function expandLinkedItem(i: SavedMealItem, factor: number): NutritionItem {
  const source = i.source!;
  const unit = i.unit!;
  const amount = factor === 1 ? i.amount! : round2(i.amount! * factor);
  const qty = factor === 1 && i.qty ? i.qty : buildQtyDisplay(amount, unit, source);
  const base: NutritionItem = {
    name: i.name,
    qty,
    ...(i.notes !== undefined && { notes: i.notes }),
    amount,
    unit,
    source,
  };
  const itemMacros =
    factor === 1 && i.itemMacros ? i.itemMacros : computeItemMacros(base);
  return itemMacros ? { ...base, itemMacros } : base;
}

/**
 * Expand a TEXT item at `factor`: the pre-bundle annotation behavior (qty
 * marker), plus itemMacros (when present) scale by the factor. foodId (an
 * unresolvable link) is dropped from the logged row.
 */
function expandTextItem(i: SavedMealItem, factor: number): NutritionItem {
  const rest: SavedMealItem = { ...i };
  delete rest.foodId;
  const [annotated] = annotateItemsForFactor([rest], factor);
  const out = annotated!;
  if (factor !== 1 && out.itemMacros) {
    const scaled = scaleSavedMealMacros(out.itemMacros, factor);
    if (scaled) return { ...out, itemMacros: scaled as ItemMacros };
    delete out.itemMacros; // defensive: sanitized snapshots are never empty
  }
  return out;
}

/**
 * The scaled save-time residual: the part of the STORED meal macros not
 * explained by the stored linked items (manual/estimated extras captured at
 * save), scaled by `factor`. Only keys the stored macros actually recorded
 * participate — an absent key means "not estimated", never zero. Zero-rounded
 * keys are dropped; all-zero → undefined (a fully-linked bundle needs no lump
 * credit at all, so the composer derives its total purely from the items —
 * identical to hand-adding them).
 */
function computeScaledResidual(
  stored: NutritionMacros | undefined,
  savedStructSum: ReturnType<typeof sumStructuredMacros>,
  factor: number,
): NutritionMacros | undefined {
  if (!stored) return undefined;
  const out: Record<string, number> = {};
  for (const k of MACRO_KEYS) {
    const sv = stored[k];
    if (typeof sv !== "number" || !Number.isFinite(sv)) continue;
    const scaled = round1((sv - (savedStructSum[k] ?? 0)) * factor);
    if (scaled !== 0) out[k] = scaled;
  }
  return Object.keys(out).length > 0 ? (out as NutritionMacros) : undefined;
}

export type DerivedSavedMealLog = {
  /** Scaled, composer-ready items — the exact rows the NutritionLog gets. */
  items: NutritionItem[];
  /**
   * Final row macro totals. Bundles with linked items use the composer's own
   * recompose math (all six keys, house rounding) so MCP-written rows match
   * web-composed rows; text-only meals keep the legacy lump scaling.
   */
  macros: NutritionMacros | undefined;
  /**
   * The lump macro credit the WEB composer should pass alongside the items
   * (addItem opts.macros): only the portion NOT derivable from the items'
   * source snapshots. undefined for a fully-linked bundle (items self-compute);
   * the full scaled macros for a legacy text-only meal (unchanged behavior).
   */
  residualMacros: NutritionMacros | undefined;
  factor: number;
};

/**
 * Derive the loggable items + macros for `servings` servings of a SavedMeal
 * row (raw Json columns in, clean scaled values out). Shared by the web
 * composer expansion (#296 quick-pick) and log_nutrition(savedMealId) so both
 * channels produce identical NutritionLog content.
 */
export function deriveSavedMealLog(
  meal: { items: unknown; macros: unknown; defaultServings: number },
  servings: number,
): DerivedSavedMealLog {
  const factor = savedMealScaleFactor(servings, meal.defaultServings);
  const parsed = parseSavedMealItems(meal.items);
  const stored = parseSavedMealMacros(meal.macros);
  const anyLinked = parsed.some(isExpandableLinked);

  const items = parsed.map((i) =>
    isExpandableLinked(i) ? expandLinkedItem(i, factor) : expandTextItem(i, factor),
  );

  if (!anyLinked) {
    // Legacy text-only path — lump-sum scaling, byte-identical to pre-bundle
    // behavior. The whole scaled lump is also the composer credit.
    const macros = scaleSavedMealMacros(stored, factor);
    return { items, macros, residualMacros: macros, factor };
  }

  // Bundle path: totals via the composer's own math over the scaled items,
  // plus the scaled save-time residual — so bundle logs and hand-built logs
  // of the same foods are indistinguishable.
  const residualMacros = computeScaledResidual(stored, sumStructuredMacros(parsed), factor);
  const structSum = sumStructuredMacros(items);
  const totals = recomposeMacros(structSum, residualMacros ?? {});
  const macros: Record<string, number> = {};
  for (const k of MACRO_KEYS) macros[k] = totals[k] ?? 0;
  return { items, macros: macros as NutritionMacros, residualMacros, factor };
}

/**
 * Map a composed meal's items (composer state / a logged row) to storable
 * SavedMeal items — the "Save as meal" capture. Linked items keep their full
 * save-time snapshot (source + amount/unit) and get foodId lifted to the top
 * level; itemMacros are computed from the snapshot when the item doesn't
 * already carry them. Freehand items store as text rows.
 */
export function buildSavedMealItemsFromComposition(items: NutritionItem[]): SavedMealItem[] {
  return items.map((i) => {
    const itemMacros = i.itemMacros ?? computeItemMacros(i);
    return {
      name: i.name,
      ...(i.qty !== undefined && { qty: i.qty }),
      ...(i.notes !== undefined && { notes: i.notes }),
      ...(i.source?.foodId ? { foodId: i.source.foodId } : {}),
      ...(i.amount !== undefined && { amount: i.amount }),
      ...(i.unit !== undefined && { unit: i.unit }),
      ...(itemMacros ? { itemMacros } : {}),
      ...(i.source ? { source: i.source } : {}),
    };
  });
}

/**
 * The FoodLibrary links inside a (stored or expanded) item list, with the
 * portion when one is resolvable — feeds the per-food FoodUsage bump on
 * bundle expansion (same recordFoodUse contract as an individual chip pick).
 */
export function linkedFoodPortions(
  items: SavedMealItem[],
): Array<{ foodId: string; amount?: number; unit?: string }> {
  const out: Array<{ foodId: string; amount?: number; unit?: string }> = [];
  for (const i of items) {
    const foodId = i.source?.foodId ?? i.foodId;
    if (!foodId) continue;
    const hasPortion =
      typeof i.amount === "number" && Number.isFinite(i.amount) && i.amount > 0 && !!i.unit;
    out.push(hasPortion ? { foodId, amount: i.amount, unit: i.unit } : { foodId });
  }
  return out;
}

/**
 * Serializable SavedMeal shape threaded to the composer quick-pick (#296).
 * Items/macros are pre-parsed server-side (via the defensive parsers above)
 * so the client renders clean typed data — same posture as LibraryFood.
 */
export type SavedMealLite = {
  id: string;
  name: string;
  items: SavedMealItem[];
  macros?: NutritionMacros;
  defaultServings: number;
};

/** Map a SavedMeal DB row (raw Json columns) to the client-safe lite shape. */
export function toSavedMealLite(row: {
  id: string;
  name: string;
  items: unknown;
  macros: unknown;
  defaultServings: number;
}): SavedMealLite {
  return {
    id: row.id,
    name: row.name,
    items: parseSavedMealItems(row.items),
    macros: parseSavedMealMacros(row.macros),
    defaultServings: row.defaultServings,
  };
}
