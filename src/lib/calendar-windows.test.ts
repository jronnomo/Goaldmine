// src/lib/calendar-windows.test.ts
//
// #291 — deload/observance window derivation + week-row segment splitting.
// Pure module; no mocks. The title-prefix contract is the Phase 2A import's
// (see calendar-windows.ts header + phase2a-spec.ts): "Deload …" → deload,
// "Mirror Lake …" → observance.
//
// The three REAL Phase-2A windows (Aug 14–15 Fri–Sat, Sep 25–27 Fri–Sun,
// Nov 26–29 Thu–Sun) all sit inside one Monday-start week — so the
// boundary-crossing two-segment path gets the SYNTHETIC fixture the research
// explicitly requires (§7.3).

import { describe, it, expect } from "vitest";
import {
  classifyOverrideWindowKind,
  deriveCalendarWindows,
  splitWindowIntoSegments,
  type CalendarWindow,
} from "@/lib/calendar-windows";

describe("classifyOverrideWindowKind — the Phase 2A title-prefix contract", () => {
  it("classifies the import's real titles", () => {
    expect(classifyOverrideWindowKind("Deload #1 — Virginia")).toBe("deload");
    expect(classifyOverrideWindowKind("Deload #2 — Thanksgiving")).toBe("deload");
    expect(classifyOverrideWindowKind("Mirror Lake — Matt")).toBe("observance");
  });

  it("everything else is not a window (incl. non-strings and note-only override titles)", () => {
    expect(classifyOverrideWindowKind("Custom day")).toBeNull();
    expect(classifyOverrideWindowKind("La Plata — Dress Rehearsal")).toBeNull();
    expect(classifyOverrideWindowKind(undefined)).toBeNull();
    expect(classifyOverrideWindowKind(null)).toBeNull();
    expect(classifyOverrideWindowKind(42)).toBeNull();
    // Prefix means PREFIX — a mention elsewhere in the title is not a window.
    expect(classifyOverrideWindowKind("Post-Deload Test Day")).toBeNull();
  });
});

describe("deriveCalendarWindows — consecutive-run grouping", () => {
  it("groups the Sep 25–27 deload into ONE window; label is the first day's title", () => {
    const rows = ["2026-09-26", "2026-09-25", "2026-09-27"].map((dateKey) => ({
      dateKey,
      title: "Deload #1 — Virginia",
    }));
    expect(deriveCalendarWindows(rows)).toEqual([
      {
        id: "deload:2026-09-25",
        kind: "deload",
        label: "Deload #1 — Virginia",
        startKey: "2026-09-25",
        endKey: "2026-09-27",
      },
    ]);
  });

  it("a gap splits runs; different kinds never merge even when adjacent", () => {
    const rows = [
      { dateKey: "2026-08-14", title: "Mirror Lake — Matt" },
      { dateKey: "2026-08-15", title: "Mirror Lake — Matt" },
      // Adjacent to the observance end but a DIFFERENT kind:
      { dateKey: "2026-08-16", title: "Deload #0 — synthetic" },
      // Gap, then a second deload run:
      { dateKey: "2026-08-20", title: "Deload #0 — synthetic" },
      { dateKey: "2026-08-21", title: "Deload #0 — synthetic" },
    ];
    const windows = deriveCalendarWindows(rows);
    expect(windows.map((w) => [w.kind, w.startKey, w.endKey])).toEqual([
      ["observance", "2026-08-14", "2026-08-15"],
      ["deload", "2026-08-16", "2026-08-16"],
      ["deload", "2026-08-20", "2026-08-21"],
    ]);
  });

  it("month boundaries are just consecutive days (Aug 31 → Sep 1 merges)", () => {
    const rows = [
      { dateKey: "2026-08-31", title: "Deload X" },
      { dateKey: "2026-09-01", title: "Deload X" },
    ];
    expect(deriveCalendarWindows(rows)).toHaveLength(1);
  });

  it("non-window titles are dropped entirely", () => {
    expect(
      deriveCalendarWindows([{ dateKey: "2026-08-14", title: "Skill Day — Handstand" }]),
    ).toEqual([]);
  });
});

describe("splitWindowIntoSegments — gridColumn math against Monday-start week rows", () => {
  // August 2026 padded grid, Monday-start (Aug 1 is a Saturday → grid starts
  // Mon Jul 27): row 0 = Jul 27–Aug 2 … row 3 = Aug 17–23.
  const AUG_ROWS: string[][] = [
    ["2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31", "2026-08-01", "2026-08-02"],
    ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08", "2026-08-09"],
    ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15", "2026-08-16"],
    ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22", "2026-08-23"],
  ];

  it("a single-week window (the real Aug 14–15 Fri–Sat) → one rounded-both-ends segment", () => {
    const win: CalendarWindow = {
      id: "observance:2026-08-14",
      kind: "observance",
      label: "Mirror Lake — Matt",
      startKey: "2026-08-14",
      endKey: "2026-08-15",
    };
    expect(splitWindowIntoSegments(win, AUG_ROWS)).toEqual([
      {
        windowId: "observance:2026-08-14",
        kind: "observance",
        label: "Mirror Lake — Matt",
        weekRow: 2,
        colStart: 4, // Friday
        span: 2,
        isStart: true,
        isEnd: true,
      },
    ]);
  });

  it("SYNTHETIC boundary-crossing window (Sat Aug 15 → Tue Aug 18) → two segments; only the true ends are rounded", () => {
    const win: CalendarWindow = {
      id: "deload:2026-08-15",
      kind: "deload",
      label: "Deload — synthetic",
      startKey: "2026-08-15",
      endKey: "2026-08-18",
    };
    const segs = splitWindowIntoSegments(win, AUG_ROWS);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({
      weekRow: 2,
      colStart: 5, // Saturday
      span: 2, // Sat + Sun
      isStart: true,
      isEnd: false, // flat right edge — "continues"
    });
    expect(segs[1]).toMatchObject({
      weekRow: 3,
      colStart: 0, // Monday
      span: 2, // Mon + Tue
      isStart: false, // flat left edge — "continued"
      isEnd: true,
    });
  });

  it("a window entirely outside the grid yields no segments", () => {
    const win: CalendarWindow = {
      id: "deload:2026-11-26",
      kind: "deload",
      label: "Deload #2 — Thanksgiving",
      startKey: "2026-11-26",
      endKey: "2026-11-29",
    };
    expect(splitWindowIntoSegments(win, AUG_ROWS)).toEqual([]);
  });

  it("a window overlapping the grid edge clamps to the visible days", () => {
    const win: CalendarWindow = {
      id: "deload:2026-07-25",
      kind: "deload",
      label: "Deload — edge",
      startKey: "2026-07-25", // two days before the grid starts
      endKey: "2026-07-28",
    };
    const segs = splitWindowIntoSegments(win, AUG_ROWS);
    expect(segs).toEqual([
      expect.objectContaining({
        weekRow: 0,
        colStart: 0,
        span: 2, // Jul 27 + Jul 28 visible
        isStart: false, // true start is off-grid — flat edge
        isEnd: true,
      }),
    ]);
  });
});
