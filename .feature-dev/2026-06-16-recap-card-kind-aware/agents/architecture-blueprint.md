# Architecture Blueprint — Recap Card kind-aware (#69)

Single file: `src/lib/recap-card.tsx` (Satori, flex-only, inline styles). Depends on #67/#68 (shipped). Full design in `docs/prds/PRD-recap-card-kind-aware.md` §3. Edit map below against the CURRENT file (post-#67, 1053 lines).

## Edit map (current line numbers)
1. **Line 10** — remove `import { fmtVolume, fmtElevation } from "@/lib/goal-presentation";`; add `import { presentationForGoal } from "@/lib/goal-presentation";`. Confirm `ResolvedStatSlot` is importable from `@/lib/recap` (add it to the existing `import type { WeeklyRecap, … } from "@/lib/recap"` line).
2. **Feed card component (~287)** — add `const presentation = presentationForGoal(recap.goal);` and replace the `programLine` derivation (291–294) with the headerStyle switch (PRD §3.1).
3. **Feed ring label (413)** — `READINESS` literal → `{presentation.ringLabel}`.
4. **Feed stat grid (578–638)** — replace the whole `flex:1` column block (the wrapper + Row 1 + Row 2) with `<StatGrid tok={tok} statSlots={recap.statSlots} displayFont={displayFont} displayWeight={displayWeight} />`.
5. **`SlideOne` (~779)** — add `const presentation = presentationForGoal(recap.goal);` and replace its `programLine` (780–783) with the same switch.
6. **SlideOne ring label (842)** — `READINESS` → `{presentation.ringLabel}`.
7. **SlideTwo stat grid (937–948)** — replace with `<StatGrid … statSlots={recap.statSlots} … />`.
8. **New `StatGrid` helper** (place next to `StatCell` ~684) — PRD §3.3 exactly. `StatCell` UNCHANGED.

## Invariants (Devil's Advocate must verify these hold)
- **Byte-identical fitness:** 4 slots → `StatGrid` yields the same DOM as the current 2×2 (row1 `borderBottom`, 1px cell dividers, `StatCell` same props). `slot.value` already equals the old `String(...)`/`fmtVolume(...)`/`fmtElevation(...)` outputs (verified live in #68: `["4","5,370 lb","7","—"]`).
- **Project 2 slots:** one row, no `borderBottom`, centered. No 4-cell dash padding.
- **Satori:** flat children arrays (NO `React.Fragment`), every child has explicit `display` + a `key`, inline styles only, no conic-gradient / `gridTemplate` / CSS vars. SVG `stroke-dasharray` ring (ProgressRing) untouched (memory `satori-no-conic-use-svg-arc`).
- **headerStyle switch:** `program-week` reproduces the exact old string (fitness); `weeks-to-target` → `${weeksToTarget} WEEKS TO ${targetDateLabel.toUpperCase()}`; both guard their null source so the line is omitted (existing `{programLine && …}`).
- **No unused imports** — removing `fmtVolume`/`fmtElevation` (the only 4 uses are the grids being replaced); lint must stay clean.
- **Touch ONLY `recap-card.tsx`.** Do not change `recap.ts`, `goal-presentation.ts`, `StatCell`, ProgressRing, or templates.

## Verification (Developer runs)
`npx tsc --noEmit` (0 new) · `npx eslint src/lib/recap-card.tsx` (clean — catches the unused-import trap) · `npm run build` (green) · grep guard (`conic-gradient|gridTemplate|var\(--|fmtVolume|fmtElevation` → none). The Satori RENDER verification (curl `/recap/card` → 200 image/png for both goals + visual PNG inspection) is done by the Tech Lead post-merge on the dev server (worktree may not reach the DB).
