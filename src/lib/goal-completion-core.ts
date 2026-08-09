// src/lib/goal-completion-core.ts
//
// Pure, client-safe core for goal completion: the versioned
// GoalCompletionSnapshot (persisted by completeGoalCore at complete_goal
// time) and the versioned GoalRetrospective (written by the post-goal
// reflection tool, log_goal_retrospective). NO Prisma imports — mirrors the
// readiness.ts / rarity-core.ts split of "pure math here, IO done by the
// caller" (goal-completion.ts, Stage 1). Date math only via
// @/lib/calendar-core (never @/lib/calendar, which pulls in Prisma).
//
// The snapshot stores INPUTS (per-target start/final/met, weeks basis,
// readiness, feasibility tier, days elapsed) — the engine derives XP live
// from `xpBasis` (see game/rules.ts goalAchievedXp). `xpAwardedAtCompletion`
// is a display/narration convenience only; it is never read back as the
// source of truth for XP.

import { dateKey, parseDateKey } from "@/lib/calendar-core";

// ─────────────────────────────────────────────────────────
// GoalCompletionSnapshot v1
// ─────────────────────────────────────────────────────────

export type GoalCompletionSnapshot = {
  version: 1;
  completedDateKey: string; // yyyy-mm-dd USER_TZ
  capturedAt: string; // ISO
  backdated: boolean;
  objective: string; // frozen — survives renames
  kind: string; // "fitness" | "project"
  daysElapsed: number; // createdAt → completedAt via calendar-core
  readiness: {
    score: number;
    rawScore: number;
    ceiling: number;
    coverage: { tested: number; total: number };
    openGateCount: number;
  } | null;
  /**
   * Frozen readiness-over-time (weekEnd→dateKey, USER_TZ), captured ONCE at
   * complete_goal time (goal-completion.ts's computeCompletionSnapshot, via
   * computeReadinessSeriesSampled) — never live-recomputed for an achieved
   * goal (R9). Optional so version stays 1: absent means either a zero-target
   * goal (no targets to build a series from) or a legacy pre-freeze
   * completion — the trophy page degrades to a "reopen and re-complete to
   * capture the arc" hint in either case. Never assume absent === legacy.
   */
  readinessSeries?: Array<{ dateKey: string; score: number }>;
  /**
   * The goal.achieved badge/level diff (REQ-008/V5), captured by
   * completeGoalCore via a computeGameStateFresh() pre/post-transaction diff
   * — never recomputed live on read (R9). Optional so version stays 1:
   * ABSENT means either a legacy pre-capture completion (including the
   * founder's own Mt. Elbert row) or a completion whose best-effort
   * second write (see goal-completion.ts) failed — both degrade the same
   * way: the monument omits the badge-medals/level-crossing blocks rather
   * than recomputing (that would violate R9 and double-pay the full
   * lifetime-history cost engine.ts's computeGameStateFresh requires —
   * see architecture-critique.md C5). Isolate-drop parsed exactly like
   * readinessSeries (see isCeremony below) — a malformed value omits ONLY
   * this field, never fails the whole snapshot parse.
   */
  ceremony?: {
    badgesUnlocked: Array<{ id: string; name: string }>;
    levelBefore: number;
    levelAfter: number;
  };
  targets: Array<{
    metric: string;
    label: string;
    units: string;
    start: number | null;
    final: number | null;
    target: number;
    progress: number | null;
    met: boolean;
  }>;
  targetsMet: number;
  targetsTotal: number;
  feasibilityTierAtCompletion: string | null;
  coachFeasibilityTier: string | null;
  plan: { planId: string | null; weeksTotal: number | null; weeksElapsed: number | null };
  xpBasis: { weeks: number; targetsMet: number }; // engine derives XP from THESE
  xpAwardedAtCompletion: number; // narration/display convenience only
};

/**
 * Pre-fetched facts the caller (goal-completion.ts's computeCompletionSnapshot,
 * Stage 1) assembles before calling buildCompletionSnapshot. Every field is a
 * plain value — no Prisma types — so this stays pure/client-safe.
 */
