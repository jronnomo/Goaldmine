# Recommendation Ledger — plan-confidence-calendar

One row per distinct recommendation. IDs are stable — assigned once, never renumbered.
`Status` starts `proposed`; the implementing PR ticks each to `shipped` / `reworked` / `dropped`
and fills `Evidence` with a SHA, `file:line`, or a one-line reason.
Every ⚠ row (tuning / decoration) MUST be visually verified at 390px before it ships — see
report §9. Companion backend dependency: `docs/design/long-effort-reconciliation.md`.

| ID | Recommendation | Type | Status | Evidence |
|----|----------------|------|--------|----------|
| UXR-plan-confidence-calendar-01 | Encode confidence as a **per-week** signal, not per-day, to match the weekly review ritual | layout | proposed | |
| UXR-plan-confidence-calendar-02 | Per-week confidence **rail** in the left gutter (restructure flat `grid-cols-7` into 6 `WeekRow` of `grid-cols-[16px_repeat(7,1fr)]`) | layout | proposed | |
| UXR-plan-confidence-calendar-03 | Per-week **Bullseye cap**: filled=confirmed, hollow=provisional, warning-ring=conflict (reuse `Bullseye.tsx`) | component | proposed | |
| UXR-plan-confidence-calendar-04 | Provisional **per-cell** cue: reduced opacity + dashed top hairline (redundant non-color channel) | tuning⚠ | proposed | |
| UXR-plan-confidence-calendar-05 | Confirmed cells render solid/normal; existing today/selected ring + gold glow stay a separate channel | layout | proposed | |
| UXR-plan-confidence-calendar-06 | Conflict **corner-wedge** overlay (`var(--warning)`) on the colliding day cell — layers on provisional OR confirmed | decoration⚠ | proposed | |
| UXR-plan-confidence-calendar-07 | Conflict forces the week rail-cap into the warning state; a week **cannot lock** while a day is in conflict (forcing function) | layout | proposed | |
| UXR-plan-confidence-calendar-08 | provisional→confirmed **flip** animation: spine solidify + `bullseye-pop` cap + cell opacity ramp (CSS-only) | animation | proposed | |
| UXR-plan-confidence-calendar-09 | Data model: **`Plan.confirmedThroughDate DateTime?`** high-water mark (not per-day flags, not a join table) | component | proposed | |
| UXR-plan-confidence-calendar-10 | Set the mark conversationally: extend `log_review` (optional `confirmThroughWeekEnd`) + add `confirm_week`/`reopen_week` MCP actions; never auto-advance | component | proposed | |
| UXR-plan-confidence-calendar-11 | Server-side **guard**: `confirm_week`/review-advance refuses to cross a week with an unresolved conflict | component | proposed | |
| UXR-plan-confidence-calendar-12 | New `CalendarDayCell` fields: `confidence` ("past"/"confirmed"/"provisional"/null) + `conflict` ({kind,withDates}|null), derived in `buildCell` (no new query) | component | proposed | |
| UXR-plan-confidence-calendar-13 | Reduced-motion: flip degrades to instant state swap (reuse `globals.css:115` pattern) | a11y | proposed | |
| UXR-plan-confidence-calendar-14 | Colorblind-safe: every confidence distinction carries a non-hue channel (cap shape, spine dash-style, opacity, wedge geometry) | a11y | proposed | |
| UXR-plan-confidence-calendar-15 | Verify contrast both palettes — **risk:** provisional date number at .62 opacity over cream may miss AA | a11y | proposed | |
| UXR-plan-confidence-calendar-16 | Extend `DayCell` `aria-label` with confidence + conflict; rail cap stays `aria-hidden` (avoid double-announce) | a11y | proposed | |
| UXR-plan-confidence-calendar-17 | testIDs: `week-row/week-rail/week-cap-{weekIndex}`, `day-cell/day-conflict-{dateKey}`, state via `data-confidence`/`data-conflict` | component | proposed | |
| UXR-plan-confidence-calendar-18 | Touch targets ≥44px preserved (cells `min-h-[3.75rem]`); 16px rail non-interactive or routes to existing detail (no new modal) | a11y | proposed | |
| UXR-plan-confidence-calendar-19 | ⚠ Provisional cell opacity range **0.55–0.70** | tuning⚠ | proposed | |
| UXR-plan-confidence-calendar-20 | ⚠ Spine dashed→solid transition **220–320ms** ease | tuning⚠ | proposed | |
| UXR-plan-confidence-calendar-21 | ⚠ Cap flip reuses `bullseye-pop` **320ms** — confirm reads at 16px | tuning⚠ | proposed | |
| UXR-plan-confidence-calendar-22 | ⚠ Cell opacity ramp **240–320ms**, ~60ms offset | tuning⚠ | proposed | |
| UXR-plan-confidence-calendar-23 | ⚠ Rail spine width **2–3px** | tuning⚠ | proposed | |
| UXR-plan-confidence-calendar-24 | ⚠ Provisional spine dash **3–5px** / gap **4–9px** | tuning⚠ | proposed | |
| UXR-plan-confidence-calendar-25 | ⚠ Conflict corner-wedge **11–14px**; verify vs today/selected ring | decoration⚠ | proposed | |
| UXR-plan-confidence-calendar-26 | ⚠ Warning rail-cap variant: Bullseye wrapper vs new prop — verify distinguishable at 16px, doesn't muddy canonical component | decoration⚠ | proposed | |
| UXR-plan-confidence-calendar-27 | ⚠ Cap size in gutter **14–16px** (Bullseye needs ≥14px for its red center ring, `MarkerIcon.tsx:20`) | tuning⚠ | proposed | |
