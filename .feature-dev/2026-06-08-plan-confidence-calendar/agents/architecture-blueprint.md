# Architecture Blueprint — Track 2: Plan-Confidence Calendar Visual + MCP Confirm Tools

**Author:** Architect Agent  
**Date:** 2026-06-08  
**Feature:** `plan-confidence-calendar`  
**Scope:** REQ-001 → REQ-007 (single-agent-sequential — see §8)  
**Depends on:** Track 1 shipped at `747f8d0` (`weekConflicts`, `WeekConflict`, `CalendarDayCell.conflict`)

---

## 1. File Plan

| Action | Path | Purpose | Key Exports / Changes | Deps |
|--------|------|---------|----------------------|------|
| MODIFY | `prisma/schema.prisma` | Add `confirmedThroughDate DateTime?` to `Plan` | New nullable column | — |
| MODIFY | `src/lib/program.ts` | Add `confirmedThroughDate` to `ActiveProgramSnapshot` type + `getActiveProgram` return | `ActiveProgramSnapshot.confirmedThroughDate: Date \| null` | REQ-001 |
| MODIFY | `src/lib/calendar.ts` | Add `confidence` to `CalendarDayCell` + `ResolvedDay`; derive in `buildCell` + `resolveDay`; no new query | `CalendarDayCell.confidence`, `ResolvedDay.confidence` | REQ-001 (type), REQ-002 |
| MODIFY | `src/lib/mcp/tools.ts` | Add `confirm_week`, `reopen_week` tools; extend `log_review`; add shared `guardedAdvanceConfirmedThrough` helper | 2 new registered tools + `log_review` extension | REQ-001, Track-1 `weekConflicts` already imported at line 23 |
| MODIFY | `src/components/CalendarMonth.tsx` | Week-row refactor; add `WeekRail` inline or via import; extend `DayCell` with provisional cue + conflict wedge; add flip localStorage gate | Visual track | REQ-002 (`confidence` on cells) |
| CREATE | `src/components/WeekRail.tsx` | Presentational rail spine + cap; pure, no hooks | `WeekRail` (exported) | REQ-002 |
| MODIFY | `src/app/globals.css` | Add `.week-confirm-pop` alias class reusing `bullseye-pop` keyframe (only if the class name must differ) + `.day-conflict-wedge` pseudo-element utility | Minimal — see §6 | — |
| MODIFY | `src/app/calendar/page.tsx` | Pass `confirmedThroughDate` prop to `CalendarMonth` (extracted from `program`) | New prop on `<CalendarMonth>` | REQ-001 |

**Constraint:** `WeekRail.tsx` may be inlined into `CalendarMonth.tsx` if the implementer prefers. Either way it is purely presentational and carries no state.

---

## 2. Prisma Migration

### Exact field addition (in `Plan` model, after the `planJson Json` line, ~line 245)

```prisma
confirmedThroughDate  DateTime?  // high-water mark: every in-plan day with
                                  // date <= this is "confirmed". null = none confirmed.
```

### Migration name

```
npx prisma migrate dev --name add_plan_confirmed_through_date
```

### Expected SQL diff (validate before running)

```sql
ALTER TABLE "Plan" ADD COLUMN "confirmedThroughDate" TIMESTAMP(3);
```

Single `ADD COLUMN … NULL` with no default — **additive and non-breaking**. Existing rows get `NULL`, which the application treats as "nothing confirmed yet" (all future days provisional). This is the correct initial state.

### Post-commands

```bash
npx prisma generate    # regenerates src/generated/prisma; must run before tsc
```

### Neon safety note

⚠ Neon is the shared prod DB. Validate the migration SQL diff shows exactly the single `ALTER TABLE … ADD COLUMN … NULL` before running `migrate dev`. Any backfill is explicitly NOT needed — `null` is the correct default state.

---

## 3. Type Definitions

### 3.1 `ActiveProgramSnapshot` (in `src/lib/program.ts`)

```ts
export type ActiveProgramSnapshot = {
  id: string;
  name: string;
  startedOn: Date;
  template: ProgramTemplate;
  confirmedThroughDate: Date | null;   // NEW — high-water mark from Plan; null for Program fallback
};
```

`getActiveProgram` change: the `prisma.plan.findFirst` call has no explicit `select`, so `confirmedThroughDate` is returned automatically after the migration. Add it to the returned snapshot:

```ts
return {
  id: plan.id,
  name: plan.name,
  startedOn: plan.startedOn,
  template: plan.planJson as unknown as ProgramTemplate,
  confirmedThroughDate: plan.confirmedThroughDate ?? null,   // NEW
};
```

For the `Program` fallback path (no active `Plan`), the `Program` table has no such column — always return `null`:

```ts
return {
  id: program.id,
  name: program.name,
  startedOn: program.startedOn,
  template: program.planJson as unknown as ProgramTemplate,
  confirmedThroughDate: null,   // NEW — Program table has no confirmedThroughDate
};
```

### 3.2 `CalendarDayCell.confidence` (in `src/lib/calendar.ts`, add to the type ~line 9)

```ts
// Derived in buildCell from program.confirmedThroughDate. Drives the week-row
// confidence rail visual (Track 2). null when !isInPlan (out-of-plan/padding cells).
confidence: "past" | "confirmed" | "provisional" | null;
//   null        := !isInPlan (out-of-month padding, before startedOn, after endsOn)
//   "past"      := isInPlan && isPast (includes today? no — isToday treated as !isPast)
//   "confirmed" := isInPlan && !isPast && program.confirmedThroughDate != null
//                  && startOfDay(date) <= startOfDay(confirmedThroughDate)
//   "provisional":= isInPlan && (isFuture || isToday) && (no mark OR date > mark)
```

### 3.3 `ResolvedDay.confidence` (in `src/lib/calendar.ts`, add to `ResolvedDay` type ~line 315)

```ts
// Confidence state for MCP parity with CalendarDayCell. Same derivation.
// Should-have: allows get_day / get_today_plan to surface confidence without
// a second query — the program snapshot already carries confirmedThroughDate.
confidence: "past" | "confirmed" | "provisional" | null;
```

### 3.4 Confidence derivation helper signature (pure, used in both `buildCell` and `resolveDay`)

Extract as a private helper at module level in `calendar.ts`:

```ts
/** Derive confidence for a single date given the program snapshot.
 *  Pure — no IO. Returns null when date is not in-plan. */
function deriveConfidence(
  date: Date,
  isInPlan: boolean,
  isPast: boolean,
  program: ActiveProgramSnapshot | null,
): CalendarDayCell["confidence"] {
  if (!isInPlan) return null;
  if (isPast) return "past";
  const mark = program?.confirmedThroughDate ?? null;
  if (mark != null && startOfDay(date).getTime() <= startOfDay(mark).getTime()) {
    return "confirmed";
  }
  return "provisional";
}
```

Note: `isToday` is included in the `!isPast` branch — today can be "confirmed" if `confirmedThroughDate >= today`.

### 3.5 `WeekRail` props

```ts
type WeekRailProps = {
  cells: CalendarDayCell[];          // the 7 cells of this week row (may include out-of-plan padding)
  weekIndex: number | null;          // from the first in-plan cell — used for localStorage key
  confirmedThroughDate: Date | null; // for "past-confirmed" detection on fully-past rows
  startedOn: Date;                   // for week-end boundary math
};
```

See §6 for derived `railState` logic.

---

## 4. Confidence Derivation

### 4.1 In `buildCell` (~line 154)

No signature change to `buildCell` is required — `args.program` already exists and will carry `confirmedThroughDate` after the type update.

Add to the computed fields section (after the `conflict` computation, before the `return`):

```ts
const confidence = deriveConfidence(
  args.date,
  isInPlan,
  isPast,
  args.program,
);
```

Add `confidence` to the return object of `buildCell`.

### 4.2 In `resolveDay` (~line 576)

Add at the point where the final return value is assembled. `resolveDay` already has `isInPlan`, `dayStart`, and `program`:

```ts
const todayForConfidence = startOfDay(new Date());
const isPastForConfidence = dayStart.getTime() < todayForConfidence.getTime();
const confidence = deriveConfidence(dayStart, isInPlan, isPastForConfidence, program);
```

Include `confidence` in the returned `ResolvedDay` object.

### 4.3 Threading through `getCalendarMonth`

No change is needed to `buildCell`'s args — `program` is already passed in and carries `confirmedThroughDate` after the type change. In `getCalendarMonth`, the `buildCell(...)` call at ~line 131 is unchanged.

`getCalendarMonth` already returns `program` in its result object (~line 145). The page extracts it.

### 4.4 Edge cases for `deriveConfidence`

| Scenario | `isPast` | `confirmedThroughDate` | Result |
|----------|----------|----------------------|--------|
| Out-of-plan padding cell | — | — | `null` |
| Past in-plan day (today is, say, week 4) | true | any | `"past"` |
| Future/today day, no mark | false | null | `"provisional"` |
| Future/today day, mark < date | false | some earlier date | `"provisional"` |
| Future/today day, mark >= date | false | some date >= cell | `"confirmed"` |
| Today exactly, mark = today | false | today's end-of-day | `"confirmed"` |
| `confirmedThroughDate` null (fresh plan, existing plans) | — | null | `"provisional"` for all future |

---

## 5. MCP Tools

### 5.1 Shared guarded-advance helper (add as module-level `async function` in `tools.ts`)

This MUST be a shared helper to satisfy REQ-004's "no duplication" requirement. Place it just above `registerWriteTools`.

```ts
/**
 * Advance Plan.confirmedThroughDate to the end of targetWeekIndex.
 * Guards: refuses (returns ok:false) if any week in the newly-covered span
 * (currentConfirmedWeek+1 … targetWeekIndex) has unresolved weekConflicts.
 * Clamps: refuses if targetWeekIndex > program.template.totalWeeks.
 *
 * Callers: confirm_week, log_review (confirmThroughWeekEnd).
 */
async function guardedAdvanceConfirmedThrough(
  program: ActiveProgramSnapshot,  // must include confirmedThroughDate after REQ-001
  targetWeekIndex: number,
): Promise<
  | { ok: true; confirmedThroughDate: Date }
  | { ok: false; blockedBy: WeekConflict[]; reason?: string }
> { ... }
```

**Internal logic (narrative, not production code):**

1. **Clamp guard:** if `targetWeekIndex > program.template.totalWeeks`, return `{ ok: false, blockedBy: [], reason: "weekIndex exceeds totalWeeks" }`.

2. **Current confirmed week derivation:**
   ```ts
   // confirmedThroughDate is endOfDay of the last day of the last confirmed week.
   // Its day-delta from startedOn gives us the confirmed week index.
   const currentWeekIdx: number = (() => {
     if (!program.confirmedThroughDate) return 0;
     const startMid = startOfDay(program.startedOn);
     const markMid  = startOfDay(program.confirmedThroughDate);
     const delta = Math.floor(
       (markMid.getTime() - startMid.getTime()) / (24 * 3600 * 1000)
     );
     return delta < 0 ? 0 : Math.floor(delta / 7) + 1;
   })();
   ```

3. **Guard span:** check weeks `currentWeekIdx + 1` through `targetWeekIndex` (inclusive). For each week `w` in this range, call `await weekConflicts(program, w)`. Accumulate all returned `WeekConflict[]`. If the accumulated array is non-empty, return `{ ok: false, blockedBy: accumulated }` — the mark is NOT written.

4. **Write:** compute target date:
   ```ts
   const targetDate = endOfDay(
     addDays(startOfDay(program.startedOn), (targetWeekIndex - 1) * 7 + 6)
   );
   ```
   Update `Plan.confirmedThroughDate` via the prisma singleton:
   ```ts
   await prisma.plan.update({
     where: { id: program.id },
     data: { confirmedThroughDate: targetDate },
   });
   ```
   Return `{ ok: true, confirmedThroughDate: targetDate }`.

**Note:** `weekConflicts` is already imported in `tools.ts` at line 23. `addDays`, `endOfDay`, `startOfDay` are all imported at lines 12-14. No new imports required.

---

### 5.2 `confirm_week` tool

**Register in `registerWriteTools`** (after `reopen_week`; keep the pair adjacent).

```ts
server.registerTool(
  "confirm_week",
  {
    title: "Confirm (lock) a rotation week",
    description:
      "Advance Plan.confirmedThroughDate to the end of the given rotation weekIndex. " +
      "Refused if any week in the newly-covered span has an unresolved conflict " +
      "(long-effort or retest-on-hike) — returns blockedBy listing the conflicts. " +
      "Call reopen_week to move the mark backward. Coach-driven only; the app never auto-advances.",
    inputSchema: {
      weekIndex: z
        .number()
        .int()
        .min(1)
        .describe("Rotation week number (1-based) to confirm through."),
    },
  },
  async (input) =>
    safe(async () => {
      const program = await getActiveProgram();
      if (!program) throw new Error("No active plan to confirm.");
      return guardedAdvanceConfirmedThrough(program, input.weekIndex);
    }),
);
```

