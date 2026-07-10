// src/lib/baseline-format.ts
//
// Display formatters for baseline/records surfaces (baselines page,
// RecordsSummary), extracted (#236) from two near-identical local copies.
// Kept out of records.ts on purpose — records.ts is the core domain module
// (scheduling + PR detection) and stays display-free. Pure, server-safe,
// no Prisma imports. Types come from @/lib/records.

import type { CheckpointStatus, ScheduledBaseline } from "@/lib/records";

export function countByStatus(list: ScheduledBaseline[]): Record<CheckpointStatus, number> {
  const out: Record<CheckpointStatus, number> = { done: 0, due: 0, overdue: 0, upcoming: 0 };
  for (const s of list) {
    for (const c of s.checkpoints) out[c.status]++;
  }
  return out;
}

export function formatBest(e: {
  primary: string;
  bestValue: number;
  bestRaw: { weightLb: number | null; reps: number | null; durationSec: number | null };
}): string {
  if (e.primary === "rm") return `~${Math.round(e.bestValue)} lb 1RM (${e.bestRaw.weightLb} × ${e.bestRaw.reps})`;
  if (e.primary === "reps") return `${e.bestValue} reps`;
  if (e.primary === "duration") return formatDuration(e.bestValue);
  if (e.primary === "distance") return `${e.bestValue.toFixed(2)} mi`;
  if (e.primary === "time") return formatDuration(e.bestValue);
  return String(e.bestValue);
}

function formatDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function statusTextClass(s: CheckpointStatus): string {
  switch (s) {
    case "done":
      return "text-[var(--success)]";
    case "due":
      return "text-[var(--warning)]";
    case "overdue":
      return "text-[var(--danger)]";
    default:
      return "text-[var(--muted)]";
  }
}
