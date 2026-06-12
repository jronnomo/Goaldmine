import Link from "next/link";
import { BaselineBlockCard } from "@/components/BaselineBlockCard";
import { Card } from "@/components/Card";
import { DayOverrideForm } from "@/components/DayOverrideForm";
import { DayNoteForm } from "@/components/DayNoteForm";
import { NutritionToday } from "@/components/NutritionToday";
import {
  parseDateKey,
  resolveDay,
  startOfDay,
  USER_TZ,
} from "@/lib/calendar";
import type { Block, ExercisePrescription } from "@/lib/program-template";
import { prefillFromTemplate } from "@/lib/prescription-prefill";
import { WorkoutLoggerForm } from "@/components/days/WorkoutLoggerForm";
import { SkipDayControl } from "@/components/days/SkipDayControl";
import { HikeLogForm } from "@/components/days/HikeLogForm";
import { CompletedWorkoutCard } from "@/components/days/CompletedWorkoutCard";
import { CollapsibleCard } from "@/components/CollapsibleCard";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Format current time in USER_TZ as "HH:MM" for the logger time-field default. */
function nowHHMM(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: USER_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date())) parts[p.type] = p.value;
  const h = parts.hour ?? "12";
  const m = parts.minute ?? "00";
  // "24" is returned for midnight by some runtimes — fold to "00".
  return `${h === "24" ? "00" : h}:${m}`;
}

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

  // REQ-65-2: partition workouts into completed vs skipped.
  const completedWorkouts = r.workouts.filter((w) => w.status === "completed");
  const skippedWorkouts = r.workouts.filter((w) => w.status === "skipped");
  const existingSkip = skippedWorkouts.length > 0
    ? { id: skippedWorkouts[0]!.id, notes: skippedWorkouts[0]!.notes }
    : null;

  // Full exercise/set detail for completed workouts — rendered expanded in place
  // of the planned card (resolveDay only returns exercise counts).
  const completedDetails = completedWorkouts.length > 0
    ? await prisma.workout.findMany({
        where: { id: { in: completedWorkouts.map((w) => w.id) } },
        include: {
          exercises: {
            orderBy: { orderIndex: "asc" },
            include: { sets: { orderBy: { setIndex: "asc" } } },
          },
        },
        orderBy: { startedAt: "asc" },
      })
    : [];

  // REQ-106: separate target-date events (banner) from other types (inline header lines).
  const targetDateEvents = r.otherGoalEvents.filter((e) => e.type === "target-date");
  const secondaryEvents = r.otherGoalEvents.filter((e) => e.type !== "target-date");

  // Props for the logger form.
  const isRestDay = r.workoutTemplate?.category === "rest";
  const prefill = prefillFromTemplate(dayBlocks);
  const defaultTitle = r.workoutTemplate?.title ?? "";
  const defaultTimeHHMM = isToday ? nowHHMM() : "12:00";

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      {/* REQ-106: target-date banner ABOVE header — UXR-62-08.
          border var(--target) + low-alpha wash; body copy in --foreground for AA. */}
      {targetDateEvents.length > 0 && (
        <div
          data-testid="day-race-banner"
          className="rounded-2xl border border-[var(--target)] p-4 space-y-1"
          style={{ backgroundColor: "color-mix(in srgb, var(--target) 12%, var(--card))" }}
        >
          {targetDateEvents.map((e) => (
            <p key={`${e.goalId}-${e.type}`} className="font-medium text-[var(--foreground)]">
              {e.icon} {e.label} — {e.goalObjective}
            </p>
          ))}
        </div>
      )}

      {/* REQ-106: cross-goal conflict banner ABOVE header — UXR-62-09.
          3px var(--warning) left rail + warning wash; body copy in --foreground for AA;
          leading ◣ glyph in --warning; coach CTA in --accent. No resolve/dismiss button
          (resolution is conversational in claude.ai — this banner starts that conversation). */}
      {r.crossGoalConflicts.length > 0 && (
        <div
          data-testid="day-conflict-banner"
          className="rounded-2xl border border-[var(--warning)] border-l-[3px] p-4 space-y-2"
          style={{ backgroundColor: "color-mix(in srgb, var(--warning) 8%, var(--card))" }}
        >
          {r.crossGoalConflicts.map((c) => (
            <div key={`${c.dateKey}-${c.kind}`}>
              <p className="text-sm flex items-baseline gap-1.5">
                <span className="text-[var(--warning)]" aria-hidden>◣</span>
                <span className="text-[var(--foreground)]">{c.label}</span>
              </p>
              <p className="text-xs text-[var(--accent)] mt-1">
                Ask your coach to sort the week →
              </p>
            </div>
          ))}
        </div>
      )}

      <header className="pt-2">
        <Link href="/calendar" className="text-sm text-[var(--accent)]">
          ← Calendar
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">{dateLabel}</h1>
        <p className="text-sm text-[var(--muted)]">
          {r.isGoalDate && <span className="text-[var(--accent)]">🏔️ Goal target — {r.goalObjective} · </span>}
          {/* REQ-106: secondary other-goal events as muted inline lines.
              UXR-62-16: {icon} {label} — {objective} matching the isGoalDate idiom. */}
          {secondaryEvents.map((e) => (
            <span key={`${e.goalId}-${e.type}`} className="text-[var(--muted)]">
              {e.icon} {e.label} — {e.goalObjective} ·{" "}
            </span>
          ))}
          {r.isInPlan && r.rotationDay
            ? `Week ${r.weekIndex} · Day ${r.rotationDay}${r.workoutTemplate ? ` · ${r.workoutTemplate.title}` : ""}`
            : "Outside the active plan window"}
          {r.isOverride && <span className="text-[var(--warning)]"> · custom override</span>}
        </p>
      </header>

      {r.baselinesDue.length > 0 && (isToday || isFuture) && (
        <BaselineBlockCard index={0} tests={r.baselinesDue} weekIndex={r.weekIndex} />
      )}

      {/* Completed workouts — fully expanded, one card each (past and today). */}
      {completedDetails.map((w) => (
        <CompletedWorkoutCard key={w.id} workout={w} />
      ))}
      {/* Skip collapses to a muted line when a completed workout coexists. */}
      {completedDetails.length > 0 && existingSkip && (
        <p className="text-xs text-[var(--muted)] px-1">
          Also acknowledged as rest
          {existingSkip.notes ? ` — ${existingSkip.notes}` : ""}
        </p>
      )}

      {/* Planned card — expandable dropdown; collapsed once something is logged,
          open otherwise (past: as reference for logging; today/future: the active plan).
          "Planned" not "Planned workout" — goaldmine will grow non-workout disciplines. */}
      {r.workoutTemplate && dayBlocks.length > 0 && (
        <CollapsibleCard
          defaultOpen={completedWorkouts.length === 0}
          title={
            r.workoutDeferredForBaseline
              ? `Deferred today — ${r.workoutTemplate.title}`
              : isPast
                ? `Template: ${r.workoutTemplate.title}`
                : `Planned: ${r.workoutTemplate.title}`
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
        </CollapsibleCard>
      )}

      {/* REQ-65-2: Three-doors logging section.
          Past + today: after planned card.
          Future: hidden entirely. */}
      {!isFuture && (
        <div className="space-y-2">
          <WorkoutLoggerForm
            dateKey={dateKey}
            defaultTitle={defaultTitle}
            defaultTimeHHMM={defaultTimeHHMM}
            prefill={prefill}
          />
          {/* SkipDayControl renders null when isRestDay || !isInPlan (DA H3). */}
          <SkipDayControl
            dateKey={dateKey}
            templateTitle={r.workoutTemplate?.title ?? null}
            isRestDay={isRestDay}
            isInPlan={r.isInPlan}
            existingSkip={completedWorkouts.length > 0 ? null : existingSkip}
          />
          <HikeLogForm
            dateKey={dateKey}
            plannedHike={r.plannedHikeToday}
          />
        </div>
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
