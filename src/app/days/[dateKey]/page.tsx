import Link from "next/link";
import { BaselineBlockCard } from "@/components/BaselineBlockCard";
import { Card } from "@/components/Card";
import { DayOverrideForm } from "@/components/DayOverrideForm";
import { DayNoteForm } from "@/components/DayNoteForm";
import { NutritionToday } from "@/components/NutritionToday";
import { parseDateKey, resolveDay, startOfDay } from "@/lib/calendar";
import type { Block, ExercisePrescription } from "@/lib/program-template";

export const dynamic = "force-dynamic";

export default async function DayDetail({
  params,
}: {
  params: Promise<{ dateKey: string }>;
}) {
  const { dateKey } = await params;
  const date = parseDateKey(dateKey);
  const r = await resolveDay(date);

  const today = startOfDay(new Date());
  const isPast = r.date < today;
  const isToday = r.date.getTime() === today.getTime();
  const isFuture = r.date > today;

  const dateLabel = r.date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  // Hide workout blocks whose exercises are all baseline tests already
  // rendered in the BaselineBlockCard. Defensive for legacy overrides
  // that bake baselines into workoutJson; future audibles shouldn't.
  const baselineNames = new Set(r.baselinesDue.map((b) => b.test.testName));
  const dayBlocks = (r.workoutTemplate?.blocks ?? []).filter(
    (b) =>
      !(
        b.exercises.length > 0 &&
        b.exercises.every((ex) => baselineNames.has(ex.name))
      ),
  );

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <header className="pt-2">
        <Link href="/calendar" className="text-sm text-[var(--accent)]">
          ← Calendar
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">{dateLabel}</h1>
        <p className="text-sm text-[var(--muted)]">
          {r.isGoalDate && <span className="text-[var(--accent)]">🏔️ Goal target — {r.goalObjective} · </span>}
          {r.isInPlan && r.rotationDay
            ? `Week ${r.weekIndex} · Day ${r.rotationDay}${r.workoutTemplate ? ` · ${r.workoutTemplate.title}` : ""}`
            : "Outside the active plan window"}
          {r.isOverride && <span className="text-[var(--warning)]"> · custom override</span>}
        </p>
      </header>

      {r.baselinesDue.length > 0 && (isToday || isFuture) && (
        <BaselineBlockCard index={0} tests={r.baselinesDue} weekIndex={r.weekIndex} />
      )}

      {isPast && r.workouts.length > 0 && (
        <Card title={`Logged workouts (${r.workouts.length})`}>
          <ul className="divide-y divide-[var(--border)]">
            {r.workouts.map((w) => (
              <li key={w.id}>
                <Link
                  href={`/workouts/${w.id}`}
                  className="flex justify-between items-baseline py-2 gap-2"
                >
                  <div>
                    <p className="font-medium">{w.title ?? "Workout"}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {new Date(w.startedAt).toLocaleTimeString()} · {w.exerciseCount} exercises
                    </p>
                  </div>
                  <span className="text-xs text-[var(--accent)]">View →</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {isPast && r.workouts.length === 0 && r.isInPlan && (
        <Card title="No workout logged">
          <p className="text-sm text-[var(--muted)]">
            No completed workout for this day.{" "}
            <Link href="/import" className="text-[var(--accent)]">
              Import one
            </Link>{" "}
            or log via Claude.
          </p>
        </Card>
      )}

      {(isToday || isFuture) && r.workoutTemplate && dayBlocks.length > 0 && (
        <Card
          title={
            r.workoutDeferredForBaseline
              ? `Deferred today — ${r.workoutTemplate.title}`
              : `Planned workout: ${r.workoutTemplate.title}`
          }
        >
          {r.workoutDeferredForBaseline && (
            <p className="text-xs text-[var(--warning)] mb-2">
              Baseline testing day — the tests above are your session. This workout steps aside; a
              max-effort test is itself a hard day. Do a thorough warmup, then test.
            </p>
          )}
          <div className={r.workoutDeferredForBaseline ? "opacity-60" : undefined}>
            <p className="text-xs text-[var(--muted)] italic mb-2">{r.workoutTemplate.summary}</p>
            <ol className="space-y-3">
              {dayBlocks.map((block, i) => (
                <li key={i}>
                  <BlockView block={block} index={i + (r.baselinesDue.length > 0 ? 1 : 0)} />
                </li>
              ))}
            </ol>
          </div>
        </Card>
      )}

      {(r.nutritionPlan || r.loggedNutrition.length > 0) && (
        <Card title="Nutrition">
          <NutritionToday
            logs={r.loggedNutrition.map((n) => ({
              id: n.id,
              date: n.date,
              mealType: n.mealType,
              items: n.items,
              notes: n.notes,
            }))}
            plan={r.nutritionPlan}
            showLogForm={false}
          />
        </Card>
      )}

      {(r.nutritionText || r.mobilityText) && (
        <Card title="Custom guidance">
          {r.nutritionText && (
            <div className="mb-2">
              <p className="text-sm font-medium">Nutrition notes</p>
              <p className="text-sm text-[var(--muted)] whitespace-pre-wrap">{r.nutritionText}</p>
            </div>
          )}
          {r.mobilityText && (
            <div>
              <p className="text-sm font-medium">Mobility</p>
              <p className="text-sm text-[var(--muted)] whitespace-pre-wrap">{r.mobilityText}</p>
            </div>
          )}
        </Card>
      )}

      {r.notesAboutDate.length > 0 && (
        <Card title={`Notes for this day (${r.notesAboutDate.length})`}>
          <ul className="space-y-2">
            {r.notesAboutDate.map((n) => (
              <li
                key={n.id}
                className="rounded-lg border border-[var(--border)] p-3 text-sm"
              >
                <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
                  {n.type}
                  {n.targetDate ? " · for this day" : " · written this day"}
                </p>
                <p className="whitespace-pre-wrap mt-1">{n.body}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {(isToday || isFuture) && (
        <>
          <Card title="Edit this day directly">
            <p className="text-xs text-[var(--muted)] mb-3">
              Override the workout, nutrition, or mobility for this day only. Leave any field blank
              to fall back to the rotation default.
            </p>
            <DayOverrideForm
              dateKey={dateKey}
              defaults={{
                workoutJson: r.override?.workoutJson
                  ? JSON.stringify(r.override.workoutJson, null, 2)
                  : r.workoutTemplate
                    ? JSON.stringify(r.workoutTemplate, null, 2)
                    : "",
                nutritionText: r.nutritionText ?? "",
                mobilityText: r.mobilityText ?? "",
                notes: r.notes ?? "",
              }}
              hasOverride={r.isOverride || !!r.nutritionText || !!r.mobilityText || !!r.notes}
            />
          </Card>

          <Card title="Or send Claude a note for this day">
            <p className="text-xs text-[var(--muted)] mb-3">
              Write a note tagged to this date — Claude will read it via MCP and propose a plan
              update for this day (and cascade if needed). The note is saved with{" "}
              <code>targetDate</code> set to <strong>{dateKey}</strong>.
            </p>
            <DayNoteForm dateKey={dateKey} />
          </Card>
        </>
      )}
    </div>
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

function compactPrescription(ex: ExercisePrescription): string {
  const parts: string[] = [];
  if (ex.sets) parts.push(`${ex.sets}×`);
  if (ex.reps !== undefined) parts.push(String(ex.reps));
  if (ex.durationSec !== undefined) parts.push(formatSecs(ex.durationSec));
  return parts.join(" ") || "—";
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
