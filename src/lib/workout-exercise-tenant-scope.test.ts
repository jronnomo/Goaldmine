// src/lib/workout-exercise-tenant-scope.test.ts
//
// Two-tenant isolation proof for the WorkoutExercise read paths (2026-08
// security fix). WorkoutExercise/Set have no userId FK, so the ScopedClient
// extension can NOT inject the tenant filter — every raw
// `prisma.workoutExercise.findMany` must hand-scope via `workout: { userId }`.
//
// Strategy (house convention: vi.mock("@/lib/db") with fakes): the fake
// findMany implements a mini query engine over a TWO-TENANT fixture set that
// honors exactly the filters these queries use — critically, it applies the
// `workout.userId` filter ONLY when the query provides one. Strip the tenant
// scope from any production query and tenant B's rows flow straight back into
// tenant A's results, failing these assertions (this is how the pre-fix leak
// behaved in production).
//
// Covered paths (tenant A = "usr_a", tenant B = "usr_b"; B holds the bigger
// numbers so any leak inflates A's results detectably):
//   - getExerciseSummaries()            → /progress, records, recap, MCP get_records_summary
//   - getExerciseHistory()              → exercise pages, rarity, MCP get_exercise_history
//   - recordsSetInWorkout()             → PR detection on log_workout
//   - lastTrainedForGoals()             → goals pages, MCP list_goals/get_goal
//   - resolveMetricValue("exercise:*")  → readiness (goal-targets.ts)

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    workoutExercise: { findMany: vi.fn() },
  },
  getDb: vi.fn(async () => ({})), // exercise:* branch never touches the scoped client
  getScopedUserId: vi.fn(async () => "usr_a"), // the session tenant under test
}));

import { prisma, getScopedUserId } from "@/lib/db";
import {
  getExerciseSummaries,
  getExerciseHistory,
  recordsSetInWorkout,
} from "@/lib/records";
import { lastTrainedForGoals } from "@/lib/goal-attribution";
import { resolveMetricValue } from "@/lib/goal-targets";

// ── Two-tenant fixture set ────────────────────────────────────────────────────
// Epley 1RM = weightLb * (1 + reps/30):
//   A: 185x5 → 215.83…, 190x5 → 221.66…   B: 315x5 → 367.5

type FixtureRow = {
  id: string;
  workoutId: string;
  name: string;
  equipment: string | null;
  workout: { id: string; userId: string; startedAt: Date; title: string; status: string };
  sets: Array<{
    setIndex: number;
    reps: number | null;
    weightLb: number | null;
    durationSec: number | null;
    distanceMi: number | null;
  }>;
};

const mkSet = (weightLb: number, reps: number) => ({
  setIndex: 1,
  reps,
  weightLb,
  durationSec: null,
  distanceMi: null,
});

const W_A1 = { id: "w_a1", userId: "usr_a", startedAt: new Date("2026-01-05T10:00:00Z"), title: "A upper 1", status: "completed" };
const W_A2 = { id: "w_a2", userId: "usr_a", startedAt: new Date("2026-01-10T10:00:00Z"), title: "A upper 2", status: "completed" };
const W_B1 = { id: "w_b1", userId: "usr_b", startedAt: new Date("2026-02-20T10:00:00Z"), title: "B upper", status: "completed" };

const FIXTURES: FixtureRow[] = [
  { id: "ex_a1", workoutId: "w_a1", name: "Bench Press", equipment: "Barbell", workout: W_A1, sets: [mkSet(185, 5)] },
  { id: "ex_a2", workoutId: "w_a2", name: "Bench Press", equipment: "Barbell", workout: W_A2, sets: [mkSet(190, 5)] },
  // Tenant B: stronger bench AND a movement A never trained.
  { id: "ex_b1", workoutId: "w_b1", name: "Bench Press", equipment: "Barbell", workout: W_B1, sets: [mkSet(315, 5)] },
  { id: "ex_b2", workoutId: "w_b1", name: "Deadlift", equipment: "Barbell", workout: W_B1, sets: [mkSet(405, 3)] },
];

