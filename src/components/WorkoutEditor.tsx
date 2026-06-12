"use client";

import React, { useState, useTransition, useEffect, useRef } from "react";
import { Card } from "@/components/Card";
import { ConfirmButton } from "@/components/ConfirmButton";
import { saveWorkoutEdits, deleteWorkoutAction } from "@/lib/workout-edit-actions";
import type { WorkoutOp, UpdateWorkoutSetCoreInput } from "@/lib/workout-core";

// ─── DTO types (serialisable — all Dates converted to ISO strings server-side) ─

export type WorkoutSetDTO = {
  id: string;
  setIndex: number;
  reps: number | null;
  weightLb: number | null;
  durationSec: number | null;
  rpe: number | null;
};

export type WorkoutExerciseDTO = {
  id: string;
  name: string;
  equipment: string | null;
  notes: string | null;
  sets: WorkoutSetDTO[];
};

export type WorkoutDTO = {
  id: string;
  title: string | null;
  notes: string | null;
  startedAt: string; // ISO string
  status: string;
  exercises: WorkoutExerciseDTO[];
};

// ─── Local edit state ─────────────────────────────────────────────────────────

type EditSet = {
  _key: string;
  id: string | null; // null = new, not yet persisted
  reps: string;
  weightLb: string;
  durationSec: string;
  rpe: string;
};

