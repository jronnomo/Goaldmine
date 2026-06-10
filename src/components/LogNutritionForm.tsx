"use client";

import { useState, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { logNutrition } from "@/lib/workout-actions";
import { useFormFeedback } from "@/lib/use-form-feedback";
import { MacroInputs, type MacroValues } from "@/components/MacroInputs";
import { MACRO_KEYS } from "@/lib/food-types";
import type { LibraryFood, AddFoodPayload } from "@/lib/food-types";
import {
  getQuickPickFoods,
  recordFoodUse,
} from "@/lib/food-actions";

// Dynamic import: ScanFoodSheet + zxing-wasm are browser-only.
const ScanFoodSheet = dynamic(
  () =>
    import("@/components/ScanFoodSheet").then((m) => m.ScanFoodSheet),
  { ssr: false }
);

// ── Types ──────────────────────────────────────────────────────────────────────

const MEAL_TYPES = [
  { value: "preworkout", label: "Preworkout" },
  { value: "breakfast", label: "Breakfast" },
  { value: "lunch", label: "Lunch" },
  { value: "snack", label: "Snack" },
  { value: "postworkout", label: "Postworkout" },
  { value: "dinner", label: "Dinner" },
] as const;

type MealType = (typeof MEAL_TYPES)[number]["value"];

function defaultMeal(): MealType {
  const h = new Date().getHours();
  if (h < 10) return "breakfast";
  if (h < 14) return "lunch";
  if (h < 17) return "snack";
  return "dinner";
}

// ── Pure merge helper (exported for testability) ───────────────────────────────

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
 * handled by handleAdd in LogNutritionForm.
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

// ── Component ─────────────────────────────────────────────────────────────────

export function LogNutritionForm({
  quickPickFoods,
}: {
  quickPickFoods?: LibraryFood[];
}) {
  const { pending, error, saved, formRef, submit } = useFormFeedback();
  const [mealType, setMealType] = useState<MealType>(defaultMeal());

  // Controlled form state (new)
  const [itemsText, setItemsText] = useState("");
  const [macros, setMacros] = useState<MacroValues>({
    calories: null,
    proteinG: null,
    carbsG: null,
    fatG: null,
    fiberG: null,
    sodiumMg: null,
  });

  // Quick-pick chip state: two orthogonal state slices, merged via useMemo.
  //   lazyFoods    — fetched on mount (LogLauncher path, no prop)
  //   localAdditions — optimistic prepend on scan add (scan path only)
  const [lazyFoods, setLazyFoods] = useState<LibraryFood[]>([]);
  const [localAdditions, setLocalAdditions] = useState<LibraryFood[]>([]);

  // Derive quickPick: server prop (highest authority) or lazyFoods, with
  // localAdditions prepended and deduped. Avoids setState-in-effect for prop sync
  // (the lint-safe pattern: derive from props directly via useMemo).
  const quickPick = useMemo(() => {
    const base = quickPickFoods ?? lazyFoods;
    const newItems = localAdditions.filter(
      (a) => !base.some((b) => b.id === a.id)
    );
    return [...newItems, ...base].slice(0, 8);
  }, [quickPickFoods, lazyFoods, localAdditions]);

  // Scan sheet state
  const [scanOpen, setScanOpen] = useState(false);
  const [scanFoodInitial, setScanFoodInitial] = useState<
    LibraryFood | undefined
  >(undefined);

  // ── Effects ──────────────────────────────────────────────────────────────

  // Lazy-fetch on LogLauncher path (no prop provided — accordion mount fires this).
  // setState is inside a Promise .then() callback — not synchronously in the
  // effect body, which is the safe pattern for external-system data fetching.
  useEffect(() => {
    if (quickPickFoods !== undefined) return; // server provided → skip
    getQuickPickFoods()
      .then((foods) => setLazyFoods(foods))
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally once on mount

  // ── handleAdd ─────────────────────────────────────────────────────────────

  function handleAdd(payload: AddFoodPayload) {
    const { food, chipSource } = payload;

    // 1 + 2: merge items text and macros (pure)
    const merged = mergeFoodIntoForm(itemsText, macros, payload);
    setItemsText(merged.itemsText);
    setMacros(merged.macroValues);

    // 3. Usage bump (chip path only)
    // Scan path: lookupBarcode() already incremented usageCount. Do NOT call here.
    if (chipSource) {
      recordFoodUse(food.id).catch(() => {});
    }

    // 4. Optimistic chip prepend (scan path only)
    // After a scan adds a food not yet in the visible chips, prepend immediately.
    // Uses localAdditions (merged into quickPick via useMemo) — no direct quickPick mutation.
    if (!chipSource) {
      setLocalAdditions((prev) => {
        if (prev.some((f) => f.id === food.id)) return prev;
        return [food, ...prev];
      });
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        submit(logNutrition, {
          successMsg: "✓ Meal logged",
          onSuccess: () => {
            setMealType(defaultMeal());
            setItemsText("");
            setMacros({
              calories: null,
              proteinG: null,
              carbsG: null,
              fatG: null,
              fiberG: null,
              sodiumMg: null,
            });
            // quickPick is NOT reset — chips persist for the next log
          },
        });
      }}
      className="flex flex-col gap-2"
    >
      {/* Meal type selector */}
      <select
        name="mealType"
        value={mealType}
        onChange={(e) => setMealType(e.target.value as MealType)}
        className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
      >
        {MEAL_TYPES.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>

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

      {/* Items textarea — controlled */}
      <textarea
        name="items"
        required
        rows={3}
        value={itemsText}
        onChange={(e) => setItemsText(e.target.value)}
        placeholder={
          "One item per line. Optional qty after a |\n97% beef | 8 oz\nKroger hamburger buns | 1\nCheddar cheese | 2 slices\nFrozen mixed vegetables | 1 cup"
        }
        className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm resize-y min-h-[96px] font-mono"
      />

      {/* Notes — uncontrolled (reset clears it) */}
      <input
        type="text"
        name="notes"
        placeholder="meal notes (optional)"
        className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
      />

      {/* MacroInputs — controlled */}
      <MacroInputs
        values={macros}
        onChange={(key, val) => setMacros((prev) => ({ ...prev, [key]: val }))}
      />

      {/* Feedback row */}
      <p className="text-xs min-h-[1rem]" aria-live="polite">
        {saved && <span className="text-[var(--success)]">{saved}</span>}
        {error && !saved && (
          <span className="text-[var(--danger)]">{error}</span>
        )}
      </p>

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-[var(--accent)] text-[var(--accent-fg)] px-4 py-2 font-medium disabled:opacity-50"
      >
        {pending ? "Saving…" : "Log meal"}
      </button>

      {/* ScanFoodSheet — lazy-loaded (ssr:false), browser-only */}
      <ScanFoodSheet
        open={scanOpen}
        onClose={() => {
          setScanOpen(false);
          setScanFoodInitial(undefined);
        }}
        onAdd={handleAdd}
        initialFood={scanFoodInitial}
      />
    </form>
  );
}
