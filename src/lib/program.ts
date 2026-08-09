import type { ProgramTemplate, DayTemplate, Phase } from "@/lib/program-template";
import { startOfDay, dateKey, parseDateKey } from "@/lib/calendar";
import { getDb } from "@/lib/db";

export type ActiveProgramSnapshot = {
  id: string;
  name: string;
  startedOn: Date;
  template: ProgramTemplate;
  // Track 2: high-water mark from Plan.confirmedThroughDate. null when no
  // weeks have been confirmed, or when falling back to the Program table.
  confirmedThroughDate: Date | null;
};

export type TodayContext = {
  program: ActiveProgramSnapshot;
  daysSinceStart: number;
  weekIndex: number; // 1-based, capped at totalWeeks
  dayOfWeek: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  phase: Phase | null;
  day: DayTemplate | null;
};

export async function getActiveProgram(): Promise<ActiveProgramSnapshot | null> {
  // Prefer the focus goal's active Plan first (isFocus desc), then fall back
  // to any active plan (transition-safe). This ensures the focus goal's plan
  // drives the daily prescription while remaining resilient during the transition
  // period when some goals may not yet have isFocus set.
  // Falls back further to the global seeded Program for new users.
  const db = await getDb();
  const plan = await db.plan.findFirst({
    where: { active: true },
    orderBy: [{ goal: { isFocus: "desc" } }, { updatedAt: "desc" }],
  });
  if (plan) {
    return {
      id: plan.id,
      name: plan.name,
      startedOn: plan.startedOn,
      template: plan.planJson as unknown as ProgramTemplate,
      confirmedThroughDate: plan.confirmedThroughDate ?? null,
    };
  }
  const program = await db.program.findFirst({
    where: { active: true },
    orderBy: { createdAt: "desc" },
  });
  if (!program) return null;
  return {
    id: program.id,
    name: program.name,
    startedOn: program.startedOn,
    template: program.planJson as unknown as ProgramTemplate,
    // Program table has no confirmedThroughDate column — always null.
    confirmedThroughDate: null,
  };
}

/**
 * Fallback for the game engine (engine.ts's program-fallback, REQ-004c):
 * the most-recently-updated plan/program regardless of `active`. Used ONLY
 * when getActiveProgram() returns null (e.g. right after completeGoalCore
 * deactivates the goal's plan(s) — the character page must keep showing the
 * founder's historical XP/level instead of wiping to emptyState()).
 *
 * Mirrors getActiveProgram's precedence (Plan first, then Program) and
 * snapshot shape exactly — the only difference is dropping the `active: true`
 * filter and ordering purely by `updatedAt desc` ("most recently updated",
 * full stop; no isFocus tiebreak — that tiebreak in getActiveProgram exists
 * for the multi-active-plan transition case, which doesn't apply here).
 *
 * getActiveProgram() itself is untouched — this is a separate, explicit
 * fallback the caller opts into, never an implicit change to "the" active
 * program lookup.
 */
export async function getMostRecentProgram(): Promise<ActiveProgramSnapshot | null> {
  const db = await getDb();
  const plan = await db.plan.findFirst({
    orderBy: { updatedAt: "desc" },
  });
  if (plan) {
    return {
      id: plan.id,
      name: plan.name,
      startedOn: plan.startedOn,
      template: plan.planJson as unknown as ProgramTemplate,
      confirmedThroughDate: plan.confirmedThroughDate ?? null,
    };
  }
  const program = await db.program.findFirst({
    orderBy: { updatedAt: "desc" },
  });
  if (!program) return null;
  return {
    id: program.id,
    name: program.name,
    startedOn: program.startedOn,
    template: program.planJson as unknown as ProgramTemplate,
    // Program table has no confirmedThroughDate column — always null.
    confirmedThroughDate: null,
  };
}

