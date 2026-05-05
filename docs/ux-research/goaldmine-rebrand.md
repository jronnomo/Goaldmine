# UX Research: Goaldmine Rebrand

**Author**: Claude (UX Research Orchestrator)
**Date**: 2026-05-05
**Source PRD**: `docs/prds/PRD-goaldmine-rebrand.md`
**Audience**: Tech Lead (lifts these recommendations into PRD updates), Sonnet developer agents (implement them)

This document resolves the open design questions in PRD §9 and pre-resolves the soft questions latent in §3 / §5. Every section ends with a **Recommendation** the Tech Lead can lift verbatim. ASCII mockups are at 390 px viewport (≈ 60 chars wide for box drawings).

---

## 1. Logo SVG composition

**Goal**: A treasure-chest-brimming-with-red-white-targets that reads at 28 px (header), 32 px (favicon), 192 px and 512 px (PWA icons), and renders crisp from a single 64-unit `viewBox`.

### Constraints from PRD + repo

- Inline SVG, server component (`<Logo size={n} />`)
- Must be recognizable at 28 px (no fine detail below 2 px stroke equivalent)
- Goaldmine identity: **mining + targets**. The chest is the "mine" payload. The targets are the "goals" — what's being mined.
- Single hue palette per the rebrand: gold accent (`--accent`), barn red (`--target`), white target rings, deep coal (`--background`/`--accent-fg`) for outline.

### Option A — "Brimming chest" (3 targets stacked)

```
        ___________________
       /  ___    ___    \\
      /  (◎)  (◎)        \\        ← three concentric red/white targets brim
     /  ___   (◎)         \\          out of an open chest
    /  (◎)                 \\
   /                         \\
  ┌─────────────────────────┐
  │ ▒ ▒ ▒ ▒ ▒ ▒ ▒ ▒ ▒ ▒ ▒ ▒ │     ← chest body: gold planks + dark seams
  │═════════════════════════│
  │ ▒ ▒ ▒ ▒ [keyhole] ▒ ▒ ▒ │
  └─────────────────────────┘
```

- Lid: open, angled back ~25°, gold trim, dark interior cavity behind targets
- 3 targets cluster: 2 lower (sized 14u and 12u in 64u viewBox), 1 upper (16u, taller)
- Each target is a 4-ring bullseye: outer red, white, red, white-dot center
- Chest body: gold base + 2 dark horizontal seams + small keyhole
- Total bounding box: 56u wide × 56u tall, centered in 64×64 viewBox

**At 28 px**: 3 targets read as 3 distinct dots; chest reads as horizontal gold bar with dark seam. Total info: "gold thing with 3 dots". Recognizable but borderline busy.

### Option B — "Single hero target on chest" (1 large + 2 silhouettes)

```
              _______
             |   ◎   |          ← one prominent 4-ring target dead-center
            _|___ ___|_
           /  ◯     ◯  \\        ← two hollow target outlines flanking
          /  small    \\           (lower contrast, decorative)
         /             \\
        ┌───────────────┐
        │ ▓▓▓▓▓▓▓▓▓▓▓▓▓ │       ← chest body, single gold tone + dark band
        │═══[keyhole]═══│
        └───────────────┘
```

- One **dominant** target, ~22u wide, sitting up out of the open chest
- Two smaller hollow target outlines flanking at half-size, behind/below
- Chest is a flat gold trapezoid with one keyhole and one strap

**At 28 px**: The single dominant target reads instantly. The flanking hollow circles read as two smaller dots — secondary visual texture. Chest reads as a gold base. Total info: **"chest with gold target popping out"** — strongest legibility of the three options.

### Option C — "Pickaxe + chest with target" (mining-explicit)

```
                  ╲_╱
              ╲   |⌐|             ← pickaxe handle crossing behind the chest
               ╲  | |
              ___|◎|___           ← target on top
             /         \\
            /  CHEST    \\
           ┌─────────────┐
           │▓▓▓▓ ▓▓▓ ▓▓▓ │
           │═════════════│
           └─────────────┘
```

- Adds an implied pickaxe slash behind the chest, with a single target as a "found nugget"
- Most narrative — but **most lines** at small sizes; pickaxe handle disappears below 32 px

**At 28 px**: Pickaxe vanishes; reads as Option B with extra noise above. Not worth the complexity.

### Legibility test (ASCII at scale)

```
At 28 px (header):       At 32 px (favicon):     At 192 px (icon):
                                                  Full detail visible
  A:  ░░◉◉◉░░               A:  ▒▒◉◉◉◉▒▒          all 3 targets crisp
      ▓▓▓▓▓▓▓                   ▓▓▓▓▓▓▓▓▓         chest grain readable

  B:  ░░░◉░░░               B:  ░░░◉◉◉░░░         hero target dominant
      ▓▓▓▓▓▓▓                   ▓▓▓▓▓▓▓▓▓         flanking targets soft

  C:  ░░░◎░░░               C:  ░╲░◎░╱░           pickaxe + chest
      ▓▓▓▓▓▓▓                   ▓▓▓▓▓▓▓▓▓
      (pickaxe lost)
```

### Recommendation

**Option B — "Single hero target on chest"**.

**Why**:
- Strongest read at 28 px (one focal target > three small ones).
- Mining metaphor still survives via the chest; "goals" survives via the bullseye.
- The pickaxe in Option C stops working at small sizes — fails the favicon constraint.
- The flanking hollow targets give richness at 192/512 px without competing at 28 px.

### Compositional spec for the developer agent

**ViewBox**: `0 0 64 64`
**Stroke width**: 1.25u for chest outlines, 0u (filled shapes) for targets and chest body
**Layer order (bottom → top)**:

