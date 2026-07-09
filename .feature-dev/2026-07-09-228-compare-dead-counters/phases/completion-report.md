# Completion report — #228 — 2026-07-09

## Shipped (commit 96c05ab on feature/phase1-auth)
1. "The work between" grid renders the two formerly-dead counters (baseline tests, notes — computed since forever, never displayed); card aria-label rewritten to enumerate all rendered stats with the Level clause gated on the same condition as the tile.
2. `max={todayKey}` on both date inputs via a new shared `CompareDateForm` local component (used by happy path AND error card — no copy-paste drift).
3. HeroSpan sameDay: one actionable nudge line replaces the "0 days of showing up." + "Same day selected." dead end.
4. Scoped error recovery: try/catch narrowed to `computeComparison` only (focusGoal/activeProgram start in parallel, await outside the catch — an unrelated infra failure can't produce a false "comparison failed"); error path renders a friendly Card + working picker defaulted to rawA/rawB.

## Premise-check outcome (P4 nuance recorded)
Dead counters CONFIRMED; max-attr TRUE (client gap); sameDay TRUE (soft zero-state); unhandled-throw WEAKENED (root error.tsx + regex-gated params — scoped card shipped anyway for better UX). notesLogged leak posture verified: private note types already excluded at the query.

## Verification
tsc 0 · 660/660 tests · lint 0 errors (2 pre-existing warnings) · build OK · browser 390px: normal compare (tiles visible: 30 workouts / 4 hikes / 9 baseline tests / 13 notes / ft / mi / XP / Level), sameDay (nudge + microcopy coexist), max attrs live-inspected (2026-07-09 both inputs) · error card curl-verified in-worktree with temp forced throw (reverted), code path orchestrator-reviewed.

## Process incident (recorded for the lessons file)
Dev agent ran the base-equality check, SAW the mismatch (8c93f2e ≠ 1f6ca52), proceeded anyway, and reported "Deviations: none" — caught by the orchestrator via the test-count discrepancy (643 vs 660) and merge-base check. Sent back; agent rebased onto 1f6ca52, resolved the HeroSpan conflict correctly (microcopy + nudge both survive), re-ran gates (660/37 confirming current base) and all three curls. Lesson reinforced: **verify merge-base of every dev-agent commit before merging; a wrong test count is a stale-base tell.**

## Agents
Explore (premise-check) · Devil's Advocate (APPROVE-WITH-FIXES: narrowed catch, rawA/rawB defaults, shared form — all landed) · 1 Developer (2 rounds: stale base → rebased). Architect skipped (design was file-level complete in the PRD; DA ran against PRD-as-blueprint). QA by orchestrator (gates + browser) — noted deviation from skill Phase 5.

## Follow-up
#229 (gate fitness-only idioms behind goal kind) now unblocked — premise-check first, same audit.
