# Architecture Blueprint — FeasibilityReadout on Today (Story #78)

**Author:** Architect Agent · **Date:** 2026-06-17  
**Input:** PRD + research-output.md + live file reads  
**Output:** Exact edits for `src/app/page.tsx` and `src/components/ProjectTodayView.tsx`. All other files: read-only.

---

## 0. Decision Log (each entry: decision → rejected alternative → why)

| # | Decision | Rejected alternative | Why |
|---|----------|---------------------|-----|
| D-1 | Add the `targets` fetch as a 9th item in the existing big `Promise.all` in `page.tsx` (guarded by `focusGoal ?`) | Extend `getFocusGoal()` select to include `targets` | Adding `targets` to `FocusGoalRow` propagates into every `getFocusGoal()` caller and the `ProjectTodayView` prop — that's a wider blast radius for no benefit. The separate `findUnique` is isolated to this path. |
| D-2 | Call `computeGoalFeasibility` sequentially **after** the big `Promise.all` in `page.tsx` | Include it inside the big `Promise.all` | Impossible: it needs the output of `goalForFeas` (item 9 of that same `Promise.all`). A Promise can't depend on a sibling promise's output inside the same batch. Unavoidable 3-step chain: `getFocusGoal` → big `Promise.all` (including targets fetch) → `computeGoalFeasibility`. |
| D-3 | Call `computeGoalFeasibility` sequentially **after** the existing `Promise.all` in `ProjectTodayView` | Add it to the existing `Promise.all` as a 5th member | Same constraint: it needs `goalRow.targets`, which is the 4th member of that same `Promise.all`. The research output's suggestion to add it "to the Promise.all" is **incorrect** — it must be sequential. |
| D-4 | No try/catch around `computeGoalFeasibility` | Wrap in try/catch and return null on error | `parseTargets()` handles null/malformed targets by returning `[]` → "no-targets" fast path (zero DB queries). A DB error would break the broader page anyway. Masking it with null degrades the signal without adding safety. |
| D-5 | Keep `FocusGoalRow` in `goal-focus.ts` unchanged | Extend it with `targets: unknown` | Adds a heavyweight JSON field to a type shared across calendar.ts, program.ts, and every goal-event path. Not worth it for a single consumption site. |
| D-6 | `{feasibility && <FeasibilityReadout .../>}` in `page.tsx` (conditional) | `<FeasibilityReadout .../>` unconditionally | `feasibility` is `null` when `focusGoal === null` on the fitness path. The conditional prevents rendering a broken component. |
| D-7 | `<FeasibilityReadout .../>` unconditionally in `ProjectTodayView` (no outer guard) | `{feasibility && <FeasibilityReadout .../>}` | `computeGoalFeasibility` always returns a `GoalFeasibility` (never null) — it handles someday/no-targets/no-data internally. No conditional needed; the component always renders a meaningful card. |
| D-8 | `targetDateLabel` formatted with `{month:"short", day:"numeric"}` (no year) | Include `year:"numeric"` | Matches the "Sep 30" terse style used in FeasibilityReadout's "needs ~N/wk by Sep 30" suffix. MilestoneBurnDown's year inclusion is intentional there for a different card. |

---

## 1. `src/app/page.tsx` — Fitness Path

### 1a. New imports (lines 1–19 area)

Three additions:

```ts
// Line 8: extend the @/lib/calendar destructure with USER_TZ
import { addDays, dateKey, startOfDay, endOfDay, resolveDay, deriveDayDisplay, USER_TZ } from "@/lib/calendar";

// After line 18 (after presentationForGoal import), add two new imports:
import { computeGoalFeasibility } from "@/lib/rarity";
import { FeasibilityReadout } from "@/components/FeasibilityReadout";
```

**Why USER_TZ here:** `page.tsx` is a server component and `process.env.USER_TZ` is available. `USER_TZ` is already re-exported from `@/lib/calendar` (calendar.ts line 33) — it's the canonical import path, consistent with `ProjectTodayView` and `MilestoneBurnDown`.

### 1b. 9th item in the big `Promise.all` (after line 89)

The existing destructure at line 61 expands from 8 to 9 items. The 9th entry fetches the GoalLike fields for feasibility. It must be guarded because `focusGoal` can be null on this path (fitness program + no focus goal set):

```ts
// Line 61: expand the destructure
const [
  latestMeasurement, recentWorkouts, resolved, todayNutrition,
  gameState, weekGoalEvents, quickPickFoods, todayCompletedDetails,
  goalForFeas,                           // ← NEW (9th item)
] = await Promise.all([
  // ... existing 8 items unchanged ...

  // 9. GoalLike fields for computeGoalFeasibility — guarded because focusGoal can be null.
  // focusGoal is guaranteed to be of kind !== "project" at this point (the project
  // early-return at line 46 already fired). But focusGoal itself may be null when
  // the user has a program but no focus goal set. resolve null → feasibility = null → no card.
  focusGoal
    ? prisma.goal.findUnique({
        where: { id: focusGoal.id },
        select: { id: true, targetDate: true, targets: true, kind: true },
      })
    : Promise.resolve(null),
]);
```

