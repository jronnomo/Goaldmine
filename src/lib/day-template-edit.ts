// Pure, client-safe diff/merge/reconciliation logic for the structured Day
// Override editor (#235). Zero server imports — this file is bundled into
// the browser (DayWorkoutEditor.tsx and friends), so it must stay free of
// @/lib/db, "use server", or anything Prisma-adjacent.
//
// Architecture: see .feature-dev/2026-07-10-235-day-override-editor
// (architecture-blueprint-v2.md is gospel; v1 + critique are background).
//
// Core idea: `base` (the frozen resolved-day template — override JSON or
// rotation default) never mutates for the life of the editor session.
// `EditorState` tracks only WHAT THE USER TYPED, per field, as a tri-state
// `FieldEdit` (untouched / cleared / edited) — never the resolved value.
// `mergeTemplateEdits` is the single place that resolves "untouched" back
// to base's own verbatim value, so untouched subtrees are byte-preserved.

import type { Block, DayTemplate, ExercisePrescription } from "@/lib/program-template";

// ─── Types ──────────────────────────────────────────────────────────────

/** "<blockIdx>:<exIdx>" — see field docs on ExerciseEditState for what the
 * two numbers mean (they are BASE indices for anything with a base
 * counterpart; only used for uniqueness on foreign rows). */
export type ExerciseKey = `${number}:${number}`;

export type FieldEdit = { touched: boolean; value: string };

const UNTOUCHED: FieldEdit = { touched: false, value: "" };

function edited(value: string): FieldEdit {
  return { touched: true, value };
}

export type ExerciseFieldName = "sets" | "reps" | "weightHint" | "durationSec" | "notes";
export type NumericFieldName = "sets" | "durationSec";

export type ExerciseEditState = {
  _key: ExerciseKey;
  /** Base's block index this row is aligned to (lookup key into `base` at
   * merge time). Meaningless (never dereferenced) when `foreign === true`. */
  blockIdx: number;
  /** Base's exercise index within that block, same caveat as blockIdx. */
  exIdx: number;
  /** Display name — base-verbatim for aligned rows, the parsed literal for
   * foreign rows. Never independently editable. */
  name: string;
  /** Display-only, read-only, never editable — base-verbatim (or parsed
   * literal for foreign rows). */
  equipment?: string;
  sets: FieldEdit;
  reps: FieldEdit;
  weightHint: FieldEdit;
  durationSec: FieldEdit;
  notes: FieldEdit;
  skipped: boolean;
  /** true = no base counterpart (added via Advanced) — always editable, no
   * placeholder, Skip hidden. */
  foreign: boolean;
  fieldErrors: Partial<Record<NumericFieldName, string>>;
};

export type BlockEditState = {
  /** Base's block index for aligned/synthetic-skipped blocks; parsed
   * position for foreign blocks (never dereferenced into base). */
  blockIdx: number;
  /** true = whole block absent from base (added via Advanced). */
  foreign: boolean;
  chrome: Pick<Block, "type" | "label" | "rounds" | "restSec">;
  exercises: ExerciseEditState[];
};

export type EditorState = {
  title: FieldEdit;
  blocks: BlockEditState[];
};

// ─── Small helpers ──────────────────────────────────────────────────────

function makeExerciseKey(blockIdx: number, exIdx: number): ExerciseKey {
  return `${blockIdx}:${exIdx}`;
}

/** Shared validation rule for `sets`/`durationSec` — exported so the UI
 * layer can compute inline `fieldErrors` on every keystroke using the exact
 * same rule `mergeTemplateEdits` enforces defensively. Empty string is not
 * an error here (that's "cleared", handled separately upstream). */
export function computeNumericFieldError(trimmedValue: string): string | undefined {
  if (trimmedValue === "") return undefined;
  if (/^\d+$/.test(trimmedValue) && Number(trimmedValue) > 0) return undefined;
  return "Enter a whole number greater than 0";
}

function isPositiveIntString(trimmed: string): boolean {
  return /^\d+$/.test(trimmed) && Number(trimmed) > 0;
}

// ─── base → editor state (fresh, nothing touched) ──────────────────────

