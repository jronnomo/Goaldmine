# Architecture Critique — Track 2: Plan-Confidence Calendar

**Reviewer:** Devil's Advocate Agent
**Date:** 2026-06-08
**Blueprint reviewed:** `architecture-blueprint.md`
**Verdict:** NEEDS REVISION

Three real bugs must be fixed before implementation begins; several medium concerns must be resolved before the PR merges. No single issue is a showstopper in isolation, but C-1 and C-2 can silently corrupt data state or produce permanently broken UI, and C-3 mis-fires the animation in the opposite order from the stated intent.

---

## Critical

### C-1 — `confirm_week(N)` where N < current mark silently moves the mark backward

**What:** The `guardedAdvanceConfirmedThrough` guard derives `currentWeekIdx` from `confirmedThroughDate`, then checks weeks `currentWeekIdx+1 … targetWeekIndex`. When `targetWeekIndex < currentWeekIdx`, the range is empty → no guard fires → the Prisma write proceeds → `confirmedThroughDate` is set to `endOfDay(week N)`, which is EARLIER than the current mark.

`confirm_week` is intended to ADVANCE the mark. Calling `confirm_week(2)` when the mark is already at week 5 silently reopens weeks 3–5 without any conflict re-check, without any warning, and without using the `reopen_week` flow. The PRD names `reopen_week` as the explicit tool for backward movement (US-004). The blueprint does not define what happens when N < M and does not add a guard.

**Why it matters:** A coach who accidentally passes a too-low weekIndex destroys the confirmation state of 3+ weeks in a single write. The MCP tool returns `{ ok: true }` with no indication that a backward move occurred.

**How to fix:**
```ts
if (targetWeekIndex < currentWeekIdx) {
  return {
    ok: false,
    blockedBy: [],
    reason: `weekIndex ${targetWeekIndex} is below the current confirmed mark (week ${currentWeekIdx}). Use reopen_week to move the mark backward.`,
  };
}
```
Add this check immediately after deriving `currentWeekIdx`, before the guard loop and the write. The comparison must use the inverse-derived integer, not a date comparison.

**Severity:** Critical — silent data corruption.

---

### C-2 — Past weeks with stale `"planned"` hikes show permanent "conflict" rail state

**What:** In `deriveRailState`, conflict is checked FIRST:

```ts
if (inPlan.some((c) => c.conflict != null)) return "conflict";
const allPast = inPlan.every((c) => c.confidence === "past");
```

In `buildCell`, conflict is computed for ALL in-plan cells including past ones — it is not gated on `!isPast`. A planned hike that was never completed and never updated to a different status (a real data inconsistency, but one that can persist) generates `cell.conflict !== null` on a past cell. Once the week passes, the hike can never be moved or overridden (overrides on past days are unusual and not surfaced in any UI), so this conflict marker can never clear.

The result: a past week with a stale planned hike shows a "conflict" warning rail cap with dashed warning spine indefinitely and can never be resolved through normal app flows. The `confirm_week` guard also fires on past weeks (if they fall in the span), blocking confirmation even though the conflict is moot.

**How to fix — two-pronged:**

1. In `deriveRailState`, move the `allPast` check before the conflict check. Past weeks get their rail state from the confirmed-mark comparison only; conflict is irrelevant for past weeks:

```ts
const allPast = inPlan.every((c) => c.confidence === "past");
if (allPast) {
  // past-confirmed or past-unconfirmed; conflict on past weeks is moot
  const lastInPlanDate = inPlan.at(-1)!.date;
  const pastConfirmed =
    confirmedThroughDate != null &&
    startOfDay(lastInPlanDate).getTime() <= startOfDay(confirmedThroughDate).getTime();
  return pastConfirmed ? "confirmed" : "past";
}
if (inPlan.some((c) => c.conflict != null)) return "conflict";
```

2. In `guardedAdvanceConfirmedThrough`, skip the `weekConflicts` call for any week whose last day (`(weekIndex-1)*7 + 6` from `startedOn`) is already in the past. Past-week conflicts are unresolvable and should never block confirmation.

