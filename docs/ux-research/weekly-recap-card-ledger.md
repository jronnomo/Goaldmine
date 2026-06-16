# Recommendation Ledger — Weekly Recap Card

Stable IDs, assigned once and never renumbered. `Status` starts `proposed`; the implementing PR ticks each to `shipped` / `reworked` / `dropped` with a SHA / `file:line` / short reason. Source report: `docs/ux-research/weekly-recap-card.md`.

| ID | Recommendation | Type | Status | Evidence |
|----|----------------|------|--------|----------|
| UXR-recap-01 | "Bullseye Hero" chosen direction: filled Bullseye + readiness % as the card hero | layout | proposed | |
| UXR-recap-02 | Promote Day streak to a full-width hero band above a 2×2 of the other four stats | layout | proposed | |
| UXR-recap-03 | Vertical budget 150 / 440 / 240 / 460 / 140 within 1080×1920, ~64px inset | layout | proposed | |
| UXR-recap-04 | 5-stat grid as flex rows (`flex:1 1 0`), never CSS grid | component | proposed | |
| UXR-recap-05 | Progress bar = solid track + solid fill, rounded; % beside (not inside) the bar | component | proposed | |
| UXR-recap-06 | Bullseye rendered as concentric `borderRadius:9999px` div-stack (hex-literal port of `Bullseye.tsx`) | component | proposed | |
| UXR-recap-07 | Template A "Coal" exact palette + type scale | copy/layout | proposed | |
| UXR-recap-08 | Template B "Parchment" exact palette + type scale | copy/layout | proposed | |
| UXR-recap-09 | Empty/zero rule: "0" countable = normal color; "—" no-data = muted; cells never collapse | a11y | proposed | |
| UXR-recap-10 | Readiness shows "—" not "0%" when no targets / all missing | component | proposed | |
| UXR-recap-11 | Header omits "Week/Day of N" and shows date range only when no active plan | component | proposed | |
| UXR-recap-12 | Goal-generic single small kind accent (fitness→rust, project→gold, unknown→gold), degrades gracefully | component | proposed | |
| UXR-recap-13 | Stories: one `RecapStorySlide` component, slides = cover / numbers / closing | layout | proposed | |
| UXR-recap-14 | Copy: one-word stat labels (`Workouts/Volume/PRs/Elevation`), `Day streak`; closing `On to Week 4.` | copy | proposed | |
| UXR-recap-15 | Footer = small Bullseye mark + `GOALDMINE` + `@gabe`; no tagline | copy/layout | proposed | |
| UXR-recap-16 | Two-tone lifted-surface bands (`#1A130C`) for depth instead of shadows/gradients | layout | proposed | |
| UXR-recap-17 | All px sizes are provisional — verify on real 1080×1920 + thumbnail scale, bias bolder | tuning⚠ | proposed | |
| UXR-recap-18 | Safe inset 64px + IG Story chrome gutters — verify on device | tuning⚠ | proposed | |
| UXR-recap-19 | Template B gold `#8A6212` on cream (~4.96:1) — large/fill only, never small text | tuning⚠ | proposed | |
| UXR-recap-20 | Low-% bar fill end-cap — verify the sliver/empty states read intentionally | tuning⚠ | proposed | |
| UXR-recap-21 | Bundled fonts (Geist Regular + SemiBold + DM Serif Display, subset <500KB) actually render in satori | tuning⚠ | proposed | |
| UXR-recap-22 | Progress-bar Bullseye fill-head marker (Template A) — justify vs plain bar before adding | decoration⚠ | proposed | |
| UXR-recap-23 | Footer treasure-chest logo vs plain Bullseye mark — default to Bullseye; OG-safe flattened chest only if earned | decoration⚠ | proposed | |
| UXR-recap-24 | Inline `<svg>` Bullseye is a v2 nicety; div-stack is primary — verify SVG renders before preferring | decoration⚠ | proposed | |
| UXR-recap-25 | Challenge (needs sign-off): denominator is dynamic 12wk = 84 days, not the PRD prose "90" | decision⚠ | proposed | |
| UXR-recap-26 | Card is a static PNG — no runtime animation; dashboard preview swap honors prefers-reduced-motion, CSS-only | animation | proposed | |
