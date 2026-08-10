// Phase 2A — "Lighter and Upside Down" import spec, as PURE data + builders.
//
// Source of truth: examples/phase2a-goals-import-spec.md (authored 2026-08-10)
// + docs/program-redesign/03-run-amendments.md (design amendment 4). This
// module holds the spec's constants (target tables, week table, dates, texts)
// and the builders scripts/import-phase2a.ts materializes into the DB — kept
// pure (no Prisma, no Node built-ins, type-only imports) so the builders are
// unit-testable without a live database (see phase2a-spec.test.ts: targets
// validate against GoalTargetSchema, weights sum to 1.0 per goal, and the
// rotation template passes lintTemplate()).
//
// Editing rule: the spec file is the sacred text. Any deviation made here for
// engine-shape reasons is called out inline with a `DEVIATION:` comment and
// surfaced in the import script's output.
//
// ── SPEC V2 DELTA (2026-08-10 04:23 edit, AFTER the prod import ran from v1) ──
// The owner updated examples/phase2a-goals-import-spec.md lines 32–46; the
// idempotent re-run adds exactly this delta and nothing else:
//   1. NEW travel row Oct 2–5 "Out of town — destination TBD" (UNCERTAIN
//      TRAINING WINDOW) → buildPhase2aOverrides() gains 4 NOTE-ONLY overrides
//      (the Sep 4–7 soft-break mechanism — no workoutJson day-swap, so they
//      never band on the calendar; see the calendar-windows.ts contract),
//      notes carrying the no-baseline-retest/DEXA/practice-exam constraint
//      for the window + 3 days after (→ Oct 2–8 exclusion).
//   2. NEW "Sep 24 – Oct 5 disruption cluster" block (options a/b/c, decide
//      by mid-September) → PHASE2A_CLUSTER_RULE standing rule + the Sep 15
//      "phase2a:cluster-decision" ScheduledItem on Goal 1 (rotation owner).
//   3. "Nutrition through the cluster" (MAINTENANCE on all travel days in
//      BOTH windows, deficit on the normal days between) → the Oct
//      overrides' nutritionText + the cluster rule.
//   4. Rolling-window caveat (handstand rates provisional until 6 fresh
//      qualifying sessions post-Oct 5) → the cluster rule.
// Sanity counts moved: overrides 13 → 17 · scheduled items 9 → 10 · standing
// rules in the rule block 1 → 2 (the weigh-in cadence rule is unchanged).
//
// ── SPEC V4 DELTA (2026-08-09 revision, adopted 2a7a0d7 — the handstand
//    repeatability merge, AFTER the prod import ran with the 6-target table
//    and the single-session baseline battery) ──
//   1. Goal 1 targets → the spec's 9-row table (lines 63–73): the 0→20 s max
//      is retained but DEMOTED (0.35 → 0.12, gate removed); three rolling
//      log:hs_* repeatability measures carry 0.43; chest-to-wall target
//      raised 60 → 120 s; pull-up canary 0.10 → 0.07; accessories
//      compressed. Gates are now log:hs_triple20_of6 + baseline:Wall
//      Handstand Push-Up. Weights still sum 1.00.
//   2. baselineWeek → the three-session S1/S2/S3 split (spec lines 225–256):
//      S1 Mon (day 1) Balance · S2 Wed (day 3) Vertical press · S3 Thu
//      (day 4) Support isometric + admin, each test carrying its binding
//      protocol + the retest protocol-consistency rule. Retest weeks (10 &
//      19) keep the same split structure automatically (per-day dayOfWeek +
//      per-test retestWeeks).
//   3. The import script gains reconcile steps: a PlanRevision that replaces
//      the live planJson.baselineWeek (skip when identical), the 2026-08-09
//      video-verified milestone Baseline data point, and the duplicate
//      someday-Handstand goal resolution (abandon, never delete).
//
// ── ROLLING FLIP (2026-08-10, after the engine-native rolling:* family
//    shipped — rolling-metrics.ts + the goal-targets.ts resolver) ──
// The three handstand repeatability targets flipped from coach-computed
// log:hs_* snapshots (log_workout + manual recompute + 3× log_metric per
// session) to ENGINE-NATIVE rolling:hs_* trackers: same slugs, labels,
// units, bars (0→4 / 0→4 / 0→1), weights, and gates — but the value is now
// computed by the readiness engine directly from logged attempt sets (the
// required RollingParams on each target carry the semantics), and the
// per-session protocol collapses to ONE write: log_workout with every
// attempt as its own duration set on the canonical exercise. log_metric
// recomputation is RETIRED for these three; regression is engine-inherent
// (window roll-out), not coach discipline.

import type { GoalTarget } from "@/lib/metrics-registry";
import type { AttributionRule } from "@/lib/attribution-rules";
import type { Legend } from "@/lib/legend";
import type {
  Block,
  BaselineDay,
  DayTemplate,
  Phase,
  ProgramTemplate,
} from "@/lib/program-template";

// ---------------------------------------------------------------------------
// Identity + window
// ---------------------------------------------------------------------------

/** Goal 1 already exists on the old model — identity matters; NEVER re-create. */
export const PHASE2A_GOAL1_ID = "cmsmi9k20000004laub50psio";

export const PHASE2A_PROGRAM = {
  name: "Phase 2A — Lighter and Upside Down",
  /** Program window per the spec: 2026-08-10 → 2026-12-31 (20 weeks). */
  startedOnKey: "2026-08-10",
  endsOnKey: "2026-12-31",
  notes: [
    "Archetype: Spider-Man — control, flexibility, relative strength, lean aesthetic.",
    "Blocks:",
    "  0 · Aug 10–23 · recovery + baselines + DEXA prep · eat at maintenance",
    "  1 · Aug 24–Oct 18 (8 wk) · skill acquisition + moderate deficit · rung-1 target",
    "  2 · Oct 19–Dec 6 (7 wk) · deeper cut + skill consolidation · AWS exam window",
    "  3 · Dec 7–31 · final lean-out + rung-2 test",
    "Deloads ~every 4–5 wks, aligned to travel: #1 Sep 25–27 (Virginia, paired with the Sep 24 golf invitational in Matt's honor), #2 Nov 26–29 (Thanksgiving — eat at MAINTENANCE those days, not deficit).",
    "Mirror Lake Aug 14–15: SACRED TIME (spreading Matt's ashes), not a deload — no training expectation, no makeup sessions.",
    "Dec 23–27 Christmas travel: run the rung-2 test BEFORE traveling (~Dec 20–22, preferred) or slide the effective deadline to early Jan — decide later.",
    "Plan-owner: Goal 1 (Handstand) owns the training rotation; Goals 2 & 3 ride plan-less.",
  ].join("\n"),
} as const;

// ---------------------------------------------------------------------------
// Goal 1 — Freestanding Handstand (EXISTS — re-parent + update, never create)
// ---------------------------------------------------------------------------

/** Spec v4's 9-row target table (lines 63–73), exactly — the handstand
 *  repeatability merge, approved by Jerry 2026-08-09. Weights sum to 1.00.
 *  Still two gating rungs — ceiling capped at 80 until BOTH clear
 *  (mastery-before-done); rung 3 (5 freestanding HSPU) deferred to 2B/2027.
 *
 *  The merge: the freestanding hold was a single 0→20 s max at weight 0.35.
 *  A single max can be satisfied by one good day, and this skill has now
 *  produced a ≥10 s hold twice, months apart, without becoming repeatable
 *  ("ultimately what I want is repeatability of the skill when I want it").
 *  The max is retained but demoted to 0.12; three rolling measures carry
 *  0.43 (handstand cluster 0.35 → 0.55; accessories compressed). Still two
 *  gates, not three: the gate came off the max — you cannot hit 3× ≥20 s in
 *  a session without a 20 s max, so the triple (now rolling:hs_triple20_of6
 *  post-flip) subsumes it; Wall HSPU keeps its gate as the independent
 *  second rung.
 *
 *  ⚠ The three rolling:hs_* rows MUST be able to REGRESS — and that
 *  regression is now ENGINE-INHERENT (window roll-out), not coach
 *  discipline: the readiness engine recomputes each value from the trailing
 *  `window` qualifying sessions at every read (rolling-metrics.ts), so old
 *  hit-sessions roll out of the window and the number DROPS by construction
 *  — no re-logging involved. Spec §"These must be able to REGRESS" (design
 *  rationale, retained): a cumulative counter cannot decrease, so "sessions
 *  where I hit 20s" would climb to 4 and stay there through a six-week
 *  layoff — a trophy case, not a consistency measure.
 *  `rolling:hs_triple20_of6` stays framed as "achieved in ≥1 of last 6"
 *  rather than "ever achieved" for the same reason: it lights up on first
 *  success and goes dark if the capacity disappears. Contrast with Goal 3's
 *  `log:study_hours`, which IS `cumulative: true`. Do not copy that pattern
 *  here. (`cumulative` is now irrelevant on these rows — the rolling
 *  resolver never reads it; the REQUIRED `rolling` params carry all
 *  semantics, enforced by GoalTargetSchema's cross-field refinement.)
 *
 *  Rolling-measure parameters (approved — now stored ON each target as its
 *  RollingParams): window = last 6 QUALIFYING sessions (~2 weeks at current
 *  cadence); "locked in" = 4 of 6 (67%); the triple's 3 qualifying ≥20 s
 *  holds must land within a span of ≤5 consecutive attempts (attemptCap 5 —
 *  non-qualifying attempts occupy slots; rest between them unrestricted).
 *  Qualifying session = a completed workout with ≥1 timed set of
 *  "Freestanding Handstand Hold" (canonicalExerciseName both sides). The
 *  coach controls the denominator by what gets logged under that name
 *  (gotchas §F.8): incidental time upside down must NEVER be logged as that
 *  exercise, and EVERY deliberate attempt is its own duration set — the
 *  attemptCap span needs the misses too. */
