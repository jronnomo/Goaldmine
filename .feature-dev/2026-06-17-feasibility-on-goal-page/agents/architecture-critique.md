# Architecture Critique — Story #79: FeasibilityReadout on Goal Detail Page

**Role:** Devil's Advocate · **Date:** 2026-06-17 · **Status:** Read-only audit

---

## Verdict (up front)

**The gap-fill design is sound. Ship it.** All eight checks pass. No critical bugs, no double-render, no type mismatch, no TZ bug in the new code. The single most important thing: the existing ternary gate (`feasibility.tier !== null || coachFeasibility !== null`) is already the correct split boundary for the gap-fill — no restructuring needed, no extra compute, no regressions.

---

## 1. Gap-fill Correctness

**PASS.**

Gate at `src/app/goals/[id]/page.tsx:238`:
```tsx
{feasibility.tier !== null || coachFeasibility !== null ? ( <rich Reach card/> ) : null}
```

- **Chewgether** (tier null, no coach): `false || false = false` → else branch → FeasibilityReadout. Correct.
- **Elbert** (tier "epic"): `true || false = true` → rich card. FeasibilityReadout not rendered. Correct.
- **BOTH render**: impossible — strict ternary, JSX returns one branch only.
- **NEITHER renders**: impossible — every goal resolves to one side of the ternary. When `computeGoalFeasibility` returns `unratedReason: "someday"` (targetDate null), `tier === null` and `coachFeasibility === null` → else fires, FeasibilityReadout renders "No deadline set — Reach unrated." A Someday goal showing nothing before #79 will now show honest copy. This is correct by design.

Edge case worth noting but not blocking: a Someday goal with a **coach override** (`tier === null && coachFeasibility !== null`) hits the **rich card** (`false || true = true`), which then renders `<ReachMeter tier={feasibility.tier}...>` with `tier = null`. This is a **pre-existing condition** — the rich card was already gating on this combo before #79 existed. #79 does not touch the rich-card branch and makes this neither better nor worse. Flag for a follow-up `ReachMeter` null-safety audit but do not block #79 on it.

---

## 2. No Double "Reach" Card

**PASS.**

`FeasibilityReadout` (`src/components/FeasibilityReadout.tsx:95–190`) renders its own `<Card title="Reach">` wrapped in `<div data-testid="feasibility-readout">`. It is NOT passed an outer wrapper.

Under the gap-fill, the else branch emits:
```tsx
<FeasibilityReadout feasibility={feasibility} targetDateLabel={targetDateLabel} />
```
No outer `<Card>` is added by page.tsx — the PRD's §3 replacement is bare. So the else branch produces exactly ONE "Reach" card (FeasibilityReadout's internal one).

The rich-card branch emits `<Card title="Reach" data-testid="goal-reach-card">...</Card>` and FeasibilityReadout is absent. Exactly ONE "Reach" card there too.

The ternary structure makes both being active structurally impossible.

---

## 3. `feasibility` Reuse — Serializable, Full Shape, Already Awaited

**PASS.**

`feasibility` is resolved at `page.tsx:110–114`:
```tsx
const [readiness, feasibility, trainedMapDetail] = await Promise.all([
  targets.length > 0 ? computeReadiness(...) : Promise.resolve(null),
  computeGoalFeasibility({ id: goal.id, targetDate: goal.targetDate, targets: goal.targets, kind: goal.kind }),
  lastTrainedForGoals([goal]),
]);
```

It is awaited in the `Promise.all` before the JSX renders. No second `computeGoalFeasibility` call is needed or proposed.

`GoalFeasibility` shape (`src/lib/rarity-core.ts:209–218`):
```ts
export type GoalFeasibility = {
  goalId: string;
  tier: RarityTier | null;
  unratedReason: "someday" | "no-targets" | "no-data" | null;
  ratio: number | null;
  perTarget: TargetFeasibility[];
  basis: "observed" | "norms" | "mixed" | null;
  weeksRemaining: number | null;
  computedAt: string; // ISO timestamp — not a Date
};
```

