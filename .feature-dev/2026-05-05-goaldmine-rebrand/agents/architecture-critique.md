# Goaldmine Rebrand — Architecture Critique (Devil's Advocate)

**Author**: Devil's Advocate Agent
**Date**: 2026-05-05
**Scope**: `architecture-blueprint.md` v1
**Verdict** (also at end): see Summary.

Each finding is tagged Blocker / Concern / Suggestion. Citations are file:line.

---

## A. Spec gaps in component contracts

### A1. `<Bullseye>` precedence rule between `filled` and `progress` is implicit only — Blocker

`Bullseye.tsx` skeleton (blueprint:307–377) and the prop signature say: `progress` (when set) overrides `filled`. The blueprint comment at `Bullseye.tsx:329` repeats this, but the **acceptance contract** in §C.2.2 (blueprint:380–385) does not call out: what happens when both `filled={true}` and `progress={0}` are passed? Current implicit rule: `progress` wins → renders hollow. But the prop name `filled` is asserting truth — a future caller will hit this and be surprised.

**Why it matters**: BottomNav passes `filled` (no `progress`) — fine. Goals page passes `progress` only — fine. But the type signature allows both, and TypeScript will not flag it. Two future bugs:
- A developer copy-pastes a `<Bullseye filled progress={pct} />` pattern, expecting "filled when progress is full, else partial".
- The Storybook-style coverage matrix never tests the both-set state.

**Fix**: Add to §C.2.2 acceptance: "If `progress !== undefined`, `progress` is authoritative and `filled` is ignored — log a `console.warn` in dev when both are set with conflicting values (filled=true, progress<1)." Or better: make the prop union type-exclusive: `{ filled: boolean } | { progress: number }`. Recommend the union at the type level.

### A2. `<Bullseye size={n}>` boundary behavior at extreme values — Concern

Blueprint render rules (blueprint:336–352) cover sizes 6 / 10 / 14 / 20+. **What happens at size=4 or size=2** (e.g., a future tight UI)? **What about size=200** (PNG icon use case)? The viewBox is fixed `0 0 32 32`, so geometry scales proportionally — but the *ring count selection* logic uses size buckets. The skeleton comments say `size 20+` → 4-ring canonical; presumably size=200 falls into the same bucket. But size=4 is undefined.

**Fix**: Add a sentence to §C.2.2: "For `size < 6`, fall through to the `size=6` branch (single disc); for `size > 20`, fall through to the `size=20+` branch (full canonical). Document in component comment." This prevents a developer guessing.

### A3. `<Logo>` mandatory-vs-optional dark outline on hero target — Blocker

UX §1 layer 8 (ux-research:131): "Optional: 1u dark outline around the hero target… **improves contrast on light-mode cream backgrounds.**"

The blueprint (blueprint:290) marks layer 8 as `(optional)` — but:
1. Light-mode `--background` is `#FAF3E3`, light-mode `--target` is `#A82A1F` → contrast ratio ~6.30:1, which already passes WCAG 3:1 for UI primitives (UX §6, table:531). The outline is **cosmetic**, not a contrast requirement.
2. But UX §6 only validated `--target` text/disc on flat backgrounds. The hero target sits with a r=8 white middle ring directly inside `#A82A1F` red — that pair is fine. The bigger issue is the outline itself: if the developer omits it, does the chest art still read at 28 px on light-mode cream?

**Why it matters**: The blueprint says the developer fills layers 1-8 from the skeleton. "Optional" is a punt — Agent 2 will ship without it and Agent 4/QA may discover at the last minute that the chest blends into cream backgrounds.

**Fix**: Replace "(optional)" with a deterministic rule: "Always render layer 8 (`r=11.5 stroke=var(--accent-fg) stroke-width=0.5`) regardless of mode. The outline is invisible against dark `--accent-fg` on dark mode (matches the lid shadow), and load-bearing on light mode. Cost: 1 extra `<circle>` element."

### A4. `<Logo>` `viewBox 64` — chest gold (`var(--accent)`) on PWA install screens has no neutral substrate — Concern

UX §1 has the chest as "flat gold trapezoid" filled with `var(--accent)`. On the static `public/icon.svg` file (blueprint:420–432), CSS variables don't resolve — the blueprint specifies literal hex `#D4A437` (dark mode chest gold). On iOS PWA install grid, the icon background is OS-determined (often white-ish). A `#D4A437` chest on white has ~2.0:1 contrast — **insufficient as a UI primitive even though it's a brand mark, not a UI element**.

**Fix**: Specify a 1px outline or a transparent-to-coal margin in the static `icon.svg` so the chest reads against arbitrary backgrounds. Or leverage the `purpose: "any maskable"` manifest entry: ensure the icon has a 10% safe-area margin filled with `--background` `#0F0B07` so the OS mask crops correctly.

### A5. `<AppHeader>` no-prop / static API — Suggestion

§B.7 (blueprint:152–154) decides "no slot for now" — fine. But the prop type is implicit. Since this is a server component, future callers wanting a right-side action button will be tempted to add `children` then break stickiness/h-12 invariants.

**Fix**: Type the component as `function AppHeader(): JSX.Element` (no props at all, not even `{}`) so misuse is a TS error. One line.

---

## B. CSS variable + Tailwind v4 traps

### B1. `bg-[var(--accent-soft)]/12` would compose alpha-on-alpha — VERIFIED, blueprint avoids it (no finding)

Searched the blueprint for `bg-[var(--accent-soft)]/`: no occurrences. The blueprint uses `bg-[var(--accent-soft)]` (bare, no alpha modifier). Good — `--accent-soft` already bakes 0.12 / 0.14 alpha into the rgba. The blueprint is correct here. **No finding.**

But: the existing source at `CalendarMonth.tsx:39` uses `bg-[var(--accent)]/10`, which is fine because `--accent` is solid. This same pattern reappears in §C.4.2 (blueprint:546) — "today's cell still distinguishable (gold border + low-alpha gold bg)." **No finding** on this line either.

### B2. `bg-[var(--success)]/5` in Tailwind v4 — Concern

Research §8 (research:404–408) claims the alpha modifier on arbitrary-value CSS-variable colors works in Tailwind v4 via `color-mix(in srgb, var(--x) <alpha>%, transparent)`. The Tailwind v4 docs (`node_modules/tailwindcss/...`) need verification — but the existing repo uses `bg-[var(--accent)]/10` (CalendarMonth:39), which means this **already works in production**. So the assertion is empirically validated.

