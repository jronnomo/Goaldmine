# Research Output — Cold-Start Ergonomics

**Date:** 2026-06-03  
**Feature:** Cold-Start Ergonomics (PRD: `docs/prds/PRD-cold-start-ergonomics.md`)  
**Agent:** Research Agent  

---

## 1. tools.ts Insertion Points

### File: `src/lib/mcp/tools.ts` — 2,697 lines total

#### Function Boundaries

| Function | Start line | Closing `}` line |
|---|---|---|
| `registerAll` | 492 | 514 |
| `registerReadTools` | 520 | 1251 |
| `registerWriteTools` | 1275 | 2697 |

#### Best Insertion Points for New Tools

**New read tools** (get_session_brief, list_open_items, get_latest_review):
- Insert **after `get_records_summary`** (ends at line 935) and before `get_exercise_history` (starts line 937).
- Exact insertion: after the closing `);` of `get_records_summary` at line ~935, before line 937 `server.registerTool("get_exercise_history"`.
- Alternative: after `get_nutrition_history` (closes ~line 1034) and before `find_exercise_in_plan` — keeps nutrition/session tools clustered.
- **Recommended:** Insert all three read tools as a block between `get_records_summary` (line 935) and `get_exercise_history` (line 937). Rationale: session-brief and its sub-parts (open_items, latest_review) are new first-class objects; inserting after the records cluster groups them thematically and before the exercise-history tools avoids splitting the history block.

**New write tools** (log_open_item, resolve_open_item, log_review):
- Insert **after `log_note`** (tool registered at line 1596–1604) and before `log_nutrition` (line 1607).
- `log_note` closes at line 1605. Insert the three new write tools at line 1606+.
- This keeps all note-family write tools adjacent: `log_note` → `log_open_item` → `resolve_open_item` → `log_review`.

#### NoteTypeShape (line 63)

```ts
// Line 63
const NoteTypeShape = z.enum(["journal", "audible", "feedback", "standing_rule"]);
```

**Required change:** add `"review"` → `z.enum(["journal", "audible", "feedback", "standing_rule", "review"])`.  
`"open_item"` is NOT added to NoteTypeShape — per PRD §3.3, `open_item` is written only by `log_open_item`/`resolve_open_item`, not via the generic `log_note` path. Only `"review"` joins the enum.

**All places NoteTypeShape is consumed (must stay consistent):**

| Location | Usage |
|---|---|
| `LogNoteShape` (line 132–136) | `type: NoteTypeShape.default("journal")` — input schema for `log_note` |
| `LogNoteSchema` (line 137) | `z.object(LogNoteShape)` — reused by `batch_log_note` |
| `update_note` inputSchema (line 2015) | `type: NoteTypeShape.optional()` |
| `promote_note` inputSchema (line 2098) | `type: NoteTypeShape.describe(...)` |

Adding `"review"` to NoteTypeShape enables `log_note(type:"review")`, `update_note(type:"review")`, and `promote_note(type:"review")` — all correct per PRD §3.1 req 8.

**Important:** `update_note` uses `NoteTypeShape` (line 2015), so it will automatically accept `type:"review"` after the enum change. No special-casing needed. `delete_note` uses no enum at all — works on any id.

#### `recent_history` Notes Query (lines 611–614)

Current query (no filter):
```ts
// Lines 611–614
prisma.note.findMany({
  where: { date: { gte: since } },
  orderBy: { date: "desc" },
}),
```

**Required change (REQ-002):** Add a module-level constant and filter:
```ts
// Add at module level (e.g. after NoteTypeShape, ~line 64)
const ACTIVITY_NOTE_TYPES = ["journal", "audible", "feedback"] as const;

// Replace the notes query in recent_history (line 611–614) with:
prisma.note.findMany({
  where: { date: { gte: since }, type: { in: [...ACTIVITY_NOTE_TYPES] } },
  orderBy: { date: "desc" },
}),
```

The `get_today_plan` query at line 533 only queries `type: "standing_rule"` — it is NOT affected by this change.

#### `log_workout` Handler Return (line 1324)

Current return (line 1324):
```ts
return { id: created.id, message: "Workout logged" };
```

