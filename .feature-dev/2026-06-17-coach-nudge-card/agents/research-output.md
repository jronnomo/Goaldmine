# Research Output: Story 3.3-a — Coach Nudge Card

**Story:** #98 — In-app "Coach" nudge surface (display + dismiss pending open-items)
**Date:** 2026-06-17
**Branch context:** fix/nutrition-macro-residual (current), story targets /coach page

---

## 1. `/coach/page.tsx` — Current State

**File:** `src/app/coach/page.tsx` (137 lines)

- **Server component** (no `"use client"` directive). Has `export const dynamic = "force-dynamic"`.
- **No data fetching** whatsoever — purely static render.
- Structure: a `PROMPTS` array of 12 objects `{ title, when, prompt, id? }` rendered as `<Card>` + `<CopyPromptButton>` in a `<ul>`.
- Layout: `max-w-md mx-auto p-4 space-y-4` with a `<header>`, a one-time setup `<Card>`, then the prompt list.
- Accessed via the MoreSheet → "Coach prompts" (`/coach`).

**Where the nudge section slots in:** A new `<Card title="Nudges">` section should appear **above** the `<Card title="One-time setup">` block (line 100). The training-focused memory puts nudges on /coach, not Today — making /coach the first thing you see when there are pending items makes it prominent without polluting Today's training flow. Visually: header → nudge card (if any open items exist) → setup card → prompt list.

---

## 2. `list_open_items` — MCP Tool & Underlying Query

**File:** `src/lib/mcp/tools.ts`, lines 496–513 (helper) + 1178–1191 (tool registration)

The shared helper is `fetchOpenItems()` (async, module-private):

```ts
// src/lib/mcp/tools.ts:498–513
async function fetchOpenItems(): Promise<
  { id: string; body: string; targetDate: string | null; priority: string | null; overdue: boolean }[]
> {
  const now = startOfDay(new Date());
  const items = await prisma.note.findMany({
    where: { type: "open_item", resolvedAt: null },
    orderBy: [{ targetDate: { sort: "asc", nulls: "last" } }, { date: "asc" }],
    select: { id: true, body: true, targetDate: true, priority: true, date: true },
  });
  return items.map((item) => ({
    id: item.id,
    body: item.body,
    targetDate: item.targetDate ? toDateKey(item.targetDate) : null,
    priority: item.priority,
    overdue: item.targetDate !== null && item.targetDate < now,
  }));
}
```

**Output shape per item:** `{ id: string; body: string; targetDate: string | null; priority: string | null; overdue: boolean }`

**Sort order:** `targetDate ASC nulls last`, then `date ASC` (creation date as tiebreaker).

**Overdue definition:** `item.targetDate !== null && item.targetDate < startOfDay(now)` — a DB DateTime compared against the USER_TZ start-of-day instant. Strictly "past midnight today".

**No standalone lib helper exists** — `fetchOpenItems` is defined inline in tools.ts and not exported. The /coach page must inline the equivalent Prisma query (copy the query + overdue computation). The query is trivial enough that inlining is the right call — no need to extract a lib fn just for this.

**The page-side query to use (server component, direct Prisma):**

```ts
import { prisma } from "@/lib/db";
import { startOfDay } from "@/lib/calendar";

const now = startOfDay(new Date());
const openItems = await prisma.note.findMany({
  where: { type: "open_item", resolvedAt: null },
  orderBy: [{ targetDate: { sort: "asc", nulls: "last" } }, { date: "asc" }],
  select: { id: true, body: true, targetDate: true, priority: true, date: true },
});
// Map to typed shape with overdue flag:
const nudges = openItems.map((item) => ({
  id: item.id,
  body: item.body,
  targetDate: item.targetDate,       // keep as Date for server-side display
  priority: item.priority,           // "high" | "normal" | "low" | null
  overdue: item.targetDate !== null && item.targetDate < now,
}));
```

---

## 3. The `Note` Model — `open_item` Fields

**File:** `prisma/schema.prisma`, lines 85–113

```prisma
model Note {
  id                 String    @id @default(cuid())
  date               DateTime  @default(now())   // when created
  body               String
  type               String    @default("journal")
  // open_item | journal | audible | feedback | standing_rule | review
  targetDate         DateTime? // due/decide-by date (USER_TZ midnight stored as UTC)
  resolvedAt         DateTime? // null = pending; non-null = resolved
  resolvedReason     String?
  lastAcknowledgedAt DateTime? // standing_rule only
  priority           String?   // "high" | "normal" | "low" | null (open_item only)
  createdAt          DateTime  @default(now())
  ...
  @@index([type])
  @@index([targetDate])
  @@index([resolvedAt])
}
```

**"Pending/unresolved":** `resolvedAt IS NULL` — the canonical pending filter.

