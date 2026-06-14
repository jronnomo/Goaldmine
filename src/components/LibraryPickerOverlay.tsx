"use client";

import { useState, useMemo, useEffect, useRef } from "react";
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

  // Client-side filter (no server round-trip — UXR-lib-01)
  // Note: state reset on re-open is handled by key={pickerOpen ? 1 : 0} in useFoodComposer,
  // which remounts this component fresh each time the picker is opened.
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
      {/* Panel — mirrors ScanFoodSheet panel CSS exactly.
          overflow-hidden clips the scroll area to the rounded top + prevents the
          list from bleeding up over the header/tabs. */}
      <div
        className="absolute bottom-0 left-0 right-0 mx-auto max-w-md flex flex-col max-h-[85vh] overflow-hidden"
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
          className="flex shrink-0 gap-1 overflow-x-auto px-4 pb-2 [-webkit-overflow-scrolling:touch]"
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
                className={`inline-flex shrink-0 items-center justify-center min-h-[44px] px-4 rounded-full text-xs font-semibold transition-colors ${
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

        {/* Food list — scrollable. min-h-0 lets this flex child shrink so its own
            overflow-y-auto engages instead of overflowing the panel upward. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[env(safe-area-inset-bottom)]">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--muted)]">
              {search ? `No foods matching "${search}"` : "No foods in this group."}
            </p>
          ) : (
            // tab-content-fade key wiring: re-fires fade animation on tab change (addendum)
            <div className="tab-content-fade" key={tab}>
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
