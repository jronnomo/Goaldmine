// src/lib/attribution-hooks.test.ts
//
// #307/#308/#309 — the auto-link DB glue. What this file proves, per hook:
//   1. Link writes are ONE top-level activityGoalLink.createMany on the
//      writer client — the fake emulates the getDb() $extends convention and
//      stamps userId ONLY on rows arriving through that top-level call, so
//      every stored row carrying userId proves the write went through the
//      scoped path (a nested relation write would never reach the fake).
//   2. skipDuplicates idempotency: a re-run creates nothing; a pre-existing
//      source:"explicit" row for the same (type, activity, goal) is NEVER
//      updated/downgraded (no update path exists — the row is byte-identical
//      after the hook).
//   3. No active Program ⇒ zero link writes and zero extra reads.
//   4. Only ACTIVE member goals link; rule goalIds outside the membership
//      never link.
//   5. The hook writes through the PASSED writer (batch_log_nutrition's tx
//      client rides the transaction).
//
// House convention: vi.mock("@/lib/db") + vi.mock("@/lib/program") with fakes,
// mirroring activity-delete-cores.test.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetDb, mockGetMembership } = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockGetMembership: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ getDb: mockGetDb, prisma: {} }));
vi.mock("@/lib/program", () => ({ getActiveProgramMembership: mockGetMembership }));

import {
  autoLinkWorkout,
  autoLinkNutrition,
  mirrorActivityGoalLink,
  loadAttributionContext,
  writeAutoLinks,
  swallowAutoLinkError,
  type AttributionContext,
} from "@/lib/attribution-hooks";
import { startOfDay } from "@/lib/calendar";

// ── Scoped-mock link store ────────────────────────────────────────────────────
// Emulates the real client's behavior for the ONE call shape the hooks use:
// top-level createMany with skipDuplicates against the compound unique.
// userId injection happens HERE (as the $extends extension does for top-level
// calls) — rows in the store carrying userId is the proof the hook wrote
// through the scoped seam.

type StoredLink = {
  activityType: string;
  activityId: string;
  goalId: string;
  source: string;
  note?: string | null;
  activityDate: Date;
  userId: string;
};

function makeLinkStore(initial: StoredLink[] = []) {
  const rows: StoredLink[] = initial.map((r) => ({ ...r }));
  const createMany = vi.fn(
    async ({
      data,
      skipDuplicates,
    }: {
      data: Array<Omit<StoredLink, "userId">>;
      skipDuplicates: boolean;
    }) => {
      let count = 0;
      for (const d of data) {
        const dup = rows.some(
          (r) =>
            r.activityType === d.activityType &&
            r.activityId === d.activityId &&
            r.goalId === d.goalId,
        );
        if (dup) {
          if (!skipDuplicates) {
            throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
          }
          continue;
        }
        rows.push({ ...d, userId: "usr_test" }); // ← scoped-extension emulation
        count++;
      }
      return { count };
    },
  );
  return { rows, createMany, writer: { activityGoalLink: { createMany } } };
}

// ── Membership / hints fixtures ──────────────────────────────────────────────

const MEMBERSHIP = {
  id: "prog-1",
  name: "Phase 2A",
  status: "active",
  startedOn: new Date("2026-08-10T06:00:00Z"),
  endsOn: null,
  notes: null,
  attributionRules: [
    { match: { titleContains: ["incline walk"] }, goalIds: ["g-cut", "g-aws", "g-outsider"] },
  ],
  memberGoals: [
    { id: "g-handstand", objective: "Freestanding handstand", kind: "fitness", status: "active" },
    { id: "g-cut", objective: "10% body fat", kind: "fitness", status: "active" },
    { id: "g-aws", objective: "AWS SAA", kind: "project", status: "active" },
    { id: "g-paused", objective: "Paused thing", kind: "fitness", status: "paused" },
  ],
};

const HINT_ROWS = [
  { id: "g-handstand", attributionHints: ["Wall Handstand Hold", "Pull-Up"] },
  { id: "g-cut", attributionHints: null },
  { id: "g-aws", attributionHints: null },
];

