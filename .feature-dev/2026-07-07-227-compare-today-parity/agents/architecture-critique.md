# Architecture Critique — #227 compare-today-parity

Verified against: `src/lib/compare.ts`, `src/lib/compare.test.ts`, `src/lib/readiness.ts`,
`src/lib/goal-targets.ts`, `src/lib/calendar-core.ts`, `src/lib/mcp/tools.ts:1227-1244`,
`src/components/compare/HeroSpan.tsx`, `docs/prds/PRD-227-compare-today-parity.md`,
`.feature-dev/2026-07-07-227-compare-today-parity/agents/research-output.md`,
`docs/project-gotchas.md` §B, plus a runtime check (`tsx`) confirming the idempotency
claim below against the actual `calendar-core.ts` code.

## Critical

### C1 — REQ-001's diff is a functional no-op; the "bug" it fixes does not exist in the computed output (empirically confirmed)

`goal-targets.ts:44` — `resolveMetricValue` starts with `const cutoff = endOfDay(asOf);`
**before any of its metric branches** (`weightLb`, `baseline:*`, `hike:*`, `workout:count`,
`log:*`, `exercise:*` — every branch from line 47 onward reads `cutoff`, never `asOf`
directly). `readiness.ts:206` does the same for the hike-prep compound gate:
`resolveHikePrepGateExtras(goalId, endOfDay(asOf))`. `resolveMetricStart` doesn't take
`asOf` at all. So **every** consumer of `asOf` inside `computeReadiness` re-wraps it in
`endOfDay` before it touches a query.

`calendar-core.ts:98-101`:
```ts
export function endOfDay(d: Date): Date {
  const { year, month, day } = userParts(d);
  return userTzWallClockToUTC(year, month, day, 23, 59, 59, 999);
}
```
`endOfDay` reads only the USER_TZ calendar day of its input and discards time-of-day —
idempotent per day: for any `x` on the same calendar day, `endOfDay(x)` returns the same
instant regardless of `x`'s time component. **Ran this live** (`tsx`, real
`calendar-core.ts`, `USER_TZ=America/Denver`, today = 2026-07-09):

```
now:                     2026-07-09T21:49:12.297Z
cutB (endOfDay(today)):  2026-07-10T05:59:59.999Z
endOfDay(now):           2026-07-10T05:59:59.999Z
endOfDay(cutB):          2026-07-10T05:59:59.999Z
rewrapNow === rewrapCutB: true
rewrapNow === cutB:       true
```

Consequence: for a today-ending comparison, `cutB = endOfDay(parseDateKey(dateB))` and
`asOfB = now` are both on today's calendar day, and every place `computeReadiness`
actually uses the value it re-derives the *identical* instant. **Passing `now` vs `cutB`
into `computeReadiness` for a same-day `asOf` produces byte-identical
`score`/`rawScore`/`breakdown`/`gates`/`coverage`/`missing` — there is no observable
difference.**

The PRD's own Discovery Notes (§11.1) already caught this exact idempotency for the hike
gate specifically ("readiness.ts:206 hike-gate re-wraps asOf in endOfDay internally (same
on /progress — not a parity risk)") but did not generalize it: the identical re-wrap
happens unconditionally for the *primary* value resolution at `goal-targets.ts:44`, for
every metric type, not just the hike gate. That's the whole function, not one branch of
it.

**Practical implication:** PRD §1.1's claimed divergence between `/compare` (cutB) and
`/progress` (now) for a today-ending comparison does not exist in the computed output
today — the code currently already satisfies PRD §1.3's "byte-identical to /progress"
success criterion, *before* any change. Acceptance criterion #6 ("MCP smoke
before/after... showing divergence→parity for b=today") will fail to show any before/after
divergence, because there isn't one to capture.

**Required before implementation:** re-verify PRD §1.1's premise against real seeded data
(not just source reading) — e.g. `compute_readiness` vs `compare_dates {a: <30d ago>, b:
today}` for the same goal, today, right now. Two outcomes:
  (a) They already match → this story is a no-op verification + pure
      documentation/microcopy change. Re-scope the PRD's problem statement and drop or
      rewrite acceptance criterion #6 — there's no divergence to demonstrate. The `asOf`
      code diff in `compare.ts` can still land (it's harmless and arguably clearer
      intent), but it is not *fixing* anything.
  (b) They actually diverge → the real gap is somewhere the source reading didn't find
      (not inside `resolveMetricValue`/`resolveHikePrepGateExtras`, both fully audited
      above) — re-audit for it before implementing the prescribed diff, since that diff
      targets the wrong mechanism.

