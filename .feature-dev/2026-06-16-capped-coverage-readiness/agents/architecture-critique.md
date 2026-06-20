# Architecture Critique — Capped, Coverage-Aware Readiness
Agent: devil's-advocate  
Date: 2026-06-16  
Blueprint under review: `.feature-dev/2026-06-16-capped-coverage-readiness/agents/architecture-blueprint.md`  
Verdict: **NEEDS REVISION** (2 critical fixes; remainder are medium/low)

---

## Critical Issues

### CRIT-1 — Ring column has no width constraint; `flexShrink: 0` does NOT prevent growth

**What:** Blueprint Section 7b says "does not grow the ring column's width — `flexShrink: 0` on the parent column means any text overflow wraps or clips, not expands." This claim is factually wrong. `flexShrink: 0` prevents an element from *shrinking* below its natural size — it says nothing about growth. In a flex-row parent (the goalBlock container at `recap-card.tsx:359`) with no width on the ring column, the column will expand to fit its widest child.

**Why it matters:** The ring column is currently sized by the ProgressRing SVG (diameter = `tok.bullseyeHeroDiameter` = 300px for coal, 320px for parchment). "READINESS" at 30px font is ~200px wide — narrower than the ring. The coverage line at 22px could easily be wider: "10/15 verified · 3 gates left" is ~30 characters and likely 330-380px at the `fontSans` metrics. If coverage text exceeds 300px, the ring column grows, compresses the `flex: 1` goal-objective column, and can cause objective text to wrap to an extra line or clip on a fixed-height zone (`zoneHeight.goalBlock = 440px`). On the generated card this is a permanent artifact in shareable images.

**Fix:** Add `width: tok.bullseyeHeroDiameter` to the outer column wrapper div (the one with `display: flex, flexDirection: column, alignItems: center, gap: 16, flexShrink: 0` at `recap-card.tsx:373`). This caps the column at the ring's own diameter. Satori will then wrap (not overflow) the coverage text within that width. The inner column that wraps READINESS + coverage (the new one added by the blueprint) should inherit this width automatically since it's a block-level flex child.

```tsx
// line 373 — add width:
<div
  style={{
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 16,
    flexShrink: 0,
    width: tok.bullseyeHeroDiameter,   // ← ADD THIS
  }}
>
```

SlideOne is less severe (the ring is centered in a full-width column, not competing with a sibling for horizontal space), but a `maxWidth: tok.bullseyeStoryDiameter` on the inner column wrapper there is still a defensive add.

**Severity: Critical.** Broken layout on the generated card/story is a visible regression on the shareable image.

---

### CRIT-2 — `fmtCoverageLine` called twice in satori JSX; `!` assertion inside conditional

**What:** The blueprint renders the coverage line using a double-call pattern:

```tsx
{fmtCoverageLine(recap.goal?.coverage, recap.goal?.openGateCount) !== null && (
  <div style={{ ... }}>
    {fmtCoverageLine(recap.goal?.coverage, recap.goal?.openGateCount)!}
  </div>
)}
```

This calls `fmtCoverageLine` twice per site (4 times total — once for each of the two satori-rendered surfaces: full card and SlideOne). The non-null assertion `!` on the inner call is needed because TypeScript can't narrow the return type through the `&&` expression — but it's easy to misread as "guaranteed non-null by construction" when it's actually "guarded by the outer check."

**Why it matters:** For a pure function this is safe — but satori does not execute JSX lazily. Both calls run at render time. If `fmtCoverageLine` is ever made non-pure (e.g., to format with locale-specific numbers), the double-call could produce inconsistent output between the null check and the actual render. More importantly, any future refactor that adds a side-effect to the helper silently breaks both cards without a warning. The `!` assertion also suppresses a genuine TypeScript safety signal.

**Fix:** Extract to a `const` immediately before the JSX:

```tsx
// Helper call site — add before the enclosing div in both RecapCard and SlideOne:
const coverageLine = fmtCoverageLine(recap.goal?.coverage, recap.goal?.openGateCount);

// Then in JSX:
{coverageLine !== null && (
  <div style={{ ... }}>
    {coverageLine}
  </div>
)}
```

This eliminates the `!` assertion, makes it obvious what value is being rendered, and is immune to non-pure function refactors.

**Severity: Critical (correctness risk).** The double-call is safe today but introduces a silent correctness risk if either the function or its inputs ever mutate. The `!` assertion actively suppresses TypeScript's null guard. Fix is a one-line extract — zero cost.

---

## Design Concerns (High)

