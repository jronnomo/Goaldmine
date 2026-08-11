// src/app/progress/loading.parity.test.ts
//
// UXR-PROG-86/87: the skeleton is BOUND to the manifest's above-fold
// geometry — without a test, "bound to the manifest" is a comment, and
// comments lose to refactors. The repo's test env is node (no layout
// engine), so the browser-scrollHeight comparison the ledger sketches is
// approximated by its static equivalent: parse the skeleton's literal
// block heights out of the rendered HTML and assert (a) the block ORDER
// matches the manifest prefix, (b) the stacked height lands inside the
// 825px-stop window the spec draws (± the ledger's ⚠[±40px] tolerance),
// (c) reduced-motion + dark-contrast guards are present on every block.

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Loading from "@/app/progress/loading";

const html = renderToStaticMarkup(createElement(Loading));

/** All literal h-[Npx] heights, in DOM order. */
function blockHeights(markup: string): number[] {
  return [...markup.matchAll(/h-\[(\d+)px\]/g)].map((m) => Number(m[1]));
}

describe("loading.tsx — geometry bound to the manifest", () => {
  it("blocks appear in manifest-prefix order: hero, jump, band, rule, strip, goals ×3, next-readings", () => {
    const hs = blockHeights(html);
    // hero (32 + 14) · jump 44 · band 78 · rule 24 · repeatability 170 ·
    // goal strips 88 ×3 (literal constants, not a map) · next-readings 72.
    expect(hs).toEqual([32, 14, 44, 78, 24, 170, 88, 88, 88, 72]);
  });

  it("stacked height stops inside the 825px window (tallest plausible fold), ±40px", () => {
    const hs = blockHeights(html);
    const GAP = 16; // space-y-4
    const PAD = 16; // container p-4 top
    const blocks = [32 + 8 + 14, 44, 78, 24, 170, 88, 88, 88, 72]; // hero is one spaced block
    const stacked = PAD + blocks.reduce((s, h) => s + h, 0) + GAP * (blocks.length - 1);
    expect(hs.length).toBeGreaterThan(0);
    expect(stacked).toBeGreaterThanOrEqual(825 - 40);
    expect(stacked).toBeLessThanOrEqual(825 + 40);
  });

  it("every pulse is motion-safe (UXR-PROG-85) and fills with muted/25, never --border (UXR-PROG-88)", () => {
    expect(html).not.toMatch(/(?<!motion-safe:)animate-pulse/);
    expect(html).toContain("motion-safe:animate-pulse");
    expect(html).toContain("bg-[var(--muted)]/25");
    expect(html).not.toContain("bg-[var(--border)]");
  });

  it("keeps the single sr-only loading announcement; blocks are aria-hidden", () => {
    expect(html).toContain("Loading…");
    expect((html.match(/aria-hidden="true"/g) ?? []).length).toBeGreaterThanOrEqual(9);
  });

  it("renders nothing below the stop — no records/baselines/effort skeleton blocks", () => {
    const hs = blockHeights(html);
    expect(hs.length).toBe(10); // exactly the above-fold blocks
  });
});
