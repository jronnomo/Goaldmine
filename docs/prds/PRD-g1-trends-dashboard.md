# PRD: Trends Dashboard (`/trends`)

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-09-02
**Status**: Draft
**GitHub Issue**: N/A — solo flow, no issue
**Branch**: `feature/phase1-auth` (current; no new branch)
**Companion PRD**: `docs/prds/PRD-g2-apple-health-import.md` (supplies `HealthDaily`; see §4.9 Seam)
**UX-research**: invoked — see `docs/ux-research/trends-dashboard.md` + ledger

---

## 1. Overview

### 1.1 Problem Statement

Weight and nutrition are logged in the same app but can never be looked at together. `Measurement.weightLb` is charted on `/progress` (Body composition) and `/history`; `NutritionLog` calories and macros are charted **nowhere** — `/nutrition` shows a meal *list* and a today-only macro banner. So the single most important question a cutting/bulking user has — *"is what I'm eating actually moving my weight, and by how much?"* — cannot be answered inside Goaldmine at all.

Worse, the question is usually **period-scoped**, not global. "How did my vacation eating affect me?" needs an arbitrary sub-window (Aug 3 → Aug 12) with its own averages, not a lifetime average. `/compare` looks adjacent but is a different primitive: it diffs *state at instant A vs state at instant B*, and has no notion of aggregating everything *between* two dates.

### 1.2 Proposed Solution

A new route **`/trends`**: one screen, one shared time axis, three stacked charts — weight (7-day trailing mean over recessive raw readings, reusing the existing `weight-chart-core` math), daily calories, and macro composition (P/C/F). Above them, range chips (30d / 90d / All) set the *outer* range. On any chart, **dragging horizontally selects a sub-window**; all three charts and a stat panel below immediately re-scope to it. The window lives in the URL (`?from=&to=`) so it is shareable, bookmarkable and back-button-correct, and there is a keyboard-accessible date-input fallback because a drag gesture is not accessible on its own.

The stat panel is where the insight lives: average calories and macros over the window, weight delta and rate, **observed TDEE** (derived from intake plus the weight slope), **measured TDEE** (Apple active+basal energy, when `HealthDaily` rows cover the window) shown *beside* it with the gap called out, adherence against the plan's daily macro targets, and — always, non-optionally — a **coverage line** stating how many of the window's days actually have data.

Coverage is load-bearing, not decoration. Unlogged days are **excluded** from averages, never zeroed and never interpolated. A 10-day vacation with 3 logged meals days must read `avg 2,410 kcal · 3 of 10 days logged`, so the number can be discounted by the reader rather than silently lying. Every derived number (especially TDEE) is gated behind explicit sufficiency thresholds and returns `null` with a machine-readable reason when unmet.

### 1.3 Success Criteria

1. `/trends` renders weight, calories and macros on one shared, honest time axis at 390 px.
2. Dragging across any chart sets a sub-window; the stat panel recomputes with **zero server round-trip** (the aggregate math is pure and runs client-side over an already-fetched series).
3. The window survives a reload and is shareable as a link (URL-synced via `history.replaceState`). **Back leaves the page rather than stepping through windows** — window changes deliberately create no history entries (§4.4).
4. Averages exclude unlogged days and the coverage line is always visible.
5. Observed TDEE appears only when the sufficiency gates pass; otherwise the panel states *why* it can't be computed.
6. `get_trend_window` returns numbers **byte-identical** to the page for the same window (shared pure core), so claude.ai and the PWA never disagree.

---

## 2. User Stories

| ID | As a... | I want to... | So that... | Priority |
|----|---------|--------------|------------|----------|
| US-001 | user in the PWA | see weight, calories and macros on one time axis | I can see whether intake is moving my weight | Must Have |
| US-002 | user in the PWA | drag across the chart to select a period (e.g. a vacation) | I get that period's averages without doing math | Must Have |
| US-003 | user in the PWA | see how many days in the window actually have data | I know how much to trust the averages | Must Have |
| US-004 | user in the PWA | see an estimated TDEE from my own intake + weight change | I know my real maintenance calories, not a calculator's guess | Must Have |
| US-005 | user in the PWA | see Apple's measured expenditure next to that estimate | the gap tells me whether my logging is accurate | Must Have |
| US-006 | user in the PWA | see average macros vs my plan's targets over the window | I know if I'm actually hitting protein | Should Have |
| US-007 | the coach (Claude via MCP) | read the same window aggregate | my coaching numbers match what the user sees on screen | Must Have |
| US-008 | user with a keyboard / screen reader | set the window with date inputs instead of a drag | the feature is usable without a pointer gesture | Must Have |
| US-009 | brand-new user (zero rows) | get a clear empty state pointing at the coach | I'm not shown `0 kcal · 0 lb` as if it were data | Must Have |
| US-010 | user in the PWA | share a link to a specific window | I can send "look at this period" to myself or the coach | Should Have |