1. **Chest body** — rounded trapezoid, points: `(8, 32) → (56, 32) → (52, 56) → (12, 56)` arc-corner-r=2u. Fill `--accent` (gold).
2. **Chest dark band** — rectangle `(12, 42) → (52, 46)`, fill `--accent-fg` (deep coal). Splits the body into two planks.
3. **Keyhole** — circle r=1.25u + 1u tall rectangle below it at `(32, 50)`, fill `--accent-fg`.
4. **Chest lid (open, behind)** — rotated rectangle `(8, 18) → (56, 30)`, rotated -8° around its bottom edge, fill `--accent` darkened ~15% (use `--border` or a hardcoded `#8a6a23`).
5. **Lid interior shadow** — small dark trapezoid behind targets, fill `--accent-fg` at 80% opacity.
6. **Flanking hollow targets** (decorative) — two circles at `(18, 22)` and `(46, 22)`, r=5u, stroke `--target` 1.25u, no fill.
7. **Hero target** (foreground, central):
   - Outer disc: cx=32, cy=18, r=11, fill `--target`
   - Ring 1: r=8, fill `#FFFFFF`
   - Ring 2: r=5, fill `--target`
   - Ring 3 (center dot): r=2, fill `#FFFFFF`
8. **Optional: 1u dark outline around the hero target** at r=11.5, stroke `--accent-fg` 0.5u — improves contrast on light-mode cream backgrounds.

**Target ring count: 4 rings (3 visible bands + 1 center dot)** — matches the canonical Bullseye motif spec in §2 below.

**Total prop API**:
```ts
interface LogoProps {
  size?: number;        // px, default 32
  className?: string;
  title?: string;       // for accessibility, default "Goaldmine"
}
```

The `<svg>` element gets `role="img"` + `aria-label={title}`. No props gate fill colors — they come from CSS variables so the logo automatically theme-flips light/dark.

---

## 2. Bullseye motif anatomy

**Goal**: One canonical SVG that scales to 6 / 10 / 14 / 20 px and supports `filled`, hollow, and `progress=0..1` modes consistently.

### Ring count vs. size

```
Size   Rings visible   What's preserved        What's dropped
────   ─────────────   ─────────────────────   ────────────────────
6 px   1 disc          dot, no rings           no rings (target=dot)
10 px  2 (1 ring + dot) red ring + center dot  inner concentric detail
14 px  3 (2 rings+dot) red/white/red + dot     finest center
20 px  4 (3 rings+dot) full canonical          nothing
```

**Rationale**: Rings below ~3 px alternating bands turn into a muddy gray smear on most retina screens. We adapt count by size — but `viewBox` stays constant (`0 0 32 32`) so the developer ships **one SVG** and conditionally renders rings via the `size` prop.

### Canonical SVG anatomy (viewBox 0 0 32 32)

```
        ╭───────────╮
       ╱      r=15   ╲          ← outer red disc (--target)
      │   ╭───────╮   │
      │  ╱  r=11   ╲  │         ← white ring (--target-fg / #FFFFFF)
      │ │  ╭─────╮  │ │
      │ │ ╱ r=7   ╲ │ │         ← inner red ring (--target)
      │ │ │ ╭───╮ │ │ │
      │ │ │ │r=3│ │ │ │         ← white center dot (--target-fg)
      │ │ │ ╰───╯ │ │ │
      │ │ ╲       ╱ │ │
      │ │  ╰─────╯  │ │
      │ ╲           ╱ │
      │  ╰─────────╯  │
       ╲             ╱
        ╰───────────╯
```

- `r=15, 11, 7, 3` (4 concentric circles, evenly spaced 4u rings, with a 1u outer dark edge implicit if needed)
- Stroke widths: **none** — every circle is filled. Concentric fills give crisper edges than alternating strokes at small sizes.

### Hollow vs. filled

```
filled (logged)              hollow (pending)
   ╭──────╮                   ╭──────╮
  │ ███████ │                 │       │       ← outer ring stroke only
  │ ██╭──╮██ │               │  ╭──╮  │       ← single thin stroke ring
  │ ██│██│██ │               │  │  │  │
  │ ██╰──╯██ │               │  ╰──╯  │
  │ ███████ │                 │       │
   ╰──────╯                    ╰──────╯
   --target fg                 stroke = --muted, fill = none
   white inside                  no center dot
```

**Hollow rendering**:
- Single circle, r=14, `fill="none"`, `stroke="var(--muted)"`, `stroke-width=2`.
- No center dot.
- Reads as "target awaiting a hit" — empty silhouette of the bullseye, deliberately unsaturated so it doesn't compete with the filled siblings.

**Filled rendering**:
- 4 concentric filled discs at the size's ring count (see table above).
- Always uses `--target` for red rings and `#FFFFFF` for white rings.
- Center dot is **always** white (the "perfect hit" visual cue).

### Progress rendering — three options evaluated

**Option (a) — Wedge fill (clock-style)**

```
progress = 0.25         progress = 0.6          progress = 1.0
  ╭──────╮                ╭──────╮                ╭──────╮
  │██░░░░ │                │█████░ │                │██████ │
  │██░░░░ │                │█████░ │                │██████ │
  │░░░░░░ │                │██████ │                │██████ │
  │░░░░░░ │                │░░██░░ │                │██████ │
   ╰──────╯                 ╰──────╯                 ╰──────╯
   ¼ pie wedge from 12      ⅗ pie wedge             full disc
```

**Pros**: instantly read as "progress" (matches OS-level progress rings). **Cons**: shape doesn't look like a bullseye anymore — defeats motif consistency. 0% looks identical to hollow.

**Option (b) — Ring fill (rings light up centripetally)**

