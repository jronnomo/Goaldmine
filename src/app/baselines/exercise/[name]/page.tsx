import Link from "next/link";
import { Card } from "@/components/Card";
import { HistoryChart } from "@/components/HistoryChart";
import { getExerciseHistory } from "@/lib/records";

export const dynamic = "force-dynamic";

export default async function ExerciseRecordDetail({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name: encoded } = await params;
  const name = decodeURIComponent(encoded);
  const { summary, history } = await getExerciseHistory(name);
  // Equipment is descriptive now (not part of identity) — show the best set's.
  const eq = summary?.equipment ?? null;

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <header className="pt-2">
        <Link href="/baselines" className="text-sm text-[var(--accent)]">
          ← Records
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">
          {name}
          {eq && <span className="text-[var(--muted)] font-normal"> · {eq}</span>}
        </h1>
        {summary && (
          <p className="text-sm text-[var(--muted)]">
            Best:{" "}
            {summary.primary === "rm"
              ? `~${Math.round(summary.bestValue)} lb 1RM (${summary.bestRaw.weightLb} × ${summary.bestRaw.reps})`
              : summary.primary === "reps"
                ? `${summary.bestValue} reps`
                : formatDuration(summary.bestValue)}
            {" · "}
            {new Date(summary.bestDate).toLocaleDateString()}
            {" · "}
            {summary.sessionCount} session{summary.sessionCount === 1 ? "" : "s"}
          </p>
        )}
      </header>

      <Card title={chartTitleFor(summary?.primary)}>
        {history.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No history.</p>
        ) : history.length === 1 ? (
          <p className="text-sm text-[var(--muted)]">
            Only one session so far. The trend appears once you do this exercise again.
          </p>
        ) : (
          <HistoryChart
            data={history.map((h) => ({
              date: h.date.toISOString(),
              value: summary?.primary === "rm" ? Math.round(h.best) : h.best,
              tooltip: tooltipFor(summary?.primary, h),
            }))}
            units={unitsFor(summary?.primary)}
          />
        )}
      </Card>

      <Card title="Sessions">
        <ul className="divide-y divide-[var(--border)]">
          {[...history].reverse().map((h) => (
            <li key={h.workoutId} className="py-2">
              <Link
                href={`/workouts/${h.workoutId}`}
                className="flex justify-between items-baseline gap-3"
              >
                <div>
                  <p className="font-mono text-sm">{rawText(h)}</p>
                  {h.workoutTitle && (
                    <p className="text-xs text-[var(--muted)]">{h.workoutTitle}</p>
                  )}
                </div>
                <p className="text-xs text-[var(--muted)] shrink-0">
                  {new Date(h.date).toLocaleDateString()}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function rawText(h: { rawWeight: number | null; rawReps: number | null; rawDuration: number | null }): string {
  if (h.rawWeight !== null && h.rawReps !== null) return `${h.rawWeight} lb × ${h.rawReps}`;
  if (h.rawReps !== null) return `${h.rawReps} reps`;
  if (h.rawDuration !== null) return formatDuration(h.rawDuration);
  return "—";
}

function chartTitleFor(p?: "rm" | "reps" | "duration"): string {
  switch (p) {
    case "rm":
      return "Estimated 1RM over time";
    case "reps":
      return "Max reps over time";
    case "duration":
      return "Longest duration over time";
    default:
      return "History";
  }
}

function unitsFor(p?: "rm" | "reps" | "duration"): string {
  switch (p) {
    case "rm":
      return "lb (Epley 1RM)";
    case "reps":
      return "reps";
    case "duration":
      return "sec";
    default:
      return "";
  }
}

function tooltipFor(
  p: "rm" | "reps" | "duration" | undefined,
  h: { best: number; rawWeight: number | null; rawReps: number | null; rawDuration: number | null },
): string {
  if (p === "rm") return `~${Math.round(h.best)} lb 1RM (${h.rawWeight} × ${h.rawReps})`;
  if (p === "reps") return `${h.best} reps`;
  if (p === "duration") return formatDuration(h.best);
  return String(h.best);
}

function formatDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}
