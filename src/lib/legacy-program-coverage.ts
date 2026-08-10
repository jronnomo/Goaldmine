// src/lib/legacy-program-coverage.ts
//
// Sprint 15 / #267 — pure audit logic for the legacy-Program fallback
// coverage check (scripts/verify-legacy-program-coverage.ts is the DB-wired
// runner; this module is deliberately DB-free so the detection + iteration
// logic is unit-testable without a live database).
//
// Question answered per founder-history date: "if getActiveProgram()'s legacy
// Program-table fallback branch were deleted today (#269), would this date
// resolve to a different program than it does right now?"
//
// Mechanics — the REAL production resolution path, not a reimplementation:
// every date is resolved through pickProgramForDate() (the pure core that
// getProgramForDate() wraps), fed the same inputs the wrapper fetches:
// getPlanWindowCandidates() output + getActiveProgram() output. The
// legacy-fallback signal is the exact id-membership check pickProgramForDate's
// SMOKE-1 doc comment describes: a legacy Program-table snapshot's id can
// never appear among the Plan-table candidates, while a real active Plan's id
// always does (getPlanWindowCandidates fetches EVERY Plan row, active or not).
//
// The post-removal world is simulated by re-running pickProgramForDate with
// `activeProgram` nulled out whenever it was legacy-sourced — byte-equivalent
// to the #269 code (with no legacy fallback, getActiveProgram returns null in
// exactly those cases; pickProgramForDate's SMOKE-1 branch is a no-op for any
// non-legacy activeProgram, so the current function doubles as the simulator).

import {
  pickProgramForDate,
  type ActiveProgramSnapshot,
  type PlanWindowCandidate,
} from "@/lib/program";
import { addDays, dateKey, parseDateKey } from "@/lib/calendar-core";

/** Resolution outcome for one date, before vs after fallback removal. */
export type DateFinding = {
  dateKey: string;
  /** Winner under the CURRENT code (id + source), null when nothing resolves. */
  before: { id: string; source: "active" | "archived" } | null;
  /** Winner after the #269 fallback deletion (simulated), null when nothing resolves. */
  after: { id: string; source: "active" | "archived" } | null;
  /** The current winner is NOT a Plan row — the date is served by the legacy Program table. */
  viaLegacy: boolean;
  /** before !== after (id or source): deleting the fallback changes this date. */
  regresses: boolean;
};

export type CoverageAudit = {
  /**
   * getActiveProgram()'s fallback branch fired: an activeProgram snapshot
   * exists whose id is absent from the Plan-table candidates (SMOKE-1's
   * id-membership signal). Detected directly, independent of any per-date
   * outcome — even if every historical date is rescued by a covering
   * candidate, a legacy-sourced activeProgram means Today itself is being
   * served from the legacy table.
   */
  legacyFallbackActive: boolean;
  activeProgramId: string | null;
  planIdCount: number;
  findings: DateFinding[];
  /** Dates whose current winner is the legacy row (subset of findings). */
  legacyDates: DateFinding[];
  /** Dates whose resolution changes after fallback removal (subset of findings). */
  regressingDates: DateFinding[];
  /** True ⇔ zero legacy hits, zero regressions, and no legacy-sourced activeProgram. */
  clean: boolean;
};

/**
 * Inclusive dateKey range [startKey .. endKey] in USER_TZ, iterated with the
 * repo's calendar helpers (never raw Date day math). Returns [] when
 * startKey > endKey. Lexical compare is safe for YYYY-MM-DD keys.
 */
export function buildDateKeyRange(startKey: string, endKey: string): string[] {
  const keys: string[] = [];
  if (startKey > endKey) return keys;
  let cursor = parseDateKey(startKey);
  let key = dateKey(cursor);
  while (key <= endKey) {
    keys.push(key);
    cursor = addDays(cursor, 1);
    key = dateKey(cursor);
  }
  return keys;
}

function outcome(
  candidates: PlanWindowCandidate[],
  dk: string,
  todayKey: string,
  activeProgram: ActiveProgramSnapshot | null,
): { id: string; source: "active" | "archived" } | null {
  const resolved = pickProgramForDate(candidates, dk, todayKey, activeProgram);
  return resolved ? { id: resolved.id, source: resolved.source } : null;
}

/**
 * Runs the per-date audit. `candidates` MUST be the full
 * getPlanWindowCandidates() output (every Plan row) — the Plan-id set used for
 * legacy detection is derived from it.
 */
export function auditLegacyProgramCoverage(args: {
  dateKeys: string[];
  todayKey: string;
  candidates: PlanWindowCandidate[];
  activeProgram: ActiveProgramSnapshot | null;
}): CoverageAudit {
  const { dateKeys, todayKey, candidates, activeProgram } = args;
  const planIds = new Set(candidates.map((c) => c.id));

  const legacyFallbackActive = activeProgram !== null && !planIds.has(activeProgram.id);
  // Post-#269 world: getActiveProgram() returns null wherever it currently
  // falls back to the legacy table; unchanged when it returns a real Plan.
  const activeAfterRemoval = legacyFallbackActive ? null : activeProgram;

  const findings: DateFinding[] = dateKeys.map((dk) => {
    const before = outcome(candidates, dk, todayKey, activeProgram);
    const after = outcome(candidates, dk, todayKey, activeAfterRemoval);
    const viaLegacy = before !== null && !planIds.has(before.id);
    const regresses =
      (before === null) !== (after === null) ||
      before?.id !== after?.id ||
      before?.source !== after?.source;
    return { dateKey: dk, before, after, viaLegacy, regresses };
  });

  const legacyDates = findings.filter((f) => f.viaLegacy);
  const regressingDates = findings.filter((f) => f.regresses);
  return {
    legacyFallbackActive,
    activeProgramId: activeProgram?.id ?? null,
    planIdCount: planIds.size,
    findings,
    legacyDates,
    regressingDates,
    clean: !legacyFallbackActive && legacyDates.length === 0 && regressingDates.length === 0,
  };
}
