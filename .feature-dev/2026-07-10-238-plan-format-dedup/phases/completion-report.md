# Completion report — #238 — 2026-07-10 · Sprint 13

## Shipped (commit 7abd33b, merged on feature/phase1-auth; +135/-137 across 8 files)
New `src/lib/plan-format.ts`: `blockTypeLabel` (was 4 identical copies — the story missed prescription-prefill's), `formatSecs` (was 5 identical copies — story missed SnapshotView + PlanOverview), `compactPrescription` (3 copies; Today never had one — AC corrected) and `prescriptionRight`, both over a private `prescriptionParts` so the "—" vs "" fallback divergence is preserved byte-for-byte. The DA's binding conditions held: truthy `if (ex.sets)` check kept verbatim (sets:0 omitted), and `formatSecs` imported directly only where directly called (page.tsx, PlanOverview) — no dead imports. 11 new tests pin every branch incl. the fallback split.

**Parity ruling realized**: `CompletedWorkoutCard.tsx`'s formatSecs had ALREADY diverged (always m:ss, never "N min") — exactly the silent-divergence risk this story exists to stop. It stays local BY DESIGN (logged-set stopwatch semantics ≠ prescription brevity semantics), documented in the shared module header.

## Verification
- Gates: tsc 0 · lint 0 errors · **794/794** (783 + 11) · build OK.
- Greps: blockTypeLabel/compactPrescription/prescriptionRight only in plan-format.ts; formatSecs only there + CompletedWorkoutCard (documented variant).
- **Browser parity pass: NOT RUN — Chrome extension disconnected for both the dev agent and the orchestrator.** Parity evidence is by construction instead: orchestrator diff review confirmed the deleted bodies are byte-identical to the hoisted versions (compared side-by-side in the same diff), and the 11 unit tests pin output for every branch. Risk assessed low (pure-function verbatim hoist). **DEBT: one browser glance at /, /days/<date>, /goals/<id>/plan when Chrome reconnects** — fold into the next story's browser pass.

## Process
Premise check (thorough inventory: 4+6+3+1 copies incl. one real divergence) → PRD with 3 parity rulings → DA **APPROVE-WITH-CONDITIONS** (re-verified body identity itself; built the per-file call-site table; caught the dead-import risk + the sets:0 truthy condition) → dev agent (stale base self-corrected again — recurring, protocol holds) → gates. Zero iterations.

## Notes
- Worktree removal needed `rm -rf` (leftover .next artifacts) — remember for cleanup.
- Sprint 13 continues: #239–#244, #249. Browser-pass debt from #237/#238 rides along.
