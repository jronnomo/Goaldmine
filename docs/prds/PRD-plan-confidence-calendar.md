# PRD: Plan-Confidence Calendar — Track 2 (visual + confirm)

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-06-08
**Status**: Approved
**GitHub Issue**: N/A — direct-to-main
**Branch**: main (per-agent worktrees, squash-merged)
**Design spec**: `docs/design/long-effort-reconciliation.md` §11 (Track-2 coupling)
**UX research**: `docs/ux-research/plan-confidence-calendar.md` (+ `-ledger.md`, `.html`) — DONE; this PRD operationalizes it. **UX-research: satisfied — full pass already completed for this feature (committed report + ledger + HTML pixel artifact); not re-run.**
**Depends on**: Track 1 (shipped `747f8d0`) — `weekConflicts`, `WeekConflict`, `CalendarDayCell.conflict`.

---

## 1. Overview

### 1.1 Problem Statement
The calendar renders every in-plan day with identical visual confidence — week 1 (reviewed with the user) looks byte-identical to week 12 (a pure rotation-template projection). That sameness is dishonest UI: it shows a guess as authoritative as a committed plan. This feature makes the projection→commitment distinction legible, and turns "a week with an unresolved conflict can't be locked" into a visual forcing function.

### 1.2 Proposed Solution
Add a **per-week confidence rail** in the calendar's left gutter, capped with the canonical **Bullseye** — filled = confirmed, hollow = provisional, warning = conflict. Provisional days carry a quiet redundant cue (reduced opacity + dashed top hairline) so confidence survives colorblindness and the contrast-tight cream palette. The Track-1 `conflict` field drives a corner-wedge overlay and forces the week's cap into the warning state. A `bullseye-pop` flip plays when a week is confirmed ("solidifies").

Confidence is driven by a single **`Plan.confirmedThroughDate` high-water mark**, advanced **conversationally via MCP only** (`confirm_week` / `reopen_week` / a `log_review` extension) — the app never auto-advances it, and the **server-side guard refuses to confirm past a week that still holds an unresolved conflict** (calls Track-1 `weekConflicts`). The PWA calendar is **read-only** confidence display.

### 1.3 Success Criteria
- The calendar visibly distinguishes confirmed / provisional / conflict weeks at 390px, in both light and dark, colorblind-safe (not hue-alone).
- `confirm_week(weekIndex)` advances `Plan.confirmedThroughDate`; **refuses** when a newly-covered week has an unresolved conflict, returning the blocking conflicts.
- `reopen_week(weekIndex)` moves the mark earlier.
- A confirmed week's cap renders filled; provisional hollow; a conflict week's cap warning regardless of confirm state.
- `tsc` / `lint` / `build` clean; migration applies to Neon; existing rows unaffected (null = nothing confirmed).

---

## 2. User Stories

| ID | As… | I want… | So that… | Priority |
|----|-----|---------|----------|----------|
| US-001 | Gabe | the calendar to show which weeks are reviewed vs still projected | I trust the near plan and treat the far plan as a draft | Must |
| US-002 | Gabe (via coach) | to lock a reviewed week via the coach | the calendar reflects our weekly maintenance conversation | Must |
| US-003 | Gabe | a week with an open conflict to be un-lockable | the plan can't be "confirmed" while it's still broken | Must |
| US-004 | Gabe (via coach) | to reopen a week if plans change | a work trip / injury can re-draft a previously-locked week | Should |
| US-005 | Gabe | the week to visibly "solidify" when confirmed | locking feels like a real completion moment | Should |

---

## 3. Functional Requirements

