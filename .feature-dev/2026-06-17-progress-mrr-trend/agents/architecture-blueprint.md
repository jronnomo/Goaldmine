# Architecture Blueprint — story #74: Progress page weight-gate + MRR trend

Date: 2026-06-17  
Author: Architect Agent  
Source files read: `src/app/progress/page.tsx`, `src/components/HistoryChart.tsx`, `src/components/WeightChart.tsx`, `src/components/MilestoneBurnDown.tsx`, `src/lib/goal-targets.ts`, `src/lib/metrics-registry.ts`, `src/lib/goal-presentation.ts`, `.claude/quality-tools.md`, `docs/prds/PRD-progress-mrr-trend.md`, research-output.md.

---

## Decision log

Each decision states: what was chosen, what was rejected, and why.

### D-1 Weight-card gate: focus-goal-only (not any active goal)

**Decided:** Gate on the FOCUS goal's targets only.

**Rejected:** Gating on `activeGoals.some(...)` (any active goal with weightLb target).

**Why:** The AC says "Weight card renders only when the focus goal has a `weightLb` target." The page already orders `activeGoals` with `isFocus: "desc"` first, so `activeGoals[0]` is always the focus goal (or the only goal when nothing is explicitly focused). Gating on any active goal would render the Weight card for a user whose project goal is in focus but a background fitness goal happens to track weight — that's incorrect. Focus-only scope is precise and matches the AC wording.

---

### D-2 `focusGoal` derivation: in-memory from existing `activeGoals` array

**Decided:** Derive `focusGoal` from `activeGoals` in-memory immediately after the existing `focusProjectGoal` derivation (after line 51). Zero extra DB queries.

```ts
// line ~53 (insert after the focusProjectGoal line):
const focusGoal = activeGoals.find((g) => g.isFocus) ?? activeGoals[0] ?? null;
const hasWeightTarget = ((focusGoal?.targets as unknown as GoalTarget[] | null) ?? [])
  .some((t) => t.metric === "weightLb");
```

**Rejected:** A separate `prisma.goal.findFirst` query for the focus goal.

**Why:** `activeGoals` is already fully loaded with `targets` (a `Json?` field on the Goal model). In-memory derivation is free; a second DB query for the same row would add latency and complexity for zero gain.

**Live Elbert goal confirmation:** `MT_ELBERT_DEFAULT_TARGETS` (metrics-registry.ts line 275) includes `{ metric: "weightLb", ... }`. The live Elbert Goal was seeded from these defaults. Therefore `hasWeightTarget = true` for the Elbert focus goal, and the Weight card renders as before — no regression.

---

### D-3 Weight card outer gate: `hasWeightTarget` only (NOT `&& weights.length > 0`)

**Decided:** Wrap the existing `<Card title="Weight">` block in `{hasWeightTarget && (...)}`. Keep the existing `weights.length === 0` inner branch unchanged (it renders "No weight logged yet — tap Log in the nav to record your first weigh-in.").

**Rejected:** Gating the entire Card on `hasWeightTarget && weights.length > 0`.

**Why:** If the focus goal has a `weightLb` target but the user has not yet logged any weight, the existing "No weight logged yet" message is actionable and correct. Hiding the Card entirely in that case removes a useful prompt. The PRD §3.1 phrase "(keep the existing non-empty check)" confirms the inner branch stays; the outer gate adds only the target-presence check.

**Effective outcomes:**
- No `weightLb` target on focus goal → Card hidden (AC §1, §2 satisfied)
- `weightLb` target + 0 measurements → "No weight logged yet" (helpful, unchanged UX)
- `weightLb` target + measurements → chart renders as before

---

### D-4 MRR section gate: `hasMrrTarget` (not all project goals)

**Decided:** Show the MRR section only when `focusProjectGoal !== null` AND the goal's targets contain `{ metric: "log:mrr" }`.

