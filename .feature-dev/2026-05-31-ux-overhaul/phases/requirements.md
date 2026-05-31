# Requirements — App-Wide UX Overhaul

Source: `docs/prds/PRD-ux-overhaul.md`. Issue #18. Branch `feature/ux-overhaul`.

Work streams are **file-independent** so they can be built in parallel worktrees:
- **Stream A** — Forms + states scaffolding (no overlap with B/C/D)
- **Stream B** — Navigation + bottom sheets
- **Stream C** — Progress hub
- **Stream D** — Today redesign

Hard constraints (every REQ): no Prisma/MCP changes · no new npm deps · server components by default, `"use client"` only for interactive islands · all Date math via `@/lib/calendar` · tokens only (`var(--accent|--accent-fg|--border|--card|--muted|--success|--danger)`) · 390px-first · new interactive elements ≥44px + `focus-visible` rings · respect `prefers-reduced-motion`.

---

## Stream A — Forms + states scaffolding

### REQ-A1 — `useFormFeedback` hook  · S
Create a reusable client hook capturing the success-flash/reset/error pattern. NOTE (per Devil's Advocate): `LogNutritionForm` today resets but shows **no** success flash, so this is built fresh; the correct reference for the ~1500ms transient-state mechanism is `ShareWorkout.tsx:27` (`setCopied` + `setTimeout`).
- **Create:** `src/lib/use-form-feedback.ts` (or `src/components/useFormFeedback.ts`) — `"use client"`.
- API: returns `{ pending, error, saved, formRef, submit }` where `submit(action: (fd)=>Promise<void>, opts?: { successMsg?: string, onSuccess?: ()=>void })` wraps `startTransition`, clears error, reads `new FormData(formRef.current!)`, awaits the action, calls `formRef.current?.reset()`, sets a transient `saved` message auto-cleared after ~1500ms, and sets `error` on throw.
- **⚠ Usage-pattern change (CONCERN-4):** forms adopting this hook must switch from the native `<form action={...}>` to `<form ref={formRef} onSubmit={(e)=>{ e.preventDefault(); submit(theAction); }}>`. Keeping the native `action` prop makes the browser submit and the hook's `submit` never runs (double/no-submit). Document this in the hook's JSDoc.
- **Acceptance:** typechecks; no behavior coupling to a specific form.

### REQ-A2 — `LogMeasurementForm` feedback contract  · S
Adopt REQ-A1 in `src/components/LogMeasurementForm.tsx`.
- Keep the existing public prop `{ latestWeight: number | null }` **unchanged** (Stream B + Today embed it).
- On submit: pending label (already present), on success show a `--success` confirmation line (e.g. `✓ Logged 158.4 lb`) that fades after ~1.5s, then `formRef.reset()`; on throw show a `--danger` line. Reserve the line's height to avoid layout shift.
- **Acceptance:** logging weight shows success + resets; error path renders `--danger`; props unchanged.

### REQ-A3 — `LogNoteForm` feedback contract  · S
Adopt REQ-A1 in `src/components/LogNoteForm.tsx` (currently resets but gives no confirmation and swallows errors).
- Preserve the type selector + description line behavior; reset `type` to `journal` on success (as today).
- Add `--success` confirmation + `--danger` error line.
- **Acceptance:** saving a note shows success; error renders `--danger`; type taxonomy intact.

### REQ-A4 — (optional) refactor `LogNutritionForm` onto the hook  · S
If cheap and behavior-preserving, refactor `src/components/LogNutritionForm.tsx` to use REQ-A1 and add the same `--success` line (it currently resets but shows no success). **No regression** to the meal-slot default logic.
- **Acceptance:** nutrition logging unchanged or improved; still resets + sets default meal slot.

### REQ-A5 — Root `loading.tsx` + `error.tsx`  · S
- **Create:** `src/app/loading.tsx` — server; a calm skeleton in the `max-w-md mx-auto p-4` shell (pulsing `Card`-shaped blocks using `var(--card)`/`var(--border)`).
- **Create:** `src/app/error.tsx` — **`"use client"`** per Next 16; warm coach copy + a "Try again" button. **⚠ Next 16.2.4 prop name (CRITICAL-3, verified `node_modules/next/dist/client/components/error-boundary.js:107-111`):** the boundary passes BOTH `reset` and `unstable_retry`. Use **`unstable_retry`** for the retry button — it calls `context.refresh()` and re-fetches server components; `reset` only clears client error state. Signature: `{ error, unstable_retry }: { error: Error & { digest?: string }, unstable_retry: () => void }`.
- **Acceptance:** both render; `error.tsx` is a client component whose button calls `unstable_retry`; build picks them up.

### REQ-A6 — Normalize harshest empty/error copy  · S
Targeted only — do **not** rewrite every string.
- Soften `"No measurements yet."` (`stats/page.tsx:121`) to a short warm line (Progress will reuse).
- Leave other copy unless it is terse/leaky. (The `page.tsx:98` dev-string fix is owned by **Stream D**, not here — do not touch `page.tsx`.)
- **Acceptance:** no terse/leaky copy introduced; `page.tsx` untouched by this stream.

---

## Stream B — Navigation + bottom sheets

### REQ-B1 — `BottomSheet` primitive  · M
**Create:** `src/components/BottomSheet.tsx` — `"use client"`. Props `{ open: boolean, onClose: ()=>void, title: string, children }`.
- **PREFERRED approach — native `<dialog>` + `showModal()` (SUGGESTION-1):** use the HTML `<dialog>` element with `dialogRef.current.showModal()` on open / `close()` on close. This gives focus-trapping, `Esc`-to-close, `aria-modal`, scroll-lock, and return-focus **natively** — eliminating the error-prone hand-rolled trap (CONCERN-1) and the iOS body-scroll bug (CONCERN-2). Style the scrim via `dialog::backdrop`. For the slide-up: animate the panel in on open; on close, run the reverse transition THEN call `close()` after `transitionend` (or a timeout matching the duration) so the exit animation is visible. Listen for the dialog's native `cancel`/`close` events to keep React state in sync (Esc fires `cancel`).
- Backdrop `opacity 0→1` 160ms ease-out; panel `translateY(100%)→0` 220ms `cubic-bezier(.16,1,.3,1)`; close reverse ~180ms.
- **Reduced-motion (SUGGESTION-3):** add an explicit guard so transitions are `none` under `@media (prefers-reduced-motion: reduce)` (either a rule in `globals.css` scoped to the sheet classes, or a runtime check). Don't leave it implicit.
- `role="dialog"`/`aria-modal` (native with `<dialog>`), labelled by the title.
- `max-w-md mx-auto`, full-width on phone, rounded top corners, `max-h-[85vh]` with internal scroll, `pb-[env(safe-area-inset-bottom)]`.
- Use `var(--card)` panel, `var(--border)` divider; backdrop a translucent scrim.
- **If you instead hand-roll `<div role="dialog">`** (fallback): you MUST (a) query focusable elements **at keydown time, not at open time** (CONCERN-1 — the Log sheet expands inline forms after open, so a one-time querySelectorAll misses them), (b) toggle `document.body.style.overflow = open ? "hidden" : ""` in a `useEffect` and restore on cleanup (CONCERN-2), (c) handle Esc + backdrop-tap + return-focus-to-trigger yourself. `AppHeader` is `z-30`, `BottomNav` `z-40` → use `z-50` so the sheet covers both.
- **Acceptance:** opens/closes with the specified animation; keyboard-accessible (Esc closes, focus trapped incl. dynamically-expanded form inputs, focus returns to trigger); body does not scroll behind the sheet; reduced-motion instant.

### REQ-B2 — `LogLauncher` sheet content  · M
**Create:** `src/components/LogLauncher.tsx` — `"use client"`. Rendered inside a `BottomSheet`.
- Rows: **Weight** · **Meal** · **Note** (each expands an inline mini-form reusing `LogMeasurementForm` / `LogNutritionForm` / `LogNoteForm` respectively) and **Import** (a row that is a `Link` to `/import`, closing the sheet).
- `LogMeasurementForm` needs `latestWeight` — accept it as a prop on `LogLauncher` (`latestWeight?: number | null = null`). **By design (CONCERN-3) the Log-sheet weight field starts EMPTY** — BottomNav is a client component and must not fetch from Prisma; do NOT add data-fetching to BottomNav/layout or a new server action. This is intentional, not a bug (QA: do not file).
- Each row ≥48px; expanded form scrolls within the sheet.
- **Acceptance:** all three forms submit from the sheet (success feedback from Stream A shows); Import navigates to `/import`; route unchanged when logging.

### REQ-B3 — `MoreSheet` sheet content  · S
**Create:** `src/components/MoreSheet.tsx` — `"use client"`. Rendered inside a `BottomSheet`.
- Rows (each a `Link` that closes the sheet on navigate): **Coach prompts** → `/coach`, **Nutrition** → `/nutrition`, **History** → `/history`, **Journal** → `/journal`. Plus a **Theme** control (reuse `ThemeToggle`, optionally with a label).
- Icon + label + sub-label per row; ≥48px.
- **Acceptance:** every row navigates correctly; theme control works.

### REQ-B4 — `BottomNav` rebuild + sheet host  · M
**Modify:** `src/components/BottomNav.tsx`.
- Tabs: `Today (/)` · `Plan (/calendar, +/days)` · `Log (sheet)` · `Progress (/progress, active also on /stats,/baselines)` · `More (sheet)`.
- Today/Plan/Progress are `Link`s; **Log** and **More** are `<button>`s that open the respective sheets. BottomNav owns the open-state for both sheets and renders `<LogLauncher>` + `<MoreSheet>` (within `BottomSheet`s) as siblings.
- Fix `match`: Plan = `startsWith("/calendar") || startsWith("/days")` only (NOT history/workouts/import). Progress active = `startsWith("/progress") || startsWith("/stats") || startsWith("/baselines")`.
- Keep the filled `Bullseye` active glyph; replace the empty 6px inactive spacer with a real inactive glyph (outline Bullseye or a consistent icon) so the bar reads as icon+label. Active buttons (Log/More) never show "page" active state (they're transient).
- `latestWeight` for LogLauncher: BottomNav is a client component and cannot query Prisma. Pass `latestWeight` via a lightweight approach — **preferred:** the LogLauncher's weight mini-form may fetch nothing and simply omit the `defaultValue` (accept `latestWeight` optional, default `null`). Do NOT add server data-fetching to BottomNav. (Architect to confirm; simplest correct path wins.)
- Close any open sheet on route change (so browser-back doesn't leave a stuck backdrop).
- **Acceptance:** AC #4, #5, #6, #14 in the PRD; no tab lights up for an unrelated route family; sheets open/close; reduced-motion respected.

---

## Stream C — Progress hub

### REQ-C1 — `RecordsSummary` component  · M
**Create:** `src/components/RecordsSummary.tsx` — server component preferred (reads via `@/lib/records` `getBaselineSchedule` + `getExerciseSummaries`, the same as `baselines/page.tsx`).
- Condensed: the 4 status pills (Done/Due/Overdue/Upcoming), the next few tests due, and top N exercise PRs — each row deep-links to `/baselines/test/[name]` / `/baselines/exercise/[name]` (preserve the `encodeURIComponent` + `?equipment=` pattern).
- Reuse token-based status colors; do not duplicate large logic — import helpers from `@/lib/records` where possible.
- **Acceptance:** renders at 390px; deep links match the existing baselines routes exactly.

### REQ-C2 — `/progress` page  · M
**Create:** `src/app/progress/page.tsx` — server component, `export const dynamic = "force-dynamic"`.
- Compose: per-goal readiness (reuse the `stats/page.tsx` readiness logic — score + `ReadinessChart` + `ReadinessBreakdown`), weight card (current/start/Δ + `WeightChart`), and `<RecordsSummary>`.
- H1 "Progress". Warm empty states (reuse REQ-A6 copy for the weight-empty case).
- Add `aria-label`s to charts summarizing trend + latest value.
- Do **not** delete or modify `/stats` or `/baselines` — they remain valid deep routes.
- To avoid logic duplication, the readiness-by-goal computation may be lifted into a small shared helper (e.g. `src/lib/readiness-view.ts`) imported by both `/progress` and `/stats`; if so, refactor `/stats` to use it **without changing its output**.
- **Acceptance:** AC #7; `/stats` + `/baselines` still load; charts have aria-labels.

---

## Stream D — Today redesign

### REQ-D1 — Derived completion + rest-day model  · M
**Modify:** `src/app/page.tsx`. Add a server-computed completion state:
- **Completed** = a workout exists today. Use `resolved.workouts.length > 0` if `resolveDay(now)` returns a today-scoped `workouts` array (verified `calendar.ts:248-252` — it queries `startedAt` within the day already), OR fall back to a count query on `[startOfDay(now), endOfDay(now)]` using the existing `todayStart`/`todayEnd`. Either is acceptable; prefer reusing `resolved.workouts` to avoid a redundant query (SUGGESTION-2).
- **⚠ Rest day = `dayTemplate?.category === "rest"` (CRITICAL-1, NOT `dayTemplate === null` and NOT `dayBlocks.length === 0`).** Verified `program-template.ts:413-428`: day 7 "Rest / Active Recovery" is in `weeklySplit` with `category: "rest"` and a mobility block, so `resolveDay` returns a **non-null** template with `dayBlocks.length === 1` on rest day. `dayTemplate === null` only happens for dates OUTSIDE the plan range. The `category` field is typed in `DayTemplate` (`program-template.ts:27-34`) and round-trips through `resolveDay`. Rest-day → calm "Rest day — recover" card with a short hike-prep tip; if a workout is nonetheless logged that day, Completed wins (check completion first).
- **Else Planned** (today's plan, not yet logged).
- **Out-of-plan days (MISSING-5):** when `dayTemplate === null` (date before/after the program) and not completed, show a neutral "No workout scheduled" line rather than implying a missed plan day. (The `!program` case is already handled early and is separate.)
- Compute `dateKey(now)` **server-side** via `@/lib/calendar`; pass it as a prop to the celebration island. The client island must NEVER call `dateKey()` itself (`process.env.USER_TZ` is undefined in the browser → wrong TZ).
- **Acceptance:** Completed/Rest/Planned/out-of-plan states render correctly; rest-day uses `category === "rest"`; uses `@/lib/calendar` only; workout still override-aware via `resolveDay`.

### REQ-D2 — Workout hero + demote logging  · M
**Modify:** `src/app/page.tsx` layout per Mockup B.
- Lead with the workout as a visually dominant hero (week/phase eyeline, title, date, summary, the block list, a `DayBullseye` reflecting completion). Keep `BaselineBlockCard` when baselines are due.
- **Remove** the inline "Log weight" and "Log a note" cards from the main scroll (they now live in the Log sheet from Stream B). Keep the **Nutrition** summary card and **Recent workouts** card. A small "⊕ Log" affordance/hint may remain to point at the Log tab.
- Preserve the existing `BlockCard`/`ExerciseRow`/`baselineNames` filtering logic.
- **Acceptance:** workout dominates; weight/note inline cards gone from Today; nutrition + recent remain; AC #9.

### REQ-D3 — `DayBullseye` + `bullseye-pop` wiring  · M
**Create:** `src/components/TodayCelebration.tsx` (or similar) — `"use client"` island.
- Props: `{ completed: boolean, dateKey: string }`.
- `Bullseye` spreads `className` onto its `<svg>` (verified) so `<Bullseye className={shouldPop ? "bullseye-pop" : ""} filled={completed} size={...} aria-label={completed ? "Completed" : "In progress"} />` works with **no wrapper element**. Note `filled` and `progress` are a mutually-exclusive discriminated union — for completion use `filled`.
- **⚠ MANDATORY mount pattern (CRITICAL-2 — avoids React 19 hydration mismatch + premature flag-set):** initialize `const [shouldPop, setShouldPop] = useState(false)` (so server and first client render BOTH produce `className=""`), then in a `useEffect(() => {...}, [completed, dateKey])` read `localStorage`, and only if `completed` and the key is unset: set the key and call `setShouldPop(true)`. Do NOT read `localStorage` in the render body. Wrap in try/catch (degrade silently if unavailable).
  ```tsx
  "use client";
  import { useState, useEffect } from "react";
  import { Bullseye } from "@/components/Bullseye";
  export function TodayCelebration({ completed, dateKey }: { completed: boolean; dateKey: string }) {
    const [shouldPop, setShouldPop] = useState(false);
    useEffect(() => {
      if (!completed) return;
      const key = "goaldmine.celebrated." + dateKey;
      try { if (!localStorage.getItem(key)) { localStorage.setItem(key, "1"); setShouldPop(true); } } catch {}
    }, [completed, dateKey]);
    return <Bullseye className={shouldPop ? "bullseye-pop" : ""} filled={completed} size={28} aria-label={completed ? "Completed" : "In progress"} />;
  }
  ```
- **Acceptance:** AC #10 — pops once on first post-completion visit, calm on reload (new `dateKey` next day re-pops); no hydration warning; no throw if localStorage blocked.

### REQ-D4 — Fix leaked malformed-plan string  · S
**Modify:** `src/app/page.tsx:98`. Replace the user-facing `" · plan snapshot is malformed; restore from /goals/<id>/revisions or contact your coach"` with warm copy (e.g. omit the summary, or `" · plan details unavailable"`). Log the technical detail to the server console instead if useful.
- **Acceptance:** AC #11 — no dev string in the rendered output.

---

## Dependency notes
- Stream B's `LogLauncher` embeds Stream A's forms but **consumes them as-is** (A keeps public props stable) → can build in parallel; integration verified at merge.
- Stream D's `DayBullseye` and Stream B's nav-`Bullseye` both use the shared `Bullseye` component (read-only) → no conflict.
- No two streams modify the same file. `page.tsx` = D only. `BottomNav.tsx` = B only. Log forms = A only. `/progress` + `RecordsSummary` = C only.
