# Architecture Critique — Footage Markers

**Reviewer role**: Devil's Advocate
**Date**: 2026-06-18
**Blueprint under review**: `.feature-dev/2026-06-18-footage-markers/agents/architecture-blueprint.md`
**PRD**: `docs/prds/PRD-footage-markers.md`

All claims below were verified against the actual source files, not assumed from the PRD or blueprint.

---

## Field-Name Verification Results (items 1–6)

### 1. `WorkoutExercise.orderIndex`
**CORRECT.** `prisma/schema.prisma` line 37: `orderIndex Int`. Blueprint's `orderBy: { orderIndex: "asc" }` and `ex.orderIndex` compile cleanly.

### 2. `resolveDay` return — `weekIndex`, `rotationDay`, `todayTask`
**ALL CORRECT.** `ResolvedDay` type in `src/lib/calendar.ts` (lines 607–700):
- `weekIndex: number | null` — line 611
- `rotationDay: number | null` — line 610
- `todayTask: TodayTask` — line 617 (`"workout" | "rest" | "baseline" | "hike" | "out_of_plan"`)

Blueprint's `r.weekIndex`, `r.rotationDay`, `r.todayTask` are all valid.

### 3. `getExerciseSummaries()` — `name` and `bestDate`
**CORRECT.** `ExerciseSummary` type in `src/lib/records.ts` (lines 55–65):
- `name: string` — already canonical (set to `bucket.name = canonicalExerciseName(ex.name)` at line 425)
- `bestDate: Date` — line 64

The blueprint's `summaryByName.get(canonical)` lookup is valid because the map is keyed by canonical name and `getExerciseSummaries` already canonicalizes internally.

### 4. `prisma.goal` — `active` AND `isFocus`
**BOTH CORRECT.** `schema.prisma` lines 175–176:
- `active Boolean @default(true)`
- `isFocus Boolean @default(false)`

Blueprint's `where: { isFocus: true, active: true }` compiles.

### 5. Day-page `page.tsx` — variables in scope and type shapes
**MOSTLY CORRECT — two imports are missing from current `page.tsx`.**

Variables that ARE in scope (verified against actual file):
- `date` (line 47: `const date = parseDateKey(dateKey)`) ✓
- `dateKey` (line 46: `const { dateKey } = await params`) ✓
- `completedDetails` (line 110) ✓
- `shownTemplate` (line 65: `r.activeWorkout ?? r.deferredWorkout`) ✓
- `parseDateKey` (line 8, imported) ✓
- `startOfDay` (line 11, imported) ✓
- `CollapsibleCard` (line 20, imported) ✓
- `prisma` (line 21, imported) ✓
- `shownTemplate?.blocks[].exercises[].name` — valid; `Block` and `ExercisePrescription` types confirm this shape (line 14 import) ✓
- `completedDetails[].exercises[].name` — valid; comes from Prisma include with `WorkoutExercise` ✓

**NOT currently imported — must be added (blueprint §8.1 calls for this, but if missed tsc fails):**
- `endOfDay` — used in `where: { date: { gte: date, lte: endOfDay(date) } }`
- `canonicalExerciseName` — used in the `footageExercises` derivation

### 6. Imports in `tools.ts`
**ALL CONFIRMED PRESENT.** Verified against `src/lib/mcp/tools.ts`:
- `DateKeyShape` — defined at line 91–94 in the same module (not an import) ✓
- `parseDateInput` — line 202 (from `@/lib/mcp/tool-helpers`) ✓
- `safe` — line 202 ✓
- `startOfDay` — line 29 ✓
- `endOfDay` — line 24 ✓
- `toDateKey` (`dateKey as toDateKey`) — line 23 ✓
- `resolveDay` — line 27 ✓
- `canonicalExerciseName` — line 57 ✓
- `getExerciseSummaries` — line 62 ✓
- `prisma` — line 38 ✓

Only new import needed: `resolveWorkoutIdForDay` from `@/lib/footage-core`. Blueprint is correct.

---

## Critical

### CRIT-1 — `capturedAt` validation: `new Date(arbitraryString)` produces `Invalid Date`

**What**: Both the MCP tool and the server action do:
```ts
const capturedAt = input.capturedAt ? new Date(input.capturedAt) : null;
```
The MCP Zod schema uses `z.string().optional()` — no format enforcement. If the coach (or a form) passes anything other than a valid ISO string (e.g. `"tomorrow"`, `"9:15am"`, `"2026/06/18"`), `new Date(...)` returns `Invalid Date`. Prisma then throws `PrismaClientValidationError: Invalid value for argument capturedAt: Invalid Date`. The error is swallowed by `safe()` and returned as `{ isError: true }` with no diagnostic message, making the failure invisible to the coach.

