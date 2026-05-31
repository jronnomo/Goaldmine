# Goaldmine — Full-App UX Audit

_Holistic review of every shipped screen and the cross-screen interaction model. Single-user personal coaching app; the user trains toward Mt. Elbert (159 → 155 lean, Black Cloud Trail) and coaches in claude.ai while this app is the data/dashboard surface over an MCP server._

Scope: 22 routes under `src/app/**`, the global shell (`AppHeader` + `BottomNav` + `ThemeToggle`), and the shared component kit (`Card`, `Bullseye`, `CalendarMonth`, chart trio, `Log*`/`Edit*` forms). Every claimed problem cites `file:line`. Mobile-first target ≤390px. Animations CSS-transition-first; Recharts is the only chart lib; date math via `@/lib/calendar` (`USER_TZ` = America/Denver).

---

## Priority-ranked summary

| # | Finding | Severity | User impact | Rough scope |
|---|---------|----------|-------------|-------------|
| P1 | **Navigation hides 3 of the app's daily-use screens.** BottomNav has only 5 tabs (Today / Calendar / Records / Goals / Journal). `/stats`, `/nutrition`, and `/coach` have **no tab and no reliable link** — Stats and Coach are effectively orphaned. | High | Can't reach key screens; dead-ends | `BottomNav.tsx`, maybe an overflow/"More" affordance |
| P2 | **Tab labels don't match destinations.** "Calendar" tab also owns `/history`, `/workouts`, `/import`; "Records" routes to `/baselines` whose H1 says "Records" but URL/back-links say "Records"/"Baselines" inconsistently; Calendar's top-right link says "List view" but lands on a page titled "History". | High | Mental-model confusion; user can't predict where a tap goes | `BottomNav.tsx:11-19`, `calendar/page.tsx:41-46`, `history/page.tsx:24` |
| P3 | **Form feedback is inconsistent across the app.** `LogNutritionForm` resets + shows inline errors; `LogMeasurementForm` and `LogNoteForm` do **neither** — no success confirmation, no reset, no error surface. After logging weight the field just sits there. | High | User unsure whether the action took; double-logging risk | `LogMeasurementForm.tsx`, `LogNoteForm.tsx` |
| P4 | **"Today" is a long scroll of equal-weight cards with no completion state.** Home stacks workout blocks, weight, nutrition, note, recent — all the same `Card`. There's no "today is done" feeling, no check-off, no rest-day treatment, and the Bullseye-pop celebration keyframe exists but is **never wired up**. | High | The core daily ritual feels like a form list, not a coach | `page.tsx`, `Card.tsx`, `globals.css:96-108` |
| P5 | **No global empty/loading/error scaffolding.** Every page is `force-dynamic` server-rendered with no `loading.tsx`/`error.tsx`; empty states are ad-hoc per page (some warm, some terse); the malformed-plan path prints a raw instruction string to the user. | Medium | Cold/janky first paint; inconsistent voice; scary error copy | add `loading.tsx`/`error.tsx`, `page.tsx:98` |
| P6 | **Calendar grid is dense and the day-detail panel duplicates the day page.** 7-col grid at ~48px cells with stacked marker icons is tight at 390px; selecting a day shows an in-grid panel that largely repeats `/days/[dateKey]`. Month nav uses two small pill links, no swipe. | Medium | Cramped tap targets; redundant surfaces | `CalendarMonth.tsx`, `calendar/page.tsx:49-63` |
| P7 | **Typographic + spacing drift between screens.** Page H1s are consistent (`text-2xl`), but stat tiles, pill chips, status colors, and "→" link affordances are re-implemented per page (`Stat` defined 3×, `StatusPill` once, ad-hoc chips). | Medium | Subtle inconsistency; harder to maintain | shared `Stat`/`Pill`/`StatusChip` primitives |
| P8 | **Accessibility gaps.** Calendar day cells are 13px icon clusters; some tap targets <44px (top-right pill links `py-0.5`); charts have no text alternative; `aria-pressed` used but no focus-visible styling on most interactive divs/links; emoji 🏔️ used as semantic marker without label. | Medium | Harder for low-vision / keyboard / a11y | `BottomNav`, header pills, charts |
| P9 | **Logging rhythm is split between the app and claude.ai with no bridge.** Weight/nutrition/notes log in-app; workouts come via `/import` paste **or** claude.ai; baselines log in-app **or** claude.ai. The user must remember which surface does what; `/coach` (the prompt cheat-sheet) is unreachable from the nav. | Medium | Friction deciding "where do I do this" | nav + a unified "Log" entry point |
| P10 | **Theme toggle is a 3-state glyph with no labels; brand motif under-used.** `◐/☀/☾` cycle is cryptic; the Bullseye/target motif only appears in nav + goal rows; the mountaineering (Mt. Elbert) motif is just a 🏔️ emoji. | Low | Minor polish; brand opportunity left on the table | `ThemeToggle.tsx`, brand surfaces |

