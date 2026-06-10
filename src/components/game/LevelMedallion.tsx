// src/components/game/LevelMedallion.tsx
// Level medallion: Bullseye in progress mode (overall XP ring) + gold level chip.
// The level chip overlaps the lower-right corner of the medallion.
// Server component — no "use client".
// IMPORTANT: Wrap in a <div className="relative"> sized to `size` in the parent;
// LevelUpCelebration ring divs (position:absolute; inset:0) expand from that wrapper.

import { Bullseye } from "@/components/Bullseye";

type LevelMedallionProps = {
  level: number;
  progress: number; // 0..1
  size?: number;    // default 36 (header), 64 (portrait on /character), 28 (attr cards)
};

export function LevelMedallion({ level, progress, size = 36 }: LevelMedallionProps) {
  // Chip sizing scales with medallion size
  const chipSize = size <= 28 ? 16 : size <= 36 ? 20 : 24;
  const chipFontSize = chipSize <= 16 ? 8 : chipSize <= 20 ? 10 : 12;

  return (
    // This wrapper fills the parent's relative container (sized by the parent).
    // We do NOT add position:relative here — the parent provides it so rings expand correctly.
    <div style={{ width: size, height: size, position: "relative", flexShrink: 0 }}>
      {/* Bullseye in progress mode — decorative; value read by adjacent XpBar */}
      <Bullseye
        progress={progress}
        size={size}
        aria-hidden
      />
      {/* Gold level chip — lower-right corner */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          bottom: -Math.round(chipSize * 0.25),
          right: -Math.round(chipSize * 0.25),
          width: chipSize,
          height: chipSize,
          borderRadius: "9999px",
          background: "var(--accent)",
          color: "var(--accent-fg)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: chipFontSize,
          fontFamily: "var(--font-display)",
          fontWeight: 400,
          lineHeight: 1,
          // Thin border so chip reads on both the medallion and the card bg
          border: "1.5px solid var(--card)",
          zIndex: 1,
        }}
      >
        {level}
      </span>
    </div>
  );
}
