# PRD: Adopt shared StatTile + dedup StatusPill/countByStatus/formatBest (#236)

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-07-10
**Status**: Approved
**GitHub Issue**: #236 (Sprint 13 — Consolidation, a11y & polish)
**Branch**: feature/phase1-auth
**UX-research**: skipped — pure consolidation/refactor, no new surface (only the tabular-nums micro-unification)

---

## 1. Overview

### 1.1 Problem Statement
Stat-tile and status-summary markup lives in near-identical local copies across pages: any visual fix must be applied N times and drift is inevitable. A shared `StatTile` already exists (extracted in an earlier story with migration deferred); this story completes that migration and consolidates the `StatusPill`/`countByStatus`/`formatBest` duplication between the baselines page and RecordsSummary.

### 1.2 Premise check (2026-07-10, HEAD e6a7287) — AC corrections
| Claim | Verdict |
|---|---|
| Five files define local stat tiles | **PARTIAL** — only three do: calendar `Stat` (:164, an `<li>`), progress `WeightStat` (:271), MilestoneBurnDown `BurndownStat` (:111, extra `testId` prop). baselines + RecordsSummary have NO stat tile (their rows are StatusPill) |
| Shared StatTile must be adopted | TRUE, and it ALREADY EXISTS (`src/components/StatTile.tsx`, consumed by progress Totals + compare) — this story is its deferred migration follow-up |
| StatusPill/countByStatus/formatBest near-duplicated at baselines:204/216 vs RecordsSummary:167/213 | TRUE — countByStatus byte-identical; formatBest+formatDuration identical modulo whitespace; **StatusPill tone enums differ** (emerald/amber/red vs success/warning/danger — same CSS vars, different prop names) |
| Bonus dup not in the AC | `statusClass` (baselines:191) vs `statusTextClass` (RecordsSummary:175) — same body; dedup in scope |
| "Pixel-equivalent" parity | Amended: migrated tiles gain `tabular-nums` (deliberate unification with progress/compare); calendar's `<ul>` grid becomes a `<div>` grid (StatTile is a div; preflight makes it visually identical) |

### 1.3 Success Criteria
One definition site each for StatTile/StatusPill/countByStatus/formatBest/statusTextClass; the three local tile fns and both local pill/helper sets deleted; visual equivalence at 390px on all touched surfaces; first-ever unit coverage for the formatters; gates green.

---

## 2. User Stories
| ID | As a... | I want to... | So that... | Priority |
|---|---|---|---|---|
| US-001 | Maintainer | stat/pill markup defined once | a visual fix lands everywhere at once | Must Have |
| US-002 | User | pages render as before | consolidation is invisible | Must Have |

---

## 3. Functional Requirements

### 3.1 Core
1. `src/components/StatTile.tsx`: add optional `testId?: string` → `data-testid`; header comment updated (migration done).
2. New `src/components/StatusPill.tsx`: shared pill, semantic tone vocabulary `"success" | "warning" | "danger" | "muted"` (RecordsSummary's — matches StatTile's tone naming), markup identical to both current copies.
3. New `src/lib/baseline-format.ts` (pure, server-safe, no Prisma): `countByStatus`, `formatBest` (internal `formatDuration`), `statusTextClass`; types from `@/lib/records`. NOT added to records.ts (core domain module stays display-free). Tests: `src/lib/baseline-format.test.ts` (~8: countByStatus matrix, formatBest unit branches, statusTextClass mapping).
4. Migrations: calendar (delete `Stat`, ul→div, 4 StatTile call sites); progress (delete `WeightStat`, 3 call sites); MilestoneBurnDown (delete `BurndownStat`, 3 call sites with `testId="burndown-stat-{total,done,remaining}"`); baselines (delete 5 locals, import shared, re-tone 4 call sites emerald→success/amber→warning/red→danger); RecordsSummary (delete 5 locals, import shared, call sites unchanged).

### 3.2 Out of Scope
Merging StatTile and StatusPill into one component; ExerciseRow's `StaticCell` and recap-card's canvas `StatCell` (different markup/medium); any visual redesign.

---

## 4. Technical Design
All server components; new files stay server-safe (no "use client", no Prisma). Import direction: app/components → lib only (no cycles). No schema/route/MCP changes (no connector reload).

---

## 5. UI/UX
Visual parity except: migrated numerals gain `tabular-nums` (unification); calendar list markup becomes div grid (identical rendering).

---

## 6. Edge Cases
| Scenario | Expected |
|---|---|
| burndown test hooks | `data-testid="burndown-stat-*"` still in DOM via StatTile testId prop |
| baselines pill tones | emerald→success etc. render the SAME CSS vars — zero visual change |
| formatBest units (reps/s/lbs/mi/count) | identical output to both old copies (unit-tested) |
| StatTile value as string ("159.2 lb") | unchanged — value: string \| number |

---

## 7. Security
None — display-only refactor.

---

## 8. Acceptance Criteria (amended per §1.2)
1. [ ] calendar, progress, MilestoneBurnDown render stat rows via shared StatTile; local `Stat`/`WeightStat`/`BurndownStat` DELETED
2. [ ] StatusPill, countByStatus, formatBest (+statusTextClass, formatDuration) defined exactly once; baselines + RecordsSummary import them
3. [ ] Greps: no local defs remain; one definition site each
4. [ ] tsc 0 / lint no new / 770+new tests / build OK
5. [ ] 390px visual equivalence on /calendar, /progress, /baselines, RecordsSummary + MilestoneBurnDown surfaces (tabular-nums accepted)

---

## 9. Open Questions
DA rules: ul→div safety; tone-flip completeness; formatBest true-identity diff; component-merge question (expected NO); import-cycle check.

---

## 10. Test Plan
Gates; new baseline-format unit suite; dev-agent 390px before/after browser pass; orchestrator parity pass.

---

## 11. Appendix
Premise report inline (§1.2). StatTile origin: progress WeightStat extraction (see StatTile.tsx header). Related: #248 (React.cache getGoalCount) established the shared-extraction pattern for this queue.
