---
profile: goaldmine
active: true
---

# App Profile — Goaldmine (Workout Planner)

> Drop-in profile for goaldmine. Mirrors what the old repo-specific SKILL
> hard-coded, now externalized so the agent prose stays generic. (Refinement R1.)
> Facts verified against the repo `jronnomo/goaldmine` as of 2026-07-02.
> References are file-level anchors; exact line numbers drift as the codebase
> moves — re-grep rather than trusting a stale `:NN`.

## product
- **name:** Goaldmine (repo `jronnomo/goaldmine`; package legacy name `workout-planner`)
- **one_liner:** Multi-user, multi-tenant AI-coached goal engine — users log workouts/hikes/nutrition/metrics toward measurable goals (fitness or project kind); Claude coaches in claude.ai over MCP/OAuth; this PWA is the logger + dashboard + progression surface (no LLM calls inside the app). Auth.js sign-in, invite-gated signup, per-user onboarding.

## platform
- **target:** Next.js 16.2.4 (App Router, Turbopack) web PWA — React Server Components by default, `"use client"` only where interaction demands it (`CLAUDE.md` Conventions; `quality-tools.md` Stack snapshot)
- **primary_viewport:** mobile-first, responsive — design at 390px phone width first; `BottomNav` content caps at `max-w-md` (`src/components/BottomNav.tsx`, `grid grid-cols-5 max-w-md`)
- **mockup_width:** ≤ 390px phone column