// ── Mini query engine over the fixtures ──────────────────────────────────────
// Honors: where.workoutId, where.name.in (insensitive), where.workout.userId,
// where.workout.id.not, where.workout.status, where.workout.startedAt.lte,
// orderBy { workout: { startedAt } }. Tenant filter applies ONLY when present —
// its absence reproduces the leak.

/* eslint-disable @typescript-eslint/no-explicit-any */
function fakeFindMany(args: any): FixtureRow[] {
  let rows = [...FIXTURES];
  const where = args?.where ?? {};

  if (where.workoutId !== undefined) rows = rows.filter((r) => r.workoutId === where.workoutId);
  if (where.name?.in !== undefined) {
    const wanted = new Set((where.name.in as string[]).map((n) => n.toLowerCase()));
    rows = rows.filter((r) => wanted.has(r.name.toLowerCase()));
  }
  const w = where.workout;
  if (w) {
    if (w.userId !== undefined) rows = rows.filter((r) => r.workout.userId === w.userId);
    if (w.id?.not !== undefined) rows = rows.filter((r) => r.workout.id !== w.id.not);
    if (w.status !== undefined) rows = rows.filter((r) => r.workout.status === w.status);
    if (w.startedAt?.lte !== undefined) rows = rows.filter((r) => r.workout.startedAt <= w.startedAt.lte);
  }

  const ob = args?.orderBy;
  const dirOf = (o: any) => o?.workout?.startedAt as "asc" | "desc" | undefined;
  const dir = Array.isArray(ob) ? ob.map(dirOf).find(Boolean) : dirOf(ob);
  if (dir) {
    rows.sort((a, b) =>
      dir === "asc"
        ? a.workout.startedAt.getTime() - b.workout.startedAt.getTime()
        : b.workout.startedAt.getTime() - a.workout.startedAt.getTime(),
    );
  }
  // Rows are a superset of every select/include these queries use.
  return rows.map((r) => ({ ...r, workout: { ...r.workout }, sets: r.sets.map((s) => ({ ...s })) }));
}

const mockFindMany = (prisma as any).workoutExercise.findMany;
/* eslint-enable @typescript-eslint/no-explicit-any */

beforeEach(() => {
  vi.clearAllMocks();
  mockFindMany.mockImplementation(async (args: unknown) => fakeFindMany(args));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (getScopedUserId as any).mockResolvedValue("usr_a");
});

// ── getExerciseSummaries ─────────────────────────────────────────────────────

describe("getExerciseSummaries — tenant A never sees tenant B rows", () => {
  it("excludes B-only movements and B's bigger bench from A's summaries", async () => {
    const summaries = await getExerciseSummaries();

    // B-only movement must not exist in A's records at all.
    expect(summaries.map((s) => s.name)).not.toContain("Deadlift");

    // A's bench best is A's own 190x5 (epley 221.67) — not B's 315x5 (367.5).
    const bench = summaries.find((s) => s.name === "Bench Press");
    expect(bench).toBeDefined();
    expect(bench!.bestValue).toBeCloseTo(190 * (1 + 5 / 30), 2);
    expect(bench!.sessionCount).toBe(2); // w_a1 + w_a2 only, not w_b1
    expect(bench!.totalSets).toBe(2);
    expect(bench!.bestDate).toEqual(W_A2.startedAt);
  });

  it("tenant B sees only its own rows (scope follows the session user)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (getScopedUserId as any).mockResolvedValue("usr_b");
    const summaries = await getExerciseSummaries();
    expect(summaries.map((s) => s.name).sort()).toEqual(["Bench Press", "Deadlift"]);
    const bench = summaries.find((s) => s.name === "Bench Press");
    expect(bench!.sessionCount).toBe(1);
    expect(bench!.bestValue).toBeCloseTo(315 * (1 + 5 / 30), 2);
  });
});

// ── getExerciseHistory ───────────────────────────────────────────────────────

