# Architecture Critique — App-Wide UX Overhaul
**Date:** 2026-05-31  
**Author:** Devil's Advocate Agent  
**Subject:** `.feature-dev/2026-05-31-ux-overhaul/agents/architecture-blueprint.md`  
**Verdict:** APPROVE-WITH-FIXES

All claims below are verified against the actual installed codebase at `node_modules/next/package.json` (v16.2.4), `src/lib/program-template.ts`, `src/lib/calendar.ts`, `src/lib/workout-actions.ts`, `src/app/page.tsx`, and `src/components/BottomNav.tsx`.

---

## Critical Issues (must fix before coding)

### CRITICAL-1 — Rest-day classification is wrong in BOTH the blueprint AND the research output
**Files:** `src/lib/program-template.ts:413–428` (day 7 definition), `architecture-blueprint.md §7 (isRestDay)`, `research-output.md §2.7 (RISK-8)`

**Finding:** The blueprint defines:
```typescript
const isRestDay: boolean = !isCompleted && dayTemplate === null;
```
And `research-output.md §2.7` adds a second candidate:
```
Rest day = workoutTemplate === null OR dayBlocks.length === 0
```
**Both are wrong.** Verified from `src/lib/program-template.ts:413–428`:

```typescript
{
  dayOfWeek: 7,
  title: "Rest / Active Recovery",
  category: "rest",         // <-- the signal
  summary: "Walk, light yoga, stretch. Eat well, sleep more.",
  blocks: [
    {
      type: "mobility",
      label: "Optional gentle movement",
      exercises: [
        { name: "Walk", durationSec: 1800 },
        { name: "Light Yoga or Stretching", durationSec: 900 },
      ],
    },
  ],
}
```

Day 7 is in `weeklySplit`, so `resolveDay(now).workoutTemplate` returns a **non-null** `DayTemplate` on rest day (it has both a title and mobility blocks). `dayTemplate === null` is only true when the date falls **outside the plan range** entirely (before start or after end) — it does not represent the rest day within the plan.

Separately, `dayBlocks.length === 0` also fails: the mobility block passes the baseline-filter in `page.tsx:60–66` because `Walk` and `Light Yoga` are not baseline test names. `dayBlocks` will have length 1 on rest day.

**Only correct signal:** `dayTemplate?.category === "rest"`. This field is stored in the DB JSON template (`seed.ts` stores `PROGRAM_TEMPLATE as unknown as object`), is typed in `DayTemplate` at `program-template.ts:27–34`, and survives round-trip through `resolveDay`.

**Fix for Stream D (`src/app/page.tsx`):**
```typescript
// Replace:
const isRestDay: boolean = !isCompleted && dayTemplate === null;

// With:
const isRestDay: boolean = !isCompleted && dayTemplate?.category === "rest";
```

**Impact:** Without this fix, the "Rest day — recover" card NEVER appears during the plan period. The user sees "Planned" every Sunday instead of a rest-day treatment. This silently fails the PRD's US-006 ("rest-day variant") and AC #9.

---

### CRITICAL-2 — `TodayCelebration` pop implementation underspecified: hydration mismatch risk
**File:** `architecture-blueprint.md §1 (D1 table row)`, `src/components/TodayCelebration.tsx` (to be created)

**Finding:** The blueprint describes the className trigger as:
> "When `completed && !localStorage["goaldmine.celebrated."+dateKey]`: adds `.bullseye-pop` className to the Bullseye and sets the localStorage flag."

It does NOT specify the mechanism — render-time check vs. `useState + useEffect`. This is load-bearing. A developer who naively checks `localStorage` in the render body:

```typescript
// WRONG — causes SSR/hydration mismatch
const shouldPop = completed && !localStorage.getItem("goaldmine.celebrated." + dateKey);
return <Bullseye className={shouldPop ? "bullseye-pop" : ""} filled={completed} size={20} />;
```

will produce a **hydration mismatch** because:
1. Server renders with `className=""` (no localStorage access server-side).
2. Client immediately renders with `className="bullseye-pop"` on first render.
3. React 19 hydration mismatches on `className` produce warnings and may produce a FOUC or double-pop.

