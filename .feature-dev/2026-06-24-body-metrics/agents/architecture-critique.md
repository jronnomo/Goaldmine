# Architecture Critique — Body-Metric Tracker (Devil's Advocate, pre-code)

Reviewed against the real codebase on `feature/body-metrics`. Verdicts are prioritized:
**CRITICAL** (fix before writing code) / **SHOULD-FIX** / **NICE-TO-HAVE**. Every item cites real
code. The design is fundamentally sound — a global `BodyMetric` table mirroring `Measurement` is the
right call, the date helpers it leans on are correct, and (good news) cutting the `restingHr` write
path starves nothing. The problems below are concrete and mostly cheap to fix now.

---

## CRITICAL

### C1 — The `vo2max` seed key is unreachable by the normalizer → guaranteed series fork
The normalizer is `key.trim().toLowerCase().replace(/\s+/g, "_")` (blueprint lines 26, 53; server-action
snippet lines 53). Apply it to what a human/coach will actually type:

- `"VO₂ max"` → `"vo₂_max"` (the ₂ subscript survives — it is not an ASCII digit!)
- `"VO2 max"` → `"vo2_max"`
- `"VO2max"`  → `"vo2max"`
- seed key in registry (blueprint line 18) → `"vo2max"`

So the **dashboard quick-pick** (which submits `key="vo2max"` directly) lands on the registry series,
but the **MCP `log_body_metric` coach path** — the primary entry per PRD §1/§6 ("numbers the user
dictates/pastes from the Watch") — will fork into `vo2_max` or `vo2₂_max` depending on spacing/glyph,
none of which match the seed. The seed metric then shows an empty/duplicate chart and `get_body_metrics`
reports two RHR-style series. `spo2` is luckier (`"SpO2"`→`"spo2"` matches) but `"blood oxygen"`→
`"blood_oxygen"` forks, and `"sleep"`→`"sleep"` forks from `sleep_score`. This is exactly the
`EXERCISE_ALIAS_GROUPS` re-fragmentation problem already documented in MEMORY ("Exercise alias map is
hand-curated").

**Recommend:** add a small hand-curated alias map in `metrics-registry.ts` (client-safe), resolved
inside `resolveBodyMetric`/at write time: `{ vo2max: ["vo2_max","vo2 max","vo₂max","vo₂_max"],
spo2: ["blood_oxygen","blood oxygen","o2 sat","sp02"], rhr: ["resting_hr","resting heart rate"],
sleep_score: ["sleep"] }`. Normalize the alias keys the same way and map → canonical. At minimum,
rename the seed key to `vo2_max` AND alias `vo2max`, because the bare-glyph form still forks otherwise.
Do this before REQ-002/REQ-004 ship — once forked data lands in prod it must be merged by hand.

### C2 — Parallel worktree dev on a single Neon DB will collide on the migration + generated client
`/src/generated/prisma` is **gitignored** (`.gitignore:43`), and the datasource is a single shared
`DATABASE_URL` (`prisma.config.ts`). The feature-dev model fans out Sonnet agents into worktrees. If
more than one agent runs `npx prisma migrate dev --name add_body_metric` (REQ-001) against the shared
Neon DB:
- Prisma `migrate dev` resets/uses a **shadow database** and rewrites `_prisma_migrations`; two
  concurrent runs race and one will report **drift** or fail mid-apply.
- Because the client is gitignored, every worktree that does `prisma.bodyMetric` work (REQ-003/004/005/
  007/010 — six REQs) needs its **own** `prisma generate`; an agent that branched before REQ-001 merged
  will not have the `bodyMetric` accessor and `tsc` will fail (this is the documented "worktree agents
  can branch stale" + "worktree .next artifacts pollute lint" hazard).

**Recommend:** serialize the schema change. One agent runs REQ-001 (migrate + generate) on the shared
DB, commits the migration SQL (migrations dir is tracked) to the branch, and **only then** are the
dependent REQs unblocked — each must `git pull`/rebase to the REQ-001 commit and run `prisma generate`
locally (symlinking `node_modules` per the worktree playbook) before touching `prisma.bodyMetric`.
No second `migrate dev` against prod/dev DB from any other worktree. The REQ dependency graph already
says "REQ-001 blocks all `prisma.bodyMetric` work" — make that a hard serialization gate, not just a
logical dep.

---

## SHOULD-FIX

### S1 — `Measurement.restingHr` reader audit (axis 4): safe to cut, but two firehose tools silently lose new RHR
Full repo search (`grep restingHr`, excluding `src/generated/`) returns **only three sites**, all on
the **write** path:
- `src/components/LogMeasurementForm.tsx:33` — the `<input name="restingHr">`
- `src/lib/workout-actions.ts:20-32` — `logMeasurement` parse + `measurement.create`
- `src/lib/mcp/tools.ts:2217,2229` — `log_measurement` schema + create

**No** code reads `Measurement.restingHr` by field — not readiness (`readiness.ts`/`goal-targets.ts`
only read `weightLb`, lines 43/141), not recap (`recap.ts` has zero `restingHr`), not the game engine,
exports, or `get_session_brief`. So cutting the write path starves nothing. **However**, `recent_history`
(`tools.ts:748`) and `weekly_summary_data` (`tools.ts:1110`) both do `prisma.measurement.findMany`
with **no `select`**, so they currently hand the coach `restingHr` inline on every measurement row.
After the cutover (REQ-006/009) new RHR goes to `BodyMetric`, so it **vanishes from those two bundles**
— the Sunday review / weekly recap turn will no longer see RHR unless the coach separately calls
`get_body_metrics`. PRD §10 scopes readiness/targets out but never flags this visibility regression.

**Recommend:** either (a) add a `bodyMetrics` slice (latest-per-key, or the week's rows) to
`recent_history` and `weekly_summary_data`, or (b) at minimum add a sentence to those tools'
descriptions steering the coach to `get_body_metrics`/`get_metric_history`, and call this out in the
PRD so QA verifies the Sunday-review path. Option (a) is the honest fix — the coach already treats those
two as the "what happened" firehose.

### S2 — "Latest-per-day / latest-per-key" is nondeterministic with multiple readings/day
PRD §4 intentionally allows multiple rows per `(key, date)` (Watch SpO₂ spot-checks). But:
- `get_body_metrics` (blueprint line 43) sorts `orderBy: { date: "desc" }` only, then reduces to
  latest-per-key. Two rows with the **same `date`** (USER_TZ midnight — they're day-bucketed, so all
  same-day rows are *equal* on `date`) have undefined relative order → the "latest value" shown to the
  coach is a coin-flip.
- `BodyMetricsSection` (blueprint line 80) picks `latestRow.unit` to feed `resolveBodyMetric` — same
  nondeterminism, so an ad-hoc series' displayed unit can flicker.

The `BodyMetric` model has `createdAt` — use it. **Recommend:** every "latest" query orders
`[{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }]`, and the section's per-key chart sorts
points `[{ date: "asc" }, { createdAt: "asc" }]` so same-day points draw in insertion order. Cheap,
and it's the difference between a stable dashboard and a flickering one.

### S3 — No shared `normalizeMetricKey` helper exists; the design inlines it three times
Repo-wide grep for `normalizeMetricKey` returns **nothing** — the blueprint's "reuse if present" branch
never fires, so the same regex gets hand-copied into (1) the registry resolver, (2) `logBodyMetric`
(server action snippet line 53), and (3) `log_body_metric` (MCP). Three copies *will* drift (someone
adds NFKC/unicode handling in one and not the others), and that drift silently forks series — the same
failure class as C1. **Recommend:** export one `normalizeMetricKey(key: string): string` from
`metrics-registry.ts` (client-safe, no Prisma) and have all three sites + the alias resolver call it.
This is the single chokepoint that makes C1's alias fix actually hold.

### S4 — `HistoryChart` prop is `data`, not `points`, and its default domain collapses a flat series
`HistoryChart` (`HistoryChart.tsx:15-23`) takes `data: HistoryPoint[]` where
`HistoryPoint = { date; value; tooltip? }` and `units: string`, `domain?: [number|string, number|string]`
defaulting to `["dataMin","dataMax"]`. The blueprint's section pseudocode writes
`<HistoryChart data points units domain />` (line 82) — ambiguous; implementers must pass
`data={points}` (not `points={...}`). More importantly, the **default** `["dataMin","dataMax"]` makes a
single point or a flat RHR/SpO₂ series render as a degenerate line pinned to the axis (this is exactly
why `WeightChart.tsx:37` uses `["dataMin - 2","dataMax + 2"]`). The section therefore **must** pass an
explicit padded, direction-aware `domain` for every chart, including the single-point case. The prop
shape otherwise lines up exactly (`{date,value,tooltip}` + `units` + `domain`), so no `HistoryChart`
changes are needed. Confirm in QA that a 1-point and a flat (e.g. SpO₂ 98,98,98) series both render a
visible dot/line.

### S5 — "Render after the Weight card" is undefined on `/progress`, where the Weight card is conditional
On `/stats` the Weight `<Card>` always renders (`stats/page.tsx:119`). On `/progress` it is gated on
`hasWeightTarget` (`progress/page.tsx:220`) — when the focus goal has no `weightLb` target the Weight
card is **absent**, so "insert after the Weight card" (blueprint line 84, REQ-011) has no anchor.
**Recommend:** specify placement structurally (e.g. immediately before `<RecordsSummary />` on
`/progress`, after the Weight card on `/stats`) and confirm the section is **not** gated on goal targets
(PRD §8 says so — keep it that way; it must appear whenever body-metric rows exist regardless of the
weight card's presence).

### S6 — Backfill idempotency holds across reruns but is loose against same-day duplicates and the converging write path
The skip guard ("skip if a `source="backfill"` rhr row exists for that day", REQ-003) makes reruns
idempotent (2nd run inserts 0 ✓). Two wrinkles to document/decide before running on prod:
- **Multiple `Measurement` rows same day, each with `restingHr`** collapse to one backfill row (second
  is skipped because a backfill row already exists for the day). Acceptable (RHR is rarely multi/day),
  but it is silent loss — note it.
- The guard keys specifically on `source="backfill"`, so it will **not** dedupe against a non-backfill
  rhr row (a manual/`claude` RHR already logged for a historical day) → you can get two same-day points.
  Harmless given the multiple-readings design, but if you want strict one-rhr-per-historical-day, widen
  the guard to "any rhr row in that day window".
Also pin **deploy ordering**: run the cutover (REQ-006/009) before/with the prod backfill so no RHR is
written to `Measurement.restingHr` after the backfill snapshot reads it. `Measurement.date` is a full
timestamp (`logMeasurement` writes `date: new Date()`, workout-actions.ts:30), so the backfill must
bucket via `startOfDay(m.date)` (blueprint line 87 does — good; just confirming it's not `m.date` raw).

---

## NICE-TO-HAVE

### N1 — `value Float` non-null vs `restingHr Int?`
Backfilling an `Int` RHR into a `Float` column is fine (Postgres widens), and non-null `value` matches
"the row's whole purpose is one number." Just ensure display formatting doesn't show `52.0` for RHR —
either store/format integers for known integer-unit keys, or render with `Number.isInteger ? v :
v.toFixed(1)`. Cosmetic.

### N2 — `source` enum mismatch
Schema `source` is a free `String` defaulting to `manual`; the MCP `log_body_metric` zod enum
(blueprint line 37) is `["manual","claude","watch","imported"]` defaulting to `claude`, and backfill
writes `"backfill"`. No bug (DB accepts any string), but the enum omits `backfill`/`watch` could be
intended — just confirm the set is deliberate so a future "watch import" path isn't rejected by the tool
while the column happily stores it.

### N3 — Section adds a sequential DB round-trip outside each page's `Promise.all`
`BodyMetricsSection` does its own `prisma.bodyMetric.findMany` (blueprint line 76). As an async server
child of two already `force-dynamic` pages it composes fine and renders correctly, but it runs *after*
the page's `Promise.all` resolves (extra serial round-trip). Single-user, sub-ms — accept it; only worth
hoisting into the page's `Promise.all` if you later see it on a latency budget.

### N4 — SpO₂ flat-line readability
SpO₂ lives in 95–100; a `dataMin-pad/dataMax+pad` domain on noisy 96/98/97 data exaggerates jitter.
Including `normalRange` (95–100) in the domain (blueprint line 81 mentions it) flattens the visual and
is the right default for that one metric. Minor.

### N5 — Date round-trip is correct — verified, no action
For the record (axis 1): `<input type=date>` → `parseDateKey` (`calendar-core.ts:88`) →
`userTzWallClockToUTC` = USER_TZ midnight ✓. MCP `parseDateInput` (`tool-helpers.ts:32`) routes bare
`yyyy-mm-dd` through `parseDateKey` and full ISO through `new Date()` ✓. Read tools' `toDateKey`
(`dateKey`, calendar-core.ts:83) is USER_TZ-aware ✓. No raw `new Date(bareStr)` anywhere in the proposed
paths — the one risky spot, `logBaseline` (`workout-actions.ts:97` does `new Date(dateStr)`), is **not**
reused by this feature, so don't copy that pattern into `logBodyMetric`. `Direction` is exported
(`metrics-registry.ts:10`) and the registry is genuinely client-safe (only imports `zod`), so adding
`BODY_METRICS` + pure resolver keeps it client-importable ✓.

---

## Bottom line
Greenlight the shape. The two things that will actually bite are **C1 (key forking on `vo2max`)** and
**C2 (parallel migration on the shared DB)** — both must be settled before any agent writes code. Land
S1–S3 in the same pass (they're the same "one normalization chokepoint + don't lose RHR visibility"
theme), and S4/S5 are 10-minute spec clarifications that prevent a broken-looking chart and an ambiguous
insert point. Nothing here argues for a different data model — `BodyMetric`-mirrors-`Measurement` is the
simplest design that meets the goal.
