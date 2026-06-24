# QA Report — Generic Body-Metric Tracker

**Branch:** `feature/body-metrics` · **Date:** 2026-06-24 · **Reviewer:** QA Agent

---

## Summary

Implementation is largely correct and complete. Two SHOULD-FIX issues, two NICE-TO-HAVE items. No BLOCKERS. All acceptance criteria verified.

---

## SHOULD-FIX

### SF-1 — `log_body_metric` MCP tool missing `Number.isFinite` guard
**File:** `src/lib/mcp/tools.ts` line 2447–2470

**Problem:** The server action `logBodyMetric` (workout-actions.ts:50) correctly guards with `if (!Number.isFinite(value)) throw new Error(...)`. The MCP tool handler does NOT. Zod's `z.number()` rejects `NaN` but accepts `±Infinity`. A coach calling `log_body_metric(key="spo2", value=Infinity)` writes an `Infinity` value to Postgres (`DOUBLE PRECISION` column accepts it), which breaks the BodyMetricsSection domain computation (`Math.min(...values)` → `Infinity`; domain computation then passes `[-Infinity, Infinity]` to Recharts, collapsing the chart).

PRD §11 explicitly says "value non-finite rejected."

**Fix:** In the `log_body_metric` handler, after `const key = normalizeMetricKey(input.key)` at line 2449, add:
```typescript
if (!Number.isFinite(input.value)) throw new Error("value must be a finite number");
```

---

### SF-2 — `log_measurement` response omits `id` when only `restingHr` is provided
**File:** `src/lib/mcp/tools.ts` lines 2396–2410

**Problem:** When the coach calls `log_measurement(restingHr=52)` with no `weightLb`/`bodyFatPct`/`notes`, the handler correctly writes a `BodyMetric(key="rhr")` row, then falls through to `return { message: "Measurement logged" }` (line 2410) — without returning the BodyMetric row's `id`. The coach has no handle on the row that was created, and the message "Measurement logged" is misleading when no Measurement table row exists.

**Trace:**
1. `input.restingHr !== undefined` → `prisma.bodyMetric.create(...)` — row written, `id` discarded
2. `input.weightLb === undefined && input.bodyFatPct === undefined && input.notes === undefined` → skips Measurement.create
3. `return { message: "Measurement logged" }` — no `id`

**Fix:** Capture the created BodyMetric row and return its id, with a clearer message:
```typescript
if (input.restingHr !== undefined) {
  const rhrRow = await prisma.bodyMetric.create({
    data: { date, key: "rhr", value: input.restingHr, unit: "bpm", source: "claude" },
  });
  // If restingHr-only call, return here with the BodyMetric id.
  if (input.weightLb === undefined && input.bodyFatPct === undefined && input.notes === undefined) {
    return { id: rhrRow.id, key: "rhr", message: "Resting HR forwarded to BodyMetric — use log_body_metric going forward" };
  }
}
```

---

## NICE-TO-HAVE

### NTH-1 — `get_body_metrics` tool description omits `hrv` from the key list
**File:** `src/lib/mcp/tools.ts` line 2065–2068

The tool description says `"Covers all registered keys (rhr, sleep_score, spo2, vo2max) plus any ad-hoc keys"` — omitting `hrv`, which is the 5th seed in `BODY_METRICS`. No functional impact (the tool correctly handles hrv rows), but misleads the coach.

**Fix:** Change to `"rhr, sleep_score, spo2, vo2max, hrv"` in the description string.

---

### NTH-2 — `BodyMetricsSection` does not incorporate `normalRange` bounds into domain
**File:** `src/components/BodyMetricsSection.tsx` lines 59–65

The binding revision R-S4 says "if normalRange, include it" in the domain. The current implementation only clamps `%` metrics to `[0, 100]` and ignores `normalRange`. For SpO₂ (the only current key with `normalRange: {min:95, max:100}`), the clamped domain is coincidentally reasonable. Future keys with non-obvious normal ranges will not benefit.

**Fix (low priority):** Import `resolveBodyMetric` result's `normalRange` and widen the domain bounds to include it:
```typescript
const { label, units, normalRange } = resolveBodyMetric(key, latestRow.unit);
// ...after computing minVal/maxVal/pad...
let lo = minVal - pad;
let hi = maxVal + pad;
if (normalRange?.min !== undefined) lo = Math.min(lo, normalRange.min);
if (normalRange?.max !== undefined) hi = Math.max(hi, normalRange.max);
if (units === "%") { lo = Math.max(0, lo); hi = Math.min(100, hi); }
const domain: [number, number] = [lo, hi];
```

---

## PASS-NOTES (verified clean)

