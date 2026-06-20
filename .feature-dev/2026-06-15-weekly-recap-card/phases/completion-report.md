# Completion Report — Weekly Recap Card

**Date:** 2026-06-15 · **Status:** COMPLETE (pending push/deploy) · **Branch:** main · **Iterations:** 2

## What was built
A goal-generic Weekly Recap Card: server-rendered 1080×1920 PNGs (Coal + Parchment templates) from a week's logged data, exposed as a `/recap` dashboard page, three image route handlers (card + 3 Stories slides), and a `generate_recap_card` MCP tool that returns the inline PNG + structured stats. Progress bar derives from the **focus goal's** readiness (baseline→target) via `computeReadiness` — no hardcoded Elbert; relabels/recomputes for any focus goal. No Prisma migration (read-only).

## Files
| File | Change |
|------|--------|
| `src/lib/recap.ts` | NEW — `WeeklyRecap` contract, `computeWeeklyRecap`, `weekRangeLabel`, UNIT_FROM_PRIMARY |
| `src/lib/recap-templates.ts` | NEW — Coal/Parchment token constants, `getTemplate` |
| `src/lib/recap-card.tsx` | NEW — `RecapCard` + `RecapStorySlide` (satori JSX, div-stack Bullseye) |
| `src/lib/recap-render.tsx` | NEW — font loading, `IMAGE_OPTIONS`, `renderRecapCard`/`renderRecapStorySlide` |
| `src/lib/mcp/tool-helpers.ts` | +`imageAndJsonResult` |
| `src/lib/mcp/tools.ts` | +`generate_recap_card` registration |
| `src/app/recap/card/route.tsx`, `src/app/recap/story/[slide]/route.tsx` | NEW — PNG routes |
| `src/app/recap/page.tsx`, `src/components/RecapClient.tsx` | NEW — /recap page + controls |
| `src/app/progress/page.tsx`, `src/components/BottomNav.tsx` | "Share recap" entry + nav match |
| `src/app/recap/fonts/*.ttf` | NEW — Geist Regular, DM Serif Display, Geist SemiBold(*) |
| `next.config.ts` | +`outputFileTracingIncludes` for fonts (Vercel bundle) |

## Requirements: all DONE (REQ-001..005). Acceptance criteria met (build is environmental-only failure; see below).

## Verification (runtime, dev server + real DB)
- `/recap/card` Coal + Parchment → 200, 1080×1920 PNG; **visually inspected — header clean, footer anchored, data correct.**
- `/recap/story/{1,2,3}` × both templates → 200, 1080×1920. (Slide 1 satori multi-child-div crash fixed, iter 1.)
- Bad params (`weekOffset=5`, `story/9`) → 400.
- MCP `tools/list` shows `generate_recap_card`; `tools/call` → valid PNG (no `data:` prefix) + stats JSON (`has-data`, real DB data).
- `tsc` 0 errors, `lint` 0 errors.
- `npm run build`: compiles/bundles OK; fails ONLY at static prerender of DB-backed pages (`/_not-found`) because the sandbox can't reach Neon (P1001). Environmental — recap routes are `force-dynamic`, never prerendered; would build fine where Neon is reachable (e.g. Vercel).

## Devil's Advocate criticals (all resolved pre-code via v2 addendum)
CRIT-1 future-day header · CRIT-2 Date across RSC→client boundary · CRIT-3 phantom `units` field · CRIT-4 baseline PRs (descoped v1, `source` reserved) · DC-2 hardcoded handle→env · DC-3 ImageResponse duplication→centralized (also removed JSX from tools.ts) · DC-4 goalState tri-state · DC-5 number formatting · S-5 cardio-only volume.

## UX recommendation ledger outcomes (key rows)
- Header denominator → **shipped dynamic** `plan.totalWeeks*7` (live data shows 105 = 15-week plan).
- Bullseye div-stack (no SVG) → shipped.
- Coal + Parchment templates → shipped, both visually verified.
- `tuning⚠` px (header zone, vertical fill) → **reworked** in iter 2 (header spacer + `flex:1` footer push) after visual smoke; verified.
- DM Serif Display + Geist Regular → shipped & rendering.

## Known follow-ups
1. **Geist SemiBold is a temp copy of Geist-Regular** (true SemiBold 404'd from all sources). Coal bold weights render as regular until a real SemiBold `.ttf` is dropped at `src/app/recap/fonts/Geist-SemiBold.ttf` (IMAGE_OPTIONS already wires weight 600).
2. Cosmetic (left as-is): header all-caps (design choice), `overflow:hidden` objective clipping on very long objectives.
3. Verify fonts actually bundle on the first Vercel deploy (the `outputFileTracingIncludes` change targets this).

## Post-deploy
Reconnect the goaldmine MCP connector in claude.ai to pick up `generate_recap_card` (connector caches the tool list).
