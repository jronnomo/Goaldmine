"use client";

// src/components/days/RenderJobPanel.tsx
// Queue-for-render + approve-render affordance for the Day page (story #116 [A4]).
// Renders inside the Footage CollapsibleCard.
//
// Lifecycle displayed:
//   no job / terminal   → "Queue for render" form (clipforgeProjectId input + button)
//   pending | claimed   → status badge (in-progress, no user action needed)
//   drafted             → status badge + "Approve render" button
//   approved | rendering → status badge (in-progress)
//   rendered            → status badge + outputRef as link (http/https) or plain text
//   failed              → status badge + errorMessage + re-queue form

import { useState, useTransition } from "react";
import { queueRenderJob, approveRenderJob } from "@/lib/render-actions";

// ---------------------------------------------------------------------------
// Serialized type — all dates as ISO strings, never Date objects.
// Exported so page.tsx can build and type-check before passing.
// ---------------------------------------------------------------------------

export type SerializedRenderJob = {
  id: string;
  /** pending | claimed | drafted | approved | rendering | rendered | failed */
  status: string;
  clipforgeProjectId: string | null;
  draftRef: string | null;
  approvedAt: string | null; // ISO string
  outputRef: string | null;
  errorMessage: string | null;
};

// ---------------------------------------------------------------------------
// Status display helpers
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<string, string> = {
  pending: "Queued",
  claimed: "Processing",
  drafted: "Draft ready — awaiting approval",
  approved: "Approved",
  rendering: "Rendering",
  rendered: "Complete",
  failed: "Failed",
};

function statusColor(status: string): string {
  switch (status) {
    case "drafted":
      return "var(--warning)";
    case "failed":
      return "var(--danger)";
    case "rendered":
      return "var(--success)";
    case "pending":
      return "var(--muted)";
    default:
      return "var(--accent)"; // claimed | approved | rendering
  }
}

const TERMINAL_STATUSES = new Set(["rendered", "failed"]);

// ---------------------------------------------------------------------------
// RenderJobPanel
// ---------------------------------------------------------------------------

interface RenderJobPanelProps {
  dateKey: string; // yyyy-mm-dd — written as hidden field for queue action
  job: SerializedRenderJob | null;
}

export function RenderJobPanel({ dateKey, job }: RenderJobPanelProps) {
  // Show the queue form when there is no job or the job is in a terminal state.
  const showQueueForm = !job || TERMINAL_STATUSES.has(job.status);

  // Pre-fill clipforgeProjectId from an existing job so a re-queue is one click.
  const [clipforgeProjectId, setClipforgeProjectId] = useState(
    job?.clipforgeProjectId ?? "",
  );

  const [queueError, setQueueError] = useState<string | null>(null);
  const [queueMsg, setQueueMsg] = useState<string | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [approveMsg, setApproveMsg] = useState<string | null>(null);

  const [isQueuePending, startQueueTransition] = useTransition();
  const [isApprovePending, startApproveTransition] = useTransition();

  function handleQueue() {
    setQueueError(null);
    setQueueMsg(null);
    const fd = new FormData();
    fd.set("dateKey", dateKey);
    fd.set("clipforgeProjectId", clipforgeProjectId.trim());
    startQueueTransition(async () => {
      try {
        const result = await queueRenderJob(fd);
        setQueueMsg(result.message);
      } catch (e) {
        setQueueError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  function handleApprove() {
    if (!job) return;
    setApproveError(null);
    setApproveMsg(null);
    const fd = new FormData();
    fd.set("id", job.id);
    fd.set("dateKey", dateKey);
    startApproveTransition(async () => {
      try {
        const result = await approveRenderJob(fd);
        setApproveMsg(result.message);
      } catch (e) {
        setApproveError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  const color = job ? statusColor(job.status) : "var(--muted)";

  return (
    <div className="border-t border-[var(--border)] pt-3 mt-3 space-y-3">
      <p className="text-xs uppercase tracking-wide text-[var(--muted)] font-medium">
        ClipForge render
      </p>

      {/* ── Status badge + lifecycle controls ── */}
      {job && (
        <div className="space-y-2">
          {/* Status pill */}
          <span
            className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border"
            style={{
              color,
              borderColor: color,
              backgroundColor: `color-mix(in srgb, ${color} 12%, var(--card))`,
            }}
          >
            {STATUS_LABELS[job.status] ?? job.status}
          </span>

          {/* Approve section — only when drafted */}
          {job.status === "drafted" && (
            <div className="space-y-2">
              <p className="text-xs text-[var(--muted)]">
                Review the draft in ClipForge, then approve to kick off the final render.
              </p>
              {job.draftRef && (
                <p className="text-xs text-[var(--muted)] break-all">
                  Draft ref: {job.draftRef}
                </p>
              )}
              <button
                type="button"
                onClick={handleApprove}
                disabled={isApprovePending}
                className="min-h-[44px] w-full rounded-xl bg-[var(--accent)] text-[var(--accent-fg)] font-semibold text-sm disabled:opacity-50 transition px-4"
              >
                {isApprovePending ? "Approving…" : "Approve render"}
              </button>
              {approveMsg && (
                <p className="text-xs text-[var(--accent)]" role="status" aria-live="polite">
                  {approveMsg}
                </p>
              )}
              {approveError && (
                <p className="text-xs text-[var(--danger)]" role="alert">
                  {approveError}
                </p>
              )}
            </div>
          )}

          {/* Reel link or plain text — when rendered */}
          {job.status === "rendered" && job.outputRef && (
            <div>
              {/^https?:\/\//i.test(job.outputRef) ? (
                <a
                  href={job.outputRef}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-[var(--accent)] underline"
                >
                  ▶ Open Reel
                </a>
              ) : (
                <p className="text-sm text-[var(--muted)]">Reel: {job.outputRef}</p>
              )}
            </div>
          )}

          {/* Error detail — when failed */}
          {job.status === "failed" && job.errorMessage && (
            <p className="text-xs text-[var(--danger)]">
              Error: {job.errorMessage}
            </p>
          )}
        </div>
      )}

      {/* ── Queue / re-queue form ── shown when no job or job is terminal */}
      {showQueueForm && (
        <div className="space-y-2">
          {job?.status === "failed" && (
            <p className="text-xs text-[var(--muted)]">
              Re-queue to try again after fixing the error.
            </p>
          )}
          <div className="flex flex-col gap-1">
            <label
              htmlFor="render-cfp-id"
              className="text-xs font-medium text-[var(--muted)]"
            >
              ClipForge project ID{" "}
              <span aria-hidden className="text-[var(--danger)]">
                *
              </span>
            </label>
            <p className="text-xs text-[var(--muted)]">
              Files must already be ingested into this ClipForge project.
            </p>
            <input
              id="render-cfp-id"
              type="text"
              value={clipforgeProjectId}
              onChange={(e) => setClipforgeProjectId(e.target.value)}
              placeholder="proj_abc123"
              className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm min-h-[44px] placeholder:text-[var(--muted)]"
            />
          </div>
          <button
            type="button"
            onClick={handleQueue}
            disabled={isQueuePending || !clipforgeProjectId.trim()}
            className="min-h-[44px] w-full rounded-xl bg-[var(--accent)] text-[var(--accent-fg)] font-semibold text-sm disabled:opacity-50 transition px-4"
          >
            {isQueuePending ? "Queuing…" : "Queue for render"}
          </button>
          {queueMsg && (
            <p className="text-xs text-[var(--accent)]" role="status" aria-live="polite">
              {queueMsg}
            </p>
          )}
          {queueError && (
            <p className="text-xs text-[var(--danger)]" role="alert">
              {queueError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