---

## Screen-by-screen inventory

### Global shell — `layout.tsx`, `AppHeader.tsx`, `BottomNav.tsx`
- **Shows:** sticky 48px brand strip (Logo + "Goaldmine" wordmark + ThemeToggle, `AppHeader.tsx:14-25`); `<main>` with `pb-20` to clear the fixed bottom nav (`layout.tsx:66`); fixed 5-tab bottom nav (`BottomNav.tsx:27`).
- **Interactions:** tab nav with a filled `Bullseye` as the active indicator (`BottomNav.tsx:40-44`); theme cycle.
- **As-is:** Clean, properly mobile-first, backdrop-blur on both bars. Pre-paint theme script avoids flash (`layout.tsx:57-62`). **Problems:** (P1) only 5 destinations exist for ~12 top-level screens — `/stats`, `/nutrition`, `/coach` are not tabs. (P2) the "Calendar" tab's `match` swallows `/days`, `/history`, `/workouts`, `/import` (`BottomNav.tsx:12-18`), so four different page identities all light up the same tab. The active glyph is a 6px Bullseye — tiny, and the inactive state reserves a 6px spacer (`BottomNav.tsx:43`) so there's no icon at all when inactive, making the nav read as text-only.

### Today / Home — `page.tsx`
- **Shows:** week/phase eyeline + "+ Import" pill (`page.tsx:76-88`), big day title + date + summary (`page.tsx:89-100`), then a vertical stack: pending-notes card (conditional), baseline block, workout blocks, a "test + workout pairing" advisory, Log weight, Nutrition, Log a note, Recent workouts.
- **Interactions:** log weight, log note, log nutrition (via `NutritionToday`), navigate to import/coach/journal/history.
- **As-is:** Dense but informative. **Problems:** (P4) everything is the same flat `Card` with equal visual weight — the workout (the point of the day) doesn't dominate; there's no "done for today" state, no per-exercise check-off, no rest-day variant. The malformed-plan fallback prints `"plan snapshot is malformed; restore from /goals/<id>/revisions or contact your coach"` **directly to the user** (`page.tsx:98`). The celebratory `bullseye-pop` keyframe is defined and documented as "React plumbing intentionally deferred" (`globals.css:96-108`) — the reward moment is unbuilt. Benchmark: Apple Fitness/Whoop lead with a single hero ring + a short "today" line; the form clutter (weight/note) would live behind a "+".

### Calendar — `calendar/page.tsx` + `CalendarMonth.tsx`
- **Shows:** month grid with legend-driven marker icons per day, a selected-day detail panel, Legend card, "This month" stat tiles (Completed/Hikes/Overrides/Tests due), goal footer.
- **Interactions:** prev/next month (pill links with `?y=&m=`), tap a day to select (in-grid panel), "Open day →" to `/days/[dateKey]`, "List view" → `/history`.
- **As-is:** Thoughtful — legend icons are goal-specific, not generic dots (`CalendarMonth.tsx:3-10`), tz-stable selection via `dateKey` (`CalendarMonth.tsx:58-65`), completed days get a soft gold halo (`CalendarMonth.tsx:125-126`). **Problems:** (P6) cells are `min-h-[3.75rem]` with 13px stacked icons — at 390px the 7 columns leave ~44px of width, and multi-marker days wrap and crowd. The selected-day panel (`CalendarMonth.tsx:161-225`) substantially duplicates `/days/[dateKey]`, creating two day surfaces. Month nav is two small pills (`calendar/page.tsx:50-62`) with no swipe gesture. The empty-month notice (`calendar/page.tsx:74-79`) renders **below** the legend/stat cards, so an empty month still shows full chrome.

