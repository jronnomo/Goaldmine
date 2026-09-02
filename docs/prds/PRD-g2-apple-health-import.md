# PRD: Apple Health Import

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-09-02
**Status**: Draft
**GitHub Issue**: N/A — solo flow, no issue
**Branch**: `feature/phase1-auth` (current; no new branch)
**Companion PRD**: `docs/prds/PRD-g1-trends-dashboard.md` (consumes `HealthDaily`; see G1 §4.9)
**UX-research**: invoked — see `docs/ux-research/trends-dashboard.md` + ledger

---

## 1. Overview

### 1.1 Problem Statement

Goaldmine knows what the founder *ate* and what he *weighed*, but nothing about what he *spent*. That gap is why `/trends` can only ever produce a **derived** TDEE — inferred from intake and the weight slope. The founder already carries an Apple Watch that measures active and basal energy, steps, exercise minutes, resting HR, VO₂ max, SpO₂ and sleep every single day. That data exists; the app just can't see it.

The blocker is mechanical. Apple Health exports as a zip containing an `export.xml` that routinely runs **100–500 MB** for a multi-year user, and **Vercel caps a serverless request body at ~4.5 MB** (Server Actions default to 1 MB). The file can never be uploaded to this app. The existing `/import` route is a paste-a-textarea flow built for Strong's ~2 KB txt files and cannot be stretched to cover this.

Building a calorie-*burn model* instead (MET tables, estimated burn from workout volume) was explicitly rejected: it would introduce the app's first fabricated number into a codebase whose whole ethos is deterministic, honest math. Expenditure must be **measured**, never modeled.

### 1.2 Proposed Solution

A **client-side streaming importer**. On `/import`, the user picks `export.zip` (or an already-unzipped `export.xml`). A Web Worker unzips if needed, streams the XML through an incremental parser that never holds the whole file in memory, and aggregates records down to **one row per day**. Three years of history collapses from ~380 MB to roughly 1,100 rows / ~90 KB, which is then uploaded in batches through a server action.

The raw health export never leaves the device — only daily summaries do. That is a privacy property worth stating plainly in the UI, and it is also the only design that fits inside the platform's body limit.

Daily energy, steps and exercise minutes land in a new owned model, **`HealthDaily`**. Resting HR, VO₂ max, SpO₂ and sleep duration land in the **existing `BodyMetric`** table with `source: "imported"` — which means they light up the Body-metrics section on `/progress` for free, with no new UI. Re-importing a fresher export is idempotent: each batch deletes the imported rows it is about to replace (scoped by `source`, so hand-logged rows are never touched) and re-inserts.

### 1.3 Success Criteria

1. A multi-hundred-MB `export.zip` imports successfully in the browser without the tab running out of memory or the request exceeding Vercel's body limit.
2. Imported daily energy makes `/trends` show **measured** TDEE beside the observed estimate.
3. Re-importing the same or a newer export produces no duplicate rows and no lost hand-logged rows.
4. Imported `BodyMetric` rows appear on `/progress` with `source: "imported"` and correct units.
5. Multi-device double-counting (iPhone + Watch both reporting steps) is resolved, not summed.
6. The parser is pure and unit-tested against a committed fixture, like `parsers/strong.ts`.

---

## 2. User Stories

| ID | As a... | I want to... | So that... | Priority |
|----|---------|--------------|------------|----------|
| US-101 | user in the PWA | import my Apple Health export | the app knows what I actually burned | Must Have |
| US-102 | user in the PWA | see progress while a large file parses | I know the app hasn't frozen | Must Have |
| US-103 | user in the PWA | re-import a newer export later | my data stays current without duplicating | Must Have |
| US-104 | user in the PWA | keep my raw health file on my device | I'm not uploading years of medical data to a server | Must Have |
| US-105 | user in the PWA | see resting HR / VO₂ max / SpO₂ / sleep on `/progress` | my wearable data joins the rest of my metrics | Should Have |
| US-106 | user in the PWA | be told what was imported and what was skipped | I can trust the result rather than guess | Must Have |
| US-107 | the coach (Claude via MCP) | read imported expenditure through `get_trend_window` | I can discuss real maintenance calories | Must Have |
| US-108 | user in the PWA | keep my hand-logged weigh-ins untouched | the series that drives goal readiness stays mine | Must Have |

