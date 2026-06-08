# Design: Long-Effort (Hike) Reconciliation in the Resolver

**Status:** Proposed — for review before `/feature-dev` build
**Author:** Claude Code (dev side), 2026-06-08
**Problem owner:** the recurring "I have to correct the rotation every week" complaint

---

## 1. The bug, precisely

The rotation is anchored to `plan.startedOn` with modulo-7 math
(`calendar.ts:319-323`):

```ts
rotationDay = (((daysDelta % 7) + 7) % 7) + 1;   // 1..7
weekIndex   = Math.floor(daysDelta / 7) + 1;
```

Because 7 days is exactly one week, **rotation Day _N_ lands on the same
weekday every week.** Rotation **Day 6 = "Long Endurance"** (`program-template.ts:398-417`)
is therefore a fixed weekday that **always renders "Long Run or Hike,"
whether or not a real hike is planned that week.**

Meanwhile, an _actual_ planned hike is a `Hike` row (`schema.prisma:115-130`):

```prisma
model Hike { date DateTime; route; distanceMi; elevationFt; packWeightLb?; durationMin; status }
```

It has a free `date` and **no link to the rotation.** Real life schedules
hikes around weather and crew — so the hike lands on, say, Sunday (rotation
Day 7, "Rest"), while Day 6 (Saturday) still prescribes a long effort.

**Result — two sources of truth for the week's long effort, never reconciled:**
- Day 6 says "do a long run/hike" (the phantom).
- The `Hike` row says the real hike is on a different day.

Today the only fix is the coach manually writing `apply_day_override` rows
every week to suppress the phantom Saturday and activate the real hike day.
That is the manual correction the user is tired of.

### Why this is a structural fix, not a process fix
The durable answer is to make the **resolver reconcile these two at read
time** — zero writes, no override rows to manage, automatically correct if
the hike moves again. A standing rule or lint rule only _detects_; the
resolver _fixes_. This moves ownership from coach-discipline → app-structure.

---

## 2. The mental model: the app surfaces, the coach resolves

**The plan is a dynamic, interactive experience between user and coach.** When
a week deviates, the _reason_ governs the right adjustment — a work trip, an
injury, weather, crew availability — and only the conversation knows it. So the
app must **not** auto-decide what a displaced day becomes. Baking
"preempted Saturday → recovery" into deterministic code is exactly the wrong
move.

Split of responsibilities:

- **App (deterministic, read-time):** surface reality and conflicts. Make the
  Day-6 ⇄ planned-hike mismatch **loud and cheap to catch every week**, so the
  user is never the one who has to notice it.
- **Coach (conversational):** resolve the deviation _with_ the user, knowing
  the why, and write the decision via `apply_day_override`.

This still fixes the original complaint ("I don't want to be the one catching
the mismatch") **without** robbing the coach of the judgment call. The 12-week
program prescribes one long effort per week (Day 6); when a `Hike` row exists
elsewhere that week, that's a **conflict to flag**, not a slot to silently
rewrite.

It reuses the shape of an existing, shipped pattern —
`workoutDeferredForBaseline` (`calendar.ts:403-407`): a boolean flag +
`workoutTemplate` left populated, so consumers can _render_ the situation
without anything being destroyed. Hike handling adds **advisory flags only**,
never a forced replacement template.

---

## 3. How `resolveDay` picks the hike day

`resolveDay` already `await`s `getActiveProgram()` on its **first line**
(`calendar.ts:274`), before the parallel query block. Today the rotation math
lives _inside_ the post-`Promise.all` `if (program)` block (`calendar.ts:317-323`).
The change: **hoist the pure arithmetic above the `Promise.all`** so the week
window is known in time to add one more query to the existing parallel fetch.
`ActiveProgramSnapshot` exposes exactly what's needed — `{ startedOn,
template }` (`program.ts:5-10`).

```ts
// --- hoisted above the Promise.all (pure, no DB) ---
let isInPlan = false, rotationDay: number | null = null, weekIndex: number | null = null;
let weekWindow: { start: Date; end: Date } | null = null;
if (program) {
  const startMid = startOfDay(program.startedOn);
  const daysDelta = Math.floor((dayStart.getTime() - startMid.getTime()) / (24 * 3600 * 1000));
  if (daysDelta >= 0 && daysDelta < program.template.totalWeeks * 7) {
    isInPlan = true;
    rotationDay = (((daysDelta % 7) + 7) % 7) + 1;
    weekIndex   = Math.floor(daysDelta / 7) + 1;
    weekWindow  = rotationWeekWindow(program, weekIndex);
  }
}

