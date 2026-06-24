# Plan Critique — Automated ClipForge Agent Worker + Render Queue
**Author:** Plan Devil's Advocate agent  
**Date:** 2026-06-24  
**Plan reviewed:** `docs/roadmap/clipforge-auto-render-plan.md`  
**Companion docs read:** `goaldmine-clipforge-bridge.md`, `clipforge-day-footage-integration.md`, `prisma/schema.prisma`, `src/lib/mcp/tools/project-tools.ts`, `src/lib/mcp/tools.ts` (footage section), `src/app/api/mcp/route.ts`, `src/app/api/mcp/[token]/route.ts`, `src/lib/calendar.ts`, `src/lib/calendar-core.ts`, `src/lib/mcp/tool-helpers.ts`

---

## Priority levels

| Tag | Meaning |
|-----|---------|
| CRITICAL | Plan is wrong or ambiguous in a way that will produce broken stories or a broken system. Fix before decomposition. |
| SHOULD-FIX | Real issue that will bite during implementation or operation; fix before sprint planning. |
| NICE-TO-HAVE | Improvement that reduces risk but won't block the feature. |

---

## Finding 1 — CRITICAL: claim_render_job race is underspecified; stale claims ignored

**The plan (Epic A, render tools):**
> `claim_render_job` is an atomic conditional update (pending→claimed) to prevent double-claim.

The plan names the goal but does not specify the Prisma pattern. This matters because there are two shapes of implementation:

**WRONG (find-then-update — races):**
```ts
const job = await prisma.dayRenderJob.findFirst({ where: { status: 'pending' } });
if (job) await prisma.dayRenderJob.update({ where: { id: job.id }, data: { status: 'claimed' } });
```
Two concurrent cron runs can both findFirst the same pending job before either update lands, claiming the same job twice.

**CORRECT (Prisma conditional updateMany — atomic):**
```ts
const result = await prisma.dayRenderJob.updateMany({
  where: { id: jobId, status: 'pending' },     // precondition on status
  data: { status: 'claimed', claimedAt: new Date() },
});
if (result.count === 0) { /* another worker grabbed it — skip */ }
```
This maps to `UPDATE ... WHERE id=? AND status='pending'` — the DB serializes competing claims. The zero-count branch is the "already claimed" signal.

**Missing: stale claim / re-queue.** If the worker process crashes, is OOM-killed, or the GPU box loses power after `claimed` but before `failed`/`drafted`, the job is stuck in `claimed` indefinitely. The plan's `claimedAt` timestamp exists but the re-queue logic is never mentioned. Add to Epic A stories:

> `queue_render_job` (or a separate `requeue_stale_claims` tool/cron) must reset jobs where `status='claimed' AND claimedAt < now() - 30min` back to `pending`. This is especially important for a home GPU box that can lose power.

**Fix:** The `claim_render_job` story's acceptance criteria must spell out the `updateMany`-count pattern and a claim timeout (30 min is conservative; tune to expected render duration). Add a "stale claim reaper" as a line item in Epic A.

---

## Finding 2 — CRITICAL: draft→approved poll loop is architecturally broken for headless workers

**The plan (Epic B):**
> claim → get_day_footage → ... → submit_render_draft → notify → poll `approved` → render → complete_render_job

"Poll `approved`" inside the SAME headless `claude -p` run is a blocker. The headless Claude process would need to stay alive — in a loop — checking the job status, waiting for the user to hit "Approve" in the Goaldmine UI. This could be hours. A `claude -p` subprocess running for hours is:

1. **Impractical** — Claude Code does not guarantee indefinite subprocess runtime; the OS or the launchd/systemd harness will kill it at some threshold.
2. **Token-wasteful** — every poll iteration in the same session consumes context. A 6-hour wait with 5-minute polls is ~72 re-checks keeping the context alive.
3. **Non-resumable** — if the machine sleeps or the process is killed, the polling state is lost. The job is stuck in `claimed` with no draft written (until the stale-claim reaper handles it).

**The correct split-run design:**
```
Cron run 1 (pending job found):
  claude -p → claim → get_day_footage → pins → apply_spine → frame_strip
            → submit_render_draft(draftRef, notes) → exit (job is now 'drafted')

Worker exits immediately after writing 'drafted'. No polling.

User: sees "Approve render" button on Day page → clicks → status = 'approved'

Cron run 2 (next poll, finds 'approved' job):
  claude -p → read draft → render → complete_render_job(outputRef) → exit
```

