# PRD: Glance Back, Forge Ahead — Two-Date Snapshot Comparison

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-07-02
**Status**: Approved
**GitHub Issue**: N/A — direct commit
**Branch**: `feature/phase1-auth` (current active dev line)
**UX-research**: invoked (see §9)

---

## 1. Overview

### 1.1 Problem Statement
Gabe's motto is *"glance back, forge ahead."* The app logs a rich calendar of metrics — workouts, PRs, baseline tests, body weight, wearables, nutrition, project metrics like MRR — but there is no way to feel the accumulated weight of consistency. Trend charts show slopes; nothing answers *"who was I on March 1 versus who am I today?"* in one glance. That emotional payoff — the gravity of following through on a plan — is the missing product moment.

### 1.2 Proposed Solution
A two-date snapshot comparison. Pick any two dates; for each date the app resolves the **latest-known value of every tracked metric as of end-of-day** (not what happened on that day) and renders a beautiful, mobile-first side-by-side with direction-aware deltas: per-goal targets + readiness %, strength PRs, baseline tests, body & wearables, "the work between" consistency counters, and trailing 7-day nutrition averages.

It ships on two surfaces sharing one core lib (`computeComparison` in `src/lib/compare.ts`): a `/compare` page (entered via presets, native date inputs, or a two-tap compare mode on the calendar) and a `compare_dates` MCP read tool so the claude.ai coach can narrate the same comparison in conversation.

### 1.3 Success Criteria
- `/compare?a=2026-03-01&b=2026-07-02` renders every metric family with correct as-of values and direction-aware improved/regressed coloring at 390 px.
- `compare_dates` returns the identical `ComparisonResult` JSON via MCP curl.
- Calendar compare mode: two taps land on `/compare` with the right params, including across month navigation.
- Readiness numbers on `/compare` are byte-identical to `/progress` for the same as-of date (same `computeReadiness` code path).
- All QA gates clean: `tsc --noEmit`, lint, build, vitest, MCP curl smoke, browser smoke.

---

## 2. User Stories

| ID     | As Gabe... | I want to... | So that... | Priority |
|--------|------------|--------------|------------|----------|
| US-001 | in the PWA | pick two dates and see every metric side by side with deltas | I feel the gravity of months of follow-through | Must Have |
| US-002 | in the PWA | one-tap presets (30 days ago / goal created / program start → today) | the payoff is zero-effort | Must Have |
| US-003 | on the calendar | tap "Compare", then two days | comparison flows from where I already browse my history | Must Have |
| US-004 | in claude.ai | ask "how far have I come since March?" and have Claude call `compare_dates` | my coach narrates the comparison with real numbers | Must Have |
| US-005 | in the PWA | see project-goal metrics (Chewgether MRR) compared the same way as fitness | the feature is goal-generic, not Elbert-hardcoded | Must Have |
| US-006 | in the PWA | see "new since then" badges for metrics that didn't exist at date A | sparse early logging still tells a true story | Should Have |
| US-007 | in the PWA | see "the work between" (workouts, hikes, elevation, XP earned between the dates) | the delta is grounded in the work that produced it | Should Have |

---

## 3. Functional Requirements