```ts
const hasMrrTarget =
  focusProjectGoal !== null &&
  ((focusProjectGoal.targets as unknown as GoalTarget[] | null) ?? []).some(
    (t) => t.metric === "log:mrr",
  );
```

**Rejected:** Showing the MRR section for ALL project focus goals regardless of target configuration.

**Why:** A project goal that tracks only milestones (no MRR configured) would always show a confusing "No MRR logged yet" placeholder. `hasMrrTarget` gates the section to goals that have opted into MRR tracking. Chewgether has `log:mrr` in its targets → `hasMrrTarget = true` → placeholder renders (Chewgether has 0 MRR rows). A milestone-only project → no MRR section. This is the honest-first invariant: don't surface a metric that isn't configured.

**Key:** The `targets` JSON uses `"log:mrr"` (WITH the `log:` prefix). The `LogEntry.metric` field stores the bare key `"mrr"` (WITHOUT prefix). These are different namespaces. The targets gate checks `t.metric === "log:mrr"`; the DB query filters `metric: "mrr"`. Never mix them.

---

### D-5 MRR Prisma query: conditional, isolated, with non-null filter

**Decided:** Conditional query keyed on `hasMrrTarget`. Uses `select: { date: true, value: true }` + `value: { not: null }` filter. Serializes immediately to `{ date: string; value: number; tooltip: string }[]`.

```ts
const mrrPoints: { date: string; value: number; tooltip: string }[] = hasMrrTarget
  ? await prisma.logEntry
      .findMany({
        where: { goalId: focusProjectGoal!.id, metric: "mrr", value: { not: null } },
        orderBy: { date: "asc" },
        select: { date: true, value: true },
      })
      .then((rows) =>
        rows.map((r) => ({
          date: r.date.toISOString(),         // CRIT-2: no Date crosses server→client
          value: r.value!,                    // safe: value:{ not:null } where clause
          tooltip: `$${r.value!.toFixed(0)}`, // "$1200" not "1200 $" (wrong order)
        })),
      )
  : [];
```

**Rejected options:**
- Fetching all LogEntry rows for the goal and filtering in-memory: more data, slower.
- No pagination: not needed. Single user, MRR logged at most weekly — table is tiny. The `@@index([goalId, metric, date])` makes this O(log n).
- `findMany` without `value: { not: null }` filter: requires `r.value ?? 0` coercion which could silently plot phantom zero points.
- Bare `${value} ${units}` tooltip: renders "1200 $" — currency symbol must prefix the amount. Passing explicit `tooltip` string fixes this without modifying `HistoryChart`.

**TypeScript note:** `r.value!` is safe at runtime (the where clause guarantees non-null), but TypeScript cannot prove it from the Prisma-generated type (`Float?`). Use `r.value!` (non-null assertion) — this is the established pattern in the codebase (see weights serialization at page.tsx line 25).

---

### D-6 `HistoryChart` reuse (NOT a new component)

**Decided:** Reuse existing `HistoryChart` (`src/components/HistoryChart.tsx`) with `units="$"` and the `tooltip` field per point.

**Rejected:** Creating a new `MrrSparkline` component cloned from `WeightChart`.

**Why:**
- `HistoryChart` already accepts `{ date: string; value: number; tooltip?: string }[]` — exactly the shape produced by the MRR serialization.
- It accepts a `units: string` prop — `units="$"` renders correctly in all axis/tooltip code paths when `tooltip` is set per point (the `tooltip` field takes precedence in the formatter).
- The `domain` prop defaults to `["dataMin", "dataMax"]` — appropriate for MRR (absolute values, no padding needed unlike weight which uses `"dataMin - 2"`).
- Creating a new component would duplicate 75 lines of Recharts boilerplate, fragment the chart-component surface, and require future maintenance of two near-identical components.

**One prop gap confirmed and resolved:** The Y-axis shows raw numbers (e.g. `1200`) not formatted currency (`$1,200`). The existing `HistoryChart` has no Y-axis `tickFormatter`. This is acceptable for a sparkline trend card; the tooltip (showing `$1200`) provides the value context. If currency Y-axis formatting is needed later, it's an isolated `HistoryChart` enhancement.

