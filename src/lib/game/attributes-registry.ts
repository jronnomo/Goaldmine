// src/lib/game/attributes-registry.ts
// AttributeDef list for fitness (STR/END/MOB/CON), GameRulePack type usage,
// RULE_PACKS record, and rulePackForGoal(kind) with fitness fallback.

import type { AttributeDef, GameRulePack } from "@/lib/game/types";

// ─────────────────────────────────────────────────────────
// Fitness Attribute Definitions
// ─────────────────────────────────────────────────────────

const FITNESS_ATTRIBUTES: AttributeDef[] = [
  {
    id: "STR",
    label: "Strength",
    feedsText: "Completed lifts, volume, PRs",
  },
  {
    id: "END",
    label: "Endurance",
    feedsText: "Zone 2 cardio, hikes, long efforts",
  },
  {
    id: "MOB",
    label: "Mobility",
    feedsText: "Mobility sessions, flexibility PRs",
  },
  {
    id: "CON",
    label: "Constitution",
    feedsText: "Plan adherence, nutrition, baselines, streak milestones",
  },
];

// ─────────────────────────────────────────────────────────
// Rule Packs
// ─────────────────────────────────────────────────────────

export const FITNESS_RULE_PACK: GameRulePack = {
  goalKind: "fitness",
  attributes: FITNESS_ATTRIBUTES,
};

// Registry of all available rule packs keyed by goalKind.
// Add new packs here when non-fitness goal kinds are introduced.
export const RULE_PACKS: Record<string, GameRulePack> = {
  fitness: FITNESS_RULE_PACK,
};

// ─────────────────────────────────────────────────────────
// rulePackForGoal
// ─────────────────────────────────────────────────────────

/**
 * Return the GameRulePack for the given goal kind.
 * Falls back to the fitness pack for unknown kinds (including null/undefined).
 * This fallback ensures the engine always has a valid pack even when
 * the goal kind is unrecognised or no active goal exists.
 */
export function rulePackForGoal(kind: string | null | undefined): GameRulePack {
  if (kind !== null && kind !== undefined) {
    const pack = RULE_PACKS[kind];
    if (pack !== undefined) return pack;
  }
  return FITNESS_RULE_PACK;
}
