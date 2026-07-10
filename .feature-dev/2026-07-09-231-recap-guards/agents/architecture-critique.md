# Devil's Advocate — Architecture Critique — #231 (recap empty-week guard + preview-failure fallback)

Blueprint: `docs/prds/PRD-231-recap-empty-week-guard.md` §3.1/§6. Verified against HEAD (`src/app/recap/page.tsx`, `src/components/RecapClient.tsx`, `src/lib/recap.ts`, `src/lib/calendar-core.ts`, `prisma/schema.prisma`, `src/lib/recap-caption.test.ts`).

---

## 1. Window boundaries

**Verified correct, one nuance to document.**

- `computeWeeklyRecap` (recap.ts:302-304) does `thisMonday = startOfWeekMonday(asOf)`, `monday = addDays(thisMonday, weekOffset*7)`, `sunday = endOfWeekSunday(monday)` — per-week `[monday, sunday]`, always in USER_TZ via `userParts`/Intl. The PRD's page-level combined query window `[mondays[12], endOfWeekSunday(mondays[0])]` is constructed from the *same* `addDays(thisMonday, -i*7)` values page.tsx already computes for `mondays[]` — byte-consistent with what `computeWeeklyRecap` would derive per offset. No drift.
- Bucketing by `dateKey(startOfWeekMonday(rowDate))` equality against `mondays[]` is provably equivalent to "row falls in `[monday_k, sunday_k]`" for every row, including a Sunday-23:59:59 USER_TZ row: `startOfWeekMonday` computes `userWeekdayMon1(d)` from `userParts` (Intl in `USER_TZ`), so a Sunday instant always resolves `wd=7` and buckets to *that week's* Monday (`day - 6`), not the following week. Confirmed by code inspection, no off-by-one.
- Lower-bound edge: `mondays[12]` is an actual DST-safe instant from `userTzWallClockToUTC`, identical in construction to what `computeWeeklyRecap(weekOffset=-12)` would use. No UTC/USER_TZ seam here — the whole page is already USER_TZ-consistent.

**Verdict: axis clean. No fix required beyond implementing per PRD.**

---

## 2. Model/field semantics — CRITICAL finding: two different "empty" concepts

Enum/field facts (schema.prisma, confirmed):
- `Workout.status` default `"completed"`, comment `planned | completed | skipped` — matches recap.ts:346 filter (`status: "completed"`).
- `Hike.status` same three-state enum, matches recap.ts:353.
- `Baseline` has **no status column** — date-only, matches recap.ts:614-615 (`db.baseline.findMany({ where: { date: {...} } })`, no status filter). PRD's weeksWithData baseline query should not add a status filter either.
- `LogEntry.date`: `DateTime // USER_TZ midnight`.
- `ScheduledItem.completedAt`: nullable `DateTime`. Grepped every write site (`project-tools.ts:216` `complete_item`, `github-tools.ts:791/802` `sync_github_milestones` closeCompleted) — **completedAt is only ever set alongside `status:"done"`**; skip actions never touch it. So "completedAt in window" is a clean, unambiguous "something was completed this week" signal — good choice.

**But — the parity check the PRD asks for fails, and it matters:**

`recap.ts`'s own `emptyWeek` flag (line 538) is:
```
const emptyWeek = workoutsCompleted === 0 && hikeElevationFt === null;
```
It **never reads logEntry or scheduledItem at all** — confirmed by grep (only 3 hits for `emptyWeek` in the whole file: the field decl, this line, and the error-fallback branch). Worse, the two project reads it does perform are **not week-scoped**:
- `logLatest` (recap.ts:369-374): `db.logEntry.findFirst({ where: { goalId, metric: k, value: {not: null} }, orderBy: { date: "desc" } })` — the **all-time latest** value for the metric, no date filter.
- `scheduledAgg` (recap.ts:376-390): `db.scheduledItem.groupBy({ by:["status"], where:{ goalId, type } })` — **cumulative done/total/open forever**, no date filter.