**`targetDate` semantics:** Stored as a UTC DateTime representing USER_TZ midnight (same wall-clock bucketing used everywhere). Created by `parseDateInput(input.targetDate)` in tools.ts which calls `userTzWallClockToUTC` from calendar-core. On display, format with `USER_TZ` via `Intl.DateTimeFormat`.

**`priority` values:** `"high"`, `"normal"`, `"low"`, or `null` (no priority set). The MCP tool uses `z.enum(["high", "normal", "low"])` — these are the only valid values.

**Display sort recommendation (page-side):** The DB query already sorts overdue (non-null targetDate ASC) first, nulls last. For high-priority emphasis within groups, a secondary JS sort by priority (`high → normal → low → null`) after the DB query gives the right visual order.

---

## 4. `resolve_open_item` / Dismiss Path

**MCP tool:** `src/lib/mcp/tools.ts`, lines 2437–2466

The MCP tool's resolve logic:

```ts
// validates type === "open_item", then:
await prisma.note.update({
  where: { id },
  data: { resolvedAt: new Date(), resolvedReason: reason },
});
```

**No standalone lib function exists for resolving open items** — unlike `resolveNote` / `resolveAllPendingNotes` in `src/lib/note-actions.ts`, there is no `resolveOpenItem()` lib export.

**Pattern to mirror for the /coach page dismiss action:**

`src/lib/note-actions.ts` (lines 1–17) contains `resolveNote()` — a Next.js server action that:
1. Has `"use server"` at file top
2. Calls `prisma.note.update({ where: { id }, data: { resolvedAt, resolvedReason } })`
3. Calls `revalidatePath("/")`, `revalidatePath("/journal")`, `revalidatePath("/goals")`

For the coach nudge dismiss, the same pattern applies, but:
- Must validate `type === "open_item"` before updating (the MCP tool throws if not)
- Add `revalidatePath("/coach")` to the revalidation list

**Recommended:** add a new `resolveOpenItem(id: string, reason?: string)` server action to `src/lib/note-actions.ts`. This keeps all note-mutation server actions in one file.

```ts
// to add to src/lib/note-actions.ts
export async function resolveOpenItem(id: string, reason?: string) {
  const note = await prisma.note.findUnique({ where: { id }, select: { type: true } });
  if (!note || note.type !== "open_item") return; // silent guard in UI context
  await prisma.note.update({
    where: { id },
    data: {
      resolvedAt: new Date(),
      resolvedReason: reason?.trim() || "dismissed",
    },
  });
  revalidatePath("/coach");
  revalidatePath("/"); // Today indicator (if any)
}
```

---

## 5. Existing Pending Notes / Open Items Display Patterns

### `PendingNotes` component
**File:** `src/components/PendingNotes.tsx` (93 lines)

- `"use client"` component — receives pre-fetched `PendingNote[]` from parent server component.
- Uses `useTransition()` for async server action calls without blocking UI.
- Pattern: `startTransition(() => resolveNote(n.id))` — the dismiss button calls the server action inside a transition, which allows the component to show a `pending` state (button disabled).
- Per-item `"Mark resolved"` button + bulk `"Resolve all"` confirm button.
- No optimistic removal — full rerender via `revalidatePath` after the action.

### `/journal` page server action pattern
**File:** `src/app/journal/page.tsx` (88 lines)

- Server component fetches `prisma.note.findMany(...)` directly.
- Passes a subset to `<PendingNotes notes={needsReview} goalId={...}>`.
- The client component calls `resolveNote` / `resolveAllPendingNotes` from `src/lib/note-actions.ts` via `startTransition`.
- `revalidatePath("/")` + `revalidatePath("/journal")` + `revalidatePath("/goals")` in the server action → full server-component rerender on next navigation or explicit revalidation.

**Model to mirror for the coach nudge card:**

1. Server component (`/coach/page.tsx`) fetches open items directly via Prisma.
2. Passes the fetched list to a new `"use client"` component (`CoachNudgeList` or similar).
3. That client component calls `resolveOpenItem(id)` inside `startTransition`.
4. `revalidatePath("/coach")` in the action triggers a fresh fetch on next render.

The `ConfirmButton` component (`src/components/ConfirmButton.tsx`) already implements the two-tap confirm pattern used in PendingNotes — reuse for the dismiss button so a fat-finger doesn't accidentally dismiss a nudge.

---

## 6. Today Page — Subtle Indicator Decision

**File:** `src/app/page.tsx` (465 lines)

**Recommendation: add NOTHING to Today.** Per the `today-page-training-focused` memory, the Today page is explicitly not for coaching-loop plumbing. The current page is already dense (CharacterHeader, OtherGoalsStrip, hero workout section, FeasibilityReadout, BaselinesBlockCard, workout blocks, Nutrition, Recent workouts).

**If a subtle indicator is desired anyway,** the least-intrusive slot is inside the MoreSheet's "Coach prompts" row (`src/components/MoreSheet.tsx`, line 91–97). A small count badge next to the label (e.g. `"Coach prompts · 3 nudges"` in the `sub` text, or a numeric badge) would be visible when the user taps the "More" tab. This requires MoreSheet to receive an `openItemCount` prop from layout.tsx (which is the root layout and could fetch it once per request).

