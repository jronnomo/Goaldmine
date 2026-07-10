# Devil's Advocate Critique — #235 Structured Day Override editor architecture blueprint

Reviewed: `.feature-dev/2026-07-10-235-day-override-editor/agents/architecture-blueprint.md` against PRD-235, `docs/ux-research/day-override-editor.md`, `research-output.md`, and source (`DayOverrideForm.tsx`, `days/[dateKey]/page.tsx`, `day-actions.ts`, `day-template-validation.ts`, `day-template-ops.ts`, `TargetsBuilder.tsx`, `program-template.ts`, `calendar.ts`).

---

## Critical

### C1 — The form-submit trap is real, and worse than stated: it blocks nutrition/mobility/notes-only saves

Blueprint §4: `disabled={pending || (mode==="structured" && computeTemplateDiff(base,edits).empty)}`, applied to "the Save button." But `DayOverrideForm.tsx` (lines 44-74) has **one shared submit button** for workoutJson + nutritionText + mobilityText + notes together — there is no per-field save. `computeTemplateDiff` only ever looks at workout edit state (`day-template-edit.ts` contract, §1). A user who edits **only** `nutritionText` leaves the workout diff empty, so the Save button goes `disabled` and the browser never submits — their nutrition edit is silently dropped. This is not hypothetical; it's the single most common edit shape (PRD problem statement's own example: "tweak a weight hint" is the *workout* case, but nutrition/mobility/notes edits are just as core to this form's existing purpose and get no path through the disabled gate).

§4's second ruling compounds it: `!hasOverride && computeTemplateDiff.empty → no submit` fires under the exact same conditions for a day that has never had an override — so a user's *first-ever* nutrition note on such a day is also blocked.

**Structural contradiction in the blueprint itself**: §2 states `DayOverrideForm.tsx` is the "server-adjacent shell — form action, nutrition/mobility/notes, Clear — **UNCHANGED**." But the Save button (`DayOverrideForm.tsx:82-89`) lives in that unchanged shell, while `computeTemplateDiff(base,edits).empty` is only computable inside `DayWorkoutEditor` (it owns `base`/`edits`). Gating the shell's button on that value requires a new callback/prop lifting the diff-emptiness boolean out of the island — which is a change to the shell, contradicting "UNCHANGED." The blueprint doesn't specify this plumbing anywhere.

**Correct fix**: never gate the shared Save button on the workout-only diff. Either (a) drop the disabled-on-empty-workout-diff idea entirely — keep Save always submittable as today, and rely on the server's existing no-op collapse (`day-actions.ts:54`, all-blank → delete; otherwise upsert is idempotent when nothing changed) to make a true no-op harmless; or (b) if the "No changes to save" affordance is kept, it must incorporate dirty-tracking for nutritionText/mobilityText/notes too — which today are **uncontrolled** `defaultValue` inputs with zero onChange/dirty state (`DayOverrideForm.tsx:44-73`). That's a real scope addition the blueprint doesn't budget for.

**Prescribed hidden-input policy matrix** (the task explicitly asked for this):

| workout untouched? | override.workoutJson exists? | other fields edited? | correct hidden `workoutJson` | correct Save enablement |
|---|---|---|---|---|
| yes | yes | no | merged base (= existing override JSON, byte-preserved) | disable OK (true no-op) |
| yes | yes | **yes** | merged base (preserve existing workout) | **must stay enabled** — blueprint's gate wrongly disables |
| yes | no | no | merged base (= rotation template, redundant-but-harmless per §4 ruling) | disable OK |
| yes | no | **yes** | merged base (= rotation template) | **must stay enabled** — blueprint's gate wrongly disables |

Row 2 and row 4 are the shipped-bug rows.

### C2 — Same design also permanently locks users out of saving on baseline-days with an existing override

`assertBaselineDecisionMade` (`day-template-validation.ts:171-189`) fires whenever `settingWorkout` (i.e., `workoutJson !== null` in the FormData) is true, no `baselineTestNames` was passed (dashboard never passes it — `day-actions.ts:47`, hardcoded `false`), the existing override's `baselineTestNames` isn't an array, and the rotation day has baseline tests. Because the dashboard `create`/`update` clauses (`day-actions.ts:59-72`) **never write `baselineTestNames`**, any override ever created through the dashboard has `baselineTestNames = null` forever — this is already documented as an accepted v1 gap ("today the form can only ever *hit* the guard, never satisfy it," UX report §1).

