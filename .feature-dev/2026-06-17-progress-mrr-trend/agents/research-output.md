# Research Output — story #74: Progress page Weight-gate + MRR trend

Date: 2026-06-17

---

## 1. `src/app/progress/page.tsx` — full structure

**Server component** — no `"use client"` anywhere in the file. Has `export const dynamic = "force-dynamic"` at line 12.

### Data fetching (lines 15-47)

Two parallel top-level queries at line 15:
```ts
const [measurements, activeGoals] = await Promise.all([
  prisma.measurement.findMany({ orderBy: { date: "asc" }, take: 180 }),
  prisma.goal.findMany({
    where: { active: true },
    orderBy: [{ isFocus: "desc" }, { targetDate: { sort: "asc", nulls: "last" } }],
  }),
]);
```
`activeGoals` comes back ordered so `isFocus=true` is always first.

**Weight serialization (lines 23-25):**
```ts
const weights = measurements
  .filter((m) => m.weightLb !== null)
  .map((m) => ({ date: m.date.toISOString(), weight: m.weightLb! }));
```
`Date` objects are serialized to ISO strings here, before crossing the server→client boundary to `WeightChart`. CRIT-2 is already respected.

**Weight stats (lines 27-29):**
```ts
const latest = weights.at(-1)?.weight;
const start = weights[0]?.weight;
const delta = latest !== undefined && start !== undefined ? latest - start : null;
```

**Readiness per goal (lines 31-47):** `computeReadiness` + `computeReadinessSeries` called per goal; series serialized to `{ date: string; score: number }` via `.toISOString()`.

### focusProjectGoal (line 51)
```ts
const focusProjectGoal = activeGoals.find((g) => g.isFocus && g.kind === "project") ?? null;
```
Derived from `activeGoals` in-memory — zero extra DB queries.

### Weight card (lines 177-202)
```tsx
<Card title="Weight">
  {weights.length === 0 ? (
    <p>No weight logged yet…</p>
  ) : (
    <>
      <div className="grid grid-cols-3 gap-2 mb-3 text-center">
        <WeightStat label="Current" value={latest !== undefined ? `${latest} lb` : "—"} />
        <WeightStat label="Start"   value={start !== undefined ? `${start} lb` : "—"} />
        <WeightStat label="Δ"       value={delta !== null ? `${delta > 0 ? "+" : ""}${delta.toFixed(1)} lb` : "—"} />
      </div>
      <div aria-label={weightAriaLabel}>
        <WeightChart data={weights} />
      </div>
    </>
  )}
</Card>
```

**Current gate:** The card renders whenever `weights.length > 0` (at least one weight logged). It does NOT check whether any `GoalTarget` with `metric === "weightLb"` exists in the focus goal's targets.

**Task:** Add an additional gate — only render the Weight card when `activeGoals` (or the focus goal specifically) has a target with `metric === "weightLb"` in its `targets` JSON array. The exact AC condition should be clarified by the Architect; the raw check is:
```ts
const hasWeightTarget = activeGoals.some(
  (g) => (g.targets as GoalTarget[] | null)?.some(t => t.metric === "weightLb")
);
```
Or scoped to the focus goal only. See §6 below for the type.

### MilestoneBurnDown gate (lines 173-175)
```tsx
{focusProjectGoal && (
  <MilestoneBurnDown goalId={focusProjectGoal.id} />
)}
```
The component itself additionally self-gates on `milestones.length === 0`.

### Readiness cards (lines 98-169)
Iteration over `readinessByGoal` (one card per active goal). Each card:
- Shows score from `snapshot.score`
- Shows `ReadinessChart` (client, AreaChart) when `series.length > 1`
- Shows `ReadinessBreakdown` (server-renderable — no recharts)
- Shows coverage hint at line 140: `snapshot.coverage.total > 0`

---

## 2. `src/components/MilestoneBurnDown.tsx`

**Server component** — comment at line 2: `// Server component — no "use client".`

**Props:** `{ goalId: string }` only (line 12).

**Self-gate (line 21):**
```ts
if (milestones.length === 0) return null;
```

