# Architecture Blueprint — #227 compare-today-parity

## 1. `src/lib/compare.ts` diff plan

Confirmed: inside `buildGoalSections`, `cutA`/`cutB` are consumed in exactly two places — `createdAfterA` (:94, stays on `cutA`) and the two `computeReadiness` calls (:103-106, switch to `asOf*`). Nothing else. No surprise consumer.

```ts
export async function computeComparison(aKeyRaw: string, bKeyRaw: string): Promise<ComparisonResult> {
  const now = new Date();
  const todayKey = toDateKey(now);
  const { dateA, dateB, swapped, sameDay, clampedToToday, spanDays } =
    normalizeDateRange(aKeyRaw, bKeyRaw, todayKey);
  const cutA = endOfDay(parseDateKey(dateA));
  const cutB = endOfDay(parseDateKey(dateB));
  const asOfA = dateA === todayKey ? now : cutA;
  const asOfB = dateB === todayKey ? now : cutB;
  ...
      buildGoalSections(goals, cutA, cutB, asOfA, asOfB),   // was: (goals, cutA, cutB)
  ...
```

`buildGoalSections` signature (house style: positional Date params, non-optional, matches `cutA`/`cutB` naming):

```ts
async function buildGoalSections(
  goals: Array<{ id: string; objective: string; kind: string; createdAt: Date; targets: unknown }>,
  cutA: Date, cutB: Date, asOfA: Date, asOfB: Date,
): Promise<GoalCompareSection[]> {
```

Inside, only the readiness calls change (`createdAfterA` at :94 is untouched):

```ts
      const createdAfterA = g.createdAt > cutA;   // UNCHANGED
      ...
      const [snapshotB, snapshotA] = await Promise.all([
        computeReadiness(targets, asOfB, g.id),          // was cutB
        createdAfterA ? Promise.resolve(null) : computeReadiness(targets, asOfA, g.id),  // was cutA
      ]);
```

**`generatedAt` (:71) is left untouched** — stays its own `new Date().toISOString()`, captured after all Promise.all work completes. REQ-001 only prescribes reusing `now` for `todayKey`/asOf derivation; folding `generatedAt` into the shared pre-fetch `now` would silently shift its meaning (start-of-request → completion instant) for a field no requirement mentions. Flagged, not done.

Same-day case: when `dateA === dateB === todayKey`, `asOfA` and `asOfB` both evaluate to the **same `now` reference**, so snapshotA/snapshotB compute from an identical instant — deltas are exactly zero, matching PRD §4.5/§6, with no extra branching needed.

No other builder (`buildStrengthEntries`, `buildBaselineEntries`, `buildBodyEntries`, `buildCountersSection`, `buildNutritionSection`) or `computeHasAnyDataA` changes — all keep `cutA`/`cutB` only, per PRD §3.1/§4.5.

## 2. `src/lib/compare.test.ts` test plan

Add import: `import { dateKey as toDateKey, parseDateKey, endOfDay } from "@/lib/calendar-core";`

**Flake-approach decision: bound-only assertion (`asOf ∈ [before, after]`); no `vi.setSystemTime`, no extra `!== endOfDay` inequality.** The suite has zero fake-timer usage (research §6) and REQ-002 says "no fake timers needed." A `[before, after]` window from real `new Date()` calls bracketing the `computeComparison` call is already non-flaky by construction — a pre-fix `cutB` (`endOfDay`, 23:59:59.999) can only land inside that millisecond-wide window during the literal last ~1ms of a day, and even then the bound still correctly proves "value captured live at call time" — the only thing that needs proving. Adding a `!== endOfDay` inequality is redundant (implied by the bound under all practical conditions) and is the *only* source of the theoretical midnight coincidence the prompt raised — dropped for zero incremental proof value.

Mock-call indexing: `Promise.all([computeReadiness(targets, asOfB, ...), createdAfterA ? ... : computeReadiness(targets, asOfA, ...)])` builds the array eagerly left-to-right, so **`mock.calls[0]` is always B-side, `[1]` is A-side** (when not `createdAfterA`). Share one goal fixture (old `createdAt`) across both new tests so both calls fire and indices stay unambiguous. Existing `READINESS_FIXTURE` already satisfies the entry-builder (:108-115) — no new fixture shape needed.

