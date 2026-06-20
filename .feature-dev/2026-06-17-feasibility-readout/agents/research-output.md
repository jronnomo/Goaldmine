# Research Output — FeasibilityReadout (#77)

Date: 2026-06-17  
Agent: Research (read-only)

---

## 1. `GoalFeasibility` exact shape

**Source:** `src/lib/rarity-core.ts:209–218`

```ts
export type GoalFeasibility = {
  goalId: string;
  tier: RarityTier | null;
  unratedReason: "someday" | "no-targets" | "no-data" | null;
  ratio: number | null;
  perTarget: TargetFeasibility[];
  basis: "observed" | "norms" | "mixed" | null;
  weeksRemaining: number | null;
  computedAt: string; // ISO timestamp — always a string, no Date
};
```

**Nullability rules:**
- `tier` is non-null only when at least one target is rated and computable. Null on someday/no-targets/no-data.
- `unratedReason` is non-null when `tier === null`. It is one of `"someday" | "no-targets" | "no-data"`. When `tier` is non-null, `unratedReason` is `null`.
- `ratio` is null when no computable target exists.
- `basis` is null when all targets are unrated/unknown.
- `weeksRemaining` is null for someday goals and no-targets goals; populated (a number) for dated goals that have targets.
- `computedAt` is always present as an ISO string — the caller in `rarity.ts:195` does `now.toISOString()` before the early returns.
- `perTarget` is an empty array for `someday` and `no-targets` states; populated (possibly with unknown-verdict entries) for `no-data` and `tier-set` states.

**Export location:** `src/lib/rarity-core.ts` exports the type directly. `rarity.ts` re-exports it via `import type { GoalFeasibility } from "@/lib/rarity-core"`. The safe import for the component (client-safe, no Prisma) is:
```ts
import type { GoalFeasibility } from "@/lib/rarity-core";
```

---

## 2. `TargetFeasibility` exact shape

**Source:** `src/lib/rarity-core.ts:191–207`

```ts
export type TargetFeasibility = {
  metric: string;
  label: string;
  weight: number;
  requiredRate: number | null;
  observedRate: number | null;
  plausibleRate: number | null;
  rateBasis: "observed" | "norm" | "none";
  ratio: number | null;
  verdict: TargetVerdict;          // "met" | RarityTier | "unknown"
  countsTowardTier: boolean;
  currentValue: number | null;
};
```

**Nullability:**
- `requiredRate`: `null` when `current === null && target.start == null` (the "unknown" early-exit path, rarity-core.ts:409–423) OR when the goal is met (0, not null). Otherwise a computed number.
- `observedRate`: `null` when no series data; can be present even when `requiredRate` is null (the unknown path sets `observedRate: observedWeeklyRate` which could itself be null).
- `plausibleRate`: `null` in the "unknown" exit path, the "no norm + observed ≤ 0" exit path, and the "met" exit path.
- `currentValue`: `null` when `current === null && target.start == null` (unknown path). Otherwise the effectiveCurrent (last series point → resolveMetricValue fallback → target.start).
- `countsTowardTier`: `false` only on `verdict === "unknown"` paths. `true` for met, tier, and the no-norm/no-observed blowup path.

**CRITICAL — what `TargetFeasibility` does NOT carry:**
- **No `units` field.** The source `GoalTarget` carries `units` (e.g. `"$"`, `"lb"`, `"ft"`) but `computeTargetFeasibility` does not copy it into `TargetFeasibility`. The shape at rarity-core.ts:191–207 has `metric`, `label`, `weight`, `requiredRate`, `observedRate`, `plausibleRate`, `rateBasis`, `ratio`, `verdict`, `countsTowardTier`, `currentValue` — no `units`.
- **No `target` (the goal value).** The numeric goal target (e.g. 1000 for MRR $1k) is not in `TargetFeasibility`.
- **No `targetDate`.** The deadline date is on the parent `GoalFeasibility.weeksRemaining` (a number) only. No date string per target.
- **No `direction`.**

**Verdict display mapping** (rarity-core.ts:189):
```ts
export type TargetVerdict = "met" | RarityTier | "unknown";
```
The existing goals/[id]/page.tsx (line 275) renders it as: `"met"` → `"met"`, `"unknown"` → `"no data"`, any RarityTier → display the tier word directly.

---

## 3. RarityTier values and display

**Source:** `src/lib/rarity-core.ts:14–26`

```ts
export const RARITY_TIERS = [
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
] as const;

export type RarityTier = (typeof RARITY_TIERS)[number];
```

Array order is ascending difficulty (index 0 = easiest). `tierIndex()` gives ordinal position.

**Human labels and colors** — the only existing tier→label+color map is in `src/components/ReachMeter.tsx:26–31`:

```ts
const TIER_CONFIG: Record<RarityTier, TierConfig> = {
  common:    { fill: 1, color: "var(--muted)",   label: "Common",    bold: false },
  uncommon:  { fill: 2, color: "var(--muted)",   label: "Uncommon",  bold: false },
  rare:      { fill: 3, color: "var(--accent)",  label: "Rare",      bold: false },
  epic:      { fill: 4, color: "var(--warning)", label: "Epic",      bold: false },
  legendary: { fill: 5, color: "var(--warning)", label: "Legendary", bold: true  },
};
```

No separate tier→copy map exists in rarity-core.ts. The component should either import `ReachMeter` (which wraps tier display) or reference `ReachMeter.tsx`'s pattern for color and label.

**On-screen axis noun:** `"Reach"` per UXR-63-01 (engine/MCP keeps "rarity").

---

## 4. `computeGoalFeasibility` — signature and serialization

**Source:** `src/lib/rarity.ts:190–293`

```ts
export async function computeGoalFeasibility(
  goal: GoalLike,
  opts?: { now?: Date },
): Promise<GoalFeasibility>
```

`GoalLike` (rarity.ts:179–184):
```ts
export type GoalLike = {
  id: string;
  targetDate: Date | null;
  targets: unknown;
  kind: string;
};
```

**Serialization confirmation:**
- `computedAt` = `now.toISOString()` (rarity.ts:195) — always a string in the output.
- `weeksRemaining` = return value of `weeksRemainingFrac()` (rarity.ts:225) — a `number`, floored at `minWeeksRemaining = 1`. No Date object.
- The `GoalFeasibility` type is clean of `Date` — safe to pass as a serialized prop from server component to child.

---

## 4b. The no-data sub-state pivot — 0 logs vs 1–2 logs

**Goal:** confirm the code paths that make `requiredRate === null` the correct pivot for 0 logs on a `log:*` metric.

**`resolveMetricValue` for `log:mrr` with 0 entries** (`src/lib/goal-targets.ts:100–112`):
```ts
if (metric.startsWith(LOG_METRIC_PREFIX)) {
  const entry = await prisma.logEntry.findFirst({
    where: { goalId, metric: key, date: { lte: cutoff }, value: { not: null } },
    orderBy: { date: "desc" },
  });
  return entry?.value ?? null;   // ← returns null at 0 logs
}
```
Unlike `hike:*` / `workout:count` which return `0` (build-from-zero), `log:*` returns **null** when no entries exist. This is intentional and documented in the JSDoc at rarity-core.ts:403–408.

**Path at 0 logs:** `resolveMetricValue` returns `null`. In `computeGoalFeasibility` (rarity.ts:245–248), `current` stays null. Then `computeTargetFeasibility` (rarity-core.ts:409–423) fires the null-current early exit:
```ts
if (current === null && (target.start === undefined || target.start === null)) {
  return { ..., requiredRate: null, verdict: "unknown", countsTowardTier: false, currentValue: null };
}
```
→ `requiredRate === null`, `verdict: "unknown"`, `countsTowardTier: false`.

**Path at 1–2 logs** (`observedPoints < minObservedPoints = 3`):
- `current` is now non-null (the latest log value).
- `gap = target - current` > 0 (assuming not met).
- `requiredRate = gap / weeksRemaining` → non-null.
- `weeklySlope` returns `null` (fewer than 3 points).
- `observedWeeklyRate` = null.
- In `computeTargetFeasibility` (rarity-core.ts:488–506): falls to `else if (norm !== null)` — for `log:*`, `normForFamily` returns `null` (rarity-core.ts:331–333: `case "log": return null`).
- Hits the final `else` path at rarity-core.ts:492–505: `requiredRate` is non-null, but `plausibleRate` is null, `verdict: "unknown"`, `countsTowardTier: false`.

**Summary of the no-data sub-states:**

| Log count | `requiredRate` | `currentValue` | `verdict`   | `countsTowardTier` |
|-----------|----------------|----------------|-------------|--------------------|
| 0         | `null`         | `null`         | `"unknown"` | `false`            |
| 1–2       | non-null       | non-null       | `"unknown"` | `false`            |
| ≥3        | non-null       | non-null       | tier or met | `true`             |

The correct pivot for "truly no data" (sub-state A) is `requiredRate === null`. The 1–2 log sub-state (sub-state B) has `requiredRate` populated and `currentValue` non-null but `plausibleRate === null` and no tier.

---

## 5. Existing dashboard component patterns

### `Card` component API
**Source:** `src/components/Card.tsx:1–27`

```tsx
export function Card({
  title,    // optional string — renders <h2> in <header>
  action,   // optional ReactNode — right side of header
  children,
  className,
}: { title?: string; action?: ReactNode; children: ReactNode; className?: string })
```