**Type:** `goalForFeas` will be inferred as `{ id: string; targetDate: Date | null; targets: Prisma.JsonValue; kind: string } | null`.

### 1c. Feasibility computation — after line 90 (after the big `Promise.all`)

Place these two lines immediately after the existing `void latestMeasurement;` suppression at line 93:

```ts
// FeasibilityReadout data — computed from goalForFeas (GoalLike-compatible).
// goalForFeas is null when focusGoal is null → feasibility is null → no card rendered.
// computeGoalFeasibility: someday=0 queries, no-targets=0 queries, dated+targets=1–N queries.
// No cache() wrapper exists on computeGoalFeasibility; one call per render is correct.
const feasibility = goalForFeas ? await computeGoalFeasibility(goalForFeas) : null;
const targetDateLabel =
  goalForFeas?.targetDate != null
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        timeZone: USER_TZ,
      }).format(goalForFeas.targetDate)
    : null;
```

**Why no try/catch:** `computeGoalFeasibility` handles `null`/malformed targets via `parseTargets()` which returns `[]` → "no-targets" fast path. A DB error here would also break `resolveDay`, `computeGameState`, etc., so there is nothing to gain from catching it in isolation.

**Why `goalForFeas.targetDate` instead of `focusGoal.targetDate`:** `focusGoal` could be null (guarded above), and `goalForFeas` already has `targetDate` from the DB select. Consistent with not touching `FocusGoalRow`.

### 1d. JSX insertion point — after hero `</section>` (line 255), before baselines

The hero section closes at **line 255** (`</section>`). The baselines block opens at **line 257** (the comment) / **line 259** (`{showProminentBaseline && (`). Insert between 255 and 257:

```tsx
      </section>

      {/* ── Feasibility (Reach) card — server-rendered from computeGoalFeasibility.
             Null when focusGoal is null (no focus goal set). Fitness hero above is
             byte-identical whether or not focusGoal is null. ── */}
      {feasibility && (
        <FeasibilityReadout
          feasibility={feasibility}
          targetDateLabel={targetDateLabel}
        />
      )}

      {/* ── Baselines due — only when something is still outstanding ... ── */}
      {showProminentBaseline && (
```

**Fitness hero is unchanged:** Lines 208–255 (the `<section aria-label="Today's workout">`) are not touched. The new card is appended as a sibling `div`-level element in the same `space-y-4` column.

### 1e. Guard confirmation

At line 46-48, the project early-return fires when `focusGoal?.kind === "project"`. After that, on the fitness path:
- `program` is guaranteed non-null (truth table in comments at line 50–52).
- `focusGoal` may be `null` (program exists, no focus goal) — guarded by `focusGoal ?` in the Promise.all entry and `{feasibility && ...}` in the JSX.
- When `focusGoal` is non-null, `goalForFeas` is the findUnique result — could theoretically be null if the goal was deleted between the two `Promise.all` calls, but that is an extreme race condition handled by `feasibility = null → no render`.

---

## 2. `src/components/ProjectTodayView.tsx` — Project Path

### 2a. New imports

```ts
// Add after the existing import of FocusGoalRow (line 13):
import { computeGoalFeasibility } from "@/lib/rarity";
import { FeasibilityReadout } from "@/components/FeasibilityReadout";
```

`USER_TZ` is **already imported** at line 11: `import { startOfDay, endOfDay, dateKey, addDays, USER_TZ } from "@/lib/calendar"` — no change needed.

### 2b. `ProjectTodayViewProps` Pick — add `kind` (line 19-21)

```ts
// BEFORE:
type ProjectTodayViewProps = {
  goal: Pick<FocusGoalRow, "id" | "objective" | "targetDate">;
};

// AFTER:
type ProjectTodayViewProps = {
  goal: Pick<FocusGoalRow, "id" | "objective" | "targetDate" | "kind">;
};
```

**`kind` is already on `FocusGoalRow`** (confirmed: `goal-focus.ts` line 16). The call site in `page.tsx` at line 47 passes `focusGoal` which is a full `FocusGoalRow` — the Pick addition is purely additive and the call site satisfies it without change.

### 2c. Feasibility computation — after the existing `Promise.all` (after line 67)

The existing Promise.all closes at line 67. Add immediately after:

```ts
  // Feasibility — sequential after Promise.all because it needs goalRow.targets.
  // goalRow can be null (goal deleted between the prop fetch and this query) →
  // computeGoalFeasibility receives targets: undefined → parseTargets returns [] →
  // unratedReason: "no-targets" — component renders "Add targets to rate Reach."
  const feasibility = await computeGoalFeasibility({
    id: goal.id,
    targetDate: goal.targetDate,
    targets: goalRow?.targets,          // Prisma JsonValue | undefined → parseTargets handles both
    kind: goal.kind,
  });

  const targetDateLabel =
    goal.targetDate != null
      ? new Intl.DateTimeFormat("en-US", {
          month: "short",
          day: "numeric",
          timeZone: USER_TZ,
        }).format(goal.targetDate)
      : null;
```

**Why sequential and not inside the Promise.all:** `goalRow.targets` is the 4th member of the existing Promise.all (line 63–66). Its result is required to build the `GoalLike` argument. A sibling Promise.all member cannot depend on another sibling's resolved value — the computation must be sequential.

**Accepted latency trade-off:** The existing Promise.all runs 4 queries in parallel. computeGoalFeasibility then runs. For the Chewgether project goal today (no extensive log data), it will likely hit the "no-data" sub-path quickly (a few `log:mrr` queries). Acceptable for a server component on a `force-dynamic` page.

### 2d. JSX insertion point — between MRR card and next-milestone card

MRR card block closes at **line 238** (`      )}`). Next-milestone card block opens at **line 242** (`      {nextMilestone != null && (`). Insert between them:

```tsx
      )}

      {/* ── Feasibility (Reach) card — between MRR and next-milestone. ── */}
      {/* Unconditional: FeasibilityReadout handles all 4 states internally
          (someday, no-targets, no-data, tier-set). Always renders a meaningful card. */}
      <FeasibilityReadout
        feasibility={feasibility}
        targetDateLabel={targetDateLabel}
      />

      {/* ── Next milestone card (UXR-s4-13; hidden when none) ── */}
      {nextMilestone != null && (
```

**No outer conditional guard:** `computeGoalFeasibility` always returns a `GoalFeasibility` object (never null, never throws for bad targets). The component's 4 internal states cover every case. If desired for extreme defensiveness, `{feasibility != null && ...}` is valid but redundant since the await never resolves to null.

---

## 3. Caching / Cost

- **`computeGoalFeasibility` is NOT wrapped in React `cache()`** — confirmed by grep: zero `react`, `cache`, or `unstable_cache` imports in `src/lib/rarity.ts`.
- **One call per render is correct:** This matches the pattern used by `get_goal` (tools.ts:897) and `goals/[id]/page.tsx` (line 112). No double-call risk since no other site in Today calls it.
- **Query budget per call:**
  - Someday goal (targetDate=null): 0 queries — immediate return.
  - No-targets goal (empty targets[]): 0 queries — immediate return.
  - Dated goal with N targets: up to 2 queries per target (series fetch + optional `resolveMetricValue` fallback). Typical goal: 3–5 targets → 3–10 DB queries, all within a single `await`.
- **No `cache()` needed:** Both pages are `force-dynamic` (explicit on page.tsx; ProjectTodayView inherits it from page.tsx via the early-return call site). One fresh computation per request is correct behavior for a live readout.

---

## 4. Serialization — No Client Leak

`GoalFeasibility` is **fully serializable** as constructed:
- `computedAt` is `now.toISOString()` — a string from construction, not a Date.
- `TargetFeasibility` contains only `number | string | boolean | null` fields.
- `weeksRemaining` is a `number | null`, not a Date.

`FeasibilityReadout` is a **server component** (no `"use client"` — confirmed). It is never passed as a prop to a client component; it renders to HTML on the server.

Client children in `page.tsx` (`TodayCelebration` inside `QuestCard`) receive only primitives: `completed: boolean`, `dateKey: string`, `storageKey: string`, `progress: number`, `ariaLabel: string`. `feasibility` and `targetDateLabel` are never passed to them.

Client children in `ProjectTodayView` (`TodayCelebration` directly): same — only `completed`, `dateKey`, `storageKey`, `progress`, `ariaLabel`. No feasibility data crosses the RSC→client boundary.

---

## 5. Edge Cases

| Scenario | Behavior |
|----------|----------|
| `focusGoal === null` on fitness path | `goalForFeas` resolves to `null` → `feasibility = null` → `{feasibility && ...}` renders nothing. Hero unchanged. |
| `goalForFeas === null` (goal deleted between fetches) | Same as above. No card. |
| `goal.targetDate === null` (someday) | `computeGoalFeasibility` returns `{unratedReason: "someday"}` in 0 queries. `targetDateLabel = null`. `FeasibilityReadout` renders "No deadline set — Reach unrated." |
| `unratedReason === "no-targets"` | 0 DB queries. FeasibilityReadout renders "Add targets to rate Reach." |
| `unratedReason === "no-data"` (Chewgether today) | FeasibilityReadout renders "Not enough logged data to rate yet…" — the expected Chewgether state per AC-4. |
| `goalRow?.targets === undefined` (goalRow null) | `parseTargets(undefined)` returns `[]` → "no-targets" state. Graceful. |
| Targets parsed as `[]` (malformed JSON) | Same as no-targets. Graceful. |
| DB error in `computeGoalFeasibility` | Propagates — same as any other DB error on the page (no selective masking). |

