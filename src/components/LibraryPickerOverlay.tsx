"use client";

import { useState, useMemo, useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { classifyFood, type MacroGroup } from "@/lib/food-resolve-local";
import { setFoodFavorite } from "@/lib/food-actions";
import type { LibraryFood } from "@/lib/food-types";

// Stable identity for useSyncExternalStore (same idiom as BottomSheet — see its
// docstring for why this isn't useState + useEffect).
function subscribeNever() {
  return () => {};
}

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
 * LibraryPickerOverlay — portaled top-layer <dialog>.
 *
 * MUST be a portaled dialog, not an in-place `fixed inset-0` div: a CSS
 * transform on any ancestor (e.g. .bottom-sheet-panel's translateY) makes that
 * ancestor the containing block for fixed descendants, so an in-place overlay
 * gets sized/anchored to the sheet panel instead of the viewport and drifts
 * off-screen with it (founder-reported stuck-overlay bug, 7/23). The top layer
 * has no ancestors, so no transform can capture it. Rendering into
 * document.body as a dialog *sibling* (not a nested dialog) is the same
 * pattern BottomSheet uses to dodge the iOS double-dialog dismiss bug — see
 * its docstring. Opened after the Log sheet, it stacks above it in top-layer
 * order; ScanFoodSheet opens later still, so the scan stepper stays on top.
 *
 * Mounted by useFoodComposer in its {sheet} return — OUTSIDE the host <form>.
 * Escape arrives as the native dialog `cancel` event (top-most dialog only).
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
  // Optimistic favorite-pin state per row; server value is the fallback.
  const [favOverrides, setFavOverrides] = useState<Record<string, boolean>>({});

  // Two-phase mount + top-layer promotion. The component only renders while
  // `open`, so the dialog is opened once on portal mount and torn down by
  // unmount (removal from the DOM also removes it from the top layer).
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  });

  // Lock body scroll while open (mirrors BottomSheet). Without this, iOS Safari
  // pans the layout viewport when the search keyboard opens; the fixed overlay is
  // anchored to the layout viewport, so the header (and its ✕) slides off-screen
  // with no way to scroll it back. Capture scroll position on open and restore it
  // on close AND on search blur, in case the keyboard pan leaked through anyway.
  const openScrollYRef = useRef(0);
  useEffect(() => {
    if (!open) return;
    openScrollYRef.current = window.scrollY;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
      window.scrollTo(0, openScrollYRef.current);
    };
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

  // Toggle a row's quick-pick pin, optimistically; roll back on failure.
  function toggleRowFavorite(food: LibraryFood) {
    const next = !(favOverrides[food.id] ?? food.isFavorite ?? false);
    setFavOverrides((o) => ({ ...o, [food.id]: next }));
    setFoodFavorite(food.id, next)
      .then((r) => {
        if (!r.ok) setFavOverrides((o) => ({ ...o, [food.id]: !next }));
      })
      .catch(() => setFavOverrides((o) => ({ ...o, [food.id]: !next })));
  }

  if (!open || !mounted) return null;

  return createPortal(
    // The dialog element itself is the full-viewport scrim — click outside the
    // panel to close (target===currentTarget guard, same as ScanFoodSheet).
    // Top-layer element: no z-index needed; ::backdrop is zeroed since the
    // dialog's own background is the scrim.
    <dialog
      ref={dialogRef}
      data-testid="library-picker-overlay"
      className="m-0 p-0 border-0 fixed inset-0 h-full w-full max-h-full max-w-full overflow-hidden bg-black/45 backdrop:bg-transparent"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClose={onClose}
    >
      {/* Panel — mirrors ScanFoodSheet panel CSS exactly.
          overflow-hidden clips the scroll area to the rounded top + prevents the
          list from bleeding up over the header/tabs. */}
      <div
        className="absolute bottom-0 left-0 right-0 mx-auto max-w-md flex flex-col max-h-[85dvh] overflow-hidden"
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
            // Keyboard closed → undo any layout-viewport pan iOS did to reveal
            // the input, so the header/✕ lands back inside the visible screen.
            onBlur={() => window.scrollTo(0, openScrollYRef.current)}
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
                      {/* ★ — pin to quick-picks without opening the confirm card */}
                      {(() => {
                        const isFav = favOverrides[food.id] ?? food.isFavorite ?? false;
                        return (
                          <button
                            type="button"
                            data-testid={`food-fav-btn-${food.id}`}
                            aria-pressed={isFav}
                            aria-label={
                              isFav
                                ? `Unpin ${food.name} from quick-picks`
                                : `Pin ${food.name} to quick-picks`
                            }
                            title={isFav ? "Pinned to quick-picks" : "Pin to quick-picks"}
                            onClick={() => toggleRowFavorite(food)}
                            className="flex-shrink-0 flex items-center justify-center w-11 h-11 rounded-full text-[var(--muted)] hover:bg-[var(--border)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                            style={isFav ? { color: "var(--accent)" } : undefined}
                          >
                            <svg
                              width="18"
                              height="18"
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
                        );
                      })()}
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
    </dialog>,
    document.body
  );
}
