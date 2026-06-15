# Architecture Critique — Structured Amount + Unit Composer

**Date:** 2026-06-15
**Reviewer:** Devil's Advocate Agent
**Blueprint:** architecture-blueprint.md
**Status:** Pre-implementation findings — MUST be resolved before coding begins

---

## BLOCKERS

### B-1 · Delta step 5 silently rounds 1dp macros to integers

**File/line:** blueprint §2.2, step 5 — `newTotal[k] = Math.round((macros[k] ?? 0) + delta[k])`

**Problem:** `Math.round` is applied uniformly to ALL macro keys. `scaleMacros` in
`food-resolve-local.ts:15-32` deliberately uses `Math.round(v * s * 10) / 10` (1-decimal)
for `proteinG`, `carbsG`, `fatG`, `fiberG` and integer rounding only for `calories` and
`sodiumMg`. The delta step destroys this precision:

**Concrete failing scenario:**
```
Meal: egg whites 7×large (33 g each = 231 g = 2.31 servings)
  → scaleMacros gives proteinG = Math.round(10.9 * 2.31 * 10) / 10 = 25.2 g   (1dp ✓)

User changes to 8×large (264 g = 2.64 servings):
  newMacros = scaleMacros → proteinG = Math.round(10.9 * 2.64 * 10) / 10 = 28.8 g
  delta     = 28.8 − 25.2 = 3.6 g
  step 5 → Math.round(25.2 + 3.6) = Math.round(28.8) = 29 g   ← WRONG (should be 28.8)
```

This error compounds on every edit. Over 5 edits the protein total can drift ≥ 1–2 g from the
correct value.

**Root cause:** The blueprint does not branch on macro type before applying Math.round.

**Recommended resolution: Abandon delta; switch to full structured re-sum.**

The full re-sum eliminates delta drift AND removes this rounding bug in one change.
For every `updateItemAmountUnit` (and `removeItem` of a structured item):

```ts
// 1. Snapshot oldStructuredSum BEFORE changing items
const oldStructuredSum = sumStructuredMacros(items);           // Σ recalcItemMacros(items[j].source ≠ null)

// 2. Compute freehandResidual = what the running total has that can't be explained by structured items
//    (manual entries, freehand adds, legacy items)
const residual = macroResidualsFromTotal(macros, oldStructuredSum);

// 3. Apply change to items
const newItems = items.map((it, j) => j === idx ? { ...it, amount, unit, qty: buildQtyDisplay(...) } : it);

// 4. Re-sum structured items with fresh recalc
const newStructuredSum = sumStructuredMacros(newItems);

// 5. Recompose total with per-key rounding
const newMacros = recomposeMacros(newStructuredSum, residual); // int for cal/sodium, 1dp for others

// 6. Atomically flush (see B-2 for how)
setItems(newItems);
setMacros(newMacros);
setSnapshotHash(hashItems(newItems));
```

`sumStructuredMacros` is O(n) per edit; meal sizes are always < 20 items. The residual is
also correct when removing a structured item — no separate "subtract delta" code path needed.

---

### B-2 · `setSnapshotHash` called inside `setItems` functional updater — React anti-pattern

**File/line:** blueprint §3.3, `addItemToComposer`

```ts
setItems((prev) => {
  const next = [...prev, item];
  setSnapshotHash(hashItems(next));   // ← state setter inside a state updater function
  return next;
});
```

**Problem:** A functional updater passed to `setState` must be a **pure function**. Calling
`setSnapshotHash` inside it is a side effect. React Strict Mode calls updaters **twice** in
development to surface this — `setSnapshotHash` fires twice with potentially inconsistent state,
producing a stale or incorrect snapshot hash.

The blueprint §12 cites "existing `resetCreate` does this pattern" as precedent — but
`resetCreate` calls `setItems([])` and `setSnapshotHash(hashItems([]))` **sequentially at the
call site**, NOT one inside the other's updater. These are different patterns.

**Concrete failing scenario:**
```
User taps "Add" chip twice rapidly (React batches both calls in a transition).
Strict Mode: setItems updater runs twice; setSnapshotHash is called twice.
Second call may see prev = [] (stale closure), producing snapshotHash = hashItems([item])
instead of hashItems([item1, item2]) → stale flag appears on a fresh add.
```

**Resolution:** Never call setState inside another state updater. Since `addItemToComposer` is
always called synchronously from a click handler, the `items` closure is current:

```ts
function addItemToComposer(item: NutritionItem): void {
  if (rawMode) {
    // rawMode path unchanged
  } else {
    const next = [...items, item];   // items from closure — stable in sync click context
    setItems(next);
    setSnapshotHash(hashItems(next));
  }
}
```

Same fix applies to `updateItemAmountUnit` if it uses functional updater form: compute `next`
outside the setter, call `setItems(next)`, `setMacros(newMacros)`, `setSnapshotHash(hashItems(next))`
as three sequential synchronous calls — React 18+ batches them automatically in a click handler.

---

### B-3 · `handleEstimateAddAnyway` still calls `setItemsText` — destroys all structured fields

**File/line:** `useFoodComposer.tsx:342-351`; blueprint §3.2 and §3.4

**Problem:** The blueprint says `setItemsText` is "no longer used for food-resolved items" but
leaves `handleEstimateAddAnyway` as "keep as-is OR call `addItem({ name: line })` directly".
If an implementer reads this as "keep as-is", a critical regression lands.

`setItemsText` in MealComposer (blueprint §3.1) runs:
```ts
setItemsText: (next: string) => {
  const parsed = parseItemsText(next);   // ← LOSSY: drops amount/unit/source from ALL items
  setItems(parsed);
  setSnapshotHash(hashItems(parsed));
},
```

`merged.itemsText` passed to this callback is built from `itemsText = serializeItems(items)` +
the new freehand line. `serializeItems` (items-text.ts:38-47) emits only `name | qty | notes`;
`parseItemsText` reconstructs only those three fields. Every structured item in the meal loses
its `amount`, `unit`, and `source` the instant `handleEstimateAddAnyway` runs.

**Concrete failing scenario:**
```
1. User picks "egg whites" (chip) → items = [{name:"Egg Whites", amount:7, unit:"large", source:…}]
2. User types "leftover curry", no match found → taps "Add anyway"
3. handleEstimateAddAnyway: merged.itemsText = "Egg Whites | 7 × large egg white (33g)\nleftover curry"
4. setItemsText → parseItemsText → items = [{name:"Egg Whites", qty:"7 × large egg white (33g)"},
                                              {name:"leftover curry"}]
   → Egg Whites loses source, amount, unit. Now renders as freehand stepper. Unit dropdown gone.
```

**Resolution:** `handleEstimateAddAnyway` MUST use `addItem` and NOT `setItemsText`:

```ts
function handleEstimateAddAnyway() {
  const line = lastEstimateQueryRef.current || estimateInput.trim();
  if (!line) return;
  addItem({ name: line });             // freehand item — no source, no amount/unit
  // macros are unchanged (no macro data for a not_found item — existing behavior)
  setEstimateInput("");
  setEstimateResult(null);
  setCandidates(null);
}
```

`setItemsText` should be removed from the hook's public interface after this change (or at
minimum documented as "rawMode / legacy escape hatch only — NEVER called from food-resolved
or freehand paths").

---

### B-4 · MCP read tools will expose `source` (perBasis + portions) in coach context — token bloat

**File/line:** `tools.ts:1593` (`get_nutrition_history`), `tools.ts:761` (`recent_history`),
`tools.ts:1106-1109` (`get_week`), `tools.ts:1564` (`get_day`)

All four tools return `r.items` / `row.items` as raw Prisma JSON. Today items are `{name, qty?, notes?}`
(~50 bytes/item). After this feature, each structured item carries:
```json
{
  "name": "Egg Whites",
  "qty": "7 × large egg white (33 g)",
  "amount": 7,
  "unit": "large",
  "source": {
    "basis": "100g",
    "perBasis": { "calories": 52, "proteinG": 10.9, ... },
    "portions": [
      { "key": "large", "label": "large (33 g)", "grams": 33 },
      { "key": "medium", "label": "medium (28 g)", "grams": 28 },
      { "key": "small", "label": "small (24 g)", "grams": 24 }
    ],
    "foodId": "...",
    "brand": null
  }
}
```
That is ~400 bytes/item. A meal with 6 structured items adds ~2.4 KB. A 14-day history with
3 meals/day × 5 items = 210 items → ~84 KB of extra JSON in `recent_history` — which the
blueprint (tools.ts:716) already warns can be large enough to get truncated.

`source` is an internal rendering artifact for the app. The coach has no use for `perBasis`
or `portions`; the denormalized `calories/proteinG/...` columns on `NutritionLog` already
give it what it needs. Sending `source` wastes coach context tokens and risks truncation.

