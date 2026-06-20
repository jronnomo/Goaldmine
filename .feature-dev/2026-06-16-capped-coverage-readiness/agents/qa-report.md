# QA Report — Capped, Coverage-Aware Readiness
Agent: QA  
Date: 2026-06-16  
Scope: completeness + back-compat + edge-case audit (orchestrator handled engine-math + MCP-curl + visual smoke)

---

## Requirements Status Table

| AC | Requirement | Status | Evidence |
|----|-------------|--------|---------|
| AC#1 | tsc 0 errors, lint clean, build succeeds | UNTESTED | Not run in this code-only audit; code is clean TypeScript with no obvious type errors found |
| AC#2 | `gating?: boolean` in `GoalTarget` type AND `GoalTargetSchema` (mirrored) | PASS | metrics-registry.ts:24–30 (type), 67–71 (zod); same file, identical semantics |
| AC#3 | Untested targets contribute 0 to numerator, full weight to denominator | PASS | readiness.ts:141–145 — `breakdown.reduce` over ALL entries with `(b.progress ?? 0)` |
| AC#4 | `score = min(rawScore, ceiling)`; `GATE_CEILING = 80` exported | PASS | readiness.ts:29 (`export const GATE_CEILING = 80`), :134 (ceiling), :146 (`Math.min`) |
| AC#5 | `ReadinessSnapshot` additively includes new fields; `.score`/`.breakdown`/`.missing` unchanged | PASS | readiness.ts:31–65 — all five new fields present; original three retained with updated JSDoc |
| AC#6 | MCP `compute_readiness` returns new fields; description mentions coverage + cap | PARTIAL | tools.ts:959–960 — `...snap` auto-spreads all fields for non-empty targets. BUT: the early return at tools.ts:949–957 (targets.length === 0) does NOT include `rawScore`, `ceiling`, `coverage`, `gates`, `openGateCount` and returns `score: null` instead of `score: 0`. PRD edge case table requires all fields present. Description updated: tools.ts:919–927. |
| AC#7 | `create_goal` / `update_goal_targets` persist `gating` via `GoalTargetSchema` | PASS | tools.ts:3165 (`z.array(GoalTargetSchema).min(1)`) and :3812 (`z.array(GoalTargetSchema).min(1).optional()`). `get_goal` at :910 returns `...goal` verbatim — `targets` JSON round-trips including `gating`. |
| AC#8 | `MT_ELBERT_DEFAULT_TARGETS` marks natural gates `gating: true` | PASS | metrics-registry.ts:209 (`hike:prep_completion`, w=0.30), :219 (`hike:max_elevation_single`, w=0.20) — exactly the two targets called out in research |
| AC#9 | Recap card + story cover render coverage line near READINESS; no layout break | PASS | recap-card.tsx:314–315 (card, `fmtCoverageLine` computed once); :803 (SlideOne). CRIT-1 width fix: card :398 (`width: tok.bullseyeHeroDiameter`), SlideOne :843 (`width: tok.bullseyeStoryDiameter`). CRIT-2: no double-call, no `!`. SlideTwo/SlideThree untouched. |
| AC#10 | Progress page shows coverage/open-gate info per goal | PASS | progress/page.tsx:140–147 — `{snapshot.coverage.total > 0 && ...}` guard; pluralization correct; token colors only |
| AC#11 | `rarity-core.ts` consistent; `gating` field documented as readiness-only | PASS | rarity-core.ts:400–402 — comment added explicitly stating gating is readiness-only. No logic change. Engine divergence (rarity excludes untested; readiness zeros them) is intentional and documented in research. |
| AC#12 | Cap is a safety net only; light/heavy gate math verified | PASS | See math walk-through below |

---

## Back-Compat Consumer Audit

