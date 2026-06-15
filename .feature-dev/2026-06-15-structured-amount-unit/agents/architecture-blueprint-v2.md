# Architecture Blueprint v2 — Structured Amount + Unit Composer (live macro recalc)

**Date:** 2026-06-15
**Author:** Architect Agent (revision pass)
**Based on:** architecture-blueprint.md + architecture-critique.md
**Status:** Final — supersedes v1. Developers read ONLY this file.

---

## 0. What Changed from v1

| Blocker | v1 approach | v2 approach |
|---------|------------|------------|
| B-1 (precision) | Delta step 5 blanket `Math.round` — destroys 1dp macros | Full re-sum via `sumStructuredMacros` + `recomposeMacros` with per-key rounding |
| B-2 (Strict-Mode) | `setSnapshotHash` called inside `setItems` functional updater | Sequential pattern: compute `next` outside all setters |
| B-3 (estimate-add bypass) | `handleEstimateAddAnyway` "keep as-is OR use addItem" | Hard rule: `addItem` on every add path; `setItemsText` prohibited from food-resolved paths |
| B-4 (MCP firehose) | No stripping specified | `stripItemSource` helper; applied at `get_nutrition_history`, `recent_history`, `get_week` (3 tools — `get_day` calls `resolveDay` which is workout-plan-only, no nutrition items) |
| Macro model | Delta approach | Full re-sum with implicit residual; no explicit `manualBaseline` state |
| Missing file | — | `edit/page.tsx` local `asItems` strips structured fields — must be replaced with `parseStoredItems` |

Should-fixes from critique that are incorporated: S-1 (structured remove stays Fresh via re-sum), S-3 (fallback `<option>` for unrecognized unit), S-5 (`deleteNutrition` raw cast replaced), S-6 (extract `addFoodMacros`).
Nits N-1 through N-4: documented as code comments; no code change required in this PR.

---

## 1. Type Contract (Stream A must publish first)

### 1.1 Extended `NutritionItem` and new `ItemFoodSnapshot`
**File: `src/lib/nutrition-log-ops.ts`**

```ts
import type { FoodMacros } from "@/lib/food-types";

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
```

`NutritionLogOpSchema` / `ItemInputShape` (Zod): DO NOT CHANGE. MCP ops work on name/qty/notes only. `amount/unit/source` survive ops via the `...working[idx]! ...op.patch` spread (unknown keys untouched unless patch explicitly names them).

### 1.2 `UnitOption` and pure helpers
**File: `src/lib/food-units.ts` (NEW — client-safe, no "use server")**

```ts
import type { FoodMacros, MacroKey } from "@/lib/food-types";
import type { NutritionItem, ItemFoodSnapshot } from "@/lib/nutrition-log-ops";
import { scaleMacros } from "@/lib/food-resolve-local";
import { BUILTINS } from "@/lib/food-builtins";
import type { LibraryFood } from "@/lib/food-types";
import { MACRO_KEYS } from "@/lib/food-types";
import type { ParsedFoodQuery } from "@/lib/food-parse";

// MacroValues mirrors the component type; defined locally to avoid circular import.
type MacroValues = Partial<Record<MacroKey, number | null>>;

/** A selectable unit for a food-resolved item. */
export type UnitOption = {
  key: string;         // "g" | "oz" | "serving" | <portion key>
  label: string;       // "gram" | "oz" | "serving" | "large egg white (33 g)"
  gramsEach?: number;  // grams per piece unit; undefined for g/oz/serving
};

/**
 * Build unit options from a food snapshot.
 *
 * 100g basis: always includes "g" and "oz"; plus one option per portions[] entry (piece units).
 * serving basis: only "serving". g/oz NOT offered (no density table, servingSize is free text).
 */
export function unitsForFood(snapshot: ItemFoodSnapshot): UnitOption[];

/**
 * Recalculate macros for a single structured item.
 *
 * Returns null when:
 *   - item.source is undefined (freehand/legacy item)
 *   - item.amount is not a positive finite number (treat as no contribution)
 *   - item.unit is not recognized in the food's valid unit set
 *
 * Never throws. Return null = item contributes zero to sumStructuredMacros.
 *
 * Rounding: delegates entirely to scaleMacros (calories/sodiumMg → int; others → 1dp).
 */
export function recalcItemMacros(item: NutritionItem): FoodMacros | null;

/**
 * Sum recalcItemMacros over every item WITH source.
 * Items without source contribute zero (freehand/legacy items — not an error).
 *
 * Returns FoodMacros with all keys initialized to 0 (never null from this function).
 * This is the structured total; residual = macros - sumStructuredMacros for the
 * manual/freehand contribution.
 */
export function sumStructuredMacros(items: NutritionItem[]): FoodMacros;

/**
 * Recompose the meal total from a new structured sum + residual (implicit manualBaseline).
 * Per-key rounding matches scaleMacros house rules:
 *   calories, sodiumMg → Math.round (integer)
 *   proteinG, carbsG, fatG, fiberG → Math.round(v * 10) / 10 (1 decimal place)
 *
 * Both structuredSum and residual may have null/undefined per key → treated as 0.
 */
export function recomposeMacros(
  structuredSum: FoodMacros,
  residual: MacroValues,
): MacroValues;

/**
 * Choose the default unit for a newly-added food.
 *
 * Logic (in order):
 *   1. If parsed.sizeWord matches a portion key exactly → that portion key.
 *   2. If snapshot has portions and parsed.count > 1 → first portion key.
 *   3. If snapshot has portions → snapshot's default portion (via BUILTINS slug lookup).
 *   4. For 100g basis → "g". For serving basis → "serving".
 *
 * parsed may be null (chip/scan paths without a text query).
 */
export function defaultUnitForQuery(
  parsed: Pick<ParsedFoodQuery, "count" | "sizeWord"> | null,
  snapshot: ItemFoodSnapshot,
): string;

/** Build the display qty string: "7 × large egg white (33 g)", "200 g", "1.5 oz". */
export function buildQtyDisplay(
  amount: number,
  unit: string,
  snapshot: ItemFoodSnapshot,
): string;

/**
 * Build an ItemFoodSnapshot from a LibraryFood at add time.
 *
 * portions[]: if food.barcode starts with "builtin:", look up BUILTINS for the slug's
 *             portions[]. Otherwise [].
 * perBasis: food.perServing directly (already the correct per-basis value regardless of
 *           basis type — LibraryFood.perServing is per 100g for basis="100g" and per
 *           1 serving for basis="serving").
 */
export function buildItemSnapshot(food: LibraryFood): ItemFoodSnapshot;

/**
 * Extract a pure macro-only helper from mergeFoodIntoForm (S-6 fix).
 * Returns the new MacroValues total after adding food at servings.
 * Caller: useFoodComposer.handleAdd / handleEstimateAdd (for the macro-update leg).
 * Does NOT construct the text line.
 */
export function addFoodMacros(
  current: MacroValues,
  food: LibraryFood,
  servings: number,
): MacroValues;
```

