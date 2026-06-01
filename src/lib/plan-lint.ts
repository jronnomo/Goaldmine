// Plan linter — structural + data-integrity checks over a plan template and the
// active plan's persisted state. Catches the class of long-plan errors that
// otherwise surface only when the user is staring at a broken calendar:
// meaningless retests, weeks that don't tile, metadata drift, baseline tests
// colliding with heavy training days, phantom values, orphaned overrides, and
// duplicate planned hikes.
//
// Two entry points:
//  - lintTemplate(): PURE. Runs the template-only rules against a candidate
//    snapshot + plan metadata. Used by apply_plan_revision to vet a proposed
//    revision BEFORE it's written. No DB access.
//  - lintActivePlan(): DB-backed. Loads the active plan/goal + baselines +
//    overrides + planned hikes and runs every rule. Backs the lint_plan MCP
//    tool so the coach can self-check on demand.

import { addDays, startOfDay } from "@/lib/calendar";
import { prisma } from "@/lib/db";
import { getActiveProgram } from "@/lib/program";
import { getBaselineSchedule } from "@/lib/records";
import type { ProgramTemplate } from "@/lib/program-template";

export type LintSeverity = "error" | "warning";

export type LintFinding = {
  rule: string;
  severity: LintSeverity;
  message: string;
  context?: unknown;
};

export type PlanMeta = {
  weeks: number;
  endsOn: Date;
  startedOn: Date;
  goalTargetDate: Date;
};

// Training categories that represent a hard session. A baseline test landing on
// one of these in the rotation collides with real work — the user can't both
// max-test and lift heavy on the same day. (zone2-mobility, long-endurance, and
// rest are light enough to absorb a test.)
const HEAVY_CATEGORIES = new Set<string>(["upper", "lower", "lower-power", "calisthenics"]);

/**
 * Template-only + metadata rules. Pure (no DB) so a proposed revision snapshot
 * can be vetted before it's persisted. `error` findings represent structural
 * invariants the resolver/schedule code depends on; `warning` findings are
 * judgment calls worth surfacing.
 */
