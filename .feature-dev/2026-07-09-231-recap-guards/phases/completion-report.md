# Completion report — #231 — 2026-07-09 · SPRINT 11 COMPLETE

## Shipped (commit 833f5e0 on feature/phase1-auth)
1. **Empty-week guard**: server-computed `weeksWithData` from the CORRECTED 5-model set (workout, hike, baseline, logEntry, scheduledItem — the AC's set wrongly included never-read nutritionLog and omitted project activity); single query per model over the 13-week USER_TZ window; client skips BOTH the card `<img>` mount AND the `/recap/highlights` fetch (DA-caught second waste path) for empty weeks; card-implying controls hidden; copy split offset-0 ("Nothing to recap yet this week…") vs past ("Nothing was logged this week — pick another week."); week nav + posted badge preserved.
2. **Render-failure guard**: `onError` → fallback + Retry (cap 3, cache-busting nonce, terminal message), loading overlay cleared; failure state reset at all five cardUrl-mutating sites (DA-caught stale-state matrix).
3. **New pure helper** `bucketDatesToWeekOffsets` in calendar-core (client-safe) + 8 unit tests (incl. Sunday-23:59 USER_TZ boundary); postedWeeks refactored onto it (window widened Monday→Sunday-end — behavior-equal since shared_recap targetDates are Mondays; bucketing normalizes strays).
4. In-code doc: weeksWithData (image-mount gate) vs recap.ts emptyWeek (caption gate, workout/hike-only by design) are DIFFERENT signals — documented at both sites.

## Verification
tsc 0 · **672/672** (664+8) · lint 0 errors · build OK. Browser (real founder session): current week genuinely empty (last workout 11 days prior) → offset-0 copy with ZERO card/highlights requests — organic validation of the exact target scenario; data week (Jun 29–Jul 5: 2 workouts, 5 PRs) renders fully with both routes firing once; offset −12 shows past-empty copy; forced-500 patch → fallback, 3×Retry → terminal state, patch reverted and happy path re-verified. Empty-user SSR curl-verified (no img tag). Temp users/sessions/scripts cleaned.

## Process
DA APPROVE-WITH-FIXES: highlights-fetch gating (a second wasted computeWeeklyRecap per week nav — real find), 5-site failure-state reset, control-set ruling, copy split, helper placement. Dev self-corrected stale base. Model-set correction decided by orchestrator (technical, same deliverable shape).

## SPRINT 11 TALLY (Feature correctness) — 5/5 + 1 bonus
- #227 closed: premise disproven; invariant test + truthful microcopy shipped
- #228 closed: dead counters rendered, max-bound, sameDay nudge, scoped error recovery
- #229 closed (amended): classLabel/Builder, kind-titled score card, fitness-tile gating
- #230 closed: guided onboarding re-entry, calendar first-run card (gate corrected)
- #248 closed (bonus, bundled): React.cache goal-count dedupe
- #231 closed: this story
Audit pattern across the sprint: every story's premise needed correction (1 false, 2 weakened, 2 model/gate fixes) — the premise-check + Devil's-Advocate discipline caught all of them pre-code.

## Next options
Sprint 12 — Feature correctness→"High-risk structural" queue (#232/#233 layout-fetch deferral pair, #234/#235 day-override work) — or a /launch-gate checkpoint on the accumulated feature/phase1-auth branch first.
