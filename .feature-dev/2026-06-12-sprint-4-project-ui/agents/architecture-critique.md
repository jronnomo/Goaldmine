# Architecture Critique — Sprint 4: Goal-Type-Aware Project UI

**Critic**: Devil's Advocate Agent (Sonnet)
**Date**: 2026-06-12
**Target**: `.feature-dev/2026-06-12-sprint-4-project-ui/agents/architecture-blueprint.md`
**Sources verified against real code**: All 13 source files listed in the attack brief.

---

## Verdict: NEEDS REVISION

Two issues must be fixed before coding begins. Everything else can be caught during implementation or QA smoke, but the two below will silently ship wrong behavior.

---

## Critical Issues

### CRIT-1 — None

No single issue fully blocks ship on its own, but HIGH-1 and HIGH-2 together constitute a "needs revision" gate.

---

## High-Severity Issues

### HIGH-1 — `monthLabel` USER_TZ bug in ProjectPlanView (will show wrong month)

**What**: Blueprint §3.3 constructs the month heading with:
```ts
const monthLabel = (groupKey: string): string => {
  const [y, m] = groupKey.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: USER_TZ,
  });
};
```

**Why this breaks**: `new Date(year, month-1, 1)` creates a date at LOCAL timezone midnight. On Vercel (UTC runtime), this is UTC midnight. When formatted with `timeZone: "America/Denver"` (MDT = UTC-6), June 1 at 00:00 UTC is May 31 at 18:00 MDT. `toLocaleString` formats the Denver wall-clock time, so `monthLabel("2026-06")` returns `"May 2026"` instead of `"June 2026"`. Every month heading in ProjectPlanView is off by one month.

**Verified**: `calendar.ts:USER_TZ = "America/Denver"`, `dateKey()` via `userParts` is UTC-aware but `new Date(y, m-1, 1)` is NOT. The same pattern would fail for any month starting near UTC midnight.

**How to fix**: Use a mid-month UTC instant to sidestep the boundary entirely:
```ts
const d = new Date(Date.UTC(Number(y), Number(m) - 1, 15)); // mid-month, safe
return d.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: USER_TZ });
```
Or `parseDateKey(groupKey + "-15")` (imports from `@/lib/calendar`).

**Severity**: HIGH — all plan page month headings are wrong for every user in a negative-UTC timezone.

---

### HIGH-2 — Bullseye in ProjectTodayView is binary (filled/hollow), not progressive as UXR specifies

**What**: Blueprint §3.2 wires `TodayCelebration` with:
```tsx
<TodayCelebration
  completed={allDone}          // boolean: only filled or hollow
  dateKey={todayDateKey}
  storageKey={celebStorageKey}
/>
```

`TodayCelebration` (verified: `src/components/TodayCelebration.tsx:38`) passes `filled={completed}` to `Bullseye`. When 1 of 5 items is done, `allDone=false` → hollow Bullseye. When all 5 are done, `allDone=true` → fully filled.

**Why this is wrong**: PRD §5.1 (UXR-normative): "live `Bullseye` at `progress = doneToday/totalToday`". The blueprint computes `const progress = total === 0 ? 0 : doneToday / total;` but never passes it to the Bullseye. The UXR requires partial rings at intermediate states (1/3 done → ~33%, 2 rings at size 28). The blueprint delivers binary hollow/filled.

**Verified**: `Bullseye.tsx` fully supports `progress: number` prop (verified lines 135–142). `progressToRings(28, 0.33)` → `Math.max(1, Math.ceil(0.33 * 4)) = 2` rings out of 4. The component works correctly when given progress; it just isn't being given progress.

**How to fix**: Either:

Option A (simplest): Modify `TodayCelebration` to accept `progress?: number` and pass it through to Bullseye when defined. The pop `useEffect` logic is unchanged (fires when `completed`).

Option B (server/client split): Render `<Bullseye progress={progress} size={28} aria-label={...} />` directly (server-renderable, no hydration concern) and separately render a thin client island `<ProgressPopIsland completed={allDone} storageKey={celebStorageKey} dateKey={todayDateKey} />` that handles only the pop animation. This cleanly separates the visual from the side-effect.

