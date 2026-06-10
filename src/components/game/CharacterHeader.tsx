// src/components/game/CharacterHeader.tsx
// Two-row RPG header (~72px) above the hero on the Today page.
// Row 1: medallion · XP bar · streak flame
// Row 2: four attribute micro-bars + levels
// Entire header is a single tap target (≥44px; it's ~72px) → /character.
// Server component — no "use client".

import Link from "next/link";
import type { GameState } from "@/lib/game/types";
import { LevelMedallion } from "@/components/game/LevelMedallion";
import { LevelUpCelebration } from "@/components/game/LevelUpCelebration";
import { XpBar } from "@/components/game/XpBar";
import { AttributeBar } from "@/components/game/AttributeBar";
import { StreakFlame } from "@/components/game/StreakFlame";

type CharacterHeaderProps = {
  state: GameState;
};

export function CharacterHeader({ state }: CharacterHeaderProps) {
  return (
    <Link
      href="/character"
      data-testid="character-header"
      // Entire row is one tap target; min height 72px from the two rows + padding.
      className="flex flex-col gap-1.5 px-4 py-3 min-h-[72px] rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm mb-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      aria-label={`Character: Level ${state.level}, ${state.streak.current} day streak. Tap to view character sheet.`}
    >
      {/* Row 1: medallion (with LevelUpCelebration island) · XP bar · streak */}
      <div className="flex items-center gap-2.5">
        {/* Medallion wrapper: relative, sized to medallion so rings hug it (HIGH-5 fix) */}
        {/* Extra padding-bottom ensures chip doesn't clip */}
        <div
          className="relative shrink-0"
          style={{ width: 36, height: 36, marginBottom: 4 }}
        >
          <LevelMedallion
            level={state.level}
            progress={state.progress}
            size={36}
          />
          {/* Client island — reads localStorage, fires CSS ring burst on level up */}
          <LevelUpCelebration level={state.level} />
        </div>

        {/* Overall XP bar — fills remaining width; label shows xpIntoLevel / xpToNext */}
        <div className="flex-1 min-w-0">
          <XpBar
            value={state.xpIntoLevel}
            max={state.xpToNext}
            label={`${state.xpIntoLevel} / ${state.xpToNext}`}
            data-testid="xp-bar-overall"
          />
        </div>

        {/* Streak flame + count */}
        <StreakFlame
          count={state.streak.current}
          active={state.streak.current > 0}
        />
      </div>

      {/* Row 2: four attribute micro-bars */}
      <div className="flex items-center gap-3 flex-wrap">
        {state.attributes.map((attr) => (
          <AttributeBar key={attr.id} attr={attr} />
        ))}
      </div>
    </Link>
  );
}