**Notes on `BUILTINS` in client bundle:** `food-builtins.ts` has no `"use server"` and is already
imported in `food-resolve-local.ts` which the client bundle uses. Adding `buildItemSnapshot` to
`food-units.ts` does not add new bundle weight beyond what is already there. Confirm via `next build`
bundle analysis (nit S-4 baseline established).

---

## 2. The Macro-Summation Model (crux)

### 2.1 Core invariant

```
macros = sumStructuredMacros(items) + residual
```

where:
- `sumStructuredMacros(items)` = Σ `recalcItemMacros(item)` over items with `item.source != null`
- `residual` = macro contributions from freehand items + any manual adjustment (hand-typed in MacroInputs)

**`residual` is NOT stored as explicit state.** It is computed on demand as
`residual = macros − sumStructuredMacros(items)` at the moment any structured edit fires.
This is mathematically identical to explicit `manualBaseline` state but requires zero
synchronization — the invariant holds naturally because:
- Structured add: macros increases by structuredItem macros; sumStructured increases by the same → residual unchanged ✓
- Freehand add (via `addFoodMacros`): macros increases by freehand macros; sumStructured unchanged → residual absorbs the increase ✓
- `updateItemAmountUnit`: residual captured before the change, recompose after → exact ✓
- `handleMacroChange` (user sets TOTAL): macros updated; sumStructured unchanged; implicit residual = new macros − sumStructured ✓
- `applyRecompute`: macros = wholeMealEstimate; residual = estimate − sumStructured (freehand portion of the estimate) ✓

### 2.2 Why NOT explicit `manualBaseline` state

Explicit state would require: every path that changes `macros` OR `items` to also update `manualBaseline`. That is 6+ code paths spanning two files. The implicit approach requires only that `updateItemAmountUnit` and structured `requestRemoveItem` compute the residual locally — 2 sites. Explicit state is cleaner in theory but adds synchronization risk for zero correctness benefit.

**Recommendation: `macros` remains maintained state (not `useMemo`-derived).** Moving to derived state would require replacing all `setMacros` calls with `setManualBaseline` across `useFoodComposer` + `MealComposer` (15+ sites, interface change) with no correctness benefit in this PR. Reserve as post-ship cleanup.

### 2.3 The five transitions

**T1 — Structured item ADD (chip/scan/estimate resolve path)**

```ts
// In useFoodComposer.handleAdd and handleEstimateAdd:
const newMacros = addFoodMacros(macros, food, servings);   // pure helper from food-units.ts
setMacros(newMacros);                                       // called on parent's setMacros prop
addItem(structuredItem);                                    // calls addItemToComposer (below)
```

```ts
// In MealComposer.addItemToComposer:
function addItemToComposer(item: NutritionItem): void {
  if (rawMode) {
    // rawMode: text append only; snapshot NOT reset (rawMode always stale — intentional).
    // COMMENT: macros ARE updated (via setMacros above) but snapshotHash is not reset.
    // This is correct: rawMode declares "items and macros may diverge; Recompute to reconcile."
    const line = item.qty ? `${item.name} | ${item.qty}` : item.name;
    setRawText((prev) => prev + (prev.trim() ? "\n" : "") + line);
    return;
  }
  // B-2 FIX: compute next OUTSIDE the setter; call setters sequentially.
  const next = [...items, item];
  setItems(next);
  setSnapshotHash(hashItems(next));
  // macros already updated by setMacros call in useFoodComposer — no double-set.
}
```

After T1: `sumStructured(next) = sumStructured(items) + recalcItemMacros(item)`.
`residual = newMacros - sumStructured(next) = (macros + itemMacros) - (sumStruct + itemMacros) = oldResidual`. Invariant preserved. stale=false. ✓

**T2 — Structured amount/unit CHANGE**