The pop must still fire only when `allDone===true` (all items done), not at arbitrary progress. The aria-label should be `${doneToday} of ${total} done today` when total > 0.

**Edge case confirmed**: `total === 0` → `progress = 0` → hollow Bullseye (`progressToRings(28, 0) = 0`), matches UXR "hollow Bullseye + empty state copy". No division-by-zero: the guard `total === 0 ? 0 : ...` is present in the blueprint; `Bullseye` with `progress={0}` renders hollow. ✓

**Severity**: HIGH — ships a visually incorrect Bullseye that contradicts the normative UXR spec.

---

## Medium Issues

### MED-1 — Calendar fitness path gains a silent waterfall step

**What**: Blueprint §2.2 (CD-7) restructures `getCalendarMonth` into two sequential phases: Phase 1 fetches goal, then Phase 2 runs everything else in parallel. The blueprint correctly acknowledges "an acceptable trade-off" but the data flow table in §6.2 states:

> "Fitness (new): 1 (getActiveProgram) + 1 (goal prefetch) + 5-item Promise.all [...] | **3** sequential steps"

versus:

> "Fitness (old): 1 (getActiveProgram) + 5-item Promise.all [...] | **2** sequential steps"

This is a real regression on the fitness calendar path. Every calendar page view — the most frequently used surface — now has an extra sequential DB round-trip before any data returns.

**Why it is architecturally unavoidable**: The ScheduledItem query must be gated on `goal.kind === 'project'`. `goal` is resolved in the same Promise.all in the old code; you cannot gate on a value that hasn't resolved yet. The research output (§3, "slot into the existing Promise.all as a 6th item. Gate it: goal?.kind === 'project'") is wrong — this gating is structurally impossible in a single Promise.all. The blueprint's 2-phase approach is the correct solution.

**How to minimize**: The goal fetch is a single-row indexed query (`where: { isFocus: true }`). In practice the waterfall adds only a fast `SELECT` before the rest of the queries begin. The absolute latency delta is small. However, the blueprint's query count table should not describe this as "zero extra queries for fitness" when it introduces a new sequential step. Be honest in docs.

**Risk if left as-is**: Accepted architectural trade-off, but document accurately. The fitness calendar is marginally slower on all page views.

---

### MED-2 — Blueprint wording self-contradiction for Dev A (lines 32–255)

**What**: Blueprint §5 ("Fitness Byte-Identity Strategy") says:

> "Lines 33–128 (derived locals, Promise.all, all derived consts) | MUST NOT TOUCH"

But blueprint §2.1 says:

> "REPLACE line 32 only (the getTodayContext call): add ! non-null assertion"

The "MUST NOT TOUCH from line 32" and "REPLACE line 32" are internally contradictory. A developer reading only §5 would be told to not touch line 32, then confused by §2.1.

**How to fix**: §5 table row for line 32 should read "ADD `!` non-null assertion" not "MUST NOT TOUCH". Add a note: "Only the `program` → `program!` token changes at line 32; the rest of the expression and all lines 33–255 are byte-identical." Consider adding the git diff verification command that's mentioned at the end of §5 to the implementation order checklist.

---

## Low Issues

### LOW-1 — UrgencyChip prefixes "!" on both warning and danger cases

**What**: Blueprint §3.2 (corrected UrgencyChip variant) uses:
```tsx
const label = isDanger ? `! Overdue ${Math.abs(days)}d` : `! ${days}d`;
```

A warning chip (e.g., 10 days remaining) renders "! 10d". The "!" prefix is an alarm indicator that should appear only when overdue. A chip reading "! 10d" is confusing — 10 days remaining is not an emergency.

**How to fix**:
```tsx
const label = isDanger ? `! Overdue ${Math.abs(days)}d` : `${days}d`;
```
The visual distinction is already carried by the color (warning vs. danger token). The `!` should be danger-only.

---

### LOW-2 — `Card` `data-testid` prop shown in spec code but blocked by component

**What**: Blueprint §3.2 component spec shows `<Card data-testid="mrr-progress-card">`. A separate note at the bottom of §3.2 says "Card component does not accept data-testid." These two are contradictory within the blueprint.

