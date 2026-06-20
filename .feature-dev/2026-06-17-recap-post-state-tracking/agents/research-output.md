# Research Output — Recap Post-State Tracking (#95)

**Feature**: Mark a week posted; clear the nudge
**Agent**: Research
**Date**: 2026-06-17
**Feeds into**: architecture-blueprint.md → Backend dev + Frontend dev

---

## 1. Existing Patterns

### 1.1 Server-Action Shape (`src/lib/note-actions.ts`)

The canonical pattern in this codebase for "mutate DB → revalidate path":

```ts
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";

export async function resolveOpenItem(id: string, reason?: string) {
  const note = await prisma.note.findUnique({ where: { id }, select: { type: true } });
  if (!note || note.type !== "open_item") return; // silent guard
  await prisma.note.update({
    where: { id },
    data: { resolvedAt: new Date(), resolvedReason: reason?.trim() || "dismissed from /coach" },
  });
  revalidatePath("/coach");
}
```

Key observations for `markRecapPosted`:
- `"use server"` directive at the top of the file (not per-function) — required by Next.js 16 App Router.
- `revalidatePath` from `next/cache` (not `next/router`).
- Existing actions do NOT have try/catch — they let errors surface. `markRecapPosted` MUST differ: it runs on the share path, so failure must not break the UX. A top-level try/catch returning `{ posted: false }` is the required deviation from the existing pattern.
- `prisma` is the singleton from `@/lib/db` — never instantiate `new PrismaClient()`.

### 1.2 MCP Enum Registration (`src/lib/mcp/tools.ts:96`)

The enum and the activity-type list are separate constants:

```ts
// line 96
const NoteTypeShape = z.enum(["journal", "audible", "feedback", "standing_rule", "review"]);

// line 100 — SEPARATE constant; drives recent_history filter
const ACTIVITY_NOTE_TYPES = ["journal", "audible", "feedback"] as const;
```

Adding `"shared_recap"` to `NoteTypeShape` makes `log_note({ type: "shared_recap" })` validate. `ACTIVITY_NOTE_TYPES` is the filter for `recent_history` and must NOT be changed — `shared_recap` is therefore automatically excluded from activity history without any additional work.

`NoteTypeShape` is used inside `LogNoteShape.type` as `NoteTypeShape.default("journal")`. The enum value change is purely additive; no other tool registration changes.

### 1.3 RecapClient Prop Convention (CRIT-2)

The existing component header documents the constraint explicitly:
```ts
// CRIT-2 compliance: receives ONLY {offset, label}[] from the server.
// No Date objects, no WeeklyRecap, no client-side TZ math.
```

The `WeekItem` type is:
```ts
type WeekItem = { offset: number; label: string };
```

The `postedWeeks: number[]` addition follows the exact same pattern — plain numbers (offsets), no Date objects. The server converts DB `Date` fields to offset numbers before passing them to `RecapClient`.

### 1.4 Calendar / USER_TZ Rules (`src/lib/calendar.ts`, `src/lib/calendar-core.ts`)

`@/lib/calendar` is a re-export facade. The pure date primitives live in `calendar-core.ts` and are re-exported unchanged:

```ts
export { dateKey, startOfDay, endOfDay, startOfWeekMonday, endOfWeekSunday, addDays, USER_TZ, ... }
  from "./calendar-core";
```

**Rule**: Every date/time operation in `recap-actions.ts` and `page.tsx` must go through these helpers. The Vercel runtime runs at `process.env.TZ=UTC`; raw `new Date().setHours(0,0,0,0)` silently computes the wrong midnight in Mountain Time.

**Week Monday derivation** (the stable key for this feature):
```ts
const thisMonday = startOfWeekMonday(now);    // current week's Monday in USER_TZ
const monday = addDays(thisMonday, offset * 7); // target week's Monday
const key = dateKey(monday);                   // "yyyy-mm-dd"
```

