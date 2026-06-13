# PRD: Food Library Redesign — macro-grouped picker + click-to-add + build-a-meal-vs-today

**Author**: Claude (Tech Lead) + Gabe · **Date**: 2026-06-13 · **Status**: Approved · **Branch**: main
**UX-research**: COMPLETE (not re-run) — `docs/ux-research/food-library-redesign.md` + `.mockup.html`; chosen direction **"Picker-First / composer-centric"**; ledger **UXR-lib-01..25** ticked in Phase 7.

## 1. Overview
### 1.1 Problem
The food library is a passive scan-cache: `FoodLibraryManager` lists foods with only Edit/Delete — no add-to-meal verb, no macros shown, no grouping/search. There's no "remaining vs today" surface and no preview of a meal-you-plan-to-eat. User's words: *"I can't click them to add to a meal… what is the library for?"* and *"somewhere visible with today's total so I can plug-and-play foods to fill the remainder of my macro goals."*

### 1.2 Solution (chosen direction, verbatim from research §2)
- **Macro-grouped, searchable picker opened from inside `MealComposer`** ("Browse library"); each row's `[+]` reuses the existing `ScanFoodSheet` servings stepper + `mergeFoodIntoForm` (the exact chip-tap path).
- **Enriched composer sticky header**: a size-24 Bullseye showing *projected* fill `(trackedSoFar + thisMeal) / dayTarget`, a `so far + this meal = projected / target` line, and a **remaining** read. The meal stays a transient not-yet-logged draft until "Log meal" — that IS "build a meal and see how it stacks." Degrades honestly to running totals when no target.
- **size-20 Bullseye + remaining on the `NutritionToday` day-total strip** (remaining at a glance).
- **Manage-mode `FoodLibraryManager`**: macro-group segmented tabs + per-row macro line + dominant-macro badge (data already fetched, currently hidden).
- **No schema migration** — all reads use stored fields; new values are arithmetic on already-fetched data.

### 1.3 Success criteria
Tap "Browse library" in the meal composer → grouped/searchable picker → `[+]` a food → it adds to the draft and the header Bullseye/remaining update live (zero server round-trip). Day-total strip shows remaining + Bullseye. FoodLibraryManager shows macros + group tabs. **The existing create/edit meal flow is byte-for-byte intact** (regression gate). No-target days degrade to running totals. tsc/lint/build clean.

## 2. User Stories
| ID | As Gabe I want to… | So that… | Priority |
|----|--------------------|----------|----------|
| US-1 | tap a previously-scanned food to add it to the meal I'm building | I stop re-scanning / re-typing | Must |
| US-2 | browse my foods grouped by macro (protein/carb/fat/misc) + search | I find "that protein" fast | Must |
| US-3 | see my meal-in-progress projected against today's remaining target | I plug-and-play to fill the gap before logging | Must |
| US-4 | see today's remaining macros at a glance on the nutrition surface | I know what's left without math | Should |
| US-5 | see each library food's macros + dominant macro in the manager | the library is honest and browsable | Should |

