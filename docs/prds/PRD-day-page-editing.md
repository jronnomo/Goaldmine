# PRD: Day-page editing — manual logger, skip/rest, inline hike, workout editing

**Author**: Claude (Tech Lead) + Gabe · **Date**: 2026-06-12 · **Status**: Approved
**GitHub Issue**: https://github.com/jronnomo/workout-planner/issues/65 · **Branch**: main
**UX-research**: invoked (background) — logger form anatomy, number ergonomics, skip affordance, edit-in-place vs edit-mode, hike placement. REQ-65-2/3 visuals wait for findings.
**Design authority**: `.feature-dev/2026-06-12-day-page-editing/agents/architecture-blueprint.md` (frozen core signatures, prefill spec, status-filter audit table, decisions D1–D6). Approved plan mirrored at `phases/approved-plan.md`.

## 1. Problem & solution
Past days with no workout are dead ends; the app cannot log, skip-acknowledge, hike-log, or edit — every write is coach/MCP-only and inline in handlers. Solution: extract **shared cores** (`workout-core.ts`, `hike-core.ts`, goal-core pattern — single code path, MCP surface byte-identical, no connector reload), then build app-side write affordances on them. Records/PRs and XP are derived live from rows, so app logging inherits them with zero side-effect plumbing.

## 2. Requirements
- **REQ-65-1 — Cores + MCP thinning (M)**: `createWorkoutCore` / `updateWorkoutCore` / `updateWorkoutSetCore` / `workoutOpsCore` (+`WorkoutOpSchema` relocation) / `deleteWorkoutCore` in NEW `src/lib/workout-core.ts`; `logHikeCore` (verbatim lift: focus attribution, finalize-in-place, per-(date,goal)+legacy-null dedupe) in NEW `src/lib/hike-core.ts`; thin log_workout/update_workout/update_workout_set/workout_ops/delete_workout/log_hike handlers; migrate `importStrongWorkout` to the core; recordsSet computed only when completed && exercises>0. **MCP responses byte-identical — capture before/after curl diffs.** `update_workout_exercise` stays inline.
- **REQ-65-2 — Day-page logging (L)**: NEW `day-log-actions.ts` (logManualWorkout → returns {id, recordsSet}; skipDay idempotent + reason + template title; unskipDay; logHikeForDay w/ replacesPlannedHikeId), NEW pure `prescription-prefill.ts` (reps number=value, "8-12"/"max"=placeholder, weightHint=placeholder, sets ?? rounds ?? 1, block labels = headers, placeholders never persist), NEW client islands `WorkoutLoggerForm` (collapsed CTA → prefilled dynamic arrays; inputMode numeric/decimal; PR strip from recordsSet; ≤4-tap as-prescribed) / `SkipDayControl` / `HikeLogForm` (planned-hike finalize prefill); day page: partition by status, replace dead-end card (past), section after planned card (today), skip collapses beside completed workout, future none; resolveDay workout select +`notes` (additive); future-date guard; startedAt = past noon USER_TZ / today now, editable time field. Visuals [UXR].
- **REQ-65-3 — Workout editor (M)**: NEW `workout-edit-actions.ts` (saveWorkoutEdits {header, setPatches, ops} — phases not cross-atomic, documented; deleteWorkoutAction → /history), NEW `WorkoutEditor` (read-mode default, edit toggle, client diff → one save, ConfirmButton delete; skipped rows slim variant) replacing /workouts/[id] static cards; ShareWorkout kept. Visuals [UXR].
- **REQ-65-4 — Calendar + status audit (S)**: calendar.ts `workoutCount` → completed-only + new `skippedCount` on CalendarDayCell; CalendarMonth muted ✕ (outside legend system — see D-decision in blueprint; aria "skipped (acknowledged)"; DayDetail line); Today recent-workouts + /stats count → completed-only; /history shows skips w/ muted "Skipped" pill (excludes planned); legend.ts comment; verify-only list (engine filters, records prior-scan, baseline-workout mirror, session brief, recent_history honest raw).

## 3. Out of scope
Coach forgiveness automation (conversational by principle); exercise rename UI; future-day logging; new MCP tools or schema changes; game-engine changes (skips stay invisible to the ledger by locked decision).

## 4. Acceptance criteria
1. Gates clean (tsc/lint/build) + test-rarity regression.
2. MCP curl before/after diffs byte-identical for all six refactored tools (incl. workout_ops mid-batch rollback, log_hike plan→dedupe→finalize→error).
3. Records/XP parity: identical workout via app vs MCP ⇒ identical recordsSet + identical game-state delta (then cleaned up).
4. Past empty day: as-prescribed log in ≤4 taps; placeholders never persist as values; PR strip renders.
5. Skip: one tap (+optional reason) → calendar muted ✕ (no trained/glow), streak unchanged (still a miss), /history badge, Today/stats exclude it, recent_history shows status "skipped"; un-skip removes.
6. Hike: planned hike on the date ⇒ "Finalize" path consumes the planned row (no duplicate); fresh log matches MCP-logged hikes exactly.
7. Edit: set change updates /progress records; add/remove exercise+sets works; two-tap delete → /history.
8. No connector reload required (assert tools/list + response shapes unchanged).

## 5. References
Issue #65 (interview-scoped); blueprint (authoritative design); goal-core.ts dual-caller pattern; ConfirmButton; EditNutritionForm idiom; project-gotchas.md.
