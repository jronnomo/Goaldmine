// src/lib/attribution.test.ts
//
// #278 — attribute_activity / list_activity_links cores:
//   - add: creates a source='explicit' link with activityDate denormalized
//     from the ACTIVITY row's own date (never "now"); an existing 'auto' row
//     is UPGRADED in place (update — no second create, so the unique
//     constraint never sees a duplicate); an identical explicit link is an
//     idempotent no-op; unknown goal / unknown activity id are clean errors.
//   - remove: deletes regardless of source (explicit deletes as readily as
//     auto); removing a non-existent link is a no-op success; remove never
//     requires the underlying activity row to exist.
//   - list: filters on activityDate (NEVER createdAt — plan critique #9);
//     omitted goalId resolves the active Program's member goals; explicit
//     select without userId; limit+1 truncation signal.
//
// House convention (mirrors program-core.test.ts / goal-core.test.ts):
// vi.mock("@/lib/db") with getDb resolving to a fake scoped client whose
// $transaction executes the callback with a distinct tx client.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetDb } = vi.hoisted(() => ({ mockGetDb: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mockGetDb, prisma: {} }));

import { startOfDay } from "@/lib/calendar-core";
import { attributeActivityCore, listActivityLinksCore } from "@/lib/attribution-manual";

const WORKOUT_STARTED_AT = new Date("2026-08-05T22:30:00.000Z");
const HIKE_DATE = new Date("2026-07-19T06:00:00.000Z");

const EXISTING_AUTO_LINK = {
  id: "link-1",
  activityType: "workout",
  activityId: "w-1",
  goalId: "g-1",
  source: "auto",
  note: "rule: exerciseContains pike",
  activityDate: startOfDay(WORKOUT_STARTED_AT),
  createdAt: new Date("2026-08-05T23:00:00.000Z"),
};

