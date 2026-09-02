"use server";

// src/lib/health-import-actions.ts — G2 Apple Health import write path.
// Batched, idempotent, tenant-scoped replace-by-date writes for HealthDaily
// (+ imported BodyMetric readings). Called in a loop from
// AppleHealthImportForm; Stream B imports the row types with `import type`.

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { parseDateKey } from "@/lib/calendar";
import { HEALTH_DAY_BOUNDS, METRIC_BOUNDS } from "@/lib/health-bounds";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";

// ── frozen contract types (§3.1) — exported verbatim ────────────────────────

export type HealthDayRow = {
  dateKey: string;                 // /^\d{4}-\d{2}-\d{2}$/
  activeKcal: number | null;
  basalKcal: number | null;
  steps: number | null;
  exerciseMin: number | null;
  standHours: number | null;
};

export type BodyMetricRow = { dateKey: string; key: string; value: number; unit: string };

export type ImportBatchResult =
  | { ok: true; dayRowsWritten: number; metricRowsWritten: number }
  | { ok: false; error: string };

// ── validation (trust boundary) ──────────────────────────────────────────────
// The PARSER is the data-cleaning layer: it drops out-of-range aggregates and
// counts them in recordsSkipped (C3 — src/lib/health-bounds.ts is the shared
// table). By the time a payload reaches this schema, out-of-range values mean
// a client that isn't ours — so the whole batch is rejected. Do NOT soften
// this into row-skipping.
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

const HealthDayRowSchema = z.object({
  dateKey: z.string().regex(DATE_KEY_RE),
  activeKcal: z.number().finite().min(HEALTH_DAY_BOUNDS.activeKcal.min).max(HEALTH_DAY_BOUNDS.activeKcal.max).nullable(),
  basalKcal: z.number().finite().min(HEALTH_DAY_BOUNDS.basalKcal.min).max(HEALTH_DAY_BOUNDS.basalKcal.max).nullable(),
  steps: z.number().int().min(0).max(HEALTH_DAY_BOUNDS.steps.max).nullable(),
  exerciseMin: z.number().int().min(0).max(HEALTH_DAY_BOUNDS.exerciseMin.max).nullable(),
  standHours: z.number().int().min(0).max(HEALTH_DAY_BOUNDS.standHours.max).nullable(),
});

const BodyMetricRowSchema = z
  .object({
    dateKey: z.string().regex(DATE_KEY_RE),
    key: z.enum(["rhr", "spo2", "vo2max", "sleep_hours", "hrv"]),
    value: z.number().finite(),
    unit: z.string().min(1).max(16),
  })
  .refine(
    (r) => r.value >= METRIC_BOUNDS[r.key].min && r.value <= METRIC_BOUNDS[r.key].max,
    { message: "value out of range for key" },
  );

const PayloadSchema = z.object({
  rows: z.array(HealthDayRowSchema).max(500),
  // ≤5 metric keys/day × 500 days — structural, because the form batches BY DATE (§4c).
  metrics: z.array(BodyMetricRowSchema).max(2_500),
});

// ── write path — C4 ruling: mandatory transaction ────────────────────────────

export async function importHealthDaysBatch(
  payload: { rows: HealthDayRow[]; metrics: BodyMetricRow[] },
): Promise<ImportBatchResult> {
  const parsed = PayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: `Invalid batch: ${parsed.error.issues[0]?.message ?? "validation failed"}` };
  }
  const { rows, metrics } = parsed.data;
  if (rows.length === 0 && metrics.length === 0) {
    return { ok: true, dayRowsWritten: 0, metricRowsWritten: 0 };
  }

  try {
    const db = await getDb();

    // parseDateKey is the ONLY date construction in this file (REQ-003.4).
    const dayDates = [...new Set(rows.map((r) => r.dateKey))].map(parseDateKey);
    const metricDates = [...new Set(metrics.map((m) => m.dateKey))].map(parseDateKey);
    const metricKeys = [...new Set(metrics.map((m) => m.key))];

    // C4 RULING: the replace must be ATOMIC. A non-transactional
    // delete-then-insert opens a data-loss window per batch (delete commits,
    // insert fails → previously-imported rows gone). $transaction (array form)
    // is REQUIRED. The `source` filter on every deleteMany is what protects
    // hand-logged rows — omitting it would delete the user's manual entries.
    // userId is injected by the scoped client on every op — never passed here.
    // Element type is Prisma.PrismaPromise (not plain Promise): the array-form
    // $transaction overload requires the branded lazy promise type.
    const ops = [] as Array<Prisma.PrismaPromise<{ count: number }>>;
    let dayCreateIdx = -1;
    let metricCreateIdx = -1;
    if (rows.length > 0) {
      ops.push(
        db.healthDaily.deleteMany({
          where: { source: "apple_health", date: { in: dayDates } },
        }),
      );
      dayCreateIdx = ops.length;
      ops.push(
        db.healthDaily.createMany({
          data: rows.map((r) => ({
            date: parseDateKey(r.dateKey),
            activeKcal: r.activeKcal,
            basalKcal: r.basalKcal,
            steps: r.steps,
            exerciseMin: r.exerciseMin,
            standHours: r.standHours,
            source: "apple_health",
          })),
        }),
      );
    }
    if (metrics.length > 0) {
      ops.push(
        db.bodyMetric.deleteMany({
          where: { source: "imported", key: { in: metricKeys }, date: { in: metricDates } },
        }),
      );
      metricCreateIdx = ops.length;
      ops.push(
        db.bodyMetric.createMany({
          data: metrics.map((m) => ({
            date: parseDateKey(m.dateKey),
            key: m.key,
            value: m.value,
            unit: m.unit,
            source: "imported",
          })),
        }),
      );
    }

    const results = (await db.$transaction(ops)) as Array<{ count: number }>;
    // Non-positional: indices were captured as the ops array was built, so a
    // rows-only or metrics-only batch counts correctly (C4).
    const dayRowsWritten = dayCreateIdx >= 0 ? results[dayCreateIdx]!.count : 0;
    const metricRowsWritten = metricCreateIdx >= 0 ? results[metricCreateIdx]!.count : 0;

    revalidatePath("/trends");
    revalidatePath("/progress");
    revalidatePath("/");

    return { ok: true, dayRowsWritten, metricRowsWritten };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
