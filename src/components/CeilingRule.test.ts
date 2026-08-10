// src/components/CeilingRule.test.ts
//
// #290 / UXR-PV-92 — the div-based gate-ceiling bar (research §7.8 test 6):
//   - ceiling === 100 emits NO stile and NO hatch;
//   - rawScore > ceiling emits both;
//   - aria-valuenow is the CAPPED score, never rawScore.
// House idiom: node env, createElement + renderToStaticMarkup, assert HTML.

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CeilingRule } from "@/components/CeilingRule";

function render(props: {
  score: number;
  rawScore: number;
  ceiling: number;
}): string {
  return renderToStaticMarkup(
    createElement(CeilingRule, {
      ...props,
      ariaLabel: `Readiness ${props.score} of 100`,
      "data-testid": "cr",
    }),
  );
}

describe("CeilingRule", () => {
  it("ceiling === 100: no stile, no hatch — a clear goal gets a plain bar", () => {
    const html = render({ score: 91, rawScore: 91, ceiling: 100 });
    expect(html).not.toContain("cr-stile");
    expect(html).not.toContain("cr-hatch");
    expect(html).not.toContain("repeating-linear-gradient");
    expect(html).toContain('aria-valuenow="91"');
    expect(html).toContain("width:91%");
  });

  it("rawScore > ceiling (HELD): emits the stile AND the hatch", () => {
    const html = render({ score: 80, rawScore: 91, ceiling: 80 });
    expect(html).toContain("cr-stile");
    expect(html).toContain("cr-hatch");
    expect(html).toContain("repeating-linear-gradient");
    // Stile sits at the ceiling.
    expect(html).toContain("calc(80% - 1px)");
    // Hatch covers the zone above the ceiling.
    expect(html).toContain("left:80%");
  });

  it("gates open but not binding: the stile still teaches the cap before it bites", () => {
    const html = render({ score: 45, rawScore: 45, ceiling: 80 });
    expect(html).toContain("cr-stile");
    expect(html).toContain("cr-hatch");
    expect(html).toContain("width:45%");
  });

  it("aria-valuenow is the CAPPED score, never rawScore", () => {
    const html = render({ score: 80, rawScore: 91, ceiling: 80 });
    expect(html).toContain('aria-valuenow="80"');
    expect(html).not.toContain('aria-valuenow="91"');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuemax="100"');
  });

  it("fill width is the capped score, not the raw score", () => {
    const html = render({ score: 80, rawScore: 91, ceiling: 80 });
    expect(html).toContain("width:80%");
    expect(html).not.toContain("width:91%");
  });
});
