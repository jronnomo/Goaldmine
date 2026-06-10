// src/lib/game/badges.ts
// 16 BadgeDef definitions + unlock predicates per blueprint §4.10.
// All predicates are pure — they read EngineContext only, no DB calls.

import { dateKey as toDateKey } from "@/lib/calendar";
import type { BadgeDef, UnlockedBadge, EngineContext } from "@/lib/game/types";
import { MILESTONE_XP } from "@/lib/game/rules";

type BadgeSpec = BadgeDef & {
  unlock: (ctx: EngineContext) => string | null;
};

const BADGE_SPECS: BadgeSpec[] = [
  // ── #1 First Blood ────────────────────────────────────────────────────────
  {
    id: "first-blood",
    name: "First Blood",
    hint: "Complete your first workout",
    monogram: "1st",
    unlock(ctx) {
      const w = ctx.workoutsAll.find((w) => w.status === "completed");
      return w ? toDateKey(w.startedAt) : null;
    },
  },

  // ── #2 On Record ──────────────────────────────────────────────────────────
  {
    id: "on-record",
    name: "On Record",
    hint: "Set your first PR",
    monogram: "PR",
    unlock(ctx) {
      return ctx.events.find((e) => e.ruleId === "pr.set")?.dateKey ?? null;
    },
  },

  // ── #3 PR Machine (10 PRs) ───────────────────────────────────────────────
  {
    id: "pr-machine",
    name: "PR Machine",
    hint: "Set 10 PRs",
    monogram: "×10",
    unlock(ctx) {
      const prEvents = ctx.events
        .filter((e) => e.ruleId === "pr.set")
        .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
      if (prEvents.length < 10) return null;
      return prEvents[9]!.dateKey; // dateKey of the 10th PR
    },
  },

  // ── #4 Baseline Scholar — all initial tests logged ────────────────────────
  {
    id: "baseline-scholar",
    name: "Baseline Scholar",
    hint: "Log all initial baseline tests",
    monogram: "BS",
    unlock(ctx) {
      if (ctx.requiredInitialTestNames.length === 0) return null;
      const seenNames = new Set<string>();
      const sortedBaselines = [...ctx.baselineLogged].sort((a, b) =>
        a.dateKey.localeCompare(b.dateKey),
      );
      for (const b of sortedBaselines) {
        if (ctx.requiredInitialTestNames.includes(b.testName)) {
          seenNames.add(b.testName);
          if (ctx.requiredInitialTestNames.every((n) => seenNames.has(n))) {
            return b.dateKey; // first date all initial tests were complete
          }
        }
      }
      return null;
    },
  },

  // ── #5 Retest Ritualist — any one checkpoint complete ─────────────────────
  {
    id: "retest-ritualist",
    name: "Retest Ritualist",
    hint: "Complete a full baseline retest checkpoint",
    monogram: "RT",
    unlock(ctx) {
      if (ctx.retestCheckpoints.length === 0) return null;

      // Build map: testName → earliest dateKey logged
      const loggedByName = new Map<string, string>();
      const sortedBaselines = [...ctx.baselineLogged].sort((a, b) =>
        a.dateKey.localeCompare(b.dateKey),
      );
      for (const b of sortedBaselines) {
        if (!loggedByName.has(b.testName)) {
          loggedByName.set(b.testName, b.dateKey);
        }
      }

      // Find earliest complete checkpoint
      let unlockDateKey: string | null = null;
      for (const checkpoint of ctx.retestCheckpoints) {
        if (checkpoint.testNames.every((n) => loggedByName.has(n))) {
          // Find when the last test in this checkpoint was logged
          const dates = checkpoint.testNames.map((n) => loggedByName.get(n)!);
          const latestForCp = dates.reduce((a, b) => (a > b ? a : b));
          if (unlockDateKey === null || latestForCp < unlockDateKey) {
            unlockDateKey = latestForCp;
          }
        }
      }
      return unlockDateKey;
    },
  },

  // ── #6 Trail Rat — first hike ─────────────────────────────────────────────
  {
    id: "trail-rat",
    name: "Trail Rat",
    hint: "Complete your first hike",
    monogram: "△",
    glyphFamily: "mountain",
    unlock(ctx) {
      const h = ctx.hikesAll.find((h) => h.status === "completed");
      return h ? toDateKey(h.date) : null;
    },
  },

  // ── #7 Vert Collector — 10,000 ft cumulative ──────────────────────────────
  {
    id: "vert-collector",
    name: "Vert Collector",
    hint: "Accumulate 10,000 ft elevation across all hikes",
    monogram: "10k",
    glyphFamily: "mountain",
    unlock(ctx) {
      let runningTotal = 0;
      const completed = [...ctx.hikesAll]
        .filter((h) => h.status === "completed")
        .sort((a, b) => a.date.getTime() - b.date.getTime());
      for (const hike of completed) {
        runningTotal += hike.elevationFt;
        if (runningTotal >= 10000) return toDateKey(hike.date);
      }
      return null;
    },
  },

  // ── #8 High Pointer — single hike ≥3,000 ft ──────────────────────────────
  {
    id: "high-pointer",
    name: "High Pointer",
    hint: "Complete a single hike with ≥3,000 ft elevation",
    monogram: "3k",
    glyphFamily: "mountain",
    unlock(ctx) {
      const hike = [...ctx.hikesAll]
        .filter((h) => h.status === "completed" && h.elevationFt >= 3000)
        .sort((a, b) => a.date.getTime() - b.date.getTime())[0];
      return hike ? toDateKey(hike.date) : null;
    },
  },

  // ── #9 Elbert Ready — single hike ≥4,000 ft ──────────────────────────────
  {
    id: "elbert-ready",
    name: "Elbert Ready",
    hint: "Complete a single hike with ≥4,000 ft elevation",
    monogram: "El",
    glyphFamily: "mountain",
    unlock(ctx) {
      const hike = [...ctx.hikesAll]
        .filter((h) => h.status === "completed" && h.elevationFt >= 4000)
        .sort((a, b) => a.date.getTime() - b.date.getTime())[0];
      return hike ? toDateKey(hike.date) : null;
    },
  },

  // ── #10 One Week Strong — 7-day streak ────────────────────────────────────
  {
    id: "one-week-strong",
    name: "One Week Strong",
    hint: "Reach a 7-day streak",
    monogram: "7d",
    glyphFamily: "flame",
    unlock(ctx) {
      const event = ctx.events
        .filter((e) => e.ruleId === "streak.milestone" && e.xp === MILESTONE_XP[7])
        .sort((a, b) => a.dateKey.localeCompare(b.dateKey))[0];
      return event?.dateKey ?? null;
    },
  },

  // ── #11 Fortnight Forge — 14-day streak ───────────────────────────────────
  {
    id: "fortnight-forge",
    name: "Fortnight Forge",
    hint: "Reach a 14-day streak",
    monogram: "14d",
    glyphFamily: "flame",
    unlock(ctx) {
      const event = ctx.events
        .filter((e) => e.ruleId === "streak.milestone" && e.xp === MILESTONE_XP[14])
        .sort((a, b) => a.dateKey.localeCompare(b.dateKey))[0];
      return event?.dateKey ?? null;
    },
  },

  // ── #12 Iron Month — 30-day streak ────────────────────────────────────────
  {
    id: "iron-month",
    name: "Iron Month",
    hint: "Reach a 30-day streak",
    monogram: "30d",
    glyphFamily: "flame",
    unlock(ctx) {
      const event = ctx.events
        .filter((e) => e.ruleId === "streak.milestone" && e.xp === MILESTONE_XP[30])
        .sort((a, b) => a.dateKey.localeCompare(b.dateKey))[0];
      return event?.dateKey ?? null;
    },
  },

  // ── #13 Set Centurion — 500 total sets ────────────────────────────────────
  // Engine pre-computes setCountByWorkoutId in EngineContext.
  {
    id: "set-centurion",
    name: "Set Centurion",
    hint: "Log 500 total sets",
    monogram: "5c",
    unlock(ctx) {
      let count = 0;
      const completed = [...ctx.workoutsAll]
        .filter((w) => w.status === "completed")
        .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
      for (const workout of completed) {
        count += ctx.setCountByWorkoutId.get(workout.id) ?? 0;
        if (count >= 500) return toDateKey(workout.startedAt);
      }
      return null;
    },
  },

  // ── #14 Hundred-Ton Hauler — 200,000 lb total volume ─────────────────────
  {
    id: "hundred-ton",
    name: "Hundred-Ton Hauler",
    hint: "Lift 200,000 lb total volume",
    monogram: "HT",
    unlock(ctx) {
      let runningTonnage = 0;
      const completed = [...ctx.workoutsAll]
        .filter((w) => w.status === "completed")
        .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
      for (const workout of completed) {
        runningTonnage += ctx.tonnageByWorkoutId.get(workout.id) ?? 0;
        if (runningTonnage >= 200000) return toDateKey(workout.startedAt);
      }
      return null;
    },
  },

  // ── #15 Clean Week — 7 consecutive days with ≥2 nutrition entries ─────────
  {
    id: "clean-week",
    name: "Clean Week",
    hint: "Log 7 consecutive days of 2+ nutrition entries",
    monogram: "7N",
    unlock(ctx) {
      // ctx.nutritionQualDays: sorted dateKeys with ≥2 entries
      let runLength = 0;
      let prevDk: string | null = null;
      for (const dk of ctx.nutritionQualDays) {
        if (prevDk !== null) {
          // daysBetween: (parseDateKey(b) - parseDateKey(a)) / 86400000
          // We compare as strings after confirming adjacency via numeric diff.
          const daysBetween = Math.round(
            (new Date(dk).getTime() - new Date(prevDk).getTime()) / 86400000,
          );
          if (daysBetween === 1) {
            runLength++;
            if (runLength >= 7) return dk; // dateKey of the 7th consecutive day
          } else {
            runLength = 1;
          }
        } else {
          runLength = 1;
        }
        prevDk = dk;
      }
      return null;
    },
  },

  // ── #16 Self-Examined — first weekly review ───────────────────────────────
  {
    id: "self-examined",
    name: "Self-Examined",
    hint: "Write your first weekly review",
    monogram: "✓",
    unlock(ctx) {
      return ctx.reviewNoteDateKeys[0] ?? null;
    },
  },
];

/** The catalog of all 16 badge definitions (without predicates — safe to export). */
export const BADGE_CATALOG: BadgeDef[] = BADGE_SPECS.map((spec) => ({
  id: spec.id,
  name: spec.name,
  hint: spec.hint,
  monogram: spec.monogram,
  ...(spec.glyphFamily !== undefined ? { glyphFamily: spec.glyphFamily } : {}),
}));

/**
 * Evaluate all 16 badges against the engine context.
 * Returns UnlockedBadge[] sorted: unlocked (dateKey non-null) asc, then locked.
 */
export function evaluateBadges(ctx: EngineContext): UnlockedBadge[] {
  const results: UnlockedBadge[] = BADGE_SPECS.map((spec) => ({
    def: BADGE_CATALOG.find((d) => d.id === spec.id)!,
    dateKey: spec.unlock(ctx),
  }));

  // Sort: unlocked first (by dateKey asc), locked last
  return results.sort((a, b) => {
    if (a.dateKey !== null && b.dateKey !== null) {
      return a.dateKey.localeCompare(b.dateKey);
    }
    if (a.dateKey !== null) return -1;
    if (b.dateKey !== null) return 1;
    return 0;
  });
}