### 3.1 Core Requirements
1. **Snapshot-as-of semantics.** For each metric and date D: latest value with timestamp ≤ `endOfDay(D)` (USER_TZ). Never "what was logged on D".
2. **Date normalization.** If `b < a`, swap (flag `swapped`). Future dates clamp to today (`clampedToToday`). `a === b` computes normally with a friendly note (`sameDay`).
3. **Goal sections** — one per active goal (focus first), each with: readiness % pair (via `computeReadiness(targets, asOf, goalId)`) and one row per `GoalTarget` (values read from the returned `breakdown`, matched by `target.metric`). Goals created after date A skip the A side entirely (`createdAfterA: true`, rendered "didn't exist yet"). Goals with no targets render `readiness: null`, `targets: []`.
4. **Strength PRs** — per canonical exercise (`canonicalExerciseName`), direction-aware best-as-of each date via `bestSetSummary` over ONE `workoutExercise.findMany` (completed workouts, `startedAt ≤ cutB`, include sets + `workout.startedAt`). Time-kind exercises: best = minimum. Kind mismatch A vs B → recompute A using B's primary metric; incomparable → `newSinceA`.
5. **Baseline tests** — per `testName`, direction-aware best-as-of from ONE `baseline.findMany({ date ≤ cutB })`. Direction: `metricKindFor(testName)` → any active goal's `baseline:<testName>` target direction → `"increase"`.
6. **Body & wearables** — latest `Measurement.weightLb` / `bodyFatPct` ≤ each cutoff; latest `BodyMetric` per key ≤ each cutoff (registry keys first, ad-hoc keys after; tie-break `[{date desc},{createdAt desc}]` like `get_body_metrics`). Weight direction from an active goal's `weightLb` target if present, else `neutral`; `bodyFatPct` = `decrease`.
7. **Consistency counters** — between-window `(cutA, cutB]`: workouts completed, hikes completed + Σ elevationFt + Σ distanceMi, baseline tests, notes logged, XP earned, level A→B. Plus cumulative as-of pairs (workout count, total elevation, total distance) as `CompareEntry`s.
8. **Nutrition** — trailing 7-day window ending on each date: avg daily calories/protein/carbs/fat over **logged days only**, adherence `daysLogged/7`. USER_TZ day bucketing via `dateKey()`. Zero logged days → null side.
9. **`/compare` page** — server component, `force-dynamic`, defaults `a = today−30`, `b = today`; malformed params fall back to defaults.
10. **`compare_dates` MCP read tool** — `{ a: DateKeyShape, b?: DateKeyShape }` (b defaults to today), returns `ComparisonResult` via `safe()`.
11. **Calendar compare mode** — two-tap selection state machine in `CalendarMonth.tsx`, persists across month navigation via `sessionStorage`, navigates to `/compare?a=…&b=…`.
12. **XP as-of** — expose full date-stamped `events: XpEvent[]` on `GameState` (additive engine change); `xpAsOf(key) = Σ events where e.dateKey ≤ key` (lexicographic compare).

### 3.2 Secondary Requirements
1. Extract shared `StatTile` component from the duplicated tile idiom in `progress/page.tsx` / `calendar/page.tsx`.
2. `MoreSheet` nav row: "Compare — Glance back, forge ahead".
3. `hasAnyDataA: false` → hero banner "Nothing was logged as of {A} — everything below is new since then."
4. Delta chips animate on load with the existing `macro-flash` accent wash (reduced-motion-guarded).

### 3.3 Out of Scope
- Satori/next-og shareable comparison card (planned fast-follow).
- "What happened ON each day" activity view (day pages already exist).
- Comparing more than two dates; comparing date *ranges*.
- Any schema change or migration. Any new dependency.
- Mobility check-ins as a compared metric (no meaningful scalar; revisit later).

---

## 4. Technical Design

