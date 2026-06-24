# PRD — Generic Body-Metric Tracker

**Status:** Approved · **Feature branch:** `feature/body-metrics` · **Date:** 2026-06-24

## 1. Problem & Context
The user got an Apple Watch Ultra 2, which surfaces new daily body metrics (resting HR, sleep score, blood-oxygen/SpO₂, VO₂ max, HRV, …). Today the app only models body data in the `Measurement` table with **fixed columns** (`weightLb`, `restingHr`, `bodyFatPct`, `notes`). Two gaps:

- **Recording:** only weight, RHR, body-fat% have a structured home. Sleep/SpO₂/VO₂/HRV have nowhere to go but free-text notes.
- **Viewing:** `restingHr` is **write-only** — `/progress` and `/stats` chart weight only (`WeightChart`); nothing reads RHR back, and no MCP read tool returns it. Logging RHR is currently invisible.

## 2. Goal
A **generic** body-metric store: record any metric by `key + value + unit + date` with **zero schema changes per new metric**, and view a per-metric trend that **auto-appears** once a metric is logged. Expose an MCP write/read surface so the claude.ai coach can record numbers the user dictates/pastes from the Watch.

## 3. Locked Decisions
1. **Coexist + migrate RHR.** Weight & body-fat stay in `Measurement` (preserves `WeightChart` + readiness `weightLb`-target gating). A new generic `BodyMetric` table holds RHR, sleep, SpO₂, VO₂ max, and ad-hoc metrics. Existing `Measurement.restingHr` rows are backfilled into `BodyMetric` so RHR history is viewable.
2. **View:** a "Body Metrics" section on **both** `/progress` and `/stats` — one mini trend chart per logged key, auto-appearing. Reuse `HistoryChart`.
3. **Seed registry:** RHR, Sleep score, SpO₂, VO₂ max, HRV. Ad-hoc keys still loggable + viewable.
4. **Logging surface:** dashboard form (in the Log launcher) **and** an MCP write tool, plus MCP read tools.
5. **Flow:** feature branch + PR; this PRD in `docs/prds/`.

## 4. Data Model
New `BodyMetric` (global, goal-agnostic — mirrors `Measurement`, **not** the project-scoped `LogEntry`):

```prisma
model BodyMetric {
  id        String   @id @default(cuid())
  date      DateTime // USER_TZ midnight
  key       String   // bare lowercase snake: "rhr","sleep_score","spo2","vo2max"
  value     Float    // non-null — the row's whole purpose is one number
  unit      String?  // per-row snapshot; registry authoritative for known keys
  notes     String?
  source    String   @default("manual") // manual | claude | watch | imported | backfill
  createdAt DateTime @default(now())
  @@index([key, date])
  @@index([date])
}
```

**Decisions & rationale**
- **Bare keys** (no `log:`/`body:` prefix stored) — matches `LogEntry.metric`/`Baseline.testName`. Normalized on write: `trim().toLowerCase()`, spaces→`_`.
- **`value` non-null** — text-only observations belong in `Note`; body metrics are pure numeric time-series.
- **Unit per-row + registry fallback** — registry is authoritative for known keys; ad-hoc rows self-describe via their own `unit`. Display order: registry unit → row unit → "".
- **`date` = USER_TZ midnight** (day-bucketed like `Baseline`/`LogEntry`). Watch readings are daily summaries.
- **Multiple readings/day allowed (no upsert)** — Watch can emit several SpO₂ spot-checks; charts plot all points, summaries take latest-per-day. *Intentional divergence from `log_baseline`'s one-per-day dedup.*
- **`Measurement.restingHr` column retained** — zero-loss additive migration; it's the backfill source. Only its **write paths** are cut. A later cleanup migration may drop it once prod backfill is confirmed.

## 5. Registry (`src/lib/metrics-registry.ts`)
A **separate** `BODY_METRICS` list (NOT folded into `METRICS`, which feeds goal-target/readiness pickers — body metrics are not targets in v1):
- `BodyMetricSpec = { key, label, units, direction, description, normalRange? }`
- Seeds: `rhr` (bpm, decrease) · `sleep_score` (pts, increase) · `spo2` (%, increase, normal 95–100) · `vo2max` (ml/kg/min, increase) · `hrv` (ms, increase — recovery indicator).
- `BODY_METRIC_BY_KEY` map; `humanizeMetricKey(key)`; `resolveBodyMetric(key, rowUnit?)` → label/units/direction (registry wins; ad-hoc → humanized label + row unit + `increase`).
- Must stay client-safe (no Prisma/Node imports) — imported by the client form.