---

## 3. Functional Requirements

### 3.1 Core Requirements

1. New authenticated route `/trends` (server component shell + one client island).
2. Outer range chips: **30d / 90d / All**. Default 90d. Chips that would slice nothing off are hidden (same rule as `WeightChart`).
3. Three vertically stacked charts sharing one x time-scale domain and aligned left gutters:
   - **Weight** — raw readings as recessive dots + 7-day trailing mean as the hero line, gap-broken (reuse `weight-chart-core` verbatim).
   - **Calories** — one bar (or dot) per logged day + a 7-day trailing mean line. Days with no log render **no mark at all** (not a zero bar).
   - **Macros** — P/C/F grams as a stacked area/bar per logged day, or share-of-total when toggled.
4. **Drag-to-select sub-window** on any chart: pointer/touch down → move → up draws a `<ReferenceArea>`; on release the window is committed. Dragging a window under ~2 days is treated as a tap and clears the window.
5. A **Clear window** control returns to the full outer range.
6. Window state syncs to the URL as `?from=YYYY-MM-DD&to=YYYY-MM-DD` via **`history.replaceState`**, NOT `router.replace`. `router.replace` triggers a full RSC refetch of the entire payload on every drag commit, directly violating success criterion 2 (zero server round-trip). `replaceState` updates the address bar with no navigation, so the link stays shareable and a reload restores the window — at the cost of back-through-windows, a trade §5.2 makes explicit. The server reads `searchParams` only for the INITIAL window on a cold load.
7. **Window stat panel** showing, for the active window:
   - avg kcal/day, avg protein/carbs/fat (g/day) and macro share %
   - weight: first reading, last reading, Δ lb, rate lb/week
   - **observed TDEE** + daily energy balance, or a reason string when gated off
   - **measured TDEE** (Apple active+basal) + the observed↔measured gap, when `HealthDaily` covers the window
   - adherence vs plan targets (Δ kcal and Δ per macro), when a nutrition plan with macros exists
   - **coverage**: `N of M days logged` for nutrition, weigh-ins, and health rows
8. All averages **exclude** days with no data of that kind. No zero-filling, no interpolation.
9. Empty and partial states per §6.
10. New MCP read tool `get_trend_window` returning the same daily series + aggregate.
11. Navigation: a **Trends** row in `MoreSheet`; `/trends` lights the **Progress** tab in `BottomNav` (kinship route, same as `/compare` and `/recap`).

### 3.2 Secondary Requirements

12. A `See trends →` link in the `action` slot of `/progress`'s Body composition `Card`.
13. Preset window chips inside the accessible fallback: *Last 7d*, *Last 14d*, *This month*.
14. Macro chart toggle: **grams** ↔ **% of calories**.
15. Protein per lb of bodyweight in the stat panel when both a weight reading and protein data exist in the window.

### 3.3 Out of Scope

- Body fat / `bodyFatPct` and tape measurements on `/trends` (they stay on `/progress`; the user has only quarterly DEXA readings, too sparse to chart).
- Fiber and sodium — stored, but not charted or aggregated in v1.
- Any editing from `/trends`. It is read-only; marks deep-link to `/days/[dateKey]` and `/nutrition`.
- Saving or naming windows (no `TrendWindow` model in v1 — the URL is the persistence mechanism).
- Importing Apple body-mass records as weigh-ins (see G2 §3.3).
- Any calorie-**burn model** (MET tables, estimated burn from workout volume). Expenditure is only ever *measured* (imported), never modeled.

---

## 4. Technical Design

### 4.1 Data Model (Prisma)

**No schema changes in G1.** It reads three existing/companion models:

| Model | Fields used | Owner |
|-------|-------------|-------|
| `Measurement` | `date`, `weightLb` | existing |
| `NutritionLog` | `date`, `calories`, `proteinG`, `carbsG`, `fatG` | existing |
| `HealthDaily` | `date`, `activeKcal`, `basalKcal`, `steps` | **added by G2** |

Migration plan: **none for G1.** G1 must compile and render correctly whether or not `HealthDaily` exists yet — see §4.9.

