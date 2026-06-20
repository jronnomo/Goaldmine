# Architecture Blueprint — FeasibilityReadout (#77)

Date: 2026-06-17  
Agent: Architect (read-only, writes this file only)

---

## 0. Load-Bearing Confirmation: `rarity-core.ts` Comment vs. Actual Code

The comment at `src/lib/rarity-core.ts:406–408` claims: "Build-from-zero metrics (hike:*, workout:count, log:*) always have current=0 from resolveMetricValue". **This comment is wrong for `log:*`.** The actual code at `src/lib/goal-targets.ts:100–112` returns `entry?.value ?? null` — so `log:*` returns **null** at 0 entries. The research output is correct. The no-data sub-state pivot on `requiredRate` is sound because `log:*` at 0 entries → `current = null` → `computeTargetFeasibility` null-current early exit → `requiredRate: null`. Do NOT let the comment mislead you.

---

## 1. Exact Prop Signature + Imports

### Decision: import `type` directly from `rarity-core.ts`

```ts
import type { GoalFeasibility, TargetFeasibility, RarityTier } from "@/lib/rarity-core";
import { fmtComma } from "@/lib/goal-presentation";
import { Card } from "@/components/Card";
```

**Rejected:** importing from `rarity.ts` — that module contains the async `computeGoalFeasibility` function which imports Prisma at module load time. A `type`-only import from `rarity-core.ts` pulls zero runtime code. Confirmed: `rarity-core.ts` opens with the comment "Pure, client-safe rarity/feasibility engine. NO Prisma imports. NO @/lib/calendar imports."

**Type-only import safety:** `import type { ... }` is erased at compile time. No runtime code from `rarity-core.ts` ships into the component bundle.

### Prop interface (settled by PRD §3.1)

```ts
export function FeasibilityReadout({
  feasibility,
  targetDateLabel,
}: {
  feasibility: GoalFeasibility;
  targetDateLabel?: string | null;
})
```

