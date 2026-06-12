# Completion Report — Sprint 4: Goal-Type-Aware Project UI

**Status**: Complete · 1 iteration + 1 fix pass · direct-to-main
**Roadmap issues**: #35 #36 #37 #38 #39 #40 #58 (closed on ship)

## What was built
The dashboard now branches on the focus goal's kind. With a project goal in focus: Today renders the **QuestCard Hero** (live Bullseye at done/total, today's ScheduledItems checklist, MRR "$X / $Y" card, next-milestone card with urgency chip, Claude-directed empty state, once-per-day completion pop); the calendar shows **◆ scheduled-item markers** (new legend kind + PROJECT_DEFAULT_LEGEND fallback + gated query); `/goals/[id]/plan` renders a **month-grouped CollapsibleCard timeline** with status glyphs and "X / Y milestones complete"; `/progress` adds a **milestone burn-down** card. With the fitness goal in focus, all four pages are byte-identical (proven by post-cleanup text diff) and issue zero ScheduledItem queries.

## Files (12, +767/−24 + fix bf98f97)
page.tsx · ProjectTodayView.tsx (new) · TodayCelebration.tsx (progress prop) · legend.ts · MarkerIcon.tsx · CalendarMonth.tsx · calendar.ts · goal-events.ts (📅→◆) · goals/[id]/plan/page.tsx · ProjectPlanView.tsx (new) · progress/page.tsx · MilestoneBurnDown.tsx (new)

## Requirements
REQ-001..006 DONE (QA PASS post-fix); REQ-007 (#58) executed: 29/29 effective, fitness byte-identical, fixtures cleaned.

## Agent utilization
UX-research orchestrator (background, report + 390px mockup + 21-row ledger) ∥ codebase Research → Architect (waited for UXR) → Devil's Advocate (NEEDS REVISION: 2 HIGH — UTC month-label off-by-one; dead progress var making the Bullseye binary — both would have shipped wrong) → Architect v2 → 3 parallel Devs (disjoint files, zero conflicts; relaunched once after a session-limit interruption) → QA (MINOR FIXES) → Fix agent (3 × timeZone) → orchestrator live smoke.

## UX-research ledger
**20 shipped / 1 reworked (UXR-s4-20: upcoming-7d query dropped — nothing renders it) / 0 dropped** — ticked in `docs/ux-research/sprint-4-project-ui.md`.

## Known limitations / follow-ups
1. **User visual sign-off** (UXR §9): 7 ⚠ items at real 390px — ◆ legibility, urgency threshold, pop timing, low-count rings, off-tap celebration, 2 contrast spots.
2. Plan-page empty-state copy paraphrases the issue AC (accepted deviation).
3. Calendar focus goal's items fetched by both the gated query and goal-events internals (minor double-fetch; no user impact).
4. No MCP surface change — no connector reload needed this sprint.
5. Next: Sprint 5 (chewgether seeding, #41–46/#48) — the UI is now ready to receive it.
