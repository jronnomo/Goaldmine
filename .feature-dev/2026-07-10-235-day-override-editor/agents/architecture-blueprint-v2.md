# Architecture Blueprint v2 — #235 Structured Day Override editor

Revision round. Resolves all 3 Criticals + 6 Concerns from `architecture-critique.md`. Anything not called out below is **unchanged from v1** (component-file tree, segmented control, MealComposer footer/skip-pill reuse, block-chrome read-only band, rest-day empty state). No production code — file-level contracts only.

## R1 — Tri-state `workoutJson` in `day-actions.ts` (fixes C1 + C2)

**Root cause of C1/C2**: v1 always resent the full merged workout blob, so any save — even a pure nutrition edit — re-triggered `assertBaselineDecisionMade` and could never leave an existing baseline-day override alone. **Fix**: `DayWorkoutEditor` renders `<input type="hidden" name="workoutJson">` **only when `isTemplateDirty(base, edits)` is true** (§2). No workout edit → no hidden input → no `workoutJson` key in FormData at all. `upsertDayOverrideFromForm` now distinguishes three FormData states instead of two:

```ts
const workoutFieldProvided = form.has("workoutJson");                    // NEW
const workoutRaw = workoutFieldProvided ? ((form.get("workoutJson") as string) ?? "").trim() || null : null;

let workoutJson: unknown = null;
if (workoutRaw) { /* parse + assertDayTemplateWithinSize + assertValidDayTemplate — unchanged */ }
```

- `workoutFieldProvided === false` (untouched in Structured, or nutrition/mobility/notes-only save) → `workoutJson` stays `null` locally, **guard is skipped** (`settingWorkout = workoutJson !== null` — same expression as today, still `false`), and the **update clause omits the key entirely** so Prisma leaves the column untouched:
  ```ts
  update: {
    ...(workoutFieldProvided
      ? { workoutJson: workoutJson === null ? Prisma.JsonNull : (workoutJson as Prisma.InputJsonValue) }
      : {}),
    nutritionText, mobilityText, notes,
  },
  ```
