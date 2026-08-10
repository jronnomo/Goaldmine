// Plain async helpers for Program mutations + reads (#310/#311, Sprint 17 seam flip).
// #310: createProgramCore / updateProgramCore / setProgramStatusCore.
// #311: attachGoalToProgramCore / detachGoalFromProgramCore /
//       attachPlanToProgramCore / getProgramOverviewCore.
//
// IMPORTANT: this module intentionally has NO server-action directive at the
// top — same dual-caller contract as goal-core.ts. It is imported from MCP
// tool registrations (src/lib/mcp/tools/program-tools.ts) today and from
// server actions / the /program dashboard later.
//
// Validation guards live here as defensive contract checks; the MCP tool
// callers also Zod-validate inputs for wire-level friendly errors.
//
// Scoping: every DB access goes through getDb() (Program/Goal/Plan are all
// SCOPED_MODELS) — userId is injected into reads and writes automatically.
// No nested relation WRITES anywhere in this file (gotcha §B.10: nested
// writes bypass the $extends injection) — every mutation is a sequential
// top-level call.
//
// One-active-per-user invariant: enforced at the DB level by the raw-SQL
// partial unique index `program_one_active_per_user` (see prisma/schema.prisma
// above `model Program`). setProgramStatusCore pre-checks for a friendly
// error AND catches the P2002 a concurrent activate race produces.

import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import {
  AttributionRulesAuthoringSchema,
  type AttributionRule,
} from "@/lib/attribution-rules";

// ---------------------------------------------------------------------------
// Status enum
// ---------------------------------------------------------------------------

export const PROGRAM_STATUSES = ["draft", "active", "completed", "archived"] as const;
export type ProgramStatus = (typeof PROGRAM_STATUSES)[number];

// ---------------------------------------------------------------------------
// Attribution rules schema — consolidated (#307). The schema now lives in
// src/lib/attribution-rules.ts alongside the lenient read-side parser
// (parseAttributionRules); the two authoring guards (≥1 match criterion,
// ≥1 goalId) moved there intact as *AuthoringSchema. Re-exported under the
// original names so existing importers (program-tools.ts) are unchanged.
// ---------------------------------------------------------------------------

export {
  AttributionRuleAuthoringSchema as AttributionRuleSchema,
  AttributionRulesAuthoringSchema as AttributionRulesSchema,
} from "@/lib/attribution-rules";
export type { AttributionRule } from "@/lib/attribution-rules";

// ---------------------------------------------------------------------------
// Shared row projection (never selects userId — leaky-reads discipline)
// ---------------------------------------------------------------------------

const PROGRAM_SELECT = {
  id: true,
  name: true,
  status: true,
  startedOn: true,
  endsOn: true,
  notes: true,
  attributionRules: true,
  createdAt: true,
  updatedAt: true,
} as const;

export interface ProgramRow {
  id: string;
  name: string;
  status: string;
  startedOn: Date;
  endsOn: Date | null;
  notes: string | null;
  attributionRules: unknown;
  createdAt: Date;
  updatedAt: Date;
}

function isP2002(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
}

function alreadyActiveError(other: { id: string; name: string }): Error {
  return new Error(
    `Program "${other.name}" (${other.id}) is already active — only one Program can be active per user (DB-enforced). ` +
      `Set it to completed or archived via set_program_status first, then activate this one.`,
  );
}

// ---------------------------------------------------------------------------
// createProgramCore
// ---------------------------------------------------------------------------
// Status is ALWAYS the schema default "draft" — activation is set_program_status's
// job (that is where the one-active invariant lives), so create can never
// trip program_one_active_per_user.
// ---------------------------------------------------------------------------

export interface CreateProgramCoreInput {
  name: string;
  startedOn: Date;
  endsOn?: Date | null;
  notes?: string | null;
}

