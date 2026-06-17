# PRD — Recap Card: drive ring/header/stat-grid from the presentation registry (#69)

**Slug:** recap-card-kind-aware · **Issue:** #69 (board #8, Sprint 6, P0) · **Date:** 2026-06-16
**Depends on:** #67 (`goal-presentation.ts`, shipped `189f006`) + #68 (`recap.statSlots` + `header.weeksToTarget/targetDateLabel`, shipped `389c8c1`).
**UX-research:** skipped — refactor. This drives **existing** card elements from the registry; the project visual design (2-cell row, `PROGRESS` ring, weeks-to-target header) is already locked by the approved roadmap blueprint (`plan-blueprint.md §1`, §5), and the fitness card must stay **pixel-identical**. No new visual design decisions.

## 1. Problem & Goal
`recap-card.tsx` (Satori OG card, 1080×1920) hardcodes the ring label `"READINESS"`, the `"WEEK n · DAY m OF d"` header, and a fixed 2×2 `WORKOUTS/VOLUME/NEW PRs/ELEVATION` grid. With #67/#68 shipped, the card can read everything kind-aware from one source: `presentationForGoal(recap.goal)` + `recap.statSlots`. Goal: the Chewgether card renders `PROGRESS` ring + "weeks to SEP 30" header + a 2-cell `MRR`/`MILESTONES` row, while the Elbert card is byte-identical.

## 2. Scope (only `src/lib/recap-card.tsx`)
**In:**
- Compute `const presentation = presentationForGoal(recap.goal)` once in the feed-card component (~line 287) and once in `SlideOne` (~line 779).
- **Ring labels** (feed `413`, SlideOne `842`) → `presentation.ringLabel`.
- **Program lines** (feed `291–294`, SlideOne `780–783`) → switch on `presentation.headerStyle`.
- **Stat grids** (feed `584–638`, SlideTwo `937–948`) → map `recap.statSlots` via a new `StatGrid` helper (rows of 2; `StatCell` unchanged).
- Remove the now-unused `import { fmtVolume, fmtElevation }` (line 10); add `presentationForGoal`. The grid now uses pre-formatted `slot.value`.

