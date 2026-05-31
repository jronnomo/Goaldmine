# Architecture Blueprint — App-Wide UX Overhaul
**Date:** 2026-05-31  
**Author:** Architect Agent  
**Branch:** `feature/ux-overhaul`  
**Feeds:** 4 parallel Developer Agents (Streams A / B / C / D)

---

## 0. Guiding Principles

- **No file is touched by two streams.** Verified below — any would-be conflict is resolved by assignment.
- **No new npm dependencies.** CSS transitions only for sheets; Recharts already present.
- **Server components by default; `"use client"` only where interaction requires it.**
- **All date math via `@/lib/calendar`.** No raw `setHours`/`getDate`/`getFullYear`.
- **`dateKey(now)` is server-computed and passed as a prop** to any client island that needs it.
- **CRITICAL (RISK-1):** `error.tsx` uses `unstable_retry`, NOT `reset`. The PRD/REQs reference the old Next 13 API. Next 16 prop is `unstable_retry: () => void`. Failure to use it means the reset button is silently broken.

---

## 1. File Plan

### Stream A — Forms + States Scaffolding

| # | File | Create / Modify | Client? | Description |
|---|------|-----------------|---------|-------------|
| A1 | `src/lib/use-form-feedback.ts` | **Create** | `"use client"` | `useFormFeedback` hook — `useTransition` + `useRef` + success-flash (~1500ms) + error state + `formRef.reset()`. The success-flash pattern is **new to this codebase** (reference: `ShareWorkout.tsx:27`); it does NOT exist in `LogNutritionForm` today. |
| A2 | `src/components/LogMeasurementForm.tsx` | **Modify** | `"use client"` | Adopt `useFormFeedback`. Add `formRef`, error state, `--success` confirmation line with reserved height. Keep `{ latestWeight: number \| null }` prop unchanged. Add `revalidatePath("/progress")` + `revalidatePath("/stats")` via the server action (see §5). |
| A3 | `src/components/LogNoteForm.tsx` | **Modify** | `"use client"` | Adopt `useFormFeedback`. Add `--success` confirmation + `--danger` error. Preserve `type` reset to `"journal"` on success and the description line. Add `revalidatePath("/journal")` via the server action (see §5). |
| A4 | `src/components/LogNutritionForm.tsx` | **Modify** | `"use client"` | Optional refactor onto `useFormFeedback`; add `--success` line (currently resets but shows no confirmation). No regression to `defaultMeal()` or `mealType` state. |
| A5a | `src/app/loading.tsx` | **Create** | server | Root loading skeleton — pulsing `Card`-shaped blocks in `max-w-md mx-auto p-4` shell using `var(--card)` + `var(--border)`. No `"use client"` needed. |
| A5b | `src/app/error.tsx` | **Create** | **`"use client"` required** | Root error boundary. Props: `{ error: Error & { digest?: string }, unstable_retry: () => void }`. Warm coach copy + "Try again" button calling `unstable_retry`. |
| A6 | `src/app/stats/page.tsx` | **Modify** | server | Soften `"No measurements yet."` (line 121) to warm copy: e.g. `"No weight logged yet — tap Log in the nav to record your first weigh-in."` Stream A only; do NOT modify `/progress` page (Stream C owns it). |
| A7 | `src/lib/workout-actions.ts` | **Modify** | server (no change) | Add `revalidatePath("/progress")` + `revalidatePath("/stats")` to `logMeasurement`; add `revalidatePath("/journal")` to `logNote`. **Stream A owns this file exclusively.** No other stream touches it. |

### Stream B — Navigation + Bottom Sheets