export async function createProgramCore(
  input: CreateProgramCoreInput,
): Promise<ProgramRow> {
  if (!input.name.trim()) throw new Error("name required");
  if (Number.isNaN(input.startedOn.getTime())) throw new Error("invalid startedOn");
  const endsOn = input.endsOn ?? null;
  if (endsOn !== null) {
    if (Number.isNaN(endsOn.getTime())) throw new Error("invalid endsOn");
    if (endsOn < input.startedOn) {
      throw new Error("endsOn is before startedOn — a Program cannot end before it starts.");
    }
  }

  const db = await getDb();
  return db.program.create({
    data: {
      name: input.name.trim(),
      startedOn: input.startedOn,
      endsOn,
      notes: input.notes?.trim() || null,
      // status omitted — schema default "draft"
    },
    select: PROGRAM_SELECT,
  });
}

// ---------------------------------------------------------------------------
// updateProgramCore
// ---------------------------------------------------------------------------
// True PATCH semantics: only fields present on the patch object change.
// `endsOn: null` / `notes: null` / `attributionRules: null` clear the field;
// `undefined` (absent) leaves it untouched. status is deliberately NOT
// patchable here — setProgramStatusCore owns lifecycle + the one-active
// invariant.
//
// attributionRules note: replacing the rules array never retracts
// ActivityGoalLink rows already created (v1 append-only-in-effect policy) —
// rules shape FUTURE auto-linking only.
// ---------------------------------------------------------------------------

export interface UpdateProgramCorePatch {
  name?: string;
  startedOn?: Date;
  endsOn?: Date | null;
  notes?: string | null;
  attributionRules?: AttributionRule[] | null;
}

export interface UpdateProgramCoreResult {
  program: ProgramRow;
  /** Field names actually written. Empty array = no-op call (no write ran). */
  changed: string[];
}

export async function updateProgramCore(
  id: string,
  patch: UpdateProgramCorePatch,
): Promise<UpdateProgramCoreResult> {
  const db = await getDb();

  const existing = await db.program.findUnique({
    where: { id },
    select: PROGRAM_SELECT,
  });
  if (!existing) throw new Error(`Program not found: ${id}`);

  const changed: string[] = [];
  const data: Prisma.ProgramUpdateInput = {};

  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new Error("name cannot be blank");
    data.name = patch.name.trim();
    changed.push("name");
  }
  if (patch.startedOn !== undefined) {
    if (Number.isNaN(patch.startedOn.getTime())) throw new Error("invalid startedOn");
    data.startedOn = patch.startedOn;
    changed.push("startedOn");
  }
  if (patch.endsOn !== undefined) {
    if (patch.endsOn !== null && Number.isNaN(patch.endsOn.getTime())) {
      throw new Error("invalid endsOn");
    }
    data.endsOn = patch.endsOn;
    changed.push("endsOn");
  }
  if (patch.notes !== undefined) {
    data.notes = patch.notes?.trim() || null;
    changed.push("notes");
  }
  if (patch.attributionRules !== undefined) {
    if (patch.attributionRules === null) {
      data.attributionRules = Prisma.JsonNull;
    } else {
      const parsed = AttributionRulesAuthoringSchema.safeParse(patch.attributionRules);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        throw new Error(
          `attributionRules invalid${first ? ` at ${first.path.join(".") || "(root)"}: ${first.message}` : ""}. ` +
            `Expected Array<{ match: { titleContains?: string[], exerciseContains?: string[], source?: string }, goalIds: string[], note?: string }>.`,
        );
      }
      data.attributionRules = parsed.data as unknown as Prisma.InputJsonValue;
    }
    changed.push("attributionRules");
  }

  if (changed.length === 0) {
    return { program: existing, changed };
  }

  // Merged-window guard: the effective window (existing values overlaid with
  // the patch) must still make sense — endsOn cannot precede startedOn.
  const effStart = patch.startedOn ?? existing.startedOn;
  const effEnd = patch.endsOn === undefined ? existing.endsOn : patch.endsOn;
  if (effEnd !== null && effEnd < effStart) {
    throw new Error(
      "endsOn is before startedOn — a Program cannot end before it starts. " +
        "Patch both dates together if you are moving the whole window.",
    );
  }

  const program = await db.program.update({
    where: { id },
    data,
    select: PROGRAM_SELECT,
  });
  return { program, changed };
}

