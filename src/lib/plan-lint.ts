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

import { addDays, startOfDay, weekConflicts } from "@/lib/calendar";
import { prisma } from "@/lib/db";
import { getActiveProgram } from "@/lib/program";
import { getBaselineSchedule } from "@/lib/records";
import type { ProgramTemplate } from "@/lib/program-template";

// D-2: "info" added for multiple-hikes-one-week and similar advisory findings
// that are genuinely informational rather than actionable warnings.
export type LintSeverity = "error" | "warning" | "info";

export type LintFinding = {
  rule: string;
  severity: LintSeverity;
  message: string;
  context?: unknown;
  // Populated by lintActivePlan when a matching LintAcknowledgement is stored
  // on the plan. Suppressed findings are still returned but excluded from the
  // active counts in the lint_plan tool response.
  suppressed?: boolean;
  // Content fingerprint: rule + stable serialisation of context. Set by
  // lintActivePlan on every finding before acknowledgement matching. Exposed
  // to the coach via lint_plan so they can pass it to acknowledge_lint_finding.
  fingerprint?: string;
};

/**
 * A stored acknowledgement that a lint finding is intentional. Persisted as
 * JSON in Plan.lintAcknowledgements (Array<LintAcknowledgement>).
 *
 * Keyed by content fingerprint (not rule+contextKey) so the ack self-expires
 * when the finding's substance changes (e.g. dates shift, values update).
 */
export type LintAcknowledgement = {
  rule: string; // for human display / clearing by rule
  fingerprint: string; // content key — matches LintFinding.fingerprint
  note: string;
  at: string; // ISO timestamp
};

// ---------------------------------------------------------------------------
// Fingerprinting helpers (exported for tools.ts)
// ---------------------------------------------------------------------------

/**
 * Deterministic JSON serialiser with sorted object keys and Dates as
 * toISOString(). Stable across key-insertion order differences.
 */
function stableStringify(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sorted = Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
    return `{${sorted.join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Deterministic content fingerprint for a lint finding.
 * Returns `"${rule}#${stableStringify(context)}"`.
 * Acknowledgements keyed to this fingerprint self-expire when the finding's
 * substance changes (e.g. goal dates shift).
 */
export function fingerprintFinding(rule: string, context: unknown): string {
  return `${rule}#${stableStringify(context)}`;
}

export type PlanMeta = {
  weeks: number;
  endsOn: Date;
  startedOn: Date;
  goalTargetDate: Date;
};

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

  // (Baseline-on-heavy-day is intentionally NOT a finding: on a test day the
  // benchmark replaces the prescribed session — resolveDay sets
  // workoutDeferredForBaseline — so testing on an upper/lower/power rotation
  // day is correct, not a collision.)

  return findings;
}

