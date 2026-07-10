# PRD: Chart, emoji-marker, and form-error a11y (#241)

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-07-10
**Status**: Approved
**GitHub Issue**: #241 (Sprint 13 — Consolidation, a11y & polish)
**Branch**: feature/phase1-auth
**UX-research**: skipped — a11y compliance additions, zero visual change (sr-only/aria only)

---

## 1. Overview

### 1.1 Problem Statement
Charts render as unlabeled SVGs (screen readers announce nothing), raw marker emoji sit inline in prose (garbled narration), and two inline form-error blocks appear silently instead of being announced.

### 1.2 Premise check (2026-07-10, HEAD 79cb363) — corrections + scope amendments
| Claim | Verdict |
|---|---|
| 3 chart wrappers at :25/:26/:33 | TRUE, lines accurate; the only chart components repo-wide; zero a11y today (no accessibilityLayer). **HistoryChart has 6 callers + no title prop → gains optional `label?` prop threaded per caller** |
| Recharts internals double-announce | PARTIAL — nothing announces today; aria-hidden is cheap defense, kept |
| Emoji at calendar:129 / days:242 | **STALE** — real lines calendar:152, days:243 (:129 is ForeignGoalMarker, already correct). **Missed siblings in scope: days:207 + :248 `{e.icon}` inline emoji** |
| OnboardingGoalForm ~:133 role="alert" | TRUE, accurate; 8 in-repo precedents. **Missed sibling in scope: GoalCreateForm.tsx:153** (the explicitly mirrored form, identical block) |

In-repo template: ReachMeter.tsx:55-64 (`role="img"` + computed label + aria-hidden children).

### 1.3 Success Criteria
All three charts announce a meaningful label; marker emoji hidden from SRs with meaning preserved in text; both error blocks announce on render; zero visual change; gates green at 794.

---

## 2. User Stories
| ID | As a... | I want to... | So that... | Priority |
|---|---|---|---|---|
| US-001 | Screen-reader user | charts announced with a content summary | /progress isn't a wall of silence | Must Have |
| US-002 | Screen-reader user | marker emoji not garbled | calendar/day prose reads sensibly | Must Have |
| US-003 | Screen-reader user | validation errors announced immediately | form failures aren't silent | Must Have |

---

## 3. Functional Requirements

### 3.1 Core
1. WeightChart: wrapper `role="img"` + `aria-label` ("Weight trend chart, N entries from X to Y" — dates already formatted in-component); internals `aria-hidden="true"`.
2. ReadinessChart: same, "Readiness trend chart, N points" (+ target date when present).
3. HistoryChart: optional `label?: string`; `aria-label={label ?? generic units-based}`; internals aria-hidden; thread labels at all 6 call sites (progress, goals metric page, baselines test/exercise pages, BodyMetricsSection, ProjectTrendsView).
4. calendar:152 — `<span aria-hidden>🏔️</span>` + sr-only "Goal target: " prefix; visible copy unchanged.
5. days:243 — aria-hidden the 🏔️ (visible "Goal target — …" text already meaningful); days:207 + :248 — wrap `{e.icon}` in aria-hidden spans.
6. role="alert" on OnboardingGoalForm:133 + GoalCreateForm:153 error blocks.

### 3.2 Out of Scope
Recharts accessibilityLayer (interactive chart navigation); MarkerIcon/ForeignGoalMarker (already correct); any visual change.

---

## 4. Technical Design
Aria/sr-only additions only; one new optional prop on HistoryChart with 6 one-line call-site threads. No schema/route/MCP changes.

---

## 5. UI/UX
Zero visible change (sr-only content is invisible; aria attributes are non-rendering).

---

## 6. Edge Cases
| Scenario | Expected |
|---|---|
| Chart tooltips after aria-hidden internals | Still interactive (aria-hidden ≠ pointer-events) — DA confirms |
| Empty chart data | Components already early-return before the wrapper (verify) — label never renders "0 entries" |
| Error re-submits with same text | role="alert" re-announce acceptable (standard) |
| calendar visible layout | sr-only span adds no visible whitespace |

---

## 7. Security
None.

---

## 8. Acceptance Criteria (amended per §1.2)
1. [ ] 3 chart wrappers: role="img" + sensible computed labels; internals aria-hidden; HistoryChart labels threaded at 6 call sites
2. [ ] Emoji: calendar:152 + days:243/:207/:248 aria-hidden with meaning preserved in text; visible copy unchanged
3. [ ] role="alert" on both error blocks
4. [ ] tsc 0 / lint no new / 794 / build OK
5. [ ] Browser DOM assertions: labels present on /progress, /calendar, /days; tooltips work; visual parity

---

## 9. Open Questions
DA rules: exact label strings; tooltip-vs-aria-hidden; per-call-site label availability; sr-only spacing; icon-wrap layout neutrality.

---

## 10. Test Plan
Gates; greps; live browser DOM assertions (Chrome connected) + visual parity screenshots.

---

## 11. Appendix
Template: ReachMeter.tsx:55-64. Emoji conventions: MarkerIcon.tsx:43-89. role="alert" precedents: 8 sites (signin, ScanFoodSheet, RecapClient, FootageForm, RenderJobPanel ×2, ExerciseRow ×2).
