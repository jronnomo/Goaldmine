// src/lib/db.scoped.test.ts
// Unit tests for the ALS-scoped Prisma client (E4a-1).
//
// Strategy: test `injectUserId` as a pure function — no DB, no Prisma queries,
// no network calls. The extension in `_makeExtension` delegates to `injectUserId`,
// so proving the helper is correct proves the extension logic is correct.
//
// `forUser()` smoke tests verify the factory doesn't throw and memoizes correctly.
// The real Prisma `$extends` is used here — it is synchronous and creates no DB
// connection. `DATABASE_URL` is set to a placeholder in vitest.config.ts so that
// db.ts can initialize; `forUser` never issues a real query.
//
// These tests require NO live database and NO DATABASE_URL pointing at real data.

import { describe, it, expect } from "vitest";
import { injectUserId, forUser } from "@/lib/db";

const USER = "usr_test";

// ---------------------------------------------------------------------------
// injectUserId — scoped model injection
// ---------------------------------------------------------------------------

describe("injectUserId — scoped model (Workout)", () => {
  it("findMany: injects userId into where (merges with existing filter)", () => {
    const args = { where: { status: "completed" } };
    const result = injectUserId("Workout", "findMany", args, USER);
    expect(result.where).toEqual({ status: "completed", userId: USER });
  });

  it("findUnique: injects userId into where (ownership filter alongside unique key)", () => {
    const args = { where: { id: "wkt_1" } };
    const result = injectUserId("Workout", "findUnique", args, USER);
    expect(result.where).toEqual({ id: "wkt_1", userId: USER });
  });

  it("findUnique: where absent → creates where with userId", () => {
    const args: Record<string, unknown> = {};
    const result = injectUserId("Workout", "findUnique", args, USER);
    expect(result.where).toEqual({ userId: USER });
  });

  it("findUniqueOrThrow: injects userId into where", () => {
    const args = { where: { id: "wkt_2" } };
    const result = injectUserId("Workout", "findUniqueOrThrow", args, USER);
    expect((result.where as Record<string, unknown>).userId).toBe(USER);
    expect((result.where as Record<string, unknown>).id).toBe("wkt_2");
  });

  it("findFirst: injects userId into where", () => {
    const args = { where: { goalId: "g1" }, orderBy: { startedAt: "desc" } };
    const result = injectUserId("Workout", "findFirst", args, USER);
    expect((result.where as Record<string, unknown>).userId).toBe(USER);
    expect((result.where as Record<string, unknown>).goalId).toBe("g1");
  });

  it("findFirstOrThrow: injects userId into where", () => {
    const args = { where: { goalId: "g2" } };
    const result = injectUserId("Workout", "findFirstOrThrow", args, USER);
    expect((result.where as Record<string, unknown>).userId).toBe(USER);
  });

  it("count: injects userId into where", () => {
    const args = { where: { status: "completed" } };
    const result = injectUserId("Workout", "count", args, USER);
    expect((result.where as Record<string, unknown>).userId).toBe(USER);
  });

  it("aggregate: injects userId into where (where was absent → creates it)", () => {
    const args: Record<string, unknown> = { _sum: { durationMinutes: true } };
    const result = injectUserId("Workout", "aggregate", args, USER);
    expect(result.where).toEqual({ userId: USER });
  });

  it("groupBy: injects userId into where", () => {
    const args = { by: ["status"], where: { goalId: "g1" } };
    const result = injectUserId("Workout", "groupBy", args, USER);
    expect((result.where as Record<string, unknown>).userId).toBe(USER);
  });

  it("create: injects userId into data (merges with existing fields)", () => {
    const args = { data: { name: "Leg Day", startedAt: new Date() } };
    const result = injectUserId("Workout", "create", args, USER);
    const data = result.data as Record<string, unknown>;
    expect(data.userId).toBe(USER);
    expect(data.name).toBe("Leg Day");
  });

  it("createMany: injects userId into each row when data is an array", () => {
    const args = {
      data: [
        { name: "A", startedAt: new Date() },
        { name: "B", startedAt: new Date() },
      ],
    };
    const result = injectUserId("Workout", "createMany", args, USER);
    const rows = result.data as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0].userId).toBe(USER);
    expect(rows[1].userId).toBe(USER);
    expect(rows[0].name).toBe("A");
  });

  it("createMany: injects userId when data is a single object (not array)", () => {
    const args = { data: { name: "Solo", startedAt: new Date() } };
    const result = injectUserId("Workout", "createMany", args, USER);
    const data = result.data as Record<string, unknown>;
    expect(data.userId).toBe(USER);
    expect(data.name).toBe("Solo");
  });

  it("createManyAndReturn: same injection as createMany (array case)", () => {
    const args = { data: [{ name: "X" }] };
    const result = injectUserId("Workout", "createManyAndReturn", args, USER);
    expect((result.data as Array<Record<string, unknown>>)[0].userId).toBe(USER);
  });

  it("update: injects userId into where (NOT into data)", () => {
    const args = { where: { id: "wkt_1" }, data: { status: "completed" } };
    const result = injectUserId("Workout", "update", args, USER);
    expect((result.where as Record<string, unknown>).userId).toBe(USER);
    expect((result.data as Record<string, unknown>).userId).toBeUndefined();
  });

  it("updateMany: injects userId into where", () => {
    const args = { where: { goalId: "g1" }, data: { status: "skipped" } };
    const result = injectUserId("Workout", "updateMany", args, USER);
    expect((result.where as Record<string, unknown>).userId).toBe(USER);
  });

  it("updateManyAndReturn: injects userId into where", () => {
    const args = { where: { goalId: "g1" }, data: { status: "skipped" } };
    const result = injectUserId("Workout", "updateManyAndReturn", args, USER);
    expect((result.where as Record<string, unknown>).userId).toBe(USER);
  });

  it("delete: injects userId into where", () => {
    const args = { where: { id: "wkt_1" } };
    const result = injectUserId("Workout", "delete", args, USER);
    expect((result.where as Record<string, unknown>).userId).toBe(USER);
  });

  it("deleteMany: injects userId into where", () => {
    const args = { where: { goalId: "g1" } };
    const result = injectUserId("Workout", "deleteMany", args, USER);
    expect((result.where as Record<string, unknown>).userId).toBe(USER);
  });

  it("upsert: injects userId into where AND create, NOT update", () => {
    const args = {
      where: { id: "wkt_1" },
      create: { name: "New", startedAt: new Date() },
      update: { status: "completed" },
    };
    const result = injectUserId("Workout", "upsert", args, USER);
    expect((result.where as Record<string, unknown>).userId).toBe(USER);
    expect((result.create as Record<string, unknown>).userId).toBe(USER);
    // update must be untouched — ownership must not be rewritten on match
    expect((result.update as Record<string, unknown>).userId).toBeUndefined();
  });

  it("unknown future operation: passes through untouched (safe default)", () => {
    const args = { where: { id: "wkt_1" } };
    const result = injectUserId("Workout", "someNewOp", args, USER);
    // No userId injected — safe passthrough for ops not in the matrix
    expect((result.where as Record<string, unknown>).userId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// injectUserId — FoodUsage (scoped model — E-1)
// ---------------------------------------------------------------------------

describe("injectUserId — FoodUsage (scoped model, E-1)", () => {
  it("findMany: injects userId into where (scoped model)", () => {
    const args = { where: { foodId: "food_1" } };
    const result = injectUserId("FoodUsage", "findMany", args, USER);
    expect((result.where as Record<string, unknown>).userId).toBe(USER);
    expect((result.where as Record<string, unknown>).foodId).toBe("food_1");
  });

  it("findFirst: injects userId into where (per-user row lookup)", () => {
    const args = { where: { foodId: "food_1" } };
    const result = injectUserId("FoodUsage", "findFirst", args, USER);
    expect((result.where as Record<string, unknown>).userId).toBe(USER);
    expect((result.where as Record<string, unknown>).foodId).toBe("food_1");
  });

  it("create: injects userId into data", () => {
    const args = { data: { foodId: "food_1", usageCount: 1 } };
    const result = injectUserId("FoodUsage", "create", args, USER);
    expect((result.data as Record<string, unknown>).userId).toBe(USER);
    expect((result.data as Record<string, unknown>).foodId).toBe("food_1");
  });

  it("update: injects userId into where (NOT into data — ownership guard)", () => {
    const args = { where: { id: "fu_1" }, data: { usageCount: { increment: 1 } } };
    const result = injectUserId("FoodUsage", "update", args, USER);
    expect((result.where as Record<string, unknown>).userId).toBe(USER);
    expect((result.data as Record<string, unknown>).userId).toBeUndefined();
  });

  it("deleteMany: injects userId into where (per-user delete)", () => {
    const args = { where: { foodId: "food_1" } };
    const result = injectUserId("FoodUsage", "deleteMany", args, USER);
    expect((result.where as Record<string, unknown>).userId).toBe(USER);
    expect((result.where as Record<string, unknown>).foodId).toBe("food_1");
  });
});

// ---------------------------------------------------------------------------
// injectUserId — NON-scoped models must pass through untouched
// ---------------------------------------------------------------------------

describe("injectUserId — non-scoped models", () => {
  it("WorkoutExercise: passes through without injecting userId (findMany)", () => {
    const args = { where: { workoutId: "wkt_1" } };
    const result = injectUserId("WorkoutExercise", "findMany", args, USER);
    expect((result.where as Record<string, unknown>).userId).toBeUndefined();
    expect(result).toBe(args); // same reference — pure passthrough
  });

  it("User: passes through without injecting userId (findUnique by email)", () => {
    const args = { where: { email: "coach@example.com" } };
    const result = injectUserId("User", "findUnique", args, USER);
    expect((result.where as Record<string, unknown>).userId).toBeUndefined();
  });

  it("FoodLibrary: passes through without injecting userId (shared catalog)", () => {
    const args = { where: { barcode: "123456789" } };
    const result = injectUserId("FoodLibrary", "findFirst", args, USER);
    expect((result.where as Record<string, unknown>).userId).toBeUndefined();
  });

  it("Set: passes through without injecting userId (create)", () => {
    const args = { data: { reps: 10, weight: 135, workoutExerciseId: "we_1" } };
    const result = injectUserId("Set", "create", args, USER);
    expect((result.data as Record<string, unknown>).userId).toBeUndefined();
  });

  it("PlanDayOverride: passes through without injecting userId", () => {
    const args = { where: { planId: "p1", date: "2026-07-01" } };
    const result = injectUserId("PlanDayOverride", "findFirst", args, USER);
    expect((result.where as Record<string, unknown>).userId).toBeUndefined();
  });

  it("PlanRevision: passes through without injecting userId", () => {
    const args = { data: { planId: "p1", reason: "rest swap" } };
    const result = injectUserId("PlanRevision", "create", args, USER);
    expect((result.data as Record<string, unknown>).userId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// forUser — smoke test (factory doesn't throw; memoization is correct)
//
// The real Prisma $extends is called here (no DB query — $extends is
// synchronous and just wraps the client). DATABASE_URL is the placeholder
// set in vitest.config.ts so db.ts initializes without throwing.
// ---------------------------------------------------------------------------

describe("forUser — memoization smoke", () => {
  it("returns a client-like object without throwing", () => {
    const client = forUser("usr_smoke");
    expect(client).toBeDefined();
    expect(typeof client).toBe("object");
  });

  it("memoizes: same userId returns the same object reference", () => {
    const a = forUser("usr_memo");
    const b = forUser("usr_memo");
    expect(a).toBe(b);
  });

  it("different userIds return different objects", () => {
    const a = forUser("usr_aaa");
    const b = forUser("usr_bbb");
    expect(a).not.toBe(b);
  });
});
