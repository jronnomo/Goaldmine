# Architecture Blueprint — Coach Nudge Surface on /coach (Story #98, 3.3-a)

**Author:** Architect Agent
**Date:** 2026-06-17
**Input sources:** PRD-coach-nudge-card.md, research-output.md, coach/page.tsx, PendingNotes.tsx, note-actions.ts, ConfirmButton.tsx, Card.tsx, tools.ts:496–513, schema.prisma:85–113, calendar-core.ts, quality-tools.md

---

## 0. Decision log

Every architectural decision is recorded here. The Developer must not re-litigate these without a good reason.

| # | Decision | Alternative rejected | Why |
|---|----------|---------------------|-----|
| D-1 | `resolveOpenItem` goes in `src/lib/note-actions.ts` | Separate `coach-actions.ts` file | All note-mutation server actions live together; no new file warranted for a single function |
| D-2 | Type guard fetches the note first (findUnique + type check) | Trust the caller; skip the guard | The MCP tool does the same guard; the UI must not crash if IDs are somehow mismatched; silent return is the right UX (no error surface in a dismiss) |
| D-3 | `resolveOpenItem` revalidates `/coach` only (not `/`, `/journal`, `/goals`) | Revalidate everything like `resolveNote` does | Open items are coach-nudge–specific; `/` Today page must NOT change per memory `today-page-training-focused`; the other paths have no nudge surface |
| D-4 | `targetDateLabel` is a pre-formatted `string | null` passed to the client | Pass raw Date or ISO string | Dates do not serialize across the Next.js App Router server/client boundary without explicit handling; formatted strings are simpler, timezone-correct, and keep all TZ logic server-side |
| D-5 | `overdue` is a `boolean` computed server-side using `startOfDay` from `@/lib/calendar` | Compute in client | `startOfDay` reads `process.env.USER_TZ` which is undefined in the browser; overdue must be a server-side computation |
| D-6 | Inline the Prisma query in `coach/page.tsx` (copy from tools.ts:502–513) | Extract `fetchOpenItems` to a shared lib helper | The query is 5 lines; extraction adds a module boundary for no gain; research concurs |
| D-7 | Empty state: render the Card section always; show muted copy when empty | Hide Card when empty (research option B) | PRD section 4.2 explicitly specifies honest empty state text; the empty state forward-references the routine (#99) landing — it is intentional user communication |
| D-8 | `CoachNudges` uses `ConfirmButton` for per-item dismiss (two-tap) | Plain `<button>` like PendingNotes per-note resolve | PRD explicitly requires ConfirmButton for dismiss; "fat-finger doesn't accidentally dismiss a nudge" is the safety rationale; the per-note plain button in PendingNotes is the weaker pattern |
| D-9 | Long body: `whitespace-pre-wrap`, no truncation | Truncate to N chars | Open-item bodies may contain multi-line action items; truncation risks hiding key context; match PendingNotes |
| D-10 | `CoachPage` becomes `async function` | Keep sync, add a separate data-fetch wrapper | It is a server component with `force-dynamic`; making it async is the idiomatic App Router pattern; no RSC boundary change required |

---

## 1. `resolveOpenItem` server action

**File:** `src/lib/note-actions.ts`
**Insertion:** after line 17 (after the closing `}` of `resolveNote`), before line 19 (`export async function resolveAllPendingNotes`)

### Exact code to insert

```ts
export async function resolveOpenItem(id: string, reason?: string) {
  const note = await prisma.note.findUnique({ where: { id }, select: { type: true } });
  if (!note || note.type !== "open_item") return; // type guard — silent; UI must not crash on mismatch
  await prisma.note.update({
    where: { id },
    data: {
      resolvedAt: new Date(),
      resolvedReason: reason?.trim() || "dismissed from /coach",
    },
  });
  revalidatePath("/coach");
}
```

### Decisions confirmed

- **`"use server"`** at file top (line 1) — already present; the new export inherits it. Do NOT add a second `"use server"` inside the function.
- **Signature** `(id: string, reason?: string)` — exact match to `resolveNote`'s signature (line 6). No FormData; no bound args.
- **Update fields:** `resolvedAt: new Date()` (DateTime) + `resolvedReason: string` (String?). Both are confirmed present in the Note model (schema.prisma:96–97).
- **Type guard:** `findUnique` + check `note.type !== "open_item"` → silent return. No throw. Silent is correct: this is a UI action, not an API contract.
- **`revalidatePath`:** `/coach` only. `resolveNote` revalidates `/`, `/journal`, `/goals` — do NOT copy those. Open items are not shown on those routes; adding unnecessary revalidates wastes server rendering.
- **`resolveNote` does NOT have a type guard** — the new function intentionally adds one because it's callable from a public UI surface and open_item is a semantically meaningful type.

### What the file looks like after the insert (line numbers approximate)

```
1   "use server";
2
3   import { revalidatePath } from "next/cache";
4   import { prisma } from "@/lib/db";
5
6   export async function resolveNote(id: string, reason?: string) { ... }   // lines 6-17
7
8   // --- NEW ---
9   export async function resolveOpenItem(id: string, reason?: string) { ... } // lines 19-29
10
11  export async function resolveAllPendingNotes() { ... }                    // lines 31-end
```

---

## 2. `/coach/page.tsx` edits

**File:** `src/app/coach/page.tsx` (currently 137 lines)

### 2a. Imports to add (top of file, after existing imports)

```ts
import { prisma } from "@/lib/db";
import { startOfDay, dateKey, USER_TZ } from "@/lib/calendar";
import { CoachNudges } from "@/components/CoachNudges";
```

`@/lib/calendar` (not `calendar-core`) is the right import — it's what tools.ts uses, it re-exports all three symbols, and it's a server-side module (fine for a server component).

### 2b. Function signature change

```ts
// BEFORE (line 89):
export default function CoachPage() {

// AFTER:
export default async function CoachPage() {
```

The `force-dynamic` directive (line 4) is already present — no change needed there.

### 2c. Data fetch + shape map (insert before the `return`, after line 89 opening brace)

```ts
  // --- open-item query (mirrors tools.ts:502–513) ---
  const now = startOfDay(new Date());
  const openItems = await prisma.note.findMany({
    where: { type: "open_item", resolvedAt: null },
    orderBy: [{ targetDate: { sort: "asc", nulls: "last" } }, { date: "asc" }],
    select: { id: true, body: true, targetDate: true, priority: true },
  });

  const nudges = openItems.map((item) => ({
    id: item.id,
    body: item.body,
    priority: item.priority,                          // string | null
    overdue: item.targetDate !== null && item.targetDate < now, // boolean — server only
    targetDateLabel: item.targetDate
      ? new Intl.DateTimeFormat("en-US", {
          timeZone: USER_TZ,
          month: "short",
          day: "numeric",
        }).format(item.targetDate)
      : null,                                         // string | null — pre-formatted; no Date crosses to client
  }));
```

**Notes on the map:**
- `date` is dropped from the select (not needed for display; research output line 70 shows it in the reference query but the page doesn't use creation date in the nudge display).
- `overdue` comparison: `item.targetDate` is a `Date` (Prisma DateTime → JS Date); `now` is a `Date` from `startOfDay`. The `<` operator on two `Date` objects is a numeric timestamp comparison — correct.
- `Intl.DateTimeFormat` format: `{ month: "short", day: "numeric" }` → "Jun 20" style. This is the minimal human-readable label. No year shown (nudges are near-term by definition).
- No `item.targetDate.toLocaleDateString()` — banned; Vercel runtime is UTC, would format as wrong wall-clock.

### 2d. JSX insertion point (line 100 area, above the One-time setup Card)

```tsx
  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <header className="pt-2">
        <h1 className="text-2xl font-semibold tracking-tight">Coach prompts</h1>
        <p className="text-sm text-[var(--muted)] mt-1">...</p>
      </header>

      {/* --- NUDGE SECTION (new) --- */}
      <CoachNudges nudges={nudges} />

      <Card title="One-time setup">
        ...
      </Card>

      <ul className="space-y-3">
        ...
      </ul>
      ...
    </div>
  );
```

`<CoachNudges nudges={nudges} />` is inserted between the closing `</header>` tag and the `<Card title="One-time setup">` block. No other JSX changes.

---

## 3. `CoachNudges.tsx` — new client component

**File:** `src/components/CoachNudges.tsx` (new file)

### Complete component skeleton

```tsx
"use client";

import { useTransition } from "react";
import { Card } from "@/components/Card";
import { ConfirmButton } from "@/components/ConfirmButton";
import { resolveOpenItem } from "@/lib/note-actions";

export type CoachNudge = {
  id: string;
  body: string;
  priority: string | null;
  overdue: boolean;
  targetDateLabel: string | null;
};

export function CoachNudges({ nudges }: { nudges: CoachNudge[] }) {
  const [pending, startTransition] = useTransition();

  return (
    <Card
      title={
        nudges.length > 0
          ? `Coach nudges · ${nudges.length}`
          : "Coach nudges"
      }
    >
      {nudges.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          No open nudges right now. Your coach will surface gate alerts, staleness,
          and weekly briefs here when they write action items via{" "}
          <code className="text-xs">log_open_item</code>.
        </p>
      ) : (
        <ul className="space-y-2">
          {nudges.map((n) => (
            <li
              key={n.id}
              className="rounded-lg border border-[var(--border)] p-3 text-sm space-y-1"
            >
              {/* Meta row: priority tag + overdue badge + date label */}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {n.priority === "high" && (
                  <span className="uppercase tracking-wide font-semibold text-[var(--danger)]">
                    High priority
                  </span>
                )}
                {n.overdue && (
                  <span className="uppercase tracking-wide font-semibold text-[var(--warning)]">
                    Overdue
                  </span>
                )}
                {n.targetDateLabel && (
                  <span className="text-[var(--muted)]">Due {n.targetDateLabel}</span>
                )}
              </div>

              {/* Body */}
              <p className="whitespace-pre-wrap">{n.body}</p>

              {/* Dismiss action */}
              <div className="flex justify-end pt-1">
                <ConfirmButton
                  label="Dismiss"
                  confirmLabel="Dismiss · confirm"
                  variant="danger"
                  disabled={pending}
                  onConfirm={() => startTransition(() => resolveOpenItem(n.id))}
                  className="text-xs rounded-full border border-[var(--border)] px-3 hover:bg-[var(--danger)] hover:text-white hover:border-[var(--danger)] disabled:opacity-50"
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
```

### Component decisions

- **`"use client"`** at file top. Only line.
- **`useTransition`** — single shared `[pending, startTransition]`. All ConfirmButtons disable while any dismiss is in-flight (matching PendingNotes' pattern exactly).
- **`ConfirmButton` props:** `label="Dismiss"`, `confirmLabel="Dismiss · confirm"`, `variant="danger"` (default variant). `onConfirm` fires `resolveOpenItem(n.id)` inside `startTransition`. No `reason` arg — the action defaults to `"dismissed from /coach"`.
- **ConfirmButton `min-h-[44px]`** is enforced by the component itself (line 110 of ConfirmButton.tsx: `className={`min-h-[44px] transition ${className}`}`). The caller's className does NOT need to set it — it is always present.
- **Priority display logic:** only `"high"` gets a visual callout (most actionable). `"normal"` and `"low"` are shown via sort order only (already ordered by targetDate; high-priority items with the soonest date surface first via the DB sort). If the Developer wants to show all priority levels, they may, but "high" flag is the minimum spec per the PRD.
- **Overdue badge color:** `text-[var(--warning)]` — `--warning: #A8511A` (light mode) / `#E0915C` (dark mode). Confirmed in globals.css.
- **`Card` component:** `title` prop is a string (Card.tsx:4 accepts `title?: string`). Pass a string, not JSX. The count is embedded in the string: `"Coach nudges · 3"` when nudges > 0.
- **Empty state:** inside the component (matching PendingNotes lines 24-29). The `Card` wrapper is always rendered (always shows the title). This is intentional per D-7.

---

## 4. Serialization contract (server → client boundary)

The `nudges` prop type must contain ONLY serializable primitives. The following table confirms every field:

| Field | Type | Safe? | How computed |
|-------|------|-------|--------------|
| `id` | `string` | Yes | Prisma `String` |
| `body` | `string` | Yes | Prisma `String` |
| `priority` | `string \| null` | Yes | Prisma `String?` |
| `overdue` | `boolean` | Yes | `item.targetDate !== null && item.targetDate < now` (server) |
| `targetDateLabel` | `string \| null` | Yes | `Intl.DateTimeFormat(...USER_TZ...).format(item.targetDate)` (server) |

**`Date` objects from Prisma do NOT cross the boundary.** `item.targetDate` (a Prisma `DateTime?` → JS `Date | null`) is consumed entirely on the server in the overdue computation and the `Intl.DateTimeFormat` call. It is never included in the `nudges` array.

---

## 5. Dismiss flow — full sequence

```
User taps "Dismiss" on nudge N
  → ConfirmButton arms (label switches to "Dismiss · confirm")
  → 4-second auto-disarm timer starts

User taps "Dismiss · confirm"
  → ConfirmButton.onConfirm fires
  → startTransition(() => resolveOpenItem(n.id)) called
  → all ConfirmButtons disable (pending=true)
  → Server action runs:
      findUnique(id) → check type === "open_item"
      update(id, { resolvedAt: new Date(), resolvedReason: "dismissed from /coach" })
      revalidatePath("/coach")
  → transition completes, pending=false
  → Next.js router cache for /coach is invalidated
  → On the NEXT render of the page (navigation or soft-refresh), the server component
     re-fetches and the dismissed nudge is gone
```

**Important:** `useTransition` does NOT do optimistic removal. The nudge remains visible until the page re-renders after revalidation. This is the same behavior as PendingNotes — no optimistic update. The buttons disable during the in-flight action to prevent double-dismiss.

---

## 6. Edge cases — explicit handling

| Case | Behavior | Where handled |
|------|----------|--------------|
| No nudges | Empty state text inside the Card | `CoachNudges` (if nudges.length === 0 branch) |
| `targetDate === null` | `targetDateLabel = null`, `overdue = false` | Map in `coach/page.tsx` |
| `priority === null` | No priority tag rendered | `CoachNudges` (conditional render) |
| `priority === "normal"` or `"low"` | No tag; sort order communicates relative urgency | `CoachNudges` (only "high" gets a tag) |
| Very long body | `whitespace-pre-wrap` — wraps, no truncation | `CoachNudges` (p.whitespace-pre-wrap) |
| Dismiss last nudge | `resolvedAt` set → revalidate → next render shows empty state | Server action + revalidatePath |
| Double-tap race | ConfirmButton arms on tap 1, fires on tap 2; pending=true disables all other buttons | ConfirmButton + useTransition |
| Wrong type ID (non-open_item) | `resolveOpenItem` returns silently after type guard | `note-actions.ts` type guard |

---

## 7. QA checklist (for Developer and QA agents)

```sh
# 1. TypeScript
npx tsc --noEmit

# 2. Lint
npm run lint

# 3. Build
npm run build

# 4. Raw date primitive guard (must return zero matches)
grep -nE "setHours|getDate\(\)|getMonth\(" \
  src/app/coach/page.tsx \
  src/components/CoachNudges.tsx \
  src/lib/note-actions.ts

# 5. No Today change (must be unchanged)
git diff src/app/page.tsx   # should be empty

# 6. Verify DATE does not cross to client
grep -n "targetDate" src/components/CoachNudges.tsx  # must NOT appear in the component file
```

**Manual smoke (dev server running, phone-width DevTools ≤390px):**
1. Insert a test `open_item` via the MCP tool `log_open_item` with a past `targetDate` (e.g. 2026-06-01) and `priority: "high"`.
2. `/coach` shows the nudge card above the One-time setup card with:
   - "Overdue" badge (warning color)
   - "High priority" tag (danger color)
   - Date label "Jun 1"
   - "Dismiss" button
3. Tap "Dismiss" → button arms to "Dismiss · confirm"
4. Tap "Dismiss · confirm" → all buttons disable briefly → nudge disappears on next render
5. Insert a nudge with no `targetDate` and no `priority` → shows body only, no badges
6. No nudges → Card shows empty state text
7. Confirm `src/app/page.tsx` (Today) is unchanged

---

## 8. Do-NOT-touch list

- `src/app/page.tsx` — Today page. Memory `today-page-training-focused` prohibits coaching-loop plumbing here. No changes, no open-item count, no badge.
- `src/lib/mcp/tools.ts` — The MCP `resolve_open_item` tool is a separate code path. The new server action is the UI path. Do not merge them.
- `prisma/schema.prisma` — No schema changes. `resolvedAt`, `resolvedReason`, `priority`, `targetDate` all exist on `Note`.
- `src/lib/note-actions.ts` lines 1–17 — `resolveNote` function is untouched. Only append after line 17.
- `src/components/PendingNotes.tsx` — Not changed. The new component mirrors it, does not modify it.
- `src/components/ConfirmButton.tsx`, `src/components/Card.tsx` — Consumed as-is. No changes.

---

## 9. Trickiest thing the Developer must get right

**`startTransition` and the dismiss disappear timing.**

`useTransition` marks the server action as non-urgent, but it does NOT optimistically remove the nudge from the list. After `onConfirm` fires, the nudge will still be visible for 1–3 seconds while the server action runs and `revalidatePath("/coach")` completes. The buttons disable (`pending=true`) to prevent a double-dismiss.

The nudge only disappears when the Next.js router re-renders the page — which happens automatically on the next navigation within the app, or if the user refreshes. This is identical to how PendingNotes works on `/journal` and is acceptable UX for a low-frequency action.

**If the Developer tries to add an optimistic removal** (filtering out the dismissed nudge from a local state copy), they need to be careful: the component receives `nudges` as a prop from the server. To do optimistic removal, they'd need to `useState(nudges)` and filter on dismiss. This is a valid enhancement but NOT in scope — the PRD does not ask for it, and it adds complexity. Reject it unless the UX smoke reveals it is jarring.

The single most likely bug: **calling `resolveOpenItem` outside `startTransition`**. Without `startTransition`, the server action still works, but `pending` never becomes `true` so the disable guard doesn't fire and a fast double-tap can submit two resolves before the type guard on the second one catches the already-resolved state. Always wrap in `startTransition`.