```
progress = 0.25     progress = 0.5      progress = 0.75     progress = 1.0
  ╭──────╮            ╭──────╮            ╭──────╮            ╭──────╮
  │ ░░░░ │            │ ░░░░ │            │ ████ │            │ ████ │
  │░╭──╮░│            │░╭──╮░│            │█╭──╮█│            │█╭██╮█│
  │░│██│░│            │░│██│░│            │█│██│█│            │█│██│█│
  │░╰──╯░│            │░╰──╯░│            │█╰──╯█│            │█╰██╯█│
  │ ░░░░ │            │ ████ │            │ ████ │            │ ████ │
   ╰──────╯            ╰──────╯            ╰──────╯            ╰──────╯
  inner dot only      + 2nd ring          + 3rd ring          full bullseye
   (1 of 4)            (2 of 4)            (3 of 4)            (4 of 4)
```

Maps `progress` → ring count: `Math.ceil(progress * 4)` rings filled, from center out.

**Pros**: stays *visually* a bullseye at every progress level. **Cons**: 4 discrete steps (granularity of ¼) — won't show 33% vs 40%.

**Option (c) — Dot count ringed**

```
6 dots arranged in a ring, fill N of 6 by progress.
Discarded: doesn't read as bullseye, looks like a generic loader.
```

### Recommendation

**For Bullseye motif consistency: use (b) ring fill, with a hollow outer ring always visible to maintain target shape.**

```
progress = 0.0        progress = 0.4         progress = 1.0
   ╭──────╮             ╭──────╮               ╭──────╮
   │      │             │  ░░  │               │██████│
   │ ░░░░ │             │ ░██░ │               │█████│
   │ ░░░░ │             │ ░██░ │               │██████│
   │      │             │  ░░  │               │██████│
    ╰──────╯              ╰──────╯               ╰──────╯
   stroke ring          1 + 2 inner discs       full canonical
   only (= hollow)
```

- **Goal-progress mapping**: `progress 0–24%` → 0 inner rings (just outline), `25–49%` → center dot only, `50–74%` → dot + ring 3, `75–99%` → dot + ring 3 + ring 2, `100%` → full canonical filled.
- **Why ring fill over wedge**: The PRD calls Bullseye a *recurring motif*. The dot in BottomNav (size 6) and CalendarMonth (size 10) are always rendered as filled small discs. If goal progress used wedge fill, it would visually fork the motif into two unrelated shapes. Ring fill keeps every bullseye recognizable as a bullseye.
- **Granularity caveat**: Communicate to the user that "filled steps" is intentional. If finer progress is desired later, add a thin tick on the outer ring at `progress * 360°` *in addition to* the ring fill — additive, not replacement.

### Bullseye prop API (developer agent spec)

```ts
interface BullseyeProps {
  size?: number;              // px, default 16
  filled?: boolean;           // default false (= hollow stroke ring)
  progress?: number;          // 0..1; if set, overrides `filled` and renders ring count
  className?: string;
  'aria-label'?: string;      // if absent and decorative, sets aria-hidden
}
```

**Render rules** (deterministic):

| Size | filled state | Renders |
|------|--------------|---------|
| 6 px | `filled` or `progress >= 0.25` | single red disc r=15 |
| 6 px | hollow / progress=0 | single circle stroke=2 (--muted), no fill |
| 10 px | filled | red r=15 + white r=8 (2 rings) |
| 10 px | hollow | stroke ring only |
| 10 px | progress 0..1 | snap to {0, 0.5, 1}: hollow / outer red only / red+white |
| 14 px | filled | red r=15 + white r=10 + red r=5 (3 rings) |
| 14 px | hollow | stroke ring only |
| 14 px | progress | snap to {0, 0.33, 0.66, 1} |
| 20 px+ | filled | full 4-ring canonical (r=15,11,7,3) |
| 20 px+ | hollow | stroke ring only |
| 20 px+ | progress | snap to {0, 0.25, 0.5, 0.75, 1} → 0..4 rings from center |

**Stroke widths** are unitless inside the `viewBox` (always 0 0 32 32) — the consumer's `size` prop scales the SVG via `width` + `height` attributes; stroke widths scale proportionally so visual weight stays consistent across sizes.

**Accessibility**: when `aria-label` is given, also set `role="img"`. When absent, set `aria-hidden="true"` and assume surrounding text carries the meaning.

---

## 3. Active bottom-nav indicator

**Goal**: Mark the active tab on a 5-tab bottom nav, 390 px wide phone, ≥ 44 px tap targets.

5 tabs at 390 px width = 78 px per tab. Plenty of horizontal room.

### Option A — Bullseye dot above label (PRD default)

```
┌─────────────────────────────────────────────────────────┐
│  Today    Cal    ◉ Records   Goals   Journal           │
│  ────    ────   ◉ ──────    ────    ──────             │
│                  ↑                                       │
│                  small dot above label, ~6px            │
└─────────────────────────────────────────────────────────┘
```

- Visual weight: small but present
- Tap-target compliance: dot is 6 px but the entire 78×56 cell is the link
- Brand consistency: ★★★★★ — direct motif application
- Reads as "you've hit the target on this tab"

### Option B — Underline below

```
┌─────────────────────────────────────────────────────────┐
│  Today    Cal    Records   Goals   Journal             │
│                  ────────                                │
│                  gold underline, 2px tall               │
└─────────────────────────────────────────────────────────┘
```

- Standard pattern; recognizable
- Brand consistency: ★★ — just a colored line, no motif
- Risk: can collide with the iOS home-indicator bar at the very bottom

### Option C — Full-tab tinted background

```
┌─────────────────────────────────────────────────────────┐
│  Today  │ Cal  │░Records░│ Goals │ Journal             │
│         │      │░░░░░░░░░│       │                      │
│                ↑                                          │
│                tinted bg (--accent-soft, 12% gold)       │
└─────────────────────────────────────────────────────────┘
```

- Loud — signals "this tab" hard
- Brand consistency: ★★ — gold but no motif
- Issue at 78 px wide: the tinted block dominates the 56 px tall nav strip; feels heavy on a small screen

