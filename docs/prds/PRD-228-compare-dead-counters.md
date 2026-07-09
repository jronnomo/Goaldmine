# PRD: Render compare's dead counters + small UI gaps (#228)

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-07-09
**Status**: Approved
**GitHub Issue**: #228 (Sprint 11 — Feature correctness, P2; dep #227 ✅ closed; unblocks #229)
**Branch**: feature/phase1-auth
**UX-research**: skipped — bug fixes / small UI gaps on an existing surface

---

## 1. Overview

### 1.1 Problem Statement
Four small correctness/UX gaps on `/compare`: (1) `between.notesLogged` and `between.baselineTestsLogged` are computed on every load (`src/lib/compare.ts:391-392`) but never rendered; (2) the date inputs lack a `max` bound so the browser lets users pick future dates (server clamps, but the round-trip is wasted); (3) same-day selection reads as a dead end ("0 days of showing up." / "Same day selected."); (4) a `computeComparison` failure falls through to the generic root error boundary instead of a compare-scoped, recoverable message.

### 1.2 Premise check (lesson from #227 — verified against code 2026-07-09)
| AC | Verdict | Evidence |
|---|---|---|
| Dead counters | **CONFIRMED** | computed `compare.ts:391-392`, typed `compare-core.ts:273-274`, absent from grid `page.tsx:283-303`; `notesLogged` counts only journal/audible/feedback (`compare.ts:363`) — private note types excluded, leak-safe to render |
| Missing `max` | TRUE (client-side gap only) | inputs `page.tsx:223-237`; `todayKey` already at `:145`; server clamp works (`compare-core.ts:215-222`) |
| sameDay dead-end | TRUE (soft zero-state, no crash) | `HeroSpan.tsx:67,69` |
| Unhandled throw | **WEAKENED** | root `src/app/error.tsx` catches; URL params regex-gated (`page.tsx:150-155`); only infra errors can throw. Shipping the scoped error card anyway — better UX than the generic boundary; recorded honestly |
| Bonus | stale `aria-label` (`page.tsx:285`) omits mi hiked + Level; must enumerate all tiles incl. the two new ones |

### 1.3 Success Criteria
New tiles visible in "The work between"; future dates unpickable in the browser; same-day shows an actionable nudge; comparison failure renders a recoverable card with the picker intact; all gates green; 390px verified for the three AC5 scenarios.

---

## 2. User Stories

| ID | As a... | I want to... | So that... | Priority |
|----|---------|--------------|------------|----------|
| US-001 | Any tenant | see notes + baseline tests I logged in the compared window | my logged work actually shows up in "The work between" | Must Have |
| US-002 | Any tenant | be unable to pick a future date | I don't submit a form that gets silently clamped | Should Have |
| US-003 | Any tenant | get a nudge when I pick the same day twice | I know how to get a useful comparison | Should Have |
| US-004 | Any tenant | see a friendly, recoverable error if the comparison fails | I can pick different dates without losing the page | Should Have |

All tenants; no founder-only surface; zero-row users see 0-count tiles (StatTile handles numeric 0 fine).

---

## 3. Functional Requirements

### 3.1 Core
1. Two StatTiles appended to the `grid grid-cols-3 gap-2` in "The work between" (`page.tsx:283-303`): `baseline tests` = `formatValue(between.baselineTestsLogged, "")`, `notes` = `formatValue(between.notesLogged, "")` — matching the existing count-tile pattern; card `aria-label` rewritten to enumerate all eight stats.
2. `max={todayKey}` on both date inputs (name="a", name="b").
3. `HeroSpan.tsx` sameDay branch: replace the "0 days of showing up." + "Same day selected." pairing with one actionable line, e.g. "Same day on both sides — pick an earlier start date to see progress." Other branches (Dates reordered / Future date clamped) untouched.
4. `computeComparison` call (`page.tsx:158-167`) wrapped so a thrown error renders a compare-scoped friendly `<Card>` WITH the date-picker form still functional (recovery path). Server component stays server; no rethrow.

### 3.2 Secondary
None.

### 3.3 Out of Scope
Cumulative-rows sub-heading polish; Level-tile formatting inconsistency; any change to the counters' queries (`compare.ts` untouched); #229's goal-kind gating.

---

## 4. Technical Design

### 4.1 Data Model
N/A.

### 4.2 MCP Tool Surface
N/A — `compare_dates` already returns these fields in its JSON; only the web rendering changes. No connector reload.

### 4.3 Server Actions
N/A — GET form, no mutations.

### 4.4 Pages / Components
- `src/app/compare/page.tsx` (server component): tiles, aria-label, max attrs, error-path branch. The error path must NOT destructure `result` fields it doesn't have — render a standalone recovery layout (hero-less: friendly Card + the picker form with `defaultValue`s from the raw/normalized params it does have).
- `src/components/compare/HeroSpan.tsx`: sameDay copy swap.

### 4.5 Date / Time Semantics
`todayKey` already derived via `dateKey(new Date())` (`page.tsx:145`) — reused, no new date math.

### 4.6 Deferral / Override Awareness
N/A.

### 4.7 Tenant Scoping & Auth
No query changes; `notesLogged` leak posture verified unchanged (private types excluded at the query, `compare.ts:359-363`).

### 4.8 Third-Party Dependencies
None.

---

## 5. UI/UX Specifications

### 5.1 Screens (390px)
"The work between" grid grows from 6 to 8 tiles (3-col wrap → rows of 3/3/2). Error state:
```
┌──────────────────────────────┐
│  Couldn't build this         │
│  comparison.                 │
│  Try again or pick different │
│  dates.                      │
│  [From][To][Go]              │
└──────────────────────────────┘
```
Same-day hero: date heading unchanged; subtitle = the nudge line.

### 5.2 Navigation
Unchanged.

### 5.3 Responsive
Existing tokens/components only; tiles wrap naturally in the 3-col grid; no hardcoded colors.

### 5.4 Accessibility
aria-label completeness is part of AC1; error card heading readable; date inputs keep labels.

---

## 6. Edge Cases

| Scenario | Expected |
|---|---|
| Zero-row user | tiles render 0s; no crash |
| sameDay + clampedToToday together | nudge line + clamp line both render (independent branches) |
| computeComparison throws | recovery card + working picker; no white screen; root boundary NOT hit |
| Future date typed manually despite max | server clamp still applies (unchanged) |

---

## 7. Security
No new inputs beyond `max` attr; no query changes; leak posture verified (§4.7).

---

## 8. Acceptance Criteria
1. [ ] Two new tiles render with correct values; aria-label enumerates all eight stats
2. [ ] Both inputs carry `max={todayKey}`
3. [ ] sameDay renders the nudge; "0 days of showing up." no longer appears for sameDay
4. [ ] Simulated `computeComparison` throw renders the recovery card with a functional picker (verified in dev via temporary local patch, screenshot captured, patch reverted)
5. [ ] tsc 0 / lint no new / tests green / build OK
6. [ ] 390px screenshots: normal compare (tiles), sameDay (nudge), error card

---

## 9. Open Questions
None.

---

## 10. Test Plan
Gates + browser walkthrough at 390px (three scenarios per §8.6). No new unit suites (JSX/copy only); full Vitest must stay green. MCP: N/A.

---

## 11. Appendix
Premise-check report: `.feature-dev/2026-07-09-228-compare-dead-counters/agents/research-output.md`. Related: #227 disproof (same audit), `docs/roadmap/audit-fixes-backlog.md` Sprint 11.