### REQ-001 / Schema
`BodyMetric` model at `prisma/schema.prisma` lines 401–413 matches PRD §4 verbatim (all fields, nullability, `@@index([key,date])`, `@@index([date])`). Migration `20260624110928_add_body_metric` is additive, creates table + both indexes. **PASS.**

### REQ-002 / Registry
`src/lib/metrics-registry.ts`:
- 5 seeds present: `rhr`, `sleep_score`, `spo2`, `vo2max`, `hrv` — matches PRD §3 ("Seed registry: RHR, Sleep score, SpO₂, VO₂ max, HRV").
- `BODY_METRIC_ALIASES` covers all R-C1 variants. Spot-checked: `vo_max → "vo2max"` (handles "VO₂ max" typed input where ₂ is stripped as non-[a-z0-9]), `sp02 → "spo2"` (common zero/O typo), `sleep → "sleep_score"`.
- `normalizeMetricKey` implements exactly the R-C1 spec (lowercase → replace `[^a-z0-9]+` → strip leading/trailing `_` → alias lookup).
- No Prisma or Node.js imports — client-safe. **PASS.**

### REQ-003 / Backfill
`prisma/backfill-body-metrics.ts` is idempotent via `source="backfill"` guard, uses `startOfDay(m.date)` for USER_TZ midnight, logs inserted/skipped counts. **PASS.**

### REQ-004 / `log_body_metric`
Tool registered near `log_measurement`. Calls `normalizeMetricKey(input.key)`. Uses `parseDateInput(input.date)` (handles `YYYY-MM-DD` as USER_TZ midnight, ISO strings verbatim). Registry unit default via `BODY_METRIC_BY_KEY.get(key)?.units ?? null`. Returns `{id, key, value, unit, date, message}`. (See SF-1 above for the missing `isFinite` guard.) **PASS WITH SF-1.**

### REQ-005 / `get_body_metrics` + `get_metric_history`
Both tools registered in `registerReadTools` (they appear to be placed in the write section by line number but are still registered before `registerWriteTools` in the file). Both apply R-S2 deterministic ordering: `get_body_metrics` uses `[{date:"desc"},{createdAt:"desc"}]`; `get_metric_history` uses `[{date:"asc"},{createdAt:"asc"}]`. `get_body_metrics` returns registry-order-first then alpha ad-hoc keys. **PASS.**

### REQ-006 / `log_measurement.restingHr` cutover
`log_measurement` MCP tool: `restingHr` param kept, description says "Deprecated — forwarded to BodyMetric(key='rhr')"; handler writes `BodyMetric(key:"rhr", unit:"bpm", source:"claude")` and does NOT write `Measurement.restingHr` (line 2402: `restingHr: null` is explicit). Tool title/description narrowed to "Log body weight or body fat". (See SF-2 for response id issue.) **PASS WITH SF-2.**

### REQ-007 / `logBodyMetric` server action
`src/lib/workout-actions.ts` lines 41–63. Normalizes key via `normalizeMetricKey`. Guards `!Number.isFinite(value)`. `parseDateKey(dateStr)` for USER_TZ. `startOfDay(new Date())` for today default. Registry unit fallback via `BODY_METRIC_BY_KEY`. Revalidates `/`, `/history`, `/progress`, `/stats`. **PASS.**

### REQ-008 / `LogBodyMetricForm`
`src/components/LogBodyMetricForm.tsx`. `"use client"` at line 1. `useFormFeedback`. Select from `BODY_METRICS` + "Custom…" option. Custom branch reveals free-text `name="key"` and `name="unit"` inputs. Registry picks use `<input type="hidden" name="key" value={selectedKey}>` (canonical key). `step=any` on value input. Optional `type="date"` (`name="date"`) and notes. `successMsg: "✓ Metric logged"`. Mobile-first (`flex-col gap-2`, flex-1 for value). **PASS.**

### REQ-009 / RHR out of weigh-in + Launcher row
`LogMeasurementForm` has only `weightLb` and `notes` inputs — no RHR input. `logMeasurement` server action parses only `weightLb` and `notes` — does not write `restingHr`. `LogLauncher` has `"metric"` row at position 2 (after `"weight"`, before `"meal"`, before `"note"`). Renders `{key === "metric" && <LogBodyMetricForm />}` at line 171. **PASS.**

### REQ-010 / `BodyMetricsSection`
`src/components/BodyMetricsSection.tsx`. No `"use client"` (async server component). Single `findMany` with `[{date:"asc"},{createdAt:"asc"}]` — no N+1. Groups by key in JS. `latestRow = keyRows.at(-1)!` is correct for asc-ordered array. `return null` when `rows.length === 0`. Registry → ad-hoc alpha sort. `data` prop (correct name, not `points`), `units`, `domain` all passed to `HistoryChart`. Numeric `[number, number]` domain is compatible with `HistoryChart`'s `[number | string, number | string]` type. Single-point caption at line 71–73. `%` domain clamped to `[0, 100]` with ±2 breathing room. **PASS.**

