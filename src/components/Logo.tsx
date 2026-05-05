/* If you change Logo geometry, also update public/icon.svg and re-run
   `npx tsx scripts/render-icons.ts`. Logo.tsx uses CSS variables;
   icon.svg ships static hex (dark palette). They MUST stay visually in sync. */
import type { CSSProperties } from "react";

interface LogoProps {
  size?: number;
  className?: string;
  title?: string;
  style?: CSSProperties;
}

/**
 * Goaldmine brand mark — treasure chest with a hero target on the lid,
 * flanked by two small hollow targets. Composition follows
 * docs/ux-research/goaldmine-rebrand.md §1 Option B.
 *
 * viewBox 0 0 64 64. Fills reference CSS variables so the mark
 * automatically theme-flips between light (cream) and dark (coal).
 *
 * Layer order (per UX §1, bottom -> top):
 *   1. Chest body (filled gold trapezoid)
 *   2. Chest dark band (splits planks)
 *   3. Keyhole
 *   4. Chest lid (rotated, darker gold)
 *   5. Lid interior shadow
 *   6. Flanking hollow targets (decorative)
 *   7. Hero target (4 concentric filled rings)
 *   8. Mandatory hero-target outline (legibility on cream backgrounds)
 */
export function Logo({ size = 32, className, title = "Goaldmine", style }: LogoProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      style={style}
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{title}</title>

      {/* Layer 1 — Chest body (rounded trapezoid).
          Filled gold; no stroke at any size. Outline is cosmetic
          and renders as sub-pixel blur at 28 px (blueprint N10). */}
      <path
        d="M8 32 L56 32 L52 56 Q52 58 50 58 L14 58 Q12 58 12 56 Z"
        fill="var(--accent)"
      />

      {/* Layer 2 — Chest dark band, splits body into two planks. */}
      <rect x="12" y="42" width="40" height="4" fill="var(--accent-fg)" />

      {/* Layer 3 — Keyhole (small circle + tiny rect underneath). */}
      <circle cx="32" cy="50" r="1.25" fill="var(--accent-fg)" />
      <rect x="31.5" y="50" width="1" height="3" fill="var(--accent-fg)" />

      {/* Layer 4 — Chest lid: rotated rectangle, darker gold. */}
      <rect
        x="8"
        y="18"
        width="48"
        height="12"
        rx="2"
        fill="var(--border)"
        transform="rotate(-8 32 30)"
      />

      {/* Layer 5 — Lid interior shadow behind the targets. */}
      <path
        d="M14 22 L50 22 L48 30 L16 30 Z"
        fill="var(--accent-fg)"
        opacity="0.8"
      />

      {/* Layer 6 — Flanking hollow targets (decorative, low-contrast). */}
      <circle cx="18" cy="22" r="5" fill="none" stroke="var(--target)" strokeWidth="1.25" />
      <circle cx="46" cy="22" r="5" fill="none" stroke="var(--target)" strokeWidth="1.25" />

      {/* Layer 7 — Hero target (4 concentric filled rings). */}
      <circle cx="32" cy="18" r="11" fill="var(--target)" />
      <circle cx="32" cy="18" r="8" fill="#FFFFFF" />
      <circle cx="32" cy="18" r="5" fill="var(--target)" />
      <circle cx="32" cy="18" r="2" fill="#FFFFFF" />

      {/* Layer 8 — MANDATORY dark outline around hero target.
          Required for legibility on cream backgrounds; harmless on coal. */}
      <circle
        cx={32}
        cy={18}
        r={11.5}
        fill="none"
        stroke="var(--accent-fg)"
        strokeWidth={0.5}
      />
    </svg>
  );
}
