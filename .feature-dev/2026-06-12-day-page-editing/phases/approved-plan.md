# Day-page editing: manual logger, skip/rest, inline hike, workout editing (issue #65)

## Context
A past day with no workout is a dead end ("Import one or log via Claude") — the app cannot log a workout, acknowledge a skip, log a hike, or edit a logged workout; all writes are MCP-only and inline in handlers. This run gives the app its own write paths through SHARED CORES (single code path with MCP, goal-core.ts pattern), with records/XP free (both derived live from rows).

Runs under /feature-dev: PRD → /ux-research (opted in — form anatomy/ergonomics) → DA → parallel Sonnet devs → QA → main.

## Decisions (locked)
1. **Skip = Workout{status:"skipped", exercises:[]} row** (user-locked): one-tap + optional reason; streak ledger UNCHANGED (skips invisible to engine's completed-filter = honest miss; coach forgives conversationally); idempotent per day; un-skip = delete.
2. **/ux-research runs** (user-locked): logger form anatomy, number-input ergonomics, skip affordance, edit-in-place vs edit-mode, hike-form placement. Structure fixed, visuals [UXR].
3. **Manual-log startedAt**: past days = dateKey noon USER_TZ (parseDateKey + 12h ms — DST-safe inside the dateKey; midnight reads like corruption; now() lies about time-of-day); today = current time; editable <input type=time>. Skip rows always noon.
4. **Calendar skipped rendering = muted ✕ cell treatment OUTSIDE the legend system** (NOT a new LegendKind — would ripple LegendKindSchema/DEFAULT_LEGEND/8+ flavor presets AND markersFor suppresses kinds absent from stored legends, silently hiding the marker for every existing goal). Joins the existing extra-legend treatments (quiet-past, glow, provisional). aria-label gains "skipped (acknowledged)". legend.ts gets an explanatory comment.
5. **Cores extracted; MCP surface byte-identical** (no connector reload): createWorkoutCore/updateWorkoutCore/updateWorkoutSetCore/workoutOpsCore(+WorkoutOpSchema moves)/deleteWorkoutCore in NEW src/lib/workout-core.ts; logHikeCore (verbatim lift incl. focus-attribution, finalize-in-place, per-(date,goal)+legacy-null planned dedupe) in NEW src/lib/hike-core.ts. update_workout_exercise stays inline (no UI consumer). importStrongWorkout (workout-actions.ts:253) migrates to createWorkoutCore — retires the third inline create.
6. recordsSetInWorkout computed ONLY for status completed && exercises.length>0.

## Build (full detail in run blueprint = the design output)
- **Cores** (§1): exact signatures per design; Date (not string) inputs — parsing stays at callers; tools.ts handlers thinned per table.
- **Actions**: NEW day-log-actions.ts (logManualWorkout — returns {id, recordsSet} to client; skipDay idempotent w/ template title; unskipDay; logHikeForDay w/ replacesPlannedHikeId) + NEW workout-edit-actions.ts (saveWorkoutEdits {header, setPatches, ops} — phases not cross-atomic, documented; deleteWorkoutAction → redirect /history). ALL revalidate sets per design (incl. /progress for records, /stats, /character; NEVER copy day-actions.ts's local server-TZ parseDateKey — import @/lib/calendar).
- **Client islands**: WorkoutLoggerForm (collapsed CTA → prefilled dynamic exercise/set arrays; inputMode numeric/decimal; PR celebration strip from returned recordsSet; ≤4-tap as-prescribed), SkipDayControl (one-tap + optional reason; existing-skip muted card + ConfirmButton un-skip), HikeLogForm (planned-hike-aware: "Finalize {route}" prefill + replacesPlannedHikeId — never duplicates), WorkoutEditor (read-mode default; edit toggles; client diffs → one save call; ConfirmButton delete). NEW pure src/lib/prescription-prefill.ts: blocks→form rows (reps number = value; "8-12"/"max" = placeholder only; weightHint = placeholder; sets ?? rounds ?? 1; block labels = section headers; placeholders NEVER persist).
- **Day page**: partition workouts by status (resolveDay workout select gains `notes` — additive); dead-end card (139-149) → logging section (logger + hike + skip) for past; today = section after planned card; skip card collapses to one line when a completed workout coexists; future = none; guard dateKey ≤ today in actions.
- **/workouts/[id]**: WorkoutEditor replaces static cards; skipped rows slim variant; ShareWorkout kept.
- **Status-filter audit fixes**: calendar.ts workoutCount → completed-only + skippedCount on CalendarDayCell; Today recent workouts + /stats count → completed; /history shows skips w/ muted "Skipped" pill (status not planned); verify engine (already filtered), records prior-scan (skips have 0 exercises), baseline-workout.ts mirror findFirst, get_session_brief (filtered), recent_history/weekly_summary (raw + status = honest, unchanged).

## REQs / waves
REQ-1 cores+MCP-thinning+import migration (tools.ts owner) ∥ REQ-4 calendar+status-audit (calendar.ts buildCell region, CalendarMonth, page/history/stats) — both wave 1 (disjoint; calendar.ts touched by REQ-2 only at resolveDay select — sequence REQ-4 first). Then REQ-2 day-page logging ∥ REQ-3 workout editor (disjoint files; both need REQ-1 cores + ux-research visuals).

## Risks
MCP drift during extraction (pre/post curl response diffs — verification #2); saveWorkoutEdits cross-phase non-atomicity (documented; ops phase transactional); skip+real-workout same day (calendar prefers completed; skip collapses); DST (noon rule); future-day guard; iOS time-input quirks (walkthrough; pattern fallback [UXR]).

## Verification
1. Gates (tsc/lint/build) + scripts/test-rarity.ts regression.
2. MCP curl regression w/ BEFORE/AFTER captures: log_workout (recordsSet), update_workout (null-clear, bad date), update_workout_set, workout_ops (add/remove + mid-batch rollback), delete_workout, log_hike (plan→dedupe→finalize→non-planned error). Shapes byte-identical.
3. Records/XP parity: identical workout via app form vs MCP on adjacent past dates ⇒ identical recordsSet + identical get_game_state deltas; cleanup.
4. Browser @390px: past-day as-prescribed ≤4 taps; placeholders don't persist; PR strip; skip → ✕ no glow/trained, streak still misses, un-skip; finalize planned hike consumes boot icon; edit set → /progress PR updates; two-tap delete → /history.
5. Status audit spot-checks (Today excludes skip; /stats unchanged; /history badge; recent_history shows status skipped; baseline-mirror unaffected).