| # | File | Create / Modify | Client? | Description |
|---|------|-----------------|---------|-------------|
| B1 | `src/components/BottomSheet.tsx` | **Create** | `"use client"` | Sheet primitive. Props: `{ open: boolean, onClose: () => void, title: string, children: ReactNode }`. Backdrop 160ms ease-out; panel translateY 220ms cubic-bezier(.16,1,.3,1); close 180ms; `prefers-reduced-motion` → instant. `role="dialog"`, `aria-modal="true"`, focus trap, Esc + backdrop close, focus-return to trigger. `max-h-[85vh]` + internal scroll. |
| B2 | `src/components/LogLauncher.tsx` | **Create** | `"use client"` | Log sheet content. Props: `{ latestWeight?: number \| null }` (default `null` — see §3). Renders four rows: Weight (expands `LogMeasurementForm`), Meal (expands `LogNutritionForm`), Note (expands `LogNoteForm`), Import (`Link` to `/import` + `onClose`). Row height ≥48px. |
| B3 | `src/components/MoreSheet.tsx` | **Create** | `"use client"` | More sheet content. Props: `{ onClose: () => void }`. Rows: Coach (`/coach`), Nutrition (`/nutrition`), History (`/history`), Journal (`/journal`) — each a `Link` that calls `onClose` on click. Plus a layout row with "Theme" label left + `<ThemeToggle />` right (no props change to `ThemeToggle`; the row provides the label). Row height ≥48px. |
| B4 | `src/components/BottomNav.tsx` | **Modify** | `"use client"` | Full rebuild — see §6 (Component Hierarchy). Five tabs: Today (Link `/`), Plan (Link `/calendar`), Log (button → logOpen), Progress (Link `/progress`), More (button → moreOpen). Fix match predicates. Replace inactive 6px spacer with `<Bullseye size={6} aria-hidden />`. Owns `logOpen`/`moreOpen` state; renders `<BottomSheet>` + `<LogLauncher>` + `<MoreSheet>`. Route-change sheet-close via `usePathname` effect. |
| B5 | `src/app/progress/loading.tsx` | **Create** | server | Progress-route loading skeleton (the data queries are expensive). Same pulsing-Card pattern as root `loading.tsx`. |

### Stream C — Progress Hub

| # | File | Create / Modify | Client? | Description |
|---|------|-----------------|---------|-------------|
| C1 | `src/components/RecordsSummary.tsx` | **Create** | server | Condensed records: 4 status pills, next tests due, top exercise PRs. Imports `getBaselineSchedule` + `getExerciseSummaries` from `@/lib/records`. Deep links via `/baselines/test/${encodeURIComponent(name)}` and `/baselines/exercise/${encodeURIComponent(name)}?equipment=...`. Status colors use CSS tokens (`--success`, `--warning`, `--danger`, `--muted`), NOT Tailwind color names. |
| C2 | `src/app/progress/page.tsx` | **Create** | server | `/progress` hub. `export const dynamic = "force-dynamic"`. H1 "Progress". Composes: readiness-by-goal section (copy `stats/page.tsx:32–48` pattern exactly), weight card (current/start/Δ + `WeightChart`), `<RecordsSummary />`. Charts get `aria-label` summarizing direction + latest value. Warm empty states for no-measurements case. Does NOT delete or modify `/stats` or `/baselines`. |

### Stream D — Today Redesign

| # | File | Create / Modify | Client? | Description |
|---|------|-----------------|---------|-------------|
| D1 | `src/components/TodayCelebration.tsx` | **Create** | `"use client"` | Client island. Props: `{ completed: boolean, dateKey: string }`. Renders `<Bullseye>` with `filled={completed}` (or `filled={false}` for hollow). When `completed && !localStorage["goaldmine.celebrated."+dateKey]`: adds `.bullseye-pop` className to the Bullseye and sets the localStorage flag. All localStorage access wrapped in try/catch. Reduced-motion handled by the existing CSS guard in `globals.css`. Container must have `overflow: visible` to allow scale(1.08) pop. |
| D2 | `src/app/page.tsx` | **Modify** | server | Stream D's main file. (a) Derive completion/rest-day/planned state (§7). (b) Compute `dateKey(now)` server-side; pass to `<TodayCelebration>`. (c) Restructure layout: workout hero leads (week/phase eyeline, title, date, summary, Bullseye, block list). Remove inline "Log weight" Card and "Log a note" Card. Pass `showLogForm={false}` to `<NutritionToday>`. Keep nutrition summary + recent workouts. (d) Fix line 98 leaked dev string. |

### Overlap Verification

Each file appears in exactly one stream:

