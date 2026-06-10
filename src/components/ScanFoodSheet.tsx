"use client";

import { startTransition, useEffect, useState } from "react";
import { BottomSheet } from "@/components/BottomSheet";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { MACRO_KEYS } from "@/lib/food-types";
import type {
  LibraryFood,
  FoodMacros,
  AddFoodPayload,
  BarcodeLookupResult,
} from "@/lib/food-types";
// INTEGRATION: swap to "@/lib/food-actions" when Stream A lands
import { lookupBarcode } from "@/lib/food-actions-stub";

// ──────────────────────────────────────────────────────────────────────────────
// Props
// ──────────────────────────────────────────────────────────────────────────────

export type ScanFoodSheetProps = {
  open: boolean;
  onClose: () => void;
  onAdd: (payload: AddFoodPayload) => void;
  /** When provided (chip tap), skip scan phase and open directly at confirm. */
  initialFood?: LibraryFood;
};

// ──────────────────────────────────────────────────────────────────────────────
// Phase type
// ──────────────────────────────────────────────────────────────────────────────

type Phase = "scan" | "lookup" | "confirm" | "not_found" | "error";

// ──────────────────────────────────────────────────────────────────────────────
// Stepper constants
// ──────────────────────────────────────────────────────────────────────────────

const MAX_SERVINGS = 20;
const STEP = 0.5;
const MIN_SERVINGS = 0.5;

// ──────────────────────────────────────────────────────────────────────────────
// Macro display config — mirrors MacroInputs.tsx labels exactly
// ──────────────────────────────────────────────────────────────────────────────

const MACRO_DISPLAY = [
  { key: "calories",  label: "Cal",     unit: "",   isHero: true },
  { key: "proteinG",  label: "Protein", unit: " g",  isHero: false },
  { key: "carbsG",    label: "Carbs",   unit: " g",  isHero: false },
  { key: "fatG",      label: "Fat",     unit: " g",  isHero: false },
  { key: "fiberG",    label: "Fiber",   unit: " g",  isHero: false },
  { key: "sodiumMg",  label: "Sodium",  unit: " mg", isHero: false },
] as const satisfies ReadonlyArray<{ key: typeof MACRO_KEYS[number]; label: string; unit: string; isHero: boolean }>;

// ──────────────────────────────────────────────────────────────────────────────
// Scaled macro preview (live, based on servings slider)
// ──────────────────────────────────────────────────────────────────────────────

