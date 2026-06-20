# Architecture Blueprint — Recap Post-State Tracking (#95)

**Feature**: Mark a week posted; clear the nudge
**Agent**: Architect
**Date**: 2026-06-17
**Parallel dev streams**: Backend (REQ-001 + REQ-002) || Frontend (REQ-003 + REQ-004)

---

## 1. File Plan

| Action | Path | Purpose | Key Exports | Dependencies |
|--------|------|---------|-------------|--------------|
| NEW | `src/lib/recap-actions.ts` | `"use server"` module; idempotent shared_recap Note write + newest `[week:` nudge resolve + revalidate both paths | `markRecapPosted` | `next/cache`, `@/lib/db`, `@/lib/calendar`, `@/lib/recap` |
| MODIFY | `src/lib/mcp/tools.ts` | Add `"shared_recap"` to `NoteTypeShape` enum at line 96 | `NoteTypeShape` (internal) | none |
| MODIFY | `prisma/schema.prisma` | Comment-only: add `shared_recap` to `Note.type` comment at line 89 | — | none — no migration, no generate |
| MODIFY | `src/app/recap/page.tsx` | Make async; query `shared_recap` notes for 13-week window; compute `postedWeeks: number[]`; pass to `RecapClient` | — | `@/lib/db`, `@/lib/calendar`, `@/lib/recap` |
| MODIFY | `src/components/RecapClient.tsx` | Add `postedWeeks` prop; `locallyPosted` state; call `markRecapPosted` on share completion; render Posted indicator slot | `RecapClient` | `@/lib/recap-actions` |

---

## 2. Type Definitions

```ts
// ── In src/components/RecapClient.tsx ──────────────────────────────────────

// Existing (unchanged)
type WeekItem = { offset: number; label: string };

// New prop shape (added to RecapClient)
type RecapClientProps = {
  weeks: WeekItem[];
  defaultTemplate?: RecapTemplate;
  postedWeeks?: number[]; // NEW — plain offsets; no Date objects (CRIT-2)
};

// ── In src/lib/recap-actions.ts (new file) ─────────────────────────────────

// Action return type
type MarkRecapPostedResult = { posted: boolean };
```

---

## 3. `markRecapPosted` — Exact Signature and Full Implementation Sketch

```ts
// src/lib/recap-actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { startOfWeekMonday, addDays } from "@/lib/calendar";
import { weekRangeLabel } from "@/lib/recap";

/**
 * Called by RecapClient after any completed share (native success OR fallback download).
 * Best-effort — never throws; returns { posted: false } on DB failure.
 *
 * Steps:
 *   1. Clamp weekOffset to [-12, 0]
 *   2. Compute the week's Monday (USER_TZ-correct via @/lib/calendar)
 *   3. Idempotent create: findFirst shared_recap for that Monday → create if absent
 *   4. Clear active routine nudge: resolve newest unresolved [week: open_item
 *   5. revalidatePath("/recap") + revalidatePath("/coach")
 */
export async function markRecapPosted(
  weekOffset: number,
): Promise<{ posted: boolean }> {
  try {
    // 1. Clamp
    const clampedOffset = Math.max(-12, Math.min(0, weekOffset));

    // 2. Compute Monday (USER_TZ-aware; no raw setHours/getDate)
    const now = new Date();
    const thisMonday = startOfWeekMonday(now);
    const monday = addDays(thisMonday, clampedOffset * 7);

    // 3. Idempotent create — findFirst then create (no DB unique constraint per PRD)
    const existing = await prisma.note.findFirst({
      where: { type: "shared_recap", targetDate: monday },
      select: { id: true },
    });
    if (!existing) {
      await prisma.note.create({
        data: {
          type: "shared_recap",
          targetDate: monday,          // week's Monday 00:00 USER_TZ
          date: now,                   // when the share happened
          body: `Shared recap for ${weekRangeLabel(now, clampedOffset)}`,
          // e.g. "Shared recap for Jun 9 – Jun 15"
        },
      });
    }

    // 4. Clear the active routine nudge (newest unresolved [week: open_item)
    const nudge = await prisma.note.findFirst({
      where: {
        type: "open_item",
        resolvedAt: null,
        body: { startsWith: "[week:" },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (nudge) {
      await prisma.note.update({
        where: { id: nudge.id },
        data: {
          resolvedAt: now,
          resolvedReason: "recap posted from /recap",
        },
      });
    }
    // No nudge is a silent no-op — the shared_recap marker is still created.

    // 5. Revalidate both affected paths (unconditional)
    revalidatePath("/recap");
    revalidatePath("/coach");

    return { posted: true };
  } catch {
    // Best-effort — the share already succeeded; never surface a DB error to the user.
    return { posted: false };
  }
}
```

