// src/lib/attribution.ts
//
// Auto-link engine v1 — PURE rule evaluation (#307/#308/#309, plan §4.4,
// design amendment 1 in docs/program-redesign/03-run-amendments.md).
//
// Decides which member goals an activity links to. No Prisma, no IO, no date
// math — this module is pure and client-safe (imports only the pure
// exercise-canonical module and the attribution-rules types). The DB glue
// (membership loading, ActivityGoalLink writes, idempotency) lives in
// src/lib/attribution-hooks.ts; the historical replay lives in
// scripts/backfill-attribution.ts. Both consume THESE functions so the
// matching semantics exist exactly once.
//
// Shared invariants (enforced here, relied on by every caller):
//   - Only goals that are CURRENT members of the active Program
//     (Goal.programId set) with status === "active" are ever linkable.
//     Rules may name any goalId, but a non-member / non-active id is
//     silently dropped — coach-authored Json must not be able to attach
//     activity to a goal outside the Program (or to a paused/achieved one).
//   - Output order is deterministic: member-goal order (the attachment order
//     getActiveProgramMembership returns), deduplicated.
//   - v1 is append-only: evaluators only ever SELECT goals to link; nothing
//     here (or downstream) retracts an existing link.
//   - Links drive display/badging/history — never readiness. This module is
//     not imported by readiness.ts / rarity-core.ts / goal-targets.ts.

import { canonicalExerciseName } from "@/lib/exercise-canonical";
import type { AttributionRule } from "@/lib/attribution-rules";

/** The slice of a member goal the evaluators need (subset of
 *  ActiveProgramMembership.memberGoals — same field names, so membership
 *  rows can be passed straight through). */
export interface AttributionMemberGoal {
  id: string;
  kind: string;
  status: string;
}

/** The workout-shaped inputs rule evaluation reads. */
export interface WorkoutLinkActivity {
  /** Raw logged exercise names (canonicalized in here — pass them as stored). */
  exerciseNames: readonly string[];
  /** Workout.title — null/undefined titles never match titleContains. */
  workoutTitle: string | null;
  /** Workout.source — compared EXACTLY (case-sensitive) against rule source. */
  source: string | null;
}

function activeMembers(memberGoals: readonly AttributionMemberGoal[]): AttributionMemberGoal[] {
  return memberGoals.filter((g) => g.status === "active");
}

/** Canonical, lowercased form used for all exercise-name comparisons. Both
 *  sides of every exercise comparison pass through this, so alias variants
 *  ("Pull Up", "Plank Max Hold") and case drift can never fragment a match. */
function canon(name: string): string {
  return canonicalExerciseName(name).toLowerCase();
}

/**
 * Does one coach-authored rule match this workout? A rule matches when ANY
 * of its present criteria hits (OR within the rule):
 *
 *   - titleContains:    case-insensitive substring test against the workout
 *                       title. A null title never matches.
 *   - exerciseContains: case-insensitive substring test against each exercise
 *                       name, with BOTH sides canonicalized first (so a rule
 *                       entry "pull up" hits a logged "Pull-Up Max Reps" —
 *                       both canonicalize to "Pull-Up").
 *   - source:           EXACT string match against Workout.source (no
 *                       substring, no case folding — "strong" ≠ "Strong").
 *
 * Degenerate inputs the lenient read-side parser lets through are inert:
 * empty/whitespace-only criterion strings never match (a "" substring would
 * otherwise match EVERYTHING — a hand-authored-Json footgun), and an empty
 * `match: {}` has no criteria so it matches nothing. The authoring schema
 * refuses to store these, but rows written before it (or by hand) must stay
 * harmless.
 */
function ruleMatches(rule: AttributionRule, activity: WorkoutLinkActivity): boolean {
  const m = rule.match;

  const title = activity.workoutTitle?.toLowerCase() ?? null;
  if (
    title !== null &&
    (m.titleContains ?? []).some((t) => {
      const needle = t.trim().toLowerCase();
      return needle !== "" && title.includes(needle);
    })
  ) {
    return true;
  }

  if ((m.exerciseContains ?? []).length > 0) {
    const canonicalNames = activity.exerciseNames.map(canon);
    if (
      (m.exerciseContains ?? []).some((c) => {
        const needle = canon(c);
        return needle !== "" && canonicalNames.some((n) => n.includes(needle));
      })
    ) {
      return true;
    }
  }

  const source = m.source;
  return source !== undefined && source.trim() !== "" && activity.source === source;
}

