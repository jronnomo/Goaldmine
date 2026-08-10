"use client";

import { useRef, useState, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { type MacroValues } from "@/components/MacroInputs";
import { MACRO_KEYS } from "@/lib/food-types";
import type { LibraryFood, AddFoodPayload, FoodMacros } from "@/lib/food-types";
import {
  getQuickPickFoods,
  recordFoodUse,
  recordFoodPortion,
  searchFoodCandidates,
  resolveCandidate,
} from "@/lib/food-actions";
import type { FoodEstimate, FoodCandidate, CandidateRef } from "@/lib/food-actions";
import type { NutritionItem } from "@/lib/nutrition-log-ops";
import {
  buildItemSnapshot,
  defaultUnitForQuery,
  deriveAmountFromServings,
  deriveAmountFromEstimate,
  buildQtyDisplay,
  withItemMacros,
} from "@/lib/food-units";
import { parseFoodQuery } from "@/lib/food-parse";
import {
  deriveSavedMealLog,
  linkedFoodPortions,
  type SavedMealLite,
} from "@/lib/saved-meal";
import { deleteSavedMeal, listSavedMealsLite } from "@/lib/saved-meal-actions";
import type { NutritionMacros } from "@/lib/nutrition-plan";

import { BottomSheet } from "@/components/BottomSheet";
import { ConfirmButton } from "@/components/ConfirmButton";
import { LibraryPickerOverlay } from "@/components/LibraryPickerOverlay";

// Dynamic import: ScanFoodSheet + zxing-wasm are browser-only.
const ScanFoodSheet = dynamic(
  () =>
    import("@/components/ScanFoodSheet").then((m) => m.ScanFoodSheet),
  { ssr: false }
);

// ── Pure merge helpers ─────────────────────────────────────────────────────────

/**
 * mergeFoodIntoForm — pure function: applies an AddFoodPayload to the current
 * form text + macro state and returns the merged result.
 *
 * Merge rules:
 *   • Items line: "Name (Brand) | N serving(s)" or "Name (Brand) | Ng"
 *     name/brand are guaranteed pipe-free by the normalizer (DB-level guarantee).
 *   • Macros: null food values are skipped (they do not zero an existing entry).
 *     cal/sodium → integer; gram fields → 1-decimal float.
 *
 * Does NOT call recordFoodUse or update quickPick — those are side-effects
 * handled by handleAdd in the consuming hook.
 */
export function mergeFoodIntoForm(
  itemsText: string,
  macroValues: MacroValues,
  payload: AddFoodPayload
): { itemsText: string; macroValues: MacroValues } {
  const { food, servings } = payload;

  // ── 1. Build items line ────────────────────────────────────────────────────
  const brandPart = food.brand ? ` (${food.brand})` : "";
  const qty =
    food.basis === "100g"
      ? `${Math.round(servings * 100)} g`
      : `${servings} serving${servings === 1 ? "" : "s"}`;
  const line = `${food.name}${brandPart} | ${qty}`;
  const newItemsText =
    itemsText + (itemsText.trim() ? "\n" : "") + line;

  // ── 2. Sum macros ──────────────────────────────────────────────────────────
  const newMacros: MacroValues = { ...macroValues };
  for (const key of MACRO_KEYS) {
    const foodVal = food.perServing[key];
    if (foodVal == null) continue;
    const scaled = foodVal * servings;
    const existing = macroValues[key] ?? 0;
    const sum = existing + scaled;
    newMacros[key] =
      key === "calories" || key === "sodiumMg"
        ? Math.round(sum)
        : Math.round(sum * 10) / 10;
  }

  return { itemsText: newItemsText, macroValues: newMacros };
}

/**
 * mergeEstimateIntoForm — pure function: appends a pre-formatted estimate line
 * and sums pre-scaled total macros into the current form state.
 *
 * Unlike mergeFoodIntoForm, both the line and macros are already resolved by
 * estimateFood (no further scaling needed). Used by the "Add item" estimate strip.
 *
 * When macros is null (not_found / add-anyway path) only the line is appended.
 */
export function mergeEstimateIntoForm(
  itemsText: string,
  macroValues: MacroValues,
  line: string,
  macros: FoodMacros | null
): { itemsText: string; macroValues: MacroValues } {
  const newItemsText =
    itemsText + (itemsText.trim() ? "\n" : "") + line;

  const newMacros: MacroValues = { ...macroValues };
  if (macros) {
    for (const key of MACRO_KEYS) {
      const val = macros[key];
      if (val == null) continue;
      const existing = macroValues[key] ?? 0;
      const sum = existing + val;
      newMacros[key] =
        key === "calories" || key === "sodiumMg"
          ? Math.round(sum)
          : Math.round(sum * 10) / 10;
    }
  }

  return { itemsText: newItemsText, macroValues: newMacros };
}

// ── SavedMeal quick-pick helpers (#296) ───────────────────────────────────────

/**
 * Expand a SavedMeal into composer-ready items + scaled macros for `servings`
 * servings. Pure — delegates to src/lib/saved-meal.ts's deriveSavedMealLog,
 * the SAME helper log_nutrition(savedMealId, servings) runs server-side, so
 * the web composer and the coach's MCP channel converge on identical
 * NutritionLog content:
 *   • linked items (food-linked bundles) expand to full structured rows —
 *     source snapshot + scaled amount/unit/itemMacros — exactly as if each
 *     food had been picked individually;
 *   • text items keep the "×0.5" qty annotation and lump-macros behavior.
 *
 * `macros` is the FULL scaled total (sheet preview); `creditMacros` is the
 * lump the host must pass to addItem (the residual only) — linked items
 * self-compute their contribution through the composer's recompose math, so
 * crediting the full total as well would double-count them.
 *
 * ⚑ Deliberately NO savedMealId/servings form field on the web path
 * (UXR-PV-64): itemsJson stays the single structured channel; this expansion
 * submits already-scaled items exactly like any other composed meal.
 */
export function expandSavedMealForComposer(
  meal: SavedMealLite,
  servings: number,
): { items: NutritionItem[]; macros?: NutritionMacros; creditMacros?: NutritionMacros } {
  const derived = deriveSavedMealLog(
    { items: meal.items, macros: meal.macros ?? null, defaultServings: meal.defaultServings },
    servings,
  );
  return { items: derived.items, macros: derived.macros, creditMacros: derived.residualMacros };
}

/**
 * Chip second line: "670 · 71P" — calories and protein, the two numbers that
 * decide the tap against a protein floor (UXR-PV-60). Null when the meal has
 * neither (chip renders name-only).
 */
export function savedMealChipMacros(macros: NutritionMacros | undefined): string | null {
  if (!macros) return null;
  const parts: string[] = [];
  if (macros.calories != null) parts.push(String(Math.round(macros.calories)));
  if (macros.proteinG != null) parts.push(`${Math.round(macros.proteinG)}P`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Sheet macro preview: "335 cal · 35.5 P" (scaled values, tabular-nums). */
export function savedMealPreviewMacros(macros: NutritionMacros | undefined): string | null {
  if (!macros) return null;
  const parts: string[] = [];
  if (macros.calories != null) parts.push(`${Math.round(macros.calories)} cal`);
  if (macros.proteinG != null) parts.push(`${macros.proteinG} P`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

// Servings stepper: fractions are the point (the Chipotle bowl logs in
// 0.25/0.5 steps — UXR-PV-61/62; step ⚠[0.25–0.5], floor 0.25).
const SAVED_MEAL_SERVINGS_STEP = 0.25;
const SAVED_MEAL_SERVINGS_MIN = 0.25;

/** "1", "0.5", "1.25" — never "1.00". */
function formatServings(v: number): string {
  return String(Number(v.toFixed(2)));
}

// ── Barcode icon (hand-rolled 20px fill icon, barcode aesthetic) ───────────────

function BarcodeIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden
    >
      <rect x="2" y="4" width="1.5" height="12" rx="0.25" />
      <rect x="4.75" y="4" width="0.75" height="12" rx="0.25" />
      <rect x="6.75" y="4" width="1.5" height="12" rx="0.25" />
      <rect x="9.5" y="4" width="0.75" height="12" rx="0.25" />
      <rect x="11.5" y="4" width="1.5" height="12" rx="0.25" />
      <rect x="14.25" y="4" width="0.75" height="12" rx="0.25" />
      <rect x="16.25" y="4" width="1.5" height="12" rx="0.25" />
    </svg>
  );
}

// ── Estimate strip helpers ─────────────────────────────────────────────────────

/**
 * Build the short macro one-liner for an "ok" estimate strip.
 * Format: "~105 cal · 1.3P · 27C · 0.4F" — nulls omitted, fiber+sodium excluded.
 */
function formatEstimateMacros(m: FoodMacros): string {
  const parts: string[] = [];
  if (m.calories != null) parts.push(`~${m.calories} cal`);
  if (m.proteinG != null) parts.push(`${m.proteinG}P`);
  if (m.carbsG != null) parts.push(`${m.carbsG}C`);
  if (m.fatG != null) parts.push(`${m.fatG}F`);
  return parts.join(" · ");
}

/** Source label for the "est. — X" tag. */
function sourceLabel(src: "library" | "builtin" | "usda"): string {
  if (src === "usda") return "est. — USDA";
  if (src === "builtin") return "est. — builtin";
  return "est. — library";
}

// ── useFoodComposer ───────────────────────────────────────────────────────────

/**
 * useFoodComposer — shared hook for the food-composition tooling (chips, Scan,
 * USDA/builtin estimates with fractions).
 *
 * Owns: scanOpen/scanFoodInitial/estimate state, lazyFoods/localAdditions, all
 * handlers, and the dynamic ScanFoodSheet import.
 *
 * Returns:
 *   controls — ReactNode: chips row + estimate add-item field + result strip.
 *              Render INSIDE the <form> (all buttons are type="button").
 *   sheet    — ReactNode: the <ScanFoodSheet> overlay.
 *              Render OUTSIDE the <form> (as a sibling) so its buttons can never
 *              submit the host form.
 */
// INVARIANT: All food-resolved adds (handleAdd, handleEstimateAdd, handleEstimateAddAnyway)
// MUST call addItem(). Never reconstruct a text line from these paths — doing so would
// strip amount/unit/source from ALL existing items, not just the new one.
// setItemsText has been removed from this hook; rawMode text writes live in MealComposer.

export function useFoodComposer({
  addItem,
  quickPickFoods,
  libraryFoods,
  savedMeals,
}: {
  /**
   * Called on every food-resolved add (chip / scan / estimate / add-anyway). B-3 rule:
   * NEVER call setItemsText from food-resolved paths — use addItem instead.
   * The host (MealComposer.addItemToComposer) owns the macro total: it recomputes
   * it from the items array so the total always equals sumStructuredMacros(items) +
   * residual. This hook no longer touches macros at all.
   *
   * #296: a SavedMeal expansion is addItem-several — the host accepts an
   * array in ONE call (N sequential calls would each read the same stale
   * `items` closure and drop all but the last), plus optional known macros
   * (`opts.macros`, the saved meal's scaled totals) that the host credits to
   * its macro authority. Single-item calls behave exactly as before.
   */
  addItem: (item: NutritionItem | NutritionItem[], opts?: { macros?: NutritionMacros }) => void;
  quickPickFoods?: LibraryFood[];
  /** Pre-loaded library foods for the Browse-library picker. */
  libraryFoods?: LibraryFood[];
  /**
   * #296: server-fetched SavedMeal list for the quick-pick row. Undefined →
   * the hook lazy-fetches on mount (the quickPickFoods precedent); [] →
   * loaded-and-empty (renders the coach note).
   */
  savedMeals?: SavedMealLite[];
}): { controls: ReactNode; sheet: ReactNode } {
  // Quick-pick chip state: two orthogonal state slices, merged via useMemo.
  //   lazyFoods    — fetched on mount (no prop provided path)
  //   localAdditions — optimistic prepend on scan/estimate add
  const [lazyFoods, setLazyFoods] = useState<LibraryFood[]>([]);
  const [localAdditions, setLocalAdditions] = useState<LibraryFood[]>([]);

  // Derive quickPick: server prop (highest authority) or lazyFoods, with
  // localAdditions prepended and winning over base for any shared id.
  const quickPick = useMemo(() => {
    const base = quickPickFoods ?? lazyFoods;
    const localIds = new Set(localAdditions.map((a) => a.id));
    const baseFiltered = base.filter((b) => !localIds.has(b.id));
    return [...localAdditions, ...baseFiltered].slice(0, 8);
  }, [quickPickFoods, lazyFoods, localAdditions]);

  // SavedMeal quick-pick state (#296). lazySavedMeals: null = not loaded yet
  // (row renders nothing — no empty-note flash), [] = loaded and empty.
  const [lazySavedMeals, setLazySavedMeals] = useState<SavedMealLite[] | null>(null);
  // Optimistically hidden after the sheet's quick-delete — server-provided
  // lists (props) can't be mutated, so removals are filtered locally until the
  // next RSC pass (deleteSavedMeal revalidates /nutrition).
  const [removedSavedMealIds, setRemovedSavedMealIds] = useState<Set<string>>(() => new Set());
  const savedMealListRaw = savedMeals ?? lazySavedMeals;
  const savedMealList = useMemo(
    () =>
      savedMealListRaw === null
        ? null
        : savedMealListRaw.filter((m) => !removedSavedMealIds.has(m.id)),
    [savedMealListRaw, removedSavedMealIds],
  );

  // SavedMeal sheet state: which meal is open + the servings being composed.
  const [activeSavedMeal, setActiveSavedMeal] = useState<SavedMealLite | null>(null);
  const [savedServings, setSavedServings] = useState(1);
  // Re-key nonce so the servings numeral replays the shipped .qty-bump tick.
  const [servingsBump, setServingsBump] = useState(0);

  // Scan sheet state
  const [scanOpen, setScanOpen] = useState(false);
  const [scanFoodInitial, setScanFoodInitial] = useState<
    LibraryFood | undefined
  >(undefined);

  // Picker overlay state
  const [pickerOpen, setPickerOpen] = useState(false);

  // Estimate input state
  const [estimateInput, setEstimateInput] = useState("");
  const [estimatePending, setEstimatePending] = useState(false);
  const [estimateResult, setEstimateResult] = useState<FoodEstimate | null>(null);
  // Disambiguation candidates (multi-match). null = no list shown.
  const [candidates, setCandidates] = useState<FoodCandidate[] | null>(null);
  // Track the query submitted so "Add anyway" uses the right text even if the
  // user edits the input field after submitting.
  const lastEstimateQueryRef = useRef("");

  // ── Effects ──────────────────────────────────────────────────────────────

  // Lazy-fetch on mount when no prop provided.
  // setState is inside a Promise .then() callback — not synchronously in the
  // effect body, which is the safe pattern for external-system data fetching.
  useEffect(() => {
    if (quickPickFoods !== undefined) return; // server provided → skip
    getQuickPickFoods()
      .then((foods) => setLazyFoods(foods))
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally once on mount

  // #296: SavedMeal lazy fetch — exact mirror of the quickPickFoods pattern.
  useEffect(() => {
    if (savedMeals !== undefined) return; // server provided → skip
    listSavedMealsLite()
      .then((meals) => setLazySavedMeals(meals))
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally once on mount

  // ── SavedMeal handlers (#296) ─────────────────────────────────────────────

  function openSavedMeal(meal: SavedMealLite) {
    setActiveSavedMeal(meal);
    setSavedServings(meal.defaultServings > 0 ? meal.defaultServings : 1);
  }

  function bumpSavedServings(delta: number) {
    setSavedServings((prev) => {
      const next = Math.max(SAVED_MEAL_SERVINGS_MIN, Number((prev + delta).toFixed(2)));
      return next;
    });
    setServingsBump((n) => n + 1);
  }

  function handleSavedMealAdd() {
    if (!activeSavedMeal) return;
    // UXR-PV-63: through addItem(), never setItemsText — one call carrying
    // the whole expansion (see the addItem prop doc). creditMacros is the
    // RESIDUAL lump only: linked items carry source snapshots, so the host's
    // recompose math credits them from the items themselves (identical to
    // hand-adding each food); text-only meals credit the full scaled lump
    // exactly as before.
    const { items, creditMacros } = expandSavedMealForComposer(activeSavedMeal, savedServings);
    if (items.length > 0 || creditMacros) {
      addItem(items, creditMacros ? { macros: creditMacros } : undefined);
    }
    // Bundle expansion counts as a "use" of each linked food — the same
    // fire-and-forget recordFoodUse contract as an individual chip pick
    // (usage bump + last-portion memory at the scaled amount).
    for (const p of linkedFoodPortions(items)) {
      recordFoodUse(
        p.foodId,
        p.amount != null && p.unit ? { amount: p.amount, unit: p.unit } : undefined,
      ).catch(() => {});
    }
    setActiveSavedMeal(null);
  }

  function handleSavedMealDelete() {
    if (!activeSavedMeal) return;
    const id = activeSavedMeal.id;
    // Optimistic: hide the chip + close the sheet; the server delete is the
    // existing scoped core (same write delete_saved_meal runs). On failure
    // the chip comes back.
    setRemovedSavedMealIds((prev) => new Set(prev).add(id));
    setActiveSavedMeal(null);
    deleteSavedMeal(id)
      .then((res) => {
        if (!res.ok) {
          setRemovedSavedMealIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        }
      })
      .catch(() => {
        setRemovedSavedMealIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      });
  }

  // ── handleAdd ─────────────────────────────────────────────────────────────

  function handleAdd(payload: AddFoodPayload) {
    const { food, servings, chipSource } = payload;

    // 1. Build structured item (B-3: addItem path, NOT setItemsText).
    const snapshot = buildItemSnapshot(food);
    // ScanFoodSheet's servings stepper is a pure "× 100 g" multiplier (no portion
    // picker), so grams is the faithful representation for a 100g-basis food. Forcing
    // portions[0] ("small") + integer rounding here is what desynced the item from the
    // running total and accreted a phantom residual. Serving-basis foods → "serving".
    const unit = snapshot.basis === "100g" ? "g" : defaultUnitForQuery(null, snapshot);
    const amount = deriveAmountFromServings(servings, unit, snapshot);
    const qty = buildQtyDisplay(amount, unit, snapshot);
    // withItemMacros: snapshot the item's own macro contribution (itemMacros)
    // so logged rows carry per-item macros — the same shape a SavedMeal
    // bundle expansion produces, keeping "by hand" and "bundle" logs identical.
    const structuredItem: NutritionItem = withItemMacros({
      name: food.name, qty, amount, unit, source: snapshot,
    });

    // 2. B-3: addItem, NEVER setItemsText from this path. The host recomputes the
    //    macro total from the items array (single source of truth) — this hook no
    //    longer sets macros directly.
    addItem(structuredItem);

    // 3. Usage bump + last-portion memory.
    // Chip path: recordFoodUse bumps usageCount AND stores the portion.
    // Scan path: lookupBarcode() already incremented usageCount, so only persist the
    //   portion (recordFoodPortion) — a second bump here would double-count.
    if (chipSource) {
      recordFoodUse(food.id, { amount, unit }).catch(() => {});
    } else {
      recordFoodPortion(food.id, amount, unit).catch(() => {});
    }

    // 4. Optimistic chip upsert (scan path only)
    // After a scan adds (or rescans with healed macros) a food, upsert to front
    // of localAdditions so the chip immediately carries the freshest data.
    if (!chipSource) {
      setLocalAdditions((prev) => {
        const without = prev.filter((f) => f.id !== food.id);
        return [food, ...without];
      });
    }
  }

  // ── Estimate handlers ─────────────────────────────────────────────────────

  async function handleEstimate() {
    const q = estimateInput.trim();
    if (!q) return;
    lastEstimateQueryRef.current = q;
    setEstimatePending(true);
    setEstimateResult(null);
    setCandidates(null);
    try {
      const { candidates: cands } = await searchFoodCandidates(q);
      if (cands.length === 0) {
        setEstimateResult({ status: "not_found", query: q });
      } else if (cands.length === 1) {
        // Unambiguous — resolve straight to the macro strip, no extra tap.
        const result = await resolveCandidate(cands[0].ref, q);
        setEstimateResult(result);
      } else {
        setCandidates(cands);
      }
    } catch {
      setEstimateResult({ status: "error", message: "Estimate failed" });
    } finally {
      setEstimatePending(false);
    }
  }

  // Pick one candidate from the disambiguation list → resolve to the macro strip.
  // Keeps `candidates` set so "Back to results" can return to the list.
  async function handlePickCandidate(ref: CandidateRef) {
    const q = lastEstimateQueryRef.current || estimateInput.trim();
    if (!q) return;
    setEstimatePending(true);
    setEstimateResult(null);
    try {
      const result = await resolveCandidate(ref, q);
      setEstimateResult(result);
    } catch {
      setEstimateResult({ status: "error", message: "Estimate failed" });
    } finally {
      setEstimatePending(false);
    }
  }

  function handleBackToResults() {
    setEstimateResult(null);
  }

  function handleEstimateAdd() {
    if (!estimateResult || estimateResult.status !== "ok") return;
    const est = estimateResult;

    // Build structured item (B-3: addItem path, NOT setItemsText).
    const snapshot = buildItemSnapshot(est.food);
    const parsedQuery = parseFoodQuery(lastEstimateQueryRef.current ?? "");
    const unit = defaultUnitForQuery(parsedQuery, snapshot);
    const amount = deriveAmountFromEstimate(est.servings, unit, snapshot, parsedQuery);
    const qty = buildQtyDisplay(amount, unit, snapshot);
    // withItemMacros — see handleAdd: per-item macro snapshot on every
    // food-resolved add path.
    const structuredItem: NutritionItem = withItemMacros({
      name: est.food.name,
      qty,
      amount,
      unit,
      source: snapshot,
    });

    // B-3: addItem, NEVER setItemsText from this path. The host recomputes the macro
    //      total from the items array (single source of truth) — no setMacros here.
    addItem(structuredItem);

    // Persist the last-logged portion (usageCount already bumped in resolveCandidate).
    recordFoodPortion(est.food.id, amount, unit).catch(() => {});

    // Upsert the resolved library food to front of localAdditions so the chip
    // carries fresh macros.
    const food = est.food;
    setLocalAdditions((prev) => {
      const without = prev.filter((f) => f.id !== food.id);
      return [food, ...without];
    });

    setEstimateInput("");
    setEstimateResult(null);
    setCandidates(null);
  }

  function handleEstimateAddAnyway() {
    const line = lastEstimateQueryRef.current || estimateInput.trim();
    if (!line) return;
    // B-3 FIX: addItem, NEVER setItemsText. Freehand item — no source, no macros.
    addItem({ name: line });
    setEstimateInput("");
    setEstimateResult(null);
    setCandidates(null);
  }

  function handleEstimateDismiss() {
    setEstimateResult(null);
    setCandidates(null);
  }

  // ── controls ──────────────────────────────────────────────────────────────
  // All buttons are type="button" — none can submit the host form.

  const controls: ReactNode = (
    <>
      {/* ── Saved meals row (#296) — FIRST block, above the food quick-pick
          (UXR-PV-59: `controls` owns addItem and is injected identically into
          every host, create and edit). null while the lazy fetch is pending —
          no skeleton, no flash. Zero rows → the coach note (creation is
          MCP-only for now; issue AC wants the path stated, not a form). */}
      {savedMealList !== null && (
        <div data-testid="saved-meal-row">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            Saved meals
          </p>
          {savedMealList.length === 0 ? (
            <p data-testid="saved-meal-empty" className="text-xs text-[var(--muted)]">
              No saved meals yet — compose a meal below and tap “Save as meal”
              (your coach can save them too).
            </p>
          ) : (
            <div className="relative">
              <div
                role="group"
                aria-label="Saved meals"
                className="flex gap-2 overflow-x-auto py-1 [-webkit-overflow-scrolling:touch]"
              >
                {savedMealList.slice(0, 8).map((meal) => {
                  const macroLine = savedMealChipMacros(meal.macros);
                  return (
                    <button
                      key={meal.id}
                      type="button"
                      data-testid={`saved-meal-chip-${meal.id}`}
                      // UXR-PV-61: opens the servings sheet — NEVER adds
                      // directly (the Chipotle bowl logs in fractions).
                      onClick={() => openSavedMeal(meal)}
                      className="flex-shrink-0 flex flex-col justify-center rounded-full px-3 min-h-[44px]
                                 border border-[var(--border)] text-left"
                    >
                      <span className="text-sm font-medium truncate max-w-[14ch]">
                        {meal.name}
                      </span>
                      {/* Mono numerals vs the food chip's sans brand line —
                          the typographic channel that says "adds several,
                          not one" (UXR-PV-60). */}
                      {macroLine && (
                        <span className="font-mono text-[11px] text-[var(--muted)] truncate max-w-[12ch]">
                          {macroLine}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {/* Right-edge fade mask — verbatim the food quick-pick's */}
              <div
                className="absolute top-0 right-0 bottom-0 w-6 pointer-events-none"
                style={{
                  background:
                    "linear-gradient(to right, transparent, var(--card))",
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* ── Chips row ──────────────────────────────────────────────────────── */}
      {quickPick.length === 0 ? (
        // Empty library: full-label Scan button
        <button
          type="button"
          data-testid="scan-affordance"
          onClick={() => {
            setScanFoodInitial(undefined);
            setScanOpen(true);
          }}
          className="flex items-center gap-2 rounded-full px-3 py-2 min-h-[44px]
                     bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent)]
                     text-sm font-medium self-start"
        >
          <BarcodeIcon />
          Scan a barcode
        </button>
      ) : (
        // Non-empty: pinned Scan + horizontal scroll chips
        <div data-testid="quickpick-row" className="relative">
          <div className="flex gap-2 overflow-x-auto py-1 [-webkit-overflow-scrolling:touch]">
            {/* Pinned Scan — never scrolls away */}
            <button
              type="button"
              data-testid="scan-affordance"
              onClick={() => {
                setScanFoodInitial(undefined);
                setScanOpen(true);
              }}
              className="flex-shrink-0 flex items-center gap-1.5 rounded-full px-3 min-h-[44px]
                         bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent)]
                         text-sm font-medium"
            >
              <BarcodeIcon />
              Scan
            </button>

            {/* Food chips */}
            {quickPick.map((food) => (
              <button
                key={food.id}
                type="button"
                data-testid="quickpick-chip"
                onClick={() => {
                  setScanFoodInitial(food);
                  setScanOpen(true);
                }}
                className="flex-shrink-0 flex flex-col justify-center rounded-full px-3 min-h-[44px]
                           border border-[var(--border)] text-left"
              >
                <span className="text-sm font-medium truncate max-w-[14ch]">
                  {food.name}
                </span>
                {food.brand && (
                  <span className="text-[11px] text-[var(--muted)] truncate max-w-[12ch]">
                    {food.brand}
                  </span>
                )}
              </button>
            ))}
          </div>
          {/* Right-edge fade mask */}
          <div
            className="absolute top-0 right-0 bottom-0 w-6 pointer-events-none"
            style={{
              background:
                "linear-gradient(to right, transparent, var(--card))",
            }}
          />
        </div>
      )}

      {/* Browse library button — only when library foods are available */}
      {libraryFoods && libraryFoods.length > 0 && (
        <button
          type="button"
          data-testid="composer-browse-library"
          onClick={() => setPickerOpen(true)}
          className="flex items-center gap-1.5 rounded-full px-3 min-h-[44px]
                     border border-[var(--border)] text-[var(--accent)] text-sm font-medium self-start"
        >
          {/* ☰ decorative, SR reads button label */}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          Browse library
        </button>
      )}

      {/* ── Add item row (estimate) ─────────────────────────────────────────── */}
      <div className="flex flex-col gap-1.5">
        <div className="flex gap-2">
          <label htmlFor="estimate-input" className="sr-only">
            Add item
          </label>
          <input
            id="estimate-input"
            data-testid="estimate-input"
            type="text"
            enterKeyHint="done"
            placeholder='Add item — e.g. "medium banana"'
            value={estimateInput}
            disabled={estimatePending}
            onChange={(e) => {
              setEstimateInput(e.target.value);
              // A new search replaces the current strip + candidate list.
              if (estimateResult) setEstimateResult(null);
              if (candidates) setCandidates(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault(); // must NOT submit the host form
                handleEstimate();
              }
            }}
            className="flex-1 rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-base min-h-[44px] disabled:opacity-60"
          />
          <button
            type="button"
            data-testid="estimate-btn"
            onClick={handleEstimate}
            disabled={estimatePending || !estimateInput.trim()}
            className="rounded-lg bg-[var(--accent)] text-[var(--accent-fg)] px-4 min-h-[44px] text-sm font-medium shrink-0 disabled:opacity-50"
          >
            {estimatePending ? "Estimating…" : "Enter"}
          </button>
        </div>

        {/* Estimate strip — aria-live="polite"; one at a time */}
        <div aria-live="polite">
          {/* Disambiguation list — shown when >1 match and none picked yet */}
          {candidates && !estimateResult && (
            <div
              data-testid="estimate-candidates"
              className="rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden"
            >
              <p className="px-3 pt-2.5 pb-1 text-xs font-medium text-[var(--muted)]">
                Pick a match
              </p>
              <ul className="max-h-64 overflow-y-auto overscroll-contain divide-y divide-[var(--border)]">
                {candidates.map((c) => (
                  <li key={c.key}>
                    <button
                      type="button"
                      data-testid={`estimate-candidate-${c.key}`}
                      onClick={() => handlePickCandidate(c.ref)}
                      disabled={estimatePending}
                      className="w-full flex items-center gap-2 px-3 py-2.5 min-h-[44px] text-left hover:bg-[var(--border)]/30 disabled:opacity-60"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-[var(--foreground)] truncate">
                          {c.name}
                          {c.brand && (
                            <span className="font-normal text-[var(--muted)]"> · {c.brand}</span>
                          )}
                        </span>
                        <span className="block text-xs text-[var(--muted)]">
                          {c.kcal != null ? `${c.kcal} cal · ${c.detail}` : c.detail}
                          <span className="ml-1.5">{sourceLabel(c.source)}</span>
                        </span>
                      </span>
                      <span className="shrink-0 text-[var(--muted)]" aria-hidden>›</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {estimateResult?.status === "ok" && (() => {
            const est = estimateResult;
            // Split the pre-built line ("Banana | medium (118 g)") into name + portion
            const pipeIdx = est.line.indexOf(" | ");
            const displayName = pipeIdx >= 0 ? est.line.slice(0, pipeIdx) : est.line;
            const displayPortion = pipeIdx >= 0 ? est.line.slice(pipeIdx + 3) : "";
            const macroLine = formatEstimateMacros(est.macros);
            return (
              <div
                data-testid="estimate-strip"
                className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 flex flex-col gap-2"
              >
                {/* Resolved name + portion */}
                <p className="text-sm text-[var(--foreground)] font-medium leading-snug">
                  {displayName}
                  {displayPortion && (
                    <span className="font-normal text-[var(--muted)]">
                      {" · "}{displayPortion}
                    </span>
                  )}
                </p>
                {/* Macro one-liner + source tag */}
                {(macroLine || true) && (
                  <p className="text-xs text-[var(--muted)]">
                    {macroLine}
                    {macroLine && (
                      <span className="ml-1.5 text-[10px] text-[var(--muted)]">
                        {sourceLabel(est.source)}
                      </span>
                    )}
                  </p>
                )}
                {/* Action buttons */}
                <div className="flex gap-2">
                  <button
                    type="button"
                    data-testid="estimate-add-btn"
                    onClick={handleEstimateAdd}
                    className="flex-1 rounded-lg bg-[var(--accent)] text-[var(--accent-fg)] py-2.5 text-sm font-medium min-h-[44px]"
                  >
                    Add
                  </button>
                  {candidates ? (
                    <button
                      type="button"
                      data-testid="estimate-back-btn"
                      onClick={handleBackToResults}
                      className="flex-1 rounded-lg border border-[var(--border)] text-[var(--foreground)] py-2.5 text-sm font-medium min-h-[44px]"
                    >
                      ‹ Results
                    </button>
                  ) : (
                    <button
                      type="button"
                      data-testid="estimate-dismiss-btn"
                      onClick={handleEstimateDismiss}
                      className="flex-1 rounded-lg border border-[var(--border)] text-[var(--foreground)] py-2.5 text-sm font-medium min-h-[44px]"
                    >
                      Dismiss
                    </button>
                  )}
                </div>
              </div>
            );
          })()}

          {estimateResult?.status === "not_found" && (
            <div
              data-testid="estimate-strip"
              className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 flex flex-col gap-2"
            >
              <p className="text-sm text-[var(--muted)]">
                No estimate — added as plain item
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  data-testid="estimate-add-anyway-btn"
                  onClick={handleEstimateAddAnyway}
                  className="flex-1 rounded-lg bg-[var(--accent)] text-[var(--accent-fg)] py-2.5 text-sm font-medium min-h-[44px]"
                >
                  Add anyway
                </button>
                <button
                  type="button"
                  data-testid="estimate-dismiss-btn"
                  onClick={handleEstimateDismiss}
                  className="flex-1 rounded-lg border border-[var(--border)] text-[var(--foreground)] py-2.5 text-sm font-medium min-h-[44px]"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {estimateResult?.status === "error" && (
            <div
              data-testid="estimate-strip"
              className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 flex flex-col gap-2"
            >
              <p className="text-sm text-[var(--muted)]">Estimate failed</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  data-testid="estimate-add-anyway-btn"
                  onClick={handleEstimateAddAnyway}
                  className="flex-1 rounded-lg bg-[var(--accent)] text-[var(--accent-fg)] py-2.5 text-sm font-medium min-h-[44px]"
                >
                  Add anyway
                </button>
                <button
                  type="button"
                  data-testid="estimate-dismiss-btn"
                  onClick={handleEstimateDismiss}
                  className="flex-1 rounded-lg border border-[var(--border)] text-[var(--foreground)] py-2.5 text-sm font-medium min-h-[44px]"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );

  // ── sheet ─────────────────────────────────────────────────────────────────
  // Rendered by the host OUTSIDE its <form> — fixed overlay, visually transparent
  // to form ancestry. type="button" on all internal controls is enforced inside
  // ScanFoodSheet; rendering outside the form is the additional structural guarantee.

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
        key={pickerOpen ? 1 : 0}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        libraryFoods={libraryFoods ?? []}
        onFoodPlus={(food) => {
          setScanFoodInitial(food);
          setScanOpen(true);
          // Picker stays open behind ScanFoodSheet so user can add more.
        }}
      />

      {/* SavedMealSheet (#296) — BottomSheet is the only mechanically correct
          host: portaled to document.body, so it works from inside the Log
          sheet without iOS's nested-dialog dismissal bug (UXR-PV-61). */}
      <BottomSheet
        open={activeSavedMeal !== null}
        onClose={() => setActiveSavedMeal(null)}
        title={activeSavedMeal?.name ?? "Saved meal"}
        data-testid="saved-meal-sheet"
      >
        {activeSavedMeal &&
          (() => {
            const meal = activeSavedMeal;
            const { items: previewItems, macros: previewMacros } =
              expandSavedMealForComposer(meal, savedServings);
            const previewLine = savedMealPreviewMacros(previewMacros);
            return (
              <div className="flex flex-col gap-4 px-4 py-4">
                {/* Scaled item preview (live) */}
                {previewItems.length > 0 && (
                  <ul className="flex flex-col gap-1.5">
                    {previewItems.map((item, i) => (
                      <li key={i} className="text-sm text-[var(--foreground)]">
                        {item.name}
                        {item.qty && (
                          <span className="text-[var(--muted)]"> · {item.qty}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {/* Servings stepper — the shipped h-11 w-11 −/+ idiom;
                    default = defaultServings, fractions down to 0.25. */}
                <div className="flex items-center justify-center gap-3">
                  <button
                    type="button"
                    data-testid="saved-meal-servings-dec"
                    aria-label="Decrease servings"
                    disabled={savedServings <= SAVED_MEAL_SERVINGS_MIN}
                    onClick={() => bumpSavedServings(-SAVED_MEAL_SERVINGS_STEP)}
                    className="flex h-11 w-11 flex-none items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--accent-soft)] text-xl leading-none text-[var(--accent)] disabled:opacity-30"
                  >
                    −
                  </button>
                  {/* Re-keyed so the one-shot .qty-bump tick replays each tap. */}
                  <span
                    key={`sv-${servingsBump}`}
                    className={`min-w-[92px] text-center font-mono text-sm text-[var(--foreground)]${
                      servingsBump > 0 ? " qty-bump" : ""
                    }`}
                  >
                    {formatServings(savedServings)} serving
                    {savedServings === 1 ? "" : "s"}
                  </span>
                  <button
                    type="button"
                    data-testid="saved-meal-servings-inc"
                    aria-label="Increase servings"
                    onClick={() => bumpSavedServings(SAVED_MEAL_SERVINGS_STEP)}
                    className="flex h-11 w-11 flex-none items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--accent-soft)] text-xl leading-none text-[var(--accent)] disabled:opacity-30"
                  >
                    ＋
                  </button>
                </div>

                {/* Macro preview — scaled live with the stepper */}
                {previewLine && (
                  <p className="text-center text-sm tabular-nums text-[var(--muted)]">
                    {previewLine}
                  </p>
                )}

                {/* Expands into the composed meal via addItem — prefills,
                    never locks the form; items stay editable before submit. */}
                <button
                  type="button"
                  data-testid="saved-meal-add"
                  onClick={handleSavedMealAdd}
                  className="w-full min-h-[44px] rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-fg)]"
                >
                  Add to meal
                </button>

                {/* Quick delete — the same scoped core delete_saved_meal runs;
                    past logs from this meal are untouched. Two-tap confirm. */}
                <ConfirmButton
                  label="Remove saved meal"
                  confirmLabel="Remove saved meal · confirm"
                  variant="danger"
                  onConfirm={handleSavedMealDelete}
                  className="w-full min-h-[44px] rounded-lg border border-[var(--danger)]/40 px-4 py-2 text-sm text-[var(--danger)]"
                />
              </div>
            );
          })()}
      </BottomSheet>
    </>
  );

  return { controls, sheet };
}
