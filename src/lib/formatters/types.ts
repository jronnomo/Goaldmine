// Shape consumed by formatters. Matches the Prisma Workout + relations select.

export type FormattableSet = {
  setIndex: number;
  reps: number | null;
  weightLb: number | null;
  durationSec: number | null;
  distanceMi: number | null;
};

export type FormattableExercise = {
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
