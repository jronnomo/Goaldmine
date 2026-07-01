import { notFound } from "next/navigation";
import Link from "next/link";
import { ShareWorkout } from "@/components/ShareWorkout";
import { WorkoutEditor } from "@/components/WorkoutEditor";
import type { WorkoutDTO } from "@/components/WorkoutEditor";
import { getDb } from "@/lib/db";
import type { FormattableWorkout } from "@/lib/formatters";

export const dynamic = "force-dynamic";

export default async function WorkoutDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = await getDb();
  const workout = await db.workout.findUnique({
    where: { id },
    include: {
      exercises: {
        orderBy: { orderIndex: "asc" },
        include: { sets: { orderBy: { setIndex: "asc" } } },
      },
    },
  });

  if (!workout) notFound();

  // Serialisable DTO — all Dates converted to ISO strings for the client island.
  const dto: WorkoutDTO = {
    id: workout.id,
    title: workout.title,
    notes: workout.notes,
    startedAt: workout.startedAt.toISOString(),
    status: workout.status,
    exercises: workout.exercises.map((ex) => ({
      id: ex.id,
      name: ex.name,
      equipment: ex.equipment,
      notes: ex.notes,
      sets: ex.sets.map((s) => ({
        id: s.id,
        setIndex: s.setIndex,
        reps: s.reps,
        weightLb: s.weightLb,
        durationSec: s.durationSec,
        rpe: s.rpe,
      })),
    })),
  };

  // Separate shape for ShareWorkout (needs distanceMi, different fields).
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

      {/* WorkoutEditor — read-mode default; edit toggle + delete inside (REQ-65-3) */}
      <WorkoutEditor workout={dto} />

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
