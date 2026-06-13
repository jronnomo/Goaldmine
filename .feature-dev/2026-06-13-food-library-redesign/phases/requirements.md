# Requirements — Food Library Redesign

Source of truth: `docs/prds/PRD-food-library-redesign.md` + `docs/ux-research/food-library-redesign.md` (§7 scope, §9 provisional, UXR-lib ledger). No migration. Ship to main.

## REQ-001 — Pure helpers: classifyFood + resolveItemMacrosPure + scaleMacros · M · (foundation; others depend)
NEW `src/lib/food-resolve-local.ts` (pure, no "use server", no prisma). `classifyFood(food): 'protein'|'carbs'|'fat'|'misc'` — caloric-share dominance (p*4,c*4,f*9); top share **≥0.45 AND exceeds 2nd by ≥0.12pp** → that macro, else `misc`; all-null/zero-total → `misc` (UXR-lib-07/08, threshold tunable — comment it ⚠). `resolveItemMacrosPure(query, libraryFoods)` — sync local resolve, zero round-trip (UXR-lib-09). Extract `scaleMacros` from `food-actions.ts` into here and re-import there (no behavior change). Unit-pure, fully typed.
**Files:** `src/lib/food-resolve-local.ts` (new), `src/lib/food-actions.ts` (import scaleMacros from new file).

## REQ-002 — LibraryPickerOverlay + useFoodComposer "Browse library" · M · dep REQ-001
NEW `src/components/LibraryPickerOverlay.tsx`: `fixed inset-0` NON-dialog overlay (mirror ScanFoodSheet's pattern — NOT a 2nd `<dialog>`; UXR-lib-02/23). Search input (client filter), macro-group segmented tabs (All/Protein/Carbs/Fat/Misc, `role=radiogroup`, ≥44px, TargetsBuilder pattern), grouped rows (macros + usage + dominant-macro **letter** badge via classifyFood; null → "—"/"mixed · data incomplete"), `[+]` per row (≥44px) → caller's onFoodPlus → existing ScanFoodSheet confirm + mergeFoodIntoForm. testIDs per PRD/§7. MODIFY `src/components/useFoodComposer.tsx`: accept `libraryFoods` prop; add "Browse library" control (≥44px) next to chips; mount LibraryPickerOverlay alongside `{sheet}`; `[+]` reuses existing `setScanFoodInitial`+`setScanOpen`; wire `onMacrosChanged`/flash hook. Overlay slide reuses existing keyframes; reduced-motion no-op.
**Files:** `LibraryPickerOverlay.tsx` (new), `useFoodComposer.tsx`.

## REQ-003 — MealComposer enriched header (projected vs today) · M · dep REQ-001
MODIFY `src/components/MealComposer.tsx`: accept `trackedSoFar?: DayMacros` + `dayTarget?: DayMacros|null` props. Enriched sticky header: `so far + this meal = projected / target` line, **remaining** read (budget framing, "−N over target" words on overshoot), size-24 **Bullseye** projected fill `(trackedSoFar+thisMeal)/target` using the REAL `progressToRings` (reconcile ring-rounding, UXR-lib-10); no-target variant (hollow + "No plan set — showing what's been logged", no projected/over line). Extend existing `flashMacros` to fire on the food-add path (UXR-lib-16). Preview only when ≥1 resolvable item. Bullseye `role=img` + aria-label. Do NOT alter the existing create/edit save/delete/recompute logic.
**Files:** `MealComposer.tsx` (+ `globals.css` for macro-flash add-path/tab-fade, REQ-005).

## REQ-004 — Day-strip Bullseye + Nutrition page data threading · S · dep REQ-001
MODIFY `src/components/NutritionToday.tsx`: add size-20 Bullseye + "X remaining" to the Day-total strip when `targetPositive`; honest no-target variant (UXR-lib-05). MODIFY `src/app/nutrition/page.tsx`: compute `trackedTodayMacros` (reduce today's logs via `@/lib/calendar` dateKey + `nutrition-macros.ts` sums) + `dayTargetMacros` (from `resolveDay(now).nutritionPlan`); thread `trackedSoFar`/`dayTarget`/`libraryFoods` into MealComposer (create) + day strip. Reuse `src/lib/nutrition-macros.ts` (`sumLoggedDayMacros`/`sumPlanTargetMacros`/`remainingMacros`/`hasAnyMacros`).
**Files:** `NutritionToday.tsx`, `src/app/nutrition/page.tsx`.

## REQ-005 — FoodLibraryManager manage-mode + globals.css + MoreSheet · M · dep REQ-001
MODIFY `src/components/FoodLibraryManager.tsx`: collapsed-row macro line (data already in props, UXR-lib-24), macro-group segmented tabs (`role=radiogroup`), dominant-macro **letter** badge (classifyFood; derive badge bg via `color-mix`/token opacity — NO literals, UXR-lib-13), honest null rows. Keep Edit/Delete intact. MODIFY `src/app/globals.css`: extend `macro-flash` to the add path; add a tab-content fade class reusing `stale-flag-in`; reduced-motion no-ops (UXR-lib-15..19). MODIFY `src/components/MoreSheet.tsx`: Nutrition subtitle nudge (UXR-lib-25). **AA fix across all touched UI**: small muted 10/11px labels on cream → 12px bold or `--foreground` (UXR-lib-11/12).
**Files:** `FoodLibraryManager.tsx`, `globals.css`, `MoreSheet.tsx`.

## REQ-006 — QA gate (regression-first) · validation
tsc/lint/build; 390px smoke of the full add-from-library loop + day strip + manager grouping + no-target degradation; **REGRESSION: existing create + edit + scan + chips + recompute meal flows byte-identical**; USER_TZ + override-aware audit; AA-contrast + ring-rounding checks. iOS overlay gate flagged for the user's device.
