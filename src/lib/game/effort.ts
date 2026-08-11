// src/lib/game/effort.ts
//
// The "Effort this Program" computation (UXR-PROG-42/43/44 ⚑ — gamification
// ships ONLY in the same PR as the perf spine; computeGameState's +10-query
// all-time fan-out rides the −400+ removals).
//
// R-GAME / R-SPLIT (recorded in EffortCard.tsx and enforced here by shape):
// this module produces WINDOW DELTAS only — attribute XP earned between two
// dateKeys inclusive. It never surfaces totals, levels, streaks or badges
// (those are /character's monotone lifetime state; no number appears on both
// surfaces). A delta can be small, can be zero, and resets next Program —
// the only property that lets a game number sit beside readiness.
//
// Pure — takes the engine's event list; the dateKey comparison is
// lexicographic (safe for yyyy-mm-dd — the compare.ts xpAsOf precedent).

import type { AttributeState, XpEvent } from "@/lib/game/types";

export type AttributeWindowXp = { id: string; label: string; xp: number };

export function attributeXpBetween(
  events: readonly XpEvent[],
  attributes: readonly Pick<AttributeState, "id" | "label">[],
  startKey: string,
  endKey: string,
): AttributeWindowXp[] {
  const byId = new Map<string, number>(attributes.map((a) => [a.id, 0]));
  for (const e of events) {
    if (e.attribute === null) continue; // unattributed XP is overall-only — /character's business
    if (e.dateKey < startKey || e.dateKey > endKey) continue;
    if (!byId.has(e.attribute)) continue;
    byId.set(e.attribute, byId.get(e.attribute)! + e.xp);
  }
  return attributes.map((a) => ({ id: a.id, label: a.label, xp: byId.get(a.id) ?? 0 }));
}
