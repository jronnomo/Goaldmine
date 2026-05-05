# Goaldmine Rebrand — Atomic Requirements

Source PRD: `docs/prds/PRD-goaldmine-rebrand.md`
Branch: `feature/goaldmine-rebrand`

Each REQ is sized for a single Sonnet developer agent to ship inside a worktree. Streams (A/B/C/D/E) are independent enough to run in parallel.

---

## STREAM A — Palette + tokens (foundation, blocks B & C)

### REQ-A1 — Palette swap in `globals.css`
**Files**: `src/app/globals.css`
**Description**: Replace the existing palette with the Mineshaft & Bullseye tokens (final hex from PRD §4.1, possibly tweaked by UX research §6). Add new tokens: `--target`, `--target-fg`, `--success`, `--warning`, `--danger`, `--accent-soft`. Light + dark variants both. Wire display-font CSS variable (`--font-display`) into `@theme inline`.
**Acceptance**:
- `:root` block defines all listed tokens.
- `@media (prefers-color-scheme: dark)` block overrides background/foreground/muted/card/border/accent/accent-fg/accent-soft/target/target-fg/success/warning/danger.
- `grep "#2563eb\|#60a5fa" src/app/globals.css` returns zero matches.
- WCAG AA contrast verified (rely on UX research's adjusted values).
**Complexity**: S
**Dependencies**: UX research §6 must complete first.

### REQ-A2 — Display font wiring
**Files**: `src/app/layout.tsx`
**Description**: Import the chosen display font (UX §7 picks DM Serif Display / Playfair / IM Fell) via `next/font/google`. Expose a `--font-display` CSS variable on `<html>` alongside the existing Geist variables. Don't break the Geist body default.
**Acceptance**:
- `next/font/google` import for the chosen font.
- Variable exposed on `<html>` className: `${geistSans.variable} ${geistMono.variable} ${displayFont.variable}`.
- `font-display: swap` (default for next/font/google).
**Complexity**: S
**Dependencies**: UX research §7.

### REQ-A3 — Hardcoded color → semantic token migration
**Files**: All files matched by `grep -rn "text-red-500\|text-amber-500\|text-emerald-500\|border-red-500\|border-amber-500\|border-emerald-500\|bg-red-500\|bg-amber-500\|bg-emerald-500" src/` — approximately:
- `src/components/{PlanChangelog,GoalCreateForm,LogBaselineForm,GoalReferences,ReviseForm,SnapshotView,LogBaselineInlineForm,EditBaselineForm,DayNoteForm,ImportForm,CalendarMonth,GoalEditForm,DayOverrideForm,LogNutritionForm,EditNutritionForm}.tsx`
- `src/app/calendar/page.tsx`, `src/app/days/[dateKey]/page.tsx`, `src/app/baselines/page.tsx`, `src/app/goals/page.tsx`, `src/app/goals/[id]/plan/page.tsx`, `src/app/goals/[id]/revisions/[revisionId]/page.tsx`

Migrate `text-red-500` / `border-red-500/40` / `bg-red-500/10` → `text-[var(--danger)]` / `border-[var(--danger)]/40` / `bg-[var(--danger)]/10` (or use `--accent-soft`-style alpha variant if defined in REQ-A1).
Migrate `text-amber-500` / `border-amber-500/40` → `text-[var(--warning)]` / `border-[var(--warning)]/40`.
Migrate `text-emerald-500` (used for "logged" checkmarks) → `text-[var(--success)]` UNLESS the location is being replaced wholesale by a `<Bullseye filled />` (BaselineBlockCard, CalendarMonth — those are handled in REQ-D1/D2).

**Acceptance**:
- `grep -rn "text-red-500\|text-amber-500\|text-emerald-500\|border-red-500\|border-amber-500\|border-emerald-500\|bg-red-500\|bg-amber-500\|bg-emerald-500" src/` returns zero matches.
- TypeScript compiles. Lint clean.
**Complexity**: M
**Dependencies**: REQ-A1 (tokens must exist).

---

## STREAM B — Brand components (depends on A1, blocks D)

### REQ-B1 — `<Logo>` SVG component
**Files**: NEW `src/components/Logo.tsx`
**Description**: Server component. Inline SVG of treasure chest brimming with red/white circular targets. Composition per UX research §1 (recommended option). Props: `size?: number = 32`, `className?: string`. Use `viewBox="0 0 64 64"` (or whatever UX recommends) so it scales crisply at 24/28/32/48/192/512 px. Use `var(--accent)` for chest gold, `var(--target)` for target red, `currentColor` or `var(--target-fg)` for white rings.
**Acceptance**:
- Component exports default-or-named (consistent with other components — check `Card.tsx` style).
- Renders inline `<svg>` with no external assets.
- `aria-label="Goaldmine"` and `role="img"`.
- Visually identifiable as treasure chest + targets at 28 px (verify in QA browser smoke).
**Complexity**: M
**Dependencies**: UX research §1.

### REQ-B2 — `<Bullseye>` SVG component
**Files**: NEW `src/components/Bullseye.tsx`
**Description**: Server component. Concentric red/white target. Props: `size?: number = 16`, `filled?: boolean = false`, `progress?: number` (0–1, optional), `className?: string`, `aria-label?: string`. Per UX §2:
- Hollow (default): outer ring stroke + center dot only (or whatever UX recommends).
- Filled: solid red center → white ring → red ring → white ring (or the recommended canonical spec).
- Progress (when provided): partial fill per UX §5 recommendation (likely radial wedge or ring fill).
**Acceptance**:
- Renders inline `<svg>` at the requested `size`.
- `filled={true}` and `filled={false}` produce visually distinct outputs.
- `progress={0}` ≡ hollow; `progress={1}` ≡ filled.
- When `aria-label` is omitted, render `aria-hidden="true"`.
**Complexity**: M
**Dependencies**: UX research §2 + §5.

### REQ-B3 — `<AppHeader>` component
**Files**: NEW `src/components/AppHeader.tsx`
**Description**: Server component. Slim sticky header rendering `<Logo size={28} />` + "Goaldmine" wordmark in display font. Height ≤ 48 px. Renders on every page.
**Acceptance**:
- Imports `<Logo>` from REQ-B1.
- Wordmark uses the display-font CSS variable from REQ-A2 (e.g., `font-family: var(--font-display)`).
- Sticky-top, semi-transparent backdrop (matching BottomNav pattern: `bg-[var(--background)]/95 backdrop-blur`).
- 390 px width responsive — wordmark + logo + (optional) right-side slot all fit.
**Complexity**: S
**Dependencies**: REQ-B1, REQ-A2.

---

## STREAM C — Layout integration + branding strings

### REQ-C1 — Layout updates
**Files**: `src/app/layout.tsx`
**Description**:
- Update `metadata.title` to `"Goaldmine"`.
- Update `metadata.description` to a short Goaldmine-aligned line (e.g., `"Mining for goals — 90-day Mt. Elbert prep, shred, and longevity tracker."`).
- Render `<AppHeader />` between `<body>` and `<main>`.
- Update `viewport.themeColor` to the new dark `--background` hex (from REQ-A1 final value).
- Adjust `pb-20` on `<main>` if the new AppHeader requires a `pt-X` to clear it (sticky-top headers need top padding on the main content).
**Acceptance**:
- File compiles, renders, and the title shows "Goaldmine" in the document tab.
- AppHeader visible on every route.
**Complexity**: S
**Dependencies**: REQ-B3, REQ-A1.

### REQ-C2 — PWA manifest update
**Files**: `public/manifest.webmanifest`
**Description**:
- `"name": "Goaldmine"`
- `"short_name": "Goaldmine"`
- `"description"`: short Goaldmine line
- `"theme_color"`: new dark `--background` hex
- `"background_color"`: new dark `--background` hex
- `icons`: keep `/icon-192.png` and `/icon-512.png`; add `{ "src": "/icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any" }` as the first entry (so SVG is preferred where supported).
**Acceptance**:
- Valid JSON.
- All listed fields present and updated.
- Manifest validates against Web App Manifest spec.
**Complexity**: S
**Dependencies**: REQ-D5 (icon assets).

### REQ-C3 — Public asset cleanup
**Files**: DELETE `public/next.svg`, `public/vercel.svg`, `public/file.svg`, `public/globe.svg`, `public/window.svg`
**Description**: Confirm zero references via `grep -rn "next.svg\|vercel.svg\|file.svg\|globe.svg\|window.svg" src/` then delete.
**Acceptance**:
- All five files removed.
- `npx tsc --noEmit` and `npm run build` still pass.
**Complexity**: S
**Dependencies**: None.

---

## STREAM D — Motif integration (depends on B1/B2)

### REQ-D1 — `BaselineBlockCard` bullseye indicator
**Files**: `src/components/BaselineBlockCard.tsx`
**Description**: Replace `<span className="text-emerald-500 mr-1">✓</span>` (line ~39) with `<Bullseye filled size={14} aria-hidden="true" />`. Add `<Bullseye size={14} aria-hidden="true" />` to unlogged tests for parity (so the row layout is consistent — both states show a bullseye, only fill differs).
**Acceptance**:
- All test rows show a leading Bullseye.
- Logged tests render `filled`; unlogged render hollow.
- Existing `opacity-70` / `font-medium` styling preserved.
**Complexity**: S
**Dependencies**: REQ-B2.

### REQ-D2 — `CalendarMonth` day-status dot
**Files**: `src/components/CalendarMonth.tsx`
**Description**: Per UX §4 placement recommendation:
- Days with `workoutCount > 0` render a `<Bullseye filled size={10} />` in the placement UX picked (corner vs center).
- Today: keep the ring/border treatment but recolor to `var(--accent)` (already does via CSS variable swap — verify).
- Override star (`★`): recolor to `var(--warning)`.
- Remove `border-emerald-500/40 bg-emerald-500/5` for completed days; the bullseye is now the primary signal (decide with Architect whether to keep a faint completed-day bg tint via `--success-soft` or rely on bullseye alone).
**Acceptance**:
- Completed days show a Bullseye.
- Today still visually distinct.
- Override star recolored.
- No `text-emerald-500` / `border-emerald-500` / `text-amber-500` / `border-amber-500` left in this file.
**Complexity**: M
**Dependencies**: REQ-B2, UX research §4.

### REQ-D3 — `BottomNav` active-tab indicator
**Files**: `src/components/BottomNav.tsx`
**Description**: Per UX §3 recommendation:
- Active tab gets a `<Bullseye filled size={6} />` in the placement UX picked (above label vs underline vs replacement).
- Inactive tabs unchanged styling.
- Use `var(--accent)` for the indicator color.
- Add `aria-current="page"` to active link for accessibility.
**Acceptance**:
- Exactly one tab shows the indicator at any time (matches `pathname`).
- Tap targets remain ≥ 44 px.
- Visual change does not break the 5-column grid layout.
**Complexity**: S
**Dependencies**: REQ-B2, UX research §3.

### REQ-D4 — Goals page progress bullseye
**Files**: `src/app/goals/page.tsx`
**Description**: Render `<Bullseye progress={pct} size={20} />` next to each goal title. `pct` derives from existing goal/target metadata visible in the page (e.g., progress through the program duration, or target-vs-current numeric ratio — whatever the page already exposes; do NOT add new data fetching). Recolor any `text-amber-500 / text-red-500 / border-amber-500/40 / border-red-500/40` (lines ~60–62) to `--warning` / `--danger`.
**Acceptance**:
- Each goal row shows a Bullseye.
- `progress` is computed from existing data (no new Prisma query).
- Hardcoded color classes migrated.
**Complexity**: M
**Dependencies**: REQ-B2.

### REQ-D5 — PWA icon assets
**Files**: NEW `public/icon.svg`, NEW `public/icon-192.png`, NEW `public/icon-512.png`, optional NEW `scripts/render-icons.ts`
**Description**: Author `public/icon.svg` (square viewBox; can reference the same SVG geometry as `<Logo>` but at icon-density). For PNGs:
- **Preferred**: Architect adds `@resvg/resvg-js` as devDependency, ships `scripts/render-icons.ts`, runs `npx tsx scripts/render-icons.ts` to generate the PNGs, commits the PNGs.
- **Acceptable fallback**: ship `icon.svg` only and update REQ-C2 manifest to omit PNG entries.
**Acceptance**:
- `public/icon.svg` exists.
- Either both PNGs exist (preferred) OR PRD updated to reflect SVG-only fallback.
- `npm run build` doesn't 404 on icon paths.
**Complexity**: M
**Dependencies**: UX research §1 (logo composition).

---

## STREAM E — Polish (low priority, can ship in iteration 2 if needed)

### REQ-E1 — Empty-state copy refresh
**Files**: TBD per UX research §8 — typically `src/app/page.tsx` (no program), `src/app/baselines/page.tsx` (no baselines), `src/app/goals/page.tsx` (no goals), `src/app/journal/page.tsx` (no notes), `src/app/calendar/page.tsx` (no completed days).
**Description**: Replace generic empty-state copy with the lines UX §8 produces.
**Acceptance**: Each empty state uses the new copy. No generic placeholders remain in those five flows.
**Complexity**: S
**Dependencies**: UX research §8.

### REQ-E2 — Form input focus rings + button styling
**Files**: All `*Form*.tsx` files in `src/components/` (~12 files).
**Description**: Verify form input focus rings use `var(--accent)` (Tailwind's `focus:ring-[var(--accent)]` or equivalent). Verify primary submit buttons use the unified `bg-[var(--accent)] text-[var(--accent-fg)]` pattern. Destructive buttons use `--danger`.
**Acceptance**: Visual consistency across forms; no orphan focus styles.
**Complexity**: S (mostly verification)
**Dependencies**: REQ-A1.

### REQ-E3 — Recharts visual verification
**Files**: `src/components/{WeightChart,ReadinessChart,HistoryChart}.tsx`
**Description**: Verify charts render correctly in the new palette via the CSS variable indirection. No code change expected; if any chart explicitly hardcodes a color, migrate it.
**Acceptance**: All three chart components render in QA without color regressions.
**Complexity**: S (verification)
**Dependencies**: REQ-A1.

---

## Cross-cutting acceptance (REQ-X)

- `grep -rn "Workout Planner" src/ public/` returns zero matches.
- `grep -rn "#2563eb\|#60a5fa" src/ public/` returns zero matches.
- `grep -rn "text-red-500\|text-amber-500\|text-emerald-500\|border-red-500\|border-amber-500\|border-emerald-500\|bg-red-500\|bg-amber-500\|bg-emerald-500" src/` returns zero matches.
- `npx tsc --noEmit` returns 0 errors.
- `npm run lint` introduces no new errors.
- `npm run build` succeeds.
- MCP `tools/list` curl returns the existing tool list unchanged in shape and count.

## Suggested agent assignment

- **Agent 1 (Foundation)**: REQ-A1, REQ-A2 — palette + font wiring. Blocks everyone else.
- **Agent 2 (Brand components)**: REQ-B1, REQ-B2, REQ-B3 — Logo, Bullseye, AppHeader. Blocks D1–D4.
- **Agent 3 (Color migration)**: REQ-A3 — sweep all hardcoded colors. After Agent 1.
- **Agent 4 (Motif consumers)**: REQ-D1, REQ-D2, REQ-D3, REQ-D4 — wire Bullseye into BaselineBlockCard, CalendarMonth, BottomNav, goals page. After Agent 2.
- **Agent 5 (Layout + meta + cleanup)**: REQ-C1, REQ-C2, REQ-C3, REQ-D5 — layout, manifest, asset cleanup, icons. After Agent 2 (for Logo).
- **Agent 6 (Polish, opt)**: REQ-E1, REQ-E2, REQ-E3 — empty-state copy, form/button polish, chart verification. Run last or in iteration 2.

Agent 1 must finish before 2/3/4/5 can land merges (they all depend on tokens). Agent 2 must finish before 4/5. The orchestrator will sequence: A → (parallel: A3, B) → (parallel: D1–4, C, D5) → E.