Required change (REQ-003): replace with:
```ts
const recordsSet = await recordsSetInWorkout(created.id);
return { id: created.id, message: "Workout logged", recordsSet };
```

`recordsSetInWorkout` is the new helper to add to `src/lib/records.ts`. See section 2.

#### `parseDateInput` Location and Signature

Located at **lines 229–234**:
```ts
// lines 229–234
function parseDateInput(s: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? parseDateKey(s) : new Date(s);
}
```

Private to `tools.ts` (not exported). All new tools requiring date parsing (log_open_item.targetDate, log_review.weekOf) must call this same function — already in scope.

#### `safe()` and `jsonResult` Shape

`safe()` at lines 221–227:
```ts
async function safe<T>(fn: () => Promise<T>) {
  try {
    return jsonResult(await fn());
  } catch (e) {
    return errorResult(e instanceof Error ? e.message : String(e));
  }
}
```

`jsonResult` at lines 208–213:
```ts
function jsonResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}
```

Pattern to throw errors inside `safe()`: throw a plain `Error`:
```ts
throw new Error("Note <id> is type '<t>', not 'open_item'.");
// Caught by safe() → errorResult(message) → { content: [...], isError: true }
```

#### ExerciseInputShape

Defined at **lines 1267–1273** (module-level const, inside `tools.ts` but before `registerWriteTools`):
```ts
const ExerciseInputShape = z.object({
  name: z.string(),
  equipment: z.string().optional(),
  orderIndex: z.number().int().min(0),
  notes: z.string().optional(),
  sets: z.array(SetInputShape),
});
```

`SetInputShape` is defined at lines 1257–1265. Both are module-level; `ExerciseInputShape` is used only in `log_workout`'s `inputSchema.exercises`.

---

## 2. records.ts PR-Diff Helper

### File: `src/lib/records.ts` — 411 lines

#### Available Internal Helpers (all module-private unless exported)

| Helper | Signature | Notes |
|---|---|---|
| `epley1RM` | `(weightLb: number, reps: number): number` | `weightLb * (1 + reps/30)`. **Exported**. |
| `bestSetSummary` | `(sets: {weightLb, reps, durationSec}[]): {primary, value, raw} \| null` | **Private** (not exported). Precedence: weighted→reps→duration. For weighted: best Epley 1RM. For reps: max reps. For duration: max durationSec. |
| `metricValue` | `(s: {weightLb, reps, durationSec}, primary): number \| null` | **Private**. Applies `primary` selection to one set. |
| `matchesBest` | `(s, summary): boolean` | **Private**. `Math.abs(metricValue - summary.value) < 0.01`. |
| `getExerciseHistory` | `(name: string, equipment: string \| null): Promise<{summary, history}>` | **Exported**. Full exercise history via `prisma.workoutExercise.findMany`. |
| `getExerciseSummaries` | `(): Promise<ExerciseSummary[]>` | **Exported**. All exercises all-time bests. |

#### Grouping Key Pattern (critical)

All exercise grouping uses the key `${name}|${equipment ?? ""}` (line 270, 271, 288). The new helper MUST replicate this exact key, or equipment-null exercises will never match.

#### bestSetSummary Precedence (detail)

1. If any set has both `weightLb !== null` AND `reps !== null` → `primary = "rm"`, value = Epley 1RM.
2. Else if any set has `reps !== null` → `primary = "reps"`, value = max reps.
3. Else if any set has `durationSec !== null` → `primary = "duration"`, value = max durationSec.
4. Else null (no metric at all).

This is the same precedence `get_records_summary` uses for all-time PRs — the new helper must use it for both the "this workout" best and the "prior best" to compare apples-to-apples.

#### Prior-Best Query Strategy

`getExerciseSummaries()` loads ALL `workoutExercise` rows without a workoutId filter. For "prior best excluding workoutId", the developer cannot reuse it directly — they need an exclusion filter.

**Recommended implementation** (avoids pulling all exercises globally):

```ts
// For each exercise in the target workout, query prior sets for the same
// name+equipment from workouts OTHER than workoutId.
const priorSets = await prisma.workoutExercise.findMany({
  where: {
    name: ex.name,
    equipment: ex.equipment,       // matches null correctly in Prisma
    workout: { id: { not: workoutId } }
  },
  include: { sets: true },
});
const priorSummary = bestSetSummary(priorSets.flatMap(e => e.sets));
```