// New helper (calendar.ts), USER_TZ-aware via the existing addDays/startOfDay:
function rotationWeekWindow(program: ActiveProgramSnapshot, weekIndex: number) {
  const start = addDays(startOfDay(program.startedOn), (weekIndex - 1) * 7);
  return { start, end: endOfDay(addDays(start, 6)) };
}
```

```ts
// Added to the resolveDay Promise.all. Gate on weekWindow like the override
// query gates on program?.id — return [] when out of plan so the shape is stable:
weekWindow
  ? prisma.hike.findMany({
      where: { status: "planned", date: { gte: weekWindow.start, lte: weekWindow.end } },
      orderBy: { date: "asc" },
    })
  : Promise.resolve([] as Hike[]),
```

Then the reconciliation (pure, in-memory, after the awaits resolve):

```ts
const thisKey        = dateKey(date);
const hikeOnThisDay  = plannedHikesThisWeek.find(h => dateKey(h.date) === thisKey) ?? null;
const hikesElsewhere = plannedHikesThisWeek.filter(h => dateKey(h.date) !== thisKey);
```

> One subtlety: the existing block recomputes `daysDelta` to derive baselines.
> After the hoist, **reuse** the hoisted `rotationDay` / `weekIndex` rather than
> recomputing — one source of truth for the rotation math.

---

## 4. Surfacing rules (advisory only — no auto-rewrite)

Precedence stays the existing one: **explicit override > rotation default.**
Reconciliation adds **flags**, never a replacement template. Every flag is
suppressed when an explicit override already drives the day (`isOverride`) —
the coach has already resolved it, so nothing to nag about.

### Flag A — a planned hike sits on this date
```
IF hikeOnThisDay
THEN plannedHikeToday = { id, route, distanceMi, elevationFt, packWeightLb, durationMin, date }
     workoutDeferredForHike = (workoutTemplate && workoutTemplate.category !== "rest" && !isOverride)
```
`workoutDeferredForHike` is **advisory** — a hint that "the hike is likely the
day's work," mirroring `workoutDeferredForBaseline`. It does **not** remove the
gym session; the coach/user may still choose to do both. `workoutTemplate`
stays fully populated.

### Flag B — Day 6 long-effort conflicts with a hike elsewhere this week
```
IF workoutTemplate?.category === "long-endurance"
   AND NOT hikeOnThisDay
   AND hikesElsewhere.length > 0
   AND !isOverride
THEN longEffortConflict = {
       rotationLongEffortDate: thisKey,
       plannedHikeDates: hikesElsewhere.map(h => dateKey(h.date)),
     }
