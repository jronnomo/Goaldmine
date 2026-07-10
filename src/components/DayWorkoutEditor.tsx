"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { BlockCard } from "@/components/day-editor/BlockCard";
import {
  baseToEditorState,
  computeNumericFieldError,
  isTemplateDirty,
  mergeTemplateEdits,
  templateToEditorState,
} from "@/lib/day-template-edit";
import type { EditorState, ExerciseFieldName } from "@/lib/day-template-edit";
import { validateDayTemplate } from "@/lib/day-template-validation";
import type { DayTemplate } from "@/lib/program-template";

export type DayWorkoutEditorHandle = {
  /** Called by the shell's submit handler before the server action fires.
   * Returns false (and surfaces a local error) when Advanced JSON is
   * currently malformed — the submit must not proceed in that case. */
  validateBeforeSubmit: () => boolean;
};

function parseBase(workoutJson: string): DayTemplate {
  if (!workoutJson.trim()) {
    // Rest day / no template at all — a title-only shell with no blocks.
    return { dayOfWeek: 1, title: "", category: "rest", summary: "", blocks: [] };
  }
  try {
    const parsed = JSON.parse(workoutJson);
    if (validateDayTemplate(parsed).ok) return parsed as DayTemplate;
  } catch {
    // fall through to the empty shell below
  }
  return { dayOfWeek: 1, title: "", category: "rest", summary: "", blocks: [] };
}

export const DayWorkoutEditor = forwardRef<
  DayWorkoutEditorHandle,
  { defaultWorkoutJson: string; onFieldErrorsChange?: (hasErrors: boolean) => void }
