// src/lib/recap-caption.test.ts
// Pure unit tests for the recap caption composer.
//
// recap-caption.ts uses `import type` only from recap.ts — recap.ts never loads
// at test time. The vi.mock below is for API-surface consistency ONLY (dual-export:
// prisma + getDb); it is inert — composeCaption never calls prisma or getDb.
// If this test ever throws "DATABASE_URL is not set", a runtime import from
// recap.ts has snuck in; fix the import — do NOT rely on the mock to silence it.

import { describe, it, expect, vi } from "vitest";

// Dual-export: @/lib/db exports both `prisma` and `getDb` — mock both for module-surface consistency.
vi.mock("@/lib/db", () => ({ prisma: {}, getDb: vi.fn() }));
import { composeCaption } from "@/lib/recap-caption";
import type { WeeklyRecap, RecapHighlight } from "@/lib/recap";

// ─── Fixture A: Fitness ───────────────────────────────────────────────────────
// 4 workouts, 5,370 lb volume, 7 PRs, elevation null, PR highlight, 12-day streak.

const FITNESS_RECAP: WeeklyRecap = {
  weekStart: new Date("2026-06-09"), // composer never reads — any Date is fine
  weekEnd: new Date("2026-06-15"),   // composer never reads
  weekOffset: 0,
  dateRangeLabel: "Jun 9 – Jun 15",
  header: {
    programWeek: 7,
    dayOfProgram: 46,
    totalProgramDays: 84,
    weeksToTarget: null,
    targetDateLabel: null,
  },
  goal: {
    id: "goal-fitness-1",
    objective: "Summit Mt. Elbert via Black Cloud Trail",
    progressPct: 62,
    topMetricLabel: "VO2max",
    kind: "fitness",
    coverage: { tested: 3, total: 4 },
    openGateCount: 0,
  },
  goalState: "has-data",
  workoutsCompleted: 4,
  volumeLb: 5370,
  prCount: 7,
  prs: [],
  hikeElevationFt: null,
  streakDays: 12,
  instagramHandle: null,
  noProgram: false,
  emptyWeek: false,
  highlights: [],
  statSlots: [
    { key: "workouts",  label: "WORKOUTS",  value: "4",        isNull: false },
    { key: "volume",    label: "VOLUME",    value: "5,370 lb", isNull: false },
    { key: "prs",       label: "NEW PRs",   value: "7",        isNull: false },
    { key: "elevation", label: "ELEVATION", value: "—",        isNull: true  }, // null → skipped
  ],
};

const PR_HIGHLIGHT: RecapHighlight = {
  id: "pr:Goblet Squat",
  kind: "pr",
  icon: "🏆",
  label: "Goblet Squat",
  meta: "65 lb",
  sub: "new PR",
};

// ─── Fixture B: Project ───────────────────────────────────────────────────────
// MRR null → skipped, MILESTONES 0/7 present, no highlight, streak 0.

const PROJECT_RECAP: WeeklyRecap = {
  weekStart: new Date("2026-06-09"),
  weekEnd: new Date("2026-06-15"),
  weekOffset: 0,
  dateRangeLabel: "Jun 9 – Jun 15",
  header: {
    programWeek: null,       // no fitness plan
    dayOfProgram: null,
    totalProgramDays: null,
    weeksToTarget: 15,       // project path
    targetDateLabel: "Sep 30",
  },
  goal: {
    id: "goal-project-1",
    objective: "Ship Chewgether to the App Store",
    progressPct: null,
    topMetricLabel: null,
    kind: "project",
    coverage: null,
    openGateCount: 0,
  },
  goalState: "no-targets",
  workoutsCompleted: 0,
  volumeLb: null,
  prCount: 0,
  prs: [],
  hikeElevationFt: null,
  streakDays: 0,
  instagramHandle: null,
  noProgram: true,
  emptyWeek: false, // has milestone progress even without workouts
  highlights: [],
  statSlots: [
    { key: "mrr",        label: "MRR",        value: "—",   isNull: true  }, // null → skipped
    { key: "milestones", label: "MILESTONES",  value: "0/7", isNull: false },
  ],
};

// ─── Fixture C: Empty week ────────────────────────────────────────────────────
// emptyWeek: true with non-null statSlots — statSlots must be ignored.

