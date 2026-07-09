// src/lib/goal-targets.test.ts
//
// Regression test for story #227's re-scope. #227 set out to fix a claimed
// /compare-vs-/progress divergence for same-day comparisons by threading a
// different `asOf` value through computeReadiness. The architecture critique
// (.feature-dev/2026-07-07-227-compare-today-parity/agents/architecture-critique.md,
// finding C1) disproved the premise empirically: goal-targets.ts:44 already
// wraps EVERY `asOf` in `endOfDay(asOf)` before any query runs, and
// readiness.ts:206 does the same for the hike-prep compound gate. Because
// `endOfDay` is idempotent per user-tz calendar day, `now` (what /progress
// passes) and `endOfDay(today)` (what /compare passes) collapse to the same
// instant for any same-day `asOf` — there is no divergence to fix.
//
// This suite pins that day-granularity invariant so it can't silently regress:
// if a future edit narrows the cutoff back to the raw `asOf` instant (the
// original motivation being an evening-logged baseline PR going uncounted
// until the wall clock caught up to it — see the comment at goal-targets.ts:39-42),
// /compare and /progress would silently diverge again for same-day requests,
// and this test would catch it.
//
// Pattern mirrors cumulative-goal-targets.test.ts: mock @/lib/db, use the
// real goal-targets implementation, mock @/lib/records to avoid any real DB
// access via getExerciseHistory.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (hoisted by Vitest) ────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  prisma: {
    measurement: { findFirst: vi.fn() },
    baseline: { findFirst: vi.fn() },
    hike: { count: vi.fn(), aggregate: vi.fn() },
    workout: { count: vi.fn() },
    logEntry: { aggregate: vi.fn(), findFirst: vi.fn() },
  },
  getDb: vi.fn(),
}));

vi.mock("@/lib/records", () => ({
  getExerciseHistory: vi.fn().mockResolvedValue({ history: [] }),
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { resolveMetricValue } from "@/lib/goal-targets";
import { prisma, getDb } from "@/lib/db";
import { endOfDay } from "@/lib/calendar-core";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetDb = getDb as any;

const GOAL_ID = "goal-test-day-granularity";

// A mid-day instant — deliberately NOT midnight and NOT end-of-day, so a
// naive `date <= asOf` filter would exclude same-day entries logged later
// that day (the exact bug this wrap prevents; see goal-targets.ts:39-42).
const MID_DAY_ASOF = new Date("2026-07-09T14:30:00-06:00");

describe("resolveMetricValue day-granularity invariant", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetDb.mockResolvedValue(prisma);
  });

  // WHY this invariant is load-bearing: /compare passes endOfDay(date) into
  // computeReadiness, while /progress passes new Date() (effectively "now").
  // These two call sites only ever produce byte-identical readiness output
  // because resolveMetricValue (and resolveHikePrepGateExtras in
  // readiness.ts:206) re-wrap whatever `asOf` they're given in the SAME
  // idempotent endOfDay() before it touches a query — collapsing "now" and
  // "end of today" to the identical cutoff instant for any same-day asOf.
  // Removing this wrap, or querying on the raw `asOf` instant instead of the
  // cutoff, would silently break /compare-vs-/progress parity without
  // touching compare.ts at all — audited and disproven as story #227's
  // original "fix compare.ts's asOf" premise; see architecture-critique.md C1.
  it("weightLb: queries date.lte = endOfDay(asOf), not the raw mid-day instant", async () => {
    vi.mocked(prisma.measurement.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      weightLb: 159,
    });

    const result = await resolveMetricValue("weightLb", MID_DAY_ASOF, GOAL_ID, false);

    expect(result).toBe(159);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call = vi.mocked(prisma.measurement.findFirst).mock.calls[0]![0] as any;
    const cutoffUsed = call.where.date.lte as Date;

    expect(cutoffUsed.getTime()).toBe(endOfDay(MID_DAY_ASOF).getTime());
    expect(cutoffUsed.getTime()).not.toBe(MID_DAY_ASOF.getTime());
  });

  // Second case, different query shape (aggregate vs findFirst) — confirms
  // the wrap is applied uniformly across resolveMetricValue's branches, not
  // just the weightLb path.
  it("hike:total_elevation_ft: aggregate query also cuts off at endOfDay(asOf)", async () => {
    vi.mocked(prisma.hike.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({
      _sum: { elevationFt: 12000 },
    });

    const result = await resolveMetricValue(
      "hike:total_elevation_ft",
      MID_DAY_ASOF,
      GOAL_ID,
      false,
    );

    expect(result).toBe(12000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call = vi.mocked(prisma.hike.aggregate).mock.calls[0]![0] as any;
    const cutoffUsed = call.where.date.lte as Date;

    expect(cutoffUsed.getTime()).toBe(endOfDay(MID_DAY_ASOF).getTime());
    expect(cutoffUsed.getTime()).not.toBe(MID_DAY_ASOF.getTime());
  });
});