### Option D — Bullseye replacing a label-position icon

```
┌─────────────────────────────────────────────────────────┐
│  Today    Cal    ◎          Goals   Journal            │
│                  Records                                 │
└─────────────────────────────────────────────────────────┘
```

- Dot replaces nothing (no current icons), or replaces label entirely
- Confusing — labels are needed for the 5 distinct tabs
- Discarded.

### Scoring

| Criterion (weight) | A: dot above | B: underline | C: tinted bg | D: replace |
|---|---|---|---|---|
| Brand fit (×3) | 5 → 15 | 2 → 6 | 2 → 6 | 4 → 12 |
| Legibility 390 px (×2) | 4 → 8 | 5 → 10 | 5 → 10 | 2 → 4 |
| Tap-safe (×2) | 5 → 10 | 5 → 10 | 5 → 10 | 5 → 10 |
| Visual weight (×1) | 4 | 5 | 2 | 3 |
| **Total** | **37** | **31** | **28** | **29** |

### Recommendation

**Option A — small filled bullseye (size=6) above the label, in `var(--accent)`**.

Active tab structure:

```
  ◉           ← 6 px Bullseye filled, var(--accent), 2 px below top of cell
  Records     ← label, var(--accent), font-medium
              ← 12 px below, small line of breathing room

inactive:
              ← no dot
  Goals       ← label, var(--muted), font-medium
```

Spacing: tab cell = 56 px tall. `flex-col` → `pt-2` (8 px) → bullseye → `mt-1` (4 px) → label → bottom safe-area inset for iOS. Total content height ≈ 30 px, leaves 26 px breathing room.

Also: **keep `aria-current="page"` on the active link** — color is not the only signal.

---

## 4. Calendar day-status dot placement

**Goal**: Mark days with `workoutCount > 0` using a small filled bullseye. Cell is ~48 px square at 390 px / 7 cols (≈ 55 px minus gaps).

### ASCII test at scale (5 cells in a row, ~55 px each)

**Option A — Top-right corner**

```
┌────┬────┬────┬────┬────┐
│1 ◉│2 ◉│3 ◉│4   │5 ★ │   ← dot top-right; star can also live there
│   │   │   │   │   ◉│   ← dot bottom-right when star occupies top-right
│Pull│Push│Cap│Rest│Run │
└────┴────┴────┴────┴────┘
```

**Option B — Centered, replacing day number**

```
┌────┬────┬────┬────┬────┐
│ ◉ │ ◉ │ ◉ │ 4 │ ◉ │   ← bullseye replaces the day digit
│   │   │   │   │   │
│Pull│Push│Cap│Rest│Run │
└────┴────┴────┴────┴────┘
```

Discarded immediately: loses the date, breaks scanability. The day number is the primary affordance.

**Option C — Centered alongside day number (dot below digit)**

```
┌────┬────┬────┬────┬────┐
│ 1 │ 2 │ 3 │ 4 │ 5 │
│ ◉ │ ◉ │ ◉ │   │ ◉ │   ← centered horizontally, below digit
│Pull│Push│Cap│Rest│Run │
└────┴────┴────┴────┴────┘
```

Centered wins on visual rhythm but conflicts with the existing `dayTitle` truncation at the bottom of cells (`Pull`, `Push`, etc.). The bottom row is reserved for the program label.

**Option D — Top-right corner stack (dot + star + baseline marker)**

```
┌──────────┐
│ 5      ★ │   ← override star top-right (existing pattern)
│        ◉ │   ← workout dot below star
│        ◎2│   ← baselines-due marker
│ Lower    │   ← dayTitle bottom
└──────────┘
```

This **already exists** in the current `CalendarMonth.tsx` (top-right is the icon stack). The PRD §3.1.9 asks to **replace the green ✓** with a filled bullseye in that same stack position. We're not redesigning placement, we're swapping the visual primitive.

### What changes vs. what stays

| Element | Current | New |
|---|---|---|
| Day digit | Top-left | Top-left (unchanged) |
| Today border | `var(--accent)` | `var(--accent)` (unchanged, recolored to gold) |
| Workout-logged signal | green ✓ glyph + emerald border tint + emerald bg tint | **Filled `<Bullseye size={10} />` in `--target` red/white**; **drop the emerald border/bg tints** |
| Override marker | amber ★ | `★` recolored to `var(--warning)` |
| Baseline-due | gold `◎N` | gold `◎N` recolored to `var(--accent)` |
| Goal-date | 🏔 emoji | 🏔 (kept; already brand-neutral) |
| Combined override + workout | both visible (top-right stack) | both visible — Bullseye and `★` in same stack, vertically stacked |

### Recommendation

**Bullseye (size=10) in the top-right corner stack** — same physical position as today's green ✓. Drop the emerald border tint and the emerald bg-fill tint entirely; let the bullseye carry the "completed" signal alone.

Stack order in the top-right column (top → bottom): `🏔 goal-date` → `★ override` → `◉ workout` → `◎N baselines-due`. Max vertical stack ≈ 4 glyphs × 10 px = 40 px, fits inside a 55 px cell with 5 px slack.

**Why drop the border/bg tint**: with the bullseye's saturated red/white, an additional emerald wash double-encodes "done" in two competing colors. The bullseye is louder and more brand-consistent. The bg tint also visually shrinks cells — at 55 px wide every pixel of breathing room counts.

**Today's cell still gets**: gold border (`var(--accent)`) + low-alpha gold bg fill (`var(--accent-soft)`, ~12%) — to distinguish "you are here" from "completed".

---

## 5. Goal progress bullseye

Already covered in §2. Lifting the recommendation here for clarity:

- **Use ring fill, not wedge fill** (Option b in §2).
- Goal page rendering: `<Bullseye size={20} progress={pct} />` next to each goal title.
- `progress` is computed from existing target metadata (PRD §3.1.11). For goals with no targets, render `<Bullseye />` hollow.
- Discrete granularity (¼ steps) is acceptable — communicate per-goal progress to the user via the **numeric label** alongside the bullseye (already present: "2.5 / 5,200 ft cumulative gain"). The bullseye is a glance-level cue, not a precise readout.
- Color usage: hollow ring stroke is `var(--muted)`; filled rings are `var(--target)` red and `--target-fg` white — **same as logged-baseline bullseye**. Critical for motif consistency: a 50%-progress goal bullseye looks identical to a 50%-filled scenario in any other context.

---

## 6. Palette WCAG AA validation

I computed contrast ratios for every proposed pair using the WCAG 2.1 formula. Failures fixed inline.

### Required thresholds

- Body text on background: **≥ 4.5 : 1** (AA normal text)
- UI primitives / large text / non-text contrast: **≥ 3 : 1**
- Accent text on accent fill: **≥ 4.5 : 1** (treat as body text since labels live there)

### Computed ratios — Dark mode

| Pair | Ratio | Pass? |
|---|---:|:---:|
| `--foreground #F4E9D4` on `--background #0F0B07` | 16.29 | PASS body |
| `--muted #9C8866` on `--background #0F0B07` | 5.72 | PASS body |
| `--muted #9C8866` on `--card #1A130C` | 5.36 | PASS body |
| `--accent-fg #0F0B07` on `--accent #D4A437` | 8.56 | PASS body |
| `--accent #D4A437` on `--background #0F0B07` (text/icon) | 8.56 | PASS body |
| `--target #C0392B` on `--background #0F0B07` | 3.60 | PASS UI / **fail body** |
| `--target #C0392B` on `--card #1A130C` | 3.38 | PASS UI / fail body |
| `#FFFFFF` on `--target #C0392B` (white target ring) | 5.44 | PASS body |
| `--success #7FA45C` on `--background #0F0B07` | 6.88 | PASS body |
| `--warning #E0A95C` on `--background #0F0B07` | 9.33 | PASS body |
| `--foreground #F4E9D4` on `--card #1A130C` | 15.28 | PASS body |

**Dark-mode verdict**: all body-text and UI-primitive pairs pass. The only sub-4.5 pair is `--target` on background/card. That's **fine** — `--target` is a fill color (bullseye red disc, error block bg), not a text color. When errors render, the text is `--foreground` cream on a `--target/10` tint, which has ~16:1 contrast. **No changes to dark palette needed.**

### Computed ratios — Light mode

| Pair | Ratio | Pass? | Action |
|---|---:|:---:|---|
| `--foreground #1F1408` on `--background #FAF3E3` | 16.35 | PASS | keep |
| `--muted #7A5E3A` on `--background #FAF3E3` | 5.44 | PASS | keep |
| `--muted #7A5E3A` on `--card #FFFBF0` | 5.82 | PASS | keep |
| `--accent-fg #FFFBF0` on `--accent #A87A1F` | **3.71** | **FAIL body** | **fix** |
| `--accent #A87A1F` on `--background #FAF3E3` (icon/text) | **3.47** | PASS UI / **fail body** | **fix** |
| `--target #A82A1F` on `--background #FAF3E3` | 6.30 | PASS | keep |
| `--target #A82A1F` on `--card #FFFBF0` | 6.73 | PASS | keep |
| `--success #5C7A40` on `--background #FAF3E3` | **4.40** | **FAIL body** (just under) | **fix** |
| `--warning #B8741C` on `--background #FAF3E3` | **3.42** | PASS UI / **fail body** | **fix** |
| `#FFFBF0` on `--target #A82A1F` (white ring) | 7.54 | PASS | keep |

### Adjusted light-mode hex values

I tested darker variants; recommend the following **drop-in replacements**:

| Token | Old hex | **New hex** | New ratio | Improvement |
|---|---|---|---:|---|
| `--accent` | `#A87A1F` | **`#8A6212`** | 5.29 vs `--accent-fg` `#FFFBF0` | passes body; deeper antique-gold |
| (also: `--accent` on bg) | (3.47) | (now 4.96) | passes for icons used as text/glyphs |
| `--success` | `#5C7A40` | **`#4E6B36`** | 5.46 on bg | passes body |
| `--warning` | `#B8741C` | **`#9C5F14`** | 4.68 on bg | passes body |

### Final adjusted palette

**Dark (default) — UNCHANGED**
| Token | Hex | Role |
|---|---|---|
| `--background` | `#0F0B07` | deep coal |
| `--foreground` | `#F4E9D4` | cream parchment |
| `--muted` | `#9C8866` | weathered ochre |
| `--card` | `#1A130C` | lifted coal |
| `--border` | `#3A2E1F` | dark gilt |
| `--accent` | `#D4A437` | nugget gold |
| `--accent-fg` | `#0F0B07` | deep coal |
| `--accent-soft` | `rgba(212,164,55,0.12)` | tinted bg |
| `--target` | `#C0392B` | barn red |
| `--target-fg` | `#FFFFFF` | white ring |
| `--success` | `#7FA45C` | moss/sage |
| `--warning` | `#E0A95C` | ochre |
| `--danger` | `#C0392B` | unified with target |

