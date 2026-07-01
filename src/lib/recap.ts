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
  dateKey,
  weekRangeLabel,
} from "@/lib/calendar";
import { getDb } from "@/lib/db";
import {
  presentationForGoal,
  fmtComma,
  fmtVolume,
  fmtElevation,
  DEFAULT_PRESENTATION,
  type StatSlot,
} from "@/lib/goal-presentation";
import { getActiveProgram } from "@/lib/program";
import { computeReadiness } from "@/lib/readiness";
import type { TargetProgress } from "@/lib/readiness";
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

/**
 * A single highlight candidate for the featured callout band on the recap card.
 * Detected from the week's PRs, badges, hikes, and baselines.
 * Also supports a user-typed custom highlight.
 */
export type RecapHighlight = {
  id: string;       // stable: "pr:<name>" | "baseline:<testName>" | "hike:<hikeId>" | "badge:<id>" | "custom:<text>"
  kind: "pr" | "baseline" | "hike" | "badge" | "custom";
  icon: string;     // emoji: pr "🏆", baseline "📏", hike "⛰️", badge "🎖️", custom "⭐"
  label: string;    // headline NAME only e.g. "Goblet Squat" / "Bear Peak Trail #1474"
  meta: string | null; // stat sub-line e.g. "65 lb" / "8.2 mi · 3,768 ft"; null → no stat line
  sub: string | null; // optional gold pill badge e.g. "new PR" / "new best"
};

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
  /** Coverage from ReadinessSnapshot — how many targets have been tested. */
  coverage: { tested: number; total: number } | null; // null when no targets
  /** Number of gating targets not yet cleared. 0 when no gates. */
  openGateCount: number;
};

/** Program header data. All fields null when no active plan. */
export type RecapProgramHeader = {
  programWeek: number | null; // null when no active plan
  dayOfProgram: number | null; // null when no active plan
  totalProgramDays: number | null; // plan.template.totalWeeks * 7 (dynamic, 84 now). NOT 90.
  weeksToTarget: number | null; // null for fitness goals or when no targetDate
  targetDateLabel: string | null; // e.g. "Oct 5"; null for fitness or no targetDate
};

/** A single resolved stat slot — plain strings/bools, safe to pass to client. */
export type ResolvedStatSlot = {
  key: string;
  label: string;
  value: string;
  isNull: boolean;
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
  /**
   * Detected highlight candidates for the week, ordered by flex-worthiness:
   * PRs → badges → hikes → baselines. Empty when nothing notable happened.
   * Consumed by the card's featuredHighlight callout and the /recap/highlights route.
   */
  highlights: RecapHighlight[];
  /** Kind-aware stat slots resolved for the active goal's presentation. */
  statSlots: ResolvedStatSlot[];
};

// ─── UNIT_FROM_PRIMARY helper ────────────────────────────────────────────────

const UNIT_FROM_PRIMARY: Record<ExerciseSummary["primary"], string> = {
  rm: "lb",
  reps: "reps",
  duration: "sec",
  distance: "mi",
  time: "sec",
};

// Exercise-name keywords marking mobility / stretch / warmup work. These are
// excluded from highlight CANDIDATES (they remain in the PR stat count — this
// only affects which achievements are offered as a shareable "flex"). Heuristic
// by design; the user can always pick another candidate or a custom highlight.
const MOBILITY_KEYWORDS = [
  "stretch", "foam roll", "foot roll", "pose", "cat-cow", "cat cow", "mobility",
  "hip switch", "90/90", "forward fold", "doorway", "figure-4", "figure 4",
  "couch", "pvc", "warm-up", "warmup", "cool-down", "cooldown", "opener",
  "breathing", "activation", "thoracic", "pigeon",
  // specific multi-word mobility moves (phrased to avoid false-positives like "Russian Twist")
  "thread the needle", "spinal twist", "towel pull",
];
function isMobilityName(name: string): boolean {
  const n = name.toLowerCase();
  return MOBILITY_KEYWORDS.some((k) => n.includes(k));
}
// Sort tier for PR units: weighted lifts first, then reps, then duration/distance/time.
const prUnitTier = (units: string): number =>
  units === "lb" ? 0 : units === "reps" ? 1 : 2;

