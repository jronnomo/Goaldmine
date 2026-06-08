# Requirements — Plan-Confidence Calendar (Track 2)

PRD: `docs/prds/PRD-plan-confidence-calendar.md` · UX: `docs/ux-research/plan-confidence-calendar.md` · Depends on Track 1 (`747f8d0`: `weekConflicts`, `CalendarDayCell.conflict`).

**Streaming:** REQ-001→004 are a BACKEND stream (schema/program/calendar/tools). REQ-005→007 are a FRONTEND stream (CalendarMonth + WeekRail + globals.css). Frontend consumes `CalendarDayCell.confidence` from REQ-002, so backend lands first. Architect recommends single-agent-sequential vs two-sequential-agents; Tech Lead decides (default: ONE developer agent, one worktree, sequential — avoids cross-worktree type breakage on the shared `CalendarDayCell` type and double migration cycles).

---

### REQ-001 — Migration + ActiveProgramSnapshot
**Description:** Add `confirmedThroughDate DateTime?` to `Plan` (`prisma/schema.prisma`). Run `npx prisma migrate dev --name add_plan_confirmed_through_date` + `npx prisma generate`. ⚠ Neon = prod: confirm the SQL diff is a single additive nullable `ADD COLUMN`. Thread `confirmedThroughDate` onto `ActiveProgramSnapshot` (`src/lib/program.ts`) — select it in `getActiveProgram` and add to the returned snapshot.
**Files:** `prisma/schema.prisma`, `src/lib/program.ts`
**Acceptance:** column added (nullable); existing rows null; `prisma generate` run; snapshot carries `confirmedThroughDate: Date | null`; `tsc` clean.
**Deps:** none. **Complexity:** S

### REQ-002 — `CalendarDayCell.confidence` (+ `ResolvedDay.confidence`)
**Description:** Add `confidence: "past" | "confirmed" | "provisional" | null` to `CalendarDayCell` (`calendar.ts`). Derive in `buildCell`: `null` if `!isInPlan`; `past` if isPast; `confirmed` if future/today & `confirmedThroughDate != null && startOfDay(date) <= startOfDay(confirmedThroughDate)`; else `provisional`. Thread `program.confirmedThroughDate` through `getCalendarMonth` → `buildCell` (no new query). Also add `confidence` to `ResolvedDay` + derive in `resolveDay` (should-have, MCP parity for get_week/get_today_plan).
**Files:** `src/lib/calendar.ts`
**Acceptance:** field present + derived per the rules; `getCalendarMonth` passes `confirmedThroughDate`; no per-cell query; `tsc` clean; existing cell fields unchanged.
**Deps:** REQ-001. **Complexity:** M

### REQ-003 — `confirm_week` / `reopen_week` MCP tools + guard
**Description:** Two write tools in `tools.ts` (register via `safe()`/Zod). `confirm_week({ weekIndex:int≥1 })`: set `Plan.confirmedThroughDate = endOfDay(addDays(startOfDay(startedOn), (weekIndex-1)*7 + 6))`. **Guard:** for each week w in (currentConfirmedWeekIndex+1 … weekIndex), call `weekConflicts(program, w)`; if any non-empty, REFUSE → `{ ok:false, blockedBy: WeekConflict[] }`, mark unchanged. Clamp/refuse weekIndex > totalWeeks. `reopen_week({ weekIndex:int≥1 })`: set mark = end of `weekIndex-1` rotation week, or `null` if weekIndex≤1. Both return `{ ok, confirmedThroughDate? , blockedBy? }`. Update `Plan` via prisma singleton.
**Files:** `src/lib/mcp/tools.ts`
**Acceptance:** both tools in `tools/list`; confirm advances mark; guarded refusal returns `blockedBy`; reopen moves back / nulls; `tsc` clean.
**Deps:** REQ-001 (+ Track-1 `weekConflicts`). **Complexity:** M

### REQ-004 — `log_review` confirm extension
**Description:** Add optional `confirmThroughWeekEnd: z.number().int().min(1).optional()` to the existing `log_review` tool. When present, perform the SAME guarded advance as `confirm_week` after logging the review; surface the result (and any `blockedBy`). Preserve ALL existing `log_review` behavior when absent. Factor the guarded-advance logic so `confirm_week` and `log_review` share it (no duplication).
**Files:** `src/lib/mcp/tools.ts`
**Acceptance:** existing `log_review` unchanged when the field is absent; with it, review logs + guarded advance; shared helper; `tsc` clean.
**Deps:** REQ-003. **Complexity:** S

### REQ-005 — CalendarMonth week-row refactor + WeekRail + Bullseye cap
**Description:** Refactor the flat `grid grid-cols-7 gap-1` (`CalendarMonth.tsx:82`) into 6 week rows, each `grid-cols-[16px_repeat(7,1fr)]`: col 1 = `<WeekRail>`, cols 2–8 = existing `DayCell`s (chunk the 42 cells by 7 — they already arrive padded Mon–Sun). `<WeekRail>` (new component or inline): spine (CSS background: solid gold `var(--accent)` confirmed / dashed `var(--muted)` provisional / dashed `var(--warning)` conflict) + a `<Bullseye>` cap (filled / hollow / warning variant — prefer a Bullseye wrapper tinted `var(--warning)`, ⚠ verify visually). Per-week state reduced from the row's cells: any `cell.conflict` → warning; all confirmed → filled; else hollow. Keep `DayCell`/`DayDetail`/selection/today-ring/glow/markers intact. `"use client"` stays. Both themes; tokens only.
**Files:** `src/components/CalendarMonth.tsx`, optional `src/components/WeekRail.tsx`
**Acceptance:** week rows render with rail+cap at 390px; cap state correct; selection/today/markers still work; no color literals; `tsc`+`build` clean.
**Deps:** REQ-002. **Complexity:** L

### REQ-006 — Provisional cell cue + conflict wedge
**Description:** In `DayCell`: provisional (`cell.confidence === "provisional"`) → reduced opacity (start 0.62, ⚠ playtest 0.55–0.70 — verify date number stays ≥ AA on cream) + dashed top hairline (`border-t border-dashed border-[var(--muted)]`). Conflict (`cell.conflict != null`) → a corner-wedge pseudo-element / small triangle in `var(--warning)` (11–14px, ⚠ verify it doesn't fight the today/selected ring). Keep these on DIFFERENT visual channels from the existing tone/ring/glow. Append confidence + conflict to the `aria-label`.
**Files:** `src/components/CalendarMonth.tsx` (+ `globals.css` if a wedge utility is needed)
**Acceptance:** provisional faded+dashed; confirmed solid; conflict wedge visible without breaking the ring; a11y label updated; both themes; `build` clean.
**Deps:** REQ-005. **Complexity:** M

### REQ-007 — `bullseye-pop` flip + reduced-motion
**Description:** When a week crosses into confirmed, play the existing `@keyframes bullseye-pop` (`globals.css:100`) on its cap ONCE — gate via `localStorage["goaldmine.weekConfirmed.<weekIndex>"]` mirroring `TodayCelebration.tsx`'s once-guard. Honor `prefers-reduced-motion` (instant swap, no pop) exactly like the existing `.bullseye-pop` block. No animation library — CSS only. ⚠ All durations are the existing 320ms keyframe; do not invent new tunings beyond the UX ranges.
**Files:** `src/components/CalendarMonth.tsx` (+ minimal `globals.css` reuse)
**Acceptance:** flip plays once per week-confirm crossing; reduced-motion → no pop; no new keyframe unless justified; `build` clean.
**Deps:** REQ-005, REQ-006. **Complexity:** S