function mockDbWithHints(rows = HINT_ROWS) {
  const goalFindMany = vi.fn(async () => rows);
  mockGetDb.mockResolvedValue({ goal: { findMany: goalFindMany } });
  return { goalFindMany };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── autoLinkWorkout ───────────────────────────────────────────────────────────

describe("autoLinkWorkout", () => {
  it("writes hint + rule matches in ONE top-level createMany; rows carry userId, source 'auto', USER_TZ-midnight activityDate", async () => {
    mockGetMembership.mockResolvedValue(MEMBERSHIP);
    mockDbWithHints();
    const { rows, createMany, writer } = makeLinkStore();
    const startedAt = new Date("2026-08-11T00:30:00Z"); // evening of 8/10 in Denver

    const linked = await autoLinkWorkout(writer, {
      workoutId: "w1",
      title: "Incline Walk (Z2)",
      source: "claude",
      status: "completed",
      startedAt,
      exerciseNames: ["Wall Handstand Hold"],
    });

    // handstand via hint; cut+aws via the title rule; g-outsider dropped
    // (not a member); g-paused not active.
    expect(linked).toEqual(["g-handstand", "g-cut", "g-aws"]);
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ activityType: "workout", activityId: "w1", goalId: "g-handstand", source: "auto" }),
        expect.objectContaining({ goalId: "g-cut" }),
        expect.objectContaining({ goalId: "g-aws" }),
      ],
      skipDuplicates: true,
    });
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.userId).toBe("usr_test"); // top-level scoped write
      expect(row.source).toBe("auto");
      expect(row.activityDate).toEqual(startOfDay(startedAt));
    }
  });

  it("no active Program → zero writes AND zero hint reads", async () => {
    mockGetMembership.mockResolvedValue(null);
    const { goalFindMany } = mockDbWithHints();
    const { rows, createMany, writer } = makeLinkStore();

    const linked = await autoLinkWorkout(writer, {
      workoutId: "w1",
      title: "Incline Walk",
      source: "claude",
      status: "completed",
      startedAt: new Date(),
      exerciseNames: ["Wall Handstand Hold"],
    });

    expect(linked).toEqual([]);
    expect(createMany).not.toHaveBeenCalled();
    expect(goalFindMany).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it("non-completed workouts (skipDay placeholders) never link — membership is not even probed", async () => {
    const { createMany, writer } = makeLinkStore();

    const linked = await autoLinkWorkout(writer, {
      workoutId: "w-skip",
      title: "Skipped — travel",
      source: "manual",
      status: "skipped",
      startedAt: new Date(),
      exerciseNames: [],
    });

    expect(linked).toEqual([]);
    expect(mockGetMembership).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });

  it("idempotent: an identical re-run creates zero new rows", async () => {
    mockGetMembership.mockResolvedValue(MEMBERSHIP);
    mockDbWithHints();
    const { rows, writer } = makeLinkStore();
    const input = {
      workoutId: "w1",
      title: null,
      source: "claude",
      status: "completed",
      startedAt: new Date("2026-08-10T18:00:00Z"),
      exerciseNames: ["Pull Up"], // alias of the "Pull-Up" hint
    };

    await autoLinkWorkout(writer, input);
    expect(rows).toHaveLength(1);
    const snapshot = JSON.stringify(rows);

    await autoLinkWorkout(writer, input);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).toBe(snapshot);
  });

  it("a pre-existing source:'explicit' link is NEVER downgraded — the row survives byte-identical", async () => {
    mockGetMembership.mockResolvedValue(MEMBERSHIP);
    mockDbWithHints();
    const explicitRow: StoredLink = {
      activityType: "workout",
      activityId: "w1",
      goalId: "g-handstand",
      source: "explicit",
      note: "coach pinned this",
      activityDate: new Date("2026-08-10T06:00:00Z"),
      userId: "usr_test",
    };
    const { rows, writer } = makeLinkStore([explicitRow]);

    const linked = await autoLinkWorkout(writer, {
      workoutId: "w1",
      title: null,
      source: "claude",
      status: "completed",
      startedAt: new Date("2026-08-10T18:00:00Z"),
      exerciseNames: ["Wall Handstand Hold"],
    });

    expect(linked).toEqual(["g-handstand"]); // evaluation still reports it
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(explicitRow); // source still "explicit", note intact
  });

  it("a preloaded context (backfill path) skips membership/hint loading entirely", async () => {
    const ctx: AttributionContext = {
      programId: "prog-1",
      memberGoals: [{ id: "g-cut", kind: "fitness", status: "active" }],
      hintsByGoal: new Map([["g-cut", ["Squat"]]]),
      rules: null,
    };
    const { rows, writer } = makeLinkStore();

    const linked = await autoLinkWorkout(
      writer,
      {
        workoutId: "w9",
        title: null,
        source: "strong",
        status: "completed",
        startedAt: new Date("2026-07-01T12:00:00Z"),
        exerciseNames: ["Squat"],
      },
      ctx,
    );

    expect(linked).toEqual(["g-cut"]);
    expect(mockGetMembership).not.toHaveBeenCalled();
    expect(mockGetDb).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
  });

  it("an explicitly-passed null context (backfill: no active Program) is a no-op", async () => {
    const { createMany, writer } = makeLinkStore();
    const linked = await autoLinkWorkout(
      writer,
      {
        workoutId: "w9",
        title: null,
        source: "strong",
        status: "completed",
        startedAt: new Date(),
        exerciseNames: ["Squat"],
      },
      null,
    );
    expect(linked).toEqual([]);
    expect(mockGetMembership).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });
});

