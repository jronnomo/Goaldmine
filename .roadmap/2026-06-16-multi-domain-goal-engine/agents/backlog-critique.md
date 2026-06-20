# Backlog Critique — Finish the Multi-Domain Goal Engine

**Role:** Backlog Critic (read-only + this doc; no production code).
**Date:** 2026-06-16
**Inputs:** `coordination/backlog.json` (22 stories), `docs/roadmap/multi-domain-goal-engine-plan.md`, `agents/plan-blueprint.md`, `.claude/quality-tools.md`.

**Verdict:** The backlog is unusually complete — every plan thread (3.1 core, 3.1 rest, 3.2 surface, 3.6 tests) and almost every blueprint guardrail (anti-vertical 2-slot project grid, PROGRESS-not-TRACTION, ScheduledItem-vs-`log:milestones_done`, fitness byte-identical, no `rarity-core.ts` change, server/Date boundary, Satori re-render, weeks-to-target via `@/lib/calendar`) is encoded as an acceptance criterion. The problems are **not** missing scope — they are **5 broken cross-sprint dependency titles** that will silently fail Phase 5 issue-linking, plus **2 genuine completeness gaps** and **1 minor doc gap**.

---

## 1. Dependency fixes (DO THIS FIRST — breaks Phase 5 linking)

Phase 5 links stories by **exact title**. Five stories in Sprints 7 and 9 reference Sprint 6 titles that **do not exist verbatim** in the backlog. Each will either fail to link or leave the dependent story falsely unblocked.

The two real Sprint 6 titles being referenced:
- **A** = `Create the pure goal-presentation registry module with fitness and project entries and hoisted formatters`
- **B** = `Add statSlots, resolveStatSlot, gated project fetch, and weeks-to-target header fields to computeWeeklyRecap`

| Story (sprint) | `dependsOn` value present | Should be |
|---|---|---|
| Drive Today rest-day copy… (S7) | `Create the pure goal-presentation registry module` | **A** |
| Route legend.ts resolveLegend… (S7) | `Create the pure goal-presentation registry module` | **A** |
| Gate the progress-page weight chart… (S7) | `Create the pure goal-presentation registry module` | **A** |
| Unit-test the goal-presentation registry… (S9) | `Create the pure goal-presentation registry module (goal-presentation.ts)` | **A** |
| Unit-test resolveStatSlot + recap statSlots… (S9) | `Create the pure goal-presentation registry module (goal-presentation.ts)` **and** `Add resolveStatSlot + statSlots to the recap aggregator (recap.ts)` | **A** and **B** |

**Action:** rewrite those `dependsOn` strings to the exact **A** / **B** titles above. No other dependency in the backlog is broken — all Sprint 6 internal deps, all Sprint 8 deps (`Build the goal-generic FeasibilityReadout server component`), and the Sprint 7 QA deps are exact matches. **No cycles exist** (every edge points backward to an earlier story).

Secondary: the **Sprint 7 QA** story's `dependsOn` should also gain the new project-doc story title from §2 (Missing Story 1) once added, so QA gates on it.

---

## 2. Missing stories (proposed full JSON, ready to append)

### Missing Story 1 — project coaching doc isn't updated for the Sprint 6/7 surfaces (REAL gap)
Plan §4.6 and blueprint §6 require `project-goal-prompts.md` to document the **recap card** (MRR/MILESTONES + PROGRESS ring) and the **project-shaped Today/progress** surfaces. The backlog only touches `project-goal-prompts.md` in Sprint 8, and that edit is **feasibility-only**. The recap/Today/progress documentation is unowned. (Symmetric hole: the *fitness* counterpart doc is created in Sprint 7, but the *project* doc is never updated to match what Sprints 6–7 ship.)

```json
{
  "epic": "Sprint 7 — Today + progress + legend kind-awareness",
  "title": "Update project-goal-prompts.md for the kind-aware recap card and Today/progress project surfaces",
  "value": "so that the coach's project mental model matches what Sprints 6-7 ship — recap card shows MRR/MILESTONES with a PROGRESS ring and weeks-to-target header, Today drops the Mt. Elbert rest-day tip, and /progress shows the MRR trend + milestone burn-down instead of a weight chart — not just the feasibility readout documented in Sprint 8",
  "acceptanceCriteria": [
    "docs/coaching/project-goal-prompts.md gains a 'Surfaces the coach can rely on' subsection documenting: the recap card renders MRR + MILESTONES with a PROGRESS ring and a weeks-to-target header; Today renders project-shaped with no Mt. Elbert rest-day tip; /progress shows the MRR-over-time trend + MilestoneBurnDown instead of a weight chart",
    "The doc states the recap MILESTONES stat sources the live ScheduledItem aggregate (0/7) while readiness still reads log:milestones_done (the two-truths invariant), so the coach is not surprised by a 0/7 card next to a null readiness metric",
    "Does NOT duplicate the Sprint 8 edit: this story covers recap/Today/progress framing; Sprint 8 covers the FeasibilityReadout surface + the get_goal description",
    "Documentation only: no production code touched; markdown is internally consistent with the surfaces Sprint 6 + Sprint 7 ship",
    "Fitness un-regressed and project unaffected (doc-only change; no runtime impact)"
  ],
  "touches": ["docs/coaching/project-goal-prompts.md"],
  "effort": "Small",
  "priority": "P2 - Medium",
  "dependsOn": [],
  "sprint": "Sprint 7 — Today + progress + legend kind-awareness"
}
```

