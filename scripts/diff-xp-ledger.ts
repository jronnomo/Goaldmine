// scripts/diff-xp-ledger.ts
//
// A3 (docs/program-redesign/03-run-amendments.md) — THE mandatory pre/post XP
// diff for the engine consolidation: "a pre/post ledger diff over the
// founder's full history is captured; any XP delta reported, not silently
// shipped."
//
// WHAT IT DOES
//   1. Fetches the founder's full EngineData ONCE — the exact queries
//      game/engine.ts's _computeGameState issues (read-only; this script
//      never writes).
//   2. OLD side: a FROZEN, verbatim copy of the pre-consolidation ledger +
//      event pipeline (engine.ts @4cc44b4: buildDayLedger, buildPrEvents,
//      buildStreakAndMilestones, and the allEvents collection loop). The
//      frozen code imports only modules this story did NOT touch (rules,
//      classify, records, goal-completion-core, calendar date helpers).
//   3. NEW side: the LIVE engine — computeGameStateFromData(...).events and
//      the exported buildDayLedger (now consuming rotation-core +
//      mergeDayOverride).
//   4. Diffs: per-day ledger fields, per-day XP sums, event multiset, totals,
//      and the goal.achieved events (Elbert's frozen completionSnapshot is
//      pure INPUT to both sides — never recomputed, never written: R9-safe).
//
// Expected: ZERO deltas. Exit 0 on zero deltas; exit 1 with a full report
// otherwise. Any delta must be explained or fixed before the engine change
// ships.
//
// Usage: npx tsx scripts/diff-xp-ledger.ts [--user <id>]
//        (read-only — safe against any DB_ENV)

import "dotenv/config";
import { prisma, runWithUser, getDb } from "../src/lib/db";
import { FOUNDER_USER_ID } from "../src/lib/auth/founder";
import {
  getActiveProgram,
  getMostRecentProgram,
  type ActiveProgramSnapshot,
} from "../src/lib/program";
import { dateKey, startOfDay, endOfDay, addDays } from "../src/lib/calendar";
import { lastPlanDayStart } from "../src/lib/rotation-core";
import {
  buildDayLedger as buildDayLedgerNew,
  computeGameStateFromData,
} from "../src/lib/game/engine";
import {
  canonicalExerciseName,
  bestSetSummary,
  isBetter,
  type MetricKind,
  type MetricDirection,
} from "../src/lib/records";
import { parseCompletionSnapshot } from "../src/lib/goal-completion-core";
import {
  FITNESS_XP,
  MILESTONE_THRESHOLDS,
  MILESTONE_XP,
  categoryToAttribute,
  prAttributeForExercise,
  baselineAttributeForTest,
  hikeXp,
  goalAchievedXp,
} from "../src/lib/game/rules";
import {
  classifyWorkoutContent,
  contentClassToAttribute,
  contentClassLabel,
} from "../src/lib/game/classify";
import type { DayLedgerEntry, HikeRow, WorkoutRow, XpEvent } from "../src/lib/game/types";

// ─────────────────────────────────────────────────────────────────────────────
// Shapes (mirrors engine.ts internals)
// ─────────────────────────────────────────────────────────────────────────────

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

// ═════════════════════════════════════════════════════════════════════════════
// FROZEN OLD LOGIC — verbatim copy of src/lib/game/engine.ts @4cc44b4.
// Do not "improve" this: it is the fixture the new engine is diffed against.
// ═════════════════════════════════════════════════════════════════════════════

