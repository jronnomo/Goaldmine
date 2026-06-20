# Research Output — Footage Markers

**Feature**: `2026-06-18-footage-markers`
**Scope**: MCP `log_footage` / `get_day_footage` / `delete_footage` + Day-page FootageForm/FootageList

---

## 1. Existing Patterns

### 1.1 MCP `safe()` + Zod write-tool shape

Source: `src/lib/mcp/tool-helpers.ts` (lines 21–27).

```ts
export async function safe<T>(fn: () => Promise<T>) {
  try {
    return jsonResult(await fn());
  } catch (e) {
    return errorResult(e instanceof Error ? e.message : String(e));
  }
}
```

All tool handlers wrap their body in `safe(async () => { ... })`.  
`jsonResult`, `errorResult`, `safe`, `parseDateInput` are the four exports from this file.

**Write-tool skeleton** (from `log_open_item`, `tools.ts:2403–2437`):
```ts
server.registerTool(
  "log_open_item",
  {
    title: "...",
    description: "...",
    inputSchema: {
      body:       z.string().min(1).describe("..."),
      targetDate: DateKeyShape.optional().describe("..."),
      priority:   z.enum(["high", "normal", "low"]).optional().describe("..."),
    },
  },
  async (input) =>
    safe(async () => {
      const n = await prisma.note.create({ data: { ... } });
      return { id: n.id, message: "Open item logged" };
    }),
);
```

**Write-tool return shape** (pinned): `{ id: string; message: string }`.  
See `logNoteCore` at `tools.ts:411–421`:
```ts
return { id: n.id, message: "Note logged" };
```

**Read-tool return shape**: named object.  
Example: `recent_history` at `tools.ts:771`:
```ts
return { since, days, workouts, measurements, notes, baselines, hikes, nutrition: nutritionStripped };
```

### 1.2 `parseDateInput` for `date: string` inputs

Source: `src/lib/mcp/tool-helpers.ts:32–34`.

```ts
export function parseDateInput(s: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? parseDateKey(s) : new Date(s);
}
```

Bare `yyyy-mm-dd` → `parseDateKey(s)` → USER_TZ midnight (critical — Vercel runs UTC; without this, `2026-06-18` becomes yesterday in MT).  
Full ISO string (`2026-06-18T09:15:00.000Z`) → `new Date(s)` (verbatim).

Use `parseDateInput` for all MCP `date` inputs. Use `parseDateKey` in server actions/page, where the input is already a `yyyy-mm-dd` string from a form or route param.

### 1.3 `DateKeyShape`

Source: `src/lib/mcp/tools.ts:91–94`.

```ts
const DateKeyShape = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "use yyyy-mm-dd")
  .describe("ISO date yyyy-mm-dd in the user's local time zone");
```

Defined as a module-level const in `tools.ts`. The new footage tools must reference the same const — they live in the same file, so no import needed.

### 1.4 `canonicalExerciseName`

Source: `src/lib/records.ts:145–147`.

```ts
export function canonicalExerciseName(name: string): string {
  return EXERCISE_ALIAS_INDEX.get(name.trim().toLowerCase()) ?? name.trim();
}
```

Call before storing `exerciseName` in any write path (MCP and server action alike). Unmapped names pass through trimmed.

### 1.5 Server Action + `revalidatePath` pattern

Source: `src/lib/note-actions.ts`.

```ts
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";

export async function resolveNote(id: string, reason?: string) {
  await prisma.note.update({ where: { id }, data: { ... } });
  revalidatePath("/");
  revalidatePath("/journal");
  revalidatePath("/goals");
}
```

Rules:
- `"use server"` at the top of the file marks all exports as server actions.
- Import `revalidatePath` from `next/cache`.
- Call `prisma` singleton from `@/lib/db`.
- Revalidate every route that renders the mutated data. For footage: `/days/${dateKey}` and `/`.
- No `return` value needed for delete. For create, no redirect needed (form stays in-place; revalidatePath triggers RSC re-render).

### 1.6 Day-page card composition

Source: `src/app/days/[dateKey]/page.tsx`.

