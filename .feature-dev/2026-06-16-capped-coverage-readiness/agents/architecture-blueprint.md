# Architecture Blueprint — Capped, Coverage-Aware Readiness
Feature: capped-coverage-readiness  
Date: 2026-06-16  
Agent: architect  
Status: LOCKED — do not redesign; implement exactly as specified below.

---

## 1. File Plan

| Action | Path | REQ | Purpose | Owning stream |
|--------|------|-----|---------|---------------|
| Modify | `src/lib/metrics-registry.ts` | REQ-001 | Add `gating?: boolean` to `GoalTarget` type + `GoalTargetSchema` zod; mark two `MT_ELBERT_DEFAULT_TARGETS` entries | Stream A |
| Modify | `src/lib/readiness.ts` | REQ-002 | Rewrite scoring block; export `GATE_CEILING`; extend `ReadinessSnapshot` additively; update `missing` JSDoc | Stream A |
| Modify | `src/lib/mcp/tools.ts` | REQ-003 | Update `compute_readiness` description; new fields flow via existing `...snap` spread (no schema change); verify write tools auto-pass `gating` | Stream A |
| Verify (no change) | `src/lib/rarity-core.ts` | REQ-004 | Add one-line comment near line 405 noting `gating` is readiness-only; zero logic change needed | Stream A |
| Modify | `src/lib/recap.ts` | REQ-005 | Add `coverage` + `openGateCount` to `RecapGoalBlock` and propagate from `computeReadiness` snapshot in `computeWeeklyRecap` | Stream B |
| Modify | `src/lib/recap-card.tsx` | REQ-005 | Add coverage line JSX below "READINESS" label on card (SlideOne cover) and full card — satori-safe, flex, inline styles | Stream B |
| Modify | `src/app/progress/page.tsx` | REQ-006 | Surface `coverage` + `openGateCount` per-goal below the score numeral in the readiness Card | Stream B |

Stream A must be merged before Stream B writes any code. Zero file overlap between streams.

---

## 2. Frozen `ReadinessSnapshot` v2 Type

This is the contract Stream B codes against. Copy-paste exactly into `src/lib/readiness.ts`, replacing the current `ReadinessSnapshot` type.

```typescript
/** One gating target's cleared status — returned in ReadinessSnapshot.gates[]. */
export type ReadinessGate = {
  /** Human-readable label from GoalTarget.label. */
  label: string;
  /** 0..1 progress, or null if no data yet. */
  progress: number | null;
  /** True only when progress !== null && progress >= 1. */
  cleared: boolean;
};

export type ReadinessSnapshot = {
  /**
   * 0..100 overall readiness score = Math.min(rawScore, ceiling).
   * This is the honest, capped headline number. Feed it to the ring / chart.
   */
  score: number;
  /**
   * Uncapped weighted average over ALL targets (untested = 0 progress, full
   * weight in denominator). Equals score when no gates are open.
   * Math.round(Σ(weightᵢ · (progressᵢ ?? 0)) / Σ(all weights) * 100).
   */
  rawScore: number;
  /**
   * 80 when any gating target is uncleaned, 100 otherwise.
   * score = Math.min(rawScore, ceiling).
   */
  ceiling: number;
  /** How many targets have been logged vs the total. */
  coverage: { tested: number; total: number };
  /** All targets flagged gating:true, with their cleared status. */
  gates: ReadinessGate[];
  /** Count of gating targets not yet cleared (progress === null OR progress < 1). */
  openGateCount: number;
  /** Per-target breakdown including untested targets (progress: null). */
  breakdown: TargetProgress[];
  /**
   * Targets with no data yet. Counted as 0 progress in the score denominator —
   * they are NOT excluded from the score (unlike the old behavior).
   * JSDoc updated: was "excluded from overall score" — no longer accurate.
   */
  missing: GoalTarget[];
};
```

**Back-compat:** Every existing consumer that reads only `.score`, `.breakdown`, or `.missing` keeps working without any change. `computeReadinessSeries` reads only `snap.score` — no change needed there.

---

## 3. `computeReadiness` Rewrite

Replace the scoring block at **lines 81–88** of `src/lib/readiness.ts` (the `usable` filter and the two-step reduce). Keep everything before line 81 unchanged (the `for` loop that builds `breakdown[]` and `missing[]` is correct; do not touch it). The function signature and `TargetProgress` type are unchanged.

