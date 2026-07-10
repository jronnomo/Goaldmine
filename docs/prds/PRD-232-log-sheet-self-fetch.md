# PRD: GET /api/log-sheet-data + LogLauncher self-fetch (#232)

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-07-10
**Status**: Approved
**GitHub Issue**: #232 (Sprint 12 — High-risk structural; dep #230 ✅; blocks #233)
**Branch**: feature/phase1-auth
**UX-research**: skipped — data-plumbing refactor; only UI is loading/error states inside an existing sheet

---

## 1. Overview

### 1.1 Problem Statement
The Log sheet's data (today's meals, quick-picks, library, macro totals/targets) is threaded from layout.tsx's per-request fetch (layout.tsx:142-165 → BottomNav → LogLauncher). Meal mutations DO call `revalidatePath("/", "layout")` (workout-actions.ts:269-341) but that only applies at the next navigation — an open sheet renders stale props mid-session. LogLauncher is mounted on every route regardless of sheet state (BottomSheet's SSR guard is portal-only, BottomSheet.tsx:81), so props never refresh while the user logs/edits meals in place.

### 1.2 Premise check (2026-07-10, HEAD f0dc7ff) — ACs verified sound
| Claim | Verdict |
|---|---|
| Stale props on open sheet | TRUE (nuance: revalidatePath fires but only applies next navigation) |
| LogLauncher fully mounted on every route; SSR guard portal-only | TRUE (BottomSheet.tsx:81; no `open &&` guard at BottomNav.tsx:173-187) |
| TodayMealLite lives in layout.tsx, imported by client components | TRUE (defined :57-71; importers: BottomNav.tsx:10, LogLauncher.tsx:10 only; MealEditButton has its own structural type) |
| Payload JSON-safe | TRUE (dateISO already stringified layout.tsx:180; no other Dates) |
| Props already optional → #233 compile contract holds | TRUE (BottomNav.tsx:80-87, LogLauncher.tsx:34-46) |
| **Structural first**: no session-authed JSON route exists | TRUE — this route establishes the pattern |

