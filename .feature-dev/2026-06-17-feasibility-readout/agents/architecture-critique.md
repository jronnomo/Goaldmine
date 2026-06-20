# Architecture Critique — FeasibilityReadout (#77)

Date: 2026-06-17
Agent: Devil's Advocate (read-only)
Targets: architecture-blueprint.md + all sources it cites

---

## Verification Matrix

| Claim | Verified? | Finding |
|---|---|---|
| `GoalFeasibility`/`TargetFeasibility`/`RarityTier` exported from rarity-core.ts | ✓ Confirmed | Lines 22, 191, 209 |
| rarity-core.ts is Prisma/calendar-free at module load | ✓ Confirmed | Lines 1–8: only `import type { GoalTarget } from "@/lib/metrics-registry"` |
| Wrong comment at rarity-core.ts:406–408 | ✓ Confirmed | Comment says log:* "always current=0"; goal-targets.ts:100–112 returns `null` |
| `tier !== null ⟺ unratedReason === null` holds | ✓ Confirmed | See §2 below |
| `verdict:"met"` ⟹ `requiredRate === 0` (not null) | ✓ Confirmed | rarity-core.ts:435–447 |
| All-met goal pushes to TIER_SET (never NO_DATA) | ✓ Confirmed | met → countsTowardTier:true, ratio:0 → eligible.length≥1 → tier:"common" |
| anyRequired pivot is correct | ✓ Confirmed | See §4 below |
| `log:*` norm is null | ✓ Confirmed | rarity-core.ts:331–333 |
| tsconfig has `"jsx": "react-jsx"` | ✓ Confirmed | tsconfig.json:14 |
| `fmtComma` is client-safe | ✓ Confirmed | goal-presentation.ts:1–5 (purity contract comment) |
| Card does not accept `data-testid` | ✓ Confirmed | Card.tsx:3–9 |
| No `Date`, no `toLocaleString` in the component | ✓ Confirmed by design — targetDateLabel is pre-formatted string |

---

## CRITICAL Issues — Must Fix Before Merge

### C-1: Permanent "· " separator renders awkward "— · — not yet estimable" for null-requiredRate targets

**Location:** architecture-blueprint.md §3 / component skeleton §6, PerTargetRows inner `<p>` (lines 332–355 of the skeleton)

**The bug:**
```tsx
{t.requiredRate !== null ? (
  <>needs ~{fmtComma(t.requiredRate)}/wk{...}</>
) : (
  "—"
)}
{" · "}   {/* ← ALWAYS rendered, even when requiredRate is null */}
{t.observedRate !== null
  ? `${fmtComma(t.observedRate)}/wk observed`
  : "— not yet estimable"}
```

When `t.requiredRate === null` AND `t.observedRate === null` (the "unknown" verdict target), this renders: **"— · — not yet estimable"** — a double-dash with a separator that implies two values where there are none.

**When does this actually fire?**

1. **TIER_SET state with mixed perTarget (most likely real-world case):** A goal where some targets have enough data (get a tier, `countsTowardTier: true`) and other targets have zero data (`verdict: "unknown"`, `countsTowardTier: false`, `requiredRate: null`). TIER_SET is entered because at least one target is rated. The unknown target rows display the awkward string.

2. **NO_DATA sub-state 3b with a mixed count:** If a goal has two targets and one is at 1–2 logs (`requiredRate` non-null) and the other is at 0 logs (`requiredRate` null), the `anyRequired` pivot fires true (at least one non-null) → state 3b. PerTargetRows receives both targets. The 0-log target displays "— · — not yet estimable".

**Fix:** Conditionally render the separator only when both sides have meaningful content, or rewrite the detail line to avoid the unconditional separator:

```tsx
{t.verdict !== "met" && (
  <p className="text-xs text-[var(--muted)]">
    {t.requiredRate !== null
      ? `needs ~${fmtComma(t.requiredRate)}/wk${targetDateLabel != null ? ` by ${targetDateLabel}` : ""}`
      : null}
    {t.requiredRate !== null && t.observedRate !== null ? " · " : null}
    {t.observedRate !== null
      ? `${fmtComma(t.observedRate)}/wk observed`
      : t.requiredRate !== null
        ? "— not yet estimable"
        : "no rate data"}
    {t.rateBasis !== "none" && (
      <> · {t.rateBasis === "observed" ? "observed pace" : "typical pace"}</>
    )}
  </p>
)}
```

This is a non-trivial rewrite of the detail line. The current blueprint skeleton is wrong for the mixed-target case.

