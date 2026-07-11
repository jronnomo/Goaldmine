# Completion report — #249 — 2026-07-11 · SPRINT 13 COMPLETE

## Shipped (commit 43b1996, merged on feature/phase1-auth; +44/-13 across 4 files)
1. **Tab lighting (founder-decided kinship+More mapping)**: /compare lights Progress (kinship, same precedent as /recap); /coach, /journal, /character, /goals, /history, /nutrition light More via a visual-only `MORE_ROUTES` match — `aria-pressed` still means "sheet open", NO aria-current on a button (DA aria ruling). /settings, /stats, /import, /workouts/[id] stay unlit (not More destinations; documented in-code with a MoreSheet cross-reference comment — DA ruled comment over shared constant since navRows isn't a clean superset).
2. **/compare back link**: `← Progress` above the hero, 44px tap box (the days idiom it copies is itself sub-44 — DA caught that "matching the idiom" wouldn't satisfy the AC).
3. **RecordsSummary**: unconditional `All baselines →` Card action link (the two existing links were data-gated: >3 tests / >5 exercises — low-data users previously saw NO path).
4. **Today hero `+ Import` pill REMOVED** — founder decision recorded; 5 other /import entry points survive (DA enumerated; PRD had cited only 2). Closes a pre-existing backlog note.
5. **CalendarMonth UNTOUCHED** — AC-3's premise was stale: the "⇄ Comparing · Cancel" pill already cancels (:258, handleCompareToggle :151-159), plus tap-A-again undo. Recorded, not rebuilt.

## Verification
- Gates: tsc 0 · lint 0 errors, no disables · **799/799** · build OK.
- Browser (dev agent full pass + orchestrator independent spot-check): all six More routes lit with aria-pressed="false"/no aria-current; /compare Progress-lit with aria-current="page" + back link measured **exactly 44px** (orchestrator re-measured after a transient mid-stream 0-reading — dev-mode streaming noise, resolved on settle); unconditional baselines link works; hero clean; calendar compare pill regression-checked (toggle → Cancel → revert).

## Premise-check scorecard for the story
AC-1 true but under-scoped (11 dead routes, not 4); AC-2 true; **AC-3 FALSE (already built)**; AC-4 mostly false (conditional links existed; the "reachable via More sheet" claim was itself wrong); AC-5 was a genuine open decision → user chose removal.

## SPRINT 13 TALLY — 10/10 stories
#253 (BottomSheet two-phase mount — hydration exemption retired) · #236 (StatTile/StatusPill dedup) · #237 (MEAL_LABELS) · #238 (plan-format dedup — caught one already-diverged copy) · #239 (route loading skeletons — first clean-premise AC) · #240 (shell a11y — live keyboard pass caught + fixed the Escape-refocus bug) · #241 (chart/emoji/alert a11y) · #242 (OAuth consent polish — FormData trap defused) · #243 (iOS device verification — founder-executed, PASS) · #244 (calendar 390px/contrast verification — PASS, measured) · #249 (this).
Tests across the sprint: 770 → **799**. Every code story premise-checked; DA caught shipped-bug-grade issues in most; two verification stories closed with measured evidence.

## NEXT: /launch-gate + deploy checkpoint recommended
Sprint 13 accumulated 11 stories on feature/phase1-auth since the last deploy (54b6e6c). Post-deploy smoke additions: one real claude.ai connector auth (new consent card + "Not you?" flow, #242), and the connector-cache reminder does NOT apply (no MCP tool changes this sprint).
