# Goaldmine Rebrand — Research Output

Source PRD: `docs/prds/PRD-goaldmine-rebrand.md`
UX research: `docs/ux-research/goaldmine-rebrand.md`
Atomic REQs: `.feature-dev/2026-05-05-goaldmine-rebrand/phases/requirements.md`

This is a complete map of the codebase surfaces touched by the rebrand, with file:line citations the Architect and Developer Agents can use as their checklist.

---

## 1. Token-consumer inventory

Run command (per PRD §8): `grep -rn "var(--accent)\|var(--background)\|var(--card)\|var(--border)\|var(--muted)\|var(--foreground)\|var(--accent-fg)" src/ --include='*.tsx' --include='*.ts' --include='*.css'`

**Files using existing tokens** (39 files; counts by file from grep):

### Definition site
- `src/app/globals.css:3-35` — defines `--background, --foreground, --muted, --card, --border, --accent, --accent-fg` in `:root` + `prefers-color-scheme: dark` block; `@theme inline` (lines 13-23) maps each to a Tailwind `--color-*` and exposes `--font-sans`/`--font-mono`. **No `--target / --success / --warning / --danger / --accent-soft` tokens exist yet.**

### Components (heavy consumers)
| File | Hits | Tokens used most |
|------|------|------------------|
| `src/components/PlanOverview.tsx` | 18 | `--accent`, `--muted`, `--border` |
| `src/components/SnapshotView.tsx` | 16 | `--muted`, `--border` |
| `src/components/GoalReferences.tsx` | 13 | `--muted`, `--border`, `--accent`, `--accent-fg` |
| `src/components/PlanChangelog.tsx` | 12 | `--muted`, `--accent`, `--border`, `--background` |
| `src/components/GoalEditForm.tsx` | 11 | `--border`, `--accent`, `--muted` |
| `src/components/ReadinessChart.tsx` | 10 | `--accent`, `--border`, `--muted`, `--card` |
| `src/components/CalendarMonth.tsx` | 9 | `--border`, `--card`, `--accent`, `--muted`, `--background` |
| `src/components/LogBaselineForm.tsx` | 8 | `--border`, `--accent`, `--accent-fg` |
| `src/components/GoalCreateForm.tsx` | 7 | `--border`, `--accent`, `--accent-fg` |
| `src/components/HistoryChart.tsx` | 6 | `--accent`, `--border`, `--muted` |
| `src/components/EditBaselineForm.tsx` | 6 | `--border`, `--accent` |
| `src/components/PendingNotes.tsx` | 6 | `--accent`, `--muted`, `--border` |
| `src/components/WeightChart.tsx` | 6 | `--accent`, `--border`, `--muted`, `--card` |
| `src/components/DayOverrideForm.tsx` | 5 | `--border`, `--accent`, `--accent-fg` |
| `src/components/EditNutritionForm.tsx` | 5 | `--border`, `--accent`, `--accent-fg` |
| `src/components/ReadinessBreakdown.tsx` | 5 | `--muted`, `--border`, `--accent` |
| `src/components/ReviseForm.tsx` | 5 | `--border`, `--accent`, `--accent-fg` |
| `src/components/ShareWorkout.tsx` | 5 | `--border`, `--accent`, `--accent-fg`, `--muted` |
| `src/components/BaselineBlockCard.tsx` | 4 | `--muted`, `--accent`, `--accent-fg` |
| `src/components/LogMeasurementForm.tsx` | 4 | `--border`, `--accent`, `--accent-fg` |
| `src/components/LogNoteForm.tsx` | 4 | `--border`, `--accent`, `--accent-fg` |
| `src/components/LogNutritionForm.tsx` | 4 | `--border`, `--accent`, `--accent-fg` |
| `src/components/DayNoteForm.tsx` | 3 | `--border`, `--accent`, `--accent-fg` |
| `src/components/NutritionToday.tsx` | 3 | `--muted`, `--accent`, `--border` |
| `src/components/BottomNav.tsx` | 2 | `--border`, `--card`, `--accent`, `--muted` |
| `src/components/CopyPromptButton.tsx` | 1 | `--muted` |
| `src/components/Card.tsx` | 1 | `--border`, `--card` |
| `src/components/ImportForm.tsx` | 2 | `--border`, `--accent-fg` |
| `src/components/LogBaselineInlineForm.tsx` | 2 | `--border`, `--accent`, `--accent-fg` |

### App routes (consumers)
| File | Hits |
|------|------|
| `src/app/baselines/page.tsx` | 19 |
| `src/app/stats/page.tsx` | 12 |
| `src/app/calendar/page.tsx` | 11 |
| `src/app/history/page.tsx` | 7 |
| `src/app/nutrition/page.tsx` | 7 |
| `src/app/journal/page.tsx` | 5 |
| `src/app/goals/page.tsx` | 5 |
| `src/app/coach/page.tsx` | 4 |
| `src/app/import/page.tsx` | 2 |
| `src/app/page.tsx` | (heavy — see preview file; ~25 hits across the file) |

**Conclusion**: Palette swap in `globals.css` (REQ-A1) propagates to every consumer file automatically. No file needs to be touched purely for token-name plumbing — only the new tokens `--target / --success / --warning / --danger / --accent-soft` need consumers (added explicitly via REQ-A3 + REQ-D1..D4).

---

## 2. Hardcoded color migration list (REQ-A3 checklist)

Per UX Appendix B migration table:
- `text-red-500` → `text-[var(--danger)]`
- `bg-red-500/10` → `bg-[var(--danger)]/10`
- `border-red-500/30` → `border-[var(--danger)]/30`
- `border-red-500/40` → `border-[var(--danger)]/40`
- `text-amber-500` → `text-[var(--warning)]`
- `border-amber-500/40` → `border-[var(--warning)]/40`
- `border-amber-500/50` → `border-[var(--warning)]/50`
- `bg-amber-500/5` → `bg-[var(--warning)]/5`
- `text-emerald-500` → `text-[var(--success)]` (UNLESS being replaced by `<Bullseye filled />` — see notes)
- `border-emerald-500/40` → `border-[var(--success)]/40`
- `bg-emerald-500/5` → `bg-[var(--success)]/5`

