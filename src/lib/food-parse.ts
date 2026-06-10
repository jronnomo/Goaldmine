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
 *   "1/2 Roma tomato"       → count 0.5 (slash fraction)
 *   "3/4 cup rice"          → count 0.75 (slash fraction)
 *   "1 1/2 eggs"            → count 1.5 (mixed number)
 *   "½ avocado"             → count 0.5 (unicode fraction glyph)
 *   "¾ cup oats"            → count 0.75 (unicode fraction glyph)
 *   "half a banana"         → count 0.5 (word fraction, strips "a/an")
 *   "half avocado"          → count 0.5 (word fraction)
 *   "quarter onion"         → count 0.25 (word fraction)
 *   "third avocado"         → count 0.333… (word fraction)
 *
 * Design: deliberately simple. Edge cases (e.g., "a quarter cup") outside
 * the patterns below degrade to count=1; the caller falls back to 100 g default.
 */

export type ParsedFoodQuery = {
  /**
   * Number of items. Defaults to 1.
   * Supports integers (2), decimals (0.5), slash fractions (1/2 → 0.5),
   * mixed numbers (1 1/2 → 1.5), unicode glyphs (½ → 0.5), and word
   * fractions (half → 0.5, quarter → 0.25, third → 0.333…).
   */
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

/** Unicode fraction glyph → decimal value. */
const UNICODE_FRACTION_MAP: Record<string, number> = {
  "½": 0.5,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "¼": 0.25,
  "¾": 0.75,
  "⅛": 0.125,
};

/** Word fraction → decimal value (only "half", "quarter", "third" accepted). */
const WORD_FRACTION_MAP: Record<string, number> = {
  half: 0.5,
  quarter: 0.25,
  third: 1 / 3,
};

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
  //
  // Sub-steps are tried in order; the first match wins.
  if (grams == null) {
    let matched = false;

    // ── 2a. Unicode fraction glyph (½ ⅓ ⅔ ¼ ¾ ⅛) ───────────────────────
    // e.g. "½ avocado", "¾ cup oats"
    if (!matched) {
      const m = s.match(/^([½⅓⅔¼¾⅛])\s*(.+)/u);
      if (m) {
        const val = UNICODE_FRACTION_MAP[m[1]];
        if (val !== undefined) {
          count = val;
          s = m[2];
          matched = true;
        }
      }
    }

    // ── 2b. Mixed number + slash fraction ("1 1/2 eggs", "2 3/4 cups") ────
    // Must run before the plain-integer check so "1 1/2" doesn't match "1".
    if (!matched) {
      const m = s.match(/^(\d+)\s+(\d+)\/(\d+)\s+(.+)/);
      if (m) {
        const whole = parseInt(m[1], 10);
        const num = parseInt(m[2], 10);
        const den = parseInt(m[3], 10);
        if (den !== 0) {
          const candidate = whole + num / den;
          if (Number.isFinite(candidate) && candidate > 0) {
            count = candidate;
            s = m[4];
            matched = true;
          }
        }
      }
    }

    // ── 2c. Slash fraction ("1/2 banana", "3/4 cup rice") ────────────────
    if (!matched) {
      const m = s.match(/^(\d+)\/(\d+)\s+(.+)/);
      if (m) {
        const num = parseInt(m[1], 10);
        const den = parseInt(m[2], 10);
        if (den !== 0) {
          const candidate = num / den;
          if (Number.isFinite(candidate) && candidate > 0) {
            count = candidate;
            s = m[3];
            matched = true;
          }
        }
      }
    }

    // ── 2d. Word fractions: "half [a/an] X", "quarter X", "third X" ──────
    if (!matched) {
      const m = s.match(/^(half|quarter|third)\s+(?:a\s+|an\s+)?(.+)/i);
      if (m) {
        const val = WORD_FRACTION_MAP[m[1].toLowerCase()];
        if (val !== undefined) {
          count = val;
          s = m[2];
          matched = true;
        }
      }
    }

    // ── 2e. Plain integer or decimal ("2 large eggs", "0.5 banana") ───────
    if (!matched) {
      const countMatch = s.match(/^(\d+(?:\.\d+)?)\s+(.+)/);
      if (countMatch) {
        const candidate = parseFloat(countMatch[1]);
        if (Number.isFinite(candidate) && candidate > 0) {
          count = candidate;
          s = countMatch[2];
        }
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
