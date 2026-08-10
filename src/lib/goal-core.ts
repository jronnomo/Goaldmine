// Plain async helpers for Goal mutations.
//
// IMPORTANT: this module intentionally has NO server-action directive at the
// top. It is a plain async helper so it can be imported from both server
// actions (src/lib/goal-actions.ts) AND MCP route handlers / tool
// registrations (src/lib/mcp/tools.ts). Adding the directive would constrain
// it to server-action call sites only and break the MCP path.
//
// Validation guards live here as defensive contract checks; the form caller
// in goal-actions.ts also pre-checks for UI-friendly error messages.
//
// Dual-caller contract:
//   - Server actions (goal-actions.ts) call these cores and then add revalidatePath.
//   - MCP tools (tools.ts) call these cores directly — no revalidatePath needed
//     because /goals, /character are force-dynamic and MCP writes don't need
//     Next.js cache invalidation.

import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import type { GoalTarget } from "@/lib/goal-targets";
import type { Legend } from "@/lib/legend";
import { dateKey } from "@/lib/calendar";
import { scaffoldPlanFromTemplate, weeksBetween } from "@/lib/plan";
import { setProgramStatusCore } from "@/lib/program-core";
import type { RarityTier } from "@/lib/rarity-core";
import { canonicalExerciseName } from "@/lib/records";

export interface CreateGoalCoreInput {
  objective: string;
  targetDate: Date | null; // null = someday goal (no calendar pin, no plan scaffolded)
  notes?: string | null;
  kind?: "fitness" | "project";
  copyFromGoalId?: string | null;
  targets?: GoalTarget[] | null;
  legend?: Legend;
  /** Seed the coach feasibility override from the intake interview.
   *  Stored in the exact set_goal_feasibility shape:
   *  { tier, rationale, assessedAt: ISO, assessedBy: "coach" }
   */
  coachFeasibility?: { tier: RarityTier; rationale: string } | null;
  /** Canonical exercise names that count as training this goal.
   *  Canonicalized via canonicalExerciseName on write. */
  attributionHints?: string[] | null;
  /** Explicit override for the plan-scaffolding decision on DATED FITNESS
   *  goals (B7/G7 — integration gate).
   *  - undefined (default): Program-aware — scaffold only when the user has
   *    NO active Program. Program tenants get their rotation via the Program
   *    pack / import, so a fresh goal must not stamp the generic
   *    PROGRAM_TEMPLATE baseline battery. Zero-Program tenants keep the
   *    legacy auto-scaffold as their onboarding path (byte-identical).
   *  - true: force the scaffold even under an active Program.
   *  - false: suppress it even for zero-Program tenants.
   *  Someday (targetDate null) and non-fitness goals NEVER scaffold,
   *  regardless of this flag — the hard gates are not overridable. */
  scaffoldPlan?: boolean;
}

export interface CreateGoalCoreResult {
  goal: { id: string };
  /** null for someday goals (targetDate === null — no plan scaffolded). */
  planId: string | null;
  /** true iff this call scaffolded a plan (then planId is non-null).
   *  false for someday/non-fitness goals AND for dated fitness goals where
   *  the Program-aware default (or scaffoldPlan:false) suppressed it. */
  scaffolded: boolean;
}

// ---------------------------------------------------------------------------
// Private scaffold helper — single code path shared by createGoalCore AND
// ensurePlanForGoalCore so the two callers can never drift.
// ---------------------------------------------------------------------------

interface ScaffoldPlanArgs {
  objective: string;
  weeks: number;
  startedOn: Date;
  endsOn: Date;
}

interface ScaffoldPlanData {
  name: string;
  startedOn: Date;
  endsOn: Date;
  weeks: number;
  active: boolean;
  planJson: object;
  revisions: {
    create: {
      triggerSource: string;
      summary: string;
      reasoning: string;
      snapshotJson: object;
    };
  };
}

