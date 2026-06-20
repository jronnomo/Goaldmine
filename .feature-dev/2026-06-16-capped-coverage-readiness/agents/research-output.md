# Readiness Engine — Research Output
Feature: capped-coverage-readiness  
Date: 2026-06-16  
Agent: research

---

## 1. Existing Patterns

The readiness system is a pure async function (`computeReadiness`) that:
1. Resolves `current` and `start` values for each target via DB helpers
2. Calls `progressFor()` per target to get a 0..1 ratio (or `null` if no data)
3. Filters to `usable = breakdown.filter(b => b.progress !== null)` — untested targets are **excluded from both numerator and denominator**
4. Weights the usable subset to produce the 0..100 headline score

The "untested = excluded" behavior is the core thing the feature changes. Rarity-core.ts explicitly documents that it "mirrors readiness missing semantics" but does so with a parallel reimplementation (not a call to `computeReadiness`).

---

## 2. Exact Shapes + Line References

### `src/lib/readiness.ts`

**`TargetProgress` (lines 10–16):**
```typescript
export type TargetProgress = {
  target: GoalTarget;
  current: number | null;
  start: number | null;
  /** 0..1 progress toward target. Null if no data. */
  progress: number | null;
};
```

**`ReadinessSnapshot` (lines 18–25) — the contract to extend ADDITIVELY:**
```typescript
export type ReadinessSnapshot = {
  /** 0..100 overall readiness. */
  score: number;
  /** Per-target breakdown. */
  breakdown: TargetProgress[];
  /** Targets with no data yet (excluded from overall score). */
  missing: GoalTarget[];
};
```

**`progressFor` (lines 32–58):**
- Returns `null` when `current === null` for comparative metrics (baseline:*, weightLb, exercise:*)
- Build-from-zero metrics (hike:*, workout:count, log:*) always have `current ≥ 0` from resolveMetricValue — never null → never missing
- Line 48: direction=increase, already met → returns `1`; line 49: decrease, already met → `1`
- Line 52: `if (start === null) return null` — comparative metric with no start AND no current data → null

**`computeReadiness` (lines 60–89) — THE DROP:**
```typescript
// Line 81 — the usable filter:
const usable = breakdown.filter((b) => b.progress !== null);
if (usable.length === 0) return { score: 0, breakdown, missing };

// Lines 84–85:
const totalWeight = usable.reduce((acc, b) => acc + (b.target.weight ?? 0), 0);
if (totalWeight === 0) return { score: 0, breakdown, missing };

// Lines 87–88:
const weighted = usable.reduce((acc, b) => acc + (b.target.weight ?? 0) * (b.progress ?? 0), 0);
return { score: Math.round((weighted / totalWeight) * 100), breakdown, missing };
```

Untested targets end up in **both** `breakdown[]` (with `progress: null`) and `missing[]`. They are excluded from the denominator (`totalWeight` only sums usable). This is what makes the score "dishonestly high."

**`computeReadinessSeries` (lines 91–111):**
Iterates weekly, calls `computeReadiness` each time, stores only `snap.score`. Adding new fields to `ReadinessSnapshot` does not require any change here — the series point type (`ReadinessSeriesPoint`) only keeps `score`.

### `src/lib/metrics-registry.ts`

**`GoalTarget` type (lines 12–24):**
```typescript
export type GoalTarget = {
  metric: string;
  label: string;
  units: string;
  direction: Direction;
  target: number;
  /** Optional starting value. Auto-captured at goal creation if absent. */
  start?: number;
  /** Importance weight (0-1). Goal-wide weights should sum to ~1. */
  weight: number;
  /** Optional rationale string for the user / Claude to read. */
  rationale?: string;
  // MISSING: gating?: boolean  ← must be added here
};
```

