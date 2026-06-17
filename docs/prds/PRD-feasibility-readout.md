# PRD — FeasibilityReadout server component (#77)

**Slug:** feasibility-readout · **Issue:** #77 (board #8, Sprint 8, P0, Medium) · **Date:** 2026-06-17
**Depends on:** none (the engine already exists). Research: `.feature-dev/2026-06-17-feasibility-readout/agents/research-output.md`.
**UX-research:** skipped — the design is constrained by the honesty-first invariant + the fixed `GoalFeasibility` data shape; it reuses the established `Card`/`ReadinessBreakdown` dashboard patterns; no new design-system work. Placement/visual tuning happens in #78/#79.

## 1. Goal
A goal-generic **server component** `src/components/FeasibilityReadout.tsx` that renders honest feasibility from a single (already-serialized) `GoalFeasibility` value — no MCP round-trip, no `Date` crossing the boundary, no vertical hardcoding, **no `rarity-core.ts` change**. Placement on Today/goal page is #78/#79; this story builds the component + a fixture-based render proof.

## 2. Data shape (from research — exact)
`GoalFeasibility` (rarity-core.ts:209–218): `{ goalId, tier: RarityTier|null, unratedReason: "someday"|"no-targets"|"no-data"|null, ratio: number|null, perTarget: TargetFeasibility[], basis: "observed"|"norms"|"mixed"|null, weeksRemaining: number|null, computedAt: string }`.
`TargetFeasibility` (rarity-core.ts:191–207): `{ metric, label, weight, requiredRate: number|null, observedRate: number|null, plausibleRate: number|null, rateBasis: "observed"|"norm"|"none", ratio: number|null, verdict: "met"|RarityTier|"unknown", countsTowardTier: boolean, currentValue: number|null }`.
`RarityTier = "common"|"uncommon"|"rare"|"epic"|"legendary"`.
**Not present anywhere:** `units`, numeric `target`, `targetDate`, `direction`.

## 3. Design

### 3.1 Props (the A-vs-C decision)
Because `units`/`target`/`targetDate` are NOT in the feasibility prop and `rarity-core.ts` is off-limits, the component is **rate-only + goal-generic** (research Option C):
```ts
export function FeasibilityReadout({
  feasibility,            // GoalFeasibility — drives everything
  targetDateLabel,        // optional, ALREADY-FORMATTED USER_TZ string (e.g. "Sep 30") from the caller; never a Date
}: {
  feasibility: GoalFeasibility;
  targetDateLabel?: string | null;
})
```
- **No `Date` ever** — `computedAt` is a string, `weeksRemaining` a number, `targetDateLabel` a pre-formatted string (the caller #78/#79 formats it via `@/lib/calendar` USER_TZ). The component constructs no `Date` and calls no `toLocaleString`.
- Rejected: (A) passing `targets: GoalTarget[]` — adds coupling + a second source of truth; the rate-only copy reads honestly without it. (B) enriching `TargetFeasibility` upstream — forbidden (rarity-core.ts).
- Numbers via `fmtComma` from `@/lib/goal-presentation` (goal-generic, no unit symbol). The per-target row shows the goal's OWN `label` (e.g. "MRR" — the user's target label, not a hardcoded vertical string).

### 3.2 The four states (selected purely from `feasibility`)
1. `unratedReason === "someday"` → "No deadline set — feasibility unrated."
2. `unratedReason === "no-targets"` → "Add targets to rate feasibility."
3. `unratedReason === "no-data"` → **two sub-states keyed on whether ANY perTarget has `requiredRate !== null`** (research: at 0 logs `requiredRate===null`; at 1–2 logs it populates):
   - **0-log** (no perTarget has a non-null `requiredRate`) → "Not enough logged data to rate yet — log the metric a few times to compute the pace you need." **Must NOT promise a per-week target** (requiredRate is null — plan-critique C-1).
   - **1–2-log** (≥1 perTarget has `requiredRate !== null`, but observed not yet estimable) → per-target rows show `requiredRate` ("needs ~`<fmtComma(requiredRate)>`/wk" + optional "to reach it by `<targetDateLabel>`" when provided) with `observedRate` rendered as "— not yet estimable".
4. `tier` set (not null) → full readout: the goal tier (mapped to a human label), `weeksRemaining`, `basis`, and per-target rows: `label` · requiredRate vs observedRate (both `/wk`, null→"—") · per-target `verdict` (tier or "met"/"unknown") · `rateBasis`.

### 3.3 Goal-generic + honesty guardrails
- **Zero** hardcoded "fitness"/"Elbert"/"Chewgether"/"MRR"/"$" or any vertical label — all labels come from `feasibility.perTarget[].label`. (grep-clean.)
- Tier → human label via a small LOCAL map (`common→"Common"`, …) or a shared server-safe constant — do NOT import the client `ReachMeter`/`TIER_CONFIG`. (Architect: pick the cleanest server-safe source; the on-screen axis noun may be "Reach".)
- Honest framing: untested/unknown targets shown as such; the 0-log copy never fabricates a rate.

### 3.4 Styling
Match `Card` + `ReadinessBreakdown`: `rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4`, muted text `text-[var(--muted)]`, per-target rows like ReadinessBreakdown. Server component — no `"use client"`, no hooks/state.

## 4. Acceptance criteria
1. `src/components/FeasibilityReadout.tsx` is a server component (no `"use client"`, no hooks/state).
2. Accepts a serialized `GoalFeasibility` (+ optional pre-formatted `targetDateLabel` string); never accepts/constructs a `Date`; no `Date` crosses server→client.
3. Renders the 4 states exactly per §3.2, selected purely from `feasibility`.
4. The no-data state renders the two sub-states keyed on `requiredRate===null`; the 0-log copy makes NO per-week promise.
5. Goal-generic: zero hardcoded vertical labels; all labels derive from `perTarget` (grep-clean for "Elbert"/"Chewgether"/"MRR"/fitness/`$`).
6. Any date label is the pre-formatted `targetDateLabel` (USER_TZ done by the caller); the component uses no raw `new Date()`/`toLocaleString`.
7. **`git diff --stat` shows `src/lib/rarity-core.ts` untouched.**
8. Chewgether: rendered against the live Chewgether `GoalFeasibility` (0 logs → `no-data`, requiredRate null) shows "not enough logged data to rate" honestly; rendered against a ≥3-MRR-log fixture (`tier` set, `rateBasis:"observed"`) shows a real verdict.
9. `npx tsc --noEmit`, lint pass; `npx vitest run` still green.

## 5. Verification
tsc · eslint (new file) · build · vitest. A small fixture-based render proof: construct (a) the live-Chewgether-shaped `GoalFeasibility` (no-data, perTarget verdict "unknown", requiredRate null) and (b) a ≥3-log fixture (tier set, rateBasis observed) and confirm the component renders the honest 0-log copy vs a real verdict respectively — via a Vitest render (or a server-render snippet) that asserts the distinguishing copy. `grep -nE "Elbert|Chewgether|MRR|use client|new Date|toLocaleString|\\$" src/components/FeasibilityReadout.tsx` → clean (no vertical strings, no Date, no hardcoded currency). `git diff --stat src/lib/rarity-core.ts` → empty.
