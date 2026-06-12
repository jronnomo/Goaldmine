# Recommendation Ledger — Day-page editing forms (#65)

Stable IDs `UXR-65-NN`, assigned once and never renumbered. Status starts `proposed`.
**The implementing PR must tick each row to `shipped` / `reworked` / `dropped` with a SHA / `file:line` / short reason in the Evidence column.**
Every `⚠`-tagged row (`tuning⚠` / `decoration⚠`) is a thing to confirm on a real 390px device in **both** themes before shipping — see §9 of [`day-page-editing.md`](./day-page-editing.md).

Report: [`day-page-editing.md`](./day-page-editing.md) · Mockup: [`day-page-editing.html`](./day-page-editing.html)

| ID | Recommendation | Type | Status | Evidence |
|----|----------------|------|--------|----------|
| UXR-65-01 | Resting logging section = "three quiet doors" (Log workout accent CTA / Skip·mark-rest flat muted / +Log hike dashed), order workout→skip→hike, replaces the dead-end card; fallback = `··` disclosure (Direction A) if too tall/naggy | layout | shipped | f413680 (day-page) / f0e4c71 (editor) |
| UXR-65-02 | Expanded logger = per-exercise "confirmation table": label-once header row + label-less set rows in `grid-cols-[1.5rem_1fr_1fr_1fr_2.75rem]` (~88px/field) | layout | shipped | f413680 (day-page) / f0e4c71 (editor) |
| UXR-65-03 | Set inputs bump to ~44-48px tall (override the MacroInputs `py-1.5`≈38px precedent for this many-tap surface) | tuning⚠ | shipped* | f413680/f0e4c71 — device check at 390px both themes owed |
| UXR-65-04 | Conditional-SEC column — render SEC only when `durationSec` prescribed/added; else `grid-cols-[1.5rem_1fr_1fr_2.75rem]` | tuning⚠ | shipped* | f413680/f0e4c71 — device check at 390px both themes owed |
| UXR-65-05 | Placeholder-vs-value: fuzzy reps ("8-12"/"max") + `weightHint` render as muted-italic placeholders (`input::placeholder{color:var(--muted);font-style:italic}`), typed = solid foreground upright; placeholders never persist | layout | shipped | f413680 (day-page) / f0e4c71 (editor) |
| UXR-65-06 | weightHint free-form ("30-50 lb DBs") fallback — if in-field placeholder tests confusable, escalate to a tappable "plan: 30-50 lb" chip below the field | tuning⚠ | shipped* | f413680/f0e4c71 — device check at 390px both themes owed |
| UXR-65-07 | One helper line atop the exercise list: "Greyed numbers are the plan's suggestion — type what you actually did." | copy | shipped | f413680 (day-page) / f0e4c71 (editor) |
| UXR-65-08 | Remove control = trailing 44px ghost ✕ column, muted→danger on press; enforce min 1 set/exercise (set #1 renders no ✕) | a11y | shipped | f413680 (day-page) / f0e4c71 (editor) |
| UXR-65-09 | Dashed `+ Add set` / `+ Add exercise` rows (`border-dashed border-[var(--border)]`, min-h-44px, muted) at section bottom | layout | shipped | f413680 (day-page) / f0e4c71 (editor) |
| UXR-65-10 | ≤4-tap happy path — concrete numeric prescriptions seed real values → expand + save = 2 taps; deviation = +1 tap/field | copy | shipped | f413680 (day-page) / f0e4c71 (editor) |
| UXR-65-11 | CHALLENGE — optional "Did it as prescribed" batch-resolve (placeholders → visible editable values on consent); needs sign-off on what "8-12 as prescribed" resolves to | tuning⚠ | dropped | sign-off: batch-resolve invents values for fuzzy prescriptions; conflicts with placeholders-never-persist |
| UXR-65-12 | Skip = one tap, reason offered **after** (dashed optional box), never a pre-tap gate | layout | shipped | f413680 (day-page) / f0e4c71 (editor) |
| UXR-65-13 | Acknowledged-skip card = muted/calm, hollow Bullseye (size 16, `var(--muted)` stroke), NEVER danger-red; collapses to one muted line beside a completed workout | layout | shipped | f413680 (day-page) / f0e4c71 (editor) |
| UXR-65-14 | Skip copy (honest-not-guilt): "Marked as a rest — no training logged today." · "Rest is part of the plan · you can undo this anytime." · reason ph "What happened? (only you and Claude see this)"; ⚠ fallback "No session logged for this day." | copy | shipped | f413680 (day-page) / f0e4c71 (editor) |
| UXR-65-15 | Un-skip = ConfirmButton `variant="accent"` (recovery, not destruction), label "Undo skip" / confirm "Tap again to undo", 4s auto-disarm | a11y | shipped | f413680 (day-page) / f0e4c71 (editor) |
| UXR-65-16 | PR-celebration strip "New bests" (component `RecordStrip`) — `var(--target)`-bordered panel, `color-mix(var(--target) 12%, card)` wash, filled Bullseye per record, lines "New 1RM · 135 lb — was 125" (delta in muted quiet-subline) | component | shipped | f413680 (day-page) / f0e4c71 (editor) |
| UXR-65-17 | "New bests" heading ≥600 weight + ~18px (large-text AA) — `var(--target)`-on-card dark ≈3.6:1; record value stays `var(--foreground)` | decoration⚠ | shipped* | f413680/f0e4c71 — device check at 390px both themes owed |
| UXR-65-18 | Cap visible PR lines at 3 (+N more) to avoid a wall of barn-red | tuning⚠ | shipped* | f413680/f0e4c71 — device check at 390px both themes owed |
| UXR-65-19 | PR-strip pop reuses the existing `bullseye-pop` keyframe via imperative `classList.add` on mount; **add no new keyframe** | animation | shipped | f413680 (day-page) / f0e4c71 (editor) |
| UXR-65-20 | Pop stagger ~70ms/glyph (range 60-100); total ~460ms for 3 PRs | tuning⚠ | shipped* | f413680/f0e4c71 — device check at 390px both themes owed |
| UXR-65-21 | Gating — ephemeral mount only, NO localStorage; must NOT touch `goaldmine.celebrated.<dateKey>`; day-completion pop takes precedence so the two never co-fire on one viewport | animation | shipped | f413680 (day-page) / f0e4c71 (editor) |
| UXR-65-22 | Collapsed→expanded form + edit-mode toggle = pure conditional render, NO animation | animation | shipped | f413680 (day-page) / f0e4c71 (editor) |
| UXR-65-23 | WorkoutEditor = read-mode default + Edit toggle (same island); client diff vs initial snapshot → one `saveWorkoutEdits`; skipped = slim read-only variant; keep ShareWorkout | layout | shipped | f413680 (day-page) / f0e4c71 (editor) |
| UXR-65-24 | Editor delete = ConfirmButton `variant="danger"` two-tap → `/history`, placed in a footer separated from save | a11y | shipped | f413680 (day-page) / f0e4c71 (editor) |
| UXR-65-25 | Dynamic-array island — stable `_key` (uuid) not array index; autofocus new set's REPS via `pendingFocusKey`; store values as strings, coerce at submit | component | shipped | f413680 (day-page) / f0e4c71 (editor) |
| UXR-65-26 | Hike finalize variant — `accent-soft` header band "Finalize planned hike: {route}" + MarkerIcon (🏔️ Mt. Elbert) + prefilled muted-italic suggestions + `replacesPlannedHikeId`; fresh = plain accent CTA | layout | shipped | f413680 (day-page) / f0e4c71 (editor) |
| UXR-65-27 | Hike 6-field layout — 2-col grid for the 4 numerics with distance + elevation-gain primacy (Strava/AllTrails), full-width route + notes | layout | shipped | f413680 (day-page) / f0e4c71 (editor) |
| UXR-65-28 | Time field = `type="time"`; server computes `defaultTimeHHMM` (past=12:00 noon, today=now USER_TZ); compose `startedAt` via USER_TZ wall-clock (never `setHours`) | a11y | shipped | f413680 (day-page) / f0e4c71 (editor) |
| UXR-65-29 | CHALLENGE — export additive `dateAtUserTime(dateKey,"HH:MM")` + `hhmmNowInUserTz()` from `@/lib/calendar` (wraps unexported `userTzWallClockToUTC:1168`); land in REQ-65-4 calendar merge before REQ-65-2 | component | shipped | f413680 (day-page) / f0e4c71 (editor) |
| UXR-65-30 | CHALLENGE — logger rendered INLINE in the day-page card flow, NOT a BottomSheet (long dynamic form clips in a sheet); BottomSheet stays for global LogLauncher | layout | shipped | f413680 (day-page) / f0e4c71 (editor) |
| UXR-65-31 | Block labels render as section headers (`text-xs uppercase tracking-wide text-[var(--muted)]`) mirroring the planned-card `BlockView`, so the form reads as "confirm a known thing" | layout | shipped | f413680 (day-page) / f0e4c71 (editor) |
| UXR-65-32 | Past-empty invitation copy — drop "No workout logged"; CTA "Log workout" + optional non-guilt subline "Did something this day? You can still log it."; demote import/Claude to a tertiary escape hatch | copy | shipped | f413680 (day-page) / f0e4c71 (editor) |
| UXR-65-33 | No animation anywhere except the PR pop; `bullseye-pop` stays milestone-only | animation | shipped | f413680 (day-page) / f0e4c71 (editor) |