### 3.1 Core
1. Prisma: add `confirmedThroughDate DateTime?` to `Plan` (nullable, additive). Migration + `prisma generate`.
2. Thread `confirmedThroughDate` onto `ActiveProgramSnapshot` (`program.ts`) so reads have it without an extra query.
3. `CalendarDayCell.confidence: "past" | "confirmed" | "provisional" | null` derived in `buildCell` (`null` when `!isInPlan`): `past` = in-plan & isPast; `confirmed` = in-plan & !isPast & `date <= confirmedThroughDate`; `provisional` = in-plan & future & (no mark or `date > confirmedThroughDate`).
4. MCP write tools (coach-driven, **propose-before-apply** per server rules):
   - `confirm_week(weekIndex)` — set `confirmedThroughDate` = USER_TZ end of that rotation week. **Guard:** refuse (return `{ ok:false, blockedBy: WeekConflict[] }`) if any week in the newly-confirmed span (current mark+1 … weekIndex) has `weekConflicts`.
   - `reopen_week(weekIndex)` — move `confirmedThroughDate` back to the end of `weekIndex - 1` (or null if 0). No guard.
   - Extend `log_review` with optional `confirmThroughWeekEnd: number` (a weekIndex) that performs the same guarded advance as `confirm_week` as part of the review.
5. `CalendarMonth.tsx` visual (read-only, per UX §2/§7): restructure the flat `grid-cols-7` into **week rows** (`grid-cols-[16px_repeat(7,1fr)]`), col 1 = `<WeekRail>` (spine + Bullseye cap), cols 2–8 = existing `DayCell`s. Reuse `<Bullseye>` for the cap (filled/hollow/warning). Provisional `DayCell` cue: reduced opacity + dashed top hairline. Conflict `DayCell`: corner-wedge in `var(--warning)` from `cell.conflict`. Cap state reduced from the row's cells (any conflict → warning; all confirmed → filled; else hollow).
6. `bullseye-pop` flip: when a week crosses into confirmed, play the existing `@keyframes bullseye-pop` on its cap once (gate via a localStorage key per `weekIndex`, mirroring `TodayCelebration`). Honor `prefers-reduced-motion` (instant swap).

### 3.2 Secondary
7. Expose `confidence` on `ResolvedDay` too (so `get_week`/`get_today_plan` report it) — cheap, keeps MCP/UI parity. Should-have.
8. `aria-label` on `DayCell` appends confidence + conflict (e.g. `"… · provisional · conflict: planned hike this week"`); rail cap is `aria-hidden` (the day labels carry semantics).

### 3.3 Out of Scope
- In-app tap-to-confirm (chosen: MCP-only; PWA is read-only).
- Per-day confirmation / a `WeekConfirmation` join table (high-water mark only; revisit only if non-contiguous confirmation ever becomes real).
- Changing Track-1 conflict semantics.
- Any new calendar route; this modifies the existing `/calendar` surface only.

---

## 4. Technical Design

### 4.1 Data Model (Prisma)
```prisma
model Plan {
  // … existing …
  confirmedThroughDate DateTime?  // high-water mark: everything in-plan with
                                  // date <= this is "confirmed". null = none.
}
```
Migration: `npx prisma migrate dev --name add_plan_confirmed_through_date` then `npx prisma generate`. ⚠ Neon shared with prod — additive + nullable + no backfill (existing plans read as fully provisional, which is correct). Validate the SQL diff (single `ALTER TABLE … ADD COLUMN … NULL`).

### 4.2 MCP Tool Surface

| Tool | Purpose | R/W | Notes |
|------|---------|-----|-------|
| `confirm_week` | advance the high-water mark | Write | `inputSchema { weekIndex: z.number().int().min(1) }`. Guarded by `weekConflicts`. Returns `{ ok, confirmedThroughDate?, blockedBy? }`. |
| `reopen_week` | move the mark earlier | Write | `{ weekIndex }`. Sets mark to end of `weekIndex-1` (null if 0). |
| `log_review` | + optional confirm | Write | add optional `confirmThroughWeekEnd: z.number().int().min(1).optional()`; same guarded advance. Preserve all existing behavior. |

All wrap `safe(async () => …)`. Writes update `Plan.confirmedThroughDate` via the `prisma` singleton. No `parseDateInput` needed (inputs are weekIndex ints). The guard derives each week's rotation-week range via the Track-1 helpers and calls `weekConflicts(program, w)`.

### 4.3 Server Actions
None required (confirm is MCP-only). The calendar page stays a server component read. (If the architect finds a server action is cleaner for anything, document it + its `revalidatePath`.)

