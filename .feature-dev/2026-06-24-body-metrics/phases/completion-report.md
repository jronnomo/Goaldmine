# Completion Report — Generic Body-Metric Tracker

**Branch:** `feature/body-metrics` · **Date:** 2026-06-24 · **Iterations:** 1 (no rework round needed)

## What was built
A generic `BodyMetric` time-series store so any body metric is loggable by key+value+unit+date with zero schema changes per new metric, with per-metric trend charts that auto-appear on `/progress` and `/stats`, plus an MCP write/read surface for the claude.ai coach. RHR was migrated off `Measurement.restingHr` into the generic store (history backfilled) so it's finally viewable.

## Files
| File | Change |
|---|---|
| `prisma/schema.prisma` | + `BodyMetric` model (+2 indexes) |
| `prisma/migrations/20260624110928_add_body_metric/` | additive migration |
| `prisma/backfill-body-metrics.ts` | idempotent `restingHr → BodyMetric(key=rhr)` |
| `src/lib/metrics-registry.ts` | `BODY_METRICS` (rhr/sleep_score/spo2/vo2max/hrv), alias map, `normalizeMetricKey`, `resolveBodyMetric`, `humanizeMetricKey` |
| `src/lib/mcp/tools.ts` | + `log_body_metric`, `get_body_metrics`, `get_metric_history`; `log_measurement.restingHr` → BodyMetric cutover; `recent_history` body-metrics slice |
| `src/lib/workout-actions.ts` | + `logBodyMetric` action; `logMeasurement` drops restingHr |
| `src/components/LogBodyMetricForm.tsx` | new metric-logging form (registry quick-picks + custom) |
| `src/components/LogMeasurementForm.tsx` | RHR input removed (weight + notes) |
| `src/components/LogLauncher.tsx` | + "Body metric" row |
| `src/components/BodyMetricsSection.tsx` | new — one Card+chart per logged key, ungated |
| `src/app/progress/page.tsx`, `src/app/stats/page.tsx` | render the section |
| `docs/prds/PRD-body-metrics.md` | PRD |

## Requirements: all DONE (REQ-001…011), QA fixes applied.

## Process
PRD → Plan-agent architecture → Devil's-Advocate (2 blockers caught: C1 series-fork via key normalization, C2 shared-DB migration race — both resolved pre-code) → foundation agent (serialized migration) → 2 parallel worktree dev agents (backend MCP / frontend UI) → merge → QA agent (2 should-fix + 2 nice-to-have, all fixed) → live MCP smoke.

## Verification
- `tsc` / eslint / `next build` clean.
- Backfill idempotent (2nd run inserts 0).
- Live MCP smoke (local dev): `log_body_metric(key="VO2 max")` → normalized `vo2max` + auto-unit; `get_body_metrics` returns registry-labeled latest-per-key; `log_measurement(restingHr)` writes a BodyMetric rhr (not Measurement); `get_metric_history(rhr)` returns backfilled + new points oldest-first. Smoke-test rows cleaned up afterward.

## Notes / follow-ups
- **Shared DB:** local `.env` = the production Neon DB (single-user, single-DB setup). The migration is therefore **already applied** and the **RHR backfill already ran** against it — `prisma migrate deploy` on Vercel will be a no-op for this migration; no separate prod backfill step needed.
- **Connector reload:** the MCP tool surface changed (3 new tools + revised `log_measurement`). The deploy bumps `MCP_SERVER_VERSION` so claude.ai refetches `tools/list` automatically; user may toggle the connector if testing immediately.
- **Deferred (v1 out of scope):** readiness/targets/rarity integration for body metrics; dropping the now-unused `Measurement.restingHr` column (later cleanup migration).
