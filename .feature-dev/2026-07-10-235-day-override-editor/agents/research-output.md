# Research / premise-check — #235 (Explore agent, 2026-07-10, HEAD 6c06e7e)

## 1. DayOverrideForm.tsx (post-#234)
Plain form, 111 lines. Props :7-15: dateKey, defaults { workoutJson, nutritionText, mobilityText, notes } (ALL STRINGS), hasOverride. Raw workoutJson textarea in <details> :33-42 (rows=12, mono, "Leave blank to use the rotation default"); nutrition/mobility textareas + notes input :44-74. Submit: form action → startTransition → upsertDayOverrideFromForm :20-30; error banner :76-80; Clear = ConfirmButton when hasOverride :90-107 → clearDayOverride; button label toggles :88.
Page contract (days/[dateKey]/page.tsx:403-416): defaults.workoutJson = override?.workoutJson stringified ?? stringified shownTemplate ?? ""; hasOverride = isOverride || any text field; card gated isToday||isFuture :396.

## 2. WorkoutEditor computeDiff (:95-199) — the named idiom
Edits Workout DB rows (ids), NOT templates. Diff shape { header?: {title?,notes?}, setPatches: ({id} & partial)[], ops: WorkoutOp[] } :100-104. Field-level: `if (reps !== initSet.reps) patch.reps = reps`, push only if keys>0 :130-139. add/remove ops :143-192. Consumer saveWorkoutEdits(workout.id, diff) from workout-edit-actions :261. **Empty-diff short-circuit: closes edit mode with NO round-trip** :254-257.

## 3. TargetsBuilder builder|advanced idiom (:126-176)
mode useState "builder"|"advanced" :126; advancedJson + advancedError :127-128. openAdvanced :160-164 serializes current rows → textarea. switchToBuilder :166-176: JSON.parse + root-shape check + parseRows; on error STAY in advanced, show "Fix before switching back: {err}" :212-216. Hidden <input name="targets"> :193-199 keeps server action untouched. Reusable radiogroup segmented control w/ arrow-key nav :364-422.

## 4. Base template resolution
resolveDay override-vs-rotation at calendar.ts:967-973 (override.workoutJson as DayTemplate else weeklySplit find). Deferral: deriveTodayTask :750-768 → activeWorkout/deferredWorkout; page shownTemplate = r.activeWorkout ?? r.deferredWorkout :71; never re-derive (doc calendar.ts:594-622). templateForRotationDay :1204 = MCP ops base helper.

## 5. DayTemplate shapes + skip scope (HIDDEN SCOPE ANSWER)
ExercisePrescription (program-template.ts:4-12): name req; equipment?, sets?: number, reps?: string|number, durationSec?: number, weightHint?: string, notes?. NO restSec/tempo on exercise. Block :14-20: type enum(5), label?, exercises[], rounds?, restSec?. DayTemplate :22-37: dayOfWeek 1-7, title, category enum(7 incl "rest"), summary, blocks[].
**NO skip flag anywhere.** A new flag would need: days BlockView/compactPrescription :433-474 + prefill :190 + footageExercises :180-182; Today page; goals/[id]/plan; mcp/today-shapers; find_exercise_in_plan (tools.ts:1847-1851); prescription-prefill.ts:80-104 (logger seeding!); SnapshotView. → omission-based skip avoids ALL of it.

## 6. Write-path options
upsertDayOverrideFromForm (#234-hardened, day-actions.ts:11-79): full-blob upsert post-validation+guard (guard baselineInputProvided hardcoded false — commented as #235 gap :34-41). Ops vocabulary day-template-ops.ts:64-70: ONLY addExercise/updateExercise/removeExercise (block matched by index/label); updateExercise = whole-exercise field merge {...existing,...patch} :203; applyWorkoutJsonOps deep-clones, sequential, **prunes empty blocks** :223-225. Core treats workoutJson vs ops as mutually exclusive :252-256; ops collapse to a full-blob write through the same pipeline :298-335. → client merge → full blob via existing action is the simple compliant path; no set-level ops exist.

## 7. Tab precedents
No shared Tabs/tablist component; hand-rolled per component. TargetsBuilder's segmented control is the primitive to clone. MealComposer mode-typed props :85-94. WorkoutEditor isEditing toggle :204,406-463.

## 8. Tests
No WorkoutEditor/TargetsBuilder component tests. day-actions.test.ts (343 lines, from #234): vi.hoisted db mocks dual-export :30-47, mockGetActiveProgram :49-50, REAL calendar + validators (header :10-23), PROGRAM fixture :62-90, fd() helper :103-107, BASELINE/NO_BASELINE day keys :93-95, VALID_WORKOUT :97-101, guard matrix :221-273 — all reusable.

## Corrections
- Form receives pre-serialized STRINGS (page does resolution+stringify), not objects.
- Empty-block pruning parity: ops path prunes; the merge layer must decide (DA).