/**
 * Full lint over the active plan: template rules + the persisted-data rules
 * that need DB access (unanchored retests, legacy phantom values, orphaned
 * overrides, duplicate planned hikes, hike scheduling checks). Returns [] with
 * a sentinel finding if no active plan exists.
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
  // Signed tests (e.g. "Toe Touch Reach" where negative = reached past the floor)
  // are legitimately ≤0 — skip them entirely.
  const signedTestNames = new Set(
    (template.baselineWeek ?? [])
      .flatMap((d) => d.tests ?? [])
      .filter((t) => t.signed)
      .map((t) => t.testName),
  );
  const phantomBaselines = await prisma.baseline.findMany({
    where: { value: { lte: 0 } },
    orderBy: { date: "asc" },
  });
  for (const b of phantomBaselines) {
    if (signedTestNames.has(b.testName)) continue;
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

  // -------------------------------------------------------------------------
  // Hike scheduling rules (REQ-006)
  // -------------------------------------------------------------------------

  // Rule: planned hike outside the plan window (before startedOn or past
  // totalWeeks*7). The resolver silently ignores it; this makes it visible.
  // Use the same daysDelta math as resolveDay. (warning)
  for (const h of plannedHikes) {
    const hikeDaysDelta = Math.floor(
      (startOfDay(h.date).getTime() - startMid.getTime()) / 86400000,
    );
    if (hikeDaysDelta < 0 || hikeDaysDelta >= planSpanDays) {
      findings.push({
        rule: "hike-outside-plan",
        severity: "warning",
        message: `Planned hike "${h.route}" on ${startOfDay(h.date).toISOString().slice(0, 10)} is outside the plan's ${template.totalWeeks}-week window — it won't appear in reconciliation or get_day.`,
        context: { hikeId: h.id, route: h.route, date: h.date, daysDelta: hikeDaysDelta },
      });
    }
  }

  // Rule: >1 planned hike in a single rotation week. May be intentional
  // (training camp week), but worth flagging so the coach can confirm. (info)
  // Group by rotation weekIndex using the same daysDelta math (rotation anchor =
  // program.startedOn, NOT calendar Monday).
  const hikesByWeek = new Map<number, typeof plannedHikes>();
  for (const h of plannedHikes) {
    const hikeDaysDelta = Math.floor(
      (startOfDay(h.date).getTime() - startMid.getTime()) / 86400000,
    );
    if (hikeDaysDelta < 0 || hikeDaysDelta >= planSpanDays) continue; // already flagged above
    const wi = Math.floor(hikeDaysDelta / 7) + 1;
    const arr = hikesByWeek.get(wi) ?? [];
    arr.push(h);
    hikesByWeek.set(wi, arr);
  }
  for (const [wi, rows] of hikesByWeek) {
    if (rows.length > 1) {
      findings.push({
        rule: "multiple-hikes-one-week",
        severity: "info",
        message: `${rows.length} planned hikes in rotation week ${wi} (${rows.map((r) => `${r.route} on ${startOfDay(r.date).toISOString().slice(0, 10)}`).join(", ")}). Confirm this is intentional (e.g. training camp).`,
        context: { weekIndex: wi, hikeIds: rows.map((r) => r.id) },
      });
    }
  }

  // Rule: planned hike the day after a heavy-leg rotation day (Day 2 = "lower"
  // or Day 5 = "lower-power"). Pre-fatigued legs increase injury risk on a hike.
  // Checks rotation day of hike.date - 1. (warning)
  for (const h of plannedHikes) {
    const hikeDaysDelta = Math.floor(
      (startOfDay(h.date).getTime() - startMid.getTime()) / 86400000,
    );
    if (hikeDaysDelta < 0 || hikeDaysDelta >= planSpanDays) continue;
    if (hikeDaysDelta === 0) continue; // no day before plan start
    const prevDaysDelta = hikeDaysDelta - 1;
    const prevRotationDay = (((prevDaysDelta % 7) + 7) % 7) + 1;
    const prevTmpl = template.weeklySplit.find((d) => d.dayOfWeek === prevRotationDay);
    if (prevTmpl?.category === "lower" || prevTmpl?.category === "lower-power") {
      findings.push({
        rule: "pre-hike-leg-load",
        severity: "warning",
        message: `Planned hike "${h.route}" on ${startOfDay(h.date).toISOString().slice(0, 10)} follows a ${prevTmpl.category} day (rotation Day ${prevRotationDay}). Pre-fatigued legs elevate injury risk — consider swapping or moving the hike.`,
        context: {
          hikeId: h.id,
          route: h.route,
          hikeDate: h.date,
          prevRotationDay,
          prevCategory: prevTmpl.category,
        },
      });
    }
  }

  // Rule: retest-on-hike-day — a baseline test is due on a date that also has a
  // planned hike. Testing at max effort and a long hike on one day is a real
  // conflict. This is a thin caller of weekConflicts (single source of truth).
  // Only queries weeks that have at least one planned hike to minimize overhead.
  // (warning)
  const weeksWithHikes = new Set(hikesByWeek.keys());
  for (const wi of weeksWithHikes) {
    const conflicts = await weekConflicts(program, wi);
    for (const c of conflicts) {
      if (c.kind === "retest-on-hike") {
        findings.push({
          rule: "retest-on-hike-day",
          severity: "warning",
          message: `A baseline retest is scheduled on ${c.dateKey}, which also has a planned hike. Max-effort testing and a long hike on the same day is a conflict — move the test or the hike.`,
          context: { dateKey: c.dateKey, weekIndex: wi, withDates: c.withDates },
        });
      }
    }
  }

  // Set content fingerprints on all findings before acknowledgement matching.
  for (const f of findings) {
    f.fingerprint = fingerprintFinding(f.rule, f.context);
  }

  // Apply lint acknowledgements: mark matching findings as suppressed.
  // Matching is keyed on content fingerprint so a stale ack auto-clears when
  // the finding's substance changes. Old acks lacking a fingerprint field simply
  // won't match anything (acceptable — coach re-acknowledges after merge).
  // plan.lintAcknowledgements is Json? — guard the shape before trusting it.
  const rawAcks = plan.lintAcknowledgements;
  const acks: LintAcknowledgement[] = Array.isArray(rawAcks)
    ? (rawAcks as LintAcknowledgement[])
    : [];
  for (const f of findings) {
    const matched = acks.some((ack) => ack.fingerprint === f.fingerprint);
    if (matched) f.suppressed = true;
  }

  return { planId: plan.id, findings };
}