Additionally, the localStorage write must happen in `useEffect`, or it fires during SSR (no-op) and during the first render cycle before React has reconciled — the flag would be set before the animation runs, causing the pop to be suppressed on the very page load that should show it.

**Correct mount sequence (must be specified to developers):**
```typescript
"use client";
import { useState, useEffect } from "react";

export function TodayCelebration({ completed, dateKey }: TodayCelebrationProps) {
  const [shouldPop, setShouldPop] = useState(false);

  useEffect(() => {
    if (!completed) return;
    const key = "goaldmine.celebrated." + dateKey;
    try {
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, "1");
        setShouldPop(true);
      }
    } catch (_) {
      // localStorage unavailable — degrade silently
    }
  }, [completed, dateKey]);

  return (
    <Bullseye
      className={shouldPop ? "bullseye-pop" : ""}
      filled={completed}
      size={20}
      aria-label={completed ? "Completed" : "In progress"}
    />
  );
}
```

- `useState(false)` ensures server and initial client renders match (no hydration mismatch).
- `useEffect` runs only after mount: reads localStorage, sets flag, triggers re-render with pop class.
- A single re-render adds `bullseye-pop`; the CSS animation starts from that re-render.
- On reload, `localStorage` already has the key → `setShouldPop` never called → no pop. Correct.
- On a new day, new `dateKey` → new key → pop fires once. Correct.
- `localStorage` unavailable: `catch` silences the error; `shouldPop` stays false. Pop may re-fire on each visit — acceptable per edge-case table.

**Fix:** Add the full `useState + useEffect` implementation pattern to the blueprint's D1 row and developer pitfalls checklist before Stream D starts.

---

### CRITICAL-3 — `requirements.md` REQ-A5 contradicts the blueprint on `error.tsx` prop name
**File:** `requirements.md:41`, `architecture-blueprint.md §1 (A5b)`, `node_modules/next/dist/client/components/error-boundary.js:109–110`

**Finding:** `requirements.md` REQ-A5 says:
> "warm coach copy + a `Try again` button calling `reset()`. Must accept `{ error, reset }`."

The blueprint (correctly) says to use `unstable_retry`. However, the requirements doc is what developers read first and last. This is a directly conflicting instruction.

**Verified from `node_modules/next/dist/client/components/error-boundary.js:107–111`:**
```javascript
(0, _jsxruntime.jsx)(this.props.errorComponent, {
  error: this.state.error,
  reset: this.reset,            // <-- also passed
  unstable_retry: this.unstable_retry  // <-- also passed
})
```
Next 16.2.4 passes **both** `reset` and `unstable_retry` to `error.tsx`. `reset` is NOT silently broken — it clears error state and re-renders. However, `reset` only clears client-side error state and re-renders without re-fetching server components. `unstable_retry` calls `context.refresh()` first — it is the correct choice for an app-level error boundary that wraps server components.

**The blueprint overstate this as "RISK-1 BLOCKER" and claims `reset` will be `undefined` at runtime.** That is incorrect — `reset` IS passed. The real concern is behavioral: `reset` may not recover from server component errors, while `unstable_retry` will. This is a design concern, not a runtime breakage.

**Fix:** Reconcile `requirements.md` REQ-A5 with the blueprint. Change REQ-A5 to read:
> "Must accept `{ error, unstable_retry }` per Next 16.2.4 (added in v16.2.0; see `node_modules/next/dist/docs/.../error.md`). Use `unstable_retry` for the retry button — it re-fetches server components. `reset` also exists but only clears client error state without re-fetching."

The developer pitfall checklist in the blueprint already says the right thing. Just fix the requirements doc before handing to Stream A.

---

## Design Concerns (should fix)

### CONCERN-1 — Focus trap is non-trivial with dynamically-expanded content
**File:** `architecture-blueprint.md §1 (B1)`, `requirements.md REQ-B1`

**Finding:** The blueprint says "focus trap via `useEffect` on `open`". `LogLauncher` expands inline forms (Weight/Meal/Note) on demand. A focus trap implemented with a one-time `querySelectorAll('[tabindex], input, button, a, ...')` at open time will miss the form elements that appear after the user taps a row to expand it.

