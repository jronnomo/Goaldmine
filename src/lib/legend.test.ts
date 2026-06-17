// src/lib/legend.test.ts
// Regression guard for resolveLegend — routes kind-based default through the
// presentation registry (legend-via-registry refactor, PRD §3).
//
// No vi.mock needed: legend.ts imports only zod + the client-safe registry
// (goal-presentation.ts). Neither touches Prisma or DB at module load.

import { describe, it, expect } from "vitest";

import {
  resolveLegend,
  DEFAULT_LEGEND,
  PROJECT_DEFAULT_LEGEND,
} from "@/lib/legend";
import {
  FITNESS_PRESENTATION,
  PROJECT_PRESENTATION,
  DEFAULT_PRESENTATION,
} from "@/lib/goal-presentation";

// ─── Mapping locks (DA mandatory) ────────────────────────────────────────────
// The default branch in resolveLegend depends on these spread-inherited values.
// If they ever change, the build-time contract breaks — pin them here.

describe("presentationForGoal — legendDefault mapping locks", () => {
  it("FITNESS_PRESENTATION.legendDefault is 'fitness'", () => {
    expect(FITNESS_PRESENTATION.legendDefault).toBe("fitness");
  });

  it("PROJECT_PRESENTATION.legendDefault is 'project'", () => {
    expect(PROJECT_PRESENTATION.legendDefault).toBe("project");
  });

  it("DEFAULT_PRESENTATION.legendDefault is 'fitness' (spread-inherited from FITNESS_PRESENTATION)", () => {
    expect(DEFAULT_PRESENTATION.legendDefault).toBe("fitness");
  });
});

// ─── Default-branch cases ─────────────────────────────────────────────────────

describe("resolveLegend — null/no-legend → default branch", () => {
  it("null goal → DEFAULT_LEGEND (reference-equal)", () => {
    expect(resolveLegend(null)).toBe(DEFAULT_LEGEND);
  });

  it("{kind:'fitness', legend:null} → DEFAULT_LEGEND", () => {
    expect(resolveLegend({ kind: "fitness", legend: null })).toBe(DEFAULT_LEGEND);
  });

  it("{kind:'project', legend:null} → PROJECT_DEFAULT_LEGEND", () => {
    expect(resolveLegend({ kind: "project", legend: null })).toBe(PROJECT_DEFAULT_LEGEND);
  });

  it("{kind:'galaxy-brain', legend:null} → DEFAULT_LEGEND (unknown kind → fitness default)", () => {
    expect(resolveLegend({ kind: "galaxy-brain", legend: null })).toBe(DEFAULT_LEGEND);
  });
});

// ─── Stored-legend path ───────────────────────────────────────────────────────

describe("resolveLegend — stored-legend path wins over kind default", () => {
  it("project kind + valid stored legend → returns stored legend, NOT PROJECT_DEFAULT_LEGEND", () => {
    const storedLegend = [
      { icon: "◆", label: "Scheduled", kind: "scheduled-item" as const },
    ];
    const result = resolveLegend({ kind: "project", legend: storedLegend });
    expect(result).toEqual(storedLegend);
    expect(result).not.toBe(PROJECT_DEFAULT_LEGEND);
  });

  it("fitness kind + invalid stored legend → DEFAULT_LEGEND (invalid → fallback)", () => {
    const invalidLegend = [{ bogus: true }];
    expect(resolveLegend({ kind: "fitness", legend: invalidLegend })).toBe(DEFAULT_LEGEND);
  });
});
