# PRD: Structured Amount + Unit Fields in the Food Composer (live macro recalc)

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-06-15
**Status**: Draft
**GitHub Issue**: N/A — direct-to-main
**Branch**: main
**UX-research**: skipped — incremental control on an existing, heavily-patterned composer (steppers/chips/flash already established); the sole open design decision (which units each food exposes) is data-derived, not visual. Reuses established row patterns; keep it simple.

---

## 1. Overview

### 1.1 Problem Statement
The composer stores each item as `NutritionItem { name, qty?: string, notes? }` where `qty` is free text ("8 oz", "700 g"). Macros are a separate `MacroValues` total, scaled once at add-time. There is no first-class amount/unit and no live recalc, so:
- **Unit slips**: typing "7 egg whites" resolved to 7 × 100 g = 700 g (fixed for egg whites via a builtin, but the class persists for any weight-basis food).
- **Macro desync**: hand-editing an item's qty (stepper bump, row edit) marks macros "stale" and requires a manual "Recompute from items" — items and macros can be saved out of sync (the `update_nutrition`/`nutrition_log_ops` footgun, memory: nutrition-two-edit-paths).

### 1.2 Proposed Solution
Give each *picked* (food-resolved) item a structured **amount** (number) + **unit** (dropdown), with the unit options **derived from the food**: a 100 g-basis food offers `g`/`oz`; a builtin with `portions` also offers its piece units (e.g. "large egg white (33 g)"); a serving-basis food offers `serving`. Search prefills the sensible default. Changing the amount or unit **recomputes that item's macros and re-sums the meal total LIVE** — no stale flag, no manual recompute step.

Each structured item **persists** `amount`, `unit`, and a compact **food snapshot** (basis + per-basis macros + portions) inline in `NutritionLog.items` (already a JSON column — additive, no migration). This lets any past meal be re-opened and unit-edited ("700 g" → "7 large egg whites") with macros recomputing offline (no food-DB dependency at render/edit time — preserves the denormalized-stored-macros model).

**Freehand items** (typed text with no food match) keep the current plain-qty stepper + the existing "Recompute from items" staleness path — nothing is forced through the picker. **MCP is unchanged**: this is an app-composer entry aid that still stores computed macros; `log_nutrition`/`update_nutrition` keep their contract, and coach-logged / legacy items render via the back-compat path.

### 1.3 Success Criteria
- Picking a food shows an editable **amount** field + a **unit** dropdown seeded with that food's valid units and a sensible default.
- Changing amount or unit updates that item's macros AND the meal total **immediately** (no "stale" flag for structured items).
- A structured meal saved and re-opened in edit mode shows the same amount/unit and recomputes live when changed.
- "7 egg whites" via the picker stores `amount:7, unit:"large"` → ~231 g-equivalent macros, never 700 g.
- Legacy/coach items (`{name, qty:"8 oz"}`, no snapshot) still render and use the existing stepper + Recompute fallback.
- `tsc`/lint/build green; MCP tool surface unchanged.

---

## 2. User Stories

| ID | As Gabe, I want to... | So that... | Priority |
|----|------------------------|------------|----------|
| US-001 | pick a food and set its amount + choose a unit from a list | I enter quantities in the unit I think in (eggs, oz, g) without free-text guessing | Must |
| US-002 | see macros and the meal total update the instant I change amount or unit | I never save items and macros out of sync | Must |
| US-003 | re-open a past meal and change its unit/amount | I can correct a logged "700 g" to "7 large egg whites" with macros following | Must |
| US-004 | still type freehand items the app doesn't recognize | fast guestimate logging isn't lost | Must |
| US-005 | have the unit list reflect the actual food | I see "large egg white (33 g)" for eggs, "oz"/"g" for ground beef, "serving" for a packaged food | Should |

---

## 3. Functional Requirements

