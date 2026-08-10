// src/lib/mcp/tools/program-tools.ts
// Program-layer MCP tools (#310/#311, Sprint 17 seam flip) — the multi-domain
// Program container: lifecycle CRUD + status (#310) and membership + overview
// (#311). The Program is the umbrella for a season of coordinated goals
// (fitness AND project) sharing one time window and one weekly rotation.
// Cores live in src/lib/program-core.ts (dual-caller contract: the same
// functions will back the /program dashboard and founder backfill later).

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDb } from "@/lib/db";
import { dateKey as toDateKey } from "@/lib/calendar";
import { safe, parseDateInput } from "@/lib/mcp/tool-helpers";
import { withWriteReceipt, RequestIdShape } from "@/lib/mcp/idempotency";
import {
  AttributionRulesSchema,
  PROGRAM_STATUSES,
  createProgramCore,
  updateProgramCore,
  setProgramStatusCore,
  attachGoalToProgramCore,
  detachGoalFromProgramCore,
  attachPlanToProgramCore,
  getProgramOverviewCore,
  type ProgramRow,
  type UpdateProgramCorePatch,
} from "@/lib/program-core";

/** Wire shape for a Program row: calendar dates as yyyy-mm-dd (USER_TZ),
 *  instants as ISO. Never includes userId. */