### HIGH-1 — MT_ELBERT template gates are TEMPLATE-ONLY; live goal gate cap is a silent no-op until coach acts

**What:** Adding `gating: true` to `MT_ELBERT_DEFAULT_TARGETS` (Section 4c) affects NEW goals created after deploy. The user's live Mt. Elbert goal has targets stored as DB JSON without `gating` — they parsed back as `gating: undefined`. After deploy, `b.target.gating === true` is false for all live targets. Result: score drops immediately (untested=0 in denominator — correct), but the gate ceiling (80) silently does NOT apply to the live goal.

**Why it matters:** The user will see a score drop and think the feature is working. The gate cap — the most visible and important new behavior — is invisible until the coach explicitly calls `update_goal_targets` with `gating: true` on the two hike targets. This is mentioned as out-of-scope in the PRD (Section 3.3), but is NOT called out in the blueprint as a "do this immediately after deploy" step. The dev agent may complete the build, see the score drop, and declare success — never realizing the cap isn't firing.

**Fix:** The blueprint's implementation plan (Section 9) should add an explicit post-deploy step:
> "After deploying, call `update_goal_targets` on the live Mt. Elbert goal to add `gating: true` to `hike:prep_completion` and `hike:max_elevation_single`. Until this is done, the ceiling will not apply to the live goal."

Also: the MCP smoke test in Section 5 (and PRD Section 10.2) should explicitly test the live goal's `openGateCount` AFTER manually patching the live targets — not just the default-targets template. Otherwise the smoke passes on a constructed example while the production goal remains silently uncapped.

**Severity: High.** Not a code bug — a process gap that makes the most user-visible part of the feature dead on arrival after deploy until a manual follow-up.

---

### HIGH-2 — PRD Acceptance Criterion #12 is weight-dependent; the naive test fails with Elbert's actual weights

**What:** PRD AC #12: "A constructed goal with 1 untested gate + strong other targets yields `score === 80` (cap bites); clearing the gate lifts it."

The cap bites only when `rawScore >= ceiling (80)`. With the Mt. Elbert gate weights (`hike:prep_completion` = 0.30, `hike:max_elevation_single` = 0.20), if the test uses a single gate at weight 0.3 with all other targets (0.7 total weight) at 100%:

```
rawScore = Math.round(0.7 / 1.0 * 100) = 70
ceiling  = 80  (gate is open)
score    = Math.min(70, 80) = 70  ← CAP DOES NOT BITE
```

A dev agent who constructs the test using Elbert-like weights will get `score === 70`, not 80, and will incorrectly conclude the implementation is wrong — or worse, will adjust the code to force 80 and introduce a real bug.

**Fix:** The criterion must specify a weight that causes rawScore ≥ 80. The safest test vector:

```
gate:      weight = 0.01, untested (progress null)
non-gates: weight = 0.99, all at 100% progress
rawScore = Math.round(0.99 / 1.0 * 100) = 99
score    = Math.min(99, 80) = 80  ← CAP BITES
```

Or equivalently, gate weight = 0.2, non-gate weight = 0.8, all non-gates at 100%: rawScore = 80, score = min(80, 80) = 80. The criterion should be rewritten as: "A goal with 1 untested gate (weight ≤ 0.2) and non-gate targets at weight ≥ 0.8 all at 100% progress yields score === 80."

Add a second test: gate weight 0.3 (Elbert-like), non-gates at 100%, score = 70 (cap not binding but correctly < 80 via the denominator penalty). Both are correct behaviors.

**Severity: High.** A misleading test criterion will cause either a false failure or a false pass during the dev agent's implementation verification.

---

## Suggestions (Medium)

### MED-1 — Early-exit returns must be COMPLETELY replaced; TypeScript enforces this only if new fields are non-optional

The blueprint instructs "replace lines 81-88." The current code at line 82 has `return { score: 0, breakdown, missing }` (old shape) and line 85 has the same. The new `ReadinessSnapshot` type (Section 2 of blueprint) has `rawScore`, `ceiling`, `coverage`, `gates`, `openGateCount` as non-optional fields. This means the old return objects at lines 82 and 85 WILL cause TypeScript errors if the new type is used — they're missing required fields. TypeScript catches the partial replacement. ✓

However, the risk is: if a dev agent adds the new scoring block WITHOUT removing the old `usable` filter + its early exits, TypeScript errors will appear on the old returns (lines 82 and 85), not on a missing removal. The correct signal is "TS error at line 82 means line 82 must be deleted, not patched with new fields." The blueprint is clear on this but the dev agent prompt should reinforce: delete lines 81-88 as a unit, don't patch them.

