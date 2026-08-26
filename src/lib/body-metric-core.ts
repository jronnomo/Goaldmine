// src/lib/body-metric-core.ts
//
// Write core for BodyMetric rows (rhr, sleep_score, spo2, vo2max, hrv, ad-hoc).
//
// Until now BodyMetric was append-only by accident, not by design: log_body_metric
// created rows and NOTHING — no MCP tool, no dashboard control, no server action —
// could delete or correct one. A wrong resting-HR reading was permanent, and the
// coach's only honest move was to stack another reading on top of it. This module
// is the missing half.
//
// BodyMetric carries no ActivityGoalLink mirror (see ACTIVITY_LINK_TYPE — the
// link types are workout/hike/nutrition/measurement/baseline/log_entry), so a
// delete is a plain scoped row delete with no companion cleanup. Contrast
// deleteMeasurementCore, which must sweep links in the same transaction.
//
// Every query goes through getDb() — the tenant-scoped client injects userId into
// the WHERE of delete/update/findMany alike, so an id belonging to another user
// simply doesn't resolve.

import { getDb } from "@/lib/db";
import { dateKey as toDateKey } from "@/lib/calendar";

/** One reading, in the shape the MCP tools hand back. */
export type BodyMetricRow = {
  id: string;
  key: string;
  value: number;
  unit: string | null;
  /** yyyy-mm-dd in USER_TZ. */
  date: string;
  notes: string | null;
  source: string;
  /** ISO — the tiebreaker when a day holds several readings for one key. */
  createdAt: string;
};

type DbRow = {
  id: string;
  key: string;
  value: number;
  unit: string | null;
  date: Date;
  notes: string | null;
  source: string;
  createdAt: Date;
};

export function toBodyMetricRow(row: DbRow): BodyMetricRow {
  return {
    id: row.id,
    key: row.key,
    value: row.value,
    unit: row.unit,
    date: toDateKey(row.date),
    notes: row.notes,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Delete readings by id. Returns what actually went, and what didn't resolve —
 * an id that belongs to nobody (or to another user) is reported as missing
 * rather than throwing, so a batch cleanup of four bad RHR values isn't
 * derailed by one stale id.
 */
export async function deleteBodyMetricsCore(
  ids: string[],
): Promise<{ deleted: BodyMetricRow[]; missing: string[] }> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return { deleted: [], missing: [] };

  const db = await getDb();
  // Read first so the caller gets back WHAT was deleted (value/date/key), not
  // just a count — the coach echoes it to the user for confirmation.
  const rows = await db.bodyMetric.findMany({ where: { id: { in: unique } } });
  const found = new Set(rows.map((r) => r.id));
  if (rows.length > 0) {
    await db.bodyMetric.deleteMany({ where: { id: { in: [...found] } } });
  }
  return {
    deleted: rows.map(toBodyMetricRow),
    missing: unique.filter((id) => !found.has(id)),
  };
}

/**
 * Candidate lookup for delete-without-an-id: every reading for one key on one
 * calendar day, optionally narrowed to an exact value. Oldest-first so a
 * "delete the duplicate" decision is made against a stable order.
 */
export async function findBodyMetricsOnDay(
  key: string,
  date: Date,
  value?: number,
): Promise<BodyMetricRow[]> {
  const db = await getDb();
  const rows = await db.bodyMetric.findMany({
    where: { key, date, ...(value != null ? { value } : {}) },
    orderBy: [{ createdAt: "asc" }],
  });
  return rows.map(toBodyMetricRow);
}

export type BodyMetricPatch = {
  value?: number;
  unit?: string | null;
  notes?: string | null;
  date?: Date;
  key?: string;
};

/**
 * Correct a reading in place. Only the supplied fields move; everything else —
 * including the original `source` and `createdAt` — is left alone, so an edited
 * row keeps its provenance.
 */
export async function updateBodyMetricCore(
  id: string,
  patch: BodyMetricPatch,
): Promise<BodyMetricRow> {
  const db = await getDb();
  // Scoped read first: a missing/foreign id must fail as "not found" before we
  // reach Prisma's update, whose own error is opaque.
  const existing = await db.bodyMetric.findFirst({ where: { id } });
  if (!existing) throw new Error(`No body metric found with id ${id}`);

  const data: Record<string, unknown> = {};
  if (patch.value !== undefined) data.value = patch.value;
  if (patch.unit !== undefined) data.unit = patch.unit;
  if (patch.notes !== undefined) data.notes = patch.notes;
  if (patch.date !== undefined) data.date = patch.date;
  if (patch.key !== undefined) data.key = patch.key;
  if (Object.keys(data).length === 0) {
    throw new Error("Nothing to update — pass at least one of value, unit, notes, date, key");
  }

  const row = await db.bodyMetric.update({ where: { id }, data });
  return toBodyMetricRow(row);
}