- `src/lib/workout-actions.ts` → **Stream A only** (A7). No other stream touches it.
- `src/app/page.tsx` → **Stream D only** (D2). No other stream touches it.
- `src/components/BottomNav.tsx` → **Stream B only** (B4). No other stream touches it.
- `src/app/stats/page.tsx` → **Stream A only** (A6). Stream C's `/progress` page is a new file.
- `src/app/layout.tsx` → **not modified by any stream** (see §6 — sheets stay inside BottomNav).
- Form components (`LogMeasurementForm`, `LogNoteForm`, `LogNutritionForm`) → **Stream A only**.
- All new files (`BottomSheet`, `LogLauncher`, `MoreSheet`, `RecordsSummary`, `/progress/page.tsx`, `TodayCelebration`, `use-form-feedback.ts`, `loading.tsx`, `error.tsx`) → each created by exactly one stream.

**No conflicts.** All streams are file-isolated.

---

## 2. Shared Interfaces

### 2.1 `useFormFeedback` (Stream A — `src/lib/use-form-feedback.ts`)

```typescript
"use client";

export type FormFeedbackState = {
  pending: boolean;
  error: string | null;
  saved: string | null;  // transient success message; null when cleared
  formRef: React.RefObject<HTMLFormElement | null>;
  submit: (
    action: (fd: FormData) => Promise<void>,
    opts?: { successMsg?: string; onSuccess?: () => void }
  ) => void;
};

export function useFormFeedback(): FormFeedbackState { ... }
```

**Behavior contract:**
- `submit` wraps `startTransition`, clears error, awaits `action(formRef.current!)`.
- On success: calls `formRef.current?.reset()`, calls `opts?.onSuccess?.()`, sets `saved` to `opts?.successMsg ?? "Saved"`, auto-clears `saved` after 1500ms via `setTimeout`.
- On throw: sets `error` to `e instanceof Error ? e.message : "Couldn't save — tap to retry"`. Does NOT call `formRef.reset()` on error.
- `FormData` is read from the managed `formRef` — callers attach `ref={formRef}` to their `<form>`.
- **Consumed by:** A2 (`LogMeasurementForm`), A3 (`LogNoteForm`), A4 (`LogNutritionForm`).

**Success/error line rendering contract (enforced by each consumer):**
```tsx
{/* Reserve height to prevent layout shift — always rendered, conditionally filled */}
<p className="text-xs min-h-[1rem]" aria-live="polite">
  {saved && <span className="text-[var(--success)]">{saved}</span>}
  {error && !saved && <span className="text-[var(--danger)]">{error}</span>}
</p>
```

---

### 2.2 `BottomSheet` props (Stream B — `src/components/BottomSheet.tsx`)

```typescript
export type BottomSheetProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
};

export function BottomSheet({ open, onClose, title, children }: BottomSheetProps): JSX.Element
```

Internal behavior: manages focus trap via `useEffect` on `open`; stores `triggerRef` via `document.activeElement` snapshot on open; returns focus on close. Renders via a portal (`document.body`) or as a fixed overlay — both work since `layout.tsx` has no `overflow: hidden` on body. **Recommended:** fixed overlay directly in the component tree (no portal needed; z-index handles stacking). Use `z-50`.

---

### 2.3 `LogLauncher` props (Stream B — `src/components/LogLauncher.tsx`)

```typescript
export type LogLauncherProps = {
  latestWeight?: number | null;  // default: null — see §3
  onClose: () => void;
};

export function LogLauncher({ latestWeight = null, onClose }: LogLauncherProps): JSX.Element
```

`latestWeight` is passed directly to `<LogMeasurementForm latestWeight={latestWeight} />`. When `null`, the weight input starts empty (already handled by `defaultValue={latestWeight ?? undefined}` in `LogMeasurementForm`).

---

### 2.4 `MoreSheet` props (Stream B — `src/components/MoreSheet.tsx`)

```typescript
export type MoreSheetProps = {
  onClose: () => void;
};

export function MoreSheet({ onClose }: MoreSheetProps): JSX.Element
```

`ThemeToggle` is rendered as-is (zero props). The row wraps it:
```tsx
<div className="flex items-center justify-between px-4 py-3 min-h-[48px]">
  <span className="text-sm font-medium">Theme</span>
  <ThemeToggle />
</div>
```

---

### 2.5 `TodayCelebration` props (Stream D — `src/components/TodayCelebration.tsx`)