The cron's `peek` endpoint already knows to look for pending jobs — extend it to also surface `approved` jobs so the cron can trigger a separate render-finalization run. The worker must NOT poll; it must WRITE state and EXIT. Each phase of the lifecycle is its own cron-triggered run.

**This affects the lifecycle definition.** The plan's lifecycle needs a new intermediate checkpoint:
```
pending → claimed → drafted → [user approves] → approved → render-claimed → rendered
                                                           (+ failed at any claimed step)
```
The `render-claimed` status disambiguates "approved but not yet picked up" from "being rendered right now", preventing a second worker from re-claiming an already-in-flight render.

**Fix:** Rewrite Epic B worker architecture as two discrete cron-triggered runs (draft run + render run). Add `render-claimed` status. The worker never polls; it always writes state and exits.

---

## Finding 3 — CRITICAL: auth for headless worker is unvetted and has real TOS risk

**The plan:**
> The worker authenticates with the user's Claude subscription (claude.ai login), never an ANTHROPIC_API_KEY. Preserves the "$0 beyond Max" principle.

Three problems:

**3a. OAuth session expiry.** Claude Code's `claude -p` mode in subscription-auth relies on a browser-based OAuth token stored in the Claude Code config directory (usually `~/.config/claude/`). OAuth tokens expire. Browser-based refresh requires an interactive flow. An unattended background worker on the GPU box will silently fail when the token expires — likely within days to weeks. The plan has no mention of token refresh, failure detection, or fallback. A dead session surfaces only as the next cron run failing with an auth error.

**3b. Rate limits are shared with interactive sessions.** The Max subscription's daily token budget is shared between claude.ai web sessions (coaching) and the worker. A heavy coaching session on a training day — exactly when a render job is likely queued — can exhaust the daily budget before the worker runs. No monitoring, no fallback, no retry is mentioned.

**3c. TOS exposure.** Anthropic's Max subscription TOS is for individual interactive use. A standing, automated, unattended background worker making repeated API calls through a subscription account is functionally equivalent to API use without paying for API tokens. This is a meaningful risk: Anthropic could rate-limit or terminate the account. The plan acknowledges this risk for Epic C ("personal single-user only") but does NOT surface it for Epic B, which has the same exposure.

**Recommended fix:** Flag this honestly in the Epic B stories. The pragmatic v1 hedge is: start with subscription auth, but design the worker's config so that swapping to `ANTHROPIC_API_KEY` requires only changing one env var — not a rewrite. A real `ANTHROPIC_API_KEY` at ~$0.003/call for Haiku or Sonnet is not expensive for one render per day, and is TOS-clean. The "$0 beyond Max" claim should be marked aspirational / "depends on Anthropic not objecting," not a guarantee.

---

## Finding 4 — CRITICAL: file-ingestion precondition is completely out of scope but blocks everything

**The bridge doc (§ "How it works"), step 3:**
> Ingest those files into a ClipForge project (so list_assets can match by filename)

**The plan never mentions who does this in the automated flow.**

In the manual flow: human copies video files to the GPU box → runs ClipForge ingestion → then runs the bridge prompt.

In the automated flow: the user queues a render job from Goaldmine (any machine). The GPU-box worker polls and picks it up. But the files still need to physically be on the GPU box AND ingested into ClipForge before the worker can call `list_assets`. The render queue doesn't know whether this has happened. If it hasn't, `list_assets` returns nothing, the filename→assetId resolution fails for every marker, the job fails with cryptic "0 markers resolved" output, and the user has no idea why.

**This is the hard precondition the plan is silent on:**
- Who copies files to the GPU box? (Phone → GPU box file transfer is not mentioned anywhere)
- Who ingests them into ClipForge? (ClipForge ingestion is a separate step outside Goaldmine)
- How does the render job know ingestion is complete?

**Options (pick one and put it in the plan):**

a) **Explicit gate**: `queue_render_job` accepts an optional `clipforgeProjectId` field; the worker checks `list_assets` first and fails fast with a clear message if count < number of markers. The "Queue for render" UI in Goaldmine only activates after the user confirms "files ingested."