Both the write path (`markRecapPosted`) and the read path (`page.tsx`) must use this exact derivation with the same `now` reference to produce matching keys.

### 1.5 Routine-Nudge Query Pattern (`src/app/coach/page.tsx:116-123`)

The coach page already identifies routine nudges by their body prefix:

```ts
const lastRoutineNudge = await prisma.note.findFirst({
  where: { type: "open_item", body: { startsWith: "[week:" } },
  orderBy: { createdAt: "desc" },
  select: { createdAt: true },
});
```

`markRecapPosted` uses the same `body: { startsWith: "[week:" }` predicate, plus `resolvedAt: null` to restrict to unresolved ones, and `orderBy: { createdAt: "desc" }` to pick the newest (= the active routine nudge).

---

## 2. Related Existing Code

| File | Key Exports / Lines | Role in this feature |
|------|---------------------|----------------------|
| `src/lib/note-actions.ts` | `resolveOpenItem`, `resolveNote` | Server-action pattern to mirror |
| `src/lib/recap.ts` | `weekRangeLabel(asOf, offset)` L237; `startOfWeekMonday`, `addDays` imports | Body string + week math |
| `src/lib/calendar.ts` | `startOfWeekMonday`, `addDays`, `dateKey`, `USER_TZ` (re-exports from `calendar-core`) | All date math must use these |
| `src/lib/db.ts` | `prisma` singleton | DB access |
| `src/lib/mcp/tools.ts:96` | `NoteTypeShape = z.enum([...])` | Add `"shared_recap"` here |
| `src/lib/mcp/tools.ts:100` | `ACTIVITY_NOTE_TYPES` | Leave untouched |
| `src/components/RecapClient.tsx:100-152` | `handleShare` function | Add `markRecapPosted` calls + `locallyPosted` updates here |
| `src/components/RecapClient.tsx:59-69` | `navigateToWeek` | Must NOT reset `locallyPosted` |
| `src/app/recap/page.tsx:11-27` | `RecapPage` server component | Add async + DB query + postedWeeks |
| `src/app/coach/page.tsx:116-123` | `lastRoutineNudge` query | Nudge query pattern |
| `prisma/schema.prisma:89` | `Note.type // comment` | Comment-only update |

---

## 3. Dependencies

**No new dependencies.** No new packages, no migrations, no schema field changes.

- `Note.type` is `String @default("journal")` — free-form column; `"shared_recap"` is a new logical value only.
- `Note.targetDate DateTime?` already exists and is indexed (`@@index([targetDate])`).
- `Note.resolvedAt DateTime?` already exists and is indexed (`@@index([resolvedAt])`).
- **`npx prisma generate` is not required** for this feature. The schema change is comment-only; no generated type changes.
- **`npx prisma migrate dev` is not required.** No DDL change.

---

## 4. Risks & Considerations

### R-1: DST Week Boundary
`addDays(startOfWeekMonday(now), offset * 7)` is USER_TZ-aware via the `calendar-core` helpers. During a DST spring-forward or fall-back week, `addDays` uses the `shiftWallClock` implementation under the hood to stay wall-clock-correct. The write path and read path both call `startOfWeekMonday(new Date())` independently; both must call it on the same logical "today" (same calendar week). As long as a request doesn't straddle a week boundary (ISO-second level), the keys match. This is an acceptable tiny edge case per the PRD.

### R-2: Date Equality — `dateKey` String, Not `Date` Identity
Prisma returns `targetDate` as a `Date` object. Comparing two `Date` objects with `===` compares references, not values — it always returns `false`. Match using:
```ts
dateKey(note.targetDate) === dateKey(monday)
```
This applies to the read path in `page.tsx` where we map note `targetDate` → offset.

### R-3: Optimistic State Across Week Navigation
`locallyPosted` is a `Set<number>` seeded at mount from `postedWeeks`. It accumulates offsets and must NOT be cleared when `navigateToWeek` fires. The current `navigateToWeek` already resets `sharing`, `shareError`, `candidates`, and `highlightValue` — none of those concern post-state. The developer must verify `locallyPosted` is not in that reset block.