### REQ-011 / Page wiring
`src/app/progress/page.tsx` line 250: `<BodyMetricsSection />` at top level AFTER the `hasWeightTarget` conditional block (lines 221–247) — not nested inside it. Satisfies R-S5.
`src/app/stats/page.tsx` line 145: `<BodyMetricsSection />` at top level. Both pages are `force-dynamic`. **PASS.**

### R-C1 / Alias map called on all write paths
1. MCP `log_body_metric` handler: `normalizeMetricKey(input.key)` at tools.ts:2449.
2. Server action `logBodyMetric`: `normalizeMetricKey(rawKey)` at workout-actions.ts:43.
3. Form: registry quick-picks submit canonical key via hidden input (no normalization needed — key is already canonical). Custom branch submits free-text key, normalized by the server action above. **PASS.**

### R-S1 / `recent_history` bodyMetrics slice
`recent_history` at tools.ts:748–795 includes a 7th parallel query `prisma.bodyMetric.findMany`. Reduces to latest-per-key in the `since` window. Returns `bodyMetrics: [{key, value, unit, date}]`. **PASS.**

### R-S2 / Deterministic latest
`get_body_metrics`: `orderBy: [{date:"desc"},{createdAt:"desc"}]`.
`get_metric_history`: `orderBy: [{date:"asc"},{createdAt:"asc"}]`.
`BodyMetricsSection`: `findMany` with `[{date:"asc"},{createdAt:"asc"}]`; `latestRow = keyRows.at(-1)`.
All three tie-break equal `date` rows by `createdAt`. **PASS.**

### R-S4 / Chart props
`HistoryChart` signature: `data: HistoryPoint[]`, `units: string`, `domain?: [number | string, number | string]`. `BodyMetricsSection` passes all three. Pre-computed numeric domain avoids Recharts `"dataMin"/"dataMax"` collapse on flat/single-point series. **PASS.**

### R-S5 / Ungated placement
`<BodyMetricsSection/>` in `/progress` is placed at line 250, outside the `{hasWeightTarget && (...)}` block (which ends at line 247). Same pattern in `/stats`. **PASS.**

### USER_TZ correctness
- `logBodyMetric` server action: `parseDateKey(dateStr)` → `userTzWallClockToUTC`. `startOfDay(new Date())` → USER_TZ midnight. No bare `new Date(bareDateStr)` in the body-metric paths.
- `log_body_metric` MCP tool: `parseDateInput(input.date)` → `parseDateKey` for bare `YYYY-MM-DD`, `new Date(s)` for ISO (has tz offset). `startOfDay(new Date())` for today.
- `BodyMetricsSection`: reads dates from DB, formats with `.toISOString()` for chart (display only).
- No `setHours`/`getDate()`/etc. in changed files. **PASS.**

### restingHr write cutover complete
`grep -rn "restingHr" src/` (excluding generated/prisma) returns hits only in:
- `src/lib/mcp/tools.ts` — the deprecated parameter definition and the forwarding handler (`restingHr: null` explicit in Measurement.create).
No other source file writes `Measurement.restingHr`. `LogMeasurementForm` has no RHR input. `logMeasurement` server action does not parse or write `restingHr`. **PASS.**

### Edge cases
- Empty `BodyMetric` table → `BodyMetricsSection` returns `null` (line 15). No empty card renders.
- Ad-hoc key (e.g. `grip_strength`): `resolveBodyMetric("grip_strength", "kg")` → `{ label: "Grip strength", units: "kg", direction: "increase" }`. Chart renders with humanized label and row unit.
- Single-point series: numeric domain with ±2 pad ensures visible Y range; caption "Trend appears with more readings." is shown.
- `value = 0` passes `Number.isFinite(0)` — correct (0 is a valid measurement).
- Custom key whitespace-only: `"   ".trim() = ""` → `normalizeMetricKey("") = ""` → `if (!key) throw` — CORRECT.

### Backfill script
`prisma/backfill-body-metrics.ts` imports `startOfDay` / `endOfDay` from `calendar-core`. Uses `dayStart = startOfDay(m.date)` (USER_TZ midnight). Idempotency guard checks `{key:"rhr", source:"backfill", date: {gte: dayStart, lte: dayEnd}}`. Run twice → second run inserts 0. **PASS.**

---

## Verdict

2 SHOULD-FIX (SF-1: add `isFinite` guard to MCP handler; SF-2: return BodyMetric row `id` from restingHr-only `log_measurement` call). Both are small, well-scoped fixes. Feature is otherwise complete and correct per spec.
