# Architecture Critique — story #74: Progress page weight-gate + MRR trend

Date: 2026-06-17
Author: Devil's Advocate Agent
Blueprint: `.feature-dev/2026-06-17-progress-mrr-trend/agents/architecture-blueprint.md`

---

## Method

Every claim below is verified against the actual source files, not the research summary. File:line citations are the primary evidence.

---

## Section 1 — Critical Issues

**None found.** No claim in the blueprint would cause a build failure, data corruption, or a broken production render that the blueprint itself fails to anticipate.

---

## Section 2 — Concerns (must address before shipping)

### C-1: PRD §3.1 and Blueprint D-3 diverge on the Weight card outer gate — divergence is undisclosed

**Evidence:**

PRD §3.1 (`docs/prds/PRD-progress-mrr-trend.md:24`):
```
Gate the Weight card (page.tsx ~177–202) on `hasWeightTarget && weights.length > 0`
(keep the existing non-empty check).
```

Blueprint D-3 (`architecture-blueprint.md`, D-3 section) decides:
```
Wrap the existing <Card title="Weight"> block in {hasWeightTarget && (...)}.
Keep the existing weights.length === 0 inner branch unchanged.
```

These are different. The PRD author wrote `hasWeightTarget && weights.length > 0` as the outer gate, which would collapse the inner branch into the outer condition and HIDE the Card entirely when there is a target but no data yet. The blueprint keeps the "No weight logged yet" prompt visible under that scenario. The blueprint's choice is more user-friendly, but it silently ignores the PRD's explicit gate expression without flagging the deviation.

**Impact:** If the PRD author's intent was to suppress the card when there are no measurements (to avoid surfacing an empty prompt for non-fitness goals), the blueprint produces the wrong behavior. If the intent was just "show card only when target is present," the blueprint is right.

**Fix:** The Developer must explicitly confirm which behavior the author intends. The safest interpretation: `hasWeightTarget` alone is the outer gate (blueprint), since the "No weight logged yet" message is actionable when a target exists. Document this decision in the commit message. Do NOT silently pick one and move on.

---

### C-2: `tooltip` format lacks thousand-separator — "$12500" not "$12,500"

**Evidence:**

`HistoryChart.tsx:61`:
```ts
formatter={(value, _name, item) => {
  const tooltip = (item.payload as { tooltip?: string } | undefined)?.tooltip;
  return [tooltip ?? `${value} ${units}`, ""];
}}
```

The blueprint's MRR serialization (`architecture-blueprint.md`, D-5):
```ts
tooltip: `$${r.value!.toFixed(0)}`,
```

For MRR of $12,500, this produces `"$12500"` — no thousand separator. The existing Y-axis also shows raw numbers (`1200`, `12500`). A revenue chart displaying `$12500` in the tooltip and `12500` on the axis is a quality gap, not a breaking bug, but it will look amateur.

