# Completion Report — Structured Amount + Unit Composer (live macro recalc)

**Status:** Complete · shipped to `main` · 2026-06-15
**Iterations:** 1 (no rework — DA caught all blockers pre-code)

## Built
Each food-resolved composer item now carries a structured `amount` + `unit` (dropdown derived from the food) that recomputes its macros and re-sums the meal total LIVE. Structure persists in `NutritionLog.items` (JSON — no migration). Freehand items keep the stepper + Recompute fallback. MCP contract unchanged; `source` stripped from read-tool outputs to protect the firehose.

## Commits
- `2b9d97f` feat — lib foundation (Stream A): NutritionItem shape, food-units.ts pure helpers, parseStoredItems preserve, itemsJson channel, MCP strip, edit-page fix
- `e080f98` feat — composer UI (Stream B): structured row (amount input + unit select), T1–T5 live re-sum, B-3 addItem invariant
- `84293d6` chore — drop dead setItemsText wiring (QA cleanup)
- `3494260` docs — PRD + run artifacts

## Files
| File | Change |
|------|--------|
| src/lib/food-units.ts | NEW — unitsForFood, recalcItemMacros, sum/recompose (1dp-correct), buildItemSnapshot, defaultUnitForQuery, buildQtyDisplay |
| src/lib/nutrition-log-ops.ts | ItemFoodSnapshot + extended NutritionItem; parseStoredItems preserves structure; stripItemSource |
| src/lib/items-text.ts | structured JSON channel alongside text |
| src/lib/food-actions.ts | estimateMealMacros prefers recalc for source items |
| src/lib/workout-actions.ts | itemsJson channel in log/updateNutrition |
| src/lib/mcp/tools.ts | stripItemSource on get_nutrition_history / recent_history / get_week |
| src/app/nutrition/[id]/edit/page.tsx | use parseStoredItems (was stripping structure) |
| src/components/useFoodComposer.tsx | addItem callback; structured items on all food-resolved adds |
| src/components/MealComposer.tsx | structured row UI + live re-sum (T1–T5), itemsJson submit |

## Gates
tsc 0 · build success · lint 0 errors/0 new warnings · 12/12 ACs pass (pure-helper tsx + MCP smoke + back-compat).

## Agents
Architect (research+blueprint) → Devil's Advocate (4 blockers) → Architect v2 → Dev Stream A → Dev Stream B → QA+cleanup. All Sonnet.

## Follow-up
- Browser smoke at 390px is the user's to eyeball (agents can't visually test): pick a food → amount/unit appear → change → live recalc → save → re-open edit.
- UX-research was skipped (recorded in PRD header) — incremental control reusing established composer patterns.
