// src/lib/mcp/tools/program-tools.ts
// Program-layer MCP tools (#310/#311/#278, Sprint 17 seam flip) — the
// multi-domain Program container: lifecycle CRUD + status (#310), membership
// + overview (#311), and the manual activity-attribution valve (#278:
// attribute_activity / list_activity_links). The Program is the umbrella for
// a season of coordinated goals (fitness AND project) sharing one time
// window and one weekly rotation.
// Cores live in src/lib/program-core.ts and src/lib/attribution.ts
// (dual-caller contract: the same functions will back the /program dashboard
// and founder backfill later).

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
import { ACTIVITY_LINK_TYPES, type ActivityLinkType } from "@/lib/activity-links";
import {
  attributeActivityCore,
  listActivityLinksCore,
  LIST_ACTIVITY_LINKS_DEFAULT_LIMIT,
  LIST_ACTIVITY_LINKS_MAX_LIMIT,
  type ActivityLinkRow,
} from "@/lib/attribution";

/** Wire shape for an ActivityGoalLink row: activityDate as yyyy-mm-dd
 *  (USER_TZ calendar date), instants as ISO. Never includes userId. */
function serializeLink(l: ActivityLinkRow & { goalObjective?: string }) {
  return {
    id: l.id,
    activityType: l.activityType,
    activityId: l.activityId,
    goalId: l.goalId,
    ...(l.goalObjective !== undefined ? { goalObjective: l.goalObjective } : {}),
    source: l.source,
    note: l.note,
    activityDate: toDateKey(l.activityDate),
    createdAt: l.createdAt.toISOString(),
  };
}

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

  // --------------------------------------------------------------------------
  // attribute_activity (#278)
  // --------------------------------------------------------------------------
  server.registerTool(
    "attribute_activity",
    {
      title: "Manually attribute a logged activity to a goal (or remove a mislinked one)",
      description:
        "The MANUAL override valve on top of the auto-link engine: explicitly link one logged activity (a workout, " +
        "hike, meal, measurement, baseline, or metric reading) to a goal, or remove a link that is wrong. THE tool for " +
        "'count that hike toward the handstand goal too', 'that workout wasn't for the cut', 'the rules missed this one'. " +
        "action='add' creates a source='explicit' link; if an 'auto' link already exists for the same activity+goal it is " +
        "UPGRADED to 'explicit' in place (explicit beats auto — never a duplicate row). The link's activityDate is taken " +
        "from the ACTIVITY row's own date, never from today — retroactively attributing an old activity lands on the day " +
        "it happened. action='remove' deletes the link REGARDLESS of source — remove always wins, whether the link was " +
        "coach-added or rule-created; removing a link that doesn't exist is a friendly no-op. " +
        "Do NOT call this after every log — auto-linking already runs at write time from the Program's attributionRules " +
        "and each goal's attributionHints; use this only to correct or add what the rules missed. " +
        "Do NOT use it to change which goal an activity 'belongs' to in its own table (hikes have goalId, metrics have " +
        "goalId — edit those via update_hike / the metric tools); links are the cross-goal attribution layer on top.",
      inputSchema: {
        activityType: z
          .enum(ACTIVITY_LINK_TYPES as [ActivityLinkType, ...ActivityLinkType[]])
          .describe(
            "Which table the activityId comes from: workout | hike | nutrition | measurement | baseline | log_entry.",
          ),
        activityId: z
          .string()
          .min(1)
          .describe("Id of the activity row (from recent_history, list tools, or the log call's response)."),
        goalId: z.string().min(1).describe("Goal to attribute the activity to. Use list_goals to discover ids."),
        action: z
          .enum(["add", "remove"])
          .describe("add = create/upgrade an explicit link; remove = delete the link regardless of source."),
        note: z
          .string()
          .optional()
          .describe("Optional add-only annotation for WHY this activity counts (e.g. 'shoulder volume counts toward handstand')."),
        requestId: RequestIdShape,
      },
    },
    async (input) =>
      safe(async () => {
        const db = await getDb();
        return withWriteReceipt("attribute_activity", input.requestId, db, async () => {
          const r = await attributeActivityCore({
            activityType: input.activityType,
            activityId: input.activityId,
            goalId: input.goalId,
            action: input.action,
            note: input.note,
          });
          if (r.action === "remove") {
            return {
              action: r.action,
              changed: r.changed,
              removedSource: r.removedSource,
              message: r.changed
                ? `Link removed (was source='${r.removedSource}') — remove always wins, regardless of who created the link.`
                : "No link exists for that activity + goal — nothing to remove.",
            };
          }
          return {
            action: r.action,
            changed: r.changed,
            upgraded: r.upgraded,
            goalObjective: r.goalObjective,
            link: r.link ? serializeLink(r.link) : null,
            message: !r.changed
              ? `Already explicitly linked to "${r.goalObjective}" — no change.`
              : r.upgraded
                ? `Auto link upgraded to explicit for "${r.goalObjective}" (same row — no duplicate).`
                : `Activity explicitly linked to "${r.goalObjective}".`,
          };
        });
      }),
  );

  // --------------------------------------------------------------------------
  // list_activity_links (#278) — READ tool (leaky-reads coverage in
  // src/lib/mcp/leaky-reads.test.ts)
  // --------------------------------------------------------------------------
  server.registerTool(
    "list_activity_links",
    {
      title: "List activity→goal attribution links (what auto-linking + explicit attribution recorded)",
      description:
        "THE read for the attribution layer — the only way to see what got auto-attributed and what was explicitly " +
        "linked: 'what counted toward the handstand goal this week', 'which activities did the rules catch', 'audit the " +
        "auto-links before I trust them'. Returns links {id, activityType, activityId, goalId, goalObjective, source " +
        "(auto|explicit), note, activityDate, createdAt}, newest activity first. " +
        "Omit goalId to scope to ALL member goals of the ACTIVE Program (friendly error when no Program is active — pass " +
        "goalId then). from/to (yyyy-mm-dd, inclusive) filter on the link's activityDate — the day the ACTIVITY happened, " +
        "NOT when the link was created, so retroactively-attributed old activities appear in their real week. " +
        "truncated:true means more rows exist beyond limit (default 100) — narrow the window or raise limit. " +
        "Do NOT infer attribution from get_goal.attributionHints or the Program's attributionRules — those are the " +
        "matching CONFIG; the links returned here are what actually got recorded. " +
        "Do NOT use this to list the activities themselves — recent_history / list tools return the underlying rows.",
      inputSchema: {
        goalId: z
          .string()
          .min(1)
          .optional()
          .describe("Scope to one goal's links. Omit = all member goals of the active Program."),
        activityType: z
          .enum(ACTIVITY_LINK_TYPES as [ActivityLinkType, ...ActivityLinkType[]])
          .optional()
          .describe("Filter to one activity type (workout | hike | nutrition | measurement | baseline | log_entry)."),
        from: z
          .string()
          .optional()
          .describe("yyyy-mm-dd inclusive lower bound on activityDate (the activity's own day, USER_TZ)."),
        to: z
          .string()
          .optional()
          .describe("yyyy-mm-dd inclusive upper bound on activityDate."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(LIST_ACTIVITY_LINKS_MAX_LIMIT)
          .optional()
          .describe(`Max rows returned (default ${LIST_ACTIVITY_LINKS_DEFAULT_LIMIT}, cap ${LIST_ACTIVITY_LINKS_MAX_LIMIT}).`),
      },
    },
    async (input) =>
      safe(async () => {
        const r = await listActivityLinksCore({
          goalId: input.goalId,
          activityType: input.activityType,
          from: input.from ? parseDateInput(input.from) : undefined,
          to: input.to ? parseDateInput(input.to) : undefined,
          limit: input.limit,
        });
        return {
          scope: r.scope,
          count: r.links.length,
          truncated: r.truncated,
          links: r.links.map((l) => serializeLink(l)),
        };
      }),
  );
}
