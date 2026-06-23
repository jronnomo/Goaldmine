// src/lib/game/types.ts
// ZERO imports from @/generated/prisma, @/lib/db, "react", or Next.js internals.
// This file is client-component-safe.

export type RuleId = string;
export type AttributeId = string; // "STR" | "END" | "MOB" | "CON" for fitness pack

export type XpEvent = {
  dateKey: string;        // "yyyy-mm-dd"
  ruleId: RuleId;
  label: string;          // "PR · Bench Press" | "Upper workout" | "Coach: …"
  xp: number;
  attribute: AttributeId | null; // null = unattributed (overall-only)
};

export type AttributeState = {
  id: AttributeId;
  label: string;          // "Strength" | "Endurance" | "Mobility" | "Consistency"
  level: number;
  xp: number;             // cumulative XP for this attribute
  xpIntoLevel: number;    // progress within current level
  xpToNext: number;       // cost to reach next level
  progress: number;       // 0..1 fraction (xpIntoLevel / xpToNext)
};

export type GameState = {
  goalKind: string | null; // null when no active program; UI hides header
  level: number;           // overall level
  xp: number;              // overall total (Σ all attr + unattributed)
  xpIntoLevel: number;
  xpToNext: number;
  progress: number;        // 0..1 (xpIntoLevel / xpToNext)
  attributes: AttributeState[];
  streak: {
    current: number;
    longest: number;
    todayCounted: boolean; // true if today has already been scored as a success
  };
  badges: UnlockedBadge[];   // all 16 sorted: unlocked first (by dateKey asc), then locked
  recentEvents: XpEvent[];   // last 30 across all attributes + unattributed, sorted desc
  questToday: QuestProjection | null; // null when no program or off-plan day
};

export type BadgeDef = {
  id: string;
  name: string;
  hint: string;           // shown when locked; describes unlock condition
  monogram: string;       // 1–2 chars rendered in the medal face (DM Serif)
  glyphFamily?: "mountain" | "flame"; // optional hand-rolled geometric glyph
};

export type UnlockedBadge = {
  def: BadgeDef;
  dateKey: string | null; // null = locked; string = date first unlocked
};

// Lightweight, Prisma-free workout row for ledger and badge context
export type WorkoutRow = {
  id: string;
  startedAt: Date;
  status: string;         // "completed" | "planned" | "skipped"
  source: string | null;  // "baseline" identifies mirror workouts
  category: string | null; // resolved from DayTemplate for this day; null = off-plan or no template
  // Modality inferred from the workout's own exercises (classifyWorkoutContent).
  // Drives trait attribution for off-plan effort; null = nothing classifiable.
  contentClass?: "mobility" | "endurance" | "strength" | null;
};

// Lightweight hike row
export type HikeRow = {
  id: string;
  date: Date;
  status: string;
  elevationFt: number;
  packWeightLb: number | null;
};

// Bonus XP row (from GameBonusXp table)
export type BonusRow = {
  id: string;
  date: Date;
  amount: number;
  reason: string;
  attribute: string | null;
  source: string;
};

// One day's ledger entry (built in memory, never queried per-day)
// Ledger covers [program.startedOn, today] only — not future plan days.
export type DayLedgerEntry = {
  dateKey: string;
  isInPlan: boolean;
  isRestDay: boolean;
  completedWorkouts: WorkoutRow[];     // status === "completed", with category assigned
  completedHikes: HikeRow[];
  loggedBaselineNames: string[];       // testName strings of Baseline rows on this day
  dueBaselineNames: string[];          // from rotation/override resolution
  hasPlannedHike: boolean;             // a Hike row with status "planned" exists today
  streakSuccess: boolean;              // per PRD §3.1.5 rules
  workoutDeferredForBaseline: boolean; // advisory — non-rest in-plan day with baselines due
};

// Quest XP projection for today
export type QuestProjection = {
  projectedXp: number;
  earnedXp: number;
  earnedEvents: XpEvent[]; // events with today's dateKey
  complete: boolean;
  bonusHints: string[];     // e.g. ["PR chance +40 STR"] shown pre-training
};

// Passed into every badge predicate and rule-pack dispatch
export type EngineContext = {
  ledger: DayLedgerEntry[];
  events: XpEvent[];
  attributeXp: Map<AttributeId, number>;
  unattributedXp: number;
  // Pre-computed aggregates to avoid O(n²) in badge predicates
  totalPRCount: number;
  totalSetCount: number;
  totalTonnageLb: number;    // Σ weightLb × reps across all completed workout sets
  totalElevationFt: number;  // Σ elevationFt of completed hikes
  // Raw slices (Prisma-free shapes)
  workoutsAll: WorkoutRow[];
  hikesAll: HikeRow[];
  // v2: carries testName+dateKey+value, not bare dates; required for badge predicates
  baselineLogged: { dateKey: string; testName: string; value: number }[];
  reviewNoteDateKeys: string[];
  bonusRows: BonusRow[];
  // Pre-computed from program template for badge evaluation:
  // Tests that must all be logged for Baseline Scholar. Tests added via baseline_ops
  // (which modifies planJson) automatically join this set.
  requiredInitialTestNames: string[];
  // Retest checkpoint weeks: each entry is one checkpoint with all tests due that week.
  // Retest Ritualist unlocks when any one checkpoint has all its tests logged.
  retestCheckpoints: { weekIndex: number; testNames: string[] }[];
  // Sorted dateKeys where ≥2 NutritionLog rows exist (for Clean Week badge).
  nutritionQualDays: string[];
  // Per-workout set counts and tonnage — keyed by workout id.
  // Kept on context so Set Centurion / Hundred-Ton Hauler badge predicates
  // can compute running totals in O(n) without re-scanning all exercises.
  setCountByWorkoutId: Map<string, number>;
  tonnageByWorkoutId: Map<string, number>;
};

// Attribute definition inside a rule pack
export type AttributeDef = {
  id: AttributeId;
  label: string;       // "Strength"
  feedsText: string;   // "Completed lifts, volume, PRs" — displayed on /character
};

// Rule pack — per goal kind
export type GameRulePack = {
  goalKind: string;
  attributes: AttributeDef[];
};

// Entry point options — only used for computeGameStateFromData (the pure core, for testing).
// The exported computeGameState() takes no arguments; see §4.13.
export type ComputeGameStateOpts = {
  now?: Date; // defaults to new Date(); injectable for isolation/testing of pure core only
};