### 3.1 Core Requirements
1. Extend `NutritionItem` (JSON, additive) with optional `amount?: number`, `unit?: string`, and `source?: ItemFoodSnapshot` (the food snapshot enabling cross-unit recalc). `qty?: string`, `name`, `notes?` remain (qty kept for display + freehand + back-compat).
2. `ItemFoodSnapshot` captures, at add time: `basis: "100g" | "serving"`, the per-basis `FoodMacros` (per 100 g OR per serving), and `portions: { key, label, grams }[]` (piece units; empty for foods without portions). Optional `foodId`, `brand`.
3. Pure helper `unitsForFood(snapshot) -> UnitOption[]`: for `100g` basis → `g`, `oz`, plus one option per portion (piece units) keyed by portion key; for `serving` basis → `serving` (+ `g`/`oz` only if a gram weight is known). Each `UnitOption` carries what's needed to convert amount→macros.
4. Pure helper `recalcItemMacros(item) -> FoodMacros`: given a structured item (`amount`, `unit`, `source`), convert amount×unit to the food's basis quantity (grams for `100g`, count for `serving`) and scale via `scaleMacros`. Returns null/zeros when the item is freehand (no `source`).
5. `useFoodComposer` add path: when a picked food is materialized into an item, populate `amount`, `unit` (the resolved default), and `source` (snapshot) — not just the text line.
6. MealComposer item row: for **structured** items render an **amount number input** + a **unit `<select>`** (options from `unitsForFood`); on change, recompute that item via `recalcItemMacros` and **re-sum the meal total live**. For **freehand/legacy** items (no `source`), render the existing qty stepper and keep the stale→Recompute path.
7. Meal total macros = sum of structured items' `recalcItemMacros` + the existing manual/freehand contribution, kept coherent so structured edits never raise the "stale" flag.
8. Persist structured fields through the save path (`logNutrition` / `updateNutrition`): the submit channel must carry structured items as **JSON** (the current text-serialization channel is lossy for structured data). Edit mode seeds from the stored structured items.
9. Back-compat: items lacking `source` render and behave exactly as today (stepper + Recompute). The raw-text escape hatch still works and produces freehand items.

### 3.2 Secondary Requirements
10. Default unit selection: search/parse already yields count/size/grams (`parseFoodQuery`); prefer a piece unit when the query implies count ("7 egg whites" → `large`), else the food's default portion / basis unit.
11. Display: a structured item's `qty` string is derived for display ("7 × large egg white", "200 g") so history and the collapsed view read naturally without the snapshot.

### 3.3 Out of Scope
- Changing the MCP write-tool contract (coach logging stays text+macros).
- A Prisma migration (items is already JSON; change is additive).
- New units beyond what basis + portions express (no volume↔weight conversion, no density tables).
- USDA/OFF live re-fetch on edit (snapshot is authoritative).
- Recalc for freehand items with no food match (handled by existing Recompute).

---

## 4. Technical Design

### 4.1 Data Model (Prisma)
**No migration.** `NutritionLog.items` is already `Json`. The change is to the TypeScript `NutritionItem` shape (`src/lib/nutrition-log-ops.ts`) + its parsers:

```ts
export type ItemFoodSnapshot = {
  basis: "100g" | "serving";
  perBasis: FoodMacros;            // per 100 g (basis "100g") or per 1 serving (basis "serving")
  portions: { key: string; label: string; grams: number }[]; // piece units; [] if none
  foodId?: string;
  brand?: string | null;
};
export type NutritionItem = {
  name: string;
  qty?: string;        // display string / freehand / legacy (kept)
  notes?: string;
  amount?: number;     // NEW — structured quantity
  unit?: string;       // NEW — unit key ("g" | "oz" | "serving" | portion key)
  source?: ItemFoodSnapshot; // NEW — enables offline cross-unit recalc + unit dropdown
};
```
`parseStoredItems` (nutrition-log-ops.ts) must preserve the new optional fields (currently it strips to name/qty/notes — **this is a required fix**). Migration plan: none; backfill: none (old rows render via back-compat).