**Resolution:** Strip `source` (and optionally `amount`/`unit`) from items before returning
them in all four MCP read tools. Either:
- Fix in each tool: `items: (r.items as NutritionItem[]).map(({ name, qty, notes }) => ({ name, qty, notes }))`
- Or: expose a `stripSource(items)` helper in `nutrition-log-ops.ts` and call it in each tool.

The `nutrition_log_ops` tool already calls `parseStoredItems` (line 2699) which — after the
blueprint's fix — preserves `amount/unit/source`. For that tool, keep them (needed for
`applyNutritionLogOps` to preserve structured fields through spreads). For the read-only
history tools, strip them.

---

## SHOULD-FIX

### S-1 · Removing a structured item doesn't clear its macro contribution

**File/line:** `MealComposer.tsx:320-322`, `requestRemoveItem:326-332`

`removeItem` splices the item from `items[]` but never adjusts `macros`. For freehand items
this is the correct behavior (we can't recompute their macros). For **structured** items, we
know exactly what they contributed via `recalcItemMacros`. Not subtracting means:
- Single-structured-item meal: user removes the only item → macros still show its calories.
- stale flag fires even though macros are knowably wrong — the flag says "may be stale" but
  in this case it's definitely stale in a correctable direction.

**Resolution:** In `requestRemoveItem` (and `removeItem`), branch on `item.source`:
- If `item.source` present: apply the full-resum approach (B-1) with the item excluded,
  reset snapshotHash → stays Fresh, no stale flag.
- If no `source`: existing behavior (stale flag, Recompute path).

---

### S-2 · MCP read tools expose raw `items` including `source` — overlaps B-4

*(See B-4 — elevated to BLOCKER based on context-size risk.)*

---

### S-3 · Unit `<select>` renders blank when stored unit is not in `unitsForFood`

**File/line:** blueprint §8, item row JSX — `value={item.unit ?? ""}` with no fallback option

When a structured item has `unit:"large"` but the rebuilt `unitsForFood(item.source!)` no
longer includes `"large"` (e.g., the food was re-seeded without that portion, or the snapshot
is from an older DB revision), the `<select>` value doesn't match any `<option>`. Native
browser behavior: the select shows blank or reverts to the first option visually but the bound
`value` remains `"large"` → user interaction selects the first visible option but calls
`updateItemAmountUnit(i, item.amount, "g")` unexpectedly.

**Resolution:** Add a disabled `<option>` for the stored unit when it is not in `unitOptions`:
```tsx
{!unitOptions.some(o => o.key === item.unit) && item.unit && (
  <option key="__stored" value={item.unit} disabled>
    {item.unit} (not available)
  </option>
)}
```
This way the select visually shows the stored state and the user must consciously pick a
new unit before any recalculation fires.

---

### S-4 · `BUILTINS` added to client bundle — currently server-only

**File/line:** blueprint §5 (`buildItemSnapshot`); `food-builtins.ts:1`

`BUILTINS` is currently imported only by `food-actions.ts` which has `"use server"` — so it
lives in the server bundle only. The new `food-units.ts` will import `BUILTINS` for
`buildItemSnapshot`'s builtin-portion lookup. Since `food-units.ts` will be imported by
`MealComposer.tsx` (client component), `BUILTINS` moves to the client bundle.

At ~50 entries × ~200 bytes raw ≈ 10 KB raw / ~3 KB gzipped — not catastrophic, but worth
a conscious call. The blueprint §12 notes "accept the bundle cost for MVP." That is fine for
MVP, but requires:
1. Confirming `food-builtins.ts` has no `"use server"` directive (it does not — confirmed). ✓
2. Verifying Turbopack doesn't tree-shake it unexpectedly (static `BUILTINS.find()` → it won't).

Mark for a follow-up slice to lazy-load or server-route the portion lookup if bundle size
becomes an issue.

---

### S-5 · `deleteNutrition` raw-casts `row.items` without shape validation

**File/line:** `workout-actions.ts:289` — `items: (row.items as NutritionItem[]) ?? []`

`deleteNutrition` populates `NutritionSnapshot.items` with a raw Prisma cast, bypassing
`parseStoredItems`. After the feature ships, this snapshot carries `amount/unit/source` (which
is fine for Undo/restore), but the shape is unvalidated. An unexpected null in `source.perBasis`
would survive into a re-created row without the guard `isValidItemFoodSnapshot` provides.

**Resolution:** Apply `parseStoredItems(row.items)` consistently at all DB-read call sites:
- `deleteNutrition` (line 289)
- Any other raw casts of `row.items as NutritionItem[]`

