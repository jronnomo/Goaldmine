import Link from "next/link";
import { BaselineBlockCard } from "@/components/BaselineBlockCard";
import { Card } from "@/components/Card";
import { OtherGoalsStrip } from "@/components/OtherGoalsStrip";
import { NutritionToday } from "@/components/NutritionToday";
import { CharacterHeader } from "@/components/game/CharacterHeader";
import { QuestCard } from "@/components/game/QuestCard";
import { addDays, dateKey, startOfDay, endOfDay, resolveDay, deriveDayDisplay, USER_TZ } from "@/lib/calendar";
import { CompletedWorkoutCard } from "@/components/days/CompletedWorkoutCard";
import { prisma } from "@/lib/db";
import { computeGameState } from "@/lib/game/engine";
import { getGoalEvents } from "@/lib/goal-events";
import { getActiveProgram, getTodayContext } from "@/lib/program";
import type { Block, ExercisePrescription } from "@/lib/program-template";
import { getFocusGoal } from "@/lib/goal-focus";
import { ProjectTodayView } from "@/components/ProjectTodayView";
import { getQuickPickFoods } from "@/lib/food-actions";
import { presentationForGoal } from "@/lib/goal-presentation";
import { computeGoalFeasibility } from "@/lib/rarity";
import { parseCoachFeasibility } from "@/lib/rarity-core";
import { FeasibilityReadout } from "@/components/FeasibilityReadout";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // REQ-001: fetch program and focus goal in parallel — no waterfall.
  const [program, focusGoal] = await Promise.all([
    getActiveProgram(),
    getFocusGoal(),
  ]);
  const presentation = presentationForGoal(focusGoal);

  // AC-C: null goal + null program (or fitness focus + no program) → existing NoActiveProgram card.
  if (!program && focusGoal?.kind !== "project") {
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

  // AC-A: project focus goal wins over any lingering fitness Program rows.
  // CharacterHeader/gameState are skipped on this path (no computeGameState call below).
  if (focusGoal?.kind === "project") {
    return <ProjectTodayView goal={focusGoal} />;
  }

  // [v2] program is guaranteed non-null at this point:
  // if it were null, one of the two guards above would have returned.
  // Truth table: (null + project) → early return; (null + fitness/null) → NoActiveProgram.
  const ctx = getTodayContext(program!);
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  // Server-side dateKey — computed here so the client island never calls dateKey()
  // (process.env.USER_TZ is undefined in the browser).
  const todayDateKey = dateKey(now);

  const [latestMeasurement, recentWorkouts, resolved, todayNutrition, gameState, weekGoalEvents, quickPickFoods, todayCompletedDetails, goalForFeas] =
    await Promise.all([
      prisma.measurement.findFirst({ orderBy: { date: "desc" } }),
      prisma.workout.findMany({
        where: { status: "completed" },
        orderBy: { startedAt: "desc" },
        take: 3,
        include: { exercises: { include: { sets: true } } },
      }),
      resolveDay(now),
      prisma.nutritionLog.findMany({
        where: { date: { gte: todayStart, lte: todayEnd } },
        orderBy: { date: "asc" },
      }),
      computeGameState(),
      // REQ-106: 7-day lookahead for OtherGoalsStrip (today through today+6).
      // resolveDay already provides today's otherGoalEvents/crossGoalConflicts;
      // this call adds the week-ahead window. All date math via @/lib/calendar.
      getGoalEvents({ start: todayStart, end: endOfDay(addDays(now, 6)) }),
      getQuickPickFoods(),
      // Today's completed workouts, full detail — rendered in place of the
      // prescription when a workout was logged (single source of truth).
      prisma.workout.findMany({
        where: { status: "completed", startedAt: { gte: todayStart, lte: todayEnd } },
        orderBy: { startedAt: "asc" },
        include: {
          exercises: { orderBy: { orderIndex: "asc" }, include: { sets: { orderBy: { setIndex: "asc" } } } },
        },
      }),
      // GoalLike fields for computeGoalFeasibility — guarded because focusGoal can be null.
      // The project early-return at line 46 already fired so focusGoal is fitness or null here.
      // A null focusGoal → goalForFeas resolves null → feasibility = null → no card rendered.
      focusGoal
        ? prisma.goal.findUnique({
            where: { id: focusGoal.id },
            select: { id: true, targetDate: true, targets: true, kind: true, coachFeasibility: true },
          })
        : Promise.resolve(null),
    ]);

  // Suppress latestMeasurement unused lint warning — kept for future Log sheet prop
  void latestMeasurement;

  // FeasibilityReadout data — computed sequentially after the Promise.all (D-2).
  // goalForFeas is null when focusGoal is null → feasibility is null → no card rendered.
  // .catch(() => null) guards against transient per-target query failures (D-4);
  // the {feasibility && ...} JSX guard absorbs null cleanly with no card shown.
  const feasibility = goalForFeas
    ? await computeGoalFeasibility(goalForFeas).catch(() => null)
    : null;
  const coachFeas = goalForFeas ? parseCoachFeasibility(goalForFeas.coachFeasibility) : null;
  const targetDateLabel =
    goalForFeas?.targetDate != null
      ? new Intl.DateTimeFormat("en-US", {
          month: "short",
          day: "numeric",
          timeZone: USER_TZ,
        }).format(goalForFeas.targetDate)
      : null;

  const baselinesDue = resolved.baselinesDue;
  // Authoritative, deferral-aware split (single source of truth — see deriveTodayTask):
  //   activeWorkout   = what to train as today's task (null on baseline/hike/out-of-plan)
  //   deferredWorkout = the rotation session that stepped aside (non-null only when deferred)
  // We never render the rotation workout from workoutTemplate directly — that's what let
  // a deferred session show up next to baseline tests.
  const activeTemplate = resolved.activeWorkout;
  const deferredTemplate = resolved.deferredWorkout;
  // When an override duplicates baselines as exercise blocks, treat the BaselineBlockCard
  // as canonical and hide any block whose exercises are all baseline tests for the day.
  const baselineNames = new Set(baselinesDue.map((b) => b.test.testName));
  const dropBaselineOnlyBlocks = (blocks: Block[]) =>
    blocks.filter(
      (b) => !(b.exercises.length > 0 && b.exercises.every((ex) => baselineNames.has(ex.name))),
    );
  const dayBlocks = dropBaselineOnlyBlocks(activeTemplate?.blocks ?? []);
  const deferredBlocks = dropBaselineOnlyBlocks(deferredTemplate?.blocks ?? []);

  // Baseline display state. An outstanding (unlogged) test is the day's task and
  // renders prominently above the workout; once every test is logged the block is
  // demoted below as a quiet "completed" reference, so a done retest doesn't
  // outrank the actual session.
  const hasOutstandingBaseline = baselinesDue.some((b) => !b.loggedOnDate);
  const showProminentBaseline = baselinesDue.length > 0 && hasOutstandingBaseline;
  const showCompletedBaseline = baselinesDue.length > 0 && !hasOutstandingBaseline;

  // Single source of truth for "which workout does today show" — shared with the
  // calendar label + day detail (deriveDayDisplay). A completed workout wins over
  // the prescription, so a swap/audible day shows the logged session here too
  // instead of the rotation default.
  const display = deriveDayDisplay({
    completedWorkouts: resolved.workouts
      .filter((w) => w.status === "completed")
      .map((w) => ({ id: w.id, title: w.title, startedAt: w.startedAt })),
    todayTask: resolved.todayTask,
    activeWorkout: activeTemplate,
    deferredWorkout: deferredTemplate,
  });
  const isCompletedDay = display.state === "completed";

  // --- REQ-D1: Derive completion / rest-day / planned state ---
  // Completed = a workout was logged today (resolveDay already queries this range).
  const completed = resolved.workouts.length > 0;

  // Rest / out-of-plan now read straight off the authoritative task kind.
  const isRestDay = !completed && resolved.todayTask === "rest";
  const isOutOfPlan = !completed && resolved.todayTask === "out_of_plan";

  // Planned: in-plan day with workout blocks, not yet completed, not rest day
  // (isPlanned = !completed && !isRestDay && !isOutOfPlan)

  // Derived label shown next to the Bullseye
  const stateLabel: string = completed
    ? "Completed"
    : resolved.todayTask === "baseline"
      ? "Baseline testing"
      : resolved.todayTask === "hike"
        ? "Hike day"
        : isRestDay
          ? "Rest day"
          : isOutOfPlan
            ? "No workout scheduled"
            : "Today's plan";

  const dayLabel = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date());

  // Summary copy — REQ-D4: no leaked dev string at old line 98. Driven by the
  // ACTIVE workout (on a deferred day there is none → fall back to ctx.day / null).
  let summaryText: string | null = null;
  if (activeTemplate?.summary) {
    summaryText = activeTemplate.summary;
  } else if (ctx.day?.summary) {
    summaryText = ctx.day.summary;
  }
  // When neither is available, summaryText stays null.
  // Previously this fell through to a dev-facing error string — removed (REQ-D4).
  // Server-side log for diagnosability if an active workout exists but has no summary:
  if (!summaryText && activeTemplate !== null) {
    console.warn("[Today] day template present but no summary found; plan details unavailable");
  }

  // Header title: once a workout is logged it follows the COMPLETED session
  // (deriveDayDisplay) so a swap shows what was actually done; otherwise it
  // follows the active task (the prescription, or the named baseline/hike day).
  const workoutTitle = isCompletedDay
    ? display.primaryTitle
    : activeTemplate?.title ??
      (resolved.todayTask === "baseline"
        ? "Baseline Testing"
        : resolved.todayTask === "hike"
          ? "Hike Day"
          : ctx.day?.title);

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      {/* ── RPG Character Header — above hero; hidden when no active program ── */}
      {gameState.goalKind !== null && (
        <CharacterHeader state={gameState} />
      )}

      {/* REQ-106: Other-goals strip — between CharacterHeader and hero.
          UXR-62-05: PRD-fixed placement honored. Server component renders null
          when no non-focus events exist within the 7-day window. */}
      <OtherGoalsStrip
        events={weekGoalEvents}
        conflicts={resolved.crossGoalConflicts}
        todayKey={todayDateKey}
      />

      {/* ── Hero: visually dominant workout card (REQ-D2) ── */}
      <section
        className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm space-y-3"
        aria-label="Today's workout"
      >
        {/* Eyeline: week / phase */}
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
            Week {ctx.weekIndex}
            {ctx.phase ? ` · Phase ${ctx.phase.index} · ${ctx.phase.name}` : ""}
          </p>
          <Link
            href="/import"
            className="text-xs rounded-full border border-[var(--border)] px-2 py-0.5 text-[var(--muted)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            + Import
          </Link>
        </div>

        {/* Title */}
        <h1 className="text-2xl font-semibold tracking-tight">
          {workoutTitle ?? (isRestDay ? "Rest / Active Recovery" : isOutOfPlan ? "Off plan" : "Today")}
        </h1>

        {/* Date + summary */}
        <p className="text-sm text-[var(--muted)]">
          {dayLabel}
          {summaryText ? ` · ${summaryText}` : summaryText === null && !isOutOfPlan ? " · plan details unavailable" : ""}
          {resolved.isOverride ? " · day overridden" : ""}
        </p>

        {/* Quest ribbon — replaces standalone TodayCelebration (THE FOLD, REQ-009) */}
        {/* QuestCard hosts TodayCelebration internally; exactly one completion moment. */}
        <QuestCard
          questToday={gameState.questToday}
          completed={completed}
          todayDateKey={todayDateKey}
          stateLabel={stateLabel}
        />

        {/* Rest-day recovery tip — driven from presentation registry */}
        {isRestDay && presentation.restCopy && (
          <p className="text-xs text-[var(--muted)] border-t border-[var(--border)] pt-3">
            <strong className="text-[var(--foreground)] font-medium">Recovery tip:</strong>{" "}
            {presentation.restCopy}
          </p>
        )}
      </section>

      {/* ── Feasibility (Reach) card — server-rendered from computeGoalFeasibility.
             Null when focusGoal is null (no focus goal set). Fitness hero above is
             byte-identical whether or not focusGoal is null. ── */}
      {feasibility && (
        <FeasibilityReadout
          feasibility={feasibility}
          targetDateLabel={targetDateLabel}
          coach={coachFeas}
        />
      )}

      {/* ── Baselines due — only when something is still outstanding (a completed
             retest is demoted below the workout). ── */}
      {showProminentBaseline && (
        <BaselineBlockCard index={0} tests={baselinesDue} weekIndex={ctx.weekIndex} />
      )}

      {/* ── The day's workout. Once a session is logged we show the COMPLETED workout
             (deriveDayDisplay — same source the calendar + detail use), so a swap shows
             what was actually done. Otherwise: the active prescription, or the dimmed
             deferred session on a baseline/hike day. ── */}
      {isCompletedDay ? (
        <>
          {display.plannedTitle && display.plannedTitle !== display.primaryTitle && (
            <p className="text-xs text-[var(--muted)] px-1">
              Planned: {display.plannedTitle} → logged: {display.primaryTitle}
            </p>
          )}
          {todayCompletedDetails.map((w) => (
            <CompletedWorkoutCard key={w.id} workout={w} />
          ))}
        </>
      ) : (
        <>
          {dayBlocks.map((block, i) => (
            <BlockCard key={i} block={block} index={i + (showProminentBaseline ? 1 : 0)} />
          ))}

          {/* Deferred rotation workout — stepped aside for today's baseline test or hike.
              Dimmed + labelled so it reads as "normally here, not today", never the task. */}
          {deferredTemplate && deferredBlocks.length > 0 && (
            <>
              <Card title={`Deferred today — ${deferredTemplate.title}`}>
                <p className="text-xs text-[var(--warning)]">
                  {resolved.todayTask === "baseline"
                    ? "Baseline testing day — the tests above are today's session. Your regular workout steps aside; a max-effort test is itself a hard day. Warm up thoroughly, then test."
                    : "Hike day — the planned hike is today's session. Your regular workout steps aside. If the hike doesn't happen, ask Claude whether to pick this up instead."}
                </p>
              </Card>
              <div className="opacity-60 space-y-4">
                {deferredBlocks.map((block, i) => (
                  <BlockCard key={i} block={block} index={i} />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* ── Completed baselines — demoted below the workout as a quiet "done"
             reference (no "N." prefix), so a finished retest isn't the day's lead. ── */}
      {showCompletedBaseline && (
        <BaselineBlockCard index={null} tests={baselinesDue} weekIndex={ctx.weekIndex} />
      )}

      {/* ── Nutrition summary (REQ-D2: keep; suppress inline log form — Log sheet owns it) ── */}
      <Card
        title="Nutrition"
        action={
          <Link href="/nutrition" className="text-sm text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded">
            All →
          </Link>
        }
      >
        <NutritionToday logs={todayNutrition} plan={resolved.nutritionPlan} showLogForm={false} quickPickFoods={quickPickFoods} />
      </Card>

      {/* ── Recent workouts ── */}
      {recentWorkouts.length > 0 && (
        <Card
          title="Recent workouts"
          action={
            <Link href="/history" className="text-sm text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded">
              All →
            </Link>
          }
        >
          <ul className="space-y-2 text-sm">
            {recentWorkouts.map((w) => (
              <li key={w.id}>
                <Link href={`/workouts/${w.id}`} className="flex justify-between focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded">
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
