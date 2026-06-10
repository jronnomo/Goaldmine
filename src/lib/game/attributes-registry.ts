// src/lib/game/attributes-registry.ts
// Attribute definitions + rule pack registry.
// CON label is "Consistency" (Post-v2 amendment #2 — NOT "Constitution").

import type { AttributeDef, GameRulePack } from "@/lib/game/types";

const FITNESS_ATTRIBUTES: AttributeDef[] = [
  {
    id: "STR",
    label: "Strength",
    feedsText: "Completed lifts, volume, PRs",
  },
  {
    id: "END",
    label: "Endurance",
    feedsText: "Cardio sessions, hikes, endurance PRs",
  },
  {
    id: "MOB",
    label: "Mobility",
    feedsText: "Mobility sessions, flexibility PRs",
  },
  {
    id: "CON",
    label: "Consistency",
    feedsText: "Streaks, plan adherence, logging habits, weekly reviews",
  },
];

export const FITNESS_RULE_PACK: GameRulePack = {
  goalKind: "fitness",
  attributes: FITNESS_ATTRIBUTES,
};

// Registry of all known rule packs. Add non-fitness packs here when they exist.
export const RULE_PACKS: GameRulePack[] = [FITNESS_RULE_PACK];

/**
 * Returns the rule pack for the given goal kind.
 * Falls back to the fitness pack when the kind is unknown or null — ensures
 * the engine always has a valid pack without crashing on missing data.
 */
export function rulePackForGoal(kind: string | null | undefined): GameRulePack {
  if (!kind) return FITNESS_RULE_PACK;
  return RULE_PACKS.find((p) => p.goalKind === kind) ?? FITNESS_RULE_PACK;
}
