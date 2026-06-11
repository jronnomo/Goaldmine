# Requirements — Rarity/feasibility engine (#63)
PRD: docs/prds/PRD-rarity-feasibility-engine.md (authoritative). Blueprint: agents/architecture-blueprint.md (D1-D8).

## REQ-63-1 — Rarity engine (pure core + async wrapper + self-check) (L)
src/lib/rarity-core.ts (pure, client-safe: RARITY_TIERS, RARITY_RULES, FITNESS_NORM_PACK/RARITY_NORM_PACKS/normPackForGoal, metricFamilyFor, weeklySlope, computeTargetFeasibility, aggregateGoalTier, concurrentLoadBump, aggregateStackTier, effectiveTier, all types) + src/lib/rarity.ts (computeGoalFeasibility, computeStackRarity w/ extraGoal, observedSeriesFor per metric family, weeksRemainingFrac via @/lib/calendar) + scripts/test-rarity.ts (pure-math self-check incl. bench-315 case + boundaries). Acceptance: PRD §5.2; no Prisma/calendar imports in core; tsc/lint clean. Depends: —.

## REQ-63-2 — Migration + shared cores (M)
Goal.coachFeasibility Json? + migration rarity_phase2 (single additive ALTER, apply + generate); setGoalTrackedCore/setPlanActiveCore extracted to src/lib/goal-core.ts (guards verbatim); goal-actions.ts wrappers keep revalidatePath sets. Acceptance: PRD §5.3+§5.6 (action behavior unchanged). Depends: —. Owns goal-actions.ts wave 1.

## REQ-63-3 — MCP surface (M)
tools.ts sole owner: new get_rarity, set_goal_feasibility, set_goal_tracked, set_plan_active, preview_goal_feasibility (reuse update_goal_targets targets shape); edits list_goals (+coachFeasibilityTier row-only), get_goal (+feasibility), get_game_state (+slim stackRarity), create_goal (+stackWarning non-blocking). Descriptions = coach docs (tiers, higher=harder, Legendary wording, override semantics). Acceptance: PRD §5.4-9. Depends: 63-1, 63-2.

## REQ-63-4 — UI (M)
RarityChip (client-safe) + StackRarityCard; /goals stack card + per-row chips (ONE computeStackRarity) + glossary row; /goals/[id] feasibility section + ?stackWarning banner; /character portrait chip; createGoal warning redirect (goal-actions.ts createGoal only). Visuals per docs/ux-research/rarity-tiers.md (READ FIRST). Acceptance: PRD §5.7+§5.10. Depends: 63-1, 63-2, ux-research.

Waves: {63-1 ∥ 63-2 ∥ ux-research} → {63-3 ∥ 63-4}.