The blueprint's byte-preservation design (§1, §2 "Hidden input") means the hidden `workoutJson` field is **always non-null** in Structured mode once an override with workoutJson exists — even for a pure nutrition-only edit, because preserving the existing workout requires resubmitting it. That unconditionally sets `settingWorkout = true` and re-triggers the un-satisfiable guard, **for every future save on that day, including edits that never touch the workout**. Today's raw-textarea form at least lets a determined user manually blank the textarea to route around this (sacrificing the workout override to save nutrition text); the structured editor removes even that escape hatch — Structured mode auto-populates from base and gives no "blank it" gesture, and Advanced JSON still can't set `baselineTestNames` (no dashboard field exists in v1 scope). Net effect: **the new editor is strictly worse than the textarea it replaces for any baseline day that already has a dashboard-created override** — it cannot be resaved at all via dashboard, for anything. Worth flagging to the PRD's author even though the underlying guard-can't-be-satisfied gap is accepted — the *lockout* is a new, sharper failure mode this design introduces.

### C3 — Tuple-key (`blockIdx:exIdx`) drift on the one thing Advanced exists to do

§3's `templateToEditorState(base, parsed)` reconciles `A_Gate` by diffing `parsed` against frozen `base` per exercise, "matching `(blockIdx,exIdx,name)`." This works cleanly when Advanced only *edits values in place* (indices stable) — but PRD §3.1 and the blueprint itself state block/exercise CRUD is **Advanced-only**, i.e., Advanced's entire reason to exist includes inserting, removing, and reordering exercises/blocks. Any such structural edit shifts every subsequent exercise's `(blockIdx,exIdx)` position relative to `base`.

Concrete failure: `base.blocks[0].exercises = [A, B, C]`; user edits C's `weightHint` in Structured, switches to Advanced (now `[A,B,C]` with C's edit baked in), inserts a new exercise `X` at position 0 in the same block (an explicitly-supported Advanced operation), switches back. `parsed.blocks[0].exercises = [X,A,B,C]` — C is now at index 3, not 2. `templateToEditorState`'s position-keyed match against `base` (where C is at index 2) either misses C's edit entirely (position 2 in parsed is B, name mismatch) or — worse — misattributes B's unedited state to C's key, or classifies the *real* C as `foreign` (since it's not found at its expected base index) while the shifted names at earlier indices spuriously read as edited/skipped. The "un-skip restores exact values from the frozen base" and "skip = base minus this index" mechanisms in §1/§2 both depend on this same stable-index assumption, so a skip-restore after any Advanced-side reorder is equally suspect.

The blueprint's own "Rejected alternative for keying" note (§1) dismisses a `label+name` composite key only for duplicate-name collisions — it never addresses reorder/insert, which is arguably the *more common* Advanced workflow (the PRD calls this out as the reason Advanced exists at all: "block-level surgery can stay behind an explicit Advanced tab"). The 10-case test list (§6) has no test exercising insert/reorder-then-switch-back — exactly the gap that would catch this.

**Needs a real answer before build**: either (a) name-first matching within each block (position is a tiebreaker, not primary key) with an explicit multi-match/no-match policy, or (b) accept that any Advanced-side structural edit invalidates the frozen `base` and forces a full re-baseline (base *is* replaced, and skip-restore for anything edited before the Advanced excursion is deliberately lost) — but the blueprint currently asserts base is "frozen for the whole session" with no exception carved out for this case, which reads as a guarantee the algorithm can't keep.

---

## Concerns

### Co1 — Coercion rule specified for `reps` only; `sets`/`durationSec` are typed strictly `number` and have no stated rule
`program-template.ts:4-11` confirms `sets?: number`, `durationSec?: number` (no string variant) — unlike `reps?: string | number`. The blueprint's only stated coercion rule (§1) is the `/^\d+$/ ? Number(trimmed) : trimmed` rule, framed explicitly as "UXR-235-04's rule" for `reps`. If the same rule is applied uniformly to `sets`/`durationSec` (as §1's "byte-preservation mechanics" paragraph implies, since it describes one generic patch-merge path), a user typing `"5.5"` sets or a malformed value would be written back as a **string** into a field the type system says is `number` — `validateDayTemplate` does not check field types on `sets`/`reps`/`durationSec` beyond exercise `name` (`day-template-validation.ts:94-109`), so this would pass validation and silently corrupt downstream consumers that assume `number` (Today rendering, `records.ts`, prescription-prefill). Needs an explicit `sets`/`durationSec`-specific coercion contract, not an inherited `reps` rule.

### Co2 — No way to explicitly clear a field that has a base value
Since `""` always means "untouched/inherit base" (§1, §2 "Base-as-italic-placeholder mechanics"), there is no representable edit-state that means "the base had `weightHint: '30-50 lb'` and I want it gone." `WorkoutEditor`'s own patch model (the blueprint's cited precedent) allows clearing a field. This may be an acceptable v1 cap, but it's not called out as a limitation anywhere in the blueprint or PRD — worth an explicit ruling rather than a silent gap.

### Co3 — Whitespace-only input isn't trimmed for emptiness detection or for non-numeric fields
§1's empty-diff check is "a pure string-emptiness check" (`=== ""`); a single stray space (common on mobile) makes a field non-`""`, flips `computeTemplateDiff` to non-empty, and (per §1's byte-preservation mechanics) gets written verbatim into `weightHint`/`notes` in the merged JSON. Trimming is only specified for the `reps` numeric-coercion path (§6 test 6, "` 12 ` → trimmed then coerced"), not for the emptiness check generally or for free-text fields.