### Body format
`"Shared recap for " + weekRangeLabel(now, clampedOffset)` where `weekRangeLabel` returns e.g. `"Jun 9 – Jun 15"`. Full example: `"Shared recap for Jun 9 – Jun 15"`. The `now` variable is the same one used to derive `monday` — no second `new Date()` call.

### Idempotency contract
- No DB unique constraint (per PRD decision). The `findFirst` + `create` guard handles the common case.
- Re-sharing the same week: `findFirst` finds the existing row → skips `create` → nudge-resolve is a no-op (already resolved) → returns `{ posted: true }`.
- Rare concurrent double-tap: both paths could create a note. The read path dedupes via `Set<number>` (two notes with the same `targetDate` → same `dateKey` → same offset → Set collapses them). No UI impact.

### Nudge-resolve contract
- Resolves ONLY the newest unresolved `open_item` whose body starts with `[week:`.
- Does NOT match by ISO-week of the shared offset — resolves the current active nudge regardless of which historical week was shared (per locked PRD decision).
- If multiple routine nudges exist (missed weeks), only the newest (by `createdAt desc`) is resolved.
- `resolvedReason: "recap posted from /recap"` (exact string — used in smoke verification).

---

## 4. Read-Path Query in `src/app/recap/page.tsx`

The page becomes `async`. Full replacement:

```ts
// src/app/recap/page.tsx
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { weekRangeLabel } from "@/lib/recap";
import { startOfWeekMonday, addDays, dateKey } from "@/lib/calendar";
import { prisma } from "@/lib/db";
import { RecapClient } from "@/components/RecapClient";

export default async function RecapPage() {
  const now = new Date();
  const thisMonday = startOfWeekMonday(now);

  // Build 13 week entries (offset 0 = current week, -12 = oldest shown)
  const weeks = Array.from({ length: 13 }, (_, i) => ({
    offset: -i,
    label: weekRangeLabel(now, -i),
  }));

  // Precompute the 13 Mondays in the same order as `weeks`:
  // mondays[0] = current week's Monday (offset 0)
  // mondays[i] = offset -i Monday
  const mondays = Array.from({ length: 13 }, (_, i) =>
    addDays(thisMonday, -i * 7)
  );

  // Query shared_recap notes in the 13-week window
  // [mondays[12], mondays[0]] = [oldest Monday, newest Monday]
  const postedNotes = await prisma.note.findMany({
    where: {
      type: "shared_recap",
      targetDate: {
        gte: mondays[12], // monday(-12) — oldest
        lte: mondays[0],  // monday(0)  — current
      },
    },
    select: { targetDate: true },
  });

  // Map each note's targetDate → offset via dateKey equality.
  // Use a Set to dedup (handles rare duplicate rows for same Monday).
  // CRIT-2: no Date objects cross to client — only numbers.
  const postedWeekSet = new Set<number>();
  for (const note of postedNotes) {
    if (!note.targetDate) continue;
    const noteDk = dateKey(note.targetDate);
    const matchIdx = mondays.findIndex((m) => dateKey(m) === noteDk);
    if (matchIdx !== -1) {
      postedWeekSet.add(-matchIdx); // offset = -(index into mondays)
    }
  }
  const postedWeeks: number[] = [...postedWeekSet];

  return (
    <main className="max-w-md mx-auto p-4 space-y-4">
      <header className="pt-2">
        <h1 className="text-2xl font-semibold tracking-tight">Weekly Recap</h1>
      </header>
      <RecapClient weeks={weeks} postedWeeks={postedWeeks} />
    </main>
  );
}
```

