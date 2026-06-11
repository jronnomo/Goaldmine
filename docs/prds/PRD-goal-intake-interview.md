# PRD: Multi-goal Phase 3 — Guided Goal-Intake Interview

**Author**: Claude (Tech Lead) + Gabe · **Date**: 2026-06-11 · **Status**: Approved
**GitHub Issue**: https://github.com/jronnomo/workout-planner/issues/64 (Epic #61, final phase)
**Branch**: main · **UX-research**: invoked (background) — interview-banner prominence, 3-action note row, last-trained treatment, interview-card copy/position. REQ-64-3/4 visual treatment waits for findings.

## 1. Problem & solution
Goals enter as bare objective+date with no expectation-setting; aspirations ("handstand someday") die unrecorded in notes; woven skill work is invisible to the goal it serves. Phase 3: (a) a coach-led intake interview (prompt card on /coach) that logs real benchmarks during the conversation, proposes weighted targets, and previews stack rarity via `preview_goal_feasibility` BEFORE anything is created; (b) one-step note→goal promotion into someday goals (which no longer scaffold a plan); (c) `attributionHints` so logged exercises visibly "train" the goals they serve.

## 2. Requirements (authoritative detail in agents/architecture-blueprint.md)
- **REQ-64-1 Core+Data (L)**: migration `phase3_intake` (Goal.attributionHints Json?, single additive ALTER); createGoalCore — someday ⇒ NO plan scaffold, result planId string|null, new inputs coachFeasibility {tier,rationale} (stored in set_goal_feasibility's exact Json shape) + attributionHints (canonicalized); `ensurePlanForGoalCore(goalId, targetDate)` extracted from the create scaffold (no-op when any plan exists); updateGoal action calls it when a date is set; records.ts exports `aliasVariantsFor`; NEW src/lib/goal-attribution.ts (parseAttributionHints, lastTrainedForGoals — ONE batched workoutExercise query over alias variants, canonicalize in memory; relativeTrainedLabel).
- **REQ-64-2 MCP (M, sole tools.ts owner)**: create_goal +targets (GoalTargetSchema) +coachFeasibility +attributionHints, planId-null message branch, stackWarning unchanged; update_goal +attributionHints (nullable-optional) + auto-scaffold hook (+planScaffolded/planId in response + description line); NEW promote_note_to_goal {noteId, objective (coach-distilled, never raw body), kind, flavor (isFlavorKey→legendForFlavor), targetDate?, targets?, attributionHints?, notes?} — validates note first, creates via core, stamps note resolvedAt+resolvedReason "promoted to goal <id>", propose-before-apply description; list_promotable_notes +includeAspirations (opt-in widens to audible+journal); get_goal/list_goals expose attributionHints + computed lastTrained.
- **REQ-64-3 Goals UI (S)**: /goals accepts searchParams.objective → GoalCreateForm defaultObjective + `id="new-goal"` anchor; "Interview your coach first (recommended)" banner → /coach; "trained Nd ago"/"never trained" muted line on hinted rows + goal detail; stackWarning banner gains the interview nudge sentence. Visuals [UXR].
- **REQ-64-4 Coach+Journal UI (S)**: interview prompt card added to PROMPTS (full 7-step text in blueprint §3.7 — verbatim); PendingNotes row gains "Promote to goal →" link to `/goals?objective=<body slice 200>#new-goal`; docs/claude-ai-setup.md note. Row layout at 390px [UXR].

## 3. Out of scope
In-app chat/LLM; auto-created plans without coach; game-layer XP attribution from hints (seam only); UXR-63-17 ambient-banner refinement (post-epic polish backlog); promotedToGoalId column.

## 4. Edge cases
Plan-less goal focused → getActiveProgram falls back to another active plan/seed Program (documented in descriptions; recovery = dated upgrade auto-scaffold). update_goal date on plan-having goal → ensure no-ops (idempotent). promote on already-resolved note → goal still created, priorResolved flag, don't re-stamp. Hints that match nothing → "never trained". objective query param >200 chars → slice. Someday goal already unrated in rarity (regression-guard).

## 5. Acceptance criteria
1. Gates: tsc/lint/build clean; migration = one additive ALTER.
2. create_goal someday w/ targets+coachFeasibility+hints ⇒ planId null, zero plans, all Json fields stored; dated create regression w/ stackWarning intact.
3. update_goal set date on plan-less goal ⇒ planScaffolded true, weeks=weeksBetween; second call idempotent. hints set/clear via nullable-optional.
4. promote_note_to_goal ⇒ goal + stamped note; bad noteId ⇒ no goal created.
5. list_promotable_notes default unchanged; includeAspirations adds audible+journal.
6. get_goal/list_goals carry hints+lastTrained; /goals + detail render trained lines; journal promote link prefills the form; coach card copies the full prompt.
7. Handstand E2E (blueprint §6 story) passes against live DB.
8. Ship report reminds: reload MCP connector.

## 6. References
Plan file (approved) at phases/approved-plan.md; full design in agents/architecture-blueprint.md; Phase-1/2 PRDs; uxr sign-off conventions from prior runs.