No `text-blue-*` / `bg-blue-*` / `border-blue-*` matches were found in `src/`. (Grep returned zero — the blue brand only lives as the hex `#2563eb` / `#60a5fa` inside `globals.css`, killed by REQ-A1.)

### Migration table by file

| File | Line | Current | Replacement | Notes |
|------|-----:|---------|-------------|-------|
| `src/app/calendar/page.tsx` | 65 | `<span className="text-emerald-500">✓</span>` | `text-[var(--success)]` | Legend item; keep glyph (legend explains the calendar — bullseye is for the cells) |
| `src/app/calendar/page.tsx` | 66 | `<span className="text-amber-500">★</span>` | `text-[var(--warning)]` | Legend item |
| `src/app/goals/page.tsx` | 60 | `border-red-500/40 text-red-500` | `border-[var(--danger)]/40 text-[var(--danger)]` | Goal "days remaining" badge — overdue state |
| `src/app/goals/page.tsx` | 62 | `border-amber-500/40 text-amber-500` | `border-[var(--warning)]/40 text-[var(--warning)]` | "≤14 days remaining" badge |
| `src/app/goals/[id]/revisions/[revisionId]/page.tsx` | 125 | `status === "changed" ? "text-amber-500" : "text-[var(--muted)]"` | `text-[var(--warning)]` | Diff "changed" highlight |
| `src/app/baselines/page.tsx` | 178 | `border-emerald-500/40 text-emerald-500` | `border-[var(--success)]/40 text-[var(--success)]` | Baseline row "improved" status |
| `src/app/baselines/page.tsx` | 180 | `border-amber-500/40 text-amber-500` | `border-[var(--warning)]/40 text-[var(--warning)]` | "Stale/missed" status |
| `src/app/baselines/page.tsx` | 182 | `border-red-500/40 text-red-500` | `border-[var(--danger)]/40 text-[var(--danger)]` | "Regressed" status |
| `src/app/baselines/page.tsx` | 195 | `return "text-emerald-500";` | `text-[var(--success)]` | Status accent helper |
| `src/app/baselines/page.tsx` | 197 | `return "text-amber-500";` | `text-[var(--warning)]` | |
| `src/app/baselines/page.tsx` | 199 | `return "text-red-500";` | `text-[var(--danger)]` | |
| `src/app/days/[dateKey]/page.tsx` | 44 | `<span className="text-amber-500"> · custom override</span>` | `text-[var(--warning)]` | Override badge |
| `src/app/goals/[id]/plan/page.tsx` | 359 | `return "text-emerald-500";` | `text-[var(--success)]` | Plan-status helper |
| `src/app/goals/[id]/plan/page.tsx` | 361 | `return "text-amber-500";` | `text-[var(--warning)]` | |
| `src/app/goals/[id]/plan/page.tsx` | 363 | `return "text-red-500";` | `text-[var(--danger)]` | |
| `src/components/LogBaselineForm.tsx` | 129 | `text-sm text-red-500 border border-red-500/30 bg-red-500/10` | `text-[var(--danger)] border-[var(--danger)]/30 bg-[var(--danger)]/10` | Error block (canonical pattern, repeated in 8+ forms) |
| `src/components/PlanChangelog.tsx` | 78 | `border-amber-500/40 text-amber-500` | `border-[var(--warning)]/40 text-[var(--warning)]` | Changelog `note` badge in `badgeClass()` |
| `src/components/ReviseForm.tsx` | 73 | `text-sm text-red-500 border border-red-500/30 bg-red-500/10` | (canonical danger block) | |
| `src/components/DayNoteForm.tsx` | 54 | `text-sm text-red-500 border border-red-500/30 bg-red-500/10` | (canonical danger block) | |
| `src/components/GoalReferences.tsx` | 67 | `text-xs text-[var(--muted)] hover:text-red-500 px-2` | `hover:text-[var(--danger)]` | Delete-row hover affordance |
| `src/components/GoalReferences.tsx` | 128 | `text-xs text-red-500 border border-red-500/30 bg-red-500/10` | (canonical danger block) | |
| `src/components/GoalEditForm.tsx` | 154 | `text-sm text-red-500 border border-red-500/30 bg-red-500/10` | (canonical danger block) | |
| `src/components/GoalEditForm.tsx` | 182 | `rounded-lg border border-red-500/40 text-red-500 px-3 py-2` | `border-[var(--danger)]/40 text-[var(--danger)]` | Destructive button |
| `src/components/SnapshotView.tsx` | 55 | `border-amber-500/50 bg-amber-500/5` | `border-[var(--warning)]/50 bg-[var(--warning)]/5` | Highlighted day in weekly-split |
| `src/components/DayOverrideForm.tsx` | 76 | (canonical danger block) | (canonical) | |
| `src/components/DayOverrideForm.tsx` | 103 | `rounded-lg border border-red-500/40 text-red-500` | (destructive btn) | |
| `src/components/LogBaselineInlineForm.tsx` | 51 | `text-xs text-red-500` | `text-[var(--danger)]` | Inline-form short error |
| `src/components/ImportForm.tsx` | 35 | (canonical danger block) | | |
| `src/components/CalendarMonth.tsx` | 40 | `border-emerald-500/40 bg-emerald-500/5` | **DELETE** (UX §4: drop emerald tone, bullseye carries the signal) | REQ-D2 — see §4 below |
| `src/components/CalendarMonth.tsx` | 42 | `border-amber-500/50 bg-amber-500/5` | `border-[var(--warning)]/50 bg-[var(--warning)]/5` | Override cell tone |
| `src/components/CalendarMonth.tsx` | 61 | `<span className="text-emerald-500">✓</span>` | **REPLACE** with `<Bullseye filled size={10} />` (REQ-D2) | |
| `src/components/CalendarMonth.tsx` | 62 | `text-amber-500` on `★` | `text-[var(--warning)]` | |
| `src/components/EditBaselineForm.tsx` | 83 | (canonical danger block) | | |
| `src/components/EditBaselineForm.tsx` | 110 | (destructive btn) | | |
| `src/components/EditNutritionForm.tsx` | 88 | (canonical danger block) | | |
| `src/components/EditNutritionForm.tsx` | 115 | (destructive btn) | | |
| `src/components/GoalCreateForm.tsx` | 94 | (canonical danger block) | | |
| `src/components/CopyPromptButton.tsx` | 17 | `border-emerald-500/40 text-emerald-500` | `border-[var(--success)]/40 text-[var(--success)]` | Copy-success state |
| `src/components/BaselineBlockCard.tsx` | 39 | `<span className="text-emerald-500 mr-1">✓</span>` | **REPLACE** with `<Bullseye filled size={14} />` (REQ-D1) | |
| `src/components/BaselineBlockCard.tsx` | 46 | `text-xs font-mono tabular-nums text-emerald-500` | `text-[var(--success)]` (numeric value of logged test) | |
| `src/components/LogNutritionForm.tsx` | 73 | `text-xs text-red-500` | `text-[var(--danger)]` | Inline error |

