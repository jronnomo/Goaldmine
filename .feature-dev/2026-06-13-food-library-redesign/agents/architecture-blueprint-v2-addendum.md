# Blueprint Addendum (v2) — Devil's Advocate fixes

Read AFTER `architecture-blueprint.md`. These OVERRIDE/extend it. Verdict was NEEDS REVISION; two criticals + three minors resolved here.

## CRITICAL-1 — Bullseye must accept `data-testid` (tsc blocker) → Stream A
`Bullseye.tsx`'s prop type does NOT include `data-testid`, so the blueprint's four `<Bullseye data-testid=...>` usages (composer-bullseye-meter ×2, daytotal-bullseye ×2) FAIL `tsc`.
**Fix (Stream A owns this, foundational so B+C can rely on it):** in `src/components/Bullseye.tsx`, add `"data-testid"?: string` to the base prop type and spread/wire it onto the rendered root `<svg data-testid={...}>`. Do NOT change any rendering/`progressToRings` logic. Stream A's file set becomes: `food-resolve-local.ts` (new), `food-actions.ts`, **`Bullseye.tsx` (data-testid only)**.

## CRITICAL-2 — FoodLibraryManager empty-state guard → Stream C
The existing early return `if (visible.length === 0) return <p>Scanned and estimated foods…</p>` (≈L172) must become a TWO-LEVEL guard so a per-tab empty doesn't show the "library is empty" copy:
- **REPLACE** the existing early-return so it only fires for a genuinely empty library: `if (foods.filter(f => !hidden.has(f.id)).length === 0) return <p>Scanned and estimated foods will appear here.</p>` (i.e. gate on the un-tab-filtered set, NOT `visible`).
- Then render the tab bar, and inside, when the tab-filtered `visible.length === 0`, show the distinct `<p className="italic">No foods in this group.</p>`. Both states must be reachable — the per-tab empty must NOT be dead code.

## DC-2 (minor) — estimate-add should also flash → Stream B
The blueprint wires `onMacrosChanged` only into `handleAdd` (chip/scan/picker). For consistency, also call `onMacrosChanged?.(macros, merged.macroValues)` (before `setMacros`) inside `handleEstimateAdd` so the header numerals flash on the estimate-add path too. (Do NOT add it to `handleEstimateAddAnyway` — that path adds no macros.)

## DC-6 (accepted, document it) — Browse-library scope
`libraryFoods` is threaded only into the `/nutrition` create composer. The Log-sheet create form and the edit sheets (MealEditButton/NutritionList) pass no `libraryFoods`, so the "Browse library" button does NOT appear there — they keep the quick-pick chips + scan + estimate (unchanged). This is intentional for v1 (the `/nutrition` page is the "build a meal vs today" surface; threading the full 200-row library through the global layout for every page is out of scope). The Browse-library button is gated on `libraryFoods && libraryFoods.length > 0`, so its absence is clean (no empty/broken control). Document in the completion report.

## Minor — tab-content-fade wiring → Streams B + C
The `.tab-content-fade` class needs `key={activeTab}` on the list wrapper so the opacity fade re-fires on tab change. Apply `<div className="tab-content-fade" key={tab}>` (picker, Stream B) and `<div className="tab-content-fade" key={activeTab}>` (FoodLibraryManager list, Stream C) around the respective `<ul>`.

## Confirmed correct (no change): dialog stacking (fixed-inset overlay above BottomSheet `<dialog>` — but ⚠ the iOS device gate UXR-lib-23 still stands), double-flash separation (applyRecompute stays direct; add-path via onMacrosChanged), classifyFood null/zero→misc, trackedSoFar per-meal/today/no-double-count, scaleMacros extraction zero-behavior-change + client-safe, ring-rounding `ceil(p*4)` at size≥20, color-mix badges, AA 12px fixes.