So the PRD's corrected 5-model `weeksWithData` set (adding logEntry/scheduledItem-in-window) invents a criterion the card itself has *never* used for anything. That's not a bug — it's the right fix for the page-level "should we even mount the img" gate (US-003 wants project-only weeks to still get a card) — but two things must be stated explicitly or a future reader will assume `weeksWithData` mirrors `emptyWeek` 1:1, which it does not and structurally cannot without also changing recap.ts (out of scope, correctly).
- Practically this is safe because the rendered PNG (`RecapCard`/`recap-render.tsx`) **never branches on `emptyWeek`** (grepped: zero hits) — only `recap-caption.ts` does (lines 106, 166-169, share-time only, not preview-time). So a project-only week that mounts the image via the new gate will render real (if all-time-cumulative) stat slots, not a "quiet week" placeholder — no visual contradiction with the img-mount decision.
- Where it *can* surface: the share caption (fetched only on Share click, `RecapClient.tsx:140-149`) will still say "A quiet week — back at it." for a week where the user only completed a milestone, because `composeCaption` reads recap.ts's `emptyWeek`, which ignores project data. That's a real (if minor, and explicitly out-of-scope per PRD §3.2) inconsistency between "the page said this week has data" and "the share caption calls it quiet." Flag it in the PR description so it isn't mistaken for solved by #231.

**Fix/documentation required:** add a one-line code comment at the `weeksWithData` computation in page.tsx stating explicitly that this is an *image-mount gate*, independent of and broader than `recap.ts`'s `emptyWeek` (which stays workout/hike-only by design, per PRD §3.2 scope).

---

## 3. Row-volume sanity

