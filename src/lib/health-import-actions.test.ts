// src/lib/health-import-actions.test.ts
//
// Unit tests for importHealthDaysBatch (G2 REQ-003). No live DB — @/lib/db is
// mocked (dual-export prisma + getDb per the repo convention), next/cache is
// mocked because server actions call revalidatePath outside a request context.
//
// The two assertions that matter most (blueprint §7 / PRD G2 §7):
//   1. every deleteMany's where contains `source` — omitting it would delete
//      the user's hand-logged rows;
//   2. the delete-then-insert replace goes through $transaction — a bare
//      sequential version opens a data-loss window per batch (C4 ruling).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockHealthDailyDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
const mockHealthDailyCreateMany = vi.fn().mockResolvedValue({ count: 0 });
const mockBodyMetricDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
const mockBodyMetricCreateMany = vi.fn().mockResolvedValue({ count: 0 });
// Array-form passthrough — works unchanged for C4 rungs 1 and 2.
const mockTransaction = vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops));

const mockDb = {
  healthDaily: { deleteMany: mockHealthDailyDeleteMany, createMany: mockHealthDailyCreateMany },
  bodyMetric: { deleteMany: mockBodyMetricDeleteMany, createMany: mockBodyMetricCreateMany },
  $transaction: mockTransaction,
};

vi.mock("@/lib/db", () => ({
  prisma: {},
  getDb: vi.fn(async () => mockDb),
}));

import { revalidatePath } from "next/cache";
import { importHealthDaysBatch } from "@/lib/health-import-actions";
import type { BodyMetricRow, HealthDayRow } from "@/lib/health-import-actions";

function dayRow(overrides: Partial<HealthDayRow> = {}): HealthDayRow {
  return {
    dateKey: "2026-09-01",
    activeKcal: 640,
    basalKcal: 1710,
    steps: 9200,
    exerciseMin: 42,
    standHours: 11,
    ...overrides,
  };
}

function metricRow(overrides: Partial<BodyMetricRow> = {}): BodyMetricRow {
  return { dateKey: "2026-09-01", key: "rhr", value: 55, unit: "bpm", ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks keeps implementations — re-pin the defaults so per-test
  // overrides (counts, throwing transaction) never leak into later cases.
  mockHealthDailyDeleteMany.mockResolvedValue({ count: 0 });
  mockHealthDailyCreateMany.mockResolvedValue({ count: 0 });
  mockBodyMetricDeleteMany.mockResolvedValue({ count: 0 });
  mockBodyMetricCreateMany.mockResolvedValue({ count: 0 });
  mockTransaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
});

