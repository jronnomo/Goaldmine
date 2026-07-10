# QA Report — #235 Structured Day Override editor

**Scope**: independent code-level verification at HEAD `c5d4cb8` (feature/phase1-auth). Read-only on `src/`. Gates re-run locally (not trusted from commit message alone).

**Gates (re-run)**: `tsc --noEmit` → 0 errors. `npm run lint` → 2 pre-existing warnings in `src/lib/oauth/token-grants.test.ts` (unrelated to #235, not newly introduced). `vitest run` → **760/760 passed** (30 new `day-template-edit.test.ts`, 29 in `day-actions.test.ts` incl. the 8 new tri-state cases + pre-existing #234 coverage). `npm run build` → succeeded.

---

## 1. PRD §8 Acceptance Criteria (1–6; #7 is the orchestrator's)

| # | AC | Verdict | Evidence |
|---|---|---|---|
| 1 | Structured tab edits 5 fields + skip, scoped to base exercises; no block CRUD | **PASS***(flagged)* | `ExerciseRow.tsx` renders sets/reps/weightHint/durationSec/notes + skip toggle. Grep for add/remove-block/exercise controls across `day-editor/*.tsx`, `DayWorkoutEditor.tsx`, `DayOverrideForm.tsx` → zero hits. **Caveat**: "scoped to base exercises" is literally violated by design — blueprint R2 makes foreign (Advanced-inserted) exercises **fully editable** in Structured, explicitly superseding PRD §3.1/§6's "render read-only" wording. This was flagged in `architecture-blueprint-v2.md` R2/R8 for "the same kind of sign-off UXR-235-08 got" — I found no recorded sign-off anywhere in the repo. Not a bug (deliberate, reasoned, tested — case 11/13), but an open governance loop. |
| 2 | Byte-preservation: untouched blocks/exercises identical in saved JSON | **PASS** | Unit tests 1, 2, 10 in `day-template-edit.test.ts` assert `JSON.stringify` equality on untouched siblings/blocks/metadata after a single-field edit. Merge mechanics (`{...baseObj}` shallow clone, reassign/delete only touched keys) verified by reading `mergeTemplateEdits`. Manual-diff half of this AC is the dev's browser evidence, not re-verified here. |
| 3 | Advanced round-trip incl. invalid-JSON-stays-in-Advanced; client-validated pre-submit | **PASS** | `switchToStructured()` gates on `JSON.parse` + `validateDayTemplate`, sets `switchError` and stays in Advanced on failure (`DayWorkoutEditor.tsx:127-141`). `validateBeforeSubmit()` (imperative handle) re-runs the same gate before every submit, called from `DayOverrideForm.tsx:30`; commit message documents a real bug fix here (tab-button `onClick` originally bypassed the gate, only keyboard nav was gated — now both route through the same functions). |
| 4 | All saves through `upsertDayOverrideFromForm` (no new write path) | **PASS** | Grepped `src/app/` + `src/components/` for both exported day-actions functions — only `DayOverrideForm.tsx` calls them. No new API route, no `fetch`, no second server action. |
| 5 | Clear unchanged; manual smoke (weightHint on /days + /calendar; Advanced round-trip) | **PASS (code)** / **not independently verified** | `ConfirmButton`-driven Clear flow in `DayOverrideForm.tsx` is byte-identical to pre-#235 except for the ref plumbing. Manual browser smoke is explicitly the dev's recorded evidence per the task brief — out of scope for this code-only pass. |
| 6 | tsc 0 / lint no new / 722+ tests / build OK | **PASS** | Verified directly, see gates line above. Commit message's 722-baseline + 30 + 8 = 760 math checks out exactly. |

---

## 2. Critique Criticals

| # | Critique finding | Verdict | Notes |
|---|---|---|---|
| C1 | Save gated on workout diff, blocking nutrition-only saves | **RESOLVED for the default path / PARTIALLY REOPENED for Advanced** | `DayOverrideForm.tsx:96`: `disabled={pending \|\| hasFieldErrors}` — never gated on dirty/diff, matches R6 exactly. In **Structured** mode the hidden `workoutJson` input is correctly omitted when `!dirty` (`showHiddenInput = mode === "advanced" \|\| dirty`), so the common "type a nutrition note, hit Save" path never touches the workout column or the guard. **But** `mode === "advanced"` unconditionally forces the hidden input on, regardless of whether the Advanced textarea content actually diverges from `base` — see §3 below, this is the highest-value finding. |
| C2 | Byte-preserving hidden input permanently locks baseline-day overrides out of any future save | **RESOLVED** | `day-actions.ts` tri-state (`workoutFieldProvided`) + `finalWorkoutPresent` delete-collapse fix both confirmed by reading the code and by the 8-case tri-state matrix + the 3-case "notes-only save on baseline day" describe block in `day-actions.test.ts`, all passing. Case 1 in the tri-state matrix directly asserts the guard stays silent when `workoutJson` is absent on a baseline day with no decision on file — the exact C2 repro, now green. |
| C3 | Tuple-key (`blockIdx:exIdx`) reconciliation breaks on Advanced insert/reorder/rename/delete | **RESOLVED** | `alignBlock`'s two-pass tier-1(name)/tier-2(position)/tier-3(foreign) algorithm read in full; the two-pass structure (`tier1Match` computed for *all* parsed exercises before positional fallback runs) is exactly what prevents an insert from being misattributed to an unused base index. Tests 11–14 are direct repros of the critique's own failure scenarios (reorder, rename-without-move, whole-block insert, whole-block removal) and all pass. |

### C1 deviation ruling (the highest-value check)

**The `mode === "advanced" || dirty` hidden-input condition is not fully safe.** Walk the scenario: a baseline day has no `baselineTestNames` decision on file (the permanent, accepted v1 gap). The user opens the Advanced tab (even just to look — no edit made), then goes back to the nutrition textarea and clicks Save without switching back to Structured. `mode` is still `"advanced"`, so `showHiddenInput` is `true` and the hidden input carries `advancedJson` — real, non-blank, parseable JSON (whatever `openAdvanced()` last serialized, i.e., `mergeTemplateEdits(base, edits)`, content-equal to `base`). In `day-actions.ts`, `workoutFieldProvided = true` and `workoutRaw` is non-blank, so `workoutJson` parses to a real object → `settingWorkout = workoutJson !== null = true` → `assertBaselineDecisionMade` fires exactly as it did pre-#235. The **entire save is rejected** (the throw happens before any write), so the nutrition edit that motivated the save is also silently lost from the user's perspective — a Save that "should" have worked based on C1's own framing fails.

This is a real, narrower reincarnation of C1/C2, gated behind: (a) user must have explicitly switched to Advanced, (b) must not switch back to Structured before Save, (c) must be a baseline day with no decision on file. It does **not** affect the default Structured-mode flow, which is the overwhelming common case and is correctly fixed. The in-code comment at `DayWorkoutEditor.tsx:143-150` overclaims: *"so a pure nutrition/mobility/notes save never touches the workoutJson column or the baseline guard"* — false whenever `mode === "advanced"`, and this isn't noted as a limitation anywhere (not in the PRD, not in the blueprint's R8 QA checklist, not in the commit message).