Styling: `rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm`.

**Note:** `Card` does not accept `data-testid`. The pattern used by `MilestoneBurnDown` (line 55) is to wrap in a `<div data-testid="...">` and render `<Card>` inside.

### `ReadinessBreakdown` as structural model
**Source:** `src/components/ReadinessBreakdown.tsx`

`ReadinessBreakdown` takes `breakdown: TargetProgress[]` and renders a `<ul className="space-y-3">` with per-target rows. Each row is:
- `<div className="flex justify-between text-sm mb-1 gap-2">` — label + value (muted, tabular-nums)
- A `h-1.5 bg-[var(--border)] rounded-full` progress bar
- A `text-xs text-[var(--muted)] mt-1` detail line (current → target values)
- Optionally a rationale line: `text-xs text-[var(--muted)] italic border-l-2 border-[var(--border)] pl-2`

This is a **good structural model** for the per-target rows in `FeasibilityReadout`. The existing goal detail page at goals/[id]/page.tsx:268–295 already renders a similar per-target list for feasibility — the `FeasibilityReadout` component should extract and formalize that pattern.

### Existing per-target feasibility rendering (inline in goal detail)
`src/app/goals/[id]/page.tsx:268–295` currently renders feasibility per-target inline (not in a separate component):
```tsx
<ul className="space-y-3" data-testid="goal-reach-pertarget">
  {feasibility.perTarget.map((t) => (
    <li key={t.metric}>
      <div className="flex justify-between text-sm mb-0.5 gap-2">
        <span className="font-medium truncate pr-2">{t.label}</span>
        <span className="text-[var(--muted)] shrink-0 text-xs">
          {t.verdict === "met" ? "met" : t.verdict === "unknown" ? "no data" : t.verdict}
        </span>
      </div>
      <p className="text-xs text-[var(--muted)]">
        {t.requiredRate !== null && t.plausibleRate !== null ? (
          <>required {t.requiredRate.toFixed(2)}/wk · plausible {t.plausibleRate.toFixed(2)}/wk
             {t.ratio !== null && ` · ${t.ratio.toFixed(1)}× pace`}</>
        ) : t.verdict === "met" ? ("Target met") : ("No rate data")}
      </p>
    </li>
  ))}
</ul>
```

### Tailwind CSS variables used in existing components
- `text-[var(--muted)]` — muted/secondary text
- `text-[var(--foreground)]` — primary text
- `text-[var(--accent)]` — accent (links, highlights)
- `text-[var(--warning)]` — warning color (epic/legendary tier)
- `bg-[var(--card)]` — card background
- `border-[var(--border)]` — border color
- `bg-[var(--accent)]` — accent fill (progress bar fill)
- `bg-[var(--border)]` — empty progress bar track

### `MilestoneBurnDown` pattern
`MilestoneBurnDown` is an async server component (`src/components/MilestoneBurnDown.tsx`). It imports `Card` and uses `USER_TZ` for date formatting. Returns `null` when no data. Good precedent for the gate pattern: return null or a minimal "no state" card early.

---

## 6. `@/lib/calendar` date formatting — USER_TZ-correct display

**Source:** `src/lib/calendar-core.ts` (re-exported via `@/lib/calendar`)

There is **no dedicated "display date" formatter** in `calendar-core.ts`. The exports are: `dateKey`, `parseDateKey`, `startOfDay`, `endOfDay`, `startOfWeekMonday`, `endOfWeekSunday`, `addDays`, `shiftWallClock`, `toDatetimeLocalValue`, `USER_TZ`.

**Correct pattern for USER_TZ-safe date label** (established in `MilestoneBurnDown.tsx:44–47` and `ProjectTodayView.tsx:101`):

```ts
import { USER_TZ } from "@/lib/calendar";

const dateLabel = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: USER_TZ,
}).format(new Date(isoString));
// → "Sep 30, 2026"
```

For a short "9/30" style: omit `year`, use `month: "numeric"`, `day: "numeric"`:
```ts
new Intl.DateTimeFormat("en-US", {
  month: "numeric", day: "numeric", timeZone: USER_TZ,
}).format(new Date(isoString));
// → "9/30"
```

The `parseDateKey` helper converts a `"yyyy-mm-dd"` string → `Date` at USER_TZ midnight — useful if the component ever receives a `dateKey`-format date string instead of an ISO timestamp.

**Important:** `goal.targetDate.toLocaleDateString()` (used in goals/[id]/page.tsx:181) does NOT pass `timeZone: USER_TZ`. This is a known rough edge — it uses system/server TZ (UTC on Vercel). For dates stored as "midnight in USER_TZ" via `parseDateKey`, this is safe in practice (midnight USER_TZ = prior day UTC midnight, but the date display still rolls over correctly because the UTC hour is typically ≤ 7h behind). However, the AC for FeasibilityReadout forbids this shortcut — use `Intl.DateTimeFormat` with `USER_TZ` as shown in MilestoneBurnDown.

