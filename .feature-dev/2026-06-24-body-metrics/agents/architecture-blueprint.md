# Architecture Blueprint — Body-Metric Tracker

Concrete shapes for implementers. PRD: `docs/prds/PRD-body-metrics.md`. Mirror existing patterns exactly.

## ⚠️ Post-critique revisions (BINDING — supersede anything below that conflicts)
Read `agents/architecture-critique.md` for full reasoning. Apply these:

- **R-C1 — Alias map + shared normalizer (kills series fork).** In `metrics-registry.ts` export ONE helper:
  `normalizeMetricKey(raw)`: `raw.toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"")`, THEN map through a hand-curated `BODY_METRIC_ALIASES: Record<string,string>` (loose form → canonical seed key). Seed canonical keys must map to themselves. Cover at least:
  `vo2max, vo2_max, vo_max, vo2 → "vo2max"` · `spo2, blood_oxygen, blood_o2, o2, oxygen, sp_o2 → "spo2"` · `sleep, sleep_score → "sleep_score"` · `rhr, resting_hr, resting_heart_rate, resting_heart → "rhr"`.
  `normalizeMetricKey` returns the alias-resolved canonical key when matched, else the loose-normalized key (ad-hoc). Use it in the MCP write tool, the server action, AND the form's custom-key path. Quick-picks already submit canonical keys. (Mirrors `EXERCISE_ALIAS_GROUPS` — hand-curated, single source.)
- **R-C2 — Serialize the migration.** `src/generated/prisma` is gitignored and `DATABASE_URL` is a shared Neon DB. REQ-001 runs `prisma migrate dev` exactly ONCE, on the feature branch, and is committed BEFORE any other agent starts. Dependent agents do NOT run `migrate dev`; they branch off the updated feature branch and run `npx prisma generate` only.
- **R-S1 — Keep RHR in the firehose.** After REQ-006 cuts `Measurement.restingHr` writes, add a `bodyMetrics` slice (latest value per key) to `recent_history`'s return (it currently `findMany`s measurements with no select and incidentally surfaced RHR). Small addition in REQ-005's scope so the coach still sees recent body metrics inline.
- **R-S2 — Deterministic latest-per-day.** Everywhere "latest" is computed (get_body_metrics, get_metric_history ordering, BodyMetricsSection), tie-break equal `date` by `createdAt` then `id`. Query `orderBy: [{date:"desc"},{createdAt:"desc"}]` (or asc for series + reverse).
- **R-S4 — Chart props.** `HistoryChart` prop is **`data`** (not `points`), shape `{date,value,tooltip?}[]`, plus `units` and optional `domain`. Its default domain `["dataMin","dataMax"]` collapses flat/single-point series — the Section MUST pass an explicit padded domain (e.g. `["dataMin - pad","dataMax + pad"]`, pad from range or a sensible per-unit default; for `%` clamp sensibly). Mirror `WeightChart`'s ±-padding intent.
- **R-S5 — Ungated placement.** On `/progress` the Weight card is conditional on `hasWeightTarget`; render `<BodyMetricsSection/>` as its OWN top-level section (NOT inside the weight conditional) so it shows even when the weight card is absent. Same on `/stats`.

## Prisma (`prisma/schema.prisma`)
See PRD §4 for the `BodyMetric` model verbatim. Then `npx prisma migrate dev --name add_body_metric` (REQ-001 only — see R-C2).

## Registry (`src/lib/metrics-registry.ts`) — client-safe
```ts
export type BodyMetricSpec = {
  key: string; label: string; units: string; direction: Direction;
  description: string; normalRange?: { min?: number; max?: number };
};
export const BODY_METRICS: BodyMetricSpec[] = [
  { key: "rhr",         label: "Resting heart rate", units: "bpm",        direction: "decrease", description: "Resting HR from a wearable." },
  { key: "sleep_score", label: "Sleep score",        units: "pts",        direction: "increase", description: "Nightly sleep score." },
  { key: "spo2",        label: "Blood oxygen (SpO₂)",units: "%",          direction: "increase", description: "Blood oxygen saturation.", normalRange: { min: 95, max: 100 } },
  { key: "vo2max",      label: "VO₂ max",            units: "ml/kg/min",  direction: "increase", description: "Cardiorespiratory fitness estimate." },
];
export const BODY_METRIC_BY_KEY = new Map(BODY_METRICS.map((m) => [m.key, m]));
export function humanizeMetricKey(key: string): string; // "grip_strength" -> "Grip strength"
export function resolveBodyMetric(key: string, rowUnit?: string | null): {
  label: string; units: string; direction: Direction; normalRange?: { min?: number; max?: number };
}; // registry wins; ad-hoc -> { label: humanize(key), units: rowUnit ?? "", direction: "increase" }
```
`Direction` already exists in this file. Reuse the existing `normalizeMetricKey` if present, else add: `key.trim().toLowerCase().replace(/\s+/g, "_")`.