The page is a **server component** (`async function DayDetail`).  
In Next.js 16 App Router, `params` is a `Promise`:
```ts
const { dateKey } = await params;
const date = parseDateKey(dateKey);
const r = await resolveDay(date);
```

`r.workouts` contains all Workout rows for the day (ids, status, title, startedAt — **no exercises**). Exercise detail requires a second Prisma query:
```ts
const completedDetails = completedWorkouts.length > 0
  ? await prisma.workout.findMany({
      where: { id: { in: completedWorkouts.map((w) => w.id) } },
      include: {
        exercises: {
          orderBy: { orderIndex: "asc" },
          include: { sets: { orderBy: { setIndex: "asc" } } },
        },
      },
      orderBy: { startedAt: "asc" },
    })
  : [];
```

Footage only needs exercise names (no sets), so omit `include: { sets: ... }` from the footage query. The existing `completedDetails` query already includes exercises — reuse it.

**Exercise names for the picker** (derived from `completedDetails` + fallback):
```ts
const footageExercises: { name: string }[] =
  completedDetails.length > 0
    ? Array.from(
        new Map(
          completedDetails
            .flatMap(w => w.exercises.map(ex => ({ name: canonicalExerciseName(ex.name) })))
            .map(ex => [ex.name, ex]),
        ).values(),
      )
    : (shownTemplate?.blocks.flatMap(b => b.exercises.map(ex => ({ name: ex.name }))) ?? []);
```

Picker fallback (no completed workout) uses the template exercises so the form is still useful on past days where the workout was never logged.

### 1.7 `CollapsibleCard` conventions

Source: `src/components/CollapsibleCard.tsx:4–32`.

```tsx
<CollapsibleCard
  title="Footage (3)"  // count in title per UI spec §5.1
  defaultOpen={footageMarkers.length > 0}
>
  {children}
</CollapsibleCard>
```

- `<details>` element, native expand/collapse.
- `title: string` (required), `defaultOpen?: boolean` (default false), `children: ReactNode`, `className?: string`.
- Summary row is `min-h-[44px]` — tap target already met.
- Inner content: `px-4 pb-4`.

### 1.8 `Card` conventions

Source: `src/components/Card.tsx:3–27`.

```tsx
<Card title="..." action={...}>
  {children}
</Card>
```

- `<section>`, `rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm`.
- `title?: string`, `action?: ReactNode` (header slot), `children: ReactNode`, `className?: string`.

### 1.9 Tailwind v4 CSS variable tokens

| Token | Usage |
|-------|-------|
| `var(--border)` | Card/input borders |
| `var(--card)` | Card background |
| `var(--muted)` | Secondary text, inactive controls |
| `var(--accent)` | Primary CTA color, highlight badge |
| `var(--warning)` | Error/conflict state |
| `var(--foreground)` | Primary text |

**Never** use utility color classes (`text-blue-500`, `bg-gray-100`) — always CSS vars.  
Touch targets: `min-h-[44px]` on every interactive element.

### 1.10 WorkoutId resolution via `startedAt` range

`FootageMarker.workoutId` requires finding the day's completed workout by date range, not a date-only field. Pattern (Workout has no `date` column — use `startedAt`):

```ts
const dayStart = startOfDay(parseDateInput(input.date));
const dayEnd   = endOfDay(dayStart);
const workout  = await prisma.workout.findFirst({
  where: { startedAt: { gte: dayStart, lte: dayEnd }, status: "completed" },
  orderBy: { startedAt: "desc" },
  select: { id: true },
});
const workoutId = workout?.id ?? null;
```

`startOfDay` and `endOfDay` from `@/lib/calendar`. This is the **shared pattern** — both MCP `log_footage` and the `logFootageMarker` server action must use the same function (`resolveWorkoutIdForDay` in `footage-core.ts`) or they will drift.

### 1.11 PR detection via `getExerciseSummaries`

Source: `src/lib/records.ts:414–465`.

