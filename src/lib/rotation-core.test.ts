// src/lib/rotation-core.test.ts
//
// B4/A3 consolidation proof: rotation-core's canonical math is BYTE-IDENTICAL
// to every inline formula it replaced. The "old" functions below are FROZEN
// verbatim copies of the pre-consolidation code (calendar.ts / program.ts /
// game/engine.ts / mcp/tools.ts @4cc44b4), kept here as fixtures — if
// rotation-core ever drifts from what those sites used to compute, this suite
// fails.
//
// The grid deliberately crosses both America/Denver DST transitions
// (2026-03-08 spring forward, 2026-11-01 / 2025-11-02 fall back) because the
// formulas are floor-of-ms-diff over USER_TZ midnights — the one place a
// "simplification" could silently change results.

import { describe, it, expect } from "vitest";
import {
  startOfDay,
  endOfDay,
  addDays,
  dateKey,
  parseDateKey,
} from "@/lib/calendar-core";
import {
  daysDelta,
  isInPlan,
  rotationDay,
  weekIndex,
  rotationPosition,
  rotationWeekWindow,
  dateForRotationSlot,
  lastPlanDayStart,
  isTestDueInWeek,
  templateForRotationDay,
  isDateWithinActivePlanWindow,
  rotationBaselineNamesForDate,
  mergeDayOverride,
} from "@/lib/rotation-core";
import type {
  ProgramTemplate,
  DayTemplate,
  BaselineDay,
  BaselineTest,
} from "@/lib/program-template";

// ─────────────────────────────────────────────────────────────────────────────
// FROZEN pre-consolidation formulas (verbatim from the replaced sites)
// ─────────────────────────────────────────────────────────────────────────────

/** calendar.ts resolveDay hoisted block (@4cc44b4:1058-1069). */
function oldResolveDayMath(startedOn: Date, date: Date, totalWeeks: number) {
  const dayStart = startOfDay(date);
  const startMid = startOfDay(startedOn);
  const daysDelta = Math.floor(
    (dayStart.getTime() - startMid.getTime()) / (24 * 3600 * 1000),
  );
  let isInPlan = false;
  let rotationDay: number | null = null;
  let weekIndex: number | null = null;
  if (daysDelta >= 0 && daysDelta < totalWeeks * 7) {
    isInPlan = true;
    rotationDay = (((daysDelta % 7) + 7) % 7) + 1;
    weekIndex = Math.floor(daysDelta / 7) + 1;
  }
  return { daysDelta, isInPlan, rotationDay, weekIndex };
}

/** calendar.ts buildCell block (@4cc44b4:459-467) — the dateKey-compare
 *  variant of the in-plan lower bound. */
function oldBuildCellMath(startedOn: Date, date: Date, totalWeeks: number) {
  const k = dateKey(date);
  const startKey = dateKey(startedOn);
  const startMid = startOfDay(startedOn);
  const dMid = startOfDay(date);
  const daysDelta = Math.floor((dMid.getTime() - startMid.getTime()) / (24 * 3600 * 1000));
  let isInPlan = false;
  let rotationDay: number | null = null;
  let weekIndex: number | null = null;
  if (k >= startKey && daysDelta < totalWeeks * 7) {
    isInPlan = true;
    rotationDay = (((daysDelta % 7) + 7) % 7) + 1;
    weekIndex = Math.floor(daysDelta / 7) + 1;
  }
  return { isInPlan, rotationDay, weekIndex };
}

/** game/engine.ts buildDayLedger step 2 (@4cc44b4:168-169) — index-based. */
function oldEngineMath(d: number) {
  return {
    rotationDay: ((d % 7) + 7) % 7 + 1,
    weekIndex: Math.floor(d / 7) + 1,
  };
}

