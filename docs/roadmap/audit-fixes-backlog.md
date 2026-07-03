# Audit-Fixes Backlog — Epics → Stories

**Date**: 2026-07-03 · **Status**: Final (post Backlog-Critic) · **Board**: Goaldmine Roadmap #8 · **Plan**: `docs/roadmap/audit-fixes-plan.md`

31 stories across 4 sprints + Backlog. Each story = one `/feature-dev` run. Full machine-readable version: `.roadmap/2026-07-03-audit-fixes/coordination/backlog.json`.

## Sprint 10 - Multiuser credibility  (8 stories)

| # | Story | Priority | Effort | Depends on |
|---|-------|----------|--------|------------|
| 1 | Remove /stats page; redirect to /progress and port Totals to StatTile | P1 | Medium | — |
| 2 | Map Auth.js signin error codes to accurate user-facing copy | P1 | Small | — |
| 3 | Add AccessRequest Prisma model and migration | P0 | Small | — |
| 4 | Add access-request server action, rate-limit bucket, and review script | P0 | Medium | Add AccessRequest Prisma model and migration |
| 5 | Rebuild /request-access and /signin invite UX on AccessRequest | P0 | Medium | Add access-request server action, rate-limit bucket, and review script; Map Auth.js signin error codes to accurate user-facing copy |
| 6 | Add identity and sign-out block to /settings | P1 | Small | — |
| 7 | De-founder copy sweep: onboarding, coach prompts, and stale strings | P1 | Medium | — |
| 8 | Split --target token from --danger in globals.css | P1 | Small | — |

### Remove /stats page; redirect to /progress and port Totals to StatTile
_so that the app has one canonical progress surface instead of two overlapping pages, and the founder-era duplicate stops confusing new multi-tenant users_

**Acceptance criteria:**
- GET /stats issues a page-level redirect("/progress") (not a next.config rewrite) — verified by requesting /stats and observing the redirect
- /progress renders a 'Totals' card using StatTile for Workouts/Baselines/Hikes counts; no local duplicate Stat function remains for this card
- src/components/BottomNav.tsx no longer matches '/stats' when computing the Progress tab's active state (drop the p.startsWith("/stats") branch at line ~59)
- grep -rn 'revalidatePath("/stats")' src/ returns zero matches (removed from workout-actions.ts, goal-actions.ts, day-log-actions.ts, workout-edit-actions.ts — 19 sites)
- src/lib/auth/route-access.test.ts no longer asserts a ['/stats', ...] route-access entry; suite passes
- npx tsc --noEmit, npm run build, and npm run test all succeed

**Touches:** `src/app/stats/page.tsx`, `src/app/progress/page.tsx`, `src/components/StatTile.tsx`, `src/components/BottomNav.tsx`, `src/lib/workout-actions.ts`, `src/lib/goal-actions.ts`, `src/lib/day-log-actions.ts`, `src/lib/workout-edit-actions.ts`, `src/lib/auth/route-access.test.ts`

### Map Auth.js signin error codes to accurate user-facing copy
_so that a user who hits a Google-denial, unlinked-account, or gate-throw error sees an accurate message instead of guessing what went wrong or being told a false 'no invite' story_

**Acceptance criteria:**
- src/app/signin/page.tsx destructures 'error' from searchParams and renders a mapped message when present
- Mapping matches the corrected blueprint (verified against Auth.js v5 source, not memory): OAuthCallbackError -> 'Sign-in was cancelled or Google reported a problem'; OAuthAccountNotLinked -> relink-with-existing-account copy; AccessDenied -> generic transient-error copy (never implies 'no invite' — only reachable when checkInviteGate throws); Configuration -> temporarily-unavailable copy; unmapped codes (e.g. Verification, MissingCSRF) fall through to a generic default
- Invite-gate rejection (checkInviteGate returning allowed:false) is confirmed NOT to route through ?error= — it redirects straight to /request-access; no mapping entry claims otherwise
- Error banner renders correctly at 390px width alongside the existing Google sign-in button
- npm run test — auth test suites pass
- npx tsc --noEmit and npm run build succeed

**Touches:** `src/app/signin/page.tsx`, `src/lib/auth/auth.ts`, `src/lib/auth/invite-gate.ts`

### Add AccessRequest Prisma model and migration
_so that access requests have a durable, reviewable home in the database — the schema foundation for the in-app request form_

**Acceptance criteria:**
- AccessRequest model added to prisma/schema.prisma: id/email/note?/status (plain String, default "pending")/createdAt/reviewedAt?/reviewedNote?, with @@index([status]) and @@index([email]), placed with the auth-infra models and commented with the Invite-style raw-prisma rationale
- Migration is additive-only — npx prisma migrate diff shows no destructive ops; applied via guarded npm run db:migrate
- npx prisma generate is run after the schema edit, before any code referencing the AccessRequest model type-checks
- scripts/verify-no-null-userid.ts's hardcoded model allowlist is confirmed unaffected (allowlist diff is empty) — AccessRequest is auth-infra, not an owned model
- npx tsc --noEmit succeeds

**Touches:** `prisma/schema.prisma`, `prisma/migrations/`

### Add access-request server action, rate-limit bucket, and review script
_so that rejected signups can submit a real in-app request instead of a personal mailto link, and the founder can review/mint invites without exposing an inbox_

**Acceptance criteria:**
- New src/lib/auth/access-request-actions.ts server action validates length caps (email <= 254 chars, note <= 1000 chars), rejects submissions with a filled honeypot field, and calls the rate limiter INSIDE the action (not middleware)
- Model access goes through the raw prisma singleton (never getDb()) — same rationale as Invite: requester has no User row yet
- src/lib/rate-limit.ts gains an accessRequestHour bucket (new RATE_LIMITS entry + Bucket union member), following the existing signinHour/registerHour pattern
- New scripts/list-access-requests.ts lists pending AccessRequest rows via raw prisma (pattern like scripts/mint-invite.ts)
- npm run test — auth/invite-gate suites pass; npx tsc --noEmit succeeds

