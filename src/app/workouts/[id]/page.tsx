import { notFound } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/Card";
import { ShareWorkout } from "@/components/ShareWorkout";
import { prisma } from "@/lib/db";
import type { FormattableWorkout } from "@/lib/formatters";

export const dynamic = "force-dynamic";

export default async function WorkoutDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const workout = await prisma.workout.findUnique({
    where: { id },
    include: {
      exercises: {
        orderBy: { orderIndex: "asc" },
        include: { sets: { orderBy: { setIndex: "asc" } } },
      },
    },
  });

  if (!workout) notFound();

  const formattable: FormattableWorkout = {
    id: workout.id,
    title: workout.title,
    startedAt: workout.startedAt,
    source: workout.source,
    sourceUrl: workout.sourceUrl,
    notes: workout.notes,
    exercises: workout.exercises.map((ex) => ({
      name: ex.name,
      equipment: ex.equipment,
      orderIndex: ex.orderIndex,
      notes: ex.notes,
      sets: ex.sets.map((s) => ({
        setIndex: s.setIndex,
        reps: s.reps,
        weightLb: s.weightLb,
        durationSec: s.durationSec,
        distanceMi: s.distanceMi,
      })),
    })),
  };

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <header className="pt-2">
        <Link href="/history" className="text-sm text-[var(--accent)]">
          ← History
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">
          {workout.title ?? "Workout"}
        </h1>
        <p className="text-sm text-[var(--muted)]">
          {new Date(workout.startedAt).toLocaleString()}
          {workout.source ? ` · ${workout.source}` : ""}
        </p>
      </header>

      <ShareWorkout workout={formattable} />

      {workout.exercises.map((ex) => (
        <Card
          key={ex.id}
          title={ex.equipment ? `${ex.name} (${ex.equipment})` : ex.name}
        >
          <ul className="space-y-1 text-sm">
            {ex.sets.map((s) => (
              <li key={s.id} className="flex justify-between">
                <span className="text-[var(--muted)]">Set {s.setIndex}</span>
                <span className="font-mono">{formatSet(s)}</span>
              </li>
            ))}
          </ul>
          {ex.notes && (
            <p className="text-xs text-[var(--muted)] italic mt-2">{ex.notes}</p>
          )}
        </Card>
      ))}

      {workout.notes && (
        <Card title="Notes">
          <p className="text-sm whitespace-pre-wrap">{workout.notes}</p>
        </Card>
      )}

      {workout.sourceUrl && (
        <p className="text-xs text-[var(--muted)] text-center">
          Source:{" "}
          <a
            href={workout.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[var(--accent)]"
          >
            {workout.sourceUrl}
          </a>
        </p>
      )}
    </div>
  );
}

function formatSet(s: {
  reps: number | null;
  weightLb: number | null;
  durationSec: number | null;
  distanceMi: number | null;
}): string {
  if (s.weightLb !== null && s.reps !== null) return `${s.weightLb} lb × ${s.reps}`;
  if (s.reps !== null) return `${s.reps} reps`;
  if (s.durationSec !== null) {
    const m = Math.floor(s.durationSec / 60);
    const sec = s.durationSec % 60;
    return `${m}:${String(sec).padStart(2, "0")}`;
  }
  if (s.distanceMi !== null) return `${s.distanceMi} mi`;
  return "—";
}
