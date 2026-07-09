# PRD: Onboarding re-entry + calendar first-run state (#230, bundles #248)

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-07-09
**Status**: Approved
**GitHub Issues**: #230 (Sprint 11, P1) + #248 (Backlog — React.cache goal-count dedupe, bundled)
**Branch**: feature/phase1-auth
**UX-research**: skipped — empty-state/nav parity fixes matching existing voice

---

## 1. Overview

### 1.1 Problem Statement
A 0-goal user who dismissed Today's onboarding card (30-day cookie `gm_onboarding_dismissed_<uid.slice(0,16)>`, onboarding-actions.ts:23-30) has no nav route back to the **guided** onboarding flow (`/onboarding` incl. the Claude-connect step) — only the raw GoalCreateForm via More → Goals. And `/calendar` shows a bare empty grid to first-run users while every sibling page has a friendly empty state (its only hint is a "No active plan" line BELOW the grid, calendar/page.tsx:133-137).

### 1.2 Premise check (verified 2026-07-09, HEAD 275acd7)
| Claim | Verdict |
|---|---|
| layout.tsx has signed-in DB query pattern to extend | TRUE — `auth()` guard :120-136 (signed-out early-return, no queries), `getDb()` + Promise.all :139-164 (4 meal fetches), props to BottomNav :196-202 |
| BottomNav→MoreSheet prop chain exists | TRUE, both "use client"; MoreSheet gets only `onClose` today (:193); navRows is a module const :97-146 → conditional row must build in-component |
| No nav path back to onboarding | **WEAKENED** — /goals renders GoalCreateForm unconditionally (goals/page.tsx:90-94). Real gap = guided-flow re-entry → row links `/onboarding` (AC permits either) |
| Calendar bare grid for first-run | TRUE — grid always renders (:66-72); `!program` line below (:133-137); AC's gate var is `!goal` (distinct from `program` — both from getCalendarMonth :20) |
| Sequencing | #233 (N2 layout-fetch-deferral) OPEN, not in flight; #230 lands first, N2 rebases. **#248 flag**: naive #230 = 2× goal.count() per `/` request (layout + Today gate page.tsx:38) — #248's own prescription (cache()-wrapped helper) bundled here |

### 1.3 Success Criteria
0-goal user sees "Set up your first goal" atop the More sheet (cookie-independent) and a Get-started card above the calendar grid; goal-having users see neither; exactly ONE goal-count query per `/` request; gates green.

---

## 2. User Stories
| ID | As a... | I want to... | So that... | Priority |
|---|---|---|---|---|
| US-001 | 0-goal user who dismissed the Today card | re-enter guided onboarding from the More sheet | I'm not stranded with only the raw goal form | Must Have |
| US-002 | 0-goal user on /calendar | see a friendly get-started card, not a bare grid | first-run parity with sibling pages | Must Have |
| US-003 | Any user with goals | see zero change | no noise for established users | Must Have |

---

## 3. Functional Requirements

### 3.1 Core
1. **`src/lib/goal-count.ts` (new)**: `getGoalCount = cache(async () => (await getDb()).goal.count(<match Today-gate where-clause EXACTLY — verify page.tsx:38's filter and replicate>))`. (#248.)
2. **`src/app/layout.tsx`**: add `getGoalCount()` to the signed-in Promise.all; thread `goalCount` → BottomNav. Signed-out path untouched.
3. **`src/app/page.tsx`**: gate count at :38 switches to `getGoalCount()` (dedupe; identical behavior).
4. **`src/components/BottomNav.tsx`**: `goalCount: number` prop → `<MoreSheet onClose goalCount>`.
5. **`src/components/MoreSheet.tsx`**: when `goalCount === 0`, a "Set up your first goal" row above navRows.map — label "Set up your first goal", sub "Guided setup — goal, targets, and your Claude coach", `href="/onboarding"`, house row markup/min-h-11/onClose-on-click like existing rows; cookie-independent.
6. **`src/app/calendar/page.tsx`**: when `!goal`, `<Card title="Get started">` ABOVE the grid, voice-matched to Today's card (page.tsx:53-70), copy adapted ("…your calendar fills in as you log."), CTA `Get started →` `/onboarding`; suppress the old `!program` line when `!goal` (keep for goal-present/no-program).

### 3.2 Out of Scope
#233's fetch removal; onboarding flow internals; #231.

---

## 4. Technical Design
Data model N/A · MCP N/A · Server actions N/A (row is a Link; no mutation) · New route N/A.
- **React.cache**: layout + page render in one RSC request tree → cache() memoizes across both call sites per request. DA to verify no noStore/dynamic interplay quirk.
- Tenant scoping: helper uses `getDb()` (scoped) — signed-in-only call sites.
- Dates: none.

---

## 5. UI/UX (390px)
MoreSheet row: identical row anatomy to existing navRows (icon, label, sub, chevron if present), inserted first; visually distinct only by content. Calendar card: same Card/typography as Today's get-started. No BottomNav badge/dot (out of scope).

---

## 6. Edge Cases
| Scenario | Expected |
|---|---|
| 0-goal, no dismissal cookie | Today gate still redirects to /onboarding (unchanged); row also present in MoreSheet on other pages |
| Signed-out | Layout early-return; BottomNav absent; helper never called |
| goalCount>0 | Row absent; calendar unchanged; layout adds one memoized count |
| goal null, program null | New card above grid; old bare line suppressed |
| goal present, program null | Old "No active plan" line preserved |
| MoreSheet hydration warning | Pre-existing (memory) — not caused here |

---

## 7. Security
No new inputs/routes; count is scoped via getDb(); no data rendered beyond a boolean-ish count.

---

## 8. Acceptance Criteria
1. [ ] Exactly one goal.count per `/` request (helper used by both layout + page gate; where-clause parity verified)
2. [ ] MoreSheet 0-goal row (cookie-independent) links /onboarding; absent when goalCount>0
3. [ ] Calendar 0-goal: Get-started card above grid; bare line suppressed; goal-present rendering unchanged
4. [ ] tsc 0 / lint no new / 664 tests green / build OK
5. [ ] 390px checks: founder (no row, calendar unchanged) + minted 0-goal user (row + card)

---

## 9. Open Questions
None (target=/onboarding and #248 bundling decided; DA sanity-checks cache semantics).

---

## 10. Test Plan
Gates; browser via dev-server with minted sessions (founder + fresh 0-goal user on dev DB, cleaned up after — established technique). No new unit suites unless trivially fitting existing db-mock conventions.

---

## 11. Appendix
Premise report: `.feature-dev/2026-07-09-230-onboarding-reentry/agents/research-output.md`. Siblings: #227 (false), #228 (weakened), #229 (amended). Sequencing: #233 rebases on this; #248 closed by this.
