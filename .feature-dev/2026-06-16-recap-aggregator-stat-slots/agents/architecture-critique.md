# Architecture Critique — Recap Aggregator stat slots (#68)
**Reviewer:** Devil's Advocate  
**Date:** 2026-06-16  
**Verdict:** APPROVE-WITH-FIXES

---

## Critical

### CRIT-1: `resolveStatSlot` for `scheduledItem` ignores `slot.source.agg` — variable-name collision silences the bug

**Files:** `goal-presentation.ts:34`, blueprint step 6 `resolveStatSlot`

`StatSource` for `scheduledItem` carries a required discriminator:
```ts
// goal-presentation.ts:34
| { from: "scheduledItem"; itemType: string; agg: "doneOverTotal" | "doneCount" | "openCount" }
```
The blueprint's resolver for this branch is:
```ts
case "scheduledItem": {
  const agg = ctx.scheduledAgg.get(slot.source.itemType) ?? { done: 0, total: 0 };
  return { ...base, value: `${agg.done}/${agg.total}`, isNull: agg.total === 0 };
}
```
`const agg` (the counts object) **shadows** `slot.source.agg` (the format discriminator), and the discriminator is never consulted. The code always produces `done/total` regardless of whether `slot.source.agg` is `"doneCount"` or `"openCount"`.

V1 only defines one `scheduledItem` slot (Chewgether milestones with `agg: "doneOverTotal"`), so the runtime output is accidentally correct today. But the type contract is violated: any future slot using `"doneCount"` (show just `done`) or `"openCount"` (show `total − done`) will silently emit the wrong string. The variable-name collision makes the bug invisible to the next developer.

**Fix — rename the local and add the branch:**
```ts
case "scheduledItem": {
  const counts = ctx.scheduledAgg.get(slot.source.itemType) ?? { done: 0, total: 0 };
  const { agg } = slot.source;           // the discriminator — now visible
  const value =
    agg === "doneCount"   ? String(counts.done) :
    agg === "openCount"   ? String(counts.total - counts.done) :
    /* doneOverTotal */     `${counts.done}/${counts.total}`;
  return { ...base, value, isNull: counts.total === 0 };
}
```
All three branches are handled, no shadowing, TS exhaustiveness holds.

---

## Concerns

### CONCERN-1: Prisma `groupBy` shape — verified correct, one nuance to know

**File:** `src/lib/records.ts:159–176`

The codebase already uses the exact same `groupBy` pattern:
```ts
// records.ts:159
const groups = await prisma.baseline.groupBy({ by: ["testName"], _count: { _all: true } });
// records.ts:176
count: g._count._all,
```
Blueprint's `scheduledItem.groupBy({ by: ["status"], ..., _count: { _all: true } })` → `g._count._all` is the confirmed Prisma 7 shape. ✓

Nuance: when ZERO items have `status === "done"` (7 planned, 0 done), there is simply no row with `g.status === "done"` in the results. `done` stays 0, `total` accumulates to 7 → `"0/7"`, `isNull: false`. Correct. Verify: the `g.status` field IS typed on the result because `"status"` is in `by`. ✓

### CONCERN-2: `logEntry.findFirst` value type — no Decimal surprise

**File:** `prisma/schema.prisma:237` — `value Float?`

Prisma 7 maps `Float?` to `number | null` (plain JS number), NOT `Prisma.Decimal`. `row?.value ?? null` yields `number | null` with no wrapper to unwrap. The `value: { not: null }` filter is valid Prisma syntax for IS NOT NULL on a nullable scalar. ✓

### CONCERN-3: Goal-first await serializes the 5 base fetches (latency regression)

**File:** `src/lib/recap.ts:181–211` (current single `Promise.all`)

The blueprint splits into: `await goal` → then `await Promise.all([5 base fetches])` → then guarded project `Promise.all`. This converts one network round-trip into two (or three for project goals). For a fitness focus goal, all 5 base fetches now start after the goal fetch returns.

This is the same accepted trade-off as `getCalendarMonth` (see `src/lib/calendar.ts:140–142`, comment "MED-1: this adds one sequential step…"). The PRD's language ("single batch") is slightly misleading — the implementation uses two serial batches. Acceptable, but the developer should be aware the fitness path now costs 2 round-trips instead of 1.

**Alternative (optional):** Mirror `getCalendarMonth`'s approach — keep ONE `Promise.all` for all 6 fetches and gate the project queries as conditional sub-queries inline:
```ts
// conceptually: inside the big Promise.all
logKeys.length ? prisma.logEntry.findFirst(...) : Promise.resolve(null)
```
This would preserve the current 1-round-trip behavior, at the cost of slightly more complex code structure. Not required for correctness.

### CONCERN-4: Header routing for project goals — `!plan` branch routing is correct, math verified

**File:** `src/lib/recap.ts:292–311`

Project goals (e.g. Chewgether) have no active `Plan` row, so `plan` is null → they hit the `!plan` branch at ~293. The blueprint computes `weeksToTarget`/`targetDateLabel` BEFORE the header branch and includes them in both the `!plan` object AND the `else` object (null in the fitness/with-plan case). This is correct.

Math check for 2026-06-16 → 2026-09-30:
- Jun 16→30 = 14 days, Jul = 31, Aug = 31, Sep = 30 → total 106 days
- `Math.round(106 / 7) = Math.round(15.14) = 15` → `weeksToTarget = 15` ✓

