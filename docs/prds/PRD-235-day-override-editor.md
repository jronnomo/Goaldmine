# PRD: Structured Day Override editor v1 + Advanced JSON tab (#235)

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-07-10
**Status**: Approved (UX findings pending — Open Questions to be resolved before development)
**GitHub Issue**: #235 (Sprint 12 closer — High-risk structural; dep #234 ✅)
**Branch**: feature/phase1-auth
**UX-research**: INVOKED — new UI surface (structured editor + tab system); findings will resolve §9 before Phase 4

---

## 1. Overview

### 1.1 Problem Statement
Overriding a day's workout requires hand-editing raw JSON in a textarea (DayOverrideForm.tsx:33-42) — validated since #234, but hostile to non-power users and error-prone on a phone. The common edits (tweak a weight hint, change sets/reps, skip an exercise today) deserve real form controls; block-level surgery can stay behind an explicit Advanced tab.

### 1.2 Premise check & design rulings (verified, HEAD 6c06e7e)
- **computeDiff idiom** exists (WorkoutEditor.tsx:95-199: changed-fields-only patches + empty-diff no-round-trip) — conceptual reference (it edits Workout rows, not templates).
- **builder|advanced idiom** exists (TargetsBuilder.tsx:126-176: serialize on open-advanced; parse-on-switch-back that keeps you in advanced with the error; hidden-input persistence keeping the server action untouched).
- **ExercisePrescription fields** (program-template.ts:4-12): name, equipment?, sets?, reps? (string|number), durationSec?, weightHint?, notes?. Block carries type/label/rounds/restSec. All AC-enumerated fields real.
- **RULING — skip-today = omission**: no skip flag exists, and adding one costs 7+ consumer surfaces (Today, days BlockView+prefill, plan page, mcp today-shapers, find_exercise_in_plan, prescription-prefill, SnapshotView). The override is standalone day-truth: skip = exclude the exercise from the merged output; un-skip = restore from the base the editor holds. Zero type/renderer changes.
- **RULING — diff-then-merge-then-full-blob**: persistence is always the whole workoutJson blob; the ops vocabulary (day-template-ops.ts:64-70) is whole-exercise-merge only with no dashboard action. Client computes the diff (empty → no submit), merges into the base, submits full JSON through the #234-hardened `upsertDayOverrideFromForm`. The AC's byte-preservation purpose is honored via base-merge; interpretation documented here.
- **Baseline guard**: fires on structured saves for baseline days with no decision on file → covenant message in the existing banner. No baselineTestNames affordance in v1 (AC cap; documented limitation).
- Page contract stays: page.tsx:403-416 resolves (override ?? deferral-aware shownTemplate) and passes STRINGS.

### 1.3 Success Criteria
Common edits doable without touching JSON at 390px; unrelated template content preserved byte-for-byte; Advanced tab round-trips; all saves through the hardened path; Clear unchanged; gates green.

---

## 2. User Stories
| ID | As a... | I want to... | So that... | Priority |
|---|---|---|---|---|
| US-001 | User adjusting today's session | edit sets/reps/weightHint/duration/notes per exercise with form controls | no JSON on a phone | Must Have |
| US-002 | User not doing an exercise today | toggle Skip on it | the day's truth reflects reality without deleting anything by hand | Must Have |
| US-003 | Power user / coach-directed edit | full JSON in an Advanced tab with validation on the way back | block CRUD stays possible | Must Have |
| US-004 | Any user | unrelated blocks/exercises untouched by my edit | the coach's structure survives my tweak | Must Have |

---

## 3. Functional Requirements

### 3.1 Core
1. **Structured tab (default)**: title input; per-block read-only chrome (type/label/rounds/restSec); per-exercise editable rows — sets (number), reps (text, preserves string|number round-trip), weightHint (text), durationSec (number), notes (text); equipment read-only; Skip-today toggle (visual strike; omitted from merge; un-skip restores). NO add/remove exercise, NO block CRUD (AC cap — Advanced only).
2. **Advanced JSON tab**: the existing textarea; TargetsBuilder idiom (serialize current working template on switch-in; on switch-back parse + client-side `validateDayTemplate` — invalid stays in Advanced with the error); pre-submit client validation on Advanced saves too.
3. **Save**: `computeTemplateDiff(base, edited)` → empty = no-op; else `mergeTemplateEdits` → full template JSON into the form's workoutJson field → existing `upsertDayOverrideFromForm` (server unchanged; #234 validation+guard apply).
4. **New pure lib `src/lib/day-template-edit.ts`** (client-safe, no server imports): diff/merge/skip logic + types; heavy unit tests (merge fidelity byte-preservation, skip round-trip, reps type round-trip, empty-diff detection, foreign-exercise handling per DA ruling).
5. nutritionText/mobilityText/notes fields and Clear (ConfirmButton) unchanged.