```ts
// In MealComposer.updateItemAmountUnit:
function updateItemAmountUnit(idx: number, amount: number, unit: string): void {
  // 1. Snapshot residual BEFORE changing items (captures freehand + manual contribution).
  const oldSumStruct = sumStructuredMacros(items);
  const residual: MacroValues = {};
  for (const k of MACRO_KEYS) {
    residual[k] = (macros[k] ?? 0) - (oldSumStruct[k] ?? 0);
  }

  // 2. Build updated items.
  const next = items.map((it, j) =>
    j === idx
      ? { ...it, amount, unit, qty: buildQtyDisplay(amount, unit, it.source!) }
      : it,
  );

  // 3. Re-sum structured macros with the new amount/unit.
  const newSumStruct = sumStructuredMacros(next);

  // 4. Recompose total with per-key house rounding (NOT blanket Math.round — B-1 FIX).
  const newMacros = recomposeMacros(newSumStruct, residual);

  // 5. B-2 FIX: sequential setters — no setter inside another setter.
  setItems(next);
  setMacros(newMacros);
  setSnapshotHash(hashItems(next));
  // stale = hashItems(next) === snapshotHash(next) = true immediately ✓
}
```

**T3 — Structured item REMOVE** (S-1 fix)

```ts
// In MealComposer.requestRemoveItem (and removeItem for reduced-motion path):
function requestRemoveItem(index: number): void {
  const item = items[index];
  if (item?.source) {
    // STRUCTURED ITEM: re-sum without this item → stays Fresh (no stale flag).
    const oldSumStruct = sumStructuredMacros(items);
    const residual: MacroValues = {};
    for (const k of MACRO_KEYS) {
      residual[k] = (macros[k] ?? 0) - (oldSumStruct[k] ?? 0);
    }
    const next = items.filter((_, i) => i !== index);
    const newSumStruct = sumStructuredMacros(next);
    const newMacros = recomposeMacros(newSumStruct, residual);
    // B-2 FIX: no motion animation for structured removes (they don't go stale —
    //          no transitionEnd needed). Apply immediately.
    setItems(next);
    setMacros(newMacros);
    setSnapshotHash(hashItems(next));
    return;
  }
  // FREEHAND / LEGACY ITEM: existing behavior — stale flag fires; user hits Recompute.
  if (prefersReducedMotion()) { removeItem(index); return; }
  setRemovingIndex(index);
}
```

NOTE: the existing `removeItem(index)` helper (called from transitionEnd for freehand) only calls
`setItems`. The hash is NOT reset → stale fires. This is correct and unchanged.

**T4 — Manual MacroInputs edit**

```ts
// In MealComposer.handleMacroChange (UNCHANGED logic):
function handleMacroChange(key: keyof MacroValues, val: number | null) {
  setMacros((prev) => ({ ...prev, [key]: val }));
  setSnapshotHash(hashItems(effectiveItems));  // Fresh
}
```

The new implicit `residual[key] = val - sumStructuredMacros(items)[key]` holds automatically — no code change. The residual for other keys is unaffected. ✓

**T5 — "Recompute from items" Apply** (extended for S-6 and snapshot-aware re-sum)

Extend `estimateMealMacros` in `food-actions.ts` to prefer `recalcItemMacros` for structured items:

```ts
// In food-actions.ts, estimateMealMacros:
// For each item: if item.source exists → compute via recalcItemMacros, mark matched.
//               else → existing name-match path.
// This prevents the estimate for "7 large egg whites" from diverging from the
// stored snapshot after user hits Recompute.
```

After Apply in `applyRecompute` (MealComposer.tsx):

```ts
function applyRecompute() {
  if (!preview) return;
  const changed = new Set<string>();
  for (const k of FLASHABLE_MACROS) {
    if ((macros[k] ?? null) !== (preview.totals[k] ?? null)) changed.add(k);
  }
  // B-2 FIX: sequential — setMacros then setSnapshotHash.
  setMacros({ ...preview.totals });
  setSnapshotHash(hashItems(effectiveItems));
  setPreview(null);
  setFlashMacros(changed.size > 0 ? { keys: changed, n: Date.now() } : null);
}
// After Apply: residual = preview.totals - sumStructured(items) = freehand estimate total. ✓
```

### 2.4 Concrete walkthrough — mixed meal

**Setup:** egg-white snapshot (basis:"100g", perBasis={calories:52,proteinG:10.9,...}, portions=[large(33g), medium(28g), small(24g)]). Curry is freehand, no food match.

**After each step: show `sumStructured`, residual (= macros − sumStructured), `macros`. Prove no drift.**

---

**Step 1: Add 1 large egg white (T1, structured)**
- `setMacros`: `scaleMacros(snapshot.perBasis, 33/100 = 0.33)` = {cal:Math.round(52×0.33)=17, protG:Math.round(10.9×0.33×10)/10=3.6}
- `addItemToComposer({name:"Egg Whites", amount:1, unit:"large", source:snapshot})`
- next = [A{amount:1,unit:"large",source:...}]; setItems(next); setSnapshotHash(hashItems(next))

| | sumStructured | residual | macros |
|--|--|--|--|
| After step 1 | cal:17, protG:3.6 | cal:0, protG:0 | cal:17, protG:3.6 |

Invariant: 17 = 17 + 0 ✓. stale=false ✓.

---

**Step 2: Add "leftover curry" (freehand, B-3 fixed: addItem, no setItemsText)**
- `handleEstimateAddAnyway` → `addItem({name:"leftover curry"})` → `addItemToComposer({name:"leftover curry"})` (no source)
- No `setMacros` call (not_found → no macro data)
- next = [A, B]; setItems(next); setSnapshotHash(hashItems(next))

| | sumStructured | residual | macros |
|--|--|--|--|
| After step 2 | cal:17, protG:3.6 | cal:0, protG:0 | cal:17, protG:3.6 |

stale=false ✓. User now hand-enters total macros including curry.

---

**Step 2b: User hand-edits total to cal:367, protG:15.6 (T4)**
- `handleMacroChange("calories", 367)` then `handleMacroChange("proteinG", 15.6)`
- Each call: `setMacros({...prev, key:val})` + `setSnapshotHash(hashItems(effectiveItems))` → Fresh

