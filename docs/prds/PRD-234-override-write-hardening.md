# PRD: Harden the day-override write path (#234)

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-07-10
**Status**: Approved
**GitHub Issue**: #234 (Sprint 12 — High-risk structural)
**Branch**: feature/phase1-auth
**UX-research**: skipped — backend validation hardening, zero UI change

---

## 1. Overview

### 1.1 Problem Statement
`upsertDayOverrideFromForm` (day-actions.ts:10-56) persists `workoutJson` after a bare `JSON.parse` — no structural or size validation. Overrides are the per-date source of truth (gotchas §A.1): a malformed row (`42`, `[]`, a 500KB blob) breaks override-aware reads everywhere. The MCP path already enforces `assertDayTemplateWithinSize` + `assertValidDayTemplate` + a baseline-decision guard (applyDayOverrideCore, tools.ts:300-321); the dashboard path enforces nothing.

### 1.2 Premise check (2026-07-10, HEAD 887245d)
| Claim | Verdict |
|---|---|
| Bare JSON.parse, zero validation | TRUE (:22-28) |
| Validators exist (exact AC names, 64KB) | TRUE (day-template-validation.ts:116-150); sole caller = MCP core |
| Raw prisma = scoping bug | **FALSE** — PlanDayOverride is non-scoped by design (§B.9); ownership via scoped program.id. Don't change |
| Route through applyDayOverrideCore viable | Core IS server-safe, but the form has no baselineTestNames affordance and the core drags the full PATCH surface → **shared-helper extraction chosen** (AC permits either) |
| Baseline guard has MCP test coverage to mirror | **FALSE** — zero behavioral tests exist (only mocked away, leaky-reads.test.ts:124-125). We write the guard's FIRST tests |
| Bonus finding | day-actions has a LOCAL naive parseDateKey (:87-90 — local-TZ Date; USER_TZ foot-gun + guard-parity blocker). Fixed in scope; **DA must rule on stored-date semantics for existing rows before the swap ships** (upsert-target risk) |

### 1.3 Success Criteria
Dashboard writes enforce identical validation + guard semantics as MCP (one shared implementation); malformed/oversized JSON rejected pre-write with the validators' field messages in the existing form banner; MCP behavior byte-identical post-refactor; first-ever guard test coverage; gates green.

---

## 2. User Stories
| ID | As a... | I want to... | So that... | Priority |
|---|---|---|---|---|
| US-001 | Dashboard user pasting override JSON | invalid JSON rejected with field-level messages | I can't corrupt my per-date source of truth | Must Have |
| US-002 | The coach via apply_day_override | identical behavior post-refactor | no MCP regression | Must Have |
| US-003 | Dashboard user audibling a workout on a baseline day | be blocked (guard) rather than silently dropping the baseline decision | parity with the covenant the coach lives by | Must Have |

---

## 3. Functional Requirements

### 3.1 Core
1. **`day-template-validation.ts`**: add `assertBaselineDecisionMade({ settingWorkout, baselineInputProvided, existingBaselineTestNames, rotationBaselineNames, dateKey })` throwing the tools.ts:314-318 message VERBATIM (coach voice kept; #235 adds the dashboard affordance later).
2. **`tools.ts` applyDayOverrideCore**: inline guard (:305-321) → helper call; byte-identical behavior (settingWorkout = `workoutValue !== undefined && !== null`; decision-on-file = `Array.isArray(existing?.baselineTestNames)`; trigger only when rotationBaselineNamesForDate(program, date).length > 0). Batch-txn visibility semantics (:4627) unchanged.
3. **`day-actions.ts`**: post-parse `assertDayTemplateWithinSize` then `assertValidDayTemplate` (core's order); pre-read existing override (findUnique like core :244); guard call with `baselineInputProvided: false`; local naive parseDateKey replaced with `@/lib/calendar`'s (subject to DA's stored-date ruling); errors still throw → DayOverrideForm banner (:21-30, :76-80) unchanged.
4. **Tests**: `day-actions.test.ts` (new; house vi.mock db dual-export + mocked getActiveProgram/calendar as needed): malformed-rejected-pre-write, structural-invalid variants, >64KB, valid create/update/delete + revalidatePath, guard matrix (fires / decision-on-file passes / no-rotation-baselines passes / clearing-workout passes). `day-template-validation.test.ts` (new, small): the three asserts incl. the new guard helper.

### 3.2 Out of Scope
Lint-gating overrides (plan-template-only); form baselineTestNames field (#235); PlanDayOverride scoping change; MCP schema/description changes (no connector reload — internal refactor only).

---

## 4. Technical Design
No schema/route/MCP-surface changes. Guard helper is pure (no db) — callers supply the pre-read + rotation names. day-actions keeps raw prisma for the override table (documented-correct) and scoped getActiveProgram for ownership. Dates via @/lib/calendar only (post-fix).

---

## 5. UI/UX
None (existing banner surfaces new messages). AC-mandated.

---

## 6. Edge Cases
| Scenario | Expected |
|---|---|
| Form: workoutJson blank, other fields set | No workout write → settingWorkout false → guard silent (current upsert semantics preserved) |
| Form: all fields blank | deleteMany path unchanged |
| Form: valid JSON, baseline day, no decision on file | Guard throws → banner shows the covenant message |
| Decision already on file (coach set it) | Form write passes; baselineTestNames untouched (form never writes that column) |
| Oversized/circular JSON | Size assert throws pre-write |
| Existing rows written under the old naive date parse | DA ruling: swap must not orphan upsert targets — verify stored `date` semantics first |
| MCP batch ops mid-txn | Guard visibility semantics unchanged |

---

## 7. Security
Validation added, surface unchanged; no new inputs/routes; message contents contain no secrets (rotation baseline names are the user's own data).

---

## 8. Acceptance Criteria
1. [ ] One shared guard implementation; grep shows no duplicated guard logic
2. [ ] MCP before/after: identical rejection messages for invalid + oversized; valid behavior unchanged (curl capture)
3. [ ] Form: invalid JSON variants show field messages in banner; valid saves; guard fires with covenant message (browser)
4. [ ] New tests green: day-actions matrix + validation-helper cases (guard's first-ever coverage)
5. [ ] tsc 0 / lint no new / 680+ tests / build OK
6. [ ] parseDateKey fix shipped per DA ruling (or filed separately with rationale)

---

## 9. Open Questions
DA rules: stored-date semantics vs the parse swap (highest risk); leaky-reads mocks after refactor; form settingWorkout mapping for "blank workout + keep notes".

---

## 10. Test Plan
Gates; new unit suites; MCP curl before/after captures (rejection paths — no data mutation on dev DB); browser /days/[date] form (invalid → banner, valid → save).

---

## 11. Appendix
Premise report: `.feature-dev/2026-07-10-234-override-write-hardening/agents/research-output.md`. Gotchas: §A.1 (override = per-date truth), §B.3/§B.9. Related: #235 consumes these validators next; memory "plan-is-conversational" — the guard enforces the coach covenant, it doesn't auto-resolve.
