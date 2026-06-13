# Architecture Blueprint — Food Library Redesign
**Date**: 2026-06-13 · **Architect**: Claude (Sonnet 4.6) · **Branch**: main  
**PRD**: `docs/prds/PRD-food-library-redesign.md` · **Research**: `docs/ux-research/food-library-redesign.md`  
**Status**: READY FOR PARALLEL DEV — Stream A must land before B and C begin.

---

## 0. Ground Truth Verified (read before modifying anything)

| Claim | Verified finding |
|-------|-----------------|
| `scaleMacros` in food-actions.ts | **Private** function at line 810 — NOT exported. Must be extracted to `food-resolve-local.ts` and re-imported. |
| `progressToRings` | Module-private in `Bullseye.tsx` line 135. Formula: `max(1, ceil(p * max))` where `max=4` for size≥20. **Mockup was wrong** — see Decision 1. |
| `useFoodComposer` return | `{ controls: ReactNode; sheet: ReactNode }`. Controls renders chips + estimate strip. Sheet renders ONE `<ScanFoodSheet>`. |
| `MealComposerProps.plannedTarget` | `number | undefined` (per-slot calorie target). Distinct from the new `dayTarget: DayMacros | null` (full-day). Both coexist. |
| `LogNutritionForm` | Thin wrapper: `<MealComposer mode="create" quickPickFoods={...} />` only. All new props must thread through it. |
| `/nutrition/page.tsx` | Already computes `soFar: DayMacros` (line 125) and `target: DayMacros` (line 126) using `nutrition-macros.ts`. Already fetches `libraryFoods`. Pass all three down. |
| `NutritionToday` | Has its own internal `soFar`/`target` computation with a planned-fallback variant (line 152–158). Use its own soFar for the Day-total strip Bullseye — do NOT add new server props. |
| `ScanFoodSheet` chip mode | `isChipMode = initialFood !== undefined`. Opens confirm phase directly. "Add to meal" fires `onAdd(payload)` then `onClose()`. EXACTLY ONE instance. |
| `FoodLibraryManager` row | Lines 271–305 collapsed row. Renders name, meta (brand·servingSize), usageCount+lastUsedAt. No macro line currently. |
| `globals.css` keyframes | `bullseye-pop`, `level-up-burst`, `undo-bar-in`, `stale-flag-in`, `qty-bump`, `macro-flash`, `item-row-anim`. All have `@media (prefers-reduced-motion)` no-ops. No new keyframes needed. |
| `NutritionToday` callers | `/` (Today page) passes logs via RSC and calls `<NutritionToday logs=... plan=... />`. `LogNutritionForm` inside NutritionToday has NO props — safe because all new MealComposer props are optional. |

---

## 1. File Plan

