// Unit tests for the Phase 2A import spec constants + builders
// (src/lib/phase2a-spec.ts) — the pure layer under scripts/import-phase2a.ts.
//
// Contract under test (design amendment 4):
//   • every goal's target array validates against GoalTargetSchema
//   • weights sum to 1.0 ±0.01 per goal
//   • the rotation template passes lintTemplate() CLEAN (no errors, no
//     warnings) against the plan metadata the import writes
//   • phases map to spec Blocks 0–3 and tile weeks 1..20 exactly
//   • the week table, A/B/C skill rotation, and Session-1 baseline battery
//     match the spec
//   • overrides land inside the plan window and honor the Mirror Lake
//     sacred-time language (never a deload)
//
// lintTemplate is imported from plan-lint (pure entry — no DB access in the
// template rules); vitest.config supplies a placeholder DATABASE_URL so the
// transitive @/lib/db import initializes without a live database.

import { describe, expect, it } from "vitest";
import { GoalTargetSchema } from "@/lib/metrics-registry";
import { LegendSchema } from "@/lib/legend";
import { AttributionRuleAuthoringSchema } from "@/lib/attribution-rules";
import { lintTemplate } from "@/lib/plan-lint";
import { addDays, parseDateKey } from "@/lib/calendar-core";
import {
  buildG4AttributionRule,
  buildPhase2aOverrides,
  buildPhase2aRotationTemplate,
  PHASE2A_GOAL1,
  PHASE2A_GOAL2,
  PHASE2A_GOAL3,
  PHASE2A_NUTRITION_RULE,
  PHASE2A_PLAN,
  PHASE2A_PROGRAM,
  PHASE2A_SAVED_MEALS,
  PHASE2A_SCHEDULED_ITEMS,
  PHASE2A_WEIGHIN_RULE,
  standingRuleKey,
} from "@/lib/phase2a-spec";

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

  it("Goal 1 carries the spec's 6-target table with exactly the two gating rungs", () => {
    expect(PHASE2A_GOAL1.targets).toHaveLength(6);
    const gates = PHASE2A_GOAL1.targets.filter((t) => t.gating);
    expect(gates.map((t) => t.metric).sort()).toEqual([
      "baseline:Freestanding Handstand Hold",
      "baseline:Wall Handstand Push-Up",
    ]);
    // Spec table values, spot-checked exactly.
    const byMetric = Object.fromEntries(PHASE2A_GOAL1.targets.map((t) => [t.metric, t]));
    expect(byMetric["baseline:Freestanding Handstand Hold"]).toMatchObject({ start: 0, target: 20, weight: 0.35, units: "sec", direction: "increase" });
    expect(byMetric["baseline:Wall Handstand Push-Up"]).toMatchObject({ start: 0, target: 5, weight: 0.25 });
    expect(byMetric["baseline:Chest-to-Wall Handstand Hold"]).toMatchObject({ start: 30, target: 60, weight: 0.12 });
    expect(byMetric["baseline:Pull-Up Max Reps"]).toMatchObject({ start: 25, target: 25, weight: 0.1 });
    expect(byMetric["baseline:Floating Pike Push-Up"]).toMatchObject({ start: 5, target: 10, weight: 0.09 });
    expect(byMetric["baseline:L-Sit (Parallettes)"]).toMatchObject({ start: 30, target: 60, weight: 0.09 });
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

  it("baselineWeek is the 7-test Session-1 battery on Day 1 with retests at weeks 10 & 19", () => {
    expect(template.baselineWeek).toHaveLength(1);
    const day = template.baselineWeek[0]!;
    expect(day.dayOfWeek).toBe(1);
    expect(day.tests.map((t) => t.testName)).toEqual([
      "Freestanding Handstand Hold",
      "Wall Handstand Push-Up",
      "L-Sit (Parallettes)",
      "Floating Pike Push-Up",
      "Floating Pike Push-Up Press",
      "Chest-to-Wall Handstand Hold",
      "Pull-Up Max Reps",
    ]);
    for (const t of day.tests) {
      expect(t.retestWeeks).toEqual([10, 19]); // Block-1 end + pre-Christmas rung-2 window
      expect(t.initialWeek ?? 1).toBe(1);
    }
  });

  it("every baseline:* target metric on Goals 1–2 has a scheduled Session-1 test", () => {
    const scheduled = new Set(template.baselineWeek[0]!.tests.map((t) => t.testName));
    const baselineMetrics = [...PHASE2A_GOAL1.targets, ...PHASE2A_GOAL2.targets]
      .map((t) => t.metric)
      .filter((m) => m.startsWith("baseline:"))
      .map((m) => m.slice("baseline:".length));
    for (const name of baselineMetrics) {
      expect(scheduled.has(name), `missing Session-1 test for baseline:${name}`).toBe(true);
    }
  });
});

describe("phase2a-spec · overrides", () => {
  const overrides = buildPhase2aOverrides();
  const startedOn = parseDateKey(PHASE2A_PLAN.startedOnKey);

  it("covers Mirror Lake (2) + Virginia soft break (4) + deload #1 (3) + deload #2 (4) = 13 dates, all unique", () => {
    expect(overrides).toHaveLength(13);
    expect(new Set(overrides.map((o) => o.dateKey)).size).toBe(13);
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
});

describe("phase2a-spec · scheduled items, meals, standing rules", () => {
  it("scheduled items carry unique phase2a:* externalRefs and the spec's checkpoint dates", () => {
    expect(PHASE2A_SCHEDULED_ITEMS).toHaveLength(9); // 3 DEXA + 2 practice exams + 4 photo months
    expect(new Set(PHASE2A_SCHEDULED_ITEMS.map((i) => i.externalRef)).size).toBe(9);
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

  it("program window matches the spec", () => {
    expect(PHASE2A_PROGRAM.startedOnKey).toBe("2026-08-10");
    expect(PHASE2A_PROGRAM.endsOnKey).toBe("2026-12-31");
    expect(PHASE2A_PROGRAM.notes).toContain("Spider-Man"); // archetype line
    // Blocks 0–3 summary lines from the spec.
    expect(PHASE2A_PROGRAM.notes).toContain("0 · Aug 10–23 · recovery + baselines + DEXA prep");
    expect(PHASE2A_PROGRAM.notes).toContain("3 · Dec 7–31 · final lean-out + rung-2 test");
  });
});
