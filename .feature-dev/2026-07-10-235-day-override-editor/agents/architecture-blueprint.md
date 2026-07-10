# Architecture Blueprint — #235 Structured Day Override editor

Inputs: PRD-235 §9 (resolved), UX report (ASCII mockup §4, state machine §5, ledger §11), research-output.md premise facts. No production code below — file-level contracts only.

## 1. `src/lib/day-template-edit.ts` (new, pure, client-safe — no server imports; verify via `grep -n "^import" ` has zero `@/lib/db`/`"use server"`)

```ts
import type { DayTemplate, Block, ExercisePrescription } from "@/lib/program-template";

// Stable key = "<blockIdx>:<exIdx>" against the FROZEN base's original indices.
// Rejected: array-position re-derivation each render (breaks when a skip prunes
// a block on merge preview) and crypto.randomUUID keys (base/working can't be
// diffed by identity across a base template that never re-parses).
export type ExerciseKey = `${number}:${number}`;

export type ExerciseEditState = {
  _key: ExerciseKey;
  blockIdx: number;
  exIdx: number;
  name: string;        // read-only display, carried for foreign-exercise detection
  sets: string;         // "" = untouched/inherit
  reps: string;
  weightHint: string;
  durationSec: string;
  notes: string;
  skipped: boolean;
  foreign: boolean;     // true = added via Advanced JSON, not in base → read-only in Structured
};

export type EditorState = {
  title: string;         // "" = untouched/inherit base.title
  exercises: ExerciseEditState[]; // base exercises + any foreign ones appended
};

export function baseToEditorState(base: DayTemplate): EditorState; // seeds ALL fields "" (untouched) — NOT pre-filled with base values (base shows via placeholder in the UI layer, not via input value)
export function computeTemplateDiff(base: DayTemplate, edits: EditorState): { empty: boolean; changedKeys: Set<ExerciseKey>; titleChanged: boolean };
export function mergeTemplateEdits(base: DayTemplate, edits: EditorState): DayTemplate;
```