- `workoutFieldProvided === true`, blank → **unchanged today's semantics**: explicit wipe (`Prisma.JsonNull`), guard still skipped (`settingWorkout` false).
- `workoutFieldProvided === true`, real JSON → **unchanged today's semantics**: full #234 pipeline (parse, size, shape, guard) — this is the only path that can ever hit the guard, and only fires when the user actually edited the workout.
- **Create path is unaffected**: `workoutJson: workoutJson ?? undefined` already treats `null` as "don't set" — confirmed unchanged, rotation default stays live for a fresh day with no workout edits.
- **Delete-collapse condition must change too** (missed by the ruling's "small change" framing but required for correctness): today `if (!workoutJson && !nutritionText && !mobilityText && !notes) → delete row`. With tri-state, `workoutJson` being `null` no longer means "no workout" — it may mean "leave the existing one alone." Compute the *final* state instead:
  ```ts
  const finalWorkoutPresent = workoutFieldProvided ? workoutJson !== null : !!existing?.workoutJson;
  if (!finalWorkoutPresent && !nutritionText && !mobilityText && !notes) { /* delete */ } else { /* upsert */ }
  ```
  Without this, a nutrition-only save that blanks the other three text fields on a day whose override has ONLY a workout override would silently delete the whole row, destroying the untouched workout. This closes the last leak in R1.

Net effect: nutrition/mobility/notes-only saves never touch the guard or the workout column, on any day including baseline days with `baselineTestNames: null` (C2 resolved as a consequence, not a separate fix). Save on the shared button is **never** disabled for diff-emptiness — see R6.

## R2 — Reconciliation / alignment model (fixes C3)

**Root cause of C3**: v1's `templateToEditorState` matched parsed↔base by `(blockIdx, exIdx)` tuple, which silently misattributes edits whenever Advanced does the insert/remove/reorder it exists to support.

**Type change**: `EditorState` restructures from a flat exercise list to block-scoped, in **current working order** (the order last produced by either `baseToEditorState` or a successful `A_Gate` parse — never re-sorted back to base order):
```ts
export type FieldEdit = { touched: boolean; value: string };
// untouched = {touched:false,value:""} · edited = {touched:true,value:"12"} · cleared = {touched:true,value:""}

export type ExerciseEditState = {
  _key: ExerciseKey; blockIdx: number; exIdx: number; name: string;
  sets: FieldEdit; reps: FieldEdit; weightHint: FieldEdit; durationSec: FieldEdit; notes: FieldEdit;
  skipped: boolean;
  foreign: boolean;   // tier-3: no base counterpart — always editable, no placeholder, Skip hidden
  fieldErrors: Partial<Record<"sets" | "durationSec", string>>;  // inline, blocks Save (§4)
};
export type BlockEditState = {
  blockIdx: number; foreign: boolean;   // whole block absent from base (added in Advanced)
  chrome: Pick<Block, "type" | "label" | "rounds" | "restSec">;  // sourced from base unless foreign
  exercises: ExerciseEditState[];
};
export type EditorState = { title: FieldEdit; blocks: BlockEditState[] };
```

**Alignment rule** (`templateToEditorState(base, parsed): EditorState`, runs at `A_Gate` on a valid parse):

- **Block level — position-only**: `parsed.blocks[pIdx]` aligns to `base.blocks[pIdx]` if that index exists in base, else the block is **foreign** (chrome sourced from `parsed`, all its exercises automatically tier-3). Blocks don't carry a stable name/key the way exercises do, and the PRD's structural-edit example (§6) is exercise-scoped, not block-scoped — position-only is a narrower, explicit guarantee, not a silent gap.
- **Exercise level, within an aligned (non-foreign) block** — 3-tier, in this order:
  1. **Name match within the same-index base block**: search `baseBlock.exercises` for `name === parsedEx.name` (any position). Found → per-field tri-state by value comparison: `parsedEx[f] === alignedBaseEx[f]` (or both absent) → `untouched`; else → `edited(String(parsedEx[f]))` (absent-in-parsed-but-present-in-base → `cleared`, i.e. `touched:true,value:""`). This is the case that fixes C3's concrete example (C edited then X inserted at 0 — C still matches by name regardless of new index).
  2. **Positional fallback**: no name match, but `baseBlock.exercises[exIdx]` exists → align to it anyway (weaker signal: shows that position's base values as placeholder, permits skip-restore-to-that-slot) — covers "renamed but not moved."
  3. **Foreign**: neither — `foreign: true`, every field pre-`touched` with the parsed literal value, no placeholder, **Skip hidden**, **fully editable** (not disabled — this supersedes PRD §3.1/§6's "render read-only" wording; flagging for the same kind of sign-off UXR-235-08 got, since disabled foreign rows proved unnecessary once alignment is name-based: nothing is lost by allowing edits, and disabling added a dead-end UX path).
  - Base exercises in an aligned block with **no** parsed name match anywhere in that block → `skipped: true` row (all fields untouched) — this is how an Advanced-side delete round-trips into Structured as a restorable skip, same semantics as a Structured-tab skip.
- **Whole base block missing from `parsed`** (block deleted in Advanced): every exercise in it becomes a `skipped:true` `ExerciseEditState`, grouped into a synthetic non-foreign `BlockEditState` (chrome from `base`) appended **after** all blocks present in `parsed`, in original base order — restorable via un-skip, exact position among survivors is not load-bearing (UX report doesn't specify one).

**Foreign-field merge is unified, not special-cased**: because foreign exercises start every field pre-`touched`, `mergeTemplateEdits`'s per-field resolver (§3) treats them identically to any touched field on any other exercise — no separate "emit as-is" branch, simplifying v1's design.

**Per-field edit state fully resets** on every successful `A_Gate` parse (old `edits` object is discarded, not patched) — this is the actual fix: no attempt is made to carry forward per-field touch history across a structural Advanced edit, only the *values* (via alignment) are recovered.

## R3 — Coercion matrix (Co1, Co2, Co3)

`mergeTemplateEdits(base, edits): DayTemplate` resolves each field via one shared function, dispatched by field kind:

| Field | untouched | cleared (touched, `trim()===""`) | edited, non-empty |
|---|---|---|---|
| `sets`, `durationSec` | base value verbatim (byte-preserved) | key **removed** from exercise (unset) | `/^\d+$/.test(trimmed) && Number(trimmed) > 0` → `Number(trimmed)`; else **field-level error**, key set in `fieldErrors`, merge **omits** the key defensively (never crashes, never writes a bad type — Save stays disabled while any error is outstanding, §4) |
| `reps` | base value verbatim (string or number, untouched) | key removed | `/^\d+$/.test(trimmed) ? Number(trimmed) : trimmed` (v1's clean-digit rule, no validation error possible — free text) |
| `weightHint`, `notes` | base value verbatim | key removed | `trimmed` string |

`equipment`/exercise `name` are never editable — always base verbatim (or the parsed literal for foreign rows).

**`isTemplateDirty` replaces v1's `computeTemplateDiff`** — a whole-blob byte comparison, not a field-emptiness check:
```ts
export function isTemplateDirty(base: DayTemplate, edits: EditorState): boolean {
  return JSON.stringify(mergeTemplateEdits(base, edits)) !== JSON.stringify(base);
}
```
This is strictly more correct than v1's patch-emptiness check and resolves Co3 as a side effect: a whitespace-only `weightHint` entry trims-to-unset on merge, so the merged blob is byte-identical to base and `isTemplateDirty` correctly reports `false` — no more false-positive dirtiness from a stray space. It also resolves the v1 footnote's acknowledged gap (retyping a field to match base's own value is now correctly "not dirty," superseding v1 §1's "acceptable false-positive" note).

Co2 (no explicit-clear affordance) is resolved by construction: the `FieldEdit` tri-state makes "cleared" a first-class, distinguishable state from "untouched" — clearing an input **is** the clear affordance (placeholder reappears showing base's italic value in the UI; the merge treats it as `unset`, which for a field the base didn't have is a no-op, and for a field the base did have is a genuine removal). No new gesture needed.

## R4 — Zero-blocks Today guard

Confirmed reachable: R2's whole-block-skip pruning legally produces `blocks: []` on save (`validateDayTemplate` allows it, `day-template-validation.ts:80-81`). `days/[dateKey]/page.tsx:276` already guards (`shownTemplate && dayBlocks.length > 0`). `src/app/page.tsx:341-344` does **not** — `dayBlocks.map(...)` on an empty array renders nothing between the baseline card and the deferred-workout section, with no "nothing scheduled" messaging, for a day that isn't flagged `isRestDay` (`isRestDay = resolved.todayTask === "rest"`, a different signal than `dayBlocks.length`). One-line defensive add to the touch list:
```tsx
{dayBlocks.length === 0 ? (
  <p className="text-sm text-[var(--muted)] px-1">Nothing scheduled today.</p>
) : (
  dayBlocks.map((block, i) => <BlockCard key={i} block={block} index={i + (showProminentBaseline ? 1 : 0)} />)
)}
```

## R5 — `hasOverride` prop (Co4)

Resolved by elimination, not renaming: v1's only consumer of the compound `hasOverride` prop inside the new editor was the "skip submit when nothing changed and no prior override exists" rule in v1 §4. That rule is **retired** — R1's hidden-input omission already prevents a redundant rotation-default row from being created (no dirty workout → no `workoutJson` key → server's delete-collapse, R1, naturally no-ops when nothing else changed either). `DayOverrideForm`'s existing use of `hasOverride` (Save vs Update button copy, Clear button visibility) is unchanged and was never actually mismatched for that purpose — only the now-deleted diff-gating idea needed a narrower signal it never got. No prop change required.

## R6 — Save flow (supersedes v1 §4)

Shared Save button: `disabled={pending || hasFieldErrors}` where `hasFieldErrors = edits.blocks.some(b => b.exercises.some(e => Object.keys(e.fieldErrors).length > 0))`. **Never** gated on `isTemplateDirty` — a nutrition/mobility/notes-only edit must always be submittable (this is the direct C1 fix). Advanced mode: pre-submit `JSON.parse` + `validateDayTemplate` on `advancedJson` blocks submit on failure (v1 §3, unchanged) — this is a different, legitimate gate (malformed JSON), not a diff-emptiness gate. The "No changes to save" muted-button affordance from v1 §4 is **dropped** — it was the mechanism that caused C1; UXR-235-23's empty-diff short-circuit is now satisfied structurally by hidden-input omission (R1), not by disabling Save.

## R7 — Advanced tab (unchanged mechanics, updated dirty source)

Switch-in serializes `mergeTemplateEdits(base, edits)` (unchanged, v1 §3). Switch-back (`A_Gate`) on valid parse: `edits = templateToEditorState(base, parsed)` (§2's reconciliation, replacing v1's buggy version); `base` still never reassigned. Guard-banner placement/copy/`aria-live` unchanged from v1 §2.

## R8 — QA checklist (materializes UX report §10, all 9 items — verify on real 390px device, both themes, before ship)

- [ ] UXR-235-16: `reps`/`weightHint` cell min-width 3.5–4.5rem — `30-50 lb`, `12-20`, `10 each leg` don't clip
- [ ] UXR-235-24: 16px numeric inputs — sets/durationSec pair doesn't force wrap at 390px (stack if it does)
- [ ] UXR-235-17: block-chrome band padding/fill reads as "chrome, not pressable," dark included
- [ ] UXR-235-18: inter-block gap (12–16px) visibly > inter-exercise divider
- [ ] UXR-235-15: dimmed skipped-row opacity 0.45–0.6 passes AA both themes
- [ ] UXR-235-20: Advanced-tab muted label passes AA in dark at 12px, bump to `--foreground` if not
- [ ] UXR-235-21: danger banner tint + text pass AA at `text-sm`, both themes
- [ ] UXR-235-12/13/14/19: motion timings (skip dim, pill in/out, macro-flash, save-confirm-fade, tab-content-fade, banner fade-in) read calm, not flashy
- [ ] UXR-235-09: baseline banner copy ≤ ~3 lines at 390px
- [ ] R2's new "foreign rows are editable, not disabled" call-out (no UXR ID — flag for the same Tech-Lead sign-off UXR-235-08 got)

## R9 — Tests

`day-template-edit.test.ts` (extends v1's 10-case list to 16 — new cases 11-16):
1-10. Unchanged from v1 §6 (merge fidelity, skip/whole-block-skip/all-skip round-trips, foreign passthrough, empty-diff-vs-rotation-base, chrome preservation) — reworded where v1 referenced `computeTemplateDiff`, now `isTemplateDirty`.
11. **Reorder round-trip** (the exact C3 repro): base block0 `[A,B,C]`; edit `C.weightHint` in Structured; switch to Advanced; insert `X` at index 0 → `[X,A,B,C]`; switch back → C's edit preserved via name match, `X` is `foreign:true` + fully editable, A/B untouched.
12. **Rename-without-move** (tier-2 positional fallback): base block0 `[A,B]`; Advanced renames `A`→`A2` at index 0, no reorder → reconciled row at index 0 shows `A`'s base values as placeholder (positional fallback), editable, not foreign.
13. **Whole-block insert**: Advanced adds a new block not in base → reconciled as `foreign: true` `BlockEditState`, all exercises tier-3.
14. **Whole-block removal**: Advanced deletes a base block entirely → its exercises reconcile as `skipped:true`, grouped, appended after surviving blocks, restorable via un-skip.
15. Coercion matrix: `sets` empty → key removed; `sets:"5.5"` → `fieldErrors.sets` set, key omitted from merge output; `durationSec:"0"` → invalid (not positive); `reps:"8-10"` → preserved string, no error; `weightHint`/`notes` whitespace-only → key removed.
16. `isTemplateDirty`: clearing a field back to a value matching base → `false`; whitespace-only entry into an unset base field → `false` (Co3 regression guard).

`day-actions.test.ts` — new tri-state matrix (8 cases, per R1):
1. `workoutJson` absent, existing override has `workoutJson` → column untouched after save; guard not evaluated; nutrition/mobility/notes still update.
2. `workoutJson` absent, no existing override, `nutritionText` provided → CREATE with `workoutJson: undefined` (rotation stays live), no guard.
3. `workoutJson` absent, no existing override, all fields blank → no-op delete (harmless, row never existed).
4. `workoutJson` absent, existing override has `workoutJson`, all other fields now blank → row **preserved** (not deleted): `finalWorkoutPresent` keeps it alive.
5. `workoutJson` present + blank, existing override has `workoutJson` → wipes to `Prisma.JsonNull` (today's semantics, unchanged); guard skipped.
6. `workoutJson` present + blank, all else blank, existing override had only `workoutJson` → delete-collapse fires, row removed.
7. `workoutJson` present + real value, baseline day, no `baselineTestNames` on file → guard fires (v1 cap, unchanged) — and confirm case 1 does **not** also fire it.
8. `workoutJson` present + real value, valid → full #234 pipeline unchanged (size, shape, guard, upsert).

## R10 — UXR ledger mapping

Unchanged from v1 §7 except: UXR-235-23 (empty-diff short-circuit) now implemented via hidden-input omission (R1/R6) rather than button-disable; UXR-235-08's precedent explicitly extended to the new "foreign rows are editable" call-out (R2/R8). S1/S2 suggestions from the critique: adopted as written (S1: fold UXR-235-05 into the tuning/defers bucket; S2: notes-disclosure open state is ephemeral, excluded from `EditorState`).