---

## 3. Functional Requirements

### 3.1 Core Requirements

1. `/import` becomes a two-section page: the existing **Strong workout** paste form, plus a new **Apple Health** section. The Strong flow is not modified.
2. A file picker accepting `.zip` and `.xml`. No drag-and-drop requirement (phone-first).
3. A **Web Worker** performs unzip (when needed) + streaming parse + daily aggregation. The main thread stays responsive throughout.
4. The parser handles these record types:

   | HealthKit identifier | Aggregation | Destination |
   |---|---|---|
   | `HKQuantityTypeIdentifierActiveEnergyBurned` | sum/day | `HealthDaily.activeKcal` |
   | `HKQuantityTypeIdentifierBasalEnergyBurned` | sum/day | `HealthDaily.basalKcal` |
   | `HKQuantityTypeIdentifierStepCount` | sum/day | `HealthDaily.steps` |
   | `HKQuantityTypeIdentifierAppleExerciseTime` | sum/day | `HealthDaily.exerciseMin` |
   | `HKQuantityTypeIdentifierRestingHeartRate` | mean/day | `BodyMetric` key `rhr` |
   | `HKQuantityTypeIdentifierVO2Max` | latest/day | `BodyMetric` key `vo2max` |
   | `HKQuantityTypeIdentifierOxygenSaturation` | mean/day | `BodyMetric` key `spo2` |
   | `HKCategoryTypeIdentifierSleepAnalysis` | asleep-hours/night | `BodyMetric` key `sleep_hours` |

5. **Multi-source de-duplication.** Apple emits overlapping records from every device (iPhone *and* Watch both count steps). Naive summing roughly doubles them. For each `(dateKey, type)`, group by `sourceName`, compute each source's total, and **take the single largest total** — never the sum across sources. This rule is unit-tested.
6. **Day bucketing.** A record buckets to the `YYYY-MM-DD` prefix of its `startDate` attribute, which Apple already writes in the device's local wall-clock with an explicit offset. That prefix is taken **as the `dateKey`** and converted via `parseDateKey` (USER_TZ midnight). It is *not* re-zoned through UTC — doing so would shift late-evening records into the next day.
7. **Sleep** is grouped into *nights*, then attributed to the **wake date**. Apple emits dozens of stage segments per night, so bucketing each segment by its own `endDate` day is wrong: a normal 22:30–06:30 night splits ~1.3 h onto the onset date and ~6.7 h onto the wake date, for every user who falls asleep before midnight. **Rule: a segment whose end time-of-day is ≥ 18:00 belongs to the NEXT civil date; otherwise to its own end date.** That lands every segment of one night on a single wake date. Sum only asleep categories (`AsleepCore`, `AsleepDeep`, `AsleepREM`, `AsleepUnspecified`); exclude `InBed` and `Awake`. Report hours to one decimal. The fixture MUST contain a realistic multi-segment night (≥6 segments straddling midnight, onset before 23:00) asserting the whole night lands on ONE date — a single midnight-spanning record passes trivially and would enshrine the split bug green.
8. **SpO₂ normalization.** Apple writes oxygen saturation as a fraction (`0.97`) despite `unit="%"`. Any value ≤ 1 is multiplied by 100. Unit-tested.
9. Upload in **batches of 500 day-rows** through a server action, with a progress indicator (`parsing… n%` → `uploading n of m`).
10. **Idempotent writes.** Per batch, scoped by tenant: `deleteMany` the target dates for that `source`, then `createMany`. Hand-logged rows (`source: "manual"`) are never in the delete filter and are never touched.
11. A **result summary** after import: date range covered, day-row count, per-metric counts, and a skipped/unrecognized count.
12. New owned Prisma model `HealthDaily` with `userId`, migration, and both isolation verifiers run.
13. New body-metric registry seed **`sleep_hours`** (units `h`, direction `increase`) — Apple reports sleep *duration*, and the existing `sleep_score` seed is a points score with a different unit and meaning. Reusing it would corrupt the metric.

