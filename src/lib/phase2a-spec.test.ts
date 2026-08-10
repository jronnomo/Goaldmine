// Unit tests for the Phase 2A import spec constants + builders
// (src/lib/phase2a-spec.ts) — the pure layer under scripts/import-phase2a.ts.
//
// Contract under test (design amendment 4):
//   • every goal's target array validates against GoalTargetSchema
//   • weights sum to 1.0 ±0.01 per goal
//   • the rotation template passes lintTemplate() CLEAN (no errors, no
//     warnings) against the plan metadata the import writes
//   • phases map to spec Blocks 0–3 and tile weeks 1..20 exactly
//   • the week table, A/B/C skill rotation, and S1–S3 baseline split
//     match the spec
//   • overrides land inside the plan window and honor the Mirror Lake
//     sacred-time language (never a deload)
//   • spec v2 delta (2026-08-10 04:23): Oct 2–5 TBD trip is NOTE-ONLY (no
//     workoutJson → never a calendar band), the Sep 15 cluster-decision item
//     + disruption-cluster standing rule exist, and NO scheduled item or
//     baseline retest week touches the Oct 2–8 exclusion
//   • spec v4 delta (handstand repeatability merge) + the ROLLING FLIP:
//     Goal 1 carries the 9-row table verbatim (gates exactly
//     {rolling:hs_triple20_of6, Wall HSPU}; the three rolling:hs_* rows are
//     ENGINE-NATIVE trackers whose RollingParams are pinned verbatim and
//     validate through GoalTargetSchema — the cumulative flag is irrelevant
//     on them), the baseline battery is the S1/S2/S3 split (days 1/3/4,
//     every test exactly once, retests keep the split), the chest-to-wall
//     protocol carries the binding hand-distance/line/brush language, and
//     the reconcile helpers (stableJson compare — including the nested
//     rolling params, snapshot builder, milestone + duplicate-goal
//     constants) behave idempotently
//
// lintTemplate is imported from plan-lint (pure entry — no DB access in the
// template rules); vitest.config supplies a placeholder DATABASE_URL so the
// transitive @/lib/db import initializes without a live database.

import { describe, expect, it } from "vitest";
import { GoalTargetSchema } from "@/lib/metrics-registry";
import { LegendSchema } from "@/lib/legend";
import { AttributionRuleAuthoringSchema } from "@/lib/attribution-rules";
import { lintTemplate } from "@/lib/plan-lint";
import { addDays, dateKey, parseDateKey } from "@/lib/calendar-core";
import {
  classifyOverrideWindowKind,
  deriveCalendarWindows,
} from "@/lib/calendar-windows";
import {
  appendDuplicateGoalNote,
  baselineWeekNeedsReconcile,
  buildBaselineWeekRevisionSnapshot,
  buildG4AttributionRule,
  buildPhase2aOverrides,
  buildPhase2aRotationTemplate,
  PHASE2A_BASELINE_SPLIT_REASONING,
  PHASE2A_BASELINE_SPLIT_SUMMARY,
  PHASE2A_BASELINE_WEEK,
  PHASE2A_CLUSTER_RULE,
  PHASE2A_DUPLICATE_GOAL,
  PHASE2A_GOAL1,
  PHASE2A_GOAL1_ID,
  PHASE2A_GOAL2,
  PHASE2A_GOAL3,
  PHASE2A_MILESTONE_BASELINE,
  PHASE2A_NUTRITION_RULE,
  PHASE2A_PLAN,
  PHASE2A_PROGRAM,
  PHASE2A_RETEST_CONSISTENCY_RULE,
  PHASE2A_SAVED_MEALS,
  PHASE2A_SCHEDULED_ITEMS,
  PHASE2A_WEIGHIN_RULE,
  stableJson,
  standingRuleKey,
} from "@/lib/phase2a-spec";

/** Spec v2 exclusion window: the Oct 2–5 trip + the 3 days after it. No
 *  baseline retest, DEXA, or practice exam may land inside it. dateKey
 *  strings compare lexicographically == chronologically. */
const EXCLUSION_START = "2026-10-02";
const EXCLUSION_END = "2026-10-08";

const GOALS = [
  { name: "Goal 1 (Handstand)", targets: PHASE2A_GOAL1.targets },
  { name: "Goal 2 (Body comp)", targets: PHASE2A_GOAL2.targets },
  { name: "Goal 3 (AWS SAA)", targets: PHASE2A_GOAL3.targets },
] as const;

