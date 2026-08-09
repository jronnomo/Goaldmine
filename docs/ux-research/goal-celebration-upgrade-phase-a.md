# Phase-A Divergent Options — Goal-Completion Ceremony

**Companion to** [`goal-celebration-upgrade.md`](./goal-celebration-upgrade.md) · **Mockup:** [`goal-celebration-upgrade.html`](./goal-celebration-upgrade.html)

These are the three *competing* directions drawn at 390px in both palettes, produced to be compared and narrowed to one. **Direction 2 ("The Assay") was chosen**, with the ring-break from D1 and the whole cheap spine from D3 grafted in. They are preserved here because the rejected options carry the reasoning for the choice — and because D3 remains the correct fallback if the effort is ever judged not worth it.

Every numeric value below is provisional (⚠) and superseded by the main report where the two disagree.

---

I read the actual implementation before drawing, so the mockups are anchored to real code. Key confirmations:

- `/Users/ggronnii/Development/goaldmine/src/app/globals.css:173-194` — `.goal-completed-ring` literally sets `animation: level-up-burst 640ms …` — the *same keyframe name* as the level-up, +1 ring, +80ms. Under reduced motion it's `display: none`. The diagnosis in the brief is textually correct in the source.
- `/Users/ggronnii/Development/goaldmine/src/app/goals/[id]/page.tsx:346-351` — `<GoalCompletedCelebration>` is the last child of the Completed card, after the `Completion card →` link, inside a `flex justify-center mt-3`.
- Same file `:284` — a *second* 🏆 at `text-3xl` already sits in the card header, so the celebration's 32px 🏆 is a duplicate glyph.
- Same file `:342` — `Completion card →` is a bare `text-sm` link (~20px tall, sub-44px).
- Same file `:365` — the `Reopen` card renders *immediately after* Completed, above Changelog/Story/Reflection.
- `/Users/ggronnii/Development/goaldmine/src/components/Bullseye.tsx:90-95` — at `size ≥ 20` the canonical stack is exactly r15 rust / r11 cream / r7 rust / r3 cream, all `<circle fill>`, painter's order. It is genuinely scale-pure; a 224px instance is a one-prop change.
- `/Users/ggronnii/Development/goaldmine/src/components/BottomSheet.tsx:112-131` — portaled `<dialog>` + `.bottom-sheet-panel` (`background: var(--card)`, `max-height: 85dvh`, `border-radius 1rem`). A full-bleed variant is a sibling class, not a new component.
- `/Users/ggronnii/Development/goaldmine/src/lib/completion-card.tsx:99-147,185-188` — the Satori target row already exists: met-first sort, `✓`/`·`, label, `start → final units`, `MAX_TARGET_ROWS` cap + `+N more`. Direction 2 ports proven logic, not new logic.

---

# Shared conventions for every frame below

```
ASCII scale:  1 char ≈ 6px horizontal · 1 row ≈ 12px vertical  (2:1 cell)
Frame width:  65 chars = 390px viewport      Content: 60 chars = 358px (p-4)
Glyph key:    █ = var(--target) rust disc    ░ = var(--target-fg) cream disc
              ▓ = var(--accent) gold fill    ▒ = var(--accent-soft) wash
              · = var(--muted)               ─ = var(--border) hairline
⚠ = provisional tuning value, not a system constant
```

**The Bullseye cross-section is always 7 bands** — rust │ cream │ rust │ cream │ rust │ cream │ rust. Every glyph below is drawn from the real r15/r11/r7/r3 geometry at the stated pixel size, so the ASCII proportions are the component's actual proportions.

