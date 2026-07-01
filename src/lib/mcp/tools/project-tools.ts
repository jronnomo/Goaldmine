// src/lib/mcp/tools/project-tools.ts
// Project-domain MCP tools — ScheduledItem lifecycle + LogEntry observations.
// These tools are for project (non-fitness) goals only. Fitness tools live in
// tools.ts (log_workout, log_hike, log_baseline, log_measurement, etc.).

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { dateKey as toDateKey, startOfDay, endOfDay } from "@/lib/calendar";
import { setFocusGoalCore } from "@/lib/goal-core";
import { safe, parseDateInput } from "@/lib/mcp/tool-helpers";
import { getLogMetricSeries } from "@/lib/metric-series";
import type { GoalTarget } from "@/lib/metrics-registry";

export function registerProjectTools(server: McpServer): void {
  // --------------------------------------------------------------------------
  // schedule_item
  // --------------------------------------------------------------------------
  server.registerTool(
    "schedule_item",
    {
      title: "Schedule a project milestone, task, or review item",
      description:
        "Create a ScheduledItem on a project (non-fitness) goal — milestones, tasks, launch steps, or review sessions. " +
        "For project goals only; do NOT use for fitness activities — use log_workout, log_hike, log_baseline, " +
        "or log_measurement for those. The goal must exist and be kind='project'; passing a fitness goal id " +
        "returns a friendly error directing to the correct tools. Status is set to 'planned'. " +
        "Returns the created item id and the date serialized as yyyy-mm-dd in USER_TZ. " +
        "externalRef is optional; if provided it must be unique per goal (e.g. GitHub milestone node id) — " +
        "a duplicate triggers a friendly error naming the conflict.",
      inputSchema: {
        goalId: z
          .string()
          .describe("ID of the project goal to attach this item to. Must be kind='project'."),
        date: z
          .string()
          .describe(
            "Scheduled date in yyyy-mm-dd format. Stored as USER_TZ midnight. " +
            "Never pass a full ISO string here — use the date portion only.",
          ),
        type: z
          .string()
          .min(1)
          .describe(
            "Item type. Open enum — common values: task | milestone | launch-step | review.",
          ),
        title: z
          .string()
          .min(1)
          .max(500)
          .describe("Short title for the scheduled item (max 500 chars)."),
        detail: z
          .string()
          .optional()
          .describe("Optional longer description or notes for the item."),
        payload: z
          .unknown()
          .optional()
          .describe(
            "Optional JSON payload for arbitrary metadata (e.g. GitHub milestone node data). " +
            "Stored as-is; not interpreted by the app.",
          ),
        externalRef: z
          .string()
          .optional()
          .describe(
            "Optional external reference key (e.g. GitHub milestone node id). " +
            "Must be unique per goal — a duplicate triggers a friendly error.",
          ),
      },
    },
    async (input) =>
      safe(async () => {
        const db = await getDb();

        // 1. Goal existence + kind check
        const goal = await db.goal.findUnique({
          where: { id: input.goalId },
          select: { id: true, kind: true },
        });
        if (!goal) throw new Error(`Goal not found: ${input.goalId}`);
        if (goal.kind !== "project") {
          throw new Error(
            `Goal ${input.goalId} is kind='${goal.kind}'. ` +
            `Use fitness tools (log_workout, log_hike, log_baseline, log_measurement) ` +
            `for fitness goals — project tools are for kind='project' goals only.`,
          );
        }

        // 2. Parse date — USER_TZ midnight
        const date = parseDateInput(input.date);

        // 3. Create with P2002 guard for externalRef collision
        // NOTE: @@unique([goalId, externalRef]) only fires for non-null externalRef values
        // (Postgres NULL != NULL semantics — multiple items without externalRef always succeed).
        let item;
        try {
          item = await db.scheduledItem.create({
            data: {
              goalId: input.goalId,
              date,
              type: input.type,
              title: input.title,
              detail: input.detail ?? null,
              payload:
                input.payload !== undefined
                  ? (input.payload as Prisma.InputJsonValue)
                  : undefined,
              status: "planned",
              externalRef: input.externalRef ?? null,
            },
          });
        } catch (e) {
          // @@unique([goalId, externalRef]) violation
          if ((e as { code?: string }).code === "P2002") {
            throw new Error(
              `Duplicate externalRef "${input.externalRef}" already exists on goal ${input.goalId}. ` +
              `Each externalRef must be unique per goal.`,
            );
          }
          throw e;
        }

        return {
          id: item.id,
          goalId: item.goalId,
          date: toDateKey(item.date),
          type: item.type,
          title: item.title,
          status: item.status,
          message: "Item scheduled.",
        };
      }),
  );

  // --------------------------------------------------------------------------
  // delete_scheduled_item
  // --------------------------------------------------------------------------
  server.registerTool(
    "delete_scheduled_item",
    {
      title: "Hard-delete a scheduled item",
      description:
        "Permanently delete a ScheduledItem by id. For project goals only — do NOT use for workouts or hikes; " +
        "use delete_workout or delete_hike for those. Returns a friendly error if the item does not exist " +
        "(second delete of the same id returns a friendly error, not an exception). " +
        "No cascade — deletes only the item itself.",
      inputSchema: {
        id: z.string().describe("ID of the ScheduledItem to permanently delete."),
      },
    },
    async (input) =>
      safe(async () => {
        const db = await getDb();

        // Single-round-trip delete: attempt delete, catch P2025 for not-found case.
        // No findUnique-first — delete_scheduled_item needs no row data in its response.
        try {
          await db.scheduledItem.delete({ where: { id: input.id } });
        } catch (e) {
          if ((e as { code?: string }).code === "P2025") {
            throw new Error(`Scheduled item not found: ${input.id}`);
          }
          throw e;
        }

        return {
          id: input.id,
          deleted: true,
          message: "Scheduled item deleted.",
        };
      }),
  );

  // --------------------------------------------------------------------------
  // complete_item
  // --------------------------------------------------------------------------
  server.registerTool(
    "complete_item",
    {
      title: "Mark a scheduled item as done",
      description:
        "Set a ScheduledItem's status to 'done' and record a completedAt timestamp. " +
        "For project goals only — do NOT use for workouts or hikes; use log_workout or log_hike for those. " +
        "completedAt defaults to the current instant (now) if omitted — use this for marking things done right now. " +
        "Pass a bare yyyy-mm-dd to record USER_TZ midnight for that date, or a full ISO string for a precise moment. " +
        "Returns the updated id, status, and completedAt as an ISO string.",
      inputSchema: {
        id: z.string().describe("ID of the ScheduledItem to mark as done."),
        completedAt: z
          .string()
          .optional()
          .describe(
            "Completion timestamp. Bare yyyy-mm-dd → USER_TZ midnight for that date; " +
            "full ISO string → parsed verbatim. Omit to default to current instant (now).",
          ),
      },
    },
    async (input) =>
      safe(async () => {
        const db = await getDb();

        // Default completedAt = current instant (NOT midnight — per PRD §4.5)
        const completedAt = input.completedAt
          ? parseDateInput(input.completedAt)
          : new Date();

        // Single-round-trip update: attempt update, catch P2025 for not-found case.
        // No findUnique-first — complete_item needs no pre-existing row data; the
        // update result supplies all returned fields.
        let updated: { id: string; status: string; completedAt: Date | null };
        try {
          updated = await db.scheduledItem.update({
            where: { id: input.id },
            data: { status: "done", completedAt },
            select: { id: true, status: true, completedAt: true },
          });
        } catch (e) {
          if ((e as { code?: string }).code === "P2025") {
            throw new Error(`Scheduled item not found: ${input.id}`);
          }
          throw e;
        }

        return {
          id: updated.id,
          status: updated.status,
          completedAt: updated.completedAt!.toISOString(),
          message: "Item marked done.",
        };
      }),
  );

  // --------------------------------------------------------------------------
  // update_scheduled_item
  // --------------------------------------------------------------------------
  server.registerTool(
    "update_scheduled_item",
    {
      title: "Patch a scheduled item's fields",
      description:
        "Update one or more fields of an existing ScheduledItem (title, detail, date, status, type). " +
        "For project goals only — do NOT use for workouts. True PATCH semantics: only explicitly provided fields change; " +
        "omitted fields are unchanged. Passing only {id} with no additional fields returns a friendly message " +
        "and performs no write. status must be one of: planned | done | skipped. " +
        "date must be yyyy-mm-dd and is stored as USER_TZ midnight. Returns the updated fields alongside the id.",
      inputSchema: {
        id: z.string().describe("ID of the ScheduledItem to update."),
        title: z
          .string()
          .min(1)
          .max(500)
          .optional()
          .describe("New title (max 500 chars). Omit to leave unchanged."),
        detail: z
          .string()
          .optional()
          .describe("New longer description or notes. Omit to leave unchanged."),
        date: z
          .string()
          .optional()
          .describe(
            "New scheduled date in yyyy-mm-dd format (USER_TZ midnight). Omit to leave unchanged.",
          ),
        status: z
          .enum(["planned", "done", "skipped"])
          .optional()
          .describe("New status. One of: planned | done | skipped. Omit to leave unchanged."),
        type: z
          .string()
          .min(1)
          .optional()
          .describe("New item type (e.g. task | milestone | launch-step | review). Omit to leave unchanged."),
      },
    },
    async (input) =>
      safe(async () => {
        const db = await getDb();
        const { id, ...fields } = input;

        // 1. Existence check FIRST (S-4: gives "not found" even on no-op call with stale id).
        //    findUnique is kept here — unlike delete/complete, update_scheduled_item needs
        //    it to provide correct "not found" feedback on the no-op path where no
        //    subsequent update call would catch P2025.
        const item = await db.scheduledItem.findUnique({
          where: { id },
          select: { id: true },
        });
        if (!item) throw new Error(`Scheduled item not found: ${id}`);

        // 2. No-op guard — return friendly message, no write
        if (
          fields.title === undefined &&
          fields.detail === undefined &&
          fields.date === undefined &&
          fields.status === undefined &&
          fields.type === undefined
        ) {
          return {
            message: "Nothing to update — provide at least one field (title, detail, date, status, type).",
          };
        }

        // 3. Build PATCH data object using Prisma-generated type (D-1)
        const data: Prisma.ScheduledItemUpdateInput = {};
        if (fields.title !== undefined) data.title = fields.title;
        if (fields.detail !== undefined) data.detail = fields.detail;
        if (fields.date !== undefined) data.date = parseDateInput(fields.date);
        if (fields.status !== undefined) data.status = fields.status;
        if (fields.type !== undefined) data.type = fields.type;

        // 4. Update with select (S-2: avoids fetching payload Json) + P2025 catch
        //    (D-2: closes the TOCTOU window between findUnique and update)
        let updated: { id: string; title: string; detail: string | null; date: Date; status: string; type: string };
        try {
          updated = await db.scheduledItem.update({
            where: { id },
            data,
            select: { id: true, title: true, detail: true, date: true, status: true, type: true },
          });
        } catch (e) {
          if ((e as { code?: string }).code === "P2025") {
            throw new Error(`Scheduled item not found: ${id}`);
          }
          throw e;
        }

        // 5. Return only the fields that were changed (plus id and message) — PATCH semantics
        const result: Record<string, unknown> = {
          id: updated.id,
          message: "Item updated.",
        };
        if (fields.title !== undefined) result.title = updated.title;
        if (fields.detail !== undefined) result.detail = updated.detail;
        if (fields.date !== undefined) result.date = toDateKey(updated.date);
        if (fields.status !== undefined) result.status = updated.status;
        if (fields.type !== undefined) result.type = updated.type;

        return result;
      }),
  );

  // --------------------------------------------------------------------------
  // list_scheduled_items
  // --------------------------------------------------------------------------
  server.registerTool(
    "list_scheduled_items",
    {
      title: "List scheduled items for a project goal",
      description:
        "Query ScheduledItems for a project goal with optional filters: date range (from/to as yyyy-mm-dd), " +
        "status (planned|done|skipped), and type (exact match). For project goals only — do NOT use for workouts or hikes. " +
        "Results ordered date descending. Nonexistent goalId returns a friendly error. " +
        "Use to answer 'what's planned this sprint', 'what milestones are open', 'what did we complete this month'. " +
        "Default limit is 50; max 200.",
      inputSchema: {
        goalId: z.string().describe("ID of the project goal whose scheduled items to query."),
        from: z
          .string()
          .optional()
          .describe(
            "Start of date range in yyyy-mm-dd (inclusive). Mapped to USER_TZ start-of-day.",
          ),
        to: z
          .string()
          .optional()
          .describe(
            "End of date range in yyyy-mm-dd (inclusive). Mapped to USER_TZ end-of-day.",
          ),
        status: z
          .enum(["planned", "done", "skipped"])
          .optional()
          .describe("Filter by status. Omit to return all statuses."),
        type: z
          .string()
          .optional()
          .describe("Filter by item type (exact match, e.g. 'milestone'). Omit to return all types."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(50)
          .describe("Max items to return. Default 50."),
      },
    },
    async (input) =>
      safe(async () => {
        const db = await getDb();

        // Verify goal exists (friendly error on bad goalId)
        const goal = await db.goal.findUnique({
          where: { id: input.goalId },
          select: { id: true },
        });
        if (!goal) throw new Error(`Goal not found: ${input.goalId}`);

        // Build where clause conditionally
        const dateFilter: { gte?: Date; lte?: Date } = {};
        if (input.from) dateFilter.gte = startOfDay(parseDateInput(input.from));
        if (input.to) dateFilter.lte = endOfDay(parseDateInput(input.to));

        const where: Prisma.ScheduledItemWhereInput = {
          goalId: input.goalId,
          ...(input.from || input.to ? { date: dateFilter } : {}),
          ...(input.status ? { status: input.status } : {}),
          ...(input.type ? { type: input.type } : {}),
        };

        const items = await db.scheduledItem.findMany({
          where,
          orderBy: { date: "desc" },
          take: input.limit,
          select: {
            id: true,
            goalId: true,
            date: true,
            type: true,
            title: true,
            detail: true,
            status: true,
            completedAt: true,
            externalRef: true,
            createdAt: true,
          },
        });

        return {
          count: items.length,
          items: items.map((item) => ({
            id: item.id,
            goalId: item.goalId,
            date: toDateKey(item.date),             // yyyy-mm-dd USER_TZ
            type: item.type,
            title: item.title,
            detail: item.detail,
            status: item.status,
            completedAt: item.completedAt?.toISOString() ?? null,  // ISO or null
            externalRef: item.externalRef,
            createdAt: item.createdAt.toISOString(),               // ISO
          })),
        };
      }),
  );

  // --------------------------------------------------------------------------
  // log_metric
  // --------------------------------------------------------------------------
  server.registerTool(
    "log_metric",
    {
      title: "Log a project metric observation",
      description:
        "Record a numeric or text metric observation (MRR, downloads, milestone count, etc.) as a LogEntry " +
        "on a project goal. For project goals only — do NOT use for body metrics (use log_measurement for " +
        "weight/HR/body fat) or fitness baselines (use log_baseline for benchmark tests). " +
        "Passing a fitness goalId returns a friendly error. " +
        "At least one of value or text is required — both cannot be omitted; a friendly error is returned if both are missing. " +
        "Store the bare metric key without any 'log:' prefix (e.g. 'mrr', not 'log:mrr'). " +
        "date defaults to the current instant if omitted. Duplicate (same metric + date) calls create separate rows — intended for time-series.",
      inputSchema: {
        goalId: z.string().describe("ID of the project goal to log this metric against. Must be kind='project'."),
        metric: z
          .string()
          .min(1)
          .describe(
            "Bare metric key (e.g. 'mrr', 'downloads', 'milestones_done'). " +
            "No 'log:' prefix — store the key portion only.",
          ),
        value: z
          .number()
          .optional()
          .describe(
            "Numeric metric value (e.g. MRR in USD, download count). " +
            "At least one of value or text is required.",
          ),
        text: z
          .string()
          .optional()
          .describe(
            "Text observation (e.g. a launch note, milestone description). " +
            "At least one of value or text is required.",
          ),
        date: z
          .string()
          .optional()
          .describe(
            "Observation date. Bare yyyy-mm-dd → USER_TZ midnight; full ISO string → parsed verbatim. " +
            "Defaults to current instant (not midnight) if omitted.",
          ),
        source: z
          .enum(["manual", "github", "claude"])
          .default("manual")
          .describe("Source of this metric entry. Default: manual."),
      },
    },
    async (input) =>
      safe(async () => {
        const db = await getDb();

        // 1. value-or-text required guard — check FIRST before any DB call
        if (input.value === undefined && input.text === undefined) {
          throw new Error(
            "Provide value and/or text — both cannot be omitted for a metric log entry.",
          );
        }

        // 2. Verify goal exists AND is a project goal (D-3: prevents silently writing
        //    metric rows to fitness goals, which would corrupt goal-type semantics)
        const goal = await db.goal.findUnique({
          where: { id: input.goalId },
          select: { id: true, kind: true },
        });
        if (!goal) throw new Error(`Goal not found: ${input.goalId}`);
        if (goal.kind !== "project") {
          throw new Error(
            `Goal ${input.goalId} is kind='${goal.kind}'. ` +
            `log_metric is for project goals only — use log_measurement for body metrics ` +
            `or log_baseline for benchmark tests.`,
          );
        }

        // 3. date: current instant default, not midnight (per PRD §4.5)
        const date = input.date ? parseDateInput(input.date) : new Date();

        const entry = await db.logEntry.create({
          data: {
            goalId: input.goalId,
            metric: input.metric,
            value: input.value ?? null,
            text: input.text ?? null,
            date,
            source: input.source,
            // payload omitted — not exposed in this tool
          },
        });

        return {
          id: entry.id,
          goalId: entry.goalId,
          metric: entry.metric,
          value: entry.value,
          text: entry.text,
          date: entry.date.toISOString(),        // ISO — per PRD §4.2
          source: entry.source,
          message: "Metric logged.",
        };
      }),
  );

  // --------------------------------------------------------------------------
  // list_log_entries
  // --------------------------------------------------------------------------
  server.registerTool(
    "list_log_entries",
    {
      title: "List metric log entries for a project goal",
      description:
        "Query LogEntry metric observations for a project goal, optionally filtered by metric key and/or date range. " +
        "For project goals only — do NOT use for body measurements or fitness baselines. " +
        "Results ordered date descending (newest first). Nonexistent goalId returns a friendly error. " +
        "Use to answer 'what was the MRR trend', 'how many downloads this month'. " +
        "Note: the date field is returned as an ISO string (not yyyy-mm-dd) — LogEntry.date is an instant, not a calendar date; " +
        "contrast with list_scheduled_items where date is yyyy-mm-dd. " +
        "Default limit is 50; max 500.",
      inputSchema: {
        goalId: z.string().describe("ID of the project goal whose log entries to query."),
        metric: z
          .string()
          .optional()
          .describe(
            "Filter by metric key (exact match, e.g. 'mrr'). Omit to return all metrics.",
          ),
        from: z
          .string()
          .optional()
          .describe("Start of date range yyyy-mm-dd (inclusive, USER_TZ start-of-day)."),
        to: z
          .string()
          .optional()
          .describe("End of date range yyyy-mm-dd (inclusive, USER_TZ end-of-day)."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(50)
          .describe("Max entries to return. Default 50."),
      },
    },
    async (input) =>
      safe(async () => {
        const db = await getDb();

        const goal = await db.goal.findUnique({
          where: { id: input.goalId },
          select: { id: true },
        });
        if (!goal) throw new Error(`Goal not found: ${input.goalId}`);

        const dateFilter: { gte?: Date; lte?: Date } = {};
        if (input.from) dateFilter.gte = startOfDay(parseDateInput(input.from));
        if (input.to) dateFilter.lte = endOfDay(parseDateInput(input.to));

        const where: Prisma.LogEntryWhereInput = {
          goalId: input.goalId,
          ...(input.metric ? { metric: input.metric } : {}),
          ...(input.from || input.to ? { date: dateFilter } : {}),
        };

        const entries = await db.logEntry.findMany({
          where,
          orderBy: { date: "desc" },
          take: input.limit,
          select: {
            id: true,
            goalId: true,
            date: true,
            metric: true,
            value: true,
            text: true,
            source: true,
            createdAt: true,
          },
        });

        return {
          count: entries.length,
          entries: entries.map((e) => ({
            id: e.id,
            goalId: e.goalId,
            date: e.date.toISOString(),           // ISO — per PRD §4.2; see description note
            metric: e.metric,
            value: e.value,
            text: e.text,
            source: e.source,
            createdAt: e.createdAt.toISOString(), // ISO
          })),
        };
      }),
  );

  // --------------------------------------------------------------------------
  // delete_metric
  // --------------------------------------------------------------------------
  server.registerTool(
    "delete_metric",
    {
      title: "Hard-delete a logged metric entry",
      description:
        "Permanently delete a LogEntry by id. For project goals only — LogEntry rows only exist on project goals " +
        "(log_metric enforces kind='project'). Returns the deleted metric key and value as confirmation. " +
        "Returns a friendly error if the entry does not exist (second delete of the same id returns a friendly error, " +
        "not an exception). No cascade — deletes only the entry itself. " +
        "This is the retraction path for a mislogged metric (wrong value/date, snapshot-vs-cumulative mistake). " +
        "Use list_log_entries to find the id before calling this tool.",
      inputSchema: {
        id: z
          .string()
          .min(1)
          .describe("ID of the LogEntry to permanently delete (from list_log_entries)."),
      },
    },
    async (input) =>
      safe(async () => {
        const db = await getDb();

        // Single-round-trip delete: use the returned row to confirm metric+value.
        // No findUnique-first — capture deleted row from db.logEntry.delete().
        let row: { id: string; metric: string; value: number | null };
        try {
          row = await db.logEntry.delete({
            where: { id: input.id },
            select: { id: true, metric: true, value: true },
          });
        } catch (e) {
          if ((e as { code?: string }).code === "P2025") {
            throw new Error(`Log entry not found: ${input.id}`);
          }
          throw e;
        }

        return {
          id: row.id,
          metric: row.metric,
          value: row.value,
          deleted: true,
          message: "Metric entry deleted.",
        };
      }),
  );

  // --------------------------------------------------------------------------
  // get_metric_trend
  // --------------------------------------------------------------------------
  server.registerTool(
    "get_metric_trend",
    {
      title: "Get a project goal's metric time-series for charting or discussion",
      description:
        "Returns a project goal's log: metric time-series (points + label + units + domain) " +
        "for charting or discussion. Project goals only — passing a fitness goal id returns a " +
        "friendly error. Reuses the same series logic as the dashboard (snapshot vs. cumulative, " +
        "domain padding) so the coach sees exactly what the chart shows. " +
        "Pass the bare metric key (e.g. 'mrr', 'practice_hours') — the 'log:' prefix is accepted " +
        "but not required. Returns an empty points array with a valid domain if no readings exist. " +
        "Use list_log_entries to inspect raw rows; use this tool when you want the chart-ready series " +
        "(running totals for cumulative metrics, domain bounds for discussion).",
      inputSchema: {
        goalId: z.string().describe("ID of the project goal. Must be kind='project'."),
        metric: z
          .string()
          .min(1)
          .describe(
            "Metric key to retrieve. Bare key (e.g. 'mrr', 'practice_hours') or with 'log:' prefix — " +
            "both forms are accepted and normalized. Must match a target defined on the goal.",
          ),
      },
    },
    async (input) =>
      safe(async () => {
        const db = await getDb();

        // 1. Fetch goal kind + targets — friendly error if missing or wrong kind.
        const goal = await db.goal.findUnique({
          where: { id: input.goalId },
          select: { kind: true, targets: true },
        });
        if (!goal) throw new Error(`Goal not found: ${input.goalId}`);
        if (goal.kind !== "project") {
          throw new Error(
            `Goal ${input.goalId} is kind='${goal.kind}'. ` +
            `get_metric_trend is for project goals only — use get_exercise_history or ` +
            `get_baseline_history for fitness metrics.`,
          );
        }

        // 2. Normalize bare key → "log:" prefixed form for target lookup.
        const bare = input.metric.replace(/^log:/, "");
        const targets = (goal.targets as unknown as GoalTarget[]) ?? [];
        const target = targets.find((t) => t.metric === "log:" + bare);
        if (!target) {
          throw new Error(
            `Metric "log:${bare}" is not defined as a target on goal ${input.goalId}. ` +
            `Check get_goal for the list of configured targets.`,
          );
        }

        // 3. Reuse getLogMetricSeries — same logic as the dashboard chart.
        const s = await getLogMetricSeries(target, input.goalId);

        return {
          metric: "log:" + bare,
          label: s.label,
          units: s.units,
          domain: s.domain,
          points: s.points,
        };
      }),
  );

  // --------------------------------------------------------------------------
  // set_active_goal
  // --------------------------------------------------------------------------
  server.registerTool(
    "set_active_goal",
    {
      title: "Switch which goal drives Today/Calendar (focus goal)",
      description:
        "Set the focus goal — the goal whose plan drives get_today_plan, the Today page, and the calendar. " +
        "Exactly one goal holds focus at a time; this clears focus from ALL other goals (they stay tracked, " +
        "their plans and events remain visible — only the daily-prescription driver changes). " +
        "Focusing a goal also re-activates its most recent plan if it was paused, and re-tracks an untracked goal. " +
        "Works for any goal kind — switch between a fitness goal and a project goal (e.g. chewgether) and back. " +
        "If the user is mid-program on a fitness goal, confirm before switching: per operating rules, propose the " +
        "switch, use list_goals to show their goals, and get explicit approval first. " +
        "Returns the new focus goal (id, kind, objective) and the previous focus goal id. " +
        "After this call, get_today_plan reflects the new focus goal (focusGoal.kind, todayItems for project goals).",
      inputSchema: {
        goalId: z
          .string()
          .describe(
            "The goal to focus. All other goals lose focus (but stay tracked). " +
              "Use list_goals to discover goal ids.",
          ),
      },
    },
    async (input) =>
      safe(async () => {
        const { previousFocusGoalId, goal } = await setFocusGoalCore(input.goalId);
        return {
          focusGoalId: goal.id,
          kind: goal.kind,
          objective: goal.objective,
          previousFocusGoalId,
          message:
            `Focus switched to "${goal.objective}" (kind=${goal.kind}). ` +
            "get_today_plan now reflects this goal.",
        };
      }),
  );
}