export function baseToEditorState(base: DayTemplate): EditorState {
  return {
    title: { ...UNTOUCHED },
    blocks: base.blocks.map((block, blockIdx) => ({
      blockIdx,
      foreign: false,
      chrome: { type: block.type, label: block.label, rounds: block.rounds, restSec: block.restSec },
      exercises: block.exercises.map((ex, exIdx) => ({
        _key: makeExerciseKey(blockIdx, exIdx),
        blockIdx,
        exIdx,
        name: ex.name,
        equipment: ex.equipment,
        sets: { ...UNTOUCHED },
        reps: { ...UNTOUCHED },
        weightHint: { ...UNTOUCHED },
        durationSec: { ...UNTOUCHED },
        notes: { ...UNTOUCHED },
        skipped: false,
        foreign: false,
        fieldErrors: {},
      })),
    })),
  };
}

// ─── Advanced → Structured reconciliation (the A_Gate) ──────────────────

function fieldFromComparison(parsedVal: unknown, baseVal: unknown): FieldEdit {
  if (parsedVal === baseVal) return { ...UNTOUCHED }; // both absent, or identical value
  if (parsedVal === undefined) return edited(""); // present in base, absent in parsed → cleared
  return edited(String(parsedVal));
}

function alignExercise(
  blockIdx: number,
  exIdx: number,
  parsedEx: ExercisePrescription,
  baseEx: ExercisePrescription,
): ExerciseEditState {
  return {
    _key: makeExerciseKey(blockIdx, exIdx),
    blockIdx,
    exIdx,
    name: baseEx.name,
    equipment: baseEx.equipment,
    sets: fieldFromComparison(parsedEx.sets, baseEx.sets),
    reps: fieldFromComparison(parsedEx.reps, baseEx.reps),
    weightHint: fieldFromComparison(parsedEx.weightHint, baseEx.weightHint),
    durationSec: fieldFromComparison(parsedEx.durationSec, baseEx.durationSec),
    notes: fieldFromComparison(parsedEx.notes, baseEx.notes),
    skipped: false,
    foreign: false,
    fieldErrors: {},
  };
}

function makeForeignExercise(blockIdx: number, exIdx: number, ex: ExercisePrescription): ExerciseEditState {
  const lit = (v: unknown): FieldEdit => (v === undefined ? edited("") : edited(String(v)));
  return {
    _key: makeExerciseKey(blockIdx, exIdx),
    blockIdx,
    exIdx,
    name: ex.name,
    equipment: ex.equipment,
    sets: lit(ex.sets),
    reps: lit(ex.reps),
    weightHint: lit(ex.weightHint),
    durationSec: lit(ex.durationSec),
    notes: lit(ex.notes),
    skipped: false,
    foreign: true,
    fieldErrors: {},
  };
}

function makeSkippedExercise(blockIdx: number, exIdx: number, baseEx: ExercisePrescription): ExerciseEditState {
  return {
    _key: makeExerciseKey(blockIdx, exIdx),
    blockIdx,
    exIdx,
    name: baseEx.name,
    equipment: baseEx.equipment,
    sets: { ...UNTOUCHED },
    reps: { ...UNTOUCHED },
    weightHint: { ...UNTOUCHED },
    durationSec: { ...UNTOUCHED },
    notes: { ...UNTOUCHED },
    skipped: true,
    foreign: false,
    fieldErrors: {},
  };
}

/**
 * Align one parsed block against its position-matched base block using the
 * 3-tier exercise resolution (name match → positional fallback → foreign).
 * Two-pass: ALL parsed exercises attempt tier-1 name matching first (so
 * `usedBaseIdx` reflects every name match before any positional fallback is
 * attempted) — this is what correctly classifies an Advanced-side INSERT as
 * foreign even though its new position happens to coincide with an unused
 * base index (the exact C3 repro from the critique).
 */