### 3.2 Secondary Requirements

14. `HKQuantityTypeIdentifierHeartRateVariabilitySDNN` → `BodyMetric` key `hrv` (ms). The registry seed already exists; this is one more entry in the identifier map.
15. A **dry-run preview** before writing: show the row count and date range, require a confirm tap.
16. `HealthDaily.standHours` from `HKCategoryTypeIdentifierAppleStandHour` (count of `Stood` per day).
17. Remember the last import's date range in the result card so a re-import can be reasoned about.

### 3.3 Out of Scope

- **Importing body mass as weigh-ins.** Apple body-mass records are ignored entirely. `Measurement` stays hand-logged — it drives goal readiness and TDEE, and the founder chose to keep it under manual control.
- Importing `<Workout>` elements as `Workout` / `Hike` rows. Workouts remain Strong-imported or hand-logged; auto-creating them would collide with the existing rows and the attribution engine.
- Any burn **model**. Only measured values are stored.
- Background / automatic sync, HealthKit API integration, or an iOS companion app. This is a manual file import.
- Heart rate time series, ECG, nutrition records from other apps, workout routes/GPS.
- Server-side storage of the raw export file. It is never uploaded.

---

## 4. Technical Design

### 4.1 Data Model (Prisma)

```prisma
model HealthDaily {
  id          String   @id @default(cuid())
  date        DateTime // USER_TZ midnight (parseDateKey)
  activeKcal  Float?
  basalKcal   Float?
  steps       Int?
  exerciseMin Int?
  standHours  Int?
  source      String   @default("apple_health") // apple_health | manual
  userId      String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  user        User?    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, date])
  @@index([date])
}
```

Also add the back-relation `healthDaily HealthDaily[]` to `model User`, and register `HealthDaily` in the owned-model list that `src/lib/db.ts` scopes and that `db:verify-owned` audits.

**No `@@unique` on `(userId, date, source)`.** `userId` is nullable (matching every other owned model here), and Postgres treats NULLs as distinct in unique constraints, so the constraint would silently fail to dedupe exactly the rows it exists to protect. Idempotency is enforced by the delete-then-insert write path (§4.3) instead, which is also what makes a *corrected* re-import overwrite rather than skip.

Migration plan:
- Name: `health-daily`
- `npm run db:which` first (must show the dev branch / `DB_ENV=development`), then `npm run db:migrate -- --name health-daily`, then `npx prisma generate`
- **Additive only** — one new table, no column changes to existing models besides the `User` back-relation. Safe on existing rows; reversible by dropping the table.
- Then `npm run db:verify-owned` **and** `npm run db:verify-isolation` — both must pass.
- No backfill.

`BodyMetric` needs **no** schema change: `source` already documents `"imported"` as a valid value.

### 4.2 MCP Tool Surface

**No new MCP tools in G2.** Imported data is read through G1's `get_trend_window` (energy) and the existing `get_body_metrics` / `get_metric_history` tools (rhr / vo2max / spo2 / sleep_hours / hrv), which already scope by `getDb()` and are already covered by leaky-reads.

**Verification required**: confirm `get_body_metrics` returns the new `sleep_hours` key correctly (it is registry-driven, so a seed addition should suffice) and that its existing leaky-reads case still passes.

### 4.3 Server Actions

New file `src/lib/health-import-actions.ts`:

| Action | Input | Mutation | revalidatePath | Redirect? |
|---|---|---|---|---|
| `importHealthDaysBatch(payload)` | `{ rows: HealthDayRow[]; metrics: BodyMetricRow[] }`, ≤500 rows | scoped `deleteMany` + `createMany` on `HealthDaily`; same on `BodyMetric` filtered to `source: "imported"` and the imported keys | `/trends`, `/progress`, `/` | No |