**Risk**: Dev A sees the spec code, writes `<Card data-testid="mrr-progress-card">`, it silently doesn't work (TypeScript may accept it via prop spread or raise a type error). QA testids then fail to resolve.

**How to fix**: Remove `data-testid` from the Card call-site in the spec code and replace with the prescribed workaround:
```tsx
<div data-testid="mrr-progress-card">
  <Card>
    ...
  </Card>
</div>
```
Apply consistently to every Card and CollapsibleCard testid site in the spec.

---

### LOW-3 — Next-milestone date semantics inconsistency between two components

**What**: 
- `ProjectTodayView` "Next milestone" query uses `date: { gte: addDays(todayStart, 1) }` — excludes today.
- `MilestoneBurnDown` nextMilestone finder uses `startOfDay(m.date) >= startOfDay(now)` — includes today.

A milestone due today appears in the Today checklist AND is shown as "Next:" in MilestoneBurnDown, but NOT in the ProjectTodayView "Next milestone" card (it's hidden because it's today). This is technically consistent with the spec ("next upcoming" means future) but creates a visual oddity: MilestoneBurnDown shows a milestone as "Next" while ProjectTodayView hides it.

**Severity**: Low — acceptable as-is, but document the intent: ProjectTodayView's "next milestone" card is intentionally future-only (today's items are in the checklist). MilestoneBurnDown's "Next:" is "soonest incomplete" including today. Add inline comments to both components.

---

## Design Concerns

### DC-1 — MARKER_CAP fairness: goal-date can be suppressed on milestone days

**What**: Blueprint §2.4 inserts `scheduled-item` between `baseline` and `goal-date` in `markersFor`. MARKER_CAP=3. A cell with `trained` + `scheduled-item` + `baseline` all present uses all 3 focus-marker slots before `goal-date` is pushed. The goal's target date marker is then silently suppressed.

This scenario is unlikely (goal date coincides with a baseline retest AND a scheduled item) but is not impossible for a project goal that also has a fitness plan (if the user runs dual goals). The ordering per UXR-s4-07 is normative (baseline before goal-date), so the ordering is correct. Just note that goal-date has lowest priority among focus markers.

**Recommendation**: Add a comment in `markersFor` explaining priority order:
```ts
// Focus marker priority: trained > hike-completed > hike-planned > override >
//   baseline > scheduled-item > goal-date (goal-date has lowest priority;
//   may be suppressed by MARKER_CAP=3 when higher-priority markers are present).
```

---

### DC-2 — ProjectPlanView fetches ALL ScheduledItems for a goal (no date range)

**What**: Blueprint §3.3 query:
```ts
prisma.scheduledItem.findMany({ where: { goalId: goal.id } })
```

No date filter. All items across all time. For chewgether's planned 3-month launch timeline (30–60 items), this is fine. If a goal accumulates hundreds of items across a long history, this will grow.

**Recommendation**: Not a blocker for this sprint. Add a `// TODO: paginate or date-cap when item count grows beyond 200` comment in the component for future reference.

---

### DC-3 — Fitness truth table edge case should be documented inline

**What**: The new `page.tsx` guard logic:
```tsx
if (!program && focusGoal?.kind !== "project") { return <NoActiveProgram /> }
if (focusGoal?.kind === "project") { return <ProjectTodayView /> }
// program is guaranteed non-null here
const ctx = getTodayContext(program!);
```

The truth table is correct (verified):

| program | focusGoal | First guard | Second guard | Path |
|---------|-----------|-------------|--------------|------|
| null | null | true (returns NoActiveProgram) | — | AC-C ✓ |
| null | fitness | true (returns NoActiveProgram) | — | AC-C ✓ |
| null | project | false | true (returns ProjectTodayView) | AC-A ✓ |
| exists | null | false | false | fitness path, program! safe ✓ |
| exists | fitness | false | false | fitness path, program! safe ✓ |
| exists | project | false | true (returns ProjectTodayView) | AC-A ✓ |

The non-null assertion `program!` is safe in all remaining cases. This is not obvious to reviewers.

**Recommendation**: Add an inline comment after the two guards: `// program is guaranteed non-null at this point: if it were null, one of the two guards above would have returned.`