| Action | Path | REQ | Purpose | Key exports / change points |
|--------|------|-----|---------|---------------------------|
| **CREATE** | `src/lib/food-resolve-local.ts` | REQ-001 | Pure client-safe helpers: classifyFood, resolveItemMacrosPure, scaleMacros | `export classifyFood`, `export resolveItemMacrosPure`, `export scaleMacros` |
| **MODIFY** | `src/lib/food-actions.ts` | REQ-001 | Extract private `scaleMacros` to food-resolve-local and re-import | Line 810: delete private fn body; add `import { scaleMacros } from "@/lib/food-resolve-local"` at top |
| **CREATE** | `src/components/LibraryPickerOverlay.tsx` | REQ-002 | `fixed inset-0` non-dialog picker overlay (mirrors ScanFoodSheet's overlay pattern) | `export LibraryPickerOverlay` |
| **MODIFY** | `src/components/useFoodComposer.tsx` | REQ-002 | Add `libraryFoods` + `onMacrosChanged` props; Browse-library button in `{controls}`; overlay + scan sheet both in `{sheet}` | Props interface (line 167–178); controls block (line 304+); sheet block (line 538+) |
| **MODIFY** | `src/components/MealComposer.tsx` | REQ-003 | Enriched header: `trackedSoFar`/`dayTarget` props; projected fill line + remaining + size-24 Bullseye; flashMacros add-path via `onMacrosChanged` callback | `MealComposerProps` union (line 56–72); sticky header div (line 386–510); `useFoodComposer` call (line 232–249) |
| **MODIFY** | `src/components/LogNutritionForm.tsx` | REQ-003/004 | Thread new props down to MealComposer | Props interface + JSX (entire file, ~24 lines) |
| **MODIFY** | `src/app/nutrition/page.tsx` | REQ-004 | Compute `dayTargetMacros: DayMacros \| null`; thread `libraryFoods`, `trackedTodayMacros`, `dayTargetMacros` into LogNutritionForm | Lines 124–126 (reuse soFar/target); line 148 (LogNutritionForm props) |
| **MODIFY** | `src/components/NutritionToday.tsx` | REQ-004 | Add size-20 Bullseye + "X cal remaining" to the Day-total strip | Lines 231–253 (showTotal block): import Bullseye; add calFill/calRemaining derived values; add Bullseye + remaining to strip JSX |
| **MODIFY** | `src/components/FoodLibraryManager.tsx` | REQ-005 | Macro-group segmented tabs + per-row macro line + letter badge | Line 106 component props; line 107–111 state; line 112 visible filter; line 270–305 collapsed row |
| **MODIFY** | `src/app/globals.css` | REQ-005 | Add `.tab-content-fade` (reuses `stale-flag-in` keyframe) and reduced-motion no-op | Append after line 407 |
| **MODIFY** | `src/components/MoreSheet.tsx` | REQ-005 | Update Nutrition subtitle to the library purpose statement | `navRows` array (line 99–103): change `sub` field |

---

## 2. Component Contracts

### 2.1 `src/lib/food-resolve-local.ts` (NEW)

No `"use server"`. No Prisma. Safe to import in both client and server code.

```typescript
// ── Imports ──────────────────────────────────────────────────────────────────
import type { FoodMacros, LibraryFood } from "@/lib/food-types";
import type { NutritionItem } from "@/lib/nutrition-log-ops";

// ── scaleMacros (extracted from food-actions.ts line 810) ────────────────────
/**
 * Scale a per-serving FoodMacros by a servings multiplier.
 * Extracted from food-actions.ts (was private) to allow client-side use.
 * food-actions.ts re-imports this function — behavior is IDENTICAL.
 *
 * Rounding rules (unchanged):
 *   calories, sodiumMg → Math.round (integer)
 *   proteinG, carbsG, fatG, fiberG → Math.round(v * s * 10) / 10 (1dp)
 */
export function scaleMacros(perServing: FoodMacros, servings: number): FoodMacros {
  function scaleInt(v: number | null): number | null {
    if (v == null) return null;
    return Math.round(v * servings);
  }
  function scale1dp(v: number | null): number | null {
    if (v == null) return null;
    return Math.round(v * servings * 10) / 10;
  }
  return {
    calories:  scaleInt(perServing.calories),
    proteinG:  scale1dp(perServing.proteinG),
    carbsG:    scale1dp(perServing.carbsG),
    fatG:      scale1dp(perServing.fatG),
    fiberG:    scale1dp(perServing.fiberG),
    sodiumMg:  scaleInt(perServing.sodiumMg),
  };
}

// ── classifyFood ─────────────────────────────────────────────────────────────
export type MacroGroup = "protein" | "carbs" | "fat" | "misc";

/**
 * Classify a library food by caloric-share dominance.
 *
 * Algorithm:
 *   pKcal = proteinG * 4
 *   cKcal = carbsG   * 4
 *   fKcal = fatG     * 9
 *   total = pKcal + cKcal + fKcal
 *
 * If total === 0 or all null → "misc"
 * Top macro wins if:
 *   (1) its share ≥ DOMINANCE_THRESHOLD (≥ 45% of total kcal)
 *   (2) its share exceeds the 2nd-place share by ≥ MARGIN_THRESHOLD (≥ 12pp)
 * Otherwise → "misc"
 *
 * ⚠ PLAYTEST THRESHOLDS against the real library. If too many foods land in
 * "misc" (e.g. Greek yogurt at ~45% protein, 35% carb) reduce DOMINANCE_THRESHOLD
 * to 0.40. If too many false positives (trail mix classified as carbs), raise to 0.50.
 * See UXR-lib-08.
 */
// ⚠ Tunable — see comment above before changing (UXR-lib-08).
const DOMINANCE_THRESHOLD = 0.45; // top macro must hold ≥45% of kcal
const MARGIN_THRESHOLD    = 0.12; // top macro must lead 2nd by ≥12pp

export function classifyFood(
  food: Pick<LibraryFood, "perServing">
): MacroGroup {
  const p = food.perServing.proteinG;
  const c = food.perServing.carbsG;
  const f = food.perServing.fatG;

  const pKcal = p != null ? p * 4 : 0;
  const cKcal = c != null ? c * 4 : 0;
  const fKcal = f != null ? f * 9 : 0;
  const total  = pKcal + cKcal + fKcal;

  if (total === 0) return "misc"; // all-null or zero-calorie

  const shares = [
    { macro: "protein" as MacroGroup, share: pKcal / total },
    { macro: "carbs"   as MacroGroup, share: cKcal / total },
    { macro: "fat"     as MacroGroup, share: fKcal / total },
  ].sort((a, b) => b.share - a.share);

  const top    = shares[0]!;
  const second = shares[1]!;

  if (
    top.share >= DOMINANCE_THRESHOLD &&
    (top.share - second.share) >= MARGIN_THRESHOLD
  ) {
    return top.macro;
  }
  return "misc";
}

// ── resolveItemMacrosPure ────────────────────────────────────────────────────
/**
 * Resolve draft macro totals from a list of NutritionItems against the local
 * food library (sync, zero server round-trip). Used for "estimated preview"
 * when items were typed manually rather than added via chip/picker (where
 * mergeFoodIntoForm already accumulates exact macros).
 *
 * Matching: case-insensitive exact name match against LibraryFood.name.
 * Servings: parses the leading number from item.qty (e.g. "2 servings" → 2,
 *   "300 g" → 3 if food.basis="100g"). Defaults to 1 when not parseable.
 * Items with no library match contribute nulls (skipped in sum).
 * Returns FoodMacros where null means no item contributed a value for that field.
 *
 * NOT called on the hot-path chip/picker/scan add (those use mergeFoodIntoForm).
 * Called when the user switches from raw-text mode to structured view (staleness
 * resolution) or as a sanity-check after text edits.
 */
export function resolveItemMacrosPure(
  items: NutritionItem[],
  libraryFoods: LibraryFood[]
): FoodMacros {
  // Build a name→food lookup (case-insensitive).
  const byName = new Map<string, LibraryFood>();
  for (const food of libraryFoods) {
    byName.set(food.name.toLowerCase(), food);
  }

  const acc = {
    calories: null as number | null,
    proteinG: null as number | null,
    carbsG:   null as number | null,
    fatG:     null as number | null,
    fiberG:   null as number | null,
    sodiumMg: null as number | null,
  };

  for (const item of items) {
    const food = byName.get(item.name.toLowerCase());
    if (!food) continue;

    const servings = parseServingsFromQty(item.qty, food.basis);
    const scaled   = scaleMacros(food.perServing, servings);

    for (const key of ["calories", "proteinG", "carbsG", "fatG", "fiberG", "sodiumMg"] as const) {
      const v = scaled[key];
      if (v == null) continue;
      acc[key] = (acc[key] ?? 0) + v;
    }
  }

  return acc;
}

/** Extract a leading number from a qty string as a servings count.
 *  "2 servings" → 2, "300 g" with basis "100g" → 3, "1.5" → 1.5.
 *  Falls back to 1 when not parseable. */
function parseServingsFromQty(qty: string | undefined, basis: "serving" | "100g"): number {
  if (!qty) return 1;
  const m = qty.match(/^(\d+(?:\.\d+)?)/);
  if (!m) return 1;
  const n = parseFloat(m[1]!);
  if (!isFinite(n) || n <= 0) return 1;
  // 100g basis: qty is in grams → servings = grams / 100
  return basis === "100g" ? n / 100 : n;
}
```

**food-actions.ts import change** — add at the top of the file (near existing imports):
```typescript
import { scaleMacros } from "@/lib/food-resolve-local";
```
Delete lines 810–827 (the private `function scaleMacros(...) { ... }` body) verbatim.

> VERIFY: run `grep -n "scaleMacros" src/lib/food-actions.ts` before and after; call-sites at lines 578, 584, 600, 628, 730, 773, 776, 784 must all resolve to the imported function.

---

### 2.2 `LibraryPickerOverlay.tsx` (NEW)

```typescript
"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { Bullseye } from "@/components/Bullseye"; // only if needed in row
import { classifyFood, type MacroGroup } from "@/lib/food-resolve-local";
import type { LibraryFood } from "@/lib/food-types";

// ── Types ─────────────────────────────────────────────────────────────────────

export type LibraryPickerOverlayProps = {
  open: boolean;
  onClose: () => void;
  /** Pre-loaded library foods passed from the page RSC (top-N by usage). */
  libraryFoods: LibraryFood[];
  /**
   * Called when the user taps [+] on a food row.
   * useFoodComposer receives this and calls setScanFoodInitial(food) + setScanOpen(true),
   * which opens the existing ScanFoodSheet confirm phase — the chip-tap path.
   * The overlay STAYS OPEN while ScanFoodSheet is on top.
   */
  onFoodPlus: (food: LibraryFood) => void;
};

// ── Badge helpers ─────────────────────────────────────────────────────────────

const BADGE: Record<MacroGroup, { letter: string; bg: string; fg: string }> = {
  protein: {
    letter: "P",
    // ⚠ color-mix: NO literals. --target is the red token.
    bg: "color-mix(in srgb, var(--target) 15%, var(--card))",
    fg: "var(--target)",
  },
  carbs: {
    letter: "C",
    bg: "color-mix(in srgb, var(--success) 15%, var(--card))",
    fg: "var(--success)",
  },
  fat: {
    letter: "F",
    bg: "color-mix(in srgb, var(--accent) 15%, var(--card))",
    fg: "var(--accent)",
  },
  misc: {
    letter: "M",
    bg: "color-mix(in srgb, var(--muted) 15%, var(--card))",
    fg: "var(--muted)",
  },
};

const TABS: { key: MacroGroup | "all"; label: string }[] = [
  { key: "all",     label: "All"     },
  { key: "protein", label: "Protein" },
  { key: "carbs",   label: "Carbs"   },
  { key: "fat",     label: "Fat"     },
  { key: "misc",    label: "Misc"    },
];

// ── Macro display for rows (typed numerals, not micro-bar — UXR-lib-14) ───────

function macroLine(food: LibraryFood): string {
  const p = food.perServing;
  const hasAny =
    p.calories != null || p.proteinG != null || p.carbsG != null || p.fatG != null;
  if (!hasAny) return "mixed · data incomplete";
  const parts: string[] = [];
  if (p.calories != null) parts.push(`${p.calories} cal`);
  if (p.proteinG != null) parts.push(`P ${p.proteinG}`);
  if (p.carbsG   != null) parts.push(`C ${p.carbsG}`);
  if (p.fatG     != null) parts.push(`F ${p.fatG}`);
  return parts.join(" · ");
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * LibraryPickerOverlay — `fixed inset-0` NON-dialog overlay.
 *
 * Structural guarantee: NOT a <dialog>. Mirrors ScanFoodSheet's overlay pattern
 * to avoid the iOS Safari double-dialog dismiss bug. z-[50] sits below
 * ScanFoodSheet (z-[55]) so the scan stepper renders on top correctly.
 *
 * Mounted by useFoodComposer in its {sheet} return — OUTSIDE the host <form>.
 * Escape handled via document keydown (same as ScanFoodSheet).
 * When open=false, returns null (no DOM, no event listeners).
 */
export function LibraryPickerOverlay({
  open,
  onClose,
  libraryFoods,
  onFoodPlus,
}: LibraryPickerOverlayProps) {
  const [search, setSearch] = useState("");
  const [tab, setTab]       = useState<MacroGroup | "all">("all");

  // Escape key handling (same pattern as ScanFoodSheet)
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });
  useEffect(() => {
    if (!open) return;
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); onCloseRef.current(); }
    }
    document.addEventListener("keydown", handler, { capture: true });
    return () => document.removeEventListener("keydown", handler, { capture: true });
  }, [open]);

  // Reset state on open
  useEffect(() => {
    if (open) { setSearch(""); setTab("all"); }
  }, [open]);

  // Client-side filter (no server round-trip — UXR-lib-01)
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return libraryFoods.filter((f) => {
      if (tab !== "all" && classifyFood(f) !== tab) return false;
      if (!q) return true;
      return (
        f.name.toLowerCase().includes(q) ||
        (f.brand?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [libraryFoods, search, tab]);

  if (!open) return null;

  return (
    // Scrim — click outside panel to close (target===currentTarget guard, same as ScanFoodSheet)
    <div
      data-testid="library-picker-overlay"
      className="fixed inset-0 z-[50] bg-black/45"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Panel — mirrors ScanFoodSheet panel CSS exactly */}
      <div
        className="absolute bottom-0 left-0 right-0 mx-auto max-w-md flex flex-col max-h-[85vh]"
        style={{ background: "var(--card)", borderTopLeftRadius: "1rem", borderTopRightRadius: "1rem" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2 border-b border-[var(--border)]">
          <h2 className="text-base font-semibold text-[var(--foreground)]">Food library</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close food library"
            className="inline-flex items-center justify-center w-9 h-9 rounded-full text-[var(--muted)] hover:text-[var(--foreground)]"
          >
            ✕
          </button>
        </div>

        {/* Search */}
        <div className="px-4 pt-3 pb-2">
          <input
            data-testid="library-picker-search"
            type="search"
            placeholder="Search foods…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            // AA fix: 12px bold min for contrast on cream (UXR-lib-11)
            className="w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm min-h-[44px]"
          />
        </div>

        {/* Macro-group tabs — role=radiogroup, ≥44px (UXR-lib-01, TargetsBuilder pattern) */}
        <div
          role="radiogroup"
          aria-label="Filter by macro type"
          className="flex gap-1 overflow-x-auto px-4 pb-2 [-webkit-overflow-scrolling:touch]"
        >
          {TABS.map(({ key, label }) => {
            const selected = tab === key;
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`macro-tab-${key}`}
                onClick={() => setTab(key)}
                className={`flex-shrink-0 min-h-[44px] px-3 rounded-full text-xs font-semibold transition-colors ${
                  selected
                    ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                    : "border border-[var(--border)] text-[var(--muted)]"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Food list — scrollable */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-[env(safe-area-inset-bottom)]">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--muted)]">
              {search ? `No foods matching "${search}"` : "No foods in this group."}
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {filtered.map((food) => {
                const group    = classifyFood(food);
                const badge    = BADGE[group];
                const mLine    = macroLine(food);
                const isNull   = mLine === "mixed · data incomplete";
                const metaParts = [food.brand, food.servingSize].filter(Boolean);
                return (
                  <li
                    key={food.id}
                    data-testid={`food-row-${food.id}`}
                    className="flex items-center gap-2 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium truncate">{food.name}</p>
                        {/* Letter badge — ship letter first, not dot (UXR-lib-13) */}
                        {/* AA fix: badge text ≥12px bold against its bg (UXR-lib-11) */}
                        <span
                          className="shrink-0 text-[10px] font-bold uppercase rounded px-1 py-0.5 leading-none"
                          style={{ background: badge.bg, color: badge.fg }}
                          aria-hidden // decorative — macro group shown in tab
                        >
                          {badge.letter}
                        </span>
                      </div>
                      {metaParts.length > 0 && (
                        // AA fix: 12px (text-xs) not 10px (UXR-lib-11)
                        <p className="text-xs text-[var(--muted)] truncate">
                          {metaParts.join(" · ")}
                        </p>
                      )}
                      {/* Typed macro numerals — NOT micro-bar (UXR-lib-14) */}
                      <p className={`text-xs ${isNull ? "italic" : ""} text-[var(--muted)]`}>
                        {mLine}
                      </p>
                    </div>
                    {/* [+] — ≥44px tap target (UXR-lib-03) */}
                    <button
                      type="button"
                      data-testid={`food-add-btn-${food.id}`}
                      aria-label={`Add ${food.name} to meal`}
                      onClick={() => onFoodPlus(food)}
                      className="flex-shrink-0 flex items-center justify-center w-11 h-11 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] text-xl font-bold"
                    >
                      +
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
```

---

### 2.3 `useFoodComposer.tsx` — Changes

**Exact current interface to replace** (lines 167–178):
```typescript
// CURRENT (lines 167-178) — replace entirely with the block below
export function useFoodComposer({
  itemsText,
  setItemsText,
  macros,
  setMacros,
  quickPickFoods,
}: {
  itemsText: string;
  setItemsText: (s: string) => void;
  macros: MacroValues;
  setMacros: (m: MacroValues) => void;
  quickPickFoods?: LibraryFood[];
}): { controls: ReactNode; sheet: ReactNode }
```

**New interface**:
```typescript
export function useFoodComposer({
  itemsText,
  setItemsText,
  macros,
  setMacros,
  quickPickFoods,
  libraryFoods,
  onMacrosChanged,
}: {
  itemsText: string;
  setItemsText: (s: string) => void;
  macros: MacroValues;
  setMacros: (m: MacroValues) => void;
  quickPickFoods?: LibraryFood[];
  /** Pre-loaded library foods for the Browse-library picker. */
  libraryFoods?: LibraryFood[];
  /**
   * Fired after a food add merges into macros (chip, scan, OR picker path).
   * MealComposer uses this to trigger flashMacros on the add path (UXR-lib-16).
   * Args: the macros BEFORE the merge and the macros AFTER.
   */
  onMacrosChanged?: (prev: MacroValues, next: MacroValues) => void;
}): { controls: ReactNode; sheet: ReactNode }
```

**New import at top of file**:
```typescript
import { LibraryPickerOverlay } from "@/components/LibraryPickerOverlay";
```

**New state** (add after line 199, after `scanFoodInitial` state):
```typescript
// Picker overlay state
const [pickerOpen, setPickerOpen] = useState(false);
```

**handleAdd change** (lines 224–247) — add `onMacrosChanged` call after `setMacros`:
```typescript
function handleAdd(payload: AddFoodPayload) {
  const { food, chipSource } = payload;
  const merged = mergeFoodIntoForm(itemsText, macros, payload);
  setItemsText(merged.itemsText);
  // Fire onMacrosChanged BEFORE setMacros so caller sees old→new (UXR-lib-16)
  onMacrosChanged?.(macros, merged.macroValues);
  setMacros(merged.macroValues);
  if (chipSource) {
    recordFoodUse(food.id).catch(() => {});
  }
  if (!chipSource) {
    setLocalAdditions((prev) => {
      const without = prev.filter((f) => f.id !== food.id);
      return [food, ...without];
    });
  }
}
```

**"Browse library" control** — add AFTER the chips row (before the estimate add-item row, inside `controls` ReactNode). Only render when `libraryFoods` is provided and non-empty:
```typescript
{/* Browse library button — only when library foods are available */}
{libraryFoods && libraryFoods.length > 0 && (
  <button
    type="button"
    data-testid="composer-browse-library"
    onClick={() => setPickerOpen(true)}
    className="flex items-center gap-1.5 rounded-full px-3 min-h-[44px]
               border border-[var(--border)] text-[var(--accent)] text-sm font-medium self-start"
  >
    {/* ☰ or a grid icon — decorative, SR reads button label */}
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
    Browse library
  </button>
)}
```
Placement: between the chips `</div>` and the estimate `<div className="flex flex-col gap-1.5">`.

**sheet return** — replace line 538–548 (current `const sheet: ReactNode = <ScanFoodSheet .../>`) with:
```typescript
const sheet: ReactNode = (
  <>
    <ScanFoodSheet
      open={scanOpen}
      onClose={() => {
        setScanOpen(false);
        setScanFoodInitial(undefined);
      }}
      onAdd={handleAdd}
      initialFood={scanFoodInitial}
    />
    {/* LibraryPickerOverlay — z-[50] sits below ScanFoodSheet z-[55].
        [+] in the overlay sets scanFoodInitial (chip-tap path) — ONE ScanFoodSheet. */}
    <LibraryPickerOverlay
      open={pickerOpen}
      onClose={() => setPickerOpen(false)}
      libraryFoods={libraryFoods ?? []}
      onFoodPlus={(food) => {
        setScanFoodInitial(food);
        setScanOpen(true);
        // Picker stays open behind ScanFoodSheet so user can add more.
      }}
    />
  </>
);
```

---

### 2.4 `MealComposer.tsx` — Changes

#### 2.4.1 Updated Props Type

**Current** (lines 56–72):
```typescript
export type MealComposerProps =
  | {
      mode: "create";
      quickPickFoods?: LibraryFood[];
      plannedTarget?: number;
    }
  | {
      mode: "edit";
      id: string;
      defaults: MealDefaults;
      quickPickFoods?: LibraryFood[];
      plannedTarget?: number;
      onSaved?: () => void;
      onDeleted?: (snapshot: MealDeleteSnapshot) => void;
    };
```

**Replace with**:
```typescript
/** Shared optional props for day-level context (create mode primary; edit gracefully ignores). */
type DayContextProps = {
  /**
   * Today's already-logged macro total (from RSC). When present, the header shows
   * the projected fill: (trackedSoFar + thisMeal) / dayTarget.
   * When absent (edit mode, NutritionToday's embedded form, etc.), the header
   * degrades to the existing single-meal readout. NO behavior regression.
   */
  trackedSoFar?: DayMacros;
  /**
   * Today's plan target (null when no plan is set).
   * null → hollow Bullseye + "No plan set — showing what's been logged".
   * undefined → not provided (same degraded behavior as null for the header).
   */
  dayTarget?: DayMacros | null;
  /** Pre-loaded library foods for the Browse-library picker. Passed to useFoodComposer. */
  libraryFoods?: LibraryFood[];
};

export type MealComposerProps =
  | ({
      mode: "create";
      quickPickFoods?: LibraryFood[];
      plannedTarget?: number;
    } & DayContextProps)
  | ({
      mode: "edit";
      id: string;
      defaults: MealDefaults;
      quickPickFoods?: LibraryFood[];
      plannedTarget?: number;
      onSaved?: () => void;
      onDeleted?: (snapshot: MealDeleteSnapshot) => void;
    } & DayContextProps);
```

**New import** at top of MealComposer.tsx:
```typescript
import type { DayMacros } from "@/lib/nutrition-macros";
```

#### 2.4.2 Extract DayContextProps fields at component top

Add after line 149 (`const plannedTarget = props.plannedTarget`):
```typescript
const trackedSoFar  = props.trackedSoFar;
const dayTarget     = props.dayTarget;
const libraryFoods  = props.libraryFoods;
```

#### 2.4.3 New derived values for enriched header

Add after the `meterPct` computation (after line 229), before the useFoodComposer call:
```typescript
// ── Day-projected header (REQ-003) ────────────────────────────────────────────
// Only shown in create mode, when day context was provided, and draft has items.
const thisMealCal  = macros.calories  ?? 0;
const thisMealProt = macros.proteinG  ?? 0;
const thisMealCarbs = macros.carbsG   ?? 0;
const thisMealFat  = macros.fatG      ?? 0;

const hasItems = effectiveItems.length > 0;

// "showDayProjected": create mode + caller provided trackedSoFar + dayTarget.
// dayTarget may be null (no plan) — that's the "hollow + honest" path below.
const showDayContext =
  !isEdit && trackedSoFar != null;

const projectedCal = showDayContext
  ? trackedSoFar!.calories + thisMealCal
  : null;
const projectedProt = showDayContext
  ? trackedSoFar!.proteinG + thisMealProt
  : null;
const projectedCarbs = showDayContext
  ? trackedSoFar!.carbsG + thisMealCarbs
  : null;
const projectedFat = showDayContext
  ? trackedSoFar!.fatG + thisMealFat
  : null;

// Bullseye progress for the enriched header.
// Only compute when dayTarget is present and positive.
const dayTargetCal = dayTarget?.calories ?? 0;
const projectedProgress =
  showDayContext && dayTarget != null && dayTargetCal > 0 && hasItems
    ? Math.max(0, Math.min(1, projectedCal! / dayTargetCal))
    : null;

// Remaining: positive = budget, negative = over.
// Over-target uses words, never color alone (UXR-lib-20, a11y).
const remainingCal =
  showDayContext && dayTarget != null && projectedCal != null
    ? dayTargetCal - projectedCal!   // may be negative (over)
    : null;
const isOver = remainingCal != null && remainingCal < 0;
```

#### 2.4.4 onMacrosChanged callback for flashMacros add path (UXR-lib-16)

Add after `resetCreate` definition (after line 346), before `unmatchedNames`:
```typescript
// Flash macro numerals on the food-add path (UXR-lib-16).
// Compares prev vs next to find which keys changed, then fires flashMacros.
// This fires from useFoodComposer.handleAdd via the onMacrosChanged prop.
// applyRecompute() continues to set flashMacros directly — no double-fire because
// applyRecompute calls the raw setMacros (not via useFoodComposer).
function handleMacrosChanged(prev: MacroValues, next: MacroValues) {
  const changed = new Set<string>();
  for (const k of FLASHABLE_MACROS) {
    if ((prev[k] ?? null) !== (next[k] ?? null)) changed.add(k);
  }
  if (changed.size > 0) {
    setFlashMacros({ keys: changed, n: Date.now() });
  }
}
```

#### 2.4.5 useFoodComposer call — add new props

**Current** (lines 232–249):
```typescript
const { controls, sheet } = useFoodComposer({
  itemsText,
  setItemsText: (next: string) => { ... },
  macros,
  setMacros,
  quickPickFoods,
});
```

**Replace with**:
```typescript
const { controls, sheet } = useFoodComposer({
  itemsText,
  setItemsText: (next: string) => {
    const parsed = parseItemsText(next);
    if (rawMode) setRawText(next);
    else setItems(parsed);
    setSnapshotHash(hashItems(parsed));
  },
  macros,
  setMacros,
  quickPickFoods,
  libraryFoods,
  onMacrosChanged: handleMacrosChanged,
});
```

#### 2.4.6 Enriched sticky header — replacement block

**REMOVE** lines 379–510 (the entire `<div className="sticky top-0 z-10...">` block down through its closing `</div>`).

**INSERT** in its place:

```typescript
{/* ── Macro summary / projected header ──────────────────────────────────────
    Sticky (UXR-meal-edit-14/29). Accent-soft-over-card wash.
    In create mode WITH day context: shows projected fill + remaining.
    All other modes (edit, no context): existing single-meal readout.
    ⚠ verify on iOS Safari with keyboard open — fallback = Direction C route. */}
<div
  className="sticky top-0 z-10 rounded-xl border border-[var(--border)] px-4 py-3"
  style={{
    background: "linear-gradient(var(--accent-soft), var(--accent-soft)), var(--card)",
  }}
>
  {showDayContext && hasItems ? (
    /* ── ENRICHED: projected vs today (REQ-003) ──────────────────────── */
    <>
      {/* Hero row: projected calories + size-24 Bullseye */}
      <div className="flex items-center gap-3">
        <div className="flex items-baseline gap-1">
          <span className="font-mono text-[28px] font-semibold leading-none text-[var(--foreground)]">
            {/* Flash on the thisMeal calories change (UXR-lib-16) */}
            {flashNumeral("calories", projectedCal ?? macros.calories)}
          </span>
          <span className="text-[13px] text-[var(--muted)]">cal</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {projectedProgress != null ? (
            <Bullseye
              size={24}
              progress={projectedProgress}
              aria-label={`Projected ${Math.round(projectedProgress * 100)}% of daily target`}
              data-testid="composer-bullseye-meter"
            />
          ) : (
            /* No target: hollow */
            <Bullseye
              size={24}
              aria-label="No daily target set"
              data-testid="composer-bullseye-meter"
            />
          )}
        </div>
      </div>
      {/* Macro P/C/F row */}
      <div className="mt-1 font-mono text-[13px] text-[var(--foreground)]">
        <span className="text-[var(--muted)]">P</span>{" "}
        {flashNumeral("proteinG", projectedProt)}{" "}
        <span className="mx-1 text-[var(--muted)]">·</span>
        <span className="text-[var(--muted)]">C</span>{" "}
        {flashNumeral("carbsG", projectedCarbs)}{" "}
        <span className="mx-1 text-[var(--muted)]">·</span>
        <span className="text-[var(--muted)]">F</span>{" "}
        {flashNumeral("fatG", projectedFat)}
      </div>

      {dayTarget != null ? (
        /* HAS TARGET: show full projected line + remaining */
        <>
          {/* "so far + this meal = projected / target" line */}
          <div
            data-testid="composer-projected-line"
            className="mt-2 text-[11px] uppercase tracking-wide text-[var(--muted)]"
          >
            Today {Math.round(trackedSoFar!.calories)}{" "}
            + this meal {Math.round(thisMealCal)}{" "}
            = {Math.round(projectedCal!)} / {Math.round(dayTargetCal)} cal target
          </div>
          {/* Remaining / over */}
          <div
            data-testid="composer-remaining"
            className={`mt-1 text-xs font-medium ${
              isOver ? "text-[var(--warning)]" : "text-[var(--muted)]"
            }`}
          >
            {isOver
              ? `−${Math.round(Math.abs(remainingCal!))} over target`
              : `${Math.round(remainingCal!)} cal remaining`}
          </div>
        </>
      ) : (
        /* NO TARGET: honest degraded note */
        <p className="mt-2 text-xs text-[var(--muted)] italic">
          No plan set — showing what&apos;s been logged
        </p>
      )}
    </>
  ) : (
    /* ── FALLBACK: existing single-meal readout ───────────────────────── */
    /* This path runs for: edit mode, create with no day context, empty draft. */
    <>
      <div className="flex items-center gap-3">
        <div className="flex items-baseline gap-1">
          <span className="font-mono text-[28px] font-semibold leading-none text-[var(--foreground)]">
            {flashNumeral("calories", macros.calories)}
          </span>
          <span className="text-[13px] text-[var(--muted)]">cal</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Bullseye
            size={24}
            {...(showMeter
              ? {
                  progress: meterPct,
                  "aria-label": `Meal macros at ${Math.round(meterPct * 100)} percent of target`,
                }
              : { "aria-label": "No macro target set" })}
            data-testid="composer-bullseye-meter"
          />
          <span className="max-w-[92px] text-[11px] leading-tight text-[var(--muted)]">
            {showMeter ? `${Math.round(meterPct * 100)}% · of target` : "no target"}
          </span>
        </div>
      </div>
      <div className="mt-2 font-mono text-[13px] text-[var(--foreground)]">
        <span className="text-[var(--muted)]">P</span> {flashNumeral("proteinG", macros.proteinG)}{" "}
        <span className="mx-1 text-[var(--muted)]">·</span>
        <span className="text-[var(--muted)]">C</span> {flashNumeral("carbsG", macros.carbsG)}{" "}
        <span className="mx-1 text-[var(--muted)]">·</span>
        <span className="text-[var(--muted)]">F</span> {flashNumeral("fatG", macros.fatG)}
      </div>
      {showDayContext && !hasItems && (
        <p className="mt-2 text-xs text-[var(--muted)]">
          Add items to see projected totals
        </p>
      )}
    </>
  )}

  {/* ── Staleness flag + recompute — UNCHANGED (do not modify) ─────────── */}
  {stale && (
    <div
      className="stale-flag-in mt-3 flex flex-wrap items-center gap-2.5"
      aria-live="polite"
    >
      <span
        data-testid="macro-stale-flag"
        className="flex items-center gap-1.5 text-sm font-medium text-[var(--warning)]"
      >
        {/* Warning triangle SVG — unchanged from original */}
        <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
          <path d="M8 1.2l6.6 12.2H1.4L8 1.2z" />
          <rect x="7.3" y="6" width="1.4" height="4" fill="var(--card)" />
          <rect x="7.3" y="11" width="1.4" height="1.4" fill="var(--card)" />
        </svg>
        Macros may be stale — items changed
      </span>
      <button
        type="button"
        data-testid="macro-recompute"
        onClick={handleRecompute}
        disabled={recomputing || effectiveItems.length === 0}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--accent-soft)] px-3 py-2 text-[13px] font-semibold text-[var(--accent)] disabled:opacity-50"
      >
        ⟳ {recomputing ? "Recomputing…" : "Recompute from items"}
      </button>
    </div>
  )}

  {/* ── Recompute preview — UNCHANGED (do not modify) ──────────────────── */}
  {preview && (
    <div
      className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5"
      aria-live="polite"
    >
      <p className="sr-only">
        Recompute preview: {matchedCount} item{matchedCount === 1 ? "" : "s"} matched,{" "}
        {preview.unmatchedCount} item{preview.unmatchedCount === 1 ? "" : "s"} with no estimate.
      </p>
      <p className="text-xs font-medium text-[var(--muted)]">Proposed totals</p>
      <p className="mt-1 font-mono text-[13px] text-[var(--foreground)]">
        {macroNum(preview.totals.calories)} cal
        <span className="mx-1 text-[var(--muted)]">·</span>P {macroNum(preview.totals.proteinG)}
        <span className="mx-1 text-[var(--muted)]">·</span>C {macroNum(preview.totals.carbsG)}
        <span className="mx-1 text-[var(--muted)]">·</span>F {macroNum(preview.totals.fatG)}
      </p>
      {preview.unmatchedCount > 0 && (
        <p className="mt-1.5 text-sm font-medium text-[var(--warning)]">
          {preview.unmatchedCount} item{preview.unmatchedCount === 1 ? "" : "s"} had no estimate
          {unmatchedNames.length > 0 && (
            <span className="font-normal text-[var(--muted)]"> — {unmatchedNames.join(", ")}</span>
          )}
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          data-testid="macro-recompute-apply"
          onClick={applyRecompute}
          className="flex-1 rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-fg)] min-h-[44px]"
        >
          Apply
        </button>
        <button
          type="button"
          data-testid="macro-recompute-cancel"
          onClick={cancelRecompute}
          className="flex-1 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--foreground)] min-h-[44px]"
        >
          Cancel
        </button>
      </div>
    </div>
  )}
</div>
```

**What must NOT change in MealComposer.tsx:**
- The entire `body` JSX from Items section onward (lines ~512 to 759) — the items list, raw mode toggle, chiprow via `{controls}`, meal-type chips, when nudges, notes, MacroInputs, and both mode-specific form shells.
- The `applyRecompute()` function — it calls `setMacros` + `setFlashMacros` directly. Do NOT route it through `handleMacrosChanged` (would double-fire).
- All state machinery: `snapshotHash`, `stale`, `hashItems`, `effectiveItems`, `removingIndex`, `bumpState`, `flashMacros`.
- The edit form action (`updateNutrition`), the create form action (`logNutrition`), `resetCreate()`, `onDeleted` snapshot.
- `{sheet}` placement (OUTSIDE the `<form>` in both branches).

---

### 2.5 `LogNutritionForm.tsx` — Full Replacement

Replace the entire file (currently 24 lines):

```typescript
"use client";

import { MealComposer } from "@/components/MealComposer";
import type { LibraryFood } from "@/lib/food-types";
import type { DayMacros } from "@/lib/nutrition-macros";
import {
  mergeFoodIntoForm,
  mergeEstimateIntoForm,
} from "@/components/useFoodComposer";

// Re-export pure helpers so any existing external consumers keep working.
export { mergeFoodIntoForm, mergeEstimateIntoForm };

/**
 * Thin wrapper preserving the LogNutritionForm entry points.
 * New optional props are threaded from /nutrition page RSC to the
 * enriched MealComposer header (REQ-003/004).
 * All callers that pass no new props continue to work — props are optional,
 * MealComposer header degrades gracefully.
 */
export function LogNutritionForm({
  quickPickFoods,
  libraryFoods,
  trackedSoFar,
  dayTarget,
}: {
  quickPickFoods?: LibraryFood[];
  libraryFoods?: LibraryFood[];
  trackedSoFar?: DayMacros;
  dayTarget?: DayMacros | null;
}) {
  return (
    <MealComposer
      mode="create"
      quickPickFoods={quickPickFoods}
      libraryFoods={libraryFoods}
      trackedSoFar={trackedSoFar}
      dayTarget={dayTarget}
    />
  );
}
```

---

### 2.6 `nutrition/page.tsx` — Changes

**New import** (add `hasAnyMacros` to existing nutrition-macros import on line 19):
```typescript
import { sumLoggedDayMacros, sumPlanTargetMacros, hasAnyMacros } from "@/lib/nutrition-macros";
```

**After line 126** (`const target = sumPlanTargetMacros(todayPlan);`), add:
```typescript
// dayTargetMacros: null means "no plan" (honest no-target path in the composer).
// all-zeros from sumPlanTargetMacros also means no plan.
const dayTargetMacros: DayMacros | null = hasAnyMacros(target) ? target : null;
// Alias soFar as trackedTodayMacros for clarity at the call-site.
const trackedTodayMacros: DayMacros = soFar;
```

**New import** (add `DayMacros` type):
```typescript
import type { DayMacros } from "@/lib/nutrition-macros";
```

**Update the LogNutritionForm render** (current line 148):
```typescript
// BEFORE:
<LogNutritionForm quickPickFoods={quickPickFoods} />

// AFTER:
<LogNutritionForm
  quickPickFoods={quickPickFoods}
  libraryFoods={libraryFoods}
  trackedSoFar={trackedTodayMacros}
  dayTarget={dayTargetMacros}
/>
```

> `soFar` is already computed from `todayRows.map((r) => r.macros)` which matches the nutrition-macros.ts `sumLoggedDayMacros` contract. The page already fetches `libraryFoods` via `listLibraryFoods()` in the Promise.all on line 64.

---

### 2.7 `NutritionToday.tsx` — Day-Total Strip Addition

**New import** (add at top):
```typescript
import { Bullseye } from "@/components/Bullseye";
```

**New derived values** — add after line 160 (after `const showTotal = ...`):
```typescript
// Day-strip Bullseye (REQ-004, UXR-lib-05)
// Uses this component's own soFar (which includes planned-fallback) not the page's.
const calFill = targetPositive && target.calories > 0
  ? Math.min(1, soFar.calories / target.calories)
  : 0;
const calRemaining = targetPositive
  ? Math.max(0, target.calories - soFar.calories)
  : 0;
```

**Day-total strip replacement** (lines 231–253 — the `{showTotal && (...)}` block):

Replace the existing inner content of the Day total strip. The existing outer div/span structure stays; only the right-hand content expands:

```typescript
{showTotal && (
  <div className="flex items-center gap-2 border-t border-[var(--border)] pt-2.5 text-sm">
    <span className="w-24 shrink-0 text-xs uppercase tracking-wide font-medium pt-0.5">
      Day total
    </span>
    <div className="flex-1 min-w-0 space-y-0.5">
      <span className="block">
        <span className="text-[10px] uppercase tracking-wide text-[var(--muted)] mr-1 align-middle">
          so far
        </span>
        <span className="tabular-nums font-medium">{formatMacros(soFar)}</span>
      </span>
      {targetPositive && (
        <span className="block text-[var(--muted)]">
          <span className="text-[10px] uppercase tracking-wide mr-1 align-middle">
            target
          </span>
          <span className="tabular-nums">{formatMacros(target)}</span>
        </span>
      )}
      {/* REQ-004: remaining line */}
      {targetPositive && calRemaining > 0 && (
        <span
          data-testid="daytotal-remaining"
          className="block text-xs text-[var(--muted)]"
        >
          {Math.round(calRemaining)} cal remaining
        </span>
      )}
      {/* No-target note */}
      {!targetPositive && soFarPositive && (
        <span
          data-testid="daytotal-no-target-note"
          className="block text-xs italic text-[var(--muted)]"
        >
          No daily target set
        </span>
      )}
    </div>
    {/* Size-20 Bullseye — appended to the right of the strip (UXR-lib-05) */}
    {targetPositive ? (
      <Bullseye
        size={20}
        progress={calFill}
        aria-label={`${Math.round(calFill * 100)}% of daily calorie target reached`}
        data-testid="daytotal-bullseye"
      />
    ) : (
      <Bullseye
        size={20}
        aria-label="No daily calorie target set"
        data-testid="daytotal-bullseye"
      />
    )}
  </div>
)}
```

---

### 2.8 `FoodLibraryManager.tsx` — Changes

**New imports**:
```typescript
import { classifyFood, type MacroGroup } from "@/lib/food-resolve-local";
```

**BADGE map** (add after the `MACRO_FIELDS` array, before the `EditDraft` type):
```typescript
const BADGE: Record<MacroGroup, { letter: string; bg: string; fg: string }> = {
  protein: { letter: "P", bg: "color-mix(in srgb, var(--target) 15%, var(--card))",  fg: "var(--target)"  },
  carbs:   { letter: "C", bg: "color-mix(in srgb, var(--success) 15%, var(--card))", fg: "var(--success)" },
  fat:     { letter: "F", bg: "color-mix(in srgb, var(--accent) 15%, var(--card))",  fg: "var(--accent)"  },
  misc:    { letter: "M", bg: "color-mix(in srgb, var(--muted) 15%, var(--card))",   fg: "var(--muted)"   },
};

const TABS: { key: MacroGroup | "all"; label: string }[] = [
  { key: "all",     label: "All"     },
  { key: "protein", label: "Protein" },
  { key: "carbs",   label: "Carbs"   },
  { key: "fat",     label: "Fat"     },
  { key: "misc",    label: "Misc"    },
];
```

**New state** (add after line 111, after `const [draft, ...`):
```typescript
const [activeTab, setActiveTab] = useState<MacroGroup | "all">("all");
```

**Updated `visible` filter** (replace line 112):
```typescript
// BEFORE: const visible = foods.filter((f) => !hidden.has(f.id));
// AFTER:
const visible = foods.filter((f) => {
  if (hidden.has(f.id)) return false;
  if (activeTab !== "all" && classifyFood(f) !== activeTab) return false;
  return true;
});
```

**Tab bar** — add inside the component return, BEFORE the `<ul>` (add between the early-return check and the `<ul>`):
```typescript
if (visible.length === 0 && activeTab === "all") {
  return (
    <p className="text-sm text-[var(--muted)]">
      Scanned and estimated foods will appear here.
    </p>
  );
}

return (
  <div className="space-y-3">
    {/* Macro-group tabs (role=radiogroup, UXR-lib-06) */}
    <div
      role="radiogroup"
      aria-label="Filter food library by macro type"
      className="flex gap-1 overflow-x-auto [-webkit-overflow-scrolling:touch]"
    >
      {TABS.map(({ key, label }) => {
        const sel = activeTab === key;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={sel}
            onClick={() => setActiveTab(key)}
            className={`flex-shrink-0 min-h-[44px] px-3 rounded-full text-xs font-semibold ${
              sel
                ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                : "border border-[var(--border)] text-[var(--muted)]"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>

    {visible.length === 0 ? (
      <p className="text-sm text-[var(--muted)] italic">
        No foods in this group.
      </p>
    ) : (
      /* Existing <ul> below — wrap it here */
```

Then close the existing `<ul>...</ul>` + `)}</div>`.

**Collapsed row** — replace lines 270–305 (the `const meta =...` / `<li>` block for non-editing rows):

```typescript
const meta = [food.brand, food.servingSize].filter(Boolean).join(" · ");
const group = classifyFood(food);
const badge = BADGE[group];
const p     = food.perServing;
const hasAnyMacro = p.calories != null || p.proteinG != null || p.carbsG != null || p.fatG != null;
const macroLineStr = hasAnyMacro
  ? [
      p.calories != null ? `${p.calories} cal` : null,
      p.proteinG != null ? `${p.proteinG}p`    : null,
      p.carbsG   != null ? `${p.carbsG}c`      : null,
      p.fatG     != null ? `${p.fatG}f`         : null,
    ].filter(Boolean).join(" · ")
  : "— · mixed / data incomplete";

return (
  <li
    key={food.id}
    className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0"
  >
    <div className="min-w-0 flex-1">
      {/* Name + letter badge */}
      <div className="flex items-center gap-1.5">
        <p className="text-sm font-medium truncate">{food.name}</p>
        {/* Letter badge — derive bg via color-mix, no literals (UXR-lib-13) */}
        <span
          className="shrink-0 text-[10px] font-bold uppercase rounded px-1 py-0.5 leading-none"
          style={{ background: badge.bg, color: badge.fg }}
          aria-hidden
        >
          {badge.letter}
        </span>
      </div>
      {/* Brand · serving size */}
      {meta ? (
        <p className="text-xs text-[var(--muted)] truncate">{meta}</p>
      ) : null}
      {/* Macro line (UXR-lib-24) — typed numerals, not micro-bar (UXR-lib-14) */}
      {/* AA fix: text-xs (12px) not text-[10px] (UXR-lib-11) */}
      <p className={`text-xs ${hasAnyMacro ? "" : "italic"} text-[var(--muted)]`}>
        {macroLineStr}
      </p>
      {/* Usage line */}
      <p className="text-xs text-[var(--muted)]">
        {`used ${food.usageCount}×`}
        {food.lastUsedAt ? ` · ${food.lastUsedAt}` : ""}
      </p>
    </div>
    <div className="flex items-center gap-1 shrink-0">
      <button
        type="button"
        onClick={() => handleEditOpen(food)}
        aria-label={`Edit ${food.name}`}
        className="min-h-[44px] text-xs text-[var(--muted)] border border-[var(--border)] rounded-lg px-3"
      >
        Edit
      </button>
      <ConfirmButton
        label="X"
        confirmLabel="Remove · confirm"
        onConfirm={() => handleDelete(food.id)}
        variant="danger"
        aria-label={`Remove ${food.name} from food library`}
        className="shrink-0 text-xs text-[var(--muted)] border border-[var(--border)] rounded-lg px-3"
      />
    </div>
  </li>
);
```

---

### 2.9 `globals.css` — Additions

Append at end of file (after the existing `save-confirm-fade` block, line 408):

```css
/* Tab content fade — reuses stale-flag-in keyframe (opacity 0→1, ease-out).
   Apply to the list area whenever the active tab changes.
   ⚠ playtest 110–160ms (UXR-lib-18). */
.tab-content-fade {
  animation: stale-flag-in 130ms ease-out;
}
@media (prefers-reduced-motion: reduce) {
  .tab-content-fade {
    animation: none;
  }
}
```

> No new keyframes. The overlay slide for `LibraryPickerOverlay` uses the same conditional-null-return pattern as `ScanFoodSheet` (returns `null` when `!open`) — no CSS slide class needed; the browser paints it instantly. The scrim opacity is set via the fixed bg-black/45 tailwind class.

---

### 2.10 `MoreSheet.tsx` — Subtitle Change

**Find** the Nutrition navRow (line 99–103):
```typescript
{
  href: "/nutrition",
  label: "Nutrition",
  sub: "Meal plan and nutrition log",
  icon: <NutritionIcon />,
},
```

**Replace `sub` field** with (UXR-lib-25):
```typescript
sub: "Your macro-grouped pantry, meal log, and daily targets",
```

---

### 2.11 `food-actions.ts` — listLibraryFoods take change

**Decision 2 resolved: bump to 200.**

Line 419 — `take: 50` → `take: 200`:
```typescript
// BEFORE:
take: 50,
// AFTER:
take: 200,
```

---

## 3. Critical Decisions (Resolved)

### Decision 1 — Bullseye Ring-Rounding (UXR-lib-10)

**Canonical rule for all devs:** Always pass `progress` prop to `<Bullseye size={N} progress={p}>` and let `progressToRings` handle it internally. Never compute ring counts externally.

**Actual formula** (verified from `Bullseye.tsx` line 135–142):
```
max = size < 10 ? 1 : size < 14 ? 2 : size < 20 ? 3 : 4
rings = (p === 0) ? 0 : max(1, ceil(p * max))
```

At **size 20** and **size 24** (both resolve to band=20, max=4):
- 0%   → 0 rings (hollow)
- 1–25% → 1 ring (center dot)
- 26–50% → 2 rings
- 51–75% → 3 rings
- 76–100% → 4 rings (full)

**The UXR mockup was wrong:** it showed 78%→3 and 60%→2. Real behavior: 78%→4, 60%→3. Do NOT replicate the mockup values. `progressToRings` is not exported and should not be called externally — pass `progress` and trust the component.

### Decision 2 — listLibraryFoods take 50→200 (UXR-lib-22)

**APPROVED.** A `LibraryFoodRow` serializes to approximately 280–320 bytes JSON (name 20ch, brand 15ch, servingSize 10ch, 6 macros, usageCount, lastUsedAt). 200 rows ≈ 60KB uncompressed, ~14KB gzip. Well within Next.js RSC payload budget. Change is query-only: `take: 50` → `take: 200` in `listLibraryFoods()`.

### Decision 3 — Badge colors via color-mix (UXR-lib-13)

**No literals.** Use `color-mix(in srgb, <semantic-token> 15%, var(--card))` for backgrounds. Token mapping:
- **Protein** → `var(--target)` (#A82A1F light / #C0392B dark) — warm red, the target color
- **Carbs** → `var(--success)` (#4E6B36 light / #7FA45C dark)
- **Fat** → `var(--accent)` (#8A6212 light / #D4A437 dark)
- **Misc** → `var(--muted)` (#7A5E3A light / #9C8866 dark)

Foreground: the same semantic token at full opacity. Both palettes auto-adapt via CSS custom properties. No additional media queries needed.

### Decision 4 — ONE ScanFoodSheet, shared (UXR-lib-02/23)

**Confirmed architecture.** The `[+]` in `LibraryPickerOverlay` calls `onFoodPlus(food)` which maps to `setScanFoodInitial(food); setScanOpen(true)` inside `useFoodComposer`. This is byte-identical to a chip tap. `isChipMode = true` (because `initialFood !== undefined`). After "Add to meal", `ScanFoodSheet.handleAdd` calls `onClose()`, returning to the picker which stays open for the next selection.

z-index layering (both are `fixed inset-0`, viewport stacking context):
- `LibraryPickerOverlay`: `z-[50]`
- `ScanFoodSheet`: `z-[55]` (existing, unchanged)

Result: ScanFoodSheet renders above the picker. Picker visible underneath when ScanFoodSheet is dismissed.

### Decision 5 — No-target / no-trackedSoFar callers, no regression

**All new props are optional.** The following callers are verified safe with zero prop changes:

| Caller | Props passed | Header behavior |
|--------|-------------|-----------------|
| `NutritionToday` inner `<LogNutritionForm />` | none | Hollow Bullseye, no projection. `showDayContext = false`. |
| `MealEditButton` → `MealComposer mode="edit"` | `plannedTarget?`, `quickPickFoods?` only | Existing fallback path (`showMeter` via `plannedTarget`). `isEdit=true` → enriched header skipped entirely. |
| Future `LogNutritionForm` callers passing no props | none | Same as NutritionToday row. |

---

## 4. Work Streams

### Stream A — Foundation (MUST LAND FIRST; blocks B and C)
**Owner: dev-agent-A**
**Files (exclusive ownership):**
- `src/lib/food-resolve-local.ts` (CREATE)
- `src/lib/food-actions.ts` (MODIFY: scaleMacros extract + take-200)

**Deliverable:** `food-resolve-local.ts` exports `scaleMacros`, `classifyFood`, `resolveItemMacrosPure`. `food-actions.ts` imports `scaleMacros` from there and bumps `listLibraryFoods` take to 200.

**Gate:** `npx tsc --noEmit` clean on these two files. Run `grep -c "scaleMacros" src/lib/food-actions.ts` — should show only import + call sites (0 definitions). Commit as `feat(lib): food-resolve-local helpers + scaleMacros extraction`.

---

### Stream B — Picker + Composer Plumbing (starts after Stream A lands)
**Owner: dev-agent-B**
**Files (exclusive ownership):**
- `src/components/LibraryPickerOverlay.tsx` (CREATE)
- `src/components/useFoodComposer.tsx` (MODIFY)
- `src/app/globals.css` (MODIFY: tab-content-fade addition only — see coordination note)

**Deliverable:** `LibraryPickerOverlay` renders and is mounted in `useFoodComposer.{sheet}`. "Browse library" button visible in `{controls}`. Tapping `[+]` on a food opens the existing ScanFoodSheet (chip path). `onMacrosChanged` prop wired in `handleAdd`. `globals.css` tab-content-fade class appended.

**Coordination note for globals.css:** Stream B appends `.tab-content-fade` at the end. Stream C appends nothing new to globals.css (the `macro-flash` class already exists — only the wiring in MealComposer changes, not the CSS). No merge conflict.

**Gate:** `npx tsc --noEmit`. Dev server 390px: open composer → "Browse library" → picker opens → search → tab switch (list fades) → `[+]` → ScanFoodSheet opens confirm phase → Add to meal → item appears in composer → picker still open → close picker. Commit as `feat(picker): LibraryPickerOverlay + useFoodComposer Browse-library wiring`.

---

### Stream C — Header + Page + Strips + Manager (starts after Stream A lands; parallel with B)
**Owner: dev-agent-C**
**Files (exclusive ownership):**
- `src/components/MealComposer.tsx` (MODIFY)
- `src/components/LogNutritionForm.tsx` (MODIFY)
- `src/app/nutrition/page.tsx` (MODIFY)
- `src/components/NutritionToday.tsx` (MODIFY)
- `src/components/FoodLibraryManager.tsx` (MODIFY)
- `src/components/MoreSheet.tsx` (MODIFY)

**Deliverable:** Enriched composer header with projected fill + remaining + size-24 Bullseye. LogNutritionForm threads new props. Nutrition page computes and passes day context. NutritionToday Day-total strip has size-20 Bullseye + remaining. FoodLibraryManager has segmented tabs + macro lines + letter badges. MoreSheet subtitle updated.

**Coordination note:** Stream C does NOT touch `globals.css` (all needed keyframes exist; only JS wiring changes in MealComposer). Does NOT touch `useFoodComposer.tsx` (Stream B owns it). Does NOT touch `LibraryPickerOverlay.tsx` (Stream B owns it).

**Gate:** `npx tsc --noEmit`. Dev server 390px: open /nutrition → TodayMacroSummary shows (existing) → Log a meal card → add a chip food → header shows projected totals + remaining + size-24 Bullseye filled → check no-target day (remove nutritionPlan override) → hollow Bullseye + honest note. NutritionToday Day-total strip (on Today page) shows size-20 Bullseye + remaining line. FoodLibraryManager: tab Protein → list filters. Commit as `feat(header+strips): enriched composer header + day strips + FoodLibraryManager tabs`.

---

### Stream D — QA Gate (runs after B + C both merge)
**Owner: dev-agent-QA** (REQ-006)

1. `npx tsc --noEmit` → 0 errors
2. `npm run lint` → 0 errors (prune any `.next` worktree artifacts first)
3. `npm run build` → clean
4. 390px dev-server smoke: full add-from-library loop (open composer → Browse library → tab + search → `[+]` → ScanFoodSheet → Add to meal → header Bullseye updates → Log meal)
5. Regression: create-mode chip-add, scan-add, estimate-add, all unchanged
6. Regression: edit-mode (MealEditButton → edit → Save / Delete)
7. Regression: Recompute from items → Apply → flashMacros fires only on changed keys
8. NutritionToday Day-total strip: target present → Bullseye + remaining; no target → honest note
9. FoodLibraryManager: All / Protein / Carbs / Fat / Misc tabs filter correctly
10. No-target day: composer header shows hollow Bullseye + "No plan set" text
11. AA contrast: muted text on cream is 12px (not 10px) across all new UI
12. iOS overlay gate: LibraryPickerOverlay on top of BottomSheet (user device verify — flag if untested)
13. UXR-lib ledger: tick every ID with file:line SHA

---

## 5. Regression Guardrails

The following behaviors must be **byte-identical** after this PR. QA compares before/after on device and by code inspection.

### 5.1 mergeFoodIntoForm (exported from useFoodComposer.tsx)
- Signature unchanged: `(itemsText, macroValues, payload) → { itemsText, macroValues }`
- MACRO_KEYS loop unchanged
- Rounding rules unchanged (cal/Na → integer; g macros → 1dp)
- chipSource logic in handleAdd unchanged (recordFoodUse only on chipSource=true)

### 5.2 mergeEstimateIntoForm (exported from useFoodComposer.tsx)
- Signature unchanged: `(itemsText, macroValues, line, macros) → { itemsText, macroValues }`
- null macros path unchanged (line-only append)

### 5.3 ScanFoodSheet scan → lookup → confirm → add flow
- handleAdd fires onAdd then (chip mode) onClose — unchanged
- servings stepper step=0.5 / min=0.5 / max=20 — unchanged
- camera active guard `open && phase === "scan"` — unchanged
- Escape key handler — unchanged

### 5.4 MealComposer edit mode
- `updateNutrition` action wiring — unchanged
- `onDeleted` snapshot shape — unchanged
- ConfirmButton "Delete meal · confirm" — unchanged
- `setEditSaved(true)` quiet-confirm → `setTimeout(150)` → `onSaved?.()` — unchanged

### 5.5 MealComposer create mode
- `logNutrition` form action — unchanged
- `resetCreate()` resets all state — unchanged (add `setPreview(null)` if not already present, which it is at line 344)

### 5.6 Recompute / staleness machinery
- `hashItems` → `snapshotHash` comparison for `stale` — unchanged
- `handleRecompute()` → `estimateMealMacros(effectiveItems)` → `setPreview` — unchanged
- `applyRecompute()` calls `setMacros({ ...preview.totals })` + `setSnapshotHash` + `setFlashMacros` DIRECTLY (not via `onMacrosChanged`; they're separate code paths; no double-fire)
- `cancelRecompute()` — unchanged

### 5.7 Item row animations
- `item-row-anim`, `is-exiting`, `transitionend` → `removeItem` guard — unchanged
- `qty-bump` re-key on `bumpState` — unchanged
- `stale-flag-in` on stale flag div — unchanged
- `macro-flash` class on `flashNumeral` spans — unchanged (now also fires on add path via `handleMacrosChanged`)

---

## 6. testIDs Reference

| testID | Element | Component |
|--------|---------|-----------|
| `library-picker-overlay` | root div of overlay | LibraryPickerOverlay |
| `library-picker-search` | search input | LibraryPickerOverlay |
| `macro-tab-all` | All tab button | LibraryPickerOverlay + FoodLibraryManager |
| `macro-tab-protein` | Protein tab | same |
| `macro-tab-carbs` | Carbs tab | same |
| `macro-tab-fat` | Fat tab | same |
| `macro-tab-misc` | Misc tab | same |
| `food-row-{id}` | `<li>` per food | LibraryPickerOverlay |
| `food-add-btn-{id}` | `[+]` per food | LibraryPickerOverlay |
| `composer-browse-library` | Browse library button | useFoodComposer controls |
| `composer-projected-line` | "Today X + this meal Y = Z / T" | MealComposer header |
| `composer-remaining` | remaining / over text | MealComposer header |
| `composer-bullseye-meter` | Bullseye in header | MealComposer header |
| `daytotal-bullseye` | size-20 Bullseye in Day-total strip | NutritionToday |
| `daytotal-remaining` | remaining text in strip | NutritionToday |
| `daytotal-no-target-note` | honest no-target note | NutritionToday |

---

## 7. Provisional / Verify-Visually Items (from UXR-lib §9)

Copy these into the PR checklist. Each must be checked-off or noted with a filed issue.

| ID | Item | Status |
|----|------|--------|
| UXR-lib-08 | `DOMINANCE_THRESHOLD = 0.45`, `MARGIN_THRESHOLD = 0.12` — playtest against real library | ⚠ playtest |
| UXR-lib-10 | Ring-rounding resolved: `ceil(p * 4)` at size 20+, NOT mockup values | RESOLVED in this blueprint |
| UXR-lib-11 | All muted small labels in new UI are `text-xs` (12px), not `text-[10px]` | Enforced in contracts above |
| UXR-lib-12 | `--warning` on `--card` ≈4.7:1 borderline — verify "over target" text ≥13px weight-600 | ⚠ verify |
| UXR-lib-13 | Letter badge renders legibly at 390px — if not, consider dot instead | ⚠ playtest |
| UXR-lib-14 | Typed numerals on rows (not micro-bar) — verify readability | ⚠ playtest |
| UXR-lib-15..19 | Animation durations all provisional — playtest on device | ⚠ playtest |
| UXR-lib-22 | `take: 200` payload acceptable — measure with browser DevTools network tab | DECIDED: approved |
| UXR-lib-23 | `LibraryPickerOverlay` on top of BottomSheet on real iOS Safari | ⚠ device gate |

---

## 8. Summary (10 lines) and Final Notes

**What this ships:** (1) `food-resolve-local.ts` — pure `classifyFood` + `resolveItemMacrosPure` + extracted `scaleMacros`; (2) `LibraryPickerOverlay` — `fixed inset-0` non-dialog, search + macro tabs + `[+]` → ONE shared ScanFoodSheet; (3) `useFoodComposer` — `libraryFoods` + `onMacrosChanged` props, Browse-library button, overlay in `{sheet}`; (4) `MealComposer` enriched header — projected fill + remaining + size-24 Bullseye, flashMacros fires on add-path, degrades for all existing callers; (5) `NutritionToday` Day-total strip — size-20 Bullseye + remaining; (6) `FoodLibraryManager` — segmented tabs + macro line + letter badge via color-mix; (7) `/nutrition/page.tsx` — threads day context; (8) `MoreSheet` subtitle update.

**Five critical decisions resolved:**
1. **Ring-rounding**: `ceil(p * 4)` at size 20+. Mockup was wrong. Pass `progress` prop only.
2. **take 50→200**: Approved (~14KB gzip, query-only, no migration).
3. **Badge colors**: `color-mix(in srgb, <token> 15%, var(--card))` — no literals.
4. **ONE ScanFoodSheet**: Picker's `[+]` routes through `setScanFoodInitial` + `setScanOpen` — the chip path. `z-[50]` picker / `z-[55]` scan sheet.
5. **No-target / no-context callers**: All new props are optional. `isEdit` gates the enriched header. Zero regression for NutritionToday embedded form, MealEditButton, and any future caller.

**Concerns for the team:**
- `handleMacrosChanged` fires on EVERY `setMacros` call from `useFoodComposer` (chip, scan, picker). The recompute Apply path calls `setMacros` + `setFlashMacros` directly — do NOT route it through `onMacrosChanged` or flash will fire twice on Apply.
- `classifyFood` thresholds (45%/12pp) are provisional. If the real library has foods clustering near the boundary (e.g. "chicken breast 43% protein share"), lower to 40%. Run a quick offline count against the real library before shipping.
- iOS Safari device test is a hard gate (UXR-lib-23). The `fixed inset-0` non-dialog pattern is already proven by `ScanFoodSheet`; `LibraryPickerOverlay` mirrors it exactly. Still verify on device.
- Stream B and Stream C can develop in parallel after Stream A. The only shared-file risk is `globals.css` (Stream B appends one block at end; Stream C adds nothing to CSS). Merge order: A → (B ∥ C) → QA.