### 4.2 MCP Tool Surface

| Tool name | Purpose | Read/Write | Notes |
|-----------|---------|------------|-------|
| `get_trend_window` | Daily weight/nutrition/energy series + window aggregate | **Read** | New; leaky-reads case required |

**Title**: `Weight, calories and macros over a date window, with TDEE and coverage`

**Description** (what claude.ai sees):
> Daily weight, calorie and macro series over a date window, plus the window aggregate: average calories and macros, weight delta and rate, observed TDEE (derived from intake and the weight slope), measured TDEE (imported Apple active+basal energy when available), plan adherence, and data coverage. Use this for ANY question that compares eating to weight over a period — "how did my vacation eating affect my weight", "what's my maintenance", "was I in a deficit last month". Averages EXCLUDE days with no log and every response carries a coverage block — quote it when you quote an average. TDEE is null with a `reason` when there isn't enough data to compute it honestly; do not estimate it yourself in that case. Defaults to the last 30 days; max window 365 days.

**Zod inputSchema**:

```ts
{
  from: z.string().optional()
    .describe("Window start, yyyy-mm-dd (USER_TZ). Default: 30 days before `to`."),
  to: z.string().optional()
    .describe("Window end, yyyy-mm-dd (USER_TZ), inclusive. Default: today."),
  includeDaily: z.boolean().default(false)
    .describe("Include the per-day series. Default false — the aggregate alone answers most questions and stays compact."),
}
```

Both date inputs go through `parseDateInput` (`src/lib/mcp/tool-helpers.ts`). Windows longer than 365 days are rejected with an error result. `includeDaily` caps the returned series at 400 rows.

**Return shape** (structured content, no prose):

```jsonc
{
  "window": { "from": "2026-08-03", "to": "2026-08-12", "days": 10 },
  "nutrition": { "loggedDays": 7, "avgKcal": 2410, "avgProteinG": 168, "avgCarbsG": 240, "avgFatG": 82,
                 "macroSharePct": { "protein": 28, "carbs": 40, "fat": 32 } },
  "weight":    { "first": { "dateKey": "2026-08-03", "value": 158.4 },
                 "last":  { "dateKey": "2026-08-12", "value": 156.6 },
                 "deltaLb": -1.8, "ratePerWeekLb": -1.26, "readingDays": 6 },
  "energy":    { "observedTdee": 3040, "observedTdeeReason": null,
                 "measuredTdee": 2890, "measuredDays": 10, "gap": -150,
                 "balancePerDay": -630 },
  "adherence": { "targetKcal": 2300, "deltaKcal": 110, "deltaProteinG": -12,
                 "deltaCarbsG": 40, "deltaFatG": 6 },
  "coverage":  { "totalDays": 10, "nutritionDays": 7, "weightDays": 6, "healthDays": 10 },
  "daily": []
}
```

`adherence` is `null` when no nutrition plan with macros is active. `energy.observedTdee` is `null` with a non-null `observedTdeeReason` (`"insufficient_nutrition_days"` | `"insufficient_weigh_ins"` | `"window_too_short"`) when gated.

**Leaky-reads coverage**: add a case in `src/lib/mcp/leaky-reads.test.ts` asserting that every Prisma call the handler makes (`measurement.findMany`, `nutritionLog.findMany`, `healthDaily.findMany`) is passed `omit: { userId: true }`, and that no `note` query is issued at all.

**Sample curl**:

```sh
curl -s -X POST http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_trend_window","arguments":{"from":"2026-08-03","to":"2026-08-12"}}}'
```

### 4.3 Server Actions

**None.** `/trends` is read-only. No mutations, therefore no `revalidatePath` calls.

### 4.4 Pages / Components

**New pure core** — `src/lib/trends-core.ts` (no Prisma, no `Date.now()`, no locale/TZ calls; client-safe, unit-tested like `weight-chart-core` / `compare-core`):

```ts
export const KCAL_PER_LB = 3500;
export const MIN_WINDOW_DAYS_FOR_TDEE = 7;
export const MIN_NUTRITION_DAYS_FOR_TDEE = 5;
export const MIN_WEIGH_INS_FOR_TDEE = 2;
export const MIN_WEIGH_IN_SPAN_DAYS = 7;

export type DailyPoint = {
  t: number;            // epoch ms at USER_TZ midnight
  dateKey: string;
  label: string;        // formatted SERVER-side in USER_TZ
  weight: number | null;
  kcal: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null;
  mealCount: number;
  activeKcal: number | null; basalKcal: number | null; steps: number | null;
};

export function buildDailySeries(input: {...}): DailyPoint[];
export function sliceWindow(points: DailyPoint[], from: number, to: number): DailyPoint[];
export function linearSlope(points: { t: number; value: number }[]): number | null; // value-units per DAY
export function aggregateWindow(points: DailyPoint[], opts?: { targets?: DayMacros | null }): WindowAggregate;
```

