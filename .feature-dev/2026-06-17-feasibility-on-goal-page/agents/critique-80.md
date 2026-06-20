# Story #80 — Devil's Advocate Critique

**Scope:** `get_goal` description edit (tools.ts ~line 829) + new "### Feasibility" subsection in `docs/coaching/project-goal-prompts.md`
**Reviewer role:** Fact-check description/doc claims against real code. Read-only.
**Date:** 2026-06-17

---

## Verified Claims (accurate)

| Claim | Source location | Verdict |
|-------|----------------|---------|
| `get_goal` returns `feasibility: { computed, coach }` | tools.ts:911 | ✓ |
| `feasibility.computed` has `tier` | rarity-core.ts:211 (`GoalFeasibility.tier`) | ✓ |
| `feasibility.computed` has `weeksRemaining` | rarity-core.ts:217 | ✓ |
| `feasibility.computed` has `perTarget[]` | rarity-core.ts:214 | ✓ |
| Each perTarget has `requiredRate` | rarity-core.ts:195 (`TargetFeasibility`) | ✓ |
| Each perTarget has `observedRate` | rarity-core.ts:196 | ✓ |
| Each perTarget has `verdict` | rarity-core.ts:200 | ✓ |
| `unratedReason` values are `"someday" \| "no-targets" \| "no-data" \| null` | rarity-core.ts:212 | ✓ |
| `feasibility.coach` is real — `CoachFeasibility \| null` | tools.ts:904 + rarity-core.ts:220 (`parseCoachFeasibilityLocal` = aliased `parseCoachFeasibility`) | ✓ |
| `minObservedPoints === 3` | rarity-core.ts:62 | ✓ |
| observedRate requires `observedPoints >= 3` | rarity-core.ts:458 | ✓ |
| FeasibilityReadout on Today — between MRR card and next-milestone card | ProjectTodayView.tsx:226-291 (MRR card ends ~258, FeasibilityReadout at 263, next-milestone at 270) | ✓ |
| FeasibilityReadout on goal page — else/unrated branch | goals/[id]/page.tsx:244-304 (ternary: `tier!==null \|\| coachFeasibility!==null` → ReachMeter; else → FeasibilityReadout) | ✓ |
| Handler logic + return shape unchanged (description-only edit) | tools.ts:834–912 — computeGoalFeasibility + parseCoachFeasibilityLocal + return shape all look unchanged; description is the only prose field in the registration | ✓ |
| rarity-core.ts consistent, no edit needed | Full file read — all tunables, type defs, and logic intact | ✓ |
| Component uses `fmtComma` (goal-generic, no `$`) | FeasibilityReadout.tsx:52; goal-presentation.ts:9–10 (`Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })` — no currency prefix) | ✓ no contradiction |

---

## Inaccuracies Found

### INACCURACY 1 — HIGH SEVERITY
**Location:** tools.ts line 829 (new description sentence) AND project-goal-prompts.md lines 73–75 (new subsection)

**Claimed:**
- Description: "A log: metric (e.g. MRR) reads unratedReason='no-data' with **null requiredRate** at 0 logs and only gets an observedRate once it has >=3 logged entries"
- Doc line 73: "At **0 MRR logs**, `log:mrr` has `unratedReason='no-data'` and `requiredRate=null` — the readout says *'Not enough logged data to rate yet — log the metric a few times.'*"
- Doc line 76–77: "At **1–2 logs**, `requiredRate` populates ('needs ~$X/wk') but `observedRate` is still *'— not yet estimable'*"

**Reality (rarity-core.ts lines 385–526):**

For `log:*` metrics, `resolveMetricValue` always returns `current=0` (not null). The docstring at line 405–411 of rarity-core.ts explicitly states: "Build-from-zero metrics (hike:*, workout:count, log:*) always have current=0 from resolveMetricValue, so they are never null here."

Because `current=0` (not null):
1. The null-current guard at line 409 (`if (current === null && (target.start === undefined || target.start === null))`) is **NOT taken**.
2. `gap = target.target - 0` = the full MRR target value (e.g., 1000 for a $1k goal) — positive.
3. `requiredRate = gap / weeksRemaining` = **non-null and non-zero at 0 logs**.
4. `norm = null` for log family (line 331–334).
5. `observedPoints = 0 < 3` → skips the observed branch.
6. Falls to the final else (line 491–505): returns `{ requiredRate: <gap/weeks>, observedRate: null, verdict: "unknown", countsTowardTier: false }`.

