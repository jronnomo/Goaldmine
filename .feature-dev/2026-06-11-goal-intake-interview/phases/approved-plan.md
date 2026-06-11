# Multi-goal Phase 3: Guided goal-intake interview (issue #64, Epic #61 — final phase)

## Context
Phases 1-2 shipped awareness + honesty. Phase 3 closes the epic: goal creation becomes a coached conversation (interview prompt card → benchmarks logged live → targets proposed → preview_goal_feasibility BEFORE create), aspirations become first-class someday goals (one-step note→goal promotion; no plan scaffold), and woven skill work becomes visible (attributionHints + last-trained indicator) — the handstand north-star story end-to-end.

Runs under /feature-dev: PRD → /ux-research (opted in) → DA review → 4 parallel Sonnet devs → QA gates → main.

## Decisions (locked with user)
1. Someday goals (null targetDate) create NO plan; the dated-upgrade path auto-scaffolds a plan inside BOTH date-setting mutations (MCP update_goal + UI updateGoal) via new `ensurePlanForGoalCore(goalId, targetDate)` — no-op when any plan exists.
2. Attribution = new `Goal.attributionHints Json?` (canonical exercise names; don't overload targets/legend) + "trained Nd ago" indicator on /goals rows + goal page; exposed in get_goal/list_goals with computed lastTrained (ONE batched query via new src/lib/goal-attribution.ts + records.ts aliasVariantsFor export).
3. /ux-research runs: create-form interview-banner prominence, 3-action PendingNotes row at 390px, last-trained treatment, interview-card copy/position. Structure fixed.
4. No new column for note provenance: resolvedReason = "promoted to goal <id>".
5. list_promotable_notes gains opt-in `includeAspirations` (adds audible+journal; default unchanged).
6. promote_note_to_goal takes coach-distilled `objective` (never raw body) + optional flavor/targets/hints/date; flavor resolves via legendForFlavor.
7. update_goal folds in attributionHints (nullable-optional idiom); no separate set_goal_attribution tool.

## Build
- **Migration `phase3_intake`**: Goal.attributionHints Json? (single additive ALTER).
- **goal-core.ts**: createGoalCore skips plan when someday (planId: string|null in result); gains coachFeasibility + attributionHints inputs (same Json shape set_goal_feasibility writes; hints canonicalized); ensurePlanForGoalCore extracted from the create scaffold block.
- **goal-actions.ts**: updateGoal calls ensurePlanForGoalCore when a date is set.
- **records.ts**: export aliasVariantsFor(canonical).
- **NEW goal-attribution.ts**: parseAttributionHints, lastTrainedForGoals (one workoutExercise findMany over all hint variants, canonicalize in memory), relativeTrainedLabel.
- **tools.ts** (sole owner): create_goal +targets/+coachFeasibility/+attributionHints (GoalTargetSchema exists); update_goal +attributionHints + auto-scaffold hook (+planScaffolded in response); NEW promote_note_to_goal (validates note first; creates via core; stamps note; propose-before-apply description); list_promotable_notes +includeAspirations; get_goal/list_goals expose hints+lastTrained.
- **coach/page.tsx**: interview prompt card (full 7-step text drafted in blueprint — objective→date-or-someday→benchmarks via log_baseline→constraints→weighted targets→preview_goal_feasibility before create→create_goal w/ feasibility seed + hints; promote_note_to_goal variant when sourced from a note).
- **PendingNotes.tsx**: "Promote to goal →" link → /goals?objective=<body slice>#new-goal.
- **goals/page.tsx + GoalCreateForm**: searchParams objective prefill + #new-goal anchor; "Interview your coach first (recommended)" banner → /coach; trained-line on hinted rows.
- **goals/[id]/page.tsx**: stackWarning banner gains "try the intake interview" nudge; trained line.
- **docs/claude-ai-setup.md**: interview + promote flow noted.

## REQs (waves)
REQ-1 Core+Data (schema/migration, goal-core, goal-actions, records, goal-attribution) → then parallel: REQ-2 MCP (tools.ts only) ∥ REQ-3 Goals UI ∥ REQ-4 Coach+Journal UI. Contracts pinned: ensurePlanForGoalCore/lastTrainedForGoals signatures; /goals?objective=…#new-goal.

## Risks
lastTrained query unbounded over history (single-user fine; note take-cap escape); hint name drift vs alias map (descriptions say "names exactly as logged; check get_records_summary"); plan-less focus goal → getActiveProgram falls back (documented; upgrade path recovers); promote non-atomicity (goal then note stamp — benign, description carries retry idiom); planId:null contract (message explicit).

## Verification
Gates + migration; MCP curls 1-8 (someday create w/ all fields → planId null + zero plans; dated create regression w/ stackWarning; update_goal date → planScaffolded true then idempotent; hints set/clear; promote → note stamped; includeAspirations filter; get_goal lastTrained; preview regression); browser 390px (coach card copy, journal promote → prefilled form, banner, nudge, trained lines); the full handstand story: note → promote (hints: Wall Handstand Push-Up) → someday row unrated "never trained" → log workout w/ that exercise → "trained today" → update_goal date → plan scaffolds → joins stack. Ship report: reload MCP connector (new tool + changed schemas).