### 1.3 Success Criteria
Sheet always shows live data (fetch on every closed→open; refetch after in-sheet mutations); route session-authed (401 JSON unauthed); no layout shift while loading; failure shows inline retry; layout/BottomNav keep compiling with props (until #233); gates green.

---

## 2. User Stories
| ID | As a... | I want to... | So that... | Priority |
|---|---|---|---|---|
| US-001 | Any tenant logging meals | see the sheet's list/totals update immediately after logging or editing | no stale macro math mid-session | Must Have |
| US-002 | Any tenant on a flaky connection | get a retry affordance, not a blank sheet | recoverable | Must Have |
| US-003 | The #233 story (as a consumer) | LogLauncher self-sufficient without props | layout's meal fetch becomes deletable | Must Have |

---

## 3. Functional Requirements

### 3.1 Core
1. **`src/lib/log-sheet-data.ts`** (new shared server module): relocated `TodayMealLite` (unchanged); `LogSheetData` type; `getLogSheetData()` = the exact layout pipeline (nutritionLog.findMany [startOfDay(now), endOfDay(now)] same select/orderBy; getQuickPickFoods; listLibraryFoods; resolveDay(now); dateISO meal mapping; sumLoggedDayMacros/sumPlanTargetMacros/hasAnyMacros). Unit test with house db-mock conventions (window bounds, dateISO, null-collapse).
2. **`src/app/layout.tsx`**: meal block replaced by one `getLogSheetData()` call; props to BottomNav same shape; goalCount statement + #233 boundary comments preserved; type import updated.
3. **`src/app/api/log-sheet-data/route.ts`** (new): GET, nodejs, force-dynamic, `Cache-Control: no-store`; `auth()` → 401 JSON; `runWithUser(session.user.id, …)` → `Response.json(await getLogSheetData())`. NEVER getCurrentUserId (redirect→307 hazard, current-user.ts:25-30). Route stays OFF isPublicPath (middleware cookie-gate + handler auth = two layers).
4. **`src/components/LogLauncher.tsx`**: optional `open?: boolean`; fetch on each closed→open (AbortController; latest-wins guard); props as initial data; local state is the single render source; skeleton sized to meal-list+macro-line (no shift); inline error + Retry; refetch after in-sheet mutations (see 5 + architect's map of LogNutritionForm submit).
5. **`src/components/MealEditButton.tsx`**: optional `onMutated?()` after save AND delete; LogLauncher wires it to refetch. NutritionToday usage unaffected.
6. **`src/components/BottomNav.tsx`**: pass `open={logOpen}`; nothing else changes.
7. **`src/lib/auth/route-access.test.ts`**: `/api/log-sheet-data` added to PROTECTED_CASES.

### 3.2 Out of Scope
#233's prop/fetch removal from layout+BottomNav; rate-limit bucket (no precedent for authed app reads); caching the route; MCP surface (untouched).

---

## 4. Technical Design
- **Auth pattern (new precedent)**: `auth()` + explicit 401 + `runWithUser` ALS scoping. Middleware's optimistic cookie gate is presence-only — handler auth is authoritative.
- **Serialization**: payload already JSON-safe (verified §1.2).
- **Dates**: pipeline uses startOfDay/endOfDay from @/lib/calendar (moved verbatim); no new date math.
- **Tenant scoping**: getLogSheetData uses getDb() under the caller's ALS (layout: implicit session context; route: runWithUser).
- Server actions: none new; MealEditButton's callback is client-side.

---

## 5. UI/UX (390px)
Skeleton: fixed-height placeholder rows matching the meal list + macro line (no layout shift). Error: inline text + accent Retry within the sheet body. Everything else visually unchanged.

---

## 6. Edge Cases
| Scenario | Expected |
|---|---|
| Rapid open/close/reopen | Aborted stale fetches; latest-wins; no flash of older data |
| First open right after navigation (fresh props) | Fetch still fires (AC: EVERY open); props render instantly as initial data, fetched data replaces (identical → no visible change) |
| 401 mid-session (expired) | Error state with retry (and sign-in hint per architect) |
| Zero meals (new user) | Empty-list state as today; totals zeroed |
| In-sheet log/edit/delete | Refetch; list + totals update in place with sheet open |
| Unauthed curl | 401 JSON (handler), 307 (middleware, no cookie) — both acceptable layers |

---

## 7. Security
Read-only GET, same-origin, session-authed at the handler; scoped queries; no PII in URL; no new public surface (protected by default).

---

## 8. Acceptance Criteria
1. [ ] Route returns 401 JSON unauthed; correct full shape authed (curl-diffed against layout's computation)
2. [ ] Fetch fires on EVERY closed→open transition (network-verified)
3. [ ] In-sheet edit/delete/log refetches — list + macro line update without navigation (THE bug, demo'd in browser)
4. [ ] Skeleton no-layout-shift; error + Retry on failure
5. [ ] LogLauncher renders correctly with NO props (self-sufficiency — verified via a test render or temporary prop-less mount in dev)
6. [ ] layout/BottomNav compile unchanged in shape; #233 boundary comments intact
7. [ ] tsc 0 / lint no new / tests 672+ green (incl. new log-sheet-data + route-access cases) / build OK

---

## 9. Open Questions
Architect to resolve: LogNutritionForm submit path (does it close the sheet? wire refetch accordingly); 401-mid-session UX copy; skeleton exact markup.

---

## 10. Test Plan
Gates; unit tests (pipeline + route-access); curl (401 + authed shape); browser at 390px: open sheet (fetch+skeleton), log meal, edit meal (in-place update), network-off retry.

---

## 11. Appendix
Premise report: `.feature-dev/2026-07-10-232-log-sheet-self-fetch/agents/research-output.md`. #233 rebases on this. Sprint 11 lesson: premise-check held clean for the first time this queue.
