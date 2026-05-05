# Goaldmine Rebrand — Architecture Blueprint (v2)

**Author**: Architect Agent (Opus)
**Date**: 2026-05-05
**Revision**: v2 (resolves 11 blockers + 18 concerns from `architecture-critique.md`)
**Source PRD**: `docs/prds/PRD-goaldmine-rebrand.md`
**UX Research**: `docs/ux-research/goaldmine-rebrand.md`
**Atomic REQs**: `.feature-dev/2026-05-05-goaldmine-rebrand/phases/requirements.md`
**Research Output**: `.feature-dev/2026-05-05-goaldmine-rebrand/agents/research-output.md`
**Branch**: `feature/goaldmine-rebrand`

This blueprint is the single source of truth for the developer agents. It collapses the 6-stream proposal into 4 developer agents, locks every architectural decision, and pre-spec'd every file edit. **Developers should not need to re-read the PRD or UX research.**

**v2 fixes**: A1 (strict Bullseye union), A3 (mandatory Logo layer 8), B5 (globals.css preserves tap-highlight + font-inherit), C3 (`◎N` → `--muted`), E2 (BottomNav cell-height parity), E3 (BottomNav dot is canonical red Bullseye, label is gold), F3 (Logo↔icon.svg sync comment), G4 (Agent 3↔4 boundary), I1/I2/I3 (empty-state conditions + placement), K3 (Wave 1 AppHeader stub), N1 (`goalProgress` matches non-nullable schema). 18 concerns documented inline.

---

## A. Final agent assignment

The 6-stream proposal in `requirements.md` is correct in dependency shape but over-fragmented for parallel execution. Compressed into **4 developer agents** with strict run-ordering:

### Agent 1 — Foundation (`agent-1-foundation`)
Owns palette + font wiring + globals.css + layout.tsx + manifest + asset cleanup + **AppHeader stub** (replaced by Agent 2 in Wave 2). Touches `globals.css` exactly once.

- REQ-A1 (palette), REQ-A2 (font), REQ-C1 (layout + `metadata.icons`), REQ-C2 (manifest), REQ-C3 (public/ cleanup), Stream 6 keyframes, AppHeader stub (§C.1.5).

### Agent 2 — Brand components (`agent-2-brand`)
Owns three real SVG components + static SVG icon + PNG render script.

- REQ-B1 (`Logo.tsx`), REQ-B2 (`Bullseye.tsx`), REQ-B3 (`AppHeader.tsx` — replaces stub), REQ-D5 (`public/icon.svg`, `scripts/render-icons.ts`, `public/icon-192.png`, `public/icon-512.png`).

### Agent 3 — Color migration sweep (`agent-3-colors`)
Tailwind hardcoded hues → CSS-variable tokens across ~22 files.

- REQ-A3 (migration), REQ-E1 (empty-state copy — bundled because the strings live in pages Agent 3 already touches).

### Agent 4 — Motif consumers (`agent-4-motif`)
Wires `<Bullseye>` into four surfaces.

- REQ-D1 (`BaselineBlockCard`), REQ-D2 (`CalendarMonth`), REQ-D3 (`BottomNav`), REQ-D4 (`goals/page.tsx`).

### Sequencing