**Key rules:**
- `dateKey(note.targetDate)` vs `dateKey(monday)` — never `===` on Date objects directly.
- `postedWeekSet` deduplicates in case of rare duplicate notes.
- `postedWeeks` is `number[]` — plain offsets, no Dates, no WeekItem objects. CRIT-2 satisfied.
- `mondays[i]` is the same computation as `addDays(startOfWeekMonday(now), offset * 7)` in the write path, anchored to the same `now` → keys match.

---

## 5. `RecapClient` Changes

### 5.1 Prop and State Additions

```ts
// New prop (default [] for backward compat)
export function RecapClient({
  weeks,
  defaultTemplate = "coal",
  postedWeeks = [],            // NEW
}: {
  weeks: WeekItem[];
  defaultTemplate?: RecapTemplate;
  postedWeeks?: number[];      // NEW — plain offsets
}) {
  // ... existing state ...

  // NEW: locallyPosted — persists across week navigation; never reset in navigateToWeek
  const [locallyPosted, setLocallyPosted] = useState<Set<number>>(
    () => new Set(postedWeeks)
  );
```

**Initialization note**: `locallyPosted` is seeded from `postedWeeks` at mount. If the page revalidates and `postedWeeks` changes (via RSC re-render), the component remounts or the prop updates. The `isPosted` derivation ORs both sources, so stale `locallyPosted` values are harmless.

### 5.2 `navigateToWeek` — Must NOT Reset `locallyPosted`

```ts
function navigateToWeek(newIdx: number) {
  setWeekIdx(newIdx);
  setCandidates(null);
  setHighlightValue("");
  setCustomText("");
  setImageLoading(true);
  setSharing(false);
  setShareError(null);
  // ← locallyPosted is intentionally NOT reset here; posted state persists across week nav
}
```

### 5.3 `isPosted` Derivation

Place immediately after `const currentWeek = weeks[weekIdx]`:

```ts
const currentWeek = weeks[weekIdx];
// NEW
const isPosted =
  postedWeeks.includes(currentWeek.offset) ||
  locallyPosted.has(currentWeek.offset);
```

### 5.4 `handleShare` — Call Sites for `markRecapPosted`

Import at the top of the file:
```ts
import { markRecapPosted } from "@/lib/recap-actions";
```

**Native share success branch** (after `await navigator.share(...)`):

```ts
if (typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] })) {
  await navigator.share({ files: [file], text: caption });
  // Native share completed — mark posted (fire-and-forget, best-effort)
  void markRecapPosted(currentWeek.offset);
  setLocallyPosted((prev) => new Set([...prev, currentWeek.offset]));
} else {
  // ... fallback block ...
}
```

**Fallback download/clipboard branch** (after `URL.revokeObjectURL(url)`):

```ts
  // Use the ShareWorkout blob-download pattern
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "recap-card.png";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  // Fallback share completed — mark posted (fire-and-forget, best-effort)
  void markRecapPosted(currentWeek.offset);
  setLocallyPosted((prev) => new Set([...prev, currentWeek.offset]));
  setShareError("Web Share unavailable — caption copied + card downloaded.");
```

**AbortError path** (the `catch` block):

```ts
} catch (e) {
  // AbortError = user dismissed the OS share sheet → NOT an error; NOT posted
  if ((e as Error)?.name !== "AbortError") {
    setShareError("Couldn't prepare the share. Try again.");
  }
  // markRecapPosted is NOT called on AbortError or on other errors
}
```

### 5.5 "Posted ✓" Render Slot

Place between the Highlight picker and the Share button, or immediately above the Share button — whichever UX research specifies. The TODO slot below must be filled by the Developer once UX findings arrive.

```tsx
{/* ── Posted indicator ─────────────────────────────────────────────────────
    Placement: near the Share CTA (above or inline per UX research output).
    A11y contract:
      • Must include the literal word "Posted" (not just color/emoji alone).
      • Wrap in aria-live="polite" so the optimistic update is announced
        without stealing focus.
      • Share button stays tappable even when isPosted (re-share is idempotent).
      • Min tap height ≥44px on the Share button must be preserved.
      • Use theme tokens only: var(--accent), var(--muted), var(--border), var(--card).
    TODO: replace the placeholder below with the UX-researched component.
    ────────────────────────────────────────────────────────────────────────── */}
{isPosted && (
  <div aria-live="polite">
    {/* TODO: fill from UX research — Posted ✓ indicator */}
    <span className="text-sm text-[var(--accent)]">Posted ✓</span>
  </div>
)}
```

