// src/lib/game/engine.ts
// Core game engine: data fetch + day ledger + PR replay + streak + fold + badges.
//
// CRITICAL RULES (enforced here, never relax):
// - Only status === "completed" workouts/hikes earn XP.
// - NEVER call resolveDay() in a loop — override data fetched in bulk.
//   (A3/B4: the ledger's per-day DECISIONS — rotation position and
//   override→template/baseline resolution — come from @/lib/rotation-core,
//   the same shared code resolveDay and buildCell consume. Only the batched
//   fetch strategy is engine-specific; the decision SHAPE exists once.)
// - NEVER use raw Date methods (setHours/getDate/getMonth/getFullYear).
//   All date math goes through @/lib/calendar.
// - addDays from @/lib/calendar (start-of-day). NOT the private records.ts addDays
//   (which returns end-of-day — see research S-4).
// - Workout query: pure nested select, NO select+include mix (CRIT-2).
// - getActiveProgram() runs standalone BEFORE the 10-query Promise.all (CRIT-1).
// - All history queries (workouts, hikes, baselines, nutrition, reviews,
//   mobility, bonuses) are UNBOUNDED — all-time (CRIT-3 / Tech Lead ruling).
//   Only overrides are bounded to the plan window.

import { cache } from "react";
import { prisma, getDb } from "@/lib/db";
import { getActiveProgram, getMostRecentProgram, type ActiveProgramSnapshot } from "@/lib/program";
// #299: the shared rotation-owner accessor (see the goal fetch in
// _computeGameState for the tracked single-ledger fallback semantics).
import { getRotationOwnerGoal } from "@/lib/goal-focus";
import { dateKey, parseDateKey, startOfDay, endOfDay, addDays } from "@/lib/calendar";
import {
  rotationDay as rotationDayOf,
  weekIndex as weekIndexOf,
  lastPlanDayStart,
  mergeDayOverride,
} from "@/lib/rotation-core";
import { canonicalExerciseName, bestSetSummary, isBetter, type MetricKind, type MetricDirection } from "@/lib/records";
import { parseCompletionSnapshot } from "@/lib/goal-completion-core";
import {
  OVERALL_LEVEL_BASE,
  ATTR_LEVEL_BASE,
  FITNESS_XP,
  MILESTONE_THRESHOLDS,
  MILESTONE_XP,
  categoryToAttribute,
  prAttributeForExercise,
  baselineAttributeForTest,
  hikeXp,
  levelFromXp,
  goalAchievedXp,
} from "@/lib/game/rules";
import {
  classifyWorkoutContent,
  contentClassToAttribute,
  contentClassLabel,
} from "@/lib/game/classify";
import { BADGE_CATALOG, evaluateBadges } from "@/lib/game/badges";
import { rulePackForGoal } from "@/lib/game/attributes-registry";
import { projectQuestXp, type QuestDayInput } from "@/lib/game/quest";
import type {
  GameState,
  XpEvent,
  AttributeId,
  DayLedgerEntry,
  WorkoutRow,
  HikeRow,
  BonusRow,
  EngineContext,
  AttributeState,
} from "@/lib/game/types";

// ── Internal EngineData shape (NOT exported — server-only) ───────────────────
// Shaped by the 2-step fetch in _computeGameState.
type WorkoutWithSets = {
  id: string;
  startedAt: Date;
  status: string;
  source: string | null;
  exercises: Array<{
    name: string;
    sets: Array<{
      weightLb: number | null;
      reps: number | null;
      durationSec: number | null;
      distanceMi: number | null;
    }>;
  }>;
};

type EngineData = {
  program: ActiveProgramSnapshot;
  goal: { id: string; kind: string } | null;
  workouts: WorkoutWithSets[];
  hikes: Array<{
    id: string;
    date: Date;
    status: string;
    elevationFt: number;
    packWeightLb: number | null;
    durationMin: number;
  }>;
  baselines: Array<{
    id: string;
    date: Date;
    testName: string;
    value: number;
  }>;
  nutritionLogs: Array<{ date: Date }>;
  reviewNotes: Array<{ date: Date }>;
  mobilityCheckins: Array<{ date: Date }>;
  overridesByKey: Map<
    string,
    {
      workoutJson: unknown;
      baselineTestNames: string[] | null;
    }
  >;
  bonusRows: Array<{
    id: string;
    date: Date;
    amount: number;
    reason: string;
    attribute: string | null;
    source: string;
  }>;
  // R2 (fixes C-2 in the completion-ceremony critique): OPTIONAL, defaulted to
  // [] inside computeGameStateFromData. engine.scenario.test.ts's baseData()
  // casts `as never` (tsc-blind), and a required field here would crash every
  // existing scenario test at runtime the moment computeGameStateFromData
  // reads it. Making it optional means every current AND future fixture that
  // doesn't know about this field degrades safely to "no completed goals".
  completedGoals?: Array<{
    completedAt: Date;
    kind: string;
    objective: string;
    completionSnapshot: unknown; // Goal.completionSnapshot (raw JSON) — parsed below via parseCompletionSnapshot
  }>;
};

// ── Empty state returned when no active program ──────────────────────────────
function emptyState(): GameState {
  return {
    goalKind: null,
    level: 1,
    xp: 0,
    xpIntoLevel: 0,
    xpToNext: OVERALL_LEVEL_BASE,
    progress: 0,
    attributes: [],
    streak: { current: 0, longest: 0, todayCounted: false },
    badges: BADGE_CATALOG.map((def) => ({ def, dateKey: null })),
    recentEvents: [],
    events: [],
    questToday: null,
  };
}