- **Wave 1 (T0)**: Agent 1 alone — globals.css + layout.tsx + manifest + asset cleanup + AppHeader stub. Establishes tokens + AppHeader render slot. Blocks everyone.
- **Wave 2 (T1, parallel)**: Agent 2 (real component files, replaces AppHeader stub) + Agent 3 (page/component edits — never globals.css, never Agent 2's component files). Both branch off Wave 1. Agent 3's typecheck passes because Agent 1's stub satisfies the import. Independent file sets — no merge conflicts.
- **Wave 3 (T2)**: Agent 4 alone. Depends on Agent 2's `<Bullseye>` and Agent 3's color migration.

**Worktree convention**: each agent works in `worktrees/agent-N-<slug>/` off `feature/goaldmine-rebrand`. The orchestrator merges sequentially per wave. The user opens PR `feature/goaldmine-rebrand` → `main` after QA passes.

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

### B.2 bullseye-pop animation → CONFIRM (CSS only)

Ship `@keyframes bullseye-pop` + reduced-motion gate in `globals.css` (Agent 1). Do not plumb a `justLogged` flag through React. The keyframe ships now so future iterations can wire it up.

### B.3 `@theme inline` updates → CONFIRM

Only add `--font-display` to `@theme inline`. New color tokens are consumed via arbitrary-value syntax (`bg-[var(--target)]/40`, `text-[var(--danger)]`).

### B.4 CalendarMonth multi-workout days → CONFIRM

Single `<Bullseye filled size={10} />` regardless of `workoutCount`. The day-detail page exposes per-day details.

### B.5 Goals progress formula → CONFIRM (matches non-nullable schema; **fix N1**)

`prisma/schema.prisma:148` declares `Goal.targetDate DateTime` (NOT NULL). The helper drops the null branch:

```ts
function goalProgress(g: { createdAt: Date; targetDate: Date; status: string }): number {
  if (g.status === "achieved") return 1;
  if (g.status === "abandoned") return 0;
  const total = g.targetDate.getTime() - g.createdAt.getTime();
  if (total <= 0) return 0;
  const elapsed = Date.now() - g.createdAt.getTime();
  return Math.max(0, Math.min(1, elapsed / total));
}
```

- `status === "achieved"` → 1 (full bullseye).
- `status === "abandoned"` → 0 (hollow ring).
- `targetDate <= createdAt` → 0 (treat as ill-formed; the numeric label still shows the intended date).
- Otherwise → time-progress, clamped to `[0, 1]`.

The numeric label next to the bullseye carries precise context.

### B.6 Empty-state copy → LOCKED (**fixes I1, I2, I3**)

Lift exactly these strings into the relevant page components (Agent 3 owns this in REQ-E1 inside its bundle).

| Surface | File | Render condition | Placement | Copy |
|---------|------|-----------------|-----------|------|
| Today (no program) | `src/app/page.tsx` | existing "no program" branch (Card at lines 18–24) | replace existing card body | `**No active program yet.** Run \`npx prisma db seed\` to create the 90-day plan.` |
| Records (no plan) | `src/app/baselines/page.tsx` | existing `schedule.scheduled.length === 0` branch (line ~43) | replace existing string | `**No active plan.** Add a goal to schedule your baseline tests.` |
| Goals (no goals) | `src/app/goals/page.tsx` | existing `goals.length === 0` branch (line ~37) | replace existing string | `**Nothing to aim at yet.** Add a goal — a date, a metric, or both.` |
| Journal (no notes at all) | `src/app/journal/page.tsx` | `allNotes.length === 0 && pending.count === 0` | new `<p className="text-sm text-[var(--muted)]">…</p>` rendered **inside the existing "Log a note" Card**, after the existing helper `<p>` and before `<LogNoteForm />` | `**The journal's clean.** Drop a note here for instructions, feelings, or tomorrow's reminder.` |
| Calendar (no completed days this month) | `src/app/calendar/page.tsx` | `cells.every(c => c.workoutCount === 0 && !c.hasOverride)` | quiet caption rendered below the month grid as `<p className="text-xs text-[var(--muted)] text-center mt-2">` | `**No completed days this month.** Logged workouts and overrides will land here as filled targets.` |

**Implementation shape** for the bold portion (all surfaces):

```tsx
<p className="text-sm text-[var(--muted)]">
  <strong className="font-semibold text-[var(--foreground)]">No active plan.</strong>{" "}
  Add a goal to schedule your baseline tests.
</p>
```

Code-style fragment in the Today copy (`\`npx prisma db seed\``) renders as `<code className="text-xs bg-[var(--card)] px-1 rounded">npx prisma db seed</code>`.

**Agent 3 must read** the actual prop shapes in `journal/page.tsx` and `calendar/page.tsx` before adding the conditions; the variables `allNotes`, `pending`, `cells` already exist (verified at blueprint-time).

### B.7 AppHeader right-side slot → CONFIRM (no slot)

`<AppHeader />` is brand-only — Logo + wordmark, no actions. The Today page's existing inline header row stays untouched. **Concern H2 documented**: two stacked headers on Today (AppHeader + page header with `[+ Import]`) — accepted as known visual debt; out of scope (PRD §1 "no functional changes").

### B.8 `metadata.icons` link tags (**fixes L3**)

In `src/app/layout.tsx`, the `metadata` export gets an `icons` block so Next.js emits the `<link rel="apple-touch-icon">` and `<link rel="icon">` tags Safari needs even outside installed-PWA mode:

```ts
export const metadata: Metadata = {
  title: "Goaldmine",
  description: "Mining for goals — 90-day Mt. Elbert prep, shred, and longevity tracker.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icon-192.png", sizes: "192x192" }],
  },
};
```

Preserve any other existing `metadata` fields (e.g., `manifest`).

---

## C. File-level blueprint

Grouped by agent, listed in dependency order within each section.

### Agent 1 — Foundation

#### C.1.1 `src/app/globals.css` — MODIFY (full rewrite — see §D for literal contents)

- **Owner**: Agent 1
- **Action**: Replace entire file with the literal content in §D. **§D is the complete file** — the existing `-webkit-tap-highlight-color: transparent` and `input, textarea, select, button { font-family: inherit }` rules are preserved inline (fixes B5).
- **Acceptance**:
  - `:root` block defines `--background, --foreground, --muted, --card, --border, --accent, --accent-fg, --accent-soft, --target, --target-fg, --success, --warning, --danger`.
  - `@media (prefers-color-scheme: dark) { :root { ... } }` block redefines the same set.
  - `@theme inline` includes `--font-display: var(--font-dm-serif-display);`.
  - `@keyframes bullseye-pop` defined.
  - `@media (prefers-reduced-motion: reduce) { .bullseye-pop { animation: none; } }` defined.
  - **Preserved rules present**: `grep "tap-highlight-color" src/app/globals.css` → ≥1; `grep "font-family: inherit" src/app/globals.css` → ≥1.
  - **Body fallback chain unchanged from existing**: `grep "BlinkMacSystemFont" src/app/globals.css` → ≥1 (fixes B4).
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
  - Add import: `import { AppHeader } from "@/components/AppHeader";` (resolves to Agent 1's stub in Wave 1, replaced by Agent 2 in Wave 2).
  - Replace `metadata.title` with `"Goaldmine"`.
  - Replace `metadata.description` with `"Mining for goals — 90-day Mt. Elbert prep, shred, and longevity tracker."`
  - Add `metadata.icons` block per §B.8 (fixes L3).
  - Replace `viewport.themeColor` with `"#0F0B07"` (matches dark `--background`).
  - On `<html className="...">`, append `${dmSerifDisplay.variable}` after `${geistMono.variable}`.
  - Inside `<body>`, render `<AppHeader />` BEFORE `<main>`.
  - Leave `<main className="flex-1 pb-20">` UNCHANGED — sticky header consumes flow space, no `pt-X` needed (Research §9).
- **Acceptance**:
  - `grep -n "Goaldmine" src/app/layout.tsx` → at least one match.
  - `grep -n "DM_Serif_Display" src/app/layout.tsx` → ≥1.
  - `grep -n "AppHeader" src/app/layout.tsx` → ≥1.
  - `grep -n "#0F0B07" src/app/layout.tsx` → ≥1.
  - `grep -n "apple-touch-icon\|apple:" src/app/layout.tsx` → ≥1 (icons block present).
  - `npx tsc --noEmit` clean (passes because Agent 1 also ships the AppHeader stub at C.1.5).

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
  Preserve any other existing top-level keys (e.g., `orientation`, `scope`) verbatim if present.
- **Acceptance**:
  - `python3 -m json.tool < public/manifest.webmanifest` succeeds.
  - `grep -n "Goaldmine" public/manifest.webmanifest` → ≥2 matches.
  - `grep -n "Workout Planner" public/manifest.webmanifest` → 0 matches.

#### C.1.4 `public/next.svg`, `public/vercel.svg`, `public/file.svg`, `public/globe.svg`, `public/window.svg` — DELETE

- **Owner**: Agent 1
- **Action**: Run `grep -rn "next.svg\|vercel.svg\|file.svg\|globe.svg\|window.svg" src/` first; if 0 matches, delete all five.
- **Acceptance**:
  - All five files absent.
  - `npm run build` succeeds.

#### C.1.5 `src/components/AppHeader.tsx` — CREATE STUB (**fix K3**)

- **Owner**: Agent 1 (stub only — Agent 2 replaces with the full component in Wave 2)
- **Literal content**:
  ```tsx
  // Stub — replaced by Agent 2 in Wave 2.
  // Exists so that Wave 1's layout.tsx import resolves and Agent 3's
  // typecheck passes while running in parallel with Agent 2.
  export function AppHeader() {
    return null;
  }
  ```
- **Acceptance**:
  - File exists.
  - `npx tsc --noEmit` clean in Wave 1.
  - Hand-off: Agent 2 overwrites this file in Wave 2 (see C.2.3).

### Agent 2 — Brand components

#### C.2.1 `src/components/Logo.tsx` — CREATE

- **Owner**: Agent 2
- **File-header sync rule** (**fixes F3** — required, must appear at the top of the file):

```tsx
/* If you change Logo geometry, also update public/icon.svg and re-run `npx tsx scripts/render-icons.ts`.
   Logo.tsx uses CSS variables; icon.svg ships static hex (dark palette). They MUST stay visually in sync. */
```

- **Skeleton (developer fills SVG geometry per UX §1 Option B layer order)**:

```tsx
/* If you change Logo geometry, also update public/icon.svg and re-run `npx tsx scripts/render-icons.ts`.
   Logo.tsx uses CSS variables; icon.svg ships static hex (dark palette). They MUST stay visually in sync. */
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

      {/* Layer 1 — Chest body (rounded trapezoid, points 8,32 → 56,32 → 52,56 → 12,56)
          fill="var(--accent)". NO stroke at any size — chest is filled gold; outline is cosmetic and
          renders as sub-pixel blur at 28px (Concern N10). */}

      {/* Layer 2 — Chest dark band (rectangle 12,42 → 52,46) fill="var(--accent-fg)" */}

      {/* Layer 3 — Keyhole circle r=1.25u + 1u rect at (32, 50) fill="var(--accent-fg)" */}

      {/* Layer 4 — Chest lid (rotated rectangle 8,18 → 56,30, rotated -8°) fill="var(--border)" */}

      {/* Layer 5 — Lid interior shadow (small dark trapezoid behind targets) fill="var(--accent-fg)" opacity="0.8" */}

      {/* Layer 6 — Flanking hollow targets — circles at (18,22) and (46,22) r=5 stroke="var(--target)"
          stroke-width="1.25" fill="none". At size=28 these strokes render at 0.55px; accept the fade —
          they're intentionally low-contrast secondary detail (Concern N10). */}

      {/* Layer 7 — Hero target (cx=32, cy=18):
          - r=11 fill="var(--target)"
          - r=8 fill="#FFFFFF"
          - r=5 fill="var(--target)"
          - r=2 fill="#FFFFFF" */}

      {/* Layer 8 — MANDATORY dark outline around hero target (fixes A3):
          <circle cx="32" cy="18" r="11.5" fill="none" stroke="var(--accent-fg)" strokeWidth="0.5" />
          Required for legibility on cream backgrounds; harmless on coal. Always render regardless of theme. */}
    </svg>
  );
}
```

- **Acceptance**:
  - File exists; named `Logo` export. File begins with the sync-rule comment.
  - SVG renders without console errors at sizes 24, 28, 32, 48, 192, 512.
  - `role="img"` + `aria-label` present.
  - All eight layers present, including layer 8 outline.

#### C.2.2 `src/components/Bullseye.tsx` — CREATE (**fixes A1, A2 documented**)

- **Owner**: Agent 2
- **Prop signature is a strict TS discriminated union** — TypeScript enforces mutual exclusion of `filled` and `progress`. There is no runtime path where both are set, so no `console.warn` is needed.

```tsx
// src/components/Bullseye.tsx
import type { CSSProperties } from "react";

type BullseyeBase = {
  size?: number;              // px, default 16
  className?: string;
  style?: CSSProperties;
};

type BullseyeA11y =
  | { "aria-label": string; "aria-hidden"?: never }
  | { "aria-hidden": true; "aria-label"?: never }
  | { "aria-label"?: undefined; "aria-hidden"?: undefined };

type BullseyeFill =
  | { filled: boolean; progress?: never }
  | { progress: number; filled?: never }
  | { filled?: undefined; progress?: undefined }; // hollow default

export type BullseyeProps = BullseyeBase & BullseyeA11y & BullseyeFill;

export function Bullseye(props: BullseyeProps) {
  const {
    size = 16,
    className,
    style,
    "aria-label": ariaLabel,
    "aria-hidden": ariaHidden,
  } = props;
  const filled = "filled" in props ? props.filled : undefined;
  const progress = "progress" in props ? props.progress : undefined;

  // Precedence (enforced by the union, documented for human readers):
  //   - If `progress` is set, it controls the rings; `filled` is statically excluded by the type.
  //   - If `filled` is set, it controls the rings; `progress` is statically excluded by the type.
  //   - If neither is set, render the hollow base ring.
  //
  // viewBox is constant 0 0 32 32; consumer scales via width/height.
  //
  // Render rules (per UX §2):
  //   size  filled                    rings
  //   6     y / progress >= 0.25      1 disc r=15 fill=--target
  //   6     hollow / progress < 0.25  1 circle r=14 stroke=2 --muted fill=none
  //   10    filled                    r=15 (--target) + r=8 (#fff)
  //   10    hollow                    1 circle r=14 stroke=2 --muted fill=none
  //   14    filled                    r=15 (--target) + r=10 (#fff) + r=5 (--target)
  //   14    hollow                    stroke ring only
  //   20+   filled                    r=15 (--target) + r=11 (#fff) + r=7 (--target) + r=3 (#fff)
  //   20+   hollow                    stroke ring only
  //
  // Boundary fallthrough (Concern A2):
  //   - For `size < 6`,  treat as size=6 branch (single disc). Documented here, not enforced by code.
  //   - For `size > 20`, treat as size=20+ branch (full canonical). Same.
  //
  // progress (when set) → snap by size:
  //   size 6     -> {0, 1}
  //   size 10    -> {0, 0.5, 1}
  //   size 14    -> {0, 0.33, 0.66, 1}
  //   size 20+   -> {0, 0.25, 0.5, 0.75, 1}
  //
  // Ring fill grows centripetally (center first, then outward).

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
      {/* Filled-state stack: <circle cx=16 cy=16 r=15 fill="var(--target)" /> ... etc. */}
    </svg>
  );
}
```

- **Acceptance**:
  - File exists; named `Bullseye` export plus exported `BullseyeProps` type.
  - At sizes 6, 10, 14, 20: `filled={true}` and `filled={false}` render visually distinct outputs.
  - `progress={0}` ≡ hollow; `progress={1}` ≡ filled.
  - When `aria-label` omitted, SVG has `aria-hidden="true"`.
  - Type-level: passing both `filled` and `progress` is a TypeScript error.
  - `npx tsc --noEmit` clean.

#### C.2.3 `src/components/AppHeader.tsx` — REPLACE STUB

- **Owner**: Agent 2 (replaces the Wave-1 stub from §C.1.5)
- **Skeleton** (full-viewport inner div per **H4 fix** — `max-w-md` dropped):

```tsx
// src/components/AppHeader.tsx
import { Logo } from "@/components/Logo";

export function AppHeader(): React.JSX.Element {
  return (
    <header className="sticky top-0 z-30 bg-[var(--background)]/95 backdrop-blur border-b border-[var(--border)]">
      <div className="h-12 flex items-center px-4 gap-2">
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
  - File overwrites Agent 1's stub. Named `AppHeader` export with no props (TS signature `(): React.JSX.Element`).
  - Renders `<Logo size={28} />` + "Goaldmine" wordmark.
  - Sticky-top, semi-transparent backdrop, border-bottom in `--border`.
  - Height = 48px (`h-12`).
  - **Inner div has NO `max-w-md`** (Concern H4 fix — brand strip spans full viewport on wide screens).

#### C.2.4 `public/icon.svg` — CREATE

- **Owner**: Agent 2
- **Action**: Author a static SVG file with the same Logo geometry, viewBox `0 0 64 64`, embedded fills as **literal hex** (not CSS variables — manifest icons must self-contain colors). Use the dark-mode palette:
  - Chest gold: `#D4A437`
  - Chest dark band / keyhole / lid-shadow: `#0F0B07`
  - Hero target red: `#C0392B`
  - White rings: `#FFFFFF`
  - Lid darkened gold: `#8A6212`
- **Layer 8 outline**: include the mandatory hero-target outline at `r=11.5 stroke=#0F0B07 stroke-width=0.5` (matches Logo.tsx layer 8 spec).
- **Maskable safe-area** (**Concern A4 fix**): wrap the chest geometry in a 10% safe-area margin filled with `#0F0B07` (full background rectangle the size of the viewBox) so OS maskable crops show the brand background, not arbitrary install-screen color.
- **Acceptance**:
  - `test -f public/icon.svg`.
  - `<svg>` opens with `viewBox="0 0 64 64"` and `xmlns="http://www.w3.org/2000/svg"`.
  - No `var(--...)` references in the file.
  - 10% safe-area background `#0F0B07` rect present as the lowest layer.

#### C.2.5 `public/icon-192.png` + `public/icon-512.png` — CREATE

- **Owner**: Agent 2
- **Action**: Run `npm install` (after adding `@resvg/resvg-js` devDep) → `npx tsx scripts/render-icons.ts`. Commit both PNGs.
- **Fallback (Concern F2)**: If `@resvg/resvg-js` install fails on Agent 2's worktree, fall back to (1) generating PNGs on a different machine and committing, OR (2) shipping SVG-only manifest by removing the two PNG entries from `manifest.webmanifest` and documenting in PR.
- **Acceptance**:
  - `test -f public/icon-192.png && test -f public/icon-512.png`.
  - `file public/icon-192.png` reports PNG image, 192 × 192.
  - `file public/icon-512.png` reports PNG image, 512 × 512.

#### C.2.6 `scripts/render-icons.ts` — CREATE

- **Owner**: Agent 2
- **Action**: Exact content from §B.1.
- **Acceptance**:
  - File exists.
  - `npx tsc --noEmit` clean.
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

**Boundary instruction (fixes G4)**: When migrating colors in a file Agent 4 also edits (`BaselineBlockCard.tsx`, `CalendarMonth.tsx`, `BottomNav.tsx`, `goals/page.tsx`), **only modify the lines listed in the table below**. Do NOT add imports or modify other lines. Agent 4 owns the imports + JSX additions in Wave 3.

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

**Skip (owned by Agent 4)** — `BaselineBlockCard.tsx` line 39, `CalendarMonth.tsx` lines 40 / 61, `BottomNav.tsx` (whole file), `goals/page.tsx` lines 60 / 62. Agent 3 still migrates `BaselineBlockCard.tsx:46` (logged-value text).

#### Files Agent 3 migrates (REQ-A3 + REQ-E1 bundled where applicable)

| File | Lines | Action |
|------|------|--------|
| `src/app/calendar/page.tsx` | 65, 66 | `text-emerald-500` → `text-[var(--success)]`; `text-amber-500` → `text-[var(--warning)]`. Plus REQ-E1 caption per §B.6 (gated on `cells.every(...)`). |
| `src/app/baselines/page.tsx` | 178, 180, 182, 195, 197, 199 | All emerald/amber/red → success/warning/danger tokens. Plus REQ-E1 empty-state copy per §B.6 (Records — "No active plan…"). |
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
| `src/components/BaselineBlockCard.tsx` | 46 | `text-emerald-500` (logged-value) → `text-[var(--success)]`. **DO NOT touch line 39, do NOT add Bullseye import.** |
| `src/components/LogNutritionForm.tsx` | 73 | `text-xs text-red-500` → `text-[var(--danger)]`. |
| `src/app/page.tsx` | (empty state Card lines ~18–24) | REQ-E1 copy per §B.6 (Today — `npx prisma db seed` instruction restored). |
| `src/app/journal/page.tsx` | (inside existing "Log a note" Card) | REQ-E1 copy per §B.6, gated on `allNotes.length === 0 && pending.count === 0`. |
| `src/app/goals/page.tsx` | (empty state ONLY — NOT lines 60/62; do NOT add imports — Agent 4 owns those) | REQ-E1 copy per §B.6 (Goals). |

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
  - Line 46 already migrated by Agent 3.
  - Preserve existing `opacity-70` / `font-medium` styling.
  - Title-string `✓` literal at the card title — leave as-is.
- **Acceptance**:
  - All baseline rows render a `<Bullseye>`.
  - Logged tests render `filled`; unlogged render hollow.
  - `grep "text-emerald-500" src/components/BaselineBlockCard.tsx` → 0.

#### C.4.2 `src/components/CalendarMonth.tsx` — MODIFY (**fixes C3, addresses C1, uses N6**)

- **Owner**: Agent 4
- **Specific changes**:
  - Add import: `import { Bullseye } from "@/components/Bullseye";`
  - **Line 40** (today + completed combo, **Concern C1 fix option (a)**): DELETE the `isCompleted && cell.isPast` tone class entirely. The bullseye carries the "completed" signal alone (UX §4 / §B.4). When today AND completed, the gold tint is dropped — gold border + red bullseye remain. Documented: today-and-completed shows `border-[var(--accent)]` (gold border) + default `bg-[var(--card)]` background + `<Bullseye filled size={10}>` in top-right. No gold bg fill on completed days.
  - **Line 39** (today's cell tint, **N6 fix**): replace `bg-[var(--accent)]/10` with `bg-[var(--accent-soft)]` so today's tint uses the dedicated semantic token. Border stays `border-[var(--accent)]`.
  - **Line 42** (override warning): replace `border-amber-500/50 bg-amber-500/5` with `border-[var(--warning)]/50 bg-[var(--warning)]/5`.
  - **Line 61** (completed `✓`): replace `<span className="text-emerald-500">✓</span>` with `<Bullseye filled size={10} aria-hidden />`.
  - **Line 62** (override `★`): replace `text-amber-500` with `text-[var(--warning)]`. Concern C2 documented — the burnt-umber star is the deliberate brand choice; the user can request a saturation bump if it reads wrong on cream.
  - **Line 63 area** (`◎N` baselines-due glyph, **fixes C3**): recolor the glyph to `text-[var(--muted)]` (NOT `--accent`). The bullseye is the loudest signal; the baselines-due glyph steps down so the 4-glyph stack has a clear hierarchy.
  - **Stack reorder**: stack order top→bottom is `🏔` (line 60) → `★` override (line 62) → `◉` workout (line 61) → `◎N` baselines-due (line 63). Move line 61 below line 62 in the JSX.
- **Acceptance**:
  - Days with `workoutCount > 0` render a `<Bullseye filled size={10} />` in the top-right stack.
  - Today's cell has `border-[var(--accent)] bg-[var(--accent-soft)]`. When today is also completed, the cell drops the soft gold bg (gold border only).
  - Override star recolored to `--warning`; `◎N` glyph recolored to `--muted`.
  - `grep "text-emerald-500\|border-emerald-500\|bg-emerald-500\|text-amber-500\|border-amber-500\|bg-amber-500" src/components/CalendarMonth.tsx` → 0.
  - Visual smoke at 390 px confirms ≤2 active color signals on any single cell.

#### C.4.3 `src/components/BottomNav.tsx` — MODIFY (**fixes E2, E3**)

- **Owner**: Agent 4
- **Resolution of UX §3 dot/label color contradiction (fixes E3)**: The dot uses **canonical `<Bullseye filled size={6}>`** (red rings — NOT recolored). The active **label** is `text-[var(--accent)]` gold. Do NOT wrap the Bullseye in `style={{ color: "var(--accent)" }}` — Bullseye fills are hardcoded `var(--target)` and don't consume `currentColor`, so the wrapper is a no-op anyway.
- **Cell-height parity (fixes E2)**: Inactive tabs render an invisible 6px-tall spacer where the dot would be. All five cells share the same height.

**Final cell-height target**: 56 px (8px top padding + 6px dot/spacer + 4px gap + ~20px label line-height + ~18px bottom padding). The grid-cols-5 row is uniform.

**Exact wrapping JSX for each tab `<Link>`** — the entire JSX of the inner content area:

```tsx
{tabs.map((t) => {
  const isActive =
    t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
  return (
    <Link
      key={t.href}
      href={t.href}
      aria-current={isActive ? "page" : undefined}
      className={`flex flex-col items-center justify-center gap-1 py-2 text-xs font-medium ${
        isActive ? "text-[var(--accent)]" : "text-[var(--muted)]"
      }`}
    >
      {isActive ? (
        <Bullseye filled size={6} aria-hidden />
      ) : (
        <span className="h-[6px] block" aria-hidden />
      )}
      <span>{t.label}</span>
    </Link>
  );
})}
```

Notes:
- Add import `import { Bullseye } from "@/components/Bullseye";`.
- Replace the existing `flex-1 text-center py-3 ...` className per the structure above.
- Preserve the existing `tabs` array and `usePathname()` wiring.
- Verify Bullseye renders inside this `"use client"` component without hydration warnings (pure SVG is safe per Risk 8).

- **Acceptance**:
  - Exactly one tab shows `<Bullseye filled size={6} />` red dot indicator at any time.
  - Inactive tabs show an invisible 6px spacer; all five cells have identical height (56 px target).
  - `aria-current="page"` present on active `<Link>`.
  - No inline `style={{ color: ... }}` wrapper around the Bullseye.
  - Active label renders in `var(--accent)` gold; inactive in `var(--muted)`.
  - Tap targets ≥ 44 px.
  - 5-column grid layout intact at 390 px width.

#### C.4.4 `src/app/goals/page.tsx` — MODIFY (**fix N1 — non-nullable schema**)

- **Owner**: Agent 4
- **Specific changes**:
  - Add import: `import { Bullseye } from "@/components/Bullseye";`
  - Add helper at top of file (per §B.5; non-nullable `targetDate`):
    ```ts
    function goalProgress(g: { createdAt: Date; targetDate: Date; status: string }): number {
      if (g.status === "achieved") return 1;
      if (g.status === "abandoned") return 0;
      const total = g.targetDate.getTime() - g.createdAt.getTime();
      if (total <= 0) return 0;
      const elapsed = Date.now() - g.createdAt.getTime();
      return Math.max(0, Math.min(1, elapsed / total));
    }
    ```
  - Next to each goal title in the list-row JSX, render (no null branch):
    ```tsx
    {(() => {
      const pct = goalProgress(g);
      return (
        <Bullseye
          size={20}
          progress={pct}
          aria-label={`${g.objective}: ${Math.round(pct * 100)}% progress`}
        />
      );
    })()}
    ```
  - **Line 60**: replace `border-red-500/40 text-red-500` with `border-[var(--danger)]/40 text-[var(--danger)]`.
  - **Line 62**: replace `border-amber-500/40 text-amber-500` with `border-[var(--warning)]/40 text-[var(--warning)]`.
- **Acceptance**:
  - Each goal row shows a `<Bullseye />`.
  - Achieved goals render full; abandoned render hollow (progress=0); active render time-based progress.
  - `grep "text-red-500\|text-amber-500\|border-red-500\|border-amber-500" src/app/goals/page.tsx` → 0.
  - `npx tsc --noEmit` clean.

---

## D. globals.css full rewrite (**preserves tap-highlight + input font-inherit per B5**)

This is the **literal complete final content** for `src/app/globals.css`. Agent 1 writes this verbatim. The two existing rules previously at the top of globals.css (`-webkit-tap-highlight-color: transparent` on body, `input/textarea/select/button { font-family: inherit }`) are inlined below — do not strip them.

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
  font-family: var(--font-sans), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  -webkit-tap-highlight-color: transparent;
}

input, textarea, select, button {
  font-family: inherit;
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
- The body fallback chain matches the existing `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` verbatim — do **not** introduce `system-ui, Roboto` (Concern B4).
- `--font-display: var(--font-dm-serif-display)` requires REQ-A2's font init to expose `--font-dm-serif-display` on `<html>` — Agent 1 owns both edits.
- If the existing globals.css has additional rules beyond the two preserved here, append them after the `bullseye-pop` block. Re-read the file before overwriting.

---

## E. Risk mitigation + QA

### Risk register

| # | Risk | Mitigation | Owner | Acceptance check |
|---|---|---|---|---|
| 1 | Worktree merge conflict in `globals.css` | Single agent owns globals.css (Agent 1), keyframes added in same wave | Agent 1 | Wave 1 = single-agent merge; no parallel writers |
| 2 | `next/font/google` build-time fetch fails | Vercel build env is online; local `.next/cache/fonts` caches; Playfair Display documented as fallback. **Fallback swap touches TWO files**: `layout.tsx` (font import + `variable` value) AND `globals.css` (`--font-dm-serif-display` → `--font-playfair-display` mapping). Concern B3 documented. | Agent 1 | `npm run build` succeeds; if fails, swap is a 2-file change |
| 3 | Token missing from dark `:root` block | Both `:root` blocks define identical token sets in §D | Agent 1 | `grep "(--target\|--success\|--warning\|--danger\|--accent-soft)" src/app/globals.css` → ≥10 matches |
| 4 | False-positive emerald migration | Research §10 confirmed all emerald sites are success-coded | Agent 3 | Visual smoke on baselines, calendar legend, plan-status, copy-button |
| 5 | False-positive red migration | Research §10 confirmed all red sites are danger/destructive | Agent 3 | Visual smoke on goal badge, error blocks, delete buttons |
| 6 | False-positive amber migration | Research §10 confirmed all amber sites are warning-coded | Agent 3 | Visual smoke on override star, stale baselines, ≤14d goals |
| 7 | Hidden hex literals in chart components | No hardcoded hex in WeightChart/ReadinessChart/HistoryChart | Agent 1 (palette swap propagates) | Browser smoke at `/stats` and `/history` |
| 8 | `<Bullseye>` in client `BottomNav` | Pure SVG, no server-only APIs | Agent 4 | `npm run build` succeeds; no hydration warnings |
| 9 | manifest.webmanifest JSON typo | Validate via `python3 -m json.tool` | Agent 1 | `python3 -m json.tool < public/manifest.webmanifest` exits 0 |
| 10 | `public/` cleanup deletes referenced asset | Pre-flight grep confirmed zero references | Agent 1 | `grep -rn "next.svg\|vercel.svg\|file.svg\|globe.svg\|window.svg" src/` → 0 before delete |
| 11 | `viewport.themeColor` mismatch with manifest | Both use `#0F0B07` per spec | Agent 1 | `grep "#0F0B07" src/app/layout.tsx public/manifest.webmanifest` → ≥2 |
| 12 | Goal `targetDate < createdAt` | Formula returns 0 (ill-formed); badge text carries date context | Agent 4 | Code path covered by `total <= 0 → 0` clause |
| 13 | Light-mode hex regression | Acceptance grep | Agent 1 | `grep -rn "#A87A1F\|#5C7A40\|#B8741C" src/ public/` → 0 |
| 14 | `BaselineBlockCard` title `✓` Unicode literal | Brand-neutral text; preserve | Agent 4 | Visual inspection only |
| 15 | `dotenv` for icon-render script | Already in devDependencies; script doesn't read env | Agent 2 | `npx tsx scripts/render-icons.ts` runs |
| 16 | `bg-[var(--success)]/5` opacity drift (Concern B2) | Visible bg-tinted-success site is essentially gone after rebrand; the only surviving call sites are `CopyPromptButton:17` (border + text only) and a couple of error-tier blocks. Low risk. Document for visual regression watch. | Agent 3 | Visual smoke on copy-button, baselines warning row |
| 17 | Cached PWA icons on installed install (Concern L1) | Add to PR description: "Reinstall the PWA to pick up new icons if previously installed." | Reviewer | PR description copy |
| 18 | apple-touch-icon link tag missing (Concern L3) | Added via `metadata.icons.apple` per §B.8 | Agent 1 | `grep "apple:" src/app/layout.tsx` → ≥1 |
| 19 | Logo strokes at 28 px (Concern N10) | Drop chest body outline at all sizes (chest is filled gold). Flanking hollow targets fade at 28 px — accept; that's the design (Option B uses them as low-contrast secondary detail) | Agent 2 | Visual smoke at 28 px in header |
| 20 | Override star burnt umber on cream (Concern C2) | Document the brand choice; user can request saturation bump if it reads wrong | Agent 4 | Note in PR description |

### Cross-cutting QA grep checklist (post-Wave 3, before PR)

```sh
# All should return 0:
grep -rn "Workout Planner" src/ public/
grep -rn "text-red-500\|text-amber-500\|text-emerald-500\|border-red-500\|border-amber-500\|border-emerald-500\|bg-red-500\|bg-amber-500\|bg-emerald-500" src/
grep -rn "text-blue-\|bg-blue-\|border-blue-" src/      # Concern N4 — insurance against future blue-class additions
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

### Iteration-2 deferrals (Concern N7)

PRD §3.2 lists secondary requirements (16) empty-state copy, (17) loading skeletons, (18) form focus rings, (19) button styling. v2 covers (16) via REQ-E1. **REQs E2 / E3 (PRD §3.2 #17, #18, #19 — loading skeletons, focus rings, button styling) are deferred to iteration 2 — out of scope for this PR.** Document in PR description.

### Bullseye-pop unused keyframe (Concern N9)

Keyframe ships ahead of consumer; if not wired by iteration 2, prune.

---

## F. Per-agent prompt outline

The orchestrator appends the full Developer-Agent prompt template after each opening below. **Every prompt opening must point developers at this v2 file, not v1.**

### Agent 1 — Foundation prompt opening

> You are **Agent 1 (Foundation)** for the Goaldmine rebrand. Your worktree is `worktrees/agent-1-foundation/` branched off `feature/goaldmine-rebrand`. You own the foundational edits that block every other agent: (1) replace `src/app/globals.css` with the literal content from architecture-blueprint-v2 §D (which preserves `-webkit-tap-highlight-color` and `input/textarea/select/button { font-family: inherit }`), (2) wire `DM_Serif_Display` via `next/font/google` and render `<AppHeader />` + update metadata/themeColor + add the `metadata.icons` block in `src/app/layout.tsx`, (3) update `public/manifest.webmanifest` to Goaldmine identity, (4) delete the five Next-template SVGs from `public/`, (5) **ship a stub `src/components/AppHeader.tsx` exporting `function AppHeader() { return null; }`** so Wave 2's parallel agents typecheck cleanly. Agent 2 replaces the stub in Wave 2.
>
> Read `/Users/ggronnii/Development/workout-planner/.feature-dev/2026-05-05-goaldmine-rebrand/agents/architecture-blueprint-v2.md` sections **A, B, C.1.x, D, E** before touching any file. The blueprint contains the literal globals.css content you must write — do not re-derive palette values. Acceptance gates: `npx tsc --noEmit` clean, `npm run lint` clean, `npm run build` succeeds, the cross-cutting greps in §E return zero. Commit with `feat(rebrand): palette, font, manifest, layout foundation + AppHeader stub`.

### Agent 2 — Brand components prompt opening

> You are **Agent 2 (Brand components)** for the Goaldmine rebrand. Your worktree is `worktrees/agent-2-brand/` branched off `feature/goaldmine-rebrand` AFTER Agent 1's merge. You own the three real SVG components (`Logo`, `Bullseye`, `AppHeader` — replacing Agent 1's stub), the static PWA icon (`public/icon.svg`), the icon-render script + dev-dep, and the two generated PNGs. Your work has no consumer dependencies inside this wave — Agent 3 runs in parallel and never imports your new files; Agent 4 (Wave 3) will consume `<Bullseye>` after you merge.
>
> Read `/Users/ggronnii/Development/workout-planner/.feature-dev/2026-05-05-goaldmine-rebrand/agents/architecture-blueprint-v2.md` sections **A, B.1, C.2.x** AND `docs/ux-research/goaldmine-rebrand.md` §1 (Logo Option B) and §2 (Bullseye anatomy) before writing SVG geometry. The blueprint pre-fills the prop signatures and component skeletons. **Critical rules**: (a) Logo layer 8 (hero-target outline) is mandatory, not optional. (b) Logo.tsx must begin with the file-header sync-rule comment specified in §C.2.1. (c) Bullseye props are a strict TS discriminated union — `filled` and `progress` are mutually exclusive at the type level. (d) AppHeader inner div has NO `max-w-md` (full-viewport brand strip on wide screens). (e) `public/icon.svg` includes a 10% safe-area `#0F0B07` background rect for OS maskable. Acceptance gates: `Logo` renders cleanly at sizes 24/28/32/48/192/512; `Bullseye` produces visually-distinct hollow vs filled outputs at all four motif sizes; both PNGs exist and are 192×192 / 512×512; `npx tsc --noEmit` clean. Commit with `feat(rebrand): brand components — Logo, Bullseye, AppHeader, PWA icons`.

### Agent 3 — Color migration + empty states prompt opening

> You are **Agent 3 (Color migration + empty states)** for the Goaldmine rebrand. Your worktree is `worktrees/agent-3-colors/` branched off `feature/goaldmine-rebrand` AFTER Agent 1's merge. You run in parallel with Agent 2. You own the hardcoded-Tailwind-hue → CSS-variable token migration across ~22 files plus the empty-state copy refresh on five page files. **Critical**: when migrating colors in a file Agent 4 also edits (`BaselineBlockCard.tsx`, `CalendarMonth.tsx`, `BottomNav.tsx`, `goals/page.tsx`), **only modify the lines listed in §C.3 per file**. Do NOT add imports or modify other lines — Agent 4 owns the imports + JSX additions in Wave 3.
>
> Read `/Users/ggronnii/Development/workout-planner/.feature-dev/2026-05-05-goaldmine-rebrand/agents/architecture-blueprint-v2.md` sections **A, B.6, C.3** before editing. The migration table is in §C.3 prelude; the per-file line table tells you exactly where to edit. Empty-state copy is locked in §B.6 with explicit render conditions and placement (Records condition is "no scheduled tests / no plan"; Journal condition is `allNotes.length === 0 && pending.count === 0` rendered inside the existing "Log a note" Card; Today restores the `npx prisma db seed` instruction; Calendar is a quiet caption gated on `cells.every(...)`). Render the bold portion as `<strong>` inside a single `<p>` per surface. Acceptance gates: post-merge grep `grep -rn "text-red-500\|text-amber-500\|text-emerald-500\|border-red-500\|border-amber-500\|border-emerald-500\|bg-red-500\|bg-amber-500\|bg-emerald-500" src/` returns ONLY the four Agent-4-owned sites; `npx tsc --noEmit` clean; `npm run lint` clean. Commit with `feat(rebrand): migrate hardcoded colors to semantic tokens; lock empty-state copy`.

### Agent 4 — Motif consumers prompt opening

> You are **Agent 4 (Motif consumers)** for the Goaldmine rebrand. Your worktree is `worktrees/agent-4-motif/` branched off `feature/goaldmine-rebrand` AFTER Wave 2 (Agents 2 + 3) merges. You own the `<Bullseye>` integration into the four consumer surfaces: `BaselineBlockCard` (size 14), `CalendarMonth` (size 10 in top-right stack), `BottomNav` (size 6 above active tab label), and `goals/page.tsx` (size 20 with progress prop). You also own the final color-migration cleanup at the four reserved sites Agent 3 deferred — every grep failure from §E should be zero after your merge.
>
> Read `/Users/ggronnii/Development/workout-planner/.feature-dev/2026-05-05-goaldmine-rebrand/agents/architecture-blueprint-v2.md` sections **A, B.4, B.5, C.4.x** before editing. Critical specs: (a) `goalProgress` is non-nullable (`Goal.targetDate` is NOT NULL in `prisma/schema.prisma:148`) — drop the null branch, no ternary in the JSX. (b) CalendarMonth: today's tint switches to `bg-[var(--accent-soft)]`; today + completed drops the gold bg fill; `◎N` glyph recolors to `text-[var(--muted)]` (NOT `--accent`); stack reorder is 60→62→61→63. (c) BottomNav: the dot is canonical red `<Bullseye filled size={6}>` — NO `style={{ color: ... }}` wrapper; the active LABEL is gold via `text-[var(--accent)]`; inactive tabs render an invisible 6px spacer for cell-height parity (target 56 px); add `aria-current="page"`. The exact wrapping JSX is in §C.4.3. (d) Do not import `<Bullseye>` from anywhere except `@/components/Bullseye`. Acceptance gates: all cross-cutting greps in §E return zero; visual smoke at 390 px confirms each surface; `npx tsc --noEmit` clean; `npm run build` succeeds; MCP `tools/list` curl returns the unchanged tool set. Commit with `feat(rebrand): wire Bullseye motif into BaselineBlockCard, CalendarMonth, BottomNav, goals page`.

---

/Users/ggronnii/Development/workout-planner/.feature-dev/2026-05-05-goaldmine-rebrand/agents/architecture-blueprint-v2.md
