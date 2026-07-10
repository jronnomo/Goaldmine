# Completion report — #236 — 2026-07-10 · Sprint 13

## Shipped (commit 35cc8f5, merged 4fd1d62 on feature/phase1-auth; +225/-183 across 9 files)
1. **StatTile migration completed** (the follow-up its own header deferred): calendar `Stat` (was an `<li>`; wrapper ul→div), progress `WeightStat`, MilestoneBurnDown `BurndownStat` all deleted; StatTile gained optional `testId` → `data-testid` (burndown hooks preserved).
2. **Shared `src/components/StatusPill.tsx`**: semantic tone union (`success|warning|danger|muted`); baselines' 4 call sites re-toned emerald→success/amber→warning/red→danger (same CSS vars — visually inert).
3. **Shared `src/lib/baseline-format.ts`**: `countByStatus`, `formatBest` (+internal formatDuration), `statusTextClass` — kept out of records.ts (core domain module stays display-free). 13 new tests = first-ever coverage for these formatters.
4. DA conditions implemented: `baselines:148 statusClass(next.status)` → `statusTextClass(...)` (would've been a build break); asymmetric `CheckpointStatus` import cleanup (removed in baselines, KEPT in RecordsSummary for the testsDue sort).

## Verification
- Gates: tsc 0 · lint 0 errors (2 pre-existing warnings) · **783/783** (770 + 13) · build OK.
- Greps: no local `Stat`/`WeightStat`/`BurndownStat` defs; StatusPill/countByStatus/formatBest/statusTextClass each defined once (3 pre-existing UNRELATED `formatDuration` copies elsewhere noted as out of scope: baselines/exercise/[name], WorkoutLoggerForm, formatters/types).
- Browser (dev agent + independent orchestrator pass): /calendar "This month" 4-tile grid ✓; /progress Weight row (157.4/159/-1.6) via StatTile ✓ + RecordsSummary pills correct colors (34 green/0 amber/0 red/7 muted) ✓; /baselines pills identical + per-row "retest done/upcoming" status colors via statusTextClass ✓. Zero hydration warnings (post-#253 standard). MilestoneBurnDown verified via code/tsc/grep only (needs project-kind FOCUS goal to render — founder's focus is fitness; DB state not touched).
- Transient noise during the pass, NOT regressions: one Neon dev-branch connectivity blip (auth AdapterError, self-recovered on reload) and the pre-existing pg-connection-string SSL deprecation warning surfaced by Next devtools.

## Process
Premise check (AC stale both directions: StatTile already existed w/ progress+compare consumers; only 3 of the "5" files had stat tiles; StatusPill tone enums differed; bonus statusClass/statusTextClass dup found) → PRD → Architect skipped → DA **APPROVE-WITH-CONDITIONS** (2 real catches incl. the :148 build-breaker; located the MilestoneBurnDown render gate) → dev agent (started stale at 54b6e6c, self-corrected via base-proof to e6a7287 — the protocol working) → gates + independent parity pass. Zero iterations.

## Follow-ups
- 3 unrelated `formatDuration` copies exist (different surfaces) — possible future micro-dedup, not queued.
- Sprint 13 continues: #237–#244, #249.