- `"use server"`, `const db = await getDb()` — every query scoped. The raw `prisma` singleton must not appear.
- Input validated with **Zod** before touching the DB (this is client-supplied data crossing a trust boundary): `dateKey` matched against `/^\d{4}-\d{2}-\d{2}$/`, every numeric field finite and non-negative, batch length ≤ 500, and per-field sanity caps (kcal ≤ 20 000/day, steps ≤ 200 000/day, sleep ≤ 24 h) so a malformed export cannot poison the aggregates.
- Delete filters are always `{ source: "apple_health", date: { in: batchDates } }` (and for metrics `{ source: "imported", key: { in: importedKeys }, date: { in: batchDates } }`). **`source` in the filter is what protects hand-logged rows** — omitting it would delete manual entries.
- Sequential `deleteMany` then `createMany` per batch. A transaction is preferable; if wrapping the extended `ScopedClient` in `$transaction` proves awkward, sequential calls are acceptable because the operation is idempotent on retry — document whichever is used.
- Called in a loop from the client with progress feedback; a failed batch reports its index and the import can be re-run safely.

### 4.4 Pages / Components

**New pure parser** — `src/lib/parsers/apple-health.ts` (pure, no DOM, no Prisma, no `Date.now()`, no TZ calls; unit-tested like `parsers/strong.ts`):

```ts
export type HealthDayRow = {
  dateKey: string;
  activeKcal: number | null; basalKcal: number | null;
  steps: number | null; exerciseMin: number | null; standHours: number | null;
};
export type BodyMetricRow = { dateKey: string; key: string; value: number; unit: string };
export type ImportSummary = {
  dayRows: HealthDayRow[]; metricRows: BodyMetricRow[];
  firstDateKey: string | null; lastDateKey: string | null;
  recordsSeen: number; recordsUsed: number; recordsSkipped: number;
  perType: Record<string, number>;
};

/** Incremental, chunk-boundary-safe. Feed arbitrary text chunks; call finish() once. */
export function createHealthAggregator(): {
  pushChunk(text: string): void;
  finish(): ImportSummary;
};
```

The aggregator holds a carry buffer for a `<Record …/>` tag split across chunk boundaries, keeps per-`(dateKey, type, sourceName)` accumulators, and resolves the multi-source rule (§3.1.5) in `finish()`. It is a tag-scanner, **not** a DOM parser — `DOMParser` on a 400 MB string is an immediate OOM.

**New worker** — `src/lib/parsers/apple-health.worker.ts`. Instantiated as `new Worker(new URL("./apple-health.worker.ts", import.meta.url))` (Turbopack-supported). Receives the `File`, unzips when the name/magic-bytes indicate a zip, streams via `file.stream().pipeThrough(new TextDecoderStream())`, feeds `pushChunk`, posts `{ type: "progress", pct }` messages, and posts the final `ImportSummary`. **`npm run build` must be verified to succeed with the worker** — if Turbopack bundling of the worker fails, fall back to main-thread parsing chunked with `await new Promise(r => setTimeout(r, 0))` between chunks so the UI still repaints, and record the fallback in the completion report.

**New component** — `src/components/AppleHealthImportForm.tsx`, `"use client"`: file input → worker → progress → preview/confirm → batched `importHealthDaysBatch` calls → result summary. States: idle, parsing (%), preview, uploading (n/m), done, error.

**New fixture** — `examples/apple-health-sample.xml`: a small hand-written export covering every supported identifier, a multi-source step conflict, a chunk-boundary split, a fractional SpO₂, and a sleep night spanning midnight. Committed and used by the parser tests. It must contain **no real personal data**.

**Modified**: `src/app/import/page.tsx` (add the Apple Health `Card` below the Strong card; keep the Strong flow byte-identical), `prisma/schema.prisma`, `src/lib/db.ts` (owned-model registration), `src/lib/metrics-registry.ts` (add the `sleep_hours` seed + `sleep_hours`/`sleep_duration`/`time_asleep` aliases — do **not** alter the existing `sleep` → `sleep_score` alias, which is load-bearing for hand-logged rows).

### 4.5 Date / Time Semantics

