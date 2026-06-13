"use client";

import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/Card";
import { BottomSheet } from "@/components/BottomSheet";
import { MealComposer } from "@/components/MealComposer";
import { restoreNutrition, type NutritionSnapshot } from "@/lib/workout-actions";
import type { LibraryFood } from "@/lib/food-types";
import type { NutritionItem } from "@/lib/nutrition-log-ops";

// ── Serialized row + group shape (built server-side in nutrition/page.tsx) ──────

export type NutritionRowData = {
  id: string;
  mealType: string;
  /** Human label, e.g. "Lunch". */
  label: string;
  items: NutritionItem[];
  /** Pre-rendered "97% beef (8 oz), …" summary for the collapsed row. */
  summary: string;
  notes: string | null;
  /** "1:24 PM" — the row's logged time. */
  timeLabel: string;
  /** USER_TZ wall-clock "YYYY-MM-DDTHH:MM" seed for MealComposer's When picker. */
  datetimeLocal: string;
  /** Real instant (ISO) — restore snapshot, no TZ reparse. */
  dateISO: string;
  macros: NutritionSnapshot["macros"];
  /** Planned calorie target for this slot, when the day has a nutrition plan. */
  plannedTarget?: number;
};

export type NutritionDayGroup = {
  day: string;
  dayLabel: string;
  rows: NutritionRowData[];
};

// Undo window. Provisional — UXR-meal-edit-24.
const UNDO_WINDOW_MS = 5000; /* ⚠ playtest 4–6s */

type UndoState = { id: string; label: string; snapshot: NutritionSnapshot };

/**
 * Client island for the /nutrition logged-meal list (UXR-meal-edit-01,14).
 *
 * The server page renders the day-grouped reads and hands them here. This island
 * owns the edit-in-place sheet (`openId`) and the optimistic delete + Undo state.
 * Tapping a row's Edit opens the BottomSheet over the list — no route change. The
 * full-page /nutrition/[id]/edit route is kept as a deep-link fallback (Direction
 * C) and is NOT deleted.
 *
 * Delete mechanism (UXR-meal-edit-13): MealComposer's own two-tap Delete commits
 * deleteNutrition (which now revalidates without redirecting), then fires
 * onDeleted. We optimistically hide the row, close the sheet, and surface an Undo
 * bar for UNDO_WINDOW_MS. Undo re-creates the meal via restoreNutrition (new id);
 * letting the window elapse simply drops the bar (the delete already committed).
 * NOTE for the polish slice: a true deferred-commit (hold deleteNutrition until
 * the window elapses) would need MealComposer's Delete to report intent instead
 * of committing — out of scope here (don't reopen the composer). Commit+restore
 * is the documented variation; restoreNutrition exists for exactly this.
 */
