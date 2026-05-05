# Goaldmine Rebrand — Architecture Blueprint

**Author**: Architect Agent (Opus)
**Date**: 2026-05-05
**Source PRD**: `docs/prds/PRD-goaldmine-rebrand.md`
**UX Research**: `docs/ux-research/goaldmine-rebrand.md`
**Atomic REQs**: `.feature-dev/2026-05-05-goaldmine-rebrand/phases/requirements.md`
**Research Output**: `.feature-dev/2026-05-05-goaldmine-rebrand/agents/research-output.md`
**Branch**: `feature/goaldmine-rebrand`

This blueprint is the single source of truth for the developer agents. It collapses the 6-stream proposal into 4 developer agents, locks every architectural decision, and pre-spec'd every file edit. **Developers should not need to re-read the PRD or UX research.**

---

## A. Final agent assignment

The 6-stream proposal in `requirements.md` is correct in dependency shape but over-fragmented for parallel execution. Compressed into **4 developer agents** with strict run-ordering:

### Agent 1 — Foundation (`agent-1-foundation`)
Owns palette + font wiring + globals.css + layout.tsx + manifest + asset cleanup. Touches `globals.css` exactly once (avoids worktree merge conflicts — see Risk 1).

- REQ-A1 (palette swap)
- REQ-A2 (display font wiring)
- REQ-C1 (layout updates: title/description/themeColor/AppHeader render — *AppHeader render line only; component built by Agent 2*)
- REQ-C2 (manifest update)
- REQ-C3 (public/ asset cleanup of next/vercel/file/globe/window.svg)
- Stream 6 keyframes (CSS only — `@keyframes bullseye-pop` + reduced-motion gate dropped into globals.css alongside palette)

**Caveat for REQ-C1**: Agent 1 wires `<AppHeader />` into `layout.tsx`, but the file `src/components/AppHeader.tsx` itself is owned by Agent 2. To prevent a broken intermediate state, Agent 1 imports + renders `<AppHeader />` and Agent 2 ships the component file in the same merge wave — orchestrator merges A1 → A2 in immediate succession.

### Agent 2 — Brand components (`agent-2-brand`)
Owns the three new SVG components + the static SVG icon + PNG generation script.

- REQ-B1 (`Logo.tsx`)
- REQ-B2 (`Bullseye.tsx`)
- REQ-B3 (`AppHeader.tsx`)
- REQ-D5 (`public/icon.svg`, `scripts/render-icons.ts`, `public/icon-192.png`, `public/icon-512.png`)

### Agent 3 — Color migration sweep (`agent-3-colors`)
Owns the hardcoded-Tailwind-hue → CSS-variable token migration across ~23 files.

- REQ-A3 (color migration sweep — every match from research §2 migration table)
- REQ-E1 (empty-state copy refresh) — bundled here because the empty-state strings live in the same page files (`src/app/page.tsx`, `baselines/`, `goals/`, `journal/`, `calendar/`) Agent 3 already touches.

### Agent 4 — Motif consumers (`agent-4-motif`)
Owns wiring `<Bullseye>` into the four consumer surfaces.

- REQ-D1 (`BaselineBlockCard`)
- REQ-D2 (`CalendarMonth`)
- REQ-D3 (`BottomNav`)
- REQ-D4 (`goals/page.tsx`)

### Sequencing

```
T0   Agent 1 (Foundation) ────────►  merge wave 1
T1                                   Agent 2 (Brand components) ────────►  merge wave 2
                                     Agent 3 (Color migration + empty states) ─┤  parallel with Agent 2
T2                                                                              Agent 4 (Motif consumers) ────────►  merge wave 3
```