| Consumer | What it reads | Change impact | Status |
|----------|--------------|---------------|--------|
| `recap.ts` L265–266 | `snapshot.missing.length === targets.length` (all-missing → show "—") | `missing[]` still = `{progress:null}` targets. Condition still fires correctly. Score would be 0, not null, but the `null` guard fires first. | PASS |
| `recap.ts` L269–273 | `snapshot.breakdown.filter(b => b.progress !== null)` for `topMetricLabel` | Correct — still picks highest-weight *tested* target, which is the right behavior | PASS |
| `src/app/progress/page.tsx` | `snapshot.score`, `snapshot.breakdown`, `snapshot.missing.length` | Shape unchanged; score lower/capped (intentional). New coverage block added. | PASS |
| `src/app/stats/page.tsx` | Same `.score`/`.breakdown`/`.missing.length` | Shape unchanged; not modified (not in REQ-006 scope); no break | PASS |
| `src/app/goals/[id]/page.tsx` | `readiness.score`, `readiness.missing.length`, `readiness.breakdown` | Same shape unchanged | PASS |
| `src/components/ReadinessBreakdown.tsx` | `TargetProgress[]` — renders `b.progress === null ? "—" : "N%"` | Targets that were "missing" still have `progress: null` in `breakdown[]`, so "—" still renders for untested. No visual regression. | PASS |
| `src/components/ReadinessChart.tsx` | `{ date, score }[]` series | Score values lower/capped across history. Y-axis already 0–100. Chart renders correctly with lower values. | PASS |
| `compute_readiness` `...snap` | Spreads entire `ReadinessSnapshot` | New fields auto-flow to MCP response for non-empty targets | PASS |

---

## AC#12 Math Walk-Through

Formula (readiness.ts:141–146):
```
totalWeight = Σ(all target weights)               // denominator includes untested
weighted    = Σ(weightᵢ × (progressᵢ ?? 0))       // untested → 0 progress
rawScore    = Math.round(weighted / totalWeight × 100)
ceiling     = openGateCount > 0 ? 80 : 100        // GATE_CEILING = 80
score       = Math.min(rawScore, ceiling)
```

Gate cleared predicate: `progress !== null && progress >= 1` — an untested gate (progress=null) is NOT cleared, so it counts toward `openGateCount`.

**Scenario 1 — Light untested gate (~0.1 weight) + rest at 100%:**
- gate weight = 0.1, rest weight = 0.9, sum = 1.0
- `weighted = 0.1×0 + 0.9×1 = 0.90`
- `rawScore = Math.round(0.90 × 100) = 90`
- `openGateCount = 1` (gate progress = null → cleared = false)
- `ceiling = 80`
- `score = min(90, 80) = 80` ✓ **CAP BITES**

**Scenario 2 — Heavy untested gate (~0.3 weight) + rest at 100%:**
- gate weight = 0.3, rest weight = 0.7, sum = 1.0
- `weighted = 0.3×0 + 0.7×1 = 0.70`
- `rawScore = Math.round(0.70 × 100) = 70`
- `openGateCount = 1`, `ceiling = 80`
- `score = min(70, 80) = 70` ✓ **CAP MOOT** (untested-as-0 already honest)

**Scenario 3 — All gates cleared:**
- `openGateCount = 0` → `ceiling = 100`
- `score = min(rawScore, 100) = rawScore` ✓ **CEILING LIFTS**

**MT_ELBERT reference (both real gates untested, remaining 6 at 100%):**
- gates weight = 0.50, rest weight = 0.50
- `rawScore = Math.round(0.50 × 100) = 50`
- `ceiling = 80`, `score = 50` (cap moot — too heavy; honest-average already sub-80)

The PRD note in AC#12 is confirmed: *"Do NOT assume Elbert's gate weights produce exactly 80."* The real weights (0.50 combined) make the cap irrelevant for Elbert's actual gates — only goals with lighter gates trigger the 80-cap.

---

## Edge Case Table

| Scenario | Expected (PRD §6) | Actual behavior | Status |
|----------|------------------|--------------------|--------|
| No targets (engine path) | score 0, coverage {0,0}, gates [], openGateCount 0, ceiling 100 | readiness.ts:138–139: `totalWeight === 0` → returns all zeroed new fields | PASS |
| No targets (MCP tool) | All fields present, score 0 | tools.ts:949–957: returns `score: null`, omits rawScore/ceiling/coverage/gates/openGateCount | **MINOR FAIL** |
| All targets untested | rawScore 0, coverage {0,N} | All `(b.progress ?? 0) = 0`, denominator = full weight → rawScore = 0 | PASS |
| Light gate untested + rest 100% | rawScore≈90, score=80 (cap bites) | Math confirmed above | PASS |
| Heavy gate untested + rest 100% | rawScore≈70, score=70 (cap moot) | Math confirmed above | PASS |
| All gates cleared | ceiling = 100, score = rawScore | `openGateCount === 0` → `ceiling = 100` | PASS |
| No gating targets at all | ceiling = 100 always | `gates = []`, `openGateCount = 0` → ceiling = 100; honest coverage-aware average | PASS |
| coverage.total === 0 on card | coverageLine = null (hidden) | `fmtCoverageLine` returns null when `coverage.total === 0` | PASS |
| coverage.total === 0 on progress page | line hidden | `{snapshot.coverage.total > 0 && ...}` guard | PASS |
| rawScore < ceiling | score = rawScore (cap not binding) | `Math.min(rawScore, ceiling) = rawScore` when rawScore < ceiling | PASS |
| Existing targets without `gating` field | Treated as non-gate | `b.target.gating === true` — optional field absent = falsy = not a gate | PASS |

