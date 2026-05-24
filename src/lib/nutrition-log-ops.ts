// Surgical ops for editing a NutritionLog's items array without re-emitting
// the whole list. Mirrors day-template-ops.ts for prescribed workouts.
//
// Pure transform — accepts the current items array + an ops array, returns a
// new items array. The caller (the nutrition_log_ops MCP tool) handles the
// fetch / write and the PATCH semantics around the surrounding row.

import { z } from "zod";

export type NutritionItem = {
  name: string;
  qty?: string;
  notes?: string;
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

// Coerce a raw items JSON value (from Prisma) into a typed array. Drops
// entries that don't look like items so a malformed row never crashes ops.
export function parseStoredItems(raw: unknown): NutritionItem[] {
  if (!Array.isArray(raw)) return [];
  const out: NutritionItem[] = [];
  for (const v of raw) {
    if (v == null || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    if (typeof r.name !== "string" || !r.name) continue;
    out.push({
      name: r.name,
      qty: typeof r.qty === "string" ? r.qty : undefined,
      notes: typeof r.notes === "string" ? r.notes : undefined,
    });
  }
  return out;
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
