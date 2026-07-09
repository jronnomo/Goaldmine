# Research / premise-check — #229 (Explore agent, 2026-07-09, HEAD c0b3474)

## 1. goals/[id]/page.tsx
- Readiness computation :113-114 inside Promise.all: `targets.length > 0 ? computeReadiness(targets, new Date(), goal.id) : Promise.resolve(null)` — NOT kind-gated. JSX guard :237-249 `{readiness && <Card title="Readiness">…}` — literal title.
- Project goals DO have targets (log:* metrics) and real readiness; computeReadiness (readiness.ts:164) kind-agnostic (zero kind refs).
- INCONSISTENCY if kind-gated here: /progress computes for EVERY active goal with targets (progress/page.tsx:38-54) and renders per-goal readiness cards kind-blind (:130-201; only the milestone/MRR extras are project-gated :206). compare's buildGoalSections computes for all kinds.

## 2. compare/page.tsx (post-#228)
- "The work between" :346-369 unconditional Card.
- GoalCompareSection (compare-core.ts:247-264) HAS `kind`; page never references kind/goalKind/gameState (grep: none) — AC's gameState premise FALSE.
- between fields (compare-core.ts:266-284): kind-neutral = notesLogged, xpEarned, levelA/levelB; fitness = workoutsCompleted (fitness-domain), hikesCompleted, hikeElevationFt, hikeDistanceMi, baselineTestsLogged. cumulative[] fitness-leaning (workout sessions, elevation, distance) rendered :355-360 area. levelA/levelB doc-comment: gated upstream on GameState.goalKind===null (compare-core.ts:276-279).

## 3. goal-presentation.ts
- GoalPresentation :46-53: kind, ringLabel, headerStyle, statSlots, restCopy, legendDefault. NO classLabel analogue.
- FITNESS :57-90 (ringLabel "READINESS"); PROJECT :92-112 (ringLabel "PROGRESS", restCopy null); DEFAULT :114-118 = `{...FITNESS_PRESENTATION, kind: "__default__", restCopy: null}` → new FITNESS fields inherited unless overridden.
- presentationForGoal :127-132 takes `{ kind?: string | null } | null | undefined`; REGISTRY {fitness, project}; fallback DEFAULT.
- Consumers: app/page.tsx:50, recap.ts:323-324, recap-card.tsx:315,803, legend.ts:100.

## 4. character/page.tsx
- :76 `{state.goalKind === "fitness" ? "Adventurer" : state.goalKind}` — THE raw-kind leak (single site). state = computeGameState() :29; null-guard early return :32; rulePackForGoal :44. Page does NOT import goal-presentation.

## 5. Tests
- goal-presentation.test.ts exists (431 lines): structural per-kind assertions — fitness :109, unknown-kind :163, DEFAULT :180-187, project :191. vi.mock("@/lib/db") hoisted. classLabel cases slot in directly.
- No tests for character/goals-detail pages.

## Net
AC3/AC4 sound as written. AC1/AC2 premises real but prescribed fixes would hide real data → amended (reframe, don't hide) per user-question default.