```typescript
export type TodayCelebrationProps = {
  completed: boolean;
  dateKey: string;  // e.g. "2026-05-31" — MUST be server-computed, not client-recomputed
  // size is fixed internally (e.g. size={20})
};

export function TodayCelebration({ completed, dateKey }: TodayCelebrationProps): JSX.Element
```

`dateKey` is passed from `page.tsx` server component via `resolved.dateKey` (already present on `ResolvedDay`; alternatively `dateKey(now)` called once at the top of `HomePage`). The client island must NOT call `dateKey(new Date())` — `process.env.USER_TZ` is `undefined` in the browser.

---

### 2.6 `RecordsSummary` props (Stream C — `src/components/RecordsSummary.tsx`)

```typescript
// RecordsSummary is a server component — no props needed for data (it fetches internally).
// Optional display props for slot adaptation:
export type RecordsSummaryProps = {
  maxExercises?: number;  // default: 5
  maxTestsDue?: number;   // default: 3
};

export async function RecordsSummary(props?: RecordsSummaryProps): Promise<JSX.Element>
```

Data fetched internally via `getBaselineSchedule()` + `getExerciseSummaries()`. `/progress/page.tsx` renders `<RecordsSummary />` with no props (defaults).

---

## 3. The `latestWeight` Decision

**Decision: `LogLauncher` accepts `latestWeight?: number | null` (default `null`); `BottomNav` passes `null` unconditionally.**

**Rationale:**

The three options considered:

1. **Server wrapper around BottomNav** — would require moving `BottomNav` out of `layout.tsx` into a server async component, then a client shell, just to pass one optional field. This is significant complexity for a cosmetic convenience feature.

2. **Root layout fetches latestWeight and passes down** — `layout.tsx` is currently a pure server layout with no data fetching. Adding a Prisma call to the root layout means every page render waits on a DB round-trip for a field that only helps pre-fill a form input. Wrong tradeoff.

3. **`latestWeight = null`, input starts empty** — `LogMeasurementForm` already handles `latestWeight: number | null` with `defaultValue={latestWeight ?? undefined}`. When `null`, the weight input is empty. The user types their weight. This is acceptable UX: the Log sheet is a quick-log surface, not a sophisticated weight-entry page; the user knows their weight. The Today page (which previously showed the pre-filled form) is being demoted anyway.

**Chosen: option 3.** The `LogLauncher` weight input starts empty. `BottomNav` passes no data. No server data fetching enters any client component. No new server action. No layout change.

**File ownership:** `BottomNav.tsx` renders `<LogLauncher latestWeight={null} onClose={...} />`. `LogLauncher` passes it straight to `LogMeasurementForm`. `LogMeasurementForm.tsx` needs no prop change (it already accepts `number | null`).

---

## 4. `revalidatePath` Fixes

**All in `src/lib/workout-actions.ts` — Stream A exclusively (file A7). No other stream touches this file.**

### `logMeasurement` (lines 32–33 today)
```typescript
// Existing:
revalidatePath("/");
revalidatePath("/history");

// Add:
revalidatePath("/progress");
revalidatePath("/stats");
```
Rationale: weight drives the readiness score (`computeReadiness` reads measurements); after a weigh-in, both `/stats` and the new `/progress` page must re-render. This is confirmed as the root cause of the "stale readiness score after weigh-in" bug.

### `logNote` (lines 50–51 today)
```typescript
// Existing:
revalidatePath("/");
revalidatePath("/history");

// Add:
revalidatePath("/journal");
```
Rationale: `logNote` creates a Note record; the `/journal` page lists notes; without revalidation the Journal page is stale after saving a note via the Log sheet.

### `logNutrition` — no change needed.
Current: `revalidatePath("/")` + `revalidatePath("/nutrition")`. Per PRD §4.3 this is sufficient.

---

## 5. `/progress` vs `/stats` Shared Logic

**Decision: copy the readiness-by-goal computation pattern directly into `/progress/page.tsx`; do NOT extract a shared helper.**

**Rationale:** The research output (§2.5) confirms the readiness computation is a single `Promise.all` map (9 lines in `stats/page.tsx:32–48`). Extracting a `readiness-view.ts` helper requires agreeing on a return type, updating `stats/page.tsx`, and running `npx tsc --noEmit` on both — all in Stream C while Stream A potentially touches `stats/page.tsx` for the empty-state copy fix (A6). This creates a coordination dependency where none need exist.