```
This is the **loud signal** that replaces the old auto-collapse. Day 6 still
renders its normal long-effort template — nothing is silently rewritten. The
flag tells every consumer "two long efforts are scheduled this week; reconcile
this conversationally." The coach reads it on cold-start, asks the user why the
hike moved, and writes the appropriate `apply_day_override`. **The app never
decides what Saturday becomes.**

### What does NOT change
- **No planned hike this week →** Day 6 renders the normal "Long Run or Hike"
  template, no flag. A Phase-1 Day-6 "60 min run, no pack" is a real session.
- **Hike already on Day 6 →** no conflict (`hikeOnThisDay` true); Flag A
  attaches the route/pack detail, no Flag B.
- **Anything with an explicit override →** silent; already resolved.

---

## 5. New fields on `ResolvedDay`

```ts
plannedHikeToday: {                       // Flag A — populated on the hike's own date
  id; route; distanceMi; elevationFt; packWeightLb; durationMin; date;
} | null;
workoutDeferredForHike: boolean;          // Flag A — advisory, mirrors workoutDeferredForBaseline
longEffortConflict: {                     // Flag B — the loud signal, NOT an auto-rewrite
  rotationLongEffortDate: string;         // dateKey of the Day-6 slot
  plannedHikeDates: string[];             // dateKey(s) of the hike(s) elsewhere this week
} | null;
```

Consumers (all of these **display the flag**; none mutate the plan):
- **`get_session_brief`** is the load-bearing surface — it's the coach's
  cold-start read every session (`tools.ts`, blended last-N + standing rules).
  Surfacing `longEffortConflict` here is what makes the coach catch the
  mismatch _every week without the user prompting_ — the whole point. Add it to
  the brief alongside standing rules.
- **`get_today_plan` / `get_day`** surface `plannedHikeToday` +
  `workoutDeferredForHike` (like baselines today) and `longEffortConflict` when
  the queried date is the Day-6 slot, e.g. _"Heads up — Day 6 long effort and a
  planned hike on Sun 6/14 are both on the calendar this week. Want me to
  reconcile?"_
- **Calendar `buildCell`** (`calendar.ts:117`): `buildCell` needs the same
  per-week planned-hike awareness to expose a `longEffortConflict` boolean on
  the `CalendarDayCell` — but **the visual treatment of that marker is owned by
  the parallel `/ux-research` pass** (`docs/ux-research/plan-confidence-calendar.md`),
  not specified here. This doc only commits to making the data available on the
  cell; whether it renders as a badge, a week-rail tick, etc. is that pass's
  call. Keep rendering the long-effort title regardless — no silent rewrite.
  Note `getCalendarMonth` currently fetches a whole month grid at once, so it
  should resolve conflicts per rotation-week in memory rather than calling
  `resolveDay` per cell.
- **`apply_day_override` base resolution** (`templateForRotationDay`,
  `calendar.ts:490`): unaffected — stays override-unaware and rotation-only.
  The coach's conversational resolution flows through `apply_day_override` as
  it does today; this design just makes the _need_ for it impossible to miss.

### Interaction with the existing baseline deferral
A retest day and a planned hike can land on the **same date** — then both
`workoutDeferredForBaseline` (`calendar.ts:403`) and `workoutDeferredForHike`
fire. That's intentional: the resolver **surfaces both facts** and does not
pick. Testing at max effort and a long hike on one day is a real conflict the
coach resolves with the user (usually: move the test). `lint retest-on-hike-day`
(below) is the backstop that flags it loudly. Neither boolean removes the
prescribed work; they only annotate.

### Worked example (the common case)
Plan started a Monday → Day 6 = Saturday, Day 7 = Sunday. It's week 5. Saturday
forecast is bad, so the user plans the training hike for **Sun 6/14** (a `Hike`
row, `status:"planned"`). Week window = Mon 6/8 … Sun 6/14.

| Call | Result |
|---|---|
| `resolveDay(Sat 6/13)` | rotationDay 6, `workoutTemplate` = Long Endurance (unchanged). `hikeOnThisDay` = none; `hikesElsewhere` = [6/14] → **`longEffortConflict = { rotationLongEffortDate: "2026-06-13", plannedHikeDates: ["2026-06-14"] }`**. |
| `resolveDay(Sun 6/14)` | rotationDay 7 (Rest). `plannedHikeToday` = the 6/14 hike. `workoutDeferredForHike` = **false** (category is `rest` — nothing to defer; the hike just fills the rest day). |
| `get_session_brief` (Mon 6/8 cold-start) | carries `longEffortConflict` for the week → coach sees "Sat long-effort + Sun hike both scheduled." |

The coach asks _why_ (bad Saturday weather), and — **with the user** — writes
`apply_day_override(2026-06-13, …)` to make Saturday whatever fits (rest, easy
Zone 2, a pulled-forward strength day — a conversation, not a default), and
optionally an override on 6/14 to formalize the hike as that week's long effort.
Both dates now have overrides → flags suppress → the week is conflict-free and
can be confirmed. **The app surfaced; the coach resolved.**

---

## 6. Edge cases

| Case | Behavior |
|---|---|
| **No hike this week** | No change, no flag. Day 6 = normal long run/hike. |
| **Hike on the Day-6 date** | Flag A only (route/pack detail). No conflict. |
| **Hike on a non-Day-6 date (the common phantom)** | Flag A on the hike date + Flag B (`longEffortConflict`) on Day 6. The coach reconciles conversationally. |
| **2+ planned hikes same week** | Flag A on each hike date; Flag B lists all of them in `plannedHikeDates`. Lint emits `multiple-hikes-one-week` (info). |
| **Retest week collides with a hike day** | Flag A is advisory only; a baseline retest is max-effort testing — you can't test AND hike. Resolver keeps both visible; **lint `retest-on-hike-day` (warning)** flags it so the coach reslots the test. Nothing dropped. |
| **Hike date outside plan window** | No flags (outside `totalWeeks*7`). Lint `hike-outside-plan` (warning). |
| **Explicit override already on the day** | Flags suppressed — already resolved by the coach. |
| **Completed hike (not planned)** | v1 scope = `status:"planned"` only (the conflict is a _future_-planning problem). Revisit only if past-date display feels wrong. |

---

## 7. `get_week` resolver (supporting tool)

A 7-day scan is currently 7 `get_day` calls. Add `get_week(startDate?)`:

- **v1 (recommended):** loop `resolveDay` over the 7 dates of the rotation
  week. Simple, correct, reuses all reconciliation automatically. ~35 queries
  for the week (5 per day) — acceptable for an on-demand weekly scan.
- **v2 (later, if needed):** batch-fetch the week's workouts/overrides/hikes
  once and resolve in memory. Defer until profiling says it matters.

`get_week` is what makes the coach's "weekly maintenance scan" cheap (one
call) and is the natural surface for the lint rules below.

---

## 8. Lint rules (detection backstop)

Added to `plan-lint.ts` following the existing `findings.push({rule, severity, message, context})`
pattern (`plan-lint.ts:24-29`). With reconciliation live, these are a
backstop, not the primary fix:

| Rule | Severity | Fires when |
|---|---|---|
| `retest-on-hike-day` | warning | A rotation-scheduled retest week has a baseline due on a date that also has a planned hike. |
| `pre-hike-leg-load` | warning | A planned hike is the day **after** a heavy-leg day (Day 2 or Day 5 carry the hiking superset / heavy legs). |
| `multiple-hikes-one-week` | info | >1 planned hike in a single rotation week. |
| `hike-outside-plan` | warning | A planned hike's date is before `startedOn` or past `totalWeeks*7`. |

The coach's original `phantom-hike` rule is **made obsolete by reconciliation**
— the phantom no longer renders, so there's nothing to flag. `pre-hike-leg-load`
is the genuinely useful fatigue-stacking check that survives.

`retest-on-hike-day` is no longer lint-only: per §11 it's promoted to a
first-class per-week conflict (the confirm guard and the warning rail-cap need
it as live state). So this lint rule becomes a **thin caller of
`weekConflicts(...)`** rather than its own bespoke query — one source of truth
for "what conflicts exist this week."

---

## 9. Out of scope / sequenced later

- **Baseline pull-forward window** (`records.ts:197-204`). Real but narrow
  (retest week opening on a hike day). The 28-day tail already absorbs most
  slippage. Defer until reconciliation lands, since the window logic depends
  on knowing the hike alignment.
- **Standing rule** as a stopgap — fine to add now, but mark it explicitly
  temporary and resolve it the day this ships (standing rules are never
  auto-deleted; a process rule obsoleted by code is debt).

---

## 10. Resolved: the app does not decide what the displaced day becomes

An earlier draft asked "when Day 6 is preempted, should Saturday become
recovery / a swap / easy Zone 2?" **That question is rejected by design.** What
the displaced day becomes depends on _why_ the week deviated — work trip,
injury, weather, crew — which only the conversation knows. The app surfaces
`longEffortConflict`; the coach resolves it _with_ the user and writes the
decision via `apply_day_override`. No default, no auto-collapse, no threshold
heuristic baked into code. See memory:
`plan-is-conversational-not-auto-resolved`.

---

## 11. Confidence layer (decisions from the `/ux-research` pass)

The "provisional vs. confirmed week" visual was researched in
`docs/ux-research/plan-confidence-calendar.md` (+ ledger + HTML artifact). Its
resolved decisions, and how they couple to this backend:

**Resolved by the UX pass:**
- **Granularity = per-week**, not per-day. A slim confidence rail in the
  calendar's left gutter, capped with the canonical **Bullseye** (filled =
  confirmed, hollow = provisional, warning = conflict). Provisional *days* carry
  a quiet redundant cue (reduced opacity + dashed top hairline) for
  colorblind-safety. The rail's per-week state is **reduced in the component**
  from its 7 cells — no per-week field on the cell.
- **Data model = a single `Plan.confirmedThroughDate DateTime?` high-water
  mark** (not per-day flags, not a per-week join table). The review ritual is
  sequential and weekly, so confirmation is monotonic and contiguous; one date
  captures it. Reopen = move the mark earlier. (`WeekConfirmation` table is the
  v2 only if non-contiguous confirmation ever becomes real — it won't.)
- **Set conversationally, never auto:** extend `log_review` with an optional
  `confirmThroughWeekEnd`, plus explicit `confirm_week` / `reopen_week` MCP
  actions. The app never advances the mark on its own.
- **`CalendarDayCell`** gains `confidence: "past"|"confirmed"|"provisional"|null`
  (derived in `buildCell` from `confirmedThroughDate` — **no new query**, the
  date rides on the program snapshot) and a normalized
  `conflict: { kind; withDates[] } | null`.

**The coupling — one shared conflict helper.** The forcing function ("a week
can't lock while it holds an unresolved conflict") lives in the **`confirm_week`
/ `log_review` server guard**, not just the pixels. That guard, the calendar
cell's `conflict` field, and the lint rules (§8) must all answer the *same*
question, so extract one source of truth:

```ts
// shared by: confirm guard · CalendarDayCell.conflict · lint
// Returns the unresolved conflicts in a rotation week (override-aware — an
// overridden day is already resolved, so it contributes nothing).
async function weekConflicts(program, weekIndex):
  Promise<{ dateKey: string; kind: "long-effort" | "retest-on-hike"; withDates: string[] }[]>
