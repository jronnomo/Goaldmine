# PRD: De-founder MCP instructions, tool descriptions, and badges (#250)

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-07-11
**Status**: Approved
**GitHub Issue**: #250 (Multiuser credibility — the deliberate carve-out from Sprint 10's #225/N6 copy sweep)
**Branch**: feature/phase1-auth
**UX-research**: skipped — copy/de-personalization sweep with prescribed generic phrasing; no design space

---

## 1. Overview

### 1.1 Problem Statement
Every tenant's Claude session receives the founder's personal context (weight, Mt. Elbert/Black Cloud Trail, home gym, Chewgether) via the static COACH_INSTRUCTIONS served on initialize, and shared surfaces (the "Elbert Ready" badge, multiple tool descriptions) narrate the founder's goals. Live-confirmed: the orchestrating session's own MCP block echoes instructions.ts:30-33 verbatim.

### 1.2 Premise check (2026-07-11, HEAD cb3e623)
| Finding | Verdict |
|---|---|
| instructions.ts founder facts | CONFIRMED (:30-33, :38); the AC's "context from tools" mechanism ALREADY EXISTS (get_today_plan/get_session_brief) — the block is redundancy |
| Badge id migration needed | **DISSOLVED** — badges recomputed from Hike rows every render; no id persisted anywhere; rename is free |
| Tool descriptions (3 cited) | CONFIRMED with ~3-line drift AND an incomplete list — also tools.ts:3614 (founder's exact 155 lb target as the example), github-tools ×5 (jronnomo/Chewgether worked examples), project-tools:775 |
| metrics-registry | In scope (cheap): MT_ELBERT_DEFAULT_TARGETS prose served as hike-goal target rationale |
| **program-template.ts** | BIGGER leak, OUT of scope — scaffolds the founder's Elbert program into every new fitness goal via createGoalCore; needs product design → **follow-up issue filed** |
| Guard test | None exists — net-new (N6 pattern: FeasibilityReadout.test.ts:209-218) |
| Connector cache | Auto version-bump per deploy → refetch; manual toggle fallback (gotchas §C) |

### 1.3 Success Criteria
Zero founder tokens in src/lib/mcp + src/lib/game (grep + permanent guard test); instructions keep full coaching force (rules/routing/principles intact); tool descriptions generic-but-concrete; badge renamed; tool count unchanged; gates green at 822+new.

---

## 2. User Stories
| ID | As a... | I want to... | So that... | Priority |
|---|---|---|---|---|
| US-001 | Any non-founder tenant | a coach that knows MY context, not the founder's | credible multi-tenant product | Must Have |
| US-002 | The founder | coaching quality unchanged | tools already deliver my context live | Must Have |

---

## 3. Functional Requirements

### 3.1 Core
1. instructions.ts: delete :30-33; genericize :35-38 proper nouns (kind-routing structure + covenant FORCE preserved); rules/principles/rhythms untouched; header updated.
2. badges.ts: `elbert-ready`/"Elbert Ready"/"El" → `summit-ready`/"Summit Ready"/"SR" (hint already generic; no migration — recomputed).
3. tools.ts :1881/:2752/:3614/:4417 + github-tools ×5 + project-tools :775: goal-generic rewording keeping instructional concreteness (N6 rule).
4. metrics-registry.ts: prose genericized; constant → `HIKE_DEFAULT_TARGETS` (+ goal-targets.ts imports).
5. New `src/lib/mcp/no-founder-leak.test.ts`: fs-reads the target sources; asserts zero founder tokens (DA-prescribed patterns + file scoping to dodge the classifier/food false positives).
6. Follow-up issue filed for program-template.ts with the full trace.

### 3.2 Out of Scope
program-template genericization (follow-up); onboarding-generated per-user instruction docs (existing roadmap doc); code comments/test fixtures (internal, data-not-hardcode).

---

## 4. Technical Design
Copy-level changes to the MCP surface + one rename with two imports. Tool SCHEMAS unchanged (descriptions only) — but descriptions + instructions are connector-cached: deploy auto-bumps MCP_SERVER_VERSION → refetch; manual toggle fallback documented in the ship checklist.

---

## 5. UI/UX
Character page badge name changes ("Elbert Ready" → "Summit Ready") — for the founder only in practice (only earner). No layout change.

---

## 6. Edge Cases
| Scenario | Expected |
|---|---|
| Founder's coach post-deploy | Context arrives via get_today_plan/get_session_brief exactly as today; instructions redundancy removed |
| Earned badge across rename | Recomputed — still unlocked, new name |
| Connector stale cache | Version bump refetches; toggle fallback |
| Equipment context (gym details were instructions-only) | DA rules whether a generic "ask about equipment" line joins the rules |

---

## 7. Security
Removes cross-tenant personal-data exposure (the story IS the security fix). No schema/auth changes.

---

## 8. Acceptance Criteria (amended per §1.2)
1. [ ] COACH_INSTRUCTIONS zero founder facts; coaching force preserved
2. [ ] Badge renamed (no migration needed — documented why)
3. [ ] All identified descriptions generic (incl. the sites the issue missed); tools/list count unchanged; curl before/after captured
4. [ ] `grep -rn "Elbert" src/lib/mcp src/lib/game` → 0; permanent guard test green
5. [ ] tsc 0 / lint no new / 822+new / build OK
6. [ ] program-template follow-up issue filed + cross-linked

---

## 9. Open Questions
DA rules: equipment-context line; guard-test token patterns/scoping; badge rename ripple (recap/snapshot tests); covenant rewording; github-example concreteness.

---

## 10. Test Plan
Gates; guard test; MCP curl before/after (initialize instructions + tools/list diff); today-shapers + leaky-reads suites explicit.

---

## 11. Appendix
N6 lineage: full-app-audit.md:37 → #225 (app copy) → #250 (MCP surface). Gotchas §C (connector cache). The founder's fitness context remains available to THEIR coach via tools + claude.ai-side memory.