### Missing Story 2 — the deferred `Goal.presentation Json?` seam is untracked (REAL gap)
Plan §4.1/§7 and blueprint §4/§9 **explicitly defer** `Goal.presentation Json?` (and `minObservedPointsByFamily` + non-fitness `NormPack`s) and mandate **no schema migration** in Sprints 6–9. Nothing in the backlog records this as out-of-scope. The three Backlog epics cover 3.3/3.4/3.5 but not the deferred additive seams — a dev could "helpfully" add the column. A tracking stub makes the non-goal explicit and Neon-safe.

```json
{
  "epic": "Backlog — Deferred chapters",
  "title": "DEFERRED: Goal.presentation Json? per-goal label-override seam (no schema change in Sprints 6-9)",
  "value": "so that the explicitly-deferred additive schema seam is tracked and NOT accidentally built during Sprints 6-9 — the presentation config stays code, not data, until a per-goal label override is actually needed",
  "acceptanceCriteria": [
    "Tracking stub only: records that Sprints 6-9 add NO Prisma migration — presentationForGoal resolves from goal.kind in code, never a Goal.presentation column (per plan §4.1/§7 and blueprint §4)",
    "If a per-goal override (e.g. a custom ring label for one goal) is ever needed it lands as a nullable additive Goal.presentation Json? migration, Neon-safe per .claude/quality-tools.md — not before",
    "Also captures the sibling deferred seams: minObservedPointsByFamily + TargetFeasibility.confidence (2-point coarse rates) and non-fitness NormPacks in RARITY_NORM_PACKS — all additive, none in scope now",
    "To be decomposed only if/when a concrete per-goal override need arises"
  ],
  "touches": ["prisma/schema.prisma", "src/lib/goal-presentation.ts"],
  "effort": "Small",
  "priority": "P3 - Low",
  "dependsOn": [],
  "sprint": "Backlog"
}
```

### Missing Story 3 — Sprint 9 has no integration-QA gate (minor, for pattern symmetry)
Sprints 6/7/8 each end with a dedicated QA/verify story; Sprint 9 does not. Each test story self-verifies (`npx vitest run` green), so this is lower-stakes, but a final "whole suite + build green, no production source touched" gate matches the pattern and guards the blueprint §3.1 invariant that the honesty tests document existing behavior rather than the engine being bent to pass them.

```json
{
  "epic": "Sprint 9 — Honesty-math tests",
  "title": "Sprint 9 QA — full Vitest suite green + build, no production code modified by the test sprint",
  "value": "so that the honesty-math test sprint lands with the whole suite green on main, the build unbroken, and zero production-source drift — tests only",
  "acceptanceCriteria": [
    "npx vitest run is green across the full committed suite (food-units + readiness + rarity-core + goal-presentation + recap specs)",
    "npx tsc --noEmit, npm run lint, and npm run build all pass",
    "git diff against the sprint base shows ONLY *.test.ts files added/changed — no production source (readiness.ts, rarity-core.ts, recap.ts, goal-presentation.ts) was modified by Sprint 9",
    "Any failing assertion is filed back to the owning honesty-math story; the engine is not changed to make a test pass (tests document existing behavior, per blueprint §3.1)"
  ],
  "touches": ["src/lib/readiness.test.ts", "src/lib/rarity-core.test.ts", "src/lib/goal-presentation.test.ts", "src/lib/recap.test.ts"],
  "effort": "Small",
  "priority": "P2 - Medium",
  "dependsOn": [
    "Unit-test progressFor + computeReadiness: gating ceiling 80, untested=0, coverage, decrease, already-met, build-from-zero",
    "Unit-test computeTargetFeasibility: log: observed path (>=3pts), <3pts unknown, met-check, ratioCap stall, decrease-sign",
    "Unit-test the goal-presentation registry: per-kind config + __default__ fallback",
    "Unit-test resolveStatSlot + recap statSlots derivation per kind (fitness byte-identical, project —/0/7)"
  ],
  "sprint": "Sprint 9 — Honesty-math tests"
}
```

---