**Return shape:**
```json
// success
{ "ok": true, "confirmedThroughDate": "2026-06-14T05:59:59.999Z" }

// blocked
{ "ok": false, "blockedBy": [
    { "dateKey": "2026-06-14", "kind": "long-effort", "withDates": ["2026-06-13"] }
  ]
}

// out-of-range
{ "ok": false, "blockedBy": [], "reason": "weekIndex exceeds totalWeeks" }
```

**Sample curl:**

```bash
TOKEN="$(grep MCP_AUTH_TOKEN .env | cut -d'"' -f2)"
curl -s -X POST http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"confirm_week","arguments":{"weekIndex":3}}}' \
  | python3 -m json.tool
```

---

### 5.3 `reopen_week` tool

**Register in `registerWriteTools`** immediately after `confirm_week`.

```ts
server.registerTool(
  "reopen_week",
  {
    title: "Reopen (un-confirm) a rotation week",
    description:
      "Move Plan.confirmedThroughDate back to the end of weekIndex-1 (or null if weekIndex ≤ 1). " +
      "Use when a work trip, injury, or plan deviation makes a previously-locked week provisional again. " +
      "No conflict guard — the coach explicitly chooses to reopen.",
    inputSchema: {
      weekIndex: z
        .number()
        .int()
        .min(1)
        .describe("The week to reopen; the mark is set to the end of weekIndex-1 (null if ≤ 1)."),
    },
  },
  async (input) =>
    safe(async () => {
      const program = await getActiveProgram();
      if (!program) throw new Error("No active plan.");
      let newDate: Date | null = null;
      if (input.weekIndex > 1) {
        newDate = endOfDay(
          addDays(startOfDay(program.startedOn), (input.weekIndex - 2) * 7 + 6)
        );
      }
      await prisma.plan.update({
        where: { id: program.id },
        data: { confirmedThroughDate: newDate },
      });
      return {
        ok: true,
        confirmedThroughDate: newDate ? newDate.toISOString() : null,
      };
    }),
);
```

**Return shape:**
```json
// reopen_week(3) — mark moves back to end of week 2
{ "ok": true, "confirmedThroughDate": "2026-06-07T05:59:59.999Z" }

// reopen_week(1) — nulls the mark
{ "ok": true, "confirmedThroughDate": null }
```

---

### 5.4 `log_review` extension (REQ-004)

**Existing handler location:** `tools.ts` line 2073. The current `inputSchema` has `body` and `weekOf`. The return is `{ id, message: "Review logged" }`.

**Change: add optional `confirmThroughWeekEnd` field to the schema object:**

```ts
inputSchema: {
  body: z.string().min(1).describe("The week review / Sunday recap prose."),
  weekOf: DateKeyShape.optional().describe(
    "Week-ending date the review covers (yyyy-mm-dd). Stored so get_latest_review can report it.",
  ),
  confirmThroughWeekEnd: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "If present, advances Plan.confirmedThroughDate to the end of this rotation weekIndex " +
      "as part of the review. Same conflict guard as confirm_week. Omit to skip confirmation.",
    ),
},
```

**Change: extend the handler to call `guardedAdvanceConfirmedThrough` when the field is present:**

```ts
async (input) =>
  safe(async () => {
    const n = await prisma.note.create({
      data: {
        body: input.body,
        type: "review",
        targetDate: input.weekOf ? parseDateInput(input.weekOf) : null,
      },
    });
    // Existing behavior: review is always logged regardless of confirm result.
    let confirmResult:
      | { ok: true; confirmedThroughDate: string }
      | { ok: false; blockedBy: WeekConflict[]; reason?: string }
      | undefined = undefined;

    if (input.confirmThroughWeekEnd !== undefined) {
      const program = await getActiveProgram();
      if (!program) {
        confirmResult = { ok: false, blockedBy: [], reason: "No active plan to confirm." };
      } else {
        const raw = await guardedAdvanceConfirmedThrough(program, input.confirmThroughWeekEnd);
        confirmResult = raw.ok
          ? { ok: true, confirmedThroughDate: raw.confirmedThroughDate.toISOString() }
          : raw;
      }
    }

    return {
      id: n.id,
      message: "Review logged",
      ...(confirmResult !== undefined && { confirm: confirmResult }),
    };
  }),
```

**Return shape (no `confirmThroughWeekEnd`):** `{ id, message: "Review logged" }` — **unchanged, existing tests pass**.

**Return shape (with `confirmThroughWeekEnd`):**
```json
{
  "id": "cxxx",
  "message": "Review logged",
  "confirm": { "ok": true, "confirmedThroughDate": "2026-06-14T05:59:59.999Z" }
}
```
or
```json
{
  "id": "cxxx",
  "message": "Review logged",
  "confirm": { "ok": false, "blockedBy": [{ "dateKey": "...", "kind": "long-effort", "withDates": ["..."] }] }
}
```

---

## 6. Component Hierarchy

### 6.1 Week-row refactor of `CalendarMonth.tsx`