**Touches:** `src/lib/auth/access-request-actions.ts`, `src/lib/rate-limit.ts`, `scripts/list-access-requests.ts`

### Rebuild /request-access and /signin invite UX on AccessRequest
_so that a rejected visitor can submit their request in-app and a returning visitor with an invite code sees an honest, non-enumerable status instead of a fake 'detected' chip_

**Acceptance criteria:**
- src/app/request-access/page.tsx flips export const dynamic from "force-static" to "force-dynamic", accepts ?email= for prefill, removes the mailto:ggronnii@gmail.com link, and submits to the new access-request server action with a hidden honeypot field
- src/app/signin/page.tsx replaces the 'Invite code detected' chip with a text input prefilled from ?invite=, feeding the existing signInWithGoogle(next, code) cookie flow unchanged (auth-actions.ts is not modified)
- New previewInviteCode(code) server action performs exactly ONE fixed-shape query and returns a boolean only — never a reason (no valid/expired/wrong-email distinction) — confirmed by reading the implementation and its test
- checkInviteGate remains the sole real enforcement path; previewInviteCode is advisory-only and cannot be used to gate access
- Both pages render correctly at 390px width
- npm run test — auth/invite-gate suites pass; npx tsc --noEmit and npm run build succeed

**Touches:** `src/app/request-access/page.tsx`, `src/app/signin/page.tsx`, `src/lib/auth/access-request-actions.ts`, `src/lib/auth/invite-gate.ts`

### Add identity and sign-out block to /settings
_so that a signed-in multi-tenant user can confirm which account they're using and sign out without leaving the app_

**Acceptance criteria:**
- src/app/settings/page.tsx renders an identity block (name/email/avatar sourced from the session) above the existing 'Connected apps' card
- Sign-out control reuses the existing signOutAction from src/lib/auth/auth-actions.ts (no new sign-out logic introduced)
- Page renders correctly at 390px width
- npm run test — auth test suites pass
- npx tsc --noEmit and npm run build succeed

**Touches:** `src/app/settings/page.tsx`, `src/lib/auth/auth-actions.ts`

### De-founder copy sweep: onboarding, coach prompts, and stale strings
_so that new multi-tenant users don't see the founder's own goal ('Mt. Elbert', '$1k/mo MRR') or stale references to shipped/removed features baked into shared UI copy_

