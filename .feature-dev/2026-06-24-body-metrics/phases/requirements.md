# Requirements — Body-Metric Tracker

PRD: `docs/prds/PRD-body-metrics.md`. Blueprint source of truth for shapes.

## Backend stream

### REQ-001 — `BodyMetric` model + migration · S
- Files: `prisma/schema.prisma`; generates `prisma/migrations/*`, `src/generated/prisma`.
- Model per PRD §4 (fields, types, nullability, `@@index([key,date])`, `@@index([date])`). `Measurement.restingHr` untouched.
- Run `npx prisma migrate dev --name add_body_metric`.
- AC: migrate succeeds; client regenerated; `npx tsc --noEmit` sees `prisma.bodyMetric`.
- Deps: none. **Blocks all `prisma.bodyMetric` work.**

### REQ-002 — Registry extension · S
- Files: `src/lib/metrics-registry.ts`.
- Add `BodyMetricSpec`, `BODY_METRICS` (4 seeds), `BODY_METRIC_BY_KEY`, `humanizeMetricKey`, `resolveBodyMetric`. Client-safe (no Prisma/Node).
- AC: exports compile; resolver returns registry meta for known keys, humanized fallback for ad-hoc.
- Deps: none.

### REQ-003 — Backfill script · S
- Files: `prisma/backfill-body-metrics.ts`.
- Idempotent `Measurement.restingHr (not null)` → `BodyMetric(key="rhr", unit="bpm", source="backfill", date=startOfDay)`. Skip if a `source="backfill"` rhr row exists for that day. Logs inserted/skipped.
- AC: run twice → 2nd inserts 0.
- Deps: REQ-001.

### REQ-004 — `log_body_metric` write tool · M
- Files: `src/lib/mcp/tools.ts` (in `registerWriteTools`, near `log_measurement`).
- Schema `{ key, value, unit?, date?, notes?, source? }`; `safe()`; normalize key; `parseDateInput`; registry unit default; return `{ id, key, value, unit, date: dateKey, message }`.
- AC: MCP curl logs registry key + ad-hoc key; row persisted.
- Deps: REQ-001, REQ-002.

### REQ-005 — `get_body_metrics` + `get_metric_history` read tools · M
- Files: `src/lib/mcp/tools.ts` (in `registerReadTools`).
- `get_body_metrics`: no args → latest-per-key summary. `get_metric_history`: `{ key, days? (default 180) }` → oldest-first points. Dates as dateKey; registry-resolved labels.
- AC: MCP curls return documented shapes.
- Deps: REQ-001, REQ-002.

### REQ-006 — Deprecate `log_measurement.restingHr` · S
- Files: `src/lib/mcp/tools.ts`.
- Keep `restingHr` param (mark `.describe` deprecated); handler writes `BodyMetric(key="rhr", unit="bpm", source="claude")` instead of `Measurement.restingHr`. Narrow tool title/description to weight + body-fat.
- AC: MCP curl `log_measurement(restingHr=52)` creates a BodyMetric rhr row, NOT a Measurement.restingHr.
- Deps: REQ-001. Coordinate with REQ-009 (same conceptual cutover).

## Frontend stream

### REQ-007 — `logBodyMetric` server action · S
- Files: `src/lib/workout-actions.ts`.
- Parse key(normalize)/value/unit/date/notes; USER_TZ via `parseDateKey`/`startOfDay`; registry unit fallback; `prisma.bodyMetric.create`; `revalidatePath("/","/history","/progress","/stats")`.
- AC: server action compiles; writes a row.
- Deps: REQ-001, REQ-002.

### REQ-008 — `LogBodyMetricForm` · M
- Files: `src/components/LogBodyMetricForm.tsx` (new).
- Registry quick-picks (auto-fill unit) + "Custom…" (free-text key + unit), value (`step=any`, required), optional date (`type=date`) + notes. `useFormFeedback`; `submit(logBodyMetric, { successMsg: "✓ Metric logged" })`. Mobile-first.
- AC: renders; submits; success feedback.
- Deps: REQ-002, REQ-007.

### REQ-009 — Move RHR out of weigh-in + Launcher row · M
- Files: `src/components/LogMeasurementForm.tsx`, `src/lib/workout-actions.ts` (`logMeasurement`), `src/components/LogLauncher.tsx`.
- Remove RHR input from weight form; `logMeasurement` stops writing `restingHr`. Add "Body metric" accordion row → `LogBodyMetricForm`; extend `ExpandedRow` union. Order: Weight, Body metric, Meal, Note.
- AC: weight form has no RHR field; launcher shows the new row.
- Deps: REQ-008.

### REQ-010 — `BodyMetricsSection` · M
- Files: `src/components/BodyMetricsSection.tsx` (new server component).
- Query `BodyMetric` (asc), group by key, `<Card title={label}>` + `<HistoryChart data units domain />` per key; registry/ad-hoc resolution; direction-aware domain; single-point caption; `return null` when empty. No goal-target gating.
- AC: renders a card+chart per logged key; nothing when empty.
- Deps: REQ-001, REQ-002.

### REQ-011 — Wire section into pages · S
- Files: `src/app/progress/page.tsx`, `src/app/stats/page.tsx`.
- Render `<BodyMetricsSection/>` after Weight card on both. Not gated.
- AC: both pages show the section when data exists.
- Deps: REQ-010.

## Cross
- REQ-012 — PRD doc (DONE: `docs/prds/PRD-body-metrics.md`).
- REQ-013 — QA pass per PRD §12.