const GOAL1_TARGETS: GoalTarget[] = [
    {
      metric: "baseline:Freestanding Handstand Hold",
      label: "Max freestanding hold",
      units: "sec",
      direction: "increase",
      start: 10,
      target: 20,
      weight: 0.12,
      rationale:
        "Retained but demoted (v4 merge: was 0.35 + gate) — a single max can be satisfied by one good day; the rolling measures now carry the weight, and the gate moved to rolling:hs_triple20_of6 (which subsumes it — no 3× ≥20 s session without a 20 s max). Start 10, NOT 0, from the 2026-08-09 video-verified hold: 0 would assert he cannot hold a freestanding handstand at all, which is false. S1 confirms or RAISES it — it does not establish it from scratch. Do NOT let a fatigued S1 overwrite it (S1 is two days after a 12.69-mile Elbert descent — a sub-10 S1 is a fatigue reading, not a corrected baseline; the engine resolves current as most-recent-by-date, but this explicit start is never auto-overwritten). Begins at 50% of target while the skill is not repeatable at all — exactly why the max was demoted and the rolling measures carry 0.43.",
    },
    {
      metric: "rolling:hs_sessions_10s_of6",
      label: "≥10s hold — sessions hit, last 6",
      units: "of 6",
      direction: "increase",
      start: 0,
      target: 4,
      weight: 0.08,
      // ENGINE-NATIVE rolling tracker — params carry all semantics; the
      // engine computes the value from logged attempt sets, and regression
      // is window-inherent (see the table doc comment above).
      rolling: { exercise: "Freestanding Handstand Hold", minSeconds: 10, hitsPerSession: 1, window: 6 },
      rationale:
        "Rolling repeatability: sessions with a ≥10 s hold among the last 6 qualifying sessions; 'locked in' = 4 of 6. ENGINE-COMPUTED from logged attempt sets (rolling:* family) — recomputed over the trailing 6 qualifying sessions at every read; regression is window-inherent (old hit-sessions roll out), never a re-logging step. Carries live signal for the months while the 20 s measures sit at zero — the intended function of a progression rubric, not dead weight.",
    },
    {
      metric: "rolling:hs_sessions_20s_of6",
      label: "≥20s hold — sessions hit, last 6",
      units: "of 6",
      direction: "increase",
      start: 0,
      target: 4,
      weight: 0.15,
      // ENGINE-NATIVE rolling tracker — regression is window-inherent.
      rolling: { exercise: "Freestanding Handstand Hold", minSeconds: 20, hitsPerSession: 1, window: 6 },
      rationale:
        "Rolling repeatability at the rung-1 standard: sessions with a ≥20 s hold among the last 6 qualifying; target 4 of 6. ENGINE-COMPUTED (rolling:* family) — a snapshot that regresses by construction as old hit-sessions roll out of the trailing window: a consistency measure, never a trophy case (a cumulative counter would climb to 4 and stay there through a six-week layoff).",
    },
    {
      metric: "rolling:hs_triple20_of6",
      label: "3× ≥20s in one session — sessions hit, last 6",
      units: "of 6",
      direction: "increase",
      start: 0,
      target: 1,
      weight: 0.2,
      gating: true,
      // ENGINE-NATIVE rolling tracker — the attemptCap span is computed from
      // the session's own set order; regression is window-inherent.
      rolling: { exercise: "Freestanding Handstand Hold", minSeconds: 20, hitsPerSession: 3, attemptCap: 5, window: 6 },
      rationale:
        "The rung-1 gate (moved off the max in the v4 merge — this subsumes it: you cannot hit 3× ≥20 s in a session without a 20 s max). 3 qualifying ≥20 s holds in ONE session, within a span of ≤5 consecutive attempts (attemptCap 5 — non-qualifying attempts occupy slots; rest between them unrestricted), achieved in ≥1 of the last 6 qualifying sessions — framed as 'in ≥1 of last 6' rather than 'ever achieved' so it lights up on first success and goes dark if the capacity disappears. ENGINE-COMPUTED (rolling:* family); regression is window-inherent.",
    },
    {
      metric: "baseline:Wall Handstand Push-Up",
      label: "Wall handstand push-up (full ROM)",
      units: "reps",
      direction: "increase",
      start: 0,
      target: 5,
      weight: 0.2,
      gating: true,
      rationale:
        "Rung 2. Full ROM = head to floor, full lockout. Gating: both rungs must clear before the ceiling lifts. Start 0 pending the S2 full-ROM-vs-assisted check.",
    },
    {
      metric: "baseline:Chest-to-Wall Handstand Hold",
      label: "Chest-to-wall handstand hold",
      units: "sec",
      direction: "increase",
      start: 30,
      target: 120,
      weight: 0.08,
      rationale:
        "Target raised 60 → 120 s at Jerry's call (2026-08-09): chest-to-wall removes balance entirely (toes rest on the wall as contact, not support), so this is a pure shoulder-endurance and line-quality measure that can carry a genuine reach number. Honest framing: 120 s is NOT on the critical path to the 20 s hold or 5 wall HSPU (~60 s is the cited prerequisite; past that, carryover to balance drops off) — its value is that it keeps producing honest progress while freestanding work is frustrating and the rolling rates sit at zero. Accepted consequences: 60 s now reads as 33% of this target (was 100%), and long isometrics are fatiguing — do NOT let 2-minute-hold grinding eat the balance and pressing work; if a session has to choose, toe pulls and kick-ups win. Test at S3 and at retests; do not chase it every session. The S3 protocol (hand distance, line standard, toe brush) is REQUIRED — the score is meaningless without it.",
    },
    {
      metric: "baseline:Pull-Up Max Reps",
      label: "Pull-up max (lean-mass canary)",
      units: "reps",
      direction: "increase",
      start: 25,
      target: 25,
      weight: 0.07,
      rationale:
        "Deliberately low weight, but NOT weighted for difficulty: it is the alarm that says the cut is eating muscle (see the 10% body-fat goal). Do not drop it for being cheap to hold. Holding 25 while weight drops = losing fat, not muscle.",
    },
    {
      metric: "baseline:Floating Pike Push-Up",
      label: "Floating pike push-up",
      units: "reps",
      direction: "increase",
      start: 5,
      target: 10,
      weight: 0.05,
      rationale:
        "Pressing accessory toward the HSPU rung — compressed in the v4 merge (accessories made room for the handstand cluster's 0.35 → 0.55).",
    },
    {
      metric: "baseline:L-Sit (Parallettes)",
      label: "L-sit hold (parallettes)",
      units: "sec",
      direction: "increase",
      start: 30,
      target: 60,
      weight: 0.05,
      rationale: "Support/compression accessory. Start 30 pending S1 confirmation.",
    },
];

export const PHASE2A_GOAL1 = {
  id: PHASE2A_GOAL1_ID,
  objective: "Freestanding Handstand — 20s hold, then 5 wall HSPU",
  targetDateKey: "2026-12-31",
  targets: GOAL1_TARGETS,
  /** Spec list, verbatim — no aliases exist in the canonical map for these
   *  names, so canonicalExerciseName() is identity on every entry (the import
   *  script still routes them through it, same as create_goal/update_goal). */
  attributionHints: [
    "Chest-to-Wall Handstand Hold",
    "Freestanding Handstand Hold",
    "Freestanding Hold Attempts",
    "Shoulder Taps (chest-to-wall)",
    "Kick-up + Bail Practice",
    "Toe Pulls (wall)",
    "Crow Pose Hold",
    "Crow → Headstand → Crow Sequence",
    "Headstand",
    "L-Sit Progression",
    "L-Sit (Parallettes)",
    "Pike Push-Up",
    "Elevated Pike Push-Up",
    "Floating Pike Push-Up",
    "Floating Pike Push-Up Press",
    "Wall Handstand Push-Up",
    "Wrist Prep",
  ],
  /** Spec: 🤸 trained · 🎯 goal-date · 📏 baseline. */
  legend: [
    { icon: "🤸", label: "Trained", kind: "trained" },
    { icon: "🎯", label: "Goal date", kind: "goal-date" },
    { icon: "📏", label: "Baseline due", kind: "baseline" },
  ] satisfies Legend,
};

// ---------------------------------------------------------------------------
// Goal 2 — Reach 10% body fat (CREATE fresh, NO plan)
// ---------------------------------------------------------------------------

/** Spec's 3-target table. bodyFatPct start is DELIBERATELY omitted —
 *  spec says start is TBD at the Sept 3 DEXA; leaving `start` off lets the
 *  readiness engine auto-capture it from the earliest Measurement.bodyFatPct
 *  (resolveMetricStart), i.e. the DEXA itself sets the real start. */
