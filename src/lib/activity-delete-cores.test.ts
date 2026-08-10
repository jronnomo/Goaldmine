// src/lib/activity-delete-cores.test.ts
//
// #272 delete-hook consolidation — behavior of the six shared delete cores:
//   deleteWorkoutCore / deleteWorkoutsCore (workout-core.ts)
//   deleteHikeCore (hike-core.ts)
//   deleteMeasurementCore / deleteNutritionCore / deleteBaselineCore /
//   deleteLogEntryCore (their own core modules)
//
// What this file proves, per core:
//   1. The ActivityGoalLink cleanup runs INSIDE the same $transaction as the
//      row delete — the fake root client deliberately has NO delete methods,
//      only the tx client does, so a core that deletes outside the tx crashes.
//   2. Cleanup removes exactly the activity's links (matching activityType AND
//      activityId) and leaves every other link — enforced against an
//      in-memory link store, including a same-id-different-type decoy.
//   3. Pre-existing error semantics are preserved (P2025 propagation for
//      workout/hike/measurement/nutrition, findUniqueOrThrow-first for
//      baseline, P2025→null for logEntry).
//
// House convention: vi.mock("@/lib/db") with getDb resolving to a fake scoped
// client whose $transaction executes the callback with a distinct tx client
// (mirrors goal-core.test.ts).

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetDb } = vi.hoisted(() => ({ mockGetDb: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mockGetDb, prisma: {} }));

// baseline-core's workout-sync side effect — spied, asserted, never executed.
const mockRemoveBaselineFromDayWorkout = vi.hoisted(() => vi.fn());
vi.mock("@/lib/baseline-workout", () => ({
  removeBaselineFromDayWorkout: mockRemoveBaselineFromDayWorkout,
}));

import { deleteWorkoutCore, deleteWorkoutsCore } from "@/lib/workout-core";
import { deleteHikeCore } from "@/lib/hike-core";
import { deleteMeasurementCore } from "@/lib/measurement-core";
import { deleteNutritionCore } from "@/lib/nutrition-core";
import { deleteBaselineCore } from "@/lib/baseline-core";
import { deleteLogEntryCore } from "@/lib/log-entry-core";

// ── Fake scoped client with an in-memory ActivityGoalLink store ──────────────

type LinkRow = { id: string; activityType: string; activityId: string; source?: string };

function p2025(): Error {
  return Object.assign(new Error("Record to delete does not exist."), { code: "P2025" });
}

function makeFake(initialLinks: LinkRow[]) {
  const links = [...initialLinks];

  const linkDeleteMany = vi.fn(
    async ({ where }: { where: { activityType: string; activityId: string | { in: string[] } } }) => {
      const ids =
        typeof where.activityId === "string" ? [where.activityId] : where.activityId.in;
      const before = links.length;
      for (let i = links.length - 1; i >= 0; i--) {
        const l = links[i]!;
        if (l.activityType === where.activityType && ids.includes(l.activityId)) {
          links.splice(i, 1);
        }
      }
      return { count: before - links.length };
    },
  );

  // Row deletes live ONLY on the tx client. If a core issues its row delete or
  // link cleanup outside $transaction, it hits undefined on the root client.
  const tx = {
    workout: {
      delete: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    hike: { delete: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id })) },
    measurement: { delete: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id })) },
    nutritionLog: {
      delete: vi.fn(async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        mealType: "lunch",
        date: new Date("2026-08-01T18:00:00Z"),
      })),
    },
    baseline: { delete: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id })) },
    logEntry: {
      delete: vi.fn(async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        metric: "mrr",
        value: 42,
      })),
    },
    activityGoalLink: { deleteMany: linkDeleteMany },
  };

  const db = {
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    // Reads that legitimately happen before the transaction:
    hike: { findUnique: vi.fn(async () => null as { date: Date } | null) },
    baseline: { findUniqueOrThrow: vi.fn() },
  };

  mockGetDb.mockResolvedValue(db);
  return { db, tx, linkDeleteMany, links };
}

