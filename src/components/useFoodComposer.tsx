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
  addFoodMacros,
} from "@/lib/food-units";
import { parseFoodQuery } from "@/lib/food-parse";

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
  macros,
  setMacros,
  addItem,
  quickPickFoods,
  libraryFoods,
  onMacrosChanged,
}: {
  macros: MacroValues;
  setMacros: (m: MacroValues) => void;
  /** Called on every food-resolved add (chip / scan / estimate / add-anyway). B-3 rule:
   *  NEVER call setItemsText from food-resolved paths — use addItem instead. */
  addItem: (item: NutritionItem) => void;
  quickPickFoods?: LibraryFood[];
  /** Pre-loaded library foods for the Browse-library picker. */
  libraryFoods?: LibraryFood[];
  /**
   * Fired after a food add merges into macros (chip, scan, OR picker path).
   * MealComposer uses this to trigger flashMacros on the add path (UXR-lib-16).
   * Args: the macros BEFORE the merge and the macros AFTER.
   */
  onMacrosChanged?: (prev: MacroValues, next: MacroValues) => void;
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

  // ── handleAdd ─────────────────────────────────────────────────────────────

  function handleAdd(payload: AddFoodPayload) {
    const { food, servings, chipSource } = payload;

    // 1. Build structured item (B-3: addItem path, NOT setItemsText).
    const snapshot = buildItemSnapshot(food);
    // chip/scan path has no text query → null; defaultUnitForQuery handles it.
    const unit = defaultUnitForQuery(null, snapshot);
    const amount = deriveAmountFromServings(servings, unit, snapshot);
    const qty = buildQtyDisplay(amount, unit, snapshot);
    const structuredItem: NutritionItem = { name: food.name, qty, amount, unit, source: snapshot };

    // 2. Macro update — pure helper; no text line built here (S-6 fix).
    const newMacros = addFoodMacros(macros, food, servings);
    // Fire onMacrosChanged BEFORE setMacros so caller sees old→new (UXR-lib-16)
    onMacrosChanged?.(macros, newMacros);
    setMacros(newMacros);

    // 3. B-3: addItem, NEVER setItemsText from this path.
    addItem(structuredItem);

    // 4. Usage bump (chip path only)
    // Scan path: lookupBarcode() already incremented usageCount. Do NOT call here.
    if (chipSource) {
      recordFoodUse(food.id).catch(() => {});
    }

    // 5. Optimistic chip upsert (scan path only)
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
    const structuredItem: NutritionItem = {
      name: est.food.name,
      qty,
      amount,
      unit,
      source: snapshot,
    };

    // Macro update — use addFoodMacros (S-6 fix).
    const newMacros = addFoodMacros(macros, est.food, est.servings);
    // Fire onMacrosChanged BEFORE setMacros so caller sees old→new (DC-2, UXR-lib-16)
    onMacrosChanged?.(macros, newMacros);
    setMacros(newMacros);

    // B-3: addItem, NEVER setItemsText from this path.
    addItem(structuredItem);

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
    </>
  );

  return { controls, sheet };
}
