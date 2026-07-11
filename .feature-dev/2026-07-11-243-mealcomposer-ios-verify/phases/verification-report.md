# Verification report — #243 — 2026-07-11 · MealComposer sticky chrome on real-device iOS Safari

## Method
Founder-executed on-device test (real iPhone, Safari, prod `workout-planner-gold-three.vercel.app`), two screen recordings analyzed frame-by-frame (1fps extraction):
- `ScreenRecording_07-11-2026 07-07-34_1.MP4` (~31s) — Log sheet → Meal create flow, keyboard open, food search/add.
- `ScreenRecording_07-11-2026 07-13-29_1.MP4` (~18s) — /nutrition → Edit · Preworkout sheet (the sticky-footer variant), keyboard open, add-item typing.

## VERDICT: CONFIRMED PASS (AC outcome a)
- **Sticky header (MealComposer.tsx:544)**: with the keyboard open and an item added, the macro summary band ("90 cal · P 1.1 · C 23 · F 0.3") stays pinned at the top of the sheet while content scrolls beneath — `evidence-header-pinned-kbd-open.png`.
- **Sticky footer (MealComposer.tsx:1111)**: in the edit sheet with the keyboard open, the Save/Delete row stays pinned directly above the keyboard/accessory bar, visible and tappable, stable across continued typing — `evidence-footer-above-kbd.png`, `evidence-footer-stable-typing.png`.
- Inputs scroll into view correctly; meal-type chips, Enter/Add, and suggestions all remain reachable. The feared `max-height: 85vh` keyboard failure did NOT materialize functionally. **No CSS fix needed; none applied** (per the AC's no-speculative-fix rule).

## Cosmetic observations (non-blockers, recorded so they aren't re-litigated blind)
1. **Unscrimmed backdrop strip in the keyboard gap**: when iOS shifts the dialog for the keyboard, a strip of the underlying page shows through un-scrimmed between the sheet's bottom edge and the keyboard (Today-page text visible in create-flow frames ~6/10; a notes line in the edit-flow). Native `::backdrop` sits in the layout viewport while iOS moves the visual viewport. Vanishes on keyboard close. Not sticky-chrome-related; cosmetic only.
2. **Suggestion list partially occluded by the pinned footer** in the compressed keyboard viewport (edit flow, "Egg" search — the second suggestion row sits half-behind Save). List remains scrollable; inherent to sticky-footer + dropdown in a small viewport. Minor.

Neither observation warrants a follow-up story now; if either grates in daily use, file then with this report as the baseline.

## Process note
Verification-only story — no code change, no dev agent, no DA (nothing to critique). Orchestrator prepared the on-device protocol (identifying the 85vh suspect and both sticky elements by line), founder executed, orchestrator analyzed frames and recorded the outcome.

## Still pending elsewhere
The six UXR-235 "device pass pending" ledger rows (day-override editor AA/clip/timing checks) were suggested as a bundle but the recordings covered the composer only — they remain open on the #235 ledger.