export type BuildCompletionSnapshotInputs = {
  goal: {
    objective: string;
    kind: string;
    createdAt: Date;
  };
  /** The (possibly backdated) completion instant — end-of-day USER_TZ, per the caller's convention. */
  completedAt: Date;
  /** dateKey(completedAt) — passed in rather than re-derived so the caller's rounding is authoritative. */
  completedDateKey: string;
  /** The instant the snapshot is being built (i.e. "now"). Drives `backdated` and `capturedAt`. */
  capturedAt: Date;
  /** Live readiness result, or null for a zero-target goal. */
  readiness: GoalCompletionSnapshot["readiness"];
  /**
   * Live-computed frozen series (see GoalCompletionSnapshot.readinessSeries).
   * Omit (undefined) for a zero-target goal — the caller never builds a
   * series when there are no targets to sample against.
   */
  readinessSeries?: GoalCompletionSnapshot["readinessSeries"];
  /**
   * Optional passthrough for the goal.achieved badge/level diff (REQ-008).
   * `computeCompletionSnapshot` never supplies this — the diff can only be
   * computed AFTER completeGoalCore's transaction commits (the badge
   * predicates read the just-archived goal). completeGoalCore instead calls
   * this same builder a second time, post-commit, with `ceremony` supplied,
   * to produce the enriched snapshot it writes back. Omit (undefined) for
   * every other caller — the field is spread-when-defined, same convention
   * as readinessSeries above.
   */
  ceremony?: GoalCompletionSnapshot["ceremony"];
  /** Per-target rows — pre-resolved start/final/target/progress values. */
  targets: Array<{
    metric: string;
    label: string;
    units: string;
    start: number | null;
    final: number | null;
    target: number;
    progress: number | null;
  }>;
  feasibilityTierAtCompletion: string | null;
  coachFeasibilityTier: string | null;
  plan: { planId: string | null; weeksTotal: number | null; startedOn: Date | null };
  /** Narration/display convenience only — the engine independently derives real XP from xpBasis. */
  xpAwardedAtCompletion: number;
};

// Whole-day difference via dateKey round-tripping (mirrors compare-core.ts's
// daysBetweenKeys) — avoids DST/time-of-day shear from raw millisecond math.
function daysBetween(a: Date, b: Date): number {
  const ms = parseDateKey(dateKey(b)).getTime() - parseDateKey(dateKey(a)).getTime();
  return Math.round(ms / 86_400_000);
}

// Full (floor) weeks between two dates, clamped to 0 (never negative — a plan
// that "started" after the completion date is a data anomaly, not a debt).
function fullWeeksElapsed(start: Date, end: Date): number {
  const days = daysBetween(start, end);
  return days > 0 ? Math.floor(days / 7) : 0;
}

/**
 * Pure assembly of a GoalCompletionSnapshot from pre-fetched facts. No IO —
 * `inputs.readiness`/`inputs.targets`/`inputs.plan` must already be resolved
 * by the caller (computeCompletionSnapshot).
 *
 * `met` = progress !== null && progress >= 1 (mirrors rarity-core's "met" verdict).
 * `backdated` = completedDateKey < dateKey(capturedAt).
 * Weeks basis (xpBasis.weeks) = min(plan.weeksTotal, fullWeeksElapsed(startedOn→completedAt))
 * when a plan is present; fallback floor(daysElapsed/7) when plan-less
 * (no startedOn, or no weeksTotal).
 */
export function buildCompletionSnapshot(
  inputs: BuildCompletionSnapshotInputs,
): GoalCompletionSnapshot {
  const capturedAt = inputs.capturedAt.toISOString();
  const capturedDateKey = dateKey(inputs.capturedAt);
  const backdated = inputs.completedDateKey < capturedDateKey;

  const daysElapsed = daysBetween(inputs.goal.createdAt, inputs.completedAt);

  const targets: GoalCompletionSnapshot["targets"] = inputs.targets.map((t) => ({
    metric: t.metric,
    label: t.label,
    units: t.units,
    start: t.start,
    final: t.final,
    target: t.target,
    progress: t.progress,
    met: t.progress !== null && t.progress >= 1,
  }));
  const targetsMet = targets.filter((t) => t.met).length;
  const targetsTotal = targets.length;

  const weeksElapsed =
    inputs.plan.startedOn !== null
      ? fullWeeksElapsed(inputs.plan.startedOn, inputs.completedAt)
      : null;

  const xpBasisWeeks =
    inputs.plan.weeksTotal !== null && weeksElapsed !== null
      ? Math.min(inputs.plan.weeksTotal, weeksElapsed)
      : Math.floor(daysElapsed / 7);

  return {
    version: 1,
    completedDateKey: inputs.completedDateKey,
    capturedAt,
    backdated,
    objective: inputs.goal.objective,
    kind: inputs.goal.kind,
    daysElapsed,
    readiness: inputs.readiness,
    ...(inputs.readinessSeries !== undefined ? { readinessSeries: inputs.readinessSeries } : {}),
    ...(inputs.ceremony !== undefined ? { ceremony: inputs.ceremony } : {}),
    targets,
    targetsMet,
    targetsTotal,
    feasibilityTierAtCompletion: inputs.feasibilityTierAtCompletion,
    coachFeasibilityTier: inputs.coachFeasibilityTier,
    plan: {
      planId: inputs.plan.planId,
      weeksTotal: inputs.plan.weeksTotal,
      weeksElapsed,
    },
    xpBasis: { weeks: xpBasisWeeks, targetsMet },
    xpAwardedAtCompletion: inputs.xpAwardedAtCompletion,
  };
}

