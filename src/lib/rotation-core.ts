// src/lib/rotation-core.ts
//
// THE canonical rotation math (blockers doc B4, run amendment A3: "one
// resolver, one rotation implementation, all surfaces call it").
//
// Before this module the daysDelta → rotationDay/weekIndex formula was written
// out in ~9 places (resolveDay, buildCell, templateForRotationDay,
// isDateWithinActivePlanWindow, rotationBaselineNamesForDate, coversDayKey,
// plan-lint ×4, get_week/confirm_week, game/engine buildDayLedger) — the
// mechanical cause of the recurring "surfaces disagree" bug class
// (current-state analysis §2.3). Every one of those sites now imports from
// here. DO NOT re-derive any of these formulas inline again; extend this
// module instead.
//
// CONTRACT — the exact formulas resolveDay used at extraction time
// (calendar.ts @4cc44b4), byte-for-byte:
//
//   daysDelta   = Math.floor((startOfDay(date) - startOfDay(startedOn)) / 24h)
//   isInPlan    = daysDelta >= 0 && daysDelta < totalWeeks * 7
//   rotationDay = ((daysDelta % 7) + 7) % 7 + 1          // 1..7
//   weekIndex   = Math.floor(daysDelta / 7) + 1          // 1..totalWeeks
//
// FLOOR semantics, deliberately — NOT the deleted getTodayContext's
// Math.round/clamp variant (#285). Parity with every pre-extraction call site
// is proven by rotation-core.test.ts, which keeps frozen copies of the old
// inline formulas and compares over a date × plan-window grid that crosses
// both DST transitions.
//
// Known property carried over verbatim (NOT a new bug, do not "fix" without a
// migration story — XP is fully derived and retroactive, gotchas §E.1): the
// ms-diff of two USER_TZ midnights across a spring-forward transition is 1h
// short of a whole day, so Math.floor undercounts daysDelta by 1 for dates
// after a spring-forward INSIDE the plan window. The game engine's ledger
// walks day indexes instead (addDays), which does not undercount. The two
// agree exactly on any window that contains no spring-forward day (all
// founder history to date: Elbert May–Aug 2026, Phase 2A Aug–Dec 2026 — the
// Nov fall-back adds an hour, which floor absorbs). rotation-core keeps both
// entry points (date-based daysDelta for calendar surfaces, index-based
// rotationDay/weekIndex for the engine) so each surface's behavior is
// byte-identical to what it did before consolidation.
//
// Client-safe: pure — no Prisma, no IO. Imports only calendar-core (Intl
// wall-clock math) and program-template types.

import { startOfDay, endOfDay, addDays } from "./calendar-core";
import type {
  ProgramTemplate,
  DayTemplate,
  BaselineDay,
  BaselineTest,
} from "./program-template";

const DAY_MS = 24 * 3600 * 1000;

/** Minimal structural plan shape the template-aware helpers need. Satisfied
 *  by ActiveProgramSnapshot / ProgramForDate / PlanWindowCandidate. */
export type RotationPlanShape = {
  startedOn: Date;
  template: ProgramTemplate;
};

// ─────────────────────────────────────────────────────────────────────────────
// The four primitives
// ─────────────────────────────────────────────────────────────────────────────

/** Whole days from the plan's start day to `date` (both taken at USER_TZ
 *  midnight). Negative before the start day. resolveDay's exact formula. */
export function daysDelta(startedOn: Date, date: Date): number {
  return Math.floor(
    (startOfDay(date).getTime() - startOfDay(startedOn).getTime()) / DAY_MS,
  );
}

/** Is a daysDelta inside the plan's calendar window (0 ≤ delta < weeks·7)? */
export function isInPlan(delta: number, totalWeeks: number): boolean {
  return delta >= 0 && delta < totalWeeks * 7;
}

/** Rotation day 1..7 for a daysDelta (or a ledger day index — same formula).
 *  Day 1 lands on plan.startedOn, NOT a calendar weekday. */
export function rotationDay(delta: number): number {
  return (((delta % 7) + 7) % 7) + 1;
}

