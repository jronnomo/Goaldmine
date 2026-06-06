---
profile: <slug>            # e.g. chewabl, goaldmine, clipforge, card-game
active: false              # set true on exactly ONE profile per repo
---

# App Profile — <Product Name>

> This is the ONLY file you edit to port `/ux-research` to a new product.
> The SKILL and the orchestrator agent read these fields and stay generic.
> Anything product-specific (stack, tokens, voice, viewport) lives HERE,
> never hard-coded in the agent prose. (Refinement R1.)

## product
- **name:** <Product Name>
- **one_liner:** <what it is, in one sentence>

## platform
- **target:** <e.g. "React Native + Expo Router (file-based)" | "Next.js 16 web PWA" | "Godot 4.x desktop" | "Vite + React 19 web">
- **primary_viewport:** <e.g. "iPhone ≤390pt" | "desktop 1920×1080" | "responsive, design at 390px first">
- **mockup_width:** <the width ASCII/SVG mockups should assume — drives Phase-A frames>

## stack
- **ui:** <component framework>
- **animation:** <e.g. "Reanimated / Animated API + expo-haptics" | "CSS/Framer Motion" | "Godot Tween + shaders">
- **data:** <e.g. "React Query v5 + Context" | "Zustand + TanStack Query" | "Godot autoload singletons">
- **key_libs:** <anything a mockup/spec must respect>

## design_tokens
- **source:** <where colors/spacing/type live — file path(s)>
- **theming_mechanism:** <e.g. "two-level: StaticColors at module scope + useColors() in component for reactive dark mode" | "Tailwind v4 @theme CSS vars" | "theme/palette.gd, never hardcode Color()">
- **two_medium_axis:** <the pair every mockup must show — e.g. "light ↔ dark" | "16:9 ↔ 9:16" | "n/a">
- **token_rules:** <hard constraints, e.g. "no new colors invented; module-level helpers need their own const Colors = useColors()">

## brand_voice            # OPTIONAL — omit/blank for a neutral product voice (Refinement R4)
- **enabled:** <true|false>
- **vocabulary:** <the load-bearing words + what each means — e.g. "Chomp = commit/celebration; Nibble; Crumb; Sizzle">
- **tone:** <e.g. "warm, food-pun-forward, reassuring" | "dark-fantasy, operatic, grimoire" | "neutral, precise">
- **voice_reference:** <where in-app copy to benchmark against — file paths/strings>

## named_interactions     # OPTIONAL — the spoon-feed catalog (Refinement: tailored richness)
# Hand the research team the existing signature interactions WITH file:line, so they
# extend the brand vocabulary instead of rediscovering it every run. Leave blank for a
# young/unknown codebase — the orchestrator's Phase-1 Explore agents will map it instead.
# - **<Name>** (`path:line`) — what it is; technique; haptic/motion; when to (re)use.

## screen_inventory       # OPTIONAL — exact routes/screens, so mockups reference real paths
# - **<Screen>** — `path` — one-line role
# - nav structure: <tab bar / router shape>

## benchmark_apps
- <2–5 competitors/peers in this product's space the research should reference>

## product_thesis        # the single most load-bearing paragraph — keeps every sub-agent grounded
> <One paragraph stating the product's core invariant truth. Examples that worked:
>  "Brand voice is load-bearing, not decoration." (Chewabl)
>  "The EDL is the single source of truth; the UI only edits the EDL; AI output is a reviewable first draft, never a black box." (ClipForge)
>  "Your tools wear out — degradation must READ at a glance." (Card-Game)>

## invariant_rules       # hard rules sub-agents must obey; cite these in every prompt
- <e.g. "Every proposed interaction must map to a concrete state mutation in <store>.">
- <e.g. "No hardcoded color literals — all colors from <tokens source>.">
- <e.g. "Every mockup shows BOTH sides of two_medium_axis.">

## deliverable
- **target:** <github-issue-comment | committed-file | both>
- **repo:** <owner/name, for `gh issue comment`>
- **file_path:** docs/ux-research/<slug>/   # where committed artifacts + SVG/HTML mockups land
- **flavor_layer:** <true|false>   # include the brand-flavored writeup sections? (Refinement R4)

## visualization         # Refinement: two-phase viz
- **phase_a:** ASCII   # divergent options — always
- **phase_b_diagrams:** <true|false>   # Mermaid for the chosen direction (renders inline on GitHub)
- **phase_b_pixel_artifact:** <none | svg | html>   # committed pixel-accurate mockup when visual fidelity is load-bearing

## outcome               # Refinement R5 — invocation contract + ledger
- **enforce_invocation:** <true|false>   # feature-dev Phase 2 must invoke OR record a skip-reason in the PRD
- **ledger:** <true|false>   # emit a Recommendation Ledger the implementing PR ticks
- **ledger_path:** docs/ux-research/<slug>/ledger.md   # where the ledger lives when delivered as a file