### 4.1 Data Model (Prisma)
**No schema changes. No migration.** All reads hit existing indexed tables: `Goal`, `Workout`/`WorkoutExercise`/`Set`, `Baseline`, `Measurement`, `BodyMetric`, `Hike`, `Note`, `NutritionLog`, `LogEntry` (via `computeReadiness`'s `log:` branch), `GameBonusXp` (via game engine).

### 4.2 MCP Tool Surface

| Tool name | Purpose | Read/Write | Notes |
|-----------|---------|------------|-------|
| `compare_dates` | Two-date snapshot comparison across all metric families | Read | New; registered in `registerReadTools` after `weekly_summary_data` |

- **Title**: "Two-date snapshot comparison (glance back, forge ahead)"
- **Description** (claude.ai-facing): "Side-by-side snapshot of every tracked metric as of two dates — latest-known value ≤ end of each day, NOT what happened on that day. Covers per-goal targets + readiness, strength PRs, baseline tests, body/wearable metrics, consistency counters between the dates (workouts, hikes, XP/level), and trailing-7-day nutrition averages. Use for 'how far have I come since X', 'compare today vs program start', 'progress since goal creation'. Dates auto-normalize (swapped if b < a, clamped to today). b defaults to today."
- **inputSchema**: `{ a: DateKeyShape.describe("Earlier date, yyyy-mm-dd"), b: DateKeyShape.optional().describe("Later date, yyyy-mm-dd; defaults to today") }` (reuse existing `DateKeyShape`, tools.ts:102)
- **Return shape**: `ComparisonResult` (see 4.4a) — named sections `goals[]`, `strength[]`, `baselines[]`, `body[]`, `counters`, `nutrition`
- **Curl**:
  ```sh
  curl -s -X POST http://localhost:3000/api/mcp \
    -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"compare_dates","arguments":{"a":"2026-03-01","b":"2026-07-02"}}}'
  ```

### 4.3 Server Actions
N/A — this feature is read-only. No mutations, no `revalidatePath` needed. The `/compare` date form is a plain `<form method="get">` (URL params, no action).

### 4.4 Pages / Components

**a) `src/lib/compare-core.ts` (new, pure, client-safe).** Types: `CompareEntry { key, label, units, valueA, valueB, delta, deltaPct, direction: "increase"|"decrease"|"neutral", improved: boolean|null, formattedA, formattedB, formattedDelta, newSinceA }`; `GoalCompareSection { goalId, objective, kind, createdAfterA, readiness: CompareEntry|null, targets: CompareEntry[] }`; `CountersSection { between: {...}, cumulative: CompareEntry[] }`; `NutritionCompareSection { windowDays, daysLoggedA, daysLoggedB, entries: CompareEntry[] }`; `ComparisonResult { dateA, dateB, swapped, sameDay, clampedToToday, spanDays, generatedAt, hasAnyDataA, goals, strength, baselines, body, counters, nutrition }`. Helpers: `buildEntry(...)` (delta/deltaPct/improved/formatting; `improved` = null when delta 0 or direction neutral, else sign vs direction), `formatValue(value, units)` (sec → `formatDuration` from `@/lib/formatters/types`, floats 1-decimal, ints `toLocaleString`, null → "—"), `normalizeDateRange(a, b, todayKey)`, `directionForMetricKind`. Imports only pure modules — safe for client components.

**b) `src/lib/compare.ts` (new, server-only).** `computeComparison(aKey, bKey): Promise<ComparisonResult>` per §3.1. DB via `getDb()`; `workoutExercise` via `prisma` matching `records.ts` convention. Parallelize: goal readiness chains + family queries under `Promise.all`. Skip A-side readiness when `createdAfterA` (perf + honesty).

**c) `src/app/compare/page.tsx` (new, server, `force-dynamic`).** `max-w-md mx-auto p-4 space-y-4`. Await `searchParams`; validate `/^\d{4}-\d{2}-\d{2}$/`. Layout top-to-bottom: hero header (DM Serif Display dates, → glyph, `spanDays` subtitle, swapped/clamped/sameDay muted notes) → preset chips (`Link`s; omit anchors that don't exist: goal created via focus goal `createdAt`, program start via active plan `startedOn`) → date form (two native `<input type="date">` + submit, thumb-reachable) → `hasAnyDataA` banner if applicable → per-goal Cards (readiness big-number pair + DeltaRow list) → Strength Card → Baselines Card → Body Card → "The work between" StatTile grid Card → Nutrition Card.

**d) `src/components/compare/DeltaRow.tsx` (new, server-safe).** Props `{ entry: CompareEntry }`. Label left; `font-mono` `formattedA → formattedB` right; delta chip `text-[var(--success)]` / `text-[var(--danger)]` / `text-[var(--muted)]` by `improved`; `newSinceA` → `bg-[var(--accent-soft)] text-[var(--accent)]` "new" pill with `valueA` "—".

**e) `src/components/StatTile.tsx` (new, server-safe).** `{ label, value, tone? }` — `rounded-lg border py-2 text-center` tile. Used by compare page; migrating existing duplicates is optional follow-up, not v1 scope.

**f) `src/components/CalendarMonth.tsx` (modified, already client).** Compare mode: `"normal" | "selectA" | "selectB"` + `compareA: string | null`. Pill row above grid ("⇄ Compare" / "Cancel"), `aria-live="polite"` hint line ("Pick the first day" / "Pick the second day — {A} selected"). In-mode day taps route to compare selection instead of `setSelectedKey`; `DayDetail` hidden while in mode. First pick: `ring-2 ring-[var(--accent)]` + tiny "A" chip. Tap-A-again → deselect. Second pick → `router.push('/compare?a=<min>&b=<max>')` (lexicographic). Persist `{mode, compareA}` in `sessionStorage['goaldmine.compareMode']` (month nav is full-page `Link`); clear on cancel and on successful navigate.