The code duplication is minimal and intentional: `/stats` and `/progress` may diverge in future (different ordering, different context). Keep them independent.

**`/progress/page.tsx` readiness block** is a direct copy of `stats/page.tsx:13–48` with:
- The `WeightChart` + weight-card section included (same query).
- `<RecordsSummary />` added below.
- H1 changed to "Progress".
- Chart `aria-label` attributes added.
- Warm empty-state copy for no-measurements case (reuse A6 language).

**Stream C owns both `RecordsSummary.tsx` and `/progress/page.tsx` exclusively.** No other stream imports `RecordsSummary` or `/progress/page.tsx`.

---

## 6. BottomNav as Sheet Host — Component Hierarchy

`layout.tsx` does NOT change. Sheets stay inside BottomNav. No portal required.

```
layout.tsx (unchanged)
  └── <BottomNav /> (Stream B — "use client")
        ├── <nav> ... 5 tab items ...
        │     ├── <Link href="/">Today</Link>
        │     ├── <Link href="/calendar">Plan</Link>
        │     ├── <button onClick={() => setLogOpen(true)}>Log</button>
        │     ├── <Link href="/progress">Progress</Link>
        │     └── <button onClick={() => setMoreOpen(true)}>More</button>
        │
        ├── <BottomSheet open={logOpen} onClose={() => setLogOpen(false)} title="Log">
        │     <LogLauncher latestWeight={null} onClose={() => setLogOpen(false)} />
        │   </BottomSheet>
        │
        └── <BottomSheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
              <MoreSheet onClose={() => setMoreOpen(false)} />
            </BottomSheet>
```

**State management in `BottomNav`:**
```typescript
const [logOpen, setLogOpen] = useState(false);
const [moreOpen, setMoreOpen] = useState(false);
const pathname = usePathname();  // already imported

// Close sheets on route change (prevents stuck backdrop on browser-back)
useEffect(() => {
  setLogOpen(false);
  setMoreOpen(false);
}, [pathname]);
```

**Active-state logic for rebuilt tabs:**
```typescript
const tabs = [
  { type: "link", href: "/",          label: "Today",    match: (p) => p === "/" },
  { type: "link", href: "/calendar",  label: "Plan",     match: (p) => p.startsWith("/calendar") || p.startsWith("/days") },
  { type: "sheet", key: "log",        label: "Log",      match: () => false },
  { type: "link", href: "/progress",  label: "Progress", match: (p) => p.startsWith("/progress") || p.startsWith("/stats") || p.startsWith("/baselines") },
  { type: "sheet", key: "more",       label: "More",     match: () => false },
];
```

- Log and More sheet-trigger buttons: `match: () => false` — they never show "active" state (they are transient launchers).
- Plan match: `startsWith("/calendar") || startsWith("/days")` **only** — `/history`, `/workouts`, `/import` are NOT included.
- Progress match: includes `/stats` and `/baselines` — those pages become "children" of Progress in the nav mental model.
- Goals tab is removed from the nav (replaced by Progress). Goals remain accessible via deep links from `/progress` and goal-management pages.
- Journal tab is removed from the nav (moved to More sheet). Journal remains reachable via More → Journal row.

**Inactive glyph fix:** Replace `<span className="h-[6px] block" aria-hidden />` with `<Bullseye size={6} aria-hidden />` (no `filled`, no `progress` → hollow ring). Active glyph remains `<Bullseye filled size={6} aria-hidden />`.

**`layout.tsx` verdict:** No changes needed. `<BottomNav />` is already rendered at the bottom of `<body>`. The sheets render inside BottomNav as fixed overlays with `z-50`, above the main content's natural stacking context.

---

## 7. Today Page Data Flow

**All computed in the `HomePage` async server component (`src/app/page.tsx`).**

### Existing computations (preserve as-is)
```typescript
const now = new Date();
const todayStart = startOfDay(now);    // already line 31
const todayEnd = endOfDay(now);        // already line 32
const resolved = await resolveDay(now); // already line 34 (via Promise.all)
const dayTemplate = resolved.workoutTemplate;  // already line 54
const dayBlocks = (dayTemplate?.blocks ?? []).filter(...);  // already lines 60-66
```

