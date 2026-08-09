// src/lib/goal-story-core.test.ts
// Pure-function unit tests — no mocks, no DB (goal-story-core.ts has no
// Prisma imports). Covers clipToWindow's inclusive-both-ends boundary
// semantics and derivePhaseTimeline's week -> calendar-date math, including
// a multi-phase template (REQ-005/S9).

import { describe, expect, it } from "vitest";
import { parseDateKey, dateKey, addDays } from "@/lib/calendar-core";
import { clipToWindow, derivePhaseTimeline } from "@/lib/goal-story-core";
import type { ProgramTemplate } from "@/lib/program-template";

// ─────────────────────────────────────────────────────────────────────────
// clipToWindow
// ─────────────────────────────────────────────────────────────────────────

describe("clipToWindow", () => {
  const window = { startKey: "2026-02-01", endKey: "2026-02-10" };

  function pt(dk: string) {
    return { dateKey: dk, value: 1 };
  }

  it("drops a point strictly before the window's startKey", () => {
    expect(clipToWindow([pt("2026-01-31")], window)).toEqual([]);
  });

  it("drops a point strictly after the window's endKey", () => {
    expect(clipToWindow([pt("2026-02-11")], window)).toEqual([]);
  });

  it("keeps a point exactly ON the startKey (inclusive lower bound)", () => {
    expect(clipToWindow([pt("2026-02-01")], window)).toEqual([pt("2026-02-01")]);
  });

  it("keeps a point exactly ON the endKey (inclusive upper bound)", () => {
    expect(clipToWindow([pt("2026-02-10")], window)).toEqual([pt("2026-02-10")]);
  });

  it("keeps a point strictly inside the window", () => {
    expect(clipToWindow([pt("2026-02-05")], window)).toEqual([pt("2026-02-05")]);
  });

  it("filters a mixed list down to only the in-window points, preserving order", () => {
    const points = [
      pt("2026-01-15"), // before
      pt("2026-02-01"), // == start
      pt("2026-02-05"), // inside
      pt("2026-02-10"), // == end
      pt("2026-03-01"), // after
    ];
    expect(clipToWindow(points, window)).toEqual([pt("2026-02-01"), pt("2026-02-05"), pt("2026-02-10")]);
  });

  it("a single-day window (startKey === endKey) keeps only that day", () => {
    const sameDay = { startKey: "2026-02-05", endKey: "2026-02-05" };
    expect(
      clipToWindow([pt("2026-02-04"), pt("2026-02-05"), pt("2026-02-06")], sameDay),
    ).toEqual([pt("2026-02-05")]);
  });

  it("returns [] for an empty input list", () => {
    expect(clipToWindow([], window)).toEqual([]);
  });

  it("is generic over any dateKey-carrying point shape (hike-arc-like row)", () => {
    const hikeLike = [
      { dateKey: "2026-02-05", route: "North Loop", distanceMi: 5 },
      { dateKey: "2026-03-01", route: "Too Late", distanceMi: 3 },
    ];
    expect(clipToWindow(hikeLike, window)).toEqual([hikeLike[0]]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// derivePhaseTimeline
// ─────────────────────────────────────────────────────────────────────────

describe("derivePhaseTimeline", () => {
  const MIN_NUTRITION: ProgramTemplate["phases"][number]["nutrition"] = {
    calorieGuidance: "maintenance",
    proteinTargetG: { low: 100, high: 150 },
    hydration: "3L/day",
    habits: [],
  };
  const MIN_MOBILITY: ProgramTemplate["phases"][number]["mobility"] = {
    emphasis: [],
    dailyMin: 10,
  };

  function phase(
    index: 1 | 2 | 3,
    name: string,
    weeks: number[],
  ): ProgramTemplate["phases"][number] {
    return { index, name, weeks, goal: "g", emphasis: "e", nutrition: MIN_NUTRITION, mobility: MIN_MOBILITY };
  }

  function minimalTemplate(phases: ProgramTemplate["phases"]): ProgramTemplate {
    return {
      name: "Test Program",
      totalWeeks: phases.length > 0 ? Math.max(...phases.flatMap((p) => p.weeks)) : 0,
      phases,
      weeklySplit: [],
      baselineWeek: [],
      hikingSuperset: { type: "superset", exercises: [] },
      dailyMobility: { durationMin: 10, exercises: [] },
      goals: [],
    };
  }

  it("single phase spanning weeks 1-3: startKey = startedOn, endKey = startedOn + 3*7 - 1 days", () => {
    const startedOn = parseDateKey("2026-01-05"); // a Monday
    const template = minimalTemplate([phase(1, "Base", [1, 2, 3])]);

    const phases = derivePhaseTimeline(template, startedOn);

    expect(phases).toHaveLength(1);
    expect(phases[0]).toEqual({
      name: "Base",
      weekStart: 1,
      weekEnd: 3,
      startKey: "2026-01-05",
      endKey: "2026-01-25", // startedOn + 20 days
    });
  });

  it("multi-phase template: each phase's week range maps to its own calendar block, phases are contiguous day-to-day", () => {
    const startedOn = parseDateKey("2026-01-05");
    const template = minimalTemplate([
      phase(1, "Base", [1, 2, 3]),
      phase(2, "Build", [4, 5, 6]),
      phase(3, "Peak", [7, 8]),
    ]);

    const phases = derivePhaseTimeline(template, startedOn);

    expect(phases).toEqual([
      { name: "Base", weekStart: 1, weekEnd: 3, startKey: "2026-01-05", endKey: "2026-01-25" },
      { name: "Build", weekStart: 4, weekEnd: 6, startKey: "2026-01-26", endKey: "2026-02-15" },
      { name: "Peak", weekStart: 7, weekEnd: 8, startKey: "2026-02-16", endKey: "2026-03-01" },
    ]);

    // Contiguity check derived independently: each phase's endKey is exactly
    // one day before the next phase's startKey (no gap, no overlap).
    for (let i = 0; i < phases.length - 1; i++) {
      const nextDayAfterEnd = dateKey(addDays(parseDateKey(phases[i]!.endKey), 1));
      expect(nextDayAfterEnd).toBe(phases[i + 1]!.startKey);
    }
  });

  it("a phase with non-contiguous weeks[] spans min..max (weekStart/weekEnd from Math.min/Math.max, not array order)", () => {
    const startedOn = parseDateKey("2026-01-05");
    const template = minimalTemplate([phase(1, "Retest weeks", [6, 1, 3])]);

    const phases = derivePhaseTimeline(template, startedOn);

    expect(phases[0]!.weekStart).toBe(1);
    expect(phases[0]!.weekEnd).toBe(6);
    expect(phases[0]!.startKey).toBe("2026-01-05"); // week 1 day 1
    expect(phases[0]!.endKey).toBe("2026-02-15"); // week 6's last day = startedOn + 41 days
  });

  it("a single-week phase (weekStart === weekEnd) spans exactly 7 days", () => {
    const startedOn = parseDateKey("2026-01-05");
    const template = minimalTemplate([phase(1, "Deload", [1])]);

    const phases = derivePhaseTimeline(template, startedOn);

    expect(phases[0]!.startKey).toBe("2026-01-05");
    expect(phases[0]!.endKey).toBe("2026-01-11"); // 7-day block: day0..day6
  });

  it("returns an empty array for a template with no phases", () => {
    const startedOn = parseDateKey("2026-01-05");
    const template = minimalTemplate([]);
    expect(derivePhaseTimeline(template, startedOn)).toEqual([]);
  });
});