// ── mirrorActivityGoalLink ────────────────────────────────────────────────────

describe("mirrorActivityGoalLink", () => {
  it("mirrors an active member goalId (hike) with userId + USER_TZ day", async () => {
    mockGetMembership.mockResolvedValue(MEMBERSHIP);
    const { rows, writer } = makeLinkStore();
    const date = new Date("2026-08-15T15:00:00Z");

    const linked = await mirrorActivityGoalLink(writer, {
      activityType: "hike",
      activityId: "h1",
      goalId: "g-handstand",
      date,
    });

    expect(linked).toEqual(["g-handstand"]);
    expect(rows).toEqual([
      {
        activityType: "hike",
        activityId: "h1",
        goalId: "g-handstand",
        source: "auto",
        activityDate: startOfDay(date),
        userId: "usr_test",
      },
    ]);
    // Mirrors never need hints — no extra goal read.
    expect(mockGetDb).not.toHaveBeenCalled();
  });

  it("log_entry mirror works the same way", async () => {
    mockGetMembership.mockResolvedValue(MEMBERSHIP);
    const { rows, writer } = makeLinkStore();

    const linked = await mirrorActivityGoalLink(writer, {
      activityType: "log_entry",
      activityId: "e1",
      goalId: "g-aws",
      date: new Date("2026-08-12T20:00:00Z"),
    });

    expect(linked).toEqual(["g-aws"]);
    expect(rows[0]).toMatchObject({ activityType: "log_entry", goalId: "g-aws", userId: "usr_test" });
  });

  it("null goalId skips before touching membership", async () => {
    const { createMany, writer } = makeLinkStore();
    const linked = await mirrorActivityGoalLink(writer, {
      activityType: "hike",
      activityId: "h1",
      goalId: null,
      date: new Date(),
    });
    expect(linked).toEqual([]);
    expect(mockGetMembership).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });

  it("non-member and non-active goalIds never mirror; no active Program never mirrors", async () => {
    mockGetMembership.mockResolvedValue(MEMBERSHIP);
    const { createMany, writer } = makeLinkStore();
    const base = { activityType: "hike" as const, activityId: "h1", date: new Date() };

    expect(await mirrorActivityGoalLink(writer, { ...base, goalId: "g-elsewhere" })).toEqual([]);
    expect(await mirrorActivityGoalLink(writer, { ...base, goalId: "g-paused" })).toEqual([]);

    mockGetMembership.mockResolvedValue(null);
    expect(await mirrorActivityGoalLink(writer, { ...base, goalId: "g-handstand" })).toEqual([]);
    expect(createMany).not.toHaveBeenCalled();
  });

  it("duplicate mirror re-run is a no-op", async () => {
    mockGetMembership.mockResolvedValue(MEMBERSHIP);
    const { rows, writer } = makeLinkStore();
    const input = {
      activityType: "hike" as const,
      activityId: "h1",
      goalId: "g-cut",
      date: new Date("2026-08-15T15:00:00Z"),
    };
    await mirrorActivityGoalLink(writer, input);
    await mirrorActivityGoalLink(writer, input);
    expect(rows).toHaveLength(1);
  });
});

// ── autoLinkNutrition ─────────────────────────────────────────────────────────