**Why it matters**: Silent data loss at the most important field — the disambiguation key ClipForge uses to resolve duplicate filenames.

**Fix**: Change the Zod schema to `z.string().datetime().optional()` (enforces ISO 8601 format). In the server action, add an explicit guard:
```ts
const capturedAt = capturedAtRaw
  ? (() => { const d = new Date(capturedAtRaw); return isNaN(d.getTime()) ? null : d; })()
  : null;
```

**Severity**: Critical — will silently error on any non-ISO input; the coach has no reason to know the format constraint unless it's in the tool's `.describe()` string AND validated.

---

### CRIT-2 — `FootageForm` swallows server action errors silently

**What**: Blueprint §7.1 shows:
```ts
startTransition(async () => {
  await logFootageMarker(fd);
  setLabel(""); setFilename(""); setHighlight(false);
});
```
No try/catch. If `logFootageMarker` throws (missing label, Prisma error, Invalid Date from CRIT-1), the promise rejects, the `setLabel/setFilename/setHighlight` resets don't run, and the user sees nothing — the form stays filled with whatever they typed, with no error message.

**Why it matters**: The existing `WorkoutLoggerForm` pattern (the template the blueprint tells developers to mirror) wraps the body in:
```ts
startTransition(async () => {
  try {
    // ...
  } catch (e) {
    setError(e instanceof Error ? e.message : String(e));
  }
});
```
The blueprint's `FootageForm` defines an `error: string | null` state but never populates it.

**Fix**: Add the try/catch block per `WorkoutLoggerForm` pattern (lines 301–313 of that file). The `error` state and the error render element are already in the blueprint — they just need the catch to wire them up.

**Severity**: Critical — AC#6 ("form adds a marker; the list shows it") will pass in the happy path, but any failure leaves the user with a frozen form and no feedback.

---

## Design Concerns

### DC-1 — `toDateKey` dead import in `footage-actions.ts` — lint failure

**What**: Blueprint §4 imports:
```ts
import { parseDateKey, dateKey as toDateKey } from "@/lib/calendar-core";
```
`toDateKey` is never used anywhere in `footage-actions.ts`. `parseDateKey` is used; `toDateKey` is not.

**Why it matters**: `npx tsc --noEmit` with `"noUnusedLocals": true` (standard for this project) will fail. `npm run lint` (ESLint `no-unused-vars`) will also flag it. AC#1 gate broken.

**Fix**: Remove `dateKey as toDateKey` from the import line. The file never needs to format a Date back to a key string — it only parses incoming keys.

**Severity**: High — deterministic CI failure.

---

### DC-2 — `FootageList.tsx` fires `deleteFootageMarker` without awaiting

**What**: Blueprint §7.2 shows:
```ts
startTransition(() => deleteFootageMarker(fd));
```
The outer closure is synchronous but `deleteFootageMarker` returns `Promise<void>`. In React 19 `startTransition` does accept async callbacks, but the pattern `startTransition(() => promise)` passes a function that returns a Promise — React does not treat this as an async transition. The Promise is dropped (fire-and-forget). The `isPending` state from `useTransition` will snap back to false immediately; no loading indicator. Errors are also swallowed.

**Fix**: Use `startTransition(async () => { await deleteFootageMarker(fd); })` per the React 19 / Next.js 16 convention, matching `WorkoutLoggerForm`'s own delete paths.

**Severity**: High — silent data race; delete may appear to succeed before Prisma commits; `revalidatePath` may fire before the DB write completes.

---

### DC-3 — PRD §3.1 vs wireframe §5.1 conflict on `capturedAt` in the Day-page form

**What**: PRD §3.1 item 5 explicitly lists `capturedAt` as a field in `FootageForm` ("optional capturedAt"). Blueprint §13 decision #7 mentions omitting `taskType` but says nothing about `capturedAt`. Yet the wireframe (§5.1) does not include `capturedAt`, and blueprint §7.1 says "capturedAt: omit if not surfaced in v1 form (MCP-only field for now)."

**Why it matters**: A developer reading §3.1 before §7.1 will add the field; one reading in order will omit it. The spec is contradictory. If added, it interacts with CRIT-1 (date parsing).