/** program.ts coversDayKey (@4cc44b4:307-318). */
function oldCoversDayKey(
  program: { startedOn: Date; template: { totalWeeks: number } },
  targetDayKey: string,
  goalCompletedAt?: Date | null,
): boolean {
  const startMid = startOfDay(program.startedOn);
  const targetMid = parseDateKey(targetDayKey);
  const daysDelta = Math.floor((targetMid.getTime() - startMid.getTime()) / (24 * 3600 * 1000));
  if (daysDelta < 0 || daysDelta >= program.template.totalWeeks * 7) return false;
  if (goalCompletedAt && targetMid.getTime() > startOfDay(goalCompletedAt).getTime()) return false;
  return true;
}

/** calendar.ts templateForRotationDay (@4cc44b4:1535-1545). */
function oldTemplateForRotationDay(
  program: { startedOn: Date; template: ProgramTemplate },
  date: Date,
): DayTemplate | null {
  const startMid = startOfDay(program.startedOn);
  const dayStart = startOfDay(date);
  const daysDelta = Math.floor((dayStart.getTime() - startMid.getTime()) / (24 * 3600 * 1000));
  if (daysDelta < 0 || daysDelta >= program.template.totalWeeks * 7) return null;
  const rotationDay = (((daysDelta % 7) + 7) % 7) + 1;
  return program.template.weeklySplit.find((d) => d.dayOfWeek === rotationDay) ?? null;
}

/** calendar.ts isDateWithinActivePlanWindow (@4cc44b4:1562-1570). */
function oldIsDateWithinActivePlanWindow(
  program: { startedOn: Date; template: { totalWeeks: number } },
  date: Date,
): boolean {
  const startMid = startOfDay(program.startedOn);
  const dayStart = startOfDay(date);
  const daysDelta = Math.floor((dayStart.getTime() - startMid.getTime()) / (24 * 3600 * 1000));
  return daysDelta >= 0 && daysDelta < program.template.totalWeeks * 7;
}

/** calendar.ts rotationBaselineNamesForDate (@4cc44b4:1572-1590). */
function oldRotationBaselineNamesForDate(
  program: { startedOn: Date; template: ProgramTemplate },
  date: Date,
): string[] {
  const startMid = startOfDay(program.startedOn);
  const dayStart = startOfDay(date);
  const daysDelta = Math.floor((dayStart.getTime() - startMid.getTime()) / (24 * 3600 * 1000));
  if (daysDelta < 0 || daysDelta >= program.template.totalWeeks * 7) return [];
  const rotationDay = (((daysDelta % 7) + 7) % 7) + 1;
  const weekIndex = Math.floor(daysDelta / 7) + 1;
  const baselineDay = program.template.baselineWeek?.find((d) => d.dayOfWeek === rotationDay);
  if (!baselineDay) return [];
  return baselineDay.tests
    .filter((t) => {
      const initialWeek = t.initialWeek ?? 1;
      return weekIndex === initialWeek || (weekIndex > initialWeek && t.retestWeeks?.includes(weekIndex));
    })
    .map((t) => t.testName);
}

/** calendar.ts private rotationWeekWindow (@4cc44b4:1617-1623). */
function oldRotationWeekWindow(startedOn: Date, weekIndex: number) {
  const weekStart = addDays(startOfDay(startedOn), (weekIndex - 1) * 7);
  return { start: weekStart, end: endOfDay(addDays(weekStart, 6)) };
}

/** mcp/tools.ts get_week anchor math (@4cc44b4:857-864). */
function oldGetWeekAnchor(startedOn: Date, baseDate: Date) {
  const anchorStartMid = startOfDay(startedOn);
  const baseDayStart = startOfDay(baseDate);
  const anchorDaysDelta = Math.floor(
    (baseDayStart.getTime() - anchorStartMid.getTime()) / (24 * 3600 * 1000),
  );
  const anchorWi = Math.floor(anchorDaysDelta / 7) + 1;
  const weekStart = addDays(anchorStartMid, (anchorWi - 1) * 7);
  return { anchorWi, weekStart };
}

/** mcp/tools.ts get_week day0 label math (@4cc44b4:921-927) — direct
 *  floor-of-week-ms variant. */