| | sumStructured | residual | macros |
|--|--|--|--|
| After step 2b | cal:17, protG:3.6 | cal:350, protG:12.0 | cal:367, protG:15.6 |

Invariant: 367 = 17 + 350 ✓, 15.6 = 3.6 + 12.0 ✓. stale=false ✓.
Residual (350 cal, 12g protein) represents curry's contribution to the running total.

---

**Step 3: Change egg-white amount to 7 (T2)**
- `updateItemAmountUnit(0, 7, "large")`
- oldSumStruct: {cal:17, protG:3.6}
- residual: {cal:367-17=350, protG:15.6-3.6=12.0}
- newA = {amount:7, unit:"large", ...}; `recalcItemMacros(newA)`:
  - 7 × 33g = 231g; servings = 231/100 = 2.31
  - cal = Math.round(52 × 2.31) = **120**; protG = Math.round(10.9 × 2.31 × 10)/10 = **25.2**
- newSumStruct: {cal:120, protG:25.2}
- `recomposeMacros({cal:120,protG:25.2}, {cal:350,protG:12.0})`:
  - cal: Math.round(120+350) = **470** (integer rounding)
  - protG: Math.round((25.2+12.0)×10)/10 = Math.round(37.2×10)/10 = **37.2** (1dp rounding, no drift!)

| | sumStructured | residual | macros |
|--|--|--|--|
| After step 3 | cal:120, protG:25.2 | cal:350, protG:12.0 | cal:470, protG:37.2 |

Invariant: 470 = 120 + 350 ✓, 37.2 = 25.2 + 12.0 ✓. stale=false ✓.
No rounding drift — full re-sum, not accumulated deltas. ✓

---