describe("phase2a-spec · goal targets", () => {
  it.each(GOALS)("$name targets validate against GoalTargetSchema", ({ targets }) => {
    for (const t of targets) {
      const parsed = GoalTargetSchema.safeParse(t);
      expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
    }
  });

  it.each(GOALS)("$name weights sum to 1.0 ±0.01", ({ targets }) => {
    const sum = targets.reduce((acc, t) => acc + t.weight, 0);
    expect(Math.abs(sum - 1)).toBeLessThanOrEqual(0.01);
  });

  it("Goal 1 carries the spec v4 9-row table VERBATIM (metric/label/start/target/units/dir/weight/gating + rolling params), in spec order", () => {
    // The spec table (lines 63–73) post-rolling-flip, row for row. rationale
    // is free doc text and deliberately not pinned; everything the readiness
    // engine reads is — INCLUDING the RollingParams the resolver computes
    // from (toEqual treats `rolling: undefined` on non-rolling rows as
    // absent, so the same projection pins all nine).
    expect(
      PHASE2A_GOAL1.targets.map((t) => ({
        metric: t.metric,
        label: t.label,
        start: t.start,
        target: t.target,
        units: t.units,
        direction: t.direction,
        weight: t.weight,
        gating: t.gating === true,
        rolling: t.rolling,
      })),
    ).toEqual([
      { metric: "baseline:Freestanding Handstand Hold", label: "Max freestanding hold", start: 10, target: 20, units: "sec", direction: "increase", weight: 0.12, gating: false },
      { metric: "rolling:hs_sessions_10s_of6", label: "≥10s hold — sessions hit, last 6", start: 0, target: 4, units: "of 6", direction: "increase", weight: 0.08, gating: false, rolling: { exercise: "Freestanding Handstand Hold", minSeconds: 10, hitsPerSession: 1, window: 6 } },
      { metric: "rolling:hs_sessions_20s_of6", label: "≥20s hold — sessions hit, last 6", start: 0, target: 4, units: "of 6", direction: "increase", weight: 0.15, gating: false, rolling: { exercise: "Freestanding Handstand Hold", minSeconds: 20, hitsPerSession: 1, window: 6 } },
      { metric: "rolling:hs_triple20_of6", label: "3× ≥20s in one session — sessions hit, last 6", start: 0, target: 1, units: "of 6", direction: "increase", weight: 0.2, gating: true, rolling: { exercise: "Freestanding Handstand Hold", minSeconds: 20, hitsPerSession: 3, attemptCap: 5, window: 6 } },
      { metric: "baseline:Wall Handstand Push-Up", label: "Wall handstand push-up (full ROM)", start: 0, target: 5, units: "reps", direction: "increase", weight: 0.2, gating: true },
      { metric: "baseline:Chest-to-Wall Handstand Hold", label: "Chest-to-wall handstand hold", start: 30, target: 120, units: "sec", direction: "increase", weight: 0.08, gating: false },
      { metric: "baseline:Pull-Up Max Reps", label: "Pull-up max (lean-mass canary)", start: 25, target: 25, units: "reps", direction: "increase", weight: 0.07, gating: false },
      { metric: "baseline:Floating Pike Push-Up", label: "Floating pike push-up", start: 5, target: 10, units: "reps", direction: "increase", weight: 0.05, gating: false },
      { metric: "baseline:L-Sit (Parallettes)", label: "L-sit hold (parallettes)", start: 30, target: 60, units: "sec", direction: "increase", weight: 0.05, gating: false },
    ]);
  });

  it("Goal 1 gates are EXACTLY {rolling:hs_triple20_of6, baseline:Wall Handstand Push-Up} and weights sum to 1.00", () => {
    const gates = PHASE2A_GOAL1.targets.filter((t) => t.gating);
    expect(gates.map((t) => t.metric).sort()).toEqual([
      "baseline:Wall Handstand Push-Up",
      "rolling:hs_triple20_of6",
    ]);
    // The gate came off the max in the v4 merge — triple20 subsumes it.
    expect(
      PHASE2A_GOAL1.targets.find((t) => t.metric === "baseline:Freestanding Handstand Hold")!.gating,
    ).not.toBe(true);
    const sum = PHASE2A_GOAL1.targets.reduce((acc, t) => acc + t.weight, 0);
    expect(sum).toBeCloseTo(1.0, 9);
  });

  it("Goal 1's three rolling:hs_* rows are ENGINE-NATIVE trackers — params verbatim, validating through GoalTargetSchema (regression is window-inherent; cumulative is irrelevant)", () => {
    const rollingMetrics = ["rolling:hs_sessions_10s_of6", "rolling:hs_sessions_20s_of6", "rolling:hs_triple20_of6"];
    const expectedParams: Record<string, unknown> = {
      "rolling:hs_sessions_10s_of6": { exercise: "Freestanding Handstand Hold", minSeconds: 10, hitsPerSession: 1, window: 6 },
      "rolling:hs_sessions_20s_of6": { exercise: "Freestanding Handstand Hold", minSeconds: 20, hitsPerSession: 1, window: 6 },
      "rolling:hs_triple20_of6": { exercise: "Freestanding Handstand Hold", minSeconds: 20, hitsPerSession: 3, attemptCap: 5, window: 6 },
    };
    for (const metric of rollingMetrics) {
      const t = PHASE2A_GOAL1.targets.find((x) => x.metric === metric)!;
      expect(t, metric).toBeDefined();
      // The params ARE the semantics (the slug is opaque) — pin them verbatim.
      expect(t.rolling, metric).toEqual(expectedParams[metric]);
      // GoalTargetSchema's cross-field refinement: rolling params + the
      // rolling: prefix travel together — these rows must parse clean.
      const parsed = GoalTargetSchema.safeParse(t);
      expect(parsed.success, `${metric}: ${JSON.stringify(parsed.success ? null : parsed.error.issues)}`).toBe(true);
      // Regression is ENGINE-INHERENT now (window roll-out) — the cumulative
      // flag is irrelevant to the rolling resolver and stays off the rows.
      expect(t.cumulative, metric).toBeUndefined();
    }
    // Exactly these three rolling:* metrics on Goal 1 — and the flip left no
    // log:* strays behind (the old coach-computed keys are fully retired).
    expect(PHASE2A_GOAL1.targets.filter((t) => t.metric.startsWith("rolling:")).map((t) => t.metric)).toEqual(rollingMetrics);
    expect(PHASE2A_GOAL1.targets.some((t) => t.metric.startsWith("log:"))).toBe(false);
  });

  it("Goal 1 start values carry the spec's corrections (max starts at 10 from the video-verified hold, NOT 0)", () => {
    const max = PHASE2A_GOAL1.targets.find((t) => t.metric === "baseline:Freestanding Handstand Hold")!;
    expect(max.start).toBe(10); // 0 would assert he can't hold a freestanding handstand at all — false
    expect(max.rationale).toContain("never auto-overwritten"); // fatigued-S1 warning is binding
    const ctw = PHASE2A_GOAL1.targets.find((t) => t.metric === "baseline:Chest-to-Wall Handstand Hold")!;
    expect(ctw.target).toBe(120); // raised 60 → 120 (2026-08-09)
  });

  it("Goal 2 omits bodyFatPct start (auto-captured at DEXA #1) and carries the canary", () => {
    const bf = PHASE2A_GOAL2.targets.find((t) => t.metric === "bodyFatPct")!;
    expect(bf.start).toBeUndefined();
    expect(bf).toMatchObject({ target: 10, weight: 0.45, direction: "decrease" });
    expect(PHASE2A_GOAL2.targets.find((t) => t.metric === "weightLb")).toMatchObject({ start: 155, target: 143, weight: 0.4 });
    const canary = PHASE2A_GOAL2.targets.find((t) => t.metric === "baseline:Pull-Up Max Reps")!;
    expect(canary).toMatchObject({ start: 25, target: 25, weight: 0.15, direction: "increase" });
    expect(PHASE2A_GOAL2.targets.some((t) => t.gating)).toBe(false);
  });

  it("Goal 3 is cumulative-hours + snapshots with the practice-exam gate", () => {
    const hours = PHASE2A_GOAL3.targets.find((t) => t.metric === "log:study_hours")!;
    expect(hours.cumulative).toBe(true);
    expect(hours).toMatchObject({ start: 0, target: 120, weight: 0.45 });
    const sections = PHASE2A_GOAL3.targets.find((t) => t.metric === "log:sections_done")!;
    expect(sections.cumulative ?? false).toBe(false); // snapshot
    expect(sections).toMatchObject({ start: 0, target: 23, weight: 0.3 });
    const exam = PHASE2A_GOAL3.targets.find((t) => t.metric === "log:practice_exam_score")!;
    expect(exam.cumulative ?? false).toBe(false); // snapshot
    expect(exam).toMatchObject({ start: 0, target: 80, weight: 0.25, gating: true });
    expect(PHASE2A_GOAL3.targetDateKey).toBeNull(); // readiness-gated, no date
  });
});

