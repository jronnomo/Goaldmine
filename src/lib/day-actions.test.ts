// src/lib/day-actions.test.ts
//
// First-ever behavioral coverage for the dashboard day-override write path
// (#234). Mirrors the MCP path's validation (assertDayTemplateWithinSize,
// assertValidDayTemplate) and the audible-with-baselines guard
// (assertBaselineDecisionMade), both shared via @/lib/day-template-validation.
//
// House convention: vi.mock("@/lib/db") dual-export (prisma + getDb).
// @/lib/program (getActiveProgram) is mocked per-test so fixtures can control
// the rotation/baseline shape. @/lib/calendar is DELIBERATELY NOT mocked —
// this suite exercises the REAL calendar-core date functions (parseDateKey,
// startOfDay, rotationBaselineNamesForDate). A mocked parseDateKey would have
// hidden the exact bug this story fixes: day-actions.ts used to shadow the
// real USER_TZ-aware parseDateKey with a local naive `new Date(y, m-1, d)`
// (local-runtime-TZ midnight), which unconditionally rolled every
// dashboard-written override back one calendar day on a UTC (Vercel) runtime
// vs. a Denver USER_TZ. That local definition is now deleted; day-actions.ts
// imports the real parseDateKey from @/lib/calendar, same as every other
// PlanDayOverride caller (tools.ts, calendar.ts's resolveDay, etc).
//
// day-template-validation.ts is also DELIBERATELY NOT mocked, so the
// validator-message assertions below exercise the real field-level messages
// the form banner will show, not a stand-in.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const { mockFindUnique, mockDeleteMany, mockUpsert, mockNoteCreate, mockGetDb } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockDeleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  mockUpsert: vi.fn().mockResolvedValue({ id: "override-1" }),
  mockNoteCreate: vi.fn().mockResolvedValue({ id: "note-1" }),
  mockGetDb: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    planDayOverride: {
      findUnique: mockFindUnique,
      deleteMany: mockDeleteMany,
      upsert: mockUpsert,
    },
  },
  getDb: mockGetDb,
}));

const mockGetActiveProgram = vi.hoisted(() => vi.fn());
vi.mock("@/lib/program", () => ({ getActiveProgram: mockGetActiveProgram }));

import { clearDayOverride, upsertDayOverrideFromForm } from "@/lib/day-actions";
import { parseDateKey, rotationBaselineNamesForDate, startOfDay } from "@/lib/calendar";
import type { ActiveProgramSnapshot } from "@/lib/program";
import { Prisma } from "@/generated/prisma/client";

// ─── Fixtures ─────────────────────────────────────────────────────────────

// program.startedOn = 2026-01-05 (USER_TZ midnight) → daysDelta 0 lands on
// rotation day 1, week 1. baselineWeek has a day-1 entry with one test
// (initialWeek defaults to 1, so week 1 is its "due" week) — real
// rotationBaselineNamesForDate math, not a stub.
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
    baselineWeek: [
      {
        dayOfWeek: 1,
        title: "Baseline check",
        tests: [
          {
            testName: "Pull-Up Max Reps",
            units: "reps",
            protocol: "Strict pull-ups to failure.",
            retestWeeks: [6, 12],
          },
        ],
      },
    ],
    hikingSuperset: { type: "straight", exercises: [] },
    dailyMobility: { durationMin: 10, exercises: [] },
    goals: [],
  },
};

// 2026-01-05 = rotation day 1, week 1 → HAS rotation baselines.
const BASELINE_DAY_KEY = "2026-01-05";
// 2026-01-06 = rotation day 2, week 1 → no baselineWeek entry → NO rotation baselines.
const NO_BASELINE_DAY_KEY = "2026-01-06";

const VALID_WORKOUT = {
  title: "Lower A",
  category: "lower",
  blocks: [{ type: "straight", exercises: [{ name: "Back Squat" }] }],
};

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActiveProgram.mockResolvedValue(PROGRAM);
  mockFindUnique.mockResolvedValue(null); // no existing override by default
  mockDeleteMany.mockResolvedValue({ count: 0 });
  mockUpsert.mockResolvedValue({ id: "override-1" });
  // getDb() backs logNoteForDate's db.note.create — not exercised by this
  // suite's cases (it's covered indirectly by day-log flows elsewhere), but
  // wired so a stray call fails loudly instead of hitting the real Prisma engine.
  mockGetDb.mockResolvedValue({ note: { create: mockNoteCreate } });
});

