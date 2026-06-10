# Architecture Critique — Multi-goal Phase 1: Cross-goal Awareness

**Reviewer**: Devil's Advocate Agent  
**Date**: 2026-06-10  
**Blueprint**: architecture-blueprint.md (Pass 1 + Pass 2 Corrections)  
**PRD**: docs/prds/PRD-multigoal-phase1-awareness.md  

---

## Critical Issues (Must Fix)

### CRIT-1 — Suspicion A confirmed: `long-endurance` + `baseline-retest` dead zone

**What**: `CROSS_GOAL_RULES.hardCategories` excludes `"long-endurance"`, reasoning that `event-near-long-effort` covers it. But `event-near-long-effort` (kind 3) only examines `target-date` typed events:
```typescript
const targetDateEvents = nonFocusEvents.filter((e) => e.type === "target-date");
```
AND it uses `diff > 0 && diff <= N` (exclusive lower bound), which excludes diff=0.

**Why it matters**: A non-focus goal's **baseline-retest** event landing directly ON a long-endurance day (diff=0) triggers nothing: not `event-on-hard-day` (long-endurance excluded from hardCategories) and not `event-near-long-effort` (only target-date events, diff > 0). This is the exact scenario the tech lead flagged. Example: focus plan long-endurance falls on Saturday; non-focus goal has a 1-mile run retest on that same Saturday. Zero conflicts fire.

**How to fix**: Two options:
- Option A (simpler, recommended): Add `"long-endurance"` to `hardCategories`. The diff=0 case (event ON the day) is cleanly caught by `event-on-hard-day`. Override suppression still applies. `event-near-long-effort` stays as the ±N-day proximity warning for target-date events adjacent to (but not on) the long-effort day.
- Option B: Extend `event-near-long-effort` to include `baseline-retest` events AND change the bounds to `diff >= 0 && diff <= N`. Messier because the same-day case overlaps with `event-on-hard-day`.

**Severity**: Critical — a non-focus goal retest on a long-endurance day is the most likely real-world cross-goal conflict in this training setup and it is silently undetected.

---

### CRIT-2 — Suspicion B confirmed: orderBy-fallback trick at focus-strict sites

**What**: Blueprint §10.5 and §5.1 apply `orderBy: [{ goal: { isFocus: "desc" } }, { updatedAt: "desc" }]` at these sites:
- `plan-lint.ts:221` (`lintActivePlan`)
- `records.ts:197` (new `getBaselineSchedule` wrapper in §3.3)
- `calendar.ts:737` (`getPendingNotesCount`)
- `mcp/tools.ts:913` (`get_pending_notes`)
- `mcp/tools.ts:3826` (`acknowledge_lint_finding`)
- `mcp/tools.ts:3880` (`clear_lint_acknowledgement`)
- `app/baselines/new/page.tsx:18`

**Why it matters**: When the focus goal EXISTS but has no active plan (e.g., the plan was deleted and not yet replaced, or the focus goal is newly created but plan scaffolding failed), the fallback silently picks another goal's plan. Consequences:
- `lintActivePlan` lints the wrong goal's template and emits irrelevant errors
- `getBaselineSchedule` shows another goal's test schedule on the baselines/new page
- `acknowledge_lint_finding` and `clear_lint_acknowledgement` persist acknowledgements against the wrong plan — acknowledgements survive a focus switch and become phantom acks on a different goal
- `get_pending_notes` and `getPendingNotesCount` surface pending notes from the wrong goal's plan context

