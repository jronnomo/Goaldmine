# PRD — Coach Nudge Surface on /coach (#98, story 3.3-a)

**Slug:** coach-nudge-card · **Issue:** #98 (board #8, Backlog, Medium, P2) · **Date:** 2026-06-17
**Epic:** #86 proactive coach. Spike: `docs/roadmap/spike-proactive-coach.md`.
**UX-research:** skipped — mirrors the existing `PendingNotes` display+dismiss pattern on the `/coach` page; no new design-system work.

## 1. Goal
The in-app **display half** of the proactive loop: render pending coach nudges (open-items) on the **/coach page** with a dismiss action. The reasoning half (a Sunday routine that *writes* nudges via `log_open_item`) is #99 (3.3-b). This story makes nudges visible + dismissable; until the routine lands, the surface shows whatever open-items exist (the coach can already write them by hand from claude.ai).

## 2. Placement decision (memory-driven)
Nudges live on **`/coach`**, NOT Today. Per memory `today-page-training-focused`, Today stays training-focused — coaching-loop plumbing is not surfaced as front-and-center action items there. Research confirms **no Today indicator** is warranted (the least-invasive option would force a layout-level DB query on every page). `/coach` is the right home (the user goes there for coaching).

## 3. Confirmed surface (research)
- `src/app/coach/page.tsx`: pure **server component**, `force-dynamic`, a static `PROMPTS` array of copy-paste cards, **no data fetching today**. The nudge section slots **above the "One-time setup" card** (~line 100), below the `<header>`.
- **Open-item query (mirror tools.ts:496–513):** `prisma.note.findMany({ where:{ type:"open_item", resolvedAt:null }, orderBy:[{ targetDate:{ sort:"asc", nulls:"last" } },{ date:"asc" }], select:{ id, body, targetDate, priority, date } })`. `overdue = targetDate !== null && targetDate < startOfDay(new Date())` (USER_TZ via `@/lib/calendar`).
- **No `resolveOpenItem` lib fn exists** → add one. **`PendingNotes.tsx`** is the client display+dismiss pattern to mirror (`"use client"`, `useTransition`, a server action, `ConfirmButton` two-tap).

## 4. Design
### 4.1 Server action — `src/lib/note-actions.ts` `resolveOpenItem`
Mirror the existing `resolveNote()`:
```ts
"use server";
export async function resolveOpenItem(id: string, reason?: string) {
  const note = await prisma.note.findUnique({ where: { id }, select: { type: true } });
  if (!note || note.type !== "open_item") return; // type guard — UI must not crash on mismatch
  await prisma.note.update({ where: { id }, data: { resolvedAt: new Date(), resolvedReason: reason ?? "dismissed from /coach" } });
  revalidatePath("/coach");
}
```

### 4.2 `/coach/page.tsx` — fetch + render the nudge section
- Add the open-item query (above the return). Compute `overdue` server-side. Map to a serializable shape for the client: `{ id, body, priority: string|null, overdue: boolean, targetDateLabel: string|null }` (format `targetDate` via `Intl … USER_TZ` → a string; **no Date crosses to the client**).
- Render a new `<CoachNudges nudges={...} />` section above the prompts, titled "Coach nudges" (or similar), with a count.
- **Honest empty state:** when none, a muted line — e.g. "No coach nudges right now. Your coach will surface gate alerts, staleness, and weekly briefs here." (Forward-looking — the routine #99 will populate it.)

### 4.3 `src/components/CoachNudges.tsx` (client, mirror PendingNotes)
- `"use client"`, props `nudges: { id; body; priority; overdue; targetDateLabel }[]`.
- Each nudge: body, an **overdue** badge (warning color) when `overdue`, a `priority` tag when high, the `targetDateLabel` (if any), and a **dismiss** `ConfirmButton` → `startTransition(() => resolveOpenItem(id))`.
- Mobile-first 390px; reuse the `PendingNotes`/`Card` styling.

## 5. Out of scope (deferred)
- **Stale-nudge guard** ("last nudge >8d → warn") — this is observability **for the routine**; with no routine yet it would always warn. **Moved to #99 (3.3-b)** where the routine + its observability ship together.
- The routine that WRITES nudges (#99). Graduating to a dedicated `coach_nudge` Note type (#101) — for now reuse `open_item`.
- Any Today change.

## 6. Acceptance criteria
1. `/coach` renders a "Coach nudges" section (above the prompts) listing pending `open_item` notes (overdue/priority first), each with body + overdue/priority indicators + a dismiss button.
2. Dismiss → `resolveOpenItem(id)` server action (sets `resolvedAt`/`resolvedReason`, `revalidatePath("/coach")`) — the nudge disappears; a type guard prevents resolving a non-open_item.
3. `/coach` stays a server component; `CoachNudges` is the only `"use client"` piece; **no `Date` crosses to the client** (`targetDateLabel` is a pre-formatted USER_TZ string).
4. Honest empty state when no nudges. Mobile-first 390px.
5. **No change to Today** (`src/app/page.tsx`) — nudges live on /coach (memory `today-page-training-focused`).
6. `npx tsc --noEmit`, lint, `npm run build`, `npx vitest run` pass.

## 7. Verification
tsc · eslint · build · vitest. Dev: write a test `open_item` via the existing `log_open_item` MCP tool (or a scratch insert) → `/coach` shows it in the nudge section with the right overdue/priority indicators; click dismiss → it resolves + disappears; delete the test item after. Empty state shows when none. `grep -nE "setHours|getDate\(|getMonth\(" src/app/coach/page.tsx src/components/CoachNudges.tsx src/lib/note-actions.ts` → no new raw date primitives. Confirm `src/app/page.tsx` is unchanged.