Export the constant above the function:

```typescript
/** Score ceiling applied while any gating target remains uncleaned. */
export const GATE_CEILING = 80;
```

Replace lines 81–88 with:

```typescript
  // ── Coverage ────────────────────────────────────────────────────────────
  const tested = breakdown.filter((b) => b.progress !== null).length;
  const coverage = { tested, total: targets.length };

  // ── Gating ──────────────────────────────────────────────────────────────
  const gates: ReadinessGate[] = breakdown
    .filter((b) => b.target.gating === true)
    .map((b) => ({
      label: b.target.label,
      progress: b.progress,
      cleared: b.progress !== null && b.progress >= 1,
    }));
  const openGateCount = gates.filter((g) => !g.cleared).length;
  const ceiling = openGateCount > 0 ? GATE_CEILING : 100;

  // ── Scoring (untested = 0, full weight in denominator) ──────────────────
  const totalWeight = breakdown.reduce((acc, b) => acc + (b.target.weight ?? 0), 0);
  if (totalWeight === 0) {
    return { score: 0, rawScore: 0, ceiling, coverage, gates, openGateCount, breakdown, missing };
  }
  const weighted = breakdown.reduce(
    (acc, b) => acc + (b.target.weight ?? 0) * (b.progress ?? 0),
    0,
  );
  const rawScore = Math.round((weighted / totalWeight) * 100);
  const score = Math.min(rawScore, ceiling);

  return { score, rawScore, ceiling, coverage, gates, openGateCount, breakdown, missing };
```

**Also replace** the early-exit guard at **line 82** (currently `if (usable.length === 0) return { score: 0, breakdown, missing };`) — this guard becomes obsolete because the new code handles an all-untested scenario correctly (rawScore=0, ceiling driven by gates). Remove it entirely; the `totalWeight === 0` guard below is the only early exit needed.

**Complete replacement for lines 81–88 in context** (shown with surrounding lines for exact placement):

```typescript
  // ... (lines 65-80: the for loop building breakdown / missing — UNCHANGED) ...

  // ── Coverage ────────────────────────────────────────────────────────────
  const tested = breakdown.filter((b) => b.progress !== null).length;
  const coverage = { tested, total: targets.length };

  // ── Gating ──────────────────────────────────────────────────────────────
  const gates: ReadinessGate[] = breakdown
    .filter((b) => b.target.gating === true)
    .map((b) => ({
      label: b.target.label,
      progress: b.progress,
      cleared: b.progress !== null && b.progress >= 1,
    }));
  const openGateCount = gates.filter((g) => !g.cleared).length;
  const ceiling = openGateCount > 0 ? GATE_CEILING : 100;

  // ── Scoring (untested = 0, full weight in denominator) ──────────────────
  const totalWeight = breakdown.reduce((acc, b) => acc + (b.target.weight ?? 0), 0);
  if (totalWeight === 0) {
    return { score: 0, rawScore: 0, ceiling, coverage, gates, openGateCount, breakdown, missing };
  }
  const weighted = breakdown.reduce(
    (acc, b) => acc + (b.target.weight ?? 0) * (b.progress ?? 0),
    0,
  );
  const rawScore = Math.round((weighted / totalWeight) * 100);
  const score = Math.min(rawScore, ceiling);

  return { score, rawScore, ceiling, coverage, gates, openGateCount, breakdown, missing };
}
```

**Edge cases verified by this code:**
- No targets: `totalWeight === 0` → returns `score:0, rawScore:0, ceiling:100` (ceiling=100 because `openGateCount=0` from empty `gates[]`). Matches existing empty behavior.
- No gating targets: `gates=[]`, `openGateCount=0`, `ceiling=100`. Honest coverage-aware average, no cap.
- All untested, no gates: `rawScore=0`, `coverage:{0,N}`, `score=0`.
- Gate untested (progress null): `cleared=false`, `openGateCount≥1`, `ceiling=80`. Cap bites even though nothing has been logged.
- `rawScore < ceiling`: `score = rawScore` (cap not binding).

---

## 4. `metrics-registry.ts` Exact Changes

### 4a. `GoalTarget` type — add `gating` field after `rationale?`

