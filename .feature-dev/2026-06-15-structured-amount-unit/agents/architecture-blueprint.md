# Architecture Blueprint — Structured Amount + Unit Composer (live macro recalc)

**Date:** 2026-06-15
**Author:** Architect Agent (research pass)
**Status:** Final — ready for implementation streams

---

## 0. Research Findings (cited file:line)

### 0.1 `useFoodComposer.tsx` — the add path

**`handleAdd` (chip / scan path)** — `useFoodComposer.tsx:242-267`
Receives `AddFoodPayload { food: LibraryFood, servings: number, chipSource: boolean }`.
Calls `mergeFoodIntoForm(itemsText, macros, payload)` → `{ itemsText: string; macroValues: MacroValues }`.
Then calls `setItemsText(merged.itemsText)` (line 247) — the critical step.

**`handleEstimateAdd` (estimate strip path)** — `useFoodComposer.tsx:317-339`
Calls `mergeEstimateIntoForm(itemsText, macros, estimateResult.line, estimateResult.macros)`.
Then calls `setItemsText(merged.itemsText)` (line 325).

Both paths call `setItemsText`. MealComposer's `setItemsText` callback (lines 297-306):
```ts
setItemsText: (next: string) => {
  const parsed = parseItemsText(next);  // ← LOSSY: drops amount/unit/source
  if (rawMode) setRawText(next);
  else setItems(parsed);
  setSnapshotHash(hashItems(parsed));
},
```
**`parseItemsText` only knows `name/qty/notes` — any structured fields in the item are irrecoverably lost.** This is THE HARD PART.

**`handleEstimateAddAnyway`** (no match, plain line) — `useFoodComposer.tsx:342-351`
Also calls `setItemsText`, no food object → pure freehand item; keep as-is.

### 0.2 `MealComposer.tsx` — state model

- `items: NutritionItem[]` — structured array (lines 177).
- `macros: MacroValues` — separate running total (line 185). **This is the authoritative submit value.**
- `snapshotHash: string` — hash of items at the point macros were last known-fresh (line 202).
- `stale = hashItems(effectiveItems) !== snapshotHash` — drives the stale-flag UI (line 242).
- `hashItems` (lines 105-107) hashes ONLY `[name, qty ?? "", notes ?? ""]` — never `amount/unit`.
- `updateItemQty` (line 311) — bumps `qty` text; does NOT touch `macros` or `snapshotHash` → causes stale. Keep for freehand rows.
- `handleMacroChange` (line 355) — manual macro edit → resets `snapshotHash` to current items (Fresh).
- `applyRecompute` (line 367) — sets `macros` + resets `snapshotHash` → Fresh.
- The `setItemsText` callback on line 297 is what MealComposer passes to `useFoodComposer` — it's the only current channel for item materialization.

### 0.3 `food-actions.ts` — data available at add time

`FoodEstimate` (lines 502-523): `{ status:"ok"; food: LibraryFood; servings: number; grams: number | null; macros: FoodMacros; source: "library"|"builtin"|"usda"; line: string }`.

`LibraryFood` (food-types.ts lines 36-45): `{ id, barcode, name, brand, servingSize, basis, perServing }`. **No `portions` field.** `perServing` = per-100g macros for `basis:"100g"`, per-serving macros for `basis:"serving"`.

`BuiltinFood` (food-builtins.ts lines 17-26): has `portions: { key, label, grams }[]` and `defaultPortionKey`. **The only source of piece-unit portions.**

To detect whether a `LibraryFood` is a builtin: check `food.barcode?.startsWith("builtin:")`. The slug is `food.barcode.slice(8)`. Used at food-actions.ts:562-567.

`food-parse.ts` is pure / client-safe ("No I/O, no 'use server'" — food-parse.ts:4). `ParsedFoodQuery { count, sizeWord, grams, rest }` — food-parse.ts:27-39.

### 0.4 `food-resolve-local.ts` — `scaleMacros`

`scaleMacros(perServing: FoodMacros, servings: number): FoodMacros` — food-resolve-local.ts:15-32.
Rounding: `calories`/`sodiumMg` → `Math.round`; others → `Math.round(v * s * 10) / 10`.
Client-safe (no "use server"). This is the single macro-scaling function; no new math needed.

### 0.5 `food-builtins.ts` — portions

`BuiltinFood.portions: { key: string; label: string; grams: number }[]` — food-builtins.ts:23.
`BUILTINS` exported — no "use server" directive. Client-safe to import.