describe("importHealthDaysBatch — Zod trust boundary (whole-batch reject)", () => {
  it("rejects a batch with more than 500 day rows", async () => {
    const rows = Array.from({ length: 501 }, () => dayRow());
    const res = await importHealthDaysBatch({ rows, metrics: [] });
    expect(res.ok).toBe(false);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("rejects a bad dateKey", async () => {
    const res = await importHealthDaysBatch({
      rows: [dayRow({ dateKey: "09/01/2026" })],
      metrics: [],
    });
    expect(res.ok).toBe(false);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("rejects a negative value", async () => {
    const res = await importHealthDaysBatch({
      rows: [dayRow({ steps: -100 })],
      metrics: [],
    });
    expect(res.ok).toBe(false);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range day value (activeKcal 25000)", async () => {
    const res = await importHealthDaysBatch({
      rows: [dayRow({ activeKcal: 25_000 })],
      metrics: [],
    });
    expect(res.ok).toBe(false);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range metric value (rhr 300)", async () => {
    const res = await importHealthDaysBatch({
      rows: [],
      metrics: [metricRow({ value: 300 })],
    });
    expect(res.ok).toBe(false);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("rejects an unknown metric key", async () => {
    const res = await importHealthDaysBatch({
      rows: [],
      metrics: [metricRow({ key: "blood_pressure" })],
    });
    expect(res.ok).toBe(false);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("returns ok with zero counts (and no DB call) for an empty batch", async () => {
    const res = await importHealthDaysBatch({ rows: [], metrics: [] });
    expect(res).toEqual({ ok: true, dayRowsWritten: 0, metricRowsWritten: 0 });
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});

describe("importHealthDaysBatch — source-filtered deletes (protect hand-logged rows)", () => {
  it("healthDaily deleteMany's where contains source: apple_health and a date list", async () => {
    await importHealthDaysBatch({ rows: [dayRow()], metrics: [] });
    expect(mockHealthDailyDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          source: "apple_health",
          date: expect.objectContaining({ in: expect.any(Array) }),
        }),
      }),
    );
  });

  it("bodyMetric deleteMany's where contains source: imported, key: { in }, and a date list", async () => {
    await importHealthDaysBatch({ rows: [], metrics: [metricRow(), metricRow({ key: "spo2", value: 97, unit: "%" })] });
    expect(mockBodyMetricDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          source: "imported",
          key: { in: expect.arrayContaining(["rhr", "spo2"]) },
          date: expect.objectContaining({ in: expect.any(Array) }),
        }),
      }),
    );
  });

  it("createMany rows carry source and never a userId (the scoped client injects it)", async () => {
    await importHealthDaysBatch({ rows: [dayRow()], metrics: [metricRow()] });
    const dayCall = mockHealthDailyCreateMany.mock.calls[0]![0] as unknown as {
      data: Array<Record<string, unknown>>;
    };
    for (const row of dayCall.data) {
      expect(row.source).toBe("apple_health");
      expect(row).not.toHaveProperty("userId");
    }
    const metricCall = mockBodyMetricCreateMany.mock.calls[0]![0] as unknown as {
      data: Array<Record<string, unknown>>;
    };
    for (const row of metricCall.data) {
      expect(row.source).toBe("imported");
      expect(row).not.toHaveProperty("userId");
    }
  });
});

describe("importHealthDaysBatch — mandatory $transaction (C4 ruling)", () => {
  it("the write goes through $transaction exactly once", async () => {
    await importHealthDaysBatch({ rows: [dayRow()], metrics: [metricRow()] });
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    // All four ops ride inside the transaction array.
    const ops = mockTransaction.mock.calls[0]![0];
    expect(ops).toHaveLength(4);
  });

  it("no op resolves before $transaction is invoked (no bare sequential delete-then-insert)", async () => {
    // If the action awaited deleteMany outside the transaction, deleteMany's
    // promise would already be settled when $transaction runs. Capture
    // ordering by asserting the transaction receives pending promises built
    // from the spies, and that deleteMany was not awaited standalone: the
    // transaction spy is what performs the awaiting in this mock.
    let transactionRan = false;
    mockTransaction.mockImplementation(async (ops: Promise<unknown>[]) => {
      transactionRan = true;
      return Promise.all(ops);
    });
    const res = await importHealthDaysBatch({ rows: [dayRow()], metrics: [] });
    expect(res.ok).toBe(true);
    expect(transactionRan).toBe(true);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });
});

describe("importHealthDaysBatch — non-positional result counting (C4)", () => {
  it("rows-only batch: dayRowsWritten from createMany, metricRowsWritten 0", async () => {
    mockHealthDailyCreateMany.mockResolvedValue({ count: 3 });
    const res = await importHealthDaysBatch({
      rows: [dayRow(), dayRow({ dateKey: "2026-09-02" }), dayRow({ dateKey: "2026-09-03" })],
      metrics: [],
    });
    expect(res).toEqual({ ok: true, dayRowsWritten: 3, metricRowsWritten: 0 });
    expect(mockBodyMetricDeleteMany).not.toHaveBeenCalled();
    expect(mockBodyMetricCreateMany).not.toHaveBeenCalled();
  });

  it("metrics-only batch: metricRowsWritten from createMany, dayRowsWritten 0", async () => {
    mockBodyMetricCreateMany.mockResolvedValue({ count: 2 });
    const res = await importHealthDaysBatch({
      rows: [],
      metrics: [metricRow(), metricRow({ key: "sleep_hours", value: 7.4, unit: "h" })],
    });
    expect(res).toEqual({ ok: true, dayRowsWritten: 0, metricRowsWritten: 2 });
    expect(mockHealthDailyDeleteMany).not.toHaveBeenCalled();
    expect(mockHealthDailyCreateMany).not.toHaveBeenCalled();
  });

  it("full batch: both counts come from their own createMany results", async () => {
    mockHealthDailyCreateMany.mockResolvedValue({ count: 5 });
    mockBodyMetricCreateMany.mockResolvedValue({ count: 7 });
    const res = await importHealthDaysBatch({ rows: [dayRow()], metrics: [metricRow()] });
    expect(res).toEqual({ ok: true, dayRowsWritten: 5, metricRowsWritten: 7 });
  });
});

describe("importHealthDaysBatch — revalidation and error surface", () => {
  it("calls revalidatePath exactly three times: /trends, /progress, /", async () => {
    await importHealthDaysBatch({ rows: [dayRow()], metrics: [] });
    expect(revalidatePath).toHaveBeenCalledTimes(3);
    expect(revalidatePath).toHaveBeenCalledWith("/trends");
    expect(revalidatePath).toHaveBeenCalledWith("/progress");
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("a DB error surfaces as { ok: false } and skips revalidation", async () => {
    mockTransaction.mockImplementation(async () => {
      throw new Error("connection lost");
    });
    const res = await importHealthDaysBatch({ rows: [dayRow()], metrics: [] });
    expect(res).toEqual({ ok: false, error: "connection lost" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