## 6. MCP Surface (`src/lib/mcp/tools.ts`)
- **`log_body_metric`** (write): `{ key, value, unit?, date?, notes?, source? }`. Normalize key, USER_TZ date via `parseDateInput`, default unit from registry, `prisma.bodyMetric.create`. Description steers the coach to use it for wearable numbers beyond weight/body-fat.
- **`get_body_metrics`** (read, no args): latest value per key + count/first/last + registry label/units/direction.
- **`get_metric_history`** (read): `{ key, days? }` → oldest-first `points[]` for one key (mirrors `get_baseline_history`).
- **`log_measurement.restingHr` deprecate-and-mirror:** keep the param (saved-prompt compat) but the handler writes `BodyMetric(key="rhr")` instead of `Measurement.restingHr`; narrow tool title/description to weight+body-fat. Deploy bumps `MCP_SERVER_VERSION` (commit SHA) → connector refetches `tools/list`.

## 7. Server Action + Form
- **`logBodyMetric`** (`src/lib/workout-actions.ts`, mirror `logMeasurement`): parse key/value/unit/date/notes; USER_TZ date via `parseDateKey`/`startOfDay`; `revalidatePath("/","/history","/progress","/stats")`.
- **`LogBodyMetricForm`** (`src/components/LogBodyMetricForm.tsx`, new): registry quick-picks + "Custom…" (free-text key+unit), value, optional date/notes; `useFormFeedback`.
- **`LogLauncher`**: new "Body metric" accordion row → renders the form; extend `ExpandedRow` union. Order: Weight, Body metric, Meal, Note.
- **Move RHR out of `LogMeasurementForm`** and stop `logMeasurement` writing `restingHr`.

## 8. Dashboard Section
- **`BodyMetricsSection`** (`src/components/BodyMetricsSection.tsx`, new server component): query `BodyMetric`, group by key, one `<Card>` + `<HistoryChart>` per key; direction-aware Y-domain; single-point caption; **returns `null` when empty** (NOT gated on goal targets). Reuse `HistoryChart` unchanged.
- Render after the Weight card in `/progress` and `/stats` (both already `force-dynamic`).

## 9. Migration + Backfill
- `npx prisma migrate dev --name add_body_metric` — additive (table + 2 indexes); regenerates `src/generated/prisma`.
- `prisma/backfill-body-metrics.ts` (standalone `npx tsx`, mirrors `prisma/seed-chewgether.ts`): `Measurement.restingHr (not null)` → `BodyMetric(key="rhr", unit="bpm", source="backfill")`, idempotent (skip if a `source="backfill"` rhr row already exists for that day). Run on dev, then prod during deploy.

## 10. Out of Scope (v1)
Readiness/targets/rarity integration (no changes to `goal-targets.ts`/`readiness.ts`/`rarity.ts`); dropping `Measurement.restingHr`; per-row unit conversion.

## 11. Edge Cases
Empty state → section renders nothing. Single data point → chart shows one dot + a "trend appears with more readings" caption. Ad-hoc key → humanized label, row unit, `increase` default. Unit is a display label, not a normalization key (single-user; no conversion). USER_TZ: never `new Date(bareDateStr)` — route through calendar helpers. RHR briefly accepted by both `log_measurement` (now mirrored to BodyMetric) and the new path → converges on one table, no divergence.

## 12. Verification
`tsc` + lint + `next build` clean · backfill run twice (2nd inserts 0) · MCP curls for all new tools + revised `log_measurement(restingHr)` writes a BodyMetric rhr row · phone-width browser smoke (log RHR + a custom metric; both pages show a card/chart per key; weight form no longer shows RHR) · backfilled RHR renders as a trend.

**UX-research:** skipped — reuses existing dashboard Card + HistoryChart + Log-launcher patterns; no novel UI surface (matches `outcome.enforce_invocation` skip condition: follows established component patterns).
