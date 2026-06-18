# Flywheel QA — Content Flywheel (Epic #87, story 3.4-f / #97)

**Date:** 2026-06-17 · **Verdict:** ✅ PASS — flywheel verified end-to-end · **Production code modified:** none (AC4)

End-to-end verification of the content flywheel now that every piece has shipped:
caption composer (3.4-a), one-tap Share (3.4-b/#93), recap-ready Sunday routine (3.4-c/#94),
and post-state tracking (3.4-d/#95). Exercised against the live dev server (`:3000`) + MCP endpoint.
All test data created during QA was cleaned up (verified: 0 `QA-TEST` artifacts remain).

---

## AC1 — Caption composer produces a sensible card + caption for fitness + project + empty week ✅

Exercised `/recap/caption?weekOffset=&goalId=` (deterministic `composeCaption`) and `/recap/card` (PNG) per vertical.

| Scenario | goal | Caption (verbatim) | Card |
|----------|------|--------------------|------|
| **Fitness** (focus) | Mt. Elbert | `Week 7 · Day 47 — Summit Mt. Elbert…` / `WORKOUTS 6 · VOLUME 5,370 lb · NEW PRs 11 · ELEVATION 1,260 ft` / `🔥 13-day streak` / `#buildinpublic #fitness #goaldmine` | 200 image/png, 140 KB |
| **Project** | Chewgether | `15 weeks to Sep 30 — Ship Chewgether…$1,000/mo MRR` / `MILESTONES 0/7` / `🔥 13-day streak` / `#buildinpublic #projectgoal #goaldmine` | 200 image/png, 116 KB |
| **Empty week** (offset −20) | fitness | `Week 1 · Day 1 — Summit Mt. Elbert…` / `A quiet week — back at it.` / `🔥 13-day streak` | 200 image/png, 127 KB |

- **Goal-generic confirmed:** the project vertical renders different stat slots (weeks-to-date, MILESTONES, MRR objective, `#projectgoal`) vs the fitness vertical (workouts/volume/PRs/elevation, `#fitness`) — no hardcoded focus-goal assumptions.
- **Empty week degrades gracefully:** no crash, a calm "A quiet week — back at it." line, card still renders a valid PNG.

## AC2 — Share works at 390px (Web Share on mobile + copy/download fallback on desktop) ✅

`/recap` page surface, verified at the data/markup layer (`max-w-md` mobile-first column fits 390px):
- ✅ `max-w-md mx-auto` column (≤448px → fits 390px phone width)
- ✅ `min-h-[44px]` tap targets on the Share / template / nav controls
- ✅ Desktop fallback present: `download="recap-card.png"` anchor + clipboard caption copy (`RecapClient.handleShare` else-branch)
- ✅ Share asset pipeline live: `/recap/card?weekOffset=0&template=coal` → HTTP 200 PNG; `/recap/caption` → JSON caption
- **Runtime note:** `navigator.share`/`navigator.canShare` is a browser-only API — the native mobile share-sheet path is verified by code inspection (`RecapClient.tsx:122`); the desktop download/clipboard fallback path is the one reachable headlessly and is confirmed wired. Recommend one real-device tap-through on iOS Safari before any public launch.

## AC3 — Routine nudge appears + clears; posted-state renders "posted ✓" ✅

**Recap-ready nudge lifecycle** (simulating the #94 routine step 6):
1. `log_open_item` with body `[recap:2026-W25] …recap card is ready… Post it: /recap` → created.
2. `/coach` rendered it ("…recap card is ready — 11 new PRs this week. Post it: /recap") ✅
3. Resolved it (sets `resolvedAt` — the identical DB mutation `markRecapPosted` performs on the newest `[recap:` match) → `/coach` no longer shows it ✅

**Posted-state render** (`markRecapPosted` read path, #95):
1. `log_note type:shared_recap targetDate:2026-06-15` (this week's Monday → offset 0).
2. `/recap` rendered **"✓ Posted to Instagram"** + Share button demoted to **"Share again"** ✅
3. Deleted the marker → `/recap` reverted to the not-posted primary "Share" ✅

**Integration note (the #94 ↔ #95 seam):** `markRecapPosted` resolves the newest unresolved `[recap:` open_item (code-verified at `recap-actions.ts:77`), NOT the `[week:` coaching brief — so posting clears the recap nag without dismissing unrelated weekly guidance. The live nudge-clear above used `resolve_open_item`, which applies the same `resolvedAt` mutation; the UI-driven `markRecapPosted` path could not be invoked headlessly (it's a server action) and is covered by code inspection + the shared resolve mechanism.

## AC4 — No production code modified by QA ✅
This story touched only `docs/qa/`. No `src/` changes. (`git status` clean of source edits during QA.)

---

## Observations (non-blocking)
- **Live streak on historical cards:** `streakDays` is always live-now (by design per the recap PRD), so an empty week 20 weeks ago still shows "🔥 13-day streak". Cosmetically odd on a back-dated card but intentional — the streak reflects current momentum, not the historical week. No action needed; flagged for awareness if a future story renders truly-historical streaks.
- **Native Web Share** is the one path not headlessly testable — see AC2 runtime note. A single real-device pass is the only gap before a public launch.

## Verdict
The content flywheel (#87) is verified end-to-end: routine generates a card + recap-ready nudge → `/coach` surfaces it → tap to `/recap` → Share (Web Share or download fallback) → `markRecapPosted` records the post and clears the recap nudge → `/recap` shows "Posted ✓ / Share again". Caption + card are sensible and goal-generic across fitness, project, and empty weeks. **PASS.**

Remaining in epic: #96 (true IG Graph API auto-post) — explicitly deferred to v2.
