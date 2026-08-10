// src/lib/mcp/tools/program-tools.ts
// Program-layer MCP tools (#310/#311, Sprint 17 seam flip) — the multi-domain
// Program container: lifecycle CRUD + status. The Program is the umbrella for
// a season of coordinated goals (fitness AND project) sharing one time window
// and one weekly rotation. Cores live in src/lib/program-core.ts (dual-caller
// contract: same functions will back the /program dashboard later).

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
}