**Fix:** Use `toLocaleString`:
```ts
tooltip: `$${r.value!.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
```
This produces `"$12,500"`. The Y-axis raw numbers remain acceptable for a compact sparkline (blueprint D-6 correctly acknowledges this tradeoff). The tooltip is user-facing text where commas matter.

---

### C-3: MRR query runs sequentially after readiness — missed parallelization

**Evidence:**

`progress/page.tsx:31-47`:
```ts
const readinessByGoal = await Promise.all(
  activeGoals.map(async (g) => { ... computeReadiness ... })
);
// ...
const focusProjectGoal = activeGoals.find(...) ?? null;  // line 51
```

Blueprint inserts the MRR query after line 51. That means the full execution chain is:
1. `await Promise.all([measurements, activeGoals])` — parallel
2. `await Promise.all(readinessByGoal)` — serial after #1
3. `await prisma.logEntry.findMany(...)` — serial after #2

The MRR query could be parallelized with `readinessByGoal` if `focusProjectGoal` and `hasMrrTarget` were derived before the readiness block (they only need `activeGoals`, which is already available after step 1). That would look like:

```ts
// After the measurements/activeGoals parallel fetch:
const focusProjectGoal = activeGoals.find((g) => g.isFocus && g.kind === "project") ?? null;
const focusGoal = activeGoals.find((g) => g.isFocus) ?? activeGoals[0] ?? null;
const hasMrrTarget = focusProjectGoal !== null && ...;

const [readinessByGoal, mrrPoints] = await Promise.all([
  Promise.all(activeGoals.map(async (g) => { ... })),
  hasMrrTarget
    ? prisma.logEntry.findMany(...).then((rows) => rows.map(...))
    : Promise.resolve([] as { date: string; value: number; tooltip: string }[]),
]);
```

**Impact:** For a single user with tiny LogEntry tables this is negligible. But the blueprint claimed zero extra latency for the weight-gate logic (correctly — it's in-memory) and should have applied the same reasoning here: an async query should be parallelized when structurally possible.

**Fix:** Move `focusProjectGoal`, `focusGoal`, `hasMrrTarget` derivations to before the `readinessByGoal` block. Wrap both in a single `Promise.all`. This is a clean enhancement, not a correctness issue, but the Developer should know it exists.

---

## Section 3 — Confirmations (blueprint claims verified true)

### V-1: `targets` IS fully available on `activeGoals` — no select clause omits it

`progress/page.tsx:17-20`:
```ts
prisma.goal.findMany({
  where: { active: true },
  orderBy: [{ isFocus: "desc" }, { targetDate: { sort: "asc", nulls: "last" } }],
}),
```

No `select:` clause. All columns including `targets` (`Json?`) are fetched. The blueprint's claim at D-2 ("activeGoals is already fully loaded with targets") is correct. `hasWeightTarget` will never silently be `false` due to a missing select.

The existing code at `progress/page.tsx:33` already performs the exact cast the blueprint replicates:
```ts
const targets = (g.targets as unknown as GoalTarget[] | null) ?? [];
```

### V-2: `weightLb` target key is confirmed; Elbert goal carries it → no regression

`metrics-registry.ts:77`:
```ts
{ id: "weightLb", label: "Body weight", ... }
```

`metrics-registry.ts:275-283`:
```ts
{
  metric: "weightLb",
  label: "Body weight",
  units: "lb",
  direction: "decrease",
  target: 155,
  weight: 0.05,
  ...
}
```

`MT_ELBERT_DEFAULT_TARGETS` includes `weightLb`. The live Elbert goal was seeded from this array. Therefore `hasWeightTarget = true` for Elbert → Weight card renders → fitness path is byte-identical. Blueprint D-2 is correct.

### V-3: `log:mrr` / `"mrr"` prefix asymmetry is real; blueprint uses each correctly

`metrics-registry.ts:169`:
```ts
{ id: "log:mrr", label: "Monthly recurring revenue", ... }
```

`goal-targets.ts:100-101`:
```ts
if (metric.startsWith(LOG_METRIC_PREFIX)) {
  const key = metric.slice(LOG_METRIC_PREFIX.length); // strips "log:" → bare "mrr"
  ...
  where: { goalId, metric: key, ...  }  // queries LogEntry on "mrr" not "log:mrr"
}
```

`LOG_METRIC_PREFIX = "log:"` (`metrics-registry.ts:42`).

The asymmetry is real: `GoalTarget.metric = "log:mrr"`, `LogEntry.metric = "mrr"`. Blueprint D-4 uses `t.metric === "log:mrr"` for the target gate and `metric: "mrr"` for the DB query. Both are correct. The blueprint's inline comment "NOTE: LogEntry.metric stores the bare key 'mrr' — never 'log:mrr'" is accurate and important.

### V-4: Empty `HistoryChart data={[]}` renders broken empty axes — placeholder branch is justified

`HistoryChart.tsx:23-30`:
```ts
const formatted = data.map((p) => ({ ...p, label: new Date(p.date).toLocaleDateString(...) }));
```

With `data=[]`, `formatted=[]`. Recharts `LineChart` with empty data renders the full chart container (192px `h-48`) with `CartesianGrid`, `XAxis`, and `YAxis` but no ticks, no line, no dots — just a blank grey grid in a tall box. This IS a broken appearance. The blueprint's two-branch structure (`mrrPoints.length > 0 ? <HistoryChart> : <placeholder>`) is the correct fix.

### V-5: Tooltip fallback bug is real — without `tooltip` field, units="$" renders "1200 $"

`HistoryChart.tsx:59-62`:
```ts
formatter={(value, _name, item) => {
  const tooltip = (item.payload as { tooltip?: string } | undefined)?.tooltip;
  return [tooltip ?? `${value} ${units}`, ""];
}}
```

Fallback is `${value} ${units}`. For `units="$"` and `value=1200`: `"1200 $"`. The blueprint pre-computes `tooltip: \`$${r.value!.toFixed(0)}\`` which takes the `tooltip ??` branch and renders `"$1200"`. Bug is real; fix is correct (subject to C-2's thousand-separator note).

### V-6: `HistoryChart` confirmed `"use client"` — no server/client boundary violation

`HistoryChart.tsx:1`:
```ts
"use client";
```

Confirmed. The `progress/page.tsx` server component may safely import and render it as a child with serializable props.

### V-7: Server/client boundary — no `Date` instance crosses

Blueprint serializes `r.date.toISOString()` before the client boundary. The existing pattern at `progress/page.tsx:25`:
```ts
.map((m) => ({ date: m.date.toISOString(), weight: m.weightLb! }))
```
is mirrored correctly. `HistoryChart.tsx:24-30` expects `date: string` and calls `new Date(p.date).toLocaleDateString(...)` client-side. The shape matches.

### V-8: Weight card interior is byte-identical — only the outer wrapper is new

`progress/page.tsx:178-202` shows the exact code the blueprint reproduces inside `{hasWeightTarget && (...)}`. Blueprint D-3 explicitly lists the `weights.length === 0` branch, the three `WeightStat` stats, the `aria-label`, and `WeightChart` — all unchanged. For Elbert (`hasWeightTarget=true`), this is a no-op wrapper. No markup or spacing shift.

### V-9: `GoalTarget` is already imported — no new import needed beyond `HistoryChart`

`progress/page.tsx:9`:
```ts
import type { GoalTarget } from "@/lib/goal-targets";
```

Already present. The blueprint's "Import addition" section correctly adds only `HistoryChart` and does not re-import `GoalTarget`. Developer should not add a duplicate import.

### V-10: `MilestoneBurnDown` untouched — Fragment sibling is clean; self-gate preserved

`MilestoneBurnDown.tsx:21`:
```ts
if (milestones.length === 0) return null;
```

The component already self-gates. Wrapping it in a Fragment alongside the MRR card is structurally sound. The Fragment does not affect the component's return value. When Chewgether has 7 milestones (per AC §4 "0/7"), `MilestoneBurnDown` renders the burn-down card. The MRR card sibling renders "No MRR logged yet" (0 rows). Both coexist correctly. No change to the component is needed or warranted.

### V-11: `goal-presentation.ts` untouched — correctly scoped out

The PRD §3.4 default is "no touch." The blueprint correctly leaves it untouched (D-8). The progress page reads raw `LogEntry` rows; `goal-presentation.ts` is a recap-card registry with no Prisma. Adding a cross-cutting helper there would violate its purity constraint. D-8 is justified.

---

## Section 4 — Edge Cases

The blueprint's edge-case matrix is complete and accurate. Three scenarios worth highlighting for the Developer:

**No active goals at all:** `activeGoals = []`, `focusGoal = null`, `focusProjectGoal = null`, `hasWeightTarget = false`, `hasMrrTarget = false`, `mrrPoints = []`. Page shows only readiness "No active goals" card. Weight card hidden. Correct.

**Fitness goal WITHOUT `weightLb` target (AC §2):** `hasWeightTarget = false`, Weight card hidden. No empty chart visible. Correct.

**Project goal with `log:mrr` target but 0 LogEntry rows (AC §4):** `hasMrrTarget = true`, `mrrPoints = []`, renders `<p>No MRR logged yet…</p>`. Never passes `data=[]` to `HistoryChart`. Correct — only if the Developer correctly branches on `mrrPoints.length > 0` as the blueprint specifies.

**Project goal WITHOUT `log:mrr` target:** `hasMrrTarget = false`, no MRR section at all. Honest: not every project goal tracks MRR.

---

## Section 5 — Suggestions (non-blocking)

**S-1: Thousand-separator in tooltip (covered as C-2 above)**
```ts
tooltip: `$${r.value!.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
```

**S-2: Consider `domain={[0, "dataMax"]}` for MRR Y-axis**
Revenue cannot be negative. The default `["dataMin", "dataMax"]` makes a move from $1,000 to $1,200 look like a dramatic doubling because the Y-axis starts at $1,000. For a revenue trend, starting at 0 is the honest baseline. This is a design call — the blueprint explicitly leaves it at the default with the note that it's "acceptable for a sparkline" — but the Developer should be aware of the tradeoff.

**S-3: Parallelize MRR query with readiness (covered as C-3 above)**
Low priority for single-user app. Flag for a future cleanup if page load times ever matter.

---

## Verdict

**Blueprint is implementable as written.** No claims are factually wrong. The data shapes, key namespaces, component props, and server/client boundary handling are all verified correct against the live code.

**Two concerns require a decision before coding:**
- C-1 (Weight card gate): Developer must confirm which behavior the PRD author intended (`hasWeightTarget` alone vs `hasWeightTarget && weights.length > 0`). The blueprint's choice is defensible; its silence on the deviation is not.
- C-2 (Tooltip format): Fix the thousand separator. One-line change; no reason to ship `"$12500"` in a revenue card.

---

## The Single Most Important Thing the Developer Must Get Right

**Never pass `data={[]}` to `HistoryChart` — the `mrrPoints.length > 0` branch guard is not optional.**

The empty-chart failure mode (blank axes in a 192px box) is the most visible user-facing regression. The blueprint's two-branch JSX (`mrrPoints.length > 0 ? <Card><HistoryChart …/></Card> : <Card><p>No MRR…</p></Card>`) must be implemented exactly as specified. Collapsing this to `<HistoryChart data={mrrPoints} />` without the branch — even briefly, even in a "I'll add the empty state later" draft — will ship a broken UI for the only project goal that currently exists (Chewgether, which has 0 MRR rows).