export function lintTemplate(template: ProgramTemplate, meta: PlanMeta): LintFinding[] {
  const findings: LintFinding[] = [];
  const totalWeeks = template.totalWeeks;

  // Rule: a baseline checkpoint scheduled beyond the plan horizon, or a retest
  // at/before its initial collection week (it can't retest a not-yet-collected
  // initial). (error)
  for (const day of template.baselineWeek ?? []) {
    for (const test of day.tests ?? []) {
      const initialWeek = test.initialWeek ?? 1;
      if (initialWeek > totalWeeks) {
        findings.push({
          rule: "initial-week-out-of-range",
          severity: "error",
          message: `"${test.testName}" is first collected in week ${initialWeek}, past the plan's ${totalWeeks}-week horizon. It will never come due.`,
          context: { testName: test.testName, initialWeek, totalWeeks },
        });
      }
      for (const w of test.retestWeeks ?? []) {
        if (w > totalWeeks) {
          findings.push({
            rule: "retest-week-out-of-range",
            severity: "error",
            message: `"${test.testName}" has a retest scheduled in week ${w}, past the plan's ${totalWeeks}-week horizon. It will never come due.`,
            context: { testName: test.testName, retestWeek: w, totalWeeks },
          });
        }
        if (w <= initialWeek) {
          findings.push({
            rule: "retest-before-initial",
            severity: "error",
            message: `"${test.testName}" has a retest in week ${w} at or before its initial collection week (${initialWeek}) — there's no prior result to retest. Set initialWeek earlier or drop the retest.`,
            context: { testName: test.testName, retestWeek: w, initialWeek },
          });
        }
      }
    }
  }

  // Rule: phase week-arrays must tile 1..totalWeeks exactly once. (error)
  const seen = new Map<number, number>(); // week -> count
  for (const phase of template.phases ?? []) {
    for (const w of phase.weeks ?? []) {
      seen.set(w, (seen.get(w) ?? 0) + 1);
    }
  }
  const overlaps = [...seen.entries()].filter(([, c]) => c > 1).map(([w]) => w);
  const outOfRange = [...seen.keys()].filter((w) => w < 1 || w > totalWeeks).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let w = 1; w <= totalWeeks; w++) if (!seen.has(w)) gaps.push(w);
  if (overlaps.length > 0) {
    findings.push({
      rule: "phase-weeks-overlap",
      severity: "error",
      message: `Week(s) ${overlaps.sort((a, b) => a - b).join(", ")} are assigned to more than one phase.`,
      context: { overlaps },
    });
  }
  if (gaps.length > 0) {
    findings.push({
      rule: "phase-weeks-gap",
      severity: "error",
      message: `Week(s) ${gaps.join(", ")} aren't covered by any phase — they tile 1..${totalWeeks} with gaps.`,
      context: { gaps },
    });
  }
  if (outOfRange.length > 0) {
    findings.push({
      rule: "phase-weeks-out-of-range",
      severity: "error",
      message: `Phase week(s) ${outOfRange.join(", ")} fall outside 1..${totalWeeks}.`,
      context: { outOfRange },
    });
  }

  // Rule: metadata drift between the snapshot's totalWeeks and the persisted
  // Plan/Goal columns the calendar reads directly. (warning)
  const expectedEndsOn = startOfDay(addDays(meta.startedOn, totalWeeks * 7));
  if (meta.weeks !== totalWeeks) {
    findings.push({
      rule: "metadata-drift-weeks",
      severity: "warning",
      message: `Plan.weeks (${meta.weeks}) ≠ template.totalWeeks (${totalWeeks}). The week counter and plan range will be wrong until update_plan_metadata (or apply_plan_revision cascadeMetadata) syncs them.`,
      context: { planWeeks: meta.weeks, totalWeeks },
    });
  }
  if (startOfDay(meta.endsOn).getTime() !== expectedEndsOn.getTime()) {
    findings.push({
      rule: "metadata-drift-endsOn",
      severity: "warning",
      message: `Plan.endsOn (${startOfDay(meta.endsOn).toISOString().slice(0, 10)}) ≠ startedOn + ${totalWeeks}w (${expectedEndsOn.toISOString().slice(0, 10)}).`,
      context: { currentEndsOn: meta.endsOn, expectedEndsOn },
    });
  }

  // Rule: a baseline test sits on a heavy training day in the rotation. (warning)
  const categoryByDay = new Map<number, string>();
  for (const d of template.weeklySplit ?? []) categoryByDay.set(d.dayOfWeek, d.category);
  for (const bday of template.baselineWeek ?? []) {
    const cat = categoryByDay.get(bday.dayOfWeek);
    if (cat && HEAVY_CATEGORIES.has(cat) && (bday.tests?.length ?? 0) > 0) {
      findings.push({
        rule: "baseline-on-heavy-day",
        severity: "warning",
        message: `Baseline tests on rotation day ${bday.dayOfWeek} ("${bday.title}") collide with a "${cat}" training day. Max-testing and heavy work on the same day undercut both.`,
        context: { dayOfWeek: bday.dayOfWeek, category: cat, testCount: bday.tests?.length ?? 0 },
      });
    }
  }

  return findings;
}

/**
 * Full lint over the active plan: template rules + the persisted-data rules
 * that need DB access (unanchored retests, legacy phantom values, orphaned
 * overrides, duplicate planned hikes). Returns [] with a sentinel finding if no
 * active plan exists.
 */