// ─────────────────────────────────────────────────────────
// Defensive parsers — hand-rolled type guards (no runtime schema lib),
// matching rarity-core.ts's parseCoachFeasibility style.
// ─────────────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isNullableString(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}

function isNullableNumber(v: unknown): v is number | null {
  return v === null || typeof v === "number";
}

function isReadiness(v: unknown): v is GoalCompletionSnapshot["readiness"] {
  if (v === null) return true;
  if (!isPlainObject(v)) return false;
  if (typeof v.score !== "number") return false;
  if (typeof v.rawScore !== "number") return false;
  if (typeof v.ceiling !== "number") return false;
  if (typeof v.openGateCount !== "number") return false;
  if (!isPlainObject(v.coverage)) return false;
  if (typeof v.coverage.tested !== "number") return false;
  if (typeof v.coverage.total !== "number") return false;
  return true;
}

function isTargetRow(v: unknown): v is GoalCompletionSnapshot["targets"][number] {
  if (!isPlainObject(v)) return false;
  return (
    typeof v.metric === "string" &&
    typeof v.label === "string" &&
    typeof v.units === "string" &&
    isNullableNumber(v.start) &&
    isNullableNumber(v.final) &&
    typeof v.target === "number" &&
    isNullableNumber(v.progress) &&
    typeof v.met === "boolean"
  );
}

function isPlan(v: unknown): v is GoalCompletionSnapshot["plan"] {
  if (!isPlainObject(v)) return false;
  return (
    isNullableString(v.planId) &&
    isNullableNumber(v.weeksTotal) &&
    isNullableNumber(v.weeksElapsed)
  );
}

function isXpBasis(v: unknown): v is GoalCompletionSnapshot["xpBasis"] {
  if (!isPlainObject(v)) return false;
  return typeof v.weeks === "number" && typeof v.targetsMet === "number";
}

function isReadinessSeriesPoint(v: unknown): v is { dateKey: string; score: number } {
  if (!isPlainObject(v)) return false;
  return typeof v.dateKey === "string" && typeof v.score === "number";
}

/**
 * S8 (architecture-blueprint-v2.md): validated in ISOLATION from the rest of
 * the snapshot. A malformed readinessSeries (non-array, or any element
 * failing isReadinessSeriesPoint) must never fail the whole parse — it drops
 * ONLY this optional field, degrading to the legacy "reopen and re-complete"
 * hint while every other field on the trophy card still renders.
 */
function isReadinessSeries(v: unknown): v is Array<{ dateKey: string; score: number }> {
  return Array.isArray(v) && v.every(isReadinessSeriesPoint);
}

function isBadgeRow(v: unknown): v is { id: string; name: string } {
  if (!isPlainObject(v)) return false;
  return typeof v.id === "string" && typeof v.name === "string";
}

/**
 * REQ-008 (V5): validated in ISOLATION from the rest of the snapshot,
 * mirroring isReadinessSeries exactly. A malformed `ceremony` (non-object,
 * a non-array badgesUnlocked, a malformed badge row, or a non-number
 * level) must never fail the whole parse — it drops ONLY this optional
 * field, degrading to "omit the badge-medals/level-crossing blocks" while
 * every other field on the trophy card still renders.
 */
function isCeremony(v: unknown): v is GoalCompletionSnapshot["ceremony"] {
  if (!isPlainObject(v)) return false;
  if (!Array.isArray(v.badgesUnlocked) || !v.badgesUnlocked.every(isBadgeRow)) return false;
  if (typeof v.levelBefore !== "number") return false;
  if (typeof v.levelAfter !== "number") return false;
  return true;
}

/**
 * Defensive parse of a raw JSON value (e.g. Goal.completionSnapshot) into a
 * typed GoalCompletionSnapshot, or null. Any missing/mistyped field, a
 * non-object, or a version other than 1 fails closed to null — callers
 * (engine.ts, /goals pages, generate_completion_card) must treat null as
 * "no usable snapshot" (base-XP fallback / degraded UI), never throw.
 */