## 3. Functional Requirements
### 3.1 Core
1. `LibraryPickerOverlay` (NEW): `fixed inset-0` **non-dialog** overlay (NOT a 2nd `<dialog>` — dodges the iOS Safari double-dialog bug, mirroring ScanFoodSheet), with search (client filter over pre-loaded library foods), macro-group segmented tabs (All/Protein/Carbs/Fat/Misc), grouped rows showing macros + usage, and `[+]` per row (≥44px) that opens the existing `ScanFoodSheet` confirm phase → `mergeFoodIntoForm`. Opens from a "Browse library" control in `useFoodComposer`.
2. `food-resolve-local.ts` (NEW, pure, no `"use server"`): `classifyFood(food)` (caloric-share dominance → protein/carbs/fat/misc; null/zero/near-balanced → misc), `resolveItemMacrosPure(query, libraryFoods)` (sync, zero round-trip), and `scaleMacros` extracted from `food-actions.ts`.
3. `MealComposer` enriched header: accept `trackedSoFar` + `dayTarget` props; render projected line + remaining + size-24 Bullseye projected fill; extend `flashMacros` to the add path. Header shows the **no-target degraded** variant when `dayTarget` absent (hollow Bullseye, "No plan set — showing what's been logged", no projected/over line).
4. `NutritionToday` day-total strip: size-20 Bullseye + "X remaining" when a positive target exists; honest no-target variant.
5. `FoodLibraryManager` manage-mode: macro line on collapsed rows, macro-group segmented tabs (`role=radiogroup`), dominant-macro **letter badge** (ship letter first, not a dot), honest null-macro rows ("— · mixed / data incomplete").
6. `nutrition/page.tsx`: compute `trackedTodayMacros` (reduce over today's already-fetched logs by USER_TZ `dateKey`) + `dayTargetMacros` (from `resolveDay().nutritionPlan`); thread both + `libraryFoods` down. Reuse `src/lib/nutrition-macros.ts` (shipped today) for the sums; `remaining = max(0, target − soFar)`.

### 3.2 Secondary
- `MoreSheet` Nutrition subtitle nudge + adopt the one-line library purpose statement (UXR-lib-25).
- `listLibraryFoods` `take` 50→200 **only if** the architect confirms payload is acceptable (UXR-lib-22) — otherwise keep 50 and note it.

### 3.3 Out of scope
- Per-item macro storage / MealItem table (no migration). A planner tray on `/nutrition` (rejected Direction 2). Any MCP tool change. New deps.

## 4. Technical Design
### 4.1 Data model
N/A — no migration. `classifyFood` reads `proteinG/carbsG/fatG`; `trackedSoFar` sums `NutritionLog` per-meal macros for today; `dayTarget` from `resolveDay(now).nutritionPlan`.
### 4.2 MCP surface
N/A — no tool changes (no connector reload).
### 4.3 Server actions
No new mutations. The picker-add path is client-pure (`mergeFoodIntoForm` + `resolveItemMacrosPure`, `recordFoodUse` fire-and-forget). Existing `logNutrition`/`updateNutrition` unchanged; their `revalidatePath("/nutrition")` refreshes `trackedSoFar`.
### 4.4 Components
NEW `LibraryPickerOverlay.tsx`, `food-resolve-local.ts`. MODIFY `useFoodComposer.tsx`, `MealComposer.tsx`, `NutritionToday.tsx`, `FoodLibraryManager.tsx`, `nutrition/page.tsx`, `globals.css`, `MoreSheet.tsx`. Server-by-default; client islands where interaction demands. Reuse `Bullseye`, `ScanFoodSheet`, `mergeFoodIntoForm`, `nutrition-macros.ts`.
### 4.5 Date/TZ
`trackedSoFar` buckets today via `@/lib/calendar` `dateKey`; no raw date primitives.
### 4.6 Override-awareness
`dayTarget` reads `resolveDay(now).nutritionPlan` (override-aware) — NOT the rotation default.
### 4.7 Deps
None.

## 5. UI/UX
Normative: `docs/ux-research/food-library-redesign.md` §2–§5 + the `.mockup.html` (light+dark @390px). Key: enriched composer header (projected/remaining/Bullseye), `fixed inset-0` picker with segmented macro tabs + search, day-strip Bullseye, manage-mode FoodLibraryManager. Restraint per the report: ship **letter badge** (not dot, UXR-lib-13) and **typed numerals** (not micro-bar, UXR-lib-14) first; Bullseye **snaps** discretely (no tween); reuse existing keyframes only.

## 6. Edge cases
| Scenario | Behavior |
|----------|----------|
| No nutrition plan (no target) | Hollow Bullseye, "No plan set — showing what's been logged", running totals only, no over/under judgment |
| Food with null/partial macros | Classify → misc; render "—" honestly; never zero or fake |
| Empty draft (0 items) | No projected preview (Zeigarnik noise) — only once ≥1 resolvable item |
| Over target | "−N over target" **words** + warning color (color never sole signal); budget framing, never "you owe" |
| Library empty / no search match | Honest empty state in the picker |
| Meal logged without estimate | Contributes 0 to trackedSoFar (per-meal macros only; documented) |
| Picker over composer sheet on iOS | `fixed inset-0` non-dialog overlay (the gate — verify on device) |

## 7. Security
Read-only client classification + arithmetic; no new routes/secrets; no `dangerouslySetInnerHTML`; badge colors via `color-mix`/token opacity (no literals).

## 8. Acceptance Criteria
1. [ ] tsc/lint/build clean.
2. [ ] "Browse library" in composer → picker (grouped + search) → `[+]` → ScanFoodSheet → adds to draft; header Bullseye/remaining update live, no server round-trip.
3. [ ] No-target day degrades per §6.
4. [ ] Day-total strip shows remaining + Bullseye; manage-mode FoodLibraryManager shows macros + group tabs + letter badge.
5. [ ] **Regression: existing create + edit meal flow unchanged** (log a meal, edit a logged meal, scan, chips, recompute — all intact).
6. [ ] USER_TZ + override-aware reads correct; AA-contrast fixes applied (UXR-lib-11/12 — 12px bold or `--foreground` for small muted labels); Bullseye ring-rounding reconciled vs `progressToRings` (UXR-lib-10).
7. [ ] UXR-lib ledger ticked.

## 9. Open Questions
None blocking. `listLibraryFoods` 50→200 is architect's call (payload). `take` and ring-rounding resolved in the blueprint.

## 10. Test Plan
tsc/lint/build; dev-server 390px smoke: open composer, Browse library, switch macro tabs, search, `[+]` add a real library food (e.g. the whey protein), confirm header updates + remaining; check day-strip Bullseye on /nutrition + Today; FoodLibraryManager grouping; **regression** the create + edit meal flows. No-target check (a day without a plan). iOS overlay gate noted for the user's device.

## 11. Appendix
Research: `docs/ux-research/food-library-redesign.md` (§7 file-level scope, §9 provisional list, ledger). Reuses today's `src/lib/nutrition-macros.ts` + `TodayMacroSummary`. Plan: `~/.claude/plans/smooth-mixing-garden.md`.
