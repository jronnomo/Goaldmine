---
name: ux-research
description: Spawn a UX research team for visual/interactive features — produces option mockups, technical diagrams, gesture/animation storyboards, and component-hierarchy recommendations grounded in the active app profile's design system and brand voice. Profile-driven; ports to any product by editing one profile file.
argument-hint: <github-issue-number-or-prd-path> <feature-description>
---
# /ux-research — UX Research Orchestrator (profile-driven)

Spawn a team of specialist researchers and mockup agents to produce creative, on-brand UX research for a visual or interactive feature. Everything product-specific (stack, tokens, brand voice, viewport, deliverable target) is read from an **app profile** — the agent prose stays generic, so the same tool serves a phone app, a web PWA, a desktop editor, or a game by editing one file.

`$ARGUMENTS` should contain either a GitHub issue number or a PRD file path, plus a brief feature description.

---

## 0. Load the App Profile (Refinement R1)

Before anything else, read the **active profile**:

1. Look in `.claude/skills/ux-research/profiles/` (the `profiles/` dir beside this `SKILL.md`) for the file with `active: true` in its frontmatter. If exactly one exists, that's the profile.
2. If none/many are active, fall back to the single profile present; if still ambiguous, stop and ask which to use. (Never assume a specific product — each repo ships its own profile.)

The profile supplies: `platform`, `mockup_width`, `stack`, `design_tokens`, `brand_voice` (may be disabled), `benchmark_apps`, `product_thesis`, `invariant_rules`, `deliverable` (comment vs file, repo, path, `flavor_layer`), `visualization` (which Phase-B artifacts to produce), and optionally a **`named_interactions` catalog** + **`screen_inventory`** (with `file:line`) that spoon-feed a mature codebase's signature interactions and routes to the research team instead of making them rediscover each run. A well-profiled product (e.g. Chewabl) thus gets richer, more on-brand research than a generic sweep — without the SKILL hard-coding anything.

> **Porting to a new product = copy `_template.profile.md`, fill it, set `active: true`.** Do NOT edit this SKILL or the orchestrator agent to re-theme. If you find yourself wanting to hard-code a stack or a brand word here, it belongs in the profile.

---

## When to use

UX research is warranted when the feature:
- Adds or redesigns a user-facing screen/section, modal, or sheet
- Involves animations, gestures, or micro-interactions
- Presents data in a visual format
- Touches a brand-defining interaction

**Skip** when: pure backend/API/data-model changes, bug fixes, refactors, performance, config/migrations/infra — or when the user explicitly says keep it simple.

---

## Invocation contract (Refinement R5)

The tool's value is wasted when it's invoked ad-hoc — trigger-matching features got silently skipped in practice. Make the decision **explicit and recorded**, never silent:

- When `/feature-dev` reaches Phase 2, it MUST do exactly one of:
  1. **Invoke** `/ux-research` (any of the "When to use" triggers matched), or
  2. **Record a skip** — write a one-line `UX-research: skipped — <reason>` into the PRD, where `<reason>` cites a specific "Skip when" condition.
- A feature that matches a trigger and has **no** invocation and **no** recorded skip is a contract violation — feature-dev should not proceed to Phase 4 until one exists.
- The skip line and the research link both live in the PRD's header, so any later audit can see the decision without archaeology.

This converts "sometimes used, sometimes not" into "always a logged decision."

---

## Deliverable model — Core vs. Brand-Flavor (Refinement R4)