### Co4 — `hasOverride` prop is a compound signal; §4's rotation-redundancy ruling needs a narrower one
`hasOverride` (`page.tsx:415`) = `r.isOverride || !!r.nutritionText || !!r.mobilityText || !!r.notes` — true even when only text fields are overridden and no `workoutJson` override exists. Blueprint §4's "Empty-diff-vs-rotation-base case" gates on `!hasOverride`, but the semantics it actually needs is "does `override.workoutJson` exist" (i.e., is `base` the rotation template or a real override). Using the compound prop means a day with a text-only override (no workout override) is treated as `hasOverride === true`, skipping the intended rotation-redundancy short-circuit — directly entangled with C1/C2 above.

### Co5 — Today page has no zero-blocks guard; blueprint documents `blocks: []` as a first-class outcome without addressing it
Confirmed `validateDayTemplate` (`day-template-validation.ts:80-81`) legally allows `blocks: []` (comment: "use `[]` for a rest day"), and the blueprint's "Empty-block pruning ruling" (§1) deliberately produces `blocks: []` from an all-skipped save. `days/[dateKey]/page.tsx:276` guards with `dayBlocks.length > 0` before rendering `BlockView` (renders nothing, no crash). But `src/app/page.tsx:342` (Today) maps `dayBlocks` with **no length guard** — not a crash, but an all-skipped save (a state this blueprint explicitly makes reachable) renders a silent hole on Today with no "nothing scheduled" messaging, unlike the day-detail page. Not flagged anywhere in the blueprint's edge-case coverage.

### Co6 — No materialized QA checklist for the nine verify-visually items
§7 tags UXR IDs as "Implements" vs "Defers to implementer's UI-layer pass," which covers 8 of the UX report's 9 `⚠ Provisional/Verify-Visually` items (§10 of the UX report) by ledger-status bucketing alone — there's no explicit instruction that these 9 items must be checked on a real 390px device in both themes before ship (UX report §10's own framing). Ledger-tagging "implements" (e.g., UXR-235-09, banner copy length) isn't the same as "verified visually" — the UX report explicitly wants device verification regardless of implementation status. This should be carried forward as an actual QA task list, not just inferred from the ledger table.

---

## Suggestions

- S1 — UXR-235-05 (segmented-tab asymmetric weighting: accent-fill Structured vs muted-outline+⚠raw Advanced) is tagged "Implements" in §7, but the actual weighting is pure CSS/class-selection, same category as the "Defers to UI-layer pass" bucket (§7 second paragraph). Minor inconsistency in the implements/defers split — doesn't change behavior, just tidy the ledger mapping.
- S2 — Explicitly state that notes-disclosure open/closed state is ephemeral UI state, deliberately excluded from `EditorState`/`ExerciseEditState` — currently implied, not stated, and an implementer could reasonably wonder whether it needs persisting across tab switches.

---

## Verified correct (no issue)

- **A3 — Frozen base semantics**: confirmed `base` = `JSON.parse(defaults.workoutJson)`, and `defaults.workoutJson` (`page.tsx:406-410`) is the override's JSON when `r.override?.workoutJson` is truthy, else the resolved rotation/deferral template. Skip-restore correctly operates against the override when one exists; rotation is correctly unreachable from the editor. Matches PRD AC ("scoped to exercises already present in the resolved day's template").
- **A5 — `blocks: []` legality**: directly verified at `day-template-validation.ts:80-81` — `Array.isArray(v.blocks)` with an explicit "(use `[]` for a rest day)" message; empty array passes. Blueprint's claim is accurate. (Renderer gap noted separately as Co5.)
- **A6 — UXR-235-08 skip presentation (dim+pill over strikethrough)**: PRD §9 item 3 already records this as "APPROVED by Tech Lead" — not an open challenge the blueprint silently resolved; correctly implemented as approved direction.
- Server write path, no block CRUD in Structured, and Clear/ConfirmButton being left alone are all correctly scoped per blueprint §2/§8 and PRD §3.2.

---

## Verdict: REVISE

Top 3:
1. **Form-submit trap (C1)** — Save-button disable is gated solely on the workout diff via a shared button, silently blocking any nutrition/mobility/notes-only edit; also contradicts the blueprint's own "shell UNCHANGED" claim.
2. **Baseline-guard lockout (C2)** — byte-preserving hidden input always resends `workoutJson` once an override exists, so any baseline-day override (guaranteed `baselineTestNames: null` in v1) becomes permanently unsavable via dashboard for *any* field, a regression versus today's textarea.
3. **Tuple-key drift on Advanced CRUD (C3)** — `(blockIdx,exIdx)`-keyed reconciliation breaks precisely when Advanced does the block/exercise insert-remove-reorder it exists to support; no test in §6 exercises this path.
