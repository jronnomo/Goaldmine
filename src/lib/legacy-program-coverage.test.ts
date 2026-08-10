// src/lib/legacy-program-coverage.test.ts
//
// #267 — pure-logic coverage for the legacy-Program fallback audit
// (date-range iteration + fallback detection), independent of a live DB.
// The DB-wired runner is scripts/verify-legacy-program-coverage.ts; the
// resolution itself is the REAL pickProgramForDate (imported transitively via
// @/lib/legacy-program-coverage), so these tests also pin the audit's
// before/after simulation to the production contract.
//
// House convention: vi.mock("@/lib/db") dual-export (prisma + getDb) — the
// import chain pulls @/lib/program → @/lib/db; nothing here touches it.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {},
  getDb: vi.fn(),
}));

import {
  auditLegacyProgramCoverage,
  buildDateKeyRange,
} from "@/lib/legacy-program-coverage";
import type { ActiveProgramSnapshot, PlanWindowCandidate } from "@/lib/program";
import { parseDateKey } from "@/lib/calendar";
import type { ProgramTemplate } from "@/lib/program-template";

// ─── Fixtures (mirrors program.test.ts) ─────────────────────────────────────

function template(totalWeeks: number): ProgramTemplate {
  return { totalWeeks } as unknown as ProgramTemplate;
}

function snapshot(overrides: Partial<ActiveProgramSnapshot> = {}): ActiveProgramSnapshot {
  return {
    id: "plan-active",
    name: "Active Plan",
    startedOn: parseDateKey("2026-01-01"),
    template: template(4), // 28 days: 2026-01-01 .. 2026-01-28 inclusive
    confirmedThroughDate: null,
    ...overrides,
  };
}

function candidate(overrides: Partial<PlanWindowCandidate> = {}): PlanWindowCandidate {
  return {
    ...snapshot(),
    id: "plan-candidate",
    active: false,
    goalStatus: "achieved",
    goalCompletedAt: null,
    ...overrides,
  };
}

// ─── buildDateKeyRange ──────────────────────────────────────────────────────

describe("buildDateKeyRange", () => {
  it("single-day range is inclusive of both endpoints", () => {
    expect(buildDateKeyRange("2026-01-15", "2026-01-15")).toEqual(["2026-01-15"]);
  });

  it("multi-day range includes start, end, and every day between", () => {
    expect(buildDateKeyRange("2026-01-14", "2026-01-16")).toEqual([
      "2026-01-14",
      "2026-01-15",
      "2026-01-16",
    ]);
  });

  it("crosses month boundaries correctly", () => {
    expect(buildDateKeyRange("2026-01-30", "2026-02-02")).toEqual([
      "2026-01-30",
      "2026-01-31",
      "2026-02-01",
      "2026-02-02",
    ]);
  });

  it("reversed range returns empty", () => {
    expect(buildDateKeyRange("2026-02-01", "2026-01-01")).toEqual([]);
  });
});

// ─── auditLegacyProgramCoverage ─────────────────────────────────────────────