- `targetDateLabel` is a **pre-formatted USER_TZ string** (e.g. `"Sep 30, 2026"`) passed from the caller (#78/#79). The caller formats it via `new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: USER_TZ }).format(new Date(goal.targetDate))` — matching `MilestoneBurnDown.tsx:44–47` exactly.
- This component constructs **no `Date` object** and calls **no `toLocaleString`**. Every temporal value it needs arrives already serialized: `computedAt` is a string, `weeksRemaining` is a number, `targetDateLabel` is a pre-formatted string.
- **`GoalFeasibility` shape (confirmed from rarity-core.ts:209–218):**
  ```ts
  { goalId, tier: RarityTier|null, unratedReason: "someday"|"no-targets"|"no-data"|null,
    ratio: number|null, perTarget: TargetFeasibility[], basis: "observed"|"norms"|"mixed"|null,
    weeksRemaining: number|null, computedAt: string }
  ```
- **`TargetFeasibility` shape (confirmed from rarity-core.ts:191–207):** `{ metric, label, weight, requiredRate: number|null, observedRate: number|null, plausibleRate: number|null, rateBasis: "observed"|"norm"|"none", ratio: number|null, verdict: TargetVerdict, countsTowardTier: boolean, currentValue: number|null }`. **No `units`, no `target`, no `direction`, no `targetDate`** — rate copy is unit-free.

---

## 2. State-Selection Logic

### Four states + two no-data sub-states

State selection runs in exactly this order (mutual exclusion guaranteed by engine invariant: `tier !== null ↔ unratedReason === null`):

```
1. unratedReason === "someday"    → state SOMEDAY
2. unratedReason === "no-targets" → state NO_TARGETS
3. unratedReason === "no-data"
   a. const anyRequired = feasibility.perTarget.some(t => t.requiredRate !== null)
      !anyRequired → state NO_DATA_0_LOG
       anyRequired → state NO_DATA_1_2_LOG
4. tier !== null (unratedReason is null) → state TIER_SET
```

**The exact `anyRequired` pivot:**
```ts
const anyRequired = feasibility.perTarget.some((t) => t.requiredRate !== null);
```

Why `requiredRate !== null` is the correct pivot:
- 0 logs (`log:*`): `resolveMetricValue` returns `null` → `current = null` → null-current early exit in `computeTargetFeasibility` → `requiredRate: null`.
- 1–2 logs: `current` is non-null → `requiredRate = gap / weeksRemaining` → non-null. `observedRate` is null (slope needs ≥3 points).
- "met" case: `requiredRate: 0` (not null) — `0 !== null` is `true`, so "met" targets DO trip `anyRequired`. "met" within no-data state is data-invariant-impossible (met targets have `countsTowardTier: true` which pushes goal to tier), but the row renderer handles `verdict === "met"` correctly (see §3).

### Exact copy strings (all four states)

**State 1 — SOMEDAY:**
```
"No deadline set — Reach unrated."
```

**State 2 — NO_TARGETS:**
```
"Add targets to rate Reach."
```

**State 3a — NO_DATA_0_LOG** (every perTarget has `requiredRate === null`):
```
"Not enough logged data to rate yet — log the metric a few times to see the pace you need."
```
Critical: this copy makes NO per-week promise. `requiredRate` is null so we cannot cite a number.

**State 3b — NO_DATA_1_2_LOG** (≥1 perTarget has `requiredRate !== null`):
Header line (above per-target rows):
```
"Need more data to rate — pace needed to reach your target:"
```
Then per-target rows (see §3) with `observedRate` rendered as "— not yet estimable".

**State 4 — TIER_SET:**
Goal-level summary line + per-target rows (see §3). See §4 for the tier label.

---

## 3. Per-Target Row Rendering

### Row structure (shared between states 3b and 4)

```tsx
function PerTargetRows({
  perTarget,
  targetDateLabel,
}: {
  perTarget: TargetFeasibility[];
  targetDateLabel: string | null;
}) {
  return (
    <ul className="space-y-3">
      {perTarget.map((t) => (
        <li key={t.metric}>
          {/* Row header: label + verdict */}
          <div className="flex justify-between text-sm mb-0.5 gap-2">
            <span className="font-medium truncate pr-2">{t.label}</span>
            <span className="text-[var(--muted)] shrink-0 text-xs tabular-nums">
              {fmtVerdict(t.verdict)}
            </span>
          </div>
          {/* Rate detail: skip when met */}
          {t.verdict === "met" ? (
            <p className="text-xs text-[var(--muted)]">Target met</p>
          ) : (
            <p className="text-xs text-[var(--muted)]">
              {t.requiredRate !== null ? (
                <>
                  needs ~{fmtComma(t.requiredRate)}/wk
                  {targetDateLabel != null ? ` by ${targetDateLabel}` : ""}
                </>
              ) : (
                "—"
              )}
              {" · "}
              {t.observedRate !== null
                ? `${fmtComma(t.observedRate)}/wk observed`
                : "— not yet estimable"}
              {t.rateBasis !== "none" && (
                <> · {t.rateBasis === "observed" ? "observed pace" : "typical pace"}</>
              )}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
```

### Null-handling contract

| Field | null → display |
|---|---|
| `t.requiredRate` | "—" |
| `t.observedRate` | "— not yet estimable" |
| `targetDateLabel` (prop) | omit "by …" clause entirely |
| `t.rateBasis === "none"` | omit basis clause |
| `t.verdict === "met"` | skip rate line entirely, show "Target met" |

### `fmtVerdict` local helper

```ts
type TargetVerdict = TargetFeasibility["verdict"]; // inferred union

function fmtVerdict(v: TargetVerdict): string {
  if (v === "met") return "met";
  if (v === "unknown") return "no data";
  return TIER_LABEL[v]; // v is RarityTier here — TypeScript narrows correctly
}
```

### Goal-generic confirmation

- **All labels** come from `t.label` (user's own target label — "MRR", "Body Weight", etc.)
- **No `$`**, **no `lb`**, **no `ft`** — `fmtComma` formats a bare integer (Intl.NumberFormat, 0 decimal places)
- **No `"Elbert"`, `"Chewgether"`, `"MRR"` hardcoded** anywhere in the component file
- `grep -nE "Elbert|Chewgether|MRR|use client|new Date|toLocaleString|\\\$" src/components/FeasibilityReadout.tsx` must be clean (AC §5)

---

## 4. Tier → Human Label (Server-Safe Source)

### Decision: LOCAL `TIER_LABEL` constant in `FeasibilityReadout.tsx`

```ts
// Defined at module scope in FeasibilityReadout.tsx
const TIER_LABEL: Record<RarityTier, string> = {
  common:    "Common",
  uncommon:  "Uncommon",
  rare:      "Rare",
  epic:      "Epic",
  legendary: "Legendary",
};
```

**Rejected:** importing `TIER_CONFIG` from `src/components/ReachMeter.tsx`. Reason: `ReachMeter.tsx` has no `"use client"` directive and is technically server-safe, BUT it carries `fill`, `color`, and `bold` fields that this component does not need. Importing a presentational glyph component to extract a string map adds coupling to unrelated visual implementation details and muddies the dependency graph. Five lines local is strictly cleaner.

**On-screen axis noun: "Reach"** (per UXR-63-01; engine/MCP keeps "rarity" internally). Both the Card title and copy use "Reach", not "Rarity".

### Goal-level tier display for TIER_SET state

```tsx
<div className="flex items-baseline justify-between mb-3">
  <span className="text-lg font-semibold">
    {tier != null ? TIER_LABEL[tier] : "—"}
  </span>
  <span className="text-xs text-[var(--muted)] tabular-nums">
    {weeksRemaining != null ? `${Math.round(weeksRemaining)} wk remaining` : ""}
    {basis != null ? ` · ${basisLabel(basis)}` : ""}
  </span>
</div>
```

`basisLabel` helper:
```ts
function basisLabel(basis: "observed" | "norms" | "mixed"): string {
  if (basis === "observed") return "your pace";
  if (basis === "norms") return "typical norms";
  return "mixed";
}
```

`weeksRemaining` is floored at `minWeeksRemaining = 1` in `rarity.ts` (never 0 in tier-set state), but is `null` for someday/no-targets (those states are already handled before reaching TIER_SET). Guard defensively with `!= null`.

---

## 5. Styling

### Outer wrapper — `data-testid` pattern

`Card` renders a `<section>` and does **not** accept `data-testid` (confirmed from `src/components/Card.tsx:1–27`). Following `MilestoneBurnDown.tsx:54–55` precedent:

```tsx
<div data-testid="feasibility-readout">
  <Card title="Reach">
    {/* state-specific content */}
  </Card>
</div>
```

### Card styling (inherited from Card component)

`Card` already applies: `rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm`. Do **not** add `className` to `Card` — the default is correct and matches `ReadinessBreakdown`'s host card.

### Per-target rows

Match `ReadinessBreakdown.tsx` row structure. No progress bar (ReadinessBreakdown has one; FeasibilityReadout does not — there is no `progress` field on `TargetFeasibility` to drive a bar). Use the `space-y-3` + `flex justify-between text-sm` pattern exactly.

CSS variables in use:
- `text-[var(--muted)]` — all secondary/detail text
- `text-[var(--foreground)]` — label (via default, no class needed on `font-medium` span)
- No `text-[var(--accent)]` or `text-[var(--warning)]` in the per-target rows — verdict is text-only, not color-coded (PRD does not request it; can be added in #78/#79 as enhancement)

### No-data states

Simple `<p className="text-sm text-[var(--muted)]">` — single line copy, no sub-structure needed.

### Server component declaration

No `"use client"` directive. No `useState`, `useEffect`, `useRef`, or any React hook. No `import type ... from "next/server"` (not needed — takes props directly). No `async` keyword needed — the component is synchronous (takes serialized `GoalFeasibility`, no DB calls).

---

## 6. Complete Component Skeleton

```tsx
// src/components/FeasibilityReadout.tsx
// Server component — no "use client", no hooks, no Date construction.
// Renders honest goal feasibility from a single serialized GoalFeasibility value.
// Placement on Today/goal pages is #78/#79; this is the component + render proof only.

import type { GoalFeasibility, TargetFeasibility, RarityTier } from "@/lib/rarity-core";
import { fmtComma } from "@/lib/goal-presentation";
import { Card } from "@/components/Card";

// ── Tier label map (local, server-safe) ───────────────────────────────────────
// Decision: not imported from ReachMeter.tsx. See architecture-blueprint.md §4.
const TIER_LABEL: Record<RarityTier, string> = {
  common:    "Common",
  uncommon:  "Uncommon",
  rare:      "Rare",
  epic:      "Epic",
  legendary: "Legendary",
};

type TargetVerdict = TargetFeasibility["verdict"];

function fmtVerdict(v: TargetVerdict): string {
  if (v === "met") return "met";
  if (v === "unknown") return "no data";
  return TIER_LABEL[v];
}

function basisLabel(basis: "observed" | "norms" | "mixed"): string {
  if (basis === "observed") return "your pace";
  if (basis === "norms") return "typical norms";
  return "mixed";
}

// ── Per-target rows (shared between NO_DATA_1_2_LOG and TIER_SET states) ─────
function PerTargetRows({
  perTarget,
  targetDateLabel,
}: {
  perTarget: TargetFeasibility[];
  targetDateLabel: string | null;
}) {
  return (
    <ul className="space-y-3">
      {perTarget.map((t) => (
        <li key={t.metric}>
          <div className="flex justify-between text-sm mb-0.5 gap-2">
            <span className="font-medium truncate pr-2">{t.label}</span>
            <span className="text-[var(--muted)] shrink-0 text-xs tabular-nums">
              {fmtVerdict(t.verdict)}
            </span>
          </div>
          {t.verdict === "met" ? (
            <p className="text-xs text-[var(--muted)]">Target met</p>
          ) : (
            <p className="text-xs text-[var(--muted)]">
              {t.requiredRate !== null ? (
                <>
                  needs ~{fmtComma(t.requiredRate)}/wk
                  {targetDateLabel != null ? ` by ${targetDateLabel}` : ""}
                </>
              ) : (
                "—"
              )}
              {" · "}
              {t.observedRate !== null
                ? `${fmtComma(t.observedRate)}/wk observed`
                : "— not yet estimable"}
              {t.rateBasis !== "none" && (
                <> · {t.rateBasis === "observed" ? "observed pace" : "typical pace"}</>
              )}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function FeasibilityReadout({
  feasibility,
  targetDateLabel,
}: {
  feasibility: GoalFeasibility;
  targetDateLabel?: string | null;
}) {
  const { unratedReason, tier, perTarget, basis, weeksRemaining } = feasibility;

  // State 1 — SOMEDAY
  if (unratedReason === "someday") {
    return (
      <div data-testid="feasibility-readout">
        <Card title="Reach">
          <p className="text-sm text-[var(--muted)]">
            No deadline set — Reach unrated.
          </p>
        </Card>
      </div>
    );
  }

  // State 2 — NO_TARGETS
  if (unratedReason === "no-targets") {
    return (
      <div data-testid="feasibility-readout">
        <Card title="Reach">
          <p className="text-sm text-[var(--muted)]">
            Add targets to rate Reach.
          </p>
        </Card>
      </div>
    );
  }

  // State 3 — NO_DATA
  if (unratedReason === "no-data") {
    const anyRequired = perTarget.some((t) => t.requiredRate !== null);

    // Sub-state 3a — 0 logs: requiredRate null for all targets
    if (!anyRequired) {
      return (
        <div data-testid="feasibility-readout">
          <Card title="Reach">
            <p className="text-sm text-[var(--muted)]">
              Not enough logged data to rate yet — log the metric a few times to
              see the pace you need.
            </p>
          </Card>
        </div>
      );
    }

    // Sub-state 3b — 1–2 logs: requiredRate computable, observed not yet estimable
    return (
      <div data-testid="feasibility-readout">
        <Card title="Reach">
          <p className="text-xs text-[var(--muted)] mb-3">
            Need more data to rate — pace needed to reach your target:
          </p>
          <PerTargetRows
            perTarget={perTarget}
            targetDateLabel={targetDateLabel ?? null}
          />
        </Card>
      </div>
    );
  }

  // State 4 — TIER_SET (tier !== null, unratedReason === null)
  return (
    <div data-testid="feasibility-readout">
      <Card title="Reach">
        <div className="flex items-baseline justify-between mb-3">
          <span className="text-lg font-semibold">
            {tier != null ? TIER_LABEL[tier] : "—"}
          </span>
          <span className="text-xs text-[var(--muted)] tabular-nums">
            {weeksRemaining != null ? `${Math.round(weeksRemaining)} wk remaining` : ""}
            {basis != null ? ` · ${basisLabel(basis)}` : ""}
          </span>
        </div>
        {perTarget.length > 0 && (
          <PerTargetRows
            perTarget={perTarget}
            targetDateLabel={targetDateLabel ?? null}
          />
        )}
      </Card>
    </div>
  );
}
```

---

## 7. Fixture-Render Proof (Vitest)

### Test file: `src/components/FeasibilityReadout.test.ts`

**Why `.test.ts` (not `.test.tsx`):** Vitest config at `vitest.config.ts:12` specifies `include: ["src/**/*.test.ts"]`. Existing tests follow this convention. The test file imports `createElement` from `react` and calls `renderToStaticMarkup` — no JSX written in the test file itself. Vite transforms `FeasibilityReadout.tsx` (which contains JSX) correctly when imported; `include` only controls test discovery.

**Why `renderToStaticMarkup`:** `FeasibilityReadout` is a synchronous component (no `async`, no DB calls, no server-only hooks). `react-dom/server.renderToStaticMarkup` works in the Vitest `node` environment and returns a plain `string`. `react-dom` is confirmed installed (`"react-dom": "19.2.4"` in package.json). TSConfig has `"jsx": "react-jsx"` — Vite uses this automatically for `.tsx` file transforms.

**Why NOT React Server Component renderer:** The component uses no Next.js server-only APIs (`headers()`, `cookies()`, etc.). Pure prop → JSX. `renderToStaticMarkup` is sufficient and keeps the test dependency-free.

```ts
// src/components/FeasibilityReadout.test.ts
// Fixture-based render proof for FeasibilityReadout (#77).
// Uses createElement (no JSX) + renderToStaticMarkup (no DOM needed) — node env.
// Vitest include: src/**/*.test.ts — this file is discovered correctly.

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FeasibilityReadout } from "@/components/FeasibilityReadout";
import type { GoalFeasibility, TargetFeasibility } from "@/lib/rarity-core";

// ── Shared perTarget stubs ────────────────────────────────────────────────────

const UNKNOWN_TARGET: TargetFeasibility = {
  metric: "log:mrr",
  label: "MRR",
  weight: 1,
  requiredRate: null,
  observedRate: null,
  plausibleRate: null,
  rateBasis: "none",
  ratio: null,
  verdict: "unknown",
  countsTowardTier: false,
  currentValue: null,
};

const RARE_TARGET: TargetFeasibility = {
  metric: "log:mrr",
  label: "MRR",
  weight: 1,
  requiredRate: 67,
  observedRate: 54,
  plausibleRate: 54,
  rateBasis: "observed",
  ratio: 1.24,
  verdict: "rare",
  countsTowardTier: true,
  currentValue: 200,
};

// ── Fixture A: Live Chewgether shape — 0 logs, no-data ───────────────────────
// requiredRate: null on all perTarget → sub-state 3a (0-log)
const FIXTURE_NO_DATA_0_LOG: GoalFeasibility = {
  goalId: "chewgether-goal-1",
  tier: null,
  unratedReason: "no-data",
  ratio: null,
  perTarget: [UNKNOWN_TARGET],
  basis: null,
  weeksRemaining: 20,
  computedAt: "2026-06-17T00:00:00.000Z",
};

// ── Fixture B: ≥3-log tier "rare" ────────────────────────────────────────────
// tier: "rare", basis: "observed", requiredRate + observedRate both non-null
const FIXTURE_RARE_TIER: GoalFeasibility = {
  goalId: "chewgether-goal-1",
  tier: "rare",
  unratedReason: null,
  ratio: 1.24,
  perTarget: [RARE_TARGET],
  basis: "observed",
  weeksRemaining: 15,
  computedAt: "2026-06-17T00:00:00.000Z",
};

// ─────────────────────────────────────────────────────────────────────────────

describe("FeasibilityReadout", () => {
  // AC §4 + §8: 0-log copy appears, no per-week rate promised
  it("0-log no-data: renders honest copy, no /wk promise", () => {
    const html = renderToStaticMarkup(
      createElement(FeasibilityReadout, { feasibility: FIXTURE_NO_DATA_0_LOG }),
    );
    expect(html).toContain("Not enough logged data");
    expect(html).not.toContain("/wk");
  });

  // AC §8: ≥3-log fixture shows real tier verdict
  it("tier-set: renders tier label and per-week rates", () => {
    const html = renderToStaticMarkup(
      createElement(FeasibilityReadout, { feasibility: FIXTURE_RARE_TIER }),
    );
    expect(html).toContain("Rare");
    expect(html).toContain("needs ~67/wk");
    expect(html).toContain("54/wk observed");
  });

  // State 1
  it("someday: renders no-deadline copy", () => {
    const someday: GoalFeasibility = {
      ...FIXTURE_NO_DATA_0_LOG,
      unratedReason: "someday",
      perTarget: [],
      weeksRemaining: null,
    };
    const html = renderToStaticMarkup(
      createElement(FeasibilityReadout, { feasibility: someday }),
    );
    expect(html).toContain("No deadline set");
    expect(html).toContain("Reach unrated");
  });

  // State 2
  it("no-targets: renders add-targets copy", () => {
    const noTargets: GoalFeasibility = {
      ...FIXTURE_NO_DATA_0_LOG,
      unratedReason: "no-targets",
      perTarget: [],
    };
    const html = renderToStaticMarkup(
      createElement(FeasibilityReadout, { feasibility: noTargets }),
    );
    expect(html).toContain("Add targets");
  });

  // State 3b — 1–2 logs: anyRequired = true, observedRate null
  it("1-2 log: shows required rate, 'not yet estimable' for observed", () => {
    const oneTwoLog: GoalFeasibility = {
      ...FIXTURE_NO_DATA_0_LOG,
      perTarget: [{
        ...UNKNOWN_TARGET,
        requiredRate: 67,   // 1 log → requiredRate computable
        currentValue: 200,  // current is now non-null
        // observedRate stays null — slope needs ≥3 points
      }],
    };
    const html = renderToStaticMarkup(
      createElement(FeasibilityReadout, { feasibility: oneTwoLog }),
    );
    expect(html).toContain("not yet estimable");
    expect(html).toContain("67"); // fmtComma(67) → "67"
    expect(html).not.toContain("Not enough logged data");
  });

  // targetDateLabel integration
  it("tier-set + targetDateLabel: 'by Sep 30, 2026' appears in rate copy", () => {
    const html = renderToStaticMarkup(
      createElement(FeasibilityReadout, {
        feasibility: FIXTURE_RARE_TIER,
        targetDateLabel: "Sep 30, 2026",
      }),
    );
    expect(html).toContain("by Sep 30, 2026");
  });

  // Edge: verdict "met" — rate lines skipped, "Target met" shown
  it("met verdict: shows 'Target met', skips rate copy", () => {
    const withMet: GoalFeasibility = {
      ...FIXTURE_RARE_TIER,
      perTarget: [{
        ...RARE_TARGET,
        requiredRate: 0,
        observedRate: 80,
        verdict: "met",
        countsTowardTier: true,
        currentValue: 1000,
      }],
    };
    const html = renderToStaticMarkup(
      createElement(FeasibilityReadout, { feasibility: withMet }),
    );
    expect(html).toContain("Target met");
    expect(html).not.toContain("needs ~");
  });

  // Grep-clean guard (AC §5): no vertical strings in rendered output
  it("renders no hardcoded vertical strings (Elbert/Chewgether/$)", () => {
    const html1 = renderToStaticMarkup(
      createElement(FeasibilityReadout, { feasibility: FIXTURE_NO_DATA_0_LOG }),
    );
    const html2 = renderToStaticMarkup(
      createElement(FeasibilityReadout, { feasibility: FIXTURE_RARE_TIER }),
    );
    for (const html of [html1, html2]) {
      expect(html).not.toContain("Elbert");
      expect(html).not.toContain("Chewgether");
      expect(html).not.toContain("fitness");
      // "$" may appear in label if user's target.label contains "$" — that's fine.
      // The component itself must not hardcode "$". Test the source file separately
      // via the grep check in AC §5.
    }
  });
});
```

---

## 8. Edge Case Handling

| Edge case | Guard |
|---|---|
| `perTarget` is empty, `unratedReason === null` (tier-set, no perTarget rendered) | `{perTarget.length > 0 && <PerTargetRows ... />}` — nothing rendered if empty |
| `verdict === "met"`, `requiredRate === 0` | Branch on `t.verdict === "met"` in PerTargetRows; shows "Target met", skips rate lines |
| Mixed perTarget (one rated, one unknown) | PerTargetRows renders each row independently; "no data" shows for unknown rows, tier label for rated rows |
| `weeksRemaining === null` in tier-set | Guard `weeksRemaining != null ? ...` — omit the weeks display if null |
| `basis === null` in tier-set | Guard `basis != null ? ...` — omit the basis label if null |
| `targetDateLabel` omitted/null | `targetDateLabel != null ? \` by ${targetDateLabel}\` : ""` — clause omitted cleanly |
| `observedRate !== null` in 0-log state (data-invariant edge) | `observedRate !== null ? \`${fmtComma(o)}/wk observed\` : "— not yet estimable"` — shows the value if present regardless of state |
| 0-log state with `requiredRate !== null` (impossible data-invariant) | The `anyRequired` check would route to 3b, showing rows — correct fallback |

---

## 9. What the Developer Must Not Get Wrong

**Single trickiest thing:** The `anyRequired` pivot (`perTarget.some(t => t.requiredRate !== null)`) is the ONLY correct way to distinguish the 0-log vs 1-2-log no-data sub-states. Do NOT use `perTarget.some(t => t.currentValue !== null)` (there is no such field in older shapes) or `perTarget.some(t => t.countsTowardTier)` (that is false for both sub-states). Do NOT use `perTarget.length > 0` (perTarget is populated for all no-data and tier-set states). The exact pivot is `requiredRate !== null` and the copy for `!anyRequired` must NOT cite a per-week rate.

---

## 10. Acceptance Criteria Checklist for Developer

- [ ] `grep -nE "use client" src/components/FeasibilityReadout.tsx` → no match
- [ ] `grep -nE "new Date|toLocaleString" src/components/FeasibilityReadout.tsx` → no match
- [ ] `grep -nE "Elbert|Chewgether|MRR|fitness|\\\$" src/components/FeasibilityReadout.tsx` → no match
- [ ] `git diff --stat src/lib/rarity-core.ts` → empty (untouched)
- [ ] `npx tsc --noEmit` → 0 errors
- [ ] `npm run lint` → 0 errors on new file
- [ ] `npx vitest run` → all tests pass including new FeasibilityReadout tests
- [ ] 4 states + 2 no-data sub-states render correctly as specified in §2
- [ ] `targetDateLabel` passed through to per-target rows with "by …" clause
- [ ] No `Date` constructed anywhere in the component or test file