const EMPTY_WEEK_RECAP: WeeklyRecap = {
  weekStart: new Date("2026-06-09"),
  weekEnd: new Date("2026-06-15"),
  weekOffset: 0,
  dateRangeLabel: "Jun 9 – Jun 15",
  header: {
    programWeek: 7,
    dayOfProgram: 46,
    totalProgramDays: 84,
    weeksToTarget: null,
    targetDateLabel: null,
  },
  goal: {
    id: "goal-fitness-1",
    objective: "Summit Mt. Elbert via Black Cloud Trail",
    progressPct: null,
    topMetricLabel: null,
    kind: "fitness",
    coverage: null,
    openGateCount: 0,
  },
  goalState: "has-data",
  workoutsCompleted: 0,
  volumeLb: null,
  prCount: 0,
  prs: [],
  hikeElevationFt: null,
  streakDays: 0,
  instagramHandle: null,
  noProgram: false,
  emptyWeek: true,    // ← the key flag
  highlights: [],
  statSlots: [        // present but MUST be ignored when emptyWeek=true
    { key: "workouts",  label: "WORKOUTS",  value: "0", isNull: false },
    { key: "volume",    label: "VOLUME",    value: "—", isNull: true  },
    { key: "prs",       label: "NEW PRs",   value: "0", isNull: false },
    { key: "elevation", label: "ELEVATION", value: "—", isNull: true  },
  ],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("composeCaption", () => {
  // ── Fixture A: Fitness ──────────────────────────────────────────────────────

  it("fitness: correct opener, highlight with sub, stats without null slot, streak, hashtag", () => {
    const caption = composeCaption(FITNESS_RECAP, PR_HIGHLIGHT);

    // Opener: program-week frame for fitness goal
    expect(caption).toContain("Week 7 · Day 46");
    expect(caption).toContain("Summit Mt. Elbert via Black Cloud Trail"); // objective passthrough (data, not hardcode)

    // Highlight — PRD template: "${icon} ${label} — ${sub}"
    expect(caption).toContain("🏆 Goblet Squat — 65 lb — new PR");

    // Stats — goal-generic: labels from statSlots, null slot skipped
    expect(caption).toContain("WORKOUTS 4 · VOLUME 5,370 lb · NEW PRs 7");
    expect(caption).not.toContain("ELEVATION"); // isNull=true → must not appear

    // Streak
    expect(caption).toContain("🔥 12-day streak");

    // Hashtags
    expect(caption).toContain("#buildinpublic");
    expect(caption).toContain("#fitness");
    expect(caption).toContain("#goaldmine");

    // Length invariant
    expect(caption.length).toBeLessThanOrEqual(2200);
  });

  // ── Fixture B: Project ──────────────────────────────────────────────────────

  it("project: weeks-to-target opener, null MRR skipped, no highlight, no streak, #projectgoal", () => {
    const caption = composeCaption(PROJECT_RECAP, null);

    // Opener: weeks-to-target frame for project goal
    expect(caption).toContain("15 weeks to Sep 30");
    expect(caption).toContain("Ship Chewgether to the App Store");

    // Stats — MRR null → must not appear; MILESTONES present
    expect(caption).not.toContain("MRR");
    expect(caption).toContain("MILESTONES 0/7");

    // Streak skipped (streakDays 0)
    expect(caption).not.toContain("🔥");

    // No highlight section
    expect(caption).not.toContain("🏆");

    // Hashtags
    expect(caption).toContain("#projectgoal");
    expect(caption).toContain("#goaldmine");
    expect(caption).not.toContain("#fitness");

    expect(caption.length).toBeLessThanOrEqual(2200);
  });

  // ── Fixture C: Empty week ───────────────────────────────────────────────────

  it("empty-week: quiet-week copy replaces stats, no highlight, no streak", () => {
    const caption = composeCaption(EMPTY_WEEK_RECAP, null);

    // Quiet week copy — honest, no fake stats
    expect(caption).toContain("A quiet week — back at it.");

    // Stats must NOT appear even though statSlots has non-null values (emptyWeek=true overrides)
    expect(caption).not.toContain("WORKOUTS");
    expect(caption).not.toContain("NEW PRs");

    // Streak skipped
    expect(caption).not.toContain("🔥");

    // No highlight
    expect(caption).not.toContain("🏆");
    expect(caption).not.toContain("⭐");

    // Hashtags still present
    expect(caption).toContain("#goaldmine");

    expect(caption.length).toBeLessThanOrEqual(2200);
  });

  // ── Truncation (FIX-1: objective "A".repeat(2200) — actually fires the hard-trim) ──

  it("caption never exceeds 2200 chars — truncation hard-trim exercised", () => {
    // "A".repeat(2200) objective ensures the assembled caption far exceeds 2200.
    // Without this length, the fast-path returns early and the truncation code is dead.
    const longObjRecap: WeeklyRecap = {
      ...FITNESS_RECAP,
      goal: { ...FITNESS_RECAP.goal!, objective: "A".repeat(2200) },
    };
    const caption = composeCaption(longObjRecap, PR_HIGHLIGHT);
    expect(caption.length).toBeLessThanOrEqual(2200);
    // The ellipsis is the canary: if truncation never fired, caption ends with "#goaldmine"
    expect(caption.endsWith("…")).toBe(true);
  });

  // ── Invariant: no-goal ──────────────────────────────────────────────────────

  it("no-goal: opener is dateRangeLabel, hashtags contain no kind tag", () => {
    const noGoalRecap: WeeklyRecap = {
      ...FITNESS_RECAP,
      goal: null,
      goalState: "no-goal",
      header: { programWeek: null, dayOfProgram: null, totalProgramDays: null, weeksToTarget: null, targetDateLabel: null },
      statSlots: [],
      streakDays: 0,
      emptyWeek: false,
    };
    const caption = composeCaption(noGoalRecap, null);
    expect(caption).toContain("Jun 9 – Jun 15"); // dateRangeLabel
    expect(caption).not.toContain("#fitness");
    expect(caption).not.toContain("#projectgoal");
    expect(caption).toContain("#buildinpublic");
    expect(caption).toContain("#goaldmine");
  });

  // ── Invariant: all-null statSlots ───────────────────────────────────────────

  it("all-null statSlots: stats section entirely absent — no dangling separator", () => {
    const allNullRecap: WeeklyRecap = {
      ...PROJECT_RECAP,
      statSlots: [
        { key: "mrr", label: "MRR", value: "—", isNull: true },
      ],
      emptyWeek: false,
    };
    const caption = composeCaption(allNullRecap, null);
    expect(caption).not.toContain("MRR");
    // No triple newlines (which would imply an empty section was pushed)
    expect(caption).not.toMatch(/\n\n\n/);
  });

  // ── Invariant: highlight without sub ────────────────────────────────────────

  it("highlight without sub: no dangling ' — ' suffix", () => {
    const noSubHighlight: RecapHighlight = {
      id: "hike:test",
      kind: "hike",
      icon: "⛰️",
      label: "Bear Peak",
      meta: "8.2 mi · 3,768 ft",
      sub: null,
    };
    const caption = composeCaption(FITNESS_RECAP, noSubHighlight);
    expect(caption).toContain("⛰️ Bear Peak — 8.2 mi · 3,768 ft");
    // Must not have a trailing " — " from a null sub
    expect(caption).not.toContain("3,768 ft — \n");
  });

  // ── Invariant: project goal + fitness plan (both programWeek + weeksToTarget non-null) ──

  it("project goal with active fitness plan: uses weeks-to-target frame, not program-week", () => {
    // FIX-3: when goal.kind === "project" and BOTH header fields are non-null,
    // the opener must use the weeks-to-target frame (project wins over program-week).
    const projectWithPlan: WeeklyRecap = {
      ...PROJECT_RECAP,
      header: {
        programWeek: 7,      // fitness plan IS active
        dayOfProgram: 46,
        totalProgramDays: 84,
        weeksToTarget: 15,   // AND project target date is set
        targetDateLabel: "Sep 30",
      },
    };
    const caption = composeCaption(projectWithPlan, null);
    expect(caption).toContain("15 weeks to Sep 30"); // project frame wins
    expect(caption).not.toContain("Week 7 · Day 46"); // fitness frame must NOT appear
  });
});
