# Architecture Critique — Food Library Redesign
**Date**: 2026-06-13 · **Reviewer**: Devil's Advocate (Claude Sonnet 4.6)  
**Target**: `.feature-dev/2026-06-13-food-library-redesign/agents/architecture-blueprint.md`  
**Real-code basis**: MealComposer.tsx, useFoodComposer.tsx, ScanFoodSheet.tsx, Bullseye.tsx, FoodLibraryManager.tsx, NutritionToday.tsx, nutrition/page.tsx, LogNutritionForm.tsx, LogLauncher.tsx, MealEditButton.tsx, NutritionList.tsx, BottomSheet.tsx, food-types.ts, nutrition-macros.ts, food-actions.ts, globals.css

---

## Critical Issues

### CRITICAL-1: `Bullseye` does not accept `data-testid` — confirmed TypeScript blocker

**WHAT**: `BullseyeProps` is `BullseyeBase & BullseyeA11y & BullseyeFill` where `BullseyeBase` is `{ size?: number; className?: string; style?: CSSProperties }`. The component destructures only those named fields; the SVG element is rendered without a rest-spread. There is no `data-testid` in the type and no spread to the DOM element.

The blueprint uses `data-testid` on Bullseye in four places:
- `data-testid="composer-bullseye-meter"` in `MealComposer` enriched header (×2 branches)
- `data-testid="daytotal-bullseye"` in `NutritionToday` day-total strip (×2 branches)

**WHY**: These will produce TypeScript type errors. `tsc --noEmit` (the Stream C gate) will FAIL. Additionally, even if TypeScript were silenced, the test IDs never reach the DOM — they are silently dropped — so the testID reference table in blueprint §6 (`composer-bullseye-meter`, `daytotal-bullseye`) cannot be verified by QA automation.

**HOW TO FIX**: One of:
1. Add `"data-testid"?: string` to `BullseyeBase` and wire it: `<svg ... data-testid={props["data-testid"]}>`. Clean, keeps the ID on the SVG itself.
2. Wrap the `<Bullseye>` in a `<span data-testid={...} style={{ display: "contents" }}>`. Works but the wrapping element shows up in the DOM.

Option 1 is preferred — three-line change to `Bullseye.tsx`.

**SEVERITY**: CRITICAL — breaks `tsc --noEmit` gate; Stream C cannot merge without this fix.

---

### CRITICAL-2: `FoodLibraryManager` empty-state guard — dev-agent trap producing wrong empty state

**WHAT**: The current `FoodLibraryManager` has a single early return at line 172:
```typescript
if (visible.length === 0) {
  return <p>Scanned and estimated foods will appear here.</p>;
}
```

The blueprint adds tab-based filtering to `visible`. After that change, `visible.length === 0` is true for two distinct cases:
1. The whole library is empty (correct empty state: "Scanned and estimated foods…")
2. The selected tab (e.g., "Protein") has no foods in it (correct empty state: "No foods in this group.")

The blueprint's instruction says to "add [the tab bar] between the early-return check and the `<ul>`". If the dev agent follows this literally, the existing `if (visible.length === 0)` guard fires FIRST for BOTH cases, always showing the library-empty message — even when the library has 50 foods and the user just picked the "Carbs" tab and has no carb-heavy foods.

The blueprint's code snippet for the tab bar does show `if (visible.length === 0 && activeTab === "all")` as a new guard, but the instruction doesn't say to REPLACE the old guard — it says to add code "between" them, which leaves both guards active, making the new one unreachable.

**WHY**: A dev agent following the blueprint literally will produce:
- `if (visible.length === 0)` → always fires when tab is empty → wrong empty state message
- New `if (visible.length === 0 && activeTab === "all")` → unreachable dead code

**HOW TO FIX**: Be explicit: **REPLACE** line 172–178 (`if (visible.length === 0)`) with `if (visible.length === 0 && activeTab === "all")`. The "No foods in this group" empty state is already in the blueprint's main return (inside the list area): `{visible.length === 0 ? <p>No foods in this group.</p> : ...}`.

**SEVERITY**: CRITICAL — guaranteed incorrect UX; the dev agent will produce a component where switching to a macro tab and getting zero results shows a misleading library-empty message.

---

## Design Concerns

### DC-1: `tab-content-fade` CSS class — defined but no wiring shown

**WHAT**: Blueprint §2.9 adds `.tab-content-fade { animation: stale-flag-in 130ms ease-out; }` to globals.css. Blueprint §2.8 says "Apply to the list area whenever the active tab changes." No JSX code in §2.8 shows how to attach the class.