`computedAt` is `now.toISOString()` (`src/lib/rarity.ts:195`) — a plain string, fully serializable across the React server→client boundary. No raw `Date` objects in the shape. `FeasibilityReadout`'s prop signature (`feasibility: GoalFeasibility`) matches exactly.

`FeasibilityReadout` destructures `{ unratedReason, tier, perTarget, basis, weeksRemaining }` (line 102) — all present in `GoalFeasibility`. No missing fields.

---

## 4. No-Data Sub-States on Chewgether

**PASS.**

Chewgether has `targetDate` set and has targets → skips the `someday` and `no-targets` early-returns in `computeGoalFeasibility` (`src/lib/rarity.ts:198–223`).

At 0 logs, for `log:` metrics (`src/lib/rarity.ts:125–137`): `prisma.logEntry.findMany` returns 0 rows → `points = []`, `current = null`. `resolveMetricValue` fallback typically returns null for log: with no entries. If `target.start` is undefined/null, `current` stays null.

In `computeTargetFeasibility` (`src/lib/rarity-core.ts:409–423`): `current === null && start undefined/null` → early-return with `verdict: "unknown"`, `countsTowardTier: false`, `requiredRate: null`.

In `aggregateGoalTier` (`rarity-core.ts:542–544`): `eligible = []` → `{ tier: null, ratio: null, basis: null }`.

Back in `computeGoalFeasibility` (`rarity.ts:279–286`):
```ts
const unratedReason = tier === null && perTarget.every((t) => !t.countsTowardTier) ? "no-data" : null;
return { tier: null, unratedReason: "no-data", ... }
```

`FeasibilityReadout` with `unratedReason === "no-data"`:
- `anyRequired = perTarget.some((t) => t.requiredRate !== null)` → `false` (all requiredRate null at 0 logs with no t.start)
- → State 3a: "Not enough logged data to rate yet — log the metric a few times to see the pace you need."

If Chewgether's targets carry `t.start` values: `current = t.start` (non-null), `requiredRate` computable, but with 0 observed points and no norm for `log:` metrics → final else-branch in computeTargetFeasibility (`rarity-core.ts:491–507`) → `verdict: "unknown"`, `countsTowardTier: false`, `requiredRate` non-null. In FeasibilityReadout: `anyRequired = true` → State 3b ("Need more data to rate"). Both sub-states are correct; which fires is a runtime detail depending on whether Chewgether's targets have `start` set.

The critical invariant holds: Chewgether's feasibility block now shows honest copy rather than nothing.

---

## 5. Date / USER_TZ

**PASS for new code. Pre-existing bug noted but out of scope.**

New code proposed by PRD §3:
```tsx
const targetDateLabel = goal.targetDate
  ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: USER_TZ }).format(goal.targetDate)
  : null;
```

- `goal.targetDate` is a Prisma-returned JS `Date` — valid as `Intl.DateTimeFormat.format()` input.
- `USER_TZ` is re-exported from `src/lib/calendar.ts:33–35` (from `calendar-core`) — accessible via `import { USER_TZ } from "@/lib/calendar"`.
- The result is a plain string (`string | null`). No `Date` object is passed to `FeasibilityReadout`.
- `FeasibilityReadout`'s prop: `targetDateLabel?: string | null` — type matches.

Pre-existing TZ exposure at `page.tsx:181`:
```tsx
new Date(goal.targetDate).toLocaleDateString()  // UTC on Vercel — TZ-incorrect
```
This is in the stack-warning banner and header date display. **Not introduced or worsened by #79.** Out of scope.

---

## 6. Throw Safety

**ACCEPTABLE — pre-existing, not worsened by #79.**

`computeGoalFeasibility` has no `.catch()` guard in the `Promise.all` at `page.tsx:110`. An unhandled DB error throws the page. This is identical to every other `prisma.*` call on this page — a DB failure 500s the whole request uniformly.