**g) `src/components/MoreSheet.tsx` (modified).** Add `/compare` row.

**h) `src/lib/game/types.ts` + `src/lib/game/engine.ts` (modified, additive).** `GameState.events: XpEvent[]` — engine already builds `allEvents` (engine.ts ~L852 puts it on `EngineContext`); also add `events: []` to the empty state. No behavior change to existing consumers.

**Navigation**: no `BottomNav` slot change. Entry points: calendar compare mode, MoreSheet, direct URL, claude.ai deep-linking the URL.

### 4.5 Date / Time Semantics
- All date math via `@/lib/calendar-core`: `parseDateKey`, `dateKey`, `startOfDay`, `endOfDay`, `addDays`. Cutoffs: `endOfDay(parseDateKey(key))`. Between-window: `{ gt: cutA, lte: cutB }`.
- MCP inputs are strict `DateKeyShape` dateKeys → `parseDateKey` (no `parseDateInput` needed).
- dateKey strings compare lexicographically (safe for swap/clamp/XP sums).
- Nutrition windows: `[startOfDay(addDays(parseDateKey(key), -6)), endOfDay(parseDateKey(key))]`, bucketed by `dateKey()`.

### 4.6 Override-Awareness
N/A by design: snapshot comparison reads **logged history**, never the per-day prescription, so `resolveDay` / `PlanDayOverride` are not consulted. (The rejected "what happened on day X" semantics would have needed them.)

### 4.7 Third-Party Dependencies
None.

---

## 5. UI/UX Specifications

### 5.1 Screen Descriptions

`/compare` at 390 px (populated state):

```
┌──────────────────────────────────┐
│ Glance back, forge ahead         │  ← DM Serif Display
│ Mar 1 → Jul 2 · 123 days         │
│ [Last 30 days][Goal created][⋯]  │  ← preset chips
│ [ 2026-03-01 ] [ 2026-07-02 ][Go]│  ← native date form
├─ Mt. Elbert ─────────────────────┤
│   Readiness   22% → 74%   ▲ +52  │  ← big-number pair
│   Weight    168.2 → 159.0  -9.2 ✓│  ← DeltaRow (✓=success tint)
│   1.5-Mile  14:50 → 12:58 -1:52 ✓│
│   Pack hikes    1 → 9       +8 ✓ │
├─ Chewgether ─────────────────────┤
│   MRR          $0 → $180  +180 ✓ │
│   Followers   [new since then]   │  ← accent pill
├─ Strength PRs ───────────────────┤
│   Goblet Sq  est1RM 58 → 87 +29 ✓│
├─ The work between ───────────────┤
│  [41 workouts][9 hikes][12,400ft]│  ← StatTile grid
│  [+3,120 XP · Lv 4 → Lv 7]       │
├─ Nutrition (7-day avg) ──────────┤
│   Protein   121g → 168g   +47 ✓  │
│   Logged    3/7  → 7/7           │
└──────────────────────────────────┘
```

States: **empty-A** (hero banner + all "new" pills), **same-day** (note under header), **loading** (server-rendered, none), **error** (malformed params → silently use defaults).

Calendar compare mode: pill row above grid; hint line replaces DayDetail; first pick ringed with "A" chip; second tap navigates.

### 5.2 Navigation Flow
Entry: calendar "⇄ Compare" pill → two taps → `/compare`; MoreSheet → `/compare` (defaults); direct URL / claude.ai link. Exit: browser back returns to calendar (mode cleared via sessionStorage cleanup); bottom nav persists throughout.

### 5.3 Responsive + Mobile-First Spec
Primary 390 px; tap targets ≥ 44 px (preset chips and calendar pills `min-h-11`); `<Card>` containers; CSS-var tokens only (`--accent`, `--accent-soft`, `--success`, `--danger`, `--muted`, `--border`, `--card`); Geist Mono for numeric pairs; long exercise names truncate with `truncate` + full text in `title`.