const GOAL2_TARGETS: GoalTarget[] = [
    {
      metric: "bodyFatPct",
      label: "Body fat % (DEXA-anchored)",
      units: "%",
      direction: "decrease",
      target: 10,
      weight: 0.45,
      rationale:
        "start omitted on purpose — TBD at the Sept 3 DEXA; the engine auto-captures it from the earliest logged bodyFatPct measurement.",
    },
    {
      metric: "weightLb",
      label: "Body weight (proxy)",
      units: "lb",
      direction: "decrease",
      start: 155,
      target: 143,
      weight: 0.4,
      rationale:
        "Target is body-fat %; weight is the proxy. 143 assumes ~129 lb lean mass (129 ÷ 0.90). If the Sept 3 DEXA says lean is ~135, 10% ≈ 150 and this target moves — do NOT hard-commit 143 until the scan.",
    },
    {
      metric: "baseline:Pull-Up Max Reps",
      label: "Pull-up max (lean-mass canary)",
      units: "reps",
      direction: "increase",
      start: 25,
      target: 25,
      weight: 0.15,
      rationale:
        "Losing weight while pull-up max holds = losing fat, not muscle. If it drops at constant bodyweight, slow the deficit.",
    },
];

export const PHASE2A_GOAL2 = {
  objective: "Reach 10% body fat",
  kind: "fitness" as const,
  targetDateKey: "2026-12-31",
  targets: GOAL2_TARGETS,
  notes: [
    "Metrics-only goal — NO plan (rides the Program rotation + weigh-in cadence + nutrition standing rule).",
    "Rate: ~1 lb/week, ~0.7 net; target reachable ~early Nov (≈7 wk early) — bank the margin, don't spend it.",
    "Phase 2B sequel: this goal continues into 2027 as a reverse diet (143 → 155 across the year). Don't design it as Dec-terminal.",
    "Checkpoints: DEXA #1 2026-09-03 (sets the real bodyFatPct start + confirms/moves the 143 target), DEXA #2 ~2026-10-18 (watch LEAN MASS), DEXA #3 ~2026-12-28 (confirm finish, baseline the reverse diet). Weekly Sun/Mon weigh-in + waist tape per standing rule; monthly progress photos.",
  ].join("\n"),
  attributionHints: null, // spec: none — advanced by nutrition logging + weigh-ins, not exercises
  /** Spec: ⚖️ weigh-in · 🎯 goal-date · 📊 DEXA.
   *  DEVIATION (shape only): LegendKind is a closed enum with no weigh-in/DEXA
   *  render condition — ⚖️ rides "override" (custom day marker) and 📊 rides
   *  "scheduled-item" (the DEXA/photo checkpoints ARE ScheduledItems). */
  legend: [
    { icon: "⚖️", label: "Weigh-in", kind: "override" },
    { icon: "🎯", label: "Goal date", kind: "goal-date" },
    { icon: "📊", label: "DEXA / checkpoint", kind: "scheduled-item" },
  ] satisfies Legend,
};

// ---------------------------------------------------------------------------
// Goal 3 — AWS Solutions Architect Associate (CREATE fresh, project, NO date)
// ---------------------------------------------------------------------------

const GOAL3_TARGETS: GoalTarget[] = [
    {
      metric: "log:study_hours",
      label: "Cumulative study hours",
      units: "hours",
      direction: "increase",
      start: 0,
      target: 120,
      weight: 0.45,
      cumulative: true,
      rationale:
        "cumulative:true — log per-session increments; the engine sums. Do NOT log running totals. Learn Cantrill SAA ~350 lectures, ~60–65 hr video; total effort incl. demos/labs/notes/practice exams estimated 115–125 hr.",
    },
    {
      metric: "log:sections_done",
      label: "Course sections complete",
      units: "sections",
      direction: "increase",
      start: 0,
      target: 23,
      weight: 0.3,
      rationale: "Snapshot — log the current count, not increments.",
    },
    {
      metric: "log:practice_exam_score",
      label: "Practice exam score",
      units: "%",
      direction: "increase",
      start: 0,
      target: 80,
      weight: 0.25,
      gating: true,
      rationale:
        "Snapshot. Gating: readiness caps at 80 until practice exams ≥ 80% — this is the 'schedule the exam' trigger. You don't control an exam you haven't studied for.",
    },
];

export const PHASE2A_GOAL3 = {
  objective: "Pass the AWS Solutions Architect Associate exam",
  kind: "project" as const,
  targetDateKey: null, // readiness-GATED (~Q1 2027), not date-driven
  targets: GOAL3_TARGETS,
  notes: [
    "Readiness-gated, not date-driven — schedule the real exam only when practice exams clear 80%.",
    "Split: treadmill = lectures (Mon/Wed/Thu fasted-walk mornings, ~3 hr/wk); desk = demos, labs, diagram-heavy sections (Tue/Fri + weekend, ~2–3 hr/wk). Demos can't be done on a treadmill.",
    "Feeds SimpleSense — the cert strengthens that application; keep them mentally linked.",
  ].join("\n"),
  /** Spec: 📚 study session · 🎓 exam-ready gate.
   *  DEVIATION (shape only): closed LegendKind enum — 📚 rides
   *  "scheduled-item" (study/practice-exam checkpoints), 🎓 rides "goal-date"
   *  (marks the exam date once one is scheduled; renders nothing until then). */
  legend: [
    { icon: "📚", label: "Study session", kind: "scheduled-item" },
    { icon: "🎓", label: "Exam-ready gate", kind: "goal-date" },
  ] satisfies Legend,
};

// ---------------------------------------------------------------------------
// Program attributionRules — the G4 rule (one AM incline walk credits the cut
// + AWS study + handstand Z2 base from a single log call)
// ---------------------------------------------------------------------------

export const G4_RULE_TITLE_CONTAINS = [
  "incline walk",
  "treadmill walk",
  "fasted walk",
] as const;

export function buildG4AttributionRule(goalIds: {
  cut: string;
  aws: string;
  handstand: string;
}): AttributionRule {
  return {
    match: { titleContains: [...G4_RULE_TITLE_CONTAINS] },
    goalIds: [goalIds.cut, goalIds.aws, goalIds.handstand],
    note: "AM incline walk: Z2 base + deficit + AWS lectures",
  };
}

// ---------------------------------------------------------------------------
// Rotation plan (Goal 1 owns it) — 20 weeks from 2026-08-10 (a Monday, so
// rotation Day 1 = Mon). Phases map to spec Blocks 0–3; weeks tile 1..20:
//   Block 0 = weeks 1–2   (Aug 10–23)
//   Block 1 = weeks 3–10  (Aug 24–Oct 18)
//   Block 2 = weeks 11–17 (Oct 19–Dec 6)
//   Block 3 = weeks 18–20 (Dec 7–27)
// The 20-week rotation ends Dec 27 (endsOn = startedOn + 140 d = Dec 28);
// Dec 28–31 sit inside the PROGRAM window but outside the rotation — that is
// the spec's own Christmas-travel tension (rung-2 test preferred ~Dec 20–22,
// i.e. week 19/20, BEFORE traveling).
// ---------------------------------------------------------------------------

export const PHASE2A_PLAN = {
  name: "Phase 2A — Handstand Rotation (20 weeks)",
  startedOnKey: "2026-08-10",
  endsOnKey: "2026-12-28", // startedOn + 20*7 days — keeps lintTemplate metadata clean
  weeks: 20,
} as const;

/** Spec v4 (lines 254–256) retest protocol-consistency rule — appended to
 *  EVERY baseline test's protocol so any surface that shows the test at
 *  retest time (get_baseline_schedule, resolveDay's baselinesDue, /baselines)
 *  carries it. This is where retests actually read protocol text — the
 *  BaselineDay type has no notes field, and the schedule read
 *  (records.ts getBaselineScheduleForPlan) surfaces per-test `protocol`. */
export const PHASE2A_RETEST_CONSISTENCY_RULE =
  "RETEST CONSISTENCY (weeks 10 & 19): perfect isolation is not achievable in this battery — consistent conditions are. Record test order, rest intervals actually taken, and time of day; retest in the IDENTICAL order with the same rests at the same time of day. A retest run in a different sequence is not comparable to the initial no matter how clean each individual test was — it produces phantom progress or phantom regression.";

/** Baseline battery — SPLIT ACROSS THREE SESSIONS (spec v4, lines 225–256;
 *  previously one Session-1 battery — "that was a measurement error").
 *
 *  Why split (spec, quoted in the reconcile revision's reasoning): five of
 *  the six tests load the same shoulder complex; run back-to-back,
 *  everything after the second test is measured under accumulated fatigue —
 *  start values come in artificially low, readiness under-reads for the
 *  whole block, and retests show "improvement" that is partly a different
 *  fatigue state. BOTH gating targets are in this battery — a depressed gate
 *  start makes the 80-ceiling math wrong for months. Block 0 runs two full
 *  weeks; there is no reason to compress this.
 *
 *  Placement (plan starts Mon 2026-08-10, so rotation days == weekdays):
 *  S1 Mon Aug 10 (day 1) Balance, fully fresh · S2 Wed Aug 12 (day 3)
 *  Vertical press · S3 Thu Aug 13 (day 4) Support isometric + admin. All
 *  baselines land before Aug 14–15 (Mirror Lake) — that window stays
 *  untouched. Retest weeks 10 (Block-1 end, Oct 12–18) and 19 (rung-2
 *  window Dec 14–20, BEFORE Christmas travel) keep the same S1/S2/S3
 *  structure automatically: each BaselineDay keeps its dayOfWeek and each
 *  test its retestWeeks, so week 10/19 land the same tests on the same
 *  rotation days.
 *
 *  Results are logged when actually performed — NEVER pre-seeded (spec: log
 *  actual results; the 2026-08-09 milestone hold is a separate historical
 *  data point, not an S1 result). */
