import Link from "next/link";
import { Card } from "@/components/Card";
import {
  getBaselineSchedule,
  getExerciseSummaries,
  checkpointLabel,
  type ScheduledBaseline,
  type CheckpointStatus,
} from "@/lib/records";

export type RecordsSummaryProps = {
  maxExercises?: number;
  maxTestsDue?: number;
};

export async function RecordsSummary({
  maxExercises = 5,
  maxTestsDue = 3,
}: RecordsSummaryProps = {}) {
  const [schedule, exercises] = await Promise.all([
    getBaselineSchedule(),
    getExerciseSummaries(),
  ]);

  const totals = countByStatus(schedule.scheduled);

  // Next tests due = overdue first, then due, then upcoming
  const testsDue = schedule.scheduled
    .filter((s) => {
      const next = nextCheckpoint(s);
      return next && (next.status === "overdue" || next.status === "due" || next.status === "upcoming");
    })
    .sort((a, b) => {
      const na = nextCheckpoint(a)!;
      const nb = nextCheckpoint(b)!;
      const order: Record<CheckpointStatus, number> = { overdue: 0, due: 1, upcoming: 2, done: 3 };
      if (order[na.status] !== order[nb.status]) return order[na.status] - order[nb.status];
      return na.targetDate.getTime() - nb.targetDate.getTime();
    })
    .slice(0, maxTestsDue);

  const topExercises = exercises.slice(0, maxExercises);

  return (
    <div className="space-y-4">
      {/* Status pills */}
      {schedule.scheduled.length > 0 && (
        <div className="grid grid-cols-4 gap-2 text-center">
          <StatusPill label="Done" count={totals.done} tone="success" />
          <StatusPill label="Due" count={totals.due} tone="warning" />
          <StatusPill label="Overdue" count={totals.overdue} tone="danger" />
          <StatusPill label="Upcoming" count={totals.upcoming} tone="muted" />
        </div>
      )}

      {/* Next tests due */}
      <Card title="Tests due">
        {testsDue.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            {schedule.scheduled.length === 0
              ? "No baseline tests scheduled yet."
              : "All tests are up to date."}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {testsDue.map((s) => {
              const next = nextCheckpoint(s)!;
              return (
                <li key={s.testName}>
                  <Link
                    href={`/baselines/test/${encodeURIComponent(s.testName)}`}
                    className="flex items-center justify-between py-3 gap-2 min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded"
                  >
                    <div className="min-w-0">
                      <p className="font-medium truncate">{s.testName}</p>
                      <p className="text-xs">
                        <span className={statusTextClass(next.status)}>
                          {checkpointLabel(next)} {next.status}
                        </span>
                        <span className="text-[var(--muted)]">
                          {" · wk "}{next.week}
                          {" · "}{new Date(next.targetDate).toLocaleDateString()}
                        </span>
                      </p>
                    </div>
                    <span className="text-xs text-[var(--muted)] shrink-0">
                      {s.resultCount}/{s.checkpoints.length}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {schedule.scheduled.length > maxTestsDue && testsDue.length === maxTestsDue && (
          <Link
            href="/baselines"
            className="block mt-2 text-xs text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded"
          >
            View all {schedule.scheduled.length} tests →
          </Link>
        )}
      </Card>

      {/* Top exercise PRs */}
      <Card title="Exercise PRs">
        {topExercises.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            No workouts logged yet.{" "}
            <Link href="/import" className="text-[var(--accent)]">
              Import one
            </Link>
            .
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {topExercises.map((e) => (
              <li key={e.name}>
                <Link
                  href={`/baselines/exercise/${encodeURIComponent(e.name)}`}
                  className="flex items-center justify-between py-3 gap-2 min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded"
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
                  <span className="text-xs text-[var(--muted)] shrink-0">
                    {e.sessionCount} session{e.sessionCount === 1 ? "" : "s"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {exercises.length > maxExercises && (
          <Link
            href="/baselines"
            className="block mt-2 text-xs text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded"
          >
            View all {exercises.length} exercises →
          </Link>
        )}
      </Card>
    </div>
  );
}

// --- helpers ---

function nextCheckpoint(s: ScheduledBaseline) {
  return (
    s.checkpoints.find((c) => c.status === "overdue" || c.status === "due") ??
    s.checkpoints.find((c) => c.status === "upcoming") ??
    null
  );
}

function countByStatus(list: ScheduledBaseline[]): Record<CheckpointStatus, number> {
  const out: Record<CheckpointStatus, number> = { done: 0, due: 0, overdue: 0, upcoming: 0 };
  for (const s of list) {
    for (const c of s.checkpoints) out[c.status]++;
  }
  return out;
}

function statusTextClass(s: CheckpointStatus): string {
  switch (s) {
    case "done":
      return "text-[var(--success)]";
    case "due":
      return "text-[var(--warning)]";
    case "overdue":
      return "text-[var(--danger)]";
    default:
      return "text-[var(--muted)]";
  }
}

function StatusPill({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: "success" | "warning" | "danger" | "muted";
}) {
  const cls =
    tone === "success"
      ? "border-[var(--success)]/40 text-[var(--success)]"
      : tone === "warning"
        ? "border-[var(--warning)]/40 text-[var(--warning)]"
        : tone === "danger"
          ? "border-[var(--danger)]/40 text-[var(--danger)]"
          : "border-[var(--border)] text-[var(--muted)]";
  return (
    <div className={`rounded-lg border ${cls} py-2`}>
      <p className="text-lg font-semibold tabular-nums">{count}</p>
      <p className="text-xs">{label}</p>
    </div>
  );
}

function formatBest(e: {
  primary: string;
  bestValue: number;
  bestRaw: { weightLb: number | null; reps: number | null; durationSec: number | null };
}): string {
  if (e.primary === "rm") return `~${Math.round(e.bestValue)} lb 1RM (${e.bestRaw.weightLb} × ${e.bestRaw.reps})`;
  if (e.primary === "reps") return `${e.bestValue} reps`;
  if (e.primary === "duration") return formatDuration(e.bestValue);
  if (e.primary === "distance") return `${e.bestValue.toFixed(2)} mi`;
  if (e.primary === "time") return formatDuration(e.bestValue);
  return String(e.bestValue);
}

function formatDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}
