// Surgical ops for editing a NutritionLog's items array without re-emitting
// the whole list. Mirrors day-template-ops.ts for prescribed workouts.
//
// Pure transform — accepts the current items array + an ops array, returns a
// new items array. The caller (the nutrition_log_ops MCP tool) handles the
// fetch / write and the PATCH semantics around the surrounding row.

import { z } from "zod";
import type { FoodMacros } from "@/lib/food-types";

/**
 * Per-food snapshot captured at add-time.  Stored inside NutritionItem.source
 * so the app can recalculate macros offline after the user changes amount/unit.
 *
 * basis "100g" = perBasis is macros per 100 g (USDA / builtins).
 * basis "serving" = perBasis is macros per 1 label serving.
 */
export type ItemFoodSnapshot = {
  /** "100g" = perBasis is per 100 g; "serving" = perBasis is per 1 label serving. */
  basis: "100g" | "serving";
  /** Macros per basis unit. Stored at add-time from food.perServing. */
  perBasis: FoodMacros;
  /** Piece-unit definitions; [] for foods without portions (non-builtins, serving-basis). */
  portions: { key: string; label: string; grams: number }[];
  /** Informational only — the FoodLibrary row id. */
  foodId?: string;
  brand?: string | null;
};

export type NutritionItem = {
  name: string;
  qty?: string;    // display string — kept for freehand / legacy / back-compat
  notes?: string;
  // ── Structured fields (new; all optional for back-compat) ──
  amount?: number;               // structured quantity
  unit?: string;                 // unit key: "g" | "oz" | "serving" | <portion key>
  source?: ItemFoodSnapshot;     // present only on food-resolved items
};

// Match by 0-based index or by case-insensitive substring against item name.
const ItemMatchShape = z.union([z.string().min(1), z.number().int().min(0)]);

const ItemInputShape = z.object({
  name: z.string().min(1),
  qty: z.string().optional(),
  notes: z.string().optional(),
});

const AddItemOp = z.object({
  op: z.literal("addItem"),
  item: ItemInputShape,
  at: z
    .union([z.enum(["end", "start"]), z.number().int().min(0)])
    .optional()
    .describe("Position in the items array: 'end' (default), 'start', or a 0-based index."),
});

const UpdateItemOp = z.object({
  op: z.literal("updateItem"),
  match: ItemMatchShape.describe(
    "Which item to update — 0-based index OR case-insensitive substring against item name. Substring must match exactly one item.",
  ),
  patch: ItemInputShape.partial().describe(
    "Fields to overwrite on the matched item. Pass only the fields to change; others are preserved.",
  ),
});

const RemoveItemOp = z.object({
  op: z.literal("removeItem"),
  match: ItemMatchShape.describe(
    "Which item to remove — 0-based index OR case-insensitive substring against item name. Substring must match exactly one item.",
  ),
});

export const NutritionLogOpSchema = z.discriminatedUnion("op", [
  AddItemOp,
  UpdateItemOp,
  RemoveItemOp,
]);

export type NutritionLogOp = z.infer<typeof NutritionLogOpSchema>;