export const PHASE2A_BASELINE_WEEK: BaselineDay[] = [
  {
    dayOfWeek: 1, // S1 · Mon Aug 10 — week 1 day 1
    title:
      "S1 · Baseline — Balance (fully fresh): nothing precedes these that loads a shoulder. Wrist Prep first (5 min, not scored).",
    tests: [
      {
        testName: "Freestanding Handstand Hold",
        units: "sec",
        protocol:
          "Best of 3–4 attempts, 2–3 min FULL rest between attempts; stop at 4 even if it feels good. Record EVERY attempt individually (duration + clean kick-up vs. save), not just the best — the rolling targets need attempt counts for the ≤5-attempt triple cap. Confirms or RAISES the video-verified 10 s start (2026-08-09) — it does not establish it from scratch; a fatigued sub-10 here is a fatigue reading, not a corrected baseline. " +
          PHASE2A_RETEST_CONSISTENCY_RULE,
        retestWeeks: [10, 19],
      },
      {
        testName: "L-Sit (Parallettes)",
        units: "sec",
        protocol:
          "Max hold, single attempt, 3+ min after the last handstand attempt. Straight-arm support and compression, not pressing — safe to pair in S1. Confirms or moves the 30 s start. " +
          PHASE2A_RETEST_CONSISTENCY_RULE,
        retestWeeks: [10, 19],
      },
    ],
  },
  {
    dayOfWeek: 3, // S2 · Wed Aug 12 — week 1 day 3
    title:
      "S2 · Baseline — Vertical press: these genuinely conflict and cannot be fully separated, so order by stakes — gate first, cheapest target absorbs the fatigue. Wrist Prep first.",
    tests: [
      {
        testName: "Wall Handstand Push-Up",
        units: "reps",
        protocol:
          "FIRST in S2 — the gate tests fresh (order by stakes). Max clean FULL-ROM reps (head to floor, full lockout); note if assisted — the 0 start depends on this. Then 5+ min rest before the floating pike. " +
          PHASE2A_RETEST_CONSISTENCY_RULE,
        retestWeeks: [10, 19],
      },
      {
        testName: "Floating Pike Push-Up",
        units: "reps",
        protocol:
          "SECOND in S2, after 5+ min rest (cheapest target absorbs the fatigue). Max strict reps — feet float ~1 ft and return. Afterward: Floating Pike Push-Up Press attempts + quality notes (currently ~2 with strong press but falls off balance) — a tracked indicator, NOT a scored target. " +
          PHASE2A_RETEST_CONSISTENCY_RULE,
        retestWeeks: [10, 19],
      },
    ],
  },
  {
    dayOfWeek: 4, // S3 · Thu Aug 13 — week 1 day 4
    title:
      "S3 · Baseline — Support isometric + admin: a max chest-to-wall hold is a shoulder isometric to failure — it needs its own slot, and it is the test most likely to contaminate a freestanding attempt if they share a morning. Wrist Prep first.",
    tests: [
      {
        testName: "Chest-to-Wall Handstand Hold",
        units: "sec",
        protocol:
          "Max hold — confirms the 30 s start. PROTOCOL REQUIRED — the score is meaningless without it. The number depends almost entirely on hand distance from the wall (hands 6\" out is near-vertical and brutal; 18\" out is a leaning plank — same named test, incomparable results): measure and RECORD hand distance, and use the IDENTICAL distance at every retest — the natural working distance sets it (do not impose a number), but lock it once measured, since the 30 s start was recorded at the distance already in use. Position standard: ribs down, glutes engaged, no lower-back arch — stacked line, not a banana. Toe contact is a brush, not a lean — pressing into the wall for support inflates the number. The hold ends when the line breaks (hips pike or lumbar arches), not when you fall off the wall. Back-to-wall (heels on wall, facing out) is NOT this test and does not substitute — it teaches the arch this target exists to eliminate. " +
          PHASE2A_RETEST_CONSISTENCY_RULE,
        retestWeeks: [10, 19],
      },
      {
        testName: "Pull-Up Max Reps",
        units: "reps",
        protocol:
          "S3 initial: DO NOT TEST — re-log at the true max 25 (hit 7/29) to correct the stale 20 baseline. Retests (weeks 10 & 19): strict pull-ups, single set to failure — the lean-mass canary. " +
          PHASE2A_RETEST_CONSISTENCY_RULE,
        retestWeeks: [10, 19],
      },
    ],
  },
];

// ── A/B/C skill sessions — programmed rotation (NOT a menu), all open with
//    Wrist Prep, ≤20 min, stop at quality drop, never to failure. Assigned
//    deterministically: Mon A · Tue B · Wed C · Thu A · Fri B · Sun C (Sat —).
const SKILL_RULES = "≤20 min · stop at quality drop · never to failure";

function skillSessionA(): Block {
  return {
    type: "straight",
    label: `PM Skill — Session A · Balance (${SKILL_RULES})`,
    exercises: [
      { name: "Wrist Prep", notes: "Opens every skill session." },
      {
        name: "Chest-to-Wall Handstand Hold",
        notes: "Accumulation — build total time at quality.",
      },
      { name: "Toe Pulls (wall)", notes: "Find the float." },
      {
        name: "Kick-up + Bail Practice",
        notes: "Only if toe pulls felt controlled.",
      },
      { name: "Pike/Hamstring Close", notes: "Close-out stretch." },
    ],
  };
}

function skillSessionB(): Block {
  return {
    type: "straight",
    label: `PM Skill — Session B · Pressing (${SKILL_RULES})`,
    exercises: [
      { name: "Wrist Prep", notes: "Opens every skill session." },
      { name: "Floating Pike Push-Up", equipment: "Parallettes" },
      {
        name: "Floating Pike Push-Up Press",
        notes: "Attempts — record quality; tracked indicator.",
      },
      { name: "Pike Compression" },
      { name: "Thoracic/Lat Close", notes: "Close-out stretch." },
    ],
  };
}

function skillSessionC(): Block {
  return {
    type: "straight",
    label: `PM Skill — Session C · Ground/Support (${SKILL_RULES})`,
    exercises: [
      { name: "Wrist Prep", notes: "Opens every skill session." },
      {
        name: "Crow → Headstand → Crow Sequence",
        notes: "CoG play.",
      },
      { name: "L-Sit Progression", equipment: "Parallettes" },
      {
        name: "Shoulder Taps (chest-to-wall)",
        notes: "Grip cue.",
      },
      { name: "Long Mobility Close" },
    ],
  };
}

const AM_WALK_BLOCK: Block = {
  type: "cardio",
  label: "Fasted AM — incline walk + AWS lectures",
  exercises: [
    {
      name: "Incline Treadmill Walk",
      durationSec: 2700,
      notes:
        "45 min @ 15% / 2.3 mph, fasted. AWS lectures on the treadmill. Concentric calf — safe daily-ish. Credits cut + AWS + Z2 base via the Program attribution rule.",
    },
  ],
};

const AWS_DESK_NOTE =
  "No AM incline walk (lower day — lift fresh); AWS DESK block instead (demos/labs/diagram-heavy sections).";

function pullUpGtgBlock(): Block {
  return {
    type: "straight",
    label: "Pull-up GTG (grease the groove)",
    exercises: [
      {
        name: "Pull-Up",
        sets: 3,
        reps: "submax",
        notes: "2–3 submax sets spread through the day — never to failure on GTG.",
      },
    ],
  };
}

function pullUpsToFailureBlock(): Block {
  return {
    type: "straight",
    label: "Pull-ups to failure (kept — you enjoy them)",
    exercises: [
      { name: "Pull-Up", sets: 2, reps: "max", notes: "2–3 sets to failure, full rest." },
    ],
    restSec: 150,
  };
}

/** The week table from the spec, as 7 DayTemplates. Day 1 = plan.startedOn
 *  (2026-08-10, a Monday), so rotation days align with calendar weekdays. */