**Data source:** Queries its own data internally (lines 15-19):
```ts
const milestones = await prisma.scheduledItem.findMany({
  where: { goalId, type: "milestone" },
  orderBy: { date: "asc" },
  select: { id: true, title: true, status: true, date: true },
});
```

**No Recharts.** Renders a plain CSS progress bar (`<div style={{ width: '${pct}%' }}>`) and a 3-stat grid (Total / Done / Remaining), plus a "Next:" milestone line.

**USER_TZ usage (lines 7, 45):**
```ts
import { startOfDay, USER_TZ } from "@/lib/calendar";
// …
new Intl.DateTimeFormat("en-US", { ..., timeZone: USER_TZ }).format(new Date(nextMilestone.date))
```
Date comparisons use `startOfDay()` which is USER_TZ-aware.

**Adding an MRR sparkline "alongside" MilestoneBurnDown:** Since this is a server component, it cannot itself render Recharts. The Architect has two options:
1. Make `MilestoneBurnDown` accept additional pre-fetched `mrrPoints` prop (from the page) and render a new `<MrrSparkline>` client component inside it.
2. Have the page render `MilestoneBurnDown` and then separately render a new `<MrrTrendCard>` server component that queries and passes data to a client chart.

Option 2 keeps `MilestoneBurnDown` untouched (lower risk). Option 1 keeps the project-goal section visually cohesive. The Architect should decide.

---

## 3. `src/components/WeightChart.tsx` — the model for an MRR sparkline

**Client component** — `"use client"` at line 1.

**Props:**
```ts
type Point = { date: string; weight: number };
function WeightChart({ data }: { data: Point[] })
```
`date` is a pre-serialized ISO string — NOT a `Date` object. CRIT-2 compliant.

**Date → label conversion (client-side, lines 17-22):**
```ts
const formatted = data.map((p) => ({
  ...p,
  label: new Date(p.date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  }),
}));
```
Uses browser locale/timezone (not USER_TZ explicitly). This is the established pattern across all three chart components.

**Recharts shape:**
```tsx
<div className="h-48">
  <ResponsiveContainer width="100%" height="100%">
    <LineChart data={formatted} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
      <XAxis dataKey="label" stroke="var(--muted)" fontSize={11} tickLine={false} axisLine={false} />
      <YAxis domain={["dataMin - 2", "dataMax + 2"]} … width={40} />
      <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} … />
      <Line type="monotone" dataKey="weight" stroke="var(--accent)" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
    </LineChart>
  </ResponsiveContainer>
</div>
```

---

## 4. Existing Recharts / chart patterns

Three chart client components exist:

| File | Component | Chart type | Data prop shape | `"use client"` |
|------|-----------|-----------|-----------------|----------------|
| `src/components/WeightChart.tsx` | `WeightChart` | `LineChart` | `{ date: string; weight: number }[]` | yes |
| `src/components/ReadinessChart.tsx` | `ReadinessChart` | `AreaChart` + gradient | `{ date: string; score: number }[]` | yes |
| `src/components/HistoryChart.tsx` | `HistoryChart` | `LineChart` | `HistoryPoint[]` = `{ date: string; value: number; tooltip?: string }` | yes |

**`HistoryChart` is the most reusable** — accepts a generic `units: string` prop and an optional `domain` prop for Y-axis range. The MRR sparkline can either:
- Reuse `HistoryChart` directly (easiest, passes `units="$"`)
- Clone `WeightChart` into a new `MrrSparkline` component with `{ date: string; value: number }[]` props

**Established data contract (CRIT-2):**
- Server fetches `LogEntry` rows → serializes `Date` to ISO string via `.toISOString()`
- Client receives `{ date: string; value: number }[]` — no `Date` objects cross the boundary
- Client calls `new Date(p.date).toLocaleDateString()` for axis labels

No custom axis tick formatters are in use. All three charts use the same `label` computed field pattern.

---

## 5. LogEntry sourcing for MRR

### Schema (`prisma/schema.prisma` lines 230-244)
```prisma
model LogEntry {
  id        String   @id @default(cuid())
  goalId    String
  date      DateTime // USER_TZ midnight
  metric    String   // bare key WITHOUT "log:" prefix — e.g. "mrr", not "log:mrr"
  value     Float?
  text      String?
  payload   Json?
  source    String?
  createdAt DateTime @default(now())

  @@index([goalId, metric, date])
  @@index([goalId, date])
}
```