`startOfDay` in this codebase is USER_TZ-correct (via `calendar-core.ts:93–96`; uses `Intl.DateTimeFormat` parts, not raw `getDate()`). No bare date primitives. ✓

`Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: USER_TZ })` matches the exact pattern of `weekRangeLabel` at `recap.ts:148–154`. ✓

**Assumption to verify:** `goal.targetDate` must be stored as USER_TZ midnight (via `parseDateInput`/`parseDateKey`). If stored as UTC midnight, `targetDateLabel` would display one day early in MDT (UTC−6). This is an existing codebase invariant that the developer should confirm. The `Math.round` in `weeksToTarget` makes that calculation robust to ±1 day, but the label is not.

### CONCERN-5: TypeScript narrowing of `goal?.targetDate` — needs `tsc` check

Blueprint condition: `if (presentation.headerStyle === "weeks-to-target" && goal?.targetDate)`.

TypeScript 5 strict mode should narrow `goal` to non-null and `goal.targetDate` to `Date` inside the body via optional-chaining truthiness, but this narrowing path is subtle. The developer **must** run `npx tsc --noEmit` before submitting; if TypeScript complains, add an explicit guard:
```ts
if (presentation.headerStyle === "weeks-to-target" && goal && goal.targetDate) {
```
This is semantically identical and narrows more transparently.

### CONCERN-6: `breakdown` variable scope — developer must place the declaration correctly

Blueprint step 8 says "keep a `let breakdown: TargetProgress[] = []` and assign in the snapshot branch." The declaration MUST be placed before the `if (goal)` block at ~249 so it's in scope for the `statSlots` computation that follows. If placed inside the `has-data` sub-branch, the `resolveStatSlot` call for `targetCurrent` slots (future use) will silently see an empty array. The blueprint calls this out — flagging for visibility.

---

## Suggestions

### S-1: Move `fmtByFormat` into `goal-presentation.ts`

`fmtByFormat` is a formatting helper that maps `StatFormat` → string. `StatFormat` is defined in `goal-presentation.ts:23–29`, as are the three formatters it delegates to (`fmtComma`, `fmtVolume`, `fmtElevation`). Placing `fmtByFormat` in `recap.ts` splits co-located formatting logic across two files. Moving it to `goal-presentation.ts` (which is already pure / client-safe) keeps the whole format surface in one place and makes it testable independently. Not required for v1 correctness.

### S-2: Add exhaustiveness sentinel to `fmtByFormat` switch

TypeScript will only report unreachable-case exhaustiveness if the switch ends with a `never` check:
```ts
default: {
  const _: never = f;  // compile-time guard
  return v === null ? "—" : String(v);
}
```
This catches any future `StatFormat` variant added to `goal-presentation.ts` that is not handled in `fmtByFormat`.

### S-3: `DEFAULT_PRESENTATION` import in catch fallback — safe, but worth a comment

`DEFAULT_PRESENTATION` is a pure constant from `goal-presentation.ts` (no server imports per file-level comment at line 1). Importing it into the catch fallback is correct. Add a one-line comment at the fallback site explaining why it is safe (avoids the next reviewer asking "why are we importing from goal-presentation inside a catch block?").

---

## Verification checklist (items the blueprint lists, plus additions)

| Check | Why |
|---|---|
| `npx tsc --noEmit` — zero NEW errors | Confirms `ctx.recap[field]` indexing, `breakdown` scope, `goal.targetDate` narrowing |
| `grep -nE "setHours\|setDate\|getHours\|getDate\(\|getMonth\(\|getFullYear" src/lib/recap.ts` | No new bare date primitives |
| Code-inspect: `logKeys.length \|\| schedTypes.length` guard fires correctly for fitness focus goal | FITNESS_PRESENTATION has zero `logLatest`/`scheduledItem` slots → guard always false ✓ |
| MCP curl: `weekly_summary_data` for fitness goal → 4 legacy fields intact | Regression check on existing consumers |
| Code-inspect: all 3 `RecapProgramHeader` object literals include `weeksToTarget` / `targetDateLabel` | TypeScript will catch this at compile time, but confirm explicitly |
| Verify `goal.targetDate` storage convention (USER_TZ midnight via `parseDateInput`) | Needed for `targetDateLabel` to show the correct day |

---

## Verdict: APPROVE-WITH-FIXES

The blueprint is structurally sound. Prisma `groupBy` shape is confirmed correct (`records.ts:159–176`). `logEntry.findFirst` value type is plain `number | null`. Header routing correctly targets the `!plan` branch for project goals. `startOfDay` + `Intl` date math is USER_TZ-correct. The catch fallback using `DEFAULT_PRESENTATION` is safe. MCP consumers do not exhaustively destructure `WeeklyRecap` or `RecapProgramHeader`.

**The single most important thing the developer must get right:**

Fix CRIT-1 before shipping. The `scheduledItem` branch of `resolveStatSlot` uses `const agg` as the local variable name for the counts object, accidentally shadowing `slot.source.agg` (the format discriminator) and burying it. The code works for v1's only `scheduledItem` slot (Chewgether milestones, `agg: "doneOverTotal"`) because `done/total` happens to be correct — but any future slot with `agg: "doneCount"` or `"openCount"` will produce the wrong string with no type error or runtime warning. Rename the local to `counts` and add the three-branch switch on `slot.source.agg`.
