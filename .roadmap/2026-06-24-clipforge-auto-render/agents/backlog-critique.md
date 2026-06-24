# Backlog Critique — Automated ClipForge Agent Worker + Render Queue
**Author:** Backlog Critic agent  
**Date:** 2026-06-24  
**Backlog reviewed:** `.roadmap/2026-06-24-clipforge-auto-render/coordination/backlog.json` (13 stories, Epics A/B/C)  
**Artifacts read:** `docs/roadmap/clipforge-auto-render-plan.md` (R1–R11), `.roadmap/…/agents/plan-critique.md`

---

## Revision coverage pass

Every R1–R11 was checked against ACs. All have a home **except one gap** (called out as M1 below).

| Revision | Home | Status |
|----------|------|--------|
| R1 atomic claim | A2 AC1 | ✅ |
| R1 stale-claim reaper | A5 AC1 | ✅ |
| R2 split-run | B2 AC2 + B4 AC1 | ✅ *—but render-run's claim mechanism unspecified (→ M1)* |
| R3 auth/API-key fallback | B1 AC2–3 | ✅ |
| R4 file-ingestion / clipforgeProjectId | A2 AC1, A4 AC1, B3 AC2 | ✅ *—optionality mismatch (→ S2)* |
| R5 notify=badge | A4 AC2 | ✅ |
| R6 peek shape | A3 AC1–2 | ✅ |
| R7 upsert/re-queue + cascade | A2 AC1, A1 AC1 | ✅ |
| R8 worker-no-dates | B2 AC3 | ✅ |
| R9 failure policy | B3 AC2–3 | ✅ |
| R10 registerRenderTools wiring + outputRef format | A2 AC2–3, A4 AC4 | ✅ |
| R11 separate services | C1 AC3 | ✅ |

---

## MUST-FIX — resolve before materializing as GitHub issues

### M1 · A2 — Render-run atomic claim tool is missing

**The problem.** A2 lists five tools: `queue_render_job`, `list_render_jobs`, `claim_render_job` (pending→claimed), `submit_render_draft`, `complete_render_job`. R2 requires a **second atomic claim step** for the render run: `approved→rendering`. B4 AC1 says "claim approved job (status→rendering)" but no tool in A2 performs this. Without it, either /feature-dev invents a non-atomic path (race), or B4's spec silently assumes an A2 extension that was never written.

**Fix.** Add to A2 AC1, after the `claim_render_job` entry:
> `start_render_job(id)` — atomic conditional update `updateMany({ where:{ id, status:'approved' }, data:{ status:'rendering', claimedAt } })`, returns `{ started: boolean }` (false = already claimed by another run). Discoverable description mirrors `claim_render_job`.

Add to A2 `touches`: no new file — this goes in `render-tools.ts` alongside the other tools.

Update B4 AC1 to reference: "Use `start_render_job(id)` (see A2) for the approved→rendering atomic claim."

---

### M2 · A1 — Status field doesn't enumerate the full state machine

**The problem.** A1 AC1 says `status (default 'pending')` but never lists the valid values. The `rendering` status (introduced by R2) is used in A4 AC2 (badge states), A5 AC1 (reaper), and B4 AC1, but if A1 doesn't enumerate it, the migration creates a plain varchar with no constraint, and Prisma types don't guard against typos. /feature-dev agents writing A4 and A5 must infer this from the plan, not the story they're handed.

**Fix.** Replace the `status (default 'pending')` field description in A1 AC1 with:
> `status String @default("pending")` — valid values: `pending | claimed | drafted | approved | rendering | rendered | failed`. All transitions enforced by MCP tools. Add a `@@map` comment in the migration file listing the valid states.

Optionally add a Prisma-level enum; at minimum the story must enumerate all seven states so every subsequent story agrees.

---

### M3 · A2 — `goalId?` default is unspecified

**The problem.** A2 AC1 defines `queue_render_job(date, clipforgeProjectId, goalId?)`. If `goalId` is omitted, what happens? The unique constraint is `[goalId, date]`, so a null goalId makes the constraint meaningless (multiple nulls allowed in Postgres). If it defaults to the focus goal, that logic needs to be in the tool — but it's not stated.