**Total occurrences**: ~36 hardcoded color sites across 23 files. Once REQ-D1 (BaselineBlockCard) and REQ-D2 (CalendarMonth) replace ✓ glyphs with `<Bullseye />`, the migration grep should return 0.

---

## 3. Component import + render-pattern map

### Card (`src/components/Card.tsx`)
- **Export**: named `export function Card(...)`. Server component (no `"use client"`).
- **Props**: `title?: string`, `action?: ReactNode`, `children: ReactNode`, `className?: string`.
- **Usage**: imported as `import { Card } from "@/components/Card";` — every page that wants a labeled section.
- **In-component styling**: only `var(--border)`, `var(--card)`. No raw color literals. No changes needed for rebrand — automatic via token swap.

### BottomNav (`src/components/BottomNav.tsx`)
- **Export**: named `export function BottomNav()`. **Client component** (`"use client"` line 1) — uses `usePathname()`.
- **Usage**: imported once in `src/app/layout.tsx:3`, rendered at the bottom of `<body>` after `<main>`.
- **Tokens used**: `var(--border)`, `var(--card)` (line 26), `var(--accent)` / `var(--muted)` (lines 34-35) for active/inactive label color.
- **Layout**: `position: fixed bottom-0`, `grid-cols-5`, `max-w-md mx-auto`. **Fixed (not sticky)** — confirmed; AppHeader sticky-top will not fight it.
- **REQ-D3 implication**: client component is fine — `<Bullseye>` is a server component but **server components are renderable as children of client components in Next.js App Router** as long as they're imported and passed in. However, the simpler path is to call `<Bullseye>` inline inside BottomNav (which works because Bullseye is just an SVG with no server-only APIs). Practically: `<Bullseye>` has no async / no DB calls / no `cookies()` / no `headers()` — it's safe to render from a client component as a child.

### CalendarMonth (`src/components/CalendarMonth.tsx`)
- **Export**: named `export function CalendarMonth(...)`. Server component (no `"use client"`).
- **Props**: `cells: CalendarDayCell[]`, `monthStart: Date`.
- **Usage**: imported by `src/app/calendar/page.tsx`. The page builds `cells` via `@/lib/calendar` then passes through.
- **Internal**: defines `DayCell` (private) — same file, same server context.
- **Hardcoded colors**: lines 40 (emerald tones), 42 (amber tones), 61 (emerald `✓`), 62 (amber `★`). All addressed in REQ-D2 / REQ-A3.
- **Tokens used**: `--border`, `--card`, `--accent`, `--muted`, `--background`.

### BaselineBlockCard (`src/components/BaselineBlockCard.tsx`)
- **Export**: named `export function BaselineBlockCard(...)`. Server component.
- **Props**: `index: number`, `tests: BaselineBlockTest[]`, `weekIndex?: number | null`. Also exports `BaselineBlockTest` type.
- **Usage**: imported by `src/app/page.tsx` (Today). Wraps a `<Card>` and renders `<LogBaselineInlineForm>` (client component) per row.
- **Hardcoded colors**: lines 39, 46 (`text-emerald-500`).
- **Hybrid pattern**: server component embeds a client form — works fine; no hydration concerns.

### Form components (all `*Form*.tsx`)
All are **client components** (`"use client"`):
- `LogBaselineForm.tsx`, `LogBaselineInlineForm.tsx`, `EditBaselineForm.tsx`
- `LogMeasurementForm.tsx`
- `LogNoteForm.tsx`, `DayNoteForm.tsx`
- `LogNutritionForm.tsx`, `EditNutritionForm.tsx`
- `ImportForm.tsx`
- `GoalCreateForm.tsx`, `GoalEditForm.tsx`
- `DayOverrideForm.tsx`
- `ReviseForm.tsx`
- (Note: `GoalReferences.tsx` is also `"use client"`)

Pattern: all use `"use client"` + `useState/useTransition` + a server action from `@/lib/workout-actions` or `@/lib/goal-actions`. Submit wrapped in `startTransition` with a try/catch that captures `e.message` into a local `error` state, rendered as the canonical `<p className="text-sm text-red-500 border border-red-500/30 bg-red-500/10 ...">` block.

**Bullseye renderable inside?** Yes — Bullseye is pure SVG with no server-only APIs. Safe to import into any of these files if needed.

### PlanChangelog, SnapshotView, PlanOverview
- All **server components**.
- `PlanChangelog.tsx` line 78 hardcoded amber (badgeClass for `"note"` source).
- `SnapshotView.tsx` line 55 hardcoded amber (highlight tone).
- `PlanOverview.tsx` — clean (uses tokens only).