**Acceptance criteria:**
- src/components/OnboardingGoalForm.tsx:94 — both placeholders ('Summit Mt. Elbert' for fitness, 'Reach $1k/mo MRR' for project) replaced with neutral-but-concrete goal-generic examples
- src/app/coach/page.tsx PROMPTS array no longer contains the literal 'Mt. Elbert' reference (the 'Refine readiness from research' prompt) and the ~4-5 affected prompt strings read goal-generically rather than fitness-only; docs/claude-ai-setup.md is left untouched (explicitly the founder's own brief)
- Stale strings fixed: src/app/page.tsx's 'plan details unavailable' sites (~lines 232, 290), src/app/goals/[id]/revise/page.tsx's '...once Phase 3 MCP ships' line (~75), src/app/history/page.tsx's 'Log your first weight on the Today screen' empty state (~37)
- src/components/CoachNudges.tsx no longer references the internal-only 'claude.ai/code/routines' path (~line 102)
- grep -rn 'Elbert|MRR' src/ returns zero matches outside test fixtures
- npx tsc --noEmit, npm run build, and npm run test succeed

**Touches:** `src/components/OnboardingGoalForm.tsx`, `src/app/coach/page.tsx`, `src/app/page.tsx`, `src/app/goals/[id]/revise/page.tsx`, `src/app/history/page.tsx`, `src/components/CoachNudges.tsx`

### Split --target token from --danger in globals.css
_so that goal-target highlights (Bullseye, Logo, WorkoutLoggerForm 'New bests', OtherGoalsStrip focus rail) are visually distinct from error/destructive states, instead of sharing an identical color value that reads as 'everything is red'_

**Acceptance criteria:**
- Confirm before editing: src/app/globals.css's data-theme light/dark blocks (~lines 51-86) mirror the :root / prefers-color-scheme dark blocks (~lines 1-48) exactly for --target and --danger — currently identical hex values in both light (#A82A1F) and dark (#C0392B) pairs
- --target is given a new distinct value (not equal to --danger) in all 4 blocks (root/light default, prefers-color-scheme dark, data-theme light, data-theme dark); light/dark --target variants remain a coherent pair with each other
- grep for the pre-change hex values confirms no block still has --target === --danger
- Both colors retain WCAG AA contrast against --card/--background in light and dark themes (spot-checked with a contrast tool)
- Visual spot-check at 390px: Bullseye rings, Logo circles, and WorkoutLoggerForm 'New bests' highlight (all --target consumers) render visibly distinct from error/danger banners (ConfirmButton, form error text) in both themes
- npx tsc --noEmit and npm run build succeed

**Touches:** `src/app/globals.css`, `src/components/Bullseye.tsx`, `src/components/Logo.tsx`, `src/components/LibraryPickerOverlay.tsx`, `src/components/FoodLibraryManager.tsx`, `src/components/OtherGoalsStrip.tsx`, `src/components/days/WorkoutLoggerForm.tsx`, `src/app/days/[dateKey]/page.tsx`

## Sprint 11 - Feature correctness  (5 stories)

| # | Story | Priority | Effort | Depends on |
|---|-------|----------|--------|------------|
| 1 | Enforce compare-vs-progress readiness parity for today | P0 | Medium | — |
| 2 | Render compare's dead counters and fix its small UI gaps | P2 | Medium | Enforce compare-vs-progress readiness parity for today |
| 3 | Gate fitness-only idioms behind goal kind | P1 | Medium | Render compare's dead counters and fix its small UI gaps |
| 4 | Add a persistent onboarding re-entry point and a calendar first-run state | P1 | Medium | — |
| 5 | Guard recap against empty weeks and preview image failures | P1 | Medium | — |

### Enforce compare-vs-progress readiness parity for today
_so that a user comparing dates sees the exact same readiness number for 'today' that /progress shows, instead of a stale end-of-day snapshot that silently diverges from live data (CLAUDE.md invariant: compare and /progress must share the same computeReadiness path)_

**Acceptance criteria:**
- src/lib/compare.ts computes a single wall-clock read (const now = new Date(); const todayKey = toDateKey(now)) and derives asOfA/asOfB = date===todayKey ? now : endOfDay(parseDateKey(date)), used ONLY at the two computeReadiness call sites inside buildGoalSections (function takes 4 date args: cutA, cutB, asOfA, asOfB); every other section (strength, baselines, body, counters) keeps existing endOfDay(cutA)/endOfDay(cutB) snapshot semantics unchanged
- new regression test in src/lib/compare.test.ts asserts that when dateB is today, computeComparison's per-goal readiness for that goal equals the same value src/app/progress/page.tsx:41 (computeReadiness(targets, new Date(), g.id)) would compute — proving byte-identical parity; test must fail against the pre-fix code path and pass after
- MCP curl smoke of compare_dates (POST /api/mcp per README 'MCP server' smoke recipe, body {a: <30-days-ago>, b: <today>}) captured before and after the change, showing today's per-goal readiness score matches the equivalent get_today_plan/compute_readiness value for the same goal
- src/lib/mcp/tools.ts compare_dates tool description (~line 1230-1235) updated to document the today carve-out — it currently states pure 'latest-known value ≤ end of each day' semantics, which is no longer true for a date that equals today and must say so explicitly
- as-of microcopy line added near the /compare hero (in src/app/compare/page.tsx or src/components/compare/HeroSpan.tsx) communicating the snapshot semantic ('as of end of day, except today which is live') — verified via 390px render
- npm run test and npx tsc --noEmit both clean

**Touches:** `src/lib/compare.ts`, `src/lib/compare.test.ts`, `src/lib/mcp/tools.ts`, `src/app/compare/page.tsx`, `src/components/compare/HeroSpan.tsx`

### Render compare's dead counters and fix its small UI gaps
_so that logged baseline tests and notes actually show up in the comparison, users can't submit a future date, a same-day pick reads as a nudge instead of a dead-end '0 days', and a comparison-engine failure shows a friendly message instead of an unhandled crash_

**Acceptance criteria:**
- 'The work between' Card in src/app/compare/page.tsx renders two new StatTiles for between.notesLogged and between.baselineTestsLogged (currently computed in src/lib/compare.ts:391-392 but never rendered), matching the existing StatTile grid style
- both date inputs (name='a' and name='b') in the compare date form get a max attribute set to today's dateKey, preventing submission of a future date at the browser level (post-submit clamping already exists server-side and is unaffected)
- src/components/compare/HeroSpan.tsx's sameDay branch replaces the dead-end 'Same day selected.' / '0 days of showing up.' pairing with an actionable nudge copy (e.g. suggesting the user pick a different date to see a comparison)
- the computeComparison(rawA, rawB) call in src/app/compare/page.tsx is wrapped in try/catch; on thrown error the page renders a friendly Card-based error message instead of an unhandled exception/500
- 390px render check of /compare covering: same-day selection (nudge visible), a normal comparison (StatTiles for notes/baseline tests visible in 'The work between'), and a simulated computeComparison throw (error card visible, no crash)

**Touches:** `src/app/compare/page.tsx`, `src/components/compare/HeroSpan.tsx`

### Gate fitness-only idioms behind goal kind
_so that project-kind goals (e.g. a business launch) stop showing fitness-framed readiness cards, workout/hike counters, and a raw 'project' class label — all copy and computation should be goal-kind-aware for multi-domain users_

**Acceptance criteria:**
- src/app/goals/[id]/page.tsx:114's readiness computation is gated to goal.kind === "fitness" && targets.length > 0 (was targets.length > 0 alone); the existing JSX guard at line 237 ({readiness && ...}) then hides the fitness readiness card entirely for project goals with no further change needed there
- 'The work between' Card in src/app/compare/page.tsx is rendered only when result.goals.some(g => g.kind === "fitness") is true (not gameState.goalKind, which breaks multi-domain users); a compare run with only project-kind goals shows no fitness workout/hike/ft counters
- GoalPresentation type in src/lib/goal-presentation.ts gains a new classLabel: string field; FITNESS_PRESENTATION.classLabel = "Adventurer", PROJECT_PRESENTATION.classLabel = "Builder", DEFAULT_PRESENTATION inherits FITNESS_PRESENTATION's classLabel via its existing spread
- src/app/character/page.tsx:76 replaces the inline ternary (state.goalKind === "fitness" ? "Adventurer" : state.goalKind) with the resolved classLabel from presentationForGoal({ kind: state.goalKind }); a project-focus character page shows 'Builder' instead of the raw string 'project'
- npx tsc --noEmit and npm run test both clean

**Touches:** `src/app/goals/[id]/page.tsx`, `src/app/compare/page.tsx`, `src/lib/goal-presentation.ts`, `src/app/character/page.tsx`

### Add a persistent onboarding re-entry point and a calendar first-run state
_so that a 0-goal user who dismissed the Today onboarding card (30-day cookie) still has a way back into onboarding from the nav, and /calendar stops showing a bare empty grid to new users when every sibling page has a friendly empty state_

**Acceptance criteria:**
- src/app/layout.tsx adds one cheap db.goal.count() query in the signed-in path and passes the result as a goalCount prop through BottomNav (src/components/BottomNav.tsx) into MoreSheet (src/components/MoreSheet.tsx)
- MoreSheet renders a 'Set up your first goal →' row at the TOP of navRows whenever goalCount === 0, regardless of the gm_onboarding_dismissed_<uid> cookie state (src/lib/onboarding-actions.ts) — i.e. dismissing Today's card must not hide this nav entry point
- src/app/calendar/page.tsx renders an empty-state Card above the CalendarMonth grid when !goal, matching Today's (src/app/page.tsx) get-started voice/copy instead of (or in addition to) the existing bare 'No active plan' line below the grid
- 390px render check of MoreSheet in the 0-goal state (row visible, links to /goals or /onboarding) and of /calendar in the 0-goal state (empty-state Card visible above the grid)
- npx tsc --noEmit clean
- Sequencing constraint: this story must NOT run concurrently with Sprint 12's 'layout fetch deferral' story (N2), which also touches layout.tsx/BottomNav.tsx/MoreSheet.tsx — N2 is expected to rebase on this story's changes, not the other way around

**Touches:** `src/app/layout.tsx`, `src/components/BottomNav.tsx`, `src/components/MoreSheet.tsx`, `src/app/calendar/page.tsx`

### Guard recap against empty weeks and preview image failures
_so that a new user's first look at /recap doesn't show a spinner-then-broken-image for a week with no logged data, and resvg render calls aren't wasted on weeks that have nothing to recap_

**Acceptance criteria:**
- src/components/RecapClient.tsx's preview <img> gets an onError handler that renders a friendly fallback card/message instead of leaving a broken image in place
- src/app/recap/page.tsx adds one cheap aggregate query per activity model (workout, hike, nutritionLog, baseline) across the 13-week window (mondays[12]..mondays[0]), bucketed in JS into a weeksWithData: number[] of plain offsets — mirroring the existing postedWeeks shape (only plain numbers cross to the client, no Date objects)
- weeksWithData is passed into RecapClient; for any selected week whose offset is NOT in weeksWithData, RecapClient renders 'Nothing to recap yet…' copy and skips mounting the <img> entirely (no request to the card route, saving a resvg render)
- 390px render check covering a week with data (image renders normally) and a week with none (no image request fires, 'Nothing to recap yet…' shown)
- npx tsc --noEmit and npm run test both clean

**Touches:** `src/components/RecapClient.tsx`, `src/app/recap/page.tsx`

## Sprint 12 - High-risk structural  (4 stories)

| # | Story | Priority | Effort | Depends on |
|---|-------|----------|--------|------------|
| 1 | Add GET /api/log-sheet-data and convert LogLauncher to self-fetch on every sheet-open | P1 | Medium | Add a persistent onboarding re-entry point and a calendar first-run state |
| 2 | Remove meal-data props from BottomNav/layout and drop the dead layout queries | P1 | Medium | Add GET /api/log-sheet-data and convert LogLauncher to self-fetch on every sheet-open; Add a persistent onboarding re-entry point and a calendar first-run state |
| 3 | Harden the day-override write path with DayTemplate validation and the baseline-decision guard | P1 | Small | — |
| 4 | Build the structured Day Override editor v1 with an Advanced JSON tab | P2 | Medium | Harden the day-override write path with DayTemplate validation and the baseline-decision guard |

### Add GET /api/log-sheet-data and convert LogLauncher to self-fetch on every sheet-open
_so that the Log sheet always shows live meal/macro data without depending on layout.tsx's per-request Promise.all, and BottomSheet's SSR-only portal guard stops being a decoy for data freshness_

**Acceptance criteria:**
- New route handler GET /api/log-sheet-data returns the exact shape layout.tsx currently computes today: todaysMeals (TodayMealLite[]), quickPickFoods, libraryFoods, trackedSoFar (DayMacros), dayTarget (DayMacros | null) — built from the same queries/helpers (nutritionLog findMany for today's window, getQuickPickFoods, listLibraryFoods, resolveDay(now).nutritionPlan via sumPlanTargetMacros/sumLoggedDayMacros/hasAnyMacros)
- TodayMealLite type is relocated out of src/app/layout.tsx into a shared, non-page module (e.g. src/lib/log-sheet-data.ts) so client components no longer import a type from a route layout file; layout.tsx and BottomNav.tsx/LogLauncher.tsx update their import to the new module (no behavior change to the type itself)
- LogLauncher fetches GET /api/log-sheet-data on EVERY transition from closed to open of the Log BottomSheet (not just first mount) — meal edits via MealEditButton do not revalidate this route handler, so re-fetch-per-open is required for correctness, per the approved plan's mechanism correction (BottomSheet's SSR guard only protects the portal; LogLauncher is already fully mounted on every route)
- LogLauncher renders a lightweight loading state (skeleton/spinner sized to avoid layout shift) between sheet-open and fetch resolution; the meal-log list, 'today so far' macro line, and LogNutritionForm's build-vs-today header populate once data resolves
- LogLauncher's own props (todaysMeals/quickPickFoods/libraryFoods/trackedSoFar/dayTarget) are no longer required for correctness — the component is self-sufficient when no props are passed — but BottomNav still compiles unchanged (prop removal from BottomNav/layout is a separate story)
- Fetch failure (network error, 401 mid-session) shows an inline retry affordance in the sheet rather than a blank/broken form
- npx tsc --noEmit and npm run lint pass

**Touches:** `src/app/api/log-sheet-data/route.ts`, `src/lib/log-sheet-data.ts`, `src/components/LogLauncher.tsx`, `src/components/MealEditButton.tsx`, `src/app/layout.tsx`, `src/components/BottomNav.tsx`

### Remove meal-data props from BottomNav/layout and drop the dead layout queries
_so that layout.tsx stops running a 4-query Promise.all on every signed-in route just to feed a sheet that may never open, cutting cold-render cost app-wide and deleting Today's dead latestMeasurement query_

**Acceptance criteria:**
- BottomNav no longer accepts or forwards todaysMeals/quickPickFoods/libraryFoods/trackedSoFar/dayTarget props; LogLauncher's prop types make these fully optional/removed once BottomNav stops passing them
- layout.tsx's signed-in path drops the entire 4-query Promise.all (nutritionLog.findMany for today, getQuickPickFoods, listLibraryFoods, resolveDay(now)) — layout.tsx only performs auth() + whatever remains genuinely needed for chrome (AppHeader/session)
- src/app/page.tsx's dead latestMeasurement query (db.measurement.findFirst, void latestMeasurement at page.tsx:92,131) is deleted along with its now-unused import/binding
- Cold-hydration pass confirmed on /compare and /days — both routes have documented BottomSheet portal hydration fragility and must not regress after this prop/query removal
- Projected-macros header (build-vs-today) in the Log sheet's meal composer is correct immediately after editing a meal via MealEditButton, sourced from the self-fetch in the prior story, not stale layout-computed props
- Sheet-open latency (tap Log tab to usable form) is subjectively acceptable on a throttled connection — no multi-second blank sheet
- npx tsc --noEmit, npm run lint, and npm run test pass; manual smoke on /, /calendar, /compare, /days confirms BottomNav renders with no console hydration warnings

**Touches:** `src/components/BottomNav.tsx`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/components/LogLauncher.tsx`

### Harden the day-override write path with DayTemplate validation and the baseline-decision guard
_so that the dashboard's override write path (upsertDayOverrideFromForm) can't silently write malformed or oversized workoutJson that the MCP tool already rejects, and can't skip the audible-with-baselines decision that apply_day_override enforces_

**Acceptance criteria:**
- upsertDayOverrideFromForm in src/lib/day-actions.ts calls assertValidDayTemplate and assertDayTemplateWithinSize (from src/lib/day-template-validation.ts) on any parsed workoutJson before it reaches prisma.planDayOverride.upsert/create, replacing the current bare JSON.parse-then-write with zero structural validation
- The write path reuses the same baseline-decision guard semantics as applyDayOverrideCore: setting a new workout on a date with rotation-default baselines and no existing baselineTestNames decision on file must not silently drop the baseline decision — either by calling a shared extracted helper or by day-actions.ts routing through applyDayOverrideCore itself; no duplicated, divergent guard logic
- Error messages surfaced to DayOverrideForm's existing error banner are the same field-level messages assertValidDayTemplate/assertDayTemplateWithinSize already produce (non-empty title, blocks array shape, exercise name required, 64KB size cap) — no generic Prisma error leaks through
- New unit tests (e.g. day-actions.test.ts) cover: invalid/malformed workoutJson rejected before write, oversized workoutJson (>64KB) rejected, valid override still writes/upserts/deletes as before, and the baseline-decision guard fires under the same conditions as the MCP tool's existing test coverage
- No UI changes required for this story — DayOverrideForm's existing raw-JSON textarea keeps working, now backed by validation
- npm run test and npx tsc --noEmit pass

**Touches:** `src/lib/day-actions.ts`, `src/lib/day-template-validation.ts`, `src/lib/mcp/tools.ts`, `src/lib/day-actions.test.ts`

### Build the structured Day Override editor v1 with an Advanced JSON tab
_so that overriding a day's workout no longer requires hand-editing raw JSON — coaches/users can edit title, existing exercises' prescriptions, and skip-today per exercise through real form controls, while power edits stay available via an explicit Advanced tab_

**Acceptance criteria:**
- DayOverrideForm gains a structured editor for: the DayTemplate's title; each existing exercise's sets, reps, weightHint, durationSec, and notes; and a per-exercise 'skip today' toggle — scoped strictly to exercises already present in the resolved day's template
- Save is diff-based: only fields the user actually changed are sent in the write payload (mirroring WorkoutEditor.tsx's computeDiff pattern), not a full-template overwrite, so unrelated blocks/exercises are preserved byte-for-byte
- An 'Advanced JSON' tab, using TargetsBuilder.tsx's mode builder|advanced toggle idiom (builder to advanced with parse-on-switch-back validation), exposes the full raw workoutJson for block-level CRUD, reordering, block-type changes, rounds/restSec, and adding new exercises
- Explicit AC: the structured (non-Advanced) editor tab does NOT offer add-block or remove-block controls — block CRUD/reorder/type changes are only reachable via the Advanced JSON tab, per the approved v1 scope cap
- All saves — whether from the structured tab or the Advanced JSON tab — flow through the hardened write path (assertValidDayTemplate + assertDayTemplateWithinSize + baseline-decision guard); malformed Advanced-tab JSON is caught client-side before submit
- Existing 'Clear override' flow (ConfirmButton) continues to work unchanged
- npx tsc --noEmit, npm run lint pass; manual smoke: edit an exercise's weightHint via the structured tab and save, confirm /days/[dateKey] and /calendar reflect it; switch to Advanced tab, confirm it round-trips the same JSON the structured tab would produce

**Touches:** `src/components/DayOverrideForm.tsx`, `src/lib/day-actions.ts`, `src/components/TargetsBuilder.tsx`, `src/lib/program-template.ts`

## Sprint 13 - Consolidation, a11y & polish  (10 stories)

| # | Story | Priority | Effort | Depends on |
|---|-------|----------|--------|------------|
| 1 | Adopt shared StatTile + dedup StatusPill/countByStatus/formatBest | P3 | Medium | — |
| 2 | Extract shared MEAL_LABELS map | P3 | Small | — |
| 3 | Dedup block/prescription display formatters across Today, day detail, and plan pages | P3 | Medium | — |
| 4 | Add per-route loading.tsx skeletons for the heavy routes | P3 | Small | — |
| 5 | Fix shell/menu tap-target and focus-management a11y gaps | P2 | Medium | — |
| 6 | Fix chart, emoji-marker, and form-error a11y gaps | P2 | Medium | — |
| 7 | Polish OAuth consent screen copy and account-switch flow | P2 | Medium | — |
| 8 | Verify MealComposer sticky header/footer on iOS Safari with keyboard open | P3 | Small | — |
| 9 | Verify CalendarMonth 390px wedge layout and provisional-cell contrast | P3 | Small | — |
| 10 | Add back/exit affordances for nav dead-zones (coach, compare, journal, character, baselines) | P3 | Medium | — |

### Adopt shared StatTile + dedup StatusPill/countByStatus/formatBest
_so that stat-tile and status-summary markup lives in one place instead of five near-identical local copies, cutting future visual drift and duplicate bugfixes_

**Acceptance criteria:**
- calendar/page.tsx, progress/page.tsx, baselines/page.tsx, RecordsSummary.tsx, and MilestoneBurnDown.tsx all render their stat rows via the shared StatTile component instead of a locally-defined Stat/WeightStat/BurndownStat function
- The five local stat-tile function definitions (Stat, WeightStat, BurndownStat, and any baselines/RecordsSummary equivalents) are deleted, not just unused
- StatusPill, countByStatus, and formatBest are defined exactly once and imported by both baselines/page.tsx and RecordsSummary.tsx, replacing the two near-duplicate local definitions (baselines/page.tsx:204/216 vs RecordsSummary.tsx:167/213)
- npx tsc --noEmit and npm run build both pass with zero new errors
- Visual parity confirmed by screenshot/manual check: /calendar, /progress, /baselines, and the RecordsSummary + MilestoneBurnDown cards render pixel-equivalent to before on phone width

**Touches:** `src/app/calendar/page.tsx`, `src/app/progress/page.tsx`, `src/app/baselines/page.tsx`, `src/components/RecordsSummary.tsx`, `src/components/MilestoneBurnDown.tsx`

### Extract shared MEAL_LABELS map
_so that meal-type display labels (Breakfast/Lunch/Dinner/Snack/etc.) are defined once and stay in sync across every nutrition surface instead of drifting across four hand-copied maps_

**Acceptance criteria:**
- A single exported MEAL_LABELS: Record<string, string> constant exists in one shared module (e.g. src/lib/nutrition-macros.ts or a new src/lib/meal-labels.ts)
- src/app/nutrition/page.tsx, src/components/LogLauncher.tsx, src/components/MealComposer.tsx, and src/components/NutritionToday.tsx all import the shared map instead of declaring their own local MEAL_LABELS object
- MealComposer's meal-type select options list continues to use the shared label strings (Breakfast/Lunch/Snack/Preworkout/Postworkout/Dinner) without changing option order or values
- npx tsc --noEmit and npm run build pass with zero new errors
- Visual parity: /nutrition page, the LogLauncher meal-log sheet, and MealComposer's meal-type dropdown render identical labels to before

**Touches:** `src/app/nutrition/page.tsx`, `src/components/LogLauncher.tsx`, `src/components/MealComposer.tsx`, `src/components/NutritionToday.tsx`, `src/lib/nutrition-macros.ts`

### Dedup block/prescription display formatters across Today, day detail, and plan pages
_so that blockTypeLabel/formatSecs/compactPrescription (and related prescription-formatting helpers) live in one shared module instead of three copy-pasted sets that can silently diverge_

**Acceptance criteria:**
- blockTypeLabel, formatSecs, and compactPrescription are each defined exactly once in a shared module (e.g. src/lib/plan-format.ts) and imported by src/app/page.tsx, src/app/days/[dateKey]/page.tsx, and src/app/goals/[id]/plan/page.tsx
- The three (or more, where present) local duplicate definitions of these functions are deleted from the individual page files
- Any page-specific variant naming (e.g. Today's ExerciseRow/BlockCard vs plan page's BlockView/prescriptionRight) is preserved untouched — only the pure formatting helpers are shared, not the JSX components
- npx tsc --noEmit and npm run build pass with zero new errors
- Visual parity: Today page, a day detail page (/days/[dateKey]), and a goal plan page (/goals/[id]/plan) render identical block/exercise text to before

**Touches:** `src/app/page.tsx`, `src/app/days/[dateKey]/page.tsx`, `src/app/goals/[id]/plan/page.tsx`, `src/lib/plan-format.ts`

### Add per-route loading.tsx skeletons for the heavy routes
_so that /progress, /calendar, /nutrition, /recap, and /compare show an immediate skeleton instead of a blank screen while their server data fetches, matching the pattern already used at the root_

**Acceptance criteria:**
- src/app/progress/loading.tsx, src/app/calendar/loading.tsx, src/app/nutrition/loading.tsx, src/app/recap/loading.tsx, and src/app/compare/loading.tsx each exist as server components (no "use client")
- Each loading.tsx follows the same visual idiom as src/app/loading.tsx: animate-pulse rounded-2xl Card-shaped blocks, aria-hidden on the decorative blocks, and a visually-hidden sr-only "Loading…" text node for screen readers
- Each route's skeleton is shaped roughly like that route's real content (e.g. /calendar's skeleton suggests a month grid, /nutrition's suggests meal cards) rather than being a verbatim copy of the root skeleton
- npm run build succeeds and each route's loading state is visually confirmed by throttling network / React DevTools Suspense toggle

**Touches:** `src/app/progress/loading.tsx`, `src/app/calendar/loading.tsx`, `src/app/nutrition/loading.tsx`, `src/app/recap/loading.tsx`, `src/app/compare/loading.tsx`, `src/app/loading.tsx`

### Fix shell/menu tap-target and focus-management a11y gaps
_so that the theme toggle, account menu, and sheet-close button meet the 44px touch-target minimum and the account menu behaves like a real accessible menu (focus trapped/returned, screen readers announce it as a menu, and a broken avatar image degrades gracefully)_

**Acceptance criteria:**
- ThemeToggle.tsx:51 button classes change from w-9 h-9 to w-11 h-11 (or equivalent >=44px sizing) without breaking layout alignment
- SessionMenu.tsx:73 avatar button and BottomSheet.tsx:112 close button are likewise resized to w-11 h-11
- SessionMenu's trigger button uses aria-haspopup="menu" (not "true")
- On menu open, focus moves to the first menu item (Settings link); on menu close (Escape, outside click, or item activation), focus returns to the trigger button — implemented via a single useEffect keyed on the open state
- SessionMenu's avatar Image gains an onError handler that swaps to the existing initials-fallback rendering (state-driven, not a broken-image icon)
- npx tsc --noEmit and npm run build pass; manual keyboard-only pass confirms tab/escape/focus-return behavior via the account menu

**Touches:** `src/components/ThemeToggle.tsx`, `src/components/SessionMenu.tsx`, `src/components/BottomSheet.tsx`

### Fix chart, emoji-marker, and form-error a11y gaps
_so that screen-reader users get a meaningful label for chart content and goal-marker emoji, and inline form errors are announced immediately instead of silently appearing_

**Acceptance criteria:**
- WeightChart.tsx:25, ReadinessChart.tsx:26, and HistoryChart.tsx:33's wrapping div each gain role="img" and a descriptive aria-label summarizing the chart's content (e.g. "Weight trend over the last N weeks"), computed from the props already available to the component
- The chart wrapper's ResponsiveContainer/recharts internals remain aria-hidden or otherwise not double-announced (no duplicate SR narration of individual chart elements)
- The mountain emoji at calendar/page.tsx:129 and days/[dateKey]/page.tsx:242 is wrapped so the emoji itself is aria-hidden and an accessible text label (e.g. "Goal target:") precedes or accompanies the existing visible text — visible copy does not change for sighted users
- OnboardingGoalForm's inline error block (around line 133) gains role="alert" so screen readers announce validation failures immediately on render
- npx tsc --noEmit and npm run build pass with zero new errors; manual screen-reader spot check (VoiceOver or axe DevTools) confirms charts and emoji markers are announced sensibly on /progress, /calendar, and /days/[dateKey]

**Touches:** `src/components/WeightChart.tsx`, `src/components/ReadinessChart.tsx`, `src/components/HistoryChart.tsx`, `src/app/calendar/page.tsx`, `src/app/days/[dateKey]/page.tsx`, `src/components/OnboardingGoalForm.tsx`

### Polish OAuth consent screen copy and account-switch flow
_so that the consent screen's scope copy is maintainable as new scopes are added, "Not you? Sign out" actually signs the user out and returns them to the same authorize request instead of dead-ending at /signin, and Deny has clarifying microcopy_

**Acceptance criteria:**
- A SCOPE_COPY: Record<string, string[]> lookup (keyed by OAuth scope, e.g. "mcp") replaces any hardcoded scope-description strings in oauth/authorize/page.tsx; only "mcp" needs an entry today but the structure supports more
- signOutAction in src/lib/auth/auth-actions.ts accepts an optional redirectTo parameter and passes it to signOut({ redirectTo }), defaulting to "/signin" when omitted so existing callers are unaffected
- The "Not you? Sign out" link at oauth/authorize/page.tsx:175 becomes a form bound to the sign-out server action that passes the current /oauth/authorize?... query string as redirectTo, so after re-auth the user lands back on the same authorization request
- A short microcopy line clarifies what Deny does (e.g. "You can reconnect any time from claude.ai") near the Deny button at oauth/authorize/page.tsx:208
- npm run test passes, specifically the oauth suites (src/lib/oauth/*.test.ts) and any auth-actions coverage — mandated AC per the approved plan

**Touches:** `src/app/oauth/authorize/page.tsx`, `src/lib/auth/auth-actions.ts`

### Verify MealComposer sticky header/footer on iOS Safari with keyboard open
_so that we know for certain whether the meal-composer sheet's sticky chrome breaks under iOS Safari's keyboard-open viewport resize, rather than relying on simulator/desktop assumptions_

**Acceptance criteria:**
- MealComposer's sticky header and footer are exercised on a real iPhone in Safari (not a simulator) with the on-screen keyboard open while adding/editing a food entry
- Outcome is one of: (a) a confirmed pass — sticky chrome behaves correctly with the keyboard open, documented with a screenshot/recording, or (b) a filed follow-up issue describing the exact breakage observed
- If a trivial CSS-only fix is identified during testing (e.g. a dvh/svh unit swap or a safe-area adjustment), it is applied and re-verified on-device; no speculative fix is applied without on-device confirmation
- Result (pass or follow-up) is recorded in the story/issue so it isn't re-litigated blind in a future sprint

**Touches:** `src/components/MealComposer.tsx`

### Verify CalendarMonth 390px wedge layout and provisional-cell contrast
_so that we know for certain whether the calendar's progress-wedge rendering breaks at the narrowest common phone width (390px) and whether the 0.62-opacity provisional-day styling meets WCAG AA contrast, rather than shipping unverified assumptions_

**Acceptance criteria:**
- CalendarMonth is visually inspected at exactly 390px viewport width, checking specifically for wedge-vs-ring rendering conflicts or overlap in day cells
- The provisional-cell 0.62-opacity treatment's effective foreground/background contrast ratio is measured with a contrast tool (e.g. WebAIM or axe DevTools) against both light and dark theme backgrounds
- Outcome is one of: (a) a confirmed pass for both the 390px layout and the contrast ratio, documented with the measured ratio and a screenshot, or (b) a filed follow-up issue with the specific measurement/observation that failed
- If a trivial CSS-only fix is identified (e.g. bumping opacity to meet 4.5:1 AA text contrast or 3:1 for non-text), it is applied and re-verified; no speculative fix is applied without measurement

**Touches:** `src/app/calendar/page.tsx`, `src/components/CalendarMonth.tsx`

### Add back/exit affordances for nav dead-zones (coach, compare, journal, character, baselines)
_so that a user who lands on /coach, /compare, /journal, /character, or calendar compare-mode always has a visible way back or a lit nav tab instead of relying on the browser back button, and /baselines is discoverable from the Progress hub it's nominally filed under_

**Acceptance criteria:**
- BottomNav's active-tab predicate (BottomNav.tsx:57-62) is updated so /coach, /compare, /journal, and /character each light a sensible existing tab instead of leaving all tabs unlit
- /compare gains an in-page back control (e.g. header back link to /progress or the referring page) — no dead-end reliant on browser back
- Calendar's compare-mode '⇄ Compare' pill (CalendarMonth.tsx:246-260) gains a visible exit/cancel affordance to leave compare-mode without completing a comparison
- /progress links to /baselines (e.g. from RecordsSummary or a hub nav row) so it's reachable from the hub it's conceptually filed under, not only via direct URL or MoreSheet
- Import pill placement inside Today's workout hero (page.tsx:274-279) is either confirmed intentional or relocated — decision recorded in the PR
- 390px render check confirms each new control is reachable and >=44px
- npx tsc --noEmit and npm run build succeed

**Touches:** `src/components/BottomNav.tsx`, `src/app/compare/page.tsx`, `src/components/CalendarMonth.tsx`, `src/app/progress/page.tsx`, `src/app/page.tsx`

## Backlog  (4 stories)

| # | Story | Priority | Effort | Depends on |
|---|-------|----------|--------|------------|
| 1 | Add delete-account with tenant-scoped cascade | P2 | Large | Add identity and sign-out block to /settings |
| 2 | Add data export (JSON) from /settings | P3 | Medium | Add identity and sign-out block to /settings |
| 3 | Harden invite maxUses against concurrent redemption | P3 | Small | — |
| 4 | Dedupe goal-count fetches via a React.cache getGoalCount helper | P3 | Small | — |

### Add delete-account with tenant-scoped cascade
_so that users can permanently remove their account and all owned data — multiuser table stakes and a GDPR/CCPA expectation_

**Acceptance criteria:**
- Settings shows a Delete account flow with explicit typed confirmation (not window.confirm)
- Deletion removes the User row and every owned-model row for that userId (all 16 SCOPED_MODELS) plus Auth.js Account/Session rows and OAuth grants/tokens, in a transaction
- Deletion signs the user out and lands on /signin with a confirmation message
- npm run db:verify-isolation still passes; a new unit test proves another user's rows are untouched by a delete
- npx tsc --noEmit and npm run build green; auth + oauth test suites pass

**Touches:** `src/app/settings/page.tsx`, `src/lib/auth/ (new delete action)`, `src/lib/db.ts (SCOPED_MODELS reference)`, `tests`

### Add data export (JSON) from /settings
_so that users can take their logged data with them — pairs with delete-account for account-lifecycle completeness_

**Acceptance criteria:**
- Settings offers an Export my data action producing a single JSON download of all owned-model rows for the current user via getDb()
- Export contains no other user's rows (unit test) and no OAuth/infra secrets
- Large exports stream or chunk (no unbounded in-memory concat beyond a sane cap)
- npx tsc --noEmit and npm run build green

**Touches:** `src/app/settings/page.tsx`, `new route handler or server action`, `src/lib/db.ts (read-only usage)`

### Harden invite maxUses against concurrent redemption
_so that two simultaneous signups on a maxUses:1 code cannot both pass the gate (checkInviteGate reads useCount in JS; increment happens later in events.createUser)_

**Acceptance criteria:**
- Redemption uses an atomic conditional update (e.g. updateMany with useCount < maxUses guard) or serializable transaction; the loser of the race is rejected
- Unit test simulating concurrent redemption shows exactly one success for maxUses:1
- Existing invite-gate.test.ts suite still passes; no behavior change for the single-redeemer path

**Touches:** `src/lib/auth/auth.ts (events.createUser)`, `src/lib/auth/invite-gate.ts`, `src/lib/auth/invite-gate.test.ts`

### Dedupe goal-count fetches via a React.cache getGoalCount helper
_so that layout's nav-level goal.count() and Today's onboarding-gate count collapse into one query per request_

**Acceptance criteria:**
- A cache()-wrapped getGoalCount() helper is the single source for goal counts in layout.tsx and app/page.tsx
- Exactly one goal.count query per request to / (verified via Prisma query logging in dev)
- npx tsc --noEmit and npm run build green; no visible behavior change

**Touches:** `src/app/layout.tsx`, `src/app/page.tsx`, `new src/lib helper`