Current lines 22–23:
```typescript
  /** Optional rationale string for the user / Claude to read. */
  rationale?: string;
};
```

Replace with:
```typescript
  /** Optional rationale string for the user / Claude to read. */
  rationale?: string;
  /**
   * If true, while this target's progress < 1 (including untested),
   * the headline readiness score is capped at GATE_CEILING (80).
   * All gating targets cleared → ceiling lifts to 100.
   * Readiness-only concept; has no effect on rarity tier.
   */
  gating?: boolean;
};
```

### 4b. `GoalTargetSchema` zod — add `gating` field after `rationale`

Current line 59:
```typescript
  rationale: z.string().optional().describe("Optional explanation for the user / coach"),
});
```

Replace with:
```typescript
  rationale: z.string().optional().describe("Optional explanation for the user / coach"),
  gating: z.boolean().optional().describe(
    "Gate flag — while any gating target has progress < 1 (including untested), " +
    "the headline score is capped at 80. All gates cleared → ceiling 100. " +
    "Readiness-only concept; ignored by rarity tier.",
  ),
});
```

### 4c. `MT_ELBERT_DEFAULT_TARGETS` — add `gating: true` to the two hike targets

**First target (`hike:prep_completion`, lines 190–199)** — add `gating: true`:

Current object (lines 190–199):
```typescript
  {
    metric: "hike:prep_completion",
    label: "Prep hikes completed (≥5 mi & ≥2000 ft)",
    units: "hikes",
    direction: "increase",
    target: 6,
    weight: 0.3,
    rationale:
      "Most direct predictor. Six substantial Colorado hikes during a 12-week build ...",
  },
```

Replace with (add `gating: true` before `rationale`):
```typescript
  {
    metric: "hike:prep_completion",
    label: "Prep hikes completed (≥5 mi & ≥2000 ft)",
    units: "hikes",
    direction: "increase",
    target: 6,
    weight: 0.3,
    gating: true,
    rationale:
      "Most direct predictor. Six substantial Colorado hikes during a 12-week build ...",
  },
```

**Second target (`hike:max_elevation_single`, lines 200–210)** — add `gating: true`:

Current object (lines 200–210):
```typescript
  {
    metric: "hike:max_elevation_single",
    label: "Largest single hike (ft gained)",
    units: "ft",
    direction: "increase",
    target: 4000,
    weight: 0.2,
    rationale:
      "Black Cloud Trail's 5,200 ft gain is unforgiving. ...",
  },
```

Replace with (add `gating: true` before `rationale`):
```typescript
  {
    metric: "hike:max_elevation_single",
    label: "Largest single hike (ft gained)",
    units: "ft",
    direction: "increase",
    target: 4000,
    weight: 0.2,
    gating: true,
    rationale:
      "Black Cloud Trail's 5,200 ft gain is unforgiving. ...",
  },
```

**No other targets in `MT_ELBERT_DEFAULT_TARGETS` should be marked `gating: true`.**  
`hike:total_elevation_ft` (volume signal), all `baseline:*` targets, and `weightLb` remain without the flag — a weak goblet squat doesn't block the summit.

---

## 5. MCP Tools Verification

### 5a. `compute_readiness` — description update only; fields auto-flow

**Line 954–955 (confirmed by research):**
```typescript
const snap = await computeReadiness(targets, asOfDate, goal.id);
return { goalId: goal.id, objective: goal.objective, asOf: toDateKey(asOfDate), ...snap };
```

The `...snap` spread already transmits every field on `ReadinessSnapshot`. When Stream A adds `rawScore`, `ceiling`, `coverage`, `gates`, `openGateCount` to the snapshot, they automatically appear in the MCP tool response. **No inputSchema or return shape change required.**

**Update the description string** (lines 918–922). Replace the current description with:

```typescript
      description:
        "Live readiness for a goal: an overall 0-100 score, a per-target breakdown (each target's current value, start, and 0..1 progress), " +
        "and the targets with no data yet. " +
        "Score = min(rawScore, ceiling). rawScore = weighted average over ALL targets (untested = 0 progress, full weight in denominator — a target you haven't logged is dragging the score). " +
        "Coverage = { tested, total } showing how many targets have any data. " +
        "Gating: targets with gating:true cap the score at 80 until cleared (progress ≥ 1). " +
        "gates[] lists each gating target with its cleared status; openGateCount is the number still open. " +
        "ceiling is 80 when any gate is open, 100 when all are cleared. " +
        "Use it to answer 'how ready am I for the goal', 'which gates are still open', or to check if a logged result moved the needle. " +
        "Read-only — never writes. To change targets/weights/gate flags, use update_goal_targets.",
```

