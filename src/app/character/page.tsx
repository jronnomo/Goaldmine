// src/app/character/page.tsx
// /character — RPG character sheet.
// Order per UX §8: portrait → streak → attribute cards → badge wall → XP log → footnote.
// Server component. force-dynamic so XP updates appear on every open.
//
// INTEGRATION: swap FIXTURE_GAME_STATE import to computeGameState() from @/lib/game/engine
// when REQ-009 (integration stream) wires the real engine.

import { Card } from "@/components/Card";
import { LevelMedallion } from "@/components/game/LevelMedallion";
import { LevelUpCelebration } from "@/components/game/LevelUpCelebration";
import { XpBar } from "@/components/game/XpBar";
import { AttributeBar } from "@/components/game/AttributeBar";
import { StreakFlame } from "@/components/game/StreakFlame";
import { BadgeWall } from "@/components/game/BadgeWall";
import { XpEventList } from "@/components/game/XpEventList";
import { FIXTURE_GAME_STATE } from "@/lib/game/fixture";
import { rulePackForGoal } from "@/lib/game/attributes-registry";

export const dynamic = "force-dynamic";

// Streak milestone hint: next milestone above current streak count
const MILESTONES = [7, 14, 30, 60, 90] as const;
function nextStreakMilestone(current: number): number | null {
  return MILESTONES.find((m) => m > current) ?? null;
}

export default async function CharacterPage() {
  // INTEGRATION: replace the line below with `const state = await computeGameState();`
  const state = FIXTURE_GAME_STATE;

  // Hide gamification if no active program
  if (!state.goalKind) {
    return (
      <div className="max-w-md mx-auto p-4 space-y-4">
        <Card>
          <p className="text-sm text-center" style={{ color: "var(--muted)" }}>
            No active program. Start a program to unlock your character.
          </p>
        </Card>
      </div>
    );
  }

  const pack = rulePackForGoal(state.goalKind);
  const unlockedCount = state.badges.filter((b) => b.dateKey !== null).length;
  const nextMilestone = nextStreakMilestone(state.streak.current);

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">

      {/* 1. PORTRAIT — overall level + medallion + XP bar */}
      <Card>
        <div className="flex items-center gap-4">
          {/* Medallion wrapper — 64px; LevelUpCelebration rings fire on level up */}
          <div
            className="relative shrink-0"
            style={{ width: 64, height: 64, marginBottom: 6 }}
          >
            <LevelMedallion
              level={state.level}
              progress={state.progress}
              size={64}
            />
            {/* Only the portrait medallion fires the celebration (blueprint §6.2 note) */}
            <LevelUpCelebration level={state.level} />
          </div>

          {/* Level label + overall XP bar */}
          <div className="flex-1 min-w-0">
            <p className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
              <span style={{ fontFamily: "var(--font-display)" }}>
                Lv {state.level}
              </span>
              {" "}
              <span className="text-sm font-normal" style={{ color: "var(--muted)" }}>
                {state.goalKind === "fitness" ? "Adventurer" : state.goalKind}
              </span>
            </p>
            <div className="mt-2">
              <XpBar
                value={state.xpIntoLevel}
                max={state.xpToNext}
                label={`${state.xpIntoLevel} / ${state.xpToNext} XP`}
                data-testid="xp-bar-overall"
              />
            </div>
          </div>
        </div>
      </Card>

      {/* 2. STREAK */}
      <Card title="Streak">
        <div className="flex items-center gap-3">
          <StreakFlame
            count={state.streak.current}
            active={state.streak.current > 0}
          />
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
              {state.streak.current} day streak
              {state.streak.todayCounted && (
                <span className="ml-1 text-xs" style={{ color: "var(--success)" }}>
                  · today ✓
                </span>
              )}
            </p>
            <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
              Longest: {state.streak.longest} days
            </p>
            {nextMilestone !== null && (
              <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                Next: {nextMilestone}-day milestone in{" "}
                {nextMilestone - state.streak.current} days
              </p>
            )}
          </div>
        </div>
      </Card>

      {/* 3. ATTRIBUTE CARDS — 2×2 grid */}
      <div className="grid grid-cols-2 gap-3">
        {state.attributes.map((attr) => {
          // feedsText from registry def
          const attrDef = pack.attributes.find((d) => d.id === attr.id);
          return (
            <Card key={attr.id}>
              <div className="flex items-center gap-2 mb-2">
                {/* Small medallion (no LevelUpCelebration on attr cards per blueprint §6.2) */}
                <div className="relative shrink-0" style={{ width: 28, height: 28, marginBottom: 4 }}>
                  <LevelMedallion
                    level={attr.level}
                    progress={attr.progress}
                    size={28}
                  />
                </div>
                <div>
                  <p
                    className="text-sm font-semibold leading-tight"
                    style={{ color: "var(--foreground)" }}
                  >
                    {attr.label}
                  </p>
                  <p className="text-xs" style={{ color: "var(--muted)" }}>
                    Lv {attr.level}
                  </p>
                </div>
              </div>

              {/* Attribute XP bar with precise numbers */}
              <XpBar
                value={attr.xpIntoLevel}
                max={attr.xpToNext}
                label={`${attr.xpIntoLevel} / ${attr.xpToNext} XP`}
                data-testid={`xp-bar-${attr.id.toLowerCase()}`}
              />

              {/* Feeds line */}
              {attrDef && (
                <p
                  className="text-[10px] mt-1.5 leading-tight"
                  style={{ color: "var(--muted)" }}
                >
                  Feeds: {attrDef.feedsText}
                </p>
              )}

              {/* Also render AttributeBar for the micro-bar (sans numbers row — visual only) */}
              <div className="mt-2">
                <AttributeBar attr={attr} />
              </div>
            </Card>
          );
        })}
      </div>

      {/* 4. BADGE WALL */}
      <Card
        title="Badges"
        action={
          <span
            className="text-xs font-semibold tabular-nums"
            style={{ color: "var(--muted)" }}
          >
            {unlockedCount} / {state.badges.length}
          </span>
        }
      >
        <BadgeWall badges={state.badges} data-testid="badge-wall" />
      </Card>

      {/* 5. XP LOG */}
      <Card title="XP Log">
        <XpEventList events={state.recentEvents} data-testid="xp-event-list" />
      </Card>

      {/* 6. RETROACTIVITY FOOTNOTE */}
      <p
        className="text-xs text-center px-2 pb-4"
        style={{ color: "var(--muted)" }}
      >
        XP is derived from your full history and may shift when the plan or rules change.
      </p>
    </div>
  );
}