**TDEE arithmetic — implement exactly this, it is easy to sign-flip.**
Daily weight change `slope` is in lb/day, signed, negative while losing. Energy balance gives
`slope = (intake − TDEE) / KCAL_PER_LB`, therefore:

```
observedTdee   = avgKcal − slope * KCAL_PER_LB
balancePerDay  = avgKcal − observedTdee            // = slope * KCAL_PER_LB
```

Losing weight (negative slope) must yield `observedTdee > avgKcal`. A unit test must assert this
direction explicitly.

`slope` comes from a **least-squares fit over the window's raw weigh-ins** (not first-vs-last, which
is hostage to two noisy readings; not the trailing mean, whose lag biases short windows).
`linearSlope` returns `null` for fewer than 2 distinct reading days.

**Sufficiency gates** — `observedTdee` is `null` unless *all* hold: window span ≥ `MIN_WINDOW_DAYS_FOR_TDEE`; logged nutrition days ≥ `MIN_NUTRITION_DAYS_FOR_TDEE` **AND ≥ 50 % of the window's days** (`MIN_NUTRITION_COVERAGE = 0.5`); distinct weigh-in days ≥ `MIN_WEIGH_INS_FOR_TDEE` spanning ≥ `MIN_WEIGH_IN_SPAN_DAYS`. Each failure maps to a distinct reason string.

The coverage ratio is **not** optional polish. With absolute gates alone a 90-day window holding 5 logged days — 6 % coverage — prints a confident maintenance number built from almost nothing, which is precisely the dishonesty the coverage line exists to prevent. Reason string: `insufficient_nutrition_coverage`.

**Implausible results are never rendered.** A large weight gain across a short window can drive `observedTdee` below zero. When the computed value is < 800 kcal, return `null` with reason `implausible_result` rather than printing a number a reader might believe.

**New server data layer** — `src/lib/trends-data.ts`:

```ts
export async function getTrendsPageData(opts: { from: Date; to: Date }): Promise<TrendsPageData>;
```

- `const db = await getDb()` — every query scoped. Never the raw `prisma` singleton.
- Three bounded queries over `[startOfDay(from), endOfDay(to)]`: `measurement.findMany({ where: { weightLb: { not: null } } })`, `nutritionLog.findMany`, `healthDaily.findMany`.
- **Bounded-DESC-then-reverse** on every take-bounded scan (audit A2 — `orderBy: date asc` with a `take` returns the OLDEST rows and freezes the chart; see commit `d7b6200`).
- Tick labels formatted **server-side** in `USER_TZ` via `Intl.DateTimeFormat` and passed down as `label` — never `toLocaleDateString(undefined, …)` on the client (SSR/hydration divergence, UXR-PROG-81).
- Reads the active nutrition plan's daily macro targets via `resolveDay(new Date()).nutritionPlan` + `sumPlanTargetMacros` for the adherence block.

**New route** — `src/app/trends/page.tsx`, server component, `export const dynamic = "force-dynamic"`. Reads `searchParams` (`range`, `from`, `to`), calls `getTrendsPageData`, renders the shell + hands the serialized `DailyPoint[]` to one client island.

**New components** under `src/components/trends/`:

| File | Client? | Purpose |
|------|---------|---------|
| `TrendsBoard.tsx` | `"use client"` | The single island. Owns window state + URL sync; renders the chart stack and the panel. |
| `TrendChartStack.tsx` | client leaf | Three synced Recharts sharing an x domain; hosts the drag-select `ReferenceArea`. |
| `WindowPanel.tsx` | server-safe | Pure presentation of a `WindowAggregate`. |
| `CoverageLine.tsx` | server-safe | `N of M days logged` — used in the panel and in empty states. |
| `WindowFallbackForm.tsx` | client leaf | Accessible date inputs + preset chips inside a `<details>`. |

**Modified**: `src/components/MoreSheet.tsx` (add the Trends `navRow` + inline SVG glyph), `src/components/BottomNav.tsx` (add `/trends` to the Progress kinship matcher — **not** to `MORE_ROUTES`), `src/components/progress/BodyCompositionCard.tsx` (add the `Card action` link).