---

### DC-4 — `TodayCelebration` storageKey change has one subtle dep-array concern

**What**: Blueprint §3.1 adds `storageKey` to the useEffect dependency array:
```tsx
}, [completed, dateKey, storageKey]);
```

`storageKey` is derived from `goal.id` + `todayDateKey` — both stable across a page's lifecycle. The dep array entry is technically correct (React lint rules require it) and introduces no behavioral issue. Just noting for completeness.

---

## Missing Requirements

### MIS-1 — ProjectPlanView CollapsibleCard data-testid workaround needs to be explicit in the spec

**What**: Blueprint note on CollapsibleCard: "wrap in `<div data-testid="plan-month-{yyyy-mm}">` rather than passing to CollapsibleCard directly." The component spec (§3.3) code still shows `<CollapsibleCard ... data-testid={...}>` without the wrapper div. Dev C could miss the note.

**How to fix**: Replace the CollapsibleCard call in the spec code with the wrapper pattern explicitly.

---

### MIS-2 — `aria-label` on Bullseye should reflect progress, not binary state

**What**: If HIGH-2 is resolved by adding a `progress` prop, the Bullseye `aria-label` must be updated. The current TodayCelebration hardcodes `aria-label={completed ? "Completed" : "In progress"}`. For progress mode, the correct label is `"${doneToday} of ${total} items done today"` (or "Nothing scheduled today" when total === 0).

**How to fix**: Pass the aria-label as a prop to whatever client island is used for the pop, separate from the Bullseye visual.

---

## Risk Table

| ID | Issue | Severity | Surface | Discoverable at | Blocking |
|----|-------|----------|---------|-----------------|---------|
| HIGH-1 | monthLabel USER_TZ bug: wrong month headings | HIGH | /goals/[id]/plan (project) | Browser smoke | YES — fix before coding |
| HIGH-2 | Bullseye binary instead of progressive | HIGH | Today (project) | Browser smoke | YES — spec deviation |
| MED-1 | Calendar fitness waterfall regression | MEDIUM | Calendar (all) | Perf profiling | NO — accept with docs |
| MED-2 | Blueprint self-contradiction lines 32-255 | MEDIUM | Dev A misread risk | Code review | NO — clarify only |
| LOW-1 | UrgencyChip "!" on non-danger | LOW | Today (project) | Browser smoke | NO |
| LOW-2 | Card data-testid shown in broken spec code | LOW | Dev A implementation | tsc/QA | NO |
| LOW-3 | Next-milestone date inconsistency | LOW | Today + Progress | Code review | NO |
| DC-1 | MARKER_CAP goal-date suppression | DESIGN | Calendar | Edge-case QA | NO |
| DC-2 | ProjectPlanView no date range on query | DESIGN | Plan page | Scale test | NO |
| DC-3 | program! non-null truth table undocumented | DESIGN | page.tsx review | Code review | NO |
| MIS-1 | CollapsibleCard testid wrapper unclear | MISSING | Dev C | QA | NO |
| MIS-2 | aria-label needs progress-aware copy | MISSING | Today (project) | A11y audit | NO |

---

## Verdict: NEEDS REVISION

**Two fixes required before Dev A starts:**

1. **HIGH-1**: In `ProjectPlanView.tsx` spec, replace `new Date(Number(y), Number(m) - 1, 1)` with `new Date(Date.UTC(Number(y), Number(m) - 1, 15))` in `monthLabel`. One-line fix. Otherwise every month heading in the project plan page shows the prior month's name on Vercel.

2. **HIGH-2**: In `ProjectTodayView.tsx` spec, wire `progress={progress}` to the Bullseye (either via TodayCelebration with an added `progress?` prop, or by splitting Bullseye visual and pop animation into separate components). Otherwise the "live progress" Bullseye required by UXR-s4-01 ships as a static filled/hollow indicator.

**Everything else is pre-existing design trade-off documentation or low-risk implementation notes.** After fixing HIGH-1 and HIGH-2, the architecture is structurally sound: the fitness byte-identity strategy is correct, the calendar dedup is proven, the legend kind-awareness is complete, the plan page branch point is correct, and the progress page gating is safe.