### 5b. `update_goal_targets` — auto-passes `gating` (no change needed)

**Line 3159 (confirmed):**
```typescript
targets: z.array(GoalTargetSchema).min(1).describe(...)
```

Once `GoalTargetSchema` gains `gating: z.boolean().optional()` (REQ-001), the coach can pass `gating: true` in any target object to this tool. The zod schema validates and persists it verbatim via `prisma.goal.update({ data: { targets: targets as Prisma.InputJsonValue } })`. **No change to this tool required.**

The description string at line 3151 says `{ metric, label, target, weight, units, direction, rationale? }` — update it to include `gating?`:

```typescript
        "Use when adjusting the success criteria / rubric / scoring weights for the goal. " +
        "Each target = { metric, label, target, weight, units, direction, rationale?, gating? }. Weights should sum near 1. " +
        "Set gating:true on a target to make it a hard gate — readiness is capped at 80 until that target reaches progress ≥ 1. " +
        "Read the current targets via get_goal first; this is a full-replace, not a patch.",
```

### 5c. `create_goal` — auto-passes `gating` (no change needed)

**Lines 3805–3812 (confirmed):**
```typescript
targets: z
  .array(GoalTargetSchema)
  .min(1)
  .optional()
  .describe(...)
```

Same mechanism as `update_goal_targets`. Once `GoalTargetSchema` gains `gating`, it flows through automatically. **No change to this tool required.**

### 5d. `get_goal` — returns targets verbatim (no change needed)

`get_goal` at line 900 returns `targets: goal.targets` as raw DB JSON. The stored JSON already contains `gating: true` once written by any write tool. **No change needed.**

---

## 6. `rarity-core.ts` — No Logic Change; Add One Comment

**The key guard at lines 405–419:**
```typescript
  // post-merge fix: never-measured targets (null current, no explicit start) are 'unknown'
  // — mirrors readiness `missing` semantics.
  // Build-from-zero metrics (hike:*, workout:count, log:*) always have current=0 from
  // resolveMetricValue, so they are never null here; this guard only fires for
  // baseline:*, exercise:*, and weightLb when no data has been logged yet.
  if (current === null && (target.start === undefined || target.start === null)) {
    return {
      ...
      verdict: "unknown",
      countsTowardTier: false,
      currentValue: null,
    };
  }
```

**Why no logic change is needed:**

The two engines serve different, intentionally divergent purposes:

- `readiness.ts` measures **"how far along am I?"** — a progress percentage. It *can* have an opinion about untested targets: "you haven't started, that's 0% progress, and your full weight counts."
- `rarity-core.ts` measures **"how hard is it to get there from here?"** — a difficulty tier based on required vs. observed weekly rate. It *cannot* rate a target it has no trajectory data for; `verdict: "unknown" / countsTowardTier: false` is the only honest answer.

The divergence (readiness includes untested at 0; rarity excludes untested from tier) is intentional and correct. They are not inconsistent — they answer different questions.

`rarity-core.ts` does not read the `gating` field anywhere. The `GoalTarget` object arriving at `computeTargetFeasibility` will now have a `gating` property when set, but it is never destructured, read, or acted on in rarity-core.ts or rarity.ts. It is simply ignored.

**The only change:** add a single comment at line 400, immediately before the `// post-merge fix:` comment:

```typescript
  // Note: gating:boolean on GoalTarget is a readiness-only concept (caps the
  // headline score at 80 until cleared). Rarity does not read or act on gating —
  // difficulty tier is independent of whether a target is a gate.
```

No other modification to `rarity-core.ts`.

---

## 7. Recap Changes

### 7a. `recap.ts` — `RecapGoalBlock` and `computeWeeklyRecap`

**Add two fields to `RecapGoalBlock` (lines 57–63):**