**WHY**: Without wiring, the class is dead CSS and the tab-switch fade never fires. The correct implementation requires either:
- A React `key={activeTab}` on the list wrapper (forces remount on tab change, replaying the entry animation)
- Or a manual class toggle using `useState` + `onAnimationEnd` to remove the class after it fires

Neither is specified in the blueprint. The Stream C dev agent will likely skip the animation entirely.

**SEVERITY**: LOW — purely cosmetic; no functional regression. The class is unused but not harmful.

---

### DC-2: Estimate add path intentionally excluded from `onMacrosChanged` / flashMacros

**WHAT**: The `handleEstimateAdd` and `handleEstimateAddAnyway` functions in `useFoodComposer` call `setMacros` directly. They are NOT wired through `onMacrosChanged`. When the user adds a food via the estimate "Enter" → "Add" path, the macro numerals in the MealComposer header will NOT flash.

**WHY**: The blueprint explicitly calls out: "Fired after a food add merges into macros (chip, scan, OR picker path)." The estimate path is intentionally excluded. PRD REQ-003 says "extend flashMacros to the add path" — the blueprint interprets "add path" as chip/scan/picker only. If the estimate path flash is desired, `handleEstimateAdd` must also call `onMacrosChanged?.(macros, merged.macroValues)` after computing `merged` and before calling `setMacros(merged.macroValues)`.

**SEVERITY**: MEDIUM — UXR-lib-16 intent is partially implemented. Either document the exclusion in the PR or extend the wiring. If the estimate path is a primary add path for users who don't scan, the gap is noticeable.

---

### DC-3: `handleMacrosChanged` placement relies on JS hoisting — code smell

**WHAT**: The blueprint places `handleMacrosChanged` definition AFTER `resetCreate` (line 346+), but it is referenced in the `useFoodComposer` call at lines 232–249:
```typescript
const { controls, sheet } = useFoodComposer({
  ...
  onMacrosChanged: handleMacrosChanged,  // ← referenced before definition
});
```

**WHY**: In JavaScript, `function` declarations are hoisted within their scope, so this compiles and runs correctly. It is NOT a bug. However, it is unusual code organization that will surprise reviewers. Moving `handleMacrosChanged` to BEFORE the `useFoodComposer` call site (e.g., right after `applyRecompute`, which is thematically related) makes the code order-of-reading clearer.

**SEVERITY**: LOW — style concern, not a bug.

---

### DC-4: Two divergent `soFar` calculations driving two different Bullseyes

**WHAT**: 
- The composer enriched header on `/nutrition` page uses `trackedSoFar = sumLoggedDayMacros(todayRows)` — strict logged-only, null fields treated as 0, no plan fallback.
- The `NutritionToday` day-total strip uses its own `soFar` which falls back to `planned.macros` when a logged meal has no recorded macros: `const src = r.actualMacros ?? r.planned?.macros`.

So if a user logs "chicken and rice" with no macro estimate, the `/nutrition` page composer Bullseye treats it as 0 calories contributed, while the `NutritionToday` day-strip Bullseye treats it as the planned macro for that slot.

**WHY**: Blueprint §0 explicitly acknowledges this: "Use its own soFar for the Day-total strip Bullseye — do NOT add new server props." It's a deliberate choice to avoid adding server props to NutritionToday. However, the user will see two Bullseyes on two different pages that disagree. PRD §6 documents the edge case: "Meal logged without estimate contributes 0 to trackedSoFar (per-meal macros only; documented)."

**SEVERITY**: LOW — documented, intentional. Worth a QA note: these two Bullseyes are NOT expected to agree when meals lack macro estimates.

---

### DC-5: `macroLine` formatting inconsistency between picker overlay and library manager

**WHAT**: `LibraryPickerOverlay.macroLine` formats as `"250 cal · P 30 · C 15 · F 8"`.  
`FoodLibraryManager` collapsed row formats as `"250 cal · 30p · 15c · 8f"`.

**WHY**: Both surfaces show per-serving macros for the same food library. The label format differs (leading letter label vs trailing letter suffix). Users who compare the picker to the manager will notice inconsistency.

**SEVERITY**: LOW — cosmetic only. Recommend standardizing on one format, preferably the `FoodLibraryManager` format (shorter, established pattern).

---

### DC-6: Browse library not available in LogLauncher or edit sheets — intentional gap

**WHAT**: `LogLauncher.tsx` line 184: `<LogNutritionForm />` (no props). `NutritionToday.tsx` line 259: `<LogNutritionForm />` (no props). Both pass no `libraryFoods`, so "Browse library" button never appears in these surfaces. Users logging from the Log overlay (BottomNav) or from the Today page cannot use the library picker.

