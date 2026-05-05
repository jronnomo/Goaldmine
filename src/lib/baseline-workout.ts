// Baselines double as workouts: a max-effort test on a baseline-collection day
// IS the day's workout (program template defers regular blocks). When a baseline
// is logged, append it to that date's "Baseline tests" Workout, creating the
// Workout on first call. One Workout per day, one Exercise per test, one Set
// per result.

import { prisma } from "@/lib/db";
import { endOfDay, startOfDay } from "@/lib/calendar";

type SetData = {
  reps?: number;
  weightLb?: number;
  durationSec?: number;
  distanceMi?: number;
};

const METERS_PER_MILE = 1609.344;
const KG_TO_LB = 2.20462;

// Map baseline (testName, value, units) → a single Set's recordable fields.
// Pulls implicit dimensions out of the test name (e.g. "1.5 Mile Run", "20 Min Row")
// so we capture both the prescribed dimension and the measured one.
export function mapBaselineToSet(testName: string, value: number, units: string): SetData {
  const set: SetData = {};
  const u = units.trim().toLowerCase();

  // Direct: the value+units pair.
  if (u === "sec" || u === "s" || u === "second" || u === "seconds") {
    set.durationSec = Math.round(value);
  } else if (u === "min" || u === "minute" || u === "minutes") {
    set.durationSec = Math.round(value * 60);
  } else if (u === "m" || u === "meter" || u === "meters") {
    set.distanceMi = value / METERS_PER_MILE;
  } else if (u === "km" || u === "kilometer" || u === "kilometers") {
    set.distanceMi = (value * 1000) / METERS_PER_MILE;
  } else if (u === "mi" || u === "mile" || u === "miles") {
    set.distanceMi = value;
  } else if (u === "rep" || u === "reps") {
    set.reps = Math.round(value);
  } else if (u === "lb" || u === "lbs" || u === "pound" || u === "pounds") {
    set.weightLb = value;
  } else if (u === "kg") {
    set.weightLb = value * KG_TO_LB;
  }
  // Unknown units fall through silently — Set has notes-free fields, but
  // the baseline row keeps the original value+units for reasoning.

  // Implicit: parse the test name for the *other* dimension.
  const distMatch = testName.match(/(\d+(?:\.\d+)?)\s*(?:mi|mile|miles)\b/i);
  if (distMatch && set.distanceMi === undefined) {
    set.distanceMi = parseFloat(distMatch[1]!);
  }
  const minMatch = testName.match(/(\d+(?:\.\d+)?)\s*(?:min|minute|minutes)\b/i);
  if (minMatch && set.durationSec === undefined) {
    set.durationSec = Math.round(parseFloat(minMatch[1]!) * 60);
  }
  const meterMatch = testName.match(/(\d+(?:\.\d+)?)\s*m(?:eter|eters)?\b/i);
  if (meterMatch && set.distanceMi === undefined) {
    set.distanceMi = parseFloat(meterMatch[1]!) / METERS_PER_MILE;
  }

  return set;
}

export async function appendBaselineToDayWorkout(args: {
  testName: string;
  value: number;
  units: string;
  date: Date;
  notes?: string | null;
}) {
  // Skip placeholder rows — they document a substitution, not an actual effort.
  if (args.value === 0) return null;

  const dayStart = startOfDay(args.date);
  const dayEnd = endOfDay(args.date);

  const existing = await prisma.workout.findFirst({
    where: {
      startedAt: { gte: dayStart, lte: dayEnd },
      source: "baseline",
    },
    include: { exercises: { select: { id: true } } },
  });

  const setData = mapBaselineToSet(args.testName, args.value, args.units);
  const setCreate = {
    setIndex: 1,
    reps: setData.reps ?? null,
    weightLb: setData.weightLb ?? null,
    durationSec: setData.durationSec ?? null,
    distanceMi: setData.distanceMi ?? null,
  };

  if (!existing) {
    return prisma.workout.create({
      data: {
        title: "Baseline tests",
        startedAt: args.date,
        status: "completed",
        source: "baseline",
        notes: null,
        exercises: {
          create: [
            {
              name: args.testName,
              orderIndex: 0,
              notes: args.notes ?? null,
              sets: { create: [setCreate] },
            },
          ],
        },
      },
    });
  }

  await prisma.workoutExercise.create({
    data: {
      workoutId: existing.id,
      name: args.testName,
      orderIndex: existing.exercises.length,
      notes: args.notes ?? null,
      sets: { create: [setCreate] },
    },
  });
  return existing;
}