- The parser deals in **`dateKey` strings only** and performs no `Date` construction at all — that is what keeps it pure and testable.
- Conversion to `Date` happens once, server-side in the action, via `parseDateKey(dateKey)` → USER_TZ midnight.
- Day bucketing uses the literal `YYYY-MM-DD` prefix of Apple's `startDate` (`endDate` for sleep). No UTC round-trip, no `new Date(str)` re-parse — both would shift evening records across the day boundary.
- No new MCP tool, so no `parseDateInput` surface added here.
- DST: because buckets are wall-clock date strings from the device, a 23- or 25-hour day still produces exactly one bucket.

### 4.6 Deferral / Override Awareness

Not applicable. The importer writes historical measurement rows; it has no relationship to per-day plan state, reads no `ResolvedDay`, and adds no `PlanDayOverride` fields.

### 4.7 Tenant Scoping & Auth

- New owned model `HealthDaily` carries `userId` + `@@index([userId, date])`, is registered in `src/lib/db.ts`'s scoped extension, and both `npm run db:verify-owned` and `npm run db:verify-isolation` must pass before this is considered done.
- `BodyMetric` writes go through the same scoped client.
- `/import` is already absent from `isPublicPath()` and therefore session-protected; no `route-access.ts` change.
- Server actions resolve the tenant via `getDb()` → Auth.js session. An unauthenticated call redirects rather than silently defaulting.
- No session, invite-gate or OAuth surface is touched.

### 4.8 Third-Party Dependencies

| Package | Why | Notes |
|---|---|---|
| `fflate` | Streaming unzip of `export.zip` in the browser | ~8 KB, MIT, zero deps, works in a Worker. The alternative — asking the user to unzip a 400 MB archive by hand on a phone — is not a real flow. |

No LLM API, no network calls from the importer, no telemetry. If `fflate` is rejected in review, the fallback is `.xml`-only input with instructions to unzip first; the parser is unaffected either way.

---

## 5. UI/UX Specifications

### 5.1 Screen Descriptions

`/import` at 390 px:

```
┌────────────────────────────────────────┐
│ Import                                 │
│ Bring outside data into Goaldmine.     │
├────────────────────────────────────────┤
│ ┌ Strong workout ────────────────────┐ │  (unchanged)
│ │ [ paste txt … ]                    │ │
│ └────────────────────────────────────┘ │
│ ┌ Apple Health ──────────────────────┐ │
│ │ Energy, steps, resting HR, VO₂ max,│ │
│ │ SpO₂ and sleep — one row per day.  │ │
│ │                                    │ │
│ │ Your export is read on this device.│ │
│ │ Only daily totals are uploaded.    │ │
│ │                                    │ │
│ │ [ Choose export.zip ]              │ │  ≥44px
│ │                                    │ │
│ │ Health ▸ your photo ▸ Export All   │ │  <details> how-to
│ └────────────────────────────────────┘ │
└────────────────────────────────────────┘
```

Parsing → preview → done:

```
│ Reading export.zip…                    │      │ Ready to import          │      │ ✓ Imported               │
│ ▓▓▓▓▓▓▓▓▓▓░░░░░░░░  54%                │  →   │ 1,096 days               │  →   │ 1,096 days              │
│ 2.1M records scanned                   │      │ Jun 3 2023 → Sep 1 2026  │      │ Jun 2023 → Sep 2026     │
│ Keep this tab open.                    │      │ energy 1,096 · steps 1,090│     │ 4,312 metric readings   │
│                                        │      │ rhr 1,041 · sleep 1,002  │      │ 812 records skipped     │
│                                        │      │ [ Import ] [ Cancel ]    │      │ [ See trends → ]        │
```