### 3.2 Out of Scope
baselineTestNames affordance (guard still blocks baseline-day audibles — v1 cap); add-exercise in structured; server action changes; skip flag in the type system; #253 BottomSheet fix.

---

## 4. Technical Design
No schema/route/MCP changes (no connector reload). Component decomposition + 390px layout per UX findings → architect blueprint. State: working template (parsed once from defaults.workoutJson), base template (for skip-restore + diff), tab mode, per-exercise edit state keyed by block/exercise index. validateDayTemplate confirmed pure/client-safe for Advanced-tab checks.

---

## 5. UI/UX
390px-first; dense per-exercise rows are THE layout risk → UX findings govern (row anatomy, number-input ergonomics, skip affordance, tab placement). House tokens only; tap targets ≥44px; TargetsBuilder's radiogroup segmented control (:364-422) as the tab primitive candidate.

---

## 6. Edge Cases
| Scenario | Expected |
|---|---|
| Skip every exercise in a block | DA rules: prune block (ops-path parity) vs keep empty — must match validator (blocks array shape) |
| Advanced adds a NEW exercise, switch back to Structured | Foreign exercises render read-only (scoped editor) — DA confirms exact treatment |
| reps "8-10" (string) vs 10 (number) | Round-trips without type coercion |
| Baseline day, no decision on file | Guard banner (covenant message); save blocked — documented v1 behavior |
| Rest-day template (category "rest", no blocks) | Structured tab renders sanely (title only) |
| Empty diff | No submit, no banner |
| dayOfWeek/category/summary | Preserved untouched through merge |

---

## 7. Security
No new inputs beyond form fields feeding the existing validated action; client validation is UX-only (server assertions from #234 remain authoritative).

---

## 8. Acceptance Criteria
1. [ ] Structured tab edits all five fields + skip, scoped to base exercises; no block CRUD present
2. [ ] Byte-preservation: untouched blocks/exercises identical in saved JSON (unit + manual diff)
3. [ ] Advanced tab round-trip per idiom incl. invalid-JSON stays-in-advanced; client-validated pre-submit
4. [ ] All saves through upsertDayOverrideFromForm (grep: no new write path)
5. [ ] Clear flow unchanged; AC manual smoke: weightHint edit reflects on /days + /calendar; Advanced round-trips structured output
6. [ ] tsc 0 / lint no new / 722+ tests / build OK
7. [ ] UX Recommendation Ledger ticked (research ran)

---

## 9. Open Questions — RESOLVED by UX research (docs/ux-research/day-override-editor.md; ledger day-override-editor-ledger.md, 26 UXR-235-NN rows)
1. **Row anatomy**: inline-always "Ledger Row" block-cards — read-only block chrome band above a label-once numeric grid (reps/weightHint prominent; durationSec only on timed moves; notes behind a disclosure). Accordion + edit-in-place rejected.
2. **Tab affordance**: weighted radiogroup segmented control — Structured accent-filled, Advanced muted/outline with a "raw" marker (named primitive honored AND de-emphasized).
3. **Skip**: labeled toggle; **dim-in-place (opacity) + muted "Skipped · Undo" pill** — UXR-235-08 refinement over the earlier "visual strike" wording, APPROVED by Tech Lead (strikethrough reads as deletion; dim+pill reads reversible-inactive). No confirm on skip.
4. **Numbers**: bare inputs with inputMode (numeric/decimal), NO steppers, text-base (16px, iOS zoom avoidance); reps stays free text with a tested string↔number round-trip.
5. **Guard error**: coach-voiced banner directly above Save, aria-live, persists across tab switches, no fake resolve affordance.
- Base-value presentation: untouched fields show the base as italic placeholder ("inherit the plan" semantics).
- Nine provisional/verify-visually items (cell min-widths, dim opacity AA both themes, Advanced-tab contrast, banner AA, motion timings, copy length) → QA browser pass must check each; ledger rows marked tuning⚠/a11y⚠.

---

## 10. Test Plan
Gates; day-template-edit.test.ts matrix; browser 390px full walkthrough per §Verification of the approved plan; AC manual smoke.

---

## 11. Appendix
Premise report: `.feature-dev/2026-07-10-235-day-override-editor/agents/research-output.md`. Consumes #234's validators/guard. Memory: plan-is-conversational (the editor edits the day's truth; it does NOT auto-resolve plan conflicts).
