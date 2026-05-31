# PRD: App-Wide UX Overhaul — Navigation, Today Redesign, Progress Hub, Form Feedback

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-05-31
**Status**: Approved
**GitHub Issue**: https://github.com/jronnomo/workout-planner/issues/18
**Branch**: `feature/ux-overhaul`

Source research: `docs/ux-research/full-app-audit.md` (priority table P1–P10, screen-by-screen inventory, three ASCII mockups).

---

## 1. Overview

### 1.1 Problem Statement
The app is functionally rich but the interaction layer undersells it. The audit found four high-impact problems:

- **P1/P2 — Navigation hides ~7 of ~12 screens.** The 5-tab `BottomNav` exposes only Today / Calendar / Records / Goals / Journal. `/stats`, `/nutrition`, and `/coach` have **no tab** and are effectively orphaned (Stats — the readiness score, the app's most sophisticated surface — is reachable only via a goal "Edit →" deep link). The "Calendar" tab's `match` predicate also lights up for `/days`, `/history`, `/workouts`, and `/import`, so four unrelated screens impersonate one tab.
- **P3 — Inconsistent form feedback.** `LogNutritionForm` resets, confirms, and surfaces errors; `LogMeasurementForm` and `LogNoteForm` do none of this — log your weight and the field just sits there ("did that save?" / double-log risk).
- **P4 — "Today" has no completion state.** Equal-weight cards, the workout doesn't dominate, there's no "done for today" feeling, no rest-day variant, and the `bullseye-pop` celebration keyframe ships in `globals.css` but was **never wired up**.
- **P5 — No loading/error scaffolding + a leaked dev string.** `src/app/page.tsx:98` prints `"plan snapshot is malformed; restore from /goals/<id>/revisions or contact your coach"` straight to the user; there is no `loading.tsx`/`error.tsx` anywhere; empty-state copy ranges from warm to terse.

### 1.2 Proposed Solution
Three coordinated workstreams, all UI-only (no Prisma migration, no MCP tool changes):

1. **Navigation rebuild.** Replace the 5 overloaded tabs with five honest ones — **Today · Plan · Log · Progress · More**. "Plan" owns `/calendar` (+ `/days`). "Log" is a tab that opens a bottom-sheet launcher (Weight · Meal · Note · Import) and has no route of its own. "Progress" is a **new `/progress` landing** that merges readiness + weight charts + a Records summary (with deep links still going to the existing `/baselines/*` and `/stats` pages). "More" opens a bottom-sheet overflow (Coach prompts · Nutrition · History · Journal · Theme). This rescues `/stats` and `/coach` from orphan status and stops one tab from impersonating four screens.

2. **"Today" redesign.** Lead with the day's workout as a hero. Derive a **completion state automatically** from whether a workout was logged/imported for the day (no manual per-block check-off). On the first Today visit after completion, fill a day `Bullseye` and run the existing `bullseye-pop` animation — once per day, remembered in `localStorage` keyed by `dateKey`. Add a **rest-day variant**. Demote weight/note logging out of the main scroll (into the Log sheet) so the workout dominates. Fix the leaked malformed-plan string.

3. **Form-feedback consistency + states scaffolding.** Give `LogMeasurementForm` and `LogNoteForm` the same pending → success-flash → reset + inline-error contract `LogNutritionForm` already has (extract a shared `useFormFeedback` hook). Add `loading.tsx` + `error.tsx` (root, and where cheap, per-section). Normalize the worst empty-state/error copy to one warm coach voice.

### 1.3 Success Criteria
- Every top-level screen is reachable from the bottom nav in ≤ 2 taps; `/stats` (via Progress) and `/coach` (via More) are no longer orphaned.
- No nav tab's active state lights up for an unrelated route family (the "Calendar"-owns-four-screens bug is gone).
- Logging weight or a note shows an explicit success confirmation and resets the field, matching nutrition.
- Today renders the override-aware workout as a clear hero with a derived "Completed / In progress / Rest day" state; the `bullseye-pop` fires exactly once on the first post-completion visit per day.
- `src/app/page.tsx` no longer leaks the malformed-plan instruction string to the user.
- `npx tsc --noEmit`, `npm run lint`, `npm run build` all clean; every flow verified at 390 px.

---

## 2. User Stories

| ID     | As Gabe, I want to... | So that... | Priority |
|--------|------------------------|------------|----------|
| US-001 | reach Stats/readiness and Coach prompts from the nav | I stop losing the app's best screens | Must Have |
| US-002 | tap a nav tab and land where the label promises | I can predict where a tap goes | Must Have |
| US-003 | see a clear confirmation when I log weight or a note | I trust it saved and don't double-log | Must Have |
| US-004 | open Today and immediately see today's workout as the hero | the app feels like a coach's card, not a form list | Must Have |
| US-005 | get a small reward when the day's workout is done | the daily ritual feels satisfying | Should Have |
| US-006 | see a calm "rest day" treatment on rest days | I'm not shown an empty/!confusing workout slot | Should Have |
| US-007 | log weight/meal/note quickly from anywhere via one launcher | I never wonder "where do I log this" | Should Have |
| US-008 | see one Progress hub with readiness + weight + records together | I get a single glanceable health view | Should Have |
| US-009 | never see a raw developer instruction string in the UI | the app stays trustworthy and warm | Must Have |

---

## 3. Functional Requirements

### 3.1 Core Requirements
1. **BottomNav** relabeled to `Today · Plan · Log · Progress · More` with corrected `match` predicates: Today=`/`; Plan=`/calendar`+`/days`; Progress=`/progress` (active also on `/stats`,`/baselines`); More=no active route (sheet trigger). The `/history`,`/workouts`,`/import` routes must **not** light up "Plan" as a primary identity (acceptable: none active, or a subtle inherited state — but never mislabeled). Active glyph stays the filled `Bullseye`; fix the inactive 6px-spacer so the nav reads as icon+label, not text-only.
2. **LogLauncher** (client, bottom-sheet) opened by the "Log" tab: rows Weight · Meal · Note · Import. Weight/Meal/Note expand inline mini-forms (reuse the existing `LogMeasurementForm`/`LogNutritionForm`/`LogNoteForm`); Import is a row that navigates to `/import`. Sheet does not change the route.
3. **MoreSheet** (client, bottom-sheet) opened by the "More" tab: rows Coach prompts (`/coach`) · Nutrition (`/nutrition`) · History (`/history`) · Journal (`/journal`) · a Theme control (reuse/relabel `ThemeToggle`).
4. **Bottom-sheet primitive** shared by LogLauncher + MoreSheet: backdrop `opacity 0→1` 160ms ease-out; panel `translateY(100%)→0` 220ms `cubic-bezier(.16,1,.3,1)`; close reverse 180ms; `prefers-reduced-motion` → instant; focus trap; `Esc` + backdrop-tap close; return focus to the triggering tab on close; `role="dialog"`/`aria-modal`.
5. **`/progress` page** (new, server component): per-goal readiness (score + `ReadinessChart` + `ReadinessBreakdown`), weight card (current/start/Δ + `WeightChart`), and a **Records summary** (status pills + top exercise PRs + tests due) whose rows deep-link to `/baselines/test/[name]` and `/baselines/exercise/[name]`. `/stats` and `/baselines` remain valid routes (not deleted).
6. **Today redesign** (`src/app/page.tsx`): workout hero (override-aware via `resolveDay(now)`); a derived completion state — **Completed** if a workout exists with `startedAt` within `[startOfDay(now), endOfDay(now)]`, else **Planned/In progress**, else **Rest day** when the resolved day has no workout blocks; a `DayBullseye` reflecting completion; demote weight/note out of the main scroll (now in the Log sheet); keep Nutrition + Recent workouts; fix the malformed-plan fallback string.
7. **bullseye-pop wiring**: on Today, when completion is true AND `localStorage["goaldmine.celebrated.<dateKey>"]` is unset, add the `.bullseye-pop` class to the day Bullseye once and set the flag. Client island only; respects reduced-motion (CSS already guards it).
8. **Form-feedback contract** for `LogMeasurementForm` + `LogNoteForm`: pending state, inline `--danger` error on throw, transient `--success` confirmation line that auto-clears (~1500ms), `formRef.reset()` on success. Extract a `useFormFeedback` hook (or shared component) capturing the `LogNutritionForm` pattern; optionally refactor `LogNutritionForm` to use it (no behavior regression).
9. **States scaffolding**: add `src/app/loading.tsx` and `src/app/error.tsx` (root). Where a route's first paint is notably heavy (Today, Progress, Calendar), add a route-level `loading.tsx`. Fix the `page.tsx:98` leaked string to warm copy.

### 3.2 Secondary Requirements
10. Normalize the harshest empty-state copy to one warm voice (e.g. "No measurements yet." → a short coach line). Do not rewrite every string — target the terse/leaky ones only.
11. Accessibility pass on **new/changed** surfaces only: every new interactive element ≥44×44px; `focus-visible:ring-2 ring-[var(--accent)]` on new links/buttons; charts on `/progress` get an `aria-label` summarizing trend + latest value; replace any new semantic emoji with text/`MarkerIcon`.
12. Update `.claude/quality-tools.md` browser-smoke tab list (currently "Today, Calendar, Records, Goals, Journal") to the new model — **docs only, optional, non-blocking**.

### 3.3 Out of Scope
- No Prisma schema/migration changes. No MCP tool additions or input-schema changes.
- No manual per-block workout check-off (explicitly rejected — completion is derived).
- No calendar density redesign (P6), no shared `Stat`/`Chip` primitive extraction beyond what these screens force (P7), no theme-toggle 3-state redesign beyond relabeling inside More (P10), no workout-detail table redesign. These are follow-on.
- No streaks/history-of-completion persistence beyond the per-day `localStorage` celebration flag.
- `/stats` and `/baselines` are **not** removed or redirected.

---

## 4. Technical Design

### 4.1 Data Model (Prisma)
**N/A** — no schema changes. The "completion" state is derived at read time from existing `Workout.startedAt`. The celebration "seen" flag lives in `localStorage`, not the DB.

### 4.2 MCP Tool Surface
**N/A** — no new or modified MCP tools. (Final user report still notes "no MCP change → no claude.ai connector reload needed".)

### 4.3 Server Actions
No new mutations. Existing actions in `src/lib/workout-actions.ts` (`logMeasurement`, `logNote`, `logNutrition`) are reused by the Log sheet. **Verify** each calls `revalidatePath("/")` (and relevant routes) so the Today hero + Progress reflect new logs; if `logMeasurement`/`logNote` are missing `revalidatePath`, add it (this is the likely reason the current forms feel "silent" beyond the missing UI confirmation).

| Action | FormData fields | Mutation | revalidatePath calls | Redirect? |
|--------|------------------|----------|----------------------|-----------|
| `logMeasurement` (verify) | weightLb, restingHr?, notes? | create Measurement | ensure `/`, `/progress`, `/stats` | No |
| `logNote` (verify) | body, type | create Note | ensure `/`, `/journal` | No |
| `logNutrition` (existing) | mealType, items, notes? | create NutritionLog | ensure `/`, `/nutrition` | No |

### 4.4 Pages / Components
**New routes**
- `src/app/progress/page.tsx` — server component (the merged hub).
- `src/app/loading.tsx`, `src/app/error.tsx` — root scaffolding (`error.tsx` must be a client component per Next 16).
- Optional `src/app/progress/loading.tsx`, `src/app/loading.tsx` skeletons.

**New components** (`src/components/`)
- `BottomSheet.tsx` — client; shared sheet primitive (backdrop + panel + focus trap + a11y). Props: `open`, `onClose`, `title`, `children`.
- `LogLauncher.tsx` — client; the Log-tab sheet content (rows + inline mini-forms).
- `MoreSheet.tsx` — client; the More-tab sheet content.
- `useFormFeedback.ts` (hook in `src/lib/` or `src/components/`) — captures pending/error/saved + reset.
- `DayHero.tsx` (or inline in `page.tsx`) — the Today workout hero + completion state.
- `TodayCelebration.tsx` — small client island that wires `bullseye-pop` via `localStorage` per `dateKey`.
- `RecordsSummary.tsx` — client/server; condensed records block reused on `/progress` (extracted from `baselines/page.tsx` logic where practical).

**Modified**
- `src/components/BottomNav.tsx` — relabel + match fixes + integrate sheet triggers (Log, More become buttons that open sheets, not `Link`s). Likely needs the sheets rendered as siblings with shared open-state, so BottomNav becomes the sheet host.
- `src/app/page.tsx` — Today restructure; remove inline Log weight/note cards; fix `:98` string.
- `src/app/layout.tsx` — only if the sheet host must live above `<BottomNav>` (e.g. portal root). Prefer keeping it inside `BottomNav`.
- `src/components/LogMeasurementForm.tsx`, `src/components/LogNoteForm.tsx` — adopt feedback contract.

**Navigation**: BottomNav is the single source. Deep entry points kept: Today "+ Import" pill may now route to the Log sheet's Import row or stay as-is (keep as a direct `/import` link to avoid regressions). The pending-notes card's "Coach prompts →" link stays.

### 4.5 Date / Time Semantics
- Completion check uses `startOfDay(now)`/`endOfDay(now)` from `@/lib/calendar` (already imported in `page.tsx`). **No raw `setHours`/`getDate`.**
- The celebration `localStorage` key uses `dateKey(now)` from `@/lib/calendar` — computed server-side and passed to the client island as a prop (the client must not recompute "today" with raw `Date` to avoid a TZ split between server render and client).
- `/progress` reuses the same measurement/readiness queries as `/stats` — no new date math.

### 4.6 Override-Awareness
- Today's hero workout MUST come from `resolveDay(now).workoutTemplate` (already the case at `page.tsx:54`) — preserve this. Rest-day detection = resolved day has no non-baseline workout blocks. Do not regress to `getTodayContext().day` for the workout.
- No new `PlanDayOverride` fields.

### 4.7 Third-Party Dependencies
**None.** No new packages. Bottom sheets are hand-rolled with CSS transitions (no Framer Motion). Recharts stays the only chart lib.

---

## 5. UI/UX Specifications

### 5.1 Screen Descriptions (390 px)

**BottomNav + sheets** (Mockup A):
```
├──────────────────────────────────────────┤
│  ◉        ▦        ⊕        ▲        ⋯     │
│ Today   Plan     Log    Progress  More    │
└──────────────────────────────────────────┘
  Log ▸ sheet:                 More ▸ sheet:
  ⚖ Weight  (inline form)      ◎ Coach prompts
  ☷ Meal    (inline form)      ☷ Nutrition
  ✎ Note    (inline form)      ◷ History
  ⤓ Import  → /import          ◴ Journal
                               ⚙ Theme: System ▸
```

**Today** (Mockup B, derived completion — no manual checkboxes):
```
┌──────────────────────────────────────────┐
│  WEEK 4 · PHASE 2 · STRENGTH + CAPACITY    │
│  Push + Hike Prep              ◉ Completed  │  ← DayBullseye + derived state
│  Sat, May 31 · 50 min                      │
│  ┌────────────────────────────────────┐    │
│  │ 1. STRENGTH · straight             │    │  ← hero block(s), read-only
│  │   DB Bench Press      4× 8   65 lb │    │
│  │ 2. FINISHER · 3 rounds             │    │
│  └────────────────────────────────────┘    │
│  ─────────────  rest of day  ───────────    │
│  ☷ Nutrition  3 of 6 meals      view →     │
│  ◷ Recent workouts              all  →     │
└──────────────────────────────────────────┘
   Rest-day variant: hero → "Rest day — recover"
   + hike-prep tip; no block list.
```
States: **Completed** (workout logged today → filled Bullseye + once-per-day pop), **Planned** (no log yet → outline Bullseye, "today's plan"), **Rest day** (no blocks → calm recover card). Weight/note logging moves to the Log sheet (a small "⊕ Log" hint may remain).

**Form feedback** (Mockup C): after submit → `✓ Logged 158.4 lb` in `--success`, fades after ~1.5s, field reset; on error → `⚠ Couldn't save — tap to retry` in `--danger`. Reserve the line height to avoid layout shift.

### 5.2 Navigation Flow
Entry: app opens to Today. Bottom nav always visible. Log/More open sheets over the current screen (route unchanged) → dismiss returns to it. Progress → tap a record row → `/baselines/...` deep page → back returns to `/progress`. Coach/Nutrition/History/Journal reached via More sheet → normal routes.

### 5.3 Responsive + Mobile-First Spec
- 390 px primary; sheets `max-w-md mx-auto`, full-width on phone, rounded top corners, safe-area padding (`pb-[env(safe-area-inset-bottom)]`).
- All sheet rows ≥48px; nav tap targets stay `py-3` (≥44px).
- Tokens only: `var(--accent)`, `var(--accent-fg)`, `var(--border)`, `var(--card)`, `var(--muted)`, `var(--success)`, `var(--danger)`. No hardcoded colors.
- Number inputs keep `text-base` (avoid iOS zoom); fix text inputs that use `text-sm` on focus where touched.

### 5.4 Accessibility
- Sheets: `role="dialog"`, `aria-modal="true"`, labelled by the sheet title; focus trap; `Esc`/backdrop close; focus returns to trigger.
- New buttons/links: visible `focus-visible:ring-2 ring-[var(--accent)]`.
- `/progress` charts: `aria-label` summarizing direction + latest value (or a visually-hidden table).
- Completion state announced as text ("Completed"/"Rest day"), not color-only.
- Respect `prefers-reduced-motion` on every transition (sheet + bullseye-pop already guarded).

---

## 6. Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|------------------|
| No active program | Today shows existing "No active program" card; nav still works; Log sheet still opens (weight/note loggable). |
| Empty data (no workouts/measurements) | Today = Planned/Rest; Progress shows warm empty states; no crash. |
| Malformed plan snapshot | Today shows a warm fallback line (NOT the dev string); ideally `error.tsx` catches hard throws. |
| Workout logged late at night across midnight | Completion uses `startOfDay/endOfDay` (USER_TZ) — a workout `startedAt` yesterday does not mark today complete. |
| Celebration already seen today | No pop on reload; `localStorage["goaldmine.celebrated.<dateKey>"]` set; calm "Completed". |
| `localStorage` unavailable (private mode) | Celebration silently degrades to "may pop each visit" or no pop; never throws (wrap in try/catch like the theme script). |
| Rest day with a logged workout anyway | Treat as Completed (a logged workout wins over rest-day classification). |
| Override sets a different workout | Hero reflects the override (`resolveDay`), not the rotation default. |
| Sheet open + user navigates via browser back | Sheet closes (state resets on route change) — verify no stuck backdrop. |
| Long meal/note text in sheet | Inline form scrolls within the sheet; sheet caps height (`max-h-[85vh]` + internal scroll). |
| DST week on Progress | Readiness/weight queries unchanged — already through existing helpers. |

---

## 7. Security Considerations
- No new routes bypass auth (dashboard auth is the existing model; `/progress` is same-tier as `/stats`).
- No `dangerouslySetInnerHTML` on user content (the only such use is the existing theme script with a static string — unchanged).
- No raw SQL; Prisma only. No new external calls.
- `localStorage` writes wrapped in try/catch; keys namespaced `goaldmine.*`.

---

## 8. Acceptance Criteria
1. [ ] `npx tsc --noEmit` passes with 0 errors.
2. [ ] `npm run lint` introduces no new errors.
3. [ ] `npm run build` (Turbopack) succeeds, incl. `/progress` and the new sheets.
4. [ ] BottomNav shows `Today · Plan · Log · Progress · More`; no tab's active state lights up for an unrelated route family.
5. [ ] Tapping "Log" opens a bottom sheet with Weight/Meal/Note inline forms + an Import row → `/import`; route does not change.
6. [ ] Tapping "More" opens a bottom sheet with Coach/Nutrition/History/Journal/Theme; each row navigates correctly.
7. [ ] `/progress` renders readiness + weight + records summary at 390px; record rows deep-link to `/baselines/...`; `/stats` and `/baselines` still load.
8. [ ] Logging weight via the sheet shows a `--success` confirmation and resets the field; same for a note; errors show a `--danger` line.
9. [ ] Today renders the override-aware workout hero with a derived Completed/Planned/Rest-day state.
10. [ ] With a workout logged today, the first Today visit pops `bullseye-pop` once; a reload does not re-pop (localStorage flag per `dateKey`).
11. [ ] `src/app/page.tsx` contains no user-facing "plan snapshot is malformed; restore from /goals…" string.
12. [ ] `loading.tsx` + `error.tsx` exist at root; `error.tsx` is a client component with a reset action.
13. [ ] All Date math goes through `@/lib/calendar`; `grep -n 'setHours\|getDate()\|getMonth()\|getFullYear\|getHours' src/app src/components` shows no new violations in changed app code.
14. [ ] Bottom sheets are keyboard-accessible (Esc closes, focus trapped, focus returns to trigger) and respect `prefers-reduced-motion`.
15. [ ] No new npm dependency added; Recharts remains the only chart lib.

---

## 9. Open Questions
**None — all resolved in Phase 1.** Recorded decisions:
1. Progress = new `/progress` landing; `/stats` + `/baselines/*` stay valid. 
2. Log tab = sheet-only (no route); Weight/Meal/Note inline, Import → `/import`.
3. Celebration fires once per day via `localStorage` keyed by `dateKey`.
4. Coach prompts live in the More sheet.
5. Completion is derived from a logged workout (no manual check-off).
6. Git flow: feature branch + tracking GH issue → review → merge to main.

---

## 10. Test Plan

### 10.1 Typecheck / Lint / Build
- `npx tsc --noEmit` clean; `npm run lint` no new errors; `npm run build` succeeds.

### 10.2 MCP curl smoke
N/A (no MCP changes). One regression sanity check: `tools/list` still returns the existing surface unchanged.

### 10.3 Browser smoke (390px, `npm run dev`)
- Nav: each of Today/Plan/Progress navigates; Log + More open/close sheets (tap backdrop, Esc, focus return).
- Log sheet: log weight → success + reset; log note → success + reset; log meal → success; Import → `/import`.
- Today: hero renders; with today's workout logged, pop fires once, reload = calm; delete/none logged = Planned; rest day = recover card; malformed plan = warm copy (no dev string).
- Progress: readiness + weight + records render; deep links work; `/stats` + `/baselines` still load.
- Reduced-motion: enable OS setting → sheets + pop are instant.
