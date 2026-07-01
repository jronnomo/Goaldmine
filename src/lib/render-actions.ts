"use server";

// src/lib/render-actions.ts
// Server actions for the Day page render-queue affordance (story #116 [A4]).
// Mirrors the queue_render_job MCP tool UPSERT semantics and the workout-actions.ts
// conventions: parse → prisma → revalidatePath → return user-visible message.

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { parseDateKey, dateKey as toDateKey } from "@/lib/calendar";

// Status groups — mirrors render-tools.ts
const TERMINAL_STATUSES = new Set(["rendered", "failed"]);

// ---------------------------------------------------------------------------
// queueRenderJob
// ---------------------------------------------------------------------------
// UPSERT semantics (mirrors queue_render_job MCP tool):
//   • No job → create pending.
//   • Existing in terminal (rendered | failed) → reset to pending.
//   • Existing in non-terminal → friendly no-op (don't clobber in-flight job).
//
// Focus goal is resolved via isFocus=true (single focus goal in this app).
// Date is parsed via parseDateKey to USER_TZ midnight (matches parseDateInput).
// ---------------------------------------------------------------------------
export async function queueRenderJob(form: FormData): Promise<{ message: string }> {
  const dateKeyStr = String(form.get("dateKey") ?? "").trim();
  const clipforgeProjectId = String(form.get("clipforgeProjectId") ?? "").trim();

  if (!dateKeyStr) throw new Error("Date is required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKeyStr)) {
    throw new Error("Invalid date format — expected yyyy-mm-dd");
  }
  if (!clipforgeProjectId) {
    throw new Error("ClipForge project ID is required");
  }

  // USER_TZ midnight — same as parseDateInput for yyyy-mm-dd strings
  const date = parseDateKey(dateKeyStr);

  const db = await getDb();

  // Resolve focus goal — error if none set
  const focusGoal = await db.goal.findFirst({
    where: { isFocus: true },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  if (!focusGoal) {
    throw new Error(
      "No focus goal is set. Ask your coach to set a focus goal first.",
    );
  }

  // Check existing job for (goalId, date) — unique constraint
  const existing = await db.dayRenderJob.findUnique({
    where: { goalId_date: { goalId: focusGoal.id, date } },
  });

  if (existing) {
    if (!TERMINAL_STATUSES.has(existing.status)) {
      // In-flight — return friendly no-op without clobbering
      return {
        message: `Render job is already in progress (status: ${existing.status}). It will update automatically.`,
      };
    }

    // Terminal — reset to pending, update clipforgeProjectId
    await db.dayRenderJob.update({
      where: { id: existing.id },
      data: {
        status: "pending",
        clipforgeProjectId,
        claimedAt: null,
        draftRef: null,
        approvedAt: null,
        renderedAt: null,
        outputRef: null,
        errorMessage: null,
      },
    });

    revalidatePath(`/days/${dateKeyStr}`);
    revalidatePath("/");
    return { message: `Render job reset from '${existing.status}' → pending.` };
  }

  // Create new pending job
  await db.dayRenderJob.create({
    data: {
      date,
      goalId: focusGoal.id,
      clipforgeProjectId,
      status: "pending",
    },
  });

  revalidatePath(`/days/${dateKeyStr}`);
  revalidatePath("/");
  return { message: "Render job queued." };
}

// ---------------------------------------------------------------------------
// approveRenderJob
// ---------------------------------------------------------------------------
// Transitions a job from 'drafted' → 'approved' + sets approvedAt.
// If the job is not in 'drafted' status, returns a friendly no-op message.
// ---------------------------------------------------------------------------
export async function approveRenderJob(form: FormData): Promise<{ message: string }> {
  const id = String(form.get("id") ?? "").trim();
  const dateKeyStr = String(form.get("dateKey") ?? "").trim();

  if (!id) throw new Error("Job ID is required");

  const db = await getDb();

  const job = await db.dayRenderJob.findUnique({
    where: { id },
    select: { id: true, status: true, date: true },
  });
  if (!job) throw new Error(`Render job not found: ${id}`);

  if (job.status !== "drafted") {
    return {
      message: `Job is in status '${job.status}' — nothing to approve yet.`,
    };
  }

  await db.dayRenderJob.update({
    where: { id },
    data: {
      status: "approved",
      approvedAt: new Date(),
    },
  });

  const dk = dateKeyStr || toDateKey(job.date);
  revalidatePath(`/days/${dk}`);
  revalidatePath("/");
  return { message: "Draft approved. Render will begin shortly." };
}
