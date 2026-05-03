import Link from "next/link";
import type { Phase, ProgramTemplate } from "@/lib/program-template";

export function PlanOverview({
  plan,
}: {
  plan: {
    id: string;
    name: string;
    startedOn: Date;
    endsOn: Date;
    weeks: number;
    template: ProgramTemplate;
  };
}) {
  const today = new Date();
  const elapsed = Math.max(
    0,
    Math.floor((today.getTime() - plan.startedOn.getTime()) / (1000 * 60 * 60 * 24)),
  );
  const currentWeek = Math.min(plan.weeks, Math.floor(elapsed / 7) + 1);

  return (
    <div className="space-y-4">
      <div className="text-sm">
        <p>
          {plan.weeks} weeks ·{" "}
          {new Date(plan.startedOn).toLocaleDateString()} →{" "}
          {new Date(plan.endsOn).toLocaleDateString()}
        </p>
        <p className="text-xs text-[var(--muted)] mt-1">
          You&apos;re in week <strong>{currentWeek}</strong> of {plan.weeks}. Today&apos;s
          specific session is on the{" "}
          <Link href="/" className="text-[var(--accent)]">
            Today
          </Link>{" "}
          tab.
        </p>
      </div>

      {plan.template.dailyMobility && (
        <details className="rounded-lg border border-[var(--border)] p-3">
          <summary className="text-sm font-medium cursor-pointer">
            Daily mobility · {plan.template.dailyMobility.durationMin} min
          </summary>
          {plan.template.dailyMobility.notes && (
            <p className="text-xs text-[var(--muted)] italic mt-2">
              {plan.template.dailyMobility.notes}
            </p>
          )}
          <ul className="mt-2 space-y-1 text-sm">
            {plan.template.dailyMobility.exercises.map((ex, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span>
                  {ex.name}
                  {ex.equipment ? <span className="text-[var(--muted)]"> · {ex.equipment}</span> : null}
                </span>
                <span className="text-[var(--muted)] tabular-nums shrink-0">
                  {ex.durationSec ? formatSecs(ex.durationSec) : ex.reps !== undefined ? `× ${ex.reps}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <ul className="space-y-3">
        {plan.template.phases.map((phase) => (
          <li key={phase.index}>
            <PhaseCard phase={phase} currentWeek={currentWeek} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function PhaseCard({ phase, currentWeek }: { phase: Phase; currentWeek: number }) {
  const isCurrent = phase.weeks.includes(currentWeek);
  const past = phase.weeks.every((w) => w < currentWeek);
  const tone = isCurrent
    ? "border-[var(--accent)]/60 bg-[var(--accent)]/5"
    : past
      ? "border-[var(--border)] opacity-70"
      : "border-[var(--border)]";

  return (
    <div className={`rounded-lg border p-3 ${tone}`}>
      <div className="flex justify-between items-baseline gap-2 mb-1">
        <p className="font-medium">
          Phase {phase.index}: {phase.name}
        </p>
        <p className="text-xs text-[var(--muted)] tabular-nums">
          weeks {phase.weeks[0]}–{phase.weeks.at(-1)}
          {isCurrent && " · now"}
        </p>
      </div>
      <p className="text-xs text-[var(--muted)]">{phase.goal}</p>

      <details className="mt-2">
        <summary className="text-xs text-[var(--accent)] cursor-pointer">
          Nutrition + mobility for this phase
        </summary>
        <div className="mt-2 space-y-2 text-xs">
          <div>
            <p className="font-medium">Nutrition</p>
            <p className="text-[var(--muted)]">{phase.nutrition.calorieGuidance}</p>
            <p className="text-[var(--muted)]">
              Protein: {phase.nutrition.proteinTargetG.low}–{phase.nutrition.proteinTargetG.high} g/day
            </p>
            <p className="text-[var(--muted)]">{phase.nutrition.hydration}</p>
            <ul className="mt-1 space-y-0.5 list-disc list-inside text-[var(--muted)]">
              {phase.nutrition.habits.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-medium">Mobility focus</p>
            <p className="text-[var(--muted)]">
              {phase.mobility.dailyMin} min daily · {phase.mobility.emphasis.join(", ")}
            </p>
            {phase.mobility.notes && (
              <p className="text-[var(--muted)] italic mt-1">{phase.mobility.notes}</p>
            )}
          </div>
        </div>
      </details>
    </div>
  );
}

function formatSecs(s: number): string {
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r === 0 ? `${m} min` : `${m}:${String(r).padStart(2, "0")}`;
  }
  return `${s}s`;
}