### New computations (add after existing setup)
```typescript
import { dateKey } from "@/lib/calendar";

// Completion: a workout logged today wins over everything, including rest-day
const isCompleted: boolean = resolved.workouts.some(
  (w) => w.startedAt >= todayStart && w.startedAt <= todayEnd
);

// Rest day: no workout template OR workout template has no non-baseline blocks
// NOTE: a baseline-only day (workoutTemplate !== null but dayBlocks.length === 0)
// is NOT a rest day — it is a "test day". Only show rest-day treatment when
// workoutTemplate === null (truly no workout assigned).
const isRestDay: boolean = !isCompleted && dayTemplate === null;

// Planned: workout assigned, not yet logged
const isPlanned: boolean = !isCompleted && !isRestDay;

// dateKey — server-computed, passed to TodayCelebration as prop
const todayKey: string = dateKey(now);
```

**State precedence:** `isCompleted` wins over `isRestDay` — a logged workout on a rest day is treated as Completed (PRD §6 edge case: "a logged workout wins over rest-day classification").

**What is passed to `TodayCelebration`:**
```tsx
<TodayCelebration completed={isCompleted} dateKey={todayKey} />
```

**`NutritionToday` change:**
```tsx
<NutritionToday logs={todayNutrition} plan={resolved.nutritionPlan} showLogForm={false} />
```
`showLogForm={false}` suppresses the inline `LogNutritionForm`. The form remains available in the Log sheet.

**Removed from Today's main scroll:**
- The "Log weight" `Card` (lines 145–150 today).
- The "Log a note" `Card` (lines 152–175 today).

**Line 98 fix:**
```typescript
// Before:
" · plan snapshot is malformed; restore from /goals/<id>/revisions or contact your coach"
// After:
" · plan details unavailable"
// Optionally, add server-side: console.warn("[Today] plan snapshot missing summary for day", ctx.day?.id);
```

**Override-awareness:** Preserved. `dayTemplate = resolved.workoutTemplate` is already the override-aware value (line 54). `ctx.day` is kept only for `weekIndex`/`phase` metadata in the eyeline. Do not regress to `ctx.day` for the workout content.

---

## 8. Implementation Order + Parallelization

All four streams run **fully in parallel** in isolated git worktrees from the `feature/ux-overhaul` branch. There are no compile-time dependencies between streams (each consumes stable existing interfaces).

### Worktree setup (one command per stream)
```bash
git worktree add ../ux-overhaul-stream-a feature/ux-overhaul
git worktree add ../ux-overhaul-stream-b feature/ux-overhaul
git worktree add ../ux-overhaul-stream-c feature/ux-overhaul
git worktree add ../ux-overhaul-stream-d feature/ux-overhaul
```

### Parallel execution
| Stream | Files Created/Modified | Depends on |
|--------|------------------------|------------|
| A | `use-form-feedback.ts`, `LogMeasurementForm.tsx`, `LogNoteForm.tsx`, `LogNutritionForm.tsx`, `loading.tsx`, `error.tsx`, `stats/page.tsx`, `workout-actions.ts` | Existing `logMeasurement` / `logNote` / `logNutrition` actions (already present) |
| B | `BottomSheet.tsx`, `LogLauncher.tsx`, `MoreSheet.tsx`, `BottomNav.tsx`, `progress/loading.tsx` | Existing `LogMeasurementForm` / `LogNutritionForm` / `LogNoteForm` props (stable — A keeps them unchanged) |
| C | `RecordsSummary.tsx`, `progress/page.tsx` | Existing `@/lib/records`, `@/lib/readiness` (already present) |
| D | `TodayCelebration.tsx`, `page.tsx` | Existing `Bullseye.tsx` (unchanged), `resolveDay` / `dateKey` (already present) |