So at 0 logs, `requiredRate` is **populated** for a `log:mrr` target. The FeasibilityReadout sub-state decision (FeasibilityReadout.tsx line 132): `const anyRequired = perTarget.some((t) => t.requiredRate !== null)` → **true** → sub-state **3b** fires (the "pace needed" path, lines 149–162), NOT sub-state **3a** ("Not enough logged data to rate yet…", lines 136–147).

**Sub-state 3a ("Not enough logged data…") never fires for log:mrr** unless the gap is zero or negative (target already met). It fires only for `baseline:*`, `exercise:*`, and `weightLb` targets where no data has been logged AND no explicit `target.start` is set (the only path that yields `requiredRate=null`).

**The actual 0-log and 1-2-log behavior for log:mrr is identical:**
Both states take sub-state 3b: "Need more data to rate — pace needed to reach your target:" with per-target rows showing "needs ~X/wk · — not yet estimable". The distinction between 0 logs and 1–2 logs described in both the description and the doc does not exist in the engine for log:* targets.

**Correction for tools.ts line 829:** Replace "null requiredRate at 0 logs" with accurate behavior. Suggested rewrite:
> "A log: metric (e.g. MRR) with no norm (log:* has no population norm) stays unrated (`countsTowardTier=false`) until it has ≥3 logged entries — but `requiredRate` populates immediately (gap/weeksRemaining) since the engine treats `current=0` from the first entry. The readout shows the required pace from day one; only the observed-rate estimate (`rateBasis='observed'`) is withheld until ≥3 logs unlock the slope."

**Correction for project-goal-prompts.md lines 73–77:** The 0-log / 1-2-log split is wrong for log:* metrics. Both show sub-state 3b. Suggested replacement:

> - At **0–2 MRR logs**, `log:mrr` is `unratedReason='no-data'` with `requiredRate` populated but `observedRate=null` — the readout says "Need more data to rate — pace needed to reach your target: needs ~X/wk · — not yet estimable." The "Not enough logged data to rate yet" copy never appears for MRR (it fires only for metrics where no start value exists, such as an unlogged `baseline:*` target).
> - At **≥3 logs**, the observed-rate slope unlocks and `rateBasis='observed'` — the readout shows a real verdict/tier.

---

### INACCURACY 2 — LOW SEVERITY (secondary to Inaccuracy 1)
**Location:** project-goal-prompts.md line 73

**Claimed:** "the readout says *'Not enough logged data to rate yet — log the metric a few times.'*"

**Reality:** The actual sub-state 3a copy (FeasibilityReadout.tsx lines 142–145) is:
> "Not enough logged data to rate yet — log the metric a few times **to see the pace you need**."

The doc truncates the string, omitting "to see the pace you need." This is a minor literal mismatch, but since sub-state 3a never fires for log:mrr (see Inaccuracy 1), the quote is doubly moot.

---

### Note (not an inaccuracy, confirm only)
**Doc line 77:** `"needs ~$X/wk"` — the `$` is a doc-level illustration for the Chewgether/MRR context. The component renders `fmtComma(t.requiredRate)` via `Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })` (goal-presentation.ts:9–10), which produces comma-separated integers with no currency prefix. For MRR value 100, the component shows "needs ~100/wk" not "needs ~$100/wk". The doc's `$X` shorthand is illustrative of the dollar-amount domain but does not imply a hardcoded `$` in the component. No contradiction — but coaches should know the UI omits the `$`.

---

## Summary

| # | Severity | File | Claim vs Reality |
|---|----------|------|-----------------|
| 1 | HIGH | tools.ts:829 + project-goal-prompts.md:73–77 | `requiredRate=null at 0 logs` is wrong; for `log:*`, current=0 always → requiredRate populates at 0 logs; sub-state 3a never fires for log:mrr |
| 2 | LOW | project-goal-prompts.md:73 | Quoted copy truncated: "…a few times." should be "…a few times to see the pace you need." (moot since 3a doesn't fire for this metric) |

---

## Verdict: APPROVE-WITH-FIXES

**Factual errors: 2** (1 high, 1 low)

**Most important correction:** The description and doc both claim `requiredRate=null` at 0 MRR logs and that the readout shows "Not enough logged data to rate yet…". For `log:*` metrics (MRR included), this is wrong — `current=0` always gives a non-null `requiredRate`, so the "pace needed" sub-state (3b) fires immediately, never the "no data" sub-state (3a). The `null-requiredRate` / 3a path is exclusively for `baseline:*`, `exercise:*`, and `weightLb` when no prior data exists and no explicit start is set. Both the MCP description sentence and the coaching doc bullet points need to be corrected before this ships or a coach will be confused the first time they see the per-week rate on a fresh project goal with 0 logs.