---

## 6. Do-NOT-Touch List

| File | Status |
|------|--------|
| `src/components/FeasibilityReadout.tsx` | NO EDIT. Props `{feasibility: GoalFeasibility; targetDateLabel?: string | null}` are already correct for this usage. The "touch" in the PRD is precautionary only — open it, read it, close it. |
| `src/lib/rarity-core.ts` | NO EDIT. `GoalFeasibility`, `TargetFeasibility`, `RarityTier` types are consumed but not modified. |
| `src/lib/rarity.ts` | NO EDIT. `computeGoalFeasibility` and `GoalLike` are imported as-is. |
| `src/lib/goal-focus.ts` | NO EDIT. `FocusGoalRow` is NOT extended with `targets`. |
| `src/lib/calendar.ts` | NO EDIT. `USER_TZ` is already exported and re-exported from `calendar-core.ts`; the import in `page.tsx` is an import-list addition only, not a file change. |
| Any other file | NO EDIT. |

---

## 7. QA Gates (from `.claude/quality-tools.md`)

After implementation:

```sh
npx tsc --noEmit
npm run lint
npm run build
```

**Targeted grep checks (per PRD §5):**
```sh
# No new raw date primitives in the edited files:
grep -nE "setHours|getDate\(|getMonth\(|getFullYear" \
  src/app/page.tsx src/components/ProjectTodayView.tsx

# rarity-core.ts untouched:
git diff --stat src/lib/rarity-core.ts
```

**Visual smoke:**
1. Fitness Today (focus=Elbert, dated goal with targets): `<FeasibilityReadout>` card appears after the hero section, before baselines. Rest of page byte-identical.
2. Project Today (focus=Chewgether, via focus flip): `<FeasibilityReadout>` card appears between the MRR progress card and the next-milestone card, reading "Not enough logged data to rate yet…"

---

## 8. Summary of All Concrete Edits

### `src/app/page.tsx`

| Location | Change |
|----------|--------|
| Line 8 — calendar import | Add `USER_TZ` to the destructure |
| After line 18 (after `presentationForGoal` import) | Add `import { computeGoalFeasibility } from "@/lib/rarity"` and `import { FeasibilityReadout } from "@/components/FeasibilityReadout"` |
| Lines 61–90 — big `Promise.all` | Expand destructure to 9 items; add 9th entry: guarded `prisma.goal.findUnique` for `{id, targetDate, targets, kind}` |
| After line 93 (`void latestMeasurement`) | Add `const feasibility = ...` and `const targetDateLabel = ...` |
| After line 255 (`</section>`) | Insert `{feasibility && <FeasibilityReadout feasibility={feasibility} targetDateLabel={targetDateLabel} />}` |

### `src/components/ProjectTodayView.tsx`

| Location | Change |
|----------|--------|
| After line 13 (`import type { FocusGoalRow }`) | Add `import { computeGoalFeasibility } from "@/lib/rarity"` and `import { FeasibilityReadout } from "@/components/FeasibilityReadout"` |
| Line 20 — `ProjectTodayViewProps` Pick | Add `"kind"` to the union |
| After line 67 (end of `Promise.all`) | Add `const feasibility = await computeGoalFeasibility({...})` and `const targetDateLabel = ...` |
| After line 238 (closing `)}` of MRR card) | Insert `<FeasibilityReadout feasibility={feasibility} targetDateLabel={targetDateLabel} />` |

---

## 9. The Single Trickiest Thing

**The `computeGoalFeasibility` call in `ProjectTodayView` MUST come AFTER the `Promise.all`, not inside it.**

The research output incorrectly suggested adding it to the existing `Promise.all`. That is impossible: `computeGoalFeasibility` requires `goalRow.targets`, and `goalRow` is itself one of the `Promise.all`'s output members. A sibling Promise in a batch cannot read another sibling's resolved value. The Developer must write it as a sequential `await` after the `Promise.all` closes. The same constraint applies in `page.tsx` (where `computeGoalFeasibility` must follow the big `Promise.all` that resolves `goalForFeas`). Getting this wrong — attempting to put either call inside the respective `Promise.all` — will cause TypeScript to report an undefined reference and at runtime would pass `undefined` as `targets`, yielding a misleading "no-targets" readout even for goals with valid targets.
