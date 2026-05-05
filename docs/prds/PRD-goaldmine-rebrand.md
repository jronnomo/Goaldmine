# PRD: Goaldmine Rebrand

**Author**: Claude (Tech Lead) + Gabe
**Date**: 2026-05-05
**Status**: Complete
**GitHub Issue**: N/A — feature branch + PR (no issue)
**Branch**: `feature/goaldmine-rebrand`

---

## 1. Overview

### 1.1 Problem Statement

The app currently ships with placeholder Next.js / "Workout Planner" branding — generic blue accent (`#2563eb` / `#60a5fa`), Geist-only type, no logo, leftover Vercel template SVGs in `public/`, and PWA manifest pointing to icon files that don't exist (`/icon-192.png`, `/icon-512.png` are 404s). The product has matured well past its scaffold but the visual identity hasn't caught up. The user wants a real brand — **Goaldmine** — that reflects the metaphor: mining for goals, with a Colorado gold-rush aesthetic and a recurring red/white target (bullseye) motif tied to the "hitting your target" idea.

### 1.2 Proposed Solution

A **theme + visual identity refresh, no functional changes**. We rename the app to **Goaldmine** in every user-visible string (PWA, page title, header), replace the blue accent with a Colorado gold-rush palette ("Mineshaft & Bullseye": deep coal + nugget gold + barn red + cream), and introduce two reusable brand components — a `<Logo>` SVG (treasure chest brimming with red/white target circles) and a `<Bullseye>` SVG (red/white concentric target). The Bullseye becomes a recurring UI motif: logged-baseline indicator, calendar day-status dot, active-bottom-nav indicator, and goal-progress badge.

We keep the existing CSS-variable theming pattern (`globals.css`) and the existing component shapes (`<Card>`, forms, charts) — the rebrand is layered on top: change the variables, swap the active-state primitives, render the brand assets in the header and nav. Light + dark modes both ship; dark stays the default. Recharts colors and form input styling are updated to the new palette. Zero data-model, zero MCP-tool, and zero server-action changes.

### 1.3 Success Criteria

- "Workout Planner" no longer appears in any user-visible string; "Goaldmine" appears in PWA name, document title, and header wordmark.
- Blue (`#2563eb` / `#60a5fa`) is gone from `globals.css`; new palette tokens are in place.
- A `<Logo>` SVG component renders in the page header on every route.
- A `<Bullseye>` SVG component is consumed by `BaselineBlockCard`, `CalendarMonth`, `BottomNav`, and `goals/page.tsx`.
- PWA install prompt shows a Goaldmine icon (no more 404 on `/icon-192.png` / `/icon-512.png`) — at minimum via SVG `<link rel="icon">`; ideally with PNG fallbacks generated from the SVG.
- Light + dark themes both meet WCAG AA contrast (≥ 4.5:1 for body text, ≥ 3:1 for UI primitives).
- `npx tsc --noEmit`, `npm run lint`, and `npm run build` all pass clean.
- All existing flows (Today, Calendar, Records, Goals, Journal, Nutrition) walk cleanly at 390 px width with no regressions.

---

## 2. User Stories

| ID     | As Gabe (the user)... | I want... | So that... | Priority |
|--------|-----------------------|-----------|------------|----------|
| US-001 | opening the PWA on my phone | the app to feel like a real product called Goaldmine | the daily-use logger feels intentional and motivating, not like a Vercel scaffold | Must |
| US-002 | glancing at Today | logged baselines marked with a filled bullseye and unlogged ones with a hollow target | I can read completion at a glance via a brand-consistent symbol | Must |
| US-003 | scanning the month calendar | days with logged workouts marked with a small filled bullseye dot | the calendar reinforces the "hit your target" metaphor and reads faster than the current border-tint scheme alone | Must |
| US-004 | reviewing my goals list | each goal showing a small target ring filled by % progress | I can see goal completion without opening the detail page | Must |
| US-005 | navigating between tabs | the active bottom-nav tab marked with a small bullseye underline/dot in nugget gold | the brand motif lives on every screen | Must |
| US-006 | installing the PWA | a Goaldmine treasure-chest icon on my home screen | the install feels finished and the icon is recognizable | Must |
| US-007 | using the app at night | dark mode reads comfortably with the new palette | low-light logging stays readable; dark mode is my default | Must |
| US-008 | hitting an error state | error copy uses a barn-red that's distinguishable from the brand bullseye-red | I can still tell errors from brand accents | Should |
| US-009 | seeing an empty state | the copy uses light mining-themed language ("nothing in the mine yet") | the brand voice carries through, not just visuals | Should |
| US-010 | waiting for data | loading skeletons feel branded | minor polish; nice-to-have | Nice |

