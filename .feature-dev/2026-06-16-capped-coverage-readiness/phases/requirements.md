# Requirements — Capped, Coverage-Aware Readiness

PRD: `docs/prds/PRD-capped-coverage-readiness.md`. No Prisma migration (gating is additive JSON). Design locked: untested=0, GATE_CEILING=80 ceiling-until-gates-clear, coverage shown, additive `ReadinessSnapshot`.

---

## REQ-001 — `gating` on GoalTarget (type + zod, mirrored) + seed gates
**Description:** Add optional `gating?: boolean` to the `GoalTarget` type AND the `GoalTargetSchema` zod object in `src/lib/metrics-registry.ts` (they must stay mirrored). Mark the natural Elbert gate(s) in `MT_ELBERT_DEFAULT_TARGETS` with `gating: true` (dress-rehearsal / ≥12k-ft loaded exposure / full-pack summit-sim — research identifies exactly which).
**Files:** `src/lib/metrics-registry.ts`.
**Acceptance:** type + schema both have `gating?: boolean`; existing targets without the field still validate; ≥1 MT_ELBERT target flagged; tsc clean.
**Deps:** none. **Complexity:** S.

## REQ-002 — `computeReadiness` engine rewrite + additive snapshot
**Description:** In `src/lib/readiness.ts`: compute `rawScore = Σ(weightᵢ·(progressᵢ ?? 0)) / Σ(all target weights)` (untested → 0 progress, FULL weight in denominator). Compute `coverage = {tested: count(progress!==null), total: targets.length}`. Gating: `gates = targets.filter(t=>t.gating)`; per gate `cleared = progress!==null && progress>=1`; `openGateCount = gates.filter(!cleared).length`; `ceiling = openGateCount>0 ? GATE_CEILING : 100`; `score = Math.min(rawScore, ceiling)`. Export `GATE_CEILING = 80`. Extend `ReadinessSnapshot` ADDITIVELY: add `rawScore`, `ceiling`, `coverage`, `gates: {label, progress, cleared}[]`, `openGateCount`; KEEP `score`, `breakdown`, `missing` exactly. Preserve existing empty-targets/zero behavior. `computeReadinessSeries` keeps using `.score` (now capped).
**Files:** `src/lib/readiness.ts`.
**Acceptance:** untested target drags score (3/15 tested ≠ 100%); a goal w/ 1 open gate + strong rest → `score===80`; clearing it lifts cap; `score===min(rawScore,ceiling)`; snapshot additive & back-compatible; tsc clean.
**Deps:** REQ-001 (reads `target.gating`). **Complexity:** M.

## REQ-003 — MCP surface (`compute_readiness` + verify write tools)
**Description:** `src/lib/mcp/tools.ts`: `compute_readiness` returns `coverage`, `gates`, `openGateCount`, `rawScore`, `ceiling` alongside `score`/`breakdown`; update its description to explain coverage + the gate cap (so the coach can name unproven gates). Verify `create_goal` and `update_goal_targets` persist `gating` via `GoalTargetSchema` (fix if they hand-pick fields). Confirm `get_goal` returns `gating` verbatim.
**Files:** `src/lib/mcp/tools.ts`.
**Acceptance:** `tools/call compute_readiness` returns the new fields; `update_goal_targets` with `gating:true` round-trips (read back via get_goal/compute_readiness → openGateCount reflects it); `safe()` wrapper intact; tsc clean.
**Deps:** REQ-002. **Complexity:** S-M.

## REQ-004 — rarity-core consistency
**Description:** `src/lib/rarity-core.ts` (~401, "mirrors readiness missing semantics") — keep consistent with the new untested-as-0 / capped behavior. If it CALLS computeReadiness, confirm it reads the right field; if it REIMPLEMENTS missing/scoring, align it (no divergence/double-count). Document the consistency decision in code.
**Files:** `src/lib/rarity-core.ts`.
**Acceptance:** rarity logic consistent with readiness v2; tsc clean; documented.
**Deps:** REQ-002. **Complexity:** S.

## REQ-005 — Recap card/Story coverage line
**Description:** `src/lib/recap.ts`: add `coverage` + `openGateCount` to `RecapGoalBlock`/`WeeklyRecap.goal` (from `computeReadiness`). `src/lib/recap-card.tsx`: render a compact muted line near "READINESS" (card + story cover): `"{tested}/{total} verified"` + (when openGateCount>0) `" · {openGateCount} gate{s} left"`. Satori-safe (flex, inline styles, no CSS vars/grid/svg-img, explicit display on multi-child divs). Don't break the balanced layout / footer.
**Files:** `src/lib/recap.ts`, `src/lib/recap-card.tsx`.
**Acceptance:** WeeklyRecap.goal carries coverage+openGateCount; card+story render the line; the ring shows the capped score; render-smoke + visual check clean; no "elbert"/hardcode.
**Deps:** REQ-002. **Complexity:** M.

## REQ-006 — Progress page coverage/gates
**Description:** `src/app/progress/page.tsx`: surface coverage ("N/M verified") and open-gate count per goal's readiness, using existing Tailwind tokens, mobile-first ≤390px.
**Files:** `src/app/progress/page.tsx`.
**Acceptance:** coverage/gates shown per goal at 390px; tokens not hardcoded colors; tsc/lint clean.
**Deps:** REQ-002. **Complexity:** S.

---

## Work streams
- **Stream A — Engine/Schema/MCP/Rarity:** REQ-001, REQ-002, REQ-003, REQ-004 (`metrics-registry.ts`, `readiness.ts`, `tools.ts`, `rarity-core.ts`). Defines the `ReadinessSnapshot` v2 contract.
- **Stream B — Display surfaces:** REQ-005, REQ-006 (`recap.ts`, `recap-card.tsx`, `progress/page.tsx`). Codes against Stream A's new snapshot fields (`coverage`, `openGateCount`).
- B depends on A's snapshot fields → sequence A → merge → B (Architect freezes the snapshot shape so B is unambiguous). Zero shared-file overlap.
