import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { BaselineBlockCard } from "@/components/BaselineBlockCard";
import { Card } from "@/components/Card";
import { OtherGoalsStrip } from "@/components/OtherGoalsStrip";
import { NutritionToday } from "@/components/NutritionToday";
import { CharacterHeader } from "@/components/game/CharacterHeader";
import { QuestCard } from "@/components/game/QuestCard";
import { addDays, dateKey, startOfDay, endOfDay, resolveDay, deriveDayDisplay, USER_TZ } from "@/lib/calendar";
import { CompletedWorkoutCard } from "@/components/days/CompletedWorkoutCard";
import { getDb } from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { getGoalCount } from "@/lib/goal-count";
import { computeGameState } from "@/lib/game/engine";
import { getGoalEvents } from "@/lib/goal-events";
import { getActiveProgram, getActiveProgramMembership, phaseForWeekIndex, splitDayForRotationDay } from "@/lib/program";
import type { Block, ExercisePrescription } from "@/lib/program-template";
import { blockTypeLabel, formatSecs } from "@/lib/plan-format";
import { getFocusGoal } from "@/lib/goal-focus";
import { ProjectTodayView } from "@/components/ProjectTodayView";
import { BetweenGoalsToday } from "@/components/BetweenGoalsToday";
import { getQuickPickFoods } from "@/lib/food-actions";
import { presentationForGoal } from "@/lib/goal-presentation";
import { computeGoalFeasibility } from "@/lib/rarity";
import { parseCoachFeasibility } from "@/lib/rarity-core";
import { FeasibilityReadout } from "@/components/FeasibilityReadout";
import { TodayTimeline } from "@/components/today/TodayTimeline";
import { assignGoalIdentities } from "@/lib/goal-identity";
import { buildTodayTimeline } from "@/lib/day-rhythm";
import { parseAttributionRules } from "@/lib/attribution-rules";
import { parseAttributionHints } from "@/lib/goal-attribution";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // D-1: Gate 0-goal users into onboarding (REQ-004).
  // A 0-goal user with no per-user dismiss cookie → /onboarding.
  // A 0-goal user who dismissed → stays here (B-2 empty state).
  // A user with goals → gate never fires; falls through to the program reads below.
  // getCurrentUserId() is React.cache-deduped — this call is free (same session user).
  const uid = await getCurrentUserId();
  const cookieName = `gm_onboarding_dismissed_${uid.slice(0, 16)}`;
  const [gateGoalCount, gateCookieJar] = await Promise.all([
    getGoalCount(),
    cookies(),
  ]);
  if (gateGoalCount === 0 && !gateCookieJar.get(cookieName)) {
    redirect("/onboarding");
  }

  // REQ-001: fetch program and focus goal in parallel — no waterfall.
  const [program, focusGoal] = await Promise.all([
    getActiveProgram(),
    getFocusGoal(),
  ]);
  const presentation = presentationForGoal(focusGoal);

  // Hoisted above the early-return branches below (both the between-goals
  // state and the main path need "today"'s window) so it's computed exactly
  // once, via the same @/lib/calendar helpers, never raw Date math.
  // Server-side dateKey — computed here so the client island never calls dateKey()
  // (process.env.USER_TZ is undefined in the browser).
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const todayDateKey = dateKey(now);

  // FIX (Today "between goals" state): the goal-completion feature releases
  // focus + deactivates the plan on complete_goal, so a veteran user who just
  // completed their only focus goal — before picking a new one — lands here
  // with program === null AND focusGoal === null, same as a brand-new user.
  // Distinguish by history: any other active goal, or a past completion,
  // means this is NOT a newbie — show the "between goals" state instead of
  // the onboarding "Get started" card. Strictly gated on focusGoal === null
  // (not the broader focusGoal?.kind !== "project" check below) so a fitness
  // focus goal stuck without an active plan — a separate, pre-existing edge
  // case — keeps falling through to its original (unchanged) behavior.
  if (!program && focusGoal === null) {
    const betweenGoalsDb = await getDb();
    const [
      activeGoals,
      latestAchieved,
      betweenGoalsGameState,
      betweenGoalsNutrition,
      betweenGoalsQuickPickFoods,
      betweenGoalsCompletedWorkouts,
    ] = await Promise.all([
      betweenGoalsDb.goal.findMany({
        where: { status: "active" },
        orderBy: [{ isFocus: "desc" }, { updatedAt: "desc" }],
        select: { id: true, objective: true, kind: true, targetDate: true, isFocus: true, active: true },
      }),
      betweenGoalsDb.goal.findFirst({
        where: { status: "achieved" },
        orderBy: { completedAt: "desc" },
        select: { id: true, objective: true, completedAt: true, completionSnapshot: true },
      }),
      // Plan/goal-independent daily utility surfaces — completing a goal must
      // not gut Today as the daily home. Mirrors the main path's fetches
      // below verbatim (same helpers, same USER_TZ window, same includes).
      computeGameState(),
      betweenGoalsDb.nutritionLog.findMany({
        where: { date: { gte: todayStart, lte: todayEnd } },
        orderBy: { date: "asc" },
      }),
      getQuickPickFoods(),
      betweenGoalsDb.workout.findMany({
        where: { status: "completed", startedAt: { gte: todayStart, lte: todayEnd } },
        orderBy: { startedAt: "asc" },
        include: {
          exercises: { orderBy: { orderIndex: "asc" }, include: { sets: { orderBy: { setIndex: "asc" } } } },
        },
      }),
    ]);
    if (activeGoals.length > 0 || latestAchieved) {
      return (
        <BetweenGoalsToday
          activeGoals={activeGoals}
          latestAchieved={latestAchieved}
          gameState={betweenGoalsGameState}
          todayNutrition={betweenGoalsNutrition}
          quickPickFoods={betweenGoalsQuickPickFoods}
          todayCompletedWorkouts={betweenGoalsCompletedWorkouts}
        />
      );
    }
  }

  // AC-C: null goal + null program (or fitness focus + no program) → get-started card.
  if (!program && focusGoal?.kind !== "project") {
    return (
      <div className="max-w-md mx-auto p-4">
        <Card title="Get started">
          <p className="text-sm text-[var(--muted)]">
            Welcome to Goaldmine — start by creating your first goal. Once you add a goal with a
            target date, your Today view fills in automatically.
          </p>
          <Link
            href="/onboarding"
            className="mt-3 inline-block text-sm font-medium text-[var(--accent)] hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded"
          >
            Get started →
          </Link>
        </Card>
      </div>
    );
  }

  // #289: project-focus routing is Program-aware. A project-focus user who is
  // a member of an active multi-domain Program renders the SAME unified Today
  // as every other Program tenant (one timeline, per-item goal marks —
  // RFC §7); ProjectTodayView survives ONLY as the zero-Program legacy
  // fallback (single-goal project tenants that predate the Program model).
  // The membership probe runs on project-focus renders only — fitness-focus
  // and zero-goal paths never pay it (resolveDay makes its own lookup later
  // either way).
  if (focusGoal?.kind === "project") {
    const projectMembership = await getActiveProgramMembership();
    const hasActiveProgramMembers =
      projectMembership !== null &&
      projectMembership.memberGoals.some((g) => g.status === "active");
    if (!hasActiveProgramMembers) {
      // Legacy tenant: no active Program → the original project view,
      // unchanged (CharacterHeader/gameState skipped inside it, as before).
      return <ProjectTodayView goal={focusGoal} />;
    }
    // Program member → fall through to the unified path. NOTE: `program`
    // (the ROTATION plan snapshot) may legitimately be null on this path.
  }

  // [v2 → #289] `program` (rotation snapshot) nullability truth table:
  //   (null + fitness/null focus)          → get-started card above;
  //   (null + project focus + no Program)  → ProjectTodayView above;
  //   (null + project focus + Program)     → falls through to HERE — every
  //   `program` use below is null-guarded; resolveDay resolves the day as
  //   out_of_plan and the timeline carries the Program's real asks.
  // #285: getTodayContext deleted — resolveDay (below) is the single
  // day-resolver; week/phase/split-day derive from its output further down.
  // now/todayStart/todayEnd/todayDateKey are computed above, before the
  // between-goals branch — shared by both paths, computed exactly once.

  const db = await getDb();
  const [recentWorkouts, resolved, gameState, weekGoalEvents, quickPickFoods, goalForFeas] =
    await Promise.all([
      db.workout.findMany({
        where: { status: "completed" },
        orderBy: { startedAt: "desc" },
        take: 3,
        include: { exercises: { include: { sets: true } } },
      }),
      resolveDay(now),
      // UXR-PV-85: the duplicate db.nutritionLog.findMany was deleted —
      // resolveDay already returns today's logs (same window, same order) as
      // resolved.loggedNutrition; NutritionToday consumes that below.
      computeGameState(),
      // REQ-106: 7-day lookahead for OtherGoalsStrip (today through today+6).
      // resolveDay already provides today's otherGoalEvents/crossGoalConflicts;
      // this call adds the week-ahead window. All date math via @/lib/calendar.
      getGoalEvents({ start: todayStart, end: endOfDay(addDays(now, 6)) }),
      getQuickPickFoods(),
      // GoalLike fields for computeGoalFeasibility — guarded because focusGoal can be null.
      // #289: focusGoal may be fitness, null, OR a project goal (a project-focus
      // Program member falls through to this path); computeGoalFeasibility is
      // kind-aware — ProjectTodayView called it for the same goal before.
      // A null focusGoal → goalForFeas resolves null → feasibility = null → no card rendered.
      focusGoal
        ? db.goal.findUnique({
            where: { id: focusGoal.id },
            select: { id: true, targetDate: true, targets: true, kind: true, coachFeasibility: true },
          })
        : Promise.resolve(null),
    ]);

  // #288: is this an active-Program tenant? Drives the Unified Today timeline
  // and nothing else — zero-Program users render byte-identically to the
  // pre-timeline page (TodayTimeline returns null; OtherGoalsStrip's
  // suppressTodayBlock stays false; no extra queries run for them).
  const memberGoals = resolved.program?.memberGoals ?? [];
  const isProgramUser = memberGoals.some((g) => g.status === "active");
  const memberIds = memberGoals.map((g) => g.id);

  // Second await batch — everything here needs `resolved` (D-2 kept the
  // feasibility read serial already; the additions ride the same round-trip).
  const [feasibility, todayCompletedDetails, programRulesRow, memberDetailRows] =
    await Promise.all([
      // FeasibilityReadout data. goalForFeas is null when focusGoal is null →
      // feasibility null → no card rendered. .catch(() => null) guards against
      // transient per-target query failures (D-4); the {feasibility && ...}
      // JSX guard absorbs null cleanly with no card shown.
      goalForFeas
        ? computeGoalFeasibility(goalForFeas).catch(() => null)
        : Promise.resolve(null),
      // Today's completed workouts, full detail — rendered in place of the
      // prescription when a workout was logged. UXR-PV-86: narrowed to the ids
      // resolveDay already returned so this can never disagree with `resolved`
      // about what happened today.
      db.workout.findMany({
        where: {
          id: { in: resolved.workouts.filter((w) => w.status === "completed").map((w) => w.id) },
        },
        orderBy: { startedAt: "asc" },
        include: {
          exercises: { orderBy: { orderIndex: "asc" }, include: { sets: { orderBy: { setIndex: "asc" } } } },
        },
      }),
      // #288 (Program users only): Program.attributionRules — the claim side
      // of the mark lane reuses the production link matcher, and rules are not
      // on ResolvedDay (calendar.ts is untouched by this story).
      isProgramUser
        ? db.program.findFirst({
            where: { id: resolved.program!.id },
            select: { attributionRules: true },
          })
        : Promise.resolve(null),
      // #288 (Program users only): member-goal detail for identity fidelity
      // (isFocus/createdAt for the UXR-PV-04 sort, legend for short labels)
      // + attributionHints for the claim matcher. One findMany, batched.
      isProgramUser
        ? db.goal.findMany({
            where: { id: { in: memberIds } },
            select: { id: true, isFocus: true, createdAt: true, attributionHints: true, legend: true },
          })
        : Promise.resolve([]),
    ]);

  // #288: goal identities + the unified timeline (pure derivations — zero
  // additional queries; all inputs are already in hand).
  const memberDetailById = new Map(memberDetailRows.map((r) => [r.id, r]));
  const identities = isProgramUser
    ? assignGoalIdentities(
        memberGoals.map((g) => ({
          ...g,
          isFocus: memberDetailById.get(g.id)?.isFocus,
          createdAt: memberDetailById.get(g.id)?.createdAt,
          legend: memberDetailById.get(g.id)?.legend,
        })),
      )
    : [];
  const timelineEntries = isProgramUser
    ? buildTodayTimeline({
        dateKey: todayDateKey,
        activeWorkout: resolved.activeWorkout,
        plannedHike: resolved.plannedHikeToday,
        baselinesDue: resolved.baselinesDue.map((b) => ({
          testName: b.test.testName,
          checkpoint: b.checkpoint,
          logged: b.loggedOnDate !== null,
        })),
        scheduledItems: resolved.scheduledItemsToday,
        nutritionPlan: resolved.nutritionPlan,
        loggedMealsCount: resolved.loggedNutrition.length,
        completedWorkouts: todayCompletedDetails.map((w) => ({
          title: w.title,
          exerciseNames: w.exercises.map((e) => e.name),
        })),
        members: memberGoals,
        goalMarks: resolved.goalMarks,
        attributionRules: programRulesRow
          ? parseAttributionRules(programRulesRow.attributionRules)
          : null,
        attributionHintsByGoal: new Map(
          memberDetailRows.map((r) => [r.id, parseAttributionHints(r.attributionHints)]),
        ),
      })
    : [];
  const coachFeas = goalForFeas ? parseCoachFeasibility(goalForFeas.coachFeasibility) : null;
  const targetDateLabel =
    goalForFeas?.targetDate != null
      ? new Intl.DateTimeFormat("en-US", {
          month: "short",
          day: "numeric",
          timeZone: USER_TZ,
        }).format(goalForFeas.targetDate)
      : null;

  // #285: getTodayContext's fields, now derived from resolveDay's output +
  // pure template lookups (field mapping, in-plan byte-identical):
  //   ctx.weekIndex → resolved.weekIndex           (already a ResolvedDay field)
  //   ctx.phase     → phaseForWeekIndex(template, resolved.weekIndex)
  //   ctx.day       → splitDayForRotationDay(template, resolved.rotationDay)
  // Out-of-plan dates (before startedOn / past totalWeeks) now render honestly:
  // weekIndex/phase/split-day are null, so the header shows "Off plan" instead
  // of the old function's clamped phantom rotation copy.
  // #289: null-guarded — a project-focus Program tenant may have no rotation
  // plan; both derive to null and the hero renders its Program-aware fallback.
  const todayPhase = program ? phaseForWeekIndex(program.template, resolved.weekIndex) : null;
  const rotationDayTemplate = program
    ? splitDayForRotationDay(program.template, resolved.rotationDay)
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
  // ACTIVE workout (on a deferred day there is none → fall back to the rotation split day / null).
  let summaryText: string | null = null;
  if (activeTemplate?.summary) {
    summaryText = activeTemplate.summary;
  } else if (rotationDayTemplate?.summary) {
    summaryText = rotationDayTemplate.summary;
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
          : rotationDayTemplate?.title);

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      {/* ── RPG Character Header — above hero; hidden when no active program ── */}
      {gameState.goalKind !== null && (
        <CharacterHeader state={gameState} />
      )}

      {/* REQ-106: Other-goals strip — between CharacterHeader and hero.
          UXR-62-05: PRD-fixed placement honored. Server component renders null
          when no non-focus events exist within the 7-day window.
          UXR-PV-91 (approved): for Program users the "Also today" block is
          suppressed — the timeline's mark lane already carries today's
          claims — while the 7-day lookahead + conflict rows stay. */}
      <OtherGoalsStrip
        events={weekGoalEvents}
        conflicts={resolved.crossGoalConflicts}
        todayKey={todayDateKey}
        suppressTodayBlock={isProgramUser}
      />

      {/* ── Hero: visually dominant workout card (REQ-D2) ── */}
      <section
        className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm space-y-3"
        aria-label="Today's workout"
      >
        {/* Eyeline: week / phase. #289: a Program tenant outside any rotation
            window (or with no rotation plan at all — the project-focus case)
            reads the Program's own name instead of a bare "Off plan"; the
            zero-Program render is unchanged. */}
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
            {resolved.weekIndex !== null
              ? `Week ${resolved.weekIndex}${todayPhase ? ` · Phase ${todayPhase.index} · ${todayPhase.name}` : ""}`
              : isProgramUser && resolved.program
                ? resolved.program.name
                : "Off plan"}
          </p>
        </div>

        {/* Title. #289: for a Program tenant an out-of-rotation day is still a
            real day (the timeline below carries the asks) — "Today", not the
            alarming "Off plan". Zero-Program render unchanged. */}
        <h1 className="text-2xl font-semibold tracking-tight">
          {workoutTitle ??
            (isRestDay
              ? "Rest / Active Recovery"
              : isOutOfPlan
                ? isProgramUser
                  ? "Today"
                  : "Off plan"
                : "Today")}
        </h1>

        {/* Date + summary */}
        <p className="text-sm text-[var(--muted)]">
          {dayLabel}
          {summaryText ? ` · ${summaryText}` : summaryText === null && !isOutOfPlan ? " · ask your coach to fill in this day's details" : ""}
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

      {/* ── #288: Unified Today timeline — Program users only. ONE list for
             the whole Program: rhythm-ladder order, every row carrying every
             goal claim it serves in the mark lane (RFC §7 — never per-goal
             sections). Renders null for zero-Program tenants, keeping their
             page byte-identical to the pre-timeline render. ── */}
      <TodayTimeline identities={identities} entries={timelineEntries} />

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
        <BaselineBlockCard index={0} tests={baselinesDue} weekIndex={resolved.weekIndex} />
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
          {dayBlocks.length === 0 ? (
            <p className="text-sm text-[var(--muted)] px-1">Nothing scheduled today.</p>
          ) : (
            dayBlocks.map((block, i) => (
              <BlockCard key={i} block={block} index={i + (showProminentBaseline ? 1 : 0)} />
            ))
          )}

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
        <BaselineBlockCard index={null} tests={baselinesDue} weekIndex={resolved.weekIndex} />
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
        <NutritionToday logs={resolved.loggedNutrition} plan={resolved.nutritionPlan} showLogForm={false} quickPickFoods={quickPickFoods} />
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