**WHY**: The blueprint explicitly limits the feature to the `/nutrition` page's create form. This is a deliberate scope choice (PRD §1.2 names the composer as the target). However, `LogLauncher` is likely the primary meal-logging surface for mobile users (it's the BottomNav quick-log). The Browse library benefit may largely bypass daily users.

**SEVERITY**: MEDIUM design concern — not a defect, but worth a product question before ship. If the answer is "yes, LogLauncher should have it", the page-level RSC query for `libraryFoods` needs to also reach the layout server component that feeds LogLauncher.

---

## Verified Correct (not bugs)

**Issue 1 (MealComposer caller regression)**: All existing callers are safe. New props are optional. Browse library button guards on `libraryFoods && libraryFoods.length > 0`. Edit mode callers (MealEditButton, NutritionList) do not pass `libraryFoods` → button suppressed. `showDayContext = !isEdit && trackedSoFar != null` correctly gates enriched header for all existing callers. No byte-level regression.

**Issue 2 (Dialog/overlay stacking)**: `ScanFoodSheet` already runs as `fixed inset-0 z-[55]` inside the BottomSheet's `<dialog showModal()>`. The BottomSheet uses `createPortal` to document.body, and `showModal()` puts the dialog in the browser top layer. Inside the top layer, `fixed` children are positioned relative to the viewport and z-index ordering among siblings works normally. The existing ScanFoodSheet chip-flow ALREADY works inside the BottomSheet dialog (this is the production code path). `LibraryPickerOverlay` (`z-[50]`) mirrors the exact same pattern. Stacking order: picker (50) < scan sheet (55). Verified blueprint assumption is VALID. iOS device test remains a hard gate (UXR-lib-23) but is flagged correctly.

**Issue 3 (Double-flash airtight)**: `applyRecompute()` calls `setMacros` and `setFlashMacros` DIRECTLY, NOT via `useFoodComposer`. `onMacrosChanged` fires ONLY from `handleAdd`. These are two separate code paths with no shared trigger. No double-fire possible on the recompute Apply path. ✓

**Issue 4 (`classifyFood` null/zero/partial)**: Verified. `total = pKcal + cKcal + fKcal` (from grams only, not from calories field). All-null → total=0 → "misc". All-zero → total=0 → "misc". Calories-only (null P/C/F) → total=0 → "misc". Single macro non-null → correctly classifies. Division guarded by `if (total === 0)`. Never throws. ✓

**Issue 5 (`trackedSoFar` scope)**: `/nutrition/page.tsx` correctly uses `dateKey(new Date())` (USER_TZ) to bucket today's rows. `sumLoggedDayMacros` reads only already-committed DB logs. The in-progress draft in the composer is NOT in the DB. No double-count. After "Log meal" → `revalidatePath("/nutrition")` → page refresh → `trackedSoFar` updates. ✓

**Issue 6 (`scaleMacros` extraction / client-safe)**: `food-resolve-local.ts` imports from `@/lib/food-types` (no "use server", no Prisma) and `@/lib/nutrition-log-ops` (head -30 verified: only `zod` imports, no server directive). The extraction is a clean boundary. `food-actions.ts` ("use server") re-imports `scaleMacros` from the pure module — server→pure is valid. Client components → pure module is valid. No circular dependency. ✓

**Issue 7 (`progressToRings` verified)**: Real implementation: `max = size < 10 ? 1 : size < 14 ? 2 : size < 20 ? 3 : 4; rings = (p===0) ? 0 : max(1, ceil(p * max))`. At size 20 and 24: max=4. Boundary check: p=0.25 → ceil(1.0)=1 ring; p=0.26 → ceil(1.04)=2 rings. Blueprint's ring table is correct. Pass `progress` prop and trust `progressToRings` — no external ring computation needed. ✓

**Issue 8 (USER_TZ + override-aware)**: `dayTarget` computed from `resolveDay(new Date()).nutritionPlan` — override-aware via `@/lib/calendar`. `trackedSoFar` uses `dateKey(new Date())` — USER_TZ. No raw date primitives. ✓

---

## Missing / Unaddressed

1. **`Bullseye` type extension not in scope list** — Blueprint §1 (File Plan) does not list `src/components/Bullseye.tsx` as a MODIFY target, but CRITICAL-1 requires a 3-line change to it. Stream C must add Bullseye.tsx to its file list. If missed, tsc gate fails.

