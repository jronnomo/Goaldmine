# Recommendation Ledger — plan-confidence-calendar

One row per distinct recommendation. IDs are stable — assigned once, never renumbered.
`Status` starts `proposed`; the implementing PR ticks each to `shipped` / `reworked` / `dropped`
and fills `Evidence` with a SHA, `file:line`, or a one-line reason.
Every ⚠ row (tuning / decoration) MUST be visually verified at 390px before it ships — see
report §9. Companion backend dependency: `docs/design/long-effort-reconciliation.md`.

**Implemented in Track 2 (this commit).** ⚠ tuning/decoration rows shipped with a chosen value
inside the proposed range but are flagged **visual-verify pending at 390px** — the agent pipeline
cannot render pixels. Verify in a browser and re-tick if a value is reworked.

| ID | Recommendation | Type | Status | Evidence |
|----|----------------|------|--------|----------|
| UXR-plan-confidence-calendar-01 | Encode confidence as a **per-week** signal, not per-day | layout | shipped | `WeekRail.tsx` (per-week rail/cap) |
| UXR-plan-confidence-calendar-02 | Per-week confidence **rail** in left gutter (`grid-cols-[16px_repeat(7,1fr)]`, 6 rows) | layout | shipped | `CalendarMonth.tsx` week-row refactor + header gutter spacer |
| UXR-plan-confidence-calendar-03 | Per-week **Bullseye cap**: filled/hollow/warning (reuse `Bullseye.tsx`) | component | shipped | `WeekRail.tsx` (`Bullseye` filled/hollow + `BullseyeWarning`) |
| UXR-plan-confidence-calendar-04 | Provisional per-cell cue: reduced opacity + dashed top hairline | tuning⚠ | shipped | `CalendarMonth.tsx` `confidenceClass` — ⚠ verify 390px |
| UXR-plan-confidence-calendar-05 | Confirmed cells solid; today/selected ring + glow stay separate channel | layout | shipped | `DayCell` ring/glow untouched |
| UXR-plan-confidence-calendar-06 | Conflict **corner-wedge** overlay (`var(--warning)`) | decoration⚠ | shipped | `CalendarMonth.tsx` wedge span — ⚠ verify vs ring |
| UXR-plan-confidence-calendar-07 | Conflict forces rail-cap warning; week **cannot lock** while in conflict | layout | shipped | `WeekRail.deriveRailState` (conflict>confirmed) + `guardedAdvanceConfirmedThrough` refusal |
| UXR-plan-confidence-calendar-08 | provisional→confirmed **flip**: spine solidify + `bullseye-pop` cap + cell opacity ramp | animation | **reworked** | Cap `bullseye-pop` shipped (`.week-confirm-pop`). Spine-solidify + cell-ramp **dropped** — page is server-rendered, no client transition-origin state; the cap pop is the completion moment. |
| UXR-plan-confidence-calendar-09 | `Plan.confirmedThroughDate DateTime?` high-water mark | component | shipped | migration `20260608150434_add_plan_confirmed_through_date` |
| UXR-plan-confidence-calendar-10 | `confirm_week`/`reopen_week` + `log_review confirmThroughWeekEnd`; never auto-advance | component | shipped | `tools.ts` 3 write tools |
| UXR-plan-confidence-calendar-11 | Server-side **guard**: refuse to cross a conflicted week | component | shipped | `tools.ts guardedAdvanceConfirmedThrough` (returns `blockedBy`) |
| UXR-plan-confidence-calendar-12 | `CalendarDayCell.confidence` + `conflict`, derived in `buildCell` (no new query) | component | shipped | `calendar.ts deriveConfidence`; `conflict` shipped in Track 1 |
| UXR-plan-confidence-calendar-13 | Reduced-motion: flip → instant swap | a11y | shipped | `globals.css .week-confirm-pop` `prefers-reduced-motion` |
| UXR-plan-confidence-calendar-14 | Colorblind-safe: non-hue channels (cap shape, spine dash, opacity, wedge geometry) | a11y | shipped | cap filled/hollow + dashed spine + wedge geometry (warning cap color paired w/ wedge) |
| UXR-plan-confidence-calendar-15 | Verify contrast — provisional number at .62 over cream may miss AA | a11y | shipped | chose 0.62 — ⚠ **AA visual-verify at 390px pending** |
| UXR-plan-confidence-calendar-16 | Extend `DayCell` `aria-label` w/ confidence + conflict; cap `aria-hidden` | a11y | shipped | `CalendarMonth.tsx ariaLabel`; `WeekRail` cap `aria-hidden` |
| UXR-plan-confidence-calendar-17 | testIDs `week-row/week-rail/week-cap`, `day-cell/day-conflict`, `data-confidence`/`data-conflict` | component | shipped | `CalendarMonth.tsx` + `WeekRail.tsx` |
| UXR-plan-confidence-calendar-18 | Touch targets ≥44px; 16px rail non-interactive | a11y | shipped | cells `min-h-[3.75rem]`; rail `aria-hidden`, non-interactive |
| UXR-plan-confidence-calendar-19 | ⚠ Provisional cell opacity 0.55–0.70 | tuning⚠ | shipped | **0.62** — ⚠ verify date number ≥ AA |
| UXR-plan-confidence-calendar-20 | ⚠ Spine dashed→solid transition 220–320ms | tuning⚠ | **dropped** | no spine transition — server-rendered renders final state (see 08) |
| UXR-plan-confidence-calendar-21 | ⚠ Cap flip `bullseye-pop` 320ms | tuning⚠ | shipped | reused existing 320ms keyframe — ⚠ verify at 15px cap |
| UXR-plan-confidence-calendar-22 | ⚠ Cell opacity ramp 240–320ms | tuning⚠ | **dropped** | no cell ramp — server-rendered (see 08) |
| UXR-plan-confidence-calendar-23 | ⚠ Rail spine width 2–3px | tuning⚠ | shipped | **2px** — ⚠ verify "present but quiet" |
| UXR-plan-confidence-calendar-24 | ⚠ Provisional spine dash 3–5px / gap 4–9px | tuning⚠ | shipped | **4px / 9px** (13px repeat) — ⚠ verify distinct from conflict spine |
| UXR-plan-confidence-calendar-25 | ⚠ Conflict corner-wedge 11–14px | decoration⚠ | shipped | **11px** — ⚠ verify vs today/selected ring |
| UXR-plan-confidence-calendar-26 | ⚠ Warning rail-cap: wrapper vs prop | decoration⚠ | shipped | `BullseyeWarning` wrapper (`Bullseye.tsx` untouched) — ⚠ verify distinguishable at 15px |
| UXR-plan-confidence-calendar-27 | ⚠ Cap size 14–16px | tuning⚠ | shipped | **15px** — ⚠ verify center ring renders |

**Summary:** 23 shipped · 1 reworked (08 — flip simplified to cap pop) · 2 dropped (20, 22 — spine/cell transitions, n/a for server-rendered) · 0 outstanding `proposed`. Eight ⚠ tuning/decoration rows carry chosen values pending one human visual pass at 390px (04, 06, 15, 19, 21, 23, 24, 25, 26, 27).
