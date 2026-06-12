import Link from "next/link";
import { Card } from "@/components/Card";
import { USER_TZ } from "@/lib/calendar";

type SetRow = {
  id: string;
  setIndex: number;
  reps: number | null;
  weightLb: number | null;
  durationSec: number | null;
  distanceMi: number | null;
  rpe: number | null;
};

type ExerciseRow = {
  id: string;
  name: string;
  equipment: string | null;
  notes: string | null;
  sets: SetRow[];
};

export type CompletedWorkoutDetail = {
  id: string;
  title: string | null;
  startedAt: Date;
  source: string | null;
  notes: string | null;
  exercises: ExerciseRow[];
};

/** Fully-expanded view of a logged workout, rendered in place of the planned card. */
export function CompletedWorkoutCard({ workout }: { workout: CompletedWorkoutDetail }) {
  const time = workout.startedAt.toLocaleTimeString("en-US", {
    timeZone: USER_TZ,
    hour: "numeric",
    minute: "2-digit",
  });
  const totalSets = workout.exercises.reduce((n, ex) => n + ex.sets.length, 0);

  return (
    <Card
      title={`✓ Completed: ${workout.title ?? "Workout"}`}
      action={
        <Link href={`/workouts/${workout.id}`} className="text-xs text-[var(--accent)] shrink-0">
          Edit →
        </Link>
      }
    >
      <p className="text-xs text-[var(--muted)] mb-3">
        {time} · {workout.exercises.length} exercises · {totalSets} sets
        {workout.source ? ` · ${workout.source}` : ""}
      </p>

      <ul className="space-y-3">
        {workout.exercises.map((ex) => (
          <li key={ex.id}>
            <p className="text-sm font-medium min-w-0 break-words">
              {ex.name}
              {ex.equipment && (
                <span className="text-[var(--muted)] font-normal"> · {ex.equipment}</span>
              )}
            </p>
            <ul className="mt-1 space-y-0.5">
              {ex.sets.map((s) => (
                <li key={s.id} className="flex justify-between text-sm">
                  <span className="text-[var(--muted)]">Set {s.setIndex}</span>
                  <span className="font-mono tabular-nums">{formatSet(s)}</span>
                </li>
              ))}
            </ul>
            {ex.notes && (
              <p className="text-xs text-[var(--muted)] italic mt-1">{ex.notes}</p>
            )}
          </li>
        ))}
      </ul>

      {workout.notes && (
        <div className="border-t border-[var(--border)] mt-3 pt-2">
          <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Notes</p>
          <p className="text-sm whitespace-pre-wrap mt-1">{workout.notes}</p>
        </div>
      )}
    </Card>
  );
}

function formatSet(s: SetRow): string {
  const parts: string[] = [];
  if (s.weightLb !== null && s.reps !== null) parts.push(`${s.weightLb} lb × ${s.reps}`);
  else if (s.reps !== null) parts.push(`${s.reps} reps`);
  if (s.durationSec !== null) parts.push(formatSecs(s.durationSec));
  if (s.distanceMi !== null) parts.push(`${s.distanceMi} mi`);
  if (s.rpe !== null) parts.push(`RPE ${s.rpe}`);
  return parts.join(" · ") || "—";
}

function formatSecs(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}:${String(sec).padStart(2, "0")}` : `${s}s`;
}