```

It surfaces **both** kinds: `long-effort` (this design's `longEffortConflict`)
and `retest-on-hike` (a retest due on a date with a planned hike). Note this
**promotes `retest-on-hike` from "lint-only" to a first-class per-week conflict**,
because the confirm guard and the warning rail-cap both need it as live state,
not just a lint string. The lint rule becomes a thin caller of the same helper.

**Sequencing:** the confirmed/provisional layer (rail, cap, `confirmedThroughDate`)
is **independent and can ship first**. The conflict overlay + the confirm guard
depend on this backend (§13 steps 2–3 + `weekConflicts`). So: this resolver work
and the confidence-visual work can proceed in parallel, meeting at
`weekConflicts`.

---

## 12. Testing (match the repo's actual convention)

**There is no test framework in this repo** — no vitest/jest, no `*.test.ts`;
`tsx` is the only relevant devDep. "Regression testing" here means a standalone
`tsx` harness under `scripts/` with hand-rolled assertions (precedent:
`scripts/test-revision-flow.ts`). Two options, pick at build time:

- **(A) Match convention** — add `scripts/test-reconciliation.ts`: seed a
  synthetic plan + `Hike` rows against a test DB, call `resolveDay` for the §6
  cases, `assert` the flags. Cheap, consistent, no new deps. **Recommended for
  v1.**
- **(B) Introduce vitest** — worth doing eventually (the rotation/baseline math
  in `calendar.ts` is exactly the pure, table-testable logic a real runner
  pays off on), but that's its own infra decision — don't smuggle it in here.

Either way, the **core assertion is the invariant**: across every §6 case the
prescribed `workoutTemplate` is returned **unchanged** — only the new flags
differ. A test that ever sees `workoutTemplate` mutated by reconciliation is a
design violation. Pure cases (no override) are unit-testable without a DB by
extracting the in-memory reconciliation into a small pure function that takes
`(rotationDay, weekIndex, thisKey, plannedHikesThisWeek, isOverride)` →
`{ plannedHikeToday, workoutDeferredForHike, longEffortConflict }`.

---

## 13. Build plan

Two tracks that can run in parallel and meet at `weekConflicts`.

**Track 1 — Reconciliation backend (this doc):**
1. `rotationWeekWindow` helper + hoisted rotation math + planned-hike-this-week
   query in `resolveDay` (§3).
2. Extract the pure reconciliation function (§12) + three new `ResolvedDay`
   fields (`plannedHikeToday`, `workoutDeferredForHike`, `longEffortConflict`).
   No template mutation, no auto-rewrite.
3. `weekConflicts(program, weekIndex)` helper (§11) — the single source of truth
   surfacing `long-effort` + `retest-on-hike` conflicts, override-aware.
4. Wire the flags through `get_session_brief` (the cold-start path that matters
   most), `get_today_plan`, `get_day`; expose `conflict` on `CalendarDayCell`
   via `weekConflicts` (visual treatment owned by the UX pass).
5. `get_week` tool (v1 loop) — the coach's cheap weekly-scan surface.
6. Lint rules in `plan-lint.ts`: `pre-hike-leg-load`, `multiple-hikes-one-week`,
   `hike-outside-plan` as new checks; `retest-on-hike-day` as a thin caller of
   `weekConflicts`.
7. `scripts/test-reconciliation.ts` harness over the §6 cases, asserting the
   plan is **never** silently rewritten — only flagged.

**Track 2 — Confidence visual (UX pass `plan-confidence-calendar.md`):**
- `Plan.confirmedThroughDate` column + migration; `CalendarDayCell.confidence`
  derivation; `log_review` extension + `confirm_week`/`reopen_week` actions with
  the **conflict guard calling `weekConflicts`**; `CalendarMonth` week-row
  refactor + rail/cap + provisional cell cue; the `bullseye-pop` flip.
- Ships independently for confirmed/provisional; the conflict overlay + guard
  consume Track 1's `weekConflicts`.

Each track is a clean `/feature-dev` unit. Hand Track 1 first (it unblocks the
overlay); Track 2's confirmed/provisional layer can start whenever.