**Fix.** Add to A2 AC1 after `goalId?`:
> `goalId` defaults to the current focus goal (queried at call time, same pattern used by `log_workout` / `log_hike`). Tool errors with a clear message if no focus goal exists. `clipforgeProjectId` is **required** (not optional) at call time; the model column is nullable only for schema-additive safety.

---

### M4 · A5 — "or a Vercel cron route" is an unresolved OR — /feature-dev cannot build ambiguity

**The problem.** A5 AC2 says: "Triggered cheaply (within list_render_jobs/peek call, or a Vercel cron route) — documented which." This is an explicit open decision inside an acceptance criterion. A /feature-dev agent handed this story will pick arbitrarily and may pick the wrong one (a Vercel cron route means new infrastructure; piggybacking on peek is zero-cost).

**Fix.** Resolve the OR now. Recommended: piggyback on the peek handler (already route-scoped, already called at cron cadence, zero new infrastructure). Update A5 AC2 to:
> Triggered as a side-effect of `GET /api/render-jobs/peek`: before computing counts, run the reaper in the same request handler. No separate cron route needed. Document in the peek handler with a comment.

---

## SHOULD-FIX — fix before Sprint 1 execution begins

### S1 · A2 — MCP_SERVER_VERSION bump not an explicit AC

**The problem.** CLAUDE.md states "commit-SHA `MCP_SERVER_VERSION` busts the connector tool cache." A2 adds new tools; without a version bump the claude.ai connector won't discover them post-deploy. This is easy to miss inside /feature-dev.

**Fix.** Add to A2 AC (after the existing ACs):
> Deploy includes a `MCP_SERVER_VERSION` bump (or confirm the auto-commit-SHA mechanism in `src/app/api/mcp/route.ts` already handles it); verified by checking `tools/list` response after deploy returns the five new render tools.

---

### S2 · A1/A2 — `clipforgeProjectId` optionality mismatch

**The problem.** A1 AC1 lists `clipforgeProjectId?` (optional model column). A2 AC1 makes it a required parameter of `queue_render_job`. R4 is clear it's required at queue time. The mismatch will cause one /feature-dev agent to generate a non-null column and another to expect nullable — migration conflict.

**Fix.** Align explicitly: A1 AC1 should say `clipforgeProjectId String?` (nullable column, for additive-migration safety) and A2 AC1 should say `clipforgeProjectId` is **validated non-null at the tool layer** (zod `.string().min(1)`) with a clear error if absent.

---

### S3 · A4 — No error-path AC for failed server action

**The problem.** A4 describes the happy path (button → creates job, status badge follows lifecycle) but is silent on failure. The server action can fail (duplicate non-terminal job exists, missing clipforgeProjectId, DB error). A /feature-dev agent will either swallow the error silently or throw a 500.

**Fix.** Add to A4:
> AC: Server action validates that no non-terminal job (pending/claimed/drafted/approved/rendering) already exists for the same day before creating; if one does, the UI surface shows "Render already in progress" instead of the Queue button. DB/validation errors surface as an error banner on the Footage card, not an uncaught exception.

---

### S4 · A5 — Priority P2 is too low for a binding revision

**The problem.** A5 is the stale-claim reaper — required by R1, which the plan-critique flagged as CRITICAL. A stuck claimed/rendering job on a home GPU box (power loss, OOM kill) blocks all future renders for that day until manually cleared. P2-Medium understates the blast radius for a personal single-GPU setup.

**Fix.** Bump A5 to `"priority": "P1 - High"`. The effort stays Small; this is purely a priority correction.

---

### S5 · C2 — "SPLIT this before building" buried in an AC, not a pre-condition

**The problem.** C2 has `effort: "Large"` and its third AC literally says "SPLIT this before building — likely several /feature-dev stories." That's not an acceptance criterion; it's a gate. If this story lands in GitHub as-is and someone runs `/feature-dev C2`, they'll build a monolith.