b) **Ingestion as a separate Epic B story**: Define a folder-watch daemon on the GPU box that auto-ingests incoming files (from iPhone AirDrop, Synology, etc.) before the render worker runs. This is non-trivial and should not be hand-waved.

c) **Scope statement**: Explicitly call out in Epic A/B that "Queue for render" is only valid AFTER files are on the GPU box and ingested, and the user is responsible for that step. This keeps the scope clean but makes it a half-automation, not a full auto-render.

**Fix:** Choose option (c) for v1, document it clearly in Epic B, and add a `clipforgeProjectId` param to `queue_render_job` so the automated prompt can target the right project without guessing.

---

## Finding 5 — SHOULD-FIX: `@@unique([goalId, date])` constraints re-queueing and needs onDelete

**From the plan:**
> `@@unique([goalId,date])`

If the constraint is enforced and a render was completed/failed, the user cannot queue a new render for the same day unless the old row is deleted. But the plan's `queue_render_job` tool presumably creates a new job row. Second call for the same (goalId, date) hits the unique constraint and fails with a P2002. There's no story for "re-render a day."

**Two valid designs; pick one:**
- **Upsert approach**: `queue_render_job` does a Prisma upsert on (goalId, date). If a job already exists, it resets to `pending` and clears draftRef/outputRef/errorMessage. Document which statuses are re-queueable (failed, rendered) vs. blocked (pending, claimed, drafted — would clobber in-progress work).
- **Delete-and-recreate**: `queue_render_job` errors if a non-terminal job exists; auto-deletes terminal jobs (failed/rendered) before creating new one.

Either is fine; the silence is the problem. The story's AC must specify which.