**Severity:** Critical — permanently broken UI state with no recovery path.

---

### C-3 — Pop fires for the LOWEST unpopped confirmed week, not the most-recently confirmed (highest)

**What:** The `useEffect` in §6.4 iterates `confirmedWeekIndices` (a `Set` constructed from chronologically-ordered `cells`) in insertion order — ascending weekIndex — and breaks on the first entry with no localStorage key. The comment in the blueprint says:

> "Only pop the most-recently confirmed week (highest weekIndex)"

The code does the opposite: it pops week 1 first, then week 2, then week 3 across successive page loads. If the coach confirms weeks 1–3 in a single `confirm_week(3)` call, the first calendar load after that pops week 1 (not the "solidify week 3" moment the UXR intends), week 2 fires on the next load, week 3 on the one after that. The solidification moment is associated with the wrong week and spread across multiple loads.

**How to fix:** Reverse the iteration order so the highest (most recently covered) weekIndex pops first:

```ts
const sorted = [...confirmedWeekIndices].sort((a, b) => b - a); // highest first
for (const wi of sorted) {
  // ... localStorage check, setPoppingWeekIndex(wi), break
}
```

**Severity:** Critical from a UX correctness standpoint — the "completion moment" fires on the wrong week. The existing `bullseye-pop` on `TodayCelebration` fires for "today," a singular concept; this feature requires an explicit ordering decision that the blueprint gets wrong.

---

## Design Concerns

### D-1 — `WeekRailProps.startedOn` is inconsistent with the recommended option (b)

**What:** `WeekRailProps` in §3.5 includes `startedOn: Date`. The blueprint then says in §6.1:

> "Recommended: option (b) — `WeekRail` finds `lastInPlanCell = cells.filter(c => c.isInPlan).at(-1)` and computes the week's 'confirmed' boundary as `startOfDay(lastInPlanCell.date) <= startOfDay(confirmedThroughDate)`."

