---
name: ux-research
description: Spawn UX research team for visual/interactive features in the workout-planner web app — produces ASCII mockups, animation/interaction storyboards, and component-hierarchy recommendations grounded in mobile-first PWA constraints.
argument-hint: <github-issue-number-or-prd-path> <feature-description>
---
# /ux-research — UX Research Orchestrator (workout-planner)

Spawn a team of specialist researchers and mockup agents to produce creative UX research for a visual or interactive feature. Results are posted as a compiled GitHub issue comment **if** an issue number is supplied; otherwise written to `docs/ux-research/<slug>.md`.

`$ARGUMENTS` should contain either a GitHub issue number or a PRD file path, plus a brief feature description.

---

## When to use

**Indicators that UX research is warranted:**
- Adds or redesigns a route/page/section with user-facing UI (`src/app/.../page.tsx`)
- Involves animations, gestures, or micro-interactions on the PWA
- Presents data in a visual format (Recharts series, lists, cards, baseline-block grids)
- Touches brand-defining interactions (logging flows, checkmark feedback, "Today" rhythm)

**Skip UX research when:**
- Pure backend / MCP-tool / data-model changes with no UI
- Bug fixes, refactors, or performance work
- Configuration changes, migrations, or infrastructure
- The user explicitly says to keep it simple

---

## Execution

Parse the issue number (or PRD path) and feature description from `$ARGUMENTS`. If a PRD file is provided, read it.

Spawn the `ux-research-orchestrator` agent:

```
Agent(
  subagent_type: "ux-research-orchestrator",
  description: "UX research for <feature-name>",
  prompt: "ISSUE_NUMBER_OR_PRD_PATH: <value>\nFEATURE_DESCRIPTION: <description>\nPRD_CONTENT: <prd text>",
  run_in_background: true
)
```

This agent autonomously:
1. Explores `src/app/`, `src/components/`, and `src/lib/` to map the current UI state, brand tokens (`var(--accent)`, `var(--border)`, `var(--card)`), and the data layer (`@/lib/calendar`, MCP read tools).
2. Spawns 3 specialist research agents (Data + Behavior, Web/PWA Dev + Animation, UI + Brand).
3. Spawns 3 mockup/writeup agents (page mockup, animation/interaction storyboard, creative analysis).
4. Posts findings as a compiled GitHub comment (if `ISSUE_NUMBER` was supplied) or writes a markdown file at `docs/ux-research/<slug>.md`.

**Runs in the background** — does not block other work. The research enriches the issue (or doc) for future reference.

---

## Required context to relay

The orchestrator must pass these to its sub-agents — vague prompts produce shallow research:

- **Current UX state** — exact route paths (`src/app/page.tsx`, `src/app/nutrition/page.tsx`, etc.), components used, behavior. Reference the actual files.
- **Specific UX problems** — each with severity, code evidence (file:line), and user impact.
- **Open design questions** — explicit unknowns the PRD left for research.
- **Brand & visual identity** — Tailwind v4 token system: `var(--accent)`, `var(--accent-fg)`, `var(--border)`, `var(--card)`, `var(--muted)`. Mobile-first (≤ 390 px primary), single user, fitness-coach voice.
- **Competitive context** — which apps/patterns to benchmark (Strong, Fitbod, Hevy, Strava, Apple Fitness — pick 1–2 relevant per feature).
- **Constraint reminders** — server components by default, USER_TZ-aware date helpers (`@/lib/calendar`), Recharts as the only charting lib, no animations heavier than CSS transitions or Framer Motion if absolutely needed.
- **Deliverables requested** — ASCII mockups (phone-width), animation/transition specs (timing + easing), component hierarchy, scope (files to create/modify), accessibility notes.

---

## Integration with /feature-dev

When invoked from `/feature-dev`, this skill runs during Phase 2 (after the PRD is written; before Phase 3 implementation begins). It does **not** block Phase 4 spawning — the `feature-dev` orchestrator may proceed once the research has posted findings.

The deliverables from this skill resolve open design questions in the PRD; the `feature-dev` orchestrator must read the findings and update the PRD's "Open Questions" section before spawning Developer Agents.