**Charting constraints**: Recharts is the only chart lib. All colors come from tokens (`var(--accent)`, `var(--muted)`, `var(--border)`, `var(--card)`, `var(--target)`) — never hex, so the charts theme-flip. Mount animation stays behind `usePrefersReducedMotion()`.

### 4.5 Date / Time Semantics

- Every Date helper via `@/lib/calendar` / `calendar-core`: `dateKey`, `parseDateKey`, `startOfDay`, `endOfDay`, `addDays`. **Zero** raw `setHours` / `getDate()` / `getMonth()` in new app code.
- `?from=` / `?to=` are `yyyy-mm-dd` keys parsed with `parseDateKey` (USER_TZ midnight), not `new Date(str)`.
- `get_trend_window`'s `from`/`to` go through `parseDateInput`.
- A day's bucket is its USER_TZ `dateKey`. The day grid is built by stepping `addDays` (DST-safe), never by adding 86 400 000 ms.
- `trends-core` is pure and takes epoch-ms + pre-formatted labels — it performs no timezone work at all.

### 4.6 Deferral / Override Awareness

`/trends` is orthogonal to per-day plan state — it aggregates logged rows, not prescribed ones, so it does **not** switch on `todayTask` and must not read `activeWorkout` / `deferredWorkout`. The single exception is the adherence block, which reads today's `nutritionPlan` via `resolveDay(new Date())` for target macros. No `PlanDayOverride` fields are added or read.

### 4.7 Tenant Scoping & Auth

- Owned models read: `Measurement`, `NutritionLog`, `HealthDaily` — **all** via `await getDb()`.
- `/trends` is **not** in `isPublicPath()`, so `src/middleware.ts` protects it by default. No change to `route-access.ts`.
- No session, invite-gate or OAuth surface touched.
- The MCP tool inherits `/api/mcp` auth (OAuth 2.1 primary, legacy bearer) and the ALS tenant scope. No new endpoint.

### 4.8 Third-Party Dependencies

**None.** Recharts, Zod and the existing calendar layer cover everything. No LLM API — the page ships numbers, the coach interprets them in claude.ai.

### 4.9 Seam with G2 (`HealthDaily`)

G1 and G2 are built in parallel, so G1 must not hard-block on G2's migration:

- `trends-core` types `activeKcal` / `basalKcal` / `steps` as `number | null` from the start.
- `trends-data.ts` isolates the health read behind one function, `readHealthDaily(db, from, to)`, which returns `[]` when the model or table is absent (guarded so a missing relation cannot 500 the page).
- `WindowPanel` renders the measured-TDEE row **only** when `coverage.healthDays > 0`; with zero health rows the panel is complete and correct without it.
- Acceptance: `/trends` must render fully green with `HealthDaily` empty.

---

## 5. UI/UX Specifications

### 5.1 Screen Descriptions

Populated state at 390 px:

```
┌────────────────────────────────────────┐
│ Trends                                 │  h1
│ Weight against what you ate            │  muted sub
├────────────────────────────────────────┤
│  [ 30d ][ 90d ][ All ]      ⟲ Clear    │  chips right-aligned
├────────────────────────────────────────┤
│  WEIGHT                        lb      │
│  161┤ ·  ·                             │
│     │╭─╮· ·  ·                         │
│  156┤    ╰──╮·  ·                      │
│     └──────────────────────────────    │
│      Jul 5   Jul 26   Aug 16   Sep 2   │  shared axis
├────────────────────────────────────────┤
│  CALORIES                     kcal     │
│ 3.0k┤    ▌ ▌▌  ▌                       │
│     │ ▌▌▌▌▌▌▌▌▌▌  ▌▌▌   ← 7d mean line │
│ 1.5k┤ ▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌                  │
│     └──────────────────────────────    │
├────────────────────────────────────────┤
│  MACROS                [ g | % ]       │
│     │▒▒▒▒▒▒▒▒▒▒▒  fat                  │
│     │▓▓▓▓▓▓▓▓▓▓▓  carbs                │
│     │███████████  protein              │
│     └──────────────────────────────    │
├────────────────────────────────────────┤
│ ▸ Set dates                            │  <details> a11y fallback
├────────────────────────────────────────┤
│ Aug 3 → Aug 12 · 10 days               │  window header
│ 7 of 10 days logged · 6 weigh-ins      │  ← coverage, ALWAYS
│                                        │
│  ┌────────┬────────┬────────┐          │
│  │ 2,410  │ −1.8lb │ −1.3/wk│          │  StatTile row
│  │ avg cal│   Δ    │  rate  │          │
│  └────────┴────────┴────────┘          │
│                                        │
│  Protein 168g · Carbs 240g · Fat 82g   │
│  28% / 40% / 32%                       │
│                                        │
│  Maintenance                           │
│   Observed   3,040 kcal/day            │
│   Measured   2,890 kcal/day  (Apple)   │
│   Gap          −150 · logging may run  │
│                low or expenditure high │
│   Balance     −630 kcal/day            │
│                                        │
│  vs plan (2,300 kcal)                  │
│   +110 kcal · −12g protein             │
└────────────────────────────────────────┘
```