### Integration seams (verify at merge)
1. **A→B seam:** `LogMeasurementForm` public prop `{ latestWeight: number | null }` must be unchanged. Verify: `grep "latestWeight" src/components/LogMeasurementForm.tsx` returns the same signature. Stream B's `LogLauncher` passes `latestWeight={null}` — this must be accepted.
2. **B→layout seam:** `BottomNav` renders inside `layout.tsx` — confirm no import changes needed in `layout.tsx` (BottomNav's signature is `BottomNav()` with no props, unchanged).
3. **C→progress seam:** `RecordsSummary` is an `async function` (server component). Confirm `/progress/page.tsx` does `import { RecordsSummary } from "@/components/RecordsSummary"` and renders `<RecordsSummary />` (no props needed for basic usage).
4. **D→A seam:** `TodayCelebration` is a new file; `page.tsx` imports it. No conflict with A (which does not touch `page.tsx`).
5. **A→`workout-actions.ts` seam:** Only Stream A touches `workout-actions.ts`. Merge conflict risk: none (no other stream modifies it).

### Merge order
No strict ordering needed — all streams produce disjoint file sets. Merge all four, run `npx tsc --noEmit` + `npm run lint` + `npm run build` on the merged branch. Resolve any TypeScript import errors before pushing.

---

## 9. Critical Decisions and Risks

### RISK-1 — `error.tsx` prop: `unstable_retry` NOT `reset` [BLOCKER for Stream A]
**Resolution:** Stream A must write `error.tsx` with `unstable_retry: () => void`. The PRD, REQs, and requirements.md all say `reset` — this is wrong for Next 16. `reset` as a prop name will be `undefined` at runtime (TypeScript won't catch it as an error on a function-component parameter). The "Try again" button will silently do nothing.

**Do:** `export default function ErrorPage({ error, unstable_retry }: { error: Error & { digest?: string }, unstable_retry: () => void })`  
**Do NOT:** `export default function ErrorPage({ error, reset }: { ... reset: () => void })`

### RISK-2 — `useFormFeedback` introduces success-flash NEW to all three forms [Stream A]
`LogNutritionForm` does NOT currently show a success confirmation — it only resets silently (confirmed in `LogNutritionForm.tsx:39`). The hook introduces the 1500ms success flash as new behavior. REQ-A4 (refactor `LogNutritionForm`) is therefore adding new capability, not merely extracting existing behavior. No regression risk — just confirm `mealType` resets correctly via `opts.onSuccess` callback: pass `onSuccess: () => setMealType(defaultMeal())`.

### RISK-3 — `ThemeToggle` has zero props [Stream B]
`ThemeToggle` exported as `export function ThemeToggle()` — no props, no `label`, no `className`. Stream B must NOT add props. The `MoreSheet` theme row wraps `<ThemeToggle />` in a flex layout row that provides the label externally. This is already specified in the `MoreSheet` props section above.

### RISK-4 — `latestWeight` not pre-filled in Log sheet [Stream B]
Confirmed decision (§3): weight input in the Log sheet starts empty. This is intentional and the simplest correct path. Do not add data-fetching to `BottomNav`. Do not add a server action to fetch the latest weight. Do not pass `latestWeight` from `layout.tsx`.

### RISK-5 — Duplicate `ThemeToggle` in header + More sheet [B/D — no action]
`AppHeader` renders `<ThemeToggle />`. After Stream B, `MoreSheet` will also render `<ThemeToggle />`. This is acceptable duplication per PRD (it does not say to remove the header toggle). Leave `AppHeader` unchanged. If Gabe wants to remove the header toggle, that is a follow-on task.

### RISK-6 — `logNote` missing `/journal` revalidation [Stream A]
Fixed in A7. After A7 lands, logging a note via the Log sheet will correctly refresh the Journal page.

### RISK-7 — `logMeasurement` missing `/stats` and `/progress` revalidation [Stream A]
Fixed in A7. After A7 lands, a weigh-in will correctly refresh the readiness score on both `/stats` and `/progress`.

### RISK-8 — Baseline-only day ≠ rest day [Stream D]
A day where `workoutTemplate !== null` but `dayBlocks.length === 0` (all blocks filtered as baseline-only) is a **test day**, not a rest day. Stream D must use `dayTemplate === null` as the rest-day condition, NOT `dayBlocks.length === 0`. The `dayBlocks` check is only valid for deciding whether to render the block list. Rest day = `!isCompleted && dayTemplate === null`.

### RISK-9 — `dateKey(now)` must NOT be recomputed in the client island [Stream D]
`process.env.USER_TZ` is `undefined` in the browser. `dateKey()` would fall back to `"America/Denver"` by accident, which happens to be correct — but only by accident, and it would break for users in other timezones. The server computes `dateKey(now)` via `resolved.dateKey` (already on `ResolvedDay`) and passes it as a prop to `TodayCelebration`. `TodayCelebration` must accept it as a prop and never call `dateKey` itself.

### RISK-10 — `bullseye-pop` container must allow overflow [Stream D]
`globals.css` animates `transform: scale(1.08)` at 60%. If the immediate parent of `<TodayCelebration>` (or the Bullseye within it) has `overflow: hidden`, the scale will clip. The container in `page.tsx` that holds `TodayCelebration` must use `overflow: visible` (or have no overflow constraint). Check the hero header's `className` — do not apply `overflow-hidden` to the hero card or the Bullseye wrapper.

### RISK-11 — `NutritionToday` import not affected by `showLogForm={false}` [Stream D]
Confirmed non-issue: `NutritionToday` imports `LogNutritionForm` at the top of the file regardless of `showLogForm`. This is a static import and does not cause runtime problems. `showLogForm={false}` suppresses the rendered form, which is all that is needed.

### Developer pitfalls checklist
- [ ] Do NOT use `reset` in `error.tsx` — use `unstable_retry`.
- [ ] Do NOT call `dateKey(new Date())` inside `TodayCelebration` — use the `dateKey` prop.
- [ ] Do NOT use `ctx.day` for the workout content in `page.tsx` — use `resolved.workoutTemplate` (override-aware).
- [ ] Do NOT use `setHours`/`getDate`/`getMonth` anywhere in changed code — use `@/lib/calendar` helpers.
- [ ] Do NOT copy `baselines/page.tsx`'s Tailwind color names for status pills in `RecordsSummary` — use CSS tokens.
- [ ] Do NOT add props to `ThemeToggle` — wrap it externally in `MoreSheet`.
- [ ] Do NOT add `getBaselineSchedule` or readiness imports to `page.tsx` or `BottomNav` — those belong to Stream C and Stream A respectively.
- [ ] Do NOT modify `layout.tsx` — sheets live in `BottomNav`, not the layout.
- [ ] Do NOT add `export const dynamic = "force-dynamic"` to files that don't need it (only `/progress/page.tsx` and the existing `page.tsx` require it; `loading.tsx`/`error.tsx` do not).

---

## 10. QA Gates (per quality-tools.md)

After all streams are merged into `feature/ux-overhaul`:

```bash
npx tsc --noEmit          # 0 errors
npm run lint              # no new errors
npm run build             # Turbopack production build succeeds
```

Then browser smoke at 390px:
1. Nav: Today/Plan/Progress navigate; Log + More open/close (backdrop tap, Esc, focus returns to trigger button).
2. Log sheet: log weight → `--success` line + reset; log note → `--success` + reset; log meal → success; Import → `/import`.
3. More sheet: Coach/Nutrition/History/Journal all navigate; Theme toggle works.
4. Today: hero renders with override-aware workout; Completed/Planned/Rest-day states; pop fires once on first post-completion visit; reload = no pop.
5. Progress: readiness + weight + records render at 390px; deep links to `/baselines/...` work; `/stats` + `/baselines` still load.
6. Reduced-motion: enable OS setting → sheets instant; bullseye-pop suppressed.
7. `grep -n 'plan snapshot is malformed' src/app/page.tsx` → no results.
8. `grep -n 'setHours\|getDate()\|getMonth()\|getFullYear\|getHours' src/app src/components` → no new violations in changed files.

---

## 11. File-Count Summary

| Stream | Creates | Modifies | Total |
|--------|---------|----------|-------|
| A | 3 (`use-form-feedback.ts`, `loading.tsx`, `error.tsx`) | 5 (`LogMeasurementForm`, `LogNoteForm`, `LogNutritionForm`, `stats/page.tsx`, `workout-actions.ts`) | 8 |
| B | 4 (`BottomSheet.tsx`, `LogLauncher.tsx`, `MoreSheet.tsx`, `progress/loading.tsx`) | 1 (`BottomNav.tsx`) | 5 |
| C | 2 (`RecordsSummary.tsx`, `progress/page.tsx`) | 0 | 2 |
| D | 1 (`TodayCelebration.tsx`) | 1 (`page.tsx`) | 2 |
| **Total** | **10** | **7** | **17** |