---

## Code Quality Issues

| Sev | File:Line | Issue | Fix |
|-----|-----------|-------|-----|
| MINOR | `src/lib/readiness.ts:28,44` | Typo in two JSDoc comments: `"uncleaned"` should be `"uncleared"` — not a logic bug but technically wrong vocabulary | `s/uncleaned/uncleared/g` in those two lines |
| MINOR | `src/lib/recap-card.tsx:36` | `if (!openGateCount \|\| openGateCount === 0)` — the `\|\| openGateCount === 0` clause is redundant since `!0 === true`. Blueprint addendum §Minors explicitly called this out. Logic is correct; cleanliness issue only. | Simplify to `if (!openGateCount)` |
| MINOR | `src/lib/mcp/tools.ts:949–957` | `compute_readiness` no-targets early return returns `score: null` and omits `rawScore`, `ceiling`, `coverage`, `gates`, `openGateCount`. The PRD edge case table says `score: 0` and all fields present. Pre-existing for `score: null` but newly missing for the five new fields. Coach pattern-matching on coverage/gates will silently fail this path. | Either call `computeReadiness([], asOfDate, goal.id)` and spread the result (with the message appended), or manually add the missing fields: `rawScore: 0, ceiling: 100, coverage: { tested: 0, total: 0 }, gates: [], openGateCount: 0` |

No `any` casts or `@ts-ignore` found in any of the changed files. No hardcoded goal names or user handles in display components. No raw hex colors in the progress page (all `var(--token)` Tailwind). No raw hex in recap-card.tsx (all `tok.*` template tokens). `promote_note` and `compute_readiness_preview` also use `z.array(GoalTargetSchema)` and benefit automatically from the schema update.

---

## Overall Verdict

**MINOR FIXES**

Three issues found, all minor. The implementation is functionally correct: AC#12 math is sound, the score formula is right, CRIT-1 layout fix is applied, CRIT-2 double-call guard is applied, all back-compat consumers are clean, rarity-core is documented and untouched, the schema is mirrored, and MT_ELBERT gates are seeded correctly. The only structural gap is the MCP tool's no-targets early return omitting the new fields — fixable in two lines and unlikely to matter until a goal with zero targets is queried.

---

## Fix Priority List

1. **(MINOR — ship-blocker for pedantic PRD compliance)** `tools.ts:949–957` — replace hardcoded early return with `computeReadiness([], asOfDate, goal.id)` spread + append message, so the no-targets path returns the same shape as non-empty targets.
2. **(MINOR — cosmetic)** `readiness.ts:28,44` — fix `"uncleaned"` → `"uncleared"` in GATE_CEILING JSDoc and ceiling field JSDoc.
3. **(MINOR — cosmetic)** `recap-card.tsx:36` — simplify redundant `|| openGateCount === 0` branch as the blueprint addendum requested.

None of the above block shipping. Items 2 and 3 are one-liners. Item 1 is a 4-line fix that makes the MCP tool contract fully consistent with the PRD edge case table.

---

## Summary (~10 lines)

The feature is well-implemented and structurally sound. The `computeReadiness` engine correctly zeros untested targets in the numerator while keeping full weight in the denominator, the `Math.min(rawScore, ceiling)` cap fires only when warranted (confirmed via the light/heavy gate scenarios), and `GATE_CEILING = 80` is exported as required. The `ReadinessSnapshot` extension is genuinely additive — every consumer audited reads the same fields it always did and sees only a lower/capped score (which is the feature working). Satori layout fixes (CRIT-1 column width, CRIT-2 no double-call) are correctly applied on both the card and SlideOne; SlideTwo/SlideThree are untouched. `GoalTarget` type and `GoalTargetSchema` are mirrored in the same file; both MT_ELBERT gates are seeded. The three issues found are all minor: a `"uncleaned"` typo (×2), a redundant `|| openGateCount === 0` branch in `fmtCoverageLine` (noted by blueprint but not fixed), and the no-targets MCP path omitting the five new fields. None block shipping.