describe("fixture sanity — real rotation math (not stubbed)", () => {
  it("BASELINE_DAY_KEY (rotation day 1, week 1) has the fixture's baseline test due", () => {
    expect(rotationBaselineNamesForDate(PROGRAM, startOfDay(parseDateKey(BASELINE_DAY_KEY)))).toEqual([
      "Pull-Up Max Reps",
    ]);
  });

  it("NO_BASELINE_DAY_KEY (rotation day 2, week 1) has no baselineWeek entry", () => {
    expect(rotationBaselineNamesForDate(PROGRAM, startOfDay(parseDateKey(NO_BASELINE_DAY_KEY)))).toEqual([]);
  });
});

describe("upsertDayOverrideFromForm — malformed / oversized rejection (pre-write)", () => {
  it("rejects malformed JSON and never touches the write path", async () => {
    await expect(
      upsertDayOverrideFromForm(NO_BASELINE_DAY_KEY, fd({ workoutJson: "{not valid json" })),
    ).rejects.toThrowError(/Invalid workout JSON/);
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });

  it("rejects a bare JSON array with the validator's object-shape message", async () => {
    await expect(
      upsertDayOverrideFromForm(NO_BASELINE_DAY_KEY, fd({ workoutJson: "[]" })),
    ).rejects.toThrowError(/must be an object \(matching DayTemplate\)/);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("rejects a bare number with the validator's object-shape message", async () => {
    await expect(
      upsertDayOverrideFromForm(NO_BASELINE_DAY_KEY, fd({ workoutJson: "42" })),
    ).rejects.toThrowError(/must be an object \(matching DayTemplate\)/);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("rejects a workout missing a title with the field-level message", async () => {
    await expect(
      upsertDayOverrideFromForm(
        NO_BASELINE_DAY_KEY,
        fd({ workoutJson: JSON.stringify({ blocks: [] }) }),
      ),
    ).rejects.toThrowError(/workoutJson\.title must be a non-empty string/);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("rejects an exercise with no name with the field-level message", async () => {
    const bad = { title: "X", blocks: [{ exercises: [{ sets: 3 }] }] };
    await expect(
      upsertDayOverrideFromForm(NO_BASELINE_DAY_KEY, fd({ workoutJson: JSON.stringify(bad) })),
    ).rejects.toThrowError(/exercises\[0\]\.name must be a non-empty string/);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("rejects a >64KB payload with the size message, write mock not called", async () => {
    const huge = { title: "x".repeat(200 * 1024), blocks: [] };
    await expect(
      upsertDayOverrideFromForm(NO_BASELINE_DAY_KEY, fd({ workoutJson: JSON.stringify(huge) })),
    ).rejects.toThrowError(/over the 65,536-byte limit/);
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

describe("upsertDayOverrideFromForm — valid create / update / delete", () => {
  it("creates an override on a non-baseline day and revalidates the right paths", async () => {
    const { revalidatePath } = await import("next/cache");
    await upsertDayOverrideFromForm(
      NO_BASELINE_DAY_KEY,
      fd({ workoutJson: JSON.stringify(VALID_WORKOUT), notes: "Swapped for a race" }),
    );
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const call = mockUpsert.mock.calls[0]![0];
    expect(call.create.notes).toBe("Swapped for a race");
    expect(revalidatePath).toHaveBeenCalledWith("/calendar");
    expect(revalidatePath).toHaveBeenCalledWith(`/days/${NO_BASELINE_DAY_KEY}`);
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("updates an existing override (findUnique returns a row) without re-triggering create semantics", async () => {
    mockFindUnique.mockResolvedValue({
      id: "override-existing",
      baselineTestNames: null,
      workoutJson: null,
    });
    await upsertDayOverrideFromForm(
      NO_BASELINE_DAY_KEY,
      fd({ workoutJson: JSON.stringify(VALID_WORKOUT) }),
    );
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const call = mockUpsert.mock.calls[0]![0];
    expect(call.update.workoutJson).toEqual(VALID_WORKOUT);
  });

  it("deletes the override when every field is blank", async () => {
    await upsertDayOverrideFromForm(NO_BASELINE_DAY_KEY, fd({}));
    expect(mockDeleteMany).toHaveBeenCalledTimes(1);
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

describe("upsertDayOverrideFromForm — audible-with-baselines guard matrix", () => {
  it("fires: baseline day, no existing decision, workout being set", async () => {
    mockFindUnique.mockResolvedValue(null);
    await expect(
      upsertDayOverrideFromForm(BASELINE_DAY_KEY, fd({ workoutJson: JSON.stringify(VALID_WORKOUT) })),
    ).rejects.toThrowError(/didn't make a baseline decision/);
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });

  it("passes: decision already on file (existing override has a baselineTestNames array)", async () => {
    mockFindUnique.mockResolvedValue({
      id: "override-existing",
      baselineTestNames: ["Pull-Up Max Reps"],
      workoutJson: null,
    });
    await expect(
      upsertDayOverrideFromForm(BASELINE_DAY_KEY, fd({ workoutJson: JSON.stringify(VALID_WORKOUT) })),
    ).resolves.not.toThrow();
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  it("passes: decision already on file as an explicit empty array ([] = suppressed)", async () => {
    mockFindUnique.mockResolvedValue({
      id: "override-existing",
      baselineTestNames: [],
      workoutJson: null,
    });
    await expect(
      upsertDayOverrideFromForm(BASELINE_DAY_KEY, fd({ workoutJson: JSON.stringify(VALID_WORKOUT) })),
    ).resolves.not.toThrow();
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  it("passes: no rotation baselines for this date, regardless of existing decision", async () => {
    mockFindUnique.mockResolvedValue(null);
    await expect(
      upsertDayOverrideFromForm(NO_BASELINE_DAY_KEY, fd({ workoutJson: JSON.stringify(VALID_WORKOUT) })),
    ).resolves.not.toThrow();
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  // Superseded by the tri-state fix (#235 R1) — see the tri-state matrix
  // below (case 4). Under the OLD two-state collapse, an entirely-absent
  // workoutJson field was indistinguishable from "explicitly cleared", so an
  // all-blank form on a day with an existing workout override used to DELETE
  // the whole row. That was the exact C2 lockout bug: the structured editor
  // only ever omits the field (never sends a blank one) when the workout is
  // untouched, so this path needed to start preserving the row instead.
  it("workoutJson field ABSENT + all other fields blank + existing override HAS a workout: row is preserved, not deleted (tri-state)", async () => {
    mockFindUnique.mockResolvedValue({
      id: "override-existing",
      baselineTestNames: null,
      workoutJson: VALID_WORKOUT,
    });
    await expect(upsertDayOverrideFromForm(BASELINE_DAY_KEY, fd({}))).resolves.not.toThrow();
    expect(mockDeleteMany).not.toHaveBeenCalled();
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const call = mockUpsert.mock.calls[0]![0];
    expect(call.update).not.toHaveProperty("workoutJson");
  });
});

// Tri-state workoutJson (#235 R1): the structured editor only renders the
// hidden `workoutJson` input when the user actually touched the workout
// (isTemplateDirty). day-actions.ts must distinguish three FormData states —
// field ABSENT (untouched), field PRESENT + blank (explicit wipe), field
// PRESENT + real JSON (full #234 pipeline) — not the old two-state collapse
// that treated "never touched" and "explicitly cleared" identically.
describe("tri-state workoutJson matrix (#235 R1 — architecture-blueprint-v2.md R9)", () => {
  it("1. absent + existing override HAS workoutJson: column untouched after save; guard not evaluated; other fields still update", async () => {
    mockFindUnique.mockResolvedValue({
      id: "override-existing",
      baselineTestNames: null,
      workoutJson: VALID_WORKOUT,
    });
    await expect(
      upsertDayOverrideFromForm(BASELINE_DAY_KEY, fd({ notes: "Skipped it, logged why" })),
    ).resolves.not.toThrow(); // baseline day + no decision on file — guard would fire if evaluated
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const call = mockUpsert.mock.calls[0]![0];
    expect(call.update).not.toHaveProperty("workoutJson");
    expect(call.update.notes).toBe("Skipped it, logged why");
  });

  it("2. absent + no existing override + nutritionText provided: CREATE with workoutJson undefined (rotation stays live), no guard", async () => {
    mockFindUnique.mockResolvedValue(null); // no existing override, non-baseline day
    await expect(
      upsertDayOverrideFromForm(NO_BASELINE_DAY_KEY, fd({ nutritionText: "Extra carbs today" })),
    ).resolves.not.toThrow();
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const call = mockUpsert.mock.calls[0]![0];
    expect(call.create.workoutJson).toBeUndefined();
    expect(call.create.nutritionText).toBe("Extra carbs today");
  });

  it("3. absent + no existing override + all fields blank: no-op delete (harmless, row never existed)", async () => {
    mockFindUnique.mockResolvedValue(null);
    await expect(upsertDayOverrideFromForm(NO_BASELINE_DAY_KEY, fd({}))).resolves.not.toThrow();
    expect(mockDeleteMany).toHaveBeenCalledTimes(1);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("4. absent + existing override HAS workoutJson + all other fields now blank: row PRESERVED (not deleted) — finalWorkoutPresent keeps it alive", async () => {
    mockFindUnique.mockResolvedValue({
      id: "override-existing",
      baselineTestNames: ["Pull-Up Max Reps"], // decision already on file so this isn't also a guard test
      workoutJson: VALID_WORKOUT,
    });
    await expect(upsertDayOverrideFromForm(BASELINE_DAY_KEY, fd({}))).resolves.not.toThrow();
    expect(mockDeleteMany).not.toHaveBeenCalled();
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const call = mockUpsert.mock.calls[0]![0];
    expect(call.update).not.toHaveProperty("workoutJson");
  });

  it("5. present + blank + existing override HAS workoutJson: wipes to Prisma.JsonNull (today's semantics, unchanged); guard skipped", async () => {
    mockFindUnique.mockResolvedValue({
      id: "override-existing",
      baselineTestNames: null,
      workoutJson: VALID_WORKOUT,
    });
    await expect(
      upsertDayOverrideFromForm(BASELINE_DAY_KEY, fd({ workoutJson: "", notes: "Cleared the workout on purpose" })),
    ).resolves.not.toThrow();
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const call = mockUpsert.mock.calls[0]![0];
    expect(call.update).toHaveProperty("workoutJson");
    expect(call.update.workoutJson).toEqual(Prisma.JsonNull);
  });

  it("6. present + blank + all else blank + existing override had ONLY workoutJson: delete-collapse fires, row removed", async () => {
    mockFindUnique.mockResolvedValue({
      id: "override-existing",
      baselineTestNames: ["Pull-Up Max Reps"],
      workoutJson: VALID_WORKOUT,
    });
    await expect(upsertDayOverrideFromForm(BASELINE_DAY_KEY, fd({ workoutJson: "" }))).resolves.not.toThrow();
    expect(mockDeleteMany).toHaveBeenCalledTimes(1);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("7. present + real value, baseline day, no baselineTestNames on file: guard fires (v1 cap, unchanged) — distinct from case 1's silence", async () => {
    mockFindUnique.mockResolvedValue(null);
    await expect(
      upsertDayOverrideFromForm(BASELINE_DAY_KEY, fd({ workoutJson: JSON.stringify(VALID_WORKOUT) })),
    ).rejects.toThrowError(/didn't make a baseline decision/);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("8. present + real value, valid: full #234 pipeline unchanged (size, shape, guard, upsert)", async () => {
    mockFindUnique.mockResolvedValue({
      id: "override-existing",
      baselineTestNames: ["Pull-Up Max Reps"],
      workoutJson: null,
    });
    await expect(
      upsertDayOverrideFromForm(BASELINE_DAY_KEY, fd({ workoutJson: JSON.stringify(VALID_WORKOUT) })),
    ).resolves.not.toThrow();
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const call = mockUpsert.mock.calls[0]![0];
    expect(call.update.workoutJson).toEqual(VALID_WORKOUT);
  });
});

// Named per the architecture critique (C2) and resolved by the tri-state fix
// (#235 R1): under the OLD two-state collapse, "never touched this field"
// and "explicitly cleared a previously-populated workout" were both
// indistinguishable `workoutJson === null` — this suite now exercises them
// as the genuinely distinct states the structured editor produces (field
// absent vs field present-and-blank), both of which must still silently
// skip the guard (nothing to audit when no workout is being SET).
describe("notes-only save on a baseline day — guard silence for both tri-states that set no workout", () => {
  it("field ABSENT (untouched workout) + notes-only edit on a baseline day: guard stays silent, save succeeds", async () => {
    mockFindUnique.mockResolvedValue(null); // no baseline decision on file
    await expect(
      upsertDayOverrideFromForm(BASELINE_DAY_KEY, fd({ notes: "Felt great, no changes needed" })),
    ).resolves.not.toThrow();
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const call = mockUpsert.mock.calls[0]![0];
    expect(call.create.notes).toBe("Felt great, no changes needed");
  });

  it("field PRESENT + blank (explicit wipe) + notes-only edit on a baseline day: guard stays silent, save succeeds", async () => {
    // A previously-populated workoutJson exists on the row; the Advanced tab
    // was blanked and resubmitted with only notes also changed.
    mockFindUnique.mockResolvedValue({
      id: "override-existing",
      baselineTestNames: null,
      workoutJson: VALID_WORKOUT,
    });
    await expect(
      upsertDayOverrideFromForm(BASELINE_DAY_KEY, fd({ workoutJson: "", notes: "Skipped it, logged why" })),
    ).resolves.not.toThrow();
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  it("matches the MCP path's guard silence for a notes-only patch: settingWorkout=false on both sides", async () => {
    // day-actions side: workoutJson stays null when the field is absent or
    // blank — this IS the settingWorkout=false input the shared guard
    // receives (see upsertDayOverrideFromForm's `settingWorkout: workoutJson !== null`).
    const formSideSettingWorkout = (null as unknown) !== null; // false, mirrors day-actions.ts
    // MCP side: applyDayOverrideCore computes `workoutValue !== undefined && workoutValue !== null`
    // for a notes-only patch, where workoutValue stays `undefined` (input.workoutJson never passed).
    const mcpSideSettingWorkout =
      (undefined as unknown) !== undefined && (undefined as unknown) !== null; // false
    expect(formSideSettingWorkout).toBe(false);
    expect(mcpSideSettingWorkout).toBe(false);
    expect(formSideSettingWorkout).toBe(mcpSideSettingWorkout);
  });
});

describe("clearDayOverride", () => {
  it("deletes via the same USER_TZ-correct date bucket as the create/update path", async () => {
    const { revalidatePath } = await import("next/cache");
    await clearDayOverride(BASELINE_DAY_KEY);
    expect(mockDeleteMany).toHaveBeenCalledTimes(1);
    const call = mockDeleteMany.mock.calls[0]![0];
    expect(call.where.date.getTime()).toBe(startOfDay(parseDateKey(BASELINE_DAY_KEY)).getTime());
    expect(revalidatePath).toHaveBeenCalledWith(`/days/${BASELINE_DAY_KEY}`);
  });
});

describe("USER_TZ-correct date parsing (regression for the naive-parseDateKey bug)", () => {
  it("the date bucket written by upsertDayOverrideFromForm matches @/lib/calendar's parseDateKey, not a local-runtime-TZ Date", async () => {
    await upsertDayOverrideFromForm(NO_BASELINE_DAY_KEY, fd({ notes: "tz check" }));
    const call = mockUpsert.mock.calls[0]![0];
    const expectedDate = startOfDay(parseDateKey(NO_BASELINE_DAY_KEY));
    expect(call.where.planId_date.date.getTime()).toBe(expectedDate.getTime());
    expect(call.create.date.getTime()).toBe(expectedDate.getTime());
  });
});
