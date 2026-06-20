# Blueprint v2 Addendum — resolves the Devil's Advocate critique

Read `architecture-blueprint.md` first, then THIS (overrides on conflict). Fixes the 2 criticals + the highs/minors from `architecture-critique.md`.

## CRIT-1 — Fix the ring/READINESS column width (real layout bug)
`flexShrink: 0` does NOT stop a column from GROWING wider than the ring when the coverage text is wide. The READINESS column (ring + "READINESS" label + new coverage line) MUST get an explicit fixed width:
- Card: `width: tok.bullseyeHeroDiameter` on the column div wrapping the ring + READINESS + coverage line.
- SlideOne (story cover): `width: tok.bullseyeStoryDiameter` on the equivalent column.
The coverage line itself: muted token color, font ~20px, `textAlign: "center"`, **allow wrapping** (do NOT use `whiteSpace:"nowrap"`) so "10/15 verified · 3 gates left" wraps within the fixed column width instead of widening it. Every multi-child div in this column needs explicit `display:"flex"` + `flexDirection:"column"` (satori crash guard).

## CRIT-2 — No double-call / no `!` assertion for the coverage line
Compute once before the JSX: `const coverageLine = fmtCoverageLine(coverage, openGateCount)` (returns `string | null`). Then `{coverageLine && (<div …>{coverageLine}</div>)}`. Do NOT call `fmtCoverageLine` twice and do NOT use a non-null `!` assertion inside the conditional.

## HIGH-4 — The cap is a SAFETY NET, not always-on (test correctly)
`score = min(rawScore, ceiling)`. The 80 ceiling only changes the result when `rawScore > 80`. With HEAVY untested gates (Elbert: 0.30 + 0.20), untested-as-0 already pulls rawScore below 80, so `min` returns rawScore and the cap is moot — THIS IS CORRECT, not a bug. Do NOT add logic to force 80. Weight-aware test cases (see PRD AC#12):
- light gate (~0.1) untested + rest 100% → rawScore≈90 → score 80 (cap bites)
- heavy gate (~0.3) untested + rest 100% → rawScore≈70 → score 70 (cap moot)
- all gates cleared → ceiling 100.

## HIGH-3 — Template gates only affect NEW goals (document, not code)
Flagging `gating:true` in `MT_ELBERT_DEFAULT_TARGETS` affects only newly-created goals. The user's LIVE Elbert goal targets are DB JSON: on deploy its score will DROP from untested-as-0 immediately, but the **gate ceiling will NOT fire on the live goal until the coach sets `gating:true` on `hike:prep_completion` + `hike:max_elevation_single` via `update_goal_targets`.** Call this out in the completion report. No code change.

## Minors (apply)
- `fmtCoverageLine`: drop the redundant `|| openGateCount === 0` branch; the gate clause is simply appended only when `openGateCount > 0`. Pluralize: `1 gate left` / `N gates left`.
- Coverage when `total === 0` (no targets): return `null` (hide the line entirely — don't render "0/0 verified").
- SlideTwo / SlideThree: untouched (no coverage line).
- `update_goal_targets` / `create_goal`: ensure the `gating` mention in the description doesn't misorder fields; only add `gating` to `GoalTargetSchema` (the array validator already flows it).
- JSDoc note in readiness: a gate whose metric has `start === target.target` returns progress 0 from `progressFor` and can never clear — note this as a data-config caveat, not an engine bug.
- Progress page: keep the existing `score===0` semantics; just append the coverage line (hidden when total===0).

## Verdict
With the above applied, APPROVED for one developer agent: REQ-001 → 002 → 004 → 003 → 005 → 006.
