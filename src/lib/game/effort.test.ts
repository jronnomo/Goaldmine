// src/lib/game/effort.test.ts
//
// attributeXpBetween — the ~10-line window-delta helper behind "Effort this
// Program" (UXR-PROG-43). Pure; pins the R-SPLIT contract: deltas within an
// inclusive dateKey window, unattributed XP excluded, zero is a legitimate
// answer.

import { describe, it, expect } from "vitest";
import { attributeXpBetween } from "@/lib/game/effort";
import type { XpEvent } from "@/lib/game/types";

const ATTRS = [
  { id: "STR", label: "Strength" },
  { id: "END", label: "Endurance" },
  { id: "MOB", label: "Mobility" },
  { id: "CON", label: "Consistency" },
];

const ev = (dateKey: string, xp: number, attribute: string | null): XpEvent => ({
  dateKey,
  ruleId: "r",
  label: "e",
  xp,
  attribute,
});

describe("attributeXpBetween", () => {
  it("sums per attribute within the inclusive window", () => {
    const rows = attributeXpBetween(
      [
        ev("2026-08-09", 40, "STR"), // before — excluded
        ev("2026-08-10", 25, "STR"), // start boundary — included
        ev("2026-09-01", 30, "STR"),
        ev("2026-09-01", 20, "MOB"),
        ev("2026-12-31", 15, "CON"), // end boundary — included
        ev("2027-01-01", 99, "END"), // after — excluded
      ],
      ATTRS,
      "2026-08-10",
      "2026-12-31",
    );
    expect(rows).toEqual([
      { id: "STR", label: "Strength", xp: 55 },
      { id: "END", label: "Endurance", xp: 0 },
      { id: "MOB", label: "Mobility", xp: 20 },
      { id: "CON", label: "Consistency", xp: 15 },
    ]);
  });

  it("unattributed XP never lands in a row — it is /character's overall-only business", () => {
    const rows = attributeXpBetween([ev("2026-08-15", 100, null)], ATTRS, "2026-08-10", "2026-12-31");
    expect(rows.every((r) => r.xp === 0)).toBe(true);
  });

  it("an empty window is FOUR ZEROS in data — the card renders the EmptyState, never 0-XP bars", () => {
    const rows = attributeXpBetween([], ATTRS, "2026-08-10", "2026-12-31");
    expect(rows.map((r) => r.xp)).toEqual([0, 0, 0, 0]);
  });

  it("unknown attribute ids are dropped (a future pack cannot corrupt the fitness rows)", () => {
    const rows = attributeXpBetween([ev("2026-08-15", 50, "ARC")], ATTRS, "2026-08-10", "2026-12-31");
    expect(rows.every((r) => r.xp === 0)).toBe(true);
  });
});
