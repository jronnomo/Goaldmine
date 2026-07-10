# PRD: Recap empty-week guard + preview-failure fallback (#231)

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-07-09
**Status**: Approved (model set corrected vs AC — technical fix, same deliverable shape)
**GitHub Issue**: #231 (Sprint 11 closer, P1)
**Branch**: feature/phase1-auth
**UX-research**: skipped — empty-state/error-state guards on an existing surface

---

## 1. Overview

### 1.1 Problem Statement
/recap always mounts the preview `<img>` (`/recap/card?...`, RecapClient.tsx:207-215) — for a week with nothing to recap this wastes a full uncached satori/resvg render (route is force-dynamic, route.tsx:6) and shows a zero-card; and there is no `onError` handler, so a genuine render failure leaves a broken image with the "Loading…" overlay stuck forever (only onLoad clears it).

### 1.2 Premise check & correction (2026-07-09, HEAD 4cf6825)
| Claim | Verdict |
|---|---|
| 13-week window, plain-offset client contract, getDb, USER_TZ helpers | TRUE (page.tsx:16-29, 48-57, CRIT-2 comments) |
| No onError today; Loading overlay hangs on failure | TRUE (RecapClient.tsx:213-214 — only onLoadStart/onLoad) |
| Empty week → broken image | **FALSE** — card route 200s with a zero-card (computeWeeklyRecap never throws, recap.ts:686-732; RecapCard has no emptyWeek branch). onError is for RENDER failures; empty weeks need the skip-mount path. Two distinct guards. |
| 4-model bucket (workout/hike/nutritionLog/baseline) | **MISMATCHED** — recap never reads nutritionLog (zero hits in recap.ts); it DOES read project logEntry/scheduledItem (recap.ts:367-393). AC's set over-counts nutrition-only weeks and hides project-activity weeks. **Corrected set: workout, hike, baseline, logEntry, scheduledItem.** PRs/badges covered transitively (in-window PR implies in-window workout). |

### 1.3 Success Criteria
Empty week → "Nothing to recap yet" copy, ZERO requests to /recap/card; data week unchanged; render failure → friendly fallback + retry, overlay cleared; gates green.

---

## 2. User Stories
| ID | As a... | I want to... | So that... | Priority |
|---|---|---|---|---|
| US-001 | New user opening /recap | see friendly copy for my empty weeks, not a spinner-then-zero-card | first-run isn't confusing, server skips a wasted render | Must Have |
| US-002 | Any user hitting a transient render failure | see a fallback with Retry instead of a broken image + stuck overlay | recoverable, not dead-ended | Must Have |
| US-003 | Project-goal user with milestone-only weeks | still get my card | the emptiness signal matches what the card renders | Must Have |

---

## 3. Functional Requirements

### 3.1 Core
1. **page.tsx**: one query per model across `[mondays[12], endOfWeekSunday(mondays[0])]` selecting only the date column — workout (status completed, startedAt), hike (completed, date), baseline (date), logEntry (date), scheduledItem (completedAt non-null in window). Bucket in JS to offsets via the postedWeeks pattern (dateKey-of-startOfWeekMonday vs mondays) → deduped `weeksWithData: number[]` → prop to RecapClient. `getDb()` only; plain numbers only (CRIT-2).
2. **Pure helper**: extract `bucketDatesToWeekOffsets(dates: Date[], mondays: Date[]): number[]` (placement per DA — client-safe lib file) + unit test in house conventions; page uses it for both postedWeeks (refactor-in-place OK if trivially safe) or at minimum for weeksWithData.
3. **RecapClient.tsx**: `weeksWithData` prop; `hasData = weeksWithData.includes(offset)`. `!hasData` → empty card copy ("Nothing to recap for this week yet — log a workout, hike, or project progress and this card fills in."), NO `<img>` mount, share-only controls hidden (DA prescribes exact set), week nav stays. `onError` → `imageFailed` state → fallback ("Preview couldn't render.") + Retry button (cache-busting param, capped attempts per DA), clears `imageLoading`.

### 3.2 Out of Scope
recap.ts emptyWeek semantics (caption-tested separately); card-route changes; caching the card route.

---

## 4. Technical Design
No schema/MCP/server-action changes. Server component queries via getDb(); week math via existing calendar-core helpers only. Client gets numbers/strings only.

---

## 5. UI/UX (390px)
Empty card: same frame/aspect slot as the preview, muted copy, no controls that imply a shareable card. Failure card: same slot, copy + accent Retry button.

---

## 6. Edge Cases
| Scenario | Expected |
|---|---|
| Monday morning, nothing logged this week | offset 0 empty → copy reads naturally for a just-started week (DA-approved copy) |
| posted week (shared_recap) ∩ no activity data | weeksWithData governs img mount; posted badge unaffected (DA ruling) |
| Founder (data-rich): no empty weeks in window | UI unchanged everywhere; verified via minted empty user |
| Retry loops | capped; each retry cache-busts |
| Zero-goal brand-new user | all 13 weeks empty → copy on every week, zero card requests |

---

## 7. Security
No new inputs/routes; scoped queries; date-only selects minimize payload.

---

## 8. Acceptance Criteria
1. [ ] weeksWithData computed from the corrected 5-model set, single query per model, USER_TZ bucketing; helper unit-tested
2. [ ] Empty week: copy shown, zero /recap/card requests (network-verified)
3. [ ] onError fallback + Retry; loading overlay cleared on error
4. [ ] Data week byte-equivalent behavior (card renders as before)
5. [ ] tsc 0 / lint no new / tests ≥664 green / build OK

---

## 9. Open Questions
None (model-set correction decided; DA rules on posted∩empty, control-hiding set, retry cap, helper placement).

---

## 10. Test Plan
Gates; new helper unit test; browser 390px: founder data week (card ok), minted empty user (copy + zero card requests via server log/network), temp bad-src patch for onError (reverted).

---

## 11. Appendix
Premise report: `.feature-dev/2026-07-09-231-recap-guards/agents/research-output.md`. Audit-sibling corrections: #227 false, #228 weakened, #229 amended, #230 gate-fixed, #231 model-set-corrected.
