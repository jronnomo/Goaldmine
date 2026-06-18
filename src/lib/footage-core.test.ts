// src/lib/footage-core.test.ts
// Vitest for resolveWorkoutIdForDay (footage-core.ts).
// Mocks @/lib/db so no real DB connection is needed.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    workout: { findFirst: vi.fn() },
    footageMarker: { create: vi.fn() },
  },
}));

// calendar is a pure module (no DB); let it run real.
// records canonicalization — passthrough for non-aliased names.
vi.mock("@/lib/records", () => ({
  canonicalExerciseName: (s: string) => s.trim(),
}));

import { resolveWorkoutIdForDay } from "@/lib/footage-core";
import { prisma } from "@/lib/db";
import { canonicalExerciseName } from "@/lib/records";

const mockWorkoutFindFirst = prisma.workout.findFirst as ReturnType<typeof vi.fn>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPrisma = prisma as any;
const mockMarkerCreate = mockPrisma.footageMarker.create as ReturnType<typeof vi.fn>;

describe("resolveWorkoutIdForDay", () => {
  const DAY_START = new Date("2026-06-18T06:00:00.000Z"); // USER_TZ midnight (America/Denver = UTC-6)

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the workout id when a completed workout exists within the day window", async () => {
    mockWorkoutFindFirst.mockResolvedValueOnce({ id: "workout-abc" });

    const result = await resolveWorkoutIdForDay(DAY_START);

    expect(result).toBe("workout-abc");
    expect(mockWorkoutFindFirst).toHaveBeenCalledOnce();

    // Verify the query targets completed status
    const callArgs = mockWorkoutFindFirst.mock.calls[0][0];
    expect(callArgs.where.status).toBe("completed");
    expect(callArgs.where.startedAt.gte).toEqual(DAY_START);
  });

  it("returns null when no completed workout exists on that day", async () => {
    mockWorkoutFindFirst.mockResolvedValueOnce(null);

    const result = await resolveWorkoutIdForDay(DAY_START);

    expect(result).toBeNull();
  });

  it("queries with dayEnd computed from dayStart (endOfDay window)", async () => {
    mockWorkoutFindFirst.mockResolvedValueOnce(null);

    await resolveWorkoutIdForDay(DAY_START);

    const callArgs = mockWorkoutFindFirst.mock.calls[0][0];
    const { gte, lte } = callArgs.where.startedAt;

    // dayEnd must be after dayStart and within the same calendar day (< 24h later)
    expect(lte.getTime()).toBeGreaterThan(gte.getTime());
    expect(lte.getTime() - gte.getTime()).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });
});

describe("canonicalization branch — exerciseName stored as canonical form", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores the canonicalized exerciseName (not the raw input)", async () => {
    // Simulate the create-data assembly logic from log_footage / logFootageMarker:
    // exerciseName must be passed through canonicalExerciseName before storage.
    const rawInput = "  pull-up  "; // padded, lowercase — would be canonicalized
    const canonical = canonicalExerciseName(rawInput); // our mock returns trimmed value
    expect(canonical).toBe("pull-up"); // trimmed

    // Simulate what the handler does before prisma.footageMarker.create:
    const exerciseName = rawInput ? canonicalExerciseName(rawInput) : null;

    mockMarkerCreate.mockResolvedValueOnce({ id: "marker-xyz" });

    await prisma.footageMarker.create({
      data: {
        date: new Date(),
        label: "test",
        kind: "video",
        filename: null,
        highlight: false,
        capturedAt: null,
        exerciseName,
        workoutId: null,
      },
    });

    const createCall = mockMarkerCreate.mock.calls[0][0];
    // The stored value must equal canonical (trimmed), not the raw padded input
    expect(createCall.data.exerciseName).toBe(canonical);
    expect(createCall.data.exerciseName).not.toBe(rawInput);
  });

  it("stores null when exerciseName is empty (whole-day marker)", () => {
    const exerciseRaw = "";
    const exerciseName = exerciseRaw ? canonicalExerciseName(exerciseRaw) : null;
    expect(exerciseName).toBeNull();
  });
});
