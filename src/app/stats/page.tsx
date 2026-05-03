import { Card } from "@/components/Card";
import { WeightChart } from "@/components/WeightChart";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function StatsPage() {
  const [measurements, baselineCount, workoutCount, hikeCount] = await Promise.all([
    prisma.measurement.findMany({ orderBy: { date: "asc" }, take: 180 }),
    prisma.baseline.count(),
    prisma.workout.count(),
    prisma.hike.count(),
  ]);

  const weights = measurements
    .filter((m) => m.weightLb !== null)
    .map((m) => ({ date: m.date.toISOString(), weight: m.weightLb! }));

  const latest = weights.at(-1)?.weight;
  const start = weights[0]?.weight;
  const delta = latest !== undefined && start !== undefined ? latest - start : null;

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <header className="pt-2">
        <h1 className="text-2xl font-semibold tracking-tight">Stats</h1>
      </header>

      <Card title="Weight">
        {weights.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No measurements yet.</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 mb-3 text-center">
              <Stat label="Current" value={latest !== undefined ? `${latest} lb` : "—"} />
              <Stat label="Start" value={start !== undefined ? `${start} lb` : "—"} />
              <Stat
                label="Δ"
                value={
                  delta !== null
                    ? `${delta > 0 ? "+" : ""}${delta.toFixed(1)} lb`
                    : "—"
                }
              />
            </div>
            <WeightChart data={weights} />
          </>
        )}
      </Card>

      <Card title="Totals">
        <ul className="grid grid-cols-3 gap-2 text-center">
          <Stat label="Workouts" value={workoutCount} />
          <Stat label="Baselines" value={baselineCount} />
          <Stat label="Hikes" value={hikeCount} />
        </ul>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <li className="rounded-lg border border-[var(--border)] py-2 list-none">
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-xs text-[var(--muted)]">{label}</p>
    </li>
  );
}