## stack
- **ui:** React 19.2 + Tailwind v4; inline SVG glyphs (no icon library — icons are hand-rolled SVG, e.g. `LogLauncher.tsx`, `MoreSheet.tsx`); `next/font` (Geist sans/mono + DM Serif Display as `--font-display`, `src/app/layout.tsx`)
- **animation:** **CSS transitions / keyframes ONLY** — no Framer Motion, no animation library (verified: no `framer`/`motion` import anywhere in `src/`). Signature motion lives in `src/app/globals.css`: `@keyframes bullseye-pop` (320ms, `cubic-bezier(0.16,1,0.3,1)`) and the native `<dialog>` BottomSheet slide (transform 240ms, same easing family; `::backdrop` opacity fade; entry via `@starting-style`). Respect `prefers-reduced-motion` (guards exist for both).
- **data:** Prisma 7.8 → Postgres (Neon) via the **tenant-scoped client** `const db = await getDb()` (`src/lib/db.ts` — enforces per-user `userId` filtering; the raw `prisma` singleton is auth/OAuth infra only); server components read directly. Recharts ^3.8 is the ONLY charting lib (`ReadinessChart.tsx`, `WeightChart.tsx`, `HistoryChart.tsx`). Mutations are server actions + `revalidatePath`. No client data-fetching layer (no React Query) — this is a server-rendered app.
- **key_libs:** `recharts` (charts only); `@modelcontextprotocol/sdk` (the MCP write/read surface, NOT a UI lib); `zod` (tool input validation). `@/lib/calendar` is the mandatory USER_TZ-aware date layer — every date/time helper routes through it (`quality-tools.md` gotcha #5).

## design_tokens
- **source:** `src/app/globals.css` — CSS custom properties on `:root`, surfaced to Tailwind v4 via `@theme inline`
- **theming_mechanism:** Tailwind v4 `@theme` CSS vars. Consumed in markup as `bg-[var(--card)]`, `text-[var(--accent)]`, `border-[var(--border)]`, etc. Theming flips three ways, all byte-identical per side: `@media (prefers-color-scheme: dark)`, explicit `:root[data-theme="light"|"dark"]` set by `ThemeToggle`, and an inline pre-hydration script in `src/app/layout.tsx` that reads `localStorage['goaldmine.theme']`. Token names: `--background --foreground --muted --card --border --accent --accent-fg --accent-soft --target --target-fg --success --warning --danger`.
- **two_medium_axis:** light ↔ dark. Light: bg `#FAF3E3` cream / fg `#1F1408` / card `#FFFBF0` / border `#D9C8A2` / accent `#8A6212` gold / target `#9A480F` rust. Dark: bg `#0F0B07` coal / fg `#F4E9D4` / card `#1A130C` / border `#3A2E1F` / accent `#D4A437` gold / target `#D97A3D`. (Corrected 2026-09-02, UXR-TRENDS-60: this line previously read `#A82A1F`/`#C0392B` barn-red — those are `--danger`, not `--target`. Always verify token values against `src/app/globals.css`, never against this file.) Every mockup must state both sides.
- **token_rules:** NO hardcoded color literals in markup — every color comes from a `var(--…)` token via `globals.css`. WCAG AA contrast discipline (the cream/gold palette is contrast-tight; verify accent-on-cream and muted-on-card pass AA before shipping). Charts must theme-flip too — pass token vars to Recharts, never hex.

## brand_voice
- **enabled:** true   # Theme = **"a gold rush for goals," with an RPG/gamified spin.** It is VISUAL + SYSTEMIC (Bullseye progress, levels, badges, rarity tiers, earned celebration — `BadgeWall.tsx`, `LevelMedallion.tsx`, `/character`, the `rarity-tiers`/`rpg-character-stats` research), NOT a pun vocabulary in prose. It surfaces at **strike moments** — a goal hit, a level/badge, a streak, day-complete — where celebration is *earned*. **Routine/utility surfaces (logging, editing, corrections, lists) stay calm** — gamifying housekeeping cheapens the real payoff and breaks the minimal-motion budget. The VISUAL motif (Bullseye/target + treasure-chest mining mark) is load-bearing; the COPY voice stays a light coach tone, not a pun layer.
- **vocabulary:** **Bullseye / target** = the brand's core glyph and progress metaphor — hollow ring = not done, filled rings = done, `progress=0..1` fills rings center-out (`src/components/Bullseye.tsx`, geometry per `docs/ux-research/goaldmine-rebrand.md §2`). It IS the active-nav indicator (filled when active, `BottomNav.tsx`) and the "today completed" celebration (`TodayCelebration.tsx`, hosted in the Today QuestCard ribbon, fires `.bullseye-pop` once per day via localStorage). **Goaldmine** = "mining for goals": the logo is a treasure chest brimming with a hero target (`src/components/Logo.tsx`, Option B per rebrand §1). **MarkerIcon** maps a goal's legend to glyphs (🥾/⛏️/🏔️ for the Mt. Elbert hike goal; Bullseye for "trained") (`src/components/MarkerIcon.tsx`).
- **tone:** neutral-precise, encouraging coach voice; no pun layer. Copy is direct and data-forward ("Today", "Plan", "Progress"). The gold-rush / mining / RPG theme lives in the *visuals and progression systems* (Bullseye, levels, badges, rarity, celebration) — never in the prose, and never on routine/utility surfaces. Multi-user now: empty/zero-row states for brand-new users are first-class surfaces, not afterthoughts.
- **voice_reference:** `docs/ux-research/goaldmine-rebrand.md` (the canonical brand/identity doc); the Bullseye + Logo components above; nav labels in `BottomNav.tsx` (`TABS`).

## named_interactions
# The handful of genuinely signature interactions — verified file:line. The
# codebase is young and motion is deliberately minimal (CSS-only), so this
# catalog is short and honest rather than padded.
- **Bullseye glyph** (`src/components/Bullseye.tsx`) — the brand target as a single canonical SVG (viewBox 0 0 32 32) that scales 6→20+px and supports `filled`, hollow, and `progress=0..1` (rings fill center-out via `progressToRings` / `renderRings`). Reuse this for ANY "progress toward a goal" surface; it is THE motif. All ring fills are `var(--target)` / `var(--target-fg)`.
- **Bullseye-pop celebration** (`src/app/globals.css` keyframe + class; driver `src/components/TodayCelebration.tsx`) — a one-shot scale+fade (0.6→1.08→1.0 over 320ms, `cubic-bezier(0.16,1,0.3,1)`) added imperatively to a freshly-completed Bullseye, gated to once-per-day via `localStorage['goaldmine.celebrated.<dateKey>']`. Reduced-motion → no animation. Now LIVE: hosted inside the QuestCard ribbon on Today (`src/app/page.tsx` "THE FOLD" — QuestCard hosts TodayCelebration internally; exactly one completion moment per day).
- **BottomSheet (Log / More)** (`src/components/BottomSheet.tsx` + `src/app/globals.css`) — native `<dialog>` + `showModal()` (focus-trap, Esc, aria-modal for free), panel slides up `translateY(100%)→0` over 240ms via `@starting-style`; `::backdrop` scrim fades 160ms. The **Log** and **More** nav tabs open these sheets (`BottomNav.tsx`) rather than navigating. Any new "quick action" surface should reuse this sheet, not invent a modal.
- **BottomNav** (`src/components/BottomNav.tsx`) — fixed 5-column grid (`grid-cols-5`), `max-w-md` centered; two link tabs (Today, Plan), two sheet-trigger tabs (Log, More), Progress link between. Active state = filled Bullseye + `var(--accent)` text; the tabs carry sub-route matching logic (Plan = `/calendar`|`/days`, Progress = `/progress`|`/stats`|`/baselines`). Any new top-level destination must slot into this 5-tab model (likely under More — which now holds Character, Goals, Coach prompts, Recap, Compare, Nutrition, History, Journal).

## screen_inventory
- nav structure (`src/components/BottomNav.tsx` `TABS`): **Today · Plan · Log(sheet) · Progress · More(sheet)** — bottom tab bar, `grid-cols-5`, `max-w-md` centered.
- **Today** — `src/app/page.tsx` (`/`) — the daily home: QuestCard ribbon (celebration), today's prescribed task via `resolveDay` (workout/baseline/hike/rest, kind-routed for project goals via `ProjectTodayView`), readiness, get-started CTA for new users.
- **Plan** — `src/app/calendar/page.tsx` (`/calendar`, incl. compare-mode two-tap) + `src/app/days/[dateKey]/page.tsx` (`/days/<dateKey>`) — month calendar (`CalendarMonth.tsx`, legend via `MarkerIcon`) and per-day detail/override.
- **Log** — a BottomSheet (`LogLauncher.tsx`): inline Weight / Meal / Note forms, plus links out (no dedicated route).
- **Progress** — `src/app/progress/page.tsx` (`/progress`), with sub-routes `src/app/stats/page.tsx` (`/stats`) and the baselines section `src/app/baselines/page.tsx` (+ `new`, `test/[testName]`, `results/[id]/edit`, `exercise/[name]`). Charts via Recharts.
- **More** — a BottomSheet (`MoreSheet.tsx`) → **Character** `/character` (RPG level/badges/attributes), **Goals** `/goals`, **Coach prompts** `/coach`, **Recap** `/recap` (shareable recap card), **Compare** `/compare` (period-vs-period), `/nutrition` (+ `[id]/edit`), `/history`, `/journal`; plus the `ThemeToggle`.
- Other routes: **Goals detail** `src/app/goals/[id]` (+ `plan`, `revise`, `revisions/[revisionId]`, trends), **Import** `src/app/import/page.tsx` (Strong-app txt paste), **Workout detail** `src/app/workouts/[id]/page.tsx`, **Onboarding** `src/app/onboarding/` (guided first-goal + connect-Claude walkthrough), **Settings** `src/app/settings/` (incl. connected apps/OAuth revocation), **Auth** `src/app/signin/` + `src/app/request-access/` (invite-gated).

## benchmark_apps
- Strong, Hevy (workout logging + history + PR tracking — closest to the log/export model); Fitbod (prescribed-day rhythm + readiness); Strava, AllTrails (hike/elevation toward the Mt. Elbert hero goal); Apple Fitness (rings/streak celebration — the Bullseye-fill is a direct cousin of Activity rings).

## product_thesis
> The app is a fast, honest **logger + dashboard** — now multi-user — where all reasoning happens in claude.ai over MCP; the app itself makes no LLM calls and must stay cheap, server-rendered, and dead-simple to use on a phone mid-workout. The single source of truth is the (tenant-scoped) database the MCP tools read/write; the UI surfaces that state and edits it, but never invents prescription detail (the deferral-aware `resolveDay` reads in `quality-tools.md` exist precisely because the naive read silently misses per-day overrides and deferrals). Every surface must also work for a brand-new invited user with zero rows. Visual identity = the Bullseye/target "mining for goals" motif; motion is deliberately minimal CSS, spent on genuine completion moments (the once-per-day bullseye-pop), not decoration.

## invariant_rules
- Every mockup shows BOTH light and dark (background, foreground, card, border, accent, target) — the palette is in `globals.css`.
- NO hardcoded color literals — all colors via `var(--…)` Tailwind v4 tokens; charts pass tokens to Recharts, never hex.
- Server Components by default; `"use client"` only where interaction demands it. Don't propose client-side data fetching — reads are server-side; mutations are server actions + `revalidatePath`.
- Motion is CSS transitions/keyframes only — do NOT propose Framer Motion or any animation library. Honor `prefers-reduced-motion`.
- All date/time logic routes through `@/lib/calendar` (USER_TZ-aware); never raw `setHours`/`getDate`.
- Reads must be deferral-aware where prescription detail is shown: `resolveDay(now)` → switch on `todayTask`, render `activeWorkout`/`deferredWorkout` (the old `workoutTemplate` field was removed); never the rotation default.
- Owned-model data access in any proposed implementation goes through `getDb()` (tenant-scoped) — never the raw `prisma` singleton. New user-facing surfaces need explicit zero-row empty states.
- Touch targets ≥ 44px (nav tabs are `py-3` full-cell; keep new controls ≥44px); on-brand copy in mockups — never lorem ipsum.
- The Bullseye is the canonical progress glyph — reuse `Bullseye` rather than inventing a new progress indicator; reuse `BottomSheet` rather than a new modal.
- WCAG AA contrast — verify the contrast-tight cream/gold light palette and the coal/gold dark palette both pass before shipping.

## deliverable
- **target:** committed-file   # solo-dev repo; prior runs delivered to docs/ux-research/<slug>.md (see full-app-audit.md, goaldmine-rebrand.md, glance-back-forge-ahead.md). gh issue comment only if an issue number is explicitly supplied.
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