**Also: `goalId` FK needs `onDelete: Cascade` or `SetNull` specified.** Looking at `prisma/schema.prisma`, `FootageMarker.workoutId` uses `SetNull`, `Hike.goalId` uses `SetNull`. For `DayRenderJob.goalId`, `SetNull` breaks (goalId would become null — not safe if it's a required filter key). `Cascade` makes sense (deleting a goal deletes its render jobs). Neither is mentioned in the plan. Add to migration story.

---

## Finding 6 — SHOULD-FIX: notify channel is hand-waved; "poll `approved`" implies a concrete implementation that doesn't exist

**The plan:** "notify" appears in the job lifecycle but no notify channel is specified anywhere.

Options ranked by build cost:
1. **In-app badge (cheapest)**: The Day page already shows job status from the `DayRenderJob` row. A `drafted` status = badge/banner. The user sees it on next visit. No push infrastructure needed. Zero new code beyond the Day page affordance already in Epic A.
2. **Push notification (moderate)**: Requires VAPID key, service worker registration, push subscription persistence. Buildable for a Next.js PWA but adds ~1-2 story points and a new browser permission prompt.
3. **Email (expensive for single-user)**: Needs SMTP credentials, email template. Overkill.

**Recommended:** The Day page affordance (already in Epic A) IS the notify channel for v1. The "Queue for render" button becomes "Review draft" when the job reaches `drafted`. No push infra needed. State this explicitly so stories don't scope-creep into push notifications.

---

## Finding 7 — SHOULD-FIX: peek endpoint needs bearer auth wiring and is missing a critical field

**The plan:** `GET /api/render-jobs/peek` mirrors `/api/mcp` bearer auth.

Looking at `src/app/api/mcp/route.ts` (lines 10-17), auth is: extract `Authorization: Bearer <token>`, compare to `MCP_AUTH_TOKEN` env var. The peek endpoint must replicate this exactly, including the timing-safe compare (see `src/app/api/mcp/[token]/route.ts` line 23 for the `timingSafeEqual` pattern already in place).

The plan's peek response is `{ pendingCount, nextDate }`. This is fine for idle detection but **the cron also needs to pass the job ID to the Claude worker** so it knows which job to claim. If peek only returns a count, the cron must make a second call (an MCP `list_render_jobs` call that costs tokens) to find the job ID. Extend peek to:
```json
{ "pendingCount": 1, "nextJob": { "id": "...", "date": "2026-06-24", "goalId": "..." } }
```
This avoids the extra MCP round-trip for the common case (one pending job).

Also: peek should only return `approved` jobs for the render-finalization run (see Finding 2). Add `approvedCount` and `nextApprovedJob` to the peek response.

---

## Finding 8 — SHOULD-FIX: bridge automation underestimates the hard part — EPS_GUARD/POOL_CYCLED and unresolved files need explicit failure behavior

**The bridge doc (step 6):**
> report any slot whose spineNotes flags EPS_GUARD / POOL_CYCLED — those slots are the most likely wrong; offer to pin more or swap the spine.

The manual bridge STOPs and offers to "pin more or swap the spine." The automated agent cannot interactively offer anything. The plan says "automated bridge prompt" but doesn't define behavior on these flags.

**Two cases that need explicit failure policies:**

**EPS_GUARD** (quality guard — clip didn't meet embedding quality threshold): The agent should either (a) try the next spine, (b) drop the slot and proceed with a partial result, or (c) fail the draft and set `errorMessage` with specific flag details so the user can add footage. No fallback defined = undefined behavior = Claude hallucinates a response.

**POOL_CYCLED** (clip reuse — ClipForge recycled a clip from an earlier slot): This means there aren't enough unique clips for all spine slots. For a 30-second reel with 5 slots but only 3 clips, this fires. The automated agent should flag the draft with a note about which slots recycled, not silently produce a low-quality draft.

**Unresolved filenames**: The bridge doc says "list unresolved, continue, don't guess." For headless automation, unresolved markers with no filename match in `list_assets` should cause the job to `fail` (not silently degrade), with `errorMessage` listing the exact unresolved filenames. A half-rendered reel with missing clips is worse than a clear failure.

**Fix:** Add explicit rules to the Epic B automated bridge prompt spec:
- If `unresolved_markers > 0` → set job `failed` with errorMessage listing filenames.  
- If `EPS_GUARD` fires → retry with next available spine once; if still fires → fail with message.
- If `POOL_CYCLED` → proceed but include warning in draftRef/notes (acceptable degradation).

---

## Finding 9 — SHOULD-FIX: USER_TZ on the GPU box vs. the Goaldmine server

**From `src/lib/calendar-core.ts` line 14:**
```ts
export const USER_TZ = process.env.USER_TZ ?? "America/Denver";
```

The `DayRenderJob.date` field will be stored as USER_TZ midnight. The `queue_render_job` tool runs on the Goaldmine server (Vercel, UTC or nearest region), which reads `USER_TZ=America/Denver` from env. Correct.

But the GPU-box worker runs on a different machine. When the automated bridge prompt passes a date to `claim_render_job` or constructs date comparisons, if anything computes dates locally (e.g., "today's date" for context), the GPU box's local TZ must be irrelevant — all date logic must flow through MCP tool calls to the Goaldmine server, which has the correct USER_TZ env var. The worker prompt must never compute dates independently and pass them in as raw ISO strings; it must always pass the `date` field exactly as returned by `list_render_jobs`.

**Fix:** The Epic B worker prompt spec must explicitly state: "never compute dates; always use the `date` field from the job object returned by Goaldmine MCP tools verbatim." Add a lint note to the story.

---

## Finding 10 — SHOULD-FIX: `registerRenderTools` is not wired into `registerAll`

**From `src/lib/mcp/tools.ts` lines 477-501:**
```ts
export function registerAll(server: McpServer) {
  ...
  registerReadTools(server);
  registerWriteTools(server);
  registerProjectTools(server);
  registerGitHubTools(server);
}
```

Epic A adds `registerRenderTools`. But `registerAll` is the only entry point; it's called by both `route.ts` handlers. The story for render MCP tools MUST include "add `registerRenderTools(server)` call in `registerAll`" as an explicit AC line. This is easy to miss; the tools will silently not exist on the live MCP server if forgotten.

---

## Finding 11 — SHOULD-FIX: `outputRef` format is undefined but the Day UI must render it

**The plan:** `complete_render_job(id, { outputRef, status })` — the worker passes back a `outputRef` and the Day page shows a link.

`outputRef` is never defined. In the ClipForge context it could be:
- A ClipForge render URL (`https://clipforge.local/renders/xxx`)
- A local file path (`/Users/ggronnii/renders/2026-06-24-reel.mp4`)  
- A cloud storage URL
- A ClipForge project render id

The Day page UI needs to know whether to render it as an `<a href>`, a local path (not linkable from the browser), or a ClipForge deep link. This must be agreed between Epic A (Goaldmine stores/displays) and Epic B (worker writes it).

**Fix:** Define `outputRef` format in Epic A as part of the `DayRenderJob` model story: "opaque string; URI if starts with `http`/`https` → rendered as external link; otherwise plain text." Keep it simple. Add this to `DayRenderJob.payload` if richer metadata is needed.

---

## Finding 12 — NICE-TO-HAVE: "one shared worker" framing between Epic B and C is aspirational, not architectural

**The plan:** "Both share one component — a standing, Claude-subscription-authenticated agent worker on the GPU box."

Epic B is a batch job: start, do work, exit. Epic C (coaching window) is a streaming bidirectional session. The transport requirements are fundamentally different:
- Batch worker: stateless `claude -p` subprocess, exits when done.
- Coaching window: persistent streaming session, bidirectional, low-latency.

The "shared worker" is aspirational. In practice, these will be two different processes/services. The render worker doesn't need to be running for coaching to work, and vice versa. Calling them "one shared worker" in the roadmap may lead Epic C stories to assume infrastructure from Epic B that doesn't fit. Recommend rephrasing: "Both use subscription-auth Claude Code on the GPU box, but as separate concerns — Epic B is a batch cron job; Epic C is a streaming proxy service."

---

## Finding 13 — NICE-TO-HAVE: multiple `highlight: true` markers are not enforced but the automated agent must handle them gracefully

**From `get_day_footage` implementation (`src/lib/mcp/tools.ts` lines 4082-4088) and `log_footage` schema:**
> "At most one marker per day should be highlighted, but this is not enforced."

The automated bridge prompt says "marker.highlight == true → position:'lead'". If two markers have `highlight: true`, two pins compete for the lead slot. The bridge doc says "use the first one (after capturedAt asc sort within the highlight group)." The automated prompt must replicate this tie-breaking logic explicitly, not rely on Claude inferring it from the doc.

---

## Summary: Prioritized Fix List

| # | Severity | Fix |
|---|----------|-----|
| 1 | CRITICAL | Specify `updateMany`-count pattern for `claim_render_job`; add stale-claim reaper story |
| 2 | CRITICAL | Rewrite Epic B as two discrete cron-triggered runs (draft run / render run); add `render-claimed` status; worker never polls |
| 3 | CRITICAL | Flag subscription-auth TOS risk explicitly; design worker to support API key swap via single env var |
| 4 | CRITICAL | Define file-ingestion precondition: who copies files, when, how the queue knows it's safe to proceed; add `clipforgeProjectId` param |
| 5 | SHOULD-FIX | Specify upsert vs. delete-and-recreate for `queue_render_job` on existing (goalId,date); add `onDelete: Cascade` to FK story |
| 6 | SHOULD-FIX | Remove "notify" as a separate channel; Day page `drafted` status badge IS the notification for v1 |
| 7 | SHOULD-FIX | Extend peek response to include `nextJob.id` and `approvedCount`/`nextApprovedJob`; add bearer auth wiring note |
| 8 | SHOULD-FIX | Define explicit failure policies for EPS_GUARD, POOL_CYCLED, and unresolved filenames in the automated bridge prompt spec |
| 9 | SHOULD-FIX | Forbid GPU-box-local date computation in worker prompt; all dates from Goaldmine MCP verbatim |
| 10 | SHOULD-FIX | Explicit AC in render tools story: add `registerRenderTools(server)` call in `registerAll` in `tools.ts` |
| 11 | SHOULD-FIX | Define `outputRef` format (URI vs. opaque string); Day page rendering rules |
| 12 | NICE-TO-HAVE | Decouple "shared worker" framing; Epic B batch job ≠ Epic C streaming proxy |
| 13 | NICE-TO-HAVE | Explicit tie-breaking for multiple `highlight: true` markers in automated bridge prompt |

---

## The one structural change that unblocks everything

**Finding 2 is load-bearing.** If the worker polls for approval inside the same run, Findings 3 (auth expiry kills long-running sessions), 6 (notify becomes moot if the worker is waiting), and 9 (TZ drift over hours) all get worse. The split-run design (draft run → user approves → render run) is the cleanest fix and makes every other finding smaller. Fix 2 first, then decompose stories.
