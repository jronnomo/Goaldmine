# Research Output: FeasibilityReadout on Today Page (Story #78)

## 1. `computeGoalFeasibility` — Exact Signature and Behavior

**File:** `src/lib/rarity.ts` lines 179–293

```ts
// GoalLike (line 179-184)
export type GoalLike = {
  id: string;
  targetDate: Date | null;
  targets: unknown;      // Prisma Json field — raw, not pre-parsed
  kind: string;
};

// Signature (line 190-193)
export async function computeGoalFeasibility(
  goal: GoalLike,
  opts?: { now?: Date },
): Promise<GoalFeasibility>
```

- **Async:** yes — multiple DB queries per target (via `observedSeriesFor` + fallback `resolveMetricValue`)
- **Someday fast path:** when `goal.targetDate === null`, returns immediately with zero DB queries (line 198–209)
- **No-targets fast path:** when `parseTargets(goal.targets)` yields empty, returns immediately (line 211–223)
- Same function called by `get_goal` MCP handler (`tools.ts` line 897) and `goals/[id]/page.tsx` line 112

**How `get_goal` invokes it (tools.ts line 897–902):**
```ts
const computed = await computeGoalFeasibility({
  id: goal.id,
  targetDate: goal.targetDate,
  targets: goal.targets,    // raw Prisma Json — not transformed
  kind: goal.kind,
});
```

---

## 2. `GoalFeasibility` Serialization — No Date Instances

**File:** `src/lib/rarity-core.ts` lines 191–218

```ts
// TargetFeasibility (line 191-207)
export type TargetFeasibility = {
  metric: string;
  label: string;
  weight: number;
  requiredRate: number | null;
  observedRate: number | null;
  plausibleRate: number | null;
  rateBasis: "observed" | "norm" | "none";
  ratio: number | null;
  verdict: TargetVerdict;            // "met" | RarityTier | "unknown"
  countsTowardTier: boolean;
  currentValue: number | null;
};

// GoalFeasibility (line 209-218)
export type GoalFeasibility = {
  goalId: string;
  tier: RarityTier | null;
  unratedReason: "someday" | "no-targets" | "no-data" | null;
  ratio: number | null;
  perTarget: TargetFeasibility[];
  basis: "observed" | "norms" | "mixed" | null;
  weeksRemaining: number | null;    // number, not Date
  computedAt: string;               // ISO timestamp string (line 195: now.toISOString())
};
```

**Fully serializable.** `computedAt` is built with `now.toISOString()` (rarity.ts line 195) — it is an ISO string from construction, not a Date object. `TargetFeasibility` contains no Date fields at all — only numbers, strings, and booleans. The `perTarget` array is assembled from pure math in `computeTargetFeasibility` (rarity-core.ts) with no Date instances. No Date leak anywhere in the returned tree.

---

## 3. `FeasibilityReadout` Prop Signature

**File:** `src/components/FeasibilityReadout.tsx` lines 95–101

```tsx
export function FeasibilityReadout({
  feasibility,
  targetDateLabel,
}: {
  feasibility: GoalFeasibility;
  targetDateLabel?: string | null;
})
```

- **Server component:** confirmed — no `"use client"` directive (file header line 2: "Pure server component — synchronous, prop-driven, no hooks")
- `targetDateLabel` is optional; when omitted or `null`, the per-target rate lines show without "by [date]" suffix
- The component renders inside a `<Card title="Reach">` — already handles all 4 states: SOMEDAY / NO_TARGETS / NO_DATA / TIER_SET

---

## 4. `src/app/page.tsx` — Fitness Path Analysis

**File:** `src/app/page.tsx`

- **Async server component:** `export default async function HomePage()` at line 22 — no `"use client"`; awaiting `computeGoalFeasibility` is valid
- **focusGoal shape from `getFocusGoal()`** (`src/lib/goal-focus.ts` lines 41–54):
  ```ts
  type FocusGoalRow = {
    id: string;
    objective: string;
    targetDate: Date | null;
    kind: string;
    isFocus: boolean;
    legend: unknown;
  };
  ```
  **`targets` IS NOT in this select.** `getFocusGoal()` does NOT fetch `targets`.

- **Fitness path branching:** the project early-return fires at line 46–48. After that, `focusGoal` may still be null (fitness program exists, no goal). `computeGoalFeasibility` should only be called when `focusGoal !== null`.

