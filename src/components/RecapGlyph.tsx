// src/components/RecapGlyph.tsx
//
// The recap-icons vocabulary as an APP component (UXR-PROG-35, ⚑ resolved:
// lift the filled 24-viewBox glyphs into the stroke-1.5 20-viewBox house —
// justified because the vocabulary's value is being the SAME mark on the
// shared recap card (recap-card.tsx HighlightIcon, Satori) and in the app.
// NEVER the emoji map — Satori-only, cannot be tinted.
//
// HARD FLOOR: 24px (not a range). Verified against the real path data:
// `mountain`/`star` are single filled paths, safe at any size; `trophy`
// (two 1.6px strokes) and `medal` (2.2px stroke) need ≥20px; `ruler` is
// UNUSABLE below 24px (4 hairlines at 1.4px plus a rotate transform).
// The `size` prop clamps to the floor rather than trusting callers.
//
// Tint via `currentColor` — the caller's text token carries the hue, and the
// mark stays a SHAPE difference in grayscale (iso-luminant doctrine).
//
// Server component.

import type { RecapHighlightIconId } from "@/lib/recap-icons";

export const RECAP_GLYPH_MIN_PX = 24;

export function RecapGlyph({
  icon,
  size = RECAP_GLYPH_MIN_PX,
  "data-testid": testId,
}: {
  icon: RecapHighlightIconId;
  size?: number;
  "data-testid"?: string;
}) {
  const s = Math.max(size, RECAP_GLYPH_MIN_PX);
  const color = "currentColor";
  const svgProps = {
    width: s,
    height: s,
    viewBox: "0 0 24 24",
    "aria-hidden": true as const,
    "data-testid": testId,
    className: "shrink-0",
  };
  switch (icon) {
    case "trophy":
      return (
        <svg {...svgProps}>
          <path d="M7 3h10v4a5 5 0 0 1-5 5 5 5 0 0 1-5-5V3z" fill={color} />
          <path d="M7 4.5H4.5A2.5 2.5 0 0 0 7 8.5" fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
          <path d="M17 4.5h2.5A2.5 2.5 0 0 1 17 8.5" fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
          <rect x={10.5} y={12} width={3} height={4} fill={color} />
          <rect x={6.5} y={18.5} width={11} height={2.2} rx={1.1} fill={color} />
          <path d="M8.5 16.2h7l1.2 2.3h-9.4l1.2-2.3z" fill={color} />
        </svg>
      );
    case "ruler":
      return (
        <svg {...svgProps}>
          <rect x={2} y={9.5} width={20} height={5} rx={1} fill="none" stroke={color} strokeWidth={1.6} transform="rotate(-28 12 12)" />
          <line x1={6} y1={9.5} x2={6} y2={12.3} stroke={color} strokeWidth={1.4} transform="rotate(-28 12 12)" />
          <line x1={10} y1={9.5} x2={10} y2={14.5} stroke={color} strokeWidth={1.4} transform="rotate(-28 12 12)" />
          <line x1={14} y1={9.5} x2={14} y2={12.3} stroke={color} strokeWidth={1.4} transform="rotate(-28 12 12)" />
          <line x1={18} y1={9.5} x2={18} y2={14.5} stroke={color} strokeWidth={1.4} transform="rotate(-28 12 12)" />
        </svg>
      );
    case "mountain":
      return (
        <svg {...svgProps}>
          <path d="M2 19.5L8.5 7l3.2 5.6 2-3 8.3 10.9H2z" fill={color} />
        </svg>
      );
    case "medal":
      return (
        <svg {...svgProps}>
          <path d="M8.5 13.8h3v6.5l-1.5-1-1.5 1v-6.5z" fill={color} />
          <path d="M12.5 13.8h3v6.5l-1.5-1-1.5 1v-6.5z" fill={color} />
          <circle cx={12} cy={9} r={6} fill="none" stroke={color} strokeWidth={2.2} />
          <circle cx={12} cy={9} r={2.1} fill={color} />
        </svg>
      );
    case "star":
    default:
      return (
        <svg {...svgProps}>
          <path d="M12 2.5l2.85 6.17 6.8.9-5 4.63 1.32 6.8L12 17.77l-6 3.23 1.33-6.8-5-4.63 6.8-.9L12 2.5z" fill={color} />
        </svg>
      );
  }
}
