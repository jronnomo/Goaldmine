# Requirements — Structured Amount + Unit (live macro recalc)

PRD: `docs/prds/PRD-structured-amount-unit-composer.md`. Flow: direct-to-main. No migration (items is JSON). MCP unchanged.

---

## REQ-001 — Item data model + parsers (foundation)
**Description:** Extend `NutritionItem` with optional `amount?: number`, `unit?: string`, `source?: ItemFoodSnapshot`; add `ItemFoodSnapshot` type. Fix `parseStoredItems` (nutrition-log-ops.ts) to PRESERVE these new fields (it currently strips to name/qty/notes — bug for structured items). Add a JSON serialize/parse path for structured items in `items-text.ts` (text serializer stays for the raw-text/freehand channel; structured items need lossless JSON).
**Files:** `src/lib/nutrition-log-ops.ts` (types + parseStoredItems), `src/lib/items-text.ts` (add `serializeItemsJson`/`parseItemsJson` or equivalent; keep `parseItemsText`/`serializeItems`).
**Acceptance:** AC-4 (types carry fields; parseStoredItems preserves; round-trip a structured item through stored JSON). tsc clean.
**Deps:** none. **Complexity:** M.

## REQ-002 — Pure unit + recalc helpers
**Description:** Pure, client-safe functions:
- `unitsForFood(snapshot: ItemFoodSnapshot) -> UnitOption[]` — `100g` basis → `g`,`oz`,+ one per portion; `serving` basis → `serving` (+ g/oz only if a gram weight known). Each option carries conversion data.
- `recalcItemMacros(item: NutritionItem) -> FoodMacros` — amount×unit → basis quantity (grams for 100g, count for serving) → `scaleMacros`. Returns nulls when no `source`.
- `defaultUnitForQuery(parsed, snapshot)` — prefer a piece unit when the query implies count (e.g. "7 egg whites" → `large`), else basis/default-portion unit.
**Files:** `src/lib/food-units.ts` (NEW) — import `scaleMacros` from `food-resolve-local.ts`, `FoodMacros`/`MACRO_KEYS` from `food-types.ts`.
**Acceptance:** AC-5, AC-6 (egg-white 7×large ≈ 119 cal/25 P, not 700 g; serving-basis → serving). Pure — verifiable via tsx, no DB.
**Deps:** REQ-001 types. **Complexity:** M.

## REQ-003 — Composer add path captures structure
**Description:** In `useFoodComposer`, when a picked/estimated/scanned food materializes into an item, populate `amount`, `unit` (resolved default via `defaultUnitForQuery`), and `source` (the `ItemFoodSnapshot` built from the LibraryFood/builtin: basis, per-basis macros, portions). The text line stays for display/back-compat.
**Files:** `src/components/useFoodComposer.tsx` (+ wherever it builds the AddFoodPayload → item; reuse food-actions data).
**Acceptance:** AC-7 prerequisite — added items carry `source`. **Deps:** REQ-001, REQ-002. **Complexity:** M.

## REQ-004 — Item row UI + live recalc + re-sum
**Description:** In `MealComposer`, branch the item row on `item.source`:
- **Structured** (`source` present): render an **amount number input** + a **unit `<select>`** (options from `unitsForFood`). On change → `recalcItemMacros` for that item, re-sum ALL items' macros into the meal total, and DO NOT raise the stale flag (structured edits are always coherent).
- **Freehand/legacy** (no `source`): keep the current stepper + the stale→Recompute path unchanged.
The sum becomes: Σ `recalcItemMacros(structured items)` + manual/freehand contribution; keep `macros` state authoritative for submit. Reuse existing styling/tokens; inputs ≥44 px; aria-labels per PRD 5.4.
**Files:** `src/components/MealComposer.tsx`.
**Acceptance:** AC-7, AC-8, AC-10 (no regression for legacy rows). **Deps:** REQ-001/002/003. **Complexity:** L.

## REQ-005 — Persistence (structured items survive save + edit)
**Description:** Carry structured items as JSON through save: `MealComposer` submits an `itemsJson` field (structured array); `logNutrition`/`updateNutrition` (workout-actions.ts) read `itemsJson` when present (authoritative) and fall back to the text `items` channel otherwise. Store items (incl. amount/unit/source) + computed macros together. Edit mode seeds amount/unit/source from the stored items.
**Files:** `src/lib/workout-actions.ts` (logNutrition, updateNutrition), `src/components/MealComposer.tsx` (hidden `itemsJson` + edit seeding).
**Acceptance:** AC-9; revalidatePath `/`,`/nutrition`,`/days/[dateKey]` preserved. **Deps:** REQ-001. **Complexity:** M.

---

## Streams
- **Stream A (lib foundation):** REQ-001, REQ-002, REQ-005 server-action portion. Non-UI; testable via tsx.
- **Stream B (UI):** REQ-003, REQ-004, REQ-005 client portion. Depends on A's type/helper contract (fully specified by the Architect so B can work against it).

Sequencing decided after architecture: parallel in two worktrees if the contract is clean; else A-then-B.