**Severity: Medium.** TypeScript is the safety net; the risk is that the dev agent patches old returns with new fields instead of removing them, creating a redundant code path.

---

### MED-2 — `progressFor` clamp01 and `>= 1` cleared semantics: edge case at exact 1.0 boundary for decrease metrics

`progressFor` uses `clamp01` which returns exactly `1` when `n >= 1`. For decrease metrics (e.g., `weightLb` target=155, direction=decrease): `progressFor` returns `1` when `current <= target` (line 49 short-circuit). Gate `cleared = progress !== null && progress >= 1` = true.

This is correct. But there's a subtle edge case for decrease metrics where `start === target` (line 53: `if (start === target.target) return 0`). If someone sets a decrease gate where they're already at the target at goal creation, `start = 155, target = 155` → `progressFor` returns 0 (not 1), gate is NOT cleared. This is mathematically correct (no progress to make when start equals target) but counterintuitive: the user is at the target but the gate is open. This is pre-existing behavior, not introduced by this feature, but worth flagging for the gate semantics where "already there" matters.

**Fix:** Document in `GoalTarget` that `gating: true` targets where `start === target` will always show `progress=0` and never clear via that path. Coaches should set targets strictly more demanding than the current baseline. Not a code change — just a JSDoc note.

**Severity: Medium.** Not introduced by this feature; pre-existing edge case in `progressFor`. But elevating it because gate semantics make it more visible.

---

### MED-3 — SlideOne parent needs `overflow: hidden` or `maxWidth` defensively

Section 7b notes SlideOne is "less severe" (full-width centered, no sibling competition). However, the blueprint's SlideOne outer container at line 790 is:

```tsx
<div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 32, flex: 1, justifyContent: "center" }}>
  <ProgressRing ... diameter={tok.bullseyeStoryDiameter} />
  [new column wrapper]
</div>
```

The new inner column wrapper has `alignItems: "center"` but no width constraint. If coverage text at 24px is wider than the story ring diameter (no token-defined constraint here), it could overflow the satori viewport and produce invisible text. Adding `maxWidth: tok.bullseyeStoryDiameter` to the inner column is defensive and costs nothing.

**Severity: Medium.** Less likely to cause visible defects than CRIT-1 but the same root cause.

---

## Suggestions (Low)

### LOW-1 — `if (!openGateCount || openGateCount === 0)` redundant condition

In `fmtCoverageLine`:
```typescript
if (!openGateCount || openGateCount === 0) return base;
```
`openGateCount === 0` is already covered by `!openGateCount` (0 is falsy). Simplify to `if (!openGateCount)`.

**Severity: Low.** Code smell only; functionally correct.

---

### LOW-2 — `update_goal_targets` tool description at line 3151 references field order in the wrong order

The blueprint's new description says `{ metric, label, target, weight, units, direction, rationale?, gating? }`. The actual `GoalTargetSchema` field order is `metric, label, units, direction, target, start?, weight, rationale`. The description has `target` and `weight` before `units` and `direction` — inconsistent with schema order. This only affects what the coach reads in tool descriptions, not behavior, but schema-accurate descriptions reduce coaching errors.

**Severity: Low.** Cosmetic; correct it in the description string.

---

### LOW-3 — `recap.ts` `topMetricLabel` logic and `all-missing` detection remain correct but changed semantics deserve a comment

After the change:
- `usableBreakdown = snapshot.breakdown.filter(b => b.progress !== null)` — still correct for "which targets have data" (same condition)
- `snapshot.missing.length === targets.length ? null : snapshot.score` — still correct for "no data at all → show —"

But now `snapshot.score` in the `has-data` branch can be 0 (when tested targets all have 0 progress) OR capped at 80. Previously `score=0` only occurred in the all-missing path. Now `score=0` is a valid "has-data" result. The recap card will render "0%" in the ring for a goal where targets have been logged but show 0 progress. This is correct and honest but different from the prior visual. A JSDoc comment at the `progressPct` assignment noting "now includes gate cap and zero progress" would aid future maintainers.

**Severity: Low.** Correct behavior; documentation gap only.

---

## Missing Requirements / Gaps vs. PRD AC