**Light — ADJUSTED**
| Token | **Hex** | Role | Changed |
|---|---|---|---|
| `--background` | `#FAF3E3` | cream parchment | — |
| `--foreground` | `#1F1408` | near-black ink | — |
| `--muted` | `#7A5E3A` | weathered umber | — |
| `--card` | `#FFFBF0` | lifted parchment | — |
| `--border` | `#D9C8A2` | aged paper | — |
| `--accent` | **`#8A6212`** | deep antique gold | **darkened from `#A87A1F`** |
| `--accent-fg` | `#FFFBF0` | cream | — |
| `--accent-soft` | `rgba(138,98,18,0.14)` | tinted bg | adjusted to match new accent |
| `--target` | `#A82A1F` | barn red | — |
| `--target-fg` | `#FFFBF0` | cream | — |
| `--success` | **`#4E6B36`** | pine green | **darkened from `#5C7A40`** |
| `--warning` | **`#9C5F14`** | burnt umber | **darkened from `#B8741C`** |
| `--danger` | `#A82A1F` | barn red | — |

### Recommendation

**Ship the adjusted light-mode hex values above.** Dark mode passes as proposed. Update PRD §5.1's light-mode table with the three changed tokens.

The Tech Lead should add to the QA grep checklist: `grep -rn "#A87A1F\|#5C7A40\|#B8741C" src/ public/` returns zero matches before merge (these are the *unfixed* values).

---

## 7. Wordmark font

**Candidates**: DM Serif Display, Playfair Display, IM Fell English. Target render: "Goaldmine" at 20–24 px in the AppHeader on a 390 px viewport.

### Comparison criteria

1. **"ld" ligature / pairing** — do the lowercase `l` and `d` set cleanly?
2. **Weight at small size** — does it stay readable at 20 px or get spindly?
3. **Fits in 390 px header** — wordmark + logo (28 px) + `[import]`-style action button must coexist
4. **Brand fit** — Colorado gold-rush, mining, antique-stamp aesthetic

### Visual ASCII representations (best-effort at 24 px sizing)

**DM Serif Display** (high-contrast modern serif, geometric)
```
  G o a l d m i n e        ← G has tight curl, oa pair fluid
  └─tall─cap─┘              ← stroke contrast: thick verticals, hairline horizontals
  weight at 20px: solid; hairlines start to thin but don't vanish
  brand fit: editorial-elegant; less "Old West", more "luxury magazine"
```

**Playfair Display** (transitional, high-contrast, slightly Didone)
```
  G o a l d m i n e        ← G has open bowl + spur
  └────tall and broad──┘    ← weight feels heavier than DM at same px size
  weight at 20px: very solid, almost too dense; readable
  brand fit: classy/Victorian; closer to "saloon poster" than DM
```

**IM Fell English** (revival of 17th-century type, irregular, antique)
```
  G ó a l d m i n e        ← organic, slightly off-axis baseline
  └──irregular weight────┘  ← uneven stroke, "letterpress" feel
  weight at 20px: noisy; fine details read as artifacts
  brand fit: ★★★★★ — best Old-West / antique fit
  legibility at 20px: ★★ — texture overwhelms small sizes
```

### Width measurement (approximate, 1em = 24 px, 9 chars "Goaldmine")

| Font | Width @ 24 px | Fits header? |
|---|---:|---|
| DM Serif Display | ~135 px | yes (header has ~280 px after 28 px logo + 16 px action margin) |
| Playfair Display | ~145 px | yes |
| IM Fell English | ~150 px | yes — but with visible noise |

All three fit. The constraint is **legibility + brand fit**, not space.

### "ld" ligature check

None of the three sets a true `ld` ligature. All set `l` + `d` as separate glyphs. The lowercase `l` in DM Serif Display has a pronounced foot-serif that visually separates from `d` cleanly. Playfair's `l` is similar but heavier. IM Fell's `l` and `d` both have idiosyncratic curls that compete at 20 px.

### Recommendation

**DM Serif Display, weight 400, with `font-feature-settings: "ss01"` if available.**

**Why**:
- Cleanest at 20–24 px on phone
- Hairlines stay visible without becoming spindly (next/font hosting + subpixel AA helps)
- Geometric serif balances the procedural SVG logo (matching geometric vibe)
- Loads as one weight via `next/font/google` (zero perf cost beyond Geist)
- Brand fit is "editorial gold-rush ledger" — close enough to Old West without leaning kitsch
- Playfair is the runner-up; if the developer agent finds DM renders poorly on a specific device, swap to Playfair (same prop shape, single import line change)
- IM Fell is rejected for legibility at small sizes — it's the right *vibe* but the wrong *resolution*

**Implementation hint for the developer**:

```ts
import { DM_Serif_Display } from "next/font/google";
const dmSerifDisplay = DM_Serif_Display({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});
```

Add `${dmSerifDisplay.variable}` to the `<html>` className alongside Geist, then add `--font-display: var(--font-dm-serif-display)` mapping in `globals.css` `@theme inline` block.

---

## 8. Empty-state copy

**Constraint**: 1–2 lines each, max. Mining metaphor light, never heavy. Direct-coach voice. No emoji.

### Today (no program seeded)

> **No active program.** Set up your 12-week plan to start logging.
>
> *(small action button: "Seed program")*

### Records (no baselines logged)

> **No baselines on the books yet.**
> Log your first test to start tracking what's improving.

### Goals (no goals)

> **Nothing to aim at yet.**
> Add a goal — a date, a metric, or both.

### Journal (no notes)

> **The journal's clean.**
> Drop a note here for instructions, feelings, or tomorrow's reminder.

### Calendar (no completed days)

> **No completed days this month.**
> Logged workouts and overrides will land here as filled targets.

### Why these specifically

- **No "nothing in the mine"** literal phrases — that's the metaphor showing too much.
- **"On the books"** for Records uses a ledger feel (gold-rush adjacent without forcing it).
- **"Aim at"** for Goals nods to bullseye motif without saying "target".
- **"Filled targets"** in Calendar onboards the bullseye semantic the user will see.
- **"Drop a note here"** in Journal is direct and operational; the journal is the most utilitarian view.
- Each ends with a **next action** or actionable phrase.
- Length: 6–14 words for line 1; 8–14 for line 2. Fits inside a single `<Card>` body at 390 px without wrap chaos.