**`HistoryChart` confirmed `"use client"`:** Line 1 of `src/components/HistoryChart.tsx` is `"use client"`. Date-safe: line 24-29 does `new Date(p.date).toLocaleDateString(...)` on the pre-serialized ISO string. ✅

**`HistoryChart` with empty `data=[]`:** Recharts renders an empty chart area — grid lines, axes, no line/dots. This is NOT an acceptable empty state (it looks broken). Decision: branch to a placeholder BEFORE rendering `HistoryChart`. See §JSX-edit-2 below.

---

### D-7 MRR section placement: sibling to `MilestoneBurnDown`, inside its gate

**Decided:** Expand the existing `{focusProjectGoal && (...)}` block to a Fragment containing both `MilestoneBurnDown` and the MRR Card sibling.

**Rejected:** Adding MRR inside `MilestoneBurnDown.tsx` as a new prop/section.

**Why:** `MilestoneBurnDown` is a server component that renders no Recharts. Adding a Recharts chart inside it would require introducing a `"use client"` child component into that file, touching its props, and coupling two unrelated UI concerns. Sibling placement in page.tsx is lower risk, keeps `MilestoneBurnDown` single-responsibility, and matches the PRD default.

---

### D-8 `goal-presentation.ts`: NO change

**Decided:** Leave `src/lib/goal-presentation.ts` unchanged.

**Why:** This file is a pure presentation registry for recap-card stat slots (used by the OG card + weekly recap). It already has `PROJECT_PRESENTATION.statSlots` with an `mrr` slot, but that's for a different render path (the recap card's stat grid). The progress page's MRR trend is a new UI section in `page.tsx`; it reads raw `LogEntry` rows directly, not through the presentation registry. Adding a helper here would violate the file's purity contract (no Prisma) and create misleading coupling.

---

### D-9 `MilestoneBurnDown.tsx`: NO change

**Decided:** Leave `src/components/MilestoneBurnDown.tsx` unchanged.

**Why:** The MRR trend is a sibling `<Card>` in `page.tsx`. The burn-down renders 0/7 and "No MRR logged yet" on Chewgether without any changes to the component. See D-7.

---

## Edit map

### File: `src/app/progress/page.tsx`

**Import addition** — insert after line 6 (`import { WeightChart } from "@/components/WeightChart";`):

```ts
import { HistoryChart } from "@/components/HistoryChart";
```

---

**Data-layer addition** — insert after line 51 (`const focusProjectGoal = ...`). New lines ~52–67:

```ts
// Weight-card gate: only render when the focus goal tracks body weight (D-1, D-2).
const focusGoal = activeGoals.find((g) => g.isFocus) ?? activeGoals[0] ?? null;
const hasWeightTarget = ((focusGoal?.targets as unknown as GoalTarget[] | null) ?? [])
  .some((t) => t.metric === "weightLb");

// MRR trend: only query when the focus project goal has a "log:mrr" target (D-4).
// NOTE: LogEntry.metric stores the bare key "mrr" — never "log:mrr" (D-5).
const hasMrrTarget =
  focusProjectGoal !== null &&
  ((focusProjectGoal.targets as unknown as GoalTarget[] | null) ?? []).some(
    (t) => t.metric === "log:mrr",
  );
const mrrPoints: { date: string; value: number; tooltip: string }[] = hasMrrTarget
  ? await prisma.logEntry
      .findMany({
        where: { goalId: focusProjectGoal!.id, metric: "mrr", value: { not: null } },
        orderBy: { date: "asc" },
        select: { date: true, value: true },
      })
      .then((rows) =>
        rows.map((r) => ({
          date: r.date.toISOString(),
          value: r.value!,
          tooltip: `$${r.value!.toFixed(0)}`,
        })),
      )
  : [];
```

---

**JSX edit 1 — MilestoneBurnDown block** (currently lines 173–175). Replace:

```tsx
{/* REQ-006: milestone burn-down — only when a project goal is in focus.
    MilestoneBurnDown fetches its own data and self-gates when milestoneCount=0. */}
{focusProjectGoal && (
  <MilestoneBurnDown goalId={focusProjectGoal.id} />
)}
```

With:

```tsx
{/* REQ-006: milestone burn-down + MRR trend — only when a project goal is in focus.
    MilestoneBurnDown self-gates when milestoneCount=0.
    MRR trend gates on hasMrrTarget; shows honest placeholder when no rows logged. */}
{focusProjectGoal && (
  <>
    <MilestoneBurnDown goalId={focusProjectGoal.id} />
    {hasMrrTarget && (
      mrrPoints.length > 0 ? (
        <Card title="MRR Trend">
          <HistoryChart data={mrrPoints} units="$" />
        </Card>
      ) : (
        <Card title="MRR Trend">
          <p className="text-sm text-[var(--muted)]">
            No MRR logged yet — log MRR to see your trend.
          </p>
        </Card>
      )
    )}
  </>
)}
```

---

**JSX edit 2 — Weight card gate** (currently lines 177–202). Replace:

```tsx
{/* Weight card */}
<Card title="Weight">
```

With:

```tsx
{/* Weight card — gate on focus goal having a weightLb target (D-3). */}
{hasWeightTarget && <Card title="Weight">
```

And close the new outer gate after the `</Card>` at line 202:

```tsx
  </Card>}
```

Full gated block (replacing lines 177–202):

```tsx
{/* Weight card — gate on focus goal having a weightLb target (D-3). */}
{hasWeightTarget && (
  <Card title="Weight">
    {weights.length === 0 ? (
      <p className="text-sm text-[var(--muted)]">
        No weight logged yet — tap Log in the nav to record your first weigh-in.
      </p>
    ) : (
      <>
        <div className="grid grid-cols-3 gap-2 mb-3 text-center">
          <WeightStat label="Current" value={latest !== undefined ? `${latest} lb` : "—"} />
          <WeightStat label="Start" value={start !== undefined ? `${start} lb` : "—"} />
          <WeightStat
            label="Δ"
            value={
              delta !== null
                ? `${delta > 0 ? "+" : ""}${delta.toFixed(1)} lb`
                : "—"
            }
          />
        </div>
        <div aria-label={weightAriaLabel}>
          <WeightChart data={weights} />
        </div>
      </>
    )}
  </Card>
)}
```

**Everything inside the Card is byte-identical to the original.** Only the outer `{hasWeightTarget && (...)}` wrapper is new.

---

## Server/client boundary confirmation

| Point | Status |
|-------|--------|
| `progress/page.tsx` stays a server component | ✅ No `"use client"` added |
| `mrrPoints[].date` = `.toISOString()` string | ✅ No `Date` instance crosses boundary |
| `mrrPoints[].value` = plain `number` | ✅ |
| `HistoryChart` is `"use client"` | ✅ confirmed line 1 |
| `HistoryChart` does `new Date(p.date).toLocaleDateString(undefined, ...)` client-side | ✅ matches all peer charts |
| No `USER_TZ` used client-side | ✅ server-only env var, not injected as prop |
| No raw `getDate/setHours/getMonth/getFullYear` introduced in page.tsx | ✅ |
| MRR query uses no date helpers (no bucketing needed — raw logged points) | ✅ |

---

## Do-NOT-touch list (fitness-path byte-identical guarantee)

The Developer must not alter any of the following:

| Element | Location | Why |
|---------|----------|-----|
| `prisma.measurement.findMany` + `prisma.goal.findMany` parallel query | page.tsx lines 15–21 | First two queries unchanged; `activeGoals` ordering already correct |
| `weights` array derivation | page.tsx lines 23–25 | Filter + map unchanged |
| `latest`, `start`, `delta` stats | page.tsx lines 27–29 | Unchanged |
| `weightAriaLabel` string | page.tsx lines 53–59 | Unchanged |
| Interior of `<Card title="Weight">` | page.tsx lines 179–201 | Only outer gate wrapper added |
| `WeightChart` component | `src/components/WeightChart.tsx` | No changes |
| `MilestoneBurnDown` component | `src/components/MilestoneBurnDown.tsx` | No changes |
| `HistoryChart` component | `src/components/HistoryChart.tsx` | No changes (reused as-is) |
| `ReadinessChart`, `ReadinessBreakdown` | their files | Out of scope |
| `RecordsSummary` | its file | Out of scope |
| `readinessByGoal` loop | page.tsx lines 98–169 | Out of scope |

---

## Edge-case matrix

| Scenario | `focusGoal` | `hasWeightTarget` | `focusProjectGoal` | `hasMrrTarget` | `mrrPoints` | Rendered |
|----------|------------|-------------------|---------------------|----------------|-------------|----------|
| No active goals | null | false | null | false | [] | Readiness "No active goals" + nothing else |
| Elbert (fitness, has weightLb, has weight data) | Elbert | true | null | false | [] | Readiness + Weight card with chart |
| Elbert (fitness, has weightLb, no weight data yet) | Elbert | true | null | false | [] | Readiness + Weight card "No weight logged yet" |
| Fitness goal WITHOUT weightLb target | fitGoal | false | null | false | [] | Readiness only — no Weight card ✅ AC §2 |
| Chewgether (project, has log:mrr, 0 MRR rows) | Chewgether | false | Chewgether | true | [] | Readiness + MilestoneBurnDown + "No MRR logged yet" placeholder ✅ AC §4 |
| Chewgether with MRR rows | Chewgether | false | Chewgether | true | [points] | Readiness + MilestoneBurnDown + HistoryChart |
| Project goal WITHOUT log:mrr target | projGoal | false | projGoal | false | [] | Readiness + MilestoneBurnDown — no MRR section (not misleading) |
| Project goal WITH weightLb target (hybrid) | projGoal | true | projGoal | true | [points] | Readiness + MilestoneBurnDown + MRR trend + Weight card (all coexist) |

---

## Files changed by this story

| File | Change |
|------|--------|
| `src/app/progress/page.tsx` | Add `HistoryChart` import; add `focusGoal`/`hasWeightTarget`/`hasMrrTarget`/`mrrPoints` derivations; expand MilestoneBurnDown block to include MRR sibling; gate Weight card on `hasWeightTarget` |

## Files confirmed NOT changed

| File | Decision |
|------|----------|
| `src/components/HistoryChart.tsx` | Reused as-is — no changes |
| `src/components/MilestoneBurnDown.tsx` | Sibling layout chosen — no changes (D-9) |
| `src/components/WeightChart.tsx` | No changes |
| `src/lib/goal-presentation.ts` | Presentation registry for recap cards — not relevant to progress-page trend (D-8) |
| `src/lib/goal-targets.ts` | No changes |
| `src/lib/metrics-registry.ts` | No changes |
| `prisma/schema.prisma` | Out of scope |
| Any MCP tool | Out of scope |

---

## QA checklist for Developer

After implementation, verify:

1. `npx tsc --noEmit` — zero type errors (pay attention to `r.value!` on `Float?` and the Fragment wrapper in JSX).
2. `npm run lint` on changed files only.
3. `npm run build` — ensures SSR of the async conditional query does not break.
4. `grep -nE "setHours|getDate\(|getMonth\(|getFullYear" src/app/progress/page.tsx` → must return no new lines.
5. Browser smoke at phone width (≤390px): Elbert focus → weight card + MilestoneBurnDown unchanged; no MRR section visible.
6. Browser smoke with Chewgether as focus goal (or simulate via `goalId` reasoning): MilestoneBurnDown (0/7 milestones) + "No MRR logged yet" placeholder; no Weight card.
7. `HistoryChart` import resolves correctly (path: `@/components/HistoryChart`).