### 5.4 Accessibility
- Delta meaning never carried by color alone: signed numbers + `improved` conveyed via chip glyph (▲/▼ or ✓) and `aria-label` ("improved"/"regressed").
- Section Cards get `aria-label` summaries (mirror `/progress` pattern).
- Compare-mode hint is `aria-live="polite"`; day cells expose `aria-pressed` for compare selection.
- Date inputs have associated `<label>`s; visible focus rings.

---

## 6. Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|------------------|
| `b < a` | Normalize-swap; `swapped: true`; muted "dates reordered" note |
| `a === b` | Compute (deltas 0, between-counters 0); "Same day selected" note |
| Future date | Clamp to today; `clampedToToday: true`; muted note |
| Malformed page params | Regex-validate → fall back to defaults (no error page) |
| Malformed MCP input | Rejected at Zod layer (`DateKeyShape`) |
| Date A pre-logging | `hasAnyDataA: false` → hero banner; every row "—" + "new" pill; no throws |
| Goal created after A | `createdAfterA: true`; A side "didn't exist yet"; A-side readiness skipped |
| Metric at B, not at A | `newSinceA: true`; delta "—"; no improved/regressed coloring |
| Value at A but not B | Impossible under as-of semantics after normalization (rows ≤ A ⊆ rows ≤ B) — assert in comment |
| Goal with zero targets | `readiness: null`, `targets: []`; card renders "No measurable targets" |
| No active program | `levelChange: null`, XP 0; "Program start" preset omitted |
| Exercise kind mismatch A/B | Recompute A with B's primary metric; incomparable → `newSinceA` |
| No nutrition rows in a window | That side's nutrition entries null; adherence "0/7" |
| DST inside a window/span | All boundaries via calendar-core (DST-safe); no wall-clock arithmetic |
| Long text overflow | `truncate` + `title` attr |

---

## 7. Security Considerations
- No new routes bypass auth: `/compare` sits behind the existing signed-in layout; `compare_dates` behind MCP bearer/OAuth like every read tool.
- All user scoping automatic via `getDb()` (SCOPED_MODELS); `workoutExercise` reached through scoped-workout relation filters (match `records.ts` convention exactly).
- Read-only feature: no mutations, no raw SQL, no `dangerouslySetInnerHTML`, no new env vars.
- MCP inputs Zod-validated; page params regex-validated before `parseDateKey`.

---

## 8. Acceptance Criteria

1. [ ] `npx tsc --noEmit` — 0 errors
2. [ ] `npm run lint` — no new errors
3. [ ] `npm run build` — succeeds
4. [ ] `npm test` — all pass, including new `compare-core.test.ts` + `compare.test.ts`
5. [ ] `compare_dates` appears in MCP `tools/list` with title/description above
6. [ ] `tools/call compare_dates {a:"2026-03-01"}` returns `ComparisonResult` with `dateB` = today, all six sections present
7. [ ] `tools/call compare_dates {a:"2026-07-02", b:"2026-03-01"}` returns `swapped: true` with normalized dates
8. [ ] `tools/call compare_dates {a:"03/01/2026"}` rejected at Zod layer
9. [ ] `/compare` renders defaults (today−30 → today) with no params at 390 px
10. [ ] `buildEntry` unit matrix: increase/decrease × positive/negative/zero delta × null sides — `improved` correct in all cells (weight 168→159 with decrease-direction target ⇒ improved; 1.5-mile 890s→778s ⇒ improved)
11. [ ] Time-kind exercise best-as-of = minimum ≤ cutoff (unit-tested)
12. [ ] Goal created after A: `computeReadiness` called exactly once for that goal (unit-tested)
13. [ ] Empty DB ⇒ `hasAnyDataA: false`, no throws (unit-tested)
14. [ ] Nutrition bucketing: a 00:30 UTC row lands on prior Denver day (unit-tested)
15. [ ] No raw `getDate()/setHours/getMonth()/getFullYear()` in new/changed app code (grep clean; calendar-core only)
16. [ ] `CalendarMonth` compare mode: two taps produce `/compare?a=<min>&b=<max>`; cancel restores normal; state survives month navigation (sessionStorage)
17. [ ] `GameState.events` exposed; existing game tests still green
18. [ ] Readiness value for a given (goal, asOf) identical between `/compare` and `/progress`