Drag interaction:

```
 ▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌
    ╞══════════╡        ← ReferenceArea while dragging
    Aug 3   Aug 12
```

**States**: *loading* — `loading.tsx` skeleton matching the chart heights (no layout shift). *empty* — §6. *partial* — a chart with no data in range renders its frame plus a one-line muted note, never an empty box. *error* — the route inherits `src/app/error.tsx`.

### 5.2 Navigation Flow

**In**: `MoreSheet` → *Trends*; `/progress` Body composition → *See trends →*; a shared `?from=&to=` URL.
**Out**: back leaves `/trends` (window changes create no history entries — §4.4). Chart-mark deep-links to `/days/[dateKey]` are **deferred past v1**: on this design a tap already means "clear the window", so the two gestures collide. Recorded as follow-up.
**BottomNav**: `/trends` lights **Progress** (kinship, alongside `/compare`, `/recap`, `/baselines`). It is *not* added to `MORE_ROUTES`.

### 5.3 Responsive + Mobile-First Spec

- Primary width 390 px; page `max-w-md mx-auto p-4 space-y-4`, matching `/progress`.
- Chart heights: weight `h-52`, calories `h-44`, macros `h-40` — the whole stack plus the window header must fit inside two thumb-scrolls.
- Range chips and Clear are ≥ 44 px tap targets.
- The drag handler binds pointer events (`onPointerDown/Move/Up`) so it works for touch and mouse from one code path; `touch-action: pan-y` on the chart wrapper keeps vertical page scroll working while horizontal drag selects.
- `<Card>` for the window panel; no hardcoded colors — tokens only.
- The macro g/% toggle is a segmented control, ≥ 44 px.

### 5.4 Accessibility

- Each chart is `role="img"` with a computed `aria-label` naming the metric, the window, and the headline number (the pattern `WeightChart` already uses).
- Drag-select is **not** the only path: `WindowFallbackForm` exposes labelled `<input type="date">` start/end fields plus preset chips, and is a real form that works without JS.
- Visible focus rings (`focus-visible:ring-2 ring-[var(--accent)]`) on chips, toggle, Clear and inputs.
- The coverage line is plain text in the accessibility tree, not a tooltip.
- `var(--muted)` text stays at ≥ 11 px and is used for secondary copy only; check AA against `var(--card)` in both themes.
- Mount animations respect `usePrefersReducedMotion()`.

---

## 6. Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|------------------|
| No active program | Charts render normally (they read logs, not plans). Adherence block hidden — it needs plan targets. |
| Brand-new user (zero rows, mid-onboarding) | `EmptyState`: "Nothing to trend yet" + body "Log a weigh-in and a few meals — this fills in." + link to `/coach`. Never `0 kcal · 0 lb`. No Recharts mounts. |
| Weigh-ins but zero nutrition | Weight chart renders. Calorie + macro panels show "No meals logged in this range." TDEE gated `insufficient_nutrition_days`. |
| Nutrition but zero weigh-ins | Calorie + macro charts render. Weight panel notes no readings. TDEE gated `insufficient_weigh_ins`. |
| All `NutritionLog.calories` null (items logged, macros not) | Those days count as **unlogged** for calorie purposes. `mealCount` still > 0, so the coverage line reads "7 meals logged, 0 with macros" rather than implying zero eating. |
| Window shorter than 7 days | Averages still shown. TDEE gated `window_too_short` with that reason surfaced in the panel. |
| Window with 1 weigh-in | `linearSlope` returns null → TDEE gated. Δ and rate show "—", not 0. |
| Drag selects < 2 days | Treated as a tap: window cleared, full outer range restored. |
| `from` > `to` in the URL | Swap them, render normally. Never throw. |
| Malformed / non-`yyyy-mm-dd` URL params | Ignored; fall back to the range chip default (90d). |
| Window longer than 365 days (MCP) | Tool returns an error result naming the cap. Page clamps instead of erroring. |
| DST transition inside the window | Day grid built with `addDays` (USER_TZ-aware); the 23/25-hour day still buckets to exactly one `dateKey`. |
| `HealthDaily` absent (G2 not merged) | `readHealthDaily` returns `[]`; measured-TDEE row hidden; page fully green. |
| Very long window on a dense logger | Series capped at 400 points server-side by even sampling; the aggregate is computed over **all** rows before sampling, so numbers stay exact. |
| Concurrent log + view | `dynamic = "force-dynamic"` — every visit re-reads. No cache to invalidate. |
| Long numbers / overflow at 390 px | `tabular-nums`, kcal abbreviated at ≥10k, stat tiles wrap rather than truncate. |

