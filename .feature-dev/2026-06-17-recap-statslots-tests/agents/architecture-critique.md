# Architecture Critique — PRD-recap-statslots-tests (#70)

**Role:** Devil's Advocate · **Date:** 2026-06-17
**Verdict: APPROVE-WITH-FIXES**

The approach is sound and the core fixture strings are correct. Two fixes are mandatory before the developer writes a line of test code. Everything else is advisory.

---

## Critical

### C-1: `isNull` for zero integer counts is `false`, not ambiguous — PRD leaves a trap

**File:** `src/lib/recap.ts:196`
```typescript
case "recapField": {
  const v = ctx.recap[slot.source.field];
  return { ...base, value: fmtByFormat(v, slot.format), isNull: v === null };
}
```

`isNull` is exactly `v === null`. For `workoutsCompleted:0` and `prCount:0`, `v` is the integer `0` — not `null` — so `isNull: false`, full stop. The PRD's test case 2 ("Fitness nulls") writes:

> "workouts `"0"`, prs `"0"`"

It says nothing about `isNull` for these two slots in the null case. A developer reading this is likely to symmetrically assert `isNull: true` for all zero/null slots, producing a failing test. They must assert `isNull: false` for workouts and prs in case 2, because `0 !== null`.

**Fix:** The PRD must explicitly state test case 2 as:
```
workouts  value:"0"  isNull:false
prs       value:"0"  isNull:false
volume    value:"—"  isNull:true
elevation value:"—"  isNull:true
```

---

### C-2: `calendar.ts` is NOT a pure date utility — the import graph is substantially wider than the PRD describes

**File:** `src/lib/calendar.ts:4-18` (first 15 lines read)
```typescript
import { prisma } from "@/lib/db";
import { getActiveProgram, type ActiveProgramSnapshot } from "@/lib/program";
import { checkpointWindows } from "@/lib/records";
import { type NutritionPlan, parseStoredNutritionPlan } from "@/lib/nutrition-plan";
import { getGoalEventsResult, eventsByDateKey, ... } from "@/lib/goal-events";
```

`recap.ts` imports `startOfWeekMonday`, `endOfWeekSunday`, `addDays`, `startOfDay`, `dateKey` from `@/lib/calendar` (recap.ts:14-18). The PRD Section 4 says the transitive chain is "program/readiness/records/game" — it misses that `calendar.ts` also drags in `@/lib/nutrition-plan`, `@/lib/goal-events`, and their own sub-trees.

**Confirmed safe:** Every confirmed leaf in this expanded tree either imports `@/lib/db` (covered by the mock), imports pure utilities (`zod`, `@/lib/calendar`, `@/lib/program-template`), or imports pure type-only modules. No non-DB module-level throw was found. There is also a `calendar.ts` ↔ `goal-events.ts` circular import (`calendar.ts:10` → `goal-events.ts:15` → `calendar.ts`) — this circular dependency exists in production and is resolved safely (ESM allows it, `dateKey` is initialized before it is accessed by `goal-events`).

**Also confirmed safe:** `@/lib/game/engine.ts:17` does `import { cache } from "react"` and line 1051 does `export const computeGameState = cache(_computeGameState)`. This is a module-level call to `cache()`, which wraps a function without executing it. No throw at module load. Next.js 16 uses React 19 where `cache` is a first-class export.

**Conclusion:** One `vi.mock("@/lib/db", () => ({ prisma: {} }))` still covers the full graph. But the PRD's claim "program/readiness/records/game" undersells the actual surface. If any future import is added to `calendar.ts` that throws for a non-DB reason (e.g. checks a required env var at module load), the test will break with a confusing error. The developer should add a brief comment in the test noting the expanded chain.

---

## Concerns

### W-1: `StatSlotCtx` is not exported — tsc errors on malformed ctx will be opaque

**File:** `src/lib/recap.ts:160-171`

The type is module-private (`type StatSlotCtx = { ... }` — no `export`). TypeScript's contextual typing still enforces the shape when the object literal is passed to `resolveStatSlot`. BUT — when the `scheduledAgg` Map value is missing `open: number`, the tsc error will reference the inline structural type rather than "StatSlotCtx", making it hard to diagnose. Example error: *"Argument of type '{ ... scheduledAgg: Map<string, { done: number; total: number; }>; ... }' is not assignable to parameter of type 'StatSlotCtx'."* The word `StatSlotCtx` won't appear in the error.

The PRD correctly includes `open` in all fixtures (cases 5 and 6). If the developer writes the test from memory and forgets `open`, the compiler catches it but the message is cryptic. Add a comment on the fixture: `// open is required — StatSlotCtx shape, recap.ts:166`.

### W-2: `format: "ratioOfTotal"` is dead code for `scheduledItem` source — test implicitly confirms this

**Files:** `src/lib/goal-presentation.ts:106` (milestones slot has `format: "ratioOfTotal"`), `src/lib/recap.ts:208-215` (scheduledItem branch never calls `fmtByFormat`).

The milestones slot format is `"ratioOfTotal"`, but `resolveStatSlot` never passes it to `fmtByFormat` — the doneOverTotal value is assembled inline as `` `${counts.done}/${counts.total}` ``. The `format` field on scheduledItem slots is vestigial. The test fixtures and expected values in the PRD are correct (`"0/7"`, `"3/7"`), but the PRD does not acknowledge that `format` is ignored for scheduledItem. This is not a test bug — it is existing behavior — but the developer should not add a case testing `fmtByFormat("ratioOfTotal")` as if it applies to milestones.

### W-3: The dummy-DATABASE_URL fallback assumes lazy pg connection

