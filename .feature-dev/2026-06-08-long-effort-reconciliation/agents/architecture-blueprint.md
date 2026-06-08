# Architecture Blueprint — Long-Effort (Hike) Reconciliation, Track 1

**Produced by:** Architect Agent, 2026-06-08  
**For:** Single Developer Agent (one sequential worktree, no parallel split)  
**Authoritative spec:** `docs/design/long-effort-reconciliation.md`  
**PRD:** `docs/prds/PRD-long-effort-reconciliation.md`  
**Requirements:** `.feature-dev/2026-06-08-long-effort-reconciliation/phases/requirements.md` (REQ-001..REQ-007)

---

## 1. File Plan

| Action | Path | Purpose | Key Exports | Deps |
|--------|------|---------|-------------|------|
| **Modify** | `src/lib/calendar.ts` | `rotationWeekWindow` helper; hoist rotation math; `reconcileLongEffort` pure fn; 3 new `ResolvedDay` fields; `WeekConflict` type; `weekConflicts` async fn; `CalendarDayCell.conflict`; updated `buildCell` / `getCalendarMonth` | `rotationWeekWindow`, `reconcileLongEffort`, `weekConflicts`, `WeekConflict` | `db.ts`, `program.ts`, `program-template.ts` (all pre-existing) |
| **Modify** | `src/lib/mcp/tools.ts` | New `get_week` tool; wire `currentWeekConflicts` into `get_session_brief`; update descriptions for `get_today_plan` / `get_day` (fields flow automatically) | `registerTools` (side-effectful) | `calendar.ts` (new exports) |
| **Modify** | `src/lib/plan-lint.ts` | Add `"info"` to `LintSeverity`; 4 new lint rules (`pre-hike-leg-load`, `multiple-hikes-one-week`, `hike-outside-plan`, `retest-on-hike-day`) | `LintSeverity`, `lintActivePlan` | `calendar.ts` (`weekConflicts`) |
| **Create** | `scripts/test-reconciliation.ts` | tsx harness for §6 edge cases; asserts `workoutTemplate` invariant | (executable script) | `calendar.ts`, `db.ts` via dotenv/config |

### Decision rationale — no new `src/lib/plan-conflicts.ts`

The "shared `weekConflicts` helper" was initially a candidate for a separate file to avoid a `calendar.ts → records.ts → calendar.ts` circular import. **That circular import does not exist** because:

- `records.ts` imports `addDays`/`startOfDay`/`endOfDay` from `calendar.ts`. ✓
- `weekConflicts` needs to determine which rotation days have baseline tests due. That computation is **pure template math** — `program.template.baselineWeek[i].tests[j].retestWeeks.includes(weekIndex)` — with no call to `getBaselineSchedule` from `records.ts`. No cross-file call needed.
- `calendar.ts` already imports `prisma` from `db.ts` (for `resolveDay`'s queries). `weekConflicts` adds two more queries but no new imports.

Therefore all new code lives in `calendar.ts` (types, pure fn, async fn, cell changes) with no new lib file, avoiding both a new abstraction boundary and any circular risk.

---

## 2. Type Definitions

All copy-paste ready. Place these in `src/lib/calendar.ts` at the relevant spots (types near line 9–25 / 225–270; `WeekConflict` near the new exports).

### 2a. Three new `ResolvedDay` fields (design §5)

Add after `workoutDeferredForBaseline` in the `ResolvedDay` type (~line 239):

```ts
// Flag A — populated on any date that has a planned hike. The hike's detail
// is surfaced so the coach can display route/pack weight without a second call.
plannedHikeToday: {
  id: string;
  route: string;
  distanceMi: number;
  elevationFt: number;
  packWeightLb: number | null;
  durationMin: number;
  date: Date;
} | null;

// Flag A — advisory, mirrors workoutDeferredForBaseline. True when a planned hike
// sits on this date AND the rotation template prescribes a non-rest session AND
// no explicit override is present. The gym session is NOT removed; this is a hint
// that the hike is likely the day's work.
workoutDeferredForHike: boolean;

// Flag B — the loud conflict signal for Day 6. Set on the Day-6 (long-endurance)
// slot when a planned hike exists elsewhere in the same rotation week AND no
// override has already resolved the day. workoutTemplate is left fully populated —
// nothing is silently rewritten.
longEffortConflict: {
  rotationLongEffortDate: string;  // dateKey ("yyyy-mm-dd") of the Day-6 slot
  plannedHikeDates: string[];      // dateKey(s) of hike(s) planned elsewhere this week
} | null;
```

Initialize these in `resolveDay`'s early-return path (no active program) as `plannedHikeToday: null, workoutDeferredForHike: false, longEffortConflict: null`.

### 2b. `CalendarDayCell.conflict` (design §5 / §11)

Add after `baselinesDue` in the `CalendarDayCell` type (~line 25):

```ts
// Normalized conflict for the calendar cell — data only; visual treatment is
// Track 2 (plan-confidence-calendar.md). null = no conflict or out-of-plan.
// If a cell has both kinds (theoretically possible but rare), "retest-on-hike"
// takes precedence as the more immediately actionable signal.
conflict: { kind: "long-effort" | "retest-on-hike"; withDates: string[] } | null;
```

### 2c. `WeekConflict` type

Export near the top of `calendar.ts`, after `CalendarDayCell`:

```ts
// Single source of truth for per-week unresolved conflicts.
// Consumed by: weekConflicts() async fn, buildCell (sync subset),
// get_session_brief (current week), plan-lint retest-on-hike-day rule,
// and (Track 2) the confirm_week guard.
export type WeekConflict = {
  dateKey: string;                          // "yyyy-mm-dd" of the conflicted day
  kind: "long-effort" | "retest-on-hike";
  withDates: string[];                      // dateKey(s) of the hike(s) driving the conflict
};
```

### 2d. `reconcileLongEffort` signature + return type

```ts
// Pure — no DB, no await, no side effects, no mutation.
// Takes the already-fetched week hikes and the already-resolved template/flags.
// Returns only the three advisory flags; workoutTemplate is never touched.
export function reconcileLongEffort(args: {
  rotationDay: number;
  weekIndex: number;
  thisDateKey: string;
  plannedHikesThisWeek: {
    id: string;
    route: string;
    distanceMi: number;
    elevationFt: number;
    packWeightLb: number | null;
    durationMin: number;
    date: Date;
  }[];
  isOverride: boolean;
  workoutTemplate: DayTemplate | null;
}): {
  plannedHikeToday: ResolvedDay["plannedHikeToday"];
  workoutDeferredForHike: boolean;
  longEffortConflict: ResolvedDay["longEffortConflict"];
}
```

### 2e. `weekConflicts` signature + return type

```ts
// Async — queries its own data (planned hikes + overrides for the week).
// Override-aware: a day with a planDayOverride contributes no conflicts
// (the coach has already resolved it).
export async function weekConflicts(
  program: ActiveProgramSnapshot,
  weekIndex: number,
): Promise<WeekConflict[]>
```

### 2f. `rotationWeekWindow` signature

```ts
// Pure USER_TZ-aware helper. Returns the UTC instants bracketing the 7-day
// rotation week: Day 1 midnight → Day 7 23:59:59.999.
// NOTE: Uses addDays/startOfDay/endOfDay — never raw Date math.
function rotationWeekWindow(
  program: ActiveProgramSnapshot,
  weekIndex: number,
): { start: Date; end: Date }
```

(Not exported — consumed internally by `resolveDay` and `weekConflicts`; no external callers yet.)

---

## 3. `resolveDay` Restructure

### Current structure (lines 273–467)

```
274: await getActiveProgram()
275-276: startOfDay / endOfDay
278-308: Promise.all([workouts, override, notes, goal, nutrition])
317-323: if (program) { daysDelta, rotationDay, weekIndex }  ← math inside if-block
324-395: template, baselines
403-407: workoutDeferredForBaseline
409-466: return { ... }
```

### New structure (exact change description)

**Step 1 — Hoist rotation math to before the Promise.all.**

Insert immediately after lines 275–276 (`dayStart`/`dayEnd`), before line 278:

```ts
// --- hoist: pure rotation math (no DB) ---
// Moved above Promise.all so weekWindow is known in time to join the parallel fetch.
let isInPlan = false;
let rotationDay: number | null = null;
let weekIndex: number | null = null;
let weekWindow: { start: Date; end: Date } | null = null;

if (program) {
  const startMid = startOfDay(program.startedOn);
  const daysDelta = Math.floor(
    (dayStart.getTime() - startMid.getTime()) / (24 * 3600 * 1000),
  );
  if (daysDelta >= 0 && daysDelta < program.template.totalWeeks * 7) {
    isInPlan = true;
    rotationDay = (((daysDelta % 7) + 7) % 7) + 1;
    weekIndex   = Math.floor(daysDelta / 7) + 1;
    weekWindow  = rotationWeekWindow(program, weekIndex);
  }
}
// (daysDelta is local to this block; it is NOT redeclared below — the hoisted
// rotationDay/weekIndex are the single source of truth for this date's rotation.)
```

**Step 2 — Add planned-hike query to the existing Promise.all.**

Change the destructure line (line 278) from:

```ts
const [workouts, override, notesForDate, goal, nutrition] = await Promise.all([
```

to:

```ts
const [workouts, override, notesForDate, goal, nutrition, plannedHikesThisWeek] = await Promise.all([
```

Add this as the sixth element of the Promise.all array (after the `nutritionLog.findMany` call):

```ts
weekWindow
  ? prisma.hike.findMany({
      where: {
        status: "planned",
        date: { gte: weekWindow.start, lte: weekWindow.end },
      },
      select: {
        id: true,
        route: true,
        distanceMi: true,
        elevationFt: true,
        packWeightLb: true,
        durationMin: true,
        date: true,
      },
      orderBy: { date: "asc" },
    })
  : Promise.resolve([] as {
      id: string; route: string; distanceMi: number; elevationFt: number;
      packWeightLb: number | null; durationMin: number; date: Date;
    }[]),
```

**Step 3 — Rewrite the opening of the `if (program)` block (line 317).**

Remove the existing `daysDelta`/`rotationDay`/`weekIndex` computation from inside the block (lines 318–323). Replace with just:

```ts
if (isInPlan && program && rotationDay !== null && weekIndex !== null) {
  // rotationDay and weekIndex are already computed above (hoisted).
  // No daysDelta recomputation needed here.
```

The `isInPlan` flag from the hoist replaces the implicit `daysDelta >= 0 && daysDelta < ...` guard. The rest of the block (override/template/baselines logic at lines 324–395) is unchanged.

**Step 4 — Add `reconcileLongEffort` call and new fields.**

After the existing `workoutDeferredForBaseline` assignment (~line 403), add:

```ts
const {
  plannedHikeToday,
  workoutDeferredForHike,
  longEffortConflict,
} = reconcileLongEffort({
  rotationDay: rotationDay ?? 0,
  weekIndex: weekIndex ?? 0,
  thisDateKey: dateKey(date),
  plannedHikesThisWeek,
  isOverride,
  workoutTemplate,
});
```

**Step 5 — Add the three fields to the return object.**

In the return statement (~line 409), after `workoutDeferredForBaseline`:

```ts
plannedHikeToday,
workoutDeferredForHike,
longEffortConflict,
```

**Step 6 — Initialize the three fields for the no-program / out-of-plan path.**

In `resolveDay`, the early "no active program" path implicitly returns via the block structure. Add the three fields to the return value in all paths:

```ts
plannedHikeToday: null,
workoutDeferredForHike: false,
longEffortConflict: null,
```

These are set by `reconcileLongEffort` when `isInPlan`; for out-of-plan dates, `reconcileLongEffort` is not called, so initialize them as above in the no-program branch (the current code has this as a fall-through; make it explicit).

---

## 4. `reconcileLongEffort` Implementation

Place this pure function near the bottom of `calendar.ts`, before the date utilities section. It has no DB access and no imports beyond the types already in scope.

```ts
export function reconcileLongEffort(args: {
  rotationDay: number;
  weekIndex: number;
  thisDateKey: string;
  plannedHikesThisWeek: {
    id: string; route: string; distanceMi: number; elevationFt: number;
    packWeightLb: number | null; durationMin: number; date: Date;
  }[];
  isOverride: boolean;
  workoutTemplate: DayTemplate | null;
}): {
  plannedHikeToday: ResolvedDay["plannedHikeToday"];
  workoutDeferredForHike: boolean;
  longEffortConflict: ResolvedDay["longEffortConflict"];
} {
  const {
    rotationDay, weekIndex, thisDateKey, plannedHikesThisWeek,
    isOverride, workoutTemplate,
  } = args;

  // Suppress all flags if an explicit override already drives the day.
  if (isOverride) {
    return { plannedHikeToday: null, workoutDeferredForHike: false, longEffortConflict: null };
  }

  // Flag A: hike on THIS date.
  const hikeOnThisDay =
    plannedHikesThisWeek.find(h => dateKey(h.date) === thisDateKey) ?? null;

  const plannedHikeToday: ResolvedDay["plannedHikeToday"] = hikeOnThisDay
    ? {
        id:           hikeOnThisDay.id,
        route:        hikeOnThisDay.route,
        distanceMi:   hikeOnThisDay.distanceMi,
        elevationFt:  hikeOnThisDay.elevationFt,
        packWeightLb: hikeOnThisDay.packWeightLb,
        durationMin:  hikeOnThisDay.durationMin,
        date:         hikeOnThisDay.date,
      }
    : null;

  // workoutDeferredForHike: advisory — a real (non-rest) session steps aside for the
  // hike, mirroring workoutDeferredForBaseline. Does NOT remove the gym session.
  const workoutDeferredForHike =
    hikeOnThisDay !== null &&
    workoutTemplate !== null &&
    workoutTemplate.category !== "rest";

  // Flag B: long-effort conflict — only on the Day-6 long-endurance slot.
  const hikesElsewhere = plannedHikesThisWeek.filter(h => dateKey(h.date) !== thisDateKey);
  const longEffortConflict: ResolvedDay["longEffortConflict"] =
    workoutTemplate?.category === "long-endurance" &&
    hikeOnThisDay === null &&
    hikesElsewhere.length > 0
      ? {
          rotationLongEffortDate: thisDateKey,
          plannedHikeDates: hikesElsewhere.map(h => dateKey(h.date)),
        }
      : null;

  return { plannedHikeToday, workoutDeferredForHike, longEffortConflict };
}
```

**Invariant check (for test harness):** `reconcileLongEffort` never receives `workoutTemplate` as a mutable reference and never returns it. The `workoutTemplate` field on `ResolvedDay` is set by the existing resolver code before `reconcileLongEffort` is called; the pure function can only read it (for the `category` check). The test harness asserts: `resolvedDay.workoutTemplate === preChangeEquivalent` — i.e., reference-equal to what the pre-change code returned.

---

## 5. `rotationWeekWindow` + `weekConflicts` Design

### `rotationWeekWindow` (place near the date utilities section)

```ts
// Returns the UTC instants for the first and last millisecond of a rotation week.
// Day 1 of weekIndex lands at startOfDay(program.startedOn + (weekIndex-1)*7 days).
// Uses addDays/startOfDay/endOfDay — no raw Date arithmetic.
function rotationWeekWindow(
  program: ActiveProgramSnapshot,
  weekIndex: number,
): { start: Date; end: Date } {
  const weekStart = addDays(startOfDay(program.startedOn), (weekIndex - 1) * 7);
  return { start: weekStart, end: endOfDay(addDays(weekStart, 6)) };
}
```

### `weekConflicts` algorithm

**Override-awareness:** reads `planDayOverride` rows for the week. A day with any override is skipped — the coach has already resolved it.

**Long-effort detection (mirrors `reconcileLongEffort` but week-scoped):**

1. Compute the calendar date of rotation Day 6 in this week: `addDays(startOfDay(program.startedOn), (weekIndex-1)*7 + 5)`.
2. If that date has an override, skip.
3. Look up the Day-6 template. If `category !== "long-endurance"`, skip (defensive).
4. If no planned hike lands on that date but at least one hike exists elsewhere in the week → `{ dateKey: day6Key, kind: "long-effort", withDates: hikesElsewhere.map(dateKey) }`.

**Retest-on-hike detection (pure template math — no `records.ts` import):**

For each rotation day `rotDay ∈ 1..7` in the week:
1. Compute calendar date: `addDays(startOfDay(program.startedOn), (weekIndex-1)*7 + (rotDay-1))`.
2. If that date has an override, skip.
3. Look up `program.template.baselineWeek.find(d => d.dayOfWeek === rotDay)`.
4. Check if any test on that `baselineDay` is due in `weekIndex`:
   ```ts
   hasDueTests = baselineDay.tests.some(t => {
     const initialWeek = t.initialWeek ?? 1;
     return weekIndex === initialWeek ||
       (weekIndex > initialWeek && t.retestWeeks?.includes(weekIndex) === true);
   });
   ```
5. If `hasDueTests` AND a planned hike exists on that calendar date → `{ dateKey: calKey, kind: "retest-on-hike", withDates: [dateKey(hikeOnThisDay.date)] }`.

**Why this does NOT need `getBaselineSchedule` from `records.ts`:** `getBaselineSchedule` computes status (`done`/`due`/`overdue`) by querying logged baseline rows. `weekConflicts` only needs to know "could this day have a test scheduled?" which is pure template math. Whether the test was actually done is irrelevant to the conflict — even a done test on a hike day represents a true conflict.

**Full implementation:**

```ts
export async function weekConflicts(
  program: ActiveProgramSnapshot,
  weekIndex: number,
): Promise<WeekConflict[]> {
  const window = rotationWeekWindow(program, weekIndex);

  const [plannedHikes, overrideRows] = await Promise.all([
    prisma.hike.findMany({
      where: { status: "planned", date: { gte: window.start, lte: window.end } },
      select: { id: true, date: true, route: true },
      orderBy: { date: "asc" },
    }),
    prisma.planDayOverride.findMany({
      where: { planId: program.id, date: { gte: window.start, lte: window.end } },
      select: { date: true },
    }),
  ]);

  const overrideKeys = new Set(overrideRows.map(o => dateKey(o.date)));
  const conflicts: WeekConflict[] = [];

  // --- long-effort conflict ---
  const day6Date = addDays(startOfDay(program.startedOn), (weekIndex - 1) * 7 + 5);
  const day6Key  = dateKey(day6Date);

  if (!overrideKeys.has(day6Key)) {
    const day6Tmpl = program.template.weeklySplit.find(d => d.dayOfWeek === 6);
    if (day6Tmpl?.category === "long-endurance") {
      const hikeOnDay6     = plannedHikes.find(h => dateKey(h.date) === day6Key);
      const hikesElsewhere = plannedHikes.filter(h => dateKey(h.date) !== day6Key);
      if (!hikeOnDay6 && hikesElsewhere.length > 0) {
        conflicts.push({
          dateKey: day6Key,
          kind: "long-effort",
          withDates: hikesElsewhere.map(h => dateKey(h.date)),
        });
      }
    }
  }

  // --- retest-on-hike conflicts ---
  for (let relDay = 0; relDay < 7; relDay++) {
    const rotDay  = (relDay + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
    const calDate = addDays(startOfDay(program.startedOn), (weekIndex - 1) * 7 + relDay);
    const calKey  = dateKey(calDate);

    if (overrideKeys.has(calKey)) continue;

    const baselineDay = program.template.baselineWeek?.find(d => d.dayOfWeek === rotDay);
    if (!baselineDay) continue;

    const hasDueTests = baselineDay.tests.some(t => {
      const initialWeek = t.initialWeek ?? 1;
      return (
        weekIndex === initialWeek ||
        (weekIndex > initialWeek && (t.retestWeeks?.includes(weekIndex) ?? false))
      );
    });
    if (!hasDueTests) continue;

    const hikeOnThisDay = plannedHikes.find(h => dateKey(h.date) === calKey);
    if (hikeOnThisDay) {
      conflicts.push({
        dateKey: calKey,
        kind: "retest-on-hike",
        withDates: [dateKey(hikeOnThisDay.date)],
      });
    }
  }

  return conflicts;
}
```

**Circular-import risk:** None. `weekConflicts` is in `calendar.ts`, which already imports from `db.ts` and `program.ts`. It does NOT import from `records.ts`. The baseline-due computation is self-contained template math. `records.ts` continues to import from `calendar.ts` without any reverse dependency.

---

## 6. `buildCell` / `getCalendarMonth` Change

### Strategy

`getCalendarMonth` already fetches all planned hikes for the grid in one query (`prisma.hike.findMany({ status: { in: ["completed","planned"] } })`). We must not add per-cell DB calls. Approach: pre-group planned hikes by rotation `weekIndex` in memory before the cell loop; pass that map to `buildCell`.

### `getCalendarMonth` changes

**After the existing `plannedHikesByKey` bucketing loop** (around line 75–82), add:

```ts
// Group planned hikes by rotation weekIndex for per-cell conflict computation.
// Out-of-plan hikes (delta < 0 or >= totalWeeks*7) are excluded — they can't
// conflict with rotation days.
const plannedHikesByWeek = new Map<number, typeof hikes>();
if (program) {
  const pStartMid = startOfDay(program.startedOn);
  for (const h of hikes) {
    if (h.status !== "planned") continue;
    const hStart = startOfDay(h.date);
    const delta  = Math.floor((hStart.getTime() - pStartMid.getTime()) / (24 * 3600 * 1000));
    if (delta < 0 || delta >= program.template.totalWeeks * 7) continue;
    const wi  = Math.floor(delta / 7) + 1;
    const arr = plannedHikesByWeek.get(wi) ?? [];
    arr.push(h);
    plannedHikesByWeek.set(wi, arr);
  }
}
```

**In the `buildCell` call** inside the loop (around lines 95–104), add `plannedHikesByWeek` to the args:

```ts
const cell = buildCell({
  date: cursor,
  todayKey,
  goalKey,
  program,
  workoutsByKey,
  hikesByKey,
  plannedHikesByKey,
  overridesByKey,
  plannedHikesByWeek,    // new
});
```

### `buildCell` args change

Add to the args type:

```ts
plannedHikesByWeek: Map<number, { id: string; date: Date; status: string }[]>;
```

### Conflict computation inside `buildCell`

After the existing `baselinesDue` computation, add:

```ts
let conflict: CalendarDayCell["conflict"] = null;

if (isInPlan && rotationDay !== null && weekIndex !== null && args.program) {
  const hasOvr = args.overridesByKey.has(k);

  if (!hasOvr) {
    const weekHikes = args.plannedHikesByWeek.get(weekIndex) ?? [];

    // Priority 1: retest-on-hike (more immediately actionable)
    const baselineDay = args.program.template.baselineWeek?.find(
      d => d.dayOfWeek === rotationDay,
    );
    if (baselineDay) {
      const hasDueTests = baselineDay.tests.some(t => {
        const initialWeek = t.initialWeek ?? 1;
        return (
          weekIndex === initialWeek ||
          (weekIndex > initialWeek && (t.retestWeeks?.includes(weekIndex) ?? false))
        );
      });
      if (hasDueTests) {
        const hikeOnThisDay = weekHikes.find(h => dateKey(h.date) === k);
        if (hikeOnThisDay) {
          conflict = {
            kind: "retest-on-hike",
            withDates: [dateKey(hikeOnThisDay.date)],
          };
        }
      }
    }

    // Priority 2: long-effort conflict (only on Day 6)
    if (!conflict && rotationDay === 6) {
      const tmpl = args.program.template.weeklySplit.find(d => d.dayOfWeek === 6);
      if (tmpl?.category === "long-endurance") {
        const hikeOnThisDay = weekHikes.find(h => dateKey(h.date) === k);
        const hikesElsewhere = weekHikes.filter(h => dateKey(h.date) !== k);
        if (!hikeOnThisDay && hikesElsewhere.length > 0) {
          conflict = {
            kind: "long-effort",
            withDates: hikesElsewhere.map(h => dateKey(h.date)),
          };
        }
      }
    }
  }
}
```

**Add `conflict` to the `buildCell` return object:**

```ts
return {
  // ... all existing fields ...
  conflict,
};
```

### Why NO `resolveDay` per cell

`getCalendarMonth` builds a whole-month grid (28–42 cells). Calling `resolveDay` per cell would add 5 DB queries × 42 cells = 210 DB round-trips per month load. The data needed for conflict detection (planned hikes, overrides) is already fetched in the single `Promise.all` at the top of `getCalendarMonth`. Reconcile in memory only.

### `CalendarMonth.tsx` — Track 1 constraint

The `conflict` field appears on `CalendarDayCell`. `CalendarMonth.tsx` may read it but **must not** add any new JSX or styling for it in Track 1. If the component imports `CalendarDayCell`, the only permissible change is a type-compatible addition (new optional field) — no renders. The visual layer is owned by the Track 2 UX pass.

---

## 7. MCP Tool Surface

### 7a. `get_week` — new tool

**Registration location:** after `get_day` (~line 612 in `tools.ts`).

**Zod inputSchema:**

```ts
{
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "use yyyy-mm-dd")
    .optional()
    .describe(
      "Any date within the target rotation week (yyyy-mm-dd, USER_TZ). " +
      "Defaults to the current week. The tool snaps to the rotation week " +
      "that contains this date — it is NOT necessarily the calendar Mon–Sun week.",
    ),
}
```

**Return shape:**

```ts
{
  weekIndex: number;          // 1-based rotation week
  startDate: string;          // dateKey of rotation Day 1 of this week
  endDate: string;            // dateKey of rotation Day 7 of this week
  totalWeeks: number;
  days: ResolvedDay[];        // 7 entries, index 0 = Day 1 … index 6 = Day 7
}
```

**Handler pattern (v1 — loops `resolveDay`):**

```ts
async ({ startDate }) =>
  safe(async () => {
    const baseDate    = startDate ? parseDateInput(startDate) : new Date();
    const program     = await getActiveProgram();
    if (!program) return { error: "No active program" };

    const startMid    = startOfDay(program.startedOn);
    const baseDayStart = startOfDay(baseDate);
    const daysDelta   = Math.floor(
      (baseDayStart.getTime() - startMid.getTime()) / (24 * 3600 * 1000),
    );

    if (daysDelta < 0 || daysDelta >= program.template.totalWeeks * 7) {
      return { error: "Date is outside the active plan window" };
    }

    const wi        = Math.floor(daysDelta / 7) + 1;
    const weekStart = addDays(startMid, (wi - 1) * 7);

    const days = await Promise.all(
      [0, 1, 2, 3, 4, 5, 6].map(i => resolveDay(addDays(weekStart, i))),
    );

    return {
      weekIndex: wi,
      startDate: dateKey(weekStart),
      endDate:   dateKey(addDays(weekStart, 6)),
      totalWeeks: program.template.totalWeeks,
      days,
    };
  }),
```

**Sample `tools/call` curl:**

```bash
# Current week (default)
curl -s -X POST http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "get_week",
      "arguments": {}
    }
  }'

# Specific week
curl -s -X POST http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "get_week",
      "arguments": { "startDate": "2026-06-08" }
    }
  }'
```

### 7b. `get_session_brief` addition

**Decision: carry `currentWeekConflicts: WeekConflict[]`, NOT per-day `longEffortConflict`.**

Rationale: The brief is a cold-start orientation tool. A compact `WeekConflict[]` array is more scannable than fishing through 7 resolved days for non-null `longEffortConflict` fields. The brief should tell the coach "here are the unresolved conflicts this week" without requiring field-hunting. The coach calls `get_week` if they want per-day detail.

**Change to `get_session_brief` handler:**

1. After computing `plan` (and once `program` + `resolved.weekIndex` are confirmed non-null), add a call to `weekConflicts`:

```ts
const currentWeekConflicts: WeekConflict[] =
  program && resolved.weekIndex !== null
    ? await weekConflicts(program, resolved.weekIndex)
    : [];
```

2. Add to the return object:

```ts
currentWeekConflicts,
```

3. Update the tool description to mention the new field:

```
"… unresolved open items, and any scheduling conflicts for the current rotation week " +
"(currentWeekConflicts — long-effort phantom + retest-on-hike collisions). " +
```

**Import in `tools.ts`:** add `weekConflicts, type WeekConflict` to the import from `@/lib/calendar`.

### 7c. `get_today_plan` and `get_day`

The three new `ResolvedDay` fields (`plannedHikeToday`, `workoutDeferredForHike`, `longEffortConflict`) are part of the `ResolvedDay` type returned by `resolveDay`. Both tools return the resolved day directly:

- `get_today_plan` returns `{ ...r, standingRules, activeGoal }` — the spread of `r` includes the new fields automatically.
- `get_day` returns `r` directly — new fields included.

**No change to return statements is needed.** Only the tool descriptions should be updated (1-line addition each) to inform the coach that the result now includes these fields. Example:

```
// get_today_plan description addition:
"Now also surfaces plannedHikeToday (hike detail if planned today), " +
"workoutDeferredForHike (advisory — hike likely the day's work), and " +
"longEffortConflict (if today is the Day-6 slot and a hike is elsewhere this week). "

// get_day description addition (same wording)
```

---

## 8. Data Flow

```
═══════════════════════════════════════════════════════════════════════════════
 resolveDay(date)
   │
   ├─ [hoisted above Promise.all]
   │    rotationWeekWindow(program, weekIndex)  →  weekWindow { start, end }
   │
   ├─ Promise.all [6 queries now, was 5]
   │    ├─ workouts, override, notes, goal, nutrition  [existing]
   │    └─ prisma.hike.findMany({ status:"planned", week window })  [new]
   │
   └─ reconcileLongEffort(rotationDay, weekIndex, thisDateKey,
                          plannedHikesThisWeek, isOverride, workoutTemplate)
        ├─ plannedHikeToday        ─── on ResolvedDay
        ├─ workoutDeferredForHike  ─── on ResolvedDay
        └─ longEffortConflict      ─── on ResolvedDay

═══════════════════════════════════════════════════════════════════════════════
 getCalendarMonth(year, month)
   │
   ├─ existing Promise.all [workouts, hikes, overrides, goal]
   ├─ group hikes by weekIndex  [in-memory, O(n)]
   └─ buildCell(... plannedHikesByWeek)
        └─ computeConflictForCell(rotationDay, weekIndex,
                                  weekHikes, overridesByKey)
             └─ CalendarDayCell.conflict  { kind, withDates } | null

═══════════════════════════════════════════════════════════════════════════════
 weekConflicts(program, weekIndex)
   │
   ├─ prisma.hike.findMany({ status:"planned", week window })
   ├─ prisma.planDayOverride.findMany({ planId, week window })
   └─ in-memory:  long-effort detection  +  retest-on-hike detection
        │
        ├─→ get_session_brief.currentWeekConflicts  (current week, cold-start)
        ├─→ lint retest-on-hike-day rule  (thin caller, per week with hikes)
        └─→ (Track 2) confirm_week guard  (must be empty before confirming)

═══════════════════════════════════════════════════════════════════════════════
 get_week(startDate?)
   │
   └─ loops resolveDay × 7  →  returns { weekIndex, startDate, endDate, days[] }
        └─ each day includes: plannedHikeToday, workoutDeferredForHike,
                              longEffortConflict  (on ResolvedDay)
```

---

## 9. Work Streams

**One sequential stream (REQ-001 → REQ-007), single Developer Agent.**

No parallel split is possible or desirable:

| Dependency chain | Why ordering is forced |
|---|---|
| REQ-001 before REQ-002 | REQ-002 calls `reconcileLongEffort` from within `resolveDay`; the hoisted variables (`rotationDay`, `weekIndex`, `weekWindow`, `plannedHikesThisWeek`) must exist first |
| REQ-002 before REQ-003 | `weekConflicts` reuses the same template-math pattern established in `reconcileLongEffort`; the `WeekConflict` type is introduced with REQ-003 but its shape is defined in light of REQ-002's flags |
| REQ-002+003 before REQ-004 | `buildCell` conflict logic mirrors `reconcileLongEffort` and `weekConflicts` algorithms; defining them first avoids drift |
| REQ-002+003 before REQ-005 | `get_session_brief` needs `weekConflicts`; `get_today_plan`/`get_day` need the 3 `ResolvedDay` fields |
| REQ-003 before REQ-006 | `retest-on-hike-day` lint rule is a thin caller of `weekConflicts` |
| REQ-002+003 before REQ-007 | Test harness exercises `reconcileLongEffort` (pure) and optionally `weekConflicts` (async) |

All new types (`WeekConflict`, 3 `ResolvedDay` fields, `CalendarDayCell.conflict`) are in `calendar.ts`. Every consumer file imports from there. A parallel split would require stub types to compile, which is more coordination overhead than it saves.

---

## 10. Implementation Order

1. **[REQ-001] `rotationWeekWindow` + hoist + planned-hike query**
   - Add `rotationWeekWindow` function to `calendar.ts`
   - Hoist `daysDelta`/`rotationDay`/`weekIndex`/`weekWindow` above the `Promise.all` in `resolveDay`
   - Add 6th element (planned-hike query, gated on `weekWindow`) to the `Promise.all`
   - Rewrite `if (program)` opener to use hoisted values
   - Gate: `tsc --noEmit` clean; `resolveDay` still returns identical results for all existing fields (curl-verify with a known date)

2. **[REQ-002] `reconcileLongEffort` + 3 `ResolvedDay` fields**
   - Add 3 fields to `ResolvedDay` type
   - Add `reconcileLongEffort` pure function
   - Call it in `resolveDay` after `workoutDeferredForBaseline`; add 3 fields to return
   - Initialize to `null`/`false` in the no-program / out-of-plan path
   - Gate: `tsc` clean; manual curl for a date with a planned hike elsewhere + a Day-6 date

3. **[REQ-003] `WeekConflict` type + `weekConflicts` async function**
   - Add `WeekConflict` type export
   - Add `weekConflicts(program, weekIndex)` async function
   - Gate: `tsc` clean; no lint errors; manually callable from a test script

4. **[REQ-004] `CalendarDayCell.conflict` + `buildCell` / `getCalendarMonth` update**
   - Add `conflict` field to `CalendarDayCell` type
   - Add `plannedHikesByWeek` grouping in `getCalendarMonth`
   - Extend `buildCell` args; add conflict computation logic; add `conflict` to return
   - Gate: `tsc` clean; `npm run build` succeeds; `CalendarMonth.tsx` unchanged (or type-only)

5. **[REQ-005] `get_week` + wire flags into existing tools**
   - Add `weekConflicts, WeekConflict` to the import line in `tools.ts`
   - Add `get_week` tool registration after `get_day`
   - Add `currentWeekConflicts` to `get_session_brief` handler and return
   - Update descriptions for `get_today_plan` and `get_day`
   - Gate: `tsc` clean; `tools/list` curl shows `get_week`; `get_week` call returns 7 days; `get_session_brief` includes `currentWeekConflicts`

6. **[REQ-006] 4 lint rules in `plan-lint.ts`**
   - Add `"info"` to `LintSeverity` union (note: this is a type-change — search for any exhaustive switches on `LintSeverity` and update them)
   - Add `weekConflicts` to the import from `@/lib/calendar`
   - Add 4 rules inside `lintActivePlan`: `hike-outside-plan`, `multiple-hikes-one-week`, `pre-hike-leg-load`, `retest-on-hike-day`
   - Gate: `tsc` clean; `lint_plan` curl with a seeded off-Day-6 hike; confirm findings appear

7. **[REQ-007] `scripts/test-reconciliation.ts` harness**
   - Create script mirroring `scripts/test-revision-flow.ts` structure
   - Cover all §6 cases (see Section 11 below)
   - Gate: `npx tsx scripts/test-reconciliation.ts` exits 0 with all cases labeled green

---

## 11. `scripts/test-reconciliation.ts` Specification

### Structure

```
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { reconcileLongEffort } from "../src/lib/calendar";
import type { DayTemplate } from "../src/lib/program-template";

// Pure-function test suite (no DB needed)
// DB-backed test suite (resolveDay / weekConflicts)
// Teardown
```

### Pure test cases (exercise `reconcileLongEffort` directly — no DB)

The pure function takes `{ rotationDay, weekIndex, thisDateKey, plannedHikesThisWeek, isOverride, workoutTemplate }`.

```
Case P1 — no hike this week
  Input: plannedHikesThisWeek=[], rotationDay=6, workoutTemplate={category:"long-endurance"}
  Expected: plannedHikeToday=null, workoutDeferredForHike=false, longEffortConflict=null

Case P2 — hike on the Day-6 date (no conflict, Flag A only)
  Input: plannedHikesThisWeek=[{date: "2026-06-13", ...}], rotationDay=6, thisDateKey="2026-06-13"
  Expected: plannedHikeToday != null, workoutDeferredForHike=true (category!="rest"),
            longEffortConflict=null

Case P3 — hike on non-Day-6 date (the phantom — Flag A on hike date, Flag B on Day 6)
  For the hike date:
    Input: rotationDay=7, thisDateKey="2026-06-14", plannedHikesThisWeek=[{date:"2026-06-14"}],
           workoutTemplate={category:"rest"}
    Expected: plannedHikeToday != null, workoutDeferredForHike=false, longEffortConflict=null
  For the Day-6 date:
    Input: rotationDay=6, thisDateKey="2026-06-13", plannedHikesThisWeek=[{date:"2026-06-14"}],
           workoutTemplate={category:"long-endurance"}
    Expected: plannedHikeToday=null, workoutDeferredForHike=false,
              longEffortConflict={rotationLongEffortDate:"2026-06-13", plannedHikeDates:["2026-06-14"]}

Case P4 — 2+ hikes same week
  Input: rotationDay=6, thisDateKey="2026-06-13",
         plannedHikesThisWeek=[{date:"2026-06-14"}, {date:"2026-06-15"}],
         workoutTemplate={category:"long-endurance"}
  Expected: longEffortConflict.plannedHikeDates.length === 2

Case P5 — explicit override suppresses all flags
  Input: same as P3 Day-6 case but isOverride=true
  Expected: plannedHikeToday=null, workoutDeferredForHike=false, longEffortConflict=null

Case P6 — hike on a rest day (workoutDeferredForHike=false)
  Input: rotationDay=7, thisDateKey="2026-06-14", plannedHikesThisWeek=[{date:"2026-06-14"}],
         workoutTemplate={category:"rest"}
  Expected: plannedHikeToday != null, workoutDeferredForHike=false
```

### Core invariant assertion

For every case, assert:

```ts
// workoutTemplate must be reference-equal to the input (never mutated).
// Since reconcileLongEffort doesn't return workoutTemplate at all, this
// assertion is on the input object:
const tmpl: DayTemplate | null = { ... }; // test fixture
const original = JSON.stringify(tmpl);
reconcileLongEffort({ ..., workoutTemplate: tmpl });
assert(JSON.stringify(tmpl) === original, "workoutTemplate was mutated — INVARIANT VIOLATION");
```

### DB test cases (exercise `resolveDay` and `weekConflicts` against a real DB)

These require the test DB (`DATABASE_URL`) and a known seeded plan. Wrap in try/finally for cleanup.

```
Case D1 — resolveDay on a date with no planned hikes: flags are null/false.
Case D2 — resolveDay on a date with a planned hike seeded on that same date: plannedHikeToday populated.
Case D3 — weekConflicts returns [] when no hikes in the week.
Case D4 — weekConflicts returns long-effort conflict when hike is off Day 6.
Case D5 — weekConflicts respects overrides (seed override for Day 6, expect 0 conflicts).
```

DB cases are optional (skip gracefully if the plan/DB state doesn't match) — the pure-function cases cover the core invariant.

### Teardown

Delete any `Hike` / `PlanDayOverride` rows created by the harness using their returned IDs.

---

## 12. Critical Decisions

| # | Decision | Reasoning |
|---|---|---|
| 1 | **`weekConflicts` and all new exports live in `calendar.ts`** | No circular import exists. Baseline-due detection is pure template math (no `records.ts` needed). Avoids a new abstraction layer. All consumers already import from `calendar.ts`. |
| 2 | **`LintSeverity` gains `"info"`** | `multiple-hikes-one-week` is genuinely informational, not a warning — it may be intentional (training camp week). Adding `"info"` is cleaner than overloading `"warning"`. Check for any exhaustive `switch (severity)` in the codebase after adding. |
| 3 | **`get_week` returns `{ weekIndex, startDate, endDate, totalWeeks, days }` (v1 loops `resolveDay`)** | Simple, correct, picks up all reconciliation automatically. ~35 DB queries is acceptable for an on-demand weekly scan. v2 batch optimization deferred to when profiling says it matters. |
| 4 | **`get_session_brief` carries `currentWeekConflicts: WeekConflict[]`** (not per-day `longEffortConflict`) | The brief is a cold-start scan, not a day detail. A compact conflict array is immediately actionable without per-day parsing. Coach calls `get_week` for drill-down. |
| 5 | **`get_today_plan` / `get_day` return the 3 new fields automatically** | The tools return the full `ResolvedDay` object (spread or direct). No explicit return-statement change needed — just the description update. |
| 6 | **`buildCell` receives `plannedHikesByWeek: Map<number, ...>` (pre-grouped in `getCalendarMonth`)** | Avoids per-cell DB calls. The month query already fetches planned hikes; grouping by week index is O(n) in memory. |
| 7 | **`CalendarDayCell.conflict` is `{ kind; withDates } | null` (singular, not array)** | One conflict per cell is the right display primitive. If both kinds fire on the same cell (theoretically possible only if Day 6 has a hike on it AND has baselines due — but Flag B requires `hikeOnThisDay === null`, so the two kinds never fire on the same cell from `long-effort`). The priority rule (retest-on-hike > long-effort) is a defensive guard only. |
| 8 | **No `workoutTemplate` mutation — enforced by pure function design** | `reconcileLongEffort` receives `workoutTemplate` as a read-only input and does NOT return it. The `workoutTemplate` field on `ResolvedDay` is set by the existing resolver code before the pure function is called. The test harness asserts `JSON.stringify(tmpl)` is unchanged after any call. |
| 9 | **`rotationWeekWindow` is unexported (internal helper)** | Only `resolveDay` and `weekConflicts` (both in `calendar.ts`) call it. Exporting would tempt callers to bypass the normal resolution path. If Track 2 needs it, export then. |
| 10 | **`retest-on-hike-day` lint rule calls `weekConflicts` for each week that has planned hikes** | Keeps lint as a thin delegating caller (design §8 requirement). Overhead: 2 queries × (number of weeks with planned hikes) — typically 1–3 for a live plan. Acceptable. |
| 11 | **No Track 2 items touch this blueprint** | `Plan.confirmedThroughDate`, `confirm_week`, `reopen_week`, `CalendarDayCell.confidence`, `log_review` confirm extension, and any `CalendarMonth.tsx` visual changes are explicitly out of scope. The `WeekConflict` type exported here is the coupling surface Track 2 will consume. |

---

## 13. Design §6 Edge-Case Coverage Table

Verification that every §6 case is handled by the type/algorithm choices above:

| §6 Case | Handled by |
|---|---|
| No hike this week | `plannedHikesThisWeek = []` → `reconcileLongEffort` returns all null/false; Day 6 renders normally; no `weekConflicts` output |
| Hike on the Day-6 date | `hikeOnThisDay` populated → Flag A; `hikesElsewhere = []` → no Flag B; `weekConflicts` returns [] (no long-effort conflict) |
| Hike on non-Day-6 date | Flag A on hike date; Flag B (`longEffortConflict`) on Day-6; `weekConflicts` emits `long-effort` |
| 2+ hikes same week | Flag A on each hike date; `longEffortConflict.plannedHikeDates` lists all; `weekConflicts` lists all; lint `multiple-hikes-one-week` (info) |
| Retest week + hike same day | Both `workoutDeferredForBaseline` and `workoutDeferredForHike` fire; `weekConflicts` emits `retest-on-hike`; lint `retest-on-hike-day` (warning) |
| Hike outside plan window | `weekWindow = null` → planned-hike query skipped → no flags on any day; lint `hike-outside-plan` (warning) |
| Explicit override | `isOverride = true` → `reconcileLongEffort` returns all null/false; `weekConflicts` skips the overridden day |
| DST week | `rotationWeekWindow` uses `addDays`/`startOfDay`/`endOfDay` (USER_TZ-aware); all date comparisons via `dateKey` (USER_TZ-aware Intl) |
| Hike lands on rest day | `plannedHikeToday` set; `workoutDeferredForHike = false` (category === "rest") |
| No active program | `program = null` → `weekWindow = null` → no query → all new fields null/false |
| Completed hike | v1 filter `status:"planned"` — completed hikes excluded from all conflict detection |
