# Architecture Blueprint — Footage Markers

**Feature**: `2026-06-18-footage-markers`  
**PRD**: `docs/prds/PRD-footage-markers.md` (§3 requirements, §4 technical design, §8 acceptance criteria are authoritative)  
**Stack**: Next.js 16 App Router · TS strict · Tailwind v4 · Prisma 7 / Neon · MCP (`@modelcontextprotocol/sdk`) · Zod 4

---

## 1. File Plan

| File | Action | Work stream |
|------|--------|-------------|
| `prisma/schema.prisma` | MODIFY — add `FootageMarker` model + `Workout.footageMarkers` relation | Backend |
| `src/lib/footage-core.ts` | NEW — shared `resolveWorkoutIdForDay` helper (no `"use server"`) | Backend |
| `src/lib/footage-actions.ts` | NEW — `"use server"` server actions: `logFootageMarker`, `deleteFootageMarker` | Backend |
| `src/lib/mcp/tools.ts` | MODIFY — register `log_footage`, `get_day_footage`, `delete_footage` | Backend |
| `src/components/days/FootageForm.tsx` | NEW — `"use client"` add-marker form | Frontend |
| `src/components/days/FootageList.tsx` | NEW — `"use client"` marker list with highlight badge + delete | Frontend |
| `src/app/days/[dateKey]/page.tsx` | MODIFY — query markers, compute exercise list, render Footage CollapsibleCard | Frontend |
| `docs/roadmap/clipforge-day-footage-integration.md` | NEW — ClipForge consumer spec (design, not code) | Backend |

---

## 2. Prisma `FootageMarker` Model

Add the following block to `prisma/schema.prisma` **after** the `Measurement` model (after line 70 in the current schema):

```prisma
model FootageMarker {
  id           String    @id @default(cuid())
  date         DateTime  // USER_TZ midnight — the day the footage is bucketed to (parseDateInput)
  capturedAt   DateTime? // when the clip was shot (camera metadata); match/disambiguation key
  kind         String    @default("video") // "video" | "photo"
  filename     String?   // original filename — primary match key for ClipForge
  externalRef  String?   // optional URI / cloud link / ClipForge clip id — STORED ONLY, never fetched
  label        String    // human caption, e.g. "24-pull-up PR — hero shot"
  workoutId    String?   // optional link to the day's Workout (resolved by date range)
  exerciseName String?   // canonicalExerciseName — links the clip to an exercise
  taskType     String?   // optional: "workout" | "hike" | "baseline" | "other"
  highlight    Boolean   @default(false) // the hero / featured shot
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  workout      Workout?  @relation(fields: [workoutId], references: [id], onDelete: SetNull)

  @@index([date])
  @@index([workoutId])
}
```

Add the following relation field to the **`Workout` model** (after `exercises WorkoutExercise[]` on line 27):

```prisma
  footageMarkers FootageMarker[]
```

**Migration name**: `footage-markers`  
**Developer agent instruction**: Run `npx prisma generate` only — this updates `src/generated/prisma` so `prisma.footageMarker` is available. Do NOT run `npx prisma migrate dev`. The orchestrator reviews the generated SQL and runs the migration on Neon.  
**Migration safety**: Additive only — one new table + two indexes + one nullable FK on `FootageMarker`. The `Workout` model receives only a virtual Prisma relation field (no SQL column added to `Workout`). Verify the generated SQL diff contains zero `DROP`, zero `ALTER COLUMN`, and no changes to any existing table.

---

## 3. `footage-core.ts` — Shared Helper

**File**: `src/lib/footage-core.ts`  
**Purpose**: DRY helper for workoutId resolution. Both `log_footage` (MCP) and `logFootageMarker` (server action) import this — the only way to guarantee the two write paths can't drift.