---

## 3. Functional Requirements

### 3.1 Core Requirements

1. **Rename to Goaldmine** in every user-visible string — `src/app/layout.tsx` metadata (title + description), `public/manifest.webmanifest` (`name`, `short_name`, `description`).
2. **Replace the color palette** in `src/app/globals.css` with the Mineshaft & Bullseye tokens (full hex values in §4.1). Light + dark variants both ship; dark default.
3. **Introduce semantic color tokens** beyond the existing `--accent`: add `--target` (bullseye barn-red), `--success`, `--warning`, `--danger`. All hardcoded `text-red-500` / `text-amber-500` / `text-emerald-500` / `border-red-500/40` etc. across `src/components/` and `src/app/` migrate to the new tokens.
4. **Add display font** for the Goaldmine wordmark and major H1s — `DM Serif Display` (or `Playfair Display` — agent's call) loaded via `next/font/google`. Body and UI stay Geist.
5. **Create `src/components/Logo.tsx`** — inline SVG component, treasure chest with red/white target circles spilling from it. Renders at 24×24 px, 32×32 px, and 48×48 px via a `size` prop; must scale crisply via `viewBox`.
6. **Create `src/components/Bullseye.tsx`** — inline SVG concentric red/white target. Props: `size` (px), `filled` (boolean — filled = "logged/done", hollow = "pending"), `progress` (0–1, optional — when set, fills the inner ring proportionally).
7. **Page-level header** — add a slim header to `src/app/layout.tsx` (or a new `<AppHeader>` component) that renders `<Logo size={28} />` + "Goaldmine" wordmark in display font. Visible on every route, sticky-top is fine.
8. **`BaselineBlockCard`** — replace the green "✓" emoji marker with `<Bullseye filled />`; replace the implicit hollow state for unlogged tests with `<Bullseye />` (hollow).
9. **`CalendarMonth`** — replace the current border-tint scheme for completed days with a small `<Bullseye filled size={10} />` dot in the corner. Today's "ring" stays but recolors to `var(--accent)` (nugget gold). Override star (`★`) recolors to `var(--warning)`.
10. **`BottomNav`** — replace the active-tab text-color treatment with a small `<Bullseye filled size={6} />` centered above the label, in `var(--accent)`. Inactive tabs stay text-only in `var(--muted)`.
11. **`goals/page.tsx`** — render a `<Bullseye progress={pct} size={20} />` next to each goal title, computing `pct` from existing goal/target metadata (read-only, no schema change).
12. **PWA icon** — generate `/icon-192.png` and `/icon-512.png` from the `<Logo>` SVG (Architect picks the export approach — recommended: ship a static SVG `icon.svg` referenced via the `icons` array AND a small Node script `scripts/render-icons.ts` using `sharp` or `resvg` that the Tech Lead runs once locally to produce the PNGs; PNGs committed). Acceptable fallback if PNG generation is too risky: ship `icon.svg` only and update the manifest to reference the SVG.
13. **Recharts color updates** — `WeightChart`, `ReadinessChart`, `HistoryChart` swap `var(--accent)` strokes to nugget gold (already covered if `--accent` updates), and any explicit `var(--muted)` stays. No code change needed beyond the variable swap, but verify visually.
14. **Cleanup** — delete unused Next-template SVGs from `public/`: `next.svg`, `vercel.svg`, `file.svg`, `globe.svg`, `window.svg`. Verify no references first (`grep -rn "next.svg\|vercel.svg\|file.svg\|globe.svg\|window.svg" src/`).
15. **Viewport `themeColor`** — update `src/app/layout.tsx` viewport export to use the new dark-mode background hex (so iOS status bar matches).

### 3.2 Secondary Requirements

16. **Empty-state copy refresh** — light mining-themed phrases on the major empty states: Today (no program), Records (no baselines logged), Goals (no goals), Journal (no notes), Calendar (no completed days). One concise pass; not flowery.
17. **Loading skeletons** — keep current skeleton structure; tint to use `var(--card)` and a subtle gold-tinted shimmer where skeletons exist.
18. **Form input focus rings** — verify focus outlines use `var(--accent)` (nugget gold) and meet contrast on both light + dark.
19. **Button styling pass** — primary buttons (the "Log" / "Save" / "Submit" patterns across `LogBaselineForm`, `LogMeasurementForm`, etc.) get a unified `bg-[var(--accent)] text-[var(--accent-fg)]` treatment if not already there. Destructive buttons use `--danger`.

### 3.3 Out of Scope

- **Functionality changes**: zero. No new features, no refactors of business logic, no MCP-tool surface changes, no Prisma schema changes, no server-action changes.
- **Animation overhauls**: aside from existing transitions and a possible subtle Bullseye fill animation when a baseline is logged (nice-to-have only), no new motion design.
- **Hand-drawn / illustrated logo art**: SVG is procedural and stylized — not a commissioned illustration. Final professional logo art is a future task.
- **Custom font hosting**: we use `next/font/google` for the display font; no self-hosting.
- **Brand voice rewrite of long-form copy**: the empty-state copy refresh is light. Help text, descriptions, and existing labels stay as written.
- **Accessibility audit beyond WCAG AA color contrast**: existing label/focus patterns are preserved; no new ARIA work.
- **Marketing site / external pages**: this is a single PWA; there is no marketing surface to brand.

---

## 4. Technical Design

### 4.1 Data Model (Prisma)

**No changes.** This rebrand does not touch `prisma/schema.prisma`. No migrations.

### 4.2 MCP Tool Surface

**No changes.** No tools added, removed, or modified. Reload of the claude.ai MCP connector is **not** required after deploy.

### 4.3 Server Actions

**No changes.** No new actions. Existing `revalidatePath` semantics are unchanged.

### 4.4 Pages / Components

**New components**:

| Path | Server/Client | Purpose |
|------|---------------|---------|
| `src/components/Logo.tsx` | Server | Inline SVG: treasure chest + red/white target circles spilling. Props: `size?: number = 32`, `className?: string`. |
| `src/components/Bullseye.tsx` | Server | Inline SVG: concentric red/white target. Props: `size?: number = 16`, `filled?: boolean`, `progress?: number` (0–1), `className?: string`, `aria-label?: string`. |
| `src/components/AppHeader.tsx` | Server | Renders `<Logo size={28} />` + "Goaldmine" wordmark in display font. Slim, sticky, top of every page. |

**Modified components**:

| Path | Change |
|------|--------|
| `src/app/layout.tsx` | Update metadata (title/description). Wire display font via `next/font/google`. Render `<AppHeader />` above `<main>`. Update `viewport.themeColor` to new dark bg hex. Adjust `pb-20` if header height changes layout. |
| `src/app/globals.css` | Replace palette. Add `--target`, `--success`, `--warning`, `--danger`, `--accent-soft` (low-alpha variant for tinted backgrounds). Add display-font CSS variable wiring. |
| `src/components/BottomNav.tsx` | Active tab gets a small filled bullseye dot above the label; inactive tabs unchanged. Use `var(--accent)`. |
| `src/components/Card.tsx` | No structural change; verify the rounded-2xl + border + bg-card combo reads correctly with new tokens. |
| `src/components/BaselineBlockCard.tsx` | Replace `<span className="text-emerald-500 mr-1">✓</span>` with `<Bullseye filled size={14} />`. Replace implicit hollow state with `<Bullseye size={14} />`. |
| `src/components/CalendarMonth.tsx` | Replace completed-day border-tint with a small `<Bullseye filled size={10} />` corner dot (keep the today border in `var(--accent)`). Remove `border-emerald-500/40 bg-emerald-500/5`; replace with `border-[var(--success-soft)]` (or just keep the bullseye as the only signal — Architect's call). Recolor override star (`★`) to `var(--warning)`. |
| `src/app/goals/page.tsx` | Render `<Bullseye progress={pct} size={20} />` next to each goal title. `pct` computed from existing data. Recolor amber/red goal-status borders to `var(--warning)` / `var(--danger)`. |
| `src/components/PlanChangelog.tsx`, `src/components/SnapshotView.tsx`, `src/app/days/[dateKey]/page.tsx`, `src/app/baselines/page.tsx`, `src/app/calendar/page.tsx`, `src/app/goals/[id]/plan/page.tsx`, `src/app/goals/[id]/revisions/[revisionId]/page.tsx` | Migrate hardcoded `text-amber-500` / `border-amber-500/40` to `var(--warning)` and `text-red-500` / `border-red-500/40` to `var(--danger)`. |
| All form components in `src/components/*Form*.tsx` | Migrate hardcoded `text-red-500 border-red-500/30 bg-red-500/10` error blocks to `var(--danger)` tokens. Verify focus rings use `var(--accent)`. |
| All chart components (`WeightChart`, `ReadinessChart`, `HistoryChart`) | No code change required if `var(--accent)` and `var(--muted)` update transparently. QA verifies visually. |
| `public/manifest.webmanifest` | Update `name`, `short_name`, `description`, `theme_color`, `background_color`. Add `/icon.svg` entry; keep `/icon-192.png` and `/icon-512.png` (with valid files now). |

**Files to delete** (if grep confirms zero references):

- `public/next.svg`, `public/vercel.svg`, `public/file.svg`, `public/globe.svg`, `public/window.svg`

**New files**:

- `public/icon.svg` — Goaldmine SVG icon (square, 512-viewBox-friendly).
- `public/icon-192.png` — generated from the SVG.
- `public/icon-512.png` — generated from the SVG.
- `scripts/render-icons.ts` — optional Node script using `sharp` or `@resvg/resvg-js` to render the SVG to PNG. Documented in the PR. If the Architect deems PNG generation too risky for an agent to ship, fall back to SVG-only and update the manifest.

### 4.5 Date / Time Semantics

**No date math changes.** No new MCP tools take dates. No new components depend on `@/lib/calendar` semantics. Existing override-aware reads are preserved.

### 4.6 Override-Awareness

**No new override-dependent views.** `BaselineBlockCard` (consumer of `Bullseye`) already receives data from `resolveDay(now)` upstream; we are only swapping the visual primitive, not the data path.

### 4.7 Third-Party Dependencies

- **`next/font/google`**: already a dependency; we add one more font import (`DM_Serif_Display` or `Playfair_Display`). Zero new packages.
- **PNG-from-SVG generation**: if the Architect picks the script approach, add `sharp` or `@resvg/resvg-js` as a `devDependency`. Justification: generates committed PNG assets locally; no runtime impact. If neither feels safe, ship SVG-only.

---

## 5. UI/UX Specifications

### 5.1 Palette — Mineshaft & Bullseye

Final hex values (Architect may refine ±5% lightness for contrast). All values are illustrative; the binding rule is the **role**, not the exact hex.

**Dark (default)**

| Token | Hex | Role |
|-------|-----|------|
| `--background` | `#0F0B07` | App background — deep coal / mineshaft |
| `--foreground` | `#F4E9D4` | Body text — cream parchment |
| `--muted` | `#9C8866` | Secondary text — weathered ochre |
| `--card` | `#1A130C` | Card surface — slightly lifted coal |
| `--border` | `#3A2E1F` | Borders — dark gilt |
| `--accent` | `#D4A437` | Primary brand — nugget gold |
| `--accent-fg` | `#0F0B07` | Text on accent — deep coal |
| `--accent-soft` | `rgba(212,164,55,0.12)` | Tinted bg for accent surfaces |
| `--target` | `#C0392B` | Bullseye red — barn-red / vermilion |
| `--target-fg` | `#FFFFFF` | White rings on target |
| `--success` | `#7FA45C` | Logged / completed — moss / sage |
| `--warning` | `#E0A95C` | Override / off-week — ochre |
| `--danger` | `#C0392B` | Errors — same as `--target` (intentionally unified) |

**Light** — adjusted by UX research for WCAG AA compliance (UX §6). Three tokens darkened from the initial draft.

| Token | Hex | Role | Notes |
|-------|-----|------|-------|
| `--background` | `#FAF3E3` | Cream parchment | — |
| `--foreground` | `#1F1408` | Near-black ink | — |
| `--muted` | `#7A5E3A` | Weathered umber | — |
| `--card` | `#FFFBF0` | Lifted parchment | — |
| `--border` | `#D9C8A2` | Aged paper edge | — |
| `--accent` | `#8A6212` | Deep antique gold | **Adjusted from `#A87A1F` → 5.29:1 vs accent-fg (was 3.71:1, failed AA)** |
| `--accent-fg` | `#FFFBF0` | Text on accent | — |
| `--accent-soft` | `rgba(138,98,18,0.14)` | Tinted bg | rgba updated to match new accent |
| `--target` | `#A82A1F` | Barn red | — |
| `--target-fg` | `#FFFBF0` | White rings | — |
| `--success` | `#4E6B36` | Pine green | **Adjusted from `#5C7A40` → 5.46:1 on bg (was 4.40:1)** |
| `--warning` | `#9C5F14` | Burnt umber | **Adjusted from `#B8741C` → 4.68:1 on bg (was 3.42:1)** |
| `--danger` | `#A82A1F` | Errors | unified with `--target` |

WCAG AA: all body-text + UI-primitive pairs verified by UX research (full ratio table in `docs/ux-research/goaldmine-rebrand.md` §6). Dark mode passes as proposed; no changes needed there.

### 5.2 Screen Descriptions

ASCII mockups at 390 px phone width. Layout shapes are unchanged from current; only the visual primitives change.

**Today (`/`) — header + workout card**

```
┌──────────────────────────────────────┐
│ ⚒  GOALDMINE              [import]  │  ← AppHeader: Logo + display-font wordmark
├──────────────────────────────────────┤
│ WEEK 7 · PHASE 2 · STRENGTH + CAP   │  ← muted ochre, uppercase tracking
│ Tuesday, May 5                      │  ← cream foreground
│                                      │
│ ┌──────────────────────────────────┐ │
│ │ 1. Initial baselines (2/3)      │ │
│ │ Tests · do these fresh          │ │
│ │                                  │ │
│ │ ◉ Deep squat hold   45s   [log] │ │  ← ◉ = filled Bullseye (logged)
│ │ ◉ Toe-touch reach   +2"   [log] │ │
│ │ ◯ 10-yd shuttle     —     [log] │ │  ← ◯ = hollow Bullseye (pending)
│ └──────────────────────────────────┘ │
│                                      │
│ ┌──────────────────────────────────┐ │
│ │ 2. Lower-body strength          │ │
│ │ ...                              │ │
│ └──────────────────────────────────┘ │
└──────────────────────────────────────┘
│  Today    Cal    ◉ Records   Goals   Journal │  ← active tab: small ◉ above label
└──────────────────────────────────────┘
```

**Calendar (`/calendar`) — month grid**

```
┌──────────────────────────────────────┐
│ ⚒  GOALDMINE                         │
├──────────────────────────────────────┤
│ May 2026             [<]  [>]        │
│                                      │
│  Mon Tue Wed Thu Fri Sat Sun         │
│  ┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐       │
│  │ 1││ 2││ 3││ 4││ 5││ 6││ 7│       │
│  │◉ ││◉ ││◉ ││  ││★◯││  ││  │       │  ← ◉ = workout logged, ★ = override
│  └──┘└──┘└──┘└──┘└──┘└──┘└──┘       │   today gets gold border
│  ...                                 │
└──────────────────────────────────────┘
```

**Goals (`/goals`) — list with progress bullseye**

```
┌──────────────────────────────────────┐
│ Goals                          [+]   │
│                                      │
│ ┌──────────────────────────────────┐ │
│ │ ◐ Mt. Elbert via Black Cloud    │ │  ← Bullseye filled to ~40% progress
│ │   Hero · 2026-08-12              │ │
│ │   2.5 / 5,200 ft cumulative gain │ │
│ └──────────────────────────────────┘ │
│ ┌──────────────────────────────────┐ │
│ │ ◑ Cut to 155 lb lean             │ │  ← ~70% filled
│ │   2026-07-01                     │ │
│ └──────────────────────────────────┘ │
└──────────────────────────────────────┘
```

**Login / error (any form)**

Error block:
```
┌──────────────────────────────────┐
│ ⚠ Couldn't save: invalid value   │  ← --danger fg, --danger/10 bg, --danger/30 border
└──────────────────────────────────┘
```

### 5.3 Navigation Flow

Unchanged. Bottom nav stays 5 tabs; routes are identical. The visual rebrand layers on top of existing navigation.

### 5.4 Responsive + Mobile-First Spec

- Primary width: **390 px** (iPhone-class PWA).
- AppHeader height ≤ 48 px so it doesn't dominate.
- Tap targets ≥ 44 px (Bottom-nav tabs already comply; verify Bullseye-bearing buttons stay tap-safe).
- Logo+wordmark fits comfortably in a 360 px viewport min.
- All forms remain thumb-reachable at the bottom of the page.
- Card-based layout (`<Card>`) preserved.
- Tailwind tokens: `var(--accent)`, `var(--accent-fg)`, `var(--target)`, `var(--success)`, `var(--warning)`, `var(--danger)`, `var(--border)`, `var(--card)`, `var(--muted)`, `var(--background)`, `var(--foreground)`. **No hardcoded `text-red-500` / `text-amber-500` / `text-emerald-500` / `text-blue-*` allowed.** Hardcoded color classes are an automated grep failure in QA.

### 5.5 Accessibility

- Form labels and focus rings preserved; verify focus rings are visible on the new accent gold (especially on cream background — light mode is the contrast risk).
- Bullseye SVG has `role="img"` and `aria-label`; when used purely decoratively (e.g., next to a text label that already announces state), use `aria-hidden="true"` and let the surrounding text carry semantics.
- Color is **never** the only signal. Examples: logged baselines also have the existing checkpoint label; override days also have the `★` glyph; active nav tab also has `aria-current="page"`. Color contrast is gravy on top of structural cues.
- `--muted` text passes ≥ 4.5:1 against `--background` in both modes (Architect: verify with a contrast checker; tweak hex if needed).

---

## 6. Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|------------------|
| User has `prefers-color-scheme: light` | Light palette renders; Goaldmine wordmark / Logo SVG read crisply on cream. |
| User has `prefers-color-scheme: dark` | Dark palette renders; default. |
| Browser without `prefers-color-scheme` (rare) | Dark palette serves as the `:root` default. |
| iOS PWA install — no PNG icons present | Fall back to `icon.svg` (manifest order). If Apple ignores SVG icons, ship the PNGs (preferred). |
| User has reduced-motion preference | Bullseye motif is static; no animations gated on motion. Optional fill animation (if added) respects `prefers-reduced-motion: reduce`. |
| Long goal title at 390 px | Title truncates with `text-ellipsis`; Bullseye stays right-aligned. |
| Goal with no progress data | `<Bullseye progress={0} />` renders as hollow (no ring fill). |
| Calendar day with both override AND completed workout | Show both: `★` glyph + filled Bullseye dot. Stack order: Bullseye in corner, star opposite corner. |
| Empty Today (no program seeded) | "No active program" Card uses new tokens; copy unchanged. |
| Display font fails to load | `font-display: swap` (next/font default); falls back to Geist sans. Verify wordmark still reads "Goaldmine" and isn't mangled. |
| Hardcoded color classes left over | QA grep step fails → block ship. |
| WCAG AA contrast failure on `--muted` | Architect adjusts hex; verified in QA via manual contrast check. |

---

## 7. Security Considerations

- No new public routes. MCP bearer-token coverage unchanged.
- No new user input pathways. No Zod schemas added.
- SVG components use static, hand-authored markup — no `dangerouslySetInnerHTML`, no user-string interpolation.
- Display font loaded via `next/font/google` (self-hosted at build time per Next.js convention) — no third-party script tags, no privacy leak.
- New `devDependency` (`sharp` or `@resvg/resvg-js`) — if added, runs locally only, never in serverless. Justify in PR.

---

## 8. Acceptance Criteria

1. [ ] `npx tsc --noEmit` passes with 0 errors.
2. [ ] `npm run lint` introduces no new errors (existing warnings on unmodified files are not blockers).
3. [ ] `npm run build` succeeds (Turbopack production build).
4. [ ] `grep -rn "Workout Planner" src/ public/` returns zero matches.
5. [ ] `grep -rn "text-red-500\|text-amber-500\|text-emerald-500\|border-red-500\|border-amber-500\|border-emerald-500\|bg-red-500\|bg-amber-500\|bg-emerald-500" src/` returns zero matches.
6. [ ] `grep -rn "#2563eb\|#60a5fa" src/ public/` returns zero matches.
6a. [ ] `grep -rn "#A87A1F\|#5C7A40\|#B8741C" src/ public/` returns zero matches (unfixed pre-WCAG light-mode hex).
7. [ ] `src/app/globals.css` defines `--target`, `--success`, `--warning`, `--danger`, `--accent-soft` in both `:root` and the dark `prefers-color-scheme` block.
8. [ ] `src/components/Logo.tsx` exists, exports a server component, and renders inline SVG with viewBox enabling crisp scaling at 24/32/48 px.
9. [ ] `src/components/Bullseye.tsx` exists, supports `filled`, `progress`, `size`, `aria-label` props, and renders red/white concentric circles.
10. [ ] `src/components/AppHeader.tsx` exists and is rendered in `src/app/layout.tsx` above `<main>`.
11. [ ] `src/app/layout.tsx` imports a Google display font (DM_Serif_Display or Playfair_Display) via `next/font/google` and exposes its CSS variable.
12. [ ] `public/manifest.webmanifest` reads `"name": "Goaldmine"` (and updates `short_name`, `description`, `theme_color`, `background_color`).
13. [ ] `public/icon.svg` exists. Either both `public/icon-192.png` and `public/icon-512.png` exist as valid PNGs, OR the manifest references SVG-only icons (with a note in the PR explaining the fallback).
14. [ ] `BaselineBlockCard` renders `<Bullseye filled />` for logged tests and `<Bullseye />` for unlogged.
15. [ ] `CalendarMonth` renders a `<Bullseye filled />` dot for days with `workoutCount > 0`.
16. [ ] `BottomNav` active tab renders a `<Bullseye filled />` indicator above the label.
17. [ ] `goals/page.tsx` renders `<Bullseye progress={n} />` next to each goal title with `progress` derived from existing data.
18. [ ] `public/next.svg`, `public/vercel.svg`, `public/file.svg`, `public/globe.svg`, `public/window.svg` deleted (only if grep confirms zero references).
19. [ ] `viewport.themeColor` in `src/app/layout.tsx` matches the new dark `--background` hex.
20. [ ] No file imports `@/lib/calendar` newly (we add no date math). Existing imports unchanged.
21. [ ] No `prisma/schema.prisma` changes. No `src/lib/mcp/tools.ts` changes. No new server actions.
22. [ ] MCP curl smoke (`tools/list`) returns the existing tool set unchanged in shape and count.
23. [ ] Browser smoke at 390 px width: every bottom-nav tab + at least one deep route per tab loads without console errors and renders the new palette.
24. [ ] Dark mode and light mode both render correctly (verified by toggling `prefers-color-scheme` in DevTools).
25. [ ] WCAG AA contrast confirmed for `--foreground`/`--background`, `--muted`/`--background`, `--accent-fg`/`--accent` in both modes.

---

## 9. Open Questions — RESOLVED via UX research

UX research output: `docs/ux-research/goaldmine-rebrand.md`. All Phase-1 open questions are now closed.

- **Display font**: **DM Serif Display, weight 400** via `next/font/google`. (UX §7.) Cleanest at 20–24 px; geometric serif balances the procedural SVG logo. Playfair is the documented fallback if DM renders poorly on a specific device.
- **Logo composition**: **Option B — single hero target on chest** (one prominent 4-ring bullseye + 2 hollow flanking targets + flat gold trapezoid chest, viewBox `0 0 64 64`). Layer-by-layer composition spec in UX §1 — developer agent renders directly from that spec.
- **Bullseye anatomy**: viewBox `0 0 32 32`, ring count adapts by `size` prop (6/10/14/20 px → 1/2/3/4 rings). Hollow = single stroke ring in `--muted`. **Progress = ring fill, NOT wedge fill** — preserves the bullseye shape across all motif consumers; granularity is ¼ steps. (UX §2 + §5.)
- **Active bottom-nav indicator**: **6 px filled bullseye above the label** (Option A). Scored 37/50 vs alternatives; matches motif. Active label color stays `var(--accent)`; `aria-current="page"` mandatory. (UX §3.)
- **Calendar day-status dot placement**: **top-right corner stack** (existing icon-stack position), replacing the green ✓. Drop the emerald border/bg tints — bullseye carries "completed" alone. Today's cell keeps the gold border + low-alpha gold bg fill. Stack order: `🏔` → `★ override` → `◉ workout` → `◎N baselines-due`. (UX §4.)
- **Goal progress rendering**: **`<Bullseye size={20} progress={pct} />`** with ring fill, ¼ granularity. Precise progress communicated via the existing numeric label next to the bullseye. (UX §5.)
- **PWA icon PNGs**: **Architect picks** between (a) ship `scripts/render-icons.ts` + `@resvg/resvg-js` devDep + commit generated PNGs (preferred), or (b) ship `icon.svg` only and update manifest to drop PNG entries. Deferred to Phase 4 architecture.
- **Animation**: **One animation total** — `bullseye-pop` (320 ms scale + opacity, cubic-bezier(0.16, 1, 0.3, 1)) on baseline-log success. CSS keyframes in `globals.css`, gated by `prefers-reduced-motion: reduce`. Stretch goal — ship without if the `justLogged` plumbing into `BaselineBlockCard` proves invasive. (UX §9.)

### Empty-state copy (UX §8) — locked

| Surface | Copy |
|---------|------|
| Today (no program) | "**No active program.** Set up your 12-week plan to start logging." |
| Records (no baselines) | "**No baselines on the books yet.** Log your first test to start tracking what's improving." |
| Goals (no goals) | "**Nothing to aim at yet.** Add a goal — a date, a metric, or both." |
| Journal (no notes) | "**The journal's clean.** Drop a note here for instructions, feelings, or tomorrow's reminder." |
| Calendar (no completed days) | "**No completed days this month.** Logged workouts and overrides will land here as filled targets." |

---

## 10. Test Plan

### 10.1 Typecheck / Lint / Build

- `npx tsc --noEmit` — must be clean.
- `npm run lint` — no new errors.
- `npm run build` — Turbopack production build succeeds.

### 10.2 MCP curl smoke

The MCP surface is **unchanged**. Smoke is regression-only:

```sh
TOKEN="$(grep MCP_AUTH_TOKEN .env | cut -d'"' -f2)"
curl -s -X POST http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | python3 -m json.tool | head -40
```

Expected: tool list identical to pre-rebrand (count + names). Any diff = regression.

### 10.3 Browser smoke

1. `npm run dev`.
2. Open http://localhost:3000 at 390 px width (DevTools mobile emulation).
3. Walk: `/` → `/calendar` → `/days/<today>` → `/baselines` → `/baselines/new` → `/goals` → `/goals/<any>` → `/journal` → `/nutrition` → `/history` → `/import` → `/stats`.
4. On each, verify: AppHeader renders, no console errors, Bullseye renders where specified, palette is the new gold-rush tokens, fonts load (Geist body + display wordmark).
5. Toggle `prefers-color-scheme: dark` ↔ `light` in DevTools → both render correctly.
6. Cross-check Today against `get_today_plan` curl: `loggedNutrition`, `baselinesDue`, override `workoutTemplate` shapes unchanged.
7. Install the PWA on a real iPhone → confirm icon shows, name reads "Goaldmine".

### 10.4 Migration verification

**N/A** — no Prisma migration in this PR.

---

## 11. Appendix

### 11.1 Discovery Notes

User-confirmed decisions (Phase 1):
- App renamed: **Goaldmine** ("mining for goals").
- Logo: treasure chest brimming with red/white circular targets.
- Color scheme: Colorado gold rush — confirmed direction "**Mineshaft & Bullseye**" (deep coal + nugget gold + barn red + cream).
- Functionality unchanged.
- Workflow: feature branch + PR (`feature/goaldmine-rebrand`).
- Modes: light + dark, dark default.
- Logo asset: inline SVG component (with PNG icons if Architect deems achievable).
- Motif aggressiveness: **recurring** — logged baselines, calendar day-status, active bottom-nav, goal progress badge.
- Typography: Geist body + display font for wordmark/H1.
- All "out of scope" optional flourishes (charts, forms, empty-state copy, loading skeletons) **left in scope** by user (no exclusions selected) — but charts + forms are foundational; empty-state copy is light pass; skeletons are stretch.

### 11.2 References

- Recent commits providing brand-pre-rebrand baseline:
  - `a056ee8` feat: import feature-dev orchestration skill from Chewabl
  - `86f6b4e` MCP write tools: parse date-only strings as USER_TZ midnight
  - `c7aef56` Inline baseline logging on Today: log → checkmark, no navigation away
- Existing CSS variable system: `src/app/globals.css` (lines 3–35).
- Manifest: `public/manifest.webmanifest`.
- Brand-touched components inventory: ~40 files use `var(--accent|card|border|muted|foreground|background)`. ~20 files use hardcoded `text-red-500` / `text-amber-500` / `text-emerald-500` (full list captured in Phase 4 research output).