type EditExercise = {
  _key: string;
  id: string | null; // null = new, not yet persisted
  name: string;
  equipment: string;
  notes: string;
  sets: EditSet[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeKey(): string {
  return typeof crypto !== "undefined"
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

function formatSet(s: Pick<WorkoutSetDTO, "reps" | "weightLb" | "durationSec">): string {
  if (s.weightLb !== null && s.reps !== null) return `${s.weightLb} lb × ${s.reps}`;
  if (s.reps !== null) return `${s.reps} reps`;
  if (s.durationSec !== null) {
    const m = Math.floor(s.durationSec / 60);
    const sec = s.durationSec % 60;
    return `${m}:${String(sec).padStart(2, "0")}`;
  }
  return "—";
}

function dtoToEdit(exercises: WorkoutExerciseDTO[]): EditExercise[] {
  return exercises.map((ex) => ({
    _key: makeKey(),
    id: ex.id,
    name: ex.name,
    equipment: ex.equipment ?? "",
    notes: ex.notes ?? "",
    sets: ex.sets.map((s) => ({
      _key: makeKey(),
      id: s.id,
      reps: s.reps != null ? String(s.reps) : "",
      weightLb: s.weightLb != null ? String(s.weightLb) : "",
      durationSec: s.durationSec != null ? String(s.durationSec) : "",
      rpe: s.rpe != null ? String(s.rpe) : "",
    })),
  }));
}

// Build the minimal diff payload — only changed fields travel over the wire.
function computeDiff(
  initial: WorkoutDTO,
  editTitle: string,
  editNotes: string,
  exercises: EditExercise[],
): {
  header?: { title?: string | null; notes?: string | null };
  setPatches: Array<{ id: string } & UpdateWorkoutSetCoreInput>;
  ops: WorkoutOp[];
} {
  // Header
  const header: { title?: string | null; notes?: string | null } = {};
  if (editTitle !== (initial.title ?? "")) header.title = editTitle || null;
  if (editNotes !== (initial.notes ?? "")) header.notes = editNotes || null;

  const setPatches: Array<{ id: string } & UpdateWorkoutSetCoreInput> = [];
  const ops: WorkoutOp[] = [];

  // Index for O(1) lookups
  const initSetMap = new Map(
    initial.exercises.flatMap((ex) => ex.sets.map((s) => [s.id, s])),
  );
  const seenExIds = new Set<string>();
  const seenSetIds = new Set<string>();

  for (const ex of exercises) {
    if (ex.id !== null) {
      // Existing exercise — check its sets
      seenExIds.add(ex.id);
      for (const set of ex.sets) {
        if (set.id !== null) {
          // Existing set — build patch for changed fields only
          seenSetIds.add(set.id);
          const initSet = initSetMap.get(set.id);
          if (initSet) {
            const patch: UpdateWorkoutSetCoreInput = {};
            const reps = set.reps !== "" ? Number(set.reps) : null;
            const weightLb = set.weightLb !== "" ? Number(set.weightLb) : null;
            const durationSec = set.durationSec !== "" ? Number(set.durationSec) : null;
            const rpe = set.rpe !== "" ? Number(set.rpe) : null;
            if (reps !== initSet.reps) patch.reps = reps;
            if (weightLb !== initSet.weightLb) patch.weightLb = weightLb;
            if (durationSec !== initSet.durationSec) patch.durationSec = durationSec;
            if (rpe !== initSet.rpe) patch.rpe = rpe;
            if (Object.keys(patch).length > 0) setPatches.push({ id: set.id, ...patch });
          }
        } else {
          // New set on an existing exercise
          ops.push({
            op: "addSet",
            workoutExerciseId: ex.id,
            set: {
              reps: set.reps !== "" ? Number(set.reps) : undefined,
              weightLb: set.weightLb !== "" ? Number(set.weightLb) : undefined,
              durationSec: set.durationSec !== "" ? Number(set.durationSec) : undefined,
              rpe: set.rpe !== "" ? Number(set.rpe) : undefined,
            },
          });
        }
      }
    } else {
      // New exercise (with its new sets)
      ops.push({
        op: "addExercise",
        workoutId: initial.id,
        exercise: {
          name: ex.name,
          equipment: ex.equipment || undefined,
          notes: ex.notes || undefined,
          sets: ex.sets.map((s, i) => ({
            setIndex: i + 1,
            reps: s.reps !== "" ? Number(s.reps) : undefined,
            weightLb: s.weightLb !== "" ? Number(s.weightLb) : undefined,
            durationSec: s.durationSec !== "" ? Number(s.durationSec) : undefined,
            rpe: s.rpe !== "" ? Number(s.rpe) : undefined,
          })),
        },
      });
    }
  }

  // Exercises removed from the list
  for (const initEx of initial.exercises) {
    if (!seenExIds.has(initEx.id)) {
      ops.push({ op: "removeExercise", exerciseId: initEx.id });
    }
  }

  // Sets removed from still-present exercises
  for (const initEx of initial.exercises) {
    if (seenExIds.has(initEx.id)) {
      for (const initSet of initEx.sets) {
        if (!seenSetIds.has(initSet.id)) {
          ops.push({ op: "removeSet", setId: initSet.id });
        }
      }
    }
  }

  return {
    header: Object.keys(header).length > 0 ? header : undefined,
    setPatches,
    ops,
  };
}

// ─── WorkoutEditor ────────────────────────────────────────────────────────────

export function WorkoutEditor({ workout }: { workout: WorkoutDTO }) {
  const [isEditing, setIsEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Mutable edit state
  const [editTitle, setEditTitle] = useState(workout.title ?? "");
  const [editNotes, setEditNotes] = useState(workout.notes ?? "");
  const [exercises, setExercises] = useState<EditExercise[]>(() =>
    dtoToEdit(workout.exercises),
  );
  // Key of the newly-added set whose reps input should receive focus (UXR-65-25)
  const [pendingFocusKey, setPendingFocusKey] = useState<string | null>(null);

  const editorRef = useRef<HTMLDivElement>(null);

  // Autofocus the reps input of the newly added set (UXR-65-25)
  useEffect(() => {
    if (!pendingFocusKey || !editorRef.current) return;
    const input = editorRef.current.querySelector<HTMLInputElement>(
      `[data-focuskey="${pendingFocusKey}"]`,
    );
    if (input) {
      input.focus();
      setPendingFocusKey(null);
    }
  }, [pendingFocusKey]);

  const isSkipped = workout.status === "skipped";

  function resetEdit() {
    setEditTitle(workout.title ?? "");
    setEditNotes(workout.notes ?? "");
    setExercises(dtoToEdit(workout.exercises));
    setError(null);
    setPendingFocusKey(null);
  }

  function handleCancel() {
    resetEdit();
    setIsEditing(false);
  }

  function handleSave() {
    const { header, setPatches, ops } = computeDiff(
      workout,
      editTitle,
      editNotes,
      exercises,
    );
    // Nothing changed — just close edit mode without a round-trip
    if (!header && setPatches.length === 0 && ops.length === 0) {
      setIsEditing(false);
      return;
    }
    startTransition(async () => {
      setError(null);
      try {
        await saveWorkoutEdits(workout.id, { header, setPatches, ops });
        setIsEditing(false);
      } catch (e) {
        if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  function handleDelete() {
    startTransition(async () => {
      try {
        await deleteWorkoutAction(workout.id);
      } catch (e) {
        if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  // ─── Exercise / set mutations ───────────────────────────────────────────────

  function addExercise() {
    const newSetKey = makeKey();
    setExercises((prev) => [
      ...prev,
      {
        _key: makeKey(),
        id: null,
        name: "",
        equipment: "",
        notes: "",
        sets: [
          { _key: newSetKey, id: null, reps: "", weightLb: "", durationSec: "", rpe: "" },
        ],
      },
    ]);
  }

  function removeExercise(exKey: string) {
    setExercises((prev) => prev.filter((ex) => ex._key !== exKey));
  }

  function updateExerciseField(
    exKey: string,
    field: keyof Pick<EditExercise, "name" | "equipment" | "notes">,
    value: string,
  ) {
    setExercises((prev) =>
      prev.map((ex) => (ex._key === exKey ? { ...ex, [field]: value } : ex)),
    );
  }

  function addSet(exKey: string) {
    const newSetKey = makeKey();
    setExercises((prev) =>
      prev.map((ex) => {
        if (ex._key !== exKey) return ex;
        return {
          ...ex,
          sets: [
            ...ex.sets,
            { _key: newSetKey, id: null, reps: "", weightLb: "", durationSec: "", rpe: "" },
          ],
        };
      }),
    );
    setPendingFocusKey(newSetKey);
  }

  function removeSet(exKey: string, setKey: string) {
    setExercises((prev) =>
      prev.map((ex) => {
        if (ex._key !== exKey) return ex;
        return { ...ex, sets: ex.sets.filter((s) => s._key !== setKey) };
      }),
    );
  }

  function updateSetField(
    exKey: string,
    setKey: string,
    field: keyof Omit<EditSet, "_key" | "id">,
    value: string,
  ) {
    setExercises((prev) =>
      prev.map((ex) => {
        if (ex._key !== exKey) return ex;
        return {
          ...ex,
          sets: ex.sets.map((s) =>
            s._key === setKey ? { ...s, [field]: value } : s,
          ),
        };
      }),
    );
  }

  // ─── Shared styles ──────────────────────────────────────────────────────────

  const inputBase =
    "w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm " +
    "focus:outline-none focus:border-[var(--accent)] min-h-[44px]";

  const deleteButton = (
    <div data-testid="workout-delete-confirm">
      <ConfirmButton
        label="Delete workout"
        confirmLabel="Delete · confirm"
        variant="danger"
        disabled={pending}
        onConfirm={handleDelete}
        className="rounded-lg border border-[var(--danger)]/40 text-[var(--danger)] px-4 py-2 text-sm w-full"
      />
    </div>
  );

  // ─── Slim variant — skipped workouts (no set grid, no Edit toggle) ──────────
  // UXR-65-23: skipped = slim read-only variant; no Edit affordance.

  if (isSkipped) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-[var(--muted)]/15 px-2.5 py-0.5 text-xs font-medium text-[var(--muted)]">
            Skipped
          </span>
        </div>
        {workout.notes && (
          <Card title="Notes">
            <p className="text-sm whitespace-pre-wrap">{workout.notes}</p>
          </Card>
        )}
        {error && (
          <p className="text-sm text-[var(--danger)] border border-[var(--danger)]/30 bg-[var(--danger)]/10 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
        <div className="pt-2 border-t border-[var(--border)]">{deleteButton}</div>
      </div>
    );
  }

  // ─── Read mode (UXR-65-23: default) ────────────────────────────────────────

  if (!isEditing) {
    return (
      <div className="space-y-4">
        {workout.exercises.map((ex) => (
          <Card
            key={ex.id}
            title={ex.equipment ? `${ex.name} (${ex.equipment})` : ex.name}
          >
            <ul className="space-y-1 text-sm">
              {ex.sets.map((s) => (
                <li key={s.id} className="flex justify-between">
                  <span className="text-[var(--muted)]">Set {s.setIndex}</span>
                  <span className="font-mono">{formatSet(s)}</span>
                </li>
              ))}
            </ul>
            {ex.notes && (
              <p className="text-xs text-[var(--muted)] italic mt-2">{ex.notes}</p>
            )}
          </Card>
        ))}

        {workout.notes && (
          <Card title="Notes">
            <p className="text-sm whitespace-pre-wrap">{workout.notes}</p>
          </Card>
        )}

        {error && (
          <p className="text-sm text-[var(--danger)] border border-[var(--danger)]/30 bg-[var(--danger)]/10 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {/* Edit toggle + delete — separate footer (UXR-65-24) */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            data-testid="workout-editor-edit-toggle"
            onClick={() => setIsEditing(true)}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium min-h-[44px] hover:border-[var(--accent)] transition"
          >
            Edit workout
          </button>
          <div data-testid="workout-delete-confirm">
            <ConfirmButton
              label="Delete"
              confirmLabel="Delete · confirm"
              variant="danger"
              disabled={pending}
              onConfirm={handleDelete}
              className="rounded-lg border border-[var(--danger)]/40 text-[var(--danger)] px-4 py-2 text-sm"
            />
          </div>
        </div>
      </div>
    );
  }

  // ─── Edit mode ──────────────────────────────────────────────────────────────

  const labelClass =
    "text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]";

  return (
    <div className="space-y-4" ref={editorRef} data-testid="workout-editor">
      {/* Title */}
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Title</span>
        <input
          type="text"
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          placeholder="Workout"
          className={inputBase}
        />
      </label>

      {/* Notes */}
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Notes</span>
        <textarea
          value={editNotes}
          onChange={(e) => setEditNotes(e.target.value)}
          placeholder="Optional notes…"
          rows={2}
          className="w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm resize-y focus:outline-none focus:border-[var(--accent)]"
        />
      </label>

      {/* Exercises */}
      {exercises.map((ex, exIdx) => (
        <div
          key={ex._key}
          className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm space-y-3"
        >
          {/* Exercise name + remove (UXR-65-08: remove affordance, hidden when only 1 exercise) */}
          <div className="flex items-start gap-2">
            <div className="flex-1 space-y-2">
              <input
                type="text"
                aria-label="Exercise name"
                value={ex.name}
                onChange={(e) => updateExerciseField(ex._key, "name", e.target.value)}
                placeholder="Exercise name"
                className={`${inputBase} font-medium`}
              />
              <input
                type="text"
                aria-label="Equipment (optional)"
                value={ex.equipment}
                onChange={(e) => updateExerciseField(ex._key, "equipment", e.target.value)}
                placeholder="Equipment (optional)"
                className={`${inputBase} text-[var(--muted)]`}
              />
            </div>
            {exercises.length > 1 && (
              <button
                type="button"
                aria-label={`Remove exercise ${ex.name || String(exIdx + 1)}`}
                onClick={() => removeExercise(ex._key)}
                className="mt-1 flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg text-[var(--muted)] hover:text-[var(--danger)] transition text-base"
              >
                ✕
              </button>
            )}
          </div>

          {/* Set table (UXR-65-02: label-once header + label-less rows) */}
          <div className="grid grid-cols-[1.5rem_1fr_1fr_1fr_2.75rem] gap-1">
            {/* Header row */}
            <span className={`${labelClass} text-center`}>#</span>
            <span className={`${labelClass} text-center`}>Reps</span>
            <span className={`${labelClass} text-center`}>Weight</span>
            <span className={`${labelClass} text-center`}>Sec</span>
            <span />

            {/* Set rows — label-less, aria-label per input (UXR-65-08 a11y) */}
            {ex.sets.map((set, setIdx) => (
              <React.Fragment key={set._key}>
                <span className="text-xs text-[var(--muted)] text-center font-mono self-center">
                  {setIdx + 1}
                </span>

                {/* Reps — data-focuskey drives pendingFocusKey autofocus (UXR-65-25) */}
                <input
                  data-focuskey={set._key}
                  data-testid="workout-set-row"
                  aria-label={`Set ${setIdx + 1} reps`}
                  type="text"
                  inputMode="numeric"
                  value={set.reps}
                  placeholder="—"
                  onChange={(e) => updateSetField(ex._key, set._key, "reps", e.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-transparent px-2 py-3 text-center font-mono text-sm min-h-[44px] focus:outline-none focus:border-[var(--accent)]"
                />
                <input
                  aria-label={`Set ${setIdx + 1} weight (lb)`}
                  type="text"
                  inputMode="decimal"
                  value={set.weightLb}
                  placeholder="—"
                  onChange={(e) => updateSetField(ex._key, set._key, "weightLb", e.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-transparent px-2 py-3 text-center font-mono text-sm min-h-[44px] focus:outline-none focus:border-[var(--accent)]"
                />
                <input
                  aria-label={`Set ${setIdx + 1} seconds`}
                  type="text"
                  inputMode="numeric"
                  value={set.durationSec}
                  placeholder="—"
                  onChange={(e) =>
                    updateSetField(ex._key, set._key, "durationSec", e.target.value)
                  }
                  className="w-full rounded-lg border border-[var(--border)] bg-transparent px-2 py-3 text-center font-mono text-sm min-h-[44px] focus:outline-none focus:border-[var(--accent)]"
                />

                {/* Remove set — disabled when only 1 set (UXR-65-08: min 1 set/exercise) */}
                <button
                  type="button"
                  data-testid="set-remove"
                  aria-label={`Remove set ${setIdx + 1}`}
                  disabled={ex.sets.length === 1}
                  onClick={() => removeSet(ex._key, set._key)}
                  className="flex items-center justify-center min-h-[44px] text-[var(--muted)] hover:text-[var(--danger)] disabled:opacity-20 disabled:cursor-not-allowed transition"
                >
                  ✕
                </button>
              </React.Fragment>
            ))}
          </div>

          {/* Add set (UXR-65-09: dashed row at section bottom) */}
          <button
            type="button"
            data-testid="add-set"
            onClick={() => addSet(ex._key)}
            className="w-full min-h-[44px] rounded-lg border border-dashed border-[var(--border)] text-sm text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition"
          >
            + Add set
          </button>
        </div>
      ))}

      {/* Add exercise (UXR-65-09) */}
      <button
        type="button"
        data-testid="add-exercise"
        onClick={addExercise}
        className="w-full min-h-[44px] rounded-2xl border border-dashed border-[var(--border)] text-sm text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition"
      >
        + Add exercise
      </button>

      {error && (
        <p className="text-sm text-[var(--danger)] border border-[var(--danger)]/30 bg-[var(--danger)]/10 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {/* Save / Cancel */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="flex-1 rounded-lg bg-[var(--accent)] text-[var(--accent-fg)] px-4 py-2 font-medium min-h-[44px] disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={handleCancel}
          disabled={pending}
          className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm min-h-[44px] disabled:opacity-50"
        >
          Cancel
        </button>
      </div>

      {/* Delete — footer, separated from save actions (UXR-65-24) */}
      <div className="pt-2 border-t border-[var(--border)]">{deleteButton}</div>
    </div>
  );
}
