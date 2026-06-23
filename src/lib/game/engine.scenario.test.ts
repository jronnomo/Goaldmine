import { describe, it, expect } from "vitest";
import { computeGameStateFromData } from "@/lib/game/engine";
import type { ProgramTemplate } from "@/lib/program-template";

// Minimal template: a single 1-week program whose rotation day 1 is a strength
// "lower" day. Only the fields the engine actually reads are populated.
const template = {
  name: "test",
  totalWeeks: 1,
  phases: [],
  weeklySplit: [
    { dayOfWeek: 1, title: "Lower", category: "lower", summary: "", blocks: [] },
  ],
  baselineWeek: [],
  goals: [],
} as unknown as ProgramTemplate;

const program = {
  id: "p1",
  name: "test",
  startedOn: new Date("2026-06-23T07:00:00.000Z"),
  template,
  confirmedThroughDate: null,
};

const now = new Date("2026-06-23T20:00:00.000Z"); // same plan day (day 1)

function baseData(workouts: unknown[]) {
  return {
    program,
    goal: { id: "g1", kind: "fitness" },
    workouts,
    hikes: [],
    baselines: [],
    nutritionLogs: [],
    reviewNotes: [],
    mobilityCheckins: [],
    overridesByKey: new Map(),
    bonusRows: [],
  } as never;
}

const strengthWorkout = {
  id: "w-strength",
  startedAt: new Date("2026-06-23T14:00:00.000Z"),
  status: "completed",
  source: "manual",
  exercises: [
    { name: "Goblet Squat", sets: [{ weightLb: 50, reps: 12, durationSec: null, distanceMi: null }] },
  ],
};

const mobilityWorkout = {
  id: "w-mobility",
  startedAt: new Date("2026-06-23T15:00:00.000Z"), // logged AFTER the strength session
  status: "completed",
  source: "manual",
  exercises: [
    { name: "Mobility Session", sets: [{ weightLb: null, reps: null, durationSec: 900, distanceMi: null }] },
  ],
};

describe("off-plan extra mobility session (the reported scenario)", () => {
  it("awards mobility.session MOB when an extra mobility workout follows the scheduled strength session", () => {
    const state = computeGameStateFromData(baseData([strengthWorkout, mobilityWorkout]), now);
    const today = state.recentEvents.filter((e) => e.dateKey === "2026-06-23");

    const mobilitySession = today.find((e) => e.ruleId === "mobility.session");
    expect(mobilitySession, "expected a mobility.session event for the extra mobility workout").toBeDefined();
    expect(mobilitySession?.attribute).toBe("MOB");

    // The primary (first-logged) workout still takes the workout.completed slot.
    const completed = today.find((e) => e.ruleId === "workout.completed");
    expect(completed?.attribute).toBe("STR");
  });

  it("still credits mobility.session when the mobility workout is the only session", () => {
    const state = computeGameStateFromData(baseData([mobilityWorkout]), now);
    const today = state.recentEvents.filter((e) => e.dateKey === "2026-06-23");
    expect(today.find((e) => e.ruleId === "mobility.session")?.attribute).toBe("MOB");
    expect(today.find((e) => e.ruleId === "workout.completed")?.attribute).toBe("MOB");
  });
});
