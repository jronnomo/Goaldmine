# Completion report — #246 — 2026-07-11 · Data export

## Shipped (commit b77e764, merged on feature/phase1-auth; +447 across 5 files)
1. **`src/lib/export-data.ts`**: `buildExportPayload(db)` — all 17 SCOPED_MODELS via the passed ALS-scoped client (isolation structural, not manual), uniform createdAt-asc, workout trees nested (exercises→sets), plan trees nested (revisions+overrides). **DA catch honored with an orchestrator refinement**: FootageMarker (scoped, nullable workoutId) exports TOP-LEVEL ONLY — nesting-only would have silently dropped unlinked footage; top-level+nested would have duplicated rows.
2. **`/api/export`** (#232 skeleton): auth→401→runWithUser; 4MB cap via `Buffer.byteLength` (DA: `.length` undercounts emoji) → clear 413, never truncation; `Content-Disposition: attachment; filename="goaldmine-export-<dateKey>.json"` in USER_TZ via calendar-core (DA module-graph nit).
3. **/settings "Your data" card** above the danger zone — plain `<a download>`, no client island.
4. **8 Proxy-mock tests**: all-17-and-only-17 access enforced; account/session/oAuth access THROWS; include shapes asserted (incl. footageMarkers NOT nested); note types unfiltered (the user's standing_rules/reviews export — leaky-reads is MCP-surface, not ownership); empty-user validity.
5. **`scripts/measure-export.ts` kept permanently** as the size watchdog (2.5MB escalation trigger for the streaming follow-up baked into its output).

## Verification
- Gates: tsc 0 · lint 0 errors, no disables · **817/817** (809 + 8) · build OK (/api/export registered).
- **Founder-scale measurement (real dev DB, run by dev agent AND orchestrator post-merge)**: 1,445,049 bytes (1.378 MB) — matches the DA's independent 1.372 MB estimate; comfortably under the 4 MB cap and Vercel's 4.5 MB response limit. Biggest movers: plan (702KB — planJson/snapshot blobs), workout (299KB), nutritionLog (174KB).
- Browser: /settings + /api/export both 307 cleanly for signed-out (founder's local session still cleared from #245) — **the signed-in card + actual download check falls to the founder** (30 seconds: /settings → Export my data → file lands).

## Process
Premise check (clean; #232 template; the four userId-less child models; all-Note-types ruling) → PRD → DA **APPROVE-WITH-CONDITIONS** (measured the real payload itself; FootageMarker nullable-FK catch; Buffer.byteLength; relation names verified against schema) → dev agent (stale base self-corrected) → gates + post-merge re-measurement. Zero iterations.

## Notes
- Remaining account-hardening: #247 (invite maxUses race). Then #250, #252, #251.
- Founder to-dos accumulating: sign back in on localhost; 30s export download check; six UXR-235 device rows.
