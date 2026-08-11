// src/components/progress/EffortCard.test.ts
//
// The one admissible game number (UXR-PROG-43): max-normalized --muted bars,
// ONE role="img" (never role="progressbar" — that triple distinction is what
// stops these reading as XpBar/AttributeBar), "Strength · 340 XP" labels
// (never "+340"), the "Effort, not outcome." footnote, and the zero-window
// EmptyState (never four rows of 0 XP).

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EffortCard } from "@/components/progress/EffortCard";
import type { EffortModel } from "@/lib/progress-data";

const model = (rows: EffortModel["rows"]): EffortModel => ({
  rows,
  windowStartKey: "2026-08-10",
  windowEndKey: "2026-12-31",
});

describe("EffortCard", () => {
  it("four labelled rows sorted desc, muted bars, one role=img, no progressbar", () => {
    const html = renderToStaticMarkup(
      createElement(EffortCard, {
        model: model([
          { id: "STR", label: "Strength", xp: 1240 },
          { id: "MOB", label: "Mobility", xp: 880 },
          { id: "CON", label: "Consistency", xp: 310 },
          { id: "END", label: "Endurance", xp: 420 },
        ]),
      }),
    );
    // Sorted desc:
    const order = ["Strength", "Mobility", "Endurance", "Consistency"];
    let pos = -1;
    for (const label of order) {
      const next = html.indexOf(label, pos + 1);
      expect(next).toBeGreaterThan(pos);
      pos = next;
    }
    // Bars are --muted, never --accent (that would impersonate progress):
    expect(html).toContain("bg-[var(--muted)]");
    expect(html).not.toContain('role="progressbar"');
    expect((html.match(/role="img"/g) ?? []).length).toBe(1);
    expect(html).toContain("aria-label");
    // Labels are "· N XP", never "+N":
    expect(html).toContain("1,240 XP");
    expect(html).not.toContain("+1,240");
    expect(html).toContain("Effort, not outcome.");
    // Max-normalized: the top row fills 100%:
    expect(html).toContain("width:100%");
  });

  it("zero window XP → EmptyState, never four rows of 0 XP", () => {
    const html = renderToStaticMarkup(
      createElement(EffortCard, {
        model: model([
          { id: "STR", label: "Strength", xp: 0 },
          { id: "END", label: "Endurance", xp: 0 },
          { id: "MOB", label: "Mobility", xp: 0 },
          { id: "CON", label: "Consistency", xp: 0 },
        ]),
      }),
    );
    expect(html).toContain("No effort logged in this Program yet");
    expect(html).not.toContain("0 XP");
    expect(html).not.toContain('role="img"');
  });

  it("R-SPLIT: no level, no streak, no lifetime total anywhere in the card", () => {
    const html = renderToStaticMarkup(
      createElement(EffortCard, {
        model: model([
          { id: "STR", label: "Strength", xp: 100 },
          { id: "END", label: "Endurance", xp: 50 },
          { id: "MOB", label: "Mobility", xp: 0 },
          { id: "CON", label: "Consistency", xp: 0 },
        ]),
      }),
    );
    expect(html).not.toMatch(/level/i);
    expect(html).not.toMatch(/streak/i);
    expect(html).not.toMatch(/badge/i);
  });
});