**Fix**: Orchestrator must clarify before the frontend agent starts. Recommended resolution: follow the wireframe (omit from v1 form, MCP-only), and strike the phrase "optional capturedAt" from PRD §3.1 so both documents agree.

**Severity**: Medium — ambiguous spec → divergent dev output.

---

### DC-4 — `workoutId` null-forever when marker precedes the workout log

**What**: `resolveWorkoutIdForDay` runs at marker-creation time. If the coach tags a clip before the workout is logged (e.g. "I shot this clip, will log the session after"), `workoutId = null`. No trigger or backfill exists to update the FK once the workout is later logged.

**Why it matters**: `get_day_footage` still returns the marker (it queries by date range, not workoutId), so ClipForge gets it. But the `workoutId` field is permanently null, and any marker-level query that JOINs via `Workout.footageMarkers` will miss this marker. More practically: the exercise picker in `FootageForm` would show "whole day / no exercise" only, since there's no completed workout yet.

**Accepted path**: PRD §6 documents "No workout on the day → workoutId null" and this behavior is consistent. But the coach needs to be aware: if they call `log_footage` before `log_workout`, the `workoutId` link is lost for that marker.

**Fix**: Add a note to the `log_footage` tool description: "workoutId is resolved at call time — call this tool after log_workout for the FK to be set."

**Severity**: Medium — data integrity edge; not a bug per the PRD, but a UX footgun the coach needs to know about.

---

### DC-5 — `get_day_footage` query depth: four serial DB calls

**What**: The tool issues four DB queries sequentially (or near-sequentially): `workout.findFirst` (+ exercises), `getExerciseSummaries()` (full scan of all WorkoutExercise rows), `resolveDay` (~7 sub-queries internally), `goal.findFirst`, and `footageMarker.findMany`. `getExerciseSummaries` is documented as a full scan.

**Why it matters**: For a single-user app at current scale this is acceptable (all noted in research). But `resolveDay` itself does 4–7 queries. The combined call is the heaviest read tool in the MCP surface. ClipForge calls this once per day during assembly — not in a hot loop — so it's fine for v1.

**Fix** (future): When `getExerciseSummaries` is called in `get_day_footage`, only the exercises from that day's workout need PR detection. A targeted query (`WHERE canonicalName IN (...)` against only those exercises) would replace the full scan. Scope for v2.

**Severity**: Low — document in the ClipForge spec (§2) that the tool is query-heavy and should be called once per day, not per marker.

---

## Suggestions

### S-1 — `capturedAt` Zod description should state the required format

Even after applying the `z.string().datetime()` fix, add to the describe string: "ISO 8601 format, e.g. '2026-06-18T09:15:00.000Z'. Leave blank if camera metadata is unavailable." Prevents the coach from passing `"9:15am"` and wondering why the call returns `{ isError: true }`.

### S-2 — Vitest seam for `log_footage`

The minimal lockable seam for AC#10:

```ts
// src/lib/footage-core.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveWorkoutIdForDay } from "@/lib/footage-core";

vi.mock("@/lib/db", () => ({ prisma: { workout: { findFirst: vi.fn() } } }));

describe("resolveWorkoutIdForDay", () => {
  it("returns workout id when a completed workout exists in the day window", async () => {
    (prisma.workout.findFirst as Mock).mockResolvedValue({ id: "wkt_1" });
    const result = await resolveWorkoutIdForDay(new Date("2026-06-18T06:00:00Z"));
    expect(result).toBe("wkt_1");
  });

  it("returns null when no completed workout exists", async () => {
    (prisma.workout.findFirst as Mock).mockResolvedValue(null);
    expect(await resolveWorkoutIdForDay(new Date())).toBeNull();
  });
});
```

The `exerciseName` canonicalization branch is a pure unit test on `canonicalExerciseName` (already has alias-map coverage in records tests). Add one test: passing `"pull up"` through the MCP handler input flow should store `"Pull-Up"` (or whatever the canonical is) — verify by checking the `prisma.footageMarker.create` mock receives the canonicalized value.

### S-3 — `revalidatePath` form is correct — confirmed

The blueprint uses `` revalidatePath(`/days/${dateKey}`) `` with the actual date value (not the pattern `/days/[dateKey]`). This matches the existing convention across `day-actions.ts` (lines 54, 64, 81) and `workout-edit-actions.ts` (lines 78, 98). No change needed. The PRD's mention of `/days/[dateKey]` is documentation shorthand, not the function argument.

### S-4 — MCP connector reconnect required