export function NutritionList({
  groups,
  quickPickFoods,
}: {
  groups: NutritionDayGroup[];
  quickPickFoods?: LibraryFood[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  // Optimistic hide before/around revalidation. Keyed on the (old) row id.
  const [removedIds, setRemovedIds] = useState<Set<string>>(() => new Set());
  const [undo, setUndo] = useState<UndoState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear any pending undo timer on unmount (timer × revalidate hygiene).
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const allRows = groups.flatMap((g) => g.rows);
  const openRow = openId != null ? allRows.find((r) => r.id === openId) ?? null : null;

  function clearTimer() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function handleDeleted(row: NutritionRowData) {
    setOpenId(null);
    setRemovedIds((prev) => {
      const next = new Set(prev);
      next.add(row.id);
      return next;
    });
    clearTimer();
    setUndo({
      id: row.id,
      label: row.label,
      snapshot: {
        mealType: row.mealType,
        items: row.items,
        notes: row.notes,
        dateISO: row.dateISO,
        macros: row.macros,
      },
    });
    timerRef.current = setTimeout(() => {
      setUndo(null);
      timerRef.current = null;
    }, UNDO_WINDOW_MS);
  }

  function handleUndo() {
    clearTimer();
    const snap = undo?.snapshot;
    const oldId = undo?.id;
    setUndo(null);
    if (oldId) {
      setRemovedIds((prev) => {
        const next = new Set(prev);
        next.delete(oldId);
        return next;
      });
    }
    // Re-create the meal (new id) + revalidate → it reappears in the list.
    if (snap) void restoreNutrition(snap);
  }

  return (
    <div data-testid="nutrition-list" className="space-y-4">
      {groups.map((group) => {
        const visible = group.rows.filter((r) => !removedIds.has(r.id));
        if (visible.length === 0) return null;
        return (
          <Card key={group.day} title={group.dayLabel}>
            <ul className="space-y-3">
              {visible.map((row) => (
                <li key={row.id} className="border-l-2 border-[var(--border)] pl-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs uppercase tracking-wide text-[var(--muted)]">
                      {row.label}
                    </span>
                    <button
                      type="button"
                      data-testid="meal-edit-open"
                      onClick={() => setOpenId(row.id)}
                      className="min-h-[44px] -my-2 text-xs text-[var(--accent)]"
                    >
                      Edit
                    </button>
                  </div>
                  <p className="text-sm">{row.summary}</p>
                  {row.notes && (
                    <p className="text-xs text-[var(--muted)] italic mt-0.5">{row.notes}</p>
                  )}
                  <p className="text-xs text-[var(--muted)] mt-0.5">{row.timeLabel}</p>
                </li>
              ))}
            </ul>
          </Card>
        );
      })}

      {/*
        Edit-in-place sheet (UXR-meal-edit-01). One BottomSheet hosts the open
        meal's MealComposer. onSaved closes back to the list (already revalidated
        → the row shows new text at the same scroll); onDeleted runs the
        optimistic-delete/Undo flow above.

        ⚠ verify on iOS Safari with keyboard open; fallback = Direction C
        full-page (the /nutrition/[id]/edit route still exists). The composer's
        macro summary header + Save footer are intended to be position:sticky
        within this BottomSheet scroll container (UXR-meal-edit-14/29) — making
        them actually sticky is the motion/polish slice's job (the composer's
        internal layout is out of scope here). If sticky-in-dialog fails the iOS
        keyboard playtest, route edits to the full-page fallback instead.

        ScanFoodSheet is rendered by MealComposer as a sibling OUTSIDE its <form>
        (and portaled to body by BottomSheet) — we do not wrap it in another form.
      */}
      <BottomSheet
        open={openId != null}
        onClose={() => setOpenId(null)}
        title={openRow ? `Edit · ${openRow.label}` : "Edit meal"}
        data-testid="meal-edit-sheet"
      >
        {openRow && (
          <div className="px-4 pb-4 pt-3">
            <MealComposer
              mode="edit"
              id={openRow.id}
              defaults={{
                mealType: openRow.mealType,
                items: openRow.items,
                notes: openRow.notes ?? "",
                date: openRow.datetimeLocal,
                macros: openRow.macros,
              }}
              quickPickFoods={quickPickFoods}
              plannedTarget={openRow.plannedTarget}
              onSaved={() => setOpenId(null)}
              onDeleted={() => handleDeleted(openRow)}
            />
          </div>
        )}
      </BottomSheet>

      {/* Undo bar (UXR-meal-edit-13). Reduced-motion: appears instantly (no
          slide) — the window timing is logic, unchanged. The `.undo-bar` class
          is the motion hook the polish slice targets for the slide-up. */}
      {undo && (
        <div
          data-testid="undo-bar"
          role="status"
          aria-live="polite"
          className="undo-bar fixed inset-x-0 bottom-0 z-50 mx-auto flex max-w-md items-center justify-between gap-3 border-t border-[var(--border)] bg-[var(--card)] px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-sm"
        >
          <span className="text-sm text-[var(--foreground)]">
            Deleted {undo.label}
          </span>
          <button
            type="button"
            data-testid="undo-restore"
            onClick={handleUndo}
            className="min-h-[44px] rounded-lg border border-[var(--border)] px-4 text-sm font-semibold text-[var(--accent)]"
          >
            Undo
          </button>
        </div>
      )}
    </div>
  );
}