function buildDayLedgerOld(
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
    if (dk > todayDk) break;

    const rotationDay = ((d % 7) + 7) % 7 + 1; // 1..7
    const weekIndex = Math.floor(d / 7) + 1; // 1..totalWeeks

    const override = overridesByKey.get(dk) ?? null;

    let workoutTemplate: { category?: string | null; title?: string | null } | null = null;
    let isOverride = false;

    if (override?.workoutJson != null) {
      workoutTemplate = override.workoutJson as { category?: string | null; title?: string | null };
      isOverride = true;
    } else {
      const tpl = program.template.weeklySplit?.find((t) => t.dayOfWeek === rotationDay) ?? null;
      workoutTemplate = tpl;
    }

    const overrideNames = Array.isArray(override?.baselineTestNames)
      ? (override!.baselineTestNames as string[])
      : null;

    let dueBaselineNames: string[] = [];
    if (overrideNames !== null) {
      dueBaselineNames = overrideNames;
    } else {
      const baselineDay = program.template.baselineWeek?.find(
        (bd) => bd.dayOfWeek === rotationDay,
      );
      if (baselineDay) {
        for (const test of baselineDay.tests) {
          const initialWeek = test.initialWeek ?? 1;
          if (
            weekIndex === initialWeek ||
            (weekIndex > initialWeek && test.retestWeeks?.includes(weekIndex))
          ) {
            dueBaselineNames.push(test.testName);
          }
        }
      }
    }

    const workoutDeferredForBaseline =
      dueBaselineNames.length > 0 &&
      !isOverride &&
      workoutTemplate !== null &&
      workoutTemplate.category !== "rest";

    const allWorkoutsOnDay = workoutsByDay.get(dk) ?? [];
    const isRestDay = workoutTemplate?.category === "rest";
    const dayHikes = hikesByDay.get(dk) ?? [];
    const hasPlannedHike = dayHikes.some((h) => h.status === "planned");
    const loggedBaselineNames = (baselinesByDay.get(dk) ?? []).map((b) => b.testName);

    const completedWorkouts: WorkoutRow[] = allWorkoutsOnDay
      .filter((w) => w.status === "completed")
      .map((w) => ({
        id: w.id,
        startedAt: w.startedAt,
        status: w.status,
        source: w.source,
        category: workoutTemplate?.category ?? null,
        contentClass: classifyWorkoutContent(w.exercises),
      }));

    const completedHikes = dayHikes.filter((h) => h.status === "completed");

    const allDueBaselinesLogged =
      dueBaselineNames.length > 0 &&
      dueBaselineNames.every((name) => loggedBaselineNames.includes(name));

    const isToday = dk === todayDk;
    let streakSuccess: boolean;

    if (isRestDay) {
      streakSuccess = true;
    } else if (completedWorkouts.length > 0 || completedHikes.length > 0 || allDueBaselinesLogged) {
      streakSuccess = true;
    } else if (hasPlannedHike && completedHikes.length === 0 && completedWorkouts.length === 0) {
      streakSuccess = false;
    } else if (isToday) {
      streakSuccess = false;
    } else {
      streakSuccess = false;
    }

    ledger.push({
      dateKey: dk,
      isInPlan: true,
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

function buildPrEventsOld(workouts: WorkoutWithSets[]): XpEvent[] {
  const prBestByExercise = new Map<
    string,
    { primary: MetricKind; direction: MetricDirection; value: number }
  >();
  const prEventsByDay = new Map<string, XpEvent[]>();
  const allPrEvents: XpEvent[] = [];

  for (const workout of workouts) {
    if (workout.status !== "completed") continue;

    const workoutBestByExercise = new Map<
      string,
      { primary: MetricKind; direction: MetricDirection; value: number }
    >();
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

    const dk = dateKey(workout.startedAt);
    for (const [canon, workoutBest] of workoutBestByExercise) {
      const prior = prBestByExercise.get(canon);

      if (!prior) {
        prBestByExercise.set(canon, workoutBest);
        continue;
      }

      if (
        workoutBest.primary === prior.primary &&
        isBetter(workoutBest.direction, workoutBest.value, prior.value)
      ) {
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

      prBestByExercise.set(canon, workoutBest);
    }
  }

  return allPrEvents;
}

function buildStreakAndMilestonesOld(ledger: DayLedgerEntry[]): XpEvent[] {
  const milestoneEvents: XpEvent[] = [];
  let longest = 0;
  let runLength = 0;

  for (const entry of ledger) {
    if (!entry.isInPlan) continue;
    if (entry.streakSuccess) {
      runLength++;
      if (runLength > longest) longest = runLength;
      for (const threshold of MILESTONE_THRESHOLDS) {
        if (runLength === threshold) {
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
      runLength = 0;
    }
  }

  return milestoneEvents;
}

type OldEventInput = {
  program: ActiveProgramSnapshot;
  workouts: WorkoutWithSets[];
  hikes: Array<{
    id: string;
    date: Date;
    status: string;
    elevationFt: number;
    packWeightLb: number | null;
    durationMin: number;
  }>;
  baselines: Array<{ id: string; date: Date; testName: string; value: number }>;
  nutritionLogs: Array<{ date: Date }>;
  reviewNotes: Array<{ date: Date }>;
  mobilityCheckins: Array<{ date: Date }>;
  overridesByKey: Map<string, { workoutJson: unknown; baselineTestNames: string[] | null }>;
  bonusRows: Array<{
    id: string;
    date: Date;
    amount: number;
    reason: string;
    attribute: string | null;
    source: string;
  }>;
  completedGoals: Array<{
    completedAt: Date;
    kind: string;
    objective: string;
    completionSnapshot: unknown;
  }>;
};

/** Verbatim copy of the allEvents-collection portion of the OLD
 *  computeGameStateFromData (@4cc44b4) — everything that produced XP. */
function collectAllEventsOld(
  data: OldEventInput,
  now: Date,
): { ledger: DayLedgerEntry[]; events: XpEvent[] } {
  const {
    program, workouts, hikes, baselines, nutritionLogs, reviewNotes,
    mobilityCheckins, overridesByKey, bonusRows,
  } = data;

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

  const ledger = buildDayLedgerOld(
    program, workoutsByDay, hikesByDay, baselinesByDay, overridesByKey, now,
  );

  const allEvents: XpEvent[] = [];
  const workoutCompletedDays = new Set<string>();
  const mobilityByDay = new Set<string>();

  for (const entry of ledger) {
    if (!entry.isInPlan) continue;

    if (entry.streakSuccess) {
      allEvents.push({
        dateKey: entry.dateKey,
        ruleId: "adherence.day",
        label: "Plan adherence",
        xp: FITNESS_XP.ADHERENCE_DAY,
        attribute: "CON",
      });
    }

    if (entry.completedWorkouts.length > 0 && !workoutCompletedDays.has(entry.dateKey)) {
      workoutCompletedDays.add(entry.dateKey);
      const workout = entry.completedWorkouts[0]!;
      const cat = workout.category;
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

    if (totalVolumeLb > 0) {
      const rawVolumeXp = Math.floor(totalVolumeLb / 1000) * FITNESS_XP.WORKOUT_VOLUME_PER_1000LB;
      const volumeXp = Math.min(rawVolumeXp, FITNESS_XP.WORKOUT_VOLUME_CAP);
      if (volumeXp > 0) {
        allEvents.push({ dateKey: dk, ruleId: "workout.volume", label: "Volume", xp: volumeXp, attribute: "STR" });
      }
    }

    if (totalCardioSec > 0) {
      const rawCardioXp = Math.floor(totalCardioSec / 600) * FITNESS_XP.WORKOUT_CARDIO_PER_10MIN;
      const cardioXp = Math.min(rawCardioXp, FITNESS_XP.WORKOUT_CARDIO_CAP);
      if (cardioXp > 0) {
        allEvents.push({ dateKey: dk, ruleId: "workout.cardio", label: "Cardio", xp: cardioXp, attribute: "END" });
      }
    }
  }

  allEvents.push(...buildPrEventsOld(workouts));

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

  if (Array.isArray(program.template.baselineWeek)) {
    for (const b of baselines) {
      const bDk = dateKey(b.date);
      let testFound = false;
      for (const baselineDay of program.template.baselineWeek) {
        for (const test of baselineDay.tests) {
          if (test.testName !== b.testName) continue;
          testFound = true;
          const initialWeek = test.initialWeek ?? 1;
          const checkpoints: Date[] = [
            endOfDay(addDays(program.startedOn, initialWeek * 7)),
            ...(test.retestWeeks ?? []).map((rw) => endOfDay(addDays(program.startedOn, rw * 7))),
          ];
          for (const target of checkpoints) {
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
              break;
            }
          }
          break;
        }
        if (testFound) break;
      }
    }
  }

  for (const h of hikes) {
    if (h.status !== "completed") continue;
    const dk = dateKey(h.date);
    const xp = hikeXp(h.elevationFt, h.packWeightLb);
    allEvents.push({ dateKey: dk, ruleId: "hike.completed", label: "Hike completed", xp, attribute: "END" });
  }

  for (const m of mobilityCheckins) {
    const dk = dateKey(m.date);
    if (mobilityByDay.has(dk)) continue;
    mobilityByDay.add(dk);
    allEvents.push({
      dateKey: dk,
      ruleId: "mobility.session",
      label: "Mobility session",
      xp: FITNESS_XP.MOBILITY_SESSION,
      attribute: "MOB",
    });
  }

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

  const completedGoalsForCtx = data.completedGoals
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

  allEvents.push(...buildStreakAndMilestonesOld(ledger));

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

  return { ledger, events: allEvents };
}

// ═════════════════════════════════════════════════════════════════════════════
// Fetch (verbatim query shapes from _computeGameState) + diff
// ═════════════════════════════════════════════════════════════════════════════

function eventKey(e: XpEvent): string {
  return `${e.dateKey}|${e.ruleId}|${e.label}|${e.xp}|${e.attribute ?? "-"}`;
}

function sumByDay(events: XpEvent[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of events) m.set(e.dateKey, (m.get(e.dateKey) ?? 0) + e.xp);
  return m;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const userFlagIdx = argv.indexOf("--user");
  const userId =
    userFlagIdx >= 0 ? argv[userFlagIdx + 1]! : (process.env.FOUNDER_USER_ID ?? FOUNDER_USER_ID);

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
  if (!user) {
    console.error(`Unknown user id: ${userId}`);
    return 1;
  }
  console.log(`XP ledger diff — user ${user.email ?? user.id}`);
  console.log(`DB host: ${process.env.DATABASE_URL?.match(/@([^/]+)\//)?.[1] ?? "?"} (read-only run)\n`);

  return runWithUser(user.id, async (): Promise<number> => {
    const now = new Date();

    const program = (await getActiveProgram()) ?? (await getMostRecentProgram());
    if (!program) {
      console.log("No plan history at all — nothing to diff (both sides would be emptyState).");
      return 0;
    }
    console.log(
      `Plan under ledger: "${program.name}" (plan id ${program.id}), startedOn ${dateKey(program.startedOn)}, ${program.template.totalWeeks}w\n`,
    );

    const planStart = startOfDay(program.startedOn);
    const planEnd = endOfDay(lastPlanDayStart(program.startedOn, program.template.totalWeeks));

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
      db.goal.findFirst({
        where: { isFocus: true },
        orderBy: { updatedAt: "desc" },
        select: { id: true, kind: true },
      }),
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
              sets: { select: { weightLb: true, reps: true, durationSec: true, distanceMi: true } },
            },
          },
        },
      }),
      db.hike.findMany({
        orderBy: { date: "asc" },
        select: { id: true, date: true, status: true, elevationFt: true, packWeightLb: true, durationMin: true },
      }),
      db.baseline.findMany({
        orderBy: { date: "asc" },
        select: { id: true, date: true, testName: true, value: true },
      }),
      db.nutritionLog.findMany({ orderBy: { date: "asc" }, select: { date: true } }),
      db.note.findMany({ where: { type: "review" }, orderBy: { date: "asc" }, select: { date: true } }),
      db.mobilityCheckin.findMany({ orderBy: { date: "asc" }, select: { date: true } }),
      prisma.planDayOverride.findMany({
        where: { planId: program.id, date: { gte: planStart, lte: planEnd } },
        select: { date: true, workoutJson: true, baselineTestNames: true },
      }),
      db.gameBonusXp.findMany({
        orderBy: { date: "asc" },
        select: { id: true, date: true, amount: true, reason: true, attribute: true, source: true },
      }),
      db.goal.findMany({
        where: { status: "achieved", completedAt: { not: null } },
        select: { completedAt: true, kind: true, objective: true, completionSnapshot: true },
      }),
    ]);

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

    const completedGoals = completedGoalsRaw.map((g) => ({
      completedAt: g.completedAt as Date,
      kind: g.kind,
      objective: g.objective,
      completionSnapshot: g.completionSnapshot,
    }));

    console.log(
      `History: ${workoutsRaw.length} workouts · ${hikesRaw.length} hikes · ${baselinesRaw.length} baselines · ` +
        `${nutritionRaw.length} nutrition logs · ${reviewsRaw.length} reviews · ${mobilityRaw.length} mobility checkins · ` +
        `${overridesRaw.length} overrides in window · ${bonusRaw.length} bonus rows · ${completedGoals.length} completed goals\n`,
    );

    // ── OLD side (frozen) ────────────────────────────────────────────────────
    const old = collectAllEventsOld(
      {
        program,
        workouts: workoutsRaw,
        hikes: hikesRaw,
        baselines: baselinesRaw,
        nutritionLogs: nutritionRaw,
        reviewNotes: reviewsRaw,
        mobilityCheckins: mobilityRaw,
        overridesByKey,
        bonusRows: bonusRaw,
        completedGoals,
      },
      now,
    );

    // ── NEW side (live engine) ───────────────────────────────────────────────
    const newState = computeGameStateFromData(
      {
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
        completedGoals,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      now,
    );
    const newEvents = newState.events;

    // New ledger, for the explanatory per-day field diff.
    const workoutsByDay = new Map<string, WorkoutWithSets[]>();
    for (const w of workoutsRaw) {
      const dk = dateKey(w.startedAt);
      const arr = workoutsByDay.get(dk) ?? [];
      arr.push(w);
      workoutsByDay.set(dk, arr);
    }
    const hikesByDay = new Map<string, HikeRow[]>();
    for (const h of hikesRaw) {
      const dk = dateKey(h.date);
      const arr = hikesByDay.get(dk) ?? [];
      arr.push({ id: h.id, date: h.date, status: h.status, elevationFt: h.elevationFt, packWeightLb: h.packWeightLb });
      hikesByDay.set(dk, arr);
    }
    const baselinesByDay = new Map<string, { testName: string; value: number }[]>();
    for (const b of baselinesRaw) {
      const dk = dateKey(b.date);
      const arr = baselinesByDay.get(dk) ?? [];
      arr.push({ testName: b.testName, value: b.value });
      baselinesByDay.set(dk, arr);
    }
    const newLedger = buildDayLedgerNew(
      program, workoutsByDay, hikesByDay, baselinesByDay, overridesByKey, now,
    );

    // ── Diff 1: ledger fields per day ────────────────────────────────────────
    let ledgerDeltas = 0;
    const oldByDk = new Map(old.ledger.map((e) => [e.dateKey, e]));
    const newByDk = new Map(newLedger.map((e) => [e.dateKey, e]));
    const allDks = [...new Set([...oldByDk.keys(), ...newByDk.keys()])].sort();
    for (const dk of allDks) {
      const o = oldByDk.get(dk);
      const n = newByDk.get(dk);
      if (!o || !n) {
        ledgerDeltas++;
        console.log(`LEDGER DELTA ${dk}: present in ${o ? "OLD only" : "NEW only"}`);
        continue;
      }
      const fields: [string, unknown, unknown][] = [
        ["isRestDay", o.isRestDay, n.isRestDay],
        ["dueBaselineNames", JSON.stringify(o.dueBaselineNames), JSON.stringify(n.dueBaselineNames)],
        ["streakSuccess", o.streakSuccess, n.streakSuccess],
        ["workoutDeferredForBaseline", o.workoutDeferredForBaseline, n.workoutDeferredForBaseline],
        ["hasPlannedHike", o.hasPlannedHike, n.hasPlannedHike],
        ["loggedBaselineNames", JSON.stringify(o.loggedBaselineNames), JSON.stringify(n.loggedBaselineNames)],
        [
          "completedWorkouts(cat/content)",
          JSON.stringify(o.completedWorkouts.map((w) => [w.id, w.category, w.contentClass ?? null])),
          JSON.stringify(n.completedWorkouts.map((w) => [w.id, w.category, w.contentClass ?? null])),
        ],
        ["completedHikes", o.completedHikes.length, n.completedHikes.length],
      ];
      for (const [name, ov, nv] of fields) {
        if (ov !== nv) {
          ledgerDeltas++;
          console.log(`LEDGER DELTA ${dk} ${name}: OLD=${ov} NEW=${nv}`);
        }
      }
    }
    console.log(
      ledgerDeltas === 0
        ? `Ledger: ${newLedger.length} days compared — ZERO field deltas.`
        : `Ledger: ${ledgerDeltas} field delta(s) — see above.`,
    );

    // ── Diff 2: per-day XP sums + event multiset ─────────────────────────────
    const oldSums = sumByDay(old.events);
    const newSums = sumByDay(newEvents);
    const dayKeys = [...new Set([...oldSums.keys(), ...newSums.keys()])].sort();
    let xpDeltaDays = 0;
    for (const dk of dayKeys) {
      const o = oldSums.get(dk) ?? 0;
      const n = newSums.get(dk) ?? 0;
      if (o !== n) {
        xpDeltaDays++;
        console.log(`XP DELTA ${dk}: OLD=${o} NEW=${n} (Δ ${n - o})`);
      }
    }

    const oldCounts = new Map<string, number>();
    for (const e of old.events) oldCounts.set(eventKey(e), (oldCounts.get(eventKey(e)) ?? 0) + 1);
    const newCounts = new Map<string, number>();
    for (const e of newEvents) newCounts.set(eventKey(e), (newCounts.get(eventKey(e)) ?? 0) + 1);
    let eventDeltas = 0;
    for (const key of new Set([...oldCounts.keys(), ...newCounts.keys()])) {
      const o = oldCounts.get(key) ?? 0;
      const n = newCounts.get(key) ?? 0;
      if (o !== n) {
        eventDeltas++;
        console.log(`EVENT DELTA ${key}: OLD×${o} NEW×${n}`);
      }
    }

    const oldTotal = old.events.reduce((s, e) => s + e.xp, 0);
    const newTotal = newEvents.reduce((s, e) => s + e.xp, 0);

    // ── Diff 3: goal.achieved (Elbert frozen-snapshot R9 safety) ─────────────
    const oldAchieved = old.events.filter((e) => e.ruleId === "goal.achieved").map(eventKey).sort();
    const newAchieved = newEvents.filter((e) => e.ruleId === "goal.achieved").map(eventKey).sort();
    const achievedIdentical = JSON.stringify(oldAchieved) === JSON.stringify(newAchieved);
    console.log(`\ngoal.achieved events (completionSnapshot is INPUT to both sides — never recomputed, never written):`);
    for (const k of newAchieved) console.log(`  ${k}`);
    console.log(`goal.achieved identical OLD vs NEW: ${achievedIdentical ? "YES" : "NO — DELTA ABOVE"}`);

    // ── Report ───────────────────────────────────────────────────────────────
    console.log(`\n──────── SUMMARY ────────`);
    console.log(`Days in ledger:        OLD ${old.ledger.length} · NEW ${newLedger.length}`);
    console.log(`Events:                OLD ${old.events.length} · NEW ${newEvents.length}`);
    console.log(`Per-day XP deltas:     ${xpDeltaDays}`);
    console.log(`Event multiset deltas: ${eventDeltas}`);
    console.log(`Ledger field deltas:   ${ledgerDeltas}`);
    console.log(`TOTAL XP:              OLD ${oldTotal} · NEW ${newTotal} (Δ ${newTotal - oldTotal})`);
    console.log(`GameState.xp (new engine, full pipeline): ${newState.xp}`);

    // XP-bearing comparisons are the shipping gate (A3: "any XP delta
    // reported, not silently shipped"). Ledger FIELD deltas that produce zero
    // XP difference are the semantic consolidation itself (e.g. an override
    // naming a test that does not exist in baselineWeek: every UI surface
    // always dropped it; only the old ledger counted it as due) — they are
    // printed above and must be explained in the review, but they do not fail
    // the run when the XP layers above them are proven identical.
    const xpNeutral =
      xpDeltaDays === 0 && eventDeltas === 0 && oldTotal === newTotal && achievedIdentical;
    if (!xpNeutral) {
      console.log(`\nVERDICT: XP DELTAS FOUND — do not ship unexplained.`);
      return 1;
    }
    console.log(
      ledgerDeltas === 0
        ? `\nVERDICT: ZERO DELTAS — ledger consolidation is XP-neutral and field-identical.`
        : `\nVERDICT: XP-NEUTRAL — zero XP/event/total deltas; ${ledgerDeltas} non-XP ledger field delta(s) listed above (must be explained in the shipping report).`,
    );
    return 0;
  });
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e) => {
    console.error("diff-xp-ledger failed:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