/**
 * Workout auto-linking (#307 + amendment 1): which member goals does this
 * workout link to? Two independent inputs, OR'd together:
 *
 *  (a) HINT MATCHING — per-goal `Goal.attributionHints` (string[] of exercise
 *      names that "count as training" the goal). A goal matches when the
 *      workout's canonical exercise-name set intersects the goal's
 *      canonicalized hint set. Canonicalization is records.ts's
 *      canonicalExerciseName verbatim (via exercise-canonical.ts), applied to
 *      BOTH sides, compared case-insensitively. Hints are kind-agnostic: any
 *      active member goal with hints participates (fitness or project).
 *
 *  (b) PROGRAM RULES — coach-authored `Program.attributionRules` (amendment
 *      1). Every rule that matches (see ruleMatches) contributes its goalIds.
 *      Rule goalIds that are NOT current active member goals are silently
 *      dropped — rules can never link outside the Program.
 *
 * `attributionHintsByGoal` maps goalId → RAW hints (as stored — this function
 * canonicalizes). Goals absent from the map simply have no hints.
 * `attributionRules` null means "no usable ruleset" (unset or malformed —
 * parseAttributionRules semantics); [] means an intentionally-empty one.
 * Both behave identically here: rules contribute nothing.
 *
 * The status gate ("only completed workouts get links") is deliberately NOT
 * here — it is the hooks' job (this function evaluates whatever it is given;
 * the backfill applies the same gate by filtering its query).
 */
export function evaluateWorkoutLinks(
  activity: WorkoutLinkActivity,
  memberGoals: readonly AttributionMemberGoal[],
  attributionHintsByGoal: ReadonlyMap<string, readonly string[]>,
  attributionRules: readonly AttributionRule[] | null,
): string[] {
  const candidates = activeMembers(memberGoals);
  if (candidates.length === 0) return [];

  const selected = new Set<string>();

  // (a) hint matching
  const exerciseSet = new Set(activity.exerciseNames.map(canon));
  for (const goal of candidates) {
    const hints = attributionHintsByGoal.get(goal.id) ?? [];
    if (hints.some((h) => exerciseSet.has(canon(h)))) selected.add(goal.id);
  }

  // (b) Program attributionRules
  if (attributionRules && attributionRules.length > 0) {
    const candidateIds = new Set(candidates.map((g) => g.id));
    for (const rule of attributionRules) {
      if (!ruleMatches(rule, activity)) continue;
      for (const goalId of rule.goalIds) {
        if (candidateIds.has(goalId)) selected.add(goalId);
      }
    }
  }

  // Deterministic output: member-goal order.
  return candidates.filter((g) => selected.has(g.id)).map((g) => g.id);
}

/**
 * Nutrition auto-linking (#309): a logged meal links to every ACTIVE
 * FITNESS-kind member goal — and nothing else.
 *
 * Two deliberate v1 exclusions, both consequences of the append-only policy
 * (no link retraction in v1):
 *   - project-kind member goals are NEVER linked — unconditional linking
 *     would permanently attach meals to a project goal;
 *   - Program attributionRules do NOT apply to nutrition — rules are a
 *     workout-shaped input (title/exercise/source) and letting them reach
 *     meals would permanently attach every future meal a rule matched.
 *     Nutrition rules are out of scope for v1 (owner decision, #309).
 */
export function evaluateNutritionLinks(
  memberGoals: readonly AttributionMemberGoal[],
): string[] {
  return activeMembers(memberGoals)
    .filter((g) => g.kind === "fitness")
    .map((g) => g.id);
}

/**
 * Mirror-linking (#308): Hike.goalId / LogEntry.goalId mirrored into the link
 * table. The column stays AUTHORITATIVE — the link is a read-model copy so
 * hikes and project metrics appear in the same table other activities use
 * for badging/history.
 *
 * Returns [goalId] only when that goal is a current ACTIVE member of the
 * Program; [] otherwise (null goalId, non-member, paused/achieved member).
 * Callers resolve the focus-goal fallback BEFORE calling (a null Hike.goalId
 * means "focus goal at read time" — the hook passes the resolved focus id).
 */
export function evaluateMirrorLinkGoalIds(
  goalId: string | null,
  memberGoals: readonly AttributionMemberGoal[],
): string[] {
  if (!goalId) return [];
  return activeMembers(memberGoals).some((g) => g.id === goalId) ? [goalId] : [];
}
