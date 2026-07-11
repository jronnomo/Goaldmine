# PRD: Back/exit affordances for nav dead-zones (#249)

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-07-11
**Status**: Approved
**GitHub Issue**: #249 (Sprint 13 closer — Consolidation, a11y & polish)
**Branch**: feature/phase1-auth
**UX-research**: skipped — nav-affordance fixes with founder-decided mapping and house idioms; no new visual language

---

## 1. Overview

### 1.1 Problem Statement
Eleven routes light no bottom-nav tab; /compare additionally has no in-page back control. On a phone PWA (no URL bar) that's a disorienting dead zone.

### 1.2 Premise check (2026-07-11, HEAD 176f594) — heavy corrections
| Claim | Verdict |
|---|---|
| 4 dead routes; predicate :57-62 | TRUE but **11 dead routes** (+ goals/history/nutrition in More; + settings/stats/import/workouts not even in More); predicate spans :30-64. Precedent: /recap already lights Progress despite being a More destination |
| /compare needs back control | TRUE (zero affordance; days/[dateKey]:238 `← Calendar` is the idiom) |
| Calendar compare pill lacks exit | **FALSE/STALE** — the pill reads "⇄ Comparing · Cancel" (:258) and handleCompareToggle (:151-159) cancels on click, plus tap-A-again undo. Recorded; NO change |
| /progress lacks /baselines link (More sheet has one) | **PARTIAL** — two CONDITIONAL links exist (RecordsSummary:99/:148, gated >3 tests / >5 exercises); the "More sheet" parenthetical is itself wrong (/baselines is NOT in MoreSheet). Fix = one unconditional link |
| Import pill decision | Pill at page.tsx:271-276 (stale :274-279), no recorded rationale, redundant 4th /import entry |

### 1.3 Founder decisions (recorded per AC-5)
1. **"+ Import" pill: REMOVED from Today's hero.** /import remains reachable via /history (×2) and RecordsSummary's empty state.
2. **Tab mapping — kinship + More**: /compare → Progress (progress-comparison view; /recap precedent); /coach, /journal, /character, /goals, /history, /nutrition → More (their home menu). /settings, /stats, /import, /workouts/[id] stay unlit (not More destinations; documented out of scope).

### 1.4 Success Criteria
All seven mapped routes light the decided tab; /compare has a ≥44px back control; unconditional baselines link on Progress; hero pill gone; compare-mode Cancel untouched; gates green at 799.

---

## 2. User Stories
| ID | As a... | I want to... | So that... | Priority |
|---|---|---|---|---|
| US-001 | PWA user on /coach etc. | a lit nav tab | I always know where I am | Must Have |
| US-002 | /compare visitor | an in-page way back | no browser-back reliance | Must Have |
| US-003 | Low-data user on /progress | a visible path to /baselines | the hub actually links its content | Must Have |

---

## 3. Functional Requirements

### 3.1 Core
1. BottomNav: Progress match + `/compare`; More button gains a match for the six More-menu routes (lit styling on the sheet-trigger; still opens the sheet). Comments updated with mapping + exclusions.
2. compare/page.tsx: `← Progress` link, days idiom, `inline-flex items-center min-h-11` (≥44px tap box).
3. RecordsSummary: unconditional `All baselines →` in the "Tests due" Card action slot (house idiom); conditional mid-list links stay.
4. page.tsx: delete the `+ Import` pill.
5. CalendarMonth: untouched.

### 3.2 Out of Scope
Mapping /settings, /stats, /import, /workouts/[id]; referrer-aware back on /compare (static /progress chosen); MoreSheet content changes.

---

## 4. Technical Design
Client nav predicate + three small JSX edits. No schema/route/MCP changes.

---

## 5. UI/UX
Lit More tab on its menu's pages (new but follows the active-tab visual language); back link on compare; one hero pill removed.

---

## 6. Edge Cases
| Scenario | Expected |
|---|---|
| /goals/[id]/plan, /goals/[id]/metric | More lights (prefix match) — accepted (goals live in More) |
| Compare entered from calendar | Back goes to /progress (static; recorded choice) |
| Brand-new user needing import | RecordsSummary empty state + /history still link /import |
| More sheet open state vs lit state | Lit ≠ open; sheet still opens on tap (DA rules aria) |

---

## 7. Security
None.

---

## 8. Acceptance Criteria (amended per §1.2/§1.3)
1. [ ] Seven routes light per mapping (JS-asserted in browser)
2. [ ] /compare back link, ≥44px tap box, 390px-clean
3. [ ] Unconditional baselines link on Progress
4. [ ] Hero Import pill gone (decision recorded)
5. [ ] AC-3 recorded as already-satisfied (no CalendarMonth change)
6. [ ] tsc 0 / lint no new / 799 / build OK

---

## 9. Open Questions
DA rules: aria semantics for the lit sheet-trigger; prefix-collision acceptance; import-pill removal side effects; back-link layout at 390px.

---

## 10. Test Plan
Gates; browser pass at 390px-equivalent across the seven routes + compare + progress + Today.

---

## 11. Appendix
Founder decisions above. Idioms: days back link (:238), Card action slot (progress:144-147). Related: #244 (calendar verification), MoreSheet destination list (:100-143).