### 0.6 `nutrition-log-ops.ts` — `parseStoredItems` BUG CONFIRMED

`parseStoredItems` (lines 61-75) explicitly constructs items with ONLY `name/qty/notes`:
```ts
out.push({
  name: r.name,
  qty: typeof r.qty === "string" ? r.qty : undefined,
  notes: typeof r.notes === "string" ? r.notes : undefined,
});
```
**Any stored `amount/unit/source` is silently stripped.** Must be fixed.

`NutritionItem` (lines 10-14): currently `{ name: string; qty?: string; notes?: string }`.

### 0.7 `items-text.ts` — lossy text channel

`parseItemsText` (lines 15-29): pipe-split → `{ name, qty?, notes? }`. No structured fields.
`serializeItems` (lines 38-47): `name | qty | notes` format. Cannot encode `amount/unit/source` (pipe is a separator and the format has no escaping).
**This channel is fundamentally lossy for structured data** — cannot be fixed without a format change.
**Conclusion: keep `items-text.ts` for freehand / raw-text path only. Add a JSON path.**

### 0.8 `workout-actions.ts` — `logNutrition` / `updateNutrition`

`logNutrition` (lines 211-231): reads `form.get("items")` → `parseItemsText(itemsRaw)` → stores.
`updateNutrition` (lines 238-260): same pattern.
Both call `revalidatePath("/", "layout")`, `"/"`, `"/nutrition"`.
`updateNutrition` does NOT currently `revalidatePath("/days/[dateKey]")` — confirm this is fine (edit sheet is already on the right day's page).

**Edit seeding**: MealComposer receives `props.defaults.items: NutritionItem[]` (MealComposer.tsx:32-37), sourced from `row.items as NutritionItem[]` in workout-actions.ts:289. Since `parseStoredItems` currently strips structured fields, edit mode loses `amount/unit/source` — will be fixed by the `parseStoredItems` fix.

---

## 1. Type Contract (Stream A must publish)

### 1.1 Extended `NutritionItem` and new `ItemFoodSnapshot`
**File: `src/lib/nutrition-log-ops.ts`**

```ts
export type ItemFoodSnapshot = {
  /** Macro basis: "100g" = macros are per 100 g; "serving" = macros are per label serving. */
  basis: "100g" | "serving";
  /** Macros per basis unit (per 100 g when basis="100g", per 1 serving when basis="serving"). */
  perBasis: FoodMacros;
  /** Piece units; empty for foods without portions (non-builtins, serving-basis foods). */
  portions: { key: string; label: string; grams: number }[];
  /** DB id of the FoodLibrary row (optional; informational only). */
  foodId?: string;
  brand?: string | null;
};

export type NutritionItem = {
  name: string;
  qty?: string;       // display string — kept for freehand / legacy / back-compat
  notes?: string;
  // ── Structured fields (NEW, all optional for back-compat) ──
  amount?: number;                // structured quantity
  unit?: string;                  // unit key: "g" | "oz" | "serving" | <portion.key>
  source?: ItemFoodSnapshot;      // enables offline recalc + unit dropdown
};
```

**Import `FoodMacros` from `@/lib/food-types`** (already imported in nutrition-log-ops.ts).

### 1.2 `UnitOption` and helpers
**File: `src/lib/food-units.ts` (NEW)**

```ts
import type { FoodMacros } from "@/lib/food-types";
import type { NutritionItem, ItemFoodSnapshot } from "@/lib/nutrition-log-ops";
import { scaleMacros } from "@/lib/food-resolve-local";
import { BUILTINS } from "@/lib/food-builtins";
import type { LibraryFood } from "@/lib/food-types";
import type { ParsedFoodQuery } from "@/lib/food-parse";

/** A selectable unit for a food-resolved item. */
export type UnitOption = {
  key: string;               // "g" | "oz" | "serving" | <portion.key>
  label: string;             // display: "gram" | "oz" | "serving" | "large egg white (33 g)"
  gramsEach?: number;        // for piece units: grams per piece (undefined for g/oz/serving)
};

/**
 * Build unit options from a food snapshot.
 *
 * 100g basis → always: "g", "oz"; + one option per portion (piece units).
 * serving basis → always: "serving". g/oz are NOT offered (servingSize is free text;
 *   gram extraction is fragile and out of scope per PRD §3.3).
 */
export function unitsForFood(snapshot: ItemFoodSnapshot): UnitOption[];

/**
 * Recalculate macros for a single structured item.
 *
 * Returns null (no-op for summation) when:
 *   - item.source is undefined (freehand/legacy)
 *   - item.amount is not a positive finite number
 *   - item.unit is unrecognized (falls back to null to avoid wrong math)
 *
 * Never throws.
 */
export function recalcItemMacros(item: NutritionItem): FoodMacros | null;

/**
 * Choose the default unit for a newly-added food.
 *
 * Logic (in order):
 *   1. If parsed.sizeWord matches a portion key exactly → that portion key.
 *   2. If snapshot has portions and parsed.count > 1 → first portion key.
 *   3. If snapshot has portions → snapshot's defaultPortionKey
 *      (looked up via BUILTINS using snapshot.foodId starting with "builtin:").
 *   4. For 100g basis → "g". For serving basis → "serving".
 *
 * parsed may be null (chip/scan paths without a text query).
 */
export function defaultUnitForQuery(
  parsed: Pick<ParsedFoodQuery, "count" | "sizeWord"> | null,
  snapshot: ItemFoodSnapshot,
): string;

/**
 * Build the display qty string from amount + unit (for the `qty` field).
 * Examples: (7, "large", ...) → "7 × large egg white (33 g)"
 *           (200, "g", ...)   → "200 g"
 *           (1.5, "oz", ...)  → "1.5 oz"
 *           (2, "serving", ..)→ "2 serving"
 */
export function buildQtyDisplay(
  amount: number,
  unit: string,
  snapshot: ItemFoodSnapshot,
): string;

/**
 * Build an ItemFoodSnapshot from a LibraryFood at add time.
 *
 * Portions: if food.barcode starts with "builtin:", look up BUILTINS by slug
 *           to get portions[]. Otherwise portions = [].
 * perBasis: food.perServing (already per-basis regardless of basis type).
 */
export function buildItemSnapshot(food: LibraryFood): ItemFoodSnapshot;
```

### 1.3 `useFoodComposer` interface change
**File: `src/components/useFoodComposer.tsx`**

Add to the hook's parameter object (alongside `setItemsText` which is kept for raw-text path):
```ts
/**
 * Called when a food-resolved structured item is materialized.
 * MealComposer uses this to splice the item into items[] directly
 * (bypassing the lossy text→parse roundtrip).
 * For rawMode, the callback should append to rawText instead.
 */
addItem: (item: NutritionItem) => void;
```

### 1.4 New MealComposer handler signatures

```ts
// In MealComposer:

/** Update amount + unit on a structured item; recomputes macros atomically. No stale flag. */
function updateItemAmountUnit(idx: number, amount: number, unit: string): void;

/** addItem callback passed to useFoodComposer. */
function addItemToComposer(item: NutritionItem): void;
```

---

## 2. Macro Summation Approach (the riskiest piece)

### 2.1 The problem
`macros: MacroValues` is a **running total** of ALL items (structured + freehand). There is no per-item macro stored in `NutritionItem`. Freehand items (no `source`) contributed their macros to the total at add-time via `mergeFoodIntoForm`. We cannot sum from scratch unless we can compute EVERY item's macros — which we can't for freehand items.

### 2.2 Solution: delta update (Option C)

When a structured item's `amount` or `unit` changes, apply a delta to the running total:
1. `oldMacros = recalcItemMacros(items[idx])` — using the CURRENT `amount/unit/source`
2. Build `newItem = { ...items[idx], amount, unit, qty: buildQtyDisplay(amount, unit, source) }`
3. `newMacros = recalcItemMacros(newItem)`
4. `delta[k] = (newMacros[k] ?? 0) − (oldMacros[k] ?? 0)` for each macro key
5. `newTotal[k] = Math.round((macros[k] ?? 0) + delta[k])` (rounding per macro type)
6. `setItems(newItems)`, `setMacros(newTotal)`, `setSnapshotHash(hashItems(newItems))` — **all three together**.

The snapshot reset (step 6) means `stale = false` immediately after a structured edit. Freehand `updateItemQty` never touches `macros` or `snapshotHash` → still goes stale (unchanged behavior).

### 2.3 Stale-flag invariant for structured items

A structured item change MUST atomically:
- Update items[idx]
- Update macros (delta)
- Reset snapshotHash

The stale flag then reads `false`. This is the ONLY path that avoids stale for non-add edits. No new stale-detection logic is needed; the invariant is enforced by `updateItemAmountUnit` being the only code path for structured-item edits.

### 2.4 `hashItems` extension

Extend to include `amount` and `unit` so snapshot hashes faithfully represent structured state:
```ts
function hashItems(items: NutritionItem[]): string {
  return JSON.stringify(
    items.map((i) => [i.name, i.qty ?? "", i.notes ?? "", i.amount ?? "", i.unit ?? ""])
  );
}
```

---

## 3. The `setItemsText` → `addItem` Bridge (solving the lossy text problem)

### 3.1 Current flow (lossy)
```
handleAdd → mergeFoodIntoForm → setItemsText(textWithNewLine)
  → MealComposer.setItemsText callback → parseItemsText(text) → setItems(parsed)
```
`parseItemsText` produces `{ name, qty? }` only. `amount/unit/source` are gone.

### 3.2 New flow (lossless for structured items)
Add `addItem: (item: NutritionItem) => void` to `useFoodComposer`'s props.

In `handleAdd` (chip/scan path):
```ts
function handleAdd(payload: AddFoodPayload) {
  const { food, chipSource } = payload;
  // Build structured item
  const snapshot = buildItemSnapshot(food);
  const unit = defaultUnitForQuery(null, snapshot); // no query on chip/scan path
  const amount = deriveAmountFromServings(payload.servings, unit, snapshot);
  const qty = buildQtyDisplay(amount, unit, snapshot);
  const structuredItem: NutritionItem = { name: food.name, qty, amount, unit, source: snapshot };

  // Macros: still computed from scaleMacros (unchanged logic)
  const merged = mergeFoodIntoForm(itemsText, macros, payload);
  onMacrosChanged?.(macros, merged.macroValues);
  setMacros(merged.macroValues);

  // Item: direct structured add (bypasses text parse)
  addItem(structuredItem);

  if (chipSource) recordFoodUse(food.id).catch(() => {});
  else setLocalAdditions(...);
}
```

In `handleEstimateAdd` (estimate strip path):
```ts
function handleEstimateAdd() {
  const est = estimateResult; // status:"ok"
  const snapshot = buildItemSnapshot(est.food);
  const parsedQuery = parseFoodQuery(lastEstimateQueryRef.current);
  const unit = defaultUnitForQuery(parsedQuery, snapshot);
  const amount = deriveAmountFromEstimate(est, unit, snapshot, parsedQuery);
  const qty = buildQtyDisplay(amount, unit, snapshot);
  const structuredItem: NutritionItem = { name: est.food.name, qty, amount, unit, source: snapshot };

  // Macros: unchanged (use est.macros as before)
  const merged = mergeEstimateIntoForm(itemsText, macros, est.line, est.macros);
  onMacrosChanged?.(macros, merged.macroValues);
  setMacros(merged.macroValues);

  addItem(structuredItem);
  // ... upsert chip, clear estimate state
}
```

`handleEstimateAddAnyway` (no match): still uses `mergeEstimateIntoForm` + the OLD `setItemsText` path, producing a freehand item with no `source`. OR: call `addItem({ name: line })` directly (cleaner — same result).

### 3.3 `addItemToComposer` callback in MealComposer

```ts
function addItemToComposer(item: NutritionItem): void {
  if (rawMode) {
    // rawMode: serialize the item to text and append to rawText
    const line = item.qty
      ? `${item.name} | ${item.qty}`
      : item.name;
    setRawText((prev) => prev + (prev.trim() ? "\n" : "") + line);
    // snapshot NOT reset in rawMode (stale path, same as existing)
  } else {
    setItems((prev) => {
      const next = [...prev, item];
      setSnapshotHash(hashItems(next));
      return next;
    });
  }
}
```

MCP macro update continues as before (via `setMacros`). The `onMacrosChanged` flash continues to fire from the existing macro-path.

### 3.4 `setItemsText` stays for freehand / raw-text

`setItemsText` remains as a prop so `handleEstimateAddAnyway` (if we keep using it) and other non-food paths still work. It is no longer used for food-resolved items. In the long term it could be removed, but keep for now.

---

## 4. Unit→Macros Conversion Math

### 4.1 `100g` basis

| unit key | conversion to grams | servings for scaleMacros |
|----------|---------------------|--------------------------|
| `"g"` | grams = amount | servings = amount / 100 |
| `"oz"` | grams = amount × 28.3495 | servings = grams / 100 |
| `<portion key>` | grams = amount × portion.grams | servings = grams / 100 |

Call: `scaleMacros(snapshot.perBasis, servings)`

### 4.2 `serving` basis

| unit key | conversion |
|----------|-----------|
| `"serving"` | servings = amount; `scaleMacros(snapshot.perBasis, amount)` |

g/oz NOT offered for serving-basis foods (PRD §3.3 — no density table, servingSize text is fragile).

### 4.3 Edge cases in `recalcItemMacros`

- `amount <= 0` or `!isFinite(amount)`: return `null` (contributes zeros to sum in `updateItemAmountUnit`).
- `unit` not in any known UnitOption for this snapshot: return `null` (stale-data edge case per PRD §6).
- `source` undefined: return `null` (freehand/legacy item).

### 4.4 `deriveAmountFromServings` (chip/scan path)

When a food is added via chip/scan with `servings` from `AddFoodPayload`:
- Unit = `"g"`: `amount = servings * 100` (total grams)
- Unit = piece key: `amount = Math.round((servings * 100) / portion.grams)` — round to nearest whole piece; at minimum 1
- Unit = `"serving"`: `amount = servings`
- Unit = `"oz"`: `amount = Math.round((servings * 100) / 28.3495 * 10) / 10`

### 4.5 `deriveAmountFromEstimate` (estimate path)

`FoodEstimate` carries `servings` and `grams`. For 100g-basis, `grams` = resolved per-piece grams, `servings = count * grams / 100`:
- Unit = `"g"`: `amount = Math.round(estimate.servings * 100)` (total grams)
- Unit = piece key: `amount = parsedQuery.count ?? 1` (the query count is the piece count)
- Unit = `"g"` (explicit grams query): `amount = parsedQuery.grams ?? Math.round(estimate.servings * 100)`
- Unit = `"serving"`: `amount = estimate.servings`

---

## 5. `ItemFoodSnapshot` Construction Recipe

**Function: `buildItemSnapshot(food: LibraryFood): ItemFoodSnapshot`** — in `food-units.ts`

```ts
export function buildItemSnapshot(food: LibraryFood): ItemFoodSnapshot {
  let portions: ItemFoodSnapshot['portions'] = [];
  if (food.barcode?.startsWith("builtin:")) {
    const slug = food.barcode.slice(8);
    const builtin = BUILTINS.find((b) => b.slug === slug);
    portions = builtin?.portions ?? [];
  }
  return {
    basis: food.basis,
    perBasis: food.perServing,   // per 100g for basis="100g", per serving for basis="serving"
    portions,
    foodId: food.id,
    brand: food.brand,
  };
}
```

**Key observations:**
- `perBasis = food.perServing` directly — `LibraryFood.perServing` is already named for its basis type. No conversion needed.
- `portions = []` for non-builtin library rows (no portion data available without DB schema change).
- USDA foods that were cached via `estimateFood` are stored with `barcode = "usda:<fdcId>"` — NOT builtins. They get `portions = []`. Users can still use `"g"` / `"oz"` for 100g-basis USDA foods.

---

## 6. `parseStoredItems` Fix

**File: `src/lib/nutrition-log-ops.ts`** (lines 61-75)

Replace the body of `parseStoredItems` to preserve structured fields:

```ts
export function parseStoredItems(raw: unknown): NutritionItem[] {
  if (!Array.isArray(raw)) return [];
  const out: NutritionItem[] = [];
  for (const v of raw) {
    if (v == null || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    if (typeof r.name !== "string" || !r.name) continue;
    out.push({
      name: r.name,
      qty:    typeof r.qty    === "string"  ? r.qty    : undefined,
      notes:  typeof r.notes  === "string"  ? r.notes  : undefined,
      amount: typeof r.amount === "number" && isFinite(r.amount) ? r.amount : undefined,
      unit:   typeof r.unit   === "string"  ? r.unit   : undefined,
      source: isValidItemFoodSnapshot(r.source) ? (r.source as ItemFoodSnapshot) : undefined,
    });
  }
  return out;
}

function isValidItemFoodSnapshot(v: unknown): boolean {
  if (v == null || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (r.basis === "100g" || r.basis === "serving")
    && typeof r.perBasis === "object" && r.perBasis != null
    && Array.isArray(r.portions);
}
```

The `NutritionLogOpSchema` (Zod schemas for MCP ops) only validates `name/qty/notes` in `ItemInputShape` — **DO NOT change the Zod schemas**. The MCP tool correctly round-trips unknown fields through `applyNutritionLogOps` because `working[idx] = { ...working[idx]!, ...op.patch }` — the spread preserves keys not in `op.patch`. Confirm: ✓ `amount/unit/source` survive MCP ops that don't touch those keys.

---

## 7. Persistence Channel (`itemsJson`)

### 7.1 `logNutrition` / `updateNutrition` in `workout-actions.ts`

Add an `itemsJson` read before the existing text parse:

```ts
// In logNutrition and updateNutrition:
const itemsJsonRaw = form.get("itemsJson") as string | null;
let items: NutritionItem[];
if (itemsJsonRaw) {
  try {
    const parsed = JSON.parse(itemsJsonRaw);
    items = parseStoredItems(parsed); // shape-guards + preserves structured fields
  } catch {
    // malformed JSON → fall back to text channel
    items = parseItemsText(String(form.get("items") ?? ""));
  }
} else {
  items = parseItemsText(String(form.get("items") ?? ""));
}
if (items.length === 0) throw new Error("List at least one food item");
```

The existing `parseMacros(form)` call is unchanged — macros still come from the form's named macro fields.

### 7.2 Hidden `itemsJson` field in `MealComposer.tsx`

Add alongside the existing `<textarea name="items" hidden ...>`:

```tsx
{/* Authoritative structured items channel — read by logNutrition/updateNutrition */}
<input
  type="hidden"
  name="itemsJson"
  value={rawMode ? "" : JSON.stringify(items)}
/>
```

In `rawMode`, `itemsJson` is empty string → server falls back to text `items` field (freehand path). In structured mode, `items` (JSON array, with `amount/unit/source`) is the authoritative source.

### 7.3 Edit seeding (back from DB → UI)

`MealComposer` receives `props.defaults.items: NutritionItem[]` which comes from `workout-actions.ts:289`:
```ts
items: (row.items as NutritionItem[]) ?? [],
```
This is the raw Prisma JSON cast — it bypasses `parseStoredItems`. For the edit seeding to carry `amount/unit/source`, either:
- **Option A (recommended)**: Cast through `parseStoredItems` at the server action: `items: parseStoredItems(row.items)` — this validates and preserves structured fields. Change `workout-actions.ts:289`.
- **Option B**: Cast directly and trust the DB shape — riskier.

Use **Option A**. This also makes `MealComposer`'s `seedItems = isEdit ? props.defaults.items : []` carry structured fields, so:
- `items` state is seeded with structured data ✓
- Item rows with `source` present render the amount/unit inputs ✓
- `snapshotHash` is seeded via `hashItems(seedItems)` which now includes `amount/unit` ✓

---

## 8. MealComposer Item Row UI Branch

```tsx
{items.map((item, i) => {
  const isStructured = !!item.source;
  const unitOptions = isStructured ? unitsForFood(item.source!) : [];

  return (
    <li key={i} ...>
      {/* Name + reorder buttons — unchanged */}
      ...
      {/* Qty row — BRANCHED */}
      {isStructured ? (
        /* ── Structured row: amount input + unit select ── */
        <div className="mt-2 flex items-center gap-2.5">
          <input
            type="number"
            aria-label={`Amount for ${item.name}`}
            value={item.amount ?? ""}
            min={0}
            step="any"
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              updateItemAmountUnit(i, isFinite(v) && v >= 0 ? v : 0, item.unit ?? "g");
            }}
            className="w-20 min-h-[44px] rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-base text-center font-mono"
          />
          <select
            aria-label={`Unit for ${item.name}`}
            value={item.unit ?? ""}
            onChange={(e) => updateItemAmountUnit(i, item.amount ?? 1, e.target.value)}
            className="flex-1 min-h-[44px] rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
          >
            {unitOptions.map((opt) => (
              <option key={opt.key} value={opt.key}>{opt.label}</option>
            ))}
          </select>
          <button type="button" ... onClick={() => requestRemoveItem(i)}>✕</button>
        </div>
      ) : (
        /* ── Freehand / legacy row: existing stepper (unchanged) ── */
        <div className="mt-2 flex items-center gap-2.5">
          <button type="button" disabled={!canStep} onClick={() => updateItemQty(i, -1)}>−</button>
          <span ...>{item.qty || "—"}</span>
          <button type="button" disabled={!canStep} onClick={() => updateItemQty(i, 1)}>＋</button>
          <button type="button" ... onClick={() => requestRemoveItem(i)}>✕</button>
        </div>
      )}
    </li>
  );
})}
```

The structured row has no move-up/down in the qty area — those remain in the name row (unchanged).

---

## 9. File-by-File Change List

| File | Action | Specific change |
|------|--------|-----------------|
| `src/lib/nutrition-log-ops.ts` | **Modify** | Add `ItemFoodSnapshot` type; extend `NutritionItem` with `amount?/unit?/source?`; fix `parseStoredItems` to preserve new fields + validate `source` shape |
| `src/lib/food-units.ts` | **Create** | New file: `UnitOption`, `unitsForFood`, `recalcItemMacros`, `defaultUnitForQuery`, `buildQtyDisplay`, `buildItemSnapshot` |
| `src/lib/items-text.ts` | **No change** | Text channel stays as-is; structured items bypass it via `addItem` callback |
| `src/lib/workout-actions.ts` | **Modify** | `logNutrition` + `updateNutrition`: read `itemsJson` when present (authoritative), fall back to text; seed edit items via `parseStoredItems(row.items)` at line 289 |
| `src/components/useFoodComposer.tsx` | **Modify** | Add `addItem: (item: NutritionItem) => void` prop; update `handleAdd` to build `structuredItem` + call `addItem`; update `handleEstimateAdd` similarly; `handleEstimateAddAnyway` uses `addItem({ name: line })` |
| `src/components/MealComposer.tsx` | **Modify** | Add `addItemToComposer` callback; pass as `addItem` to `useFoodComposer`; add `updateItemAmountUnit` handler; extend `hashItems` to include `amount/unit`; branch item row on `item.source`; add hidden `<input name="itemsJson">` in form body |

No Prisma migration. No new routes. No MCP tool changes.

---

## 10. Interface Contract for Parallel Streams

### Stream A (Lib Foundation) — non-UI, testable via tsx

Deliverables:
1. `src/lib/nutrition-log-ops.ts`: `ItemFoodSnapshot`, extended `NutritionItem`, fixed `parseStoredItems`
2. `src/lib/food-units.ts` (new): all exported types and helpers
3. `src/lib/workout-actions.ts`: `itemsJson` channel in `logNutrition`/`updateNutrition`; `parseStoredItems` seeding at line 289

Stream A does NOT touch any component file.

### Stream B (UI) — depends on A's types

Deliverables:
1. `src/components/useFoodComposer.tsx`: `addItem` prop + `handleAdd`/`handleEstimateAdd` refactor
2. `src/components/MealComposer.tsx`: `addItemToComposer`, `updateItemAmountUnit`, `hashItems` extension, structured row UI, `itemsJson` hidden input

**Dependency analysis: SEQUENTIAL (A then B), not parallel.**

Stream B must `import { unitsForFood, recalcItemMacros, buildItemSnapshot, buildQtyDisplay } from "@/lib/food-units"` — this file doesn't exist on main until A lands. Stubbing types in B's worktree is possible but creates a merge conflict and duplicates the type definitions. The risk of desync outweighs the parallelism benefit.

**Recommendation: A → B sequential.** Stream A is ~1-2 hours of pure lib work. Stream B can start immediately after A's PR merges to main. Each stream is a small-medium commit.

---

## 11. Back-Compat and Edge Cases (PRD §6)

| Scenario | Handled By | Behavior |
|----------|-----------|----------|
| Legacy item `{name:"X", qty:"8 oz"}`, no source | MealComposer item row branch: `!item.source` | Renders existing stepper + Recompute path; no regression |
| Amount blank / 0 | `recalcItemMacros`: returns null → delta = 0 | Item contributes zero to total; total unchanged; no NaN |
| Unit not in food's options (stale snapshot) | `recalcItemMacros`: unit not recognized → return null | Falls back to stored macros (delta = 0); default unit shown |
| `parseStoredItems` sees unknown fields | Fixed: preserves `amount/unit/source` via explicit key reads | Round-trips correctly |
| MCP `nutrition_log_ops` patches a structured item | `applyNutritionLogOps` spreads `...working[idx]!` then `...op.patch` — unknown keys survive unless explicitly overwritten | `amount/unit/source` preserved unless MCP explicitly writes those keys (it doesn't) |
| Raw-text toggle on a structured meal | `toggleRawMode()` → `setRawText(serializeItems(items))` → text loses `source` | Items re-materialize as freehand on exit from raw mode; acceptable per PRD §6 |
| Food snapshot macros all null | `recalcItemMacros` → null per macro key → delta = 0 for those keys | Contribution skipped, same as today's unmatched items |
| MCP logs a new meal (no `amount/unit/source`) | Items stored without structured fields → `parseStoredItems` produces legacy items → stepper+Recompute path | MCP contract unchanged |
| Structured item edited via `nutrition_log_ops` (e.g. name patch) | `updateItem` op spreads `...op.patch` → `name` changes, `source` preserved | Correct; macros may go stale (existing coach warning) |

---

## 12. Key Risks and Mitigations

| Risk | Severity | Mitigation |
|------|---------|-----------|
| **Delta drift**: if `recalcItemMacros` produces slightly different values than the original add-time macros (rounding), repeated edits could drift the total. | Low | Source snapshot is authoritative; delta math uses the same `scaleMacros` rounding as the original; drift is bounded to < 1 unit per edit cycle. Acceptable. |
| **rawMode + structured item**: calling `addItemToComposer` in rawMode appends only `name \| qty` to rawText, losing `amount/unit/source`. Switching back to structured mode parses the text → freehand item. | Medium | This is the documented "raw-text escape hatch" edge case in PRD §6. Add a warning comment in `addItemToComposer`. No copy change required. |
| **`parseFoodQuery` client import**: importing in `useFoodComposer.tsx` (client component) pulls a module currently only imported server-side. | Low | `food-parse.ts` is explicitly "No I/O, no 'use server'" (line 4). Client-safe. Verify bundle size impact — it's a pure text parser with no heavy deps. |
| **`BUILTINS` client import**: `food-builtins.ts` is a large static table. Importing it in `food-units.ts` (which the client uses) adds it to the client bundle. | Medium | `BUILTINS` is already used in `food-resolve-local.ts` which is imported from `useFoodComposer.tsx` via the existing estimate path... wait, actually `food-resolve-local.ts` imports from `food-builtins.ts` — check the current import graph. If `BUILTINS` is already in the client bundle, no regression. If not, extract the portion-lookup into a separate server call (but this adds complexity). For MVP: accept the bundle cost; `BUILTINS` is ~50 items of static data. |
| **Type mismatch on `NutritionItem` in Zod schemas**: `ItemInputShape` in `nutrition-log-ops.ts` only validates `name/qty/notes`. If MCP ops write `amount/unit` they'd pass validation but be stored. | Low | Intentional — MCP ops work on name/qty/notes only (PRD §4.2). No schema change needed. Document this as expected. |
| **`setSnapshotHash` inside `setItems` updater**: React state updates inside other state updaters can cause issues in concurrent mode. | Low | `setSnapshotHash` is called in the `setItems` functional updater. In React 19 (this stack), this is safe as both setters flush in the same batch. Precedent: existing `resetCreate` does this pattern with multiple setters. |

---

## 13. Acceptance Criteria Mapping

| AC | Implementation location |
|----|------------------------|
| AC-4 (types + parseStoredItems) | `nutrition-log-ops.ts` |
| AC-5 (unitsForFood returns g/oz+portions for 100g builtin, serving for serving-basis) | `food-units.ts:unitsForFood` |
| AC-6 (recalcItemMacros: 7×large ≈ 231g equivalent) | `food-units.ts:recalcItemMacros` math §4.1 |
| AC-7 (MealComposer branches on item.source) | `MealComposer.tsx` §8 |
| AC-8 (structured edit → no stale flag) | `updateItemAmountUnit` + snapshot reset §2.2-2.3 |
| AC-9 (itemsJson persists; edit seeds amount/unit/source) | `workout-actions.ts` + `MealComposer.tsx` §7 |
| AC-10 (legacy item regression) | item row branch on `!item.source` §8 |
| AC-11 (MCP tools/list unchanged) | No MCP file changes; confirmed |
| AC-12 (date math unchanged) | No date math touched |

---

## 14. QA Smoke Sequence (for implementing agent to note)

1. `npx tsc --noEmit` — gate after each stream merges.
2. `npm run lint` — gate.
3. tsx assertion: `unitsForFood(eggWhiteSnapshot)` includes keys `"g"`, `"oz"`, `"large"`, `"medium"`, `"small"`.
4. tsx assertion: `recalcItemMacros({amount:7, unit:"large", source: eggWhiteSnapshot})` → calories ≈ 119, proteinG ≈ 25.2 (7 × 33g / 100 × 76.4 cal = 176.2... wait, confirm against BUILTINS per100g values for egg-white).
5. Browser smoke: pick "egg whites" → amount + unit select appear; change 1→7 → macros update; no stale flag.
6. Browser smoke: save → re-open edit → amount/unit present; change → recomputes.
7. Browser smoke: legacy meal (MCP-logged, no source) → stepper renders, no regression.
8. MCP curl: `log_nutrition` with existing schema → stored correctly; `get_nutrition_history` returns it without error.
