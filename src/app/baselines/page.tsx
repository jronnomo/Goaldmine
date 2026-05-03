import Link from "next/link";
import { Card } from "@/components/Card";
import { getBaselineSummaries, getExerciseSummaries } from "@/lib/records";

export const dynamic = "force-dynamic";

export default async function BaselinesPage() {
  const [baselines, exercises] = await Promise.all([
    getBaselineSummaries(),
    getExerciseSummaries(),
  ]);

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <header className="pt-2">
        <h1 className="text-2xl font-semibold tracking-tight">Records</h1>
        <p className="text-sm text-[var(--muted)] mt-1">
          Baseline tests and per-exercise PRs. Tap any row to see the history over time.
        </p>
      </header>

      <Card title={`Baseline tests (${baselines.length})`}>
        {baselines.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            No baseline results yet. Log them with Claude in claude.ai (via the upcoming MCP tools)
            or add directly to the DB.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {baselines.map((b) => (
              <li key={b.testName}>
                <Link
                  href={`/baselines/test/${encodeURIComponent(b.testName)}`}
                  className="flex items-center justify-between py-3 gap-2"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{b.testName}</p>
                    <p className="text-xs text-[var(--muted)]">
                      latest {formatNum(b.latest.value)} {b.units}
                      {b.count > 1 && (
                        <>
                          {" · "}
                          <span className={b.delta === 0 ? "" : b.delta > 0 ? "text-emerald-500" : "text-red-500"}>
                            {b.delta > 0 ? "+" : ""}{formatNum(b.delta)} {b.units}
                          </span>
                          {" since "}
                          {new Date(b.earliest.date).toLocaleDateString()}
                        </>
                      )}
                    </p>
                  </div>
                  <span className="text-xs text-[var(--muted)]">
                    {b.count} run{b.count === 1 ? "" : "s"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={`Exercise PRs (${exercises.length})`}>
        {exercises.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            No workouts logged yet.{" "}
            <Link href="/import" className="text-[var(--accent)]">
              Import one
            </Link>
            .
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {exercises.map((e) => (
              <li key={`${e.name}|${e.equipment ?? ""}`}>
                <Link
                  href={`/baselines/exercise/${encodeURIComponent(e.name)}${
                    e.equipment ? `?equipment=${encodeURIComponent(e.equipment)}` : ""
                  }`}
                  className="flex items-center justify-between py-3 gap-2"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">
                      {e.name}
                      {e.equipment && (
                        <span className="text-[var(--muted)] font-normal"> · {e.equipment}</span>
                      )}
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      best {formatBest(e)}
                      {" · "}
                      {new Date(e.bestDate).toLocaleDateString()}
                    </p>
                  </div>
                  <span className="text-xs text-[var(--muted)]">
                    {e.sessionCount} session{e.sessionCount === 1 ? "" : "s"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function formatNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function formatBest(e: { primary: string; bestValue: number; bestRaw: { weightLb: number | null; reps: number | null; durationSec: number | null } }): string {
  if (e.primary === "rm") {
    return `~${Math.round(e.bestValue)} lb 1RM (${e.bestRaw.weightLb} × ${e.bestRaw.reps})`;
  }
  if (e.primary === "reps") return `${e.bestValue} reps`;
  if (e.primary === "duration") return formatDuration(e.bestValue);
  return String(e.bestValue);
}

function formatDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}
