"use client";

// WorkoutLoggerForm — REQ-65-2 day-page logger island.
//
// UXR decisions encoded:
//   UXR-65-11 DROPPED  — no "as prescribed" batch-resolve button.
//   UXR-65-29          — timeHHMM composed into startedAt via server action.
//   UXR-65-30 APPROVED — inline form, no BottomSheet.
//   DA M5              — setIndex 1..N assigned in server action.
// Placeholders are muted-italic and never submitted (empty string → skipped).

import { useState, useTransition } from "react";
import type { PrefilledExercise } from "@/lib/prescription-prefill";
import type { RecordSet } from "@/lib/records";
import { logManualWorkout, type ManualExerciseRow } from "@/lib/day-log-actions";
import { Bullseye } from "@/components/Bullseye";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SetRow {
  reps: string;
  weightLb: string;
  durationSec: string;
  rpe: string;
  notes: string;
}

interface ExerciseRow {
  name: string;
  equipment: string;
  notes: string;
  sets: SetRow[];
}

function emptySet(): SetRow {
  return { reps: "", weightLb: "", durationSec: "", rpe: "", notes: "" };
}

function emptyExercise(): ExerciseRow {
  return { name: "", equipment: "", notes: "", sets: [emptySet()] };
}

function prefillToRow(ex: PrefilledExercise): ExerciseRow {
  const setCount = Math.max(1, ex.sets);
  const sets: SetRow[] = Array.from({ length: setCount }, () => ({
    reps: typeof ex.repsValue === "number" ? String(ex.repsValue) : "",
    weightLb: "",
    durationSec: typeof ex.durationSec === "number" ? String(ex.durationSec) : "",
    rpe: "",
    notes: "",
  }));
  return {
    name: ex.name,
    equipment: ex.equipment ?? "",
    notes: ex.notes ?? "",
    sets,
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SetRowInputs({
  setIdx,
  row,
  repsPlaceholder,
  weightPlaceholder,
  durationPlaceholder,
  onChange,
  onRemove,
  canRemove,
}: {
  setIdx: number;
  row: SetRow;
  repsPlaceholder?: string;
  weightPlaceholder?: string;
  durationPlaceholder?: string;
  onChange: (patch: Partial<SetRow>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  return (
    <div className="grid grid-cols-[auto_1fr_1fr_1fr_auto] gap-1.5 items-center">
      {/* Set label */}
      <span className="text-xs text-[var(--muted)] w-5 text-center tabular-nums">{setIdx + 1}</span>

      {/* Reps */}
      <input
        type="text"
        inputMode="numeric"
        value={row.reps}
        onChange={(e) => onChange({ reps: e.target.value })}
        placeholder={repsPlaceholder ?? "Reps"}
        aria-label={`Set ${setIdx + 1} reps`}
        className={[
          "rounded border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm min-h-[44px]",
          !row.reps && repsPlaceholder
            ? "italic text-[var(--muted)] placeholder:italic placeholder:text-[var(--muted)]"
            : "placeholder:text-[var(--muted)]",
        ].join(" ")}
      />

      {/* Weight */}
      <input
        type="text"
        inputMode="decimal"
        value={row.weightLb}
        onChange={(e) => onChange({ weightLb: e.target.value })}
        placeholder={weightPlaceholder ?? "lb"}
        aria-label={`Set ${setIdx + 1} weight (lb)`}
        className={[
          "rounded border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm min-h-[44px]",
          !row.weightLb && weightPlaceholder
            ? "italic text-[var(--muted)] placeholder:italic placeholder:text-[var(--muted)]"
            : "placeholder:text-[var(--muted)]",
        ].join(" ")}
      />

      {/* Duration */}
      <input
        type="text"
        inputMode="numeric"
        value={row.durationSec}
        onChange={(e) => onChange({ durationSec: e.target.value })}
        placeholder={durationPlaceholder ? `${durationPlaceholder}s` : "Sec"}
        aria-label={`Set ${setIdx + 1} duration (sec)`}
        className={[
          "rounded border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm min-h-[44px]",
          !row.durationSec && durationPlaceholder
            ? "italic text-[var(--muted)] placeholder:italic placeholder:text-[var(--muted)]"
            : "placeholder:text-[var(--muted)]",
        ].join(" ")}
      />

      {/* Remove set button */}
      <button
        type="button"
        disabled={!canRemove}
        onClick={onRemove}
        aria-label="Remove set"
        className="min-h-[44px] min-w-[44px] flex items-center justify-center text-[var(--muted)] disabled:opacity-30 hover:text-[var(--danger)] transition"
      >
        ×
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PR Strip — shown after successful log
// ---------------------------------------------------------------------------

function RecordStrip({ records, workoutId }: { records: RecordSet[]; workoutId: string }) {
  const top = records.slice(0, 3);
  if (top.length === 0) return null;

  return (
    <div
      className="rounded-xl border border-[var(--target)] p-3 space-y-1.5 mt-3"
      style={{ backgroundColor: "color-mix(in srgb, var(--target) 8%, var(--card))" }}
      role="status"
      aria-live="polite"
    >
      <p className="text-xs font-semibold text-[var(--target)] uppercase tracking-wide">New bests</p>
      {top.map((r) => (
        <div key={`${r.name}-${r.kind}`} className="flex items-center gap-2 text-sm">
          <Bullseye filled size={14} aria-hidden />
          <span className="font-medium flex-1 min-w-0 truncate">{r.name}</span>
          <span className="text-[var(--target)] font-semibold tabular-nums shrink-0">
            {r.kind === "rm"
              ? `${Math.round(r.value)} lb (1RM)`
              : r.kind === "reps"
                ? `${r.value} reps`
                : `${r.value}s`}
          </span>
        </div>
      ))}
      <Link
        href={`/workouts/${workoutId}`}
        className="block text-xs text-[var(--accent)] mt-1 hover:underline"
      >
        View workout →
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function WorkoutLoggerForm({
  dateKey,
  defaultTitle,
  defaultTimeHHMM,
  prefill,
}: {
  dateKey: string;
  defaultTitle: string;
  defaultTimeHHMM: string;
  prefill: PrefilledExercise[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ id: string; records: RecordSet[] } | null>(null);

  // Form state
  const [title, setTitle] = useState(defaultTitle);
  const [timeHHMM, setTimeHHMM] = useState(defaultTimeHHMM);
  const [workoutNotes, setWorkoutNotes] = useState("");

  // Initialize from prefill (or a single blank row if no prefill)
  const [exercises, setExercises] = useState<ExerciseRow[]>(() =>
    prefill.length > 0 ? prefill.map(prefillToRow) : [emptyExercise()],
  );

  // Build section headers: track which exercises start a new block.
  const blockBoundaries = new Set<number>();
  if (prefill.length > 0) {
    let lastLabel = "";
    prefill.forEach((p, i) => {
      if (p.blockLabel !== lastLabel) {
        blockBoundaries.add(i);
        lastLabel = p.blockLabel;
      }
    });
  }

  function updateExercise(idx: number, patch: Partial<ExerciseRow>) {
    setExercises((prev) => prev.map((ex, i) => (i === idx ? { ...ex, ...patch } : ex)));
  }

  function updateSet(exIdx: number, setIdx: number, patch: Partial<SetRow>) {
    setExercises((prev) =>
      prev.map((ex, i) =>
        i === exIdx
          ? {
              ...ex,
              sets: ex.sets.map((s, j) => (j === setIdx ? { ...s, ...patch } : s)),
            }
          : ex,
      ),
    );
  }

  function addSet(exIdx: number) {
    setExercises((prev) =>
      prev.map((ex, i) =>
        i === exIdx ? { ...ex, sets: [...ex.sets, emptySet()] } : ex,
      ),
    );
  }

  function removeSet(exIdx: number, setIdx: number) {
    setExercises((prev) =>
      prev.map((ex, i) =>
        i === exIdx
          ? { ...ex, sets: ex.sets.filter((_, j) => j !== setIdx) }
          : ex,
      ),
    );
  }

  function addExercise() {
    setExercises((prev) => [...prev, emptyExercise()]);
  }

  function removeExercise(idx: number) {
    setExercises((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleSubmit() {
    setError(null);

    // Build ManualExerciseRow[] — skip empty-name exercises; skip empty sets.
    const rows: ManualExerciseRow[] = exercises
      .filter((ex) => ex.name.trim().length > 0)
      .map((ex, orderIndex) => ({
        name: ex.name.trim(),
        equipment: ex.equipment.trim() || null,
        notes: ex.notes.trim() || null,
        orderIndex,
        sets: ex.sets
          .map((s) => ({
            reps: s.reps.trim() ? parseInt(s.reps, 10) || null : null,
            weightLb: s.weightLb.trim() ? parseFloat(s.weightLb) || null : null,
            durationSec: s.durationSec.trim() ? parseInt(s.durationSec, 10) || null : null,
            rpe: s.rpe.trim() ? parseFloat(s.rpe) || null : null,
            notes: s.notes.trim() || null,
          }))
          .filter(
            (s) => s.reps != null || s.weightLb != null || s.durationSec != null,
          ),
      }));

    startTransition(async () => {
      try {
        const result = await logManualWorkout({
          dateKey,
          title: title.trim() || null,
          timeHHMM,
          notes: workoutNotes.trim() || null,
          exercises: rows,
        });
        setSuccess({ id: result.id, records: result.recordsSet });
        setOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  // Success state — PR strip shown instead of the form.
  if (success) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
        <p className="text-sm font-medium text-[var(--foreground)]">Workout logged.</p>
        <RecordStrip records={success.records} workoutId={success.id} />
      </div>
    );
  }

  // Collapsed state — accent CTA door.
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full min-h-[52px] rounded-2xl border-2 border-[var(--accent)] text-[var(--accent)] font-medium text-sm flex items-center justify-center gap-2 hover:bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] transition"
      >
        <span aria-hidden>+</span> Log workout
      </button>
    );
  }

  // Expanded state — full form.
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-base">Log workout</h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close logger"
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-[var(--muted)] hover:text-[var(--foreground)] transition"
        >
          ×
        </button>
      </div>

      {/* Title + time row */}
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Title</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Workout title"
            className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm min-h-[44px] placeholder:text-[var(--muted)]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Time</span>
          <input
            type="time"
            value={timeHHMM}
            onChange={(e) => setTimeHHMM(e.target.value)}
            className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm min-h-[44px] w-28"
          />
        </label>
      </div>

      {/* Exercises */}
      <div className="space-y-4">
        {exercises.map((ex, exIdx) => {
          const prefillEntry = prefill[exIdx];
          const repsPlaceholder = prefillEntry?.repsPlaceholder;
          const weightPlaceholder = prefillEntry?.weightHintPlaceholder;

          return (
            <div key={exIdx} className="space-y-2">
              {/* Block header — shown at block boundaries when using prefill */}
              {prefill.length > 0 && blockBoundaries.has(exIdx) && (
                <p className="text-xs uppercase tracking-wide text-[var(--muted)] pt-1">
                  {prefillEntry?.blockLabel}
                </p>
              )}

              {/* Exercise name row */}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={ex.name}
                  onChange={(e) => updateExercise(exIdx, { name: e.target.value })}
                  placeholder="Exercise name"
                  aria-label={`Exercise ${exIdx + 1} name`}
                  className="flex-1 rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm font-medium min-h-[44px] placeholder:text-[var(--muted)]"
                />
                <button
                  type="button"
                  onClick={() => removeExercise(exIdx)}
                  disabled={exercises.length === 1}
                  aria-label={`Remove exercise ${exIdx + 1}`}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center text-[var(--muted)] disabled:opacity-30 hover:text-[var(--danger)] transition"
                >
                  ×
                </button>
              </div>

              {/* Column headers */}
              <div className="grid grid-cols-[auto_1fr_1fr_1fr_auto] gap-1.5">
                <span className="w-5" />
                <span className="text-xs text-[var(--muted)] text-center">Reps</span>
                <span className="text-xs text-[var(--muted)] text-center">lb</span>
                <span className="text-xs text-[var(--muted)] text-center">Sec</span>
                <span className="w-[44px]" />
              </div>

              {/* Set rows */}
              {ex.sets.map((s, setIdx) => (
                <SetRowInputs
                  key={setIdx}
                  setIdx={setIdx}
                  row={s}
                  repsPlaceholder={repsPlaceholder}
                  weightPlaceholder={weightPlaceholder}
                  onChange={(patch) => updateSet(exIdx, setIdx, patch)}
                  onRemove={() => removeSet(exIdx, setIdx)}
                  canRemove={ex.sets.length > 1}
                />
              ))}

              {/* Add set */}
              <button
                type="button"
                onClick={() => addSet(exIdx)}
                className="min-h-[44px] text-xs text-[var(--accent)] hover:underline px-2"
              >
                + Add set
              </button>

              {/* Exercise notes (template) */}
              {prefillEntry?.notes && (
                <p className="text-xs text-[var(--muted)] italic px-1">{prefillEntry.notes}</p>
              )}
            </div>
          );
        })}
      </div>

      {/* Add exercise */}
      <button
        type="button"
        onClick={addExercise}
        className="min-h-[44px] w-full rounded-lg border border-dashed border-[var(--border)] text-sm text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition"
      >
        + Add exercise
      </button>

      {/* Workout notes */}
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Notes</span>
        <textarea
          rows={2}
          value={workoutNotes}
          onChange={(e) => setWorkoutNotes(e.target.value)}
          placeholder="Optional workout notes"
          className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm resize-y placeholder:text-[var(--muted)]"
        />
      </label>

      {/* Error */}
      {error && (
        <p className="text-sm text-[var(--danger)] border border-[var(--danger)]/30 bg-[var(--danger)]/10 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {/* Submit */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={pending}
        className="w-full min-h-[52px] rounded-xl bg-[var(--accent)] text-[var(--accent-fg)] font-semibold disabled:opacity-50 transition"
      >
        {pending ? "Saving…" : "Log workout"}
      </button>
    </div>
  );
}
