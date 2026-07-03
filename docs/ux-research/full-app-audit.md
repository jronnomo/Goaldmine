# Goaldmine — Full-App Audit (v2, post-multiuser + compare)

_Date: 2026-07-02. Supersedes the 2026-05-31 single-user audit (see git history of this file). Re-run after 394 commits shipped the Phase 0/1 multiuser stack (Auth.js + invite gate + OAuth 2.1 server + onboarding), the compare feature, the nav overhaul, the nutrition composer, and the game/recap surfaces — all now in production._

Scope: 33 routes under `src/app/**` (up from 22), the global shell (`AppHeader` + `SessionMenu` + `BottomNav` + `LogLauncher`/`MoreSheet` sheets), the new auth/OAuth/onboarding surfaces, `/compare` + calendar compare mode, and the full core-screen inventory. Every claimed problem cites `file:line`. Mobile-first target ≤390px.

---

## Part 1 — Fate of the 2026-05-31 findings

| # | Prior finding | Verdict | Evidence |
|---|---------------|---------|----------|
| P1/P2 | Nav hides screens; label mismatches | **Fixed** (2 stragglers) | Agreed Today·Plan·Log·Progress·More model fully built (`BottomNav.tsx:33-68`); MoreSheet covers Character/Goals/Coach/Recap/Compare/Nutrition/History/Journal (`MoreSheet.tsx:97-146`). Stragglers: `/stats` and `/baselines` — see N1. |
| P3 | Inconsistent form feedback | **Fixed** | Shared `useFormFeedback` hook codifies pending→success-flash→reset+error (`src/lib/use-form-feedback.ts:48-75`); adopted by LogMeasurement/LogNote/LogBodyMetric/MealComposer. Gap: LogBaseline forms don't use it. |
| P4 | Today flat, no completion, celebration unwired | **Fixed** | Hero section + QuestCard ribbon (`page.tsx:264-310`); derived completion (`page.tsx:190-212`); `bullseye-pop` wired via TodayCelebration inside QuestCard (`QuestCard.tsx:41,67`, `TodayCelebration.tsx:27-40`); rest-day variant (`page.tsx:284,304-309`); raw malformed-plan string removed. |
| P5 | No loading/error scaffolding | **Partial** | Good root `loading.tsx` + `error.tsx` (Next 16 `unstable_retry`) exist — but **only at root**; no per-route boundaries for heavy pages (/progress, /calendar, /nutrition, /recap). |
| P6 | Calendar density + duplicate day panel | **Fixed** | Compact grid + single `DayDetail` preview panel (`CalendarMonth.tsx:3-10,341-345`); duplicate panel gone. Residual density flags remain in-code (see N16). |
| P7 | Duplicated Stat/pill primitives | **Still open** | `StatTile.tsx` exists but has exactly one consumer (`compare/page.tsx`); local duplicates persist in `calendar/page.tsx:142`, `progress/page.tsx:259`, `stats/page.tsx:159`, `baselines/page.tsx:166`, `RecordsSummary.tsx:188`, `MilestoneBurnDown.tsx:111`. |
| P8 | A11y gaps | **Mixed** | Focus-visible rings now broad; colorblind-safe redundancy on calendar (`CalendarMonth.tsx:513-524`). Open: shell 36px targets (`ThemeToggle.tsx:51`, `SessionMenu.tsx:73`, `BottomSheet.tsx:112`), charts lack `role="img"` (`WeightChart`/`ReadinessChart`/`HistoryChart`; bare `aria-label` div at `progress/page.tsx:177,242`), unlabeled 🏔️ at `calendar/page.tsx:129` + `days/[dateKey]/page.tsx:242`. |
| P9 | Split logging rhythm | **Fixed** | Log tab → LogLauncher sheet: Weight · Body metric · Meal · Note · Import (`LogLauncher.tsx:69-113,224-237`), fed live day context. |
| P10 | Cryptic theme toggle, thin brand | **Fixed** | Descriptive aria-label (`ThemeToggle.tsx:42`); Bullseye motif now coherent across nav caps, WeekRail, celebration, MoreSheet. Minor: theme control duplicated in header + MoreSheet. |
| — | DayOverrideForm raw JSON (noted, unranked) | **Still open** | Unchanged 12-row `workoutJson` textarea (`DayOverrideForm.tsx:33-42`) — see N10. |

