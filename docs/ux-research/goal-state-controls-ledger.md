# Recommendation Ledger — Goal-State Controls & Explanations

Continues the **UXR-62** series (IDs `UXR-62B-NN`, stable, never renumbered). Companion to [`goal-state-controls.md`](./goal-state-controls.md).

> Ticked 2026-06-10 by the implementing run (commit 5a6b710). `shipped*` = code-reviewed + SSR-smoke-verified, device visual check at 390px/both themes still owed.

**How to use:** when the implementing PR lands, tick each row's `Status` to `shipped` / `reworked` / `dropped` and fill `Evidence` with a commit SHA, `file:line`, or a one-line reason. Every `tuning⚠` row must be visually verified on a real 390px device in **both** themes before it can be marked `shipped`.

| ID | Recommendation | Type | Status | Evidence |
|----|----------------|------|--------|----------|
| UXR-62B-01 | List-row "Plan paused" = plain `var(--muted)` text in the existing subline (Direction A); no rail chip. Fallback = Someday-recipe neutral chip if skimmability fails on device | tuning⚠ | proposed | |
| UXR-62B-02 | New `Plan.paused Boolean @default(false)`; filter `paused:false` at `program.ts:30` + `goal-focus.ts:73`; skip baseline generation at `goal-events.ts:136-157` (the marker-spray fix) | component | proposed | |
| UXR-62B-03 | `setPlanPaused(planId, paused)` server action with focus-goal guard (throws if `paused && goal.isFocus`); mirrors untrack guard `goal-actions.ts:180-184`; revalidates `["/","/calendar","/goals",/goals/${goalId},"/stats"]` | component | proposed | |
| UXR-62B-04 | Detail Plan-card Pause/Resume toggle — server-action `<form>` button, `min-h-[44px]` (range 44-48px); Pause = muted text (calm), Resume = `accent-soft` CTA | a11y | proposed | |
| UXR-62B-05 | Resume CTA `var(--accent)` text on `accent-soft` wash — verify AA ≥4.5:1 in both themes (dark gold is the tighter case); bump `font-medium` or render on `--card` if borderline | tuning⚠ | proposed | |
| UXR-62B-06 | Always-on consequence line under the detail toggle (swaps active/paused copy); NO blocking confirm modal for Pause or Untrack (reversible one-tap) | copy | proposed | |
| UXR-62B-07 | Native `<details>` "What do these states mean?" glossary (6 states) at top of Goals card; reuse the shipped `<details>` pattern (`DayOverrideForm.tsx:33`, `SnapshotView.tsx:26`) + real `Bullseye`/chip samples (not bespoke SVG); zero `"use client"` | layout | proposed | |
| UXR-62B-08 | Final consequence strings for all 6 states + Pause/Untrack copy (see report §11 table) | copy | proposed | |
| UXR-62B-09 | No animation anywhere; `bullseye-pop` stays reserved for the once-per-day completion moment | animation | proposed | |
| UXR-62B-10 | Desktop-only `title=` hover hints on glyphs/chips — free progressive enhancement, touch remains primary | copy | proposed | |