| PRD AC | Status | Gap |
|--------|--------|-----|
| AC-1 tsc/lint/build clean | Not verifiable pre-code; blueprint is TS-correct | None |
| AC-2 gating mirrored in type + zod | ✓ Blueprint Section 4a/4b exact | None |
| AC-3 untested = 0 in denominator | ✓ Blueprint Section 3 formula | None |
| AC-4 score = min(rawScore, ceiling) | ✓ | None |
| AC-5 additive snapshot | ✓ | None |
| AC-6 MCP compute_readiness returns new fields | ✓ via ...snap spread | None |
| AC-7 create_goal/update_goal_targets round-trip | ✓ via GoalTargetSchema | Smoke test must target LIVE goal after patching — see HIGH-1 |
| AC-8 MT_ELBERT gates flagged | ✓ template | TEMPLATE-ONLY — see HIGH-1 |
| AC-9 recap card renders line; no layout break | Layout risk — see CRIT-1 | Add `width: tok.bullseyeHeroDiameter` |
| AC-10 progress page at 390px | ✓ blueprint Section 8 | None |
| AC-11 rarity consistent | ✓ comment-only change | None |
| AC-12 constructed test: score===80 | Weight-specific — see HIGH-2 | Must specify test weights |

---

## Risk Table

| Risk | Severity | Likelihood | Mitigation |
|------|----------|-----------|------------|
| Ring column grows wider than ProgressRing, compresses objective text | Critical | High (any goal with ≥ 10 targets) | Add `width: tok.bullseyeHeroDiameter` to column |
| `fmtCoverageLine` called twice; `!` assertion | Critical | Certain | Extract to `const coverageLine` |
| Live goal gate cap silently not firing post-deploy | High | Certain | Add post-deploy step: patch live targets via update_goal_targets |
| AC-12 test fails with Elbert-like weights | High | High | Rewrite test vector (gate weight ≤ 0.2) |
| Old early-exits partially left in; TS catches via missing fields | Medium | Low (TS enforces) | Delete lines 81-88 as a unit |
| Coverage line wider than story ring on SlideOne | Medium | Medium | Add `maxWidth: tok.bullseyeStoryDiameter` |
| "start === target" gate never clears for decrease metrics | Medium | Low | JSDoc note; not a code fix |
| PRD AC #12 "score=80" misleads dev agent into wrong weight assumption | High | High | Fix AC text in PRD |

---

## Verdict: NEEDS REVISION

The implementation plan is structurally sound and the math is correct. Two issues require changes to the blueprint before coding begins:

**CRIT-1** (layout breakage on the generated card) and **CRIT-2** (double-call + `!` assertion) are trivial to fix in the blueprint but would require a second pass if left to the dev agent to discover. HIGH-1 (live goal gate cap won't fire) and HIGH-2 (misleading AC #12 test weights) are process/documentation gaps that will produce confusion at smoke-test time if not addressed upfront.

---

## Must-Fix-Before-Coding (10-line summary)

1. **Add `width: tok.bullseyeHeroDiameter` to the ring-column outer div** in `RecapCard` (recap-card.tsx line 373) — `flexShrink: 0` does not prevent growth; coverage text wider than 300px will expand the column and compress the objective text on the generated card.
2. **Extract `fmtCoverageLine(...)` to a `const` before the JSX** in both RecapCard and SlideOne — eliminates the double-call and the `!` non-null assertion inside the conditional.
3. **Add a post-deploy action to the implementation plan**: after deploy, the coach must call `update_goal_targets` on the live Mt. Elbert goal to add `gating: true` to `hike:prep_completion` and `hike:max_elevation_single` — the template change is inert for existing stored goals.
4. **Fix PRD AC #12 test vector** — "1 untested gate (weight 0.2) + non-gates (weight 0.8) all at 100% → score === 80" is the minimal deterministic formulation; Elbert-like gate weight 0.3 yields rawScore 70 and the cap does NOT bite.
5. **Delete lines 81–88 as a unit** (usable filter + both early exits) — do not patch the old returns with new fields; TS errors on the old returns are the signal to delete, not fix-in-place.
6. Consider adding `maxWidth: tok.bullseyeStoryDiameter` to the inner column wrapper on SlideOne as a defensive satori guard against wide coverage text overflowing the viewport.
7. Coverage line `if (!openGateCount || openGateCount === 0)` is redundant; simplify to `if (!openGateCount)`.
8. Update `update_goal_targets` description field order to match the actual zod schema order (`metric, label, units, direction, target, start?, weight, rationale?, gating?`).
9. Add a JSDoc note at `RecapGoalBlock.progressPct` that the value now reflects the gate-capped score — `score=0` is now a valid "has-data" result, not only an all-missing indicator.
10. The smoke test at PRD §10.2 should verify `openGateCount` on the LIVE goal (after `update_goal_targets` patches it), not only on a freshly constructed test goal — otherwise the most important user-visible behavior goes untested in the smoke pass.