Adding a `catch → null` guard would require restructuring: the rich-card branch then reads `feasibility?.tier` and `feasibility.perTarget` without a null check on `feasibility` itself (lines 245, 268, 279). Restructuring for robustness is correct engineering but out of scope for #79, which is explicitly "no change to rarity-core.ts" (AC #4). Leave it as-is.

---

## 7. AC Literal vs Intent — Gap-Fill Is Faithful

**AC is satisfied. Gap-fill is the correct interpretation.**

AC #1 (verbatim): "renders `<FeasibilityReadout>` for the viewed goal **when the rich Reach card is hidden** (unrated: tier null && no coach override), feasibility resolved server-side via the existing `computeGoalFeasibility(goal)` (no MCP round-trip)."

The parenthetical "(unrated: tier null && no coach override)" unambiguously scopes FeasibilityReadout to the else branch. The AC does NOT say "render FeasibilityReadout unconditionally on all goals." The PRD §2 explicitly rejected that approach ("a rated goal would show TWO feasibility surfaces — redundant/confusing") and the gap-fill correctly implements the intended behavior.

AC #2 confirms both paths explicitly: rated fitness goal → rich card; Chewgether (tier null, no coach) → FeasibilityReadout. This is exactly what the ternary delivers.

---

## 8. Missed Issues

**No blockers found. Two minor items below.**

### 8a. `FeasibilityReadout` State 4 (TIER_SET) is unreachable from this placement

Under the gap-fill, FeasibilityReadout is only invoked when `tier === null && coachFeasibility === null`. The `computeGoalFeasibility` return guarantees: when `tier === null`, `unratedReason` is always one of `"someday" | "no-targets" | "no-data"` (`rarity.ts:279–286`). This means FeasibilityReadout's State 4 (`unratedReason === null`, `tier !== null`) — the tier-set readout — is structurally unreachable from `goals/[id]/page.tsx`. This is **not a bug**: FeasibilityReadout is designed for multiple placements (Today page #78, goal page #79); the goal page simply only exercises States 1–3. No action needed.

### 8b. `data-testid` surface changes for unrated goals

The rich card uses `data-testid="goal-reach-card"` on its outer `<Card>`. FeasibilityReadout uses `data-testid="feasibility-readout"` on its outer `<div>`. For unrated goals, the testid changes from the (previously hidden/absent) `goal-reach-card` to `feasibility-readout`. Since the rich card was already hidden for unrated goals, no existing test targeting `goal-reach-card` should break. But if any E2E test asserts the absence of `goal-reach-card` on unrated goals, it already passes. **No action needed**, but worth confirming during verification pass.

### 8c. JSX/syntax is clean

The ternary change — `: null` → `: (<FeasibilityReadout feasibility={feasibility} targetDateLabel={targetDateLabel} />)` — is valid JSX. No key or wrapping issues. `targetDateLabel` must be declared before the `return` statement (after `coachFeasibility` at line 120); the PRD places it correctly.

---

## Summary

| Check | Result | Notes |
|-------|--------|-------|
| Gap-fill gate correctness | PASS | Ternary correctly partitions rated vs unrated |
| No double Reach card | PASS | FeasibilityReadout owns its Card; no outer wrapper added |
| `feasibility` reuse (awaited, full shape, serializable) | PASS | In Promise.all:110; `computedAt` is string; GoalFeasibility matches FeasibilityReadout props |
| Chewgether no-data sub-state | PASS | 0 logs → State 3a or 3b depending on t.start; both correct |
| Date / USER_TZ correctness (new code only) | PASS | Intl + USER_TZ string-only output; pre-existing toLocaleDateString bug out of scope |
| Throw safety | ACCEPTABLE | Pre-existing unguarded Promise.all; not worsened; restructuring out of scope |
| AC literal vs intent | PASS | Parenthetical explicitly scopes to unrated-only; gap-fill is faithful |
| Missed: imports, syntax, testids, State 4 dead code | NO BLOCKERS | Two minor observations (8a, 8b); no action required |

**Gap-fill is sound. No design changes needed.**