describe("phase2a-spec · legends + attribution", () => {
  it("all legends validate against LegendSchema", () => {
    for (const legend of [PHASE2A_GOAL1.legend, PHASE2A_GOAL2.legend, PHASE2A_GOAL3.legend]) {
      expect(LegendSchema.safeParse(legend).success).toBe(true);
    }
  });

  it("the G4 rule validates against the authoring schema, goalIds ordered cut/aws/handstand", () => {
    const rule = buildG4AttributionRule({ cut: "g-cut", aws: "g-aws", handstand: "g-hs" });
    expect(AttributionRuleAuthoringSchema.safeParse(rule).success).toBe(true);
    expect(rule.goalIds).toEqual(["g-cut", "g-aws", "g-hs"]);
    expect(rule.match.titleContains).toEqual(["incline walk", "treadmill walk", "fasted walk"]);
    expect(rule.note).toBe("AM incline walk: Z2 base + deficit + AWS lectures");
  });

  it("Goal 1 attributionHints are already canonical (no alias-map hits) and include the skill-work names", () => {
    expect(PHASE2A_GOAL1.attributionHints).toHaveLength(17);
    expect(PHASE2A_GOAL1.attributionHints).toContain("Freestanding Handstand Hold");
    expect(PHASE2A_GOAL1.attributionHints).toContain("Wrist Prep");
    // Uniqueness — a duplicated hint would double-match in the link engine.
    expect(new Set(PHASE2A_GOAL1.attributionHints).size).toBe(17);
  });
});