Fine as specified, one index gap worth naming (not blocking):
- `Workout`: `@@index([userId, startedAt])` — good.
- `Hike`: `@@index([userId, goalId, date])`, `@@index([date])` — good.
- `Baseline`: `@@index([userId, testName, date])` — the weeksWithData query (date-only, no testName) won't use the full composite but the prefix scan is cheap at single-tenant scale.
- `LogEntry`: indexes are all `goalId`-first (`[goalId,metric,date]`, `[goalId,date]`, `[userId,goalId,date]`); a date-only-across-goals query (needed here since weeksWithData isn't goal-scoped) won't hit any index cleanly.
- `ScheduledItem`: **no index touches `completedAt` at all** (`@@index([goalId,date])`, `@@index([goalId,status])`, `@@index([userId,goalId])`) — a `completedAt`-range filter is a sequential scan.

At this app's actual scale (single-tenant, 13-week window, months of history) this is negligible — not worth a migration for #231. Note it as a **Suggestion**, not a blocker; revisit if/when multi-tenant volumes grow. `distinct` is unnecessary — dedup via `Set` in JS is correct and cheaper than a DB-side DISTINCT for this row count.

---

## 4. Control-hiding ruling

Full control inventory from `RecapClient.tsx`, ruling per control:

| Control | Lines | Hide when `!hasData`? | Why |
|---|---|---|---|
| Preview `<img>` + Loading overlay | 200-216 | **Yes — replace with empty-state panel, same slot/aspect ratio** | This *is* the guard; PRD §3.1.3 |
| Week nav (prev/next + label) | 219-241 | **No — stays** | PRD explicit; user must be able to leave the empty week |
| Format toggle (story/post/square) | 244-269 | **Yes** | Only meaningful for a card that isn't rendering |
| Template toggle (coal/parchment) | 272-291 | **Yes** | Same — cosmetic for a nonexistent image |
| Highlight picker (select + custom text input) | 294-333 | **Yes** | `computeWeeklyRecap.highlights` will be empty for a genuinely empty week anyway (all four highlight sources — PRs, hikes, badges, baselines — require the same rows `weeksWithData` is gating on); showing "None ▾" for a week with nothing to feature is noise |
| Posted "✓ Shared" live region | 338-347 | **No — stays, per PRD's posted∩empty ruling** | `isPosted` is a historical fact about *that week's offset*, independent of whether the week currently has data. A user who shared a real card last month, and whose data later got deleted, should not lose the "you shared this" record. Sticky-by-design per the existing `locallyPosted` comment (line 45: "posted state persists across week navigation") |
| Share button | 351-362 | **Yes** | Sharing fetches `cardUrl` + caption; nothing to share |
| Share error text | 365-369 | **Yes (implicitly — becomes unreachable once Share is hidden, but gate explicitly on `hasData` rather than relying on it being merely unreachable)** | Defensive: don't leave a stale `shareError` string rendered from before a week-nav if state ordering ever changes |
| Download Card link | 372-378 | **Yes** | `href={cardUrl}` — same waste as the img mount, just deferred to click time |
| Download stories (3 links) | 381-392 | **Yes** | `storyUrl()` hits `/recap/story/[slide]`, which also calls `computeWeeklyRecap` + renders a PNG — same render-waste class the PRD is trying to eliminate for `/recap/card`; leaving these live defeats half the point |

**Net: only week nav + the posted badge survive `!hasData`.** Confirm this exact list before merging — it's larger than "hide the image," and every download/share affordance implies a renderable card that will not exist.

**Second finding on this axis (candidates fetch, PRD's own callout):** the `weekIdx`-keyed effect (RecapClient.tsx:63-79) unconditionally does `fetch('/recap/highlights?weekOffset=...')`, which server-side calls `computeWeeklyRecap` in full (recap.ts, same cost profile as the card route minus satori/resvg). For an empty week this fires on every navigation regardless of the img-mount fix, silently reintroducing the exact "wasted compute for a week with nothing to recap" problem the PRD's Problem Statement (§1.1) opens with — just on a different route. **Fix:** gate this effect on `hasData` too — `if (!hasData) { setCandidates([]); return; }` before the `fetch()` call. This closes the loop the PRD's own success criteria ("ZERO requests to /recap/card") leaves half-open by not mentioning `/recap/highlights`.

---

## 5. onError design

Retry cap: **prescribe N=3.** No existing retry-cap precedent elsewhere in the codebase (`ScanFoodSheet.tsx` has a `retryCode` re-submit pattern but no cap) — this is a fresh pattern, so pick something conservative. After 3 failed attempts, hide the Retry button and show a terminal message ("Still not loading — try again later") rather than leaving an infinite manual-retry affordance against `next/og`'s uncached satori/resvg render (`route.tsx:6` `force-dynamic`, no caching per `recap-render.tsx:25-50`) — the same expensive-render concern the PRD opens with, just user-triggered instead of automatic.

State shape:
```ts
const [imageFailed, setImageFailed] = useState(false);
const [retryCount, setRetryCount] = useState(0);   // caps at 3
const [retryNonce, setRetryNonce] = useState(0);   // cache-bust param
```
On error: `onError={() => { setImageFailed(true); setImageLoading(false); }}` — clearing `imageLoading` here is load-bearing; today only `onLoad` clears it (line 214), which is exactly the "stuck Loading… forever" bug the PRD names. Retry click: `setImageFailed(false); setImageLoading(true); setRetryCount(c => c+1); setRetryNonce(n => n+1);`. `cardUrl` must append `&_retry=${retryNonce}` so the browser doesn't serve a cached broken-image result for an identical `src` (image error responses are cacheable by some browsers/CDNs; a bare state re-render without a URL change won't necessarily re-fire the network request).

**Critical gap — reset propagation.** `cardUrl` changes in five places today, and every one of them currently does `setImageLoading(true)` without any awareness of `imageFailed` (because `imageFailed` doesn't exist yet):
- `navigateToWeek` (line 89)
- format toggle onClick (line 258)
- template toggle onClick (line 280)
- `handleHighlightSelectChange` (line 126)
- custom-highlight-text onChange (line 327)

If `imageFailed` isn't reset at all five sites, a user who hits a render failure on template A, then switches to template B (a different, possibly-fine render), will see the stale "Preview couldn't render" fallback frozen over a `cardUrl` that was never actually attempted — the mirror image of the bug this PRD fixes. **Every one of the five `setImageLoading(true)` call sites must become `setImageLoading(true); setImageFailed(false);`** (and `retryCount`/`retryNonce` reset only belongs in the true week-nav case per PRD's "does weekIdx change too?" — yes, treat all five identically for consistency, since all five mutate `cardUrl`).

Loading-overlay interplay: don't render the `<img>` element at all when `imageFailed` — mounting a broken `<img src>` alongside a fallback panel risks the browser's native broken-image icon flashing underneath. Structure as `imageFailed ? <FallbackPanel/> : <><LoadingOverlay/><img .../></>`.

---

## 6. Helper placement

`bucketDatesToWeekOffsets(dates: Date[], mondays: Date[]): number[]` must go in **`src/lib/calendar-core.ts`**, not `recap.ts`. Confirmed `recap.ts` is server-tainted: its top-of-file imports include `@/lib/db` (`getDb`, Prisma), `@/lib/program`, `@/lib/records`, `@/lib/game/engine` — exactly the module graph `calendar-core.ts`'s own header comment (lines 1-6) says it was split out from `calendar.ts` to let client components avoid. The helper is pure (`Date[]`/`Date[]` → `number[]`, no IO), directly composes `dateKey`/`startOfWeekMonday` which already live in `calendar-core.ts`, and page.tsx's existing `postedWeeks` bucketing (lines 45-56) is the same pattern already being duplicated by hand — this is squarely a calendar-core-shaped utility, not a recap-domain one. Test file: `src/lib/calendar-core.test.ts` (doesn't exist yet — first test file for this module; matches the co-located `*.test.ts` convention used everywhere else, e.g. `recap.test.ts`, `recap-caption.test.ts`).

---

## 7. First-run copy

The PRD's single proposed copy — *"Nothing to recap for this week yet — log a workout, hike, or project progress and this card fills in."* — reads correctly for offset 0 (an in-progress week) but is **wrong for any past empty week** (offset < 0): a closed week can't "fill in" from future action, so the copy implies an actionable next step that doesn't exist for history. Given the edge case explicitly lists "Zero-goal brand-new user: all 13 weeks empty" as an expected state, this mismatch will be visible on the very first real user to hit it.

**Prescribe two variants, keyed on `offset === 0`:**
- Current week (`offset === 0`): *"Nothing to recap for this week yet — log a workout, hike, or project progress and this card fills in."* (forward-looking, correct)
- Past week (`offset < 0`): *"Nothing logged this week."* (flat, honest, no false call-to-action)

Both stay inside the same empty-state panel/slot; only the string changes based on a value RecapClient already has (`weeks[weekIdx].offset`).

---

## 8. Scope

No leakage found. `recap.ts`'s `emptyWeek` (caption-only) is untouched by this design; `route.tsx` (card route) needs no changes — the fix is entirely "don't request it" client-side, not "make it respond differently." Confirmed via grep that `emptyWeek` has zero references in `RecapCard.tsx`/`route.tsx`/`recap-render.tsx` — the image renderer was never going to change under this PRD regardless.

---

## Critical

1. **Stale-failure-state bug symmetric to the one being fixed** (axis 5): all five `cardUrl`-mutating call sites (`navigateToWeek`, format toggle, template toggle, highlight select, custom-text input) must reset `imageFailed`/`retryCount`/`retryNonce`, or a failure on one template/format/highlight freezes the fallback UI over a `cardUrl` that was never attempted.
2. **`/recap/highlights` fetch is not gated by the PRD's stated success criteria** (axis 4): it runs `computeWeeklyRecap` server-side on every week-nav regardless of `hasData`, reintroducing the exact wasted-compute problem for a different route. Must gate the `weekIdx` effect on `hasData` and short-circuit to `setCandidates([])`.
3. **Control-hiding set is larger than "hide the image"** (axis 4): format/template/highlight/share/download-card/download-stories all imply a renderable card and must all hide on `!hasData` — download-story links in particular hit the same expensive `computeWeeklyRecap`+render path the PRD opens by naming as a problem.

## Concerns

4. `weeksWithData` (page-gate) and `recap.ts`'s `emptyWeek` (caption-gate) are and must remain two different signals — document this explicitly in code, since a project-only week can be "has data" for image-mount purposes while the share caption still says "a quiet week" (out of scope to fix, in scope to not silently misrepresent as solved).
5. First-run copy needs an offset===0 vs offset<0 split (axis 7) — the single PRD-proposed string is actively misleading for past empty weeks.
6. `ScheduledItem` has no index on `completedAt`; `LogEntry`'s indexes are all `goalId`-first while this query is necessarily goal-agnostic — both are full/prefix scans. Non-blocking at current scale; note for future.

## Suggestions

7. Retry cap: N=3, then hide Retry and show a terminal message rather than an unbounded manual-retry affordance against an uncached satori/resvg render.
8. Helper `bucketDatesToWeekOffsets` → `src/lib/calendar-core.ts` (pure, client-safe by charter) + new `src/lib/calendar-core.test.ts`; refactor `postedWeeks` in page.tsx to use it too, since it's the same hand-rolled loop today.

## Verdict: APPROVE-WITH-FIXES
