// src/lib/recap-icons.ts
// Standalone, side-effect-free icon-identifier map for RecapHighlight["icon"] (#264).
//
// Deliberately its own module — NOT part of recap.ts or recap-card.tsx:
//   - recap.ts is the pure/shared aggregator and must not import JSX, so
//     RecapHighlight.icon carries this discriminated id instead of a literal
//     emoji character. recap.ts imports only the TYPE from here.
//   - recap-card.tsx (Satori/next-og) switches on the id to draw an inline
//     SVG mark — no emoji glyph is ever handed to Satori (twemoji CDN fetch
//     was the tofu-box failure class this closes, same as completion-card.tsx).
//   - recap-caption.ts and RecapClient.tsx need the actual emoji for
//     plain-text contexts (an Instagram caption, a <select><option> label)
//     where a real browser/IG renders emoji fine. They import
//     HIGHLIGHT_ICON_EMOJI as a real value — but neither may import recap.ts
//     itself at runtime (recap.ts pulls in getDb/program/records/game-engine,
//     and recap-caption.test.ts relies on `import type` erasure to avoid
//     loading that graph in tests). This module has zero imports of its own,
//     so it is safe for all four consumers to depend on directly.
//
// Keep this file free of imports so it stays safe everywhere above.

export type RecapHighlightIconId = "trophy" | "ruler" | "mountain" | "medal" | "star";

/** Plain-text emoji for non-Satori contexts only (captions, <option> labels). */
export const HIGHLIGHT_ICON_EMOJI: Record<RecapHighlightIconId, string> = {
  trophy: "🏆",
  ruler: "📏",
  mountain: "⛰️",
  medal: "🎖️",
  star: "⭐",
};
