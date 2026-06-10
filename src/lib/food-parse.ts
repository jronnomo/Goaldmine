/**
 * food-parse.ts — Pure parser for natural-language food query strings.
 * No I/O, no "use server". Safe to import in server modules and test scripts.
 *
 * Handled forms (examples):
 *   "banana"                → count 1, no size, no grams
 *   "medium banana"         → count 1, sizeWord "medium"
 *   "2 large eggs"          → count 2, sizeWord "large"
 *   "150g chicken breast"   → count 1, grams 150
 *   "4 oz salmon"           → count 1, grams 113.4 (4 × 28.35)
 *   "a banana"              → count 1 (filler "a" stripped)
 *   "an apple"              → count 1 (filler "an" stripped)
 *
 * Design: deliberately simple. Edge cases (e.g., "half a cup") are out of scope;
 * the caller degrades to a 100 g default on unresolved grams.
 */

export type ParsedFoodQuery = {
  /** Number of items (from leading digit; defaults to 1). */
  count: number;
  /** Size adjective found before the food name, if any. */
  sizeWord: "small" | "medium" | "large" | null;
  /** Explicit weight in grams (from "Ng" or "N oz"); null if not provided. */
  grams: number | null;
  /** Remainder of the query after extracting count / size / units — the food name. */
  rest: string;
};

/** Grams per fluid ounce (avoirdupois). */
const OZ_TO_G = 28.3495;

/**
 * Parse a natural-language food query into its structural parts.
 * Always returns a value — never throws.
 */
export function parseFoodQuery(q: string): ParsedFoodQuery {
  // Strip surrounding whitespace and leading indefinite articles ("a …" / "an …").
  let s = q.trim().replace(/^(?:a|an)\s+/i, "");

  let count = 1;
  let sizeWord: "small" | "medium" | "large" | null = null;
  let grams: number | null = null;

  // ── Step 1: Gram or oz amount ─────────────────────────────────────────────
  // Must be checked BEFORE the leading-count check so that "150g chicken" is
  // not parsed as count=150 with rest="g chicken".
  //
  // Form: "<number>g" or "<number> g" or "<number> grams" (case-insensitive)
  const gramMatch = s.match(/^(\d+(?:\.\d+)?)\s*g(?:rams?)?\s+(.+)/i);
  if (gramMatch) {
    grams = parseFloat(gramMatch[1]);
    s = gramMatch[2];
  } else {
    // Form: "<number> oz" or "<number>oz" or "<number> ounces"
    const ozMatch = s.match(/^(\d+(?:\.\d+)?)\s*oz(?:unces?)?\s+(.+)/i);
    if (ozMatch) {
      grams = Math.round(parseFloat(ozMatch[1]) * OZ_TO_G * 10) / 10;
      s = ozMatch[2];
    }
  }

  // ── Step 2: Leading count ─────────────────────────────────────────────────
  // Only parse a count when no explicit weight was found (avoids re-matching
  // the gram amount that was already consumed above).
  if (grams == null) {
    // Match an integer or decimal at the start followed by whitespace.
    const countMatch = s.match(/^(\d+(?:\.\d+)?)\s+(.+)/);
    if (countMatch) {
      const candidate = parseFloat(countMatch[1]);
      if (Number.isFinite(candidate) && candidate > 0) {
        count = candidate;
        s = countMatch[2];
      }
    }
  }

  // ── Step 3: Leading size word ─────────────────────────────────────────────
  // Strip a size adjective if it appears before the food name.
  // Only applies when no explicit gram/oz weight was given.
  if (grams == null) {
    const sizeMatch = s.match(/^(small|medium|large)\s+(.+)/i);
    if (sizeMatch) {
      sizeWord = sizeMatch[1].toLowerCase() as "small" | "medium" | "large";
      s = sizeMatch[2];
    }
  }

  return { count, sizeWord, grams, rest: s.trim().toLowerCase() };
}