**Out:** any change to `recap.ts`/`goal-presentation.ts` (done in #67/#68); `StatCell` internals; the ProgressRing SVG; `recap-templates.ts`; SlideThree's "On to Week N" line (already guarded by `programWeek !== null` → correctly hidden for project). No Prisma/MCP/schema change.

## 3. Design

### 3.1 `presentation` + `programLine`
In both the feed card and `SlideOne`:
```ts
const presentation = presentationForGoal(recap.goal);
const programLine =
  presentation.headerStyle === "program-week"
    ? (recap.header.programWeek !== null
        ? `WEEK ${recap.header.programWeek} · DAY ${recap.header.dayOfProgram} OF ${recap.header.totalProgramDays}`
        : null)
    : presentation.headerStyle === "weeks-to-target"
    ? (recap.header.weeksToTarget !== null
        ? `${recap.header.weeksToTarget} WEEKS TO ${(recap.header.targetDateLabel ?? "").toUpperCase()}`
        : null)
    : null; // "none"
```
The existing `{programLine && (<div>…{programLine}</div>)}` render stays — only the derivation changes. Fitness (`program-week`) reproduces the exact current string. Chewgether → `"15 WEEKS TO SEP 30"`.

### 3.2 Ring label
Replace the literal `READINESS` at feed `413` and SlideOne `842` with `{presentation.ringLabel}`. Fitness → `"READINESS"` (identical); project → `"PROGRESS"`.

### 3.3 `StatGrid` helper (new component; `StatCell` unchanged)
```tsx
function StatGrid({ tok, statSlots, displayFont, displayWeight }: {
  tok: TemplateTokens; statSlots: ResolvedStatSlot[]; displayFont: string; displayWeight: number;
}) {
  const rows: ResolvedStatSlot[][] = [];
  for (let i = 0; i < statSlots.length; i += 2) rows.push(statSlots.slice(i, i + 2));
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      {rows.map((row, ri) => (
        <div key={ri} style={{ flex: 1, display: "flex", flexDirection: "row",
          ...(ri < rows.length - 1 ? { borderBottom: `1px solid ${tok.statDivider}` } : {}) }}>
          {row.flatMap((slot, ci) => {
            const cell = (
              <StatCell key={slot.key} tok={tok} value={slot.value} label={slot.label}
                displayFont={displayFont} displayWeight={displayWeight} isNull={slot.isNull} />
            );
            return ci === 0
              ? [cell]
              : [<div key={slot.key + "-div"} style={{ width: 1, backgroundColor: tok.statDivider }} />, cell];
          })}
        </div>
      ))}
    </div>
  );
}
```
- **Byte-identical fitness (4 slots):** produces two flex rows of 2 cells, row 1 with `borderBottom`, a 1px divider between cells — **identical** to the current hand-written grid. `StatCell` receives `slot.value` (already `"4"`/`"5,370 lb"`/`"7"`/`"—"`) + `slot.isNull`.
- **Project (2 slots):** one flex:1 row of 2 cells, no `borderBottom` (last row) — a single centered row, no dash-padded 4-cell fake grid.
- **Satori safety:** flat children arrays (no `React.Fragment`), explicit `display` on every child, keys on every mapped child, inline styles only, no conic-gradient/CSS-vars. Honors memory `satori-no-conic-use-svg-arc`.

Replace BOTH grids:
- Feed card `584–638` → `<StatGrid tok={tok} statSlots={recap.statSlots} displayFont={displayFont} displayWeight={displayWeight} />` (the outer `flex:1` wrapper at 578–584 is now `StatGrid`'s own root, so replace the whole block 578–638).
- SlideTwo `937–948` → same `<StatGrid … />`.

### 3.4 Imports
Line 10: remove `fmtVolume, fmtElevation` (now unused — grid reads `slot.value`). Add `import { presentationForGoal } from "@/lib/goal-presentation";`. `ResolvedStatSlot` type imported from `@/lib/recap` (alongside the existing `WeeklyRecap` type import).

## 4. Edge cases
- Project goal, `headerStyle:"weeks-to-target"` but `weeksToTarget===null` (someday) → `programLine` null → header line omitted (existing `{programLine && …}` guard). Chewgether HAS a target.
- `statSlots.length` 0 (error fallback resolves DEFAULT → 4 fitness slots, so practically 2 or 4) → `StatGrid` renders 0 rows gracefully.
- `__default__` (unknown kind) → fitness presentation → identical to fitness card.

## 5. Acceptance criteria
1. `npx tsc --noEmit`, changed-file lint, `npm run build` green.
2. `presentationForGoal(recap.goal)` computed once each in feed card + SlideOne; `fmtVolume`/`fmtElevation` import removed (no unused-import lint error).
3. Both ring labels read `presentation.ringLabel`; both program lines switch on `presentation.headerStyle`; both stat grids use `StatGrid(recap.statSlots)`; `StatCell` unchanged.
4. **Satori renders with no error** for both goals — verified by curling `/recap/card?goalId=…` (HTTP 200, `image/png`) for the fitness focus goal AND Chewgether on the dev server. Flex-only, inline styles, SVG ring intact.
5. **Fitness byte-identical:** Elbert card renders `READINESS` ring, `WEEK 7 · DAY 46 OF 105` header, 2×2 `WORKOUTS 4 / VOLUME 5,370 lb / NEW PRs 7 / ELEVATION —` (elevation muted), same dividers — visually identical to pre-change.
6. **Chewgether:** card renders `PROGRESS` ring, `15 WEEKS TO SEP 30` header, a single 2-cell row `MRR —` / `MILESTONES 0/7`.

## 6. Verification
- `npx tsc --noEmit` + `npm run build`.
- `npm run dev`, then `curl -s -o /tmp/fit.png -w "%{http_code} %{content_type}\n" "http://localhost:3000/recap/card?goalId=<elbert>"` and same for Chewgether `cmqbfseel0000cgdn3oz1uz2u` → expect `200 image/png` for both; inspect the PNGs visually (read the images) to confirm ring label / header / grid.
- `grep -nE "conic-gradient|gridTemplate|var\(--|fmtVolume|fmtElevation" src/lib/recap-card.tsx` → no conic/grid/CSS-var; no stray formatter use.