**`GoalTargetSchema` zod (lines 51–60) — must stay MIRRORED to GoalTarget:**
```typescript
export const GoalTargetSchema = z.object({
  metric: z.string()...,
  label: z.string()...,
  units: z.string()...,
  direction: z.enum(["increase", "decrease"])...,
  target: z.number()...,
  start: z.number().optional()...,
  weight: z.number().min(0).max(1)...,
  rationale: z.string().optional()...,
  // MISSING: gating: z.boolean().optional()  ← must be added here
});
```

**`Direction` and `MetricSpec` types (lines 10, 26–33):**  
`Direction = "increase" | "decrease"` — used by `progressFor` and rarity. `MetricSpec` is for the UI picker registry; it does not affect readiness computation.

**`MT_ELBERT_DEFAULT_TARGETS` (lines 189–270) — natural GATES:**

| Metric | Weight | Natural Gate? | Rationale |
|--------|--------|---------------|-----------|
| `hike:prep_completion` | 0.30 | **YES** | "Most direct predictor" — must actually do 6 hikes |
| `hike:max_elevation_single` | 0.20 | **YES** | "Proof that cardio-vascular demands are within reach" — dress rehearsal |
| `hike:total_elevation_ft` | 0.15 | Maybe | Volume signal; not a binary gate |
| `baseline:20 Min Step-Up Reps` | 0.10 | No | Gym proxy, secondary |
| `baseline:1.5 Mile Run` | 0.10 | No | Aerobic base check, secondary |
| `baseline:Deep Squat Hold` | 0.05 | No | Mobility, low weight |
| `baseline:Goblet Squat 10-rep Max` | 0.05 | No | Strength insurance, low weight |
| `weightLb` | 0.05 | No | Body comp, low weight |

The two hike targets (prep_completion + max_elevation_single, combined weight 0.50) are the natural gates: you cannot fake these with gym work, and failing either one means the summit attempt is premature regardless of how good your baseline numbers look.

---

## 3. All Consumers of Readiness (Impact Table)

| File | What it reads | Impact of the change |
|------|---------------|----------------------|
| `src/lib/readiness.ts` | Defines all types + `computeReadiness`; `computeReadinessSeries` reads `snap.score` only | **MUST change** — add `rawScore`, `ceiling`, `coverage`, `gates[]`, `openGateCount` to `ReadinessSnapshot` and rewrite score formula |
| `src/lib/recap.ts` (line 256) | `snapshot.score`, `snapshot.missing.length`, `snapshot.breakdown` | **Score will drop/cap** — `progressPct = snapshot.score` now reflects the capped honest headline. `all-missing` detection via `missing.length === targets.length` still valid (missing[] semantics unchanged). `usableBreakdown.filter(b => b.progress !== null)` for topMetricLabel still valid. To surface coverage/gates on the recap card, add `coverage` and `openGateCount` to `RecapGoalBlock`. |
| `src/lib/mcp/tools.ts` `compute_readiness` (line 954–955) | Spreads entire snapshot: `{ goalId, objective, asOf, ...snap }` | **New fields flow through automatically** via the spread — no tool schema change needed. Coach sees `rawScore`, `ceiling`, `coverage`, `gates[]`, `openGateCount` as soon as they're on the snapshot. Recommend updating tool description to mention the cap. |
| `src/lib/mcp/tools.ts` `update_goal_targets` (line 3159) | Validates via `z.array(GoalTargetSchema).min(1)` | **Auto-passes `gating`** once GoalTargetSchema gets `gating: z.boolean().optional()`. No other change needed. |
| `src/lib/mcp/tools.ts` `create_goal` (line 3805–3806) | Validates via `z.array(GoalTargetSchema).min(1).optional()` | **Same — auto-passes `gating`** via GoalTargetSchema. |
| `src/lib/mcp/tools.ts` `get_goal` (line 900) | Returns `targets: goal.targets` verbatim | **No change needed** — stored JSON round-trips as-is; `gating` fields persist once written. |
| `src/app/progress/page.tsx` (lines 38–46, 99–154) | `snapshot.score` (big numeral), `snapshot.breakdown` (ReadinessBreakdown), `snapshot.missing.length` (hint text), series `.score` | **Score display changes** (drops/caps). Layout unchanged. To surface coverage/gate count, add a sub-line near the big numeral (optional enhancement). |
| `src/app/stats/page.tsx` (lines 39–46, 90–112) | Same pattern as progress/page.tsx | **Same impact** as progress/page.tsx. Stats page is a near-duplicate layout. |
| `src/app/goals/[id]/page.tsx` (lines 111, 224–231) | `readiness.score` (big numeral), `readiness.missing.length` (badge), `readiness.breakdown` (ReadinessBreakdown) | **Score display changes**. `missing.length` badge still works. To show `ceiling` or gate count here, slot below the score numeral. |
| `src/components/ReadinessBreakdown.tsx` (line 1–46) | `TargetProgress[]` — renders `b.progress`, `b.target.label`, `b.target.weight`, `b.current`, `b.target.target`, `b.start`, `b.target.rationale` | **No change required** for the base feature. Targets that previously had `progress: null` (shown as "—") now show "0%" — that's intentional and correct. If you want to visually distinguish "no data" from "0% progress," a `b.progress === null ? "no data" : "0%"` guard already exists implicitly (line 7: `pct === null ? "—" : "${pct}%"`). The logic stays valid since `missing[]` targets still have `progress: null` in `breakdown[]`. |
| `src/components/ReadinessChart.tsx` | `{ date: string; score: number }[]` series — renders score as area chart | **Score series values will change** (lower/capped). Chart Y-axis already 0–100. No code change needed but historical series will show lower values. |
| `src/lib/rarity-core.ts` (lines 399–418) | **REIMPLEMENTS** missing semantics — does NOT call `computeReadiness` | See section 4 below. |
| `src/lib/rarity.ts` | Async wrapper; calls `computeTargetFeasibility` from rarity-core | No readiness calls. Not impacted. |