export function parseCompletionSnapshot(json: unknown): GoalCompletionSnapshot | null {
  if (!isPlainObject(json)) return null;
  const r = json;
  if (r.version !== 1) return null;
  if (typeof r.completedDateKey !== "string") return null;
  if (typeof r.capturedAt !== "string") return null;
  if (typeof r.backdated !== "boolean") return null;
  if (typeof r.objective !== "string") return null;
  if (typeof r.kind !== "string") return null;
  if (typeof r.daysElapsed !== "number") return null;
  if (!isReadiness(r.readiness)) return null;
  if (!Array.isArray(r.targets) || !r.targets.every(isTargetRow)) return null;
  if (typeof r.targetsMet !== "number") return null;
  if (typeof r.targetsTotal !== "number") return null;
  if (!isNullableString(r.feasibilityTierAtCompletion)) return null;
  if (!isNullableString(r.coachFeasibilityTier)) return null;
  if (!isPlan(r.plan)) return null;
  if (!isXpBasis(r.xpBasis)) return null;
  if (typeof r.xpAwardedAtCompletion !== "number") return null;

  const snapshot: GoalCompletionSnapshot = {
    version: 1,
    completedDateKey: r.completedDateKey,
    capturedAt: r.capturedAt,
    backdated: r.backdated,
    objective: r.objective,
    kind: r.kind,
    daysElapsed: r.daysElapsed,
    readiness: r.readiness as GoalCompletionSnapshot["readiness"],
    targets: r.targets as GoalCompletionSnapshot["targets"],
    targetsMet: r.targetsMet,
    targetsTotal: r.targetsTotal,
    feasibilityTierAtCompletion: r.feasibilityTierAtCompletion,
    coachFeasibilityTier: r.coachFeasibilityTier,
    plan: r.plan as GoalCompletionSnapshot["plan"],
    xpBasis: r.xpBasis as GoalCompletionSnapshot["xpBasis"],
    xpAwardedAtCompletion: r.xpAwardedAtCompletion,
  };

  // Isolated optional-field validation (S8) — see isReadinessSeries. A
  // malformed value just omits the field; it never nulls the whole parse.
  if (r.readinessSeries !== undefined && isReadinessSeries(r.readinessSeries)) {
    snapshot.readinessSeries = r.readinessSeries;
  }

  // Same isolate-drop treatment for `ceremony` (REQ-008/V5) — see isCeremony.
  if (r.ceremony !== undefined && isCeremony(r.ceremony)) {
    snapshot.ceremony = r.ceremony;
  }

  return snapshot;
}

// ─────────────────────────────────────────────────────────
// GoalRetrospective v1
// ─────────────────────────────────────────────────────────

export type GoalRetrospective = {
  version: 1;
  updatedAt: string; // ISO
  authoredWith: "user" | "user+coach";
  reflection: string; // the reflection narrative, in the user's voice
  wins?: string[];
  challenges?: string[];
  lessons?: string[];
  nextSteps?: string[];
};

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/**
 * Defensive parse of a raw JSON value (Goal.retrospective) into a typed
 * GoalRetrospective, or null. Same fail-closed style as
 * parseCompletionSnapshot — human-authored content that survives reopen/
 * re-completion, so a bad row degrades to "no reflection yet", never a throw.
 */
export function parseGoalRetrospective(json: unknown): GoalRetrospective | null {
  if (!isPlainObject(json)) return null;
  const r = json;
  if (r.version !== 1) return null;
  if (typeof r.updatedAt !== "string") return null;
  if (r.authoredWith !== "user" && r.authoredWith !== "user+coach") return null;
  if (typeof r.reflection !== "string") return null;
  if (r.wins !== undefined && !isStringArray(r.wins)) return null;
  if (r.challenges !== undefined && !isStringArray(r.challenges)) return null;
  if (r.lessons !== undefined && !isStringArray(r.lessons)) return null;
  if (r.nextSteps !== undefined && !isStringArray(r.nextSteps)) return null;

  const out: GoalRetrospective = {
    version: 1,
    updatedAt: r.updatedAt,
    authoredWith: r.authoredWith,
    reflection: r.reflection,
  };
  if (r.wins !== undefined) out.wins = r.wins as string[];
  if (r.challenges !== undefined) out.challenges = r.challenges as string[];
  if (r.lessons !== undefined) out.lessons = r.lessons as string[];
  if (r.nextSteps !== undefined) out.nextSteps = r.nextSteps as string[];
  return out;
}
