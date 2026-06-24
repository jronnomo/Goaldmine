# Completion Report — Automated ClipForge Agent Worker + Render Queue

**Date:** 2026-06-24 · **Board:** Goaldmine Roadmap (Project #8) · **Issues:** #113–#126 (14 stories)

## Outcome
Ironed the "remote-control a Claude session" idea into a concrete, decomposed, board-materialized backlog. Core reframing: MCP is pull-only, so we **invert** — Goaldmine exposes a render-job queue; a standing, subscription-authed Claude worker on the GPU box **polls** it. Auto-render ships first; the in-app coaching window is captured as a later/exploratory epic.

## Process
Plan doc → Plan Devil's-Advocate (13 findings; the structural fix was the **split-run** design — the worker never long-polls for approval) → decomposition (14 stories) → Backlog Critic (4 must-fix folded in: `start_render_job`, status enum, `goalId` default, reaper-in-peek) → materialize on #8.

## Sprints / stories
**Sprint 1 — Render-Queue Foundation (Epic A, buildable now):**
- #113 [A1] DayRenderJob model + migration — P0/S
- #114 [A2] render-job MCP tools (6: queue/list/claim/start/draft/complete) — P0/M
- #115 [A3] cheap authed `/api/render-jobs/peek` — P1/S
- #116 [A4] Day page Queue-for-render + Approve-render — P1/M
- #117 [A5] stale-claim reaper (in peek handler) — P1/S
- #118 [A6] document automated flow in bridge doc — P3/S

**Sprint 2 — Auto-Render Worker (Epic B, spec-only, code outside repo):** #119–#123 (worker scaffold + subscription auth/API-key fallback, cron poller, draft-run prompt, render-run, run-as-a-service).

**Sprint 3 — Coaching Window (Epic C, exploratory, spec-only):** #124 spike, #125 streaming UI (EPIC — split before build), #126 risk/usage-policy doc.

## Board note
The Sprint field on #8 already holds the multi-domain roadmap's sprints (1–9); editing a ProjectV2 single-select regenerates option IDs and wipes existing assignments (known hazard), so these 14 items use the existing **Backlog** Sprint option, with this initiative's epic/sprint grouping carried by labels (`clipforge-auto-render`, `epic-a/b/c`, `sprint-1/2/3`, `spec-only`). All have Status=Todo + Priority + Effort set.

## Critical path
#113 DayRenderJob → #114 MCP tools + #115 peek → #116 Day UI → (Epic B worker). Sprint 1 is independently shippable and `main`-deployable without Epics B/C.

## Top risks (carried as story constraints)
- **Subscription-auth / TOS (R3):** an unattended standing worker on a Max subscription may exceed interactive-use intent and the OAuth token expires — "$0 beyond Max" is a goal, not a guarantee. Worker designed for one-env-var swap to the paid API.
- **File-ingestion precondition (R4):** video must be on the GPU box + ingested into ClipForge before a render; `queue_render_job` carries `clipforgeProjectId`; unresolved filenames fail loudly.

## Next step
Start Sprint 1: `/feature-dev "[A1] Add DayRenderJob model + additive migration"`, then #114/#115, then #116.
