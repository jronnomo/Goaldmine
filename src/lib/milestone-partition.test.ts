// src/lib/milestone-partition.test.ts

import { describe, it, expect } from "vitest";
import { partitionMilestones } from "@/lib/milestone-partition";

function makeMs(
  id: string,
  status: string,
  date: Date,
  completedAt?: Date,
) {
  return {
    id,
    title: `Milestone ${id}`,
    status,
    date,
    completedAt: completedAt ?? null,
  };
}

describe("partitionMilestones", () => {
  it("splits done vs non-done correctly", () => {
    const m1 = makeMs("1", "done", new Date("2026-01-10"), new Date("2026-01-11"));
    const m2 = makeMs("2", "planned", new Date("2026-02-01"));
    const { completed, upcoming } = partitionMilestones([m1, m2]);
    expect(completed).toHaveLength(1);
    expect(completed[0]!.id).toBe("1");
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0]!.id).toBe("2");
  });

  it("completed sorted by completedAt desc (most recent first)", () => {
    const m1 = makeMs("1", "done", new Date("2026-01-01"), new Date("2026-01-05"));
    const m2 = makeMs("2", "done", new Date("2026-02-01"), new Date("2026-03-01"));
    const { completed } = partitionMilestones([m1, m2]);
    // m2 completedAt=Mar 1 is later → first
    expect(completed[0]!.id).toBe("2");
    expect(completed[1]!.id).toBe("1");
  });

  it("upcoming sorted by date asc (soonest first)", () => {
    const m1 = makeMs("1", "planned", new Date("2026-06-01"));
    const m2 = makeMs("2", "planned", new Date("2026-04-01"));
    const { upcoming } = partitionMilestones([m1, m2]);
    // Apr before Jun
    expect(upcoming[0]!.id).toBe("2");
    expect(upcoming[1]!.id).toBe("1");
  });

  it("empty input → both arrays empty", () => {
    const { completed, upcoming } = partitionMilestones([]);
    expect(completed).toHaveLength(0);
    expect(upcoming).toHaveLength(0);
  });

  it("completedAt=null treated as epoch → sorts to end of completed list", () => {
    const m1 = makeMs("1", "done", new Date("2026-01-01"), new Date("2026-03-01"));
    const m2 = makeMs("2", "done", new Date("2026-02-01")); // no completedAt → null → 0
    const { completed } = partitionMilestones([m1, m2]);
    // m1 completedAt=Mar 1 (larger time) → first
    expect(completed[0]!.id).toBe("1");
    expect(completed[1]!.id).toBe("2");
  });

  it("skipped status goes to upcoming (not done)", () => {
    const m = makeMs("1", "skipped", new Date("2026-05-01"));
    const { completed, upcoming } = partitionMilestones([m]);
    expect(completed).toHaveLength(0);
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0]!.id).toBe("1");
  });
});