describe("auditLegacyProgramCoverage", () => {
  it("healthy state: real active Plan (id present among candidates) → clean, zero legacy hits, zero regressions", () => {
    const activePlan = snapshot({ id: "plan-real-active" });
    const candidates = [
      candidate({ id: "plan-real-active", active: true, goalStatus: "active" }),
    ];
    const audit = auditLegacyProgramCoverage({
      dateKeys: buildDateKeyRange("2026-01-01", "2026-01-15"),
      todayKey: "2026-01-15",
      candidates,
      activeProgram: activePlan,
    });

    expect(audit.legacyFallbackActive).toBe(false);
    expect(audit.legacyDates).toEqual([]);
    expect(audit.regressingDates).toEqual([]);
    expect(audit.clean).toBe(true);
    expect(audit.findings).toHaveLength(15);
    for (const f of audit.findings) {
      expect(f.before).toEqual({ id: "plan-real-active", source: "active" });
      expect(f.after).toEqual(f.before);
    }
  });

  it("synthetic legacy-sourced activeProgram: every date it serves is flagged; the after-simulation shows archived-Plan vs null fallout per date", () => {
    // Legacy-table row (id absent from candidates) covering all of January;
    // one archived real Plan covering only Jan 1-7. Post-#269 semantics:
    // a covering activeProgram wins step 1 unconditionally (the old SMOKE-1
    // rescue is deleted), so ALL legacy-covered dates are flagged — the
    // after-arm distinguishes dates a real Plan would absorb (Jan 5 →
    // archived plan-a) from dates that would resolve to nothing (Jan 10).
    const legacy = snapshot({ id: "program-legacy", template: template(4) });
    const planA = candidate({ id: "plan-a", template: template(1) }); // covers 01-01..01-07
    const audit = auditLegacyProgramCoverage({
      dateKeys: ["2026-01-05", "2026-01-10", "2026-01-20"],
      todayKey: "2026-01-20",
      candidates: [planA],
      activeProgram: legacy,
    });

    expect(audit.legacyFallbackActive).toBe(true);
    expect(audit.activeProgramId).toBe("program-legacy");

    const [jan5, jan10, jan20] = audit.findings;
    // Covered by BOTH: legacy serves it today; a real archived Plan would
    // take over after removal — still a flagged change (source + id flip).
    expect(jan5).toEqual({
      dateKey: "2026-01-05",
      before: { id: "program-legacy", source: "active" },
      after: { id: "plan-a", source: "archived" },
      viaLegacy: true,
      regresses: true,
    });
    // Legacy-only past date: currently served by the legacy row, null after.
    expect(jan10).toEqual({
      dateKey: "2026-01-10",
      before: { id: "program-legacy", source: "active" },
      after: null,
      viaLegacy: true,
      regresses: true,
    });
    // Today: candidates are never consulted for non-past dates — legacy row
    // serves it now, nothing after.
    expect(jan20).toEqual({
      dateKey: "2026-01-20",
      before: { id: "program-legacy", source: "active" },
      after: null,
      viaLegacy: true,
      regresses: true,
    });

    expect(audit.legacyDates.map((f) => f.dateKey)).toEqual([
      "2026-01-05",
      "2026-01-10",
      "2026-01-20",
    ]);
    expect(audit.regressingDates.map((f) => f.dateKey)).toEqual([
      "2026-01-05",
      "2026-01-10",
      "2026-01-20",
    ]);
    expect(audit.clean).toBe(false);
  });

  it("legacy-only user (zero Plan rows): every date is flagged and planIdCount is 0", () => {
    const legacy = snapshot({ id: "program-legacy" });
    const audit = auditLegacyProgramCoverage({
      dateKeys: ["2026-01-10", "2026-01-15"],
      todayKey: "2026-01-15",
      candidates: [],
      activeProgram: legacy,
    });

    expect(audit.planIdCount).toBe(0);
    expect(audit.legacyFallbackActive).toBe(true);
    expect(audit.legacyDates).toHaveLength(2);
    expect(audit.regressingDates).toHaveLength(2);
    expect(audit.clean).toBe(false);
  });

  it("no activeProgram at all: archived coverage resolves identically before/after; uncovered dates are null both ways → clean", () => {
    const planA = candidate({ id: "plan-a", template: template(1) }); // covers 01-01..01-07
    const audit = auditLegacyProgramCoverage({
      dateKeys: ["2026-01-03", "2026-01-09"],
      todayKey: "2026-01-15",
      candidates: [planA],
      activeProgram: null,
    });

    expect(audit.legacyFallbackActive).toBe(false);
    expect(audit.activeProgramId).toBeNull();
    const [jan3, jan9] = audit.findings;
    expect(jan3?.before).toEqual({ id: "plan-a", source: "archived" });
    expect(jan3?.after).toEqual(jan3?.before);
    expect(jan9?.before).toBeNull();
    expect(jan9?.after).toBeNull();
    expect(audit.clean).toBe(true);
  });
});