```ts
// src/lib/footage-core.ts
// Shared, server-side (not "use server") helper for footage operations.
// Imported by footage-actions.ts AND tools.ts — must stay side-effect free.

import { endOfDay } from "@/lib/calendar";
import { prisma } from "@/lib/db";

/**
 * Resolve the completed workout id for the given USER_TZ midnight date.
 * Returns null when no completed workout exists on that day.
 *
 * Shared between log_footage (MCP) and logFootageMarker (server action).
 * Both write paths MUST use this function — do not inline the logic separately.
 *
 * @param dayStart  USER_TZ midnight Date (from parseDateInput or parseDateKey).
 */
export async function resolveWorkoutIdForDay(dayStart: Date): Promise<string | null> {
  const dayEnd = endOfDay(dayStart);
  const w = await prisma.workout.findFirst({
    where: {
      startedAt: { gte: dayStart, lte: dayEnd },
      status: "completed",
    },
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });
  return w?.id ?? null;
}
```

---

## 4. `footage-actions.ts` — Server Actions

**File**: `src/lib/footage-actions.ts`  
**Directive**: `"use server"` (first line of file)

```ts
"use server";

import { revalidatePath } from "next/cache";
import { parseDateKey, dateKey as toDateKey } from "@/lib/calendar-core";
import { canonicalExerciseName } from "@/lib/records";
import { prisma } from "@/lib/db";
import { resolveWorkoutIdForDay } from "@/lib/footage-core";

// --------------------------------------------------------------------------
// logFootageMarker
// --------------------------------------------------------------------------
// FormData fields:
//   date        string  yyyy-mm-dd            REQUIRED
//   label       string  human caption         REQUIRED (non-empty)
//   kind        string  "video" | "photo"     REQUIRED (default "video" if missing)
//   exerciseName string canonicalized name, or "" for whole-day
//   filename    string  original filename, or ""
//   highlight   string  "true" | "false"
//   capturedAt  string  ISO datetime string, or ""  (optional)

export async function logFootageMarker(formData: FormData): Promise<void> {
  const dateKey       = String(formData.get("date"));          // yyyy-mm-dd
  const label         = String(formData.get("label")).trim();
  const kind          = String(formData.get("kind") || "video");
  const exerciseRaw   = String(formData.get("exerciseName") || "").trim();
  const filename      = String(formData.get("filename") || "").trim() || null;
  const highlight     = formData.get("highlight") === "true";
  const capturedAtRaw = String(formData.get("capturedAt") || "").trim();

  if (!label) throw new Error("label is required");

  const dayStart    = parseDateKey(dateKey);                   // USER_TZ midnight
  const workoutId   = await resolveWorkoutIdForDay(dayStart);  // shared helper
  const exerciseName = exerciseRaw ? canonicalExerciseName(exerciseRaw) : null;
  const capturedAt  = capturedAtRaw ? new Date(capturedAtRaw) : null;

  await prisma.footageMarker.create({
    data: {
      date: dayStart,
      label,
      kind,
      filename,
      highlight,
      capturedAt,
      exerciseName,
      workoutId,
      // externalRef and taskType are not surfaced in the Day-page form (MCP-only)
    },
  });

  revalidatePath(`/days/${dateKey}`);
  revalidatePath("/");
}

// --------------------------------------------------------------------------
// deleteFootageMarker
// --------------------------------------------------------------------------
// FormData fields:
//   id      string  FootageMarker id   REQUIRED
//   dateKey string  yyyy-mm-dd         REQUIRED (for revalidatePath — avoids extra DB fetch)

export async function deleteFootageMarker(formData: FormData): Promise<void> {
  const id      = String(formData.get("id"));
  const dateKey = String(formData.get("dateKey")); // passed by FootageList as hidden field

  await prisma.footageMarker.delete({ where: { id } });

  revalidatePath(`/days/${dateKey}`);
  revalidatePath("/");
}
```

---

## 5. MCP Tool Registrations

Insert the three registrations into `src/lib/mcp/tools.ts` **after** the `delete_hike` tool registration (search for `"delete_hike"` — register footage tools in a contiguous block immediately after it). Add one import at the top of the file alongside the existing records import:

```ts
import { resolveWorkoutIdForDay } from "@/lib/footage-core";
```

