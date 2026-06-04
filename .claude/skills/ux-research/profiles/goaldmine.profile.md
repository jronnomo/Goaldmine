---
profile: goaldmine
active: true
---

# App Profile — Goaldmine (Workout Planner)

> Drop-in profile for the goaldmine workout-planner. Mirrors what the old
> repo-specific SKILL hard-coded, now externalized so the agent prose stays
> generic. (Refinement R1.)
> Every field below is verified against the repo `jronnomo/goaldmine`; cited
> `file:line` references were opened and confirmed.

## product
- **name:** Goaldmine (package name: `workout-planner`)
- **one_liner:** Single-user workout-tracker + coaching dashboard for a 90-day Mt. Elbert / shred / longevity program — Claude coaches in claude.ai over MCP; this PWA is the logger + history + charts surface (no LLM calls inside the app).

## platform
- **target:** Next.js 16.2.4 (App Router, Turbopack) web PWA — React Server Components by default, `"use client"` only where interaction demands it (`CLAUDE.md` Conventions; `quality-tools.md` Stack snapshot)
- **primary_viewport:** mobile-first, responsive — design at 390px phone width first; `BottomNav` content caps at `max-w-md` (`src/components/BottomNav.tsx:90`)
- **mockup_width:** ≤ 390px phone column

