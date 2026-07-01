// src/lib/cumulative-goal-targets.test.ts
//
// REQ-004 (blueprint v2 D3) — Tests for resolveMetricValue SUM and
// resolveMetricStart=0 for cumulative log: targets (goal-targets.ts).
//
// Pattern mirrors readiness.test.ts: mock @/lib/db, use real goal-targets impl.
// @/lib/records is mocked to prevent any real DB access via getExerciseHistory.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (hoisted by Vitest) ────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  prisma: {
    logEntry: { aggregate: vi.fn(), findFirst: vi.fn() },
    measurement: { findFirst: vi.fn() },
    baseline: { findFirst: vi.fn() },
    hike: { count: vi.fn(), aggregate: vi.fn() },
    workout: { count: vi.fn() },
  },
  getDb: vi.fn(),
}));

vi.mock("@/lib/records", () => ({
  getExerciseHistory: vi.fn().mockResolvedValue({ history: [] }),
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { resolveMetricValue, resolveMetricStart } from "@/lib/goal-targets";
import { prisma, getDb } from "@/lib/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetDb = getDb as any;

// ── Fixtures ─────────────────────────────────────────────────────────────────

const GOAL_ID = "goal-test-a1";
const AS_OF = new Date("2026-06-29T12:00:00Z");

// ── resolveMetricValue — cumulative SUM branch ────────────────────────────────

describe("resolveMetricValue — cumulative log: SUM branch", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // resolveMetricValue/Start call getDb() internally after E4b-2 migration.
    // Wire getDb() to return the same fake prisma object so spy assertions work.
    mockGetDb.mockResolvedValue(prisma);
  });

  it("cumulative=true: calls logEntry.aggregate and returns _sum.value", async () => {
    vi.mocked(prisma.logEntry.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({
      _sum: { value: 42.5 },
    });

    const result = await resolveMetricValue(
      "log:practice_hours",
      AS_OF,
      GOAL_ID,
      true, // cumulative
    );

    expect(result).toBe(42.5);
    expect(vi.mocked(prisma.logEntry.aggregate)).toHaveBeenCalled();
    expect(vi.mocked(prisma.logEntry.findFirst)).not.toHaveBeenCalled();
  });

  it("cumulative=true, empty series: returns null (NOT 0 — honest no-data, prevents mis-tiering)", async () => {
    vi.mocked(prisma.logEntry.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({
      _sum: { value: null }, // Prisma returns null when no rows matched
    });

    const result = await resolveMetricValue(
      "log:practice_hours",
      AS_OF,
      GOAL_ID,
      true,
    );

    // D2: raw _sum.value, not ?? 0. Returning null is the honest "no data yet" state.
    expect(result).toBeNull();
  });

  it("cumulative=true, integer sum: returns the integer exactly", async () => {
    vi.mocked(prisma.logEntry.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({
      _sum: { value: 100 },
    });

    const result = await resolveMetricValue(
      "log:books_read",
      AS_OF,
      GOAL_ID,
      true,
    );

    expect(result).toBe(100);
  });
});

// ── resolveMetricValue — snapshot path (cumulative=false) unchanged ───────────

describe("resolveMetricValue — snapshot log: path (cumulative=false, unchanged)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetDb.mockResolvedValue(prisma);
  });

  it("cumulative=false: calls findFirst, returns latest value", async () => {
    vi.mocked(prisma.logEntry.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      value: 1500,
    });

    const result = await resolveMetricValue(
      "log:mrr",
      AS_OF,
      GOAL_ID,
      false, // snapshot — default
    );

    expect(result).toBe(1500);
    expect(vi.mocked(prisma.logEntry.findFirst)).toHaveBeenCalled();
    expect(vi.mocked(prisma.logEntry.aggregate)).not.toHaveBeenCalled();
  });

  it("cumulative=false, no entries: returns null", async () => {
    vi.mocked(prisma.logEntry.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await resolveMetricValue(
      "log:mrr",
      AS_OF,
      GOAL_ID,
      false,
    );

    expect(result).toBeNull();
  });

  it("cumulative omitted (default false): behaves as snapshot", async () => {
    vi.mocked(prisma.logEntry.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      value: 999,
    });

    const result = await resolveMetricValue("log:mrr", AS_OF, GOAL_ID);

    expect(result).toBe(999);
    expect(vi.mocked(prisma.logEntry.findFirst)).toHaveBeenCalled();
    expect(vi.mocked(prisma.logEntry.aggregate)).not.toHaveBeenCalled();
  });
});

// ── resolveMetricStart — cumulative log: = 0 ─────────────────────────────────

describe("resolveMetricStart — cumulative log:", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetDb.mockResolvedValue(prisma);
  });

  it("cumulative=true: returns 0 (build-from-zero accumulation; no DB call)", async () => {
    const result = await resolveMetricStart(
      "log:practice_hours",
      GOAL_ID,
      true, // cumulative
    );

    expect(result).toBe(0);
    expect(vi.mocked(prisma.logEntry.findFirst)).not.toHaveBeenCalled();
  });

  it("cumulative=false (snapshot): calls findFirst and returns earliest entry", async () => {
    vi.mocked(prisma.logEntry.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      value: 500,
    });

    const result = await resolveMetricStart(
      "log:mrr",
      GOAL_ID,
      false,
    );

    expect(result).toBe(500);
    expect(vi.mocked(prisma.logEntry.findFirst)).toHaveBeenCalled();
  });

  it("cumulative=false, no earliest entry: returns null", async () => {
    vi.mocked(prisma.logEntry.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await resolveMetricStart(
      "log:mrr",
      GOAL_ID,
      false,
    );

    expect(result).toBeNull();
  });
});