Prisma `equipment: ex.equipment` where `ex.equipment === null` correctly translates to `IS NULL` — this is standard Prisma null-equality behavior. No need to replicate the string-key trick in the DB query (only needed for in-memory Maps).

#### Proposed Function Signature

```ts
// In src/lib/records.ts — export this function

export type RecordSet = {
  name: string;
  equipment: string | null;
  kind: "rm" | "reps" | "duration";
  value: number;   // the new best (Epley 1RM lb, max reps, or max durationSec)
  prior: number;   // the prior best (same metric, excluding workoutId)
  raw: { weightLb: number | null; reps: number | null; durationSec: number | null }; // new best raw set
};

export async function recordsSetInWorkout(workoutId: string): Promise<RecordSet[]>
```

**Algorithm:**
1. Load all exercises (with sets) in `workoutId`.
2. For each unique `name+equipment` group within the workout:
   a. Compute `thisSummary = bestSetSummary(all sets across all exercises with this name in this workout)`.
   b. If `thisSummary === null` → skip (no metric at all).
   c. Query `priorSets` = sets from OTHER workouts for this name+equipment.
   d. Compute `priorSummary = bestSetSummary(priorSets)`.
   e. If `priorSummary === null` → skip (brand-new exercise; no prior to beat — matches PRD edge case: "brand-new exercise, not a PR").
   f. If `priorSummary.primary !== thisSummary.primary` → the metric type changed; skip or compare using `thisSummary.primary` (use `thisSummary.primary` for both, compute `metricValue(priorSet, thisSummary.primary)` across prior sets).
   g. If `thisSummary.value > priorSummary.value` → this is a PR. Append to results.

**Note on step (f):** In practice primary type doesn't change for a named exercise (you don't go from weighted to bodyweight-only), but if it does, the safest approach is to use `thisSummary.primary` to select the prior metric too. That's consistent with how `getExerciseHistory` works.

