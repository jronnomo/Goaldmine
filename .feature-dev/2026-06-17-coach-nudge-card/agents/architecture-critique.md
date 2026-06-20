# Architecture Critique — Coach Nudge Card (Story #98, 3.3-a)

**Author:** Devil's Advocate Agent  
**Date:** 2026-06-17  
**Attacking:** `architecture-blueprint.md`  
**Verification basis:** live source files only — no assumptions

---

## Verdict (up front)

**Approve with one mandatory fix.** The blueprint is structurally sound: the ConfirmButton props match the real API exactly, the serialization contract is correct (no `Date` crosses the boundary), the `resolveOpenItem` signature mirrors `resolveNote` correctly, `revalidatePath("/coach")` only is the right call, and the `startTransition` pattern is the established pattern. One finding is a **guaranteed lint failure** that must be fixed before the code ships. Three other findings are factual errors in the reasoning (not the code) that could mislead the Developer.

---

## CRITICAL — Will break `npm run lint`

### C-1 · Unused `dateKey` import — `src/app/coach/page.tsx`

**Blueprint line:** Section 2a, import block:
```ts
import { startOfDay, dateKey, USER_TZ } from "@/lib/calendar";
```

**Actual use in the page:** `startOfDay` is used (line `const now = startOfDay(new Date())`). `USER_TZ` is used (Intl.DateTimeFormat option). **`dateKey` is never referenced anywhere in the page code.**

**Verification:** Searched all code in blueprint Section 2c (the data fetch + map) and Section 2d (the JSX). `dateKey` does not appear. The research output (research-output.md:62) correctly shows the minimal import:
```ts
import { startOfDay } from "@/lib/calendar";
```
The blueprint added `dateKey` and `USER_TZ` on top of the research import but then never used `dateKey`.

**Impact:** ESLint will flag `dateKey` as `no-unused-vars`. `npm run lint` — step 2 of the blueprint's own QA checklist — fails. **Fix required before submitting.**

**Fix:** Drop `dateKey` from the import:
```ts
import { startOfDay, USER_TZ } from "@/lib/calendar";
```

---

## CONCERNS — Factual errors in reasoning (code is correct, justification misleads the Developer)

### Concern-1 · "Matches PendingNotes exactly" — false at the button level