### Hybrid client/server constraints to respect
- `BottomNav` is the only client component in the chrome — all top-level chrome (`AppHeader`, `Card`, `BaselineBlockCard`, `CalendarMonth`) is server.
- `<Bullseye>` and `<Logo>` are server components per UX Appendix A — they render inside both server (CalendarMonth, BaselineBlockCard, AppHeader, goals/page.tsx) and client (BottomNav) parents. This is **safe** because they are pure SVG with no async/server-only APIs. Next.js permits server components rendered from client trees only when they are passed *as props/children*; however, the cleaner pattern (and what's already used elsewhere in this repo) is: when a server component is "really just an SVG", it has no actual server-runtime behavior, so importing+rendering it inside a client tree compiles into a static client component. **No hydration issue expected** because the SVG markup is identical on server and client (no time, no random, no env).
- **Recommendation**: Architect should not over-engineer this. Build `<Bullseye>` and `<Logo>` as plain function components (no `"use client"` directive) — they will be tree-shaken into either bundle as needed. If TypeScript or Next.js complains in BottomNav, the developer can add `"use client"` to Bullseye.tsx as a fallback (it's still pure SVG).

---

## 4. CalendarMonth top-right stack analysis

File: `src/components/CalendarMonth.tsx`. Read in full, here are the exact lines.

### Current visual state on a day cell

- Cell wrapper: `<Link>` at lines 52-54 with `${baseClass} ${toneClass} ${goalClass} hover:border-[var(--accent)]`.
- Tone-class logic (lines 37-42):
  - line 37: default `border-[var(--border)] bg-[var(--card)]`
  - line 38: not in month → `border-transparent bg-transparent text-[var(--muted)]/60`
  - line 39: today → `border-[var(--accent)] bg-[var(--accent)]/10`
  - **line 40: `isCompleted && cell.isPast` → `"border-emerald-500/40 bg-emerald-500/5"`** ← UX §4 says drop this
  - line 41: past + in plan + not completed → `border-[var(--border)] bg-[var(--background)] text-[var(--muted)]`
  - **line 42: `cell.hasOverride` → `"border-amber-500/50 bg-amber-500/5"`** ← REQ-A3 migrate to warning token

### Top-right stack (lines 59-68)

The top-right contents are all in a single `<div className="flex flex-col items-end gap-0.5">`:

```
59: <div className="flex flex-col items-end gap-0.5">
60:   {cell.isGoalDate && <span title="Goal date">🏔️</span>}
61:   {isCompleted && <span className="text-emerald-500">✓</span>}        ← REPLACE
62:   {cell.hasOverride && <span title="Custom day" className="text-amber-500">★</span>}
63:   {cell.baselinesDue > 0 && (
64:     <span title={`${cell.baselinesDue} baseline test(s)`} className="text-[var(--accent)] text-[10px]">
65:       ◎{cell.baselinesDue}
66:     </span>
67:   )}
68: </div>
```

**Confirmed**: all four glyphs live in the same JSX block, stacked vertically (`flex-col items-end gap-0.5`). UX §4 stack order recommendation `🏔 → ★ → ◉ → ◎N` matches the source order at lines 60→62→61→63 — **the developer should reorder to put the bullseye AFTER the override star** to match UX intent (final order: line 60 `🏔` → line 62 `★` → line 61 `◉` → line 63 `◎N`).

### Multi-workout day distinction (`workoutCount > 1`)

`isCompleted` (line 35): `cell.workoutCount > 0` — boolean, not graded. The current `text-emerald-500 ✓` does NOT distinguish 1 vs 2+ workouts. The `CalendarDayCell` type (from `@/lib/calendar`) carries `workoutCount: number`.

**UX §4 / PRD §3.1.9** uses a single filled bullseye regardless of count. Three options for the developer:
1. **Single bullseye, ignore count** (matches UX recommendation literally — simplest).
2. **Bullseye with `progress={Math.min(1, workoutCount/2)}`** — encodes count subtly (1 workout = ½ filled, 2 = full). Out of spec but easy.
3. **Bullseye + small numeric badge `×N` for `workoutCount > 1`** — explicit. Adds noise.

**Recommendation: Option 1.** UX explicitly says "filled bullseye carries 'completed' alone" without count. The user has the day-detail page for inspecting multiple workouts. Adding count signaling here forks the motif.

### What stays vs changes

| Element | Now | After rebrand |
|---|---|---|
| Day digit (line 58) | `<span>{day}</span>` | unchanged |
| Today border + bg (line 39) | `border-[var(--accent)] bg-[var(--accent)]/10` | unchanged (auto-updates via token swap) |
| Completed border/bg (line 40) | `border-emerald-500/40 bg-emerald-500/5` | **DELETE entirely** (UX §4 / REQ-D2) |
| Override border/bg (line 42) | `border-amber-500/50 bg-amber-500/5` | `border-[var(--warning)]/50 bg-[var(--warning)]/5` |
| Goal-date emoji (line 60) | `🏔️` | unchanged |
| Workout-completed glyph (line 61) | `text-emerald-500 ✓` | `<Bullseye filled size={10} aria-hidden="true" />` |
| Override star (line 62) | `text-amber-500 ★` | `text-[var(--warning)] ★` |
| Baselines-due (lines 63-67) | `text-[var(--accent)]` `◎N` | unchanged (auto-updates via token swap to gold) |
| Hover ring (line 54) | `hover:border-[var(--accent)]` | unchanged |

---

## 5. Goals page progress derivation

File: `src/app/goals/page.tsx`. Read in full.

### Available metadata per goal (from Prisma schema)

The query at lines 9-11 selects all `Goal` columns. Per `prisma/schema.prisma` `model Goal`:
- `id, objective, targetDate, notes, status, active, targets (Json?), references (Json?), createdAt, updatedAt`

The page-level computation (lines 41-43) derives only one number currently:
```ts
const days = Math.ceil(
  (new Date(g.targetDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
);
```

That's a **count of days remaining** — not a progress fraction. Used for the badge color tier on lines 60-62 (overdue / ≤14d / ≤default).

### Existing progress-like signals available

| Source | Type | Notes |
|--------|------|-------|
| `targetDate - createdAt` (time-elapsed) | Float 0..1 | Universal — every goal has both fields |
| `targets` JSON (per-target current vs target) | Float 0..1 per target | Schema comment says: `Array<{ metric, label, target, start?, weight, units, direction }>`. The page does NOT join measurement data, so we cannot compute metric progress without new queries — **forbidden** by REQ-D4. |
| `status` (`active`/`achieved`/`abandoned`) | String | Not numeric; useful as a hard cap (achieved = 1.0) |

The page DOES NOT currently expose any numeric progress — only `days remaining` as styled-badge text.

### Recommended formula (universal, single-pass, no new queries)

```ts
// Time-elapsed progress: 0 at creation, 1 at targetDate.
function goalProgress(g: { createdAt: Date; targetDate: Date; status: string }): number {
  if (g.status === "achieved") return 1;
  if (g.status === "abandoned") return 0;
  const total = new Date(g.targetDate).getTime() - new Date(g.createdAt).getTime();
  if (total <= 0) return 1; // already due / created after-the-fact
  const elapsed = Date.now() - new Date(g.createdAt).getTime();
  return Math.max(0, Math.min(1, elapsed / total));
}
```

**Why this**:
- Every goal has `createdAt` + `targetDate` — never null, no need to guard.
- Maps cleanly onto UX §2's ¼-step ring-fill model: 0% / 25% / 50% / 75% / 100%.
- Status overrides keep "achieved" goals visually full and "abandoned" hollow — semantic correctness.
- Zero new fetching — REQ-D4 requirement satisfied.
- Matches UX `<Bullseye progress={pct} size={20} />` — `pct` is a float 0..1 the helper returns directly.

**Caveat**: time-progress doesn't reflect *whether the user is on track*. A goal with 80% time elapsed and 0% effort still shows as 80% filled. The numeric label next to the bullseye (line 53 `targetDate.toLocaleDateString()` + line 66 `${days}d`) carries the precise context — the bullseye is a glance-level cue per UX §5.

**Recommendation**: ship time-progress in REQ-D4. If a richer metric-based progress is desired later, the helper can be enhanced (still single-pass) by reading `g.targets[]` JSON for goals that have it. Out of scope for this rebrand.

---

## 6. BaselineBlockCard rerender pattern

Files: `src/components/BaselineBlockCard.tsx`, `src/components/LogBaselineInlineForm.tsx`, `src/lib/workout-actions.ts`.

### Current success signal flow

1. User submits inline form → `startTransition(async () => { await logBaselineInline(fd); ... })` (form line 21-30).
2. `logBaselineInline()` (workout-actions:57-76) writes to DB and calls `revalidatePath("/")` + 4 other paths (line 71-75).
3. Server re-renders Today (`src/app/page.tsx`), which re-fetches baseline data and re-builds the `tests: BaselineBlockTest[]` prop where the just-logged test now has `loggedOnDate: { ... }`.
4. BaselineBlockCard re-renders the row showing the `text-emerald-500 ✓` glyph (line 39) + the logged value (line 46).
5. The form's local `formRef.current?.reset()` (line 25) clears the input. No client state survives the revalidation.

**No optimistic UI, no client-side log buffer.** Everything routes through a server-action revalidate cycle.

### Plumbing `justLogged` to the card

The challenge for the bullseye-pop animation: the card needs to know "this row was logged in the last ~500ms" to apply the animation class. The current data path has no notion of recency:
- `loggedOnDate.date` is set to `new Date()` at server-action time (workout-actions:67).
- After `revalidatePath`, the server-rendered card gets the fresh `Date`. The card could compare `Date.now() - loggedOnDate.date.getTime() < 5000` and apply the class — but this introduces a stale-render hazard (the SSR'd page will look animated to anyone arriving within 5s).

**Cleaner option**: have `LogBaselineInlineForm` (already client) navigate-replace the URL with a fragment `#just-logged=<testName>` after a successful action, and have an effect in BaselineBlockCard read that fragment. But BaselineBlockCard is a server component — reading a fragment requires conversion to a client component or a small client wrapper.

**Realistic plumbing options**:

| Option | Approach | Cost |
|---|---|---|
| A. Drop the animation | Ship without bullseye-pop | None. UX flagged it as stretch. |
| B. Server-side recency window | `BaselineBlockCard` does `const isJustLogged = loggedOnDate && Date.now() - loggedOnDate.date.getTime() < 3000;` and conditionally applies class | Wrong: SSR caches re-renders look animated to drive-bys. Fragile. |
| C. Client wrapper around the row | New tiny client component `<BaselineRowAnimated row={...} />` that wraps the bullseye + uses `useEffect` + a sessionStorage key set by the form on success | Adds a client component to a hot path. ~30 lines. Workable. |
| D. URL-fragment signal | Form pushes `?justLogged=<testName>` after success (router.replace, no nav); page reads from `searchParams` and passes `justLoggedTestName` down | Cleanest. ~10 lines in form, ~5 in page, ~3 in card. Server-component-friendly. |

### Recommendation

**Drop the animation for the MVP rebrand (Option A).** Rationale:
- UX §9 explicitly classifies it as stretch ("if the wiring proves invasive, ship without").
- The current data path has no built-in "recency" signal; every cleaner option requires either (a) a new client wrapper component or (b) URL-state plumbing through the form + page + card. Both are net-new code paths in a feature that's supposed to be "no functional changes".
- The CSS keyframe (`@keyframes bullseye-pop` in `globals.css`) is cheap and harmless to ship. Add it. If iteration 2 of the rebrand wants the animation, Option D (URL fragment) becomes the recommended plumbing path.
- **Ship just the keyframe + reduced-motion gate** in `globals.css` so future agents have it ready. Skip the React plumbing.

---

## 7. PWA icon generation feasibility

### Native deps

`@resvg/resvg-js` and `sharp` both ship native bindings. On macOS arm64 (this dev box) and on Vercel build infra, both have prebuilt binaries via npm `optionalDependencies` — install is a single `npm install --save-dev`. No `node-gyp` toolchain needed.

`@resvg/resvg-js`:
- Pure rust SVG renderer, smaller dep (~2MB), no Cairo/system deps.
- Works at install with prebuilt binaries for macOS arm64 / x64, Linux x64 / arm64, Windows x64.
- Used at build-time only (devDependency); never imported at runtime.

`sharp`:
- Larger (libvips bindings, ~30MB on disk), broader API (rasterize, resize, color space).
- Same prebuilt-binary story; reliably installs on macOS + Vercel.
- More versatile but overkill for "render an SVG to two PNGs once".

**Both work.** `@resvg/resvg-js` is the lighter-weight pick.

### Quality difference at install time

iOS Safari PWA installs:
- iOS 12.2+ supports SVG `<link rel="icon">` for browser tabs.
- iOS home-screen install ("Add to Home Screen") **prefers PNG `apple-touch-icon`** in the 180×180 / 192×192 / 512×512 range. SVG icons in `manifest.icons` are honored by Safari iOS 16.4+ via the Web App Manifest spec — but on older iOS versions, an SVG-only manifest may rasterize at low resolution or fall back to a screenshot of the page.
- The user mentions iPhone testing in §10.3 of PRD. Real-world: **iOS prefers PNG**. Crisp 192×192 + 512×512 PNGs from a 64-unit SVG → upscales to 192/512 with no aliasing because the source is procedural geometry (circles + trapezoids, no fine raster detail).

Quality difference:
- SVG-only on iOS 16.3 and older → low-res rasterization or fallback.
- SVG-only on iOS 16.4+ / modern Android → fine.
- PNG (rendered offline from SVG) → consistent crisp render on every platform.

### Recommendation

**Option (a): ship `scripts/render-icons.ts` + `@resvg/resvg-js` as devDependency + commit generated PNGs.**

Rationale:
1. The user installs to iPhone (PRD §10.3) — iOS install quality matters.
2. The `<Logo>` SVG is procedural geometry (circles, trapezoid, keyhole) — rasterizes cleanly at any size.
3. `@resvg/resvg-js` install is clean on macOS arm64 (this dev machine) and Vercel; no toolchain risk.
4. The script runs once, locally, by the developer. Never runs in CI or runtime; zero serverless impact.
5. Committed PNGs are immutable, reviewable, and trivially diffable.
6. SVG-only fallback (option b) is acceptable per PRD §3.1.12 but introduces install-quality variance on older iOS — avoidable risk.

**Implementation note for Architect**: `scripts/render-icons.ts` reads `public/icon.svg`, renders to 192×192 and 512×512 buffers via `@resvg/resvg-js`, writes to `public/icon-192.png` and `public/icon-512.png`. Add an npm script entry like `"icons": "tsx scripts/render-icons.ts"` for repeatability. Document in PR.

---

## 8. Tailwind v4 token gotchas

### Alpha modifier on CSS-variable arbitrary values

Tailwind v4 supports the `bg-[var(--token)]/<alpha>` syntax — confirmed in the existing codebase usage at `src/components/CalendarMonth.tsx:39` (`bg-[var(--accent)]/10`) and many form components (`bg-[var(--accent-fg)]` etc.). v4 parses the slash-alpha out of arbitrary values when the value resolves to a color.

**Caveat**: this works because the underlying CSS variable resolves to a hex/rgb color at runtime. v4's color parser doesn't evaluate `var(--x)` at build time — it generates `color-mix(in srgb, var(--x) <alpha>%, transparent)` (or the equivalent runtime function). This is **modern-browser only** (`color-mix` is Safari 16.2+, Chrome 111+). On the user's iPhone-class device this is fine.

**Verdict**: `bg-[var(--accent-soft)]/14` works. So does `bg-[var(--danger)]/10`, `border-[var(--warning)]/40`, etc.

### Whether we need `--danger-soft` etc.

We do NOT need explicit `--danger-soft` / `--warning-soft` tokens. The alpha modifier on the base token works:

```css
bg-[var(--danger)]/10        /* canonical danger-block bg */
border-[var(--danger)]/30    /* canonical danger-block border */
text-[var(--warning)]        /* solid warning text */
border-[var(--warning)]/40   /* warning badge border */
```

`--accent-soft` is special: PRD §4.4 + UX §6 define it as a pre-baked rgba (e.g., `rgba(212,164,55,0.12)` dark / `rgba(138,98,18,0.14)` light). Reason: the soft accent appears in `bg-[var(--accent-soft)]` (today's calendar cell tint) and the alpha values differ between modes. Keeping it as its own token lets light + dark each ship their own pre-baked alpha. (In contrast, `--danger`/30 has the same 30% alpha on both modes, so no separate token needed.)

### `@theme inline` block additions

`globals.css` line 13-23 has the existing `@theme inline` block. To expose new tokens to Tailwind utilities (so `bg-target`, `text-success`, etc. work as bare classes), the developer would add:

```css
@theme inline {
  --color-target: var(--target);
  --color-target-fg: var(--target-fg);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-danger: var(--danger);
  --color-accent-soft: var(--accent-soft);
  --font-display: var(--font-dm-serif-display);  /* see REQ-A2 */
}
```

**However**, the rebrand's chosen pattern (UX Appendix B migration table) uses the **arbitrary-value syntax** (`text-[var(--danger)]`) — not the bare-class syntax. The arbitrary-value syntax works **without** a `@theme` entry: it reads `var(--danger)` directly as a CSS value. So we can ship without expanding `@theme inline` if we stick to arbitrary values consistently.

**Recommendation**: Ship with arbitrary-value syntax (matches the existing pattern in this repo, e.g., `text-[var(--accent)]`) and DO NOT add new `@theme inline` entries for the semantic tokens. Keep `--font-display: var(--font-dm-serif-display)` mapping in `@theme inline` because that's the only way to get the `font-display` utility class to work cleanly (Tailwind v4 reads font-family from `@theme`'s `--font-*` variables).

### Single declaration of `@theme inline`

`globals.css` declares `@theme inline` once (at the top level). Tailwind v4 honors a single block for theme generation; nested re-declarations under `@media` are NOT how palette flips work. The light-mode-default vs dark-mode flip is done via `:root` + `@media (prefers-color-scheme: dark) { :root { ... } }` (lines 25-35) overriding the underlying CSS variables. `@theme inline` references `var(--background)` etc. — so the Tailwind utilities resolve to whatever the active `:root` defines. **The current pattern works for the rebrand without changes.**

---

## 9. AppHeader integration

### Current layout structure

`src/app/layout.tsx`:
- Line 35-38: `<html lang="en" className="${geistSans.variable} ${geistMono.variable} h-full antialiased">`.
- Line 39: `<body className="min-h-full flex flex-col bg-background text-foreground">` — flex column container.
- Line 40: `<main className="flex-1 pb-20">{children}</main>` — flex-grows to fill, bottom-padded 80px to clear fixed BottomNav.
- Line 41: `<BottomNav />` — `position: fixed bottom-0` per BottomNav.tsx:26.

### AppHeader sticky implications

UX Appendix A recommends:
```jsx
<header className="sticky top-0 z-30 bg-[var(--background)]/95 backdrop-blur border-b border-[var(--border)]">
  <div className="max-w-md mx-auto h-12 flex items-center px-4 gap-2">...</div>
</header>
```

**Sticky vs fixed**:
- Sticky elements participate in flow — they take vertical space from `<main>`. The 48px header pushes content down naturally.
- Fixed elements don't take flow space — page content sits underneath unless padded (BottomNav does this with `pb-20` on main).

**Therefore**: AppHeader is `sticky top-0` → it consumes 48px of `<main>`'s scroll-from-top. **No `pt-12` needed on `<main>`** — sticky elements occupy their natural flow position before sticking. The page content immediately below the header sits 48px down without any padding adjustment.

If the developer chose `fixed` instead of `sticky`, then yes, a `pt-12` on `<main>` would be required. **Sticky is the right choice and the UX recommendation.**

### Flex-layout edge case

`<body className="min-h-full flex flex-col">` + `<main className="flex-1 pb-20">`:
- AppHeader sits ABOVE `<main>` in the flex column.
- AppHeader's `sticky top-0` position works because `<body>` is a flex container with `min-h-full` — sticky positioning needs a scrolling ancestor, and the document body / html scrolls.
- `<main>`'s `flex-1` means it grows to fill remaining space — unchanged. The header takes 48px from the top before the flex calculation; main fills the rest minus 80px bottom padding.

**No edge case**. The existing flex layout accommodates a sticky-top header without modification.

### BottomNav fight check

BottomNav is `position: fixed` (line 26 of BottomNav.tsx). AppHeader is `position: sticky`. **They don't fight** — fixed and sticky use different positioning models. Confirmed.

### REQ-C1 changes summary

In `src/app/layout.tsx`:
1. Line 17: `title: "Workout Planner"` → `title: "Goaldmine"`.
2. Line 18: description → mining-themed line.
3. Line 23: `themeColor: "#0a0a0a"` → new dark `--background` hex `"#0F0B07"`.
4. After line 2 imports: add `import { AppHeader } from "@/components/AppHeader";` and the DM Serif Display font import.
5. Line 37 className: append `${dmSerifDisplay.variable}`.
6. Line 39 `<body>`: insert `<AppHeader />` BEFORE `<main>`.

---

## 10. Risk register

### Risk 1 — Worktree merge conflicts in `globals.css`
REQ-A1 (Stream A: palette) and REQ-A2 (Stream A: font wiring) both touch `globals.css`. Stream E (`bullseye-pop` keyframes if shipped) also touches it. **Mitigation**: assign all `globals.css` edits to a single agent (Agent 1, REQ-A1 + REQ-A2) and have the keyframe block added in the same PR. Sequential, not parallel.

### Risk 2 — `next/font/google` build-time fetch with no cache
DM_Serif_Display is fetched at build time by `next/font/google`. If the build runs offline (no internet) or Google Fonts is briefly unavailable, the build fails. **Mitigation**: Vercel build env has internet; local dev caches in `.next/cache/`. Architect should commit the `.next/cache/fonts` directory NOT — these are gitignored — but acknowledge the build-time dependency. Fallback declared in UX §7 (Playfair Display swap).

### Risk 3 — `prefers-color-scheme` flip not picking up new tokens
`globals.css:25-35` defines the dark-mode `:root` overrides. If the developer adds new tokens to the light `:root` (lines 3-11) but forgets to add them to the dark block, `prefers-color-scheme: dark` falls back to the light values for the missing tokens. **Mitigation**: REQ-A1 acceptance must explicitly require all new tokens (`--target / --target-fg / --success / --warning / --danger / --accent-soft`) appear in BOTH `:root` blocks. Architect: include in REQ-A1 sub-checklist.

### Risk 4 — `text-emerald-500` used for non-success semantics
Sweep results show emerald is exclusively used for "logged/improved/copy-success" states:
- `BaselineBlockCard.tsx:39, 46` → logged-baseline (success — but being replaced by Bullseye, REQ-D1)
- `CalendarMonth.tsx:40, 61` → completed day (success — being replaced by Bullseye, REQ-D2)
- `app/baselines/page.tsx:178, 195` → improved status (success)
- `app/goals/[id]/plan/page.tsx:359` → on-track plan (success)
- `app/calendar/page.tsx:65` → legend "✓ workout logged" (success)
- `CopyPromptButton.tsx:17` → "copied!" feedback (success)

**Verdict: zero false-positives — every emerald site is genuinely success-coded.** Migration to `--success` is semantically correct everywhere. No nuance needed.

### Risk 5 — `text-red-500` used for genuinely-non-error semantics
- `GoalReferences.tsx:67` — `hover:text-red-500` on a delete button (destructive, not an error). Migrate to `hover:text-[var(--danger)]` — `--danger` token is the right hue (PRD §4.1 unifies `--danger` with `--target` red).
- All other `text-red-500` uses are error blocks or destructive buttons.

**Verdict: zero false-positives.** All red sites are danger/destructive — semantically correct migration.

### Risk 6 — `text-amber-500` used for non-warning semantics
- All amber sites flag override-days, "stale" baselines, "≤14 days left" goals, or "changed" diff highlights.
- All semantically warning-coded. Zero false-positives.

### Risk 7 — Hidden hardcoded colors in chart components
`WeightChart.tsx`, `ReadinessChart.tsx`, `HistoryChart.tsx`: read in full — they all use `var(--accent)`, `var(--border)`, `var(--muted)`, `var(--card)` only. **No raw hex literals.** REQ-E3 verification will confirm visually but no code change expected. Charts auto-update via REQ-A1 token swap.

### Risk 8 — `<Bullseye>` rendering inside client BottomNav
Discussed in §3 above. SVG components without server-only APIs are safe. **No expected hydration mismatch** since the SVG markup is deterministic. If TypeScript or Next complains during build, fallback is to declare Bullseye.tsx with `"use client"` (still works as pure SVG, just bundled into client chunks).

### Risk 9 — `manifest.webmanifest` JSON validation
REQ-C2 updates 5 fields + adds an icon entry. JSON has no schema enforcement at build time — typos slip through silently and break PWA install on production. **Mitigation**: PR review must validate `python3 -m json.tool < public/manifest.webmanifest` returns success.

### Risk 10 — `public/` SVG cleanup deletes referenced asset
REQ-C3 deletes 5 Vercel-template SVGs. Confirmed: `grep -rn "next.svg\|vercel.svg\|file.svg\|globe.svg\|window.svg" src/` returns ZERO matches. Safe to delete.

### Risk 11 — `viewport.themeColor` not updating iOS status bar in dev
iOS Safari's status bar color reads from the Web App Manifest `theme_color` for installed PWAs, and from `<meta name="theme-color">` (Next sets this from `viewport.themeColor`) for browser-visit instances. **Both must agree on the new dark hex `#0F0B07`** — manifest (REQ-C2) AND layout viewport (REQ-C1). Architect: verify both end up with the same value.

### Risk 12 — Goal progress formula assumes `createdAt < targetDate`
The formula in §5 above guards `total <= 0` → returns 1 (already-due goal renders as full bullseye). Edge case: goals with `targetDate < createdAt` (created retrospectively) render as full immediately. **Acceptable** — the `days < 0` badge already shows "Nd ago" and the user understands. No action needed; document the choice in REQ-D4.

### Risk 13 — Light-mode `--accent` darkened from `#A87A1F` to `#8A6212`
UX §6 changed three light-mode hex values for WCAG AA. PRD §8 acceptance criteria 6a guards against the old hex strings (`#A87A1F\|#5C7A40\|#B8741C`) leaking back in. **Confirm** REQ-A1 uses the corrected hex values from PRD §5.1's adjusted table, not the original draft.

### Risk 14 — `BaselineBlockCard` line 29 ` ✓` literal in title string
`<Card title={`${index + 1}. ${label}${allLogged ? " ✓" : ` (${loggedCount}/${tests.length} logged)`}`}>`
This is a PLAIN UNICODE `✓` glyph in the card title (NOT a `text-emerald-500` element). It survives the rebrand as-is — it's just a textual checkmark in the card heading, not a brand-color signal. **Decision**: keep as-is (UX §4 only swapped the per-row glyph) OR replace with text "(all logged)". **Recommendation**: keep — it's brand-neutral text, no migration needed.

### Risk 15 — `dotenv` not in node_modules for `scripts/render-icons.ts`
If the icon-render script reads `.env`, it needs `dotenv`. Already in `devDependencies` (package.json:28). No issue.

---

## Summary tables for the Architect

### File-touch density (top 10 most-modified files)

| File | REQs touching | Why |
|------|---:|------|
| `src/app/globals.css` | A1, A2, E1 (kf) | Palette, font, animation |
| `src/app/layout.tsx` | C1, A2 | Metadata, font wire, AppHeader, themeColor |
| `src/components/CalendarMonth.tsx` | D2, A3 | Bullseye dot, color migrations |
| `src/components/BaselineBlockCard.tsx` | D1, A3 | Bullseye + color migration |
| `src/components/BottomNav.tsx` | D3 | Active-tab Bullseye |
| `src/app/goals/page.tsx` | D4, A3 | Progress Bullseye + color migration |
| `public/manifest.webmanifest` | C2 | All metadata fields |
| All `*Form*.tsx` (~12 files) | A3, E2 | Error-block color migrations |
| `src/app/baselines/page.tsx` | A3 | 6 color sites |
| `src/app/goals/[id]/plan/page.tsx` | A3 | 3 color sites |

### Stream parallelism

- **Sequential foundation**: REQ-A1 → REQ-A2 (one agent, one PR — both touch `globals.css` / `layout.tsx`)
- **Parallel after foundation**:
  - Agent 2: REQ-B1 (Logo) + REQ-B2 (Bullseye) + REQ-B3 (AppHeader)
  - Agent 3: REQ-A3 (color migration sweep — independent of components)
- **Parallel after Agent 2**:
  - Agent 4: REQ-D1, REQ-D2, REQ-D3, REQ-D4 (motif consumers)
  - Agent 5: REQ-C1, REQ-C2, REQ-C3, REQ-D5 (layout, manifest, cleanup, icons)
- **Last (optional)**: Agent 6: REQ-E1, REQ-E2, REQ-E3 (polish)

### Acceptance grep checklist (lift into QA)

```sh
grep -rn "Workout Planner" src/ public/   # → 0
grep -rn "text-red-500\|text-amber-500\|text-emerald-500\|border-red-500\|border-amber-500\|border-emerald-500\|bg-red-500\|bg-amber-500\|bg-emerald-500" src/   # → 0
grep -rn "#2563eb\|#60a5fa" src/ public/   # → 0
grep -rn "#A87A1F\|#5C7A40\|#B8741C" src/ public/   # → 0
grep -n "Goaldmine" public/manifest.webmanifest   # → at least 1
grep -n "DM_Serif_Display\|Playfair_Display" src/app/layout.tsx   # → at least 1
grep -n "AppHeader" src/app/layout.tsx   # → at least 1
test -f public/icon.svg
test -f src/components/Logo.tsx
test -f src/components/Bullseye.tsx
test -f src/components/AppHeader.tsx
```

---

/Users/ggronnii/Development/workout-planner/.feature-dev/2026-05-05-goaldmine-rebrand/agents/research-output.md