export function getTodayContext(
  program: ActiveProgramSnapshot,
  now: Date = new Date(),
): TodayContext {
  // Day boundaries in USER_TZ — the user's phone clock owns "today", not the
  // server's UTC. dayMs uses 86400 because daysSinceStart is the wall-clock
  // day count; DST transitions are absorbed by startOfDay's TZ correction.
  const startMidnight = startOfDay(program.startedOn);
  const today = startOfDay(now);

  const dayMs = 1000 * 60 * 60 * 24;
  const daysSinceStart = Math.max(
    0,
    Math.round((today.getTime() - startMidnight.getTime()) / dayMs),
  );
  const weekIndex = Math.min(program.template.totalWeeks, Math.floor(daysSinceStart / 7) + 1);

  // Plan-relative rotation. Day 1 of the program lands on plan.startedOn,
  // regardless of which calendar weekday that is. After 7 days the rotation
  // cycles. The template's `weeklySplit[].dayOfWeek` is the rotation index
  // (1..7), NOT a calendar weekday.
  const dayOfWeek = ((daysSinceStart % 7) + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7;

  // Defensive: a malformed snapshot (e.g., a stringified template that
  // accidentally got persisted as a character-indexed object) shouldn't take
  // the page down. Treat phases / weeklySplit as optional.
  const phasesArr = Array.isArray(program.template?.phases) ? program.template.phases : [];
  const weeklySplitArr = Array.isArray(program.template?.weeklySplit)
    ? program.template.weeklySplit
    : [];

  const phase =
    phasesArr.find((p) => Array.isArray(p?.weeks) && p.weeks.includes(weekIndex)) ??
    phasesArr[0] ??
    null;

  const day = weeklySplitArr.find((d) => d?.dayOfWeek === dayOfWeek) ?? weeklySplitArr[0] ?? null;

  return { program, daysSinceStart, weekIndex, dayOfWeek, phase, day };
}

// ─────────────────────────────────────────────────────────────────────────
// REQ-001 (Goal Story & Time-Aware History, Stage A1) — time-aware program
// lookup for arbitrary dates. getActiveProgram/getMostRecentProgram above
// are UNTOUCHED; this is a separate, additive lookup that callers (resolveDay,
// getCalendarMonth, get_week) opt into for past-date resolution.
// ─────────────────────────────────────────────────────────────────────────

/** A program snapshot annotated with where it came from — the live active
 *  plan, or an archived plan resurfaced because it covered a past date. */
export type ProgramForDate = ActiveProgramSnapshot & { source: "active" | "archived" };

/** A candidate plan window for past-date coverage checks — an
 *  ActiveProgramSnapshot plus the flags pickProgramForDate needs to order and
 *  clamp it (S3 ordering, S4 completion clamp). Produced by
 *  getPlanWindowCandidates(); shared later by the month view / get_week. */
export type PlanWindowCandidate = ActiveProgramSnapshot & {
  active: boolean;
  goalStatus: string;
  goalCompletedAt: Date | null;
};

/**
 * Pure coverage check — same daysDelta math as resolveDay (calendar.ts:843-848):
 * daysDelta = floor((startOfDay(target) - startOfDay(startedOn)) / 1 day);
 * covered = 0 <= daysDelta < template.totalWeeks * 7.
 *
 * S4 clamp: when `goalCompletedAt` is provided, the window's effective end is
 * clamped to the completion day itself — the completion day IS covered, the
 * day after is NOT (no phantom never-followed prescription past the summit).
 * Expressed as `targetMid <= startOfDay(goalCompletedAt)` rather than
 * computing a separate "day after" cursor — equivalent and needs no extra
 * date-math helper.
 *
 * Not exported — an internal helper shared by getProgramForDate's fast-path
 * check and pickProgramForDate's candidate filter.
 */
function coversDayKey(
  program: { startedOn: Date; template: ProgramTemplate },
  targetDayKey: string,
  goalCompletedAt?: Date | null,
): boolean {
  const startMid = startOfDay(program.startedOn);
  const targetMid = parseDateKey(targetDayKey); // === startOfDay(that date)
  const daysDelta = Math.floor((targetMid.getTime() - startMid.getTime()) / (24 * 3600 * 1000));
  if (daysDelta < 0 || daysDelta >= program.template.totalWeeks * 7) return false;
  if (goalCompletedAt && targetMid.getTime() > startOfDay(goalCompletedAt).getTime()) return false;
  return true;
}

/**
 * Pure — no IO. Shared by resolveDay's per-date lookup (getProgramForDate)
 * and, later, the month view / get_week (which fetch `candidates` once per
 * range/week and call this per cell/day instead of re-querying).
 *
 * Contract (D1 + S3 + S4, binding):
 *  1. If `activeProgram` covers `dayKey` → return it as {source:"active"}.
 *     This is the Today-page contract: whenever this branch hits, the result
 *     is byte-identical to what getActiveProgram()/getTodayContext produce —
 *     applies to past, today, and future dates alike.
 *  2. Otherwise, ONLY when `dayKey < todayKey` (strictly past, USER_TZ dateKey
 *     string compare — never raw Date comparison): search `candidates` for
 *     ones whose window covers `dayKey` (S4-clamped per candidate). Among
 *     covering candidates, order active-covering first, then startedOn desc.
 *     The updatedAt desc tiebreak (S3) is achieved by *sort stability*, not a
 *     field on the comparator: getPlanWindowCandidates() returns candidates
 *     pre-ordered `updatedAt desc` at the DB level (as documented on that
 *     function), and Array.prototype.sort is a stable sort (guaranteed by
 *     spec since ES2019 / V8 7.0, well within this repo's Node runtime) — so
 *     when two candidates tie on `active` and `startedOn`, their relative
 *     order from the incoming (updatedAt-desc) list is preserved. Callers who
 *     don't go through getPlanWindowCandidates() must pre-sort by updatedAt
 *     desc themselves for the tiebreak to hold; ties left unresolved (no
 *     candidates, or a caller that didn't pre-sort) simply return the first
 *     covering candidate in input order.
 *  3. Fall through (today/future dayKey, or a past dayKey with no covering
 *     candidate): return `activeProgram` as {source:"active"} when present,
 *     else null. Bit-identical to today's out-of-plan/active behavior.
 */
export function pickProgramForDate(
  candidates: PlanWindowCandidate[],
  dayKey: string,
  todayKey: string,
  activeProgram: ActiveProgramSnapshot | null,
): ProgramForDate | null {
  if (activeProgram && coversDayKey(activeProgram, dayKey)) {
    return {
      id: activeProgram.id,
      name: activeProgram.name,
      startedOn: activeProgram.startedOn,
      template: activeProgram.template,
      confirmedThroughDate: activeProgram.confirmedThroughDate,
      source: "active",
    };
  }

  if (dayKey < todayKey) {
    const covering = candidates.filter((c) => coversDayKey(c, dayKey, c.goalCompletedAt));
    if (covering.length > 0) {
      // Stable sort: ties (both `active`, equal `startedOn`) preserve the
      // incoming order, which getPlanWindowCandidates() pre-sorts updatedAt
      // desc — see the doc comment above for the full reasoning.
      const ordered = [...covering].sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return b.startedOn.getTime() - a.startedOn.getTime();
      });
      const winner = ordered[0]!;
      return {
        id: winner.id,
        name: winner.name,
        startedOn: winner.startedOn,
        template: winner.template,
        confirmedThroughDate: winner.confirmedThroughDate,
        source: "archived",
      };
    }
  }

  if (activeProgram) {
    return {
      id: activeProgram.id,
      name: activeProgram.name,
      startedOn: activeProgram.startedOn,
      template: activeProgram.template,
      confirmedThroughDate: activeProgram.confirmedThroughDate,
      source: "active",
    };
  }
  return null;
}