**Blueprint Section 3 claim (Component decisions):**
> `useTransition` — single shared `[pending, startTransition]`. All ConfirmButtons disable while any dismiss is in-flight (**matching PendingNotes' pattern exactly**).

**Reality:** `PendingNotes.tsx:78–82` uses a **plain `<button>`** for per-item resolve — not `ConfirmButton`:
```tsx
<button
  type="button"
  disabled={pending}
  onClick={() => startTransition(() => resolveNote(n.id))}
  ...
>
  Mark resolved
</button>
```
`ConfirmButton` appears in `PendingNotes` **only** for the bulk "Resolve all" action (`PendingNotes.tsx:38–44`). The two-step confirm pattern is NOT the existing per-item pattern.

**Impact:** A Developer who reads "matches PendingNotes exactly," looks at `PendingNotes.tsx`, and sees a plain `<button>` may conclude the blueprint is in error and regress to a plain button. This would silently drop the two-tap safety requirement from PRD AC.

**What the blueprint should say (D-8 gets the reasoning right, the narrative doesn't):**
> Diverges from PendingNotes' per-item pattern (plain `<button>`) by design. PRD explicitly requires two-tap safety for dismiss. `ConfirmButton` with `variant="danger"` is the correct component. The `useTransition` shared pending state mirrors PendingNotes; the button component does not.

**The ConfirmButton props ARE correct:** `label`, `confirmLabel`, `onConfirm`, `variant`, `disabled`, `className` all match `ConfirmButton.tsx:7–21` exactly. `min-h-[44px]` is enforced by the component (line 110) — the blueprint's claim on this is accurate.

---

### Concern-2 · "navigation or soft-refresh" framing understates auto-re-render

**Blueprint Section 5:**
> → Next.js router cache for /coach is invalidated  
> → On the NEXT render of the page (**navigation or soft-refresh**), the server component re-fetches and the dismissed nudge is gone

**Reality:** In Next.js App Router, when a server action calls `revalidatePath`, the framework **automatically re-renders the affected page segments** after the action completes — no manual navigation or refresh needed. The dismissed nudge disappears in the same transition that triggered the action, not on the next manual navigation. This is identical to how `PendingNotes` works on `/journal` and `/goals`: notes disappear without manual refresh.

**Impact:** Developer may interpret "navigation or soft-refresh" as requiring user action and add a redundant `router.refresh()` call in `CoachNudges.tsx`, or may file a UX bug report against normal behavior ("nudge doesn't disappear").

**No code change needed** — the `revalidatePath("/coach")` call and `useTransition` wiring are correct. Only the explanatory text misleads.

---

### Concern-3 · `vitest run` missing from QA checklist

**Blueprint Section 7 QA checklist:** Lists tsc, lint, build, date-primitive grep, Today diff, and targetDate grep. No `npx vitest run`.

**PRD AC #6:** "npx tsc --noEmit, lint, `npm run build`, `npx vitest run` pass."

**Impact:** Minor — it's unlikely the new code breaks existing tests since it adds a new server action and a new component without touching existing logic. But the QA checklist is out of sync with the PRD's AC. A QA agent running the blueprint's checklist will miss the vitest step.

**Fix:** Add `npx vitest run` to the QA checklist (step 7 in the blueprint's list).

---

## VERIFIED CORRECT — Blueprint claims that hold up

### V-1 · `resolveNote` mirror accuracy

- **Signature:** `(id: string, reason?: string)` — exact match to `note-actions.ts:6`. ✓
- **`"use server"` placement:** file-level (`note-actions.ts:1`), already present. The new export inherits it. Blueprint correctly says "Do NOT add a second `'use server'` inside the function." ✓
- **Update fields:** `resolvedAt: new Date()` (`note-actions.ts:96` — `DateTime?`) + `resolvedReason: reason?.trim() || "dismissed from /coach"` (`note-actions.ts:97` — `String?`). Both fields exist. ✓
- **`revalidatePath("/coach")` only:** `resolveNote` revalidates `/`, `/journal`, `/goals` (lines 14–16). Open items are not surfaced on those routes. Blueprint D-3 is correct to NOT copy those paths. ✓
- **Type guard:** `resolveNote` has no type guard; `resolveOpenItem` adds one. Blueprint correctly calls this out as an intentional addition. ✓

### V-2 · ConfirmButton real API

`ConfirmButton.tsx` props (`ConfirmButton.tsx:7–21`): `label: string`, `confirmLabel: string`, `onConfirm: () => void`, `variant?: "danger" | "accent"` (default: `"danger"`), `disabled?: boolean`, `className?: string`, `"aria-label"?: string`.

Blueprint's call in Section 3:
```tsx
<ConfirmButton
  label="Dismiss"
  confirmLabel="Dismiss · confirm"
  variant="danger"
  disabled={pending}
  onConfirm={() => startTransition(() => resolveOpenItem(n.id))}
  className="..."
/>
```
Every prop matches the real type. `variant="danger"` is the default and could be omitted, but it's harmless to include. `min-h-[44px]` is enforced at `ConfirmButton.tsx:110`. ✓

### V-3 · Prisma query fidelity

`tools.ts:501–513` (the canonical `fetchOpenItems`):
```ts
where: { type: "open_item", resolvedAt: null },
orderBy: [{ targetDate: { sort: "asc", nulls: "last" } }, { date: "asc" }],
select: { id: true, body: true, targetDate: true, priority: true, date: true },
```
Blueprint query (Section 2c) matches on `where` and `orderBy` exactly. The blueprint drops `date: true` from the `select` (correctly; it's not needed for display and the blueprint explains this). ✓

`overdue` comparison: `item.targetDate !== null && item.targetDate < now` — identical to `tools.ts:512`. ✓

### V-4 · Schema confirmation

`prisma/schema.prisma:85–113` Note model:
- `priority String?` (line 104) — `string | null` in TypeScript. Blueprint's `priority: string | null` prop type is exact. ✓
- `targetDate DateTime?` (line 92) — nullable. ✓
- `resolvedAt DateTime?` (line 96) — nullable. ✓
- `resolvedReason String?` (line 97) — exists; the update field is valid. ✓

### V-5 · Serialization contract

Blueprint Section 4: no `Date` object in the `nudges` prop. Confirmed:
- `targetDateLabel: string | null` — computed via `Intl.DateTimeFormat(..., { timeZone: USER_TZ }).format(item.targetDate)` server-side. `item.targetDate` (Prisma `DateTime` → `Date | null`) is consumed entirely server-side and never included in the array.
- `overdue: boolean` — computed server-side.
- `priority: string | null`, `id: string`, `body: string` — all primitives.

`USER_TZ` reads `process.env.USER_TZ` (defined in `calendar-core.ts:14`). Available server-side (Next.js server component, Vercel runtime). ✓

### V-6 · `@/lib/calendar` import correctness

`calendar.ts:32–45` re-exports `USER_TZ`, `startOfDay`, and `dateKey` from `calendar-core`. The import `from "@/lib/calendar"` (not `"@/lib/calendar-core"`) is correct and is what `tools.ts:23,29` uses. ✓

### V-7 · `coach/page.tsx` structural changes

- `export const dynamic = "force-dynamic"` already present at `src/app/coach/page.tsx:4`. No change needed. ✓
- Making `CoachPage` async is idiomatic for a server component that now awaits a Prisma query. ✓
- Insertion slot: between `</header>` (after line 98) and `<Card title="One-time setup">` (line 100). ✓
- `src/app/page.tsx` is untouched. Memory `today-page-training-focused` satisfied. ✓

### V-8 · Card title prop type

`Card.tsx:9`: `title?: string`. The blueprint passes a template literal (`"Coach nudges · 3"` or `"Coach nudges"`), which is a `string`. Not JSX. ✓  
(Minor: blueprint says "Card.tsx:4 accepts `title?: string`" — the actual line is 9, not 4. Harmless doc error.)

### V-9 · `startTransition` wiring

`PendingNotes.tsx:81`: `onClick={() => startTransition(() => resolveNote(n.id))}` — direct server action call inside `startTransition` from a client component. Blueprint Section 3 mirrors this: `onConfirm={() => startTransition(() => resolveOpenItem(n.id))}`. Pattern is valid in Next.js App Router. ✓

### V-10 · `coach/page.tsx` untouched paths

Only three files change: `src/lib/note-actions.ts`, `src/app/coach/page.tsx`, `src/components/CoachNudges.tsx`. `src/app/page.tsx` (Today), `tools.ts`, `schema.prisma`, `PendingNotes.tsx`, `ConfirmButton.tsx`, `Card.tsx` are all untouched. ✓

### V-11 · Edge cases

All cases in Section 6 are handled:
- `targetDate === null` → `targetDateLabel = null`, `overdue = false`. ✓
- `priority === null` → no tag rendered. ✓
- Long body → `whitespace-pre-wrap`. ✓
- Wrong type ID → silent return via type guard in `resolveOpenItem`. ✓

### V-12 · Stale-nudge guard deferred to #99

Deferring the "last nudge >8d → warn" guard is sound. Without the routine (#99) there are no auto-written nudges, so the guard would fire constantly on hand-written items and produce noise. Deferring to #99 is the right call per PRD Section 5. ✓

---

## Summary table

| # | Finding | Severity | Code broken? | Fix |
|---|---------|----------|-------------|-----|
| C-1 | Unused `dateKey` import — lint failure | **Critical** | Yes — `npm run lint` fails | `import { startOfDay, USER_TZ }` only |
| Concern-1 | "Matches PendingNotes exactly" is false at button level | Concern | No | Fix the narrative in D-8/Section 3 |
| Concern-2 | "Navigation or soft-refresh" understates auto-re-render | Concern | No | Fix the explanatory text |
| Concern-3 | `vitest run` missing from QA checklist | Minor | No | Add `npx vitest run` to QA list |

---

## The single most important thing the Developer must get right

**Fix the `dateKey` unused import before running lint.**

The correct import for `src/app/coach/page.tsx` is:
```ts
import { startOfDay, USER_TZ } from "@/lib/calendar";
```

`dateKey` is not used anywhere in the page and will fail `npm run lint` (ESLint `no-unused-vars`). Everything else in the blueprint is correct.