(`canonicalExerciseName`, `getExerciseSummaries`, `parseDateInput`, `safe`, `startOfDay`, `endOfDay`, `toDateKey`, `resolveDay`, `prisma` are already imported in tools.ts.)

---

### 5.1 `log_footage` — write

```ts
server.registerTool(
  "log_footage",
  {
    title: "Tag a footage clip to a day / exercise",
    description:
      "Create a FootageMarker — metadata only, never media bytes. " +
      "Associates a clip (by filename / capturedAt) to a day and optionally an exercise. " +
      "workoutId is resolved automatically from the day's completed workout. " +
      "exerciseName is canonicalized via the exercise alias map. " +
      "externalRef is stored as-is and NEVER fetched — goaldmine has zero SSRF surface. " +
      "Use get_day_footage to read markers back.",
    inputSchema: {
      date: DateKeyShape,
      label: z
        .string()
        .min(1)
        .describe("Human caption for the clip, e.g. '24-pull-up PR — hero shot'"),
      kind: z
        .enum(["video", "photo"])
        .default("video")
        .describe("Media type: 'video' or 'photo'. Default: video."),
      filename: z
        .string()
        .optional()
        .describe(
          "Original filename, e.g. 'IMG_4412.mov'. Primary match key ClipForge uses to locate the file on disk.",
        ),
      externalRef: z
        .string()
        .optional()
        .describe(
          "Optional URI, cloud link, or ClipForge clip id. " +
          "STORED ONLY — this server never fetches or dereferences this value.",
        ),
      capturedAt: z
        .string()
        .optional()
        .describe(
          "ISO datetime string for when the clip was shot (camera EXIF / capture timestamp). " +
          "Used as ClipForge disambiguation key when filename collides. Pass verbatim from camera metadata.",
        ),
      exerciseName: z
        .string()
        .optional()
        .describe(
          "Exercise this clip captures, e.g. 'Pull-Up'. Canonicalized via the exercise alias map before storage. " +
          "Omit for whole-day / non-exercise footage.",
        ),
      taskType: z
        .enum(["workout", "hike", "baseline", "other"])
        .optional()
        .describe(
          "What kind of session this clip belongs to. " +
          "Omit when the day is a standard workout day — it will be clear from context.",
        ),
      highlight: z
        .boolean()
        .default(false)
        .describe(
          "Mark this as the hero / featured shot — the clip ClipForge leads the Reel with. " +
          "At most one marker per day should be highlighted, but this is not enforced.",
        ),
    },
  },
  async (input) =>
    safe(async () => {
      const dayStart    = startOfDay(parseDateInput(input.date));
      const workoutId   = await resolveWorkoutIdForDay(dayStart); // footage-core.ts
      const exerciseName = input.exerciseName
        ? canonicalExerciseName(input.exerciseName)
        : null;
      const capturedAt  = input.capturedAt ? new Date(input.capturedAt) : null;

      const marker = await prisma.footageMarker.create({
        data: {
          date:         dayStart,
          label:        input.label,
          kind:         input.kind ?? "video",
          filename:     input.filename ?? null,
          externalRef:  input.externalRef ?? null,
          capturedAt,
          exerciseName,
          taskType:     input.taskType ?? null,
          highlight:    input.highlight ?? false,
          workoutId,
        },
      });

      return { id: marker.id, message: "Footage marker logged" };
    }),
);
```

---

### 5.2 `get_day_footage` — read

**Exact returned JSON shape** (field names are contractual — ClipForge depends on them):

