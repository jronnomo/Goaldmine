// src/lib/attribution-wiring.test.ts
//
// #307 — the activity WRITE CORES fire the auto-link hooks end-to-end:
// real createWorkoutCore / appendBaselineToDayWorkout run
// against a fake scoped client, with the REAL attribution-hooks + evaluators
// underneath (only membership + records' recordsSetInWorkout are mocked).
// Assertions land on the in-memory link store: rows exist (or don't), carry
// the injected userId (top-level scoped-write convention), and re-runs are
// no-ops. The hooks' own matrix lives in attribution-hooks.test.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetDb, mockGetMembership, mockPrisma } = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockGetMembership: vi.fn(),
  mockPrisma: {
    workoutExercise: { create: vi.fn(async () => ({ id: "we-new" })) },
  },
}));
vi.mock("@/lib/db", () => ({ getDb: mockGetDb, prisma: mockPrisma }));
vi.mock("@/lib/program", () => ({ getActiveProgramMembership: mockGetMembership }));
// recordsSetInWorkout would hit the DB — stub it; everything else in records
// stays real (baseline-workout needs metricKindFor/canonicalExerciseName).
vi.mock("@/lib/records", async () => {
  const actual = await vi.importActual<typeof import("@/lib/records")>("@/lib/records");
  return { ...actual, recordsSetInWorkout: vi.fn(async () => []) };
});

import { createWorkoutCore } from "@/lib/workout-core";
import { appendBaselineToDayWorkout } from "@/lib/baseline-workout";
import { startOfDay } from "@/lib/calendar";

// ── Fake scoped client ────────────────────────────────────────────────────────

type StoredLink = {
  activityType: string;
  activityId: string;
  goalId: string;
  source: string;
  activityDate: Date;
  userId: string;
};

function makeFakeDb() {
  const links: StoredLink[] = [];

  const db = {
    workout: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "w-created",
        ...data,
      })),
      findFirst: vi.fn(async () => null as unknown),
    },
    goal: {
      // Hint fetch for autoLinkWorkout; logHikeCore's focus lookup uses
      // findFirst, its target validation uses findUnique.
      findMany: vi.fn(async () => [
        { id: "g-handstand", attributionHints: ["Wall Handstand Hold", "Pull-Up"] },
      ]),
      findFirst: vi.fn(async () => ({ id: "g-focus" }) as unknown),
      findUnique: vi.fn(async () => null as unknown),
    },
    hike: {
      findFirst: vi.fn(async () => null as unknown),
      findUnique: vi.fn(async () => null as unknown),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "h-created",
        ...data,
      })),
      update: vi.fn(),
    },
    activityGoalLink: {
      createMany: vi.fn(
        async ({
          data,
          skipDuplicates,
        }: {
          data: Array<Omit<StoredLink, "userId">>;
          skipDuplicates: boolean;
        }) => {
          let count = 0;
          for (const d of data) {
            const dup = links.some(
              (r) =>
                r.activityType === d.activityType &&
                r.activityId === d.activityId &&
                r.goalId === d.goalId,
            );
            if (dup) {
              if (!skipDuplicates) throw Object.assign(new Error("P2002"), { code: "P2002" });
              continue;
            }
            links.push({ ...d, userId: "usr_test" }); // scoped-extension emulation
            count++;
          }
          return { count };
        },
      ),
    },
  };
  mockGetDb.mockResolvedValue(db);
  return { db, links };
}