>(function DayWorkoutEditor({ defaultWorkoutJson, onFieldErrorsChange }, ref) {
  const [base] = useState<DayTemplate>(() => parseBase(defaultWorkoutJson));
  const [edits, setEdits] = useState<EditorState>(() => baseToEditorState(base));
  const [mode, setMode] = useState<"structured" | "advanced">("structured");
  const [advancedJson, setAdvancedJson] = useState("");
  const [switchError, setSwitchError] = useState<string | null>(null);

  const dirty = isTemplateDirty(base, edits);
  const hasFieldErrors = useMemo(
    () => edits.blocks.some((b) => b.exercises.some((e) => Object.keys(e.fieldErrors).length > 0)),
    [edits],
  );

  useEffect(() => {
    onFieldErrorsChange?.(hasFieldErrors);
    // Reset on unmount so a stale "has errors" doesn't linger if the card ever unmounts.
    return () => onFieldErrorsChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasFieldErrors]);

  useImperativeHandle(
    ref,
    () => ({
      validateBeforeSubmit: () => {
        if (mode !== "advanced") return true;
        try {
          const parsed = JSON.parse(advancedJson);
          const result = validateDayTemplate(parsed);
          if (!result.ok) {
            setSwitchError(result.errors.join("; "));
            return false;
          }
          return true;
        } catch (e) {
          setSwitchError(e instanceof Error ? e.message : "Invalid JSON");
          return false;
        }
      },
    }),
    [mode, advancedJson],
  );

  function updateExerciseField(blockArrIdx: number, exArrIdx: number, field: ExerciseFieldName, value: string) {
    setEdits((prev) => ({
      ...prev,
      blocks: prev.blocks.map((b, bi) => {
        if (bi !== blockArrIdx) return b;
        return {
          ...b,
          exercises: b.exercises.map((e, ei) => {
            if (ei !== exArrIdx) return e;
            const nextFieldErrors = { ...e.fieldErrors };
            if (field === "sets" || field === "durationSec") {
              const err = computeNumericFieldError(value.trim());
              if (err) nextFieldErrors[field] = err;
              else delete nextFieldErrors[field];
            }
            return { ...e, [field]: { touched: true, value }, fieldErrors: nextFieldErrors };
          }),
        };
      }),
    }));
  }

  function toggleSkip(blockArrIdx: number, exArrIdx: number) {
    setEdits((prev) => ({
      ...prev,
      blocks: prev.blocks.map((b, bi) => {
        if (bi !== blockArrIdx) return b;
        return {
          ...b,
          exercises: b.exercises.map((e, ei) => (ei === exArrIdx ? { ...e, skipped: !e.skipped } : e)),
        };
      }),
    }));
  }

  function updateTitle(value: string) {
    setEdits((prev) => ({ ...prev, title: { touched: true, value } }));
  }

  function openAdvanced() {
    setAdvancedJson(JSON.stringify(mergeTemplateEdits(base, edits), null, 2));
    setSwitchError(null);
    setMode("advanced");
  }

  function switchToStructured() {
    try {
      const parsed = JSON.parse(advancedJson);
      const result = validateDayTemplate(parsed);
      if (!result.ok) {
        setSwitchError(`Fix before switching back: ${result.errors.join("; ")}`);
        return;
      }
      setEdits(templateToEditorState(base, parsed as DayTemplate));
      setSwitchError(null);
      setMode("structured");
    } catch (e) {
      setSwitchError(`Fix before switching back: ${e instanceof Error ? e.message : "Invalid JSON"}`);
    }
  }

  // Hidden input rendered whenever there's something to submit: either the
  // structured diff is non-empty, or the user is actively in the Advanced
  // tab (which always submits verbatim — no diff-gating there, matching
  // TargetsBuilder's own unconditional-when-active hidden input). Omitted
  // entirely otherwise, so a pure nutrition/mobility/notes save never
  // touches the workoutJson column or the baseline guard (#235 R1/R6).
  const showHiddenInput = mode === "advanced" || dirty;
  const hiddenValue = mode === "advanced" ? advancedJson : JSON.stringify(mergeTemplateEdits(base, edits));

  return (
    <div data-testid="day-workout-editor" className="flex flex-col gap-3">
      {showHiddenInput && <input type="hidden" name="workoutJson" value={hiddenValue} readOnly />}

      {/* Weighted segmented control — Structured is the accent-filled default,
          Advanced renders muted/outline with a "raw" cue even when active
          (UXR-235-05). */}
      <div role="radiogroup" aria-label="Editor mode" className="flex gap-2">
        <button
          type="button"
          role="radio"
          aria-checked={mode === "structured"}
          data-testid="dwe-tab-structured"
          tabIndex={mode === "structured" ? 0 : -1}
          onClick={() => {
            // Route through the same validated gate as keyboard nav — a
            // direct setMode("structured") here would silently discard
            // (or worse, half-apply) unsaved/invalid Advanced JSON. No-op
            // when already structured.
            if (mode === "advanced") switchToStructured();
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
              openAdvanced();
              e.preventDefault();
            }
          }}
          className={`flex-1 min-h-[44px] rounded-lg text-sm font-medium transition ${
            mode === "structured"
              ? "bg-[var(--accent)] text-[var(--accent-fg)]"
              : "border border-[var(--border)] text-[var(--muted)]"
          }`}
        >
          Structured
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === "advanced"}
          data-testid="dwe-tab-advanced"
          tabIndex={mode === "advanced" ? 0 : -1}
          onClick={() => {
            // No-op when already advanced — re-running openAdvanced() here
            // would re-serialize edits and silently clobber unsaved raw-JSON
            // edits the user is mid-typing.
            if (mode === "structured") openAdvanced();
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
              switchToStructured();
              e.preventDefault();
            }
          }}
          className={`flex-1 min-h-[44px] rounded-lg text-sm font-medium border transition ${
            mode === "advanced"
              ? "border-[var(--accent)] text-[var(--accent)]"
              : "border-[var(--border)] text-[var(--muted)]"
          }`}
        >
          Advanced <span className="text-xs">⚠ raw</span>
        </button>
      </div>

      <div key={mode} className="tab-content-fade flex flex-col gap-3">
        {mode === "structured" ? (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                Title
              </span>
              <input
                type="text"
                data-testid="dwe-title"
                value={edits.title.value}
                placeholder={base.title || "Untitled day"}
                onChange={(e) => updateTitle(e.target.value)}
                className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm min-h-[44px] focus:outline-none focus:border-[var(--accent)]"
              />
            </label>

            {edits.blocks.length === 0 ? (
              <p className="text-sm text-[var(--muted)] italic px-1">No blocks scheduled for this day.</p>
            ) : (
              edits.blocks.map((blockEdit, bi) => (
                <BlockCard
                  key={`${blockEdit.blockIdx}-${blockEdit.foreign ? "foreign" : "base"}-${bi}`}
                  blockEdit={blockEdit}
                  baseBlock={blockEdit.foreign ? undefined : base.blocks[blockEdit.blockIdx]}
                  onFieldChange={(exArrIdx, field, value) => updateExerciseField(bi, exArrIdx, field, value)}
                  onToggleSkip={(exArrIdx) => toggleSkip(bi, exArrIdx)}
                />
              ))
            )}
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <textarea
              data-testid="dwe-advanced-textarea"
              value={advancedJson}
              onChange={(e) => setAdvancedJson(e.target.value)}
              rows={12}
              aria-label="Workout JSON (advanced)"
              spellCheck={false}
              className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-xs font-mono resize-y"
            />
            {switchError && (
              <p
                data-testid="dwe-switch-error"
                className="text-xs text-[var(--danger)] border border-[var(--danger)]/30 bg-[var(--danger)]/10 rounded-lg px-3 py-2"
              >
                {switchError}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