**Rejected alternative for keying**: block/exercise `label+name` composite key — breaks on duplicate exercise names within a block (real templates have these, e.g. two "Plank" entries in a finisher). Tuple index key is correct because base is frozen and indices never renumber within a session (skip = omit at merge time, not at edit-state time — the array position never moves under the user's feet).

**Empty-diff semantics**: `computeTemplateDiff` is true-empty when `titleChanged === false` AND every `ExerciseEditState` has all five value fields `""` AND `skipped === false` for every entry AND no foreign exercises exist. This is a pure string-emptiness check on `edits`, not a byte-diff against `mergeTemplateEdits(base, edits)` vs `base` — cheaper and matches WorkoutEditor's `computeDiff` idiom (patch-object-emptiness, not round-trip comparison). One consequence to accept: a user who types the base's own value back into a field (e.g. clears then re-types "10" matching base) is NOT empty-diff (field is non-"") even though the merged JSON is byte-identical — acceptable false-positive-to-save; matches WorkoutEditor's own patch semantics where any touched field counts.

**Empty-block pruning ruling**: match the ops-path precedent (`day-template-ops.ts:223-225`, `.filter(b => exercises.length > 0)`). `mergeTemplateEdits` prunes any block left with zero exercises after applying skips — same rule for whole-block skip-out as partial. **Edge case prescribed**: `validateDayTemplate` requires `blocks` to be an array but explicitly allows empty (`day-template-validation.ts:80-81`, comment "use [] for a rest day"). So an all-skipped template legally merges to `{ ...base, blocks: [] }` — valid, no special-case needed. Foreign exercises (added via Advanced) are never pruned by Structured-tab skip since Structured can't skip a foreign row (read-only) — their block always survives unless the user deletes them in Advanced directly.

**reps string|number round-trip — pick ONE, with reasoning**: `mergeTemplateEdits` writes `/^\d+$/.test(trimmed) ? Number(trimmed) : trimmed` for any field the user touched (non-`""`); for untouched fields (`""`) it writes back `structuredClone(base...exercise).reps` **verbatim, no normalization** — the base's original type (string OR number) survives untouched. This is UXR-235-04's rule, chosen over "always compare via String() then re-parse" because that would silently upgrade e.g. base `reps: "10"` (author's deliberate string) to `10` (number) on an unrelated same-exercise edit (say, only `weightHint` changed) — violating byte-preservation of untouched *fields*, not just untouched *exercises*. Field-level granularity, not exercise-level.

**Byte-preservation mechanics**: `mergeTemplateEdits` does `const working = structuredClone(base)`, then only reassigns `working.title` (if `edits.title !== ""`) and, per touched `ExerciseEditState`, `working.blocks[blockIdx].exercises[exIdx] = { ...existing, ...patch }` (WorkoutEditor's own `updateExercise` merge idiom, `day-template-ops.ts:203`) — never `JSON.parse(JSON.stringify(...))`-regenerate the whole thing, never rebuild blocks from scratch. `dayOfWeek`/`category`/`summary`/block `type`/`label`/`rounds`/`restSec` are never touched by this function.

## 2. `DayOverrideForm.tsx` decomposition

```
DayOverrideForm.tsx (server-adjacent shell — form action, nutrition/mobility/notes, Clear — UNCHANGED)
 └─ DayWorkoutEditor.tsx  "use client" island (replaces the <details>+textarea, lines 33-42)
     ├─ SegmentedTabs        (inline in-file — 2-item radiogroup, too small to extract; clone TargetsBuilder:372-418)
     ├─ BlockCard            (extracted, new file src/components/day-editor/BlockCard.tsx — read-only chrome band + ExerciseRow list; one per base block, reused across renders)
     │   └─ ExerciseRow      (extracted, new file src/components/day-editor/ExerciseRow.tsx — name line + SkipPill + label-once grid + notes disclosure; used inside BlockCard, ~120 lines, independently testable)
     ├─ SkipPill             (inline in ExerciseRow.tsx — 15 lines, not worth its own file per UX mockup's tight coupling to row dim state)
     └─ Advanced textarea    (inline in DayWorkoutEditor — reuses DayOverrideForm's existing textarea classes verbatim)
```
Rationale for the 2-file extraction: `BlockCard`/`ExerciseRow` are the only pieces with real reuse pressure (N blocks × M exercises) and independent test value (row anatomy, skip dim, notes disclosure); `SegmentedTabs` and `SkipPill` are single-instance-shaped enough per screen that inlining avoids prop-threading overhead WorkoutEditor already avoids for its own set-grid.

**Full state model (`DayWorkoutEditor`)**:
- `base: DayTemplate = useState(() => JSON.parse(defaults.workoutJson || "{}"))[0]` — frozen (rest-day/no-override case: `defaults.workoutJson` can be `""`; guard with `blocks: []` fallback so `baseToEditorState` never throws).
- `edits: EditorState = useState(() => baseToEditorState(base))` — the Structured working state.
- `mode: "structured" | "advanced"`.
- `advancedJson: string`, `switchError: string | null` (tab-local, per TargetsBuilder `advancedError`).
- `saveError: string | null` (root-level, lifted OUT of this island — see below; owned by `DayOverrideForm`, not duplicated).
- `foreignExercises` are NOT separate state — they live inside `edits.exercises` with `foreign: true`, appended when Advanced→Structured parses a template containing an exercise name not present in `base`.

**Advanced-added exercise handling (PRD §6 read-only rule, prescribed exactly)**: on `A_Gate` valid-parse (switch back to Structured), diff the parsed template's exercises against `base`'s by `(blockIdx, exIdx)` position AND name; any exercise present in the parsed template but absent from `base` at that position becomes an `ExerciseEditState` with `foreign: true`, all its value fields pre-filled **solid** (not placeholder — foreign rows show real typed-looking values since there's no "base" to diff against) and every input `disabled` + `aria-disabled` (per PRD "render read-only"). Skip is hidden for foreign rows (nothing to un-skip against). If the user then switches back to Advanced, foreign rows serialize through `mergeTemplateEdits`-equivalent unchanged (they pass straight through as part of `working.blocks` — merge logic must special-case `foreign` entries as "always emit as-is, never diffed/skippable").

**Hidden input**: `<input type="hidden" name="workoutJson" value={mode === "advanced" ? advancedJson : JSON.stringify(mergeTemplateEdits(base, edits))} />` inside `DayWorkoutEditor`, rendered as a child so it participates in `DayOverrideForm`'s existing `<form action=...>` — `upsertDayOverrideFromForm` and its FormData contract (`day-actions.ts:12`) are untouched. Matches TargetsBuilder's `name="targets"` hidden-input pattern exactly (`TargetsBuilder.tsx:193-199`).

**Guard-banner placement**: `saveError` state stays in `DayOverrideForm` (it already owns the `try/catch` around `upsertDayOverrideFromForm`, `DayOverrideForm.tsx:22-29` — unchanged). Render it **below `DayWorkoutEditor` and above the Save/Clear footer row**, i.e. between the mounted island and the submit button — outside `DayWorkoutEditor`'s own `key={mode}` fade wrapper, so a tab switch never remounts/clears it. `aria-live="polite"` added to the existing `<p>` (currently missing — new attribute). This is a **shared** banner slot for both the pre-existing nutrition/mobility save errors and the new baseline-guard covenant text — no new error UI paths for the same field.

**Base-as-italic-placeholder mechanics**: `ExerciseRow` inputs render `value={edits.exercises[i].sets}` (real controlled value — the actual typed content, `""` when untouched) and `placeholder={String(base...sets ?? "—")}`. An untouched input therefore submits `""` in DOM value but `mergeTemplateEdits` reads `""` as "use base's value" and writes the base's own `sets`/`reps`/etc. into the merged blob — the merged JSON is never missing the field just because the visual affordance is a placeholder. This is the load-bearing distinction: **placeholder is a browser-native rendering hint with zero effect on merge**, all inherit-vs-override logic lives in `day-template-edit.ts`, not in the DOM.

## 3. Advanced tab

- **Switch-in** (`Structured → Advanced`): `setAdvancedJson(JSON.stringify(mergeTemplateEdits(base, edits), null, 2))` — serializes the CURRENT merged working state (base + edits applied), never raw `base`. Matches TargetsBuilder's `openAdvanced` (`:160-164`) using `rowsToTargets(rows)`, not a stored original.
- **Switch-back** (`Advanced → Structured`, the `A_Gate` in the UX state machine): `JSON.parse(advancedJson)` → `validateDayTemplate(parsed)` (client-safe, confirmed zero server imports in `day-template-validation.ts`) → on failure, `setSwitchError(...)`, **stay in Advanced** (mirrors TargetsBuilder `:173-175` exactly, message prefix `"Fix before switching back: "`). On success: `base` is **NOT reassigned** (frozen for the whole session — untouched-field placeholders must keep referring to the ORIGINAL override/rotation base, not a JSON-tab detour); instead rebuild `edits` fresh via a `templateToEditorState(base, parsed): EditorState` helper (new export in day-template-edit.ts) that diffs `parsed` against `base` per exercise: matching `(blockIdx,exIdx,name)` → fields differing from base become the edit-state's typed value (String-ified), fields matching base stay `""`; exercises in `parsed` absent from `base` → `foreign: true` rows appended (per §2 above); exercises in `base` absent from `parsed` → `skipped: true`.
- **Pre-submit validation on Advanced saves**: `DayWorkoutEditor` exposes an `onBeforeSubmit` hook (or `DayOverrideForm`'s submit handler checks `mode`) — if `mode === "advanced"`, run `JSON.parse` + `validateDayTemplate` on `advancedJson` before allowing the form action to fire; invalid → block submit, surface via the same `switchError` slot (reused as a save-time error) rather than a silent server round-trip that would just re-throw the same message from `assertValidDayTemplate` server-side. Belt-and-suspenders: server (`day-actions.ts:31-32`) remains authoritative.

## 4. Save flow

`computeTemplateDiff(base, edits).empty === true` **and** `mode === "structured"` → no submit; render a subtle "No changes to save" affordance (muted text swap on the Save button label area, not a new banner — reuse the `disabled` visual state already implied by WorkoutEditor's `pending` styling, just gated on emptiness too: `disabled={pending || (mode==="structured" && computeTemplateDiff(base,edits).empty)}`). In Advanced mode, empty-diff detection is skipped (JSON-tab saves always submit — matching current behavior, since there's no cheap structural diff against free-text JSON without re-parsing and re-running the same diff, which is unnecessary complexity for a tab whose whole point is "trust the raw JSON").

**Empty-diff-vs-rotation-base case**: today, opening the form when no override exists pre-fills the textarea with the *rotation* template (`page.tsx:406-410`), and saving unchanged **creates a redundant override row** identical to the rotation default. Prescribing a **skip**: when `!hasOverride` (prop) AND `computeTemplateDiff` is empty, treat identically to "empty diff" above — no submit. This is strictly better (no PRD/UX ruling contradicts it; UX report doesn't discuss it, so this blueprint rules in the no-redundant-row direction) and costs nothing extra — `hasOverride` is already a prop on `DayOverrideForm`, threaded down to `DayWorkoutEditor`.

## 5. Rest-day/empty-blocks template

`base.blocks.length === 0` (rest day, or all-skipped-then-saved-and-reopened) → Structured tab renders: title input (still editable, base placeholder = rotation's rest-day title) + a muted one-line "No blocks scheduled for this day." in place of the BlockCard list. No special component — `DayWorkoutEditor` just maps zero `BlockCard`s and short-circuits the empty-state paragraph inline.

## 6. Tests — `src/lib/day-template-edit.test.ts` exact case list

1. `mergeTemplateEdits`: untouched exercise → `JSON.stringify(merged.blocks[i].exercises[j]) === JSON.stringify(base.blocks[i].exercises[j])` (byte-diff on untouched subtree).
2. `mergeTemplateEdits`: touched `weightHint` only → `reps`/`sets`/`durationSec`/`notes` on same exercise unchanged; sibling exercises byte-identical.
3. Skip round-trip: skip one exercise in a multi-exercise block → merged block has N-1 exercises, correct one removed, order preserved.
4. Whole-block skip: skip every exercise in a block → block absent from `merged.blocks` (pruned, ops-path parity).
5. All-blocks-skipped → `merged.blocks === []`, still passes `validateDayTemplate`.
6. reps matrix: base `reps: 10` (number) untouched → merged `10` (number, not `"10"`); base `reps: "8-10"` untouched → merged `"8-10"` string; user types `"12"` → merged `12` (number, clean-digit rule); user types `"8-10"` → merged `"8-10"` (string, no coercion); user types `" 12 "` (whitespace) → trimmed then coerced to `12`.
7. Foreign-exercise passthrough: `templateToEditorState` on a parsed template with an extra exercise → resulting `EditorState` has one `foreign:true` entry; `mergeTemplateEdits` emits it unchanged regardless of its (inert) edit fields.
8. Empty-diff matrix: fresh `baseToEditorState(base)` → `computeTemplateDiff` empty; one field touched → not empty; skip toggled then un-toggled back to `false` → empty again (net-zero); title touched to same string as base → NOT empty (field-level touch, not value-level — matches the reasoning in §1).
9. Rotation-base empty-diff case: `hasOverride=false`, fresh editor state from the rotation-derived base → diff still reports empty (verifies the save-flow skip condition in §4 has a correct signal to gate on).
10. `dayOfWeek`/`category`/`summary`/block `type`/`label`/`rounds`/`restSec` preserved byte-for-byte through a merge that touches unrelated exercise fields.

## 7. UXR ledger mapping (implements vs defers)

**Implements** (lib/state contracts this blueprint fully specifies): UXR-235-01 (row anatomy → BlockCard/ExerciseRow structure), 02 (field prominence → ExerciseEditState shape), 03 (bare inputMode inputs — UI-layer, contract compatible), 04 (reps round-trip — §1, exact rule chosen), 05 (segmented tabs → SegmentedTabs), 06 (parse-on-switch-back gate → §3), 07 (skip toggle, no confirm → EditorState.skipped), 08 (dim-in-place+pill — UI-layer, state (`skipped: boolean`) is affordance-agnostic so either presentation binds to it), 09 (guard banner placement/copy → §2 saveError), 10 (two error slots: `saveError` root vs `switchError` tab-local → §2/§3), 22 (placeholder-is-affordance → §2 mechanics), 23 (empty-diff short-circuit → §4), 25 (hidden input → §2), 26 (footer/pending → §4 disabled condition).

**Defers to implementer's UI-layer pass** (this blueprint fixes the data contract; exact CSS/motion values are Phase-7 tuning, not architecture): UXR-235-11/12/13/14/17/18/19/24 (motion timings, gap/padding, `.macro-flash`/`.item-row-anim`/`.tab-content-fade` wiring — pure presentation, no state shape implications). UXR-235-15/16/20/21 (a11y⚠ contrast/min-width verification — device-dependent, not blueprint-decidable).
