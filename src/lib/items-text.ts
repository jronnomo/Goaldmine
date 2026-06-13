// Shared, pure (server-safe, no "use server") helpers for converting between a
// nutrition-items textarea and the structured NutritionItem[] stored on
// NutritionLog.items. Used by the nutrition server actions (logNutrition /
// updateNutrition) and the meal edit UI so parsing/serialization stay in lockstep.

import type { NutritionItem } from "@/lib/nutrition-log-ops";

/**
 * Parse a nutrition-items textarea into structured items.
 *
 * Each line is "name | qty | notes" (qty/notes optional). Parts are trimmed,
 * blank lines and empty-name lines are skipped, and undefined qty/notes are
 * omitted rather than stored as empty strings.
 */
export function parseItemsText(raw: string): NutritionItem[] {
  const out: NutritionItem[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [namePart, qtyPart, notesPart] = trimmed.split("|").map((p) => p.trim());
    if (!namePart) continue;
    out.push({
      name: namePart,
      ...(qtyPart ? { qty: qtyPart } : {}),
      ...(notesPart ? { notes: notesPart } : {}),
    });
  }
  return out;
}

/**
 * Serialize structured items back into the textarea format — one line per item.
 *
 * Present parts (name, then qty, then notes) are joined with " | ", omitting any
 * trailing empty fields. This mirrors the edit page's former itemsToText exactly
 * so round-trips through the textarea are stable.
 */
export function serializeItems(items: NutritionItem[]): string {
  return items
    .map((i) => {
      const parts = [i.name];
      if (i.qty) parts.push(i.qty);
      if (i.notes) parts.push(i.notes);
      return parts.join(" | ");
    })
    .join("\n");
}
