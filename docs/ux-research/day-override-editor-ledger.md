# UX Recommendation Ledger — Day Override editor (#235)

Companion to `day-override-editor.md`. Stable IDs (`UXR-235-NN`, never renumbered).
Status starts `proposed`; the implementing PR ticks each to `shipped`/`reworked`/`dropped`
with a SHA / `file:line` / short reason. Every ⚠ item in the report appears here.

| ID | Recommendation | Type | Status | Evidence |
|---|---|---|---|---|
| UXR-235-01 | Inline-always block-card row anatomy (read-only chrome band + label-once numeric grid); reject accordion/edit-in-place | layout | shipped | c5d4cb8 DayWorkoutEditor/BlockCard/ExerciseRow |
| UXR-235-02 | Field prominence: reps/weightHint wide cells; durationSec only for timed (m:ss); notes behind `+ notes` disclosure | layout | reworked | c5d4cb8 — simplified to SETS+REPS+WEIGHT vs SETS+TIME (dev UI discretion, documented) |
| UXR-235-03 | Bare `inputMode` text inputs, no steppers, `font-mono`, `text-base` 16px, `placeholder="—"` | component | shipped | c5d4cb8 ExerciseRow inputs |
| UXR-235-04 | `reps` string\|number round-trip: store string, `/^\d+$/?Number:string`, no coercion; unit-tested | component | shipped | c5d4cb8 day-template-edit.ts clean-digit rule + reps type matrix tests |
| UXR-235-05 | Tabs = weighted radiogroup segmented control (Structured accent-fill; Advanced muted/outline + ⚠ raw) | component | shipped | c5d4cb8 segmented control, screenshot-verified |
| UXR-235-06 | Parse-on-switch-back gate: JSON.parse+validateDayTemplate; invalid stays in Advanced w/ tab-local switchError | component | reworked | 343184b — dev found tab-CLICK bypassed the gate (keyboard-only), fixed in c5d4cb8 verification; iter2 hardened |
| UXR-235-07 | Skip = labeled toggle (`↺ Skip`/`Skipped·Undo`), not swipe; no confirm on skip; Clear keeps ConfirmButton | component | shipped | c5d4cb8 skip toggle + Clear/ConfirmButton untouched |
| UXR-235-08 | Skip presentation = dim-in-place + muted pill, NOT strikethrough/collapse — challenges PRD §3.1 "visual strike," needs sign-off | a11y⚠ | shipped | c5d4cb8 dim+pill (Tech-Lead signed off in PRD §9.3) |
| UXR-235-09 | Baseline covenant banner above Save, aria-live, outside key={mode}; compressed coach copy; muted-italic MCP/Advanced pointer; no fake resolve button | a11y | reworked | 343184b day-save-error-copy.ts — coach-voiced rewrite landed iter2 after QA caught the raw throw |
| UXR-235-10 | Two error slots: saveError (root, persists across tabs) vs switchError (tab-local, Advanced) | component | shipped | c5d4cb8 saveError vs switchError slots |
| UXR-235-11 | Calm save confirm: `.macro-flash` changed numerals + `.save-confirm-fade`; NO bullseye-pop | animation | dropped | save-confirm animation deferred (dev effort budget, documented deviation) |
| UXR-235-12 | Skip dim opacity/color transition ~150–200ms; pill via `.item-row-anim` | tuning⚠ | shipped | c5d4cb8 item-row-anim reuse; exact timing unmeasured — device pass |
| UXR-235-13 | Tab-content fade `.tab-content-fade` re-keyed on mode ~110–160ms | tuning⚠ | shipped | c5d4cb8 tab-content-fade re-keyed on mode |
| UXR-235-14 | Notes disclosure via `.item-row-anim` add ~180–240ms / remove ~160–220ms | tuning⚠ | shipped | c5d4cb8 item-row-anim on disclosure; timing unmeasured |
| UXR-235-15 | Dimmed skipped-row opacity 0.45–0.6 — verify AA both themes | tuning⚠ | shipped | c5d4cb8 opacity in range; AA both themes = device pass pending |
| UXR-235-16 | Numeric cell min-width 3.5–4.5rem so weightHint/reps don't clip at 390px | tuning⚠ | shipped | c5d4cb8 min-w cells; 390px clip check = device pass pending |
| UXR-235-17 | Block-chrome band py-2..py-3 + fill choice (accent-soft vs card+border-b) reads as non-pressable | decoration⚠ | shipped | c5d4cb8 chrome band; not-pressable read verified in dev screenshots |
| UXR-235-18 | Inter-block gap 12–16px > inter-exercise divider for hierarchy | tuning⚠ | shipped | c5d4cb8 gap hierarchy per mockup |
| UXR-235-19 | `.macro-flash` 220–320ms; `.save-confirm-fade` 110–160ms; banner fade 140–200ms | tuning⚠ | dropped | macro-flash/save-confirm timings unwired with -11; banner fade default |
| UXR-235-20 | Advanced-tab muted contrast in dark at 12px — verify AA / bump to --foreground | a11y⚠ | shipped | 343184b .dwe-raw-cue dark-mode bump (QA finding) |
| UXR-235-21 | Danger banner tint + text AA at text-sm, both themes | a11y⚠ | shipped | c5d4cb8 danger tokens; AA measure = device pass pending |
| UXR-235-22 | Source-monitoring: base value rendered as italic-muted placeholder = the inherit/un-edited state | component | shipped | c5d4cb8 italic-muted base placeholders, screenshot-verified |
| UXR-235-23 | Empty-diff short-circuit (`computeTemplateDiff`) → no server round-trip | component | shipped | c5d4cb8 isTemplateDirty short-circuit + no-redundant-row test |
| UXR-235-24 | `text-base` inputs to kill iOS zoom — verify sets/durationSec pair doesn't wrap at 390px | tuning⚠ | shipped | c5d4cb8 text-base + inputMode; wrap check = device pass pending |
| UXR-235-25 | Hidden `name="workoutJson"` input carries merged blob → server action untouched (AC#4) | component | reworked | c5d4cb8 hidden input kept BUT day-actions gained tri-state absent/blank/value semantics (guard-lockout fix) — "untouched" claim superseded |
| UXR-235-26 | Sticky Save/Clear footer (MealComposer idiom); Save disabled while pending ("Saving…") | layout | shipped | c5d4cb8 footer row, Save pending state |