- **Fitness hero section** (lines 208–255): a `<section>` with `aria-label="Today's workout"` containing:
  - Eyeline (week/phase line) — lines 213–225
  - Title `<h1>` — lines 227–229
  - Date + summary `<p>` — lines 232–237
  - `<QuestCard>` — lines 240–246
  - Rest-day recovery tip — lines 248–254 (conditional)

**Exact insertion point for fitness path:** Immediately AFTER the closing `</section>` of the hero (line 255) and BEFORE the baselines block (line 258–261). This would place it as the first standalone card beneath the hero, consistent with how it sits "below the fold" on goal detail pages.

**PITFALL — `targets` missing from `focusGoal`:** To call `computeGoalFeasibility`, the page needs `targets`. `focusGoal` from `getFocusGoal()` does NOT include it. Options:
1. Add `targets: true` to the `select` in `getFocusGoal()` and update `FocusGoalRow` type
2. Add a separate `prisma.goal.findUnique({ where: { id: focusGoal.id }, select: { targets: true } })` in the existing Promise.all at lines 61–90

Option 1 (extend FocusGoalRow) is cleaner but touches the shared type. Option 2 adds one DB query in the existing parallel batch.

**PITFALL — focusGoal can be null on fitness path:** After the project early-return guard, `focusGoal` can legitimately be null (user has a fitness program but no focus goal). Guard: `if (focusGoal !== null) { ... }` before calling `computeGoalFeasibility`.

---

## 5. `src/components/ProjectTodayView.tsx` — Full Structure

**File:** `src/components/ProjectTodayView.tsx`

- **Server component:** "no 'use client'" confirmed (file header line 2)
- **Async:** `export async function ProjectTodayView(...)` line 23

**Props type (lines 19–21):**
```ts
type ProjectTodayViewProps = {
  goal: Pick<FocusGoalRow, "id" | "objective" | "targetDate">;
};
```

**PITFALL — `kind` missing from props:** `GoalLike` requires `kind`. The current props pick only `id | objective | targetDate`. To call `computeGoalFeasibility`, `kind` must be added to the Pick or the component must fetch it. Since `page.tsx` passes `focusGoal` (a `FocusGoalRow` which has `kind`), adding `"kind"` to the Pick is sufficient.

**What the component already fetches (Promise.all at lines 31–67):**
- `items` — scheduled items for today
- `mrrEntry` — latest MRR log entry
- `nextMilestone` — next planned milestone after today
- `goalRow` — `prisma.goal.findUnique({ where: { id: goal.id }, select: { targets: true } })` (line 63–66)

So `goalRow.targets` is already in scope — **no additional DB query needed** for targets. Adding `computeGoalFeasibility` to the existing `Promise.all` would cost only the parallel query fan-out (no serial waterfall).

**JSX layout (lines 111–263):**
```
<div data-testid="project-today-view">
  <section>  Hero / checklist (lines 116–202) </section>
  {mrrTarget != null && (
    <div data-testid="mrr-progress-card">  MRR card (lines 206–238) </div>
  )}
  ← INSERT <FeasibilityReadout> HERE (between MRR and next-milestone) →
  {nextMilestone != null && (
    <div data-testid="next-milestone-card">  Next milestone card (lines 242–261) </div>
  )}
</div>
```

**Exact insertion point:** Between the closing `)}` of the MRR card block (after line 238) and the opening `{nextMilestone != null && (` of the next-milestone card (line 242). This is an unconditional render slot — `FeasibilityReadout` handles all states internally (someday/no-targets/no-data/tier-set), so no conditional guard needed at the call site.

---

## 6. `targetDateLabel` Formatting

**Pattern confirmed in two places:**

`src/lib/recap.ts` lines 449–453:
```ts
targetDateLabel = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: process.env.USER_TZ ?? "America/Denver",
}).format(goal.targetDate);
```

`src/components/MilestoneBurnDown.tsx` line 7 + line 45:
```ts
import { startOfDay, USER_TZ } from "@/lib/calendar";
// ...
new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: USER_TZ }).format(...)
```

**ProjectTodayView already imports `USER_TZ`** (line 11): `import { startOfDay, endOfDay, dateKey, addDays, USER_TZ } from "@/lib/calendar"` — no new import needed.

**For page.tsx:** `USER_TZ` is re-exported from `@/lib/calendar` (calendar.ts line 33 re-exports from calendar-core.ts). page.tsx already imports from `@/lib/calendar` (line 8) but not USER_TZ specifically — add `USER_TZ` to that import.

