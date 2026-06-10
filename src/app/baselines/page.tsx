import Link from "next/link";
import { Card } from "@/components/Card";
import { getBaselineSchedule, getExerciseSummaries, checkpointLabel, type ScheduledBaseline, type CheckpointStatus } from "@/lib/records";

export const dynamic = "force-dynamic";

export default async function BaselinesPage() {
  const [schedule, exercises] = await Promise.all([
    getBaselineSchedule(),
    getExerciseSummaries(),
  ]);

  const totals = countByStatus(schedule.scheduled);

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <header className="pt-2 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Records</h1>
        <Link
          href="/baselines/new"
          className="text-xs rounded-full border border-[var(--border)] px-3 py-1 hover:bg-[var(--accent)] hover:text-[var(--accent-fg)] hover:border-[var(--accent)]"
        >
          + Log result
        </Link>
      </header>

      <p className="text-sm text-[var(--muted)]">
        Scheduled baseline tests + every exercise PR. Tap a row to view history. Initial collection
        is week 1; retests follow the program template.
      </p>

      {schedule.scheduled.length > 0 && (
        <div className="grid grid-cols-4 gap-2 text-center">
          <StatusPill label="Done" count={totals.done} tone="emerald" />
          <StatusPill label="Due" count={totals.due} tone="amber" />
          <StatusPill label="Overdue" count={totals.overdue} tone="red" />
          <StatusPill label="Upcoming" count={totals.upcoming} tone="muted" />
        </div>
      )}

      <Card title={`Scheduled tests (${schedule.scheduled.length})`}>
        {schedule.scheduled.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            <strong className="font-semibold text-[var(--foreground)]">No active plan.</strong>{" "}
            Add a goal to schedule your baseline tests.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {schedule.scheduled.map((s) => (
              <li key={s.testName}>
                <ScheduledRow s={s} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {schedule.unscheduledExtras.length > 0 && (
        <Card title={`Other logged tests (${schedule.unscheduledExtras.length})`}>
          <p className="text-xs text-[var(--muted)] mb-2">
            Tests you&apos;ve logged that aren&apos;t part of the current plan&apos;s baseline week.
          </p>
          <ul className="divide-y divide-[var(--border)]">
            {schedule.unscheduledExtras.map((e) => (
              <li key={e.testName}>
                <Link
                  href={`/baselines/test/${encodeURIComponent(e.testName)}`}
                  className="flex items-center justify-between py-2 gap-2"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{e.testName}</p>
                    <p className="text-xs text-[var(--muted)]">
                      latest {formatNum(e.latest.value)} {e.units} ·{" "}
                      {new Date(e.latest.date).toLocaleDateString()}
                    </p>
                  </div>
                  <span className="text-xs text-[var(--muted)]">
                    {e.resultCount} run{e.resultCount === 1 ? "" : "s"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

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
              <li key={e.name}>
                <Link
                  href={`/baselines/exercise/${encodeURIComponent(e.name)}`}
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

function ScheduledRow({ s }: { s: ScheduledBaseline }) {
  const next =
    s.checkpoints.find((c) => c.status === "overdue" || c.status === "due") ??
    s.checkpoints.find((c) => c.status === "upcoming") ??
    s.checkpoints.at(-1)!;
  return (
    <Link
      href={`/baselines/test/${encodeURIComponent(s.testName)}`}
      className="flex items-center justify-between py-3 gap-2"
    >
      <div className="min-w-0">
        <p className="font-medium truncate">{s.testName}</p>
        <p className="text-xs text-[var(--muted)]">
          {s.latestResult
            ? `latest ${formatNum(s.latestResult.value)} ${s.units} · ${new Date(s.latestResult.date).toLocaleDateString()}`
            : "no results yet"}
        </p>
        <p className="text-xs">
          <span className={statusClass(next.status)}>
            {checkpointLabel(next)} {next.status}
          </span>
          <span className="text-[var(--muted)]">
            {" · week "}
            {next.week}
            {" · "}
            {new Date(next.targetDate).toLocaleDateString()}
          </span>
        </p>
      </div>
      <span className="text-xs text-[var(--muted)] shrink-0">
        {s.resultCount}/{s.checkpoints.length}
      </span>
    </Link>
  );
}

function StatusPill({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: "emerald" | "amber" | "red" | "muted";
}) {
  const cls =
    tone === "emerald"
      ? "border-[var(--success)]/40 text-[var(--success)]"
      : tone === "amber"
        ? "border-[var(--warning)]/40 text-[var(--warning)]"
        : tone === "red"
          ? "border-[var(--danger)]/40 text-[var(--danger)]"
          : "border-[var(--border)] text-[var(--muted)]";
  return (
    <div className={`rounded-lg border ${cls} py-2`}>
      <p className="text-lg font-semibold tabular-nums">{count}</p>
      <p className="text-xs">{label}</p>
    </div>
  );
}

function statusClass(s: CheckpointStatus): string {
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

function countByStatus(list: ScheduledBaseline[]): Record<CheckpointStatus, number> {
  const out: Record<CheckpointStatus, number> = { done: 0, due: 0, overdue: 0, upcoming: 0 };
  for (const s of list) {
    for (const c of s.checkpoints) out[c.status]++;
  }
  return out;
}

function formatNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function formatBest(e: { primary: string; bestValue: number; bestRaw: { weightLb: number | null; reps: number | null; durationSec: number | null } }): string {
  if (e.primary === "rm") return `~${Math.round(e.bestValue)} lb 1RM (${e.bestRaw.weightLb} × ${e.bestRaw.reps})`;
  if (e.primary === "reps") return `${e.bestValue} reps`;
  if (e.primary === "duration") return formatDuration(e.bestValue);
  return String(e.bestValue);
}

function formatDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}