function oldGetWeekDay0Wi(startedOn: Date, weekStart: Date): number {
  return (
    Math.floor(
      (startOfDay(weekStart).getTime() - startOfDay(startedOn).getTime()) /
        (24 * 3600 * 1000 * 7),
    ) + 1
  );
}

/** mcp/tools.ts confirm_week currentWeekIdx (@4cc44b4:2590-2598). */
function oldConfirmWeekIdx(startedOn: Date, confirmedThroughDate: Date): number {
  const startMid = startOfDay(startedOn);
  const markMid = startOfDay(confirmedThroughDate);
  const delta = Math.floor((markMid.getTime() - startMid.getTime()) / (24 * 3600 * 1000));
  return delta < 0 ? 0 : Math.floor(delta / 7) + 1;
}

/** calendar.ts scheduledBaselineTests (@4cc44b4:641-669) — buildCell's
 *  override-aware scheduled set. */
function oldScheduledBaselineTests(
  template: ProgramTemplate,
  weekIndex: number,
  rotationDay: number,
  overrideNames: string[] | null,
): BaselineTest[] {
  if (overrideNames !== null) {
    const out: BaselineTest[] = [];
    for (const name of overrideNames) {
      for (const day of template.baselineWeek ?? []) {
        const t = day.tests.find((x) => x.testName === name);
        if (t) {
          out.push(t);
          break;
        }
      }
    }
    return out;
  }
  const day = template.baselineWeek?.find((d) => d.dayOfWeek === rotationDay);
  if (!day) return [];
  return day.tests.filter((t) => {
    const initialWeek = t.initialWeek ?? 1;
    return (
      weekIndex === initialWeek ||
      (weekIndex > initialWeek && (t.retestWeeks?.includes(weekIndex) ?? false))
    );
  });
}

/** calendar.ts resolveDay override→template + baselinesDue decision block
 *  (@4cc44b4:1189-1222 + the final due-filter at 1273-1279), pure part only. */
function oldResolveDayDayDecision(
  template: ProgramTemplate,
  rotationDay: number,
  weekIndex: number,
  override: { workoutJson?: unknown; baselineTestNames?: unknown } | null | undefined,
) {
  let workoutTemplate: DayTemplate | null = null;
  let isOverride = false;
  if (override?.workoutJson) {
    workoutTemplate = override.workoutJson as unknown as DayTemplate;
    isOverride = true;
  } else {
    workoutTemplate = template.weeklySplit.find((d) => d.dayOfWeek === rotationDay) ?? null;
  }

  const overrideNames = Array.isArray(override?.baselineTestNames)
    ? (override!.baselineTestNames as unknown as string[])
    : null;

  let testsForDay: { test: BaselineTest; baselineDay: BaselineDay }[] = [];
  if (overrideNames !== null) {
    for (const name of overrideNames) {
      for (const day of template.baselineWeek ?? []) {
        const test = day.tests.find((t) => t.testName === name);
        if (test) {
          testsForDay.push({ test, baselineDay: day });
          break;
        }
      }
    }
  } else {
    const baselineDay = template.baselineWeek?.find((d) => d.dayOfWeek === rotationDay);
    if (baselineDay) {
      testsForDay = baselineDay.tests.map((test) => ({ test, baselineDay }));
    }
  }

  const baselinesDue: { testName: string; checkpoint: "initial" | "retest" }[] = [];
  for (const { test } of testsForDay) {
    const initialWeek = test.initialWeek ?? 1;
    const checkpoint: "initial" | "retest" =
      weekIndex > initialWeek && test.retestWeeks?.includes(weekIndex) ? "retest" : "initial";
    if (overrideNames !== null) {
      baselinesDue.push({ testName: test.testName, checkpoint });
    } else if (weekIndex === initialWeek) {
      baselinesDue.push({ testName: test.testName, checkpoint: "initial" });
    } else if (weekIndex > initialWeek && test.retestWeeks?.includes(weekIndex)) {
      baselinesDue.push({ testName: test.testName, checkpoint: "retest" });
    }
  }
  return { workoutTemplate, isOverride, baselinesDue };
}