export async function lintActivePlan(opts?: { now?: Date }): Promise<{
  planId: string | null;
  findings: LintFinding[];
}> {
  const now = opts?.now ?? new Date();
  const program = await getActiveProgram();
  if (!program) {
    return { planId: null, findings: [] };
  }

  const plan = await prisma.plan.findFirst({
    where: { active: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!plan) return { planId: null, findings: [] };

  const goal = await prisma.goal.findUnique({ where: { id: plan.goalId } });

  const template = program.template;
  const findings: LintFinding[] = [];

  // Template + metadata rules.
  findings.push(
    ...lintTemplate(template, {
      weeks: plan.weeks,
      endsOn: plan.endsOn,
      startedOn: plan.startedOn,
      goalTargetDate: goal?.targetDate ?? plan.endsOn,
    }),
  );

  // Rule: goal target date drift vs plan end. (warning)
  if (goal && startOfDay(goal.targetDate).getTime() !== startOfDay(plan.endsOn).getTime()) {
    findings.push({
      rule: "goal-date-vs-plan-end",
      severity: "warning",
      message: `Goal.targetDate (${startOfDay(goal.targetDate).toISOString().slice(0, 10)}) differs from Plan.endsOn (${startOfDay(plan.endsOn).toISOString().slice(0, 10)}). May be intentional (event ≠ plan end) — confirm.`,
      context: { goalTargetDate: goal.targetDate, planEndsOn: plan.endsOn },
    });
  }

  // Rule: unanchored retest — a retest with no completed initial to compare
  // against. Consumes getBaselineSchedule's computed `unanchored` flag. (error)
  const schedule = await getBaselineSchedule({ now });
  for (const s of schedule.scheduled) {
    for (const cp of s.checkpoints) {
      if (cp.unanchored) {
        findings.push({
          rule: "unanchored-retest",
          severity: "error",
          message: `"${s.testName}" has a week-${cp.week} retest but its initial was never collected — there's nothing to retest against. Collect an initial first, or drop the test from the template.`,
          context: { testName: s.testName, week: cp.week },
        });
      }
    }
  }

  // Rule: legacy baseline rows at value <= 0 (phantom completions). The Phase-2
  // write guard prevents new ones; this surfaces any already in the DB. (warning)
  const phantomBaselines = await prisma.baseline.findMany({
    where: { value: { lte: 0 } },
    orderBy: { date: "asc" },
  });
  for (const b of phantomBaselines) {
    findings.push({
      rule: "phantom-baseline-value",
      severity: "warning",
      message: `"${b.testName}" on ${startOfDay(b.date).toISOString().slice(0, 10)} is logged at value ${b.value} — a phantom completion. Update it with the real result or delete it.`,
      context: { baselineId: b.id, testName: b.testName, value: b.value },
    });
  }

  // Rule: day overrides on dates outside the plan range. Same daysDelta math as
  // resolveDay/getTodayContext. (warning)
  const overrides = await prisma.planDayOverride.findMany({ where: { planId: plan.id } });
  const startMid = startOfDay(plan.startedOn);
  const planSpanDays = template.totalWeeks * 7;
  for (const ov of overrides) {
    const daysDelta = Math.floor((startOfDay(ov.date).getTime() - startMid.getTime()) / 86400000);
    if (daysDelta < 0 || daysDelta >= planSpanDays) {
      findings.push({
        rule: "override-out-of-range",
        severity: "warning",
        message: `A day override exists for ${startOfDay(ov.date).toISOString().slice(0, 10)}, outside the plan's ${template.totalWeeks}-week range — it will never render.`,
        context: { overrideId: ov.id, date: ov.date, daysDelta },
      });
    }
  }

  // Rule: more than one planned hike on the same calendar day. The Phase-3 write
  // guard prevents new dups; this surfaces existing ones. (warning)
  const plannedHikes = await prisma.hike.findMany({
    where: { status: "planned" },
    orderBy: { date: "asc" },
  });
  const hikesByDay = new Map<string, typeof plannedHikes>();
  for (const h of plannedHikes) {
    const key = startOfDay(h.date).toISOString().slice(0, 10);
    const arr = hikesByDay.get(key) ?? [];
    arr.push(h);
    hikesByDay.set(key, arr);
  }
  for (const [day, rows] of hikesByDay) {
    if (rows.length > 1) {
      findings.push({
        rule: "duplicate-planned-hikes",
        severity: "warning",
        message: `${rows.length} planned hikes on ${day} (${rows.map((r) => r.route).join(", ")}). Keep one; delete the rest.`,
        context: { date: day, hikeIds: rows.map((r) => r.id) },
      });
    }
  }

  return { planId: plan.id, findings };
}