This is the single most important thing to resolve before code is written.

## Concerns

### C2 — Multi-goal call-order fragility is real, correctly avoided by the blueprint, but undocumented as a landmine

Is `mock.calls[0]` = B-side / `[1]` = A-side actually guaranteed? Yes, for a single goal:
`Promise.all([computeReadiness(...B...), createdAfterA ? ... : computeReadiness(...A...)])`
(`compare.ts:103-106`) evaluates its array elements left-to-right synchronously;
`computeReadiness` is invoked (and the mock records the call in `mock.calls`) at that
synchronous call point, regardless of the function being async and its promise resolving
later. Invocation order — and therefore mock-call-index order — is deterministic and
matches source order.

But `buildGoalSections` builds this per goal via `goals.map(async (g) => {...})`
(`compare.ts:91-92`). `Array.prototype.map` invokes each element's callback synchronously
up to its first `await`, then advances to the next element before that promise resolves.
Each goal's first `await` is the `Promise.all([...])` at :103-106. So for N goals, calls
land in **contiguous per-goal blocks in goal-array order**: goal0-B, goal0-A, goal1-B,
goal1-A, ... (or just goal0-B, goal1-B, ... if every goal has `createdAfterA===true`).
Deterministic, but not simply "calls[0]=B, calls[1]=A" once there's more than one goal,
and the block width shifts per-goal (1 vs 2) depending on that goal's own
`createdAfterA`.

The blueprint's mitigation (`GOAL_FIXTURE` = exactly one goal) is correct and avoids the
trap. But nothing in the test file enforces "stay single-goal" — a future contributor
extending `GOAL_FIXTURE` to two goals for something unrelated would silently invalidate
the `calls[0]`/`calls[1]` assertions without an obvious link back to *why* they broke.

**Fix:** add a comment directly above `GOAL_FIXTURE`: `// single-goal ONLY — mock.calls[0]/[1]
B/A indexing assumes exactly one goal fires Promise.all per computeComparison() call; a
second goal shifts indices into per-goal blocks`. Trivial, prevents a confusing future
test failure.

### C3 — sameDay-today "goal born mid-request" wrinkle is real but doubly inert

The scenario: `dateA === dateB === todayKey`, so `asOfA = asOfB = now`, `cutA = cutB =
endOfDay(today)`. `createdAfterA = g.createdAt > cutA` (`compare.ts:94`, unchanged by this
PRD). Could a goal exist with `now < g.createdAt <= cutA`, i.e. `createdAfterA===false`
(A-side readiness computed) even though the goal's `createdAt` is *after* the `now`
captured for `asOfA`?

Only via a genuine race: `now = new Date()` is captured at the top of
`computeComparison` (`compare.ts:36`), before `db.goal.findMany()` at :47 executes. If a
*different* concurrent request creates a new goal in that network-roundtrip window, its
`createdAt` could land microseconds after the captured `now` but still same-day, so
`createdAfterA` (which compares against `cutA`, end-of-day, not `now`) stays `false` and
the A-side readiness call fires for a goal that "didn't exist yet" at the captured
`asOfA` instant.

Two things make this a non-issue in practice:
1. Sub-millisecond window, essentially unreachable outside a deliberately racing test.
2. Per **C1**, `resolveMetricValue` re-wraps *any* `asOf` on today's calendar day to the
   same `endOfDay(today)` cutoff — so even in this exact race, the A-side computation
   would be *identical* whether `asOfA` is the pre-race `now` or the goal's own
   `createdAt` instant. The "computed for a goal that didn't exist yet" framing doesn't
   actually change the query bound.

`/progress` has no analogous concept at all — no `createdAfterA` gate, it just computes
readiness for whichever goals are currently active with whatever data exists (a
brand-new goal reads as `missing`/`progress: null` naturally). This is pre-existing
`compare.ts` design (unchanged by REQ-001), not a new parity risk. **Verdict: theoretical
noise, not blocking.**

