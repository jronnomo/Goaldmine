import Link from "next/link";
import { Card } from "@/components/Card";
import { WeightChart } from "@/components/WeightChart";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const db = await getDb();
  const [workouts, measurements] = await Promise.all([
    db.workout.findMany({
      where: { status: { not: "planned" } },
      orderBy: { startedAt: "desc" },
      take: 50,
      include: { exercises: { select: { id: true } } },
    }),
    db.measurement.findMany({
      orderBy: { date: "asc" },
      take: 90,
    }),
  ]);

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <header className="pt-2 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">History</h1>
        <Link
          href="/import"
          className="text-xs rounded-full border border-[var(--border)] px-2.5 py-1 text-[var(--muted)] hover:text-foreground"
        >
          + Import
        </Link>
      </header>

      <Card title="Weight trend">
        {measurements.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No measurements yet. Log your first weight from the Log tab below.</p>
        ) : (
          <WeightChart
            data={measurements
              .filter((m) => m.weightLb !== null)
              .map((m) => ({ date: m.date.toISOString(), weight: m.weightLb! }))}
          />
        )}
      </Card>

      <Card title="Workouts">
        {workouts.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            No workouts logged yet.{" "}
            <Link href="/import" className="text-[var(--accent)]">
              Import one
            </Link>
            .
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {workouts.map((w) => {
              const isSkipped = w.status === "skipped";
              return (
                <li key={w.id}>
                  <Link
                    href={`/workouts/${w.id}`}
                    className="flex items-center justify-between py-3 gap-2"
                  >
                    <div>
                      <p className={`font-medium${isSkipped ? " text-[var(--muted)]" : ""}`}>
                        {w.title ?? "Workout"}
                        {isSkipped && (
                          <span className="ml-2 text-xs rounded-full px-2 py-0.5 border border-[var(--border)] text-[var(--muted)]">
                            Skipped
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-[var(--muted)]">
                        {new Date(w.startedAt).toLocaleString()}
                        {w.source ? ` · ${w.source}` : ""}
                      </p>
                    </div>
                    <span className="text-sm text-[var(--muted)]">
                      {w.exercises.length} ex
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