The blueprint says focus traps are "hand-rollable." This is true, but the dynamic-content case requires either:
- Re-querying focusable elements on each `Tab` keydown (at the point of tab press, not at open time), OR
- Using a `MutationObserver` to update the focusable list when content changes.

The first approach (query on keydown) is simpler and correct:
```typescript
const handleKeyDown = (e: KeyboardEvent) => {
  if (e.key !== "Tab") return;
  const focusable = dialogRef.current?.querySelectorAll(
    'button:not([disabled]),a,input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'
  );
  const els = Array.from(focusable ?? []);
  // ... wrap Tab/Shift+Tab between els[0] and els[els.length-1]
};
```

**Fix:** Add a note in B1 that the focusable elements must be queried at keydown time (not captured at open), to handle dynamic form expansion inside the sheet. This is a single-line implementation note, not a redesign.

---

### CONCERN-2 — Body scroll-behind-sheet not addressed for iOS Safari
**File:** `architecture-blueprint.md §6`, `requirements.md REQ-B1`

**Finding:** The blueprint recommends `fixed` overlay with `z-50` for the sheet backdrop, noting "no portal needed." This is mostly correct — a fixed backdrop covers taps on desktop/Android Chrome. However, **iOS Safari has a persistent bug where momentum scroll on the page content can continue even when a fixed overlay is present.** The user can see the page scrolling behind the sheet.

The standard remediation is a one-liner:
```typescript
useEffect(() => {
  if (open) document.body.style.overflow = "hidden";
  else document.body.style.overflow = "";
  return () => { document.body.style.overflow = ""; };
}, [open]);
```
This must be in `BottomSheet.tsx`'s `useEffect` alongside the focus trap. Since `layout.tsx` sets `<body className="min-h-full flex flex-col ...">` with no overflow constraint, toggling `overflow: hidden` on body is safe and will not break the layout.

**Risk of NOT adding it:** Minor — only affects iOS momentum scroll behind the backdrop. The content is still visually covered. Taps are blocked by the backdrop. This is a polish issue, not a functionality break.

**Fix:** Add `document.body.style.overflow = open ? "hidden" : ""` to `BottomSheet.tsx`'s `useEffect` (restore on close and on unmount).

---

### CONCERN-3 — `latestWeight = null` is a real regression in the Log sheet; a cheap fix exists
**Files:** `architecture-blueprint.md §3`, `src/app/page.tsx:149` (current pre-fill)

**Finding:** The blueprint accepts `latestWeight = null` as the "simplest correct path." The stated rationale is that adding a DB query to `layout.tsx` is wrong. However, the blueprint overlooks a simpler option:

`src/app/page.tsx` (Stream D's file) **already fetches `latestMeasurement` at line 34–36** as part of its `Promise.all`. After Stream D's redesign, the Today page no longer shows the inline Log weight card — but it could still pass `latestWeight` down. The problem is that `BottomNav` is rendered from `layout.tsx`, not from `page.tsx`. You cannot pass a prop from a page to a layout's sibling component.

The blueprint's analysis of this is correct. There is no cheap path to pre-fill the sheet weight without either:
1. Moving `BottomNav` into a server-side async wrapper that fetches `latestMeasurement` (adds per-page-render DB call to every route), or
2. A client-side server action call on sheet open (a `"use server"` function returning the latest weight, called from `BottomNav`'s `useEffect` when `logOpen` becomes true).

Option 2 is cheap but adds a round-trip on each sheet open. Given that this is a single-user app where the user knows their approximate weight, the null default is defensible.

**Verdict:** The blueprint's null choice is acceptable. Flag it in the QA smoke test: "Weight input starts empty by design — do not file a bug."

---

### CONCERN-4 — `useFormFeedback` `submit` reads FormData from `formRef`, not from the `action`'s argument
**File:** `architecture-blueprint.md §2.1`

**Finding:** The blueprint's hook signature:
```typescript
submit: (action: (fd: FormData) => Promise<void>, opts?) => void;
```
with: "FormData is read from the managed `formRef`"

This means `submit` calls `new FormData(formRef.current!)` internally. BUT: `LogMeasurementForm` currently uses the `<form action={(fd) => startTransition(...)}>`  pattern where `fd` is supplied by the browser's native form submission. When migrated to `useFormFeedback`, the form's `action` prop must change from the native action handler to an `onSubmit` handler (or a non-native pattern), because `formRef.current!.submit()` inside a React `startTransition` won't trigger the native form submission event.

More concretely: if the form still uses `action={...}`, the native submission fires and the hook's `submit` function is never called. If the form uses `onSubmit={e => { e.preventDefault(); submit(logMeasurement) }}`, then the hook reads `new FormData(formRef.current!)` and passes it to `logMeasurement`. This is correct, but it is a different invocation pattern than what `LogMeasurementForm` uses today.

The blueprint doesn't flag this usage-pattern change. Developer might keep the `action` prop and try to call `submit()` separately, causing a double-submit or no-submit.

**Fix:** Add to the blueprint's §2.1: "When adopting `useFormFeedback`, the `<form>` must use `onSubmit={e => { e.preventDefault(); submit(action) }}` instead of `action={...}`. The native `action` prop causes the browser to handle submission; `useFormFeedback.submit` handles it instead."

---

## Suggestions

### SUGGESTION-1 — Use `<dialog>` element instead of `<div role="dialog">` for BottomSheet
**File:** `architecture-blueprint.md §1 (B1)`, `requirements.md REQ-B1`

The HTML `<dialog>` element has built-in focus trapping in all modern browsers (Chrome 37+, Firefox 98+, Safari 15.4+). Using `<dialog>` with `showModal()` / `close()` eliminates the hand-rolled focus trap entirely and handles Esc, `aria-modal`, and return focus natively. It also avoids the body-scroll issue on iOS Safari (the browser handles scroll locking for modal dialogs).

This would require a `useEffect` to call `dialogRef.current.showModal()` on open and `close()` on close, plus CSS to style the native `::backdrop`. Since no new deps are added and browser support is complete, this is strictly better. However, it's a different architectural choice than what the blueprint specified — flag it as an optional upgrade.

---

### SUGGESTION-2 — `isCompleted` check should use `resolved.workouts` already fetched, not a new query
**File:** `architecture-blueprint.md §7`

The blueprint's completion check:
```typescript
const isCompleted: boolean = resolved.workouts.some(
  (w) => w.startedAt >= todayStart && w.startedAt <= todayEnd
);
```
`resolved.workouts` is already populated by `resolveDay(now)` at `calendar.ts:248–252` with `where: { startedAt: { gte: dayStart, lte: dayEnd } }` — meaning ALL workouts in `resolved.workouts` are already within today's range. The `>=`/`<=` filter in `isCompleted` is redundant but harmless. Simplify to:
```typescript
const isCompleted = resolved.workouts.length > 0;
```

---

### SUGGESTION-3 — `prefers-reduced-motion` gap for sheet transitions
**File:** `architecture-blueprint.md §1 (B1)`

The blueprint says reduced-motion for sheets should be handled as "`prefers-reduced-motion` → instant (no transform/opacity transition)". However, the specific CSS to achieve this must be written as a `@media` query in either `globals.css` or as an inline style toggle — the blueprint doesn't specify which. If left to the developer, they may forget.

Explicit CSS rule to add:
```css
@media (prefers-reduced-motion: reduce) {
  .sheet-backdrop, .sheet-panel {
    transition: none !important;
  }
}
```
or toggle a CSS class. Flag this explicitly in the B1 developer checklist.

---

### SUGGESTION-4 — AppHeader `z-30` vs sheet `z-50`: header is correctly covered
**File:** `src/components/AppHeader.tsx:14` (verified)

`AppHeader` is `sticky top-0 z-30`. Sheet backdrop is `z-50`. So when the sheet opens, the header is correctly covered. No issue, but flagging it since the blueprint didn't explicitly verify it. AppHeader's `z-30` means the sheet's `z-50` backdrop covers it. Correct.

---

## Missing Requirements

### MISSING-1 — AC #12: `error.tsx` has no spec for what `reset action` means
**File:** `docs/prds/PRD-ux-overhaul.md:235`, `requirements.md:41`

AC #12 says: "error.tsx is a client component with a reset action." `requirements.md` REQ-A5 says `reset()`. Blueprint says `unstable_retry()`. These are different behaviors. The acceptance criterion is ambiguous about which. **Resolution needed:** the AC should specify "reset action calls `unstable_retry()` (re-fetches server components) per Next 16.2.4."

---

### MISSING-2 — AC #14 keyboard a11y: focus trap dynamic content not specified
**File:** `docs/prds/PRD-ux-overhaul.md:237`, `requirements.md REQ-B1:57`

AC #14 says "focus trapped." REQ-B1 says "focus trap." Neither specifies that the focusable-elements list must be computed at keydown time (not at open time) to handle the dynamically-expanded inline forms. Without this clarification, the developer writes a static trap that misses the `LogNutritionForm`/`LogMeasurementForm`/`LogNoteForm` inputs that appear after row expansion. Add: "focusable elements must be queried at keydown time to include dynamically-rendered form content."

---

### MISSING-3 — Blueprint omits the `TodayCelebration` `useState + useEffect` mount pattern (critical path)
**File:** `architecture-blueprint.md §1 (D1)`, `requirements.md REQ-D3`

REQ-D3 says "wrap `localStorage` in try/catch (like the layout theme script)." The layout theme script is a `<script>` inline block, not a React component. It runs synchronously before paint. `TodayCelebration` is a React client component — `localStorage` access in the render body causes hydration mismatch. Neither the blueprint nor the requirements specify the correct `useState(false) → useEffect` pattern. This must be added to REQ-D3 and the developer pitfall checklist before Stream D begins.

---

### MISSING-4 — `DayTemplate.category` field not mentioned as rest-day signal anywhere
**File:** `architecture-blueprint.md §7 (RISK-8)`, `research-output.md §2.7 (RISK-8)`, `requirements.md REQ-D1`

Both documents discuss rest-day classification at length but neither mentions `DayTemplate.category`. The actual program template (`src/lib/program-template.ts:27–34`) defines `category: "rest"` as the semantic field for the rest day. REQ-D1 says "`dayBlocks.length === 0` and no baselines due" — this is doubly wrong (see CRITICAL-1). Add `dayTemplate?.category === "rest"` as the canonical rest-day check to the requirements.

---

### MISSING-5 — No spec for what Today shows when `isCompleted=false` AND `isRestDay=false` on a day outside the plan
**File:** `architecture-blueprint.md §7`, `requirements.md REQ-D1`

Current `page.tsx` handles the `!program` case early (returns "No active program" card). But `resolveDay(now)` when `isInPlan=false` still returns `workoutTemplate: null`. The blueprint's corrected logic (`dayTemplate?.category === "rest"`) would also produce `isRestDay=false` on out-of-plan days (since `null?.category` is `undefined`, not `"rest"`). So out-of-plan days would fall into the `isPlanned` bucket and show "Planned" with no blocks. That's not wrong but should be explicitly confirmed — "Planned" with zero blocks is the expected behavior for days before/after the program. If the intent is to show a specific "Outside program" state, add it now.

---

## Verdict

**APPROVE-WITH-FIXES**

The blueprint is architecturally sound, the stream isolation is real (verified), and the technical decisions (null latestWeight, unstable_retry, no portal, dateKey server-side) are all correct. Three issues require resolution before any stream is handed work.

**Top 3 issues:**

1. **CRITICAL-1 (Rest-day classification):** `dayTemplate === null` never fires within the plan. The only correct check is `dayTemplate?.category === "rest"`. Without this fix, Stream D will never render the rest-day variant. Fix the rest-day condition in the blueprint §7 and REQ-D1 before Stream D starts.

2. **CRITICAL-2 (Celebration pop hydration):** The blueprint says "add `.bullseye-pop` className" but doesn't say HOW. A naive render-time localStorage check causes a React 19 hydration mismatch. The correct pattern (`useState(false)` + `useEffect`) must be specified explicitly in D1 before Stream D starts.

3. **CRITICAL-3 / MISSING-1 (requirements.md contradicts blueprint on `reset`):** `requirements.md REQ-A5:41` says `{ error, reset }` and the blueprint says `unstable_retry`. The requirements doc is the source of truth for Stream A. Fix the requirements to say `unstable_retry` (and note that both props exist in Next 16.2.4, but `unstable_retry` is correct for server component recovery).