describe("autoLinkNutrition", () => {
  it("links ACTIVE fitness-kind member goals only — project members never linked, rules never consulted", async () => {
    mockGetMembership.mockResolvedValue(MEMBERSHIP); // rules name g-aws — must not matter
    const { rows, writer } = makeLinkStore();
    const date = new Date("2026-08-10T19:00:00Z");

    const linked = await autoLinkNutrition(writer, { nutritionLogId: "n1", date });

    expect(linked).toEqual(["g-handstand", "g-cut"]);
    expect(rows.map((r) => r.goalId)).toEqual(["g-handstand", "g-cut"]);
    expect(rows.every((r) => r.userId === "usr_test" && r.source === "auto")).toBe(true);
    expect(rows.every((r) => r.activityDate.getTime() === startOfDay(date).getTime())).toBe(true);
    // No hint fetch for nutrition.
    expect(mockGetDb).not.toHaveBeenCalled();
  });

  it("no active Program → no writes", async () => {
    mockGetMembership.mockResolvedValue(null);
    const { createMany, writer } = makeLinkStore();
    expect(await autoLinkNutrition(writer, { nutritionLogId: "n1", date: new Date() })).toEqual([]);
    expect(createMany).not.toHaveBeenCalled();
  });

  it("writes go through the PASSED writer (the batch tx client rides the transaction)", async () => {
    mockGetMembership.mockResolvedValue(MEMBERSHIP);
    const storeA = makeLinkStore(); // pretend: root client
    const storeB = makeLinkStore(); // pretend: tx client

    await autoLinkNutrition(storeB.writer, { nutritionLogId: "n1", date: new Date() });

    expect(storeB.createMany).toHaveBeenCalledTimes(1);
    expect(storeA.createMany).not.toHaveBeenCalled();
    expect(storeB.rows).toHaveLength(2);
  });

  it("duplicate re-run is a no-op", async () => {
    mockGetMembership.mockResolvedValue(MEMBERSHIP);
    const { rows, writer } = makeLinkStore();
    const input = { nutritionLogId: "n1", date: new Date("2026-08-10T19:00:00Z") };
    await autoLinkNutrition(writer, input);
    await autoLinkNutrition(writer, input);
    expect(rows).toHaveLength(2);
  });
});

// ── loadAttributionContext / writeAutoLinks / swallowAutoLinkError ───────────

describe("loadAttributionContext", () => {
  it("null without an active Program", async () => {
    mockGetMembership.mockResolvedValue(null);
    expect(await loadAttributionContext()).toBeNull();
  });

  it("carries membership + parsed rules; hints only for active member goals with hints", async () => {
    mockGetMembership.mockResolvedValue(MEMBERSHIP);
    const { goalFindMany } = mockDbWithHints();

    const ctx = await loadAttributionContext();

    expect(ctx).not.toBeNull();
    expect(ctx!.programId).toBe("prog-1");
    expect(ctx!.rules).toEqual(MEMBERSHIP.attributionRules);
    expect(ctx!.memberGoals.map((g) => g.id)).toEqual(["g-handstand", "g-cut", "g-aws", "g-paused"]);
    expect([...ctx!.hintsByGoal.keys()]).toEqual(["g-handstand"]);
    // Hint query is restricted to ACTIVE member ids.
    expect(goalFindMany).toHaveBeenCalledWith({
      where: { id: { in: ["g-handstand", "g-cut", "g-aws"] } },
      select: { id: true, attributionHints: true },
    });
  });

  it("includeHints:false skips the goal read entirely", async () => {
    mockGetMembership.mockResolvedValue(MEMBERSHIP);
    const ctx = await loadAttributionContext({ includeHints: false });
    expect(ctx!.hintsByGoal.size).toBe(0);
    expect(mockGetDb).not.toHaveBeenCalled();
  });
});

describe("writeAutoLinks", () => {
  it("empty goalIds → 0 with no DB call", async () => {
    const { createMany, writer } = makeLinkStore();
    expect(await writeAutoLinks(writer, "workout", "w1", new Date(), [])).toBe(0);
    expect(createMany).not.toHaveBeenCalled();
  });

  it("returns rows actually created (existing duplicates skipped)", async () => {
    const activityDate = new Date("2026-08-10T06:00:00Z");
    const { writer } = makeLinkStore([
      {
        activityType: "workout",
        activityId: "w1",
        goalId: "g-a",
        source: "explicit",
        activityDate,
        userId: "usr_test",
      },
    ]);
    expect(await writeAutoLinks(writer, "workout", "w1", activityDate, ["g-a", "g-b"])).toBe(1);
  });
});

describe("swallowAutoLinkError", () => {
  it("logs and resolves to [] so activity writes never fail on link errors", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await Promise.reject(new Error("boom")).catch(swallowAutoLinkError("test-site"));
    expect(out).toEqual([]);
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0][0])).toContain("test-site");
    err.mockRestore();
  });
});
