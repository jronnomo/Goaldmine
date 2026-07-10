# Completion report — #234 — 2026-07-10

## Shipped (commit 827d515 on feature/phase1-auth)
1. **Shared baseline-decision guard**: `assertBaselineDecisionMade` extracted into day-template-validation.ts (message verbatim, coach voice kept); applyDayOverrideCore refactored onto it — MCP behavior proven **byte-identical** via git-stash before/after curl comparison. One implementation, zero divergence (AC).
2. **Dashboard write path hardened**: upsertDayOverrideFromForm now runs size→structural asserts post-parse (core's order) + the guard (baselineInputProvided always false — the form has no affordance until #235); pre-reads the existing row like the core; validator/guard messages surface in the existing form banner (verified live: `{"bad": true}` → field messages; valid save persists).
3. **USER_TZ date fix, expanded**: the local naive parseDateKey deleted; all THREE call sites swapped to @/lib/calendar's (upsertDayOverrideFromForm, clearDayOverride, **logNoteForDate** — a site the premise map missed, dev-caught). Historical exposure documented as gotchas §B.13.
4. **First-ever guard coverage**: 42 new tests (21 day-actions + 21 validation) incl. the guard trigger matrix, the named blank-workout/notes-only case, and REAL calendar-core date math (no mocks — a mocked parseDateKey would have hidden this story's own bug, critique C3).

## Data-safety ruling (DA C1)
DA proved the naive parse shifts every dashboard-written override −1 day on prod (UTC runtime), latent since 2026-05-03. Orchestrator ran the read-only diagnostic on the dev Neon branch (prod snapshot 2026-07-01): **53/53 override rows are Denver-midnight — zero naive fingerprints**; every real override came via MCP. Clean forward-fix, no repair script. Residual: one 30-second read-only check of prod's PlanDayOverride after the next deploy (rows with date at 00:00 UTC = written by the form on prod since July 1 — none expected).

## Verification
tsc 0 · **722/722** (680+42) · lint 0 errors · build OK · MCP byte-identical rejection messages · live form banner + valid-save + state restored · dev-DB cleanliness (agent's one stray test row self-caught and cleared).

## Process
Premise check corrected two AC claims (raw-prisma is by-design; "existing guard test coverage" didn't exist) and surfaced the date bug; DA escalated it to a data-safety ruling with the exposure window; orchestrator ran the diagnostic personally before authorizing the swap. Architect skipped (PRD-as-blueprint); QA by orchestrator + dev's evidence.

## Follow-up
#235 (structured Day Override editor) consumes these validators and adds the baselineTestNames affordance the guard's UI story needs. Post-deploy: the 30-second prod PlanDayOverride date check.