```typescript
/** Goal progress block. Null when no focus goal exists. */
export type RecapGoalBlock = {
  id: string;
  objective: string;
  progressPct: number | null;
  topMetricLabel: string | null;
  kind: string;
  /** Coverage from ReadinessSnapshot — how many targets have been tested. */
  coverage: { tested: number; total: number } | null; // null when no targets
  /** Number of gating targets not yet cleared. 0 when no gates. */
  openGateCount: number;
};
```

**In `computeWeeklyRecap`, update the `goalBlock` assignment** (currently lines 272–278). The snapshot is already computed at line 256. Extend the existing `goalBlock` construction:

Current (lines 272–278):
```typescript
        goalBlock = {
          id: goal.id,
          objective: goal.objective,
          progressPct,
          topMetricLabel,
          kind: goal.kind ?? "fitness",
        };
```

Replace with:
```typescript
        goalBlock = {
          id: goal.id,
          objective: goal.objective,
          progressPct,
          topMetricLabel,
          kind: goal.kind ?? "fitness",
          coverage: snapshot.coverage,
          openGateCount: snapshot.openGateCount,
        };
```

Also update the no-targets early branch (lines 248–254) to fill in the new fields with safe nulls:

Current:
```typescript
        goalBlock = {
          id: goal.id,
          objective: goal.objective,
          progressPct: null,
          topMetricLabel: null,
          kind: goal.kind ?? "fitness",
        };
```

Replace with:
```typescript
        goalBlock = {
          id: goal.id,
          objective: goal.objective,
          progressPct: null,
          topMetricLabel: null,
          kind: goal.kind ?? "fitness",
          coverage: null,
          openGateCount: 0,
        };
```

The `WeeklyRecap.goal` type is `RecapGoalBlock | null` — the container type does not need a change.

### 7b. `recap-card.tsx` — Coverage line JSX (satori-safe)

The coverage line goes below the "READINESS" label in **two places**:
1. The full card's goal block zone (`RecapCard` component, around line 399).
2. Story slide 1's centered ring section (`SlideOne`, around line 799).

**Helper: build the coverage text string** (pure function, add near the top of the file with the other format helpers):

```typescript
/**
 * Formats the coverage/gate sub-line. Returns null when coverage data is absent
 * (no-targets state) — callers should omit the element when null.
 */
function fmtCoverageLine(
  coverage: { tested: number; total: number } | null | undefined,
  openGateCount: number | undefined,
): string | null {
  if (!coverage) return null;
  const base = `${coverage.tested}/${coverage.total} verified`;
  if (!openGateCount || openGateCount === 0) return base;
  return `${base} · ${openGateCount} gate${openGateCount === 1 ? "" : "s"} left`;
}
```

**In `RecapCard` (the full 1080×1920 card)**, the "READINESS" label block currently is (lines 391–401):

```tsx
          <div
            style={{
              fontSize: tok.fontSize.readinessLabel,
              fontFamily: tok.fontSans,
              fontWeight: tok.fontWeight.regular,
              color: tok.mutedText,
              letterSpacing: 3,
            }}
          >
            READINESS
          </div>
```

Replace with a column wrapping "READINESS" and the coverage line:

```tsx
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 6,
            }}
          >
            <div
              style={{
                fontSize: tok.fontSize.readinessLabel,
                fontFamily: tok.fontSans,
                fontWeight: tok.fontWeight.regular,
                color: tok.mutedText,
                letterSpacing: 3,
              }}
            >
              READINESS
            </div>
            {fmtCoverageLine(recap.goal?.coverage, recap.goal?.openGateCount) !== null && (
              <div
                style={{
                  fontSize: 22,
                  fontFamily: tok.fontSans,
                  fontWeight: tok.fontWeight.regular,
                  color: tok.mutedText,
                  letterSpacing: 0,
                  textAlign: "center",
                }}
              >
                {fmtCoverageLine(recap.goal?.coverage, recap.goal?.openGateCount)!}
              </div>
            )}
          </div>
```

**In `SlideOne` (Story cover, lines 799–801)**, the "READINESS" label is:

```tsx
        <div style={{ fontSize: tok.fontSize.readinessLabel, fontFamily: tok.fontSans, fontWeight: tok.fontWeight.regular, color: tok.mutedText, letterSpacing: 3 }}>
          READINESS
        </div>
```

Replace with the same column wrapper pattern:

```tsx
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: tok.fontSize.readinessLabel, fontFamily: tok.fontSans, fontWeight: tok.fontWeight.regular, color: tok.mutedText, letterSpacing: 3 }}>
            READINESS
          </div>
          {fmtCoverageLine(recap.goal?.coverage, recap.goal?.openGateCount) !== null && (
            <div
              style={{
                fontSize: 24,
                fontFamily: tok.fontSans,
                fontWeight: tok.fontWeight.regular,
                color: tok.mutedText,
                letterSpacing: 0,
                textAlign: "center",
              }}
            >
              {fmtCoverageLine(recap.goal?.coverage, recap.goal?.openGateCount)!}
            </div>
          )}
        </div>
```

**Satori safety rules observed:**
- Flex-only layout (no CSS grid, no CSS vars, no `conic-gradient`).
- Every div with multiple children has explicit `display: "flex"`.
- Inline styles throughout (`style={{ ... }}`), no Tailwind classes.
- Template hex colors via `tok.mutedText` (already a template token, not a CSS var).
- No SVG `<image>` tags, no web fonts not pre-loaded, no `position: absolute` inside the new elements.
- `fmtCoverageLine` returns a plain string — no nested JSX inside the text node.

**Where the coverage line slots:** below the "READINESS" string, inside the ring's label column (`flexDirection: "column"`, `alignItems: "center"`). It is 22px on the card (readinessLabel is typically 26–30px) and 24px on the Story cover. Muted color. This does not grow the ring column's width — `flexShrink: 0` on the parent column means any text overflow wraps or clips, not expands.

**SlideThree does NOT get the coverage line.** SlideThree shows the ProgressRing with the streak + "On to Week N." — it is the closing slide and intentionally does not repeat all data. No change to SlideThree or SlideTwo.

---

## 8. Progress Page Changes

**File:** `src/app/progress/page.tsx`

**Where:** Inside the per-goal card, below the score numeral (`snapshot.score`) and above the ReadinessChart. Currently lines 128–137:

```tsx
                <div className="flex items-baseline justify-between mb-2">
                  <p className="text-4xl font-semibold tracking-tight">
                    {snapshot.score}
                    <span className="text-base text-[var(--muted)]">/100</span>
                  </p>
                  <p className="text-xs text-[var(--muted)] text-right">
                    {goal.targetDate ? `by ${new Date(goal.targetDate).toLocaleDateString()}` : "Someday goal"}
                    <br />
                    best-effort estimate
                  </p>
                </div>
```

Add a coverage/gate sub-line immediately after the closing `</div>` of the score row (after line 137). **Do not change the existing score row — add below it:**

```tsx
                {/* REQ-006: coverage + open-gate hint */}
                <p className="text-xs text-[var(--muted)] mb-2">
                  {snapshot.coverage.tested}/{snapshot.coverage.total} verified
                  {snapshot.openGateCount > 0
                    ? ` · ${snapshot.openGateCount} gate${snapshot.openGateCount === 1 ? "" : "s"} left`
                    : ""}
                </p>
```

This renders immediately above the chart (or the "Trend appears once…" placeholder). The `text-xs text-[var(--muted)]` tokens match the existing hint line at lines 153–155 (`{snapshot.missing.length} target…`). Mobile-safe at 390px — the line is compact enough to never wrap past a single line in normal data ranges (`"4/8 verified · 2 gates left"` is ~30 chars).

**Also update the existing `missing` hint line** (lines 151–155) — its wording says "have no data yet." The semantics are still correct (missing[] = targets with no data), but since coverage now says the same thing more precisely, the missing hint is still useful as a prompt to log. No text change required; it is additive with the coverage line.

**No changes to** `src/app/stats/page.tsx` or `src/app/goals/[id]/page.tsx` — these pages are out of REQ-006 scope. They will automatically display the new (lower/capped) score via the unchanged `.score` field.

---

## 9. Work Streams and Order

### Recommendation: ONE developer agent, sequential, all 6 REQs

**Rationale:** The total change is small and highly additive. There is zero file overlap between Stream A and Stream B. A single agent finishing A→B in sequence avoids any merge coordination overhead, shared-branch risk, or type drift between an "A commit" and a "B commit reading a stale type." The snapshot contract is frozen in this blueprint, so Stream B can begin the moment Stream A's files are saved.

**Sequence:**