## stack
- **ui:** React 19.2 + Tailwind v4; inline SVG glyphs (no icon library — icons are hand-rolled SVG, e.g. `LogLauncher.tsx`, `MoreSheet.tsx`); `next/font` (Geist sans/mono + DM Serif Display as `--font-display`, `src/app/layout.tsx:18`)
- **animation:** **CSS transitions / keyframes ONLY** — no Framer Motion, no animation library (verified: no `framer`/`motion` import anywhere in `src/`). Signature motion lives in `src/app/globals.css`: `@keyframes bullseye-pop` (320ms, `:100`/`:107`) and the native `<dialog>` BottomSheet slide (`transform 240ms cubic-bezier(0.16,1,0.3,1)`, `:174`; `::backdrop` opacity 160ms, `:148`; entry via `@starting-style`). Respect `prefers-reduced-motion` (`:110`, `:186`).
- **data:** Prisma 7.8 → Postgres (Neon) via the `prisma` singleton (`src/lib/db.ts`); server components read directly. Recharts ^3.8 is the ONLY charting lib (`ReadinessChart.tsx`, `WeightChart.tsx`, `HistoryChart.tsx`). Mutations are server actions + `revalidatePath`. No client data-fetching layer (no React Query) — this is a server-rendered app.
- **key_libs:** `recharts` (charts only); `@modelcontextprotocol/sdk` (the MCP write/read surface, NOT a UI lib); `zod` (tool input validation). `@/lib/calendar` is the mandatory USER_TZ-aware date layer — every date/time helper routes through it (`quality-tools.md` gotcha #5).

## design_tokens
- **source:** `src/app/globals.css` — CSS custom properties on `:root`, surfaced to Tailwind v4 via `@theme inline` (`:19`)
- **theming_mechanism:** Tailwind v4 `@theme` CSS vars. Consumed in markup as `bg-[var(--card)]`, `text-[var(--accent)]`, `border-[var(--border)]`, etc. Theming flips three ways, all byte-identical per side: `@media (prefers-color-scheme: dark)` (`:32`), explicit `:root[data-theme="light"|"dark"]` set by `ThemeToggle` (`:53`/`:69`), and an inline pre-hydration script in `src/app/layout.tsx:60` that reads `localStorage['goaldmine.theme']`. Token names: `--background --foreground --muted --card --border --accent --accent-fg --accent-soft --target --target-fg --success --warning --danger`.
- **two_medium_axis:** light ↔ dark. Light: bg `#FAF3E3` cream / fg `#1F1408` / card `#FFFBF0` / border `#D9C8A2` / accent `#8A6212` gold / target `#A82A1F` barn-red. Dark: bg `#0F0B07` coal / fg `#F4E9D4` / card `#1A130C` / border `#3A2E1F` / accent `#D4A437` gold / target `#C0392B`. Every mockup must state both sides.
- **token_rules:** NO hardcoded color literals in markup — every color comes from a `var(--…)` token via `globals.css`. WCAG AA contrast discipline (the cream/gold palette is contrast-tight; verify accent-on-cream and muted-on-card pass AA before shipping). Charts must theme-flip too — pass token vars to Recharts, never hex.

## brand_voice
- **enabled:** true   # the VISUAL motif (Bullseye/target + treasure-chest mining mark) is real and load-bearing; the COPY voice is a light coach tone, not a pun vocabulary
- **vocabulary:** **Bullseye / target** = the brand's core glyph and progress metaphor — hollow ring = not done, filled rings = done, `progress=0..1` fills rings center-out (`src/components/Bullseye.tsx`, geometry per `docs/ux-research/goaldmine-rebrand.md §2`). It IS the active-nav indicator (filled when active, `BottomNav.tsx:106`) and the "today completed" celebration (`TodayCelebration.tsx`, fires `.bullseye-pop` once per day via localStorage). **Goaldmine** = "mining for goals": the logo is a treasure chest brimming with a hero target (`src/components/Logo.tsx`, Option B per rebrand §1). **MarkerIcon** maps a goal's legend to glyphs (🥾/⛏️/🏔️ for the Mt. Elbert hike goal; Bullseye for "trained") (`src/components/MarkerIcon.tsx`).
- **tone:** neutral-precise, encouraging fitness-coach voice for a single user; no pun layer. Copy is direct and data-forward ("Today", "Plan", "Progress"). Mining/mountaineering motif lives in the *visuals*, not the prose.
- **voice_reference:** `docs/ux-research/goaldmine-rebrand.md` (the canonical brand/identity doc); the Bullseye + Logo components above; nav labels in `BottomNav.tsx:30` (`TABS`).

## named_interactions
# The handful of genuinely signature interactions — verified file:line. The
# codebase is young and motion is deliberately minimal (CSS-only), so this
# catalog is short and honest rather than padded.
- **Bullseye glyph** (`src/components/Bullseye.tsx`) — the brand target as a single canonical SVG (viewBox 0 0 32 32) that scales 6→20+px and supports `filled`, hollow, and `progress=0..1` (rings fill center-out, `progressToRings:135` / `renderRings:55`). Reuse this for ANY "progress toward a goal" surface; it is THE motif. All ring fills are `var(--target)` / `var(--target-fg)`.
- **Bullseye-pop celebration** (`src/app/globals.css:100` keyframe + `:107` class; driver `src/components/TodayCelebration.tsx`) — a one-shot scale+fade (0.6→1.08→1.0 over 320ms, `cubic-bezier(0.16,1,0.3,1)`) added imperatively to a freshly-completed Bullseye, gated to once-per-day via `localStorage['goaldmine.celebrated.<dateKey>']`. Reduced-motion → no animation. ⚠ Note: `TodayCelebration` is defined but not yet wired into any rendered page (React plumbing intentionally deferred per the globals.css comment) — treat the celebration as the intended pattern for "day complete," not as currently-firing.
- **BottomSheet (Log / More)** (`src/components/BottomSheet.tsx` + `src/app/globals.css:160`) — native `<dialog>` + `showModal()` (focus-trap, Esc, aria-modal for free), panel slides up `translateY(100%)→0` over 240ms via `@starting-style`; `::backdrop` scrim fades 160ms. The **Log** and **More** nav tabs open these sheets (`BottomNav.tsx:156`/`:165`) rather than navigating. Any new "quick action" surface should reuse this sheet, not invent a modal.
- **BottomNav** (`src/components/BottomNav.tsx`) — fixed 5-column grid (`grid-cols-5`, `:90`), `max-w-md` centered; two link tabs (Today, Plan), two sheet-trigger tabs (Log, More), Progress link between. Active state = filled Bullseye + `var(--accent)` text (`:106`); the tabs carry sub-route matching logic (Plan = `/calendar`|`/days`, Progress = `/progress`|`/stats`|`/baselines`, `:42`/`:54`). Any new top-level destination must slot into this 5-tab model (likely under More).

## screen_inventory
- nav structure (`src/components/BottomNav.tsx:30` `TABS`): **Today · Plan · Log(sheet) · Progress · More(sheet)** — bottom tab bar, `grid-cols-5`, `max-w-md` centered.
- **Today** — `src/app/page.tsx` (`/`) — the daily home: today's prescribed workout/baselines, readiness, the rhythm surface.
- **Plan** — `src/app/calendar/page.tsx` (`/calendar`) + `src/app/days/[dateKey]/page.tsx` (`/days/<dateKey>`) — month calendar (`CalendarMonth.tsx`, legend via `MarkerIcon`) and per-day detail/override.
- **Log** — a BottomSheet (`LogLauncher.tsx`): inline Weight / Meal / Note forms, plus links out (no dedicated route).
- **Progress** — `src/app/progress/page.tsx` (`/progress`), with sub-routes `src/app/stats/page.tsx` (`/stats`) and the baselines section `src/app/baselines/page.tsx` (+ `new`, `test/[testName]`, `results/[id]/edit`, `exercise/[name]`). Charts via Recharts.
- **More** — a BottomSheet (`MoreSheet.tsx`) → `src/app/coach/page.tsx` (`/coach`), `src/app/nutrition/page.tsx` (`/nutrition`, + `[id]/edit`), `src/app/history/page.tsx` (`/history`), `src/app/journal/page.tsx` (`/journal`); plus the `ThemeToggle`.
- Other routes: **Goals** `src/app/goals/page.tsx` (+ `[id]`, `[id]/plan`, `[id]/revise`, `[id]/revisions/[revisionId]`), **Import** `src/app/import/page.tsx` (Strong-app txt paste), **Workout detail** `src/app/workouts/[id]/page.tsx`.

## benchmark_apps
- Strong, Hevy (workout logging + history + PR tracking — closest to the log/export model); Fitbod (prescribed-day rhythm + readiness); Strava, AllTrails (hike/elevation toward the Mt. Elbert hero goal); Apple Fitness (rings/streak celebration — the Bullseye-fill is a direct cousin of Activity rings).

## product_thesis
> The app is a fast, honest **logger + dashboard** for ONE user; all reasoning happens in claude.ai over MCP — the app itself makes no LLM calls and must stay cheap, server-rendered, and dead-simple to use on a phone mid-workout. The single source of truth is the database the MCP tools read/write; the UI surfaces that state and edits it, but never invents prescription detail (the override-aware reads in `quality-tools.md` gotcha #7 exist precisely because the naive read silently misses per-day overrides). Visual identity = the Bullseye/target "mining for goals" motif; motion is deliberately minimal CSS, spent on genuine completion moments (the once-per-day bullseye-pop), not decoration.

## invariant_rules
- Every mockup shows BOTH light and dark (background, foreground, card, border, accent, target) — the palette is in `globals.css`.
- NO hardcoded color literals — all colors via `var(--…)` Tailwind v4 tokens; charts pass tokens to Recharts, never hex.
- Server Components by default; `"use client"` only where interaction demands it. Don't propose client-side data fetching — reads are server-side; mutations are server actions + `revalidatePath`.
- Motion is CSS transitions/keyframes only — do NOT propose Framer Motion or any animation library. Honor `prefers-reduced-motion`.
- All date/time logic routes through `@/lib/calendar` (USER_TZ-aware); never raw `setHours`/`getDate`.
- Reads must be override-aware where prescription detail is shown (`resolveDay(now)`, not the rotation default).
- Touch targets ≥ 44px (nav tabs are `py-3` full-cell; keep new controls ≥44px); on-brand copy in mockups — never lorem ipsum.
- The Bullseye is the canonical progress glyph — reuse `Bullseye` rather than inventing a new progress indicator; reuse `BottomSheet` rather than a new modal.
- WCAG AA contrast — verify the contrast-tight cream/gold light palette and the coal/gold dark palette both pass before shipping.

## deliverable
- **target:** committed-file   # single-user repo; prior runs delivered to docs/ux-research/<slug>.md (see full-app-audit.md, goaldmine-rebrand.md). gh issue comment only if an issue number is explicitly supplied.
- **repo:** jronnomo/goaldmine
- **file_path:** docs/ux-research/<slug>.md   # prior outputs are flat files directly under docs/ux-research/ (not per-slug subdirs)
- **flavor_layer:** false   # neutral coach voice, no pun vocabulary — keep the stable analytical core only; the branded-writeup layer would be hollow scaffolding here

## visualization
- **phase_a:** ASCII   # divergent options at 390px phone width — always
- **phase_b_diagrams:** true   # Mermaid for the chosen direction (renders inline on GitHub)
- **phase_b_pixel_artifact:** html   # web app → a self-contained .html mockup using the real globals.css tokens is the most faithful pixel artifact (it can use the actual CSS vars + Tailwind utility shapes); commit under docs/ux-research/ and link

## outcome
- **enforce_invocation:** true   # feature-dev Phase 2 invokes /ux-research OR logs "UX-research: skipped — <reason>" in the PRD
- **ledger:** true
- **ledger_path:** docs/ux-research/<slug>-ledger.md   # flat alongside the report (this repo keeps docs/ux-research/ flat, not per-slug subdirs)