### 4.4 Pages / Components
- **Modify** `src/components/CalendarMonth.tsx` — week-row refactor; keep `DayCell`/`DayDetail` selection, today ring, glow, marker logic intact (different visual channel). `"use client"` stays.
- **New** `src/components/WeekRail.tsx` (or inline) — spine + `<Bullseye>` cap; pure presentational, props `{ state: "confirmed"|"provisional"|"conflict", weekIndex }`.
- **Modify** `src/app/calendar/page.tsx` — ensure `getCalendarMonth` returns cells carrying `confidence`; no new data fetch beyond `confirmedThroughDate` on the program snapshot.
- **Modify** `src/app/globals.css` — only if a provisional/flip class is needed beyond the existing `bullseye-pop`; reuse existing keyframe. No new animation library (CSS only).
- Reuse `<Bullseye>` (`src/components/Bullseye.tsx`) — do NOT invent a new progress glyph. Warning cap = a `Bullseye` wrapper tinted `var(--warning)` OR a minimal prop; prefer the wrapper (⚠ verify visually, UXR ledger).

### 4.5 Date / Time Semantics
`confirmedThroughDate` comparisons via `@/lib/calendar` (`startOfDay`/`dateKey`/`addDays`). The rotation-week end for `confirm_week(weekIndex)` = `endOfDay(addDays(startOfDay(startedOn), (weekIndex-1)*7 + 6))`. No raw `getDate()/setHours()` in app code.