describe("phase2a-spec · rotation template", () => {
  const template = buildPhase2aRotationTemplate();

  it("passes lintTemplate CLEAN against the import's plan metadata", () => {
    const findings = lintTemplate(template, {
      weeks: PHASE2A_PLAN.weeks,
      startedOn: parseDateKey(PHASE2A_PLAN.startedOnKey),
      endsOn: parseDateKey(PHASE2A_PLAN.endsOnKey),
      goalTargetDate: parseDateKey(PHASE2A_GOAL1.targetDateKey),
    });
    expect(findings).toEqual([]);
  });

  it("plan endsOn is startedOn + weeks*7 (the lint metadata contract)", () => {
    const expected = addDays(parseDateKey(PHASE2A_PLAN.startedOnKey), PHASE2A_PLAN.weeks * 7);
    expect(parseDateKey(PHASE2A_PLAN.endsOnKey).getTime()).toBe(expected.getTime());
  });

  it("phases map to Blocks 0–3 and tile weeks 1..20 exactly once", () => {
    expect(template.totalWeeks).toBe(20);
    expect(template.phases).toHaveLength(4);
    expect(template.phases.map((p) => p.weeks)).toEqual([
      [1, 2], // Block 0 · Aug 10–23
      [3, 4, 5, 6, 7, 8, 9, 10], // Block 1 · Aug 24–Oct 18
      [11, 12, 13, 14, 15, 16, 17], // Block 2 · Oct 19–Dec 6
      [18, 19, 20], // Block 3 · Dec 7–27
    ]);
    expect(template.phases.map((p) => p.name.slice(0, 7))).toEqual([
      "Block 0",
      "Block 1",
      "Block 2",
      "Block 3",
    ]);
  });

  it("has 7 DayTemplates covering rotation days 1..7 with the spec's week shape", () => {
    expect(template.weeklySplit).toHaveLength(7);
    expect([...template.weeklySplit.map((d) => d.dayOfWeek)].sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const byDay = Object.fromEntries(template.weeklySplit.map((d) => [d.dayOfWeek, d]));
    expect(byDay[1]!.category).toBe("upper"); // Mon — pressing anchor
    expect(byDay[2]!.category).toBe("lower"); // Tue — lower + GTG
    expect(byDay[3]!.category).toBe("zone2-mobility"); // Wed — mobility + skill
    expect(byDay[4]!.category).toBe("upper"); // Thu — HSPU builder
    expect(byDay[5]!.category).toBe("lower-power"); // Fri — lower + explosive + GTG
    expect(byDay[6]!.category).toBe("long-endurance"); // Sat — hike / steps
    expect(byDay[7]!.category).toBe("rest"); // Sun — active recovery
  });

  it("no incline walk before lower days; AM walk block on Mon/Wed/Thu", () => {
    const byDay = Object.fromEntries(template.weeklySplit.map((d) => [d.dayOfWeek, d]));
    const hasWalk = (day: (typeof template.weeklySplit)[number]) =>
      day.blocks.some((b) => b.exercises.some((e) => e.name === "Incline Treadmill Walk"));
    expect(hasWalk(byDay[1]!)).toBe(true);
    expect(hasWalk(byDay[3]!)).toBe(true);
    expect(hasWalk(byDay[4]!)).toBe(true);
    expect(hasWalk(byDay[2]!)).toBe(false); // lower day — lift fresh
    expect(hasWalk(byDay[5]!)).toBe(false); // lower day — lift fresh
  });

  it("daily PM skill block runs the A/B/C rotation (Mon A · Tue B · Wed C · Thu A · Fri B · Sun C; Sat none), every session opening with Wrist Prep", () => {
    const byDay = Object.fromEntries(template.weeklySplit.map((d) => [d.dayOfWeek, d]));
    const skillOf = (day: (typeof template.weeklySplit)[number]) =>
      day.blocks.find((b) => b.label?.startsWith("PM Skill — Session"));
    expect(skillOf(byDay[1]!)?.label).toContain("Session A");
    expect(skillOf(byDay[2]!)?.label).toContain("Session B");
    expect(skillOf(byDay[3]!)?.label).toContain("Session C");
    expect(skillOf(byDay[4]!)?.label).toContain("Session A");
    expect(skillOf(byDay[5]!)?.label).toContain("Session B");
    expect(skillOf(byDay[6]!)).toBeUndefined(); // Sat: long effort, no skill
    expect(skillOf(byDay[7]!)?.label).toContain("Session C");
    for (const d of [1, 2, 3, 4, 5, 7] as const) {
      const block = skillOf(byDay[d]!)!;
      expect(block.exercises[0]!.name).toBe("Wrist Prep");
      expect(block.label).toContain("never to failure");
    }
  });

  it("pull-up GTG on lower days, pull-ups to failure on upper days", () => {
    const byDay = Object.fromEntries(template.weeklySplit.map((d) => [d.dayOfWeek, d]));
    const labels = (day: (typeof template.weeklySplit)[number]) => day.blocks.map((b) => b.label ?? "");
    expect(labels(byDay[2]!).some((l) => l.includes("GTG"))).toBe(true);
    expect(labels(byDay[5]!).some((l) => l.includes("GTG"))).toBe(true);
    expect(labels(byDay[1]!).some((l) => l.includes("failure"))).toBe(true);
    expect(labels(byDay[4]!).some((l) => l.includes("failure"))).toBe(true);
  });

  it("baselineWeek is the v4 three-session split: S1 day 1 · S2 day 3 · S3 day 4, with the spec's test pairs", () => {
    expect(template.baselineWeek).toBe(PHASE2A_BASELINE_WEEK); // builder wires the constant through
    expect(template.baselineWeek).toHaveLength(3);
    expect(
      template.baselineWeek.map((d) => ({ dayOfWeek: d.dayOfWeek, tests: d.tests.map((t) => t.testName) })),
    ).toEqual([
      // S1 · Mon Aug 10 (day 1) — Balance, fully fresh
      { dayOfWeek: 1, tests: ["Freestanding Handstand Hold", "L-Sit (Parallettes)"] },
      // S2 · Wed Aug 12 (day 3) — Vertical press: gate first, cheapest absorbs the fatigue
      { dayOfWeek: 3, tests: ["Wall Handstand Push-Up", "Floating Pike Push-Up"] },
      // S3 · Thu Aug 13 (day 4) — Support isometric + admin
      { dayOfWeek: 4, tests: ["Chest-to-Wall Handstand Hold", "Pull-Up Max Reps"] },
    ]);
    // Session identity + the spec's session-level rules live in the titles.
    expect(template.baselineWeek[0]!.title).toContain("S1");
    expect(template.baselineWeek[0]!.title).toContain("fully fresh");
    expect(template.baselineWeek[1]!.title).toContain("S2");
    expect(template.baselineWeek[1]!.title).toContain("gate first");
    expect(template.baselineWeek[1]!.title).toContain("cheapest target absorbs the fatigue");
    expect(template.baselineWeek[2]!.title).toContain("S3");
    expect(template.baselineWeek[2]!.title).toContain("its own slot");
  });

  it("every test name appears exactly once across the split, and every test keeps retests {10, 19} + initialWeek 1 (the retest weeks inherit the same S-split structure)", () => {
    const allTests = template.baselineWeek.flatMap((d) => d.tests);
    const names = allTests.map((t) => t.testName);
    expect(names).toHaveLength(6);
    expect(new Set(names).size).toBe(6); // exactly once each — no test duplicated across sessions
    for (const t of allTests) {
      expect(t.retestWeeks, t.testName).toEqual([10, 19]); // Block-1 end + pre-Christmas rung-2 window
      expect(t.initialWeek ?? 1, t.testName).toBe(1);
    }
    // Retests derive placement from the SAME BaselineDay dayOfWeek (rotation-
    // core matches baselineWeek.find(d => d.dayOfWeek === rotationDay) in any
    // due week), so weeks 10 & 19 land the same tests on days 1/3/4 — the
    // per-day shape above IS the retest shape.
  });

  it("S1/S2 protocols carry the binding session rules (attempt caps, record-every-attempt, ordering, press indicator, pull-up re-log)", () => {
    const byName = Object.fromEntries(template.baselineWeek.flatMap((d) => d.tests).map((t) => [t.testName, t]));
    const freestanding = byName["Freestanding Handstand Hold"]!;
    expect(freestanding.protocol).toContain("3–4 attempts");
    expect(freestanding.protocol).toContain("2–3 min FULL rest");
    expect(freestanding.protocol).toContain("stop at 4");
    expect(freestanding.protocol).toContain("Record EVERY attempt");
    const hspu = byName["Wall Handstand Push-Up"]!;
    expect(hspu.protocol).toContain("FIRST in S2");
    expect(hspu.protocol).toContain("FULL-ROM");
    expect(hspu.protocol).toContain("note if assisted");
    const pike = byName["Floating Pike Push-Up"]!;
    expect(pike.protocol).toContain("after 5+ min rest");
    // The press is a tracked indicator NOTE inside S2 — not a scheduled test row.
    expect(pike.protocol).toContain("Floating Pike Push-Up Press");
    expect(pike.protocol).toContain("tracked indicator");
    expect(pike.protocol).toContain("NOT a scored target");
    const pullup = byName["Pull-Up Max Reps"]!;
    expect(pullup.protocol).toContain("DO NOT TEST");
    expect(pullup.protocol).toContain("re-log at the true max 25");
  });

  it("chest-to-wall protocol preserves every binding rule: hand distance, position standard, toe brush, line breaks, back-to-wall exclusion", () => {
    const ctw = template.baselineWeek
      .flatMap((d) => d.tests)
      .find((t) => t.testName === "Chest-to-Wall Handstand Hold")!;
    expect(ctw.protocol).toContain("hand distance"); // measure + record, identical at every retest
    expect(ctw.protocol).toContain("IDENTICAL distance at every retest");
    expect(ctw.protocol).toContain("ribs down, glutes engaged"); // position standard
    expect(ctw.protocol).toContain("not a banana");
    expect(ctw.protocol).toContain("brush"); // toe contact is a brush, not a lean
    expect(ctw.protocol).toContain("line breaks"); // hold ends when the line breaks, not at wall-fall
    expect(ctw.protocol).toContain("Back-to-wall");
    expect(ctw.protocol).toContain("does not substitute");
  });

  it("every test's protocol carries the retest protocol-consistency rule (identical order / same rests / time of day)", () => {
    expect(PHASE2A_RETEST_CONSISTENCY_RULE).toContain("IDENTICAL order");
    expect(PHASE2A_RETEST_CONSISTENCY_RULE).toContain("rest intervals actually taken");
    expect(PHASE2A_RETEST_CONSISTENCY_RULE).toContain("time of day");
    expect(PHASE2A_RETEST_CONSISTENCY_RULE).toContain("phantom progress or phantom regression");
    for (const t of template.baselineWeek.flatMap((d) => d.tests)) {
      expect(t.protocol, t.testName).toContain(PHASE2A_RETEST_CONSISTENCY_RULE);
    }
  });

  it("every baseline:* target metric on Goals 1–2 has a scheduled test somewhere in the S1–S3 split", () => {
    const scheduled = new Set(template.baselineWeek.flatMap((d) => d.tests).map((t) => t.testName));
    const baselineMetrics = [...PHASE2A_GOAL1.targets, ...PHASE2A_GOAL2.targets]
      .map((t) => t.metric)
      .filter((m) => m.startsWith("baseline:"))
      .map((m) => m.slice("baseline:".length));
    for (const name of baselineMetrics) {
      expect(scheduled.has(name), `missing scheduled test for baseline:${name}`).toBe(true);
    }
  });
});

describe("phase2a-spec · overrides", () => {
  const overrides = buildPhase2aOverrides();
  const startedOn = parseDateKey(PHASE2A_PLAN.startedOnKey);

  it("covers Mirror Lake (2) + Virginia soft break (4) + deload #1 (3) + Oct TBD trip (4) + deload #2 (4) = 17 dates, all unique", () => {
    expect(overrides).toHaveLength(17); // v2 delta: 13 → 17
    expect(new Set(overrides.map((o) => o.dateKey)).size).toBe(17);
  });

  it("every override date lands inside the 20-week plan window", () => {
    for (const ov of overrides) {
      const daysDelta = Math.round(
        (parseDateKey(ov.dateKey).getTime() - startedOn.getTime()) / 86400000,
      );
      expect(daysDelta, ov.dateKey).toBeGreaterThanOrEqual(0);
      expect(daysDelta, ov.dateKey).toBeLessThan(PHASE2A_PLAN.weeks * 7);
    }
  });

  it("Mirror Lake Aug 14–15 is SACRED TIME: rest-day swap titled for Matt, empty blocks, spec language, and NEVER labeled a deload", () => {
    const mirror = overrides.filter((o) => ["2026-08-14", "2026-08-15"].includes(o.dateKey));
    expect(mirror).toHaveLength(2);
    for (const ov of mirror) {
      expect(ov.workoutJson).toBeDefined();
      expect(ov.workoutJson!.title).toBe("Mirror Lake — Matt");
      expect(ov.workoutJson!.category).toBe("rest");
      expect(ov.workoutJson!.blocks).toEqual([]); // no training expectation, not even optional movement
      for (const text of [ov.workoutJson!.summary, ov.notes]) {
        expect(text).toContain("SACRED TIME");
        expect(text).toContain("not a deload");
        expect(text).toContain("No training expectation");
        expect(text).toContain("no makeup");
      }
      expect(ov.workoutJson!.title.toLowerCase()).not.toContain("deload");
    }
    // Aug 14 2026 is a Friday (rotation day 5), Aug 15 a Saturday (day 6).
    expect(mirror[0]!.workoutJson!.dayOfWeek).toBe(5);
    expect(mirror[1]!.workoutJson!.dayOfWeek).toBe(6);
  });

  it("Sep 4–7 Virginia is a note-only soft break (no workout swap, protein floor stands)", () => {
    const va = overrides.filter((o) => o.dateKey.startsWith("2026-09-0"));
    expect(va.map((o) => o.dateKey)).toEqual(["2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07"]);
    for (const ov of va) {
      expect(ov.workoutJson).toBeUndefined();
      expect(ov.nutritionText).toContain("protein floor 150–155 g stands");
      expect(ov.mobilityText).toContain("skill only if a wall's available");
      expect(ov.notes).toContain("soft break");
    }
  });

  it("Nov 26–29 deload #2 carries the maintenance-not-deficit note", () => {
    const thx = overrides.filter((o) => o.dateKey.startsWith("2026-11-"));
    expect(thx.map((o) => o.dateKey)).toEqual(["2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]);
    for (const ov of thx) {
      expect(ov.workoutJson?.category).toBe("zone2-mobility"); // light/mobility day
      expect(`${ov.nutritionText} ${ov.notes}`).toContain("MAINTENANCE");
      expect(`${ov.nutritionText} ${ov.notes}`).toContain("not deficit");
    }
  });

  it("Sep 25–27 is deload #1 (light/mobility swap)", () => {
    const d1 = overrides.filter((o) => ["2026-09-25", "2026-09-26", "2026-09-27"].includes(o.dateKey));
    expect(d1).toHaveLength(3);
    for (const ov of d1) {
      expect(ov.workoutJson?.category).toBe("zone2-mobility");
      expect(ov.label).toContain("Deload #1");
    }
  });

  it("v2: Oct 2–5 TBD trip is NOTE-ONLY (the Sep 4–7 mechanism) with maintenance nutrition + the no-retest/DEXA/practice-exam ±3d constraint", () => {
    const oct = overrides.filter((o) => o.dateKey.startsWith("2026-10-0"));
    expect(oct.map((o) => o.dateKey)).toEqual(["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"]);
    for (const ov of oct) {
      expect(ov.workoutJson, `${ov.dateKey} must not carry a day-swap`).toBeUndefined();
      // Nutrition through the cluster: maintenance on travel days, deficit between.
      expect(ov.nutritionText).toContain("MAINTENANCE");
      expect(ov.nutritionText).toContain("BOTH windows");
      expect(ov.nutritionText).toContain("deficit on the normal days between");
      // Uncertain-window language + the scheduling exclusion, verbatim intent.
      expect(ov.notes).toContain("UNCERTAIN TRAINING WINDOW");
      expect(ov.notes).toContain("Nothing scored");
      expect(ov.notes).toContain("no makeup");
      expect(ov.notes).toContain("no readiness penalty");
      expect(ov.notes).toContain("baseline retest, DEXA, or practice exam");
      expect(ov.notes).toContain("3 days after");
      expect(ov.mobilityText).toContain("Skill only if space/wall allows");
    }
  });

  it("v2: Oct 2–5 renders as plain note-only days, never calendar bands (calendar-windows classifier contract)", () => {
    const oct = overrides.filter((o) => o.dateKey >= "2026-10-02" && o.dateKey <= "2026-10-05");
    expect(oct).toHaveLength(4);
    for (const ov of oct) {
      // Title/notes prefix must not collide with the window classifier.
      for (const text of [ov.label, ov.notes]) {
        expect(text.startsWith("Deload"), text).toBe(false);
        expect(text.startsWith("Mirror Lake"), text).toBe(false);
        expect(classifyOverrideWindowKind(text)).toBeNull();
      }
    }
    // Feed the derivation exactly the way calendar.ts does: day-swap
    // overrides only (workoutJson != null), title = workoutJson.title.
    // Note-only overrides never reach the classifier — they cannot band.
    const windows = deriveCalendarWindows(
      overrides
        .filter((o) => o.workoutJson != null)
        .map((o) => ({ dateKey: o.dateKey, title: o.workoutJson!.title })),
    );
    expect(windows.map((w) => `${w.kind}:${w.startKey}..${w.endKey}`)).toEqual([
      "observance:2026-08-14..2026-08-15",
      "deload:2026-09-25..2026-09-27",
      "deload:2026-11-26..2026-11-29",
    ]);
    // No band anywhere near the exclusion window.
    for (const w of windows) {
      expect(w.endKey < EXCLUSION_START || w.startKey > EXCLUSION_END, w.id).toBe(true);
    }
  });
});

describe("phase2a-spec · scheduled items, meals, standing rules", () => {
  it("scheduled items carry unique phase2a:* externalRefs and the spec's checkpoint dates", () => {
    expect(PHASE2A_SCHEDULED_ITEMS).toHaveLength(10); // v2 delta 9 → 10: 3 DEXA + 2 practice exams + 1 cluster decision + 4 photo months
    expect(new Set(PHASE2A_SCHEDULED_ITEMS.map((i) => i.externalRef)).size).toBe(10);
    for (const i of PHASE2A_SCHEDULED_ITEMS) {
      expect(i.externalRef.startsWith("phase2a:")).toBe(true);
      expect(i.dateKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    const byRef = Object.fromEntries(PHASE2A_SCHEDULED_ITEMS.map((i) => [i.externalRef, i]));
    expect(byRef["phase2a:dexa-1"]).toMatchObject({ dateKey: "2026-09-03", goalKey: "bodycomp" });
    expect(byRef["phase2a:dexa-2"]).toMatchObject({ dateKey: "2026-10-18", goalKey: "bodycomp" });
    expect(byRef["phase2a:dexa-3"]).toMatchObject({ dateKey: "2026-12-28", goalKey: "bodycomp" });
    expect(byRef["phase2a:practice-exam-1"]).toMatchObject({ dateKey: "2026-10-18", goalKey: "aws" });
    expect(byRef["phase2a:practice-exam-2"]).toMatchObject({ dateKey: "2026-12-06", goalKey: "aws" });
    // Monthly photos: 1st of Sep–Dec.
    const photoDates = PHASE2A_SCHEDULED_ITEMS.filter((i) => i.externalRef.startsWith("phase2a:photos-")).map((i) => i.dateKey);
    expect(photoDates).toEqual(["2026-09-01", "2026-10-01", "2026-11-01", "2026-12-01"]);
  });

  it("v2: the cluster-decision task sits on Goal 1 (rotation owner) at mid-September and summarizes options a/b/c", () => {
    const item = PHASE2A_SCHEDULED_ITEMS.find((i) => i.externalRef === "phase2a:cluster-decision")!;
    expect(item).toMatchObject({
      goalKey: "handstand",
      dateKey: "2026-09-15",
      type: "task",
      title: "Decide Sep 24–Oct 5 cluster strategy",
    });
    expect(item.detail).toContain("(a) Absorb");
    expect(item.detail).toContain("(b) Shift Deload #1 to Oct 2–5");
    expect(item.detail).toContain("(c) Front-load Block 1");
  });

  it("saved meals match the spec macros exactly", () => {
    const brookie = PHASE2A_SAVED_MEALS.find((m) => m.name === "Protein Brookie")!;
    expect(brookie.macros).toEqual({ calories: 310, fatG: 6.5, proteinG: 31, carbsG: 42.5 });
    const bowl = PHASE2A_SAVED_MEALS.find((m) => m.name === "Chipotle Protein Bowl")!;
    expect(bowl.macros).toEqual({ calories: 670, fatG: 20, proteinG: 71, carbsG: 60 });
    expect(bowl.items[0]!.notes).toContain("fraction");
  });

  it("standing rules are keyed by a stable first line and carry the descent invariants", () => {
    expect(standingRuleKey(PHASE2A_WEIGHIN_RULE)).toBe(
      "Phase 2A weigh-in cadence: weekly weigh-in + waist tape (navel, fasted) every Sun or Mon, with a note.",
    );
    expect(PHASE2A_NUTRITION_RULE.body).toContain("1,500–1,600 cal floor");
    expect(PHASE2A_NUTRITION_RULE.body).toContain("150–155 g EVERY day");
    expect(PHASE2A_NUTRITION_RULE.body).toContain("Do NOT impose scheduled refeed days");
    expect(PHASE2A_NUTRITION_RULE.body).toContain("10+ consecutive floor days");
    expect(PHASE2A_NUTRITION_RULE.body).toContain("nonfat vanilla Chobani");
    expect(PHASE2A_NUTRITION_RULE.body).toContain("No deficit chasing");
    expect(PHASE2A_WEIGHIN_RULE.type).toBe("standing_rule");
    expect(PHASE2A_NUTRITION_RULE.type).toBe("standing_rule");
  });

  it("v2: the disruption-cluster rule carries the framing, options a/b/c + decide-by, the nutrition default, and the rolling-window caveat", () => {
    expect(PHASE2A_CLUSTER_RULE.type).toBe("standing_rule");
    const body = PHASE2A_CLUSTER_RULE.body;
    expect(standingRuleKey(PHASE2A_CLUSTER_RULE)).toContain("Sep 24 – Oct 5 disruption cluster");
    expect(body).toContain("ONE cluster, not two independent breaks");
    expect(body).toContain("Decide by mid-September");
    expect(body).toContain("(a) Absorb");
    expect(body).toContain("(b) Shift Deload #1 to Oct 2–5");
    expect(body).toContain("(c) Front-load Block 1");
    expect(body).toContain("MAINTENANCE on all travel days in BOTH windows");
    expect(body).toContain("deficit on the normal days between");
    expect(body).toContain("provisional until 6 fresh sessions have accumulated post-Oct 5");
  });

  it("v2: standing-rule idempotency keys (body first lines) are pairwise distinct — rule-block entries went 1 → 2", () => {
    const keys = [PHASE2A_WEIGHIN_RULE, PHASE2A_NUTRITION_RULE, PHASE2A_CLUSTER_RULE].map(standingRuleKey);
    expect(new Set(keys).size).toBe(3);
    for (const key of keys) expect(key.length).toBeGreaterThan(0);
  });

  it("program window matches the spec", () => {
    expect(PHASE2A_PROGRAM.startedOnKey).toBe("2026-08-10");
    expect(PHASE2A_PROGRAM.endsOnKey).toBe("2026-12-31");
    expect(PHASE2A_PROGRAM.notes).toContain("Spider-Man"); // archetype line
    // Blocks 0–3 summary lines from the spec.
    expect(PHASE2A_PROGRAM.notes).toContain("0 · Aug 10–23 · recovery + baselines + DEXA prep");
    expect(PHASE2A_PROGRAM.notes).toContain("3 · Dec 7–31 · final lean-out + rung-2 test");
  });
});

describe("phase2a-spec · v2 Oct 2–8 scheduling exclusion (trip + 3 days after)", () => {
  it("NO scheduled item lands inside Oct 2–8 (DEXA / practice exams / photos / cluster decision all clear)", () => {
    for (const i of PHASE2A_SCHEDULED_ITEMS) {
      const inWindow = i.dateKey >= EXCLUSION_START && i.dateKey <= EXCLUSION_END;
      expect(inWindow, `${i.externalRef} (${i.dateKey}) falls inside the Oct 2–8 exclusion`).toBe(false);
    }
  });

  it("NO baseline retest week intersects Oct 2–8 — the week-10 retest lands Oct 12–18 and must stay there", () => {
    const template = buildPhase2aRotationTemplate();
    const startedOn = parseDateKey(PHASE2A_PLAN.startedOnKey);
    const retestWeeks = [
      ...new Set(template.baselineWeek.flatMap((d) => d.tests.flatMap((t) => t.retestWeeks ?? []))),
    ].sort((a, b) => a - b);
    expect(retestWeeks).toEqual([10, 19]);
    for (const w of retestWeeks) {
      const weekStart = dateKey(addDays(startedOn, (w - 1) * 7));
      const weekEnd = dateKey(addDays(startedOn, (w - 1) * 7 + 6));
      const disjoint = weekEnd < EXCLUSION_START || weekStart > EXCLUSION_END;
      expect(disjoint, `retest week ${w} (${weekStart}..${weekEnd}) intersects the Oct 2–8 exclusion`).toBe(true);
    }
    // Pin the spec's own arithmetic: week 10 = Oct 12–18, safely after Oct 8.
    expect(dateKey(addDays(startedOn, 63))).toBe("2026-10-12");
    expect(dateKey(addDays(startedOn, 69))).toBe("2026-10-18");
  });
});

describe("phase2a-spec · v4 reconcile helpers (baselineWeek revision, milestone, duplicate goal)", () => {
  /** Simulate a Postgres jsonb round-trip: same content, different object
   *  key order (jsonb normalizes key order, so a DB read-back never
   *  guarantees insertion order). */
  function reorderKeysDeep(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(reorderKeysDeep);
    if (value !== null && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(obj).sort().reverse()) out[k] = reorderKeysDeep(obj[k]);
      return out;
    }
    return value;
  }

  it("stableJson is key-order-insensitive (jsonb round-trip safe) but content-sensitive", () => {
    expect(stableJson({ a: 1, b: [{ x: 1, y: 2 }] })).toBe(stableJson({ b: [{ y: 2, x: 1 }], a: 1 }));
    expect(stableJson({ a: 1 })).not.toBe(stableJson({ a: 2 }));
    expect(stableJson([1, 2])).not.toBe(stableJson([2, 1])); // arrays keep order
    expect(stableJson({ a: 1, b: undefined })).toBe(stableJson({ a: 1 })); // undefined keys dropped, like JSON.stringify
  });

  it("the import's targets deep-compare handles the NESTED rolling params: jsonb key-reorder → identical; a param edit → different (step-3b idempotency)", () => {
    // The step-3b skip check is stableJson(goal1.targets) === stableJson(desired).
    // Goal 1's targets now carry a nested RollingParams object two levels
    // down (targets[] → target → rolling) — a jsonb round-trip reorders keys
    // at EVERY depth, so the compare must recurse. Reordered copy → equal:
    const roundTripped = reorderKeysDeep(JSON.parse(JSON.stringify(PHASE2A_GOAL1.targets)));
    expect(stableJson(roundTripped)).toBe(stableJson(PHASE2A_GOAL1.targets));
    // ...and a change INSIDE the nested params must register as different —
    // otherwise a future param edit (e.g. loosening the triple's attempt cap)
    // would silently [skip] on re-import:
    const tweaked = JSON.parse(JSON.stringify(PHASE2A_GOAL1.targets)) as typeof PHASE2A_GOAL1.targets;
    const triple = tweaked.find((t) => t.metric === "rolling:hs_triple20_of6")!;
    triple.rolling!.attemptCap = 6;
    expect(stableJson(tweaked)).not.toBe(stableJson(PHASE2A_GOAL1.targets));
    // Dropping the params object entirely also registers (never re-skips).
    const dropped = JSON.parse(JSON.stringify(PHASE2A_GOAL1.targets)) as typeof PHASE2A_GOAL1.targets;
    delete dropped.find((t) => t.metric === "rolling:hs_sessions_10s_of6")!.rolling;
    expect(stableJson(dropped)).not.toBe(stableJson(PHASE2A_GOAL1.targets));
  });

  it("baselineWeekNeedsReconcile: false on identical AND on a jsonb-style key-reordered copy; true against the old single-session battery", () => {
    const template = buildPhase2aRotationTemplate();
    expect(baselineWeekNeedsReconcile(template)).toBe(false); // fresh import → step-6 create already carries v4
    const reordered = {
      ...template,
      baselineWeek: reorderKeysDeep(JSON.parse(JSON.stringify(PHASE2A_BASELINE_WEEK))),
    } as typeof template;
    expect(baselineWeekNeedsReconcile(reordered)).toBe(false); // idempotent re-run after apply
    const oldBattery = {
      ...template,
      baselineWeek: [
        {
          dayOfWeek: 1 as const,
          title: "Session-1 Baseline Test — run FRESH, before other work (the first skill session)",
          tests: template.baselineWeek.flatMap((d) => d.tests).map((t) => ({ ...t, protocol: "old" })),
        },
      ],
    };
    expect(baselineWeekNeedsReconcile(oldBattery)).toBe(true); // prod state → revision owed
  });

  it("buildBaselineWeekRevisionSnapshot replaces ONLY baselineWeek — every other live-template field is preserved by reference", () => {
    const live = buildPhase2aRotationTemplate();
    live.name = "live-edited name";
    live.baselineWeek = []; // stand-in for a live template that pre-dates the split
    const snapshot = buildBaselineWeekRevisionSnapshot(live);
    expect(snapshot.baselineWeek).toBe(PHASE2A_BASELINE_WEEK);
    expect(snapshot.name).toBe("live-edited name");
    expect(snapshot.weeklySplit).toBe(live.weeklySplit);
    expect(snapshot.phases).toBe(live.phases);
    expect(snapshot.hikingSuperset).toBe(live.hikingSuperset);
    expect(snapshot.dailyMobility).toBe(live.dailyMobility);
    expect(snapshot.totalWeeks).toBe(live.totalWeeks);
    // And the snapshot still lints CLEAN against the import's plan metadata.
    const findings = lintTemplate(snapshot, {
      weeks: PHASE2A_PLAN.weeks,
      startedOn: parseDateKey(PHASE2A_PLAN.startedOnKey),
      endsOn: parseDateKey(PHASE2A_PLAN.endsOnKey),
      goalTargetDate: parseDateKey(PHASE2A_GOAL1.targetDateKey),
    });
    expect(findings).toEqual([]);
  });

  it("revision summary fits apply_plan_revision's ≤200-char contract and the reasoning quotes the spec's why-split paragraph", () => {
    expect(PHASE2A_BASELINE_SPLIT_SUMMARY.length).toBeGreaterThan(0);
    expect(PHASE2A_BASELINE_SPLIT_SUMMARY.length).toBeLessThanOrEqual(200);
    expect(PHASE2A_BASELINE_SPLIT_SUMMARY).toContain("spec v4");
    expect(PHASE2A_BASELINE_SPLIT_REASONING).toContain("Five of the six tests load the same shoulder complex");
    expect(PHASE2A_BASELINE_SPLIT_REASONING).toContain("accumulated fatigue");
    expect(PHASE2A_BASELINE_SPLIT_REASONING).toContain("80-ceiling math wrong for months");
    expect(PHASE2A_BASELINE_SPLIT_REASONING).toContain("Block 0 runs two full weeks");
  });

  it("milestone data point: 10 s / sec / 2026-08-09 — dated BEFORE plan start so it can never credit the S1 initial checkpoint", () => {
    expect(PHASE2A_MILESTONE_BASELINE).toMatchObject({
      testName: "Freestanding Handstand Hold",
      value: 10,
      units: "sec",
      dateKey: "2026-08-09",
    });
    expect(PHASE2A_MILESTONE_BASELINE.dateKey < PHASE2A_PLAN.startedOnKey).toBe(true); // data point, not S1
    expect(PHASE2A_MILESTONE_BASELINE.value).toBeGreaterThan(0); // never a phantom-completion row
    expect(PHASE2A_MILESTONE_BASELINE.notes).toContain("video-verified");
    expect(PHASE2A_MILESTONE_BASELINE.notes).toContain("2nd occurrence ever");
    expect(PHASE2A_MILESTONE_BASELINE.notes).toContain("data point per spec v4");
    // Agrees with the target's explicit start (earliest-row auto-start would
    // land on the same number if start were ever omitted).
    const max = PHASE2A_GOAL1.targets.find((t) => t.metric === "baseline:Freestanding Handstand Hold")!;
    expect(max.start).toBe(PHASE2A_MILESTONE_BASELINE.value);
  });

  it("duplicate-goal resolution targets the spec's id, points at Goal 1, and the note append is idempotent", () => {
    expect(PHASE2A_DUPLICATE_GOAL.id).toBe("cmq8pz7xp000304ic0wux6r2a");
    expect(PHASE2A_DUPLICATE_GOAL.id).not.toBe(PHASE2A_GOAL1_ID); // never the keeper
    expect(PHASE2A_DUPLICATE_GOAL.note).toContain(PHASE2A_GOAL1_ID); // superseded-by points at the rung goal
    expect(PHASE2A_DUPLICATE_GOAL.note).toContain("delete manually if desired"); // never deleted by the import
    // Idempotency of the pure append:
    expect(appendDuplicateGoalNote(null)).toBe(PHASE2A_DUPLICATE_GOAL.note);
    expect(appendDuplicateGoalNote("")).toBe(PHASE2A_DUPLICATE_GOAL.note);
    expect(appendDuplicateGoalNote("existing owner note")).toBe(`existing owner note\n${PHASE2A_DUPLICATE_GOAL.note}`);
    const once = appendDuplicateGoalNote("existing owner note");
    expect(appendDuplicateGoalNote(once)).toBe(once); // re-run → unchanged
    expect(appendDuplicateGoalNote(PHASE2A_DUPLICATE_GOAL.note)).toBe(PHASE2A_DUPLICATE_GOAL.note);
  });
});
