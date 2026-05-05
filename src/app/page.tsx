import Link from "next/link";
import { BaselineBlockCard } from "@/components/BaselineBlockCard";
import { Card } from "@/components/Card";
import { LogMeasurementForm } from "@/components/LogMeasurementForm";
import { LogNoteForm } from "@/components/LogNoteForm";
import { NutritionToday } from "@/components/NutritionToday";
import { startOfDay, endOfDay, getPendingNotesCount, resolveDay } from "@/lib/calendar";
import { prisma } from "@/lib/db";
import { getActiveProgram, getTodayContext } from "@/lib/program";
import type { Block, ExercisePrescription } from "@/lib/program-template";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const program = await getActiveProgram();
  if (!program) {
    return (
      <div className="max-w-md mx-auto p-4">
        <Card title="No active program">
          <p className="text-sm text-[var(--muted)]">
            <strong className="font-semibold text-[var(--foreground)]">No active program yet.</strong>{" "}
            Run <code className="text-xs bg-[var(--card)] px-1 rounded">npx prisma db seed</code> to create the 90-day plan.
          </p>
        </Card>
      </div>
    );
  }

  const ctx = getTodayContext(program);
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);

  const [latestMeasurement, recentWorkouts, resolved, pending, todayNutrition] =
    await Promise.all([
      prisma.measurement.findFirst({ orderBy: { date: "desc" } }),
      prisma.workout.findMany({
        orderBy: { startedAt: "desc" },
        take: 3,
        include: { exercises: { include: { sets: true } } },
      }),
      resolveDay(now),
      getPendingNotesCount(),
      prisma.nutritionLog.findMany({
        where: { date: { gte: todayStart, lte: todayEnd } },
        orderBy: { date: "asc" },
      }),
    ]);

  const baselinesDue = resolved.baselinesDue;
  // The day's workout. resolved.workoutTemplate is override-aware: when an
  // apply_day_override has set workoutJson it returns that; otherwise the
  // rotation default. ctx.day stays around for week / phase metadata only.
  const dayTemplate = resolved.workoutTemplate;
  // When the override carries baselineTestNames, the workout often duplicates
  // those tests as exercise blocks (Claude packages "the workout IS the
  // baselines" that way). Treat BaselineBlockCard as canonical for tests and
  // hide blocks whose label is explicitly tagged "(... baseline)".
  const baselineBlockSuffix = /\bbaseline\)\s*$/i;
  const dayBlocks = (dayTemplate?.blocks ?? []).filter(
    (b) => !(b.label && baselineBlockSuffix.test(b.label)),
  );

  const dayLabel = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date());

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <header className="space-y-1 pt-2">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
            Week {ctx.weekIndex}
            {ctx.phase ? ` · Phase ${ctx.phase.index} · ${ctx.phase.name}` : ""}
          </p>
          <Link
            href="/import"
            className="text-xs rounded-full border border-[var(--border)] px-2 py-0.5 text-[var(--muted)] hover:text-foreground"
          >
            + Import
          </Link>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {dayTemplate?.title ?? ctx.day?.title ?? "No workout for today"}
        </h1>
        <p className="text-sm text-[var(--muted)]">
          {dayLabel}
          {dayTemplate?.summary
            ? ` · ${dayTemplate.summary}`
            : ctx.day?.summary
              ? ` · ${ctx.day.summary}`
              : " · plan snapshot is malformed; restore from /goals/<id>/revisions or contact your coach"}
          {resolved.isOverride ? " · day overridden" : ""}
        </p>
      </header>

      {pending.count > 0 && pending.goalId && (
        <Card title={`${pending.count} pending note${pending.count === 1 ? "" : "s"} since last revision`}>
          <p className="text-sm text-[var(--muted)] mb-2">
            Ask Claude to review them and propose plan updates.
          </p>
          <div className="flex gap-2 flex-wrap">
            <Link
              href={`/goals/${pending.goalId}`}
              className="text-xs rounded-full border border-[var(--border)] px-3 py-1"
            >
              View on goal →
            </Link>
            <Link
              href="/coach"
              className="text-xs rounded-full border border-[var(--accent)] text-[var(--accent)] px-3 py-1"
            >
              Coach prompts →
            </Link>
          </div>
        </Card>
      )}

      {baselinesDue.length > 0 && (
        <BaselineBlockCard index={0} tests={baselinesDue} weekIndex={ctx.weekIndex} />
      )}

      {dayBlocks.map((block, i) => (
        <BlockCard key={i} block={block} index={i + (baselinesDue.length > 0 ? 1 : 0)} />
      ))}

      {baselinesDue.length > 0 && (
        <Card>
          <p className="text-xs text-[var(--muted)]">
            <strong className="text-foreground">Test + workout pairing.</strong> Run the tests
            above fresh, then the workout — short power/skill tests pair fine. On days where the
            tests are long endurance or max-effort lifts, ask Claude whether to defer the regular
            blocks; stacking max-effort lifts on top of the same-pattern strength work confounds
            the data.
          </p>
        </Card>
      )}

      <Card title="Log weight">
        <p className="text-xs text-[var(--muted)] mb-2">
          Body weight (and optional resting heart rate). The text field is for context attached to <em>this</em> weigh-in — e.g. &ldquo;post-hike,&rdquo; &ldquo;morning fasted.&rdquo;
        </p>
        <LogMeasurementForm latestWeight={latestMeasurement?.weightLb ?? null} />
      </Card>

      <Card
        title="Nutrition"
        action={
          <Link href="/nutrition" className="text-sm text-[var(--accent)]">
            All →
          </Link>
        }
      >
        <NutritionToday logs={todayNutrition} />
      </Card>

      <Card
        title="Log a note"
        action={
          <Link href="/journal" className="text-sm text-[var(--accent)]">
            Journal →
          </Link>
        }
      >
        <p className="text-xs text-[var(--muted)] mb-2">
          Free-form, not tied to a weigh-in. Type tags it for Claude (Journal / Audible / Feedback).
        </p>
        <LogNoteForm />
      </Card>

      {recentWorkouts.length > 0 && (
        <Card
          title="Recent workouts"
          action={
            <Link href="/history" className="text-sm text-[var(--accent)]">
              All →
            </Link>
          }
        >
          <ul className="space-y-2 text-sm">
            {recentWorkouts.map((w) => (
              <li key={w.id}>
                <Link href={`/workouts/${w.id}`} className="flex justify-between">
                  <span>{w.title ?? "Workout"}</span>
                  <span className="text-[var(--muted)]">
                    {new Date(w.startedAt).toLocaleDateString()} · {w.exercises.length} ex
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function BlockCard({ block, index }: { block: Block; index: number }) {
  const blockTitle = block.label ?? defaultBlockLabel(block.type);
  return (
    <Card title={`${index + 1}. ${blockTitle}`}>
      <p className="text-xs uppercase tracking-wide text-[var(--muted)] mb-2">
        {blockTypeLabel(block.type)}
        {block.rounds ? ` · ${block.rounds} rounds` : ""}
        {block.restSec ? ` · ${block.restSec}s rest` : ""}
      </p>
      <ul className="space-y-2">
        {block.exercises.map((ex, i) => (
          <ExerciseRow key={i} ex={ex} />
        ))}
      </ul>
    </Card>
  );
}

function ExerciseRow({ ex }: { ex: ExercisePrescription }) {
  const parts: string[] = [];
  if (ex.sets) parts.push(`${ex.sets} set${ex.sets === 1 ? "" : "s"}`);
  if (ex.reps !== undefined) parts.push(`× ${ex.reps}`);
  if (ex.durationSec) parts.push(formatSecs(ex.durationSec));
  if (ex.weightHint) parts.push(ex.weightHint);

  return (
    <li>
      <p className="font-medium">
        {ex.name}
        {ex.equipment ? (
          <span className="text-[var(--muted)] font-normal"> · {ex.equipment}</span>
        ) : null}
      </p>
      {parts.length > 0 && <p className="text-sm text-[var(--muted)]">{parts.join(" · ")}</p>}
      {ex.notes && <p className="text-xs text-[var(--muted)] italic">{ex.notes}</p>}
    </li>
  );
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

function defaultBlockLabel(t: Block["type"]): string {
  switch (t) {
    case "straight":
      return "Strength";
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