function buildPlanData(args: ScaffoldPlanArgs): ScaffoldPlanData {
  const planTemplate = scaffoldPlanFromTemplate(args.weeks);
  return {
    name: `${args.objective} — ${args.weeks}-week plan`,
    startedOn: args.startedOn,
    endsOn: args.endsOn,
    weeks: args.weeks,
    active: true,
    planJson: planTemplate as unknown as object,
    revisions: {
      create: {
        triggerSource: "manual",
        summary: "Initial plan from program template",
        reasoning: `Scaffolded from the program template, scaled to ${args.weeks} weeks across ${planTemplate.phases.length} phases.`,
        snapshotJson: planTemplate as unknown as object,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// createGoalCore
// ---------------------------------------------------------------------------

export async function createGoalCore(
  input: CreateGoalCoreInput,
): Promise<CreateGoalCoreResult> {
  const { objective, targetDate, copyFromGoalId } = input;

  // v2 — Concern A: defensive guards inside core. Form callers also pre-check
  // for UI-friendly messages; this is the contract boundary for any caller.
  if (!objective.trim()) throw new Error("objective required");
  if (targetDate !== null && Number.isNaN(targetDate.getTime())) throw new Error("invalid targetDate");

  // v2 — Concern K: normalize notes to null when blank. Form already does
  // this; MCP callers may pass "" which would otherwise round-trip as empty
  // string.
  const normalizedNotes = input.notes?.trim() || null;

  // Plans are scaffolded from the FITNESS program template (baseline week + phases),
  // so only fitness goals get one. Project (and any non-fitness) goals track via
  // metrics + scheduled items — scaffolding a fitness plan onto them bleeds a default
  // baseline battery onto the calendar (see the rhino.the.grey regression, 2026-06-18).
  const kind = input.kind ?? "fitness";

  const db = await getDb();

  // B7/G7 (integration gate): scaffolding is Program-aware + opt-in.
  // Hard gates first (NOT overridable): only dated fitness goals can ever
  // scaffold — see the kind comment above and the D1 someday rule below.
  // Within the eligible set, the default is tenant-shaped:
  //   - active Program → NO auto-scaffold (the Program owns the rotation;
  //     stamping the generic Elbert-flavored template battery onto every new
  //     goal is the B7 regression, reproduced 2026-08-09),
  //   - zero/retired Program → legacy auto-scaffold, byte-identical (it is
  //     still the zero-Program onboarding path).
  // input.scaffoldPlan overrides the default in either direction and skips
  // the Program lookup entirely.
  const scaffoldEligible = targetDate !== null && kind === "fitness";
  let shouldScaffold = false;
  if (scaffoldEligible) {
    if (input.scaffoldPlan !== undefined) {
      shouldScaffold = input.scaffoldPlan;
    } else {
      const activeProgram = await db.program.findFirst({
        where: { status: "active" },
        select: { id: true },
      });
      shouldScaffold = activeProgram === null;
    }
  }

  let targets: GoalTarget[] | null = input.targets ?? null;
  if (!targets && copyFromGoalId) {
    const source = await db.goal.findUnique({ where: { id: copyFromGoalId } });
    if (source && source.targets) {
      targets = source.targets as unknown as GoalTarget[];
    }
  }

  // Canonicalize attributionHints on write
  const attributionHints: Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined =
    input.attributionHints == null
      ? undefined
      : input.attributionHints.length === 0
        ? Prisma.JsonNull
        : (input.attributionHints.map((h) => canonicalExerciseName(h)) as unknown as Prisma.InputJsonValue);

  // Serialize coachFeasibility into the exact set_goal_feasibility shape
  const coachFeasibilityValue: Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined =
    input.coachFeasibility === null
      ? Prisma.JsonNull
      : input.coachFeasibility === undefined
        ? undefined
        : ({
            tier: input.coachFeasibility.tier,
            rationale: input.coachFeasibility.rationale,
            assessedAt: new Date().toISOString(),
            assessedBy: "coach",
          } as unknown as Prisma.InputJsonValue);

  // Legend handling: undefined → omit; [] → JsonNull (= reset to default);
  // non-empty → cast to InputJsonValue.
  const legendForCreate: Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined =
    input.legend === undefined
      ? undefined
      : input.legend.length === 0
        ? Prisma.JsonNull
        : (input.legend as unknown as Prisma.InputJsonValue);

  // A new goal becomes active (tracked) and becomes the focus ONLY when no
  // other goal already has isFocus=true. This prevents stealing focus from an
  // existing focused goal. Use setFocusGoal to explicitly switch focus.
  // (Replaces the old behavior of deactivating all other goals + plans globally.)
  const created = await db.$transaction(async (tx) => {
    const existingFocusCount = await tx.goal.count({ where: { isFocus: true } });
    const shouldBecomeFocus = existingFocusCount === 0;

    // Step 1: Create Goal (extension injects userId) — NO nested plans.
    // Plan is a scoped model; nested relation writes bypass $extends and would
    // produce null userId on the Plan row. We split into a separate tx.plan.create
    // call below. (See docs/project-gotchas.md §B-9 and E4b-1 research §PROBLEM 3.)
    const goal = await tx.goal.create({
      data: {
        objective,
        targetDate,
        notes: normalizedNotes,
        targets: targets ?? undefined,
        kind,
        active: true,
        isFocus: shouldBecomeFocus,
        ...(legendForCreate === undefined ? {} : { legend: legendForCreate }),
        ...(coachFeasibilityValue === undefined ? {} : { coachFeasibility: coachFeasibilityValue }),
        ...(attributionHints === undefined ? {} : { attributionHints }),
      },
    });

    // Step 2: Conditionally create Plan + nested PlanRevision as a top-level call.
    // D1 someday-no-plan: only scaffold when targetDate is set.
    // kind-gate: only fitness goals scaffold a (fitness-template) plan.
    // B7/G7 Program-gate: shouldScaffold (computed above) additionally
    // suppresses the auto-scaffold for active-Program tenants unless
    // scaffoldPlan:true forces it.
    // Plan is scoped → tx.plan.create fires the extension, injecting userId ✓.
    // PlanRevision is non-scoped → safe to nest inside Plan's create ✓.
    // (targetDate !== null is implied by shouldScaffold — repeated only for
    // TypeScript narrowing.)
    let createdPlanId: string | null = null;
    if (shouldScaffold && targetDate !== null) {
      const now = new Date();
      const weeks = weeksBetween(now, targetDate);
      const plan = await tx.plan.create({
        data: {
          goalId: goal.id,
          ...buildPlanData({ objective, weeks, startedOn: now, endsOn: targetDate }),
        },
        select: { id: true },
      });
      createdPlanId = plan.id;
    }

    return { id: goal.id, plans: createdPlanId ? [{ id: createdPlanId }] : [] };
  });

  const planId = created.plans[0]?.id ?? null;
  return { goal: { id: created.id }, planId, scaffolded: planId !== null };
}

// ---------------------------------------------------------------------------
// ensurePlanForGoalCore
// ---------------------------------------------------------------------------
// D2 dated-upgrade: zero plans ⇒ scaffold + initial PlanRevision (created:true);
// any plan exists (even paused) ⇒ no-op (created:false).
// Called from MCP update_goal handler AND UI updateGoal action when a non-null
// date is set.
// ---------------------------------------------------------------------------

export interface EnsurePlanResult {
  planId: string | null;
  created: boolean;
}

export async function ensurePlanForGoalCore(
  goalId: string,
  targetDate: Date,
): Promise<EnsurePlanResult> {
  const db = await getDb();

  // kind-gate: plans are fitness-template-based, so only fitness goals scaffold one.
  // Checked before the past-date guard so a non-fitness goal never throws on a stale
  // date for a plan it would never get. (rhino.the.grey regression, 2026-06-18.)
  const kindRow = await db.goal.findUnique({
    where: { id: goalId },
    select: { kind: true },
  });
  if (!kindRow) throw new Error(`Goal ${goalId} not found`);
  if (kindRow.kind !== "fitness") {
    return { planId: null, created: false };
  }

  // H2 guard (upgrade path only): cannot scaffold a plan for a date already in the past.
  // Today is valid (targetKey === nowKey) — weeksBetween floors at 1 so a same-day upgrade
  // gets a 1-week plan rather than throwing. This guards only ensurePlanForGoalCore, not
  // createGoalCore's dated creation path.
  const nowKey = dateKey(new Date());
  const targetKey = dateKey(targetDate);
  if (targetKey < nowKey) {
    throw new Error(
      `targetDate is in the past (${targetKey}) — update the date or leave the goal as someday.`,
    );
  }

  return db.$transaction(async (tx) => {
    const existing = await tx.plan.findFirst({
      where: { goalId },
      select: { id: true },
    });
    if (existing) {
      return { planId: existing.id, created: false };
    }

    const goal = await tx.goal.findUnique({
      where: { id: goalId },
      select: { objective: true },
    });
    if (!goal) throw new Error(`Goal ${goalId} not found`);

    const now = new Date();
    const weeks = weeksBetween(now, targetDate);
    const planData = buildPlanData({ objective: goal.objective, weeks, startedOn: now, endsOn: targetDate });

    // tx.plan.create fires the extension (Plan is scoped) → userId injected ✓.
    // Nested revisions: { create: {...} } is safe — PlanRevision is non-scoped ✓.
    const plan = await tx.plan.create({
      data: {
        goalId,
        ...planData,
      },
      select: { id: true },
    });

    return { planId: plan.id, created: true };
  });
}

// ---------------------------------------------------------------------------
// setGoalTrackedCore
// ---------------------------------------------------------------------------
// Toggle a goal's tracked (active) state.
// Guard: the focus goal cannot be untracked — switch focus to another goal
// first. Error message is intentionally identical to the goal-actions.ts
// caller so the MCP surface and the UI surface give the same error text.
// ---------------------------------------------------------------------------

export interface SetGoalTrackedCoreResult {
  id: string;
  active: boolean;
}

export async function setGoalTrackedCore(
  id: string,
  tracked: boolean,
): Promise<SetGoalTrackedCoreResult> {
  const db = await getDb();
  return db.$transaction(async (tx) => {
    const goal = await tx.goal.findUnique({
      where: { id },
      select: { id: true, isFocus: true },
    });
    if (!goal) throw new Error("Goal not found");
    if (!tracked && goal.isFocus) {
      throw new Error(
        "Cannot untrack the focus goal — switch focus to another goal first.",
      );
    }
    const updated = await tx.goal.update({
      where: { id },
      data: { active: tracked },
      select: { id: true, active: true },
    });
    return { id: updated.id, active: updated.active };
  });
}

// ---------------------------------------------------------------------------
// setPlanActiveCore
// ---------------------------------------------------------------------------
// Pause (active=false) or Resume (active=true) the goal's plan.
// Pause = set the goal's active plan to active=false (silences retest-marker
//   generation). Resume = re-activate the most-recent plan (mirror
//   setFocusGoal's latest-plan idiom).
// Guard: the focus goal's plan cannot be paused — UXR-62B-03.
// No new schema column: active=false IS the paused state; existing
//   active:true filters in getActiveGoalsWithPlans + goal-events already
//   silence a paused plan for free.
// Returns the planId that was activated/deactivated, or null when there was
//   no plan to resume (defensive no-op path — UI should not offer Resume then).
// ---------------------------------------------------------------------------

export interface SetPlanActiveCoreResult {
  goalId: string;
  planId: string | null;
  active: boolean;
}

export async function setPlanActiveCore(
  goalId: string,
  active: boolean,
): Promise<SetPlanActiveCoreResult> {
  const db = await getDb();
  const goal = await db.goal.findUnique({
    where: { id: goalId },
    select: { id: true, isFocus: true },
  });
  if (!goal) throw new Error("Goal not found");
  // Guard: cannot pause the focus goal's plan — switch focus first
  if (!active && goal.isFocus) {
    throw new Error(
      "Cannot pause the focus goal's plan — switch focus to another goal first.",
    );
  }

  if (!active) {
    // Pause: deactivate all active plans for this goal
    await db.plan.updateMany({
      where: { goalId, active: true },
      data: { active: false },
    });
    return { goalId, planId: null, active: false };
  } else {
    // Resume: re-activate the most-recent plan (mirror setFocusGoal's latest-plan idiom).
    // Wrap findFirst + updateMany + update in a transaction so the "at most one active
    // plan" invariant holds under concurrent writes.
    return db.$transaction(async (tx) => {
      const latest = await tx.plan.findFirst({
        where: { goalId },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (!latest) return { goalId, planId: null, active: true }; // No plan at all — defensive no-op; UI should not offer Resume then
      // Ensure at most one active plan (deactivate others first)
      await tx.plan.updateMany({
        where: { goalId, id: { not: latest.id } },
        data: { active: false },
      });
      await tx.plan.update({
        where: { id: latest.id },
        data: { active: true },
      });
      return { goalId, planId: latest.id, active: true };
    });
  }
}

// ---------------------------------------------------------------------------
// setFocusGoalCore
// ---------------------------------------------------------------------------
// Switch which goal drives Today/Calendar (Goal.isFocus — exactly one at a
// time). Extracted from the setFocusGoal server action so the MCP
// set_active_goal tool (project-tools.ts) shares the same transaction.
// Focus ⇒ active-plan invariant: the target goal is set active=true and its
// most-recent plan is re-activated — focusing a goal also resumes its paused
// plan. Other goals stay tracked (active untouched); only isFocus moves.
// ---------------------------------------------------------------------------

export interface SetFocusGoalCoreResult {
  previousFocusGoalId: string | null;
  goal: { id: string; kind: string; objective: string };
}

export async function setFocusGoalCore(id: string): Promise<SetFocusGoalCoreResult> {
  const db = await getDb();
  const oldFocus = await db.goal.findFirst({ where: { isFocus: true }, select: { id: true } });

  const goal = await db.$transaction(async (tx) => {
    const target = await tx.goal.findUnique({
      where: { id },
      select: { id: true, kind: true, objective: true, status: true },
    });
    if (!target) throw new Error(`Goal not found: ${id}`);
    // Guard: a completed goal is archived (isFocus=false, active=false,
    // plans deactivated) — focusing it would resurrect a goal that
    // completeGoalCore just retired. Reopen it first.
    if (target.status === "achieved") {
      throw new Error(
        "This goal is completed — reopen it first (reopen_goal).",
      );
    }

    // 1. Clear isFocus on all goals.
    await tx.goal.updateMany({ data: { isFocus: false } });

    // 2. Set isFocus + ensure active on the target goal.
    //    (A previously untracked goal that receives focus becomes tracked again.)
    await tx.goal.update({ where: { id }, data: { isFocus: true, active: true } });

    // 3. Ensure target goal has exactly one active plan (the latest).
    //    OTHER goals' plans are NOT touched — they stay active.
    const latest = await tx.plan.findFirst({
      where: { goalId: id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (latest) {
      await tx.plan.updateMany({
        where: { goalId: id, id: { not: latest.id } },
        data: { active: false },
      });
      await tx.plan.update({ where: { id: latest.id }, data: { active: true } });
    }

    return target;
  });

  return { previousFocusGoalId: oldFocus?.id ?? null, goal };
}

// ---------------------------------------------------------------------------
// setFocusGoalProgramAwareCore (#280 — the set_active_goal compat shim)
// ---------------------------------------------------------------------------
// Program-aware wrapper around setFocusGoalCore for the one-active-Program
// world (Sprint 17 seam flip). The blast radius that motivates it: with an
// active Program, focusing a goal in a DIFFERENT Program is not a narrow
// isFocus flip anymore — the whole current Program (its rotation and every
// member goal's daily surface) stops driving Today. That must never happen
// as a silent side effect of "switch focus".
//
// Decision matrix (issue #280 ACs):
//   - ZERO Program rows for the user (pre-Program tenant) → pure legacy
//     setFocusGoalCore, byte-identical behavior. Program rows exist but NONE
//     active (retired-Program user) → same: nothing to deactivate, focus
//     switches, Program state untouched (a mere focus switch must not
//     resurrect a retired Program).
//   - Active Program + target IS a member → focus switches, Program
//     untouched (same-Program switches are the normal in-season move).
//   - Active Program + target has NO Program → focus switches, Program
//     untouched — but the result carries a WARNING: the active Program still
//     owns the day's rotation (Program-first resolution ignores isFocus), so
//     the focus change alone does not hand Today to this goal.
//   - Active Program + target in a DIFFERENT Program → REFUSED unless
//     confirmProgramSwitch=true (friendly error NAMING both Programs). With
//     confirmation: the current Program is deactivated via
//     setProgramStatusCore(current, "archived") — the same mechanism
//     set_program_status uses, reused not duplicated — then the target's
//     Program is activated, then focus switches.
//
// NOT one transaction: setProgramStatusCore opens its own $transaction, so
// the archive → activate → focus sequence is sequential. The target is
// pre-validated (exists, not achieved) before any Program write, so the
// remaining failure window is concurrent-write races — and the DB-level
// one-active index keeps even those consistent (worst case: Programs
// switched, focus unchanged — re-run the call).
// ---------------------------------------------------------------------------

export interface SetFocusGoalProgramAwareResult extends SetFocusGoalCoreResult {
  program: {
    /** "none" = Program state untouched; "switched" = the previous active
     *  Program was archived and the target's Program activated. */
    action: "none" | "switched";
    previousProgram?: { id: string; name: string; status: string };
    activatedProgram?: { id: string; name: string };
    /** Present when focus moved to a Program-less goal while a Program is
     *  active — the rotation still belongs to the Program. */
    warning?: string;
  };
}

export async function setFocusGoalProgramAwareCore(
  id: string,
  opts: { confirmProgramSwitch?: boolean } = {},
): Promise<SetFocusGoalProgramAwareResult> {
  const db = await getDb();

  const activeProgram = await db.program.findFirst({
    where: { status: "active" },
    select: { id: true, name: true },
  });

  if (!activeProgram) {
    // Zero Program rows (legacy tenant) or rows-but-none-active (retired
    // Program): either way there is nothing to deactivate — legacy path,
    // Program state untouched.
    const focus = await setFocusGoalCore(id);
    return { ...focus, program: { action: "none" } };
  }

  const target = await db.goal.findUnique({
    where: { id },
    select: {
      id: true,
      objective: true,
      status: true,
      programId: true,
      program: { select: { id: true, name: true } },
    },
  });
  if (!target) throw new Error(`Goal not found: ${id}`);
  // Pre-check the achieved guard HERE (setFocusGoalCore enforces it too) so a
  // cross-Program switch can never archive the current Program and THEN
  // discover the target is un-focusable.
  if (target.status === "achieved") {
    throw new Error("This goal is completed — reopen it first (reopen_goal).");
  }

  // Same Program: the normal in-season switch — Program untouched.
  if (target.programId === activeProgram.id) {
    const focus = await setFocusGoalCore(id);
    return { ...focus, program: { action: "none" } };
  }

  // Program-less target: focus moves, Program untouched — warn that the
  // rotation still belongs to the active Program.
  if (target.programId === null) {
    const focus = await setFocusGoalCore(id);
    return {
      ...focus,
      program: {
        action: "none",
        warning:
          `"${target.objective}" is not a member of the active Program "${activeProgram.name}" — the Program ` +
          `still owns the day's rotation, so Today keeps resolving from it. Attach the goal ` +
          `(attach_goal_to_program) or archive the Program (set_program_status) if you meant to hand Today over.`,
      },
    };
  }

  // Cross-Program switch: gated on explicit confirmation. programId is
  // non-null here and the FK guarantees the row — the fallback is pure
  // defense against data corruption.
  const targetProgram = target.program ?? { id: target.programId, name: "(unknown Program)" };
  if (!opts.confirmProgramSwitch) {
    throw new Error(
      `Goal "${target.objective}" belongs to Program "${targetProgram.name}", but Program ` +
        `"${activeProgram.name}" is currently active. Focusing it DEACTIVATES the entire current Program — ` +
        `"${activeProgram.name}" is archived (every member goal stops driving Today), and ` +
        `"${targetProgram.name}" becomes the active Program. If that is really the intent, confirm with the ` +
        `user first, then retry with confirmProgramSwitch: true.`,
    );
  }

  // Reuse set_program_status's mechanism — archive the current, activate the
  // target's. Order matters: the one-active-per-user index forbids
  // activate-before-archive.
  await setProgramStatusCore(activeProgram.id, "archived");
  await setProgramStatusCore(targetProgram.id, "active");
  const focus = await setFocusGoalCore(id);

  return {
    ...focus,
    program: {
      action: "switched",
      previousProgram: { id: activeProgram.id, name: activeProgram.name, status: "archived" },
      activatedProgram: { id: targetProgram.id, name: targetProgram.name },
    },
  };
}
