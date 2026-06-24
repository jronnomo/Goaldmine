# ClipForge Auto-Render Worker — Implementation Spec (Epic B · #119–#123)

**Status:** Spec (code lands OUTSIDE this repo, on the GPU box) · **Date:** 2026-06-24
**Companions:** [`clipforge-auto-render-plan.md`](./clipforge-auto-render-plan.md) (the plan + R1–R11) · [`../integrations/goaldmine-clipforge-bridge.md`](../integrations/goaldmine-clipforge-bridge.md) (the manual bridge prompt this automates)
**Depends on (shipped):** `DayRenderJob` model, render MCP tools (`queue/list/claim/start/submit_draft/complete_render_job`), `GET /api/render-jobs/peek`, the stale-claim reaper.

---

## 0. DECISION GATE (#119) — auth & cost · READ BEFORE BUILDING

**Finding (verified against Claude Code docs + 2026 auth guidance):** an unattended, cron-driven headless worker **cannot cleanly run on the Claude Max subscription.**
- `CLAUDE_CODE_OAUTH_TOKEN` (subscription auth) is **not honored in `--bare` headless mode**, and subscription OAuth is **scoped to interactive use** (a standing automated worker is outside that intent / current ToS — re-verify the live ToS before relying on it).
- → The worker must use **`ANTHROPIC_API_KEY`** (Console, pay-as-you-go). **The "$0 beyond Max" goal does NOT hold for the worker.** This was flagged as risk R3 in the plan; the research resolves it against the subscription.

**Cost shape (so you can go/no-go):**
- The **render itself is free** — GPU/ClipForge does the encoding; no LLM cost there.
- Only the **curation reasoning** per job costs API tokens: a few-turn agent run reading `get_day_footage` + mapping pins. Ballpark a few cents per draft run, near-zero per render run. At your volume (a handful of reels/week) that's plausibly **< $1–2/mo** — but it is **not $0**. Estimate from real runs (`total_cost_usd` is in the JSON output) and decide.
- **Recommendation:** proceed with `ANTHROPIC_API_KEY`. Keep auth behind one env var so it's swappable. Do NOT wire the subscription into the cron worker.

**If you do NOT want to pay metered API:** the fallback is to keep the bridge **semi-manual** — the queue + Day-page affordance (already shipped) still let you mark days ready; you just run the bridge prompt by hand in an interactive Claude on the GPU box (subscription, $0) when you see a `pending` job. The queue makes that a one-click-then-paste, not full automation.

---

## 1. Architecture (recap)
Poll, not push (GPU box is behind NAT). **Split-run, never long-poll** (R2): each cron tick runs one short headless Claude session and exits. Two run types, selected by `/peek`:
- **Draft run** — `pending` jobs: claim → build draft reel → `submit_render_draft` → exit.
- **Render run** — `approved` jobs (you approved the draft in Goaldmine): `start_render_job` → render → `complete_render_job` → exit.
Lifecycle: `pending → claimed → drafted → approved → rendering → rendered` (+ `failed`). The shipped reaper re-queues stuck `claimed`/`rendering` jobs after 30 min.

---

## 2. #119 — Worker scaffold + auth · M
Repo/dir on the GPU box (NOT in goaldmine), e.g. `~/clipforge-worker/`:
```
clipforge-worker/
  worker.sh            # the cron entrypoint (§3)
  mcp-config.json      # both MCP servers (§ below)
  prompts/draft.md     # §4
  prompts/render.md    # §5
  .env                 # ANTHROPIC_API_KEY, GOALDMINE_MCP_URL, GOALDMINE_MCP_TOKEN, CLIPFORGE_* 
  logs/
```
`.env` (chmod 600):
```
ANTHROPIC_API_KEY=sk-ant-...          # paid; see §0
GOALDMINE_MCP_URL=https://workout-planner-gold-three.vercel.app/api/mcp
GOALDMINE_MCP_TOKEN=<MCP_AUTH_TOKEN>   # same bearer the connector uses
GOALDMINE_PEEK_URL=https://workout-planner-gold-three.vercel.app/api/render-jobs/peek
```
`mcp-config.json` — remote Goaldmine (bearer) + local ClipForge (stdio):
```json
{
  "mcpServers": {
    "goaldmine": {
      "type": "streamable-http",
      "url": "${GOALDMINE_MCP_URL}",
      "headers": { "Authorization": "Bearer ${GOALDMINE_MCP_TOKEN}" },
      "timeout": 60000
    },
    "clipforge": {
      "command": "<clipforge mcp launch cmd>",
      "args": ["<...>"],
      "env": { "CLIPFORGE_GPU_DEVICE": "0" }
    }
  }
}
```
AC: a `claude --bare -p "ping" --mcp-config mcp-config.json --output-format json` run authenticates via `ANTHROPIC_API_KEY` and lists both servers' tools. Auth-expiry/disabled-account → exit code 1 + `is_error` → alert (see §6).

## 3. #120 — Cron poller → /peek → launch correct run · S
`cron` every ~5 min runs `worker.sh`:
1. `flock -n` guard (one run at a time — §6).
2. `curl -s -H "Authorization: Bearer $GOALDMINE_MCP_TOKEN" "$GOALDMINE_PEEK_URL"` → JSON `{ pendingCount, nextJob, approvedCount, nextApprovedJob, reaped }`.
3. Branch (drain one job per tick; **render runs first** so approved work finishes before new drafts):
   - `approvedCount > 0` → **render run** for `nextApprovedJob.id`.
   - else `pendingCount > 0` → **draft run** for `nextJob.id`.
   - else exit 0.