---

## Concerns — Should Address

### W-1: Met-verdict test fixture has incoherent tier state

**Location:** blueprint §7, test `"met verdict: shows 'Target met', skips rate copy"`

```ts
const withMet: GoalFeasibility = {
  ...FIXTURE_RARE_TIER,   // tier: "rare"
  perTarget: [{ ...RARE_TARGET, requiredRate: 0, verdict: "met", ... }],
};
```

`FIXTURE_RARE_TIER` has `tier: "rare"`. But a goal where ALL targets are met would have `aggregateGoalTier` return `tier: "common"` (worst ratio = 0 → ≤ 0.5 → "common"). A `tier: "rare"` + all-met perTarget combination is physically impossible from the real producer (rarity.ts:277 + rarity-core.ts:541–578).

The test passes — the component renders without validation — but the fixture is lying about the system's real behavior. A future reader might incorrectly conclude that "rare + all-met" is a real output shape.

**Fix:** Either use a more realistic fixture (some targets met, at least one not) or set `tier: "common"` in the met fixture to reflect what the engine actually produces.

### W-2: `quality-tools.md` says "No tests configured" — now stale

**Location:** `.claude/quality-tools.md:9,24`

```
"No tests configured — manual smoke + typecheck + lint are the gates."
"Tests do not exist."
```

Vitest IS now configured (`vitest.config.ts` exists, 3 test files live in `src/lib/`). The story's own AC (§10: "npx vitest run → all tests pass") contradicts the stated policy. If the QA Agent reads quality-tools.md before running gates, it may skip vitest entirely.

**Fix:** Update quality-tools.md to add `npx vitest run` as a gate before merging this story. Not a blocker, but causes a silent CI gap.

### W-3: The wrong comment is in a file the story AC declares untouched — do NOT fix it here

**Location:** rarity-core.ts:406–408

The comment says: *"Build-from-zero metrics (hike:*, workout:count, log:*) always have current=0 from resolveMetricValue, so they are never null here."*

This is **factually wrong for `log:*`**: `goal-targets.ts:100–112` returns `entry?.value ?? null` → `null` at 0 entries. The null-current guard at line 409 DOES fire for `log:*` metrics, contrary to what the comment says.

The blueprint correctly identifies this and relies on actual code behavior rather than the comment. However, the AC at blueprint §10 says `git diff --stat src/lib/rarity-core.ts → empty`. The comment should eventually be fixed in a separate cleanup commit.

**In this story:** The developer must NOT touch rarity-core.ts. They should not be misled by the wrong comment. The `anyRequired` pivot depends on real behavior (`log:* at 0 entries → requiredRate:null`), not the comment.

---

## Suggestions — Nice to Have

### S-1: Deduplicate the four `<div data-testid>/<Card>` wrappers

The blueprint has 4 separate `return (<div data-testid="feasibility-readout"><Card title="Reach">...` blocks (one per state). This is verbose and risks the testid drifting in a future copy-paste. A cleaner pattern:

```tsx
return (
  <div data-testid="feasibility-readout">
    <Card title="Reach">
      <FeasibilityContent
        unratedReason={unratedReason}
        tier={tier}
        perTarget={perTarget}
        basis={basis}
        weeksRemaining={weeksRemaining}
        targetDateLabel={targetDateLabel ?? null}
      />
    </Card>
  </div>
);
```

Where `FeasibilityContent` is an internal component that switches on state. Reduces repetition without changing behavior.

### S-2: `basis: null` in TIER_SET state is real — blueprint handles it but doesn't explain it

**Location:** rarity-core.ts:471–484

When a target hits the plateau+no-norm path (regression + no applicable norm → `ratioCap` tier), it returns `{ countsTowardTier: true, rateBasis: "none" }`. If ALL eligible targets take this path, `aggregateGoalTier` gets `hasObserved=false, hasNorm=false → basis: null`. So `GoalFeasibility.basis: null` in TIER_SET is possible. The blueprint's `basis != null ? \` · ${basisLabel(basis)}\` : ""` guard correctly handles it. No fix needed, but good to document.

### S-3: `TargetVerdict` import could use the direct export

The blueprint does:
```ts
type TargetVerdict = TargetFeasibility["verdict"];
```

`TargetVerdict` is directly exported from rarity-core.ts at line 189 (`export type TargetVerdict = "met" | RarityTier | "unknown"`). The derived form is valid but slightly less readable than:
```ts
import type { ..., TargetVerdict } from "@/lib/rarity-core";
```
Either works. Preference only.