describe("getExerciseHistory — tenant A never sees tenant B rows", () => {
  it("A's bench history contains only A's workouts", async () => {
    const { summary, history } = await getExerciseHistory("Bench Press");
    expect(history.map((p) => p.workoutId)).toEqual(["w_a1", "w_a2"]);
    expect(history.map((p) => p.best)).toEqual([
      expect.closeTo(185 * (1 + 5 / 30), 2),
      expect.closeTo(190 * (1 + 5 / 30), 2),
    ]);
    expect(summary!.bestValue).toBeCloseTo(190 * (1 + 5 / 30), 2);
    expect(summary!.sessionCount).toBe(2);
  });

  it("a movement only tenant B trained reads as no data for A", async () => {
    const { summary, history } = await getExerciseHistory("Deadlift");
    expect(summary).toBeNull();
    expect(history).toEqual([]);
  });
});

// ── recordsSetInWorkout ──────────────────────────────────────────────────────

describe("recordsSetInWorkout — PR baseline excludes other tenants", () => {
  it("A's 190x5 IS a PR over A's prior 185x5 even though B benched 315x5", async () => {
    // Pre-fix: B's 315 entered the prior baseline → 190 was "not a PR"
    // (false suppression) and B's number surfaced as `prior`.
    const records = await recordsSetInWorkout("w_a2");
    expect(records).toHaveLength(1);
    expect(records[0]!.name).toBe("Bench Press");
    expect(records[0]!.value).toBeCloseTo(190 * (1 + 5 / 30), 2);
    expect(records[0]!.prior).toBeCloseTo(185 * (1 + 5 / 30), 2); // A's prior — never B's 367.5
  });

  it("a foreign workoutId resolves to zero exercises (fail-closed)", async () => {
    // w_b1 belongs to tenant B; the session user is tenant A.
    const records = await recordsSetInWorkout("w_b1");
    expect(records).toEqual([]);
  });
});

// ── lastTrainedForGoals ──────────────────────────────────────────────────────

describe("lastTrainedForGoals — 'last trained' never reads another tenant's workouts", () => {
  it("returns A's own latest bench date, not B's more recent one", async () => {
    const map = await lastTrainedForGoals([
      { id: "goal_1", attributionHints: ["Bench Press"] },
    ]);
    // Pre-fix this returned W_B1.startedAt (2026-02-20) — B trained more recently.
    expect(map.get("goal_1")).toEqual(W_A2.startedAt);
  });

  it("a hint only tenant B trained resolves to null for A", async () => {
    const map = await lastTrainedForGoals([
      { id: "goal_1", attributionHints: ["Deadlift"] },
    ]);
    expect(map.get("goal_1")).toBeNull();
  });
});

// ── exercise:* readiness resolution (goal-targets.ts) ───────────────────────

describe("resolveMetricValue exercise:* — readiness computes over A's history only", () => {
  it("resolves A's latest bench best, not B's", async () => {
    const asOf = new Date("2026-03-01T00:00:00Z"); // after every fixture workout
    const value = await resolveMetricValue("exercise:Bench Press", asOf, "goal_1");
    expect(value).toBeCloseTo(190 * (1 + 5 / 30), 2); // A's latest
    expect(value).not.toBeCloseTo(315 * (1 + 5 / 30), 2); // never B's
  });

  it("resolves null for a movement A never trained (untested, not B's value)", async () => {
    const value = await resolveMetricValue("exercise:Deadlift", new Date("2026-03-01T00:00:00Z"), "goal_1");
    expect(value).toBeNull();
  });
});

// ── Regression tripwire on the query shape itself ────────────────────────────

describe("tenant filter is actually sent to the DB layer", () => {
  it("every workoutExercise.findMany issued by these paths carries workout.userId", async () => {
    await getExerciseSummaries();
    await getExerciseHistory("Bench Press");
    await recordsSetInWorkout("w_a2");
    await lastTrainedForGoals([{ id: "g", attributionHints: ["Bench Press"] }]);

    expect(mockFindMany.mock.calls.length).toBeGreaterThanOrEqual(5); // recordsSetInWorkout issues 2
    for (const [args] of mockFindMany.mock.calls) {
      expect(args?.where?.workout?.userId).toBe("usr_a");
    }
  });
});