export function buildPhase2aWeeklySplit(): DayTemplate[] {
  return [
    {
      dayOfWeek: 1,
      title: "Upper — Pressing Anchor",
      category: "upper",
      summary:
        "Fasted AM: incline walk 45' @15% 2.3mph + AWS lectures. Main: overhead + incline DB bench + accessory/TRX. Strength maintained, not built — heavy, low volume. PM: Skill Session A (Balance).",
      blocks: [
        AM_WALK_BLOCK,
        {
          type: "straight",
          label: "Overhead press anchor",
          exercises: [
            {
              name: "DB Shoulder Press",
              equipment: "Dumbbell",
              sets: 4,
              reps: "5-8",
              weightHint: "heavy, low volume (65 lb DB ceiling)",
            },
          ],
          restSec: 150,
        },
        {
          type: "straight",
          label: "Incline DB bench",
          exercises: [
            {
              name: "Incline Dumbbell Bench Press",
              equipment: "Dumbbell",
              sets: 4,
              reps: "6-10",
            },
          ],
          restSec: 120,
        },
        pullUpsToFailureBlock(),
        {
          type: "superset",
          label: "Accessory / TRX",
          rounds: 3,
          restSec: 75,
          exercises: [
            { name: "TRX Row", reps: "10-15" },
            { name: "TRX Push-Up", reps: "10-15", notes: "Handstand/pike scaling line." },
          ],
        },
        skillSessionA(),
      ],
    },
    {
      dayOfWeek: 2,
      title: "Lower — Smith Squat/RDL + Pull-up GTG",
      category: "lower",
      summary: `${AWS_DESK_NOTE} Main: Smith-loaded squat/RDL (Smith solves the 65 lb DB ceiling for loaded legs) + pull-up GTG (2–3 submax). PM: Skill Session B (Pressing).`,
      blocks: [
        {
          type: "straight",
          label: "Smith squat (loaded legs, full rest)",
          exercises: [
            {
              name: "Smith Machine Squat",
              equipment: "Smith machine",
              sets: 4,
              reps: "6-10",
              weightHint: "heavy, low volume — maintain",
            },
          ],
          restSec: 150,
        },
        {
          type: "straight",
          label: "Smith RDL",
          exercises: [
            {
              name: "Smith Machine Romanian Deadlift",
              equipment: "Smith machine",
              sets: 3,
              reps: "8-10",
            },
          ],
          restSec: 120,
        },
        pullUpGtgBlock(),
        skillSessionB(),
      ],
    },
    {
      dayOfWeek: 3,
      title: "Mobility-Forward + Light Skill",
      category: "zone2-mobility",
      summary:
        "Fasted AM: incline walk + AWS lectures. Mobility-forward day + light skill only. PM: Skill Session C (Ground/Support).",
      blocks: [
        AM_WALK_BLOCK,
        {
          type: "mobility",
          label: "Mobility block (long)",
          exercises: [
            { name: "Wrist Prep", notes: "Extra volume on the mobility day." },
            { name: "Deep Squat Hold", durationSec: 120 },
            { name: "Pike/Hamstring Stretch", durationSec: 90, notes: "Each side where applicable." },
            { name: "Thoracic Opener", reps: 10, notes: "Each side, slow." },
            { name: "Shoulder Dislocates", equipment: "Band", reps: 15 },
          ],
        },
        skillSessionC(),
      ],
    },
    {
      dayOfWeek: 4,
      title: "Upper — Vertical / HSPU Builder",
      category: "upper",
      summary:
        "Fasted AM: incline walk + AWS lectures. Main: push press / wall-pike press + weighted dips (belt). PM: Skill Session A (Balance).",
      blocks: [
        AM_WALK_BLOCK,
        {
          type: "straight",
          label: "Vertical push builder",
          exercises: [
            {
              name: "Push Press",
              equipment: "Dumbbell",
              sets: 4,
              reps: "5-8",
              weightHint: "heavy, low volume (65 lb DB ceiling)",
            },
            {
              name: "Elevated Pike Push-Up",
              notes: "Wall-pike press progression toward wall HSPU.",
            },
          ],
          restSec: 150,
        },
        {
          type: "straight",
          label: "Weighted dips (belt)",
          exercises: [
            { name: "Weighted Dip", equipment: "Weight belt", sets: 4, reps: "5-8" },
          ],
          restSec: 150,
        },
        pullUpsToFailureBlock(),
        skillSessionA(),
      ],
    },
    {
      dayOfWeek: 5,
      title: "Lower + Explosive + Pull-up GTG",
      category: "lower-power",
      summary: `${AWS_DESK_NOTE} Main: lower + explosive + pull-up GTG. PM: Skill Session B (Pressing).`,
      blocks: [
        {
          type: "straight",
          label: "Explosive (fresh, full rest)",
          exercises: [
            { name: "Jump Squat", sets: 4, reps: 5, notes: "Reset between reps." },
          ],
          restSec: 150,
        },
        {
          type: "straight",
          label: "Loaded unilateral",
          exercises: [
            {
              name: "Smith Machine Split Squat",
              equipment: "Smith machine",
              sets: 3,
              reps: "8 each leg",
            },
            {
              name: "Box Step-Up",
              equipment: "Dumbbell",
              sets: 3,
              reps: "10 each leg",
            },
          ],
          restSec: 120,
        },
        pullUpGtgBlock(),
        skillSessionB(),
      ],
    },
    {
      dayOfWeek: 6,
      title: "Long Endurance — Hike / Steps",
      category: "long-endurance",
      summary:
        "Long effort: hike (default) or 'get steps in' (winter fallback) + AWS desk block. No PM skill block today.",
      blocks: [
        {
          type: "cardio",
          label: "Long effort",
          exercises: [
            {
              name: "Hike or Long Walk",
              durationSec: 7200,
              notes:
                "Hike by default; when hikes thin out (winter), 'get steps in' — long walk / incline treadmill. AWS desk block after.",
            },
          ],
        },
      ],
    },
    {
      dayOfWeek: 7,
      title: "Active Recovery + Mobility",
      category: "rest",
      summary:
        "Optional walk + AWS. Active recovery + mobility. Weekly weigh-in lands Sun or Mon (standing rule). PM: Skill Session C (Ground/Support).",
      blocks: [
        {
          type: "mobility",
          label: "Active recovery",
          exercises: [
            { name: "Walk", durationSec: 1800, notes: "Optional, easy." },
            { name: "Light Stretching", durationSec: 900 },
          ],
        },
        skillSessionC(),
      ],
    },
  ];
}

/** Nutrition guidance per block, from the spec's descent section. The floor
 *  (1,500–1,600), the 150–155 g protein floor, unplanned high days, and
 *  no-scheduled-refeeds language are invariant; block-specific lines vary. */
function descentNutrition(blockLine: string, extraHabits: string[] = []) {
  return {
    calorieGuidance: `${blockLine} Normal day (default): 1,500–1,600 cal — where you live on the descent. Abnormal/high day: UNPLANNED, as it comes — hike / travel / event / body-driven. Eat to the occasion, log it, no guilt, no pre-scheduling. Do NOT impose scheduled refeed days.`,
    proteinTargetG: { low: 150, high: 155 },
    hydration: "Baseline hydration; electrolytes on long-effort Saturdays.",
    habits: [
      "Protein floor 150–155 g EVERY day, all tiers — muscle-sparing, non-negotiable.",
      "Fat: ~20 g weekday is fine done right; higher on abnormal days.",
      "Pull-up max is the lean-mass canary — holding 25 while weight drops = losing fat. A persistent dip at constant bodyweight = deficit too deep → eat more.",
      "Soft flag: ~10+ consecutive floor days with NO high day above them → nudge a high day in.",
      "Greek yogurt default: nonfat vanilla Chobani. Eggs counted individually. Log only what's stated.",
      ...extraHabits,
    ],
  };
}

const PHASE2A_MOBILITY_FOCUS = {
  emphasis: ["wrists", "shoulders (overhead)", "thoracic", "pike/hamstrings", "Achilles"],
  dailyMin: 12,
  notes:
    "Wrists open every skill block. Morning Achilles first-step check stays a standing item.",
};

/** Phases = spec Blocks 0–3. Phase.index is typed 1|2|3 (a legacy artifact of
 *  the 3-phase Elbert template); every consumer treats it as an opaque
 *  number (display label, React key, snapshot-diff match), so index 4 is safe
 *  at runtime — hence the single documented cast. */
export function buildPhase2aPhases(): Phase[] {
  return [
    {
      index: 1,
      name: "Block 0 — Recovery + Baselines + DEXA Prep",
      weeks: [1, 2],
      goal: "Recover, run the S1–S3 baseline split (Mon/Wed/Thu of week 1), prep the Sept 3 DEXA.",
      emphasis:
        "Aug 10–23. Ease in; each baseline session runs FRESH before other work (S1 Balance · S2 Vertical press · S3 Support isometric). Mirror Lake Aug 14–15 is SACRED TIME (not a deload) — zero training expectation; all baselines land before it.",
      nutrition: {
        calorieGuidance:
          "Eat at MAINTENANCE — recovery + baselines + DEXA-prep block. The descent starts Block 1 (Aug 24), not here.",
        proteinTargetG: { low: 150, high: 155 },
        hydration: "Baseline hydration; electrolytes on long-effort Saturdays.",
        habits: [
          "Protein floor 150–155 g EVERY day — non-negotiable, even at maintenance.",
          "Greek yogurt default: nonfat vanilla Chobani. Eggs counted individually. Log only what's stated.",
          "DEXA #1 Sept 3: fasted, AM, normally hydrated, no training that morning, not day-after-hike.",
        ],
      },
      mobility: PHASE2A_MOBILITY_FOCUS,
    },
    {
      index: 2,
      name: "Block 1 — Skill Acquisition + Moderate Deficit",
      weeks: [3, 4, 5, 6, 7, 8, 9, 10],
      goal: "Skill acquisition; rung-1 target (20 s freestanding hold) by the week-10 checkpoint.",
      emphasis:
        "Aug 24–Oct 18 (8 wk). Daily PM skill block (A/B/C rotation). Sep 4–7 Virginia = soft break, not a deload. Sep 25–27 = FORMAL DELOAD #1 (paired with the Sep 24 golf invitational).",
      nutrition: descentNutrition("Moderate deficit begins."),
      mobility: PHASE2A_MOBILITY_FOCUS,
    },
    {
      index: 3,
      name: "Block 2 — Deeper Cut + Skill Consolidation",
      weeks: [11, 12, 13, 14, 15, 16, 17],
      goal: "Deeper cut; consolidate the hold; AWS exam window opens (practice-exam checkpoint #2 ~Dec 6).",
      emphasis:
        "Oct 19–Dec 6 (7 wk). Nov 26–29 Thanksgiving = DELOAD #2 — eat at MAINTENANCE those days, not deficit; holiday + cut is the hard combo, don't white-knuckle it.",
      nutrition: descentNutrition("Deeper cut.", [
        "Thanksgiving Nov 26–29: MAINTENANCE, not deficit (deload — the one scheduled exception).",
      ]),
      mobility: PHASE2A_MOBILITY_FOCUS,
    },
    {
      // DEVIATION (shape only): index 4 exceeds the 1|2|3 union — see the
      // builder doc comment; runtime consumers treat index as opaque.
      index: 4 as Phase["index"],
      name: "Block 3 — Final Lean-Out + Rung-2 Test",
      weeks: [18, 19, 20],
      goal: "Final lean-out; rung-2 test (5 wall HSPU) — run it BEFORE Christmas travel (~Dec 20–22, preferred).",
      emphasis:
        "Dec 7–27 (rotation horizon; Program window runs to Dec 31). Dec 23–27 Christmas/Virginia travel — don't let the finish depend on a hotel.",
      nutrition: descentNutrition("Final lean-out.", [
        "No deficit chasing in the final 2 weeks before the rung-2 peak — peak performance > peak leanness.",
      ]),
      mobility: PHASE2A_MOBILITY_FOCUS,
    },
  ];
}

