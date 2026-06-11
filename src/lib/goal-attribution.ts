// src/lib/goal-attribution.ts
//
// Plain server lib — no server-action directive. Dual-caller: UI pages and
// MCP tools both import this.
//
// Provides:
//   parseAttributionHints  — safely coerce unknown Json? to string[]
//   lastTrainedForGoals    — ONE batched workoutExercise query over alias
//                            variants; canonicalize in memory; per-goal max
//                            startedAt. Uses startOfDay from @/lib/calendar
//                            for day diffs (USER_TZ-safe, not raw getDate).
//   relativeTrainedLabel   — "trained today" / "trained 3d ago" / "never trained"

import { prisma } from "@/lib/db";
import { startOfDay, dateKey } from "@/lib/calendar";
import { canonicalExerciseName, aliasVariantsFor } from "@/lib/records";

/**
 * Safely coerce an unknown Goal.attributionHints Json? field to string[].
 * Returns [] for null / undefined / non-array values.
 */
export function parseAttributionHints(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string");
}

/**
 * For each goal with attributionHints, return the most recent startedAt of any
 * workout containing an exercise that counts as training that goal.
 *
 * Uses ONE batched Prisma query over all alias variants across all goals.
 * Canonicalization happens in-memory after the query so Postgres only sees an
 * IN-list (mode:"insensitive" on Postgres — verified working on Prisma 7).
 *
 * @param goals  Array of goals with id + raw attributionHints Json.
 * @returns      Map<goalId, Date|null> — null when goal has no hints or no
 *               matching workout exercise was ever logged.
 */
export async function lastTrainedForGoals(
  goals: Array<{ id: string; attributionHints: unknown }>,
): Promise<Map<string, Date | null>> {
  const result = new Map<string, Date | null>();

  // Collect all canonical hints per goal and expand to alias variants
  const goalHintMap = new Map<string, string[]>(); // goalId → canonicals
  const allVariants = new Set<string>();

  for (const g of goals) {
    const hints = parseAttributionHints(g.attributionHints);
    if (hints.length === 0) {
      result.set(g.id, null);
      continue;
    }
    const canonicals = hints.map((h) => canonicalExerciseName(h));
    goalHintMap.set(g.id, canonicals);
    for (const c of canonicals) {
      for (const v of aliasVariantsFor(c)) {
        allVariants.add(v);
      }
    }
  }

  if (allVariants.size === 0) return result;

  // Single batched query — mode:"insensitive" is supported on Postgres in Prisma 7
  const rows = await prisma.workoutExercise.findMany({
    where: {
      name: { in: [...allVariants], mode: "insensitive" },
    },
    select: {
      name: true,
      workout: { select: { startedAt: true } },
    },
    orderBy: { workout: { startedAt: "desc" } },
  });

  // Build canonical → latest startedAt map (in memory)
  const canonicalLatest = new Map<string, Date>();
  for (const row of rows) {
    const canon = canonicalExerciseName(row.name);
    const existing = canonicalLatest.get(canon);
    if (!existing || row.workout.startedAt > existing) {
      canonicalLatest.set(canon, row.workout.startedAt);
    }
  }

  // Per-goal: max across all hinted canonicals
  for (const [goalId, canonicals] of goalHintMap) {
    let best: Date | null = null;
    for (const c of canonicals) {
      const d = canonicalLatest.get(c) ?? null;
      if (d && (!best || d > best)) best = d;
    }
    result.set(goalId, best);
  }

  return result;
}

/**
 * Human label for when a goal was last trained.
 * Uses dateKey (USER_TZ-aware) so day boundaries respect America/Denver.
 *
 * @param d   The most recent startedAt, or null if never trained.
 * @returns   "trained today" | "trained Nd ago" | "never trained"
 */
export function relativeTrainedLabel(d: Date | null): string {
  if (!d) return "no training logged";
  const nowSod = startOfDay(new Date());
  const trainedSod = startOfDay(d);
  // Compare via dateKey to avoid raw getDate() which is UTC-only on Vercel
  if (dateKey(trainedSod) === dateKey(nowSod)) return "trained today";
  const diffMs = nowSod.getTime() - trainedSod.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  return `trained ${diffDays}d ago`;
}
