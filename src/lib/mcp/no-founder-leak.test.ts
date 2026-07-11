// src/lib/mcp/no-founder-leak.test.ts
//
// #250: permanent guard against the founder's personal context (weight,
// Mt. Elbert/Black Cloud Trail, home gym, Chewgether, GitHub handle) leaking
// back into the MCP surface every tenant's Claude session receives —
// COACH_INSTRUCTIONS, tool descriptions/schemas, and the badge catalog.
//
// Strategy: fs-read the raw source of exactly the files this PRD touched and
// assert none of them contain a founder-identifying token. This is a static
// text scan, not a runtime assertion — it catches regressions where someone
// pastes a concrete example back into a tool description.
//
// File scoping is intentionally an explicit list, NOT a directory glob.
// `jronnomo` (the founder's GitHub handle) also appears legitimately in:
//   - src/lib/food-actions.ts — a real OpenFoodFacts API User-Agent string
//     ("Goaldmine/1.0 (github.com/jronnomo/goaldmine)"), unrelated to any
//     tenant-facing MCP text.
//   - src/lib/mcp/today-shapers.test.ts — a test fixture (explicitly out of
//     scope per PRD-250 §3.2: code comments/test fixtures are internal,
//     data-not-hardcode).
// Globbing `src/lib/**` would false-positive on both. Scope stays exactly the
// 7 files below, matching PRD-250 FR §3.1 item 5 / architecture-critique.md
// Attack 3.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

// Exactly the 7 files touched by PRD-250 — no directory globbing (see header).
const SCOPED_FILES = [
  path.join(here, "instructions.ts"),
  path.join(here, "..", "game", "badges.ts"),
  path.join(here, "tools.ts"),
  path.join(here, "tools", "github-tools.ts"),
  path.join(here, "tools", "project-tools.ts"),
  path.join(here, "tools", "render-tools.ts"),
  path.join(here, "..", "metrics-registry.ts"),
];

// Founder-identifying tokens, per architecture-critique.md Attack 3's exact
// prescription. Case-insensitive substring match, except the two weight
// phrases which are literal phrases (not bare numbers — banning bare `155`
// or `159` would risk colliding with unrelated numerics like line counts or
// other tenants' future targets).
//
// Deliberately NOT banned (would false-positive on surviving, legitimate
// content in these same files):
//   - "snowboard" — a generic goal-flavor/legend preset name that stays in
//     instructions.ts rule 11 and tools.ts's flavor enum/error message.
//   - "El" / a 2-char monogram token — too short, would catch unrelated
//     words (e.g. "Elevation"); the badge id/name rename to summit-ready/
//     "Summit Ready" is already fully caught by the "elbert" token.
//   - "StairMaster" / "dumbbells to 65 lb" — generic real-world gym
//     equipment nouns, not founder-identifying; died with the deleted
//     instructions.ts user-context block, no ongoing guard needed.
const FOUNDER_TOKENS = [
  "elbert",
  "chewgether",
  "jronnomo",
  "black cloud",
  "155 lb",
  "159 lb",
];

describe("no-founder-leak", () => {
  for (const filePath of SCOPED_FILES) {
    const relPath = path.relative(path.join(here, "..", "..", ".."), filePath);

    it(`${relPath} contains no founder-identifying tokens`, () => {
      const lines = readFileSync(filePath, "utf8").split("\n");

      // Exclude whole-line `//` comments — they are never served to a tenant
      // (COACH_INSTRUCTIONS/tool descriptions are string literals, not
      // comments). One known, deliberately out-of-scope instance this
      // excludes: github-tools.ts:485, `// ... Acceptable at Chewgether
      // scale (2 open PRs).` — an internal implementation-limit note per
      // architecture-critique.md Attack 5 / PRD-250 §3.2 ("code comments...
      // internal, data-not-hardcode"). This does NOT exclude inline
      // trailing comments after code on the same line — none of the
      // scoped files have founder tokens in that position today; if one
      // is ever added, this test still catches it.
      const contents = lines
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n")
        .toLowerCase();

      for (const token of FOUNDER_TOKENS) {
        expect(
          contents.includes(token),
          `Found founder token "${token}" in ${relPath} — every tenant's ` +
            `Claude session reads this file's served text; de-personalize it ` +
            `(see docs/prds/PRD-250-de-founder-mcp.md).`,
        ).toBe(false);
      }
    });
  }
});