// ── buildDayLedger ────────────────────────────────────────────────────────────
// Produces DayLedgerEntry[] for every in-plan calendar day up to today (inclusive).
// A3/B4 consolidation: never calls resolveDay (bulk-fetched data, no N+1), but
// the per-day DECISIONS — rotation position + override→template precedence +
// the scheduled-baseline set — come from @/lib/rotation-core (rotationDay/
// weekIndex/mergeDayOverride), the SAME code resolveDay and buildCell consume.
// The day index `d` IS the daysDelta for addDays(programStart, d) (the ledger
// walks wall-clock days), so the index-based rotationDay/weekIndex calls here
// are the same formulas resolveDay applies to its date-based delta.
// scripts/diff-xp-ledger.ts holds a frozen copy of the pre-consolidation logic
// and proves the ledger/XP output is unchanged over the founder's full history.
//
// Exported for the diff script + tests — production consumers go through
// computeGameState(); do not call this directly in app code.

export function buildDayLedger(
  program: ActiveProgramSnapshot,
  workoutsByDay: Map<string, WorkoutWithSets[]>,
  hikesByDay: Map<string, HikeRow[]>,
  baselinesByDay: Map<string, { testName: string; value: number }[]>,
  overridesByKey: Map<string, { workoutJson: unknown; baselineTestNames: string[] | null }>,
  now: Date,
): DayLedgerEntry[] {
  const ledger: DayLedgerEntry[] = [];
  const totalDays = program.template.totalWeeks * 7;
  const todayDk = dateKey(now);
  const programStart = startOfDay(program.startedOn);

  for (let d = 0; d < totalDays; d++) {
    const date = addDays(programStart, d);
    const dk = dateKey(date);

    // Only build entries up to today (future plan days have no data and would
    // falsely break streaks / generate empty adherence entries).
    if (dk > todayDk) break;

    // Steps 2-5 — rotation math + override→template + baseline-set resolution,
    // all from the shared rotation-core decision code.
    const rotationDay = rotationDayOf(d); // 1..7
    const weekIndex = weekIndexOf(d);     // 1..totalWeeks
    const override = overridesByKey.get(dk) ?? null;
    const core = mergeDayOverride(program.template, rotationDay, weekIndex, override);
    const workoutTemplate = core.workoutTemplate;
    const isOverride = core.isOverride;
    const dueBaselineNames = core.baselineTests.map((t) => t.test.testName);

    // Step 6 — workoutDeferredForBaseline (advisory). Engine-specific formula
    // kept verbatim: the ledger flag does NOT apply resolveDay's
    // hasUnloggedBaseline refinement (XP semantics unchanged — A3).
    const workoutDeferredForBaseline =
      dueBaselineNames.length > 0 &&
      !isOverride &&
      workoutTemplate !== null &&
      workoutTemplate.category !== "rest";

    // Step 7 — collect day's data
    const allWorkoutsOnDay = workoutsByDay.get(dk) ?? [];
    const isRestDay = workoutTemplate?.category === "rest";
    const dayHikes = hikesByDay.get(dk) ?? [];
    const hasPlannedHike = dayHikes.some((h) => h.status === "planned");
    const loggedBaselineNames = (baselinesByDay.get(dk) ?? []).map((b) => b.testName);

    // Step 8 — assign category to completed WorkoutRows from the day template
    // WorkoutRow.category is NOT a Prisma field — resolved from the day template.
    const completedWorkouts: WorkoutRow[] = allWorkoutsOnDay
      .filter((w) => w.status === "completed")
      .map((w) => ({
        id: w.id,
        startedAt: w.startedAt,
        status: w.status,
        source: w.source,
        category: workoutTemplate?.category ?? null,
        // Modality from the workout's own exercises — credits off-plan effort
        // (mobility/cardio logged on a strength or rest day) the template misses.
        contentClass: classifyWorkoutContent(w.exercises),
      }));

    const completedHikes = dayHikes.filter((h) => h.status === "completed");

    const allDueBaselinesLogged =
      dueBaselineNames.length > 0 &&
      dueBaselineNames.every((name) => loggedBaselineNames.includes(name));

    // Step 9 — streak/adherence success
    const isToday = dk === todayDk;
    let streakSuccess: boolean;

    if (isRestDay) {
      streakSuccess = true;
    } else if (completedWorkouts.length > 0 || completedHikes.length > 0 || allDueBaselinesLogged) {
      streakSuccess = true;
    } else if (hasPlannedHike && completedHikes.length === 0 && completedWorkouts.length === 0) {
      streakSuccess = false; // planned-hike skipped with no workout = break
    } else if (isToday) {
      streakSuccess = false; // today not yet succeeded; excluded from break scan
    } else {
      streakSuccess = false; // missed workout
    }

    ledger.push({
      dateKey: dk,
      isInPlan: true, // all d in this range are in-plan by construction
      isRestDay,
      completedWorkouts,
      completedHikes,
      loggedBaselineNames,
      dueBaselineNames,
      hasPlannedHike,
      streakSuccess,
      workoutDeferredForBaseline,
    });
  }

  return ledger;
}

// ── PR Replay ─────────────────────────────────────────────────────────────────
// Matches recordsSetInWorkout semantics exactly (HIGH-4 fix):
// - Works chronologically (sorted by startedAt ASC, id ASC from query)
// - Groups by canonical name within a workout first
// - Compares workout's best against PRIOR snapshot (from earlier workouts only)
// - First occurrence → NOT a PR (nothing to beat)
// - 3/day cap on pr.set events