- **Wave 1 (T0)**: Agent 1 alone. Globals.css + layout.tsx + manifest + asset cleanup. Establishes tokens + AppHeader render slot. **Blocks everyone.**
- **Wave 2 (T1, parallel)**: Agent 2 (creates component files) and Agent 3 (touches page/component files but never globals.css and never Agent 2's new component files). Both branch off Wave 1's merged state. Independent file sets — no merge conflicts.
- **Wave 3 (T2)**: Agent 4 alone. Depends on Agent 2's `<Bullseye>` and Agent 3's color migration (cleaner if migration is done first so Agent 4's edits to `BaselineBlockCard`/`CalendarMonth`/`BottomNav`/`goals/page.tsx` don't fight a parallel migration in those same files).

**Worktree convention**: each agent works in `worktrees/agent-N-<slug>/` off `feature/goaldmine-rebrand`. The orchestrator merges sequentially per wave (`agent-1-foundation` first, then both wave-2 worktrees, then wave-3). All four agent branches merge into `feature/goaldmine-rebrand`; the user opens the PR from `feature/goaldmine-rebrand` → `main` after QA passes.

---

## B. Global decisions to lock in

### B.1 PWA icons → CONFIRM Option (a)

Ship `scripts/render-icons.ts` + `@resvg/resvg-js` devDependency + commit generated PNGs.

**Script entry-point shape** (Agent 2 implements):

```ts
// scripts/render-icons.ts
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SVG_PATH = resolve(process.cwd(), "public/icon.svg");
const OUTPUTS: Array<{ size: number; out: string }> = [
  { size: 192, out: resolve(process.cwd(), "public/icon-192.png") },
  { size: 512, out: resolve(process.cwd(), "public/icon-512.png") },
];

const svg = readFileSync(SVG_PATH, "utf8");
for (const { size, out } of OUTPUTS) {
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: size } });
  const png = resvg.render().asPng();
  writeFileSync(out, png);
  console.log(`wrote ${out} (${size}x${size}, ${png.byteLength} bytes)`);
}
```

Add to `package.json`:
- `"icons": "tsx scripts/render-icons.ts"` under `scripts`.
- `"@resvg/resvg-js": "^2.6.2"` under `devDependencies`.

Agent 2 runs `npm install`, then `npm run icons`, commits both PNGs.

### B.2 bullseye-pop animation → CONFIRM (CSS only, drop React plumbing for MVP)

Ship `@keyframes bullseye-pop` + reduced-motion gate in `globals.css` (Agent 1). **Do not** plumb a `justLogged` flag through the form/page/card. Per Research §6 Option A: ship the keyframe so future iterations can pick it up; skip the component wiring.

### B.3 `@theme inline` updates → CONFIRM

Only add `--font-display` to `@theme inline`. The new color tokens (`--target`, `--target-fg`, `--success`, `--warning`, `--danger`, `--accent-soft`) are consumed via arbitrary-value syntax (`bg-[var(--target)]/40`, `text-[var(--danger)]`). Matches the existing repo pattern (which already uses `text-[var(--accent)]` and `bg-[var(--accent)]/10` everywhere). No new bare color utilities needed.

### B.4 CalendarMonth multi-workout days → CONFIRM

Single `<Bullseye filled size={10} />` regardless of `workoutCount`. Agent 4 does NOT add count signaling. The day-detail page (`/days/[dateKey]`) already exposes per-day workout details for users who need that granularity.

### B.5 Goals progress formula → CONFIRM (with status override)

```ts
function goalProgress(g: { createdAt: Date; targetDate: Date | null; status: string }): number | null {
  if (g.status === "achieved") return 1;
  if (g.status === "abandoned") return 0;
  if (!g.targetDate) return null; // hollow render (no progress to show)
  const total = new Date(g.targetDate).getTime() - new Date(g.createdAt).getTime();
  if (total <= 0) return 1;
  const elapsed = Date.now() - new Date(g.createdAt).getTime();
  return Math.max(0, Math.min(1, elapsed / total));
}
```

- `status === "achieved"` → 1 (full bullseye).
- `status === "abandoned"` → 0 (hollow ring).
- No `targetDate` → return `null`; component renders `<Bullseye />` (hollow, no `progress` prop).
- Otherwise → time-progress.

The numeric label next to the bullseye (existing `${days}d` / target date string) carries precise context.

### B.6 Empty-state copy → LOCKED

Lift exactly these strings into the relevant page components (Agent 3 owns this in REQ-E1 inside its bundle).

| Surface | File | Copy |
|---------|------|------|
| Today (no program) | `src/app/page.tsx` | `**No active program.** Set up your 12-week plan to start logging.` |
| Records (no baselines) | `src/app/baselines/page.tsx` | `**No baselines on the books yet.** Log your first test to start tracking what's improving.` |
| Goals (no goals) | `src/app/goals/page.tsx` | `**Nothing to aim at yet.** Add a goal — a date, a metric, or both.` |
| Journal (no notes) | `src/app/journal/page.tsx` | `**The journal's clean.** Drop a note here for instructions, feelings, or tomorrow's reminder.` |
| Calendar (no completed days) | `src/app/calendar/page.tsx` | `**No completed days this month.** Logged workouts and overrides will land here as filled targets.` |

Render the bold portion as `<strong>` (or `font-semibold` span); the rest as inline text. Single `<p>` per empty state, inside the existing empty-state container in each file.

### B.7 AppHeader right-side slot → CONFIRM (no slot)

`<AppHeader />` is brand-only — Logo + wordmark, no actions. The Today page's existing inline header row at `src/app/page.tsx:78` (with the `[import]` link) **stays untouched**. Page-specific actions remain in pages. Future iterations can add a slot if needed; MVP keeps the surface minimal.

---

## C. File-level blueprint

Grouped by agent, listed in dependency order within each section.

### Agent 1 — Foundation

#### C.1.1 `src/app/globals.css` — MODIFY (full rewrite — see §D for literal contents)

- **Owner**: Agent 1
- **Action**: Replace entire file with the literal content in §D.
- **Acceptance**:
  - `:root` block defines `--background, --foreground, --muted, --card, --border, --accent, --accent-fg, --accent-soft, --target, --target-fg, --success, --warning, --danger`.
  - `@media (prefers-color-scheme: dark) { :root { ... } }` block redefines the same set (per Risk 3 — every token must appear in BOTH blocks).
  - `@theme inline` includes `--font-display: var(--font-dm-serif-display);`.
  - `@keyframes bullseye-pop` defined.
  - `@media (prefers-reduced-motion: reduce) { .bullseye-pop { animation: none; } }` defined.
  - `grep "#2563eb\|#60a5fa" src/app/globals.css` → 0 matches.
  - `grep "#A87A1F\|#5C7A40\|#B8741C" src/app/globals.css` → 0 matches.

#### C.1.2 `src/app/layout.tsx` — MODIFY

- **Owner**: Agent 1
- **Specific changes**:
  - Add import: `import { DM_Serif_Display } from "next/font/google";` (alongside existing Geist imports).
  - Add font init:
    ```ts
    const dmSerifDisplay = DM_Serif_Display({
      variable: "--font-dm-serif-display",
      subsets: ["latin"],
      weight: "400",
      display: "swap",
    });
    ```
  - Add import: `import { AppHeader } from "@/components/AppHeader";`
  - Replace `metadata.title` with `"Goaldmine"`.
  - Replace `metadata.description` with `"Mining for goals — 90-day Mt. Elbert prep, shred, and longevity tracker."`
  - Replace `viewport.themeColor` with `"#0F0B07"` (matches dark `--background`).
  - On `<html className="...">`, append `${dmSerifDisplay.variable}` after `${geistMono.variable}`.
  - Inside `<body>`, render `<AppHeader />` BEFORE `<main>`.
  - Leave `<main className="flex-1 pb-20">` UNCHANGED — sticky header consumes flow space, no `pt-X` needed (Research §9).
- **Acceptance**:
  - `grep -n "Goaldmine" src/app/layout.tsx` → at least one match (in metadata.title).
  - `grep -n "DM_Serif_Display" src/app/layout.tsx` → ≥1 match.
  - `grep -n "AppHeader" src/app/layout.tsx` → ≥1 match.
  - `grep -n "#0F0B07" src/app/layout.tsx` → ≥1 match.
  - `npx tsc --noEmit` clean.

#### C.1.3 `public/manifest.webmanifest` — MODIFY

- **Owner**: Agent 1
- **Specific changes**: Replace JSON content with:
  ```json
  {
    "name": "Goaldmine",
    "short_name": "Goaldmine",
    "description": "Mining for goals — 90-day Mt. Elbert prep, shred, and longevity tracker.",
    "start_url": "/",
    "display": "standalone",
    "theme_color": "#0F0B07",
    "background_color": "#0F0B07",
    "icons": [
      { "src": "/icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any" },
      { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
      { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
    ]
  }
  ```
  Preserve any other existing top-level keys (e.g., `orientation`, `scope`) verbatim if present in the current file.
- **Acceptance**:
  - `python3 -m json.tool < public/manifest.webmanifest` succeeds.
  - `grep -n "Goaldmine" public/manifest.webmanifest` → ≥2 matches (`name`, `short_name`).
  - `grep -n "Workout Planner" public/manifest.webmanifest` → 0 matches.

#### C.1.4 `public/next.svg`, `public/vercel.svg`, `public/file.svg`, `public/globe.svg`, `public/window.svg` — DELETE

- **Owner**: Agent 1
- **Action**: Run `grep -rn "next.svg\|vercel.svg\|file.svg\|globe.svg\|window.svg" src/` first; if 0 matches (Research §10 confirms), delete all five.
- **Acceptance**:
  - All five files absent (`test ! -f public/next.svg` etc.).
  - `npm run build` succeeds.

### Agent 2 — Brand components

#### C.2.1 `src/components/Logo.tsx` — CREATE

- **Owner**: Agent 2
- **Skeleton (developer fills SVG geometry per UX §1 Option B layer order)**:

```tsx
// src/components/Logo.tsx
import type { CSSProperties } from "react";

interface LogoProps {
  size?: number;        // px, default 32
  className?: string;
  title?: string;       // accessibility label, default "Goaldmine"
  style?: CSSProperties;
}

export function Logo({ size = 32, className, title = "Goaldmine", style }: LogoProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      style={style}
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{title}</title>

      {/* Layer 1 — Chest body (rounded trapezoid, points 8,32 → 56,32 → 52,56 → 12,56) */}
      {/* fill="var(--accent)" */}

      {/* Layer 2 — Chest dark band (rectangle 12,42 → 52,46) fill="var(--accent-fg)" */}

      {/* Layer 3 — Keyhole circle r=1.25u + 1u rect at (32, 50) fill="var(--accent-fg)" */}

      {/* Layer 4 — Chest lid (rotated rectangle 8,18 → 56,30, rotated -8°) fill="var(--border)" */}

      {/* Layer 5 — Lid interior shadow (small dark trapezoid behind targets) fill="var(--accent-fg)" opacity="0.8" */}

      {/* Layer 6 — Flanking hollow targets — circles at (18,22) and (46,22) r=5 stroke="var(--target)" stroke-width="1.25" fill="none" */}

      {/* Layer 7 — Hero target (cx=32, cy=18):
          - r=11 fill="var(--target)"
          - r=8 fill="#FFFFFF"
          - r=5 fill="var(--target)"
          - r=2 fill="#FFFFFF" */}

      {/* Layer 8 (optional) — 0.5u dark outline around hero target r=11.5 stroke="var(--accent-fg)" */}
    </svg>
  );
}
```

- **Acceptance**:
  - File exists; default export not required, named `Logo` export is canonical.
  - SVG renders without console errors at sizes 24, 28, 32, 48, 192, 512.
  - `role="img"` + `aria-label` present.
  - All eight layers present (visual inspection in browser smoke).

#### C.2.2 `src/components/Bullseye.tsx` — CREATE

- **Owner**: Agent 2
- **Skeleton**:

```tsx
// src/components/Bullseye.tsx
import type { CSSProperties } from "react";

interface BullseyeProps {
  size?: number;              // px, default 16
  filled?: boolean;           // default false (hollow)
  progress?: number;          // 0..1; if provided, overrides `filled`
  className?: string;
  style?: CSSProperties;
  "aria-label"?: string;
  "aria-hidden"?: boolean;
}

export function Bullseye({
  size = 16,
  filled = false,
  progress,
  className,
  style,
  "aria-label": ariaLabel,
  "aria-hidden": ariaHidden,
}: BullseyeProps) {
  // Decide ring count from size + filled/progress state.
  // viewBox is constant 0 0 32 32; consumer scales via width/height.
  //
  // Render rules (per UX §2):
  //   size  filled                    rings
  //   6     y / progress >= 0.25      1 disc r=15 fill=--target
  //   6     hollow / progress < 0.25  1 circle r=14 stroke=2 --muted fill=none
  //   10    filled                    r=15 (--target) + r=8 (--target-fg / #fff)
  //   10    hollow                    1 circle r=14 stroke=2 --muted fill=none
  //   14    filled                    r=15 (--target) + r=10 (#fff) + r=5 (--target)
  //   14    hollow                    stroke ring only
  //   20+   filled                    r=15 (--target) + r=11 (#fff) + r=7 (--target) + r=3 (#fff)
  //   20+   hollow                    stroke ring only
  //
  // progress (when set) → snap by size:
  //   size 6     -> {0, 1}
  //   size 10    -> {0, 0.5, 1}
  //   size 14    -> {0, 0.33, 0.66, 1}
  //   size 20+   -> {0, 0.25, 0.5, 0.75, 1}
  //
  // Ring fill grows centripetally (center first, then outward):
  //   - 1/4 step: render center white dot (r=3) only, no other rings (still inside hollow stroke ring)
  //   - 2/4 step: + inner red ring r=7
  //   - 3/4 step: + middle white ring r=11
  //   - 4/4 step: full canonical (= filled)

  const ariaProps =
    ariaHidden || !ariaLabel
      ? { "aria-hidden": true as const }
      : { role: "img" as const, "aria-label": ariaLabel };

  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      style={style}
      xmlns="http://www.w3.org/2000/svg"
      {...ariaProps}
    >
      {/* Implementation per render rules above. */}
      {/* Hollow base ring (always drawn when not fully filled): */}
      {/*   <circle cx="16" cy="16" r="14" fill="none" stroke="var(--muted)" strokeWidth={2} /> */}
      {/* Filled-state stack: <circle cx=16 cy=16 r=15 fill="var(--target)" /> ... etc */}
    </svg>
  );
}
```

- **Acceptance**:
  - File exists; named `Bullseye` export.
  - At sizes 6, 10, 14, 20: `filled={true}` and `filled={false}` render visually distinct outputs.
  - `progress={0}` ≡ hollow; `progress={1}` ≡ filled.
  - When `aria-label` omitted, SVG has `aria-hidden="true"`.
  - `npx tsc --noEmit` clean.

#### C.2.3 `src/components/AppHeader.tsx` — CREATE

- **Owner**: Agent 2
- **Skeleton**:

```tsx
// src/components/AppHeader.tsx
import { Logo } from "@/components/Logo";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-30 bg-[var(--background)]/95 backdrop-blur border-b border-[var(--border)]">
      <div className="max-w-md mx-auto h-12 flex items-center px-4 gap-2">
        <Logo size={28} />
        <span
          className="text-xl tracking-tight"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Goaldmine
        </span>
      </div>
    </header>
  );
}
```

- **Acceptance**:
  - File exists; named `AppHeader` export.
  - Renders `<Logo size={28} />` + "Goaldmine" wordmark.
  - Sticky-top, semi-transparent backdrop, border-bottom in `--border`.
  - Height = 48px (`h-12`).
  - Imported and rendered in `src/app/layout.tsx` (verified after Agent 1 merges first; orchestrator merges Agent 1 → Agent 2 immediately to avoid broken intermediate).

#### C.2.4 `public/icon.svg` — CREATE

- **Owner**: Agent 2
- **Action**: Author a static SVG file with the same Logo geometry, viewBox `0 0 64 64`, embedded fills as **literal hex** (not CSS variables — manifest icons must self-contain colors). Use the dark-mode palette (gold + barn-red) since iOS install previews on a generic surface:
  - Chest gold: `#D4A437`
  - Chest dark band / keyhole / lid-shadow: `#0F0B07`
  - Hero target red: `#C0392B`
  - White rings: `#FFFFFF`
  - Lid darkened gold: `#8A6212`
- **Acceptance**:
  - `test -f public/icon.svg`.
  - `<svg>` opens with `viewBox="0 0 64 64"` and `xmlns="http://www.w3.org/2000/svg"`.
  - No `var(--...)` references in the file.

#### C.2.5 `public/icon-192.png` + `public/icon-512.png` — CREATE

- **Owner**: Agent 2
- **Action**: Run `npm install` (after adding `@resvg/resvg-js` devDep) → `npx tsx scripts/render-icons.ts`. Commit both PNGs.
- **Acceptance**:
  - `test -f public/icon-192.png && test -f public/icon-512.png`.
  - `file public/icon-192.png` reports PNG image, 192 × 192.
  - `file public/icon-512.png` reports PNG image, 512 × 512.

#### C.2.6 `scripts/render-icons.ts` — CREATE

- **Owner**: Agent 2
- **Action**: Exact content from §B.1 above.
- **Acceptance**:
  - File exists.
  - `npx tsc --noEmit` clean (script is included in tsconfig if present; otherwise no-op).
  - Running `npx tsx scripts/render-icons.ts` produces both PNGs.

#### C.2.7 `package.json` — MODIFY

- **Owner**: Agent 2
- **Action**:
  - Add `"@resvg/resvg-js": "^2.6.2"` to `devDependencies`.
  - Add `"icons": "tsx scripts/render-icons.ts"` to `scripts`.
- **Acceptance**:
  - `grep -n "@resvg/resvg-js" package.json` → ≥1.
  - `npm install` succeeds.

### Agent 3 — Color migration sweep + empty states

For each file in this section, the migration follows Research §2's table verbatim:

| Hardcoded class | Token replacement |
|---|---|
| `text-red-500` | `text-[var(--danger)]` |
| `bg-red-500/10` | `bg-[var(--danger)]/10` |
| `border-red-500/30` | `border-[var(--danger)]/30` |
| `border-red-500/40` | `border-[var(--danger)]/40` |
| `text-amber-500` | `text-[var(--warning)]` |
| `border-amber-500/40` | `border-[var(--warning)]/40` |
| `border-amber-500/50` | `border-[var(--warning)]/50` |
| `bg-amber-500/5` | `bg-[var(--warning)]/5` |
| `text-emerald-500` | `text-[var(--success)]` |
| `border-emerald-500/40` | `border-[var(--success)]/40` |
| `bg-emerald-500/5` | `bg-[var(--success)]/5` |
| `hover:text-red-500` | `hover:text-[var(--danger)]` |

**Skip files owned by Agent 4** — `BaselineBlockCard.tsx` (line 39 emerald `✓`), `CalendarMonth.tsx` (lines 40, 61 emerald), `BottomNav.tsx`, `goals/page.tsx` (lines 60, 62). Agent 4 handles those alongside the Bullseye wiring. **However** Agent 3 still migrates the line 46 `text-emerald-500` in `BaselineBlockCard.tsx` (the logged-value text, NOT a glyph swap) — coordinate via the per-file table below.

#### Files Agent 3 migrates (REQ-A3 + REQ-E1 bundled where applicable)

| File | Lines | Action |
|------|------|--------|
| `src/app/calendar/page.tsx` | 65, 66 | `text-emerald-500` → `text-[var(--success)]`; `text-amber-500` → `text-[var(--warning)]`. Plus REQ-E1 empty-state copy (no completed days). |
| `src/app/baselines/page.tsx` | 178, 180, 182, 195, 197, 199 | All emerald/amber/red → success/warning/danger tokens. Plus REQ-E1 empty-state copy. |
| `src/app/days/[dateKey]/page.tsx` | 44 | `text-amber-500` → `text-[var(--warning)]`. |
| `src/app/goals/[id]/plan/page.tsx` | 359, 361, 363 | emerald/amber/red → success/warning/danger. |
| `src/app/goals/[id]/revisions/[revisionId]/page.tsx` | 125 | `text-amber-500` → `text-[var(--warning)]`. |
| `src/components/LogBaselineForm.tsx` | 129 | Canonical danger error block migration. |
| `src/components/PlanChangelog.tsx` | 78 | `border-amber-500/40 text-amber-500` → warning tokens. |
| `src/components/ReviseForm.tsx` | 73 | Canonical danger block. |
| `src/components/DayNoteForm.tsx` | 54 | Canonical danger block. |
| `src/components/GoalReferences.tsx` | 67, 128 | `hover:text-red-500` → `hover:text-[var(--danger)]`; canonical danger block. |
| `src/components/GoalEditForm.tsx` | 154, 182 | Canonical danger block; destructive button. |
| `src/components/SnapshotView.tsx` | 55 | `border-amber-500/50 bg-amber-500/5` → warning tokens. |
| `src/components/DayOverrideForm.tsx` | 76, 103 | Canonical danger block; destructive button. |
| `src/components/LogBaselineInlineForm.tsx` | 51 | `text-xs text-red-500` → `text-[var(--danger)]`. |
| `src/components/ImportForm.tsx` | 35 | Canonical danger block. |
| `src/components/EditBaselineForm.tsx` | 83, 110 | Canonical danger block; destructive button. |
| `src/components/EditNutritionForm.tsx` | 88, 115 | Canonical danger block; destructive button. |
| `src/components/GoalCreateForm.tsx` | 94 | Canonical danger block. |
| `src/components/CopyPromptButton.tsx` | 17 | `border-emerald-500/40 text-emerald-500` → success tokens. |
| `src/components/BaselineBlockCard.tsx` | 46 | `text-emerald-500` (logged-value) → `text-[var(--success)]`. **DO NOT touch line 39** — Agent 4 owns the `✓` → `<Bullseye />` swap. |
| `src/components/LogNutritionForm.tsx` | 73 | `text-xs text-red-500` → `text-[var(--danger)]`. |
| `src/app/page.tsx` | (empty state) | REQ-E1 empty-state copy. |
| `src/app/journal/page.tsx` | (empty state) | REQ-E1 empty-state copy. |
| `src/app/goals/page.tsx` | (empty state ONLY — NOT lines 60/62) | REQ-E1 empty-state copy. |

- **Acceptance** (across the bundle):
  - `grep -rn "text-red-500\|text-amber-500\|text-emerald-500\|border-red-500\|border-amber-500\|border-emerald-500\|bg-red-500\|bg-amber-500\|bg-emerald-500" src/` returns **only** the four files Agent 4 owns (BaselineBlockCard line 39, CalendarMonth lines 40/61, goals/page.tsx lines 60/62) — and after Agent 4 completes Wave 3, this grep returns **0**.
  - `npx tsc --noEmit` clean.
  - `npm run lint` clean.
  - All five empty-state surfaces show the new copy from §B.6.

### Agent 4 — Motif consumers

#### C.4.1 `src/components/BaselineBlockCard.tsx` — MODIFY

- **Owner**: Agent 4
- **Specific changes**:
  - Add import: `import { Bullseye } from "@/components/Bullseye";`
  - Line ~39: replace `<span className="text-emerald-500 mr-1">✓</span>` with `<Bullseye filled size={14} aria-hidden className="mr-1" />`.
  - For unlogged tests: emit `<Bullseye size={14} aria-hidden className="mr-1" />` (hollow) in the same row position so layout is consistent.
  - Line 46 (`text-emerald-500` on logged value) — already migrated by Agent 3 in Wave 2; if grep still shows it, migrate to `text-[var(--success)]`.
  - Preserve existing `opacity-70` / `font-medium` styling.
  - Title-string `✓` literal at the card title (Risk 14) — leave as-is.
- **Acceptance**:
  - All baseline rows render a `<Bullseye>`.
  - Logged tests render `filled`; unlogged render hollow.
  - `grep "text-emerald-500" src/components/BaselineBlockCard.tsx` → 0.

#### C.4.2 `src/components/CalendarMonth.tsx` — MODIFY

- **Owner**: Agent 4
- **Specific changes**:
  - Add import: `import { Bullseye } from "@/components/Bullseye";`
  - **Line 40**: DELETE the `isCompleted && cell.isPast` tone class entirely. The bullseye carries the "completed" signal alone (UX §4 / §B.4). The completed-day cell falls through to the default `border-[var(--border)] bg-[var(--card)]`.
  - **Line 42**: replace `border-amber-500/50 bg-amber-500/5` with `border-[var(--warning)]/50 bg-[var(--warning)]/5`.
  - **Line 61**: replace `<span className="text-emerald-500">✓</span>` with `<Bullseye filled size={10} aria-hidden />`.
  - **Line 62**: replace `text-amber-500` on `★` with `text-[var(--warning)]`.
  - **Stack reorder**: ensure stack order top→bottom is `🏔` (line 60) → `★` override (line 62) → `◉` workout (line 61) → `◎N` baselines-due (line 63). Move line 61 below line 62 in the JSX.
  - Today's cell (line 39): `border-[var(--accent)] bg-[var(--accent)]/10` — UNCHANGED (auto-updates via token swap).
- **Acceptance**:
  - Days with `workoutCount > 0` render a `<Bullseye filled size={10} />` in the top-right stack.
  - Today's cell still distinguishable (gold border + low-alpha gold bg).
  - Override star recolored.
  - `grep "text-emerald-500\|border-emerald-500\|bg-emerald-500\|text-amber-500\|border-amber-500\|bg-amber-500" src/components/CalendarMonth.tsx` → 0.

#### C.4.3 `src/components/BottomNav.tsx` — MODIFY

- **Owner**: Agent 4
- **Specific changes**:
  - Add import: `import { Bullseye } from "@/components/Bullseye";`
  - For each tab `<Link>`, when active (`pathname === href` or matches), render BEFORE the label:
    ```tsx
    {isActive && (
      <Bullseye
        filled
        size={6}
        aria-hidden
        style={{ color: "var(--accent)" }}
      />
    )}
    ```
    Wrap the tab content in `<div className="flex flex-col items-center gap-1 pt-2">` (or matching the existing per-tab vertical layout).
  - Add `aria-current="page"` to the active link.
  - Active label: `text-[var(--accent)]`. Inactive: `text-[var(--muted)]` (per UX §3).
  - Verify Bullseye renders inside this `"use client"` component without hydration warnings (Research §3 / Risk 8: pure SVG is safe).
- **Acceptance**:
  - Exactly one tab shows `<Bullseye filled size={6} />` indicator at any time.
  - `aria-current="page"` present on active `<Link>`.
  - Tap targets ≥ 44 px (each cell ≈ 78×56 px — OK).
  - 5-column grid layout intact at 390 px width.

#### C.4.4 `src/app/goals/page.tsx` — MODIFY

- **Owner**: Agent 4
- **Specific changes**:
  - Add import: `import { Bullseye } from "@/components/Bullseye";`
  - Add helper at top of file (per §B.5):
    ```ts
    function goalProgress(g: { createdAt: Date; targetDate: Date | null; status: string }): number | null {
      if (g.status === "achieved") return 1;
      if (g.status === "abandoned") return 0;
      if (!g.targetDate) return null;
      const total = new Date(g.targetDate).getTime() - new Date(g.createdAt).getTime();
      if (total <= 0) return 1;
      const elapsed = Date.now() - new Date(g.createdAt).getTime();
      return Math.max(0, Math.min(1, elapsed / total));
    }
    ```
  - Next to each goal title in the list-row JSX, render:
    ```tsx
    {(() => {
      const pct = goalProgress(g);
      return pct === null
        ? <Bullseye size={20} aria-label={`${g.objective}: no target date`} />
        : <Bullseye size={20} progress={pct} aria-label={`${g.objective}: ${Math.round(pct * 100)}% progress`} />;
    })()}
    ```
  - **Line 60**: replace `border-red-500/40 text-red-500` with `border-[var(--danger)]/40 text-[var(--danger)]`.
  - **Line 62**: replace `border-amber-500/40 text-amber-500` with `border-[var(--warning)]/40 text-[var(--warning)]`.
- **Acceptance**:
  - Each goal row shows a `<Bullseye />`.
  - Goals with no targetDate render hollow.
  - Achieved/abandoned goals render full/hollow respectively.
  - `grep "text-red-500\|text-amber-500\|border-red-500\|border-amber-500" src/app/goals/page.tsx` → 0.
  - `npx tsc --noEmit` clean.

---

## D. globals.css full rewrite

This is the literal final content for `src/app/globals.css`. Agent 1 writes this file verbatim.

```css
@import "tailwindcss";

:root {
  --background: #FAF3E3;
  --foreground: #1F1408;
  --muted: #7A5E3A;
  --card: #FFFBF0;
  --border: #D9C8A2;
  --accent: #8A6212;
  --accent-fg: #FFFBF0;
  --accent-soft: rgba(138, 98, 18, 0.14);
  --target: #A82A1F;
  --target-fg: #FFFBF0;
  --success: #4E6B36;
  --warning: #9C5F14;
  --danger: #A82A1F;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-muted: var(--muted);
  --color-card: var(--card);
  --color-border: var(--border);
  --color-accent: var(--accent);
  --color-accent-fg: var(--accent-fg);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
  --font-display: var(--font-dm-serif-display);
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: #0F0B07;
    --foreground: #F4E9D4;
    --muted: #9C8866;
    --card: #1A130C;
    --border: #3A2E1F;
    --accent: #D4A437;
    --accent-fg: #0F0B07;
    --accent-soft: rgba(212, 164, 55, 0.12);
    --target: #C0392B;
    --target-fg: #FFFFFF;
    --success: #7FA45C;
    --warning: #E0A95C;
    --danger: #C0392B;
  }
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-sans), system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}

/* Bullseye-pop: one-shot scale + opacity animation triggered by adding
   the `bullseye-pop` class to a freshly-logged Bullseye. Reduced-motion
   users see no animation. React plumbing for `justLogged` is intentionally
   deferred — the keyframe ships now so future iterations can wire it up. */
@keyframes bullseye-pop {
  0%   { transform: scale(0.6); opacity: 0; }
  60%  { transform: scale(1.08); opacity: 1; }
  100% { transform: scale(1.0); opacity: 1; }
}

.bullseye-pop {
  animation: bullseye-pop 320ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

@media (prefers-reduced-motion: reduce) {
  .bullseye-pop {
    animation: none;
  }
}
```

**Notes for Agent 1**:
- The `@import "tailwindcss";` line preserves Tailwind v4's import.
- `--font-display: var(--font-dm-serif-display)` requires REQ-A2's font init to expose `--font-dm-serif-display` on `<html>` — Agent 1 owns both edits.
- If the existing globals.css has additional rules (e.g., scrollbar resets) that aren't shown here, Agent 1 should preserve them by appending after the `bullseye-pop` block. Re-read the file before overwriting.

---

## E. Risk mitigation

| # | Risk (Research §10) | Mitigation | Owner | Acceptance check |
|---|---|---|---|---|
| 1 | Worktree merge conflict in `globals.css` | Single agent owns globals.css (Agent 1), keyframes added in same wave | Agent 1 | Wave 1 = single-agent merge; no parallel writers |
| 2 | `next/font/google` build-time fetch fails | Vercel build env is online; local `.next/cache/fonts` caches; Playfair Display documented as fallback | Agent 1 | `npm run build` succeeds; if fails, swap to `Playfair_Display` (one-line change in layout.tsx) |
| 3 | Token missing from dark `:root` block | Both `:root` blocks define identical token sets in §D | Agent 1 | `grep "(--target\|--success\|--warning\|--danger\|--accent-soft)" src/app/globals.css` → ≥10 matches (5 tokens × 2 blocks) |
| 4 | False-positive emerald migration | Research §10 confirmed all emerald sites are success-coded | Agent 3 | Visual smoke on baselines, calendar legend, plan-status, copy-button |
| 5 | False-positive red migration | Research §10 confirmed all red sites are danger/destructive | Agent 3 | Visual smoke on goal badge, error blocks, delete buttons |
| 6 | False-positive amber migration | Research §10 confirmed all amber sites are warning-coded | Agent 3 | Visual smoke on override star, stale baselines, ≤14d goals |
| 7 | Hidden hex literals in chart components | Confirmed no hardcoded hex in WeightChart/ReadinessChart/HistoryChart | Agent 1 (palette swap propagates) | Browser smoke at `/stats` and `/history` |
| 8 | `<Bullseye>` in client `BottomNav` | Pure SVG, no server-only APIs; Next.js permits this | Agent 4 | `npm run build` succeeds; no hydration warnings in `npm run dev` console |
| 9 | manifest.webmanifest JSON typo | Validate via `python3 -m json.tool` | Agent 1 | `python3 -m json.tool < public/manifest.webmanifest` exits 0 |
| 10 | `public/` cleanup deletes referenced asset | Pre-flight grep confirmed zero references | Agent 1 | `grep -rn "next.svg\|vercel.svg\|file.svg\|globe.svg\|window.svg" src/` → 0 before delete |
| 11 | `viewport.themeColor` mismatch with manifest | Both use `#0F0B07` per spec | Agent 1 | `grep "#0F0B07" src/app/layout.tsx public/manifest.webmanifest` → ≥2 matches |
| 12 | Goal `targetDate < createdAt` | Formula returns 1 (already-due) — acceptable; existing badge shows "Nd ago" | Agent 4 | Code path covered by `total <= 0 → 1` clause |
| 13 | Light-mode hex regression to old WCAG-failing values | Acceptance grep for old hex strings | Agent 1 | `grep -rn "#A87A1F\|#5C7A40\|#B8741C" src/ public/` → 0 |
| 14 | `BaselineBlockCard` title `✓` Unicode literal | Brand-neutral text; preserve as-is | Agent 4 | Visual inspection only — no regression expected |
| 15 | `dotenv` for icon-render script | Already in devDependencies; script doesn't read env anyway | Agent 2 | `npx tsx scripts/render-icons.ts` runs without env errors |

Cross-cutting QA (post-Wave 3, before PR):

```sh
# All should return 0:
grep -rn "Workout Planner" src/ public/
grep -rn "text-red-500\|text-amber-500\|text-emerald-500\|border-red-500\|border-amber-500\|border-emerald-500\|bg-red-500\|bg-amber-500\|bg-emerald-500" src/
grep -rn "#2563eb\|#60a5fa" src/ public/
grep -rn "#A87A1F\|#5C7A40\|#B8741C" src/ public/

# All should exist:
test -f src/components/Logo.tsx
test -f src/components/Bullseye.tsx
test -f src/components/AppHeader.tsx
test -f public/icon.svg
test -f public/icon-192.png
test -f public/icon-512.png
test -f scripts/render-icons.ts

# Should pass:
npx tsc --noEmit
npm run lint
npm run build
python3 -m json.tool < public/manifest.webmanifest
```

---

## F. Per-agent prompt outline

The orchestrator appends the full Developer-Agent prompt template after each opening below.

### Agent 1 — Foundation prompt opening

> You are **Agent 1 (Foundation)** for the Goaldmine rebrand. Your worktree is `worktrees/agent-1-foundation/` branched off `feature/goaldmine-rebrand`. You own the four foundational edits that block every other agent: (1) replace `src/app/globals.css` with the literal content from the architecture blueprint §D, (2) wire `DM_Serif_Display` via `next/font/google` and render `<AppHeader />` + update metadata/themeColor in `src/app/layout.tsx`, (3) update `public/manifest.webmanifest` to Goaldmine identity, (4) delete the five Next-template SVGs from `public/`. The `<AppHeader />` component file itself is built by Agent 2 — your edit imports + renders it; the orchestrator merges Agent 1 → Agent 2 in immediate succession to avoid a broken intermediate state.
>
> Read `/Users/ggronnii/Development/workout-planner/.feature-dev/2026-05-05-goaldmine-rebrand/agents/architecture-blueprint.md` sections **A, B, C.1.x, D, E** before touching any file. The blueprint contains the literal globals.css content you must write — do not re-derive palette values, the WCAG-AA-adjusted hex strings are in §D. Acceptance gates: `npx tsc --noEmit` clean, `npm run lint` clean, `npm run build` succeeds, the four cross-cutting greps in §E return zero. Commit with conventional message `feat(rebrand): palette, font, manifest, layout foundation`.

### Agent 2 — Brand components prompt opening

> You are **Agent 2 (Brand components)** for the Goaldmine rebrand. Your worktree is `worktrees/agent-2-brand/` branched off `feature/goaldmine-rebrand` AFTER Agent 1's merge. You own the three new SVG components (`Logo`, `Bullseye`, `AppHeader`), the static PWA icon (`public/icon.svg`), the icon-render script + dev-dep, and the two generated PNGs (`public/icon-192.png`, `public/icon-512.png`). Your work has no consumer dependencies inside this wave — Agent 3 runs in parallel and never imports your new files; Agent 4 (Wave 3) will consume `<Bullseye>` after you merge.
>
> Read `/Users/ggronnii/Development/workout-planner/.feature-dev/2026-05-05-goaldmine-rebrand/agents/architecture-blueprint.md` sections **A, B.1, C.2.x** AND `docs/ux-research/goaldmine-rebrand.md` §1 (Logo Option B layer order) and §2 (Bullseye anatomy + render rules) before writing SVG geometry. The blueprint pre-fills the prop signatures and component skeletons — your job is to fill in the SVG `<circle>`, `<rect>`, `<path>` markup per the layer order. Acceptance gates: `Logo` renders cleanly at sizes 24/28/32/48/192/512; `Bullseye` produces visually-distinct hollow vs filled outputs at all four motif sizes (6/10/14/20); both PNGs exist and are 192×192 / 512×512; `npx tsc --noEmit` clean. Commit with `feat(rebrand): brand components — Logo, Bullseye, AppHeader, PWA icons`.

### Agent 3 — Color migration + empty states prompt opening

> You are **Agent 3 (Color migration + empty states)** for the Goaldmine rebrand. Your worktree is `worktrees/agent-3-colors/` branched off `feature/goaldmine-rebrand` AFTER Agent 1's merge. You run in parallel with Agent 2. You own the hardcoded-Tailwind-hue → CSS-variable token migration across ~22 files plus the empty-state copy refresh on five page files. **Critical**: do NOT touch `src/components/BaselineBlockCard.tsx` line 39, `src/components/CalendarMonth.tsx` lines 40 / 61, `src/components/BottomNav.tsx`, or `src/app/goals/page.tsx` lines 60 / 62 — those are owned by Agent 4 and merging both at once will create conflicts. Touch only the lines listed in blueprint §C.3 per file.
>
> Read `/Users/ggronnii/Development/workout-planner/.feature-dev/2026-05-05-goaldmine-rebrand/agents/architecture-blueprint.md` sections **A, B.6, C.3** before editing. The migration table is in §C.3 prelude; the per-file line table tells you exactly where to edit. Empty-state copy strings are locked in §B.6 — copy-paste verbatim, render the bold portion as `<strong>` inside a single `<p>` per surface. Acceptance gates: post-merge grep `grep -rn "text-red-500\|text-amber-500\|text-emerald-500\|border-red-500\|border-amber-500\|border-emerald-500\|bg-red-500\|bg-amber-500\|bg-emerald-500" src/` returns ONLY the four Agent-4-owned sites; `npx tsc --noEmit` clean; `npm run lint` clean. Commit with `feat(rebrand): migrate hardcoded colors to semantic tokens; lock empty-state copy`.

### Agent 4 — Motif consumers prompt opening

> You are **Agent 4 (Motif consumers)** for the Goaldmine rebrand. Your worktree is `worktrees/agent-4-motif/` branched off `feature/goaldmine-rebrand` AFTER Wave 2 (Agents 2 + 3) merges. You own the `<Bullseye>` integration into the four consumer surfaces: `BaselineBlockCard` (size 14), `CalendarMonth` (size 10 in top-right stack), `BottomNav` (size 6 above active tab label), and `goals/page.tsx` (size 20 with progress prop). You also own the final color-migration cleanup at the four reserved sites Agent 3 deferred to you — every grep failure from §E should be zero after your merge.
>
> Read `/Users/ggronnii/Development/workout-planner/.feature-dev/2026-05-05-goaldmine-rebrand/agents/architecture-blueprint.md` sections **A, B.4, B.5, C.4.x** before editing. The blueprint pre-defines the `goalProgress()` helper, the CalendarMonth stack reorder (line 60 → 62 → 61 → 63), the BottomNav `aria-current="page"` requirement, and the explicit deletion of CalendarMonth line 40's emerald tone (UX §4 — the bullseye carries the completed signal alone). Do not import `<Bullseye>` from anywhere except `@/components/Bullseye`. Acceptance gates: all four cross-cutting greps in §E return zero; visual smoke at 390 px confirms each surface renders the expected Bullseye; `npx tsc --noEmit` clean; `npm run build` succeeds; MCP `tools/list` curl returns the unchanged tool set. Commit with `feat(rebrand): wire Bullseye motif into BaselineBlockCard, CalendarMonth, BottomNav, goals page`.

---

/Users/ggronnii/Development/workout-planner/.feature-dev/2026-05-05-goaldmine-rebrand/agents/architecture-blueprint.md