The fallback is explicitly desired at `getActiveProgram` (transition state, doc'd in PRD §3.1.3) and the Program table path. But at lint/baselines/pending-notes/lint-ack sites, a non-focus fallback is **wrong behavior**, not a graceful degradation.

**How to fix**: At each listed site, use a FOCUS-STRICT query:
```typescript
const plan = await prisma.plan.findFirst({
  where: { active: true, goal: { isFocus: true } },
  orderBy: { updatedAt: "desc" },
});
if (!plan) return /* null / empty / error appropriate for each caller */;
```
Keep the orderBy-fallback only at `getActiveProgram` (which already has documented fallback chain) and nowhere else.

**Severity**: Critical — phantom lint acknowledgements against wrong plans are a data-integrity issue; lint/baselines showing wrong goal is a confusing UX bug. These sites see real use during a focus-switch transition, which is exactly when the bug fires.

---

### CRIT-3 — `key-events-same-week` excludes focus goal's key events

**What**: The conflict kind's event filter:
```typescript
const keyEvents = events.filter(
  (e) =>
    e.goalId !== focusGoalId &&  // ← excludes focus goal entirely
    (e.type === "target-date" || e.type === "baseline-retest"),
);
```
This means the kind only fires when ≥2 **non-focus** goals have key events in the same week.

**Why it matters**: The primary real-world scenario is: focus goal has a retest week (key event) AND the non-focus 5k goal has its race (target-date) in that same week. The current implementation emits ZERO `key-events-same-week` conflicts for this case because only one non-focus goal is involved. This is the scenario the feature is explicitly designed to warn about (PRD US-005). The race might be on a zone2 day (not caught by `event-on-hard-day`) and > ±2 days from long-endurance (not caught by `event-near-long-effort`), leaving it completely silent.

**How to fix**: Include focus-goal key events in the week-scan as the "other side" of the collision check, but only emit the conflict attributed to the non-focus goal:
```typescript
// Include ALL key events (focus + non-focus) in the week grouping
const keyEvents = events.filter(
  (e) => e.type === "target-date" || e.type === "baseline-retest",
);
// ... same bucketing ...
// Only emit conflicts where a non-focus event collides with any other goal's event
for (const event of weekEvents.filter((e) => e.goalId !== focusGoalId)) {
  const collidingGoals = weekEvents.filter((e) => e.goalId !== event.goalId);
  if (collidingGoals.length === 0) continue;
  // emit conflict...
}
```

**Severity**: Critical — the most common cross-goal scenario is precisely focus-retest-week vs non-focus race-week, and it is silently missed.

---

### CRIT-4 — `get_session_brief` `currentWeekConflicts` is a 30-day scope

**What**: Blueprint §6.1 fetches `otherGoalsResult = await getGoalEventsResult({ start: now, end: thirtyDayEnd })` (30-day window) and then calls:
```typescript
const weekCgConflicts = crossGoalConflicts({
  events: otherGoalsResult.events,   // ← 30 days of events
  ...
  range: weekWindow,                  // ← 7-day window, but range is NOT used to filter events
});
```
The `crossGoalConflicts` function does NOT filter events by `range` — it processes every event in the passed array. The `range` argument is used only for the key-events-same-week week-bucketing (rotation week vs calendar week decision). Result: `weekCgConflicts` contains cross-goal conflicts for the entire 30-day window, not just the current week. `mergedWeekConflicts` / `currentWeekConflicts` is mislabeled and would surprise the coach.

**Why it matters**: The field `currentWeekConflicts` in `get_session_brief` is described as "current week conflicts + cross-goal conflicts." The coach would see conflicts 3–4 weeks out mixed in with this-week conflicts, diluting the urgency signal.

**How to fix**: Filter the 30-day events to the current week before calling crossGoalConflicts:
```typescript
const weekEvents = otherGoalsResult.events.filter(
  (e) => e.dateKey >= weekStartDk && e.dateKey <= weekEndDk,
);
const weekCgConflicts = weekEvents.length > 0
  ? crossGoalConflicts({ events: weekEvents, ..., range: weekWindow })
  : [];
```
The 30-day result is still used for `otherActiveGoals.nextEvent` — that broader scan is correct for that field.

**Severity**: Critical for correctness of a key coaching surface. The coach's brief should show THIS week's conflicts, not conflicts from the next month jumbled in.

---

## Design Concerns (Should Fix)

### DC-1 — Blueprint §11.1 is factually wrong: `templateForRotationDay` already exists

**What**: Addendum §11.1 states "this function does not currently exist. It must be added in calendar.ts Pass 1 (REQ-101)." It already exists at **calendar.ts:701** with an implementation **identical** to what §11.1 proposes. The `goal-conflicts.ts` import of it is correct as written.

**Why it matters**: The Alpha (REQ-101) agent will create a duplicate symbol, causing a TypeScript re-declaration error and confusing future readers about which definition applies.

**How to fix**: Remove §11.1's instruction to add the function. The import in `goal-conflicts.ts` works as-is. Verify the existing function's behavior matches the blueprint's intent (it does — the algorithm is identical).

**Severity**: High correctness bug in the blueprint instructions. Will break the Wave-1 compile gate.

---

### DC-2 — Suspicion D confirmed: no-ctx resolveDay + out-of-plan dates silently drop proximity conflicts

**What**: `resolveDay` sets `weekWindow = null` when `daysDelta < 0 || daysDelta >= program.template.totalWeeks * 7` (calendar.ts:441). When `weekWindow === null` AND no ctx is provided, goal events are fetched for only that single day:
```typescript
ctx ? Promise.resolve(ctx.goalEvents)
  : weekWindow
    ? getGoalEvents({ start: weekWindow.start, end: weekWindow.end })
    : getGoalEvents({ start: dayStart, end: dayEnd })  // ← single day
```
A single-day event window can never fire `event-near-long-effort` (needs events from adjacent days to detect proximity) or `key-events-same-week` (needs events for the whole week).

**Why it matters**: The most common standalone `get_day` call is the coach asking "what's happening on 2026-09-20?" (the 5k race date). If that date is beyond `plan.totalWeeks * 7`, `weekWindow` is null, events are day-scoped, and NO cross-goal conflicts fire — exactly when the coach most needs them.

**How to fix**: In the no-ctx, out-of-plan fallback, use a ±N-day window around the date to ensure proximity detection works:
```typescript
: getGoalEvents({
    start: addDays(dayStart, -(CROSS_GOAL_RULES.raceProximityDays + 1)),
    end: addDays(dayEnd, CROSS_GOAL_RULES.raceProximityDays + 1),
  })
```
This costs the same 3 queries but gives `event-near-long-effort` the adjacency context it needs.

**Severity**: High — affects the primary demo scenario (coach calls `get_day` on race date, expects conflict warning).

---

### DC-3 — Today page double-fetches `getGoalEventsResult` (+3 wasted queries)

**What**: The Today page as designed:
1. `resolveDay(now)` → internally calls `getGoalEvents({ start: weekWindow.start, end: weekWindow.end })` (3 queries)
2. `getGoalEventsResult({ start: now, end: addDays(now, 6) })` for OtherGoalsStrip (3 queries)

Two separate event fetches, with overlapping ranges (today falls in both). The 7-day OtherGoalsStrip range is a strict superset of "today" from the weekWindow perspective.

**Why it matters**: +3 unnecessary DB queries on every Today page load. Given that Today is the most-navigated page, this compounds.

**How to fix**: Pre-fetch `getGoalEventsResult` for the 7-day range ONCE in the Today page's Promise.all, then pass `ctx` to `resolveDay`:
```typescript
const [r, ..., sevenDayResult] = await Promise.all([
  // Do NOT call resolveDay here directly — it will duplicate
  getGoalEventsResult({ start: startOfDay(now), end: addDays(startOfDay(now), 6) }),
  ...other queries...
]);
const ctx = { goalEvents: sevenDayResult.events, crossGoalConflicts: [], focusGoalId: sevenDayResult.focusGoalId };
// crossGoalConflicts computed after (pure, no DB)
const r = await resolveDay(now, ctx);
```

**Severity**: Medium performance. 6 goal-event queries vs 3 on every Today load.

---

### DC-4 — `OtherGoalsStrip` missing `CrossGoalConflict` import

**What**: The blueprint addendum §11.4 adds the imports for `CalendarMonth.tsx` but not for `OtherGoalsStrip.tsx`. The component uses `CrossGoalConflict` in its Props type but there is no import statement shown.

**How to fix**: Add to OtherGoalsStrip.tsx:
```typescript
import type { GoalEvent } from "@/lib/goal-events";
import type { CrossGoalConflict } from "@/lib/goal-conflicts";
```

**Severity**: Medium — TypeScript error; will fail compile gate.

---

### DC-5 — `createGoal` missing `revalidatePath("/calendar")` (targeted by §11.10 only for updateGoal)

**What**: Blueprint §11.10 (addendum) says `updateGoal` needs `revalidatePath("/")` and `revalidatePath("/calendar")`. But `createGoal` also affects the calendar (new goal's `targetDate` pin should appear immediately). The addendum says "Add `/` to revalidatePath calls" for createGoal but doesn't explicitly add `/calendar`.

**How to fix**: Add `revalidatePath("/calendar")` to `createGoal` in goal-actions.ts alongside the already-required `revalidatePath("/")`.

**Severity**: Medium UX gap — creating a someday goal or a goal with a future targetDate wouldn't refresh the calendar pin.

---

### DC-6 — `getBaselineSchedule` wrapper in §3.3 uses the orderBy fallback (CRIT-2 duplicate)

**What**: The new `getBaselineSchedule` public wrapper in records.ts (§3.3) uses:
```typescript
orderBy: [{ goal: { isFocus: "desc" } }, { updatedAt: "desc" }],
```
This is the same fallback-enabled query flagged in CRIT-2. When the focus goal has no active plan, `getBaselineSchedule` silently returns another goal's baseline schedule to the baselines/new page and to MCP callers.

**How to fix**: Use the focus-strict query here. If the focus goal has no active plan, return the empty shape `{ startedOn: null, totalWeeks: null, scheduled: [], unscheduledExtras: [] }`.

**Severity**: High (same as CRIT-2, just the specific manifestation in records.ts).

---

### DC-7 — `key-events-same-week` emits multi-day conflicts for a single week collision

**What**: When event A (dateKey 2026-07-01) and event B (dateKey 2026-07-03) are in the same week, the code emits:
- conflict at 2026-07-01 with withDates=[2026-07-03]
- conflict at 2026-07-03 with withDates=[2026-07-01]

Both survive the per-dateKey deduplication since they have different dateKeys. Calendar cells on BOTH days show conflict wedges. MCP responses for each day include a conflict.

**Why it matters**: Noisy for multi-event weeks. A 3-event week would emit 3 calendar wedges. Arguably correct (each event day IS in conflict) but may feel surprising to the coach.

**How to fix**: Either accept as-is (document behavior), or emit only one conflict per goal-pair-per-week (earliest dateKey wins). PRD is silent on this. Low priority but should be a deliberate decision.

**Severity**: Low — cosmetic noisiness, not a correctness bug.

---

### DC-8 — `setFocusGoal` doesn't revalidate the previously focused goal's detail page

**What**: `setFocusGoal(id)` revalidates `/goals/${id}` for the NEW focus goal but not for the OLD focus goal's `/goals/<old-id>` page.

**Why it matters**: The old focus goal's detail page keeps showing "Focus" badge until the user directly navigates to it. The `/goals` list page IS revalidated (so the list is correct), but direct links to the old goal's page are stale.

**How to fix**: Before the transaction, fetch the current focus goal's id, then add `revalidatePath(\`/goals/${oldFocusId}\`)` after the transaction.

**Severity**: Low — stale until direct navigation. The list page is correct.

---

## Suggestions

### SUG-1 — crossGoalConflicts: expose multi-kind per dateKey as an array

The current dedup (one conflict per dateKey, most-severe-wins) loses information. For MCP, the coach might find it useful to see ALL conflict kinds on a date (e.g., both `event-on-hard-day` AND `event-near-long-effort`). Consider changing `CrossGoalConflict[]` (one per dateKey) to returning all conflicts and letting callers dedup for display. The CalendarDayCell can still show only one (most-severe), but MCP can expose all. Low priority for Phase 1 but worth noting.

### SUG-2 — `plannedHikeDateKeys` in crossGoalConflicts: widen range at grid boundary

`getCalendarMonth` passes `plannedHikeDateKeys` from hikes within the grid range (gridStart to gridEnd). For `event-near-long-effort`, a hike on the day AFTER the grid end would be missed as a proximity trigger for a target-date event on the last day of the grid. Consider fetching hikes with a ±N-day buffer beyond the grid edges.

### SUG-3 — Consider `ResolveDayCtx.crossGoalConflicts` default to empty array

The ctx type requires `crossGoalConflicts: CrossGoalConflict[]`. Callers that want to provide goalEvents but haven't pre-computed conflicts must pass `[]`. Consider making it optional in the interface to avoid callers needing to compute conflicts before they want to.

### SUG-4 — `getGoalEventsResult` returns focus goal events in `events` array

`events` includes ALL active goal events (focus + non-focus). Callers that only want non-focus events must call `otherGoalEvents()` filter. This is correct but add a clear comment in the type doc so developers know `events` is the full set and `otherGoalEvents()` is the filter helper.

---

## Missing Requirements

### MR-1 — `event-near-long-effort` does not fire for exactly-on (diff=0) cases

PRD §8 criterion 7 says: "race 1 day after long-effort day → `event-near-long-effort`". The blueprint correctly handles diff=1. But criterion 7 also implicitly tests diff=0 (race ON the long-effort day). Currently diff=0 is excluded by `diff > 0`. If `long-endurance` is added to `hardCategories` (CRIT-1 fix), diff=0 is caught by `event-on-hard-day`, which is the intended behavior. But this interaction must be documented explicitly — the fix for CRIT-1 is what makes diff=0 covered.

### MR-2 — `log_hike` idempotency when resolvedGoalId is null matches `IS NULL` only

The idempotency check uses `where: { goalId: resolvedGoalId }`. When `resolvedGoalId === null`, Prisma translates this to `WHERE goalId IS NULL`. This correctly matches hikes with no explicit goalId (focus-attributed). §11.6 documents this. But: if a user previously logged a hike WITH an explicit goalId for the focus goal (before REQ-101's `log_hike` goalId input was added), those old hike rows have `goalId = focusGoalId` (a string). The idempotency check for a new `log_hike` call without `goalId` input would use `goalId: null` and NOT match those old explicit-goalId rows. Two planned hikes for the same goal on the same day could coexist. This is an acceptable edge case but should be documented.

### MR-3 — get_week `overrideDks` left empty, disabling override suppression

Blueprint §6.1 for get_week:
```typescript
const overrideDks: string[] = []; // Overrides for the week — optional, can be empty for performance
```
This means `event-on-hard-day` in get_week is never suppressed by workout overrides. This violates PRD §4.6 ("a workoutJson override on the date suppresses the conflict when overrideDateKeys provided"). The blueprint deliberately skips this "for performance." This is a PRD deviation that must be explicitly accepted or the override query must be added to get_week's pre-assembly step.

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| CRIT-1: retest-on-long-endurance undetected | High (retests happen) | High (silent safety gap) | Add `long-endurance` to hardCategories |
| CRIT-2: lint/baseline on wrong plan | Medium (focus-switch common) | High (data integrity, user confusion) | Focus-strict queries at lint/ack sites |
| CRIT-3: key-events-same-week misses focus+non-focus | High (primary scenario) | High (misleads coach) | Include focus events in week scan |
| CRIT-4: get_session_brief 30-day conflicts in currentWeekConflicts | High (any non-focus goal with future events) | Medium (confusing MCP output) | Filter events to week before crossGoalConflicts |
| DC-1: templateForRotationDay duplication | Certain (agent will follow §11.1) | High (tsc error, compile gate failure) | Brief Alpha agent to skip §11.1 |
| DC-2: out-of-plan get_day misses conflicts | Medium (race dates often beyond plan) | High (key coaching scenario fails) | Widen fallback fetch range |
| DC-3: 6 queries on Today | Certain | Low-Medium (perf only) | Pre-assemble ctx in Today page |
| CRIT-2 via DC-6: getBaselineSchedule fallback | Same as CRIT-2 | Same | Focus-strict in records.ts wrapper |
| MR-3: get_week override suppression skipped | Certain | Low (advisory advisory) | Accept or add override query |

---

## Verdict

**NEEDS REVISION**

The blueprint is structurally sound and the implementation plan is comprehensive, but four critical correctness gaps must be fixed before development begins:

1. CRIT-1, CRIT-3: The cross-goal conflict logic has two blind spots that will let the primary real-world scenario (non-focus race near focus retest week / long-endurance day) fire zero conflicts.
2. CRIT-2 (+DC-6): The orderBy-fallback trick at lint/ack/baseline sites is architecturally wrong and will cause lint acknowledgements and baseline schedules to operate silently against the wrong goal.
3. CRIT-4: `get_session_brief`'s `currentWeekConflicts` will contain 30 days of conflicts instead of 7, misleading the coach.

Additionally, DC-1 is certain to break the Wave-1 compile gate (`templateForRotationDay` already exists), and DC-2 undermines the key demo scenario for `get_day` on out-of-plan dates.

The remaining design concerns (DC-3 through DC-8) can be addressed in the same revision pass or deferred with explicit acceptance.

---

## Critical/High Issues Numbered List (for handoff)

1. **CRIT-1**: Add `"long-endurance"` to `CROSS_GOAL_RULES.hardCategories` — baseline-retest events on long-endurance days are currently undetectable
2. **CRIT-2**: Replace orderBy-fallback trick with focus-strict queries at: `lintActivePlan`, `getPendingNotesCount`, `get_pending_notes` (MCP), `acknowledge_lint_finding`, `clear_lint_acknowledgement`, `baselines/new/page.tsx` — wrong-plan fallback causes lint-ack data integrity issues
3. **CRIT-3**: Fix `key-events-same-week` to include focus-goal key events in the week scan (currently filters them out entirely, missing focus-retest + non-focus-race same week)
4. **CRIT-4**: Filter `otherGoalsResult.events` to current week's dateKeys before calling `crossGoalConflicts` in `get_session_brief`, or filter the output — currently `currentWeekConflicts` spans 30 days
5. **DC-1**: Do NOT add `templateForRotationDay` in REQ-101 — it already exists at `calendar.ts:701`; brief Alpha agent accordingly
6. **DC-2**: Widen no-ctx, out-of-plan event fetch in `resolveDay` to ±(raceProximityDays+1) days so proximity conflicts fire on `get_day` calls for dates outside the plan window (e.g., race date)
7. **DC-6**: `getBaselineSchedule` wrapper in records.ts §3.3 must use focus-strict query (same as CRIT-2 fix), not the orderBy fallback
