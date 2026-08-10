// Focus-goal, rotation-owner, and active-goal resolution.
//
// POST-#297 MODEL (isFocus sweep, S7): "the current goal" is the goal that
// OWNS the active rotation — the active Program's active Plan's goal — not
// the deprecated isFocus flag. getRotationOwnerGoal() below is the shared
// accessor every swept site (calendar.ts, plan-lint, MCP tools, the XP
// engine's primary path) resolves through.
//
// "Focus" (isFocus=true) survives ONLY as (a) the documented zero-Program-rows
// compat path inside getRotationOwnerGoal, and (b) a display/ordering field
// (list_goals, goal-identity slot sort). It is no longer a general-purpose
// "current goal" signal.
//
// When multiple goals are stuck with isFocus=true (bad state), readers use
// findFirst(orderBy: { updatedAt: "desc" }) — deterministic winner, mirrors the
// existing active-goal convention in calendar.ts and program.ts.

import { getDb } from "@/lib/db";
import { getActiveProgram } from "@/lib/program";

export type FocusGoalRow = {
  id: string;
  objective: string;
  targetDate: Date | null;
  kind: string;
  isFocus: boolean;
  legend: unknown;
};

export type ActiveGoalWithPlan = {
  id: string;
  objective: string;
  targetDate: Date | null;
  kind: string;
  isFocus: boolean;
  legend: unknown;
  plans: Array<{
    id: string;
    startedOn: Date;
    endsOn: Date;
    weeks: number;
    planJson: unknown;
  }>;
};

/**
 * ⚠ LEGACY FALLBACK ONLY (#297). Returns the focus goal (isFocus=true), or
 * null when no goal is focused. Deterministically picks the
 * most-recently-updated if multiple are stuck isFocus=true.
 *
 * This is the documented zero-Program-rows compat path — the query tenants
 * who never adopted Programs still resolve "the current goal" through (via
 * getRotationOwnerGoal below). It is NOT a general-purpose "current goal"
 * accessor: under a Program the goal that drives the day is the rotation
 * owner (the active Program's active Plan's goal), which may not carry
 * isFocus at all. New call sites must use getRotationOwnerGoal().
 */
export async function getFocusGoal(): Promise<FocusGoalRow | null> {
  const db = await getDb();
  return db.goal.findFirst({
    where: { isFocus: true },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      objective: true,
      targetDate: true,
      kind: true,
      isFocus: true,
      legend: true,
    },
  });
}

/**
 * FocusGoalRow plus the two extra fields the MCP default-goal sites need
 * (get_today_plan reads githubRepo + targets; compute_readiness reads
 * targets). A superset select so every #297/#300 site resolves through ONE
 * helper instead of each re-selecting its own shape.
 */
export type RotationOwnerGoalRow = FocusGoalRow & {
  targets: unknown;
  githubRepo: string | null;
};

const ROTATION_OWNER_SELECT = {
  id: true,
  objective: true,
  targetDate: true,
  kind: true,
  isFocus: true,
  legend: true,
  targets: true,
  githubRepo: true,
} as const;

/**
 * THE shared "current goal" accessor (#297, isFocus sweep) — the goal that
 * owns the active rotation. Mirrors getActiveProgram()'s three tenant
 * branches exactly (src/lib/program.ts — read its doc comment first):
 *
 *  1. Zero Program rows (never adopted Programs) → the legacy focus goal via
 *     getFocusGoal(). Byte-identical to the pre-sweep
 *     `goal.findFirst({ where: { isFocus: true }, orderBy: updatedAt desc })`
 *     each swept site used to inline.
 *  2. Active Program with a rotation → the goal that owns
 *     getActiveProgram()'s Plan (Plan.goalId — the snapshot's `.id` is ALWAYS
 *     a Plan id, per the frozen #277 contract). isFocus is never consulted.
 *  3. Active Program with NO rotation plan (pure-project Programs,
 *     mid-transition), or Program rows exist but none active (retired) →
 *     null. A retired-Program tenant must not silently regress to
 *     isFocus-tiebreak resolution (same rationale as getActiveProgram
 *     branch 3); callers surface "no active rotation — pass goalId
 *     explicitly" rather than guessing.
 *
 * Query cost: 1 count + getActiveProgram()'s own lookups + 1 goal fetch
 * (branch 2), or 1 count + 1 goal fetch (branch 1).
 */
export async function getRotationOwnerGoal(): Promise<RotationOwnerGoalRow | null> {
  const db = await getDb();

  // Branch split on Program ADOPTION, not Program activity — getDb() is
  // tenant-scoped, so count() sees this user's rows only.
  const programRowCount = await db.program.count();
  if (programRowCount === 0) {
    // Legacy zero-Program tenant: the documented isFocus compat path — the
    // SAME where/orderBy as getFocusGoal() (keep the two in lockstep; only
    // the select differs, by the two superset fields).
    return db.goal.findFirst({
      where: { isFocus: true },
      orderBy: { updatedAt: "desc" },
      select: ROTATION_OWNER_SELECT,
    });
  }

  const snapshot = await getActiveProgram();
  if (!snapshot) return null; // Program with no rotation, or retired-Program tenant

  // snapshot.id is a Plan id (frozen contract) — resolve its owning goal via
  // the relation, one indexed query, no isFocus involved.
  return db.goal.findFirst({
    where: { plans: { some: { id: snapshot.id } } },
    select: ROTATION_OWNER_SELECT,
  });
}

/**
 * Returns all active (tracked) goals, each with their single most-recently-updated
 * active plan. Used by getGoalEvents for the 3-query event fetch.
 *
 * Ordering (#297, re-justified — NOT a resolution tiebreak): isFocus desc,
 * then updatedAt desc. This is DISPLAY/DETERMINISM ordering only — the
 * event pipeline iterates every returned goal, so the order fixes the event
 * array order in calendar/Today payloads (stable across renders), and
 * legend/strip surfaces list the legacy focus goal first. Nothing resolves
 * "the current goal" from position 0 of this list (that is
 * getRotationOwnerGoal's job); under a Program, member-goal display order
 * comes from getActiveProgramMembership (createdAt asc, id asc) instead.
 */
export async function getActiveGoalsWithPlans(): Promise<ActiveGoalWithPlan[]> {
  const db = await getDb();
  return db.goal.findMany({
    // status:"active" belt-and-braces alongside active:true — completeGoalCore
    // sets active:false on completion, but this also fixes the live
    // overdue-chip bug for any legacy achieved row that predates that write
    // (REQ-007 / architecture-blueprint-v2.md R-series calendar cleanup).
    where: { active: true, status: "active" },
    orderBy: [{ isFocus: "desc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      objective: true,
      targetDate: true,
      kind: true,
      isFocus: true,
      legend: true,
      plans: {
        where: { active: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: {
          id: true,
          startedOn: true,
          endsOn: true,
          weeks: true,
          planJson: true,
        },
      },
    },
  });
}
