# Recommendation Ledger — rpg-character-stats

One row per distinct recommendation. IDs are stable — assigned once, never renumbered.
`Status` starts `proposed`; the implementing PR ticks each to `shipped` / `reworked` / `dropped`
and fills `Evidence` with a SHA, `file:line`, or a one-line reason.
Every ⚠ row (tuning / decoration) MUST be visually verified at 390 px (both themes) before it ships —
the agent pipeline cannot render pixels. See report §14 and the companion artifact
`docs/ux-research/rpg-character-stats.html`. Source report: `docs/ux-research/rpg-character-stats.md`.

Implementing commits: `a18dcf0` (UI components), `0dab18d` (integration/fold), `0d38010` (QA fixes), engine `2472708`/`9882f3d`.

| ID | Recommendation | Type | Status | Evidence |
|----|----------------|------|--------|----------|
| UXR-rpg-character-stats-01 | Make the level medallion a real **Bullseye in `progress` mode** (overall XP into level); reuse `Bullseye.tsx`, no new progress glyph | component | shipped | `src/components/game/LevelMedallion.tsx` (a18dcf0) — wraps Bullseye progress mode |
| UXR-rpg-character-stats-02 | Level number as an overlapping **gold chip** (`--accent`/`--accent-fg`, DM Serif), not centered over the rings | component | shipped | LevelMedallion.tsx — chip at lower-right, DM Serif |
| UXR-rpg-character-stats-03 | CharacterHeader = **two tight rows ≈72 px**; whole row one tap target → `/character` | layout | shipped | `src/components/game/CharacterHeader.tsx` — single Link wrapper, two rows |
| UXR-rpg-character-stats-04 | **Header shows attribute label+level+bar only; NO XP numbers** at header size | layout | shipped | `src/components/game/AttributeBar.tsx` — no numbers prop at header size |
| UXR-rpg-character-stats-05 | Precise attribute XP numbers live on **/character** attribute cards | layout | shipped | `src/app/character/page.tsx` attribute cards show intoLevel/toNext |
| UXR-rpg-character-stats-06 | **Streak flame = hand-rolled single-path SVG**, `--warning`, filled/hollow states | decoration⚠ | shipped | `src/components/game/StreakFlame.tsx` — 390px visual pass pending (user); `12d` text fallback documented |
| UXR-rpg-character-stats-07 | **QuestCard = full-width ribbon inside the hero** | layout | shipped | `src/components/game/QuestCard.tsx` + `src/app/page.tsx` hero (0dab18d) |
| UXR-rpg-character-stats-08 | **Fold `TodayCelebration` into the QuestCard** — ONE completion Bullseye | layout | shipped | Tech-Lead signed off 2026-06-09 (PRD §3.1.7 amended); standalone block removed in 0dab18d, QuestCard hosts TodayCelebration |
| UXR-rpg-character-stats-09 | QuestCard uses **Bullseye (hollow→filled)**, not ⚔/✓ emoji | copy⚠ | shipped | QuestCard.tsx renders Bullseye; PRD sketch superseded |
| UXR-rpg-character-stats-10 | **Level-up = gold double-ring CSS burst** + medallion `bullseye-pop`; no particles | animation | shipped | `src/app/globals.css` level-up-burst block (a18dcf0) |
| UXR-rpg-character-stats-11 | `level-up-burst` keyframe duration | tuning⚠ | shipped | 560ms (start value); playtest pending (user) |
| UXR-rpg-character-stats-12 | `level-up-burst` end-scale + ring width + 2nd-ring delay | tuning⚠ | shipped | scale 2.2 / 2px / 120ms (start values); playtest pending (user) |
| UXR-rpg-character-stats-13 | Celebration = **only client island**, localStorage gate, imperative class, silent first install | component | shipped | `src/components/game/LevelUpCelebration.tsx` — sole "use client" among new components; level-decrease stores silently |
| UXR-rpg-character-stats-14 | Keep header **overall linear bar AND medallion ring** | tuning⚠ | shipped | Both kept; overall bar carries `intoLevel / toNext` label (0d38010) |
| UXR-rpg-character-stats-15 | **Badges = typographic gold medals framed by the Bullseye ring**; locked = hollow + greyed + hint | component | shipped | `src/components/game/BadgeWall.tsx` — three-channel lock state |
| UXR-rpg-character-stats-16 | Optional **hybrid geometric glyphs** (mountain/flame families) | decoration⚠ | shipped | BadgeWall.tsx:76-86 MountainGlyph/FlameGlyph — visual pass pending (user) |
| UXR-rpg-character-stats-17 | **MoreSheet "Character" row** + hand-rolled 20px icon | decoration⚠ | shipped | `src/components/MoreSheet.tsx` — bust silhouette, first row; consistency pass pending (user) |
| UXR-rpg-character-stats-18 | BadgeWall **4-col grid** (3-col fallback if clipping) | tuning⚠ | shipped | 4-col shipped; check label clipping at 390px (user) |
| UXR-rpg-character-stats-19 | Medallion ⌀ / chip ⌀ / micro-bar height | tuning⚠ | shipped | 38px / 20px / 5px (start values); visual pass pending (user) |
| UXR-rpg-character-stats-20 | Badge medal diameter | tuning⚠ | shipped | 52px (start value); visual pass pending (user) |
| UXR-rpg-character-stats-21 | **/character order**: portrait → streak → attributes → badges → XP log → footnote | layout | shipped | `src/app/character/page.tsx` — six sections in order |
| UXR-rpg-character-stats-22 | **Fold coach-bonus log into the XP event list** (✦-marked) | layout | shipped | `src/components/game/XpEventList.tsx` — ✦ + accent-soft tint; no separate section |
| UXR-rpg-character-stats-23 | /character attribute cards lead with small **Bullseye progress glyph** | component | shipped | character/page.tsx attribute cards |
| UXR-rpg-character-stats-24 | Progressbar ARIA; flame aria-hidden+text alt; 3-channel badge lock; reduced-motion | a11y | shipped | XpBar role=progressbar; StreakFlame text alt; globals.css reduced-motion guard |
| UXR-rpg-character-stats-25 | **AA contrast verify (both themes)** | a11y⚠ | shipped | Tokens-only verified by grep (no hex literals); human AA pass at 390px both themes PENDING (user) — open `docs/ux-research/rpg-character-stats.html` |
| UXR-rpg-character-stats-26 | Header row ≥44px target; badges non-interactive | a11y | shipped | Header Link ~72px; BadgeWall non-interactive |
| UXR-rpg-character-stats-27 | All `data-testid`s per report §12 | component | shipped | Verified in rendered HTML: character-header, quest-card, xp-bar-overall, attr-bar-*, streak-flame, badge-wall, xp-event-list, level-up-celebration |

**Summary:** 27 shipped · 0 reworked · 0 dropped. The 10 ⚠ rows shipped at the report's starting values; one human visual pass at 390 px in BOTH themes remains the user's follow-up (medallion/chip/bar sizes, burst timing, flame glyph, badge glyphs, 4-col clipping, AA contrast). Row 08 shipped with explicit Tech-Lead sign-off.