2. **`tab-content-fade` application** — Blueprint §2.8 and §2.9 define the CSS class but provide no JSX snippet showing HOW to apply it. `key={activeTab}` on the list wrapper is the simplest correct implementation. Blueprint should specify this or the animation ships as dead CSS.

3. **`LibraryFoodRow` vs `LibraryFood` passed through as picker foods** — `listLibraryFoods()` returns `LibraryFoodRow[]` (extends `LibraryFood`). The page passes it as `libraryFoods` (typed as `LibraryFood[]` in the component chain). TypeScript structural typing accepts this. BUT: when `LibraryPickerOverlay.onFoodPlus(food: LibraryFood)` fires, the `usageCount`/`lastUsedAt` fields are stripped in the type, though they remain on the runtime object. `ScanFoodSheet` only uses `LibraryFood` fields. This is a type narrowing precision loss, not a runtime bug. ✓ Noted for awareness.

4. **No explicit `resetCreate` interaction with `pickerOpen`** — `resetCreate()` in MealComposer does NOT reset `pickerOpen` (which lives in `useFoodComposer`). After "Log meal" calls `resetCreate()`, if the picker was open it stays open behind the cleared form. This is a minor UX rough edge. A `useEffect` that closes the picker when `items` is empty after a successful create submit would help, but is not critical.

5. **`LibraryPickerOverlay` is NOT dynamically imported** — `ScanFoodSheet` is dynamically imported via `next/dynamic { ssr: false }` because it uses `zxing-wasm` (browser-only). `LibraryPickerOverlay` has no browser-only deps. However, if it imports `classifyFood` from `food-resolve-local.ts`, and `food-resolve-local.ts` ever gains a browser-only dep, this could become an SSR issue. Current imports are pure — no issue. The blueprint correctly omits `dynamic()` for `LibraryPickerOverlay`. ✓

---

## Risk Table

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `data-testid` tsc error (CRITICAL-1) | **Certain** | HIGH — tsc gate fails | Add `data-testid?` to BullseyeBase, wire to SVG |
| FoodLibraryManager empty-state bug (CRITICAL-2) | **Certain** | MEDIUM — wrong UX on tab-filter empty | Explicitly REPLACE line 172-178 guard in blueprint |
| `tab-content-fade` never applied | High | LOW — dead CSS, no animation | Add `key={activeTab}` example to blueprint §2.8 |
| Estimate add path missing flashMacros | Medium | LOW — users notice no flash on estimate adds | Intentional; document or extend to estimate path |
| iOS Safari overlay stacking regression | Medium | HIGH — picker invisible or dialog closes on iOS | Hard gate: device test before merge to main |
| `logLauncher` users can't access Browse library | Certain | MEDIUM — feature invisible to quick-log users | Product decision needed before ship |
| Two-Bullseye soFar divergence | Certain (by design) | LOW — minor confusing UX | Documented in PRD §6; acceptable |
| Macro-format inconsistency picker vs manager | Medium | LOW — cosmetic | Standardize on one format |

---

## Verdict

**NEEDS REVISION**

Criticals to resolve before dev agents proceed:

1. **CRITICAL-1** (`data-testid` on Bullseye): Add `"data-testid"?: string` to `BullseyeBase` in `Bullseye.tsx`, pass it to the `<svg>` element, and add `Bullseye.tsx` to Stream C's file ownership list. Without this, `tsc --noEmit` fails and QA testIDs are dead.

2. **CRITICAL-2** (FoodLibraryManager empty-state guard): Change the FoodLibraryManager instruction from "add between the early-return check and the `<ul>`" to explicitly **REPLACE** the existing `if (visible.length === 0)` early return at lines 172-178 with `if (visible.length === 0 && activeTab === "all")`. The "No foods in this group" empty state for non-all tabs is in the main return's list section — make this structure explicit.

Non-blocking but recommended before merge:
- DC-2: Decide whether estimate-add path should trigger flashMacros; document the exclusion in the PR.
- DC-3: Move `handleMacrosChanged` declaration above the `useFoodComposer` call for readability.
- Missing §2: Add explicit `key={activeTab}` on the list wrapper in the FoodLibraryManager tab-bar code to activate `tab-content-fade`.
- DC-6: Product decision on whether LogLauncher users should have Browse library access.

The overall architecture is sound. The dialog/overlay stacking concern (Issue 2) is a verified non-issue — the existing ScanFoodSheet chip-flow already runs in this exact configuration. The extraction, classification, and enriched-header math are all correct. The two Critical issues are both narrow, fixable in minutes each.