**However**: `bg-emerald-500/5` (the *original* tone class) compiled to a 5% emerald tint that is a baked-at-build-time `rgba(16, 185, 129, 0.05)`. The new `bg-[var(--success)]/5` compiles to `color-mix(in srgb, var(--success) 5%, transparent)`. **These are not the same color**:
- Old: 5% of emerald-500 at full saturation.
- New: 5% of `--success` (which is `#7FA45C` dark / `#4E6B36` light).

The hue is different (emerald-500 = `#10B981` is much greener-cyan; `--success` is olive-sage). The old tone was an accidental green wash; the new tone will be more olive. Visually fine, but **not a 1:1 swap**. The blueprint claims migration is "swap the token" and acceptance is grep-only — there's no visual diff check.

**Fix**: Add to QA in §E (blueprint:723): "Visually inspect every `bg-[var(--success)]/5` site at 390 px in both modes; the previous emerald-500 tint was deliberately near-invisible (5%), the new olive-sage at 5% may read dirtier on cream. If too muddy, raise to /8 or /10." Currently affected sites per research §2: `BaselineBlockCard:46` (logged-value text — wait, that's `text-`, not `bg-`), `CopyPromptButton:17`, `CalendarMonth:40` (being deleted), `baselines/page:178`. The visible bg-tinted-success site is essentially gone after the rebrand, so this is **low risk**. But document it.

### B3. `var(--font-display)` propagation into AppHeader — Blocker

This is a real bug.

The blueprint:
- Adds `--font-display: var(--font-dm-serif-display);` to `@theme inline` in globals.css (blueprint:648).
- AppHeader uses `style={{ fontFamily: "var(--font-display)" }}` (blueprint:402–404).

The chain works **only if** `--font-dm-serif-display` is set on `<html>`. The layout edits (blueprint:194) say: append `${dmSerifDisplay.variable}` to `<html className>`. `next/font/google`'s `dmSerifDisplay.variable` returns the **class name** that contains the CSS variable declaration (e.g., `__variable_abc123`). The variable name itself is what we passed to `DM_Serif_Display({ variable: "--font-dm-serif-display", ... })`.

So:
1. `<html>` gets a class like `__variable_xyz` which contains a `--font-dm-serif-display: 'DM Serif Display', __font-fallback;` rule.
2. `globals.css` `@theme inline` declares `--font-display: var(--font-dm-serif-display)`.
3. `AppHeader` reads `var(--font-display)` → resolves to `var(--font-dm-serif-display)` → resolves to `'DM Serif Display'`.

**This works.** ✓

**However**, here's the trap: `@theme inline` creates the **Tailwind utility** `font-display` (blueprint claims this in §B.3, blueprint:111). But the AppHeader uses `style={{ fontFamily: ... }}` instead of the utility class. The two paths produce the same result, but using `style` bypasses Tailwind's tree-shaking. **Cosmetic, not a bug.**

The actual concern: **what if `next/font/google` fails to fetch DM Serif Display at build time?** Blueprint Risk 2 (line 708) acknowledges this — the fallback is "swap to Playfair Display in one line." **But** the swap requires editing `layout.tsx` AND `globals.css` (the `--font-dm-serif-display` reference). Risk 2 says "one line" — that's wrong; it's two files. Document.

**Also**: a `font-display` Tailwind utility from `@theme inline` and the variable `--font-dm-serif-display` from `next/font` — these are not the same name. Tailwind v4's `@theme inline { --font-display: ...; }` generates `.font-display { font-family: var(--font-display); }`. There's no collision. ✓

**Net finding**: The chain works, but the fallback claim ("one-line swap") is wrong. **Concern**, not blocker.

**Fix**: Update blueprint Risk 2 to say "swap requires edits in TWO files: `layout.tsx` (font import + variable name) AND `globals.css` (`--font-dm-serif-display` → `--font-playfair-display` in the `@theme inline` mapping)."

### B4. `body { font-family: var(--font-sans), ... }` strips system-ui fallback — Concern

Compare existing `globals.css:40` with blueprint:672:
- Existing: `font-family: var(--font-sans), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;`
- Blueprint: `font-family: var(--font-sans), system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;`

Different fallback chains. Not bug-bug, but a **silent regression on iOS PWA** if `next/font` fails (the swap font becomes `system-ui` which on iOS is San Francisco — fine, but `BlinkMacSystemFont` was the explicit Apple font key). Why is the blueprint changing the body fallback chain at all? PRD says "no functional changes."

**Fix**: Keep the existing fallback chain verbatim (`-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`). Do not touch unless palette/font wiring requires it. (It doesn't.)

### B5. Missing `-webkit-tap-highlight-color: transparent` and input-family inheritance — Blocker

The existing globals.css has at lines 41 and 44–48:
```css
-webkit-tap-highlight-color: transparent;
input, textarea, select, button { font-family: inherit; }
```

The blueprint's literal §D rewrite (blueprint:619–693) **omits both rules**. Blueprint's note at line 699 says "If the existing globals.css has additional rules… preserve them by appending after the bullseye-pop block. Re-read the file before overwriting." But the literal contents in §D are presented as the **complete** file. Agent 1's acceptance check is "replace entire file with the literal content in §D" (blueprint:167). Agent 1, executing literally, will delete both rules.

Consequences:
- Tap-highlight: iOS users get a gray flash on every link tap. Visible regression, especially on the Logo + wordmark and BottomNav.
- Input font inheritance: Form inputs revert to browser default (Helvetica/Times) — visible regression in every Log/Edit form.

**Fix**: Either (a) the §D rewrite is amended to include the two missing rules (preserving them inside the new file), or (b) Agent 1's instruction is sharpened: "Append §D's contents while preserving existing `body` tap-highlight and `input/textarea/select/button` font inheritance rules — do not delete them." Recommend (a) — make §D the **literal complete file** by adding the two missing blocks back.

---

## C. CalendarMonth visual integrity

### C1. Today's gold border + gold tint vs neighboring red bullseye — Concern

After rebrand, today's cell is `border-[var(--accent)] bg-[var(--accent)]/10` (gold border, ~10% gold bg). A completed-day cell is the default `border-[var(--border)] bg-[var(--card)]` with a tiny 10px red+white bullseye in the top-right.

At 55px cells:
- Today: gold border (~2px) + gold wash. **Strong visual signal.**
- Completed: neutral border + 10px red dot in corner. **Quieter signal.**

The hierarchy works **for distinguishing today from past-completed**, but: when today is also a completed day (e.g., the user logs at noon), today's cell shows: gold border + gold bg + red bullseye in top-right. **That's three competing color signals on one ~55×55px tile.** UX §4 (research:467) said "today still gets gold border + low-alpha gold bg fill … to distinguish 'you are here' from 'completed.'" — but UX did not address the today-AND-completed combo case explicitly.

**Why it matters**: the user logs an early-morning workout → today's cell now has gold-on-gold-on-red. Most days. This is the most-common visual on the calendar.

**Fix**: Decide explicitly:
- Option (a): when today and completed, drop the gold bg fill; keep only gold border + red bullseye.
- Option (b): keep all three; accept the visual density.
- Option (c): use the bullseye as today's "completed" stamp, drop the gold tint — gold border alone signals "today".

Recommend (a) or (c). Add to §C.4.2 acceptance: "test today + completed combo: visual density should not exceed 2 color signals on the cell."

### C2. `★` override star recolored to `--warning` (`#9C5F14` light) — Concern

Light-mode `--warning` is `#9C5F14` (burnt umber, very dark). On `--background` `#FAF3E3` cream, that contrast is ~4.68:1 (UX §6 confirms). **Reads as text, not as warning.** A burnt-umber star on cream looks like brown ink decoration, not a "this day is overridden" alert.

The existing `text-amber-500` (`#F59E0B`) was Tailwind amber — saturated orange-yellow. The new `--warning` light hex is brown by comparison. The semantic shift is "warning" → "antique stamp", which is intentional from the brand, but **the user has been habituated to amber=override for the existing app**.

**Why it matters**: existing user (single-user app) has muscle memory: amber star = override. Burnt umber is recognizable as a star but misses the "warning" affordance.

**Fix**: Either:
- Accept and document — "override star is now a brown stamp; intentional brand choice, less alarming." Add to PR description so user is unsurprised.
- Bump light `--warning` to a more saturated hue (e.g., `#B8741C` was the original, but it failed WCAG body — at 3.42:1 it still passes UI primitive 3:1, and the star is a UI primitive). Consider keeping the star at the higher-saturation amber while keeping body warning text at `#9C5F14`.

Recommend documenting the choice and watching for user feedback. **Concern, not blocker.**

### C3. `◎N` baselines-due glyph color is unaddressed — Blocker

`CalendarMonth.tsx:64` renders the multi-baseline glyph as `text-[var(--accent)]`. The blueprint §C.4.2 (blueprint:537–550) does NOT call out a change to line 63–67. The token swap auto-recolors it from blue (`#2563eb`) to gold (`#D4A437` dark / `#8A6212` light) — that's fine in dark, but **on light cream the dark antique gold `#8A6212` `◎N` glyph at 10px will be hard to read on the cream cell bg**.

10px text in `#8A6212` on `#FAF3E3` background has ~5.29:1 contrast (WCAG passes), but the `◎` glyph is *unicode* — visual weight depends on font rendering of "U+25CE BULLSEYE". At 10px it's already small; on cream at low contrast vs the surrounding card border it competes with the new red bullseye in the same stack.

**Why it matters**: the stack now contains `🏔` (emoji, color-rendered), `★` warning-brown, `◉` red-bullseye-component, `◎N` gold-antique-glyph. **Four different colors stacked vertically**, no visual hierarchy beyond stack order.

**Fix**: Either (a) recolor `◎N` to `--muted` (`#7A5E3A`) so the bullseye stays the loudest signal, or (b) keep at `--accent` but add a check in §C.4.2 acceptance for visual density at 390px. Recommend (a) — the gold motif lives on the active-tab Bullseye and the today border; the calendar baselines-due marker can step down.

### C4. CalendarMonth line 42 override `bg-[var(--warning)]/5` light-mode — Concern

Migrated tone: `border-[var(--warning)]/50 bg-[var(--warning)]/5`. Light-mode `--warning` is `#9C5F14` (brown). `bg-[#9C5F14]/5` ≈ a barely-visible brownish wash on cream. **This is fine** — it was already a barely-visible amber wash. But document.

---

## D. CalendarMonth goal-date emoji 🏔

### D1. Emoji rendering on `#0F0B07` dark background — Suggestion

🏔️ (U+1F3D4) on iOS renders as a multi-color emoji — gray mountain peak with white cap, often with a thin white halo on the OS-rendered glyph. On `#0F0B07` near-black background, the white cap reads cleanly. **No issue in dark mode.**

On light mode `#FAF3E3` cream — the emoji renders the same (OS-driven) but the white cap blends into cream. Mild legibility hit. **Not a blocker** — emoji is decorative, not load-bearing semantically.

**Fix**: None needed. If perfect, swap to a monochrome SVG mountain in `var(--accent-fg)` — but that's scope creep. Document as known minor degradation in light mode.

---

## E. BottomNav active indicator

### E1. Active label color in §C.4.3 vs UX §3 — VERIFIED, no finding

UX §3 (research:393): "label, var(--accent), font-medium" for active. Blueprint §C.4.3 (blueprint:570): "Active label: `text-[var(--accent)]`. Inactive: `text-[var(--muted)]`." **Match.** No finding.

But — the existing `BottomNav.tsx:35` already does this (`text-[var(--accent)]` active). **Question**: is the blueprint's edit a no-op for the label class? Yes — only the dot is being added. Worth noting that Agent 4 should not "fix" the existing class since it's correct.

### E2. Bullseye dot inside `<Link>` with current text-only label structure — Blocker

`BottomNav.tsx:32–39` currently has each tab as:
```tsx
<Link href={t.href} className="flex-1 text-center py-3 text-sm font-medium ...">
  {t.label}
</Link>
```

Single line, text-centered. The blueprint §C.4.3 (blueprint:558–568) says wrap in `<div className="flex flex-col items-center gap-1 pt-2">` — but doesn't say WHERE this div goes. Inside the `<Link>`? Replacing the link contents? Where does `text-center` go now?

Also: the existing nav cell is `py-3` (~12px top + 12px bottom + line-height ~20px = 44–48px tall). Adding a 6px dot above the label inside a `flex-col items-center gap-1 pt-2` (8px top + 6px dot + 4px gap + ~20px label = 38px content) means **the cell needs to grow OR shrink existing padding**. UX §3 (research:399–401) said "tab cell = 56 px tall" — but the existing cell is shorter than that.

**Why it matters**: an inactive tab has no dot. If the active tab has the dot inside a flex-col, the **active cell will be taller than inactive cells** unless padding is unified. The grid-cols-5 will stretch the row to match the tallest cell, leaving inactive cells with extra whitespace. Possibly fine, possibly looks broken.

**Fix**: Add to §C.4.3 explicitly:
1. Wrap the `<Link>` *children* in `<span className="flex flex-col items-center gap-0.5">` (replacing the bare `{t.label}`).
2. Active version conditionally renders the Bullseye above the label; inactive renders an invisible 6px-tall spacer (`<span className="h-[6px]" aria-hidden />`) so cell heights match.
3. Document final cell height target (e.g., 52px) and verify all tabs share it.

This is a real layout bug if shipped naively.

### E3. Dot color via `style={{ color: "var(--accent)" }}` vs class — Suggestion

Blueprint:563–566 sets dot color via inline style `color: "var(--accent)"`. The Bullseye component renders rings via fills like `fill="var(--target)"` — **the Bullseye does not consume `currentColor`**. So `style={{ color: "var(--accent)" }}` on the parent is a no-op for the Bullseye's red rings.

Wait — is the active dot supposed to be **red** (target) or **gold** (accent)? UX §3 (research:391) says "small filled bullseye (size=6) above the label, in `var(--accent)`" — gold. But the canonical Bullseye renders rings as `--target` red.

**Why it matters**: if Bullseye hardcodes `fill="var(--target)"` (per UX §2 anatomy spec), passing `color: var(--accent)` does nothing. The active-tab dot will be **red, not gold** — contradicting UX §3.

**Fix**: This is a real spec contradiction. Either:
- (a) Bullseye gains a `tone?: "target" | "accent"` prop (or accepts `currentColor` for fills) — adds API surface.
- (b) BottomNav uses a different primitive (a 6px filled circle with `bg-[var(--accent)]`) — abandons motif consistency.
- (c) UX §3's "in var(--accent)" is reinterpreted: the **label** is gold; the **dot** is the canonical red bullseye. UX §3 line 391 is ambiguous on which element gets the gold.

Recommend (c): clarify in §C.4.3 that "the dot uses canonical Bullseye colors (red/white target). The active label is `var(--accent)` gold. Remove the `style={{ color: ... }}` prop from the Bullseye usage in BottomNav."

**Blocker** — affects the most-visible motif on the most-visible chrome.

### E4. Tap target — VERIFIED, no finding

The Bullseye is 6px but the wrapping `<Link>` (the entire grid cell ~78×52px) is the click target. ✓

---

## F. PWA icon generation

### F1. `@resvg/resvg-js` in `dependencies` vs `devDependencies` — VERIFIED

Blueprint §B.1 (blueprint:99–103): adds `@resvg/resvg-js` to `devDependencies`. ✓ Correct.

### F2. Native binding install on agent worktrees — Concern

Each developer agent works in `worktrees/agent-N-<slug>/` per blueprint:66. **Each worktree has its own `node_modules/`**, so `npm install` runs separately. `@resvg/resvg-js`'s native bindings install via `optionalDependencies` per platform — on macOS arm64 (the dev box) this is fine. But:
- If the agent's worktree `npm install` fails on a different platform/arch, the icon-render script can't run.
- Agent 1 (foundation) and Agent 3 (color migration) don't run `npm install` for resvg — only Agent 2 does. So the failure scope is contained to Agent 2.

**Fix**: Document the fallback in §C.2.5: "If `@resvg/resvg-js` install fails, Agent 2 should: (1) generate PNGs on a different machine and commit, OR (2) fall back to SVG-only manifest (drop `/icon-192.png` and `/icon-512.png` icon entries) and document in PR." Currently the blueprint has no fallback — Agent 2 is stuck if install fails.

### F3. `Logo.tsx` (React-rendered, CSS-var fills) vs `public/icon.svg` (static, hardcoded hex) sync — Blocker

This is a real design problem.

`Logo.tsx` skeleton (blueprint:241–294) uses `var(--accent)`, `var(--target)` etc. Theme-flips light/dark.
`public/icon.svg` (blueprint:420–432) uses literal hex. Static.

When the `Logo` is later tweaked (e.g., the user requests a different chest shape next quarter), there is **no mechanism that ensures `public/icon.svg` and `scripts/render-icons.ts` outputs are updated**. They drift.

**Why it matters**: the PRD says brand identity, the icon IS the brand. A sync drift means the wordmark in-app no longer matches the PWA install icon — embarrassing and observable on every install.

**Fix**: Two options:
- (a) Single-source-of-truth: write a `scripts/build-logo.ts` that takes a logo geometry spec (TS object) and outputs both `Logo.tsx` (with var-based fills) AND `public/icon.svg` (with literal hex from the dark palette). Run it once in this PR. Future tweaks require running the script.
- (b) Document a "if you change Logo geometry, also re-render `public/icon.svg` and re-run `npm run icons`" rule in a comment at the top of `Logo.tsx`. Cheap; relies on memory.

Recommend (b) for MVP — this is a one-time rebrand. But add the comment **explicitly in the `Logo.tsx` file header** so a future agent sees it. Currently blueprint doesn't require this comment.

**Blocker on documentation**, not on code.

---

## G. Color migration scope

### G1. `BaselineBlockCard.tsx:46` is `text-emerald-500` on a logged numeric value — VERIFIED

Research §2 (research:131) confirms: "logged-value text" is correctly success-coded. Migration to `text-[var(--success)]` is semantically correct. **No false positive.** ✓

### G2. `bg-emerald-500/5` → `bg-[var(--success)]/5` opacity drift — see B2

Already covered in B2 above. The 5% alpha of two different hues ≠ same color. Acceptance is grep-only; no visual diff check. **Concern.**

### G3. `CopyPromptButton.tsx:17` "copied!" feedback — VERIFIED

The "copied!" state is a transient success cue. `border-emerald-500/40 text-emerald-500` → `--success` tokens — correct. But: at light mode, `--success` is `#4E6B36` pine green. "Copied!" feedback in pine green on cream is **less visible** than emerald on cream. UX trade-off, but semantically right.

**Suggestion**: leave it but watch for user feedback. If users miss the copy success cue, bump the success hex saturation.

### G4. `goals/page.tsx:60-62` migration overlaps with Agent 4's work — Blocker

Blueprint §C.3 file table (blueprint:510): "src/app/goals/page.tsx (empty state ONLY — NOT lines 60/62) - REQ-E1 empty-state copy."

So Agent 3 only edits the empty state in goals/page.tsx, leaving lines 60/62 for Agent 4. That's the right division. **But** Agent 3 also needs to be told: don't add a new `<Bullseye>` import — that's Agent 4's job. The blueprint partition is implicit; Agent 3 reading just the file table will not know to leave imports alone.

**Fix**: Add to §C.3 prelude (blueprint:481): "When migrating to a file Agent 4 also edits, do NOT add new imports or modify lines outside the table. Agent 4 will add `<Bullseye>` imports and helper functions in Wave 3."

---

## H. Layout and AppHeader

### H1. Existing `<main className="flex-1 pb-20">` — no `pt-X` needed because sticky — VERIFIED

Research §9 (research:467–474) is correct: sticky elements participate in flow, no extra padding needed. ✓

### H2. AppHeader at 48px + Today page-level header at line 71 — Blocker

`src/app/page.tsx:70–96` already renders a `<header>` block with "Week 7 · Phase 2" subhead, "Tuesday, May 5" h1, and an inline `[+ Import]` link. After rebrand, **two stacked headers appear on Today**:

1. Sticky `<AppHeader>` (Logo + "Goaldmine" wordmark, 48px tall).
2. The page's own `<header>` with Week label + h1 + import link.

The blueprint §B.7 (blueprint:152–154) says: "The Today page's existing inline header row at `src/app/page.tsx:78` (with the `[import]` link) **stays untouched**." This is intentional — but visually two headers stacked is ugly. The `<AppHeader>` brand strip + the page's "Week 7 · Tuesday, May 5" + h1 + `[+ Import]` button = 48 + ~80 = **130px of header above the first block card** on a 844-px iPhone screen.

**Why it matters**: the user's first content (BaselineBlockCard) gets pushed down. On a 6.1" iPhone (844 logical px), 130px of header = 15% of viewport before any actionable content. Calendar/Records/Goals/Journal pages have similar two-header stacks. **Cumulative visual debt.**

**Fix**: One of:
- (a) Move the `[+ Import]` action into `<AppHeader>` as a right-side slot — kills §B.7's "no slot" decision but reclaims vertical space.
- (b) Demote page-level "Week 7 · Phase 2" + h1 from a full `<header>` to an inline tag-row — saves ~30px.
- (c) Accept the double-header for MVP, log a follow-up.

Recommend (b) for Today specifically — turn the h1 into something terse, since AppHeader is the new identity. But this is **functional UI change** which the PRD said was out of scope. So default to (c): accept and document.

**Concern, downgraded from blocker since the PRD's "no functional changes" rule conflicts with fixing this.**

### H3. Wordmark "Goaldmine" in DM Serif Display 24px — width — VERIFIED

UX §7 (research:633): wordmark width ≈ 135px at 24px. Logo (28px) + 8px gap + 135px = 171px. Header inner = 358px (390 - 32 padding). Fits with 187px to spare. ✓ But:

The blueprint AppHeader uses `text-xl` which is **20px**, not 24px. Wordmark width at 20px is closer to ~115px. Still fits comfortably. ✓

### H4. AppHeader on landscape / iPad widths — Concern

`<AppHeader>` uses `max-w-md mx-auto` (28rem = 448px). On iPad portrait (768px) or landscape phones (≥640px), the AppHeader content is centered in a 448px column with empty space either side. **Visually awkward** — the brand strip looks orphaned on wide screens.

Existing pages also use `max-w-md` containers, so the convention is "phone-only design", but the AppHeader is now **part of the chrome on every viewport** including stats charts that benefit from wider screens.

**Fix**: Either:
- (a) Drop `max-w-md` from AppHeader's inner div — let the brand strip span the full viewport on wide screens.
- (b) Document that this app is phone-only and any wide-viewport rendering is unsupported.

Recommend (a). One-line change in AppHeader. **Suggestion.**

---

## I. Empty-state copy ambiguity

### I1. Records page empty state — when does it actually show? — Blocker

`src/app/baselines/page.tsx:42–44` shows "No active plan. Create a goal to get a scheduled test list." when `schedule.scheduled.length === 0`. The blueprint §B.6 copy is "**No baselines on the books yet.** Log your first test to start tracking what's improving."

**Mismatch**: the existing condition is "no plan / no scheduled tests" — not "no baselines logged". They are different conditions. A user with an active plan but zero logged tests still has scheduled tests (`schedule.scheduled.length > 0`) — so the new copy never renders if Agent 3 swaps the existing string verbatim.

The blueprint doesn't specify which condition the new copy gates on. Agent 3 will swap the string at line 43 and ship — wrong semantics.

**Fix**: §B.6 must be more precise:
- "Show this copy when `schedule.scheduled.length === 0` AND there are zero results across `schedule.scheduled[*].latestResult` AND `schedule.unscheduledExtras.length === 0`."
- Or: scope the copy to the condition the existing string used (no scheduled tests = no active plan), and rephrase the copy to match: "**No active plan.** Add a goal to schedule your baseline tests."

Recommend the second — keeps the `B.6` copy aligned with reality. Agent 3 needs an updated copy.

### I2. Journal empty state — `journal/page.tsx` already shows two cards — Blocker

`src/app/journal/page.tsx:32–37` always shows the "Log a note" card. The "Earlier notes" card (line 56–69) renders only when `olderNotes.length > 0`. There's no all-empty state currently — when there are zero notes, the page shows: header + "Log a note" card. **No "empty" message.**

The blueprint copy "**The journal's clean.** Drop a note here for instructions, feelings, or tomorrow's reminder." doesn't specify where to put it. Inside the "Log a note" card? As a new card above? When the pinned `pendingNotes` view is also rendered (line 39 condition)?

**Fix**: §B.6 must specify:
- Render condition: `allNotes.length === 0 && pending.count === 0` (or similar).
- Placement: as a `<p>` inside a new card above "Log a note", OR inline above the form, OR replace the "Earlier notes" card entirely.

Without this, Agent 3 will guess. **Blocker on spec.**

### I3. Today empty state needs an action — Blocker

§B.6 copy: "**No active program.** Set up your 12-week plan to start logging."

`page.tsx:18–24` currently shows a `<Card>` saying: `"Run npx prisma db seed to create the 90-day program."` — explicit instruction.

The new copy says "Set up your 12-week plan to start logging" — is there a button? The blueprint doesn't include one. The user can't *do* anything from the empty state — must read the new copy, remember the existing seed command, and run it in a terminal.

**Why it matters**: "Set up your 12-week plan" reads like an action exists. The PRD says "no functional changes" — so no new seed button. The copy IS misleading.

**Fix**: Either:
- (a) Restore the original `npx prisma db seed` instruction inside the card (keep technical for single-user app).
- (b) Add a button (functional change → out of scope).
- (c) Update §B.6 copy to: "**No active program yet.** Run `npx prisma db seed` to create the 90-day plan."

Recommend (c). **Blocker on copy.**

### I4. Goals empty state — VERIFIED

`goals/page.tsx:37` already shows "No goals yet. Add one above." — there IS a "New goal" form already on the page above. The blueprint copy "**Nothing to aim at yet.** Add a goal — a date, a metric, or both." is a clean swap. ✓

### I5. Calendar empty state — Concern

The calendar page renders the month grid even with zero completed days. There's no "empty" state per se — the grid is the content, and empty cells display the dates. The blueprint copy "**No completed days this month.** Logged workouts and overrides will land here as filled targets." is semantically a **legend caption** more than an empty state.

**Fix**: Either render only when `cells.every(c => c.workoutCount === 0 && !c.hasOverride)` OR render always as a quiet caption below the grid. Specify which.

---

## J. WCAG and accessibility

### J1. `--target` 3.60:1 in dark mode — VERIFIED, primitive only — no finding

Already noted in UX §6 (research:514). The blueprint Bullseye uses `--target` for fill (UI primitive, 3:1 threshold met). When `--target` becomes `--danger` in error blocks, text inside is `--foreground` cream on `--target/10` tint (~16:1) — fine.

### J2. `aria-current="page"` in BottomNav — VERIFIED in blueprint

Blueprint §C.4.3 (blueprint:572) requires it. ✓

### J3. AppHeader semantic structure — Suggestion

`<AppHeader>` uses `<header>` + `<span>Goaldmine</span>` (blueprint:401–406). This is a `role="banner"` landmark by default (top-level `<header>`). Each page provides its own `<h1>` — e.g., `journal/page.tsx:26` has `<h1>Journal</h1>`. ✓ Semantic structure is correct.

But: the wordmark "Goaldmine" is the **brand name**, not a heading. It should NOT be an h1. Using `<span>` is correct. **No finding** — the blueprint gets this right.

### J4. Bullseye `aria-label` vs `aria-hidden` — Concern

Blueprint Bullseye prop signature (blueprint:317–319) supports both `aria-label` and `aria-hidden`. Passing both produces an SVG that has both attributes. Accessibility tools may report this as an error (a11y rule: don't aria-hide an element that also has a label).

The skeleton at blueprint:356–360 handles it: "if aria-hidden OR no aria-label, set aria-hidden true". So if both are passed, aria-hidden wins. OK.

**But**: the consumer in BottomNav passes `aria-hidden` AND there's no aria-label — `aria-current="page"` on the parent Link carries the semantic. ✓

The consumer in Goals page passes `aria-label={`${g.objective}: ${pct}% progress`}` only — not aria-hidden. ✓

The consumer in CalendarMonth passes `aria-hidden` only. ✓ (the `<Link>` `aria-label` carries the date.)

The consumer in BaselineBlockCard passes `aria-hidden` (blueprint:525). The row's text carries semantics. ✓

**Net**: correct. Suggest tightening the type to enforce mutual exclusion: `{ "aria-label": string } | { "aria-hidden": true }`.

---

## K. Worktree merge order risks

### K1. Agent 3 + Agent 4 file overlap — Verified mostly safe

Files Agent 3 modifies (per §C.3 table) vs Agent 4 modifies (§C.4):

| File | Agent 3 lines | Agent 4 lines | Conflict? |
|---|---|---|---|
| `BaselineBlockCard.tsx` | 46 | 39 | Different lines — git auto-merges. ✓ |
| `CalendarMonth.tsx` | (none — Agent 4 owns) | 40, 42, 60–63 | ✓ |
| `BottomNav.tsx` | (none — Agent 4 owns) | full | ✓ |
| `goals/page.tsx` | empty state (line 37) | 60, 62, helper at top, JSX after line 51 | Possibly conflicts at the imports block. ⚠ |

`goals/page.tsx` imports: Agent 3 doesn't add imports (empty state copy is a string change at line 37). Agent 4 adds `import { Bullseye } from "@/components/Bullseye";` at the top. **No conflict if Agent 3 doesn't touch the import block.**

But: Agent 3's empty state at line 37 modifies the JSX between lines 36–38 (`{goals.length === 0 ? ... : ...}`). Agent 4 adds the Bullseye in the `:` branch at line 51. **Different JSX subtrees.** Git will auto-merge.

**Risk**: low, but if Agent 3's prettier-formatting reformats the entire file, line numbers shift and Agent 4's diff fails. **Mitigation**: pin prettier config (already present in repo).

**Concern, low priority.**

### K2. Wave 1 → Wave 2 hand-off requires Agent 1 to have merged — VERIFIED

Per §A and §F prompt openings: Agent 2 + 3 branch off `feature/goaldmine-rebrand` AFTER Agent 1's merge. ✓

### K3. Layout import `<AppHeader />` in Wave 1 before component file exists — Blocker

Blueprint §A.1.1 (blueprint:25–29) explicitly flags: "Agent 1 imports + renders `<AppHeader />` and Agent 2 ships the component file in the same merge wave — orchestrator merges A1 → A2 in immediate succession."

But: between Agent 1's merge and Agent 2's merge, `feature/goaldmine-rebrand` is **broken** (TypeScript fails: `Cannot find module '@/components/AppHeader'`). If anyone tests `feature/goaldmine-rebrand` between merges, the build fails. If Agent 3 branches off after Agent 1 but BEFORE Agent 2, Agent 3's `npx tsc --noEmit` (acceptance gate) **fails immediately**.

**Why it matters**: Wave 2 has Agent 2 AND Agent 3 in parallel, both branched off Wave 1's merged state. Agent 3's worktree has the `<AppHeader />` import in layout.tsx but not the file. Agent 3's lint/typecheck gate fails through no fault of their own.

**Fix**: Three options:
- (a) Agent 1 also stubs `src/components/AppHeader.tsx` with a minimal placeholder export. Agent 2 replaces the stub. Stubbing is one line.
- (b) Sequencing: Agent 1 ships everything EXCEPT the layout `<AppHeader />` render. Agent 2 ships AppHeader.tsx AND adds the render to layout.tsx (touches layout.tsx). Drops Wave 1's "single agent owns globals.css and layout.tsx" clean rule but reduces broken intermediate.
- (c) Agent 1 imports AppHeader **inside a try-catch boundary**, so a missing file doesn't break the build. Hacky.

Recommend (a): Agent 1 ships a stub:
```tsx
// stub — replaced by Agent 2
export function AppHeader() { return null; }
```
**Blocker**.

---

## L. PWA install regression

### L1. Cached broken icons on installed PWA — Concern

PRD §1.1: "PWA manifest pointing to icon files that don't exist (`/icon-192.png`, `/icon-512.png` are 404s)." If the user already has the PWA installed with broken icons, the OS may have **cached the 404 response** and the new PNGs may not pick up automatically.

**Fix**: PRD/blueprint should say: "If user has the existing PWA installed, they may need to remove and re-add the home screen shortcut to pick up the new icons." Document in PR description / CLAUDE.md notes.

### L2. iOS PWA SVG icon support — VERIFIED

Research §7 (research:373–383) confirmed: iOS 16.4+ supports SVG manifest icons; older falls back to `apple-touch-icon` PNG. Blueprint commits PNG fallbacks. ✓

### L3. `apple-touch-icon` link tag in HTML head — Concern

Even with the manifest's SVG + PNG entries, iOS Safari **also** looks for `<link rel="apple-touch-icon" href="...">` in the HTML head. The blueprint doesn't add this. Without it, "Add to Home Screen" outside of installed-PWA mode may pull a default Safari snapshot.

**Fix**: Add to `src/app/layout.tsx` `metadata`:
```ts
metadata.icons = {
  icon: [
    { url: "/icon.svg", type: "image/svg+xml" },
    { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
  ],
  apple: [{ url: "/icon-192.png", sizes: "192x192" }],
};
```
Next.js generates the `<link rel="apple-touch-icon">` automatically from `metadata.icons.apple`. **Concern.**

---

## M. Build & runtime

### M1. `next/font/google` build-time fetch in agent worktrees — Concern

Each agent worktree needs `npm run build` (or at least `npx tsc --noEmit`) to pass. `next/font/google` fetches DM Serif Display at build time. Agent worktrees run on the user's local machine — internet usually present. ✓ Risk noted in blueprint Risk 2; covered.

### M2. Tailwind v4 + Turbopack + `@theme inline` — VERIFIED

Existing repo uses this combo (`globals.css` + `@theme inline` block). Adding `--font-display` is one additional entry. No new pattern. ✓

### M3. Tailwind v4 `color-mix` — Safari ≥16.2 / Chrome ≥111 — VERIFIED

Research §8 (research:407): modern-browser only. User is on iPhone-class (Safari ≥16). ✓

### M4. `npx prisma generate` after the rebrand — VERIFIED, no schema changes — ✓

PRD §4.1, blueprint §A: zero schema changes. ✓

---

## N. Anything else

### N1. `Goal.targetDate` is non-nullable in the schema — Blocker

`prisma/schema.prisma:148`: `targetDate DateTime` (NOT NULL).

Blueprint §B.5 (blueprint:120–134) defines `goalProgress(g)` accepting `targetDate: Date | null` and returning `null` when no target date. **The null branch is dead code** — `prisma.goal.findMany()` will never return a goal with null `targetDate` (schema enforces it).

The blueprint then says (§B.5 line 133–134): "No `targetDate` → return `null`; component renders `<Bullseye />` (hollow, no `progress` prop)."

The §C.4.4 JSX (blueprint:597–602):
```tsx
{(() => {
  const pct = goalProgress(g);
  return pct === null
    ? <Bullseye size={20} aria-label={`${g.objective}: no target date`} />
    : <Bullseye size={20} progress={pct} ... />;
})()}
```

This is a never-taken branch. Not a bug, but **misleading code** — a future developer might assume targetDate can be null based on this pattern, then add a Goal mutation that allows null without updating Prisma.

**Fix**: Either (a) drop the null branch entirely (simpler):
```ts
function goalProgress(g: { createdAt: Date; targetDate: Date; status: string }): number {
  if (g.status === "achieved") return 1;
  if (g.status === "abandoned") return 0;
  // ...
}
```
Or (b) keep the null-tolerance for safety. Recommend (a) — match the schema. **Blocker on spec correctness.**

### N2. Stable Bullseye in goals list — re-renders on `Date.now()` — Suggestion

`goalProgress` calls `Date.now()`. Server components re-render on every navigation. So `pct` updates each visit — fine. But the page is `"force-dynamic"` (line 6 in goals/page.tsx is `export const dynamic = "force-dynamic"` — wait, let me check).

Actually `goals/page.tsx:6`: `export const dynamic = "force-dynamic";`. ✓ Per-request rendering. Goal progress recomputed on every visit. ✓ No issue.

**Suggestion**: document that the bullseye refines its fill over time (passively) without explicit user action — not stale until a navigation.

### N3. PRD "no functional changes" vs new error block visual — VERIFIED

`bg-[var(--danger)]/10` vs `bg-red-500/10` — different hue, same opacity. Functional behavior unchanged (no logic touched). ✓

### N4. Acceptance grep for `text-blue-*` not in QA — Suggestion

Blueprint §E (blueprint:723–730) doesn't grep for `text-blue-*` / `bg-blue-*`. Research §2 (research:86) confirms zero matches in `src/`, but adding the grep to QA is cheap insurance against future blue-class additions before PR merge.

**Fix**: Add to §E: `grep -rn "text-blue-\|bg-blue-\|border-blue-" src/` → 0.

### N5. `prefers-color-scheme` flip — server-side static rendering caveat — Concern

The app is `force-dynamic` everywhere, but Next.js still renders the HTML with the server's interpretation of CSS variables. The `prefers-color-scheme: dark` block in `globals.css` is browser-side — the browser applies dark values when the media query matches. ✓ No SSR/CSR mismatch.

But: if the user's iPhone is in light mode for the first few seconds of PWA load and flips to dark mid-load, there's a flash. **Not new** — the app already has this behavior. Not a regression. ✓

### N6. `--accent-soft` light mode `rgba(138, 98, 18, 0.14)` rendering on `--card` `#FFFBF0` — Suggestion

The accent-soft tinted bg sits behind today's calendar cell (`bg-[var(--accent)]/10` per §C.4.2 reuses the legacy pattern, not `--accent-soft`). Wait — blueprint:546 says `bg-[var(--accent)]/10`. So `--accent-soft` is **defined but never consumed** in the blueprint's planned edits. Was it added preemptively?

Search blueprint for `--accent-soft` consumption: only definition (blueprint:630, 660). No use sites in §C.

**Fix**: Either:
- (a) Drop `--accent-soft` from globals.css if nothing uses it (YAGNI).
- (b) Use it in CalendarMonth today's-cell tint (`bg-[var(--accent-soft)]` instead of `bg-[var(--accent)]/10`) — this was the original UX intent at research:479.

Recommend (b). **Suggestion**.

### N7. PRD §3.2 §16-§19 "Secondary requirements" — coverage check

PRD §3.2 lists (16) empty-state copy, (17) loading skeletons, (18) form focus rings, (19) button styling.

Blueprint covers:
- (16) ✓ via REQ-E1 bundled with Agent 3.
- (17) NOT in blueprint. **Loading skeletons explicitly omitted.**
- (18) NOT explicitly checked. Form focus rings should still use `var(--accent)` after the palette swap, but no acceptance gate verifies it.
- (19) NOT in blueprint.

PRD calls these out as Should/Nice tier. Architect implicitly deferred (17), (18), (19) to a future iteration. **Acceptable for MVP**, but document.

**Suggestion**: Architect should add a note: "REQs E2 / E3 (PRD §3.2 #18, #19, #17) deferred to iteration 2 — out of scope for this PR."

### N8. `revalidatePath` impact — VERIFIED

Quality-tools.md:63 reminds: "revalidatePath after every server-action mutation". This rebrand has zero server-action mutations. ✓

### N9. `bullseye-pop` keyframe ships unused — Suggestion

§B.2 (blueprint:105–107): keyframe ships in CSS, React plumbing skipped. ✓ Future agents can wire it. **But**: an unused CSS animation keyframe is dead weight (~150 bytes). Not a real concern, but should be **documented**: "keyframe ships ahead of consumer; if not wired by iteration 2, prune."

### N10. `Logo.tsx` outline thickness scaling — Concern

`Logo.tsx` skeleton uses `stroke-width=1.25u` (UX §1 spec at 64u viewBox). At size=192 (PWA icon), stroke is 1.25 / 64 × 192 = 3.75px. At size=28 (header), stroke is 1.25 / 64 × 28 = 0.55px — sub-pixel. **At 0.55px the strokes will antialias to a faint gray.** UX §1 didn't address this.

**Fix**: Either (a) use absolute `stroke-width` based on `size` (need a ref/calc; awkward in pure SVG), or (b) bump to 1.5u so 28px renders at 0.66px (still sub-pixel). Or (c) remove the chest outline entirely at small sizes — flatten to fills only.

Recommend (c) for the chest body — it's filled gold; outline is decorative. The flanking hollow targets at `stroke-width=1.25u` are the real legibility risk; at size=28, they're 0.55px = invisible. **Concern** — Agent 2 may ship something that looks fine at 192px but blurry at 28px in the header.

---

## Summary verdict

**Architecture is BLOCKED on 9 issues.** Concerns + Suggestions list separately.

### Blockers (must fix before development)

1. **A1** — Bullseye `filled` vs `progress` precedence not in acceptance contract; type union recommended.
2. **A3** — Logo hero-target dark outline marked "optional" — should be mandatory for legibility on cream.
3. **B5** — globals.css §D rewrite drops existing `-webkit-tap-highlight-color: transparent` and `input/textarea/select/button { font-family: inherit }` rules. Visible iOS regression.
4. **C3** — CalendarMonth `◎N` baselines-due color recolors to `--accent` gold but visual hierarchy in 4-glyph stack not addressed; recommend `--muted` instead.
5. **E2** — BottomNav active dot wrapping requires explicit JSX restructuring; current spec leaves cell-height parity ambiguous.
6. **E3** — BottomNav active dot is supposed to be `var(--accent)` gold per UX §3, but Bullseye renders red; spec contradicts itself. Resolve.
7. **F3** — `Logo.tsx` (CSS variables) and `public/icon.svg` (literal hex) drift over time without a sync rule; add file-header comment.
8. **G4** — Agent 3 vs Agent 4 boundary on `goals/page.tsx` imports needs explicit non-touch instruction.
9. **I1, I2, I3** — Empty-state copy gating conditions and placement underspecified for Records, Journal, Today; Agent 3 will guess wrong.
10. **K3** — Wave 1 layout.tsx imports `<AppHeader />` before Agent 2 ships the file. Agent 3 (Wave 2) can't typecheck. Add stub component.
11. **N1** — `goalProgress` accepts `targetDate: Date | null` but Goal.targetDate is non-nullable in the schema; dead code branch.

### Concerns (fix during development; document mitigation)

- A2 (Bullseye boundary sizes), A4 (Logo on PWA install bg), B2 (color-mix opacity drift), B3 (font fallback "one-line" claim), B4 (body fallback chain regression), C1 (today + completed combo), C2 (warning star burnt umber), C4 (warning bg drift), F2 (resvg native binding fallback), G2 (covered by B2), H2 (double header on Today), H4 (AppHeader on wide screens), J4 (aria mutual exclusion), K1 (file overlap low risk), L1 (cached PWA icons), L3 (apple-touch-icon link tag), N5 (light/dark flash), N10 (Logo stroke at small sizes).

### Suggestions (nice-to-have)

- A5 (AppHeader prop type), C2 alt (warning-star saturation), D1 (emoji on cream), E1 (no-op label class), G3 (success cue saturation), J3 (semantic structure verified), K2 (Wave 1 hand-off OK), N2 (force-dynamic re-render), N4 (text-blue grep), N6 (use --accent-soft or drop), N7 (defer secondary REQs note), N9 (keyframe pruning).

### One-sentence recommendation

**Send blockers back to the Architect for a v2 blueprint** — most are spec gaps and a handful of real bugs (B5, K3, E3, N1) that will bite Agent 1 / Agent 4 inside the first hour of development.

/Users/ggronnii/Development/workout-planner/.feature-dev/2026-05-05-goaldmine-rebrand/agents/architecture-critique.md