Option (b) does NOT need `startedOn`. The type definition contradicts the recommendation. The `WeekRail` JSX in §6.1 passes `startedOn` as a prop, and `CalendarMonth` props (§6.1) add `confirmedThroughDate` but NOT `startedOn`. If option (b) is used, the `WeekRail` receives a prop that option (b) never touches. If option (a) is chosen, `CalendarMonth` needs `startedOn: Date` as a new prop from `calendar/page.tsx` (not shown in the blueprint's page changes).

**How to fix:** Pick one option explicitly.
- Option (b): remove `startedOn` from `WeekRailProps` and from the JSX call. The `confirmedThroughDate` + last in-plan cell date is sufficient.
- Option (a): add `startedOn?: Date` to `CalendarMonth` props and thread it from `calendar/page.tsx` via `program?.startedOn`.

Option (b) is cleaner since `program` is not otherwise threaded into `CalendarMonth`. Recommend (b) with an explicit note to guard `inPlan.at(-1)` for all-padding rows (already handled by the `null` rail state path).

**Severity:** Medium — implementer will add dead prop if following option (b), or silently break if attempting option (a) without adding the prop to `CalendarMonth`.

---

### D-2 — `BullseyeWarning` is color-only at the component level — explicit ruling required

**What:** `BullseyeWarning` renders a `<circle r={14} stroke="var(--warning)" strokeWidth={2}>` — geometrically identical to `Bullseye`'s hollow ring `<circle r={14} stroke="var(--muted)" strokeWidth={2}>`. The ONLY difference is the stroke color. At 14–16px, whether a protanope or deuteranope can distinguish `var(--warning)` from `var(--muted)` depends entirely on lightness contrast, not hue.

The blueprint never explicitly rules on this. It notes "⚠ Verify at 14px" but does not cite UX §8's governing principle.

**Resolution (required — must be in the PR description, not deferred):** UX §8 states "Conflict adds a *geometric* corner wedge, not just amber." The corner wedge on the conflict DayCell is the non-color redundant channel for conflict detection at the cell level; the cap's amber ring is a second-order summary indicator at the row level. The system as a whole is colorblind-safe because the wedge is geometric. The cap being color-only is acceptable **only if** the conflict wedge is present and visible on at least one cell in the row.

This creates a dependency: if the DayCell wedge is not rendered (e.g., because REQ-006 is deferred or the wedge CSS is misconfigured), the conflict state becomes color-only and violates UX §8. The implementer must verify both channels are present in the same PR.

**Severity:** Medium — no code change needed if wedge lands with REQ-005/006, but the blueprint should make the dependency explicit rather than leaving it to a "verify visually" note.

---

### D-3 — `isPopping` prop on `DayCell` is vestigial and undocumented

**What:** The JSX in §6.1 passes `isPopping={poppingWeekIndex === weekIndex && c.isInPlan}` to `DayCell`. The `DayCell` section (§6.3) never adds `isPopping` to the function signature, never documents what it does, and never uses it. The pop animation is applied to the WeekRail cap wrapper via `ref.classList.add("bullseye-pop")` in `CalendarMonth`, not to `DayCell`.

The UX gantt (§4.2) mentions "cell opacity ramp" as part of the flip, but that is implemented via the `confidence` class change (confidence flips from "provisional" to "confirmed" on the next server render, causing the opacity class to be absent), not via an `isPopping` prop.

If an implementer adds `isPopping` to `DayCell` based on the JSX hint and tries to wire something to it, they will add dead code or invent undocumented behavior.

**How to fix:** Remove `isPopping` from the `DayCell` JSX in §6.1. The cell opacity transition is CSS-driven by the class change on the `confidence` field — no prop needed.

**Severity:** Medium — guaranteed to cause implementer confusion or dead code.

---

### D-4 — `guardedAdvanceConfirmedThrough` makes N×2 sequential DB queries

**What:** The guard loop calls `await weekConflicts(program, w)` for each week in the span. `weekConflicts` makes 2 DB queries (hikes + overrides) per call. Confirming from week 1 to week 12 in one call makes 22 sequential DB queries.

While this is bounded by `totalWeeks` (max 12 for this program → max 22 queries), the sequential nature means latency stacks. Each query is a round-trip to Neon. A skip from week 1 to week 12 takes approximately 22 × ~10ms = ~220ms of pure DB round-trip overhead before the write, in the best case.

**How to fix:** Batch the fetch. Add a `weekConflictsForRange(program, fromWeek, toWeek)` variant (or extend `weekConflicts`) that fetches hikes and overrides for the entire date span in two queries, then loops over the weeks in memory to find conflicts. This keeps the DB round-trips at 2 regardless of span width. The existing `weekConflicts` can remain for single-week callers (`get_session_brief`, lint) and the guard uses the batch variant.

**Severity:** Medium — functional but suboptimal. For a single-user app this is unlikely to cause user-visible latency, but it is an avoidable N+1 pattern.

---

### D-5 — Header `gap` mismatch (pre-existing, amplified)

**What:** The existing `CalendarMonth.tsx` header row has no `gap-1` while the cell grid does. The blueprint preserves this pattern in the new layout (header uses `grid-cols-[16px_repeat(7,1fr)]` with no gap; week rows use `grid-cols-[16px_repeat(7,1fr)] gap-1`). With `gap-1` (4px), the 7 `1fr` columns in data rows are slightly narrower than the header's 7 `1fr` columns, causing a subtle column drift. At 390px this is ~0.5px per column — probably imperceptible, but it is a real misalignment.

This is a pre-existing issue the blueprint chose to preserve rather than fix.

**How to fix (optional):** Add `gap-1` to the header grid OR add `gap-1` to the header but use `pointer-events-none` on the header to ensure the extra cells don't interfere. Alternatively, accept the drift as imperceptible (it is) but document it to prevent a future "is this a bug?" question.

**Severity:** Low — pre-existing, very minor, acceptable to defer.

---

### D-6 — `reopen_week` accepts weekIndex > totalWeeks without a guard

**What:** `reopen_week({ weekIndex: 100 })` on a 12-week program sets `confirmedThroughDate = endOfDay(week 99)`, which is far beyond the program end. All in-plan dates satisfy `date <= confirmedThroughDate`, so every future week would render as "confirmed" on the next render — the opposite of the intended "reopen" operation.

The `confirm_week` has a `totalWeeks` clamp; `reopen_week` does not.

**How to fix:**
```ts
if (input.weekIndex > program.template.totalWeeks + 1) {
  return {
    ok: false,
    confirmedThroughDate: null,
    reason: `weekIndex ${input.weekIndex} exceeds plan length (${program.template.totalWeeks} weeks).`,
  };
}
```

**Severity:** Low — the coach is unlikely to call `reopen_week(100)`, but the tool should be defensive.

---

## Suggestions

### S-1 — Misleading header comment in §6.1 JSX

The comment `{/* Day headers stay flat, no rail gutter for the header row */}` immediately precedes code that DOES add a 16px rail gutter (via `<div />`). The comment means "no rail spine/cap component in the header" — which is correct — but the phrase "no rail gutter" directly contradicts the added `<div />` spacer. An implementer who reads this comment may think the `<div />` is a mistake and remove it, breaking alignment.

**Fix:** Change to `{/* Header gets the 16px rail spacer but no spine/cap component */}`.

---

### S-2 — `log_review` note-then-confirm order should be documented

The handler creates the note first, then (if `confirmThroughWeekEnd` is present) runs `guardedAdvanceConfirmedThrough`. If `getActiveProgram` returns null in the confirm path, the note IS already logged and the function returns `{ id, message: "Review logged", confirm: { ok: false, ... } }`. This is the intended design ("review is always logged regardless of confirm result") but is never explicitly stated in the blueprint.

A future developer reading the code might think this is an error and try to roll back the note. Add a one-line comment: `// Note is always persisted; confirm failure is a non-fatal advisory in the return.`

---

### S-3 — `CalendarDayCell.date.getDate()` in `DayCell` uses raw Date methods

`DayCell` at line 151 calls `cell.date.getDate()` to render the day number. This is a raw `Date` method. It works correctly here because `cell.date` is already `startOfDay` in USER_TZ (built in `buildCell` via `new Date(args.date)` where `args.date` comes from `addDays`/USER_TZ walk). However, `getDate()` returns the date in the CLIENT's timezone, not USER_TZ. If the client TZ differs from USER_TZ (e.g., a viewer in UTC+12), the day number displayed in the cell may be off by one for boundary cells. This is a pre-existing issue, not introduced by Track 2, but Track 2 adds `cell.date` to `WeekRail` comparison logic (`startOfDay(lastInPlanDate)`), which is TZ-safe. The display issue in `DayCell` is separate and worth noting for a future audit.

---

## Missing Requirements

### M-1 — `confirm_week` guard does not skip out-of-plan padding weeks

If the program has `totalWeeks = 12` and the coach calls `confirm_week(12)`, the guard checks weeks `currentWeekIdx+1 … 12`. This is correct. But the guard calls `weekConflicts(program, w)` for each week, and `weekConflicts` uses `rotationWeekWindow` which always returns a date range. There is no guard for `weekIndex > totalWeeks` in `weekConflicts` itself (the clamp is only in the `confirm_week` body). This means if `currentWeekIdx` were ever 0 and `targetWeekIndex` were 13 (hypothetically), the guard would query week 13 which is outside the plan. The `confirm_week` clamp (`targetWeekIndex > totalWeeks → refuse`) prevents this in practice, but the belt-and-suspenders check should be at the `weekConflicts` level or the guard loop should also enforce `w <= program.template.totalWeeks`.

**How to fix:** Add `if (w > program.template.totalWeeks) continue;` inside the guard loop (or enforce the clamp check at the top before the loop instead of after `currentWeekIdx` derivation, as C-1 recommends).

---

### M-2 — `confirm_week` same-week re-confirm writes a redundant DB row

When `targetWeekIndex === currentWeekIdx` (re-confirming the already-confirmed week), the guard loop range is empty and the write proceeds, setting `confirmedThroughDate` to the same value it already holds. The `prisma.plan.update` call fires unconditionally. This is a harmless no-op but wastes a DB write.

**How to fix:** Add before the write:
```ts
if (targetWeekIndex === currentWeekIdx) {
  return { ok: true, confirmedThroughDate: program.confirmedThroughDate! };
}
```

---

## Risk Table

| Risk | Likelihood | Impact | Severity | Fix Required? |
|------|-----------|--------|----------|---------------|
| C-1: `confirm_week(N<M)` silently moves mark backward | Medium (coach typo) | High (data corruption, no recovery signal) | Critical | Yes — before implementation |
| C-2: Past week with stale planned hike shows permanent "conflict" | Low (data inconsistency) | High (UI stuck, unresolvable) | Critical | Yes — before implementation |
| C-3: Pop fires on lowest weekIndex, not most-recently confirmed | Certain | Medium (UX correctness) | Critical | Yes — before implementation |
| D-1: `startedOn` prop inconsistency | Certain | Medium (dead prop or missing prop) | Medium | Yes — before PR merge |
| D-2: `BullseyeWarning` color-only ruling not explicit | Certain | Low (a11y ambiguity if wedge deferred) | Medium | Yes — must be documented in PR |
| D-3: `isPopping` on `DayCell` is vestigial | Certain | Low (dead code) | Medium | Yes — remove before implementation |
| D-4: N+1 `weekConflicts` loop | Certain | Low (bounded 22 queries max) | Medium | Should-fix before PR merge |
| D-5: Header `gap` mismatch | Certain | Low (pre-existing, imperceptible) | Low | No — defer |
| D-6: `reopen_week` no upper bound | Low | Low (bad confirm state) | Low | Should-fix before PR merge |
| M-1: Guard loop doesn't skip out-of-plan weeks | Very Low | Low (query beyond plan end) | Low | Should-fix |
| M-2: Same-week re-confirm writes unnecessary DB update | Low | Negligible | Low | Nice-to-have |
| Inverse weekIndex math | Verified correct | — | None | — |
| `log_review` non-regression | Verified correct | — | None | — |
| Header gutter alignment (16px spacer) | Addressed in blueprint | — | None | Blueprint addresses it |
| `confirmedThroughDate` threading | Correct | — | None | — |
| Migration additive/nullable | Confirmed safe | — | None | — |
| USER_TZ compliance | Blueprint follows conventions | — | None | — |
| `revalidatePath` / server render staleness | Not needed (MCP-only, force-dynamic) | — | None | — |
| Reduced-motion | Addressed in blueprint | — | None | — |
| `Bullseye.tsx` untouched | Correct — wrapper approach | — | None | — |
| `getActiveProgram` no-select claim | Verified correct (no explicit select) | — | None | — |

---

## Verdict: NEEDS REVISION

The blueprint is architecturally sound and the main design decisions are correct: high-water mark over per-day flags, single-agent-sequential, `BullseyeWarning` wrapper, `confirmedThroughDate` threaded via `program` snapshot, no new queries. The inverse rotation math is verified correct. The migration is genuinely additive. The non-regression of `log_review` is verified.

**Must fix before implementation begins (C-1, C-2, C-3):**

1. Add backward-mark guard to `guardedAdvanceConfirmedThrough`: refuse `confirm_week(N)` where N < current mark with a clear error directing the coach to `reopen_week`.
2. Reorder `deriveRailState` to check `allPast` before conflict; skip `weekConflicts` in the guard loop for past weeks.
3. Reverse the pop iteration order in `useEffect` so the highest (most recently covered) weekIndex fires first.

**Must resolve before PR merges (D-1, D-2, D-3):**

4. Commit to option (a) or (b) for `startedOn` in `WeekRailProps`; remove the inconsistency.
5. Explicitly document in the PR that `BullseyeWarning` is acceptable as color-only because the corner wedge provides the non-color redundant channel — this dependency must land in the same PR (REQ-006 is not optional relative to REQ-005 if colorblind-safety is the invariant).
6. Remove `isPopping` from the `DayCell` JSX call; the prop does not exist and is not described.

With these six items resolved, the blueprint is approvable for single-agent-sequential implementation.