function buildPrEvents(workouts: WorkoutWithSets[]): XpEvent[] {
  const prBestByExercise = new Map<string, { primary: MetricKind; direction: MetricDirection; value: number }>();
  const prEventsByDay = new Map<string, XpEvent[]>();
  const allPrEvents: XpEvent[] = [];

  for (const workout of workouts) {
    if (workout.status !== "completed") continue;

    // Step 1: Build this workout's per-canonical best
    const workoutBestByExercise = new Map<string, { primary: MetricKind; direction: MetricDirection; value: number }>();
    for (const exercise of workout.exercises) {
      const canon = canonicalExerciseName(exercise.name);
      const summary = bestSetSummary(exercise.sets, canon);
      if (summary === null) continue;
      const existingBest = workoutBestByExercise.get(canon);
      if (!existingBest || isBetter(summary.direction, summary.value, existingBest.value)) {
        workoutBestByExercise.set(canon, {
          primary: summary.primary,
          direction: summary.direction,
          value: summary.value,
        });
      }
    }

    // Step 2: Compare this workout's bests against the PRIOR snapshot
    const dk = dateKey(workout.startedAt);
    for (const [canon, workoutBest] of workoutBestByExercise) {
      const prior = prBestByExercise.get(canon);

      if (!prior) {
        // First-ever record — NOT a PR (nothing to beat). Just establish baseline.
        prBestByExercise.set(canon, workoutBest);
        continue;
      }

      if (workoutBest.primary === prior.primary && isBetter(workoutBest.direction, workoutBest.value, prior.value)) {
        // Strict same-primary improvement — PR!
        const attr = prAttributeForExercise(canon);
        const event: XpEvent = {
          dateKey: dk,
          ruleId: "pr.set",
          label: `PR · ${canon}`,
          xp: FITNESS_XP.PR_SET,
          attribute: attr,
        };
        const dayPrs = prEventsByDay.get(dk) ?? [];
        if (dayPrs.length < 3) {
          allPrEvents.push(event);
          prEventsByDay.set(dk, [...dayPrs, event]);
        }
      }

      // Step 3: Update prior map with this workout's best regardless of PR outcome
      prBestByExercise.set(canon, workoutBest);
    }
  }

  return allPrEvents;
}

// ── Streak Algorithm ──────────────────────────────────────────────────────────
// Two-pass: Pass 1 = chronological (longest + milestone emission).
//           Pass 2 = backward from today (current streak).

function buildStreakAndMilestones(
  ledger: DayLedgerEntry[],
  now: Date,
): { streak: GameState["streak"]; milestoneEvents: XpEvent[] } {
  const todayDk = dateKey(now);
  const milestoneEvents: XpEvent[] = [];

  // ── Pass 1: chronological (longest + milestone emission) ──────────────────
  let longest = 0;
  let runLength = 0;

  for (const entry of ledger) {
    if (!entry.isInPlan) continue;
    if (entry.streakSuccess) {
      runLength++;
      if (runLength > longest) longest = runLength;
      for (const threshold of MILESTONE_THRESHOLDS) {
        if (runLength === threshold) {
          // Exact crossing — emits exactly once per crossing, re-earnable per run
          milestoneEvents.push({
            dateKey: entry.dateKey,
            ruleId: "streak.milestone",
            label: `${threshold}-day streak!`,
            xp: MILESTONE_XP[threshold]!,
            attribute: "CON",
          });
        }
      }
    } else {
      runLength = 0; // run resets; milestones re-earnable on next run
    }
  }

  // ── Pass 2: find current (walk backward from today) ───────────────────────
  const todayEntry = ledger.find((e) => e.dateKey === todayDk);
  const todayCounted = todayEntry?.streakSuccess ?? false;

  // R1 (fixes C-1, critical): the program-fallback (engine.ts's
  // getActiveProgram() ?? getMostRecentProgram()) can hand buildDayLedger a
  // plan whose own calendar window already ended before today — e.g. right
  // after completeGoalCore deactivates the goal's plan and the engine falls
  // back to that same, now-historical program. buildDayLedger only breaks
  // when a day is AFTER today, so a ledger that simply never reaches today
  // ends mid-history: its last entry is neither "today" nor "yesterday". The
  // backward walk below has no gap awareness — left alone, it would treat the
  // stale plan's last successful day as if it were yesterday and compute a
  // nonzero "current streak" out of training that may be weeks old, with the
  // dead gap silently spliced away. Detect the gap here and force current:0;
  // longest/milestones (Pass 1, chronological) are historical facts about the
  // stale plan's own run and stay untouched.
  const lastEntry = ledger.length > 0 ? ledger[ledger.length - 1]! : null;
  const lastEntryIsYesterday =
    lastEntry !== null &&
    dateKey(addDays(parseDateKey(lastEntry.dateKey), 1)) === todayDk;
  const hasGapBeforeToday =
    lastEntry !== null && lastEntry.dateKey !== todayDk && !lastEntryIsYesterday;

  let current = 0;
  if (!hasGapBeforeToday) {
    if (todayCounted) current = 1;

    // Walk backward from yesterday (or last in-plan day before today)
    const reversedLedger = [...ledger].reverse();
    for (const entry of reversedLedger) {
      if (entry.dateKey >= todayDk) continue; // skip today (already counted)
      if (!entry.isInPlan) break;             // stop at plan boundary
      if (entry.streakSuccess) {
        current++;
      } else {
        break;
      }
    }
  }

  return {
    streak: { current, longest, todayCounted },
    milestoneEvents,
  };
}

// ── Pure core: computeGameStateFromData ──────────────────────────────────────
// Exported separately for testing (no cache, no DB, injectable `now`).
// Never call resolveDay here — override data is pre-fetched.

