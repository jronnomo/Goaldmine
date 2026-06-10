// src/components/game/XpEventList.tsx
// XP event log: last N events, sorted most-recent first.
// Coach bonuses (ruleId: "bonus.coach") marked with a ✦ glyph + accent-soft tint.
// Server component — no "use client".

import type { XpEvent } from "@/lib/game/types";

type XpEventListProps = {
  events: XpEvent[];
  "data-testid"?: string;
};

function EventRow({ ev }: { ev: XpEvent }) {
  const isCoachBonus = ev.ruleId === "bonus.coach";

  return (
    <div
      className="flex items-baseline gap-2 py-1.5"
      style={
        isCoachBonus
          ? { background: "var(--accent-soft)", borderRadius: 6, padding: "4px 6px", marginInline: -6 }
          : undefined
      }
    >
      {/* Coach bonus marker */}
      {isCoachBonus && (
        <span
          className="text-xs shrink-0"
          style={{ color: "var(--accent)" }}
          aria-label="Coach bonus"
        >
          ✦
        </span>
      )}

      {/* Date */}
      <span
        className="text-[10px] tabular-nums shrink-0"
        style={{ color: "var(--muted)" }}
      >
        {ev.dateKey.slice(5)} {/* "MM-DD" */}
      </span>

      {/* Label */}
      <span className="flex-1 text-xs min-w-0 truncate" style={{ color: "var(--foreground)" }}>
        {ev.label}
      </span>

      {/* Attribute tag */}
      {ev.attribute && (
        <span
          className="text-[10px] uppercase tracking-wider shrink-0"
          style={{ color: "var(--muted)" }}
        >
          {ev.attribute}
        </span>
      )}

      {/* XP amount */}
      <span
        className="text-xs tabular-nums font-semibold shrink-0"
        style={{ color: "var(--accent)" }}
      >
        +{ev.xp}
      </span>
    </div>
  );
}

export function XpEventList({ events, "data-testid": testId }: XpEventListProps) {
  if (events.length === 0) {
    return (
      <p
        className="text-sm"
        style={{ color: "var(--muted)" }}
        data-testid={testId}
      >
        No XP events yet — log a workout to start earning.
      </p>
    );
  }

  return (
    <div
      className="divide-y divide-[var(--border)]"
      data-testid={testId}
    >
      {events.map((ev, i) => (
        <EventRow key={`${ev.dateKey}-${ev.ruleId}-${i}`} ev={ev} />
      ))}
    </div>
  );
}