The Share button's `disabled` condition remains `sharing` only — `isPosted` does not disable it:

```tsx
<button
  type="button"
  onClick={handleShare}
  disabled={sharing}     // ← unchanged; NOT disabled when isPosted
  ...
>
  {sharing ? "Preparing…" : "Share"}
</button>
```

---

## 6. `NoteTypeShape` Edit (`src/lib/mcp/tools.ts:96`)

**Before:**
```ts
const NoteTypeShape = z.enum(["journal", "audible", "feedback", "standing_rule", "review"]);
```

**After:**
```ts
const NoteTypeShape = z.enum(["journal", "audible", "feedback", "standing_rule", "review", "shared_recap"]);
```

No other change to the tool registration for `log_note`. `ACTIVITY_NOTE_TYPES` on line 100 is untouched.

---

## 7. Schema Comment Edit (`prisma/schema.prisma:89`)

**Before:**
```prisma
type  String  @default("journal") // audible | journal | feedback | standing_rule | review | open_item
```

**After:**
```prisma
type  String  @default("journal") // audible | journal | feedback | standing_rule | review | open_item | shared_recap
```

No migration. No `npx prisma generate` required. The `type` column remains `String`.

---

## 8. Data Flow

### Write Path (share → DB → revalidate)
```
User taps "Share" in RecapClient
  → handleShare fires
  → fetch caption + image in parallel
  → native navigator.share(...) succeeds
       OR fallback download completes (clipboard + blob-download)
  → void markRecapPosted(currentWeek.offset)          [fire-and-forget]
  → setLocallyPosted(prev => new Set([...prev, offset]))  [instant optimistic ✓]
  → server action executes (async, may complete after UI updates):
      prisma.note.findFirst(shared_recap, targetDate=monday) → not found
      prisma.note.create(type="shared_recap", targetDate=monday, ...)
      prisma.note.findFirst([week:, resolvedAt=null, createdAt desc) → found
      prisma.note.update(resolvedAt=now, resolvedReason="recap posted from /recap")
      revalidatePath("/recap")
      revalidatePath("/coach")
  → Next.js invalidates /recap and /coach RSC caches
  → Next page navigation to /recap re-renders RecapPage (server) with updated postedWeeks
  → AbortError → nothing (no markRecapPosted, no optimistic update)
```

### Read Path (page load → client render)
```
Browser navigates to /recap
  → RecapPage server component runs (async):
      const now = new Date()
      startOfWeekMonday(now) → thisMonday
      Array.from 13 Mondays
      prisma.note.findMany(type="shared_recap", targetDate ∈ [monday(-12), monday(0)])
      for each note: dateKey(note.targetDate) → matchIdx → offset pushed to Set
      postedWeeks = [...Set]  (plain number[])
  → <RecapClient weeks={weeks} postedWeeks={postedWeeks} /> rendered to HTML
  → Client hydrates:
      locallyPosted = new Set(postedWeeks)
      isPosted = postedWeeks.includes(offset) || locallyPosted.has(offset)
      → "Posted ✓" indicator visible for posted weeks
```

---

## 9. Component Hierarchy

```
RecapPage (server, async)                   ← MODIFIED
  └── RecapClient (client, "use client")    ← MODIFIED
        └── [Posted indicator slot]         ← NEW (TODO: filled from UX research)
        └── Share button (unchanged)

/api/mcp
  └── log_note handler
        └── NoteTypeShape                   ← MODIFIED (adds "shared_recap")
```

---

## 10. Server Actions Table

| Action | File | Args | Mutations | `revalidatePath` calls | Returns | Throws? |
|--------|------|------|-----------|------------------------|---------|---------|
| `markRecapPosted` | `src/lib/recap-actions.ts` | `weekOffset: number` | `note.create(type="shared_recap")` (idempotent) + `note.update(resolvedAt)` on `[week:` nudge | `/recap`, `/coach` | `{ posted: boolean }` | Never |