```jsonc
{
  "date": "2026-06-18",                     // string yyyy-mm-dd
  "day": {
    "programWeek": 3,                        // number | null (null if outside plan)
    "programDay": 2,                         // number | null (r.rotationDay)
    "goal": {                                // null if no focus goal
      "objective": "Summit Mt. Elbert via Black Cloud Trail",
      "kind": "fitness"                      // "fitness" | "project"
    },
    "exercises": [                           // from completed workout, ordered by orderIndex
      { "name": "Pull-Up",      "order": 0, "isPR": true  },
      { "name": "Goblet Squat", "order": 1, "isPR": false }
    ],
    "taskType": "workout"                    // r.todayTask: "workout"|"rest"|"baseline"|"hike"|"out_of_plan"
  },
  "markers": [                               // highlight-first, then capturedAt asc, then createdAt asc
    {
      "id":           "clxxxx",
      "label":        "24-pull-up PR — hero shot",
      "kind":         "video",
      "filename":     "IMG_4412.mov",
      "externalRef":  null,
      "capturedAt":   "2026-06-18T09:15:00.000Z",  // ISO string | null
      "exerciseName": "Pull-Up",
      "highlight":    true
    }
  ]
}
```

```ts
server.registerTool(
  "get_day_footage",
  {
    title: "Get day structure + footage markers",
    description:
      "Return the ordered day structure (programWeek/Day, goal narrative, exercises with PR flags, taskType) " +
      "plus all FootageMarkers for the given date — the exact shape ClipForge consumes to assemble a Reel. " +
      "Markers are ordered: highlight-first, then capturedAt ascending, then createdAt ascending. " +
      "exercises[] comes from the day's completed workout (orderIndex order); " +
      "isPR=true when the exercise's all-time best was set on this day. " +
      "Use log_footage to add markers; delete_footage to remove them.",
    inputSchema: {
      date: DateKeyShape,
    },
  },
  async ({ date }) =>
    safe(async () => {
      const dayStart = startOfDay(parseDateInput(date));
      const dayEnd   = endOfDay(dayStart);
      const dateStr  = toDateKey(dayStart);

      // 1. Completed workout + exercises ordered by orderIndex
      const workout = await prisma.workout.findFirst({
        where: { startedAt: { gte: dayStart, lte: dayEnd }, status: "completed" },
        orderBy: { startedAt: "desc" },
        include: { exercises: { orderBy: { orderIndex: "asc" } } },
      });

      // 2. PR detection — getExerciseSummaries full scan (single-user, acceptable for v1)
      const summaries = await getExerciseSummaries();
      const summaryByName = new Map(summaries.map(s => [s.name, s]));

      // 3. Day context for weekIndex + todayTask
      const r = await resolveDay(dayStart);

      // 4. Focus goal for narrative caption
      const focusGoal = await prisma.goal.findFirst({
        where: { isFocus: true, active: true },
        select: { objective: true, kind: true },
      });

      // 5. Footage markers — highlight-first, then capturedAt asc, then createdAt asc
      const rawMarkers = await prisma.footageMarker.findMany({
        where: { date: { gte: dayStart, lte: dayEnd } },
        orderBy: [
          { highlight: "desc" },
          { capturedAt: "asc" },
          { createdAt: "asc" },
        ],
      });

      // 6. Build exercises[] with canonicalized names + PR flags
      const exercises = (workout?.exercises ?? []).map(ex => {
        const canonical = canonicalExerciseName(ex.name);
        const s         = summaryByName.get(canonical);
        const isPR      = s != null && s.bestDate >= dayStart && s.bestDate <= dayEnd;
        return { name: canonical, order: ex.orderIndex, isPR };
      });

      return {
        date: dateStr,
        day: {
          programWeek: r.weekIndex,
          programDay:  r.rotationDay,
          goal: focusGoal
            ? { objective: focusGoal.objective, kind: focusGoal.kind }
            : null,
          exercises,
          taskType: r.todayTask,
        },
        markers: rawMarkers.map(m => ({
          id:           m.id,
          label:        m.label,
          kind:         m.kind,
          filename:     m.filename,
          externalRef:  m.externalRef,
          capturedAt:   m.capturedAt?.toISOString() ?? null,  // ISO string — no Date objects
          exerciseName: m.exerciseName,
          highlight:    m.highlight,
        })),
      };
    }),
);
```

---

### 5.3 `delete_footage` — write