### Day detail — `days/[dateKey]/page.tsx`
- **Shows:** date H1, plan context line (week/day/title, goal-date, override flag), conditional baseline card, logged-vs-planned workout, nutrition, custom guidance, day notes, and — for today/future — a `DayOverrideForm` (raw JSON textarea) + `DayNoteForm`.
- **Interactions:** view logged workout, edit-this-day override, send Claude a date-tagged note.
- **As-is:** Strong override-aware logic. **Problems:** the `DayOverrideForm` exposes a **raw JSON blob** of the workout template as the edit surface (`days/[dateKey]/page.tsx:174-181`) — powerful but hostile on a phone; this is a power-user escape hatch masquerading as the primary edit path. Past/today/future branching produces very different page shapes with no visual cue about which mode you're in beyond the context line.

### Coach prompts — `coach/page.tsx`
- **Shows:** a setup card + 9 copy-paste prompt cards (daily check-in, log Strong workout, audibles, weekly review, etc.) each with a `CopyPromptButton`.
- **As-is:** Genuinely useful — this is the "how to talk to your coach" manual. **Problems:** (P1/P9) **not in the BottomNav at all.** Only entry point is the pending-notes card on Home (`page.tsx:116-120`), which only appears when notes are pending. So the single most onboarding-critical screen is nearly unreachable. The prompts are a flat list with no search/filter; on a small screen 9 `<pre>` blocks is a long scroll.

### History — `history/page.tsx`
- **Shows:** weight-trend `WeightChart`, then a list of up to 50 workouts (title, datetime, source, exercise count).
- **As-is:** Clean list. **Problems:** (P2) titled "History" but reached via a tab labeled "Calendar" and a link labeled "List view" — three names for one place. Weight trend appears here **and** on Stats **and** (implicitly) on Today's measurement card → the weight chart lives in two places with no canonical home. No filtering/grouping by week or phase.

### Workout detail — `workouts/[id]/page.tsx`
- **Shows:** title/datetime/source, `ShareWorkout` (format toggle: Strong/Markdown/Plain/JSON + copy/download), per-exercise cards of sets, notes, source URL.
- **As-is:** The `ShareWorkout` component is a highlight — clean segmented toggle, copy-with-confirmation (`ShareWorkout.tsx:24-28`), download. Set formatting is robust (`workouts/[id]/page.tsx:109-124`). **Problems:** minor — every exercise is its own full `Card`, so a 6-exercise workout is 6 bordered boxes (heavy scroll); Strong/Hevy show a tighter table. No PR badges inline (the data exists in `/baselines`).

### Stats — `stats/page.tsx`
- **Shows:** per-goal readiness (big score/100 + `ReadinessChart` trend + `ReadinessBreakdown`), weight card (current/start/Δ + `WeightChart`), totals (workouts/baselines/hikes).
- **As-is:** The readiness score is the app's most sophisticated surface and a great glanceable metric. **Problems:** (P1) **no nav tab** — only reachable via the Goal detail "Edit →" deep link or a `/goals` "Add a goal" link; the user likely never finds it. Weight duplicates History (P2-adjacent). "best-effort estimate" / "appears once you have two weeks of data" copy is good but the page is otherwise unreachable, so the effort is hidden.

### Nutrition — `nutrition/page.tsx` + `nutrition/[id]/edit/page.tsx`
- **Shows:** log-a-meal form, then meals grouped by day (last 30 days), each meal editable.
- **As-is:** `LogNutritionForm` is the **best-behaved form in the app** — time-of-day default meal slot (`LogNutritionForm.tsx:17-23`), inline error, reset on success (`LogNutritionForm.tsx:36-44`). **Problems:** (P1) no nav tab; reached only via Today's "All →" link (`page.tsx:155`). No daily macro/protein roll-up despite the planned-meal macros existing in `NutritionToday` (`NutritionToday.tsx:43-52`) — the user logs food but gets no aggregate back.

### Journal — `journal/page.tsx`
- **Shows:** log-a-note form, pending notes (`PendingNotes`), resolved notes (dimmed).
- **As-is:** Coherent; warm empty state ("The journal's clean", `journal/page.tsx:34-36`). **Problems:** overlaps Today's "Log a note" card and Day detail's `DayNoteForm` — three note-entry points with subtly different framing (free-form vs date-tagged). The note `type` taxonomy (Journal/Audible/Feedback) is mentioned in placeholder text but not visually distinguished in the resolved list.

