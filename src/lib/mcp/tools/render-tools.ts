// src/lib/mcp/tools/render-tools.ts
// Render-queue MCP tools — DayRenderJob lifecycle for the ClipForge automated
// render pipeline. Six tools cover the full worker protocol:
//   UI side:      queue_render_job (create / reset a job for a day)
//   Worker side:  list_render_jobs → claim_render_job → submit_render_draft
//                 → (user approves in UI) → start_render_job → complete_render_job
//
// ALL dates are handled via parseDateInput / dateKey — never new Date(bareString).

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { prisma, getDb } from "@/lib/db";
import { dateKey as toDateKey, startOfDay, endOfDay } from "@/lib/calendar";
import { safe, parseDateInput } from "@/lib/mcp/tool-helpers";

// Status groups
const TERMINAL_STATUSES = new Set(["rendered", "failed"]);
const ALL_STATUSES = ["pending", "claimed", "drafted", "approved", "rendering", "rendered", "failed"] as const;

export function registerRenderTools(server: McpServer): void {
  // --------------------------------------------------------------------------
  // queue_render_job
  // --------------------------------------------------------------------------
  server.registerTool(
    "queue_render_job",
    {
      title: "Queue a ClipForge render job for a day",
      description:
        "Create (or reset) a DayRenderJob for a given date and ClipForge project. " +
        "Normally called from the Day view after a user marks a day ready for rendering. " +
        "UPSERT semantics: " +
        "• If no job exists for (goalId, date) → create a new pending job. " +
        "• If a job exists in a TERMINAL state (rendered | failed) → reset it to pending " +
        "  (clears claimedAt, draftRef, approvedAt, renderedAt, outputRef, errorMessage; " +
        "  updates clipforgeProjectId to the new value). " +
        "• If a job exists in any non-terminal state (pending | claimed | drafted | approved | rendering) " +
        "  → return it as-is with a descriptive message (never clobber an in-flight job). " +
        "goalId defaults to the current FOCUS goal (isFocus=true) when omitted — " +
        "error returned if no focus goal is set.",
      inputSchema: {
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "use yyyy-mm-dd")
          .describe(
            "The day to render, yyyy-mm-dd in the user's local time zone. " +
            "Stored as USER_TZ midnight via parseDateInput.",
          ),
        clipforgeProjectId: z
          .string()
          .min(1)
          .describe(
            "ClipForge project id to associate with this render job. Required — " +
            "the worker uses this to locate the correct ClipForge project when rendering.",
          ),
        goalId: z
          .string()
          .optional()
          .describe(
            "Goal to attach this render job to. Omit to use the current FOCUS goal. " +
            "Use list_goals to discover goal ids.",
          ),
      },
    },
    async (input) =>
      safe(async () => {
        const db = await getDb();

        // 1. Resolve goalId — default to focus goal
        let resolvedGoalId: string;
        if (input.goalId) {
          const goal = await db.goal.findUnique({
            where: { id: input.goalId },
            select: { id: true },
          });
          if (!goal) throw new Error(`Goal not found: ${input.goalId}`);
          resolvedGoalId = goal.id;
        } else {
          const focusGoal = await db.goal.findFirst({
            where: { isFocus: true },
            orderBy: { updatedAt: "desc" },
            select: { id: true },
          });
          if (!focusGoal) {
            throw new Error(
              "No focus goal is set. Pass goalId explicitly, or set a goal to focus with set_active_goal first.",
            );
          }
          resolvedGoalId = focusGoal.id;
        }

        // 2. Parse date as USER_TZ midnight
        const date = parseDateInput(input.date);

        // 3. Check existing job for this (goalId, date)
        const existing = await db.dayRenderJob.findUnique({
          where: { goalId_date: { goalId: resolvedGoalId, date } },
        });

        if (existing) {
          if (!TERMINAL_STATUSES.has(existing.status)) {
            // In-flight — return as-is, don't clobber
            return {
              id: existing.id,
              date: toDateKey(existing.date),
              status: existing.status,
              message:
                `Render job is already in-flight (status: ${existing.status}). ` +
                "Complete or fail it before re-queuing.",
            };
          }

          // Terminal — reset to pending
          const reset = await db.dayRenderJob.update({
            where: { id: existing.id },
            data: {
              status: "pending",
              clipforgeProjectId: input.clipforgeProjectId,
              claimedAt: null,
              draftRef: null,
              approvedAt: null,
              renderedAt: null,
              outputRef: null,
              errorMessage: null,
            },
            select: { id: true, date: true, status: true },
          });

          return {
            id: reset.id,
            date: toDateKey(reset.date),
            status: reset.status,
            message: `Render job reset from '${existing.status}' → pending.`,
          };
        }

        // 4. Create new pending job
        const job = await db.dayRenderJob.create({
          data: {
            date,
            goalId: resolvedGoalId,
            clipforgeProjectId: input.clipforgeProjectId,
            status: "pending",
          },
          select: { id: true, date: true, status: true },
        });

        return {
          id: job.id,
          date: toDateKey(job.date),
          status: job.status,
          message: "Render job queued.",
        };
      }),
  );

  // --------------------------------------------------------------------------
  // list_render_jobs
  // --------------------------------------------------------------------------
  server.registerTool(
    "list_render_jobs",
    {
      title: "List ClipForge render jobs",
      description:
        "Query DayRenderJobs with optional filters. Results are ordered date ascending " +
        "(oldest first) so the GPU-box worker can trivially pick the next pending job. " +
        "Filter by status (e.g. 'pending') and/or a date range. " +
        "Use: list pending jobs to find work; list 'approved' jobs to find ones ready to render; " +
        "list all to audit the queue. " +
        "Default limit is 50; max 200.",
      inputSchema: {
        status: z
          .enum(ALL_STATUSES)
          .optional()
          .describe(
            "Filter by status: pending | claimed | drafted | approved | rendering | rendered | failed. " +
            "Omit to return jobs in any status.",
          ),
        from: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "use yyyy-mm-dd")
          .optional()
          .describe("Start of date range (yyyy-mm-dd, inclusive, USER_TZ start-of-day). Omit for no lower bound."),
        to: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "use yyyy-mm-dd")
          .optional()
          .describe("End of date range (yyyy-mm-dd, inclusive, USER_TZ end-of-day). Omit for no upper bound."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(50)
          .describe("Max jobs to return. Default 50; max 200."),
      },
    },
    async (input) =>
      safe(async () => {
        const dateFilter: { gte?: Date; lte?: Date } = {};
        if (input.from) dateFilter.gte = startOfDay(parseDateInput(input.from));
        if (input.to) dateFilter.lte = endOfDay(parseDateInput(input.to));

        // SYSTEM: raw prisma — cross-user worker op; worker scans all users' pending jobs (Phase 1: multi-tenant worker pattern)
        const jobs = await prisma.dayRenderJob.findMany({
          where: {
            ...(input.status ? { status: input.status } : {}),
            ...(input.from || input.to ? { date: dateFilter } : {}),
          },
          orderBy: { date: "asc" },
          take: input.limit,
          select: {
            id: true,
            date: true,
            goalId: true,
            status: true,
            clipforgeProjectId: true,
            draftRef: true,
            outputRef: true,
            errorMessage: true,
            claimedAt: true,
            approvedAt: true,
            renderedAt: true,
            createdAt: true,
          },
        });

        return {
          count: jobs.length,
          jobs: jobs.map((j) => ({
            id: j.id,
            date: toDateKey(j.date),
            goalId: j.goalId,
            status: j.status,
            clipforgeProjectId: j.clipforgeProjectId,
            draftRef: j.draftRef,
            outputRef: j.outputRef,
            errorMessage: j.errorMessage,
            claimedAt: j.claimedAt?.toISOString() ?? null,
            approvedAt: j.approvedAt?.toISOString() ?? null,
            renderedAt: j.renderedAt?.toISOString() ?? null,
            createdAt: j.createdAt.toISOString(),
          })),
        };
      }),
  );

  // --------------------------------------------------------------------------
  // claim_render_job
  // --------------------------------------------------------------------------
  server.registerTool(
    "claim_render_job",
    {
      title: "Atomically claim a pending render job (worker use)",
      description:
        "Atomically transition a render job from 'pending' → 'claimed' and record claimedAt. " +
        "ATOMIC: uses updateMany with where:{id, status:'pending'} — if another worker already " +
        "claimed it, result.count === 0 and claimed:false is returned (safe to poll). " +
        "Worker flow: list_render_jobs(status:'pending') → pick next → claim_render_job → " +
        "process → submit_render_draft. " +
        "Returns { id, claimed: bool, message }.",
      inputSchema: {
        id: z.string().describe("ID of the DayRenderJob to claim. Must be in 'pending' status."),
      },
    },
    async (input) =>
      safe(async () => {
        // SYSTEM: raw prisma — cross-user worker op; atomic claim by id, job may belong to any user (Phase 1: worker claims cross-user)
        const result = await prisma.dayRenderJob.updateMany({
          where: { id: input.id, status: "pending" },
          data: { status: "claimed", claimedAt: new Date() },
        });

        const claimed = result.count === 1;
        return {
          id: input.id,
          claimed,
          message: claimed
            ? "Job claimed successfully."
            : "Job could not be claimed — it may already be claimed by another worker or is not in 'pending' status.",
        };
      }),
  );

  // --------------------------------------------------------------------------
  // submit_render_draft
  // --------------------------------------------------------------------------
  server.registerTool(
    "submit_render_draft",
    {
      title: "Submit a render draft for user review",
      description:
        "After the worker generates a ClipForge draft, call this to advance the job from " +
        "'claimed' → 'drafted' and attach the draftRef (opaque ClipForge draft id). " +
        "The user then reviews the draft in the ClipForge UI and approves it (setting status → 'approved') " +
        "before the final render is kicked off via start_render_job. " +
        "If the job is not currently in 'claimed' status, a friendly message is returned and no write is made — " +
        "check the job status with list_render_jobs if unexpected. " +
        "Optional notes are merged into the job's payload for human-readable draft commentary.",
      inputSchema: {
        id: z.string().describe("ID of the DayRenderJob to submit a draft for. Expected status: 'claimed'."),
        draftRef: z
          .string()
          .min(1)
          .describe("Opaque ClipForge draft id or URL returned by the ClipForge draft API."),
        notes: z
          .string()
          .optional()
          .describe(
            "Optional human-readable notes about the draft (e.g. 'used alt track', 'subtitle font adjusted'). " +
            "Merged into the job's payload.notes field.",
          ),
      },
    },
    async (input) =>
      safe(async () => {
        // SYSTEM: raw prisma — cross-user worker op; findUnique by id not by owner (Phase 1: worker submits draft for any user's job)
        const job = await prisma.dayRenderJob.findUnique({
          where: { id: input.id },
          select: { id: true, status: true, payload: true },
        });
        if (!job) throw new Error(`Render job not found: ${input.id}`);

        if (job.status !== "claimed") {
          return {
            id: input.id,
            status: job.status,
            message:
              `Job is in status '${job.status}' — expected 'claimed'. ` +
              "Check list_render_jobs for the current job state.",
          };
        }

        // Merge notes into existing payload (if any)
        const existingPayload =
          job.payload && typeof job.payload === "object" && !Array.isArray(job.payload)
            ? (job.payload as Record<string, unknown>)
            : {};
        const newPayload = input.notes !== undefined
          ? { ...existingPayload, notes: input.notes }
          : existingPayload;

        // SYSTEM: raw prisma — cross-user worker op; update by id not by owner (Phase 1: worker submits draft for any user's job)
        const updated = await prisma.dayRenderJob.update({
          where: { id: input.id },
          data: {
            status: "drafted",
            draftRef: input.draftRef,
            payload: newPayload as import("@/generated/prisma/client").Prisma.InputJsonValue,
          },
          select: { id: true, status: true, draftRef: true },
        });

        return {
          id: updated.id,
          status: updated.status,
          draftRef: updated.draftRef,
          message: "Draft submitted. Waiting for user approval before final render.",
        };
      }),
  );

  // --------------------------------------------------------------------------
  // start_render_job
  // --------------------------------------------------------------------------
  server.registerTool(
    "start_render_job",
    {
      title: "Start the final render (after user approval)",
      description:
        "Atomically transition a render job from 'approved' → 'rendering' so the GPU worker can begin the final render. " +
        "ATOMIC: uses updateMany with where:{id, status:'approved'} — if the job was not approved " +
        "(e.g. still in 'drafted' or already 'rendering'), started:false is returned safely. " +
        "Worker flow after draft: user approves in UI → start_render_job → render → complete_render_job. " +
        "claimedAt is updated to now to record when the render run started. " +
        "Returns { id, started: bool, message }.",
      inputSchema: {
        id: z.string().describe("ID of the DayRenderJob to start rendering. Must be in 'approved' status."),
      },
    },
    async (input) =>
      safe(async () => {
        // SYSTEM: raw prisma — cross-user worker op; atomic start by id, job may belong to any user (Phase 1: worker starts cross-user render)
        const result = await prisma.dayRenderJob.updateMany({
          where: { id: input.id, status: "approved" },
          data: { status: "rendering", claimedAt: new Date() },
        });

        const started = result.count === 1;
        return {
          id: input.id,
          started,
          message: started
            ? "Render started."
            : "Render could not be started — job is not in 'approved' status. " +
              "The user must approve the draft before the final render can begin.",
        };
      }),
  );

  // --------------------------------------------------------------------------
  // complete_render_job
  // --------------------------------------------------------------------------
  server.registerTool(
    "complete_render_job",
    {
      title: "Complete or fail a render job",
      description:
        "Mark a DayRenderJob as 'rendered' (success) or 'failed' (error). " +
        "On 'rendered': sets renderedAt to now and stores outputRef (the reel URL or opaque id returned by ClipForge). " +
        "The UI renders outputRef as a clickable link when it starts with http(s); otherwise it is displayed as plain text. " +
        "On 'failed': stores errorMessage for triage. " +
        "A failed job can be re-queued via queue_render_job (which resets it to pending). " +
        "Returns { id, status, outputRef, message }.",
      inputSchema: {
        id: z.string().describe("ID of the DayRenderJob to complete or fail."),
        status: z
          .enum(["rendered", "failed"])
          .describe("Final status: 'rendered' (success) or 'failed' (error)."),
        outputRef: z
          .string()
          .optional()
          .describe(
            "Opaque reel URL or id from ClipForge (e.g. 'https://clipforge.example/reels/abc123'). " +
            "Required when status='rendered'; ignored on 'failed'. " +
            "The UI renders this as a link when it starts with http(s), else as plain text.",
          ),
        errorMessage: z
          .string()
          .optional()
          .describe(
            "Human-readable error description for triage. " +
            "Required when status='failed'; ignored on 'rendered'. " +
            "Re-queue via queue_render_job after addressing the error.",
          ),
      },
    },
    async (input) =>
      safe(async () => {
        const now = new Date();

        const data =
          input.status === "rendered"
            ? {
                status: "rendered" as const,
                renderedAt: now,
                outputRef: input.outputRef ?? null,
                errorMessage: null,
              }
            : {
                status: "failed" as const,
                renderedAt: null,
                errorMessage: input.errorMessage ?? null,
                outputRef: null,
              };

        // SYSTEM: raw prisma — cross-user worker op; completes/fails job by id for any user (Phase 1: worker finalizes cross-user render)
        let updated: { id: string; status: string; outputRef: string | null };
        try {
          updated = await prisma.dayRenderJob.update({
            where: { id: input.id },
            data,
            select: { id: true, status: true, outputRef: true },
          });
        } catch (e) {
          if ((e as { code?: string }).code === "P2025") {
            throw new Error(`Render job not found: ${input.id}`);
          }
          throw e;
        }

        return {
          id: updated.id,
          status: updated.status,
          outputRef: updated.outputRef,
          message:
            updated.status === "rendered"
              ? "Render complete." + (updated.outputRef ? ` Output: ${updated.outputRef}` : "")
              : "Render marked as failed. Re-queue via queue_render_job after fixing the error.",
        };
      }),
  );
}