**Key fact:** The stored `metric` field is the bare key `"mrr"`, NOT `"log:mrr"`. The `log:` prefix is only used in the `GoalTarget.metric` field in the `targets` JSON array (to distinguish LogEntry-backed metrics from others in the registry). When querying `LogEntry` directly, filter on `metric: "mrr"`.

### Existing resolution pattern (goal-targets.ts lines 100-112)
```ts
if (metric.startsWith(LOG_METRIC_PREFIX)) {
  const key = metric.slice(LOG_METRIC_PREFIX.length); // strips "log:", e.g. "mrr"
  const entry = await prisma.logEntry.findFirst({
    where: { goalId, metric: key, date: { lte: cutoff }, value: { not: null } },
    orderBy: { date: "desc" },
  });
  return entry?.value ?? null;
}
```

### Time-series query for sparkline
```ts
const mrrRows = await prisma.logEntry.findMany({
  where: { goalId: focusProjectGoal.id, metric: "mrr", value: { not: null } },
  orderBy: { date: "asc" },
  select: { date: true, value: true },
});
// Serialize for client:
const mrrPoints = mrrRows.map(r => ({
  date: r.date.toISOString(),     // ISO string — never pass Date to client
  value: r.value!,                // Float? confirmed not null by where filter
}));
```

The `@@index([goalId, metric, date])` makes this O(log n) on the small single-user table. No pagination needed.

### How to detect "focus goal has mrr target"
A `log:mrr` target in `goal.targets` array is the prerequisite for logging MRR. Gate the sparkline block on:
```ts
const hasMrrTarget = (focusProjectGoal.targets as GoalTarget[] | null)
  ?.some(t => t.metric === "log:mrr") ?? false;
```
If `hasMrrTarget` and `mrrRows.length > 1`, render the sparkline; otherwise omit.

---

## 6. Weight-target detection

### GoalTarget type (metrics-registry.ts lines 12-31)
```ts
export type GoalTarget = {
  metric: string;       // e.g. "weightLb", "log:mrr", "baseline:Pull-Up Max Reps"
  label: string;
  units: string;
  direction: Direction;
  target: number;
  start?: number;
  weight: number;
  rationale?: string;
  gating?: boolean;
};
```

### Metric key for body weight
`"weightLb"` — defined in `METRICS` array at `metrics-registry.ts` line 77:
```ts
{ id: "weightLb", label: "Body weight", units: "lb", direction: "decrease", ... }
```

The MT_ELBERT_DEFAULT_TARGETS include it at line 276:
```ts
{ metric: "weightLb", label: "Body weight", units: "lb", direction: "decrease", target: 155, weight: 0.05 }
```

### How to detect at page level
`goal.targets` is typed as `Json?` in Prisma (schema line 178). In the progress page, the same cast is already done at line 33:
```ts
const targets = (g.targets as unknown as GoalTarget[] | null) ?? [];
```

For the Weight card gate, after the main data fetches:
```ts
const hasWeightTarget = activeGoals.some(
  (g) => ((g.targets as unknown as GoalTarget[] | null) ?? []).some(t => t.metric === "weightLb")
);
```
Or if scoped to focus goal only:
```ts
const focusFitnessGoal = activeGoals.find(g => g.isFocus && g.kind === "fitness") ?? null;
const hasWeightTarget = ((focusFitnessGoal?.targets as unknown as GoalTarget[] | null) ?? [])
  .some(t => t.metric === "weightLb");
```
The Architect should decide scope (any active goal vs. focus only). The AC says "weight-target presence" without specifying scope.

---

## 7. USER_TZ date helpers (`src/lib/calendar-core.ts`)

**Exported helpers from `@/lib/calendar-core.ts` (pure, no Prisma, client-safe):**

