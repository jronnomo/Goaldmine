# Recommendation Ledger — Multi-goal Phase 1: Cross-goal Awareness

**Report:** [`multigoal-phase1-awareness.md`](./multigoal-phase1-awareness.md) · **Mockup:** [`multigoal-phase1-awareness.html`](./multigoal-phase1-awareness.html)
**Issue:** jronnomo/workout-planner #62 · **Scope:** REQ-106

IDs are stable (`UXR-62-NN`) and never renumbered across later edits/appends. Status starts `proposed`. **The implementing PR must tick each row to `shipped` / `reworked` / `dropped`** with a SHA, `file:line`, or short reason in Evidence. Rows tagged `tuning⚠` / `decoration⚠` are the ones future visual audits care about most — none should ship unverified at 390px in both themes.

> Ticked 2026-06-10 by the implementing feature-dev run (commits 44631e5..b40adc7). Rows marked `shipped*` passed code review + SSR-HTML smoke but still carry the report's **verify-visually obligation** — eyeball at 390px in both themes on a real device before considering tuning final.

| ID | Recommendation | Type | Status | Evidence |
|----|----------------|------|--------|----------|
| UXR-62-01 | Foreign marker = claim-ring (`outline ~1px var(--muted)` + radius); fallback = tag-dot | tuning⚠ | shipped* | a460495 `src/components/MarkerIcon.tsx` ForeignGoalMarker (outline 1px, offset 1px, radius 9999px) |
| UXR-62-02 | Foreign marker redundant `opacity ~0.55–0.70` channel | tuning⚠ | shipped* | a460495 `opacity-[0.65]` on all foreign markers |
| UXR-62-03 | Marker overflow: focus-first order, cap 2–3, then `+N` chip | layout | shipped | a460495 `CalendarMonth.tsx` MARKER_CAP=3, focus-first |
| UXR-62-04 | `+N` chip recipe (`9–10px var(--muted)` on `accent-soft`) | tuning⚠ | shipped* | a460495 `text-[9px] text-[var(--muted)] bg-[var(--accent-soft)]` |
| UXR-62-05 | OtherGoalsStrip placement between CharacterHeader & hero (PRD-fixed; sign-off if revisited) | layout | shipped | a460495 `src/app/page.tsx` (PRD placement honored) |
| UXR-62-06 | Today strip loud state: `accent-soft` bg + `2px var(--target)` rail | tuning⚠ | shipped* | a460495 `OtherGoalsStrip.tsx` loud variant; smoke: race week renders `other-goals-strip-loud` |
| UXR-62-07 | Strip race-window `≤7d` / lookahead horizon `7–14d` | tuning⚠ | shipped* | a460495 RACE_WINDOW_DAYS=7, lookahead 7d (low end of range); b40adc7 DST rounding fix |
| UXR-62-08 | Day race-day banner: target-tinted border + low-alpha wash, body in `--foreground` | tuning⚠ | shipped* | a460495 `days/[dateKey]/page.tsx` color-mix 12% wash; smoke on /days/2026-06-15 |
| UXR-62-09 | Day cross-goal conflict banner: `3px var(--warning)` rail + ◣ glyph + coach CTA, no resolve/dismiss | decoration⚠ | shipped* | a460495 warning 8% wash, ◣ glyph, "Ask your coach to sort the week →", no resolve affordance |
| UXR-62-10 | Filled `var(--target)` race banner variant (louder than PRD baseline) | tuning⚠ | dropped | kept PRD §5.1 tinted-border baseline; revisit only if the race banner proves too quiet in real use |
| UXR-62-11 | Goals "Focus" badge = filled Bullseye `size=14` + label (replaces "Active") | component | shipped | 9475024 `src/app/goals/page.tsx` Bullseye size=14 progress=1 |
| UXR-62-12 | Goals Track/Untrack pill (`min-h-44px`, server action); untracked dim-by-recolor | a11y | shipped | 9475024 pill min-h-[44px] + setGoalTracked; dim via glyph opacity + text recolor, never row opacity |
| UXR-62-13 | No animation anywhere; `bullseye-pop` stays completion-only | animation | shipped | a460495 — nothing animates in new components |
| UXR-62-14 | Legend "Other goals" section (divider + header + claim-ringed foreign rows) | layout | shipped | a460495 `src/app/calendar/page.tsx`; smoke: section renders with 5k tracked |
| UXR-62-15 | "Someday" chip for date-less goals (neutral `--border`/`--muted`, replaces days-pill) | component | shipped | 9475024 goals list + detail header chips |
| UXR-62-16 | Muted inline secondary-event header lines on day page (match `🏔️ Goal target` idiom) | copy | shipped | a460495 `days/[dateKey]/page.tsx` secondaryEvents header spans |