// ---------------------------------------------------------------------------
// setProgramStatusCore
// ---------------------------------------------------------------------------
// The ONLY lifecycle mutator. Second-activate handling is two-layered:
//  1. Pre-check inside the transaction — finds the current active Program and
//     throws a friendly error NAMING it (the common path).
//  2. P2002 catch — a concurrent activate race slips past the pre-check and
//     trips the program_one_active_per_user partial unique index; we re-query
//     the winner and throw the same friendly error (never a raw Postgres
//     unique-violation).
// Same-status calls are an idempotent no-op (changed:false), not an error.
// ---------------------------------------------------------------------------

export interface SetProgramStatusCoreResult {
  id: string;
  name: string;
  previousStatus: string;
  status: string;
  changed: boolean;
}

export async function setProgramStatusCore(
  id: string,
  status: ProgramStatus,
): Promise<SetProgramStatusCoreResult> {
  const db = await getDb();
  try {
    return await db.$transaction(async (tx) => {
      const program = await tx.program.findUnique({
        where: { id },
        select: { id: true, name: true, status: true },
      });
      if (!program) throw new Error(`Program not found: ${id}`);

      if (program.status === status) {
        return {
          id: program.id,
          name: program.name,
          previousStatus: program.status,
          status,
          changed: false,
        };
      }

      if (status === "active") {
        const otherActive = await tx.program.findFirst({
          where: { status: "active", NOT: { id } },
          select: { id: true, name: true },
        });
        if (otherActive) throw alreadyActiveError(otherActive);
      }

      const updated = await tx.program.update({
        where: { id },
        data: { status },
        select: { id: true, name: true, status: true },
      });
      return {
        id: updated.id,
        name: updated.name,
        previousStatus: program.status,
        status: updated.status,
        changed: true,
      };
    });
  } catch (e) {
    if (isP2002(e)) {
      // Concurrent-activate race: another Program won between the pre-check
      // and our update. Name the winner if we can still see it.
      const winner = await db.program.findFirst({
        where: { status: "active", NOT: { id } },
        select: { id: true, name: true },
      });
      throw winner
        ? alreadyActiveError(winner)
        : new Error(
            "Another Program is already active — only one Program can be active per user (DB-enforced). " +
              "Set it to completed or archived via set_program_status first.",
          );
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// attachGoalToProgramCore
// ---------------------------------------------------------------------------
// Membership only: sets Goal.programId and NOTHING else. Deliberately unlike
// setFocusGoalCore (which force-sets active:true when focusing): membership
// ≠ tracking — a Program member may be paused/untracked, and attaching must
// not resurrect it. Tracking stays with setGoalTrackedCore / setFocusGoalCore.
//
// R9: an achieved goal cannot be attached — completeGoalCore retired it
// (isFocus=false, active=false, plans deactivated); Program membership would
// resurrect it in Program views. Reopen first (reopen_goal).
//
// A goal already in ANOTHER Program is MOVED (Goal.programId is single-valued);
// previousProgramId in the result makes the move visible to the caller.
// Re-attaching to the same Program is an idempotent no-op (changed:false).
// ---------------------------------------------------------------------------

export interface AttachGoalToProgramCoreResult {
  goalId: string;
  goalObjective: string;
  programId: string;
  programName: string;
  previousProgramId: string | null;
  changed: boolean;
}

export async function attachGoalToProgramCore(
  goalId: string,
  programId: string,
): Promise<AttachGoalToProgramCoreResult> {
  const db = await getDb();
  return db.$transaction(async (tx) => {
    const goal = await tx.goal.findUnique({
      where: { id: goalId },
      select: { id: true, objective: true, status: true, programId: true },
    });
    if (!goal) throw new Error(`Goal not found: ${goalId}`);

    // R9 — achieved goals are retired; membership would resurrect them.
    if (goal.status === "achieved") {
      throw new Error(
        `Goal "${goal.objective}" is completed (status=achieved) — an achieved goal cannot be attached ` +
          `to a Program (R9). Reopen it first (reopen_goal) if it genuinely returns to play.`,
      );
    }

    const program = await tx.program.findUnique({
      where: { id: programId },
      select: { id: true, name: true },
    });
    if (!program) throw new Error(`Program not found: ${programId}`);

    if (goal.programId === programId) {
      return {
        goalId: goal.id,
        goalObjective: goal.objective,
        programId: program.id,
        programName: program.name,
        previousProgramId: programId,
        changed: false,
      };
    }

    // Membership ≠ tracking: data touches programId ONLY (never active/isFocus).
    await tx.goal.update({
      where: { id: goalId },
      data: { programId },
      select: { id: true },
    });

    return {
      goalId: goal.id,
      goalObjective: goal.objective,
      programId: program.id,
      programName: program.name,
      previousProgramId: goal.programId,
      changed: true,
    };
  });
}

// ---------------------------------------------------------------------------
// detachGoalFromProgramCore
// ---------------------------------------------------------------------------
// Clears Goal.programId. Idempotent by contract: detaching a goal that is in
// no Program is a no-op success (changed:false), NOT an error — safe to call
// defensively. Plans, logs, tracking state, and focus are untouched.
// ---------------------------------------------------------------------------

export interface DetachGoalFromProgramCoreResult {
  goalId: string;
  goalObjective: string;
  previousProgramId: string | null;
  changed: boolean;
}

export async function detachGoalFromProgramCore(
  goalId: string,
): Promise<DetachGoalFromProgramCoreResult> {
  const db = await getDb();
  return db.$transaction(async (tx) => {
    const goal = await tx.goal.findUnique({
      where: { id: goalId },
      select: { id: true, objective: true, programId: true },
    });
    if (!goal) throw new Error(`Goal not found: ${goalId}`);

    if (goal.programId === null) {
      return {
        goalId: goal.id,
        goalObjective: goal.objective,
        previousProgramId: null,
        changed: false,
      };
    }

    await tx.goal.update({
      where: { id: goalId },
      data: { programId: null },
      select: { id: true },
    });

    return {
      goalId: goal.id,
      goalObjective: goal.objective,
      previousProgramId: goal.programId,
      changed: true,
    };
  });
}

// ---------------------------------------------------------------------------
// attachPlanToProgramCore
// ---------------------------------------------------------------------------
// Sets Plan.programId (the Program's rotation plan). DECISION (documented):
// the plan's goal MUST already be a member of the target Program —
// membership before content, so the Program's plan list can never disagree
// with its goal list. A plan whose goal is outside the Program is rejected
// with a clean error pointing at attach_goal_to_program (no warn-but-allow).
//
// The membership check runs BEFORE the already-attached no-op check on
// purpose: a plan left behind by a goal that moved Programs surfaces the
// drift instead of silently no-opping.
// ---------------------------------------------------------------------------

export interface AttachPlanToProgramCoreResult {
  planId: string;
  planName: string;
  goalId: string;
  programId: string;
  programName: string;
  previousProgramId: string | null;
  changed: boolean;
}

export async function attachPlanToProgramCore(
  planId: string,
  programId: string,
): Promise<AttachPlanToProgramCoreResult> {
  const db = await getDb();
  return db.$transaction(async (tx) => {
    const plan = await tx.plan.findUnique({
      where: { id: planId },
      select: { id: true, name: true, goalId: true, programId: true },
    });
    if (!plan) throw new Error(`Plan not found: ${planId}`);

    const program = await tx.program.findUnique({
      where: { id: programId },
      select: { id: true, name: true },
    });
    if (!program) throw new Error(`Program not found: ${programId}`);

    const goal = await tx.goal.findUnique({
      where: { id: plan.goalId },
      select: { id: true, objective: true, programId: true },
    });
    // A plan's goal can only be missing on data corruption (Plan.goalId is a
    // required FK) — still, fail friendly rather than crash.
    if (!goal) throw new Error(`Plan ${planId} has no parent goal (goalId=${plan.goalId}).`);

    if (goal.programId !== programId) {
      throw new Error(
        `Plan "${plan.name}" belongs to goal "${goal.objective}" (${goal.id}), which is not a member of ` +
          `Program "${program.name}" — attach the goal first (attach_goal_to_program), then attach the plan.`,
      );
    }

    if (plan.programId === programId) {
      return {
        planId: plan.id,
        planName: plan.name,
        goalId: goal.id,
        programId: program.id,
        programName: program.name,
        previousProgramId: programId,
        changed: false,
      };
    }

    await tx.plan.update({
      where: { id: planId },
      data: { programId },
      select: { id: true },
    });

    return {
      planId: plan.id,
      planName: plan.name,
      goalId: goal.id,
      programId: program.id,
      programName: program.name,
      previousProgramId: plan.programId,
      changed: true,
    };
  });
}

// ---------------------------------------------------------------------------
// getProgramOverviewCore
// ---------------------------------------------------------------------------
// The Program-layer orientation read: the Program row + member goals (with a
// hasActivePlan flag each) + the rotation plan attached to the Program +
// attributionRules. programId omitted ⇒ resolve the caller's ACTIVE Program
// (getDb() scoping narrows every query to the current user).
//
// Dates are returned as raw Date objects — callers serialize (the MCP tool
// maps startedOn/endsOn to yyyy-mm-dd USER_TZ dateKeys; the future /program
// dashboard consumes Dates directly).
//
// Leaky-reads discipline: every query uses an explicit select — no userId
// anywhere, and no Note reads at all (private note types can't leak from a
// tool that never touches them). Covered in src/lib/mcp/leaky-reads.test.ts.
// ---------------------------------------------------------------------------

export interface ProgramOverviewMemberGoal {
  id: string;
  objective: string;
  kind: string;
  status: string;
  hasActivePlan: boolean;
}

export interface ProgramOverviewResult {
  program: ProgramRow;
  memberGoals: ProgramOverviewMemberGoal[];
  rotationPlan: { id: string; name: string; active: boolean } | null;
  attributionRules: unknown;
}

export async function getProgramOverviewCore(
  programId?: string,
): Promise<ProgramOverviewResult> {
  const db = await getDb();

  const program = programId
    ? await db.program.findUnique({ where: { id: programId }, select: PROGRAM_SELECT })
    : await db.program.findFirst({ where: { status: "active" }, select: PROGRAM_SELECT });

  if (!program) {
    throw new Error(
      programId
        ? `Program not found: ${programId}`
        : "No active Program — pass programId explicitly, or create one (create_program) and activate it (set_program_status) first.",
    );
  }

  const goals = await db.goal.findMany({
    where: { programId: program.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      objective: true,
      kind: true,
      status: true,
      plans: { where: { active: true }, select: { id: true }, take: 1 },
    },
  });

  const rotationPlan = await db.plan.findFirst({
    where: { programId: program.id },
    // Prefer the active plan; fall back to the most recently created one.
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
    select: { id: true, name: true, active: true },
  });

  return {
    program,
    memberGoals: goals.map((g) => ({
      id: g.id,
      objective: g.objective,
      kind: g.kind,
      status: g.status,
      hasActivePlan: g.plans.length > 0,
    })),
    rotationPlan,
    attributionRules: program.attributionRules ?? null,
  };
}