/**
 * Format a PR best value for the highlight card label, branching on units.
 * - "mi" → toFixed(2) (preserve decimal precision, e.g. "6.60")
 * - "sec" → M:SS (human-readable time, e.g. "8:00")
 * - everything else → Math.round (same as before)
 */
function formatPrValue(value: number, units: string): string {
  if (units === "mi") return value.toFixed(2);
  if (units === "sec") {
    const m = Math.floor(value / 60);
    const s = value % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  return String(Math.round(value));
}

// ─── resolveStatSlot ─────────────────────────────────────────────────────────

type StatSlotCtx = {
  recap: {
    workoutsCompleted: number;
    volumeLb: number | null;
    prCount: number;
    hikeElevationFt: number | null;
  };
  logLatest: Map<string, number | null>;
  scheduledAgg: Map<string, { done: number; total: number; open: number }>;
  breakdown: TargetProgress[];
  targets: GoalTarget[]; // reserved for targetCurrent; not consumed by v1 slots
};

function fmtByFormat(v: number | null, f: StatSlot["format"]): string {
  switch (f) {
    case "int":
      return v === null ? "—" : String(v);
    case "volumeLb":
      return fmtVolume(v);
    case "elevationFt":
      return fmtElevation(v);
    case "currency":
      return v === null ? "—" : "$" + fmtComma(v);
    case "percent":
      return v === null ? "—" : `${v}%`;
    case "ratioOfTotal":
      // Never reaches here for scheduledItem (handled inline); defensive fallback.
      return v === null ? "—" : String(v);
  }
}

export function resolveStatSlot(slot: StatSlot, ctx: StatSlotCtx): ResolvedStatSlot {
  const base = { key: slot.key, label: slot.label };
  switch (slot.source.from) {
    case "recapField": {
      const v = ctx.recap[slot.source.field];
      return { ...base, value: fmtByFormat(v, slot.format), isNull: v === null };
    }
    case "logLatest": {
      const v = ctx.logLatest.get(slot.source.metricKey) ?? null;
      return { ...base, value: fmtByFormat(v, slot.format), isNull: v === null };
    }
    case "scheduledItem": {
      const counts = ctx.scheduledAgg.get(slot.source.itemType) ?? {
        done: 0,
        total: 0,
        open: 0,
      };
      const agg = slot.source.agg;
      if (agg === "doneOverTotal") {
        return {
          ...base,
          value: `${counts.done}/${counts.total}`,
          isNull: counts.total === 0,
        };
      }
      if (agg === "doneCount") {
        return { ...base, value: String(counts.done), isNull: counts.total === 0 };
      }
      // "openCount"
      return { ...base, value: String(counts.open), isNull: counts.total === 0 };
    }
    case "targetCurrent": {
      const metric = slot.source.metric;
      const b = ctx.breakdown.find((x) => x.target.metric === metric);
      const v = b?.current ?? null;
      return { ...base, value: fmtByFormat(v, slot.format), isNull: v === null };
    }
  }
}

// ─── weekRangeLabel ───────────────────────────────────────────────────────────
// Moved to calendar-core.ts (REV-3/DC-1) so recap-actions.ts can import it from
// @/lib/calendar without pulling the full recap engine into its module graph.
// Re-exported here so existing @/lib/recap consumers keep working unchanged.
export { weekRangeLabel };

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

    // ── 2. Goal-first fetch ────────────────────────────────────────────────
    const db = await getDb();
    const goal = await (
      opts?.goalId
        ? db.goal.findFirst({ where: { id: opts.goalId } })
        : db.goal.findFirst({
            where: { isFocus: true },
            orderBy: { updatedAt: "desc" },
          })
    );

    // ── 3. Presentation + slot keys ────────────────────────────────────────
    const presentation = presentationForGoal(goal);
    const logKeys = presentation.statSlots
      .filter((s) => s.source.from === "logLatest")
      .map((s) => (s.source as { from: "logLatest"; metricKey: string }).metricKey);
    const schedTypes = presentation.statSlots
      .filter((s) => s.source.from === "scheduledItem")
      .map(
        (s) =>
          (
            s.source as {
              from: "scheduledItem";
              itemType: string;
              agg: string;
            }
          ).itemType,
      );

    // ── 4. Parallel base fetches (minus goal) ─────────────────────────────
    const [workouts, allExerciseSummaries, hikes, plan, gameState] =
      await Promise.all([
        // Completed workouts in the week
        db.workout.findMany({
          where: { startedAt: { gte: monday, lte: sunday }, status: "completed" },
          include: { exercises: { include: { sets: true } } },
        }),
        // All-time exercise PRs (filter by bestDate in window after)
        getExerciseSummaries(),
        // Completed hikes in the week (select extended for highlight detection)
        db.hike.findMany({
          where: { date: { gte: monday, lte: sunday }, status: "completed" },
          select: { elevationFt: true, id: true, route: true, distanceMi: true },
        }),
        // Active program for header
        getActiveProgram(),
        // Current game streak (always live-now per PRD)
        computeGameState(),
      ]);

    // ── 5. Gated project fetch ─────────────────────────────────────────────
    // Only runs when the presentation has logLatest or scheduledItem slots
    // (i.e. project goals). Fitness goals have empty logKeys + schedTypes → guard false.
    const logLatest = new Map<string, number | null>();
    const scheduledAgg = new Map<string, { done: number; total: number; open: number }>();
    if (goal && (logKeys.length > 0 || schedTypes.length > 0)) {
      await Promise.all([
        ...logKeys.map(async (k) => {
          const row = await db.logEntry.findFirst({
            where: { goalId: goal.id, metric: k, value: { not: null } },
            orderBy: { date: "desc" },
          });
          logLatest.set(k, row?.value ?? null);
        }),
        ...schedTypes.map(async (t) => {
          const groups = await db.scheduledItem.groupBy({
            by: ["status"],
            where: { goalId: goal.id, type: t },
            _count: { _all: true },
          });
          let done = 0,
            total = 0,
            open = 0;
          for (const g of groups) {
            total += g._count._all;
            if (g.status === "done") done += g._count._all;
            if (g.status === "planned") open += g._count._all;
          }
          scheduledAgg.set(t, { done, total, open });
        }),
      ]);
    }

    // ── 6. Volume ─────────────────────────────────────────────────────────
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

    // ── 7. PRs this week (exercise only, CRIT-4) ──────────────────────────
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

    // ── 8. Hike elevation ─────────────────────────────────────────────────
    const totalElevation = hikes.reduce((acc, h) => acc + h.elevationFt, 0);
    const hikeElevationFt: number | null = hikes.length === 0 ? null : totalElevation;

    // ── 9. Goal + readiness ───────────────────────────────────────────────
    const targets = (goal?.targets as unknown as GoalTarget[] | null) ?? [];

    let goalBlock: RecapGoalBlock | null = null;
    let goalState: RecapGoalState = "no-goal";
    let breakdown: TargetProgress[] = [];

    if (goal) {
      if (targets.length === 0) {
        goalState = "no-targets";
        goalBlock = {
          id: goal.id,
          objective: goal.objective,
          progressPct: null,
          topMetricLabel: null,
          kind: goal.kind ?? "fitness",
          coverage: null,
          openGateCount: 0,
        };
      } else {
        const snapshot = await computeReadiness(targets, sunday, goal.id);

        // Capture breakdown for stat slot ctx
        breakdown = snapshot.breakdown;

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
          coverage: snapshot.coverage,
          openGateCount: snapshot.openGateCount,
        };
      }
    }

    // ── 10. Weeks-to-target ────────────────────────────────────────────────
    // Only computed when the presentation uses the "weeks-to-target" header style
    // and the goal has a targetDate. Fitness (program-week) stays null.
    let weeksToTarget: number | null = null;
    let targetDateLabel: string | null = null;
    if (presentation.headerStyle === "weeks-to-target" && goal?.targetDate) {
      weeksToTarget = Math.max(
        0,
        Math.round(
          (startOfDay(goal.targetDate).getTime() - startOfDay(asOf).getTime()) /
            (7 * 86_400_000),
        ),
      );
      targetDateLabel = new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        timeZone: process.env.USER_TZ ?? "America/Denver",
      }).format(goal.targetDate);
    }

    // ── 11. Program header (ADDENDUM §B CRIT-1) ───────────────────────────
    let header: RecapProgramHeader;
    if (!plan) {
      // No fitness plan — project goal or no plan at all.
      // weeksToTarget/targetDateLabel are populated for project goals (step 10).
      header = {
        programWeek: null,
        dayOfProgram: null,
        totalProgramDays: null,
        weeksToTarget,
        targetDateLabel,
      };
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
      // Fitness headerStyle is "program-week" → weeksToTarget/targetDateLabel are null (step 10 guard).
      header = {
        programWeek,
        dayOfProgram,
        totalProgramDays,
        weeksToTarget,
        targetDateLabel,
      };
    }

    // ── 12. Derived flags ─────────────────────────────────────────────────
    const workoutsCompleted = workouts.length;
    const noProgram = plan === null;
    const emptyWeek = workoutsCompleted === 0 && hikeElevationFt === null;

    // ── 13. Stat slots ────────────────────────────────────────────────────
    const statSlots = presentation.statSlots.map((s) =>
      resolveStatSlot(s, {
        recap: { workoutsCompleted, volumeLb, prCount, hikeElevationFt },
        logLatest,
        scheduledAgg,
        breakdown,
        targets,
      }),
    );

    // ── 14. Date range label ──────────────────────────────────────────────
    const dateRangeLabel = weekRangeLabel(asOf, weekOffset);

    // ── 15. Streak ────────────────────────────────────────────────────────
    const streakDays = gameState.streak.current;

    // ── 16. Instagram handle ──────────────────────────────────────────────
    const instagramHandle = process.env.INSTAGRAM_HANDLE ?? null;

    // ── 17. Highlight detection ────────────────────────────────────────────
    // Ordered by flex-worthiness: pr → badge → hike → baseline.
    // Wrapped in its own try/catch — detection failure silently falls back to [].
    let highlights: RecapHighlight[] = [];
    try {
      const weekDkStart = dateKey(monday);
      const weekDkEnd = dateKey(sunday);

      // PRs: drop 0-value lifts and mobility/stretch work, then rank by
      // flex-worthiness — heaviest weighted lifts first, then reps, then duration.
      const prHighlights: RecapHighlight[] = prs
        .filter((pr) => pr.bestValue > 0 && !isMobilityName(pr.name))
        .sort(
          (a, b) =>
            prUnitTier(a.units) - prUnitTier(b.units) || b.bestValue - a.bestValue,
        )
        .slice(0, 8)
        .map((pr) => ({
          id: `pr:${pr.name}`,
          kind: "pr" as const,
          icon: "🏆",
          label: pr.name,
          meta: `${formatPrValue(pr.bestValue, pr.units)} ${pr.units}`,
          sub: "new PR",
        }));

      // Badges: only those whose unlock dateKey falls within this week.
      // gameState.badges[].dateKey is "yyyy-mm-dd" when unlocked, null when locked.
      const badgeHighlights: RecapHighlight[] = gameState.badges
        .filter(
          (b) =>
            b.dateKey !== null &&
            b.dateKey >= weekDkStart &&
            b.dateKey <= weekDkEnd,
        )
        .map((b) => ({
          id: `badge:${b.def.id}`,
          kind: "badge" as const,
          icon: "🎖️",
          label: b.def.name,
          meta: null,
          sub: null,
        }));

      // Hikes: from the already-fetched extended hikes query
      const hikeHighlights: RecapHighlight[] = hikes.map((h) => ({
        id: `hike:${h.id}`,
        kind: "hike" as const,
        icon: "⛰️",
        label: h.route,
        meta: `${h.distanceMi.toFixed(1)} mi · ${new Intl.NumberFormat("en-US").format(h.elevationFt)} ft`,
        sub: null,
      }));

      // Baselines: query the week, dedupe by testName (take max value), check vs prior
      const weekBaselineRows = await db.baseline.findMany({
        where: { date: { gte: monday, lte: sunday } },
        select: { testName: true, value: true, units: true },
      });

      // Dedupe by testName: keep the highest-value entry per test
      const byTestName = new Map<string, { testName: string; value: number; units: string }>();
      for (const row of weekBaselineRows) {
        const existing = byTestName.get(row.testName);
        if (!existing || row.value > existing.value) {
          byTestName.set(row.testName, row);
        }
      }
      const uniqueWeekBaselines = [...byTestName.values()];

      const priorMaxByTest = new Map<string, number>();
      if (uniqueWeekBaselines.length > 0) {
        const testNames = uniqueWeekBaselines.map((b) => b.testName);
        const priorRows = await db.baseline.findMany({
          where: { testName: { in: testNames }, date: { lt: monday } },
          select: { testName: true, value: true },
        });
        for (const row of priorRows) {
          const prev = priorMaxByTest.get(row.testName) ?? -Infinity;
          if (row.value > prev) priorMaxByTest.set(row.testName, row.value);
        }
      }

      const baselineHighlights: RecapHighlight[] = uniqueWeekBaselines.map((row) => {
        const priorMax = priorMaxByTest.get(row.testName);
        const isNewBest = priorMax === undefined || row.value > priorMax;
        return {
          id: `baseline:${row.testName}`,
          kind: "baseline" as const,
          icon: "📏",
          label: row.testName,
          meta: `${row.value} ${row.units}`,
          sub: isNewBest ? "new best" : null,
        };
      });

      highlights = [
        ...prHighlights,
        ...hikeHighlights,
        ...badgeHighlights,
        ...baselineHighlights,
      ];
    } catch {
      highlights = [];
    }

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
      highlights,
      statSlots,
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
      header: {
        programWeek: null,
        dayOfProgram: null,
        totalProgramDays: null,
        weeksToTarget: null,
        targetDateLabel: null,
      },
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
      highlights: [],
      statSlots: DEFAULT_PRESENTATION.statSlots.map((s) =>
        resolveStatSlot(s, {
          recap: {
            workoutsCompleted: 0,
            volumeLb: null,
            prCount: 0,
            hikeElevationFt: null,
          },
          logLatest: new Map(),
          scheduledAgg: new Map(),
          breakdown: [],
          targets: [],
        }),
      ),
    };
  }
}

// ─── resolveHighlight ─────────────────────────────────────────────────────────

/**
 * Resolve the `highlight` query/tool param to a concrete RecapHighlight or null.
 *
 * - null / undefined / "none" / ""  → null (no callout band)
 * - "auto"                          → recap.highlights[0] ?? null (top candidate)
 * - "custom:<text>"                 → {kind:"custom", icon:"⭐", label:text, ...}
 *                                     (empty text after "custom:" → null)
 * - any other string                → match by id in recap.highlights; unmatched → null
 */
export function resolveHighlight(
  recap: WeeklyRecap,
  param: string | null | undefined,
): RecapHighlight | null {
  if (!param || param === "none") return null;
  if (param === "auto") return recap.highlights[0] ?? null;
  if (param.startsWith("custom:")) {
    const text = param.slice(7).trim();
    if (!text) return null;
    return {
      id: param,
      kind: "custom",
      icon: "⭐",
      label: text,
      meta: null,
      sub: null,
    };
  }
  return recap.highlights.find((h) => h.id === param) ?? null;
}
