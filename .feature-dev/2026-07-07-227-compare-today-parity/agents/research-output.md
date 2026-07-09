# Research Output — compare/readiness surface (Explore agent, 2026-07-06)

## 1. src/lib/compare.ts flow
- Entry `computeComparison(aKeyRaw, bKeyRaw)` :35; `todayKey = toDateKey(new Date())` :36 (only for normalizeDateRange clamping today).
- `normalizeDateRange(aKeyRaw, bKeyRaw, todayKey)` :37-38 → {dateA, dateB, swapped, sameDay, clampedToToday, spanDays}.
- Cutoffs :39-40: `cutA = endOfDay(parseDateKey(dateA))`, `cutB = endOfDay(parseDateKey(dateB))`. NO today special-casing anywhere.
- Promise.all fan-out :55-63: buildGoalSections(goals, cutA, cutB) :57 · buildStrengthEntries :58 · buildBaselineEntries :59 · buildBodyEntries :60 · buildCountersSection(cutA, cutB, dateA, dateB) :61 · buildNutritionSection(dateA, dateB) :62 (own windows via startOfDay/endOfDay :413-416).
- buildGoalSections signature :86-90 (goals, cutA, cutB). computeReadiness call sites :103-106:
  `[snapshotB, snapshotA] = await Promise.all([computeReadiness(targets, cutB, g.id), createdAfterA ? null : computeReadiness(targets, cutA, g.id)])`.
  `createdAfterA = g.createdAt > cutA` :94. Readiness entry :108-115 (valueB = snapshotB.score); per-target breakdown matched by target.metric :120-131.
- Section cutoff consumers: strength `startedAt lte cutB` :169, A-split :179 · baselines `date lte cutB` :239, :251 · body :293-295, :297, :322 · counters between/cumulative :355-367, XP by dateKeys :376-381.
- Import :22: `import { parseDateKey, dateKey as toDateKey, startOfDay, endOfDay, addDays } from "@/lib/calendar-core";` (calendar-core, not calendar).

## 2. compare-core.ts
Pure/client-safe. directionForMetricKind :34 · buildEntry :94-132 · formatValue :157 · formatDelta :177 · normalizeDateRange :211 · daysBetweenKeys :238 · types :247-295. No readiness/cutoff logic. compare-core.test.ts: pure tests, no timers (buildEntry/format/normalize cases).

## 3. /progress parity target
- progress/page.tsx:44-47: `computeReadiness(targets, new Date(), g.id)` + `computeReadinessSeries(g.createdAt, targets, new Date(), g.id)` — RAW now instant.
- Same in goals/[id]/page.tsx:114.
- readiness.ts:164-168: `computeReadiness(targets: GoalTarget[], asOf: Date = new Date(), goalId: string)`. asOf → resolveMetricValue :173 (lte bound). Hike-prep compound gate re-wraps `endOfDay(asOf)` internally :206 (identical on /progress — not a parity risk).
- computeReadinessSeries :239-259 passes raw now for final point :255.

## 4. calendar helpers
- calendar-core.ts: `dateKey` :83 (NO export named toDateKey — alias only), `parseDateKey` :88, `startOfDay` :93, `endOfDay` :98 (23:59:59.999 USER_TZ), `addDays` :130. calendar.ts re-exports.

## 5. Callers of computeComparison
- /compare page: src/app/compare/page.tsx:159.
- compare_dates MCP tool: tools.ts:1227-1244; handler :1242-1243 `safe(() => computeComparison(a, b ?? toDateKey(new Date())))` — pure pass-through; inherits any compare.ts change; NO handler change needed.
- Calendar: no computeComparison call site.
- NOTE: compute_readiness tool (tools.ts:1022-1047) has a THIRD asOf convention: explicit asOf → parseDateKey (start-of-day 00:00); default → new Date(). Pre-existing; OUT OF SCOPE for #227.

## 6. Test patterns
- compare.test.ts: `vi.mock("@/lib/db")` :10 (dual-export convention), `computeReadiness: vi.fn()` :14, game engine mocked :15. NO fake timers — fixed literal past dateKeys ("2026-03-01","2026-06-20" etc. :119-266). Asserts call counts (e.g. createdAfterA→once :130), not asOf values.
- readiness.test.ts: FIXED_DATE constant passed explicitly as asOf; resolveMetricValue mocked; no fake timers.