### Additional consumers checked (no readiness usage found):
- `src/lib/game/engine.ts` — no readiness
- `src/app/goals/page.tsx` — only mentions "readiness" in marketing copy
- `src/app/character/page.tsx` — no readiness
- `src/lib/mcp/instructions.ts` — no readiness
- `weekly_summary_data` tool — pure data bundle, no readiness call

---

## 4. The Rarity-Core Coupling (Consistency Plan)

**rarity-core.ts does NOT call `computeReadiness`.** It reimplements the missing/unknown logic independently inside `computeTargetFeasibility` (lines 399–418):

```typescript
// Lines 400–419 — the mirror comment:
// post-merge fix: never-measured targets (null current, no explicit start) are 'unknown'
// — mirrors readiness `missing` semantics.
// Build-from-zero metrics (hike:*, workout:count, log:*) always have current=0 from
// resolveMetricValue, so they are never null here; this guard only fires for
// baseline:*, exercise:*, and weightLb when no data has been logged yet.
if (current === null && (target.start === undefined || target.start === null)) {
  return {
    ...
    verdict: "unknown",
    countsTowardTier: false,
    currentValue: null,
  };
}
```

**The engines serve different purposes:**
- `readiness.ts` measures "how far along am I?" — a progress percentage 
- `rarity-core.ts` measures "how hard is it to get there from here?" — a difficulty tier

**Will the change create inconsistency?**

Partially, by design:
- After the change, readiness.ts treats untested targets as 0 progress in the denominator, making the headline score lower
- rarity-core.ts still excludes untested targets (`countsTowardTier: false`) from the difficulty tier calculation

This divergence is _intentional and acceptable_: rarity can't rate a target it has no trajectory data for — "unknown" tier is correct. Readiness can have an opinion: "you haven't started, that's 0% progress, full weight."

**Does `gating: boolean` affect rarity-core.ts?** No. Rarity-core.ts does not read the `gating` field. It will simply ignore it — the field is present on the GoalTarget object but is not destructured or referenced anywhere in rarity-core.ts or rarity.ts. No rarity change needed.