`getExerciseSummaries()` returns `ExerciseSummary[]` where each item has `name: string` (canonical) and `bestDate: Date` (the workout's `startedAt` that produced the all-time best for that exercise). PR = `bestDate` falls within the day's `[dayStart, dayEnd]` range:

```ts
const summaries = await getExerciseSummaries();
const byName = new Map(summaries.map(s => [s.name, s]));
const isPR = (canonical: string): boolean => {
  const s = byName.get(canonical);
  return s != null && s.bestDate >= dayStart && s.bestDate <= dayEnd;
};
```

`getExerciseSummaries` is imported from `@/lib/records` and already imported in `tools.ts` (`import { canonicalExerciseName, getBaselineHistory, ..., getExerciseSummaries } from "@/lib/records";`).

### 1.12 `toDateKey` in tools.ts

In `tools.ts:25`: `import { dateKey as toDateKey, ... } from "@/lib/calendar"`.  
`toDateKey(date: Date): string` → `"yyyy-mm-dd"` in USER_TZ.

---

## 2. Related Existing Code

| File | Key exports / sections | Relevance |
|------|----------------------|-----------|
| `src/lib/mcp/tool-helpers.ts` | `safe`, `parseDateInput`, `errorResult`, `jsonResult` (lines 8–34) | All tool handlers use these |
| `src/lib/mcp/tools.ts` | `DateKeyShape` (91–94), `logNoteCore` (411–421), `log_note` registration (2392–2401) | Pattern to mirror for write tools |
| `src/lib/records.ts` | `canonicalExerciseName` (145–147), `getExerciseSummaries` (414–465) | Exercise canonicalization + PR detection |
| `src/lib/calendar.ts` / `calendar-core.ts` | `parseDateKey`, `startOfDay`, `endOfDay`, `dateKey as toDateKey` | Date bucketing — required for all date math |
| `src/lib/note-actions.ts` | `resolveNote` (6–16) | Server action + revalidatePath pattern |
| `src/components/CollapsibleCard.tsx` | `CollapsibleCard` (4–32) | Shell for the Footage card |
| `src/components/Card.tsx` | `Card` (3–27) | Alternative card shell |
| `src/components/days/WorkoutLoggerForm.tsx` | `useState`, `useTransition`, import + call pattern | Mirror for `FootageForm` |
| `src/app/days/[dateKey]/page.tsx` | `completedDetails` query (111–121), card layout (200–357), `CollapsibleCard` usage (215–244) | Insertion point for footage card + pattern for passing data to components |
| `prisma/schema.prisma` | `Workout` (12–29), `Note` (85–113) for style | `Workout` receives `footageMarkers FootageMarker[]` |

**Imports the Developer agents must add to `tools.ts`**:
```ts
import { resolveWorkoutIdForDay } from "@/lib/footage-core";
```
(`canonicalExerciseName`, `getExerciseSummaries`, `parseDateInput`, `safe`, `startOfDay`, `endOfDay`, `toDateKey`, `resolveDay`, `prisma` are already imported in `tools.ts`.)

**Imports the Developer agents must add to `page.tsx`**:
```ts
import { FootageForm } from "@/components/days/FootageForm";
import { FootageList, type SerializedMarker } from "@/components/days/FootageList";
import { canonicalExerciseName } from "@/lib/records";
import { endOfDay } from "@/lib/calendar";
```
(`prisma`, `startOfDay`, `parseDateKey`, `CollapsibleCard` are already imported in the page.)

---

## 3. Risks

### RISK-1 — Neon additive-migration safety
`prisma migrate dev --name footage-markers` writes to the Neon DB, which is also production. The Developer agent runs `prisma generate` only. The orchestrator reviews the generated SQL before running `migrate dev`. **The SQL must be 100% additive**: one new table `FootageMarker`, two `CREATE INDEX` statements, and one `ALTER TABLE Workout ADD COLUMN footageMarkers` (virtual relation — no actual column, just the Prisma relation — Prisma generates no migration SQL for virtual relation fields). Verify the diff contains no `DROP`, no `ALTER COLUMN`, and no changes to existing tables beyond potentially adding an FK column to `Workout` — actually Prisma puts the FK on `FootageMarker` (`workoutId`), not `Workout`, so `Workout` itself gets zero SQL changes.

### RISK-2 — SSRF via `externalRef` / `filename`
These are user-supplied strings stored in Postgres. **The goaldmine server must never fetch or dereference them.** No `fetch(externalRef)`, no `readFile(filename)`, no URL-resolution of any stored string. ClipForge is the system that holds the files; goaldmine holds only the reference string. Confirm no `fetch` call exists near the footage create/read paths.

### RISK-3 — `filename` / `capturedAt` match robustness
Duplicate filenames are allowed (PRD §6). ClipForge resolves ambiguity via `capturedAt`. `capturedAt` is optional — ClipForge must handle `null`. The spec doc must document the fallback: when `capturedAt` is null, ClipForge cannot disambiguate duplicates and must surface the ambiguity to the user. This is a ClipForge concern, not a goaldmine concern — but the spec must say it clearly.

### RISK-4 — workoutId resolution when no completed workout exists
`resolveWorkoutIdForDay` returns `null` when no completed workout exists. `FootageMarker.workoutId` is nullable (`String?` in Prisma), `onDelete: SetNull`. The marker stores day-level only (workoutId null). The exercise picker still shows exercises from the template if no workout is logged. Nothing breaks — this is the designed behavior per PRD §6.

### RISK-5 — CRIT: No Date objects to client components (serialization)
`FootageMarker.capturedAt` and `FootageMarker.createdAt` are `Date` instances in Prisma. The Day page is a server component, but `FootageList` is `"use client"`. Passing a `Date` prop from a server component to a client component causes a serialization error in Next.js 16 (non-serializable). **Must convert before passing**:
```ts
const footageMarkers: SerializedMarker[] = rawMarkers.map(m => ({
  ...m,
  capturedAt: m.capturedAt?.toISOString() ?? null,
  // createdAt is not passed to the client if not needed in the list
}));
```
The `SerializedMarker` type (exported from `FootageList.tsx`) must use `string | null` for `capturedAt`, never `Date`.

### RISK-6 — `getExerciseSummaries()` full scan in `get_day_footage`
`getExerciseSummaries()` calls `prisma.workoutExercise.findMany({ include: { sets: true, workout: { ... } } })` — a full scan of all workout exercises. For a single-user app with <1k workouts this is acceptable, but it is a larger query than strictly needed. Alternative: a targeted query to check if any set in the day's workout beats the prior best. For v1, the full scan is fine; note it for future optimization.

---

## 4. Conventions Checklist

1. **Date math** — all via `@/lib/calendar` or `@/lib/calendar-core`. No `setHours`, `getDate`, `getMonth`, `getFullYear` against raw UTC Date.
2. **`date` input parsing** — `parseDateInput(s)` for MCP tools (bare yyyy-mm-dd → USER_TZ midnight); `parseDateKey(dateKey)` for server actions / page route params.
3. **`exerciseName` storage** — always `canonicalExerciseName(rawInput)` before `prisma.footageMarker.create`. Store null (not empty string) when no exercise is selected.
4. **`safe()` wrapper** — every MCP tool handler body wrapped in `safe(async () => { ... })`.
5. **Write-tool return** — `{ id: string; message: string }` exactly — no extra fields.
6. **Zod `.describe()`** — every field in `inputSchema` has a `.describe("...")` string.
7. **`revalidatePath`** — called for `/days/${dateKey}` and `/` after every mutation in server actions.
8. **No Date objects to client** — `capturedAt` serialized to ISO string before passing to `FootageList`. `SerializedMarker.capturedAt: string | null`.
9. **Text-only render** — `externalRef`, `filename`, `label` rendered as text content. No `dangerouslySetInnerHTML`.
10. **Migration gate** — Developer agent runs `npx prisma generate` only. Orchestrator runs `npx prisma migrate dev --name footage-markers` after SQL review.
11. **Prisma singleton** — `import { prisma } from "@/lib/db"`.
12. **Tailwind tokens** — `var(--accent)`, `var(--muted)`, `var(--border)`, `var(--card)`, `var(--warning)` only. No utility color classes.
13. **Touch targets** — `min-h-[44px]` on buttons, selects, kind toggles.
14. **No new packages / no blob storage** — `package.json` must be unchanged.
15. **`workoutId` resolution** — only via `resolveWorkoutIdForDay` from `footage-core.ts` (DRY; both write paths import it).
