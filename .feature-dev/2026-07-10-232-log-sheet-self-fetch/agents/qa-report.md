# QA Report — #232 GET /api/log-sheet-data + LogLauncher self-fetch

HEAD: `9a5a531` on `feature/phase1-auth`. Read-only code-level review (no server run, no browser drive — that evidence is expected from the dev, see finding F0 below).

Gates run directly: `npx tsc --noEmit` → 0 errors. `npm run lint` → 0 errors (2 pre-existing unrelated warnings in `token-grants.test.ts`). `npx vitest run` → **680/680 passed** (39 files, incl. new `log-sheet-data.test.ts` 7/7 and `route-access.test.ts` 32/32). `npm run build` → succeeds; `/api/log-sheet-data` listed as `ƒ` (dynamic function) route, confirming `force-dynamic` took effect.

## AC table (PRD §8)

| # | AC | Verdict | Evidence |
|---|----|---------|----------|
| 1 | 401 JSON unauthed; correct shape authed | PASS (code-level) | `route.ts`: `auth()` → `session?.user?.id` guard → `Response.json({error:"Unauthorized"},{status:401})`. Authed path `runWithUser(session.user.id, ...) → Response.json(getLogSheetData())`. Shape verified byte-identical to old layout pipeline (see Pipeline fidelity below). No live curl re-run (read-only, no server) — see F0. |
| 2 | Fetch fires on EVERY closed→open transition | PASS (code-level) | `prevOpenRef`/`useEffect([open])` fires `fetchData()` iff `open && !prevOpenRef.current`, unconditionally of whether `data` is already seeded from props. No network capture artifact from dev — see F0. |
| 3 | In-sheet edit/delete/**log** refetch (THE bug) | PASS | All three wired: edit → `MealEditButton` `onSaved={() => { onMutated?.(); close(); }}`; delete → `handleDeleted` (`close(); await deleteNutrition(); onMutated();`); **create** → `LogNutritionForm.onLogged` → `MealComposer` create `onSuccess: () => { resetCreate(); props.onLogged?.(); }` → `LogLauncher` wires `onLogged={fetchData}`. Traced `useFormFeedback.submit`: `await action(fd)` (i.e. `logNutrition`, including its `revalidatePath` calls) completes strictly before `onSuccess` fires — C1's ordering claim holds. |
| 4 | Skeleton no-shift; error+Retry | PASS w/ nit | Skeleton (`LogSheetSkeleton`) only renders when `data===null && phase==="loading"` — in current prod usage (layout always supplies props) this basically never fires until #233 lands; not exercised today. Error banner + manual Retry present; 401 swaps to "Sign in" link. See F2 (nit) on skeleton height fidelity. |
| 5 | LogLauncher renders with NO props | PASS (code trace only) | All props optional; `hasProps` check → `{phase:"idle", data:null}`; every consumer reads nullable `data` (`data?.trackedSoFar`, `data && data.todaysMeals.length>0`, `data?.quickPickFoods` etc.) — no unguarded access found. No automated render test exists; PRD explicitly allows "test render or temporary prop-less mount in dev" as the bar — neither artifact found, see F0. |
| 6 | layout/BottomNav compile unchanged in shape; #233 comments intact | PASS | `git diff f0dc7ff 9a5a531 -- src/app/layout.tsx` is a clean swap-for-`getLogSheetData()`; `goalCount` statement + its #233 boundary comment block preserved verbatim (now at layout.tsx:110-113). The `toNutritionItems` preservation-rationale comment relocated verbatim into `log-sheet-data.ts:48-50` — nothing dropped. `BottomNav.tsx` diff is exactly the one-line `open={logOpen}` add, per plan. |
| 7 | tsc 0 / lint no-new / tests 672+ / build OK | PASS | See gate summary above — 680 ≥ 672, tsc clean, lint clean, build succeeds. |

## Critique fix verification

**C1 (create path)** — Landed correctly. `LogNutritionForm` gained `onLogged?: () => void`, forwarded into `MealComposer`'s create-mode `onSuccess`. Enumerated every path that writes a `NutritionLog` reachable from inside the Log sheet: (a) manual composer submit, (b) quick-pick tap (`mergeFoodIntoForm` — only populates the form, doesn't submit), (c) barcode scan via `ScanFoodSheet`/`useFoodComposer` (`onAdd` also only merges into the form) — all three converge on the single `<form onSubmit>` → `createSubmit(logNutrition, {onSuccess})` handler MealComposer already had. No bypass path found. `restoreNutrition` (Undo) is dead code only reachable from `NutritionList` on `/nutrition`, not mounted inside `LogLauncher` — out of this story's reachable surface, correctly left unwired.

**C2 (delete ordering)** — Landed correctly. `MealEditButton.handleDeleted`: `close()` (synchronous, unmounts `MealComposer` via `{open && (...)}` in the same event-handler tick) → `await deleteNutrition(meal.id)` → `onMutated?.()`. Confirmed `MealComposer`'s delete path does **not** call `deleteNutrition` itself — it only hands a snapshot to `props.onDeleted`, so there's no double-delete risk, and `ConfirmButton`'s un-guarded `disabled` state (noted by critique as a hazard) is moot because the button unmounts before the await, not during it.

**D1 (exhaustive-deps lint risk)** — No `eslint-disable` comment was added to the open-transition effect (the codebase's usual convention), but verified empirically: `npx eslint src/components/LogLauncher.tsx --no-cache` and full `npm run lint` both pass with 0 errors on this file. Not a live gate risk — downgrading to a non-issue.

**D2 (307-not-401 for fully-logged-out client)** — Correctly left unfixed (flagged as a Concern, not blocking); confirms with source: `/api/log-sheet-data` is off `isPublicPath`, so a fully-logged-out `fetch()` (no cookie at all) gets middleware's 307→HTML, lands in the generic catch, shows "Couldn't load — try again" instead of the sign-in-hint copy. Degrades to a working Retry button. Untouched, as critique recommended.

## Security / tenant scoping

- Route auth ordering: `auth()` called before any `getLogSheetData()`/db access; no db touched pre-auth.
- `getCurrentUserId()` absent from both `route.ts` and `log-sheet-data.ts` (only mentioned in a comment explaining why it's avoided) — confirmed via grep.
- No PII in the URL — plain `GET /api/log-sheet-data`, no query params, user identity comes from the session cookie only.
- `/api/log-sheet-data` absent from `isPublicPath()` (`route-access.ts`) — falls through to `return false` (protected). `route-access.test.ts` PROTECTED_CASES now includes it; 32/32 pass.
- `grep -nE "setHours|getDate\(\)|new Date\(\)\.get|getDay\(\)|getMonth\(\)"` across every changed file: only hit is `MealComposer.tsx:107` (`new Date().getHours()`), confirmed via `git blame` to predate this commit (2026-06-13, `defaultMeal()` — client-side, browser-local-time meal-type default, not a day-boundary/server date computation). Not introduced by #232; out of scope.
- Tenant scoping: `getLogSheetData` imports only `getDb` (no raw `prisma`); `NutritionLog` confirmed present in `db.ts`'s `SCOPED_MODELS`. Route wraps the call in `runWithUser(session.user.id, ...)`, matching the ALS pattern `getDb()` reads from. Correct.

## Pipeline fidelity (getLogSheetData vs. old layout.tsx @ f0dc7ff)

Diffed field-by-field: identical `nutritionLog.findMany` `where`/`select`/`orderBy`, identical `getQuickPickFoods()`/`listLibraryFoods()`/`resolveDay(now)` calls, identical `TodayMealLite` mapping (including `dateISO: m.date.toISOString()`), identical `sumLoggedDayMacros`/`sumPlanTargetMacros`/`hasAnyMacros` derivation. Byte-identical logic, verbatim relocation — no drift found.

## Findings

**Blocker:** none.

**Minor:**
- **F0 — Missing dev evidence artifact.** `.feature-dev/2026-07-10-232-log-sheet-self-fetch/agents/` contains only `research-output.md`, `architecture-blueprint.md`, `architecture-critique.md` — no dev report recording the browser-network evidence for AC-2/AC-3, nor the curl 401/authed-shape diff called for in blueprint §8, nor any record of the AC-5 prop-less render check. My review is code-level-sound on all of these (traced logic confirms correctness), but the task brief describes this evidence as "recorded in their report," and no such report exists yet. Recommend the dev either produce it or the story stays open pending that artifact before calling AC-1/2/3/5 fully closed per the PRD's own verification bar.

**Nit:**
- **F1** — `MealComposer.tsx:107`'s `new Date().getHours()` (pre-existing, unrelated to #232) computes a default meal-type client-side from local wall-clock time; harmless (browser already runs in user TZ) but flagged since the project convention funnels all date math through `calendar.ts`. Out of scope for this story; not introduced here.
- **F2** — `LogSheetSkeleton`'s fixed 2-row placeholder approximates but won't exactly match the real "Logged today" list height on days with 3+ meals (skeleton height is constant; real content grows with meal count) — inherent to any fixed skeleton, and currently unreachable in production (props are always pre-seeded by layout until #233 ships), so no live-user-facing shift today.
- **S1/S2 from critique** (client-side `mealSoFar` re-sum duplicate of `data.trackedSoFar`; no abort-on-close) verified still present, both explicitly non-blocking per critique's own analysis — not re-litigated here.

## Verdict: **SHIP**

Both criticals (C1, C2) landed correctly and were independently re-traced against source, not just re-read from the critique. All 7 ACs pass at the code level; gates (tsc/lint/vitest/build) all green. 0 blockers, 1 minor (missing dev verification artifact — process gap, not a code defect), 2 nits (1 pre-existing/out-of-scope, 1 latent/unreachable-today).