const MEMBERSHIP = {
  id: "prog-1",
  name: "Phase 2A",
  status: "active",
  startedOn: new Date("2026-08-10T06:00:00Z"),
  endsOn: null,
  notes: null,
  attributionRules: [{ match: { source: "baseline" }, goalIds: ["g-cut"] }],
  memberGoals: [
    { id: "g-handstand", objective: "Handstand", kind: "fitness", status: "active" },
    { id: "g-cut", objective: "Cut", kind: "fitness", status: "active" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ── createWorkoutCore ─────────────────────────────────────────────────────────

describe("createWorkoutCore auto-link wiring (#307)", () => {
  it("a completed workout matching a hint writes a scoped link row", async () => {
    mockGetMembership.mockResolvedValue(MEMBERSHIP);
    const { links } = makeFakeDb();
    const startedAt = new Date("2026-08-10T18:00:00Z");

    const res = await createWorkoutCore({
      title: "Handstand practice",
      startedAt,
      status: "completed",
      source: "claude",
      exercises: [
        { name: "Wall Handstand Hold", orderIndex: 0, sets: [{ setIndex: 1, durationSec: 45 }] },
      ],
    });

    expect(res.id).toBe("w-created");
    expect(links).toEqual([
      {
        activityType: "workout",
        activityId: "w-created",
        goalId: "g-handstand",
        source: "auto",
        activityDate: startOfDay(startedAt),
        userId: "usr_test",
      },
    ]);
  });

  it("no active Program → the workout is created and ZERO links are written", async () => {
    mockGetMembership.mockResolvedValue(null);
    const { db, links } = makeFakeDb();

    const res = await createWorkoutCore({
      startedAt: new Date(),
      status: "completed",
      exercises: [{ name: "Wall Handstand Hold", orderIndex: 0, sets: [] }],
    });

    expect(res.id).toBe("w-created");
    expect(links).toHaveLength(0);
    expect(db.activityGoalLink.createMany).not.toHaveBeenCalled();
  });

  it("a link failure is swallowed — the workout create still resolves", async () => {
    mockGetMembership.mockRejectedValue(new Error("membership backend down"));
    makeFakeDb();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await createWorkoutCore({
      startedAt: new Date(),
      status: "completed",
      exercises: [{ name: "Squat", orderIndex: 0, sets: [] }],
    });

    expect(res.id).toBe("w-created");
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("skipped placeholder workouts (skipDay) never probe membership", async () => {
    const { links } = makeFakeDb();

    await createWorkoutCore({
      title: "Skipped — travel",
      startedAt: new Date(),
      status: "skipped",
      source: "manual",
      exercises: [],
    });

    expect(mockGetMembership).not.toHaveBeenCalled();
    expect(links).toHaveLength(0);
  });
});

// ── appendBaselineToDayWorkout (gotcha §E.2 — bypasses createWorkoutCore) ────

describe("appendBaselineToDayWorkout auto-link wiring (#307)", () => {
  it("the direct workout.create path links via hint match (baseline testName canonicalizes to the hinted movement)", async () => {
    mockGetMembership.mockResolvedValue(MEMBERSHIP);
    const { links } = makeFakeDb();
    const date = new Date("2026-08-10T17:00:00Z");

    // "Pull-Up Max Reps" canonicalizes to "Pull-Up" — hinted on g-handstand.
    // The source:"baseline" rule also links g-cut (amendment-1 rules apply to
    // baseline mirrors exactly like any other workout).
    await appendBaselineToDayWorkout({
      testName: "Pull-Up Max Reps",
      value: 12,
      units: "reps",
      date,
    });

    expect(links.map((l) => l.goalId).sort()).toEqual(["g-cut", "g-handstand"]);
    for (const l of links) {
      expect(l).toMatchObject({
        activityType: "workout",
        activityId: "w-created",
        source: "auto",
        userId: "usr_test",
      });
      expect(l.activityDate).toEqual(startOfDay(date));
    }
  });

  it("the append-to-existing path evaluates the NEW test and links the existing mirror workout", async () => {
    mockGetMembership.mockResolvedValue(MEMBERSHIP);
    const { db, links } = makeFakeDb();
    db.workout.findFirst.mockResolvedValue({ id: "w-existing", exercises: [{ id: "we-1" }] });
    const date = new Date("2026-08-10T17:30:00Z");

    await appendBaselineToDayWorkout({
      testName: "Wall Handstand Hold",
      value: 40,
      units: "sec",
      date,
    });

    expect(mockPrisma.workoutExercise.create).toHaveBeenCalledTimes(1);
    expect(links.map((l) => ({ id: l.activityId, goal: l.goalId }))).toEqual(
      expect.arrayContaining([
        { id: "w-existing", goal: "g-handstand" },
        { id: "w-existing", goal: "g-cut" }, // source:"baseline" rule
      ]),
    );
  });

  it("placeholder rows (value=0) never create a workout or links", async () => {
    mockGetMembership.mockResolvedValue(MEMBERSHIP);
    const { db, links } = makeFakeDb();

    const out = await appendBaselineToDayWorkout({
      testName: "Pull-Up Max Reps",
      value: 0,
      units: "reps",
      date: new Date(),
    });

    expect(out).toBeNull();
    expect(db.workout.create).not.toHaveBeenCalled();
    expect(links).toHaveLength(0);
  });

  it("no active Program → mirror workout created, zero links", async () => {
    mockGetMembership.mockResolvedValue(null);
    const { db, links } = makeFakeDb();

    await appendBaselineToDayWorkout({
      testName: "Pull-Up Max Reps",
      value: 12,
      units: "reps",
      date: new Date(),
    });

    expect(db.workout.create).toHaveBeenCalledTimes(1);
    expect(links).toHaveLength(0);
  });
});
