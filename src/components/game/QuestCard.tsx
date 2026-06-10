// src/components/game/QuestCard.tsx
// Quest ribbon inside the Today hero: shows projected XP pre-training,
// earned XP breakdown post-training.
// Hosts TodayCelebration (moved from standalone hero use — one completion moment).
// Server component — no "use client".
//
// Per blueprint §6.1 / §D-3: QuestCard renders TodayCelebration internally,
// replacing the standalone TodayCelebration block in the hero.

import { TodayCelebration } from "@/components/TodayCelebration";
import type { QuestProjection } from "@/lib/game/types";

type QuestCardProps = {
  questToday: QuestProjection | null;
  completed: boolean;
  todayDateKey: string;
  stateLabel: string; // e.g. "Upper Power · 5×3 bench"
};

export function QuestCard({
  questToday,
  completed,
  todayDateKey,
  stateLabel,
}: QuestCardProps) {
  // No quest data (no active program or off-plan day) — fall back to the
  // bare Bullseye completion indicator (same as pre-gamification behaviour).
  if (!questToday) {
    return (
      <div
        className="flex items-center gap-2 mt-2 px-3 py-2 rounded-lg"
        style={{ background: "var(--accent-soft)" }}
        data-testid="quest-card"
      >
        {/* Left accent rule */}
        <div
          className="self-stretch w-0.5 rounded-full shrink-0"
          style={{ background: "var(--accent)" }}
          aria-hidden
        />
        <TodayCelebration completed={completed} dateKey={todayDateKey} />
        <span className="text-sm" style={{ color: "var(--muted)" }}>
          {stateLabel}
        </span>
      </div>
    );
  }

  const { projectedXp, earnedXp, earnedEvents, complete, bonusHints } =
    questToday;

  return (
    <div
      className="flex gap-2 mt-2 px-3 py-2 rounded-lg"
      style={{ background: "var(--accent-soft)" }}
      data-testid="quest-card"
    >
      {/* Left accent rule */}
      <div
        className="self-stretch w-0.5 rounded-full shrink-0"
        style={{ background: "var(--accent)" }}
        aria-hidden
      />

      {/* Bullseye completion indicator (hosts the bullseye-pop via TodayCelebration) */}
      <div className="shrink-0 pt-0.5">
        <TodayCelebration completed={complete} dateKey={todayDateKey} />
      </div>

      {/* Quest content */}
      <div className="flex-1 min-w-0">
        {complete ? (
          // POST-TRAINING: earned breakdown
          <>
            <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
              Quest complete{" "}
              <span
                className="tabular-nums"
                style={{ color: "var(--accent)" }}
              >
                +{earnedXp} XP
              </span>
            </p>
            <div className="mt-0.5 space-y-0.5">
              {earnedEvents.map((ev, i) => (
                <p key={i} className="text-xs tabular-nums" style={{ color: "var(--muted)" }}>
                  {ev.label}
                  {" "}
                  <span style={{ color: "var(--accent)" }}>+{ev.xp}</span>
                  {ev.attribute && (
                    <span className="ml-1 text-[10px] uppercase tracking-wider">
                      {ev.attribute}
                    </span>
                  )}
                </p>
              ))}
            </div>
          </>
        ) : (
          // PRE-TRAINING: projected XP + bonus hints
          <>
            <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
              {"Today's quest ·"}{" "}
              <span
                className="tabular-nums"
                style={{ color: "var(--accent)" }}
              >
                ~{projectedXp} XP
              </span>
            </p>
            {bonusHints.length > 0 && (
              <div className="mt-0.5 space-y-0.5">
                {bonusHints.map((hint, i) => (
                  <p key={i} className="text-xs" style={{ color: "var(--muted)" }}>
                    Bonus in play: {hint}
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
