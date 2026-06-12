# Architecture Blueprint — Day-page editing (#65)
Planning-design output (exploration-verified). PRD = requirements; this = design authority.

## Ground truth (verified)
- calendar.ts:107-111 grid workouts NO status filter; buildCell :313 workoutCount counts all → skipped rows would falsely light trained/glow. FIX in REQ-65-4.
- resolveDay :581 fetches all statuses; ResolvedDay.workouts carries status (:490) — day page partitions; select lacks `notes` (add, additive).
- Engine safe: status==="completed" filters at engine.ts:209,271,508,614,760. get_session_brief tools.ts:1299 filtered. goal-targets.ts:95 filtered. recent_history :765 + weekly_summary :1116 return raw rows incl. status (coach sees skips honestly — NO change, no reload).
- recordsSetInWorkout records.ts:522 early-returns on zero exercises (skip rows inert). Derived-on-read.
- day-actions.ts:86-89 has a LOCAL server-TZ-naive parseDateKey — NEVER copy; import @/lib/calendar (USER_TZ-aware, calendar.ts:1182).
- MCP input shapes: SetInputShape/ExerciseInputShape tools.ts:2070-2086; WorkoutOpSchema discriminated union tools.ts:168-215 (MOVES to workout-core).
- No /records page; records render on /progress (RecordsSummary) + /baselines/exercise/[name] (force-dynamic).
- importStrongWorkout workout-actions.ts:253-287 = third inline create → migrate to core.
- ResolvedDay exposes plannedHikeToday {id, route, distanceMi, elevationFt, packWeightLb, durationMin, date}|null → finalize prefill.

## Cores (FROZEN signatures)
src/lib/workout-core.ts (plain async, no directive, goal-core dual-caller header):
- SetInput{setIndex, reps?, weightLb?, durationSec?, distanceMi?, rpe?, notes?}; ExerciseInput{name, equipment?, orderIndex, notes?, sets: SetInput[]}
- createWorkoutCore({title?, startedAt: Date, status? default completed, source?, sourceUrl?, notes?, exercises: []ok}) → {id, recordsSet: RecordSet[]} — nested create per tools.ts:2199-2227; recordsSet ONLY when completed && exercises.length>0.
- updateWorkoutCore(id, {title?, notes?, source?, sourceUrl?, startedAt?: Date, status?}) → {id, updatedFields[]} — PATCH (undefined untouched, null clears); ISO validity guard stays in MCP handler.
- updateWorkoutSetCore(id, patch) → {id, updatedFields[]} (lift :3804-3824).
- WorkoutOpSchema + type WorkoutOp moved verbatim from tools.ts:168-215; workoutOpsCore(ops) → {count, applied[]} (lift :3845-3919 transaction incl. orderIndex/setIndex max+1 defaults + per-op rollback message).
- deleteWorkoutCore(id) → {id}.
src/lib/hike-core.ts:
- logHikeCore({date: Date, route, distanceMi, elevationFt, durationMin, packWeightLb?, rpe?, status? default completed, notes?, goalId? (null=focus), replacesPlannedHikeId?}) → {id, finalized, deduped, previousStatus?, dateMoved?, message} — VERBATIM lift tools.ts:2404-2549 (focus resolution + active guard, finalize-in-place w/ status!=="planned" error, per-(date,goal) planned dedupe incl. legacy-null match).
MCP thinning table: log_workout/update_workout/update_workout_set/workout_ops/delete_workout/log_hike → cores; names/schemas/descriptions/outputs BYTE-IDENTICAL. update_workout_exercise stays inline. importStrongWorkout → createWorkoutCore.

