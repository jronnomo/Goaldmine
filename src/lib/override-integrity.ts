// src/lib/override-integrity.ts
//
// The general class behind the "phantom hike" bug, encoded ONCE so we don't hand-roll a
// new check per goal kind. A PlanDayOverride can MIRROR a first-class scheduled object —
// its workoutJson stands in as that object's session on the day. Today there is exactly
// one such object: a Hike (a hike-flavored "long-endurance" override). When the object is
// removed/rescheduled, only its own row is cleaned up; the mirror override survives and
// the day resolver surfaces it as a phantom session, invisible to the object's own tools.
//
// To add a new mirrored-object kind (a race row, an event, a future goal-kind's day
// object), add ONE entry to OVERRIDE_MIRROR_KINDS. The lint rule (orphaned-override
// findings), the resolver flag (ResolvedDay.orphanedOverride), and the removal warning
// (delete_hike, etc.) all read this registry — none of them are per-kind.
//
// Imports only from the leaf calendar-core (date helpers) + db, so calendar.ts can import
// isMirrorOverride from here without an import cycle.

import { prisma, getDb } from "@/lib/db";
import { dateKey, startOfDay, endOfDay } from "@/lib/calendar-core";

// One mirrored-object kind: how to recognize its mirror override, and which dates have a
// real backing row. `matches` is pure so the hot resolver path stays query-free;
// `backingDateKeys` is async (DB) and used by the lint + removal paths.
export type OverrideMirrorKind = {
  id: string; // lint rule id / telemetry — suppressible per kind via acknowledge_lint_finding
  label: string; // human label, e.g. "hike"
  matches: (workoutJson: unknown) => boolean; // is this override a mirror of this kind?
  backingDateKeys: () => Promise<Set<string>>; // dateKeys that DO have a backing row (any status)
  message: (dk: string) => string; // coach-facing finding / warning text
};

function hasCategory(workoutJson: unknown, category: string): boolean {
  return (
    typeof workoutJson === "object" &&
    workoutJson !== null &&
    (workoutJson as { category?: unknown }).category === category
  );
}

export const OVERRIDE_MIRROR_KINDS: OverrideMirrorKind[] = [
  {
    id: "orphaned-hike-override",
    label: "hike",
    // A hike day's session is the program's long-endurance slot; a custom hike override
    // (e.g. a named dress rehearsal) carries the same category. Heuristic — can over-match
    // a deliberate non-hike long-endurance override; callers treat it as a soft signal
    // (warning/flag), never an auto-delete.
    matches: (wj) => hasCategory(wj, "long-endurance"),
    backingDateKeys: async () => {
      const db = await getDb();
      return new Set(
        (await db.hike.findMany({ select: { date: true } })).map((h) => dateKey(h.date)),
      );
    },
    message: (dk) =>
      `The day override on ${dk} is a hike-flavored (long-endurance) session, but there is no Hike row on that date — a phantom hike. It likely outlived a removed or rescheduled hike: get_day shows it as the day's session while list_planned_hikes shows nothing. Clear it with clear_day_override, or replace it with the intended workout/baseline override.`,
  },
];

// Pure: does this override's content mirror ANY known first-class object? Safe in the hot
// resolver path (no DB). Powers the classification half of ResolvedDay.orphanedOverride.
export function isMirrorOverride(workoutJson: unknown): boolean {
  return OVERRIDE_MIRROR_KINDS.some((k) => k.matches(workoutJson));
}

export function matchingMirrorKind(workoutJson: unknown): OverrideMirrorKind | null {
  return OVERRIDE_MIRROR_KINDS.find((k) => k.matches(workoutJson)) ?? null;
}

// Removal/move guard: a coach-facing warning when `date` (on the active plan) carries a
// mirror override whose backing object no longer exists. null otherwise. Detect-and-guide
// only — never mutates.
export async function orphanedOverrideWarning(date: Date): Promise<string | null> {
  const db = await getDb();
  const plan = await db.plan.findFirst({
    where: { active: true },
    orderBy: [{ goal: { isFocus: "desc" } }, { updatedAt: "desc" }],
    select: { id: true },
  });
  if (!plan) return null;
  // non-scoped: PlanDayOverride has no userId FK — passes through ScopedClient untouched.
  const ov = await prisma.planDayOverride.findFirst({
    where: { planId: plan.id, date: { gte: startOfDay(date), lte: endOfDay(date) } },
    select: { workoutJson: true },
  });
  if (!ov) return null;
  const kind = matchingMirrorKind(ov.workoutJson);
  if (!kind) return null;
  const dk = dateKey(date);
  const backing = await kind.backingDateKeys();
  if (backing.has(dk)) return null; // a real backing row still exists — not orphaned
  return kind.message(dk);
}

// Lint: orphaned-override findings across the active plan's in-range overrides. The caller
// supplies the already-loaded, range-filtered overrides. backingDateKeys is queried once
// per kind and cached across overrides.
export async function findOrphanedOverrides(
  inRangeOverrides: { id: string; date: Date; workoutJson: unknown }[],
): Promise<{ overrideId: string; rule: string; date: Date; message: string }[]> {
  const out: { overrideId: string; rule: string; date: Date; message: string }[] = [];
  const backingCache = new Map<string, Set<string>>();
  for (const ov of inRangeOverrides) {
    const kind = matchingMirrorKind(ov.workoutJson);
    if (!kind) continue;
    let backing = backingCache.get(kind.id);
    if (!backing) {
      backing = await kind.backingDateKeys();
      backingCache.set(kind.id, backing);
    }
    const dk = dateKey(ov.date);
    if (backing.has(dk)) continue;
    out.push({ overrideId: ov.id, rule: kind.id, date: ov.date, message: kind.message(dk) });
  }
  return out;
}