function serializeProgram(p: ProgramRow) {
  return {
    id: p.id,
    name: p.name,
    status: p.status,
    startedOn: toDateKey(p.startedOn),
    endsOn: p.endsOn ? toDateKey(p.endsOn) : null,
    notes: p.notes,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function registerProgramTools(server: McpServer): void {
  // --------------------------------------------------------------------------
  // create_program
  // --------------------------------------------------------------------------
  server.registerTool(
    "create_program",
    {
      title: "Create a Program (the season container for coordinated goals) — starts as draft",
      description:
        "Create a Program — the umbrella container for a season/block of coordinated goals: one time window, one weekly " +
        "rotation, many member goals (fitness AND project kind together). This is THE tool for 'start a new program', " +
        "'set up the fall training block', 'create the next season'. The new Program starts as status='draft' and drives " +
        "nothing until set_program_status flips it to 'active'. Content is attached afterwards: attach_goal_to_program " +
        "for each member goal, then attach_plan_to_program for the shared rotation plan. " +
        "Do NOT create a second ACTIVE Program — only one can be active per user (DB-enforced); drafting alongside an " +
        "active one is fine, activating it is where the constraint bites (archive the current one first via set_program_status). " +
        "Do NOT use this to create a goal (create_goal) or a training plan (plans belong to goals) — the Program is the " +
        "container, not the content.",
      inputSchema: {
        name: z.string().min(1).max(200).describe("Program name, e.g. 'Fall 2026 — Base Build'."),
        startedOn: z
          .string()
          .describe("Program start date in yyyy-mm-dd (USER_TZ calendar date)."),
        endsOn: z
          .string()
          .optional()
          .describe("Optional program end date in yyyy-mm-dd (USER_TZ). Omit for an open-ended program."),
        notes: z.string().optional().describe("Optional free-text notes about the program's intent."),
        requestId: RequestIdShape,
      },
    },
    async (input) =>
      safe(async () => {
        const db = await getDb();
        return withWriteReceipt("create_program", input.requestId, db, async () => {
          const created = await createProgramCore({
            name: input.name,
            startedOn: parseDateInput(input.startedOn),
            endsOn: input.endsOn ? parseDateInput(input.endsOn) : null,
            notes: input.notes ?? null,
          });
          return {
            ...serializeProgram(created),
            message:
              "Program created as draft. Attach goals (attach_goal_to_program), then activate via set_program_status when ready.",
          };
        });
      }),
  );

  // --------------------------------------------------------------------------
  // update_program
  // --------------------------------------------------------------------------
  server.registerTool(
    "update_program",
    {
      title: "Patch a Program's fields (name, window, notes, attribution rules)",
      description:
        "Update one or more fields of an existing Program. True PATCH semantics: only explicitly provided fields change; " +
        "omitted fields stay as they are. Pass null for endsOn / notes / attributionRules to CLEAR them. " +
        "Use for 'rename the program', 'extend the block to date X', 'set the program's attribution rules'. " +
        "Do NOT change status here — set_program_status owns lifecycle changes and the one-active-Program invariant. " +
        "attributionRules are coach-authored auto-link matching rules applied ALONGSIDE each goal's attributionHints — " +
        "shape: Array<{ match: { titleContains?: string[], exerciseContains?: string[], source?: string }, goalIds: string[], note?: string }>, " +
        "each rule needing at least one match criterion and at least one goalId. Editing rules never retracts " +
        "ActivityGoalLink rows already created (v1 is append-only in effect) — rules shape FUTURE linking only. " +
        "Passing only {programId} with no fields returns a friendly message and performs no write.",
      inputSchema: {
        programId: z.string().min(1).describe("ID of the Program to update."),
        name: z.string().min(1).max(200).optional().describe("New program name. Omit to leave unchanged."),
        startedOn: z
          .string()
          .optional()
          .describe("New start date yyyy-mm-dd (USER_TZ). Omit to leave unchanged."),
        endsOn: z
          .string()
          .nullable()
          .optional()
          .describe("New end date yyyy-mm-dd (USER_TZ); null clears it (open-ended). Omit to leave unchanged."),
        notes: z
          .string()
          .nullable()
          .optional()
          .describe("New notes; null clears them. Omit to leave unchanged."),
        attributionRules: AttributionRulesSchema.nullable()
          .optional()
          .describe(
            "Replacement attribution-rules array (validated); null clears all rules. Omit to leave unchanged. " +
              "Replacing rules never retracts existing activity links.",
          ),
        requestId: RequestIdShape,
      },
    },
    async (input) =>
      safe(async () => {
        const db = await getDb();
        return withWriteReceipt("update_program", input.requestId, db, async () => {
          const patch: UpdateProgramCorePatch = {};
          if (input.name !== undefined) patch.name = input.name;
          if (input.startedOn !== undefined) patch.startedOn = parseDateInput(input.startedOn);
          if (input.endsOn !== undefined) {
            patch.endsOn = input.endsOn === null ? null : parseDateInput(input.endsOn);
          }
          if (input.notes !== undefined) patch.notes = input.notes;
          if (input.attributionRules !== undefined) {
            patch.attributionRules = input.attributionRules;
          }

          const r = await updateProgramCore(input.programId, patch);
          if (r.changed.length === 0) {
            return {
              id: r.program.id,
              message:
                "Nothing to update — provide at least one field (name, startedOn, endsOn, notes, attributionRules).",
            };
          }
          return {
            ...serializeProgram(r.program),
            attributionRules: r.program.attributionRules ?? null,
            changed: r.changed,
            message: "Program updated.",
          };
        });
      }),
  );

  // --------------------------------------------------------------------------
  // set_program_status
  // --------------------------------------------------------------------------
  server.registerTool(
    "set_program_status",
    {
      title: "Move a Program through its lifecycle: draft | active | completed | archived",
      description:
        "Set a Program's status — the ONLY tool that changes Program lifecycle. THE tool for 'activate the program', " +
        "'archive the old block', 'mark the season complete'. Statuses: draft (created, not live) | active (the current " +
        "program) | completed (finished on its own terms) | archived (shelved). " +
        "ONE ACTIVE PROGRAM PER USER, enforced by the database — do NOT activate a second Program: the call fails with a " +
        "clean error NAMING the currently active Program; set that one to completed or archived first, then activate the " +
        "new one. Setting the status a Program already has is a friendly no-op (changed:false), not an error.",
      inputSchema: {
        programId: z.string().min(1).describe("ID of the Program whose status to change."),
        status: z
          .enum(PROGRAM_STATUSES)
          .describe("New status. One of: draft | active | completed | archived."),
        requestId: RequestIdShape,
      },
    },
    async (input) =>
      safe(async () => {
        const db = await getDb();
        return withWriteReceipt("set_program_status", input.requestId, db, async () => {
          const r = await setProgramStatusCore(input.programId, input.status);
          return {
            ...r,
            message: r.changed
              ? `Program "${r.name}": ${r.previousStatus} → ${r.status}.`
              : `Program "${r.name}" is already ${r.status} — no change.`,
          };
        });
      }),
  );

  // --------------------------------------------------------------------------
  // attach_goal_to_program
  // --------------------------------------------------------------------------
  server.registerTool(
    "attach_goal_to_program",
    {
      title: "Add a goal to a Program (membership only — never touches tracking/focus)",
      description:
        "Record that a Goal belongs to a Program (sets Goal.programId). Works for goals of ANY kind — fitness and " +
        "project goals share one Program. THE tool for 'add the hiking goal to the program', 'move this goal into the " +
        "fall block'. MEMBERSHIP ≠ TRACKING: this does NOT change Goal.active, focus, or the goal's plan — a member " +
        "goal can be paused; use set_goal_tracked / set_active_goal for tracking and focus. " +
        "An ACHIEVED goal cannot be attached: completed goals are retired (R9) and Program membership would resurrect " +
        "them in Program views — reopen it first (reopen_goal) if it genuinely returns to play. " +
        "A goal already in a DIFFERENT Program is MOVED (a goal has at most one Program); the response reports " +
        "previousProgramId so the move is visible. Attaching to the same Program again is a friendly no-op (changed:false).",
      inputSchema: {
        goalId: z.string().min(1).describe("ID of the goal to attach. Use list_goals to discover ids."),
        programId: z.string().min(1).describe("ID of the Program to attach it to."),
        requestId: RequestIdShape,
      },
    },
    async (input) =>
      safe(async () => {
        const db = await getDb();
        return withWriteReceipt("attach_goal_to_program", input.requestId, db, async () => {
          const r = await attachGoalToProgramCore(input.goalId, input.programId);
          return {
            ...r,
            message: r.changed
              ? `Goal "${r.goalObjective}" attached to Program "${r.programName}". Tracking/focus unchanged.`
              : `Goal "${r.goalObjective}" is already a member of Program "${r.programName}" — no change.`,
          };
        });
      }),
  );

  // --------------------------------------------------------------------------
  // detach_goal_from_program
  // --------------------------------------------------------------------------
  server.registerTool(
    "detach_goal_from_program",
    {
      title: "Remove a goal from its Program (idempotent — no-op when not a member)",
      description:
        "Clear Goal.programId — the goal leaves its Program but keeps its plans, logs, tracking state, and focus " +
        "untouched. Use for 'take this goal out of the program', 'this goal is standalone now'. " +
        "IDEMPOTENT: detaching a goal that is in no Program returns a no-op success (changed:false), NOT an error — " +
        "safe to call defensively. Takes only goalId (a goal has at most one Program, so no programId is needed). " +
        "Do NOT use this to retire a goal — complete_goal and set_goal_tracked are different operations; detaching " +
        "only removes Program membership.",
      inputSchema: {
        goalId: z.string().min(1).describe("ID of the goal to detach from its Program."),
        requestId: RequestIdShape,
      },
    },
    async (input) =>
      safe(async () => {
        const db = await getDb();
        return withWriteReceipt("detach_goal_from_program", input.requestId, db, async () => {
          const r = await detachGoalFromProgramCore(input.goalId);
          return {
            ...r,
            message: r.changed
              ? `Goal "${r.goalObjective}" detached from its Program.`
              : `Goal "${r.goalObjective}" is not in any Program — nothing to detach.`,
          };
        });
      }),
  );

  // --------------------------------------------------------------------------
  // attach_plan_to_program
  // --------------------------------------------------------------------------
  server.registerTool(
    "attach_plan_to_program",
    {
      title: "Attach a goal's plan to a Program (its rotation plan) — goal must be a member first",
      description:
        "Set Plan.programId — marks a plan as belonging to a Program (the shared weekly rotation the Program layer " +
        "reads). REQUIREMENT: the plan's goal must ALREADY be a member of that Program — call attach_goal_to_program " +
        "first; a plan whose goal is outside the Program is rejected with a clear error (membership before content, " +
        "so the Program's plan list can never disagree with its goal list). " +
        "Typical wiring order after create_program: attach_goal_to_program for each goal, then attach_plan_to_program " +
        "for the rotation plan — 'wire the Elbert plan into the program'. " +
        "Re-attaching the same plan to the same Program is a friendly no-op; attaching to a different Program moves it " +
        "and reports previousProgramId. Do NOT use this to activate/pause a plan — that is set_plan_active.",
      inputSchema: {
        planId: z.string().min(1).describe("ID of the plan to attach (see get_goal for a goal's plans)."),
        programId: z.string().min(1).describe("ID of the Program to attach it to."),
        requestId: RequestIdShape,
      },
    },
    async (input) =>
      safe(async () => {
        const db = await getDb();
        return withWriteReceipt("attach_plan_to_program", input.requestId, db, async () => {
          const r = await attachPlanToProgramCore(input.planId, input.programId);
          return {
            ...r,
            message: r.changed
              ? `Plan "${r.planName}" attached to Program "${r.programName}" as a rotation plan.`
              : `Plan "${r.planName}" is already attached to Program "${r.programName}" — no change.`,
          };
        });
      }),
  );

  // --------------------------------------------------------------------------
  // get_program_overview
  // --------------------------------------------------------------------------
  server.registerTool(
    "get_program_overview",
    {
      title: "Program overview: the container + member goals + rotation plan + attribution rules",
      description:
        "THE orientation read for the Program layer: returns program {id, name, status, startedOn, endsOn, notes}, " +
        "memberGoals [{id, objective, kind, status, hasActivePlan}], rotationPlan {id, name, active} | null (the plan " +
        "attached to the Program — active preferred, else newest), and attributionRules (the program's auto-link rules). " +
        "Omit programId to resolve the user's ACTIVE Program — 'what's in the current program', 'show me the program', " +
        "'which goals are in this block'; pass programId to inspect a draft/completed/archived one. " +
        "Do NOT infer membership from list_goals or planJson — Goal.programId read here is the membership truth. " +
        "If no Program is active and no programId is given, returns a friendly error (create_program + " +
        "set_program_status to start one). Dates are yyyy-mm-dd in the user's local time zone.",
      inputSchema: {
        programId: z
          .string()
          .min(1)
          .optional()
          .describe("Program to inspect. Omit to resolve the currently ACTIVE Program."),
      },
    },
    async (input) =>
      safe(async () => {
        const r = await getProgramOverviewCore(input.programId);
        return {
          program: serializeProgram(r.program),
          memberGoals: r.memberGoals,
          rotationPlan: r.rotationPlan,
          attributionRules: r.attributionRules,
        };
      }),
  );
}