### Goals — `goals/page.tsx`, `[id]`, `[id]/plan`, `[id]/revise`, `[id]/revisions/[revisionId]`
- **Shows:** goal list with `Bullseye progress=` rings + days-out chips + active badge; tapping a non-focused goal **sets it active** via a server-action form (`goals/page.tsx:95-103`). Detail page: readiness, plan overview, pending notes, changelog, references, edit. Plan page: full rotation by "Day N". Revise: `ReviseForm`. Revision detail: before/after `SnapshotView` diff.
- **As-is:** The richest area of the app and the cleanest use of the Bullseye motif (`goals/page.tsx:69-73`). The set-active-by-tapping pattern is clever but **non-obvious** — a whole row is a submit button with no affordance saying "tap to make active" (`goals/page.tsx:96-99`); a user expects tap → detail, but tap → mutate. The "View →" chip is the actual detail link, easy to miss. Revisions/diff flow is genuinely impressive for a personal app.

### Baselines / Records — `baselines/page.tsx` + `new`, `test/[testName]`, `exercise/[name]`, `results/[id]/edit`
- **Shows:** status pills (Done/Due/Overdue/Upcoming), scheduled tests with checkpoint status, "other logged tests", exercise PRs. Detail pages show `HistoryChart` trends.
- **As-is:** Dense but well-structured; status color system is clear (`baselines/page.tsx:193-204`). **Problems:** (P2) the page H1 is "Records" (`baselines/page.tsx:18`) and the nav tab is "Records", but the route is `/baselines` and every back-link says "← Records" — fine, but "Baselines" (scheduled tests) and "Records" (exercise PRs) are two different concepts crammed under one "Records" tab. Four-up status pills at 390px get tight.

### Import — `import/page.tsx` + `ImportForm`
- **Shows:** paste-a-Strong-txt textarea + a format-reference card.
- **As-is:** Focused, single-purpose, good example block. **Problems:** reached via three different "+ Import" pills (Today, History, Calendar→) but is itself owned by the "Calendar" tab in nav state (P2). No drag-drop / file upload, only paste.

---

## Cross-cutting findings

### Navigation model
The BottomNav is the spine, but it covers only **5 of ~12 top-level destinations** (`BottomNav.tsx:7-22`). `/stats`, `/nutrition`, `/coach` are reachable only through contextual links, and one of those (`/coach`) only appears when notes are pending. The `match` predicates also overload tabs: tapping the "Calendar" tab is the only nav route to History, Workouts, and Import, none of which are calendars. **This is the single highest-leverage fix** — see Mockup A. AppHeader is purely brand + theme; it carries no navigation, so there's no secondary nav layer to absorb the overflow.

### Card / form / typography consistency
- **Cards:** one shared `Card` (`Card.tsx`) used everywhere — good. But it's used at one weight for everything from "the workout you're about to do" to "log a note", flattening hierarchy (P4).
- **Stat tiles:** a local `Stat` helper is re-defined in `calendar/page.tsx:114`, `stats/page.tsx:152`, and the pattern recurs in `baselines` as `StatusPill` — three implementations of the same visual. Promote to one shared primitive (P7).
- **Chips/pills:** days-out chips (`goals/page.tsx:105-115`), status chips (`baselines`), the "+ Import"/"List view" outline pills, and the "planned" badge (`NutritionToday.tsx:58-60`) are all bespoke. A `Chip`/`Badge` primitive with `tone` would unify them.
- **Forms:** **inconsistent feedback contract** (P3). `LogNutritionForm` (reset + error) vs `LogMeasurementForm`/`LogNoteForm` (fire-and-forget, no confirmation). All forms use `text-base` on number inputs (good — avoids iOS zoom) but `text-sm` on text inputs, which **does** trigger iOS zoom on focus.
- **Typography:** H1s are uniform `text-2xl font-semibold tracking-tight`; the `font-display` serif (DM Serif Display) is used **only** in the wordmark (`AppHeader.tsx:18`) — a distinctive brand asset spent on one word. Section H2s are `text-base`. Consistent, if under-expressed.

