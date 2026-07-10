# PRD: Dedup block/prescription display formatters (#238)

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-07-10
**Status**: Approved
**GitHub Issue**: #238 (Sprint 13 — Consolidation, a11y & polish)
**Branch**: feature/phase1-auth
**UX-research**: skipped — pure consolidation, zero visual change (parity rulings preserve output byte-for-byte)

---

## 1. Overview

### 1.1 Problem Statement
`blockTypeLabel`, `formatSecs`, and `compactPrescription` are copy-pasted across plan-rendering surfaces. One copy has ALREADY silently diverged (the story's stated risk, realized). Hoist the pure formatters into one shared module; JSX components stay page-local.

### 1.2 Premise check (2026-07-10, HEAD 56dd762) — corrections + parity rulings
| Claim | Verdict |
|---|---|
| blockTypeLabel ×3 pages | TRUE + understated — **4th identical copy** in `prescription-prefill.ts:59` (module-private) |
| formatSecs ×3 pages | TRUE + understated — 5 identical copies (also SnapshotView:147, PlanOverview:133) **+ 1 DIVERGENT**: `CompletedWorkoutCard.tsx:99` always renders `m:ss`, never "N min" (120→"2:00" vs "2 min") |
| compactPrescription ×3 pages | **PARTIAL** — 3 identical copies (days:468, plan:328, SnapshotView:139); **Today has none** (verbose inline ExerciseRow format, different by design) |
| Related helpers | `prescriptionRight` (plan:320) = compactPrescription minus the `\|\| "—"` fallback; `defaultBlockLabel` (page.tsx:471) is a DIFFERENT Today-only map (straight→"Strength") |

**Ruling 1**: CompletedWorkoutCard's divergent formatSecs stays LOCAL — it formats logged set durations (stopwatch semantics); adopting "N min" would change visible output and violate the parity AC.
**Ruling 2**: compactPrescription and prescriptionRight both export from the shared module over a private `prescriptionParts()` — the "—" vs "" fallback divergence is preserved byte-for-byte.
**Ruling 3**: defaultBlockLabel stays page-local (single consumer, different semantics — the AC's "page-specific variants preserved" clause).

### 1.3 Success Criteria
Each formatter defined once in `src/lib/plan-format.ts`; 4+5+3+1 local copies deleted across 6 files; rendered text identical everywhere; first unit coverage; gates green at 783+new.

---

## 2. User Stories
| ID | As a... | I want to... | So that... | Priority |
|---|---|---|---|---|
| US-001 | Maintainer | one formatter set | a format fix lands everywhere; divergence impossible | Must Have |
| US-002 | User | identical rendered text | consolidation invisible | Must Have |

---

## 3. Functional Requirements

### 3.1 Core
1. New `src/lib/plan-format.ts` (pure, client-safe; types from `@/lib/program-template` which has zero imports): `blockTypeLabel`, `formatSecs` (canonical), private `prescriptionParts`, `compactPrescription` ("—" fallback), `prescriptionRight` ("" fallback). Header comment documents the CompletedWorkoutCard deliberate variant.
2. Migrations: page.tsx (blockTypeLabel+formatSecs), days/[dateKey] (all three), goals/[id]/plan (all four), SnapshotView (formatSecs+compactPrescription), PlanOverview (formatSecs), prescription-prefill (blockTypeLabel). Delete locals, import shared, clean orphaned imports.
3. New `src/lib/plan-format.test.ts` (~10): formatSecs 45/60/90/120, blockTypeLabel 5 arms, compact-vs-right fallback divergence, parts composition (sets-only / reps string|number / duration-only / all).

### 3.2 Out of Scope
CompletedWorkoutCard (divergent formatSecs + formatSet); Today's defaultBlockLabel/ExerciseRow/BlockCard; plan's BlockView; day-editor components; any rest/rounds/equipment inline JSX.

---

## 4. Technical Design
Pure hoist — all helpers are top-level closures-free functions in server components. No schema/route/MCP changes. Import direction: pages/components → lib → program-template (no cycles).

---

## 5. UI/UX
None — byte-identical output by construction.

---

## 6. Edge Cases
| Scenario | Expected |
|---|---|
| Empty prescription on plan page (prescriptionRight) | "" (blank right column) — unchanged |
| Empty prescription on days/snapshot (compactPrescription) | "—" — unchanged |
| reps as string "8-10" | `String(ex.reps)` verbatim — unchanged |
| Logged set duration 120s (CompletedWorkoutCard) | "2:00" — untouched local variant |
| Prescribed duration 120s (any page) | "2 min" — canonical |

---

## 7. Security
None.

---

## 8. Acceptance Criteria (amended per §1.2)
1. [ ] blockTypeLabel/formatSecs/compactPrescription/prescriptionRight each defined once in plan-format.ts; all identical local copies deleted (6 files incl. prescription-prefill, SnapshotView, PlanOverview)
2. [ ] grep: only plan-format.ts + CompletedWorkoutCard's documented formatSecs variant remain
3. [ ] Page-specific JSX (ExerciseRow/BlockCard/BlockView) + defaultBlockLabel untouched
4. [ ] tsc 0 / lint no new / 783+new tests / build OK
5. [ ] Visual parity: Today, /days/[dateKey], /goals/[id]/plan (+ SnapshotView surface if reachable) render identical text

---

## 9. Open Questions
DA rules: per-file call-site completeness; prescription-prefill substitution safety; defaultBlockLabel absorption (expected NO); import cycles; reps handling.

---

## 10. Test Plan
Gates; new plan-format suite; dev-agent browser pass on the three pages at phone width; orchestrator parity pass if Chrome available.

---

## 11. Appendix
Premise findings inline (§1.2). The realized-divergence (CompletedWorkoutCard) is the story's value proposition demonstrated. Type anchors: program-template.ts:4 (ExercisePrescription), :14 (Block).