function scaledMacros(food: LibraryFood, servings: number): FoodMacros {
  const p = food.perServing;
  const scale = (v: number | null, isInt: boolean): number | null => {
    if (v == null) return null;
    const s = v * servings;
    return isInt ? Math.round(s) : Math.round(s * 10) / 10;
  };
  return {
    calories:  scale(p.calories,  true),
    proteinG:  scale(p.proteinG,  false),
    carbsG:    scale(p.carbsG,    false),
    fatG:      scale(p.fatG,      false),
    fiberG:    scale(p.fiberG,    false),
    sodiumMg:  scale(p.sodiumMg,  true),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// ScanFoodSheet
// ──────────────────────────────────────────────────────────────────────────────

/**
 * ScanFoodSheet — nested BottomSheet for barcode scanning + food confirmation.
 *
 * Phases: scan → lookup → confirm | not_found | error
 * When `initialFood` is provided (chip tap), opens directly at confirm.
 * Camera (BarcodeScanner) is active ONLY in the scan phase.
 *
 * Designed for `next/dynamic ssr:false` consumption by the parent form:
 *   import dynamic from "next/dynamic";
 *   const ScanFoodSheet = dynamic(
 *     () => import("@/components/ScanFoodSheet").then(m => m.ScanFoodSheet),
 *     { ssr: false }
 *   );
 */
export function ScanFoodSheet({ open, onClose, onAdd, initialFood }: ScanFoodSheetProps) {
  const [phase, setPhase] = useState<Phase>(() =>
    initialFood ? "confirm" : "scan"
  );
  const [food, setFood] = useState<LibraryFood | null>(initialFood ?? null);
  const [servings, setServings] = useState(1);
  const [manualCode, setManualCode] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [retryCode, setRetryCode] = useState<string | null>(null);

  // ── Reset state on every open ─────────────────────────────────────────────
  // Batched inside startTransition so they are non-urgent updates (avoids
  // cascading high-priority renders on sheet open; satisfies the
  // react-hooks/set-state-in-effect lint requirement).
  useEffect(() => {
    if (!open) return;
    startTransition(() => {
      if (initialFood) {
        setPhase("confirm");
        setFood(initialFood);
        setServings(1);
      } else {
        setPhase("scan");
        setFood(null);
        setServings(1);
        setManualCode("");
        setManualError(null);
        setRetryCode(null);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]); // intentionally omits initialFood — only trigger on open state change

  // ── Stepper ───────────────────────────────────────────────────────────────

  function decrement() {
    setServings((s) => Math.max(MIN_SERVINGS, Math.round((s - STEP) * 10) / 10));
  }
  function increment() {
    setServings((s) => Math.min(MAX_SERVINGS, Math.round((s + STEP) * 10) / 10));
  }

  // ── Lookup handler (camera + manual path) ─────────────────────────────────

  async function handleLookup(raw: string) {
    const trimmed = raw.trim();
    if (!/^\d{8,14}$/.test(trimmed)) {
      setManualError("Enter 8–14 digits");
      return;
    }
    setManualError(null);
    setRetryCode(trimmed);
    setPhase("lookup");

    const result: BarcodeLookupResult = await lookupBarcode(trimmed);

    if (result.status === "found") {
      setFood(result.food);
      setServings(1);
      setPhase("confirm");
    } else if (result.status === "not_found") {
      setPhase("not_found");
    } else {
      setPhase("error");
    }
  }

  // ── Sheet title by phase ──────────────────────────────────────────────────

  const sheetTitle =
    phase === "confirm" ? "Add food" : "Scan a barcode";

  // ── Scaled preview (confirm phase) ────────────────────────────────────────

  const preview = food ? scaledMacros(food, servings) : null;

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={sheetTitle}
      data-testid="scanfood-sheet"
    >
      <div className="flex flex-col gap-4 px-4 pt-3 pb-6">

        {/* ── SCAN PHASE ───────────────────────────────────────────────── */}
        {(phase === "scan" || phase === "not_found" || phase === "error") && (
          <>
            {/* BarcodeScanner — active only in scan phase */}
            <BarcodeScanner
              active={phase === "scan"}
              onDetected={(code) => handleLookup(code)}
            />

            {/* Not-found / Error states — shown above the manual strip */}
            {phase === "not_found" && (
              <div className="flex flex-col items-center gap-2 text-center" aria-live="polite">
                <p className="text-sm text-[var(--foreground)]">
                  Not in OpenFoodFacts — log it manually
                </p>
                <button
                  type="button"
                  onClick={() => setPhase("scan")}
                  className="text-sm text-[var(--accent)] underline underline-offset-2"
                >
                  Scan again
                </button>
              </div>
            )}

            {phase === "error" && (
              <div className="flex flex-col items-center gap-2 text-center" aria-live="polite">
                <p className="text-sm text-[var(--foreground)]">
                  Network error — check your connection
                </p>
                <button
                  type="button"
                  onClick={() => retryCode && handleLookup(retryCode)}
                  className="text-sm text-[var(--accent)] underline underline-offset-2"
                >
                  Retry
                </button>
              </div>
            )}

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-[var(--border)]" />
              <span className="text-xs text-[var(--muted)] shrink-0">or enter digits</span>
              <div className="flex-1 h-px bg-[var(--border)]" />
            </div>

            {/* Manual digit strip — ALWAYS present; never blocked by camera states */}
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                pattern="\d{8,14}"
                data-testid="manual-barcode-input"
                aria-label="Barcode digits"
                placeholder="0 1 2 3 4 5 6 7 8 9…"
                value={manualCode}
                onChange={(e) => {
                  // Only allow digits
                  setManualCode(e.target.value.replace(/\D/g, ""));
                  if (manualError) setManualError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleLookup(manualCode);
                }}
                className="flex-1 rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-base min-h-[44px]"
              />
              <button
                type="button"
                data-testid="manual-lookup-btn"
                onClick={() => handleLookup(manualCode)}
                className="rounded-lg bg-[var(--accent)] text-[var(--accent-fg)] px-4 min-h-[44px] text-sm font-medium shrink-0"
              >
                Look up
              </button>
            </div>

            {/* Inline validation error */}
            {manualError && (
              <p className="text-xs text-[var(--danger,#A82A1F)]" role="alert">
                {manualError}
              </p>
            )}
          </>
        )}

        {/* ── LOOKUP PHASE ─────────────────────────────────────────────── */}
        {phase === "lookup" && (
          <div className="flex flex-col items-center gap-4 py-8" aria-live="polite">
            {/* Spinner — accent border, transparent top = spinning arc */}
            <div
              className="w-8 h-8 rounded-full border-2 border-[var(--accent)] animate-spin"
              style={{ borderTopColor: "transparent" }}
              role="status"
              aria-label="Looking up barcode"
            />
            <p className="text-sm text-[var(--muted)]">Looking up barcode…</p>
          </div>
        )}

        {/* ── CONFIRM PHASE ────────────────────────────────────────────── */}
        {phase === "confirm" && food && (
          <>
            {/* Food card */}
            <div
              data-testid="confirm-food-card"
              className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4"
            >
              <p className="text-base font-semibold text-[var(--foreground)] leading-snug">
                {food.name}
              </p>
              {(food.brand || food.servingSize) && (
                <p className="text-xs text-[var(--muted)] mt-0.5">
                  {[food.brand, food.servingSize].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>

            {/* Servings stepper — ≥44px per cell, 0.5 steps, min 0.5, max 20 */}
            <div className="flex flex-col items-center gap-1">
              <p className="text-xs text-[var(--muted)]">Servings</p>
              <div className="flex items-center">
                {/* Decrement */}
                <button
                  type="button"
                  data-testid="servings-stepper-dec"
                  onClick={decrement}
                  disabled={servings <= MIN_SERVINGS}
                  aria-label="Decrease servings"
                  className="flex items-center justify-center w-11 h-11 rounded-l-lg border border-[var(--border)] text-lg font-medium text-[var(--foreground)] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  −
                </button>

                {/* Value — accent-soft tint to distinguish from −/+ buttons */}
                <div
                  data-testid="servings-stepper-value"
                  className="flex items-center justify-center w-16 h-11 border-y border-[var(--border)] text-lg font-medium text-[var(--foreground)]"
                  style={{ background: "var(--accent-soft)" }}
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {servings}
                </div>

                {/* Increment */}
                <button
                  type="button"
                  data-testid="servings-stepper-inc"
                  onClick={increment}
                  disabled={servings >= MAX_SERVINGS}
                  aria-label="Increase servings"
                  className="flex items-center justify-center w-11 h-11 rounded-r-lg border border-[var(--border)] text-lg font-medium text-[var(--foreground)] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  +
                </button>
              </div>
              <p className="text-[10px] text-[var(--muted)]">
                {food.basis === "100g" ? "× 100 g" : "servings"}
              </p>
            </div>

            {/* Scaled macro preview — mirrors MacroInputs 3-col grid */}
            {preview && (
              <div
                data-testid="macro-preview"
                className="grid grid-cols-3 gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3"
              >
                {MACRO_DISPLAY.map(({ key, label, unit, isHero }) => {
                  const val = preview[key];
                  return (
                    <div key={key} className="flex flex-col gap-0.5">
                      <span className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
                        {label}
                      </span>
                      <span
                        className={
                          isHero
                            ? "text-lg font-semibold text-[var(--foreground)]"
                            : "text-base text-[var(--foreground)]"
                        }
                      >
                        {val != null ? `${val}${unit}` : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add to meal CTA */}
            <button
              type="button"
              data-testid="add-to-meal-btn"
              onClick={() => {
                onAdd({
                  food: food,
                  servings,
                  // chipSource: true when initialFood was provided (chip tap path).
                  // LogNutritionForm MUST call recordFoodUse fire-and-forget when chipSource=true.
                  // Scan path (chipSource=false): lookupBarcode already bumped usageCount.
                  chipSource: initialFood !== undefined,
                });
                onClose();
              }}
              className="w-full rounded-lg bg-[var(--accent)] text-[var(--accent-fg)] py-3 text-base font-medium min-h-[44px]"
            >
              Add to meal
            </button>
          </>
        )}
      </div>
    </BottomSheet>
  );
}
