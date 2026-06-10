// src/components/game/BadgeWall.tsx
// 16-badge trophy wall: 4-column grid, Bullseye-ring frames, DM Serif monograms.
// Unlocked: filled gold disc + monogram. Locked: hollow muted ring + greyed monogram + hint.
// Three-channel locked state: desaturation + hollow frame + hint text (§13 a11y).
// Each badge cell is a <button> that opens a detail BottomSheet.
//
// Optional geometric glyphs for mountain/flame families (⚠ visual polish):
// - glyphFamily: "mountain" → small triangle path above monogram
// - glyphFamily: "flame" → small flame path above monogram
//
// dateKey formatting: pure string-split — NO new Date(dateKey). TZ-safe.

"use client";

import { useState } from "react";
import type { UnlockedBadge } from "@/lib/game/types";
import { BottomSheet } from "@/components/BottomSheet";

// Simple dateKey ("yyyy-mm-dd") → "Month D, YYYY" formatter.
// Uses only string operations — no Date constructor, no TZ math.
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

function formatDateKey(dateKey: string): string {
  const parts = dateKey.split("-");
  const monthIdx = parseInt(parts[1] ?? "1", 10) - 1;
  const day = parseInt(parts[2] ?? "1", 10);
  const month = MONTH_NAMES[monthIdx] ?? parts[1];
  return `${month} ${day}, ${parts[0]}`;
}

// Mountain triangle — 12px, decorative
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

// Flame glyph — 10px, decorative
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

/**
 * BadgeMedal — shared medal disc, parameterized by size.
 * Used in the grid cells (size=52) and in the detail sheet (size=76).
 * Keeps medal visual rendering in one place — no duplication.
 */
function BadgeMedal({
  badge,
  size,
}: {
  badge: UnlockedBadge;
  size: number;
}) {
  const { def, dateKey } = badge;
  const unlocked = dateKey !== null;

  // Font size scales with disc size: ~21% for 3-char monograms, ~25% for 1-2 chars
  const fontSize = def.monogram.length > 2
    ? Math.round(size * 0.21)
    : Math.round(size * 0.25);

  return (
    <div
      className="relative flex items-center justify-center flex-col"
      style={{
        width: size,
        height: size,
        borderRadius: "9999px",
        // Unlocked: solid gold disc; Locked: hollow muted ring
        background: unlocked ? "var(--accent)" : "transparent",
        border: unlocked
          ? "2px solid var(--accent)"
          : "2px solid var(--muted)",
        // Three-channel lock: desaturation via opacity
        opacity: unlocked ? 1 : 0.55,
        flexShrink: 0,
      }}
      aria-hidden
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
          fontSize,
          fontWeight: 400,
          color: unlocked ? "var(--accent-fg)" : "var(--muted)",
          lineHeight: 1,
          letterSpacing: def.monogram.length > 2 ? "-0.02em" : "0",
        }}
      >
        {def.monogram}
      </span>
    </div>
  );
}

/**
 * BadgeCell — tappable grid cell. Renders the 52px medal + name label + locked hint.
 * The button's aria-label names the badge and its locked/unlocked state.
 * The visible text content is aria-hidden (already conveyed by the button label).
 */
function BadgeCell({
  badge,
  onOpen,
}: {
  badge: UnlockedBadge;
  onOpen: (badge: UnlockedBadge) => void;
}) {
  const { def, dateKey } = badge;
  const unlocked = dateKey !== null;

  return (
    <button
      type="button"
      className="flex flex-col items-center gap-1 cursor-pointer rounded-lg p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1"
      style={{ background: "transparent", border: "none" }}
      data-testid={`badge-${def.id}`}
      data-locked={unlocked ? undefined : "true"}
      aria-label={unlocked ? `${def.name}, unlocked` : `${def.name}, locked`}
      onClick={() => onOpen(badge)}
    >
      {/* Medal: circular ring frame, 52px */}
      <BadgeMedal badge={badge} size={52} />

      {/* Badge name — aria-hidden: the button label already covers it */}
      <span
        className="text-[10px] text-center leading-tight max-w-[56px]"
        style={{ color: unlocked ? "var(--foreground)" : "var(--muted)" }}
        aria-hidden
      >
        {def.name}
      </span>

      {/* Hint (only for locked badges — third a11y channel for sighted users) */}
      {!unlocked && (
        <span
          className="text-[9px] text-center leading-tight max-w-[56px]"
          style={{ color: "var(--muted)" }}
          aria-hidden
        >
          {def.hint}
        </span>
      )}
    </button>
  );
}

/**
 * BadgeDetail — content rendered inside the BottomSheet for a selected badge.
 * Shows the larger medal, badge name (DM Serif), status line, and hint/requirement box.
 */
function BadgeDetail({ badge }: { badge: UnlockedBadge }) {
  const { def, dateKey } = badge;
  const unlocked = dateKey !== null;

  return (
    <div className="px-4 pt-4 pb-6 flex flex-col items-center gap-4">
      {/* Larger medal — same rendering as grid, scaled to 76px */}
      <BadgeMedal badge={badge} size={76} />

      {/* Badge name in DM Serif, matches card-title style */}
      <p
        className="text-xl text-center leading-snug"
        style={{ fontFamily: "var(--font-display)", color: "var(--foreground)" }}
      >
        {def.name}
      </p>

      {/* Status line */}
      <p
        className="text-sm"
        style={{ color: unlocked ? "var(--success)" : "var(--muted)" }}
      >
        {unlocked ? `Unlocked ${formatDateKey(dateKey)}` : "Locked"}
      </p>

      {/* Requirement / earn-by block */}
      <div
        className="w-full rounded-xl p-3 space-y-1"
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
        }}
      >
        <p
          className="text-xs font-semibold"
          style={{ color: "var(--muted)" }}
        >
          {unlocked ? "Earned by" : "How to earn it"}
        </p>
        <p className="text-sm" style={{ color: "var(--foreground)" }}>
          {def.hint}
        </p>
      </div>
    </div>
  );
}

// ─── Public API ──────────────────────────────────────────────────────────────

type BadgeWallProps = {
  badges: UnlockedBadge[];
  "data-testid"?: string;
};

export function BadgeWall({ badges, "data-testid": testId }: BadgeWallProps) {
  const [selected, setSelected] = useState<UnlockedBadge | null>(null);
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
          <BadgeCell
            key={badge.def.id}
            badge={badge}
            onOpen={setSelected}
          />
        ))}
      </div>

      {/* Detail sheet — mounts on first open; native <dialog> handles focus return */}
      <BottomSheet
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.def.name ?? ""}
        data-testid="badge-detail-sheet"
      >
        {selected && <BadgeDetail badge={selected} />}
      </BottomSheet>
    </div>
  );
}