**Universal adjacency rule applied in all three directions:** rust and gold never share an edge. Minimum clear band of plain `--background`/`--card` between any rust element and any gold element is **16px ⚠** (brief says 10–18px; I picked the middle and used it consistently so it's one number to tune). **Extended rule I'm adding:** `--warning` (the Epic/Legendary ReachMeter fill) is `#E0915C` dark / `#A8511A` light — that is a *rust neighbour*, not just a gold neighbour. It needs the same 16px ⚠ clear band from the Bullseye. This is not in the brief and is worth confirming against the same measurement method.

---

# DIRECTION 1 — "THE SUMMIT SHEET"

Portaled full-bleed `<dialog>`, top layer, opens on first view of an unburned token.

## 1a · Elbert / Summit tier — TERMINAL FRAME (all beats landed)

```
┌───────────────────────────────────────────────────────────────┐ ← dialog, top layer
│                                                     ┌───────┐ │   panel bg: var(--background)
│                                                     │ Skip  │ │   NOT var(--card) — the eyebrow
│                                                     └───────┘ │   must sit on plain bg (AA)
│                                                               │
│                          GOAL ACHIEVED                        │ B4
│                                                               │
│                     ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐                    │
│                          ██████████                           │
│                       ███████░░███████                        │
│                      ████░░░░░░░░░░████                       │
│                     ███░░░░██████░░░░███                      │ B2
│                    ███░░░████░░████░░░███                     │  133px filled Bullseye
│                    ███░░░███░░░░███░░░███                     │  aria-hidden, decorative
│                    ███░░░████░░████░░░███                     │
│                     ███░░░░██████░░░░███                      │
│                      ████░░░░░░░░░░████                       │
│                       ███████░░███████                        │
│                          ██████████                           │
│                     └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘                    │
│                                                               │   ← 16px⚠ clear band, all sides
│              Summit Mt. Elbert                                │ B4  DM Serif 400 · 34px⚠
│              via the Northeast Ridge                          │     leading 1.06⚠
│                                                               │
│              SEP 12, 2025                                     │     mono 12px tracking .06⚠
│                                                               │
│  ───────────────────────────────────────────────────────────  │     1px var(--border)
│                                                               │
│   98                        7 of 9                            │ B5  DM Serif 400 · 40px⚠
│   DAYS ELAPSED              TARGETS MET                       │     label: 11px bold .09em
│                                                               │
│   +700                      8 → 89                            │
│   XP AWARDED                WEIGHTED PROGRESS                 │     ← honest-copy label,
│                             ACROSS YOUR TARGETS               │       NOT "readiness %"
│                                                               │
│  ───────────────────────────────────────────────────────────  │
│                                                               │
│   REACH   ▌▌▌▌▌  Legendary                                    │ B6  ReachMeter md, NEVER animates
│                                                               │     ← 12px⚠ gap (warning↔gold)
│   ┌─────────┐   ┌─────────┐                                   │
│   │  ▓▓▓▓▓  │   │  ▓▓▓▓▓  │   First Summit                    │ B6  BadgeMedal 76px, --accent
│   │ ▓▓ M ▓▓ │   │ ▓▓ BP▓▓ │   Body of Proof                   │     monogram --accent-fg
│   │  ▓▓▓▓▓  │   │  ▓▓▓▓▓  │                                   │
│   └─────────┘   └─────────┘                                   │
│                                                               │
│   LEVEL 11 → 14                                               │ B6  mono 13px, --foreground
│                                                               │
├───────────────────────────────────────────────────────────────┤ ← sticky footer, border-top
│  ┌───────────────────────┐  ┌───────────────────────┐         │
│  │    Get the card       │  │      Continue         │         │ B7  two PEER controls
│  └───────────────────────┘  └───────────────────────┘         │     48px⚠ tall each
└───────────────────────────────────────────────────────────────┘
                                                          ↑ safe-area-inset-bottom
```

### Geometry & spacing (1a)

| element | value | note |
|---|---|---|
| panel | `inset:0; border-radius:0; background:var(--background); max-height:100dvh` | new `.summit-sheet-panel` sibling of `.bottom-sheet-panel` |
| panel padding | `20px` ⚠ horizontal, `env(safe-area-inset-top)+12px` top | wider than page `p-4` so the hero breathes |
| Skip button | **44×44px**, top-right, `12px` ⚠ inset | `opacity:1` at frame 0, focusable at frame 0 |
| eyebrow → Bullseye | `20px` ⚠ | eyebrow is `--accent` on `--background` — legal |
| Bullseye | **133px** ⚠, `margin:0 auto` | `<Bullseye size={133} filled aria-hidden />` |
| Bullseye clear band | **16px ⚠ on all four sides** | nothing gold, nothing `--warning` inside it |
| Bullseye → objective | `24px` ⚠ |  |
| objective | DM Serif 400 · **34px** ⚠ · leading `1.06` ⚠ · `--foreground` | **exceeds the app's current `text-4xl` ceiling — needs a new display step token, flag for approval** |
| objective → date | `8px` |  |
| stat grid | 2 cols, `row-gap 20px` ⚠, `col-gap 16px` |  |
| stat numeral | DM Serif 400 · **40px** ⚠ | numerals + short award nouns are licensed display use |
| stat label | 11px bold `tracking-[0.09em]` uppercase · `--muted` | ≥11px to survive coal |
| ReachMeter → badge row | **12px ⚠** | `--warning` ↔ `--accent` separation |
| BadgeMedal | 76px (detail size) | gold disc; ≥16px ⚠ from anything rust |
| footer buttons | **48px ⚠ tall**, 50/50 split, `gap 12px` | both ≥44px; sticky so they survive scroll |

### Palette table (1a) — every element, both palettes

| element | light (cream) | dark (coal) | contrast note |
|---|---|---|---|
| `::backdrop` scrim | `rgba(0,0,0,0.45)` | `rgba(0,0,0,0.45)` | reuse existing `.bottom-sheet::backdrop` value verbatim |
| panel surface | `--background #FAF3E3` | `--background #0F0B07` | **not `--card`** |
| eyebrow "GOAL ACHIEVED" | `--accent #8A6212` on `#FAF3E3` | `--accent #D4A437` on `#0F0B07` | on plain bg only — on `--accent-soft` it is 4.14:1 = FAIL |
| Bullseye outer/mid discs | `--target #9A480F` | `--target #D97A3D` | graphic, `aria-hidden` |
| Bullseye cream discs | `--target-fg #FFFBF0` | `--target-fg #FFFFFF` | **3.09:1 in coal — graphic only. No numeral, no label, nothing typographic ever inside the discs.** |
| objective | `--foreground #1F1408` | `--foreground #F4E9D4` | AA large by a wide margin |
| date / mono line | `--muted #7A5E3A` | `--muted #9C8866` | 12px is the floor for `--muted` in coal |
| hairlines | `--border #D9C8A2` | `--border #3A2E1F` | |
| stat numerals | `--foreground` | `--foreground` | |
| `+700` XP numeral | `--accent` on `--background` | `--accent` on `--background` | 40px = large text, safe |
| stat labels | `--muted` | `--muted` | 11px bold |
| ReachMeter Legendary | `--warning #A8511A` | `--warning #E0915C` | tier word ≥12px per ReachMeter's own AA note |
| BadgeMedal fill / monogram | `--accent` / `--accent-fg #FFFBF0` | `--accent` / `--accent-fg #0F0B07` | |
| "Get the card" | fill `--accent`, text `--accent-fg` | same tokens | |
| "Continue" | `1px --border`, text `--foreground`, bg transparent | same | peer weight, not subordinate |
| Skip | text `--muted`, `1px --border`, bg `--card` | same | opaque so it never "appears late" |

### Visible cream↔coal differences (side-by-side hero strip)

```
     LIGHT / cream                      DARK / coal
┌─────────────────────────┐   ┌─────────────────────────┐
│  GOAL ACHIEVED  (#8A6212│   │  GOAL ACHIEVED  (#D4A437│
│                on FAF3E3│   │                on 0F0B07│
│      ███░░░███░░░███    │   │      ███░░░███░░░███    │
│   rust #9A480F on cream │   │   rust #D97A3D on coal  │
│   ↑ rust reads DARKER   │   │   ↑ rust reads LIGHTER  │
│     than the field      │   │     than the field      │
│                         │   │                         │
│  Summit Mt. Elbert      │   │  Summit Mt. Elbert      │
│  #1F1408                │   │  #F4E9D4                │
│  ────── #D9C8A2 ─────   │   │  ────── #3A2E1F ─────   │
│  hairline is VISIBLE    │   │  hairline is NEARLY     │
│  against FFFBF0/FAF3E3  │   │  INVISIBLE on 0F0B07 →  │
│                         │   │  use 20px⚠ space as the │
│                         │   │  divider in coal, not   │
│                         │   │  the rule               │
└─────────────────────────┘   └─────────────────────────┘
```
**Polarity flip is the real design consequence:** in cream the Bullseye is a *dark* mass on a light field; in coal it is a *warm glowing* mass on near-black. The composition must not depend on the rule lines, because `--border #3A2E1F` on `--background #0F0B07` is a whisper. Rules carry structure in cream; whitespace carries it in coal. Budget the same 20px ⚠ gap either way so only the rule's presence changes.

## 1b · MARKER floor case — 2-week, zero-target goal, TERMINAL FRAME

The discipline that makes this direction defensible: **the Bullseye is still 133px. The rings still break. The type is still 34px.** Nothing is scaled down. What changes is *how many rows exist* — and there are fewer, because there is less that is true.

```
┌───────────────────────────────────────────────────────────────┐
│                                                     ┌───────┐ │
│                                                     │ Skip  │ │  44×44
│                                                     └───────┘ │
│                                                               │
│                          GOAL ACHIEVED                        │ B4
│                                                               │
│                          ██████████                           │
│                       ███████░░███████                        │
│                      ████░░░░░░░░░░████                       │
│                     ███░░░░██████░░░░███                      │ B2
│                    ███░░░████░░████░░░███                     │  IDENTICAL 133px⚠
│                    ███░░░███░░░░███░░░███                     │  IDENTICAL beat timing
│                    ███░░░████░░████░░░███                     │
│                     ███░░░░██████░░░░███                      │
│                      ████░░░░░░░░░░████                       │
│                       ███████░░███████                        │
│                          ██████████                           │
│                                                               │  16px⚠ clear band
│              Rebuild the morning routine                      │ B4  DM Serif 34px⚠
│                                                               │
│              MAR 03, 2026                                     │     mono 12px --muted
│                                                               │
│  ───────────────────────────────────────────────────────────  │
│                                                               │
│   14                        +150                              │ B5  only TWO cells exist
│   DAYS ELAPSED              XP AWARDED                        │     no targets cell
│                                                               │     no progress cell
│                                                               │
│   No targets were set on this goal.                           │     13px --muted, one line.
│                                                               │     Replaces nothing invented.
│  ───────────────────────────────────────────────────────────  │
│                                                               │
│   ┌─────────┐                                                 │
│   │  ▓▓▓▓▓  │   First Summit                                  │ B6  the ONE real award
│   │ ▓▓ M ▓▓ │                                                 │
│   │  ▓▓▓▓▓  │                                                 │
│   └─────────┘                                                 │
│                                                               │
│   LEVEL 6 → 7                                                 │ B6
│                                                               │
│                     (no Reach row — tier is null/unrated;     │
│                      an empty 5-segment meter would be a      │
│                      visible zero. Omit, don't render empty.) │
│                                                               │
├───────────────────────────────────────────────────────────────┤
│  ┌───────────────────────┐  ┌───────────────────────┐         │
│  │    Get the card       │  │      Continue         │         │ B7  48px⚠
│  └───────────────────────┘  └───────────────────────┘         │
└───────────────────────────────────────────────────────────────┘
```

**Floor-case decisions worth arguing about:**
1. **Vertical centering.** Marker's content is ~420px in an 844px panel. Do not top-align and leave 400px of void — center the block between the Skip row and the footer. The emptiness then reads as *composure*, not *missing data*.
2. **Ceremony duration drops from ~1440ms to ~1180ms ⚠** purely because B5 has 2 cells instead of 4 and B6 has one badge. No beat gets quieter; there are fewer beats. This is the whole thesis, made mechanical.
3. **Open question ⚠:** does a 2-week goal deserve a full-screen takeover at all? Alternative: Marker uses the *existing* `.bottom-sheet-panel` (85dvh, rounded top, `--card`) and only Ascent/Summit get full-bleed. That buys floor-case proportionality at the cost of two forms instead of one. I lean toward one form — but flag it as the single biggest open call in this direction.

## 1c · The permanent trophy card underneath (after dismissal)

This is what the ceremony *reveals*, and it is also what non-JS / burned-token / returning users see. It must already be proud on its own.

```
   AppHeader ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ sticky 48px
┌───────────────────────────────────────────────────────────────┐
│ ┌───────────────────────────────────────────────────────────┐ │
│ │  ┌─────────────────────────────────────────────────────┐  │ │ Card: rounded-2xl
│ │  │                                                     │  │ │ border --border
│ │  │      █████                                          │  │ │ bg --card · p-4
│ │  │    █░░███░░█    GOAL ACHIEVED                       │  │ │ shadow-sm
│ │  │    ██░█░█░██    Summit Mt. Elbert                   │  │ │
│ │  │    █░░███░░█    Sep 12, 2025                        │  │ │ 56px Bullseye
│ │  │      █████                                          │  │ │ ← 16px⚠ from any gold
│ │  │                                                     │  │ │
│ │  │  ─────────────────────────────────────────────────  │  │ │
│ │  │                                                     │  │ │
│ │  │   98            7 of 9        +700         8 → 89   │  │ │ 4-up, 24px⚠ numerals
│ │  │   DAYS          TARGETS       XP           PROGRESS │  │ │ DM Serif
│ │  │                                                     │  │ │
│ │  │   REACH  ▌▌▌▌▌ Legendary                            │  │ │
│ │  │                                                     │  │ │ 12px⚠ gap
│ │  │   ⬤ First Summit    ⬤ Body of Proof                 │  │ │ 52px grid BadgeMedals
│ │  │                                                     │  │ │
│ │  │  ┌───────────────────────────────────────────────┐  │  │ │
│ │  │  │           Get the completion card             │  │  │ │ 44px BUTTON
│ │  │  └───────────────────────────────────────────────┘  │  │ │ (was a 14px link at
│ │  │                                                     │  │ │  page.tsx:342)
│ │  └─────────────────────────────────────────────────────┘  │ │
│ └───────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌─── Story ─────────────────────────────────────────────┐    │ ← unchanged
│  ┌─── Changelog ─────────────────────────────────────────┐    │
│  ┌─── Reflection ────────────────────────────────────────┐    │
│  ┌─── Reopen ────────────────────────────────────────────┐    │ ← DEMOTED below Story
│                                                               │
   BottomNav ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁ fixed
└───────────────────────────────────────────────────────────────┘
```
**Both 🏆 emoji are deleted** — the one at `page.tsx:284` and the one inside `GoalCompletedCelebration`. The Bullseye replaces both. There is now exactly one glyph on this surface.

## Beat map — Direction 1

```
  0ms   200    400    600    800   1000   1200   1400
  ├──────┼──────┼──────┼──────┼──────┼──────┼──────┤
B1 ███                                                 backdrop scrim opacity 0→1, 160ms
   ▐                                                   ease-out  (opacity-only)
B1 █                                                   Skip button: opacity 1 at t=0.
                                                       Focusable at t=0. Never fades in.
B2      ████████████                                   4 discs seat OUTER→IN
        │  │  │  │                                     90ms⚠ stagger, 220ms⚠ each
        r15 r11 r7 r3                                  scale .86→1 + opacity
                                                       cubic-bezier(0.16,1,0.3,1)
B3                  ██████████████                     3 gold rings break outward
                    │   │   │                          launch radii 82.5/89/96px⚠
                    120ms⚠ stagger                     = r(bullseye)+16/+22.5/+29.5
                    scale→3.6⚠ past screen edge        NEVER closer than 16px⚠ to rust
                    transform: cubic-bezier
                    opacity:  ease-out
B4                        ██████                       objective: translateY 8px→0
                                                       + opacity. 200ms⚠
B5                              ████████               stat cells, 60ms⚠ stagger
                                                       (4 cells Summit / 2 Marker)
B6                                      ██████         Reach row + badges + level.
                                                       ReachMeter itself gets NO
                                                       transform and NO opacity of
                                                       its own — it inherits the
                                                       parent row's fade. ⚠ confirm
                                                       this satisfies "never animates"
B7                                            ████     footer buttons opacity-in,
                                                       then focus() → "Continue"
                                                       ~1440ms⚠ total (Summit)
                                                       ~1180ms⚠ total (Marker)
```

**Skip semantics:** tap 1 = jump every element to its terminal state instantly (`animation-play-state` is not enough — set a `.landed` class on the panel root that hard-overrides all animation to `none` with final values). Tap 2 = close. The button label swaps `Skip` → `Close` after the first tap, keeping the same 44×44 hit box and the same DOM node so focus is not lost.

**Reduced-motion still (one frame, no animation):** the dialog opens directly at the terminal composition — every beat's *end state* renders at once, nothing is `display:none`. The three gold rings do not vanish; they render as **three static 1.5px ⚠ `--accent` hairline circles at their launch radii (82.5/89/96px ⚠), at 45% ⚠ opacity** — the burst becomes an engraved rosette. This is the direct fix for the current bug where `display:none` leaves a bare emoji: the ceremony's *composition* survives even when its *motion* does not.

**Token burn — the actual bug fix.** Burn `goaldmine.celebrated.goal.<goalId>.<capturedAt>` on the dialog's native **`open`/first paint**, not on effect mount, and skip the burn entirely if `document.visibilityState !== "visible"`. The current code burns inside `useEffect` at `GoalCompletedCelebration.tsx:59-68` regardless of whether a single pixel was ever on screen. That is why the founder's Elbert burst may have fired into the void below the fold.

---

# DIRECTION 2 — "THE ASSAY"

No dialog. No overlay. No focus management. The achieved page *is* the ceremony.

## 2a · Elbert / Summit tier

```
   AppHeader ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ sticky 48px
┌───────────────────────────────────────────────────────────────┐  ← 390px, full-bleed
│                                                               │    hero uses -mx-4 to
│   GOAL ACHIEVED                                               │ B1 escape the p-4 shell
│  ─────────────────────────────────────────────────────────    │ B1 rule draws L→R
│                                                               │    scaleX 0→1, 240ms⚠
│                                                               │
│                     █████████████                             │
│                ███████████████████████                        │
│              ████████░░░░░░░░░░░████████                      │
│           ███████░░░░░░░░░░░░░░░░░░░███████                   │
│          ██████░░░░░░░█████████░░░░░░░██████                  │
│         █████░░░░░░███████████████░░░░░░█████                 │  224px⚠ filled Bullseye
│         █████░░░░░█████░░░░░░░█████░░░░░█████                 │  on PLAIN --background
│         █████░░░░░█████░░░░░░░█████░░░░░█████                 │  (breaks out of the card
│         █████░░░░░█████░░░░░░░█████░░░░░█████                 │   system entirely)
│         █████░░░░░░███████████████░░░░░░█████                 │
│          ██████░░░░░░░█████████░░░░░░░██████                  │  Largest current use is
│           ███████░░░░░░░░░░░░░░░░░░░███████                   │  64px. This is 3.5×.
│              ████████░░░░░░░░░░░████████                      │
│                ███████████████████████                        │
│                     █████████████                             │
│                                                               │  ← 16px⚠ clear band
│                                                               │
│   Summit Mt.                                                  │ B2  DM Serif 400
│   Elbert                                                      │     text-4xl / 36px
│                                                               │     = the EXISTING ceiling
│   98 DAYS · 7/9 TARGETS · +700 XP                             │ B2  mono 13px⚠
│                                                               │     tracking .04⚠ --muted
│  ─────────────────────────────────────────────────────────    │
│                                                               │
│   WHAT MOVED                                                  │ B3  eyebrow --accent
│                                                               │     on --background ✓
│   ✓  Pack-loaded 3k ft carry        18 lb → 42 lb             │ B4  ported from
│   ✓  Back-to-back hike days          0 → 6                    │     completion-card.tsx
│   ✓  Longest single hike           4.2 mi → 11.8 mi           │     :99-147 verbatim
│   ✓  Resting HR                     64 → 52 bpm               │
│   ✓  Step-up 18in × reps            12 → 40                   │     40ms⚠ row stagger
│   ✓  Sleep ≥7h nights/wk             2 → 6                    │     rows are 32px⚠ tall
│   ·  Bodyweight squat 3×20          — → 3×14                  │     (not tap targets —
│                              + 2 more                         │      these are facts,
│                                                               │      not controls)
│  ─────────────────────────────────────────────────────────    │
│                                                               │
│   8 → 89                                                      │ B5  DM Serif 32px⚠
│   WEIGHTED PROGRESS ACROSS YOUR TARGETS                       │     11px bold --muted
│                                                               │     ← the honest label,
│                                                               │       never "% fit"
│   REACH   ▌▌▌▌▌  Legendary                                    │ B5
│                                                               │     ← 12px⚠ gap
│   ⬤ First Summit          ⬤ Body of Proof                     │ B5  52px BadgeMedals
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │                 Make a share card                       │  │ B5  44px BUTTON
│  └─────────────────────────────────────────────────────────┘  │     fill --accent
│                                                               │     text --accent-fg
│  ═══════════════════════════════════════════════════════════  │
│                                                               │
│  ┌─── Story ─────────────────────────────────────────────┐    │  ← the normal card
│  ┌─── Changelog ─────────────────────────────────────────┐    │    grid resumes here
│  ┌─── Reflection ────────────────────────────────────────┐    │
│  ┌─── Reopen ────────────────────────────────────────────┐    │  ← demoted
│                                                               │
   BottomNav ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁ fixed
└───────────────────────────────────────────────────────────────┘
```

**Fold check at 390×844:** AppHeader 48 + hero top 16 + eyebrow 16 + rule 1 + 20 gap + Bullseye 224 + 16 clear + objective 2 lines ≈ 78 + 12 + fact line 18 = **449px**. The Bullseye, the objective, and the fact line all land **above the fold on an iPhone SE (667px)** with ~200px to spare. That is the single strongest argument for this direction: it structurally cannot repeat the current below-the-fold bug, because there is no fold-dependent one-shot at all.

### Geometry & spacing (2a)

| element | value |
|---|---|
| hero bleed | `-mx-4` to reach the full 390px; internal padding `16px` ⚠ so text still aligns with the cards below |
| eyebrow → rule | `6px` ⚠ |
| rule | `1px` `--border`, full bleed edge-to-edge |
| rule → Bullseye | `20px` ⚠ |
| Bullseye | **224px** ⚠ centered |
| Bullseye clear band | **16px ⚠** all sides — the `WHAT MOVED` gold eyebrow is 130px+ below, safe |
| objective | DM Serif 400 · **36px** (`text-4xl`, the existing ceiling — **no new token needed**) |
| fact line | mono 13px ⚠ `--muted`, `·` separated, single line, wraps to 2 only past ~34 chars |
| target row | 32px ⚠ tall, 3-col: 16px status glyph / flexible label / right-aligned `start → final` mono 12px ⚠ |
| row cap | 6 + `+N more` — **reuse `MAX_TARGET_ROWS` from `completion-card.tsx:22`** |
| readiness numeral | DM Serif 32px ⚠ |
| CTA | **44px** tall, full width |

### Palette table (2a)

| element | light (cream) | dark (coal) | note |
|---|---|---|---|
| hero field | `--background #FAF3E3` | `--background #0F0B07` | deliberately *not* `--card` — the hero is not a card |
| `GOAL ACHIEVED` / `WHAT MOVED` | `--accent #8A6212` | `--accent #D4A437` | on plain `--background` only |
| rule | `--border #D9C8A2` | `--border #3A2E1F` | in coal add `4px` ⚠ extra space above/below; the rule is nearly invisible |
| Bullseye | `--target` / `--target-fg` | `--target` / `--target-fg` | no text ever inside |
| objective | `--foreground` | `--foreground` | |
| fact line | `--muted` | `--muted` | 13px ⚠ — do not drop to 12 in coal |
| `✓` met | `--success #4E6B36` | `--success #7FA45C` | |
| `·` unmet | `--muted` | `--muted` | **not `--danger`** — an unmet target is not a failure |
| target label | `--foreground` | `--foreground` | 14px |
| `start → final` | `--muted`, final value `--foreground` | same | mono 12px ⚠ |
| `8 → 89` | `8` in `--muted`, `→` in `--muted`, `89` in `--foreground` | same | the *delta* carries meaning, not a colour |
| ReachMeter | `--warning` | `--warning` | 12px ⚠ from badges |
| BadgeMedal | `--accent` / `--accent-fg` | `--accent` / `--accent-fg` | |
| CTA | fill `--accent`, label `--accent-fg` | fill `--accent`, label `--accent-fg` | |

### Cream↔coal hero strip (2a)

```
     LIGHT / cream                      DARK / coal
┌─────────────────────────┐   ┌─────────────────────────┐
│ GOAL ACHIEVED  8A6212   │   │ GOAL ACHIEVED  D4A437   │
│ ───────────── D9C8A2 ── │   │ ───────────── 3A2E1F ── │
│  the rule is legible    │   │  the rule nearly        │
│  and does the dividing  │   │  disappears → add 4px⚠  │
│                         │   │  and let space divide   │
│    ██████░░████░░████   │   │    ██████░░████░░████   │
│    9A480F on FAF3E3     │   │    D97A3D on 0F0B07     │
│    = dark mass, high    │   │    = warm glow, the     │
│      ink weight         │   │      brightest object   │
│                         │   │      on the screen      │
│ ✓ 4E6B36  (olive, sits  │   │ ✓ 7FA45C  (brighter —   │
│   quietly next to rust) │   │   reads as a second     │
│                         │   │   accent; keep it 16px⚠ │
│                         │   │   from the Bullseye)    │
└─────────────────────────┘   └─────────────────────────┘
```

## 2b · MARKER floor case — no targets

```
   AppHeader ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
┌───────────────────────────────────────────────────────────────┐
│                                                               │
│   GOAL ACHIEVED                                               │ B1
│  ─────────────────────────────────────────────────────────    │ B1
│                                                               │
│                     █████████████                             │
│                ███████████████████████                        │
│              ████████░░░░░░░░░░░████████                      │
│           ███████░░░░░░░░░░░░░░░░░░░███████                   │
│          ██████░░░░░░░█████████░░░░░░░██████                  │
│         █████░░░░░░███████████████░░░░░░█████                 │  IDENTICAL 224px⚠
│         █████░░░░░█████░░░░░░░█████░░░░░█████                 │  IDENTICAL treatment
│         █████░░░░░█████░░░░░░░█████░░░░░█████                 │
│         █████░░░░░█████░░░░░░░█████░░░░░█████                 │  A two-week goal gets
│         █████░░░░░░███████████████░░░░░░█████                 │  the same glyph at the
│          ██████░░░░░░░█████████░░░░░░░██████                  │  same size. That IS the
│           ███████░░░░░░░░░░░░░░░░░░░███████                   │  respect.
│              ████████░░░░░░░░░░░████████                      │
│                ███████████████████████                        │
│                     █████████████                             │
│                                                               │
│                                                               │
│   Rebuild the                                                 │ B2  DM Serif 36px
│   morning routine                                             │
│                                                               │
│   14 DAYS · +150 XP                                           │ B2  mono 13px⚠ --muted
│                                                               │     no "0/0 TARGETS" —
│                                                               │     a zero is not a fact
│  ─────────────────────────────────────────────────────────    │     worth printing
│                                                               │
│   You didn't set targets on this one. It took 14 days         │ B3  ← ONE honest sentence
│   from start to finish.                                       │     replaces the ENTIRE
│                                                               │     WHAT MOVED block.
│                                                               │     15px⚠ --foreground
│                                                               │     (NOT --muted — this
│  ─────────────────────────────────────────────────────────    │      is content, not a
│                                                               │      caption)
│   ⬤ First Summit                                              │ B5
│                                                               │
│   LEVEL 6 → 7                                                 │ B5  mono 13px⚠
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │                 Make a share card                       │  │ B5  44px
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
│  ═══════════════════════════════════════════════════════════  │
│  ┌─── Reflection ────────────────────────────────────────┐    │
│  ┌─── Reopen ────────────────────────────────────────────┐    │
   BottomNav ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁
└───────────────────────────────────────────────────────────────┘
```

**The sentence is the whole floor-case argument.** `"You didn't set targets on this one. It took 14 days from start to finish."` — factual, second person, no adjective, no exclamation, no consolation. It occupies the structural slot that seven target rows occupy for Elbert, so the page's *rhythm* is intact even though its *density* is not. Compare to printing `0/0 TARGETS`, which renders the absence as a score.

⚠ Copy is provisional; the register (terse, declarative, no praise) is not.

## Beat map — Direction 2

```
  0ms      120      240      360      480
  ├─────────┼─────────┼─────────┼─────────┤
B1 ██████████████████                        rule scaleX 0→1 from left
                                             240ms⚠ cubic-bezier(0.16,1,0.3,1)
                                             transform-origin: left
B2      ████                                 objective + fact line, opacity only
                                             ease-out 160ms⚠
B3           ████                            WHAT MOVED eyebrow
B4              ████████████                 target rows, 40ms⚠ stagger,
                                             opacity-only ease-out.
                                             7 rows × 40 = 280ms tail
B5                        ████████           readiness / Reach / badges / CTA
                                             ~480ms⚠ total
```
The Bullseye **does not animate at all.** It is simply *there*, at 224px, when the page paints. That is the most contrarian choice in the whole set and the one most aligned with "motion deliberately minimal." The ceremony is *scale and composition*, not event.

**Reduced-motion still:** identical to the animated version minus the rule draw and the row stagger. Nothing is lost, because nothing was carried by motion. This is the only direction where the reduced-motion experience is *not a degraded variant* — it is the same artifact.

**One-shot semantics:** the hero is permanent — it renders on every visit forever. The localStorage token no longer gates the *ceremony*; it gates only a small optional flourish (the rule draw + stagger), and if the token is already burned the page renders statically. **This is a real semantic change worth surfacing to the founder:** the "moment" becomes a "monument." Some of the emotional charge of a one-time event is traded for the guarantee that it is never missed.

---

# DIRECTION 3 — "VEIN STRIKE"

The cheap, conservative counter-proposal. Same card, fixed order, new glyph.

## 3a · Elbert / Summit tier

```
   AppHeader ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ sticky 48px
┌───────────────────────────────────────────────────────────────┐
│                                                               │
│  ┌───────────────────────────────────────────────────────┐    │ Card rounded-2xl
│  │▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│    │ border --border
│  │▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│    │ bg --card + B1 wash
│  │▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒       ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│    │ p-4
│  │▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒     ██████     ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│    │
│  │▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒    ██░░░░░░██   ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│    │ ┌ CRITICAL ─────────┐
│  │▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒   ██░██░░██░██  ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│    │ │ the accent-soft   │
│  │▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒   ██░██░░██░██  ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│    │ │ wash is MASKED    │
│  │▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒    ██░░░░░░██   ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│    │ │ OUT for 16px⚠     │
│  │▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒     ██████     ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│    │ │ around the        │
│  │▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒           ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│    │ │ Bullseye — gold   │
│  │▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│    │ │ never touches     │
│  │                                                       │    │ │ rust, even at 14% │
│  │   GOAL ACHIEVED                                       │    │ │ alpha             │
│  │                                                       │    │ └───────────────────┘
│  │   Summit Mt. Elbert                                   │    │
│  │   Sep 12, 2025                                        │    │ ⚠ eyebrow must sit on
│  │                                                       │    │   PLAIN --card, outside
│  │  ───────────────────────────────────────────────────  │    │   the wash. --accent on
│  │                                                       │    │   --accent-soft = 4.14:1
│  │   98          7 of 9         +700         8 → 89      │    │   in light = FAILS AA.
│  │   DAYS        TARGETS        XP           PROGRESS    │    │   ← this is why the wash
│  │                                                       │    │     stops above it.
│  │   REACH  ▌▌▌▌▌ Legendary                              │    │
│  │                                                       │    │ B3 numerals rise
│  │   ⬤ First Summit     ⬤ Body of Proof                  │    │    DM Serif 28px⚠
│  │                                                       │    │    70ms⚠ stagger
│  │  ┌─────────────────────────────────────────────────┐  │    │
│  │  │            Completion card                      │  │    │ 44px BUTTON
│  │  └─────────────────────────────────────────────────┘  │    │ (promoted from the
│  │                                                       │    │  14px link at :342)
│  └───────────────────────────────────────────────────────┘    │
│                                                               │
│  ┌─── Story ─────────────────────────────────────────────┐    │
│  ┌─── Changelog ─────────────────────────────────────────┐    │
│  ┌─── Reflection ────────────────────────────────────────┐    │
│  ┌─── Reopen ────────────────────────────────────────────┐    │ ← DEMOTED from :365
│                                                               │
   BottomNav ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁
└───────────────────────────────────────────────────────────────┘
```

**The wash-vs-eyebrow collision is a real finding, not a detail.** The brief says the card washes `--accent-soft` and the eyebrow register is `--accent`. In cream those two together measure **4.14:1 — below AA for a 12px bold eyebrow.** Three ways out, in preference order:
1. **Mask the wash** to the upper glyph zone only, so the eyebrow sits on plain `--card`. (Drawn above.)
2. Eyebrow becomes `--foreground` on this surface only — breaks the eyebrow register app-wide.
3. Drop the wash. Then B1 doesn't exist and the direction is down to two beats.

Note the 28px ⚠ `+700` gold numeral *would* be legal on `--accent-soft` — 4.14:1 passes AA for large text — so only the small eyebrow is the problem.

### Geometry & spacing (3a)

| element | value |
|---|---|
| Bullseye | **72px** ⚠ centered, `margin-top 4px` ⚠ |
| wash mask | `--accent-soft` fill, punched out in a **104px ⚠ circle** (72 + 16×2) centred on the Bullseye |
| Bullseye → eyebrow | `20px` ⚠ |
| eyebrow → objective | `6px` |
| objective | 18px ⚠ semibold sans (**not** DM Serif — inside a card the serif at 18px reads as decoration; the serif is reserved for the numerals here) |
| stat numerals | DM Serif 400 · **28px** ⚠ |
| ReachMeter → badges | 12px ⚠ |
| Bullseye → nearest gold (`+700`, badges, CTA) | ≥ **90px** ⚠ vertical — comfortably past the 16px minimum |
| CTA | **44px** tall |

### Palette table (3a)

| element | light (cream) | dark (coal) | note |
|---|---|---|---|
| card | `--card #FFFBF0` | `--card #1A130C` | |
| wash | `--accent-soft rgba(138,98,18,0.14)` | `--accent-soft rgba(212,164,55,0.12)` | **masked** — 16px ⚠ clear ring around the Bullseye |
| eyebrow | `--accent` on **plain `--card`** | `--accent` on **plain `--card`** | never on the wash in light |
| Bullseye | `--target` / `--target-fg` | `--target` / `--target-fg` | 4 discs at 72px; the r3 centre dot is 6.75px — visible, keep it |
| objective | `--foreground` | `--foreground` | |
| date | `--muted` | `--muted` | 12px |
| numerals | `--foreground`; `+700` in `--accent` | same | 28px ⚠ = large text, gold-on-wash legal |
| labels | `--muted` | `--muted` | 11px bold `.09em` |
| ReachMeter | `--warning` | `--warning` | |
| CTA | `1px --accent` outline, label `--accent`, bg `--card` | same | **outline, not fill** — a filled gold button 90px below a rust Bullseye inside a gold-washed card is too much gold in one 300px column |

### Cream↔coal strip (3a)

```
     LIGHT / cream                      DARK / coal
┌─────────────────────────┐   ┌─────────────────────────┐
│ card FFFBF0             │   │ card 1A130C             │
│ + wash rgba(138,98,18,  │   │ + wash rgba(212,164,55, │
│   .14) → visibly GOLDER │   │   .12) → barely visible │
│   and slightly DARKER   │   │   against 1A130C; reads │
│   than the page FAF3E3  │   │   as a faint warm lift  │
│                         │   │                         │
│  ⚠ in coal the wash may │   │  ⚠ consider 0.18⚠ alpha │
│    be TOO subtle to     │   │    in coal only, OR let │
│    register as a beat   │   │    B1 be a border-color │
│    at all → B1 may be   │   │    shift --border →     │
│    invisible in dark    │   │    --accent instead     │
│    ██░██░░██░██ D97A3D  │   │    ██░██░░██░██ 9A480F  │
│    glows on the wash    │   │    sits dark on the wash│
└─────────────────────────┘   └─────────────────────────┘
```
**This asymmetry is Direction 3's biggest weakness:** its opening beat is a background tint, and a background tint at 12% alpha on `#1A130C` is close to nothing. The direction's cheapness comes partly from the fact that its first beat may not exist in the founder's own palette.

## 3b · MARKER floor case

```
│  ┌───────────────────────────────────────────────────────┐    │
│  │▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒       ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│    │
│  │▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒     ██████     ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│    │
│  │▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒    ██░░░░░░██   ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│    │ IDENTICAL 72px⚠
│  │▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒   ██░██░░██░██  ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│    │ IDENTICAL wash
│  │▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒   ██░██░░██░██  ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│    │
│  │▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒    ██░░░░░░██   ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│    │
│  │▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒     ██████     ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│    │
│  │▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒           ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│    │
│  │                                                       │    │
│  │   GOAL ACHIEVED                                       │    │
│  │                                                       │    │
│  │   Rebuild the morning routine                         │    │
│  │   Mar 3, 2026                                         │    │
│  │                                                       │    │
│  │  ───────────────────────────────────────────────────  │    │
│  │                                                       │    │
│  │   14              +150                                │    │ only TWO numerals
│  │   DAYS            XP                                  │    │ → B3 is 2 steps, ~140ms⚠
│  │                                                       │    │   shorter. Nothing is
│  │   No targets were set on this goal.                   │    │   quieter; there is less.
│  │                                                       │    │
│  │   ⬤ First Summit                                      │    │
│  │                                                       │    │
│  │  ┌─────────────────────────────────────────────────┐  │    │
│  │  │            Completion card                      │  │    │ 44px
│  │  └─────────────────────────────────────────────────┘  │    │
│  └───────────────────────────────────────────────────────┘    │
```
**The floor-case risk here is real:** a 2-week zero-target goal in this card is a 72px Bullseye, two numerals, and one badge, sitting in a gold wash. It is not undignified — but it is very close to what a *level-up* looks like. Direction 3's category escape depends almost entirely on the Bullseye being a different glyph from the ring-burst, and at 72px inside a card that is a subtler distinction than it is at 133px or 224px.

## Beat map — Direction 3

```
  0ms     260      500      740      950     1150
  ├─────────┼────────┼────────┼────────┼────────┤
B1 ████████████                                    card wash --accent-soft
                                                   opacity 0→1, 260ms⚠ ease-out
                                                   (masked 16px⚠ off the Bullseye)
                                                   ⚠ may be near-invisible in coal
B2         ████████████████████                    4 discs seat OUTER→IN
           │   │   │   │                           120ms⚠ stagger, 200ms⚠ each
           r15 r11 r7  r3                          scale .88→1
                                                   cubic-bezier(0.16,1,0.3,1)
B3                        ██████████████           4 numerals rise 6px⚠ + fade
                          │  │  │  │               70ms⚠ stagger
                          98 7/9 700 89            ~1150ms⚠ total (Summit)
                                                   ~1010ms⚠ total (Marker, 2 numerals)
```

**Reduced-motion still:** the wash renders at full value, the four discs render seated, the numerals render at rest. **Nothing is `display:none`.** Because there is no ring flight in this direction, the reduced-motion frame and the terminal frame are byte-identical — which is either the direction's cleanest property or proof that its motion was never carrying the ceremony.

---

# COMPARISON

| | **D1 Summit Sheet** | **D2 The Assay** | **D3 Vein Strike** |
|---|---|---|---|
| **Category-distinctness** *(does it escape "the burst"?)* | **Strongest.** New surface, new glyph, new duration, focus moves. Nothing about it can be confused with a 560ms medallion ring. The rings survive but now *break past the screen edge* from a 133px rust disc — different scale class entirely. | **Strong, differently.** Escapes by removing the event category altogether: there is no "burst" to compare because there is no burst. Risk: escaping *into* the "page I already saw" category. | **Weakest.** Same card, same page, still a staged reveal. Escape rests entirely on Bullseye-vs-rings at 72px. Plausibly still encoded as "the burst, but browner." |
| **Floor-case dignity** | **Good**, if vertically centred. The refusal to shrink the glyph is the whole argument. Open risk ⚠: a full-screen takeover for a 14-day goal may read as overclaiming — the one place this direction could feel Duolingo-ish. | **Best.** The honest sentence occupies the structural slot the target table occupies for Elbert. Rhythm intact, density honest, nothing invented, no zero printed. | **Adequate but thin.** Two numerals + one badge + a gold wash is very close to a level-up card. Least differentiated at the floor. |
| **a11y risk** | **Highest.** Modal, focus trap, focus return, Esc, `aria-labelledby` on the objective, skip-to-terminal, screen-reader ordering vs. the staged reveal, `dialog` on iOS. All solvable — `BottomSheet.tsx` already solves most of it — but it is the only direction that can *trap* a user. | **Lowest.** No overlay, no focus management, no trap, no `aria-live`. Ordinary document flow. Motion is opacity-only after the one rule. Reduced-motion output is identical to full-motion. | **Low.** No new dialog, no focus change. Only real risk is the `--accent`-on-`--accent-soft` 4.14:1 failure, which the mask fixes. |
| **Build cost** | **Highest.** New panel class, new full-bleed dialog variant, ~7 keyframe groups, skip state machine, focus choreography, token-burn-on-visible, two new content tiers, plus a new display type step (34px ⚠ exceeds `text-4xl`). | **Medium.** No dialog at all. Biggest lift is porting the target rows out of `completion-card.tsx` into a React/Tailwind component — but the sort/cap/format logic already exists and is unit-tested. Reuses `text-4xl`. Two keyframes total. | **Lowest.** Reorder JSX in `page.tsx`, delete two emoji, swap in `<Bullseye size={72} filled/>`, add ~3 keyframes, move the Reopen card, promote a link to a button. Half a day. |
| **Thesis fit** *("motion deliberately minimal, dead-simple on a phone, honest logger")* | **Weakest fit.** ~1440ms of choreographed staging with focus management is not "deliberately minimal." Defensible only as a once-per-goal exception. | **Best fit.** 480ms, one transform in the entire sequence, no overlay, and the Bullseye doesn't move at all. "Dead-simple on a phone" is literally the mechanism: it's just a page, scaled correctly. The honest-logger voice gets its own block (`WHAT MOVED`). | **Good fit on minimalism, weak on honesty surface.** Cheapest and quietest, but it surfaces no new truth — the same four numerals in a new order. Doesn't earn the "honest logger" half. |
| **Saccharine / Duolingo risk** | **Highest.** A full-screen auto-opening takeover with staged reveals and a gold burst is the exact form factor of every streak-celebration modal on earth. Mitigations (no exclamation marks, no praise adjectives, rust not gold at the centre, peer-weight Continue button, opaque Skip from frame 0) are real but the *form* is the thing users pattern-match. | **Lowest.** Editorial, not congratulatory. An assay report is the least Duolingo object imaginable. Main risk inverts: it may feel *insufficiently* celebratory — the founder may look at it and feel informed rather than proud. | **Low-medium.** A gold-washed card with rising numerals is mildly game-y but restrained. Its risk isn't saccharine — it's *forgettable*. |

## The actual trade being made

The three directions are not three amplitudes of one idea; they are three different answers to *where the pride lives*.

- **D1 says pride is an event** — a bounded moment you are given, once, and then dismiss.
- **D2 says pride is an artifact** — a permanent object you can return to, and the ceremony is that the object is *large and true*.
- **D3 says pride is an adjustment** — the existing card, corrected.

D1 has the highest ceiling and the highest risk of being the exact thing the diagnosis warned about (a *bigger* token, still a token). D2 is the only one whose reduced-motion, no-JS, token-burned, and second-visit states are all the same experience — which is a very strong a11y and honesty position, and the one that most resembles the founder's own voice. D3 is the correct thing to ship if the answer to "is this worth two weeks?" turns out to be no, and it is also a strictly-better baseline that D1 or D2 could be built *on top of* later (all three share the "delete both emoji, promote the CTA, demote Reopen, use the Bullseye" spine).

If narrowing to one: **D2 is the strongest thesis fit and the lowest risk; D1 is the strongest emotional ceiling.** The synthesis worth considering in Phase B is **D2's permanent hero + D1's ring-break as a one-shot flourish layered on it** — the monument is always there, and the first visit adds a single 380ms ⚠ ring break that, if missed, costs nothing.

## Open questions for Phase B

1. Does the 34px ⚠ objective in D1 justify a new display type step above `text-4xl`, or should D1 cap at 36px like D2 does?
2. Is `--warning` (Epic/Legendary Reach) subject to the same 16px ⚠ clear-band rule against `--target`? Needs the same measurement that produced 1.35:1 / 1.16:1.
3. D1 Marker: full-bleed takeover, or fall back to the existing 85dvh `.bottom-sheet-panel`?
4. Does "ReachMeter never animates" permit it to inherit a parent container's opacity fade (D1 B6), or must it be at full opacity from frame 0?
5. D3's B1 wash at 12% alpha on `#1A130C` — measurable beat, or nothing? If nothing, D3 is a two-beat direction.
6. D2 changes the one-shot from gating the *ceremony* to gating a *flourish*. Is that acceptable, or is the once-ness itself load-bearing?

---

### Critical Files for Implementation
- /Users/ggronnii/Development/goaldmine/src/app/goals/[id]/page.tsx
- /Users/ggronnii/Development/goaldmine/src/components/GoalCompletedCelebration.tsx
- /Users/ggronnii/Development/goaldmine/src/app/globals.css
- /Users/ggronnii/Development/goaldmine/src/components/BottomSheet.tsx
- /Users/ggronnii/Development/goaldmine/src/lib/completion-card.tsx