Adding 3 tools (`log_footage`, `get_day_footage`, `delete_footage`) requires the claude.ai connector to be disconnected and reconnected before the tools appear in `tools/list`. The existing connector doesn't auto-reload when new tools are deployed. Orchestrator should include this in the post-deploy checklist.

### S-5 — `footage-actions.ts` imports `calendar-core` not `calendar`

The blueprint imports `parseDateKey` from `@/lib/calendar-core`. Existing server actions (`day-actions.ts`, `note-actions.ts`) import from `@/lib/calendar` (which re-exports everything from `calendar-core`). Either works; using `@/lib/calendar` is more consistent with the project convention and avoids a footgun if helpers are ever added to `calendar.ts` that the action needs. No functional difference.

---

## Missing Requirements

### MR-1 — No `externalRef` rendering path defined in `FootageList`

The `SerializedMarker` type includes `externalRef: string | null` but the `FootageList` component plan (blueprint §7.2) shows no UI element for it. If `externalRef` is a meaningful user-supplied value (a cloud URL, a ClipForge clip id), users have no way to see or copy it from the Day page. Either:
- Render it as non-linked text (small, muted) in the marker item, or
- Explicitly document "externalRef is MCP-read-only; not surfaced in the Day UI"

The omission is a scope decision, but it should be stated explicitly in blueprint §7.2 to prevent a developer from adding `<a href={externalRef}>` (XSS risk if `javascript:` or `data:` URIs are stored).

### MR-2 — No success confirmation after `FootageForm` submit

After a successful marker creation, the form resets (state clears) but there is no confirmation to the user. On mobile at 390px the `FootageList` re-renders above the fold via `revalidatePath` + RSC re-render, but the form area itself provides no feedback. A brief "Added ✓" inline message (can share the `error` state slot with a success variant) prevents the user from double-submitting.

---

## Risk Table

| # | Risk | Severity | Probability | Impact | Mitigation |
|---|------|----------|-------------|--------|------------|
| CRIT-1 | `capturedAt: new Date(bad)` → Prisma error | Critical | High (no format enforcement) | Silent write failure | Use `z.string().datetime().optional()` |
| CRIT-2 | FootageForm errors swallowed | Critical | Certain (no try/catch) | UX: frozen form, no feedback | Add try/catch per WorkoutLoggerForm pattern |
| DC-1 | `toDateKey` dead import → lint fail | High | Certain | AC#1 gate fails | Remove from import line |
| DC-2 | FootageList fire-and-forget delete | High | Certain (sync wrapper) | Race condition, no pending state | `startTransition(async () => await ...)` |
| DC-3 | PRD vs wireframe capturedAt discrepancy | Medium | High (ambiguous spec) | Divergent dev output | Orchestrator clarifies before frontend agent |
| DC-4 | workoutId null-forever pre-workout log | Medium | Low in practice | Broken FK link | Document in tool description |
| DC-5 | `get_day_footage` heavy query (full scan) | Low | Certain | Latency at scale | Acceptable for v1; note in ClipForge spec |
| MR-1 | `externalRef` render path undefined | Medium | Medium | XSS risk if dev adds `<a href>` | Explicitly document render policy |
| MR-2 | No submit success confirmation | Low | Certain | Double-submits | Add success toast/inline state |

---

## Verdict

**NEEDS REVISION**

The fundamental design is sound. All six field-name assumptions are correct against the actual code. Migration is additive (confirmed: zero ALTER/DROP). SSRF surface is zero. `revalidatePath` form matches the project convention. All claimed existing imports in `tools.ts` are present.

Two issues require fixes before the developer agents write any code:

1. **CRIT-1**: Add `z.string().datetime()` to the Zod schema for `capturedAt` in both the MCP tool (`tools.ts`) and validate/guard in the server action (`footage-actions.ts`). Invalid Date silently breaks writes.

2. **CRIT-2 + DC-2**: `FootageForm` and `FootageList` must wrap server action calls in `startTransition(async () => { try { await action() } catch(e) { setError(…) } })`. This is a copy of the existing `WorkoutLoggerForm` pattern — it's missing from the blueprint's component stubs.

One certain lint breakage also needs a blueprint correction before the developer agent runs:

3. **DC-1**: Remove `dateKey as toDateKey` from the `footage-actions.ts` import line — it's imported but never used.

DC-3 (capturedAt in form) should be resolved by the orchestrator as a spec clarification (not a developer decision).

After those three fixes to the blueprint, the architecture is ready to build.