**Alternative (also subtle):** The AppHeader (`src/components/AppHeader.tsx`) — if it renders on the coach page — could show a badge. But AppHeader is likely not on Today's training view.

**Verdict:** The cleanest path is no Today indicator. The /coach page itself becomes the canonical home for nudges. The MoreSheet's "Coach prompts" sub-label can surface the count server-side by fetching in layout if really needed, but that adds a layout-level DB query to every page load. Defer until there's a real user pain point.

---

## 7. USER_TZ / Overdue — Server-Side Pitfalls

**File:** `src/lib/calendar-core.ts`, lines 14 and 93–96

```ts
export const USER_TZ = process.env.USER_TZ ?? "America/Denver";

export function startOfDay(d: Date): Date {
  const { year, month, day } = userParts(d);
  return userTzWallClockToUTC(year, month, day);
}
```

**Pitfalls:**

1. **SERVER-ONLY** — `startOfDay` and `USER_TZ` work correctly only in Node/Edge (server components, server actions). `calendar-core.ts` explicitly states "no DB or IO" but `USER_TZ` reads `process.env` which is undefined in the browser. Do NOT call `startOfDay` in a client component.
2. **`targetDate` display:** The `targetDate` column is a UTC DateTime stored as a USER_TZ-midnight instant. When displaying in a server component, format with `new Intl.DateTimeFormat("en-US", { timeZone: USER_TZ, ... })` or simply extract the date-string via `dateKey(item.targetDate)` (which uses `userParts` internally). Never use `.toLocaleDateString()` in a server component — Vercel's runtime is UTC, so the wall clock will be wrong.
3. **Overdue comparison:** The Prisma field is a `DateTime`, so `item.targetDate < startOfDay(new Date())` is a JavaScript `Date` comparison — this is correct server-side. Do not serialize to string before comparing.
4. **Client component receiving open items:** Pass serializable props. `Date` objects from Prisma do not serialize across the server/client boundary in Next.js App Router without conversion. Pass `targetDate` as an ISO string or a `dateKey` string to the client component — not as a raw `Date`.

---

## 8. Empty State

When `openItems.length === 0`, the coach nudge section should render a simple empty-state paragraph rather than hiding entirely — showing the section reinforces that nudges land here:

```
No open nudges. When the coach writes action items via log_open_item, they'll appear here.
```

Alternatively, hide the section entirely (`{nudges.length > 0 && <Card>...</Card>}`) to keep the page clean — consistent with how journal's `needsReview` card is conditionally rendered at `/journal/page.tsx:50`.

**Recommendation:** Hide when empty (no card rendered) — the coach prompt cards below already communicate what the page is for. An always-visible empty card would be visual noise on most visits.

---

## Summary Table

| Question | Answer |
|---|---|
| /coach is server or client? | Server component (`export const dynamic = "force-dynamic"`) |
| Does /coach currently fetch data? | No — static PROMPTS array only |
| Where does nudge section slot in? | Above "One-time setup" card (line 100), below `<header>` |
| fetchOpenItems lib helper? | No — inline the Prisma query from tools.ts:498–513 |
| overdue computed how? | `item.targetDate !== null && item.targetDate < startOfDay(new Date())` |
| Sort order | targetDate ASC nulls last, then date ASC (creation) |
| resolveOpenItem lib fn? | Does not exist yet — add to src/lib/note-actions.ts |
| Server action pattern? | Mirror resolveNote() in note-actions.ts; add revalidatePath("/coach") |
| Client component pattern? | "use client" + useTransition + startTransition(() => resolveOpenItem(id)) |
| Confirm tap before dismiss? | Yes — reuse ConfirmButton (two-tap pattern, same as PendingNotes) |
| Today indicator? | Do not add — memory explicitly prohibits coaching plumbing on Today |
| USER_TZ pitfall | startOfDay is server-only; pass Date→string to client components |
| Empty state | Hide card entirely when openItems.length === 0 |
| targetDate display server-side | Use Intl.DateTimeFormat with USER_TZ or dateKey() |

---

## Key File Paths

- `src/app/coach/page.tsx` — target page; insert fetch + nudge card section
- `src/lib/mcp/tools.ts:496–513` — `fetchOpenItems` reference query to mirror
- `src/lib/note-actions.ts` — add `resolveOpenItem()` server action here
- `src/components/PendingNotes.tsx` — client-component pattern to mirror
- `src/components/ConfirmButton.tsx` — two-tap confirm button to reuse
- `src/lib/calendar-core.ts:14,93–96` — USER_TZ + startOfDay (server-only)
- `src/app/journal/page.tsx:50–64` — conditional card + PendingNotes wiring pattern
- `prisma/schema.prisma:85–113` — Note model field definitions