Net: 7 of 10 fixed as designed. Open carry-overs: per-route loading states (P5), primitive adoption (P7), chart/tap-target a11y (P8), the raw-JSON override editor.

---

## Part 2 — Priority-ranked new findings

| # | Finding | Severity | Area |
|---|---------|----------|------|
| N1 | **`/stats` is a live, orphaned, drifting duplicate of `/progress`.** Zero inbound links anywhere in `src` (only the BottomNav active-match at `BottomNav.tsx:59`); near-verbatim copy of the Readiness/Weight/BodyMetrics blocks (`stats/page.tsx:13-33` ≈ `progress/page.tsx:16-32`). The Progress merge never deleted the old page. Delete + redirect. | High | IA / debt |
| N2 | **`layout.tsx` blocks first paint of every route with 4 DB fetches for a closed sheet.** RootLayout awaits today's meals, quick-picks, the **entire food library** (`listLibraryFoods()`, unbounded), and `resolveDay(now)` (`layout.tsx:139-164`) solely to hydrate the Log sheet's meal composer. Every page — /coach, /recap, /calendar — pays this before `<main>` streams, and root `loading.tsx` can't mask layout-level work. `resolveDay` + today's nutrition are then re-fetched by `page.tsx:89-128` on the home route. | High | Performance |
| N3 | **`/signin` swallows every auth error.** The page reads only `next`/`callbackUrl`/`invite` (`signin/page.tsx:10,15`) — no `?error=` handling. Google denial, `OAuthAccountNotLinked`, or provider misconfig lands the user back on a pristine card with zero explanation. | High | Multiuser |
| N4 | **Invite redemption is link-only and rejection is a leaky dead-end.** No field to type a code on `/signin` or `/request-access` (only `?invite=` URL param, `auth-actions.ts:18`); the "Invite code detected ✓" chip validates nothing (`signin/page.tsx:49-53`) — garbage codes show green then fail after the full Google round-trip; rejection lands on a generic `/request-access` whose only recourse is a `mailto:` to the founder's **personal Gmail** (`request-access/page.tsx:43`). | High | Multiuser |
| N5 | **`/settings` has no account section.** Connected-apps only: no signed-in email/name display, no sign-out (header SessionMenu only), no delete-account, no data export (`settings/page.tsx`). Multiuser table stakes missing; the H1 "Settings" over-promises. | High | Multiuser |
| N6 | **Founder context leaks into every user's app.** "Summit Mt. Elbert" is the first-goal placeholder for all new users (`OnboardingGoalForm.tsx:94`); Coach prompts hardcode "my Mt. Elbert goal" (`coach/page.tsx:59`), assume a single active goal (`:87`), and reference repo doc paths + claude.ai routines (`coach/page.tsx:154-164`, `CoachNudges.tsx:102`); request-access exposes the personal Gmail (N4). | High | Multiuser |
| N7 | **Compare's "as of end-of-day" semantic is never communicated on the page.** The data layer is strictly snapshot-as-of (`compare.ts:39-40`) and the MCP tool description says so (`tools.ts:1231-1232`), but the UI shows bare "A → B" values with no cue they're carried latest-known values, not that-day readings. | High | Compare |
| N8 | **Compare readiness is not guaranteed byte-identical to `/progress` for today.** Same `computeReadiness`, different `asOf`: compare uses `endOfDay(dateB)` (`compare.ts:40`), progress uses `new Date()` (`progress/page.tsx:41`). Diverges for any data timestamped later-today. Touches the CLAUDE.md invariant. | Medium | Compare |
| N9 | **Recap has no zero-data or preview-error state.** `RecapClient` always mounts `<img src="/recap/card…">` with a spinner but no `onError` and no "nothing to recap yet" guard (`RecapClient.tsx:197-207`) — a new user's first impression of the share feature is whatever the card route draws for an empty week, or a broken image. | Medium | New user |
| N10 | **DayOverrideForm is still a raw JSON textarea** (`DayOverrideForm.tsx:33-42`) with only raw server-error echo — while `WorkoutEditor` and `TargetsBuilder` prove structured editors exist in-app. The primary "edit today" surface remains phone-hostile. | Medium | Core |
| N11 | **Project-kind goals get fitness idioms in three places.** Goal detail shows a fitness "Readiness /100" card alongside Reach for project goals (`goals/[id]/page.tsx:237-249`); compare's "The work between" is fitness-framed (workouts/hikes/ft) and renders unconditionally — all zeros + possibly nonzero XP for project-only users (`compare/page.tsx:283`); character class label falls back to the raw string "project" (`character/page.tsx:76`). | Medium | Multi-domain |
| N12 | **Onboarding skip is a 30-day trap; calendar has no first-run state.** Skipping sets a 30-day dismiss cookie (`onboarding-actions.ts:28`) with no persistent re-entry in the nav — recovery is only Today's "Get started" card (`page.tsx:53-70`). `/calendar` shows a bare empty grid to 0-goal users while every sibling page has a friendly empty state. | Medium | New user |
| N13 | **OAuth consent rough edges.** Scope list is static regardless of requested scope (`oauth/authorize/page.tsx:158-161`); "Not you? Sign out" links to `/signin` without signing out — the session persists and auto-redirects back (`:171-172`, `signin/page.tsx:19-22`); Deny has no explanatory microcopy. (Otherwise strong: redirect-host trust anchor, inline error cards, frame-busting.) | Medium | OAuth |
| N14 | **Navigation dead-zones + missing exits.** `/coach`, `/compare`, `/journal`, `/character` light no bottom tab (`BottomNav.tsx:57-62` predicate); `/compare` has no in-page back path and calendar compare-mode is a small "⇄ Compare" pill with no path back from /compare (`CalendarMonth.tsx:246-260`); `/baselines` is claimed by the Progress tab but Progress never links there except via RecordsSummary; the Import pill sits inside Today's workout hero (`page.tsx:274-279`). | Medium | IA |
| N15 | **Duplicated helpers metastasized.** Meal-label maps ×4 (`nutrition/page.tsx:26-33`, `LogLauncher.tsx:19-26`, `MealComposer.tsx:26-33`, `NutritionToday.tsx:11-18`); `StatusPill`/`countByStatus`/`formatBest` ×2 (`baselines/page.tsx` vs `RecordsSummary.tsx`); block/prescription formatters ×3 (Today, day detail, plan); Stat tiles ×3+ (P7); the whole readiness-by-goal block ×2 (N1); Reach has two divergent renderers on one page (`goals/[id]/page.tsx:254-312` vs `FeasibilityReadout`). | Medium | Debt |
| N16 | **In-code ⚠ flags shipped unverified.** MealComposer sticky header/footer inside the bottom sheet: "verify on iOS Safari with keyboard open" ×2 (`MealComposer.tsx:544,1111`) — primary platform; calendar wedge-vs-ring at 390px (`CalendarMonth.tsx:517`) and provisional-cell 0.62 opacity vs WCAG AA on the date numeral (`CalendarMonth.tsx:421-425`). | Medium | Mobile |
| N17 | **Token + copy drift.** `--target` and `--danger` are the same hex in both themes (`globals.css:13,17,44,48`) — goal-date landmarks read as destructive; stale strings: "plan details unavailable" (`page.tsx:290`), "once Phase 3 MCP ships" on /revise (`revise/page.tsx:73-77`), "Log your first weight on the Today screen" (`history/page.tsx:37` — it's the Log sheet now); `latestMeasurement` fetched then discarded on Today (`page.tsx:92,131`). | Low | Polish |
| N18 | **Compare small stuff.** Computed `notesLogged`/`baselineTestsLogged` never rendered (`compare.ts:358-363,390-391`); same-day pick yields "0 days of showing up." instead of a nudge (`HeroSpan.tsx:66-68`); date inputs lack `max` (future clamped post-submit, `compare/page.tsx:224,233`); no error boundary around `computeComparison` (`:158-167`). | Low | Compare |
| N19 | **SessionMenu a11y.** `aria-haspopup="true"` vs `role="menu"` mismatch (`SessionMenu.tsx:71,94`); no focus management on open/close; remote Google avatar has no `onError` fallback to initials (`:82`). Inline onboarding form errors lack `role="alert"` (`OnboardingGoalForm.tsx:133-137`). | Low | A11y |

---

## Part 3 — New-surface inventory

### Auth shell — `/signin`, `/request-access`, invite gate
Branded, warm, `max-w-sm`, Google-only (`auth.ts:38`). Already-signed-in users redirect via `safeNext` (open-redirect-guarded, `safe-next.ts:7-11`). Invite flow: code arrives only via `?invite=` → 600s httpOnly cookie → `checkInviteGate` in the signIn callback (`auth-actions.ts:18-27`, `invite-gate.ts:32-93`); redemption deferred to `events.createUser` (`auth.ts:79-120`). Gate order (OPEN_SIGNUP → founder → existing user → email invite → code invite → reject) is clean and tested. Issues: N3, N4; plus a soft race — `useCount < maxUses` is checked pre-create and incremented post-create, so two simultaneous signups can both pass a `maxUses:1` code; stale invite cookie survives 10 min across account switches on a shared device (`auth.ts:86-88`).

### Route protection — `middleware.ts` + `route-access.ts`
Optimistic cookie-presence gate at the edge (`middleware.ts:117-119`), real validation in RSC — documented and sound. `next` param preserved with 307; `/oauth/authorize` keeps its full query across the sign-in bounce (`oauth/authorize/page.tsx:99-106`). Watch-items: the whole `/oauth/*` tree is public by design with the consent screen's session check living only in the page — worth a regression test; recap card URLs are session-walled, so a *shared* recap link bounces recipients to /signin — confirm that's intended for a share feature.

### Onboarding — `/onboarding` + `/onboarding/connect`
Trigger logic is loop-safe both directions (0-goal → onboarding, `page.tsx:34-43`; has-goals → home, `onboarding/page.tsx:24-25`). Goal form radiogroup is keyboard-correct; all targets ≥44px; connect walkthrough has copy button + visibility-aware "Check for connection" (`CheckConnectionButton.tsx:34-48`). Issues: N6 (Elbert placeholder), N12 (skip trap), connection check doesn't poll (manual tap needed if approval happened in the same tab), copy button silently no-ops when clipboard is denied (`CopyConnectorButton.tsx:22-26`).

### Settings + SessionMenu + consent
Connected-apps list is good: unverified-name marking (`settings/page.tsx:100-102`), last-used dates in USER_TZ, two-step revoke. Consent screen is the strongest new surface — trust anchored on redirect host with self-asserted name demoted to "(unverified)" (`oauth/authorize/page.tsx:136-151`), inline `OAuthErrorCard` for unvalidatable params (never redirects to untrusted URIs), frame-busting headers for this exact path (`middleware.ts:109-112`). Issues: N5, N13, N19.

### New-user empty states (B-2/B-3 verification)
Good and on-voice: `/` (get-started CTA), `/goals` ("Nothing to aim at yet."), `/progress`, `/baselines`, `/journal`, `/history`, `/compare` banner. Adequate: `/nutrition`. Weak: `/character` says "No active program" (user created a *goal* — jargon), `/calendar` bare grid (N12), `/recap` unguarded (N9). No `FOUNDER_USER_ID` render branches anywhere — divergence is entirely copy/placeholder (N6).

### Compare — `/compare` + calendar two-tap
Strong foundations: server-only page, deterministic malformed-param fallback (`compare/page.tsx:148-155`), preset chips, triple-encoded deltas (glyph + sign + aria-label, **not** color-only, `DeltaRow.tsx:47-85`), Bullseyes aria-hidden with labeled numerics, all targets ≥44px, `<details>` overflow. Calendar two-tap has a real state machine with `aria-live` hints, "A" chip, cross-month sessionStorage recall, same-day-tap = undo, auto-sorted order (`CalendarMonth.tsx:34,123-286`). Edge cases all degrade sanely (pre-data → "new" pills + banner; future → clamped; identical → zeros). Issues: N7, N8, N14, N18, and the fitness-framed "work between" for project users (N11).

Known hydration note: the pre-existing /compare + /days mismatch traces to `BottomSheet`'s server-null → client-portal swap in the global layout (`BottomSheet.tsx:35-42,78-83`) under force-dynamic streaming — there are no Suspense boundaries in `src/app` at all; compare's own code is written defensively against this class (`CalendarMonth.tsx:123-139`).

### Core screens (delta since v1)
- **Today**: hero + QuestCard + single celebration moment; `deriveDayDisplay` shared with calendar/day-detail; deferred workouts dimmed and labeled; 9-query `Promise.all`, no waterfall. Remaining: N17 copy, Import pill placement (N14), no state for an in-plan day with zero blocks.
- **Goals**: set-active-by-tap fixed — explicit "Set focus" pill + row-tap-navigates (`goals/page.tsx:195,224-232`); excellent state glossary (`:263-370`). Edit now uses TargetsBuilder (create/edit consistent). Remaining: three-control right rail crowds 390px; N11 readiness-on-project; dual Reach renderers.
- **Progress hub**: coherent internally (readiness cards with honest empty copy, burn-down, MRR, weight, body metrics, RecordsSummary) — but the merge left `/stats` alive (N1) and `/baselines` (H1 "Records") unlinked from the hub proper.
- **Nutrition**: the barcode scan path is the most robust surface in the app — every failure mode has copy + recovery, manual-digit strip always present, native detector + wasm fallback (`ScanFoodSheet.tsx:401-478`, `BarcodeScanner.tsx:138-182`). Macro roll-up now exists in three integrated places. Cost: MealComposer ~1,200 lines + useFoodComposer ~730 with 4+ ways to add an item, and the unverified iOS sticky flags (N16).
- **Workouts**: `WorkoutEditor` is a real structured editor (read-default, diff-based save, skipped-variant) — the standard DayOverrideForm should be held to (N10).
- **Coach**: reachable (MoreSheet), CoachNudges well-behaved — but the page is the worst founder-context offender post-multiuser (N6).
- **Recap/Character**: solid share fallbacks and optimistic posted-state re-sync (`RecapClient.tsx:52-59,155-183`); character zero-data guard clean. Issues: N9, N11 (class label), CharacterHeader 4-bar wrap at 390px (`CharacterHeader.tsx:64-68`).

---

## Part 4 — Recommendation

**Wave 1 — multiuser credibility (small, copy/glue-level, do first):**
1. Delete `/stats`, redirect to `/progress`; drop the `/stats` match in `BottomNav.tsx:59` (N1).
2. `/signin` error handling: render a friendly message per Auth.js `?error=` code (N3).
3. Invite: add a code input on `/signin` (or `/request-access`), validate before showing "detected ✓", replace the personal-Gmail mailto (N4).
4. De-founder the copy: onboarding placeholder, Coach prompts, request-access channel, stale strings (N6, N17). Pure copy edits.
5. Settings account block: show identity, add sign-out; queue delete-account/export as a follow-on story (N5).

**Wave 2 — feature correctness:**
6. Compare: one line of as-of microcopy under the hero + align `asOf` for today with /progress (`endOfDay` vs `now`) (N7, N8); render the two dead counters; gate/reframe "The work between" by goal kind (N11, N18).
7. Recap empty/error state: `onError` on the preview + "nothing to recap yet" guard (N9).
8. Defer the layout food-library fetch to sheet-open (or a nested layout); dedupe `resolveDay` between layout and page (N2).

**Wave 3 — structural (existing debt, schedule deliberately):**
9. Structured override editor reusing WorkoutEditor patterns (N10).
10. Primitive consolidation sweep: StatTile adoption, meal-label map, StatusPill, formatters (P7/N15).
11. A11y pass: chart `role="img"`, shell tap targets to 44px, 🏔️ labels, SessionMenu focus management (P8/N19).
12. Verify the shipped ⚠ flags on a real iPhone: MealComposer sticky chrome, calendar wedge/opacity (N16).

The app's fundamentals improved dramatically since v1 — nav, Today, logging rhythm, and form feedback all landed as designed, and the new OAuth consent + barcode-scan surfaces are the two best-engineered screens in the app. The gap has moved: from "screens are unreachable" to "the second user's experience still contains the first user's fingerprints." Wave 1 is almost entirely copy and glue, and it's what stands between "multiuser works" and "multiuser feels intended."
