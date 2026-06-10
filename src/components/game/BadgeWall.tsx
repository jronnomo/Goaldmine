// src/components/game/BadgeWall.tsx
// 16-badge trophy wall: 4-column grid, Bullseye-ring frames, DM Serif monograms.
// Unlocked: filled gold disc + monogram. Locked: hollow muted ring + greyed monogram + hint.
// Three-channel locked state: desaturation + hollow frame + hint text (§13 a11y).
// Non-interactive — badges are display-only; no tap targets needed.
// Server component — no "use client".
//
// Optional geometric glyphs for mountain/flame families (⚠ visual polish):
// - glyphFamily: "mountain" → small triangle path above monogram
// - glyphFamily: "flame" → small flame path above monogram

import type { UnlockedBadge } from "@/lib/game/types";

type BadgeWallProps = {
  badges: UnlockedBadge[];
  "data-testid"?: string;
};

// Mountain triangle — 14px, decorative
const MountainGlyph = () => (
  <svg width="12" height="10" viewBox="0 0 12 10" fill="none" aria-hidden>
    <path
      d="M6 1L11 9H1L6 1Z"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
  </svg>
);

// Flame glyph — 12px, decorative
const FlameGlyph = () => (
  <svg width="10" height="12" viewBox="0 0 10 12" fill="none" aria-hidden>
    <path
      d="M5 1C5 1 2.5 4 2.5 6.5a2.5 2.5 0 0 0 5 0c0-1-0.6-2-0.6-2S6.5 5.4 5.5 6c0-1.2-0.5-2-0.5-3z"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

function BadgeCell({ badge }: { badge: UnlockedBadge }) {
  const { def, dateKey } = badge;
  const unlocked = dateKey !== null;

  return (
    <div
      className="flex flex-col items-center gap-1"
      data-testid={`badge-${def.id}`}
      data-locked={unlocked ? undefined : "true"}
      // Accessible: badge name + (if locked) hint text for AT
      aria-label={
        unlocked
          ? `${def.name} — unlocked`
          : `${def.name} — locked. ${def.hint}`
      }
    >
      {/* Medal: circular ring frame, 52px */}
      <div
        className="relative flex items-center justify-center flex-col"
        style={{
          width: 52,
          height: 52,
          borderRadius: "9999px",
          // Unlocked: solid gold disc; Locked: hollow muted ring
          background: unlocked ? "var(--accent)" : "transparent",
          border: unlocked
            ? "2px solid var(--accent)"
            : "2px solid var(--muted)",
          // Three-channel lock: desaturation via opacity
          opacity: unlocked ? 1 : 0.55,
        }}
      >
        {/* Optional geometric glyph (mountain/flame) above monogram */}
        {def.glyphFamily && (
          <span
            aria-hidden
            style={{
              color: unlocked ? "var(--accent-fg)" : "var(--muted)",
              lineHeight: 1,
              marginBottom: 1,
            }}
          >
            {def.glyphFamily === "mountain" ? <MountainGlyph /> : <FlameGlyph />}
          </span>
        )}
        {/* Monogram in DM Serif */}
        <span
          aria-hidden
          style={{
            fontFamily: "var(--font-display)",
            fontSize: def.monogram.length > 2 ? 11 : 13,
            fontWeight: 400,
            color: unlocked ? "var(--accent-fg)" : "var(--muted)",
            lineHeight: 1,
            letterSpacing: def.monogram.length > 2 ? "-0.02em" : "0",
          }}
        >
          {def.monogram}
        </span>
      </div>

      {/* Badge name */}
      <span
        className="text-[10px] text-center leading-tight max-w-[56px]"
        style={{ color: unlocked ? "var(--foreground)" : "var(--muted)" }}
      >
        {def.name}
      </span>

      {/* Hint (only for locked badges — third a11y channel visible to sighted users) */}
      {!unlocked && (
        <span
          className="text-[9px] text-center leading-tight max-w-[56px]"
          style={{ color: "var(--muted)" }}
          aria-hidden // already in the parent aria-label
        >
          {def.hint}
        </span>
      )}
    </div>
  );
}

export function BadgeWall({ badges, "data-testid": testId }: BadgeWallProps) {
  const unlockedCount = badges.filter((b) => b.dateKey !== null).length;

  return (
    <div data-testid={testId}>
      {/* Counter */}
      <p
        className="text-xs font-semibold mb-3"
        style={{ color: "var(--muted)" }}
      >
        {unlockedCount} / {badges.length} unlocked
      </p>

      {/* 4-column grid */}
      <div className="grid grid-cols-4 gap-2">
        {badges.map((badge) => (
          <BadgeCell key={badge.def.id} badge={badge} />
        ))}
      </div>
    </div>
  );
}