```ts
const GOAL_FIXTURE = [{
  id: "goal-1", objective: "Summit Mt. Elbert", kind: "fitness",
  createdAt: new Date("2020-01-01"),
  targets: [{ metric: "weightLb", label: "Body weight", units: "lb", direction: "decrease", target: 155, weight: 1 }],
}];

function setupReadinessCallTest() {
  mockGetDb.mockResolvedValue(mkScopedDb({ goal: { findMany: vi.fn().mockResolvedValue(GOAL_FIXTURE) } }));
  mockComputeReadiness.mockReset();
  mockComputeReadiness.mockResolvedValue(READINESS_FIXTURE);
  mockComputeGameState.mockResolvedValue(EMPTY_GAME_STATE_FIXTURE);
  mockFindManyWorkoutExercise.mockResolvedValue([]);
}

it("today-live: dateB=today gets a live asOf; dateA=past keeps endOfDay", async () => {
  setupReadinessCallTest();
  const todayKey = toDateKey(new Date());
  const before = new Date();
  const result = await computeComparison("2026-03-01", todayKey);
  const after = new Date();

  expect(result.dateB).toBe(todayKey);
  const calls = mockComputeReadiness.mock.calls;
  expect(calls).toHaveLength(2);
  const asOfB = calls[0][1] as Date;
  const asOfA = calls[1][1] as Date;
  expect(asOfB.getTime()).toBeGreaterThanOrEqual(before.getTime());
  expect(asOfB.getTime()).toBeLessThanOrEqual(after.getTime());
  expect(asOfA.getTime()).toBe(endOfDay(parseDateKey("2026-03-01")).getTime());
});

it("past-past: both sides get exact endOfDay, neither is live", async () => {
  setupReadinessCallTest();
  const result = await computeComparison("2026-03-01", "2026-06-20");
  const calls = mockComputeReadiness.mock.calls;
  expect(calls).toHaveLength(2);
  expect((calls[0][1] as Date).getTime()).toBe(endOfDay(parseDateKey("2026-06-20")).getTime());
  expect((calls[1][1] as Date).getTime()).toBe(endOfDay(parseDateKey("2026-03-01")).getTime());
  expect(result.dateB).not.toBe(toDateKey(new Date()));
});
```

**Fail-before proof**: pre-fix, `computeReadiness` always receives `cutB` (`endOfDay`) for the B-side — a fixed 23:59:59.999 instant that falls outside the millisecond-wide `[before, after]` window under all normal conditions — so the first test's bound assertions fail on stashed pre-fix `compare.ts` and pass post-fix. Orchestrator captures this run per PRD acceptance #2.

**Not adding** a separate `sameDay` test: not one of REQ-002's two prescribed cases, and the zero-delta outcome is a direct consequence of the single-`now`-reuse design (§1), not new branchy logic — flagging for QA to confirm acceptable; trivial to add (`asOfA === asOfB` when dateA=dateB=today) if they want explicit coverage.

## 3. `src/lib/mcp/tools.ts` description edit (`compare_dates`, :1227-1244)

Handler (:1242-1243) untouched — `computeComparison` pass-through inherits the fix. Description gains one trailing sentence, same voice as the existing copy:

```ts
description:
  "Side-by-side snapshot of every tracked metric as of two dates — latest-known value ≤ end of each day, NOT what happened on that day. " +
  "Covers per-goal targets + readiness, strength PRs, baseline tests, body/wearable metrics, consistency counters between the dates " +
  "(workouts, hikes, XP/level), and trailing-7-day nutrition averages. Use for 'how far have I come since X', " +
  "'compare today vs program start', 'progress since goal creation'. Dates auto-normalize (swapped if b < a, clamped to today). " +
  "b defaults to today. Exception: when a compared date equals today, that date's goal readiness uses the live current instant " +
  "(matching compute_readiness / get_today_plan) instead of end-of-day — every other section for that date still uses end-of-day.",
```

## 4. Microcopy placement — `src/components/compare/HeroSpan.tsx`

`HeroSpan` (imported into `src/app/compare/page.tsx:15`) renders the date span — the hero container. Insert a new always-rendered `<p>` right after the `<h1>` date-span block, before the `spanDays` subtitle, matching the sibling conditional lines' idiom (`swapped`/`sameDay`/`clampedToToday`: `mt-1 text-xs text-[var(--muted)]`):

```tsx
      <h1 className="font-[family-name:var(--font-display)] text-4xl leading-[1.05] tracking-tight">
        {formatHeroDate(dateA)} → {formatHeroDate(dateB)}{" "}
        <span className="text-[var(--muted)]">· {spanDays} days</span>
      </h1>
      <p className="mt-1 text-xs text-[var(--muted)]">As of end of day — today is live.</p>
      <p className="mt-2 text-[15px] text-[var(--muted)]">{spanDays} days of showing up.</p>
```

Static copy, no props, no loading/empty variant (PRD §5.1); existing `--muted` token, no hardcoded color. Verify no wrap collision with the `swapped`/`sameDay`/`clampedToToday` lines at 390px (all short single-line, same class — low risk).

## 5. Non-goals guard — greps for QA

```sh
git diff --stat                                                    # exactly: compare.ts, compare.test.ts, tools.ts, HeroSpan.tsx
git diff --stat -- src/lib/calendar.ts src/lib/calendar-core.ts    # empty — no calendar helper changes
git diff src/lib/compare.ts | grep -E '^[+-].*function build(Strength|Baseline|Body|Counters|Nutrition)'  # no signature changes
git diff src/lib/compare.ts | grep -E '^[+-]' | grep -v 'now\|asOf\|todayKey'   # near-empty besides buildGoalSections lines
git diff src/lib/mcp/tools.ts | grep -B2 -A2 'compute_readiness'   # no diff lines in that tool's block (:1022-1047)
git diff src/lib/mcp/tools.ts | grep -E '^[+-]' | grep -v 'description:\|"'    # confirms handler/inputSchema unchanged
```

## 6. Surprises vs. PRD

None — `buildGoalSections`'s only `cutA`/`cutB` consumers are `createdAfterA` and the two readiness calls, exactly as PRD §3.1.1/§4.5 assumes. One judgment call beyond the literal REQ text: leaving `generatedAt` (:71) on its own independent `new Date()` rather than folding it into the shared `now` — flagged in §1, not a PRD contradiction, just an unspecified point resolved conservatively (minimal diff, no semantic drift on a field REQ-001 never mentions).
