import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/Card";
import { prisma } from "@/lib/db";
import { getBaselineSchedule, type ScheduledBaseline, type CheckpointStatus } from "@/lib/records";
import type { Block, DayTemplate, ExercisePrescription, Phase, ProgramTemplate } from "@/lib/program-template";

export const dynamic = "force-dynamic";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default async function FullPlanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const goal = await prisma.goal.findUnique({
    where: { id },
    include: { plans: { where: { active: true }, orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!goal) notFound();
  const plan = goal.plans[0];
  if (!plan) {
    return (
      <div className="max-w-md mx-auto p-4">
        <Card title="No active plan">
          <p className="text-sm text-[var(--muted)]">
            <Link href={`/goals/${goal.id}`} className="text-[var(--accent)]">
              Back to goal
            </Link>
          </p>
        </Card>
      </div>
    );
  }

  const template = plan.planJson as unknown as ProgramTemplate;
  const today = new Date();
  const elapsed = Math.max(
    0,
    Math.floor((today.getTime() - plan.startedOn.getTime()) / (1000 * 60 * 60 * 24)),
  );
  const currentWeek = Math.min(plan.weeks, Math.floor(elapsed / 7) + 1);
  const currentPhase = template.phases.find((p) => p.weeks.includes(currentWeek));

  const schedule = await getBaselineSchedule();

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <header className="pt-2">
        <Link href={`/goals/${goal.id}`} className="text-sm text-[var(--accent)]">
          ← {goal.objective}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">Full plan</h1>
        <p className="text-sm text-[var(--muted)]">
          {plan.weeks} weeks · {new Date(plan.startedOn).toLocaleDateString()} →{" "}
          {new Date(plan.endsOn).toLocaleDateString()} · week {currentWeek}{" "}
          {currentPhase ? `· Phase ${currentPhase.index} ${currentPhase.name}` : ""}
        </p>
      </header>

      <nav className="flex gap-2 flex-wrap text-xs">
        <a href="#weekly-schedule" className="rounded-full border border-[var(--border)] px-3 py-1">
          Workouts
        </a>
        <a href="#phases" className="rounded-full border border-[var(--border)] px-3 py-1">
          Phases
        </a>
        <a href="#nutrition" className="rounded-full border border-[var(--border)] px-3 py-1">
          Nutrition
        </a>
        <a href="#mobility" className="rounded-full border border-[var(--border)] px-3 py-1">
          Mobility
        </a>
        <a href="#baselines" className="rounded-full border border-[var(--border)] px-3 py-1">
          Baselines
        </a>
      </nav>

      <section id="weekly-schedule" className="scroll-mt-4">
        <h2 className="text-lg font-semibold tracking-tight mb-2">Weekly workout schedule</h2>
        <p className="text-xs text-[var(--muted)] mb-3">
          The 7-day split. Same structure every week of every phase — load, volume, and the
          hiking-superset weight progress over phases.
        </p>
        <div className="space-y-3">
          {template.weeklySplit.map((day) => (
            <DayCard key={day.dayOfWeek} day={day} />
          ))}
        </div>
      </section>

      <section id="phases" className="scroll-mt-4">
        <h2 className="text-lg font-semibold tracking-tight mb-2">Phases</h2>
        <div className="space-y-3">
          {template.phases.map((p) => (
            <PhaseSummaryCard key={p.index} phase={p} currentWeek={currentWeek} />
          ))}
        </div>
      </section>

      <section id="nutrition" className="scroll-mt-4">
        <h2 className="text-lg font-semibold tracking-tight mb-2">Nutrition by phase</h2>
        <div className="space-y-3">
          {template.phases.map((p) => (
            <NutritionCard key={p.index} phase={p} currentWeek={currentWeek} />
          ))}
        </div>
      </section>

      <section id="mobility" className="scroll-mt-4">
        <h2 className="text-lg font-semibold tracking-tight mb-2">Mobility</h2>
        <Card title={`Daily routine · ${template.dailyMobility.durationMin} min`}>
          {template.dailyMobility.notes && (
            <p className="text-xs text-[var(--muted)] italic mb-2">{template.dailyMobility.notes}</p>
          )}
          <ul className="space-y-1 text-sm">
            {template.dailyMobility.exercises.map((ex, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span>
                  {ex.name}
                  {ex.equipment ? <span className="text-[var(--muted)]"> · {ex.equipment}</span> : null}
                </span>
                <span className="text-[var(--muted)] tabular-nums shrink-0">
                  {prescriptionRight(ex)}
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <div className="space-y-3 mt-3">
          {template.phases.map((p) => (
            <MobilityCard key={p.index} phase={p} currentWeek={currentWeek} />
          ))}
        </div>
      </section>

      <section id="baselines" className="scroll-mt-4">
        <h2 className="text-lg font-semibold tracking-tight mb-2">Baselines &amp; retests</h2>
        <p className="text-xs text-[var(--muted)] mb-3">
          Initial collection happens during week 1; retests follow each test&apos;s schedule. Results
          appear on the{" "}
          <Link href="/baselines" className="text-[var(--accent)]">
            Records
          </Link>{" "}
          page as you log them.
        </p>
        <div className="space-y-3">
          {schedule.scheduled.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No scheduled tests on this plan.</p>
          ) : (
            schedule.scheduled.map((s) => (
              <BaselineRow key={s.testName} s={s} />
            ))
          )}
        </div>
      </section>

      <p className="text-xs text-[var(--muted)] text-center pt-4">
        This plan is dynamic — log notes, ask Claude in claude.ai, and the changelog updates the
        full snapshot. View revisions on the{" "}
        <Link href={`/goals/${goal.id}`} className="text-[var(--accent)]">
          goal detail page
        </Link>
        .
      </p>
    </div>
  );
}

function DayCard({ day }: { day: DayTemplate }) {
  return (
    <Card
      title={`${DAY_NAMES[day.dayOfWeek - 1]} · ${day.title}`}
      action={
        <span className="text-xs text-[var(--muted)] uppercase tracking-wide">
          {day.category.replace("-", " ")}
        </span>
      }
    >
      <p className="text-xs text-[var(--muted)] italic mb-2">{day.summary}</p>
      <ol className="space-y-3">
        {day.blocks.map((block, i) => (
          <li key={i}>
            <BlockView block={block} index={i} />
          </li>
        ))}
      </ol>
    </Card>
  );
}

function BlockView({ block, index }: { block: Block; index: number }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
        {index + 1}. {block.label ?? blockTypeLabel(block.type)}
        {block.rounds ? ` · ${block.rounds} rounds` : ""}
        {block.restSec ? ` · ${block.restSec}s rest` : ""}
      </p>
      <ul className="space-y-2 mt-1">
        {block.exercises.map((ex, i) => (
          <li key={i} className="text-sm">
            <div className="flex justify-between items-baseline gap-3">
              <p className="font-medium min-w-0 break-words">
                {ex.name}
                {ex.equipment && (
                  <span className="text-[var(--muted)] font-normal"> · {ex.equipment}</span>
                )}
              </p>
              <span className="text-[var(--muted)] tabular-nums shrink-0 text-xs whitespace-nowrap">
                {compactPrescription(ex)}
              </span>
            </div>
            {ex.weightHint && (
              <p className="text-xs text-[var(--muted)] mt-0.5">{ex.weightHint}</p>
            )}
            {ex.notes && (
              <p className="text-xs text-[var(--muted)] italic mt-0.5">{ex.notes}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PhaseSummaryCard({ phase, currentWeek }: { phase: Phase; currentWeek: number }) {
  const isCurrent = phase.weeks.includes(currentWeek);
  return (
    <Card
      title={`Phase ${phase.index}: ${phase.name}`}
      action={
        <span className="text-xs text-[var(--muted)] tabular-nums">
          weeks {phase.weeks[0]}–{phase.weeks.at(-1)}
          {isCurrent && " · now"}
        </span>
      }
    >
      <p className="text-sm">{phase.goal}</p>
      <p className="text-xs text-[var(--muted)] mt-1 italic">{phase.emphasis}</p>
    </Card>
  );
}

function NutritionCard({ phase, currentWeek }: { phase: Phase; currentWeek: number }) {
  const isCurrent = phase.weeks.includes(currentWeek);
  return (
    <Card
      title={`Phase ${phase.index}: ${phase.name}`}
      action={
        <span className="text-xs text-[var(--muted)] tabular-nums">
          weeks {phase.weeks[0]}–{phase.weeks.at(-1)}
          {isCurrent && " · now"}
        </span>
      }
    >
      <div className="space-y-2 text-sm">
        <p>
          <span className="font-medium">Calories.</span>{" "}
          <span className="text-[var(--muted)]">{phase.nutrition.calorieGuidance}</span>
        </p>
        <p>
          <span className="font-medium">Protein.</span>{" "}
          <span className="text-[var(--muted)]">
            {phase.nutrition.proteinTargetG.low}–{phase.nutrition.proteinTargetG.high} g/day
          </span>
        </p>
        <p>
          <span className="font-medium">Hydration.</span>{" "}
          <span className="text-[var(--muted)]">{phase.nutrition.hydration}</span>
        </p>
        <ul className="list-disc list-inside text-[var(--muted)] space-y-0.5">
          {phase.nutrition.habits.map((h, i) => (
            <li key={i}>{h}</li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function MobilityCard({ phase, currentWeek }: { phase: Phase; currentWeek: number }) {
  const isCurrent = phase.weeks.includes(currentWeek);
  return (
    <Card
      title={`Phase ${phase.index}: ${phase.name}`}
      action={
        <span className="text-xs text-[var(--muted)] tabular-nums">
          weeks {phase.weeks[0]}–{phase.weeks.at(-1)}
          {isCurrent && " · now"}
        </span>
      }
    >
      <p className="text-sm">
        {phase.mobility.dailyMin} min daily ·{" "}
        <span className="text-[var(--muted)]">{phase.mobility.emphasis.join(", ")}</span>
      </p>
      {phase.mobility.notes && (
        <p className="text-xs text-[var(--muted)] italic mt-2">{phase.mobility.notes}</p>
      )}
    </Card>
  );
}

function prescriptionRight(ex: ExercisePrescription): string {
  const parts: string[] = [];
  if (ex.sets) parts.push(`${ex.sets}×`);
  if (ex.reps !== undefined) parts.push(String(ex.reps));
  if (ex.durationSec !== undefined) parts.push(formatSecs(ex.durationSec));
  return parts.join(" ");
}

function compactPrescription(ex: ExercisePrescription): string {
  const parts: string[] = [];
  if (ex.sets) parts.push(`${ex.sets}×`);
  if (ex.reps !== undefined) parts.push(String(ex.reps));
  if (ex.durationSec !== undefined) parts.push(formatSecs(ex.durationSec));
  return parts.join(" ") || "—";
}

function BaselineRow({ s }: { s: ScheduledBaseline }) {
  const next =
    s.checkpoints.find((c) => c.status === "overdue" || c.status === "due") ??
    s.checkpoints.find((c) => c.status === "upcoming") ??
    s.checkpoints.at(-1)!;
  return (
    <Link
      href={`/baselines/test/${encodeURIComponent(s.testName)}`}
      className="block rounded-lg border border-[var(--border)] p-3 hover:border-[var(--accent)] transition-colors"
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-medium truncate">{s.testName}</p>
        <span className={`text-xs uppercase tracking-wide shrink-0 ${baselineStatusClass(next.status)}`}>
          {next.label} {next.status}
        </span>
      </div>
      <p className="text-xs text-[var(--muted)] mt-1">
        {s.latestResult
          ? `latest ${formatNum(s.latestResult.value)} ${s.units}`
          : "no results yet"}
        {" · next: week "}
        {next.week}
        {" · "}
        {new Date(next.targetDate).toLocaleDateString()}
      </p>
      <p className="text-xs text-[var(--muted)] italic mt-1 line-clamp-2">{s.protocol}</p>
    </Link>
  );
}

function baselineStatusClass(s: CheckpointStatus): string {
  switch (s) {
    case "done":
      return "text-emerald-500";
    case "due":
      return "text-amber-500";
    case "overdue":
      return "text-red-500";
    default:
      return "text-[var(--muted)]";
  }
}

function formatNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function blockTypeLabel(t: Block["type"]): string {
  switch (t) {
    case "straight":
      return "Straight sets";
    case "superset":
      return "Superset";
    case "finisher":
      return "Finisher";
    case "mobility":
      return "Mobility";
    case "cardio":
      return "Cardio";
  }
}

function formatSecs(s: number): string {
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r === 0 ? `${m} min` : `${m}:${String(r).padStart(2, "0")}`;
  }
  return `${s}s`;
}