---

## 11. Work Streams

Both streams touch disjoint files and can run in parallel once this blueprint is locked.

### Backend Stream (1 developer)
Files: `src/lib/recap-actions.ts` (new), `src/lib/mcp/tools.ts`, `prisma/schema.prisma`

1. Create `src/lib/recap-actions.ts` using the exact implementation sketch from §3.
2. Edit `src/lib/mcp/tools.ts:96` — add `"shared_recap"` to `NoteTypeShape` as in §6.
3. Edit `prisma/schema.prisma:89` — comment update only, as in §7.
4. Run `npx tsc --noEmit` and `npm run lint` — should be clean.
5. MCP smoke: `tools/call log_note` with `{ "type": "shared_recap", "body": "smoke test" }` validates; `tools/call recent_history` does NOT return the new row.

**Backend has no dependency on Frontend.** The action can be written and tested independently. The Frontend stream imports `markRecapPosted` from the path specified in the blueprint.

### Frontend Stream (1 developer)
Files: `src/app/recap/page.tsx`, `src/components/RecapClient.tsx`

The Frontend stream can start immediately:
- `page.tsx`: make async, add `mondays` computation, add `prisma` query, compute `postedWeeks`, pass to `RecapClient`.
- `RecapClient.tsx`: add `postedWeeks` prop, `locallyPosted` state, `isPosted` derivation, call sites in `handleShare`, and indicator TODO slot.

The Frontend stream depends on the `markRecapPosted` **import path and signature** being known (fixed here as `import { markRecapPosted } from "@/lib/recap-actions"`). It does NOT need the action to be fully implemented before the client code can be written and typechecked — only the file and function must exist.

---

## 12. Implementation Order

```
Step 1 (both streams, parallel):
  Backend: create src/lib/recap-actions.ts (§3)
  Frontend: add postedWeeks to page.tsx (§4) + RecapClient.tsx prop/state/call-sites (§5)

Step 2 (both streams, may overlap):
  Backend: edit NoteTypeShape (§6) + schema comment (§7)
  Frontend: verify navigateToWeek does NOT reset locallyPosted

Step 3 (sequential — after both streams complete):
  QA: npx tsc --noEmit → 0 errors
  QA: npm run lint → 0 new errors
  QA: npm run build → Turbopack build succeeds

Step 4 (sequential — browser smoke):
  Open /recap at 390px
  Use download fallback (Web Share unavailable in desktop DevTools)
  Confirm "Posted ✓" appears optimistically after download
  Reload /recap — confirm persists
  Navigate ◀/▶ — confirm isPosted follows the correct week
  Open /coach — confirm [week: nudge is gone

Step 5 (after UX research):
  Developer fills the Posted indicator TODO slot in RecapClient (§5.5)
  Re-run QA gates
```

---

## 13. Critical Decisions (Locked — Do Not Relitigate)

| Decision | Resolution |
|----------|------------|
| What triggers "posted"? | ANY completed share: native success OR download/clipboard fallback. NOT AbortError. |
| Which nudge is cleared? | The newest unresolved `open_item` whose body starts with `[week:` — regardless of which historical week was shared. |
| Re-share / undo? | Idempotent (no duplicate created); posted is sticky (no un-post path). |
| New MCP tool? | No. Enum addition to `NoteTypeShape` only. |
| DB migration? | No. `Note.type` is free-form String; `targetDate` column already exists. |
| `postedWeeks` type? | `number[]` (offsets). No Date objects cross server→client boundary (CRIT-2). |
| Optimistic update reset? | `locallyPosted` persists across week navigation. Only resets on full page reload (which brings fresh `postedWeeks` from server). |
| Race condition (double-tap)? | Acceptable; rare duplicate note; read path dedupes via Set. No unique constraint added. |
| Nudge "current active" definition? | `orderBy: { createdAt: "desc" }` among unresolved `[week:` items — picks the most recently written routine nudge. |
| Visual spec? | Pending UX research. Developer fills TODO slot; must include literal word "Posted", aria-live="polite", theme tokens only. |