### 4.6 Override-Awareness
Confidence is orthogonal to overrides (it's a per-week review state, not per-day prescription). The conflict overlay already respects the Track-1 workoutJson-based override definition via `cell.conflict`. No new override interaction.

### 4.7 Third-Party Dependencies
None.

---

## 5. UI/UX Specifications

### 5.1 Screens — see `docs/ux-research/plan-confidence-calendar.md` §3 (chosen Option B) + the committed `.html` pixel artifact (both themes). Summary at 390px:
```
 ◉ │ Mon Tue Wed Thu Fri Sat Sun   confirmed: solid spine, filled cap, solid cells
 ⊘ │ ░16 ░17 … ▟!21 ░22            conflict: warning cap+spine; week can't lock; Sat wedge
 ○ │ ░23 ░24 … ░29                 provisional: hollow cap, dashed spine, faded cells
```
States: past / confirmed / provisional + conflict overlay. Both light (cream/gold) and dark (coal/gold) — all colors via `var(--…)` tokens, no literals.

### 5.2 Navigation Flow
No nav change. Entry = the existing **Plan → /calendar** tab. The rail is non-interactive (or routes to the existing `DayDetail` — no new modal).

### 5.3 Responsive + Mobile-First
390px first; cells stay `min-h-[3.75rem]` (≥44px). The 16px rail gutter is decorative; cap 14–16px (Bullseye needs ≥14px for its center ring). No horizontal scroll.

### 5.4 Accessibility (UX §8)
Colorblind-safe via redundant non-color channels (cap shape filled/hollow, spine solid/dashed, cell opacity + dashed border, conflict = geometric wedge). ⚠ **Verify provisional cell opacity (0.55–0.70) keeps the date number ≥ WCAG AA on cream** — if not, raise the floor or dim the background, not the text. Reduced-motion → instant flip. Both palettes verified.

---

## 6. Edge Cases & Error Handling

| Scenario | Expected |
|----------|----------|
| `confirmedThroughDate` null (existing plans) | All in-plan future weeks render provisional (correct). |
| `confirm_week` on a week with a conflict in span | Refuse; return `blockedBy` conflicts; mark unchanged. |
| `confirm_week` past `totalWeeks` | Clamp/refuse with a clear message. |
| `reopen_week(1)` | Mark → null (nothing confirmed). |
| Confirmed week later gets a conflict (hike added) | Cap flips to warning on next load (conflict overlay wins); confirm state in the mark is unchanged until reopened. |
| Out-of-plan / no active plan | No rail rendering for out-of-month; tools return a clear no-plan error. |
| DST week | week-range math via `addDays`/`startOfDay`. |
| Reduced motion | No pop; instant state. |
| Narrow phone overflow | Rail is 16px fixed; cells flex; no overflow at 390px. |

---

## 7. Security Considerations
`confirm_week`/`reopen_week`/`log_review` are MCP bearer-token gated (existing). Zod validates `weekIndex` int ≥ 1. Writes touch only `Plan.confirmedThroughDate`. No new public route, no user-rendered HTML, no raw SQL.

---

## 8. Acceptance Criteria
1. [ ] `npx tsc --noEmit` — 0 errors.
2. [ ] `npm run lint` — no new errors.
3. [ ] `npm run build` — succeeds.
4. [ ] Migration `add_plan_confirmed_through_date` applied; `Plan.confirmedThroughDate` nullable; existing rows null; `prisma generate` run.
5. [ ] `CalendarDayCell.confidence` derived correctly for past/confirmed/provisional/out-of-plan.
6. [ ] `confirm_week` advances the mark and **refuses** when a covered week has a conflict (returns `blockedBy`).
7. [ ] `reopen_week` moves the mark back; `reopen_week(1)` → null.
8. [ ] `log_review` optional `confirmThroughWeekEnd` performs the same guarded advance; existing `log_review` behavior unchanged.
9. [ ] `CalendarMonth` renders week rows + rail + Bullseye cap (filled/hollow/warning) + provisional cell cue + conflict wedge at 390px, both themes, no literals.
10. [ ] `bullseye-pop` flip plays once per week-confirm crossing; reduced-motion → instant.
11. [ ] Selection / today ring / completed glow / markers still work post-refactor.
12. [ ] All Date math via `@/lib/calendar`.
13. [ ] No in-app confirm control (read-only PWA).

---

## 9. Open Questions
None — UX pass + the three Phase-1 decisions (MCP-only confirm, full visual, direct-to-main) resolve them. Architect decides: `confidence` on `ResolvedDay` (should-have) in or out; warning-cap as Bullseye wrapper vs prop; the exact guard span semantics (recommend: check weeks from current-mark+1 through target).

---

## 10. Test Plan

### 10.1 Gates
`tsc` · `lint` · `build` clean; migration applies; `prisma generate`.

### 10.2 MCP curl smoke
- `confirm_week {weekIndex:N}` on a clean week → `ok:true`, mark advances.
- `confirm_week` on a week with a seeded off-Day-6 hike conflict → `ok:false`, `blockedBy` lists it.
- `reopen_week` → mark moves back.
- `log_review {…, confirmThroughWeekEnd:N}` → review logged + guarded advance.

### 10.3 Browser smoke (390px)
1. `npm run dev`; open `/calendar`.
2. Confirm a week via curl, reload → that week's cap fills (+ flip once).
3. Verify provisional weeks read faded/dashed; a conflict week shows the wedge + warning cap; selection/today/markers intact. Both themes.

### 10.4 Migration verification
Confirm `prisma migrate dev` succeeds on Neon; `src/generated/prisma` regenerates; existing calendar still renders (all provisional).

---

## 11. Appendix

### 11.1 Discovery Notes
Track 2 of the long-effort initiative. Phase-1 decisions: confirm is MCP-only (coach-driven, matches the conversational philosophy); full visual spec (rail + cap + provisional cue + conflict wedge + flip); direct-to-main with the additive migration. The conflict overlay reuses Track-1 `CalendarDayCell.conflict` / `weekConflicts`.

### 11.2 References
- UX: `docs/ux-research/plan-confidence-calendar.md` (Option B chosen), `-ledger.md` (27 rows, to tick in Phase 7), `.html` artifact.
- Design: `docs/design/long-effort-reconciliation.md` §11.
- Track 1 commit `747f8d0` — `weekConflicts`, `WeekConflict`, `CalendarDayCell.conflict`.
- Code: `src/components/CalendarMonth.tsx`, `src/components/Bullseye.tsx`, `src/lib/calendar.ts` (`buildCell`, `getCalendarMonth`, `weekConflicts`), `src/lib/program.ts` (`ActiveProgramSnapshot`), `src/lib/mcp/tools.ts` (`log_review`), `prisma/schema.prisma` (`Plan:234`), `src/app/globals.css` (`bullseye-pop:100`).