**Ruling**: real bug, medium severity, narrow trigger, cheap fix. Recommend before ship: either (a) track an Advanced-mode-equivalent dirty signal (parse `advancedJson`, compare against `base`, only force the hidden input when that differs — mirrors `isTemplateDirty` but for the raw-JSON path) so a "peeked at Advanced, didn't touch it" save is also diff-gated, or (b) at minimum fix the misleading comment and add this as an explicit documented v1 limitation next to the existing "guard unsatisfiable via dashboard" cap, so it's a known trade-off rather than a silent gap discovered by a confused user hitting a raw validator-message wall.

---

## 3. Additional findings by severity

**Medium**
- **C1-deviation** above (Advanced-parked save can reintroduce the baseline-guard lockout for nutrition/notes-only edits).
- **UXR-235-09 not implemented, not just unverified**: the guard-blocked error banner renders the raw `assertBaselineDecisionMade` throw message verbatim (`DayOverrideForm.tsx:34`, `e.message`) — the exact "reads like a bug, not coaching" string the UX report's own audit (§1) called out as the problem, and the same message unchanged from #234. The report's Q5 resolution explicitly proposed compressed, coach-voiced copy ("Baseline check needed…") and a "≤3 lines at 390px" bound (UXR-235-09, tagged in R8's QA checklist as something to verify). At ~300 characters of dev-oriented multi-clause text, this will not fit 3 lines at `text-sm`/390px and was never rewritten — this is a missed implementation item, not a device-tuning question.
- **UXR-235-11/19 (calm save-confirm) not implemented**: `.macro-flash` and `.save-confirm-fade` classes exist in `globals.css` (confirmed present, reused-idiom claim in the UX report is accurate for the classes' existence) but are used nowhere in `DayWorkoutEditor.tsx`, `DayOverrideForm.tsx`, or `day-editor/*.tsx` (grep confirmed zero references). Save success is a plain "Saving…" → button re-enables with no numeral-flash or confirm-fade. Cosmetic, not a correctness issue, but it's a ledger item ("proposed") that's not actually wired, not merely awaiting device tuning.

**Low / informational**
- **UXR-235-20** (Advanced-tab muted label AA in dark @ 12px): code uses a bare `text-[var(--muted)]` class with no conditional "bump to `--foreground` if it fails" fallback wired — if the device check fails, a follow-up code change (not just a token tweak) is still needed since there's no branch to flip.
- Foreign-row-editable-not-read-only (AC #1 caveat, §1 above) — same "needs Tech-Lead sign-off" status as UXR-235-08, unresolved as far as I can find in the repo.

**Verify-visually items — code-level basis found (7 of 9), genuinely need device confirmation**
1. UXR-235-16 (cell min-width 3.5–4.5rem) — `min-w-[3.5rem]` present in `cellInputBase`; upper bound isn't hard-capped (cells are `1fr`), likely fine but wrapping at real content lengths (`30-50 lb`, `10 each leg`) needs a phone check.
2. UXR-235-24 (16px inputs, sets/durationSec wrap) — `text-base` present; grid is `grid-cols-[4.5rem_1fr]`/`[4.5rem_1fr_1fr]`, wrap behavior at 390px needs a device check.
3. UXR-235-17 (chrome band non-pressable) — plain `<p>` typography, no button semantics; dark-mode legibility needs a check.
4. UXR-235-18 (inter-block gap > inter-exercise divider) — `flex flex-col gap-3` (12px) between blocks vs `border-b` per-exercise divider; at the low end of the recommended 12–16px range, hierarchy legibility needs a check.
5. UXR-235-15 (skip dim opacity AA) — `opacity-50` (0.5, within 0.45–0.6) on skipped rows; AA in dark ("coal is unforgiving," per the UX report) needs a check.
6. UXR-235-21 (danger banner AA) — reuses the exact `WorkoutEditor` error-banner class idiom (`--danger` text on `--danger/10`), already a claimed AA-verified benchmark; low risk, still worth the device pass per the checklist's own framing.
7. UXR-235-12/13/14 (skip-dim/pill/notes-disclosure timings) — `.item-row-anim`, opacity transition classes present and reduced-motion-guarded in `globals.css`; timings are the ⚠ playtest ranges as documented, need a device feel-check.

Items 8 (macro-flash/save-confirm-fade) and 9 (banner copy) are **not** "needs device confirmation" — they're unimplemented, see Medium findings above.

---

## Verdict: **FIX-FIRST**

Narrow scope: one real bug (C1-deviation, §2 ruling) plus two missed UX-report implementation items (banner copy, save-confirm animation) — not a rework. Core engine (diff/merge/reconciliation/tri-state) is correct, thoroughly tested (59 targeted + 760/760 total), tsc/lint/build all clean.

**Final**: FIX-FIRST. C1-deviation: Advanced-parked nutrition/notes-only saves on baseline days without a decision on file re-trigger the guard and fail the whole save — real but narrow (requires explicit Advanced-tab visit + no switch-back), cheap fix available (Advanced-mode dirty check, mirroring `isTemplateDirty`), currently undocumented and the code comment overclaims safety. AC 1–6 code-level: 5 PASS, 1 PASS-with-flagged-deviation (foreign rows editable, no recorded sign-off). Criticals: C2/C3 fully resolved; C1 resolved for the default Structured path only. Gates: tsc 0, lint clean, 760/760 tests, build OK. 2 medium + 3 low findings beyond the criticals, mostly missed (not just unverified) UX-report items (banner copy, save-confirm animation).