**Keeping them consistent on the "gating: false is not a cap for rarity" rule:**  
Add a one-liner comment in rarity-core.ts near line 400 noting that `gating` is a readiness-only concept. No logic change needed.

---

## 5. Schema Mirroring Note (type ↔ zod)

`GoalTarget` type (metrics-registry.ts line 12) and `GoalTargetSchema` zod (metrics-registry.ts line 51) are in the same file and are explicitly paired. The existing comment at line 48 ("mirrors the GoalTarget type exactly") makes the contract clear.

**Both must be updated together:**

In `GoalTarget` type:
```typescript
/** If true, while progress < 1 the headline score is capped at GATE_CEILING (80). */
gating?: boolean;
```

In `GoalTargetSchema`:
```typescript
gating: z.boolean().optional().describe(
  "Gate flag — while any gating target has progress < 1 (including untested), " +
  "the headline score is capped at 80. All gates cleared → ceiling 100."
),
```

Since `gating` is optional with no default, existing stored targets that lack the field will parse cleanly (zod `.optional()` passes for missing keys). No migration needed.

**`MCP tools that use GoalTargetSchema` (`update_goal_targets` line 3159, `create_goal` line 3805, `promote_note` line 3394, `compute_readiness_preview` line 4704):** all use `z.array(GoalTargetSchema)`. Adding `gating` to the schema means the coach can pass `gating: true` in any of these calls. No per-tool schema change required.

---

## 6. MT_ELBERT Targets That Become Gates

Recommended to mark as `gating: true` in MT_ELBERT_DEFAULT_TARGETS (and in the current stored targets for the active Mt. Elbert goal via `update_goal_targets`):

| Target | Metric | Rationale for gating |
|--------|--------|----------------------|
| Prep hikes completed | `hike:prep_completion` | 6 hikes in 12 weeks — 0 done = category error, no gym number compensates |
| Largest single hike | `hike:max_elevation_single` | "Proof" hike — 4000+ ft in one day is the dress rehearsal. Uncleared = the summit is a gamble |

All other 6 targets in MT_ELBERT_DEFAULT_TARGETS are supporting signals (gym tests, body weight). They should remain unset (`gating: false` / absent) — a weak goblet squat doesn't block the summit, it just lowers your score.

---

## 7. Risks

### R1 — Score will drop on deploy (EXPECTED, communicate proactively)
All active goals' headline readiness scores will fall the moment the code deploys, because untested targets now penalize the denominator instead of being silently excluded. For a user with 4/8 targets tested, the current inflated score (e.g., 72/100 over 4 usable targets) becomes the honest score (e.g., 44/100 over 8 targets). If any gate is also unclosed, the cap bites too (e.g., max 80). This is correct behavior but it will feel like a regression unless the coach proactively explains: "Your score dropped because the engine is now honest about untested metrics."

### R2 — computeReadinessSeries will regenerate lower historical scores
`computeReadinessSeries` calls `computeReadiness` for each week. After the change, if those weekly calls are made with the new logic, all past series points recompute lower. The chart will look like it went backwards. This is accurate but potentially confusing. The historical series is always re-derived on demand (no cache) so there's no migration work — just expectation management.

### R3 — `all-missing` detection in recap.ts is still correct but needs verification
`recap.ts` line 260: `snapshot.missing.length === targets.length ? null : snapshot.score`. This condition detects "all targets untested → show '—' on the card." After the change, `missing[]` semantics are preserved (only targets with `progress: null` in `breakdown[]` go into `missing[]`). The condition is still correct. BUT: the new `score` formula will produce 0 (not null) if all weights are split between untested (0 progress) targets and no gates. The `progressPct` guard prevents rendering "0%" as "—", which is correct — "0%" is honest.