---

## 7. Security Considerations

- **Tenant isolation**: `Measurement`, `NutritionLog` and `HealthDaily` are all read through `await getDb()`; the raw `prisma` singleton appears nowhere in G1. The MCP handler adds `omit: { userId: true }` to every query and is covered by a new leaky-reads case.
- **Route protection**: `/trends` is absent from `isPublicPath()`, so `src/middleware.ts` requires a session. No justification needed because nothing here is public.
- **Private note types**: `get_trend_window` returns no note data. **Correction (post-QA):** an earlier draft of this section claimed the tool "issues no `note` query at all — structurally incapable of leaking". That was false. The handler calls `getAdherenceTargets` → `resolveDay`, and `resolveDay` does run `db.note.findMany` (`src/lib/calendar.ts:1329`) as part of resolving a day. The safety property is narrower than "structurally incapable" and must be stated accurately: `getAdherenceTargets` returns **only four macro numbers**, so no note row — private-typed or otherwise — can reach the tool's output. That is enforced by asserting on the tool's serialized payload (no note-shaped fields, none of `standing_rule` / `review` / `open_item`), rather than by a query-count proxy, because the leaky-reads suite mocks `@/lib/calendar` and is blind at that seam.
- **MCP auth**: inherits `/api/mcp` (OAuth 2.1 primary + legacy bearer). No new endpoint, no bypass.
- **Rate limiting**: no new HTTP surface; existing Upstash middleware coverage applies unchanged (fails open by design — do not "fix").
- **Input validation**: Zod on the tool inputs (with the 365-day cap enforced in the handler); URL `searchParams` validated against `/^\d{4}-\d{2}-\d{2}$/` before parsing, invalid values discarded rather than thrown.
- No `dangerouslySetInnerHTML`; no raw SQL (Prisma only); all outputs are numbers and server-formatted labels.

---

## 8. Acceptance Criteria

1. [ ] `npx tsc --noEmit` passes with 0 errors.
2. [ ] `npm run lint` introduces no new errors.
3. [ ] `npm run test` passes; `src/lib/trends-core.test.ts` is added and green.
4. [ ] `npm run build` succeeds (Turbopack).
5. [ ] `src/lib/trends-core.ts` imports no Prisma, calls no `Date.now()`, and performs no locale/TZ formatting.
6. [ ] `trends-core.test.ts` asserts: a **negative** weight slope yields `observedTdee > avgKcal`; each of the three TDEE gates returns its distinct reason; unlogged days are excluded from `avgKcal`; `linearSlope` returns null below 2 reading days; a DST-spanning window produces exactly `n` day buckets.
7. [ ] `aggregateWindow` returns `coverage` on **every** path, including all empty ones.
8. [ ] `grep -nE 'setHours|setDate|getHours|getDate\(\)|getMonth\(\)|getFullYear' src/lib/trends-core.ts src/lib/trends-data.ts src/app/trends src/components/trends` returns **no** matches.
9. [ ] `grep -rn "prisma\." src/lib/trends-data.ts` returns no matches (scoped `db` only).
10. [ ] MCP `tools/list` includes `get_trend_window` with the title/description above.
11. [ ] MCP `tools/call` on `get_trend_window` returns the §4.2 shape, `adherence` null-able, `coverage` always present.
12. [ ] The leaky-reads case for `get_trend_window` passes and asserts `omit: { userId: true }` on all three finders.
13. [ ] `/trends` renders at 390 px with all three charts, chips, panel and coverage line.
14. [ ] Dragging on a chart sets `?from=&to=`; reload restores the same window; Clear removes both params.
15. [ ] With `HealthDaily` empty, `/trends` renders fully and the measured-TDEE row is absent.
16. [ ] With zero rows of every kind, `/trends` renders the `EmptyState` and mounts **no** Recharts.
17. [ ] `MoreSheet` shows a Trends row; `/trends` lights the Progress tab, not More.
18. [ ] No hardcoded hex colors in `src/components/trends/` — tokens only (`grep -n '#[0-9a-fA-F]\{3,6\}'` empty).
19. [ ] Every chart has a non-empty `aria-label`; the date-input fallback is present and labelled.
20. [ ] The page-level numbers and `get_trend_window`'s aggregate come from the **same** `aggregateWindow` call path (no duplicated arithmetic).

