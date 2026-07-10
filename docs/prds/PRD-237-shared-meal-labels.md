# PRD: Extract shared MEAL_LABELS map (#237)

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-07-10
**Status**: Approved
**GitHub Issue**: #237 (Sprint 13 — Consolidation, a11y & polish)
**Branch**: feature/phase1-auth
**UX-research**: skipped — pure consolidation, zero visual change

---

## 1. Overview

### 1.1 Problem Statement
Meal-type display labels (Preworkout/Breakfast/…/Dinner) are hand-copied across nutrition surfaces and can drift. Define them once, typed against the canonical `MealSlot` vocabulary.

### 1.2 Premise check (2026-07-10, HEAD fe7c868) — AC corrections
| Claim | Verdict |
|---|---|
| Four files declare local `MEAL_LABELS` | **PARTIAL/FALSE** — FIVE duplicate maps under TWO names: `nutrition/page.tsx:26 MEAL_LABEL`, `NutritionToday.tsx:11 MEAL_LABEL` (already `Record<MealSlot,string>`), `LogLauncher.tsx:13 MEAL_LABELS`, `MealEditButton.tsx:11 MEAL_LABELS` (**omitted by the story**). All identical keys+labels; only key order differs (nutrition/page has postworkout 2nd) |
| MealComposer declares a MEAL_LABELS object; its "select" must keep order | **FALSE as written** — it has `MEAL_TYPES: readonly {value,label}[]` (:26-33) driving a CHIP group (:980-996), not a select and not a map. Order preworkout→dinner matches `MEAL_SLOTS`. The array must be DERIVED from the shared map, not replaced by it |
| Home: nutrition-macros.ts or new meal-labels.ts | nutrition-macros.ts confirmed — pure, dual-safe (imported by both server and client consumers already), already imports MEAL_SLOTS/MealSlot from nutrition-plan. No new file |
| Type | `Record<MealSlot, string>` (anchor exists at nutrition-plan.ts:3-12) — compile-time key completeness, beats the AC's `Record<string, string>` |

### 1.3 Success Criteria
One exported `MEAL_LABELS` in nutrition-macros.ts; all five local copies deleted; MealComposer chips derived with identical order/values/testids; visual parity; gates green at 783.

---

## 2. User Stories
| ID | As a... | I want to... | So that... | Priority |
|---|---|---|---|---|
| US-001 | Maintainer | one label map | rename-once, no drift | Must Have |
| US-002 | User | identical labels everywhere | consolidation invisible | Must Have |

---

## 3. Functional Requirements

### 3.1 Core
1. `src/lib/nutrition-macros.ts`: `export const MEAL_LABELS: Record<MealSlot, string>` ordered to match MEAL_SLOTS (safe to iterate).
2. Migrations: nutrition/page + NutritionToday (delete `MEAL_LABEL`, rename usages); LogLauncher + MealEditButton (delete `MEAL_LABELS`); MealComposer (`const MEAL_TYPES = MEAL_SLOTS.map((s) => ({ value: s, label: MEAL_LABELS[s] }))` with `MealType` staying the literal union — anchor to `MealSlot`).
3. Preserve each call site's existing fallback behavior exactly (string-typed data indexing a `Record<MealSlot,…>` needs its current lookup pattern kept).
4. No new tests — the Record type enforces completeness; gates + browser parity verify.

### 3.2 Out of Scope
The untyped vocabulary duplicates in `workout-actions.ts:187` (Set) and `mcp/tools.ts:1682` (z.enum) — value vocabulary, not display labels; MCP schema changes would trigger connector-cache churn.

---

## 4. Technical Design
One shared pure module edit + five consumer edits. No schema/route/MCP changes. Dual-safety preserved (no "use client", no server-only imports in nutrition-macros).

---

## 5. UI/UX
None — labels byte-identical, chip order unchanged.

---

## 6. Edge Cases
| Scenario | Expected |
|---|---|
| Legacy/unknown meal-type string in data | Same fallback rendering as today per call site |
| Chip order | preworkout→dinner (MEAL_SLOTS order — matches current) |
| MealType type | stays the 6-literal union, not string |

---

## 7. Security
None.

---

## 8. Acceptance Criteria (amended per §1.2)
1. [ ] One `MEAL_LABELS` definition (nutrition-macros.ts); FIVE local copies deleted (incl. MealEditButton)
2. [ ] MealComposer chips derived from MEAL_SLOTS + MEAL_LABELS; order/values/testids unchanged
3. [ ] grep: `MEAL_LABEL\b|MEAL_LABELS` → one definition + imports only
4. [ ] tsc 0 / lint no new / 783 tests / build OK
5. [ ] Visual parity: /nutrition headers, Log-sheet meal form, composer chips, meal edit sheet

---

## 9. Open Questions
DA rules: derived-array type inference; Object.entries order dependencies; per-site fallback preservation; MealEditButton import edge.

---

## 10. Test Plan
Gates; greps; browser pass on the four surfaces at phone width.

---

## 11. Appendix
Premise findings inline (§1.2). Canonical vocabulary: nutrition-plan.ts MEAL_SLOTS/MealSlot. Related memory: nutrition-two-edit-paths (unrelated to labels but same surface).