**Step 4: Remove curry (B, freehand, no source) (T3 freehand path)**
- `requestRemoveItem(1)`: B.source is undefined → FREEHAND PATH
- `setRemovingIndex(1)` → transitionEnd → `removeItem(1)`: `setItems([A])`
- snapshotHash NOT reset → stale=true ✓ (correct: macros still include curry's 350 cal)

| | sumStructured | residual | macros |
|--|--|--|--|
| After step 4 | cal:120, protG:25.2 | cal:350, protG:12.0 (stale) | cal:470, protG:37.2 |

stale=true ✓. Recompute flag shown. User hits Recompute → estimate for [A{amount:7,unit:"large",source:...}] → `recalcItemMacros(A)` = {cal:120, protG:25.2}. Preview shows {cal:120, protG:25.2}. Apply → macros={cal:120,protG:25.2}, snapshotHash reset. residual → {cal:0,protG:0}. ✓

No double-count, no drift, curry's contribution is correctly wiped after Apply. ✓

---

**B-1 correctness proof (the 28 vs 29 protein example from critique):**

The critique showed that delta + Math.round(28.8) = 29 (wrong). With full re-sum + 1dp rounding:
- 8 large egg whites: `scaleMacros(perBasis, 264/100 = 2.64)` → protG = Math.round(10.9 × 2.64 × 10)/10 = Math.round(28.776) / ... wait, Math.round(28.776×10) = Math.round(287.76) = 288; 288/10 = **28.8**. ✓
- This is the `recalcItemMacros` value; it goes directly into `newSumStruct`. `recomposeMacros` applies the same 1dp rule. Result = 28.8. No drift. ✓

---

## 3. The `setItemsText` → `addItem` Bridge

### 3.1 Hard rule (B-3)

**`setItemsText` MUST NOT be called from any food-resolved or "add anyway" add path.** Every add path goes through `addItem`. Violation: calling `setItemsText` runs `parseItemsText` which strips ALL structured fields from ALL existing items in the meal, not just the new one.

Add a code comment at the top of `useFoodComposer.tsx`:
```ts
// INVARIANT: setItemsText is ONLY used from rawMode paths (toggleRawMode, legacy).
// All food-resolved adds (handleAdd, handleEstimateAdd, handleEstimateAddAnyway) MUST
// call addItem(). Never call setItemsText from these paths — it strips amount/unit/source
// from ALL existing items, not just the new one.
```

### 3.2 `addItem` prop on `useFoodComposer`

```ts
// In useFoodComposer props:
addItem: (item: NutritionItem) => void;
```

### 3.3 Updated `handleAdd` in `useFoodComposer`

```ts
function handleAdd(payload: AddFoodPayload) {
  const { food, servings, chipSource } = payload;
  const snapshot = buildItemSnapshot(food);
  const parsedQuery = null; // chip/scan path: no text query
  const unit = defaultUnitForQuery(parsedQuery, snapshot);
  const amount = deriveAmountFromServings(servings, unit, snapshot);
  const qty = buildQtyDisplay(amount, unit, snapshot);
  const structuredItem: NutritionItem = { name: food.name, qty, amount, unit, source: snapshot };

  // Macro update via addFoodMacros (S-6 fix: extract pure helper, discard merged.itemsText).
  const newMacros = addFoodMacros(macros, food, servings);
  onMacrosChanged?.(macros, newMacros);
  setMacros(newMacros);

  // B-3: use addItem, NOT setItemsText.
  addItem(structuredItem);

  if (chipSource) recordFoodUse(food.id).catch(() => {});
  else setLocalAdditions(/* ... */);
}
```

### 3.4 Updated `handleEstimateAdd`

```ts
function handleEstimateAdd() {
  const est = estimateResult!; // status:"ok"
  const snapshot = buildItemSnapshot(est.food);
  const parsedQuery = parseFoodQuery(lastEstimateQueryRef.current ?? "");
  const unit = defaultUnitForQuery(parsedQuery, snapshot);
  const amount = deriveAmountFromEstimate(est, unit, snapshot, parsedQuery);
  const qty = buildQtyDisplay(amount, unit, snapshot);
  const structuredItem: NutritionItem = { name: est.food.name, qty, amount, unit, source: snapshot };

  const newMacros = addFoodMacros(macros, est.food, est.servings);
  onMacrosChanged?.(macros, newMacros);
  setMacros(newMacros);

  // B-3: addItem, NOT setItemsText.
  addItem(structuredItem);
  // ... clear estimate state, upsert chip
}
```

### 3.5 `handleEstimateAddAnyway` (B-3 pinned)

```ts
function handleEstimateAddAnyway() {
  const line = lastEstimateQueryRef.current || estimateInput.trim();
  if (!line) return;
  // B-3 FIX: addItem, NEVER setItemsText. Freehand item — no source, no macros.
  addItem({ name: line });
  setEstimateInput("");
  setEstimateResult(null);
  setCandidates(null);
}
```

`mergeFoodIntoForm` and `mergeEstimateIntoForm` are retained for the `rawMode` path only. `addFoodMacros` extracts the macro-computation half so neither mergeXxx function is called on the hot path.

---

## 4. Unit→Macros Conversion Math

### 4.1 `100g` basis

| unit key | grams | `scaleMacros` servings |
|----------|-------|----------------------|
| `"g"` | amount | amount / 100 |
| `"oz"` | amount × 28.3495 | grams / 100 |
| `<portion key>` | amount × portion.grams | grams / 100 |

### 4.2 `serving` basis

| unit key | servings |
|----------|----------|
| `"serving"` | amount |

g/oz NOT offered for serving-basis foods (no density table — PRD §3.3).

### 4.3 Edge cases in `recalcItemMacros`

- `item.source` is undefined → return null.
- `item.amount` ≤ 0 or not finite → return null (contributes zero to sum).
- `item.unit` not in the food's valid unit options → return null (stale-data safety; display handled by S-3 fallback option below).

### 4.4 `deriveAmountFromServings` (chip/scan path)

- Unit `"g"`: `amount = servings × 100`
- Unit piece key: `amount = Math.max(1, Math.round((servings × 100) / portion.grams))`
- Unit `"serving"`: `amount = servings`
- Unit `"oz"`: `amount = Math.round((servings × 100 / 28.3495) × 10) / 10`

### 4.5 `deriveAmountFromEstimate` (estimate path)

- Unit piece key: `amount = parsedQuery.count ?? 1` (query count = piece count)
- Unit `"g"`: `amount = parsedQuery.grams ?? Math.round(est.servings × 100)`
- Unit `"serving"`: `amount = est.servings`

---

## 5. `ItemFoodSnapshot` Construction

**`buildItemSnapshot(food: LibraryFood): ItemFoodSnapshot`** — in `food-units.ts`

```ts
export function buildItemSnapshot(food: LibraryFood): ItemFoodSnapshot {
  let portions: ItemFoodSnapshot["portions"] = [];
  if (food.barcode?.startsWith("builtin:")) {
    const slug = food.barcode.slice(8);
    const builtin = BUILTINS.find((b) => b.slug === slug);
    portions = builtin?.portions ?? [];
  }
  return {
    basis: food.basis,
    perBasis: food.perServing,  // per 100g for basis="100g", per serving for basis="serving"
    portions,
    foodId: food.id,
    brand: food.brand,
  };
}
```

USDA foods have `barcode = "usda:<fdcId>"` — NOT builtins → `portions = []`. Users get g/oz.

---

## 6. `parseStoredItems` Fix

**File: `src/lib/nutrition-log-ops.ts`** (lines 61-75, current)

```ts
export function parseStoredItems(raw: unknown): NutritionItem[] {
  if (!Array.isArray(raw)) return [];
  const out: NutritionItem[] = [];
  for (const v of raw) {
    if (v == null || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    if (typeof r.name !== "string" || !r.name) continue;
    out.push({
      name:   r.name,
      qty:    typeof r.qty    === "string"             ? r.qty    : undefined,
      notes:  typeof r.notes  === "string"             ? r.notes  : undefined,
      amount: typeof r.amount === "number" && isFinite(r.amount as number)
                                                        ? r.amount as number
                                                        : undefined,
      unit:   typeof r.unit   === "string"             ? r.unit   : undefined,
      source: isValidItemFoodSnapshot(r.source)        ? (r.source as ItemFoodSnapshot)
                                                        : undefined,
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

**`NutritionLogOpSchema` / `ItemInputShape` Zod schemas: DO NOT CHANGE.** MCP ops write name/qty/notes only; `amount/unit/source` survive via the `{ ...working[idx]!, ...op.patch }` spread.

---

## 7. B-4 — Strip `source` from MCP Read Tools

### 7.1 `stripItemSource` helper

Add to `src/lib/nutrition-log-ops.ts`:

```ts
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
```

### 7.2 Application sites — exactly 3 tools

**`get_nutrition_history`** (line 1593 in tools.ts — `items: r.items`):
```ts
// BEFORE:
items: r.items,
// AFTER:
items: stripItemSource(r.items),
```

**`recent_history`** (line 761 — returns raw `nutrition` Prisma array):
```ts
// BEFORE:
return { since, days, workouts, measurements, notes, baselines, hikes, nutrition };
// AFTER — map over nutrition rows to strip source from each meal's items:
const nutritionStripped = nutrition.map((n) => ({ ...n, items: stripItemSource(n.items) }));
return { since, days, workouts, measurements, notes, baselines, hikes, nutrition: nutritionStripped };
```

**`get_week`** (line 1112 — returns raw `nutrition` Prisma array):
```ts
// BEFORE:
return { monday, sunday, weekOffset, workouts, measurements, notes, baselines, hikes, nutrition };
// AFTER:
const nutritionStripped = nutrition.map((n) => ({ ...n, items: stripItemSource(n.items) }));
return { monday, sunday, weekOffset, workouts, measurements, notes, baselines, hikes, nutrition: nutritionStripped };
```

**`get_day`**: calls `resolveDay()` which returns a workout-plan resolution (todayTask, activeWorkout, etc.) — no `NutritionLog.items` in the output. No change needed.

**Write tools and `nutrition_log_ops`**: keep `parseStoredItems` (which preserves source) — needed for the app's offline recalc and MCP patch round-trips.

---

## 8. Persistence Channel (`itemsJson`)

### 8.1 `logNutrition` / `updateNutrition` in `workout-actions.ts`

```ts
const itemsJsonRaw = form.get("itemsJson") as string | null;
let items: NutritionItem[];
if (itemsJsonRaw) {
  try {
    items = parseStoredItems(JSON.parse(itemsJsonRaw));
  } catch {
    items = parseItemsText(String(form.get("items") ?? ""));
  }
} else {
  items = parseItemsText(String(form.get("items") ?? ""));
}
if (items.length === 0) throw new Error("List at least one food item");
```

### 8.2 Hidden `itemsJson` field in `MealComposer.tsx`

```tsx
{/* Authoritative structured items — read by logNutrition / updateNutrition */}
<input
  type="hidden"
  name="itemsJson"
  value={rawMode ? "" : JSON.stringify(items)}
/>
```

In rawMode → `itemsJson = ""` → server falls back to text `items` field (freehand path). ✓

### 8.3 Edit seeding — ALL raw-cast sites replaced

Replace every `row.items as NutritionItem[]` or local `asItems(row.items)` with `parseStoredItems(row.items)`:

| File | Current | Fix |
|------|---------|-----|
| `src/lib/workout-actions.ts:289` (`deleteNutrition`) | `(row.items as NutritionItem[]) ?? []` | `parseStoredItems(row.items)` |
| `src/app/nutrition/[id]/edit/page.tsx:55` | `asItems(row.items)` (local fn, strips structured fields) | `parseStoredItems(row.items)` — import from `@/lib/nutrition-log-ops` |

`src/app/nutrition/page.tsx:asItems` is display-only (`summarize` reads only `name`/`qty` for the list view) — no edit seeding, no regression from extra keys. No change required, but note that the local `Item` type is a subtype of `NutritionItem`; once `NutritionItem` gains fields, the local cast in page.tsx still works because the extra keys are simply ignored in `summarize`.

---

## 9. `hashItems` Extension

```ts
// MealComposer.tsx — extend to include amount and unit.
function hashItems(items: NutritionItem[]): string {
  return JSON.stringify(
    items.map((i) => [i.name, i.qty ?? "", i.notes ?? "", i.amount ?? "", i.unit ?? ""])
  );
}
```

This extension is defense-in-depth: in the normal flow all structured edits reset the hash via the sequential setter calls. The extension ensures that if any future code path changes `amount`/`unit` without resetting the hash, the stale flag will correctly fire rather than silently showing fresh macros.

---

## 10. MealComposer Item Row UI Branch

```tsx
{items.map((item, i) => {
  const isStructured = !!item.source;
  const unitOptions = isStructured ? unitsForFood(item.source!) : [];
  const storedUnitInOptions = unitOptions.some((o) => o.key === item.unit);
  const canStep = !isStructured && hasNumericPrefix(item.qty);
  const bumping = bumpState?.idx === i;
  const exiting = removingIndex === i;

  return (
    <li key={i} data-testid="item-row"
        className={`item-row-anim${exiting ? " is-exiting" : ""}`}
        onTransitionEnd={/* ...existing splice handler... */}>
      <div className="item-row-inner border-b border-[var(--border)] px-1 py-2.5">
        {/* Name + move buttons — UNCHANGED */}
        <div className="flex items-center gap-2">
          <span className={`flex-1 text-sm ...`}>{item.name || "Unnamed item"}</span>
          <div className="flex flex-col rounded-lg border border-[var(--border)] text-[var(--muted)]">
            <button type="button" data-testid="item-move-up"
                    aria-label={`Move ${item.name} up`}
                    disabled={i === 0 || removingIndex !== null}
                    onClick={() => moveItem(i, -1)} ...>↑</button>
            <button type="button" data-testid="item-move-down"
                    aria-label={`Move ${item.name} down`}
                    disabled={i === lastIndex || removingIndex !== null}
                    onClick={() => moveItem(i, 1)} ...>↓</button>
          </div>
        </div>

        {/* Qty row — BRANCHED on item.source */}
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
              {/* S-3 FIX: disabled fallback option when stored unit no longer in snapshot */}
              {!storedUnitInOptions && item.unit && (
                <option key="__stored" value={item.unit} disabled>
                  {item.unit} (not available)
                </option>
              )}
              {unitOptions.map((opt) => (
                <option key={opt.key} value={opt.key}>{opt.label}</option>
              ))}
            </select>
            <button type="button" data-testid="item-remove"
                    aria-label={`Remove ${item.name}`}
                    disabled={removingIndex !== null}
                    onClick={() => requestRemoveItem(i)}
                    className="ml-auto flex h-9 w-9 ...">✕</button>
          </div>
        ) : (
          /* ── Freehand / legacy row: existing stepper (UNCHANGED) ── */
          <div className="mt-2 flex items-center gap-2.5">
            <button type="button" data-testid="item-qty-dec"
                    aria-label={`Decrease ${item.name} quantity`}
                    disabled={!canStep}
                    onClick={() => updateItemQty(i, -1)} ...>−</button>
            <span key={bumping ? `bump-${bumpState!.n}` : "static"}
                  className={`min-w-[62px] text-center font-mono text-sm ...${bumping ? " qty-bump" : ""}`}>
              {item.qty || "—"}
            </span>
            <button type="button" data-testid="item-qty-inc"
                    aria-label={`Increase ${item.name} quantity`}
                    disabled={!canStep}
                    onClick={() => updateItemQty(i, 1)} ...>＋</button>
            <button type="button" data-testid="item-remove"
                    aria-label={`Remove ${item.name}`}
                    disabled={removingIndex !== null}
                    onClick={() => requestRemoveItem(i)}
                    className="ml-auto flex h-9 w-9 ...">✕</button>
          </div>
        )}
      </div>
    </li>
  );
})}
```

---

## 11. File-by-File Change List

| File | Action | Specific changes |
|------|--------|-----------------|
| `src/lib/nutrition-log-ops.ts` | **Modify** | Add `ItemFoodSnapshot` type; extend `NutritionItem` with `amount?/unit?/source?`; fix `parseStoredItems` to preserve all fields + `isValidItemFoodSnapshot` guard; add `stripItemSource` helper |
| `src/lib/food-units.ts` | **Create** | New client-safe module: `UnitOption`, `unitsForFood`, `recalcItemMacros`, `sumStructuredMacros`, `recomposeMacros`, `defaultUnitForQuery`, `buildQtyDisplay`, `buildItemSnapshot`, `addFoodMacros`, `deriveAmountFromServings`, `deriveAmountFromEstimate` |
| `src/lib/items-text.ts` | **No change** | Text channel stays as-is; structured items bypass it |
| `src/lib/food-actions.ts` | **Modify** | `estimateMealMacros`: prefer `recalcItemMacros` for items with `source` (T5 path); no other changes |
| `src/lib/workout-actions.ts` | **Modify** | `logNutrition` + `updateNutrition`: read `itemsJson` when present (authoritative), fall back to text `items`; `deleteNutrition` line 289: replace raw cast with `parseStoredItems(row.items)` |
| `src/components/useFoodComposer.tsx` | **Modify** | Add `addItem: (item: NutritionItem) => void` prop; update `handleAdd` → build `structuredItem` + call `addFoodMacros` + `addItem`; update `handleEstimateAdd` similarly; `handleEstimateAddAnyway` → `addItem({name: line})` (B-3); add `setItemsText` invariant comment |
| `src/components/MealComposer.tsx` | **Modify** | Add `addItemToComposer` callback (B-2 sequential pattern); add `updateItemAmountUnit` handler (T2, full re-sum); modify `requestRemoveItem` to branch on `item.source` (T3, S-1); extend `hashItems` to include `amount/unit`; branch item row on `item.source` (§10 above, S-3 fallback option); add hidden `<input name="itemsJson">`; extend `applyRecompute` to use sequential setters |
| `src/app/nutrition/[id]/edit/page.tsx` | **Modify** | Replace local `asItems(row.items)` with `parseStoredItems(row.items)` from `@/lib/nutrition-log-ops`; remove local `Item` type and `asItems` function |
| `src/lib/mcp/tools.ts` | **Modify** | `get_nutrition_history` line ~1593: `items: stripItemSource(r.items)`; `recent_history` line ~761: map nutrition array to strip source; `get_week` line ~1112: same |

No Prisma migration. No new routes.

---

## 12. Interface Contract for Parallel vs Sequential Streams

### Decision: SEQUENTIAL (A then B). Unchanged from v1.

Stream B must import `sumStructuredMacros`, `recomposeMacros`, `recalcItemMacros`,
`unitsForFood`, `buildItemSnapshot`, `buildQtyDisplay`, `addFoodMacros` from `food-units.ts`.
That file is created by Stream A and doesn't exist on `main` until A's PR merges.
Stubbing types in B's worktree is possible but creates merge conflicts and type-drift risk.

Stream A scope (lib work, no component files):
1. `src/lib/nutrition-log-ops.ts` — type + parser + strip helper
2. `src/lib/food-units.ts` — all pure helpers
3. `src/lib/food-actions.ts` — `estimateMealMacros` snapshot-aware extension
4. `src/lib/workout-actions.ts` — `itemsJson` channel; `parseStoredItems` seeding
5. `src/lib/mcp/tools.ts` — 3 `stripItemSource` applications

Stream B scope (UI, depends on A):
1. `src/components/useFoodComposer.tsx` — `addItem` prop + all handle* refactors
2. `src/components/MealComposer.tsx` — `addItemToComposer`, `updateItemAmountUnit`, `requestRemoveItem` branch, hashItems, row UI branch, `itemsJson` hidden input, `applyRecompute` sequential
3. `src/app/nutrition/[id]/edit/page.tsx` — replace `asItems` with `parseStoredItems`

---

## 13. Back-Compat and Edge Cases

| Scenario | Handled by | Behavior |
|----------|-----------|----------|
| Legacy item `{name:"X", qty:"8 oz"}`, no source | Row branch: `!item.source` | Existing stepper + stale→Recompute path; no regression |
| Amount blank / 0 | `recalcItemMacros` returns null → not counted in sumStructured | Item contributes zero to total; no NaN |
| Unit not in food's options (stale snapshot) | `recalcItemMacros` returns null; S-3 disabled `<option>` shown | macros unchanged for that item until user picks a valid unit; select shows stored unit disabled |
| `parseStoredItems` sees unknown fields | Fixed: explicit key reads preserve all known structured fields | Round-trips correctly |
| MCP `nutrition_log_ops` patches a structured item | `{ ...working[idx]!, ...op.patch }` — source preserved unless patch explicitly writes it (it doesn't) | `amount/unit/source` survive patches to name/qty/notes ✓ |
| Raw-text toggle on structured meal | `toggleRawMode()` serializes via `serializeItems` → text; re-materialize on toggle-off → freehand items | Structured fields lost on roundtrip; documented comment in `toggleRawMode` |
| Food snapshot macros all null | `recalcItemMacros` → null → not counted | Contribution skipped, same as today |
| MCP logs a new meal (no source) | Items stored without structured fields → `parseStoredItems` produces legacy items → stepper+Recompute path | MCP contract unchanged |
| Structured item removed (S-1) | `requestRemoveItem` branches on `item.source`; structured path re-sums → Fresh | No stale flag; macros correct |
| Edit-mode seeding via full-page route | `edit/page.tsx` now uses `parseStoredItems(row.items)` | `amount/unit/source` present in seeded items; amount input + unit select render ✓ |
| `deleteNutrition` snapshot | `parseStoredItems(row.items)` instead of raw cast | Shape-guarded; structured fields preserved in restore snapshot |

---

## 14. Key Risks and Mitigations

| Risk | Severity | Mitigation |
|------|---------|-----------|
| `recomposeMacros` rounding mismatch vs `scaleMacros` | Low | `recomposeMacros` uses the SAME per-key rules as `scaleMacros` (int for cal/sodium, 1dp for others). Zero drift. |
| `BUILTINS` in client bundle (S-4) | Low-Medium | Already in bundle via `food-resolve-local.ts` import chain. No new weight. Verify with `next build` bundle report. |
| `parseFoodQuery` client import | Low | `food-parse.ts:4` explicitly "No I/O, no 'use server'" — client-safe. |
| `macros` starts null when first `updateItemAmountUnit` fires | Very Low | Cannot happen: structured item can only exist in items[] if it was added via `addItem` which fires `setMacros` first. |
| rawMode + structured add: stale flag appears even though macros are current | Low | Known and intentional. Comment in `addItemToComposer` rawMode branch explains why snapshotHash is NOT reset. |
| Sequential streams take longer | Low | Stream A is ~2h of pure lib work (no component state). Stream B starts immediately after A merges. Total wall-clock < Stream A + Stream B sequential = 4-6h. |

---

## 15. Acceptance Criteria Mapping

| AC | Implementation |
|----|---------------|
| AC-1 `tsc` clean | Gate after each stream |
| AC-2 lint clean | Gate |
| AC-3 build clean | Gate |
| AC-4 types + parseStoredItems | `nutrition-log-ops.ts` §6 |
| AC-5 `unitsForFood` (g/oz/portions for 100g builtin; serving for serving-basis) | `food-units.ts` §1.2 |
| AC-6 `recalcItemMacros({amount:7,unit:"large",source:eggWhite})` ≈ 120 cal / 25.2 P | `food-units.ts` §4.1 + §2.4 walkthrough confirms |
| AC-7 structured row: amount input + unit select; freehand: stepper | `MealComposer.tsx` §10 |
| AC-8 structured edit → no stale flag (T2/T3) | `updateItemAmountUnit` + `requestRemoveItem` §2.3 |
| AC-9 `itemsJson` persists; edit seeds amount/unit/source | `workout-actions.ts` §8 + `edit/page.tsx` §8.3 |
| AC-10 legacy item regression | row branch on `!item.source` §10 |
| AC-11 MCP `tools/list` unchanged | MCP changes are strip-only (read side); tool schemas unchanged |
| AC-12 date math unchanged | Not touched |

---

## 16. QA Smoke Sequence

1. `npx tsc --noEmit` — after each stream merges.
2. `npm run lint` — gate.
3. tsx assertions:
   - `unitsForFood(eggWhiteSnapshot)` → includes keys `"g"`, `"oz"`, `"large"`, `"medium"`, `"small"`.
   - `recalcItemMacros({amount:7, unit:"large", source:eggWhiteSnapshot})` → `{calories:120, proteinG:25.2, ...}` (verify against actual BUILTINS values; large=33g, perBasis per food-builtins.ts).
   - `recomposeMacros({calories:120, proteinG:25.2},{calories:350, proteinG:12.0})` → `{calories:470, proteinG:37.2}`.
   - `sumStructuredMacros([A_structured, B_freehand])` → only A counted.
   - `parseStoredItems([{name:"X", amount:7, unit:"large", source:{basis:"100g", perBasis:{...}, portions:[]}}])` → `[{name:"X", amount:7, unit:"large", source:...}]` (round-trips).
   - `stripItemSource([{name:"X", amount:7, unit:"large", source:{perBasis:...}}])` → `[{name:"X", amount:7, unit:"large"}]`.
4. Browser smoke (390 px, `npm run dev`):
   - Pick "egg whites" → amount input + unit select appear, default seeded → change to 7 × large → macros update live, no stale flag.
   - Add freehand "leftover curry" → stepper shown, no unit select.
   - Hand-edit total macros → snapshot resets (Fresh).
   - Remove curry → stale flag fires; Recompute → Apply → Fresh.
   - Remove egg-whites (structured) → Fresh immediately, macros correct.
   - Save → re-open in edit mode (`edit/page.tsx` route) → amount/unit present, recomputes on change.
   - Re-open in BottomSheet edit (BottomSheet host path) → same.
5. Legacy meal (MCP-logged, no source): open edit → stepper shows, no amount/unit input, no regression.
6. MCP curl: `get_nutrition_history` response → items contain `amount`/`unit` but no `source` key.
