// Shape consumed by formatters. Matches the Prisma Workout + relations select.

export type FormattableSet = {
  id: string;
  setIndex: number;
  reps: number | null;
  weightLb: number | null;
  durationSec: number | null;
  distanceMi: number | null;
  rpe: number | null;
  notes: string | null;
};

export type FormattableExercise = {
  id: string;
  name: string;
  equipment: string | null;
  orderIndex: number;
  notes: string | null;
  sets: FormattableSet[];
};

export type FormattableWorkout = {
  id: string;
  title: string | null;
  startedAt: Date;
  source: string | null;
  sourceUrl: string | null;
  notes: string | null;
  exercises: FormattableExercise[];
};

export type ExportFormat = "strong" | "markdown" | "plain" | "json";

// Structural input type for toFormattableWorkout — matches the Prisma
// `workout.findUniqueOrThrow({ include: { exercises: { include: { sets } } } })`
// shape (see src/lib/mcp/tools.ts export_workout). Deliberately hand-rolled
// rather than imported from the generated Prisma client so this module (like
// readiness.ts / rarity-core.ts) stays framework-agnostic and easy to unit
// test with plain fixtures — extra fields on the real Prisma row (e.g.
// userId) are structurally ignored.
export type WorkoutExportSource = {
  id: string;
  title: string | null;
  startedAt: Date;
  source: string | null;
  sourceUrl: string | null;
  notes: string | null;
  exercises: Array<{
    id: string;
    name: string;
    equipment: string | null;
    orderIndex: number;
    notes: string | null;
    sets: Array<{
      id: string;
      setIndex: number;
      reps: number | null;
      weightLb: number | null;
      durationSec: number | null;
      distanceMi: number | null;
      rpe: number | null;
      notes: string | null;
    }>;
  }>;
};

/**
 * Projects a Prisma Workout row (with exercises/sets included) onto the
 * formatter-facing FormattableWorkout shape. Pulled out of the export_workout
 * tool handler so it's unit-testable without a DB — in particular so a
 * regression test can assert the exported exercise/set `id`s are exactly the
 * underlying rows' real Prisma IDs (B2 / issue #265).
 */
export function toFormattableWorkout(w: WorkoutExportSource): FormattableWorkout {
  return {
    id: w.id,
    title: w.title,
    startedAt: w.startedAt,
    source: w.source,
    sourceUrl: w.sourceUrl,
    notes: w.notes,
    exercises: w.exercises.map((ex) => ({
      id: ex.id,
      name: ex.name,
      equipment: ex.equipment,
      orderIndex: ex.orderIndex,
      notes: ex.notes,
      sets: ex.sets.map((s) => ({
        id: s.id,
        setIndex: s.setIndex,
        reps: s.reps,
        weightLb: s.weightLb,
        durationSec: s.durationSec,
        distanceMi: s.distanceMi,
        rpe: s.rpe,
        notes: s.notes,
      })),
    })),
  };
}

export function formatDuration(durationSec: number): string {
  const h = Math.floor(durationSec / 3600);
  const m = Math.floor((durationSec % 3600) / 60);
  const s = durationSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatStrongDateLine(d: Date): string {
  // "Saturday, May 2, 2026 at 3:59 PM"
  const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
  const month = d.toLocaleDateString("en-US", { month: "long" });
  const day = d.getDate();
  const year = d.getFullYear();
  let hours = d.getHours();
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  if (hours === 0) hours = 12;
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${weekday}, ${month} ${day}, ${year} at ${hours}:${minutes} ${ampm}`;
}