**States**: idle · parsing (determinate % by bytes read) · preview (counts + range + confirm) · uploading (`batch n of m`) · done (summary + `/trends` link) · error (message + retry, nothing partially written that a re-run won't fix).

### 5.2 Navigation Flow

**In**: `MoreSheet` → *Import* (existing row); the empty-state on `/trends` links here when there is no health data.
**Out**: the done state links to `/trends`; `/progress` picks up the new `BodyMetric` rows with no navigation change.
**BottomNav**: unchanged — `/import` keeps its current (non-lit) treatment.

### 5.3 Responsive + Mobile-First Spec

- 390 px primary; `max-w-md mx-auto p-4 space-y-4`, matching the existing `/import`.
- File input rendered as a ≥ 44 px labelled button, thumb-reachable; the native picker on iOS reaches Files, where the Health export lands.
- Progress bar is a token-colored `div` (`var(--accent)` on `var(--border)`) — no new dependency, no indeterminate spinner for a determinate operation.
- The how-to sits inside a native `<details>` so it costs no vertical space by default.
- `<Card>` layout, tokens only, no hardcoded colors.

### 5.4 Accessibility

- The file input is a real `<input type="file">` with an associated `<label>` — not a click-hijacked div.
- Progress uses `role="progressbar"` with `aria-valuenow` / `aria-valuemin` / `aria-valuemax`, and a `aria-live="polite"` region announces phase changes (parsing → preview → done) without spamming every percent tick.
- Errors render as text in an `aria-live="assertive"` region, never as color alone.
- Visible focus rings on the picker, Import and Cancel.
- The result summary is readable text, not an icon-only state.

---

## 6. Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|------------------|
| No active program | Irrelevant — the importer writes measurement rows, not plan rows. Works identically. |
| Brand-new user (zero rows) | Import works and is in fact a good first action. `/trends` then has health data but no nutrition; G1's gates handle it. |
| Empty data (export with no supported records) | Preview shows `0 days` and disables Import, with "No supported records found — is this the right file?" |
| Wrong file (a photo, a CSV, `export_cda.xml`) | Detected at parse: 0 records matched → the same clear message. Never a stack trace. |
| Zip containing `apple_health_export/export.xml` | Resolved by path suffix; `export_cda.xml` explicitly ignored. |
| File too large for device memory | Cannot happen by construction — streaming parse, bounded carry buffer, per-day accumulators only. The largest resident structure is ~1 row per day. |
| A `<Record>` split across a chunk boundary | Carry buffer holds the partial tag until the next chunk. Explicitly unit-tested. |
| Multi-source double counting (iPhone + Watch) | Largest single-source total per `(day, type)` wins; sources are never summed. Unit-tested. |
| SpO₂ exported as `0.97` with `unit="%"` | Values ≤ 1 multiplied by 100. Unit-tested. |
| Sleep night spanning midnight (multi-segment) | All segments group to ONE wake date via the ≥18:00 cutoff. A realistic 6+ segment night is unit-tested, not just a single spanning record. |
| `InBed` / `Awake` sleep records | Excluded from asleep hours. |
| Re-import of the same export | Delete-then-insert per batch → identical row count, no duplicates. |
| Re-import of a *corrected* export | Newer values overwrite (delete-then-insert, not skip-duplicates). |
| Import overlapping hand-logged `BodyMetric` rows | Manual rows survive: the delete filter is pinned to `source: "imported"`. |
| Apple body-mass records present | Ignored entirely — `Measurement` is never written by this feature. |
| Batch upload fails mid-run | Error names the failed batch index; already-written batches are valid; re-running is safe (idempotent). |
| Tab closed mid-parse | Nothing written until the user confirms and batches begin; a partial upload is a valid partial import that a re-run completes. |
| Malformed numbers / absurd values in the export | **The parser** enforces per-field bounds in `finish()` and increments `recordsSkipped`; a single glitch value must never be able to fail a batch. The action's Zod layer stays a strict whole-batch reject — it is the trust boundary, not the data-cleaning layer. |
| DST transition | Buckets are device wall-clock date strings — exactly one bucket per calendar day regardless. |
| Long filename overflow at 390 px | Truncated with `text-ellipsis overflow-hidden whitespace-nowrap`. |

---

## 7. Security Considerations

- **The raw export is never uploaded.** Parsing is client-side; only aggregated daily rows cross the network. This is a deliberate privacy property and must be stated in the UI copy.
- **Client-supplied data crossing a trust boundary.** The action receives numbers computed in the user's browser, so it re-validates everything with Zod server-side: date-key format, finiteness, non-negativity, per-field sanity caps, and batch length. Never trust the worker's output shape.
- **Tenant isolation**: `HealthDaily` is a new owned model with `userId`, registered in the scoped client; all reads/writes via `getDb()`. `db:verify-owned` + `db:verify-isolation` are acceptance gates, not optional checks.
- **Destructive-write containment**: every `deleteMany` is filtered by `source` **and** an explicit date list. A missing `source` filter would delete hand-logged rows — call this out in review, and unit-test that the filter includes `source`.
- **Route protection**: `/import` is session-gated by `src/middleware.ts` (absent from `isPublicPath()`). Server actions independently resolve the tenant via the session.
- **Rate limiting**: batched actions are user-initiated and bounded (≤500 rows, ~a few dozen calls for a decade of data). Existing Upstash middleware coverage applies; no new public endpoint is added.
- **DoS/OOM self-protection**: the parser's memory is bounded by day count, not file size; the carry buffer is capped and a tag longer than the cap is discarded as malformed rather than grown unboundedly.
- No `dangerouslySetInnerHTML` (the filename and all summary values render as text nodes); no raw SQL; no LLM calls; no outbound network requests from the importer.

---

## 8. Acceptance Criteria

1. [ ] `npx tsc --noEmit` passes with 0 errors.
2. [ ] `npm run lint` introduces no new errors.
3. [ ] `npm run test` passes; `src/lib/parsers/apple-health.test.ts` is added and green.
4. [ ] `npm run build` succeeds **with the Web Worker bundled** (or the documented main-thread fallback is in place and noted).
5. [ ] `npx prisma generate` regenerates `src/generated/prisma` including `HealthDaily`.
6. [ ] `npm run db:which` shows the dev branch; `npm run db:migrate -- --name health-daily` applies cleanly.
7. [ ] `npm run db:verify-owned` passes with `HealthDaily` recognized as owned.
8. [ ] `npm run db:verify-isolation` passes.
9. [ ] `src/lib/parsers/apple-health.ts` imports no Prisma, constructs no `Date`, and calls no locale/TZ API.
10. [ ] Parser tests cover, each as its own case: chunk-boundary split tag · multi-source step conflict resolving to the largest single source · fractional SpO₂ → percent · a realistic multi-segment night grouping entirely onto its wake date · `InBed`/`Awake` excluded · unknown record types counted as skipped, not thrown on · an out-of-range value skipped-and-counted by the parser rather than aborting the run.
11. [ ] `examples/apple-health-sample.xml` is committed and contains no real personal data.
12. [ ] `importHealthDaysBatch` validates input with Zod and rejects a >500-row batch, a bad date key, a negative value, and an out-of-range value.
13. [ ] Every `deleteMany` in `health-import-actions.ts` includes a `source` filter — asserted by a unit test, not just by review.
14. [ ] `grep -rn "prisma\." src/lib/health-import-actions.ts` returns no matches (scoped `db` only).
15. [ ] `grep -nE 'setHours|setDate|getHours|getDate\(\)|getMonth\(\)|getFullYear' src/lib/parsers/apple-health.ts src/lib/health-import-actions.ts src/components/AppleHealthImportForm.tsx` returns **no** matches.
16. [ ] `importHealthDaysBatch` calls `revalidatePath` for `/trends`, `/progress` and `/`.
17. [ ] `metrics-registry.ts` gains a `sleep_hours` seed (units `h`); the existing `sleep` → `sleep_score` alias is unchanged.
18. [ ] `/import` renders both the Strong card and the Apple Health card at 390 px; the Strong flow is unmodified.
19. [ ] Importing the fixture twice yields the same row count (idempotency), verified against the dev DB.
20. [ ] A hand-logged `BodyMetric` row on an imported date survives an import.
21. [ ] `Measurement` rows are never created by this feature (`grep -n "measurement" src/lib/health-import-actions.ts` empty).
22. [ ] After import, `/trends` shows the measured-TDEE row and `get_trend_window` returns non-zero `coverage.healthDays`.
23. [ ] Progress UI exposes `role="progressbar"` with valid ARIA values and an `aria-live` phase announcement.
24. [ ] No hardcoded hex colors in the new component — tokens only.

---

## 9. Open Questions

None. Resolved with the user in Phase 1: import path → client-side streaming parse; data types → active+basal energy, steps, exercise minutes, resting HR, VO₂ max, SpO₂, sleep; body mass → **not** imported; TDEE display → measured shown beside observed with the gap called out; sequencing → built in the same run as G1 (the founder was advised this makes the importer the critical path and roughly doubles the run's size, and reaffirmed).

---

## 10. Test Plan

### 10.1 Typecheck / Lint / Tests / Build
- `npx tsc --noEmit` — clean.
- `npm run lint` — no new errors (prune worktrees first).
- `npm run test` — adds `src/lib/parsers/apple-health.test.ts`; existing `get_body_metrics` leaky-reads case must still pass.
- `npm run build` — succeeds with the worker bundled.

### 10.2 MCP curl smoke
No new tools. After importing the fixture, verify via curl that (a) `get_trend_window` returns `coverage.healthDays > 0` and a non-null `energy.measuredTdee`, and (b) `get_body_metrics` returns the imported `rhr` / `sleep_hours` rows with correct units and `source: "imported"`.

### 10.3 Browser smoke
1. `npm run dev`, sign in, DevTools at 390 px.
2. `/import` — both cards render; the Strong paste flow still works.
3. Import `examples/apple-health-sample.xml` → parsing → preview counts → confirm → done summary.
4. Import a `.zip` wrapping the same fixture → identical result.
5. Import the same file again → row count unchanged (no duplicates).
6. Hand-log a `BodyMetric` on a covered date, re-import, confirm the manual row survives.
7. Pick a wrong file (any `.txt`) → clear "no supported records" message, no crash.
8. `/progress` → Body-metrics section shows the imported readings.
9. `/trends` → measured TDEE appears beside observed with the gap line.
10. Confirm in DevTools ▸ Network that **no** request carries the raw XML — only batched JSON of daily rows.

### 10.4 Migration verification
- `npm run db:which` → dev branch, `DB_ENV=development`.
- `npm run db:migrate -- --name health-daily` → applies; inspect the generated SQL diff and confirm it is a single additive `CREATE TABLE` plus indexes.
- `npx prisma generate` → `src/generated/prisma` includes `HealthDaily`.
- `npm run db:verify-owned` + `npm run db:verify-isolation` → both pass.
- Existing pages (`/progress`, `/nutrition`, `/history`) still render — no regression from the `User` back-relation.

---

## 11. Appendix

### 11.1 Discovery Notes

Raised during G1 discovery: asked whether to include activity/expenditure in TDEE, the founder answered *"If there's a way I can export my Apple activity information and import it into Goaldmine, we'd have a wealth of information to go off of. Best case scenario here."* They were told this is a feature comparable in size to `/trends` itself, that a burn *model* was the alternative and would introduce the app's first fabricated number, and that Vercel's ~4.5 MB body limit rules out uploading the export. Offered a later separate run, a session-markers-only middle ground, or both features together, they chose **both together**.

The client-side streaming parse was chosen over a third-party CSV exporter: it avoids an external app dependency and a paid tier, and keeps the raw health data on-device. Body-mass import was declined to protect the weigh-in series that feeds goal readiness and TDEE.

### 11.2 References

- `docs/prds/PRD-g1-trends-dashboard.md` — the consumer of `HealthDaily`; §4.9 defines the seam that lets both ship in parallel.
- `src/lib/parsers/strong.ts` + `examples/` — the pure-parser + committed-fixture pattern this follows.
- `src/lib/metrics-registry.ts` — `BODY_METRICS` seeds and `BODY_METRIC_ALIASES`; the `sleep_score` vs `sleep_hours` distinction lives here.
- `src/lib/db.ts` — scoped-client owned-model registration.
- `.claude/quality-tools.md` §Dev/prod DB split — the guarded migration path.
- Apple Health export format: `<Record type= sourceName= unit= startDate= endDate= value=/>` inside `apple_health_export/export.xml`.
