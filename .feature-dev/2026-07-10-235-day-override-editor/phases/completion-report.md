# Completion report — #235 — 2026-07-10 · SPRINT 12 COMPLETE

## Shipped (commits c5d4cb8 + 343184b on feature/phase1-auth; +1,875/-130 across both)
1. **Structured editor**: per-block cards with read-only chrome + label-once numeric grids (UX research's chosen "Ledger Row" anatomy); title input; sets/reps/weightHint/durationSec/notes editable per exercise; equipment read-only; dim+pill Skip (omission-based — zero type/renderer changes); italic-placeholder "inherit the plan" semantics; NO block CRUD in Structured (AC cap held).
2. **Advanced JSON tab**: weighted segmented control (de-emphasized, ⚠ raw cue w/ dark-AA bump); TargetsBuilder idiom with parse-on-switch-back; 3-tier reconciliation (name→positional→foreign); foreign rows read-only; a real bug found+fixed during dev verification (tab-CLICK bypassed the validation gate).
3. **Tri-state workoutJson** (the DA's REVISE earning its keep): absent=untouched (guard+validators skipped — nutrition-only saves can never trip the baseline lockout or wipe a workout), blank=explicit null, value=full #234 pipeline; finalWorkoutPresent delete-collapse protection; iter2 hardened the Advanced-parked path (mode-aware dirty gate — QA's FIX-FIRST catch) with the fix agent catching its own seed-vs-base comparison bug mid-fix.
4. **Coach-voiced save errors**: day-save-error-copy.ts rewrites the covenant throw for the banner (aria-live, above Save, persists across tabs).
5. New pure core `day-template-edit.ts` (diff/merge/skip/reconciliation) — 34 tests; day-actions +8 tri-state tests; +6 error-copy tests.

## Verification
tsc 0 · **770/770** (722 → +48) · lint 0 errors · build OK. Live-browser scenario matrix (both agents): AC manual smoke (weightHint → /days + /calendar; Advanced round-trip byte-exact), skip round-trip, tri-state DB proof, invalid-JSON stays-in-Advanced, **baseline-day lockout regression both ways** (workout edit blocked w/ covenant banner; nutrition-only succeeds — including parked-in-Advanced after iter2), empty-diff no-row, 390px visual pass.

## Process (full pipeline, 2 iterations)
Premise check (2 design rulings: omission-skip saved 7+ consumer surfaces; diff-merge-full-blob) → **/ux-research invoked** (first of the queue; 26-row ledger; 1 signed-off refinement: dim+pill) → Architect v1 → DA **REVISE** (baseline-guard lockout + submit trap + tuple drift — all real) → Architect v2 (tri-state semantics) → Dev (760/760, 1 self-found bug) → QA **FIX-FIRST** (Advanced-parked lockout residue + 3 more) → Fix iter2 (770/770) → all gates. **UXR ledger fully ticked**: 20 shipped / 4 reworked / 2 dropped (animation polish, documented); 6 rows carry "device pass pending" AA/clip notes for a future physical-device check.

## SPRINT 12 TALLY (High-risk structural) — 4/4
- #232: first session-authed JSON route + LogLauncher self-fetch (headline stale-sheet bug fixed live)
- #233: layout meal-fetch deletion (net −73; hydration baseline protocol; #253 filed with root-cause)
- #234: override write-path hardening + shared guard + USER_TZ date fix (53/53 data-safety diagnostic)
- #235: this story
Queue totals since Sprint 10: tests 613 → 770; every story premise-checked; DA/QA caught shipped-bug-grade issues in nearly every story.

## Follow-ups
- #253 (BottomSheet hydration) — NOW HIGHER PRIORITY: the new editor is a richer stateful surface on /days and the dev observed the mismatch intermittently eating interactions there.
- Device pass for the 6 AA/clip ledger notes.
- Recommend /launch-gate + deploy checkpoint before Sprint 13 (4 structural stories accumulated on the branch).