The output is split into a **stable analytical core** (always produced — this is the portable, high-yield part) and an **optional brand-flavor layer** (only when the profile's `flavor_layer: true`).

**Core (always):**
1. **Current-state audit** — problems with `file:line` evidence and user impact. *(Highest-yield section across every port — it catches real bugs, not just aesthetics.)*
2. **Proposed direction(s)** — 2–3 concepts, each with rationale.
3. **Phase-A option mockups** (ASCII) + **Phase-B technical diagrams** (see Visualization).
4. **Component hierarchy + state/data shape** — files, store/query keys, props.
5. **Implementation scope** — files to create/modify, named testIDs, complexity.
6. **Accessibility** — touch-target size, contrast in the profile's `two_medium_axis`, screen-reader labels, reduced-motion.
7. **Behavioral Psychology Principles** — the table (Hick's, Zeigarnik, Doherty, Peak-End, Goal-Gradient…). *Brand-agnostic — lives in the core, never the flavor layer.*

**Brand-Flavor (only if `flavor_layer: true`):**
- "What Makes It Unique / On-Brand / Insightful" narrative, branded section naming, voice-driven copy tables, the specialists footer.

> Two of three ports stripped the flavored scaffolding but kept the core verbatim. Keeping the core stable and the flavor opt-in stops that loss.

---

## Visualization — two phases (ASCII for options → diagrams for the choice)

Agents emit **text only** (they can't drive a browser or render images), so fidelity comes from text formats that render or compile precisely.

### Phase A — Divergent (ASCII), always
2–3 lightweight mockups at the profile's `mockup_width`, **one per competing direction**. Cheap, inline, ideal for "compare these options." This is where alternatives live and get narrowed to one.

### Phase B — Convergent (technical), chosen direction only
Once a direction is picked, upgrade to formats ASCII can't express well:

- **Mermaid diagrams** (`phase_b_diagrams: true`) — render **inline on GitHub**, brand-agnostic, precise:
  - `flowchart` — screen/navigation flow
  - `stateDiagram-v2` — component/interaction states (empty → focus → filled → error)
  - `sequenceDiagram` — gesture → haptic → network → state choreography
  - `gantt` — **animation timing**: one bar per tween with real ms + easing in the label (replaces hand-typed timing tables; shows overlap/parallelism honestly). Note the axis is illustrative; exact values live in the task labels.
- **Pixel-accurate committed artifact** (`phase_b_pixel_artifact: svg|html`) — only when the screen's *visual* fidelity is load-bearing. A self-contained `.svg` or `.html` mockup using the profile's **real design tokens** (exact colors/spacing/type), committed under `deliverable.file_path` and **linked** from the comment. (GitHub sanitizes inline SVG/HTML in comments, so these are committed-file + link; Mermaid goes inline.)

Pick the minimum set that answers the open design questions — don't produce all four Mermaid types reflexively.

---

## Restraint & provisional-tuning gate (Refinement R2)

The tool's recurring failure is over-confidence in its own subtle aesthetic calls. Two guards:

1. **Decoration restraint.** Default to typography, spacing, and existing primitives for separation/emphasis. Any **custom ornamentation** (bespoke SVG dividers, shaders, particle flourishes) must be justified against a cheaper alternative and labeled **"⚠ verify visually before shipping."**
   - *Evidence: scalloped SVG dividers shipped, read as "visual noise," reworked twice, removed.*
2. **Provisional numeric tuning.** Every specific magic number — alpha/opacity, animation duration/easing, scale factors, color-mix ratios — is **provisional, not a [DECISION]**. Label it **"⚠ playtest/visually verify"** and give a range, not a false-precise single value. For game/at-distance feedback, **bias bolder** — legibility at target render scale beats subtlety.
   - *Evidence: wear-tier alphas (0.10/0.18) shipped, then reversed in playtest as "too subtle — the brand pillar wasn't reading."*

State at the top of any tuning recommendation: **"reads at `<mockup_width>` / target scale?"** — if the agent can't be sure from a mockup, it says so.

---

## Convergence & length discipline (Refinement R3)

- **One canonical artifact per issue.** Refine by **editing/appending** the existing research, not posting a new full report each pass. Re-running the whole orchestrator to re-litigate a settled design is the failure mode to avoid.
  - *Evidence: one feature accrued four full "Research Team Findings" comments; artifacts ran 15–47 KB.*
- **Don't reopen locked decisions.** If the PRD already fixed a value/approach, do not propose changing it unless you flag it explicitly as a challenge with evidence and ask for sign-off.
- **Length-aware delivery.** If the compiled report exceeds ~1 screenful, post a **short executive summary** (the audit + chosen direction + scope) as the comment and **commit the full report** to `deliverable.file_path`, linking it. Large reports are file-shaped.

---

## Outcome capture — Recommendation Ledger (Refinement R5)

Every report ends with a **Recommendation Ledger** — a machine-readable table that lets the tool measure its own hit rate instead of relying on PR archaeology (which is how this very audit had to be done).

Each distinct recommendation gets a **stable ID** and a **status**:

```
| ID         | Recommendation            | Type        | Status   | Evidence |
|------------|---------------------------|-------------|----------|----------|
| UXR-36-01  | "Locked out? Let's fix…"  | copy        | proposed |          |
| UXR-36-02  | CodeInput 6-box auto-adv  | component   | proposed |          |
| UXR-36-03  | wear vignette alpha 0.3–0.5| tuning ⚠    | proposed |          |
```

- **ID:** `UXR-<issue|slug>-NN`. Stable across edits — never renumber.
- **Type:** copy / layout / animation / component / tuning⚠ / a11y / decoration⚠.
- **Status lifecycle:** `proposed` → `shipped` | `reworked` | `dropped`.
- **Who updates it:** the **implementing PR/commit** ticks each row to its terminal status and links the evidence (commit SHA, `file:line`, or "playtest: too subtle"). If the research was delivered as a committed file, the ledger lives at `deliverable.file_path/ledger.md`; if as a comment, the implementer edits the comment's ledger in place.
- **Why:** a later run can `grep` ledgers across repos and compute shipped/reworked/dropped rates — especially for `tuning⚠` and `decoration⚠` rows, which is exactly where the tool historically over-trusted itself. The ledger turns each feature into a labeled data point for tuning the tool.

Keep it lightweight: one row per *distinct* recommendation, not per sentence.

---

## Execution

Parse the issue number (or PRD path) and feature description from `$ARGUMENTS`. If a PRD file is provided, read it. Load the active profile (§0).

Spawn the `ux-research-orchestrator` agent (background — does not block other work):

```
Agent(
  subagent_type: "ux-research-orchestrator",
  description: "UX research for <feature-name>",
  prompt: "ACTIVE_PROFILE:\n<full text of the active profile file>\n\nISSUE_NUMBER_OR_PRD_PATH: <value>\nFEATURE_DESCRIPTION: <description>\nPRD_CONTENT: <prd text>",
  run_in_background: true
)
```

The orchestrator explores the codebase, spawns 3 specialist research agents and the mockup/writeup agents, applies the restraint gate, produces Phase-A then Phase-B visuals, and posts/commits per `deliverable.target`.

---

## Integration with /feature-dev

Runs in Phase 2 (after the PRD is written, before Phase 4 implementation), per the **Invocation contract** above — invoked or skip-with-reason, never silently omitted. Non-blocking — feature-dev setup may proceed once findings post. The feature-dev orchestrator **must read the findings and update the PRD's "Open Questions"** before spawning Developer Agents.

The loop closes on the way out: when implementation finishes, the implementing PR **updates the Recommendation Ledger** — each row to `shipped` / `reworked` / `dropped` with evidence. Research-informed design produces better first-pass code and fewer correction commits — provided the research converges (R3), doesn't over-specify provisional tuning (R2), and the ledger gets ticked so the next run can learn from what actually landed (R5).
