// src/components/SeamLine.test.ts
//
// #290 / UXR-PV-49/50 — the server-rendered SVG sparkline (research §7.8
// test 5): 0 points → null; 1 point → flat rule; min === max → all y at 50;
// and NO <circle> in the output (a direct R11 regression guard — under
// preserveAspectRatio="none" a circle renders as an ellipse).

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SeamLine } from "@/components/SeamLine";

function render(points: number[]): string {
  return renderToStaticMarkup(
    createElement(SeamLine, {
      points,
      ariaLabel: "Readiness trend",
      "data-testid": "sl",
    }),
  );
}

describe("SeamLine", () => {
  it("0 points → renders null (callers show a text hint, never an empty frame)", () => {
    expect(render([])).toBe("");
  });

  it("1 point → a flat rule across the box", () => {
    const html = render([42]);
    expect(html).toContain("<polyline");
    // Two coords, same y, spanning x 0 → 100.
    const points = /points="([^"]+)"/.exec(html)![1]!;
    const coords = points.split(" ").map((p) => p.split(",").map(Number));
    expect(coords).toHaveLength(2);
    expect(coords[0]![0]).toBe(0);
    expect(coords[1]![0]).toBe(100);
    expect(coords[0]![1]).toBe(coords[1]![1]);
  });

  it("min === max → every y sits at 50 (a flat series is a flat mid-box line)", () => {
    const html = render([40, 40, 40]);
    const points = /points="([^"]+)"/.exec(html)![1]!;
    const ys = points.split(" ").map((p) => Number(p.split(",")[1]));
    expect(ys).toEqual([50, 50, 50]);
  });

  it("NEVER emits a <circle> — non-uniform scale would render it as an ellipse", () => {
    const html = render([10, 30, 20, 80]);
    expect(html).not.toContain("<circle");
  });

  it("carries the non-uniform-scale guards: preserveAspectRatio=none + non-scaling-stroke", () => {
    const html = render([10, 30, 20, 80]);
    expect(html).toContain('preserveAspectRatio="none"');
    expect(html).toContain('vector-effect="non-scaling-stroke"');
  });

  it("a11y: outer role=img carries the label; the svg itself is hidden", () => {
    const html = render([10, 90]);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Readiness trend"');
    expect(html).toContain('aria-hidden="true"');
  });

  it("higher scores render HIGHER (smaller y) — the line slopes the honest way", () => {
    const html = render([0, 100]);
    const points = /points="([^"]+)"/.exec(html)![1]!;
    const coords = points.split(" ").map((p) => p.split(",").map(Number));
    // First point (score 0) has larger y than last point (score 100).
    expect(coords[0]![1]!).toBeGreaterThan(coords[1]![1]!);
  });
});