### Recommendation

Ship as written above. The Tech Lead should treat each as a literal copy block; the developer agent should put each behind a constant in the relevant page component (no need for an i18n abstraction — single-user app).

---

## 9. Animation / interaction

**Constraint**: CSS-only transitions, respects `prefers-reduced-motion`, no JS animation libraries.

### Should logging a baseline trigger a bullseye-fill animation?

**Yes, but minimally.** The interaction is meaningful — the user just hit a target. A one-shot fill animation reinforces the brand metaphor at the moment of accomplishment.

**Proposed animation**:

- Trigger: `LogBaselineInlineForm` submission resolves successfully → component re-renders with `<Bullseye filled />`.
- Effect: The Bullseye fades in its filled rings via a 320 ms scale + opacity transition.
- CSS:
  ```css
  @keyframes bullseye-pop {
    0%   { transform: scale(0.6); opacity: 0; }
    60%  { transform: scale(1.08); opacity: 1; }
    100% { transform: scale(1.0); opacity: 1; }
  }
  .bullseye-pop { animation: bullseye-pop 320ms cubic-bezier(0.16, 1, 0.3, 1) both; }

  @media (prefers-reduced-motion: reduce) {
    .bullseye-pop { animation: none; }
  }
  ```
- Implementation: Add `bullseye-pop` className conditionally in `BaselineBlockCard` based on a `justLogged` flag (the existing inline form already navigates on submit; expose a flag).
- Single-element animation, no layout thrash, runs once on mount of the filled state.

### Should the completed-day dot pulse?

**No — leave it static.** The calendar is a scanning surface; pulsing dots compete with each other when multiple days are completed in the same view. Static reads cleaner and is the more grown-up design choice.

If we wanted a "celebration" cue, restrict it to **today's cell** when it transitions from incomplete → complete — but that's nice-to-have and out of scope for this PRD.

### Other interactions worth considering

| Interaction | Animation? | Reason |
|---|:---:|---|
| BottomNav active indicator (bullseye dot) | No animation on tab change | Tab navigation is full-page route change; dot appears with route render |
| Goal-progress bullseye on `/goals` | No | Static; users will visit and leave without a "tick up" moment |
| AppHeader logo on page load | No | Persistent component; should not animate on every navigation |
| Error block reveal | Existing transitions only | No new motion |
| Calendar today-border | No | Static |

### `prefers-reduced-motion` policy

- All new animations (just the one bullseye-pop) gated by:
  ```css
  @media (prefers-reduced-motion: reduce) {
    .bullseye-pop { animation: none; }
  }
  ```
- Existing transitions (`transition-colors`) on tabs, links, cards: unchanged. These are imperceptible state changes, not motion.
- Document the `reduced-motion` rule in a comment in `globals.css` next to the keyframes block — makes the policy visible to future agents.

### Recommendation

**One animation total: bullseye-pop on baseline log success.** Everything else stays static. Document the reduced-motion gate. Treat it as an MVP polish — if the developer agent finds the wiring (passing `justLogged` from form to card) too invasive, ship without the animation; it's a stretch goal.

---

## Appendix A — Component hierarchy + prop shapes

For the Sonnet developer agent. These are exact prop shapes to ship; no re-derivation needed.

### `<Logo />` — `src/components/Logo.tsx` (server component)

```tsx
interface LogoProps {
  size?: number;        // px, default 32
  className?: string;
  title?: string;       // accessibility label, default "Goaldmine"
}

// Renders inline <svg viewBox="0 0 64 64" width={size} height={size} role="img" aria-label={title}>
// Composition: see §1 layer order.
// Colors: fills reference --accent, --accent-fg, --target, --target-fg via inline `fill="var(--accent)"` etc.
```

Used in: `<AppHeader />`, PWA icon (`public/icon.svg` reuses the same shape but inlined as static SVG file).

### `<Bullseye />` — `src/components/Bullseye.tsx` (server component)

```tsx
interface BullseyeProps {
  size?: number;              // px, default 16
  filled?: boolean;           // default false
  progress?: number;          // 0..1; if set, overrides `filled`
  className?: string;
  'aria-label'?: string;
}

// Single <svg viewBox="0 0 32 32"> with internal logic that picks ring count by size.
// Render rules: see §2 table.
// All ring fills via CSS variables (--target, --target-fg, --muted).
```

Used in: `BaselineBlockCard` (size=14), `CalendarMonth` (size=10), `BottomNav` (size=6), `goals/page.tsx` (size=20).

### `<AppHeader />` — `src/components/AppHeader.tsx` (server component)

```tsx
interface AppHeaderProps {
  // none — fully static for MVP
}

// Renders a sticky-top slim header:
// <header className="sticky top-0 z-30 bg-[var(--background)]/95 backdrop-blur border-b border-[var(--border)]">
//   <div className="max-w-md mx-auto h-12 flex items-center px-4 gap-2">
//     <Logo size={28} />
//     <span className="font-display text-xl tracking-tight">Goaldmine</span>
//   </div>
// </header>
//
// font-display class maps to var(--font-display) (DM Serif Display).
// Height: 48 px. AppHeader does NOT push down the BottomNav.
// `<main className="pb-20">` already exists; add `pt-12` if header is sticky-overlay vs flow.
```

Used in: `src/app/layout.tsx` once, above `<main>`.

---

## Appendix B — Files-to-touch summary by stream

Streams that can run **in parallel** by separate Sonnet agents (where data dependencies allow).

### Stream 1 — Palette & tokens (foundation; blocks others)