---

## 7. Number formatting — units-aware rate copy

**Source:** `src/lib/goal-presentation.ts:9–11`

```ts
export function fmtComma(n: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}
```

Also available: `fmtVolume` (appends `" lb"`) and `fmtElevation` (appends `" ft"`) — these are hardcoded-unit formatters, not goal-generic.

`fmtComma` is client-safe (no Prisma, no calendar). Import from `@/lib/goal-presentation`.

**For units-generic rate copy:** `TargetFeasibility` does NOT carry `units` (confirmed — see §2). To produce "$66/wk"-style copy, the component would need the `units` string. The only source for `units` is `GoalTarget` (in `metrics-registry.ts:12`), which is NOT in the serialized `GoalFeasibility`. The `GoalTarget.units` field holds strings like `"$"`, `"lb"`, `"ft"`, `"reps"`, `"sec"`, `"hikes"`, `"sessions"`, `"milestones"`.

---

## Key Open Question for the Architect

**Can the component render "needs ~$66/wk to hit $1,000 by 9/30" from `GoalFeasibility` alone?**

**No — not from `GoalFeasibility` as it currently stands.** Specifically:

| Needed for the AC copy | Available in `GoalFeasibility`/`TargetFeasibility` | Missing |
|---|---|---|
| Required rate value (`~66`) | `TargetFeasibility.requiredRate` ✓ | — |
| Units prefix/suffix (`$`) | **NOT in `TargetFeasibility`** | `GoalTarget.units` |
| Goal target value (`1,000`) | **NOT in `TargetFeasibility`** | `GoalTarget.target` |
| Deadline date (`9/30`) | **NOT in `TargetFeasibility`** — only `GoalFeasibility.weeksRemaining` (number) | Exact date from `goal.targetDate` |

**Three options for the Architect:**

**Option A — Take extra props.** Pass `targets: GoalTarget[]` (from `@/lib/metrics-registry`) alongside `feasibility: GoalFeasibility`. The component zips `perTarget` with `targets` by `metric` key to get `units` and `target`. Also needs `targetDate: string | null` (ISO string, from the DB row at call site) for "by 9/30" copy.

**Option B — Enrich `TargetFeasibility` upstream.** Add `units: string`, `target: number`, and optionally `targetDate: string | null` to `TargetFeasibility` in rarity-core.ts. This keeps the component prop surface clean (`GoalFeasibility` alone), but changes the type and all producers.

**Option C — Rate-only copy.** Show only the rate without target or date: "needs ~66/wk" using just `requiredRate` and the `label` (which is human-readable and already present). Skip units prefix (render as `66/wk` not `$66/wk`). Avoids the prop gap entirely — component renders from `GoalFeasibility` alone, never touches `GoalTarget`. Honest but less informative than the AC example.

**Architect recommendation surface:** the AC copy ("needs ~$66/wk to hit $1,000 by 9/30") requires either Option A or B. Option A (extra props) is least invasive; Option B is cleaner long-term. Option C is a safe fallback if the story scope is kept tight.

---

## File map (all sources read)

| File | Relevance |
|---|---|
| `src/lib/rarity-core.ts` | `GoalFeasibility`, `TargetFeasibility`, `RarityTier`, `TargetVerdict`, `RARITY_TIERS`, tier math |
| `src/lib/rarity.ts` | `computeGoalFeasibility` (server-only), `GoalLike`, serialization proof |
| `src/lib/goal-targets.ts` | `resolveMetricValue` — log:* null-at-0-logs code path |
| `src/lib/metrics-registry.ts` | `GoalTarget` type (has `units`, `target`, `direction`); METRICS registry |
| `src/lib/rarity-core.ts:298–337` | `normForFamily` — confirms log: returns null norm |
| `src/components/Card.tsx` | Card API |
| `src/components/ReadinessBreakdown.tsx` | Structural model for per-target rows |
| `src/components/ReachMeter.tsx` | Tier labels, colors, `TIER_CONFIG` — import or replicate |
| `src/components/MilestoneBurnDown.tsx` | Server component pattern, USER_TZ date formatting |
| `src/lib/calendar-core.ts` | `USER_TZ`, `parseDateKey`, `dateKey` — no dedicated display formatter |
| `src/lib/goal-presentation.ts` | `fmtComma` — goal-generic number formatter |
| `src/app/goals/[id]/page.tsx:238–296` | Existing inline feasibility rendering — `FeasibilityReadout` replaces this |