/** game/engine.ts buildDayLedger steps 4-5 (@4cc44b4:174-211). */
function oldEngineDayDecision(
  template: ProgramTemplate,
  rotationDay: number,
  weekIndex: number,
  override: { workoutJson: unknown; baselineTestNames: string[] | null } | null,
) {
  let workoutTemplate: { category?: string | null; title?: string | null } | null = null;
  let isOverride = false;
  if (override?.workoutJson != null) {
    workoutTemplate = override.workoutJson as { category?: string | null; title?: string | null };
    isOverride = true;
  } else {
    workoutTemplate = template.weeklySplit?.find((t) => t.dayOfWeek === rotationDay) ?? null;
  }

  const overrideNames = Array.isArray(override?.baselineTestNames)
    ? (override!.baselineTestNames as string[])
    : null;

  const dueBaselineNames: string[] = [];
  if (overrideNames !== null) {
    dueBaselineNames.push(...overrideNames);
  } else {
    const baselineDay = template.baselineWeek?.find((bd) => bd.dayOfWeek === rotationDay);
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
  return { workoutTemplate, isOverride, dueBaselineNames };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const SPLIT: DayTemplate[] = [1, 2, 3, 4, 5, 6, 7].map((dow) => ({
  dayOfWeek: dow as DayTemplate["dayOfWeek"],
  title: `Day ${dow}`,
  category: dow === 7 ? "rest" : dow === 6 ? "long-endurance" : "upper",
  summary: "",
  blocks: [],
})) as DayTemplate[];

const BASELINE_WEEK: BaselineDay[] = [
  {
    dayOfWeek: 1,
    title: "Battery A",
    tests: [
      { testName: "Known A", units: "sec", protocol: "", retestWeeks: [4, 10] },
      { testName: "Late Initial", units: "reps", protocol: "", initialWeek: 3, retestWeeks: [8] },
    ],
  },
  {
    dayOfWeek: 4,
    title: "Battery B",
    tests: [{ testName: "Known B", units: "reps", protocol: "", retestWeeks: [2] }],
  },
];

function template(totalWeeks: number): ProgramTemplate {
  return {
    name: "parity",
    totalWeeks,
    phases: [],
    weeklySplit: SPLIT,
    baselineWeek: BASELINE_WEEK,
    goals: [],
  } as unknown as ProgramTemplate;
}

// Plan windows crossing both DST transitions + plain windows.
const GRID: { startKey: string; totalWeeks: number; label: string }[] = [
  { startKey: "2026-01-05", totalWeeks: 2, label: "plain winter" },
  { startKey: "2026-01-05", totalWeeks: 12, label: "crosses 2026-03-08 spring-forward" },
  { startKey: "2026-03-02", totalWeeks: 2, label: "spring-forward in week 1" },
  { startKey: "2025-10-27", totalWeeks: 2, label: "crosses 2025-11-02 fall-back" },
  { startKey: "2026-08-10", totalWeeks: 20, label: "Phase 2A window (fall-back inside)" },
];

/** All probe dates for a window: 10 days before through 10 days past the end,
 *  walked with addDays (wall-clock days), plus noon/23:00 variants every 5th
 *  day (time-of-day must be irrelevant — everything goes through startOfDay). */
function probeDates(startedOn: Date, totalWeeks: number): Date[] {
  const out: Date[] = [];
  const first = addDays(startOfDay(startedOn), -10);
  const span = totalWeeks * 7 + 20;
  for (let i = 0; i <= span; i++) {
    const d = addDays(first, i);
    out.push(d);
    if (i % 5 === 0) {
      out.push(new Date(d.getTime() + 12 * 3600 * 1000));
      out.push(new Date(d.getTime() + 23 * 3600 * 1000));
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parity: the four primitives vs every frozen site
// ─────────────────────────────────────────────────────────────────────────────

describe("rotation-core parity — resolveDay / buildCell / templateFor* / coversDayKey frozen formulas", () => {
  for (const { startKey, totalWeeks, label } of GRID) {
    it(`byte-identical across the ${label} window (${startKey}, ${totalWeeks}w)`, () => {
      const startedOn = parseDateKey(startKey);
      const tmpl = template(totalWeeks);
      const program = { startedOn, template: tmpl };

      for (const date of probeDates(startedOn, totalWeeks)) {
        const old = oldResolveDayMath(startedOn, date, totalWeeks);
        const neu = rotationPosition(startedOn, totalWeeks, date);

        // Primitive-by-primitive.
        expect(daysDelta(startedOn, date)).toBe(old.daysDelta);
        expect(isInPlan(old.daysDelta, totalWeeks)).toBe(old.isInPlan);
        expect(neu.daysDelta).toBe(old.daysDelta);
        expect(neu.isInPlan).toBe(old.isInPlan);
        expect(neu.rotationDay).toBe(old.rotationDay);
        expect(neu.weekIndex).toBe(old.weekIndex);
        if (old.isInPlan) {
          expect(rotationDay(old.daysDelta)).toBe(old.rotationDay);
          expect(weekIndex(old.daysDelta)).toBe(old.weekIndex);
        }

        // buildCell's dateKey-compare lower bound === the delta>=0 bound.
        const cell = oldBuildCellMath(startedOn, date, totalWeeks);
        expect(neu.isInPlan).toBe(cell.isInPlan);
        expect(neu.rotationDay).toBe(cell.rotationDay);
        expect(neu.weekIndex).toBe(cell.weekIndex);

        // Moved pure helpers.
        expect(templateForRotationDay(program, date)).toEqual(
          oldTemplateForRotationDay(program, date),
        );
        expect(isDateWithinActivePlanWindow(program, date)).toBe(
          oldIsDateWithinActivePlanWindow(program, date),
        );
        expect(rotationBaselineNamesForDate(program, date)).toEqual(
          oldRotationBaselineNamesForDate(program, date),
        );

        // coversDayKey (no clamp / clamped before / clamped after).
        const dk = dateKey(date);
        expect(
          isInPlan(daysDelta(startedOn, parseDateKey(dk)), totalWeeks),
        ).toBe(oldCoversDayKey(program, dk));

        // get_week anchor + confirm_week math.
        const oldAnchor = oldGetWeekAnchor(startedOn, date);
        const newWi = weekIndex(daysDelta(startedOn, date));
        expect(newWi).toBe(oldAnchor.anchorWi);
        expect(dateForRotationSlot(startedOn, newWi, 1).getTime()).toBe(
          oldAnchor.weekStart.getTime(),
        );
        // day0 label math: floor(floor(x)/7) === floor(x/7) identity.
        expect(weekIndex(daysDelta(startedOn, oldAnchor.weekStart))).toBe(
          oldGetWeekDay0Wi(startedOn, oldAnchor.weekStart),
        );
        const oldDelta = daysDelta(startedOn, date);
        expect(oldDelta < 0 ? 0 : weekIndex(oldDelta)).toBe(
          oldConfirmWeekIdx(startedOn, date),
        );
      }

      // rotationWeekWindow + dateForRotationSlot over every week of the window.
      for (let wi = 1; wi <= totalWeeks; wi++) {
        const oldWin = oldRotationWeekWindow(startedOn, wi);
        const newWin = rotationWeekWindow(startedOn, wi);
        expect(newWin.start.getTime()).toBe(oldWin.start.getTime());
        expect(newWin.end.getTime()).toBe(oldWin.end.getTime());
        for (let rd = 1; rd <= 7; rd++) {
          expect(dateForRotationSlot(startedOn, wi, rd).getTime()).toBe(
            addDays(startOfDay(startedOn), (wi - 1) * 7 + (rd - 1)).getTime(),
          );
        }
      }

      // Engine index math over the whole window.
      for (let d = 0; d < totalWeeks * 7; d++) {
        const old = oldEngineMath(d);
        expect(rotationDay(d)).toBe(old.rotationDay);
        expect(weekIndex(d)).toBe(old.weekIndex);
      }

      // lastPlanDayStart === the two frozen window-end expressions.
      expect(lastPlanDayStart(startedOn, totalWeeks).getTime()).toBe(
        addDays(startOfDay(startedOn), totalWeeks * 7 - 1).getTime(),
      );
      expect(lastPlanDayStart(startedOn, totalWeeks).getTime()).toBe(
        addDays(startedOn, totalWeeks * 7 - 1).getTime(), // engine's variant (addDays normalizes)
      );
    });
  }

  it("coversDayKey completion clamp: completion day covered, day after not (S4 semantics preserved)", () => {
    const startedOn = parseDateKey("2026-01-05");
    const program = { startedOn, template: template(4) };
    const completedAt = parseDateKey("2026-01-20");
    for (const dk of ["2026-01-19", "2026-01-20", "2026-01-21", "2026-02-10"]) {
      const targetMid = parseDateKey(dk);
      const newCovered =
        isInPlan(daysDelta(startedOn, targetMid), 4) &&
        !(targetMid.getTime() > startOfDay(completedAt).getTime());
      expect(newCovered).toBe(oldCoversDayKey(program, dk, completedAt));
    }
  });

  it("documents the carried-over DST property: the ledger's day index and the date-based daysDelta agree except after a spring-forward inside the window", () => {
    // Fall-back window: index === delta everywhere (the extra hour is floored away).
    const fall = parseDateKey("2025-10-27");
    for (let d = 0; d < 14; d++) {
      expect(daysDelta(fall, addDays(startOfDay(fall), d))).toBe(d);
    }
    // Spring-forward window: dates after the transition undercount by exactly 1
    // (resolveDay's historical behavior, preserved verbatim — see the
    // rotation-core module doc; the engine keeps its index-based walk).
    const spring = parseDateKey("2026-03-02"); // transition on 2026-03-08 = index 6
    for (let d = 0; d < 14; d++) {
      const expected = d <= 6 ? d : d - 1;
      expect(daysDelta(spring, addDays(startOfDay(spring), d))).toBe(expected);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Parity: mergeDayOverride vs the three frozen decision blocks
// ─────────────────────────────────────────────────────────────────────────────

const OVERRIDE_TEMPLATE = {
  dayOfWeek: 2,
  title: "Coach Swap",
  category: "zone2-mobility",
  summary: "swapped",
  blocks: [],
} as unknown as DayTemplate;

const OVERRIDE_VARIANTS: {
  name: string;
  override: { workoutJson?: unknown; baselineTestNames?: unknown } | null | undefined;
}[] = [
  { name: "no override row", override: undefined },
  { name: "null override row", override: null },
  { name: "workoutJson only", override: { workoutJson: OVERRIDE_TEMPLATE } },
  { name: "explicit empty baseline list", override: { baselineTestNames: [] } },
  { name: "known baseline name", override: { baselineTestNames: ["Known A"] } },
  { name: "known + unknown baseline names", override: { baselineTestNames: ["Known A", "Ghost Test"] } },
  { name: "both fields set", override: { workoutJson: OVERRIDE_TEMPLATE, baselineTestNames: ["Known B"] } },
  { name: "workoutJson null + names", override: { workoutJson: null, baselineTestNames: ["Known B"] } },
];

describe("mergeDayOverride parity — resolveDay / buildCell / engine frozen decision blocks", () => {
  const tmpl = template(12);

  for (const { name, override } of OVERRIDE_VARIANTS) {
    it(`matches resolveDay's and buildCell's frozen decisions: ${name}`, () => {
      for (let rd = 1; rd <= 7; rd++) {
        for (const wi of [1, 2, 3, 4, 8, 10, 12]) {
          const merged = mergeDayOverride(tmpl, rd, wi, override);
          const oldR = oldResolveDayDayDecision(tmpl, rd, wi, override);

          // Template precedence + isOverride: identical to resolveDay.
          expect(merged.workoutTemplate).toEqual(oldR.workoutTemplate);
          expect(merged.isOverride).toBe(oldR.isOverride);

          // Scheduled set + checkpoint labels: identical to resolveDay's
          // baselinesDue (order included).
          expect(
            merged.baselineTests.map((t) => ({
              testName: t.test.testName,
              checkpoint: t.checkpoint,
            })),
          ).toEqual(oldR.baselinesDue);

          // buildCell's scheduledBaselineTests: same test set.
          const overrideNames = Array.isArray(override?.baselineTestNames)
            ? (override!.baselineTestNames as string[])
            : null;
          expect(merged.baselineTests.map((t) => t.test)).toEqual(
            oldScheduledBaselineTests(tmpl, wi, rd, overrideNames),
          );
        }
      }
    });
  }

  it("matches the engine's frozen dueBaselineNames on every variant WITHOUT unknown names; drops unknown names where the old engine kept them raw (resolveDay semantics win — diff-xp-ledger.ts proves zero real-history impact)", () => {
    for (const { name, override } of OVERRIDE_VARIANTS) {
      for (let rd = 1; rd <= 7; rd++) {
        for (const wi of [1, 2, 4, 10]) {
          const engineOverride = override
            ? {
                workoutJson: override.workoutJson ?? null,
                baselineTestNames: Array.isArray(override.baselineTestNames)
                  ? (override.baselineTestNames as string[])
                  : null,
              }
            : null;
          const merged = mergeDayOverride(tmpl, rd, wi, override);
          const oldE = oldEngineDayDecision(tmpl, rd, wi, engineOverride);

          expect(merged.isOverride).toBe(oldE.isOverride);
          // Template object: the engine read the same weeklySplit entry /
          // override Json — compare titles (its local type was narrower).
          expect(merged.workoutTemplate?.title ?? null).toBe(oldE.workoutTemplate?.title ?? null);
          expect(merged.workoutTemplate?.category ?? null).toBe(
            oldE.workoutTemplate?.category ?? null,
          );

          const newNames = merged.baselineTests.map((t) => t.test.testName);
          if (name === "known + unknown baseline names") {
            // The ONE documented divergence: old engine kept the raw list
            // (["Known A", "Ghost Test"]); the canonical semantics drop
            // unknown names exactly like resolveDay/buildCell always did.
            expect(oldE.dueBaselineNames).toEqual(["Known A", "Ghost Test"]);
            expect(newNames).toEqual(["Known A"]);
          } else {
            expect(newNames).toEqual(oldE.dueBaselineNames);
          }
        }
      }
    }
  });

  it("isTestDueInWeek matches the copy-pasted due predicate for defaulted and explicit initial weeks", () => {
    const cases: { test: Pick<BaselineTest, "initialWeek" | "retestWeeks">; weeks: number[] }[] = [
      { test: { retestWeeks: [4, 10] }, weeks: [1, 2, 3, 4, 5, 9, 10, 11] },
      { test: { initialWeek: 3, retestWeeks: [8] }, weeks: [1, 2, 3, 4, 7, 8, 9] },
      { test: { initialWeek: 2 }, weeks: [1, 2, 3] },
      // Degenerate: a retest listed AT/BEFORE the initial week never fires
      // (weekIdx > initialWeek strictness) — plan-lint flags these as errors.
      { test: { initialWeek: 5, retestWeeks: [5, 4] }, weeks: [4, 5, 6] },
    ];
    for (const { test, weeks } of cases) {
      for (const wi of weeks) {
        const initialWeek = test.initialWeek ?? 1;
        const oldDue =
          wi === initialWeek ||
          (wi > initialWeek && (test.retestWeeks?.includes(wi) ?? false));
        expect(isTestDueInWeek(test, wi)).toBe(oldDue);
      }
    }
  });
});