/**
 * DB fetch (getDb()-scoped) of every plan as a coverage-check candidate —
 * reused by pickProgramForDate's archived-fallback branch, and later by the
 * month view + get_week (D1/S1: they fetch this ONCE per range/week instead
 * of once per day/cell). Ordered `updatedAt desc` — see pickProgramForDate's
 * doc comment for why that ordering is load-bearing (S3 tiebreak via sort
 * stability, not a comparator field).
 *
 * planJson is cast to ProgramTemplate exactly like getActiveProgram does
 * (unvalidated — same trust boundary as the rest of this module).
 */
export async function getPlanWindowCandidates(): Promise<PlanWindowCandidate[]> {
  const db = await getDb();
  const plans = await db.plan.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      startedOn: true,
      planJson: true,
      confirmedThroughDate: true,
      active: true,
      goal: { select: { status: true, completedAt: true } },
    },
  });
  return plans.map((plan) => ({
    id: plan.id,
    name: plan.name,
    startedOn: plan.startedOn,
    template: plan.planJson as unknown as ProgramTemplate,
    confirmedThroughDate: plan.confirmedThroughDate ?? null,
    active: plan.active,
    goalStatus: plan.goal.status,
    goalCompletedAt: plan.goal.completedAt ?? null,
  }));
}

/**
 * Time-aware program lookup for an arbitrary date (D1 + S3 + S4, binding).
 * Thin db wrapper — all coverage/ordering/past-gate logic lives in the pure
 * pickProgramForDate, which this calls.
 *
 * - `date` covered by the active program (today, future, or past) → that
 *   program, {source:"active"}. Byte-identical to the existing Today path.
 * - Otherwise, only for a strictly-past `date` (USER_TZ dateKey compare via
 *   `now`): resurface the covering archived plan, {source:"archived"}.
 * - Else: fall through to the active program (or null if none exists) —
 *   today's out-of-plan/active behavior, unchanged.
 *
 * The archived-plan query is skipped entirely unless it could actually
 * matter (dayKey is strictly past AND the active program doesn't already
 * cover it) — avoids an extra round-trip on the hot (today/future) path.
 */
export async function getProgramForDate(
  date: Date,
  now: Date = new Date(),
): Promise<ProgramForDate | null> {
  const activeProgram = await getActiveProgram();
  const dayKey = dateKey(date);
  const todayKey = dateKey(now);

  const mightNeedArchived =
    dayKey < todayKey && !(activeProgram && coversDayKey(activeProgram, dayKey));
  const candidates = mightNeedArchived ? await getPlanWindowCandidates() : [];

  return pickProgramForDate(candidates, dayKey, todayKey, activeProgram);
}
