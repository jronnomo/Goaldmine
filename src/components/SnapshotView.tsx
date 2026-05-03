// Compact rendering of a ProgramTemplate snapshot (used on revision detail).

import type {
  Block,
  DayTemplate,
  ExercisePrescription,
  ProgramTemplate,
} from "@/lib/program-template";

export function SnapshotView({
  template,
  highlight,
}: {
  template: ProgramTemplate | null;
  highlight?: Set<number>; // day-of-rotation indices to emphasize
}) {
  if (!template) {
    return <p className="text-sm text-[var(--muted)] italic">No prior snapshot.</p>;
  }
  return (
    <div className="space-y-3 text-sm">
      <div className="text-xs text-[var(--muted)]">
        {template.totalWeeks} weeks · {template.phases.length} phases
      </div>

      <details>
        <summary className="text-xs uppercase tracking-wide text-[var(--muted)] cursor-pointer">
          Phases
        </summary>
        <ul className="mt-2 space-y-2">
          {template.phases.map((p) => (
            <li key={p.index} className="rounded-lg border border-[var(--border)] p-2">
              <p className="font-medium">
                Phase {p.index}: {p.name}
              </p>
              <p className="text-xs text-[var(--muted)]">
                weeks {p.weeks[0]}–{p.weeks.at(-1)} · {p.goal}
              </p>
              <p className="text-xs text-[var(--muted)] italic">{p.emphasis}</p>
            </li>
          ))}
        </ul>
      </details>

      <details open>
        <summary className="text-xs uppercase tracking-wide text-[var(--muted)] cursor-pointer">
          Weekly split
        </summary>
        <ul className="mt-2 space-y-2">
          {template.weeklySplit.map((d) => (
            <li
              key={d.dayOfWeek}
              className={`rounded-lg border p-2 ${
                highlight?.has(d.dayOfWeek)
                  ? "border-amber-500/50 bg-amber-500/5"
                  : "border-[var(--border)]"
              }`}
            >
              <DaySnapshot day={d} />
            </li>
          ))}
        </ul>
      </details>

      <details>
        <summary className="text-xs uppercase tracking-wide text-[var(--muted)] cursor-pointer">
          Daily mobility
        </summary>
        <p className="text-xs mt-2">
          {template.dailyMobility.durationMin} min ·{" "}
          {template.dailyMobility.exercises.length} exercises
        </p>
      </details>

      <details>
        <summary className="text-xs uppercase tracking-wide text-[var(--muted)] cursor-pointer">
          Baseline week
        </summary>
        <p className="text-xs mt-2">
          {(template.baselineWeek ?? []).length} day(s) ·{" "}
          {(template.baselineWeek ?? []).reduce((acc, d) => acc + d.tests.length, 0)} test(s)
        </p>
      </details>
    </div>
  );
}

function DaySnapshot({ day }: { day: DayTemplate }) {
  return (
    <div>
      <p className="font-medium">
        Day {day.dayOfWeek}: {day.title}
      </p>
      <p className="text-xs text-[var(--muted)] italic">{day.summary}</p>
      <ul className="mt-1 space-y-2">
        {day.blocks.map((b, i) => (
          <li key={i}>
            <BlockSnapshot block={b} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function BlockSnapshot({ block }: { block: Block }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
        {block.label ?? block.type}
        {block.rounds ? ` · ${block.rounds} rounds` : ""}
        {block.restSec ? ` · ${block.restSec}s rest` : ""}
      </p>
      <ul className="space-y-1 mt-1">
        {block.exercises.map((ex, i) => (
          <li key={i} className="flex justify-between gap-2 text-xs">
            <span className="min-w-0">
              <span className="font-medium">{ex.name}</span>
              {ex.equipment && (
                <span className="text-[var(--muted)] font-normal"> · {ex.equipment}</span>
              )}
              {ex.weightHint && (
                <span className="block text-[var(--muted)]">{ex.weightHint}</span>
              )}
              {ex.notes && (
                <span className="block text-[var(--muted)] italic">{ex.notes}</span>
              )}
            </span>
            <span className="text-[var(--muted)] tabular-nums shrink-0 whitespace-nowrap">
              {compactPrescription(ex)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function compactPrescription(ex: ExercisePrescription): string {
  const parts: string[] = [];
  if (ex.sets) parts.push(`${ex.sets}×`);
  if (ex.reps !== undefined) parts.push(String(ex.reps));
  if (ex.durationSec !== undefined) parts.push(formatSecs(ex.durationSec));
  return parts.join(" ") || "—";
}

function formatSecs(s: number): string {
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r === 0 ? `${m} min` : `${m}:${String(r).padStart(2, "0")}`;
  }
  return `${s}s`;
}