```
REQ-001 → REQ-002 → REQ-004 → REQ-003 → REQ-005 → REQ-006
(metrics) (engine)  (rarity)  (tools)   (recap)   (progress)
```

- REQ-001 first: type + zod must exist before the engine can read `target.gating`.
- REQ-002 second: engine produces `ReadinessSnapshot v2`; `GATE_CEILING` exported.
- REQ-004 third: rarity comment only — cheap, no risk.
- REQ-003 fourth: description update + description string for `update_goal_targets`.
- REQ-005: recap reads `snapshot.coverage` + `snapshot.openGateCount`.
- REQ-006: progress page reads the same fields.

**If a second agent is used:** Stream A (REQ-001 through REQ-004) is completely self-contained. Stream B (REQ-005, REQ-006) has a hard dependency on Stream A's `ReadinessSnapshot` v2 type. Never run them in parallel — B's TypeScript would fail if A's changes are not present.

### Shared-file concerns
None. The six files touched are:
- Stream A exclusive: `metrics-registry.ts`, `readiness.ts`, `tools.ts`, `rarity-core.ts`
- Stream B exclusive: `recap.ts`, `recap-card.tsx`, `progress/page.tsx`

---

## 10. Critical Decisions and Back-compat

### Scores will drop on deploy — EXPECTED and correct

All active goals' readiness scores will fall the moment this deploys. Previously: a goal with 4/8 targets tested scored as if there were only 4 targets (usable subset). Now: all 8 targets are in the denominator (untested = 0 progress). For the live Mt. Elbert goal, if the two hike gates are also uncleaned (likely early in the program), the score is further capped at 80. This is the feature working, not a regression. The coach must proactively communicate: "Your score dropped because the engine is now honest about untested metrics and gate status."

### `missing[]` semantics change (JSDoc only — no behavioral change for callers)

`missing[]` previously meant "excluded from overall score." It now means "no data yet; counted as 0 in the score." The array contents are identical (same condition: `progress === null`). Only the JSDoc on `ReadinessSnapshot.missing` changes. No consumer breaks.

### Back-compat confirmed

| Consumer | Impact | Change required |
|----------|--------|-----------------|
| `computeReadinessSeries` | reads `snap.score` only | None |
| `ReadinessBreakdown` component | renders `b.progress` (null → "—") | None |
| `ReadinessChart` | reads `{ date, score }` series | None |
| `recap.ts` lines 259–260 | `snapshot.missing.length === targets.length ? null : snapshot.score` — condition still valid | None (REQ-005 adds fields, doesn't remove) |
| `progress/page.tsx` score display | reads `snapshot.score` | None (REQ-006 adds a line) |
| `goals/[id]/page.tsx` | reads `readiness.score`, `readiness.missing.length` | None |
| `stats/page.tsx` | reads `snapshot.score` | None |
| `tools.ts` spread `...snap` | auto-picks up new fields | None |

---

## 11. Summary (~10 lines)

**Frozen snapshot fields added:** `rawScore: number`, `ceiling: number` (80 or 100), `coverage: { tested: number; total: number }`, `gates: ReadinessGate[]` (label + progress + cleared per gating target), `openGateCount: number`. Existing `.score`, `.breakdown`, `.missing` are unchanged in shape and meaning except the JSDoc on `missing` (no longer "excluded from score" — update to "counted as 0 in the score").

**Gate edits to `MT_ELBERT_DEFAULT_TARGETS`:** add `gating: true` to `hike:prep_completion` (weight 0.30) and `hike:max_elevation_single` (weight 0.20). No other targets. These represent the two things no gym work can substitute for: repeated high-elevation hike exposure and a proven single-day big-gain dress rehearsal.

**MCP auto-flow:** `compute_readiness` already spreads `...snap`, so all new fields flow through to the coach immediately. Description update only. `update_goal_targets` and `create_goal` both validate via `z.array(GoalTargetSchema)` — adding `gating: z.boolean().optional()` to the schema is the only change needed; no per-tool modification.

**rarity-core.ts:** no logic change. Add one comment noting `gating` is a readiness-only concept. The intentional divergence (rarity excludes untested via `verdict:"unknown"`; readiness includes them at 0) remains correct — the engines answer different questions.

**One developer agent, sequential A→B.** No file overlap. Score drop on deploy is expected and correct behavior.