The blueprint only mentions the edit-seeding path (workout-actions.ts §7.3). Extend the same
discipline to `deleteNutrition`.

---

### S-6 · `mergeFoodIntoForm` text output is discarded on the structured add path — misleading dead code

**File/line:** blueprint §3.2, new `handleAdd`

The new `handleAdd` calls `mergeFoodIntoForm(itemsText, macros, payload)` to compute the new
macro total but discards `merged.itemsText`. `mergeFoodIntoForm` still concatenates the full
text including the item line — computation that hits the hot path on every add.

Additionally, `mergeFoodIntoForm` is a public export used elsewhere. After the PR it will have
confusing semantics: "returns updated text but callers in handleAdd throw it away." This is a
maintainability trap.

**Resolution:** Extract a pure macro-only helper `addFoodMacros(macros, food, servings) →
MacroValues` so `handleAdd` calls it for macros and `addItem` for the item. Keep
`mergeFoodIntoForm` for the rawMode path only. Or document clearly with a comment that callers
use only `macroValues` from the return.

---

## NITS

### N-1 · `updateNutrition` does not revalidate `/days/[dateKey]` — pre-existing gap

**File/line:** `workout-actions.ts:238-260`

`logNutrition` and `updateNutrition` both revalidate `"/"`, `"/"` (duplicate), `"/nutrition"`.
Neither revalidates `/days/YYYY-MM-DD` pages. Blueprint §0.8 notes this and waves it away.
If the `/days/*` page has its own cache segment, edits from the BottomSheet composer won't
reflect until the next layout refresh. Not introduced by this PR but visible now.

### N-2 · `hashItems` must include `amount` and `unit` — blueprint §2.4 is correct, flag for test

**File/line:** `MealComposer.tsx:105-107` (current), blueprint §2.4 (extended hash)

Current `hashItems` hashes only `[name, qty, notes]`. The blueprint extends it to include
`[amount, unit]`. Without this extension, changing amount from 7 to 8 produces an identical
hash → stale check doesn't detect the change → but `updateItemAmountUnit` also resets the
snapshot so in practice it doesn't matter. HOWEVER: if the implementer only extends the hash
WITHOUT the full-resum fix, stale detection is still wrong. Ensure both changes land together.

### N-3 · rawMode + structured add: `addItemToComposer` appends text but macros ARE updated

**File/line:** blueprint §3.3, rawMode branch

When the user has rawMode active and adds a chip food, `addItemToComposer` appends text and
`setMacros(merged.macroValues)` updates macros — but `snapshotHash` is NOT reset.
`stale = true` fires even though macros are current. This is documented as acceptable (rawMode
always causes stale) but could confuse a user who added a chip and sees "macros may be stale."

No code change needed. Add a code comment in `addItemToComposer`'s rawMode branch explaining
why we intentionally don't reset snapshotHash (consistent with existing rawMode behavior).

### N-4 · Hidden `name="items"` textarea still included in rawMode=false path — both fields submitted

**File/line:** `MealComposer.tsx:692-693`

In structured mode the form submits both `name="items"` (the hidden `serializeItems(items)`
textarea) AND the new `name="itemsJson"` field. The server prefers `itemsJson` when present.
If a browser quirk or middleware ever strips `itemsJson`, the fallback text path silently
produces freehand items — which is the intended behavior. Just confirm the fallback is tested
in QA (AC-9) and document it as intentional.

---

## Summary and single strongest recommendation

**Replace the delta approach entirely with a full structured re-sum.**

The delta approach has two independent bugs (B-1 integer-rounding of 1dp macros, and a
mathematical assumption that breaks after manual macro edits) and requires identical code
in BOTH `updateItemAmountUnit` AND `requestRemoveItem` (for structured items). The full
re-sum resolves all of this with one pattern:

```
oldStructuredSum = Σ recalcItemMacros(i) for items[i].source ≠ null
residual[k]      = macros[k] − oldStructuredSum[k]          // freehand + manual contribution
// … apply change to get newItems …
newStructuredSum  = Σ recalcItemMacros(i) for newItems[i].source ≠ null
newMacros[k]      = newStructuredSum[k] + residual[k]        // per-key rounding: int or 1dp
```

It handles add, edit, and remove in one unified code path. It handles the manual-edit residual
correctly. It does not compound rounding errors across edits.

**Other blockers to fix before coding:** B-2 (setSnapshotHash inside updater — fix to
sequential calls), B-3 (handleEstimateAddAnyway must use addItem, not setItemsText), B-4
(strip source from MCP history read-tools — or accept token bloat consciously).
