// src/lib/day-log-actions.test.ts
//
// S7 (Goal Story & Time-Aware History, Stage B1) coverage for skipDay's
// independent server-side write guard. Per the architecture critique (D5):
// SkipDayControl's ONE caller hardcodes `isInPlan: true` in the payload it
// sends regardless of the real prop value, so the pre-existing
// `if (!input.isInPlan) throw` guard was never actually independent of the
// client. skipDay now re-derives the active plan's window server-side
// (getActiveProgram + isDateWithinActivePlanWindow) instead of trusting the
// caller's isInPlan boolean for that check.
//
// House convention: vi.mock("@/lib/db") dual-export (prisma + getDb) — not
// needed here since day-log-actions.ts only imports getDb (no raw prisma).
// @/lib/program is mocked per-test so fixtures can control the active plan's
// window without a real DB round-trip (mirrors day-actions.test.ts).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { mockFindFirst, mockUpdate, mockGetDb } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockUpdate: vi.fn(),
  mockGetDb: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: mockGetDb,
}));

const { mockCreateWorkoutCore, mockDeleteWorkoutsCore } = vi.hoisted(() => ({
  mockCreateWorkoutCore: vi.fn(),
  mockDeleteWorkoutsCore: vi.fn(),
}));
vi.mock("@/lib/workout-core", () => ({
  createWorkoutCore: mockCreateWorkoutCore,
  deleteWorkoutsCore: mockDeleteWorkoutsCore,
}));

// Imported by day-log-actions.ts but not exercised by skipDay — stub so the
// module import doesn't pull in the real hike-core dependency graph.
vi.mock("@/lib/hike-core", () => ({ logHikeCore: vi.fn() }));

const mockGetActiveProgram = vi.hoisted(() => vi.fn());
vi.mock("@/lib/program", () => ({ getActiveProgram: mockGetActiveProgram }));

import { skipDay } from "@/lib/day-log-actions";
import { parseDateKey } from "@/lib/calendar";
import type { ActiveProgramSnapshot } from "@/lib/program";
import type { ProgramTemplate } from "@/lib/program-template";

// PROGRAM covers 2026-01-05 .. 2026-03-29 (startedOn + 12 weeks * 7 - 1 days).
const PROGRAM: ActiveProgramSnapshot = {
  id: "plan-1",
  name: "Test Program",
  startedOn: parseDateKey("2026-01-05"),
  confirmedThroughDate: null,
  template: {
    name: "Test",
    totalWeeks: 12,
    phases: [],
    weeklySplit: [],
    baselineWeek: [],
    hikingSuperset: { type: "straight", exercises: [] },
    dailyMobility: { durationMin: 10, exercises: [] },
    goals: [],
  } as unknown as ProgramTemplate,
};

const COVERED_DATE_KEY = "2026-01-06";
const BEFORE_START_KEY = "2026-01-01";
const AFTER_WINDOW_KEY = "2026-04-01";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActiveProgram.mockResolvedValue(PROGRAM);
  mockFindFirst.mockResolvedValue(null); // no existing skipped workout
  mockUpdate.mockResolvedValue({ id: "existing-1" });
  mockCreateWorkoutCore.mockResolvedValue({ id: "new-workout-1" });
  mockGetDb.mockResolvedValue({
    workout: { findFirst: mockFindFirst, update: mockUpdate },
  });
});

describe("skipDay — S7 server-side write guard (independent of client isInPlan)", () => {
  it("a date covered by the active plan's window passes, even though the caller's isInPlan boolean is hardcoded true by SkipDayControl (mirrors the real client payload)", async () => {
    await expect(
      skipDay({
        dateKey: COVERED_DATE_KEY,
        reason: null,
        templateTitle: "Lower A",
        isRestDay: false,
        isInPlan: true, // SkipDayControl's handleSkip() always sends this
      }),
    ).resolves.toEqual({ id: "new-workout-1" });
    expect(mockCreateWorkoutCore).toHaveBeenCalledTimes(1);
  });

  it("a date before the active plan's startedOn is rejected, even though the client claims isInPlan:true", async () => {
    await expect(
      skipDay({
        dateKey: BEFORE_START_KEY,
        reason: null,
        templateTitle: "Lower A",
        isRestDay: false,
        isInPlan: true, // client lied (or the page's isInPlan wiring was wrong) — server must not trust it
      }),
    ).rejects.toThrowError(/outside the active plan/);
    expect(mockCreateWorkoutCore).not.toHaveBeenCalled();
  });

  it("a date past the active plan's totalWeeks window is rejected, even though the client claims isInPlan:true", async () => {
    await expect(
      skipDay({
        dateKey: AFTER_WINDOW_KEY,
        reason: null,
        templateTitle: "Lower A",
        isRestDay: false,
        isInPlan: true,
      }),
    ).rejects.toThrowError(/outside the active plan/);
    expect(mockCreateWorkoutCore).not.toHaveBeenCalled();
  });

  it("no active plan at all is rejected with the same message, not a null-pointer crash", async () => {
    mockGetActiveProgram.mockResolvedValue(null);
    await expect(
      skipDay({
        dateKey: COVERED_DATE_KEY,
        reason: null,
        templateTitle: "Lower A",
        isRestDay: false,
        isInPlan: true,
      }),
    ).rejects.toThrowError(/outside the active plan/);
    expect(mockCreateWorkoutCore).not.toHaveBeenCalled();
  });
});
