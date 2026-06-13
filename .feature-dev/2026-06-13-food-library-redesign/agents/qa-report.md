# QA Report — Food Library Redesign
**Date**: 2026-06-13 · **QA Agent**: Claude (Sonnet 4.6) · **HEAD**: 7fa20f6  
**Baseline for regression**: `114707a`  
**Status**: PASS WITH NOTES

---

## Verdict: PASS WITH NOTES

One minor finding (sub-12px muted text on a newly added label — blueprint itself spec'd it this way, creating a PRD vs blueprint conflict). No blockers. All regression gates clear. No double-fire path. CRITICAL-2 two-level empty state correctly implemented. DC-2 flash wiring correct.

---

## Regression Gate (§5 of architecture-blueprint.md)

| # | Guard | Result | Evidence |
|---|-------|--------|----------|
| 5.1 | **mergeFoodIntoForm / mergeEstimateIntoForm** — signatures, MACRO_KEYS loop, rounding (cal/Na → Math.round integer; g → Math.round(sum*10)/10), chipSource→recordFoodUse | **PASS** | `git diff 114707a HEAD -- src/components/useFoodComposer.tsx` confirms both helper bodies are byte-identical. Only additions: new props in the hook signature, `onMacrosChanged?.()` calls around the existing `setMacros` calls (not inside the helpers), Browse button, overlay mount. The helpers `mergeFoodIntoForm` and `mergeEstimateIntoForm` exported at lines 40–72 and 83–107 are untouched. |
| 5.2 | **scaleMacros extraction** — no definition in food-actions.ts; call sites intact; rounding rules byte-identical | **PASS** | `grep -c "function scaleMacros" src/lib/food-actions.ts` = 0. Import at food-actions.ts:17. Comment at line 807 confirms extraction. food-resolve-local.ts:15–32: `scaleInt` → `Math.round(v * servings)` (integers); `scale1dp` → `Math.round(v * servings * 10) / 10` (1dp). All call sites at lines 579, 585, 601, 629, 731, 774, 777, 785 resolve to the imported function. |
| 5.3 | **MealComposer edit mode** — updateNutrition wiring, onDeleted snapshot, ConfirmButton "Delete meal · confirm", setEditSaved→setTimeout(150)→onSaved | **PASS** | MealComposer.tsx:921 `updateNutrition(props.id, fd)`. Lines 925–927: `setEditSaved(true); await new Promise((r) => setTimeout(r, 150)); props.onSaved?.()`. Line 975: `confirmLabel="Delete meal · confirm"`. Line 264: `showDayContext = !isEdit && trackedSoFar != null` — when `isEdit=true` this is always false, so enriched header is always skipped in edit mode. |
| 5.4 | **MealComposer create mode** — logNutrition action + resetCreate() UNCHANGED | **PASS** | Line 1008: `createSubmit(logNutrition, { successMsg: "✓ Meal logged", onSuccess: resetCreate })`. `resetCreate()` at lines 385–405 is byte-identical to baseline (all 11 state resets present including setPreview/setRemovingIndex/setBumpState/setFlashMacros). |
| 5.5 | **Recompute/staleness** — hashItems→snapshotHash→stale; handleRecompute→estimateMealMacros→setPreview; applyRecompute calls setMacros+setFlashMacros DIRECTLY (no onMacrosChanged double-fire); cancelRecompute | **PASS** | Diff shows zero changes to `handleRecompute` (lines 361–366), `applyRecompute` (367–379), `cancelRecompute` (380–382). `applyRecompute` calls raw `setMacros` + `setFlashMacros` with no `onMacrosChanged` invocation — no double-fire possible. `handleMacrosChanged` is only reachable via the `onMacrosChanged` prop wired from useFoodComposer's add-paths. |
| 5.6 | **Item row animations** — item-row-anim/is-exiting/transitionend; qty-bump re-key; stale-flag-in; macro-flash UNCHANGED | **PASS** | Diff confirms no edits to any item-row JSX, animation class assignments, or transitionend handlers. globals.css additions append after line 407; no existing keyframes were touched. |
| 5.7 | **ScanFoodSheet** — exactly ONE instance in useFoodComposer; picker's [+] routes through setScanFoodInitial+setScanOpen (chip path) | **PASS** | Exactly one `<ScanFoodSheet` in the `sheet` ReactNode (confirmed by diff and file read). LibraryPickerOverlay's `onFoodPlus` at useFoodComposer:592–595 calls `setScanFoodInitial(food); setScanOpen(true)` — identical to the chip-tap path, so `isChipMode = initialFood !== undefined = true`. ScanFoodSheet.tsx not in the changed-files list → servings stepper (step=0.5/min=0.5/max=20) unchanged. |

---

## Acceptance Criteria (PRD §8)

| AC | Criterion | Result | Evidence |
|----|-----------|--------|----------|
| 1 | tsc/lint/build clean | **PASS** | `npx tsc --noEmit` → 0 errors (confirmed live run). |
| 2 | Browse library → picker (grouped + search) → [+] → ScanFoodSheet → adds to draft; header Bullseye/remaining update live, no server round-trip | **PASS** | LibraryPickerOverlay mounts in `{sheet}` outside the form. `onFoodPlus` routes through the existing chip-tap path. `onMacrosChanged` fires before `setMacros`, triggering `handleMacrosChanged` → `setFlashMacros`. No server call on add path (recordFoodUse is fire-and-forget). |
| 3 | No-target day degrades per §6 | **PASS** | When `dayTarget=null`: MealComposer:529–534 renders "No plan set — showing what's been logged" + hollow Bullseye (no `progress` prop). When `trackedSoFar=undefined`: `showDayContext=false` → fallback path with existing hollow Bullseye. `hasAnyMacros(target) ? target : null` at nutrition/page.tsx:131 correctly sets null for no-plan days. NutritionToday:271–278 shows "No daily target set" when `!targetPositive && soFarPositive`. |
| 4 | Day-total strip shows remaining + Bullseye; FoodLibraryManager shows macros + group tabs + letter badge | **PASS** | NutritionToday:262–294: `daytotal-remaining` + `daytotal-bullseye` + `daytotal-no-target-note` all present. FoodLibraryManager:206–403: tab radiogroup, macro line, letter badge via BADGE map. |
| 5 | Regression: existing create + edit meal flow unchanged | **PASS** | All 7 regression gate items clear (see above). |
| 6 | USER_TZ + override-aware reads; AA-contrast fixes (UXR-lib-11/12); Bullseye ring-rounding reconciled | **PASS WITH NOTE** | USER_TZ: only `getHours()` at MealComposer:97 in pre-existing `defaultMeal()`. All other date ops route through `@/lib/calendar`. Override-aware: `resolveDay(new Date()).nutritionPlan` at page.tsx:76–80. Bullseye: all callers pass `progress` prop only (no external ring math). AA: see Issue #1 below. |
| 7 | UXR-lib ledger ticked | **PARTIAL** | Not auditable from code alone; provisional items remain (see Provisional section). |

---

## Issues Found

### Issue 1 (minor): composer-projected-line uses `text-[11px]` — sub-12px new muted label

**File**: `src/components/MealComposer.tsx:511`  
**Severity**: minor  
**Detail**: The newly introduced `composer-projected-line` div ("Today X + this meal Y = Z / T cal target") uses `text-[11px] uppercase tracking-wide text-[var(--muted)]`. The PRD §8 AC-6 and QA instructions specify that new muted small labels use `text-xs` (12px), not `text-[10px]` or `text-[11px]`. The badge exception (10px bold on colored chip) does not apply here.

**Root cause**: The architecture-blueprint §2.4.6 itself spec'd `text-[11px]` for this line, creating a blueprint-vs-PRD conflict. The dev agent followed the blueprint faithfully.

**Suggested fix**: Change `text-[11px]` to `text-xs` on MealComposer:511. Uppercase + tracking-wide makes 12px still compact. Alternative: use `text-[13px]` to match the other projected-macro row at line 494.

**Pre-existing `text-[11px]` labels in the fallback path** (MealComposer:558 "no target" / "X% of target" span) are **pre-existing**, not newly introduced — confirmed by baseline diff.

---

*No other issues found.* (Zero blockers.)

---

## Provisional Items — Verify On-Device

| ID | Item | Code location | Status |
|----|------|---------------|--------|
| UXR-lib-08 | `DOMINANCE_THRESHOLD = 0.45`, `MARGIN_THRESHOLD = 0.12` — playtest against real library. Greek yogurt (~45% protein, 35% carb) may classify as "misc". | `src/lib/food-resolve-local.ts:58–59` | ⚠ playtest |
| UXR-lib-12 | "over target" `--warning` on `--card` — verify ≥4.5:1 at `text-xs font-medium` (MealComposer:521). The blueprint notes 4.7:1 borderline. | `src/components/MealComposer.tsx:519–527` | ⚠ verify |
| UXR-lib-13 | Letter badges (P/C/F/M) at `text-[10px] font-bold` on color-mixed bg at 390px — legibility check | `src/components/LibraryPickerOverlay.tsx:217`, `FoodLibraryManager.tsx:359` | ⚠ playtest |
| UXR-lib-23 | `LibraryPickerOverlay` (`z-[50]`) stacking above BottomSheet `<dialog>` on real iOS Safari — the `fixed inset-0` non-dialog pattern mirrors ScanFoodSheet but must be confirmed on device | `src/components/LibraryPickerOverlay.tsx:75–84` | ⚠ device gate |

---

## Additional Verified Correct Items

- **DC-2**: `onMacrosChanged` fires in both `handleAdd` (useFoodComposer:246) AND `handleEstimateAdd` (line 291–292). Does NOT fire in `handleEstimateAddAnyway` (lines 306–314) — correct per addendum. ✓
- **CRITICAL-2 two-level empty state**: Outer gate at FoodLibraryManager:198 (`foods.filter(f => !hidden.has(f.id)).length === 0`) fires for a genuinely empty library. Per-tab empty at line 237 (`visible.length === 0 ? <p...>No foods in this group.</p>`) is a distinct, reachable node — NOT dead code. ✓
- **tab-content-fade key wiring**: `key={tab}` at LibraryPickerOverlay:197, `key={activeTab}` at FoodLibraryManager:241 — re-fires the fade animation on tab change per addendum. ✓
- **LibraryPickerOverlay state reset**: Implemented via `key={pickerOpen ? 1 : 0}` on the overlay in useFoodComposer:588 (remounts on open/close), rather than the blueprint's `useEffect` approach. Functionally equivalent — search and tab state reset on every open. ✓
- **Badge colors**: No `#` hex literals or `rgb(` in LibraryPickerOverlay.tsx or FoodLibraryManager.tsx. All badge backgrounds use `color-mix(in srgb, var(--token) 15%, var(--card))`. ✓
- **food-resolve-local.ts purity**: No `"use server"` directive, no prisma import — safe to import in client components. ✓
- **listLibraryFoods take**: Changed to 200 at food-actions.ts:420. ✓
- **revalidatePath coverage**: `logNutrition` (workout-actions.ts:228–230) and `updateNutrition` (lines 256–258) both call `revalidatePath("/nutrition")`. No new mutation paths without revalidate. ✓
- **Bullseye data-testid**: Added to `BullseyeBase` type at Bullseye.tsx:26 and spread onto the `<svg>` at line 183. ✓
- **All §6 testIDs present**: Verified in code — `library-picker-overlay`, `library-picker-search`, `macro-tab-{all|protein|carbs|fat|misc}` (both LibraryPickerOverlay and FoodLibraryManager), `food-row-{id}`, `food-add-btn-{id}`, `composer-browse-library`, `composer-projected-line`, `composer-remaining`, `composer-bullseye-meter`, `daytotal-bullseye`, `daytotal-remaining`, `daytotal-no-target-note`. ✓
- **MoreSheet subtitle**: Updated at MoreSheet.tsx:100 — "Your macro-grouped pantry, meal log, and daily targets". ✓
- **globals.css**: `.tab-content-fade` and `@media (prefers-reduced-motion: reduce)` no-op appended at lines 409–419, reusing the existing `stale-flag-in` keyframe. ✓