function alignBlock(blockIdx: number, pBlock: Block, baseBlock: Block): BlockEditState {
  const usedBaseIdx = new Set<number>();

  // Pass 1 — tier 1, name match, across ALL parsed exercises first.
  const tier1Match: (number | null)[] = pBlock.exercises.map((pEx) => {
    const idx = baseBlock.exercises.findIndex((bEx, bi) => bEx.name === pEx.name && !usedBaseIdx.has(bi));
    if (idx === -1) return null;
    usedBaseIdx.add(idx);
    return idx;
  });

  // Pass 2 — tier 2 (positional fallback) / tier 3 (foreign) for leftovers.
  const exercises: ExerciseEditState[] = pBlock.exercises.map((pEx, i) => {
    const t1 = tier1Match[i];
    if (t1 !== null && t1 !== undefined) {
      return alignExercise(blockIdx, t1, pEx, baseBlock.exercises[t1]!);
    }
    if (baseBlock.exercises[i] && !usedBaseIdx.has(i)) {
      usedBaseIdx.add(i);
      return alignExercise(blockIdx, i, pEx, baseBlock.exercises[i]!);
    }
    return makeForeignExercise(blockIdx, baseBlock.exercises.length + i, pEx);
  });

  // Base exercises in this block with no parsed match anywhere → restorable skip.
  baseBlock.exercises.forEach((bEx, bi) => {
    if (usedBaseIdx.has(bi)) return;
    exercises.push(makeSkippedExercise(blockIdx, bi, bEx));
  });

  return {
    blockIdx,
    foreign: false,
    chrome: { type: baseBlock.type, label: baseBlock.label, rounds: baseBlock.rounds, restSec: baseBlock.restSec },
    exercises,
  };
}

/**
 * Reconcile a freshly-parsed (Advanced tab) DayTemplate against the frozen
 * `base`, producing a fresh EditorState. Runs on every successful A_Gate
 * parse — the previous EditorState (and all its per-field touch history) is
 * discarded, not patched; only VALUES are recovered, via alignment.
 *
 * Block alignment is position-only: parsed.blocks[pIdx] aligns to
 * base.blocks[pIdx] if that index exists in base, else the whole block is
 * foreign. Base blocks with no parsed counterpart at all (parsed shorter
 * than base) become synthetic all-skipped BlockEditStates appended after
 * the blocks parsed actually has, in original base order.
 */
export function templateToEditorState(base: DayTemplate, parsed: DayTemplate): EditorState {
  const blocks: BlockEditState[] = parsed.blocks.map((pBlock, pIdx) => {
    const baseBlock = base.blocks[pIdx];
    if (!baseBlock) {
      return {
        blockIdx: pIdx,
        foreign: true,
        chrome: { type: pBlock.type, label: pBlock.label, rounds: pBlock.rounds, restSec: pBlock.restSec },
        exercises: pBlock.exercises.map((pEx, i) => makeForeignExercise(pIdx, i, pEx)),
      };
    }
    return alignBlock(pIdx, pBlock, baseBlock);
  });

  // Whole base blocks with no parsed counterpart at all (parsed shorter).
  for (let k = parsed.blocks.length; k < base.blocks.length; k++) {
    const baseBlock = base.blocks[k]!;
    blocks.push({
      blockIdx: k,
      foreign: false,
      chrome: { type: baseBlock.type, label: baseBlock.label, rounds: baseBlock.rounds, restSec: baseBlock.restSec },
      exercises: baseBlock.exercises.map((bEx, i) => makeSkippedExercise(k, i, bEx)),
    });
  }

  const title: FieldEdit = parsed.title !== base.title ? edited(parsed.title) : { ...UNTOUCHED };
  return { title, blocks };
}

// ─── Merge (EditorState + base → full DayTemplate) ──────────────────────
//
// Byte-preservation mechanics: for anything with a base counterpart, start
// from a SHALLOW CLONE of the base object (`{ ...baseObj }`) and only
// reassign/delete the specific keys a field edit touches. This is what
// keeps untouched subtrees byte-for-byte identical to base — including key
// ORDER, which matters because `isTemplateDirty` compares via
// `JSON.stringify`, and `{...base, ...patch}` preserves an existing key's
// original position (only genuinely new keys get appended at the end).
// Rebuilding objects field-by-field from scratch (the tempting alternative)
// silently reorders keys and breaks that comparison for every fresh,
// completely-untouched editor state — caught in the initial test pass.

function applyNumericField(out: ExercisePrescription, field: NumericFieldName, fe: FieldEdit): void {
  if (!fe.touched) return; // leave whatever the clone carried over from base (present or absent)
  const trimmed = fe.value.trim();
  if (trimmed === "") {
    delete out[field];
    return;
  }
  if (isPositiveIntString(trimmed)) {
    out[field] = Number(trimmed);
  } else {
    delete out[field]; // invalid → omit defensively (fieldErrors is the UI's job to surface)
  }
}

