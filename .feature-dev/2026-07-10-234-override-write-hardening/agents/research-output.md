# Research / premise-check — #234 (Explore agent, 2026-07-10, HEAD 887245d)

## 1. upsertDayOverrideFromForm (day-actions.ts:10-56)
- FormData fields workoutJson/nutritionText/mobilityText/notes, trim||null (:11-14). dateKey arg parsed by LOCAL naive parseDateKey (:87-90 — y-m-d split → local Date; USER_TZ foot-gun vs calendar-core's Intl version).
- Bare JSON.parse in try/catch rethrowing syntax message only (:22-28) — ZERO structural/size validation. `42`, `[]`, 500KB pass through.
- Writes: all-empty → deleteMany (:32); else upsert (:34-50) touching only 4 columns (never baselineTestNames/nutritionPlan). Raw `prisma` (:6,:32,:34,:62) annotated "non-scoped: plan override table" — CORRECT per gotchas §B.9:115 (PlanDayOverride non-scoped; getDb passes through; raw = clearer intent). Ownership via getActiveProgram()'s scoped program.id (program.ts:24-45).
- revalidatePath: /calendar, /days/${dateKey}, / (:53-55); clearDayOverride same (:63-65). Errors: action throws; DayOverrideForm catches.

## 2. day-template-validation.ts — exists, AC names exact
- MAX_DAY_TEMPLATE_BYTES = 64*1024 (:20). validateDayTemplate (return-style, all errors) :40-114 — object shape, title non-empty, dayOfWeek 1..7, category enum, blocks array, block.type enum, exercises array, exercise.name non-empty. assertValidDayTemplate (throw, joined messages + reference shape) :116-124. assertDayTemplateWithinSize (throw; stringify w/ circular catch; >64KB) :131-150.
- Callers: only mcp/tools.ts:51-52 → applyDayOverrideCore :301-302 (size then structural). leaky-reads.test.ts:124-125 mocks both as no-ops. day-actions does NOT call them.

## 3. applyDayOverrideCore (tools.ts:235-~410)
- Module-private async fn (db, program, input). Called by apply_day_override handler :3585-3591 and batch_apply_day_overrides :4646 (tx). MCP coupling (safe(), zod ApplyDayOverrideShape) ONLY at the edge — core is server-safe.
- Flow: parseDateKey (calendar) :240 → findUnique existing :244 → workoutJson/ops mutex :251 → string-recovery parse :260 → ops base resolution :276-295 → size+structural asserts :300-303 → BASELINE GUARD :305-321 → updateData build :323-369 → no-op early return :371-378 → upsert :380+.
- Guard: fires iff settingWorkout (workoutValue !== undefined && !== null :308) && !baselineInputProvided (input.baselineTestNames === undefined :309) && !Array.isArray(existing?.baselineTestNames) :310 && rotationBaselineNamesForDate(program, date).length > 0 :312 (helper calendar.ts:1216). Message :314-318: "Audible on {date} touches the workout but didn't make a baseline decision. Rotation default for this date: [...]. Re-pass baselineTestNames explicitly: same list to keep them, [] to suppress, or a different set to swap. Don't punt this to the UI — own the call." Batch-txn visibility note :4627.
- Routing form through core = viable but undesirable (no form baseline affordance; full PATCH surface). Shared-helper extraction preferred (asserts already extracted; guard is the remaining piece).

## 4. DayOverrideForm (src/components/DayOverrideForm.tsx, "use client")
- Rendered at days/[dateKey]/page.tsx:403. useState error + useTransition (:16-17); form action → try/await action/catch setError(e.message) (:21-30); Clear same (:96-104); error <p> :76-80. Raw-JSON textarea rows=12 in <details> (:33-42). Thrown messages surface automatically.

## 5. Tests — gaps
- day-actions.test.ts DOES NOT exist. day-template-validation has NO tests. override-integrity.test.ts covers only the mirror registry. **Baseline guard has ZERO behavioral tests** (only neutered mocks in leaky-reads.test.ts:78,:124-125). Guard conditions documented in prose only (mcp/instructions.ts:104; tools.ts:3575-3577). House convention: vi.mock @/lib/db dual-export, fully mocked db.

## 6. Gotcha cross-checks
- lintTemplate/lintActivePlan gate PLAN-TEMPLATE writes only (apply_plan_revision :3287, lint_plan :1969) — NOT overrides; lint out of scope here.
- §A.1: override = per-date truth; must remain a valid standalone DayTemplate — exactly what the asserts enforce.
- §A.5 + rule 9: the baseline decision the guard enforces; form has no affordance → guard blocking form audibles on baseline days is the intended audit behavior.