### Mobile-first ergonomics (≤390px)
- Bottom nav reserves space correctly (`pb-20`). Good.
- Tap targets: nav links are `py-3` (44px+) — good. But several secondary affordances are sub-44px: header pills at `px-2 py-0.5` (`page.tsx:84`, `history/page.tsx:27`), the calendar month-nav pills, the "Edit" links in nutrition (`nutrition/page.tsx:78-83`), and calendar day cells where the real target is a cluster of 13px icons.
- The `DayOverrideForm` raw-JSON textarea on a phone is the worst ergonomic offender.
- Four-up stat/pill grids (`grid-cols-4`) on calendar and baselines get cramped under ~360px.

### Empty / loading / error states
- **No `loading.tsx` or `error.tsx` anywhere** — every route is `force-dynamic`, so first paint waits on DB with no skeleton.
- Empty states range from warm ("Nothing to aim at yet", "The journal's clean") to terse ("No measurements yet.") to **leaking implementation** (the malformed-plan string on Home, `page.tsx:98`). No single voice.
- Charts guard their own empty/single-point cases inconsistently (Stats gates on `series.length > 1`, History just renders).

### Logging rhythm & the "Today" feel
The app is a **dashboard that mostly reflects state logged elsewhere** (claude.ai). In-app you can log weight, nutrition, notes, baselines, and import workouts; but the marquee daily artifact — the completed workout — typically arrives via paste or via claude.ai. Today therefore reads as "here's your plan + some side forms" rather than "here's your day, check it off, celebrate." There's no progress ring for the day, no streak, no completion affordance, and the one celebration primitive is unwired (`globals.css:96-108`). This is the biggest experiential gap (P4) and the most on-brand opportunity given the Bullseye motif.

### Accessibility
- Bullseye has a thoughtful a11y contract (role/label/hidden precedence, `Bullseye.tsx:166-172`) — reuse that rigor elsewhere.
- Gaps: charts have no text alternative or `aria-label` summarizing the trend; many interactive `<Link>`/`<div>` lack `focus-visible` rings (only the theme button and nav have hover/focus treatment); 🏔️ emoji is used as a semantic goal-date marker (`calendar/page.tsx:102`, `days/[dateKey]/page.tsx:53`) without an accessible label; small touch targets noted above; color-only status encoding in baselines (Done/Due/Overdue rely on `--success/--warning/--danger` text color with the word, which is OK, but the calendar halo is color-only).
- Contrast: `--muted` on `--card` is heavily used for primary content (prescriptions, metadata). In light mode `#7A5E3A` on `#FFFBF0` ≈ 5.1:1 (passes AA for normal text, barely); in dark `#9C8866` on `#1A130C` ≈ 5.6:1 (passes). At 11–12px (chart axes, chips) this is borderline for AA-large vs normal — worth a spot check.

---

## Mockups for the highest-impact opportunities

Phone width ≈ 390px. CSS-transition-first; no new libraries.

### Mockup A — Fix navigation (P1/P2): 5 honest tabs + a "More" sheet

The cleanest fix keeps 5 tabs but makes each tab _mean one thing_, and moves overflow into a bottom sheet opened from a 5th "More" tab (or a long-press). Recommended split: **Today · Plan · Log · Progress · More**.

```
┌──────────────────────────────────────────┐
│  ◎ Goaldmine                         ◐    │  AppHeader (unchanged)
├──────────────────────────────────────────┤
│                                            │
│            ( current screen )              │
│                                            │
├──────────────────────────────────────────┤
│  ◉        ▦        ⊕        ▲        ⋯     │  BottomNav (relabeled)
│ Today   Plan     Log    Progress  More    │
└──────────────────────────────────────────┘
        tap "More" ▸ slides up a sheet:

┌──────────────────────────────────────────┐
│  More                                  ✕   │
├──────────────────────────────────────────┤
│  ◎  Coach prompts        how to ask Claude │
│  ☷  Nutrition            meals + macros    │
│  ◷  History              past workouts     │
│  ⤓  Import               paste Strong txt  │
│  ◴  Journal              notes & feedback  │
│  ⚙  Theme: System ▸                        │
└──────────────────────────────────────────┘
```

