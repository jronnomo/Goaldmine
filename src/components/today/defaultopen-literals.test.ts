// The defaultOpen literal rule — source-level enforcement (today-page-ia
// §4.2, UXR-TIA-19/20, BINDING): on the Today page every disclosure ships a
// LITERAL constant. <details open> is uncontrolled after mount; the Log
// sheet's meal submit revalidates "/", and a defaultOpen that flipped would
// make React removeAttribute("open") — the section slams shut under the
// user's finger. A literal never flips.
//
// This is deliberately a source test, not a render test: the hazard is the
// EXPRESSION, not any single rendered state.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const TODAY_DIR = join(ROOT, "src/components/today");

const todayFiles = [
  join(ROOT, "src/app/page.tsx"),
  ...readdirSync(TODAY_DIR)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => join(TODAY_DIR, f)),
];

describe("Today path — every defaultOpen is a literal constant", () => {
  for (const file of todayFiles) {
    it(`${file.slice(ROOT.length + 1)} has no data-dependent defaultOpen`, () => {
      const src = readFileSync(file, "utf8");
      const offenders = [...src.matchAll(/defaultOpen=\{([^}]*)\}/g)]
        .map((m) => m[1]!.trim())
        .filter((expr) => expr !== "true" && expr !== "false");
      expect(offenders).toEqual([]);
    });
  }

  it("SessionDossier's raw <details> use the bare literal `open` attribute, never open={expr}", () => {
    // Match real JSX tags only (`<details ` + attributes) — the file's
    // comments legitimately mention `<details>` with no attribute list.
    const src = readFileSync(join(TODAY_DIR, "SessionDossier.tsx"), "utf8");
    const detailsTags = [...src.matchAll(/<details\s[^>]*/g)].map((m) => m[0]);
    expect(detailsTags.length).toBeGreaterThan(0);
    for (const tag of detailsTags) {
      expect(tag).toMatch(/^<details open\b/);
      expect(tag).not.toMatch(/open=\{/);
    }
  });

  it("page.tsx ships literal false on both TRACK lids", () => {
    const src = readFileSync(join(ROOT, "src/app/page.tsx"), "utf8");
    const lidCount = (src.match(/defaultOpen=\{false\}/g) ?? []).length;
    expect(lidCount).toBe(2); // deferred lid + completed-baselines lid
  });
});