## 3. Candidate gaps that are ALREADY covered (verified, no story needed)

- **`get_goal` description tweak** — covered: Sprint 8 `Advertise feasibility in get_goal's description…`.
- **Fitness byte-identical snapshot** — covered twice: Sprint 6 `Add Vitest coverage pinning fitness statSlots byte-identical…` + Sprint 9 `Unit-test resolveStatSlot + recap statSlots derivation…`.
- **`weeks-to-target` header fields in recap.ts** — covered: Sprint 6 story B AC5 (adds `weeksToTarget`/`targetDateLabel` to `RecapProgramHeader` via `@/lib/calendar`) + render in `Drive recap-card ring labels…`.
- **ScheduledItem-vs-`log:milestones_done` sourcing** — covered: Sprint 6 story B AC4 and Sprint 9 recap test AC explicitly source MILESTONES from `scheduledItem.groupBy`, not the log metric.
- **Fitness counterpart coaching doc** — covered: Sprint 7 `Add a fitness counterpart coaching doc…`.
- **Satori re-render verification** — covered: Sprint 6 `Drive recap-card…` AC5 + Sprint 6 QA AC5.
- **Deferred `Goal.presentation` out-of-scope** — NOT covered → Missing Story 2 above.

### MCP connector-reload note (clarification, not a new story)
Sprint 8 changes the **`get_goal` tool *description*** only. Per `.claude/quality-tools.md`, the claude.ai connector cache needs a disconnect/reconnect **only when tool count or names change** — a description-only edit does **not**. The Sprint 8 `Advertise feasibility…` AC already asserts "same total tool count/names as before," which implicitly confirms no reconnect is needed. **Recommend** appending one explicit AC to the Sprint 8 `Verify the feasibility surface…` story:

> "Connector note: because only the get_goal *description* changed (tool count/names unchanged), no claude.ai connector disconnect/reconnect is required; the new description goes live to the coach only after a Vercel redeploy."

---

## 4. Right-sizing (splits)

**No mandatory splits.** No active (non-Backlog) story is `Effort: Large`, so the "Large + >5 AC = epic" rule fires on none of them. The three Backlog stories are intentionally Large epics — left as-is per instructions.

**Two optional split candidates** (Medium with 8 ACs each — heavy but cohesive, leave unless the team wants finer granularity):
- Sprint 6 **B** `Add statSlots, resolveStatSlot, gated project fetch, and weeks-to-target header fields…` bundles (a) the fetch-order restructure + `resolveStatSlot` + 4 sources and (b) the weeks-to-target header fields. These are the two genuinely distinct deliverables; could split if it lands too big. It is the single most complex story in the initiative.
- Sprint 7 `Gate the progress-page weight chart… and render an MRR trend…` bundles (a) weight-chart gating and (b) a brand-new MRR sparkline component. Splittable, but they share the same file and gate decision.

Neither is required; both stay single stories unless the dev flags them mid-sprint.

---

## 5. Sprint balance

- **Sprint 6 (5 stories, 3×P0 + 2×P1):** correctly front-loads the registry (P0, `dependsOn: []` — the unblocker) → recap aggregator (P0) → recap card (P0), then tests + QA. Heaviest architectural sprint, but that is correct: it is the seam everything else consumes. Ends with a QA story that pins fitness byte-identical. **Deployable, fitness un-regressed. ✓**
- **Sprint 7 (5 → 6 with Missing Story 1, P1-heavy):** all consume the Sprint 6 registry; no P0 needed (foundation already laid). Ends with a 390px QA story. **Deployable. ✓**
- **Sprint 8 (5 stories):** `Build the goal-generic FeasibilityReadout` is correctly P0 and `dependsOn: []`; everything else hangs off it. Repeated `NO change to rarity-core.ts` guardrail across every story is excellent. **Deployable. ✓**
- **Sprint 9 (4 → 5 with Missing Story 3):** tests-only; runs alongside but sequenced last to pin final shapes. **Deployable (no prod change). ✓**

**No sprint is overloaded** beyond Sprint 6's inherent foundational weight, and every sprint leaves `main` deployable with fitness un-regressed (each has an explicit byte-identical / un-regressed criterion).

**No revised ordering required.** Sprint 6 P0 registry first is correct; the only change is the dependency-title corrections in §1 so the existing ordering actually links.

---

## 6. Minor observations (no action required)

- **ProjectTodayView labels:** blueprint §1.6 says `ProjectTodayView` should also route `ringLabel`/header through the registry; the backlog only adds `FeasibilityReadout` to it (Sprint 8). Acceptable — ProjectTodayView is project-only so hardcoded project framing isn't a mislabel risk — but noted for completeness.
- **Feasibility not on /progress:** correct — plan scopes `FeasibilityReadout` to Today + goal page only; /progress gets the MRR trend. No gap.
