// src/components/game/AttributeBar.tsx
// Attribute label + level + micro-bar row for the CharacterHeader (no XP numbers).
// Server component — no "use client".

import type { AttributeState } from "@/lib/game/types";

type AttributeBarProps = {
  attr: Pick<AttributeState, "id" | "label" | "level" | "progress">;
  "data-testid"?: string;
};

export function AttributeBar({ attr, "data-testid": testId }: AttributeBarProps) {
  const pct = Math.min(1, Math.max(0, attr.progress));
  // Abbreviation: use 3-char id (STR, END, MOB, CON)
  const abbr = attr.id.length <= 3 ? attr.id : attr.id.slice(0, 3);

  return (
    <div
      className="flex items-center gap-1 min-w-0"
      data-testid={testId ?? `attr-bar-${attr.id.toLowerCase()}`}
    >
      <span
        className="text-[10px] font-semibold tracking-wider uppercase shrink-0"
        style={{ color: "var(--muted)" }}
        aria-hidden
      >
        {abbr}
      </span>
      <span
        className="text-[10px] font-bold tabular-nums shrink-0"
        style={{ color: "var(--foreground)" }}
      >
        {attr.level}
      </span>
      <div
        role="progressbar"
        aria-valuenow={Math.round(pct * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${attr.label} level ${attr.level}`}
        className="w-8 h-1 rounded-full overflow-hidden shrink-0"
        style={{ background: "var(--accent-soft)" }}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.round(pct * 100)}%`,
            background: "var(--accent)",
          }}
        />
      </div>
    </div>
  );
}