---

## 9. Open Questions

None. Every Phase-1 question was resolved with the user:
placement → new route; window UX → drag-brush with an accessible date fallback; insights → all four families; missing data → excluded with coverage shown; MCP → new read tool; saved windows → URL-only; body fat → out; fiber/sodium → out; inline editing → out; expenditure → measured-only, imported via G2.

---

## 10. Test Plan

### 10.1 Typecheck / Lint / Tests / Build
- `npx tsc --noEmit` — clean.
- `npm run lint` — no new errors (prune worktrees first; `.claude/worktrees/*/.next` produces phantom errors).
- `npm run test` — adds `src/lib/trends-core.test.ts`; updates `src/lib/mcp/leaky-reads.test.ts`.
- `npm run build` — succeeds.

### 10.2 MCP curl smoke
`tools/list` must show `get_trend_window`. Then `tools/call` for: (a) a default window; (b) an explicit `from`/`to`; (c) `includeDaily: true`; (d) a 400-day window (expect the cap error); (e) a window with no data (expect zeros/nulls **with** a coverage block, not an error).

### 10.3 Browser smoke
1. `npm run dev`, sign in, DevTools at 390 px.
2. `/trends`: verify all three charts, shared axis alignment, chips.
3. Drag a sub-window → panel updates, URL gains `from`/`to`, no full page reload.
4. Reload → same window. Back → previous window. Clear → params gone.
5. Open `▸ Set dates`, set a window with the keyboard only — verify it works with no drag.
6. Toggle macro g ↔ %.
7. Flip the theme — verify chart strokes/fills flip (token-driven).
8. `/progress` → *See trends →* lands on `/trends`; `MoreSheet` → Trends works; the Progress tab is lit on `/trends`.
9. Cross-check the panel's avg kcal and coverage against `get_trend_window` curl output for the same window — they must match exactly.

### 10.4 Migration verification
N/A for G1 — no schema change. (G2 owns the `HealthDaily` migration and its `db:verify-owned` / `db:verify-isolation` run.)

---

## 11. Appendix

### 11.1 Discovery Notes

Founder wanted calories and macros charted "next to or within" the weight graph, and floated "maybe it deserves another dashboard entirely." Codebase exploration confirmed the separate dashboard is the right call: `/progress` operates under a binding blueprint (`docs/ux-research/progress-overhaul.md`) capping the page at **one Recharts mount**, which two more charts would violate. `/compare` was examined and rejected as the home for this: it diffs two instants, whereas the founder's vacation scenario needs an aggregate *between* two dates — a different primitive.

Founder chose drag-brush windowing, all four insight families, and exclude-with-coverage for missing data. Body fat was dropped from v1 on the founder's own reasoning ("only quarterly DEXA scans" — too sparse to chart). Expenditure was flagged as a risk: modeling calorie burn would introduce the app's first non-deterministic number, so it is measured-only via the G2 import.

Founder was advised that bundling G2 into this run roughly doubles its size and makes the importer the critical path; they reaffirmed the combined scope, and the run proceeds under that explicit decision.

### 11.2 References

- `docs/prds/PRD-g2-apple-health-import.md` — the companion feature supplying `HealthDaily`.
- `src/lib/weight-chart-core.ts` + `src/components/WeightChart.tsx` — reused chart math and the label/TZ escape hatch.
- `docs/ux-research/progress-overhaul.md` — the one-Recharts constraint that motivates a separate route.
- `src/lib/compare-core.ts` — the purity/testing pattern `trends-core` follows.
- Commit `d7b6200` — "gate audit A2 — bounded reads must keep the newest rows" (the bounded-DESC-then-reverse rule §4.4 restates).
- Commit `e2483dd` — "rebuild the weigh-in chart on an honest time axis" (time-scale, gap-breaking, trailing mean).
- `.claude/quality-tools.md` — gates, curl recipes, stack gotchas.
