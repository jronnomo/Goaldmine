# Architecture Blueprint — Guided Goal-Intake Interview (#64)

Planning-phase design (exploration-verified). PRD = requirements authority; this = design authority.

## Decisions
**D1 someday-no-plan**: createGoalCore (goal-core.ts:40-127) wraps weeks/endsOn/planTemplate + nested plans.create in `if (targetDate !== null)`; result planId: string|null. Ripples verified: /goals/[id] hasPlan=false hides plan cards; setFocusGoal latest=null → no plan (getActiveProgram falls back — DOCUMENT in descriptions); getActiveGoalsWithPlans plans=[] handled by goal-events; rarity already unrated for someday. create_goal message gains "(someday — no plan scaffolded; add a target date later to scaffold one)".
**D2 dated-upgrade**: NEW `ensurePlanForGoalCore(goalId, targetDate): Promise<{planId: string; created: boolean}>` — zero plans ⇒ scaffold scaffoldPlanFromTemplate(weeksBetween(now,targetDate)) + initial PlanRevision (identical nested shape as create — extract a shared private helper); any plan exists (even paused) ⇒ no-op created:false (resume is set_plan_active's job). Called from MCP update_goal handler AND UI updateGoal action when a non-null date is set. (Rejected: standalone create_plan tool — tool-count + leaves UI path broken; scaffoldPlan flag — coach can forget an internal invariant.)
**D3 attribution**: `Goal.attributionHints Json?` string[] canonical names (don't overload targets — weighted/scored, pollutes readiness+rarity which iterate blindly; don't overload legend — closed-kind enum). MCP: fold into update_goal (nullable-optional idiom like targetDate/notes at tools.ts:4329-4346) — no separate tool. Canonicalize via canonicalExerciseName (records.ts:145-147) on write.
**D4 provenance**: no new column. note.resolvedAt + resolvedReason "promoted to goal <id>" (journal renders resolvedReason already).
**D5 list_promotable_notes**: `includeAspirations: z.boolean().default(false)` widens type set with ["audible","journal"]; default (feedback ± standing_rule) UNCHANGED; description rewritten to teach both promotion paths.
**D6 flavor input**: promote_note_to_goal accepts `flavor` key validated by isFlavorKey → legendForFlavor (same as UI path goal-actions.ts:59-60); not raw legend JSON.

## Migration `phase3_intake`
schema.prisma Goal after coachFeasibility: `attributionHints Json?` + comment "Canonical exercise names that 'count as training' this goal. Drives the last-trained indicator for someday/aspirational goals. Shape: string[]." One ALTER, no index, no backfill.

## Files
- **goal-core.ts**: D1 diff; CreateGoalCoreInput += coachFeasibility?: {tier: RarityTier; rationale: string}|null (serialize {tier, rationale, assessedAt: ISO now, assessedBy:"coach"} — exact set_goal_feasibility shape, tools.ts:4596-4601) + attributionHints?: string[]|null (canonicalized); ensurePlanForGoalCore + shared scaffold helper.
- **goal-actions.ts**: updateGoal — after prisma.goal.update, if targetDate !== null → ensurePlanForGoalCore(id, targetDate). Existing revalidates suffice.
- **records.ts**: export `aliasVariantsFor(canonical): string[]` = [canonical, ...EXERCISE_ALIAS_GROUPS[canonical] ?? []] (alias index currently module-private at :121-139).
- **NEW src/lib/goal-attribution.ts** (plain server lib, dual-caller): parseAttributionHints(raw): string[]; lastTrainedForGoals(goals: {id; attributionHints: unknown}[]): Promise<Map<string, Date|null>> — collect hints, expand aliasVariantsFor, ONE prisma.workoutExercise.findMany({where:{name:{in: allVariants, mode:"insensitive"}}, select:{name, workout:{select:{startedAt}}}, orderBy:{workout:{startedAt:"desc"}}}), canonicalize in memory, per-goal max startedAt; relativeTrainedLabel(d): "trained today"/"trained 3d ago"/"never trained".
- **tools.ts**: per PRD REQ-64-2. create_goal (~:3855) add:
  targets: z.array(GoalTargetSchema).min(1).optional() ("Readiness targets captured during the intake interview…");
  coachFeasibility: z.object({tier: z.enum(RARITY_TIERS), rationale: z.string().min(1)}).optional() ("Seed the coach feasibility override from the intake interview…");
  attributionHints: z.array(z.string().min(1)).optional() ("Canonical exercise names that count as training this goal… check get_records_summary").
  update_goal (~:4311): attributionHints nullable-optional (Prisma.JsonNull to clear, canonicalize array); post-update D2 hook → response {planScaffolded, planId} + message "Plan scaffolded N weeks → <date>"; description: "Setting a targetDate on a goal that has no plan auto-scaffolds a plan from now to that date."
  promote_note_to_goal: register near promote_note (~:3465). Input {noteId, objective z.string().min(3).max(200) ("Coach-distilled objective — NOT the raw note body"), kind enum default fitness, flavor optional, targetDate DateKeyShape.optional() ("Usually omitted → someday goal (no plan scaffolded)"), targets optional, attributionHints optional, notes optional ("defaults to a provenance line quoting the source note")}. Handler: findUniqueOrThrow note FIRST; validate flavor; createGoalCore({..., notes: input.notes ?? `Promoted from ${note.type} note (${toDateKey(note.date)}): "${note.body.slice(0,140)}"`}); note.update resolvedAt+resolvedReason (skip stamp if already resolved → priorResolved flag); return {goalId, planId, noteId, priorResolved?, message}. Description: propose-before-apply; "for a full intake prefer the interview flow ending in create_goal"; list_goals-before-retry idiom.
  list_goals (~:812) + get_goal (~:850): select attributionHints; lastTrainedForGoals batch (list) / single; add attributionHints + lastTrained to outputs + description mention.
- **coach/page.tsx**: PROMPTS entry (position after "Daily check-in" [UXR]):
```
{
  title: "Goal intake interview",
  when: "Considering a new goal — dated or someday",
  prompt:
    "I want to add a new goal. Run a goal-intake interview with me — one stage at a time, don't skip ahead:\n\n" +
    "1. Objective — ask what I want to achieve, then distill it into one crisp objective line and confirm it with me.\n" +
    "2. Date — ask whether this has a hard date, a flexible window (pick a date together), or is a someday goal. Someday = no target date: no plan gets scaffolded, no calendar pin, unrated for rarity. That's a fine answer.\n" +
    "3. Benchmarks — ask where I am right now on the 2–4 measures that best predict this goal. Log each answer via log_baseline as we go, so my targets start from real numbers.\n" +
    "4. Constraints — ask about equipment, weekly schedule, and how this sits alongside my current goals (call list_goals for the live slate).\n" +
    "5. Targets — propose a weighted targets array (weights summing to ~1), each tied to a benchmark from step 3, with a one-line rationale per target. Wait for my edits.\n" +
    "6. Feasibility — call preview_goal_feasibility with the proposed targets (and date, if any) BEFORE creating anything. Tell me plainly: this goal's own tier, and what it does to my active stack. If the stack lands epic or legendary, talk me through recalibrating the date, trimming targets, or pausing something first.\n" +
    "7. Create — only on my explicit go-ahead, call create_goal with the objective, date (omit if someday), targets, a coachFeasibility seed ({tier, rationale} summarizing your read from this interview), and attributionHints — the exercise names (exactly as I log them) that count as training this goal, so the app can show when I last trained it. Propose a legend to match the flavor.\n\n" +
    "If this came from an old note, use promote_note_to_goal instead of create_goal at step 7 so the note gets resolved too.",
}
```
- **PendingNotes.tsx** (action row :62-77): + `<Link href={`/goals?objective=${encodeURIComponent(n.body.slice(0,200))}#new-goal`}>Promote to goal →</Link>`; 3-action layout at 390px [UXR].
- **goals/page.tsx**: searchParams Promise<{objective?}> → defaultObjective prop; id="new-goal" on the create Card; select attributionHints in existing findMany; lastTrainedForGoals once in existing Promise.all; row subline "· trained 3d ago" for hinted goals [UXR].
- **GoalCreateForm.tsx**: defaultObjective prop → defaultValue; interview banner at top → /coach [UXR treatment].
- **goals/[id]/page.tsx**: stackWarning nudge sentence both branches [UXR copy]; trained line for hinted goals (lastTrainedForGoals([goal])).
- **docs/claude-ai-setup.md**: interview + promote flow note.

## Risks
lastTrained IN-scan unbounded (single-user OK; escape: take cap / raw GROUP BY later; verify mode:"insensitive"+in on Prisma 7); hint drift vs alias map (descriptions: "exactly as logged; check get_records_summary"; extend EXERCISE_ALIAS_GROUPS only on real drift); plan-less focus fallback documented; promote non-atomic goal→stamp benign; planId null contract explicit.

## Verification — see PRD §5 + the handstand E2E story (note → list_promotable_notes includeAspirations → promote w/ hints ["Wall Handstand Push-Up","Handstand Hold"] → someday row unrated "never trained" → log_workout containing the exercise → "trained today" + get_goal lastTrained → update_goal date → planScaffolded → joins stack).