**Gotchas:**
- Must exclude the just-created workout from prior: `workout: { id: { not: workoutId } }`.
- Equipment matching: use `equipment: ex.equipment` in Prisma where clause (null-safe).
- The function should `import { prisma } from "@/lib/db"` — already imported at the top of records.ts.
- `bestSetSummary` is private. Either re-export it or copy the logic inline. **Recommended:** export `bestSetSummary` from records.ts (it's already used internally; exporting it avoids duplication). OR keep it private and use only the public `getExerciseHistory` API — but that pulls more data than needed per exercise. Best approach: export `bestSetSummary` and `metricValue` as package-internal exports.

---

## 3. Week → Phase Derivation for get_session_brief

### ProgramTemplate.phases Shape (from `src/lib/program-template.ts`)

```ts
export type Phase = {
  index: 1 | 2 | 3;
  name: string;
  weeks: number[];  // e.g. [1, 2, 3, 4] — array of week numbers IN the phase
  goal: string;
  emphasis: string;
  nutrition: NutritionGuidance;
  mobility: MobilityFocus;
};
```

The `weeks` field is an **array of 1-based week numbers** (e.g. phase 1 = `[1,2,3,4]`, phase 2 = `[5,6,7,8]`, phase 3 = `[9,10,11,12]`). It is NOT a range object — it's the discrete list.

**Phase lookup from weekIndex:**
```ts
const phase = template.phases.find(p => Array.isArray(p?.weeks) && p.weeks.includes(weekIndex));
// Returns Phase | undefined. Null-safe with optional chaining.
// result: { index, name, weeks, ... } — use { index: phase.index, name: phase.name }
```

This is exactly the same pattern used in `getTodayContext` (src/lib/program.ts line 81):
```ts
const phase = phasesArr.find((p) => Array.isArray(p?.weeks) && p.weeks.includes(weekIndex)) ?? phasesArr[0] ?? null;
```

**Important difference:** `getTodayContext` falls back to `phasesArr[0]` when weekIndex isn't in any phase. For `get_session_brief`, PRD §6 says `plan.phase = null` when no phase matches — do NOT fall back to `phasesArr[0]`.

### resolveDay vs getTodayContext

- `resolveDay(now)` (in `src/lib/calendar.ts:273`) is the **override-aware** function. It reads `weekIndex` from the actual plan start date accounting for overrides. Returns `ResolvedDay.weekIndex: number | null`.
- `getTodayContext(program, now)` (in `src/lib/program.ts:49`) is NOT override-aware; it re-derives weekIndex from scratch without checking for date overrides.
- **For `get_session_brief`**: use `resolveDay(new Date())` and read `.weekIndex`. This is override-aware per PRD §4.6.

**`resolveDay` weekIndex derivation** (lines 317–323 of calendar.ts):
```ts
const daysDelta = Math.floor((dayStart.getTime() - startMid.getTime()) / (24 * 3600 * 1000));
if (daysDelta >= 0 && daysDelta < program.template.totalWeeks * 7) {
  isInPlan = true;
  rotationDay = (((daysDelta % 7) + 7) % 7) + 1;
  weekIndex = Math.floor(daysDelta / 7) + 1;
```

`weekIndex` is 1-based, capped implicitly by the `daysDelta < totalWeeks*7` guard.

### getActiveProgram and ActiveProgramSnapshot

`getActiveProgram()` (src/lib/program.ts:21):
```ts
export type ActiveProgramSnapshot = {
  id: string;
  name: string;       // Plan.name — the plan's display name
  startedOn: Date;
  template: ProgramTemplate;  // planJson cast to ProgramTemplate
};
```

For `get_session_brief`, access:
- `program.name` → `plan.name`
- `program.template.totalWeeks` → total weeks
- active Plan `weeks` field → use a separate `prisma.plan.findFirst` call to get `Plan.weeks` (the calendar weeks count, not the template's `totalWeeks`). **Or** just use `program.template.totalWeeks` — they should agree post-migration. Use `program.template.totalWeeks` for simplicity.

### Full Plan + Goal Read for get_session_brief

The tool needs both the plan (for week/phase) and the active goal (for objective, targetDate, kind, daysToGo). Since `resolveDay` already loads the plan, but not the goal's targetDate directly, `get_session_brief` should:

```ts
const [resolved, activeGoal] = await Promise.all([
  resolveDay(new Date()),
  prisma.goal.findFirst({
    where: { active: true },
    orderBy: { updatedAt: "desc" },
    select: { id: true, objective: true, targetDate: true, kind: true },
  }),
]);
// weekIndex from resolved.weekIndex
// phase from template.phases.find(...)
// plan name from getActiveProgram() — but resolveDay internally calls getActiveProgram.
// Problem: resolveDay does NOT expose the program's name directly on ResolvedDay.
```

**Issue:** `ResolvedDay` does not include `plan.name` or `plan.totalWeeks`. To get `plan.name`, `plan.weeks` (totalWeeks), and `plan.startedOn`, the developer should call `getActiveProgram()` in parallel with `resolveDay`. Both call `getActiveProgram()` internally anyway, but since they're separate `await`s, there's minor DB overhead. Since this is a cold-start tool called once, it's acceptable.

```ts
const [resolved, program, activeGoal, standingRules, recentWorkouts, recentHikes, latestReview, openItems, latestMeasurements] = await Promise.all([
  resolveDay(new Date()),
  getActiveProgram(),
  prisma.goal.findFirst({ where: { active: true }, orderBy: { updatedAt: "desc" }, select: {...} }),
  // ... other parallel reads
]);
// plan.name = program?.name
// plan.totalWeeks = program?.template.totalWeeks
// plan.week = resolved.weekIndex
// plan.phase = program?.template.phases.find(p => p.weeks.includes(resolved.weekIndex))
```

---

## 4. Calendar Helpers for the Brief

All helpers confirmed available via import in `tools.ts` (already imported at lines 13–23):

```ts
import {
  addDays,
  dateKey as toDateKey,
  endOfDay,
  ...
  parseDateKey,
  resolveDay,
  ...
  startOfDay,
  ...
} from "@/lib/calendar";
```

### Confirmed Signatures (from `src/lib/calendar.ts`)

| Function | Signature | Location |
|---|---|---|
| `dateKey` | `(d: Date): string` — returns `"yyyy-mm-dd"` in USER_TZ | line 615 |
| `parseDateKey` | `(k: string): Date` — USER_TZ midnight | line 620 |
| `startOfDay` | `(d: Date): Date` — USER_TZ midnight of same day | line 625 |
| `endOfDay` | `(d: Date): Date` — USER_TZ 23:59:59.999 of same day | line 630 |
| `addDays` | `(d: Date, days: number): Date` — USER_TZ-correct day shift (midnight) | line 662 |

**Note:** There is a LOCAL `addDays` in records.ts (line 240) that wraps `endOfDay(addDaysCal(d, n))` — this is specifically for baseline window calculations and is NOT the calendar's `addDays`. The calendar's `addDays` returns midnight (not end-of-day), which is correct for get_session_brief's date arithmetic.

### daysToGo Computation

```ts
// Whole days between startOfDay(now) and startOfDay(goal.targetDate), USER_TZ
const todayMidnight = startOfDay(new Date());
const targetMidnight = startOfDay(goal.targetDate);
const daysToGo = Math.round(
  (targetMidnight.getTime() - todayMidnight.getTime()) / (1000 * 60 * 60 * 24)
);
// Negative = overdue (targetDate already passed)
```

No raw `getDate()` / `setHours()` — uses only `startOfDay`.

### overdue Computation (for open_items)

```ts
const now = startOfDay(new Date());
const overdue = item.targetDate !== null && item.targetDate < now;
```

`item.targetDate` is stored as midnight USER_TZ (via `parseDateInput`). Comparison is correct because both sides are midnight instants. Note: Prisma returns `DateTime` as JS `Date` objects in UTC milliseconds; `startOfDay(new Date())` returns the USER_TZ midnight instant. The `<` comparison is on UTC ms, so this is correct as long as targetDate was stored via `parseDateInput` (which uses `parseDateKey` for bare dates → USER_TZ midnight).

### Weight-Trend Lookback

**Goal:** find nearest measurement with non-null `weightLb` at/around `addDays(now, -7)` and `addDays(now, -30)`.

**Recommended approach** (compact, no raw date arithmetic):
```ts
const cutoff30 = addDays(startOfDay(new Date()), -31); // fetch enough history
const measurements = await prisma.measurement.findMany({
  where: { date: { gte: cutoff30 }, weightLb: { not: null } },
  orderBy: { date: "asc" },
  select: { date: true, weightLb: true },
});
// latest = measurements.at(-1) (most recent)
// target7d = addDays(startOfDay(new Date()), -7)
// target30d = addDays(startOfDay(new Date()), -30)
// Find nearest to target: sort by |date - target|, take first
```

For "nearest to -7d" and "nearest to -30d", find the measurement whose date is closest (minimum absolute distance):
```ts
function nearestMeasurement(
  measurements: { date: Date; weightLb: number | null }[],
  target: Date
): { date: Date; weightLb: number } | null {
  let best: typeof measurements[number] | null = null;
  let bestDist = Infinity;
  for (const m of measurements) {
    if (m.weightLb === null) continue;
    const dist = Math.abs(m.date.getTime() - target.getTime());
    if (dist < bestDist) { best = m; bestDist = dist; }
  }
  return best as { date: Date; weightLb: number } | null;
}
const delta7d = m7d && latest ? latest.weightLb - m7d.weightLb : null;
const delta30d = m30d && latest ? latest.weightLb - m30d.weightLb : null;
```

**today** for the brief: `dateKey(new Date())` — already imported as `toDateKey` in tools.ts.

---

## 5. Note Write Patterns

### logNoteCore (lines 440–450)

```ts
async function logNoteCore(db: DbClient, input: LogNoteInput): Promise<{ id: string; message: string }> {
  const n = await db.note.create({
    data: {
      body: input.body,
      type: input.type,
      targetDate: input.targetDate ? startOfDay(parseDateKey(input.targetDate)) : null,
      lastAcknowledgedAt: input.type === "standing_rule" ? new Date() : null,
    },
  });
  return { id: n.id, message: "Note logged" };
}
```

**Pattern for new write helpers:**
- New tools like `log_open_item` and `log_review` follow the same `prisma.note.create` pattern.
- `log_open_item` stores `priority` in the new `priority` column (nullable String).
- `log_review` stores `weekOf` as `targetDate` via `parseDateInput`.
- Both return `{ id: string; message: string }`.
- Both should be plain `prisma.note.create` calls inside `safe(async () => { ... })`, NOT extracted into separate core functions (no batch variant needed for these tools, per requirements).

### resolve/resolvedAt/resolvedReason Pattern

Two patterns for setting `resolvedAt`:

1. **`acknowledge_notes`** (line 828–832): `updateMany` with `{ resolvedAt: new Date(), resolvedReason: reason }`. Returns `{ resolved: count, message }`.
2. **`apply_plan_revision`** (line 1819–1823): `updateMany` with `{ resolvedAt: r.createdAt, resolvedReason: "applied via revision ${r.id}" }`.

For `resolve_open_item`:
```ts
// Pattern: findUnique to verify type, then update
const note = await prisma.note.findUniqueOrThrow({ where: { id } });
if (note.type !== "open_item") {
  throw new Error(`Note ${id} is type '${note.type}', not 'open_item'.`);
}
const updated = await prisma.note.update({
  where: { id },
  data: { resolvedAt: new Date(), resolvedReason: reason },
});
return { id: updated.id, message: "Open item resolved" };
```

### promote_note Pattern (lines 2107–2128)

Pattern for type-checking before update + conditional timestamp stamp:
```ts
const existing = await prisma.note.findUniqueOrThrow({ where: { id } });
// guard on existing.type if needed
const updated = await prisma.note.update({
  where: { id },
  data: { type, lastAcknowledgedAt: ... },
});
return { id: updated.id, fromType: existing.type, toType: updated.type, ... };
```

### acknowledge_standing_rule Error Throw Pattern (lines 2140–2145)

```ts
if (existing.type !== "standing_rule") {
  throw new Error(
    `Note ${id} is type='${existing.type}', not 'standing_rule'. Use promote_note first ...`
  );
}
```

The `{ id, message }` convention is the universal `{ id: string; message: string }` return. Every single-op write tool returns this shape. The new tools should match it.

### batch_log_note (lines 2656–2696)

Uses `logNoteCore(tx, operations[i])` — the `DbClient`-parameterized core. Since `log_open_item` and `resolve_open_item` do NOT have a batch variant (requirements say no batch needed), they do NOT need a `*Core` helper pattern. Direct `prisma.note.create/update` inside `safe()` is sufficient.

---

## 6. Risks

### Migration Safety (Neon shared with prod)

`Note.priority String?` is a **nullable String column with no default**. The migration SQL will be:
```sql
ALTER TABLE "Note" ADD COLUMN "priority" TEXT;
```
This is a safe additive nullable column. All existing rows will have `priority = NULL`. No backfill required. No index required (open items are low-volume; app-level sort is fine).

**Validation step before running:** inspect the migration diff file created by `prisma migrate dev --name note-priority` and verify it is exactly one `ALTER TABLE ... ADD COLUMN ... NULL` statement before executing against Neon.

### 'review'/'open_item' in Type Strings — Breaking Risk Assessment

**No existing 'review' or 'open_item' type values exist anywhere in the codebase.** Confirmed by grep — zero matches on those strings as note type values.

**Places that enumerate note types (must update descriptions, not logic):**

| Location | Current text | Risk |
|---|---|---|
| `Note.type` schema comment (schema.prisma line 89) | `// audible | journal | feedback | standing_rule` | Low — comment only; update for accuracy |
| `log_note` description (tools.ts line 1601) | lists `"Audible / journal / feedback / standing_rule"` | Low — description only |
| `delete_note` description (line 2078) | `"any type (journal, audible, feedback, standing_rule)"` | Low — description only |
| `getPendingNotesCount` (calendar.ts line 534) | `type: { in: ["audible", "feedback"] }` | **Safe** — hardcoded to specific types, not blocking new types |
| `get_today_plan` standing-rule query (line 533) | `where: { type: "standing_rule", resolvedAt: null }` | **Safe** — only queries standing_rule, won't accidentally include new types |
| `list_promotable_notes` (lines 789–793) | `["feedback"]` or `["feedback", "standing_rule"]` | **Safe** — explicit list, won't accidentally include new types |
| `promote_note.type` inputSchema (line 2098) | `NoteTypeShape` | Will gain `"review"` after enum change — correct behavior, promotes any type |

**Critical: `update_note` accepts `type: NoteTypeShape`** (line 2015). After adding `"review"` to `NoteTypeShape`, `update_note` can set type to `"review"` on any note. This is intentional and correct per PRD §3.2 req 14: "update_note/delete_note continue to work on the new types."

**`acknowledge_standing_rule` guard** (line 2141): `if (existing.type !== "standing_rule")` — this correctly rejects `"review"` and `"open_item"` without any change needed.

**No switch statements on `note.type` exist anywhere in the codebase.** The grep confirmed no `switch.*type` or `case.*type` patterns in tools.ts. All type checks are string equality or `in` array comparisons — all safe.

### get_session_brief Override-Awareness

`resolveDay(new Date())` is used per PRD §4.6. The `resolveDay` function (calendar.ts line 273) correctly:
1. Calls `getActiveProgram()` to get the plan.
2. Computes `weekIndex` from `Math.floor(daysDelta / 7) + 1`.
3. Does NOT check for per-day plan overrides for the week/rotation computation (overrides only affect `workoutTemplate`, `baselinesDue`, `nutritionText`, etc., not the week counter).

So `resolveDay(now).weekIndex` gives the correct calendar-position week, same as what any other tool would report. There's no "override-aware weekIndex" concept — weekIndex is purely positional from `startedOn`. The override-awareness concern in the PRD is about getting the WORKOUT template, which we're NOT using in `get_session_brief` (only `weekIndex` for phase lookup). This is safe.

**Caveat:** If `resolved.isInPlan === false` (before plan start or after plan end), `resolved.weekIndex === null`. The developer must null-check: `plan: resolved.isInPlan && program ? { name, week: resolved.weekIndex, ... } : null`.

### Confirmed: No Existing 'review'/'open_item' Usage

Search results confirm zero uses of `'review'` or `'open_item'` as `note.type` values in the DB layer, app code, or tool descriptions. The new types are genuinely additive — no existing data or code path treats `review` or `open_item` as reserved.

---

## Appendix A: Full ExerciseSummary Type (for RecordSet context)

```ts
// From records.ts lines 55–65
export type ExerciseSummary = {
  name: string;
  equipment: string | null;
  sessionCount: number;
  totalSets: number;
  primary: "rm" | "reps" | "duration";
  bestValue: number;
  bestRaw: { weightLb: number | null; reps: number | null; durationSec: number | null };
  bestDate: Date;
};
```

`RecordSet.kind` maps to `ExerciseSummary.primary`. `RecordSet.value` maps to `bestValue` (of the new workout). `RecordSet.raw` maps to `bestRaw` (of the new workout's best set).

## Appendix B: ResolvedDay Type (for get_session_brief)

```ts
// From calendar.ts lines 225–271
export type ResolvedDay = {
  date: Date;
  dateKey: string;
  isInPlan: boolean;
  isGoalDate: boolean;
  rotationDay: number | null;
  weekIndex: number | null;
  workoutTemplate: DayTemplate | null;
  isOverride: boolean;
  workoutDeferredForBaseline: boolean;
  nutritionText: string | null;
  nutritionPlan: NutritionPlan | null;
  mobilityText: string | null;
  notes: string | null;
  workouts: {...}[];
  loggedNutrition: {...}[];
  baselinesDue: {...}[];
  notesAboutDate: {...}[];
  goalObjective: string | null;
  override?: {...} | null;
};
```

For `get_session_brief`, only `resolved.weekIndex` and `resolved.isInPlan` are needed from the `resolveDay` call. The rest comes from parallel DB reads.

## Appendix C: Goal Schema Fields Available

From `prisma/schema.prisma` (lines 163–193):
```
Goal.id, .objective, .targetDate, .notes, .status, .active, .targets, .references, .legend, .kind, .githubRepo, .githubProjectNumber
```

For `get_session_brief`: `select { id, objective, targetDate, kind }` from `prisma.goal.findFirst`.

`daysToGo = Math.round((startOfDay(goal.targetDate) - startOfDay(now)) / MS_PER_DAY)` — negative means overdue.

---

*End of research output.*