### R-4: Idempotency Race (Double-Tap)
The `findFirst` + `create` guard is not atomic. A rapid double-tap could produce two concurrent executions between the read and write, both finding no existing note and both creating one. Result: a rare duplicate `shared_recap` row for the same Monday. This is acceptable per the PRD decision (no DB unique constraint). The read path dedupes naturally: two notes with the same `targetDate` produce the same `dateKey`, which maps to the same offset — the offset is added to a `Set`, so duplicates collapse.

### R-5: Best-Effort / Never-Throw on Share Path
`markRecapPosted` wraps all DB ops in try/catch. Failure returns `{ posted: false }` silently. The share itself already succeeded at the point of the call; a DB failure must not surface as a UX error. The developer must ensure the try/catch covers both the `findFirst/create` block AND the nudge-resolve block AND the `revalidatePath` calls.

### R-6: a11y — Text, Not Color
"Posted ✓" must communicate state through text, not color alone. Specifically:
- Must contain the literal word "Posted" so screen readers announce "Posted check-mark" rather than just a green color.
- The optimistic state change should be in a container with `aria-live="polite"` so the update is announced without stealing focus.
- The Share button must retain visible focus rings and a ≥44px tap target (not visually obscured by the Posted indicator).

---

## 5. Conventions Checklist

Every Developer working on this feature must follow all of the items below:

1. `"use server"` at top of `src/lib/recap-actions.ts` (file-level directive, not per-export).
2. Import all date helpers from `@/lib/calendar` — never `new Date().setHours(...)`, never `d.getMonth()`, never `d.getDate()`, never `d.getFullYear()`.
3. Match `shared_recap` notes to weeks using `dateKey(note.targetDate) === dateKey(monday)` — never `note.targetDate === monday` or `note.targetDate.getTime() === monday.getTime()` directly (both would work but the `dateKey` pattern is the project standard and is consistent with the read-path code).
4. `revalidatePath("/recap")` AND `revalidatePath("/coach")` — call both unconditionally inside the try block.
5. Wrap ALL DB operations in `markRecapPosted` in a single top-level try/catch; return `{ posted: boolean }` — never `throw`.
6. Pass ONLY `number[]` to `RecapClient` as `postedWeeks`; no `Date` objects in the prop (CRIT-2).
7. `locallyPosted` state is NOT cleared in `navigateToWeek`. Check that the reset block in `navigateToWeek` does not include a `setLocallyPosted` call.
8. Call `markRecapPosted` on BOTH completion branches of `handleShare`: (a) native `navigator.share` success (after the `await navigator.share(...)` line) and (b) fallback download (after `URL.revokeObjectURL(url)`). Do NOT call it inside the `catch` block; AbortError must not trigger it.
9. `NoteTypeShape` gains `"shared_recap"` (additive enum value). `ACTIVITY_NOTE_TYPES` is left unchanged.
10. `prisma/schema.prisma` `Note.type` comment is updated to list `shared_recap`; NO schema migration and NO `npx prisma generate`.
11. `Note.targetDate` stores the week's Monday (result of `addDays(startOfWeekMonday(now), offset * 7)`); `Note.date` stores `new Date()` (current timestamp, when the share happened).
12. `Note.resolvedAt` is null for `shared_recap` notes (these are records, not pending work). The idempotency query does NOT filter on `resolvedAt` — `findFirst({ where: { type: "shared_recap", targetDate: monday } })` is sufficient.
13. Body = `weekRangeLabel(now, clampedOffset)` using the same `now` variable used to compute `monday`, e.g. `"Shared recap for Jun 9 – Jun 15"`.
14. After the UX research output is available, the Developer fills the TODO indicator slot in `RecapClient`. Until then, use the minimal placeholder markup defined in the architecture blueprint.