### C4 — Microcopy asserts a distinction that C1 says users can never observe

PRD §5.1 / blueprint §4 copy: "As of end of day — today is live." Per C1 (empirically
confirmed), a same-day comparison's readiness number is **identical** at 8am and at
11:58pm — there is no "live" behavior a user could ever notice, because
`resolveMetricValue`'s wrap already flattens any instant on today to `endOfDay(today)`.
Shipping this copy while C1 is unresolved risks asserting a real-sounding technical
distinction that the code doesn't actually implement (harmless, but fix the premise
first — see C1's required pre-step).

## Suggestions

### S1 — Test mock shape is compatible; note it's argument-capture only

`READINESS_FIXTURE` (`compare.test.ts:50-55`) carries a `weightLb` target in
`breakdown`, matching the blueprint's proposed `GOAL_FIXTURE`'s single `weightLb`
target — so `bA = snapshotA?.breakdown.find(b => b.target.metric === t.metric)`
(`compare.ts:121`) finds a real match, and the new tests do exercise the per-target
breakdown path (`compare.ts:120-131`), not just the top-level `.score`. No bypass.

One nuance worth a comment in the test file: `mockComputeReadiness.mockResolvedValue`
applies uniformly to every call, so in the new tests `snapshotA` and `snapshotB` resolve
to the *same* fixture object (`valueA === valueB`). Fine — these two tests exist to
capture the `asOf` **argument**, not to diff readiness output (already covered elsewhere)
— but flag it explicitly so a future reader doesn't mistake it for an output-parity
assertion.

### S2 — `generatedAt` left independent: agree, low stakes either way

Blueprint's call to leave `generatedAt: new Date().toISOString()` (`compare.ts:71`) on
its own read rather than folding into the shared `now` is reasonable and explicitly
flagged as a judgment call. REQ-001 never mentions this field; folding it in would be
equally defensible but isn't required. No action needed.

### S3 — Microcopy placement front-loads a technical caveat before the emotional beat

The blueprint inserts the new `<p>` between the `<h1>` date span and the existing
"`{spanDays} days of showing up.`" subtitle (`HeroSpan.tsx:62-66`). Matches PRD §5.1's
mockup exactly, so it's not wrong, but the first line under the hero headline becomes a
technical caveat rather than the emotional payoff line. Worth a designer's second glance
before shipping, not a blocker.

### S4 — No scope creep found

Checked the diff plan against the 4 REQs: `compare.ts` (readiness call sites only),
`compare.test.ts` (two new cases), `tools.ts:1227-1244` (description text only, handler
untouched — confirmed at `tools.ts:1242-1243`, pure pass-through), `HeroSpan.tsx` (one
static `<p>`, confirmed server-safe, no `"use client"`, confirmed via file header
comment and no new props). No other builder (`buildStrengthEntries`,
`buildBaselineEntries`, `buildBodyEntries`, `buildCountersSection`, `buildNutritionSection`)
touches `cutA`/`cutB` differently than before. The blueprint's own non-goals grep
checklist (§5) is a good verification aid — actually run it post-diff as stated.

### Axis 4 (single-`now`-read refactor) — confirmed non-issue

`todayKey = toDateKey(new Date())` is already the first executable line in
`computeComparison` (`compare.ts:36`), before any `await`. Relocating the `new Date()`
read one line earlier as `const now = new Date()` changes nothing — same synchronous
instant, no `await` crosses it either before or after the move.

## Verdict: REVISE

Not because the mechanical diff plan is unsound — §1 (compare.ts diff), §3 (tools.ts
description), and §4 (HeroSpan microcopy) are all faithful to the PRD and verified
against real line numbers. The block is **C1**, now empirically confirmed: `now` and
`endOfDay(today)`, passed into `computeReadiness` for a same-day comparison, produce
byte-identical output, because `goal-targets.ts:44` and `readiness.ts:206` both
unconditionally re-wrap `asOf` in the same idempotent `endOfDay` before any query runs.
Re-verify the PRD's problem statement against real seeded data before implementing —
either re-scope this story as a no-op/docs-only change and drop acceptance criterion #6,
or find the actual parity gap (which is not where the current diff plan targets it).