**Fix.** Remove the split note from AC. Add a top-level field to C2:
> `"precondition": "Must be decomposed into ≥3 sub-stories before any /feature-dev handoff. This is a planning placeholder, not a buildable story."`

Alternatively, retitle to `[placeholder] In-app streaming coaching window UI` and note in the `value` field.

---

## OPTIONAL — low-risk improvements

### O1 · B3 — ClipForge tool names should be marked "verify against live schema"

B3 AC1 references `list_spines`, `list_assets`, `apply_spine`, `frame_strip` as ClipForge MCP tool names. These come from the bridge doc, which reflects the ClipForge schema at time of writing. The spec should carry a note: "All ClipForge tool names are from `docs/integrations/goaldmine-clipforge-bridge.md`; verify against live ClipForge MCP `tools/list` before building the prompt." Prevents a spec-to-implementation drift from breaking the worker silently.

### O2 · Missing: no story for updating `docs/integrations/goaldmine-clipforge-bridge.md` with automation notes

B3's `touches` lists the bridge doc, but if B3 is spec-only and external, the doc update could be forgotten. Consider a thin in-repo story (or fold into A4's story as an AC) to add an "Automated flow" section to the bridge doc once Epic A ships. Low urgency since B3 touches it, but worth tracking.

### O3 · A1 — `draftRef` format undefined

`draftRef` is stored in `DayRenderJob` but its shape is never defined. Unlike `outputRef` (defined by R10), `draftRef` could be a URL, a ClipForge snapshot ID, or an opaque string. The Day UI in A4 doesn't render it (only admins see it via list_render_jobs), so this is low blast-radius. A one-line note in A1 or A2 ("draftRef: opaque string, worker-defined") prevents future confusion.

---

## Dependency / spine check

No cycles detected. Spine is correct: `A1 → A2/A3 → A4`; A5 hangs off A1; B depends on A2/A3; C is standalone. All Sprint 2 stories depend on Sprint 1 stories. No reverse-sprint ordering found.

One invisible dependency to note: **B4 implicitly depends on an A2 extension** (the `start_render_job` tool from M1). After M1 is applied, add `A2` to B4's `deps` if not already there. Currently B4 deps=[A2, B3] — `A2` is listed but the specific tool is not in A2 yet. This is correct once M1 lands.

---

## Sprint balance

Sprint 1 (Epic A): Small + Medium + Small + Medium + Small = ~10 story points. Reasonable, P0s front-loaded (A1→A2), Sprint is independently `main`-deployable without Epics B/C. ✅  
Sprint 2 (Epic B): All spec-only, no repo code changes. Light. ✅  
Sprint 3 (Epic C): Exploratory, lightest. C2 flagged as placeholder (S5). ✅

---

## Prioritized punch list

| # | Category | Story | Change |
|---|----------|-------|--------|
| M1 | MUST-FIX | A2 | Add `start_render_job(id)` approved→rendering tool; update B4 to reference it |
| M2 | MUST-FIX | A1 | Enumerate all 7 status values in the model AC |
| M3 | MUST-FIX | A2 | Specify `goalId` defaults to focus goal; `clipforgeProjectId` required at tool layer |
| M4 | MUST-FIX | A5 | Resolve "or" in AC2 — commit to piggyback-on-peek trigger |
| S1 | SHOULD-FIX | A2 | Add MCP_SERVER_VERSION bump as explicit AC |
| S2 | SHOULD-FIX | A1/A2 | Align clipforgeProjectId optionality (nullable column, required at tool layer) |
| S3 | SHOULD-FIX | A4 | Add error-path AC for duplicate non-terminal job + DB failure |
| S4 | SHOULD-FIX | A5 | Bump priority P2→P1 |
| S5 | SHOULD-FIX | C2 | Move "SPLIT before building" from AC to a `precondition` field; retitle as placeholder |
| O1 | OPTIONAL | B3 | Add "verify ClipForge tool names against live schema" note to AC |
| O2 | OPTIONAL | new | Thin story or AC: update bridge doc "Automated flow" section post-A4 deploy |
| O3 | OPTIONAL | A1 | One-line draftRef format note ("opaque string, worker-defined") |
