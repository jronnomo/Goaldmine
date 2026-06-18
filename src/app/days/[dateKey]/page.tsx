import Link from "next/link";
import { BaselineBlockCard } from "@/components/BaselineBlockCard";
import { Card } from "@/components/Card";
import { DayOverrideForm } from "@/components/DayOverrideForm";
import { DayNoteForm } from "@/components/DayNoteForm";
import { NutritionToday } from "@/components/NutritionToday";
import {
  parseDateKey,
  resolveDay,
  deriveDayDisplay,
  startOfDay,
  endOfDay,
  USER_TZ,
} from "@/lib/calendar";
import type { Block, ExercisePrescription } from "@/lib/program-template";
import { prefillFromTemplate } from "@/lib/prescription-prefill";
import { WorkoutLoggerForm } from "@/components/days/WorkoutLoggerForm";
import { SkipDayControl } from "@/components/days/SkipDayControl";
import { HikeLogForm } from "@/components/days/HikeLogForm";
import { CompletedWorkoutCard } from "@/components/days/CompletedWorkoutCard";
import { CollapsibleCard } from "@/components/CollapsibleCard";
import { FootageForm } from "@/components/days/FootageForm";
import { FootageList, type SerializedMarker } from "@/components/days/FootageList";
import { canonicalExerciseName } from "@/lib/records";
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

  // Authoritative, deferral-aware split (single source of truth — see deriveTodayTask).
  // The planned card shows whichever workout applies: the active one, or — when a
  // baseline test / hike has deferred it — the stepped-aside rotation session, dimmed.
  const shownTemplate = r.activeWorkout ?? r.deferredWorkout;
  const isDeferred = r.deferredWorkout !== null;

  // Baseline display state. A test still owed (loggedOnDate == null) is the day's
  // task and renders prominently above the workout; once every test is logged the
  // block is demoted below the workout as a quiet "completed" reference, so a done
  // retest no longer outranks the actual session.
  const hasOutstandingBaseline = r.baselinesDue.some((b) => !b.loggedOnDate);
  const showProminentBaseline =
    r.baselinesDue.length > 0 && hasOutstandingBaseline && (isToday || isFuture);
  const showCompletedBaseline = r.baselinesDue.length > 0 && !hasOutstandingBaseline;

  // Single source of truth for the day's workout label (shared with Today + calendar).
  // When a workout is logged, the header names the COMPLETED session, not the
  // prescription — so a swap day reads the same here as everywhere else.
  const display = deriveDayDisplay({
    completedWorkouts: r.workouts
      .filter((w) => w.status === "completed")
      .map((w) => ({ id: w.id, title: w.title, startedAt: w.startedAt })),
    todayTask: r.todayTask,
    activeWorkout: r.activeWorkout,
    deferredWorkout: r.deferredWorkout,
  });

  // Hide workout blocks whose exercises are all baseline tests already
  // rendered in the BaselineBlockCard. Defensive for legacy overrides
  // that bake baselines into workoutJson; future audibles shouldn't.
  const baselineNames = new Set(r.baselinesDue.map((b) => b.test.testName));
  const dayBlocks = (shownTemplate?.blocks ?? []).filter(
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

  // ── Footage markers ──────────────────────────────────────────────────────────
  // CRIT: rawMarkers contains Date objects — serialize capturedAt to ISO string
  // before passing to client components. Never send Date objects to client.
  const rawMarkers = await prisma.footageMarker.findMany({
    where: { date: { gte: date, lte: endOfDay(date) } },
    orderBy: [{ highlight: "desc" }, { capturedAt: "asc" }, { createdAt: "asc" }],
  });
  const footageMarkers: SerializedMarker[] = rawMarkers.map((m) => ({
    id: m.id,
    label: m.label,
    kind: m.kind,
    filename: m.filename,
    externalRef: m.externalRef,
    capturedAt: m.capturedAt?.toISOString() ?? null, // no Date to client
    exerciseName: m.exerciseName,
    highlight: m.highlight,
  }));

  // Exercise picker — completed workout first, template fallback
  const footageExercises: { name: string }[] =
    completedDetails.length > 0
      ? Array.from(
          new Map(
            completedDetails
              .flatMap((w) =>
                w.exercises.map((ex) => ({ name: canonicalExerciseName(ex.name) })),
              )
              .map((ex) => [ex.name, ex]),
          ).values(),
        )
      : (shownTemplate?.blocks.flatMap((b) =>
          b.exercises.map((ex) => ({ name: ex.name })),
        ) ?? []);

  // REQ-106: separate target-date events (banner) from other types (inline header lines).
  const targetDateEvents = r.otherGoalEvents.filter((e) => e.type === "target-date");
  const secondaryEvents = r.otherGoalEvents.filter((e) => e.type !== "target-date");

  // Props for the logger form.
  const isRestDay = r.todayTask === "rest";
  const prefill = prefillFromTemplate(dayBlocks);
  const defaultTitle = shownTemplate?.title ?? "";
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
            ? `Week ${r.weekIndex} · Day ${r.rotationDay}${display.primaryTitle ? ` · ${display.primaryTitle}` : ""}`
            : "Outside the active plan window"}
          {r.isOverride && <span className="text-[var(--warning)]"> · custom override</span>}
        </p>
      </header>

      {showProminentBaseline && (
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
      {shownTemplate && dayBlocks.length > 0 && (
        <CollapsibleCard
          defaultOpen={completedWorkouts.length === 0}
          title={
            isDeferred
              ? `Deferred today — ${shownTemplate.title}`
              : isPast
                ? `Template: ${shownTemplate.title}`
                : `Planned: ${shownTemplate.title}`
          }
        >
          {isDeferred && (
            <p className="text-xs text-[var(--warning)] mb-2">
              {r.todayTask === "baseline"
                ? "Baseline testing day — the tests above are your session. This workout steps aside; a max-effort test is itself a hard day. Do a thorough warmup, then test."
                : "Hike day — the planned hike is your session. This workout steps aside. If the hike doesn't happen, ask Claude whether to pick it up instead."}
            </p>
          )}
          <div className={isDeferred ? "opacity-60" : undefined}>
            <p className="text-xs text-[var(--muted)] italic mb-2">{shownTemplate.summary}</p>
            <ol className="space-y-3">
              {dayBlocks.map((block, i) => (
                <li key={i}>
                  <BlockView block={block} index={i + (showProminentBaseline ? 1 : 0)} />
                </li>
              ))}
            </ol>
          </div>
        </CollapsibleCard>
      )}

      {/* Completed baselines for this day — demoted below the workout as a quiet
          "done" reference (no "N." prefix), so a finished retest doesn't read as
          the day's task. */}
      {showCompletedBaseline && (
        <BaselineBlockCard index={null} tests={r.baselinesDue} weekIndex={r.weekIndex} />
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
            templateTitle={shownTemplate?.title ?? null}
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

      {/* Footage card — all days (footage can be tagged retroactively or pre-tagged) */}
      <CollapsibleCard
        title={`Footage${footageMarkers.length > 0 ? ` (${footageMarkers.length})` : ""}`}
        defaultOpen={footageMarkers.length > 0}
      >
        <FootageList dateKey={dateKey} markers={footageMarkers} />
        <FootageForm date={dateKey} exercises={footageExercises} />
      </CollapsibleCard>

      {(r.nutritionPlan || r.loggedNutrition.length > 0) && (
        <Card title="Nutrition">
          <NutritionToday
            logs={r.loggedNutrition}
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
                  : shownTemplate
                    ? JSON.stringify(shownTemplate, null, 2)
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
