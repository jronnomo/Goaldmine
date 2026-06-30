// src/lib/metric-series.test.ts
//
// Unit tests for getLogMetricSeries.
// Pattern mirrors cumulative-goal-targets.test.ts: mock @/lib/db, use the
// real metric-series implementation. No network / DB access.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (hoisted by Vitest before any imports) ─────────────────────────────

vi.mock("@/lib/db", () => ({
  prisma: {
    logEntry: {
      findMany: vi.fn(),
    },
  },
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { getLogMetricSeries } from "@/lib/metric-series";
import { prisma } from "@/lib/db";
import type { GoalTarget } from "@/lib/metrics-registry";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const GOAL_ID = "goal-test-series";

/** log:mrr IS in METRIC_BY_ID — registry label/units should win. */
const MRR_TARGET: GoalTarget = {
  metric: "log:mrr",
  label: "MRR (target label — should be overridden by registry)",
  units: "€", // intentionally wrong — registry should supply "$"
  direction: "increase",
  target: 5000,
  weight: 0.5,
};

/** log:practice_hours is NOT in METRIC_BY_ID — target fields are the fallback. */
const HOURS_TARGET: GoalTarget = {
  metric: "log:practice_hours",
  label: "Practice hours",
  units: "hrs",
  direction: "increase",
  target: 100,
  weight: 0.5,
  cumulative: true,
};

/** Snapshot target with % units — used to test domain clamping. */
const PCT_TARGET: GoalTarget = {
  metric: "log:completion_pct",
  label: "Completion %",
  units: "%",
  direction: "increase",
  target: 100,
  weight: 0.5,
};

// Helper to type mock returns without fighting Prisma's generated types.
function mockFindMany(rows: { date: Date; value: number | null }[]) {
  vi.mocked(prisma.logEntry.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(rows);
}

// ── SNAPSHOT tests ────────────────────────────────────────────────────────────

describe("SNAPSHOT path (!target.cumulative)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("flat-maps 3 distinct-day rows → 3 points in ascending order", async () => {
    const rows = [
      { date: new Date("2026-01-10T12:00:00Z"), value: 100 },
      { date: new Date("2026-01-11T12:00:00Z"), value: 200 },
      { date: new Date("2026-01-12T12:00:00Z"), value: 300 },
    ];
    mockFindMany(rows);

    const result = await getLogMetricSeries(MRR_TARGET, GOAL_ID);

    expect(result.points).toHaveLength(3);
    expect(result.points[0].value).toBe(100);
    expect(result.points[1].value).toBe(200);
    expect(result.points[2].value).toBe(300);
    // date field must be the raw ISO string of the row's timestamp
    expect(result.points[0].date).toBe(rows[0]!.date.toISOString());
    expect(result.points[2].date).toBe(rows[2]!.date.toISOString());
  });

  it("same-day: 2 rows on the same calendar day → BOTH points kept (no collapse)", async () => {
    // This is the critical snapshot contract: every row becomes a point,
    // matching how the live MRR chart in progress/page.tsx works today.
    const rows = [
      { date: new Date("2026-01-10T10:00:00Z"), value: 1000 },
      { date: new Date("2026-01-10T16:00:00Z"), value: 1500 },
    ];
    mockFindMany(rows);

    const result = await getLogMetricSeries(MRR_TARGET, GOAL_ID);

    // MUST be 2 — snapshot never collapses same-day rows.
    expect(result.points).toHaveLength(2);
    expect(result.points[0].value).toBe(1000);
    expect(result.points[1].value).toBe(1500);
  });
});

// ── CUMULATIVE tests ──────────────────────────────────────────────────────────

describe("CUMULATIVE path (target.cumulative=true)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("prefix-sum: 3 rows [10, 10, 10] on distinct days → points [10, 20, 30]", async () => {
    const rows = [
      { date: new Date("2026-01-10T12:00:00Z"), value: 10 },
      { date: new Date("2026-01-11T12:00:00Z"), value: 10 },
      { date: new Date("2026-01-12T12:00:00Z"), value: 10 },
    ];
    mockFindMany(rows);

    const result = await getLogMetricSeries(HOURS_TARGET, GOAL_ID);

    expect(result.points).toHaveLength(3);
    expect(result.points[0].value).toBe(10);
    expect(result.points[1].value).toBe(20);
    expect(result.points[2].value).toBe(30);
  });

  it(
    "KEY TEST — same-day SUM: two rows on day 1 (10+10) then one row on day 2 (10) " +
      "→ 2 points [20, 30], not 3 points [10, 20, 30]",
    async () => {
      // log_metric can write multiple increment rows on the same USER_TZ day
      // (e.g. two 1-hour practice sessions). The cumulative path MUST sum them
      // into a single daily bucket before prefix-summing.
      //
      // A naive flat-map reuse of the snapshot path would produce 3 separate
      // points [10, 10, 10] and prefix-sum them to [10, 20, 30] — WRONG.
      // The correct result: day 1 bucket = 10+10 = 20 → prefix → 20; day 2 → 30.
      const rows = [
        { date: new Date("2026-01-10T10:00:00Z"), value: 10 }, // day 1, morning
        { date: new Date("2026-01-10T18:00:00Z"), value: 10 }, // day 1, afternoon
        { date: new Date("2026-01-11T12:00:00Z"), value: 10 }, // day 2
      ];
      mockFindMany(rows);

      const result = await getLogMetricSeries(HOURS_TARGET, GOAL_ID);

      // Exactly 2 points: same-day rows collapsed by SUM into one bucket.
      expect(result.points).toHaveLength(2);
      // Day 1: 10 + 10 = 20
      expect(result.points[0].value).toBe(20);
      // Day 2: running total 20 + 10 = 30
      expect(result.points[1].value).toBe(30);
    },
  );
});