### 4.2 MCP Tool Surface
**Unchanged.** `log_nutrition`, `batch_log_nutrition`, `update_nutrition`, `nutrition_log_ops` keep current schemas. They write items without `amount/unit/source`; those render via the legacy path. No connector re-handshake needed. (Confirm `parseStoredItems` round-trips unknown fields so a structured item edited via `nutrition_log_ops` isn't silently stripped — see Edge Cases.)

### 4.3 Server Actions
`src/lib/workout-actions.ts` — `logNutrition`, `updateNutrition`:

| Action | New FormData field | Mutation | revalidatePath |
|--------|--------------------|----------|----------------|
| logNutrition | `itemsJson` (structured JSON; falls back to `items` text when absent) | create NutritionLog with structured items + computed macros | `/`, `/nutrition` |
| updateNutrition | `itemsJson` | update items + macros together | `/`, `/nutrition`, `/days/[dateKey]` (as today) |

The text `items` channel remains for the raw-text path; `itemsJson` (when present) is authoritative.

### 4.4 Pages / Components
- **Modified**: `src/components/MealComposer.tsx` (item row → amount input + unit select for structured items; live re-sum), `src/components/useFoodComposer.tsx` (capture amount/unit/source on add), `src/lib/items-text.ts` (serialize/parse must not drop structured fields; add a JSON serializer), `src/lib/nutrition-log-ops.ts` (`parseStoredItems` preserves new fields).
- **New (pure helpers)**: `unitsForFood`, `recalcItemMacros`, default-unit selection — in `src/lib/food-resolve-local.ts` (already client-safe, holds `scaleMacros`) or a new `src/lib/food-units.ts`.
- Server components unchanged elsewhere; this is client composer work.

### 4.5 Date / Time Semantics
N/A — no new date math. Existing `whenDate` path unchanged (already calendar-routed).

### 4.6 Override-Awareness
N/A — nutrition composer is orthogonal to plan-day overrides.

### 4.7 Third-Party Dependencies
None.

---

## 5. UI/UX Specifications

### 5.1 Screen Descriptions (390 px)
Structured item row (food resolved):
```
 Egg Whites                              ↑ ↓
 [  7  ]  [ large egg white (33g) ▾ ]    ✕
          ▾ large egg white (33g)
            gram
            oz
 → 119 cal · 25 P     (recomputes live on change)
```
Freehand item row (no match) — unchanged:
```
 leftover curry                          ↑ ↓
   −   [ 1 serving ]   ＋                 ✕      (stale flag + Recompute as today)
```
Amount input: numeric, ≥44 px tall, thumb-reachable. Unit `<select>`: native select (mobile-friendly), options from `unitsForFood`. The sticky macro header + projected/remaining lines (existing) update live as totals change.

### 5.2 Navigation Flow
No nav change. Same Log sheet / `/nutrition` composer entry points.

### 5.3 Responsive + Mobile-First
390 px primary; amount input & select ≥44 px; tokens only (`var(--accent)`, `var(--border)`, `var(--card)`, `var(--muted)`, `var(--accent-soft)`); native `<select>` for the unit (best mobile affordance). Reuse existing row/stepper styling.

### 5.4 Accessibility
Amount input has an associated `aria-label` (`Amount for {name}`); unit select has `aria-label` (`Unit for {name}`); visible focus rings; numeric changes announced via the existing `aria-live` macro header.

---

## 6. Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|------------------|
| Item has no `source` (legacy/coach/freehand) | Render existing stepper + stale/Recompute path; no unit dropdown |
| Amount blank / 0 / non-numeric | Treat as 0 for that item's macros; don't NaN the total; don't block save |
| Unit not in the food's options (stale data) | Fall back to the item's stored macros; offer the default unit |
| `parseStoredItems` sees unknown fields | Preserve `amount/unit/source` (currently strips them — fix) |
| Structured item edited via MCP `nutrition_log_ops` | Items array round-trips structured fields; macros may go stale (existing warning already added) |
| Raw-text toggle on a structured meal | Leaving raw → items re-materialize as freehand (lose structure) — acceptable; warn copy optional |
| Food snapshot macros all null | Item contributes nulls (skipped in sum), like today's unmatched items |
| Very long food name at 390 px | Truncate/wrap as existing rows do |

---

## 7. Security Considerations
- No new routes; MCP auth unchanged.
- `itemsJson` parsed defensively (shape-guarded like `parseStoredItems`); never `eval`/`dangerouslySetInnerHTML`.
- Numbers coerced + clamped (amount ≥ 0, finite); Prisma types on write.

---

## 8. Acceptance Criteria
1. [ ] `npx tsc --noEmit` passes, 0 errors.
2. [ ] `npm run lint` introduces no new errors.
3. [ ] `npm run build` succeeds.
4. [ ] `NutritionItem` carries optional `amount`, `unit`, `source`; `parseStoredItems` preserves them (unit test via tsx or inline assertion).
5. [ ] `unitsForFood` returns g/oz + piece units for a `100g` builtin (egg-white), `serving` for a serving-basis food (pure-function check via tsx).
6. [ ] `recalcItemMacros({amount:7, unit:"large", source: eggWhiteSnapshot})` ≈ 7×33 g-equivalent macros (≈119 cal / 25 P), NOT 700 g (tsx check).
7. [ ] MealComposer renders amount input + unit select for structured items and a stepper for freehand items (code-level: branch on `item.source`).
8. [ ] Changing amount or unit recomputes the item and re-sums the meal total without setting the stale flag (code path: structured edit → recompute → setMacros + reset snapshot).
9. [ ] `logNutrition`/`updateNutrition` persist structured items via `itemsJson`; edit mode seeds amount/unit/source from stored items.
10. [ ] Legacy item `{name:"X", qty:"8 oz"}` (no source) renders + behaves as today (no regression).
11. [ ] MCP `tools/list` shape unchanged; `log_nutrition` still accepts its current schema.
12. [ ] All Date math unchanged / via `@/lib/calendar`.

---

## 9. Open Questions
None — resolved in Phase 1 discovery (flow=direct-to-main; persist structure + edit mode; freehand fallback kept; MCP unchanged).

---

## 10. Test Plan
### 10.1 Gates
`npx tsc --noEmit`, `npm run lint`, `npm run build` — all clean.
### 10.2 Pure-helper checks (tsx, no DB)
`unitsForFood`, `recalcItemMacros`, default-unit selection over: egg-white builtin (100g + portions), a serving-basis library food, a freehand item (no source). Assert egg-white 7×large ≈ 231 g-equivalent.
### 10.3 Browser smoke (390 px, `npm run dev`)
1. Log sheet → pick "egg whites" → amount field + unit select appear, default seeded → change amount 1→7 and unit → macros + meal total update live, no stale flag.
2. Type freehand "leftover curry" → stepper + Recompute path intact.
3. Save → re-open in edit mode → structured item shows amount/unit, recomputes on change.
4. Cross-check stored `items` JSON carries `amount/unit/source`; `get_nutrition_history` / `recent_history` still render the meal.
### 10.4 Migration verification
N/A (no migration). Confirm an existing logged meal (legacy items) still renders.

---

## 11. Appendix
### 11.1 Discovery Notes
Composer is `MealComposer.tsx` (items: NutritionItem[] + separate MacroValues + stale/Recompute bridge). Food resolution: `food-actions.ts` (estimateFood/searchFoodCandidates/scaleMacros), `food-parse.ts` (count/size/grams), `food-builtins.ts` (BuiltinFood.portions = piece units), `food-types.ts` (basis, MACRO_KEYS, FoodMacros). Items stored as JSON on `NutritionLog.items`. User chose: persist structure (new+edit), freehand fallback kept, MCP unchanged, direct-to-main.
### 11.2 References
Memory: nutrition-two-edit-paths (the macro-desync this closes). Prior commit 42decbe (egg-white per-piece builtin — the unit-slip fix this generalizes).