- **Today** = `/` · **Plan** = `/calendar` (+ `/days`) · **Log** = a new entry hub or `/nutrition`+weight+note · **Progress** = `/stats` (readiness + weight + records, the natural home for charts; absorb `/baselines` here or keep "Records" and demote Stats — see open question) · **More** = sheet to Coach/Nutrition/History/Import/Journal/Journal/Theme.
- This rescues `/stats` and `/coach` from orphan status and stops the "Calendar" tab from impersonating four screens.

Component hierarchy:
```
BottomNav (client)
├─ NavTab ×4  (Bullseye active glyph, ≥44px)
└─ MoreTab → opens <MoreSheet/>
MoreSheet (client, portal/fixed)
├─ backdrop (fade 160ms ease-out)
├─ panel (translateY 100%→0, 220ms cubic-bezier(.16,1,.3,1))
└─ MoreRow ×N (icon + label + sub-label, ≥48px)
```
Interaction/animation: backdrop `opacity 0→1` 160ms; panel `transform: translateY(100%)→translateY(0)` 220ms `cubic-bezier(0.16,1,0.3,1)`; on close reverse at 180ms. `prefers-reduced-motion` → instant. Trap focus in sheet; `Esc`/backdrop-tap closes; first row gets focus on open.

### Mockup B — "Today" with hierarchy + completion (P4)

Lead with the workout as a hero, demote logging into a single "+" launcher, add a day-progress Bullseye that fills as blocks are checked, and wire the `bullseye-pop` reward.

```
┌──────────────────────────────────────────┐
│  WEEK 4 · PHASE 2 · STRENGTH + CAPACITY    │
│                                            │
│  Push + Hike Prep            ◍ 2/4 done    │  ← day Bullseye, progress fill
│  Sat, May 31 · 50 min                      │
│                                            │
│  ┌────────────────────────────────────┐   │
│  │ 1. STRENGTH · straight              │ ✓ │  ← tap row → check-off
│  │   DB Bench Press      4× 8   65 lb  │   │
│  │   Incline DB Press    3× 10  45 lb  │   │
│  ├────────────────────────────────────┤   │
│  │ 2. FINISHER · 3 rounds              │ ○ │
│  │   Push-ups            3× AMRAP      │   │
│  │   Hollow Hold         3× :55        │   │
│  └────────────────────────────────────┘   │
│                                            │
│  ─────────────  rest of day  ───────────   │
│  ⚖ 158.4 lb logged 7:12a        edit       │  ← collapsed once logged
│  ☷ Nutrition  3 of 6 meals      view →     │
│                                            │
│            ⊕  Log something                │  ← one launcher (weight/meal/note)
└──────────────────────────────────────────┘
```

On the last block check, the day Bullseye fills its final ring and runs `bullseye-pop` (already in `globals.css:100-108`) — the first real reward moment in the app.

Component hierarchy:
```
TodayPage (server)
├─ DayHeader (week/phase, title, DayBullseye progress=done/total)
├─ WorkoutHero (server shell)
│  └─ BlockCard (client island) ── checkbox toggles local "done" → fills DayBullseye
├─ RestOfDay
│  ├─ WeightRow (collapsed summary if logged, else inline form)
│  └─ NutritionRow (n of 6 meals)
└─ LogLauncher (client) → bottom sheet: Weight | Meal | Note
```
Notes: check-off state is the only thing needing `"use client"`; persist via a lightweight server action (optimistic `useTransition`). Fill animation = `Bullseye` ring `transition: none` (SVG) but wrap the swap in `bullseye-pop` on completion. Rest-day variant: hero becomes "Rest day — recover" with a hike-prep tip instead of blocks.

### Mockup C — Consistent form feedback (P3)

Give every `Log*` form the same contract `LogNutritionForm` already has: pending → success flash → reset, with inline error.

```
┌─ Log weight ──────────────────────────────┐
│  [ 158.4   ] [ RHR ]                        │
│  [ context on this weigh-in (optional)   ]  │
│  [        Log weight        ]               │
└────────────────────────────────────────────┘
            after submit (1.2s):
┌─ Log weight ──────────────────────────────┐
│  ✓ Logged 158.4 lb · 7:12a                  │  ← --success text, fades after 1.5s
│  [        Log weight        ]               │
└────────────────────────────────────────────┘
            on error:
│  ⚠ Couldn't save — tap to retry             │  ← --danger text
```
Interaction: reuse the `useTransition` + `formRef.reset()` + `setError` pattern from `LogNutritionForm.tsx:36-44`; add a transient `saved` boolean that renders a `--success` line, auto-cleared via `setTimeout(...,1500)` (mirrors `ShareWorkout.tsx:26-28`). CSS: success line `opacity` transition 200ms. No layout shift — reserve the line's height.