```ts
server.registerTool(
  "delete_footage",
  {
    title: "Delete a footage marker",
    description:
      "Remove a FootageMarker by id. " +
      "Use get_day_footage to find marker ids. " +
      "Deletion is permanent — there is no undo.",
    inputSchema: {
      id: z
        .string()
        .describe("FootageMarker id to delete — find via get_day_footage"),
    },
  },
  async ({ id }) =>
    safe(async () => {
      await prisma.footageMarker.delete({ where: { id } });
      return { id, message: "Footage marker deleted" };
    }),
);
```

---

## 6. Type Definitions

### `footage-core.ts` (no exported types needed — helper only)

### `FootageList.tsx` — `SerializedMarker` (exported)

```ts
// src/components/days/FootageList.tsx (top of file, before component)
export type SerializedMarker = {
  id: string;
  label: string;
  kind: string;           // "video" | "photo"
  filename: string | null;
  externalRef: string | null;
  capturedAt: string | null;  // ISO string — NEVER a Date (client component constraint)
  exerciseName: string | null;
  highlight: boolean;
  // createdAt is NOT included — not needed in the UI
};
```

### `page.tsx` local type (inline, no export needed)

```ts
// In page.tsx after footageMarkers query:
const footageExercises: { name: string }[] = ...
```

---

## 7. Component Plan

### 7.1 `FootageForm` — `src/components/days/FootageForm.tsx`

```
"use client"
imports: { useState, useTransition } from "react"
import: { logFootageMarker } from "@/lib/footage-actions"
```

**Props**:
```ts
interface FootageFormProps {
  date: string;            // yyyy-mm-dd — written into hidden-equivalent state + passed to FormData
  exercises: { name: string }[];  // deduplicated, canonicalized exercise names for the picker
}
```

**State**: `label: string`, `kind: "video" | "photo"`, `exerciseName: string` (empty = whole day), `filename: string`, `highlight: boolean`, `error: string | null`  
**Transition**: `isPending` via `useTransition`

**Submit handler** — builds `FormData` manually (not a native `<form action>`) to support the `useTransition` reset:
```ts
const fd = new FormData();
fd.set("date", date);
fd.set("label", label.trim());
fd.set("kind", kind);
fd.set("exerciseName", exerciseName);     // "" = no exercise
fd.set("filename", filename.trim());
fd.set("highlight", String(highlight));
// capturedAt: omit if not surfaced in v1 form (MCP-only field for now)
startTransition(async () => {
  await logFootageMarker(fd);
  // reset controlled fields after success
  setLabel(""); setFilename(""); setHighlight(false);
});
```

**UI elements** (all `min-h-[44px]`, tokens only):
- `label` text input (required)
- `kind` toggle: two `<button type="button" aria-pressed>` side-by-side ("▶ video" / "⊞ photo")
- `exerciseName` `<select>`: first option `<option value="">whole day / no exercise</option>`, then one `<option>` per `exercises[i].name`
- `filename` text input (optional, placeholder "IMG_4412.mov")
- `highlight` toggle `<button type="button" aria-pressed>` ("☆ hero shot" / "★ hero shot")
- Submit `<button type="submit" disabled={isPending}>`
- Inline error: `{error && <p className="text-xs text-[var(--warning)]">{error}</p>}`

**Accessibility**: every `<input>` and `<select>` has a paired `<label htmlFor>`. Kind/highlight toggles have `aria-pressed`. Delete has confirm dialog.

---

### 7.2 `FootageList` — `src/components/days/FootageList.tsx`

```
"use client"
imports: { useTransition } from "react"
import: { deleteFootageMarker } from "@/lib/footage-actions"
```

**Props**:
```ts
interface FootageListProps {
  dateKey: string;           // yyyy-mm-dd — for revalidatePath in deleteFootageMarker
  markers: SerializedMarker[];
}
```

**Empty state**: `<p className="text-sm text-[var(--muted)]">No footage tagged for this day yet.</p>`