**File:** `src/lib/db.ts:11-16`

If the `vi.mock` approach proves insufficient (not expected based on code review), the PRD recommends adding `DATABASE_URL: "postgresql://test:test@localhost:5432/test"` to `vitest.config.ts`. This works only because `PrismaClient({ adapter: new PrismaPg({...}) })` is lazy — neither `PrismaPg` nor `PrismaClient` opens a socket in the constructor. This assumption holds for the `@prisma/adapter-pg` library but is not documented in the PRD. If the library is ever upgraded and begins validating connectivity at init, the fallback produces a hang or DNS error instead of a clean test skip. The `vi.mock` primary path avoids this entirely and should be tried first.

### W-4: Case 4 does not cover `presentationForGoal(undefined)` — minor gap

**File:** `src/lib/goal-presentation.ts:126-131`

The signature is `goal: { kind?: string | null } | null | undefined`. The PRD tests `null` and unknown kind but not `undefined`. The code path: `goal?.kind ?? null` → when `goal` is `undefined`, `goal?.kind` is `undefined`, `undefined ?? null` is `null`, returns `DEFAULT_PRESENTATION`. This is trivially correct but untested. Low priority — a one-liner `it` addition that removes any doubt.

---

## Fixture String Verification (all correct)

| Fixture input | Code path | Expected string | Verified |
|---|---|---|---|
| `volumeLb:2370, format:"volumeLb"` | `fmtVolume(2370)` → `fmtComma(2370)+" lb"` | `"2,370 lb"` | goal-presentation.ts:13-15 |
| `hikeElevationFt:5200, format:"elevationFt"` | `fmtElevation(5200)` → `fmtComma(5200)+" ft"` | `"5,200 ft"` | goal-presentation.ts:17-19 |
| `logLatest.get("mrr")=null, format:"currency"` | `fmtByFormat(null,"currency")` → `"—"` | `"—"`, isNull:true | recap.ts:182 |
| `scheduledAgg.get("milestone")={done:0,total:7,open:7}`, agg:"doneOverTotal" | inline `"${0}/${7}"` | `"0/7"`, isNull:false | recap.ts:209-212 |
| `workoutsCompleted:2, format:"int"` | `String(2)` | `"2"`, isNull:false | recap.ts:176-177 |
| `prCount:1, format:"int"` | `String(1)` | `"1"`, isNull:false | recap.ts:176-177 |
| `done:3,total:7,open:4` | inline `"${3}/${7}"` | `"3/7"`, isNull:false | recap.ts:209-212 |

`isNull: counts.total === 0` (recap.ts:211) — so `total:7` → `isNull:false` regardless of `done`. The PRD's statement "isNull false" for `{done:0,total:7}` is correct.

## Slot Keys / Labels Verification (all correct)

`FITNESS_PRESENTATION.statSlots` (goal-presentation.ts:61-86):
- keys in order: `["workouts","volume","prs","elevation"]` — confirmed
- labels in order: `["WORKOUTS","VOLUME","NEW PRs","ELEVATION"]` — confirmed, note the mixed-case `"NEW PRs"` (capital P lowercase rs)

`PROJECT_PRESENTATION.statSlots` (goal-presentation.ts:97-111):
- Exactly 2 slots: `mrr` (logLatest/currency) and `milestones` (scheduledItem/doneOverTotal/itemType:"milestone")
- ringLabel: `"PROGRESS"`, headerStyle: `"weeks-to-target"` — confirmed

`DEFAULT_PRESENTATION` (goal-presentation.ts:114-117):
- Spread of FITNESS_PRESENTATION with only `kind` overridden to `"__default__"` — confirmed
- Same 4 statSlots object references, same order

---

## Suggestions

### S-1: Assert `isNull` for ALL four slots in case 2, not just volume/elevation

The PRD leaves workouts/prs isNull implicit. Write the full assertion table:

```typescript
expect(resolved[0]).toEqual({ key:"workouts", label:"WORKOUTS", value:"0",   isNull:false });
expect(resolved[1]).toEqual({ key:"volume",   label:"VOLUME",   value:"—",   isNull:true  });
expect(resolved[2]).toEqual({ key:"prs",      label:"NEW PRs",  value:"0",   isNull:false });
expect(resolved[3]).toEqual({ key:"elevation",label:"ELEVATION",value:"—",   isNull:true  });
```

### S-2: Add `presentationForGoal(undefined)` as a one-liner in case 4

```typescript
expect(presentationForGoal(undefined).kind).toBe("__default__");
```

### S-3: Add a comment in the test noting the full transitive chain

```typescript
// vi.mock covers @/lib/db everywhere in the import graph, including
// @/lib/program, @/lib/readiness, @/lib/records, @/lib/game/engine,
// @/lib/calendar, @/lib/goal-events, @/lib/nutrition-plan, and their deps.
// resolveStatSlot is pure — prisma is never called.
vi.mock("@/lib/db", () => ({ prisma: {} }));
```

---

## Verdict

**APPROVE-WITH-FIXES**

The PRD is structurally correct. The mock strategy, fixture strings, slot registry, and structural-typing approach are all verified against the real source. Two things must be fixed before the developer starts:

**The single most important thing the Developer must get right:**
Test case 2 must assert `isNull: false` for `workouts` and `prs`. The real `resolveStatSlot` computes `isNull: v === null` (recap.ts:196), and `v = 0` (an integer) is not null. If the developer pattern-matches from the volume/elevation slots — where `null` inputs correctly produce `isNull:true` — and incorrectly infers that zero counts also yield `isNull:true`, the test will fail in a confusing way. Make the four-slot assertion table explicit for case 2.