// Coerce a raw items JSON value (from Prisma) into a typed array. Preserves
// all structured fields (amount, unit, source) so round-trips through storage
// do not lose the food snapshot needed for offline macro recalculation.
export function parseStoredItems(raw: unknown): NutritionItem[] {
  if (!Array.isArray(raw)) return [];
  const out: NutritionItem[] = [];
  for (const v of raw) {
    if (v == null || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    if (typeof r.name !== "string" || !r.name) continue;
    out.push({
      name:   r.name,
      qty:    typeof r.qty    === "string"                          ? r.qty    : undefined,
      notes:  typeof r.notes  === "string"                          ? r.notes  : undefined,
      amount: typeof r.amount === "number" && isFinite(r.amount as number)
                                                                    ? (r.amount as number)
                                                                    : undefined,
      unit:   typeof r.unit   === "string"                          ? r.unit   : undefined,
      source: isValidItemFoodSnapshot(r.source)
                                                                    ? (r.source as ItemFoodSnapshot)
                                                                    : undefined,
    });
  }
  return out;
}

/** Runtime guard — validates the minimum shape of a stored ItemFoodSnapshot. */
function isValidItemFoodSnapshot(v: unknown): boolean {
  if (v == null || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (r.basis === "100g" || r.basis === "serving")
    && typeof r.perBasis === "object" && r.perBasis != null
    && Array.isArray(r.portions);
}

/**
 * Strip the `source` (food snapshot) from item arrays before returning them
 * to MCP read tools. Keeps name/qty/notes/amount/unit — the coach can see
 * "7 large egg whites" without needing the perBasis/portions rendering payload.
 *
 * source is ~350 bytes per structured item; a 14-day history with 3 meals ×
 * 5 items = 210 items × ~350 bytes = ~73 KB extra in recent_history context.
 *
 * This helper is NOT applied on the write/edit-seed path — parseStoredItems
 * preserves source for the app's offline recalc. It is ONLY used in MCP
 * read-only tools that serialize for coach context.
 */
export function stripItemSource(
  raw: unknown,
): Array<{ name?: string; qty?: string; notes?: string; amount?: number; unit?: string }> {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).map((v) => {
    if (v == null || typeof v !== "object") return {};
    const r = v as Record<string, unknown>;
    return {
      ...(typeof r.name   === "string" ? { name:   r.name }   : {}),
      ...(typeof r.qty    === "string" ? { qty:    r.qty }    : {}),
      ...(typeof r.notes  === "string" ? { notes:  r.notes }  : {}),
      ...(typeof r.amount === "number" ? { amount: r.amount } : {}),
      ...(typeof r.unit   === "string" ? { unit:   r.unit }   : {}),
      // source intentionally omitted
    };
  });
}

// Resolve an ItemMatch against the current items array.
function findItemIndex(items: NutritionItem[], match: string | number, opIndex: number): number {
  if (typeof match === "number") {
    if (match < 0 || match >= items.length) {
      throw new Error(
        `ops[${opIndex}]: index ${match} is out of range (log has ${items.length} item${items.length === 1 ? "" : "s"}).`,
      );
    }
    return match;
  }
  const needle = match.toLowerCase();
  const hits = items
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => it.name.toLowerCase().includes(needle));
  if (hits.length === 0) {
    const avail = items.map((it, i) => `${i}: ${it.name}`).join(", ");
    throw new Error(
      `ops[${opIndex}]: no item matching "${match}". Available items: [${avail}].`,
    );
  }
  if (hits.length > 1) {
    const where = hits.map((h) => `${h.i}: ${h.it.name}`).join(", ");
    throw new Error(
      `ops[${opIndex}]: "${match}" matched ${hits.length} items (${where}). Use a more specific substring or an index.`,
    );
  }
  return hits[0]!.i;
}

// Apply ops sequentially to a clone of the input items. Each op sees the
// result of prior ops in the batch. Throws on the first op that can't be
// applied; the caller never sees a half-applied result.
export function applyNutritionLogOps(
  base: NutritionItem[],
  ops: NutritionLogOp[],
): NutritionItem[] {
  if (ops.length === 0) {
    throw new Error("ops was empty — pass at least one operation.");
  }
  const working: NutritionItem[] = base.map((it) => ({ ...it }));

  ops.forEach((op, i) => {
    switch (op.op) {
      case "addItem": {
        const item: NutritionItem = { name: op.item.name, qty: op.item.qty, notes: op.item.notes };
        if (op.at === "start") {
          working.unshift(item);
        } else if (typeof op.at === "number") {
          if (op.at < 0 || op.at > working.length) {
            throw new Error(
              `ops[${i}]: position ${op.at} is out of range (log has ${working.length} item${working.length === 1 ? "" : "s"}; valid 0..${working.length}).`,
            );
          }
          working.splice(op.at, 0, item);
        } else {
          working.push(item);
        }
        break;
      }
      case "updateItem": {
        const idx = findItemIndex(working, op.match, i);
        working[idx] = { ...working[idx]!, ...op.patch };
        break;
      }
      case "removeItem": {
        const idx = findItemIndex(working, op.match, i);
        working.splice(idx, 1);
        break;
      }
    }
  });

  return working;
}