// Store fixture used across tests: two workout links on w1, one on w2, plus a
// SAME-ID decoy of a different type ("hike"/w1) and unrelated rows per type.
function standardStore(): LinkRow[] {
  return [
    { id: "l1", activityType: "workout", activityId: "w1" },
    { id: "l2", activityType: "workout", activityId: "w1" },
    { id: "l3", activityType: "workout", activityId: "w2" },
    { id: "l4", activityType: "hike", activityId: "w1" }, // same id, different type — must survive workout deletes
    { id: "l5", activityType: "hike", activityId: "h1" },
    { id: "l6", activityType: "nutrition", activityId: "n1" },
    { id: "l7", activityType: "measurement", activityId: "m1" },
    { id: "l8", activityType: "baseline", activityId: "b1" },
    { id: "l9", activityType: "log_entry", activityId: "e1" },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── deleteWorkoutCore ─────────────────────────────────────────────────────────

describe("deleteWorkoutCore", () => {
  it("deletes the workout and exactly its links in the same transaction; other links survive", async () => {
    const { db, tx, links } = makeFake(standardStore());

    await expect(deleteWorkoutCore("w1")).resolves.toEqual({ id: "w1" });

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.workout.delete).toHaveBeenCalledWith({ where: { id: "w1" } });
    expect(tx.activityGoalLink.deleteMany).toHaveBeenCalledWith({
      where: { activityType: "workout", activityId: "w1" },
    });
    // l1+l2 removed; the same-id hike decoy (l4), w2's link, and every other
    // type's link survive.
    expect(links.map((l) => l.id)).toEqual(["l3", "l4", "l5", "l6", "l7", "l8", "l9"]);
  });

  it("a missing id propagates P2025 from workout.delete and never reaches link cleanup", async () => {
    const { tx } = makeFake(standardStore());
    tx.workout.delete.mockRejectedValueOnce(p2025());

    await expect(deleteWorkoutCore("nope")).rejects.toMatchObject({ code: "P2025" });
    expect(tx.activityGoalLink.deleteMany).not.toHaveBeenCalled();
  });

  it("hard-deletes TOMBSTONES too — cleanup filters on (type, id) only, never on source (UXR-PV-89)", async () => {
    // A removed-source tombstone's job ends with its activity: once the
    // activity row is gone there is nothing left to block, so the delete
    // hook must not leave tombstone rows behind as permanent garbage.
    const { tx, links } = makeFake([
      { id: "l1", activityType: "workout", activityId: "w1", source: "auto" },
      { id: "l2", activityType: "workout", activityId: "w1", source: "removed" }, // tombstone
      { id: "l3", activityType: "workout", activityId: "w2", source: "removed" }, // other activity — survives
    ]);

    await deleteWorkoutCore("w1");

    const where = tx.activityGoalLink.deleteMany.mock.calls[0]![0]!
      .where as Record<string, unknown>;
    expect(where).toEqual({ activityType: "workout", activityId: "w1" });
    expect(where.source).toBeUndefined(); // no source filter — tombstones included
    expect(links.map((l) => l.id)).toEqual(["l3"]);
  });
});

// ── deleteWorkoutsCore (unskipDay batch backstop) ─────────────────────────────

describe("deleteWorkoutsCore", () => {
  it("batch-deletes rows and links for exactly the given ids", async () => {
    const { tx, links } = makeFake(standardStore());
    tx.workout.deleteMany.mockResolvedValueOnce({ count: 2 });

    await expect(deleteWorkoutsCore(["w1", "w2"])).resolves.toEqual({ deleted: 2 });

    expect(tx.workout.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["w1", "w2"] } },
    });
    expect(tx.activityGoalLink.deleteMany).toHaveBeenCalledWith({
      where: { activityType: "workout", activityId: { in: ["w1", "w2"] } },
    });
    expect(links.map((l) => l.id)).toEqual(["l4", "l5", "l6", "l7", "l8", "l9"]);
  });

  it("empty id list is a no-op — no client, no transaction", async () => {
    await expect(deleteWorkoutsCore([])).resolves.toEqual({ deleted: 0 });
    expect(mockGetDb).not.toHaveBeenCalled();
  });
});

// ── deleteHikeCore ────────────────────────────────────────────────────────────

describe("deleteHikeCore", () => {
  it("captures the date pre-delete, deletes the hike and exactly its links", async () => {
    const { db, tx, links } = makeFake(standardStore());
    const date = new Date("2026-07-04T12:00:00Z");
    db.hike.findUnique.mockResolvedValueOnce({ date });

    await expect(deleteHikeCore("h1")).resolves.toEqual({ id: "h1", date });

    expect(db.hike.findUnique).toHaveBeenCalledWith({
      where: { id: "h1" },
      select: { date: true },
    });
    expect(tx.hike.delete).toHaveBeenCalledWith({ where: { id: "h1" } });
    expect(tx.activityGoalLink.deleteMany).toHaveBeenCalledWith({
      where: { activityType: "hike", activityId: "h1" },
    });
    // Only l5 (hike/h1) removed — the workout links and the hike/w1 row survive.
    expect(links.map((l) => l.id)).toEqual(["l1", "l2", "l3", "l4", "l6", "l7", "l8", "l9"]);
  });

  it("a missing id propagates P2025 (same as the previous inline delete)", async () => {
    const { tx } = makeFake(standardStore());
    tx.hike.delete.mockRejectedValueOnce(p2025());

    await expect(deleteHikeCore("nope")).rejects.toMatchObject({ code: "P2025" });
    expect(tx.activityGoalLink.deleteMany).not.toHaveBeenCalled();
  });
});