| Export | Signature | Purpose |
|--------|-----------|---------|
| `USER_TZ` | `string` const | `process.env.USER_TZ ?? "America/Denver"` |
| `dateKey(d)` | `(Date) => string` | Returns `"YYYY-MM-DD"` in USER_TZ — use for bucketing days |
| `startOfDay(d)` | `(Date) => Date` | USER_TZ midnight (as UTC instant) |
| `endOfDay(d)` | `(Date) => Date` | USER_TZ 23:59:59.999 (as UTC instant) |
| `addDays(d, n)` | `(Date, number) => Date` | DST-safe day shift |
| `parseDateKey(k)` | `(string) => Date` | `"YYYY-MM-DD"` → USER_TZ midnight |
| `userTzWallClockToUTC(...)` | low-level | used by above helpers |

**No bucketing-by-week helper for chart axis exists.** All three existing charts do their own `new Date(p.date).toLocaleDateString(undefined, { month:"short", day:"numeric" })` client-side.

**For MRR:** Use `dateKey()` server-side if you need to de-duplicate multiple entries on the same day (take latest per day). If not de-duping, just sort by `date asc` and serialize to ISO.

**X-axis USER_TZ pitfall (mild):** `toLocaleDateString(undefined, ...)` uses the *browser's* TZ, not `USER_TZ`. For a single-user app running in the same timezone, this is fine. The pattern is used by all three existing charts. Do NOT use `toLocaleDateString(undefined, { timeZone: USER_TZ })` unless explicitly required — it would be inconsistent with peers and USER_TZ is not available client-side without injecting it as a prop.

---

## 8. Server → client boundary (CRIT-2)

**Rule:** `Date` instances must not be passed as props to client components. Next.js App Router serializes server component return values; `Date` objects do not survive serialization.

**Established pattern — all three chart components:**
1. Server (page): `date: row.date.toISOString()` → prop is `string`
2. Client chart: `new Date(p.date).toLocaleDateString(...)` → display label

**Specific examples:**
- `weights` array at progress/page.tsx line 25: `.map((m) => ({ date: m.date.toISOString(), weight: m.weightLb! }))`
- `series` in readiness at line 44: `.map((p) => ({ date: p.weekEnd.toISOString(), score: p.score }))`

**MRR sparkline must follow the same pattern:**
```ts
// server (page.tsx):
const mrrPoints = mrrRows.map(r => ({ date: r.date.toISOString(), value: r.value! }));

// client (MrrSparkline.tsx or HistoryChart):
const formatted = data.map(p => ({
  ...p,
  label: new Date(p.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
}));
```

**MilestoneBurnDown is a server component** — it can contain async DB calls. If the Architect decides MRR sparkline goes inside a new server component wrapper (not inside MilestoneBurnDown itself), the wrapper fetches LogEntry rows and passes `{ date: string; value: number }[]` to a `"use client"` chart component.

---

## Pitfalls to flag for Developer

1. **LogEntry.metric is the bare key** — query `metric: "mrr"`, never `metric: "log:mrr"`. The `log:` prefix lives only in `GoalTarget.metric` (the targets JSON array).

2. **Float? null** — `LogEntry.value` is `Float?`. Always filter `value: { not: null }` in the where clause and use `value!` or coerce after confirming.

3. **Date never crosses boundary** — serialize every `Date` to `.toISOString()` before passing to any client component. Forgetting this causes a runtime serialization error in Next.js App Router.

4. **HistoryChart is reusable** — the simplest MRR sparkline is `<HistoryChart data={mrrPoints} units="$" />`. It already handles the generic `{ date: string; value: number }[]` shape and accepts an optional `domain` to prevent Y-axis starting at 0.

5. **No toLocaleDateString with USER_TZ on client** — `USER_TZ` is a server env var; it is not automatically available client-side. The existing charts use `toLocaleDateString(undefined, ...)` (browser TZ). Do not change this pattern inconsistently.

6. **MilestoneBurnDown has no chart** — if MRR is to appear in the same card as the burn-down, a `"use client"` child component must be introduced. MilestoneBurnDown itself cannot host Recharts.

7. **Weight card gate scope** — the story says "gate on weight-target presence" but does not specify: any active goal with weightLb target, OR only the focus goal. The current page iterates `activeGoals` for readiness; `focusProjectGoal` is only set when the focus goal is `kind="project"`. The weight card is fitness-domain. Clarify with Architect whether to gate on (a) any active goal having weightLb target, (b) focus fitness goal specifically, or (c) always show if measurements exist regardless (current behavior).
