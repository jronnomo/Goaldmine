# PRD: Remove meal props + dead layout queries (#233)

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-07-10
**Status**: Approved
**GitHub Issue**: #233 (Sprint 12 — High-risk structural; deps #230 ✅ #232 ✅)
**Branch**: feature/phase1-auth
**UX-research**: skipped — pure deletion/refactor, no new surface

---

## 1. Overview

### 1.1 Problem Statement
layout.tsx runs `getLogSheetData()` (four queries) on EVERY signed-in route render to feed a Log sheet that may never open. Post-#232 the sheet self-fetches — the layout call is pure cold-render tax. Today's page also carries a dead `latestMeasurement` query (written, `void`ed, never rendered).

### 1.2 Premise check (2026-07-10, HEAD c26edc8) — deletion map fully enumerated
- layout: call :109, boundary comment :110-112 (purpose fulfilled — dies), type re-export :10 (zero consumers post-change — dies), getLogSheetData import :7 (dies). Survivors: auth/session :86-93, AppHeader :117, getGoalCount :113, BottomNav goalCount-only.
- BottomNav: 5 meal props pure pass-through (renders no macro UI itself); type collapses to `{goalCount: number}`; TodayMealLite import is from the layout re-export :10 — dies. KEEP latestWeight={null}/onClose/open.
- LogLauncher: prop-seed initializer branch :159-181 collapses to always-idle; the 5 meal props die from type+destructure. **KEEP `latestWeight`** — NOT dead (feeds LogMeasurementForm :262; always-null is pre-existing, out of scope).
- page.tsx: latestMeasurement = slot 0 of a 9-element positional Promise.all tuple (:90-92) + void/comment (:130-131) — re-destructure carefully.
- **AC correction**: "no console hydration warnings" on /compare + /days is unsatisfiable as written — a PRE-EXISTING BottomSheet/Suspense warning exists there (project memory; BottomSheet null-on-first-pass mechanism :78-81). Corrected criterion: **no NEW warnings vs a before-merge baseline** (captured by orchestrator on the pre-change HEAD).
- Tests: log-sheet-data suite (7 tests) exercises the lib fn shared with the API route — unaffected; no test imports the layout re-export or BottomNav (verified).

### 1.3 Success Criteria
Signed-in layout renders with only auth + goalCount work; zero meal queries app-chrome-wide; Log sheet fully self-sufficient (skeleton → data on first open); no new hydration warnings on /, /calendar, /compare, /days; dead query gone; gates green.

---

## 2. User Stories
| ID | As a... | I want to... | So that... | Priority |
|---|---|---|---|---|
| US-001 | Any tenant on any page | pages to cold-render without paying for a sheet I didn't open | app-wide latency win | Must Have |
| US-002 | Log-sheet user | the sheet to work exactly as post-#232 (skeleton → live data, mutation refetch) | no regression from the deletion | Must Have |

---

## 3. Functional Requirements

### 3.1 Core (deletions per §1.2 map)
1. layout.tsx: delete call/import/re-export/boundary-comment + 5 meal props; keep goalCount/auth/AppHeader.
2. BottomNav.tsx: `{goalCount: number}` props; delete meal forwarding + dead type imports; keep latestWeight/onClose/open forwarding.
3. LogLauncher.tsx: delete 5 meal props + prop-seed branch (initializer → `{phase:"idle", data:null}`); delete "until #233" comments; keep latestWeight/open/onClose; effect guard (fetch only on closed→open) must survive intact.
4. page.tsx: delete latestMeasurement query/binding/void/comment with careful positional re-destructure (name the tuple elements at the destructure to prevent off-by-one).

### 3.2 Out of Scope
Wiring latestWeight to real data; #252 nested-dialog; any prefetch optimization (DA may note, don't build).

---

## 4. Technical Design
Pure deletion. No new routes/schema/MCP/server actions. Streaming note: layout awaits less → earlier flush; BottomSheet's null-on-first-pass guard is the hydration mitigation and is untouched.

---

## 5. UI/UX
Only visible change: first sheet-open per page-load shows the #232 skeleton (previously prop-seeded instantly). AC accepts this with a throttled-connection latency check.

---

## 6. Edge Cases
| Scenario | Expected |
|---|---|
| Sheet never opened | Zero meal queries anywhere |
| First open, cold | idle → fetch → skeleton → data; no pre-open fetch (effect guard) |
| /compare + /days cold hydration | No NEW console warnings vs baseline |
| More sheet | goalCount path unchanged (#230) |
| Weight quick-log | latestWeight still wired (null as before) |

---

## 7. Security
Deletion only; no surface changes.

---

## 8. Acceptance Criteria
1. [ ] grep-clean: no todaysMeals/quickPickFoods/libraryFoods/trackedSoFar/dayTarget in layout/BottomNav; no `@/app/layout` type imports anywhere; latestMeasurement gone
2. [ ] Log sheet works post-deletion: first-open skeleton → data; mutation refetch intact (spot-check); composer build-vs-today header correct after MealEditButton edit
3. [ ] Hydration: before/after console comparison on /, /calendar, /compare, /days — no NEW warnings
4. [ ] Throttled sheet-open latency acceptable (no multi-second blank)
5. [ ] tsc 0 / lint no new / 680 tests / build OK

---

## 9. Open Questions
None (deletion map enumerated; DA rules on streaming-shift + tuple-destructure safety).

---

## 10. Test Plan
Gates; orchestrator before/after browser console comparison + throttled open check; greps per AC-1.

---

## 11. Appendix
Deletion map: `.feature-dev/2026-07-10-233-layout-fetch-deferral/agents/research-output.md`. Boundary comments from #230/#232 fulfilled and removed by this story.