// ── deleteMeasurementCore ─────────────────────────────────────────────────────

describe("deleteMeasurementCore", () => {
  it("deletes the measurement and exactly its links", async () => {
    const { tx, links } = makeFake(standardStore());

    await expect(deleteMeasurementCore("m1")).resolves.toEqual({ id: "m1" });

    expect(tx.measurement.delete).toHaveBeenCalledWith({ where: { id: "m1" } });
    expect(tx.activityGoalLink.deleteMany).toHaveBeenCalledWith({
      where: { activityType: "measurement", activityId: "m1" },
    });
    expect(links.some((l) => l.id === "l7")).toBe(false);
    expect(links).toHaveLength(8);
  });
});

// ── deleteNutritionCore ───────────────────────────────────────────────────────

describe("deleteNutritionCore", () => {
  it("returns the deleted row (Undo snapshot) and cleans exactly its links", async () => {
    const { tx, links } = makeFake(standardStore());

    const row = await deleteNutritionCore("n1");
    expect(row).toMatchObject({ id: "n1", mealType: "lunch" });

    expect(tx.nutritionLog.delete).toHaveBeenCalledWith({ where: { id: "n1" } });
    expect(tx.activityGoalLink.deleteMany).toHaveBeenCalledWith({
      where: { activityType: "nutrition", activityId: "n1" },
    });
    expect(links.some((l) => l.id === "l6")).toBe(false);
    expect(links).toHaveLength(8);
  });
});

// ── deleteBaselineCore ────────────────────────────────────────────────────────

describe("deleteBaselineCore", () => {
  it("findUniqueOrThrow-first, deletes row + exactly its links, then syncs the mirrored workout", async () => {
    const { db, tx, links } = makeFake(standardStore());
    const date = new Date("2026-06-01T12:00:00Z");
    db.baseline.findUniqueOrThrow.mockResolvedValueOnce({
      id: "b1",
      testName: "Max Pull-ups",
      date,
    });

    await expect(deleteBaselineCore("b1")).resolves.toEqual({
      id: "b1",
      testName: "Max Pull-ups",
      date,
    });

    expect(tx.baseline.delete).toHaveBeenCalledWith({ where: { id: "b1" } });
    expect(tx.activityGoalLink.deleteMany).toHaveBeenCalledWith({
      where: { activityType: "baseline", activityId: "b1" },
    });
    expect(links.some((l) => l.id === "l8")).toBe(false);
    // Workout sync runs after the transaction, with the pre-captured identity.
    expect(mockRemoveBaselineFromDayWorkout).toHaveBeenCalledWith({
      testName: "Max Pull-ups",
      date,
    });
    const txOrder = (db.$transaction as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!;
    const syncOrder = mockRemoveBaselineFromDayWorkout.mock.invocationCallOrder[0]!;
    expect(syncOrder).toBeGreaterThan(txOrder);
  });

  it("a missing id throws from findUniqueOrThrow before anything is written", async () => {
    const { db, tx } = makeFake(standardStore());
    db.baseline.findUniqueOrThrow.mockRejectedValueOnce(p2025());

    await expect(deleteBaselineCore("nope")).rejects.toMatchObject({ code: "P2025" });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(tx.baseline.delete).not.toHaveBeenCalled();
    expect(mockRemoveBaselineFromDayWorkout).not.toHaveBeenCalled();
  });
});

// ── deleteLogEntryCore ────────────────────────────────────────────────────────

describe("deleteLogEntryCore", () => {
  it("returns the deleted row's confirmation fields and cleans exactly its links", async () => {
    const { tx, links } = makeFake(standardStore());

    await expect(deleteLogEntryCore("e1")).resolves.toEqual({
      id: "e1",
      metric: "mrr",
      value: 42,
    });

    expect(tx.logEntry.delete).toHaveBeenCalledWith({
      where: { id: "e1" },
      select: { id: true, metric: true, value: true },
    });
    expect(tx.activityGoalLink.deleteMany).toHaveBeenCalledWith({
      where: { activityType: "log_entry", activityId: "e1" },
    });
    expect(links.some((l) => l.id === "l9")).toBe(false);
    expect(links).toHaveLength(8);
  });

  it("a missing id returns null (P2025 mapped for the callers' friendly errors)", async () => {
    const { tx } = makeFake(standardStore());
    tx.logEntry.delete.mockRejectedValueOnce(p2025());

    await expect(deleteLogEntryCore("nope")).resolves.toBeNull();
    expect(tx.activityGoalLink.deleteMany).not.toHaveBeenCalled();
  });

  it("non-P2025 errors rethrow", async () => {
    const { tx } = makeFake(standardStore());
    tx.logEntry.delete.mockRejectedValueOnce(new Error("connection reset"));

    await expect(deleteLogEntryCore("e1")).rejects.toThrow("connection reset");
  });
});