### S-4: `fmtVerdict` returns `TIER_LABEL[v]` where `v: RarityTier` — TypeScript narrowing depends on the two prior if-checks

The function:
```ts
function fmtVerdict(v: TargetVerdict): string {
  if (v === "met") return "met";
  if (v === "unknown") return "no data";
  return TIER_LABEL[v]; // TypeScript narrows v to RarityTier here
}
```

This is correct. After eliminating "met" and "unknown", TypeScript narrows `v` to `RarityTier`, which is the key type for `TIER_LABEL: Record<RarityTier, string>`. No index-out-of-bounds risk. ✓

---

## Verified Correct — Blueprint Gets These Right

**State mutual exclusivity (`tier !== null ⟺ unratedReason === null`):** Verified by tracing rarity.ts:279–292. Every code path either returns an early `{ tier: null, unratedReason: "someday"|"no-targets" }` or computes `tier` via `aggregateGoalTier`. When `tier === null` after target computation, `unratedReason` is ALWAYS set to "no-data" (the `?? "no-data"` fallback at line 286 is dead code, but harmless). The case `{ tier: null, unratedReason: null }` cannot arrive from the real producer. If it somehow did (bad fixture), the component falls through to TIER_SET and renders `tier != null ? TIER_LABEL[tier] : "—"` = "—". Sane degradation. ✓

**The met-guard prevents "needs ~0/wk":** `computeTargetFeasibility` sets `requiredRate: 0` for a met target (rarity-core.ts:436). `0 !== null` is true, so `anyRequired` would be true — but met targets also have `countsTowardTier: true` which pushes the GOAL to at least "common" tier. A GOAL with all-met targets enters TIER_SET state, not NO_DATA. In TIER_SET, the row-level `t.verdict === "met"` branch renders "Target met" before the `requiredRate !== null` check, preventing "needs ~0/wk". The guard is doubly redundant (goal-level state prevents the path; row-level branch handles the edge). ✓

**The `anyRequired` pivot:** The only correct discriminant between 0-log and 1–2-log sub-states. Verified against `computeTargetFeasibility` exit paths. At 0 logs: null-current early exit → `requiredRate: null`. At 1–2 logs: `current` non-null, `gap/weeksRemaining` computable → `requiredRate` non-null. For `log:*` specifically, the norm is null (rarity-core.ts:331–333), so 1–2-log targets hit the final else path with `verdict: "unknown"`, `countsTowardTier: false`, `requiredRate` populated. ✓

**Type import purity:** `import type { GoalFeasibility, TargetFeasibility, RarityTier }` — erased at compile time. Even a value import of rarity-core.ts is safe (only `import type { GoalTarget }` at module scope, no Prisma, no calendar). ✓

**Test approach (`.test.ts` + `renderToStaticMarkup`):** `tsconfig.json:14` has `"jsx": "react-jsx"`. Vite's esbuild plugin reads tsconfig and uses the automatic JSX runtime when processing `.tsx` imports. `FeasibilityReadout` is synchronous (no `async`, no hooks). `renderToStaticMarkup` from `react-dom/server` is synchronous for synchronous components in React 19.2. The `include: ["src/**/*.test.ts"]` in vitest.config.ts controls test DISCOVERY only — it does not restrict what file types a test file may import. ✓

**`GoalFeasibility.weeksRemaining` in NO_DATA state is non-null:** `computeGoalFeasibility` only reaches the per-target computation loop if `targetDate !== null` (someday returns early). `weeksRemainingFrac` returns a number (floored at 1). So for all non-someday, non-no-targets states, `weeksRemaining` is a non-null number. The NO_DATA fixture correctly uses `weeksRemaining: 20`. ✓

---

## Verdict

**SHIP WITH C-1 FIXED. The rest are low-risk or cosmetic.**

The blueprint is architecturally sound. The state machine is correct, the invariants hold in the real code, the type imports are safe, and the test approach is valid. The engine edge cases are handled correctly.

**The single most important thing the Developer must get right:**

Fix the `{" · "}` separator in `PerTargetRows`. In the current skeleton, the separator is rendered unconditionally between `requiredRate` and `observedRate` display segments. When `requiredRate` is null for an unknown-verdict target (which appears in TIER_SET mixed-target state AND in NO_DATA-3b mixed-count state), the output is "— · — not yet estimable" — confusing to users and failing the honesty-first invariant. The conditional separator fix is small but non-trivial to get right without introducing new separator-omission bugs for the cases where both values ARE present.
