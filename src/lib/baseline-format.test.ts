import { describe, expect, it } from "vitest";
import { countByStatus, formatBest, statusTextClass } from "@/lib/baseline-format";
import type { CheckpointStatus, ScheduledBaseline, ScheduledCheckpoint } from "@/lib/records";

function makeCheckpoint(status: CheckpointStatus): ScheduledCheckpoint {
  return {
    week: 1,
    targetDate: new Date("2026-01-01"),
    label: "initial",
    status,
  };
}

function makeScheduled(statuses: CheckpointStatus[]): ScheduledBaseline {
  return {
    testName: "Test",
    units: "lb",
    protocol: "1RM",
    dayOfWeek: 1,
    retestWeeks: [],
    checkpoints: statuses.map(makeCheckpoint),
    latestResult: null,
    resultCount: 0,
  };
}

describe("countByStatus", () => {
  it("returns all-zero counts for an empty list", () => {
    expect(countByStatus([])).toEqual({ done: 0, due: 0, overdue: 0, upcoming: 0 });
  });

  it("returns all-zero counts when scheduled baselines have no checkpoints", () => {
    expect(countByStatus([makeScheduled([])])).toEqual({ done: 0, due: 0, overdue: 0, upcoming: 0 });
  });

  it("counts checkpoints across multiple scheduled baselines", () => {
    const list = [
      makeScheduled(["done", "due"]),
      makeScheduled(["overdue", "upcoming", "upcoming"]),
    ];
    expect(countByStatus(list)).toEqual({ done: 1, due: 1, overdue: 1, upcoming: 2 });
  });
});

describe("formatBest", () => {
  it("formats a rm-primary result with weight and reps", () => {
    const result = formatBest({
      primary: "rm",
      bestValue: 225.4,
      bestRaw: { weightLb: 225, reps: 5, durationSec: null },
    });
    expect(result).toBe("~225 lb 1RM (225 × 5)");
  });

  it("formats a reps-primary result", () => {
    const result = formatBest({
      primary: "reps",
      bestValue: 20,
      bestRaw: { weightLb: null, reps: 20, durationSec: null },
    });
    expect(result).toBe("20 reps");
  });

  it("formats a duration-primary result as m:ss", () => {
    const result = formatBest({
      primary: "duration",
      bestValue: 125,
      bestRaw: { weightLb: null, reps: null, durationSec: 125 },
    });
    expect(result).toBe("2:05");
  });

  it("formats a distance-primary result to 2 decimal miles", () => {
    const result = formatBest({
      primary: "distance",
      bestValue: 3.1,
      bestRaw: { weightLb: null, reps: null, durationSec: null },
    });
    expect(result).toBe("3.10 mi");
  });

  it("formats a time-primary result as m:ss", () => {
    const result = formatBest({
      primary: "time",
      bestValue: 65,
      bestRaw: { weightLb: null, reps: null, durationSec: 65 },
    });
    expect(result).toBe("1:05");
  });

  it("falls back to the raw value for an unrecognized primary", () => {
    const result = formatBest({
      primary: "weird",
      bestValue: 42,
      bestRaw: { weightLb: null, reps: null, durationSec: null },
    });
    expect(result).toBe("42");
  });
});

describe("statusTextClass", () => {
  it("maps done to the success color", () => {
    expect(statusTextClass("done")).toBe("text-[var(--success)]");
  });

  it("maps due to the warning color", () => {
    expect(statusTextClass("due")).toBe("text-[var(--warning)]");
  });

  it("maps overdue to the danger color", () => {
    expect(statusTextClass("overdue")).toBe("text-[var(--danger)]");
  });

  it("maps upcoming (and any other status) to the muted color", () => {
    expect(statusTextClass("upcoming")).toBe("text-[var(--muted)]");
  });
});