// Returns `any` on purpose: individual tests re-point the per-model mocks at
// rows of different shapes (null / auto link / explicit link) and inspect
// `.mock.calls` freely — the cores under test carry the real types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeTx(overrides: Record<string, any> = {}): any {
  return {
    goal: {
      findUnique: vi.fn(async () => ({ id: "g-1", objective: "Handstand" })),
    },
    workout: {
      findUnique: vi.fn(async () => ({ startedAt: WORKOUT_STARTED_AT })),
    },
    hike: { findUnique: vi.fn(async () => ({ date: HIKE_DATE })) },
    nutritionLog: { findUnique: vi.fn(async () => null) },
    measurement: { findUnique: vi.fn(async () => null) },
    baseline: { findUnique: vi.fn(async () => null) },
    logEntry: { findUnique: vi.fn(async () => null) },
    activityGoalLink: {
      findUnique: vi.fn(async () => null),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: vi.fn(async (args: any) => ({
        id: "link-new",
        ...args.data,
        note: args.data.note ?? null,
        createdAt: new Date("2026-08-09T12:00:00.000Z"),
      })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: vi.fn(async (args: any) => ({
        ...EXISTING_AUTO_LINK,
        ...args.data,
      })),
      delete: vi.fn(async () => ({ id: "link-1" })),
    },
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wireDb(tx: any) {
  const fakeDb = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $transaction: vi.fn(async (fn: any) => fn(tx)),
  };
  mockGetDb.mockResolvedValue(fakeDb);
  return fakeDb;
}

// ─────────────────────────────────────────────────────────────────────────────
// attributeActivityCore — add
// ─────────────────────────────────────────────────────────────────────────────

describe("attributeActivityCore — add", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates an explicit link with activityDate from the ACTIVITY row's own date (not 'now')", async () => {
    const tx = makeTx();
    wireDb(tx);

    const r = await attributeActivityCore({
      activityType: "workout",
      activityId: "w-1",
      goalId: "g-1",
      action: "add",
      note: "  counts toward handstand  ",
    });

    expect(tx.activityGoalLink.create).toHaveBeenCalledOnce();
    const args = tx.activityGoalLink.create.mock.calls[0][0];
    // Top-level scalar create — no nested relation writes (gotcha §B.10).
    expect(args.data).toEqual({
      activityType: "workout",
      activityId: "w-1",
      goalId: "g-1",
      source: "explicit",
      note: "counts toward handstand", // trimmed
      activityDate: startOfDay(WORKOUT_STARTED_AT), // USER_TZ midnight of the workout's day
    });
    expect(args.data.goal).toBeUndefined(); // never a nested connect
    expect(args.select.userId).toBeUndefined(); // projection never selects userId
    expect(r.changed).toBe(true);
    expect(r.upgraded).toBe(false);
    expect(r.goalObjective).toBe("Handstand");
  });

  it("hike activities date by Hike.date", async () => {
    const tx = makeTx();
    wireDb(tx);

    await attributeActivityCore({
      activityType: "hike",
      activityId: "h-1",
      goalId: "g-1",
      action: "add",
    });

    expect(tx.hike.findUnique).toHaveBeenCalledWith({
      where: { id: "h-1" },
      select: { date: true },
    });
    const args = tx.activityGoalLink.create.mock.calls[0][0];
    expect(args.data.activityDate).toEqual(startOfDay(HIKE_DATE));
    expect(args.data.note).toBeNull();
  });

  it("UPGRADES an existing auto link in place: update, never a second create", async () => {
    const tx = makeTx();
    tx.activityGoalLink.findUnique = vi.fn(async () => ({ ...EXISTING_AUTO_LINK }));
    wireDb(tx);

    const r = await attributeActivityCore({
      activityType: "workout",
      activityId: "w-1",
      goalId: "g-1",
      action: "add",
    });

    expect(tx.activityGoalLink.create).not.toHaveBeenCalled(); // no duplicate row
    expect(tx.activityGoalLink.update).toHaveBeenCalledOnce();
    const args = tx.activityGoalLink.update.mock.calls[0][0];
    expect(args.where).toEqual({
      activityType_activityId_goalId: {
        activityType: "workout",
        activityId: "w-1",
        goalId: "g-1",
      },
    });
    expect(args.data.source).toBe("explicit");
    expect(args.data.note).toBeUndefined(); // note omitted ⇒ the auto rule's note is kept
    expect(r.upgraded).toBe(true);
    expect(r.changed).toBe(true);
    expect(r.link?.source).toBe("explicit");
  });

  it("re-adding an identical explicit link is an idempotent no-op (no write)", async () => {
    const tx = makeTx();
    tx.activityGoalLink.findUnique = vi.fn(async () => ({
      ...EXISTING_AUTO_LINK,
      source: "explicit",
    }));
    wireDb(tx);

    const r = await attributeActivityCore({
      activityType: "workout",
      activityId: "w-1",
      goalId: "g-1",
      action: "add",
    });

    expect(tx.activityGoalLink.create).not.toHaveBeenCalled();
    expect(tx.activityGoalLink.update).not.toHaveBeenCalled();
    expect(r.changed).toBe(false);
    expect(r.upgraded).toBe(false);
  });

  it("errors clearly on a non-existent activity id — and writes nothing", async () => {
    const tx = makeTx({ workout: { findUnique: vi.fn(async () => null) } });
    wireDb(tx);

    await expect(
      attributeActivityCore({
        activityType: "workout",
        activityId: "w-missing",
        goalId: "g-1",
        action: "add",
      }),
    ).rejects.toThrow(/No workout activity found with id w-missing/);
    expect(tx.activityGoalLink.create).not.toHaveBeenCalled();
    expect(tx.activityGoalLink.update).not.toHaveBeenCalled();
  });

  it("errors clearly on a non-existent goal", async () => {
    const tx = makeTx({ goal: { findUnique: vi.fn(async () => null) } });
    wireDb(tx);

    await expect(
      attributeActivityCore({
        activityType: "workout",
        activityId: "w-1",
        goalId: "g-missing",
        action: "add",
      }),
    ).rejects.toThrow("Goal not found: g-missing");
    expect(tx.activityGoalLink.create).not.toHaveBeenCalled();
  });

  it("rejects an unknown activityType before touching the DB", async () => {
    const tx = makeTx();
    wireDb(tx);

    await expect(
      attributeActivityCore({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        activityType: "mixtape" as any,
        activityId: "x-1",
        goalId: "g-1",
        action: "add",
      }),
    ).rejects.toThrow(/Unknown activityType "mixtape"/);
    expect(mockGetDb).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// attributeActivityCore — remove
// ─────────────────────────────────────────────────────────────────────────────

describe("attributeActivityCore — remove (always wins, regardless of source)", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["auto", "explicit"] as const)(
    "deletes a source='%s' link just as readily",
    async (source) => {
      const tx = makeTx();
      tx.activityGoalLink.findUnique = vi.fn(async () => ({ id: "link-1", source }));
      wireDb(tx);

      const r = await attributeActivityCore({
        activityType: "workout",
        activityId: "w-1",
        goalId: "g-1",
        action: "remove",
      });

      expect(tx.activityGoalLink.delete).toHaveBeenCalledOnce();
      expect(tx.activityGoalLink.delete.mock.calls[0][0].where).toEqual({
        activityType_activityId_goalId: {
          activityType: "workout",
          activityId: "w-1",
          goalId: "g-1",
        },
      });
      expect(r.changed).toBe(true);
      expect(r.removedSource).toBe(source);
    },
  );

  it("removing a non-existent link is a no-op success", async () => {
    const tx = makeTx();
    wireDb(tx);

    const r = await attributeActivityCore({
      activityType: "workout",
      activityId: "w-1",
      goalId: "g-1",
      action: "remove",
    });

    expect(tx.activityGoalLink.delete).not.toHaveBeenCalled();
    expect(r.changed).toBe(false);
    expect(r.removedSource).toBeNull();
  });

  it("remove does NOT require the underlying activity (or goal) to exist — it is the orphan-cleanup valve", async () => {
    const tx = makeTx({
      goal: { findUnique: vi.fn(async () => null) },
      workout: { findUnique: vi.fn(async () => null) },
    });
    tx.activityGoalLink.findUnique = vi.fn(async () => ({ id: "link-1", source: "auto" }));
    wireDb(tx);

    const r = await attributeActivityCore({
      activityType: "workout",
      activityId: "w-gone",
      goalId: "g-gone",
      action: "remove",
    });

    expect(r.changed).toBe(true);
    expect(tx.goal.findUnique).not.toHaveBeenCalled();
    expect(tx.workout.findUnique).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// listActivityLinksCore
// ─────────────────────────────────────────────────────────────────────────────

describe("listActivityLinksCore", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fakeDb: any;

  const LINK_ROW = {
    id: "link-1",
    activityType: "workout",
    activityId: "w-1",
    goalId: "g-1",
    source: "auto",
    note: null,
    activityDate: new Date("2026-08-05T06:00:00.000Z"),
    createdAt: new Date("2026-08-05T23:00:00.000Z"),
    goal: { objective: "Handstand" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    fakeDb = {
      goal: {
        findUnique: vi.fn(async () => ({ id: "g-1" })),
        findMany: vi.fn(async () => [{ id: "g-1" }, { id: "g-2" }]),
      },
      program: {
        findFirst: vi.fn(async () => ({ id: "prog-1", name: "Phase 2A" })),
      },
      activityGoalLink: {
        findMany: vi.fn(async () => [LINK_ROW]),
      },
    };
    mockGetDb.mockResolvedValue(fakeDb);
  });

  it("goalId given: filters that goal, bounds on activityDate — NEVER on createdAt (plan critique #9)", async () => {
    const r = await listActivityLinksCore({
      goalId: "g-1",
      activityType: "workout",
      from: new Date("2026-08-01T06:00:00.000Z"),
      to: new Date("2026-08-07T06:00:00.000Z"),
    });

    expect(fakeDb.activityGoalLink.findMany).toHaveBeenCalledOnce();
    const args = fakeDb.activityGoalLink.findMany.mock.calls[0][0];
    expect(args.where.goalId).toBe("g-1");
    expect(args.where.activityType).toBe("workout");
    expect(args.where.activityDate).toEqual({
      gte: startOfDay(new Date("2026-08-01T06:00:00.000Z")),
      lte: startOfDay(new Date("2026-08-07T06:00:00.000Z")),
    });
    expect(args.where.createdAt).toBeUndefined(); // the retroactive-attribution trap
    expect(args.select.userId).toBeUndefined();
    expect(args.select.goal).toEqual({ select: { objective: true } });
    expect(r.scope).toEqual({ resolvedFrom: "goal", goalIds: ["g-1"] });
    expect(r.links[0].goalObjective).toBe("Handstand");
    expect(r.truncated).toBe(false);
  });

  it("goalId omitted: scopes to ALL member goals of the active Program", async () => {
    const r = await listActivityLinksCore({});

    expect(fakeDb.program.findFirst).toHaveBeenCalledWith({
      where: { status: "active" },
      select: { id: true, name: true },
    });
    expect(fakeDb.goal.findMany).toHaveBeenCalledWith({
      where: { programId: "prog-1" },
      select: { id: true },
    });
    const args = fakeDb.activityGoalLink.findMany.mock.calls[0][0];
    expect(args.where.goalId).toEqual({ in: ["g-1", "g-2"] });
    expect(r.scope).toEqual({
      resolvedFrom: "active-program",
      goalIds: ["g-1", "g-2"],
      programId: "prog-1",
      programName: "Phase 2A",
    });
  });

  it("goalId omitted + no active Program: friendly error, not an empty success", async () => {
    fakeDb.program.findFirst.mockResolvedValue(null);
    await expect(listActivityLinksCore({})).rejects.toThrow(
      /no ACTIVE Program to default to/,
    );
    expect(fakeDb.activityGoalLink.findMany).not.toHaveBeenCalled();
  });

  it("active Program with zero member goals returns empty links without querying", async () => {
    fakeDb.goal.findMany.mockResolvedValue([]);
    const r = await listActivityLinksCore({});
    expect(r.links).toEqual([]);
    expect(r.truncated).toBe(false);
    expect(fakeDb.activityGoalLink.findMany).not.toHaveBeenCalled();
  });

  it("unknown goalId is a clean error", async () => {
    fakeDb.goal.findUnique.mockResolvedValue(null);
    await expect(listActivityLinksCore({ goalId: "g-missing" })).rejects.toThrow(
      "Goal not found: g-missing",
    );
  });

  it("fetches limit+1 and flags truncated, returning exactly `limit` rows", async () => {
    fakeDb.activityGoalLink.findMany.mockResolvedValue([
      { ...LINK_ROW, id: "l1" },
      { ...LINK_ROW, id: "l2" },
      { ...LINK_ROW, id: "l3" },
    ]);
    const r = await listActivityLinksCore({ goalId: "g-1", limit: 2 });

    const args = fakeDb.activityGoalLink.findMany.mock.calls[0][0];
    expect(args.take).toBe(3); // limit + 1 truncation probe
    expect(r.truncated).toBe(true);
    expect(r.links.map((l) => l.id)).toEqual(["l1", "l2"]);
  });

  it("orders newest activity first (activityDate desc, createdAt desc tiebreak)", async () => {
    await listActivityLinksCore({ goalId: "g-1" });
    const args = fakeDb.activityGoalLink.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual([{ activityDate: "desc" }, { createdAt: "desc" }]);
  });
});
