# Roadmap Plan — Automated ClipForge Agent Worker + Render Queue

**Status:** Approved · **Board:** Goaldmine Roadmap (GitHub Project #8) · **Date:** 2026-06-24

## Problem & target end-state
The Goaldmine→ClipForge bridge (`docs/integrations/goaldmine-clipforge-bridge.md`) already turns a curated training **Day** into a rendered Reel, but it's **manual** — you open a Claude on the GPU box with both MCP connectors and paste the operating prompt. Target: a curated day **auto-renders** without that manual step, triggered from Goaldmine on any machine; plus groundwork for a **subscription-backed in-app coaching window**. Both share one component — a standing, **Claude-subscription-authenticated agent worker on the GPU box**.

## Architecture truth (verified vs. Anthropic/MCP docs)
MCP is **client-initiated / pull**: a server cannot push into or inject into a live Claude session. "Remote-control a live session" is impossible — **invert it**. The GPU box runs the agent; Goaldmine exposes a job queue the worker **polls**.

**Cross-cutting guardrails (every story respects):**
- **$0 beyond Max** — the worker authenticates with the user's Claude subscription (claude.ai login), never an `ANTHROPIC_API_KEY` in the app. Preserves the "no LLM calls in the app" principle.
- **Poll, not push** — the GPU box is behind home NAT; Goaldmine never reaches into it.
- USER_TZ via `@/lib/calendar`; additive Neon-safe migrations; MCP tools typed + discoverable + `MCP_SERVER_VERSION` bump on deploy; server-components-by-default.

## Locked decisions
- Coaching window = **later/exploratory epic** (auto-render ships first).
- Auto-render v1 = **draft → notify → you approve** before the final render (fully-auto-on-clean-days is a later toggle).

## Reuse (don't rebuild)
- `get_day_footage(date)` MCP tool = render-INPUT contract (day context + curated markers).
- `FootageMarker.externalRef` = source-clip refs; finished reel ref → render job `outputRef`.
- MCP conventions: `registerAll` → `registerReadTools`/`registerWriteTools`/`registerProjectTools`; `safe()`; bearer auth in `src/app/api/mcp/route.ts`; commit-SHA `MCP_SERVER_VERSION` busts the connector tool cache.
- `ScheduledItem` is job-shaped but **project-goal-only** → render jobs are fitness-day-scoped → **dedicated `DayRenderJob` model** mirroring its lifecycle shape.
- No chat UI exists (`/coach` is static) → coaching window is net-new (heavier; later).

## Job lifecycle (split-run — see revisions R2)
`pending → claimed → drafted → approved → rendering → rendered` (+ `failed` w/ `errorMessage`). Two short worker runs, never a long-lived poll:
- **Draft run** (cron sees `pending`): atomically claim → run bridge → `submit_render_draft` → **exit** (`drafted`).
- *(user approves in the Goaldmine UI → `approved`)*
- **Render run** (cron sees `approved`): claim-for-render (`rendering`) → render → `complete_render_job` (`rendered`).

## Post-critique revisions (BINDING — fold into stories)
- **R1 — Atomic claim + reaper.** `claim_render_job` = `updateMany({ where:{ id, status:'pending' }, data:{ status:'claimed', claimedAt } })`; `count===0` ⇒ already claimed. Add a **stale-claim reaper** (story): rows in `claimed`/`rendering` with `claimedAt < now-30min` reset to `pending`/`approved`.
- **R2 — Split-run, never poll.** The worker submits the draft and **exits**; a later cron cycle handles the approved render. No process waits on a human click. Distinct `rendering` status guards the render run from double-claim.
- **R3 — Auth/TOS honesty.** Subscription auth (headless Claude Code, browser-OAuth token) can **expire** and a standing automated worker may not be within Max's interactive-use intent — **"$0 beyond Max" is a goal, not a guarantee.** Design the worker so switching to `ANTHROPIC_API_KEY` is a **one-env-var change** (captured as a story + a risk).
- **R4 — File-ingestion precondition.** Video files must already be on the GPU box **and ingested into a ClipForge project** before render. `queue_render_job` takes a **`clipforgeProjectId`**; "Queue for render" is only valid post-ingest. Unresolved filenames ⇒ **fail the job with a clear `errorMessage`**, never silent zero-pin renders.
- **R5 — Notify = the Day badge (v1).** No push/VAPID infra: the Day page `drafted` status badge IS the notification. (Push is a later nicety.)
- **R6 — Peek shape + auth.** `GET /api/render-jobs/peek` → `{ pendingCount, nextJob:{id,date}, approvedCount, nextApprovedJob:{id,date} }` (cron needs the id to launch the right run). Auth via the `timingSafeEqual` pattern in `src/app/api/mcp/[token]/route.ts`.
- **R7 — Re-queue semantics.** `@@unique([goalId,date])` + `queue_render_job` **upserts** (re-queueing a terminal `rendered`/`failed` job resets it to `pending`). `goalId` FK `onDelete: Cascade`.
- **R8 — Worker never computes dates.** All dates flow verbatim from Goaldmine MCP responses (USER_TZ = server's `America/Denver`); the GPU box's local clock is irrelevant and forbidden as a date source.
- **R9 — Explicit failure policy** in the automated prompt: EPS_GUARD ⇒ retry next spine once then fail; POOL_CYCLED ⇒ proceed + annotate draft notes; unresolved filenames ⇒ fail with list. Multiple `highlight` markers ⇒ tie-break `capturedAt asc`.
- **R10 — `registerRenderTools(server)` wired into `registerAll`** is an explicit acceptance-criterion (easy to forget → tools silently absent). Define **`outputRef` format**: `http(s)://…` ⇒ render as link, else plain text.
- **R11 — Epics B and C are separate services** (batch start-do-exit cron vs. persistent streaming proxy) — "one shared worker" is aspirational; they share only auth setup, not runtime.

## Architecture sketch
```
Goaldmine (any machine)                         GPU box (standing worker, Max-subscription auth)
  Day page "Queue for render" ─┐                 cron poller → GET /api/render-jobs/peek (cheap, authed)
   → DayRenderJob(pending)      │  poll           │ if pending → headless Claude (claude -p,
  MCP: list/claim/draft/        │◀───────────────  │   --mcp-config: Goaldmine remote + ClipForge local)
       approve/complete         │                 │ automated bridge prompt:
  peek endpoint (HTTP)          │                 │   get_day_footage → pins → apply_spine → frame_strip
  status + outputRef on Day     │   write-back    │   → DRAFT + caption → notify → await approve
                                └────────────────  │   → render → complete_render_job(outputRef)
```

## Epics
### Epic A — Render-job queue (Goaldmine side) · buildable now via /feature-dev · Sprint 1 · P0/P1
- **`DayRenderJob` model** + additive migration: `{ id, date (USER_TZ midnight), goalId (FK), status, claimedAt?, draftRef?, approvedAt?, renderedAt?, outputRef?, errorMessage?, payload Json?, createdAt, updatedAt }`, `@@unique([goalId,date])`, `@@index([goalId,status,date])`.
- **MCP tools** (`registerRenderTools`): `queue_render_job(date)`, `list_render_jobs(status?,from?,to?)`, `claim_render_job(id)`, `submit_render_draft(id,{draftRef,notes})`, `complete_render_job(id,{outputRef,status})`. `safe()`-wrapped, USER_TZ dates, discoverable descriptions; `claim_render_job` is an atomic conditional update (pending→claimed) to prevent double-claim.
- **Cheap peek endpoint** `GET /api/render-jobs/peek` (mirror `/api/mcp` bearer) → `{ pendingCount, nextDate }` so the cron poll doesn't spin up Claude (and burn subscription tokens) when idle.
- **Day page affordance** (Footage card in `src/app/days/[dateKey]/page.tsx` + server action): "Queue for render" → creates the job; shows status; "Approve render" action for the draft→approve gate; `outputRef` link when rendered.

### Epic B — Auto-render agent worker (GPU box) · spec-only (code outside this repo) · Sprint 2 · P1
- Cron poller → `/peek`; on pending, launch headless Claude Code (`claude -p --output-format stream-json --mcp-config <both servers>`), Max-subscription auth, no API key.
- Automated bridge prompt: claim → `get_day_footage` → map pins (exact spine-slot labels from `list_spines`) → `apply_spine` → `frame_strip` → caption → `submit_render_draft` → notify → poll `approved` → `render` → `complete_render_job(outputRef)`; errors → `failed`+message.
- Stories: worker scaffold + subscription-auth; claim-lock/idempotency (single worker per job); the automated prompt; draft+notify channel; approval-poll loop; render + write-back; failure/retry; run-as-a-service (launchd/systemd) + logging.

### Epic C — In-app coaching window · later/exploratory; spec-heavy · Sprint 3+ · P2/P3
- Net-new streaming chat UI (augments static `/coach`); backend proxies each turn to the same local subscription-authed Agent SDK / Claude Code process (Goaldmine MCP tools attached); streams back.
- Risks as constraints: online only when the worker runs; bound by Max usage/daily caps; **personal single-user only** (distribution needs the paid API); offline when PC is off; streaming transport choice.

## Sprints
- **Sprint 1 — Render-Queue Foundation (Epic A):** model + migration, MCP tools, peek endpoint, Day UI. Independently shippable & `main`-deployable.
- **Sprint 2 — Auto-Render Worker (Epic B):** spec-only stories for the GPU-box worker.
- **Sprint 3 — Coaching Window (Epic C):** exploratory, lower priority.

Critical path: `DayRenderJob` model → MCP tools + peek endpoint → Day UI → worker.

## Handoff
Each Epic-A story → `/feature-dev "<story>"` one at a time. Epic-B/C stories are spec-only (code lands on the GPU box / a future initiative). This plan stops at a populated, prioritized board #8.