// ── Domain tests ──────────────────────────────────────────────────────────────

describe("domain computation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("cumulative domain always starts at 0", async () => {
    mockFindMany([{ date: new Date("2026-01-10T12:00:00Z"), value: 50 }]);

    const result = await getLogMetricSeries(HOURS_TARGET, GOAL_ID);

    expect(result.domain[0]).toBe(0);
  });

  it("cumulative domain hi = max * 1.1", async () => {
    mockFindMany([{ date: new Date("2026-01-10T12:00:00Z"), value: 100 }]);

    const result = await getLogMetricSeries(HOURS_TARGET, GOAL_ID);

    expect(result.domain[1]).toBeCloseTo(110, 5); // 100 * 1.1
  });

  it("snapshot % units: hi clamped to ≤ 100", async () => {
    const rows = [
      { date: new Date("2026-01-10T12:00:00Z"), value: 99 },
      { date: new Date("2026-01-11T12:00:00Z"), value: 100 },
    ];
    mockFindMany(rows);

    const result = await getLogMetricSeries(PCT_TARGET, GOAL_ID);

    expect(result.domain[1]).toBeLessThanOrEqual(100);
  });

  it("snapshot % units: lo clamped to ≥ 0", async () => {
    // With a small value the raw lo = 10 - pad could theoretically go negative;
    // the % clamp must keep it at 0.
    mockFindMany([{ date: new Date("2026-01-10T12:00:00Z"), value: 1 }]);

    const result = await getLogMetricSeries(PCT_TARGET, GOAL_ID);

    expect(result.domain[0]).toBeGreaterThanOrEqual(0);
  });

  it("snapshot non-% domain is padded below min and above max", async () => {
    const rows = [
      { date: new Date("2026-01-10T12:00:00Z"), value: 1000 },
      { date: new Date("2026-01-11T12:00:00Z"), value: 2000 },
    ];
    mockFindMany(rows);

    const result = await getLogMetricSeries(MRR_TARGET, GOAL_ID);

    // pad = max(range * 0.1, 2) = max(1000 * 0.1, 2) = 100
    // lo = 1000 - 100 = 900, hi = 2000 + 100 = 2100
    expect(result.domain[0]).toBeLessThan(1000);
    expect(result.domain[1]).toBeGreaterThan(2000);
    expect(result.domain[0]).toBeCloseTo(900, 5);
    expect(result.domain[1]).toBeCloseTo(2100, 5);
  });
});

// ── Label / units tests ───────────────────────────────────────────────────────

describe("label and units resolution", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("log:mrr → registry label and units (not target fields)", async () => {
    // Empty rows → label/units resolved before the early-return.
    mockFindMany([]);

    const result = await getLogMetricSeries(MRR_TARGET, GOAL_ID);

    // METRIC_BY_ID has log:mrr → label="Monthly recurring revenue", units="$"
    expect(result.label).toBe("Monthly recurring revenue");
    expect(result.units).toBe("$");
  });

  it("log:practice_hours (not in registry) → falls back to target.label / target.units", async () => {
    mockFindMany([]);

    const result = await getLogMetricSeries(HOURS_TARGET, GOAL_ID);

    expect(result.label).toBe("Practice hours");
    expect(result.units).toBe("hrs");
  });
});

// ── USER_TZ label test ────────────────────────────────────────────────────────

describe("USER_TZ label formatting", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("a known UTC instant formats to the correct USER_TZ 'Mon D' label", async () => {
    // 2026-03-15T14:00:00Z = 8:00 AM MDT (America/Denver, UTC-6 post-DST March 8)
    // → expected label "Mar 15"
    mockFindMany([{ date: new Date("2026-03-15T14:00:00Z"), value: 42 }]);

    const result = await getLogMetricSeries(MRR_TARGET, GOAL_ID);

    expect(result.points).toHaveLength(1);
    expect(result.points[0].label).toBe("Mar 15");
  });
});

// ── Empty series ──────────────────────────────────────────────────────────────

describe("empty series", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("empty rows → points:[] and domain anchored to target.target", async () => {
    mockFindMany([]);

    const result = await getLogMetricSeries(MRR_TARGET, GOAL_ID);

    expect(result.points).toHaveLength(0);
    // MRR_TARGET.target = 5000
    expect(result.domain).toEqual([0, 5000]);
  });

  it("empty rows, target.target = 0 → domain [0, 1] (safe fallback)", async () => {
    const zeroTarget: GoalTarget = {
      ...MRR_TARGET,
      target: 0,
    };
    mockFindMany([]);

    const result = await getLogMetricSeries(zeroTarget, GOAL_ID);

    expect(result.domain).toEqual([0, 1]);
  });
});
