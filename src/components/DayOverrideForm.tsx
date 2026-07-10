"use client";

import { useRef, useState, useTransition } from "react";
import { ConfirmButton } from "@/components/ConfirmButton";
import { DayWorkoutEditor, type DayWorkoutEditorHandle } from "@/components/DayWorkoutEditor";
import { clearDayOverride, upsertDayOverrideFromForm } from "@/lib/day-actions";

export function DayOverrideForm({
  dateKey,
  defaults,
  hasOverride,
}: {
  dateKey: string;
  defaults: { workoutJson: string; nutritionText: string; mobilityText: string; notes: string };
  hasOverride: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [hasFieldErrors, setHasFieldErrors] = useState(false);
  const editorRef = useRef<DayWorkoutEditorHandle>(null);

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          setError(null);
          // Advanced-tab pre-submit gate (#235 R6): malformed JSON must never
          // reach the server round-trip — block here, error stays in the
          // Advanced tab's own switchError slot.
          if (editorRef.current && !editorRef.current.validateBeforeSubmit()) return;
          try {
            await upsertDayOverrideFromForm(dateKey, fd);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        })
      }
      className="flex flex-col gap-3"
    >
      <DayWorkoutEditor
        ref={editorRef}
        defaultWorkoutJson={defaults.workoutJson}
        onFieldErrorsChange={setHasFieldErrors}
      />

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Nutrition (override)</span>
        <textarea
          name="nutritionText"
          rows={3}
          defaultValue={defaults.nutritionText}
          placeholder="Anything different for today's eating? Leave blank for phase default."
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm resize-y"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Mobility (override)</span>
        <textarea
          name="mobilityText"
          rows={3}
          defaultValue={defaults.mobilityText}
          placeholder="Skip / extend / modify the daily routine for today."
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm resize-y"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Notes</span>
        <input
          name="notes"
          defaultValue={defaults.notes}
          placeholder="Why the override?"
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
        />
      </label>

      {/* Shared error slot (#235 R9/UXR-235-09/10): the baseline-guard covenant
          throw and any other save error land here — below the editor and
          nutrition/mobility/notes fields, above Save/Clear, aria-live so a
          blocked save is announced regardless of scroll position. This is
          the `saveError` root slot; it's a sibling of DayWorkoutEditor's own
          `key={mode}` tab-fade wrapper, so a tab switch never clears it. */}
      {error && (
        <p
          aria-live="polite"
          className="text-sm text-[var(--danger)] border border-[var(--danger)]/30 bg-[var(--danger)]/10 rounded-lg px-3 py-2"
        >
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending || hasFieldErrors}
          className="flex-1 rounded-lg bg-[var(--accent)] text-[var(--accent-fg)] px-4 py-2 font-medium disabled:opacity-50"
        >
          {pending ? "Saving…" : hasOverride ? "Update override" : "Save override"}
        </button>
        {hasOverride && (
          <ConfirmButton
            label="Clear"
            confirmLabel="Clear override · confirm"
            disabled={pending}
            variant="danger"
            onConfirm={() =>
              startTransition(async () => {
                try {
                  await clearDayOverride(dateKey);
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              })
            }
            className="rounded-lg border border-[var(--danger)]/40 text-[var(--danger)] px-3 py-2 text-sm"
          />
        )}
      </div>
    </form>
  );
}