**Per-marker item** (inline sub-component `FootageMarkerItem`):
- First line: `{kind === "video" ? "▶" : "⊞"}` + `{filename}` (truncated) + `· {exerciseName}` (if set) + `★` in `var(--accent)` with `title="hero shot"` (if highlight)
- Second line: `{label}` (`text-xs text-[var(--muted)]`)
- Third line (highlight only): `<p className="text-xs text-[var(--accent)]">hero shot</p>` — text label so highlight is not conveyed by icon alone (a11y)
- Delete button: `<button type="button" onClick={handleDelete} aria-label="Delete footage marker: {label}" className="... min-h-[44px] min-w-[44px]">`

**Delete handler**:
```ts
function handleDelete() {
  if (!confirm("Remove this footage marker?")) return;
  const fd = new FormData();
  fd.set("id", marker.id);
  fd.set("dateKey", dateKey);    // passed from parent prop
  startTransition(() => deleteFootageMarker(fd));
}
```

---

## 8. Day-Page Wiring — `src/app/days/[dateKey]/page.tsx`

### 8.1 Imports to add (alongside existing imports)

```ts
import { FootageForm } from "@/components/days/FootageForm";
import { FootageList, type SerializedMarker } from "@/components/days/FootageList";
import { canonicalExerciseName } from "@/lib/records";
import { endOfDay } from "@/lib/calendar";
```

(`prisma`, `startOfDay`, `parseDateKey`, `CollapsibleCard`, `resolveDay`, `shownTemplate` are already available in the page.)

### 8.2 Data fetching — insert AFTER the `completedDetails` query (after line 121)

```ts
// ── Footage markers ──────────────────────────────────────────────────────────
// CRIT: rawMarkers contains Date objects — serialize before passing to client.
const rawMarkers = await prisma.footageMarker.findMany({
  where: { date: { gte: date, lte: endOfDay(date) } },
  orderBy: [{ highlight: "desc" }, { capturedAt: "asc" }, { createdAt: "asc" }],
});
const footageMarkers: SerializedMarker[] = rawMarkers.map(m => ({
  id:           m.id,
  label:        m.label,
  kind:         m.kind,
  filename:     m.filename,
  externalRef:  m.externalRef,
  capturedAt:   m.capturedAt?.toISOString() ?? null,  // no Date to client
  exerciseName: m.exerciseName,
  highlight:    m.highlight,
}));

// Exercise picker — completed workout first, template fallback
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

### 8.3 JSX insertion point — after `{!isFuture && (...logging section...)}` block, before `{(r.nutritionPlan || r.loggedNutrition.length > 0) && ...}` card

```tsx
{/* Footage card — all days (footage can be tagged retroactively or pre-tagged) */}
<CollapsibleCard
  title={`Footage${footageMarkers.length > 0 ? ` (${footageMarkers.length})` : ""}`}
  defaultOpen={footageMarkers.length > 0}
>
  <FootageList dateKey={dateKey} markers={footageMarkers} />
  <FootageForm date={dateKey} exercises={footageExercises} />
