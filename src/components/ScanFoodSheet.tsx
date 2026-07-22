"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { MACRO_KEYS } from "@/lib/food-types";
import type {
  LibraryFood,
  FoodMacros,
  AddFoodPayload,
  BarcodeLookupResult,
} from "@/lib/food-types";
import { lookupBarcode, setFoodFavorite } from "@/lib/food-actions";
import { servingsFromLastPortion } from "@/lib/food-units";

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

/**
 * Initial stepper value for a food: its last-logged portion (converted to the
 * "servings" multiplier), clamped to the stepper range and rounded to 1dp.
 * Falls back to 1 when the food has never been logged with a recordable portion.
 */
function seedServings(food: LibraryFood): number {
  const s = servingsFromLastPortion(food, food.lastAmount, food.lastUnit);
  if (s == null) return 1;
  const clamped = Math.min(MAX_SERVINGS, Math.max(MIN_SERVINGS, s));
  return Math.round(clamped * 10) / 10;
}

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
 * ScanFoodSheet — in-sheet overlay for barcode scanning + food confirmation.
 *
 * Rendered as a plain (non-dialog) fixed overlay INSIDE the Log sheet's single
 * <dialog>. This guarantees there is only ONE native modal dialog open at any
 * time, eliminating the iOS Safari double-dialog dismiss bug where closing one
 * showModal() dialog also dismisses any other showModal() dialog in the top layer.
 *
 * Overlay structure:
 *   - `fixed inset-0 z-[55]` container with bg-black/45 scrim.
 *   - Bottom-anchored panel that mimics .bottom-sheet-panel (same CSS values).
 *   - Escape handled via a document keydown listener (replacing the native
 *     dialog Esc that we no longer get from a second <dialog>).
 *   - Scrim tap: onClick target===currentTarget guard, same pattern as BottomSheet.
 *   - When open=false, returns null — camera is inactive, overlay is absent.
 *
 * Phases: scan → lookup → confirm | not_found | error
 * When `initialFood` is provided (chip tap), opens directly at confirm.
 * Camera (BarcodeScanner) is active ONLY in the scan phase.
 *
 * Batch mode (no initialFood):
 *   "Add" fires onAdd and returns to scan phase — overlay stays open for the
 *   next item. A "Done" button (≥44px) closes the overlay. The session tally
 *   (items + ~cal) is displayed once ≥1 items have been added.
 *   Camera restart is handled by the `active={open && phase === "scan"}` guard:
 *   when phase transitions confirm→scan, active goes false→true, which triggers
 *   BarcodeScanner's useEffect to call startCamera() with a fresh H-1 generation.
 *
 * Chip mode (initialFood provided):
 *   "Add to meal" fires onAdd AND onClose — the quick path, chip session concept.
 *
 * Camera stop is guaranteed on all close paths by `open &&` in the active prop:
 *   Esc / X / scrim / Done → onClose() → parent sets open=false → component
 *   returns null → BarcodeScanner unmounts, camera stops. The active guard
 *   also ensures camera stays stopped when open but in non-scan phases.
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
  const [servings, setServings] = useState(() =>
    initialFood ? seedServings(initialFood) : 1,
  );
  // Optimistic favorite-pin state for the confirm card's ★ toggle.
  const [isFav, setIsFav] = useState(initialFood?.isFavorite ?? false);
  const [manualCode, setManualCode] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [retryCode, setRetryCode] = useState<string | null>(null);

  // Session tally — tracks items + approx calories added this sheet session.
  // Reset every time the sheet opens fresh. Displayed once ≥1 items added.
  const [sessionTally, setSessionTally] = useState({ items: 0, calories: 0 });

  // isChipMode: opened via chip tap (initialFood provided) → quick-add + close.
  // Batch mode (no initialFood): camera session — add + keep scanning.
  const isChipMode = initialFood !== undefined;

  // ── Stable ref to onClose — avoids stale closure in Escape handler ────────
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  // ── Escape key handler (replaces native <dialog> Esc) ────────────────────
  // The Log sheet's dialog handles its own Esc. We need a separate listener
  // for the overlay so Esc closes the scanner without touching the dialog.
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
      }
    }
    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [open]);

  // ── Body scroll lock while open ───────────────────────────────────────────
  // Mirrors BottomSheet/LibraryPickerOverlay: without it, iOS Safari can pan the
  // layout viewport (e.g. when a field focuses), sliding this fixed overlay —
  // and its ✕ — off-screen. Restore the scroll position on close.
  useEffect(() => {
    if (!open) return;
    const scrollY = window.scrollY;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  // ── Reset state on open/close ─────────────────────────────────────────────
  // On open: full reset to correct initial phase (scan or confirm).
  // On close: reset phase to "scan" so the next open always starts from a
  //   deterministic state. Batched inside startTransition (non-urgent).
  useEffect(() => {
    if (!open) {
      // Reset phase and tally on close.
      startTransition(() => {
        setPhase("scan");
        setSessionTally({ items: 0, calories: 0 });
      });
      return;
    }
    startTransition(() => {
      setSessionTally({ items: 0, calories: 0 }); // always reset tally on fresh open
      if (initialFood) {
        setPhase("confirm");
        setFood(initialFood);
        setServings(seedServings(initialFood));
        setIsFav(initialFood.isFavorite ?? false);
      } else {
        setPhase("scan");
        setFood(null);
        setServings(1);
        setIsFav(false);
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
      setServings(seedServings(result.food));
      setIsFav(result.food.isFavorite ?? false);
      setPhase("confirm");
    } else if (result.status === "not_found") {
      setPhase("not_found");
    } else {
      setPhase("error");
    }
  }

  // ── Add handler ───────────────────────────────────────────────────────────

  function handleAdd() {
    if (!food) return;
    const scaledCal = preview?.calories ?? null;
    onAdd({
      food,
      servings,
      // chipSource: true when initialFood was provided (chip tap path).
      // LogNutritionForm MUST call recordFoodUse fire-and-forget when chipSource=true.
      // Scan path (chipSource=false): lookupBarcode already bumped usageCount.
      chipSource: isChipMode,
    });
    if (isChipMode) {
      // Quick path: close immediately (chip session concept).
      onClose();
    } else {
      // Batch path: increment session tally, return to scan for next item.
      // Camera restart: setting phase to "scan" makes active={open && "scan" === "scan"}
      // = true, which triggers BarcodeScanner's useEffect([active]) → startCamera()
      // with a fresh H-1 generation counter. The previous confirm-phase active=false
      // ensures stopTracks() ran before the restart.
      setSessionTally((t) => ({
        items: t.items + 1,
        calories: t.calories + (scaledCal ?? 0),
      }));
      setPhase("scan");
      setFood(null);
      setServings(1);
      setIsFav(false);
    }
  }

  // ── Favorite toggle (confirm card ★) ──────────────────────────────────────
  // Optimistic: flip local state immediately, persist fire-and-forget. On failure
  // revert so the pin reflects the true stored state.
  function toggleFavorite() {
    if (!food) return;
    const next = !isFav;
    setIsFav(next);
    setFoodFavorite(food.id, next)
      .then((r) => {
        if (!r.ok) setIsFav(!next);
      })
      .catch(() => setIsFav(!next));
  }

  // ── Sheet title by phase ──────────────────────────────────────────────────

  const sheetTitle =
    phase === "confirm" ? "Add food" : "Scan a barcode";

  // ── Scaled preview (confirm phase) ────────────────────────────────────────

  const preview = food ? scaledMacros(food, servings) : null;

  // ── Sparse-data hint (F4) ─────────────────────────────────────────────────
  // Show a muted note when ≥3 of the 6 macros are null in the confirm card.
  const nullMacroCount = food
    ? [
        food.perServing.calories,
        food.perServing.proteinG,
        food.perServing.carbsG,
        food.perServing.fatG,
        food.perServing.fiberG,
        food.perServing.sodiumMg,
      ].filter((v) => v == null).length
    : 0;
  const showSparseHint = nullMacroCount >= 3;

  // ── Session tally line (batch mode, ≥1 items) ─────────────────────────────

  const tallyLine =
    !isChipMode && sessionTally.items >= 1
      ? `Added ${sessionTally.items} item${sessionTally.items !== 1 ? "s" : ""}${
          sessionTally.calories > 0 ? ` · ~${sessionTally.calories} cal` : ""
        }`
      : null;

  // ─────────────────────────────────────────────────────────────────────────
  // Render — when closed, return null (no overlay, no camera)
  // ─────────────────────────────────────────────────────────────────────────

  if (!open) return null;

  return (
    // Outer div: full-viewport scrim. `fixed inset-0` escapes the Log sheet's
    // dialog stacking context and covers the viewport. z-[55] sits above the
    // sheet panel (which has no explicit z-index). bg-black/45 is the scrim.
    // onClick with target===currentTarget: clicking the scrim (not the panel)
    // calls onClose — same pattern as BottomSheet's dialog onClick guard.
    // NO dialog.close() is called anywhere — logOpen (BottomNav) is untouched.
    <div
      data-testid="scanfood-sheet"
      className="fixed inset-0 z-[55] bg-black/45"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Panel — mirrors .bottom-sheet-panel CSS values exactly */}
      <div
        className="absolute bottom-0 left-0 right-0 mx-auto max-w-md
                   flex flex-col max-h-[85dvh]"
        style={{
          background: "var(--card)",
          borderTopLeftRadius: "1rem",
          borderTopRightRadius: "1rem",
        }}
      >
        {/* Header — mirrors BottomSheet header markup */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2 border-b border-[var(--border)]">
          <h2 className="text-base font-semibold text-[var(--foreground)]">
            {sheetTitle}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex items-center justify-center w-11 h-11 rounded-full text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--border)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M12 4L4 12M4 4l8 8"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
          <div className="flex flex-col gap-4 px-4 pt-3 pb-6">

            {/* Session tally — batch mode only; visible in scan + confirm phases once ≥1 added */}
            {tallyLine && (
              <p
                data-testid="session-tally"
                className="text-xs text-center text-[var(--muted)]"
                aria-live="polite"
              >
                {tallyLine}
              </p>
            )}

            {/* ── SCAN PHASE ───────────────────────────────────────────────── */}
            {(phase === "scan" || phase === "not_found" || phase === "error") && (
              <>
                {/* BarcodeScanner — active only while sheet is open AND in scan phase.
                    The `open &&` guard ensures camera stops immediately on any close
                    path (Esc, scrim, X button, Done) even if phase hasn't reset yet. */}
                <BarcodeScanner
                  active={open && phase === "scan"}
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
                      Scan next
                    </button>
                  </div>
                )}

                {phase === "error" && (
                  <div className="flex flex-col items-center gap-2 text-center" aria-live="polite">
                    <p className="text-sm text-[var(--foreground)]">
                      Network error — check your connection
                    </p>
                    <div className="flex items-center gap-4">
                      <button
                        type="button"
                        onClick={() => retryCode && handleLookup(retryCode)}
                        className="text-sm text-[var(--accent)] underline underline-offset-2"
                      >
                        Retry
                      </button>
                      <button
                        type="button"
                        onClick={() => setPhase("scan")}
                        className="text-sm text-[var(--accent)] underline underline-offset-2"
                      >
                        Scan next
                      </button>
                    </div>
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
                      if (e.key === "Enter") {
                        e.preventDefault(); // must NOT submit the outer form
                        if (/^\d{8,14}$/.test(manualCode.trim())) handleLookup(manualCode);
                      }
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

                {/* Done — batch mode only; closes the scanning session */}
                {!isChipMode && (
                  <button
                    type="button"
                    data-testid="scan-done-btn"
                    onClick={onClose}
                    className="w-full rounded-lg border border-[var(--border)] text-[var(--foreground)] py-3 text-base font-medium min-h-[44px]"
                  >
                    Done
                  </button>
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
                  className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-base font-semibold text-[var(--foreground)] leading-snug">
                      {food.name}
                    </p>
                    {(food.brand || food.servingSize) && (
                      <p className="text-xs text-[var(--muted)] mt-0.5">
                        {[food.brand, food.servingSize].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </div>
                  {/* Favorite pin — toggles whether this food is pinned into the quick-pick row */}
                  <button
                    type="button"
                    data-testid="favorite-toggle"
                    onClick={toggleFavorite}
                    aria-pressed={isFav}
                    aria-label={isFav ? "Unpin from quick-picks" : "Pin to quick-picks"}
                    title={isFav ? "Pinned to quick-picks" : "Pin to quick-picks"}
                    className="shrink-0 inline-flex items-center justify-center w-11 h-11 -mt-1 -mr-1 rounded-full text-[var(--muted)] hover:bg-[var(--border)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    style={isFav ? { color: "var(--accent)" } : undefined}
                  >
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill={isFav ? "currentColor" : "none"}
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M12 2.5l2.95 5.98 6.6.96-4.77 4.65 1.13 6.57L12 17.52l-5.9 3.1 1.13-6.57L2.45 9.4l6.6-.96L12 2.5z" />
                    </svg>
                  </button>
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

                {/* Sparse-data hint — shown when ≥3 macros are null */}
                {showSparseHint && (
                  <p className="text-xs text-[var(--muted)] text-center">
                    Limited data for this product — you can edit macros after adding.
                  </p>
                )}

                {/* Add / Add to meal CTA */}
                <button
                  type="button"
                  data-testid="add-to-meal-btn"
                  onClick={handleAdd}
                  className="w-full rounded-lg bg-[var(--accent)] text-[var(--accent-fg)] py-3 text-base font-medium min-h-[44px]"
                >
                  {isChipMode ? "Add to meal" : "Add"}
                </button>

                {/* Done — batch mode only; finishes the scanning session */}
                {!isChipMode && (
                  <button
                    type="button"
                    data-testid="confirm-done-btn"
                    onClick={onClose}
                    className="w-full rounded-lg border border-[var(--border)] text-[var(--foreground)] py-3 text-base font-medium min-h-[44px]"
                  >
                    Done
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