- `src/app/globals.css` — replace palette per §6 final tables; add `--target`, `--target-fg`, `--success`, `--warning`, `--danger`, `--accent-soft`, `--font-display` (CSS variable, value set by `next/font` in layout)
- `src/app/layout.tsx` — wire `DM_Serif_Display` via `next/font/google`, add `${dmSerifDisplay.variable}` to `<html>`, update metadata (`title`, `description`), update `viewport.themeColor` to `#0F0B07`, render `<AppHeader />`

### Stream 2 — Brand components (consume Stream 1's tokens)

- `src/components/Logo.tsx` (new) — see Appendix A
- `src/components/Bullseye.tsx` (new) — see Appendix A
- `src/components/AppHeader.tsx` (new) — see Appendix A
- `public/icon.svg` (new) — static SVG version of the Logo, square, viewBox 0 0 512 512 (or 64), PWA-ready
- `public/icon-192.png`, `public/icon-512.png` (new, optional) — generated from `icon.svg` via `scripts/render-icons.ts`. **PRD acceptable fallback**: ship SVG-only.
- `public/manifest.webmanifest` — update `name`, `short_name`, `description`, `theme_color`, `background_color`, add SVG icon entry

### Stream 3 — Motif consumers (depend on Stream 2's `<Bullseye />`)

- `src/components/BaselineBlockCard.tsx` — replace `text-emerald-500 ✓` with `<Bullseye filled size={14} />`; add hollow `<Bullseye size={14} />` for unlogged tests; recolor logged-value `text-emerald-500` to `var(--success)`
- `src/components/CalendarMonth.tsx` — drop `border-emerald-500/40 bg-emerald-500/5` tone; replace green ✓ glyph with `<Bullseye filled size={10} />`; recolor `text-amber-500 ★` to `text-[var(--warning)] ★`; recolor `border-amber-500/50 bg-amber-500/5` override-day tone to `border-[var(--warning)]/50 bg-[var(--warning)]/5` or similar token
- `src/components/BottomNav.tsx` — render `<Bullseye filled size={6} />` above the label of the active tab; both active and inactive labels stay text-only; active uses `text-[var(--accent)]`, inactive `text-[var(--muted)]`
- `src/app/goals/page.tsx` — render `<Bullseye progress={pct} size={20} />` next to each goal title; recolor `border-red-500/40 text-red-500` → `border-[var(--danger)]/40 text-[var(--danger)]`; `border-amber-500/40 text-amber-500` → `border-[var(--warning)]/40 text-[var(--warning)]`

### Stream 4 — Color migration sweep (independent of Streams 2/3)

Migrate all hardcoded Tailwind hue classes to CSS variable tokens. Run `grep -rn "text-red-500\|text-amber-500\|text-emerald-500\|border-red-500\|border-amber-500\|border-emerald-500\|bg-red-500\|bg-amber-500\|bg-emerald-500" src/` and migrate every match.

Likely files (per PRD §4.4):

- `src/components/PlanChangelog.tsx`
- `src/components/SnapshotView.tsx`
- `src/app/days/[dateKey]/page.tsx`
- `src/app/baselines/page.tsx`
- `src/app/calendar/page.tsx`
- `src/app/goals/[id]/plan/page.tsx`
- `src/app/goals/[id]/revisions/[revisionId]/page.tsx`
- All `src/components/*Form*.tsx` — error blocks, focus rings

Migration table:

| Hardcoded class | Token replacement |
|---|---|
| `text-red-500` | `text-[var(--danger)]` |
| `bg-red-500/10` | `bg-[var(--danger)]/10` |
| `border-red-500/30` | `border-[var(--danger)]/30` |
| `text-amber-500` | `text-[var(--warning)]` |
| `border-amber-500/40` | `border-[var(--warning)]/40` |
| `text-emerald-500` | `text-[var(--success)]` |
| `border-emerald-500/40` | `border-[var(--success)]/40` |
| `bg-emerald-500/5` | `bg-[var(--success)]/5` |
| `text-blue-*` (any) | `text-[var(--accent)]` |
| `#2563eb`, `#60a5fa` (raw hex) | `var(--accent)` |

### Stream 5 — Copy & assets

- Empty-state copy (per §8) into the relevant pages: `src/app/page.tsx` (Today), `src/app/baselines/page.tsx`, `src/app/goals/page.tsx`, `src/app/journal/page.tsx`, `src/app/calendar/page.tsx`
- Cleanup: delete `public/next.svg`, `public/vercel.svg`, `public/file.svg`, `public/globe.svg`, `public/window.svg` after grep confirms zero references

### Stream 6 — Animation polish (stretch, can ship later)

- `src/app/globals.css` — add `@keyframes bullseye-pop` + `prefers-reduced-motion` gate
- `src/components/BaselineBlockCard.tsx` — apply `bullseye-pop` className on the freshly-logged Bullseye (requires plumbing a `justLogged` flag; ship without if it's invasive)

---

## Appendix C — QA grep checklist (lifted into PRD §8)

```sh
# Should all return zero matches before merge:
grep -rn "Workout Planner" src/ public/
grep -rn "text-red-500\|text-amber-500\|text-emerald-500\|border-red-500\|border-amber-500\|border-emerald-500\|bg-red-500\|bg-amber-500\|bg-emerald-500" src/
grep -rn "#2563eb\|#60a5fa" src/ public/
grep -rn "#A87A1F\|#5C7A40\|#B8741C" src/ public/   # un-fixed light-mode hex from initial PRD draft

# Should exist:
grep -n "Goaldmine" public/manifest.webmanifest
grep -n "DM_Serif_Display\|Playfair_Display" src/app/layout.tsx
grep -n "AppHeader" src/app/layout.tsx
test -f public/icon.svg
test -f src/components/Logo.tsx
test -f src/components/Bullseye.tsx
test -f src/components/AppHeader.tsx
```

---

/Users/ggronnii/Development/workout-planner/docs/ux-research/goaldmine-rebrand.md