**Server/client boundary:** `CalendarMonth.tsx` is already `"use client"` — no change needed. `WeekRail.tsx` (if extracted) should be a plain presentational component with no client hooks (the flip's `useEffect` lives in `CalendarMonth`, not `WeekRail`).

**Chunking the 42 cells into 6 rows of 7:**

```ts
// In CalendarMonth body, replace the flat grid with:
const weeks = Array.from({ length: 6 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
```

The 42 padded cells already arrive Mon–Sun aligned from `getCalendarMonth` (via `startOfWeekMonday`/`endOfWeekSunday`), so chunking by 7 gives correct Mon–Sun rows.

**Props change to `CalendarMonth`:**

```ts
export function CalendarMonth({
  cells,
  monthKey,
  legend,
  confirmedThroughDate,  // NEW — from calendar/page.tsx via program?.confirmedThroughDate ?? null
}: {
  cells: CalendarDayCell[];
  monthKey: string;
  legend: readonly LegendEntry[];
  confirmedThroughDate?: Date | null;  // NEW, optional for backward compat
})
```

**`calendar/page.tsx` change (minimal):**

At line 20: `const { cells, monthStart, goal, program } = await getCalendarMonth(...)` is unchanged.

Pass the new prop on the `<CalendarMonth>` element:

```tsx
<CalendarMonth
  key={`${year}-${month}`}
  cells={cells}
  monthKey={`${year}-${String(month + 1).padStart(2, "0")}`}
  legend={legend}
  confirmedThroughDate={program?.confirmedThroughDate ?? null}  // NEW
/>
```

**New JSX structure for the grid** (replaces the single `<div className="grid grid-cols-7 gap-1">` at line 82):

```tsx
{/* Day headers stay flat, no rail gutter for the header row */}
<div className="grid grid-cols-[16px_repeat(7,1fr)] mb-1">
  <div />  {/* empty gutter cell for the rail column */}
  {DAY_HEADERS.map((d) => (
    <div key={d} className="text-xs text-[var(--muted)] text-center font-medium">
      {d}
    </div>
  ))}
</div>

{/* Week rows */}
<div className="space-y-1">
  {weeks.map((weekCells, rowIdx) => {
    const weekIndex = weekCells.find((c) => c.isInPlan)?.weekIndex ?? null;
    return (
      <div
        key={rowIdx}
        data-testid={weekIndex != null ? `week-row-${weekIndex}` : undefined}
        className="grid grid-cols-[16px_repeat(7,1fr)] gap-1"
      >
        <WeekRail
          cells={weekCells}
          weekIndex={weekIndex}
          confirmedThroughDate={confirmedThroughDate ?? null}
          startedOn={/* program.startedOn — pass from outer scope */}
        />
        {weekCells.map((c) => (
          <DayCell
            key={c.dateKey}
            cell={c}
            inMonth={inMonth(c)}
            legend={legend}
            selected={c.dateKey === selectedKey}
            onSelect={() => setSelectedKey(c.dateKey)}
            isPopping={poppingWeekIndex === weekIndex && c.isInPlan}
          />
        ))}
      </div>
    );
  })}
</div>
```

**`poppingWeekIndex` state:** a `useState<number | null>(null)` in `CalendarMonth`. A `useEffect` fires on mount and re-computes which newly-confirmed week should play the pop (see §6.4).

**Note on `startedOn`:** `CalendarMonth` doesn't currently receive the program. You can either (a) add `startedOn?: Date` as a prop alongside `confirmedThroughDate`, or (b) derive the week-end boundary inside `WeekRail` from the cell dates (day 7 of the row = Sunday = last day of the week). Option (b) avoids the prop: the last in-plan cell's `date` is the week end anchor. ⚠ Verify option (b) handles out-of-plan padding cells correctly (last in-plan cell, not last cell).

**Recommended:** option (b) — `WeekRail` finds `lastInPlanCell = cells.filter(c => c.isInPlan).at(-1)` and computes the week's "confirmed" boundary as `startOfDay(lastInPlanCell.date).getTime() <= startOfDay(confirmedThroughDate).getTime()`.

---

### 6.2 `WeekRail` component

**File:** `src/components/WeekRail.tsx` (or inline in `CalendarMonth.tsx` — implementer's choice).

**Mark as server-safe (no hooks).** The flip's `useEffect` stays in `CalendarMonth`, not here.

**Rail state derivation:**

```ts
function deriveRailState(
  cells: CalendarDayCell[],
  confirmedThroughDate: Date | null,
): "confirmed" | "provisional" | "conflict" | "past" | null {
  const inPlan = cells.filter((c) => c.isInPlan);
  if (inPlan.length === 0) return null; // fully out-of-plan row (padding only)

  // Conflict wins over everything — even a confirmed week with a later-added hike
  if (inPlan.some((c) => c.conflict != null)) return "conflict";

  // Check if all in-plan cells are past
  const allPast = inPlan.every((c) => c.confidence === "past");
  if (allPast) {
    // Was this past week confirmed? Check if confirmedThroughDate >= last in-plan cell date
    const lastInPlanDate = inPlan.at(-1)!.date; // Sunday of the week (or last in-plan day)
    if (
      confirmedThroughDate != null &&
      startOfDay(lastInPlanDate).getTime() <= startOfDay(confirmedThroughDate).getTime()
    ) {
      return "confirmed"; // past-confirmed: solid spine, filled cap (records week was locked)
    }
    return "past"; // past-unconfirmed: muted quiet spine, no cap
  }

  // Forward-looking: any non-past cell confirmed?
  const nonPast = inPlan.filter((c) => c.confidence !== "past");
  if (nonPast.every((c) => c.confidence === "confirmed")) return "confirmed";
  return "provisional";
}
```

**Note:** `startOfDay` is not a React import — this must be imported from `@/lib/calendar` if `WeekRail.tsx` is a separate file.

**Rail state → visual mapping:**

| `railState` | Spine | Cap |
|-------------|-------|-----|
| `"confirmed"` | 2–3px solid `var(--accent)` gold | `<Bullseye filled size={14–16} />` |
| `"conflict"` | 2–3px dashed `var(--warning)` (dash 3–5px / gap 4–9px ⚠ verify) | `<BullseyeWarning size={14–16} />` |
| `"provisional"` | 2–3px dashed `var(--muted)` (dash 3–5px / gap 4–9px ⚠ verify) | `<Bullseye size={14–16} />` (hollow, no `filled`) |
| `"past"` | 1px solid `var(--muted)` at `opacity-30` | none |
| `null` | nothing | nothing |

⚠ All spine width (2–3px) and dash patterns are provisional — verify at 390px that the rail reads as "present but quiet."

**`BullseyeWarning` — warning cap without touching `Bullseye.tsx`:**

Define inline in `WeekRail.tsx` (or at the bottom of `CalendarMonth.tsx`). It is a minimal SVG that re-implements ONLY the hollow ring in `var(--warning)`:

```tsx
/**
 * Warning variant of the Bullseye cap. A hollow ring in var(--warning) instead
 * of var(--muted). Does NOT touch the canonical Bullseye component.
 * Size 14–16px; no filled rings (conflict = not locked, just alarmed).
 */
function BullseyeWarning({ size = 16 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx={16} cy={16} r={14} fill="none" stroke="var(--warning)" strokeWidth={2} />
    </svg>
  );
}
```

⚠ Verify at 14px and 16px that the warning ring is distinguishable from both the hollow muted ring and the filled target-red cap. UXR ledger row: "Warning rail-cap variant."

**Spine implementation (CSS, no animation class here):**

The spine is a `<div>` with `className` driven by `railState`:

```tsx
// Inside WeekRail JSX:
<div
  data-testid={weekIndex != null ? `week-rail-${weekIndex}` : undefined}
  className="flex flex-col items-center gap-[2px] h-full"  // full row height
>
  {/* Cap at the top */}
  <div
    data-testid={weekIndex != null ? `week-cap-${weekIndex}` : undefined}
    data-confidence={railState ?? "none"}
    className={capWrapperClass}  // see below; adds bullseye-pop via ref in CalendarMonth
  >
    {capElement}
  </div>

  {/* Spine — the vertical bar */}
  <div
    className={spineClass}  // see mapping table above, expressed as Tailwind tokens
    style={{ flex: 1, width: SPINE_WIDTH }}
  />
</div>
```

**Tailwind classes for the spine:**

Tailwind v4 can express most of this inline. For dash patterns, use inline `style` since Tailwind doesn't have a utility for custom `border-image` or `background-size` dash patterns. Use a small CSS class in `globals.css` if needed:

```css
/* globals.css — only if Tailwind can't express the dash inline */
.rail-spine-dashed-muted {
  background-image: repeating-linear-gradient(
    to bottom,
    var(--muted) 0,
    var(--muted) 4px,   /* ⚠ dash size: 3–5px, verify */
    transparent 4px,
    transparent 9px    /* ⚠ gap size: 4–9px, verify */
  );
  background-size: 100% 13px;
}
.rail-spine-dashed-warning {
  /* same pattern but with var(--warning) */
}
```

⚠ If the entire spine can be expressed with Tailwind classes (unlikely for dash patterns), skip the CSS additions. Minimize `globals.css` changes.

**Both light and dark themes:** all colors are CSS variables (`var(--accent)`, `var(--muted)`, `var(--warning)`, `var(--target)`, `var(--target-fg)`) — no literals. The token system handles both themes automatically.

---

### 6.3 `DayCell` changes (provisional cue + conflict wedge)

**Two separate visual channels — must not collide with existing tone/ring/glow:**

**Channel 1 — Provisional opacity + dashed top hairline** (on `confidence === "provisional"` cells that are in-plan and in-month):

```ts
// In DayCell, after the existing toneClass/ringClass/glowClass:
const confidenceClass =
  inMonth && cell.confidence === "provisional"
    ? "opacity-[0.62] border-t-[var(--muted)] border-t border-dashed"
    : "";
// ⚠ opacity range: 0.55–0.70 — verify date number stays ≥ WCAG AA on cream.
// If AA fails at 0.62, raise to 0.68 or dim the background, NOT the text.
// The dashed-top is an additional border on top of the existing rounded border.
```

Apply `confidenceClass` alongside `toneClass` in the button's `className`.

**`aria-label` extension** (extend the existing aria-label at line 148):

```tsx
aria-label={[
  cell.dateKey,
  cell.dayTitle ? `— ${cell.dayTitle}` : "",
  cell.confidence && cell.confidence !== "past" ? `· ${cell.confidence}` : "",
  cell.conflict ? `· conflict: ${cell.conflict.kind}` : "",
].filter(Boolean).join(" ")}
```

**Add `data-testid` and `data-confidence`:**

```tsx
data-testid={`day-cell-${cell.dateKey}`}
data-confidence={cell.confidence ?? "out-of-plan"}
data-conflict={cell.conflict?.kind ?? undefined}
```

**Channel 2 — Conflict corner wedge** (when `cell.conflict != null`):

The wedge is a small triangle in the top-right corner of the cell, using a CSS `::after` pseudo-element or an absolutely-positioned inline element. Since Tailwind v4 allows arbitrary pseudo-element utilities but it's complex for triangles, use a `<span>` overlay inside the button:

```tsx
{cell.conflict != null && (
  <span
    data-testid={`day-conflict-${cell.dateKey}`}
    aria-hidden="true"
    className="absolute top-0 right-0 w-0 h-0
      border-t-[11px] border-t-[var(--warning)]   /* ⚠ 11–14px, verify */
      border-l-[11px] border-l-transparent
      rounded-tr-lg"
  />
)}
```

The button must have `relative` positioning (add `relative` to the button's `className`). The wedge sits in the top-right corner as a CSS triangle. ⚠ Verify it does not fight the today/selected ring. ⚠ Verify wedge size 11–14px — visible at a glance without covering the date number.

**Important:** Conflict affects any cell regardless of confidence state. A confirmed cell can have a conflict (e.g., hike added after locking). The wedge and the opacity cue are SEPARATE channels — a confirmed cell with a conflict shows no opacity reduction (it's confirmed, not provisional) but DOES show the wedge.

---

### 6.4 `bullseye-pop` flip (REQ-007)

**Trigger condition:** a week that was NOT confirmed on the previous render is now "confirmed" (i.e., the server returned `confirmedThroughDate` that covers a previously-provisional week). Since this is a server-rendered page with `force-dynamic`, the flip fires on the first render after `confirmedThroughDate` advances past the week's end.

**localStorage gate (mirrors `TodayCelebration.tsx` exactly):**

In `CalendarMonth` (already `"use client"`), add:

```ts
const [poppingWeekIndex, setPoppingWeekIndex] = useState<number | null>(null);

useEffect(() => {
  // Scan all cells for newly-confirmed weeks and fire the pop at most once per week.
  const confirmedWeekIndices = new Set(
    cells
      .filter((c) => c.isInPlan && c.confidence === "confirmed" && c.weekIndex != null)
      .map((c) => c.weekIndex as number),
  );

  for (const wi of confirmedWeekIndices) {
    const key = `goaldmine.weekConfirmed.${wi}`;
    try {
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, "1");
        setPoppingWeekIndex(wi);
        // Only pop the most-recently confirmed week (highest weekIndex)
        // Break after first unpopped to avoid multi-pop on single render.
        break;
      }
    } catch {
      // localStorage blocked — degrade silently.
    }
  }
}, [cells]);
```

**Applying the pop class to the cap element:** Since `WeekRail` is presentational (no hooks), the pop is applied imperatively from `CalendarMonth` using a `ref`. Use the same pattern as `TodayCelebration.tsx` (line 19-29): maintain a `Map<number, RefObject<HTMLElement>>` for cap wrapper elements, one per weekIndex, and in the effect, call `capRefs.get(poppingWeekIndex)?.current?.classList.add("bullseye-pop")`.

**`globals.css` change:** The `@keyframes bullseye-pop` and `.bullseye-pop` class already exist at lines 105–113. If the class name must differ (e.g., to avoid collision with `TodayCelebration`), add:

```css
/* Week-confirm pop — reuses the same keyframe, same timing.
   Applied to the WeekRail cap wrapper div, not the Bullseye SVG directly. */
.week-confirm-pop {
  animation: bullseye-pop 320ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

@media (prefers-reduced-motion: reduce) {
  .week-confirm-pop {
    animation: none;
  }
}
```

Otherwise, reuse the existing `.bullseye-pop` class on the cap wrapper. Both work. ⚠ Verify the `cubic-bezier(0.16, 1, 0.3, 1)` reads well at 14–16px cap size — the existing 320ms keyframe was tuned for a 28px `TodayCelebration` Bullseye.

**Reduced motion:** The existing `@media (prefers-reduced-motion: reduce)` at globals.css line 115 covers `.bullseye-pop`. If using `.week-confirm-pop`, the duplicate above is needed.

---

### 6.5 Mobile + touch targets

- Week rows: `grid-cols-[16px_repeat(7,1fr)]` — the 16px rail gutter is non-interactive. Day cells remain `min-h-[3.75rem]` (60px ≥ 44px). ✓
- The cap is non-interactive (`aria-hidden`). No tap handler on `WeekRail`. The existing `DayDetail` opens on cell tap — unchanged. ✓
- No horizontal scroll at 390px: `grid-cols-[16px_repeat(7,1fr)]` distributes remaining width evenly; the 16px is fixed, cells flex. At 390px − 16px − padding the 7 cells each get ≈52px. ✓

---

### 6.6 `testIDs` convention (established by this feature)

| Element | `data-testid` |
|---------|---------------|
| Week row wrapper | `week-row-{weekIndex}` |
| Week confidence rail | `week-rail-{weekIndex}` |
| Week cap (state in `data-confidence`) | `week-cap-{weekIndex}` |
| Day cell | `day-cell-{dateKey}` (add `data-confidence` + `data-conflict` attrs) |
| Conflict wedge | `day-conflict-{dateKey}` |

Semantic attributes (`data-confidence`, `data-conflict`) allow tests to assert behavior, not styling.

---

## 7. Data Flow

```
Plan.confirmedThroughDate (Neon/Postgres)
        │
        ▼ getActiveProgram() — no extra query; full Plan row already fetched
ActiveProgramSnapshot.confirmedThroughDate: Date | null
        │
        ├──▶ getCalendarMonth() — already passes program to buildCell
        │         │
        │         ▼ buildCell() — calls deriveConfidence(date, isInPlan, isPast, program)
        │    CalendarDayCell.confidence: "past" | "confirmed" | "provisional" | null
        │         │
        │         ▼ returned in cells[]
        │    calendar/page.tsx — also passes program?.confirmedThroughDate to CalendarMonth
        │         │
        │         ▼
        │    CalendarMonth (client) — chunks cells into 6 × 7 week rows
        │         │
        │         ├──▶ WeekRail — derives railState from cells + confirmedThroughDate
        │         │        └──▶ Bullseye cap (filled / hollow / BullseyeWarning)
        │         │        └──▶ spine CSS class (solid gold / dashed muted / dashed warning)
        │         │
        │         └──▶ DayCell — reads cell.confidence (opacity/dashed-top)
        │                     └──▶ cell.conflict (corner wedge)
        │
        └──▶ resolveDay() — same program snapshot → ResolvedDay.confidence
                  └──▶ get_day / get_today_plan MCP tools surface it to the coach

confirm_week(weekIndex) — coach via MCP
        │
        ▼ guardedAdvanceConfirmedThrough()
        │   1. Derive currentConfirmedWeekIdx from existing confirmedThroughDate
        │   2. weekConflicts(program, w) for w in (current+1 … target)
        │   3a. Any conflicts → return {ok:false, blockedBy}; mark unchanged
        │   3b. No conflicts → prisma.plan.update(confirmedThroughDate = endOfDay(week end))
        │
        ▼ Next server render (force-dynamic) reads updated Plan row
        └──▶ CalendarMonth renders newly-confirmed week as "confirmed" → pop fires once
```

---

## 8. Work Streams

### Recommendation: Single-agent-sequential (one worktree)

**Justification:**

1. **`CalendarDayCell.confidence` is the key shared type.** Both REQ-002 (backend) and REQ-005/006/007 (frontend) read/write this type in `calendar.ts`. Two agents in parallel worktrees would each need to modify `CalendarDayCell`, creating an unavoidable merge conflict on the type definition and the `buildCell` function. There is no clean seam to split.

2. **`ActiveProgramSnapshot.confirmedThroughDate` is the root anchor.** REQ-001 changes both `prisma/schema.prisma` and `program.ts`. All downstream work (REQ-002 through REQ-007) requires this type update. Running the migration twice in two worktrees risks schema drift on a shared Neon DB.

3. **Feature complexity:** 7 REQs, estimated ~300–500 lines of production code (schema: 2 lines, program.ts: 4 lines, calendar.ts: ~40 lines, tools.ts: ~100 lines, CalendarMonth.tsx refactor: ~150 lines, WeekRail.tsx: ~60 lines, globals.css: ~10 lines). Single-agent-sequential is well within what one developer agent handles in one session.

4. **The requirements doc's own stated default:** REQ-001 preamble says "default: ONE developer agent, one worktree, sequential — avoids cross-worktree type breakage on the shared `CalendarDayCell` type and double migration cycles." This blueprint confirms that default.

**If for any reason two-agent-sequential is chosen (backend then frontend):**
- Agent 1: REQ-001 → REQ-004 (schema, program.ts, calendar.ts types, tools.ts). Merges to main.
- Agent 2: REQ-005 → REQ-007 (CalendarMonth refactor, WeekRail, DayCell, flip). Starts from main after Agent 1 merges.
- The cross-worktree `CalendarDayCell.confidence` type dependency is resolved by Agent 1's merge landing before Agent 2 reads the type. **Do NOT run in parallel** — Agent 2 cannot start until Agent 1's changes are in `src/lib/calendar.ts`.

---

## 9. Implementation Order

1. **Prisma migration** — `prisma/schema.prisma`: add `confirmedThroughDate DateTime?`. Run `migrate dev --name add_plan_confirmed_through_date` + `prisma generate`. Validate SQL diff is a single `ALTER TABLE … ADD COLUMN … NULL`. *(REQ-001 part 1)*

2. **`ActiveProgramSnapshot` type + `getActiveProgram`** — `src/lib/program.ts`: add field to type; include in both Plan and Program return paths. `npx tsc --noEmit` must pass. *(REQ-001 part 2)*

3. **`deriveConfidence` helper + `CalendarDayCell.confidence`** — `src/lib/calendar.ts`: add the helper function; add the field to the type; call `deriveConfidence` in `buildCell`. `npx tsc --noEmit` must pass. *(REQ-002 part 1)*

4. **`ResolvedDay.confidence`** — `src/lib/calendar.ts`: add to type; call `deriveConfidence` in `resolveDay` using `dayStart` and `program`. *(REQ-002 part 2, should-have)*

5. **`guardedAdvanceConfirmedThrough` helper** — `src/lib/mcp/tools.ts`: add the shared helper above `registerWriteTools`. No registration, pure logic. *(REQ-003 prereq)*

6. **`confirm_week` + `reopen_week` tools** — `src/lib/mcp/tools.ts`: register both tools in `registerWriteTools`. Curl smoke: `confirm_week {weekIndex:1}` → ok; `reopen_week {weekIndex:1}` → null mark. *(REQ-003)*

7. **`log_review` extension** — `src/lib/mcp/tools.ts`: add `confirmThroughWeekEnd` to inputSchema; extend handler to call `guardedAdvanceConfirmedThrough` when present. `npx tsc --noEmit`, `npm run build`. *(REQ-004)*

8. **Week-row grid refactor + `WeekRail`** — `src/components/CalendarMonth.tsx` (+ optional `WeekRail.tsx`): chunk cells by 7; introduce `grid-cols-[16px_repeat(7,1fr)]` layout; add `WeekRail` rendering the spine + cap; pass `confirmedThroughDate` from `calendar/page.tsx`. Verify selection/today/markers/glow still work. *(REQ-005)*

9. **Provisional cell cue + conflict wedge** — `src/components/CalendarMonth.tsx` (+ `globals.css` if dash utilities needed): provisional opacity + dashed top; conflict `<span>` wedge; extended `aria-label`; `data-testid` / `data-confidence` / `data-conflict` attrs. *(REQ-006)*

10. **`bullseye-pop` flip + reduced motion** — `src/components/CalendarMonth.tsx` (+ `globals.css`): `useEffect` localStorage gate; cap ref + imperatively add pop class; `.week-confirm-pop` class (or reuse `.bullseye-pop`). Browser smoke: confirm week via curl → reload → pop fires once; reduced-motion → instant swap; second reload → no pop. *(REQ-007)*

11. **Full gate pass:** `npx tsc --noEmit` → 0 errors; `npm run lint` → no new errors; `npm run build` → clean. *(Acceptance criteria §8, AC-1–3)*

---

## 10. Critical Decisions

### Decision 1: Warning cap — `BullseyeWarning` wrapper (inline SVG, NOT a new Bullseye prop)

**Chosen:** Define `BullseyeWarning` as a small inline SVG in `WeekRail.tsx` that renders a single hollow ring in `var(--warning)` (identical geometry to Bullseye's hollow state but in warning color). This keeps `Bullseye.tsx` canonical and untouched.

**Rejected:** Adding a `warning?: boolean` prop to `Bullseye.tsx`. While a one-line change, it adds a semantic state to the canonical glyph that the UXR explicitly says is "a warning cap variant" — a consumer concern, not a glyph concern. The wrapper approach keeps responsibility clean.

⚠ **Verify visually:** at 14px the warning ring must be distinguishable from both the hollow muted ring and the filled target-red cap. UXR ledger row tagged.

### Decision 2: Guard span semantics — current-mark+1 through targetWeekIndex

**Chosen:** The guard checks weeks `(currentConfirmedWeekIdx + 1)` through `targetWeekIndex` inclusive. A week at or below the current mark was already guarded when it was originally confirmed and is not re-checked.

**Edge:** if the coach advances from week 2 directly to week 5 (skipping 3 and 4), all three intermediate weeks are checked. This is correct and conservative.

**Edge:** if `currentConfirmedWeekIdx === targetWeekIndex` (re-confirming the same week — a no-op), the loop range is empty → no guard → the write proceeds but the mark doesn't change (endOfDay(week N) = existing mark). Effectively a no-op with a `{ ok: true }` response. Acceptable.

### Decision 3: `confidence` on `ResolvedDay` — IN (should-have, included)

**Chosen:** Include in REQ-002 as should-have. Cost: ~5 lines in `resolveDay`. Benefit: `get_day`, `get_today_plan` surface confidence to the coach without a second query. MCP/UI parity is important as the calendar grows. The infrastructure is identical to `buildCell`.

### Decision 4: Reduced-motion gate

**Chosen:** Honor the existing `@media (prefers-reduced-motion: reduce)` pattern exactly. The `bullseye-pop` / `week-confirm-pop` keyframe is suppressed by `animation: none` in the media query. The localStorage gate still fires (so the pop doesn't try again on the next load), but the class is added with no visual effect. This is the correct behavior — the state transitions instantly.

### Decision 5: localStorage gate lives in `CalendarMonth.tsx`

**Chosen:** `CalendarMonth` is already `"use client"` and has `useState`/`useEffect`. The gate logic (scanning confirmed weekIndices, checking localStorage, setting `poppingWeekIndex`) belongs here rather than in `WeekRail` (which is presentational) or in a separate hook. The ref-based class-add pattern (from `TodayCelebration.tsx`) is replicated here with a `Map<number, RefObject<HTMLElement>>` for cap elements.

### Decision 6: `confirmedThroughDate` prop on `CalendarMonth`

**Chosen:** pass as `confirmedThroughDate?: Date | null` from `calendar/page.tsx`. This is needed by `WeekRail` to distinguish "past-confirmed" rows from "past-unconfirmed" rows — the per-cell `confidence` field can't carry this (PRD spec says past cells are always `"past"`, not `"confirmed"`). Passing it from the page (where `program` is already available) is zero-cost.

**Callers that DON'T have `confirmedThroughDate`** (e.g., a future embedded use): the prop is optional; omitting it causes all past rows to render as "past-unconfirmed" (muted spine, no cap). Acceptable degradation.

### Decision 7: Server/client boundary — WeekRail has no hooks

**Chosen:** `WeekRail` is purely presentational — no `useState`, no `useEffect`, no `localStorage`. It receives `cells`, `weekIndex`, `confirmedThroughDate`, and renders deterministically. The flip's `useEffect` stays in `CalendarMonth`. This means `WeekRail` can technically be a server component IF extracted to its own file and not imported from a client component with state — but since it's a child of `CalendarMonth` (a client component), React treats it as a client component regardless. No harm either way; the important thing is no hooks in `WeekRail`.

### Decision 8: `startOfDay` in `WeekRail` (if extracted to separate file)

If `WeekRail.tsx` is a separate file, it must import `startOfDay` from `@/lib/calendar` for the "past-confirmed" boundary check (`startOfDay(lastInPlanCell.date) <= startOfDay(confirmedThroughDate)`). This is a clean import — `calendar.ts` is the date utility home.

Alternatively, skip the comparison and use a simpler heuristic: `inPlan.at(-1)!.date <= confirmedThroughDate!` (raw Date comparison). This may have TZ edge cases — use `startOfDay` per the USER_TZ rule. ⚠

### Decision 9: Past rows rail state

**Chosen:** 4 rail states: `"confirmed"` (includes past-confirmed), `"provisional"`, `"conflict"`, `"past"` (fully past, was not confirmed at mark). The `"past"` state renders a quiet muted 1px spine at reduced opacity with no Bullseye cap. This provides a minimal visual record without the active confidence signal noise.

The HTML pixel artifact's "past-confirmed" state maps to `railState === "confirmed"` here (solid gold spine + filled cap) — past weeks that were explicitly locked show their gold spine as a historical record. This was explicitly designed in the UXR.

### Decision 10: Conflict on a confirmed week (PRD §6 edge case 5)

**Confirmed handled correctly:** The `conflict` field on `CalendarDayCell` is computed in `buildCell` from live data (planned hikes vs rotation) — it does not consult `confirmedThroughDate`. A confirmed week that gains a new planned hike will have `conflict != null` on the Day-6 cell on the next server render. `deriveRailState` checks `any conflict → "conflict"` BEFORE the confirmed/provisional check, so the cap flips to warning automatically. The `confirmedThroughDate` mark in the DB is NOT changed — the week remains "confirmed" in storage but DISPLAYS as "conflict" in the UI until resolved. This is the correct forcing function.

---

## PRD §6 Edge Case Coverage Verification

| Scenario | Covered by | How |
|----------|-----------|-----|
| `confirmedThroughDate` null (existing plans) | `deriveConfidence`: `mark === null` → "provisional" | ✓ All future days provisional. Correct initial state. |
| `confirm_week` on a week with conflict in span | `guardedAdvanceConfirmedThrough` guard loop | ✓ Refuses, returns `blockedBy`, mark unchanged. |
| `confirm_week` past `totalWeeks` | Guard step 1: `targetWeekIndex > program.template.totalWeeks` | ✓ Returns `{ ok: false, reason: "weekIndex exceeds totalWeeks" }`. |
| `reopen_week(1)` | `reopen_week` handler: `weekIndex <= 1 → newDate = null` | ✓ Mark set to null. |
| Confirmed week later gets conflict (hike added) | `buildCell` conflict computation is live (no confirmedThroughDate dependency) + `deriveRailState`: conflict wins | ✓ Cap flips to warning on next load. Mark in DB unchanged. |
| Out-of-plan / no active plan | `getActiveProgram` returns null → `guardedAdvanceConfirmedThrough` throws "No active plan"; `deriveConfidence`: `!isInPlan → null`; rail renders null state | ✓ Tools return clear error; no rail for out-of-plan rows. |
| DST week | `guardedAdvanceConfirmedThrough` uses `addDays`/`startOfDay`/`endOfDay` from `@/lib/calendar` | ✓ USER_TZ rule followed. No raw Date arithmetic. |
| Reduced motion | `.bullseye-pop` / `.week-confirm-pop` wrapped in `@media (prefers-reduced-motion: reduce) { animation: none }` | ✓ Instant state swap. |
| Narrow phone overflow | `grid-cols-[16px_repeat(7,1fr)]`: 16px fixed rail, cells flex. No `overflow-x` risk. | ✓ Verify at 390px (DevTools mobile emulation). |

---

## Summary for the Caller

**Key decisions made:**
1. Single-agent-sequential (one worktree, REQ-001→007 in order) — avoids the `CalendarDayCell.confidence` type merge conflict that parallel worktrees would create.
2. `BullseyeWarning` wrapper approach: a tiny inline SVG in `WeekRail.tsx`, canonical `Bullseye.tsx` untouched.
3. Guard span = weeks `(currentMark+1)` through `targetWeekIndex` — conservative, correct, no re-check of already-locked weeks.
4. `confidence` on `ResolvedDay` is IN (should-have, ~5 lines, MCP parity value).
5. `confirmedThroughDate` threaded as a prop to `CalendarMonth` to support "past-confirmed" rail state (past weeks the coach explicitly locked).
6. Flip gate lives in `CalendarMonth.tsx` via `useEffect` + `ref.classList.add` (exactly mirroring `TodayCelebration.tsx`).

**Risks and ambiguities resolved:**
- ⚠ Opacity tuning (0.55–0.70): implementer MUST verify the date number stays ≥ WCAG AA on cream palette before shipping. If it drops, raise the floor or dim the cell background (not the text).
- ⚠ Cap size at 14px: verify the Bullseye center ring is visible (`Bullseye.tsx` threshold is ≥14px for 3-ring rendering; if 14px is muddy, use 16px).
- ⚠ Spine dash pattern: exact dash/gap numbers are in UXR ranges (dash 3–5px, gap 4–9px) — playtest at phone width.
- No `globals.css` keyframe additions are strictly required if `.bullseye-pop` is reused on the cap wrapper.
- `WeekRail.tsx` may be inlined into `CalendarMonth.tsx` — implementer's choice.

**The full implementation output is this file.** The developer agent should follow §9 (Implementation Order) sequentially with a `tsc --noEmit` gate after each step.