**When `targetDate === null` (someday):** pass `null` as `targetDateLabel`. `FeasibilityReadout` will return the SOMEDAY state before using the label anyway, but the null is clean API hygiene.

**Year omission:** use only `month: "short", day: "numeric"` (no `year`) to match the terse "Sep 30" format. MilestoneBurnDown includes `year: "numeric"` — that is specific to that card's "Sep 30, 2026" format. FeasibilityReadout's rate lines use a short "by Sep 30" suffix where year is redundant.

**Formatting must happen in the server component caller** (page.tsx or ProjectTodayView), NOT inside FeasibilityReadout. `process.env.USER_TZ` is undefined in the browser; FeasibilityReadout is server-only but stays pure (no env reads per its header comment). Callers own the formatting.

---

## 7. Cost and Caching

- **`computeGoalFeasibility` is NOT wrapped in `cache()`** — no `react.cache` or `unstable_cache` anywhere in `src/lib/rarity.ts`
- **Query budget per call:**
  - Someday goal: 0 queries
  - No-targets goal: 0 queries
  - Dated goal with targets: 1–2 queries per target (series fetch + optional `resolveMetricValue` fallback). For a typical goal with 3–5 targets: ~3–10 queries total.
- **get_goal is a good model** — it calls it once with no cache, inline in the handler
- **ProjectTodayView:** add `computeGoalFeasibility(...)` to the existing `Promise.all` so it runs in parallel with the other 4 queries (no serial waterfall)
- **page.tsx:** add to the existing `Promise.all` at lines 61–90 (8 parallel queries currently; one more is fine)
- **No reason to add `cache()`** for a single call per render on a `force-dynamic` page

---

## 8. Serialization Boundary — No Client Leak Risk

**FeasibilityReadout is a server component** — rendering it stays fully server-side; the computed `GoalFeasibility` value never crosses the RSC→client boundary.

**page.tsx client children (fitness path):**
- `TodayCelebration` — `"use client"` (line 1 of TodayCelebration.tsx) — receives `completed`, `dateKey`, `storageKey`, `progress`, `ariaLabel` (all primitives). Never touches feasibility.
- `QuestCard` — server component (no "use client")
- `CharacterHeader` — server component (no "use client")
- `OtherGoalsStrip` — server component (no "use client")
- `NutritionToday` — receives `logs`, `plan`, `showLogForm`, `quickPickFoods` (no feasibility)
- `CompletedWorkoutCard` — receives a workout object (no feasibility)

**ProjectTodayView client children:**
- `TodayCelebration` — receives `completed`, `dateKey`, `storageKey`, `progress`, `ariaLabel` (primitives only). No feasibility.

**Verdict:** FeasibilityReadout rendered inside page.tsx or ProjectTodayView is pure server-side HTML. No feasibility data or Date instances touch any client component. No serialization boundary issue.

---

## Pitfall Summary

| # | Location | Pitfall | Fix |
|---|----------|---------|-----|
| P1 | `page.tsx` fitness path | `focusGoal` from `getFocusGoal()` does **not** include `targets` — `GoalLike.targets` is required | Either extend `FocusGoalRow` + `getFocusGoal` select, or add a parallel `prisma.goal.findUnique` for targets in the big Promise.all |
| P2 | `page.tsx` fitness path | `focusGoal` can be null on the fitness path (program set, no focus goal) | Guard with `if (focusGoal !== null)` before calling `computeGoalFeasibility`; only render FeasibilityReadout when `focusGoal !== null` |
| P3 | `ProjectTodayView` | Props Pick does not include `kind` — `GoalLike.kind` is required | Add `"kind"` to the Pick in `ProjectTodayViewProps` |
| P4 | `ProjectTodayView` | `kind` is `"project"` for these goals; no `PROJECT_NORM_PACK` exists | **Not a real issue.** `normPackForGoal` (rarity-core.ts line 131–133) falls back to `FITNESS_NORM_PACK` for unknown kinds. Project targets are typically `log:*` metrics, which have no population norm by design (comment at rarity-core.ts line 121: "log:* intentionally NO norm — observed-only"), so the fallback norm is never used anyway. |
| P5 | Both | `computeGoalFeasibility` has no cache — if called outside the Promise.all waterfall, it adds serial latency | Always add to the parallel Promise.all batch |