/** Rotation week 1..totalWeeks for a daysDelta (or a ledger day index). */
export function weekIndex(delta: number): number {
  return Math.floor(delta / 7) + 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Composites
// ─────────────────────────────────────────────────────────────────────────────

export type RotationPosition = {
  daysDelta: number;
  isInPlan: boolean;
  /** null when out of plan. */
  rotationDay: number | null;
  /** null when out of plan. */
  weekIndex: number | null;
};

/** The (daysDelta, isInPlan, rotationDay, weekIndex) tuple every day-resolving
 *  surface starts from — resolveDay's hoisted block, buildCell's per-cell
 *  block, and the ledger's per-day math are all this one function now. */
export function rotationPosition(
  startedOn: Date,
  totalWeeks: number,
  date: Date,
): RotationPosition {
  const delta = daysDelta(startedOn, date);
  if (!isInPlan(delta, totalWeeks)) {
    return { daysDelta: delta, isInPlan: false, rotationDay: null, weekIndex: null };
  }
  return {
    daysDelta: delta,
    isInPlan: true,
    rotationDay: rotationDay(delta),
    weekIndex: weekIndex(delta),
  };
}

/** USER_TZ midnight of the calendar day carrying (weekIndex, rotationDay). */
export function dateForRotationSlot(
  startedOn: Date,
  weekIdx: number,
  rotDay: number,
): Date {
  return addDays(startOfDay(startedOn), (weekIdx - 1) * 7 + (rotDay - 1));
}

/** First and last instant of a rotation week (day 1 midnight → day 7
 *  end-of-day). Formerly a private helper inside calendar.ts. */
export function rotationWeekWindow(
  startedOn: Date,
  weekIdx: number,
): { start: Date; end: Date } {
  const weekStart = dateForRotationSlot(startedOn, weekIdx, 1);
  return { start: weekStart, end: endOfDay(addDays(weekStart, 6)) };
}

/** USER_TZ midnight of the last day the plan window covers
 *  (startedOn + totalWeeks·7 − 1 days). */
export function lastPlanDayStart(startedOn: Date, totalWeeks: number): Date {
  return addDays(startOfDay(startedOn), totalWeeks * 7 - 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Baseline scheduling predicate
// ─────────────────────────────────────────────────────────────────────────────

/** Is this test due in rotation week `weekIdx` by rotation default? Due on its
 *  initial week (initialWeek ?? 1) and on any listed retest week strictly
 *  after it. The same predicate previously copy-pasted in resolveDay,
 *  buildCell, scheduledBaselineTests, rotationBaselineNamesForDate,
 *  weekConflicts, and the engine's ledger. */
export function isTestDueInWeek(
  test: Pick<BaselineTest, "initialWeek" | "retestWeeks">,
  weekIdx: number,
): boolean {
  const initialWeek = test.initialWeek ?? 1;
  return (
    weekIdx === initialWeek ||
    (weekIdx > initialWeek && (test.retestWeeks?.includes(weekIdx) ?? false))
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure template lookups (moved verbatim from calendar.ts; re-exported there)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the rotation-day template that would render on `date` if no override
 * existed. Returns null when `date` is outside the plan's calendar window.
 * Override-unaware by design — this is the "base" view that
 * PlanDayOverride.workoutJson layers on top of.
 */
export function templateForRotationDay(
  program: RotationPlanShape,
  date: Date,
): DayTemplate | null {
  const pos = rotationPosition(program.startedOn, program.template.totalWeeks, date);
  if (!pos.isInPlan) return null;
  return (
    program.template.weeklySplit.find((d) => d.dayOfWeek === pos.rotationDay) ?? null
  );
}

/**
 * Pure coverage check — is `date` within the plan's calendar window? Used by
 * history-write guards (day-actions / day-log-actions) to independently verify
 * a write target server-side. No completion clamp here (unlike program.ts's
 * coversDayKey) — an ACTIVE plan's goal is by definition not yet completed.
 */
export function isDateWithinActivePlanWindow(
  program: { startedOn: Date; template: { totalWeeks: number } },
  date: Date,
): boolean {
  return isInPlan(daysDelta(program.startedOn, date), program.template.totalWeeks);
}

/**
 * Baseline test names that would appear on `date` by rotation default (initial
 * week + retest weeks). Ignores any per-day override — answers "what would a
 * fresh day with no override show?".
 */
export function rotationBaselineNamesForDate(
  program: RotationPlanShape,
  date: Date,
): string[] {
  const pos = rotationPosition(program.startedOn, program.template.totalWeeks, date);
  if (!pos.isInPlan) return [];
  const baselineDay = program.template.baselineWeek?.find(
    (d) => d.dayOfWeek === pos.rotationDay,
  );
  if (!baselineDay) return [];
  return baselineDay.tests
    .filter((t) => isTestDueInWeek(t, pos.weekIndex!))
    .map((t) => t.testName);
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared override→template merge (the SHAPE of a day's decisions)
// ─────────────────────────────────────────────────────────────────────────────

/** The two per-day override columns the merge reads, as raw (untrusted) Json.
 *  Structurally satisfied by a PlanDayOverride row, the engine's pre-bucketed
 *  override map values, and buildCell's override map values. */
export type RotationOverrideInput = {
  workoutJson?: unknown;
  baselineTestNames?: unknown;
} | null | undefined;

export type ScheduledBaselineTest = {
  test: BaselineTest;
  baselineDay: BaselineDay;
  checkpoint: "initial" | "retest";
};

export type MergedDayCore = {
  /** The day's template AFTER override precedence: override.workoutJson when
   *  set, else the rotation day's weeklySplit entry, else null. */
  workoutTemplate: DayTemplate | null;
  /** True iff override.workoutJson drives the day (resolveDay's isOverride). */
  isOverride: boolean;
  /** The tests scheduled on this day, override-aware:
   *   - override.baselineTestNames is an array → that exact list, each name
   *     looked up across the whole baselineWeek (unknown names silently
   *     dropped; empty array = explicitly none), week filter bypassed — the
   *     user explicitly placed these tests on this date.
   *   - otherwise → the rotation day's tests that are due this week
   *     (isTestDueInWeek). */
  baselineTests: ScheduledBaselineTest[];
};

/**
 * The single implementation of override→template precedence + baseline-due
 * resolution (G6 / B4). resolveDay, buildCell, and the XP engine's
 * buildDayLedger all feed their (bulk-fetched) per-day override through here —
 * the decision SHAPE exists exactly once; only the data fetching differs per
 * surface.
 *
 * Semantics notes (canonical = resolveDay at extraction time):
 *   - workoutJson gate is TRUTHY (resolveDay/buildCell used `if (override?.
 *     workoutJson)`; the engine and weekConflicts used `!= null`). The two
 *     agree on every value the app can store — apply_day_override Zod-validates
 *     workoutJson as a DayTemplate object, so it is always object-or-null.
 *   - checkpoint label: "retest" iff weekIdx is strictly past the test's
 *     initial week AND listed in retestWeeks; "initial" otherwise (covers a
 *     deferred initial parked on an override date outside its week).
 *   - unknown override names are dropped (resolveDay/buildCell semantics; the
 *     old engine kept raw names — scripts/diff-xp-ledger.ts proves this has
 *     zero effect on real history).
 */
export function mergeDayOverride(
  template: ProgramTemplate,
  rotDay: number,
  weekIdx: number,
  override: RotationOverrideInput,
): MergedDayCore {
  let workoutTemplate: DayTemplate | null = null;
  let isOverride = false;

  if (override?.workoutJson) {
    workoutTemplate = override.workoutJson as unknown as DayTemplate;
    isOverride = true;
  } else {
    workoutTemplate =
      template.weeklySplit.find((d) => d.dayOfWeek === rotDay) ?? null;
  }

  const overrideNames = Array.isArray(override?.baselineTestNames)
    ? (override!.baselineTestNames as unknown as string[])
    : null;

  const checkpointFor = (test: BaselineTest): "initial" | "retest" => {
    const initialWeek = test.initialWeek ?? 1;
    return weekIdx > initialWeek && test.retestWeeks?.includes(weekIdx)
      ? "retest"
      : "initial";
  };

  const baselineTests: ScheduledBaselineTest[] = [];
  if (overrideNames !== null) {
    for (const name of overrideNames) {
      for (const day of template.baselineWeek ?? []) {
        const test = day.tests.find((t) => t.testName === name);
        if (test) {
          baselineTests.push({ test, baselineDay: day, checkpoint: checkpointFor(test) });
          break;
        }
      }
    }
  } else {
    const baselineDay = template.baselineWeek?.find((d) => d.dayOfWeek === rotDay);
    if (baselineDay) {
      for (const test of baselineDay.tests) {
        if (isTestDueInWeek(test, weekIdx)) {
          baselineTests.push({ test, baselineDay, checkpoint: checkpointFor(test) });
        }
      }
    }
  }

  return { workoutTemplate, isOverride, baselineTests };
}