export function computeGameStateFromData(data: EngineData, now: Date): GameState {
  const { program, goal, workouts, hikes, baselines, nutritionLogs, reviewNotes,
          mobilityCheckins, overridesByKey, bonusRows } = data;
  // R2: default to [] — see the EngineData.completedGoals comment above.
  const completedGoalsRaw = data.completedGoals ?? [];

  const todayDk = dateKey(now);
  const pack = rulePackForGoal(goal?.kind ?? "fitness");

  // ── Pre-compute per-day buckets (ALL TIME — not bounded to plan window) ───
  const workoutsByDay = new Map<string, WorkoutWithSets[]>();
  for (const w of workouts) {
    const dk = dateKey(w.startedAt);
    const arr = workoutsByDay.get(dk) ?? [];
    arr.push(w);
    workoutsByDay.set(dk, arr);
  }

  const hikesByDay = new Map<string, HikeRow[]>();
  for (const h of hikes) {
    const dk = dateKey(h.date);
    const arr = hikesByDay.get(dk) ?? [];
    arr.push({
      id: h.id,
      date: h.date,
      status: h.status,
      elevationFt: h.elevationFt,
      packWeightLb: h.packWeightLb,
    });
    hikesByDay.set(dk, arr);
  }

  const baselinesByDay = new Map<string, { testName: string; value: number }[]>();
  for (const b of baselines) {
    const dk = dateKey(b.date);
    const arr = baselinesByDay.get(dk) ?? [];
    arr.push({ testName: b.testName, value: b.value });
    baselinesByDay.set(dk, arr);
  }

  const nutritionCountByDay = new Map<string, number>();
  for (const n of nutritionLogs) {
    const dk = dateKey(n.date);
    nutritionCountByDay.set(dk, (nutritionCountByDay.get(dk) ?? 0) + 1);
  }

  // ── Build day ledger (plan window only — up to today) ─────────────────────
  const ledger = buildDayLedger(
    program,
    workoutsByDay,
    hikesByDay,
    baselinesByDay,
    overridesByKey,
    now,
  );

  // ── Collect all XP events ──────────────────────────────────────────────────
  const allEvents: XpEvent[] = [];

  // ── Ledger-derived events ─────────────────────────────────────────────────
  // Track which dateKeys have already emitted workout.completed (1/day cap)
  const workoutCompletedDays = new Set<string>();
  // Track mobility session days (1/day cap via Set)
  const mobilityByDay = new Set<string>();

  for (const entry of ledger) {
    if (!entry.isInPlan) continue;

    // adherence.day — every in-plan day that succeeded
    if (entry.streakSuccess) {
      allEvents.push({
        dateKey: entry.dateKey,
        ruleId: "adherence.day",
        label: "Plan adherence",
        xp: FITNESS_XP.ADHERENCE_DAY,
        attribute: "CON",
      });
    }

    // workout.completed — 1/day cap
    if (entry.completedWorkouts.length > 0 && !workoutCompletedDays.has(entry.dateKey)) {
      workoutCompletedDays.add(entry.dateKey);
      const workout = entry.completedWorkouts[0]!;
      const cat = workout.category;
      // Trait attribution is content-first: credit what was actually done, falling
      // back to the day's template category only when content is unclassifiable.
      // This lets off-plan effort (and any real workout logged on a rest day) earn
      // the matching trait instead of the scheduled-slot's trait (or nothing).
      const content = workout.contentClass ?? null;
      const contentAttr = content ? contentClassToAttribute(content) : null;
      const templateAttr = cat !== "rest" ? categoryToAttribute(cat) : null;
      const attr = contentAttr ?? templateAttr;
      if (attr) {
        const label = content
          ? contentClassLabel(content)
          : (cat === "upper" ? "Upper workout"
           : cat === "lower" ? "Lower workout"
           : cat === "zone2-mobility" ? "Zone-2 / Mobility"
           : cat === "calisthenics" ? "Calisthenics"
           : cat === "lower-power" ? "Lower power workout"
           : cat === "long-endurance" ? "Long endurance workout"
           : "Workout completed");
        allEvents.push({
          dateKey: entry.dateKey,
          ruleId: "workout.completed",
          label,
          xp: FITNESS_XP.WORKOUT_COMPLETED,
          attribute: attr,
        });
      }
    }

    // mobility.session — Zone-2 plan days OR any completed workout whose content
    // is actually mobility (off-plan mobility on a strength/rest day). Separate
    // 1/day-capped event, additive to workout.completed.
    if (!mobilityByDay.has(entry.dateKey)) {
      const isMobilityDay = entry.completedWorkouts.some(
        (w) => w.category === "zone2-mobility" || w.contentClass === "mobility",
      );
      if (isMobilityDay) {
        mobilityByDay.add(entry.dateKey);
        allEvents.push({
          dateKey: entry.dateKey,
          ruleId: "mobility.session",
          label: "Mobility session",
          xp: FITNESS_XP.MOBILITY_SESSION,
          attribute: "MOB",
        });
      }
    }
  }

  // ── workout.volume and workout.cardio (ALL TIME, per-workout, no daily cap) ─
  for (const workout of workouts) {
    if (workout.status !== "completed") continue;
    const dk = dateKey(workout.startedAt);

    let totalVolumeLb = 0;
    let totalCardioSec = 0;

    for (const exercise of workout.exercises) {
      for (const set of exercise.sets) {
        if (set.weightLb !== null && set.reps !== null) {
          totalVolumeLb += set.weightLb * set.reps;
        } else if (set.durationSec !== null && set.weightLb === null && set.reps === null) {
          totalCardioSec += set.durationSec;
        }
      }
    }

    // Volume XP (per 1000 lb, capped per workout)
    if (totalVolumeLb > 0) {
      const rawVolumeXp = Math.floor(totalVolumeLb / 1000) * FITNESS_XP.WORKOUT_VOLUME_PER_1000LB;
      const volumeXp = Math.min(rawVolumeXp, FITNESS_XP.WORKOUT_VOLUME_CAP);
      if (volumeXp > 0) {
        allEvents.push({
          dateKey: dk,
          ruleId: "workout.volume",
          label: "Volume",
          xp: volumeXp,
          attribute: "STR",
        });
      }
    }

    // Cardio XP (per 10 min, capped per workout)
    if (totalCardioSec > 0) {
      const rawCardioXp = Math.floor(totalCardioSec / 600) * FITNESS_XP.WORKOUT_CARDIO_PER_10MIN;
      const cardioXp = Math.min(rawCardioXp, FITNESS_XP.WORKOUT_CARDIO_CAP);
      if (cardioXp > 0) {
        allEvents.push({
          dateKey: dk,
          ruleId: "workout.cardio",
          label: "Cardio",
          xp: cardioXp,
          attribute: "END",
        });
      }
    }
  }

  // ── PR replay (ALL TIME, chronological, all workout types including baseline mirrors) ──
  const prEvents = buildPrEvents(workouts);
  allEvents.push(...prEvents);

  // ── baseline.logged (ALL TIME, per Baseline row) ──────────────────────────
  for (const b of baselines) {
    const dk = dateKey(b.date);
    const attr = baselineAttributeForTest(b.testName);
    allEvents.push({
      dateKey: dk,
      ruleId: "baseline.logged",
      label: `Baseline · ${b.testName}`,
      xp: FITNESS_XP.BASELINE_LOGGED,
      attribute: attr,
    });
  }

  // ── baseline.onTime (ALL TIME, per Baseline row — mirrors getBaselineSchedule §4.7) ──
  if (Array.isArray(program.template.baselineWeek)) {
    for (const b of baselines) {
      const bDk = dateKey(b.date);
      // Find the test definition
      let testFound = false;
      for (const baselineDay of program.template.baselineWeek) {
        for (const test of baselineDay.tests) {
          if (test.testName !== b.testName) continue;
          testFound = true;
          const initialWeek = test.initialWeek ?? 1;
          // Build checkpoint targets
          const checkpoints: Date[] = [
            endOfDay(addDays(program.startedOn, initialWeek * 7)),
            ...(test.retestWeeks ?? []).map((rw) =>
              endOfDay(addDays(program.startedOn, rw * 7)),
            ),
          ];
          for (const target of checkpoints) {
            // Window: [addDays(target, -7), endOfDay(addDays(target, 7))]
            const windowStart = addDays(target, -7);
            const windowEnd = endOfDay(addDays(target, 7));
            if (b.date >= windowStart && b.date <= windowEnd) {
              allEvents.push({
                dateKey: bDk,
                ruleId: "baseline.onTime",
                label: `Baseline on time · ${b.testName}`,
                xp: FITNESS_XP.BASELINE_ON_TIME,
                attribute: "CON",
              });
              break; // only award onTime once per baseline row (first matching checkpoint wins)
            }
          }
          break; // found test, done
        }
        if (testFound) break;
      }
    }
  }

  // ── hike.completed (ALL TIME, status=completed) ───────────────────────────
  for (const h of hikes) {
    if (h.status !== "completed") continue;
    const dk = dateKey(h.date);
    const xp = hikeXp(h.elevationFt, h.packWeightLb);
    allEvents.push({
      dateKey: dk,
      ruleId: "hike.completed",
      label: "Hike completed",
      xp,
      attribute: "END",
    });
  }

  // ── mobility.session — MobilityCheckin rows (ALL TIME, 1/day cap, checkin takes priority) ──
  // §4.3.B: Award for MobilityCheckin days first; skip zone2-mobility workout days
  // if already covered. The ledger loop above handles zone2-mobility workout-based sessions;
  // here we add MobilityCheckin rows, skipping days already covered by a workout session.
  for (const m of mobilityCheckins) {
    const dk = dateKey(m.date);
    if (mobilityByDay.has(dk)) continue; // already awarded from zone2-mobility workout
    mobilityByDay.add(dk);
    allEvents.push({
      dateKey: dk,
      ruleId: "mobility.session",
      label: "Mobility session",
      xp: FITNESS_XP.MOBILITY_SESSION,
      attribute: "MOB",
    });
  }

  // ── nutrition.day (ALL TIME, ≥2 logs/day → 1 event) ──────────────────────
  // §4.3.A: run over ALL nutritionLogs (not just plan window)
  for (const [dk, count] of nutritionCountByDay) {
    if (count >= 2) {
      allEvents.push({
        dateKey: dk,
        ruleId: "nutrition.day",
        label: "Nutrition logged",
        xp: FITNESS_XP.NUTRITION_DAY,
        attribute: "CON",
      });
    }
  }

  // ── review.weekly (ALL TIME, 1 per note row) ──────────────────────────────
  for (const r of reviewNotes) {
    const dk = dateKey(r.date);
    allEvents.push({
      dateKey: dk,
      ruleId: "review.weekly",
      label: "Weekly review",
      xp: FITNESS_XP.REVIEW_WEEKLY,
      attribute: "CON",
    });
  }

  // ── goal.achieved (ALL TIME, per achieved Goal row) ───────────────────────
  // Also builds the completedGoals list carried on EngineContext — one pass
  // covers both the XP event and the badge-predicate context so the two can
  // never disagree on xpBasis. Unparseable/legacy snapshots (parseCompletionSnapshot
  // → null) fall back to xpBasis {weeks:0, targetsMet:0} — base-XP only
  // (goalAchievedXp(0,0) === GOAL_XP.GOAL_ACHIEVED_BASE).
  const completedGoalsForCtx: EngineContext["completedGoals"] = completedGoalsRaw
    .map((g) => {
      const parsed = parseCompletionSnapshot(g.completionSnapshot);
      return {
        dateKey: dateKey(g.completedAt),
        kind: g.kind,
        objective: g.objective,
        xpBasisWeeks: parsed?.xpBasis.weeks ?? 0,
        xpBasisTargetsMet: parsed?.xpBasis.targetsMet ?? 0,
      };
    })
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));

  for (const g of completedGoalsForCtx) {
    allEvents.push({
      dateKey: g.dateKey,
      ruleId: "goal.achieved",
      label: `Goal achieved · ${g.objective}`,
      xp: goalAchievedXp(g.xpBasisWeeks, g.xpBasisTargetsMet),
      attribute: null,
    });
  }

  // ── Streak + milestones ────────────────────────────────────────────────────
  const { streak, milestoneEvents } = buildStreakAndMilestones(ledger, now);
  allEvents.push(...milestoneEvents);

  // ── bonus.coach (ALL TIME, no cap) ────────────────────────────────────────
  for (const b of bonusRows) {
    const dk = dateKey(b.date);
    allEvents.push({
      dateKey: dk,
      ruleId: "bonus.coach",
      label: `Coach: ${b.reason}`,
      xp: b.amount,
      attribute: b.attribute ?? null,
    });
  }

  // ── Fold events → attribute XP → levels ───────────────────────────────────
  const attributeXp = new Map<AttributeId, number>(
    pack.attributes.map((a) => [a.id, 0]),
  );
  let unattributedXp = 0;

  for (const event of allEvents) {
    if (event.attribute !== null && attributeXp.has(event.attribute)) {
      attributeXp.set(event.attribute, attributeXp.get(event.attribute)! + event.xp);
    } else {
      unattributedXp += event.xp;
    }
  }

  const overallXp = Array.from(attributeXp.values()).reduce((s, v) => s + v, 0) + unattributedXp;
  const { level: overallLevel, xpIntoLevel: overallInto, xpToNext: overallNext } =
    levelFromXp(overallXp, OVERALL_LEVEL_BASE);

  const attributes: AttributeState[] = pack.attributes.map((def) => {
    const attrXp = attributeXp.get(def.id) ?? 0;
    const { level, xpIntoLevel, xpToNext } = levelFromXp(attrXp, ATTR_LEVEL_BASE);
    return {
      id: def.id,
      label: def.label,
      level,
      xp: attrXp,
      xpIntoLevel,
      xpToNext,
      progress: xpToNext > 0 ? xpIntoLevel / xpToNext : 0,
    };
  });

  // ── Pre-compute EngineContext fields ───────────────────────────────────────
  // requiredInitialTestNames: all tests from baselineWeek where initialWeek === 1 (or unset)
  const requiredInitialTestNames: string[] = [];
  if (Array.isArray(program.template.baselineWeek)) {
    for (const baselineDay of program.template.baselineWeek) {
      for (const test of baselineDay.tests) {
        if ((test.initialWeek ?? 1) === 1) {
          requiredInitialTestNames.push(test.testName);
        }
      }
    }
  }

  // retestCheckpoints: one entry per distinct retest weekIndex
  const retestCheckpointMap = new Map<number, Set<string>>();
  if (Array.isArray(program.template.baselineWeek)) {
    for (const baselineDay of program.template.baselineWeek) {
      for (const test of baselineDay.tests) {
        for (const retestWeek of test.retestWeeks ?? []) {
          const set = retestCheckpointMap.get(retestWeek) ?? new Set<string>();
          set.add(test.testName);
          retestCheckpointMap.set(retestWeek, set);
        }
      }
    }
  }
  const retestCheckpoints = Array.from(retestCheckpointMap.entries()).map(
    ([weekIndex, names]) => ({ weekIndex, testNames: Array.from(names) }),
  );

  // nutritionQualDays: sorted dateKeys with ≥2 nutrition entries
  const nutritionQualDays = Array.from(nutritionCountByDay.entries())
    .filter(([, count]) => count >= 2)
    .map(([dk]) => dk)
    .sort();

  // Pre-compute setCountByWorkoutId and tonnageByWorkoutId for badge predicates
  const setCountByWorkoutId = new Map<string, number>();
  const tonnageByWorkoutId = new Map<string, number>();
  let totalSetCount = 0;
  let totalTonnageLb = 0;

  for (const workout of workouts) {
    if (workout.status !== "completed") continue;
    let sets = 0;
    let tonnage = 0;
    for (const exercise of workout.exercises) {
      for (const set of exercise.sets) {
        sets++;
        if (set.weightLb !== null && set.reps !== null) {
          tonnage += set.weightLb * set.reps;
        }
      }
    }
    setCountByWorkoutId.set(workout.id, sets);
    tonnageByWorkoutId.set(workout.id, tonnage);
    totalSetCount += sets;
    totalTonnageLb += tonnage;
  }

  const totalElevationFt = hikes
    .filter((h) => h.status === "completed")
    .reduce((s, h) => s + h.elevationFt, 0);

  const totalPRCount = allEvents.filter((e) => e.ruleId === "pr.set").length;

  // Prisma-free WorkoutRow[] for EngineContext (category resolved from ledger)
  const workoutsAll: WorkoutRow[] = workouts.map((w) => {
    // Find the category from ledger entry for this day (if any)
    const dk = dateKey(w.startedAt);
    const ledgerEntry = ledger.find((e) => e.dateKey === dk);
    const category =
      ledgerEntry?.completedWorkouts.find((cw) => cw.id === w.id)?.category ?? null;
    return {
      id: w.id,
      startedAt: w.startedAt,
      status: w.status,
      source: w.source,
      category,
    };
  });

  const hikesAll: HikeRow[] = hikes.map((h) => ({
    id: h.id,
    date: h.date,
    status: h.status,
    elevationFt: h.elevationFt,
    packWeightLb: h.packWeightLb,
  }));

  const baselineLogged = baselines.map((b) => ({
    dateKey: dateKey(b.date),
    testName: b.testName,
    value: b.value,
  }));

  const reviewNoteDateKeys = reviewNotes
    .map((r) => dateKey(r.date))
    .sort();

  const bonusRowsForCtx: BonusRow[] = bonusRows.map((b) => ({
    id: b.id,
    date: b.date,
    amount: b.amount,
    reason: b.reason,
    attribute: b.attribute,
    source: b.source,
  }));

  const ctx: EngineContext = {
    ledger,
    events: allEvents,
    attributeXp,
    unattributedXp,
    totalPRCount,
    totalSetCount,
    totalTonnageLb,
    totalElevationFt,
    workoutsAll,
    hikesAll,
    baselineLogged,
    reviewNoteDateKeys,
    bonusRows: bonusRowsForCtx,
    requiredInitialTestNames,
    retestCheckpoints,
    nutritionQualDays,
    setCountByWorkoutId,
    tonnageByWorkoutId,
    completedGoals: completedGoalsForCtx,
  };

  // ── Badge evaluation ───────────────────────────────────────────────────────
  const badges = evaluateBadges(ctx);

  // ── Recent events (last 30, sorted desc by dateKey then ruleId) ───────────
  const recentEvents = [...allEvents]
    .sort((a, b) => {
      const dk = b.dateKey.localeCompare(a.dateKey);
      return dk !== 0 ? dk : a.ruleId.localeCompare(b.ruleId);
    })
    .slice(0, 30);

  // ── Quest today ────────────────────────────────────────────────────────────
  // Delegates entirely to projectQuestXp (quest.ts) — single source of quest math.
  // Engine constructs QuestDayInput from its in-memory ledger and hikesByDay map,
  // then passes allEvents for earnedTodayXp filtering inside quest.ts.
  const todayLedgerEntry = ledger.find((e) => e.dateKey === todayDk);

  let questToday: GameState["questToday"] = null;
  if (todayLedgerEntry) {
    // Resolve planned hike for today (elevationFt/packWeightLb needed for hikeXp())
    const plannedHike =
      (hikesByDay.get(todayDk) ?? []).find((h) => h.status === "planned") ?? null;

    const questDayInput: QuestDayInput = {
      dateKey: todayDk,
      isRestDay: todayLedgerEntry.isRestDay,
      // Non-rest plan days always have a workout template; category may be null
      // pre-training (falls back to CATEGORY_ATTRIBUTE_FALLBACK inside quest.ts).
      workoutTemplate: !todayLedgerEntry.isRestDay
        ? { category: todayLedgerEntry.completedWorkouts[0]?.category ?? null }
        : null,
      baselinesDue: todayLedgerEntry.dueBaselineNames,
      plannedHikeToday: plannedHike
        ? { elevationFt: plannedHike.elevationFt, packWeightLb: plannedHike.packWeightLb }
        : null,
      nutritionLogCount: nutritionCountByDay.get(todayDk) ?? 0,
    };

    questToday = projectQuestXp(questDayInput, allEvents);
  }

  return {
    goalKind: goal?.kind ?? "fitness",
    level: overallLevel,
    xp: overallXp,
    xpIntoLevel: overallInto,
    xpToNext: overallNext,
    progress: overallNext > 0 ? overallInto / overallNext : 0,
    attributes,
    streak,
    badges,
    recentEvents,
    events: allEvents,
    questToday,
  };
}

