"use client";

import { useState } from "react";
import type { ExerciseEditState, ExerciseFieldName } from "@/lib/day-template-edit";
import type { ExercisePrescription } from "@/lib/program-template";

// Label-once numeric grid header/cell classes — cloned from WorkoutEditor's
// set grid (UXR-235-03/24): bare inputMode text inputs, no steppers,
// text-base (16px, iOS-zoom floor), placeholder="—".
const labelClass = "text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]";
const cellInputBase =
  "w-full min-w-[3.5rem] rounded-lg border border-[var(--border)] bg-transparent px-2 py-2.5 " +
  "text-center font-mono text-base min-h-[44px] focus:outline-none focus:border-[var(--accent)] " +
  "disabled:opacity-50";

function formatSecPlaceholder(sec: number | undefined): string {
  if (sec === undefined) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function ExerciseRow({
  ex,
  baseEx,
  onFieldChange,
  onToggleSkip,
}: {
  ex: ExerciseEditState;
  /** The aligned base exercise (undefined for foreign rows — no placeholder, always editable). */
  baseEx: ExercisePrescription | undefined;
  onFieldChange: (field: ExerciseFieldName, value: string) => void;
  onToggleSkip: () => void;
}) {
  const [notesOpen, setNotesOpen] = useState(() => ex.notes.touched && ex.notes.value !== "");

  // "Timed" rows show a single TIME column instead of REPS+WEIGHT — driven
  // by whether the aligned base (or, for foreign rows, the parsed literal)
  // prescribes a duration without reps (UXR-235-02).
  const baseHasDuration = ex.foreign
    ? ex.durationSec.touched && ex.durationSec.value !== ""
    : baseEx?.durationSec !== undefined;
  const baseHasReps = ex.foreign ? ex.reps.touched && ex.reps.value !== "" : baseEx?.reps !== undefined;
  const isTimed = baseHasDuration && !baseHasReps;

  const setsError = ex.fieldErrors.sets;
  const durationError = ex.fieldErrors.durationSec;

  return (
    <div
      data-testid="dwe-exercise-row"
      className={`py-2.5 ${ex.skipped ? "" : "border-b border-[var(--border)] last:border-b-0"}`}
    >
      {/* Name line + Skip toggle */}
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className={`flex-1 text-sm font-medium truncate ${ex.skipped ? "opacity-50" : ""}`}
        >
          {ex.name}
          {ex.equipment && <span className="text-[var(--muted)] font-normal"> · {ex.equipment}</span>}
        </span>
        {!ex.foreign &&
          (ex.skipped ? (
            <button
              type="button"
              data-testid="dwe-skip-toggle"
              onClick={onToggleSkip}
              className="item-row-anim inline-flex items-center rounded-full bg-[var(--muted)]/15 px-2.5 min-h-[32px] text-xs font-medium text-[var(--muted)] shrink-0"
            >
              Skipped today · Undo
            </button>
          ) : (
            <button
              type="button"
              data-testid="dwe-skip-toggle"
              onClick={onToggleSkip}
              aria-label={`Skip ${ex.name} today`}
              className="shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-xs font-medium text-[var(--muted)] hover:text-[var(--foreground)] transition"
            >
              ↺ Skip
            </button>
          ))}
      </div>

      {/* Dimmed body when skipped — inert but visible (UXR-235-08/15) */}
      <div className={ex.skipped ? "opacity-50 pointer-events-none" : undefined} aria-hidden={ex.skipped}>
        {isTimed ? (
          <div className="grid grid-cols-[4.5rem_1fr] gap-2">
            <div>
              <span className={labelClass}>Sets</span>
              <input
                type="text"
                inputMode="numeric"
                aria-label={`${ex.name} sets`}
                value={ex.sets.value}
                placeholder={ex.foreign ? "—" : String(baseEx?.sets ?? "—")}
                disabled={ex.skipped}
                onChange={(e) => onFieldChange("sets", e.target.value)}
                className={`${cellInputBase} mt-0.5 ${setsError ? "border-[var(--danger)]" : ""}`}
              />
            </div>
            <div>
              <span className={labelClass}>Time (sec)</span>
              <input
                type="text"
                inputMode="numeric"
                aria-label={`${ex.name} duration in seconds`}
                value={ex.durationSec.value}
                placeholder={
                  ex.foreign ? "—" : formatSecPlaceholder(baseEx?.durationSec) + ` (${baseEx?.durationSec ?? "—"}s)`
                }
                disabled={ex.skipped}
                onChange={(e) => onFieldChange("durationSec", e.target.value)}
                className={`${cellInputBase} mt-0.5 ${durationError ? "border-[var(--danger)]" : ""}`}
              />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-[4.5rem_1fr_1fr] gap-2">
            <div>
              <span className={labelClass}>Sets</span>
              <input
                type="text"
                inputMode="numeric"
                aria-label={`${ex.name} sets`}
                value={ex.sets.value}
                placeholder={ex.foreign ? "—" : String(baseEx?.sets ?? "—")}
                disabled={ex.skipped}
                onChange={(e) => onFieldChange("sets", e.target.value)}
                className={`${cellInputBase} mt-0.5 ${setsError ? "border-[var(--danger)]" : ""}`}
              />
            </div>
            <div>
              <span className={labelClass}>Reps</span>
              <input
                type="text"
                inputMode="text"
                aria-label={`${ex.name} reps`}
                value={ex.reps.value}
                placeholder={ex.foreign ? "—" : String(baseEx?.reps ?? "—")}
                disabled={ex.skipped}
                onChange={(e) => onFieldChange("reps", e.target.value)}
                className={`${cellInputBase} mt-0.5`}
              />
            </div>
            <div>
              <span className={labelClass}>Weight</span>
              <input
                type="text"
                inputMode="text"
                aria-label={`${ex.name} weight hint`}
                value={ex.weightHint.value}
                placeholder={ex.foreign ? "—" : (baseEx?.weightHint ?? "—")}
                disabled={ex.skipped}
                onChange={(e) => onFieldChange("weightHint", e.target.value)}
                className={`${cellInputBase} mt-0.5`}
              />
            </div>
          </div>
        )}

        {setsError && (
          <p className="text-xs text-[var(--danger)] mt-1" role="alert">
            Sets: {setsError}
          </p>
        )}
        {durationError && (
          <p className="text-xs text-[var(--danger)] mt-1" role="alert">
            Duration: {durationError}
          </p>
        )}

        {/* Notes disclosure — ephemeral open/closed state, excluded from EditorState */}
        <div className="mt-1.5">
          {notesOpen ? (
            <input
              type="text"
              aria-label={`${ex.name} notes`}
              value={ex.notes.value}
              placeholder={ex.foreign ? "—" : (baseEx?.notes ?? "Notes…")}
              disabled={ex.skipped}
              onChange={(e) => onFieldChange("notes", e.target.value)}
              className="item-row-anim w-full rounded-lg border border-[var(--border)] bg-transparent px-2 py-2 text-sm min-h-[44px] focus:outline-none focus:border-[var(--accent)]"
            />
          ) : (
            <button
              type="button"
              data-testid="dwe-notes-disclosure"
              onClick={() => setNotesOpen(true)}
              disabled={ex.skipped}
              className="text-xs text-[var(--muted)] hover:text-[var(--foreground)] transition min-h-[32px] disabled:opacity-50"
            >
              + notes
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
