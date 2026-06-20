# Architecture Critique — Recap Card kind-aware (#69)

Reviewer: Devil's Advocate agent
Blueprint: `.feature-dev/2026-06-16-recap-card-kind-aware/agents/architecture-blueprint.md`
Source truth: `src/lib/recap-card.tsx` (1053 lines, post-#67), `src/lib/recap.ts`, `src/lib/goal-presentation.ts`

---

## Critical

### CRIT-1 — Feed-grid line range: PRD says 584, blueprint says 578 — only 578 is correct

The PRD §2 states:
> **Stat grids** (feed `584–638`, SlideTwo `937–948`)

The feed card's outer wrapper `<div>` is multi-line:
```
578:      <div
579:        style={{
580:          flex: 1,
581:          display: "flex",
582:          flexDirection: "column",
583:        }}
584:      >
```

Line 584 is the bare `>` that closes the opening tag of the outer wrapper. If the Developer starts the replacement at **584**, they leave lines 578-583 intact:
```tsx
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
        }}
      >
      <StatGrid tok={tok} statSlots={recap.statSlots} displayFont={displayFont} displayWeight={displayWeight} />
      {/* no </div> for the orphaned opening tag */}
```
This is broken JSX — an unclosed `<div>` with a dangling `>`.

**The blueprint's edit 4 is authoritative and correct: replace lines 578–638.** The outer wrapper (578-583 opening tag + 584 `>` + 638 closing `</div>`) is the root `StatGrid` replaces. Developer must NOT use the PRD's "584" start.

For SlideTwo the PRD and blueprint agree — line 937 is the outer wrapper's opening (single-line style), so 937–948 is correct for both documents. ✓

**Fix:** Use lines **578–638** for the feed replacement. Trust the blueprint, not the PRD range.

---

## Concerns

### CONCERN-1 — `flatMap` array children in Satori: valid but novel pattern, verify empirically

The existing stat grids use sibling JSX children directly:
```tsx
{/* current Row 1, lines 586–611 */}
<div style={{ ...rowStyle }}>
  <StatCell ... />
  <div style={{ width: 1, ... }} />
  <StatCell ... />
</div>
```

`StatGrid` replaces this with `{row.flatMap((slot, ci) => ci === 0 ? [cell] : [dividerDiv, cell])}` — a JavaScript array passed as JSX children. React flattens these identically and Satori processes the resolved React element tree (not the JSX source), so array children are semantically equivalent. Keys are present on every mapped element (`key={slot.key}`, `key={slot.key + "-div"}`, `key={ri}`). The outer `rows.map(...)` is already an array-children pattern; this is its inner analog.

This is architecturally sound. However, it is a structural pattern not currently used anywhere in `recap-card.tsx` — the existing file has zero `map`/`flatMap` in its JSX. **The Satori render curl (blueprint verification step, post-merge on dev server) is mandatory for this reason.** A worktree-only typecheck cannot prove Satori renders it.

No fix needed; just do not skip the curl verification.

### CONCERN-2 — `dayOfProgram` and `totalProgramDays` are `number | null` in the program-week template literal

The existing code at lines 292-294:
```ts
const programLine =
  recap.header.programWeek !== null
    ? `WEEK ${recap.header.programWeek} · DAY ${recap.header.dayOfProgram} OF ${recap.header.totalProgramDays}`
    : null;
```
`recap.header.dayOfProgram` and `recap.header.totalProgramDays` are typed `number | null` (`RecapProgramHeader`, `recap.ts:81–84`). TypeScript does not error on `number | null` in a template literal — it widens to `string`. If the data contract were violated and `programWeek !== null` while `dayOfProgram === null`, the card would render `"WEEK 7 · DAY null OF null"`.

The blueprint reproduces this same pattern in the `program-week` switch branch. **This is not a new regression** — the existing code has the same issue and it compiles and works today. `recap.ts` sets all three fields atomically (step 11, line 485-490), so the impossible state cannot occur at runtime.

No fix required. Note that TypeScript strict mode does not catch this and never will for template literals.

### CONCERN-3 — `targetDateLabel ?? ""` fallback produces `"N WEEKS TO "` on malformed data

PRD §3.1 uses `(recap.header.targetDateLabel ?? "").toUpperCase()`. If `weeksToTarget !== null` but `targetDateLabel === null` (impossible in practice — `recap.ts` step 10, lines 441-454, sets them together), the output string is `"15 WEEKS TO "` with a trailing space and empty location.

This is defensive coding that is technically correct. The `?? ""` guard prevents a TS error on `.toUpperCase()` against `string | null`. In practice, `targetDateLabel` is never null when `weeksToTarget` is non-null; see `recap.ts:441` where both are populated in the same `if`-block.

No fix required. The guard is appropriate.

### CONCERN-4 — `display` absent on vertical divider `<div>` inside `StatGrid` — matches existing pattern, no action needed

The proposed `StatGrid` divider: `<div key={slot.key + "-div"} style={{ width: 1, backgroundColor: tok.statDivider }} />` has no `display` property. Satori defaults all elements to `display: flex`. The current code dividers at lines 602 and 628 use the identical style object without `display` and render correctly today. No regression; flagged only to confirm the blueprint intentionally mirrors the existing pattern.

---

## Suggestions

### SUG-1 — Middot character: copy from line 293, not from the PRD or blueprint document

The `program-week` string uses `·` (U+00B7 MIDDLE DOT). Markdown renderers and font substitution can silently replace this with a hyphen (`-`, U+002D), en-dash (`–`, U+2013), or bullet (`•`, U+2022). The blueprint reproduces the string from PRD §3.1, which is rendered Markdown.

**Concrete action:** When editing lines 291-294 in the feed card and 780-783 in SlideOne, copy the `·` character directly from the existing line 293 in the source file — not from any Markdown document. Running `grep -P '\xc2\xb7' src/lib/recap-card.tsx` after the edit should return 2 hits (one per derivation). If 0, the character was corrupted.

### SUG-2 — Confirm `{programLine && ...}` render blocks are untouched at both sites

The blueprint says "the existing `{programLine && ...}` render stays." The render block at lines 334-346 (feed) and 810-813 (SlideOne) must not be touched. The Developer changes only the `const programLine = ...` derivation above each. If the render block is accidentally altered, the "none" case (where `programLine` is null) would no longer suppress the header div — creating an empty element in the card.

Verify with `grep -n "programLine &&" src/lib/recap-card.tsx` → expect 2 hits, unchanged.

---

## Verification of blueprint invariants (evidence)

### Byte-identical fitness — 4-slot trace

`recap.statSlots` for fitness is resolved in `computeWeeklyRecap()` step 13 (`recap.ts:500-508`) via `resolveStatSlot` against the `FITNESS_PRESENTATION.statSlots` (`goal-presentation.ts:61-86`). Tracing each slot against the current hardcoded values:

| Slot key | `resolveStatSlot` output `value` | Current feed card value | Match |
|----------|----------------------------------|------------------------|-------|
| `workouts` | `fmtByFormat(workoutsCompleted, "int")` → `String(n)` | `String(recap.workoutsCompleted)` (line 596) | ✓ |
| `volume` | `fmtByFormat(volumeLb, "volumeLb")` → `fmtVolume(v)` | `fmtVolume(recap.volumeLb)` (line 605) | ✓ |
| `prs` | `fmtByFormat(prCount, "int")` → `String(n)` | `String(recap.prCount)` (line 622) | ✓ |
| `elevation` | `fmtByFormat(hikeElevationFt, "elevationFt")` → `fmtElevation(v)` | `fmtElevation(recap.hikeElevationFt)` (line 631) | ✓ |

| Slot key | `isNull` from `resolveStatSlot` | Current `isNull` prop | Match |
|----------|--------------------------------|-----------------------|-------|
| `workouts` | `workoutsCompleted === null` → always false (typed `number`) | `isNull={false}` (line 600) | ✓ |
| `volume` | `volumeLb === null` | `isNull={recap.volumeLb === null}` (line 609) | ✓ |
| `prs` | `prCount === null` → always false (typed `number`) | `isNull={false}` (line 625) | ✓ |
| `elevation` | `hikeElevationFt === null` | `isNull={recap.hikeElevationFt === null}` (line 635) | ✓ |

`StatGrid` 4-slot DOM trace (fitness):
- `rows = [[slot0_workouts, slot1_volume], [slot2_prs, slot3_elevation]]`
- Row 0: `ri=0`, `ri < 1` → borderBottom applied; `flatMap` → `[<StatCell:workouts/>, <div:volume-div/>, <StatCell:volume/>]`
- Row 1: `ri=1`, `ri < 1` = false → no borderBottom; `flatMap` → `[<StatCell:prs/>, <div:elevation-div/>, <StatCell:elevation/>]`
- Outer div: `flex:1, display:"flex", flexDirection:"column"` — matches line 578-583

This is structurally identical to the current 2×2 grid. ✓

### Missed sites — confirmed exactly 2 ring labels, 2 programLines, 2 stat grids

```
grep -n "READINESS" src/lib/recap-card.tsx  →  413 (feed), 842 (SlideOne)
```
SlideThree has `DAY STREAK` below its ring — not a ring label, not touched. ✓

```
grep -n "programLine" src/lib/recap-card.tsx  →  291-294 (feed derivation), 334 (feed render), 780-783 (SlideOne derivation), 810 (SlideOne render)
```
Both derivation sites (291, 780) are in scope. Both render sites (334, 810) are preserved. ✓

```
grep -n "fmtVolume\|fmtElevation\|recap\.workoutsCompleted\|recap\.volumeLb\|recap\.prCount\|recap\.hikeElevationFt" src/lib/recap-card.tsx
```
Hits: line 10 (import), 596/605/609/622/631/635 (feed grid), 939/941/944/946 (SlideTwo grid). All 8 use-sites are in the two grids being replaced. After replacement, `fmtVolume` and `fmtElevation` are unused everywhere in the file — removing the import is required and correct. ✓

`recap.statSlots` is a `ResolvedStatSlot[]` field on `WeeklyRecap` (`recap.ts:127`). It is exported from `@/lib/recap` via the `ResolvedStatSlot` type at `recap.ts:88`. The blueprint's import addition is correct. ✓

### SlideThree "On to Week N" — stays, correctly guarded

Lines 1016-1029: `{recap.header.programWeek !== null && ...}`. For a project goal, `programWeek` is null (`recap.ts:462`) → the line is hidden. No change needed, PRD §2 explicitly scopes it out. ✓

### Satori constraints — all honored

- Flat children arrays (no `React.Fragment`): `flatMap` returns `JSX.Element[]`; `rows.map` returns `JSX.Element[]`. React renders both as flat sibling lists. ✓
- Explicit `display` on all container elements: `StatGrid` root (`display:"flex"`), every row div (`display:"flex"`), `StatCell` root (`display:"flex"`). Leaf divider has no display — Satori defaults to flex; matches existing dividers at 602/628. ✓
- Keys on every mapped element: `key={ri}` on rows, `key={slot.key}` on cells, `key={slot.key+"-div"}` on dividers. ✓
- No `React.Fragment`, no `conic-gradient`, no `gridTemplate`, no `var(--...)`, no CSS classes. ✓
- `ProgressRing` SVG with `stroke-dasharray` is untouched. ✓

### `presentationForGoal` is the only new import needed

`presentationForGoal` is exported from `goal-presentation.ts:126`. Only `fmtVolume` and `fmtElevation` are removed (their only 4 uses are in the two grids). `ResolvedStatSlot` is a type already exported from `recap.ts:88`. No other imports needed. ✓

---

## Verdict: APPROVE-WITH-FIXES

The architecture is sound. One fix is mandatory (CRIT-1). The rest are verification and care items.

**The single most important thing the Developer must get right — for both Satori and byte-identical fitness:**

> Replace the feed stat grid as lines **578–638** (not 584–638). The outer `<div style={{ flex: 1, display: "flex", flexDirection: "column" }}>` spanning lines 578-583 is the `StatGrid`'s own root element. Replacing from 578 swaps one `flex:1` column container for another — same style, same DOM position, zero extra nesting. Starting from 584 leaves an unclosed opening tag and creates a phantom extra flex layer that both breaks JSX and shifts every stat cell's height allocation.