</CollapsibleCard>
```

---

## 9. ClipForge Consumer Spec Outline — `docs/roadmap/clipforge-day-footage-integration.md`

The document is written for ClipForge developers. It is design-only — no goaldmine code lives there.

### Required sections:

**§1 Overview** — purpose of the integration; goaldmine = structured index; ClipForge = footage store + editor; boundary = refs only (no bytes cross via goaldmine).

**§2 `get_day_footage` Contract**
- Full endpoint and authentication (MCP HTTP `POST /api/mcp`, bearer token).
- Exact JSON response shape (copy from §5.2 of this blueprint).
- Field semantics:
  - `date`: the bucketing key (USER_TZ midnight).
  - `day.exercises[].order`: the sequence index to use for clip ordering within a Reel.
  - `day.exercises[].isPR`: if true, apply a "PR" badge in the Reel caption.
  - `markers[].highlight`: marks the hero shot — ClipForge leads the Reel with it.
  - `markers[].capturedAt`: ISO string | null; null when camera metadata was not provided.
  - `markers[].externalRef`: opaque string stored by the user — may be a ClipForge clip id, a cloud URL, or null.

**§3 Filename→File Matching Algorithm**
1. Primary: search ClipForge's local file library for a file whose name exactly matches `marker.filename`.
2. If exactly one match: resolved.
3. If zero matches (file renamed or not yet ingested): mark as unresolved; surface to user.
4. If multiple matches (duplicate filenames on different days): disambiguate by `capturedAt`. Find the file whose EXIF/capture timestamp falls within ±30 seconds of `marker.capturedAt`. If `capturedAt` is null, surface all candidates to the user.
5. `externalRef`: if it is a ClipForge clip id (`cf_*` prefix), resolve directly by id. If it is a URL, present as an external reference link — do not auto-fetch.

**§4 First-Reel Assembly Flow**
1. Call `get_day_footage(date)`.
2. For each marker, resolve to a local file via §3 matching.
3. Order clips for the Reel:
   a. The highlight marker (if any) goes first — hero shot → opening clip.
   b. Non-highlight markers ordered by exercise sequence: find the matching exercise in `day.exercises[]` by `exerciseName`; sort by `exercises[].order` ascending.
   c. Within the same exercise, sort by `capturedAt` ascending (null-last).
   d. Markers with `exerciseName = null` (whole-day / B-roll) go last.
4. Opening card text: `day.goal.objective` — the goal narrative caption.
5. Per-clip label: `"{exerciseName}" + (" · PR" if isPR) + (" · ★" if highlight)`.
6. Output: ordered array of `{ file, label, exerciseName, isPR, highlight, capturedAt }`.

**§5 Null / Edge Cases**
- `markers: []` — return an empty Reel with goal narrative card only (not an error).
- `day.goal: null` — omit the goal narrative card.
- Unresolved files (§3 step 3/4) — include in output with `file: null`; ClipForge prompts user to locate them.
- `capturedAt: null` with duplicate filenames — include in output with `file: null` or `candidates: [...]`.

---

## 10. Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Write Path 1 — MCP (coach in claude.ai)                                     │
│                                                                             │
│  claude.ai  →  POST /api/mcp {log_footage, date, label, filename, ...}     │
│            →  tools.ts handler                                              │
│            →  parseDateInput(date) → dayStart (USER_TZ midnight)            │
│            →  resolveWorkoutIdForDay(dayStart)  [footage-core.ts]           │
│            →  canonicalExerciseName(exerciseName)                           │
│            →  prisma.footageMarker.create(...)                              │
│            →  { id, message: "Footage marker logged" }                      │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ Write Path 2 — Server Action (Day page form)                                │
│                                                                             │
│  FootageForm  →  FormData  →  logFootageMarker(formData)  [footage-actions] │
│              →  parseDateKey(dateKey) → dayStart                            │
│              →  resolveWorkoutIdForDay(dayStart)  [footage-core.ts]         │
│              →  canonicalExerciseName(exerciseName)                         │
│              →  prisma.footageMarker.create(...)                            │
│              →  revalidatePath("/days/[dateKey]") + revalidatePath("/")     │
│              →  RSC re-render (FootageList updates)                         │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ Read Path — MCP → ClipForge                                                 │
│                                                                             │
│  ClipForge  →  POST /api/mcp {get_day_footage, date: "2026-06-18"}         │
│            →  tools.ts handler                                              │
│            →  prisma.workout.findFirst (exercises by startedAt range)       │
│            →  getExerciseSummaries() → PR detection (bestDate in day range) │
│            →  resolveDay(dayStart) → weekIndex, todayTask                   │
│            →  prisma.goal.findFirst (isFocus=true) → objective, kind        │
│            →  prisma.footageMarker.findMany (day range, ordered)            │
│            →  { date, day: { exercises+PRs, goal, taskType }, markers: [...] } │
│                                                                             │
│  ClipForge filename-match → resolve files → order by exercise/capturedAt   │
│  → first Reel assembly                                                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 11. Work Streams

The two streams have **disjoint file sets**. They can run in parallel after the schema + footage-core prerequisite is done.

### Backend stream (one agent)
1. `prisma/schema.prisma` — add `FootageMarker` model + `Workout.footageMarkers`
2. Run `npx prisma generate`
3. `src/lib/footage-core.ts` — `resolveWorkoutIdForDay`
4. `src/lib/footage-actions.ts` — `logFootageMarker`, `deleteFootageMarker`
5. `src/lib/mcp/tools.ts` — add import + three tool registrations
6. `docs/roadmap/clipforge-day-footage-integration.md` — consumer spec
7. Vitest (see §12)

### Frontend stream (one agent)
1. Reads schema + footage-core AFTER backend step 2 (needs generated types)
2. `src/components/days/FootageList.tsx` — `SerializedMarker` type + `FootageList` + `FootageMarkerItem`
3. `src/components/days/FootageForm.tsx` — `FootageForm`
4. `src/app/days/[dateKey]/page.tsx` — add imports, data fetching, JSX insertion

**Dependency**: Frontend agent needs `src/generated/prisma` to be regenerated before the page.tsx query (`prisma.footageMarker.findMany`) typechecks. Coordinate: Backend agent runs `prisma generate` first, then Frontend agent starts `page.tsx` edits.

---

## 12. Implementation Order

```
1.  schema.prisma edit
2.  npx prisma generate          ← regenerates src/generated/prisma (FootageMarker type available)
3.  footage-core.ts              ← shared helper, no deps beyond calendar + prisma
4a. footage-actions.ts           ← depends on footage-core + generated client
4b. tools.ts additions           ← depends on footage-core + generated client (parallel with 4a)
4c. clipforge-day-footage-integration.md  ← independent, can be parallel
5a. FootageList.tsx              ← depends only on footage-actions (for deleteFootageMarker import)
5b. FootageForm.tsx              ← depends only on footage-actions (for logFootageMarker import)
6.  page.tsx wiring              ← depends on FootageForm, FootageList, generated prisma types
7.  Vitest                       ← after tools.ts additions (step 4b)
8.  npx tsc --noEmit + npm run lint + npm run build
```

---

## 13. Critical Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | `footage-core.ts` is NOT `"use server"` | It's a plain shared module so both MCP `tools.ts` and server actions `footage-actions.ts` can import it without a server boundary issue. `"use server"` in a file marks all exports as Actions — helpers must live outside. |
| 2 | `workoutId` resolved by `startedAt` range, not passed by caller | Callers (coach / form) know the date; the DB knows the workout. Resolution is deterministic and DRY. If the day has no completed workout, `workoutId = null` (marker is day-level — valid per PRD §6). |
| 3 | `capturedAt` stored raw UTC, no normalization | Camera metadata is a precise instant — not a date-bucketed value. USER_TZ normalization would corrupt it. Only `date` (the day bucket) is USER_TZ midnight. |
| 4 | `dateKey` passed as hidden field in `deleteFootageMarker` | Avoids an extra DB fetch to re-derive the dateKey from the stored `Date`. FootageList already receives `dateKey` as a prop — pass it through. |
| 5 | Footage CollapsibleCard renders on ALL day states (past/today/future) | Footage can be pre-tagged (plan the shot list) or retroactively tagged. No restriction by day state. |
| 6 | `exerciseName = null` stored (not empty string) when picker is blank | Prisma `String?` stores null for absent values. Server action uses `|| null` coercion on the raw FormData string. |
| 7 | `taskType` omitted from the Day-page form (hidden; null stored) | The Day page knows the day's task but surfacing another field adds friction. MCP coach can supply it. v1 simplification. |
| 8 | PR detection via full `getExerciseSummaries()` scan | Single-user app (<1k workouts). Acceptable for v1. Future optimization: targeted query for exercises in the day's workout only. |
| 9 | `externalRef` / `filename` stored, never fetched | SSRF rule: goaldmine has no HTTP client calls to user-supplied URLs. ClipForge resolves the refs on its side. |
| 10 | `SerializedMarker.capturedAt` is `string \| null`, never `Date` | Passing `Date` objects from server component to `"use client"` component is a serialization error in Next.js 16. All dates in the client-facing type are pre-formatted ISO strings. |