function applyRepsField(out: ExercisePrescription, fe: FieldEdit): void {
  if (!fe.touched) return;
  const trimmed = fe.value.trim();
  if (trimmed === "") {
    delete out.reps;
    return;
  }
  out.reps = /^\d+$/.test(trimmed) ? Number(trimmed) : trimmed;
}

function applyStringField(out: ExercisePrescription, field: "weightHint" | "notes", fe: FieldEdit): void {
  if (!fe.touched) return;
  const trimmed = fe.value.trim();
  if (trimmed === "") {
    delete out[field];
    return;
  }
  out[field] = trimmed;
}

function mergeExercise(ex: ExerciseEditState, base: DayTemplate): ExercisePrescription {
  const baseEx = ex.foreign ? undefined : base.blocks[ex.blockIdx]?.exercises[ex.exIdx];
  const out: ExercisePrescription = baseEx ? { ...baseEx } : { name: ex.name };
  if (!baseEx && ex.equipment !== undefined) out.equipment = ex.equipment;
  applyNumericField(out, "sets", ex.sets);
  applyRepsField(out, ex.reps);
  applyStringField(out, "weightHint", ex.weightHint);
  applyNumericField(out, "durationSec", ex.durationSec);
  applyStringField(out, "notes", ex.notes);
  return out;
}

/**
 * Resolve `edits` against the frozen `base` into a full DayTemplate — the
 * only shape ever persisted (whole-blob upsert, no ops vocabulary). Skipped
 * exercises are omitted by construction; a block left with zero exercises
 * after skips is pruned entirely (matches the ops-path precedent,
 * day-template-ops.ts's `.filter(b => exercises.length > 0)`), which is how
 * a whole-block skip round-trips into `blocks: []` for an all-skipped day —
 * `validateDayTemplate` explicitly allows that ("use [] for a rest day").
 *
 * Block chrome (type/label/rounds/restSec) for a non-foreign block is
 * ALWAYS sourced from base (never from a parsed/Advanced edit to that same
 * block) — same "never independently editable outside Advanced-insert"
 * rule as exercise name/equipment; `blockEdit.chrome` exists for UI
 * rendering, base is the merge's source of truth for aligned blocks.
 */
export function mergeTemplateEdits(base: DayTemplate, edits: EditorState): DayTemplate {
  const blocks: Block[] = [];
  for (const blockEdit of edits.blocks) {
    const exercises: ExercisePrescription[] = [];
    for (const ex of blockEdit.exercises) {
      if (ex.skipped) continue;
      exercises.push(mergeExercise(ex, base));
    }
    if (exercises.length === 0) continue; // prune empty block
    const baseBlock = blockEdit.foreign ? undefined : base.blocks[blockEdit.blockIdx];
    const block: Block = baseBlock ? { ...baseBlock, exercises } : { type: blockEdit.chrome.type, exercises };
    if (!baseBlock) {
      if (blockEdit.chrome.label !== undefined) block.label = blockEdit.chrome.label;
      if (blockEdit.chrome.rounds !== undefined) block.rounds = blockEdit.chrome.rounds;
      if (blockEdit.chrome.restSec !== undefined) block.restSec = blockEdit.chrome.restSec;
    }
    blocks.push(block);
  }
  const title = edits.title.touched ? edits.title.value.trim() || base.title : base.title;
  return { ...base, title, blocks };
}

/**
 * True when the merged output would differ from `base` at all — a whole-blob
 * byte comparison, not a field-emptiness check. Drives the hidden
 * `workoutJson` input's presence (R1/R6): no dirt → no hidden input → no
 * `workoutJson` key in the submitted FormData at all, so a pure
 * nutrition/mobility/notes save never touches the workout column or the
 * baseline guard. A whitespace-only entry into an unset base field, or
 * retyping a value that matches base's own value, both correctly report
 * `false` here (they trim/compare away to nothing on merge).
 */
export function isTemplateDirty(base: DayTemplate, edits: EditorState): boolean {
  return JSON.stringify(mergeTemplateEdits(base, edits)) !== JSON.stringify(base);
}