## MCP tools (`src/lib/mcp/tools.ts`)
`log_body_metric` (write, near `log_measurement`):
```ts
inputSchema: {
  key:   z.string().min(1).describe("Bare metric key, lowercase snake — rhr | sleep_score | spo2 | vo2max | ad-hoc. No prefix."),
  value: z.number().describe("Numeric reading."),
  unit:  z.string().optional().describe("Unit e.g. bpm | % | ml/kg/min. Optional for registered keys."),
  date:  z.string().optional().describe("yyyy-mm-dd (USER_TZ) or ISO. Default today."),
  notes: z.string().optional(),
  source: z.enum(["manual","claude","watch","imported"]).default("claude"),
}
// handler: normalize key; date = input.date ? parseDateInput(input.date) : startOfDay(new Date());
// unit ??= BODY_METRIC_BY_KEY.get(key)?.units ?? null; prisma.bodyMetric.create(...);
// return { id, key, value, unit, date: <dateKey>, message: "Body metric logged" }
```
`get_body_metrics` (no inputSchema): one `findMany({orderBy:{date:"desc"}})`, reduce to latest-per-key →
`{ metrics: [{ key, label, units, direction, latest:{value,date}, count, firstDate, lastDate }] }`.
`get_metric_history`: `{ key, days?: z.number().int().min(1).max(365).default(180).optional() }` → `{ key, label, units, direction, points: [{date,value,unit}] }` oldest-first.
`log_measurement` revision (REQ-006): keep `restingHr` param, `.describe("Deprecated — forwarded to BodyMetric(key='rhr'); prefer log_body_metric.")`; when provided, create `BodyMetric(key:"rhr",value:restingHr,unit:"bpm",source:"claude",date)` and do NOT set `Measurement.restingHr`. Narrow title/description to weight + body fat.

Dates as dateKey via the existing helper used by other read tools (e.g. `dateKey()` / `toDateKey`). `safe()`-wrap all.

## Server action (`src/lib/workout-actions.ts`)
```ts
export async function logBodyMetric(form: FormData) {
  const key = String(form.get("key") ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  const value = Number(form.get("value"));
  const unit = (form.get("unit") as string | null)?.trim() || null;
  const dateStr = (form.get("date") as string | null)?.trim();
  const notes = (form.get("notes") as string | null)?.trim() || null;
  if (!key) throw new Error("Metric is required");
  if (!Number.isFinite(value)) throw new Error("Value must be a number");
  const date = dateStr ? parseDateKey(dateStr) : startOfDay(new Date());
  const resolvedUnit = unit ?? BODY_METRIC_BY_KEY.get(key)?.units ?? null;
  await prisma.bodyMetric.create({ data: { date, key, value, unit: resolvedUnit, notes, source: "manual" } });
  revalidatePath("/"); revalidatePath("/history"); revalidatePath("/progress"); revalidatePath("/stats");
}
```
Also edit `logMeasurement`: remove `restingHr` parse + field from `measurement.create`.

## Form (`src/components/LogBodyMetricForm.tsx`)
Model on `LogMeasurementForm.tsx`. `"use client"`, `useFormFeedback`. Metric `<select>` from `BODY_METRICS` (+ "Custom…" → reveals free-text key + unit inputs). Registry pick auto-fills/locks unit. Value `type=number step=any` required. Optional `type=date` + notes. `submit(logBodyMetric, { successMsg: "✓ Metric logged" })`.

## Launcher (`src/components/LogLauncher.tsx`)
Add `{ key: "metric", label: "Body metric", sub: "RHR, sleep, SpO₂, VO₂ max…", icon: <pulse svg> }` to `rows`; extend the `ExpandedRow`/expanded union with `"metric"`; render `{key === "metric" && <LogBodyMetricForm />}`. Order: weight, metric, meal, note.

## Section (`src/components/BodyMetricsSection.tsx`) — async server component
```ts
const rows = await prisma.bodyMetric.findMany({ orderBy: { date: "asc" } });
if (rows.length === 0) return null;
// group by key -> points {date: iso, value, tooltip: `${value} ${units}`}
// resolveBodyMetric(key, latestRow.unit) for label/units/direction
// Y-domain: ["dataMin - pad","dataMax + pad"]; if normalRange, include it.
// render <Card title={label}> <HistoryChart data points units domain /> ; caption when points.length===1.
// order: registry order first, then ad-hoc keys alpha.
```
Insert `<BodyMetricsSection />` after the Weight card in `src/app/progress/page.tsx` and `src/app/stats/page.tsx`. NOT gated on goal targets.

## Backfill (`prisma/backfill-body-metrics.ts`)
Standalone (`import "dotenv/config"; import { prisma } from "../src/lib/db"`). For each `Measurement` with `restingHr != null`: insert `BodyMetric(key:"rhr",value:restingHr,unit:"bpm",source:"backfill",date:startOfDay(m.date))` unless a `source:"backfill"` rhr row already exists in that day window. Log inserted/skipped. Run: `npx tsx prisma/backfill-body-metrics.ts`.