## Server actions
day-log-actions.ts ("use server"; @/lib/calendar imports only):
- logManualWorkout({dateKey, title?, timeHHMM, notes?, exercises: ExerciseInput[]}) → guard dateKey ≤ today; startedAt per D3; createWorkoutCore(completed, "manual"); RETURNS {id, recordsSet}; revalidate /, /history, /calendar, /days/[dateKey], /progress, /stats, /character.
- skipDay(dateKey, reason?, title?) → idempotent findFirst skipped-in-day → update notes : createWorkoutCore({title ?? "Skipped day", startedAt noon, status skipped, source manual, exercises: []}); revalidate /, /calendar, /days/, /history, /stats.
- unskipDay(workoutId, dateKey) → deleteWorkoutCore; same set.
- logHikeForDay({dateKey, ...fields, replacesPlannedHikeId?}) → logHikeCore({date: parseDateKey(dateKey), status completed}); revalidate /, /calendar, /days/, /stats, /progress.
workout-edit-actions.ts:
- saveWorkoutEdits(workoutId, {header?, setPatches: [{id, ...patch}], ops: WorkoutOp[]}) — sequential phases (not cross-atomic — comment; ops phase transactional); revalidate /workouts/[id], /, /history, /days/[dateKey(startedAt)], /calendar, /progress, /stats.
- deleteWorkoutAction(workoutId) → fetch startedAt → deleteWorkoutCore → revalidate set → redirect /history.

## Client islands (EditNutritionForm idiom; ConfirmButton for destructive; visuals [UXR])
- WorkoutLoggerForm{dateKey, defaultTitle, defaultTimeHHMM, prefill}: collapsed accent CTA → expanded title/time + dynamic exercise/set arrays (inputMode numeric/decimal; add/remove type=button); success → PR strip from recordsSet + link /workouts/[id].
- SkipDayControl{dateKey, templateTitle, existingSkip{id, notes}|null}: one-tap + optional pre-expandable reason; existing → muted "Skipped — {reason}" + ConfirmButton un-skip.
- HikeLogForm{dateKey, plannedHike|null}: plannedHike ⇒ "Finalize planned hike: {route}" prefilled + replacesPlannedHikeId; else fresh form.
- WorkoutEditor{workout DTO}: read-mode default; Edit toggle; client diff vs initial → one saveWorkoutEdits; add/remove sets+exercises; ConfirmButton delete; skipped slim variant.
- prescription-prefill.ts PURE: prefillFromTemplate(blocks) — table per PRD REQ-65-2.

## Day page integration
Partition r.workouts (completed/skipped; planned ignored). "Logged workouts" card uses completed. Dead-end card :139-149 → logging section (past); today → section after planned card :151-176; skip card collapses to one muted line when completed coexists; future none. Banners/header untouched.

## Calendar skipped (D4)
CalendarDayCell +skippedCount; workoutCount completed-only (grid query :107 already selects status). DayCell: inMonth && skippedCount>0 && !isCompleted ⇒ muted ✕ span (~11px) in marker row + aria "skipped (acknowledged)"; DayDetail muted line. legend.ts comment why not a LegendKind (closed enum ripple + markersFor suppression for stored legends).

## Status-filter audit
FIX: calendar workoutCount; app/page.tsx:43 Today recents (completed); history/page.tsx:10 (status not planned; skips muted + "Skipped" pill); stats/page.tsx:16 count completed. VERIFY-ONLY: engine, records prior-scan (0-exercise skips), baseline-workout.ts:78/135 mirror findFirst criteria, session brief, recent_history/weekly raw.

## D-decisions
D3 startedAt: past = parseDateKey+12h noon (DST-safe inside dateKey; midnight reads as corruption; now() lies); today = now; editable time input; skips always noon. D4 ✕ outside legend (above). D5 byte-identical MCP. D6 recordsSet gating.

## REQ waves
W1: REQ-65-1 (workout-core, hike-core, tools.ts, workout-actions.ts) ∥ REQ-65-4 (calendar.ts buildCell/getCalendarMonth region, CalendarMonth.tsx, app/page.tsx, history, stats, legend.ts comment) ∥ DA ∥ ux-research. W2: REQ-65-2 (day-log-actions, prescription-prefill, 3 islands, days/[dateKey]/page.tsx, calendar.ts resolveDay select ONLY) ∥ REQ-65-3 (workout-edit-actions, WorkoutEditor, workouts/[id]/page.tsx). calendar.ts: REQ-65-4 merges before REQ-65-2 branches.

## Verification — PRD §4 (incl. before/after MCP curl capture by REQ-65-1 inside its worktree: BEFORE refactor capture from its pristine HEAD, AFTER from its result; diff shapes).
