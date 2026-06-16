// src/lib/recap.ts
// Weekly recap data aggregator.
// Produces the WeeklyRecap bundle consumed by RecapCard, RecapStorySlide,
// and the generate_recap_card MCP tool.
//
// All date math via @/lib/calendar. No raw setHours/getDate/getMonth/getFullYear.
// Goal-generic — no hardcoded references to specific goals or people.

import {
  startOfWeekMonday,
  endOfWeekSunday,
  addDays,
  startOfDay,
} from "@/lib/calendar";
import { prisma } from "@/lib/db";
import { getActiveProgram } from "@/lib/program";
import { computeReadiness } from "@/lib/readiness";
import { getExerciseSummaries } from "@/lib/records";
import { computeGameState } from "@/lib/game/engine";
import type { GoalTarget } from "@/lib/goal-targets";
import type { ExerciseSummary } from "@/lib/records";

// ─── Template ────────────────────────────────────────────────────────────────

export type RecapTemplate = "coal" | "parchment";

export type RecapSlide = 1 | 2 | 3;

// ─── Sub-types ───────────────────────────────────────────────────────────────

/** Goal progress completeness state — drives goal-zone rendering. (DC-4) */
export type RecapGoalState = "no-goal" | "no-targets" | "all-missing" | "has-data";

/** A PR set during the recap week. v1 emits only source:"exercise". (CRIT-3, CRIT-4, S-4) */
export type RecapPR = {
  source: "exercise" | "baseline"; // v1: always "exercise"; "baseline" reserved
  name: string; // canonicalExerciseName output
  bestValue: number;
  units: string; // derived via UNIT_FROM_PRIMARY (NOT a field on ExerciseSummary)
};

/** Goal progress block. Null when no focus goal exists. */
export type RecapGoalBlock = {
  id: string;
  objective: string; // may be long — card wraps/truncates
  progressPct: number | null; // computeReadiness(...).score; null when no/all-missing targets → render "—" never "0%"
  topMetricLabel: string | null; // highest-weight non-missing target.label; null → omit bar sub-label (S-2)
  kind: string; // Goal.kind — small accent only; must degrade for any kind
};

/** Program header data. All fields null when no active plan. */
export type RecapProgramHeader = {
  programWeek: number | null; // null when no active plan
  dayOfProgram: number | null; // null when no active plan
  totalProgramDays: number | null; // plan.template.totalWeeks * 7 (dynamic, 84 now). NOT 90.
};

// ─── WeeklyRecap (the central contract) ──────────────────────────────────────

/**
 * The complete weekly recap data bundle. Produced by computeWeeklyRecap().
 * Consumed by RecapCard, RecapStorySlide, and the MCP tool's stats text block.
 *
 * weekStart/weekEnd are server-only Date instances — never pass to client components (CRIT-2).
 */
export type WeeklyRecap = {
  weekStart: Date; // SERVER-SIDE ONLY — never passed to a client component (CRIT-2)
  weekEnd: Date; // SERVER-SIDE ONLY
  weekOffset: number;
  dateRangeLabel: string; // e.g. "Jun 9 – Jun 15" (USER_TZ, pre-formatted)
  header: RecapProgramHeader;
  goal: RecapGoalBlock | null; // null only when there is no focus goal
  goalState: RecapGoalState; // replaces the old noGoalTargets bool (DC-4)
  workoutsCompleted: number;
  volumeLb: number | null; // raw lb; null whenever no iron was lifted (rawVol===0) — incl. cardio-only weeks (S-5)
  prCount: number;
  prs: RecapPR[];
  hikeElevationFt: number | null; // null when no completed hikes
  streakDays: number; // gameState.streak.current — ALWAYS live-now (no per-week historical; no special copy — MR-3 dropped)
  instagramHandle: string | null; // process.env.INSTAGRAM_HANDLE ?? null — card omits when null (DC-2)
  noProgram: boolean; // getActiveProgram() === null
  emptyWeek: boolean; // workoutsCompleted===0 && hikeElevationFt===null
};

// ─── UNIT_FROM_PRIMARY helper ────────────────────────────────────────────────

