// src/lib/activity-links.test.ts
//
// #273: unit coverage for the orphan verifier's pure core. The AC's required
// scenario — a link pointing at a nonexistent activityId is flagged — lives
// here; scripts/verify-activity-links.ts is a thin Prisma shell around
// computeOrphanLinks.

import { describe, it, expect } from "vitest";
import {
  ACTIVITY_LINK_TYPE,
  ACTIVITY_LINK_TYPES,
  computeOrphanLinks,
  type ActivityLinkRecord,
} from "@/lib/activity-links";

function link(partial: Partial<ActivityLinkRecord> & Pick<ActivityLinkRecord, "id" | "activityType" | "activityId">): ActivityLinkRecord {
  return {
    goalId: "goal-1",
    source: "auto",
    userId: "user-1",
    activityDate: new Date("2026-08-01T06:00:00Z"),
    createdAt: new Date("2026-08-01T06:00:00Z"),
    ...partial,
  };
}

describe("ACTIVITY_LINK_TYPE registry", () => {
  it("covers exactly the six link-bearing activity types", () => {
    expect([...ACTIVITY_LINK_TYPES].sort()).toEqual(
      ["baseline", "hike", "log_entry", "measurement", "nutrition", "workout"],
    );
  });
});

describe("computeOrphanLinks", () => {
  it("flags a link pointing at a nonexistent activityId as an orphan (#273 AC)", () => {
    const links = [
      link({ id: "l1", activityType: ACTIVITY_LINK_TYPE.workout, activityId: "w-gone" }),
    ];
    const existing = new Map<string, Set<string>>([["workout", new Set()]]);

    const report = computeOrphanLinks(links, existing);
    expect(report.orphans).toHaveLength(1);
    expect(report.orphans[0]!.id).toBe("l1");
    expect(report.unknownType).toHaveLength(0);
  });

  it("leaves links whose activity row exists, across types", () => {
    const links = [
      link({ id: "l1", activityType: "workout", activityId: "w1" }),
      link({ id: "l2", activityType: "hike", activityId: "h1" }),
      link({ id: "l3", activityType: "log_entry", activityId: "e1" }),
    ];
    const existing = new Map<string, Set<string>>([
      ["workout", new Set(["w1"])],
      ["hike", new Set(["h1"])],
      ["log_entry", new Set(["e1"])],
    ]);

    const report = computeOrphanLinks(links, existing);
    expect(report.orphans).toHaveLength(0);
    expect(report.unknownType).toHaveLength(0);
  });

  it("still flags a source='removed' TOMBSTONE whose activity is gone — classification is source-blind (UXR-PV-89)", () => {
    // A tombstone only exists to block re-linking of a LIVE activity. Once
    // the activity row is deleted the tombstone is garbage like any other
    // dangling link (the delete-hooks should have removed it), so the
    // verifier keeps flagging it rather than exempting it.
    const links = [
      link({ id: "l1", activityType: "workout", activityId: "w-gone", source: "removed" }),
      link({ id: "l2", activityType: "workout", activityId: "w-live", source: "removed" }),
    ];
    const existing = new Map<string, Set<string>>([["workout", new Set(["w-live"])]]);

    const report = computeOrphanLinks(links, existing);
    expect(report.orphans.map((l) => l.id)).toEqual(["l1"]); // gone → flagged
    expect(report.orphans[0]!.source).toBe("removed"); // reported as a tombstone
    // A tombstone whose activity still exists is healthy — not an orphan.
    expect(report.orphans.some((l) => l.id === "l2")).toBe(false);
  });

  it("separates orphans from survivors of the same type, and treats a missing map entry as nothing-exists", () => {
    const links = [
      link({ id: "l1", activityType: "nutrition", activityId: "n1" }),
      link({ id: "l2", activityType: "nutrition", activityId: "n-gone" }),
      link({ id: "l3", activityType: "measurement", activityId: "m1" }), // no map entry at all
    ];
    const existing = new Map<string, Set<string>>([["nutrition", new Set(["n1"])]]);

    const report = computeOrphanLinks(links, existing);
    expect(report.orphans.map((l) => l.id).sort()).toEqual(["l2", "l3"]);
  });

  it("buckets links with an unrecognized activityType separately (never counted as clean)", () => {
    const links = [
      link({ id: "l1", activityType: "metric", activityId: "e1" }), // typo'd writer: canonical is log_entry
    ];
    const report = computeOrphanLinks(links, new Map());
    expect(report.orphans).toHaveLength(0);
    expect(report.unknownType.map((l) => l.id)).toEqual(["l1"]);
  });

  it("empty input is clean", () => {
    const report = computeOrphanLinks([], new Map());
    expect(report.orphans).toHaveLength(0);
    expect(report.unknownType).toHaveLength(0);
  });
});
