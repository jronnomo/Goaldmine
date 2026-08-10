// CollapsibleCard — lid-variant proofs (today-page-ia §2.1, UXR-TIA-43/60).
// The Tier-2-vs-Tier-3 differentiation at 390px is the research's top visual
// risk; the lid variant biases it harder: muted text-sm <span> title (no h2),
// right-rail digest, chevron. The default variant must stay byte-stable for
// its existing hosts (days page, ProjectPlanView, RenderJobPanel).

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CollapsibleCard } from "@/components/CollapsibleCard";

describe("CollapsibleCard — Tier-3 lid variant", () => {
  const lid = renderToStaticMarkup(
    createElement(CollapsibleCard, {
      variant: "lid" as const,
      defaultOpen: false,
      title: "Deferred today — Lower Power",
      digest: "3 blocks",
      "data-testid": "today-deferred-lid",
      children: createElement("p", null, "body"),
    }),
  );

  it("no h2 in a lid — muted text-sm span title + digest + chevron instead", () => {
    expect(lid).not.toContain("<h2");
    expect(lid).toContain("Deferred today — Lower Power");
    expect(lid).toContain("text-sm font-medium text-[var(--muted)]");
    expect(lid).toContain("3 blocks");
    expect(lid).toContain("▼");
    expect(lid).toContain('data-testid="today-deferred-lid"');
  });

  it("a closed lid is never an empty lid: payload title + digest render with the details closed", () => {
    expect(lid).not.toContain("<details open");
    expect(lid).toContain("Deferred today — Lower Power");
    expect(lid).toContain("3 blocks");
  });

  it("chevron rotation is the only tween and it is motion-safe guarded (UXR-TIA-38)", () => {
    expect(lid).toContain("motion-safe:transition-transform");
    expect(lid.match(/transition/g)?.length).toBe(1);
  });

  it("default variant keeps the Tier-1/3 h2 for existing hosts", () => {
    const dflt = renderToStaticMarkup(
      createElement(CollapsibleCard, {
        title: "Planned: Upper Power",
        defaultOpen: true,
        children: createElement("p", null, "body"),
      }),
    );
    expect(dflt).toContain("<h2");
    expect(dflt).toContain("text-base font-semibold tracking-tight");
    expect(dflt).toContain("<details open");
  });
});