### R4 — Zod/type drift (highest implementation risk)
`GoalTarget` type and `GoalTargetSchema` are in the same file and explicitly coupled, but there is no compile-time enforcement that they match beyond manual inspection. If `gating` is added to only one, the mismatch is silent at runtime (zod strips unknown fields on `.parse()` but `.safeParse()` / passthrough mode / coercion can mask it). Mitigation: add `gating` to both in the same commit, and note in the comment block.

### R5 — `missing[]` semantics change is subtle
Currently `missing[]` = "targets excluded from score." After the change, `missing[]` = "targets with no data" (same definition) but these targets are now included in the denominator at 0 progress. The semantic label "missing" (from the type comment: "Targets with no data yet (excluded from overall score)") will be stale — they are no longer "excluded from score." Update the type's JSDoc comment to match new semantics.

### R6 — USER_TZ N/A
`computeReadiness` does not do timezone-sensitive date math itself — it delegates to `resolveMetricValue` and `resolveMetricStart` via `goal-targets.ts`. The `asOf: Date` is already a JS Date (not a dateKey string). No timezone concern in `readiness.ts`.

---

## 8. Conventions Checklist

- [x] No Prisma migration — `gating` is on `Goal.targets` JSON (confirmed: `Goal.targets` is `Json` in Prisma schema, already proven by `rationale?` being optional without migration)
- [x] GoalTarget type and GoalTargetSchema must be updated in the same change in `metrics-registry.ts`
- [x] ReadinessSnapshot extension is additive — `.score`, `.breakdown`, `.missing` all preserved
- [x] `computeReadinessSeries` does not need a type change — only reads `snap.score`
- [x] MCP `compute_readiness` spreads snapshot — new fields flow through automatically
- [x] All pages reading `snapshot.score` will display the new (capped) value correctly without code changes
- [x] `ReadinessBreakdown` renders `b.progress === null ? "—" : "${pct}%"` — still correct for missing targets
- [x] rarity-core.ts needs no logic change — `gating` field is ignored there
- [x] No server/client boundary issues — `GoalTarget` type is already in `metrics-registry.ts` which is flagged as client-safe; `gating` field is a primitive boolean, no issue
- [ ] Update `ReadinessSnapshot.missing` JSDoc to remove "excluded from overall score" (they're now included at 0)
- [ ] Update `compute_readiness` tool description to mention cap and coverage fields
- [ ] Update `MT_ELBERT_DEFAULT_TARGETS` with `gating: true` on the two hike targets (can be a separate coach call to `update_goal_targets` or a code change to the defaults)

---

## 9. Summary (~10 lines)

**Additive snapshot shape:** `ReadinessSnapshot` keeps `.score` (now = `min(rawScore, ceiling)`), `.breakdown[]`, `.missing[]` and gains `.rawScore` (honest weighted avg over all targets, untested = 0), `.ceiling` (80 or 100), `.coverage: { tested: number, total: number }`, `.gates: GoalTarget[]` (gating targets not yet at 1.0), `.openGateCount`. The score denominator changes: untested targets now contribute full weight (at 0 progress) instead of being excluded.

**create_goal / update_goal_targets auto-pass `gating`:** Both tools use `z.array(GoalTargetSchema)`. Adding `gating: z.boolean().optional()` to `GoalTargetSchema` (metrics-registry.ts line ~51) is the only schema change needed — the field flows through automatically to the DB and back out through `get_goal.targets` verbatim. No tool schema modification required beyond the base zod type.

**rarity-core.ts calls or reimplements?** REIMPLEMENTS — it has its own `current === null` → `verdict: "unknown" / countsTowardTier: false` guard (rarity-core.ts line 405) with an explicit comment "mirrors readiness missing semantics." It does NOT call `computeReadiness`. The two engines remain independent and the divergence (rarity excludes untested from difficulty tier; readiness includes them at 0 for progress %) is intentional and correct.

**Key deployment risk:** All existing readiness scores will drop on deploy (honest denominator) and may also be capped at 80 if any gate is open. This is correct behavior but requires proactive coach communication.