---

## 9. Open Questions

*(all resolved — kept for the record)*
- Semantics → snapshot-as-of. Surface → page + MCP tool. Picking → calendar two-tap + presets. Share card → fast-follow. Metric families → all four + nutrition 7-day averages. Goal scope → all active, grouped.
- UX research: **completed** — `docs/ux-research/glance-back-forge-ahead.md` (+ pixel mockup `.html`, the visual source of truth). Chosen direction: "The Span, earned and disciplined." Adopted findings amend §4.4/§5 via `.feature-dev/2026-07-02-glance-back-forge-ahead/agents/architecture-blueprint-v2-ux-amendment.md`: `HeroSpan` (DM-Serif span + paired-Bullseye readiness), tri-state ▲/▼/– delta chips (dark-mode regressed chip keeps foreground digits + danger/40 border — AA fix), density-ordered sections with native `<details>` overflow, minimal conditional `StrikeBand` on genuine level-up only (UXR-19 minimal; readiness-band trigger deferred), calendar pill on-state + cross-month recall row, macro-flash reveal with QA strobe check. Dropped/deferred: ReadinessChart reuse (UXR-20), gravity line (UXR-21), client-heavy ideas (UXR-22).

---

## 10. Test Plan

### 10.1 Typecheck / Lint / Build
`npx tsc --noEmit` · `npm run lint` · `npm run build` — all clean.

### 10.2 MCP curl smoke
With dev server running (see §4.2 curl): (1) `tools/list` contains `compare_dates`; (2) happy path a=2026-03-01, b=2026-07-02 → full `ComparisonResult`; (3) b omitted → `dateB` = today; (4) reversed dates → `swapped: true`; (5) `a: "03/01/2026"` → Zod rejection.

### 10.3 Browser smoke
1. `npm run dev`, 390 px, light + dark.
2. `/compare` no params → defaults render; every section card present.
3. Each preset chip → correct params; date form round-trips.
4. `a` before first log → banner + "new" pills.
5. Calendar → Compare pill → tap two days (incl. one across a month boundary) → correct `/compare` URL; Cancel path; tap-A-again deselect.
6. Cross-check one metric per family against curl output (UI and MCP must agree).

### 10.4 Migration verification
N/A — no migration.

### 10.5 Unit tests (vitest, `npm test`)
- `compare-core.test.ts` (no mocks): `buildEntry` matrix, `formatValue` (sec/lb/pct/null), `normalizeDateRange` (swap/sameDay/future-clamp).
- `compare.test.ts`: mock `@/lib/db` (dual-export `prisma` + `getDb` per repo convention), `@/lib/readiness`, `@/lib/game/engine`. Scenarios: full assembly; createdAfterA skip; time-kind min; baseline direction fallback chain; empty DB; nutrition TZ bucketing.

---

## 11. Appendix

### 11.1 Discovery Notes
User chose snapshot-as-of over on-that-day comparison ("who was I then vs now"); wants all four metric families + trailing-7-day nutrition; all active goals grouped (goal-generic per the goal-progress-bars memory — never hardcode Elbert); calendar two-tap + presets; share card deferred. Key insight from exploration: `computeReadiness`/`resolveMetricValue` are already asOf-parameterized and kind-agnostic, so no schema work is needed; the feature is mostly assembly + presentation.

### 11.2 References
- Plan file: `~/.claude/plans/validated-squishing-wren.md` (approved 2026-07-02)
- Reuse surfaces: `src/lib/readiness.ts:164` (`computeReadiness`), `src/lib/records.ts:730` (`bestSetSummary`), `:157` (`canonicalExerciseName`), `:204` (`metricKindFor`), `src/lib/metrics-registry.ts` (`resolveBodyMetric`, `GoalTarget`), `src/lib/formatters/types.ts:31` (`formatDuration`), `src/lib/snapshot-diff.ts` (diff-presentation precedent), `src/app/progress/page.tsx` (Current/Start/Δ tile idiom)
- Related memories: goal-progress-bars-are-goal-generic; planJson-snapshot-not-source-template (not applicable — no plan reads)