const UNIT_FROM_PRIMARY: Record<ExerciseSummary["primary"], string> = {
  rm: "lb",
  reps: "reps",
  duration: "sec",
};

// ─── weekRangeLabel ───────────────────────────────────────────────────────────

/**
 * Pure label, no DB. USER_TZ via @/lib/calendar + Intl.
 * e.g. "Jun 9 – Jun 15"
 */
export function weekRangeLabel(asOf: Date, weekOffset: number): string {
  const thisMonday = startOfWeekMonday(asOf);
  const monday = addDays(thisMonday, weekOffset * 7);
  const sunday = endOfWeekSunday(monday);

  const fmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: process.env.USER_TZ ?? "America/Denver",
  });

  return `${fmt.format(monday)} – ${fmt.format(sunday)}`;
}

// ─── computeWeeklyRecap ───────────────────────────────────────────────────────

/**
 * Aggregates all weekly recap data for the given week.
 *
 * @param asOf   Reference date to anchor "current week" (typically `new Date()`).
 * @param opts.goalId      If provided, use this goal instead of the focus goal.
 * @param opts.weekOffset  Integer in [-26, 0]. 0 = current week through asOf.
 *
 * @returns Promise<WeeklyRecap> — never throws; errors surface as null/zero fields.
 */
export async function computeWeeklyRecap(
  asOf: Date,
  opts?: { goalId?: string; weekOffset?: number },
): Promise<WeeklyRecap> {
  try {
    // ── 1. Week window ─────────────────────────────────────────────────────
    const weekOffset = Math.max(-26, Math.min(0, opts?.weekOffset ?? 0));
    const thisMonday = startOfWeekMonday(asOf);
    const monday = addDays(thisMonday, weekOffset * 7);
    const sunday = endOfWeekSunday(monday);

    // ── 2. Parallel data fetches ───────────────────────────────────────────
    const [
      goal,
      workouts,
      allExerciseSummaries,
      hikes,
      plan,
      gameState,
    ] = await Promise.all([
      // Focus goal (or specific goal by id)
      opts?.goalId
        ? prisma.goal.findFirst({ where: { id: opts.goalId } })
        : prisma.goal.findFirst({
            where: { isFocus: true },
            orderBy: { updatedAt: "desc" },
          }),
      // Completed workouts in the week
      prisma.workout.findMany({
        where: { startedAt: { gte: monday, lte: sunday }, status: "completed" },
        include: { exercises: { include: { sets: true } } },
      }),
      // All-time exercise PRs (filter by bestDate in window after)
      getExerciseSummaries(),
      // Completed hikes in the week
      prisma.hike.findMany({
        where: { date: { gte: monday, lte: sunday }, status: "completed" },
        select: { elevationFt: true },
      }),
      // Active program for header
      getActiveProgram(),
      // Current game streak (always live-now per PRD)
      computeGameState(),
    ]);

    // ── 3. Volume ─────────────────────────────────────────────────────────
    let rawVol = 0;
    for (const w of workouts) {
      for (const ex of w.exercises) {
        for (const s of ex.sets) {
          if (s.weightLb !== null && s.reps !== null) {
            rawVol += s.weightLb * s.reps;
          }
        }
      }
    }
    // S-5: null whenever rawVol===0 (cardio-only weeks, no workouts, etc.)
    const volumeLb: number | null = rawVol === 0 ? null : rawVol;

    // ── 4. PRs this week (exercise only, CRIT-4) ──────────────────────────
    const weekPRSummaries = allExerciseSummaries.filter(
      (s) => s.bestDate >= monday && s.bestDate <= sunday,
    );
    const prs: RecapPR[] = weekPRSummaries.map((s) => ({
      source: "exercise" as const,
      name: s.name,
      bestValue: s.bestValue,
      units: UNIT_FROM_PRIMARY[s.primary],
    }));
    const prCount = prs.length;

    // ── 5. Hike elevation ─────────────────────────────────────────────────
    const totalElevation = hikes.reduce((acc, h) => acc + h.elevationFt, 0);
    const hikeElevationFt: number | null = hikes.length === 0 ? null : totalElevation;

    // ── 6. Goal + readiness ───────────────────────────────────────────────
    const targets = (goal?.targets as unknown as GoalTarget[] | null) ?? [];

    let goalBlock: RecapGoalBlock | null = null;
    let goalState: RecapGoalState = "no-goal";

    if (goal) {
      if (targets.length === 0) {
        goalState = "no-targets";
        goalBlock = {
          id: goal.id,
          objective: goal.objective,
          progressPct: null,
          topMetricLabel: null,
          kind: goal.kind ?? "fitness",
        };
      } else {
        const snapshot = await computeReadiness(targets, sunday, goal.id);

        // null when all missing:
        const progressPct =
          snapshot.missing.length === targets.length ? null : snapshot.score;

        // topMetricLabel: highest-weight non-missing target label
        const usableBreakdown = snapshot.breakdown.filter((b) => b.progress !== null);
        const topEntry = usableBreakdown.sort(
          (a, b) => (b.target.weight ?? 0) - (a.target.weight ?? 0),
        )[0];
        const topMetricLabel = topEntry?.target.label ?? null;

        goalState =
          snapshot.missing.length === targets.length ? "all-missing" : "has-data";

        goalBlock = {
          id: goal.id,
          objective: goal.objective,
          progressPct,
          topMetricLabel,
          kind: goal.kind ?? "fitness",
        };
      }
    }

    // ── 7. Program header (ADDENDUM §B CRIT-1) ────────────────────────────
    let header: RecapProgramHeader;
    if (!plan) {
      header = { programWeek: null, dayOfProgram: null, totalProgramDays: null };
    } else {
      const totalProgramDays = plan.template.totalWeeks * 7;
      // CRIT-1: current week → today's actual program day; past week → that week's final day
      const refDay =
        weekOffset === 0 ? startOfDay(asOf) : startOfDay(sunday);
      const daysSinceStart = Math.max(
        0,
        Math.round(
          (refDay.getTime() - startOfDay(plan.startedOn).getTime()) / 86_400_000,
        ),
      );
      const programWeek = Math.min(
        plan.template.totalWeeks,
        Math.floor(daysSinceStart / 7) + 1,
      );
      const dayOfProgram = Math.max(1, Math.min(totalProgramDays, daysSinceStart + 1));
      header = { programWeek, dayOfProgram, totalProgramDays };
    }

    // ── 8. Date range label ───────────────────────────────────────────────
    const dateRangeLabel = weekRangeLabel(asOf, weekOffset);

    // ── 9. Streak ─────────────────────────────────────────────────────────
    const streakDays = gameState.streak.current;

    // ── 10. Instagram handle ──────────────────────────────────────────────
    const instagramHandle = process.env.INSTAGRAM_HANDLE ?? null;

    // ── 11. Derived flags ─────────────────────────────────────────────────
    const workoutsCompleted = workouts.length;
    const noProgram = plan === null;
    const emptyWeek = workoutsCompleted === 0 && hikeElevationFt === null;

    return {
      weekStart: monday,
      weekEnd: sunday,
      weekOffset,
      dateRangeLabel,
      header,
      goal: goalBlock,
      goalState,
      workoutsCompleted,
      volumeLb,
      prCount,
      prs,
      hikeElevationFt,
      streakDays,
      instagramHandle,
      noProgram,
      emptyWeek,
    };
  } catch {
    // Never throw — return a safe fallback
    const now = asOf ?? new Date();
    const weekOffset = Math.max(-26, Math.min(0, opts?.weekOffset ?? 0));
    const thisMonday = startOfWeekMonday(now);
    const monday = addDays(thisMonday, weekOffset * 7);
    const sunday = endOfWeekSunday(monday);
    return {
      weekStart: monday,
      weekEnd: sunday,
      weekOffset,
      dateRangeLabel: weekRangeLabel(now, weekOffset),
      header: { programWeek: null, dayOfProgram: null, totalProgramDays: null },
      goal: null,
      goalState: "no-goal",
      workoutsCompleted: 0,
      volumeLb: null,
      prCount: 0,
      prs: [],
      hikeElevationFt: null,
      streakDays: 0,
      instagramHandle: process.env.INSTAGRAM_HANDLE ?? null,
      noProgram: true,
      emptyWeek: true,
    };
  }
}
