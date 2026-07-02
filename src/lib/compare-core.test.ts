// src/lib/compare-core.test.ts
// Pure-function unit tests — no mocks. Covers buildEntry's direction×sign
// matrix, formatValue/formatDelta formatting rules, and normalizeDateRange's
// swap/sameDay/future-clamp behavior. Per architecture-blueprint.md §7 +
// v3-fixes.md Fix 3 (deltaPct negative-valueA case).

import { describe, expect, it } from "vitest";
import { buildEntry, formatDelta, formatValue, normalizeDateRange } from "@/lib/compare-core";

describe("buildEntry", () => {
  it("increase direction, positive delta → improved true", () => {
    const e = buildEntry({ key: "k", label: "L", units: "lb", valueA: 100, valueB: 120, direction: "increase" });
    expect(e.delta).toBe(20);
    expect(e.improved).toBe(true);
  });

  it("increase direction, negative delta → improved false", () => {
    const e = buildEntry({ key: "k", label: "L", units: "lb", valueA: 120, valueB: 100, direction: "increase" });
    expect(e.delta).toBe(-20);
    expect(e.improved).toBe(false);
  });

  it("decrease direction, positive delta → improved false", () => {
    const e = buildEntry({ key: "k", label: "L", units: "lb", valueA: 100, valueB: 120, direction: "decrease" });
    expect(e.improved).toBe(false);
  });

  it("decrease direction, negative delta → improved true", () => {
    const e = buildEntry({ key: "k", label: "L", units: "lb", valueA: 120, valueB: 100, direction: "decrease" });
    expect(e.improved).toBe(true);
  });

  it("delta === 0 (either direction) → improved null", () => {
    const inc = buildEntry({ key: "k", label: "L", units: "lb", valueA: 100, valueB: 100, direction: "increase" });
    const dec = buildEntry({ key: "k", label: "L", units: "lb", valueA: 100, valueB: 100, direction: "decrease" });
    expect(inc.improved).toBeNull();
    expect(dec.improved).toBeNull();
  });

  it("direction neutral, nonzero delta → improved null", () => {
    const e = buildEntry({ key: "k", label: "L", units: "kcal", valueA: 2000, valueB: 2200, direction: "neutral" });
    expect(e.improved).toBeNull();
  });

  it("valueA null, valueB non-null → newSinceA true, delta null, improved null", () => {
    const e = buildEntry({ key: "k", label: "L", units: "lb", valueA: null, valueB: 100, direction: "increase" });
    expect(e.newSinceA).toBe(true);
    expect(e.delta).toBeNull();
    expect(e.improved).toBeNull();
  });

  it("both null → delta null, deltaPct null, newSinceA false, improved null", () => {
    const e = buildEntry({ key: "k", label: "L", units: "lb", valueA: null, valueB: null, direction: "increase" });
    expect(e.delta).toBeNull();
    expect(e.deltaPct).toBeNull();
    expect(e.newSinceA).toBe(false);
    expect(e.improved).toBeNull();
  });

  it("valueA === 0 → deltaPct null (avoid divide-by-zero)", () => {
    const e = buildEntry({ key: "k", label: "L", units: "lb", valueA: 0, valueB: 10, direction: "increase" });
    expect(e.deltaPct).toBeNull();
  });

  // v3 Fix 3: negative valueA must not invert the sign of deltaPct.
  it("negative valueA: -50 → -25 is an improvement, deltaPct +50 (not inverted)", () => {
    const e = buildEntry({ key: "k", label: "L", units: "kcal", valueA: -50, valueB: -25, direction: "increase" });
    expect(e.delta).toBe(25);
    expect(e.deltaPct).toBe(50);
  });

  // PRD acceptance #10 fixtures
  it("PRD fixture: weight 168→159, direction decrease → improved true", () => {
    const e = buildEntry({ key: "weightLb", label: "Body weight", units: "lb", valueA: 168, valueB: 159, direction: "decrease" });
    expect(e.improved).toBe(true);
  });

  it("PRD fixture: 1.5-mile 890s→778s, direction decrease, units sec → improved true, formattedDelta -1:52", () => {
    const e = buildEntry({ key: "baseline:1.5 Mile", label: "1.5-Mile Run", units: "sec", valueA: 890, valueB: 778, direction: "decrease" });
    expect(e.improved).toBe(true);
    expect(e.formattedDelta).toBe("-1:52");
  });
});

describe("formatValue", () => {
  it("sec → duration string", () => {
    expect(formatValue(778, "sec")).toBe("12:58");
  });

  it("float (lb) → 1-decimal", () => {
    expect(formatValue(168.2, "lb")).toBe("168.2");
  });

  it("int (lb) → bare int, not '.0'", () => {
    expect(formatValue(160, "lb")).toBe("160");
  });

  it("pct → percent suffix", () => {
    expect(formatValue(74, "%")).toBe("74%");
  });

  it("$ → dollar prefix", () => {
    expect(formatValue(180, "$")).toBe("$180");
  });

  it("null → em dash", () => {
    expect(formatValue(null, "lb")).toBe("—");
  });
});

describe("formatDelta", () => {
  it("sec negative → signed duration", () => {
    expect(formatDelta(-112, "sec")).toBe("-1:52");
  });

  it("zero → '0' (no sign)", () => {
    expect(formatDelta(0, "lb")).toBe("0");
  });

  it("null → em dash", () => {
    expect(formatDelta(null, "lb")).toBe("—");
  });
});

describe("normalizeDateRange", () => {
  const today = "2026-07-02";

  it("swap: b < a → swapped true, dateA/dateB corrected", () => {
    const r = normalizeDateRange("2026-07-02", "2026-03-01", today);
    expect(r.swapped).toBe(true);
    expect(r.dateA).toBe("2026-03-01");
    expect(r.dateB).toBe("2026-07-02");
  });

  it("sameDay: a === b → sameDay true, spanDays 0", () => {
    const r = normalizeDateRange("2026-03-01", "2026-03-01", today);
    expect(r.sameDay).toBe(true);
    expect(r.spanDays).toBe(0);
  });

  it("future clamp: b > todayKey → clampedToToday true, dateB = todayKey", () => {
    const r = normalizeDateRange("2026-03-01", "2026-12-25", today);
    expect(r.clampedToToday).toBe(true);
    expect(r.dateB).toBe(today);
  });

  it("future clamp both: both a and b in the future → both clamped, sameDay true", () => {
    const r = normalizeDateRange("2026-12-01", "2026-12-25", today);
    expect(r.clampedToToday).toBe(true);
    expect(r.dateA).toBe(today);
    expect(r.dateB).toBe(today);
    expect(r.sameDay).toBe(true);
  });
});
