# PRD: Gate fitness-only idioms behind goal kind (#229, AMENDED)

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-07-09
**Status**: Approved (amended scope — user question defaulted to recommended option; flagged for review)
**GitHub Issue**: #229 (Sprint 11 — Feature correctness, P1; dep #228 ✅)
**Branch**: feature/phase1-auth
**UX-research**: skipped — copy/conditional-rendering fixes on existing surfaces

---

## 1. Overview

### 1.1 Problem Statement
Project-kind goals hit three fitness-framed surfaces: the goal-detail readiness card is titled "Readiness" (fitness idiom) for every kind; `/compare`'s "The work between" renders fitness counters (workouts/hikes/ft/mi/baseline tests) unconditionally even for project-only comparisons; and `/character` renders the raw string `project` where fitness gets "Adventurer".

### 1.2 Premise check & amendment (2026-07-09)
| AC | Verdict | Consequence |
|---|---|---|
| AC1 hide readiness for project on goals/[id] | Premise real, **fix wrong** — computeReadiness is kind-agnostic (readiness.ts:164, no kind refs); project goals have real targets/scores; /progress (progress/page.tsx:38-54) and /compare (buildGoalSections) both display them | **AMENDED**: keep card + computation for all kinds; title per kind from the presentation registry |
| AC2 hide whole "work between" card for project-only | Whole-card hide loses kind-neutral counters (notes/XP/Level — incl. #228's new notes tile); gameState warning moot (page references neither) | **AMENDED**: gate only the fitness tiles + cumulative rows on `result.goals.some(g => g.kind === "fitness")` |
| AC3 classLabel in presentation registry | TRUE — no such field exists (goal-presentation.ts:46-53); DEFAULT spreads FITNESS (:114-118) as the AC assumes | As written |
| AC4 character raw-kind leak | TRUE — single site, character/page.tsx:76 ternary; page doesn't import goal-presentation yet | As written |

### 1.3 Success Criteria
Project goal detail shows a "Progress"-titled score card (same data); project-only compares show notes/XP/Level but no workout/hike tiles; character page shows "Builder" for project focus; fitness surfaces byte-identical; gates green.

---

## 2. User Stories

| ID | As a... | I want to... | So that... | Priority |
|----|---------|--------------|------------|----------|
| US-001 | Multi-domain user with a project focus | see my project's score framed as "Progress", not "Readiness" | the app speaks my goal's language without hiding my data | Must Have |
| US-002 | Project-only user comparing dates | see notes/XP/Level between dates without workout/hike zeros | the comparison reflects my domain | Must Have |
| US-003 | Project-focus user on /character | see "Builder" as my class | no raw enum string leaks into the UI | Must Have |

---

## 3. Functional Requirements

### 3.1 Core (amended design — file-level)
1. `src/lib/goal-presentation.ts`: `GoalPresentation` + `classLabel: string`; FITNESS="Adventurer", PROJECT="Builder"; DEFAULT inherits via existing spread (deliberate — AC-specified; unknown kinds read as Adventurer).
2. `src/lib/goal-presentation.test.ts`: classLabel cases — fitness, project, DEFAULT inheritance, unknown kind (slot into existing structural blocks at ~:109/:191/:180/:163).
3. `src/app/character/page.tsx:76`: `presentationForGoal({ kind: state.goalKind }).classLabel` replaces the ternary (goalKind non-null by :76 via the :32 early return). New import.
4. `src/app/goals/[id]/page.tsx`: computation untouched; Readiness Card (:237-249) title = title-cased `presentationForGoal(goal).ringLabel` → fitness "Readiness" (byte-identical), project "Progress".
5. `src/app/compare/page.tsx`: `hasFitnessGoal = result.goals.some((g) => g.kind === "fitness")`; fitness tiles (workouts, hikes, baseline tests, ft climbed, mi hiked) + `cumulative[]` rows render only when true; notes/XP/Level always; `workBetweenLabel` enumerates exactly what renders (extend #228's conditional pattern across hasFitnessGoal × Level-null).

### 3.2 Out of Scope
Any change to computeReadiness/its call-site conditions; recap-card ring labels (already kind-aware); other raw-kind renders (verified: none); #230/#231.

---

## 4. Technical Design
Data model N/A · MCP N/A (no tool changes; `compare_dates` JSON unchanged — rendering only) · Server actions N/A · Dates N/A · Tenant scoping: no query changes.
Components: 4 prod files + 1 test file per §3.1. Server components stay server.

---

## 5. UI/UX
390px; existing tokens; project goal-detail card identical layout with "Progress" title; project-only compare grid = 3 tiles (notes, XP, Level when available). Fitness: byte-identical everywhere.

---

## 6. Edge Cases
| Scenario | Expected |
|---|---|
| Unknown/future goal kind | DEFAULT presentation → "Adventurer" label, "Readiness" title (documented AC choice) |
| state.goalKind null on /character | Unreachable at :76 (guarded :32); presentationForGoal tolerates null regardless |
| Mixed fitness+project compare | hasFitnessGoal true → full grid (unchanged) |
| Zero goals (new user) compare | hasFitnessGoal false → notes/XP tiles only; no crash |
| Level tile null × hasFitnessGoal combos | aria-label enumerates exactly the rendered set (4 combos) |

---

## 7. Security
Rendering-only; no new inputs/queries/routes.

---

## 8. Acceptance Criteria
1. [ ] classLabel field + registry values + 4 test cases green
2. [ ] /character shows "Adventurer" (fitness focus) via classLabel; code path shows "Builder" for project (test or code review — founder focus is fitness)
3. [ ] goals/[id]: fitness card byte-identical ("Readiness"); project goal page shows "Progress" card WITH score
4. [ ] compare: fitness-present unchanged (8 tiles + cumulative); project-only path gates fitness tiles (code review + any feasible render check)
5. [ ] tsc 0 / lint no new / tests green / build OK
6. [ ] No kind-gating added to any computeReadiness call site (grep)

---

## 9. Open Questions
None (amendment decision taken; DA to sanity-check ringLabel-as-title semantics).

---

## 10. Test Plan
Gates; goal-presentation.test.ts additions; browser 390px: /character, fitness goal detail, project goal detail (founder has project goals: chewgether/ocarina/rhino), /compare. Project-only compare verified by code review (founder data always includes fitness goals).

---

## 11. Appendix
Premise-check: `.feature-dev/2026-07-09-229-goal-kind-idioms/agents/research-output.md`. Siblings: #227 (false premise), #228 (weakened premise). Memory: goal-progress-bars-are-goal-generic.