// ── Inner async function (does the actual DB fetch + compute) ─────────────────
async function _computeGameState(): Promise<GameState> {
  const now = new Date(); // computed internally so cache() can deduplicate no-args calls

  // ── Step 1: program first (planStart/planEnd depend on it) ────────────────
  // CRIT-1: getActiveProgram() runs BEFORE Promise.all — planStart/planEnd needed
  // to bound the overrides query.
  // REQ-004c: fall back to the most-recently-updated plan/program when there is
  // no active one — e.g. right after completeGoalCore deactivates the goal's
  // plan(s). Without this, completing the founder's only goal would wipe
  // /character to emptyState() (Level 1 / 0 XP) instead of preserving history.
  // emptyState() is reserved for genuinely new users who have never had a plan.
  // (R1's streak gap-guard in buildStreakAndMilestones handles the phantom-streak
  // bug this fallback would otherwise create when the fallback plan's own
  // calendar window already ended before today.)
  const program = (await getActiveProgram()) ?? (await getMostRecentProgram());
  if (!program) return emptyState();

  const planStart = startOfDay(program.startedOn);
  const planEnd = endOfDay(lastPlanDayStart(program.startedOn, program.template.totalWeeks));

  // ── Step 2: fan out the remaining 10 queries ──────────────────────────────
  const db = await getDb();
  const [
    goal,
    workoutsRaw,
    hikesRaw,
    baselinesRaw,
    nutritionRaw,
    reviewsRaw,
    mobilityRaw,
    overridesRaw,
    bonusRaw,
    completedGoalsRaw,
  ] = await Promise.all([
    // 1. The goal whose KIND gates the attribute pack (#299, isFocus sweep).
    //    Primary path: the rotation-owning goal via the shared #297 helper —
    //    same resolution as calendar/Today/plan-lint, so the pack can never
    //    disagree with the day the ledger is scoring. Equivalence across the
    //    founder-history coverage set (proven by scripts/
    //    diff-engine-goal-context.ts pre/post snapshots, zero delta):
    //      • zero-Program rows → the helper IS the legacy isFocus query
    //        (byte-identical where/orderBy) — same goal, same kind, same XP.
    //      • active Program with rotation → the owner goal; for the founder
    //        the owner and the focus goal coincide (S4 backfill), and even
    //        when they diverge only goal.kind feeds XP — same kind = same
    //        ledger.
    //    TRACKED EXCEPTION (single-ledger v1 semantics, A3/Q3 — the M4c
    //    non-goal): when the helper yields null but the tenant still has a
    //    focus goal (active Program with NO rotation plan, or a retired
    //    Program), fall back to the legacy isFocus lookup instead of
    //    defaulting the pack to "fitness". The ledger keeps ONE goal context
    //    (no per-goal XP in v1); wiping the pack just because the rotation
    //    paused would silently re-gate attributes. Revisit when single-ledger
    //    v1 gains multi-goal awareness (Backlog: engine multi-goal ledger).
    (async () => {
      const { goal: owner } = await getRotationOwnerGoal();
      if (owner) return { id: owner.id, kind: owner.kind };
      return db.goal.findFirst({
        where: { isFocus: true },
        orderBy: { updatedAt: "desc" },
        select: { id: true, kind: true },
      });
    })(),

    // 2. Workouts: ALL TIME — pure nested select (CRIT-2: no select+include mix)
    //    Ordered (startedAt ASC, id ASC) for deterministic PR replay.
    db.workout.findMany({
      orderBy: [{ startedAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        startedAt: true,
        status: true,
        source: true,
        exercises: {
          select: {
            name: true,
            sets: {
              select: { weightLb: true, reps: true, durationSec: true, distanceMi: true },
            },
          },
        },
      },
    }),

    // 3. Hikes: ALL TIME
    db.hike.findMany({
      orderBy: { date: "asc" },
      select: {
        id: true,
        date: true,
        status: true,
        elevationFt: true,
        packWeightLb: true,
        durationMin: true,
      },
    }),

    // 4. Baselines: ALL TIME
    db.baseline.findMany({
      orderBy: { date: "asc" },
      select: { id: true, date: true, testName: true, value: true },
    }),

    // 5. NutritionLog: ALL TIME — date only
    db.nutritionLog.findMany({
      orderBy: { date: "asc" },
      select: { date: true },
    }),

    // 6. Review notes: ALL TIME
    db.note.findMany({
      where: { type: "review" },
      orderBy: { date: "asc" },
      select: { date: true },
    }),

    // 7. Mobility checkins: ALL TIME
    db.mobilityCheckin.findMany({
      orderBy: { date: "asc" },
      select: { date: true },
    }),

    // 8. PlanDayOverrides: BOUNDED to plan window (ledger resolution only)
    // planDayOverride is non-scoped (no userId FK) — use raw prisma.
    prisma.planDayOverride.findMany({
      where: {
        planId: program.id,
        date: { gte: planStart, lte: planEnd },
      },
      select: { date: true, workoutJson: true, baselineTestNames: true },
    }),

    // 9. GameBonusXp: ALL TIME (small; coach-granted only)
    db.gameBonusXp.findMany({
      orderBy: { date: "asc" },
      select: {
        id: true,
        date: true,
        amount: true,
        reason: true,
        attribute: true,
        source: true,
      },
    }),

    // 10. Completed goals: ALL TIME — feeds goal.achieved XP + the
    // completedGoals badge context (R6: joins this SAME Promise.all using the
    // already-resolved scoped `db` above — Goal is a SCOPED_MODEL; a fresh raw
    // `prisma.goal.findMany` here would leak every tenant's completed goals
    // into one user's XP/badge computation).
    db.goal.findMany({
      where: { status: "achieved", completedAt: { not: null } },
      select: { completedAt: true, kind: true, objective: true, completionSnapshot: true },
    }),
  ]);

  // Pre-bucket overrides by dateKey for O(1) lookup during ledger build
  const overridesByKey = new Map(
    overridesRaw.map((o) => [
      dateKey(o.date),
      {
        workoutJson: o.workoutJson,
        baselineTestNames: Array.isArray(o.baselineTestNames)
          ? (o.baselineTestNames as string[])
          : null,
      },
    ]),
  );

  const engineData: EngineData = {
    program,
    goal,
    workouts: workoutsRaw,
    hikes: hikesRaw,
    baselines: baselinesRaw,
    nutritionLogs: nutritionRaw,
    reviewNotes: reviewsRaw,
    mobilityCheckins: mobilityRaw,
    overridesByKey,
    bonusRows: bonusRaw,
    // where: {completedAt: {not: null}} guarantees non-null at the DB level;
    // Prisma's select type doesn't narrow on the filter, hence the cast.
    completedGoals: completedGoalsRaw.map((g) => ({
      completedAt: g.completedAt as Date,
      kind: g.kind,
      objective: g.objective,
      completionSnapshot: g.completionSnapshot,
    })),
  };

  return computeGameStateFromData(engineData, now);
}

// ── Exported cached wrapper (zero args — React cache() deduplication) ─────────
// First usage of React cache() in this codebase. All page and component consumers
// call computeGameState() with no args. The no-args pattern guarantees all
// same-request callers share one cache bucket (MED-6 fix / D-2).
export const computeGameState = cache(_computeGameState);

// ── Uncached escape hatch — for write-tool before/after diffs ────────────────
// React's cache() memoizes _computeGameState for the lifetime of the current
// request/render. A write tool (e.g. complete_goal) that reads game state
// BEFORE mutating and again AFTER, in the same request, must NOT go through
// the cached computeGameState for the "after" read — it would return the
// memoized "before" result even though the DB just changed underneath it.
// computeGameStateFresh is the same uncached _computeGameState, exported
// directly for exactly that before/after diff use case.
export const computeGameStateFresh = _computeGameState;

// Re-export parseDateKey for toDateKey usage in tools.ts
export { dateKey as toDateKey } from "@/lib/calendar";