4. Launch the matching headless Claude run (§4/§5), passing the job id + date into the prompt.
**The worker computes no dates** (R8) — it passes `nextJob.id`/`.date` through verbatim.

## 4. #121 — Draft run · M
Invocation (single-shot, tool-allowlisted, time-boxed):
```bash
timeout 600 claude --bare -p "$(render_prompt draft "$JOB_ID" "$PROJECT_ID")" \
  --mcp-config mcp-config.json --output-format json --max-turns 12 \
  --allowedTools "mcp__goaldmine__claim_render_job,mcp__goaldmine__get_day_footage,\
mcp__goaldmine__submit_render_draft,mcp__goaldmine__complete_render_job,\
mcp__clipforge__list_spines,mcp__clipforge__list_assets,mcp__clipforge__apply_spine,mcp__clipforge__frame_strip"
```
Operating prompt (`prompts/draft.md`, parameterized by job id; automates the bridge prompt — NO human stop, NO render):
1. `claim_render_job(id)` → if `claimed:false`, exit (another tick took it).
2. `get_day_footage(date)` (the job's date).
3. `clipforge.list_spines` → pick the fitting spine; **capture exact slot labels** (case-exact — the fragile join).
4. `clipforge.list_assets(clipforgeProjectId)` → resolve each `marker.filename → assetId` (capturedAt ±30s tiebreaker). **Unresolved filenames → `complete_render_job(id, status:"failed", errorMessage:"unresolved: <list>")` and exit** (R9 — never render empty).
5. Build pins (highlight → lead/hook; exercise order; B-roll → member). Multiple `highlight` → tie-break `capturedAt asc` (R9).
6. `clipforge.apply_spine(projectId, spineId, assetIds, pins, maxDurationSec:30)` → `frame_strip` to sanity-check.
7. Failure policy (R9): `EPS_GUARD` → retry once with the next-best spine, else fail with message; `POOL_CYCLED` → proceed but note it in the draft notes.
8. Caption (coach voice, from goal objective + highlight).
9. `submit_render_draft(id, draftRef:<clipforge draft id>, notes:<spine + any EPS_GUARD/POOL_CYCLED + caption>)` → **exit. Do not render.**
AC: a `pending` job ends as `drafted` with a draftRef, or `failed` with a clear message; the run never renders; `is_error:false` on the happy path.

## 5. #122 — Render run · S
Invocation as §4 but allowlist `mcp__goaldmine__start_render_job,mcp__goaldmine__complete_render_job,mcp__clipforge__render`.
Prompt (`prompts/render.md`):
1. `start_render_job(id)` → if `started:false`, exit (already taken).
2. `clipforge.render(projectId, preset)` from the approved draft.
3. `complete_render_job(id, outputRef:<reel URL-or-id>, status:"rendered")`. On render error → `complete_render_job(id, status:"failed", errorMessage:<err>)`. Exit either way.
AC: an `approved` job ends `rendered` with `outputRef` (surfaces as the reel link on the Day page), or `failed` with a message.

## 6. #123 — Run-as-a-service + logging + retry · M
- **Schedule:** a launchd `.plist` (macOS) or systemd timer running `worker.sh` every 5 min. (Or a single long-lived loop with `sleep 300` — but cron/timer is simpler and crash-resilient.)
- **Concurrency:** `flock -n /tmp/clipforge-worker.lock` at the top of `worker.sh`; a tick that can't get the lock exits 0. Belt-and-suspenders with the server-side reaper (stuck claims auto-requeue after 30 min).
- **Per-run logs:** `logs/<unix-ts>.log` capturing the peek result, the chosen run, the full JSON output (`result`, `is_error`, `total_cost_usd`, `num_turns`), timestamps.
- **Bounded retry:** on `is_error:true` whose `result` matches transient patterns (`timeout|connection|unavailable|50[0-9]`), retry ≤3 with exponential backoff; non-transient → fail the job and stop.
- **Timeout:** wrap `claude` in `timeout 600`; exit 124 → log + treat as transient (the reaper will requeue the claim).
- **Alerting:** persistent `is_error` / exit 1 (auth) → write a breadcrumb the user sees (e.g. `log_note` via MCP, or a local notification) so a dead worker is noticed.

## 7. Permissions / safety
- `--bare` + explicit `--allowedTools` = no interactive permission prompts (required for unattended). Allowlist ONLY the exact MCP tools each run needs (§4/§5) — least privilege.
- The worker has the Goaldmine bearer + ClipForge local access; keep `.env` 0600; the box is single-user.

## 8. Open items / risks
- **§0 auth/cost gate is the go/no-go.** Everything else assumes `ANTHROPIC_API_KEY`.
- File-ingestion precondition (R4): files must already be in the ClipForge project before a day is queued — out of worker scope; the draft run fails loudly if assets are missing.
- ClipForge MCP tool names/preset values in §4/§5 are placeholders — verify against the live ClipForge MCP schema (`list_*` first).
- `--max-turns`/timeout values are starting points; tune from real run logs.