---

## Recommendation

**Do P1 (navigation) and P3 (form-feedback consistency) first** — they're high-impact, low-scope quick wins that touch one file each (`BottomNav.tsx`, the two log forms) and immediately stop screens from being unreachable and actions from feeling silent. **Then invest in P4 (the "Today" redesign)** as the flagship improvement: it's the screen the user opens daily, it's where the Bullseye/mountaineering brand should sing, and it converts the app from "data entry + dashboard" into "a coach's daily card with a satisfying check-off." P5–P10 are follow-on polish (shared primitives, a11y pass, calendar density, brand expression) best done as a consistency sweep once the nav and Today are settled.

### Suggested scope (files to touch)

- **P1 nav:** `src/components/BottomNav.tsx` (relabel + `match` fixes); new `src/components/MoreSheet.tsx`; minor edits to the "+ Import"/"List view" link labels in `page.tsx`, `history/page.tsx`, `calendar/page.tsx`.
- **P3 forms:** `src/components/LogMeasurementForm.tsx`, `src/components/LogNoteForm.tsx` (adopt the nutrition-form contract); optionally extract a `useFormFeedback` hook.
- **P4 Today:** `src/app/page.tsx` (restructure), new `BlockCard` client island + `DayBullseye` usage of existing `Bullseye progress=`, `LogLauncher` sheet, a server action for block check-off; wire `bullseye-pop` (already in `globals.css`). Fix the leaked malformed-plan string (`page.tsx:98`).
- **P5 states:** add `src/app/loading.tsx` + `src/app/error.tsx` (+ per-section skeletons); normalize empty-state copy.
- **P7 primitives:** new `src/components/Stat.tsx`, `Chip.tsx`/`Badge.tsx`; replace local copies in `calendar/page.tsx`, `stats/page.tsx`, `baselines/page.tsx`, `goals/page.tsx`.

### Accessibility checklist for any of the above
- Every new interactive element ≥44×44px; add `focus-visible:ring-2 ring-[var(--accent)]` to links/buttons that lack it.
- `MoreSheet`: focus trap, `Esc`/backdrop close, `aria-modal`, return focus to the More tab on close.
- Day-completion check-offs: real `<button aria-pressed>` (follow `CalendarMonth.tsx:144-149`), not clickable divs.
- Charts: add an `aria-label` summarizing direction + latest value, or a visually-hidden data table.
- Replace semantic 🏔️ markers with the `MarkerIcon`/`Bullseye` system + text labels.
- Respect `prefers-reduced-motion` on all transitions (the `bullseye-pop` rule already does).

---

## Open questions — RESOLVED (decided by user 2026-05-31)

The four open questions have been decided. The nav model below is now the agreed target.

1. **4th tab → "Progress" (merged).** A single Progress hub combines readiness charts (`/stats`) **and** baseline tests + exercise PRs (`/baselines`). Stats is no longer orphaned; `/baselines` is absorbed here.
2. **Logging → dedicated "Log" tab.** A 3rd "Log" tab opens a launcher sheet: **Weight · Meal · Note · Import**. Quick meal-log lives here; the full Nutrition history/macro view stays in the More sheet.
3. **Today check-off → derived, not manual.** No per-block tapping. "Done" is derived automatically from whether a workout was logged/imported for that date. The `bullseye-pop` reward fires when that derived completion flips true.
4. **Coach prompts → More sheet.** Lives in the More overflow alongside Nutrition / History / Journal / Theme.

### Agreed nav model

`Today · Plan · Log · Progress · More`

- **Today** = `/` — hero workout, derived completion + `bullseye-pop`.
- **Plan** = `/calendar` (+ `/days`).
- **Log** = launcher sheet → Weight · Meal · Note · Import.
- **Progress** = `/stats` + `/baselines` merged (readiness + weight + Records/PRs).
- **More** = sheet → Coach prompts · Nutrition (full + macros) · History · Journal · Theme.