/** The full rotation-plan template (Plan.planJson shape). */
export function buildPhase2aRotationTemplate(): ProgramTemplate {
  return {
    name: PHASE2A_PROGRAM.name,
    totalWeeks: PHASE2A_PLAN.weeks,
    goals: [
      "Freestanding handstand — 20 s hold, then 5 wall HSPU (rungs 1+2; rung 3 deferred to Phase 2B)",
      "Reach 10% body fat (155 → ~143 lb, DEXA-anchored — weight is the proxy)",
      "Pass the AWS SAA exam (readiness-gated, ~Q1 2027)",
    ],
    phases: buildPhase2aPhases(),
    weeklySplit: buildPhase2aWeeklySplit(),
    baselineWeek: PHASE2A_BASELINE_WEEK,
    // Required template field. Repurposed for this program as the Saturday
    // long-effort winter fallback ("get steps in") — the Elbert-style hiking
    // superset injection into Day 2/5 does not apply here.
    hikingSuperset: {
      type: "superset",
      label: "Steps fallback (Saturday long-effort, winter)",
      rounds: 4,
      restSec: 75,
      exercises: [
        {
          name: "Box Step-Up",
          equipment: "Box (16-20\")",
          reps: "12-15 each leg",
          notes: "Winter fallback when a hike isn't on.",
        },
        {
          name: "Incline Treadmill Walk",
          durationSec: 600,
          notes: "Sustainable climb pace.",
        },
      ],
    },
    dailyMobility: {
      durationMin: 12,
      notes:
        "Daily. Wrists before every skill block; morning Achilles first-step check stays a standing item.",
      exercises: [
        { name: "Wrist Prep", notes: "Full circuit — opens every skill session." },
        { name: "Achilles First-Step Check", notes: "Morning standing item — note any first-step pain." },
        { name: "Deep Squat Hold", durationSec: 90 },
        { name: "Pike/Hamstring Stretch", durationSec: 60, notes: "Each side." },
        { name: "Thoracic Opener", reps: 10, notes: "Each side, slow." },
        { name: "Shoulder Dislocates", equipment: "Band", reps: 15 },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Spec v4 reconcile — baselineWeek revision, milestone data point, duplicate
// goal. Pure helpers/constants; the import script does the DB work.
// ---------------------------------------------------------------------------

/** Deterministic JSON with SORTED object keys (arrays keep order; keys with
 *  undefined values are dropped, matching JSON.stringify). Needed because
 *  Plan.planJson / Goal.targets are Postgres jsonb, which normalizes object
 *  key order — a plain JSON.stringify compare of a jsonb round-trip against a
 *  freshly built object can differ on key order alone, which would make the
 *  import's "skip when identical" checks re-write (and the baselineWeek step
 *  re-REVISE) on every run. Content-equal is what idempotency means. */
export function stableJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? "null" : stableJson(v))).join(",")}]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const parts = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`);
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** True when the live rotation plan's baselineWeek differs (content-wise)
 *  from the spec v4 S1/S2/S3 split — i.e. the reconcile revision is owed. */
export function baselineWeekNeedsReconcile(live: ProgramTemplate): boolean {
  return stableJson(live.baselineWeek ?? []) !== stableJson(PHASE2A_BASELINE_WEEK);
}

/** The reconcile revision's full snapshot: the LIVE planJson with ONLY
 *  baselineWeek (which carries all the new protocol text) replaced from the
 *  builder — any live edits elsewhere in the template are preserved. */
export function buildBaselineWeekRevisionSnapshot(live: ProgramTemplate): ProgramTemplate {
  return { ...live, baselineWeek: PHASE2A_BASELINE_WEEK };
}

/** PlanRevision.summary for the reconcile (≤200 chars per apply_plan_revision). */
export const PHASE2A_BASELINE_SPLIT_SUMMARY =
  "S1–S3 baseline split + chest-to-wall protocol (spec v4)";

/** PlanRevision.reasoning — quotes the spec's why-split paragraph verbatim. */
export const PHASE2A_BASELINE_SPLIT_REASONING =
  "Spec v4 (examples/phase2a-goals-import-spec.md, revised 2026-08-09) splits the single-session baseline battery into three sessions: " +
  "S1 Mon Aug 10 (Balance, fully fresh) — Freestanding Handstand Hold + L-Sit (Parallettes); " +
  "S2 Wed Aug 12 (Vertical press, gate first / cheapest absorbs the fatigue) — Wall Handstand Push-Up + Floating Pike Push-Up, with Floating Pike Push-Up Press attempts kept as a tracked, unscored indicator; " +
  "S3 Thu Aug 13 (Support isometric + admin) — Chest-to-Wall Handstand Hold + Pull-Up Max Reps (do NOT test — re-log at 25, stale-20 correction). " +
  'Spec, "Why split": "Five of the six tests load the same shoulder complex — freestanding hold, chest-to-wall hold, wall HSPU, floating pike push-up, floating pike press. ' +
  "Run back-to-back, everything after the second test is measured under accumulated fatigue. Start values come in artificially low, readiness under-reads for the whole block, " +
  "and the week-6 retest shows 'improvement' that is partly just a different fatigue state. Both gating targets are in this battery — a depressed gate start makes the " +
  '80-ceiling math wrong for months. Block 0 runs two full weeks; there is no reason to compress this." ' +
  "The chest-to-wall test now carries the REQUIRED hand-distance / position / toe-brush / line-break protocol (the score is meaningless without it), and every test carries the " +
  "retest protocol-consistency rule (identical order, same rests, same time of day — weeks 10 & 19 keep the same S1/S2/S3 structure). " +
  "All baselines land before Aug 14–15 (Mirror Lake); that window stays untouched.";

/** 2026-08-09 milestone on record — imported as a DATA POINT, not an S1
 *  result and not completion. dateKey is deliberately BEFORE the plan start
 *  (2026-08-10), so it can never credit the S1 initial checkpoint window
 *  (checkpointWindows' initial window starts at plan.startedOn). It also
 *  makes baseline:Freestanding Handstand Hold resolve current=10 at import
 *  (most-recent-by-date) and anchors the earliest-row auto-start at 10,
 *  agreeing with the target's explicit start. */
export const PHASE2A_MILESTONE_BASELINE = {
  testName: "Freestanding Handstand Hold",
  value: 10,
  units: "sec",
  dateKey: "2026-08-09",
  notes:
    "video-verified ~10s freestanding hold (frame est 10.7s, conservative floor 10.0) — 2nd occurrence ever; imported as data point per spec v4",
} as const;

/** Duplicate-goal cleanup owed at import (spec header ⚠): two handstand
 *  goals exist — cmsmi9k20000004laub50psio (focus, the Phase 2A rung goal —
 *  KEEP) and this old someday "Handstand" (1 target, no plan — RESOLVE).
 *  Resolution = status "abandoned" + active false + a superseded-by note.
 *  NEVER deleted — the owner may want the history. */
export const PHASE2A_DUPLICATE_GOAL = {
  id: "cmq8pz7xp000304ic0wux6r2a",
  note:
    `Superseded by ${PHASE2A_GOAL1_ID} (Phase 2A rung goal) — resolved per spec v4 duplicate-cleanup; delete manually if desired.`,
} as const;

/** Append the superseded-by note to a goal's notes — idempotent (a re-run
 *  that finds the note already present returns the input unchanged). */
export function appendDuplicateGoalNote(existing: string | null | undefined): string {
  const note = PHASE2A_DUPLICATE_GOAL.note;
  if (!existing || existing.trim().length === 0) return note;
  if (existing.includes(note)) return existing;
  return `${existing}\n${note}`;
}

// ---------------------------------------------------------------------------
// Scheduled items (checkpoints) — idempotent via @@unique([goalId, externalRef])
// ---------------------------------------------------------------------------

export type Phase2aScheduledItem = {
  /** Stable idempotency key (ScheduledItem.externalRef, unique per goal). */
  externalRef: string;
  goalKey: "bodycomp" | "aws" | "handstand";
  dateKey: string;
  type: string;
  title: string;
  detail: string;
};

export const PHASE2A_SCHEDULED_ITEMS: Phase2aScheduledItem[] = [
  {
    externalRef: "phase2a:dexa-1",
    goalKey: "bodycomp",
    dateKey: "2026-09-03",
    type: "checkpoint",
    title: "DEXA scan #1 (baseline)",
    detail:
      "Fasted, AM, normally hydrated, no training that morning, not day-after-hike. Sets the real bodyFatPct start + confirms/moves the 143 lb target.",
  },
  {
    externalRef: "phase2a:dexa-2",
    goalKey: "bodycomp",
    dateKey: "2026-10-18",
    type: "checkpoint",
    title: "DEXA scan #2 — end of Block 1",
    detail:
      "Watch LEAN MASS, not just fat %. If lean mass is dropping → slow the deficit.",
  },
  {
    externalRef: "phase2a:dexa-3",
    goalKey: "bodycomp",
    dateKey: "2026-12-28",
    type: "checkpoint",
    title: "DEXA scan #3 — confirm finish",
    detail:
      "Confirm the finish; set the baseline for the 2027 reverse diet (143 → 155 across the year).",
  },
  {
    externalRef: "phase2a:practice-exam-1",
    goalKey: "aws",
    dateKey: "2026-10-18",
    type: "checkpoint",
    title: "Practice-exam checkpoint #1 (Block 1 end)",
    detail: "Take a full practice exam; log the result as log:practice_exam_score.",
  },
  {
    externalRef: "phase2a:practice-exam-2",
    goalKey: "aws",
    dateKey: "2026-12-06",
    type: "checkpoint",
    title: "Practice-exam checkpoint #2 (Block 2 end)",
    detail:
      "If ≥ 80%, schedule the real exam — the readiness gate clears at 80.",
  },
  // v2 delta: the disruption-cluster decision, owned by Goal 1 (the rotation
  // owner — the choice reshapes ITS training density, not the other goals').
  {
    externalRef: "phase2a:cluster-decision",
    goalKey: "handstand",
    dateKey: "2026-09-15",
    type: "task",
    title: "Decide Sep 24–Oct 5 cluster strategy",
    detail:
      "Sep 24 – Oct 5 is ~8 disrupted days inside a 12-day span, mid-Block-1 (skill acquisition) — one cluster, not two independent breaks. Decide by mid-September: " +
      "(a) Absorb — one extended low-consistency stretch; hold skill frequency as the only priority (even 10 min against a wall counts), accept the rolling-window dip and let it recover honestly. " +
      "(b) Shift Deload #1 to Oct 2–5 — train through Sep 25–27 at reduced volume instead, making the second trip the real deload; better training density, but Sep 25–27 is a Virginia get-together and may not cooperate. " +
      "(c) Front-load Block 1 — push harder Sep 8–23, go in with margin.",
  },
  ...(["2026-09-01", "2026-10-01", "2026-11-01", "2026-12-01"] as const).map(
    (dk) => ({
      externalRef: `phase2a:photos-${dk.slice(0, 7)}`,
      goalKey: "bodycomp" as const,
      dateKey: dk,
      type: "task",
      title: "Progress photos (monthly)",
      detail:
        "Same bathroom/light/poses; continues the May 2 / Jun 15 / Jul 29 / Aug 9 series.",
    }),
  ),
];

// ---------------------------------------------------------------------------
// Plan-day overrides — travel & special-date windows
// ---------------------------------------------------------------------------

export type Phase2aOverride = {
  dateKey: string;
  label: string;
  /** Full DayTemplate replacement; absent = note-only override. */
  workoutJson?: DayTemplate;
  nutritionText?: string;
  mobilityText?: string;
  notes: string;
};

/** Rotation dayOfWeek for a Phase 2A dateKey (plan starts Mon 2026-08-10, so
 *  rotation days == calendar weekdays; computed from the day-offset since
 *  start to stay correct without any Date math). */
function rotationDayFor(dateKey: string): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  const [y, m, d] = dateKey.split("-").map(Number);
  // Days since 2026-08-10 via Date.UTC — pure calendar arithmetic on the
  // date parts (no timezone involvement; both endpoints are UTC midnights).
  const days = Math.round(
    (Date.UTC(y!, m! - 1, d!) - Date.UTC(2026, 7, 10)) / 86400000,
  );
  return ((((days % 7) + 7) % 7) + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

const MIRROR_LAKE_SUMMARY =
  "Mirror Lake — spreading Matt's ashes. SACRED TIME, not a deload. No training expectation, no logging, no readiness math, no makeup sessions. Matt is the friend whose death opened this program in week 2; this is the point.";

const MIRROR_LAKE_NOTES =
  "SACRED TIME, not a deload. No training expectation, no logging, no readiness math, no makeup sessions. Falls in Block 0 recovery anyway — zero conflict.";

function mirrorLakeDay(dateKey: string): DayTemplate {
  return {
    dayOfWeek: rotationDayFor(dateKey),
    title: "Mirror Lake — Matt",
    category: "rest",
    summary: MIRROR_LAKE_SUMMARY,
    blocks: [], // deliberately empty — no training expectation, not even optional movement
  };
}

function deloadDay(dateKey: string, title: string, summary: string): DayTemplate {
  return {
    dayOfWeek: rotationDayFor(dateKey),
    title,
    category: "zone2-mobility",
    summary,
    blocks: [
      {
        type: "mobility",
        label: "Light movement + mobility (optional)",
        exercises: [
          { name: "Walk", durationSec: 1800, notes: "Easy, optional." },
          { name: "Wrist Prep" },
          { name: "Pike/Hamstring Stretch", durationSec: 60, notes: "Each side." },
          { name: "Thoracic Opener", reps: 10, notes: "Each side, slow." },
        ],
      },
    ],
  };
}

export function buildPhase2aOverrides(): Phase2aOverride[] {
  const out: Phase2aOverride[] = [];

  // Mirror Lake — Aug 14–15. Sacred time; never a deload label.
  for (const dk of ["2026-08-14", "2026-08-15"]) {
    out.push({
      dateKey: dk,
      label: "Mirror Lake — Matt (sacred time)",
      workoutJson: mirrorLakeDay(dk),
      notes: MIRROR_LAKE_NOTES,
    });
  }

  // Sep 4–7 — Virginia / Labor Day: SOFT BREAK, note-only (no workout swap).
  for (const dk of ["2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07"]) {
    out.push({
      dateKey: dk,
      label: "Virginia / Labor Day (soft break)",
      nutritionText:
        "Travel — eat to the occasion and log as it comes; protein floor 150–155 g stands.",
      mobilityText:
        "Light/mobility + travel walking; skill only if a wall's available.",
      notes:
        "Virginia / Labor Day, ~wk 2 of Block 1. Too early for a formal deload — just a soft break.",
    });
  }

  // Sep 25–27 — FORMAL DELOAD #1 (Virginia get-together; pairs with the
  // Sep 24 golf invitational in Matt's honor → ~4-day down-week, mid-Block-1).
  for (const dk of ["2026-09-25", "2026-09-26", "2026-09-27"]) {
    out.push({
      dateKey: dk,
      label: "Deload #1 — Virginia get-together",
      workoutJson: deloadDay(
        dk,
        "Deload #1 — Virginia",
        "FORMAL DELOAD #1 (paired with the Sep 24 golf invitational in Matt's honor → ~4-day down-week, mid-Block-1). Light movement / mobility only.",
      ),
      notes:
        "Formal deload #1 — Virginia get-together, paired with the Sep 24 golf invitational in Matt's honor (~4-day down-week, mid-Block-1).",
    });
  }

  // Oct 2–5 — out of town, destination TBD (v2 delta): UNCERTAIN TRAINING
  // WINDOW, note-only exactly like the Sep 4–7 soft break — NO workoutJson
  // day-swap. That also keeps the calendar-windows contract intact: windows
  // derive only from day-swap titles ("Deload…"/"Mirror Lake…"), and these
  // labels/notes deliberately start with neither — plain note-only days,
  // never a band.
  for (const dk of ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"]) {
    out.push({
      dateKey: dk,
      label: "Out of town — destination TBD (uncertain window)",
      nutritionText:
        "Travel — eat at MAINTENANCE (cluster default: maintenance on all travel days in BOTH windows, deficit on the normal days between; not a refeed schedule — just not fighting two things at once). Protein floor 150–155 g stands.",
      mobilityText:
        "Skill only if space/wall allows; walk if a treadmill exists, outdoor walk if not.",
      notes:
        "Out of town, destination TBD — UNCERTAIN TRAINING WINDOW inside the Sep 24 – Oct 5 disruption cluster (starts 5 days after Deload #1 ends). No fixed expectation. Nothing scored, no makeup sessions, no readiness penalty for a gap. Do NOT schedule any baseline retest, DEXA, or practice exam in this window or the 3 days after it (through 2026-10-08).",
    });
  }

  // Nov 26–29 — DELOAD #2 (Thanksgiving / Virginia). Block 2 deep-cut —
  // MAINTENANCE these days, not deficit.
  for (const dk of ["2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]) {
    out.push({
      dateKey: dk,
      label: "Deload #2 — Thanksgiving / Virginia",
      workoutJson: deloadDay(
        dk,
        "Deload #2 — Thanksgiving",
        "DELOAD #2 (~5 wks after #1, good cadence). Light movement / mobility only.",
      ),
      nutritionText:
        "Eat at MAINTENANCE these days, not deficit — Block 2 deep-cut pauses for the holiday. Holiday + cut is the hard combo; don't white-knuckle it.",
      notes:
        "Deload #2 — Thanksgiving/Virginia (~5 wks after #1, good cadence). MAINTENANCE these days, not deficit: holiday + cut is the hard combo; don't white-knuckle it.",
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Saved meals (carry-overs)
// ---------------------------------------------------------------------------

export const PHASE2A_SAVED_MEALS = [
  {
    name: "Protein Brookie",
    items: [{ name: "Protein Brookie", qty: "1 brookie" }],
    macros: { calories: 310, fatG: 6.5, proteinG: 31, carbsG: 42.5 },
    defaultServings: 1,
  },
  {
    name: "Chipotle Protein Bowl",
    items: [
      {
        name: "Chipotle Protein Bowl",
        qty: "1 full bowl",
        notes: "Log fractions of a bowl as fractional servings (e.g. 0.5).",
      },
    ],
    macros: { calories: 670, fatG: 20, proteinG: 71, carbsG: 60 },
    defaultServings: 1,
  },
] as const;

// ---------------------------------------------------------------------------
// Standing rules (Notes, type standing_rule). The FIRST LINE of each body is
// the idempotency key — the import script skips creation when an unresolved
// standing_rule note already starts with it.
// ---------------------------------------------------------------------------

/** Weekly weigh-ins are deliberately NOT materialized as ~20 ScheduledItem
 *  rows — a standing rule carries recurring cadence today (matches how
 *  standing rules work; the coach surfaces it every session). */
export const PHASE2A_WEIGHIN_RULE = {
  type: "standing_rule" as const,
  body: [
    "Phase 2A weigh-in cadence: weekly weigh-in + waist tape (navel, fasted) every Sun or Mon, with a note.",
    "Runs the full program window (Aug 10 – Dec 31). Weight is the proxy metric for the 10% body-fat goal — log via log_measurement so weightLb readiness tracks it.",
    "Deliberately a standing rule, not 20 scheduled rows — cadence lives here; DEXA scans / photos are the dated ScheduledItems.",
  ].join("\n"),
};

export const PHASE2A_NUTRITION_RULE = {
  type: "standing_rule" as const,
  body: [
    "Phase 2A nutrition — the descent (standing rule under the Program):",
    "• Normal day (default): 1,500–1,600 cal floor — where Jerry lives on the descent. Block 0 (Aug 10–23) eats at MAINTENANCE first.",
    "• Abnormal/high day: UNPLANNED, as it comes — hike / travel / event / body-driven. Eat to the occasion, log it, no guilt, no pre-scheduling. Do NOT impose scheduled refeed days.",
    "• Protein floor: 150–155 g EVERY day, all tiers — muscle-sparing, non-negotiable.",
    "• Fat: ~20 g weekday is fine done right; higher on abnormal days.",
    "• The one watch (reactive, not planned): pull-up max is the lean-mass canary — holding 25 while weight drops = losing fat. A persistent dip at constant bodyweight = deficit too deep → eat more.",
    "• Soft flag: if ~10+ consecutive floor days stack with NO high day above them (likeliest deep-winter when hikes thin out), nudge a high day in.",
    "• No deficit chasing in any final-2-weeks-before-a-peak window.",
    "• Greek yogurt default: nonfat vanilla Chobani. Eggs counted individually. Log only what's stated.",
    "• Saved meals carried over: Protein Brookie (310/6.5F/31P/42.5C per brookie), Chipotle Protein Bowl (670/20F/71P/60C full bowl, log fractions). Honey Blend and Chick-fil-A sauce defaults exist.",
    "• Thanksgiving Nov 26–29 (deload #2): MAINTENANCE those days, not deficit.",
  ].join("\n"),
};

/** v2 delta: the Sep 24 – Oct 5 disruption cluster (spec lines 37–46) as a
 *  standing rule — cluster framing, the three options + decide-by date, the
 *  maintenance-on-travel-days nutrition default, and the rolling-window
 *  caveat. First line is deliberately distinct from the other rules' first
 *  lines (idempotency keys on body first-line). */
export const PHASE2A_CLUSTER_RULE = {
  type: "standing_rule" as const,
  body: [
    "Phase 2A Sep 24 – Oct 5 disruption cluster: golf day + Deload #1 (Sep 25–27) + the Oct 2–5 TBD trip = ~8 disrupted days inside a 12-day span, mid-Block-1 (skill acquisition, where consistency matters most) — ONE cluster, not two independent breaks.",
    "• Decide by mid-September (the Sep 15 'Decide Sep 24–Oct 5 cluster strategy' task):",
    "  (a) Absorb — treat Sep 24 – Oct 5 as one extended low-consistency stretch; hold skill frequency as the only priority (even 10 min against a wall counts), accept that the rolling-window handstand rates dip and let them recover honestly afterward.",
    "  (b) Shift Deload #1 to Oct 2–5 — train through Sep 25–27 at reduced volume instead, making the second trip the real deload. Better training density, but Sep 25–27 is a Virginia get-together and may not cooperate.",
    "  (c) Front-load Block 1 — push harder Sep 8–23, go in with margin.",
    "• Nutrition through the cluster: MAINTENANCE on all travel days in BOTH windows (Sep 25–27 and Oct 2–5), deficit on the normal days between. Not a refeed schedule — just not fighting two things at once.",
    "• Rolling-window caveat: the handstand repeatability targets score off the last 6 QUALIFYING sessions; the cluster can leave the denominator stale (mid-September sessions still counting in mid-October). Read the rates as provisional until 6 fresh sessions have accumulated post-Oct 5.",
    "• Scheduling exclusion: NO baseline retest, DEXA, or practice exam inside Oct 2–5 or the 3 days after (through Oct 8). The week-10 retest lands Oct 12–18 — outside it; keep it that way.",
  ].join("\n"),
};

/** First line of a standing-rule body = its idempotency key. */
export function standingRuleKey(rule: { body: string }): string {
  return rule.body.split("\n", 1)[0]!;
}

// ---------------------------------------------------------------------------
// Output-only notes (printed by the import script, never written)
// ---------------------------------------------------------------------------

export const PULLUP_CORRECTION_NOTE =
  "S3 note (NOT written by the import): baseline 'Pull-Up Max Reps' currently reads a stale 20 — at S3 (Thu Aug 13) do NOT test; re-log at the true max 25 (hit 7/29). Baseline results are logged as they happen; nothing is pre-seeded (the 2026-08-09 milestone hold is a historical data point on record, not an S1 result).";

/** Spec ⚠ line 85 ("Verify whether the engine resolves baseline:* as
 *  best-recorded or most-recent before S1 is logged") — VERIFIED as fact
 *  against src/lib/goal-targets.ts + src/lib/readiness.ts:
 *  resolveMetricValue('baseline:…') is MOST-RECENT-by-date ≤ the end-of-day
 *  cutoff (findFirst orderBy date desc), and computeReadiness uses the
 *  target's explicit `start` whenever present — resolveMetricStart
 *  (earliest-by-date auto-capture) only fires when `start` is absent. */
export const BASELINE_RESOLUTION_FACT =
  "VERIFIED (goal-targets.ts resolveMetricValue + readiness.ts computeReadiness): baseline:* CURRENT resolves most-recent-by-date ≤ the end-of-day cutoff — a fatigued sub-10 S1 becomes the current Freestanding Handstand Hold value until a later log replaces it (progress dips honestly), BUT the target's explicit start:10 is never auto-overwritten — auto-capture (resolveMetricStart, earliest-by-date) only fires when a target omits start.";

/** Spec ⚠ lines 130–133 ("Unverified before import" / expected import
 *  state) — VERIFIED as fact against the same modules: a log:* snapshot
 *  target with zero LogEntry rows resolves current=null, and a rolling:*
 *  tracker with ZERO qualifying sessions ever (no completed workout carrying
 *  a timed set of the tracker's exercise) also resolves current=null →
 *  untested → progress 0 in the weighted sum while its weight stays in the
 *  denominator (computeReadiness: weighted uses progress ?? 0; totalWeight
 *  includes every target), and an untested gating target is an OPEN gate
 *  (cleared requires non-null progress ≥ 1) → ceiling 80. */
export const LOG_SNAPSHOT_IMPORT_STATE_FACT =
  "VERIFIED (goal-targets.ts + readiness.ts): untested targets read 0 progress at full denominator weight — log:* snapshot targets with no rows resolve null, and the ENGINE-NATIVE rolling:hs_* trackers resolve null until the first qualifying session (a completed workout with ≥1 timed 'Freestanding Handstand Hold' set) exists — and the untested triple20 gate stays OPEN → ceiling 80 with a low raw score. That is the EXPECTED import state per spec line 133 (only the 8/9 session on record — a Baseline row, not a workout set, so it does NOT enter the rolling session universe: max at 50%, rolling measures untested). Correct and honest, not a bug. Run compute_readiness after import to confirm the weights land as intended.";

/** ROLLING FLIP — the per-session logging protocol note (printed with the
 *  other output-only notes). The old 4-write protocol (log_workout +
 *  recompute + 3× log_metric) is RETIRED: rolling:* values are engine-
 *  computed and never LogEntry rows. */
export const ROLLING_PROTOCOL_NOTE =
  "Per-session protocol (rolling flip): ONE write — log_workout with EVERY deliberate attempt as its own duration set on 'Freestanding Handstand Hold' (the canonical exercise), misses included (the triple's ≤5-attempt cap needs them). The engine computes rolling:hs_sessions_10s_of6 / rolling:hs_sessions_20s_of6 / rolling:hs_triple20_of6 natively from those sets — the recompute-and-log_metric step is RETIRED for these three (a log_metric write would create an orphan LogEntry the resolver never reads). Doctrine (gotchas §F.8): incidental holds (warmups, a wall hold between sets of something else) must NEVER be logged as 'Freestanding Handstand Hold' sets — the coach controls the qualifying-session denominator by what gets logged under that canonical name in a completed workout.";

export const BODYFAT_VERIFY_NOTE =
  "Verify after creation: run compute_readiness on the 10%-body-fat goal — bodyFatPct engine support shipped as Amendment 5 (resolveMetricValue/resolveMetricStart read Measurement.bodyFatPct); the target stays untested (progress 0-weighted) until DEXA #1 logs a value, which also auto-captures the start.";
